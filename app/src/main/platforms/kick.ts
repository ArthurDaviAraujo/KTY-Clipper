import type { LiveInfo, RecordQuality } from '../../shared/types'
import { httpFetch } from './http'

export interface HlsVariant {
  url: string
  width: number
  height: number
  fps: number
  bandwidth: number
}

/**
 * Lê as resoluções de uma playlist mestre HLS (#EXT-X-STREAM-INF seguido da URL).
 * Na Kick o áudio vem junto de cada resolução; as faixas de idioma extras são legendas automáticas.
 */
export function parseMasterPlaylist(text: string, baseUrl: string): HlsVariant[] {
  const lines = text.split(/\r?\n/)
  const out: HlsVariant[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l.startsWith('#EXT-X-STREAM-INF:')) continue
    const uri = lines.slice(i + 1).find((x) => x.trim() && !x.startsWith('#'))
    if (!uri) continue
    const res = l.match(/RESOLUTION=(\d+)x(\d+)/)
    const fps = l.match(/FRAME-RATE=([\d.]+)/)
    // BANDWIDTH logo após ":" ou ",", para não confundir com AVERAGE-BANDWIDTH
    const bw = l.match(/[:,]BANDWIDTH=(\d+)/)
    out.push({
      url: new URL(uri.trim(), baseUrl).href,
      width: res ? Number(res[1]) : 0,
      height: res ? Number(res[2]) : 0,
      fps: fps ? Math.round(Number(fps[1])) : 0,
      bandwidth: bw ? Number(bw[1]) : 0
    })
  }
  return out
}

/** A maior resolução até o limite ('best' = sem limite: pega 4K/2K se existir). Se nada couber, a menor. */
export function pickVariant(variants: HlsVariant[], quality: RecordQuality): HlsVariant | null {
  if (!variants.length) return null
  const cap = quality === 'best' ? Infinity : Number(quality)
  const rank = (v: HlsVariant) => [v.height, v.fps, v.bandwidth]
  const better = (a: HlsVariant, b: HlsVariant) => {
    const ra = rank(a)
    const rb = rank(b)
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i]
    return false
  }
  const fit = variants.filter((v) => v.height <= cap)
  const pool = fit.length ? fit : [variants.reduce((a, b) => (a.height <= b.height ? a : b))]
  return pool.reduce((best, v) => (better(v, best) ? v : best))
}

export interface KickVodInfo {
  uuid: string
  /** Playlist mestre HLS do VOD */
  source: string
  title: string
  game: string | null
  startedAt: number
  durationS: number
  channelSlug: string | null
  /** Id da transmissão (casa com o livestream_id dos clipes) */
  livestreamId: string | null
}

/** VOD da Kick pela API v1 do site (o yt-dlp não abre mais VODs da Kick: NOT_FOUND, 2026-11-16). */
export async function kickVodInfo(uuid: string): Promise<KickVodInfo | null> {
  const r = await httpFetch(`https://kick.com/api/v1/video/${encodeURIComponent(uuid)}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`Kick respondeu ${r.status}`)
  const j = (await r.json()) as Record<string, any>
  if (!j.source) return null
  const ls = j.livestream ?? {}
  const start = ls.start_time ?? ls.created_at ?? j.created_at
  return {
    uuid,
    source: j.source,
    title: ls.session_title ?? '',
    game: ls.categories?.[0]?.name ?? null,
    startedAt: parseKickDate(String(start)),
    // A Kick informa a duração em milissegundos
    durationS: Math.round((ls.duration ?? 0) / 1000),
    channelSlug: ls.channel?.slug ?? null,
    livestreamId: ls.id != null ? String(ls.id) : null
  }
}

/** Busca a playlist mestre da live e escolhe a resolução. */
export async function resolveKickVariant(playbackUrl: string, quality: RecordQuality): Promise<HlsVariant | null> {
  const r = await httpFetch(playbackUrl, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`Playlist da Kick respondeu ${r.status}`)
  return pickVariant(parseMasterPlaylist(await r.text(), playbackUrl), quality)
}

/**
 * Status de canais da Kick pela API v2 que o site usa (não oficial, sem chave).
 * A resposta já traz o link HLS da live (playback_url), usado direto pelo gravador.
 * O chat da Kick fica para a etapa 1c: o site trocou o sistema em tempo real (Pusher/Centrifugo
 * com credenciais vindas do servidor) e precisa ser estudado com calma.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0 Safari/537.36'

/**
 * A Kick mistura "2026-11-15T22:58:58+00:00" e "2026-11-15 22:59:03" (UTC sem fuso).
 * Sem fuso, o Date.parse leria como hora local; aqui sempre vira UTC.
 */
export function parseKickDate(s: string): number {
  const iso = s.trim().replace(' ', 'T')
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`)
}

export interface KickChatMessage {
  id: string
  time: number
  user: string
  text: string
  emotes: number
}

/** "[emote:37226:KEKW] boa" → { text: "KEKW boa", emotes: 1 } (os nomes dos emotes ajudam a detectar risadas). */
export function kickContent(content: string): { text: string; emotes: number } {
  let emotes = 0
  const text = content.replace(/\[emote:\d+:([^\]]+)\]/g, (_, name: string) => {
    emotes++
    return name
  })
  return { text, emotes }
}

/** Com `start_time`, a Kick devolve só as mensagens de uma janela curta (~4–5 s) depois daquele instante. */
export const KICK_WINDOW_MS = 4000

/**
 * Até 25 mensagens do chat a partir de `startMs` (ou as mais recentes, sem `startMs`).
 * Histórico do site (não oficial), sem chave; serve para live e para VOD (testado em 2026-11-16).
 */
export async function kickChatPage(channelId: number, startMs?: number, signal?: AbortSignal): Promise<KickChatMessage[]> {
  const q = startMs != null ? `?start_time=${encodeURIComponent(new Date(startMs).toISOString())}` : ''
  const r = await httpFetch(`https://kick.com/api/v2/channels/${channelId}/messages${q}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal })
  if (r.status === 429) throw new Error('Kick pediu para ir mais devagar (429)')
  if (!r.ok) throw new Error(`Chat da Kick respondeu ${r.status}`)
  const j = (await r.json()) as { data?: { messages?: Record<string, any>[] } }
  return (j.data?.messages ?? [])
    .map((m) => {
      const c = kickContent(String(m.content ?? ''))
      return { id: String(m.id), time: parseKickDate(String(m.created_at)), user: m.sender?.username ?? 'desconhecido', text: c.text, emotes: c.emotes }
    })
    .sort((a, b) => a.time - b.time)
}

/**
 * Próximo instante a pedir ao chat da Kick.
 * - Avançou: continua da última mensagem; página cheia = ainda tem mais, pedir logo (`full`).
 * - Janela vazia ou parada (chat calmo): anda assim mesmo, senão pediria a mesma janela vazia para sempre
 *   (bug visto em 2026-11-16: travou em 12 mensagens). Nunca passa de 2 s antes de agora.
 */
export function nextKickCursor(cursor: number, page: { time: number }[], now: number): { cursor: number; full: boolean } {
  const last = page.at(-1)?.time
  if (last != null && last > cursor) return { cursor: last, full: page.length >= 25 }
  return { cursor: Math.max(cursor, Math.min(cursor + (page.length >= 25 ? 1000 : KICK_WINDOW_MS), now - 2000)), full: false }
}

/**
 * Lê o chat de uma live da Kick pelo histórico, avançando no tempo.
 * Com chat rápido (25 mensagens por página) pede de novo na hora; com chat calmo espera alguns segundos.
 */
export class KickChatPoller {
  private seen = new Set<string>()
  private stopped = false
  private cursor: number

  constructor(
    private channelId: number,
    private onMessages: (msgs: KickChatMessage[]) => void,
    private onError: (e: Error) => void
  ) {
    // Começa alguns segundos atrás para não perder o que chegou enquanto a gravação abria
    this.cursor = Date.now() - 5000
  }

  start(): void {
    void this.loop()
  }

  stop(): void {
    this.stopped = true
  }

  private async loop(): Promise<void> {
    let backoff = 3000
    while (!this.stopped) {
      try {
        const page = await kickChatPage(this.channelId, this.cursor)
        const fresh = page.filter((m) => !this.seen.has(m.id))
        for (const m of fresh) this.seen.add(m.id)
        if (this.seen.size > 20_000) this.seen = new Set(fresh.map((m) => m.id))
        if (fresh.length) this.onMessages(fresh)
        const next = nextKickCursor(this.cursor, page, Date.now())
        this.cursor = next.cursor
        const full = next.full
        backoff = 3000
        await new Promise((r) => setTimeout(r, full ? 250 : 3000))
      } catch (e) {
        this.onError(e as Error)
        await new Promise((r) => setTimeout(r, backoff))
        backoff = Math.min(60_000, backoff * 2)
      }
    }
  }
}

export interface KickChannel {
  /** Id numérico do canal (usado no chat) */
  channelId: number
  login: string
  displayName: string
  avatarUrl: string | null
  live: LiveInfo | null
  playbackUrl: string | null
  chatroomId: number | null
}

interface KickApi {
  id: number
  slug: string
  playback_url: string | null
  user?: { username?: string; profile_pic?: string | null }
  chatroom?: { id?: number }
  livestream: {
    id: number
    session_title: string | null
    created_at: string
    viewer_count: number
    is_live: boolean
    categories?: { name: string }[]
  } | null
}

/** Canal inexistente volta null. */
export async function kickStatus(slug: string, signal?: AbortSignal): Promise<KickChannel | null> {
  const r = await httpFetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`Kick respondeu ${r.status}`)
  const j = (await r.json()) as KickApi
  const ls = j.livestream && j.livestream.is_live ? j.livestream : null
  return {
    channelId: j.id,
    login: j.slug,
    displayName: j.user?.username ?? j.slug,
    avatarUrl: j.user?.profile_pic ?? null,
    playbackUrl: ls ? j.playback_url : null,
    chatroomId: j.chatroom?.id ?? null,
    live: ls
      ? {
          streamId: String(ls.id),
          title: ls.session_title ?? '',
          game: ls.categories?.[0]?.name ?? null,
          viewers: ls.viewer_count,
          startedAt: parseKickDate(ls.created_at),
          isRerun: false
        }
      : null
  }
}
