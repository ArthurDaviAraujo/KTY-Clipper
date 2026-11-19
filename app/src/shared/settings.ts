import type { CaptionFont, ClipLayout, DeepPartial, DetectorId, ModalityPreset, Settings } from './types'
import type { Modality } from './modality'

/** Fontes da legenda (todas vêm com o Windows) */
export const CAPTION_FONTS: CaptionFont[] = ['Segoe UI Black', 'Arial Black', 'Impact', 'Bahnschrift', 'Verdana']

/**
 * Padrões iniciais por modalidade (ponto de partida, para ajustar com o uso):
 * conversa precisa de contexto (clipes mais longos, mais margem antes) e de rosto em pé (recorte);
 * IRL é a câmera do streamer (recorte) e o som da rua pesa mais; esporte e criativo mostram a tela toda.
 */
export function defaultPresets(): Record<Modality, ModalityPreset> {
  return {
    // Durações pela análise de 300 cortes de 5 canais que viralizam no TikTok (2026-11-18): os 15% mais vistos têm
    // mediana de 56 s (metade entre 39 e 64 s) e vários passam de 1 min quando a história pede
    game: { layout: 'split', padBeforeS: 4, padAfterS: 4, minDurationS: 30, maxDurationS: 110, chatWeight: 1, audioWeight: 1 },
    talk: { layout: 'crop', padBeforeS: 10, padAfterS: 5, minDurationS: 40, maxDurationS: 120, chatWeight: 1.2, audioWeight: 0.8 },
    irl: { layout: 'crop', padBeforeS: 5, padAfterS: 4, minDurationS: 30, maxDurationS: 90, chatWeight: 1, audioWeight: 1.2 },
    sports: { layout: 'blur', padBeforeS: 4, padAfterS: 4, minDurationS: 25, maxDurationS: 60, chatWeight: 1.2, audioWeight: 1 },
    creative: { layout: 'blur', padBeforeS: 5, padAfterS: 5, minDurationS: 30, maxDurationS: 90, chatWeight: 1, audioWeight: 0.8 }
  }
}

/** Padrão da modalidade; null quando os padrões por modalidade estão desligados ou a live não tem categoria. */
export function modalityPreset(s: Settings, m: Modality | null | undefined): ModalityPreset | null {
  return s.modalities.enabled && m ? s.modalities.presets[m] : null
}

export const DETECTORS: { id: DetectorId; label: string; description: string; phase: number }[] = [
  { id: 'chat', label: 'Picos de chat', description: 'Momentos em que o chat fala muito mais que o normal do canal.', phase: 1 },
  { id: 'audio', label: 'Áudio', description: 'Gritos, risadas e volume acima do normal.', phase: 1 },
  { id: 'speech', label: 'Fala (transcrição)', description: 'Transcreve a live com o Whisper para entender o que foi dito.', phase: 1 },
  { id: 'voiceTrigger', label: 'Comando de voz', description: 'Quando o streamer diz "clip that" ou "clipa isso".', phase: 1 },
  { id: 'communityClips', label: 'Clipes da comunidade', description: 'Trechos que os espectadores já clicaram para clipar na Twitch e na Kick.', phase: 1 },
  { id: 'aiText', label: 'IA de texto', description: 'Lê trechos de fala e chat e dá título, nota e motivo.', phase: 1 },
  { id: 'screen', label: 'Tela do jogo', description: 'Reconhece eventos na imagem com um perfil por jogo (morte, gol, explosão, vitória).', phase: 3 },
  { id: 'crossStreamer', label: 'Vários streamers', description: 'O mesmo momento em várias lives ganha prioridade.', phase: 3 }
]

export function defaultSettings(): Settings {
  return {
    language: 'pt',
    dataDir: '',
    detectors: {
      chat: { enabled: true, weight: 0.8 },
      audio: { enabled: true, weight: 0.6 },
      speech: { enabled: true, weight: 0.7 },
      voiceTrigger: { enabled: true, weight: 1 },
      communityClips: { enabled: true, weight: 0.9 },
      aiText: { enabled: true, weight: 0.9 },
      screen: { enabled: false, weight: 0.7 },
      crossStreamer: { enabled: false, weight: 0.8 }
    },
    detection: {
      minScore: 35,
      maxPerHour: 10,
      chatLagS: 12,
      voiceTriggers: ['clipa isso', 'clipa ai', 'clipa essa', 'clipa', 'manda pro clipe', 'vai pro clipe', 'clip that', 'clip it', 'clip this']
    },
    speech: { model: '', language: 'auto', threads: 0 },
    ai: { provider: 'gemini', fallbackToLocal: true, geminiModel: '', backupModels: {} },
    quality: { preset: 'balanced', encoder: '' },
    clips: {
      layout: 'split',
      captions: { enabled: true, words: 3, upper: true, color: '#ffd400', sizePct: 7.5, font: 'Segoe UI Black', baseColor: '#ffffff', outline: 'normal', offsetPct: 0 },
      title: { enabled: true, lang: 'pt', seconds: 4, style: 'white' },
      padBeforeS: 2,
      padAfterS: 2,
      maxDurationS: 60,
      auto: { enabled: true, minScore: 60 },
      live: { enabled: true },
      discardedDelete: 'never',
      autoFacecam: true,
      facecamPct: 0,
      snapToSpeech: true,
      cutSilences: 'talk'
    },
    modalities: { enabled: true, presets: defaultPresets() },
    assistant: { enabled: true },
    performance: { mode: 'max' },
    recorder: { pollSeconds: 60, segmentSeconds: 300, quality: 'best', recordChat: true, offlineGraceSeconds: 180, recordReruns: false },
    storage: { recordingsDir: '', clipsDir: '', maxRecordingsGb: 0, whenFull: 'deleteOldest', warnFreeGb: 50, deleteUnusedSegments: false, exportDir: '' },
    publishing: { autoPost: false, exportOnApprove: true, networks: { youtube: true, tiktok: true } },
    notifications: { enabled: true },
    background: { keepAwake: true, closeToTray: true, openAtLogin: false },
    toolPaths: {}
  }
}

/** Clipar ao vivo: tamanho do pedaço gravado e de quanto em quanto tempo procurar momentos */
export const LIVE_SEGMENT_S = 60
export const recordSegmentSeconds = (s: Settings): number =>
  s.clips.live.enabled ? Math.min(s.recorder.segmentSeconds, LIVE_SEGMENT_S) : s.recorder.segmentSeconds
export const detectEveryMinutes = (s: Settings): number => (s.clips.live.enabled ? 1 : 5)

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Chaves cujo valor é um mapa livre de textos (aceitam chaves que não existem no padrão). */
// Mapas de nome livre (textos): caminhos dos programas e o modelo de cada reserva da KaTY
const FREE_MAPS = new Set(['toolPaths', 'backupModels'])

/**
 * Junta `patch` sobre `base` em profundidade.
 * Chaves desconhecidas e valores de tipo diferente do padrão são ignorados,
 * então um arquivo de ajustes antigo ou corrompido nunca quebra o app.
 */
export function mergeSettings(base: Settings, patch: DeepPartial<Settings> | unknown): Settings {
  return mergeDeep(base as unknown as Record<string, unknown>, patch) as unknown as Settings
}

function mergeDeep(base: Record<string, unknown>, patch: unknown): Record<string, unknown> {
  const out = structuredClone(base)
  if (!isObject(patch)) return out
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in base)) continue
    const cur = base[k]
    if (FREE_MAPS.has(k)) {
      if (isObject(v)) out[k] = { ...(cur as object), ...Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) }
    } else if (isObject(cur)) {
      out[k] = mergeDeep(cur, v)
    } else if (typeof v === typeof cur && v !== null) {
      out[k] = v
    }
  }
  return out
}

/**
 * Ajustes que são do PC, não do perfil: pastas, programas, desempenho, segundo plano, codificador e núcleos do Whisper.
 * Trocar de perfil ou importar predefinições de outro PC nunca muda estes.
 */
export function withMachine(target: Settings, machine: Settings): Settings {
  const out = structuredClone(target)
  out.storage = structuredClone(machine.storage)
  out.toolPaths = { ...machine.toolPaths }
  out.performance = { ...machine.performance }
  out.background = { ...machine.background }
  out.quality.encoder = machine.quality.encoder
  out.speech.threads = machine.speech.threads
  out.dataDir = machine.dataDir
  return out
}

/** Predefinições para levar a outro PC (sem pastas nem caminhos deste PC). */
export function portableSettings(s: Settings): DeepPartial<Settings> {
  const out = structuredClone(s) as DeepPartial<Settings> & Record<string, unknown>
  delete out.storage
  delete out.toolPaths
  delete out.performance
  delete out.background
  delete out.dataDir
  if (out.quality) delete out.quality.encoder
  if (out.speech) delete out.speech.threads
  return out
}

/** Limita valores numéricos a faixas válidas. */
export function sanitizeSettings(s: Settings): Settings {
  const out = structuredClone(s)
  for (const d of Object.values(out.detectors)) d.weight = Math.min(1, Math.max(0, Number.isFinite(d.weight) ? d.weight : 0))
  out.storage.warnFreeGb = Math.max(1, Math.round(out.storage.warnFreeGb) || 50)
  const clamp = (v: number, min: number, max: number, def: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def)
  out.recorder.pollSeconds = clamp(out.recorder.pollSeconds, 20, 900, 60)
  out.recorder.segmentSeconds = clamp(out.recorder.segmentSeconds, 10, 1800, 300)
  out.recorder.offlineGraceSeconds = clamp(out.recorder.offlineGraceSeconds, 0, 1800, 180)
  if (!['best', '2160', '1440', '1080', '720', '480'].includes(out.recorder.quality)) out.recorder.quality = 'best'
  out.detection.minScore = clamp(out.detection.minScore, 1, 99, 35)
  out.detection.maxPerHour = clamp(out.detection.maxPerHour, 1, 60, 10)
  out.detection.chatLagS = clamp(out.detection.chatLagS, 0, 60, 12)
  out.detection.voiceTriggers = Array.isArray(out.detection.voiceTriggers)
    ? [...new Set(out.detection.voiceTriggers.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean))].slice(0, 40)
    : defaultSettings().detection.voiceTriggers
  out.speech.threads = clamp(out.speech.threads, 0, 64, 0)
  if (typeof out.speech.language !== 'string' || !/^(auto|[a-z]{2})$/.test(out.speech.language)) out.speech.language = 'auto'
  out.storage.maxRecordingsGb = Number.isFinite(out.storage.maxRecordingsGb) ? Math.max(0, Math.round(out.storage.maxRecordingsGb)) : 0
  if (!['deleteOldest', 'stopRecording'].includes(out.storage.whenFull)) out.storage.whenFull = 'deleteOldest'
  const c = out.clips
  if (!['split', 'blur', 'crop', 'full'].includes(c.layout)) c.layout = 'split'
  if (!['never', 'startup', '1d', '7d', '30d'].includes(c.discardedDelete)) c.discardedDelete = 'never'
  if (!['off', 'talk', 'all'].includes(c.cutSilences)) c.cutSilences = 'talk'
  // 0 = automático; senão entre 25% e 50% da tela
  c.facecamPct = !c.facecamPct || !Number.isFinite(c.facecamPct) ? 0 : clamp(c.facecamPct, 25, 50, 0)
  if (!['fast', 'balanced', 'max'].includes(out.quality.preset)) out.quality.preset = 'balanced'
  c.captions.words = clamp(c.captions.words, 1, 8, 3)
  c.captions.sizePct = Number.isFinite(c.captions.sizePct) ? Math.min(14, Math.max(3, c.captions.sizePct)) : 7.5
  if (!/^#[0-9a-f]{6}$/i.test(c.captions.color)) c.captions.color = '#ffd400'
  if (!['pt', 'en'].includes(c.title.lang)) c.title.lang = 'pt'
  if (!CAPTION_FONTS.includes(c.captions.font)) c.captions.font = 'Segoe UI Black'
  if (!/^#[0-9a-f]{6}$/i.test(c.captions.baseColor)) c.captions.baseColor = '#ffffff'
  if (!['thin', 'normal', 'thick'].includes(c.captions.outline)) c.captions.outline = 'normal'
  c.captions.offsetPct = clamp(c.captions.offsetPct, -25, 15, 0)
  c.title.seconds = clamp(c.title.seconds, 0, 30, 4)
  if (!['white', 'black', 'yellow'].includes(c.title.style)) c.title.style = 'white'
  c.padBeforeS = clamp(c.padBeforeS, 0, 30, 2)
  c.padAfterS = clamp(c.padAfterS, 0, 30, 2)
  c.maxDurationS = clamp(c.maxDurationS, 10, 600, 60)
  c.auto.minScore = clamp(c.auto.minScore, 1, 100, 60)
  // Postar em pelo menos uma rede
  if (!out.publishing.networks.youtube && !out.publishing.networks.tiktok) out.publishing.networks = { youtube: true, tiktok: true }
  const defs = defaultPresets()
  const layouts: ClipLayout[] = ['split', 'blur', 'crop', 'full']
  const weight = (v: number, def: number) => (Number.isFinite(v) ? Math.round(Math.min(2, Math.max(0, v)) * 10) / 10 : def)
  // Padrões antigos de duração (até 2026-11-17), curtos demais: quem não mexeu passa para os novos
  const OLD: Record<Modality, [number, number][]> = { game: [[20, 45], [30, 75]], talk: [[45, 90]], irl: [[25, 60]], sports: [[20, 45]], creative: [[30, 60]] }
  for (const k of Object.keys(defs) as Modality[]) {
    const p = out.modalities.presets[k]
    const d = defs[k]
    if (OLD[k].some(([a, b]) => p.minDurationS === a && p.maxDurationS === b)) {
      p.minDurationS = d.minDurationS
      p.maxDurationS = d.maxDurationS
      p.padBeforeS = d.padBeforeS
      p.padAfterS = d.padAfterS
    }
    if (!layouts.includes(p.layout)) p.layout = d.layout
    p.padBeforeS = clamp(p.padBeforeS, 0, 60, d.padBeforeS)
    p.padAfterS = clamp(p.padAfterS, 0, 60, d.padAfterS)
    p.maxDurationS = clamp(p.maxDurationS, 10, 600, d.maxDurationS)
    p.minDurationS = Math.min(p.maxDurationS, clamp(p.minDurationS, 5, 600, d.minDurationS))
    p.chatWeight = weight(p.chatWeight, d.chatWeight)
    p.audioWeight = weight(p.audioWeight, d.audioWeight)
  }
  return out
}
