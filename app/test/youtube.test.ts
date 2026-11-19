import { describe, expect, it } from 'vitest'
import { channelUrl, groupChannels, parseChannelInput, platformOfLink, wherePlatforms } from '../src/shared/channels'
import { parseVodInput } from '../src/shared/vod'
import { modalityOf } from '../src/shared/modality'
import { chatItem, extractJson, loginFromOwner, parseViewers, youtubeChannelUrl } from '../src/main/platforms/youtube'

describe('links do YouTube', () => {
  it('canal: @, id UC, links antigos e o link vence a plataforma escolhida', () => {
    expect(parseChannelInput('twitch', 'https://www.youtube.com/@CazeTV/live')).toEqual({ platform: 'youtube', login: 'cazetv' })
    expect(parseChannelInput('youtube', '@Gaules')).toEqual({ platform: 'youtube', login: 'gaules' })
    expect(parseChannelInput('youtube', 'youtube.com/channel/UC5ZTRH1zclthyc6b_D3m2Pw')).toEqual({ platform: 'youtube', login: 'UC5ZTRH1zclthyc6b_D3m2Pw' })
    expect(parseChannelInput('youtube', 'https://youtube.com/c/Gaules')).toEqual({ platform: 'youtube', login: 'c/Gaules' })
    expect(parseChannelInput('youtube', 'watch')).toBeNull()
    expect(channelUrl('youtube', 'cazetv')).toBe('https://www.youtube.com/@cazetv')
    expect(youtubeChannelUrl('UC5ZTRH1zclthyc6b_D3m2Pw')).toBe('https://www.youtube.com/channel/UC5ZTRH1zclthyc6b_D3m2Pw')
  })
  it('"Todos": descobre a plataforma pelo link', () => {
    expect(platformOfLink('https://youtu.be/abc')).toBe('youtube')
    expect(platformOfLink('kick.com/gaules')).toBe('kick')
    expect(platformOfLink('www.twitch.tv/gaules')).toBe('twitch')
    expect(platformOfLink('gaules')).toBeNull()
  })
  it('vídeo para importar', () => {
    expect(parseVodInput('https://www.youtube.com/watch?v=BJYvQoXXJyU&t=120s')).toEqual({ platform: 'youtube', id: 'BJYvQoXXJyU' })
    expect(parseVodInput('https://youtu.be/BJYvQoXXJyU?si=x')).toEqual({ platform: 'youtube', id: 'BJYvQoXXJyU' })
    expect(parseVodInput('youtube.com/live/m9GZ-bkD5aI')).toEqual({ platform: 'youtube', id: 'm9GZ-bkD5aI' })
    expect(parseVodInput('https://www.youtube.com/watch?list=x&v=BJYvQoXXJyU')).toEqual({ platform: 'youtube', id: 'BJYvQoXXJyU' })
  })
})

describe('mesmo streamer em várias plataformas', () => {
  it('junta pelo nome e mantém a ordem em que foram adicionados', () => {
    const ch = [
      { id: 7, displayName: 'Gaules', login: 'gaules' },
      { id: 2, displayName: 'alanzoka', login: 'alanzoka' },
      { id: 5, displayName: 'Cazé TV', login: 'cazetv' },
      { id: 3, displayName: 'Gaules', login: 'gaules' },
      { id: 9, displayName: 'CazéTV', login: 'cazetv' }
    ]
    expect(groupChannels(ch).map((g) => g.map((c) => c.id))).toEqual([[2], [3, 7], [5, 9]])
  })
  it('diz onde está ao vivo em português', () => {
    expect(wherePlatforms(['twitch', 'kick', 'youtube'], 3)).toBe('em todas')
    expect(wherePlatforms(['twitch'], 3)).toBe('na Twitch')
    expect(wherePlatforms(['twitch', 'youtube'], 3)).toBe('na Twitch e YouTube')
    expect(wherePlatforms(['twitch', 'kick', 'youtube'], 4)).toBe('na Twitch, Kick e YouTube')
  })
})

describe('página do YouTube', () => {
  it('lê o JSON da página contando as chaves (com "};" dentro de texto)', () => {
    const html = `<script>var ytInitialPlayerResponse = {"videoDetails":{"title":"a};var b = {c}","isLive":true}};var outra = 1;</script>`
    expect(extractJson(html, 'ytInitialPlayerResponse')).toEqual({ videoDetails: { title: 'a};var b = {c}', isLive: true } })
    expect(extractJson(`window["ytInitialData"] = {"x":"\\"}"};`, 'ytInitialData')).toEqual({ x: '"}' })
    expect(extractJson('nada aqui', 'ytInitialData')).toBeNull()
  })
  it('quantas pessoas assistindo', () => {
    expect(parseViewers('39.463')).toBe(39463)
    expect(parseViewers('1,2 mil')).toBe(1200)
    expect(parseViewers('39,463 watching now')).toBe(39463)
    expect(parseViewers(null)).toBe(0)
  })
  it('login do dono do vídeo', () => {
    expect(loginFromOwner('http://www.youtube.com/@CazeTV', 'UCZiYbVptd3PVPf4f6eR6UaQ')).toBe('cazetv')
    expect(loginFromOwner(null, 'UCZiYbVptd3PVPf4f6eR6UaQ')).toBe('UCZiYbVptd3PVPf4f6eR6UaQ')
  })
  it('mensagem do chat: texto, emoji e Super Chat', () => {
    const m = chatItem({
      liveChatTextMessageRenderer: {
        id: 'abc',
        timestampUsec: '1794957402874762',
        authorName: { simpleText: '@vinidanjos' },
        message: { runs: [{ text: 'GOL ' }, { emoji: { shortcuts: [':fire:'] } }] }
      }
    })
    expect(m).toEqual({ id: 'abc', usec: 1794957402874762, user: 'vinidanjos', text: 'GOL :fire:', emotes: 1 })
    expect(chatItem({ liveChatPaidMessageRenderer: { id: 'p', timestampUsec: '1', authorName: { simpleText: 'x' }, message: { runs: [{ text: 'valeu' }] } } })?.text).toBe('valeu')
    expect(chatItem({ liveChatViewerEngagementMessageRenderer: { id: 'z' } })).toBeNull()
  })
  it('categorias do YouTube viram modalidade', () => {
    expect(modalityOf('Gaming')).toBe('game')
    expect(modalityOf('Sports')).toBe('sports')
    expect(modalityOf('People & Blogs')).toBe('talk')
    expect(modalityOf('Music')).toBe('creative')
  })
})
