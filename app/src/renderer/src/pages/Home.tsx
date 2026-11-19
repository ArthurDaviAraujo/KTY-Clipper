import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Captions,
  Check,
  CheckCircle2,
  Clapperboard,
  Cpu,
  Download,
  Eye,
  FolderOpen,
  Inbox,
  Info,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  Radio,
  RotateCcw,
  ScanFace,
  Scissors,
  Share2,
  FolderInput,
  Sparkles,
  X,
  XCircle
} from 'lucide-react'
import { parseTimecode, parseVodInput } from '../../../shared/vod'
import type { AiStatus, ChannelState, LogEntry, MomentRecord } from '../../../shared/types'
import type { Go, HomeView } from '../App'
import type { AppState } from '../state'
import { Avatar } from '../Avatar'
import { BrandIcon } from '../BrandIcon'
import { groupChannels, wherePlatforms } from '../../../shared/channels'
import { ClipCover } from './Clips'
import { Button, Card, MoreMenu, Page, PageHeader, Progress, Row, RowList, Section, SeeAll, Status, Toggle, cx, timeAgo } from '../ui'

const clean = (e: unknown) => ((e as Error).message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
/** "1 clipe" / "2 clipes" */
const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const since = (t: number) => {
  const m = Math.floor((Date.now() - t) / 60000)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`
}

/** Passos essenciais para o app funcionar (o número aparece no menu "Primeiros passos") */
export function setupSteps(state: AppState) {
  const required = state.tools.filter((t) => t.required)
  return [
    { id: 'tools', ok: required.length > 0 && required.every((t) => t.path) },
    { id: 'gpu', ok: !!state.hardware?.encoders.some((e) => e.works) },
    { id: 'channels', ok: state.channels.length > 0 }
  ]
}

/** Quadradinho em degradê com ícone (como os ícones de app da referência) */
function IconTile({ icon: Icon, from, to, size = 36 }: { icon: typeof Inbox; from: string; to: string; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[10px] text-white shadow-lg ring-1 ring-white/15"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${from}, ${to})`
      }}
    >
      <Icon size={size * 0.48} strokeWidth={2.2} />
    </span>
  )
}

export default function HomePage({ state, go, view }: { state: AppState; go: Go; view: HomeView }) {
  if (view === 'activity') return <ActivityView state={state} />
  if (view === 'guide') return <GuideView state={state} go={go} />
  return <Overview state={state} go={go} />
}

/** App recém-instalado (banco vazio): oferece trazer canais, clipes e ajustes de outra pasta "dados". */
function ImportInvite({ state }: { state: AppState }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('clipador:convite-trazer-dados') === '1'
    } catch {
      return false
    }
  })
  const [error, setError] = useState<string | null>(null)
  if (hidden || !state.info?.fresh || state.channels.length || state.clips.length) return null
  const hide = () => {
    setHidden(true)
    try {
      localStorage.setItem('clipador:convite-trazer-dados', '1')
    } catch {
      // sem armazenamento: só não lembra
    }
  }
  return (
    <Card className="flex flex-wrap items-center gap-4 border-violet/30 bg-violet/[0.08] py-4">
      <IconTile icon={FolderInput} from="#8b5cf6" to="#ff3d8b" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Já usava o Clipador antes?</p>
        <p className="text-[13px] text-muted">Traga seus canais, lives, clipes, ajustes e perfis da pasta "dados" que você usava. As gravações e os clipes no disco continuam onde estão.</p>
        {error && <p className="mt-1 text-[12px] text-err">{error}</p>}
      </div>
      <Button onClick={() => void window.api.importData().catch((e) => setError(String(e).replace(/^.*?Error: /, '')))}>
        <FolderInput size={14} /> Trazer meus dados…
      </Button>
      <Button variant="ghost" onClick={hide}>
        Agora não
      </Button>
    </Card>
  )
}

function Overview({ state, go }: { state: AppState; go: Go }) {
  const { channels, clips, jobs, lives, profiles, disk } = state
  const name = profiles?.profiles.find((p) => p.id === profiles.activeId)?.name.split(' ')[0] ?? ''
  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'
  const toReview = clips.filter((c) => c.review === 'pending')
  const approved = clips.filter((c) => c.review === 'approved')
  const onAir = channels.filter((c) => c.live || c.recording)
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued')
  // Um item por streamer (as plataformas dele juntas): gravando primeiro, depois ao vivo, depois a ordem de chegada
  const rank = (g: ChannelState[]) => (g.some((c) => c.recording) ? 2 : g.some((c) => c.live) ? 1 : 0)
  const sorted = groupChannels(channels).sort((a, b) => rank(b) - rank(a))
  const missing = setupSteps(state).filter((s) => !s.ok).length

  const summary = [
    toReview.length ? `${pl(toReview.length, 'clipe', 'clipes')} para revisar` : 'Tudo revisado',
    onAir.length ? `${pl(onAir.length, 'canal', 'canais')} ao vivo` : null,
    active.length ? `${pl(active.length, 'tarefa rodando', 'tarefas rodando')}` : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Page wide>
      <div className="relative">
        <div className="pointer-events-none absolute -left-10 -top-16 h-40 w-96 rounded-full bg-violet/25 blur-3xl" />
        <PageHeader title={`${hello}${name ? `, ${name}` : ''}`} subtitle={summary} />
      </div>

      <ImportInvite state={state} />

      {missing > 0 && (
        <button type="button" onClick={() => go('home', { home: 'guide' })} className="block w-full text-left">
          <Card className="flex items-center gap-4 border-accent/30 bg-accent/[0.08] py-4 transition hover:border-accent/60">
            <IconTile icon={Sparkles} from="#3b7cf6" to="#8b5cf6" />
            <div className="flex-1">
              <p className="text-[15px] font-semibold">Falta pouco para começar</p>
              <p className="text-[13px] text-muted">{missing === 1 ? 'Falta 1 passo essencial.' : `Faltam ${missing} passos essenciais.`} Veja o guia de primeiros passos.</p>
            </div>
            <span className="text-[14px] text-accent-2">Abrir guia ›</span>
          </Card>
        </button>
      )}

      <LiveClipping state={state} go={go} />

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <VodBanner state={state} />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 2xl:grid-cols-2">
          <Metric
            icon={Radio}
            from="#ff453a"
            to="#ff3d8b"
            label="Ao vivo agora"
            value={onAir.length}
            hint={channels.length ? `${pl(channels.length, 'canal vigiado', 'canais vigiados')}` : 'Nenhum canal'}
            onClick={() => go('channels', { channels: 'live' })}
          />
          <Metric icon={Inbox} from="#3b7cf6" to="#6ea0ff" label="Para revisar" value={toReview.length} hint="clipes esperando você" onClick={() => go('clips', { tab: 'review', liveId: 'all' })} />
          <Metric icon={Check} from="#22c55e" to="#34d399" label="Aprovados" value={approved.length} hint="prontos para postar" onClick={() => go('clips', { tab: 'approved', liveId: 'all' })} />
          <Metric
            icon={Clapperboard}
            from="#8b5cf6"
            to="#c084fc"
            label="Gravações"
            value={lives.length}
            hint={disk ? `${disk.recordingsGb.toFixed(1)} GB no disco` : ''}
            onClick={() => go('channels', { channels: 'library' })}
          />
        </div>
      </div>

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <div className="space-y-10">
          <Section title="Para revisar" action={toReview.length > 0 ? <SeeAll onClick={() => go('clips', { tab: 'review', liveId: 'all' })}>Ver todos</SeeAll> : undefined}>
            {toReview.length === 0 ? (
              <Card className="flex items-center gap-4">
                <IconTile icon={CheckCircle2} from="#22c55e" to="#14b8a6" />
                <div>
                  <p className="text-[15px] font-semibold">Tudo revisado</p>
                  <p className="text-[13px] text-muted">Os clipes novos aparecem aqui assim que ficarem prontos.</p>
                </div>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                {toReview.slice(0, 6).map((c) => (
                  <Card key={c.id} className="flex gap-4 p-4">
                    <ClipCover clip={c} className="w-[72px] shrink-0 rounded-xl" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="line-clamp-2 text-[14px] font-semibold leading-snug">{c.title}</p>
                      <p className="mt-1 truncate text-xs text-muted">
                        {c.channelName}
                        {c.tag ? ` · ${c.tag}` : ''}
                      </p>
                      {c.score != null && <p className="mt-1 text-xs text-muted">nota {c.score}</p>}
                      <div className="mt-auto flex items-center justify-end gap-1 pt-3">
                        <Button
                          onClick={() =>
                            go('clips', {
                              tab: 'review',
                              liveId: c.liveId ?? 'all'
                            })
                          }
                        >
                          Revisar
                        </Button>
                        <MoreMenu
                          items={[
                            {
                              label: 'Aprovar',
                              onClick: () => void window.api.reviewClip(c.id, 'approved'),
                              hidden: c.status !== 'ready'
                            },
                            {
                              label: 'Descartar',
                              onClick: () => void window.api.reviewClip(c.id, 'rejected')
                            },
                            {
                              label: 'Mostrar na pasta',
                              onClick: () => c.path && void window.api.showInFolder(c.path),
                              hidden: !c.path
                            }
                          ]}
                        />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Section>
          <Highlights state={state} go={go} />
        </div>

        <div className="space-y-10">
          <Section title="Trabalhando agora" action={<SeeAll onClick={() => go('home', { home: 'activity' })}>Atividade</SeeAll>}>
            <RowList>
              {active.length === 0 && (
                <Row>
                  <span className="text-[13px] text-muted">Nada rodando agora.</span>
                </Row>
              )}
              {active.slice(0, 4).map((j) => (
                <Row key={j.id} className="flex-col items-stretch gap-2">
                  <div className="flex items-center gap-2 text-[13px]">
                    <Loader2 size={14} className={j.status === 'running' ? 'animate-spin text-accent-2' : 'text-muted'} />
                    <span className="min-w-0 flex-1 truncate">{j.label}</span>
                    <span className="text-xs tabular-nums text-muted">{j.status === 'running' ? `${Math.round(j.progress * 100)}%` : 'na fila'}</span>
                  </div>
                  {j.status === 'running' && <Progress value={j.progress} />}
                </Row>
              ))}
            </RowList>
          </Section>

          <Section title="Seus canais" action={<SeeAll onClick={() => go('channels', { channels: 'all' })}>Canais</SeeAll>}>
            <RowList>
              {sorted.length === 0 && (
                <Row>
                  <span className="flex-1 text-[13px] text-muted">Nenhum canal vigiado ainda.</span>
                  <Button variant="ghost" onClick={() => go('channels', { channels: 'all' })}>
                    Adicionar
                  </Button>
                </Row>
              )}
              {sorted.slice(0, 5).map((g) => (
                <ChannelLine key={g[0].id} group={g} go={go} />
              ))}
            </RowList>
          </Section>
        </div>
      </div>

      <Section title="Atalhos">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6">
          <Shortcut icon={Plus} from="#3b7cf6" to="#22d3ee" title="Adicionar canal" text="Grava sozinho ao vivo" onClick={() => go('channels', { channels: 'all' })} />
          <Shortcut icon={Download} from="#ff3d8b" to="#f97316" title="Importar VOD" text="Clipar uma live antiga" onClick={() => go('channels', { channels: 'library' })} />
          <Shortcut icon={Inbox} from="#8b5cf6" to="#ec4899" title="Revisar clipes" text="Aprovar ou descartar" onClick={() => go('clips', { tab: 'review', liveId: 'all' })} />
          <Shortcut icon={FolderOpen} from="#f59e0b" to="#f97316" title="Pasta dos clipes" text="Os vídeos prontos" onClick={() => disk && void window.api.openPath(disk.clipsDir)} />
          <Shortcut icon={Captions} from="#14b8a6" to="#22c55e" title="Estilo da legenda" text="Cor, tamanho, layout" onClick={() => go('settings', { settings: 'visual' })} />
          <Shortcut icon={Share2} from="#6366f1" to="#3b7cf6" title="Passar predefinições" text="Exportar para um amigo" onClick={() => go('settings', { settings: 'perfil' })} />
        </div>
      </Section>

      {approved.length > 0 && (
        <Section title="Aprovados recentemente" action={<SeeAll onClick={() => go('clips', { tab: 'approved', liveId: 'all' })}>Ver todos</SeeAll>}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-4">
            {approved.slice(0, 8).map((c) => (
              <button key={c.id} type="button" onClick={() => go('clips', { tab: 'approved', liveId: 'all' })} className="group text-left">
                <ClipCover clip={c} className="rounded-xl ring-1 ring-white/10 transition group-hover:ring-white/30" />
                <p className="mt-2 line-clamp-2 text-xs font-medium leading-snug">{c.title}</p>
              </button>
            ))}
          </div>
        </Section>
      )}
    </Page>
  )
}

function Metric({ icon, from, to, label, value, hint, onClick }: { icon: typeof Inbox; from: string; to: string; label: string; value: number; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group text-left">
      <Card className="flex h-full flex-col gap-3 transition group-hover:border-white/20 group-hover:bg-white/[0.05]">
        <div className="flex items-center justify-between">
          <IconTile icon={icon} from={from} to={to} size={32} />
          <span className="text-[13px] text-muted opacity-0 transition group-hover:opacity-100">›</span>
        </div>
        <div>
          <p className="font-display text-[34px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
          <p className="mt-1.5 text-[13px] font-medium">{label}</p>
          <p className="truncate text-xs text-muted">{hint}</p>
        </div>
      </Card>
    </button>
  )
}

function Shortcut({ icon, from, to, title, text, onClick }: { icon: typeof Inbox; from: string; to: string; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group text-left">
      <Card className="flex h-full flex-col gap-4 transition group-hover:-translate-y-0.5 group-hover:border-white/20 group-hover:bg-white/[0.05]">
        <IconTile icon={icon} from={from} to={to} size={40} />
        <div>
          <p className="text-[14px] font-semibold">{title}</p>
          <p className="text-xs text-muted">{text}</p>
        </div>
      </Card>
    </button>
  )
}

/**
 * Clipar ao vivo: cada canal gravando agora, o botão "Clipar agora" (últimos ~30 s)
 * e os clipes que já saíram dessa live, poucos minutos depois de cada lance.
 */
function LiveClipping({ state, go }: { state: AppState; go: Go }) {
  const s = state.settings
  const recording = state.channels.filter((c) => c.recording)
  // Ao vivo, mas só vigiando (sem gravar): dá para começar a gravar daqui
  const watching = state.channels.filter((c) => c.enabled && c.live && !c.recording && !c.record)
  const on = !!s?.clips.live.enabled
  const auto = !!s?.clips.auto.enabled
  const hint =
    on && auto
      ? 'Os lances fortes viram clipe uns 3 a 5 min depois, com a live ainda no ar.'
      : on
        ? 'Ligue "Gerar clipes sozinho" em Ajustes > Clipes para os clipes saírem sozinhos.'
        : 'Desligado: os clipes saem 10 a 20 min depois do lance.'
  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03]">
      <div className="pointer-events-none absolute -right-24 -top-28 h-60 w-[28rem] rounded-full bg-[#ff3d8b]/[0.12] blur-3xl" />
      <div className="relative flex flex-wrap items-center gap-4 border-b border-white/[0.06] px-6 py-5">
        <IconTile icon={Radio} from="#ff453a" to="#ff3d8b" size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2.5 font-display text-[19px] font-semibold tracking-tight">
            Clipar ao vivo
            {recording.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-live/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-live">
                <span className="size-1.5 animate-pulse rounded-full bg-live" /> {recording.length} gravando
              </span>
            )}
          </h2>
          <p className="text-[13px] text-muted">{hint}</p>
        </div>
        {s && (
          <div className="flex items-center gap-2.5 text-[13px] text-muted">
            {on ? 'Ligado' : 'Desligado'}
            <Toggle label="Clipar ao vivo" checked={on} onChange={(v) => void state.updateSettings({ clips: { live: { enabled: v } } })} />
          </div>
        )}
      </div>

      <div className="relative p-6">
        {recording.length === 0 ? (
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] px-5 py-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.05] text-muted">
              <Scissors size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">Ninguém gravando agora</p>
              <p className="text-[12.5px] text-muted">
                {watching.length
                  ? 'Escolha abaixo quem gravar: os clipes começam a sair aqui poucos minutos depois de cada lance.'
                  : 'Quando um canal com “Gravar” ligado entrar ao vivo, ele aparece aqui com os clipes saindo na hora.'}
              </p>
            </div>
            <Button variant="ghost" onClick={() => go('channels', { channels: 'all' })}>
              <Plus size={14} /> Canais
            </Button>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
            {recording.map((c) => (
              <LiveClipCard key={c.id} c={c} state={state} go={go} />
            ))}
          </div>
        )}
        {watching.length > 0 && <WatchingOnly channels={watching} />}
      </div>
    </section>
  )
}

/** Canais ao vivo que estão só sendo vigiados: uma linha com "Começar a gravar". */
function WatchingOnly({ channels }: { channels: ChannelState[] }) {
  return (
    <div className="mt-6 space-y-3">
      <p className="flex items-center gap-2 text-[12.5px] text-muted">
        <span className="size-1.5 animate-pulse rounded-full bg-live" />
        Ao vivo agora, só vigiando
        <span className="rounded-full bg-white/[0.06] px-1.5 text-[11px] tabular-nums text-text/80">{channels.length}</span>
        <span className="text-muted/70">· ainda sem gravar</span>
      </p>
      <div className="grid gap-2.5 lg:grid-cols-2 2xl:grid-cols-3">
        {[...channels]
          .sort((a, b) => (b.live?.viewers ?? 0) - (a.live?.viewers ?? 0))
          .map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 transition hover:border-white/[0.13]">
              <Avatar channel={c} size={34} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-[13.5px] font-medium">
                  {c.displayName}
                  <span className="shrink-0 rounded bg-live/15 px-1 text-[9.5px] font-bold uppercase tracking-wide text-live">ao vivo</span>
                </p>
                <p className="flex items-center gap-1 truncate text-[11.5px] text-muted">
                  <span className="truncate">{c.live?.game ?? 'Sem categoria'}</span>
                  {c.live?.viewers ? (
                    <span className="flex shrink-0 items-center gap-1">
                      · <Eye size={11} /> {c.live.viewers.toLocaleString('pt-BR')}
                    </span>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void window.api.setChannelRecord(c.id, true)}
                title="Começa a gravar esta live agora (e as próximas deste canal); os clipes saem sozinhos"
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-live/30 bg-live/10 px-3 py-1 text-[12px] font-medium text-live transition hover:bg-live/20"
              >
                <span className="size-2 rounded-full bg-live" /> Gravar
              </button>
            </div>
          ))}
      </div>
    </div>
  )
}

const LIVE_SLOTS = 4

function LiveClipCard({ c, state, go }: { c: ChannelState; state: AppState; go: Go }) {
  const rec = c.recording!
  const [asked, setAsked] = useState<number[]>([])
  const [err, setErr] = useState('')
  const liveClips = state.clips.filter((k) => k.liveId === rec.liveId).sort((a, b) => b.id - a.id)
  // Pedido de "Clipar agora" sai da espera quando aparece um clipe novo desta live depois dele
  const newest = liveClips[0]?.createdAt ?? 0
  const waiting = asked.filter((t) => newest < t && Date.now() - t < 7 * 60_000)
  const clipNow = async () => {
    setErr('')
    try {
      const t = await window.api.clipNow(rec.liveId)
      setAsked((a) => [...a, t])
    } catch (e) {
      setErr(clean(e))
    }
  }
  const open = (tab: 'review' | 'approved' | 'rejected') => go('clips', { tab, liveId: rec.liveId })
  const shown = liveClips.slice(0, LIVE_SLOTS)
  return (
    <div className="flex flex-col rounded-2xl border border-white/[0.08] bg-[#1c1828]/70 p-4 transition hover:border-white/[0.14]">
      <div className="flex items-center gap-3">
        <Avatar channel={c} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{c.displayName}</p>
          <p className="truncate text-xs text-muted">
            {c.live?.game ?? 'Sem categoria'}
            {c.live?.viewers ? ` · ${c.live.viewers.toLocaleString('pt-BR')} assistindo` : ''}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-live/15 px-2 py-0.5 text-[11px] tabular-nums text-live" title="Gravando há">
          {since(c.live?.startedAt ?? rec.startedAt)}
        </span>
      </div>

      {/* Sempre 4 espaços: os clipes desta live (o mais novo primeiro) e o resto vazio */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        {shown.map((k) => (
          <button
            key={k.id}
            type="button"
            title={k.title}
            onClick={() => open(k.review === 'approved' ? 'approved' : k.review === 'rejected' ? 'rejected' : 'review')}
            className="relative overflow-hidden rounded-lg ring-1 ring-white/10 transition hover:ring-white/40"
          >
            <ClipCover clip={k} className="rounded-lg" />
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-4 text-left text-[10px] leading-tight text-white">
              {k.status === 'ready' ? timeAgo(k.createdAt) : k.status === 'failed' ? 'falhou' : 'gerando…'}
            </span>
          </button>
        ))}
        {Array.from({ length: LIVE_SLOTS - shown.length }, (_, i) => (
          <div key={`v${i}`} className="grid aspect-[9/16] place-items-center rounded-lg border border-dashed border-white/[0.09] bg-white/[0.015]">
            {i === 0 && waiting.length > 0 ? <Loader2 size={15} className="animate-spin text-muted" /> : <Scissors size={14} className="text-white/15" />}
          </div>
        ))}
      </div>

      <p className={cx('mt-3 min-h-[18px] truncate text-[12px]', err ? 'text-err' : 'text-muted')}>
        {err ||
          (waiting.length
            ? `Gerando ${pl(waiting.length, 'clipe pedido', 'clipes pedidos')}… fica pronto em 1 a 2 min`
            : liveClips.length
              ? `${pl(liveClips.length, 'clipe', 'clipes')} desta live · último ${timeAgo(liveClips[0].createdAt)}`
              : 'Nenhum clipe ainda: os lances fortes viram clipe sozinhos.')}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <Button className="flex-1 justify-center" onClick={() => void clipNow()} title="Faz um clipe dos últimos ~30 s. Fica pronto em 1 a 2 min (o pedaço gravado fecha e o clipe é gerado).">
          <Scissors size={14} /> Clipar agora
        </Button>
        <Button variant="ghost" onClick={() => open('review')}>
          Ver clipes
        </Button>
      </div>
    </div>
  )
}

/** Os melhores lances das últimas 24 h, de todas as lives (com ou sem clipe). */
function Highlights({ state, go }: { state: AppState; go: Go }) {
  const [moments, setMoments] = useState<MomentRecord[]>([])
  useEffect(() => {
    const load = () => void window.api.listMoments().then(setMoments)
    load()
    return window.api.onMoments(() => load())
  }, [])
  const startOf = new Map(state.lives.map((l) => [l.id, l.startedAt]))
  const clipOf = new Map(state.clips.filter((c) => c.momentId != null).map((c) => [c.momentId!, c]))
  const day = Date.now() - 24 * 3600_000
  const best = moments
    .filter((m) => m.status !== 'dismissed' && (startOf.get(m.liveId) ?? 0) + m.peakS * 1000 >= day && !(m.ai && !m.ai.keep))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
  return (
    <Section title="Destaques de hoje" action={best.length > 0 ? <SeeAll onClick={() => go('clips', { tab: 'moments', liveId: 'all' })}>Momentos</SeeAll> : undefined}>
      {best.length === 0 ? (
        <Card className="flex items-center gap-4">
          <IconTile icon={Sparkles} from="#f59e0b" to="#ff3d8b" />
          <div>
            <p className="text-[15px] font-semibold">Nenhum lance forte nas últimas 24 h</p>
            <p className="text-[13px] text-muted">Os melhores momentos das lives gravadas hoje aparecem aqui, com a nota de cada um.</p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {best.map((m) => {
            const clip = clipOf.get(m.id)
            const when = (startOf.get(m.liveId) ?? 0) + m.peakS * 1000
            return (
              <button
                key={m.id}
                type="button"
                onClick={() =>
                  go(
                    'clips',
                    clip
                      ? {
                          tab: clip.review === 'approved' ? 'approved' : clip.review === 'rejected' ? 'rejected' : 'review',
                          liveId: m.liveId
                        }
                      : { tab: 'moments', liveId: m.liveId }
                  )
                }
                className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035] text-left transition hover:border-white/20 hover:bg-white/[0.05]"
              >
                <div className="relative aspect-video bg-black/30">
                  {m.hasThumb ? (
                    <img src={`clipador://miniatura/${m.id}`} alt="" className="size-full object-cover transition group-hover:scale-[1.03]" />
                  ) : (
                    <Sparkles size={18} className="absolute inset-0 m-auto text-muted" />
                  )}
                  <span
                    className={cx(
                      'absolute left-2 top-2 rounded-md px-1.5 text-[11px] font-bold text-white',
                      m.score >= 70 ? 'bg-gradient-to-br from-[#ff2d55] to-gold' : 'bg-gradient-to-br from-accent to-violet'
                    )}
                  >
                    {m.score}
                  </span>
                  <span className={cx('absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-medium', clip ? 'bg-ok/90 text-white' : 'bg-black/70 text-white')}>
                    {clip ? 'com clipe' : 'sem clipe'}
                  </span>
                </div>
                <div className="p-3">
                  <p className="line-clamp-1 text-[13px] font-semibold">{m.ai?.titlePt || m.reasons[0] || 'Momento'}</p>
                  <p className="truncate text-[11px] text-muted">
                    {m.channelName}
                    {m.game ? ` · ${m.game}` : ''} · {timeAgo(when)}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </Section>
  )
}

/** Linha de canal: foto, nome, status com bolinha e a ação principal */
function ChannelLine({ group, go }: { group: ChannelState[]; go: Go }) {
  const c = group.find((x) => x.recording) ?? group.find((x) => x.live) ?? group[0]
  const rec = c.recording
  const liveOn = group.filter((x) => x.live)
  const pic = group.find((x) => x.avatarUrl) ?? c
  return (
    <Row>
      <Avatar channel={{ ...pic, live: c.live, recording: rec }} size={30} badge={group.length === 1} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
          {c.displayName}
          {group.length > 1 && (
            <span className="inline-flex items-center gap-1">
              {group.map((x) => (
                <BrandIcon key={x.id} brand={x.platform} size={10} />
              ))}
            </span>
          )}
        </p>
        {rec ? (
          <Status tone="live">Gravando há {since(c.live?.startedAt ?? Date.now())}</Status>
        ) : c.live ? (
          <Status tone="info">Ao vivo{group.length > 1 ? ` ${wherePlatforms(liveOn.map((x) => x.platform), group.length)}` : ''}</Status>
        ) : (
          <Status tone="muted">
            Offline
            {c.lastCheckedAt ? ` · visto ${timeAgo(c.lastCheckedAt)}` : ''}
          </Status>
        )}
      </div>
      {rec ? (
        <Button onClick={() => go('clips', { liveId: rec.liveId, tab: 'review' })}>Clipes</Button>
      ) : (
        <Button variant="ghost" onClick={() => go('channels', { channels: c.id })}>
          Abrir
        </Button>
      )}
    </Row>
  )
}

/** Banner colorido (formas 3D em CSS) com o campo para clipar um VOD */
function VodBanner({ state }: { state: AppState }) {
  const [url, setUrl] = useState('')
  const [useRange, setUseRange] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null)
  const ref = parseVodInput(url)
  const start = useRange ? parseTimecode(from) : null
  const end = useRange ? parseTimecode(to) : null
  const rangeInvalid = useRange && (Number.isNaN(start) || Number.isNaN(end) || (start != null && end != null && end <= start))

  const submit = async () => {
    if (!ref || rangeInvalid) return
    setBusy(true)
    setMsg(null)
    try {
      await window.api.importVod(url, start, end)
      setUrl('')
      setFrom('')
      setTo('')
      setUseRange(false)
      setMsg({
        text: 'Importando. Os momentos aparecem em Clipes quando terminar.'
      })
      await state.refreshLives()
    } catch (e) {
      setMsg({ text: clean(e), err: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-[250px] items-center overflow-hidden rounded-3xl bg-gradient-to-r from-[#ff2d78] via-[#a43cf0] to-[#ff7a45] p-8 shadow-[0_24px_70px_-24px_rgba(168,60,240,0.7)]">
      {/* Formas */}
      <span className="float absolute right-[24%] top-8 size-10 rounded-full bg-[radial-gradient(circle_at_30%_30%,#ffd1e8,#a43cf0_60%,#5b1d9e)] shadow-lg" />
      <span className="float absolute bottom-10 right-[36%] size-9 rounded-lg bg-gradient-to-br from-[#ff9a62] to-[#e8335f] shadow-lg" style={{ ['--r' as string]: '28deg', animationDelay: '-2s' }} />
      <span
        className="float absolute right-[31%] top-[22%] size-7 rotate-12 bg-gradient-to-br from-[#ffb36b] to-[#ff3d6e] [clip-path:polygon(50%_0,100%_100%,0_100%)]"
        style={{ animationDelay: '-4s' }}
      />
      <span
        className="float absolute -right-8 top-1/2 size-48 -translate-y-1/2 rounded-full border-[30px] border-[#c79bff] opacity-90 shadow-[inset_0_10px_24px_rgba(255,255,255,0.45),0_10px_40px_rgba(80,20,160,0.5)]"
        style={{ animationDelay: '-1s' }}
      />
      <span className="float absolute right-[14%] top-6 size-4 rounded-full bg-[radial-gradient(circle_at_30%_30%,#fff,#8b5cf6)]" style={{ animationDelay: '-3s' }} />
      <span className="float absolute bottom-8 right-[20%] size-5 rounded-full bg-[radial-gradient(circle_at_30%_30%,#fff,#ff7a45)]" style={{ animationDelay: '-5s' }} />

      <div className="relative w-full max-w-xl space-y-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-black/30 text-white ring-1 ring-white/20">
            <Download size={18} />
          </span>
          <p className="font-display text-[24px] font-semibold tracking-tight text-white">Clipar uma live que já acabou</p>
        </div>
        <p className="text-[14px] leading-relaxed text-white/85">Cole o link do VOD da Twitch ou da Kick. O app baixa, acha os melhores momentos e gera os clipes verticais.</p>
        <div className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-black/30 px-4 py-2 ring-1 ring-white/20 focus-within:ring-white/60">
            <Link2 size={15} className="shrink-0 text-white/70" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              placeholder="twitch.tv/videos/…, kick.com/canal/videos/… ou youtube.com/watch?v=…"
              className="w-full bg-transparent text-[14px] text-white outline-none placeholder:text-white/55"
            />
          </label>
          <Button onClick={() => void submit()} disabled={busy || !ref || rangeInvalid} className="py-2">
            {busy ? 'Conferindo…' : 'Importar'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-white/85">
          <Toggle label="Só um trecho" checked={useRange} onChange={setUseRange} />
          <span className="flex items-center gap-1">
            <Scissors size={13} /> Só um trecho
          </span>
          {useRange && (
            <>
              <input
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="início 1:20:00"
                className="w-28 rounded-full bg-black/30 px-3 py-0.5 text-white outline-none ring-1 ring-white/20 placeholder:text-white/50"
              />
              <span>até</span>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="fim (vazio = final)"
                className="w-36 rounded-full bg-black/30 px-3 py-0.5 text-white outline-none ring-1 ring-white/20 placeholder:text-white/50"
              />
            </>
          )}
        </div>
        {url && !ref && <p className="text-xs text-white">Link não reconhecido: use um VOD da Twitch ou da Kick.</p>}
        {rangeInvalid && <p className="text-xs text-white">Use h:mm:ss; o fim precisa vir depois do início.</p>}
        {msg && <p className={msg.err ? 'text-xs font-medium text-[#ffe3e3]' : 'text-xs text-white'}>{msg.text}</p>}
      </div>
    </div>
  )
}

/** Mensagens repetidas viram uma só */
function tidy(logs: LogEntry[], max = 60): LogEntry[] {
  const out: LogEntry[] = []
  for (const l of [...logs].reverse()) {
    if (out.some((x) => x.message === l.message)) continue
    out.push(l)
    if (out.length >= max) break
  }
  return out
}

/** Início > Atividade: tarefas (rodando, falharam, concluídas) e avisos, em tela cheia */
function ActivityView({ state }: { state: AppState }) {
  const active = state.jobs.filter((j) => j.status === 'running' || j.status === 'queued')
  const failed = state.jobs.filter((j) => j.status === 'failed' && j.finishedAt)
  const done = state.jobs.filter((j) => j.status === 'done').slice(0, 15)
  const notices = useMemo(() => tidy(state.logs), [state.logs])

  return (
    <Page wide>
      <PageHeader
        title="Atividade"
        subtitle={active.length ? `${pl(active.length, 'tarefa', 'tarefas')} em andamento` : 'Nada rodando agora'}
        action={
          <Button variant="ghost" onClick={() => void state.clearFinishedJobs()}>
            Limpar concluídas
          </Button>
        }
      />
      <div className="grid gap-10 xl:grid-cols-2">
        <div className="space-y-10">
          <Section title="Em andamento">
            <RowList>
              {active.length === 0 && (
                <Row>
                  <span className="text-[13px] text-muted">Nada rodando agora.</span>
                </Row>
              )}
              {active.map((j) => (
                <Row key={j.id} className="flex-col items-stretch gap-2">
                  <div className="flex items-center gap-2 text-[13px]">
                    <Loader2 size={14} className={j.status === 'running' ? 'animate-spin text-accent-2' : 'text-muted'} />
                    <span className="min-w-0 flex-1 truncate">{j.label}</span>
                    <span className="text-xs tabular-nums text-muted">{j.status === 'running' ? `${Math.round(j.progress * 100)}%` : 'na fila'}</span>
                    <button type="button" title="Cancelar" onClick={() => void window.api.cancelJob(j.id)} className="text-muted hover:text-err">
                      <X size={14} />
                    </button>
                  </div>
                  <Progress value={j.status === 'running' ? j.progress : 0} />
                </Row>
              ))}
            </RowList>
          </Section>
          {failed.length > 0 && (
            <Section title="Falharam">
              <RowList>
                {failed.slice(0, 10).map((j) => (
                  <Row key={j.id}>
                    <XCircle size={15} className="shrink-0 text-err" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px]">{j.label}</p>
                      <p className="line-clamp-2 text-xs text-err">{j.error}</p>
                    </div>
                    <Button variant="ghost" onClick={() => void window.api.retryJob(j.id)}>
                      <RotateCcw size={13} /> De novo
                    </Button>
                  </Row>
                ))}
              </RowList>
            </Section>
          )}
          <Section title="Concluídas">
            <RowList>
              {done.length === 0 && (
                <Row>
                  <span className="text-[13px] text-muted">Nenhuma ainda.</span>
                </Row>
              )}
              {done.map((j) => (
                <Row key={j.id}>
                  <CheckCircle2 size={15} className="shrink-0 text-ok" />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{j.label}</span>
                  <span className="text-xs text-muted">{j.finishedAt ? timeAgo(j.finishedAt) : ''}</span>
                </Row>
              ))}
            </RowList>
          </Section>
        </div>
        <Section title="Avisos">
          <RowList>
            {notices.length === 0 && (
              <Row>
                <span className="text-[13px] text-muted">Sem avisos.</span>
              </Row>
            )}
            {notices.map((l) => (
              <Row key={l.id} className="items-start">
                {l.level === 'error' ? (
                  <XCircle size={15} className="mt-0.5 shrink-0 text-err" />
                ) : l.level === 'warn' ? (
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
                ) : /pronto|conclu|funcionam/i.test(l.message) ? (
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" />
                ) : (
                  <Info size={15} className="mt-0.5 shrink-0 text-muted" />
                )}
                <p className="min-w-0 flex-1 break-words text-[13px] text-text/90">{l.message}</p>
                <span className="shrink-0 text-xs text-muted">{timeAgo(l.time)}</span>
              </Row>
            ))}
          </RowList>
        </Section>
      </div>
    </Page>
  )
}

/** Início > Primeiros passos: o caminho do zero até o clipe aprovado, com o que já foi feito marcado */
function GuideView({ state, go }: { state: AppState; go: Go }) {
  const [ai, setAi] = useState<AiStatus | null>(null)
  useEffect(() => {
    void window.api.aiStatus().then(setAi)
  }, [])
  const [tools, gpu, channels] = setupSteps(state)
  const steps: {
    done: boolean
    icon: typeof Inbox
    from: string
    to: string
    title: string
    text: string
    action: ReactNode
    optional?: boolean
  }[] = [
    {
      done: tools.ok,
      icon: Cpu,
      from: '#64748b',
      to: '#3b7cf6',
      title: 'Programas essenciais',
      text: 'FFmpeg, yt-dlp, Streamlink e Whisper na pasta "programas".',
      action: (
        <Button variant="ghost" onClick={() => go('settings', { settings: 'sistema' })}>
          Ver programas
        </Button>
      )
    },
    {
      done: gpu.ok,
      icon: Cpu,
      from: '#ef4444',
      to: '#f97316',
      title: 'Placa de vídeo testada',
      text: 'O app testa cada codificador e usa o mais rápido para gerar os clipes.',
      action: (
        <Button variant="ghost" onClick={() => void window.api.testEncoders()}>
          Testar agora
        </Button>
      )
    },
    {
      done: !!ai?.hasKey,
      icon: KeyRound,
      from: '#f59e0b',
      to: '#eab308',
      title: 'Chave grátis do Gemini',
      text: 'A KaTY dá título, hashtags e confere cada momento.',
      action: (
        <Button variant="ghost" onClick={() => go('settings', { settings: 'ia' })}>
          Configurar
        </Button>
      )
    },
    {
      done: channels.ok,
      icon: Plus,
      from: '#3b7cf6',
      to: '#22d3ee',
      title: 'Adicionar os canais',
      text: 'Twitch ou Kick. A gravação começa sozinha quando abrirem a live.',
      action: <Button onClick={() => go('channels', { channels: 'all' })}>Adicionar</Button>
    },
    {
      done: state.lives.length > 0,
      icon: Download,
      from: '#ff3d8b',
      to: '#f97316',
      title: 'Testar com um VOD',
      text: 'Importe uma live que já acabou para ver os momentos e clipes saindo.',
      action: (
        <Button variant="ghost" onClick={() => go('channels', { channels: 'library' })}>
          Importar
        </Button>
      )
    },
    {
      done: state.clips.some((c) => c.review === 'approved'),
      icon: Inbox,
      from: '#8b5cf6',
      to: '#ec4899',
      title: 'Revisar e aprovar',
      text: 'Assista, aprove ou descarte. Os aprovados ficam prontos para postar.',
      action: (
        <Button variant="ghost" onClick={() => go('clips', { tab: 'review', liveId: 'all' })}>
          Revisar
        </Button>
      )
    },
    {
      done: false,
      optional: true,
      icon: ScanFace,
      from: '#14b8a6',
      to: '#22c55e',
      title: 'Marcar a facecam',
      text: 'Uma vez por canal, para o layout jogo + facecam. Feito na janela "Gerar clipe".',
      action: (
        <Button variant="ghost" onClick={() => go('clips', { tab: 'moments', liveId: 'all' })}>
          Abrir momentos
        </Button>
      )
    },
    {
      done: false,
      optional: true,
      icon: Share2,
      from: '#6366f1',
      to: '#3b7cf6',
      title: 'Passar para os amigos',
      text: 'Exporte suas predefinições e mande o arquivo; eles importam no PC deles.',
      action: (
        <Button variant="ghost" onClick={() => go('settings', { settings: 'perfil' })}>
          Exportar
        </Button>
      )
    }
  ]
  const required = steps.filter((s) => !s.optional)
  const doneCount = required.filter((s) => s.done).length

  return (
    <Page wide>
      <PageHeader title="Primeiros passos" subtitle={`${doneCount} de ${required.length} feitos. Do zero até o primeiro clipe aprovado.`} />
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-accent via-violet to-brand transition-all" style={{ width: `${(doneCount / required.length) * 100}%` }} />
      </div>
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {steps.map((s, i) => (
          <Card key={s.title} className={cx('flex flex-col gap-4', s.done && 'border-ok/30 bg-ok/[0.05]')}>
            <div className="flex items-center justify-between">
              <IconTile icon={s.icon} from={s.from} to={s.to} size={38} />
              {s.done ? (
                <span className="flex items-center gap-1 text-xs font-medium text-ok">
                  <CheckCircle2 size={14} /> Feito
                </span>
              ) : (
                <span className="text-xs text-muted">{s.optional ? 'Opcional' : `Passo ${i + 1}`}</span>
              )}
            </div>
            <div className="flex-1">
              <p className="text-[15px] font-semibold">{s.title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{s.text}</p>
            </div>
            {!s.done && <div>{s.action}</div>}
          </Card>
        ))}
      </div>
    </Page>
  )
}
