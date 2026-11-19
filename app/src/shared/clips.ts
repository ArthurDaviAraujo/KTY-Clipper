import type { ClipLayout, QualityPreset, Rect } from './types'

/**
 * Montagem do clipe (sem Electron, para testar): tamanho final, enquadramento por layout,
 * trechos dos pedaços gravados, tempo do clipe e legenda ASS palavra a palavra.
 */

export const LAYOUTS: { id: ClipLayout; label: string; hint: string }[] = [
  { id: 'split', label: 'Facecam + jogo', hint: 'Câmera do streamer em cima e o jogo embaixo. A KaTY acha a facecam sozinha (ou marque uma vez por canal).' },
  { id: 'blur', label: 'Tela inteira', hint: 'O vídeo inteiro no meio, com o próprio vídeo desfocado no fundo e o título em cima.' },
  { id: 'crop', label: 'Recorte do centro', hint: 'Corta uma faixa vertical do meio da tela (perde as laterais).' },
  { id: 'full', label: 'Horizontal', hint: '16:9 como a live, para vídeos normais do YouTube.' }
]

/** Tamanho par (os codificadores exigem), no mínimo 2 */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
/** Posição par, a partir de 0 */
const pos = (n: number) => Math.max(0, Math.floor(n / 2) * 2)
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** Tamanho do vídeo final. Máxima: 1440p (o YouTube usa um codec melhor a partir daí) ou 4K se a fonte for 4K. */
export function clipSize(layout: ClipLayout, preset: QualityPreset, srcH: number): { W: number; H: number } {
  const base = preset === 'fast' ? 720 : preset === 'balanced' ? 1080 : srcH >= 2000 ? 2160 : 1440
  const long = even((base * 16) / 9)
  return layout === 'full' ? { W: long, H: base } : { W: base, H: long }
}

/** Qualidade constante por predefinição (menor = melhor) e teto de quadros por segundo. */
export function clipQuality(preset: QualityPreset): { q: number; maxFps: number } {
  return preset === 'fast' ? { q: 24, maxFps: 30 } : preset === 'balanced' ? { q: 20, maxFps: 60 } : { q: 17, maxFps: 60 }
}

/** Facecam válida: dentro do quadro e com tamanho mínimo. */
export function cleanRect(r: Rect | null | undefined): Rect | null {
  if (!r || ![r.x, r.y, r.w, r.h].every(Number.isFinite)) return null
  const x = clamp(r.x, 0, 0.95)
  const y = clamp(r.y, 0, 0.95)
  const w = clamp(r.w, 0.03, 1 - x)
  const h = clamp(r.h, 0.03, 1 - y)
  return { x, y, w, h }
}

export interface LayoutPlan {
  /** Layout usado de fato (jogo + facecam sem facecam marcada vira tela inteira) */
  layout: ClipLayout
  /** Filtros de [in] até [out] */
  graph: string
  /** Altura do centro da legenda */
  captionY: number
  /** Título: ponto de apoio (an2 = embaixo do texto, an8 = em cima) e se fica o clipe todo */
  title: { y: number; align: 2 | 8; always: boolean }
}

/**
 * Enquadramento do vídeo de origem (src) no tamanho final (W×H).
 * `cropX` (0–1) escolhe de onde sai o recorte na horizontal.
 */
/**
 * Posição do recorte (cropX) que deixa `center` (fração da largura do quadro, ex.: o meio da facecam) no meio do clipe.
 * Conta com fonte 16:9 e saída 9:16, o caso das lives.
 */
export function cropXForCenter(center: number, srcAspect = 16 / 9, outAspect = 9 / 16): number {
  const r = Math.min(1, outAspect / srcAspect)
  if (r >= 1) return 0.5
  return Math.round(Math.min(1, Math.max(0, (center - r / 2) / (1 - r))) * 1000) / 1000
}

export function layoutPlan(
  layout: ClipLayout,
  src: { w: number; h: number },
  out: { W: number; H: number },
  facecam: Rect | null,
  cropX = 0.5,
  /** Altura da facecam em % da tela no "Jogo + facecam" (0 = automático, pela proporção da câmera) */
  camPct = 0
): LayoutPlan {
  const { W, H } = out
  const cam = cleanRect(facecam)
  if (layout === 'split' && !cam) layout = 'blur'
  const px = clamp(cropX, 0, 1)

  if (layout === 'full') {
    const same = Math.abs(src.w / src.h - W / H) < 0.01
    const graph = same
      ? `[in]scale=${W}:${H}:flags=lanczos,setsar=1[out]`
      : `[in]scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1[out]`
    return { layout, graph, captionY: Math.round(H * 0.82), title: { y: Math.round(H * 0.05), align: 8, always: false } }
  }

  if (layout === 'crop') {
    const cw = even(Math.min(src.w, (src.h * W) / H))
    const ch = even(Math.min(src.h, (cw * H) / W))
    const x = Math.min(pos((src.w - cw) * px), src.w - cw)
    const y = pos((src.h - ch) / 2)
    return {
      layout,
      graph: `[in]crop=${cw}:${ch}:${x}:${y},scale=${W}:${H}:flags=lanczos,setsar=1[out]`,
      captionY: Math.round(H * 0.68),
      title: { y: Math.round(H * 0.08), align: 8, always: false }
    }
  }

  if (layout === 'split' && cam) {
    const fx = pos(cam.x * src.w)
    const fy = pos(cam.y * src.h)
    const fw = even(Math.min(cam.w * src.w, src.w - fx))
    const fh = even(Math.min(cam.h * src.h, src.h - fy))
    // A câmera ocupa a altura escolhida nos Ajustes; no automático, a que a proporção dela pede, entre 28% e 42% da tela
    const topH = even(camPct > 0 ? (H * clamp(camPct, 25, 50)) / 100 : clamp(W / (fw / fh), H * 0.28, H * 0.42))
    const gameH = H - topH
    const cw = even(Math.min(src.w, (src.h * W) / gameH))
    const ch = even(Math.min(src.h, (cw * gameH) / W))
    let gx = Math.min(pos((src.w - cw) * px), src.w - cw)
    const gy = pos((src.h - ch) / 2)
    // O jogo embaixo não pode mostrar a facecam de novo: se o recorte encosta nela, ele foge para o outro lado (quando cabe)
    if (gx < fx + fw && gx + cw > fx) {
      const camRight = fx + fw / 2 > src.w / 2
      const alt = camRight ? fx - cw : fx + fw
      if (alt >= 0 && alt + cw <= src.w) gx = pos(alt)
    }
    return {
      layout,
      graph:
        `[in]split=2[c0][g0];` +
        `[c0]crop=${fw}:${fh}:${fx}:${fy},scale=${W}:${topH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${topH},setsar=1[cam];` +
        `[g0]crop=${cw}:${ch}:${gx}:${gy},scale=${W}:${gameH}:flags=lanczos,setsar=1[game];` +
        `[cam][game]vstack=inputs=2[out]`,
      captionY: topH,
      title: { y: Math.round(H * 0.025), align: 8, always: false }
    }
  }

  // Tela inteira: o vídeo no meio e ele mesmo, ampliado, desfocado e um pouco escuro, no fundo (calculado em 1/4 do tamanho)
  const fgH = even(Math.min(H, (W * src.h) / src.w))
  const fgW = even(Math.min(W, (fgH * src.w) / src.h))
  const w4 = even(W / 4)
  const h4 = even(H / 4)
  const r = Math.max(1, Math.min(20, Math.floor(Math.min(w4, h4) / 2) - 1))
  const top = Math.round((H - fgH) / 2)
  return {
    layout: 'blur',
    graph:
      `[in]split=2[b0][f0];` +
      `[b0]scale=${w4}:${h4}:force_original_aspect_ratio=increase,crop=${w4}:${h4},boxblur=lr=${r}:lp=2,eq=brightness=-0.08,scale=${W}:${H}[bg];` +
      `[f0]scale=${fgW}:${fgH}:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[out]`,
    captionY: Math.round(top + fgH + (H - top - fgH) * 0.3),
    title: { y: Math.round(top - H * 0.025), align: 2, always: true }
  }
}

/** Pedaço de um arquivo gravado que entra no clipe. */
export interface Part {
  file: string
  /** Onde começar dentro do arquivo (s) */
  inS: number
  durS: number
  /** Hora real (ms) do primeiro quadro usado */
  startUtc: number
}

/** Quais pedaços gravados cobrem [fromUtc, toUtc] e que trecho de cada um. */
export function planParts(segs: { path: string; startUtc: number; durS: number }[], fromUtc: number, toUtc: number): Part[] {
  const out: Part[] = []
  let cursor = fromUtc
  for (const s of [...segs].sort((a, b) => a.startUtc - b.startUtc)) {
    const end = s.startUtc + s.durS * 1000
    // Pedaços vizinhos podem se sobrepor um pouco: cada instante entra uma vez só
    const a = Math.max(cursor, s.startUtc)
    const b = Math.min(toUtc, end)
    if (b - a < 50) continue
    out.push({ file: s.path, inS: (a - s.startUtc) / 1000, durS: (b - a) / 1000, startUtc: a })
    cursor = b
  }
  return out
}

/** Hora real → segundo dentro do clipe (null se cair num buraco entre pedaços ou fora). */
export function toClipTime(parts: Part[], utc: number): number | null {
  let acc = 0
  for (const p of parts) {
    if (utc >= p.startUtc && utc <= p.startUtc + p.durS * 1000) return acc + (utc - p.startUtc) / 1000
    acc += p.durS
  }
  return null
}

/**
 * Trecho do clipe a partir do momento: margem antes e depois, no máximo `maxS`
 * (corta em volta do pico, deixando mais antes do que depois) e no mínimo `minS`.
 */
export function clipRange(
  m: { startUtc: number; endUtc: number; peakUtc: number },
  o: { padBeforeS: number; padAfterS: number; maxS: number; minS?: number },
  avail?: { fromUtc: number; toUtc: number }
): { fromUtc: number; toUtc: number } {
  const max = Math.max(5, o.maxS) * 1000
  const min = Math.min(max, Math.max(3, o.minS ?? 10) * 1000)
  let a = m.startUtc - o.padBeforeS * 1000
  let b = m.endUtc + o.padAfterS * 1000
  if (b - a > max) {
    a = Math.max(a, m.peakUtc - max * 0.6)
    b = a + max
  }
  if (b - a < min) {
    // Falta duração: cresce mais para trás (o contexto vem antes do lance, como numa história em conversa)
    const grow = min - (b - a)
    a -= grow * 0.65
    b += grow * 0.35
  }
  if (avail) {
    a = Math.max(a, avail.fromUtc)
    b = Math.min(b, avail.toUtc)
    // Se um lado bateu no limite do que foi gravado, completa o mínimo pelo outro lado
    if (b - a < min) {
      b = Math.min(avail.toUtc, b + (min - (b - a)))
      a = Math.max(avail.fromUtc, a - (min - (b - a)))
    }
  }
  return { fromUtc: Math.round(a), toUtc: Math.round(b) }
}

/** Palavra falada em hora real (ms), como vem do Whisper */
export interface SpokenWord {
  t: number
  end: number
}

/**
 * Encaixa o começo e o fim do corte na fala: não começa nem termina no meio de uma palavra
 * e, se a frase continua logo em seguida (pausa curta), vai até o fim dela. Anda no máximo `maxShiftMs` para cada lado.
 */
export function snapToSpeech(fromUtc: number, toUtc: number, words: SpokenWord[], maxShiftMs = 2500): { fromUtc: number; toUtc: number } {
  const ws = [...words].filter((w) => w.end > w.t).sort((a, b) => a.t - b.t)
  const JOIN = 350
  let a = fromUtc
  let b = toUtc
  // Começo: volta para o início da palavra cortada e das palavras grudadas antes dela (mesma frase)
  let i = ws.findIndex((w) => w.end > a)
  if (i >= 0 && ws[i].t < a) {
    let start = ws[i].t
    while (i > 0 && start - ws[i - 1].end <= JOIN && fromUtc - ws[i - 1].t <= maxShiftMs) start = ws[--i].t
    if (fromUtc - start <= maxShiftMs) a = start - 150
  }
  // Fim: vai até o fim da palavra cortada e das grudadas depois dela
  let j = ws.findIndex((w) => w.end >= b)
  if (j >= 0 && ws[j].t < b) {
    let end = ws[j].end
    while (j < ws.length - 1 && ws[j + 1].t - end <= JOIN && ws[j + 1].end - toUtc <= maxShiftMs) end = ws[++j].end
    if (end - toUtc <= maxShiftMs) b = end + 250
  }
  return { fromUtc: Math.round(a), toUtc: Math.round(Math.max(b, a + 1000)) }
}

/**
 * Trechos que ficam depois de tirar os silêncios longos de dentro do corte (as pausas entre falas).
 * Deixa `keepMs` de respiro em cada lado do corte. Com `levels` (volume por segundo), só corta onde
 * o som também está baixo (em jogo, silêncio de fala pode ser ação na tela).
 */
export function silenceCuts(
  fromUtc: number,
  toUtc: number,
  words: SpokenWord[],
  o: { minGapMs?: number; keepMs?: number; levels?: { t: number; rmsDb: number }[]; quietDb?: number; maxCuts?: number } = {}
): { fromUtc: number; toUtc: number }[] {
  const minGap = o.minGapMs ?? 1000
  const keep = o.keepMs ?? 250
  const ws = words.filter((w) => w.end > fromUtc && w.t < toUtc).sort((a, b) => a.t - b.t)
  const quiet = (a: number, b: number) => {
    if (!o.levels || o.quietDb == null) return true
    const inGap = o.levels.filter((l) => l.t * 1000 >= a - 500 && l.t * 1000 <= b)
    return inGap.length > 0 && inGap.every((l) => l.rmsDb < o.quietDb!)
  }
  const cuts: [number, number][] = []
  for (let i = 0; i < ws.length - 1 && cuts.length < (o.maxCuts ?? 30); i++) {
    const a = ws[i].end + keep
    const b = ws[i + 1].t - keep
    if (ws[i + 1].t - ws[i].end >= minGap && b - a >= 300 && quiet(a, b)) cuts.push([a, b])
  }
  const out: { fromUtc: number; toUtc: number }[] = []
  let cur = fromUtc
  for (const [a, b] of cuts) {
    if (a > cur) out.push({ fromUtc: Math.round(cur), toUtc: Math.round(a) })
    cur = b
  }
  if (toUtc > cur) out.push({ fromUtc: Math.round(cur), toUtc: Math.round(toUtc) })
  return out
}

/** Uma palavra falada, com início e fim em segundos do clipe */
export interface Word {
  text: string
  start: number
  end: number
}

/** Junta as palavras em blocos curtos: pausa ou fim de frase começa outro bloco. */
export function groupWords(words: Word[], perGroup: number, maxChars: number): Word[][] {
  const groups: Word[][] = []
  let cur: Word[] = []
  const flush = () => {
    if (cur.length) groups.push(cur)
    cur = []
  }
  for (const w of words) {
    const prev = cur[cur.length - 1]
    if (prev && (w.start - prev.end > 0.6 || /[.!?…]$/.test(prev.text))) flush()
    const len = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length
    if (cur.length >= perGroup || (cur.length && len > maxChars)) flush()
    cur.push(w)
  }
  flush()
  return groups
}

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0')

export function assTime(sec: number): string {
  const cs = Math.round(Math.max(0, sec) * 100)
  return `${Math.floor(cs / 360000)}:${pad((cs / 6000) % 60)}:${pad((cs / 100) % 60)}.${pad(cs % 100)}`
}

/** "#ffd400" → "&H0000D4FF" (o ASS guarda as cores ao contrário: azul, verde, vermelho) */
export const assColor = (hex: string) => {
  const h = /^#?[0-9a-f]{6}$/i.test(hex) ? hex.replace('#', '') : 'ffd400'
  return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase()
}

/** Tira emojis (a legenda não desenha emoji colorido) e o que o ASS entenderia como comando. */
export const cleanText = (s: string) =>
  s
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/\\/g, '/')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\s+/g, ' ')
    .trim()

export interface AssInput {
  W: number
  H: number
  duration: number
  captions: {
    words: Word[]
    perGroup: number
    upper: boolean
    color: string
    sizePct: number
    y: number
    font?: string
    /** Cor das outras palavras (padrão branco) */
    baseColor?: string
    outline?: 'thin' | 'normal' | 'thick'
  } | null
  title: {
    text: string
    y: number
    align: 2 | 8
    always: boolean
    /** Segundos na tela quando não é o clipe todo (padrão 4; 0 = o clipe todo) */
    seconds?: number
    style?: 'white' | 'black' | 'yellow'
  } | null
}

/** Caixa do título: cor da letra e do fundo */
const TITLE_STYLES = { white: ['#101010', '#ffffff'], black: ['#ffffff', '#101010'], yellow: ['#101010', '#ffd400'] } as const
const OUTLINE_SCALE = { thin: 0.6, normal: 1, thick: 1.6 } as const

/**
 * Legenda ASS para queimar no clipe: blocos curtos com a palavra falada em destaque (cor e um pouco maior)
 * e, se pedido, o título numa caixa branca.
 */
export function buildClipAss(o: AssInput): string {
  const short = Math.min(o.W, o.H)
  const capFs = Math.max(16, Math.round((short * (o.captions?.sizePct ?? 7.5)) / 100))
  const titleFs = Math.max(14, Math.round(short * 0.058))
  const outline = Math.max(1, Math.round((capFs / 11) * OUTLINE_SCALE[o.captions?.outline ?? 'normal']))
  const marginH = Math.round(o.W * 0.07)
  const font = (o.captions?.font ?? 'Segoe UI Black').replace(/,/g, '')
  const base = assColor(o.captions?.baseColor ?? '#ffffff')
  const [titleText, titleBox] = TITLE_STYLES[o.title?.style ?? 'white'].map(assColor)
  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${o.W}`,
    `PlayResY: ${o.H}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,${font},${capFs},${base},${base},&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,${outline},${Math.round(outline / 2)},5,${marginH},${marginH},0,1`,
    // Caixa do título (BorderStyle 3: o contorno vira caixa); branca com letra preta por padrão
    `Style: Title,Segoe UI Black,${titleFs},${titleText},${titleText},${titleBox},&H64000000,-1,0,0,0,100,100,0,0,3,${Math.round(titleFs * 0.35)},0,8,${marginH},${marginH},0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]
  const lines: string[] = []
  const cx = Math.round(o.W / 2)
  if (o.title && cleanText(o.title.text)) {
    const secs = o.title.seconds ?? 4
    const end = o.title.always || secs <= 0 ? o.duration : Math.min(o.duration, secs)
    lines.push(`Dialogue: 1,${assTime(0)},${assTime(end)},Title,,0,0,0,,{\\an${o.title.align}\\pos(${cx},${o.title.y})}${cleanText(o.title.text)}`)
  }
  const c = o.captions
  if (c) {
    const hi = assColor(c.color)
    const up = (s: string) => (c.upper ? s.toLocaleUpperCase('pt-BR') : s)
    const words = c.words.map((w) => ({ ...w, text: cleanText(w.text) })).filter((w) => w.text && w.end > 0 && w.start < o.duration)
    for (const g of groupWords(words, Math.max(1, c.perGroup), o.W < o.H ? 22 : 34)) {
      g.forEach((w, i) => {
        // A palavra fica em destaque do início dela até o início da próxima (sem piscar entre elas)
        const from = Math.max(0, i === 0 ? g[0].start : w.start)
        const last = g[g.length - 1]
        const to = Math.min(o.duration, i < g.length - 1 ? g[i + 1].start : Math.min(last.end, last.start + 1.5))
        if (to - from < 0.04) return
        const text = g.map((x, k) => (k === i ? `{\\c${hi}\\fscx110\\fscy110}${up(x.text)}{\\r}` : up(x.text))).join(' ')
        lines.push(`Dialogue: 0,${assTime(from)},${assTime(to)},Cap,,0,0,0,,{\\pos(${cx},${c.y})}${text}`)
      })
    }
  }
  return [...head, ...lines, ''].join('\n')
}

/** Nome de arquivo seguro no Windows: "2026-11-16 Canal - Título (123).mp4" */
export function clipFileName(channel: string, dateMs: number, title: string, id: number): string {
  const d = new Date(dateMs)
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const safe = (s: string) =>
    cleanText(s)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/, '')
      .trim()
  const t = safe(title).slice(0, 70).trim() || 'clipe'
  return `${day} ${safe(channel) || 'canal'} - ${t} (${id}).mp4`
}
