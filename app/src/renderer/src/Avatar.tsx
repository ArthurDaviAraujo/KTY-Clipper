import { useState } from 'react'
import type { ChannelState, Platform } from '../../shared/types'
import { PLATFORM_NAME } from '../../shared/channels'
import { cx } from './ui'
import { BrandIcon } from './BrandIcon'

/** Selo redondo da plataforma no canto do avatar: Twitch roxo, Kick preto com o K verde, YouTube branco com o botão vermelho. */
export function PlatformBadge({ platform, size = 16, className }: { platform: Platform; size?: number; className?: string }) {
  const bg = platform === 'twitch' ? 'bg-[#9146ff]' : platform === 'youtube' ? 'bg-white' : 'bg-black'
  return (
    <span
      title={PLATFORM_NAME[platform]}
      className={cx('absolute -bottom-1 -right-1 grid place-items-center rounded-full ring-2 ring-bg', bg, className)}
      style={{ width: size, height: size }}
    >
      <BrandIcon brand={platform} mono={platform === 'twitch'} size={Math.round(size * 0.6)} className={platform === 'twitch' ? 'text-white' : undefined} />
    </span>
  )
}

type AvatarChannel = Pick<ChannelState, 'platform' | 'displayName' | 'avatarUrl' | 'enabled'> & Partial<Pick<ChannelState, 'live' | 'recording'>>

/** Avatar redondo do canal; anel vermelho pulsando quando está gravando, rosa quando só está ao vivo. */
export function Avatar({ channel: c, size = 44, badge = true }: { channel: AvatarChannel; size?: number; badge?: boolean }) {
  const [broken, setBroken] = useState(false)
  return (
    <div
      className={cx(
        'relative shrink-0 rounded-full p-[3px]',
        c.recording ? 'live-ring bg-live' : c.live ? 'bg-gradient-to-br from-accent to-gold' : 'bg-line'
      )}
      style={{ width: size, height: size }}
      title={`${c.displayName}${c.live ? ' · ao vivo' : ''}${c.recording ? ' · gravando' : ''}`}
    >
      {c.avatarUrl && !broken ? (
        <img src={c.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={cx('size-full rounded-full object-cover', !c.enabled && 'grayscale')} />
      ) : (
        <div className="grid size-full place-items-center rounded-full bg-card text-sm font-bold uppercase">{c.displayName.slice(0, 2)}</div>
      )}
      {badge && <PlatformBadge platform={c.platform} size={size >= 40 ? 18 : size >= 28 ? 15 : 12} />}
    </div>
  )
}
