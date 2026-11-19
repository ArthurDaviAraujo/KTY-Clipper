import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildVideoPrompt, pickForVideo, VIDEO_REVIEW_SCHEMA, VIDEO_REVIEW_SYSTEM, type AiVerdict } from '../src/main/ai/review'
import { windowVideo, windowVideoArgs } from '../src/main/ai/video'
import { defaultSettings } from '../src/shared/settings'

const FFMPEG = join(__dirname, '..', '..', 'programas', 'ffmpeg.exe')

describe('a KaTY vê o vídeo', () => {
  it('só os lances mais fortes que ela manteve (ou com sinal humano) ganham a segunda olhada', () => {
    const ids = pickForVideo(
      [
        { id: 1, keep: true, score: 80 },
        { id: 2, keep: false, score: 90 },
        { id: 3, keep: false, score: 50, human: true },
        { id: 4, keep: true, score: 30 },
        { id: 5, keep: true, score: 60 }
      ],
      2
    )
    expect(ids).toEqual([1, 5])
    expect(pickForVideo([{ id: 3, keep: false, score: 50, human: true }], 4)).toEqual([3])
    expect(pickForVideo([{ id: 1, keep: true, score: 80 }], 0)).toEqual([])
  })

  it('a instrução pede o que ela viu, o spoiler e o corte pela tela; a resposta começa pelo que viu', () => {
    expect(VIDEO_REVIEW_SYSTEM).toContain('AGORA VOCÊ VÊ O VÍDEO')
    expect(VIDEO_REVIEW_SYSTEM).toContain('spoiler=true')
    expect(VIDEO_REVIEW_SCHEMA.required).toEqual(expect.arrayContaining(['visto', 'spoiler', 'notas', 'clip_start']))
    expect(VIDEO_REVIEW_SCHEMA.propertyOrdering[1]).toBe('visto')
    const before: AiVerdict = { id: 7, keep: false, score: 30, category: 'outro', title_pt: 'X', title_en: 'X', reason: '', hashtags: [] }
    const p = buildVideoPrompt({ channel: 'xarola_', liveTitle: 'GTA 6' }, { id: 7, durationS: 10, game: 'GTA', reasons: [], speech: '', chat: [] }, before)
    expect(p).toContain('keep=false')
    expect(p).toContain('Agora veja o vídeo')
  })

  it('vídeo leve: 360p, 4 quadros por segundo, som mono', () => {
    const a = windowVideoArgs([{ file: 'a.ts', inS: 10, durS: 30 }], 'out.mp4')
    expect(a.join(' ')).toContain('scale=-2:360,fps=4')
    expect(a.join(' ')).toContain('channel_layouts=mono')
    expect(a).toContain('-crf')
  })

  it('vem ligado, 4 por rodada', () => {
    expect(defaultSettings().ai).toMatchObject({ videoReview: true, videoPerRun: 4 })
  })

  it.runIf(existsSync(FFMPEG))('recorta de verdade um trecho que atravessa dois pedaços', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clipador-ve-'))
    try {
      const a = join(dir, 'a.ts')
      const b = join(dir, 'b.ts')
      for (const f of [a, b])
        execFileSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '10', '-c:v', 'libx264', '-c:a', 'aac', f])
      const segs = [
        { path: a, startUtc: 0, durS: 10 },
        { path: b, startUtc: 10_000, durS: 10 }
      ]
      const v = await windowVideo(FFMPEG, segs, 6000, 14_000)
      expect(v).not.toBeNull()
      const bytes = Buffer.from(v!, 'base64').length
      expect(bytes).toBeGreaterThan(1000)
      expect(bytes).toBeLessThan(2_000_000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60000)
})
