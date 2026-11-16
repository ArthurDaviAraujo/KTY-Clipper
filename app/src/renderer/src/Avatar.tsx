import { useState } from 'react'
import type { ChannelState } from '../../shared/types'
import { cx } from './ui'

/** Avatar redondo do canal; anel vermelho pulsando quando está gravando, rosa quando só está ao vivo. */
export function Avatar({ channel: c, size = 44 }: { channel: ChannelState; size?: number }) {
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
        <img src={c.avatarUrl} alt="" onError={() => setBroken(true)} className={cx('size-full rounded-full object-cover', !c.enabled && 'grayscale')} />
      ) : (
        <div className="grid size-full place-items-center rounded-full bg-card text-sm font-bold uppercase">{c.displayName.slice(0, 2)}</div>
      )}
      <span
        className={cx(
          'absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full text-[8px] font-bold text-white ring-2 ring-bg',
          c.platform === 'twitch' ? 'bg-[#9146ff]' : 'bg-[#53fc18] text-black'
        )}
      >
        {c.platform === 'twitch' ? 'T' : 'K'}
      </span>
    </div>
  )
}
