import { spawn } from 'child_process'

export interface SecondLevel {
  /** Segundo dentro do pedaço (0, 1, 2…) */
  sec: number
  /** Volume médio (RMS) em dBFS; silêncio total = -90 */
  rmsDb: number
  /** Pico em dBFS */
  peakDb: number
}

const SAMPLE_RATE = 8000
const toDb = (v: number) => (v <= 0 ? -90 : Math.max(-90, 20 * Math.log10(v / 32768)))

/** Acumula amostras PCM 16 bits e fecha um nível a cada segundo. */
export class LevelMeter {
  private sumSq = 0
  private peak = 0
  private n = 0
  private sec = 0
  private carry: Buffer | null = null
  readonly levels: SecondLevel[] = []

  constructor(private rate = SAMPLE_RATE) {}

  push(chunk: Buffer): void {
    // Uma amostra pode chegar partida entre dois pedaços do stdout: o byte que sobra espera o próximo
    const buf = this.carry ? Buffer.concat([this.carry, chunk]) : chunk
    const usable = buf.length - (buf.length % 2)
    this.carry = usable < buf.length ? buf.subarray(usable) : null
    for (let i = 0; i < usable; i += 2) {
      const s = buf.readInt16LE(i)
      const a = s < 0 ? -s : s
      this.sumSq += s * s
      if (a > this.peak) this.peak = a
      if (++this.n === this.rate) this.close()
    }
  }

  /** Fecha o último segundo incompleto (se tiver ao menos meio segundo). */
  end(): SecondLevel[] {
    if (this.n >= this.rate / 2) this.close()
    return this.levels
  }

  private close(): void {
    this.levels.push({ sec: this.sec++, rmsDb: toDb(Math.sqrt(this.sumSq / this.n)), peakDb: toDb(this.peak) })
    this.sumSq = 0
    this.peak = 0
    this.n = 0
  }
}

/** Volume segundo a segundo de um pedaço gravado (só o áudio é decodificado). */
export function analyzeAudio(ffmpeg: string, file: string, signal?: AbortSignal): Promise<SecondLevel[]> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-i', file, '-vn', '-map', '0:a:0?', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'], {
      windowsHide: true
    })
    const meter = new LevelMeter()
    let err = ''
    p.stdout.on('data', (d: Buffer) => meter.push(d))
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
    const onAbort = () => p.kill()
    signal?.addEventListener('abort', onAbort)
    p.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) return reject(signal.reason)
      if (code !== 0) return reject(new Error(err.trim().split(/\r?\n/).pop() || `ffmpeg saiu com código ${code}`))
      resolve(meter.end())
    })
    p.on('error', reject)
  })
}
