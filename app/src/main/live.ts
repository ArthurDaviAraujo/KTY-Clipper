import { EventEmitter } from 'events'
import { mkdirSync } from 'fs'
import { spawnSync } from 'child_process'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import type { Db } from './db'
import type { Logger } from './logs'
import { twitchStatus, TwitchChat, type ChatMessage } from './platforms/twitch'
import { KickChatPoller, kickStatus } from './platforms/kick'
import { YoutubeChatPoller, youtubeChannelInfo, youtubeStatus, youtubeWatchUrl, type YoutubeChannel } from './platforms/youtube'
import { SegmentRecorder, type RecorderTools } from './recorder'
import { noteGame } from './games'
import { MODALITIES, type Modality } from '../shared/modality'
import { recordSegmentSeconds } from '../shared/settings'

const MODALITY_IDS = Object.keys(MODALITIES) as Modality[]
import { channelUrl, parseChannelInput } from '../shared/channels'
import type { ChannelMatch, ChannelState, LiveInfo, Platform, RecordingInfo, Settings } from '../shared/types'

interface ChannelRow {
  id: number
  platform: Platform
  login: string
  display_name: string | null
  avatar_url: string | null
  /** Vigiar: o app checa se o canal está ao vivo */
  enabled: number
  /** Gravar quando estiver ao vivo (precisa de vigiar) */
  record: number
  last_checked_at: number | null
  last_error: string | null
  modality: string | null
}

interface Recording extends RecordingInfo {
  streamId: string
  recorder: SegmentRecorder | null
  stopRequested: boolean
  offlineSince: number | null
  nextSeq: number
  done: Promise<void>
  /** Chat lido por consulta (Kick e YouTube); a Twitch usa o IRC compartilhado */
  chatPoller: { stop(): void } | null
  /** Categoria vista por último (para anotar as trocas durante a live) */
  game: string | null
}

interface Runtime {
  live: LiveInfo | null
  playbackUrl: string | null
  /** Kick: id numérico do canal, usado para ler o chat */
  kickChannelId: number | null
  recording: Recording | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Lê resolução e fps do pedaço com o ffprobe que fica ao lado do ffmpeg. */
function probeResolution(ffmpeg: string, file: string): string | null {
  const r = spawnSync(
    join(dirname(ffmpeg), 'ffprobe.exe'),
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate', '-of', 'csv=p=0', file],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 }
  )
  const [w, h, fr] = (r.stdout ?? '').trim().split(',')
  if (!w || !h) return null
  const [n, d] = (fr ?? '').split('/').map(Number)
  const fps = n && d ? Math.round(n / d) : null
  return `${w}x${h}${fps ? ` ${fps}fps` : ''}`
}
const stamp = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', '_').replace(':', '-')

/**
 * Vigia os canais, grava as lives em pedaços e guarda o chat.
 * Gravação não é tarefa da fila: dura horas e é controlada aqui. Cada pedaço pronto vira linha em `segments`.
 */
export class LiveService extends EventEmitter {
  private rt = new Map<number, Runtime>()
  private chat = new TwitchChat()
  private chatBuffer: { liveId: number; msg: ChatMessage }[] = []
  /** login da Twitch → gravação ativa (o chat chega pelo login) */
  private chatTargets = new Map<string, Recording>()
  private timer: NodeJS.Timeout | null = null
  private flushTimer: NodeJS.Timeout | null = null
  private emitTimer: NodeJS.Timeout | null = null
  private polling = false
  private closed = false
  /** Motivo para não gravar (ex.: limite de espaço); null = pode gravar */
  private blocked: string | null = null

  constructor(
    private db: Db,
    private log: Logger,
    private settings: () => Settings,
    private tools: () => RecorderTools | null,
    /** Pasta raiz das gravações (escolhida em Ajustes) */
    private recordingsDir: () => string
  ) {
    super()
    this.chat.on('message', (m: ChatMessage) => this.onChat(m))
    this.chat.on('status', (s: string) => s === 'reconnecting' && this.log.warn('chat', 'Conexão com o chat da Twitch caiu; reconectando.'))
  }

  start(): void {
    const n = this.db.prepare(`UPDATE lives SET status = 'interrupted' WHERE status = 'recording'`).run().changes
    if (n) this.log.info('gravador', `${n} gravação(ões) interrompida(s) ao fechar; continuam se a live ainda estiver no ar.`)
    this.flushTimer = setInterval(() => this.flushChat(), 2000)
    void this.poll()
    this.schedule()
  }

  async stop(): Promise<void> {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    if (this.flushTimer) clearInterval(this.flushTimer)
    this.chat.close()
    await Promise.all([...this.rt.entries()].map(([id]) => this.stopRecording(id, 'interrupted')))
    this.flushChat()
  }

  private schedule(): void {
    if (this.closed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(async () => {
      await this.poll()
      this.schedule()
    }, this.settings().recorder.pollSeconds * 1000)
  }

  // ---------- canais ----------

  /** Canais vigiados (os criados só por importar VOD ficam de fora). */
  private rows(): ChannelRow[] {
    return this.db.prepare(`SELECT * FROM channels WHERE origin = 'watch' ORDER BY id`).all() as unknown as ChannelRow[]
  }

  list(): ChannelState[] {
    return this.rows().map((r) => this.state(r))
  }

  private state(r: ChannelRow): ChannelState {
    const rt = this.rt.get(r.id)
    const rec = rt?.recording
    return {
      id: r.id,
      platform: r.platform,
      login: r.login,
      displayName: r.display_name ?? r.login,
      avatarUrl: r.avatar_url,
      enabled: !!r.enabled,
      record: !!r.enabled && !!r.record,
      live: rt?.live ?? null,
      recording: rec
        ? {
            liveId: rec.liveId,
            dir: rec.dir,
            startedAt: rec.startedAt,
            segments: rec.segments,
            bytes: rec.bytes,
            chatMessages: rec.chatMessages,
            engine: rec.engine,
            resolution: rec.resolution,
            restarts: rec.restarts,
            lastError: rec.lastError
          }
        : null,
      lastCheckedAt: r.last_checked_at,
      lastError: r.last_error,
      modality: (MODALITY_IDS as string[]).includes(r.modality ?? '') ? (r.modality as Modality) : null
    }
  }

  async add(platform: Platform, input: string): Promise<ChannelState> {
    let parsed = parseChannelInput(platform, input)
    if (!parsed) throw new Error('Nome ou link de canal inválido.')
    // YouTube: o mesmo canal pode vir como @, id "UC…" ou link antigo; guarda sempre o @ (ou o id, se não tiver @)
    let yt: YoutubeChannel | null = null
    if (parsed.platform === 'youtube') {
      yt = await youtubeChannelInfo(parsed.login)
      if (!yt) throw new Error(`Canal "${parsed.login}" não encontrado no YouTube.`)
      parsed = { platform: 'youtube', login: yt.login }
    }
    const exists = this.db.prepare('SELECT id, origin FROM channels WHERE platform = ? AND login = ?').get(parsed.platform, parsed.login) as
      | { id: number; origin: string }
      | undefined
    if (exists?.origin === 'watch') throw new Error('Esse canal já está na lista.')
    if (exists) {
      // Já existia por causa de um VOD importado: passa a ser vigiado
      this.db.prepare(`UPDATE channels SET origin = 'watch', enabled = 1, record = 0 WHERE id = ?`).run(exists.id)
      const row = this.db.prepare('SELECT * FROM channels WHERE id = ?').get(exists.id) as unknown as ChannelRow
      this.log.info('canais', `Canal adicionado: ${row.display_name ?? row.login} (${parsed.platform}).`)
      void this.poll()
      return this.state(row)
    }
    // Confere se o canal existe antes de salvar
    const info = yt ?? (parsed.platform === 'twitch' ? (await twitchStatus([parsed.login])).get(parsed.login) : await kickStatus(parsed.login))
    if (!info) throw new Error(`Canal "${parsed.login}" não encontrado ${parsed.platform === 'twitch' ? 'na Twitch' : 'na Kick'}.`)
    const row = this.db
      .prepare(`INSERT INTO channels(platform, login, display_name, avatar_url, record, created_at) VALUES (?, ?, ?, ?, 0, ?) RETURNING *`)
      .get(parsed.platform, info.login, info.displayName, info.avatarUrl, Date.now()) as unknown as ChannelRow
    this.log.info('canais', `Canal adicionado: ${info.displayName} (${parsed.platform}).`)
    void this.poll()
    return this.state(row)
  }

  /**
   * "Todos": procura um nome na Twitch, na Kick e no YouTube ao mesmo tempo e diz onde ele existe
   * (e se já está na lista). Uma plataforma que falhar só fica de fora.
   */
  async lookup(name: string): Promise<ChannelMatch[]> {
    const checks: Promise<ChannelMatch | null>[] = (['twitch', 'kick', 'youtube'] as Platform[]).map(async (platform) => {
      const p = parseChannelInput(platform, name)
      if (!p) return null
      try {
        const info =
          platform === 'twitch'
            ? (await twitchStatus([p.login])).get(p.login)
            : platform === 'kick'
              ? await kickStatus(p.login)
              : await youtubeChannelInfo(p.login).then(async (c) => (c ? { ...c, live: (await youtubeStatus(c.login).catch(() => null))?.live ?? null } : null))
        if (!info) return null
        // O id "UC…" do YouTube diferencia maiúsculas; os outros logins são minúsculos
        const login = platform === 'youtube' ? info.login : info.login.toLowerCase()
        const already = !!this.db.prepare(`SELECT 1 FROM channels WHERE platform = ? AND login = ? AND origin = 'watch'`).get(platform, login)
        return { platform, login, displayName: info.displayName ?? login, avatarUrl: info.avatarUrl ?? null, live: !!info.live, already }
      } catch {
        return null
      }
    })
    return (await Promise.all(checks)).filter((x): x is ChannelMatch => !!x)
  }

  async remove(id: number): Promise<void> {
    await this.stopRecording(id, 'ended')
    this.rt.delete(id)
    const r = this.db.prepare('SELECT display_name, login FROM channels WHERE id = ?').get(id) as { display_name: string | null; login: string } | undefined
    const hasLives = this.db.prepare('SELECT 1 FROM lives WHERE channel_id = ? LIMIT 1').get(id)
    // Com gravações: só deixa de vigiar (as gravações continuam em "Gravações"); sem gravações: apaga
    if (hasLives) this.db.prepare(`UPDATE channels SET origin = 'import', enabled = 0 WHERE id = ?`).run(id)
    else this.db.prepare('DELETE FROM channels WHERE id = ?').run(id)
    if (r)
      this.log.info('canais', `Canal removido: ${r.display_name ?? r.login}.${hasLives ? ' As gravações dele continuam em "Gravações".' : ''}`)
    this.emitSoon()
    this.emit('lives')
  }

  /** Vigiar: desligado, o app para de checar o canal (e de gravar). */
  async setEnabled(id: number, enabled: boolean): Promise<void> {
    if (enabled) this.db.prepare('UPDATE channels SET enabled = 1 WHERE id = ?').run(id)
    else this.db.prepare('UPDATE channels SET enabled = 0, record = 0 WHERE id = ?').run(id)
    if (!enabled) {
      await this.stopRecording(id, 'ended')
      // Sem vigiar, o app não checa mais o canal: não pode continuar mostrando "ao vivo" com o dado velho
      const rt = this.rt.get(id)
      if (rt) rt.live = null
    }
    this.emitSoon()
    if (enabled) void this.poll()
  }

  /** Gravar quando estiver ao vivo: ligar também passa a vigiar; com a live no ar, começa na hora. */
  async setRecord(id: number, record: boolean): Promise<void> {
    if (record) this.db.prepare('UPDATE channels SET record = 1, enabled = 1 WHERE id = ?').run(id)
    else {
      this.db.prepare('UPDATE channels SET record = 0 WHERE id = ?').run(id)
      await this.stopRecording(id, 'ended')
    }
    const r = this.db.prepare('SELECT display_name, login FROM channels WHERE id = ?').get(id) as { display_name: string | null; login: string } | undefined
    if (r) this.log.info('canais', `${r.display_name ?? r.login}: ${record ? 'vai gravar quando estiver ao vivo' : 'só vigiando (sem gravar)'}.`)
    // Já se sabe que está ao vivo: começa agora, sem esperar a próxima checagem
    const rt = this.rt.get(id)
    if (record && rt?.live && !rt.recording) this.startRecording(this.db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as unknown as ChannelRow, rt)
    this.emitSoon()
    if (record) void this.poll()
  }

  /** Fixa a modalidade do canal (null = automática pela categoria da live). */
  setModality(id: number, modality: Modality | null): void {
    const m = modality && (MODALITY_IDS as string[]).includes(modality) ? modality : null
    this.db.prepare('UPDATE channels SET modality = ? WHERE id = ?').run(m, id)
    const r = this.db.prepare('SELECT display_name, login FROM channels WHERE id = ?').get(id) as { display_name: string | null; login: string } | undefined
    if (r) this.log.info('canais', `${r.display_name ?? r.login}: modalidade ${m ? MODALITIES[m].label : 'automática (pela categoria)'}.`)
    this.emitSoon()
  }

  checkNow(): Promise<void> {
    return this.poll()
  }

  /** Lives sendo gravadas agora (não podem ter pedaços apagados). */
  activeLiveIds(): Set<number> {
    const ids = new Set<number>()
    for (const rt of this.rt.values()) if (rt.recording) ids.add(rt.recording.liveId)
    return ids
  }

  /**
   * Impede novas gravações e pausa as atuais (ex.: limite de espaço atingido).
   * Pausadas como 'interrupted': ao liberar, a mesma live continua na próxima verificação.
   */
  async setBlocked(reason: string | null): Promise<void> {
    if (reason === this.blocked) return
    this.blocked = reason
    if (reason) {
      this.log.error('gravador', `Gravação pausada: ${reason}`)
      await Promise.all([...this.rt.keys()].map((id) => this.stopRecording(id, 'interrupted')))
    } else {
      this.log.info('gravador', 'Gravação liberada de novo.')
      void this.poll()
    }
  }

  get blockedReason(): string | null {
    return this.blocked
  }

  // ---------- verificação ----------

  private async poll(): Promise<void> {
    if (this.polling || this.closed) return
    this.polling = true
    try {
      const rows = this.rows().filter((r) => r.enabled)
      const now = Date.now()
      const twitch = rows.filter((r) => r.platform === 'twitch')
      if (twitch.length) {
        try {
          const res = await twitchStatus(twitch.map((r) => r.login))
          for (const r of twitch) this.applyStatus(r, res.get(r.login) ?? null, null, null, now)
        } catch (e) {
          for (const r of twitch) this.markError(r, (e as Error).message, now)
        }
      }
      for (const r of rows.filter((x) => x.platform === 'kick')) {
        try {
          const k = await kickStatus(r.login)
          this.applyStatus(r, k, k?.playbackUrl ?? null, k?.channelId ?? null, now)
        } catch (e) {
          this.markError(r, (e as Error).message, now)
        }
        await sleep(400)
      }
      for (const r of rows.filter((x) => x.platform === 'youtube')) {
        try {
          this.applyStatus(r, await youtubeStatus(r.login), null, null, now)
        } catch (e) {
          this.markError(r, (e as Error).message, now)
        }
        await sleep(400)
      }
    } finally {
      this.polling = false
      this.emitSoon()
    }
  }

  private markError(r: ChannelRow, message: string, now: number): void {
    this.db.prepare('UPDATE channels SET last_checked_at = ?, last_error = ? WHERE id = ?').run(now, message, r.id)
    if (r.last_error !== message) this.log.warn('canais', `${r.display_name ?? r.login}: ${message}`)
  }

  private applyStatus(
    r: ChannelRow,
    info: { displayName: string | null; avatarUrl: string | null; live: LiveInfo | null } | null,
    playbackUrl: string | null,
    kickChannelId: number | null,
    now: number
  ): void {
    if (!info) return this.markError(r, 'Canal não encontrado.', now)
    this.db
      // Nome e foto só trocam quando vieram (a página da live do YouTube não traz a foto do canal)
      .prepare('UPDATE channels SET display_name = COALESCE(?, display_name), avatar_url = COALESCE(?, avatar_url), last_checked_at = ?, last_error = NULL WHERE id = ?')
      .run(info.displayName, info.avatarUrl, now, r.id)
    r.last_error = r.last_error?.startsWith('Para gravar ') ? r.last_error : null
    // Já checado antes nesta sessão (na primeira checagem ao abrir o app não avisa)
    const known = this.rt.has(r.id)
    const rt = this.rt.get(r.id) ?? { live: null, playbackUrl: null, kickChannelId: null, recording: null }
    this.rt.set(r.id, rt)
    const wasLive = !!rt.live
    rt.live = info.live
    rt.playbackUrl = playbackUrl
    if (kickChannelId) rt.kickChannelId = kickChannelId
    const name = info.displayName ?? r.display_name ?? r.login
    const s = this.settings().recorder

    // Só vigiando: avisa que entrou ao vivo (quem grava avisa ao começar a gravação)
    if (info.live && !wasLive && known && !r.record) this.emit('wentLive', { name, title: info.live.title, game: info.live.game })
    if (info.live && !wasLive) this.log.info('ao vivo', `${name} entrou ao vivo: ${info.live.title || 'sem título'}${info.live.game ? ` (${info.live.game})` : ''}.`)

    const rec = rt.recording
    if (info.live) {
      if (rec && rec.streamId !== info.live.streamId) {
        // Nova transmissão (o streamer reiniciou a live): fecha a anterior e começa outra
        void this.stopRecording(r.id, 'ended').then(() => this.startRecording(r, rt))
        return
      }
      if (rec) {
        rec.offlineSince = null
        const game = info.live.game ?? null
        if (game !== rec.game) {
          if (noteGame(this.db, rec.liveId, now, game)) this.log.info('ao vivo', `${name} trocou de categoria: ${rec.game ?? 'sem categoria'} → ${game ?? 'sem categoria'}.`)
          rec.game = game
        }
      } else if (r.record && (!info.live.isRerun || s.recordReruns)) this.startRecording(r, rt)
    } else if (rec) {
      rec.offlineSince ??= now
      if (now - rec.offlineSince >= s.offlineGraceSeconds * 1000) {
        this.log.info('ao vivo', `${name} encerrou a live.`)
        void this.stopRecording(r.id, 'ended')
      }
    }
  }

  // ---------- gravação ----------

  private startRecording(r: ChannelRow, rt: Runtime): void {
    const live = rt.live
    if (!live || rt.recording || this.closed || this.blocked) return
    const tools = this.tools()
    if (!tools) {
      this.log.error('gravador', 'FFmpeg não encontrado: não dá para gravar.')
      return
    }
    // A Twitch costura anúncios no vídeo (fMP4 com EXT-X-DISCONTINUITY/EXT-X-MAP diferentes);
    // o ffmpeg copiando direto do link mistura os parâmetros do anúncio com os da live e corrompe
    // todos os quadros (medido em 2026-11-16). Só o Streamlink, com --twitch-disable-ads, grava certo.
    if (r.platform !== 'kick' && !tools.streamlink) {
      const msg = r.platform === 'twitch' ? 'Para gravar a Twitch é preciso o Streamlink (sem ele o vídeo sai corrompido pelos anúncios). Veja em Sistema.' : 'Para gravar o YouTube é preciso o Streamlink. Veja em Sistema.'
      if (r.last_error !== msg) {
        this.db.prepare('UPDATE channels SET last_error = ? WHERE id = ?').run(msg, r.id)
        this.log.error('gravador', `${r.display_name ?? r.login}: ${msg}`)
      }
      return
    }
    // Retoma a mesma transmissão se o app tinha fechado no meio
    const prev = this.db
      .prepare(`SELECT id, dir, recorder_restarts FROM lives WHERE channel_id = ? AND platform_stream_id = ? AND status IN ('recording', 'interrupted') ORDER BY id DESC LIMIT 1`)
      .get(r.id, live.streamId) as { id: number; dir: string; recorder_restarts: number } | undefined
    let liveId: number
    let dir: string
    let nextSeq = 0
    let segments = 0
    let bytes = 0
    if (prev) {
      liveId = prev.id
      dir = prev.dir
      const agg = this.db.prepare('SELECT COALESCE(MAX(seq), -1) AS mx, COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM segments WHERE live_id = ?').get(liveId) as {
        mx: number
        n: number
        b: number
      }
      nextSeq = agg.mx + 1
      segments = agg.n
      bytes = agg.b
      this.db.prepare(`UPDATE lives SET status = 'recording' WHERE id = ?`).run(liveId)
    } else {
      liveId = (
        this.db
          .prepare(`INSERT INTO lives(channel_id, title, started_at, status, platform_stream_id, game) VALUES (?, ?, ?, 'recording', ?, ?) RETURNING id`)
          .get(r.id, live.title, live.startedAt, live.streamId, live.game) as { id: number }
      ).id
      dir = join(this.recordingsDir(), `${r.platform}_${r.login}`, `${stamp(live.startedAt)}_${liveId}`)
      this.db.prepare('UPDATE lives SET dir = ? WHERE id = ?').run(dir, liveId)
    }
    // Live nova: a categoria vale desde o início; retomada: só anota se mudou enquanto o app estava fechado
    noteGame(this.db, liveId, prev ? Date.now() : live.startedAt, live.game ?? null)
    try {
      if (!isAbsolute(dir)) throw new Error('caminho relativo')
      // Se a pasta de gravações mudou (ex.: para o D:), a live retomada continua na pasta nova
      const rel = relative(resolve(this.recordingsDir()), resolve(dir))
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('fora da pasta de gravações atual')
      mkdirSync(dir, { recursive: true })
    } catch {
      // Pasta antiga inválida ou inacessível (ex.: disco removido): continua na pasta de gravações atual
      dir = join(this.recordingsDir(), `${r.platform}_${r.login}`, `${stamp(live.startedAt)}_${liveId}`)
      mkdirSync(dir, { recursive: true })
      this.db.prepare('UPDATE lives SET dir = ? WHERE id = ?').run(dir, liveId)
    }
    const chatCount = (this.db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE live_id = ?').get(liveId) as { n: number }).n

    const rec: Recording = {
      liveId,
      dir,
      startedAt: Date.now(),
      segments,
      bytes,
      chatMessages: chatCount,
      // Twitch usa Streamlink; Kick grava direto com ffmpeg (escolhendo a resolução)
      engine: r.platform !== 'kick' && tools.streamlink ? 'streamlink' : 'ffmpeg',
      resolution: null,
      restarts: prev?.recorder_restarts ?? 0,
      lastError: null,
      streamId: live.streamId,
      recorder: null,
      stopRequested: false,
      offlineSince: null,
      nextSeq,
      done: Promise.resolve(),
      chatPoller: null,
      game: live.game ?? null
    }
    rt.recording = rec
    if (r.platform === 'twitch' && this.settings().recorder.recordChat) {
      this.chatTargets.set(r.login, rec)
      this.chat.join(r.login)
    }
    if (r.platform === 'kick' && this.settings().recorder.recordChat && rt.kickChannelId) {
      let warned = false
      const poller = new KickChatPoller(
        rt.kickChannelId,
        (msgs) => {
          for (const m of msgs) this.chatBuffer.push({ liveId: rec.liveId, msg: { channel: r.login, time: m.time, user: m.user, text: m.text, emotes: m.emotes } })
          rec.chatMessages += msgs.length
        },
        (e) => {
          if (!warned) this.log.warn('chat', `${r.display_name ?? r.login}: chat da Kick com problema (${e.message}); tentando de novo.`)
          warned = true
        }
      )
      rec.chatPoller = poller
      poller.start()
    }
    if (r.platform === 'youtube' && this.settings().recorder.recordChat) {
      let warned = false
      const poller = new YoutubeChatPoller(
        live.streamId,
        (msgs) => {
          for (const m of msgs) this.chatBuffer.push({ liveId: rec.liveId, msg: { channel: r.login, time: m.time, user: m.user, text: m.text, emotes: m.emotes } })
          rec.chatMessages += msgs.length
        },
        (e) => {
          if (!warned) this.log.warn('chat', `${r.display_name ?? r.login}: chat do YouTube com problema (${e.message}); tentando de novo.`)
          warned = true
        }
      )
      rec.chatPoller = poller
      poller.start()
    }
    this.log.info('gravador', `Gravando ${r.display_name ?? r.login} em pedaços de ${recordSegmentSeconds(this.settings())} s (${rec.engine}).`)
    this.emit('recordingStarted', { liveId, name: r.display_name ?? r.login, title: live.title, resumed: !!prev })
    rec.done = this.recordLoop(r, rt, rec, tools)
    this.emitSoon()
  }

  private async recordLoop(r: ChannelRow, rt: Runtime, rec: Recording, tools: RecorderTools): Promise<void> {
    const name = r.display_name ?? r.login
    while (!rec.stopRequested && !this.closed) {
      const s = this.settings().recorder
      const recorder = new SegmentRecorder({
        platform: r.platform,
        // YouTube: o link da própria live (o /live do canal pode apontar para outra transmissão)
        channelUrl: r.platform === 'youtube' && rt.live ? youtubeWatchUrl(rt.live.streamId) : channelUrl(r.platform, r.login),
        playbackUrl: rt.playbackUrl,
        dir: rec.dir,
        segmentSeconds: recordSegmentSeconds(this.settings()),
        quality: s.quality,
        startSeq: rec.nextSeq,
        // Identifica o CSV desta execução; único mesmo depois de reabrir o app
        run: Date.now(),
        // Streamlink só para a Twitch (anúncios); a Kick grava limpa direto com ffmpeg
        tools: r.platform === 'kick' ? { ...tools, streamlink: null } : tools,
        onSegment: (seg) => {
          this.db
            .prepare(`INSERT OR IGNORE INTO segments(live_id, seq, path, start_utc, duration_s, bytes) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(rec.liveId, seg.seq, seg.path, Math.round(seg.runStartedAt + seg.startOffset * 1000), seg.duration, seg.bytes)
          rec.segments++
          rec.bytes += seg.bytes
          if (!rec.resolution) rec.resolution = probeResolution(tools.ffmpeg, seg.path)
          this.emit('segment', { liveId: rec.liveId, channelId: r.id, ...seg })
          this.emitSoon()
        },
        onLog: (level, message) => this.log.log(level, 'gravador', `${name}: ${message}`)
      })
      rec.recorder = recorder
      try {
        const { code, stderr } = await recorder.run()
        if (!rec.stopRequested) {
          const why = stderr.split(/\r?\n/).filter(Boolean).pop()
          rec.lastError = why ?? `ffmpeg saiu com código ${code}`
        }
      } catch (e) {
        rec.lastError = (e as Error).message
      }
      rec.nextSeq = recorder.lastSeq + 1
      rec.recorder = null
      if (rec.stopRequested || this.closed) break

      rec.restarts++
      this.db.prepare('UPDATE lives SET recorder_restarts = ? WHERE id = ?').run(rec.restarts, rec.liveId)
      this.log.warn('gravador', `${name}: a gravação parou (${rec.lastError}). Tentando de novo.`)
      this.emitSoon()
      await sleep(Math.min(60_000, 5000 * rec.restarts))
      // Espera a próxima verificação confirmar que a live continua; se acabou, stopRecording encerra o laço
      while (!rec.stopRequested && !this.closed && !rt.live) await sleep(2000)
    }
  }

  async stopRecording(channelId: number, status: 'ended' | 'interrupted' = 'ended'): Promise<void> {
    const rt = this.rt.get(channelId)
    const rec = rt?.recording
    if (!rt || !rec) return
    rec.stopRequested = true
    rec.chatPoller?.stop()
    await rec.recorder?.stop()
    await rec.done
    this.flushChat()
    this.db.prepare(`UPDATE lives SET status = ?, ended_at = ? WHERE id = ?`).run(status, status === 'ended' ? Date.now() : null, rec.liveId)
    rt.recording = null
    if (status === 'ended') this.emit('recordingEnded', rec.liveId)
    const r = this.db.prepare('SELECT platform, login, display_name FROM channels WHERE id = ?').get(channelId) as
      | { platform: Platform; login: string; display_name: string | null }
      | undefined
    if (r?.platform === 'twitch' && this.chatTargets.get(r.login) === rec) {
      this.chatTargets.delete(r.login)
      this.chat.part(r.login)
    }
    if (r)
      this.log.info(
        'gravador',
        `${r.display_name ?? r.login}: gravação ${status === 'ended' ? 'encerrada' : 'pausada'} com ${rec.segments} pedaço(s), ${(rec.bytes / 1024 ** 3).toFixed(2)} GB e ${rec.chatMessages} mensagens de chat.`
      )
    this.emitSoon()
  }

  // ---------- chat ----------

  private onChat(m: ChatMessage): void {
    const rec = this.chatTargets.get(m.channel)
    if (!rec) return
    this.chatBuffer.push({ liveId: rec.liveId, msg: m })
    rec.chatMessages++
  }

  private flushChat(): void {
    if (!this.chatBuffer.length) return
    const batch = this.chatBuffer
    this.chatBuffer = []
    const ins = this.db.prepare('INSERT INTO chat_messages(live_id, ts_utc, user, text, emotes) VALUES (?, ?, ?, ?, ?)')
    this.db.exec('BEGIN')
    try {
      for (const { liveId, msg } of batch) ins.run(liveId, msg.time, msg.user, msg.text, msg.emotes)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      this.log.error('chat', `Falha ao salvar mensagens: ${(e as Error).message}`)
    }
    this.emitSoon()
  }

  private emitSoon(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.emit('channels', this.list())
    }, 500)
  }
}
