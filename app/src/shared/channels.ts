import type { Platform } from './types'

export const PLATFORM_NAME: Record<Platform, string> = { twitch: 'Twitch', kick: 'Kick', youtube: 'YouTube' }

/** Plataforma de um link de canal ou de vídeo (null = não é link de nenhuma). */
export function platformOfLink(input: string): Platform | null {
  const m = input.trim().match(/^(?:https?:\/\/)?(?:www\.|m\.)?(twitch\.tv|kick\.com|youtube\.com|youtu\.be)\b/i)
  if (!m) return null
  const host = m[1].toLowerCase()
  return host === 'kick.com' ? 'kick' : host === 'twitch.tv' ? 'twitch' : 'youtube'
}

const YT_HANDLE = /^[a-z0-9._-]{3,30}$/
const RESERVED = ['videos', 'directory', 'settings', 'categories', 'browse', 'watch', 'live', 'shorts', 'results', 'feed', 'playlist']

/**
 * Aceita "nome", "@nome", "twitch.tv/nome", "https://www.kick.com/nome/...", "youtube.com/@nome",
 * "youtube.com/channel/UC…" e devolve o login normalizado. Quando o link é de outra plataforma, a do link vence a escolhida.
 * YouTube: o login é o @ (sem a arroba) ou o id "UC…"; links antigos (/c/, /user/) voltam como "c/nome" para o app descobrir o @.
 */
export function parseChannelInput(platform: Platform, input: string): { platform: Platform; login: string } | null {
  let s = input.trim()
  if (!s) return null
  const yt = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(@[^/?#\s]+|channel\/(UC[\w-]{22})|(?:c|user)\/[^/?#\s]+)/i)
  if (yt) {
    if (yt[2]) return { platform: 'youtube', login: yt[2] }
    const part = decodeURIComponent(yt[1])
    if (part.startsWith('@')) {
      const h = part.slice(1).toLowerCase()
      return YT_HANDLE.test(h) ? { platform: 'youtube', login: h } : null
    }
    return { platform: 'youtube', login: part.replace(/^(c|user)\//i, (x) => x.toLowerCase()) }
  }
  const url = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(twitch\.tv|kick\.com)\/([^/?#\s]+)/i)
  if (url) {
    platform = url[1].toLowerCase() === 'kick.com' ? 'kick' : 'twitch'
    s = url[2]
  }
  if (platform === 'youtube') {
    if (/^UC[\w-]{22}$/.test(s)) return { platform, login: s }
    const h = s.replace(/^@/, '').toLowerCase()
    return YT_HANDLE.test(h) && !RESERVED.includes(h) ? { platform, login: h } : null
  }
  s = s.replace(/^@/, '').toLowerCase()
  const valid = platform === 'twitch' ? /^[a-z0-9_]{3,25}$/ : /^[a-z0-9_-]{2,40}$/
  if (!valid.test(s)) return null
  if (RESERVED.includes(s)) return null
  return { platform, login: s }
}

/** Onde está ao vivo, em português: "em todas", "na Twitch", "na Twitch e Kick", "na Twitch, Kick e YouTube". */
export function wherePlatforms(on: Platform[], total: number): string {
  if (on.length > 1 && on.length === total) return 'em todas'
  const names = on.map((p) => PLATFORM_NAME[p])
  return `na ${names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : (names[0] ?? '')}`
}

/** Nome comparável: sem acento, sem maiúsculas e sem espaços ou símbolos ("Cazé TV" = "cazetv"). */
export const sameStreamerKey = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/**
 * Junta o mesmo streamer em várias plataformas (mesmo nome) num grupo só.
 * Os grupos ficam na ordem em que foram adicionados (o primeiro canal de cada um), e dentro do grupo também.
 */
export function groupChannels<T extends { id: number; displayName: string; login: string }>(channels: T[]): T[][] {
  const groups = new Map<string, T[]>()
  for (const c of [...channels].sort((a, b) => a.id - b.id)) {
    const key = sameStreamerKey(c.displayName) || sameStreamerKey(c.login) || `id${c.id}`
    const g = groups.get(key)
    if (g) g.push(c)
    else groups.set(key, [c])
  }
  return [...groups.values()]
}

export function channelUrl(platform: Platform, login: string): string {
  if (platform === 'twitch') return `https://www.twitch.tv/${login}`
  if (platform === 'kick') return `https://kick.com/${login}`
  return `https://www.youtube.com/${/^UC[\w-]{22}$/.test(login) ? `channel/${login}` : login.includes('/') ? login : `@${login}`}`
}
