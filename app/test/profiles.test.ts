import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb } from '../src/main/db'
import { ProfileStore } from '../src/main/profiles'
import { defaultSettings, portableSettings, withMachine } from '../src/shared/settings'

describe('machine vs profile settings', () => {
  it('switching keeps this PC folders, programs and encoder', () => {
    const pc = defaultSettings()
    pc.storage.recordingsDir = 'D:\\Clipador KTY\\gravacoes'
    pc.toolPaths.ffmpeg = 'C:\\x\\ffmpeg.exe'
    pc.quality.encoder = 'h264_amf'
    const other = defaultSettings()
    other.clips.layout = 'crop'
    other.storage.recordingsDir = 'C:\\outro'
    const s = withMachine(other, pc)
    expect(s.clips.layout).toBe('crop')
    expect(s.storage.recordingsDir).toBe('D:\\Clipador KTY\\gravacoes')
    expect(s.toolPaths.ffmpeg).toBe('C:\\x\\ffmpeg.exe')
    expect(s.quality.encoder).toBe('h264_amf')
  })
  it('exported presets carry no paths of this PC', () => {
    const s = defaultSettings()
    s.storage.clipsDir = 'D:\\clipes'
    s.toolPaths.whisper = 'C:\\w.exe'
    const p = portableSettings(s) as Record<string, unknown>
    expect(p.storage).toBeUndefined()
    expect(p.toolPaths).toBeUndefined()
    expect((p.clips as { layout: string }).layout).toBe('split')
  })
})

describe('ProfileStore', () => {
  const store = () => new ProfileStore(openDb(':memory:'), mkdtempSync(join(tmpdir(), 'perfis-')))
  it('the first profile inherits the old settings and becomes active', () => {
    const p = store()
    const id = p.ensure({ clips: { layout: 'full' } }, 'arthu')
    expect(p.activeId()).toBe(id)
    expect(p.list().profiles.map((x) => x.name)).toEqual(['arthu'])
    expect(p.settingsOf(id)).toEqual({ clips: { layout: 'full' } })
    // chamar de novo não cria outro
    p.ensure(null, 'x')
    expect(p.list().profiles).toHaveLength(1)
  })
  it('create, switch, rename, photo and delete', () => {
    const p = store()
    const a = p.ensure(null, 'A')
    const b = p.create('  Amigo   1 ', { x: 1 })
    expect(p.list().profiles.find((x) => x.id === b)?.name).toBe('Amigo 1')
    p.setActive(b)
    expect(p.activeId()).toBe(b)
    expect(() => p.delete(b)).toThrow(/outro perfil/)
    p.update(a, { name: 'Arthur', color: '#ff3d8b' })
    expect(p.list().profiles[0]).toMatchObject({ name: 'Arthur', color: '#ff3d8b', hasPhoto: false })
    const img = join(mkdtempSync(join(tmpdir(), 'img-')), 'eu.png')
    writeFileSync(img, 'png')
    p.setPhoto(a, img)
    expect(p.list().profiles[0].hasPhoto).toBe(true)
    expect(() => p.setPhoto(a, 'x.exe')).toThrow(/imagem/)
    p.delete(a)
    expect(p.list().profiles.map((x) => x.id)).toEqual([b])
    expect(() => p.delete(b)).toThrow(/pelo menos um/)
  })
})
