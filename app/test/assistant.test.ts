import { afterEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/main/db'
import { Logger } from '../src/main/logs'
import { setHttpFetch } from '../src/main/platforms/http'
import { AssistantService, type AssistantTool } from '../src/main/assistant'

/** Gemini de mentira: devolve as respostas da fila, uma por pedido, e guarda o que recebeu. */
function fakeGemini(replies: (object | { status: number; body: object })[]) {
  const sent: any[] = []
  setHttpFetch((async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)))
    const r = replies.shift()!
    const status = 'status' in r ? (r as any).status : 200
    const body = 'status' in r ? (r as any).body : { candidates: [{ content: { parts: r } }] }
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch)
  return sent
}

const setup = (tools: AssistantTool[]) => {
  const db = openDb(':memory:')
  return new AssistantService({ db, log: new Logger(db), gemini: () => ({ key: 'k', model: 'm' }), tools, system: () => 'sistema' })
}

afterEach(() => setHttpFetch((...a) => fetch(...a)))

describe('assistant', () => {
  it('calls an app function and answers with its result', async () => {
    let added = ''
    const tools: AssistantTool[] = [
      {
        name: 'adicionar_canal',
        description: 'x',
        label: (a) => `Adicionou ${a.canal}`,
        run: (a) => {
          added = String(a.canal)
          return { ok: true }
        }
      }
    ]
    const sent = fakeGemini([
      [{ functionCall: { name: 'adicionar_canal', args: { canal: 'gaules' } }, thoughtSignature: 'sig' }],
      [{ text: 'Pronto, adicionei o **gaules**.' }]
    ])
    const a = setup(tools)
    await a.send('adiciona o gaules')
    expect(added).toBe('gaules')
    const last = a.state().messages.at(-1)!
    expect(last.text).toContain('adicionei')
    expect(last.actions).toEqual([{ label: 'Adicionou gaules', ok: true }])
    // A assinatura do pedido de função volta igual e a resposta da função vai junto
    const second = sent[1].contents
    expect(second[1].parts[0].thoughtSignature).toBe('sig')
    expect(second[2].parts[0].functionResponse.name).toBe('adicionar_canal')
    expect(sent[0].tools[0].functionDeclarations[0].name).toBe('adicionar_canal')
  })

  it('dangerous actions wait for the user to confirm', async () => {
    let deleted = false
    const tools: AssistantTool[] = [{ name: 'apagar_clipe', description: 'x', danger: true, label: () => 'Apagar o clipe X', run: () => (deleted = true) }]
    fakeGemini([[{ functionCall: { name: 'apagar_clipe', args: { clipe_id: 3 } } }], [{ text: 'Confirme no botão.' }]])
    const a = setup(tools)
    await a.send('apaga o clipe 3')
    expect(deleted).toBe(false)
    const card = a.state().messages.find((m) => m.confirm)!
    expect(card.confirm!.state).toBe('pending')
    await a.confirm(card.confirm!.id, true)
    expect(deleted).toBe(true)
    expect(a.state().messages.find((m) => m.confirm)!.confirm!.state).toBe('done')
  })

  it('cancel does not run the action', async () => {
    let deleted = false
    const tools: AssistantTool[] = [{ name: 'apagar_clipe', description: 'x', danger: true, label: () => 'Apagar', run: () => (deleted = true) }]
    fakeGemini([[{ functionCall: { name: 'apagar_clipe', args: {} } }], [{ text: 'ok' }]])
    const a = setup(tools)
    await a.send('apaga')
    const card = a.state().messages.find((m) => m.confirm)!
    await a.confirm(card.confirm!.id, false)
    expect(deleted).toBe(false)
    expect(a.state().messages.find((m) => m.confirm)!.confirm!.state).toBe('canceled')
  })

  it('quota error becomes a friendly message and the question leaves the history', async () => {
    const sent = fakeGemini([{ status: 429, body: { error: { message: 'quota' } } }, [{ text: 'oi de novo' }]])
    const a = setup([])
    await a.send('oi')
    expect(a.state().messages.at(-1)!.text).toMatch(/cota grátis/)
    expect(a.state().busy).toBe(false)
    await a.send('oi 2')
    // O histórico mandado na segunda pergunta não tem a primeira (que ficou sem resposta)
    expect(sent[1].contents).toHaveLength(1)
    expect(sent[1].contents[0].parts[0].text).toBe('oi 2')
  })

  it('without a key it explains how to set it up', async () => {
    const db = openDb(':memory:')
    const a = new AssistantService({ db, log: new Logger(db), gemini: () => null, tools: [], system: () => '' })
    await a.send('oi')
    expect(a.state().ready).toBe(false)
    expect(a.state().messages.at(-1)!.text).toMatch(/chave grátis do Gemini/)
  })

  it('keeps the conversation in the database', async () => {
    fakeGemini([[{ text: 'olá!' }]])
    const db = openDb(':memory:')
    const a = new AssistantService({ db, log: new Logger(db), gemini: () => ({ key: 'k', model: 'm' }), tools: [], system: () => '' })
    await a.send('oi')
    const b = new AssistantService({ db, log: new Logger(db), gemini: () => ({ key: 'k', model: 'm' }), tools: [], system: () => '' })
    expect(b.state().messages.map((m) => m.text)).toEqual(['oi', 'olá!'])
  })
})
