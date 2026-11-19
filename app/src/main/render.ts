import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, join } from 'path'
import { randomUUID } from 'crypto'
import type { Db } from './db'
import type { JobContext, JobQueue } from './jobs'
import type { Logger } from './logs'
import { cpuFallback, encoderArgs, fitEncoder } from './encode'
import { pickEncoder } from '../shared/encoders'
import { formatTimecode } from '../shared/vod'
import { channelUrl } from '../shared/channels'
import { gameAt, modalityAt } from './games'
import { LIMITS, postFile, postTexts, type PostTexts } from '../shared/post'
import { modalityPreset } from '../shared/settings'
import {
  buildClipAss,
  cleanRect,
  clipFileName,
  clipQuality,
  clipRange,
  clipSize,
  cropXForCenter,
  layoutPlan,
  planParts,
  silenceCuts,
  snapToSpeech,
  toClipTime,
  type Part,
  type SpokenWord,
  type Word
} from '../shared/clips'
import { geminiVisionJson } from './ai/gemini'
import { FACECAM_SCHEMA, FACECAM_SYSTEM, facecamFromAnswer, type FacecamAnswer } from './ai/facecam'
import type { ClipDraft, ClipLayout, ClipOptions, ClipRecord, ClipReview, EncoderInfo, Platform, Rect, Settings } from '../shared/types'

export interface ClipDeps {
  db: Db
  log: Logger
  queue: JobQueue
  settings: () => Settings
  tools: () => { ffmpeg: string; ffprobe: string } | null
  encoders: () => EncoderInfo[]
  clipsRoot: () => string
  /** Pasta "para postar" (cópias dos aprovados, por dia) */
  exportRoot: () => string
  /** Pasta das capas (miniaturas verticais) dos clipes */
  cacheDir: string
  /** A IA de texto está configurada (então os automáticos esperam o título dela) */
  aiReady: () => boolean
  /** Gemini para ver imagens (achar a facecam); as reservas são só texto */
  vision?: () => { key: string; model: string } | null
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
  crop_x: number | null
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
  review: string
  m_score: number | null
  m_ai: string | null
  m_signals: string | null
  m_peak: number | null
  exported_path: string | null
  posted: string | null
  ch_platform: Platform | null
  ch_login: string | null
  post_custom: string | null
}

interface AiJson {
  keep?: boolean
  title_pt?: string
  title_en?: string
  hashtags?: string[]
  /** Começo e fim do corte escolhidos pela IA (hora real, ms) */
  clip_from_utc?: number
  clip_to_utc?: number
}

/** Teto do corte escolhido pela IA: ela pode passar do máximo da modalidade para não cortar a história, até este limite (s). */
const AI_CUT_MAX_S = 150

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
                  l.started_at, l.kind, l.source_url, l.channel_id, c.platform, c.login, COALESCE(c.display_name, c.login) AS channel, c.facecam, c.crop_x
           FROM moments m JOIN lives l ON l.id = m.live_id JOIN channels c ON c.id = l.channel_id WHERE m.id = ?`
        )
        .get(id) as MomentRow | undefined) ?? null
    )
  }

  /**
   * Trecho do clipe: o que a IA escolheu (história completa, do começo até a reação) quando houver;
   * senão, a janela do lance com as margens e a duração da modalidade.
   */
  private rangeFor(m: MomentRow, s: Settings, avail: { fromUtc: number; toUtc: number }): { fromUtc: number; toUtc: number } {
    const p = modalityPreset(s, modalityAt(this.db, m.live_id, m.peak_utc))
    const ai = parse<AiJson | null>(m.ai, null)
    const a = ai?.clip_from_utc
    const b = ai?.clip_to_utc
    if (a && b && b > a) {
      const fromUtc = Math.max(avail.fromUtc, a - 500)
      // Teto do corte da IA: 2:30 (pedido do usuário), mesmo acima do máximo da modalidade, para não cortar a história
      const cap = AI_CUT_MAX_S
      const toUtc = Math.min(avail.toUtc, b + 800, fromUtc + cap * 1000)
      if (toUtc - fromUtc >= Math.min(15, p?.minDurationS ?? 15) * 1000) return this.snap(m.live_id, s, { fromUtc, toUtc }, avail)
    }
    return this.snap(
      m.live_id,
      s,
      clipRange(
        { startUtc: m.start_utc, endUtc: m.end_utc, peakUtc: m.peak_utc },
        p
          ? { padBeforeS: p.padBeforeS, padAfterS: p.padAfterS, maxS: p.maxDurationS, minS: p.minDurationS }
          : { padBeforeS: s.clips.padBeforeS, padAfterS: s.clips.padAfterS, maxS: s.clips.maxDurationS },
        avail
      ),
      avail
    )
  }

  /** Palavras faladas (hora real) num trecho da live */
  private spoken(liveId: number, fromUtc: number, toUtc: number): SpokenWord[] {
    return (
      this.db.prepare('SELECT t_ms, end_ms FROM speech_words WHERE live_id = ? AND end_ms > ? AND t_ms < ? ORDER BY t_ms').all(liveId, fromUtc, toUtc) as {
        t_ms: number
        end_ms: number
      }[]
    ).map((w) => ({ t: w.t_ms, end: w.end_ms }))
  }

  /** Começo e fim encaixados na fala (Ajustes > Corte), sem passar do que foi gravado */
  private snap(liveId: number, s: Settings, r: { fromUtc: number; toUtc: number }, avail: { fromUtc: number; toUtc: number }): { fromUtc: number; toUtc: number } {
    if (!s.clips.snapToSpeech) return r
    const x = snapToSpeech(r.fromUtc, r.toUtc, this.spoken(liveId, r.fromUtc - 4000, r.toUtc + 4000))
    return { fromUtc: Math.max(avail.fromUtc, x.fromUtc), toUtc: Math.min(avail.toUtc, x.toUtc) }
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
      // Com os padrões por modalidade ligados, a categoria do lance escolhe layout e duração (conversa pede mais contexto)
      const p = modalityPreset(s, modalityAt(this.db, m.live_id, m.peak_utc))
      const r = this.rangeFor(m, s, avail)
      options = {
        layout: p?.layout ?? s.clips.layout,
        startS: (r.fromUtc - m.started_at) / 1000,
        endS: (r.toUtc - m.started_at) / 1000,
        captions: s.clips.captions.enabled,
        title: s.clips.title.enabled ? (s.clips.title.lang === 'en' ? titleEn || titlePt : titlePt || titleEn) : '',
        preset: s.quality.preset,
        cropX: defaultCropX(m)
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

  /** Canais em que a busca automática da facecam já foi feita (não pergunta de novo a cada clipe; vale até reiniciar o app) */
  private facecamTried = new Map<number, number>()

  /**
   * A KaTY olha 3 quadros da live (o do lance e mais dois em outros horários) e acha a facecam, que fica no mesmo lugar em todos.
   * Achou: guarda no canal. `manual` = pedido pelo botão (sempre tenta); automático tenta uma vez a cada 6 h por canal.
   */
  async detectFacecam(momentId: number, manual: boolean, signal?: AbortSignal): Promise<{ rect: Rect | null; why: string }> {
    const m = this.moment(momentId)
    if (!m) return { rect: null, why: 'Momento não encontrado.' }
    const g = this.d.vision?.()
    if (!g) return { rect: null, why: 'Precisa da chave do Gemini (Configurações > KaTY e IA): só ele enxerga imagem.' }
    const last = this.facecamTried.get(m.channel_id) ?? 0
    if (!manual && Date.now() - last < 6 * 3600_000) return { rect: null, why: 'Já tentou há pouco neste canal.' }
    this.facecamTried.set(m.channel_id, Date.now())
    const segs = this.segs(m.live_id)
    if (!segs.length) return { rect: null, why: 'A gravação desta live não existe mais.' }
    const a = segs[0].startUtc
    const z = segs[segs.length - 1].startUtc + segs[segs.length - 1].durS * 1000
    // Quadro do lance e dois longe dele: a webcam fica parada, o jogo muda
    const times = [m.peak_utc, a + (z - a) * 0.25, a + (z - a) * 0.75].map((t) => Math.round(Math.min(z - 1500, Math.max(a + 500, t))))
    const frames: string[] = []
    for (const t of times) {
      const f = await this.frameAt(segs, t).catch(() => null)
      if (f) frames.push(f)
    }
    if (!frames.length) return { rect: null, why: 'Não deu para tirar quadros da gravação.' }
    try {
      const ans = await geminiVisionJson<FacecamAnswer>(
        g.key,
        g.model,
        FACECAM_SYSTEM,
        `São ${frames.length} quadros da live de ${m.channel}, em horários diferentes. Ache a facecam.`,
        frames,
        FACECAM_SCHEMA,
        signal
      )
      const r = facecamFromAnswer(ans)
      if (r.rect) {
        this.setFacecam(m.channel_id, r.rect)
        this.d.log.info('clipes', `A KaTY achou a facecam de ${m.channel} (${Math.round(r.rect.w * 100)}% × ${Math.round(r.rect.h * 100)}% do quadro).`)
      } else if (manual) this.d.log.info('clipes', `A KaTY não achou facecam em ${m.channel}: ${r.why}`)
      return r
    } catch (e) {
      return { rect: null, why: `A KaTY não conseguiu olhar os quadros: ${(e as Error).message}` }
    }
  }

  /** Um quadro da gravação num instante (JPEG em base64, 1280 de largura) */
  private async frameAt(segs: { path: string; startUtc: number; durS: number }[], utc: number): Promise<string> {
    const tools = this.d.tools()
    if (!tools) throw new Error('FFmpeg não encontrado.')
    const parts = planParts(segs, utc, utc + 1000)
    if (!parts.length) throw new Error('Sem gravação neste instante.')
    const jpg = join(tmpdir(), `clipador-quadro-${randomUUID()}.jpg`)
    try {
      await runFfmpeg(tools.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-ss', parts[0].inS.toFixed(3), '-i', parts[0].file, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '4', jpg])
      return readFileSync(jpg).toString('base64')
    } finally {
      rmSync(jpg, { force: true })
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
    const segs = this.segs(m.live_id)
    // Tirar as pausas longas de dentro do corte (Ajustes > Corte): em conversa pela fala; em jogo só onde o som também está baixo
    const keep = this.keepRanges(m, s, fromUtc, toUtc)
    const parts = keep.flatMap((r) => planParts(segs, r.fromUtc, r.toUtc))
    if (!parts.length) throw new Error('Os pedaços gravados deste trecho não existem mais.')
    const trimmed = keep.length > 1
    const src = await this.probe(tools.ffprobe, parts[0].file)
    const size = clipSize(o.layout, o.preset, src.h)
    const plan = layoutPlan(o.layout, src, size, cleanRect(parse<Rect | null>(m.facecam, null)), o.cropX, s.clips.facecamPct)
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
              // Subir ou descer a legenda (Ajustes > Visual), sem sair da tela
              y: Math.round(Math.min(size.H * 0.94, Math.max(size.H * 0.06, plan.captionY + (size.H * (caption.offsetPct ?? 0)) / 100))),
              font: caption.font,
              baseColor: caption.baseColor,
              outline: caption.outline
            }
          : null,
        title: o.title.trim()
          ? { text: o.title, y: plan.title.y, align: plan.title.align, always: titleAlways, seconds: s.clips.title.seconds, style: s.clips.title.style }
          : null
      })
    return { tools, parts, src, size, plan, quality, fps, duration, words, assFor, fromUtc, toUtc, trimmed }
  }

  /** Trechos que ficam no clipe: o corte inteiro, ou ele sem as pausas longas, conforme Ajustes > Corte e a modalidade */
  private keepRanges(m: MomentRow, s: Settings, fromUtc: number, toUtc: number): { fromUtc: number; toUtc: number }[] {
    const mode = s.clips.cutSilences
    if (mode === 'off') return [{ fromUtc, toUtc }]
    const talk = modalityAt(this.db, m.live_id, m.peak_utc) === 'talk'
    if (mode === 'talk' && !talk) return [{ fromUtc, toUtc }]
    const words = this.spoken(m.live_id, fromUtc, toUtc)
    if (words.length < 4) return [{ fromUtc, toUtc }]
    let levels: { t: number; rmsDb: number }[] | undefined
    let quietDb: number | undefined
    if (!talk) {
      // Fora da conversa, silêncio na fala pode ser ação na tela: só corta onde o som está bem abaixo do normal do trecho
      levels = (
        this.db.prepare('SELECT t, rms_db FROM audio_levels WHERE live_id = ? AND t >= ? AND t <= ?').all(m.live_id, Math.floor(fromUtc / 1000), Math.ceil(toUtc / 1000)) as {
          t: number
          rms_db: number
        }[]
      ).map((l) => ({ t: l.t, rmsDb: l.rms_db }))
      if (levels.length < 10) return [{ fromUtc, toUtc }]
      const sorted = levels.map((l) => l.rmsDb).sort((a, b) => a - b)
      quietDb = sorted[Math.floor(sorted.length / 2)] - 8
    }
    const keep = silenceCuts(fromUtc, toUtc, words, { minGapMs: talk ? 900 : 1500, keepMs: 200, levels, quietDb })
    // Proteção: nunca tirar mais de 35% do corte (o que sobra tem que contar a história)
    const kept = keep.reduce((a, r) => a + (r.toUtc - r.fromUtc), 0)
    return kept >= (toUtc - fromUtc) * 0.65 ? keep : [{ fromUtc, toUtc }]
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
    // Recorte ajustado à mão vira o padrão do canal (o rosto do streamer costuma ficar sempre no mesmo lugar)
    if (!auto && opts.layout === 'crop' && Math.abs(opts.cropX - defaultCropX(m)) > 0.005)
      this.db.prepare('UPDATE channels SET crop_x = ? WHERE id = ?').run(Math.round(opts.cropX * 1000) / 1000, m.channel_id)
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
   * Durante a gravação só pega lances que já terminaram há 90 s (45 s clipando ao vivo), para o trecho não crescer mais.
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
      if (recording && r.end_utc > lastEnd - (s.clips.live.enabled ? 45_000 : 90_000)) continue
      // A IA estendeu o fim do corte (história completa): espera a gravação chegar até lá
      if (recording && ai?.clip_to_utc && ai.clip_to_utc + 2000 > lastEnd) continue
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

  /**
   * Clipes automáticos que saíram sem o texto de cima (a IA ainda não tinha dado o título, ex.: chave fora do ar):
   * quando a IA analisa o lance depois, refaz com o título. Só os que ainda estão para revisar e que a IA não descartou.
   */
  retitleMissing(liveId: number): number {
    const s = this.d.settings()
    if (!s.clips.title.enabled) return 0
    const rows = this.db
      .prepare(
        `SELECT k.moment_id, k.options, m.ai FROM clips k JOIN moments m ON m.id = k.moment_id
         WHERE k.live_id = ? AND k.auto = 1 AND k.review = 'pending' AND k.status = 'ready' AND m.ai IS NOT NULL`
      )
      .all(liveId) as { moment_id: number; options: string; ai: string }[]
    let n = 0
    for (const r of rows) {
      const opts = parse<ClipOptions | null>(r.options, null)
      const ai = parse<AiJson | null>(r.ai, null)
      if (!opts || opts.title || !ai || ai.keep === false) continue
      const title = s.clips.title.lang === 'en' ? ai.title_en || ai.title_pt : ai.title_pt || ai.title_en
      if (!title) continue
      try {
        // Também ganha o corte que a IA escolheu (história completa), quando ela escolheu
        const m = this.moment(r.moment_id)
        const segs = m ? this.segs(m.live_id) : []
        let range = { startS: opts.startS, endS: opts.endS }
        if (m && segs.length) {
          const cut = this.rangeFor(m, s, { fromUtc: segs[0].startUtc, toUtc: segs[segs.length - 1].startUtc + segs[segs.length - 1].durS * 1000 })
          range = { startS: (cut.fromUtc - m.started_at) / 1000, endS: (cut.toUtc - m.started_at) / 1000 }
        }
        this.request(r.moment_id, { ...opts, ...range, title }, true)
        n++
      } catch (e) {
        this.d.log.warn('clipes', `Não deu para pôr o título no clipe: ${(e as Error).message}`)
      }
    }
    if (n) this.d.log.info('clipes', `${n} clipe(s) automático(s) refeito(s) com o texto de cima (a KaTY deu o título agora).`)
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

    // "Jogo + facecam" num canal sem facecam: a KaTY tenta achar a câmera antes (senão o clipe sairia em tela inteira)
    if (o.layout === 'split' && !cleanRect(parse<Rect | null>(m.facecam, null)) && this.d.settings().clips.autoFacecam) {
      const r = await this.detectFacecam(m.id, false, ctx.signal).catch(() => null)
      if (r?.rect) m.facecam = JSON.stringify(r.rect)
    }

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
    // Pular direto no ponto do pedaço (.ts) cai depois do quadro-chave: a imagem só começava ~2 s depois do som e o
    // clipe ficava travado no começo (medido em 2026-11-18). Por isso pula alguns segundos antes e corta exato no filtro.
    const PRE_S = 4
    const cut = b.parts.map((p) => {
      const ss = Math.max(0, p.inS - PRE_S)
      return { ss, off: p.inS - ss }
    })
    b.parts.forEach((_, i) => {
      const off = cut[i].off.toFixed(3)
      // Pedaços com tamanho diferente (a live mudou de resolução) são igualados ao primeiro
      g.push(`[${i}:v:0]trim=start=${off},setpts=PTS-STARTPTS,${n > 1 ? `scale=${b.src.w}:${b.src.h},setsar=1,` : ''}fps=${b.fps}[v${i}]`)
      // Sem as pausas, cada emenda ganha 30 ms de fade no som: corte seco no meio da onda estala
      const fade = b.trimmed ? `,afade=t=in:st=0:d=0.03,afade=t=out:st=${Math.max(0, b.parts[i].durS - 0.03).toFixed(3)}:d=0.03` : ''
      if (b.src.audio) g.push(`[${i}:a:0]atrim=start=${off},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo${fade}[a${i}]`)
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

    const inputs = b.parts.flatMap((p, i) => ['-ss', cut[i].ss.toFixed(3), '-t', (p.durS + cut[i].off).toFixed(3), '-i', p.file])
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
    rmSync(this.coverFile(clipId), { force: true })
    await this.cover(clipId).catch(() => null)
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
      .prepare(
        `SELECT c.*, j.progress AS progress, m.score AS m_score, m.ai AS m_ai, m.signals AS m_signals, m.peak_utc AS m_peak,
                ch.platform AS ch_platform, ch.login AS ch_login
         FROM clips c LEFT JOIN jobs j ON j.id = c.job_id LEFT JOIN moments m ON m.id = c.moment_id
              LEFT JOIN lives l ON l.id = c.live_id LEFT JOIN channels ch ON ch.id = l.channel_id ${where} ORDER BY c.id DESC LIMIT 500`
      )
      .all(...(id != null ? [id] : liveId != null ? [liveId] : [])) as unknown as ClipRow[]
    const lang = this.d.settings().clips.title.lang
    return rows.map((r) => {
      const game = r.live_id != null && r.m_peak != null ? gameAt(this.db, r.live_id, r.m_peak) : null
      const posted = parse<{ youtube?: number; tiktok?: number }>(r.posted, {})
      const custom = cleanCustom(parse<Partial<PostTexts>>(r.post_custom, {}))
      return {
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
      review: (['pending', 'approved', 'rejected'].includes(r.review) ? r.review : 'pending') as ClipReview,
      score: r.m_score,
      tag: clipTag(r.m_ai, r.m_signals),
      game,
      modality: r.live_id != null && r.m_peak != null ? modalityAt(this.db, r.live_id, r.m_peak) : null,
      progress: r.status === 'rendering' ? (r.progress ?? 0) : null,
      error: r.error,
      path: r.path && existsSync(r.path) ? r.path : null,
      durationS: r.duration_s,
      width: r.width,
      height: r.height,
      sizeBytes: r.size_bytes,
      auto: !!r.auto,
      jobId: r.job_id,
      createdAt: r.created_at,
      exportedPath: r.exported_path && existsSync(r.exported_path) ? r.exported_path : null,
      posted: { youtube: posted.youtube ?? null, tiktok: posted.tiktok ?? null },
      post: {
        ...postTexts({
          title: lang === 'en' && r.title_en ? r.title_en : r.title,
          hashtags: parse<string[]>(r.hashtags, []),
          channel: r.channel,
          channelUrl: r.ch_platform && r.ch_login ? channelUrl(r.ch_platform, r.ch_login) : null,
          game
        }),
        ...custom
      },
      postEdited: Object.keys(custom) as (keyof PostTexts)[]
      }
    })
  }

  setReview(id: number, review: ClipReview): void {
    if (!['pending', 'approved', 'rejected'].includes(review)) return
    this.db.prepare('UPDATE clips SET review = ?, reviewed_at = ? WHERE id = ?').run(review, Date.now(), id)
    if (review === 'approved' && this.d.settings().publishing.exportOnApprove) {
      try {
        this.exportClip(id)
      } catch (e) {
        this.d.log.warn('clipes', `Aprovado, mas não deu para copiar para a pasta para postar: ${(e as Error).message}`)
      }
    } else if (review !== 'approved') this.unexport(id)
    this.emit('clips')
  }

  /**
   * Copia o clipe pronto para a pasta "para postar" (uma subpasta por dia), com um .txt de título,
   * descrição e legenda para o YouTube Shorts e o TikTok. Já exportado: devolve a cópia que existe.
   */
  exportClip(id: number): string {
    const c = this.get(id)
    if (!c) throw new Error('Clipe não encontrado.')
    if (c.status !== 'ready' || !c.path) throw new Error('O clipe ainda não está pronto.')
    if (c.exportedPath) return c.exportedPath
    const d = new Date()
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const dir = join(this.d.exportRoot(), day)
    mkdirSync(dir, { recursive: true })
    const out = join(dir, basename(c.path))
    copyFileSync(c.path, out)
    const row = this.db.prepare('SELECT l.kind, l.source_url FROM clips k LEFT JOIN lives l ON l.id = k.live_id WHERE k.id = ?').get(id) as
      | { kind: string | null; source_url: string | null }
      | undefined
    const origin = row?.kind === 'vod' && row.source_url ? `${row.source_url} (${formatTimecode(c.options.startS)} – ${formatTimecode(c.options.endS)})` : null
    writeFileSync(out.replace(/\.mp4$/, '.txt'), postFile(c.post, { origin }), 'utf8')
    this.db.prepare('UPDATE clips SET exported_path = ? WHERE id = ?').run(out, id)
    this.d.log.info('clipes', `Na pasta para postar: ${c.title} (${day}).`)
    this.emit('clips')
    return out
  }

  /** Copia todos os aprovados prontos que ainda não estão na pasta "para postar". */
  exportApproved(): number {
    let n = 0
    for (const c of this.list()) {
      if (c.review !== 'approved' || c.status !== 'ready' || c.exportedPath) continue
      try {
        this.exportClip(c.id)
        n++
      } catch (e) {
        this.d.log.warn('clipes', `Não deu para copiar "${c.title}": ${(e as Error).message}`)
      }
    }
    return n
  }

  /** Tira a cópia da pasta "para postar" (clipe voltou para revisão ou foi descartado), se ainda não foi postado. */
  private unexport(id: number, force = false): void {
    const r = this.db.prepare('SELECT exported_path, posted FROM clips WHERE id = ?').get(id) as { exported_path: string | null; posted: string | null } | undefined
    if (!r?.exported_path) return
    const p = parse<{ youtube?: number; tiktok?: number }>(r.posted, {})
    if (!force && (p.youtube || p.tiktok)) return
    rmSync(r.exported_path, { force: true })
    rmSync(r.exported_path.replace(/\.mp4$/, '.txt'), { force: true })
    try {
      const dir = dirname(r.exported_path)
      if (!readdirSync(dir).length) rmdirSync(dir)
    } catch {
      // pasta do dia em uso ou já apagada
    }
    this.db.prepare('UPDATE clips SET exported_path = NULL WHERE id = ?').run(id)
  }

  /**
   * Edita um texto de postagem (o que a pessoa escreveu fica por cima do gerado).
   * Vazio volta ao gerado. Se o clipe já está na pasta "para postar", o .txt é reescrito.
   */
  setPostText(id: number, field: keyof PostTexts, text: string | null): void {
    if (!(field in LIMIT_OF)) return
    const r = this.db.prepare('SELECT post_custom, exported_path FROM clips WHERE id = ?').get(id) as { post_custom: string | null; exported_path: string | null } | undefined
    if (!r) return
    const custom = cleanCustom(parse<Partial<PostTexts>>(r.post_custom, {}))
    const t = (text ?? '').replace(/\r\n/g, '\n').trim()
    if (t) custom[field] = t.slice(0, LIMIT_OF[field])
    else delete custom[field]
    this.db.prepare('UPDATE clips SET post_custom = ? WHERE id = ?').run(Object.keys(custom).length ? JSON.stringify(custom) : null, id)
    if (r.exported_path && existsSync(r.exported_path)) {
      const c = this.get(id)
      if (c) writeFileSync(r.exported_path.replace(/\.mp4$/, '.txt'), postFile(c.post, { origin: null }), 'utf8')
    }
    this.emit('clips')
  }

  /** Arquivo para arrastar ou enviar: a cópia da pasta "para postar", senão o clipe original. */
  uploadFile(id: number): string | null {
    const c = this.get(id)
    return c?.exportedPath ?? c?.path ?? null
  }

  /** Capa já gerada (para o ícone do arrastar), sem criar uma nova. */
  coverIfExists(id: number): string | null {
    const f = this.coverFile(id)
    return existsSync(f) ? f : null
  }

  /** Marca ou desmarca o clipe como postado no YouTube ou no TikTok (com a hora). */
  markPosted(id: number, platform: 'youtube' | 'tiktok', posted: boolean): void {
    if (platform !== 'youtube' && platform !== 'tiktok') return
    const r = this.db.prepare('SELECT posted FROM clips WHERE id = ?').get(id) as { posted: string | null } | undefined
    if (!r) return
    const p = parse<{ youtube?: number; tiktok?: number }>(r.posted, {})
    if (posted) p[platform] = Date.now()
    else delete p[platform]
    this.db.prepare('UPDATE clips SET posted = ? WHERE id = ?').run(Object.keys(p).length ? JSON.stringify(p) : null, id)
    this.emit('clips')
  }

  private coverFile(id: number): string {
    return join(this.d.cacheDir, `capa_${id}.jpg`)
  }

  /** Capa vertical do clipe pronto (um quadro a 40% do vídeo), criada na primeira vez que é pedida. */
  async cover(id: number): Promise<string | null> {
    const out = this.coverFile(id)
    if (existsSync(out)) return out
    const r = this.db.prepare(`SELECT path, duration_s FROM clips WHERE id = ? AND status = 'ready'`).get(id) as { path: string | null; duration_s: number } | undefined
    const tools = this.d.tools()
    if (!r?.path || !existsSync(r.path) || !tools) return null
    mkdirSync(this.d.cacheDir, { recursive: true })
    await runFfmpeg(tools.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-ss', (r.duration_s * 0.4).toFixed(2), '-i', r.path, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', out])
    return out
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
    this.unexport(id, true)
    if (r.path) {
      rmSync(r.path, { force: true })
      rmSync(r.path.replace(/\.mp4$/, '.txt'), { force: true })
    }
    rmSync(this.coverFile(id), { force: true })
    this.db.prepare('DELETE FROM clips WHERE id = ?').run(id)
    if (r.moment_id != null) {
      const others = this.db.prepare('SELECT 1 FROM clips WHERE moment_id = ?').get(r.moment_id)
      if (!others) this.db.prepare(`UPDATE moments SET status = 'new' WHERE id = ? AND status = 'kept'`).run(r.moment_id)
    }
    this.emit('clips')
  }

  /**
   * Apaga do disco os clipes em Descartados: todos (`olderThanMs` = 0) ou os descartados há mais tempo que o prazo.
   * O momento de cada um fica descartado, para o clipe automático não refazer o mesmo lance.
   */
  purgeRejected(olderThanMs: number, now = Date.now()): number {
    const rows = this.db
      .prepare(
        `SELECT id, moment_id FROM clips WHERE review = 'rejected' AND status NOT IN ('queued', 'rendering') AND COALESCE(reviewed_at, created_at) <= ?`
      )
      .all(now - olderThanMs) as { id: number; moment_id: number | null }[]
    for (const r of rows) {
      this.delete(r.id)
      if (r.moment_id != null) this.db.prepare(`UPDATE moments SET status = 'dismissed' WHERE id = ?`).run(r.moment_id)
    }
    return rows.length
  }
}

/** Limite de cada texto de postagem */
const LIMIT_OF: Record<keyof PostTexts, number> = { youtubeTitle: LIMITS.youtubeTitle, youtubeDescription: LIMITS.youtubeDescription, tiktokCaption: LIMITS.tiktokCaption }

/** Só os campos conhecidos e com texto (um JSON velho ou estranho não quebra a lista) */
function cleanCustom(c: Partial<PostTexts>): Partial<PostTexts> {
  const out: Partial<PostTexts> = {}
  for (const k of Object.keys(LIMIT_OF) as (keyof PostTexts)[]) if (typeof c?.[k] === 'string' && c[k]!.trim()) out[k] = c[k]
  return out
}

/** Posição padrão do recorte: a lembrada no canal, senão o meio da facecam marcada, senão o centro. */
function defaultCropX(m: { crop_x: number | null; facecam: string | null }): number {
  if (m.crop_x != null && Number.isFinite(m.crop_x)) return Math.min(1, Math.max(0, m.crop_x))
  const f = cleanRect(parse<Rect | null>(m.facecam, null))
  return f ? cropXForCenter(f.x + f.w / 2) : 0.5
}

/** Etiqueta curta do clipe: categoria da IA, ou de onde veio o sinal forte */
function clipTag(ai: string | null, signals: string | null): string | null {
  const a = parse<AiJson & { category?: string } | null>(ai, null)
  const s = parse<{ clip?: { views?: number }; voice?: unknown }>(signals, {})
  if (s.clip) return `clipado · ${s.clip.views ?? 0} views`
  if (s.voice) return 'pediu clipe'
  return a?.keep !== false && a?.category ? a.category : null
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
