/**
 * Detector de momentos (funções puras, testáveis sem o app).
 *
 * A live vira blocos de 5 s com sinais de chat e de áudio. Para cada sinal, o "normal" é a mediana
 * dos ~20 min em volta do bloco (não da live inteira): assim uma hora calma não esconde seus picos
 * e uma hora agitada não vira um pico só. O chat reage depois do lance, então o pico de chat é
 * empurrado alguns segundos para trás. Quando chat e áudio concordam, a nota sobe.
 */

export const BUCKET_S = 5

export interface Bucket {
  /** Início do bloco (ms, hora real) */
  t: number
  msgs: number
  uniq: number
  laughs: number
  hype: number
  emotes: number
  /** Maior volume RMS do bloco (dBFS); null = sem áudio analisado */
  audioDb: number | null
}

export interface DetectParams {
  chatWeight: number
  audioWeight: number
  /** Peso do comando de voz ("clipa isso"); opcional para manter compatibilidade */
  voiceWeight?: number
  /** Peso dos clipes feitos pela comunidade */
  clipWeight?: number
  /** Nota mínima (0–100) para virar momento */
  minScore: number
  /** No máximo isto por hora de live */
  maxPerHour: number
  /** Quantos segundos o chat costuma reagir depois do lance */
  chatLagS: number
  /**
   * Multiplicadores dos pesos de chat e áudio no instante do lance (padrões por modalidade:
   * uma live pode passar de conversa para jogo). Sem isto, vale 1.
   */
  weightAt?: (t: number) => { chat: number; audio: number }
}

export const DEFAULT_PARAMS: DetectParams = { chatWeight: 0.8, audioWeight: 0.6, minScore: 35, maxPerHour: 10, chatLagS: 12 }

export interface ChatSignal {
  score: number
  ratio: number
  msgs: number
  uniq: number
  laughs: number
}
export interface AudioSignal {
  score: number
  deltaDb: number
  db: number
}

export interface VoiceSignal {
  phrase: string
  /** Hora real em que a frase terminou (ms) */
  t: number
}

export interface ClipSignal {
  startUtc: number
  endUtc: number
  views: number
  title: string
  url: string
}

export interface MomentCandidate {
  startUtc: number
  endUtc: number
  peakUtc: number
  score: number
  chat: ChatSignal | null
  audio: AudioSignal | null
  voice: VoiceSignal | null
  clip: ClipSignal | null
  reasons: string[]
}

/**
 * Nota de um clipe da comunidade: existir já conta, mas pesa mais com visualizações.
 * 0 views = 0,45 · 5 = 0,68 · 10 = 0,76 · 40 = 0,93 · 64+ = 1.
 * (Antes 5 views já davam 0,87: clipes de 5 views com o título padrão da live ficavam fortes demais.)
 */
export function clipStrength(views: number): number {
  return Math.min(1, 0.45 + 0.09 * Math.log2(1 + Math.max(0, views)))
}

// Risadas em PT, EN, ES, russo (ахаха, хаха, ржу), árabe (هههه), coreano (ㅋㅋㅋ) e japonês (wwww).
// \b só entende letras latinas, então os padrões de outros alfabetos ficam fora dele.
const LAUGH = /\b(kekw?|lul|lmf?ao+|lol+|omegalul|icant|xd+|huehue)\b|k{4,}|(?:ha){3,}|(?:he){3,}|(?:rs){2,}|(?:ja){3,}|(?:ах|ха){2,}|ржу|кек|ه{3,}|ㅋ{3,}|w{4,}|😂|🤣|💀/iu
const HYPE = /\b(clip|clipa|clipe|clipem|pog\w*|omg|wtf|nossa|caralho|vish|eita|holy|insane|absurdo|monstro)\b|!{3,}|🔥/i

/** Classifica uma mensagem (texto já com os emotes da Kick convertidos em nomes). */
export function classifyMessage(text: string): { laugh: boolean; hype: boolean } {
  return { laugh: LAUGH.test(text), hype: HYPE.test(text) }
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))

function median(sorted: number[]): number {
  if (!sorted.length) return 0
  const m = sorted.length >> 1
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2
}

/** Mediana e desvio mediano (MAD) numa janela móvel; calculado a cada `stride` blocos para ficar rápido. */
export function rollingBaseline(values: (number | null)[], halfWindow: number, stride = 6): { med: number[]; mad: number[] } {
  const n = values.length
  const med = new Array<number>(n).fill(0)
  const mad = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i += stride) {
    const win: number[] = []
    for (let j = Math.max(0, i - halfWindow); j < Math.min(n, i + halfWindow + 1); j++) {
      const v = values[j]
      if (v != null) win.push(v)
    }
    win.sort((a, b) => a - b)
    const m = median(win)
    const dev = win.map((v) => Math.abs(v - m)).sort((a, b) => a - b)
    const d = median(dev)
    for (let k = i; k < Math.min(n, i + stride); k++) {
      med[k] = m
      mad[k] = d
    }
  }
  return { med, mad }
}

/** Notas de chat e de áudio (0–1) para cada bloco. */
export function scoreBuckets(b: Bucket[]): { chat: ChatSignal[]; audio: (AudioSignal | null)[] } {
  // Chat: soma dos últimos 15 s (o chat vai acumulando depois do lance)
  const raw = b.map((x) => x.msgs + x.laughs + 0.5 * x.hype)
  const s = raw.map((v, i) => v + (i >= 1 ? raw[i - 1] : 0) + (i >= 2 ? raw[i - 2] : 0))
  const half = Math.round((10 * 60) / BUCKET_S) // ±10 min
  const cb = rollingBaseline(s, half)
  const chat = s.map((v, i) => {
    const m = cb.med[i]
    const z = (v - m) / (1.4826 * cb.mad[i] + 1)
    const ratio = (v + 1) / (m + 1)
    const lo = Math.max(0, i - 2)
    const msgs = b.slice(lo, i + 1).reduce((a, x) => a + x.msgs, 0)
    const uniq = b.slice(lo, i + 1).reduce((a, x) => a + x.uniq, 0)
    const laughs = b.slice(lo, i + 1).reduce((a, x) => a + x.laughs, 0)
    // Precisa ser estatisticamente fora do normal E pelo menos 1,5× o normal, com um mínimo de mensagens
    const score = ratio >= 1.5 && msgs >= 4 ? clamp((z - 2) / 6) : 0
    return { score, ratio, msgs, uniq, laughs }
  })

  // Áudio: volume do bloco contra a mediana dos ±10 min E contra o minuto em volta.
  // O segundo teste separa um pico (grito, explosão) de um trecho longo que é só mais alto.
  const a = b.map((x) => x.audioDb)
  const ab = rollingBaseline(a, half)
  const near = rollingBaseline(a, Math.round(60 / BUCKET_S), 1)
  const audio = a.map((db, i) => {
    if (db == null) return null
    const delta = db - ab.med[i]
    const local = db - near.med[i]
    // Silêncio e ruído baixo não contam; 6 dB ≈ o dobro da amplitude
    const score = db > -45 ? clamp((delta - 4) / 10) * clamp((local - 1) / 5) : 0
    return { score, deltaDb: delta, db }
  })
  return { chat, audio }
}

/** Picos locais acima de `min`, sem outro maior a menos de `gap` blocos. */
export function findPeaks(values: number[], min: number, gap: number): number[] {
  const idx = values.map((_, i) => i).filter((i) => values[i] >= min)
  idx.sort((x, y) => values[y] - values[x])
  const taken: number[] = []
  for (const i of idx) if (taken.every((j) => Math.abs(i - j) > gap)) taken.push(i)
  return taken.sort((x, y) => x - y)
}

export function detectMoments(buckets: Bucket[], p: DetectParams = DEFAULT_PARAMS, voice: VoiceSignal[] = [], clips: ClipSignal[] = []): MomentCandidate[] {
  if (!buckets.length) return []
  const { chat, audio } = scoreBuckets(buckets)
  const ms = (s: number) => s * 1000
  const lagBuckets = Math.round(p.chatLagS / BUCKET_S)

  interface Raw {
    anchor: number
    start: number
    end: number
    chat: ChatSignal | null
    audio: AudioSignal | null
    voice: VoiceSignal | null
    clip: ClipSignal | null
  }
  const raws: Raw[] = []
  if (p.chatWeight > 0) {
    for (const i of findPeaks(
      chat.map((c) => c.score),
      0.15,
      Math.round(45 / BUCKET_S)
    )) {
      const t = buckets[Math.max(0, i - lagBuckets)].t
      raws.push({ anchor: t, start: t - ms(25), end: t + ms(15), chat: chat[i], audio: null, voice: null, clip: null })
    }
  }
  if (p.audioWeight > 0) {
    const av = audio.map((x) => x?.score ?? 0)
    for (const i of findPeaks(av, 0.2, Math.round(30 / BUCKET_S))) {
      const t = buckets[i].t
      // Pico de áudio perto de um pico de chat (até 30 s antes ou 10 s depois do lance) vira o mesmo momento
      const pair = raws.find((r) => r.chat && !r.audio && t >= r.anchor - ms(30) && t <= r.anchor + ms(10))
      if (pair) {
        pair.audio = audio[i]
        pair.start = Math.min(pair.start, t - ms(20))
        pair.end = Math.max(pair.end, t + ms(10))
        // O lance é o grito, não a reação do chat
        pair.anchor = t
      } else raws.push({ anchor: t, start: t - ms(20), end: t + ms(10), chat: null, audio: audio[i], voice: null, clip: null })
    }
  }
  // Comando de voz: o streamer pediu o clipe; o lance foi antes do pedido
  if ((p.voiceWeight ?? 0) > 0) {
    for (const v of voice) {
      const pair = raws.find((r) => !r.voice && r.anchor >= v.t - ms(35) && r.anchor <= v.t + ms(5))
      if (pair) {
        pair.voice = v
        pair.start = Math.min(pair.start, v.t - ms(30))
        pair.end = Math.max(pair.end, v.t + ms(3))
      } else raws.push({ anchor: v.t - ms(8), start: v.t - ms(30), end: v.t + ms(3), chat: null, audio: null, voice: v, clip: null })
    }
  }
  // Clipes da comunidade: alguém já achou que valia clipe. O lance fica dentro da janela do clipe.
  if ((p.clipWeight ?? 0) > 0) {
    const first = buckets[0].t
    const last = buckets[buckets.length - 1].t + ms(BUCKET_S)
    for (const c of clips) {
      if (c.endUtc < first || c.startUtc > last) continue
      const pair = raws.find((r) => !r.clip && r.anchor >= c.startUtc - ms(10) && r.anchor <= c.endUtc + ms(10))
      if (pair) {
        pair.clip = c
        pair.start = Math.min(pair.start, c.startUtc)
        pair.end = Math.max(pair.end, c.endUtc)
      } else {
        // Sem outro sinal: o lance costuma estar no fim do clipe (quem clipa reage depois)
        const anchor = c.startUtc + (c.endUtc - c.startUtc) * 0.6
        raws.push({ anchor, start: c.startUtc - ms(3), end: c.endUtc + ms(3), chat: null, audio: null, voice: null, clip: c })
      }
    }
  }

  const first = buckets[0].t
  const last = buckets[buckets.length - 1].t + ms(BUCKET_S)
  let out: MomentCandidate[] = raws.map((r) => {
    const w = p.weightAt?.(r.anchor) ?? { chat: 1, audio: 1 }
    const cs = r.chat ? clamp(p.chatWeight * w.chat * r.chat.score) : 0
    const as = r.audio ? clamp(p.audioWeight * w.audio * r.audio.score) : 0
    // Pedido explícito do streamer vale muito por si só (0,9 × peso)
    const vs = r.voice ? (p.voiceWeight ?? 0) * 0.9 : 0
    const ks = r.clip ? (p.clipWeight ?? 0) * clipStrength(r.clip.views) : 0
    const fused = 1 - (1 - cs) * (1 - as) * (1 - vs) * (1 - ks)
    const reasons: string[] = []
    if (r.clip) reasons.push(`Clipado pela comunidade${r.clip.title ? ` ("${r.clip.title.slice(0, 40)}")` : ''}, ${r.clip.views} visualizações`)
    if (r.voice) reasons.push(`Streamer pediu clipe ("${r.voice.phrase}")`)
    if (r.chat)
      reasons.push(
        `Chat ${r.chat.ratio.toFixed(1)}× acima do normal (${r.chat.msgs} mensagens em 15 s${r.chat.laughs ? `, ${r.chat.laughs} risadas` : ''})`
      )
    if (r.audio) reasons.push(`Áudio ${Math.round(r.audio.deltaDb)} dB acima do normal`)
    return {
      startUtc: Math.max(first, r.start),
      endUtc: Math.min(last, r.end),
      peakUtc: r.anchor,
      score: Math.round(fused * 100),
      chat: r.chat,
      audio: r.audio,
      voice: r.voice,
      clip: r.clip,
      reasons
    }
  })

  out = out.filter((m) => m.score >= p.minScore)
  // Limite por hora: fica com os melhores
  const hours = Math.max(1, (last - first) / 3_600_000)
  const cap = Math.ceil(hours * p.maxPerHour)
  out.sort((a, b) => b.score - a.score)
  out = out.slice(0, cap)
  // Junta momentos que se sobrepõem
  out.sort((a, b) => a.startUtc - b.startUtc)
  const merged: MomentCandidate[] = []
  for (const m of out) {
    const prev = merged[merged.length - 1]
    if (prev && m.startUtc <= prev.endUtc) {
      const best = m.score > prev.score ? m : prev
      merged[merged.length - 1] = {
        ...best,
        startUtc: Math.min(prev.startUtc, m.startUtc),
        endUtc: Math.max(prev.endUtc, m.endUtc),
        chat: prev.chat ?? m.chat,
        audio: prev.audio ?? m.audio,
        voice: prev.voice ?? m.voice,
        clip: prev.clip ?? m.clip,
        reasons: [...new Set([...prev.reasons, ...m.reasons])]
      }
    } else merged.push(m)
  }
  return merged
}

/** Série de "hype" para o gráfico da tela (um ponto a cada `stepS` segundos, 0–1). */
export function hypeSeries(buckets: Bucket[], stepS = 30): { t: number; chat: number; audio: number }[] {
  const { chat, audio } = scoreBuckets(buckets)
  const per = Math.max(1, Math.round(stepS / BUCKET_S))
  const out: { t: number; chat: number; audio: number }[] = []
  for (let i = 0; i < buckets.length; i += per) {
    let c = 0
    let a = 0
    for (let j = i; j < Math.min(buckets.length, i + per); j++) {
      c = Math.max(c, chat[j].score)
      a = Math.max(a, audio[j]?.score ?? 0)
    }
    out.push({ t: buckets[i].t, chat: c, audio: a })
  }
  return out
}
