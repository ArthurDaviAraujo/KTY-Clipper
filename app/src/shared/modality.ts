/**
 * Modalidade da live, deduzida da categoria da Twitch ou da Kick.
 * O app serve para qualquer jogo, streamer e tipo de live: a modalidade muda o que conta como bom momento
 * (num jogo, o lance na tela; numa conversa, a fala).
 */
export type Modality = 'game' | 'talk' | 'irl' | 'sports' | 'creative'

export const MODALITIES: Record<Modality, { label: string; hint: string }> = {
  game: { label: 'jogo', hint: 'jogos de qualquer tipo' },
  talk: { label: 'conversa', hint: 'Just Chatting, podcast, react' },
  irl: { label: 'IRL', hint: 'rua, viagem, eventos, comida' },
  sports: { label: 'esporte', hint: 'transmissões e conteúdo de esporte' },
  creative: { label: 'criativo', hint: 'música, arte, criação' }
}

/** Minúsculas, sem acento, "&" vira "and", só letras e números separados por espaço. */
export function normalizeCategory(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Nomes das categorias que não são jogos (Twitch e Kick usam os nomes em inglês)
const KNOWN: Record<string, Modality> = {
  'just chatting': 'talk',
  'talk shows and podcasts': 'talk',
  podcasts: 'talk',
  podcast: 'talk',
  politics: 'talk',
  'science and technology': 'talk',
  'special events': 'talk',
  'watch party': 'talk',
  'tabletop rpgs': 'talk',
  irl: 'irl',
  'travel and outdoors': 'irl',
  'food and drink': 'irl',
  'pools hot tubs and beaches': 'irl',
  'pools hot tubs and bikinis': 'irl',
  'animals aquariums and zoos': 'irl',
  'fitness and health': 'irl',
  'always on': 'irl',
  sports: 'sports',
  sport: 'sports',
  football: 'sports',
  soccer: 'sports',
  basketball: 'sports',
  'horse racing': 'sports',
  'mma and boxing': 'sports',
  music: 'creative',
  art: 'creative',
  'makers and crafting': 'creative',
  'software and game development': 'creative',
  'beauty and body art': 'creative',
  asmr: 'creative',
  'dj s': 'creative',
  djs: 'creative',
  'writing and reading': 'creative',
  creative: 'creative',
  // Categorias do YouTube (o YouTube não diz o jogo na página da live; "Gaming" cai em jogo)
  'people and blogs': 'talk',
  entertainment: 'talk',
  comedy: 'talk',
  education: 'talk',
  'news and politics': 'talk',
  'film and animation': 'talk',
  'nonprofits and activism': 'talk',
  'howto and style': 'creative',
  'travel and events': 'irl',
  'pets and animals': 'irl',
  'autos and vehicles': 'irl'
}

/** Modalidade de uma categoria; qualquer categoria desconhecida é um jogo. Sem categoria: null. */
export function modalityOf(category: string | null | undefined): Modality | null {
  if (!category || !category.trim()) return null
  return KNOWN[normalizeCategory(category)] ?? 'game'
}
