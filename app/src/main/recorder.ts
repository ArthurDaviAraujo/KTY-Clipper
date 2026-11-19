import { spawn, type ChildProcess } from 'child_process'
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import type { Platform, RecordQuality } from '../shared/types'
import { resolveKickVariant } from './platforms/kick'

export interface SegmentDone {
  seq: number
  path: string
  /** Início do pedaço em relação ao começo desta execução do ffmpeg (s) */
  startOffset: number
  duration: number | null
  bytes: number
  /** Hora real (ms) em que esta execução do ffmpeg começou */
  runStartedAt: number
}

export interface RecorderTools {
  ffmpeg: string
  ytdlp: string | null
  streamlink: string | null
}

export interface RecorderOptions {
  platform: Platform
  channelUrl: string
  /** Kick: link HLS direto da API (dispensa o yt-dlp) */
  playbackUrl?: string | null
  dir: string
  segmentSeconds: number
  quality: RecordQuality
  startSeq: number
  run: number
  tools: RecorderTools
  onSegment(seg: SegmentDone): void
  onLog(level: 'info' | 'warn' | 'error', message: string): void
  /** VOD: link HLS já resolvido (pula yt-dlp/Streamlink) */
  inputUrl?: string
  /** VOD do YouTube: o som vem num link separado da imagem */
  inputAudioUrl?: string
  /** VOD: começa neste segundo do vídeo */
  seekSeconds?: number
  /** VOD: grava só esta duração (s) */
  durationSeconds?: number
  /** Segundos já processados nesta execução (lido do -progress do ffmpeg) */
  onProgress?(seconds: number): void
}

/** Linha do CSV do ffmpeg: "arquivo,inicio,fim" */
export function parseSegmentCsv(text: string): { file: string; start: number; end: number }[] {
  const out: { file: string; start: number; end: number }[] = []
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(',')
    if (parts.length < 3) continue
    const end = Number(parts.pop())
    const start = Number(parts.pop())
    const file = parts.join(',').replace(/^"|"$/g, '')
    if (file && Number.isFinite(start) && Number.isFinite(end)) out.push({ file, start, end })
  }
  return out
}

export const seqFromFile = (file: string): number | null => {
  const m = file.match(/seg_(\d+)\.ts$/)
  return m ? Number(m[1]) : null
}

/** Streamlink tenta os nomes em ordem: o primeiro que a live tiver é gravado (o maior dentro do limite). */
export const STREAMLINK_QUALITY: Record<RecordQuality, string> = {
  best: 'best',
  '2160': '2160p60,2160p,1440p60,1440p,1080p60,1080p,936p60,720p60,720p,best',
  '1440': '1440p60,1440p,1080p60,1080p,936p60,720p60,720p,best',
  '1080': '1080p60,1080p,936p60,720p60,720p,480p,best',
  '720': '720p60,720p,480p,360p,worst',
  '480': '480p,480p30,360p,worst'
}
export const YTDLP_FORMAT: Record<RecordQuality, string> = {
  best: 'best',
  '2160': 'best[height<=2160]/best',
  '1440': 'best[height<=1440]/best',
  '1080': 'best[height<=1080]/best',
  '720': 'best[height<=720]/worst',
  '480': 'best[height<=480]/worst'
}

export function resolveHls(ytdlp: string, url: string, quality: RecordQuality): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(ytdlp, ['-g', '-f', YTDLP_FORMAT[quality], '--no-warnings', '--encoding', 'utf-8', url], { windowsHide: true })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    const t = setTimeout(() => p.kill(), 60_000)
    p.on('close', (code) => {
      clearTimeout(t)
      const link = out.split(/\r?\n/).find((l) => l.startsWith('http'))
      if (code === 0 && link) resolve(link.trim())
      else reject(new Error(err.split(/\r?\n/).find((l) => /error/i.test(l))?.trim() || `yt-dlp saiu com código ${code}`))
    })
    p.on('error', reject)
  })
}

/**
 * Links do vídeo do YouTube para o ffmpeg copiar sem recodificar: imagem H.264 (avc1) e som AAC (mp4a),
 * os únicos que cabem no .ts. O YouTube manda os dois separados (DASH); sem eles, cai num arquivo único.
 */
export function resolveYoutube(ytdlp: string, url: string, quality: RecordQuality): Promise<{ video: string; audio: string | null }> {
  const h = quality === 'best' ? '' : `[height<=${quality}]`
  const format = `bv*[vcodec^=avc1]${h}+ba[acodec^=mp4a]/b[vcodec^=avc1][acodec^=mp4a]${h}/b[vcodec^=avc1]`
  return new Promise((resolve, reject) => {
    const p = spawn(ytdlp, ['-g', '-f', format, '--no-warnings', '--encoding', 'utf-8', url], { windowsHide: true })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    const t = setTimeout(() => p.kill(), 90_000)
    p.on('close', (code) => {
      clearTimeout(t)
      const links = out.split(/\r?\n/).filter((l) => l.startsWith('http'))
      if (code === 0 && links.length) resolve({ video: links[0].trim(), audio: links[1]?.trim() ?? null })
      else reject(new Error(err.split(/\r?\n/).find((l) => /error/i.test(l))?.trim() || `yt-dlp saiu com código ${code}`))
    })
    p.on('error', reject)
  })
}

/**
 * Grava uma live em pedaços .ts de duração fixa, sem recodificar.
 * Cada execução do ffmpeg escreve um CSV próprio; os pedaços prontos são lidos dele.
 * Uma execução termina quando a conexão cai ou quando stop() é chamado; quem decide reiniciar é o serviço.
 */
export class SegmentRecorder {
  readonly engine: 'streamlink' | 'ffmpeg'
  private ffmpeg: ChildProcess | null = null
  private source: ChildProcess | null = null
  private poller: NodeJS.Timeout | null = null
  private seen = new Set<number>()
  private runStartedAt = 0
  private stopping = false
  private listPath: string
  lastSeq: number

  constructor(private o: RecorderOptions) {
    // Link já resolvido (VOD) vai direto para o ffmpeg; live da Twitch usa Streamlink quando houver
    this.engine = !o.inputUrl && o.tools.streamlink ? 'streamlink' : 'ffmpeg'
    this.listPath = join(o.dir, `segmentos_${o.run}.csv`)
    this.lastSeq = o.startSeq - 1
  }

  /** Resolve quando a execução termina (por queda ou por stop). */
  async run(): Promise<{ code: number | null; stderr: string }> {
    const { o } = this
    let input = 'pipe:0'
    if (o.inputUrl) {
      input = o.inputUrl
    } else if (this.engine === 'ffmpeg') {
      if (o.platform === 'kick' && o.playbackUrl) {
        // Escolhe a resolução explicitamente (4K/2K quando houver), em vez de deixar o ffmpeg decidir
        const v = await resolveKickVariant(o.playbackUrl, o.quality)
        input = v?.url ?? o.playbackUrl
        if (v) o.onLog('info', `resolução escolhida: ${v.width}x${v.height} ${v.fps}fps`)
      } else if (o.tools.ytdlp) input = await resolveHls(o.tools.ytdlp, o.channelUrl, o.quality)
      else throw new Error('Sem yt-dlp nem Streamlink para abrir a live.')
    }

    const args = ['-hide_banner', '-loglevel', 'warning', '-y']
    if (o.onProgress) args.push('-progress', 'pipe:1', '-nostats')
    if (input !== 'pipe:0') args.push('-rw_timeout', '30000000')
    if (o.seekSeconds) args.push('-ss', o.seekSeconds.toFixed(3))
    args.push('-i', input)
    if (o.inputAudioUrl) {
      args.push('-rw_timeout', '30000000')
      if (o.seekSeconds) args.push('-ss', o.seekSeconds.toFixed(3))
      args.push('-i', o.inputAudioUrl, '-map', '0:v:0', '-map', '1:a:0')
    }
    if (o.durationSeconds) args.push('-t', o.durationSeconds.toFixed(3))
    args.push(
      '-c', 'copy',
      '-f', 'segment',
      '-segment_time', String(o.segmentSeconds),
      '-segment_format', 'mpegts',
      '-reset_timestamps', '1',
      '-segment_start_number', String(o.startSeq),
      '-segment_list', this.listPath,
      '-segment_list_type', 'csv',
      join(o.dir, 'seg_%05d.ts')
    )

    this.runStartedAt = Date.now()
    const ff = spawn(o.tools.ffmpeg, args, { windowsHide: true, stdio: ['pipe', o.onProgress ? 'pipe' : 'ignore', 'pipe'] })
    this.ffmpeg = ff
    let stderr = ''
    ff.stderr!.on('data', (d) => {
      stderr = (stderr + d).slice(-4000)
    })
    if (o.onProgress) {
      let buf = ''
      ff.stdout!.on('data', (d) => {
        buf += d
        const lines = buf.split(/\r?\n/)
        buf = lines.pop() ?? ''
        for (const l of lines) {
          // out_time_us (e o antigo out_time_ms) vêm em microssegundos
          const m = l.match(/^out_time_(?:us|ms)=(\d+)/)
          if (m) o.onProgress!(Number(m[1]) / 1e6)
        }
      })
    }

    if (this.engine === 'streamlink') {
      // O Streamlink 8 já pula os anúncios da Twitch por padrão (o antigo --twitch-disable-ads foi desativado)
      const slArgs = ['--stdout', '--loglevel', 'warning', '--hls-live-restart', o.channelUrl, STREAMLINK_QUALITY[o.quality]]
      const sl = spawn(o.tools.streamlink!, slArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      this.source = sl
      sl.stdout!.pipe(ff.stdin!)
      sl.stderr!.on('data', (d) => {
        const line = String(d).trim()
        if (line) o.onLog('warn', `streamlink: ${line.slice(0, 300)}`)
      })
      sl.on('close', () => ff.stdin?.end())
      ff.stdin!.on('error', () => {
        // ffmpeg fechou antes do streamlink: ignorado, o close do ffmpeg resolve
      })
    }

    this.poller = setInterval(() => this.poll(), 2000)

    const code = await new Promise<number | null>((resolve) => {
      ff.on('close', resolve)
      ff.on('error', (e) => {
        stderr += e.message
        resolve(-1)
      })
    })
    if (this.poller) clearInterval(this.poller)
    this.poller = null
    this.source?.kill()
    this.source = null
    this.ffmpeg = null
    this.poll()
    this.adoptOrphan()
    return { code, stderr }
  }

  /** Para de gravar: o último pedaço é fechado corretamente. */
  async stop(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    const ff = this.ffmpeg
    if (!ff) return
    if (this.source) this.source.kill()
    else ff.stdin?.write('q\n')
    const deadline = Date.now() + 15_000
    while (this.ffmpeg && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
    this.ffmpeg?.kill()
  }

  private poll(): void {
    if (!existsSync(this.listPath)) return
    let text: string
    try {
      text = readFileSync(this.listPath, 'utf8')
    } catch {
      return
    }
    for (const row of parseSegmentCsv(text)) {
      const seq = seqFromFile(row.file)
      if (seq == null || this.seen.has(seq)) continue
      this.seen.add(seq)
      this.emit(seq, row.start, Math.max(0, row.end - row.start))
    }
  }

  /** Se o ffmpeg foi derrubado, o último pedaço existe mas não entrou no CSV. */
  private adoptOrphan(): void {
    const seq = this.lastSeq + 1
    const path = join(this.o.dir, `seg_${String(seq).padStart(5, '0')}.ts`)
    if (!this.seen.has(seq) && existsSync(path) && statSync(path).size > 0) {
      this.seen.add(seq)
      this.emit(seq, null, null)
    }
  }

  private emit(seq: number, start: number | null, duration: number | null): void {
    const path = join(this.o.dir, `seg_${String(seq).padStart(5, '0')}.ts`)
    let bytes = 0
    try {
      bytes = statSync(path).size
    } catch {
      return
    }
    this.lastSeq = Math.max(this.lastSeq, seq)
    // Sem CSV (pedaço órfão), estima o início pelo número do pedaço
    const startOffset = start ?? (seq - this.o.startSeq) * this.o.segmentSeconds
    this.o.onSegment({ seq, path, startOffset, duration, bytes, runStartedAt: this.runStartedAt })
  }
}
