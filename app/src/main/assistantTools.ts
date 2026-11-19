import type { AssistantTool } from './assistant'
import type { LiveService } from './live'
import type { VodService } from './vod'
import type { MomentsService } from './moments'
import type { ClipService } from './render'
import type { JobQueue } from './jobs'
import type { Logger } from './logs'
import { MODALITIES, type Modality } from '../shared/modality'
import { parseTimecode, formatTimecode } from '../shared/vod'
import type { ChannelState, ClipLayout, ClipReview, DeepPartial, DiskInfo, DetectorId, Platform, Settings, ToolInfo } from '../shared/types'
import { PLATFORM_NAME } from '../shared/channels'
import type { ChannelSearch } from '../shared/types'

/** O que as funções do assistente usam do app. */
import type { SearchService } from './search'

export interface ToolContext {
  live: LiveService
  vod: VodService
  moments: MomentsService
  clips: ClipService
  queue: JobQueue
  log: Logger
  settings: () => Settings
  updateSettings: (patch: DeepPartial<Settings>) => Settings
  disk: () => DiskInfo
  programs: () => ToolInfo[]
  aiReady: () => boolean
  navigate: (to: { page: string; [k: string]: unknown }) => void
  openPath: (p: string) => void
  /** Busca no que foi falado em todas as gravações */
  search?: SearchService
  /** Busca de canal com IA (nome com erro, apelido ou descrição) */
  channelSearch?: (text: string) => Promise<ChannelSearch>
}

const S = (description: string, extra: object = {}) => ({ type: 'STRING', description, ...extra })
const I = (description: string) => ({ type: 'INTEGER', description })
const N = (description: string) => ({ type: 'NUMBER', description })
const B = (description: string) => ({ type: 'BOOLEAN', description })
const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: 'OBJECT', properties, ...(required.length ? { required } : {}) })

const MODALITY_PT: Record<string, Modality> = { jogo: 'game', conversa: 'talk', irl: 'irl', esporte: 'sports', criativo: 'creative' }
const LAYOUT_PT: Record<string, ClipLayout> = { jogo_facecam: 'split', tela_inteira: 'blur', recorte: 'crop', horizontal: 'full' }
const LAYOUT_LABEL: Record<ClipLayout, string> = { split: 'jogo + facecam', blur: 'tela inteira', crop: 'recorte do centro', full: 'horizontal 16:9' }
const REVIEW_PT: Record<ClipReview, string> = { pending: 'para revisar', approved: 'aprovado', rejected: 'descartado' }
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
const day = (t: number) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Acha um canal pelo nome, login ou id (os vigiados primeiro). */
function findChannel(ctx: ToolContext, q: unknown): ChannelState {
  const s = norm(String(q ?? '').trim().replace(/^@/, ''))
  const all = ctx.live.list()
  const c =
    all.find((x) => String(x.id) === s) ??
    all.find((x) => norm(x.login) === s || norm(x.displayName) === s) ??
    all.find((x) => norm(x.login).includes(s) || norm(x.displayName).includes(s))
  if (!c) throw new Error(`Canal "${q}" não está na lista de canais. Canais: ${all.map((x) => x.displayName).join(', ') || 'nenhum'}.`)
  return c
}

const channelOut = (c: ChannelState) => ({
  id: c.id,
  nome: c.displayName,
  plataforma: c.platform,
  vigiando: c.enabled,
  gravando_quando_ao_vivo: c.record,
  ao_vivo: !!c.live,
  gravando: !!c.recording,
  categoria_agora: c.live?.game ?? null,
  titulo_da_live: c.live?.title ?? null,
  modalidade_fixa: c.modality ? MODALITIES[c.modality].label : 'automática',
  erro: c.lastError
})

/** Ajustes simples que o assistente pode mudar (caminho no objeto de ajustes e o tipo do valor). */
const SETTINGS: Record<string, { path: string; type: 'int' | 'bool' | 'enum'; values?: string[]; label: string }> = {
  nota_minima_momento: { path: 'detection.minScore', type: 'int', label: 'Nota mínima para virar momento (1–99; menor = mais momentos)' },
  momentos_por_hora: { path: 'detection.maxPerHour', type: 'int', label: 'Máximo de momentos por hora de live' },
  clipe_automatico: { path: 'clips.auto.enabled', type: 'bool', label: 'Gerar clipes sozinho' },
  nota_clipe_automatico: { path: 'clips.auto.minScore', type: 'int', label: 'Nota mínima para virar clipe sozinho' },
  clipar_ao_vivo: { path: 'clips.live.enabled', type: 'bool', label: 'Clipar ao vivo (pedaços de 1 min, clipe uns minutos depois do lance)' },
  layout_padrao: { path: 'clips.layout', type: 'enum', values: ['split', 'blur', 'crop', 'full'], label: 'Layout padrão (lives sem categoria)' },
  duracao_maxima_padrao: { path: 'clips.maxDurationS', type: 'int', label: 'Duração máxima padrão do clipe (s)' },
  legenda: { path: 'clips.captions.enabled', type: 'bool', label: 'Legenda palavra a palavra' },
  legenda_maiusculas: { path: 'clips.captions.upper', type: 'bool', label: 'Legenda em maiúsculas' },
  palavras_por_vez: { path: 'clips.captions.words', type: 'int', label: 'Palavras da legenda por vez' },
  fonte_da_legenda: { path: 'clips.captions.font', type: 'enum', values: ['Segoe UI Black', 'Arial Black', 'Impact', 'Bahnschrift', 'Verdana'], label: 'Fonte da legenda' },
  contorno_da_legenda: { path: 'clips.captions.outline', type: 'enum', values: ['thin', 'normal', 'thick'], label: 'Contorno das letras da legenda' },
  altura_da_legenda: { path: 'clips.captions.offsetPct', type: 'int', label: 'Altura da legenda (-25 a 15; negativo sobe)' },
  titulo_na_tela: { path: 'clips.title.enabled', type: 'bool', label: 'Título da IA na tela' },
  tempo_do_titulo: { path: 'clips.title.seconds', type: 'int', label: 'Segundos do título na tela (0 = o clipe todo)' },
  caixa_do_titulo: { path: 'clips.title.style', type: 'enum', values: ['white', 'black', 'yellow'], label: 'Cor da caixa do título' },
  apagar_descartados: { path: 'clips.discardedDelete', type: 'enum', values: ['never', 'startup', '1d', '7d', '30d'], label: 'Apagar sozinho os clipes descartados' },
  idioma_do_titulo: { path: 'clips.title.lang', type: 'enum', values: ['pt', 'en'], label: 'Idioma do título na tela' },
  qualidade_do_clipe: { path: 'quality.preset', type: 'enum', values: ['fast', 'balanced', 'max'], label: 'Qualidade do clipe (rápido, equilibrado, máxima)' },
  qualidade_da_gravacao: { path: 'recorder.quality', type: 'enum', values: ['best', '2160', '1440', '1080', '720', '480'], label: 'Qualidade da gravação' },
  gravar_chat: { path: 'recorder.recordChat', type: 'bool', label: 'Gravar o chat' },
  padroes_por_modalidade: { path: 'modalities.enabled', type: 'bool', label: 'Padrões por modalidade' },
  limite_gravacoes_gb: { path: 'storage.maxRecordingsGb', type: 'int', label: 'Espaço máximo das gravações (GB, 0 = sem limite)' },
  nao_suspender: { path: 'background.keepAwake', type: 'bool', label: 'Não deixar o PC suspender enquanto grava' },
  fechar_para_bandeja: { path: 'background.closeToTray', type: 'bool', label: 'Fechar a janela deixa o app na bandeja' },
  abrir_com_windows: { path: 'background.openAtLogin', type: 'bool', label: 'Abrir junto com o Windows' },
  avisos_do_windows: { path: 'notifications.enabled', type: 'bool', label: 'Avisos do Windows' }
}

const DETECTOR_PT: Record<string, DetectorId> = {
  chat: 'chat',
  audio: 'audio',
  fala: 'speech',
  comando_de_voz: 'voiceTrigger',
  clipes_da_comunidade: 'communityClips',
  ia: 'aiText'
}

function getPath(o: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o)
}
function patchFor(path: string, value: unknown): DeepPartial<Settings> {
  const keys = path.split('.')
  const out: Record<string, unknown> = {}
  let cur = out
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value
    else cur = cur[k] = {} as Record<string, unknown>
  })
  return out as DeepPartial<Settings>
}

/** Páginas que o assistente pode abrir. */
const SCREENS: Record<string, { page: string; [k: string]: unknown }> = {
  inicio: { page: 'home', home: 'overview' },
  atividade: { page: 'home', home: 'activity' },
  primeiros_passos: { page: 'home', home: 'guide' },
  clipes_para_revisar: { page: 'clips', tab: 'review', liveId: 'all' },
  clipes_aprovados: { page: 'clips', tab: 'approved', liveId: 'all' },
  clipes_descartados: { page: 'clips', tab: 'rejected', liveId: 'all' },
  momentos_sem_clipe: { page: 'clips', tab: 'moments', liveId: 'all' },
  para_postar: { page: 'clips', tab: 'topost', liveId: 'all' },
  postados: { page: 'clips', tab: 'posted', liveId: 'all' },
  canais: { page: 'channels', channels: 'all' },
  ao_vivo: { page: 'channels', channels: 'live' },
  lives_e_vods: { page: 'channels', channels: 'library' },
  // Ajustes: o que muda os clipes
  ajustes_corte: { page: 'settings', settings: 'corte' },
  ajustes_visual: { page: 'settings', settings: 'visual' },
  ajustes_deteccao: { page: 'settings', settings: 'deteccao' },
  ajustes_postagem: { page: 'settings', settings: 'postagem' },
  // Configurações (engrenagem): o app em si
  configuracoes_katy_e_ia: { page: 'config', settings: 'ia' },
  configuracoes_gravacao: { page: 'config', settings: 'gravacao' },
  configuracoes_armazenamento: { page: 'config', settings: 'armazenamento' },
  perfil: { page: 'config', settings: 'perfil' },
  sistema: { page: 'config', settings: 'sistema' }
}

export function buildAssistantTools(ctx: ToolContext): AssistantTool[] {
  const clipOut = (c: ReturnType<ClipService['list']>[number]) => ({
    id: c.id,
    titulo: c.title,
    canal: c.channelName,
    nota: c.score,
    categoria: c.game,
    modalidade: c.modality ? MODALITIES[c.modality].label : null,
    tipo: c.tag,
    situacao: REVIEW_PT[c.review],
    estado: c.status,
    duracao_s: Math.round(c.durationS),
    layout: LAYOUT_LABEL[c.layout],
    automatico: c.auto,
    criado: day(c.createdAt),
    na_pasta_para_postar: !!c.exportedPath,
    postado: { youtube: c.posted.youtube ? day(c.posted.youtube) : false, tiktok: c.posted.tiktok ? day(c.posted.tiktok) : false }
  })

  return [
    // ---------- consultar ----------
    {
      name: 'resumo_do_app',
      description: 'Situação geral agora: canais vigiados, ao vivo e gravando; clipes para revisar e aprovados; tarefas rodando; disco; IA; programas e passos de configuração que faltam.',
      label: () => 'Olhou o resumo do app',
      run: () => {
        const ch = ctx.live.list()
        const clips = ctx.clips.list()
        const jobs = ctx.queue.list(100)
        const d = ctx.disk()
        const s = ctx.settings()
        const missing = ctx.programs().filter((t) => t.required && !t.path).map((t) => t.label)
        return {
          canais: { total: ch.length, vigiando: ch.filter((c) => c.enabled).length, com_gravacao_ligada: ch.filter((c) => c.record).length, ao_vivo: ch.filter((c) => c.live).map((c) => c.displayName), gravando: ch.filter((c) => c.recording).map((c) => c.displayName) },
          clipes: { para_revisar: clips.filter((c) => c.review === 'pending' && c.status === 'ready').length, aprovados: clips.filter((c) => c.review === 'approved').length, gerando: clips.filter((c) => c.status === 'queued' || c.status === 'rendering').length },
          tarefas_rodando: jobs.filter((j) => j.status === 'running' || j.status === 'queued').map((j) => `${j.label} (${Math.round(j.progress * 100)}%)`),
          disco: { livre_gb: d.freeGb, gravacoes_gb: d.recordingsGb, limite_gb: d.limitGb || 'sem limite', pasta_gravacoes: d.recordingsDir, pasta_clipes: d.clipsDir },
          ia: ctx.aiReady() ? `Gemini configurado (${s.ai.geminiModel})` : 'IA sem chave: configure em Ajustes > IA e fala',
          programas_faltando: missing,
          clipes_automaticos: s.clips.auto.enabled ? `ligado (nota ≥ ${s.clips.auto.minScore})` : 'desligado',
          clipar_ao_vivo: s.clips.live.enabled ? 'ligado (clipe uns 3–5 min depois do lance)' : 'desligado (10–20 min depois)',
          padroes_por_modalidade: s.modalities.enabled ? 'ligados' : 'desligados'
        }
      }
    },
    {
      name: 'listar_canais',
      description: 'Lista os canais da Twitch e da Kick que o app vigia, com quem está ao vivo, gravando, a categoria agora e a modalidade fixada.',
      label: () => 'Consultou os canais',
      run: () => ctx.live.list().map(channelOut)
    },
    {
      name: 'listar_lives',
      description: 'Lives gravadas e VODs importados (biblioteca), das mais recentes para as mais antigas.',
      parameters: obj({ limite: I('Quantas (padrão 15)'), canal: S('Só deste canal (opcional)') }),
      label: () => 'Consultou as lives e VODs',
      run: (a) => {
        let l = ctx.vod.list(300)
        if (a.canal) l = l.filter((x) => norm(x.channelName).includes(norm(String(a.canal))) || norm(x.channelLogin).includes(norm(String(a.canal))))
        return l.slice(0, Number(a.limite) || 15).map((x) => ({
          live_id: x.id,
          canal: x.channelName,
          tipo: x.kind === 'vod' ? 'VOD' : 'live',
          situacao: x.status,
          titulo: x.title,
          categoria: x.game,
          comecou: day(x.startedAt),
          gravado: formatTimecode(x.recordedS),
          pedacos: x.segments,
          gb: Math.round((x.bytes / 1e9) * 100) / 100,
          trecho: x.rangeStartS != null ? `${formatTimecode(x.rangeStartS)} a ${x.rangeEndS != null ? formatTimecode(x.rangeEndS) : 'fim'}` : null
        }))
      }
    },
    {
      name: 'listar_clipes',
      description: 'Lista os clipes prontos ou gerando. Situação: para_revisar, aprovados, descartados ou todos. Ordem: nota (melhores primeiro) ou recentes.',
      parameters: obj({
        situacao: S('Qual lista', { enum: ['para_revisar', 'aprovados', 'descartados', 'todos'] }),
        canal: S('Só deste canal (opcional)'),
        ordem: S('nota ou recentes', { enum: ['nota', 'recentes'] }),
        limite: I('Quantos (padrão 10)')
      }),
      label: (a) => `Consultou os clipes${a.situacao && a.situacao !== 'todos' ? ` (${String(a.situacao).replace(/_/g, ' ')})` : ''}`,
      run: (a) => {
        const want = { para_revisar: 'pending', aprovados: 'approved', descartados: 'rejected' }[String(a.situacao)] as ClipReview | undefined
        let l = ctx.clips.list().filter((c) => !want || c.review === want)
        if (a.canal) l = l.filter((c) => norm(c.channelName).includes(norm(String(a.canal))))
        if (a.ordem !== 'recentes') l = [...l].sort((x, y) => (y.score ?? 0) - (x.score ?? 0))
        return { total: l.length, clipes: l.slice(0, Number(a.limite) || 10).map(clipOut) }
      }
    },
    {
      name: 'listar_momentos',
      description: 'Momentos encontrados nas lives (com nota, título da IA e por que foram escolhidos). Pode filtrar por live ou canal e pegar só os que ainda não viraram clipe.',
      parameters: obj({ live_id: I('Só desta live (opcional)'), canal: S('Só deste canal (opcional)'), so_sem_clipe: B('Só os que ainda não viraram clipe'), limite: I('Quantos (padrão 10)') }),
      label: () => 'Consultou os momentos',
      run: (a) => {
        let l = ctx.moments.list(a.live_id != null ? Number(a.live_id) : undefined)
        if (a.canal) l = l.filter((m) => norm(m.channelName).includes(norm(String(a.canal))))
        if (a.so_sem_clipe) l = l.filter((m) => m.status === 'new')
        return {
          total: l.length,
          momentos: l.slice(0, Number(a.limite) || 10).map((m) => ({
            momento_id: m.id,
            live_id: m.liveId,
            canal: m.channelName,
            nota: m.score,
            titulo: m.ai?.titlePt ?? null,
            ia_manteve: m.ai ? m.ai.keep : null,
            categoria: m.game,
            modalidade: m.modality ? MODALITIES[m.modality].label : null,
            quando: formatTimecode(m.peakS),
            motivos: m.reasons,
            situacao: m.status === 'new' ? 'sem clipe' : m.status === 'dismissed' ? 'descartado' : 'com clipe'
          }))
        }
      }
    },
    {
      name: 'buscar',
      description:
        'Procura por palavras nos títulos e hashtags dos clipes, no que o streamer falou (transcrição) e no chat dos momentos, e em tudo o que foi falado nas gravações (falas: trechos fora dos momentos). Use para "acha o momento em que ele bateu o carro".',
      parameters: obj({ texto: S('O que procurar') }, ['texto']),
      label: (a) => `Buscou "${String(a.texto).slice(0, 30)}"`,
      run: (a) => {
        const words = norm(String(a.texto))
          .split(/\s+/)
          .filter((w) => w.length > 2)
        const hit = (t: string) => {
          const n = norm(t)
          return words.length ? words.filter((w) => n.includes(w)).length / words.length : 0
        }
        const clips = ctx.clips
          .list()
          .map((c) => ({ c, s: hit([c.title, c.titleEn, ...c.hashtags, c.game ?? ''].join(' ')) }))
          .filter((x) => x.s >= 0.5)
          .sort((x, y) => y.s - x.s)
          .slice(0, 8)
          .map((x) => clipOut(x.c))
        const moments = ctx.moments
          .list()
          .map((m) => ({ m, s: hit([m.ai?.titlePt ?? '', m.speech, ...m.samples].join(' ')) }))
          .filter((x) => x.s >= 0.5)
          .sort((x, y) => y.s - x.s || y.m.score - x.m.score)
          .slice(0, 8)
          .map(({ m }) => ({ momento_id: m.id, live_id: m.liveId, canal: m.channelName, nota: m.score, titulo: m.ai?.titlePt ?? null, quando: formatTimecode(m.peakS), fala: m.speech.slice(0, 200), tem_clipe: m.status !== 'new' }))
        const falas = (ctx.search?.search(String(a.texto)).speech ?? []).slice(0, 8).map((h) => ({
          canal: h.channelName,
          live_id: h.liveId,
          quando: formatTimecode(h.offsetS),
          trecho: h.snippet.slice(0, 200),
          momento_id: h.momentId,
          clipe_id: h.clipId,
          gravacao_existe: h.available
        }))
        return { clipes: clips, momentos: moments, falas }
      }
    },
    {
      name: 'detalhes_do_momento',
      description: 'Explica um momento: sinais (chat, áudio, comando de voz, clipe da comunidade), a análise da IA, o que foi falado e o chat.',
      parameters: obj({ momento_id: I('Id do momento') }, ['momento_id']),
      label: (a) => `Olhou o momento ${a.momento_id}`,
      run: (a) => {
        const m = ctx.moments.list().find((x) => x.id === Number(a.momento_id))
        if (!m) throw new Error('Momento não encontrado.')
        return {
          canal: m.channelName,
          live: m.liveTitle,
          quando: formatTimecode(m.peakS),
          nota_final: m.score,
          nota_dos_detectores: m.detectorScore,
          motivos: m.reasons,
          categoria: m.game,
          modalidade: m.modality ? MODALITIES[m.modality].label : null,
          ia: m.ai ? { manteve: m.ai.keep, nota: m.ai.score, tipo: m.ai.category, titulo: m.ai.titlePt, motivo: m.ai.reason, hashtags: m.ai.hashtags } : 'sem análise da IA',
          fala: m.speech.slice(0, 600),
          chat: m.samples.slice(0, 10)
        }
      }
    },
    {
      name: 'ver_ajustes',
      description: 'Mostra os ajustes atuais (detecção, clipes, padrões por modalidade, gravação, armazenamento, segundo plano) e os nomes que podem ser mudados com mudar_ajuste.',
      label: () => 'Olhou os ajustes',
      run: () => {
        const s = ctx.settings()
        return {
          ajustes: Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, { valor: getPath(s, v.path), o_que_e: v.label, ...(v.values ? { opcoes: v.values } : {}) }])),
          detectores: Object.fromEntries(Object.entries(DETECTOR_PT).map(([k, id]) => [k, { ligado: s.detectors[id].enabled, peso: s.detectors[id].weight }])),
          padroes_por_modalidade: Object.fromEntries(
            (Object.keys(MODALITY_PT) as string[]).map((k) => {
              const p = s.modalities.presets[MODALITY_PT[k]]
              return [k, { layout: LAYOUT_LABEL[p.layout], duracao: `${p.minDurationS} a ${p.maxDurationS} s`, margem: `${p.padBeforeS} s antes, ${p.padAfterS} s depois`, peso_chat: p.chatWeight, peso_audio: p.audioWeight }]
            })
          )
        }
      }
    },
    {
      name: 'atividade',
      description: 'O que está rodando na fila (gravações, importações, detecções, clipes), o que falhou e os avisos recentes do registro.',
      label: () => 'Olhou a atividade',
      run: () => {
        const jobs = ctx.queue.list(60)
        return {
          rodando: jobs.filter((j) => j.status === 'running' || j.status === 'queued').map((j) => ({ tarefa: j.label, progresso: `${Math.round(j.progress * 100)}%`, estado: j.status })),
          falhas_recentes: jobs.filter((j) => j.status === 'failed').slice(0, 8).map((j) => ({ tarefa: j.label, erro: j.error })),
          avisos_recentes: ctx.log
            .list(200)
            .filter((l) => l.level !== 'info')
            .slice(0, 10)
            .map((l) => `${day(l.time)} ${l.source}: ${l.message}`)
        }
      }
    },

    // ---------- fazer ----------
    {
      name: 'adicionar_canal',
      description:
        'Adiciona um canal da Twitch, da Kick ou do YouTube para o app vigiar (avisar quando entrar ao vivo). Canal novo entra só vigiando; para gravar, use gravar_canal. Se não souber a plataforma, use procurar_canal antes.',
      parameters: obj({ plataforma: S('twitch, kick ou youtube', { enum: ['twitch', 'kick', 'youtube'] }), canal: S('Nome, @ ou link do canal') }, ['plataforma', 'canal']),
      label: (a) => `Adicionou o canal ${a.canal} (${PLATFORM_NAME[(['twitch', 'kick', 'youtube'].includes(String(a.plataforma)) ? a.plataforma : 'twitch') as Platform]})`,
      run: async (a) => channelOut(await ctx.live.add((['twitch', 'kick', 'youtube'].includes(String(a.plataforma)) ? a.plataforma : 'twitch') as Platform, String(a.canal)))
    },
    {
      name: 'procurar_canal',
      description:
        'Procura um canal na Twitch, na Kick e no YouTube ao mesmo tempo. Aceita nome exato, nome com erro, apelido ou descrição ("o streamer de CS da tribo"). Devolve as principais opções (a primeira é a mais provável); depois use adicionar_canal com a plataforma e o login escolhidos.',
      parameters: obj({ nome: S('Nome, apelido ou descrição do canal') }, ['nome']),
      label: (a) => `Procurou "${a.nome}" nas plataformas`,
      run: async (a) => {
        const res = ctx.channelSearch ? await ctx.channelSearch(String(a.nome)) : { matches: await ctx.live.lookup(String(a.nome)), understood: null }
        return {
          entendido: res.understood,
          opcoes: res.matches.map((m) => ({ plataforma: m.platform, login: m.login, nome: m.displayName, seguidores: m.followers ?? null, ao_vivo: m.live, ja_na_lista: m.already, porque: m.why ?? null }))
        }
      }
    },
    {
      name: 'vigiar_canal',
      description: 'Liga ou desliga a vigia de um canal. Vigiar = o app checa se está ao vivo e avisa, sem gravar. Desligar a vigia também desliga a gravação.',
      parameters: obj({ canal: S('Nome do canal'), ligado: B('true = vigiar, false = pausar') }, ['canal', 'ligado']),
      label: (a) => `${a.ligado ? 'Ligou' : 'Pausou'} a vigia de ${a.canal}`,
      run: async (a) => {
        const c = findChannel(ctx, a.canal)
        await ctx.live.setEnabled(c.id, !!a.ligado)
        return { canal: c.displayName, vigiando: !!a.ligado }
      }
    },
    {
      name: 'gravar_canal',
      description: 'Liga ou desliga a gravação de um canal: ligado, grava a live (e faz os clipes) sempre que ele estiver ao vivo, começando na hora se já estiver. Ligar a gravação também liga a vigia.',
      parameters: obj({ canal: S('Nome do canal'), ligado: B('true = gravar quando estiver ao vivo, false = só vigiar') }, ['canal', 'ligado']),
      label: (a) => `${a.ligado ? 'Ligou' : 'Desligou'} a gravação de ${a.canal}`,
      run: async (a) => {
        const c = findChannel(ctx, a.canal)
        await ctx.live.setRecord(c.id, !!a.ligado)
        return { canal: c.displayName, gravando_quando_ao_vivo: !!a.ligado, ao_vivo_agora: !!c.live }
      }
    },
    {
      name: 'fixar_modalidade',
      description: 'Fixa a modalidade de um canal (vale para a IA, o layout, a duração e os pesos) ou volta para automática (pela categoria da live).',
      parameters: obj({ canal: S('Nome do canal'), modalidade: S('A modalidade', { enum: ['automatica', 'jogo', 'conversa', 'irl', 'esporte', 'criativo'] }) }, ['canal', 'modalidade']),
      label: (a) => `Modalidade de ${a.canal}: ${a.modalidade}`,
      run: (a) => {
        const c = findChannel(ctx, a.canal)
        const m = MODALITY_PT[String(a.modalidade)] ?? null
        ctx.live.setModality(c.id, m)
        return { canal: c.displayName, modalidade: m ? MODALITIES[m].label : 'automática' }
      }
    },
    {
      name: 'importar_vod',
      description: 'Importa um VOD da Twitch (twitch.tv/videos/…), da Kick (kick.com/canal/videos/…) ou um vídeo/live encerrada do YouTube (youtube.com/watch?v=…), inteiro ou só um trecho, e procura os momentos sozinho.',
      parameters: obj({ link: S('Link do VOD'), inicio: S('Início do trecho, ex. 1:20:00 ou 80m (opcional)'), fim: S('Fim do trecho (opcional)') }, ['link']),
      label: () => 'Importou um VOD',
      run: async (a) => {
        const start = a.inicio ? parseTimecode(String(a.inicio)) : null
        const end = a.fim ? parseTimecode(String(a.fim)) : null
        if (a.inicio && start == null) throw new Error(`Início inválido: ${a.inicio}`)
        if (a.fim && end == null) throw new Error(`Fim inválido: ${a.fim}`)
        const l = await ctx.vod.importVod(String(a.link), start, end)
        return { live_id: l.id, canal: l.channelName, titulo: l.title, situacao: 'na fila para baixar; depois os momentos são procurados sozinhos' }
      }
    },
    {
      name: 'gerar_clipe',
      description: 'Gera o clipe vertical de um momento (com legenda e título), no layout escolhido ou no padrão da modalidade. Gerar de novo substitui o clipe anterior do mesmo momento.',
      parameters: obj({ momento_id: I('Id do momento'), layout: S('Layout (opcional)', { enum: ['jogo_facecam', 'tela_inteira', 'recorte', 'horizontal'] }) }, ['momento_id']),
      label: (a) => `Gerou o clipe do momento ${a.momento_id}`,
      run: (a) => {
        const d = ctx.clips.draft(Number(a.momento_id))
        const layout = LAYOUT_PT[String(a.layout)] ?? d.options.layout
        const c = ctx.clips.request(Number(a.momento_id), { ...d.options, layout })
        return { clipe_id: c.id, titulo: c.title, layout: LAYOUT_LABEL[layout], duracao_s: Math.round(d.options.endS - d.options.startS), situacao: 'na fila para gerar' }
      }
    },
    {
      name: 'revisar_clipes',
      description: 'Aprova, descarta ou volta para revisão um ou mais clipes.',
      parameters: obj(
        { clipe_ids: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'Ids dos clipes' }, decisao: S('O que fazer', { enum: ['aprovar', 'descartar', 'voltar_para_revisao'] }) },
        ['clipe_ids', 'decisao']
      ),
      label: (a) => `${a.decisao === 'aprovar' ? 'Aprovou' : a.decisao === 'descartar' ? 'Descartou' : 'Voltou para revisão'} ${(a.clipe_ids as unknown[])?.length ?? 0} clipe(s)`,
      run: (a) => {
        const review: ClipReview = a.decisao === 'aprovar' ? 'approved' : a.decisao === 'descartar' ? 'rejected' : 'pending'
        const ids = (Array.isArray(a.clipe_ids) ? a.clipe_ids : []).map(Number).filter(Number.isFinite)
        const exists = new Set(ctx.clips.list().map((c) => c.id))
        const done = ids.filter((id) => exists.has(id))
        for (const id of done) ctx.clips.setReview(id, review)
        return { feitos: done, nao_encontrados: ids.filter((id) => !exists.has(id)) }
      }
    },
    {
      name: 'descartar_momento',
      description: 'Tira um momento da lista de momentos sem clipe (não vira clipe e não volta na próxima detecção).',
      parameters: obj({ momento_id: I('Id do momento') }, ['momento_id']),
      label: (a) => `Descartou o momento ${a.momento_id}`,
      run: (a) => {
        ctx.moments.dismiss(Number(a.momento_id))
        return { ok: true }
      }
    },
    {
      name: 'procurar_momentos_de_novo',
      description: 'Roda a detecção de momentos de novo numa live ou VOD (por exemplo, depois de mudar os ajustes).',
      parameters: obj({ live_id: I('Id da live ou VOD') }, ['live_id']),
      label: (a) => `Procurou momentos de novo na live ${a.live_id}`,
      run: (a) => {
        ctx.moments.enqueue(Number(a.live_id), 'pedido da KaTY')
        return { situacao: 'na fila' }
      }
    },
    {
      name: 'mudar_ajuste',
      description: 'Muda um ajuste simples do app. Use ver_ajustes para ver os nomes e os valores atuais.',
      parameters: obj(
        { ajuste: S('Nome do ajuste', { enum: Object.keys(SETTINGS) }), valor: S('Novo valor (número, true/false ou uma das opções)') },
        ['ajuste', 'valor']
      ),
      label: (a) => `Mudou ${String(a.ajuste).replace(/_/g, ' ')} para ${a.valor}`,
      run: (a) => {
        const def = SETTINGS[String(a.ajuste)]
        if (!def) throw new Error(`Ajuste desconhecido: ${a.ajuste}`)
        const raw = String(a.valor).trim().toLowerCase()
        let value: unknown
        if (def.type === 'bool') value = ['true', 'sim', 'ligado', 'ligar', '1', 'on'].includes(raw) ? true : ['false', 'nao', 'não', 'desligado', 'desligar', '0', 'off'].includes(raw) ? false : null
        else if (def.type === 'int') value = Number.isFinite(Number(raw.replace(',', '.'))) ? Math.round(Number(raw.replace(',', '.'))) : null
        else value = def.values!.includes(raw) ? raw : null
        if (value == null) throw new Error(`Valor inválido para ${a.ajuste}: ${a.valor}${def.values ? ` (opções: ${def.values.join(', ')})` : ''}`)
        const s = ctx.updateSettings(patchFor(def.path, value))
        return { ajuste: def.label, valor_agora: getPath(s, def.path) }
      }
    },
    {
      name: 'ligar_detector',
      description: 'Liga ou desliga um detector de momentos e, se quiser, muda o peso dele (0 a 1).',
      parameters: obj(
        { detector: S('Qual detector', { enum: Object.keys(DETECTOR_PT) }), ligado: B('Ligar ou desligar'), peso: N('Peso de 0 a 1 (opcional)') },
        ['detector', 'ligado']
      ),
      label: (a) => `${a.ligado ? 'Ligou' : 'Desligou'} o detector ${String(a.detector).replace(/_/g, ' ')}`,
      run: (a) => {
        const id = DETECTOR_PT[String(a.detector)]
        if (!id) throw new Error(`Detector desconhecido: ${a.detector}`)
        const patch: DeepPartial<Settings> = { detectors: { [id]: { enabled: !!a.ligado, ...(a.peso != null ? { weight: Number(a.peso) } : {}) } } }
        const s = ctx.updateSettings(patch)
        return { detector: a.detector, ligado: s.detectors[id].enabled, peso: s.detectors[id].weight }
      }
    },
    {
      name: 'ajustar_modalidade',
      description: 'Muda o padrão de clipe de uma modalidade (jogo, conversa, irl, esporte, criativo): layout, duração mínima e máxima, margens e pesos do chat e do áudio.',
      parameters: obj(
        {
          modalidade: S('Qual modalidade', { enum: Object.keys(MODALITY_PT) }),
          layout: S('Layout (opcional)', { enum: Object.keys(LAYOUT_PT) }),
          duracao_minima: I('Segundos (opcional)'),
          duracao_maxima: I('Segundos (opcional)'),
          margem_antes: I('Segundos (opcional)'),
          margem_depois: I('Segundos (opcional)'),
          peso_chat: N('Multiplicador 0 a 2 (opcional)'),
          peso_audio: N('Multiplicador 0 a 2 (opcional)')
        },
        ['modalidade']
      ),
      label: (a) => `Ajustou o padrão de ${a.modalidade}`,
      run: (a) => {
        const m = MODALITY_PT[String(a.modalidade)]
        if (!m) throw new Error(`Modalidade desconhecida: ${a.modalidade}`)
        const p: Record<string, unknown> = {}
        if (a.layout) p.layout = LAYOUT_PT[String(a.layout)]
        if (a.duracao_minima != null) p.minDurationS = Number(a.duracao_minima)
        if (a.duracao_maxima != null) p.maxDurationS = Number(a.duracao_maxima)
        if (a.margem_antes != null) p.padBeforeS = Number(a.margem_antes)
        if (a.margem_depois != null) p.padAfterS = Number(a.margem_depois)
        if (a.peso_chat != null) p.chatWeight = Number(a.peso_chat)
        if (a.peso_audio != null) p.audioWeight = Number(a.peso_audio)
        const s = ctx.updateSettings({ modalities: { presets: { [m]: p } } } as DeepPartial<Settings>)
        const now = s.modalities.presets[m]
        return { modalidade: a.modalidade, layout: LAYOUT_LABEL[now.layout], duracao: `${now.minDurationS} a ${now.maxDurationS} s`, margem: `${now.padBeforeS}/${now.padAfterS} s`, pesos: { chat: now.chatWeight, audio: now.audioWeight } }
      }
    },
    {
      name: 'abrir_tela',
      description: 'Abre uma tela do app para o usuário ver (ex.: os clipes para revisar, a página de um canal, os ajustes de clipes).',
      parameters: obj({ tela: S('Qual tela', { enum: [...Object.keys(SCREENS), 'canal', 'clipes_da_live'] }), canal: S('Para tela=canal'), live_id: I('Para tela=clipes_da_live') }, ['tela']),
      label: (a) => `Abriu a tela ${String(a.tela).replace(/_/g, ' ')}`,
      run: (a) => {
        if (a.tela === 'canal') {
          const c = findChannel(ctx, a.canal)
          ctx.navigate({ page: 'channels', channels: c.id })
          return { ok: true }
        }
        if (a.tela === 'clipes_da_live') {
          ctx.navigate({ page: 'clips', tab: 'review', liveId: Number(a.live_id) })
          return { ok: true }
        }
        const to = SCREENS[String(a.tela)]
        if (!to) throw new Error(`Tela desconhecida: ${a.tela}`)
        ctx.navigate(to)
        return { ok: true }
      }
    },
    {
      name: 'abrir_pasta',
      description: 'Abre no Explorador do Windows a pasta dos clipes prontos, a "para postar" (cópias dos aprovados com os textos) ou a das gravações.',
      parameters: obj({ qual: S('Qual pasta', { enum: ['clipes', 'para_postar', 'gravacoes'] }) }, ['qual']),
      label: (a) => `Abriu a pasta ${a.qual === 'para_postar' ? 'para postar' : a.qual === 'clipes' ? 'de clipes' : 'de gravações'}`,
      run: (a) => {
        const d = ctx.disk()
        ctx.openPath(a.qual === 'para_postar' ? d.exportDir : a.qual === 'clipes' ? d.clipsDir : d.recordingsDir)
        return { ok: true }
      }
    },
    {
      name: 'textos_para_postar',
      description: 'Título e descrição do YouTube Shorts e legenda do TikTok de um clipe, prontos para colar, e se já foi postado.',
      parameters: obj({ clipe_id: I('Id do clipe') }, ['clipe_id']),
      label: (a) => `Pegou os textos do clipe ${a.clipe_id}`,
      run: (a) => {
        const c = ctx.clips.get(Number(a.clipe_id))
        if (!c) throw new Error('Clipe não encontrado.')
        return { titulo_youtube: c.post.youtubeTitle, descricao_youtube: c.post.youtubeDescription, legenda_tiktok: c.post.tiktokCaption, ...clipOut(c) }
      }
    },
    {
      name: 'copiar_para_a_pasta',
      description: 'Copia clipes aprovados para a pasta "para postar" (com o .txt de textos). Sem ids, copia todos os aprovados que faltam.',
      parameters: obj({ clipe_ids: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'Ids (opcional)' } }),
      label: (a) => (Array.isArray(a.clipe_ids) && a.clipe_ids.length ? `Copiou ${a.clipe_ids.length} clipe(s) para a pasta para postar` : 'Copiou os aprovados para a pasta para postar'),
      run: (a) => {
        const ids = Array.isArray(a.clipe_ids) ? a.clipe_ids.map(Number).filter(Number.isFinite) : []
        if (!ids.length) return { copiados: ctx.clips.exportApproved(), pasta: ctx.disk().exportDir }
        return { copiados: ids.map((id) => ctx.clips.exportClip(id)).length, pasta: ctx.disk().exportDir }
      }
    },
    {
      name: 'marcar_postado',
      description: 'Marca (ou desmarca) clipes como postados no YouTube ou no TikTok, para controlar o que já foi postado à mão.',
      parameters: obj(
        {
          clipe_ids: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'Ids dos clipes' },
          plataforma: S('Rede', { enum: ['youtube', 'tiktok'] }),
          postado: B('true = postado, false = desmarcar')
        },
        ['clipe_ids', 'plataforma', 'postado']
      ),
      label: (a) => `${a.postado === false ? 'Desmarcou' : 'Marcou'} ${(a.clipe_ids as unknown[])?.length ?? 0} clipe(s) como postado(s) no ${a.plataforma === 'tiktok' ? 'TikTok' : 'YouTube'}`,
      run: (a) => {
        const ids = (Array.isArray(a.clipe_ids) ? a.clipe_ids : []).map(Number).filter(Number.isFinite)
        for (const id of ids) ctx.clips.markPosted(id, a.plataforma === 'tiktok' ? 'tiktok' : 'youtube', a.postado !== false)
        return { feitos: ids }
      }
    },

    // ---------- apagar ou parar (pedem confirmação) ----------
    {
      name: 'apagar_clipe',
      description: 'Apaga um clipe (o arquivo de vídeo e o .txt).',
      danger: true,
      parameters: obj({ clipe_id: I('Id do clipe') }, ['clipe_id']),
      label: (a) => {
        const c = ctx.clips.list().find((x) => x.id === Number(a.clipe_id))
        return `Apagar o clipe "${c?.title ?? a.clipe_id}"`
      },
      run: (a) => {
        ctx.clips.delete(Number(a.clipe_id))
        return { apagado: Number(a.clipe_id) }
      }
    },
    {
      name: 'apagar_gravacao',
      description: 'Apaga uma live gravada ou um VOD importado (os pedaços de vídeo no disco). Os clipes prontos continuam.',
      danger: true,
      parameters: obj({ live_id: I('Id da live ou VOD') }, ['live_id']),
      label: (a) => {
        const l = ctx.vod.list(300).find((x) => x.id === Number(a.live_id))
        return l ? `Apagar ${l.kind === 'vod' ? 'o VOD' : 'a gravação'} de ${l.channelName} (${Math.round((l.bytes / 1e9) * 10) / 10} GB)` : `Apagar a gravação ${a.live_id}`
      },
      run: async (a) => {
        await ctx.vod.delete(Number(a.live_id))
        return { apagado: Number(a.live_id) }
      }
    },
    {
      name: 'parar_gravacao',
      description: 'Para a gravação de um canal que está ao vivo agora (o que já foi gravado fica).',
      danger: true,
      parameters: obj({ canal: S('Nome do canal') }, ['canal']),
      label: (a) => `Parar a gravação de ${findChannel(ctx, a.canal).displayName}`,
      run: async (a) => {
        const c = findChannel(ctx, a.canal)
        await ctx.live.stopRecording(c.id)
        return { canal: c.displayName, gravando: false }
      }
    },
    {
      name: 'parar_de_vigiar',
      description: 'Tira um canal da lista de vigiados (as gravações dele continuam na biblioteca).',
      danger: true,
      parameters: obj({ canal: S('Nome do canal') }, ['canal']),
      label: (a) => `Parar de vigiar ${findChannel(ctx, a.canal).displayName}`,
      run: async (a) => {
        const c = findChannel(ctx, a.canal)
        await ctx.live.remove(c.id)
        return { removido: c.displayName }
      }
    }
  ]
}

/** Instruções do assistente. */
export function assistantSystem(o: { profile: string; now: Date }): string {
  return `Você é a KaTY, a IA do Clipador KTY (escreva sempre "KaTY", exatamente assim). Fale de si no feminino. O Clipador KTY é um app de Windows que vigia lives da Twitch, da Kick e do YouTube, grava, acha os melhores momentos com IA e gera clipes verticais (9:16) com legenda e título para YouTube Shorts e TikTok. Serve para qualquer jogo, streamer e modalidade (jogo, conversa como Just Chatting e podcast, IRL, esporte, criativo). O lançamento do GTA 6 (19/11/2026) é a grande motivação do usuário, mas não o limite.

Hoje é ${o.now.toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. Perfil ativo: ${o.profile}.

Como o app funciona:
- Canais: Twitch, Kick e YouTube. Cada canal tem duas chaves: "Vigiar" (o app checa a cada minuto se está ao vivo e avisa, sem gravar) e "Gravar" (grava a live, procura os lances e faz os clipes; ligar Gravar liga Vigiar). Canal novo entra só vigiando. O mesmo streamer em várias plataformas aparece num bloco só. Para achar um canal, procurar_canal entende nome com erro, apelido ou descrição. Também importa VODs da Twitch e da Kick e vídeos ou lives encerradas do YouTube por link, inteiros ou um trecho.
- Clipar ao vivo: gravando, o app procura os lances a cada minuto e o clipe sai uns 3 a 5 min depois; no Início, o painel "Clipar ao vivo" tem o botão "Clipar agora" (últimos ~30 s).
- Detecção: picos de chat comparados ao normal do canal, picos de áudio, comando de voz ("clipa isso"), clipes que a comunidade já fez e a fala transcrita pelo Whisper. Cada momento ganha nota de 0 a 100 explicada. A IA (Gemini) lê fala e chat, dá título PT/EN, hashtags e pode descartar.
- Modalidade: vem da categoria da live no instante do lance (ou fixada no canal) e muda layout, duração e pesos (padrões por modalidade em Ajustes > Clipes).
- Clipes: gerados sozinhos para momentos fortes (nota mínima nos ajustes) ou à mão; layouts jogo + facecam, tela inteira com fundo desfocado, recorte do centro e horizontal. Ficam no disco (pasta de clipes) com um .txt de título, hashtags e créditos.
- Revisão: cada clipe fica "para revisar", "aprovado" ou "descartado" (tela Clipes).
- Telas: Início (resumo, clipar ao vivo, destaques de hoje), Clipes (com a Busca por palavra e por descrição), Canais (canais, ao vivo, lives e VODs), Ajustes (o que muda os clipes: corte, visual, detecção, postagem), Configurações (a engrenagem no topo: KaTY e IA, gravação, armazenamento, perfil, sistema) e KaTY (você).
- Postar: ainda NÃO posta sozinho no YouTube nem no TikTok (fase 2). Por enquanto o usuário posta à mão: ao aprovar, uma cópia vai para a pasta "para postar" (uma subpasta por dia) com um .txt de título e descrição do YouTube e legenda do TikTok; em Clipes, o grupo "Postagem" tem "Para postar" (aprovados que faltam postar, com os botões de copiar os textos e a marcação "postado" de cada rede) e "Postados"; a janela do clipe também tem esses botões.
- Ainda NÃO existe: IA local, OpenAI/Claude/Codex, detecção pela imagem do jogo. Você também não controla o Windows nem outros programas.

Como agir:
- Responda em português do Brasil, curto e direto, com frases simples. Listas curtas quando ajudar.
- Use as funções para saber fatos do app; nunca invente números, nomes ou ids.
- Quando o usuário pedir algo que o app faz, faça com as funções em vez de ensinar o caminho (a menos que ele só queira saber como). Depois diga em uma frase o que fez.
- Se a pergunta é "o que eu posso fazer" ou "por onde começo", olhe o resumo do app e sugira os próximos passos concretos.
- Funções que apagam ou param algo pedem confirmação: chame-as mesmo assim; o app mostra os botões Confirmar e Cancelar. Diga que está esperando a confirmação.
- Se faltar informação (qual canal, qual clipe), pergunte antes.
- Quando for útil, abra a tela certa com abrir_tela para o usuário ver.`
}
