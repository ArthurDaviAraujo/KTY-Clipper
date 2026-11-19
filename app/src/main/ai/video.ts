/**
 * A KaTY vê o vídeo: recorta a janela do lance num MP4 leve (360p, poucos quadros, som mono) para mandar ao Gemini.
 * O Gemini olha ~1 quadro por segundo e ouve o som; leve assim, 90 s dão uns 2–4 MB (cabe no pedido direto, limite de 20 MB).
 */
import { spawn } from 'child_process'
import { readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { planParts } from '../../shared/clips'

/** Argumentos do ffmpeg para juntar os trechos num vídeo leve (puro, para testar). */
export function windowVideoArgs(parts: { file: string; inS: number; durS: number }[], out: string): string[] {
  const inputs = parts.flatMap((p) => ['-ss', Math.max(0, p.inS).toFixed(3), '-t', p.durS.toFixed(3), '-i', p.file])
  const n = parts.length
  const chains = parts.map((_, i) => `[${i}:v:0]scale=-2:360,fps=4,setsar=1[v${i}];[${i}:a:0]aresample=16000,aformat=channel_layouts=mono[a${i}]`)
  const join_ = `${parts.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${n}:v=1:a=1[v][a]`
  return [
    '-hide_banner', '-v', 'error', '-y',
    ...inputs,
    '-filter_complex', `${chains.join(';')};${join_}`,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '34', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '32k',
    '-movflags', '+faststart',
    out
  ]
}

/** O trecho [fromUtc, toUtc] da gravação como MP4 leve em base64 (null se não houver gravação ali). */
export async function windowVideo(
  ffmpeg: string,
  segs: { path: string; startUtc: number; durS: number }[],
  fromUtc: number,
  toUtc: number,
  signal?: AbortSignal
): Promise<string | null> {
  const parts = planParts(segs, fromUtc, toUtc)
  if (!parts.length) return null
  const out = join(tmpdir(), `clipador-katy-ve-${randomUUID()}.mp4`)
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(ffmpeg, windowVideoArgs(parts, out), { windowsHide: true })
      let err = ''
      p.stderr.on('data', (d) => (err += String(d)))
      const stop = () => p.kill()
      signal?.addEventListener('abort', stop, { once: true })
      p.on('error', reject)
      p.on('close', (code) => {
        signal?.removeEventListener('abort', stop)
        code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-200)}`))
      })
    })
    return readFileSync(out).toString('base64')
  } finally {
    rmSync(out, { force: true })
  }
}
