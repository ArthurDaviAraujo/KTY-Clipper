import { EventEmitter } from 'events'
import { existsSync, mkdirSync, readdirSync, rmSync, rmdirSync } from 'fs'
import { dirname, join } from 'path'
import type { Db } from './db'
import type { JobContext, JobQueue } from './jobs'
import type { Logger } from './logs'
import { SegmentRecorder, resolveHls, resolveYoutube, type RecorderTools } from './recorder'
import { youtubeChannelInfo, youtubeChatReplayPage, youtubeVideoInfo, youtubeWatchUrl } from './platforms/youtube'
import { KICK_WINDOW_MS, kickChatPage, kickStatus, kickVodInfo, resolveKickVariant } from './platforms/kick'
import { nextCommentOffset, twitchVodChapters, twitchVodComments, twitchVodInfo, type VodComment } from './platforms/twitch'
import { noteGame } from './games'
import { parseVodInput } from '../shared/vod'
import type { LiveRecord, LiveStatus, Platform, Settings } from '../shared/types'

interface LiveRow {
  id: number
  channel_id: number
  kind: 'live' | 'vod'
  status: LiveStatus
  title: string | null
  game: string | null
  started_at: number
  ended_at: number | null
  platform_stream_id: string | null
  source_url: string | null
  duration_s: number | null
  range_start_s: number | null
  range_end_s: number | null
  dir: string | null
  error: string | null
  chat_status: string | null
  platform: Platform
  login: string
  display_name: string | null
  avatar_url: string | null
}

const stamp = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', '_').replace(':', '-')
const friendly = (e: unknown) => {
  const m = (e as Error)?.message ?? String(e)
  if (/subscriber-only|logged into an account/i.test(m)) return 'Este VOD é só para inscritos do canal; sem login de inscrito não dá para baixar. Dica: adicione o canal em "Ao vivo" para gravar as próximas lives.'
  return m
}

/**
 * Importa VODs (lives que já terminaram) por link, no mesmo formato das lives gravadas:
 * pedaços .ts na pasta de gravações + chat no banco, com o horário real de cada pedaço.
 */
export class VodService extends EventEmitter {
  constructor(
    private db: Db,
    private log: Logger,
    private queue: JobQueue,
    private settings: () => Settings,
    private tools: () => RecorderTools | null,
    private recordingsDir: () => string
  ) {
    super()
    queue.register('vod:import', 'net', (p, ctx) => this.runImport((p as { liveId: number }).liveId, ctx))
    queue.register('vod:chat', 'net', (p, ctx) => this.runChat((p as { liveId: number }).liveId, ctx.progress, ctx.signal))
  }

  // ---------- consulta ----------

  private row(id: number): LiveRow | undefined {
    return this.db
      .prepare(`SELECT l.*, c.platform, c.login, c.display_name, c.avatar_url FROM lives l JOIN channels c ON c.id = l.channel_id WHERE l.id = ?`)
      .get(id) as unknown as LiveRow | undefined
  }

  list(limit = 100): LiveRecord[] {
    const rows = this.db
      .prepare(
        `SELECT l.*, c.platform, c.login, c.display_name, c.avatar_url,
           (SELECT COUNT(*) FROM segments s WHERE s.live_id = l.id AND s.status != 'deleted') AS segs,
           (SELECT COALESCE(SUM(bytes), 0) FROM segments s WHERE s.live_id = l.id AND s.status != 'deleted') AS bytes,
           (SELECT COALESCE(SUM(duration_s), 0) FROM segments s WHERE s.live_id = l.id AND s.status != 'deleted') AS rec_s,
           (SELECT COUNT(*) FROM chat_messages m WHERE m.live_id = l.id) AS chat
         FROM lives l JOIN channels c ON c.id = l.channel_id ORDER BY l.id DESC LIMIT ?`
      )
      .all(limit) as unknown as (LiveRow & { segs: number; bytes: number; rec_s: number; chat: number })[]
    const progress = new Map<number, number>()
    for (const j of this.db
      .prepare(`SELECT json_extract(payload, '$.liveId') AS live_id, progress FROM jobs WHERE type = 'vod:import' AND status IN ('running', 'queued')`)
      .all() as { live_id: number; progress: number }[])
      progress.set(j.live_id, j.progress)
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      platform: r.platform,
      channelLogin: r.login,
      channelName: r.display_name ?? r.login,
      avatarUrl: r.avatar_url,
      title: r.title ?? '',
      game: r.game,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      durationS: r.duration_s,
      rangeStartS: r.range_start_s,
      rangeEndS: r.range_end_s,
      sourceUrl: r.source_url,
      dir: r.dir,
      segments: r.segs,
      recordedS: r.rec_s,
      bytes: r.bytes,
      chatMessages: r.chat,
      chatStatus: r.chat_status,
      progress: progress.get(r.id) ?? null,
      error: r.error
    }))
  }

  /** VODs sendo baixados agora (não podem ter pedaços apagados pelo limite de espaço). */
  importingIds(): Set<number> {
    return new Set((this.db.prepare(`SELECT id FROM lives WHERE kind = 'vod' AND status IN ('queued', 'importing')`).all() as { id: number }[]).map((r) => r.id))
  }

  // ---------- importar ----------

  /** Confere o link, cria a entrada na biblioteca e põe a importação na fila. */
  async importVod(url: string, startS?: number | null, endS?: number | null): Promise<LiveRecord> {
    const ref = parseVodInput(url)
    if (!ref) throw new Error('Link não reconhecido. Use twitch.tv/videos/…, kick.com/<canal>/videos/… ou um vídeo do YouTube (youtube.com/watch?v=… ou youtu.be/…).')
    const tools = this.tools()
    if (!tools) throw new Error('FFmpeg não encontrado.')

    let channel: { login: string; displayName: string; avatarUrl: string | null }
    let title: string
    let game: string | null
    let startedAt: number
    let durationS: number
    let sourceUrl: string
    let stillLive = false
    let broadcastId: string | null = null

    if (ref.platform === 'twitch') {
      const v = await twitchVodInfo(ref.id)
      if (!v) throw new Error('VOD não encontrado na Twitch (pode ter sido apagado ou o link está errado).')
      if (!v.owner) throw new Error('Não deu para identificar o canal deste VOD.')
      sourceUrl = `https://www.twitch.tv/videos/${v.id}`
      if (!tools.ytdlp) throw new Error('yt-dlp não encontrado.')
      // Testa já o acesso ao vídeo: VOD só para inscritos falha aqui, com mensagem clara
      try {
        await resolveHls(tools.ytdlp, sourceUrl, this.settings().recorder.quality)
      } catch (e) {
        throw new Error(friendly(e))
      }
      channel = v.owner
      title = v.title
      game = v.game
      startedAt = v.createdAt
      durationS = v.lengthSeconds
      stillLive = v.status === 'RECORDING'
    } else if (ref.platform === 'youtube') {
      const v = await youtubeVideoInfo(ref.id)
      if (!v) throw new Error('Vídeo não encontrado no YouTube (pode ser privado, ter sido apagado ou o link está errado).')
      if (v.isLiveNow) throw new Error('Esta live do YouTube ainda está no ar. Adicione o canal em Canais e ligue "Gravar" para clipar ao vivo.')
      if (v.isUpcoming) throw new Error('Esta live do YouTube ainda não começou (está agendada).')
      if (!tools.ytdlp) throw new Error('yt-dlp não encontrado.')
      sourceUrl = youtubeWatchUrl(v.id)
      try {
        await resolveYoutube(tools.ytdlp, sourceUrl, this.settings().recorder.quality)
      } catch (e) {
        throw new Error(friendly(e))
      }
      const info = await youtubeChannelInfo(v.channel.login).catch(() => null)
      channel = { login: info?.login ?? v.channel.login, displayName: info?.displayName ?? v.channel.displayName, avatarUrl: info?.avatarUrl ?? null }
      title = v.title
      game = v.category
      startedAt = v.startedAt
      durationS = v.durationS
    } else {
      const v = await kickVodInfo(ref.id)
      if (!v) throw new Error('VOD não encontrado na Kick (pode ter sido apagado ou o link está errado).')
      const slug = v.channelSlug ?? ref.channel
      if (!slug) throw new Error('Não deu para identificar o canal deste VOD.')
      const k = await kickStatus(slug)
      channel = { login: slug, displayName: k?.displayName ?? slug, avatarUrl: k?.avatarUrl ?? null }
      sourceUrl = `https://kick.com/${slug}/videos/${v.uuid}`
      title = v.title
      game = v.game
      startedAt = v.startedAt
      durationS = v.durationS
      broadcastId = v.livestreamId
    }

    const start = startS ?? null
    const end = endS ?? null
    if (start != null && (start < 0 || !Number.isFinite(start))) throw new Error('Início do trecho inválido.')
    if (end != null && (!Number.isFinite(end) || end <= (start ?? 0))) throw new Error('O fim do trecho precisa ser depois do início.')
    if (durationS && start != null && start >= durationS) throw new Error('O início passa do fim do VOD.')

    const dup = this.db
      .prepare(
        `SELECT id FROM lives WHERE kind = 'vod' AND platform_stream_id = ? AND status != 'failed'
           AND COALESCE(range_start_s, -1) = COALESCE(?, -1) AND COALESCE(range_end_s, -1) = COALESCE(?, -1)`
      )
      .get(ref.id, start, end)
    if (dup) throw new Error('Esse VOD (com esse trecho) já está na biblioteca.')

    const channelId = this.findOrCreateChannel(ref.platform, channel)
    const liveId = (
      this.db
        .prepare(
          `INSERT INTO lives(channel_id, kind, status, title, game, started_at, platform_stream_id, source_url, duration_s, range_start_s, range_end_s)
           VALUES (?, 'vod', 'queued', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
        )
        .get(channelId, title, game, startedAt, ref.id, sourceUrl, durationS || null, start, end) as { id: number }
    ).id
    const dir = join(this.recordingsDir(), `${ref.platform}_${channel.login}`, `vod_${stamp(startedAt)}_${liveId}`)
    this.db.prepare('UPDATE lives SET dir = ?, broadcast_id = ? WHERE id = ?').run(dir, broadcastId, liveId)
    // Categoria ao longo do VOD: na Twitch, pelos capítulos (cada troca de jogo); sem capítulos, a do VOD vale para tudo
    const chapters = ref.platform === 'twitch' ? await twitchVodChapters(ref.id).catch(() => []) : []
    if (!chapters.length || chapters[0].positionMs > 0) noteGame(this.db, liveId, startedAt, game)
    for (const c of chapters) noteGame(this.db, liveId, startedAt + c.positionMs, c.game)
    if (chapters.length > 1) this.log.info('importar', `VOD com ${chapters.length} categorias: ${chapters.map((c) => c.game ?? '?').join(' → ')}.`)

    this.queue.enqueue('vod:import', `Importar VOD: ${channel.displayName}`, { liveId })
    this.log.info(
      'importar',
      `VOD de ${channel.displayName} na fila${start != null || end != null ? ' (só um trecho)' : ''}${stillLive ? '. A live ainda está no ar: entra o que já existe até agora' : ''}.`
    )
    this.emitSoon()
    return this.list(200).find((l) => l.id === liveId)!
  }

  private findOrCreateChannel(platform: Platform, ch: { login: string; displayName: string; avatarUrl: string | null }): number {
    const ex = this.db.prepare('SELECT id FROM channels WHERE platform = ? AND login = ?').get(platform, ch.login) as { id: number } | undefined
    if (ex) return ex.id
    // Canal só da biblioteca: não é vigiado e não aparece em "Ao vivo"
    return (
      this.db
        .prepare(`INSERT INTO channels(platform, login, display_name, avatar_url, enabled, origin, created_at) VALUES (?, ?, ?, ?, 0, 'import', ?) RETURNING id`)
        .get(platform, ch.login, ch.displayName, ch.avatarUrl, Date.now()) as { id: number }
    ).id
  }

  private async resolveInput(r: LiveRow): Promise<{ video: string; audio: string | null }> {
    const tools = this.tools()!
    const quality = this.settings().recorder.quality
    if (r.platform === 'twitch') return { video: await resolveHls(tools.ytdlp!, r.source_url!, quality), audio: null }
    // YouTube: imagem e som vêm em links separados (os links vencem em algumas horas; cada tentativa pede de novo)
    if (r.platform === 'youtube') return resolveYoutube(tools.ytdlp!, r.source_url!, quality)
    const v = await kickVodInfo(r.platform_stream_id!)
    if (!v) throw new Error('O VOD da Kick não existe mais.')
    const variant = await resolveKickVariant(v.source, quality)
    return { video: variant?.url ?? v.source, audio: null }
  }

  private async runImport(liveId: number, ctx: JobContext): Promise<unknown> {
    const { progress, signal } = ctx
    const r = this.row(liveId)
    if (!r) throw new Error('Entrada removida da biblioteca.')
    const tools = this.tools()
    if (!tools) throw new Error('FFmpeg não encontrado.')
    this.db.prepare(`UPDATE lives SET status = 'importing', error = NULL WHERE id = ?`).run(liveId)
    this.emitSoon()

    try {
      const rangeStart = r.range_start_s ?? 0
      const rangeEnd = r.range_end_s ?? r.duration_s ?? null
      const total = rangeEnd != null ? Math.max(0, rangeEnd - rangeStart) : null

      // Retomada: continua depois do último pedaço completo
      const agg = this.db
        .prepare(`SELECT COALESCE(MAX(seq), -1) AS mx, COALESCE(SUM(duration_s), 0) AS done FROM segments WHERE live_id = ? AND status != 'deleted'`)
        .get(liveId) as { mx: number; done: number }
      const startSeq = agg.mx + 1
      const done = agg.done
      if (total != null && done >= total - 1) return this.finishImport(r)

      let dir = r.dir ?? join(this.recordingsDir(), `${r.platform}_${r.login}`, `vod_${stamp(r.started_at)}_${liveId}`)
      try {
        mkdirSync(dir, { recursive: true })
      } catch {
        dir = join(this.recordingsDir(), `${r.platform}_${r.login}`, `vod_${stamp(r.started_at)}_${liveId}`)
        mkdirSync(dir, { recursive: true })
        this.db.prepare('UPDATE lives SET dir = ? WHERE id = ?').run(dir, liveId)
      }
      // Pedaço incompleto de uma execução anterior é refeito
      for (const f of readdirSync(dir)) {
        const m = f.match(/^seg_(\d+)\.ts$/)
        if (m && Number(m[1]) >= startSeq) rmSync(join(dir, f), { force: true })
      }

      const input = await this.resolveInput(r)
      if (signal.aborted) throw signal.reason
      const seek = rangeStart + done
      const recorder = new SegmentRecorder({
        platform: r.platform,
        channelUrl: r.source_url ?? '',
        dir,
        segmentSeconds: this.settings().recorder.segmentSeconds,
        quality: this.settings().recorder.quality,
        startSeq,
        run: Date.now(),
        tools: { ...tools, streamlink: null },
        inputUrl: input.video,
        inputAudioUrl: input.audio ?? undefined,
        seekSeconds: seek,
        durationSeconds: total != null ? total - done : undefined,
        onSegment: (seg) => {
          this.db
            .prepare(`INSERT OR IGNORE INTO segments(live_id, seq, path, start_utc, duration_s, bytes) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(liveId, seg.seq, seg.path, Math.round(r.started_at + (seek + seg.startOffset) * 1000), seg.duration, seg.bytes)
          this.emit('segment', { liveId })
          this.emitSoon()
        },
        onProgress: (s) => total && progress(Math.min(0.999, (done + s) / total)),
        onLog: (level, message) => this.log.log(level, 'importar', `${r.display_name ?? r.login}: ${message}`)
      })
      const onAbort = () => void recorder.stop()
      signal.addEventListener('abort', onAbort)
      const { code, stderr } = await recorder.run().finally(() => signal.removeEventListener('abort', onAbort))
      if (signal.aborted) throw signal.reason
      if (code !== 0) throw new Error(stderr.split(/\r?\n/).filter(Boolean).pop() ?? `ffmpeg saiu com código ${code}`)

      const got = (this.db.prepare(`SELECT COALESCE(SUM(duration_s), 0) AS s FROM segments WHERE live_id = ? AND status != 'deleted'`).get(liveId) as { s: number }).s
      // Faltou mais de 1% (ou 10 s): conta como falha e a nova tentativa continua de onde parou
      if (total != null && got < total - Math.max(10, total * 0.01)) throw new Error(`Download incompleto (${Math.round(got)} de ${Math.round(total)} s).`)
      return this.finishImport(r)
    } catch (e) {
      const reason = signal.aborted ? (signal.reason as Error)?.message : null
      const lastTry = ctx.job.attempts >= ctx.job.maxAttempts
      if (reason === 'canceled') this.db.prepare(`UPDATE lives SET status = 'failed', error = 'Cancelado.' WHERE id = ?`).run(liveId)
      else if (reason === 'app-closing') this.db.prepare(`UPDATE lives SET status = 'queued' WHERE id = ?`).run(liveId)
      // Ainda há tentativas: fica na fila (a próxima continua de onde parou)
      else this.db.prepare(`UPDATE lives SET status = ?, error = ? WHERE id = ?`).run(lastTry ? 'failed' : 'queued', friendly(e), liveId)
      this.emitSoon()
      throw e
    }
  }

  private finishImport(r: LiveRow): unknown {
    this.db.prepare(`UPDATE lives SET status = 'imported', ended_at = ?, error = NULL WHERE id = ?`).run(Date.now(), r.id)
    const n = (this.db.prepare(`SELECT COUNT(*) AS n FROM segments WHERE live_id = ?`).get(r.id) as { n: number }).n
    this.log.info('importar', `VOD de ${r.display_name ?? r.login} importado: ${n} pedaço(s).`)
    if (this.settings().recorder.recordChat && r.chat_status !== 'done') {
      this.db.prepare(`UPDATE lives SET chat_status = 'queued' WHERE id = ?`).run(r.id)
      this.queue.enqueue('vod:chat', `Chat do VOD: ${r.display_name ?? r.login}`, { liveId: r.id })
    } else {
      // Sem chat: já dá para procurar momentos só pelo áudio
      this.emit('ready', r.id)
    }
    this.emitSoon()
    return { segments: n }
  }

  // ---------- chat do VOD (Twitch e Kick) ----------

  private async runChat(liveId: number, progress: (v: number) => void, signal: AbortSignal): Promise<unknown> {
    const r = this.row(liveId)
    if (!r || !r.platform_stream_id) return null
    this.db.prepare(`UPDATE lives SET chat_status = 'downloading' WHERE id = ?`).run(liveId)
    this.emitSoon()
    const startS = r.range_start_s ?? 0
    const endS = r.range_end_s ?? r.duration_s ?? Infinity
    if (r.platform === 'youtube') return this.runYoutubeChat(r, startS, endS, progress, signal)

    // Cada plataforma entrega uma página a partir de um segundo do VOD; o avanço no tempo é o mesmo
    type Page = { comments: VodComment[]; hasNext: boolean }
    let fetchPage: (offsetS: number) => Promise<Page>
    if (r.platform === 'twitch') {
      fetchPage = (o) => twitchVodComments(r.platform_stream_id!, o, signal)
    } else {
      const k = await kickStatus(r.login)
      if (!k) throw new Error('Canal da Kick não encontrado para ler o chat.')
      fetchPage = async (o) => {
        // A Kick não tem limite publicado: um pedido a cada ~200 ms
        await new Promise((res) => setTimeout(res, 200))
        const msgs = await kickChatPage(k.channelId, r.started_at + o * 1000, signal)
        return {
          // Janela vazia não é o fim: segue até o fim do trecho (o laço para em endS)
          hasNext: true,
          comments: msgs.map((m) => ({ id: m.id, offset: (m.time - r.started_at) / 1000, user: m.user, text: m.text, emotes: m.emotes }))
        }
      }
    }

    // Retomada: refaz a partir do último segundo salvo
    const maxTs = (this.db.prepare('SELECT MAX(ts_utc) AS t FROM chat_messages WHERE live_id = ?').get(liveId) as { t: number | null }).t
    let offset = maxTs != null ? Math.max(startS, Math.floor((maxTs - r.started_at) / 1000)) : startS
    if (maxTs != null) this.db.prepare('DELETE FROM chat_messages WHERE live_id = ? AND ts_utc >= ?').run(liveId, r.started_at + offset * 1000)

    const seen = new Set<string>()
    const ins = this.db.prepare('INSERT INTO chat_messages(live_id, ts_utc, user, text, emotes) VALUES (?, ?, ?, ?, ?)')
    let total = 0
    try {
      for (;;) {
        if (signal.aborted) throw signal.reason
        const page = await fetchPage(offset)
        const fresh = page.comments.filter((c) => !seen.has(c.id) && c.offset >= startS && c.offset <= endS)
        this.db.exec('BEGIN')
        for (const c of fresh) {
          seen.add(c.id)
          ins.run(liveId, r.started_at + c.offset * 1000, c.user, c.text, c.emotes)
        }
        this.db.exec('COMMIT')
        total += fresh.length
        offset = nextCommentOffset(offset, page.comments, r.platform === 'kick' ? KICK_WINDOW_MS / 1000 : 1)
        if (Number.isFinite(endS)) progress(Math.min(0.999, (offset - startS) / (endS - startS)))
        if (!page.hasNext || offset > endS) break
        if (seen.size > 50_000) seen.clear()
      }
      this.db.prepare(`UPDATE lives SET chat_status = 'done' WHERE id = ?`).run(liveId)
      this.log.info('importar', `Chat do VOD de ${r.display_name ?? r.login}: ${total} mensagens.`)
      this.emit('ready', liveId)
      return { messages: total }
    } catch (e) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // sem transação aberta
      }
      const reason = signal.aborted ? (signal.reason as Error)?.message : null
      this.db.prepare(`UPDATE lives SET chat_status = ? WHERE id = ?`).run(reason === 'app-closing' ? 'queued' : 'failed', liveId)
      // Sem o chat completo ainda dá para procurar momentos pelo áudio e pelo chat que veio
      if (reason !== 'app-closing' && reason !== 'canceled') this.emit('ready', liveId)
      throw e
    } finally {
      this.emitSoon()
    }
  }

  /**
   * Replay do chat de uma live do YouTube que já acabou: páginas em sequência, cada mensagem com o segundo do vídeo.
   * Vídeo comum (não foi live) não tem chat: segue só com áudio, fala e IA.
   */
  private async runYoutubeChat(r: LiveRow, startS: number, endS: number, progress: (v: number) => void, signal: AbortSignal): Promise<unknown> {
    const liveId = r.id
    const name = r.display_name ?? r.login
    try {
      const v = await youtubeVideoInfo(r.platform_stream_id!, signal)
      if (!v?.chat) {
        this.db.prepare(`UPDATE lives SET chat_status = 'done' WHERE id = ?`).run(liveId)
        this.log.info('importar', `${name}: este vídeo do YouTube não tem replay do chat; os momentos saem do áudio, da fala e da IA.`)
        this.emit('ready', liveId)
        return { messages: 0 }
      }
      // O replay é rápido de ler: refaz do começo do trecho
      this.db.prepare('DELETE FROM chat_messages WHERE live_id = ?').run(liveId)
      const ins = this.db.prepare('INSERT INTO chat_messages(live_id, ts_utc, user, text, emotes) VALUES (?, ?, ?, ?, ?)')
      const seen = new Set<string>()
      let continuation: string | null = v.chat.continuation
      let offset = startS
      let total = 0
      while (continuation) {
        if (signal.aborted) throw signal.reason
        const page = await youtubeChatReplayPage(v.chat, continuation, offset, signal)
        const fresh = page.messages.filter((m) => !seen.has(m.id) && m.offsetS >= startS && m.offsetS <= endS)
        this.db.exec('BEGIN')
        for (const m of fresh) {
          seen.add(m.id)
          ins.run(liveId, r.started_at + m.offsetS * 1000, m.user, m.text, m.emotes)
        }
        this.db.exec('COMMIT')
        total += fresh.length
        const last = page.messages.at(-1)?.offsetS
        if (last != null && last > offset) offset = last
        if (Number.isFinite(endS)) progress(Math.min(0.999, (offset - startS) / Math.max(1, endS - startS)))
        if (offset > endS) break
        continuation = page.next
        if (seen.size > 50_000) seen.clear()
        await new Promise((res) => setTimeout(res, 150))
      }
      this.db.prepare(`UPDATE lives SET chat_status = 'done' WHERE id = ?`).run(liveId)
      this.log.info('importar', `Chat do vídeo de ${name} (YouTube): ${total} mensagens.`)
      this.emit('ready', liveId)
      return { messages: total }
    } catch (e) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // sem transação aberta
      }
      const reason = signal.aborted ? (signal.reason as Error)?.message : null
      this.db.prepare(`UPDATE lives SET chat_status = ? WHERE id = ?`).run(reason === 'app-closing' ? 'queued' : 'failed', liveId)
      if (reason !== 'app-closing' && reason !== 'canceled') this.emit('ready', liveId)
      throw e
    } finally {
      this.emitSoon()
    }
  }

  // ---------- ações ----------

  private activeJobs(liveId: number): number[] {
    return (
      this.db
        .prepare(`SELECT id FROM jobs WHERE type IN ('vod:import', 'vod:chat') AND status IN ('running', 'queued', 'failed') AND finished_at IS NULL AND json_extract(payload, '$.liveId') = ?`)
        .all(liveId) as { id: number }[]
    ).map((j) => j.id)
  }

  cancel(liveId: number): void {
    for (const id of this.activeJobs(liveId)) this.queue.cancel(id)
    this.db.prepare(`UPDATE lives SET status = 'failed', error = 'Cancelado.' WHERE id = ? AND status IN ('queued', 'importing')`).run(liveId)
    this.emitSoon()
  }

  retry(liveId: number): void {
    const r = this.row(liveId)
    if (!r || r.kind !== 'vod') return
    if (r.status === 'imported') {
      if (r.chat_status === 'failed') {
        this.db.prepare(`UPDATE lives SET chat_status = 'queued' WHERE id = ?`).run(liveId)
        this.queue.enqueue('vod:chat', `Chat do VOD: ${r.display_name ?? r.login}`, { liveId })
      }
    } else if (!this.activeJobs(liveId).length) {
      this.db.prepare(`UPDATE lives SET status = 'queued', error = NULL WHERE id = ?`).run(liveId)
      this.queue.enqueue('vod:import', `Importar VOD: ${r.display_name ?? r.login}`, { liveId })
    }
    this.emitSoon()
  }

  /** Apaga da biblioteca e do disco. Lives sendo gravadas agora precisam ser paradas antes. */
  async delete(liveId: number): Promise<void> {
    const r = this.row(liveId)
    if (!r) return
    if (r.kind === 'live' && r.status === 'recording') throw new Error('Esta live está sendo gravada. Pare a gravação em "Ao vivo" antes de apagar.')
    // Cancela tudo o que mexe nesta live (importar, chat e detecção) e espera soltar os arquivos;
    // sem isso, apagar durante a detecção dá "Permission denied" num pedaço aberto pelo Whisper (visto em 2026-11-17)
    const jobsOf = () =>
      (
        this.db
          .prepare(`SELECT id, status FROM jobs WHERE status IN ('running', 'queued', 'failed') AND finished_at IS NULL AND json_extract(payload, '$.liveId') = ?`)
          .all(liveId) as { id: number; status: string }[]
      )
    for (const j of jobsOf()) this.queue.cancel(j.id)
    // Clipes desta live ainda na fila também saem (sem a gravação, falhariam com "trecho vazio")
    const pendingClips = this.db.prepare(`SELECT id, job_id FROM clips WHERE live_id = ? AND status IN ('queued', 'rendering')`).all(liveId) as {
      id: number
      job_id: number | null
    }[]
    const clipJobs = pendingClips.map((c) => c.job_id).filter((id): id is number => id != null)
    for (const id of clipJobs) this.queue.cancel(id)
    if (pendingClips.length) this.db.prepare(`DELETE FROM clips WHERE live_id = ? AND status IN ('queued', 'rendering')`).run(liveId)
    const busy = () => jobsOf().some((j) => j.status === 'running') || clipJobs.some((id) => this.queue.get(id)?.status === 'running')
    for (let i = 0; i < 100 && busy(); i++) await new Promise((res) => setTimeout(res, 100))
    // O Windows pode demorar um instante para liberar o arquivo depois que o processo fecha
    await new Promise((res) => setTimeout(res, 300))

    const paths = (this.db.prepare('SELECT path FROM segments WHERE live_id = ?').all(liveId) as { path: string }[]).map((s) => s.path)
    const dirs = new Set<string>(r.dir ? [r.dir] : [])
    for (const p of paths) {
      rmSync(p, { force: true })
      dirs.add(dirname(p))
    }
    for (const d of dirs) {
      if (!existsSync(d)) continue
      for (const f of readdirSync(d)) if (/^seg_\d+\.ts$|^segmentos_\d+\.csv$/.test(f)) rmSync(join(d, f), { force: true })
      // Miniaturas dos momentos desta live
      rmSync(join(d, 'miniaturas'), { recursive: true, force: true })
      try {
        if (!readdirSync(d).length) rmdirSync(d)
        // A pasta do canal (ex.: twitch_fulano) também sai se ficou vazia
        const parent = dirname(d)
        if (existsSync(parent) && !readdirSync(parent).length) rmdirSync(parent)
      } catch {
        // pasta em uso
      }
    }
    this.db.prepare('DELETE FROM lives WHERE id = ?').run(liveId)
    // Canal que só existia por causa da importação sai junto
    this.db.prepare(`DELETE FROM channels WHERE id = ? AND origin = 'import' AND NOT EXISTS (SELECT 1 FROM lives WHERE channel_id = ?)`).run(r.channel_id, r.channel_id)
    this.log.info('biblioteca', `Apagado: ${r.kind === 'vod' ? 'VOD' : 'live'} de ${r.display_name ?? r.login} (${paths.length} pedaço(s)).`)
    this.emitSoon()
  }

  private emitTimer: NodeJS.Timeout | null = null
  emitSoon(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.emit('lives')
    }, 400)
  }
}

