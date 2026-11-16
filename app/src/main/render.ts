import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { Db } from './db'
import type { JobContext, JobQueue } from './jobs'
import type { Logger } from './logs'
import { cpuFallback, encoderArgs, fitEncoder } from './encode'
import { pickEncoder } from '../shared/encoders'
import { formatTimecode } from '../shared/vod'
import { channelUrl } from '../shared/channels'
import {
  buildClipAss,
  cleanRect,
  clipFileName,
  clipQuality,
  clipRange,
  clipSize,
  layoutPlan,
  planParts,
  toClipTime,
  type Part,
  type Word
} from '../shared/clips'
import type { ClipDraft, ClipLayout, ClipOptions, ClipRecord, EncoderInfo, Platform, Rect, Settings } from '../shared/types'

export interface ClipDeps {
  db: Db
  log: Logger
  queue: JobQueue
  settings: () => Settings
  tools: () => { ffmpeg: string; ffprobe: string } | null
  encoders: () => EncoderInfo[]
  clipsRoot: () => string
  /** A IA de texto está configurada (então os automáticos esperam o título dela) */
  aiReady: () => boolean
}

interface MomentRow {
  id: number
  live_id: number
  start_utc: number
  end_utc: number
  peak_utc: number
  score: number
  ai: string | null
  signals: string
  status: string
  started_at: number
  kind: 'live' | 'vod'
  source_url: string | null
  channel_id: number
  platform: Platform
  login: string
  channel: string
  facecam: string | null
}

interface ClipRow {
  id: number
  moment_id: number | null
  live_id: number | null
  channel: string
  title: string
  title_en: string
  hashtags: string
  options: string
  layout: string
  status: string
  error: string | null
  path: string | null
  duration_s: number
  width: number | null
  height: number | null
  size_bytes: number | null
  auto: number
  job_id: number | null
  created_at: number
  progress: number | null
}

interface AiJson {
  keep?: boolean
  title_pt?: string
  title_en?: string
  hashtags?: string[]
}

interface Source {
  w: number
  h: number
  fps: number
  audio: boolean
}

const parse = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback
  } catch {
    return fallback
  }
}

/** Caminho dentro de um filtro do ffmpeg (aspas e ":" escapados) */
const ffPath = (p: string) => `'${p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''")}'`
const FONTS = join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts')

/**
 * Gera os clipes: junta os pedaços gravados do trecho, enquadra no layout (vertical ou horizontal),
 * queima a legenda palavra a palavra e o título, normaliza o volume e codifica (placa primeiro, processador de reserva).
 */
export class ClipService extends EventEmitter {
  constructor(private d: ClipDeps) {
    super()
    d.queue.register('clip:render', 'gpu', (p, ctx) => this.run((p as { clipId: number }).clipId, ctx))
  }

  private get db() {
    return this.d.db
  }

  private moment(id: number): MomentRow | null {
    return (
      (this.db
        .prepare(
          `SELECT m.id, m.live_id, m.start_utc, m.end_utc, m.peak_utc, m.score, m.ai, m.signals, m.status,
                  l.started_at, l.kind, l.source_url, l.channel_id, c.platform, c.login, COALESCE(c.display_name, c.login) AS channel, c.facecam
           FROM moments m JOIN lives l ON l.id = m.live_id JOIN channels c ON c.id = l.channel_id WHERE m.id = ?`
        )
        .get(id) as MomentRow | undefined) ?? null
    )
  }

  private segs(liveId: number): { path: string; startUtc: number; durS: number }[] {
    return (
      this.db
        .prepare(`SELECT path, start_utc, duration_s FROM segments WHERE live_id = ? AND status != 'deleted' AND duration_s > 0 ORDER BY start_utc`)
        .all(liveId) as { path: string; start_utc: number; duration_s: number }[]
    )
      .filter((s) => existsSync(s.path))
      .map((s) => ({ path: s.path, startUtc: s.start_utc, durS: s.duration_s }))
  }

  /** Opções padrão para um momento (ou as do último clipe dele, para refazer). */
  draft(momentId: number): ClipDraft {
    const m = this.moment(momentId)
    if (!m) throw new Error('Momento não encontrado.')
    const s = this.d.settings()
    const segs = this.segs(m.live_id)
    if (!segs.length) throw new Error('Os pedaços gravados desta live não existem mais.')
    const avail = { fromUtc: segs[0].startUtc, toUtc: segs[segs.length - 1].startUtc + segs[segs.length - 1].durS * 1000 }
    const ai = parse<AiJson | null>(m.ai, null)
    const titlePt = ai?.title_pt ?? ''
    const titleEn = ai?.title_en ?? ''
    const prev = this.db.prepare('SELECT id, options FROM clips WHERE moment_id = ? ORDER BY id DESC LIMIT 1').get(momentId) as
      | { id: number; options: string }
      | undefined
    let options: ClipOptions
    if (prev) options = parse<ClipOptions>(prev.options, null as unknown as ClipOptions)
    else {
      const r = clipRange(
        { startUtc: m.start_utc, endUtc: m.end_utc, peakUtc: m.peak_utc },
        { padBeforeS: s.clips.padBeforeS, padAfterS: s.clips.padAfterS, maxS: s.clips.maxDurationS },
        avail
      )
      options = {
        layout: s.clips.layout,
        startS: (r.fromUtc - m.started_at) / 1000,
        endS: (r.toUtc - m.started_at) / 1000,
        captions: s.clips.captions.enabled,
        title: s.clips.title.enabled ? (s.clips.title.lang === 'en' ? titleEn || titlePt : titlePt || titleEn) : '',
        preset: s.quality.preset,
        cropX: 0.5
      }
    }
    return {
      momentId,
      channelId: m.channel_id,
      channelName: m.channel,
      options,
      facecam: cleanRect(parse<Rect | null>(m.facecam, null)),
      minS: (avail.fromUtc - m.started_at) / 1000,
      maxS: (avail.toUtc - m.started_at) / 1000,
      titlePt,
      titleEn,
      clipId: prev?.id ?? null
    }
  }

  setFacecam(channelId: number, rect: Rect | null): void {
    const r = cleanRect(rect)
    this.db.prepare('UPDATE channels SET facecam = ? WHERE id = ?').run(r ? JSON.stringify(r) : null, channelId)
    this.d.log.info('clipes', r ? 'Facecam do canal marcada.' : 'Facecam do canal apagada.')
  }

  /** Lê tamanho, fps e se tem áudio do primeiro pedaço. */
  private probe(ffprobe: string, file: string): Promise<Source> {
    return new Promise((resolve, reject) => {
      const p = spawn(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate', '-of', 'json', file], { windowsHide: true })
      let out = ''
      p.stdout.on('data', (d) => (out += d))
      p.on('error', reject)
      p.on('close', () => {
        const streams = parse<{ streams?: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string }[] }>(out, {}).streams ?? []
        const v = streams.find((x) => x.codec_type === 'video' && x.width)
        if (!v) return reject(new Error('Não deu para ler o vídeo do pedaço gravado.'))
        const [a, b] = (v.avg_frame_rate ?? '30/1').split('/').map(Number)
        const fps = a && b ? a / b : 30
        resolve({ w: v.width!, h: v.height!, fps: fps > 0 && fps < 240 ? fps : 30, audio: streams.some((x) => x.codec_type === 'audio') })
      })
    })
  }

  /** Palavras faladas no trecho, já no tempo do clipe. */
  private clipWords(liveId: number, parts: Part[], fromUtc: number, toUtc: number): Word[] {
    const rows = this.db
      .prepare('SELECT t_ms, end_ms, word FROM speech_words WHERE live_id = ? AND t_ms >= ? AND t_ms < ? ORDER BY t_ms')
      .all(liveId, fromUtc - 1500, toUtc) as { t_ms: number; end_ms: number; word: string }[]
    const out: Word[] = []
    for (const r of rows) {
      const start = toClipTime(parts, Math.max(r.t_ms, fromUtc))
      if (start == null) continue
      const end = toClipTime(parts, Math.min(r.end_ms, toUtc)) ?? start + 0.3
      out.push({ text: r.word, start, end: Math.max(end, start + 0.05) })
    }
    return out
  }

  /** Tudo o que o ffmpeg precisa para este clipe (usado pela prévia e pelo arquivo final). */
  private async build(m: MomentRow, o: ClipOptions) {
    const tools = this.d.tools()
    if (!tools) throw new Error('FFmpeg não encontrado.')
    const s = this.d.settings()
    const fromUtc = Math.round(m.started_at + o.startS * 1000)
    const toUtc = Math.round(m.started_at + o.endS * 1000)
    if (toUtc - fromUtc < 1000) throw new Error('O trecho do clipe está vazio (confira início e fim).')
    const parts = planParts(this.segs(m.live_id), fromUtc, toUtc)
    if (!parts.length) throw new Error('Os pedaços gravados deste trecho não existem mais.')
    const src = await this.probe(tools.ffprobe, parts[0].file)
    const size = clipSize(o.layout, o.preset, src.h)
    const plan = layoutPlan(o.layout, src, size, cleanRect(parse<Rect | null>(m.facecam, null)), o.cropX)
    const quality = clipQuality(o.preset)
    const fps = src.fps > quality.maxFps + 1 ? quality.maxFps : Math.round(src.fps * 1000) / 1000
    const duration = parts.reduce((a, p) => a + p.durS, 0)
    const words = o.captions ? this.clipWords(m.live_id, parts, fromUtc, toUtc) : []
    const caption = s.clips.captions
    const assFor = (shift = 0, titleAlways = plan.title.always) =>
      buildClipAss({
        W: size.W,
        H: size.H,
        duration,
        captions: o.captions
          ? {
              words: words.map((w) => ({ ...w, start: w.start - shift, end: w.end - shift })),
              perGroup: caption.words,
              upper: caption.upper,
              color: caption.color,
              sizePct: caption.sizePct,
              y: plan.captionY
            }
          : null,
        title: o.title.trim() ? { text: o.title, y: plan.title.y, align: plan.title.align, always: titleAlways } : null
      })
    return { tools, parts, src, size, plan, quality, fps, duration, words, assFor, fromUtc, toUtc }
  }

  /** Um quadro do clipe no instante do pico, com layout, título e a legenda daquele momento. */
  async preview(momentId: number, o: ClipOptions): Promise<string> {
    const m = this.moment(momentId)
    if (!m) throw new Error('Momento não encontrado.')
    const b = await this.build(m, o)
    const peakUtc = Math.min(Math.max(m.peak_utc, b.fromUtc), b.toUtc - 100)
    const t = toClipTime(b.parts, peakUtc) ?? 0
    // Acha o pedaço e o ponto dentro dele que correspondem a t
    let acc = 0
    let part = b.parts[0]
    for (const p of b.parts) {
      if (t < acc + p.durS) {
        part = p
        break
      }
      acc += p.durS
    }
    const at = part.inS + Math.max(0, t - acc)
    const tmp = join(tmpdir(), `clipador-previa-${randomUUID()}`)
    const ass = `${tmp}.ass`
    const jpg = `${tmp}.jpg`
    // Na prévia o título aparece sempre e a legenda é a do instante mostrado (tempo deslocado para 0)
    writeFileSync(ass, b.assFor(t, true), 'utf8')
    const vf = b.plan.graph.replace('[in]', '[0:v:0]').replace('[out]', '[vl]') + `;[vl]subtitles=filename=${ffPath(ass)}:fontsdir=${ffPath(FONTS)},scale=iw/2:-2[v]`
    try {
      await runFfmpeg(b.tools.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-ss', at.toFixed(3), '-i', part.file, '-filter_complex', vf, '-map', '[v]', '-frames:v', '1', '-q:v', '3', jpg])
      return `data:image/jpeg;base64,${readFileSync(jpg).toString('base64')}`
    } finally {
      rmSync(ass, { force: true })
      rmSync(jpg, { force: true })
    }
  }

  /** Quadro inteiro do lance, para marcar a facecam. */
  async frame(momentId: number): Promise<string> {
    const m = this.moment(momentId)
    if (!m) throw new Error('Momento não encontrado.')
    const tools = this.d.tools()
    if (!tools) throw new Error('FFmpeg não encontrado.')
    const parts = planParts(this.segs(m.live_id), m.peak_utc, m.peak_utc + 1000)
    if (!parts.length) throw new Error('O pedaço gravado deste momento não existe mais.')
    const jpg = join(tmpdir(), `clipador-quadro-${randomUUID()}.jpg`)
    try {
      await runFfmpeg(tools.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-ss', parts[0].inS.toFixed(3), '-i', parts[0].file, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', jpg])
      return `data:image/jpeg;base64,${readFileSync(jpg).toString('base64')}`
    } finally {
      rmSync(jpg, { force: true })
    }
  }

  /** Põe um clipe na fila. O momento passa a "guardado" e não some quando a detecção roda de novo. */
  request(momentId: number, o: ClipOptions, auto = false): ClipRecord {
    const m = this.moment(momentId)
    if (!m) throw new Error('Momento não encontrado.')
    const ai = parse<AiJson | null>(m.ai, null)
    const opts: ClipOptions = {
      layout: (['split', 'blur', 'crop', 'full'] as ClipLayout[]).includes(o.layout) ? o.layout : 'blur',
      startS: Number(o.startS) || 0,
      endS: Number(o.endS) || 0,
      captions: !!o.captions,
      title: String(o.title ?? '').slice(0, 200),
      preset: (['fast', 'balanced', 'max'] as const).includes(o.preset) ? o.preset : 'balanced',
      cropX: Number.isFinite(o.cropX) ? Math.min(1, Math.max(0, o.cropX)) : 0.5
    }
    const label = opts.title || ai?.title_pt || `momento em ${formatTimecode((m.peak_utc - m.started_at) / 1000)}`
    const row = this.db
      .prepare(
        `INSERT INTO clips(moment_id, live_id, channel, title, title_en, hashtags, options, layout, status, auto, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?) RETURNING id`
      )
      .get(m.id, m.live_id, m.channel, label, ai?.title_en ?? '', JSON.stringify(ai?.hashtags ?? []), JSON.stringify(opts), opts.layout, auto ? 1 : 0, Date.now()) as {
      id: number
    }
    const job = this.d.queue.enqueue('clip:render', `Gerar clipe: ${m.channel} · ${label}`.slice(0, 120), { clipId: row.id }, { maxAttempts: 2 })
    this.db.prepare('UPDATE clips SET job_id = ? WHERE id = ?').run(job.id, row.id)
    // Um clipe por momento: refazer substitui o anterior
    const old = this.db.prepare('SELECT id FROM clips WHERE moment_id = ? AND id != ?').all(m.id, row.id) as { id: number }[]
    for (const x of old) this.delete(x.id)
    this.db.prepare(`UPDATE moments SET status = 'kept' WHERE id = ? AND status = 'new'`).run(m.id)
    this.emit('clips')
    return this.get(row.id)!
  }

  /**
   * Depois da detecção: gera sozinho os clipes dos momentos fortes (nota mínima dos Ajustes).
   * Com a IA configurada, espera o título dela (menos quando foi clipado pela comunidade ou pedido por voz).
   * Durante a gravação só pega lances que já terminaram há 90 s (o trecho não cresce mais).
   */
  autoForLive(liveId: number, recording: boolean): number {
    const s = this.d.settings()
    if (!s.clips.auto.enabled) return 0
    const segs = this.segs(liveId)
    if (!segs.length) return 0
    const lastEnd = segs[segs.length - 1].startUtc + segs[segs.length - 1].durS * 1000
    const rows = this.db
      .prepare(`SELECT id, end_utc, score, ai, signals FROM moments WHERE live_id = ? AND status = 'new' AND score >= ? ORDER BY score DESC LIMIT 20`)
      .all(liveId, s.clips.auto.minScore) as { id: number; end_utc: number; score: number; ai: string | null; signals: string }[]
    const waitAi = this.d.aiReady() && s.detectors.aiText.enabled
    let n = 0
    for (const r of rows) {
      const sig = parse<{ clip?: unknown; voice?: unknown }>(r.signals, {})
      const human = !!(sig.clip || sig.voice)
      const ai = parse<AiJson | null>(r.ai, null)
      if (ai && ai.keep === false && !human) continue
      if (!ai && waitAi && !human) continue
      if (recording && r.end_utc > lastEnd - 90_000) continue
      try {
        this.request(r.id, this.draft(r.id).options, true)
        n++
      } catch (e) {
        this.d.log.warn('clipes', `Clipe automático não foi para a fila: ${(e as Error).message}`)
      }
    }
    if (n) this.d.log.info('clipes', `${n} clipe(s) automático(s) na fila (nota ≥ ${s.clips.auto.minScore}).`)
    return n
  }

  private async run(clipId: number, ctx: JobContext): Promise<unknown> {
    const c = this.db.prepare('SELECT * FROM clips WHERE id = ?').get(clipId) as ClipRow | undefined
    if (!c) return null
    const fail = (msg: string) => {
      this.db.prepare(`UPDATE clips SET status = 'failed', error = ? WHERE id = ?`).run(msg, clipId)
      this.emit('clips')
      return new Error(msg)
    }
    if (c.moment_id == null) throw fail('O momento deste clipe foi apagado (a gravação de origem não existe mais).')
    const m = this.moment(c.moment_id)
    if (!m) throw fail('Momento não encontrado.')
    const o = parse<ClipOptions>(c.options, null as unknown as ClipOptions)
    this.db.prepare(`UPDATE clips SET status = 'rendering', error = NULL WHERE id = ?`).run(clipId)
    this.emit('clips')

    let b: Awaited<ReturnType<ClipService['build']>>
    try {
      b = await this.build(m, o)
    } catch (e) {
      throw fail((e as Error).message)
    }
    const s = this.d.settings()
    const dir = join(this.d.clipsRoot(), safeDir(m.channel))
    mkdirSync(dir, { recursive: true })
    const out = join(dir, clipFileName(m.channel, m.started_at, c.title, clipId))
    const partial = out.replace(/\.mp4$/, '.parcial.mp4')
    const ass = join(tmpdir(), `clipador-legenda-${clipId}-${randomUUID()}.ass`)
    writeFileSync(ass, b.assFor(), 'utf8')

    const n = b.parts.length
    const g: string[] = []
    b.parts.forEach((_, i) => {
      // Pedaços com tamanho diferente (a live mudou de resolução) são igualados ao primeiro
      g.push(`[${i}:v:0]${n > 1 ? `scale=${b.src.w}:${b.src.h},setsar=1,` : ''}fps=${b.fps}[v${i}]`)
      if (b.src.audio) g.push(`[${i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`)
    })
    let vIn = '[v0]'
    let aIn = '[a0]'
    if (n > 1) {
      g.push(`${b.parts.map((_, i) => `[v${i}]` + (b.src.audio ? `[a${i}]` : '')).join('')}concat=n=${n}:v=1:a=${b.src.audio ? 1 : 0}[vc]${b.src.audio ? '[ac]' : ''}`)
      vIn = '[vc]'
      aIn = '[ac]'
    }
    g.push(b.plan.graph.replace('[in]', vIn).replace('[out]', '[vl]'))
    g.push(`[vl]subtitles=filename=${ffPath(ass)}:fontsdir=${ffPath(FONTS)},format=yuv420p[vout]`)
    // Volume no padrão das redes (~-14 LUFS), sem estourar
    if (b.src.audio) g.push(`${aIn}loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`)

    const inputs = b.parts.flatMap((p) => ['-ss', p.inS.toFixed(3), '-t', p.durS.toFixed(3), '-i', p.file])
    const encoders = this.d.encoders()
    let encoder = fitEncoder(pickEncoder(encoders, s.quality.encoder, o.preset) ?? 'libx264', b.size.W, b.size.H)
    const argsFor = (enc: string) => [
      '-hide_banner',
      '-y',
      '-nostdin',
      ...inputs,
      '-filter_complex',
      g.join(';'),
      '-map',
      '[vout]',
      ...(b.src.audio ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
      ...encoderArgs(enc, b.quality.q),
      '-movflags',
      '+faststart',
      '-t',
      b.duration.toFixed(3),
      '-progress',
      'pipe:1',
      '-nostats',
      partial
    ]
    const started = Date.now()
    try {
      try {
        await runFfmpeg(b.tools.ffmpeg, argsFor(encoder), { signal: ctx.signal, total: b.duration, onProgress: (p) => ctx.progress(p * 0.97) })
      } catch (e) {
        if (ctx.signal.aborted) throw e
        const cpu = cpuFallback(encoder)
        if (cpu === encoder) throw e
        // Placa recusou (tamanho, driver ocupado…): tenta no processador
        this.d.log.warn('clipes', `${encoder} falhou (${(e as Error).message.slice(0, 160)}); gerando com ${cpu}.`)
        encoder = cpu
        await runFfmpeg(b.tools.ffmpeg, argsFor(encoder), { signal: ctx.signal, total: b.duration, onProgress: (p) => ctx.progress(p * 0.97) })
      }
      rmSync(out, { force: true })
      renameSync(partial, out)
    } catch (e) {
      rmSync(partial, { force: true })
      const closing = ctx.signal.aborted && (ctx.signal.reason as Error)?.message === 'app-closing'
      if (closing) {
        this.db.prepare(`UPDATE clips SET status = 'queued' WHERE id = ?`).run(clipId)
        this.emit('clips')
        throw e
      }
      throw fail(ctx.signal.aborted ? 'Cancelado.' : (e as Error).message)
    } finally {
      rmSync(ass, { force: true })
    }

    // Texto para postar: títulos, hashtags e créditos ao streamer
    const tags = parse<string[]>(c.hashtags, [])
    const credit = channelUrl(m.platform, m.login)
    const origin = m.kind === 'vod' && m.source_url ? m.source_url : credit
    writeFileSync(
      out.replace(/\.mp4$/, '.txt'),
      [
        `Título: ${c.title}`,
        c.title_en ? `Title (EN): ${c.title_en}` : '',
        '',
        tags.map((t) => `#${t.replace(/^#/, '').replace(/\s+/g, '')}`).join(' '),
        '',
        `Créditos: ${credit}`,
        `Origem: ${origin} (${formatTimecode(o.startS)} – ${formatTimecode(o.endS)})`,
        `Momento: nota ${m.score}`,
        ...parse<{ reasons?: string[] }>(m.signals, {}).reasons?.map((r) => `- ${r}`) ?? []
      ]
        .filter((l, i, a) => l !== '' || a[i - 1] !== '')
        .join('\r\n'),
      'utf8'
    )
    const size = statSync(out).size
    this.db
      .prepare(`UPDATE clips SET status = 'ready', path = ?, duration_s = ?, width = ?, height = ?, size_bytes = ?, layout = ?, error = NULL WHERE id = ?`)
      .run(out, b.duration, b.size.W, b.size.H, size, b.plan.layout, clipId)
    const secs = (Date.now() - started) / 1000
    this.d.log.info(
      'clipes',
      `Clipe pronto: ${c.title} (${b.size.W}×${b.size.H}, ${b.duration.toFixed(1)} s, ${(size / 1024 ** 2).toFixed(1)} MB, ${encoder}, ${secs.toFixed(1)} s).`
    )
    ctx.progress(1)
    this.emit('clips')
    this.emit('ready', this.get(clipId))
    return { path: out, encoder, seconds: secs }
  }

  get(id: number): ClipRecord | null {
    return this.list(undefined, id)[0] ?? null
  }

  list(liveId?: number, id?: number): ClipRecord[] {
    const where = id != null ? 'WHERE c.id = ?' : liveId != null ? 'WHERE c.live_id = ?' : ''
    const rows = this.db
      .prepare(`SELECT c.*, j.progress AS progress FROM clips c LEFT JOIN jobs j ON j.id = c.job_id ${where} ORDER BY c.id DESC LIMIT 500`)
      .all(...(id != null ? [id] : liveId != null ? [liveId] : [])) as unknown as ClipRow[]
    return rows.map((r) => ({
      id: r.id,
      momentId: r.moment_id,
      liveId: r.live_id,
      channelName: r.channel,
      title: r.title,
      titleEn: r.title_en,
      hashtags: parse<string[]>(r.hashtags, []),
      options: parse<ClipOptions>(r.options, null as unknown as ClipOptions),
      layout: r.layout as ClipLayout,
      status: r.status as ClipRecord['status'],
      progress: r.status === 'rendering' ? (r.progress ?? 0) : null,
      error: r.error,
      path: r.path && existsSync(r.path) ? r.path : null,
      durationS: r.duration_s,
      width: r.width,
      height: r.height,
      sizeBytes: r.size_bytes,
      auto: !!r.auto,
      jobId: r.job_id,
      createdAt: r.created_at
    }))
  }

  pathOf(id: number): string | null {
    const r = this.db.prepare('SELECT path FROM clips WHERE id = ?').get(id) as { path: string | null } | undefined
    return r?.path && existsSync(r.path) ? r.path : null
  }

  /** Apaga o clipe (arquivo, texto e registro); o momento volta a ficar disponível. */
  delete(id: number): void {
    const r = this.db.prepare('SELECT path, moment_id, job_id, status FROM clips WHERE id = ?').get(id) as
      | { path: string | null; moment_id: number | null; job_id: number | null; status: string }
      | undefined
    if (!r) return
    if (r.job_id != null && (r.status === 'queued' || r.status === 'rendering')) this.d.queue.cancel(r.job_id)
    if (r.path) {
      rmSync(r.path, { force: true })
      rmSync(r.path.replace(/\.mp4$/, '.txt'), { force: true })
    }
    this.db.prepare('DELETE FROM clips WHERE id = ?').run(id)
    if (r.moment_id != null) {
      const others = this.db.prepare('SELECT 1 FROM clips WHERE moment_id = ?').get(r.moment_id)
      if (!others) this.db.prepare(`UPDATE moments SET status = 'new' WHERE id = ? AND status = 'kept'`).run(r.moment_id)
    }
    this.emit('clips')
  }
}

/** Nome de pasta do canal (sem caracteres proibidos no Windows) */
function safeDir(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '').trim() || 'canal'
}

/** Roda o ffmpeg; com `total`, lê o progresso (out_time) e informa de 0 a 1. */
function runFfmpeg(ffmpeg: string, args: string[], o: { signal?: AbortSignal; total?: number; onProgress?: (p: number) => void } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args, { windowsHide: true })
    const tail: string[] = []
    let buf = ''
    p.stdout.on('data', (d: Buffer) => {
      buf += d.toString('utf8')
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const l of lines) {
        const m = l.match(/^out_time_us=(\d+)/)
        if (m && o.total && o.onProgress) o.onProgress(Math.min(1, Number(m[1]) / 1e6 / o.total))
      }
    })
    p.stderr.on('data', (d: Buffer) => {
      for (const l of d.toString('utf8').split(/\r?\n/)) {
        if (!l.trim()) continue
        tail.push(l)
        if (tail.length > 30) tail.shift()
      }
    })
    const onAbort = () => p.kill()
    o.signal?.addEventListener('abort', onAbort)
    p.on('error', reject)
    p.on('close', (code) => {
      o.signal?.removeEventListener('abort', onAbort)
      if (o.signal?.aborted) return reject(o.signal.reason)
      if (code !== 0) return reject(new Error(tail.filter((l) => !/^\s*(Stream|Input|Output|Metadata|Duration|encoder|major_brand)/.test(l)).slice(-3).join(' | ') || `ffmpeg saiu com código ${code}`))
      resolve()
    })
  })
}
