import { ArrowRight, CheckCircle2, Circle, Clapperboard, Radio } from 'lucide-react'
import type { Go } from '../App'
import type { AppState } from '../state'
import { Avatar } from '../Avatar'
import { ClipCover } from './Clips'
import { ImportVod } from './Channels'
import { Button, Card, Section, cx } from '../ui'

export default function HomePage({ state, go }: { state: AppState; go: Go }) {
  const { tools, hardware, channels, clips } = state
  const onAir = channels.filter((c) => c.recording || c.live)
  const toReview = clips.filter((c) => c.review === 'pending')
  const approved = clips.filter((c) => c.review === 'approved')
  const required = tools.filter((t) => t.required)

  // Só aparece o que falta configurar
  const setup = [
    { ok: required.length > 0 && required.every((t) => t.path), label: 'Programas essenciais (FFmpeg, yt-dlp)', go: () => go('settings') },
    { ok: !!hardware?.encoders.some((e) => e.works), label: 'Testar a placa de vídeo', go: () => go('settings') },
    { ok: channels.length > 0, label: 'Adicionar os canais que você quer clipar', go: () => go('channels') }
  ].filter((s) => !s.ok)

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Início</h2>
        <p className="text-sm text-muted">O app grava os canais, acha os melhores momentos e entrega os clipes prontos para você aprovar.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Ao vivo agora" value={onAir.length} tone={onAir.length ? 'live' : undefined} onClick={() => go('channels')} />
        <Stat label="Clipes para revisar" value={toReview.length} tone={toReview.length ? 'accent' : undefined} onClick={() => go('clips', { tab: 'review', liveId: 'all' })} />
        <Stat label="Aprovados" value={approved.length} onClick={() => go('clips', { tab: 'approved', liveId: 'all' })} />
      </div>

      {setup.length > 0 && (
        <Section title="Para começar">
          <div className="grid gap-2 md:grid-cols-2">
            {setup.map((s) => (
              <button key={s.label} type="button" onClick={s.go} className="text-left">
                <Card className="flex items-center gap-3 transition hover:border-accent/60">
                  <Circle size={18} className="shrink-0 text-muted" />
                  <span className="flex-1 text-sm">{s.label}</span>
                  <ArrowRight size={16} className="text-muted" />
                </Card>
              </button>
            ))}
          </div>
        </Section>
      )}

      <ImportVod state={state} compact />

      <Section
        title="Para revisar"
        action={
          toReview.length > 0 ? (
            <Button variant="ghost" onClick={() => go('clips', { tab: 'review', liveId: 'all' })}>
              Ver todos <ArrowRight size={14} />
            </Button>
          ) : undefined
        }
      >
        {toReview.length === 0 ? (
          <Card className="flex items-center gap-3 text-sm text-muted">
            <CheckCircle2 size={18} className="shrink-0 text-ok" /> Tudo revisado. Os clipes novos aparecem aqui.
          </Card>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
            {toReview.slice(0, 6).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => go('clips', { tab: 'review', liveId: 'all' })}
                className="group overflow-hidden rounded-xl border border-line/60 text-left transition hover:border-accent/60"
              >
                <ClipCover clip={c} />
                <p className="line-clamp-2 p-2 text-xs font-medium leading-snug">{c.title}</p>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Ao vivo agora">
        {onAir.length === 0 ? (
          <Card className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <Radio size={18} className="shrink-0" />
            <span className="flex-1">{channels.length ? 'Nenhum canal ao vivo. A gravação começa sozinha quando abrirem a live.' : 'Nenhum canal vigiado ainda.'}</span>
            <Button variant="ghost" onClick={() => go('channels')}>
              {channels.length ? 'Ver canais' : 'Adicionar canal'}
            </Button>
          </Card>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {onAir.map((c) => (
              <Card key={c.id} className="flex items-center gap-3 p-3">
                <Avatar channel={c} size={42} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.displayName}</p>
                  <p className="truncate text-xs text-muted">{c.live?.title || 'Ao vivo'}</p>
                </div>
                {c.recording && (
                  <Button variant="ghost" onClick={() => go('clips', { liveId: c.recording!.liveId, tab: 'review' })}>
                    <Clapperboard size={14} /> Clipes
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function Stat({ label, value, tone, onClick }: { label: string; value: number; tone?: 'live' | 'accent'; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-left">
      <Card className="transition hover:border-accent/60">
        <p className="text-xs text-muted">{label}</p>
        <p className={cx('mt-1 text-3xl font-bold tabular-nums', tone === 'live' ? 'text-live' : tone === 'accent' ? 'text-accent-2' : '')}>{value}</p>
      </Card>
    </button>
  )
}
