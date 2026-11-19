import { describe, expect, it } from 'vitest'
import { anchorTerm, likePattern, matchRatio, normText, searchTerms } from '../src/shared/search'
import { defaultSettings, detectEveryMinutes, recordSegmentSeconds } from '../src/shared/settings'
import { openDb } from '../src/main/db'
import { MomentsService } from '../src/main/moments'
import { SearchService } from '../src/main/search'
import type { Logger } from '../src/main/logs'
import type { JobQueue } from '../src/main/jobs'

const log = { info() {}, warn() {}, error() {}, log() {} } as unknown as Logger
const queue = { register() {}, enqueue() {}, runningBy: () => 0 } as unknown as JobQueue

describe('texto da busca', () => {
  it('tira acento, pontuação e palavras vazias', () => {
    expect(normText('Ônibus, CAIU!')).toBe('onibus caiu')
    expect(searchTerms('quando ele caiu do prédio')).toEqual(['caiu', 'predio'])
    // Só palavras vazias: usa o que tiver
    expect(searchTerms('o que')).toEqual(['o', 'que'])
  })
  it('conta quantas palavras aparecem', () => {
    expect(matchRatio('Ele CAIU do Prédio!', ['caiu', 'predio'])).toBe(1)
    expect(matchRatio('caiu da escada', ['caiu', 'predio'])).toBe(0.5)
  })
  it('padrão do banco aceita acento no lugar das vogais', () => {
    expect(likePattern('onibus')).toBe('%_n_b_s%')
    expect(likePattern('50%')).toBe('%50%')
    expect(anchorTerm(['gol', 'predio'])).toBe('predio')
  })
})

describe('clipar ao vivo', () => {
  it('pedaços de 1 min e procura a cada minuto quando ligado', () => {
    const s = defaultSettings()
    expect(s.clips.live.enabled).toBe(true)
    expect(recordSegmentSeconds(s)).toBe(60)
    expect(detectEveryMinutes(s)).toBe(1)
    s.clips.live.enabled = false
    expect(recordSegmentSeconds(s)).toBe(300)
    expect(detectEveryMinutes(s)).toBe(5)
    // Pedaço menor que 1 min configurado à mão continua valendo
    s.clips.live.enabled = true
    s.recorder.segmentSeconds = 30
    expect(recordSegmentSeconds(s)).toBe(30)
  })
})

function setup() {
  const db = openDb(':memory:')
  db.prepare(`INSERT INTO channels(platform, login, display_name, created_at) VALUES ('twitch', 'alanzoka', 'alanzoka', 0)`).run()
  const t0 = 1_700_000_000_000
  db.prepare(`INSERT INTO lives(channel_id, title, started_at, status) VALUES (1, 'GTA RP', ?, 'recorded')`).run(t0)
  db.prepare(`INSERT INTO segments(live_id, seq, path, start_utc, duration_s) VALUES (1, 0, 'x.ts', ?, 600)`).run(t0)
  const said = (atS: number, text: string) =>
    text.split(' ').forEach((w, i) => db.prepare('INSERT INTO speech_words(live_id, t_ms, end_ms, word) VALUES (1, ?, ?, ?)').run(t0 + atS * 1000 + i * 300, t0 + atS * 1000 + i * 300 + 250, ` ${w}`))
  said(30, 'olha o ônibus ali mano')
  said(200, 'eu caí do prédio de novo cara')
  said(400, 'o ônibus passou por cima de mim')
  db.prepare(`INSERT INTO moments(live_id, start_utc, end_utc, peak_utc, score, signals, ai, created_at) VALUES (1, ?, ?, ?, 70, '{}', ?, 0)`).run(
    t0 + 190_000,
    t0 + 220_000,
    t0 + 205_000,
    JSON.stringify({ keep: true, score: 80, category: 'falha', title_pt: 'Queda épica do prédio', title_en: 'Epic fall', reason: 'caiu de muito alto', hashtags: [] })
  )
  const moments = new MomentsService({ db, log, queue, settings: defaultSettings, ffmpeg: () => null, speech: () => null, gemini: () => null })
  const search = new SearchService({ db, log, moments, gemini: () => null })
  return { db, t0, moments, search }
}

describe('busca no app', () => {
  it('acha momentos pela análise da IA e trechos falados sem acento', () => {
    const { search, t0 } = setup()
    const r = search.search('predio')
    expect(r.moments.map((m) => m.ai?.titlePt)).toEqual(['Queda épica do prédio'])
    expect(r.speech).toHaveLength(1)
    expect(r.speech[0].momentId).toBe(1)
    expect(r.speech[0].available).toBe(true)
    const bus = search.search('onibus')
    // Dois trechos longe um do outro, o mais recente primeiro
    expect(bus.speech.map((h) => Math.floor((h.tMs - t0) / 1000))).toEqual([400, 30])
    expect(bus.speech[0].snippet).toContain('ônibus passou')
    // Frase inteira vem antes
    const phrase = search.search('ônibus passou')
    expect(phrase.speech[0].exact).toBe(true)
    expect(search.search('helicóptero').speech).toHaveLength(0)
  })

  it('cria um momento no trecho achado, que a detecção não apaga', () => {
    const { db, t0, moments } = setup()
    const id = moments.createAt(1, t0 + 400_000, '“o ônibus passou”')
    const m = moments.list(undefined, [id])[0]
    expect(m.peakS).toBe(400)
    expect(m.reasons[0]).toContain('Achado na busca')
    // Perto de um momento que já existe: reaproveita
    expect(moments.createAt(1, t0 + 206_000, 'x')).toBe(1)
    // Sem gravação
    expect(() => moments.createAt(1, t0 + 900_000, 'x')).toThrow(/não existe/)
    const manual = db.prepare(`SELECT COUNT(*) n FROM moments WHERE json_extract(signals, '$.manual') IS NOT NULL`).get() as { n: number }
    expect(manual.n).toBe(1)
  })
})
