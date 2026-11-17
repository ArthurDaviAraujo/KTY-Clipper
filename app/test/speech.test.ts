import { describe, expect, it } from 'vitest'
import { dropLoops, findVoiceTriggers, parseWhisperJson } from '../src/main/speech'
import { BUCKET_S, detectMoments, type Bucket } from '../src/main/detector'
import { buildReviewPrompt, combineScore, speechWithTimes, type AiVerdict } from '../src/main/ai/review'
import { pickGeminiModel } from '../src/main/ai/gemini'

describe('parseWhisperJson', () => {
  it('keeps words with times and drops markers', () => {
    const json = {
      result: { language: 'pt' },
      transcription: [
        { offsets: { from: 0, to: 0 }, text: '' },
        { offsets: { from: 80, to: 350 }, text: ' Clipa' },
        { offsets: { from: 350, to: 600 }, text: ' isso!' },
        { offsets: { from: 700, to: 900 }, text: ' [MÚSICA]' },
        { offsets: { from: 900, to: 1200 }, text: ' (risos)' }
      ]
    }
    expect(parseWhisperJson(json)).toEqual({
      language: 'pt',
      words: [
        { from: 80, to: 350, text: 'Clipa' },
        { from: 350, to: 600, text: 'isso!' }
      ]
    })
  })
})

describe('dropLoops', () => {
  const ws = (s: string) => s.split(' ').map((text, i) => ({ text, from: i * 300 }))
  it('cuts a Whisper loop down to two copies', () => {
    const loop = Array(20).fill('A gente vai trocar o meu depoco.').join(' ')
    const out = dropLoops(ws(`Bom dia. ${loop} Mas tipo, que aconteceu?`))
    const text = out.map((w) => w.text).join(' ')
    expect((text.match(/depoco/g) ?? []).length).toBe(2)
    expect(text.startsWith('Bom dia.')).toBe(true)
    expect(text.endsWith('que aconteceu?')).toBe(true)
  })
  it('keeps real repetition like "clipa clipa"', () => {
    const w = ws('clipa clipa clipa isso agora')
    expect(dropLoops(w)).toHaveLength(5)
  })
  it('keeps normal speech untouched', () => {
    const w = ws('eu prometo não decepcionar hoje é a última dança')
    expect(dropLoops(w)).toEqual(w)
  })
})

describe('findVoiceTriggers', () => {
  const w = (t: number, text: string) => ({ t, text })
  const triggers = ['clipa isso', 'clip that', 'manda pro clipe']
  it('finds phrases ignoring accents, case and punctuation', () => {
    const words = [w(1000, 'Mano,'), w(1300, 'CLIPA'), w(1600, 'isso!!'), w(5000, 'nossa'), w(40_000, 'Clip'), w(40_300, 'that.')]
    expect(findVoiceTriggers(words, triggers)).toEqual([
      { t: 1600, phrase: 'clipa isso' },
      { t: 40_300, phrase: 'clip that' }
    ])
  })
  it('ignores repeats within 20 s', () => {
    const words = [w(1000, 'clipa'), w(1200, 'isso'), w(3000, 'clipa'), w(3200, 'isso')]
    expect(findVoiceTriggers(words, triggers)).toHaveLength(1)
  })
  it('handles a Whisper "word" with a space inside', () => {
    expect(findVoiceTriggers([w(1000, 'manda pro'), w(1300, 'clipe')], triggers)).toEqual([{ t: 1300, phrase: 'manda pro clipe' }])
  })
  it('does not match a partial phrase', () => {
    expect(findVoiceTriggers([w(1000, 'clipa'), w(1300, 'aquilo')], triggers)).toEqual([])
  })
})

describe('detectMoments with voice', () => {
  const T0 = Date.UTC(2026, 10, 16, 20)
  const quiet = (min: number): Bucket[] =>
    Array.from({ length: (min * 60) / BUCKET_S }, (_, i) => ({ t: T0 + i * BUCKET_S * 1000, msgs: 2, uniq: 2, laughs: 0, hype: 0, emotes: 0, audioDb: -30 }))
  it('a voice trigger alone becomes a moment covering the 30 s before it', () => {
    const t = T0 + 600_000
    const m = detectMoments(quiet(30), { chatWeight: 0.8, audioWeight: 0.6, voiceWeight: 1, minScore: 35, maxPerHour: 10, chatLagS: 12 }, [{ t, phrase: 'clipa isso' }])
    expect(m).toHaveLength(1)
    expect(m[0].startUtc).toBe(t - 30_000)
    expect(m[0].voice?.phrase).toBe('clipa isso')
    expect(m[0].score).toBe(90)
    expect(m[0].reasons[0]).toMatch(/pediu clipe/)
  })
  it('voice weight 0 ignores triggers', () => {
    const m = detectMoments(quiet(30), { chatWeight: 0.8, audioWeight: 0.6, voiceWeight: 0, minScore: 35, maxPerHour: 10, chatLagS: 12 }, [{ t: T0 + 600_000, phrase: 'x' }])
    expect(m).toEqual([])
  })
})

describe('AI review helpers', () => {
  it('speech with relative times breaks on pauses', () => {
    const s = speechWithTimes(
      [
        { t: 10_000, text: 'olha' },
        { t: 10_400, text: 'isso' },
        { t: 14_000, text: 'caramba' }
      ],
      9_000
    )
    expect(s).toBe('[1s] olha isso\n[5s] caramba')
  })
  it('prompt carries context, signals, speech and chat', () => {
    const p = buildReviewPrompt({ channel: 'Fulano', liveTitle: 'RP' }, [
      { id: 7, durationS: 40, game: 'Grand Theft Auto V', reasons: ['Chat 3× acima do normal'], speech: '[1s] olha', chat: ['a: KEKW'] }
    ])
    expect(p).toContain('Canal: Fulano')
    expect(p).toContain('Categoria: Grand Theft Auto V (jogo)')
    expect(p).toContain('### Momento 7 (40 s)')
    expect(p).toContain('Chat 3× acima do normal')
    expect(p).toContain('- a: KEKW')
  })
  it('combines scores and caps discarded ones', () => {
    const v = (keep: boolean, score: number): AiVerdict => ({ id: 1, keep, score, category: 'engraçado', title_pt: '', title_en: '', reason: '', hashtags: [] })
    expect(combineScore(50, v(true, 100))).toBe(80)
    expect(combineScore(90, v(false, 80))).toBe(30)
  })
  it('the AI cannot veto a moment clipped by people (it does not see the screen)', () => {
    const v = (keep: boolean, score: number): AiVerdict => ({ id: 1, keep, score, category: 'outro', title_pt: '', title_en: '', reason: '', hashtags: [] })
    expect(combineScore(90, v(false, 30), true)).toBe(72)
    expect(combineScore(90, v(true, 90), true)).toBe(90)
  })
  it('picks a lite Gemini model when available', () => {
    expect(pickGeminiModel(['gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'])).toBe('gemini-2.5-flash-lite')
    expect(pickGeminiModel(['gemini-9-flash', 'text-embedding-004'])).toBe('gemini-9-flash')
    expect(pickGeminiModel(['gemini-2.5-pro'])).toBeNull()
  })
})
