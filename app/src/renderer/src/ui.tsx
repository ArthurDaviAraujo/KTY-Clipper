import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal, Settings as Gear } from 'lucide-react'
import type { Profile } from '../../shared/types'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/** Símbolo das Configurações: engrenagem com uma estrelinha amarela no canto de cima, à direita */
export function GearStar({ size = 16, className }: { size?: number; className?: string }) {
  const star = Math.max(7, Math.round(size * 0.6))
  return (
    <span className={cx('relative inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <Gear size={size} />
      {/* Estrela de 4 pontas (brilho) */}
      <svg viewBox="0 0 24 24" width={star} height={star} className="absolute fill-gold" style={{ top: -star * 0.4, right: -star * 0.45 }} aria-hidden>
        <path d="M12 0C12.9 6.6 17.4 11.1 24 12C17.4 12.9 12.9 17.4 12 24C11.1 17.4 6.6 12.9 0 12C6.6 11.1 11.1 6.6 12 0Z" />
      </svg>
    </span>
  )
}

/** Bloco com título em destaque e, à direita, um link ou ação ("Ver tudo") */
export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('space-y-4', className)}>
      <div className="flex items-end justify-between gap-3">
        <h2 className="font-display text-[19px] font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Link discreto no canto de uma seção ("Ver tudo ›") */
export function SeeAll({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-[14px] text-accent-2 transition hover:text-white">
      {children} ›
    </button>
  )
}

/**
 * Cabeçalho da página: título grande, subtítulo, abas pequenas e ação à direita.
 * Com `top` (ex.: "Configurações"), ele vira o título grande e `title` fica logo abaixo, menor.
 */
export function PageHeader({ title, subtitle, tabs, action, top }: { title: string; subtitle?: string; tabs?: ReactNode; action?: ReactNode; top?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
      <div className="min-w-0 flex-1">
        {top && <h1 className="mb-4 flex items-center gap-2.5 truncate font-display text-[30px] font-semibold leading-tight tracking-tight">{top}</h1>}
        {top ? (
          <h2 className="truncate font-display text-[22px] font-semibold leading-tight tracking-tight">{title}</h2>
        ) : (
          <h1 className="truncate font-display text-[30px] font-semibold leading-tight tracking-tight">{title}</h1>
        )}
        {subtitle && <p className="mt-1 truncate text-[15px] text-muted">{subtitle}</p>}
      </div>
      {tabs && <div className="flex justify-center pb-0.5">{tabs}</div>}
      {action && <div className="flex shrink-0 items-center gap-2 pb-0.5">{action}</div>}
    </div>
  )
}

/** Largura da página: preenche telas grandes sem esticar demais as linhas */
export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={cx('mx-auto w-full space-y-10', wide ? 'max-w-[1680px]' : 'max-w-[1180px]')}>{children}</div>
}

/** Abas pequenas com sublinhado (como "Desktop · Mobile · Web") */
export function SubTabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'border-b-2 px-3 py-1.5 text-[13px] transition',
            o.value === value ? 'border-white/80 text-text' : 'border-transparent text-muted hover:text-text'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  // Sem backdrop-blur de propósito: ele cria camadas que escondem os menus "…" abertos
  return <div className={cx('rounded-2xl border border-white/[0.08] bg-white/[0.035] p-5', className)}>{children}</div>
}

/** Lista em vidro com linhas separadas (como "Installed"). Sem overflow escondido, para os menus "…" saírem da lista. */
export function RowList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-white/[0.03]', className)}>{children}</div>
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex items-center gap-4 px-5 py-3.5 transition first:rounded-t-2xl last:rounded-b-2xl hover:bg-white/[0.025]', className)}>{children}</div>
}

/** Bolinha de status com o texto ao lado */
export function Status({ tone, children }: { tone: 'ok' | 'info' | 'live' | 'warn' | 'muted'; children: ReactNode }) {
  const dot = { ok: 'bg-ok', info: 'bg-accent-2', live: 'bg-live live-ring', warn: 'bg-warn', muted: 'bg-muted/50' }[tone]
  return (
    <span className="flex items-center gap-2 text-xs text-text/80">
      <span className={cx('size-1.5 shrink-0 rounded-full', dot)} />
      {children}
    </span>
  )
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        checked ? 'bg-accent' : 'bg-white/15',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
      )}
    >
      <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string; hint?: string; icon?: ReactNode }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-full border border-white/10 bg-black/20 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] transition',
            o.value === value ? 'bg-white/[0.14] text-text shadow' : 'text-muted hover:text-text'
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'err' | 'muted' | 'accent'; children: ReactNode }) {
  const tones = {
    ok: 'bg-ok/15 text-ok',
    warn: 'bg-warn/15 text-warn',
    err: 'bg-err/15 text-err',
    muted: 'bg-white/[0.08] text-muted',
    accent: 'bg-accent/20 text-accent-2'
  }
  return <span className={cx('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', tones[tone])}>{children}</span>
}

/** Botão em pílula: azul cheio (principal) ou contorno (secundário) */
export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  title,
  className
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost'
  disabled?: boolean
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'primary' ? 'bg-accent text-white hover:bg-accent-2' : 'border border-white/20 text-text/85 hover:border-white/35 hover:bg-white/5',
        className
      )}
    >
      {children}
    </button>
  )
}

/** Botão "…" com um menu pequeno */
export function MoreMenu({ items }: { items: { label: string; onClick: () => void; danger?: boolean; hidden?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const shown = items.filter((i) => !i.hidden)
  if (!shown.length) return null
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Mais opções" onClick={() => setOpen(!open)} className="grid size-7 place-items-center rounded-full text-muted transition hover:bg-white/10 hover:text-text">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-30 min-w-44 overflow-hidden rounded-xl border border-white/10 bg-panel-2/95 py-1 shadow-2xl backdrop-blur-xl">
          {shown.map((i) => (
            <button
              key={i.label}
              type="button"
              onClick={() => {
                setOpen(false)
                i.onClick()
              }}
              className={cx('block w-full px-3 py-1.5 text-left text-[13px] hover:bg-white/[0.08]', i.danger ? 'text-err' : 'text-text/90')}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Foto do perfil, ou as iniciais sobre a cor dele */
export function ProfileAvatar({ profile, size = 32 }: { profile: Profile | null | undefined; size?: number }) {
  const initials = (profile?.name ?? '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white ring-1 ring-white/20"
      style={{ width: size, height: size, fontSize: size * 0.38, background: profile?.color ?? '#3b7cf6' }}
    >
      {profile?.hasPhoto ? <img src={`clipador://perfil/${profile.id}?v=${profile.photoVersion}`} alt="" className="size-full object-cover" /> : initials}
    </span>
  )
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

export const timeAgo = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return `${s}s atrás`
  if (s < 3600) return `${Math.round(s / 60)} min atrás`
  if (s < 86400) return `${Math.round(s / 3600)} h atrás`
  return new Date(t).toLocaleDateString('pt-BR')
}
