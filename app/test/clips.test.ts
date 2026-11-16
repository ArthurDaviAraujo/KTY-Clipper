import { describe, expect, it } from 'vitest'
import { clipBelongs, clipWindow, twitchClipPeriod, type CommunityClip } from '../src/main/platforms/clips'
import { BUCKET_S, clipStrength, detectMoments, type Bucket } from '../src/main/detector'

const T0 = Date.UTC(2026, 10, 15, 15)
const clip = (o: Partial<CommunityClip>): CommunityClip => ({
  id: 'c1',
  title: 'lkkkkk',
  views: 101,
  durationS: 60,
  offsetS: 2326,
  createdAt: T0 + 2400_000,
  videoId: '2929840281',
  broadcastId: '319',
  url: 'https://x',
  ...o
})

describe('clipWindow', () => {
  it('uses the VOD position when available (Twitch)', () => {
    expect(clipWindow(clip({}), T0)).toEqual({ startUtc: T0 + 2326_000, endUtc: T0 + 2386_000 })
  })
  it('without position, the clip ends when it was created (Kick)', () => {
    expect(clipWindow(clip({ offsetS: null, createdAt: T0 + 1000_000, durationS: 30 }), T0)).toEqual({ startUtc: T0 + 970_000, endUtc: T0 + 1000_000 })
  })
})

describe('clipBelongs', () => {
  const live = { vodId: null, broadcastId: null, startUtc: T0, endUtc: T0 + 3600_000 }
  it('matches by VOD, then broadcast, then time', () => {
    expect(clipBelongs(clip({}), { ...live, vodId: '2929840281' })).toBe(true)
    expect(clipBelongs(clip({}), { ...live, vodId: '999' })).toBe(false)
    expect(clipBelongs(clip({ videoId: null }), { ...live, broadcastId: '319' })).toBe(true)
    expect(clipBelongs(clip({ videoId: null, broadcastId: '1' }), { ...live, broadcastId: '319' })).toBe(false)
    expect(clipBelongs(clip({ videoId: null, broadcastId: null }), live)).toBe(true)
    expect(clipBelongs(clip({ videoId: null, broadcastId: null, createdAt: T0 + 9_000_000 }), live)).toBe(false)
  })
})

describe('twitchClipPeriod', () => {
  it('picks the period by the age of the live', () => {
    const now = T0
    expect(twitchClipPeriod(now - 3600_000, now)).toBe('LAST_DAY')
    expect(twitchClipPeriod(now - 3 * 86_400_000, now)).toBe('LAST_WEEK')
    expect(twitchClipPeriod(now - 20 * 86_400_000, now)).toBe('LAST_MONTH')
    expect(twitchClipPeriod(now - 90 * 86_400_000, now)).toBe('ALL_TIME')
  })
})

describe('community clips in the detector', () => {
  const quiet = (min: number): Bucket[] =>
    Array.from({ length: (min * 60) / BUCKET_S }, (_, i) => ({ t: T0 + i * BUCKET_S * 1000, msgs: 2, uniq: 2, laughs: 0, hype: 0, emotes: 0, audioDb: -30 }))
  const P = { chatWeight: 0.8, audioWeight: 0.6, voiceWeight: 1, clipWeight: 0.9, minScore: 35, maxPerHour: 10, chatLagS: 12 }

  it('a community clip alone becomes a strong moment covering the clip', () => {
    const c = { startUtc: T0 + 600_000, endUtc: T0 + 660_000, views: 101, title: 'lkkkkk', url: 'u' }
    const m = detectMoments(quiet(30), P, [], [c])
    expect(m).toHaveLength(1)
    expect(m[0].startUtc).toBe(T0 + 597_000)
    expect(m[0].endUtc).toBe(T0 + 663_000)
    expect(m[0].clip?.title).toBe('lkkkkk')
    expect(m[0].score).toBeGreaterThanOrEqual(85)
    expect(m[0].reasons[0]).toMatch(/Clipado pela comunidade/)
  })
  it('clip weight 0 ignores clips; clips outside the recording are ignored', () => {
    const c = { startUtc: T0 + 600_000, endUtc: T0 + 660_000, views: 5, title: '', url: '' }
    expect(detectMoments(quiet(30), { ...P, clipWeight: 0 }, [], [c])).toEqual([])
    expect(detectMoments(quiet(30), P, [], [{ ...c, startUtc: T0 + 9_000_000, endUtc: T0 + 9_060_000 }])).toEqual([])
  })
  it('strength grows with views; a 5-view clip is no longer near the top', () => {
    expect(clipStrength(0)).toBeCloseTo(0.45)
    expect(clipStrength(5)).toBeLessThan(0.7)
    expect(clipStrength(1)).toBeLessThan(clipStrength(50))
    expect(clipStrength(10_000)).toBe(1)
  })
})
