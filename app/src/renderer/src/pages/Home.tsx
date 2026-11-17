import { useState } from 'react'
import { ArrowRight, Circle, Download, Link2, Scissors } from 'lucide-react'
import { parseTimecode, parseVodInput } from '../../../shared/vod'
import type { ChannelState } from '../../../shared/types'
import type { Go } from '../App'
import type { AppState } from '../state'
import { Avatar } from '../Avatar'
import { ClipCover } from './Clips'
import { Button, Card, MoreMenu, PageHeader, Row, RowList, Section, Status, Toggle, timeAgo } from '../ui'

const clean = (e: unknown) => ((e as Error).message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const since = (t: number) => {
  const m = Math.floor((Date.now() - t) / 60000)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`
}

export default function HomePage({ state, go }: { state: AppState; go: Go }) {
  const { tools, hardware, channels, clips } = state
  const toReview = clips.filter((c) => c.review === 'pending')
  const required = tools.filter((t) => t.required)
  const sorted = [...channels].sort((a, b) => Number(!!b.recording) - Number(!!a.recording) || Number(!!b.live) - Number(!!a.live))

  // Só aparece o que falta configurar
  const setup = [
    { ok: required.length > 0 && required.every((t) => t.path), label: 'Programas essenciais (FFmpeg, yt-dlp)', go: () => go('settings', { settings: 'sistema' }) },
    { ok: !!hardware?.encoders.some((e) => e.works), label: 'Testar a placa de vídeo', go: () => go('settings', { settings: 'sistema' }) },
    { ok: channels.length > 0, label: 'Adicionar os canais que você quer clipar', go: () => go('channels', { channels: 'all' }) }
  ].filter((s) => !s.ok)

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <PageHeader title="Visão geral" subtitle="Grava os canais, acha os melhores momentos e entrega os clipes prontos para você aprovar." />

      <VodBanner state={state} />

      {setup.length > 0 && (
        <Section title="Para começar">
          <RowList>
            {setup.map((s) => (
              <button key={s.label} type="button" onClick={s.go} className="block w-full text-left">
                <Row>
                  <Circle size={16} className="shrink-0 text-muted" />
                  <span className="flex-1 text-[13px]">{s.label}</span>
                  <ArrowRight size={15} className="text-muted" />
                </Row>
              </button>
            ))}
          </RowList>
        </Section>
      )}

      <Section title="Seus canais">
        <RowList>
          {sorted.length === 0 && (
            <Row>
              <span className="flex-1 text-[13px] text-muted">Nenhum canal vigiado ainda.</span>
              <Button variant="ghost" onClick={() => go('channels', { channels: 'all' })}>
                Adicionar canal
              </Button>
            </Row>
          )}
          {sorted.slice(0, 6).map((c) => (
            <ChannelLine key={c.id} c={c} go={go} />
          ))}
        </RowList>
      </Section>

      <Section
        title="Para revisar"
        action={
          toReview.length > 3 ? (
            <button type="button" onClick={() => go('clips', { tab: 'review', liveId: 'all' })} className="text-xs text-accent-2 hover:underline">
              Ver todos ({toReview.length})
            </button>
          ) : undefined
        }
      >
        {toReview.length === 0 ? (
          <Card className="text-[13px] text-muted">Tudo revisado. Os clipes novos aparecem aqui.</Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {toReview.slice(0, 3).map((c) => (
              <Card key={c.id} className="flex gap-3 p-3">
                <ClipCover clip={c} className="w-16 shrink-0 rounded-lg" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="line-clamp-2 text-[13px] font-semibold leading-snug">{c.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {c.channelName}
                    {c.tag ? ` · ${c.tag}` : ''}
                  </p>
                  <div className="mt-auto flex items-center justify-end gap-1 pt-2">
                    <Button onClick={() => go('clips', { tab: 'review', liveId: 'all' })}>Revisar</Button>
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
    </div>
  )
}

/** Linha de canal: foto, nome, status com bolinha e a ação principal */
function ChannelLine({ c, go }: { c: ChannelState; go: Go }) {
  const rec = c.recording
  return (
    <Row>
      <Avatar channel={c} size={30} />
      <div className="min-w-0 w-48">
        <p className="truncate text-[13px] font-medium">{c.displayName}</p>
        <p className="truncate text-[11px] text-muted">{c.platform === 'twitch' ? 'Twitch' : 'Kick'}</p>
      </div>
      <div className="min-w-0 flex-1">
        {rec ? (
          <Status tone="live">Gravando há {since(c.live?.startedAt ?? Date.now())}</Status>
        ) : c.live ? (
          <Status tone="info">Ao vivo</Status>
        ) : (
          <Status tone="muted">Offline{c.lastCheckedAt ? ` · visto ${timeAgo(c.lastCheckedAt)}` : ''}</Status>
        )}
      </div>
      {rec ? (
        <Button onClick={() => go('clips', { liveId: rec.liveId, tab: 'review' })}>Ver clipes</Button>
      ) : (
        <Button variant="ghost" onClick={() => go('channels', { channels: c.id })}>
          Abrir
        </Button>
      )}
      <MoreMenu
        items={[
          { label: 'Parar a gravação', onClick: () => void window.api.stopRecording(c.id), hidden: !rec },
          { label: 'Abrir o canal no navegador', onClick: () => void window.api.openExternal(c.platform === 'twitch' ? `https://www.twitch.tv/${c.login}` : `https://kick.com/${c.login}`) }
        ]}
      />
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
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#ff2d78] via-[#a43cf0] to-[#ff7a45] p-6 shadow-[0_20px_60px_-20px_rgba(168,60,240,0.6)]">
      {/* Formas */}
      <span className="float absolute right-[22%] top-6 size-9 rounded-full bg-[radial-gradient(circle_at_30%_30%,#ffd1e8,#a43cf0_60%,#5b1d9e)] shadow-lg" />
      <span
        className="float absolute right-[38%] top-[58%] size-8 rounded-md bg-gradient-to-br from-[#ff9a62] to-[#e8335f] shadow-lg"
        style={{ ['--r' as string]: '28deg', animationDelay: '-2s' }}
      />
      <span className="float absolute right-[30%] top-[18%] size-6 rotate-12 bg-gradient-to-br from-[#ffb36b] to-[#ff3d6e] [clip-path:polygon(50%_0,100%_100%,0_100%)]" style={{ animationDelay: '-4s' }} />
      <span
        className="float absolute -right-6 top-1/2 size-40 -translate-y-1/2 rounded-full border-[26px] border-[#c79bff] opacity-90 shadow-[inset_0_8px_20px_rgba(255,255,255,0.45),0_10px_40px_rgba(80,20,160,0.5)]"
        style={{ animationDelay: '-1s' }}
      />
      <span className="float absolute right-[12%] top-5 size-4 rounded-full bg-[radial-gradient(circle_at_30%_30%,#fff,#8b5cf6)]" style={{ animationDelay: '-3s' }} />

      <div className="relative max-w-xl space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-black/35 text-white">
            <Download size={16} />
          </span>
          <p className="text-lg font-semibold text-white">Clipar uma live que já acabou</p>
        </div>
        <p className="text-[13px] text-white/85">Cole o link do VOD da Twitch ou da Kick. O app baixa, acha os melhores momentos e gera os clipes verticais.</p>
        <div className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-black/30 px-3 py-1.5 ring-1 ring-white/20 focus-within:ring-white/60">
            <Link2 size={14} className="shrink-0 text-white/70" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              placeholder="twitch.tv/videos/… ou kick.com/canal/videos/…"
              className="w-full bg-transparent text-[13px] text-white outline-none placeholder:text-white/55"
            />
          </label>
          <Button onClick={() => void submit()} disabled={busy || !ref || rangeInvalid}>
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
