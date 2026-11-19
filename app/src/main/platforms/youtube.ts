/**
 * YouTube sem chave de API: lê as mesmas páginas e o mesmo endpoint de chat que o site usa
 * (medido em 2026-11-17 com lives reais da CazéTV e do Gaules).
 * - Ao vivo: a página "<canal>/live" abre a live quando ela está no ar (ytInitialPlayerResponse.videoDetails.isLive).
 * - Chat ao vivo: página live_chat → continuação "Chat ao vivo" → youtubei/v1/live_chat/get_live_chat (a cada ~10 s).
 * - Replay do chat de uma live que acabou: youtubei/v1/live_chat/get_live_chat_replay, em páginas com o segundo de cada mensagem.
 */
import { httpFetch } from './http'
import type { LiveInfo } from '../../shared/types'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
// Cookies de consentimento: sem eles, em alguns países a página vem com a tela "Antes de continuar"
const PAGE_HEADERS = { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8', Cookie: 'CONSENT=YES+1; SOCS=CAI' }

/** Login do canal: o @ (sem a arroba, minúsculo) ou o id "UC…" quando o canal não tem @. */
export const isChannelId = (login: string) => /^UC[\w-]{22}$/.test(login)
export const youtubeChannelUrl = (login: string) => `https://www.youtube.com/${isChannelId(login) ? `channel/${login}` : `@${login}`}`
export const youtubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`

/** Acha `var nome = {...}` (ou `window["nome"] = {...}`) no HTML e lê o JSON contando as chaves (um regex cortaria no meio). */
export function extractJson(html: string, name: string): any | null {
  const i = html.search(new RegExp(`(?:var |window\\["?)${name}"?\\]?\\s*=\\s*\\{`))
  if (i < 0) return null
  const start = html.indexOf('{', i)
  let depth = 0
  let inStr = false
  let esc = false
  for (let j = start; j < html.length; j++) {
    const ch = html[j]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, j + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

const meta = (html: string, prop: string) => html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`))?.[1] ?? null
const unescapeHtml = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

async function getPage(url: string, signal?: AbortSignal): Promise<{ status: number; url: string; html: string }> {
  const r = await httpFetch(url, { headers: PAGE_HEADERS, signal, redirect: 'follow' })
  return { status: r.status, url: r.url, html: await r.text() }
}

/** "39.463" / "1,2 mil" / "39,463 watching" → número de pessoas assistindo. */
export function parseViewers(text: string | null | undefined): number {
  if (!text) return 0
  const t = text.toLowerCase()
  const m = t.match(/([\d.,]+)\s*(mil|k|mi|m)?/)
  if (!m) return 0
  const mult = m[2] === 'mil' || m[2] === 'k' ? 1000 : m[2] === 'mi' || m[2] === 'm' ? 1_000_000 : 1
  // Com multiplicador, a vírgula é decimal ("1,2 mil"); sem ele, pontos e vírgulas separam milhares
  const n = mult > 1 ? Number(m[1].replace(',', '.')) : Number(m[1].replace(/[.,]/g, ''))
  return Number.isFinite(n) ? Math.round(n * mult) : 0
}

/** Login a partir do link do dono ("http://www.youtube.com/@CazeTV") ou do id do canal. */
export function loginFromOwner(ownerUrl: string | null | undefined, channelId: string | null | undefined): string | null {
  const h = ownerUrl?.match(/\/@([^/?#]+)/)?.[1]
  if (h) return decodeURIComponent(h).toLowerCase()
  return channelId && isChannelId(channelId) ? channelId : null
}

export interface YoutubeChannel {
  login: string
  channelId: string | null
  displayName: string
  avatarUrl: string | null
}

/** Nome, foto e o login certo (o @ do canal) a partir de um @, id "UC…" ou nome antigo (/c/, /user/). */
export async function youtubeChannelInfo(input: string, signal?: AbortSignal): Promise<YoutubeChannel | null> {
  const path = isChannelId(input) ? `channel/${input}` : input.startsWith('c/') || input.startsWith('user/') ? input : `@${input}`
  const p = await getPage(`https://www.youtube.com/${path}`, signal)
  if (p.status === 404) return null
  if (p.status >= 400) throw new Error(`YouTube respondeu ${p.status}.`)
  const channelId = p.html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)?.[1] ?? p.html.match(/"externalId":"(UC[\w-]{22})"/)?.[1] ?? null
  if (!channelId) return null
  const handle = p.html.match(/"canonicalBaseUrl":"\/@([^"]+)"/)?.[1] ?? p.html.match(/"vanityChannelUrl":"https?:\/\/www\.youtube\.com\/@([^"]+)"/)?.[1]
  const name = meta(p.html, 'og:title')
  return {
    login: handle ? decodeURIComponent(handle).toLowerCase() : channelId,
    channelId,
    displayName: name ? unescapeHtml(name) : (handle ?? channelId),
    avatarUrl: meta(p.html, 'og:image')
  }
}

export interface YoutubeLiveStatus {
  displayName: string | null
  avatarUrl: string | null
  live: LiveInfo | null
}

/**
 * Está ao vivo? Abre "<canal>/live": no ar, é a página da live; fora do ar, é a página do canal
 * (ou uma live agendada, que não conta). O nome do jogo não vem nesta página: fica a categoria do YouTube.
 */
export async function youtubeStatus(login: string, signal?: AbortSignal): Promise<YoutubeLiveStatus | null> {
  const p = await getPage(`${youtubeChannelUrl(login)}/live`, signal)
  if (p.status === 404) return null
  if (p.status >= 400) throw new Error(`YouTube respondeu ${p.status}.`)
  const player = extractJson(p.html, 'ytInitialPlayerResponse')
  const v = player?.videoDetails
  const mf = player?.microformat?.playerMicroformatRenderer
  const live = !!v?.isLive && !v?.isUpcoming && player?.playabilityStatus?.status !== 'LIVE_STREAM_OFFLINE'
  if (!live) {
    const name = meta(p.html, 'og:title')
    return { displayName: name ? unescapeHtml(name) : null, avatarUrl: meta(p.html, 'og:image'), live: null }
  }
  const watching = p.html.match(/"videoViewCountRenderer":\{"viewCount":\{"runs":\[\{"text":"([^"]+)"/)?.[1]
  const started = Date.parse(mf?.liveBroadcastDetails?.startTimestamp ?? '')
  return {
    displayName: v.author ?? null,
    // Na página da live, og:image é a capa do vídeo, não a foto do canal
    avatarUrl: null,
    live: {
      streamId: String(v.videoId),
      title: String(v.title ?? ''),
      game: mf?.category ?? null,
      viewers: parseViewers(watching) || Number(v.viewCount) || 0,
      startedAt: Number.isFinite(started) ? started : Date.now(),
      isRerun: false
    }
  }
}

export interface YoutubeChatMessage {
  id: string
  time: number
  user: string
  text: string
  emotes: number
}

/** Uma mensagem do chat (comum ou Super Chat) no formato do app; outras ações (entradas, avisos) ficam de fora. */
export function chatItem(item: any): Omit<YoutubeChatMessage, 'time'> & { usec: number } | null {
  const r = item?.liveChatTextMessageRenderer ?? item?.liveChatPaidMessageRenderer
  if (!r?.id) return null
  const runs: any[] = r.message?.runs ?? []
  const text = runs.map((x) => x.text ?? x.emoji?.shortcuts?.[0] ?? '').join('').trim()
  return {
    id: String(r.id),
    usec: Number(r.timestampUsec) || 0,
    user: String(r.authorName?.simpleText ?? '').replace(/^@/, '') || 'anônimo',
    text,
    emotes: runs.filter((x) => x.emoji).length
  }
}

interface ChatSession {
  apiKey: string
  clientVersion: string
}

function session(html: string): ChatSession {
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1]
  const clientVersion = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1]
  if (!apiKey || !clientVersion) throw new Error('Não deu para abrir o chat do YouTube (página mudou).')
  return { apiKey, clientVersion }
}

async function innertube(s: ChatSession, endpoint: string, body: object, signal?: AbortSignal): Promise<any> {
  const r = await httpFetch(`https://www.youtube.com/youtubei/v1/live_chat/${endpoint}?key=${s.apiKey}&prettyPrint=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'X-YouTube-Client-Name': '1', 'X-YouTube-Client-Version': s.clientVersion, Origin: 'https://www.youtube.com' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: s.clientVersion, hl: 'pt' } }, ...body }),
    signal
  })
  if (!r.ok) throw new Error(`Chat do YouTube respondeu ${r.status}.`)
  return r.json()
}

/**
 * Lê o chat de uma live do YouTube. Usa a visão "Chat ao vivo" (todas as mensagens), não "Principais mensagens".
 * O YouTube diz quanto esperar entre os pedidos (timeoutMs, ~10 s); aqui fica entre 2 e 8 s.
 */
export class YoutubeChatPoller {
  private seen = new Set<string>()
  private stopped = false
  private readonly since = Date.now() - 5000

  constructor(
    private videoId: string,
    private onMessages: (msgs: YoutubeChatMessage[]) => void,
    private onError: (e: Error) => void
  ) {}

  start(): void {
    void this.loop()
  }

  stop(): void {
    this.stopped = true
  }

  private emit(actions: any[]): void {
    const fresh: YoutubeChatMessage[] = []
    for (const a of actions ?? []) {
      const m = chatItem(a.addChatItemAction?.item)
      // Ao abrir, o chat traz as últimas mensagens de minutos atrás: só entra o que veio depois do começo da gravação
      if (!m || this.seen.has(m.id) || m.usec / 1000 < this.since) continue
      this.seen.add(m.id)
      fresh.push({ id: m.id, time: Math.round(m.usec / 1000), user: m.user, text: m.text, emotes: m.emotes })
    }
    if (this.seen.size > 20_000) this.seen = new Set(fresh.map((m) => m.id))
    if (fresh.length) this.onMessages(fresh)
  }

  private async open(): Promise<{ s: ChatSession; continuation: string }> {
    const p = await getPage(`https://www.youtube.com/live_chat?is_popout=1&v=${this.videoId}`)
    const s = session(p.html)
    const data = extractJson(p.html, 'ytInitialData')
    const lc = data?.contents?.liveChatRenderer
    if (!lc) throw new Error('Esta live não tem chat aberto.')
    this.emit(lc.actions)
    const items: any[] = lc.header?.liveChatHeaderRenderer?.viewSelector?.sortFilterSubMenuRenderer?.subMenuItems ?? []
    const all = items[1]?.continuation?.reloadContinuationData?.continuation
    const c = lc.continuations?.[0]
    const continuation = all ?? c?.invalidationContinuationData?.continuation ?? c?.timedContinuationData?.continuation
    if (!continuation) throw new Error('Esta live não tem chat aberto.')
    return { s, continuation }
  }

  private async loop(): Promise<void> {
    let backoff = 5000
    let state: { s: ChatSession; continuation: string } | null = null
    while (!this.stopped) {
      try {
        state ??= await this.open()
        const j = await innertube(state.s, 'get_live_chat', { continuation: state.continuation })
        const lc = j.continuationContents?.liveChatContinuation
        if (!lc) {
          // Continuação vencida (ou a live acabou): abre o chat de novo
          state = null
          await new Promise((r) => setTimeout(r, 5000))
          continue
        }
        this.emit(lc.actions)
        const c = lc.continuations?.[0]
        const next = c?.invalidationContinuationData ?? c?.timedContinuationData ?? c?.reloadContinuationData
        if (next?.continuation) state.continuation = next.continuation
        backoff = 5000
        await new Promise((r) => setTimeout(r, Math.min(8000, Math.max(2000, Number(next?.timeoutMs) || 5000))))
      } catch (e) {
        state = null
        this.onError(e as Error)
        await new Promise((r) => setTimeout(r, backoff))
        backoff = Math.min(60_000, backoff * 2)
      }
    }
  }
}

export interface YoutubeVideoInfo {
  id: string
  title: string
  durationS: number
  /** Começo real da live (ou a data de publicação, para vídeo comum) */
  startedAt: number
  isLiveNow: boolean
  isUpcoming: boolean
  wasLive: boolean
  category: string | null
  channel: { login: string; displayName: string; channelId: string | null }
  /** Replay do chat (só lives que já acabaram) */
  chat: { continuation: string; session: ChatSession } | null
}

/** Dados de um vídeo (ou live que já acabou) pela página dele. */
export async function youtubeVideoInfo(id: string, signal?: AbortSignal): Promise<YoutubeVideoInfo | null> {
  const p = await getPage(youtubeWatchUrl(id), signal)
  const player = extractJson(p.html, 'ytInitialPlayerResponse')
  const v = player?.videoDetails
  if (!v?.videoId) return null
  const mf = player?.microformat?.playerMicroformatRenderer
  const live = mf?.liveBroadcastDetails
  const started = Date.parse(live?.startTimestamp ?? mf?.publishDate ?? '')
  const login = loginFromOwner(mf?.ownerProfileUrl, v.channelId) ?? String(v.channelId ?? '')
  const data = extractJson(p.html, 'ytInitialData')
  const lcr = data?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer
  // A continuação padrão (a mesma que o yt-dlp usa: medido em 2026-11-17, as duas trouxeram as mesmas 183 mensagens).
  // A de "Replay do chat ao vivo" responde 400 fora do navegador.
  const cont = lcr?.continuations?.[0]?.reloadContinuationData?.continuation
  let chat: YoutubeVideoInfo['chat'] = null
  if (cont) {
    try {
      chat = { continuation: cont, session: session(p.html) }
    } catch {
      chat = null
    }
  }
  return {
    id: String(v.videoId),
    title: String(v.title ?? ''),
    durationS: Number(v.lengthSeconds) || 0,
    startedAt: Number.isFinite(started) ? started : Date.now(),
    isLiveNow: !!v.isLive || !!live?.isLiveNow,
    isUpcoming: !!v.isUpcoming || (!!live && !live.endTimestamp && !live.isLiveNow && Number(v.lengthSeconds) === 0),
    wasLive: !!v.isLiveContent,
    category: mf?.category ?? null,
    channel: { login, displayName: String(v.author ?? login), channelId: v.channelId ?? null },
    chat
  }
}

export interface ReplayPage {
  messages: { id: string; offsetS: number; user: string; text: string; emotes: number }[]
  next: string | null
}

/** Uma página do replay do chat a partir de `offsetS` segundos do vídeo. */
export async function youtubeChatReplayPage(chat: NonNullable<YoutubeVideoInfo['chat']>, continuation: string, offsetS: number, signal?: AbortSignal): Promise<ReplayPage> {
  const j = await innertube(chat.session, 'get_live_chat_replay', { continuation, currentPlayerState: { playerOffsetMs: String(Math.max(0, Math.round(offsetS * 1000))) } }, signal)
  const lc = j.continuationContents?.liveChatContinuation
  const messages: ReplayPage['messages'] = []
  for (const a of lc?.actions ?? []) {
    const r = a.replayChatItemAction
    if (!r) continue
    const off = Number(r.videoOffsetTimeMsec) / 1000
    for (const x of r.actions ?? []) {
      const m = chatItem(x.addChatItemAction?.item)
      if (m && Number.isFinite(off)) messages.push({ id: m.id, offsetS: off, user: m.user, text: m.text, emotes: m.emotes })
    }
  }
  // Sem "liveChatReplayContinuationData" só sobra a de pular no vídeo: o replay acabou
  const next = lc?.continuations?.[0]?.liveChatReplayContinuationData?.continuation ?? null
  return { messages, next }
}

/** "1,2 mi de inscritos" / "415 mil inscritos" / "12,3K subscribers" → número. */
export function parseSubscribers(text: string | null | undefined): number | null {
  if (!text || !/inscrit|subscri/i.test(text)) return null
  const n = parseViewers(text)
  return n || null
}

/** Busca de canais do YouTube (página de resultados filtrada por canal). */
export async function youtubeSearch(text: string, signal?: AbortSignal): Promise<import('../../shared/types').ChannelHit[]> {
  const p = await getPage(`https://www.youtube.com/results?search_query=${encodeURIComponent(text)}&sp=EgIQAg%253D%253D`, signal)
  const data = extractJson(p.html, 'ytInitialData')
  const found: any[] = []
  const walk = (o: any) => {
    if (!o || typeof o !== 'object' || found.length >= 8) return
    if (o.channelRenderer) {
      found.push(o.channelRenderer)
      return
    }
    for (const v of Object.values(o)) walk(v)
  }
  walk(data)
  return found.map((c) => {
    const url: string = c.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url ?? c.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ?? ''
    const handle = url.match(/^\/@([^/?#]+)/)?.[1]
    const thumbs: { url: string }[] = c.thumbnail?.thumbnails ?? []
    const thumb = thumbs.at(-1)?.url ?? null
    const texts = [c.subscriberCountText?.simpleText, c.videoCountText?.simpleText, ...(c.subscriberCountText?.accessibility ? [c.subscriberCountText.accessibility.accessibilityData?.label] : [])]
    return {
      platform: 'youtube' as const,
      login: handle ? decodeURIComponent(handle).toLowerCase() : String(c.channelId),
      displayName: String(c.title?.simpleText ?? handle ?? c.channelId),
      avatarUrl: thumb ? (thumb.startsWith('//') ? `https:${thumb}` : thumb) : null,
      followers: texts.map(parseSubscribers).find((n) => n != null) ?? null,
      live: JSON.stringify(c.badges ?? []).includes('LIVE'),
      description: String((c.descriptionSnippet?.runs ?? []).map((r: { text: string }) => r.text).join('')).slice(0, 200)
    }
  })
}
