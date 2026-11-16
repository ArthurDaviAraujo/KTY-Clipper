import { describe, expect, it } from 'vitest'
import { formatTimecode, parseTimecode, parseVodInput } from '../src/shared/vod'
import { nextCommentOffset } from '../src/main/platforms/twitch'
import { nextKickCursor, parseKickDate } from '../src/main/platforms/kick'

describe('parseVodInput', () => {
  it('Twitch links', () => {
    expect(parseVodInput('https://www.twitch.tv/videos/2930504743')).toEqual({ platform: 'twitch', id: '2930504743' })
    expect(parseVodInput('twitch.tv/videos/2930504743?t=1h2m3s')).toEqual({ platform: 'twitch', id: '2930504743' })
    expect(parseVodInput('m.twitch.tv/videos/123456789')).toEqual({ platform: 'twitch', id: '123456789' })
    expect(parseVodInput('v2930504743')).toEqual({ platform: 'twitch', id: '2930504743' })
  })

  it('Kick links', () => {
    expect(parseVodInput('https://kick.com/3mr/videos/14CEEF50-6322-4f8d-bee3-690c1a6997df')).toEqual({
      platform: 'kick',
      id: '14ceef50-6322-4f8d-bee3-690c1a6997df',
      channel: '3mr'
    })
    expect(parseVodInput('kick.com/video/14ceef50-6322-4f8d-bee3-690c1a6997df')).toEqual({ platform: 'kick', id: '14ceef50-6322-4f8d-bee3-690c1a6997df' })
  })

  it('rejects channel links and junk', () => {
    expect(parseVodInput('twitch.tv/gaules')).toBeNull()
    expect(parseVodInput('kick.com/3mr')).toBeNull()
    expect(parseVodInput('olá')).toBeNull()
  })
})

describe('timecodes', () => {
  it('parses the common formats', () => {
    expect(parseTimecode('1:02:03')).toBe(3723)
    expect(parseTimecode('62:03')).toBe(3723)
    expect(parseTimecode('3723')).toBe(3723)
    expect(parseTimecode('1h2m3s')).toBe(3723)
    expect(parseTimecode('45m')).toBe(2700)
    expect(parseTimecode('')).toBeNull()
  })
  it('flags invalid input', () => {
    expect(parseTimecode('1:75')).toBeNaN()
    expect(parseTimecode('abc')).toBeNaN()
  })
  it('formats', () => {
    expect(formatTimecode(3723)).toBe('1:02:03')
    expect(formatTimecode(65)).toBe('1:05')
  })
})

describe('nextCommentOffset', () => {
  const c = (offset: number) => ({ id: String(offset), offset, user: 'u', text: 't', emotes: 0 })
  it('moves to the last message second', () => expect(nextCommentOffset(100, [c(100), c(130), c(160)])).toBe(160))
  it('skips 1 s when the page did not advance (busy second)', () => expect(nextCommentOffset(100, [c(100), c(100)])).toBe(101))
  it('empty page skips 1 s', () => expect(nextCommentOffset(100, [])).toBe(101))
})

describe('nextKickCursor (chat da Kick ao vivo)', () => {
  const now = 1_000_000
  it('advances to the last message', () => expect(nextKickCursor(900_000, [{ time: 901_000 }, { time: 903_000 }], now)).toEqual({ cursor: 903_000, full: false }))
  it('full page means ask again right away', () => expect(nextKickCursor(900_000, Array.from({ length: 25 }, (_, i) => ({ time: 900_100 + i })), now).full).toBe(true))
  it('an empty window still moves forward (the bug that froze at 12 messages)', () => {
    let c = 900_000
    for (let i = 0; i < 3; i++) c = nextKickCursor(c, [], now).cursor
    expect(c).toBe(900_000 + 3 * 4000)
  })
  it('never goes past 2 s before now', () => expect(nextKickCursor(997_000, [], now).cursor).toBe(998_000))
  it('never goes backwards', () => expect(nextKickCursor(999_500, [], now).cursor).toBe(999_500))
})

describe('nextCommentOffset with empty step (Kick VOD)', () => {
  it('empty page jumps the Kick window', () => expect(nextCommentOffset(100, [], 4)).toBe(104))
})

describe('parseKickDate', () => {
  it('treats dates without timezone as UTC', () => {
    expect(parseKickDate('2026-11-15 22:59:03')).toBe(Date.UTC(2026, 10, 15, 22, 59, 3))
  })
  it('respects an explicit timezone', () => {
    expect(parseKickDate('2026-11-15T22:58:58+00:00')).toBe(Date.UTC(2026, 10, 15, 22, 58, 58))
    expect(parseKickDate('2026-11-15T19:58:58-03:00')).toBe(Date.UTC(2026, 10, 15, 22, 58, 58))
  })
})
