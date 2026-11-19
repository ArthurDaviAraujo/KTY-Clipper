import { useEffect, useState, type ReactNode } from 'react'
import {
  Activity,
  Archive,
  Captions,
  Check,
  CheckCheck,
  Clapperboard,
  Cpu,
  Download,
  Film,
  FolderOpen,
  HardDrive,
  Home,
  Inbox,
  LayoutGrid,
  Library,
  Mic,
  Plus,
  Radio,
  Rocket,
  Search,
  Palette,
  Scissors,
  Send,
  Sparkles,
  UserRound,
  X
} from 'lucide-react'
import { setupSteps } from './pages/Home'
import { Wordmark } from './Logo'
import { useAppState } from './state'
import { formatTimecode } from '../../shared/vod'
import { postDone } from '../../shared/post'
import { GearStar, cx } from './ui'
import { Avatar } from './Avatar'
import { PLATFORM_NAME, groupChannels } from '../../shared/channels'
import type { ChannelState } from '../../shared/types'
import HomePage from './pages/Home'
import ChannelsPage from './pages/Channels'
import ClipsPage, { type ClipsSort, type ClipsTab } from './pages/Clips'
import SettingsPage, { CONFIG_TABS, type ClipTab, type ConfigTab, type SettingsTab } from './pages/Settings'
import ActivityMenu from './ActivityMenu'
import ProfileMenu from './ProfileMenu'
import { AssistantChat, KatySidebar, useAssistant } from './Assistant'
import { SidePanel, SidePanelMenu, useSidePrefs, type SidePanelId } from './SidePanel'

/** 'settings' = Ajustes (os clipes); 'config' = Configurações (a engrenagem: o app em si) */
export type PageId = 'home' | 'clips' | 'channels' | 'settings' | 'config' | 'assistant'
/** Canais: todos, só os ao vivo, a biblioteca de lives e VODs, ou um canal */
export type ChannelsView = 'all' | 'live' | 'library' | number

/** Início: visão geral, atividade completa ou o guia de primeiros passos */
export type HomeView = 'overview' | 'activity' | 'guide'

export interface GoOptions {
  liveId?: number | 'all'
  tab?: ClipsTab
  channels?: ChannelsView
  /** Abre a aba certa: as de clipe em Ajustes, as do app em Configurações ('clipes' = Visual, nome antigo) */
  settings?: SettingsTab | 'clipes'
  home?: HomeView
}
export type Go = (page: PageId, opts?: GoOptions) => void

const TOP: { id: PageId; label: string }[] = [
  { id: 'home', label: 'Início' },
  { id: 'clips', label: 'Clipes' },
  { id: 'channels', label: 'Canais' },
  { id: 'settings', label: 'Ajustes' },
  { id: 'assistant', label: 'KaTY' }
]

const AI_LABEL = { gemini: 'Gemini grátis', local: 'IA local', openai: 'OpenAI', claude: 'Claude', codex: 'ChatGPT (Codex)' } as const

export default function App() {
  const state = useAppState()
  const [page, setPage] = useState<PageId>('home')
  const [clipsTab, setClipsTab] = useState<ClipsTab>('review')
  const [clipsLive, setClipsLive] = useState<number | 'all'>('all')
  const [clipsSort, setClipsSort] = useState<ClipsSort>('best')
  const [channelsView, setChannelsView] = useState<ChannelsView>('all')
  const [settingsTab, setSettingsTab] = useState<ClipTab>('corte')
  const [configTab, setConfigTab] = useState<ConfigTab>('ia')
  const [homeView, setHomeView] = useState<HomeView>('overview')
  const [query, setQuery] = useState('')
  // Aba de Clipes antes de começar a buscar (volta para ela ao limpar a busca)
  const [beforeSearch, setBeforeSearch] = useState<ClipsTab>('review')
  const typeQuery = (v: string) => {
    setQuery(v)
    if (v.trim()) {
      if (clipsTab !== 'search') setBeforeSearch(clipsTab)
      setClipsTab('search')
      setPage('clips')
    } else if (clipsTab === 'search') setClipsTab(beforeSearch)
  }
  const side = useSidePrefs()
  const assistant = useAssistant()
  const { settings, disk, channels, clips, lives, jobs } = state

  const go: Go = (p, o) => {
    if (o?.liveId !== undefined) setClipsLive(o.liveId)
    if (o?.tab) setClipsTab(o.tab)
    if (o?.channels !== undefined) setChannelsView(o.channels)
    if (o?.home) setHomeView(o.home)
    if (o?.settings) {
      const t = o.settings === 'clipes' ? 'visual' : o.settings
      if ((CONFIG_TABS as string[]).includes(t)) {
        setConfigTab(t as ConfigTab)
        return setPage('config')
      }
      setSettingsTab(t as ClipTab)
    }
    setPage(p)
  }
  // O assistente pode abrir uma tela (ex.: os clipes para revisar)
  useEffect(() => window.api.onNavigate((to) => go(to.page as PageId, to as GoOptions)), [])
  const assistantOn = settings?.assistant.enabled !== false
  const pendingConfirm = assistant.messages.some((m) => m.confirm?.state === 'pending')
  // Painéis da barra lateral nesta tela: o assistente sai dela quando a aba Assistente está aberta
  const availablePanels: SidePanelId[] = ['assistant', 'live', 'review', 'activity'].filter((id) => id !== 'assistant' || assistantOn) as SidePanelId[]
  const sidePanels = side.panels.filter((id) => availablePanels.includes(id) && !(id === 'assistant' && page === 'assistant'))
  const showSide = side.open && sidePanels.length > 0
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length
  const approved = clips.filter((c) => c.review === 'approved').length
  const missing = setupSteps(state).filter((s) => !s.ok).length

  const recording = channels.filter((c) => c.recording)
  const onAir = channels.filter((c) => c.live || c.recording)
  const scoped = clips.filter((c) => clipsLive === 'all' || c.liveId === clipsLive)
  const count = (r: 'pending' | 'approved' | 'rejected') => scoped.filter((c) => c.review === r).length
  const toReview = clips.filter((c) => c.review === 'pending').length
  // Postagem: aprovados prontos que ainda faltam postar em alguma das redes escolhidas, e os já postados
  const nets = settings?.publishing.networks ?? { youtube: true, tiktok: true }
  const postable = scoped.filter((c) => c.review === 'approved' && c.status === 'ready')
  const toPost = postable.filter((c) => !postDone(c.posted, nets)).length
  const postedCount = postable.length - toPost
  const withSegments = lives.filter((l) => l.segments > 0)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Barra do topo: marca, seções, busca, avisos e perfil (os botões da janela ficam à direita) */}
      <header className="drag relative z-30 flex h-12 shrink-0 items-stretch border-b border-white/[0.07] bg-[#1b1726]/85 backdrop-blur-xl">
        <div className="flex w-60 shrink-0 items-center px-5">
          <Wordmark size={28} />
        </div>
        <nav className="no-drag flex items-stretch">
          {TOP.filter((t) => t.id !== 'assistant' || assistantOn).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setPage(t.id)}
              className={cx(
                'relative flex items-center gap-1.5 border-b-2 px-4 text-[13px] transition',
                page === t.id ? 'border-white/90 text-text' : 'border-transparent text-muted hover:text-text'
              )}
            >
              {t.id === 'assistant' && <Sparkles size={13} className="text-ai" />}
              {t.label}
              {t.id === 'clips' && toReview > 0 && <span className="size-1.5 rounded-full bg-accent-2" title={`${toReview} para revisar`} />}
              {t.id === 'channels' && onAir.length > 0 && <span className="size-1.5 rounded-full bg-live" title={`${onAir.length} ao vivo`} />}
              {t.id === 'assistant' && (assistant.busy || pendingConfirm) && <span className="size-1.5 rounded-full bg-warn" title="A KaTY está trabalhando ou esperando você" />}
            </button>
          ))}
        </nav>
        <label className="no-drag ml-6 flex w-64 items-center gap-2 self-center rounded-full px-2 py-1 text-[13px] text-muted focus-within:bg-white/[0.06]">
          <Search size={14} className="shrink-0" />
          <input
            value={query}
            onChange={(e) => typeQuery(e.target.value)}
            onFocus={() => query.trim() && go('clips', { tab: 'search' })}
            placeholder="Buscar o que aconteceu ou foi falado"
            className="w-full bg-transparent text-text outline-none placeholder:text-muted"
          />
          {query && (
            <button type="button" onClick={() => typeQuery('')} aria-label="Limpar busca" className="hover:text-text">
              <X size={13} />
            </button>
          )}
        </label>
        <div className="no-drag ml-auto mr-[148px] flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage(page === 'config' ? 'home' : 'config')}
            title="Configurações do app"
            aria-label="Configurações"
            className={cx(
              'grid size-8 place-items-center rounded-full transition',
              page === 'config' ? 'bg-white/[0.12] text-text' : 'text-muted hover:bg-white/[0.07] hover:text-text'
            )}
          >
            <GearStar size={16} />
          </button>
          <SidePanelMenu prefs={side} available={availablePanels} badge={pendingConfirm} />
          <ActivityMenu state={state} />
          <ProfileMenu state={state} go={go} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Menu lateral da seção */}
        <aside className="w-60 shrink-0 space-y-6 overflow-y-auto border-r border-white/[0.07] bg-[#1c1828]/60 px-3 py-5 backdrop-blur-xl">
          {page === 'home' && (
            <>
              <SideHeader
                icon={Home}
                tone="home"
                title="Início"
                sub={`${onAir.length} ao vivo · ${toReview} para revisar`}
              />
              <Group label="Telas">
                <SideItem icon={LayoutGrid} label="Visão geral" active={homeView === 'overview'} onClick={() => setHomeView('overview')} />
                <SideItem icon={Activity} label="Atividade" badge={running} active={homeView === 'activity'} onClick={() => setHomeView('activity')} />
                <SideItem icon={Rocket} label="Primeiros passos" count={missing} active={homeView === 'guide'} onClick={() => setHomeView('guide')} />
              </Group>
              <Group label="Atalhos">
                <SideItem icon={Inbox} label="Clipes para revisar" badge={toReview} onClick={() => go('clips', { tab: 'review', liveId: 'all' })} />
                <SideItem icon={Check} label="Aprovados" count={approved} onClick={() => go('clips', { tab: 'approved', liveId: 'all' })} />
                <SideItem icon={Plus} label="Adicionar canal" onClick={() => go('channels', { channels: 'all' })} />
                <SideItem icon={Download} label="Importar VOD" onClick={() => go('channels', { channels: 'library' })} />
                <SideItem icon={FolderOpen} label="Pasta dos clipes" onClick={() => disk && void window.api.openPath(disk.clipsDir)} />
                <SideItem icon={Captions} label="Estilo da legenda" onClick={() => go('settings', { settings: 'visual' })} />
              </Group>
              <Group label="Ao vivo agora">
                {onAir.length === 0 && <p className="px-2 text-xs text-muted">Ninguém ao vivo.</p>}
                {groupChannels(onAir).map((g) => (
                  <SideItem key={g[0].id} avatar={<GroupAvatar group={g} />} label={g[0].displayName} title={groupTitle(g)} onClick={() => go('channels', { channels: g[0].id })} />
                ))}
              </Group>
              <Group label="Status">
                <SideInfo icon={Film} text={recording.length ? `Gravando ${recording.length}` : channels.length ? 'Vigiando os canais' : 'Nenhum canal'} tone={recording.length ? 'live' : undefined} />
                <SideInfo icon={Sparkles} text={settings ? AI_LABEL[settings.ai.provider] : '…'} />
                <SideInfo icon={HardDrive} text={disk ? `${disk.freeGb} GB livres` : '…'} tone={disk?.low ? 'warn' : undefined} />
              </Group>
            </>
          )}

          {page === 'clips' && (
            <>
              <SideHeader icon={Clapperboard} tone="clips" title="Clipes" sub={`Revisar ${toReview} · Postar ${toPost}`} />
              <Group label="Revisão">
                <SideItem icon={Inbox} label="Para revisar" badge={count('pending')} active={clipsTab === 'review'} onClick={() => setClipsTab('review')} />
                <SideItem icon={Check} label="Aprovados" count={count('approved')} active={clipsTab === 'approved'} onClick={() => setClipsTab('approved')} />
                <SideItem icon={Archive} label="Descartados" count={count('rejected')} active={clipsTab === 'rejected'} onClick={() => setClipsTab('rejected')} />
                <SideItem icon={Sparkles} label="Momentos sem clipe" active={clipsTab === 'moments'} onClick={() => setClipsTab('moments')} />
                <SideItem icon={Search} label="Busca" active={clipsTab === 'search'} onClick={() => setClipsTab('search')} />
              </Group>
              <Group label="Postagem">
                <SideItem icon={Send} label="Para postar" badge={toPost} active={clipsTab === 'topost'} onClick={() => setClipsTab('topost')} />
                <SideItem icon={CheckCheck} label="Postados" count={postedCount} active={clipsTab === 'posted'} onClick={() => setClipsTab('posted')} />
                <SideItem icon={FolderOpen} label="Pasta para postar" onClick={() => disk && void window.api.openPath(disk.exportDir)} />
              </Group>
              <Group label="Lives">
                <SideItem icon={Library} label="Todas as lives" active={clipsLive === 'all'} onClick={() => setClipsLive('all')} />
                {withSegments.map((l) => (
                  <SideItem
                    key={l.id}
                    label={`${l.channelName} · ${new Date(l.startedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}${
                      l.rangeStartS != null ? ` · ${formatTimecode(l.rangeStartS)}` : ''
                    }`}
                    title={l.title}
                    dot={l.status === 'recording'}
                    active={clipsLive === l.id}
                    onClick={() => setClipsLive(l.id)}
                  />
                ))}
              </Group>
            </>
          )}

          {page === 'channels' && (
            <>
              <SideHeader
                icon={Radio}
                tone="channels"
                title="Canais"
                sub={`${groupChannels(channels).length} streamer${groupChannels(channels).length === 1 ? '' : 's'} · ${onAir.length} ao vivo`}
              />
              <Group label="Ver">
                <SideItem icon={Radio} label="Todos os canais" count={channels.length} active={channelsView === 'all'} onClick={() => setChannelsView('all')} />
                <SideItem icon={Film} label="Ao vivo" count={onAir.length} dot={onAir.length > 0} active={channelsView === 'live'} onClick={() => setChannelsView('live')} />
                <SideItem icon={Library} label="Lives e VODs" count={lives.length} active={channelsView === 'library'} onClick={() => setChannelsView('library')} />
              </Group>
              {channels.length > 0 && (
                <Group label="Seus canais">
                  {groupChannels(channels).map((g) => (
                    <SideItem
                      key={g[0].id}
                      avatar={<GroupAvatar group={g} />}
                      label={g[0].displayName}
                      title={groupTitle(g)}
                      count={g.length > 1 ? g.length : undefined}
                      active={g.some((c) => channelsView === c.id)}
                      onClick={() => setChannelsView(g[0].id)}
                    />
                  ))}
                </Group>
              )}
            </>
          )}

          {page === 'assistant' && (
            <KatySidebar
              state={assistant}
              onSetup={() => go('settings', { settings: 'ia' })}
              onOpenSide={() => {
                side.show('assistant')
                setPage('home')
              }}
            />
          )}

          {page === 'settings' && (
            <>
              <SideHeader icon={Scissors} tone="settings" title="Ajustes" sub="O que muda os clipes" />
              <Group label="Seções">
                {(
                  [
                    ['corte', 'Corte', Scissors],
                    ['visual', 'Visual', Palette],
                    ['deteccao', 'Detecção', Sparkles],
                    ['postagem', 'Postagem', Send]
                  ] as const
                ).map(([id, label, icon]) => (
                  <SideItem key={id} icon={icon} label={label} active={settingsTab === id} onClick={() => setSettingsTab(id)} />
                ))}
              </Group>
              <Group label="Do app">
                <SideItem icon={GearStar as unknown as typeof Home} label="Configurações" onClick={() => setPage('config')} />
              </Group>
            </>
          )}

          {page === 'config' && (
            <>
              <SideHeader icon={GearStar as unknown as typeof Home} tone="config" title="Configurações" sub="IA, gravação e disco" />
              <Group label="Seções">
                {(
                  [
                    ['ia', 'KaTY e IA', Mic],
                    ['gravacao', 'Gravação', Film],
                    ['armazenamento', 'Armazenamento', HardDrive]
                  ] as const
                ).map(([id, label, icon]) => (
                  <SideItem key={id} icon={icon} label={label} active={configTab === id} onClick={() => setConfigTab(id)} />
                ))}
              </Group>
              <Group label="App">
                <SideItem icon={UserRound} label="Perfil" active={configTab === 'perfil'} onClick={() => setConfigTab('perfil')} />
                <SideItem icon={Cpu} label="Sistema" active={configTab === 'sistema'} onClick={() => setConfigTab('sistema')} />
              </Group>
              <Group label="Dos clipes">
                <SideItem icon={Clapperboard} label="Ajustes" onClick={() => setPage('settings')} />
              </Group>
            </>
          )}
        </aside>

        <main
          className={cx(
            'min-w-0 flex-1 px-8 xl:px-12 2xl:px-16',
            page === 'assistant' ? 'flex flex-col overflow-hidden pb-6 pt-8' : 'overflow-y-auto pb-14 pt-8'
          )}
        >
          {page === 'assistant' && <AssistantChat state={assistant} onSetup={() => go('settings', { settings: 'ia' })} />}
          {page === 'home' && <HomePage state={state} go={go} view={homeView} />}
          {page === 'clips' && (
            <ClipsPage state={state} liveId={clipsLive} tab={clipsTab} setTab={setClipsTab} sort={clipsSort} setSort={setClipsSort} query={query} clearQuery={() => typeQuery('')} />
          )}
          {page === 'channels' && <ChannelsPage state={state} go={go} view={channelsView} setView={setChannelsView} />}
          {page === 'settings' && <SettingsPage state={state} tab={settingsTab} />}
          {page === 'config' && <SettingsPage state={state} tab={configTab} />}
        </main>

        {/* Barra lateral: assistente, ao vivo, para revisar e atividade (a pessoa escolhe no botão do topo) */}
        {showSide && (
          <SidePanel
            state={state}
            assistant={assistant}
            prefs={side}
            panels={sidePanels}
            go={go}
            openAssistantTab={() => setPage('assistant')}
          />
        )}
      </div>
    </div>
  )
}

/** Avatar de um streamer: com várias plataformas, sem o selo (o nome já junta todas). */
function GroupAvatar({ group }: { group: ChannelState[] }) {
  const pic = group.find((c) => c.avatarUrl) ?? group[0]
  return (
    <Avatar
      channel={{ ...pic, live: group.find((c) => c.live)?.live ?? null, recording: group.find((c) => c.recording)?.recording ?? null }}
      size={20}
      badge={group.length === 1}
    />
  )
}

const groupTitle = (g: ChannelState[]) => `${g[0].displayName} · ${g.map((c) => PLATFORM_NAME[c.platform]).join(', ')}`

/** Cor de cada seção: só no ícone e num leve tom do cartão do topo, para distinguir sem chamar atenção */
const TONES = {
  home: { icon: 'from-accent to-accent-2 shadow-accent/25', card: 'from-accent/[0.12]' },
  clips: { icon: 'from-brand to-violet shadow-violet/25', card: 'from-violet/[0.12]' },
  channels: { icon: 'from-live to-warn shadow-live/25', card: 'from-live/[0.10]' },
  settings: { icon: 'from-ok to-accent shadow-ok/20', card: 'from-ok/[0.10]' },
  config: { icon: 'from-gold to-warn shadow-gold/20', card: 'from-gold/[0.10]' }
} as const

/** Cartão do topo da lateral: ícone da seção, nome e um resumo de uma linha (o mesmo estilo do cartão da KaTY) */
function SideHeader({ icon: Icon, title, sub, tone }: { icon: typeof Home; title: string; sub: string; tone: keyof typeof TONES }) {
  const t = TONES[tone]
  return (
    <div className={cx('flex items-center gap-2.5 rounded-2xl border border-white/[0.08] bg-gradient-to-br via-white/[0.03] to-transparent p-3', t.card)}>
      <span className={cx('grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br text-white shadow-md', t.icon)}>
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <p className="font-display text-[15px] font-semibold leading-tight">{title}</p>
        <p className="truncate text-[11.5px] text-muted" title={sub}>
          {sub}
        </p>
      </div>
    </div>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="px-2 pb-1 text-[11px] text-muted/80">{label}</p>
      {children}
    </div>
  )
}

function SideItem({
  icon: Icon,
  avatar,
  label,
  title,
  active,
  badge,
  count,
  dot,
  onClick
}: {
  icon?: typeof Home
  avatar?: ReactNode
  label: string
  title?: string
  active?: boolean
  badge?: number
  count?: number
  dot?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      onClick={onClick}
      className={cx(
        'relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition',
        active ? 'bg-white/[0.08] text-text' : 'text-text/80 hover:bg-white/[0.05] hover:text-text'
      )}
    >
      {/* Barrinha do item aberto */}
      {active && <span className="absolute -left-3 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-accent-2" />}
      {avatar ?? (Icon ? <Icon size={15} className={cx('shrink-0', active ? 'text-text' : 'text-muted')} /> : <span className="size-[15px] shrink-0" />)}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {dot && <span className="size-1.5 shrink-0 rounded-full bg-live" />}
      {!!badge && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">{badge}</span>}
      {!badge && count != null && count > 0 && <span className="text-[11px] tabular-nums text-muted">{count}</span>}
    </button>
  )
}

function SideInfo({ icon: Icon, text, tone }: { icon: typeof Home; text: string; tone?: 'live' | 'warn' }) {
  return (
    <p className={cx('flex items-center gap-2.5 px-2 py-1 text-xs', tone === 'live' ? 'text-live' : tone === 'warn' ? 'text-warn' : 'text-muted')}>
      <Icon size={13} className="shrink-0" /> {text}
    </p>
  )
}
