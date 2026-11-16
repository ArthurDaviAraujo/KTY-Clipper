/** Tipos compartilhados entre o processo principal, o preload e as telas. */

export type Lang = 'pt' | 'en'

export type DetectorId = 'chat' | 'audio' | 'speech' | 'voiceTrigger' | 'communityClips' | 'aiText' | 'screen' | 'crossStreamer'

export interface DetectorSetting {
  enabled: boolean
  /** Peso na fusão, de 0 a 1 */
  weight: number
}

export type AiProvider = 'gemini' | 'local' | 'openai' | 'claude' | 'codex'

export type QualityPreset = 'fast' | 'balanced' | 'max'

export type PerformanceMode = 'max' | 'eco'

/** 'best' = a maior que a live oferecer (4K, 2K…); os números são limites de altura */
export type RecordQuality = 'best' | '2160' | '1440' | '1080' | '720' | '480'

export type Platform = 'twitch' | 'kick'

/** split = jogo + facecam; blur = tela inteira com fundo desfocado; crop = recorte do centro; full = horizontal 16:9 */
export type ClipLayout = 'split' | 'blur' | 'crop' | 'full'

/** Retângulo em frações do quadro (0–1), como a facecam marcada na tela */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Escolhas de um clipe (padrão vem dos Ajustes) */
export interface ClipOptions {
  layout: ClipLayout
  /** Início e fim em segundos desde o começo da live/VOD (como nos momentos) */
  startS: number
  endS: number
  captions: boolean
  /** Título na tela; vazio = sem título */
  title: string
  preset: QualityPreset
  /** De onde sai o recorte na horizontal (0 = esquerda, 0,5 = centro, 1 = direita) */
  cropX: number
}

export type ClipStatus = 'queued' | 'rendering' | 'ready' | 'failed'

export interface ClipRecord {
  id: number
  momentId: number | null
  liveId: number | null
  channelName: string
  title: string
  titleEn: string
  hashtags: string[]
  options: ClipOptions
  /** Layout usado de fato (sem facecam marcada, "jogo + facecam" vira tela inteira) */
  layout: ClipLayout
  status: ClipStatus
  progress: number | null
  error: string | null
  path: string | null
  durationS: number
  width: number | null
  height: number | null
  sizeBytes: number | null
  /** Gerado sozinho depois da detecção */
  auto: boolean
  /** Tarefa da fila que gera o clipe (para mostrar o progresso) */
  jobId: number | null
  createdAt: number
}

/** O que a janela "Gerar clipe" precisa para abrir */
export interface ClipDraft {
  momentId: number
  channelId: number
  channelName: string
  options: ClipOptions
  facecam: Rect | null
  /** Trecho gravado disponível (s desde o começo da live) */
  minS: number
  maxS: number
  titlePt: string
  titleEn: string
  /** Clipe que já existe para este momento */
  clipId: number | null
}

export interface LiveInfo {
  streamId: string
  title: string
  game: string | null
  viewers: number
  startedAt: number
  isRerun: boolean
}

export interface RecordingInfo {
  liveId: number
  dir: string
  startedAt: number
  segments: number
  bytes: number
  chatMessages: number
  engine: 'streamlink' | 'ffmpeg'
  /** Resolução real gravada, lida do primeiro pedaço (ex.: "2560x1440 60fps") */
  resolution: string | null
  /** Reinícios do gravador nesta live (queda de conexão etc.) */
  restarts: number
  lastError: string | null
}

export interface ChannelState {
  id: number
  platform: Platform
  login: string
  displayName: string
  avatarUrl: string | null
  enabled: boolean
  live: LiveInfo | null
  recording: RecordingInfo | null
  lastCheckedAt: number | null
  lastError: string | null
}

export interface Settings {
  language: Lang
  /** Pasta onde ficam banco, gravações e clipes; vazio = padrão do app */
  dataDir: string
  detectors: Record<DetectorId, DetectorSetting>
  detection: {
    /** Nota mínima (0–100) para virar momento: menor = mais momentos */
    minScore: number
    /** No máximo isto por hora de live */
    maxPerHour: number
    /** Quantos segundos o chat costuma reagir depois do lance */
    chatLagS: number
    /** Frases que, ditas pelo streamer, viram momento ("clipa isso", "clip that"…) */
    voiceTriggers: string[]
  }
  speech: {
    /** Arquivo do modelo do Whisper (ggml-*.bin); vazio = o mais preciso encontrado */
    model: string
    /** Idioma da fala: 'auto' detecta sozinho */
    language: string
    /** Núcleos para o Whisper; 0 = automático */
    threads: number
  }
  ai: {
    provider: AiProvider
    /** Usar IA local quando a cota do provedor acabar */
    fallbackToLocal: boolean
    /** Modelo do Gemini escolhido ao testar a chave (vazio = escolher sozinho) */
    geminiModel: string
  }
  quality: {
    preset: QualityPreset
    /** Codificador escolhido; vazio = melhor disponível detectado */
    encoder: string
  }
  clips: {
    /** Layout padrão dos clipes */
    layout: ClipLayout
    captions: {
      enabled: boolean
      /** Palavras por bloco na tela */
      words: number
      upper: boolean
      /** Cor da palavra falada */
      color: string
      /** Tamanho da letra (% do lado menor do vídeo) */
      sizePct: number
    }
    /** Título da IA na tela */
    title: { enabled: boolean; lang: Lang }
    /** Margem antes e depois do momento (s) */
    padBeforeS: number
    padAfterS: number
    /** Duração máxima (s); o corte fica em volta do pico */
    maxDurationS: number
    /** Gerar sozinho os clipes dos momentos fortes */
    auto: { enabled: boolean; minScore: number }
  }
  performance: {
    mode: PerformanceMode
  }
  recorder: {
    /** De quanto em quanto tempo verificar se os canais estão ao vivo */
    pollSeconds: number
    /** Duração de cada pedaço gravado */
    segmentSeconds: number
    quality: RecordQuality
    recordChat: boolean
    /** Quanto esperar antes de considerar a live encerrada (quedas rápidas não cortam a gravação) */
    offlineGraceSeconds: number
    /** Gravar reprises (rerun) */
    recordReruns: boolean
  }
  storage: {
    /** Pasta das gravações; vazio = <dados>/gravacoes */
    recordingsDir: string
    /** Pasta dos clipes prontos; vazio = <dados>/clipes */
    clipsDir: string
    /** Espaço máximo para as gravações (GB); 0 = sem limite */
    maxRecordingsGb: number
    /** O que fazer quando o limite for atingido */
    whenFull: 'deleteOldest' | 'stopRecording'
    /** Aviso quando o espaço livre ficar abaixo disto (GB) */
    warnFreeGb: number
    /** Apagar segmentos processados que não viraram clipe */
    deleteUnusedSegments: boolean
  }
  publishing: {
    /** Postar sem passar pela fila de aprovação */
    autoPost: boolean
  }
  notifications: {
    /** Avisos do Windows quando algo termina (VOD importado, momentos, gravação) */
    enabled: boolean
  }
  /** Caminhos manuais dos programas; vazio = procurar sozinho */
  toolPaths: Partial<Record<ToolId, string>>
}

export type ToolId = 'ffmpeg' | 'ffprobe' | 'ytdlp' | 'streamlink' | 'whisper'

export interface ToolInfo {
  id: ToolId
  label: string
  path: string | null
  version: string | null
  /** Necessário já na fase atual */
  required: boolean
  /** Para que serve, em linguagem simples */
  purpose: string
}

export interface GpuInfo {
  name: string
  vendor: 'amd' | 'nvidia' | 'intel' | 'other'
  driver: string | null
}

export type EncoderFamily = 'amd' | 'nvidia' | 'intel' | 'windows' | 'cpu'

export interface EncoderInfo {
  name: string
  codec: 'h264' | 'hevc' | 'av1'
  family: EncoderFamily
  /** Resultado do teste real com um vídeo de 0,1 s; null = ainda não testado */
  works: boolean | null
  error?: string
}

export interface HardwareInfo {
  cpu: string
  cores: number
  ramGb: number
  gpus: GpuInfo[]
  encoders: EncoderInfo[]
  /** Momento do último teste dos codificadores */
  encodersTestedAt: number | null
}

export interface DiskInfo {
  path: string
  freeGb: number
  totalGb: number
  low: boolean
  /** Espaço ocupado pelas gravações (GB) */
  recordingsGb: number
  /** Limite configurado (GB); 0 = sem limite */
  limitGb: number
  recordingsDir: string
  clipsDir: string
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

/** Classe de recurso, usada para limitar quantas tarefas rodam ao mesmo tempo */
export type JobResource = 'gpu' | 'cpu' | 'io' | 'net'

export interface Job {
  id: number
  type: string
  label: string
  resource: JobResource
  status: JobStatus
  progress: number
  attempts: number
  maxAttempts: number
  payload: unknown
  result: unknown
  error: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
}

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  id: number
  time: number
  level: LogLevel
  source: string
  message: string
}

export type LiveKind = 'live' | 'vod'

/** Status de uma live na biblioteca */
export type LiveStatus = 'recording' | 'interrupted' | 'ended' | 'queued' | 'importing' | 'imported' | 'failed'

/** Uma live gravada ou um VOD importado, como aparece na tela Gravações. */
export interface LiveRecord {
  id: number
  kind: LiveKind
  status: LiveStatus
  platform: Platform
  channelLogin: string
  channelName: string
  avatarUrl: string | null
  title: string
  game: string | null
  startedAt: number
  endedAt: number | null
  /** Duração da live/VOD inteira (s), quando conhecida */
  durationS: number | null
  rangeStartS: number | null
  rangeEndS: number | null
  sourceUrl: string | null
  dir: string | null
  segments: number
  /** Segundos já gravados/baixados */
  recordedS: number
  bytes: number
  chatMessages: number
  chatStatus: string | null
  /** Progresso da importação (0 a 1), se houver tarefa ativa */
  progress: number | null
  error: string | null
}

export interface MomentRecord {
  id: number
  liveId: number
  channelName: string
  platform: Platform
  liveTitle: string
  liveKind: LiveKind
  /** Posição do lance dentro da live/VOD original (s desde o início da live) */
  peakS: number
  startS: number
  endS: number
  /** Nota final (com a IA, quando houver) */
  score: number
  /** Nota só dos detectores */
  detectorScore: number
  reasons: string[]
  chat: { score: number; ratio: number; msgs: number; laughs: number } | null
  audio: { score: number; deltaDb: number } | null
  voice: { phrase: string } | null
  /** Clipe que a comunidade já fez neste trecho */
  clip: { title: string; views: number; url: string } | null
  /** Algumas mensagens do chat logo depois do lance (para a IA e para conferir) */
  samples: string[]
  /** O que o streamer falou no trecho (Whisper) */
  speech: string
  ai: {
    keep: boolean
    score: number
    category: string
    titlePt: string
    titleEn: string
    reason: string
    hashtags: string[]
    model: string | null
  } | null
  hasThumb: boolean
  status: string
}

export interface AiStatus {
  hasKey: boolean
  model: string | null
  available: string[]
}

export interface TimelinePoint {
  /** Segundos desde o início da live */
  s: number
  chat: number
  audio: number
}

export interface AppInfo {
  version: string
  dataDir: string
  dbPath: string
  dev: boolean
}

/** API exposta às telas pelo preload (window.api). */
export interface Api {
  appInfo(): Promise<AppInfo>
  getSettings(): Promise<Settings>
  updateSettings(patch: DeepPartial<Settings>): Promise<Settings>
  resetSettings(): Promise<Settings>
  getTools(refresh?: boolean): Promise<ToolInfo[]>
  getHardware(): Promise<HardwareInfo>
  testEncoders(): Promise<number>
  getDisk(): Promise<DiskInfo>
  listJobs(limit?: number): Promise<Job[]>
  cancelJob(id: number): Promise<void>
  retryJob(id: number): Promise<void>
  clearFinishedJobs(): Promise<void>
  listLogs(limit?: number): Promise<LogEntry[]>
  openPath(path: string): Promise<void>
  /** Abre o seletor de pasta do Windows; null se cancelar */
  pickFolder(title: string, current?: string): Promise<string | null>
  onJob(cb: (job: Job) => void): () => void
  onLog(cb: (entry: LogEntry) => void): () => void
  onHardware(cb: (hw: HardwareInfo) => void): () => void
  listChannels(): Promise<ChannelState[]>
  addChannel(platform: Platform, input: string): Promise<ChannelState>
  removeChannel(id: number): Promise<void>
  setChannelEnabled(id: number, enabled: boolean): Promise<void>
  checkChannelsNow(): Promise<void>
  stopRecording(channelId: number): Promise<void>
  onChannels(cb: (channels: ChannelState[]) => void): () => void
  listLives(limit?: number): Promise<LiveRecord[]>
  /** Importa um VOD por link; início/fim em segundos (opcional) */
  importVod(url: string, startS?: number | null, endS?: number | null): Promise<LiveRecord>
  cancelImport(liveId: number): Promise<void>
  retryImport(liveId: number): Promise<void>
  deleteLive(liveId: number): Promise<void>
  onLives(cb: () => void): () => void
  listMoments(liveId?: number): Promise<MomentRecord[]>
  getTimeline(liveId: number): Promise<TimelinePoint[]>
  /** Roda os detectores de novo para uma live */
  detectNow(liveId: number): Promise<void>
  /** Abre o pedaço gravado no player do Windows */
  openMoment(momentId: number): Promise<void>
  /** Avisa quando os momentos de uma live mudaram */
  onMoments(cb: (liveId: number) => void): () => void
  aiStatus(): Promise<AiStatus>
  /** Salva a chave do Gemini (testa antes); vazio apaga */
  setGeminiKey(key: string): Promise<AiStatus>
  openExternal(url: string): Promise<void>
  /** Modelos do Whisper encontrados (nome do arquivo) */
  speechModels(): Promise<{ name: string; path: string }[]>
  /** Opções iniciais da janela "Gerar clipe" de um momento */
  clipDraft(momentId: number): Promise<ClipDraft>
  /** Um quadro do clipe com o layout escolhido (imagem em data URL) */
  previewClip(momentId: number, options: ClipOptions): Promise<string>
  /** Quadro inteiro do lance (data URL), para marcar a facecam */
  momentFrame(momentId: number): Promise<string>
  /** Guarda a facecam do canal (null apaga) */
  setFacecam(channelId: number, rect: Rect | null): Promise<void>
  renderClip(momentId: number, options: ClipOptions): Promise<ClipRecord>
  listClips(liveId?: number): Promise<ClipRecord[]>
  deleteClip(id: number): Promise<void>
  showInFolder(path: string): Promise<void>
  onClips(cb: () => void): () => void
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}
