import type { Db } from './db'

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
