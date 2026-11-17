import { useState } from 'react'
import { AlertTriangle, Link2, RefreshCw, Scissors, TriangleAlert } from 'lucide-react'
import type { ChannelState, LiveRecord, LiveStatus, Platform } from '../../../shared/types'
import { formatTimecode, parseTimecode, parseVodInput } from '../../../shared/vod'
import type { ChannelsView, Go } from '../App'
import type { AppState } from '../state'
import { Avatar } from '../Avatar'
import { Button, Card, MoreMenu, PageHeader, Progress, Row, RowList, Section, Segmented, Status, Toggle, timeAgo } from '../ui'

const clean = (e: unknown) => ((e as Error).message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const fmtSize = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${Math.round(b / 1024 ** 2)} MB`)
const since = (t: number) => {
  const m = Math.floor((Date.now() - t) / 60000)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`
}
const channelLink = (c: { platform: Platform; login: string }) => (c.platform === 'twitch' ? `https://www.twitch.tv/${c.login}` : `https://kick.com/${c.login}`)

export default function ChannelsPage({ state, go, view, setView }: { state: AppState; go: Go; view: ChannelsView; setView: (v: ChannelsView) => void }) {
  const { channels, lives, settings } = state
  const one = typeof view === 'number' ? (channels.find((c) => c.id === view) ?? null) : null
  const sorted = [...channels].sort((a, b) => Number(!!b.recording) - Number(!!a.recording) || Number(!!b.live) - Number(!!a.live))
  const list = view === 'live' ? sorted.filter((c) => c.live || c.recording) : one ? [one] : sorted
  const libraryFor = one ? lives.filter((l) => l.channelLogin === one.login && l.platform === one.platform) : lives

  const title = one ? one.displayName : view === 'live' ? 'Ao vivo' : view === 'library' ? 'Lives e VODs' : 'Todos os canais'
  const subtitle =
    view === 'library'
      ? 'Lives gravadas e VODs importados. Abra uma para ver os clipes.'
      : `Os canais vigiados gravam sozinhos quando entram ao vivo${settings ? ` (verifica a cada ${settings.recorder.pollSeconds} s)` : ''}.`

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
        action={
          <Button variant="ghost" onClick={() => void window.api.checkChannelsNow()}>
            <RefreshCw size={13} /> Verificar agora
          </Button>
        }
      />

      {view === 'all' && <AddChannel />}
      {view === 'library' && <ImportVod state={state} />}

      {view !== 'library' && (
        <Section title={one ? 'Canal' : view === 'live' ? 'Ao vivo agora' : 'Vigiando'}>
          <RowList>
            {list.length === 0 && (
              <Row>
                <span className="text-[13px] text-muted">{view === 'live' ? 'Ninguém ao vivo agora.' : 'Adicione os streamers de GTA que você quer clipar.'}</span>
              </Row>
            )}
            {list.map((c) => (
              <ChannelRow key={c.id} c={c} go={go} onOpen={() => setView(c.id)} />
            ))}
          </RowList>
        </Section>
      )}

      {(view === 'library' || one) && (
        <Section title={one ? 'Lives e VODs deste canal' : `${libraryFor.length} gravação(ões)`}>
          <RowList>
            {libraryFor.length === 0 && (
              <Row>
                <span className="text-[13px] text-muted">As lives gravadas e os VODs importados aparecem aqui.</span>
              </Row>
            )}
            {libraryFor.map((l) => (
              <LiveRow key={l.id} l={l} state={state} onClips={() => go('clips', { liveId: l.id, tab: 'review' })} />
            ))}
          </RowList>
        </Section>
      )}
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
    <Card className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-[13px] font-medium">Vigiar um canal</span>
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
          className="min-w-0 flex-1 rounded-full border border-white/15 bg-black/20 px-3 py-1 text-[13px] outline-none placeholder:text-muted focus:border-accent"
        />
        <Button onClick={() => void add()} disabled={busy || !input.trim()}>
          {busy ? 'Conferindo…' : 'Adicionar'}
        </Button>
      </div>
      {error && <p className="text-xs text-err">{error}</p>}
    </Card>
  )
}

/** Importar um VOD por link (com trecho opcional). */
export function ImportVod({ state }: { state: AppState }) {
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
    <Card className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-[13px] font-medium">Importar VOD</span>
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-white/15 bg-black/20 px-3 py-1 focus-within:border-accent">
          <Link2 size={13} className="shrink-0 text-muted" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            placeholder="twitch.tv/videos/… ou kick.com/canal/videos/…"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted"
          />
        </label>
        <Button onClick={() => void submit()} disabled={busy || !ref || rangeInvalid}>
          {busy ? 'Conferindo…' : 'Importar'}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <Toggle label="Só um trecho" checked={useRange} onChange={setUseRange} />
        <span className="flex items-center gap-1">
          <Scissors size={12} /> Só um trecho
        </span>
        {useRange && (
          <>
            <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="início 1:20:00" className="w-28 rounded-full border border-white/15 bg-black/20 px-3 py-0.5 text-text outline-none focus:border-accent" />
            <span>até</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="fim (vazio = final)" className="w-36 rounded-full border border-white/15 bg-black/20 px-3 py-0.5 text-text outline-none focus:border-accent" />
          </>
        )}
      </div>
      {url && !ref && <p className="text-xs text-warn">Link não reconhecido: use um VOD da Twitch ou da Kick.</p>}
      {rangeInvalid && <p className="text-xs text-warn">Use h:mm:ss; o fim precisa vir depois do início.</p>}
      {error && (
        <p className="flex items-start gap-1 text-xs text-err">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
    </Card>
  )
}

function ChannelRow({ c, go, onOpen }: { c: ChannelState; go: Go; onOpen: () => void }) {
  const rec = c.recording
  const warn = rec?.lastError ?? (!c.live ? c.lastError : null)
  return (
    <Row className={c.enabled ? '' : 'opacity-60'}>
      <button type="button" onClick={onOpen} className="shrink-0">
        <Avatar channel={c} size={32} />
      </button>
      <button type="button" onClick={onOpen} className="w-44 min-w-0 text-left">
        <p className="truncate text-[13px] font-medium">{c.displayName}</p>
        <p className="truncate text-[11px] text-muted">{c.platform === 'twitch' ? 'Twitch' : 'Kick'}</p>
      </button>
      <div className="min-w-0 flex-1 space-y-0.5">
        {rec ? (
          <Status tone="live">
            Gravando há {since(c.live?.startedAt ?? Date.now())} · {rec.resolution ?? '…'} · {fmtSize(rec.bytes)}
          </Status>
        ) : c.live ? (
          <Status tone="info">Ao vivo{c.live.isRerun ? ' (reprise)' : ''}</Status>
        ) : (
          <Status tone="muted">Offline{c.lastCheckedAt ? ` · visto ${timeAgo(c.lastCheckedAt)}` : ''}</Status>
        )}
        {c.live?.title && <p className="truncate pl-3.5 text-[11px] text-muted">{c.live.title}</p>}
        {warn && (
          <p className="flex items-center gap-1 pl-3.5 text-[11px] text-warn">
            <TriangleAlert size={11} /> {warn}
          </p>
        )}
      </div>
      <Toggle label="Vigiar canal" checked={c.enabled} onChange={(v) => void window.api.setChannelEnabled(c.id, v)} />
      {rec ? (
        <Button onClick={() => go('clips', { liveId: rec.liveId, tab: 'review' })}>Ver clipes</Button>
      ) : (
        <Button variant="ghost" onClick={onOpen}>
          Abrir
        </Button>
      )}
      <MoreMenu
        items={[
          { label: 'Parar a gravação', onClick: () => void window.api.stopRecording(c.id), hidden: !rec },
          { label: 'Abrir a pasta da gravação', onClick: () => rec && void window.api.openPath(rec.dir), hidden: !rec },
          { label: 'Abrir o canal no navegador', onClick: () => void window.api.openExternal(channelLink(c)) },
          {
            label: 'Parar de vigiar',
            danger: true,
            onClick: () => confirm(`Parar de vigiar ${c.displayName}? As gravações dele continuam em "Lives e VODs".`) && void window.api.removeChannel(c.id)
          }
        ]}
      />
    </Row>
  )
}

const STATUS: Record<LiveStatus, { label: string; tone: 'ok' | 'info' | 'live' | 'warn' | 'muted' }> = {
  recording: { label: 'Gravando', tone: 'live' },
  interrupted: { label: 'Pausada', tone: 'warn' },
  ended: { label: 'Gravada', tone: 'ok' },
  queued: { label: 'Na fila', tone: 'muted' },
  importing: { label: 'Baixando', tone: 'info' },
  imported: { label: 'Pronta', tone: 'ok' },
  failed: { label: 'Falhou', tone: 'warn' }
}

function LiveRow({ l, state, onClips }: { l: LiveRecord; state: AppState; onClips: () => void }) {
  const [broken, setBroken] = useState(false)
  const busy = l.status === 'importing' || l.status === 'queued'
  const st = STATUS[l.status]
  const clips = state.clips.filter((c) => c.liveId === l.id)
  const pending = clips.filter((c) => c.review === 'pending').length
  const range = l.rangeStartS != null || l.rangeEndS != null ? ` · trecho ${formatTimecode(l.rangeStartS ?? 0)}–${l.rangeEndS != null ? formatTimecode(l.rangeEndS) : 'fim'}` : ''

  return (
    <Row>
      {l.avatarUrl && !broken ? (
        <img src={l.avatarUrl} alt="" onError={() => setBroken(true)} className="size-8 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-bold uppercase">{l.channelName.slice(0, 2)}</div>
      )}
      <div className="w-56 min-w-0">
        <p className="truncate text-[13px] font-medium" title={l.title}>
          {l.title || 'Sem título'}
        </p>
        <p className="truncate text-[11px] text-muted">
          {l.channelName} · {new Date(l.startedAt).toLocaleDateString('pt-BR')} · {l.kind === 'vod' ? 'VOD' : 'ao vivo'}
          {range}
        </p>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <Status tone={st.tone}>
          {st.label}
          {l.status === 'importing' && l.progress != null ? ` ${Math.round(l.progress * 100)}%` : ''} · {formatTimecode(l.recordedS)} · {fmtSize(l.bytes)}
        </Status>
        {l.status === 'importing' && l.progress != null && <Progress value={l.progress} />}
        {l.error && l.status !== 'imported' && <p className="truncate pl-3.5 text-[11px] text-warn">{l.error}</p>}
      </div>
      {l.segments > 0 && (
        <Button onClick={onClips} variant={pending ? 'primary' : 'ghost'}>
          {clips.length ? `${clips.length} clipe(s)${pending ? ` · ${pending} p/ revisar` : ''}` : 'Ver momentos'}
        </Button>
      )}
      <MoreMenu
        items={[
          { label: 'Abrir a pasta', onClick: () => l.dir && void window.api.openPath(l.dir), hidden: !l.dir },
          { label: 'Cancelar', onClick: () => void window.api.cancelImport(l.id), hidden: !busy },
          { label: 'Tentar de novo', onClick: () => void window.api.retryImport(l.id), hidden: !((l.status === 'failed' || l.chatStatus === 'failed') && l.kind === 'vod') },
          {
            label: 'Apagar a gravação',
            danger: true,
            hidden: l.status === 'recording',
            onClick: () =>
              confirm(`Apagar ${l.kind === 'vod' ? 'o VOD' : 'a gravação'} de ${l.channelName} (${fmtSize(l.bytes)})? Os clipes prontos continuam.`) &&
              void window.api.deleteLive(l.id).catch((e) => alert(clean(e)))
          }
        ]}
      />
    </Row>
  )
}
