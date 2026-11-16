import { useState, type ReactNode } from 'react'
import { AlertTriangle, Clapperboard, Download, Eye, FolderOpen, Link2, Plus, RefreshCw, RotateCcw, Scissors, Square, Trash2, TriangleAlert, X } from 'lucide-react'
import type { ChannelState, LiveRecord, LiveStatus, Platform } from '../../../shared/types'
import { formatTimecode, parseTimecode, parseVodInput } from '../../../shared/vod'
import type { Go } from '../App'
import type { AppState } from '../state'
import { Avatar } from '../Avatar'
import { Badge, Button, Card, Progress, Section, Segmented, Toggle, cx, timeAgo } from '../ui'

const clean = (e: unknown) => ((e as Error).message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const fmtSize = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${Math.round(b / 1024 ** 2)} MB`)
const fmtDuration = (ms: number) => {
  const m = Math.floor(ms / 60000)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}

export default function ChannelsPage({ state, go }: { state: AppState; go: Go }) {
  const { channels, lives, settings } = state
  const sorted = [...channels].sort((a, b) => Number(!!b.recording) - Number(!!a.recording) || Number(!!b.live) - Number(!!a.live))

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Canais</h2>
          <p className="text-sm text-muted">
            Os canais vigiados gravam sozinhos quando entram ao vivo{settings ? ` (verifica a cada ${settings.recorder.pollSeconds} s)` : ''}.
          </p>
        </div>
        <Button variant="ghost" onClick={() => void window.api.checkChannelsNow()}>
          <RefreshCw size={14} /> Verificar agora
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AddChannel />
        <ImportVod state={state} />
      </div>

      <Section title={`Vigiando ${channels.length}`}>
        {channels.length === 0 && <p className="text-sm text-muted">Adicione os streamers de GTA que você quer clipar.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {sorted.map((c) => (
            <ChannelCard key={c.id} c={c} />
          ))}
        </div>
      </Section>

      <Section title="Lives e VODs">
        {lives.length === 0 && <p className="text-sm text-muted">As lives gravadas e os VODs importados aparecem aqui.</p>}
        <div className="space-y-2">
          {lives.map((l) => (
            <LiveRow key={l.id} l={l} state={state} onClips={() => go('clips', { liveId: l.id, tab: 'review' })} />
          ))}
        </div>
      </Section>
    </div>
  )
}

function AddChannel() {
  const [platform, setPlatform] = useState<Platform>('twitch')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const add = async () => {
    if (!input.trim()) return
    setBusy(true)
    setError(null)
    try {
      await window.api.addChannel(platform, input)
      setInput('')
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Plus size={15} className="text-accent" /> Vigiar um canal
      </p>
      <div className="flex items-center gap-2">
        <Segmented
          value={platform}
          onChange={setPlatform}
          options={[
            { value: 'twitch', label: 'Twitch' },
            { value: 'kick', label: 'Kick' }
          ]}
        />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          placeholder="nome ou link do canal"
          className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-3 py-1.5 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
        />
        <Button onClick={() => void add()} disabled={busy || !input.trim()}>
          {busy ? 'Conferindo…' : 'Adicionar'}
        </Button>
      </div>
      {error ? <p className="text-xs text-err">{error}</p> : <p className="text-xs text-muted">Grava vídeo e chat quando o canal abre a live.</p>}
    </Card>
  )
}

/** Importar um VOD por link (com trecho opcional). Também aparece no Início. */
export function ImportVod({ state, compact }: { state: AppState; compact?: boolean }) {
  const [url, setUrl] = useState('')
  const [useRange, setUseRange] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = parseVodInput(url)
  const start = useRange ? parseTimecode(from) : null
  const end = useRange ? parseTimecode(to) : null
  const rangeInvalid = useRange && (Number.isNaN(start) || Number.isNaN(end) || (start != null && end != null && end <= start))

  const submit = async () => {
    if (!ref || rangeInvalid) return
    setBusy(true)
    setError(null)
    try {
      await window.api.importVod(url, start, end)
      setUrl('')
      setFrom('')
      setTo('')
      setUseRange(false)
      await state.refreshLives()
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={cx('space-y-3', compact && 'border-accent/40 bg-gradient-to-br from-accent/15 to-card/40 p-5')}>
      <p className={cx('flex items-center gap-2 font-semibold', compact ? 'text-base' : 'text-sm')}>
        <Download size={compact ? 18 : 15} className="text-accent" /> Clipar uma live que já acabou
      </p>
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-panel px-3 py-1.5 focus-within:border-accent">
          <Link2 size={14} className="shrink-0 text-muted" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            placeholder="cole o link do VOD da Twitch ou da Kick"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted/60"
          />
        </label>
        <Button onClick={() => void submit()} disabled={busy || !ref || rangeInvalid}>
          {busy ? 'Conferindo…' : 'Importar'}
        </Button>
      </div>
      {url && !ref && <p className="text-xs text-warn">Link não reconhecido: use twitch.tv/videos/… ou kick.com/canal/videos/…</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Toggle label="Só um trecho" checked={useRange} onChange={setUseRange} />
        <span className="flex items-center gap-1 text-muted">
          <Scissors size={13} /> Só um trecho
        </span>
        {useRange && (
          <>
            <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="início 1:20:00" className="w-28 rounded-lg border border-line bg-panel px-2 py-1 text-sm outline-none focus:border-accent" />
            <span className="text-muted">até</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="fim (vazio = final)" className="w-36 rounded-lg border border-line bg-panel px-2 py-1 text-sm outline-none focus:border-accent" />
          </>
        )}
      </div>
      {rangeInvalid && <p className="text-xs text-warn">Use h:mm:ss; o fim precisa vir depois do início.</p>}
      {error && (
        <p className="flex items-start gap-1 text-xs text-err">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
    </Card>
  )
}

function ChannelCard({ c }: { c: ChannelState }) {
  const rec = c.recording
  return (
    <Card className={cx('space-y-3', rec && 'border-live/50', !c.enabled && 'opacity-60')}>
      <div className="flex items-center gap-3">
        <Avatar channel={c} size={46} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{c.displayName}</span>
            {rec ? <Badge tone="err">● gravando</Badge> : c.live ? (c.live.isRerun ? <Badge tone="warn">reprise</Badge> : <Badge tone="err">ao vivo</Badge>) : null}
          </div>
          <p className="truncate text-xs text-muted">
            {c.live ? c.live.title || 'Sem título' : c.lastCheckedAt ? `Offline · visto ${timeAgo(c.lastCheckedAt)}` : 'Ainda não verificado'}
          </p>
        </div>
        <Toggle label="Vigiar canal" checked={c.enabled} onChange={(v) => void window.api.setChannelEnabled(c.id, v)} />
      </div>

      {c.live && (
        <p className="flex flex-wrap gap-x-3 text-xs text-muted">
          {c.live.game && <span>{c.live.game}</span>}
          <span className="flex items-center gap-1">
            <Eye size={12} /> {c.live.viewers.toLocaleString('pt-BR')}
          </span>
          <span>no ar há {fmtDuration(Date.now() - c.live.startedAt)}</span>
        </p>
      )}
      {rec && (
        <p className="rounded-lg bg-live/10 px-3 py-2 text-xs">
          {rec.resolution ?? 'Gravando'} · {rec.segments} pedaço(s) · {fmtSize(rec.bytes)} · {rec.chatMessages.toLocaleString('pt-BR')} mensagens
          {rec.restarts ? ` · ${rec.restarts} reinício(s)` : ''}
        </p>
      )}
      {(rec?.lastError || (c.lastError && !c.live)) && (
        <p className="flex items-start gap-1 text-xs text-warn">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" /> {rec?.lastError ?? c.lastError}
        </p>
      )}

      <div className="flex gap-2">
        {rec && (
          <Button variant="ghost" onClick={() => void window.api.stopRecording(c.id)} title="Para esta gravação (volta a gravar na próxima live)">
            <Square size={14} /> Parar
          </Button>
        )}
        <Button
          variant="ghost"
          title="Parar de vigiar (as gravações ficam)"
          onClick={() => confirm(`Parar de vigiar ${c.displayName}? As gravações dele ficam em "Lives e VODs".`) && void window.api.removeChannel(c.id)}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </Card>
  )
}

const STATUS: Record<LiveStatus, { label: string; tone: 'ok' | 'warn' | 'err' | 'muted' | 'accent' } | null> = {
  recording: { label: '● gravando', tone: 'err' },
  interrupted: { label: 'pausada', tone: 'warn' },
  ended: null,
  queued: { label: 'na fila', tone: 'muted' },
  importing: { label: 'baixando', tone: 'accent' },
  imported: null,
  failed: { label: 'falhou', tone: 'err' }
}

function LiveRow({ l, state, onClips }: { l: LiveRecord; state: AppState; onClips: () => void }) {
  const [broken, setBroken] = useState(false)
  const busy = l.status === 'importing' || l.status === 'queued'
  const st = STATUS[l.status]
  const clips = state.clips.filter((c) => c.liveId === l.id)
  const pending = clips.filter((c) => c.review === 'pending').length
  const range = l.rangeStartS != null || l.rangeEndS != null ? `${formatTimecode(l.rangeStartS ?? 0)}–${l.rangeEndS != null ? formatTimecode(l.rangeEndS) : 'fim'}` : null

  return (
    <Card className="flex items-center gap-3 p-3">
      {l.avatarUrl && !broken ? (
        <img src={l.avatarUrl} alt="" onError={() => setBroken(true)} className="size-10 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-panel text-xs font-bold uppercase">{l.channelName.slice(0, 2)}</div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{l.channelName}</span>
          <span className="text-xs text-muted">
            {new Date(l.startedAt).toLocaleDateString('pt-BR')} · {l.kind === 'vod' ? 'VOD' : 'gravada ao vivo'}
            {range ? ` · trecho ${range}` : ''} · {formatTimecode(l.recordedS)} · {fmtSize(l.bytes)}
          </span>
          {st && <Badge tone={st.tone}>{st.label}</Badge>}
        </div>
        <p className="truncate text-xs text-muted" title={l.title}>
          {l.title || 'Sem título'}
        </p>
        {l.status === 'importing' && l.progress != null && <Progress value={l.progress} />}
        {l.error && l.status !== 'imported' && <p className="truncate text-xs text-warn">{l.error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {clips.length > 0 || l.segments > 0 ? (
          <Button onClick={onClips} title="Abrir os clipes desta live">
            <Clapperboard size={14} /> {clips.length ? `${clips.length} clipe(s)${pending ? ` · ${pending} p/ revisar` : ''}` : 'Ver momentos'}
          </Button>
        ) : null}
        {l.dir && (
          <IconBtn title="Abrir a pasta" onClick={() => void window.api.openPath(l.dir!)}>
            <FolderOpen size={15} />
          </IconBtn>
        )}
        {busy && (
          <IconBtn title="Cancelar" onClick={() => void window.api.cancelImport(l.id)}>
            <X size={15} />
          </IconBtn>
        )}
        {(l.status === 'failed' || l.chatStatus === 'failed') && l.kind === 'vod' && (
          <IconBtn title="Tentar de novo" onClick={() => void window.api.retryImport(l.id)}>
            <RotateCcw size={15} />
          </IconBtn>
        )}
        {l.status !== 'recording' && (
          <IconBtn
            title="Apagar a gravação"
            onClick={() =>
              confirm(`Apagar ${l.kind === 'vod' ? 'o VOD' : 'a gravação'} de ${l.channelName} (${fmtSize(l.bytes)})? Os clipes prontos continuam.`) &&
              void window.api.deleteLive(l.id).catch((e) => alert(clean(e)))
            }
          >
            <Trash2 size={15} />
          </IconBtn>
        )}
      </div>
    </Card>
  )
}

function IconBtn({ children, title, onClick }: { children: ReactNode; title: string; onClick: () => void }) {
  return (
    <button type="button" title={title} onClick={onClick} className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-card hover:text-text">
      {children}
    </button>
  )
}
