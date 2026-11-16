import { describe, expect, it } from 'vitest'
import { BUCKET_S, classifyMessage, detectMoments, findPeaks, rollingBaseline, type Bucket } from '../src/main/detector'
import { LevelMeter } from '../src/main/audio'

const T0 = Date.UTC(2026, 10, 16, 20, 0, 0)

/** Live sintética: chat ~2 msgs por bloco e voz em -30 dB, com eventos colocados à mão. */
function live(minutes: number, events: { atS: number; chat?: number; laughs?: number; db?: number }[] = []): Bucket[] {
  const n = (minutes * 60) / BUCKET_S
  const b: Bucket[] = []
  for (let i = 0; i < n; i++) {
    b.push({ t: T0 + i * BUCKET_S * 1000, msgs: 2 + (i % 3 === 0 ? 1 : 0), uniq: 2, laughs: 0, hype: 0, emotes: 0, audioDb: -30 + ((i * 7) % 5) * 0.4 })
  }
  for (const e of events) {
    const i = Math.floor(e.atS / BUCKET_S)
    if (e.chat) for (let k = 0; k < 3; k++) b[i + k].msgs += e.chat
    if (e.laughs) for (let k = 0; k < 3; k++) b[i + k].laughs += e.laughs
    if (e.db != null) b[i].audioDb = e.db
  }
  return b
}

describe('classifyMessage', () => {
  it('recognizes laughs in PT and EN', () => {
    for (const t of ['KKKKKKK', 'kkkkk mano', 'KEKW', 'LUL LUL', 'hahahaha', 'rsrsrs', 'OMEGALUL', '😂😂', 'ахаххахахах', 'хахаха', 'ههههههه', 'ㅋㅋㅋㅋ', 'wwwww'])
      expect(classifyMessage(t).laugh).toBe(true)
    for (const t of ['bom dia', 'kk', 'o mapa é grande']) expect(classifyMessage(t).laugh).toBe(false)
  })
  it('recognizes hype', () => {
    for (const t of ['CLIPA ISSO', 'Pog', 'nossa!!!', 'que absurdo', 'WTF']) expect(classifyMessage(t).hype).toBe(true)
  })
})

describe('rollingBaseline', () => {
  it('local median ignores a short spike', () => {
    const v = Array(100).fill(10)
    v[50] = 1000
    const { med } = rollingBaseline(v, 20, 1)
    expect(med[50]).toBe(10)
  })
})

describe('findPeaks', () => {
  it('keeps the highest within the gap', () => {
    expect(findPeaks([0, 0.5, 0.9, 0.4, 0, 0, 0, 0.7, 0], 0.3, 2)).toEqual([2, 7])
  })
})

describe('detectMoments', () => {
  it('a quiet live has no moments', () => {
    expect(detectMoments(live(60))).toEqual([])
  })

  it('finds a chat explosion and places it before the chat peak', () => {
    const m = detectMoments(live(60, [{ atS: 1800, chat: 40, laughs: 15 }]))
    expect(m).toHaveLength(1)
    // O pico de chat fica em ~1810 s; o momento (lance) vem ~12 s antes
    const peakS = (m[0].peakUtc - T0) / 1000
    expect(peakS).toBeGreaterThanOrEqual(1785)
    expect(peakS).toBeLessThanOrEqual(1805)
    expect(m[0].chat).not.toBeNull()
    expect(m[0].reasons[0]).toMatch(/Chat .*× acima do normal/)
  })

  it('a long loud stretch is not a moment, only a spike is', () => {
    const b = live(60)
    // 2 min seguidos mais altos (o streamer só falando mais alto)
    for (let i = 0; i < 24; i++) b[i].audioDb = -18
    expect(detectMoments(b)).toEqual([])
    // Um grito dentro desse trecho ainda conta
    b[10].audioDb = -4
    expect(detectMoments(b)).toHaveLength(1)
  })

  it('a scream alone becomes a moment; with chat it scores higher', () => {
    const alone = detectMoments(live(60, [{ atS: 900, db: -8 }]))
    expect(alone).toHaveLength(1)
    expect(alone[0].audio?.deltaDb).toBeGreaterThan(15)
    const both = detectMoments(live(60, [{ atS: 900, db: -8, chat: 40 }]))
    expect(both).toHaveLength(1)
    expect(both[0].chat && both[0].audio).toBeTruthy()
    expect(both[0].score).toBeGreaterThan(alone[0].score)
  })

  it('disabled detectors (weight 0) are ignored', () => {
    const m = detectMoments(live(60, [{ atS: 900, db: -8 }]), { chatWeight: 0.8, audioWeight: 0, minScore: 35, maxPerHour: 10, chatLagS: 12 })
    expect(m).toEqual([])
  })

  it('respects the per-hour cap, keeping the best', () => {
    const events = Array.from({ length: 20 }, (_, k) => ({ atS: 120 + k * 170, chat: 20 + k * 3 }))
    const m = detectMoments(live(60, events), { chatWeight: 0.8, audioWeight: 0.6, minScore: 1, maxPerHour: 5, chatLagS: 12 })
    expect(m.length).toBeLessThanOrEqual(5)
  })

  it('normal is relative to the hour: a busy hour does not hide a spike in a calm hour', () => {
    const b = live(120, [{ atS: 1200, chat: 15 }])
    // Segunda hora muito mais movimentada, sem pico
    for (let i = 720; i < b.length; i++) b[i].msgs += 30
    const m = detectMoments(b)
    expect(m.some((x) => (x.peakUtc - T0) / 1000 < 1300)).toBe(true)
  })
})

describe('LevelMeter', () => {
  it('measures one second of a full-scale sine near -3 dB and silence at -90', () => {
    const rate = 8000
    const buf = Buffer.alloc(rate * 2 * 2)
    for (let i = 0; i < rate; i++) buf.writeInt16LE(Math.round(32767 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2)
    const meter = new LevelMeter(rate)
    // Envia em pedaços de tamanho ímpar para testar a amostra partida
    for (let i = 0; i < buf.length; i += 333) meter.push(buf.subarray(i, Math.min(buf.length, i + 333)))
    const [a, b] = meter.end()
    expect(a.rmsDb).toBeGreaterThan(-3.5)
    expect(a.rmsDb).toBeLessThan(-2.5)
    expect(a.peakDb).toBeGreaterThan(-0.1)
    expect(b.rmsDb).toBe(-90)
  })
})
