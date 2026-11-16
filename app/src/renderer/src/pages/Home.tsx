import { ArrowRight, CheckCircle2, Circle, Cpu, Film, HardDrive, Radio, Sparkles, Wrench } from 'lucide-react'
import type { PageId } from '../App'
import type { AppState } from '../state'
import { Badge, Card, Section } from '../ui'

export default function HomePage({ state, go }: { state: AppState; go: (p: PageId) => void }) {
  const { tools, hardware, disk, channels } = state
  const required = tools.filter((t) => t.required)
  const toolsOk = required.length > 0 && required.every((t) => t.path)
  const working = hardware?.encoders.filter((e) => e.works) ?? []
  const gpu = hardware?.gpus[0]

  const checks = [
    { ok: toolsOk, label: 'Programas essenciais (FFmpeg, FFprobe, yt-dlp)', go: 'system' as PageId },
    { ok: working.length > 0, label: hardware?.encodersTestedAt ? `${working.length} codificador(es) de vídeo funcionando` : 'Testando codificadores de vídeo…', go: 'system' as PageId },
    { ok: !!disk && !disk.low, label: disk ? `${disk.freeGb} GB livres para gravações` : 'Espaço em disco', go: 'settings' as PageId },
    { ok: channels.length > 0, label: channels.length ? `${channels.length} canal(is) vigiado(s)` : 'Adicionar canais da Twitch e da Kick', go: 'live' as PageId }
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Banner */}
      <div className="glow relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#ff2d55] via-[#c2185b] to-[#4a0d2a] p-8">
        <div className="absolute -right-16 -top-20 size-72 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-24 right-40 size-60 rounded-full bg-gold/20 blur-3xl" />
        <div className="relative max-w-xl space-y-3">
          <Badge tone="accent">
            <Sparkles size={12} /> Fase 1 · gravador
          </Badge>
          <h2 className="text-3xl font-bold leading-tight">Pronto para clipar o GTA 6</h2>
          <p className="text-sm text-white/80">
            O app vigia os canais, grava as lives em pedaços, encontra os melhores momentos com IA e entrega clipes verticais prontos para Shorts e TikTok.
          </p>
        </div>
      </div>

      <Section title="Checklist">
        <div className="grid gap-3 md:grid-cols-2">
          {checks.map((c) => (
            <button key={c.label} type="button" onClick={() => go(c.go)} className="text-left">
              <Card className="flex items-center gap-3 transition hover:border-accent/60">
                {c.ok ? <CheckCircle2 className="shrink-0 text-ok" size={20} /> : <Circle className="shrink-0 text-muted" size={20} />}
                <span className="flex-1 text-sm">{c.label}</span>
                <ArrowRight size={16} className="text-muted" />
              </Card>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Esta máquina">
        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <Cpu size={18} className="mb-2 text-accent-2" />
            <p className="text-xs text-muted">Processador</p>
            <p className="text-sm font-medium">{hardware?.cpu ?? '…'}</p>
            <p className="text-xs text-muted">
              {hardware?.cores} núcleos · {hardware?.ramGb} GB de RAM
            </p>
          </Card>
          <Card>
            <Film size={18} className="mb-2 text-accent-2" />
            <p className="text-xs text-muted">Placa de vídeo</p>
            <p className="text-sm font-medium">{gpu?.name ?? 'Não detectada'}</p>
            <p className="text-xs text-muted">{working.length ? working.map((e) => e.name).join(', ') : 'Codificadores ainda não testados'}</p>
          </Card>
          <Card>
            <HardDrive size={18} className="mb-2 text-accent-2" />
            <p className="text-xs text-muted">Disco dos dados</p>
            <p className="text-sm font-medium">{disk ? `${disk.freeGb} de ${disk.totalGb} GB livres` : '…'}</p>
            <p className="truncate text-xs text-muted" title={disk?.path}>
              {disk?.path}
            </p>
          </Card>
        </div>
      </Section>

      <Section title="Próximas fases">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            { icon: Radio, title: 'Fase 1 · Gravar e clipar', text: 'Vigiar canais, gravar live e chat, detectores, vertical com legenda e fila de aprovação.' },
            { icon: Sparkles, title: 'Fase 2 · Publicar e aprender', text: 'YouTube e TikTok, agendamento, métricas e busca de momentos.' },
            { icon: Wrench, title: 'Fase 3 · Diferenciais', text: 'Clipar ao vivo, tela do GTA 6, vários streamers e vídeo longo.' }
          ].map(({ icon: Icon, title, text }) => (
            <Card key={title}>
              <Icon size={18} className="mb-2 text-gold" />
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-1 text-xs text-muted">{text}</p>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  )
}
