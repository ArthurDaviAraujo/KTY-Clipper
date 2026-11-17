import { describe, expect, it } from 'vitest'
import { modalityOf, normalizeCategory } from '../src/shared/modality'
import { buildReviewPrompt, categoryLine, REVIEW_SYSTEM } from '../src/main/ai/review'
import { openDb } from '../src/main/db'
import { gameAt, gamesOf, noteGame } from '../src/main/games'

describe('modality of a category', () => {
  it('knows the non-game categories of Twitch and Kick', () => {
    expect(modalityOf('Just Chatting')).toBe('talk')
    expect(modalityOf('Talk Shows & Podcasts')).toBe('talk')
    expect(modalityOf('IRL')).toBe('irl')
    expect(modalityOf('Travel & Outdoors')).toBe('irl')
    expect(modalityOf('Pools, Hot Tubs, and Beaches')).toBe('irl')
    expect(modalityOf('Sports')).toBe('sports')
    expect(modalityOf('Music')).toBe('creative')
    expect(modalityOf('Software and Game Development')).toBe('creative')
  })
  it('treats any other category as a game, and no category as unknown', () => {
    expect(modalityOf('Grand Theft Auto VI')).toBe('game')
    expect(modalityOf('Counter-Strike')).toBe('game')
    expect(modalityOf('Slots & Casino')).toBe('game')
    expect(modalityOf(null)).toBeNull()
    expect(modalityOf('  ')).toBeNull()
  })
  it('normalizes accents, case and symbols', () => {
    expect(normalizeCategory('  Pokémon  Legends: Z-A ')).toBe('pokemon legends z a')
    expect(normalizeCategory('Food & Drink')).toBe('food and drink')
  })
})

describe('AI review prompt', () => {
  it('is not tied to one game and keeps good conversation', () => {
    expect(REVIEW_SYSTEM).not.toMatch(/GTA/)
    expect(REVIEW_SYSTEM).toMatch(/conversa: a fala É o conteúdo/)
  })
  it('sends the category of each moment with its modality', () => {
    const p = buildReviewPrompt({ channel: 'alanzoka', liveTitle: 'semana de gta 6' }, [
      { id: 1, durationS: 30, game: 'Just Chatting', reasons: ['chat 4x'], speech: '[0s] oi', chat: [] },
      { id: 2, durationS: 25, game: 'Parasite Eve', reasons: [], speech: '', chat: ['kkkk'] },
      { id: 3, durationS: 20, game: null, reasons: [], speech: '', chat: [] }
    ])
    expect(p).toContain('Categoria: Just Chatting (conversa)')
    expect(p).toContain('Categoria: Parasite Eve (jogo)')
    expect(p).toContain('Categoria: desconhecida')
    expect(p).not.toContain('Jogo:')
    expect(categoryLine('IRL')).toBe('IRL (IRL)')
  })
})

describe('category along the live', () => {
  const setup = () => {
    const db = openDb(':memory:')
    db.prepare(`INSERT INTO channels(platform, login, created_at) VALUES ('twitch', 'x', 0)`).run()
    db.prepare(`INSERT INTO lives(channel_id, started_at, platform_stream_id, game) VALUES (1, 1000, 's1', 'Just Chatting')`).run()
    return db
  }
  it('records only real changes and answers the category at any instant', () => {
    const db = setup()
    expect(noteGame(db, 1, 1000, 'Just Chatting')).toBe(true)
    expect(noteGame(db, 1, 61_000, 'Just Chatting')).toBe(false)
    expect(noteGame(db, 1, 121_000, 'Grand Theft Auto VI')).toBe(true)
    expect(noteGame(db, 1, 500_000, 'Just Chatting')).toBe(true)
    expect(gamesOf(db, 1).map((g) => g.game)).toEqual(['Just Chatting', 'Grand Theft Auto VI', 'Just Chatting'])
    expect(gameAt(db, 1, 60_000)).toBe('Just Chatting')
    expect(gameAt(db, 1, 200_000)).toBe('Grand Theft Auto VI')
    expect(gameAt(db, 1, 600_000)).toBe('Just Chatting')
    // Antes da primeira anotação vale a primeira
    expect(gameAt(db, 1, 0)).toBe('Just Chatting')
  })
  it('falls back to the category of the live when nothing was recorded', () => {
    const db = setup()
    expect(gameAt(db, 1, 5000)).toBe('Just Chatting')
  })
  it('marks go away with the live', () => {
    const db = setup()
    noteGame(db, 1, 1000, 'Just Chatting')
    db.prepare('DELETE FROM lives WHERE id = 1').run()
    expect(gamesOf(db, 1)).toEqual([])
  })
})
