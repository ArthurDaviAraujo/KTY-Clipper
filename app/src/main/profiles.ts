import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'fs'
import { extname, join } from 'path'
import type { Db } from './db'
import { kvGet, kvSet } from './db'
import type { Profile, ProfilesInfo } from '../shared/types'

interface Row {
  id: number
  name: string
  color: string
  photo: string | null
  settings: string | null
  created_at: number
}

const COLORS = ['#3d7bf6', '#ff3d8b', '#8b5cf6', '#22c55e', '#f5a524', '#06b6d4']

/**
 * Perfis deste PC (sem senha nem servidor): cada um guarda os próprios ajustes e predefinições.
 * O perfil ativo fica em kv "activeProfile".
 */
export class ProfileStore {
  constructor(
    private db: Db,
    private photosDir: string
  ) {}

  /** Garante um perfil (o primeiro herda os ajustes que já existiam) e devolve o ativo. */
  ensure(initialSettings: unknown, defaultName: string): number {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }).n
    if (!n) {
      const id = this.insert(defaultName, initialSettings)
      kvSet(this.db, 'activeProfile', id)
    }
    const active = kvGet<number>(this.db, 'activeProfile')
    if (active && this.row(active)) return active
    const first = (this.db.prepare('SELECT id FROM profiles ORDER BY id LIMIT 1').get() as { id: number }).id
    kvSet(this.db, 'activeProfile', first)
    return first
  }

  private row(id: number): Row | null {
    return (this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Row | undefined) ?? null
  }

  private insert(name: string, settings: unknown, color?: string): number {
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }).n
    const r = this.db
      .prepare('INSERT INTO profiles(name, color, settings, created_at) VALUES (?, ?, ?, ?) RETURNING id')
      .get(clean(name) || 'Perfil', color ?? COLORS[count % COLORS.length], settings == null ? null : JSON.stringify(settings), Date.now()) as { id: number }
    return r.id
  }

  activeId(): number {
    return kvGet<number>(this.db, 'activeProfile') ?? 0
  }

  list(): ProfilesInfo {
    const rows = this.db.prepare('SELECT * FROM profiles ORDER BY id').all() as unknown as Row[]
    return { profiles: rows.map((r) => this.toProfile(r)), activeId: this.activeId() }
  }

  private toProfile(r: Row): Profile {
    const has = !!r.photo && existsSync(r.photo)
    return { id: r.id, name: r.name, color: r.color, hasPhoto: has, photoVersion: has ? Math.round(statSync(r.photo!).mtimeMs) : 0, createdAt: r.created_at }
  }

  settingsOf(id: number): unknown {
    const r = this.row(id)
    if (!r?.settings) return null
    try {
      return JSON.parse(r.settings)
    } catch {
      return null
    }
  }

  saveSettings(id: number, settings: unknown): void {
    this.db.prepare('UPDATE profiles SET settings = ? WHERE id = ?').run(JSON.stringify(settings), id)
  }

  create(name: string, settings: unknown): number {
    return this.insert(name, settings)
  }

  setActive(id: number): void {
    if (!this.row(id)) throw new Error('Perfil não encontrado.')
    kvSet(this.db, 'activeProfile', id)
  }

  update(id: number, patch: { name?: string; color?: string }): void {
    if (patch.name != null && clean(patch.name)) this.db.prepare('UPDATE profiles SET name = ? WHERE id = ?').run(clean(patch.name), id)
    if (patch.color != null && /^#[0-9a-f]{6}$/i.test(patch.color)) this.db.prepare('UPDATE profiles SET color = ? WHERE id = ?').run(patch.color, id)
  }

  /** Copia a imagem escolhida para a pasta de dados (o original pode ser apagado depois). */
  setPhoto(id: number, source: string): void {
    const ext = extname(source).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) throw new Error('Use uma imagem PNG, JPG, WEBP ou GIF.')
    mkdirSync(this.photosDir, { recursive: true })
    const old = this.row(id)?.photo
    if (old) rmSync(old, { force: true })
    const out = join(this.photosDir, `perfil_${id}_${Date.now()}${ext}`)
    copyFileSync(source, out)
    this.db.prepare('UPDATE profiles SET photo = ? WHERE id = ?').run(out, id)
  }

  photoPath(id: number): string | null {
    const p = this.row(id)?.photo
    return p && existsSync(p) ? p : null
  }

  delete(id: number): void {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }).n
    if (n <= 1) throw new Error('Precisa ficar pelo menos um perfil.')
    if (id === this.activeId()) throw new Error('Entre em outro perfil antes de apagar este.')
    const p = this.row(id)?.photo
    if (p) rmSync(p, { force: true })
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
  }
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 40)
