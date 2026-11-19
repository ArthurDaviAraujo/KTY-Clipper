import { afterEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/main/db'
import { setHttpFetch } from '../src/main/platforms/http'
import { smartChannelSearch } from '../src/main/channelSearch'
import { parseSubscribers } from '../src/main/platforms/youtube'
import type { Logger } from '../src/main/logs'
import type { ChannelMatch } from '../src/shared/types'

const log = { info() {}, warn() {}, error() {}, log() {} } as unknown as Logger
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } })

/** Plataformas e IA de mentira: a IA entende "o streamer de cs da tribo" como Gaules. */
function fakeWeb(aiGuess: string | null) {
  setHttpFetch((async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const body = String(init?.body ?? '')
    if (u.includes('generativelanguage')) {
      if (!aiGuess) return new Response('{}', { status: 500 })
      const text = JSON.stringify({ understood: 'Gaules, streamer de Counter-Strike', guesses: [{ name: aiGuess, platform: 'qualquer', why: 'É o streamer de CS da tribo' }] })
      return json({ candidates: [{ content: { parts: [{ text }] } }] })
    }
    if (u.includes('gql.twitch.tv')) {
      const gaules = body.toLowerCase().includes('gaules')
      return json({
        data: {
          searchFor: {
            channels: {
              items: gaules
                ? [
                    { login: 'gaules', displayName: 'Gaules', description: 'CS', profileImageURL: null, followers: { totalCount: 4_000_000 }, stream: { id: '1' } },
                    { login: 'gaulesfan123', displayName: 'gaulesfan123', description: '', profileImageURL: null, followers: { totalCount: 3 }, stream: null }
                  ]
                : [{ login: 'otrocanal', displayName: 'OutroCanal', description: '', profileImageURL: null, followers: { totalCount: 10 }, stream: null }]
            }
          }
        }
      })
    }
    if (u.includes('kick.com/api/search')) return json({ channels: [] })
    if (u.includes('youtube.com/results')) return new Response('<html></html>', { status: 200 })
    return new Response('', { status: 404 })
  }) as typeof fetch)
}

afterEach(() => setHttpFetch((...a) => fetch(...a)))

describe('busca de canal com IA', () => {
  it('descrição vira o canal certo em primeiro, com o porquê', async () => {
    fakeWeb('Gaules')
    const db = openDb(':memory:')
    const res = await smartChannelSearch({ db, log, gemini: () => ({ key: 'k', model: 'm' }), lookup: async () => [] as ChannelMatch[] }, 'o streamer de cs da tribo')
    expect(res.understood).toContain('Gaules')
    expect(res.matches[0]).toMatchObject({ platform: 'twitch', login: 'gaules', why: 'É o streamer de CS da tribo', live: true })
    // Canal copiado quase sem seguidores fica atrás
    const idx = res.matches.findIndex((m) => m.login === 'gaulesfan123')
    expect(idx === -1 || idx > 0).toBe(true)
    expect(res.aiNote).toBeNull()
  })

  it('sem chave do Gemini: só a busca das plataformas, com aviso', async () => {
    fakeWeb(null)
    const db = openDb(':memory:')
    const res = await smartChannelSearch({ db, log, gemini: () => null, lookup: async () => [] }, 'outrocanal')
    expect(res.understood).toBeNull()
    expect(res.aiNote).toMatch(/chave do Gemini/)
    expect(res.matches.map((m) => m.login)).toEqual(['otrocanal'])
  })

  it('marca o que já está na lista', async () => {
    fakeWeb('Gaules')
    const db = openDb(':memory:')
    db.prepare(`INSERT INTO channels(platform, login, created_at) VALUES ('twitch', 'gaules', 0)`).run()
    const res = await smartChannelSearch({ db, log, gemini: () => ({ key: 'k', model: 'm' }), lookup: async () => [] }, 'gaulles')
    expect(res.matches.find((m) => m.login === 'gaules')?.already).toBe(true)
  })

  it('inscritos do YouTube', () => {
    expect(parseSubscribers('1,2 mi de inscritos')).toBe(1_200_000)
    expect(parseSubscribers('415 mil inscritos')).toBe(415_000)
    expect(parseSubscribers('@Gaules')).toBeNull()
  })
})
