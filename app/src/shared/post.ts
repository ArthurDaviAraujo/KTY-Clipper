/**
 * Textos para postar um clipe à mão (até a postagem automática da fase 2):
 * título e descrição do YouTube Shorts e legenda do TikTok, com hashtags e créditos ao streamer.
 */

export interface PostInfo {
  title: string
  hashtags: string[]
  channel: string
  /** Link do canal do streamer (créditos); null se a live foi apagada */
  channelUrl: string | null
  /** Categoria do lance (jogo, Just Chatting…) */
  game: string | null
}

export type Network = 'youtube' | 'tiktok'

/** Já foi postado em todas as redes onde a pessoa posta? */
export function postDone(posted: { youtube: number | null; tiktok: number | null }, networks: { youtube: boolean; tiktok: boolean }): boolean {
  return (!networks.youtube || !!posted.youtube) && (!networks.tiktok || !!posted.tiktok)
}

/** Hora da última postagem (para ordenar os postados) */
export function lastPosted(posted: { youtube: number | null; tiktok: number | null }): number {
  return Math.max(posted.youtube ?? 0, posted.tiktok ?? 0)
}

export interface PostTexts {
  youtubeTitle: string
  youtubeDescription: string
  tiktokCaption: string
}

/** Limites das plataformas (caracteres) */
export const LIMITS = { youtubeTitle: 100, youtubeDescription: 5000, tiktokCaption: 2200 }

/** "#Gol Incrível!" → "GolIncrível": só letras, números e _, sem espaço (hashtag com espaço quebra). */
export function cleanTag(t: string): string {
  return t.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')
}

/** Hashtags sem repetir (ignorando maiúsculas), na ordem em que vieram. */
export function tagList(tags: string[], extra: string[] = []): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of [...extra, ...tags].map(cleanTag)) {
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
  }
  return out
}

/** Corta no limite sem deixar palavra pela metade. */
export function fit(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export function postTexts(i: PostInfo): PostTexts {
  const title = i.title.trim() || 'Clipe'
  const credit = i.channelUrl ? `Créditos: ${i.channel} (${i.channelUrl})` : `Créditos: ${i.channel}`
  const yt = tagList(i.hashtags, ['shorts'])
    .slice(0, 8)
    .map((t) => `#${t}`)
  const tt = tagList(i.hashtags)
    .slice(0, 8)
    .map((t) => `#${t}`)
  const description = [title, i.game ? `Categoria: ${i.game}` : '', credit, yt.join(' ')].filter(Boolean).join('\n\n')
  // TikTok: se passar do limite, sobram menos hashtags (o título e os créditos ficam)
  let caption = [title, credit, tt.join(' ')].filter(Boolean).join('\n\n')
  for (let n = tt.length - 1; caption.length > LIMITS.tiktokCaption && n >= 0; n--) caption = [title, credit, tt.slice(0, n).join(' ')].filter(Boolean).join('\n\n')
  return {
    youtubeTitle: fit(title, LIMITS.youtubeTitle),
    youtubeDescription: fit(description, LIMITS.youtubeDescription),
    tiktokCaption: fit(caption, LIMITS.tiktokCaption)
  }
}

/** Conteúdo do .txt da pasta "para postar". */
export function postFile(p: PostTexts, extra: { origin: string | null }): string {
  return [
    'YOUTUBE SHORTS',
    `Título: ${p.youtubeTitle}`,
    'Descrição:',
    p.youtubeDescription,
    '',
    'TIKTOK',
    'Legenda:',
    p.tiktokCaption,
    ...(extra.origin ? ['', `Origem do trecho: ${extra.origin}`] : [])
  ].join('\r\n')
}
