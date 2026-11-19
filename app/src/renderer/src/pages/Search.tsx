import { useEffect, useState, type ReactNode } from 'react'
import { Clapperboard, Loader2, MessageSquareQuote, Play, Search, Sparkles } from 'lucide-react'
import type { AiSearchResults, ClipRecord, MomentRecord, SearchResults, SpeechHit } from '../../../shared/types'
import { formatTimecode } from '../../../shared/vod'
import { normText, searchTerms } from '../../../shared/search'
import { BrandIcon } from '../BrandIcon'
import { Button, Card, cx } from '../ui'

/**
 * Busca: por palavra (clipes, momentos e tudo o que foi falado nas gravações) e pela descrição, com a IA.
 * Os cartões de clipe e de momento vêm da tela Clipes, para funcionar igual lá.
 */
export function SearchView({
  query,
  clips,
  aiReady,
  renderClip,
  renderMoment,
  onMake,
  onOpenClip
}: {
  query: string
  clips: ClipRecord[]
  aiReady: boolean
  renderClip: (c: ClipRecord) => ReactNode
  renderMoment: (m: MomentRecord) => ReactNode
  onMake: (momentId: number) => void
  onOpenClip: (clipId: number) => void
}) {
  const q = query.trim()
  const [res, setRes] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [ai, setAi] = useState<AiSearchResults | null>(null)
  const [asking, setAsking] = useState(false)

  // Busca por palavra enquanto digita (espera a pessoa parar um pouco)
  useEffect(() => {
    setAi(null)
    if (!q) return setRes(null)
    setLoading(true)
    let alive = true
    const t = setTimeout(() => {
      void window.api.search(q).then((r) => {
        if (!alive) return
        setRes(r)
        setLoading(false)
      })
    }, 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q])

  const askAi = async () => {
    setAsking(true)
    try {
      setAi(await window.api.searchAi(q))
    } finally {
      setAsking(false)
    }
  }

  const byId = new Map(clips.map((c) => [c.id, c]))
  // Momentos que já viraram clipe aparecem como clipe
  const clipOfMoment = new Map(clips.filter((c) => c.momentId != null).map((c) => [c.momentId!, c]))
  const clipIds = new Set(res?.clipIds ?? [])
  for (const m of res?.moments ?? []) {
    const c = clipOfMoment.get(m.id)
    if (c) clipIds.add(c.id)
  }
  const foundClips = [...clipIds].map((id) => byId.get(id)).filter((c): c is ClipRecord => !!c)
  const foundMoments = (res?.moments ?? []).filter((m) => !clipOfMoment.has(m.id))
  const speech = res?.speech ?? []
  const terms = searchTerms(q)
  const nothing = res && !loading && !foundClips.length && !foundMoments.length && !speech.length

  if (!q)
    return (
      <Card className="flex items-center gap-3 text-[13px] text-muted">
        <Search size={16} className="shrink-0" /> Digite na busca do topo: uma palavra, uma frase que o streamer falou ou a descrição do lance.
      </Card>
    )

  return (
    <div className="space-y-8">
      {/* Pela descrição, com a IA */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Sparkles size={16} className="shrink-0 text-ai" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Buscar pela descrição</p>
            <p className="text-xs text-muted">A KaTY lê os momentos guardados e acha os que combinam pelo sentido, mesmo com outras palavras (ex.: “quando ele caiu do prédio”).</p>
          </div>
          <Button onClick={() => void askAi()} disabled={asking || !aiReady} title={aiReady ? undefined : 'Configure o Gemini em Ajustes > IA e fala'}>
            {asking ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {asking ? 'Procurando…' : 'Perguntar à KaTY'}
          </Button>
        </div>
        {ai?.error && <p className="text-xs text-warn">{ai.error}</p>}
        {ai && !ai.error && ai.matches.length === 0 && <p className="text-xs text-muted">A KaTY leu {ai.read} momentos e nenhum combina com “{ai.query}”.</p>}
        {ai && ai.matches.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted">
              {ai.matches.length} de {ai.read} momentos combinam com “{ai.query}”:
            </p>
            <div className="grid gap-2 lg:grid-cols-2">
              {ai.matches.map(({ moment: m, clipId, why }) => (
                <div key={m.id} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-2">
                  <button
                    type="button"
                    title="Abrir o trecho gravado no player"
                    onClick={() => void window.api.openMoment(m.id)}
                    className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-black/30"
                  >
                    {m.hasThumb ? <img src={`clipador://miniatura/${m.id}`} alt="" className="size-full object-cover" /> : <Sparkles size={14} className="m-auto text-muted" />}
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] tabular-nums text-white">{formatTimecode(m.peakS)}</span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-[13px] font-semibold">{m.ai?.titlePt || m.reasons[0] || `Momento em ${formatTimecode(m.peakS)}`}</p>
                    <p className="line-clamp-2 text-[11px] text-muted">
                      <span className="text-ai">KaTY:</span> {why}
                    </p>
                    <p className="truncate text-[11px] text-muted">
                      {m.channelName}
                      {m.game ? ` · ${m.game}` : ''}
                    </p>
                  </div>
                  {clipId != null ? (
                    <Button variant="ghost" onClick={() => onOpenClip(clipId)}>
                      <Play size={13} /> Ver clipe
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => onMake(m.id)}>
                      <Clapperboard size={13} /> Gerar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {loading && !res && (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 size={13} className="animate-spin" /> Buscando…
        </p>
      )}
      {nothing && (
        <Card className="text-[13px] text-muted">
          Nenhuma palavra “{q}” nos clipes, nos momentos nem no que foi falado. {aiReady ? 'Tente “Perguntar à KaTY” para buscar pelo sentido.' : ''}
        </Card>
      )}

      {foundClips.length > 0 && (
        <Section title="Clipes" count={foundClips.length}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-5 2xl:grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">{foundClips.map(renderClip)}</div>
        </Section>
      )}

      {foundMoments.length > 0 && (
        <Section title="Momentos sem clipe" count={foundMoments.length}>
          <div className="grid gap-3 lg:grid-cols-2">{foundMoments.map(renderMoment)}</div>
        </Section>
      )}

      {speech.length > 0 && (
        <Section title="No que foi falado" count={speech.length} hint="Transcrição de todas as gravações">
          <div className="grid gap-2 lg:grid-cols-2">
            {speech.map((h) => (
              <SpeechRow key={`${h.liveId}-${h.tMs}`} h={h} terms={terms} onMake={onMake} onOpenClip={onOpenClip} />
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function Section({ title, count, hint, children }: { title: string; count: number; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-baseline gap-2 text-[15px] font-semibold">
        {title} <span className="text-xs font-normal tabular-nums text-muted">{count}</span>
        {hint && <span className="text-xs font-normal text-muted">· {hint}</span>}
      </h2>
      {children}
    </section>
  )
}

function SpeechRow({ h, terms, onMake, onOpenClip }: { h: SpeechHit; terms: string[]; onMake: (id: number) => void; onOpenClip: (id: number) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const make = async () => {
    setBusy(true)
    setErr('')
    try {
      onMake(h.momentId ?? (await window.api.momentAt(h.liveId, h.tMs, `“${h.snippet.slice(0, 70)}”`)))
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="flex gap-3 p-3">
      <MessageSquareQuote size={16} className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="flex items-center gap-1.5 truncate text-[11px] text-muted">
          <BrandIcon brand={h.platform} size={12} /> {h.channelName} · {new Date(h.startedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ·{' '}
          <span className="tabular-nums">{formatTimecode(h.offsetS)}</span>
          {h.exact && <span className="rounded bg-accent/20 px-1 text-[10px] text-text">frase inteira</span>}
        </p>
        <p className="text-[13px] leading-snug">
          “<Highlight text={h.snippet} terms={terms} />”
        </p>
        {err && <p className="text-[11px] text-warn">{err}</p>}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {h.clipId != null ? (
            <Button variant="ghost" onClick={() => onOpenClip(h.clipId!)}>
              <Play size={13} /> Ver clipe
            </Button>
          ) : (
            <Button disabled={!h.available || busy} onClick={() => void make()} title={h.available ? undefined : 'A gravação deste trecho já foi apagada'}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Clapperboard size={13} />} {h.momentId != null ? 'Gerar clipe' : 'Fazer clipe daqui'}
            </Button>
          )}
          {h.momentId != null && (
            <Button variant="ghost" onClick={() => void window.api.openMoment(h.momentId!)}>
              <Play size={13} /> Abrir no player
            </Button>
          )}
          {!h.available && <span className="text-[11px] text-muted">gravação apagada</span>}
        </div>
      </div>
    </Card>
  )
}

/** Destaca as palavras buscadas (comparando sem acento). */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const parts = text.split(/(\s+)/)
  return (
    <>
      {parts.map((p, i) => {
        const n = normText(p)
        const hit = n && terms.some((t) => n.includes(t))
        return hit ? (
          <mark key={i} className={cx('rounded bg-gold/25 px-0.5 text-text')}>
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        )
      })}
    </>
  )
}
