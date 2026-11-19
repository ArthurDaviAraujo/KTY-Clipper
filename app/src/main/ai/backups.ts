/**
 * Reservas da KaTY: quando o Gemini não responde (sobrecarregado, cota do dia esgotada ou sem chave),
 * a análise vai para o próximo da fila. Groq, OpenRouter, Mistral e a IA local (Ollama) falam o mesmo
 * formato de pedido (o da OpenAI: /chat/completions), então um código só atende os quatro.
 */
import { httpFetch } from '../platforms/http'
import { geminiJson, QuotaError, TransientError } from './gemini'

export type BackupId = 'groq' | 'openrouter' | 'mistral' | 'ollama'

export interface BackupInfo {
  id: BackupId
  name: string
  /** Endereço da API (formato OpenAI) */
  base: string
  /** Precisa de chave (a IA local não) */
  needsKey: boolean
  /** Onde criar a chave grátis */
  keyUrl: string | null
  /** Aviso mostrado em Ajustes */
  note: string
  /** Modelos preferidos, do melhor para o pior (pedaços do nome) */
  prefer: RegExp[]
}

export const BACKUPS: BackupInfo[] = [
  {
    id: 'groq',
    name: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
    note: 'Grátis, sem cartão: ~1.000 pedidos por dia por modelo e muito rápido.',
    prefer: [/gpt-oss-120b/, /qwen/i, /gpt-oss-20b/, /llama-3\.3-70b/, /llama/i]
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    note: 'Grátis nos modelos ":free": 50 pedidos por dia (1.000 se tiver US$ 10 de crédito na conta).',
    // Bons para escrever em português; os de programar (code) e os muito pequenos ficam de fora (lista vista em 2026-11-18)
    prefer: [
      /deepseek.*:free$/,
      /qwen.*:free$/,
      /gpt-oss.*:free$/,
      /gemma-4-31b.*:free$/,
      /nemotron-3-ultra.*:free$/,
      /nemotron-3\.5-super.*:free$/,
      /gemma.*:free$/,
      /llama-3\.3-70b.*:free$/,
      /ernie.*:free$/
    ]
  },
  {
    id: 'mistral',
    name: 'Mistral',
    base: 'https://api.mistral.ai/v1',
    needsKey: true,
    keyUrl: 'https://console.mistral.ai/api-keys',
    note: 'Grátis no plano "Experiment"; nesse plano a Mistral pode usar o que você manda para treinar a IA dela.',
    prefer: [/^mistral-small-latest$/, /^mistral-medium-latest$/, /^open-mistral-nemo/, /small/]
  },
  {
    id: 'ollama',
    name: 'IA local (Ollama)',
    base: 'http://127.0.0.1:11434/v1',
    needsKey: false,
    keyUrl: 'https://ollama.com/download',
    note: 'Roda no seu PC: sem chave, sem limite e sem internet. Usa a placa de vídeo e escreve pior que o Gemini.',
    prefer: [/qwen/i, /llama/i, /gemma/i, /mistral/i]
  }
]

export const backupInfo = (id: BackupId) => BACKUPS.find((b) => b.id === id)!

/** Uma reserva pronta para usar: endereço, chave e modelo escolhido. */
export interface Backup {
  id: BackupId
  name: string
  base: string
  key: string | null
  model: string
}

/** Começo das chaves de cada serviço (a da Mistral não tem um padrão fixo) */
const KEY_PREFIX: Partial<Record<BackupId, string>> = { groq: 'gsk_', openrouter: 'sk-or-' }

const NOT_TEXT =/whisper|tts|guard|embed|image|vision-only|audio|orpheus|playai|distil/i

/** Modelos de texto que a chave (ou a IA local) tem. */
export async function listBackupModels(id: BackupId, key: string | null, signal?: AbortSignal): Promise<string[]> {
  const b = backupInfo(id)
  if (id === 'ollama') {
    const r = await httpFetch('http://127.0.0.1:11434/api/tags', { signal })
    if (!r.ok) throw new Error(`Ollama respondeu ${r.status}.`)
    const j = (await r.json()) as { models?: { name: string }[] }
    return (j.models ?? []).map((m) => m.name).filter((n) => !/embed/i.test(n))
  }
  // Formato da chave: pega cópia errada (a do Gemini, o nome da chave) antes de perguntar ao serviço
  const prefix = KEY_PREFIX[id]
  if (key && prefix && !key.startsWith(prefix))
    throw new Error(`Essa não parece uma chave do ${b.name}: ela começa com "${prefix}". Confira se copiou a chave inteira (não o nome dela).`)
  const r = await httpFetch(`${b.base}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal })
  if (r.status === 401 || r.status === 403) {
    const why = await r
      .json()
      .then((j: { error?: { message?: string } | string; message?: string }) => (typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message ?? '')))
      .catch(() => '')
    throw new Error(
      `O ${b.name} recusou a chave${why ? ` ("${why}")` : ''}. Confira se copiou a chave inteira, sem espaço, e se ela não foi apagada no site (se precisar, crie outra).`
    )
  }
  if (!r.ok) throw new Error(`${b.name} respondeu ${r.status}.`)
  const j = (await r.json()) as { data?: { id: string }[] }
  return (j.data ?? []).map((m) => m.id).filter((m) => !NOT_TEXT.test(m))
}

/** O melhor modelo da lista, pela preferência de cada serviço. */
export function pickBackupModel(id: BackupId, models: string[]): string | null {
  for (const p of backupInfo(id).prefer) {
    const m = models.find((x) => p.test(x))
    if (m) return m
  }
  // OpenRouter: só os grátis
  if (id === 'openrouter') return null
  return models[0] ?? null
}

/** Tira o JSON da resposta (alguns modelos cercam com ```json ou escrevem antes e depois). */
export function extractJsonText(text: string): string {
  const t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) return fence[1].trim()
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  return a >= 0 && b > a ? t.slice(a, b + 1) : t
}

/** Um pedido em JSON para uma reserva (formato OpenAI). 429 = cota; 5xx = passageiro. */
export async function backupJson<T>(b: Backup, system: string, user: string, schema: object, signal?: AbortSignal): Promise<T> {
  const r = await httpFetch(`${b.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(b.key ? { Authorization: `Bearer ${b.key}` } : {}), ...(b.id === 'openrouter' ? { 'X-Title': 'Clipador KTY' } : {}) },
    body: JSON.stringify({
      model: b.model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${system}\n\nResponda SOMENTE com um JSON válido, sem nada antes ou depois, neste formato (JSON Schema):\n${JSON.stringify(schema)}` },
        { role: 'user', content: user }
      ]
    }),
    signal
  })
  const j = (await r.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } | string }
  const msg = typeof j.error === 'string' ? j.error : (j.error?.message ?? '')
  if (r.status === 429) throw new QuotaError(`${b.name}: ${msg || 'limite atingido'}`)
  if (r.status >= 500) throw new TransientError(`${b.name} respondeu ${r.status}: ${msg}`)
  if (!r.ok) throw new Error(`${b.name} respondeu ${r.status}: ${msg}`)
  const text = j.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error(`${b.name} não respondeu.`)
  return JSON.parse(extractJsonText(text)) as T
}

export interface AiTarget {
  gemini: { key: string; model: string } | null
  backups: Backup[]
}

/** Há alguma IA para usar (Gemini ou reserva)? */
export const hasAi = (t: AiTarget) => !!t.gemini || t.backups.length > 0

/**
 * Pede ao Gemini e, se ele falhar (sobrecarga, cota, rede, sem chave), às reservas na ordem.
 * Só desiste quando todos falham; aí devolve o erro do Gemini (ou da última reserva, se não havia Gemini).
 * `onFallback` avisa quem respondeu no lugar (para o log).
 */
export async function aiJson<T>(
  t: AiTarget,
  system: string,
  user: string,
  schema: object,
  signal?: AbortSignal,
  opts: { fast?: boolean; onFallback?: (name: string, why: string) => void } = {}
): Promise<T> {
  let first: unknown = null
  if (t.gemini) {
    try {
      return await geminiJson<T>(t.gemini.key, t.gemini.model, system, user, schema, signal, { fast: opts.fast })
    } catch (e) {
      if (signal?.aborted) throw e
      first = e
    }
  }
  let last: unknown = first
  for (const b of t.backups) {
    try {
      const out = await backupJson<T>(b, system, user, schema, signal)
      opts.onFallback?.(`${b.name} (${b.model})`, first ? (first as Error).message : 'sem chave do Gemini')
      return out
    } catch (e) {
      if (signal?.aborted) throw e
      last ??= e
      if (!first) last = e
    }
  }
  throw first ?? last ?? new Error('Nenhuma IA configurada.')
}
