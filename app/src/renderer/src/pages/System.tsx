import { CheckCircle2, FolderOpen, Play, RefreshCw, RotateCcw, Trash2, X, XCircle } from 'lucide-react'
import { FAMILY_LABEL } from '../../../shared/encoders'
import type { EncoderFamily, JobStatus } from '../../../shared/types'
import type { AppState } from '../state'
import { Badge, Button, Card, Progress, Section, timeAgo } from '../ui'

const STATUS: Record<JobStatus, { label: string; tone: 'ok' | 'warn' | 'err' | 'muted' | 'accent' }> = {
  queued: { label: 'na fila', tone: 'muted' },
  running: { label: 'rodando', tone: 'accent' },
  done: { label: 'concluída', tone: 'ok' },
  failed: { label: 'falhou', tone: 'err' },
  canceled: { label: 'cancelada', tone: 'muted' }
}

const FAMILIES: EncoderFamily[] = ['amd', 'nvidia', 'intel', 'windows', 'cpu']

/** Programas, codificadores, fila de tarefas, registro técnico e pasta de dados (aba Sistema dos Ajustes). */
export function SystemPanel({ state }: { state: AppState }) {
  const { tools, hardware, jobs, info, refreshTools } = state
  const testing = jobs.some((j) => j.type === 'diagnostico:codificadores' && (j.status === 'running' || j.status === 'queued'))

  return (
    <div className="space-y-8">
      <Section
        title="Programas"
        action={
          <Button variant="ghost" onClick={() => void refreshTools()}>
            <RefreshCw size={14} /> Procurar de novo
          </Button>
        }
      >
        <div className="space-y-2">
          {tools.map((t) => (
            <Card key={t.id} className="flex items-center gap-3">
              {t.path ? <CheckCircle2 size={18} className="shrink-0 text-ok" /> : <XCircle size={18} className={t.required ? 'shrink-0 text-err' : 'shrink-0 text-muted'} />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t.label}</span>
                  {t.version && <span className="text-xs text-muted">{t.version}</span>}
                </div>
                <p className="text-xs text-muted">{t.purpose}</p>
                <p className="truncate text-[11px] text-muted/80" title={t.path ?? undefined}>
                  {t.path ?? 'Não encontrado. Coloque o programa na pasta "programas" do projeto.'}
                </p>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        title="Codificadores de vídeo"
        action={
          <Button onClick={() => void window.api.testEncoders()} disabled={testing}>
            <Play size={14} /> {testing ? 'Testando…' : 'Testar de novo'}
          </Button>
        }
      >
        <p className="-mt-1 text-xs text-muted">
          Cada um é testado com 0,1 s de vídeo real. Só os que funcionam aparecem em Ajustes.
          {hardware?.encodersTestedAt ? ` Último teste: ${timeAgo(hardware.encodersTestedAt)}.` : ''}
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {FAMILIES.map((fam) => {
            const list = hardware?.encoders.filter((e) => e.family === fam) ?? []
            return (
              <Card key={fam}>
                <p className="mb-2 text-sm font-semibold">{FAMILY_LABEL[fam]}</p>
                {list.length === 0 && <p className="text-xs text-muted">Ainda não testado.</p>}
                <ul className="space-y-1">
                  {list.map((e) => (
                    <li key={e.name} className="flex items-center gap-2 text-xs" title={e.error}>
                      {e.works ? <CheckCircle2 size={13} className="text-ok" /> : <XCircle size={13} className="text-muted" />}
                      <span className={e.works ? '' : 'text-muted'}>{e.codec.toUpperCase()}</span>
                      <span className="text-muted">{e.name}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )
          })}
          <Card>
            <p className="mb-2 text-sm font-semibold">Placas detectadas</p>
            <ul className="space-y-1 text-xs">
              {hardware?.gpus.map((g) => (
                <li key={g.name}>
                  {g.name} <span className="text-muted">· driver {g.driver ?? '?'}</span>
                </li>
              ))}
              {!hardware?.gpus.length && <li className="text-muted">Nenhuma.</li>}
            </ul>
          </Card>
        </div>
      </Section>

      <Section
        title="Fila de tarefas"
        action={
          <Button variant="ghost" onClick={() => void state.clearFinishedJobs()}>
            <Trash2 size={14} /> Limpar concluídas
          </Button>
        }
      >
        <p className="-mt-1 text-xs text-muted">Fica salva no banco: se o app fechar no meio, as tarefas continuam ao abrir de novo.</p>
        <div className="space-y-2">
          {jobs.length === 0 && <p className="text-sm text-muted">Nenhuma tarefa ainda.</p>}
          {jobs.slice(0, 30).map((j) => (
            <Card key={j.id} className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-xs tabular-nums text-muted">#{j.id}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{j.label}</span>
                <Badge tone={STATUS[j.status].tone}>{STATUS[j.status].label}</Badge>
                {(j.status === 'running' || j.status === 'queued') && (
                  <button type="button" title="Cancelar" onClick={() => void window.api.cancelJob(j.id)} className="text-muted hover:text-err">
                    <X size={16} />
                  </button>
                )}
                {(j.status === 'failed' || j.status === 'canceled') && (
                  <button type="button" title="Tentar de novo" onClick={() => void window.api.retryJob(j.id)} className="text-muted hover:text-accent-2">
                    <RotateCcw size={16} />
                  </button>
                )}
              </div>
              {j.status === 'running' && <Progress value={j.progress} />}
              {j.error && <p className="text-xs text-err">{j.error}</p>}
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Registro técnico">
        <Card className="max-h-80 space-y-1 overflow-y-auto font-mono text-[11px]">
          {state.logs.length === 0 && <p className="text-muted">Vazio.</p>}
          {[...state.logs].reverse().map((l) => (
            <p key={l.id} className={l.level === 'error' ? 'text-err' : l.level === 'warn' ? 'text-warn' : 'text-text/80'}>
              <span className="text-muted">{new Date(l.time).toLocaleTimeString('pt-BR')}</span> [{l.source}] {l.message}
            </p>
          ))}
        </Card>
      </Section>

      {info && (
        <Section title="Dados do app">
          <Card className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Pasta de dados</p>
              <p className="truncate text-xs text-muted">{info.dataDir}</p>
            </div>
            <Button variant="ghost" onClick={() => void window.api.openPath(info.dataDir)}>
              <FolderOpen size={14} /> Abrir
            </Button>
          </Card>
        </Section>
      )}
    </div>
  )
}
