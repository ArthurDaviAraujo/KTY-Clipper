import { EventEmitter } from 'events'
import type { Db } from './db'
import type { Job, JobResource, JobStatus } from '../shared/types'

export interface JobContext {
  job: Job
  /** Informa o progresso (0 a 1) */
  progress(value: number): void
  /** Cancelado pelo usuário ou pelo encerramento do app */
  signal: AbortSignal
}

export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<unknown>

interface HandlerDef {
  resource: JobResource
  handler: JobHandler
  /** Tarefas com a mesma chave nunca rodam juntas (ex.: duas detecções da mesma live) */
  key?: (payload: unknown) => string | null
}

export interface EnqueueOptions {
  priority?: number
  maxAttempts?: number
}

export type ResourceLimits = Record<JobResource, number>

interface Row {
  id: number
  type: string
  label: string
  resource: string
  status: string
  progress: number
  attempts: number
  max_attempts: number
  payload: string
  result: string | null
  error: string | null
  created_at: number
  started_at: number | null
  finished_at: number | null
}

const parse = (s: string | null): unknown => {
  if (s == null) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function toJob(r: Row): Job {
  return {
    id: r.id,
    type: r.type,
    label: r.label,
    resource: r.resource as JobResource,
    status: r.status as JobStatus,
    progress: r.progress,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    payload: parse(r.payload),
    result: parse(r.result),
    error: r.error,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at
  }
}

/**
 * Fila de tarefas persistente.
 * - Tudo fica no SQLite: se o app fechar no meio, as tarefas "running" voltam para a fila ao abrir.
 * - Cada tipo de tarefa declara o recurso que usa (gpu, cpu, io, net); o limite por recurso evita travar o PC.
 * - Falhas tentam de novo com espera crescente, até `maxAttempts`.
 */
export class JobQueue extends EventEmitter {
  private handlers = new Map<string, HandlerDef>()
  private running = new Map<number, { ctrl: AbortController; resource: JobResource; key: string | null }>()
  private retryTimers = new Set<NodeJS.Timeout>()
  private started = false
  private stopping = false

  constructor(
    private db: Db,
    private limits: () => ResourceLimits,
    private now: () => number = Date.now,
    private retryDelayMs: (attempt: number) => number = (a) => Math.min(60_000, 2_000 * 2 ** (a - 1))
  ) {
    super()
  }

  /**
   * `key`: tarefas do mesmo tipo com a mesma chave esperam a anterior terminar
   * (ex.: a detecção "live encerrada" não começa enquanto a "gravação em andamento" da mesma live roda).
   */
  register(type: string, resource: JobResource, handler: JobHandler, key?: (payload: unknown) => string | null): void {
    this.handlers.set(type, { resource, handler, key })
  }

  enqueue(type: string, label: string, payload: unknown = null, opts: EnqueueOptions = {}): Job {
    const def = this.handlers.get(type)
    if (!def) throw new Error(`Tipo de tarefa desconhecido: ${type}`)
    const r = this.db
      .prepare(
        `INSERT INTO jobs(type, label, resource, priority, max_attempts, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
      )
      .get(type, label, def.resource, opts.priority ?? 0, opts.maxAttempts ?? 3, JSON.stringify(payload ?? null), this.now()) as unknown as Row
    const job = toJob(r)
    this.emit('job', job)
    this.pump()
    return job
  }

  /** Recupera tarefas interrompidas e começa a processar. */
  start(): void {
    if (this.started) return
    this.started = true
    this.stopping = false
    const n = this.db.prepare(`UPDATE jobs SET status = 'queued', progress = 0 WHERE status = 'running'`).run().changes
    if (n) this.emit('resumed', Number(n))
    this.pump()
  }

  /** Para de pegar tarefas novas e cancela as que estão rodando (elas voltam para a fila na próxima abertura). */
  async stop(): Promise<void> {
    this.stopping = true
    for (const t of this.retryTimers) clearTimeout(t)
    this.retryTimers.clear()
    for (const r of this.running.values()) r.ctrl.abort(new Error('app-closing'))
    const deadline = this.now() + 5000
    while (this.running.size && this.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    this.started = false
  }

  get(id: number): Job | null {
    const r = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined
    return r ? toJob(r) : null
  }

  list(limit = 200): Job[] {
    return (this.db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit) as unknown as Row[]).map(toJob)
  }

  cancel(id: number): void {
    const run = this.running.get(id)
    if (run) {
      run.ctrl.abort(new Error('canceled'))
      return
    }
    this.db.prepare(`UPDATE jobs SET status = 'canceled', finished_at = ? WHERE id = ? AND status = 'queued'`).run(this.now(), id)
    this.emitJob(id)
  }

  retry(id: number): void {
    this.db
      .prepare(`UPDATE jobs SET status = 'queued', attempts = 0, error = NULL, progress = 0, finished_at = NULL WHERE id = ? AND status IN ('failed', 'canceled')`)
      .run(id)
    this.emitJob(id)
    this.pump()
  }

  clearFinished(): void {
    this.db.prepare(`DELETE FROM jobs WHERE status IN ('done', 'canceled')`).run()
  }

  private emitJob(id: number): void {
    const j = this.get(id)
    if (j) this.emit('job', j)
  }

  /** Tarefas rodando agora, de qualquer recurso. */
  runningTotal(): number {
    return this.running.size
  }

  /** Tarefas rodando agora que usam o recurso (ex.: quantas detecções dividem o processador). */
  runningBy(resource: JobResource): number {
    let n = 0
    for (const r of this.running.values()) if (r.resource === resource) n++
    return n
  }

  /** Inicia todas as tarefas que cabem nos limites de cada recurso. */
  private pump(): void {
    if (!this.started || this.stopping) return
    const limits = this.limits()
    const queued = this.db
      .prepare(`SELECT * FROM jobs WHERE status = 'queued' ORDER BY priority DESC, id LIMIT 500`)
      .all() as unknown as Row[]
    const used: Record<string, number> = {}
    const busyKeys = new Set([...this.running.values()].map((r) => r.key).filter((k): k is string => !!k))
    for (const r of queued) {
      const res = r.resource as JobResource
      used[res] ??= this.runningBy(res)
      if (used[res] >= (limits[res] ?? 1)) continue
      const def = this.handlers.get(r.type)
      if (!def) continue
      const key = def.key ? def.key(parse(r.payload)) : null
      const fullKey = key ? `${r.type}:${key}` : null
      if (fullKey && busyKeys.has(fullKey)) continue
      if (fullKey) busyKeys.add(fullKey)
      used[res]++
      void this.run(toJob(r), fullKey)
    }
  }

  private async run(job: Job, key: string | null = null): Promise<void> {
    const def = this.handlers.get(job.type)!
    const ctrl = new AbortController()
    this.running.set(job.id, { ctrl, resource: job.resource, key })
    const attempts = job.attempts + 1
    this.db.prepare(`UPDATE jobs SET status = 'running', attempts = ?, started_at = ?, error = NULL WHERE id = ?`).run(attempts, this.now(), job.id)
    this.emitJob(job.id)

    let lastEmit = 0
    const ctx: JobContext = {
      job: { ...job, attempts, status: 'running' },
      signal: ctrl.signal,
      progress: (v) => {
        const p = Math.min(1, Math.max(0, v))
        this.db.prepare('UPDATE jobs SET progress = ? WHERE id = ?').run(p, job.id)
        const t = this.now()
        if (t - lastEmit > 250 || p === 1) {
          lastEmit = t
          this.emitJob(job.id)
        }
      }
    }

    try {
      const result = await def.handler(job.payload, ctx)
      if (ctrl.signal.aborted) throw ctrl.signal.reason
      this.db
        .prepare(`UPDATE jobs SET status = 'done', progress = 1, result = ?, finished_at = ? WHERE id = ?`)
        .run(JSON.stringify(result ?? null), this.now(), job.id)
    } catch (e) {
      const reason = ctrl.signal.aborted ? (ctrl.signal.reason as Error)?.message : null
      const message = (e as Error)?.message ?? String(e)
      if (reason === 'app-closing') {
        // Volta para a fila sem gastar tentativa
        this.db.prepare(`UPDATE jobs SET status = 'queued', attempts = ?, progress = 0 WHERE id = ?`).run(attempts - 1, job.id)
      } else if (reason === 'canceled') {
        this.db.prepare(`UPDATE jobs SET status = 'canceled', finished_at = ? WHERE id = ?`).run(this.now(), job.id)
      } else if (attempts < job.maxAttempts) {
        this.db.prepare(`UPDATE jobs SET status = 'failed', error = ? WHERE id = ?`).run(message, job.id)
        const timer = setTimeout(() => {
          this.retryTimers.delete(timer)
          this.db.prepare(`UPDATE jobs SET status = 'queued' WHERE id = ? AND status = 'failed'`).run(job.id)
          this.emitJob(job.id)
          this.pump()
        }, this.retryDelayMs(attempts))
        this.retryTimers.add(timer)
      } else {
        this.db.prepare(`UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`).run(message, this.now(), job.id)
      }
    } finally {
      this.running.delete(job.id)
      this.emitJob(job.id)
      this.pump()
    }
  }
}

/** Limites por recurso conforme o modo de desempenho e o número de núcleos. */
export function limitsFor(mode: 'max' | 'eco', cores: number): ResourceLimits {
  if (mode === 'eco') return { gpu: 1, cpu: 1, io: 2, net: 2 }
  return { gpu: 2, cpu: Math.max(1, Math.min(4, Math.floor(cores / 4))), io: 4, net: 6 }
}
