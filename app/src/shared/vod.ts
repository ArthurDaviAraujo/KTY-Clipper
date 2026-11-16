import type { Platform } from './types'

export interface VodRef {
  platform: Platform
  id: string
  /** Kick: o canal vem no link (kick.com/<canal>/videos/<id>) */
  channel?: string
}

/**
 * Reconhece links de VOD:
 * - Twitch: twitch.tv/videos/123 (com ou sem ?t=)
 * - Kick: kick.com/<canal>/videos/<uuid> ou kick.com/video/<uuid>
 */
export function parseVodInput(input: string): VodRef | null {
  const s = input.trim()
  const tw = s.match(/(?:^|\/\/|\.)twitch\.tv\/videos\/(\d+)/i) ?? s.match(/^v?(\d{6,})$/)
  if (tw) return { platform: 'twitch', id: tw[1] }
  const uuid = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
  const kc = s.match(new RegExp(`kick\\.com\\/([^/?#\\s]+)\\/videos\\/${uuid}`, 'i'))
  if (kc) return { platform: 'kick', id: kc[2].toLowerCase(), channel: kc[1].toLowerCase() }
  const kv = s.match(new RegExp(`kick\\.com\\/video\\/${uuid}`, 'i'))
  if (kv) return { platform: 'kick', id: kv[1].toLowerCase() }
  return null
}

/** "1:02:03", "62:03", "3723" ou "1h2m3s" → segundos. Vazio → null. Inválido → NaN. */
export function parseTimecode(input: string): number | null {
  const s = input.trim().toLowerCase()
  if (!s) return null
  const hms = s.match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/)
  if (hms && (hms[1] || hms[2] || hms[3])) return Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0)
  if (/^\d+(:\d{1,2}){0,2}$/.test(s)) {
    const parts = s.split(':').map(Number)
    if (parts.slice(1).some((p) => p >= 60)) return NaN
    return parts.reduce((acc, p) => acc * 60 + p, 0)
  }
  return NaN
}

export function formatTimecode(seconds: number): string {
  const t = Math.max(0, Math.round(seconds))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}
