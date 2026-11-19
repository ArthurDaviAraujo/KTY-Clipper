import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronsUpDown, Link2, RefreshCw, Scissors, Sparkles, TriangleAlert } from 'lucide-react'
import type { ChannelMatch, ChannelState, LiveRecord, LiveStatus, Modality, Platform } from '../../../shared/types'
import { MODALITIES, modalityOf } from '../../../shared/modality'
import { formatTimecode, parseTimecode, parseVodInput } from '../../../shared/vod'
import type { ChannelsView, Go } from '../App'
import type { AppState } from '../state'
import { Avatar, PlatformBadge } from '../Avatar'
import { BrandIcon } from '../BrandIcon'
import { Button, Card, MoreMenu, PageHeader, Progress, Row, RowList, Section, Segmented, Status, Toggle, cx, timeAgo } from '../ui'
import { PLATFORM_NAME, channelUrl, groupChannels, platformOfLink, sameStreamerKey, wherePlatforms } from '../../../shared/channels'

const clean = (e: unknown) => ((e as Error).message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
/** 3.930.699 → "3,9 mi"; 415.841 → "416 mil" */
const fmtCount = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : n >= 1000 ? `${Math.round(n / 1000)} mil` : String(n)
const fmtSize = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${Math.round(b / 1024 ** 2)} MB`)
const since = (t: number) => {
  const m = Math.floor((Date.now() - t) / 60000)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`
}
const channelLink = (c: { platform: Platform; login: string }) => channelUrl(c.platform, c.login)

export default function ChannelsPage({ state, go, view, setView }: { state: AppState; go: Go; view: ChannelsView; setView: (v: ChannelsView) => void }) {
  const { channels, lives, settings } = state
  const one = typeof view === 'number' ? (channels.find((c) => c.id === view) ?? null) : null
  // Página de um streamer: todas as plataformas dele (o mesmo nome), não só a que foi clicada
  const oneGroup = one ? (groupChannels(channels).find((g) => g.some((c) => c.id === one.id)) ?? [one]) : []
  // Mesmo streamer em várias plataformas fica num bloco só; a lista segue a ordem em que foram adicionados
  const list = view === 'live' ? channels.filter((c) => c.live || c.recording) : one ? oneGroup : channels
  const groups = groupChannels(list)
  const multi = groups.filter((g) => g.length > 1)
  const [opened, setOpened] = useOpenGroups()
  const allOpen = multi.length > 0 && multi.every((g) => opened.has(groupKey(g)))
  const toggle = (g: ChannelState[]) =>
    setOpened((s) => {
      const n = new Set(s)
      const k = groupKey(g)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  const libraryFor = one ? lives.filter((l) => oneGroup.some((c) => l.channelLogin === c.login && l.platform === c.platform)) : lives

  const title = one ? one.displayName : view === 'live' ? 'Ao vivo' : view === 'library' ? 'Lives e VODs' : 'Todos os canais'
  const subtitle =
    view === 'library'
      ? 'Lives gravadas e VODs importados. Abra uma para ver os clipes.'
      : `Vigiar avisa quando o canal entra ao vivo; Gravar salva a live e faz os clipes${settings ? ` (verifica a cada ${settings.recorder.pollSeconds} s)` : ''}.`

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-8">
      <PageHeader
        title={title}
        subtitle={subtitle}
        action={
          <Button variant="ghost" onClick={() => void window.api.checkChannelsNow()}>
            <RefreshCw size={13} /> Verificar agora
          </Button>
        }
      />

      {view === 'all' && <AddChannel />}
      {one && <ChannelModality c={oneGroup.find((c) => c.live) ?? one} group={oneGroup} />}
      {view === 'library' && <ImportVod state={state} />}

      {view !== 'library' && (
        <Section
          title={one ? (oneGroup.length > 1 ? 'Plataformas' : 'Canal') : view === 'live' ? 'Ao vivo agora' : 'Seus canais'}
          action={
            !one && multi.length > 0 ? (
              <button
                type="button"
                onClick={() => setOpened(allOpen ? new Set() : new Set(multi.map(groupKey)))}
                className="flex items-center gap-1 text-[13px] text-accent-2 hover:underline"
              >
                <ChevronsUpDown size={13} /> {allOpen ? 'Recolher todos' : 'Expandir todos'}
              </button>
            ) : undefined
          }
        >
          <RowList>
            {list.length === 0 && (
              <Row>
                <span className="text-[13px] text-muted">{view === 'live' ? 'Ninguém ao vivo agora.' : 'Adicione os streamers que você quer clipar: qualquer jogo, conversa, IRL ou esporte.'}</span>
              </Row>
            )}
            {groups.map((g) =>
              g.length === 1 ? (
                <ChannelRow key={g[0].id} c={g[0]} go={go} onOpen={() => setView(g[0].id)} />
              ) : (
                <ChannelGroup
                  key={g[0].id}
                  group={g}
                  go={go}
                  onOpen={(id) => setView(id)}
                  expanded={!!one || opened.has(groupKey(g))}
                  onToggle={one ? undefined : () => toggle(g)}
                />
              )
            )}
          </RowList>
        </Section>
      )}

      {(view === 'library' || one) && (
        <Section title={one ? (oneGroup.length > 1 ? 'Lives e VODs de todas as plataformas' : 'Lives e VODs deste canal') : `${libraryFor.length} gravação(ões)`}>
          <RowList>
            {libraryFor.length === 0 && (
              <Row>
                <span className="text-[13px] text-muted">As lives gravadas e os VODs importados aparecem aqui.</span>
              </Row>
            )}
            {libraryFor.map((l) => (
              <LiveRow key={l.id} l={l} state={state} onClips={() => go('clips', { liveId: l.id, tab: 'review' })} />
            ))}
          </RowList>
        </Section>
      )}
    </div>
  )
}

/**
 * Vigiar um canal. "Todos": com link, a plataforma vem do link; com só o nome, procura nas três e mostra onde achou.
 */
function AddChannel() {
  const [platform, setPlatform] = useState<Platform | 'all'>('all')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [matches, setMatches] = useState<ChannelMatch[] | null>(null)
  const [ai, setAi] = useState<{ understood: string | null; note: string | null } | null>(null)
  const [adding, setAdding] = useState<string | null>(null)

  const addOne = async (p: Platform, value: string) => {
    await window.api.addChannel(p, value)
  }
  const add = async () => {
    if (!input.trim()) return
    setBusy(true)
    setError(null)
    setMatches(null)
    setAi(null)
    try {
      const fromLink = platformOfLink(input)
      if (platform !== 'all' || fromLink) {
        await addOne(fromLink ?? (platform as Platform), input)
        setInput('')
      } else {
        // Busca com IA: entende nome com erro, apelido ou descrição; as plataformas confirmam os canais
        const res = await window.api.searchChannels(input)
        setAi({ understood: res.understood, note: res.aiNote })
        if (!res.matches.length) setError(`Não achamos "${input.trim()}" na Twitch, na Kick nem no YouTube. Tente outro jeito de escrever ou cole o link do canal.`)
        else setMatches(res.matches)
      }
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy(false)
    }
  }
  const pick = async (m: ChannelMatch) => {
    setAdding(`${m.platform}:${m.login}`)
    setError(null)
    try {
      await addOne(m.platform, m.login)
      setMatches((list) => list?.map((x) => (x === m ? { ...x, already: true } : x)) ?? null)
    } catch (e) {
      setError(clean(e))
    } finally {
      setAdding(null)
    }
  }
  const hint =
    platform === 'all'
      ? 'nome, apelido ou link do canal'
      : platform === 'youtube'
        ? '@canal ou link do canal do YouTube'
        : 'nome ou link do canal'
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-medium">Vigiar um canal</span>
        <Segmented<Platform | 'all'>
          value={platform}
          onChange={(v) => {
            setPlatform(v)
            setMatches(null)
          }}
          options={[
            { value: 'all', label: 'Todos' },
            { value: 'twitch', label: 'Twitch', icon: <BrandIcon brand="twitch" size={13} /> },
            { value: 'kick', label: 'Kick', icon: <BrandIcon brand="kick" size={12} /> },
            { value: 'youtube', label: 'YouTube', icon: <BrandIcon brand="youtube" size={13} /> }
          ]}
        />
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setMatches(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          placeholder={hint}
          className="min-w-0 flex-1 rounded-full border border-white/15 bg-black/20 px-3 py-1 text-[13px] outline-none placeholder:text-muted focus:border-accent"
        />
        <Button onClick={() => void add()} disabled={busy || !input.trim()}>
          {busy ? (platform === 'all' && !platformOfLink(input) ? 'Procurando…' : 'Conferindo…') : platform === 'all' && !platformOfLink(input) ? 'Procurar' : 'Adicionar'}
        </Button>
      </div>
      {matches && (
        <div className="space-y-4 border-t border-white/[0.06] pt-4">
          {ai?.understood ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-relaxed">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ai/10 px-2.5 py-0.5 text-[12px] font-medium text-ai">
                <Sparkles size={12} /> A KaTY entendeu
              </span>
              <span className="text-text">{ai.understood.replace(/[.\s]+$/, '')}</span>
            </p>
          ) : (
            <p className="text-[13px] text-muted">As principais opções para “{input.trim()}”</p>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {matches.map((m, i) => (
              <div
                key={`${m.platform}:${m.login}`}
                className={cx(
                  'flex flex-col gap-3 rounded-2xl border p-4 transition',
                  i === 0 ? 'border-accent/40 bg-accent/[0.07]' : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.14]'
                )}
              >
                <div className="flex items-center gap-3">
                  <Avatar channel={{ platform: m.platform, displayName: m.displayName, avatarUrl: m.avatarUrl, enabled: true }} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[14px] font-semibold leading-tight">
                      <span className="truncate">{m.displayName}</span>
                      {i === 0 && <span className="shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent-2">Mais provável</span>}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 truncate text-[12px] text-muted">
                      <BrandIcon brand={m.platform} size={12} /> {PLATFORM_NAME[m.platform]}
                      {m.followers ? <span>· {fmtCount(m.followers)}</span> : null}
                      {m.live && <span className="text-live">· ao vivo</span>}
                    </p>
                  </div>
                  {m.already ? (
                    <span className="flex shrink-0 items-center gap-1 text-[12px] text-ok">
                      <Check size={13} /> Na lista
                    </span>
                  ) : (
                    <Button variant="ghost" disabled={adding != null} onClick={() => void pick(m)}>
                      {adding === `${m.platform}:${m.login}` ? 'Adicionando…' : 'Adicionar'}
                    </Button>
                  )}
                </div>
                {m.why && <p className="line-clamp-2 text-[12px] leading-relaxed text-muted">{m.why}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
      {ai?.note && <p className="text-[11px] text-muted">{ai.note}</p>}
      {error && <p className="text-xs text-err">{error}</p>}
    </Card>
  )
}

/** Importar um VOD por link (com trecho opcional). */
export function ImportVod({ state }: { state: AppState }) {
  const [url, setUrl] = useState('')
  const [useRange, setUseRange] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = parseVodInput(url)
  const start = useRange ? parseTimecode(from) : null
  const end = useRange ? parseTimecode(to) : null
  const rangeInvalid = useRange && (Number.isNaN(start) || Number.isNaN(end) || (start != null && end != null && end <= start))

  const submit = async () => {
    if (!ref || rangeInvalid) return
    setBusy(true)
    setError(null)
    try {
      await window.api.importVod(url, start, end)
      setUrl('')
      setFrom('')
      setTo('')
      setUseRange(false)
      await state.refreshLives()
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-[13px] font-medium">Importar VOD</span>
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-white/15 bg-black/20 px-3 py-1 focus-within:border-accent">
          <Link2 size={13} className="shrink-0 text-muted" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            placeholder="twitch.tv/videos/…, kick.com/canal/videos/… ou youtube.com/watch?v=…"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted"
          />
        </label>
        <Button onClick={() => void submit()} disabled={busy || !ref || rangeInvalid}>
          {busy ? 'Conferindo…' : 'Importar'}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <Toggle label="Só um trecho" checked={useRange} onChange={setUseRange} />
        <span className="flex items-center gap-1">
          <Scissors size={12} /> Só um trecho
        </span>
        {useRange && (
          <>
            <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="início 1:20:00" className="w-28 rounded-full border border-white/15 bg-black/20 px-3 py-0.5 text-text outline-none focus:border-accent" />
            <span>até</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="fim (vazio = final)" className="w-36 rounded-full border border-white/15 bg-black/20 px-3 py-0.5 text-text outline-none focus:border-accent" />
          </>
        )}
      </div>
      {url && !ref && <p className="text-xs text-warn">Link não reconhecido: use um VOD da Twitch ou da Kick.</p>}
      {rangeInvalid && <p className="text-xs text-warn">Use h:mm:ss; o fim precisa vir depois do início.</p>}
      {error && (
        <p className="flex items-start gap-1 text-xs text-err">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
    </Card>
  )
}

/** Modalidade do canal: automática pela categoria da live, ou fixa (ex.: um streamer que só conversa enquanto joga). */
function ChannelModality({ c, group }: { c: ChannelState; group: ChannelState[] }) {
  const now = c.live?.game ?? null
  const auto = modalityOf(now)
  return (
    <Section title="Modalidade">
      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Que tipo de live é este {group.length > 1 ? 'streamer' : 'canal'}</p>
          <p className="text-xs text-muted">
            Automática: segue a categoria de cada momento da live{now ? ` (agora: ${now}, ${auto ? MODALITIES[auto].label : 'sem modalidade'})` : ''}. Fixe uma
            modalidade se a categoria não combina com o conteúdo. Vale para a IA, o layout, a duração e os pesos dos clipes.
          </p>
        </div>
        <Segmented<Modality | 'auto'>
          value={c.modality ?? 'auto'}
          onChange={(v) => {
            // Mesmo streamer: a modalidade vale para todas as plataformas dele
            for (const x of group) void window.api.setChannelModality(x.id, v === 'auto' ? null : v)
          }}
          options={[
            { value: 'auto', label: 'Automática' },
            ...(Object.keys(MODALITIES) as Modality[]).map((m) => ({ value: m, label: MODALITIES[m].label[0].toUpperCase() + MODALITIES[m].label.slice(1), hint: MODALITIES[m].hint }))
          ]}
        />
      </Card>
    </Section>
  )
}

/** O mesmo streamer em várias plataformas: cabeçalho único e uma linha por plataforma, com as chaves de cada uma. */
const groupKey = (g: ChannelState[]) => sameStreamerKey(g[0].displayName) || `id${g[0].id}`
const OPEN_KEY = 'clipador:canais-abertos'

/** Quais streamers estão expandidos (lembrado neste PC); começam todos recolhidos. */
function useOpenGroups() {
  const [s, setS] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const set = (v: Set<string> | ((prev: Set<string>) => Set<string>)) =>
    setS((prev) => {
      const next = typeof v === 'function' ? v(prev) : v
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]))
      } catch {
        // sem armazenamento: só não lembra
      }
      return next
    })
  return [s, set] as const
}

/**
 * O mesmo streamer em várias plataformas. Recolhido: uma linha com cada plataforma e uma bolinha de status
 * (vermelha gravando, azul ao vivo, cinza fora do ar). Clicando, expande uma linha por plataforma com as chaves.
 */
function ChannelGroup({
  group,
  go,
  onOpen,
  expanded,
  onToggle
}: {
  group: ChannelState[]
  go: Go
  onOpen: (id: number) => void
  expanded: boolean
  onToggle?: () => void
}) {
  const first = group[0]
  const recording = group.find((c) => c.recording)?.recording ?? null
  const live = group.find((c) => c.live)?.live ?? null
  const avatar = group.find((c) => c.avatarUrl) ?? first
  const liveOn = group.filter((c) => c.live || c.recording)
  return (
    <div className="first:rounded-t-2xl last:rounded-b-2xl">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        title={onToggle ? (expanded ? 'Recolher' : 'Expandir as plataformas') : undefined}
        className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition hover:bg-white/[0.025]"
      >
        <Avatar channel={{ ...avatar, live, recording }} size={36} badge={false} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{first.displayName}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
            {group.map((c) => (
              <span
                key={c.id}
                className={cx('inline-flex items-center gap-1', !c.enabled && 'opacity-50')}
                title={c.recording ? 'gravando' : c.live ? 'ao vivo' : c.enabled ? 'fora do ar' : 'sem vigiar'}
              >
                <span className={cx('size-1.5 rounded-full', c.recording ? 'bg-live' : c.live ? 'bg-accent-2' : 'bg-white/20')} />
                <BrandIcon brand={c.platform} size={11} /> {PLATFORM_NAME[c.platform]}
              </span>
            ))}
          </p>
        </div>
        {!expanded && liveOn.length > 0 && (
          <span className="hidden truncate text-[12px] text-muted md:block">
            {recording ? 'gravando' : 'ao vivo'} {wherePlatforms(liveOn.map((c) => c.platform), group.length)}
          </span>
        )}
        {live && (
          <span
            className={cx(
              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
              recording ? 'live-ring bg-live text-white' : 'bg-live/15 text-live'
            )}
          >
            {!recording && <span className="live-dot" />}
            {recording ? 'gravando' : 'ao vivo'}
          </span>
        )}
        {onToggle && <ChevronDown size={16} className={cx('shrink-0 text-muted transition', expanded && 'rotate-180')} />}
      </button>
      {expanded && (
        <div className="mx-5 mb-3.5 divide-y divide-white/[0.05] rounded-xl border border-white/[0.06] bg-black/10 sm:ml-[72px]">
          {group.map((c) => (
            <ChannelRow key={c.id} c={c} go={go} onOpen={() => onOpen(c.id)} sub />
          ))}
        </div>
      )}
    </div>
  )
}

function ChannelRow({ c, go, onOpen, sub = false }: { c: ChannelState; go: Go; onOpen: () => void; sub?: boolean }) {
  const rec = c.recording
  const warn = rec?.lastError ?? (!c.live ? c.lastError : null)
  if (sub)
    return (
      <div className={cx('flex items-center gap-4 px-4 py-2.5', !c.enabled && 'opacity-60')}>
        <button type="button" onClick={onOpen} className="flex w-28 shrink-0 items-center gap-1.5 text-left text-[12px] font-medium" title={`${c.displayName} na ${PLATFORM_NAME[c.platform]}`}>
          <BrandIcon brand={c.platform} size={13} /> {PLATFORM_NAME[c.platform]}
        </button>
        <ChannelStatus c={c} warn={warn} />
        <ChannelActions c={c} go={go} onOpen={onOpen} />
      </div>
    )
  return (
    <Row className={c.enabled ? '' : 'opacity-60'}>
      <button type="button" onClick={onOpen} className="shrink-0">
        <Avatar channel={c} size={32} />
      </button>
      <button type="button" onClick={onOpen} className="w-44 min-w-0 text-left">
        <p className="truncate text-[13px] font-medium">{c.displayName}</p>
        <p className="truncate text-[11px] text-muted">
          <BrandIcon brand={c.platform} size={11} className="mr-1 inline align-[-1px]" />
          {PLATFORM_NAME[c.platform]}
          {c.modality ? ` · ${MODALITIES[c.modality].label}` : ''}
        </p>
      </button>
      <ChannelStatus c={c} warn={warn} />
      <ChannelActions c={c} go={go} onOpen={onOpen} />
    </Row>
  )
}

function ChannelStatus({ c, warn }: { c: ChannelState; warn: string | null | undefined }) {
  const rec = c.recording
  return (
    <div className="min-w-0 flex-1 space-y-0.5">
      {rec ? (
        <Status tone="live">
          Gravando há {since(c.live?.startedAt ?? Date.now())} · {rec.resolution ?? '…'} · {fmtSize(rec.bytes)}
        </Status>
      ) : c.live ? (
        <Status tone="info">
          Ao vivo{c.live.isRerun ? ' (reprise)' : ''}
          {!c.record ? ' · só vigiando, não está gravando' : ''}
        </Status>
      ) : (
        <Status tone="muted">{!c.enabled ? 'Sem vigiar' : `Offline${c.lastCheckedAt ? ` · visto ${timeAgo(c.lastCheckedAt)}` : ''}`}</Status>
      )}
      {c.live?.title && <p className="truncate pl-3.5 text-[11px] text-muted">{c.live.title}</p>}
      {warn && (
        <p className="flex items-center gap-1 pl-3.5 text-[11px] text-warn">
          <TriangleAlert size={11} /> {warn}
        </p>
      )}
    </div>
  )
}

/** Chaves Vigiar e Gravar, o botão principal e o menu "…" de um canal. */
function ChannelActions({ c, go, onOpen }: { c: ChannelState; go: Go; onOpen: () => void }) {
  const rec = c.recording
  return (
    <>
      {/* Vigiar = saber quando entra ao vivo; Gravar = salvar a live e clipar (precisa de vigiar) */}
      <div className="flex shrink-0 items-center gap-4">
        <label className="flex items-center gap-2 text-[12px] text-muted" title="O app checa a cada minuto se o canal está ao vivo e avisa. Não grava nada.">
          Vigiar
          <Toggle label="Vigiar canal" checked={c.enabled} onChange={(v) => void window.api.setChannelEnabled(c.id, v)} />
        </label>
        <label className="flex items-center gap-2 text-[12px] text-muted" title="Quando o canal está ao vivo, grava a live, procura os lances e gera os clipes. Liga o vigiar junto.">
          Gravar
          <Toggle label="Gravar quando estiver ao vivo" checked={c.record} onChange={(v) => void window.api.setChannelRecord(c.id, v)} />
        </label>
      </div>
      {rec ? (
        <Button className="w-[96px] justify-center" onClick={() => go('clips', { liveId: rec.liveId, tab: 'review' })}>Ver clipes</Button>
      ) : (
        <Button variant="ghost" className="w-[96px] justify-center" onClick={onOpen}>
          Abrir
        </Button>
      )}
      <MoreMenu
        items={[
          { label: 'Parar a gravação', onClick: () => void window.api.stopRecording(c.id), hidden: !rec },
          { label: 'Abrir a pasta da gravação', onClick: () => rec && void window.api.openPath(rec.dir), hidden: !rec },
          { label: 'Abrir o canal no navegador', onClick: () => void window.api.openExternal(channelLink(c)) },
          {
            label: 'Tirar da lista',
            danger: true,
            onClick: () => confirm(`Tirar ${c.displayName} da lista? As gravações dele continuam em "Lives e VODs".`) && void window.api.removeChannel(c.id)
          }
        ]}
      />
    </>
  )
}

const STATUS: Record<LiveStatus, { label: string; tone: 'ok' | 'info' | 'live' | 'warn' | 'muted' }> = {
  recording: { label: 'Gravando', tone: 'live' },
  interrupted: { label: 'Pausada', tone: 'warn' },
  ended: { label: 'Gravada', tone: 'ok' },
  queued: { label: 'Na fila', tone: 'muted' },
  importing: { label: 'Baixando', tone: 'info' },
  imported: { label: 'Pronta', tone: 'ok' },
  failed: { label: 'Falhou', tone: 'warn' }
}

function LiveRow({ l, state, onClips }: { l: LiveRecord; state: AppState; onClips: () => void }) {
  const [broken, setBroken] = useState(false)
  const busy = l.status === 'importing' || l.status === 'queued'
  const st = STATUS[l.status]
  const clips = state.clips.filter((c) => c.liveId === l.id)
  const pending = clips.filter((c) => c.review === 'pending').length
  const range = l.rangeStartS != null || l.rangeEndS != null ? ` · trecho ${formatTimecode(l.rangeStartS ?? 0)}–${l.rangeEndS != null ? formatTimecode(l.rangeEndS) : 'fim'}` : ''

  return (
    <Row>
      <div className="relative shrink-0">
        {l.avatarUrl && !broken ? (
          <img src={l.avatarUrl} alt="" onError={() => setBroken(true)} className="size-8 rounded-full object-cover" />
        ) : (
          <div className="grid size-8 place-items-center rounded-full bg-white/10 text-[11px] font-bold uppercase">{l.channelName.slice(0, 2)}</div>
        )}
        <PlatformBadge platform={l.platform} size={15} />
      </div>
      <div className="w-56 min-w-0">
        <p className="truncate text-[13px] font-medium" title={l.title}>
          {l.title || 'Sem título'}
        </p>
        <p className="truncate text-[11px] text-muted">
          {l.channelName} · {new Date(l.startedAt).toLocaleDateString('pt-BR')} · {l.kind === 'vod' ? 'VOD' : 'ao vivo'}
          {range}
        </p>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <Status tone={st.tone}>
          {st.label}
          {l.status === 'importing' && l.progress != null ? ` ${Math.round(l.progress * 100)}%` : ''} · {formatTimecode(l.recordedS)} · {fmtSize(l.bytes)}
        </Status>
        {l.status === 'importing' && l.progress != null && <Progress value={l.progress} />}
        {l.error && l.status !== 'imported' && <p className="truncate pl-3.5 text-[11px] text-warn">{l.error}</p>}
      </div>
      {l.segments > 0 && (
        <Button onClick={onClips} variant={pending ? 'primary' : 'ghost'}>
          {clips.length ? `${clips.length} clipe(s)${pending ? ` · ${pending} p/ revisar` : ''}` : 'Ver momentos'}
        </Button>
      )}
      <MoreMenu
        items={[
          { label: 'Abrir a pasta', onClick: () => l.dir && void window.api.openPath(l.dir), hidden: !l.dir },
          { label: 'Cancelar', onClick: () => void window.api.cancelImport(l.id), hidden: !busy },
          { label: 'Tentar de novo', onClick: () => void window.api.retryImport(l.id), hidden: !((l.status === 'failed' || l.chatStatus === 'failed') && l.kind === 'vod') },
          {
            label: 'Apagar a gravação',
            danger: true,
            hidden: l.status === 'recording',
            onClick: () =>
              confirm(`Apagar ${l.kind === 'vod' ? 'o VOD' : 'a gravação'} de ${l.channelName} (${fmtSize(l.bytes)})? Os clipes prontos continuam.`) &&
              void window.api.deleteLive(l.id).catch((e) => alert(clean(e)))
          }
        ]}
      />
    </Row>
  )
}
