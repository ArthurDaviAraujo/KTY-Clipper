import { useState } from 'react'
import { AlertTriangle, CalendarClock, Download, FolderOpen, HardDrive, Link2, MessageSquare, RotateCcw, Scissors, Trash2, X } from 'lucide-react'
import type { LiveRecord, LiveStatus } from '../../../shared/types'
import { formatTimecode, parseTimecode, parseVodInput } from '../../../shared/vod'
import type { AppState } from '../state'
import { Badge, Button, Card, Progress, Section, Toggle, cx } from '../ui'

const STATUS: Record<LiveStatus, { label: string; tone: 'ok' | 'warn' | 'err' | 'muted' | 'accent' }> = {
  recording: { label: '● gravando', tone: 'err' },
  interrupted: { label: 'pausada', tone: 'warn' },
  ended: { label: 'gravada', tone: 'ok' },
  queued: { label: 'na fila', tone: 'muted' },
  importing: { label: 'baixando', tone: 'accent' },
  imported: { label: 'importada', tone: 'ok' },
  failed: { label: 'falhou', tone: 'err' }
}

const CHAT: Record<string, string> = {
  queued: 'chat na fila',
  downloading: 'baixando chat…',
  done: '',
  failed: 'chat falhou'
}

const fmtSize = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${Math.round(b / 1024 ** 2)} MB`)
const clean = (e: unknown) => ((e as Error).message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export default function RecordingsPage({ state }: { state: AppState }) {
  const { lives, settings } = state
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
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Gravações</h2>
        <p className="text-sm text-muted">
          Lives gravadas e VODs importados. Tudo fica em {state.disk?.recordingsDir ?? '…'}, em pedaços, pronto para os detectores de momentos.
        </p>
      </div>

      <Card className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Download size={15} /> Importar uma live que já terminou (VOD)
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-w-72 flex-1 items-center gap-2 rounded-xl border border-line bg-panel px-3 py-1.5 focus-within:border-accent">
            <Link2 size={14} className="text-muted" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              placeholder="twitch.tv/videos/… ou kick.com/canal/videos/…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted/60"
            />
          </label>
          <Button onClick={() => void submit()} disabled={busy || !ref || rangeInvalid}>
            <Download size={14} /> {busy ? 'Conferindo…' : 'Importar'}
          </Button>
        </div>
        {url && !ref && <p className="text-xs text-warn">Link não reconhecido. Use um link de VOD da Twitch (twitch.tv/videos/…) ou da Kick (kick.com/canal/videos/…).</p>}
        {ref && (
          <p className="text-xs text-muted">
            {ref.platform === 'twitch' ? 'Twitch' : 'Kick'} · VOD {ref.id.slice(0, 13)}
 · vídeo e chat · qualidade:{' '}
            {settings?.recorder.quality === 'best' ? 'máxima' : `até ${settings?.recorder.quality}p`}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Toggle label="Só um trecho" checked={useRange} onChange={setUseRange} />
          <span className="flex items-center gap-1 text-sm">
            <Scissors size={14} /> Só um trecho
          </span>
          {useRange && (
            <>
              <input
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="início (ex. 1:20:00)"
                className="w-40 rounded-xl border border-line bg-panel px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
              <span className="text-muted">até</span>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="fim (vazio = até o final)"
                className="w-48 rounded-xl border border-line bg-panel px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
              {rangeInvalid && <span className="text-xs text-warn">Use h:mm:ss; o fim precisa vir depois do início.</span>}
            </>
          )}
        </div>
        {error && (
          <p className="flex items-start gap-1 text-xs text-err">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}
      </Card>

      <Section title="Biblioteca">
        {lives.length === 0 && <p className="text-sm text-muted">Nada ainda. As lives gravadas e os VODs importados aparecem aqui.</p>}
        <div className="space-y-2">
          {lives.map((l) => (
            <LiveRow key={l.id} l={l} />
          ))}
        </div>
      </Section>
    </div>
  )
}

function LiveRow({ l }: { l: LiveRecord }) {
  const [broken, setBroken] = useState(false)
  const busy = l.status === 'importing' || l.status === 'queued'
  const range = l.rangeStartS != null || l.rangeEndS != null ? `${formatTimecode(l.rangeStartS ?? 0)} – ${l.rangeEndS != null ? formatTimecode(l.rangeEndS) : 'fim'}` : null
  const chatNote = l.chatStatus ? CHAT[l.chatStatus] : ''

  return (
    <Card className="space-y-2">
      <div className="flex items-center gap-3">
        {l.avatarUrl && !broken ? (
          <img src={l.avatarUrl} alt="" onError={() => setBroken(true)} className="size-10 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-panel text-xs font-bold uppercase">{l.channelName.slice(0, 2)}</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{l.channelName}</span>
            <Badge tone="muted">{l.platform === 'twitch' ? 'Twitch' : 'Kick'}</Badge>
            <Badge tone="muted">{l.kind === 'vod' ? 'VOD importado' : 'gravada ao vivo'}</Badge>
            <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
            {range && <Badge tone="accent">trecho {range}</Badge>}
          </div>
          <p className="truncate text-xs text-muted" title={l.title}>
            {l.title || 'Sem título'}
            {l.game ? ` · ${l.game}` : ''}
          </p>
        </div>
      </div>

      {l.status === 'importing' && l.progress != null && (
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Progress value={l.progress} />
          </div>
          <span className="w-10 text-right text-xs tabular-nums text-muted">{Math.round(l.progress * 100)}%</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1">
          <CalendarClock size={12} /> {new Date(l.startedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
        </span>
        <span>
          {formatTimecode(l.recordedS)}
          {l.kind === 'vod' && l.durationS ? ` de ${formatTimecode(range ? (l.rangeEndS ?? l.durationS) - (l.rangeStartS ?? 0) : l.durationS)}` : ''} gravados
        </span>
        <span className="flex items-center gap-1">
          <HardDrive size={12} /> {l.segments} pedaço(s) · {fmtSize(l.bytes)}
        </span>
        <span className={cx('flex items-center gap-1', l.chatStatus === 'failed' && 'text-warn')}>
          <MessageSquare size={12} /> {l.chatMessages.toLocaleString('pt-BR')} mensagens {chatNote && `· ${chatNote}`}
        </span>
      </div>

      {l.error && l.status !== 'imported' && (
        <p className="flex items-start gap-1 text-xs text-warn">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {l.error}
          {l.status === 'queued' && ' (vai tentar de novo de onde parou)'}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {l.dir && (
          <Button variant="ghost" onClick={() => void window.api.openPath(l.dir!)}>
            <FolderOpen size={14} /> Abrir pasta
          </Button>
        )}
        {busy && (
          <Button variant="ghost" onClick={() => void window.api.cancelImport(l.id)}>
            <X size={14} /> Cancelar
          </Button>
        )}
        {(l.status === 'failed' || l.chatStatus === 'failed') && l.kind === 'vod' && (
          <Button variant="ghost" onClick={() => void window.api.retryImport(l.id)}>
            <RotateCcw size={14} /> Tentar de novo
          </Button>
        )}
        {l.status !== 'recording' && (
          <Button
            variant="ghost"
            onClick={() => {
              if (confirm(`Apagar ${l.kind === 'vod' ? 'o VOD' : 'a gravação'} de ${l.channelName} (${fmtSize(l.bytes)})? Os arquivos saem do disco.`))
                void window.api.deleteLive(l.id).catch((e) => alert(clean(e)))
            }}
          >
            <Trash2 size={14} /> Apagar
          </Button>
        )}
      </div>
    </Card>
  )
}
