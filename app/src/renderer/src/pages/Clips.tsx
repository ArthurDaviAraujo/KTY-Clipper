import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Clapperboard, FolderOpen, Loader2, Play, RefreshCw, RotateCcw, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import type { ClipRecord, Job, MomentRecord, TimelinePoint } from '../../../shared/types'
import { formatTimecode } from '../../../shared/vod'
import type { AppState } from '../state'
import { ClipModal, ClipStudio } from '../ClipModal'
import { Button, Card, cx } from '../ui'

export type ClipsTab = 'review' | 'approved' | 'rejected' | 'moments'

const TABS: { id: ClipsTab; label: string; empty: string }[] = [
  { id: 'review', label: 'Para revisar', empty: 'Nenhum clipe esperando você. Os automáticos e os que você gerar aparecem aqui.' },
  { id: 'approved', label: 'Aprovados', empty: 'Os clipes aprovados ficam aqui, prontos para postar.' },
  { id: 'rejected', label: 'Descartados', empty: 'Nada descartado.' },
  { id: 'moments', label: 'Momentos sem clipe', empty: 'Nenhum momento sobrando. Eles aparecem quando uma live é gravada ou um VOD é importado.' }
]

const scoreTone = (s: number) => (s >= 70 ? 'from-[#ff2d55] to-gold' : s >= 50 ? 'from-accent to-accent-2' : 'from-line to-muted')

export default function ClipsPage({
  state,
  liveId,
  setLiveId,
  tab,
  setTab
}: {
  state: AppState
  liveId: number | 'all'
  setLiveId: (v: number | 'all') => void
  tab: ClipsTab
  setTab: (t: ClipsTab) => void
}) {
  const [moments, setMoments] = useState<MomentRecord[]>([])
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const [making, setMaking] = useState<number | null>(null)
  const [studio, setStudio] = useState<number | null>(null)

  useEffect(() => {
    const load = () => {
      void window.api.listMoments(liveId === 'all' ? undefined : liveId).then(setMoments)
      if (liveId !== 'all') void window.api.getTimeline(liveId).then(setTimeline)
      else setTimeline([])
    }
    load()
    return window.api.onMoments((id) => (liveId === 'all' || id === liveId) && load())
  }, [liveId])

  const lives = state.lives.filter((l) => l.segments > 0)
  const clips = state.clips.filter((c) => liveId === 'all' || c.liveId === liveId)
  const withClip = new Set(clips.map((c) => c.momentId))
  const free = moments.filter((m) => m.status === 'new' && !withClip.has(m.id)).sort((a, b) => b.score - a.score)
  const byTab: Record<ClipsTab, number> = {
    review: clips.filter((c) => c.review === 'pending').length,
    approved: clips.filter((c) => c.review === 'approved').length,
    rejected: clips.filter((c) => c.review === 'rejected').length,
    moments: free.length
  }
  const shown = tab === 'moments' ? [] : clips.filter((c) => c.review === (tab === 'review' ? 'pending' : tab === 'approved' ? 'approved' : 'rejected'))
  const jobById = useMemo(() => new Map(state.jobs.map((j) => [j.id, j])), [state.jobs])
  const detecting = state.jobs.some((j) => j.type === 'detect:live' && (j.status === 'running' || j.status === 'queued'))
  const open = studio != null ? (state.clips.find((c) => c.id === studio) ?? null) : null

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Clipes</h2>
          <p className="text-sm text-muted">Assista, aprove ou descarte. Clique num clipe para abrir.</p>
        </div>
        <select
          value={liveId}
          onChange={(e) => setLiveId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="max-w-80 rounded-xl border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
        >
          <option value="all">Todas as lives</option>
          {lives.map((l) => (
            <option key={l.id} value={l.id}>
              {l.channelName} · {new Date(l.startedAt).toLocaleDateString('pt-BR')} · {l.title.slice(0, 40)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-line/60">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cx(
              '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition',
              tab === t.id ? 'border-accent font-medium text-text' : 'border-transparent text-muted hover:text-text'
            )}
          >
            {t.label}
            {byTab[t.id] > 0 && (
              <span className={cx('rounded-full px-1.5 text-[11px] tabular-nums', tab === t.id ? 'bg-accent text-white' : 'bg-line/70')}>{byTab[t.id]}</span>
            )}
          </button>
        ))}
      </div>

      {tab !== 'moments' && (
        <>
          {shown.length === 0 && <Empty text={TABS.find((t) => t.id === tab)!.empty} />}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
            {shown.map((c) => (
              <ClipCard key={c.id} clip={c} job={c.jobId != null ? (jobById.get(c.jobId) ?? null) : null} onOpen={() => setStudio(c.id)} onRetry={() => c.momentId != null && setMaking(c.momentId)} />
            ))}
          </div>
        </>
      )}

      {tab === 'moments' && (
        <div className="space-y-4">
          {liveId !== 'all' && (
            <Card className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Hype da live</p>
                <Button variant="ghost" disabled={detecting} onClick={() => void window.api.detectNow(liveId)}>
                  <RefreshCw size={14} className={detecting ? 'animate-spin' : ''} /> {detecting ? 'Procurando…' : 'Procurar de novo'}
                </Button>
              </div>
              <HypeChart points={timeline} moments={moments} />
            </Card>
          )}
          {free.length === 0 && <Empty text={detecting ? 'Procurando momentos…' : TABS[3].empty} />}
          <div className="grid gap-3 lg:grid-cols-2">
            {free.map((m) => (
              <MomentRow key={m.id} m={m} showLive={liveId === 'all'} onMake={() => setMaking(m.id)} />
            ))}
          </div>
        </div>
      )}

      {open && (
        <ClipStudio
          clip={open}
          moment={moments.find((m) => m.id === open.momentId) ?? null}
          onClose={() => setStudio(null)}
          onEdit={() => {
            setStudio(null)
            if (open.momentId != null) setMaking(open.momentId)
          }}
        />
      )}
      {making != null && (
        <ClipModal
          momentId={making}
          onClose={() => setMaking(null)}
          onQueued={() => {
            setMaking(null)
            setTab('review')
          }}
        />
      )}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <Card className="flex items-center gap-3 text-sm text-muted">
      <Sparkles className="shrink-0 text-gold" size={18} /> {text}
    </Card>
  )
}

/** Capa vertical do clipe; enquanto ele é gerado, a miniatura do lance borrada. */
export function ClipCover({ clip, play = false, className }: { clip: ClipRecord; play?: boolean; className?: string }) {
  const ready = clip.status === 'ready' && !!clip.path
  return (
    <div className={cx('relative aspect-[9/16] overflow-hidden bg-black', className)}>
      {ready ? (
        <img src={`clipador://capa/${clip.id}`} alt="" className="size-full object-cover" />
      ) : clip.momentId != null ? (
        <img src={`clipador://miniatura/${clip.momentId}`} alt="" className="size-full scale-125 object-cover opacity-50 blur-sm" />
      ) : null}
      {ready && play && <video src={`clipador://clipe/${clip.id}`} muted autoPlay loop className="absolute inset-0 size-full object-cover" />}
    </div>
  )
}

function ClipCard({ clip: c, job, onOpen, onRetry }: { clip: ClipRecord; job: Job | null; onOpen: () => void; onRetry: () => void }) {
  const [hover, setHover] = useState(false)
  const ready = c.status === 'ready' && !!c.path
  const busy = c.status === 'queued' || c.status === 'rendering'
  const p = job?.status === 'running' ? job.progress : (c.progress ?? 0)
  const review = (r: ClipRecord['review']) => void window.api.reviewClip(c.id, r)

  return (
    <div className="group overflow-hidden rounded-2xl border border-line/60 bg-card/40 transition hover:border-accent/60">
      <button type="button" onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="relative block w-full text-left">
        <ClipCover clip={c} play={hover} />
        {c.score != null && (
          <span className={cx('absolute left-2 top-2 rounded-lg bg-gradient-to-br px-2 py-0.5 text-sm font-bold text-white shadow', scoreTone(c.score))}>{c.score}</span>
        )}
        {ready && <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] tabular-nums text-white">{formatTimecode(c.durationS)}</span>}
        {ready && !hover && (
          <span className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100">
            <span className="grid size-11 place-items-center rounded-full bg-black/60 text-white">
              <Play size={18} />
            </span>
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white">
            <Loader2 className="animate-spin" />
            {c.status === 'queued' && job?.status !== 'running' ? 'Na fila' : `Gerando ${Math.round(p * 100)}%`}
          </span>
        )}
        {c.status === 'failed' && <span className="absolute inset-0 grid place-items-center bg-black/50 text-sm text-err">Falhou</span>}
      </button>

      <div className="space-y-2 p-3">
        <div className="min-h-[2.5rem]">
          <p className="line-clamp-2 text-sm font-semibold leading-snug">{c.title}</p>
          <p className="truncate text-xs text-muted">
            {c.channelName}
            {c.tag ? ` · ${c.tag}` : ''}
          </p>
        </div>
        <div className="flex gap-1.5">
          {c.status === 'failed' ? (
            <Action onClick={onRetry} title={c.error ?? ''} wide>
              <RotateCcw size={14} /> Tentar de novo
            </Action>
          ) : c.review === 'pending' ? (
            <>
              <Action onClick={() => review('approved')} disabled={!ready} tone="ok" wide>
                <Check size={14} /> Aprovar
              </Action>
              <Action onClick={() => review('rejected')} title="Descartar">
                <X size={14} />
              </Action>
            </>
          ) : c.review === 'approved' ? (
            <>
              <Action onClick={() => c.path && void window.api.showInFolder(c.path)} wide>
                <FolderOpen size={14} /> Pasta
              </Action>
              <Action onClick={() => review('pending')} title="Voltar para revisão">
                <Undo2 size={14} />
              </Action>
            </>
          ) : (
            <>
              <Action onClick={() => review('pending')} wide>
                <Undo2 size={14} /> Restaurar
              </Action>
              <Action onClick={() => confirm('Apagar este clipe do disco?') && void window.api.deleteClip(c.id)} title="Apagar do disco">
                <Trash2 size={14} />
              </Action>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Action({
  children,
  onClick,
  title,
  wide,
  disabled,
  tone
}: {
  children: ReactNode
  onClick: () => void
  title?: string
  wide?: boolean
  disabled?: boolean
  tone?: 'ok'
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        wide && 'flex-1',
        tone === 'ok' ? 'border-ok/40 bg-ok/10 text-ok hover:bg-ok/20' : 'border-line text-muted hover:border-accent/60 hover:text-text'
      )}
    >
      {children}
    </button>
  )
}

/** Momento que ainda não virou clipe: miniatura, nota, título e as duas ações. */
function MomentRow({ m, showLive, onMake }: { m: MomentRecord; showLive: boolean; onMake: () => void }) {
  const title = m.ai?.titlePt || m.reasons[0] || `Momento em ${formatTimecode(m.peakS)}`
  return (
    <Card className="flex gap-3 p-3">
      <button
        type="button"
        title="Abrir o trecho gravado no player"
        onClick={() => void window.api.openMoment(m.id)}
        className="relative aspect-video w-44 shrink-0 overflow-hidden rounded-xl bg-panel"
      >
        {m.hasThumb ? (
          <img src={`clipador://miniatura/${m.id}`} alt="" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-muted">
            <Sparkles size={18} />
          </span>
        )}
        <span className={cx('absolute left-1.5 top-1.5 rounded-md bg-gradient-to-br px-1.5 text-xs font-bold text-white', scoreTone(m.score))}>{m.score}</span>
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1 text-[10px] tabular-nums text-white">{formatTimecode(m.peakS)}</span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className={cx('line-clamp-2 text-sm font-semibold leading-snug', m.ai && !m.ai.keep && 'text-muted')}>{title}</p>
        <p className="truncate text-xs text-muted">
          {showLive ? `${m.channelName} · ` : ''}
          {m.clip ? `clipado · ${m.clip.views} views` : m.voice ? `pediu clipe: “${m.voice.phrase}”` : m.ai ? (m.ai.keep ? m.ai.category : 'IA descartou') : m.reasons[0]}
        </p>
        <div className="mt-auto flex gap-1.5 pt-2">
          <Button onClick={onMake}>
            <Clapperboard size={14} /> Gerar clipe
          </Button>
          <Button variant="ghost" title="Tirar da lista" onClick={() => void window.api.dismissMoment(m.id)}>
            <X size={14} />
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** Gráfico do hype ao longo da live (chat em rosa, áudio em dourado) com os momentos marcados. */
function HypeChart({ points, moments }: { points: TimelinePoint[]; moments: MomentRecord[] }) {
  if (points.length < 2) return <p className="text-xs text-muted">Sem dados ainda.</p>
  const w = 1000
  const h = 100
  const s0 = points[0].s
  const s1 = points[points.length - 1].s || s0 + 1
  const x = (s: number) => ((s - s0) / (s1 - s0)) * w
  const path = (k: 'chat' | 'audio') => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.s).toFixed(1)},${(h - p[k] * (h - 6) - 3).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-24 w-full rounded-xl bg-panel">
      <path d={path('audio')} fill="none" stroke="var(--color-gold)" strokeWidth="1.5" opacity="0.8" vectorEffect="non-scaling-stroke" />
      <path d={path('chat')} fill="none" stroke="var(--color-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {moments.map((m) => (
        <line key={m.id} x1={x(m.peakS)} x2={x(m.peakS)} y1={0} y2={h} stroke="white" strokeWidth="1.5" opacity="0.6" vectorEffect="non-scaling-stroke">
          <title>
            {formatTimecode(m.peakS)} · nota {m.score}
          </title>
        </line>
      ))}
    </svg>
  )
}
