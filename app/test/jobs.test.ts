import { describe, expect, it } from 'vitest'
import { openDb } from '../src/main/db'
import { JobQueue, limitsFor } from '../src/main/jobs'
import type { Job } from '../src/shared/types'

const limits = () => ({ gpu: 1, cpu: 1, io: 2, net: 2 })
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('JobQueue', () => {
  it('runs a job and stores its result', async () => {
    const q = new JobQueue(openDb(':memory:'), limits)
    q.register('soma', 'cpu', async (p) => (p as number[]).reduce((a, b) => a + b, 0))
    q.start()
    const job = q.enqueue('soma', 'Somar', [1, 2, 3])
    await waitFor(() => q.get(job.id)?.status === 'done')
    expect(q.get(job.id)?.result).toBe(6)
    expect(q.get(job.id)?.progress).toBe(1)
  })

  it('respects the per-resource limit', async () => {
    const q = new JobQueue(openDb(':memory:'), limits)
    let active = 0
    let peak = 0
    q.register('gpuTask', 'gpu', async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 30))
      active--
    })
    q.start()
    const ids = [1, 2, 3].map(() => q.enqueue('gpuTask', 'GPU').id)
    await waitFor(() => ids.every((id) => q.get(id)?.status === 'done'))
    expect(peak).toBe(1)
  })

  it('never runs two jobs with the same key together, but runs different keys in parallel', async () => {
    const q = new JobQueue(openDb(':memory:'), () => ({ gpu: 1, cpu: 4, io: 2, net: 2 }))
    const active = new Map<number, number>()
    const peak = new Map<number, number>()
    let peakAll = 0
    q.register(
      'detect',
      'cpu',
      async (p) => {
        const live = (p as { liveId: number }).liveId
        active.set(live, (active.get(live) ?? 0) + 1)
        peak.set(live, Math.max(peak.get(live) ?? 0, active.get(live)!))
        peakAll = Math.max(peakAll, [...active.values()].reduce((a, b) => a + b, 0))
        await new Promise((r) => setTimeout(r, 30))
        active.set(live, active.get(live)! - 1)
      },
      (p) => String((p as { liveId: number }).liveId)
    )
    q.start()
    const ids = [1, 1, 2, 2].map((liveId) => q.enqueue('detect', 'Detectar', { liveId }).id)
    await waitFor(() => ids.every((id) => q.get(id)?.status === 'done'))
    expect(peak.get(1)).toBe(1)
    expect(peak.get(2)).toBe(1)
    expect(peakAll).toBe(2)
  })

  it('retries a failing job until it succeeds', async () => {
    const q = new JobQueue(openDb(':memory:'), limits, Date.now, () => 5)
    let calls = 0
    q.register('instavel', 'net', async () => {
      calls++
      if (calls < 3) throw new Error('falhou')
      return 'ok'
    })
    q.start()
    const job = q.enqueue('instavel', 'Instável', null, { maxAttempts: 3 })
    await waitFor(() => q.get(job.id)?.status === 'done')
    expect(calls).toBe(3)
    expect(q.get(job.id)?.attempts).toBe(3)
  })

  it('marks as failed after the last attempt', async () => {
    const q = new JobQueue(openDb(':memory:'), limits, Date.now, () => 5)
    q.register('quebrada', 'cpu', async () => {
      throw new Error('sempre falha')
    })
    q.start()
    const job = q.enqueue('quebrada', 'Quebrada', null, { maxAttempts: 2 })
    await waitFor(() => q.get(job.id)?.finishedAt != null)
    const j = q.get(job.id) as Job
    expect(j.status).toBe('failed')
    expect(j.error).toBe('sempre falha')
  })

  it('cancels a running job', async () => {
    const q = new JobQueue(openDb(':memory:'), limits)
    q.register('longa', 'io', (_p, ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason))))
    q.start()
    const job = q.enqueue('longa', 'Longa')
    await waitFor(() => q.get(job.id)?.status === 'running')
    q.cancel(job.id)
    await waitFor(() => q.get(job.id)?.status === 'canceled')
  })

  it('resumes interrupted jobs when reopened, without spending an attempt', async () => {
    const db = openDb(':memory:')
    const q1 = new JobQueue(db, limits)
    q1.register('longa', 'io', (_p, ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason))))
    q1.start()
    const job = q1.enqueue('longa', 'Longa')
    await waitFor(() => q1.get(job.id)?.status === 'running')
    await q1.stop()
    expect(q1.get(job.id)?.status).toBe('queued')
    expect(q1.get(job.id)?.attempts).toBe(0)

    // Simula o app abrindo de novo
    const q2 = new JobQueue(db, limits)
    q2.register('longa', 'io', async () => 'retomada')
    q2.start()
    await waitFor(() => q2.get(job.id)?.status === 'done')
    expect(q2.get(job.id)?.result).toBe('retomada')
  })

  it('recovers jobs left as running after a crash', async () => {
    const db = openDb(':memory:')
    db.prepare(`INSERT INTO jobs(type, label, resource, status, created_at) VALUES ('x', 'X', 'cpu', 'running', 0)`).run()
    const q = new JobQueue(db, limits)
    q.register('x', 'cpu', async () => 1)
    q.start()
    await waitFor(() => q.get(1)?.status === 'done')
  })
})

describe('limitsFor', () => {
  it('uses more parallelism in max mode', () => {
    expect(limitsFor('max', 16).cpu).toBeGreaterThan(limitsFor('eco', 16).cpu)
    expect(limitsFor('max', 2).cpu).toBe(1)
  })
})
