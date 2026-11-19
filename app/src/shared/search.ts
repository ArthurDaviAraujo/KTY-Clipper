/**
 * Busca: texto sem acento e sem pontuação, e as palavras da pergunta.
 * Funções puras, usadas pela busca no app (main) e testadas sozinhas.
 */

export const normText = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#@]+/gu, ' ')
    .trim()

/** Palavras que não ajudam a achar nada (em PT e EN) */
const STOP = new Set(
  'a o as os e de da do das dos em no na nos nas um uma uns umas que pra para por com sem ele ela eles elas se ao the of and to in on at is it this that quando onde momento momentos clipe clipes'.split(
    ' '
  )
)

export function searchTerms(q: string): string[] {
  const all = normText(q).split(' ').filter(Boolean)
  const useful = all.filter((w) => !STOP.has(w) && (w.length > 1 || /\d/.test(w)))
  return [...new Set(useful.length ? useful : all)]
}

/** Quantas palavras da busca aparecem no texto (0–1). */
export function matchRatio(text: string, terms: string[]): number {
  if (!terms.length) return 0
  const n = ` ${normText(text)} `
  return terms.filter((t) => n.includes(t)).length / terms.length
}

/**
 * Padrão LIKE do SQLite para achar a palavra mesmo com acento no banco ("onibus" acha "ônibus"):
 * vogais e "c" viram "_" (qualquer letra). O resultado ainda é conferido em JS.
 */
export function likePattern(term: string): string {
  return `%${term.replace(/[%_\\]/g, '').replace(/[aeiouc]/g, '_')}%`
}

/** A palavra mais rara costuma ser a mais longa: é ela que filtra no banco. */
export const anchorTerm = (terms: string[]): string => [...terms].sort((a, b) => b.length - a.length)[0] ?? ''
