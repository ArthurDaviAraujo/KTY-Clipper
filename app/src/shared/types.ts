/** Tipos compartilhados entre o processo principal, o preload e as telas. */

import type { Modality } from './modality'
import type { PostTexts } from './post'
export type { PostTexts } from './post'
export type { Modality } from './modality'

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

export type Platform = 'twitch' | 'kick' | 'youtube'

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

/** Padrão de clipe e de detecção de uma modalidade (jogo, conversa, IRL, esporte, criativo) */
export interface ModalityPreset {
  layout: ClipLayout
  /** Margem antes e depois do momento (s) */
  padBeforeS: number
  padAfterS: number
  /** Duração mínima e máxima do clipe (s) */
  minDurationS: number
  maxDurationS: number
  /** Multiplicam os pesos do chat e do áudio da Detecção (1 = igual) */
  chatWeight: number
  audioWeight: number
}

/** Uma mensagem da conversa com o assistente */
export interface AssistantMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  /** O que o assistente fez para responder (etiquetas: "Consultou os clipes", "Adicionou o canal…") */
  actions?: { label: string; ok: boolean }[]
  /** Ação que apaga ou para algo, esperando o usuário confirmar */
  confirm?: { id: string; label: string; state: 'pending' | 'done' | 'canceled' | 'failed' }
  /** Erro (sem chave, cota acabou…) */
  error?: boolean
  at: number
}

export interface AssistantState {
  messages: AssistantMessage[]
  /** Pensando ou executando ações */
  busy: boolean
  /** Tem chave do Gemini e modelo escolhido */
  ready: boolean
}

export type ClipStatus = 'queued' | 'rendering' | 'ready' | 'failed'

/** Revisão do clipe: esperando você, aprovado (pronto para postar) ou descartado */
export type ClipReview = 'pending' | 'approved' | 'rejected'
export type CaptionFont = 'Segoe UI Black' | 'Arial Black' | 'Impact' | 'Bahnschrift' | 'Verdana'
export type TitleStyle = 'white' | 'black' | 'yellow'
export type DiscardedDelete ='never' | 'startup' | '1d' | '7d' | '30d'
/** Prazo de cada opção de "apagar descartados" (null = só ao abrir o app, ou nunca) */
export const DISCARDED_AFTER_MS: Record<DiscardedDelete, number | null> = { never: null, startup: null, '1d': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }

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
  review: ClipReview
  /** Nota do momento de origem */
  score: number | null
  /** Categoria dada pela IA, ou o clipe da comunidade que originou */
  tag: string | null
  /** Categoria da live (jogo, Just Chatting…) no instante do lance */
  game: string | null
  /** Modalidade usada (pela categoria ou fixada no canal) */
  modality: Modality | null
  progress: number | null
  error: string | null
  path: string | null
  durationS: number
  width: number | null
  height: number | null
  sizeBytes: number | null
  /** Gerado sozinho depois da detecção */
  auto: boolean
  /** Cópia na pasta "para postar" (null = ainda não exportado) */
  exportedPath: string | null
  /** Quando foi marcado como postado em cada rede (null = não postado) */
  posted: { youtube: number | null; tiktok: number | null }
  /** Textos prontos para postar à mão (com as edições da pessoa por cima) */
  post: PostTexts
  /** Quais textos foram editados à mão (para mostrar "restaurar") */
  postEdited: (keyof PostTexts)[]
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

/** Canal achado pela busca de uma plataforma */
export interface ChannelHit {
  platform: Platform
  login: string
  displayName: string
  avatarUrl: string | null
  followers: number | null
  live: boolean
  /** Bio ou descrição (ajuda a IA a saber quem é) */
  description: string
}

/** Onde um nome existe ("Todos" na hora de adicionar canal) */
export interface ChannelMatch {
  platform: Platform
  login: string
  displayName: string
  avatarUrl: string | null
  live: boolean
  /** Já está na lista de canais */
  already: boolean
  /** Seguidores ou inscritos, quando a plataforma informa */
  followers?: number | null
  /** Por que a IA acha que é este (busca inteligente) */
  why?: string | null
}

/** Resultado da busca de canal: o que bate com o nome e o que a IA entendeu */
export interface ChannelSearch {
  query: string
  matches: ChannelMatch[]
  /** O que a IA entendeu que você quis dizer (null = sem IA ou não precisou) */
  understood: string | null
  /** A IA não pôde ajudar (sem chave, cota, erro) */
  aiNote: string | null
}

export interface ChannelState {
  id: number
  platform: Platform
  login: string
  displayName: string
  avatarUrl: string | null
  /** Vigiar: o app checa se o canal está ao vivo */
  enabled: boolean
  /** Gravar quando estiver ao vivo (e clipar); só vale vigiando */
  record: boolean
  live: LiveInfo | null
  recording: RecordingInfo | null
  lastCheckedAt: number | null
  lastError: string | null
  /** Modalidade fixada para o canal; null = automática pela categoria da live */
  modality: Modality | null
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
    /** Modelo escolhido para cada reserva (Groq, OpenRouter, Mistral, IA local) ao testar a chave */
    backupModels: Partial<Record<'groq' | 'openrouter' | 'mistral' | 'ollama', string>>
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
      /** Fonte da legenda */
      font: CaptionFont
      /** Cor das outras palavras (a falada usa `color`) */
      baseColor: string
      /** Contorno preto em volta das letras */
      outline: 'thin' | 'normal' | 'thick'
      /** Sobe (negativo) ou desce (positivo) a legenda, em % da altura do vídeo */
      offsetPct: number
    }
    /** Título da IA na tela */
    title: {
      enabled: boolean
      lang: Lang
      /** Segundos na tela nos layouts com o jogo dividido (0 = o clipe todo) */
      seconds: number
      /** Caixa do título: branca com letra preta, preta com letra branca, amarela com letra preta */
      style: TitleStyle
    }
    /** Margem antes e depois do momento (s) */
    padBeforeS: number
    padAfterS: number
    /** Duração máxima (s); o corte fica em volta do pico */
    maxDurationS: number
    /** Gerar sozinho os clipes dos momentos fortes */
    auto: { enabled: boolean; minScore: number }
    /** Clipar ao vivo: pedaços de 1 min e procura a cada pedaço, para o clipe sair poucos minutos depois do lance */
    live: { enabled: boolean }
    /** Apagar sozinho os clipes em Descartados: nunca, ao abrir o app, ou depois de 1, 7 ou 30 dias */
    discardedDelete: DiscardedDelete
    /** "Jogo + facecam" num canal sem facecam marcada: a KaTY acha a câmera sozinha olhando quadros da live */
    autoFacecam: boolean
    /** Altura da facecam no layout "Jogo + facecam", em % da tela (0 = automático, pela proporção da câmera) */
    facecamPct: number
    /** Começo e fim do corte automático encaixados na fala (não corta palavra nem frase no meio) */
    snapToSpeech: boolean
    /** Tirar as pausas longas de dentro do corte: desligado, só em conversa, ou em tudo (em jogo só onde o som também está baixo) */
    cutSilences: 'off' | 'talk' | 'all'
  }
  /** Assistente: conversa com a IA que explica e usa o app */
  assistant: { enabled: boolean }
  /** Padrões por modalidade: layout, duração e pesos conforme a categoria da live */
  modalities: {
    enabled: boolean
    presets: Record<Modality, ModalityPreset>
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
    /** Pasta "para postar" (cópias dos aprovados, por dia); vazio = ao lado da pasta de clipes */
    exportDir: string
  }
  publishing: {
    /** Postar sem passar pela fila de aprovação */
    autoPost: boolean
    /** Copiar o clipe para a pasta "para postar" quando for aprovado */
    exportOnApprove: boolean
    /** Onde a pessoa posta: um clipe sai de "Para postar" quando foi postado em todas as marcadas */
    networks: { youtube: boolean; tiktok: boolean }
  }
  notifications: {
    /** Avisos do Windows quando algo termina (VOD importado, momentos, gravação) */
    enabled: boolean
  }
  /** Funcionamento em segundo plano (deste PC, não do perfil) */
  background: {
    /** Não deixar o Windows suspender enquanto grava ou processa */
    keepAwake: boolean
    /** Fechar a janela deixa o app na bandeja (continua gravando) */
    closeToTray: boolean
    /** Abrir junto com o Windows, direto na bandeja */
    openAtLogin: boolean
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
  /** Pasta "para postar" */
  exportDir: string
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

/** Trecho da fala (transcrição) que tem as palavras buscadas */
export interface SpeechHit {
  liveId: number
  channelName: string
  platform: Platform
  liveTitle: string
  startedAt: number
  /** Hora real do trecho (ms) e segundos desde o começo da live */
  tMs: number
  offsetS: number
  snippet: string
  /** A frase buscada aparece inteira, na ordem */
  exact: boolean
  /** Momento que já cobre este instante (e o clipe dele) */
  momentId: number | null
  clipId: number | null
  /** A gravação deste trecho ainda existe (dá para fazer clipe) */
  available: boolean
}

export interface SearchResults {
  query: string
  clipIds: number[]
  moments: MomentRecord[]
  speech: SpeechHit[]
}

/** Busca pela descrição: a IA lê os momentos e escolhe os que combinam */
export interface AiSearchResults {
  query: string
  matches: { moment: MomentRecord; clipId: number | null; why: string }[]
  /** Quantos momentos a IA leu */
  read: number
  error?: string
}

export interface MomentRecord {
  id: number
  liveId: number
  channelName: string
  platform: Platform
  liveTitle: string
  liveKind: LiveKind
  /** Categoria da live (jogo, Just Chatting…) no instante do lance */
  game: string | null
  /** Modalidade usada (pela categoria ou fixada no canal) */
  modality: Modality | null
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
    /** O que prende nos primeiros segundos, pela KaTY */
    hook?: string | null
    /** O raciocínio curto da KaTY (o que aconteceu, gancho, desfecho, teste do estranho) */
    analysis?: string | null
    /** Nota por partes: gancho 30, desfecho 30, emoção 20, compartilhável 20 */
    parts?: { gancho: number; desfecho: number; emocao: number; compartilhavel: number } | null
  } | null
  hasThumb: boolean
  status: string
}

/** Uma reserva da KaTY em Ajustes */
export interface AiBackupStatus {
  id: 'groq' | 'openrouter' | 'mistral' | 'ollama'
  name: string
  needsKey: boolean
  keyUrl: string | null
  note: string
  /** Pronta para usar (chave que abre + modelo, ou IA local ligada e com modelo) */
  ready: boolean
  hasKey: boolean
  model: string | null
}

export interface AiStatus {
  hasKey: boolean
  /** Há uma chave guardada, mas o Windows não consegue abri-la: é preciso colar de novo */
  keyUnreadable?: boolean
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
  /** Banco ainda vazio (sem canais, lives nem clipes): mostra o convite para trazer dados de outra pasta */
  fresh: boolean
}

/** Perfil deste PC: nome, cor, foto e os próprios ajustes */
export interface Profile {
  id: number
  name: string
  color: string
  hasPhoto: boolean
  /** Muda quando a foto é trocada (para a tela recarregar a imagem) */
  photoVersion: number
  createdAt: number
}

export interface ProfilesInfo {
  profiles: Profile[]
  activeId: number
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
  /** Procura um nome na Twitch, na Kick e no YouTube */
  lookupChannel(name: string): Promise<ChannelMatch[]>
  /** Busca com IA: nome com erro, apelido ou descrição → as principais opções nas três plataformas */
  searchChannels(text: string): Promise<ChannelSearch>
  /** Gravar quando estiver ao vivo (ligar também passa a vigiar) */
  setChannelRecord(id: number, record: boolean): Promise<void>
  assistantState(): Promise<AssistantState>
  assistantSend(text: string): Promise<void>
  assistantConfirm(id: string, ok: boolean): Promise<void>
  assistantStop(): Promise<void>
  assistantClear(): Promise<void>
  onAssistant(cb: (s: AssistantState) => void): () => void
  /** O assistente pediu para abrir uma tela */
  onNavigate(cb: (to: { page: string; [k: string]: unknown }) => void): () => void
  /** Fixa a modalidade do canal (null = automática pela categoria) */
  setChannelModality(id: number, modality: Modality | null): Promise<void>
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
  /** Busca por palavra em clipes, momentos e em tudo o que foi falado nas gravações */
  search(query: string): Promise<SearchResults>
  /** Busca pela descrição com a IA (ex.: "quando ele caiu do prédio") */
  searchAi(query: string): Promise<AiSearchResults>
  /** Cria um momento num instante da live (vindo da busca) e devolve o id */
  momentAt(liveId: number, tMs: number, label: string): Promise<number>
  /** Clipe dos últimos ~30 s de uma live sendo gravada (sai quando o pedaço fecha); devolve a hora do lance */
  clipNow(liveId: number): Promise<number>
  getTimeline(liveId: number): Promise<TimelinePoint[]>
  /** Roda os detectores de novo para uma live */
  detectNow(liveId: number): Promise<void>
  /** Abre o pedaço gravado no player do Windows */
  openMoment(momentId: number): Promise<void>
  /** Avisa quando os momentos de uma live mudaram */
  onMoments(cb: (liveId: number) => void): () => void
  aiStatus(): Promise<AiStatus>
  /** Reservas da KaTY (Groq, OpenRouter, Mistral, IA local) */
  aiBackups(): Promise<AiBackupStatus[]>
  /** Salva e testa a chave de uma reserva (vazio = apagar); escolhe o modelo sozinho */
  setBackupKey(id: AiBackupStatus['id'], key: string): Promise<AiBackupStatus[]>
  /** IA local: procura o Ollama e escolhe o modelo */
  checkLocalAi(): Promise<AiBackupStatus[]>
  /** Faz um pedido pequeno só para uma reserva e mostra a resposta e o tempo */
  testBackup(id: AiBackupStatus['id']): Promise<{ ms: number; model: string; answer: string }>
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
  /** A KaTY olha quadros da live e acha a facecam; se achar, já guarda no canal */
  detectFacecam(momentId: number): Promise<{ rect: Rect | null; why: string }>
  renderClip(momentId: number, options: ClipOptions): Promise<ClipRecord>
  listClips(liveId?: number): Promise<ClipRecord[]>
  deleteClip(id: number): Promise<void>
  /** Apaga do disco todos os clipes em Descartados; devolve quantos */
  purgeRejected(): Promise<number>
  /** Aprovar, descartar ou voltar para revisão */
  reviewClip(id: number, review: ClipReview): Promise<void>
  /** Copia para a pasta "para postar" (devolve o caminho da cópia) */
  exportClip(id: number): Promise<string>
  /** Copia todos os aprovados que ainda não foram para a pasta; devolve quantos */
  exportApproved(): Promise<number>
  /** Troca os dados deste app pelos de outra pasta "dados" (pergunta antes; o app reinicia). null = cancelado */
  importData(): Promise<string | null>
  /** Edita um texto de postagem do clipe; vazio ou null volta ao texto gerado */
  setPostText(id: number, field: keyof PostTexts, text: string | null): Promise<void>
  /** Começa a arrastar o arquivo do vídeo (para soltar na página de envio do navegador) */
  startDrag(id: number): void
  /** Marca ou desmarca como postado numa rede */
  markPosted(id: number, platform: 'youtube' | 'tiktok', posted: boolean): Promise<void>
  /** Tira o momento da lista (não vira clipe) */
  dismissMoment(id: number): Promise<void>
  showInFolder(path: string): Promise<void>
  onClips(cb: () => void): () => void
  listProfiles(): Promise<ProfilesInfo>
  /** Cria um perfil (ajustes padrão, mantendo as pastas e programas deste PC) e entra nele */
  createProfile(name: string): Promise<ProfilesInfo>
  switchProfile(id: number): Promise<ProfilesInfo>
  updateProfile(id: number, patch: { name?: string; color?: string }): Promise<ProfilesInfo>
  /** Abre o seletor de imagem e usa como foto do perfil */
  pickProfilePhoto(id: number): Promise<ProfilesInfo>
  deleteProfile(id: number): Promise<ProfilesInfo>
  /** Salva as predefinições do perfil num arquivo (para levar a outro PC) */
  exportProfile(): Promise<string | null>
  /** Cria um perfil a partir de um arquivo exportado */
  importProfile(): Promise<ProfilesInfo | null>
  /** Ajustes trocaram (outro perfil entrou) */
  onSettings(cb: (s: Settings) => void): () => void
  onProfiles(cb: (p: ProfilesInfo) => void): () => void
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}
