import { useState } from 'react'
import { Clapperboard, Film, HardDrive, Home, Radio, Settings as Cog, Sparkles } from 'lucide-react'
import { useAppState } from './state'
import { cx } from './ui'
import HomePage from './pages/Home'
import ChannelsPage from './pages/Channels'
import ClipsPage, { type ClipsTab } from './pages/Clips'
import SettingsPage from './pages/Settings'
import ActivityMenu from './ActivityMenu'

export type PageId = 'home' | 'channels' | 'clips' | 'settings'

/** Para onde ir e, na tela Clipes, qual live e qual aba abrir */
export interface GoOptions {
  liveId?: number | 'all'
  tab?: ClipsTab
}
export type Go = (page: PageId, opts?: GoOptions) => void

const AI_LABEL = { gemini: 'Gemini grátis', local: 'IA local', openai: 'OpenAI', claude: 'Claude', codex: 'ChatGPT (Codex)' } as const

export default function App() {
  const state = useAppState()
  const [page, setPage] = useState<PageId>('home')
  const [clipsLive, setClipsLive] = useState<number | 'all'>('all')
  const [clipsTab, setClipsTab] = useState<ClipsTab>('review')
  const { settings, disk, channels, clips } = state

  const recording = channels.filter((c) => c.recording).length
  const live = channels.filter((c) => c.live).length
  const toReview = clips.filter((c) => c.review === 'pending').length

  const go: Go = (p, o) => {
    if (o?.liveId !== undefined) setClipsLive(o.liveId)
    if (o?.tab) setClipsTab(o.tab)
    setPage(p)
  }

  const NAV: { id: PageId; label: string; icon: typeof Home; badge?: { text: string; live?: boolean } }[] = [
    { id: 'home', label: 'Início', icon: Home },
    { id: 'channels', label: 'Canais', icon: Radio, badge: live ? { text: `${live} ao vivo`, live: true } : undefined },
    { id: 'clips', label: 'Clipes', icon: Clapperboard, badge: toReview ? { text: String(toReview) } : undefined },
    { id: 'settings', label: 'Ajustes', icon: Cog }
  ]

  return (
    <div className="flex h-full overflow-hidden bg-bg">
      <nav className="flex w-56 shrink-0 flex-col border-r border-line/60 bg-panel/70">
        <div className="drag flex items-center gap-3 px-4 pb-6 pt-4">
          <div className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-accent to-gold text-white shadow-lg">
            <Clapperboard size={20} />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Clipador KTY</h1>
            <p className="text-xs text-muted">Clipes de lives com IA</p>
          </div>
        </div>
        <ul className="flex-1 space-y-1 px-3">
          {NAV.map(({ id, label, icon: Icon, badge }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => setPage(id)}
                className={cx(
                  'relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
                  page === id ? 'bg-accent/15 font-medium text-text' : 'text-muted hover:bg-card/40 hover:text-text'
                )}
              >
                {page === id && <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-accent" />}
                <Icon size={18} className={page === id ? 'text-accent' : ''} />
                {label}
                {badge && (
                  <span
                    className={cx(
                      'ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold',
                      badge.live ? 'bg-live/20 text-live' : 'bg-accent text-white'
                    )}
                  >
                    {badge.text}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="space-y-1.5 border-t border-line/60 px-4 py-3 text-xs text-muted">
          <div className="flex items-center gap-2">
            <Film size={13} />
            {recording ? <span className="font-medium text-live">Gravando {recording}</span> : <span>{channels.length ? 'Vigiando os canais' : 'Nenhum canal'}</span>}
          </div>
          <div className="flex items-center gap-2">
            <Sparkles size={13} /> {settings ? AI_LABEL[settings.ai.provider] : '…'}
          </div>
          <div className={cx('flex items-center gap-2', disk?.low && 'text-warn')}>
            <HardDrive size={13} /> {disk ? `${disk.freeGb} GB livres` : '…'}
          </div>
        </div>
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">
        {/* Topo: arrasta a janela; à direita, as tarefas e avisos (antes dos botões da janela) */}
        <header className="drag flex h-11 shrink-0 items-center justify-end pr-[150px]">
          <ActivityMenu state={state} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-2">
          {page === 'home' && <HomePage state={state} go={go} />}
          {page === 'channels' && <ChannelsPage state={state} go={go} />}
          {page === 'clips' && <ClipsPage state={state} liveId={clipsLive} setLiveId={setClipsLive} tab={clipsTab} setTab={setClipsTab} />}
          {page === 'settings' && <SettingsPage state={state} />}
        </div>
      </main>
    </div>
  )
}
