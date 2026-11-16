import { useState } from 'react'
import { Clapperboard, Cpu, Film, HardDrive, Home, Inbox, Library, Plus, Radio, Scissors, Search, Send, Settings as Cog, Sparkles } from 'lucide-react'
import { useAppState } from './state'
import { cx } from './ui'
import HomePage from './pages/Home'
import SettingsPage from './pages/Settings'
import SystemPage from './pages/System'
import SoonPage from './pages/Soon'
import LivePage from './pages/Live'
import RecordingsPage from './pages/Recordings'
import MomentsPage from './pages/Moments'
import Activity from './Activity'
import { Avatar } from './Avatar'

export type PageId = 'home' | 'live' | 'recordings' | 'moments' | 'queue' | 'editor' | 'posts' | 'system' | 'settings'

const NAV: { id: PageId; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Início', icon: Home },
  { id: 'live', label: 'Ao vivo', icon: Radio },
  { id: 'recordings', label: 'Gravações', icon: Library },
  { id: 'moments', label: 'Momentos', icon: Sparkles },
  { id: 'queue', label: 'Fila de aprovação', icon: Inbox },
  { id: 'editor', label: 'Editor', icon: Scissors },
  { id: 'posts', label: 'Postagens', icon: Send },
  { id: 'system', label: 'Sistema', icon: Cpu },
  { id: 'settings', label: 'Ajustes', icon: Cog }
]

const AI_LABEL = { gemini: 'Gemini grátis', local: 'IA local', openai: 'OpenAI', claude: 'Claude', codex: 'ChatGPT (Codex)' } as const

export default function App() {
  const state = useAppState()
  const [page, setPage] = useState<PageId>('home')
  const { settings, disk, jobs, channels } = state
  const recordingCount = channels.filter((c) => c.recording).length
  const running = jobs.filter((j) => j.status === 'running').length + recordingCount
  // Ao vivo primeiro no trilho
  const railChannels = [...channels].sort((a, b) => Number(!!b.recording) - Number(!!a.recording) || Number(!!b.live) - Number(!!a.live))

  return (
    <div className="flex h-full overflow-hidden bg-bg">
      {/* Trilho: canais vigiados (avatares com anel quando ao vivo) */}
      <aside className="drag flex w-[76px] shrink-0 flex-col items-center gap-3 bg-gradient-to-b from-panel-2 via-panel to-bg pb-4 pt-3">
        <div className="no-drag grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-accent to-gold text-white shadow-lg" title="Clipador KTY">
          <Clapperboard size={22} />
        </div>
        <div className="my-1 h-px w-8 bg-line" />
        <div className="no-drag flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto py-1">
          {railChannels.map((c) => (
            <button key={c.id} type="button" onClick={() => setPage('live')}>
              <Avatar channel={c} size={46} />
            </button>
          ))}
          {channels.length === 0 && <p className="px-1 text-center text-[10px] leading-tight text-muted">Canais aparecem aqui</p>}
          <button
            type="button"
            onClick={() => setPage('live')}
            title="Adicionar canal"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-gold to-accent text-white shadow transition hover:scale-105"
          >
            <Plus size={20} />
          </button>
        </div>
      </aside>

      {/* Menu lateral */}
      <nav className="flex w-60 shrink-0 flex-col border-r border-line/60 bg-panel/70">
        <div className="drag h-10 shrink-0" />
        <div className="px-4 pb-3">
          <h1 className="text-lg font-semibold">Clipador KTY</h1>
          <p className="text-xs text-muted">Clipes automáticos de lives</p>
        </div>
        <ul className="flex-1 space-y-1 px-3">
          {NAV.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => setPage(id)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition',
                  page === id ? 'bg-card text-text shadow-inner' : 'text-muted hover:bg-card/50 hover:text-text'
                )}
              >
                <Icon size={17} />
                {label}
              </button>
            </li>
          ))}
        </ul>

        {/* Medidor (vira o gráfico de hype da live na fase 1) */}
        <div className="mx-3 mb-3 flex h-14 items-end justify-center gap-[3px] rounded-xl bg-gradient-to-t from-accent/20 to-transparent px-3 pb-2">
          {Array.from({ length: 28 }, (_, i) => (
            <span key={i} className="w-[3px] rounded-full bg-accent-2/70" style={{ height: `${8 + ((i * 37) % 23)}px`, opacity: running ? 1 : 0.35 }} />
          ))}
        </div>

        {/* Barra de status */}
        <div className="space-y-1.5 border-t border-line/60 px-4 py-3 text-xs text-muted">
          <div className="flex items-center gap-2">
            <Film size={13} /> Gravador:{' '}
            {recordingCount ? <span className="font-medium text-live">gravando {recordingCount}</span> : <span className="text-text">{channels.length ? 'vigiando' : 'parado'}</span>}
          </div>
          <div className="flex items-center gap-2">
            <Sparkles size={13} /> IA: <span className="text-text">{settings ? AI_LABEL[settings.ai.provider] : '…'}</span>
          </div>
          <div className={cx('flex items-center gap-2', disk?.low && 'text-warn')}>
            <HardDrive size={13} /> Disco: <span className={disk?.low ? 'text-warn' : 'text-text'}>{disk ? `${disk.freeGb} GB livres` : '…'}</span>
          </div>
        </div>
      </nav>

      {/* Conteúdo */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="drag flex h-10 shrink-0 items-center justify-center pr-36">
          <label className="no-drag flex w-full max-w-md items-center gap-2 rounded-lg border border-line/70 bg-panel/80 px-3 py-1 text-sm text-muted">
            <Search size={14} />
            <input disabled placeholder="Buscar momento (fase 2): ex. “quando ele bateu o carro”" className="w-full bg-transparent outline-none placeholder:text-muted/70" />
          </label>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-4">
          {page === 'home' && <HomePage state={state} go={setPage} />}
          {page === 'settings' && <SettingsPage state={state} />}
          {page === 'system' && <SystemPage state={state} />}
          {page === 'live' && <LivePage state={state} />}
          {page === 'recordings' && <RecordingsPage state={state} />}
          {page === 'moments' && <MomentsPage state={state} />}
          {page === 'queue' && <SoonPage title="Fila de aprovação" phase={1} text="Clipes prontos esperando você aprovar ou descartar." />}
          {page === 'editor' && <SoonPage title="Editor" phase={1} text="Ajustar início e fim, layout vertical, legenda e título." />}
          {page === 'posts' && <SoonPage title="Postagens" phase={2} text="Agendar e postar no YouTube e no TikTok, com limite diário." />}
        </div>
      </main>

      {/* Atividade em tempo real */}
      <Activity state={state} />
    </div>
  )
}
