import { afterEach, describe, expect, it, vi } from 'vitest'
import { setHttpFetch } from '../src/main/platforms/http'
import { geminiJson } from '../src/main/ai/gemini'

afterEach(() => {
  setHttpFetch((...a) => fetch(...a))
  vi.useRealTimers()
})

describe('Gemini sobrecarregado', () => {
  it('modelo padrão com 503 seguido: troca para outro modelo e responde', async () => {
    vi.useFakeTimers()
    const pedidos: string[] = []
    setHttpFetch((async (url: string | URL | Request) => {
      const u = String(url)
      pedidos.push(u.match(/models\/([^:]+)/)?.[1] ?? '')
      if (u.includes('flash-lite:')) return new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503 })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 })
    }) as typeof fetch)
    const p = geminiJson<{ ok: boolean }>('k', 'gemini-3.5-flash-lite', 's', 'u', {})
    await vi.runAllTimersAsync()
    expect(await p).toEqual({ ok: true })
    expect(pedidos.filter((m) => m === 'gemini-3.5-flash-lite')).toHaveLength(3)
    expect(pedidos.at(-1)).toBe('gemini-3.5-flash')
  })
})
