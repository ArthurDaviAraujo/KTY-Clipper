import type { Platform } from './types'

/**
 * Aceita "nome", "@nome", "twitch.tv/nome", "https://www.kick.com/nome/..." e devolve o login normalizado.
 * Quando o link é de outra plataforma, a plataforma do link vence a escolhida.
 */
export function parseChannelInput(platform: Platform, input: string): { platform: Platform; login: string } | null {
  let s = input.trim()
  if (!s) return null
  const url = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(twitch\.tv|kick\.com)\/([^/?#\s]+)/i)
  if (url) {
    platform = url[1].toLowerCase() === 'kick.com' ? 'kick' : 'twitch'
    s = url[2]
  }
  s = s.replace(/^@/, '').toLowerCase()
  const valid = platform === 'twitch' ? /^[a-z0-9_]{3,25}$/ : /^[a-z0-9_-]{2,40}$/
  if (!valid.test(s)) return null
  if (['videos', 'directory', 'settings', 'categories', 'browse'].includes(s)) return null
  return { platform, login: s }
}

export const channelUrl = (platform: Platform, login: string) => (platform === 'twitch' ? `https://www.twitch.tv/${login}` : `https://kick.com/${login}`)
