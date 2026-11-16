import { rmSync, readdirSync, rmdirSync } from 'fs'
import { dirname, join } from 'path'
import type { Db } from './db'
import type { Settings } from '../shared/types'

export const GB = 1024 ** 3

export const recordingsRoot = (s: Settings, dataDir: string) => s.storage.recordingsDir || join(dataDir, 'gravacoes')
export const clipsRoot = (s: Settings, dataDir: string) => s.storage.clipsDir || join(dataDir, 'clipes')

/** Bytes ocupados pelos pedaços gravados que ainda existem. */
export function usageBytes(db: Db): number {
  return (db.prepare(`SELECT COALESCE(SUM(bytes), 0) AS b FROM segments WHERE status != 'deleted'`).get() as { b: number }).b
}

export interface FreeResult {
  deletedSegments: number
  freedBytes: number
  /** Quanto ainda falta liberar (0 = resolvido) */
  stillOverBytes: number
}

/**
 * Apaga os pedaços mais antigos até liberar `needBytes`.
 * Nunca toca nas lives em `protectedLiveIds` (as que estão gravando agora).
 * A linha do pedaço fica no banco com status 'deleted' (o histórico da live continua).
 */
export function deleteOldest(db: Db, needBytes: number, protectedLiveIds: Set<number>): FreeResult {
  let freed = 0
  let count = 0
  if (needBytes <= 0) return { deletedSegments: 0, freedBytes: 0, stillOverBytes: 0 }
  const rows = db
    .prepare(`SELECT id, live_id, path, COALESCE(bytes, 0) AS bytes FROM segments WHERE status != 'deleted' ORDER BY start_utc, id`)
    .all() as { id: number; live_id: number; path: string; bytes: number }[]
  const mark = db.prepare(`UPDATE segments SET status = 'deleted' WHERE id = ?`)
  const dirs = new Set<string>()
  for (const r of rows) {
    if (freed >= needBytes) break
    if (protectedLiveIds.has(r.live_id)) continue
    try {
      rmSync(r.path, { force: true })
    } catch {
      continue
    }
    mark.run(r.id)
    dirs.add(dirname(r.path))
    freed += r.bytes
    count++
  }
  // Remove pastas de lives que ficaram só com os CSVs
  for (const d of dirs) {
    try {
      const left = readdirSync(d)
      if (left.every((f) => f.endsWith('.csv'))) {
        for (const f of left) rmSync(join(d, f), { force: true })
        rmdirSync(d)
      }
    } catch {
      // pasta em uso ou já removida
    }
  }
  return { deletedSegments: count, freedBytes: freed, stillOverBytes: Math.max(0, needBytes - freed) }
}
