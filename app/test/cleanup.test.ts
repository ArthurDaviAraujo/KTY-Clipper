import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb, type Db } from '../src/main/db'
import { CLEAN_GRACE_MS, deleteUnused } from '../src/main/storage'
import { Logger } from '../src/main/logs'
import { JobQueue } from '../src/main/jobs'
import { ClipService } from '../src/main/render'
import { defaultSettings, sanitizeSettings } from '../src/shared/settings'

describe('opção de apagar descartados', () => {
  it('vem desligada e um valor estranho volta para "nunca"', () => {
    expect(defaultSettings().clips.discardedDelete).toBe('never')
    const s = defaultSettings()
    ;(s.clips as { discardedDelete: string }).discardedDelete = 'sempre'
    expect(sanitizeSettings(s).clips.discardedDelete).toBe('never')
  })
})

// Tudo em pasta temporária: nunca toca nas gravações reais
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const T0 = 1_800_000_000_000
const MIN = 60_000
const ENDED = T0 + 20 * MIN

/** Uma live de 20 min em 20 pedaços de 60 s, com arquivo de verdade em pasta temporária. */
function liveWith(db: Db, opts: { endedAt?: number; detectedAt?: number } = {}) {
  db.prepare(`INSERT OR IGNORE INTO channels(id, platform, login, created_at) VALUES (1, 'twitch', 'teste', 0)`).run()
  const endedAt = opts.endedAt ?? ENDED
  const liveId = Number(
    db
      .prepare(`INSERT INTO lives(channel_id, started_at, ended_at, status, detected_at, kind) VALUES (1, ?, ?, 'ended', ?, 'live')`)
      .run(T0, endedAt, opts.detectedAt ?? endedAt + 1000).lastInsertRowid
  )
  const dir = mkdtempSync(join(tmpdir(), 'clipador-limpeza-'))
  dirs.push(dir)
  const files: string[] = []
  for (let i = 0; i < 20; i++) {
    const p = join(dir, `seg_${String(i).padStart(5, '0')}.ts`)
    writeFileSync(p, Buffer.alloc(1000))
    files.push(p)
    db.prepare(`INSERT INTO segments(live_id, seq, path, start_utc, duration_s, bytes) VALUES (?, ?, ?, ?, 60, 1000)`).run(liveId, i, p, T0 + i * MIN)
  }
  return { liveId, files, dir }
}

const clip = (db: Db, liveId: number, startS: number, endS: number, review: string) =>
  db
    .prepare(`INSERT INTO clips(live_id, channel, options, layout, status, review, created_at) VALUES (?, 'teste', ?, 'full', 'ready', ?, 0)`)
    .run(liveId, JSON.stringify({ startS, endS }), review)

const moment = (db: Db, liveId: number, atMin: number, status: string, ai: object | null) =>
  db
    .prepare(`INSERT INTO moments(live_id, start_utc, end_utc, peak_utc, score, status, ai, created_at) VALUES (?, ?, ?, ?, 50, ?, ?, 0)`)
    .run(liveId, T0 + atMin * MIN, T0 + atMin * MIN + 20_000, T0 + atMin * MIN + 10_000, status, ai ? JSON.stringify(ai) : null)

const left = (files: string[]) => files.map((f, i) => (existsSync(f) ? i : -1)).filter((i) => i >= 0)

describe('limpeza das gravações', () => {
  it('guarda só os trechos de clipes e momentos; descartados não seguram nada', () => {
    const db = openDb(':memory:')
    const { liveId, files } = liveWith(db)
    clip(db, liveId, 300, 360, 'pending') // 5:00–6:00 → pedaços 4, 5, 6 (com a folga)
    clip(db, liveId, 900, 960, 'rejected') // em Descartados: não segura
    moment(db, liveId, 10, 'new', null) // ainda sem IA → pedaços 9, 10, 11
    moment(db, liveId, 13, 'new', { keep: false }) // a KaTY recusou
    moment(db, liveId, 17, 'dismissed', null) // descartado
    const r = deleteUnused(db, new Set(), ENDED + CLEAN_GRACE_MS + MIN)
    expect(left(files)).toEqual([4, 5, 6, 9, 10, 11])
    expect(r).toEqual({ lives: 1, deletedSegments: 14, freedBytes: 14_000 })
    const deleted = db.prepare(`SELECT COUNT(*) AS n FROM segments WHERE live_id = ? AND status = 'deleted'`).get(liveId) as { n: number }
    expect(deleted.n).toBe(14)
    // Rodar de novo não apaga mais nada
    expect(deleteUnused(db, new Set(), ENDED + CLEAN_GRACE_MS + 2 * MIN).deletedSegments).toBe(0)
  })

  it('o corte escolhido pela KaTY e o momento mantido também ficam', () => {
    const db = openDb(':memory:')
    const { liveId, files } = liveWith(db)
    moment(db, liveId, 2, 'new', { keep: true, clip_from_utc: T0 + 15 * MIN, clip_to_utc: T0 + 15 * MIN + 30_000 })
    moment(db, liveId, 8, 'kept', { keep: false }) // a pessoa manteve, mesmo com a KaTY recusando
    deleteUnused(db, new Set(), ENDED + CLEAN_GRACE_MS + MIN)
    expect(left(files)).toEqual([1, 2, 3, 7, 8, 9, 14, 15])
  })

  it('não mexe em live recente, gravando, com tarefa na fila ou sem análise depois do fim', () => {
    const db = openDb(':memory:')
    const now = ENDED + CLEAN_GRACE_MS + MIN
    const recente = liveWith(db, { endedAt: now - 5 * MIN })
    const gravando = liveWith(db)
    const naFila = liveWith(db)
    const semAnalise = liveWith(db, { detectedAt: ENDED - MIN })
    db.prepare(`INSERT INTO jobs(type, label, resource, status, payload, created_at) VALUES ('detect:live', 'x', 'cpu', 'queued', ?, 0)`).run(
      JSON.stringify({ liveId: naFila.liveId })
    )
    const r = deleteUnused(db, new Set([gravando.liveId]), now)
    expect(r.deletedSegments).toBe(0)
    for (const l of [recente, gravando, naFila, semAnalise]) expect(left(l.files)).toHaveLength(20)
  })

  it('apaga os Descartados do disco pelo prazo, sem o lance voltar a virar clipe', () => {
    const db = openDb(':memory:')
    const tmp = mkdtempSync(join(tmpdir(), 'clipador-descartados-'))
    dirs.push(tmp)
    const settings = defaultSettings()
    const clips = new ClipService({
      db,
      log: new Logger(db),
      queue: new JobQueue(db, () => ({ gpu: 1, cpu: 1, io: 1, net: 1 })),
      settings: () => settings,
      tools: () => null,
      encoders: () => [],
      clipsRoot: () => join(tmp, 'clipes'),
      exportRoot: () => join(tmp, 'para postar'),
      cacheDir: join(tmp, 'cache'),
      aiReady: () => false
    })
    const { liveId } = liveWith(db)
    const DAY = 86_400_000
    const now = T0 + 30 * DAY
    const add = (review: string, reviewedAt: number) => {
      moment(db, liveId, 5, 'kept', null)
      const momentId = Number((db.prepare('SELECT MAX(id) AS id FROM moments').get() as { id: number }).id)
      const path = join(tmp, `clipe-${momentId}.mp4`)
      writeFileSync(path, 'video')
      db.prepare(
        `INSERT INTO clips(moment_id, live_id, channel, options, layout, status, review, reviewed_at, path, created_at) VALUES (?, ?, 'teste', '{}', 'full', 'ready', ?, ?, ?, 0)`
      ).run(momentId, liveId, review, reviewedAt, path)
      return { momentId, path }
    }
    const velho = add('rejected', now - 8 * DAY)
    const novo = add('rejected', now - 1000)
    const aprovado = add('approved', now - 40 * DAY)
    // Prazo de 7 dias: só o descartado há 8 dias sai
    expect(clips.purgeRejected(7 * DAY, now)).toBe(1)
    expect(existsSync(velho.path)).toBe(false)
    expect(existsSync(novo.path)).toBe(true)
    expect(existsSync(aprovado.path)).toBe(true)
    const status = (id: number) => (db.prepare('SELECT status FROM moments WHERE id = ?').get(id) as { status: string }).status
    expect(status(velho.momentId)).toBe('dismissed')
    // "Apagar todos agora" (ou ao abrir o app): o resto dos descartados, nunca os aprovados
    expect(clips.purgeRejected(0, now)).toBe(1)
    expect(existsSync(novo.path)).toBe(false)
    expect(existsSync(aprovado.path)).toBe(true)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM clips WHERE review = 'rejected'`).get() as { n: number }).n).toBe(0)
  })

  it('apaga a pasta da live quando não sobra nenhum pedaço', () => {
    const db = openDb(':memory:')
    const { dir } = liveWith(db)
    writeFileSync(join(dir, 'audio.csv'), 't,db')
    deleteUnused(db, new Set(), ENDED + CLEAN_GRACE_MS + MIN)
    expect(existsSync(dir)).toBe(false)
  })
})
