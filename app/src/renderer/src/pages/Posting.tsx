import { useState } from 'react'
import { Check, Copy, FolderOpen, Upload } from 'lucide-react'
import type { ClipRecord } from '../../../shared/types'
import type { Network } from '../../../shared/post'
import { cx } from '../ui'
import { BrandIcon } from '../BrandIcon'

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const t = document.createElement('textarea')
    t.value = text
    document.body.appendChild(t)
    t.select()
    document.execCommand('copy')
    t.remove()
  }
}

/** Botão pequeno de copiar um texto (mostra "Copiado" por um instante). */
function CopyChip({ label, text }: { label: string; text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      title={text}
      onClick={() =>
        void copyText(text).then(() => {
          setOk(true)
          setTimeout(() => setOk(false), 1400)
        })
      }
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] transition',
        ok ? 'bg-ok/15 text-ok' : 'bg-white/[0.07] text-text hover:bg-white/[0.12]'
      )}
    >
      {ok ? <Check size={11} /> : <Copy size={11} />} {ok ? 'Copiado' : label}
    </button>
  )
}

export const when = (t: number) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export const NETS: { id: Network; label: string }[] = [
  { id: 'youtube', label: 'YouTube Shorts' },
  { id: 'tiktok', label: 'TikTok' }
]

/** Um bloco por rede: copiar os textos dela e marcar como postado. */
function NetworkBox({ clip, net }: { clip: ClipRecord; net: Network }) {
  const at = clip.posted[net]
  return (
    <div className={cx('min-w-[210px] flex-1 rounded-xl border px-3 py-2', at ? 'border-ok/35 bg-ok/[0.06]' : 'border-white/[0.08] bg-white/[0.02]')}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
          <BrandIcon brand={net} size={13} /> {NETS.find((n) => n.id === net)!.label}
        </p>
        <button
          type="button"
          onClick={() => void window.api.markPosted(clip.id, net, !at)}
          className={cx('inline-flex items-center gap-1.5 text-[11.5px]', at ? 'text-ok' : 'text-muted hover:text-text')}
          title={at ? 'Desmarcar' : 'Marcar como postado'}
        >
          <span className={cx('grid size-3.5 place-items-center rounded border', at ? 'border-ok bg-ok text-black' : 'border-white/30')}>{at && <Check size={10} />}</span>
          {at ? `postado ${when(at)}` : 'postado'}
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {net === 'youtube' ? (
          <>
            <CopyChip label="Título" text={clip.post.youtubeTitle} />
            <CopyChip label="Descrição" text={clip.post.youtubeDescription} />
          </>
        ) : (
          <CopyChip label="Legenda" text={clip.post.tiktokCaption} />
        )}
      </div>
    </div>
  )
}

/**
 * Lista só para postar: cada clipe aprovado numa linha, com os textos de cada rede e o "postado".
 * Fica separada de "Aprovados" para a revisão não ficar carregada.
 */
export function PostingList({ clips, networks, onOpen }: { clips: ClipRecord[]; networks: { youtube: boolean; tiktok: boolean }; onOpen: (id: number) => void }) {
  const nets = NETS.filter((n) => networks[n.id]).map((n) => n.id)
  return (
    <div className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
      {clips.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
          <button type="button" onClick={() => onOpen(c.id)} className="flex min-w-[240px] flex-1 items-center gap-3 text-left">
            <span className="relative aspect-[9/16] w-12 shrink-0 overflow-hidden rounded-lg bg-black">
              {c.status === 'ready' && <img src={`clipador://capa/${c.id}`} alt="" className="size-full object-cover" />}
            </span>
            <span className="min-w-0">
              <span className="line-clamp-2 block text-[13.5px] font-semibold leading-snug">{c.title}</span>
              <span className="block truncate text-[11.5px] text-muted">
                {c.channelName}
                {c.game ? ` · ${c.game}` : ''} · {Math.round(c.durationS)} s{c.score != null ? ` · nota ${c.score}` : ''}
              </span>
            </span>
          </button>
          <div className="flex flex-[2] flex-wrap gap-2">
            {nets.map((n) => (
              <NetworkBox key={n} clip={c} net={n} />
            ))}
          </div>
          <div className="flex shrink-0 items-center">
            {c.exportedPath ? (
              <button
                type="button"
                title="Mostrar na pasta para postar"
                onClick={() => void window.api.showInFolder(c.exportedPath!)}
                className="grid size-8 place-items-center rounded-full text-muted hover:bg-white/[0.07] hover:text-text"
              >
                <FolderOpen size={15} />
              </button>
            ) : (
              <button
                type="button"
                title="Copiar para a pasta para postar"
                onClick={() => void window.api.exportClip(c.id)}
                className="grid size-8 place-items-center rounded-full text-muted hover:bg-white/[0.07] hover:text-text"
              >
                <Upload size={15} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
