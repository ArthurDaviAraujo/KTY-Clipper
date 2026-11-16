import { httpFetch } from './http'
import { parseKickDate } from './kick'

/**
 * Clipes que os espectadores criaram (Twitch e Kick). São a prova mais forte de que um trecho foi bom.
 * Twitch: cada clipe traz a posição no VOD (videoOffsetSeconds), o VOD e a transmissão (broadcast).
 * Kick: traz a transmissão (livestream_id) e a hora de criação; a posição é estimada (fim = criação).
 */
export interface CommunityClip {
  id: string
  title: string
  views: number
  durationS: number
  /** Twitch: segundos desde o início da transmissão/VOD; null quando não informado */
  offsetS: number | null
  createdAt: number
  /** VOD (Twitch) */
  videoId: string | null
  /** Transmissão: Twitch broadcast id / Kick livestream_id */
  broadcastId: string | null
  url: string
}

const GQL_URL = 'https://gql.twitch.tv/gql'
const WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0 Safari/537.36'

/** Período de busca pela idade da live (a Twitch filtra por período). */
export function twitchClipPeriod(startedAt: number, now = Date.now()): 'LAST_DAY' | 'LAST_WEEK' | 'LAST_MONTH' | 'ALL_TIME' {
  const days = (now - startedAt) / 86_400_000
  return days <= 1 ? 'LAST_DAY' : days <= 7 ? 'LAST_WEEK' : days <= 30 ? 'LAST_MONTH' : 'ALL_TIME'
}

/** Até 100 clipes mais vistos do canal no período (a paginação da Twitch não devolve cursor sem token). */
export async function twitchClips(login: string, period: ReturnType<typeof twitchClipPeriod>): Promise<CommunityClip[]> {
  const query = `query { user(login: ${JSON.stringify(login)}) { clips(first: 100, criteria: { period: ${period}, sort: VIEWS_DESC }) { edges { node { id title viewCount createdAt durationSeconds videoOffsetSeconds url video { id } broadcast { id } } } } } }`
  const r = await httpFetch(GQL_URL, { method: 'POST', headers: { 'Client-ID': WEB_CLIENT_ID, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
  if (!r.ok) throw new Error(`Twitch respondeu ${r.status}`)
  const j = (await r.json()) as { data?: { user: { clips: { edges: { node: Record<string, any> }[] } } | null } }
  return (j.data?.user?.clips.edges ?? []).map(({ node: n }) => ({
    id: String(n.id),
    title: n.title ?? '',
    views: n.viewCount ?? 0,
    durationS: n.durationSeconds ?? 30,
    offsetS: n.videoOffsetSeconds ?? null,
    createdAt: Date.parse(n.createdAt),
    videoId: n.video?.id ?? null,
    broadcastId: n.broadcast?.id ?? null,
    url: n.url ?? ''
  }))
}

/** Clipes da Kick: os 20 mais recentes e os 20 mais vistos da semana (a página seguinte não funciona por cursor). */
export async function kickClips(slug: string): Promise<CommunityClip[]> {
  const out = new Map<string, CommunityClip>()
  for (const q of ['sort=date&time=all', 'sort=view&time=week']) {
    const r = await httpFetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/clips?${q}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (!r.ok) throw new Error(`Kick respondeu ${r.status}`)
    const j = (await r.json()) as { clips?: Record<string, any>[] }
    for (const c of j.clips ?? []) {
      out.set(String(c.id), {
        id: String(c.id),
        title: c.title ?? '',
        views: c.views ?? c.view_count ?? 0,
        durationS: c.duration ?? 30,
        offsetS: null,
        createdAt: parseKickDate(String(c.created_at)),
        videoId: null,
        broadcastId: c.livestream_id != null ? String(c.livestream_id) : null,
        url: c.clip_url ?? c.video_url ?? ''
      })
    }
  }
  return [...out.values()]
}

/**
 * Janela (hora real) do clipe dentro da live.
 * Com posição no VOD: início da live + posição. Sem: o clipe termina perto da hora em que foi criado.
 */
export function clipWindow(c: CommunityClip, liveStartedAt: number): { startUtc: number; endUtc: number } {
  if (c.offsetS != null) {
    const start = liveStartedAt + c.offsetS * 1000
    return { startUtc: start, endUtc: start + c.durationS * 1000 }
  }
  return { startUtc: c.createdAt - c.durationS * 1000, endUtc: c.createdAt }
}

/** O clipe é desta live? Pelo VOD (importado), pela transmissão (gravada) ou, sem ids, pelo horário. */
export function clipBelongs(c: CommunityClip, live: { vodId: string | null; broadcastId: string | null; startUtc: number; endUtc: number }): boolean {
  if (live.vodId && c.videoId) return c.videoId === live.vodId
  if (live.broadcastId && c.broadcastId) return c.broadcastId === live.broadcastId
  return c.createdAt >= live.startUtc && c.createdAt <= live.endUtc + 120_000
}
