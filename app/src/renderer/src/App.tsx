import { useState, type ReactNode } from 'react'
import {
  Activity,
  Archive,
  Captions,
  Check,
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
  Sparkles,
  UserRound,
  X
} from 'lucide-react'
import { setupSteps } from './pages/Home'
import { Wordmark } from './Logo'
import { useAppState } from './state'
import { formatTimecode } from '../../shared/vod'
import { cx } from './ui'
import { Avatar } from './Avatar'
import HomePage from './pages/Home'
import ChannelsPage from './pages/Channels'
import ClipsPage, { type ClipsSort, type ClipsTab } from './pages/Clips'
import SettingsPage, { type SettingsTab } from './pages/Settings'
import ActivityMenu from './ActivityMenu'
import ProfileMenu from './ProfileMenu'

export type PageId = 'home' | 'clips' | 'channels' | 'settings'
/** Canais: todos, só os ao vivo, a biblioteca de lives e VODs, ou um canal */
export type ChannelsView = 'all' | 'live' | 'library' | number

/** Início: visão geral, atividade completa ou o guia de primeiros passos */
export type HomeView = 'overview' | 'activity' | 'guide'

export interface GoOptions {
  liveId?: number | 'all'
  tab?: ClipsTab
  channels?: ChannelsView
  settings?: SettingsTab
  home?: HomeView
}
export type Go = (page: PageId, opts?: GoOptions) => void

const TOP: { id: PageId; label: string }[] = [
  { id: 'home', label: 'Início' },
  { id: 'clips', label: 'Clipes' },
  { id: 'channels', label: 'Canais' },
  { id: 'settings', label: 'Ajustes' }
]

const AI_LABEL = { gemini: 'Gemini grátis', local: 'IA local', openai: 'OpenAI', claude: 'Claude', codex: 'ChatGPT (Codex)' } as const

export default function App() {
  const state = useAppState()
  const [page, setPage] = useState<PageId>('home')
  const [clipsTab, setClipsTab] = useState<ClipsTab>('review')
  const [clipsLive, setClipsLive] = useState<number | 'all'>('all')
  const [clipsSort, setClipsSort] = useState<ClipsSort>('best')
  const [channelsView, setChannelsView] = useState<ChannelsView>('all')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('deteccao')
  const [homeView, setHomeView] = useState<HomeView>('overview')
  const [query, setQuery] = useState('')
  const { settings, disk, channels, clips, lives, jobs } = state

  const go: Go = (p, o) => {
    if (o?.liveId !== undefined) setClipsLive(o.liveId)
    if (o?.tab) setClipsTab(o.tab)
    if (o?.channels !== undefined) setChannelsView(o.channels)
    if (o?.settings) setSettingsTab(o.settings)
    if (o?.home) setHomeView(o.home)
    setPage(p)
  }
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length
  const approved = clips.filter((c) => c.review === 'approved').length
  const missing = setupSteps(state).filter((s) => !s.ok).length

  const recording = channels.filter((c) => c.recording)
  const onAir = channels.filter((c) => c.live || c.recording)
  const scoped = clips.filter((c) => clipsLive === 'all' || c.liveId === clipsLive)
  const count = (r: 'pending' | 'approved' | 'rejected') => scoped.filter((c) => c.review === r).length
  const toReview = clips.filter((c) => c.review === 'pending').length
  const withSegments = lives.filter((l) => l.segments > 0)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Barra do topo: marca, seções, busca, avisos e perfil (os botões da janela ficam à direita) */}
      <header className="drag relative z-30 flex h-12 shrink-0 items-stretch border-b border-white/[0.07] bg-[#1b1726]/85 backdrop-blur-xl">
        <div className="flex w-60 shrink-0 items-center px-5">
          <Wordmark size={28} />
        </div>
        <nav className="no-drag flex items-stretch">
          {TOP.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setPage(t.id)}
              className={cx(
                'relative flex items-center gap-1.5 border-b-2 px-4 text-[13px] transition',
                page === t.id ? 'border-white/90 text-text' : 'border-transparent text-muted hover:text-text'
              )}
            >
              {t.label}
              {t.id === 'clips' && toReview > 0 && <span className="size-1.5 rounded-full bg-accent-2" title={`${toReview} para revisar`} />}
              {t.id === 'channels' && onAir.length > 0 && <span className="size-1.5 rounded-full bg-live" title={`${onAir.length} ao vivo`} />}
            </button>
          ))}
        </nav>
        <label className="no-drag ml-6 flex w-64 items-center gap-2 self-center rounded-full px-2 py-1 text-[13px] text-muted focus-within:bg-white/[0.06]">
          <Search size={14} className="shrink-0" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (e.target.value && page !== 'clips') setPage('clips')
            }}
            placeholder="Buscar clipes e momentos"
            className="w-full bg-transparent text-text outline-none placeholder:text-muted"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Limpar busca" className="hover:text-text">
              <X size={13} />
            </button>
          )}
        </label>
        <div className="no-drag ml-auto mr-[148px] flex items-center gap-2">
          <ActivityMenu state={state} />
          <ProfileMenu state={state} go={go} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Menu lateral da seção */}
        <aside className="w-60 shrink-0 space-y-6 overflow-y-auto border-r border-white/[0.07] bg-[#1c1828]/60 px-3 py-5 backdrop-blur-xl">
          {page === 'home' && (
            <>
              <Group label="Início">
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
                <SideItem icon={Captions} label="Estilo da legenda" onClick={() => go('settings', { settings: 'clipes' })} />
              </Group>
              <Group label="Ao vivo agora">
                {onAir.length === 0 && <p className="px-2 text-xs text-muted">Ninguém ao vivo.</p>}
                {onAir.map((c) => (
                  <SideItem key={c.id} avatar={<Avatar channel={c} size={20} />} label={c.displayName} onClick={() => go('channels', { channels: c.id })} />
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
              <Group label="Clipes">
                <SideItem icon={Inbox} label="Para revisar" badge={count('pending')} active={clipsTab === 'review'} onClick={() => setClipsTab('review')} />
                <SideItem icon={Check} label="Aprovados" count={count('approved')} active={clipsTab === 'approved'} onClick={() => setClipsTab('approved')} />
                <SideItem icon={Archive} label="Descartados" count={count('rejected')} active={clipsTab === 'rejected'} onClick={() => setClipsTab('rejected')} />
                <SideItem icon={Sparkles} label="Momentos sem clipe" active={clipsTab === 'moments'} onClick={() => setClipsTab('moments')} />
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
              <Group label="Canais">
                <SideItem icon={Radio} label="Todos os canais" count={channels.length} active={channelsView === 'all'} onClick={() => setChannelsView('all')} />
                <SideItem icon={Film} label="Ao vivo" count={onAir.length} dot={onAir.length > 0} active={channelsView === 'live'} onClick={() => setChannelsView('live')} />
                <SideItem icon={Library} label="Lives e VODs" count={lives.length} active={channelsView === 'library'} onClick={() => setChannelsView('library')} />
              </Group>
              {channels.length > 0 && (
                <Group label="Seus canais">
                  {channels.map((c) => (
                    <SideItem key={c.id} avatar={<Avatar channel={c} size={20} />} label={c.displayName} active={channelsView === c.id} onClick={() => setChannelsView(c.id)} />
                  ))}
                </Group>
              )}
            </>
          )}

          {page === 'settings' && (
            <>
              <Group label="Ajustes">
                {(
                  [
                    ['deteccao', 'Detecção', Sparkles],
                    ['ia', 'IA e fala', Mic],
                    ['clipes', 'Clipes', Clapperboard],
                    ['gravacao', 'Gravação', Film],
                    ['armazenamento', 'Armazenamento', HardDrive]
                  ] as const
                ).map(([id, label, icon]) => (
                  <SideItem key={id} icon={icon} label={label} active={settingsTab === id} onClick={() => setSettingsTab(id)} />
                ))}
              </Group>
              <Group label="App">
                <SideItem icon={UserRound} label="Perfil" active={settingsTab === 'perfil'} onClick={() => setSettingsTab('perfil')} />
                <SideItem icon={Cpu} label="Sistema" active={settingsTab === 'sistema'} onClick={() => setSettingsTab('sistema')} />
              </Group>
            </>
          )}
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto px-8 pb-14 pt-8 xl:px-12 2xl:px-16">
          {page === 'home' && <HomePage state={state} go={go} view={homeView} />}
          {page === 'clips' && (
            <ClipsPage state={state} liveId={clipsLive} tab={clipsTab} setTab={setClipsTab} sort={clipsSort} setSort={setClipsSort} query={query} clearQuery={() => setQuery('')} />
          )}
          {page === 'channels' && <ChannelsPage state={state} go={go} view={channelsView} setView={setChannelsView} />}
          {page === 'settings' && <SettingsPage state={state} tab={settingsTab} />}
        </main>
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
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition',
        active ? 'bg-white/[0.09] text-text' : 'text-text/80 hover:bg-white/[0.05] hover:text-text'
      )}
    >
      {avatar ?? (Icon ? <Icon size={14} className="shrink-0 text-muted" /> : <span className="size-3.5 shrink-0" />)}
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
