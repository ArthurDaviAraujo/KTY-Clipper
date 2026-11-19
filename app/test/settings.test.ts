import { describe, expect, it } from 'vitest'
import { defaultSettings, mergeSettings, sanitizeSettings } from '../src/shared/settings'

describe('mergeSettings', () => {
  it('applies nested changes and keeps the rest', () => {
    const s = mergeSettings(defaultSettings(), { detectors: { chat: { enabled: false } }, ai: { provider: 'local' } })
    expect(s.detectors.chat.enabled).toBe(false)
    expect(s.detectors.chat.weight).toBe(0.8)
    expect(s.detectors.audio.enabled).toBe(true)
    expect(s.ai.provider).toBe('local')
    expect(s.ai.fallbackToLocal).toBe(true)
  })

  it('ignores unknown keys and wrong types (old or broken file)', () => {
    const s = mergeSettings(defaultSettings(), { lixo: 1, performance: { mode: 5 }, storage: 'x' })
    expect(s).toEqual(defaultSettings())
  })

  it('accepts free tool paths', () => {
    const s = mergeSettings(defaultSettings(), { toolPaths: { ffmpeg: 'C:\\ff\\ffmpeg.exe', streamlink: 3 } })
    expect(s.toolPaths).toEqual({ ffmpeg: 'C:\\ff\\ffmpeg.exe' })
  })

  it('does not change the base object', () => {
    const base = defaultSettings()
    mergeSettings(base, { language: 'en' })
    expect(base.language).toBe('pt')
  })
})

describe('sanitizeSettings', () => {
  it('clamps weights and disk warning', () => {
    const s = defaultSettings()
    s.detectors.chat.weight = 7
    s.detectors.audio.weight = -1
    s.storage.warnFreeGb = 0
    const c = sanitizeSettings(s)
    expect(c.detectors.chat.weight).toBe(1)
    expect(c.detectors.audio.weight).toBe(0)
    expect(c.storage.warnFreeGb).toBe(50)
  })
})

describe('durações dos cortes (análise dos cortes que viralizam)', () => {
  it('quem ainda tinha o padrão antigo (20–45 s em jogo) passa para o novo; quem mexeu fica como está', () => {
    const s = defaultSettings()
    s.modalities.presets.game = { ...s.modalities.presets.game, minDurationS: 20, maxDurationS: 45, padBeforeS: 2, padAfterS: 2 }
    s.modalities.presets.talk = { ...s.modalities.presets.talk, minDurationS: 30, maxDurationS: 50 }
    const out = sanitizeSettings(s)
    expect(out.modalities.presets.game).toMatchObject({ minDurationS: 30, maxDurationS: 110, padBeforeS: 4 })
    expect(out.modalities.presets.talk).toMatchObject({ minDurationS: 30, maxDurationS: 50 })
  })
})

describe('modelo das reservas da KaTY', () => {
  it('guarda o modelo escolhido de cada reserva (antes era descartado)', () => {
    const s = mergeSettings(defaultSettings(), { ai: { backupModels: { groq: 'openai/gpt-oss-120b' } } })
    expect(s.ai.backupModels.groq).toBe('openai/gpt-oss-120b')
    const t = mergeSettings(s, { ai: { backupModels: { openrouter: 'google/gemma-4-31b-it:free' } } })
    expect(t.ai.backupModels).toEqual({ groq: 'openai/gpt-oss-120b', openrouter: 'google/gemma-4-31b-it:free' })
  })
})
