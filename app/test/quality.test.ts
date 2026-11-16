import { describe, expect, it } from 'vitest'
import { parseMasterPlaylist, pickVariant } from '../src/main/platforms/kick'

// Formato real da Kick (2026-11-16), com uma variante 4K e uma 2K acrescentadas para o teste
const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="2160p60",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=30000000,AVERAGE-BANDWIDTH=28000000,RESOLUTION=3840x2160,CODECS="avc1.640033,mp4a.40.2",VIDEO="chunked",FRAME-RATE=60.000
https://cdn.example/2160p60/index.m3u8?t=1
#EXT-X-STREAM-INF:BANDWIDTH=16000000,RESOLUTION=2560x1440,CODECS="avc1.640032,mp4a.40.2",VIDEO="1440p60",FRAME-RATE=60.000
https://cdn.example/1440p60/index.m3u8?t=1
#EXT-X-STREAM-INF:BANDWIDTH=9069612,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2",VIDEO="1080p60",FRAME-RATE=60.000,SUBTITLES="subtitles"
1080p60/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3422999,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2",VIDEO="720p60",FRAME-RATE=60.000
https://cdn.example/720p60/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1427999,RESOLUTION=852x480,CODECS="avc1.4D401F,mp4a.40.2",VIDEO="480p30",FRAME-RATE=30.000
https://cdn.example/480p30/index.m3u8
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subtitles",NAME="Portuguese",LANGUAGE="pt",URI="https://cdn.example/sub/pt.m3u8"
`
const BASE = 'https://cdn.example/master/playlist.m3u8?token=x'

describe('parseMasterPlaylist', () => {
  it('reads every resolution and ignores subtitle tracks', () => {
    const v = parseMasterPlaylist(MASTER, BASE)
    expect(v.map((x) => x.height)).toEqual([2160, 1440, 1080, 720, 480])
    expect(v[0]).toMatchObject({ width: 3840, fps: 60, bandwidth: 30000000 })
  })

  it('resolves relative links against the master playlist', () => {
    expect(parseMasterPlaylist(MASTER, BASE)[2].url).toBe('https://cdn.example/master/1080p60/index.m3u8')
  })
})

describe('pickVariant', () => {
  const v = parseMasterPlaylist(MASTER, BASE)
  it('Máxima picks 4K when it exists', () => expect(pickVariant(v, 'best')?.height).toBe(2160))
  it('respects the limits', () => {
    expect(pickVariant(v, '1440')?.height).toBe(1440)
    expect(pickVariant(v, '1080')?.height).toBe(1080)
    expect(pickVariant(v, '720')?.height).toBe(720)
  })
  it('"até 4K" on a 1080p live takes the 1080p', () => {
    expect(pickVariant(v.filter((x) => x.height <= 1080), '2160')?.height).toBe(1080)
  })
  it('prefers 60 fps at the same resolution', () => {
    const same = [
      { url: 'a', width: 1920, height: 1080, fps: 30, bandwidth: 6e6 },
      { url: 'b', width: 1920, height: 1080, fps: 60, bandwidth: 9e6 }
    ]
    expect(pickVariant(same, 'best')?.url).toBe('b')
  })
  it('when nothing fits the limit, takes the smallest', () => {
    expect(pickVariant(v.filter((x) => x.height >= 1080), '480')?.height).toBe(1080)
  })
  it('empty list returns null', () => expect(pickVariant([], 'best')).toBeNull())
})
