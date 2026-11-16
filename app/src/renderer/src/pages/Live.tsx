import { useState } from 'react'
import { Clock, Eye, FolderOpen, Gamepad2, MessageSquare, Plus, Power, RefreshCw, Square, Trash2, TriangleAlert } from 'lucide-react'
import type { ChannelState, Platform } from '../../../shared/types'
import type { AppState } from '../state'
import { Avatar } from '../Avatar'
import { Badge, Button, Card, Section, Segmented, Toggle, cx, timeAgo } from '../ui'

const fmtDuration = (ms: number) => {
  const m = Math.floor(ms / 60000)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}
const fmtGb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(0)} MB`)

export default function LivePage({ state }: { state: AppState }) {
  const { channels, settings } = state
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
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  const live = channels.filter((c) => c.live)
  const recording = channels.filter((c) => c.recording)

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Ao vivo</h2>
          <p className="text-sm text-muted">
            {channels.length} canal(is) vigiado(s) · {live.length} ao vivo · {recording.length} gravando
            {settings ? ` · verifica a cada ${settings.recorder.pollSeconds} s` : ''}
          </p>
        </div>
        <Button variant="ghost" onClick={() => void window.api.checkChannelsNow()}>
          <RefreshCw size={14} /> Verificar agora
        </Button>
      </div>

      <Card className="space-y-3">
        <p className="text-sm font-medium">Adicionar canal</p>
        <div className="flex flex-wrap items-center gap-3">
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
            placeholder="nome do canal ou link (twitch.tv/... ou kick.com/...)"
            className="min-w-64 flex-1 rounded-xl border border-line bg-panel px-3 py-1.5 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
          />
          <Button onClick={() => void add()} disabled={busy || !input.trim()}>
            <Plus size={14} /> {busy ? 'Conferindo…' : 'Adicionar'}
          </Button>
        </div>
        {error && <p className="text-xs text-err">{error}</p>}
        <p className="text-xs text-muted">
          Grava vídeo e chat da Twitch e da Kick. A gravação começa sozinha quando o canal entra ao vivo.
        </p>
      </Card>

      <Section title="Canais">
        {channels.length === 0 && <p className="text-sm text-muted">Nenhum canal ainda. Adicione os streamers de GTA que você quer clipar.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {channels.map((c) => (
            <ChannelCard key={c.id} c={c} />
          ))}
        </div>
      </Section>
    </div>
  )
}

function ChannelCard({ c }: { c: ChannelState }) {
  const rec = c.recording
  return (
    <Card className={cx('space-y-3', c.live && 'border-live/50', !c.enabled && 'opacity-60')}>
      <div className="flex items-center gap-3">
        <Avatar channel={c} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{c.displayName}</span>
            <Badge tone="muted">{c.platform === 'twitch' ? 'Twitch' : 'Kick'}</Badge>
            {c.live && (c.live.isRerun ? <Badge tone="warn">reprise</Badge> : <Badge tone="err">● ao vivo</Badge>)}
          </div>
          <p className="truncate text-xs text-muted">
            {c.live ? c.live.title || 'Sem título' : c.lastCheckedAt ? `Offline · verificado ${timeAgo(c.lastCheckedAt)}` : 'Ainda não verificado'}
          </p>
        </div>
        <Toggle label="Vigiar canal" checked={c.enabled} onChange={(v) => void window.api.setChannelEnabled(c.id, v)} />
      </div>

      {c.live && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {c.live.game && (
            <span className="flex items-center gap-1">
              <Gamepad2 size={12} /> {c.live.game}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Eye size={12} /> {c.live.viewers.toLocaleString('pt-BR')}
          </span>
          <span className="flex items-center gap-1">
            <Clock size={12} /> no ar há {fmtDuration(Date.now() - c.live.startedAt)}
          </span>
        </div>
      )}

      {rec && (
        <div className="space-y-2 rounded-xl bg-live/10 p-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="live-ring size-2.5 rounded-full bg-live" />
            <span className="font-medium">Gravando</span>
            {rec.resolution && <Badge tone="accent">{rec.resolution}</Badge>}
            <span className="text-xs text-muted">
              ({rec.engine}){rec.restarts ? ` · ${rec.restarts} reinício(s)` : ''}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <p className="text-muted">Pedaços</p>
              <p className="font-medium tabular-nums">{rec.segments}</p>
            </div>
            <div>
              <p className="text-muted">Tamanho</p>
              <p className="font-medium tabular-nums">{fmtGb(rec.bytes)}</p>
            </div>
            <div>
              <p className="flex items-center gap-1 text-muted">
                <MessageSquare size={11} /> Chat
              </p>
              <p className="font-medium tabular-nums">{rec.chatMessages.toLocaleString('pt-BR')}</p>
            </div>
          </div>
          {rec.lastError && (
            <p className="flex items-start gap-1 text-xs text-warn">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" /> {rec.lastError}
            </p>
          )}
        </div>
      )}

      {c.lastError && !c.live && (
        <p className="flex items-start gap-1 text-xs text-warn">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" /> {c.lastError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {rec && (
          <>
            <Button variant="ghost" onClick={() => void window.api.openPath(rec.dir)}>
              <FolderOpen size={14} /> Abrir pasta
            </Button>
            <Button variant="ghost" onClick={() => void window.api.stopRecording(c.id)} title="Para esta gravação (volta a gravar na próxima live)">
              <Square size={14} /> Parar
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            if (confirm(`Parar de vigiar ${c.displayName}? As gravações dele continuam em "Gravações".`)) void window.api.removeChannel(c.id)
          }}
        >
          <Trash2 size={14} /> Remover
        </Button>
        {!c.enabled && (
          <span className="flex items-center gap-1 text-xs text-muted">
            <Power size={12} /> não vigiado
          </span>
        )}
      </div>
    </Card>
  )
}
