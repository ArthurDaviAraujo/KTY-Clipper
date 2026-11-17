import { describe, expect, it } from 'vitest'
import { parseChannelInput } from '../src/shared/channels'
import { parseIrcLine } from '../src/main/platforms/twitch'
import { parseSegmentCsv, seqFromFile } from '../src/main/recorder'
import { openDb } from '../src/main/db'

describe('parseChannelInput', () => {
  it('accepts names, @names and links', () => {
    expect(parseChannelInput('twitch', 'Gaules')).toEqual({ platform: 'twitch', login: 'gaules' })
    expect(parseChannelInput('twitch', '@xQc')).toEqual({ platform: 'twitch', login: 'xqc' })
    expect(parseChannelInput('twitch', 'https://www.twitch.tv/kaicenat/videos')).toEqual({ platform: 'twitch', login: 'kaicenat' })
  })

  it('the link platform wins over the selected one', () => {
    expect(parseChannelInput('twitch', 'kick.com/some-streamer')).toEqual({ platform: 'kick', login: 'some-streamer' })
    expect(parseChannelInput('kick', 'twitch.tv/ibai')).toEqual({ platform: 'twitch', login: 'ibai' })
  })

  it('rejects invalid input', () => {
    expect(parseChannelInput('twitch', '')).toBeNull()
    expect(parseChannelInput('twitch', 'a b')).toBeNull()
    expect(parseChannelInput('twitch', 'twitch.tv/directory')).toBeNull()
    expect(parseChannelInput('twitch', 'nome-com-hifen')).toBeNull()
  })
})

describe('parseIrcLine', () => {
  it('reads author, text, time and emote count', () => {
    const line =
      '@badge-info=;display-name=Fulano;emotes=25:0-4,6-10/1902:12-16;tmi-sent-ts=1794840000000;user-id=1 :fulano!fulano@fulano.tmi.twitch.tv PRIVMSG #gaules :Kappa Kappa Keepo hahaha'
    expect(parseIrcLine(line)).toEqual({ channel: 'gaules', time: 1794840000000, user: 'Fulano', text: 'Kappa Kappa Keepo hahaha', emotes: 3 })
  })

  it('ignores other commands', () => {
    expect(parseIrcLine(':tmi.twitch.tv 001 justinfan123 :Welcome')).toBeNull()
    expect(parseIrcLine('PING :tmi.twitch.tv')).toBeNull()
  })
})

describe('segment list', () => {
  it('parses the ffmpeg CSV', () => {
    const csv = 'seg_00000.ts,0.000000,300.033333\nseg_00001.ts,300.033333,600.000000\n'
    expect(parseSegmentCsv(csv)).toEqual([
      { file: 'seg_00000.ts', start: 0, end: 300.033333 },
      { file: 'seg_00001.ts', start: 300.033333, end: 600 }
    ])
  })

  it('ignores an incomplete last line', () => {
    expect(parseSegmentCsv('seg_00000.ts,0.0,10.0\nseg_00001.ts,10.0')).toHaveLength(1)
  })

  it('extracts the piece number', () => {
    expect(seqFromFile('seg_00042.ts')).toBe(42)
    expect(seqFromFile('outro.ts')).toBeNull()
  })
})

describe('database migrations', () => {
  it('reach the latest version with chat and VOD columns', () => {
    const db = openDb(':memory:')
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(11)
    const cols = (db.prepare('PRAGMA table_info(lives)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toEqual(expect.arrayContaining(['kind', 'source_url', 'range_start_s', 'range_end_s', 'chat_status']))
    db.prepare(`INSERT INTO channels(platform, login, created_at) VALUES ('twitch', 'x', 0)`).run()
    db.prepare(`INSERT INTO lives(channel_id, started_at, platform_stream_id) VALUES (1, 0, 's1')`).run()
    db.prepare(`INSERT INTO chat_messages(live_id, ts_utc, user, text) VALUES (1, 0, 'u', 'oi')`).run()
    // Remover o canal apaga o histórico em cascata
    db.prepare('DELETE FROM channels WHERE id = 1').run()
    expect((db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get() as { n: number }).n).toBe(0)
  })
})
