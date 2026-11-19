import type { Db } from './db'
import type { MomentsService } from './moments'
import type { Logger } from './logs'
import { aiJson, hasAi, type Backup } from './ai/backups'
import { anchorTerm, likePattern, matchRatio, normText, searchTerms } from '../shared/search'
import type { AiSearchResults, MomentRecord, Platform, SearchResults, SpeechHit } from '../shared/types'

export interface SearchDeps {
  db: Db
  log: Logger
  moments: MomentsService
  gemini: () => { key: string; model: string } | null
  backups?: () => Backup[]
}

interface LiveInfo {
  id: number
  started_at: number
  title: string | null
  platform: Platform
  channel: string
}

const AI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    matches: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'INTEGER' }, why: { type: 'STRING' } },
        required: ['id', 'why']
      }
    }
  },
  required: ['matches']
}

const AI_SYSTEM = `Você ajuda a achar momentos de lives já gravadas a partir de uma descrição em linguagem comum.
Recebe a descrição e uma lista de momentos (id, canal, categoria, título, motivo da escolha, o que foi falado e o chat).
Devolva só os momentos que combinam de verdade com a descrição, do mais parecido para o menos, no máximo 12.
Pense no sentido, não só nas palavras ("caiu do prédio" combina com "despencou lá de cima"; "ficou bravo" combina com xingamentos e gritos).
Para cada um, "why" diz em até 15 palavras, em português, por que combina. Se nenhum combinar, devolva a lista vazia.`

/**
 * Busca no que o app já guardou: clipes, momentos e tudo o que foi falado nas gravações (Whisper).
 * A busca pela descrição manda os momentos para a IA, que escolhe pelo sentido.
 */
export class SearchService {
  constructor(private d: SearchDeps) {}

  private get db() {
    return this.d.db
  }

  search(query: string): SearchResults {
    const terms = searchTerms(query)
    if (!terms.length) return { query, clipIds: [], moments: [], speech: [] }
    return { query, clipIds: this.clips(terms), moments: this.momentsMatching(terms), speech: this.speech(query, terms) }
  }

  /** Clipes pelo título, hashtags, categoria, canal e pela análise da IA do momento. */
  private clips(terms: string[]): number[] {
    const rows = this.db
      .prepare(
        `SELECT k.id, k.title, k.title_en, k.hashtags, k.channel, m.ai, m.title AS mtitle, l.game
         FROM clips k LEFT JOIN moments m ON m.id = k.moment_id LEFT JOIN lives l ON l.id = k.live_id`
      )
      .all() as { id: number; title: string; title_en: string | null; hashtags: string | null; channel: string; ai: string | null; mtitle: string | null; game: string | null }[]
    return rows
      .map((r) => {
        const ai = r.ai ? (JSON.parse(r.ai) as { reason?: string; category?: string }) : null
        const text = [r.title, r.title_en ?? '', r.hashtags ?? '', r.channel, r.mtitle ?? '', r.game ?? '', ai?.reason ?? '', ai?.category ?? ''].join(' ')
        return { id: r.id, s: matchRatio(text, terms) }
      })
      .filter((x) => x.s === 1)
      .sort((a, b) => b.id - a.id)
      .slice(0, 60)
      .map((x) => x.id)
  }

  /** Momentos (com e sem clipe) pelo título e motivo da IA, pela fala do trecho e pelo chat. */
  private momentsMatching(terms: string[]): MomentRecord[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.live_id, m.start_utc, m.end_utc, m.title, m.ai, m.signals, l.game, COALESCE(c.display_name, c.login) AS channel
         FROM moments m JOIN lives l ON l.id = m.live_id JOIN channels c ON c.id = l.channel_id WHERE m.status != 'dismissed'`
      )
      .all() as { id: number; live_id: number; start_utc: number; end_utc: number; title: string | null; ai: string | null; signals: string; game: string | null; channel: string }[]
    const wordsQ = this.db.prepare('SELECT word FROM speech_words WHERE live_id = ? AND t_ms >= ? AND t_ms < ? ORDER BY t_ms')
    const hits: { id: number; s: number }[] = []
    for (const r of rows) {
      const ai = r.ai ? (JSON.parse(r.ai) as { title_pt?: string; title_en?: string; reason?: string; category?: string; hashtags?: string[] }) : null
      const sig = JSON.parse(r.signals || '{}') as { samples?: string[]; reasons?: string[] }
      const meta = [r.title ?? '', ai?.title_pt ?? '', ai?.title_en ?? '', ai?.reason ?? '', ai?.category ?? '', ...(ai?.hashtags ?? []), r.channel, r.game ?? '', ...(sig.reasons ?? [])].join(' ')
      let s = matchRatio(meta, terms)
      if (s < 1) {
        const said = (wordsQ.all(r.live_id, r.start_utc - 3000, r.end_utc + 3000) as { word: string }[]).map((w) => w.word).join(' ')
        s = matchRatio(`${meta} ${said} ${(sig.samples ?? []).join(' ')}`, terms) * 0.9
      }
      if (s >= 0.9) hits.push({ id: r.id, s })
    }
    hits.sort((a, b) => b.s - a.s || b.id - a.id)
    const ids = hits.slice(0, 60).map((h) => h.id)
    const order = new Map(ids.map((id, i) => [id, i]))
    return this.d.moments.list(undefined, ids).sort((a, b) => order.get(a.id)! - order.get(b.id)!)
  }

  /**
   * Tudo o que foi falado: acha a palavra mais longa no banco e confere as outras em volta (±12 s).
   * Trechos a menos de 20 s um do outro na mesma live viram um só.
   */
  private speech(query: string, terms: string[]): SpeechHit[] {
    const anchor = anchorTerm(terms)
    const cands = this.db
      .prepare('SELECT live_id, t_ms, word FROM speech_words WHERE word LIKE ? ORDER BY t_ms DESC LIMIT 5000')
      .all(likePattern(anchor)) as { live_id: number; t_ms: number; word: string }[]
    const phrase = normText(query)
    const wordsQ = this.db.prepare('SELECT t_ms, word FROM speech_words WHERE live_id = ? AND t_ms >= ? AND t_ms < ? ORDER BY t_ms')
    const lives = new Map<number, LiveInfo | null>()
    const liveOf = (id: number) => {
      if (!lives.has(id))
        lives.set(
          id,
          (this.db
            .prepare(`SELECT l.id, l.started_at, l.title, c.platform, COALESCE(c.display_name, c.login) AS channel FROM lives l JOIN channels c ON c.id = l.channel_id WHERE l.id = ?`)
            .get(id) as LiveInfo | undefined) ?? null
        )
      return lives.get(id)!
    }
    const out: SpeechHit[] = []
    const taken: { live: number; t: number }[] = []
    for (const c of cands) {
      if (out.length >= 40) break
      if (!normText(c.word).includes(anchor)) continue
      if (taken.some((x) => x.live === c.live_id && Math.abs(x.t - c.t_ms) < 20_000)) continue
      const around = wordsQ.all(c.live_id, c.t_ms - 12_000, c.t_ms + 12_000) as { t_ms: number; word: string }[]
      const text = around.map((w) => w.word).join(' ')
      if (matchRatio(text, terms) < 1) continue
      const live = liveOf(c.live_id)
      if (!live) continue
      taken.push({ live: c.live_id, t: c.t_ms })
      const snippet = around
        .filter((w) => w.t_ms >= c.t_ms - 6000 && w.t_ms < c.t_ms + 8000)
        .map((w) => w.word.trim())
        .join(' ')
        .replace(/\s+([,.!?;:])/g, '$1')
      const moment = this.db
        .prepare(`SELECT id FROM moments WHERE live_id = ? AND status != 'dismissed' AND start_utc - 3000 <= ? AND end_utc + 3000 >= ? ORDER BY score DESC LIMIT 1`)
        .get(c.live_id, c.t_ms, c.t_ms) as { id: number } | undefined
      const clip = moment ? (this.db.prepare('SELECT id FROM clips WHERE moment_id = ? ORDER BY id DESC LIMIT 1').get(moment.id) as { id: number } | undefined) : undefined
      const available = !!this.db
        .prepare(`SELECT 1 FROM segments WHERE live_id = ? AND status != 'deleted' AND start_utc <= ? AND start_utc + COALESCE(duration_s, 0) * 1000 > ?`)
        .get(c.live_id, c.t_ms, c.t_ms)
      out.push({
        liveId: live.id,
        channelName: live.channel,
        platform: live.platform,
        liveTitle: live.title ?? '',
        startedAt: live.started_at,
        tMs: c.t_ms,
        offsetS: Math.max(0, (c.t_ms - live.started_at) / 1000),
        snippet,
        exact: terms.length > 1 && normText(text).includes(phrase),
        momentId: moment?.id ?? null,
        clipId: clip?.id ?? null,
        available
      })
    }
    // A frase inteira primeiro; depois, as mais recentes
    return out.sort((a, b) => Number(b.exact) - Number(a.exact) || b.tMs - a.tMs)
  }

  /** Pela descrição: a IA lê os momentos (melhores e mais recentes) e escolhe pelo sentido. */
  async searchAi(query: string): Promise<AiSearchResults> {
    const target = { gemini: this.d.gemini(), backups: this.d.backups?.() ?? [] }
    if (!hasAi(target)) return { query, matches: [], read: 0, error: 'A busca pela descrição usa a KaTY. Configure a chave do Gemini (ou uma reserva) em Ajustes > IA e fala.' }
    const ids = (
      this.db
        .prepare(
          `SELECT id FROM (SELECT id, score FROM moments WHERE status != 'dismissed' ORDER BY score DESC LIMIT 150)
           UNION SELECT id FROM (SELECT id FROM moments WHERE status != 'dismissed' ORDER BY peak_utc DESC LIMIT 150)`
        )
        .all() as { id: number }[]
    ).map((r) => r.id)
    const moments = this.d.moments.list(undefined, ids)
    if (!moments.length) return { query, matches: [], read: 0, error: 'Ainda não há momentos para procurar.' }
    const lines = moments.map((m) =>
      JSON.stringify({
        id: m.id,
        canal: m.channelName,
        categoria: m.game,
        titulo: m.ai?.titlePt ?? null,
        tipo: m.ai?.category ?? null,
        motivo: m.ai?.reason ?? m.reasons.join('; '),
        fala: m.speech.slice(0, 260),
        chat: m.samples.slice(0, 4).join(' | ').slice(0, 160)
      })
    )
    try {
      const res = await aiJson<{ matches: { id: number; why: string }[] }>(
        target,
        AI_SYSTEM,
        `Descrição: ${query.slice(0, 300)}\n\nMomentos (um por linha):\n${lines.join('\n')}`,
        AI_SCHEMA
      )
      const byId = new Map(moments.map((m) => [m.id, m]))
      const clipQ = this.db.prepare('SELECT id FROM clips WHERE moment_id = ? ORDER BY id DESC LIMIT 1')
      const matches = (res.matches ?? [])
        .filter((x) => byId.has(x.id))
        .slice(0, 12)
        .map((x) => ({ moment: byId.get(x.id)!, clipId: (clipQ.get(x.id) as { id: number } | undefined)?.id ?? null, why: String(x.why ?? '').slice(0, 160) }))
      return { query, matches, read: moments.length }
    } catch (e) {
      this.d.log.warn('ia', `Busca pela descrição falhou: ${(e as Error).message}`)
      return { query, matches: [], read: moments.length, error: `A IA não respondeu: ${(e as Error).message}` }
    }
  }
}
