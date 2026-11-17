import type { DeepPartial, DetectorId, Settings } from './types'

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
    ai: { provider: 'gemini', fallbackToLocal: true, geminiModel: '' },
    quality: { preset: 'balanced', encoder: '' },
    clips: {
      layout: 'split',
      captions: { enabled: true, words: 3, upper: true, color: '#ffd400', sizePct: 7.5 },
      title: { enabled: true, lang: 'pt' },
      padBeforeS: 2,
      padAfterS: 2,
      maxDurationS: 60,
      auto: { enabled: true, minScore: 60 }
    },
    performance: { mode: 'max' },
    recorder: { pollSeconds: 60, segmentSeconds: 300, quality: 'best', recordChat: true, offlineGraceSeconds: 180, recordReruns: false },
    storage: { recordingsDir: '', clipsDir: '', maxRecordingsGb: 0, whenFull: 'deleteOldest', warnFreeGb: 50, deleteUnusedSegments: false },
    publishing: { autoPost: false },
    notifications: { enabled: true },
    background: { keepAwake: true, closeToTray: true, openAtLogin: false },
    toolPaths: {}
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Chaves cujo valor é um mapa livre de textos (aceitam chaves que não existem no padrão). */
const FREE_MAPS = new Set(['toolPaths'])

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
  if (!['fast', 'balanced', 'max'].includes(out.quality.preset)) out.quality.preset = 'balanced'
  c.captions.words = clamp(c.captions.words, 1, 8, 3)
  c.captions.sizePct = Number.isFinite(c.captions.sizePct) ? Math.min(14, Math.max(3, c.captions.sizePct)) : 7.5
  if (!/^#[0-9a-f]{6}$/i.test(c.captions.color)) c.captions.color = '#ffd400'
  if (!['pt', 'en'].includes(c.title.lang)) c.title.lang = 'pt'
  c.padBeforeS = clamp(c.padBeforeS, 0, 30, 2)
  c.padAfterS = clamp(c.padAfterS, 0, 30, 2)
  c.maxDurationS = clamp(c.maxDurationS, 10, 600, 60)
  c.auto.minScore = clamp(c.auto.minScore, 1, 100, 60)
  return out
}
