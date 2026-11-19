import { useEffect, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, FolderOpen, GripVertical, Maximize2, RotateCcw, Upload } from 'lucide-react'
import { BrandIcon } from '../BrandIcon'
import type { ClipRecord, PostTexts } from '../../../shared/types'
import { LIMITS, type Network } from '../../../shared/post'
import { cx } from '../ui'
import { copyText, NETS, when } from './Posting'

/** Páginas de envio de cada rede (abrem no navegador do PC, onde a pessoa já está logada) */
const UPLOAD: Record<Network, { url: string; site: string; label: string }> = {
  youtube: { url: 'https://www.youtube.com/upload', site: 'YouTube Studio', label: 'Postar no YouTube' },
  tiktok: { url: 'https://www.tiktok.com/upload', site: 'TikTok', label: 'Postar no TikTok' }
}

const FIELD_LIMIT: Record<keyof PostTexts, number> = { youtubeTitle: LIMITS.youtubeTitle, youtubeDescription: LIMITS.youtubeDescription, tiktokCaption: LIMITS.tiktokCaption }

/** Texto de postagem à vista e editável (a edição fica salva), com contador e botão de copiar. */
export function PostField({ clip, field, label, rows = 1 }: { clip: ClipRecord; field: keyof PostTexts; label: string; rows?: number }) {
  const value = clip.post[field]
  const [draft, setDraft] = useState(value)
  const [ok, setOk] = useState(false)
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])
  const max = FIELD_LIMIT[field]
  const save = () => {
    editing.current = false
    if (draft.trim() !== value.trim()) void window.api.setPostText(clip.id, field, draft)
  }
  const copy = () =>
    void copyText(draft).then(() => {
      setOk(true)
      setTimeout(() => setOk(false), 1400)
    })
  const common = {
    value: draft,
    maxLength: max,
    onFocus: () => {
      editing.current = true
    },
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: save,
    className: 'w-full resize-none rounded-lg border border-white/[0.08] bg-black/20 px-2.5 py-1.5 text-[12.5px] leading-relaxed text-text outline-none focus:border-accent/60'
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[11.5px] font-medium text-muted">{label}</p>
        {clip.postEdited.includes(field) && (
          <button
            type="button"
            title="Voltar ao texto gerado"
            onClick={() => void window.api.setPostText(clip.id, field, null)}
            className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-text"
          >
            <RotateCcw size={10} /> restaurar
          </button>
        )}
        <span className={cx('text-[10.5px] tabular-nums', draft.length > max * 0.95 ? 'text-warn' : 'text-muted')}>
          {draft.length}/{max}
        </span>
        <button
          type="button"
          onClick={copy}
          className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] transition', ok ? 'bg-ok/15 text-ok' : 'bg-white/[0.08] text-text hover:bg-white/[0.13]')}
        >
          {ok ? <Check size={11} /> : <Copy size={11} />} {ok ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      {rows > 1 ? <textarea rows={rows} {...common} /> : <input type="text" {...common} />}
    </div>
  )
}

/** Painel de uma rede: o passo a passo para postar à mão. */
function NetworkPanel({ clip, net }: { clip: ClipRecord; net: Network }) {
  const at = clip.posted[net]
  const up = UPLOAD[net]
  const [note, setNote] = useState<string | null>(null)
  const file = clip.exportedPath ?? clip.path
  const post = () => {
    if (file) void copyText(file)
    void window.api.openExternal(up.url)
    setNote(`Abri o ${up.site} no navegador${file ? ' e copiei o caminho do vídeo' : ''}.`)
    setTimeout(() => setNote(null), 8000)
  }
  const step = (n: number, done = false) => (
    <span className={cx('grid size-5 shrink-0 place-items-center rounded-full text-[10.5px] font-semibold', done ? 'bg-ok text-black' : 'bg-white/[0.1] text-text')}>
      {done ? <Check size={11} /> : n}
    </span>
  )
  return (
    <div className={cx('space-y-3 rounded-2xl border p-4', at ? 'border-ok/35 bg-ok/[0.05]' : 'border-white/[0.08] bg-white/[0.02]')}>
      <div className="flex items-center gap-2">
        <span className={cx('grid size-8 place-items-center rounded-lg', net === 'youtube' ? 'bg-white' : 'bg-black ring-1 ring-white/20')}>
          <BrandIcon brand={net} size={net === 'youtube' ? 22 : 17} />
        </span>
        <p className="flex-1 text-[14px] font-semibold">{net === 'youtube' ? 'YouTube Shorts' : 'TikTok'}</p>
        {at ? <span className="text-[11.5px] text-ok">postado {when(at)}</span> : <span className="text-[11.5px] text-muted">a postar</span>}
      </div>

      <div className="flex gap-2.5">
        {step(1)}
        <div className="min-w-0 flex-1 space-y-1.5">
          <button
            type="button"
            onClick={post}
            className={cx(
              'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-semibold text-white transition hover:brightness-110',
              net === 'youtube' ? 'bg-[#ff0033]' : 'bg-black ring-1 ring-white/25'
            )}
          >
            {net === 'youtube' ? <BrandIcon brand="youtube" mono size={16} /> : <BrandIcon brand="tiktok" size={14} />} {up.label}
            <ExternalLink size={12} className="opacity-70" />
          </button>
          <p className="text-[11.5px] leading-snug text-muted">{note ?? `Abre a página de envio do ${up.site} no seu navegador e copia o caminho do vídeo.`}</p>
        </div>
      </div>

      <div className="flex gap-2.5">
        {step(2)}
        <p className="flex-1 text-[12px] leading-snug text-text/85">
          Envie o vídeo: <b>arraste</b> o vídeo daqui para a página, ou clique para selecionar o arquivo no site, <b>cole o caminho (Ctrl+V)</b> e aperte Enter.
        </p>
      </div>

      <div className="flex gap-2.5">
        {step(3)}
        <div className="min-w-0 flex-1 space-y-2.5">
          {net === 'youtube' ? (
            <>
              <PostField clip={clip} field="youtubeTitle" label="Título" />
              <PostField clip={clip} field="youtubeDescription" label="Descrição" rows={6} />
            </>
          ) : (
            <PostField clip={clip} field="tiktokCaption" label="Legenda" rows={6} />
          )}
        </div>
      </div>

      <div className="flex gap-2.5">
        {step(4, !!at)}
        <button
          type="button"
          onClick={() => void window.api.markPosted(clip.id, net, !at)}
          className={cx(
            'inline-flex items-center gap-2 rounded-full border px-3.5 py-1 text-[12.5px] transition',
            at ? 'border-ok/50 bg-ok/15 text-ok' : 'border-white/15 text-text hover:border-ok/50 hover:text-ok'
          )}
        >
          <Check size={13} /> {at ? 'Postado (clique para desmarcar)' : 'Marcar como postado'}
        </button>
      </div>
    </div>
  )
}

/**
 * Cartão de "Para postar": o vídeo grande (toca aqui e dá para arrastar até o site)
 * e o passo a passo de cada rede, com os textos à vista e editáveis.
 */
export function PostCard({ clip: c, networks, onOpen }: { clip: ClipRecord; networks: { youtube: boolean; tiktok: boolean }; onOpen: (id: number) => void }) {
  const nets = NETS.filter((n) => networks[n.id]).map((n) => n.id)
  const file = c.exportedPath ?? c.path
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-wrap gap-6 rounded-3xl border border-white/[0.07] bg-white/[0.025] p-5">
      <div className="w-[260px] shrink-0 space-y-2.5">
        <video
          src={`clipador://clipe/${c.id}`}
          poster={`clipador://capa/${c.id}`}
          controls
          preload="none"
          className="aspect-[9/16] w-full rounded-2xl bg-black object-cover shadow-lg shadow-black/40"
        />
        <div
          draggable
          onDragStart={(e) => {
            e.preventDefault()
            window.api.startDrag(c.id)
          }}
          title="Arraste até a área de envio do YouTube ou do TikTok no navegador"
          className="flex cursor-grab items-center gap-2 rounded-xl border border-dashed border-accent/50 bg-accent/[0.08] px-3 py-2 text-[12px] text-text active:cursor-grabbing"
        >
          <GripVertical size={15} className="shrink-0 text-accent-2" />
          <span className="leading-snug">Arraste daqui para a página de envio</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={!file}
            onClick={() =>
              file &&
              void copyText(file).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1400)
              })
            }
            className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] transition', copied ? 'bg-ok/15 text-ok' : 'bg-white/[0.07] hover:bg-white/[0.12]')}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Caminho copiado' : 'Copiar caminho'}
          </button>
          {c.exportedPath ? (
            <button
              type="button"
              onClick={() => void window.api.showInFolder(c.exportedPath!)}
              className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11.5px] hover:bg-white/[0.12]"
            >
              <FolderOpen size={11} /> Na pasta
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void window.api.exportClip(c.id)}
              className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11.5px] hover:bg-white/[0.12]"
            >
              <Upload size={11} /> Copiar para a pasta
            </button>
          )}
        </div>
      </div>

      <div className="min-w-[320px] flex-1 space-y-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-display text-[19px] font-semibold leading-snug tracking-tight">{c.title}</p>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {c.channelName}
              {c.game ? ` · ${c.game}` : ''} · {Math.round(c.durationS)} s{c.score != null ? ` · nota ${c.score}` : ''}
              {c.width && c.height ? ` · ${c.width}×${c.height}` : ''}
            </p>
          </div>
          <button type="button" onClick={() => onOpen(c.id)} title="Abrir o clipe" className="grid size-8 place-items-center rounded-full text-muted hover:bg-white/[0.07] hover:text-text">
            <Maximize2 size={15} />
          </button>
        </div>
        <div className="grid gap-4 2xl:grid-cols-2">
          {nets.map((n) => (
            <NetworkPanel key={n} clip={c} net={n} />
          ))}
        </div>
      </div>
    </div>
  )
}
