import { rmSync, readdirSync, rmdirSync } from 'fs'
import { dirname, join } from 'path'
import type { Db } from './db'
import type { Settings } from '../shared/types'

export const GB = 1024 ** 3

export const recordingsRoot = (s: Settings, dataDir: string) => s.storage.recordingsDir || join(dataDir, 'gravacoes')
export const clipsRoot = (s: Settings, dataDir: string) => s.storage.clipsDir || join(dataDir, 'clipes')
/** Pasta "para postar": a escolhida, senão ao lado da pasta de clipes (ex.: D:Clipador KTYpara postar) */
export const exportRoot = (s: Settings, dataDir: string) => s.storage.exportDir || join(dirname(clipsRoot(s, dataDir)), 'para postar')

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
  const pick: typeof rows = []
  for (const r of rows) {
    if (freed >= needBytes) break
    if (protectedLiveIds.has(r.live_id)) continue
    pick.push(r)
    freed += r.bytes
  }
  const done = removeSegments(db, pick)
  freed = done.freedBytes
  count = done.deletedSegments
  return { deletedSegments: count, freedBytes: freed, stillOverBytes: Math.max(0, needBytes - freed) }
}

/** Apaga os arquivos dos pedaços, marca 'deleted' no banco e remove as pastas que ficaram só com os CSVs. */
function removeSegments(db: Db, rows: { id: number; path: string; bytes: number }[]): { deletedSegments: number; freedBytes: number } {
  const mark = db.prepare(`UPDATE segments SET status = 'deleted' WHERE id = ?`)
  const dirs = new Set<string>()
  let freed = 0
  let count = 0
  for (const r of rows) {
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
  return { deletedSegments: count, freedBytes: freed }
}

/** Espera depois do fim da live antes de limpar (dá tempo de revisar e mudar o clipe na hora). */
export const CLEAN_GRACE_MS = 30 * 60_000
/** Folga guardada em volta de cada clipe (para "Editar" poder esticar um pouco o começo e o fim) */
export const CLIP_MARGIN_MS = 30_000
/** Folga em volta de cada momento (a mesma janela que a KaTY analisa, com sobra) */
export const MOMENT_MARGIN_MS = 60_000

export interface CleanResult {
  lives: number
  deletedSegments: number
  freedBytes: number
}

type Range = [number, number]

/**
 * Limpeza das lives já terminadas: apaga os pedaços que não fazem parte de nenhum clipe nem de nenhum momento.
 * Fica guardado (com folga em volta):
 * - o trecho de cada clipe que não foi descartado (pendente ou aprovado);
 * - cada momento mantido, ou ainda não decidido que a KaTY não recusou (com o corte que ela escolheu).
 * Não protegem nada: clipes em "Descartados", momentos descartados e momentos que a KaTY recusou.
 * Só mexe em lives encerradas há mais de `CLEAN_GRACE_MS`, já analisadas depois do fim e sem tarefa na fila.
 */
export function deleteUnused(db: Db, protectedLiveIds: Set<number>, now = Date.now()): CleanResult {
  const lives = db
    .prepare(
      `SELECT l.id, l.started_at FROM lives l
        WHERE l.status IN ('ended', 'imported') AND l.ended_at IS NOT NULL AND l.ended_at <= ?
          AND l.detected_at IS NOT NULL AND l.detected_at >= l.ended_at
          AND EXISTS (SELECT 1 FROM segments s WHERE s.live_id = l.id AND s.status != 'deleted')
          AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.status IN ('queued', 'running') AND json_extract(j.payload, '$.liveId') = l.id)
          AND NOT EXISTS (SELECT 1 FROM clips c WHERE c.live_id = l.id AND c.status IN ('queued', 'rendering'))`
    )
    .all(now - CLEAN_GRACE_MS) as { id: number; started_at: number }[]
  const clipsOf = db.prepare(`SELECT options FROM clips WHERE live_id = ? AND review != 'rejected' AND status != 'failed'`)
  const momentsOf = db.prepare(`SELECT start_utc, end_utc, status, ai FROM moments WHERE live_id = ? AND status != 'dismissed'`)
  const segsOf = db.prepare(`SELECT id, path, start_utc, COALESCE(duration_s, 60) AS dur, COALESCE(bytes, 0) AS bytes FROM segments WHERE live_id = ? AND status != 'deleted'`)
  const out: CleanResult = { lives: 0, deletedSegments: 0, freedBytes: 0 }
  for (const l of lives) {
    if (protectedLiveIds.has(l.id)) continue
    const keep: Range[] = []
    for (const c of clipsOf.all(l.id) as { options: string }[]) {
      const o = safeJson<{ startS?: number; endS?: number }>(c.options)
      if (o && Number.isFinite(o.startS) && Number.isFinite(o.endS))
        keep.push([l.started_at + o.startS! * 1000 - CLIP_MARGIN_MS, l.started_at + o.endS! * 1000 + CLIP_MARGIN_MS])
    }
    for (const m of momentsOf.all(l.id) as { start_utc: number; end_utc: number; status: string; ai: string | null }[]) {
      const ai = m.ai ? safeJson<{ keep?: boolean; clip_from_utc?: number; clip_to_utc?: number }>(m.ai) : null
      // A KaTY recusou e ninguém marcou para manter: não guarda
      if (m.status !== 'kept' && ai?.keep === false) continue
      keep.push([m.start_utc - MOMENT_MARGIN_MS, m.end_utc + MOMENT_MARGIN_MS])
      if (ai && Number.isFinite(ai.clip_from_utc) && Number.isFinite(ai.clip_to_utc))
        keep.push([ai.clip_from_utc! - CLIP_MARGIN_MS, ai.clip_to_utc! + CLIP_MARGIN_MS])
    }
    const segs = segsOf.all(l.id) as { id: number; path: string; start_utc: number; dur: number; bytes: number }[]
    const drop = segs.filter((s) => {
      const end = s.start_utc + s.dur * 1000
      return !keep.some(([a, b]) => s.start_utc < b && end > a)
    })
    if (!drop.length) continue
    const r = removeSegments(db, drop)
    if (r.deletedSegments) out.lives++
    out.deletedSegments += r.deletedSegments
    out.freedBytes += r.freedBytes
  }
  return out
}

function safeJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}
