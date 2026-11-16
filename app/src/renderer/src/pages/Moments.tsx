import { useEffect, useMemo, useState } from 'react'
import { AudioLines, Clapperboard, FolderOpen, MessageSquare, Mic, Play, RefreshCw, RotateCcw, Sparkles, Trash2, Users } from 'lucide-react'
import type { ClipRecord, Job, MomentRecord, TimelinePoint } from '../../../shared/types'
import { formatTimecode } from '../../../shared/vod'
import type { AppState } from '../state'
import { ClipModal, ClipPlayer } from '../ClipModal'
import { Badge, Button, Card, Progress, Section, Segmented, cx } from '../ui'

const scoreTone = (s: number) => (s >= 70 ? 'from-[#ff2d55] to-gold' : s >= 50 ? 'from-accent to-accent-2' : 'from-line to-muted')

export default function MomentsPage({ state }: { state: AppState }) {
  const { lives } = state
  const withSegments = lives.filter((l) => l.segments > 0)
  const [liveId, setLiveId] = useState<number | 'all'>('all')
  const [order, setOrder] = useState<'score' | 'time'>('score')
  const [moments, setMoments] = useState<MomentRecord[]>([])
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])

  useEffect(() => {
    const load = () => {
      void window.api.listMoments(liveId === 'all' ? undefined : liveId).then(setMoments)
      if (liveId !== 'all') void window.api.getTimeline(liveId).then(setTimeline)
      else setTimeline([])
    }
    load()
    return window.api.onMoments((id) => (liveId === 'all' || id === liveId) && load())
  }, [liveId])

  const [clips, setClips] = useState<ClipRecord[]>([])
  const [making, setMaking] = useState<number | null>(null)
  const [playing, setPlaying] = useState<ClipRecord | null>(null)
  useEffect(() => {
    const load = () => void window.api.listClips(liveId === 'all' ? undefined : liveId).then(setClips)
    load()
    return window.api.onClips(load)
  }, [liveId])
  const clipOf = useMemo(() => {
    const map = new Map<number, ClipRecord>()
    for (const c of clips) if (c.momentId != null && !map.has(c.momentId)) map.set(c.momentId, c)
    return map
  }, [clips])
  const jobById = useMemo(() => new Map(state.jobs.map((j) => [j.id, j])), [state.jobs])
  const ready = clips.filter((c) => c.status === 'ready')

  const sorted = useMemo(() => [...moments].sort((a, b) => (order === 'score' ? b.score - a.score : a.liveId - b.liveId || a.peakS - b.peakS)), [moments, order])
  const detecting = state.jobs.some((j) => j.type === 'detect:live' && (j.status === 'running' || j.status === 'queued'))

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Momentos</h2>
          <p className="text-sm text-muted">Encontrados por picos de chat, áudio e pedido de clipe por voz; a IA dá título e confere cada um.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={liveId}
            onChange={(e) => setLiveId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="max-w-72 rounded-xl border border-line bg-panel px-3 py-1.5 text-sm outline-none focus:border-accent"
          >
            <option value="all">Todas as lives</option>
            {withSegments.map((l) => (
              <option key={l.id} value={l.id}>
                {l.channelName} · {new Date(l.startedAt).toLocaleDateString('pt-BR')} · {l.title.slice(0, 40)}
              </option>
            ))}
          </select>
          <Segmented
            value={order}
            onChange={setOrder}
            options={[
              { value: 'score', label: 'Melhores' },
              { value: 'time', label: 'Na ordem' }
            ]}
          />
        </div>
      </div>

      {liveId !== 'all' && (
        <Card className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Hype da live</p>
            <Button variant="ghost" disabled={detecting} onClick={() => void window.api.detectNow(liveId)}>
              <RefreshCw size={14} className={detecting ? 'animate-spin' : ''} /> {detecting ? 'Procurando…' : 'Procurar de novo'}
            </Button>
          </div>
          <HypeChart points={timeline} moments={moments} />
          <div className="flex gap-4 text-xs text-muted">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-accent" /> chat
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-gold" /> áudio
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-0.5 bg-white" /> momento
            </span>
          </div>
        </Card>
      )}

      <Section
        title={`${sorted.length} momento(s)`}
        action={
          ready.length > 0 && state.disk ? (
            <Button variant="ghost" onClick={() => void window.api.openPath(state.disk!.clipsDir)}>
              <FolderOpen size={14} /> {ready.length} clipe(s) pronto(s) · abrir pasta
            </Button>
          ) : undefined
        }
      >
        {sorted.length === 0 && (
          <Card className="flex items-center gap-3 text-sm text-muted">
            <Sparkles className="text-gold" size={18} />
            {detecting ? 'Procurando momentos…' : 'Nenhum momento ainda. Eles aparecem depois que uma live é gravada ou um VOD é importado.'}
          </Card>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {sorted.map((m) => {
            const clip = clipOf.get(m.id) ?? null
            return (
              <MomentCard
                key={m.id}
                m={m}
                showLive={liveId === 'all'}
                clip={clip}
                job={clip?.jobId != null ? (jobById.get(clip.jobId) ?? null) : null}
                onMake={() => setMaking(m.id)}
                onPlay={() => clip && setPlaying(clip)}
              />
            )
          })}
        </div>
      </Section>
      {making != null && <ClipModal momentId={making} onClose={() => setMaking(null)} />}
      {playing && <ClipPlayer clip={playing} onClose={() => setPlaying(null)} />}
    </div>
  )
}

/** Rodapé do cartão: gerar, andamento e o clipe pronto. */
function ClipBar({ clip, job, onMake, onPlay }: { clip: ClipRecord | null; job: Job | null; onMake: () => void; onPlay: () => void }) {
  if (!clip)
    return (
      <Button onClick={onMake}>
        <Clapperboard size={14} /> Gerar clipe
      </Button>
    )
  const remove = () => {
    if (confirm(clip.status === 'ready' ? 'Apagar este clipe (arquivo e texto)?' : 'Cancelar este clipe?')) void window.api.deleteClip(clip.id)
  }
  if (clip.status === 'queued' || clip.status === 'rendering') {
    const p = job?.status === 'running' ? job.progress : (clip.progress ?? 0)
    return (
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs text-muted">{clip.status === 'queued' && job?.status !== 'running' ? 'Clipe na fila…' : `Gerando clipe… ${Math.round(p * 100)}%`}</p>
          <Progress value={clip.status === 'queued' && job?.status !== 'running' ? 0 : p} />
        </div>
        <Button variant="ghost" onClick={remove} title="Cancelar">
          <Trash2 size={14} />
        </Button>
      </div>
    )
  }
  if (clip.status === 'failed')
    return (
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-xs text-err" title={clip.error ?? ''}>
          Falhou: {clip.error}
        </p>
        <Button variant="ghost" onClick={onMake}>
          <RotateCcw size={14} /> Tentar de novo
        </Button>
      </div>
    )
  const mb = clip.sizeBytes ? `${(clip.sizeBytes / 1024 ** 2).toFixed(1)} MB` : ''
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={onPlay}>
        <Play size={14} /> Assistir
      </Button>
      <Button variant="ghost" onClick={() => clip.path && void window.api.showInFolder(clip.path)} title={clip.path ?? ''}>
        <FolderOpen size={14} /> Pasta
      </Button>
      <Button variant="ghost" onClick={onMake} title="Mudar layout, trecho, título… (substitui este clipe)">
        <RotateCcw size={14} /> Refazer
      </Button>
      <Button variant="ghost" onClick={remove} title="Apagar o clipe">
        <Trash2 size={14} />
      </Button>
      <span className="ml-auto text-xs text-muted">
        {clip.auto && 'auto · '}
        {clip.width}×{clip.height} · {clip.durationS.toFixed(0)} s · {mb}
      </span>
    </div>
  )
}

function MomentCard({
  m,
  showLive,
  clip,
  job,
  onMake,
  onPlay
}: {
  m: MomentRecord
  showLive: boolean
  clip: ClipRecord | null
  job: Job | null
  onMake: () => void
  onPlay: () => void
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="relative aspect-video bg-panel">
        {m.hasThumb ? (
          <img src={`clipador://miniatura/${m.id}`} alt="" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-muted">
            <Sparkles />
          </div>
        )}
        <div className={cx('absolute left-2 top-2 rounded-xl bg-gradient-to-br px-2.5 py-1 text-lg font-bold text-white shadow-lg', scoreTone(m.score))}>{m.score}</div>
        <div className="absolute bottom-2 right-2 rounded-lg bg-black/75 px-2 py-0.5 text-xs tabular-nums text-white">
          {formatTimecode(m.startS)} – {formatTimecode(m.endS)}
        </div>
        <button
          type="button"
          title="Abrir o pedaço gravado no player"
          onClick={() => void window.api.openMoment(m.id)}
          className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition hover:bg-black/40 hover:opacity-100"
        >
          <span className="grid size-12 place-items-center rounded-full bg-accent text-white shadow-lg">
            <Play size={20} />
          </span>
        </button>
      </div>
      <div className="space-y-2 p-3">
        {m.ai && (
          <div className={cx(!m.ai.keep && 'opacity-60')}>
            <p className="font-semibold leading-snug">{m.ai.titlePt}</p>
            <p className="text-xs text-muted">{m.ai.titleEn}</p>
          </div>
        )}
        {showLive && (
          <p className="truncate text-xs text-muted">
            {m.channelName} · {m.liveTitle || 'sem título'}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {m.ai && (m.ai.keep ? <Badge tone="ok">IA: {m.ai.category}</Badge> : <Badge tone="muted">IA descartou</Badge>)}
          {m.clip && (
            <button type="button" title={`Abrir o clipe original: ${m.clip.title}`} onClick={() => m.clip?.url && void window.api.openExternal(m.clip.url)}>
              <Badge tone="ok">
                <Users size={11} /> clipado · {m.clip.views} views
              </Badge>
            </button>
          )}
          {m.voice && (
            <Badge tone="err">
              <Mic size={11} /> “{m.voice.phrase}”
            </Badge>
          )}
          {m.chat && (
            <Badge tone="accent">
              <MessageSquare size={11} /> chat {m.chat.ratio.toFixed(1)}×
            </Badge>
          )}
          {m.audio && (
            <Badge tone="warn">
              <AudioLines size={11} /> +{Math.round(m.audio.deltaDb)} dB
            </Badge>
          )}
        </div>
        <ul className="space-y-0.5 text-xs text-text/85">
          {m.reasons.map((r) => (
            <li key={r}>• {r}</li>
          ))}
          {m.ai && <li className="text-accent-2">• IA: {m.ai.reason}</li>}
        </ul>
        {m.speech && (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer select-none">O que o streamer disse</summary>
            <p className="mt-1 max-h-28 overflow-y-auto text-text/80">{m.speech}</p>
          </details>
        )}
        {m.ai && m.ai.hashtags.length > 0 && <p className="text-xs text-muted">{m.ai.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}</p>}
        {m.samples.length > 0 && (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer select-none">O que o chat disse ({m.samples.length})</summary>
            <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
              {m.samples.map((s, i) => (
                <li key={i} className="truncate">
                  {s}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="border-t border-line/50 pt-2">
          <ClipBar clip={clip} job={job} onMake={onMake} onPlay={onPlay} />
        </div>
      </div>
    </Card>
  )
}

/** Gráfico simples do hype ao longo da live (chat em rosa, áudio em dourado) com os momentos marcados. */
function HypeChart({ points, moments }: { points: TimelinePoint[]; moments: MomentRecord[] }) {
  if (points.length < 2) return <p className="text-xs text-muted">Sem dados ainda.</p>
  const w = 1000
  const h = 120
  const s0 = points[0].s
  const s1 = points[points.length - 1].s || s0 + 1
  const x = (s: number) => ((s - s0) / (s1 - s0)) * w
  const path = (k: 'chat' | 'audio') => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.s).toFixed(1)},${(h - p[k] * (h - 6) - 3).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-28 w-full rounded-xl bg-panel">
      <path d={path('audio')} fill="none" stroke="var(--color-gold)" strokeWidth="1.5" opacity="0.8" vectorEffect="non-scaling-stroke" />
      <path d={path('chat')} fill="none" stroke="var(--color-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {moments.map((m) => (
        <line key={m.id} x1={x(m.peakS)} x2={x(m.peakS)} y1={0} y2={h} stroke="white" strokeWidth="1.5" opacity="0.7" vectorEffect="non-scaling-stroke">
          <title>
            {formatTimecode(m.peakS)} · nota {m.score}
          </title>
        </line>
      ))}
    </svg>
  )
}
