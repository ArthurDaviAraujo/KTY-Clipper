import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Captions,
  Check,
  CheckCircle2,
  Clapperboard,
  Cpu,
  Download,
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
  Sparkles,
  X,
  XCircle
} from 'lucide-react'
import { parseTimecode, parseVodInput } from '../../../shared/vod'
import type { AiStatus, ChannelState, LogEntry } from '../../../shared/types'
import type { Go, HomeView } from '../App'
import type { AppState } from '../state'
import { Avatar } from '../Avatar'
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
    <span className="grid shrink-0 place-items-center rounded-[10px] text-white shadow-lg ring-1 ring-white/15" style={{ width: size, height: size, background: `linear-gradient(135deg, ${from}, ${to})` }}>
      <Icon size={size * 0.48} strokeWidth={2.2} />
    </span>
  )
}

export default function HomePage({ state, go, view }: { state: AppState; go: Go; view: HomeView }) {
  if (view === 'activity') return <ActivityView state={state} />
  if (view === 'guide') return <GuideView state={state} go={go} />
  return <Overview state={state} go={go} />
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
  const sorted = [...channels].sort((a, b) => Number(!!b.recording) - Number(!!a.recording) || Number(!!b.live) - Number(!!a.live))
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

      {missing > 0 && (
        <button type="button" onClick={() => go('home', { home: 'guide' })} className="block w-full text-left">
          <Card className="flex items-center gap-4 border-accent/30 bg-accent/[0.08] py-4 transition hover:border-accent/60">
            <IconTile icon={Sparkles} from="#3b7cf6" to="#8b5cf6" />
            <div className="flex-1">
              <p className="text-[15px] font-semibold">Falta pouco para começar</p>
              <p className="text-[13px] text-muted">
                {missing === 1 ? 'Falta 1 passo essencial.' : `Faltam ${missing} passos essenciais.`} Veja o guia de primeiros passos.
              </p>
            </div>
            <span className="text-[14px] text-accent-2">Abrir guia ›</span>
          </Card>
        </button>
      )}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <VodBanner state={state} />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 2xl:grid-cols-2">
          <Metric icon={Radio} from="#ff453a" to="#ff3d8b" label="Ao vivo agora" value={onAir.length} hint={channels.length ? `${pl(channels.length, 'canal vigiado', 'canais vigiados')}` : 'Nenhum canal'} onClick={() => go('channels', { channels: 'live' })} />
          <Metric icon={Inbox} from="#3b7cf6" to="#6ea0ff" label="Para revisar" value={toReview.length} hint="clipes esperando você" onClick={() => go('clips', { tab: 'review', liveId: 'all' })} />
          <Metric icon={Check} from="#22c55e" to="#34d399" label="Aprovados" value={approved.length} hint="prontos para postar" onClick={() => go('clips', { tab: 'approved', liveId: 'all' })} />
          <Metric icon={Clapperboard} from="#8b5cf6" to="#c084fc" label="Gravações" value={lives.length} hint={disk ? `${disk.recordingsGb.toFixed(1)} GB no disco` : ''} onClick={() => go('channels', { channels: 'library' })} />
        </div>
      </div>

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
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
                      <Button onClick={() => go('clips', { tab: 'review', liveId: c.liveId ?? 'all' })}>Revisar</Button>
                      <MoreMenu
                        items={[
                          { label: 'Aprovar', onClick: () => void window.api.reviewClip(c.id, 'approved'), hidden: c.status !== 'ready' },
                          { label: 'Descartar', onClick: () => void window.api.reviewClip(c.id, 'rejected') },
                          { label: 'Mostrar na pasta', onClick: () => c.path && void window.api.showInFolder(c.path), hidden: !c.path }
                        ]}
                      />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Section>

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
              {sorted.slice(0, 5).map((c) => (
                <ChannelLine key={c.id} c={c} go={go} />
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
          <Shortcut icon={Captions} from="#14b8a6" to="#22c55e" title="Estilo da legenda" text="Cor, tamanho, layout" onClick={() => go('settings', { settings: 'clipes' })} />
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

/** Linha de canal: foto, nome, status com bolinha e a ação principal */
function ChannelLine({ c, go }: { c: ChannelState; go: Go }) {
  const rec = c.recording
  return (
    <Row>
      <Avatar channel={c} size={30} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{c.displayName}</p>
        {rec ? (
          <Status tone="live">Gravando há {since(c.live?.startedAt ?? Date.now())}</Status>
        ) : c.live ? (
          <Status tone="info">Ao vivo</Status>
        ) : (
          <Status tone="muted">Offline{c.lastCheckedAt ? ` · visto ${timeAgo(c.lastCheckedAt)}` : ''}</Status>
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
      setMsg({ text: 'Importando. Os momentos aparecem em Clipes quando terminar.' })
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
      <span
        className="float absolute bottom-10 right-[36%] size-9 rounded-lg bg-gradient-to-br from-[#ff9a62] to-[#e8335f] shadow-lg"
        style={{ ['--r' as string]: '28deg', animationDelay: '-2s' }}
      />
      <span className="float absolute right-[31%] top-[22%] size-7 rotate-12 bg-gradient-to-br from-[#ffb36b] to-[#ff3d6e] [clip-path:polygon(50%_0,100%_100%,0_100%)]" style={{ animationDelay: '-4s' }} />
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
              placeholder="twitch.tv/videos/… ou kick.com/canal/videos/…"
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
              <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="início 1:20:00" className="w-28 rounded-full bg-black/30 px-3 py-0.5 text-white outline-none ring-1 ring-white/20 placeholder:text-white/50" />
              <span>até</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="fim (vazio = final)" className="w-36 rounded-full bg-black/30 px-3 py-0.5 text-white outline-none ring-1 ring-white/20 placeholder:text-white/50" />
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
  const steps: { done: boolean; icon: typeof Inbox; from: string; to: string; title: string; text: string; action: ReactNode; optional?: boolean }[] = [
    {
      done: tools.ok,
      icon: Cpu,
      from: '#64748b',
      to: '#3b7cf6',
      title: 'Programas essenciais',
      text: 'FFmpeg, yt-dlp, Streamlink e Whisper na pasta "programas".',
      action: <Button variant="ghost" onClick={() => go('settings', { settings: 'sistema' })}>Ver programas</Button>
    },
    {
      done: gpu.ok,
      icon: Cpu,
      from: '#ef4444',
      to: '#f97316',
      title: 'Placa de vídeo testada',
      text: 'O app testa cada codificador e usa o mais rápido para gerar os clipes.',
      action: <Button variant="ghost" onClick={() => void window.api.testEncoders()}>Testar agora</Button>
    },
    {
      done: !!ai?.hasKey,
      icon: KeyRound,
      from: '#f59e0b',
      to: '#eab308',
      title: 'Chave grátis do Gemini',
      text: 'A IA dá título, hashtags e confere cada momento.',
      action: <Button variant="ghost" onClick={() => go('settings', { settings: 'ia' })}>Configurar</Button>
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
      action: <Button variant="ghost" onClick={() => go('channels', { channels: 'library' })}>Importar</Button>
    },
    {
      done: state.clips.some((c) => c.review === 'approved'),
      icon: Inbox,
      from: '#8b5cf6',
      to: '#ec4899',
      title: 'Revisar e aprovar',
      text: 'Assista, aprove ou descarte. Os aprovados ficam prontos para postar.',
      action: <Button variant="ghost" onClick={() => go('clips', { tab: 'review', liveId: 'all' })}>Revisar</Button>
    },
    {
      done: false,
      optional: true,
      icon: ScanFace,
      from: '#14b8a6',
      to: '#22c55e',
      title: 'Marcar a facecam',
      text: 'Uma vez por canal, para o layout jogo + facecam. Feito na janela "Gerar clipe".',
      action: <Button variant="ghost" onClick={() => go('clips', { tab: 'moments', liveId: 'all' })}>Abrir momentos</Button>
    },
    {
      done: false,
      optional: true,
      icon: Share2,
      from: '#6366f1',
      to: '#3b7cf6',
      title: 'Passar para os amigos',
      text: 'Exporte suas predefinições e mande o arquivo; eles importam no PC deles.',
      action: <Button variant="ghost" onClick={() => go('settings', { settings: 'perfil' })}>Exportar</Button>
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
