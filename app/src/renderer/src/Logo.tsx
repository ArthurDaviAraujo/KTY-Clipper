import { useId } from 'react'
import { cx } from './ui'

/**
 * Marca do Clipador KTY: um quadrado com cantos de ícone de app, em degradê rosa → roxo → laranja,
 * com dois clipes verticais (9:16) empilhados, o da frente com o "play", e uma faísca de IA.
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="Clipador KTY">
      <defs>
        <linearGradient id={`${id}bg`} x1="6" y1="4" x2="60" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff4f9a" />
          <stop offset="0.55" stopColor="#9b5cff" />
          <stop offset="1" stopColor="#5b6cff" />
        </linearGradient>
        <radialGradient id={`${id}glow`} cx="52" cy="54" r="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff9a5c" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ff9a5c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}shine`} x1="32" y1="0" x2="32" y2="25" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="15" fill={`url(#${id}bg)`} />
      <rect x="2" y="2" width="60" height="60" rx="15" fill={`url(#${id}glow)`} />
      <path d="M17 2h30a15 15 0 0 1 15 15v6C46 30 18 30 2 22v-5A15 15 0 0 1 17 2z" fill={`url(#${id}shine)`} />
      {/* clipe de trás */}
      <rect x="15" y="15" width="21" height="33" rx="5" transform="rotate(-10 25.5 31.5)" fill="#fff" fillOpacity="0.35" />
      {/* clipe da frente */}
      <rect x="25" y="16" width="22" height="35" rx="5.5" transform="rotate(8 36 33.5)" fill="#fff" />
      <path d="M33.2 27.6c0-1.4 1.5-2.2 2.7-1.5l7.1 4.3c1.2.7 1.1 2.4-.1 3.1l-7.3 3.8c-1.2.6-2.6-.3-2.5-1.6l.1-8.1z" fill="#8b5cf6" transform="rotate(8 36 33.5)" />
      {/* faísca de IA */}
      <path d="M50 8.5c.5 2.6 1.4 3.5 4 4-2.6.5-3.5 1.4-4 4-.5-2.6-1.4-3.5-4-4 2.6-.5 3.5-1.4 4-4z" fill="#fff" />
    </svg>
  )
}

/** Marca + nome, com o "KTY" numa etiqueta em degradê */
export function Wordmark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span className={cx('flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      <span className="flex items-center gap-1.5">
        <span className="font-display text-[15px] font-semibold tracking-tight">Clipador</span>
        <span className="rounded-md bg-gradient-to-r from-brand via-violet to-[#ff9a5c] px-1.5 py-px text-[10px] font-bold tracking-wider text-white">KTY</span>
      </span>
    </span>
  )
}
