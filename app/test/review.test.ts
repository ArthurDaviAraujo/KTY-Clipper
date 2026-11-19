import { describe, expect, it } from 'vitest'
import { REVIEW_SCHEMA, REVIEW_SYSTEM, combineScore, rubricScore, type AiVerdict } from '../src/main/ai/review'

const base: AiVerdict = { id: 1, keep: true, score: 40, category: 'engraçado', title_pt: 'X', title_en: 'X', reason: 'r', hashtags: [] }

describe('raciocínio da KaTY', () => {
  it('a nota é a soma das partes, cada uma no seu teto', () => {
    expect(rubricScore({ ...base, notas: { gancho: 25, desfecho: 20, emocao: 15, compartilhavel: 10 } })).toBe(70)
    // Parte acima do teto é cortada (gancho até 30)
    expect(rubricScore({ ...base, notas: { gancho: 90, desfecho: 30, emocao: 20, compartilhavel: 20 } })).toBe(100)
    // Sem partes (resposta antiga ou de reserva): fica o score dado
    expect(rubricScore(base)).toBe(40)
    expect(rubricScore({ ...base, notas: { gancho: 10 } as never })).toBe(40)
  })

  it('a nota das partes entra na combinação com os detectores', () => {
    const v = { ...base, notas: { gancho: 30, desfecho: 30, emocao: 20, compartilhavel: 20 } }
    expect(combineScore(50, { ...v, score: rubricScore(v) })).toBe(80)
  })

  it('pede a análise antes da decisão e os passos do editor', () => {
    const item = REVIEW_SCHEMA.properties.moments.items as { required: string[]; propertyOrdering: string[] }
    expect(item.required).toEqual(expect.arrayContaining(['analise', 'gancho', 'notas']))
    // A análise vem antes do keep e do score
    expect(item.propertyOrdering.indexOf('analise')).toBeLessThan(item.propertyOrdering.indexOf('keep'))
    expect(item.propertyOrdering.indexOf('clip_start')).toBeLessThan(item.propertyOrdering.indexOf('score'))
    for (const t of ['Gancho:', 'Desfecho:', 'Teste do estranho', 'O TikTok só paga vídeos de 60 s', 'spoiler', 'Devolva UM item para CADA momento']) expect(REVIEW_SYSTEM).toContain(t)
  })
})
