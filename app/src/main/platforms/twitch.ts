import { EventEmitter } from 'events'
import { langCode } from '../../shared/lang'
import type { LiveInfo } from '../../shared/types'
import { httpFetch } from './http'

/**
 * Status dos canais pela API GraphQL que o próprio site da Twitch usa (não oficial, sem chave).
 * Fica isolado aqui: se quebrar, troca-se por Helix (oficial, com Client ID) sem mexer no resto.
 */
const GQL_URL = 'https://gql.twitch.tv/gql'
const WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

export interface TwitchChannel {
  login: string
  displayName: string
  avatarUrl: string | null
  live: LiveInfo | null
}

interface GqlUser {
  login: string
  displayName: string
  profileImageURL: string | null
  stream: { id: string; title: string | null; createdAt: string; viewersCount: number; type: string; game: { name: string } | null } | null
  broadcastSettings?: { language?: string | null } | null
}

/** Consulta até 30 canais por chamada. Canal inexistente volta como null. */
export async function twitchStatus(logins: string[], signal?: AbortSignal): Promise<Map<string, TwitchChannel | null>> {
  const out = new Map<string, TwitchChannel | null>()
  for (let i = 0; i < logins.length; i += 30) {
    const batch = logins.slice(i, i + 30)
    const query = `query { ${batch
      .map(
        (l, j) =>
          `u${j}: user(login: ${JSON.stringify(l)}) { login displayName profileImageURL(width: 70) broadcastSettings { language } stream { id title createdAt viewersCount type game { name } } }`
      )
      .join(' ')} }`
    const r = await httpFetch(GQL_URL, {
      method: 'POST',
      headers: { 'Client-ID': WEB_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal
    })
    if (!r.ok) throw new Error(`Twitch respondeu ${r.status}`)
    const json = (await r.json()) as { data?: Record<string, GqlUser | null>; errors?: { message: string }[] }
    if (!json.data) throw new Error(`Twitch: ${json.errors?.[0]?.message ?? 'resposta vazia'}`)
    batch.forEach((login, j) => {
      const u = json.data![`u${j}`]
      out.set(login, u ? toChannel(u) : null)
    })
  }
  return out
}

function toChannel(u: GqlUser): TwitchChannel {
  const s = u.stream
  return {
    login: u.login,
    displayName: u.displayName,
    avatarUrl: u.profileImageURL,
    live: s
      ? {
          streamId: s.id,
          title: s.title ?? '',
          game: s.game?.name ?? null,
          viewers: s.viewersCount,
          startedAt: Date.parse(s.createdAt),
          isRerun: s.type !== 'live',
          // "PT", "EN"… (idioma escolhido pelo streamer nas configurações da Twitch)
          language: langCode(u.broadcastSettings?.language)
        }
      : null
  }
}

export interface TwitchVodInfo {
  id: string
  title: string
  lengthSeconds: number
  createdAt: number
  /** RECORDED = terminado; RECORDING = a live ainda está no ar */
  status: string
  game: string | null
  owner: { login: string; displayName: string; avatarUrl: string | null } | null
}

export async function twitchVodInfo(id: string): Promise<TwitchVodInfo | null> {
  const query = `query { video(id: ${JSON.stringify(id)}) { id title lengthSeconds createdAt status game { name } owner { login displayName profileImageURL(width: 70) } } }`
  const r = await httpFetch(GQL_URL, { method: 'POST', headers: { 'Client-ID': WEB_CLIENT_ID, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
  if (!r.ok) throw new Error(`Twitch respondeu ${r.status}`)
  const v = ((await r.json()) as { data?: { video: Record<string, any> | null } }).data?.video
  if (!v) return null
  return {
    id: v.id,
    title: v.title ?? '',
    lengthSeconds: v.lengthSeconds ?? 0,
    createdAt: Date.parse(v.createdAt),
    status: v.status ?? '',
    game: v.game?.name ?? null,
    owner: v.owner ? { login: v.owner.login, displayName: v.owner.displayName, avatarUrl: v.owner.profileImageURL ?? null } : null
  }
}

/**
 * Capítulos do VOD: cada troca de categoria com o ponto do vídeo em que começou.
 * VOD sem capítulos (uma categoria só) volta vazio.
 */
export async function twitchVodChapters(id: string): Promise<{ positionMs: number; game: string | null }[]> {
  const query = `query { video(id: ${JSON.stringify(id)}) { moments(first: 100, momentRequestType: VIDEO_CHAPTER_MARKERS) { edges { node { positionMilliseconds type description details { ... on GameChangeMomentDetails { game { name } } } } } } } }`
  const r = await httpFetch(GQL_URL, { method: 'POST', headers: { 'Client-ID': WEB_CLIENT_ID, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
  if (!r.ok) throw new Error(`Twitch respondeu ${r.status}`)
  const edges = ((await r.json()) as { data?: { video: { moments?: { edges?: { node: Record<string, any> }[] } } | null } }).data?.video?.moments?.edges ?? []
  return edges
    .map((e) => e.node)
    .filter((n) => n?.type === 'GAME_CHANGE' && Number.isFinite(n.positionMilliseconds))
    .map((n) => ({ positionMs: n.positionMilliseconds as number, game: (n.details?.game?.name ?? n.description ?? null) as string | null }))
    .sort((a, b) => a.positionMs - b.positionMs)
}

export interface VodComment {
  id: string
  /** Segundos desde o início do VOD */
  offset: number
  user: string
  text: string
  emotes: number
}

/**
 * Uma página do chat do VOD a partir de `offsetSeconds`.
 * Paginar por cursor ("after") cai na verificação de integridade da Twitch (testado em 2026-11-16);
 * por tempo funciona: a próxima página começa no segundo da última mensagem, e as repetidas saem pelo id.
 */
export async function twitchVodComments(videoId: string, offsetSeconds: number, signal?: AbortSignal): Promise<{ comments: VodComment[]; hasNext: boolean }> {
  const query = `query { video(id: ${JSON.stringify(videoId)}) { comments(contentOffsetSeconds: ${Math.max(0, Math.floor(offsetSeconds))}) { edges { node { id contentOffsetSeconds commenter { displayName } message { fragments { text emote { emoteID } } } } } pageInfo { hasNextPage } } } }`
  const r = await httpFetch(GQL_URL, { method: 'POST', headers: { 'Client-ID': WEB_CLIENT_ID, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal })
  if (!r.ok) throw new Error(`Twitch respondeu ${r.status}`)
  const json = (await r.json()) as { data?: { video: { comments: { edges: { node: any }[]; pageInfo: { hasNextPage: boolean } } } | null }; errors?: { message: string }[] }
  if (json.errors?.length) throw new Error(`Chat do VOD: ${json.errors[0].message}`)
  const c = json.data?.video?.comments
  if (!c) return { comments: [], hasNext: false }
  return {
    hasNext: c.pageInfo.hasNextPage,
    comments: c.edges.map(({ node: n }) => {
      const frags: { text: string; emote: unknown }[] = n.message?.fragments ?? []
      return {
        id: n.id,
        offset: n.contentOffsetSeconds,
        user: n.commenter?.displayName ?? 'desconhecido',
        text: frags.map((f) => f.text).join(''),
        emotes: frags.filter((f) => f.emote).length
      }
    })
  }
}

/**
 * Próximo ponto de leitura: o segundo da última mensagem; se não avançou, pula `emptyStep`
 * segundos para não ficar parado (Twitch: 1 s; Kick: a janela de ~4 s que ela devolve).
 */
export function nextCommentOffset(current: number, comments: VodComment[], emptyStep = 1): number {
  const last = comments.at(-1)?.offset ?? current
  return last > current ? last : current + (comments.length ? 1 : emptyStep)
}

export interface ChatMessage {
  channel: string
  time: number
  user: string
  text: string
  emotes: number
}

/** Uma linha IRC com tags (PRIVMSG) vira mensagem; o resto é ignorado. */
export function parseIrcLine(line: string): ChatMessage | null {
  const m = line.match(/^@(\S+) :([^!]+)!\S+ PRIVMSG #(\S+) :(.*)$/)
  if (!m) return null
  const tags = Object.fromEntries(
    m[1].split(';').map((kv) => {
      const i = kv.indexOf('=')
      return [kv.slice(0, i), kv.slice(i + 1)]
    })
  )
  const emotes = tags.emotes ? tags.emotes.split('/').reduce((n, e) => n + (e.split(':')[1]?.split(',').length ?? 0), 0) : 0
  const ts = Number(tags['tmi-sent-ts'])
  return {
    channel: m[3].toLowerCase(),
    time: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
    user: tags['display-name'] || m[2],
    text: m[4],
    emotes
  }
}

/**
 * Leitor do chat pelo IRC oficial da Twitch, em modo anônimo (justinfan): só lê, não precisa de conta.
 * Reconecta sozinho com espera crescente e entra de novo nos canais.
 */
export class TwitchChat extends EventEmitter {
  private ws: WebSocket | null = null
  private channels = new Set<string>()
  private backoff = 1000
  private closed = false
  private pingTimer: NodeJS.Timeout | null = null

  join(login: string): void {
    this.channels.add(login)
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(`JOIN #${login}`)
    else this.connect()
  }

  part(login: string): void {
    this.channels.delete(login)
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(`PART #${login}`)
    if (this.channels.size === 0) this.disconnect()
  }

  close(): void {
    this.closed = true
    this.disconnect()
  }

  private disconnect(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    const ws = this.ws
    this.ws = null
    ws?.close()
  }

  private connect(): void {
    if (this.closed || this.ws) return
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443')
    this.ws = ws
    ws.addEventListener('open', () => {
      this.backoff = 1000
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
      ws.send('PASS SCHMOOPIIE')
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 89999)}`)
      for (const c of this.channels) ws.send(`JOIN #${c}`)
      this.pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('PING :clipador'), 240_000)
      this.emit('status', 'connected')
    })
    ws.addEventListener('message', (e) => {
      for (const line of String(e.data).split('\r\n')) {
        if (!line) continue
        if (line.startsWith('PING')) ws.send('PONG :tmi.twitch.tv')
        else if (line.includes(' RECONNECT')) ws.close()
        else {
          const msg = parseIrcLine(line)
          if (msg) this.emit('message', msg)
        }
      }
    })
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.pingTimer = null
      if (this.closed || this.channels.size === 0) return
      this.emit('status', 'reconnecting')
      setTimeout(() => this.connect(), this.backoff)
      this.backoff = Math.min(60_000, this.backoff * 2)
    })
    ws.addEventListener('error', () => {
      // O evento close vem logo depois e cuida da reconexão
    })
  }
}

/** Busca de canais do site da Twitch (os mais parecidos com o que foi digitado). */
export async function twitchSearch(text: string, signal?: AbortSignal): Promise<import('../../shared/types').ChannelHit[]> {
  const query = `query { searchFor(userQuery: ${JSON.stringify(text)}, platform: "web", options: { targets: [{ index: CHANNEL }] }) { channels { items { login displayName description profileImageURL(width: 70) followers { totalCount } stream { id } } } } }`
  const r = await httpFetch(GQL_URL, { method: 'POST', headers: { 'Client-ID': WEB_CLIENT_ID, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal })
  if (!r.ok) throw new Error(`Twitch respondeu ${r.status}`)
  const j = (await r.json()) as {
    data?: { searchFor?: { channels?: { items?: { login: string; displayName: string; description: string | null; profileImageURL: string | null; followers: { totalCount: number } | null; stream: { id: string } | null }[] } } }
  }
  return (j.data?.searchFor?.channels?.items ?? []).slice(0, 8).map((c) => ({
    platform: 'twitch' as const,
    login: c.login.toLowerCase(),
    displayName: c.displayName,
    avatarUrl: c.profileImageURL,
    followers: c.followers?.totalCount ?? null,
    live: !!c.stream,
    description: (c.description ?? '').slice(0, 200)
  }))
}
