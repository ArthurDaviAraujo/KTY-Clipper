import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { Db } from './db'
import { kvGet, kvSet } from './db'
import type { Logger } from './logs'
import { geminiTurn, QuotaError, type FunctionDeclaration, type GeminiContent, type GeminiPart } from './ai/gemini'
import type { AssistantMessage, AssistantState } from '../shared/types'

/**
 * Uma função do app que o assistente pode usar.
 * `danger`: apaga ou para algo; só roda depois que o usuário aperta "Confirmar" na conversa.
 */
export interface AssistantTool {
  name: string
  description: string
  parameters?: object
  danger?: boolean
  /** Etiqueta curta mostrada na conversa ("Consultou os clipes", "Adicionou o canal Gaules") */
  label: (args: Record<string, unknown>) => string
  run: (args: Record<string, unknown>) => unknown | Promise<unknown>
}

export interface AssistantDeps {
  db: Db
  log: Logger
  gemini: () => { key: string; model: string } | null
  tools: AssistantTool[]
  /** Instruções do assistente (com a data de hoje e o nome do perfil) */
  system: () => string
}

interface Saved {
  messages: AssistantMessage[]
  contents: GeminiContent[]
}

const MAX_STEPS = 8
const KEEP_MESSAGES = 120
const KEEP_CONTENTS = 60

/** Resposta de função compacta para a IA (listas grandes cortadas). */
function compact(v: unknown, max = 8000): Record<string, unknown> {
  const json = JSON.stringify(v ?? null)
  if (json.length <= max) return { resultado: v ?? null }
  return { resultado: json.slice(0, max), aviso: 'resultado cortado; peça menos itens (limite) se precisar' }
}

/**
 * Assistente do Clipador: conversa com o Gemini, que chama funções do app ("function calling")
 * para consultar e fazer o que o usuário pede. A conversa fica guardada no banco.
 */
export class AssistantService extends EventEmitter {
  private messages: AssistantMessage[] = []
  private contents: GeminiContent[] = []
  private busy = false
  private nextId = 1
  private pending = new Map<string, { tool: AssistantTool; args: Record<string, unknown>; messageId: number }>()
  /** Nota para a IA sobre confirmações feitas entre uma mensagem e outra */
  private note: string[] = []
  private ctrl: AbortController | null = null

  constructor(private d: AssistantDeps) {
    super()
    const saved = kvGet<Saved>(d.db, 'assistant')
    if (saved) {
      // Confirmações de uma sessão anterior não valem mais (o app pode ter mudado)
      this.messages = (saved.messages ?? []).map((m) => (m.confirm?.state === 'pending' ? { ...m, confirm: { ...m.confirm, state: 'canceled' as const } } : m))
      this.contents = saved.contents ?? []
      this.nextId = Math.max(0, ...this.messages.map((m) => m.id)) + 1
    }
  }

  state(): AssistantState {
    return { messages: this.messages, busy: this.busy, ready: !!this.d.gemini() }
  }

  private changed(): void {
    this.emit('state', this.state())
  }

  private save(): void {
    this.messages = this.messages.slice(-KEEP_MESSAGES)
    // Corta o histórico da IA só no começo de uma pergunta do usuário (nunca entre um pedido de função e a resposta)
    if (this.contents.length > KEEP_CONTENTS) {
      let i = this.contents.length - KEEP_CONTENTS
      while (i < this.contents.length && !(this.contents[i].role === 'user' && this.contents[i].parts.some((p) => p.text != null))) i++
      this.contents = this.contents.slice(i)
    }
    kvSet(this.d.db, 'assistant', { messages: this.messages, contents: this.contents } satisfies Saved)
  }

  private push(m: Omit<AssistantMessage, 'id' | 'at'>): AssistantMessage {
    const msg = { ...m, id: this.nextId++, at: Date.now() }
    this.messages.push(msg)
    return msg
  }

  clear(): void {
    this.messages = []
    this.contents = []
    this.pending.clear()
    this.note = []
    this.save()
    this.changed()
  }

  stop(): void {
    this.ctrl?.abort(new Error('parado'))
  }

  private declarations(): FunctionDeclaration[] {
    return this.d.tools.map((t) => ({
      name: t.name,
      description: t.danger ? `${t.description} (Apaga ou para algo: o app pede a confirmação do usuário antes de executar.)` : t.description,
      ...(t.parameters ? { parameters: t.parameters } : {})
    }))
  }

  async send(text: string): Promise<void> {
    const q = text.trim()
    if (!q || this.busy) return
    this.push({ role: 'user', text: q })
    const g = this.d.gemini()
    if (!g) {
      this.push({ role: 'assistant', text: 'Para conversar comigo, configure a chave grátis do Gemini em Ajustes > IA e fala. Leva um minuto.', error: true })
      this.save()
      return this.changed()
    }
    this.busy = true
    this.changed()
    const prefix = this.note.length ? `[O que aconteceu desde a última mensagem: ${this.note.join(' ')}]\n` : ''
    this.note = []
    this.contents.push({ role: 'user', parts: [{ text: prefix + q }] })
    const actions: { label: string; ok: boolean }[] = []
    /** Cartões de confirmação desta resposta: vão para depois do texto da IA */
    const cards: AssistantMessage[] = []
    this.ctrl = new AbortController()
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const t0 = Date.now()
        const parts = await geminiTurn(g.key, g.model, this.d.system(), this.contents, this.declarations(), this.ctrl.signal)
        const took = (Date.now() - t0) / 1000
        // O normal é 1 a 5 s; picos do servidor do Gemini (visto 54 s em 2026-11-17) ficam registrados
        if (took > 20) this.d.log.info('KaTY', `O Gemini demorou ${Math.round(took)} s para responder.`)
        this.contents.push({ role: 'model', parts })
        const calls = parts.filter((p) => p.functionCall)
        if (!calls.length) {
          const answer = parts
            .filter((p) => p.text && !p.thought)
            .map((p) => p.text)
            .join('')
            .trim()
          if (answer || actions.length || !cards.length) this.push({ role: 'assistant', text: answer || (cards.length ? '' : 'Pronto.'), actions: actions.length ? actions : undefined })
          // O pedido de confirmação fica por último, logo acima da caixa de texto
          for (const c of cards) {
            this.messages.splice(this.messages.indexOf(c), 1)
            this.messages.push(c)
          }
          return
        }
        const responses: GeminiPart[] = []
        for (const c of calls) {
          const { name, args = {} } = c.functionCall!
          const tool = this.d.tools.find((t) => t.name === name)
          if (!tool) {
            responses.push({ functionResponse: { name, response: { erro: `Função desconhecida: ${name}` } } })
            continue
          }
          let label = name
          try {
            label = tool.label(args)
          } catch {
            // etiqueta é só para mostrar
          }
          if (tool.danger) {
            const id = randomUUID()
            const card = this.push({ role: 'assistant', text: '', confirm: { id, label, state: 'pending' } })
            cards.push(card)
            this.pending.set(id, { tool, args, messageId: card.id })
            responses.push({ functionResponse: { name, response: { situacao: 'aguardando_confirmacao', detalhe: `O app mostrou "${label}" com os botões Confirmar e Cancelar.` } } })
            this.changed()
            continue
          }
          try {
            const result = await tool.run(args)
            actions.push({ label, ok: true })
            responses.push({ functionResponse: { name, response: compact(result) } })
          } catch (e) {
            actions.push({ label, ok: false })
            responses.push({ functionResponse: { name, response: { erro: (e as Error).message } } })
          }
          this.changed()
        }
        this.contents.push({ role: 'user', parts: responses })
      }
      this.push({ role: 'assistant', text: 'Parei aqui para não rodar ações demais de uma vez. Me diga se quer que eu continue.', actions })
    } catch (e) {
      const aborted = this.ctrl?.signal.aborted
      // Tira do histórico a pergunta que ficou sem resposta (a IA exige pares completos)
      while (this.contents.length && !(this.contents[this.contents.length - 1].role === 'user' && this.contents[this.contents.length - 1].parts.some((p) => p.text != null)))
        this.contents.pop()
      this.contents.pop()
      // O que já foi feito antes do erro não pode sumir da memória da IA
      if (actions.length) this.note.push(`Antes de a resposta ser interrompida, foi feito: ${actions.map((a) => `${a.label}${a.ok ? '' : ' (falhou)'}`).join('; ')}.`)
      const msg = aborted
        ? 'Parei.'
        : e instanceof QuotaError
          ? 'A cota grátis do Gemini acabou por agora (ela é dividida com a revisão dos momentos). Tente de novo em alguns minutos.'
          : `Não consegui responder: ${(e as Error).message}`
      if (!aborted) this.d.log.warn('KaTY', msg)
      this.push({ role: 'assistant', text: msg, error: !aborted, actions: actions.length ? actions : undefined })
    } finally {
      this.busy = false
      this.ctrl = null
      this.save()
      this.changed()
    }
  }

  /** O usuário apertou Confirmar ou Cancelar numa ação que apaga ou para algo. */
  async confirm(id: string, ok: boolean): Promise<void> {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    const card = this.messages.find((m) => m.id === p.messageId)
    const label = card?.confirm?.label ?? p.tool.name
    if (!ok) {
      if (card?.confirm) card.confirm.state = 'canceled'
      this.note.push(`O usuário cancelou "${label}".`)
    } else {
      try {
        const result = await p.tool.run(p.args)
        if (card?.confirm) card.confirm.state = 'done'
        this.note.push(`O usuário confirmou "${label}" e foi feito (${JSON.stringify(result ?? 'ok').slice(0, 300)}).`)
        this.d.log.info('KaTY', `Feito a pedido da KaTY: ${label}.`)
      } catch (e) {
        if (card?.confirm) card.confirm.state = 'failed'
        this.push({ role: 'assistant', text: `Não deu para ${label.toLowerCase()}: ${(e as Error).message}`, error: true })
        this.note.push(`O usuário confirmou "${label}", mas falhou: ${(e as Error).message}.`)
      }
    }
    this.save()
    this.changed()
  }
}
