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
export async function geminiJson<T>(key: string, model: string, system: string, user: string, schema: object, signal?: AbortSignal): Promise<T> {
  // Erro passageiro do Google (ex.: 503 "high demand", visto em 2026-11-16): tenta de novo com espera crescente
  const waits = [8000, 20000]
  for (let attempt = 0; ; attempt++) {
    try {
      return await geminiOnce<T>(key, model, system, user, schema, signal)
    } catch (e) {
      // TypeError = falha de rede do fetch (conexão caiu): também vale tentar de novo
      const transient = e instanceof TransientError || e instanceof TypeError
      if (!transient || attempt >= waits.length || signal?.aborted) throw e
      await new Promise((r) => setTimeout(r, waits[attempt]))
    }
  }
}

export class TransientError extends Error {}

async function geminiOnce<T>(key: string, model: string, system: string, user: string, schema: object, signal?: AbortSignal): Promise<T> {
  const r = await httpFetch(`${API}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.4 }
    }),
    signal
  })
  const j = (await r.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    error?: { message: string }
  }
  if (r.status === 429) throw new QuotaError(j.error?.message ?? 'Cota do Gemini esgotada.')
  if (r.status >= 500) throw new TransientError(`Gemini respondeu ${r.status}: ${j.error?.message ?? ''}`)
  if (!r.ok) throw new Error(`Gemini respondeu ${r.status}: ${j.error?.message ?? ''}`)
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text) throw new Error(`Gemini não respondeu (${j.candidates?.[0]?.finishReason ?? 'sem motivo'}).`)
  return JSON.parse(text) as T
}
