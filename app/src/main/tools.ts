import { app } from 'electron'
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import type { Settings, ToolId, ToolInfo } from '../shared/types'

interface ToolDef {
  id: ToolId
  label: string
  /** Caminhos relativos à pasta de programas, em ordem de preferência */
  rel: string[]
  exe: string
  versionArgs: string[]
  required: boolean
  purpose: string
  parseVersion: (out: string) => string | null
}

const firstLine = (s: string) => s.split(/\r?\n/).find((l) => l.trim())?.trim() ?? null

export const TOOL_DEFS: ToolDef[] = [
  {
    id: 'ffmpeg',
    label: 'FFmpeg',
    rel: ['ffmpeg.exe', 'ffmpeg/ffmpeg.exe'],
    exe: 'ffmpeg.exe',
    versionArgs: ['-hide_banner', '-version'],
    required: true,
    purpose: 'Corta, junta, deixa na vertical e coloca legenda nos clipes.',
    parseVersion: (o) => firstLine(o)?.replace(/^ffmpeg version\s+/, '').split(' ')[0] ?? null
  },
  {
    id: 'ffprobe',
    label: 'FFprobe',
    rel: ['ffprobe.exe', 'ffmpeg/ffprobe.exe'],
    exe: 'ffprobe.exe',
    versionArgs: ['-hide_banner', '-version'],
    required: true,
    purpose: 'Lê duração, resolução e fps dos vídeos.',
    parseVersion: (o) => firstLine(o)?.replace(/^ffprobe version\s+/, '').split(' ')[0] ?? null
  },
  {
    id: 'ytdlp',
    label: 'yt-dlp',
    rel: ['yt-dlp.exe'],
    exe: 'yt-dlp.exe',
    versionArgs: ['--version'],
    required: true,
    purpose: 'Baixa VODs da Twitch e da Kick por link.',
    parseVersion: firstLine
  },
  {
    id: 'streamlink',
    label: 'Streamlink',
    rel: ['streamlink/bin/streamlink.exe', 'streamlink/streamlink.exe', 'streamlink.exe'],
    exe: 'streamlink.exe',
    versionArgs: ['--version'],
    required: false,
    purpose: 'Grava as lives da Twitch sem os anúncios (obrigatório para a Twitch; a Kick grava sem ele).',
    parseVersion: (o) => firstLine(o)?.replace(/^streamlink\s+/i, '') ?? null
  },
  {
    id: 'whisper',
    label: 'Whisper (whisper.cpp)',
    rel: ['whisper/whisper-cli.exe'],
    exe: 'whisper-cli.exe',
    versionArgs: ['--help'],
    required: false,
    purpose: 'Transcreve a fala das lives (fase 1).',
    // O whisper-cli não tem --version; basta ter respondido
    parseVersion: () => 'instalado'
  }
]

/** Pastas onde os programas são procurados, em ordem. */
export function programDirs(): string[] {
  const dirs: string[] = []
  if (app.isPackaged) {
    dirs.push(join(app.getPath('userData'), 'programas'), join(process.resourcesPath, 'programas'))
  } else {
    // Em desenvolvimento: <projeto>/programas, ao lado da pasta app/
    dirs.push(join(dirname(app.getAppPath()), 'programas'))
  }
  return dirs
}

function where(exe: string): string | null {
  const r = spawnSync('where', [exe], { encoding: 'utf8', windowsHide: true })
  return r.status === 0 ? firstLine(r.stdout) : null
}

function locate(def: ToolDef, configured: string | undefined): string | null {
  if (configured && existsSync(configured)) return configured
  for (const d of programDirs()) {
    for (const rel of def.rel) {
      const p = join(d, rel)
      if (existsSync(p)) return p
    }
  }
  return where(def.exe)
}

function probeVersion(def: ToolDef, path: string): string | null {
  const r = spawnSync(path, def.versionArgs, { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
  if (r.error) return null
  // whisper-cli --help sai com código diferente de zero em algumas versões; o texto basta
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  return out.trim() ? def.parseVersion(out) : null
}

let cache: ToolInfo[] | null = null

export function getTools(settings: Settings, refresh = false): ToolInfo[] {
  if (cache && !refresh) return cache
  cache = TOOL_DEFS.map((def) => {
    const path = locate(def, settings.toolPaths[def.id])
    return {
      id: def.id,
      label: def.label,
      path,
      version: path ? probeVersion(def, path) : null,
      required: def.required,
      purpose: def.purpose
    }
  })
  return cache
}

export function toolPath(settings: Settings, id: ToolId): string | null {
  return getTools(settings).find((t) => t.id === id)?.path ?? null
}
