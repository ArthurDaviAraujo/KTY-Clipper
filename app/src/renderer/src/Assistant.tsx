import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Check, Maximize2, MessageSquarePlus, PanelRight, PanelRightClose, RotateCcw, Sparkles, Square, TriangleAlert, X } from 'lucide-react'
import type { AssistantMessage, AssistantState } from '../../shared/types'
import { GearStar, cx } from './ui'

/** Estado da conversa com o assistente (vem do processo principal e se atualiza sozinho). */
export function useAssistant(): AssistantState {
  const [s, setS] = useState<AssistantState>({ messages: [], busy: false, ready: true })
  useEffect(() => {
    void window.api.assistantState().then(setS)
    return window.api.onAssistant(setS)
  }, [])
  // Sem chave pronta (ao abrir o app ela pode ainda não ter sido lida, ou a pessoa acabou de configurar):
  // pergunta de novo de tempos em tempos e quando a janela volta ao foco
  useEffect(() => {
    if (s.ready) return
    const again = () => void window.api.assistantState().then(setS)
    const t = setInterval(again, 5000)
    window.addEventListener('focus', again)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', again)
    }
  }, [s.ready])
  return s
}

const SUGGESTIONS = [
  'O que eu preciso fazer para começar?',
  'Quais são os melhores clipes para revisar?',
  'Quem está ao vivo agora?',
  'Como o app escolhe os momentos?',
  'Deixa os clipes de conversa com no máximo 60 s',
  'Acha o momento em que o streamer bateu o carro'
]

/** Pedidos de exemplo do menu lateral da aba KaTY (um clique manda para ela) */
const EXAMPLES = [
  'Adiciona o canal do gaules na Kick',
  'Aprova os 3 melhores clipes de hoje',
  'Por que esse momento teve nota alta?',
  'Importa os últimos 30 min do VOD…',
  'Deixa a legenda em letras menores'
]

/** Nome bonito do modelo: "gemini-3.5-flash-lite" → "Gemini 3.5 Flash Lite" */
const modelName = (m: string) =>
  m
    .split(/[-_/]/)
    .filter(Boolean)
    .map((p) => (/^\d/.test(p) ? p : p[0].toUpperCase() + p.slice(1)))
    .join(' ')

/** Menu da esquerda da aba KaTY: quem ela é e se está pronta, as ações da conversa e pedidos de exemplo. */
export function KatySidebar({ state, onSetup, onOpenSide }: { state: AssistantState; onSetup: () => void; onOpenSide: () => void }) {
  const [status, setStatus] = useState<{ model: string | null; backups: number } | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      void Promise.all([window.api.aiStatus(), typeof window.api.aiBackups === 'function' ? window.api.aiBackups() : Promise.resolve([])]).then(([a, b]) => {
        if (alive) setStatus({ model: a.hasKey && !a.keyUnreadable ? a.model : null, backups: b.filter((x) => x.ready).length })
      })
    load()
    window.addEventListener('focus', load)
    return () => {
      alive = false
      window.removeEventListener('focus', load)
    }
  }, [state.ready])
  const ready = state.ready && !!status?.model
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-text/90 transition hover:bg-white/[0.06] hover:text-text'

  return (
    <div className="space-y-6">
      {/* Quem é e se está pronta */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-violet/[0.18] via-white/[0.03] to-accent/[0.12] p-3.5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand via-violet to-accent text-white shadow-md shadow-violet/30">
            <Sparkles size={16} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-[15px] font-semibold leading-tight">KaTY</p>
            <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
              <span className={cx('size-1.5 shrink-0 rounded-full', ready ? (state.busy ? 'animate-pulse bg-warn' : 'bg-ok') : 'bg-err')} />
              {!status ? '…' : ready ? (state.busy ? 'Pensando…' : 'Pronta') : 'Sem chave do Gemini'}
            </p>
          </div>
        </div>
        <p className="mt-2.5 truncate text-[11.5px] text-muted" title={status?.model ?? ''}>
          {status?.model ? modelName(status.model) : 'Cole a chave grátis do Gemini'}
          {status && status.backups > 0 ? ` · ${status.backups} reserva${status.backups > 1 ? 's' : ''}` : ''}
        </p>
      </div>

      <div className="space-y-0.5">
        <p className="px-2 pb-1 text-[11px] text-muted/80">Conversa</p>
        <button type="button" className={item} onClick={() => void window.api.assistantClear()}>
          <MessageSquarePlus size={15} className="shrink-0 text-muted" /> Nova conversa
        </button>
        <button type="button" className={item} onClick={onOpenSide}>
          <PanelRight size={15} className="shrink-0 text-muted" /> Abrir na barra lateral
        </button>
        <button type="button" className={item} onClick={onSetup}>
          <GearStar size={15} className="text-muted" /> Configurações da KaTY
        </button>
      </div>

      <div className="space-y-1.5">
        <p className="px-2 text-[11px] text-muted/80">Peça, por exemplo</p>
        {EXAMPLES.map((t) => (
          <button
            key={t}
            type="button"
            disabled={!state.ready || state.busy}
            title="Mandar este pedido para a KaTY"
            onClick={() => void window.api.assistantSend(t)}
            className="group flex w-full items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-2.5 py-2 text-left text-[12.5px] leading-snug text-text/80 transition hover:border-violet/40 hover:bg-violet/[0.08] hover:text-text disabled:opacity-50"
          >
            <Sparkles size={12} className="mt-0.5 shrink-0 text-ai opacity-70 group-hover:opacity-100" />
            <span>{t}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Negrito com **texto** e `nome` dentro de uma linha. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : p.startsWith('`') && p.endsWith('`') && p.length > 2 ? (
      <span key={i} className="rounded bg-white/[0.08] px-1 py-px text-[12.5px]">
        {p.slice(1, -1)}
      </span>
    ) : (
      <span key={i}>{p}</span>
    )
  )
}

/** Texto da IA com parágrafos e listas simples (- item, 1. item). */
function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const Tag = list.ordered ? 'ol' : 'ul'
    blocks.push(
      <Tag key={blocks.length} className={cx('space-y-1 pl-5', list.ordered ? 'list-decimal' : 'list-disc')}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </Tag>
    )
    list = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const b = line.match(/^\s*[-•*]\s+(.*)$/)
    const n = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (b || n) {
      const ordered = !!n
      if (list && list.ordered !== ordered) flush()
      list ??= { ordered, items: [] }
      list.items.push((b ?? n)![1])
      continue
    }
    flush()
    if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ''))}</p>)
  }
  flush()
  return <div className="space-y-2">{blocks}</div>
}

function Bubble({ m }: { m: AssistantMessage }) {
  if (m.role === 'user')
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[13.5px] leading-relaxed text-white">{m.text}</div>
      </div>
    )
  if (m.confirm) return <ConfirmCard m={m} />
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand via-violet to-accent text-white">
        <Sparkles size={13} />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="pt-1 text-[12px] font-semibold leading-none text-text">KaTY</p>
        {m.actions && m.actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {m.actions.map((a, i) => (
              <span
                key={i}
                className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]', a.ok ? 'bg-white/[0.07] text-muted' : 'bg-err/15 text-err')}
              >
                {a.ok ? <Check size={11} /> : <X size={11} />} {a.label}
              </span>
            ))}
          </div>
        )}
        {m.text && (
          <div className={cx('text-[13.5px] leading-relaxed', m.error ? 'text-warn' : 'text-text/95')}>
            {m.error && <TriangleAlert size={13} className="mb-0.5 mr-1 inline" />}
            <Rich text={m.text} />
          </div>
        )}
      </div>
    </div>
  )
}

function ConfirmCard({ m }: { m: AssistantMessage }) {
  const c = m.confirm!
  return (
    <div className="ml-9 rounded-2xl border border-warn/30 bg-warn/[0.07] p-3">
      <p className="flex items-center gap-1.5 text-[13px] font-medium">
        <TriangleAlert size={14} className="text-warn" /> {c.label}?
      </p>
      {c.state === 'pending' ? (
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={() => void window.api.assistantConfirm(c.id, true)}
            className="rounded-full bg-err px-3.5 py-1 text-[12.5px] font-medium text-white hover:brightness-110"
          >
            Confirmar
          </button>
          <button
            type="button"
            onClick={() => void window.api.assistantConfirm(c.id, false)}
            className="rounded-full bg-white/[0.08] px-3.5 py-1 text-[12.5px] text-text hover:bg-white/[0.12]"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <p className="mt-1.5 text-[12px] text-muted">
          {c.state === 'done' ? 'Feito.' : c.state === 'failed' ? 'Não deu certo.' : 'Cancelado.'}
        </p>
      )}
    </div>
  )
}

/**
 * Conversa com o assistente. A mesma tela serve para a aba "Assistente" (larga) e para a barra lateral (estreita).
 */
export function AssistantChat({
  state,
  compact,
  slim,
  onClose,
  onExpand,
  onSetup
}: {
  state: AssistantState
  compact?: boolean
  /** Dentro da barra lateral, que já tem título e botão de fechar: só os botões da conversa */
  slim?: boolean
  onClose?: () => void
  onExpand?: () => void
  onSetup: () => void
}) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const { messages, busy, ready } = state

  // Corpo com chaves: no Chromium do Electron 45 o scrollIntoView devolve uma Promise, e o React
  // tentaria usá-la como função de limpeza ("destroy_ is not a function", tela em branco)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, busy])
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(160, el.scrollHeight)}px`
  }, [text])

  const send = (t = text) => {
    if (!t.trim() || busy) return
    setText('')
    void window.api.assistantSend(t)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cx('flex shrink-0 items-center gap-2', slim ? 'px-3 pt-2' : compact ? 'border-b border-white/[0.07] px-4 py-3' : 'pb-4')}>
        {slim ? (
          <span className="flex-1" />
        ) : (
          <>
            <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-brand via-violet to-accent text-white">
              <Sparkles size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className={cx('font-display font-semibold tracking-tight', compact ? 'text-[14px]' : 'text-[19px]')}>KaTY</p>
                {!compact && (
                  <button
                    type="button"
                    title="Configurações da KaTY"
                    aria-label="Configurações da KaTY"
                    onClick={onSetup}
                    className="grid size-7 place-items-center rounded-full text-muted transition hover:bg-white/[0.08] hover:text-text"
                  >
                    <GearStar size={15} />
                  </button>
                )}
              </div>
              {!compact && <p className="text-[13px] text-muted">A IA do Clipador KTY. Pergunte, peça para fazer ou para explicar qualquer coisa.</p>}
            </div>
          </>
        )}
        {messages.length > 0 && (
          <button type="button" title="Nova conversa" onClick={() => void window.api.assistantClear()} className="rounded-full p-1.5 text-muted hover:bg-white/[0.07] hover:text-text">
            <RotateCcw size={14} />
          </button>
        )}
        {onExpand && (
          <button type="button" title="Abrir na aba KaTY" onClick={onExpand} className="rounded-full p-1.5 text-muted hover:bg-white/[0.07] hover:text-text">
            <Maximize2 size={14} />
          </button>
        )}
        {onClose && (
          <button type="button" title="Fechar a barra lateral" onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-white/[0.07] hover:text-text">
            <PanelRightClose size={15} />
          </button>
        )}
      </div>

      <div className={cx('min-h-0 flex-1 overflow-y-auto', compact ? (slim ? 'px-4 pb-4 pt-1' : 'px-4 py-4') : 'pr-1')}>
        {!ready && (
          <div className="mb-4 rounded-2xl border border-warn/30 bg-warn/[0.07] p-3 text-[13px]">
            A KaTY usa a IA do Gemini (grátis).{' '}
            <button type="button" onClick={onSetup} className="font-medium text-accent-2 hover:underline">
              Configure a chave em Configurações &gt; KaTY e IA
            </button>
            .
          </div>
        )}
        {messages.length === 0 ? (
          <div className={cx('flex flex-col items-center text-center', compact ? 'pt-6' : 'pt-16')}>
            <span className="float grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand via-violet to-accent text-white shadow-lg shadow-violet/30">
              <Sparkles size={26} />
            </span>
            <p className={cx('mt-4 font-display font-semibold tracking-tight', compact ? 'text-[17px]' : 'text-[24px]')}>Como posso ajudar?</p>
            <p className="mt-1 max-w-md text-[13px] text-muted">Eu conheço o app e consigo fazer por você: adicionar canais, importar VODs, revisar clipes, mudar ajustes e explicar os momentos.</p>
            <div className={cx('mt-6 grid w-full gap-2', compact ? 'grid-cols-1' : 'max-w-2xl grid-cols-2')}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!ready}
                  onClick={() => send(s)}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-left text-[13px] text-text/90 transition hover:bg-white/[0.08] disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={cx('space-y-4', !compact && 'mx-auto max-w-3xl')}>
            {messages.map((m) => (
              <Bubble key={m.id} m={m} />
            ))}
            {busy && (
              <div className="flex items-center gap-2.5 pl-1 text-[12.5px] text-muted">
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${i * 120}ms` }} />
                  ))}
                </span>
                KaTY está pensando…
                <button type="button" onClick={() => void window.api.assistantStop()} className="ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-white/[0.07] hover:text-text">
                  <Square size={10} /> Parar
                </button>
              </div>
            )}
            <div ref={end} />
          </div>
        )}
      </div>

      <div className={cx('shrink-0', compact ? 'border-t border-white/[0.07] p-3' : 'pt-4')}>
        <div className={cx('flex items-end gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.05] p-2 focus-within:border-accent/60', !compact && 'mx-auto max-w-3xl')}>
          <textarea
            ref={input}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={ready ? 'Pergunte ou peça algo…' : 'Configure a chave do Gemini para conversar'}
            disabled={!ready}
            className="max-h-40 min-h-[28px] flex-1 resize-none bg-transparent px-2 py-1 text-[13.5px] text-text outline-none placeholder:text-muted"
          />
          <button
            type="button"
            aria-label="Enviar"
            disabled={!text.trim() || busy || !ready}
            onClick={() => send()}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-white transition hover:brightness-110 disabled:opacity-40"
          >
            <ArrowUp size={16} />
          </button>
        </div>
        {!compact && <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted">Ações que apagam ou param algo sempre pedem sua confirmação. Usa a cota grátis do Gemini.</p>}
      </div>
    </div>
  )
}
