import { spawn, spawnSync } from 'child_process'
import { cpus, totalmem } from 'os'
import { ENCODER_CANDIDATES } from '../shared/encoders'
import type { EncoderInfo, GpuInfo, HardwareInfo } from '../shared/types'

function vendorOf(name: string): GpuInfo['vendor'] {
  if (/nvidia|geforce|rtx|gtx|quadro/i.test(name)) return 'nvidia'
  if (/amd|radeon/i.test(name)) return 'amd'
  if (/intel|arc|iris|uhd/i.test(name)) return 'intel'
  return 'other'
}

/** Placas de vídeo pelo Windows (CIM). Não depende de nenhum programa extra. */
export function detectGpus(): GpuInfo[] {
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion | ConvertTo-Json -Compress'],
    { encoding: 'utf8', windowsHide: true, timeout: 20_000 }
  )
  if (r.status !== 0 || !r.stdout.trim()) return []
  try {
    const raw = JSON.parse(r.stdout) as { Name?: string; DriverVersion?: string } | { Name?: string; DriverVersion?: string }[]
    const list = Array.isArray(raw) ? raw : [raw]
    return list
      .filter((g) => g.Name && !/basic display|remote display|virtual/i.test(g.Name))
      .map((g) => ({ name: g.Name!.trim(), vendor: vendorOf(g.Name!), driver: g.DriverVersion ?? null }))
  } catch {
    return []
  }
}

export function baseHardware(): Omit<HardwareInfo, 'encoders' | 'encodersTestedAt'> {
  const c = cpus()
  return {
    cpu: c[0]?.model.trim() ?? 'Desconhecido',
    cores: c.length,
    ramGb: Math.round(totalmem() / 1024 ** 3),
    gpus: detectGpus()
  }
}

/** Codificadores que o ffmpeg diz ter (não garante que funcionem nesta máquina). */
function listedEncoders(ffmpeg: string): Set<string> {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
  const set = new Set<string>()
  for (const line of (r.stdout ?? '').split(/\r?\n/)) {
    const m = line.match(/^\s*V\S*\s+(\S+)/)
    if (m) set.add(m[1])
  }
  return set
}

function runTest(ffmpeg: string, encoder: string, signal?: AbortSignal): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    // 0,1 s de vídeo sintético em 720p: rápido e suficiente para saber se o codificador abre e codifica
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '0.1', '-pix_fmt', 'yuv420p', '-c:v', encoder, '-f', 'null', '-']
    const p = spawn(ffmpeg, args, { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    const timer = setTimeout(() => p.kill(), 30_000)
    const onAbort = () => p.kill()
    signal?.addEventListener('abort', onAbort)
    p.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      const line = err.split(/\r?\n/).find((l) => l.trim())
      resolve(code === 0 ? { ok: true } : { ok: false, error: line?.slice(0, 200) ?? `código ${code}` })
    })
    p.on('error', (e) => resolve({ ok: false, error: e.message }))
  })
}

/** Testa cada codificador conhecido com um vídeo real de 0,1 s. */
export async function testEncoders(ffmpeg: string, onProgress?: (v: number) => void, signal?: AbortSignal): Promise<EncoderInfo[]> {
  const listed = listedEncoders(ffmpeg)
  const out: EncoderInfo[] = []
  let i = 0
  for (const c of ENCODER_CANDIDATES) {
    if (signal?.aborted) throw signal.reason
    if (!listed.has(c.name)) {
      out.push({ ...c, works: false, error: 'Não incluído neste ffmpeg' })
    } else {
      const r = await runTest(ffmpeg, c.name, signal)
      out.push({ ...c, works: r.ok, error: r.error })
    }
    onProgress?.(++i / ENCODER_CANDIDATES.length)
  }
  return out
}
