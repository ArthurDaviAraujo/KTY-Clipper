import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Clapperboard, FolderOpen, Loader2, Play, RefreshCw, RotateCcw, Search, Sparkles, Trash2, Undo2, Upload, X } from 'lucide-react'
import type { ClipRecord, DiscardedDelete, Job, MomentRecord, TimelinePoint } from '../../../shared/types'
import { formatTimecode } from '../../../shared/vod'
import type { AppState } from '../state'
import { ClipModal, ClipStudio } from '../ClipModal'
import { PostingList } from './Posting'
import { PostCard } from './PostCard'
import { SearchView } from './Search'
import { BrandIcon } from '../BrandIcon'
import { lastPosted, postDone } from '../../../shared/post'
import { Button, Card, PageHeader, SubTabs, cx } from '../ui'

export type ClipsTab = 'review' | 'approved' | 'rejected' | 'moments' | 'topost' | 'posted' | 'search'
export type ClipsSort = 'best' | 'recent'

const TABS: Record<ClipsTab, { label: string; empty: string }> = {
  review: { label: 'Para revisar', empty: 'Nenhum clipe esperando você. Os automáticos e os que você gerar aparecem aqui.' },
  approved: { label: 'Aprovados', empty: 'Os clipes aprovados ficam aqui, prontos para postar.' },
  rejected: { label: 'Descartados', empty: 'Nada descartado.' },
  moments: { label: 'Momentos sem clipe', empty: 'Nenhum momento sobrando. Eles aparecem quando uma live é gravada ou um VOD é importado.' },
  topost: { label: 'Para postar', empty: 'Nada para postar agora. Os clipes que você aprovar aparecem aqui com os textos prontos.' },
  posted: { label: 'Postados', empty: 'Nenhum clipe postado ainda. Marque "postado" em Para postar depois de subir o vídeo.' },
  search: { label: 'Busca', empty: '' }
}

const scoreTone = (s: number) => (s >= 70 ? 'from-[#ff2d55] to-gold' : s >= 50 ? 'from-accent to-violet' : 'from-white/20 to-white/10')
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export default function ClipsPage({
  state,
  liveId,
  tab,
  setTab,
  sort,
  setSort,
  query,
  clearQuery
}: {
  state: AppState
  liveId: number | 'all'
  tab: ClipsTab
  setTab: (t: ClipsTab) => void
  sort: ClipsSort
  setSort: (s: ClipsSort) => void
  query: string
  clearQuery: () => void
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

  const q = norm(query.trim())
  const live = liveId === 'all' ? null : (state.lives.find((l) => l.id === liveId) ?? null)
  const scoped = state.clips.filter((c) => liveId === 'all' || c.liveId === liveId)
  const withClip = new Set(scoped.map((c) => c.momentId))
  const matchClip = (c: ClipRecord) => !q || norm([c.title, c.titleEn, c.channelName, c.tag ?? '', c.game ?? '', ...c.hashtags].join(' ')).includes(q)
  const matchMoment = (m: MomentRecord) =>
    !q || norm([m.ai?.titlePt ?? '', m.ai?.titleEn ?? '', m.channelName, m.game ?? '', m.speech, ...m.reasons].join(' ')).includes(q)
  const order = <T extends { score: number | null; createdAt?: number; peakS?: number; id: number }>(a: T, b: T) =>
    sort === 'best' ? (b.score ?? 0) - (a.score ?? 0) : b.id - a.id

  const posting = tab === 'topost' || tab === 'posted'
  const searching = tab === 'search'
  const nets = state.settings?.publishing.networks ?? { youtube: true, tiktok: true }
  const review = tab === 'review' ? 'pending' : tab === 'rejected' ? 'rejected' : 'approved'
  const shown =
    tab === 'moments'
      ? []
      : posting
        ? scoped
            .filter((c) => c.review === 'approved' && c.status === 'ready' && postDone(c.posted, nets) === (tab === 'posted') && matchClip(c))
            .sort(tab === 'posted' ? (a, b) => lastPosted(b.posted) - lastPosted(a.posted) : order)
        : scoped.filter((c) => c.review === review && matchClip(c)).sort(order)
  const free = moments.filter((m) => m.status === 'new' && !withClip.has(m.id) && matchMoment(m)).sort(order)
  const jobById = useMemo(() => new Map(state.jobs.map((j) => [j.id, j])), [state.jobs])
  const detecting = state.jobs.some((j) => j.type === 'detect:live' && (j.status === 'running' || j.status === 'queued'))
  const open = studio != null ? (state.clips.find((c) => c.id === studio) ?? null) : null

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-8">
      <PageHeader
        title={searching ? 'Busca' : live ? `${live.channelName} · ${new Date(live.startedAt).toLocaleDateString('pt-BR')}` : 'Todos os clipes'}
        subtitle={searching ? (query.trim() ? `“${query.trim()}” em clipes, momentos e no que foi falado` : 'Clipes, momentos e tudo o que foi falado') : live ? live.title : TABS[tab].label}
        tabs={
          tab === 'posted' || searching ? undefined : (
          <SubTabs
            value={sort}
            onChange={setSort}
            options={[
              { value: 'best', label: 'Melhores' },
              { value: 'recent', label: 'Recentes' }
            ]}
          />
          )
        }
        action={
          posting ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-muted">Posto no</span>
              {(['youtube', 'tiktok'] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  title={nets[n] ? 'Clique para não contar esta rede' : 'Clique para contar esta rede'}
                  onClick={() => void state.updateSettings({ publishing: { networks: { [n]: !nets[n] } } })}
                  className={cx(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition',
                    nets[n] ? 'border-accent/50 bg-accent/15 text-text' : 'border-white/15 text-muted hover:text-text'
                  )}
                >
                  {nets[n] && <Check size={11} />} <BrandIcon brand={n} size={13} /> {n === 'youtube' ? 'YouTube' : 'TikTok'}
                </button>
              ))}
              {tab === 'topost' && shown.some((c) => !c.exportedPath) && (
                <Button variant="ghost" onClick={() => void window.api.exportApproved()} title="Copia para a pasta para postar os aprovados que ainda não estão lá">
                  <Upload size={13} /> Copiar para a pasta
                </Button>
              )}
              {state.disk && (
                <Button variant="ghost" onClick={() => void window.api.openPath(state.disk!.exportDir)} title={state.disk.exportDir}>
                  <FolderOpen size={13} /> Pasta para postar
                </Button>
              )}
            </div>
          ) : tab === 'rejected' ? (
            <DiscardedControls state={state} count={state.clips.filter((c) => c.review === 'rejected').length} />
          ) : searching ? undefined : liveId !== 'all' ? (
            <Button variant="ghost" disabled={detecting} onClick={() => void window.api.detectNow(liveId)} title="Rodar os detectores de novo nesta live">
              <RefreshCw size={13} className={detecting ? 'animate-spin' : ''} /> {detecting ? 'Procurando…' : 'Procurar de novo'}
            </Button>
          ) : undefined
        }
      />

      {q && !searching && (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Search size={13} /> Buscando “{query.trim()}” em {TABS[tab].label.toLowerCase()}
          <button type="button" onClick={clearQuery} className="text-accent-2 hover:underline">
            limpar
          </button>
        </div>
      )}

      {posting && (
        <>
          {shown.length === 0 && <Empty text={q ? 'Nada encontrado nesta aba.' : TABS[tab].empty} />}
          {shown.length > 0 && tab === 'topost' && (
            <div className="space-y-5">
              {shown.map((c) => (
                <PostCard key={c.id} clip={c} networks={nets} onOpen={setStudio} />
              ))}
            </div>
          )}
          {shown.length > 0 && tab === 'posted' && <PostingList clips={shown} networks={nets} onOpen={setStudio} />}
        </>
      )}

      {searching && (
        <SearchView
          query={query}
          clips={state.clips}
          aiReady={!!state.settings && state.settings.ai.provider === 'gemini' && !!state.settings.ai.geminiModel}
          renderClip={(c) => (
            <ClipCard key={c.id} clip={c} job={c.jobId != null ? (jobById.get(c.jobId) ?? null) : null} onOpen={() => setStudio(c.id)} onRetry={() => c.momentId != null && setMaking(c.momentId)} />
          )}
          renderMoment={(m) => <MomentRow key={m.id} m={m} showLive onMake={() => setMaking(m.id)} />}
          onMake={setMaking}
          onOpenClip={setStudio}
        />
      )}

      {tab !== 'moments' && !posting && !searching && (
        <>
          {shown.length === 0 && <Empty text={q ? 'Nada encontrado nesta aba.' : TABS[tab].empty} />}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-5 2xl:grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
            {shown.map((c) => (
              <ClipCard key={c.id} clip={c} job={c.jobId != null ? (jobById.get(c.jobId) ?? null) : null} onOpen={() => setStudio(c.id)} onRetry={() => c.momentId != null && setMaking(c.momentId)} />
            ))}
          </div>
        </>
      )}

      {tab === 'moments' && (
        <div className="space-y-4">
          {liveId !== 'all' && timeline.length > 1 && (
            <Card className="space-y-2">
              <div className="flex items-center gap-4 text-xs text-muted">
                <span className="font-medium text-text">Hype da live</span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-brand" /> chat
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-gold" /> áudio
                </span>
              </div>
              <HypeChart points={timeline} moments={moments} />
            </Card>
          )}
          {free.length === 0 && <Empty text={detecting ? 'Procurando momentos…' : q ? 'Nada encontrado.' : TABS.moments.empty} />}
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
          onReplaced={setStudio}
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

const DISCARDED_OPTIONS: { value: DiscardedDelete; label: string }[] = [
  { value: 'never', label: 'Nunca' },
  { value: 'startup', label: 'Ao abrir o app' },
  { value: '1d', label: 'Depois de 1 dia' },
  { value: '7d', label: 'Depois de 7 dias' },
  { value: '30d', label: 'Depois de 30 dias' }
]

/** Aba Descartados: apagar os clipes descartados sozinho (ao abrir o app ou depois de um prazo) ou todos agora. */
function DiscardedControls({ state, count }: { state: AppState; count: number }) {
  const mode = state.settings?.clips.discardedDelete ?? 'never'
  const canPurge = typeof window.api.purgeRejected === 'function'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] text-muted">Apagar do disco</span>
      <select
        value={mode}
        title="Os vídeos dos clipes descartados são apagados sozinhos; o lance não volta a virar clipe"
        onChange={(e) => void state.updateSettings({ clips: { discardedDelete: e.target.value as DiscardedDelete } })}
        className="rounded-full border border-white/15 bg-panel px-3 py-1 text-[12px] text-text outline-none transition hover:border-white/30 focus:border-accent"
      >
        {DISCARDED_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {canPurge && (
        <Button
          variant="ghost"
          disabled={!count}
          onClick={() => confirm(`Apagar do disco ${count === 1 ? 'o clipe descartado' : `os ${count} clipes descartados`}? Não dá para desfazer.`) && void window.api.purgeRejected()}
        >
          <Trash2 size={13} /> Apagar todos agora
        </Button>
      )}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <Card className="flex items-center gap-3 text-[13px] text-muted">
      <Sparkles className="shrink-0 text-gold" size={16} /> {text}
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
    <div className="group overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035] transition hover:border-white/20">
      <button type="button" onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="relative block w-full text-left">
        <ClipCover clip={c} play={hover} />
        {c.score != null && (
          <span className={cx('absolute left-2 top-2 rounded-md bg-gradient-to-br px-1.5 py-0.5 text-xs font-bold text-white shadow', scoreTone(c.score))}>{c.score}</span>
        )}
        {ready && <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] tabular-nums text-white">{formatTimecode(c.durationS)}</span>}
        {ready && !hover && (
          <span className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100">
            <span className="grid size-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
              <Play size={16} />
            </span>
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[13px] text-white">
            <Loader2 className="animate-spin" />
            {c.status === 'queued' && job?.status !== 'running' ? 'Na fila' : `Gerando ${Math.round(p * 100)}%`}
          </span>
        )}
        {c.status === 'failed' && <span className="absolute inset-0 grid place-items-center bg-black/50 text-[13px] text-err">Falhou</span>}
      </button>

      <div className="space-y-2 p-3">
        <div className="min-h-[2.4rem]">
          <p className="line-clamp-2 text-[13px] font-semibold leading-snug">{c.title}</p>
          <p className="truncate text-[11px] text-muted">
            {c.channelName}
            {c.game ? ` · ${c.game}` : ''}
            {c.tag ? ` · ${c.tag}` : ''}
          </p>
        </div>
        <div className="flex gap-1.5">
          {c.status === 'failed' ? (
            <Action onClick={onRetry} title={c.error ?? ''} wide>
              <RotateCcw size={13} /> Tentar de novo
            </Action>
          ) : c.review === 'pending' ? (
            <>
              <Action onClick={() => review('approved')} disabled={!ready} tone="primary" wide>
                <Check size={13} /> Aprovar
              </Action>
              <Action onClick={() => review('rejected')} title="Descartar">
                <X size={13} />
              </Action>
            </>
          ) : c.review === 'approved' ? (
            <>
              <Action onClick={() => c.path && void window.api.showInFolder(c.path)} wide>
                <FolderOpen size={13} /> Pasta
              </Action>
              <Action onClick={() => review('pending')} title="Voltar para revisão">
                <Undo2 size={13} />
              </Action>
            </>
          ) : (
            <>
              <Action onClick={() => review('pending')} wide>
                <Undo2 size={13} /> Restaurar
              </Action>
              <Action onClick={() => confirm('Apagar este clipe do disco?') && void window.api.deleteClip(c.id)} title="Apagar do disco">
                <Trash2 size={13} />
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
  tone?: 'primary'
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        wide && 'flex-1',
        tone === 'primary' ? 'bg-accent text-white hover:bg-accent-2' : 'border border-white/20 text-text/80 hover:border-white/35 hover:bg-white/5'
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
        className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-black/30"
      >
        {m.hasThumb ? (
          <img src={`clipador://miniatura/${m.id}`} alt="" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-muted">
            <Sparkles size={16} />
          </span>
        )}
        <span className={cx('absolute left-1.5 top-1.5 rounded bg-gradient-to-br px-1.5 text-[11px] font-bold text-white', scoreTone(m.score))}>{m.score}</span>
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1 text-[10px] tabular-nums text-white">{formatTimecode(m.peakS)}</span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className={cx('line-clamp-2 text-[13px] font-semibold leading-snug', m.ai && !m.ai.keep && 'text-muted')}>{title}</p>
        <p className="truncate text-[11px] text-muted">
          {showLive ? `${m.channelName} · ` : ''}
          {m.game ? `${m.game} · ` : ''}
          {m.clip ? `clipado · ${m.clip.views} views` : m.voice ? `pediu clipe: “${m.voice.phrase}”` : m.ai ? (m.ai.keep ? m.ai.category : 'IA descartou') : m.reasons[0]}
        </p>
        <div className="mt-auto flex items-center gap-1.5 pt-2">
          <Button onClick={onMake}>
            <Clapperboard size={13} /> Gerar clipe
          </Button>
          <button type="button" title="Tirar da lista" onClick={() => void window.api.dismissMoment(m.id)} className="grid size-7 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-text">
            <X size={14} />
          </button>
        </div>
      </div>
    </Card>
  )
}

/** Gráfico do hype ao longo da live (chat em rosa, áudio em dourado) com os momentos marcados. */
function HypeChart({ points, moments }: { points: TimelinePoint[]; moments: MomentRecord[] }) {
  const w = 1000
  const h = 100
  const s0 = points[0].s
  const s1 = points[points.length - 1].s || s0 + 1
  const x = (s: number) => ((s - s0) / (s1 - s0)) * w
  const path = (k: 'chat' | 'audio') => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.s).toFixed(1)},${(h - p[k] * (h - 6) - 3).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-20 w-full rounded-lg bg-black/20">
      <path d={path('audio')} fill="none" stroke="var(--color-gold)" strokeWidth="1.5" opacity="0.8" vectorEffect="non-scaling-stroke" />
      <path d={path('chat')} fill="none" stroke="var(--color-brand)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {moments.map((m) => (
        <line key={m.id} x1={x(m.peakS)} x2={x(m.peakS)} y1={0} y2={h} stroke="white" strokeWidth="1.5" opacity="0.5" vectorEffect="non-scaling-stroke">
          <title>
            {formatTimecode(m.peakS)} · nota {m.score}
          </title>
        </line>
      ))}
    </svg>
  )
}
