import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Captions, Clapperboard, FolderOpen, Loader2, ScanFace, Trash2, Type, X } from 'lucide-react'
import { LAYOUTS } from '../../shared/clips'
import { formatTimecode } from '../../shared/vod'
import type { ClipDraft, ClipLayout, ClipOptions, ClipRecord, Rect } from '../../shared/types'
import { Badge, Button, Segmented, Toggle, cx } from './ui'

const clean = (e: unknown) => ((e as Error).message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6 pt-12 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {children}
    </div>
  )
}

/** Desenho pequeno de cada layout (9:16 ou 16:9) */
function LayoutIcon({ id }: { id: ClipLayout }) {
  const box = 'fill-none stroke-current'
  if (id === 'full')
    return (
      <svg viewBox="0 0 32 18" className="h-7 w-12">
        <rect x="1" y="1" width="30" height="16" rx="2" className={box} strokeWidth="1.5" />
        <rect x="4" y="4" width="24" height="10" rx="1" className="fill-current opacity-40" />
      </svg>
    )
  return (
    <svg viewBox="0 0 18 32" className="h-12 w-7">
      <rect x="1" y="1" width="16" height="30" rx="2" className={box} strokeWidth="1.5" />
      {id === 'split' && (
        <>
          <rect x="2.5" y="2.5" width="13" height="9" rx="1" className="fill-current opacity-70" />
          <rect x="2.5" y="12.5" width="13" height="17" rx="1" className="fill-current opacity-35" />
        </>
      )}
      {id === 'blur' && (
        <>
          <rect x="2.5" y="2.5" width="13" height="27" rx="1" className="fill-current opacity-15" />
          <rect x="2.5" y="12" width="13" height="8" rx="1" className="fill-current opacity-60" />
        </>
      )}
      {id === 'crop' && <rect x="2.5" y="2.5" width="13" height="27" rx="1" className="fill-current opacity-45" />}
    </svg>
  )
}

/** Marca a facecam arrastando um retângulo sobre um quadro da live. */
function FacecamPicker({ momentId, initial, onSave, onCancel }: { momentId: number; initial: Rect | null; onSave: (r: Rect | null) => void; onCancel: () => void }) {
  const [img, setImg] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [rect, setRect] = useState<Rect | null>(initial)
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    window.api.momentFrame(momentId).then(setImg, (e) => setErr(clean(e)))
  }, [momentId])
  const at = (e: ReactPointerEvent) => {
    const b = ref.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) }
  }
  const move = (e: ReactPointerEvent) => {
    if (!drag.current) return
    const p = at(e)
    const s = drag.current
    setRect({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) })
  }
  return (
    <div className="space-y-3">
      <div>
        <p className="font-semibold">Onde está a câmera do streamer?</p>
        <p className="text-xs text-muted">Arraste um retângulo em volta da facecam. Fica guardado para todos os clipes deste canal.</p>
      </div>
      {err && <p className="text-sm text-err">{err}</p>}
      {!img && !err && (
        <div className="grid aspect-video place-items-center rounded-xl bg-panel text-muted">
          <Loader2 className="animate-spin" />
        </div>
      )}
      {img && (
        <div
          ref={ref}
          className="relative cursor-crosshair touch-none overflow-hidden rounded-xl"
          onPointerDown={(e) => {
            try {
              ;(e.target as Element).setPointerCapture(e.pointerId)
            } catch {
              // sem captura o arraste ainda funciona dentro da imagem
            }
            drag.current = at(e)
            setRect(null)
          }}
          onPointerMove={move}
          onPointerUp={() => (drag.current = null)}
        >
          <img src={img} alt="" draggable={false} className="block w-full" />
          {rect && (
            <div
              className="pointer-events-none absolute border-2 border-accent bg-accent/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
              style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
            />
          )}
        </div>
      )}
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={() => onSave(null)} title="Apaga a facecam deste canal">
          <Trash2 size={14} /> Sem facecam
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Voltar
          </Button>
          <Button disabled={!rect || rect.w < 0.03 || rect.h < 0.03} onClick={() => onSave(rect)}>
            Salvar facecam
          </Button>
        </div>
      </div>
    </div>
  )
}

function Nudge({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 10) / 10)))
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="w-12 text-sm text-muted">{label}</span>
      <div className="flex items-center gap-1">
        {[-5, -1].map((d) => (
          <button key={d} type="button" onClick={() => set(value + d)} className="rounded-lg border border-line px-2 py-1 text-xs text-muted hover:border-accent/60 hover:text-text">
            {d}s
          </button>
        ))}
        <span className="w-20 text-center text-sm tabular-nums">{formatTimecode(value)}</span>
        {[1, 5].map((d) => (
          <button key={d} type="button" onClick={() => set(value + d)} className="rounded-lg border border-line px-2 py-1 text-xs text-muted hover:border-accent/60 hover:text-text">
            +{d}s
          </button>
        ))}
      </div>
    </div>
  )
}

/** Janela "Gerar clipe": layout, facecam, trecho, legenda, título e qualidade, com prévia de um quadro. */
export function ClipModal({ momentId, onClose }: { momentId: number; onClose: () => void }) {
  const [draft, setDraft] = useState<ClipDraft | null>(null)
  const [o, setO] = useState<ClipOptions | null>(null)
  const [facecam, setFacecam] = useState<Rect | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [picking, setPicking] = useState(false)
  const [sending, setSending] = useState(false)
  const reqId = useRef(0)

  useEffect(() => {
    window.api.clipDraft(momentId).then(
      (d) => {
        setDraft(d)
        setO(d.options)
        setFacecam(d.facecam)
      },
      (e) => setError(clean(e))
    )
  }, [momentId])

  // Prévia: espera parar de mexer (0,4 s) e ignora respostas atrasadas
  useEffect(() => {
    if (!o || picking) return
    const id = ++reqId.current
    setLoading(true)
    const t = setTimeout(() => {
      window.api.previewClip(momentId, o).then(
        (img) => {
          if (id !== reqId.current) return
          setPreview(img)
          setError('')
          setLoading(false)
        },
        (e) => {
          if (id !== reqId.current) return
          setError(clean(e))
          setLoading(false)
        }
      )
    }, 400)
    return () => clearTimeout(t)
  }, [o, facecam, picking, momentId])

  const set = (patch: Partial<ClipOptions>) => setO((cur) => (cur ? { ...cur, ...patch } : cur))
  const vertical = o?.layout !== 'full'
  const dur = o ? o.endS - o.startS : 0
  const needsCam = o?.layout === 'split' && !facecam

  const submit = async () => {
    if (!o) return
    setSending(true)
    try {
      await window.api.renderClip(momentId, o)
      onClose()
    } catch (e) {
      setError(clean(e))
      setSending(false)
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line/70 px-5 py-3">
          <div className="flex items-center gap-2">
            <Clapperboard size={18} className="text-accent" />
            <p className="font-semibold">Gerar clipe</p>
            {draft && <span className="text-sm text-muted">· {draft.channelName}</span>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted hover:text-text" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* Prévia (ou marcação da facecam) */}
          <div className="min-w-0">
            {picking && draft ? (
              <FacecamPicker
                momentId={momentId}
                initial={facecam}
                onCancel={() => setPicking(false)}
                onSave={(r) => {
                  void window.api.setFacecam(draft.channelId, r).then(() => {
                    setFacecam(r)
                    setPicking(false)
                    if (r && o?.layout !== 'split') set({ layout: 'split' })
                  })
                }}
              />
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className={cx('relative overflow-hidden rounded-xl bg-black', vertical ? 'aspect-[9/16] h-[min(62vh,620px)]' : 'aspect-video w-full')}>
                  {preview && <img src={preview} alt="Prévia do clipe" className="size-full object-contain" />}
                  {loading && (
                    <div className="absolute inset-0 grid place-items-center bg-black/40 text-white">
                      <Loader2 className="animate-spin" />
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted">Prévia de um quadro no pico do lance, com a legenda daquele instante.</p>
              </div>
            )}
          </div>

          {/* Opções */}
          {o && draft && (
            <div className="min-w-0 space-y-5">
              <div className="space-y-2">
                <p className="text-sm font-medium">Layout</p>
                <div className="grid grid-cols-4 gap-2">
                  {LAYOUTS.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      title={l.hint}
                      onClick={() => set({ layout: l.id })}
                      className={cx(
                        'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-center text-xs transition',
                        o.layout === l.id ? 'border-accent bg-accent/15 text-text' : 'border-line text-muted hover:border-accent/50 hover:text-text'
                      )}
                    >
                      <LayoutIcon id={l.id} />
                      {l.label}
                    </button>
                  ))}
                </div>
                {o.layout === 'split' && (
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-card/60 px-3 py-2">
                    <span className="flex items-center gap-2 text-xs">
                      <ScanFace size={14} className={facecam ? 'text-ok' : 'text-warn'} />
                      {facecam ? 'Facecam marcada para este canal.' : 'Marque a facecam; sem ela o clipe sai em tela inteira.'}
                    </span>
                    <Button variant="ghost" onClick={() => setPicking(true)}>
                      {facecam ? 'Ajustar' : 'Marcar facecam'}
                    </Button>
                  </div>
                )}
                {((o.layout === 'split' && facecam) || o.layout === 'crop') && (
                  <div className="flex items-center gap-3">
                    <span className="w-36 text-xs text-muted">Posição do recorte do jogo</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(o.cropX * 100)}
                      onChange={(e) => set({ cropX: Number(e.target.value) / 100 })}
                      className="flex-1"
                      aria-label="Posição do recorte"
                    />
                    <button type="button" className="text-xs text-muted hover:text-text" onClick={() => set({ cropX: 0.5 })}>
                      centro
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Trecho</p>
                  <span className={cx('text-xs tabular-nums', dur > 60 ? 'text-warn' : 'text-muted')}>
                    {dur.toFixed(1)} s{dur > 60 ? ' · Shorts aceita até 60 s (TikTok, mais)' : ''}
                  </span>
                </div>
                <Nudge label="Início" value={o.startS} min={draft.minS} max={o.endS - 3} onChange={(v) => set({ startS: v })} />
                <Nudge label="Fim" value={o.endS} min={o.startS + 3} max={draft.maxS} onChange={(v) => set({ endS: v })} />
              </div>

              <div className="flex items-center gap-3">
                <Toggle label="Legenda" checked={o.captions} onChange={(v) => set({ captions: v })} />
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Captions size={14} /> Legenda palavra a palavra
                  </p>
                  <p className="text-xs text-muted">Do que o streamer falou (Whisper); estilo em Ajustes &gt; Clipes.</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Type size={14} /> Título na tela
                </p>
                <input
                  value={o.title}
                  onChange={(e) => set({ title: e.target.value })}
                  placeholder="Sem título"
                  className="w-full rounded-xl border border-line bg-bg/60 px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <div className="flex flex-wrap gap-1.5">
                  {draft.titlePt && (
                    <button type="button" onClick={() => set({ title: draft.titlePt })}>
                      <Badge tone="accent">PT: {draft.titlePt.slice(0, 40)}</Badge>
                    </button>
                  )}
                  {draft.titleEn && (
                    <button type="button" onClick={() => set({ title: draft.titleEn })}>
                      <Badge tone="accent">EN: {draft.titleEn.slice(0, 40)}</Badge>
                    </button>
                  )}
                  {o.title && (
                    <button type="button" onClick={() => set({ title: '' })}>
                      <Badge tone="muted">sem título</Badge>
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Qualidade</p>
                <Segmented
                  value={o.preset}
                  onChange={(v) => set({ preset: v })}
                  options={[
                    { value: 'fast', label: 'Rápido', hint: '720p, 30 fps' },
                    { value: 'balanced', label: 'Equilibrado', hint: '1080p, até 60 fps' },
                    { value: 'max', label: 'Máxima', hint: '1440p (4K se a live for 4K), até 60 fps' }
                  ]}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line/70 px-5 py-3">
          <p className={cx('min-w-0 truncate text-sm', error ? 'text-err' : 'text-muted')} title={error}>
            {error || (needsCam ? 'Sem facecam marcada: este clipe sai em tela inteira.' : 'O clipe vai para a fila e aparece no cartão do momento.')}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button disabled={!o || sending || picking || dur < 3} onClick={() => void submit()}>
              <Clapperboard size={14} /> {draft?.clipId ? 'Gerar de novo' : 'Gerar clipe'}
            </Button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}

/** Player do clipe pronto, com atalhos para a pasta e o texto de postagem. */
export function ClipPlayer({ clip, onClose }: { clip: ClipRecord; onClose: () => void }) {
  const vertical = (clip.height ?? 16) > (clip.width ?? 9)
  return (
    <Overlay onClose={onClose}>
      <div className="flex max-h-full flex-col items-center gap-3">
        <video
          src={`clipador://clipe/${clip.id}`}
          controls
          autoPlay
          className={cx('rounded-xl bg-black shadow-2xl', vertical ? 'h-[min(78vh,860px)]' : 'w-[min(80vw,1100px)]')}
        />
        <div className="flex max-w-xl flex-col items-center gap-2 text-center">
          <p className="font-semibold">{clip.title}</p>
          {clip.hashtags.length > 0 && <p className="text-xs text-muted">{clip.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}</p>}
          <div className="flex gap-2">
            {clip.path && (
              <Button variant="ghost" onClick={() => void window.api.showInFolder(clip.path!)}>
                <FolderOpen size={14} /> Mostrar na pasta
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
