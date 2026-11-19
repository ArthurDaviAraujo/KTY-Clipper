import type { Db } from './db'
import { modalityOf, type Modality } from '../shared/modality'

const MODALITY_IDS: Modality[] = ['game', 'talk', 'irl', 'sports', 'creative']

/** Modalidade fixada no canal da live (null = automática pela categoria). */
export function channelModality(db: Db, liveId: number): Modality | null {
  const r = db.prepare('SELECT c.modality FROM lives l JOIN channels c ON c.id = l.channel_id WHERE l.id = ?').get(liveId) as
    | { modality: string | null }
    | undefined
  return MODALITY_IDS.includes(r?.modality as Modality) ? (r!.modality as Modality) : null
}

/** Modalidade no instante `utc`: a fixada no canal ou a da categoria daquele momento. */
export function modalityAt(db: Db, liveId: number, utc: number): Modality | null {
  return channelModality(db, liveId) ?? modalityOf(gameAt(db, liveId, utc))
}

/** Função rápida "instante → modalidade" para a live inteira (a detecção consulta cada lance). */
export function modalityTimeline(db: Db, liveId: number): (utc: number) => Modality | null {
  const fixed = channelModality(db, liveId)
  if (fixed) return () => fixed
  const marks = gamesOf(db, liveId)
  const fallback = modalityOf((db.prepare('SELECT game FROM lives WHERE id = ?').get(liveId) as { game: string | null } | undefined)?.game ?? null)
  if (!marks.length) return () => fallback
  return (utc) => {
    let g = marks[0].game
    for (const m of marks) {
      if (m.fromUtc > utc) break
      g = m.game
    }
    return modalityOf(g)
  }
}

/**
 * Categoria (jogo) ao longo de uma live. O streamer pode abrir em Just Chatting e entrar num jogo depois;
 * cada troca vira uma linha em `live_games` a partir do horário em que foi vista.
 */

/** Anota a categoria a partir de `fromUtc` se ela mudou. Devolve true quando anotou uma troca. */
export function noteGame(db: Db, liveId: number, fromUtc: number, game: string | null): boolean {
  const last = db.prepare('SELECT game FROM live_games WHERE live_id = ? AND from_utc <= ? ORDER BY from_utc DESC LIMIT 1').get(liveId, fromUtc) as
    | { game: string | null }
    | undefined
  if (last && (last.game ?? null) === (game ?? null)) return false
  db.prepare('INSERT OR REPLACE INTO live_games(live_id, from_utc, game) VALUES (?, ?, ?)').run(liveId, fromUtc, game ?? null)
  return true
}

/** Categoria no instante `utc` (antes da primeira anotação, vale a primeira). */
export function gameAt(db: Db, liveId: number, utc: number): string | null {
  const r = db.prepare('SELECT game FROM live_games WHERE live_id = ? AND from_utc <= ? ORDER BY from_utc DESC LIMIT 1').get(liveId, utc) as
    | { game: string | null }
    | undefined
  if (r) return r.game
  const first = db.prepare('SELECT game FROM live_games WHERE live_id = ? ORDER BY from_utc LIMIT 1').get(liveId) as { game: string | null } | undefined
  if (first) return first.game
  return (db.prepare('SELECT game FROM lives WHERE id = ?').get(liveId) as { game: string | null } | undefined)?.game ?? null
}

/** Trocas de categoria da live, em ordem. */
export function gamesOf(db: Db, liveId: number): { fromUtc: number; game: string | null }[] {
  return (db.prepare('SELECT from_utc, game FROM live_games WHERE live_id = ? ORDER BY from_utc').all(liveId) as { from_utc: number; game: string | null }[]).map((r) => ({
    fromUtc: r.from_utc,
    game: r.game
  }))
}
