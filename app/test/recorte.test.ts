import { describe, expect, it } from 'vitest'
import { layoutPlan, silenceCuts, snapToSpeech } from '../src/shared/clips'
import { facecamFromAnswer, FACECAM_SCHEMA } from '../src/main/ai/facecam'
import { defaultSettings, sanitizeSettings } from '../src/shared/settings'

// Palavras em ms: "olha" 1000–1400, "isso" 1450–1900 (mesma frase), pausa, "nossa" 5000–5600
const W = [
  { t: 1000, end: 1400 },
  { t: 1450, end: 1900 },
  { t: 5000, end: 5600 },
  { t: 5650, end: 6000 }
]

describe('encaixar o corte na fala', () => {
  it('começo no meio de uma palavra volta para o começo da frase', () => {
    // 1600 cai dentro de "isso", que está grudada em "olha": volta para 1000 (menos 150 ms de respiro)
    expect(snapToSpeech(1600, 9000, W).fromUtc).toBe(850)
  })
  it('fim no meio de uma palavra vai até o fim da frase', () => {
    // 5200 cai dentro de "nossa", e a próxima palavra está grudada: vai até 6000 (mais 250 ms)
    expect(snapToSpeech(0, 5200, W).toUtc).toBe(6250)
  })
  it('corte já na pausa não muda; e nunca anda mais que o limite', () => {
    expect(snapToSpeech(3000, 4000, W)).toEqual({ fromUtc: 3000, toUtc: 4000 })
    const long = [{ t: 0, end: 10000 }]
    expect(snapToSpeech(5000, 20000, long, 2500).fromUtc).toBe(5000)
  })
})

describe('tirar as pausas longas', () => {
  it('corta a pausa entre falas e deixa um respiro de cada lado', () => {
    const keep = silenceCuts(0, 7000, W, { minGapMs: 1000, keepMs: 200 })
    // Pausa de 1900 a 5000: sai de 2100 a 4800
    expect(keep).toEqual([
      { fromUtc: 0, toUtc: 2100 },
      { fromUtc: 4800, toUtc: 7000 }
    ])
  })
  it('em jogo, pausa na fala com som alto (ação na tela) fica', () => {
    const levels = [2, 3, 4].map((t) => ({ t, rmsDb: -10 }))
    expect(silenceCuts(0, 7000, W, { minGapMs: 1000, keepMs: 200, levels, quietDb: -30 })).toEqual([{ fromUtc: 0, toUtc: 7000 }])
    const quiet = [2, 3, 4].map((t) => ({ t, rmsDb: -45 }))
    expect(silenceCuts(0, 7000, W, { minGapMs: 1000, keepMs: 200, levels: quiet, quietDb: -30 })).toHaveLength(2)
  })
})

describe('facecam em cima', () => {
  const cam = { x: 0.75, y: 0.7, w: 0.22, h: 0.26 }
  it('a altura escolhida nos Ajustes manda; 0 = automático', () => {
    const out = { W: 1080, H: 1920 }
    const fixed = layoutPlan('split', { w: 1920, h: 1080 }, out, cam, 0.5, 40)
    expect(fixed.captionY).toBe(768) // 40% de 1920: a câmera em cima, o jogo embaixo
    expect(fixed.graph).toContain('vstack')
    const auto = layoutPlan('split', { w: 1920, h: 1080 }, out, cam, 0.5, 0)
    expect(auto.captionY).toBeGreaterThanOrEqual(1920 * 0.28 - 2)
    expect(auto.captionY).toBeLessThanOrEqual(1920 * 0.42 + 2)
  })
})

describe('o jogo embaixo não repete a facecam', () => {
  it('recorte do jogo que pegaria a câmera foge para o outro lado', () => {
    // Facecam do tonyboy (achada pela KaTY): canto direito; recorte pedido no meio dela (0,88)
    const cam = { x: 0.768, y: 0.413, w: 0.227, h: 0.225 }
    const p = layoutPlan('split', { w: 1920, h: 1080 }, { W: 1080, H: 1920 }, cam, 0.88, 0)
    const m = p.graph.match(/\[g0\]crop=(\d+):(\d+):(\d+):/)!
    const [cw, gx] = [Number(m[1]), Number(m[3])]
    expect(gx + cw).toBeLessThanOrEqual(Math.round(0.768 * 1920))
  })
})

describe('a KaTY acha a facecam', () => {
  it('converte o box_2d do Gemini [ymin, xmin, ymax, xmax] de 0 a 1000', () => {
    const r = facecamFromAnswer({ found: true, box_2d: [700, 750, 960, 970], confidence: 90, reason: 'webcam no canto' })
    expect(r.rect).toEqual({ x: 0.75, y: 0.7, w: 0.22, h: 0.26 })
  })
  it('recusa: não achou, pouca certeza, caixa minúscula ou tela inteira', () => {
    expect(facecamFromAnswer({ found: false, box_2d: [], confidence: 0, reason: 'live IRL' }).rect).toBeNull()
    expect(facecamFromAnswer({ found: true, box_2d: [0, 0, 300, 300], confidence: 30, reason: '' }).rect).toBeNull()
    expect(facecamFromAnswer({ found: true, box_2d: [10, 10, 30, 30], confidence: 90, reason: '' }).rect).toBeNull()
    expect(facecamFromAnswer({ found: true, box_2d: [0, 0, 1000, 1000], confidence: 90, reason: '' }).rect).toBeNull()
  })
  it('pede o motivo antes da caixa (a IA olha antes de responder)', () => {
    expect(FACECAM_SCHEMA.propertyOrdering[0]).toBe('reason')
  })
})

describe('ajustes novos do recorte', () => {
  it('padrões e valores estranhos', () => {
    const d = defaultSettings()
    expect(d.clips).toMatchObject({ autoFacecam: true, facecamPct: 0, snapToSpeech: true, cutSilences: 'talk' })
    const s = defaultSettings()
    s.clips.facecamPct = 90
    ;(s.clips as { cutSilences: string }).cutSilences = 'sempre'
    const out = sanitizeSettings(s)
    expect(out.clips.facecamPct).toBe(50)
    expect(out.clips.cutSilences).toBe('talk')
  })
})

describe('legenda no idioma do streamer', () => {
  it('o idioma que domina os pedaços da live é o do streamer (vozes do jogo em inglês não mandam)', async () => {
    const { decideStreamerLang } = await import('../src/shared/lang')
    // live do tonyboy em 2026-11-18: 7 pedaços em pt, 3 em en (vozes do GTA)
    expect(decideStreamerLang(['pt', 'pt', 'en', 'pt', 'pt', 'en', 'pt', 'pt', 'en', 'pt'], null)).toBe('pt')
    // poucos pedaços ou empate, sem dica: ainda não sabe
    expect(decideStreamerLang(['pt', 'en'], null)).toBeNull()
    expect(decideStreamerLang(['pt', 'en', 'pt', 'en'], null)).toBeNull()
    // streamer que fala inglês
    expect(decideStreamerLang(['en', 'en', 'en', 'pt'], null)).toBe('en')
    // ignora vazios e lixo
    expect(decideStreamerLang([null, 'pt', undefined, 'pt', 'xx-yy', 'pt'], null)).toBe('pt')
  })
  it('a dica da plataforma (ou das lives anteriores) decide mais cedo, mas não contra a fala', async () => {
    const { decideStreamerLang } = await import('../src/shared/lang')
    expect(decideStreamerLang(['pt', 'en'], 'pt')).toBe('pt')
    // Live inteira em inglês de um streamer brasileiro: a fala manda
    expect(decideStreamerLang(['en', 'en', 'en'], 'pt')).toBe('en')
    expect(decideStreamerLang(['en', 'en'], 'pt')).toBeNull()
  })
  it('ordem: escolhido no canal > fixado nas Configurações > decidido na live > automático', async () => {
    const { speechLangFor } = await import('../src/shared/lang')
    expect(speechLangFor({ channelChoice: 'en', global: 'pt', live: 'pt' })).toBe('en')
    expect(speechLangFor({ channelChoice: null, global: 'es', live: 'pt' })).toBe('es')
    expect(speechLangFor({ channelChoice: null, global: 'auto', live: 'pt' })).toBe('pt')
    expect(speechLangFor({ channelChoice: null, global: 'auto', live: null })).toBe('auto')
  })
  it('lê o idioma que a Twitch e a Kick informam', async () => {
    const { langCode } = await import('../src/shared/lang')
    expect(langCode('PT')).toBe('pt') // Twitch
    expect(langCode('pt')).toBe('pt') // Kick lang_iso
    expect(langCode('Portuguese')).toBe('pt') // Kick language
    expect(langCode('pt-BR')).toBe('pt')
    expect(langCode('')).toBeNull()
    expect(langCode('Klingon')).toBeNull()
  })
})
