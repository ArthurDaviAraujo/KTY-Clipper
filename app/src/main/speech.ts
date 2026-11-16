import { spawn } from 'child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'

export interface Word {
  /** ms desde o início do pedaço */
  from: number
  to: number
  text: string
}

export interface Transcript {
  language: string | null
  words: Word[]
}

/**
 * Lê o JSON do whisper-cli rodado com `-ml 1 -sow` (uma palavra por "segmento").
 * Descarta marcações como [MÚSICA], [_BEG_] e entradas vazias.
 */
export function parseWhisperJson(json: unknown): Transcript {
  const j = json as { result?: { language?: string }; transcription?: { offsets?: { from: number; to: number }; text?: string }[] }
  const words: Word[] = []
  for (const s of j.transcription ?? []) {
    const text = (s.text ?? '').trim()
    if (!text || /^\[.*\]$|^\(.*\)$|^\*.*\*$/.test(text)) continue
    if (!s.offsets) continue
    words.push({ from: s.offsets.from, to: s.offsets.to, text })
  }
  return { language: j.result?.language ?? null, words }
}

/**
 * Rede de segurança contra o loop do Whisper: uma sequência de 3 a 12 palavras repetida logo em seguida
 * mais de 2 vezes fica só com as 2 primeiras ("clipa, clipa" de verdade continua; 80 repetições não).
 */
export function dropLoops<T extends { text: string }>(words: T[]): T[] {
  const key = (w: T) => w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const k = words.map(key)
  const keep = new Array<boolean>(words.length).fill(true)
  let i = 0
  while (i < words.length) {
    let jumped = false
    for (let n = 3; n <= 12 && i + 2 * n <= words.length; n++) {
      const same = (a: number, b: number) => {
        for (let x = 0; x < n; x++) if (k[a + x] !== k[b + x]) return false
        return true
      }
      if (!same(i, i + n)) continue
      // Conta quantas cópias seguidas existem
      let copies = 2
      while (i + (copies + 1) * n <= words.length && same(i, i + copies * n)) copies++
      if (copies > 2) {
        for (let x = i + 2 * n; x < i + copies * n; x++) keep[x] = false
        i += copies * n
        jumped = true
        break
      }
    }
    if (!jumped) i++
  }
  return words.filter((_, idx) => keep[idx])
}

function run(cmd: string, args: string[], signal?: AbortSignal): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => (err = (err + d).slice(-3000)))
    p.stdout.on('data', () => {})
    const onAbort = () => p.kill()
    signal?.addEventListener('abort', onAbort)
    p.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) reject(signal.reason)
      else resolve({ code, err })
    })
    p.on('error', reject)
  })
}

export interface SpeechTools {
  ffmpeg: string
  whisper: string
  model: string
}

/**
 * Transcreve um pedaço gravado: ffmpeg extrai o áudio (16 kHz mono, exigido pelo Whisper)
 * num arquivo temporário AO LADO do pedaço (no disco das gravações), o whisper-cli gera
 * o JSON com uma palavra por linha e os temporários são apagados.
 */
export async function transcribe(tools: SpeechTools, segPath: string, language: string, threads: number, signal?: AbortSignal): Promise<Transcript> {
  const base = `${segPath}.fala`
  const wav = `${base}.wav`
  try {
    const a = await run(tools.ffmpeg, ['-v', 'error', '-y', '-i', segPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], signal)
    if (a.code !== 0) throw new Error(`ffmpeg: ${a.err.trim().split(/\r?\n/).pop()}`)
    const w = await run(
      tools.whisper,
      // -mc 0: cada trecho não recebe o texto anterior. Sem isso o Whisper entra em loop sobre música/barulho
      // de jogo (medido: a mesma frase 85 vezes num pedaço de 5 min; com -mc 0, nenhuma e 23% mais rápido).
      ['-m', tools.model, '-f', wav, '-l', language || 'auto', '-t', String(threads), '-mc', '0', '-oj', '-of', base, '-ml', '1', '-sow', '-sns', '-np'],
      signal
    )
    if (w.code !== 0 || !existsSync(`${base}.json`)) throw new Error(`whisper: ${w.err.trim().split(/\r?\n/).pop() || `código ${w.code}`}`)
    const tr = parseWhisperJson(JSON.parse(readFileSync(`${base}.json`, 'utf8')))
    return { ...tr, words: dropLoops(tr.words) }
  } finally {
    rmSync(wav, { force: true })
    rmSync(`${base}.json`, { force: true })
  }
}

/** Modelos do Whisper (ggml-*.bin) encontrados nas pastas, do mais preciso ao mais rápido. */
export function findWhisperModels(dirs: string[]): { name: string; path: string }[] {
  const order = ['large-v3-turbo', 'large', 'medium', 'small', 'base', 'tiny']
  const out: { name: string; path: string }[] = []
  for (const d of dirs) {
    if (!existsSync(d)) continue
    for (const f of readdirSync(d)) if (/^ggml-.+\.bin$/.test(f) && !/silero/i.test(f) && !out.some((x) => x.name === f)) out.push({ name: f, path: join(d, f) })
  }
  const rank = (n: string) => {
    const i = order.findIndex((o) => n.includes(o))
    return i === -1 ? order.length : i
  }
  return out.sort((a, b) => rank(a.name) - rank(b.name))
}

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Procura frases-gatilho ("clipa isso", "clip that"…) na sequência de palavras.
 * Compara sem acento e sem pontuação; devolve o horário (ms) da última palavra de cada ocorrência,
 * ignorando repetições a menos de 20 s (o streamer costuma repetir "clipa, clipa!").
 */
export function findVoiceTriggers(words: { t: number; text: string }[], triggers: string[]): { t: number; phrase: string }[] {
  const phrases = triggers.map((t) => strip(t).split(' ').filter(Boolean)).filter((p) => p.length)
  const norm = words.map((w) => ({ t: w.t, w: strip(w.text) })).filter((w) => w.w)
  // Uma "palavra" do Whisper pode ter espaço ("clip that" junto): quebra de novo
  const flat: { t: number; w: string }[] = []
  for (const x of norm) for (const part of x.w.split(' ')) flat.push({ t: x.t, w: part })
  const hits: { t: number; phrase: string }[] = []
  for (let i = 0; i < flat.length; i++) {
    for (const p of phrases) {
      if (i + p.length > flat.length) continue
      let ok = true
      for (let k = 0; k < p.length; k++) if (flat[i + k].w !== p[k]) ok = false
      if (!ok) continue
      const t = flat[i + p.length - 1].t
      if (!hits.length || t - hits[hits.length - 1].t > 20_000) hits.push({ t, phrase: p.join(' ') })
      break
    }
  }
  return hits
}
