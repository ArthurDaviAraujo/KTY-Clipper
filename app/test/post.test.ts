import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { cleanTag, fit, LIMITS, postTexts, tagList } from '../src/shared/post'
import { openDb } from '../src/main/db'
import { Logger } from '../src/main/logs'
import { JobQueue } from '../src/main/jobs'
import { ClipService } from '../src/main/render'
import { defaultSettings, sanitizeSettings } from '../src/shared/settings'

describe('texts to post', () => {
  it('hashtags lose spaces and symbols and do not repeat', () => {
    expect(cleanTag('#Gol Incrível!')).toBe('GolIncrível')
    expect(tagList(['GTA6', '#gta6', 'reação', ''], ['shorts'])).toEqual(['shorts', 'GTA6', 'reação'])
  })
  it('YouTube gets #shorts and credits; TikTok gets the caption with credits', () => {
    const p = postTexts({ title: 'Ele bateu o carro no prédio', hashtags: ['GTA6', 'fail'], channel: 'alanzoka', channelUrl: 'https://www.twitch.tv/alanzoka', game: 'Grand Theft Auto VI' })
    expect(p.youtubeTitle).toBe('Ele bateu o carro no prédio')
    expect(p.youtubeDescription).toContain('Créditos: alanzoka (https://www.twitch.tv/alanzoka)')
    expect(p.youtubeDescription).toContain('Categoria: Grand Theft Auto VI')
    expect(p.youtubeDescription.endsWith('#shorts #GTA6 #fail')).toBe(true)
    expect(p.tiktokCaption).toBe('Ele bateu o carro no prédio\n\nCréditos: alanzoka (https://www.twitch.tv/alanzoka)\n\n#GTA6 #fail')
  })
  it('respects the platform limits', () => {
    const p = postTexts({ title: 'a '.repeat(80), hashtags: [], channel: 'x', channelUrl: null, game: null })
    expect(p.youtubeTitle.length).toBeLessThanOrEqual(LIMITS.youtubeTitle)
    expect(fit('uma frase bem comprida aqui', 15)).toBe('uma frase bem…')
  })
})

describe('folder to post and posted marks', () => {
  const setup = () => {
    const db = openDb(':memory:')
    const tmp = mkdtempSync(join(tmpdir(), 'clipador-post-'))
    const settings = defaultSettings()
    const clips = new ClipService({
      db,
      log: new Logger(db),
      queue: new JobQueue(db, () => ({ gpu: 1, cpu: 1, io: 1, net: 1 })),
      settings: () => settings,
      tools: () => null,
      encoders: () => [],
      clipsRoot: () => join(tmp, 'clipes'),
      exportRoot: () => join(tmp, 'para postar'),
      cacheDir: join(tmp, 'cache'),
      aiReady: () => false
    })
    db.prepare(`INSERT INTO channels(platform, login, display_name, created_at) VALUES ('twitch', 'alanzoka', 'alanzoka', 0)`).run()
    db.prepare(`INSERT INTO lives(channel_id, kind, started_at, platform_stream_id, source_url) VALUES (1, 'vod', 0, 'v1', 'https://www.twitch.tv/videos/1')`).run()
    mkdirSync(join(tmp, 'clipes', 'alanzoka'), { recursive: true })
    const video = join(tmp, 'clipes', 'alanzoka', '2026-11-17 alanzoka - Ele bateu (1).mp4')
    writeFileSync(video, 'video')
    db.prepare(
      `INSERT INTO clips(live_id, channel, title, hashtags, options, layout, status, path, duration_s, created_at) VALUES (1, 'alanzoka', 'Ele bateu', '["GTA6"]', '{"startS":10,"endS":40}', 'crop', 'ready', ?, 30, 0)`
    ).run(video)
    return { db, clips, settings, tmp }
  }

  it('approving copies the clip and a text file to a folder of the day', () => {
    const { clips } = setup()
    clips.setReview(1, 'approved')
    const c = clips.get(1)!
    expect(c.exportedPath).not.toBeNull()
    expect(existsSync(c.exportedPath!)).toBe(true)
    const txt = readFileSync(c.exportedPath!.replace(/\.mp4$/, '.txt'), 'utf8')
    expect(txt).toContain('YOUTUBE SHORTS')
    expect(txt).toContain('#shorts #GTA6')
    expect(txt).toContain('TIKTOK')
    expect(txt).toContain('Origem do trecho: https://www.twitch.tv/videos/1')
  })

  it('a posted clip keeps its copy; an unposted one loses it when it leaves the approved list', () => {
    const { clips } = setup()
    clips.setReview(1, 'approved')
    const copy = clips.get(1)!.exportedPath!
    clips.markPosted(1, 'youtube', true)
    expect(clips.get(1)!.posted.youtube).toBeGreaterThan(0)
    clips.setReview(1, 'pending')
    expect(existsSync(copy)).toBe(true)
    clips.markPosted(1, 'youtube', false)
    clips.setReview(1, 'rejected')
    expect(existsSync(copy)).toBe(false)
    expect(clips.get(1)!.exportedPath).toBeNull()
  })

  it('nothing is copied when the option is off; the button copies all approved later', () => {
    const { clips, settings } = setup()
    settings.publishing.exportOnApprove = false
    clips.setReview(1, 'approved')
    expect(clips.get(1)!.exportedPath).toBeNull()
    expect(clips.exportApproved()).toBe(1)
    expect(clips.get(1)!.exportedPath).not.toBeNull()
  })

  it('edited texts stay on top of the generated ones and update the text file', () => {
    const { clips } = setup()
    clips.setReview(1, 'approved')
    clips.setPostText(1, 'youtubeTitle', '  Meu título  ')
    clips.setPostText(1, 'tiktokCaption', 'Legenda minha #gta6')
    let c = clips.get(1)!
    expect(c.post.youtubeTitle).toBe('Meu título')
    expect(c.post.tiktokCaption).toBe('Legenda minha #gta6')
    expect(c.postEdited.sort()).toEqual(['tiktokCaption', 'youtubeTitle'])
    const txt = readFileSync(c.exportedPath!.replace(/\.mp4$/, '.txt'), 'utf8')
    expect(txt).toContain('Título: Meu título')
    expect(txt).toContain('Legenda minha #gta6')
    // Vazio volta ao texto gerado
    clips.setPostText(1, 'youtubeTitle', '')
    c = clips.get(1)!
    expect(c.post.youtubeTitle).toBe('Ele bateu')
    expect(c.postEdited).toEqual(['tiktokCaption'])
    // O título do YouTube respeita o limite de 100
    clips.setPostText(1, 'youtubeTitle', 'x'.repeat(300))
    expect(clips.get(1)!.post.youtubeTitle.length).toBe(100)
  })

  it('the file to upload is the copy in the folder, or the original clip', () => {
    const { clips, settings } = setup()
    settings.publishing.exportOnApprove = false
    expect(clips.uploadFile(1)).toMatch(/clipes[\\/]alanzoka[\\/]/)
    clips.setReview(1, 'approved')
    clips.exportClip(1)
    expect(clips.uploadFile(1)).toMatch(/para postar/)
  })

  it('deleting the clip removes the copy too', () => {
    const { clips } = setup()
    clips.setReview(1, 'approved')
    const copy = clips.get(1)!.exportedPath!
    clips.delete(1)
    expect(existsSync(copy)).toBe(false)
  })
})

describe('done posting', () => {
  it('a clip is done when posted on every network the person uses', async () => {
    const { postDone, lastPosted } = await import('../src/shared/post')
    const both = { youtube: true, tiktok: true }
    expect(postDone({ youtube: 5, tiktok: null }, both)).toBe(false)
    expect(postDone({ youtube: 5, tiktok: 7 }, both)).toBe(true)
    // Quem só posta no YouTube: basta o YouTube
    expect(postDone({ youtube: 5, tiktok: null }, { youtube: true, tiktok: false })).toBe(true)
    expect(lastPosted({ youtube: 5, tiktok: 9 })).toBe(9)
  })
  it('at least one network stays on', () => {
    const s = defaultSettings()
    s.publishing.networks = { youtube: false, tiktok: false }
    expect(sanitizeSettings(s).publishing.networks).toEqual({ youtube: true, tiktok: true })
  })
})
