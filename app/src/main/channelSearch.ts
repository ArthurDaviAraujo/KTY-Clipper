import type { Db } from './db'
import type { Logger } from './logs'
import { QuotaError } from './ai/gemini'
import { aiJson, hasAi, type Backup } from './ai/backups'
import { twitchSearch } from './platforms/twitch'
import { kickSearch } from './platforms/kick'
import { youtubeSearch } from './platforms/youtube'
import { sameStreamerKey } from '../shared/channels'
import type { ChannelHit, ChannelMatch, ChannelSearch, Platform } from '../shared/types'

export interface ChannelSearchDeps {
  db: Db
  log: Logger
  gemini: () => { key: string; model: string } | null
  backups?: () => Backup[]
  /** Nome exato nas três plataformas */
  lookup: (name: string) => Promise<ChannelMatch[]>
}

interface Guess {
  name: string
  platform: 'twitch' | 'kick' | 'youtube' | 'qualquer'
  why: string
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    understood: { type: 'STRING' },
    guesses: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, platform: { type: 'STRING', enum: ['twitch', 'kick', 'youtube', 'qualquer'] }, why: { type: 'STRING' } },
        required: ['name', 'platform', 'why']
      }
    }
  },
  required: ['understood', 'guesses']
}

const SYSTEM = `Você ajuda a achar o canal de live (Twitch, Kick ou YouTube) que a pessoa quer adicionar num app de clipes.
Ela pode escrever o nome certo, o nome com erro ("gaulles"), um apelido ("casimito"), ou só descrever ("o streamer de CS da tribo", "o canal que passa jogo do Brasil").
Pense em streamers e canais reais, principalmente brasileiros, mas de qualquer país.
Responda:
- "understood": em até 12 palavras, quem você acha que ela quer (ex.: "Gaules, streamer de Counter-Strike").
- "guesses": até 4 nomes de canal, do mais provável para o menos, escritos como aparecem na plataforma (o @ ou o nome do canal, sem "@"), com a plataforma onde ele mais faz live ("qualquer" se não souber) e "why" em até 12 palavras, em português.
Se for claramente um nome exato, repita o nome como primeiro palpite. Não invente nomes que você não conhece.
O "why" diz quem é o canal, de forma natural (ex.: "Streamer de Counter-Strike, faz lives todo dia"), nunca coisas como "nome exato do pedido" ou "corresponde ao usuário". Se não souber nada do canal, deixe "why" vazio.`

const normName = (s: string) => sameStreamerKey(s)

/**
 * Busca de canal com IA: a IA entende o que a pessoa quis dizer e chuta nomes;
 * a busca de cada plataforma confirma quais canais existem de verdade. Sem IA, fica só a busca das plataformas.
 */
export async function smartChannelSearch(d: ChannelSearchDeps, query: string): Promise<ChannelSearch> {
  const q = query.trim()
  if (!q) return { query, matches: [], understood: null, aiNote: null }
  const target = { gemini: d.gemini(), backups: d.backups?.() ?? [] }
  const g = hasAi(target)

  const searchAll = async (text: string, only?: Platform): Promise<ChannelHit[]> => {
    const jobs: Promise<ChannelHit[]>[] = []
    if (!only || only === 'twitch') jobs.push(twitchSearch(text).catch(() => []))
    if (!only || only === 'kick') jobs.push(kickSearch(text).catch(() => []))
    if (!only || only === 'youtube') jobs.push(youtubeSearch(text).catch(() => []))
    return (await Promise.all(jobs)).flat()
  }

  // Ao mesmo tempo: nome exato, busca literal nas três e a IA
  const aiP: Promise<{ understood: string; guesses: Guess[] } | null> = g
    ? aiJson<{ understood: string; guesses: Guess[] }>(target, SYSTEM, `Pedido: ${q.slice(0, 200)}`, SCHEMA, undefined, { fast: true }).catch((e) => {
        d.log.warn('ia', `Busca de canal com IA falhou: ${(e as Error).message}`)
        throw e
      })
    : Promise.resolve(null)
  const [exactR, literalR, aiR] = await Promise.allSettled([d.lookup(q), searchAll(q), aiP])
  const exact = exactR.status === 'fulfilled' ? exactR.value : []
  const literal = literalR.status === 'fulfilled' ? literalR.value : []
  const ai = aiR.status === 'fulfilled' ? aiR.value : null
  let aiNote: string | null = null
  if (!g) aiNote = 'Sem a chave do Gemini (nem reserva), a busca só acha pelo nome. Configure em Ajustes > IA e fala para buscar por apelido ou descrição.'
  else if (aiR.status === 'rejected') aiNote = aiR.reason instanceof QuotaError ? 'A cota grátis do Gemini acabou por agora: busca só pelo nome.' : 'A IA não respondeu agora: busca só pelo nome.'

  // Palpites da IA: nome exato e busca na plataforma provável
  const guesses = (ai?.guesses ?? []).filter((x) => x.name?.trim()).slice(0, 4)
  const guessExact = await Promise.all(guesses.slice(0, 3).map((x) => d.lookup(x.name).catch(() => [] as ChannelMatch[])))
  const guessHits = await Promise.all(guesses.slice(0, 3).map((x) => searchAll(x.name, x.platform === 'qualquer' ? undefined : x.platform)))

  // Junta tudo e dá nota a cada canal
  const pool = new Map<string, { m: ChannelMatch; score: number }>()
  const keyOf = (p: Platform, login: string) => `${p}:${p === 'youtube' ? login : login.toLowerCase()}`
  const add = (m: ChannelMatch, score: number, why?: string | null) => {
    const k = keyOf(m.platform, m.login)
    const cur = pool.get(k)
    if (cur) {
      cur.score += score
      cur.m.why ??= why ?? null
      cur.m.followers ??= m.followers ?? null
      cur.m.avatarUrl ??= m.avatarUrl
      cur.m.live ||= m.live
    } else pool.set(k, { m: { ...m, why: why ?? null }, score })
  }
  const fromHit = (h: ChannelHit): ChannelMatch => ({ platform: h.platform, login: h.login, displayName: h.displayName, avatarUrl: h.avatarUrl, live: h.live, already: false, followers: h.followers })
  const popularity = (f: number | null | undefined) => (f && f > 0 ? Math.log10(f) * 4 : 0)

  for (const m of exact) add(m, 60)
  literal.forEach((h, i) => add(fromHit(h), Math.max(0, 12 - (i % 8) * 2) + popularity(h.followers)))
  guesses.forEach((x, i) => {
    const weight = 90 - i * 20
    const target = normName(x.name)
    for (const m of guessExact[i] ?? []) add(m, weight, x.why)
    for (const h of guessHits[i] ?? []) {
      const same = normName(h.displayName) === target || normName(h.login) === target
      add(fromHit(h), (same ? weight * 0.8 : 4) + popularity(h.followers), same ? x.why : null)
    }
  })
  // Canais com o mesmo nome da busca (ou do palpite) e quase sem seguidores costumam ser cópias: perdem pontos
  for (const { m } of pool.values()) if (m.followers != null && m.followers < 50) pool.get(keyOf(m.platform, m.login))!.score -= 10

  const already = d.db.prepare(`SELECT 1 FROM channels WHERE platform = ? AND login = ? AND origin = 'watch'`)
  const matches = [...pool.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ m }) => ({ ...m, already: m.already || !!already.get(m.platform, m.login) }))
  return { query: q, matches, understood: ai?.understood?.trim() || null, aiNote }
}
