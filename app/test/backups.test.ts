import { afterEach, describe, expect, it, vi } from 'vitest'
import { setHttpFetch } from '../src/main/platforms/http'
import { aiJson, extractJsonText, pickBackupModel, type Backup } from '../src/main/ai/backups'

afterEach(() => {
  setHttpFetch((...a) => fetch(...a))
  vi.useRealTimers()
})

const groq: Backup = { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', key: 'g', model: 'openai/gpt-oss-120b' }
const local: Backup = { id: 'ollama', name: 'IA local (Ollama)', base: 'http://127.0.0.1:11434/v1', key: null, model: 'qwen3' }
const ok = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 })

describe('reservas da KaTY', () => {
  it('escolhe o melhor modelo de cada serviço', () => {
    expect(pickBackupModel('groq', ['whisper-large-v3', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b'])).toBe('openai/gpt-oss-120b')
    expect(pickBackupModel('openrouter', ['openai/gpt-5', 'qwen/qwen3-235b:free', 'deepseek/deepseek-chat-v3:free'])).toBe('deepseek/deepseek-chat-v3:free')
    // OpenRouter sem modelo grátis: nenhum (não usa os pagos)
    expect(pickBackupModel('openrouter', ['openai/gpt-5'])).toBeNull()
    expect(pickBackupModel('openrouter', ['particle-ai/particle-1:free', 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3-ultra-550b-a55b:free'])).toBe('google/gemma-4-31b-it:free')
    // Só modelos de programar ou pequenos demais: nenhum
    expect(pickBackupModel('openrouter', ['cohere/north-mini-code:free', 'liquid/lfm-3-1.7b:free'])).toBeNull()
    expect(pickBackupModel('ollama', ['llama3.2:latest', 'qwen3:8b'])).toBe('qwen3:8b')
  })

  it('tira o JSON mesmo com texto ou ``` em volta', () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJsonText('Aqui está: {"a":{"b":2}} pronto')).toBe('{"a":{"b":2}}')
  })

  it('Gemini sobrecarregado em todos os modelos: o Groq responde', async () => {
    vi.useFakeTimers()
    const chamadas: string[] = []
    setHttpFetch((async (url: string | URL | Request) => {
      const u = String(url)
      chamadas.push(u.includes('groq') ? 'groq' : u.includes('11434') ? 'local' : 'gemini')
      if (u.includes('generativelanguage')) return new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503 })
      return ok('{"ok":"groq"}')
    }) as typeof fetch)
    let reserva = ''
    const p = aiJson<{ ok: string }>({ gemini: { key: 'k', model: 'gemini-3.5-flash-lite' }, backups: [groq, local] }, 's', 'u', {}, undefined, { onFallback: (n) => (reserva = n) })
    await vi.runAllTimersAsync()
    expect(await p).toEqual({ ok: 'groq' })
    expect(reserva).toContain('Groq')
    expect(chamadas.at(-1)).toBe('groq')
    expect(chamadas).not.toContain('local')
  })

  it('sem chave do Gemini e Groq com limite: a IA local responde', async () => {
    setHttpFetch((async (url: string | URL | Request) => {
      if (String(url).includes('groq')) return new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429 })
      return ok('{"ok":"local"}')
    }) as typeof fetch)
    expect(await aiJson<{ ok: string }>({ gemini: null, backups: [groq, local] }, 's', 'u', {})).toEqual({ ok: 'local' })
  })

  it('todas falham: devolve o erro (e não inventa resposta)', async () => {
    setHttpFetch((async () => new Response('{}', { status: 400 })) as typeof fetch)
    await expect(aiJson({ gemini: null, backups: [groq] }, 's', 'u', {})).rejects.toThrow(/Groq respondeu 400/)
  })
})

describe('chave colada errada', () => {
  it('avisa quando não parece chave do serviço, antes de perguntar ao site', async () => {
    const { listBackupModels } = await import('../src/main/ai/backups')
    await expect(listBackupModels('groq', 'AIzaChaveDoGemini')).rejects.toThrow(/começa com "gsk_"/)
  })
  it('mostra o motivo que o serviço deu', async () => {
    const { listBackupModels } = await import('../src/main/ai/backups')
    setHttpFetch((async () => new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 })) as typeof fetch)
    await expect(listBackupModels('groq', 'gsk_errada')).rejects.toThrow(/recusou a chave \("Invalid API Key"\)/)
  })
})
