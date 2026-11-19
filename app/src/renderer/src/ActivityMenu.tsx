import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Bell, CheckCircle2, Info, Loader2, RotateCcw, X, XCircle } from 'lucide-react'
import type { LogEntry } from '../../shared/types'
import type { AppState } from './state'
import { Progress, cx, timeAgo } from './ui'

/** Mensagens repetidas seguidas viram uma só (ex.: "58 clipes da comunidade encontrados" a cada detecção). */
function tidy(logs: LogEntry[]): LogEntry[] {
  const out: LogEntry[] = []
  for (const l of [...logs].reverse()) {
    if (out.some((x) => x.message === l.message)) continue
    out.push(l)
    if (out.length >= 40) break
  }
  return out
}

const LAST_SEEN = 'clipador:avisos-vistos'

/** Botão do topo com as tarefas em andamento e os avisos recentes; abre um painel por cima da tela. */
export default function ActivityMenu({ state }: { state: AppState }) {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(LAST_SEEN)) || 0
    } catch {
      return 0
    }
  })
  const ref = useRef<HTMLDivElement>(null)
  const active = state.jobs.filter((j) => j.status === 'running' || j.status === 'queued')
  const unread = state.logs.some((l) => l.time > seen && l.level !== 'info')

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

  const toggle = () => {
    if (!open) {
      const now = Date.now()
      setSeen(now)
      try {
        localStorage.setItem(LAST_SEEN, String(now))
      } catch {
        // sem armazenamento: o ponto vermelho só volta a aparecer
      }
    }
    setOpen(!open)
  }

  return (
    <div ref={ref} className="no-drag relative">
      <button
        type="button"
        onClick={toggle}
        title={active.length ? `${active.length} tarefa(s) em andamento` : 'Atividade e avisos'}
        className={cx('relative grid size-8 place-items-center rounded-full transition', open ? 'bg-white/[0.12] text-text' : 'text-muted hover:bg-white/[0.07] hover:text-text')}
      >
        {active.length ? <Loader2 size={17} className="animate-spin text-accent-2" /> : <Bell size={17} />}
        {active.length > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">{active.length}</span>
        ) : (
          unread && !open && <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-err ring-2 ring-[#1b1726]" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-40 flex max-h-[75vh] w-[420px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-panel-2/95 shadow-2xl backdrop-blur-xl">
          <ActivityList state={state} className="overflow-y-auto p-3" />
        </div>
      )}
    </div>
  )
}

/** Tarefas em andamento, falhas e avisos recentes (no menu do sino e na barra lateral). */
export function ActivityList({ state, className }: { state: AppState; className?: string }) {
  const active = state.jobs.filter((j) => j.status === 'running' || j.status === 'queued')
  const failed = state.jobs.filter((j) => j.status === 'failed' && j.finishedAt && j.finishedAt > Date.now() - 24 * 3600_000)
  const notices = useMemo(() => tidy(state.logs), [state.logs])
  return (
    <div className={cx('space-y-2', className)}>
      <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Em andamento</p>
      {active.length === 0 && <p className="px-1 pb-1 text-sm text-muted">Nada rodando agora.</p>}
      {active.map((j) => (
        <div key={j.id} className="rounded-xl bg-card/60 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm">
            <Loader2 size={14} className={j.status === 'running' ? 'animate-spin text-accent-2' : 'text-muted'} />
            <span className="min-w-0 flex-1 truncate">{j.label}</span>
            <span className="text-xs tabular-nums text-muted">{j.status === 'running' ? `${Math.round(j.progress * 100)}%` : 'na fila'}</span>
            <button type="button" title="Cancelar" onClick={() => void window.api.cancelJob(j.id)} className="text-muted hover:text-err">
              <X size={14} />
            </button>
          </div>
          <Progress value={j.status === 'running' ? j.progress : 0} />
        </div>
      ))}
      {failed.map((j) => (
        <div key={j.id} className="flex items-start gap-2 rounded-xl bg-err/10 p-3 text-sm">
          <XCircle size={14} className="mt-0.5 shrink-0 text-err" />
          <div className="min-w-0 flex-1">
            <p className="truncate">{j.label}</p>
            <p className="line-clamp-2 text-xs text-err">{j.error}</p>
          </div>
          <button type="button" title="Tentar de novo" onClick={() => void window.api.retryJob(j.id)} className="text-muted hover:text-accent-2">
            <RotateCcw size={14} />
          </button>
        </div>
      ))}

      <p className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">Avisos</p>
      {notices.length === 0 && <p className="px-1 text-sm text-muted">Sem avisos.</p>}
      {notices.map((l) => (
        <div key={l.id} className="flex gap-2 rounded-xl px-2 py-1.5 text-xs hover:bg-card/40">
          {l.level === 'error' ? (
            <XCircle size={14} className="mt-0.5 shrink-0 text-err" />
          ) : l.level === 'warn' ? (
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
          ) : /pronto|conclu|funcionam/i.test(l.message) ? (
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
          ) : (
            <Info size={14} className="mt-0.5 shrink-0 text-muted" />
          )}
          <div className="min-w-0">
            <p className="break-words text-text/90">{l.message}</p>
            <p className="text-[10px] text-muted">{timeAgo(l.time)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
