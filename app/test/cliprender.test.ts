import { describe, expect, it } from 'vitest'
import { buildClipAss, cleanRect, clipFileName, clipRange, clipSize, groupWords, layoutPlan, planParts, toClipTime } from '../src/shared/clips'
import { defaultSettings, sanitizeSettings } from '../src/shared/settings'

const SRC = { w: 1920, h: 1080 }

describe('clipSize', () => {
  it('vertical 9:16 by preset; max is 1440p, or 4K when the source is 4K', () => {
    expect(clipSize('split', 'fast', 1080)).toEqual({ W: 720, H: 1280 })
    expect(clipSize('blur', 'balanced', 1080)).toEqual({ W: 1080, H: 1920 })
    expect(clipSize('crop', 'max', 1080)).toEqual({ W: 1440, H: 2560 })
    expect(clipSize('crop', 'max', 2160)).toEqual({ W: 2160, H: 3840 })
  })
  it('horizontal stays 16:9', () => {
    expect(clipSize('full', 'balanced', 1080)).toEqual({ W: 1920, H: 1080 })
  })
})

describe('layoutPlan', () => {
  const out = { W: 1080, H: 1920 }
  it('split without a facecam falls back to the blurred full screen', () => {
    const p = layoutPlan('split', SRC, out, null)
    expect(p.layout).toBe('blur')
    expect(p.graph).toContain('boxblur')
    expect(p.title.always).toBe(true)
  })
  it('split stacks the facecam over a game crop that fills the width', () => {
    const p = layoutPlan('split', SRC, out, { x: 0.75, y: 0.7, w: 0.25, h: 0.3 })
    expect(p.layout).toBe('split')
    // câmera 480×324 (≈1,48) → 1080/1,48 = 729 px de altura, dentro de 28–42%
    expect(p.graph).toMatch(/crop=480:324:1440:756/)
    expect(p.graph).toContain('vstack=inputs=2[out]')
    const top = Number(p.graph.match(/scale=1080:(\d+):force_original_aspect_ratio=increase/)![1])
    expect(top).toBeGreaterThanOrEqual(1920 * 0.28)
    expect(top).toBeLessThanOrEqual(1920 * 0.42)
    expect(p.captionY).toBe(top)
    // jogo: recorte com a proporção da parte de baixo (1080 × resto), altura cheia da fonte
    const g = p.graph.match(/\[g0\]crop=(\d+):(\d+):(\d+):(\d+)/)!.slice(1).map(Number)
    expect(g[1]).toBe(1080)
    expect(Math.abs(g[0] / g[1] - 1080 / (1920 - top))).toBeLessThan(0.01)
    expect(g[2]).toBe(Math.round((1920 - g[0]) / 2 / 2) * 2)
  })
  it('crop takes a 9:16 slice from the chosen position', () => {
    const center = layoutPlan('crop', SRC, out, null)
    expect(center.graph).toMatch(/crop=608:1080:656:0/)
    const left = layoutPlan('crop', SRC, out, null, 0)
    expect(left.graph).toMatch(/crop=608:1080:0:0/)
    const right = layoutPlan('crop', SRC, out, null, 1)
    expect(right.graph).toMatch(/crop=608:1080:1312:0/)
  })
  it('full keeps 16:9 as is', () => {
    expect(layoutPlan('full', SRC, { W: 1920, H: 1080 }, null).graph).toBe('[in]scale=1920:1080:flags=lanczos,setsar=1[out]')
  })
  it('blur puts captions below the video and the title above it', () => {
    const p = layoutPlan('blur', SRC, out, null)
    const fgTop = (1920 - 608) / 2
    expect(p.captionY).toBeGreaterThan(fgTop + 608)
    expect(p.title.y).toBeLessThan(fgTop)
    expect(p.title.align).toBe(2)
  })
})

describe('cleanRect', () => {
  it('clamps into the frame and rejects garbage', () => {
    expect(cleanRect({ x: -1, y: 0.9, w: 2, h: 0.5 })).toEqual({ x: 0, y: 0.9, w: 1, h: 0.09999999999999998 })
    expect(cleanRect({ x: NaN, y: 0, w: 1, h: 1 })).toBeNull()
    expect(cleanRect(null)).toBeNull()
  })
})

describe('planParts / toClipTime', () => {
  const T = 1_700_000_000_000
  const segs = [
    { path: 'a.ts', startUtc: T, durS: 300 },
    { path: 'b.ts', startUtc: T + 300_000, durS: 300 },
    // buraco de 10 s (o gravador reiniciou)
    { path: 'c.ts', startUtc: T + 610_000, durS: 300 }
  ]
  it('a clip inside one piece', () => {
    expect(planParts(segs, T + 10_000, T + 40_000)).toEqual([{ file: 'a.ts', inS: 10, durS: 30, startUtc: T + 10_000 }])
  })
  it('a clip across two pieces and across a gap', () => {
    const p = planParts(segs, T + 290_000, T + 320_000)
    expect(p.map((x) => [x.file, x.inS, x.durS])).toEqual([
      ['a.ts', 290, 10],
      ['b.ts', 0, 20]
    ])
    const g = planParts(segs, T + 595_000, T + 620_000)
    expect(g.map((x) => [x.file, x.inS, x.durS])).toEqual([
      ['b.ts', 295, 5],
      ['c.ts', 0, 10]
    ])
    // no clipe o buraco some: o que veio depois dele começa logo após o primeiro trecho
    expect(toClipTime(g, T + 612_000)).toBe(7)
    expect(toClipTime(g, T + 605_000)).toBeNull()
  })
  it('overlapping pieces do not repeat footage', () => {
    const p = planParts(
      [
        { path: 'x.ts', startUtc: T, durS: 10 },
        { path: 'y.ts', startUtc: T + 9_000, durS: 10 }
      ],
      T,
      T + 15_000
    )
    expect(p.reduce((a, x) => a + x.durS, 0)).toBe(15)
    expect(p[1]).toMatchObject({ file: 'y.ts', inS: 1 })
  })
})

describe('clipRange', () => {
  const m = { startUtc: 100_000, endUtc: 130_000, peakUtc: 115_000 }
  it('adds the margins', () => {
    expect(clipRange(m, { padBeforeS: 2, padAfterS: 3, maxS: 60 })).toEqual({ fromUtc: 98_000, toUtc: 133_000 })
  })
  it('a long moment is cut around the peak, more before than after', () => {
    const r = clipRange({ startUtc: 0, endUtc: 200_000, peakUtc: 150_000 }, { padBeforeS: 0, padAfterS: 0, maxS: 60 })
    expect(r).toEqual({ fromUtc: 114_000, toUtc: 174_000 })
  })
  it('stays inside the recorded footage', () => {
    expect(clipRange(m, { padBeforeS: 5, padAfterS: 5, maxS: 60 }, { fromUtc: 99_000, toUtc: 200_000 })).toEqual({ fromUtc: 99_000, toUtc: 135_000 })
  })
})

describe('captions', () => {
  const w = (text: string, start: number, end: number) => ({ text, start, end })
  it('groups by count, pause and end of sentence', () => {
    const g = groupWords([w('olha', 0, 0.3), w('isso', 0.3, 0.6), w('mano!', 0.6, 0.9), w('caramba', 2, 2.4), w('que', 2.4, 2.5), w('isso', 2.5, 2.7), w('aí', 2.7, 2.9)], 3, 22)
    expect(g.map((x) => x.map((y) => y.text).join(' '))).toEqual(['olha isso mano!', 'caramba que isso', 'aí'])
  })
  it('ASS highlights the spoken word and carries the title box', () => {
    const ass = buildClipAss({
      W: 1080,
      H: 1920,
      duration: 10,
      captions: { words: [w('olha', 1, 1.3), w('isso', 1.3, 1.6)], perGroup: 3, upper: true, color: '#ffd400', sizePct: 7.5, y: 1500 },
      title: { text: 'Que jogada 🔥 {absurda}', y: 600, align: 2, always: true }
    })
    expect(ass).toContain('PlayResX: 1080')
    expect(ass).toContain('Dialogue: 1,0:00:00.00,0:00:10.00,Title,,0,0,0,,{\\an2\\pos(540,600)}Que jogada (absurda)')
    expect(ass).toContain('Dialogue: 0,0:00:01.00,0:00:01.30,Cap,,0,0,0,,{\\pos(540,1500)}{\\c&H0000D4FF&\\fscx110\\fscy110}OLHA{\\r} ISSO'.replace('&H0000D4FF&', '&H0000D4FF'))
    expect(ass).toContain('Dialogue: 0,0:00:01.30,0:00:01.60,Cap,,0,0,0,,{\\pos(540,1500)}OLHA {\\c&H0000D4FF\\fscx110\\fscy110}ISSO{\\r}')
  })
  it('title only in the first 4 s when not "always"', () => {
    const ass = buildClipAss({ W: 1080, H: 1920, duration: 30, captions: null, title: { text: 'Oi', y: 50, align: 8, always: false } })
    expect(ass).toContain('Dialogue: 1,0:00:00.00,0:00:04.00,Title')
    expect(ass).not.toContain(',Cap,')
  })
})

describe('clipFileName', () => {
  it('is safe for Windows and carries date, channel, title and id', () => {
    const d = new Date(2026, 10, 16, 22, 0).getTime()
    expect(clipFileName('spkclb', d, 'Ele disse: "clipa isso?" 😂 / <agora>', 12)).toBe('2026-11-16 spkclb - Ele disse clipa isso agora (12).mp4')
    expect(clipFileName('x', d, '...', 3)).toBe('2026-11-16 x - clipe (3).mp4')
  })
})

describe('clip settings', () => {
  it('defaults and clamps', () => {
    const s = defaultSettings()
    expect(s.clips.layout).toBe('split')
    s.clips.captions.words = 99
    s.clips.captions.color = 'red'
    s.clips.maxDurationS = 2
    s.clips.layout = 'weird' as never
    const c = sanitizeSettings(s).clips
    expect(c.captions.words).toBe(8)
    expect(c.captions.color).toBe('#ffd400')
    expect(c.maxDurationS).toBe(10)
    expect(c.layout).toBe('split')
  })
})
