import { httpFetch } from '../platforms/http'

const API = 'https://generativelanguage.googleapis.com/v1beta'

/** Preferência: os "lite" são baratos e rápidos, e é o que o nível grátis dá com mais cota. */
const PREFERRED = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-lite', 'gemini-2.5-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash']

export class QuotaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuotaError'
  }
}

/** Modelos que a chave pode usar para gerar texto. Também serve para validar a chave. */
export async function listGeminiModels(key: string): Promise<string[]> {
  const names: string[] = []
  let page = ''
  for (let i = 0; i < 5; i++) {
    const r = await httpFetch(`${API}/models?pageSize=200${page ? `&pageToken=${page}` : ''}`, { headers: { 'x-goog-api-key': key } })
    const j = (await r.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string; error?: { message: string } }
    if (!r.ok) throw new Error(r.status === 400 || r.status === 403 ? 'Chave do Gemini inválida.' : `Gemini respondeu ${r.status}: ${j.error?.message ?? ''}`)
    for (const m of j.models ?? []) if (m.supportedGenerationMethods?.includes('generateContent')) names.push(m.name.replace(/^models\//, ''))
    if (!j.nextPageToken) break
    page = j.nextPageToken
  }
  return names
}

/** Escolhe o modelo: o preferido que existir; senão o primeiro "flash" disponível. */
export function pickGeminiModel(available: string[]): string | null {
  for (const p of PREFERRED) if (available.includes(p)) return p
  return available.find((m) => /flash/.test(m) && !/image|tts|audio|live|embedding/.test(m)) ?? null
}

/**
 * Pede uma resposta em JSON com formato fixo (responseSchema): a resposta sempre vem no formato pedido.
 * 429 vira QuotaError (cota grátis do dia acabou ou muitos pedidos por minuto).
 */
export async function geminiJson<T>(key: string, model: string, system: string, user: string, schema: object, signal?: AbortSignal, opts: { fast?: boolean } = {}): Promise<T> {
  try {
    return await geminiJsonModel<T>(key, model, system, user, schema, signal, opts)
  } catch (e) {
    // O modelo escolhido ficou sobrecarregado (503 "high demand" seguido, visto em 2026-11-18 com o flash-lite):
    // tenta os outros modelos de texto, um de cada vez; modelo que a chave não tem só é pulado
    if (!(e instanceof TransientError) || signal?.aborted) throw e
    for (const alt of FALLBACK_MODELS.filter((m) => m !== model)) {
      try {
        return await geminiOnce<T>(key, alt, system, user, schema, signal, !!opts.fast && !noThinkingConfig.has(alt))
      } catch (e2) {
        if (e2 instanceof QuotaError || signal?.aborted) throw e2
      }
    }
    throw e
  }
}

/** Outros modelos de texto do Gemini, do mais parecido com o padrão ao mais forte. */
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']

async function geminiJsonModel<T>(key: string, model: string, system: string, user: string, schema: object, signal?: AbortSignal, opts: { fast?: boolean } = {}): Promise<T> {
  // Erro passageiro do Google (ex.: 503 "high demand", visto em 2026-11-16): tenta de novo com espera crescente
  const waits = [8000, 20000]
  for (let attempt = 0; ; attempt++) {
    try {
      return await geminiOnce<T>(key, model, system, user, schema, signal, !!opts.fast && !noThinkingConfig.has(model))
    } catch (e) {
      // Modelo que não aceita o ajuste de pensamento: lembra e pede de novo sem ele
      if (e instanceof ThinkingConfigError) {
        noThinkingConfig.add(model)
        attempt--
        continue
      }
      // TypeError = falha de rede do fetch (conexão caiu): também vale tentar de novo
      const transient = e instanceof TransientError || e instanceof TypeError
      if (!transient || attempt >= waits.length || signal?.aborted) throw e
      await new Promise((r) => setTimeout(r, waits[attempt]))
    }
  }
}

export class TransientError extends Error {}
class ThinkingConfigError extends Error {}

/** Pedaço de uma mensagem do Gemini: texto, pedido de função (com a assinatura de pensamento, que precisa voltar igual) ou resposta de função. */
export interface GeminiPart {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
}
export interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}
export interface FunctionDeclaration {
  name: string
  description: string
  parameters?: object
}

/** Modelos que recusaram o ajuste de pensamento (não manda de novo). */
const noThinkingConfig = new Set<string>()

/**
 * Uma volta de conversa com funções ("function calling"): devolve as partes da resposta do modelo,
 * que podem ser texto ou pedidos para chamar funções do app. Erros passageiros tentam de novo.
 */
export async function geminiTurn(
  key: string,
  model: string,
  system: string,
  contents: GeminiContent[],
  functions: FunctionDeclaration[],
  signal?: AbortSignal
): Promise<GeminiPart[]> {
  const waits = [5000, 15000]
  for (let attempt = 0; ; attempt++) {
    try {
      // Conversa precisa de resposta rápida: pensamento "baixo" (os Gemini 3 pensam bastante por padrão).
      // Modelo que não aceita a opção responde 400; aí ela sai e o pedido vai de novo.
      const thinking = !noThinkingConfig.has(model)
      const r = await httpFetch(`${API}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          tools: [{ functionDeclarations: functions }],
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          generationConfig: { temperature: 0.3, ...(thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) }
        }),
        signal
      })
      const j = (await r.json()) as { candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]; error?: { message: string } }
      if (r.status === 400 && thinking && /think/i.test(j.error?.message ?? '')) {
        noThinkingConfig.add(model)
        attempt--
        continue
      }
      if (r.status === 429) throw new QuotaError(j.error?.message ?? 'Cota do Gemini esgotada.')
      if (r.status >= 500) throw new TransientError(`Gemini respondeu ${r.status}: ${j.error?.message ?? ''}`)
      if (!r.ok) throw new Error(`Gemini respondeu ${r.status}: ${j.error?.message ?? ''}`)
      const parts = j.candidates?.[0]?.content?.parts ?? []
      if (!parts.length) throw new Error(`Gemini não respondeu (${j.candidates?.[0]?.finishReason ?? 'sem motivo'}).`)
      return parts
    } catch (e) {
      const transient = e instanceof TransientError || e instanceof TypeError
      if (!transient || attempt >= waits.length || signal?.aborted) throw e
      await new Promise((res) => setTimeout(res, waits[attempt]))
    }
  }
}

/** Mídia mandada junto do pedido: JPEG em base64 (string) ou outro tipo, como vídeo MP4 */
export type GeminiMedia = string | { mimeType: string; data: string }

/** Modelos/contas que recusaram a resolução baixa de mídia (não manda de novo) */
const noMediaRes = new Set<string>()

/**
 * Pedido em JSON com imagens ou vídeo (base64): o Gemini enxerga os quadros (e ouve o som do vídeo).
 * Usado para achar a facecam e para a KaTY ver o lance. `lowRes` pede a resolução baixa de mídia (bem menos cota).
 * Erro passageiro tenta de novo e depois outros modelos, como no `geminiJson`.
 */
export async function geminiVisionJson<T>(
  key: string,
  model: string,
  system: string,
  text: string,
  media: GeminiMedia[],
  schema: object,
  signal?: AbortSignal,
  opts: { lowRes?: boolean; temperature?: number } = {}
): Promise<T> {
  const parts = media.map((m) => ({ inlineData: typeof m === 'string' ? { mimeType: 'image/jpeg', data: m } : m }))
  const once = async (m: string): Promise<T> => {
    const low = !!opts.lowRes && !noMediaRes.has(m)
    const r = await httpFetch(`${API}/models/${m}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [...parts, { text }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: opts.temperature ?? 0.1,
          ...(low ? { mediaResolution: 'MEDIA_RESOLUTION_LOW' } : {})
        }
      }),
      signal
    })
    const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; error?: { message: string } }
    // Modelo que não aceita a resolução baixa: lembra e pede de novo sem ela
    if (r.status === 400 && low && /media.?resolution/i.test(j.error?.message ?? '')) {
      noMediaRes.add(m)
      return once(m)
    }
    if (r.status === 429) throw new QuotaError(j.error?.message ?? 'Cota do Gemini esgotada.')
    if (r.status >= 500) throw new TransientError(`Gemini respondeu ${r.status}: ${j.error?.message ?? ''}`)
    if (!r.ok) throw new Error(`Gemini respondeu ${r.status}: ${j.error?.message ?? ''}`)
    const out = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    if (!out) throw new Error(`Gemini não respondeu (${j.candidates?.[0]?.finishReason ?? 'sem motivo'}).`)
    return JSON.parse(out) as T
  }
  for (const [i, m] of [model, ...FALLBACK_MODELS.filter((x) => x !== model)].entries()) {
    try {
      return await once(m)
    } catch (e) {
      const transient = e instanceof TransientError || e instanceof TypeError
      if (!transient || signal?.aborted || i >= 2) throw e
      if (i === 0) await new Promise((res) => setTimeout(res, 5000))
    }
  }
  throw new Error('Gemini não respondeu.')
}

async function geminiOnce<T>(key: string, model: string, system: string, user: string, schema: object, signal?: AbortSignal, fast = false): Promise<T> {
  const r = await httpFetch(`${API}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      // fast: pensamento "baixo" para respostas que a pessoa está esperando na tela
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.4, ...(fast ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) }
    }),
    signal
  })
  const j = (await r.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    error?: { message: string }
  }
  if (r.status === 400 && fast && /think/i.test(j.error?.message ?? '')) throw new ThinkingConfigError(j.error?.message ?? '')
  if (r.status === 429) throw new QuotaError(j.error?.message ?? 'Cota do Gemini esgotada.')
  if (r.status >= 500) throw new TransientError(`Gemini respondeu ${r.status}: ${j.error?.message ?? ''}`)
  if (!r.ok) throw new Error(`Gemini respondeu ${r.status}: ${j.error?.message ?? ''}`)
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text) throw new Error(`Gemini não respondeu (${j.candidates?.[0]?.finishReason ?? 'sem motivo'}).`)
  return JSON.parse(text) as T
}
