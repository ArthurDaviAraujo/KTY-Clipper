import { useEffect, useRef, useState } from 'react'
import { Activity, Check, Inbox, PanelRight, PanelRightClose, PanelRightOpen, Radio, Sparkles, X } from 'lucide-react'
import type { AssistantState } from '../../shared/types'
import type { AppState } from './state'
import type { Go } from './App'
import { AssistantChat } from './Assistant'
import { ActivityList } from './ActivityMenu'
import { Avatar } from './Avatar'
import { BrandIcon } from './BrandIcon'
import { PLATFORM_NAME, groupChannels } from '../../shared/channels'
import { ClipCover } from './pages/Clips'
import { Toggle, cx } from './ui'

/** O que pode aparecer na barra lateral (a pessoa escolhe; com mais de um, a barra ganha abas). */
export type SidePanelId = 'assistant' | 'live' | 'review' | 'activity'

export const SIDE_PANELS: { id: SidePanelId; label: string; hint: string; icon: typeof Sparkles }[] = [
  { id: 'assistant', label: 'KaTY', hint: 'A IA do Clipador KTY', icon: Sparkles },
  { id: 'live', label: 'Ao vivo', hint: 'Quem está ao vivo e gravando', icon: Radio },
  { id: 'review', label: 'Para revisar', hint: 'Aprovar ou descartar sem sair da tela', icon: Inbox },
  { id: 'activity', label: 'Atividade', hint: 'Tarefas rodando e avisos', icon: Activity }
]

interface SidePrefs {
  /** Barra lateral ligada (no menu do topo) */
  open: boolean
  /** Recolhida: só uma faixa fina com os ícones; o mesmo botão expande de novo */
  collapsed: boolean
  panels: SidePanelId[]
  tab: SidePanelId
}

const KEY = 'clipador:barra-lateral'

function load(): SidePrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<SidePrefs>
      const panels = (p.panels ?? []).filter((x): x is SidePanelId => SIDE_PANELS.some((s) => s.id === x))
      return { open: !!p.open, collapsed: !!p.collapsed, panels: panels.length ? panels : ['assistant'], tab: p.tab && panels.includes(p.tab) ? p.tab : (panels[0] ?? 'assistant') }
    }
    // Antes só existia a barra do assistente
    return { open: localStorage.getItem('assistantDock') === '1', collapsed: false, panels: ['assistant'], tab: 'assistant' }
  } catch {
    return { open: false, collapsed: false, panels: ['assistant'], tab: 'assistant' }
  }
}

/** Preferências da barra lateral, lembradas neste PC. */
export function useSidePrefs() {
  const [p, setP] = useState<SidePrefs>(load)
  // Sempre a partir do estado mais novo (cliques seguidos não se perdem)
  const update = (f: (prev: SidePrefs) => SidePrefs) =>
    setP((prev) => {
      const next = f(prev)
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // sem armazenamento: só não lembra
      }
      return next
    })
  const withPanel = (panels: SidePanelId[], id: SidePanelId) => SIDE_PANELS.map((s) => s.id).filter((x) => x === id || panels.includes(x))
  return {
    ...p,
    setOpen: (open: boolean) => update((q) => ({ ...q, open, collapsed: open ? false : q.collapsed })),
    setCollapsed: (collapsed: boolean) => update((q) => ({ ...q, collapsed })),
    setTab: (tab: SidePanelId) => update((q) => ({ ...q, tab, open: true, collapsed: false })),
    /** Liga ou desliga um painel (sempre fica pelo menos um) */
    togglePanel: (id: SidePanelId) =>
      update((q) => {
        const has = q.panels.includes(id)
        const panels = has ? q.panels.filter((x) => x !== id) : withPanel(q.panels, id)
        if (!panels.length) return q
        return { ...q, panels, tab: has && q.tab === id ? panels[0] : has ? q.tab : id, open: true, collapsed: false }
      }),
    /** Abre a barra já num painel (ex.: "Abrir na barra lateral" na aba Assistente) */
    show: (id: SidePanelId) => update((q) => ({ open: true, collapsed: false, panels: q.panels.includes(id) ? q.panels : withPanel(q.panels, id), tab: id }))
  }
}
export type SidePrefsApi = ReturnType<typeof useSidePrefs>

/** Botão do topo com as opções da barra lateral: mostrar ou esconder e o que aparece nela. */
export function SidePanelMenu({ prefs, available, badge }: { prefs: SidePrefsApi; available: SidePanelId[]; badge?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const opts = SIDE_PANELS.filter((s) => available.includes(s.id))
  return (
    <div ref={ref} className="no-drag relative">
      <button
        type="button"
        title="Barra lateral"
        aria-label="Opções da barra lateral"
        onClick={() => setOpen(!open)}
        className={cx(
          'relative grid size-8 place-items-center rounded-full transition',
          open || prefs.open ? 'bg-white/[0.1] text-text' : 'text-muted hover:bg-white/[0.07] hover:text-text'
        )}
      >
        <PanelRight size={16} />
        {badge && !prefs.open && <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-gold ring-2 ring-[#1b1726]" />}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-[300px] overflow-hidden rounded-2xl border border-white/10 bg-panel-2/95 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">Barra lateral</p>
              <p className="text-[11px] text-muted">Fica à direita, em qualquer tela.</p>
            </div>
            <Toggle label="Mostrar a barra lateral" checked={prefs.open} onChange={(v) => prefs.setOpen(v)} />
          </div>
          <div className="p-2">
            <p className="px-2 pb-1 pt-1 text-[11px] text-muted">O que aparece nela</p>
            {opts.map((s) => {
              const on = prefs.panels.includes(s.id)
              const Icon = s.icon
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => prefs.togglePanel(s.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/[0.06]"
                >
                  <span className={cx('grid size-7 shrink-0 place-items-center rounded-lg', on ? 'bg-accent/20 text-accent-2' : 'bg-white/[0.06] text-muted')}>
                    <Icon size={14} className={s.id === 'assistant' ? 'text-ai' : undefined} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px]">{s.label}</span>
                    <span className="block text-[11px] text-muted">{s.hint}</span>
                  </span>
                  <span className={cx('grid size-5 shrink-0 place-items-center rounded-md border', on ? 'border-accent bg-accent text-white' : 'border-white/20')}>
                    {on && <Check size={12} />}
                  </span>
                </button>
              )
            })}
            <p className="px-2 pb-1 pt-2 text-[11px] text-muted">Com mais de um marcado, a barra ganha abas no topo.</p>
          </div>
        </div>
      )}
    </div>
  )
}

/** A barra lateral da direita, com o painel escolhido (ou abas, se houver mais de um). */
export function SidePanel({
  state,
  assistant,
  prefs,
  panels,
  go,
  openAssistantTab
}: {
  state: AppState
  assistant: AssistantState
  prefs: SidePrefsApi
  /** Painéis que valem nesta tela (na aba Assistente o assistente sai da barra) */
  panels: SidePanelId[]
  go: Go
  openAssistantTab: () => void
}) {
  const tab = panels.includes(prefs.tab) ? prefs.tab : panels[0]
  const info = SIDE_PANELS.find((s) => s.id === tab)!
  const toReview = state.clips.filter((c) => c.review === 'pending' && c.status === 'ready').length
  const onAir = state.channels.filter((c) => c.live || c.recording).length
  const running = state.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length
  const count: Record<SidePanelId, number> = { assistant: 0, live: onAir, review: toReview, activity: running }
  // Recolhida: faixa fina; o botão de recolher/expandir fica no mesmo lugar (canto de cima, à direita)
  if (prefs.collapsed)
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-l border-white/[0.07] bg-[#1c1828]/80 py-2 backdrop-blur-xl">
        <button type="button" title="Expandir a barra lateral" aria-label="Expandir a barra lateral" onClick={() => prefs.setCollapsed(false)} className="rounded-full p-1.5 text-muted hover:bg-white/[0.07] hover:text-text">
          <PanelRightOpen size={15} />
        </button>
        <span className="my-1 h-px w-6 bg-white/[0.07]" />
        {panels.map((id) => {
          const s = SIDE_PANELS.find((x) => x.id === id)!
          const Icon = s.icon
          return (
            <button
              key={id}
              type="button"
              title={s.label}
              onClick={() => prefs.setTab(id)}
              className="relative grid size-8 place-items-center rounded-full text-muted transition hover:bg-white/[0.07] hover:text-text"
            >
              <Icon size={15} className={id === 'assistant' ? 'text-ai' : undefined} />
              {count[id] > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-accent px-0.5 text-[9px] font-semibold tabular-nums text-white">{count[id]}</span>
              )}
            </button>
          )
        })}
      </aside>
    )
  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-white/[0.07] bg-[#1c1828]/80 backdrop-blur-xl">
      <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.07] px-3 py-2">
        {panels.length > 1 ? (
          <div className="flex min-w-0 flex-1 gap-1">
            {panels.map((id) => {
              const s = SIDE_PANELS.find((x) => x.id === id)!
              const Icon = s.icon
              return (
                <button
                  key={id}
                  type="button"
                  title={s.label}
                  onClick={() => prefs.setTab(id)}
                  className={cx(
                    'relative flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition',
                    tab === id ? 'bg-white/[0.1] text-text' : 'text-muted hover:bg-white/[0.06] hover:text-text'
                  )}
                >
                  <Icon size={13} className={id === 'assistant' ? 'text-ai' : undefined} />
                  {tab === id && s.label}
                  {tab !== id && count[id] > 0 && <span className="text-[10px] tabular-nums">{count[id]}</span>}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="flex min-w-0 flex-1 items-center gap-2 px-1 text-[13px] font-medium">
            <info.icon size={14} className={tab === 'assistant' ? 'text-ai' : 'text-muted'} /> {info.label}
          </p>
        )}
        <button type="button" title="Recolher a barra lateral" aria-label="Recolher a barra lateral" onClick={() => prefs.setCollapsed(true)} className="rounded-full p-1.5 text-muted hover:bg-white/[0.07] hover:text-text">
          <PanelRightClose size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'assistant' && <AssistantChat compact slim state={assistant} onExpand={openAssistantTab} onSetup={() => go('settings', { settings: 'ia' })} />}
        {tab === 'live' && <LivePanel state={state} go={go} />}
        {tab === 'review' && <ReviewPanel state={state} go={go} />}
        {tab === 'activity' && <ActivityList state={state} className="h-full overflow-y-auto p-3" />}
      </div>
    </aside>
  )
}

const since = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

function LivePanel({ state, go }: { state: AppState; go: Go }) {
  const list = state.channels.filter((c) => c.live || c.recording).sort((a, b) => Number(!!b.recording) - Number(!!a.recording))
  const watching = state.channels.filter((c) => c.enabled).length
  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-3">
      {list.length === 0 && (
        <div className="px-1 py-6 text-center">
          <p className="text-[13px] text-muted">Ninguém ao vivo agora.</p>
          <p className="mt-1 text-[11px] text-muted">
            {watching ? `Vigiando ${watching} canal(is): avisa quando entrarem ao vivo (grava os que estão com "Gravar" ligado).` : 'Nenhum canal vigiado.'}
          </p>
          <button type="button" onClick={() => go('channels', { channels: 'all' })} className="mt-3 text-[12px] font-medium text-accent-2 hover:underline">
            Ver os canais
          </button>
        </div>
      )}
      {/* Mesmo streamer em várias plataformas: uma linha só, com o público de cada uma */}
      {groupChannels(list)
        .sort((a, b) => Number(b.some((c) => c.recording)) - Number(a.some((c) => c.recording)))
        .map((g) => {
          const main = g.find((c) => c.recording) ?? g.find((c) => c.live) ?? g[0]
          const rec = g.find((c) => c.recording)?.recording ?? null
          const startedAt = Math.min(...g.map((c) => c.live?.startedAt ?? Date.now()))
          const pic = g.find((c) => c.avatarUrl) ?? main
          return (
            <div key={g[0].id} className="flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-white/[0.05]">
              <button type="button" onClick={() => go('channels', { channels: g[0].id })} className="shrink-0">
                <Avatar channel={{ ...pic, live: main.live, recording: rec }} size={30} badge={g.length === 1} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                  {main.displayName}
                  {rec ? (
                    <span className="live-ring rounded-full bg-live px-1.5 text-[9px] font-bold uppercase tracking-wide text-white">gravando</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-live/15 px-1.5 text-[9px] font-bold uppercase tracking-wide text-live">
                      <span className="live-dot" /> ao vivo
                    </span>
                  )}
                </p>
                <p className="truncate text-[11px] text-muted">
                  {main.live?.game ?? 'sem categoria'} · há {since(startedAt)}
                </p>
                <p className="flex flex-wrap items-center gap-x-2.5 text-[11px] text-muted">
                  {g.map((c) => (
                    <span key={c.id} className="inline-flex items-center gap-1" title={`${PLATFORM_NAME[c.platform]}${c.recording ? ' · gravando' : ''}`}>
                      <BrandIcon brand={c.platform} size={10} />
                      {c.live?.viewers != null ? c.live.viewers.toLocaleString('pt-BR') : '–'}
                      {c.recording && <span className="size-1.5 rounded-full bg-live" />}
                    </span>
                  ))}
                  <span>assistindo</span>
                </p>
              </div>
              {rec && (
                <button
                  type="button"
                  onClick={() => go('clips', { liveId: rec.liveId, tab: 'review' })}
                  className="shrink-0 rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] hover:bg-white/[0.12]"
                >
                  Clipes
                </button>
              )}
            </div>
          )
        })}
    </div>
  )
}

function ReviewPanel({ state, go }: { state: AppState; go: Go }) {
  const list = state.clips.filter((c) => c.review === 'pending' && c.status === 'ready').sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-3">
      {list.length === 0 && (
        <div className="px-1 py-6 text-center">
          <p className="text-[13px] text-muted">Tudo revisado.</p>
          <p className="mt-1 text-[11px] text-muted">Os clipes novos aparecem aqui assim que ficarem prontos.</p>
        </div>
      )}
      {list.map((c) => (
        <div key={c.id} className="flex items-center gap-2.5 rounded-xl p-1.5 hover:bg-white/[0.05]">
          <button type="button" title="Abrir em Clipes" onClick={() => go('clips', { tab: 'review', liveId: 'all' })} className="shrink-0 overflow-hidden rounded-lg">
            <ClipCover clip={c} className="w-11" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[12.5px] font-medium leading-snug">{c.title}</p>
            <p className="truncate text-[11px] text-muted">
              {c.score != null ? `nota ${c.score} · ` : ''}
              {c.channelName}
              {c.game ? ` · ${c.game}` : ''}
            </p>
          </div>
          <button
            type="button"
            title="Aprovar"
            onClick={() => void window.api.reviewClip(c.id, 'approved')}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-white hover:brightness-110"
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            title="Descartar"
            onClick={() => void window.api.reviewClip(c.id, 'rejected')}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.08] text-muted hover:text-err"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
