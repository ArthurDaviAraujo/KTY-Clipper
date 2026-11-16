import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb } from '../src/main/db'
import { deleteOldest, usageBytes } from '../src/main/storage'

function setup() {
  const db = openDb(':memory:')
  const root = mkdtempSync(join(tmpdir(), 'clipador-'))
  db.prepare(`INSERT INTO channels(platform, login, created_at) VALUES ('twitch', 'a', 0)`).run()
  // live 1 = antiga (encerrada), live 2 = gravando agora
  db.prepare(`INSERT INTO lives(channel_id, started_at, status) VALUES (1, 0, 'ended')`).run()
  db.prepare(`INSERT INTO lives(channel_id, started_at, status) VALUES (1, 100, 'recording')`).run()
  const add = (live: number, seq: number, start: number, bytes: number) => {
    const dir = join(root, `live${live}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `seg_${seq}.ts`)
    writeFileSync(path, Buffer.alloc(bytes))
    db.prepare(`INSERT INTO segments(live_id, seq, path, start_utc, bytes) VALUES (?, ?, ?, ?, ?)`).run(live, seq, path, start, bytes)
    return path
  }
  const old = [add(1, 0, 10, 100), add(1, 1, 20, 100), add(1, 2, 30, 100)]
  const current = [add(2, 0, 200, 100), add(2, 1, 210, 100)]
  return { db, old, current }
}

describe('deleteOldest', () => {
  it('deletes oldest pieces first until enough space is freed', () => {
    const { db, old } = setup()
    expect(usageBytes(db)).toBe(500)
    const r = deleteOldest(db, 150, new Set([2]))
    expect(r).toEqual({ deletedSegments: 2, freedBytes: 200, stillOverBytes: 0 })
    expect(existsSync(old[0])).toBe(false)
    expect(existsSync(old[1])).toBe(false)
    expect(existsSync(old[2])).toBe(true)
    expect(usageBytes(db)).toBe(300)
  })

  it('never touches the live being recorded', () => {
    const { db, current } = setup()
    const r = deleteOldest(db, 450, new Set([2]))
    expect(r.deletedSegments).toBe(3)
    expect(r.stillOverBytes).toBe(150)
    expect(current.every(existsSync)).toBe(true)
  })

  it('removes the folder of a live left empty', () => {
    const { db, old } = setup()
    deleteOldest(db, 300, new Set([2]))
    expect(existsSync(join(old[0], '..'))).toBe(false)
  })

  it('does nothing when no space is needed', () => {
    const { db } = setup()
    expect(deleteOldest(db, 0, new Set())).toEqual({ deletedSegments: 0, freedBytes: 0, stillOverBytes: 0 })
  })
})
