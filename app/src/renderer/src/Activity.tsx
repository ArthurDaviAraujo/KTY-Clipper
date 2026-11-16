import { useEffect, useRef } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react'
import type { AppState } from './state'
import { Progress, timeAgo } from './ui'

export default function Activity({ state }: { state: AppState }) {
  const { jobs, logs } = state
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued')
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Sem retorno: no Chromium atual scrollIntoView devolve uma Promise, que o React trataria como função de limpeza
    void endRef.current?.scrollIntoView({ block: 'end' })
  }, [logs.length])

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line/60 bg-panel-2/70">
      <div className="drag h-10 shrink-0" />
      <div className="px-4 pb-2">
        <h2 className="text-sm font-semibold">Atividade</h2>
        <p className="text-xs text-muted">{active.length ? `${active.length} tarefa(s) em andamento` : 'Nenhuma tarefa em andamento'}</p>
      </div>

      {active.length > 0 && (
        <div className="space-y-2 px-3 pb-3">
          {active.slice(0, 5).map((j) => (
            <div key={j.id} className="rounded-xl bg-card/70 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm">
                <Loader2 size={14} className={j.status === 'running' ? 'animate-spin text-accent-2' : 'text-muted'} />
                <span className="truncate">{j.label}</span>
              </div>
              <Progress value={j.progress} />
            </div>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-4">
        {logs.length === 0 && <p className="px-1 text-xs text-muted">Os eventos aparecem aqui: gravando, momento encontrado, clipe pronto, postado.</p>}
        {logs.slice(-80).map((l) => (
          <div key={l.id} className="flex gap-2 rounded-xl bg-card/40 px-3 py-2 text-xs">
            {l.level === 'error' ? (
              <XCircle size={14} className="mt-0.5 shrink-0 text-err" />
            ) : l.level === 'warn' ? (
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
            ) : /funcionam|pronto|conclu/i.test(l.message) ? (
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
            ) : (
              <Info size={14} className="mt-0.5 shrink-0 text-accent-2" />
            )}
            <div className="min-w-0">
              <p className="break-words text-text/90">{l.message}</p>
              <p className="mt-0.5 text-[10px] text-muted">
                {l.source} · {timeAgo(l.time)}
              </p>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </aside>
  )
}
