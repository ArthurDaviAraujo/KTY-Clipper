/**
 * Revisão dos momentos por IA de texto (montagem do pedido e combinação da nota).
 * Funções puras: o pedido HTTP fica em gemini.ts.
 */

import { MODALITIES, modalityOf } from '../../shared/modality'

export const CATEGORIES = ['engraçado', 'ação', 'falha', 'jogada', 'reação', 'história', 'polêmica', 'talento', 'informação', 'fofo', 'outro'] as const
export type Category = (typeof CATEGORIES)[number]

export interface MomentForAi {
  id: number
  durationS: number
  /** Categoria da live no instante do momento (o streamer pode trocar de jogo no meio) */
  game: string | null
  reasons: string[]
  /** Fala do streamer no trecho, com segundos relativos ao início do clipe: "[3s] texto" */
  speech: string
  chat: string[]
}

export interface AiVerdict {
  id: number
  keep: boolean
  score: number
  category: Category
  title_pt: string
  title_en: string
  reason: string
  hashtags: string[]
}

export const REVIEW_SCHEMA = {
  type: 'OBJECT',
  properties: {
    moments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'INTEGER' },
          keep: { type: 'BOOLEAN' },
          score: { type: 'INTEGER' },
          category: { type: 'STRING', enum: [...CATEGORIES] },
          title_pt: { type: 'STRING' },
          title_en: { type: 'STRING' },
          reason: { type: 'STRING' },
          hashtags: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['id', 'keep', 'score', 'category', 'title_pt', 'title_en', 'reason', 'hashtags']
      }
    }
  },
  required: ['moments']
}

export const REVIEW_SYSTEM = `Você é editor de clipes curtos (YouTube Shorts e TikTok) de lives da Twitch e da Kick de todo tipo:
jogos de qualquer gênero, conversa (Just Chatting, podcast, react), IRL, esporte, música e arte.
Recebe momentos candidatos encontrados automaticamente por picos de chat, áudio ou pedido do streamer.
IMPORTANTE: você NÃO vê o vídeo, só a fala e o chat.
Cada momento traz a categoria da live naquele instante e a modalidade dela. Julgue conforme a modalidade:
- jogo: muita coisa boa é visual (jogada, falha, susto, lance absurdo); reação forte na fala e no chat indica que algo aconteceu na tela.
- conversa: a fala É o conteúdo. Mantenha história engraçada, opinião forte, revelação, discussão, piada que funciona sozinha; descarte papo morno ou que depende de contexto.
- IRL: algo inesperado na rua ou no evento, interação com pessoas, susto, situação absurda.
- esporte: lance decisivo, gol, virada, reação do streamer e do chat.
- criativo: performance marcante, erro engraçado, reação forte do chat.
Se o momento foi clipado por espectadores ou o streamer pediu clipe, isso é forte indício de que algo aconteceu:
mantenha (keep=true) a menos que a fala e o chat mostrem claramente que não houve nada, e capriche no título a partir do que dá para entender.
Para cada um decida se vira um bom clipe sozinho, sem contexto da live:
- keep=false para trecho em que nada acontece, tela de espera, propaganda, leitura de doação sem graça, ou quando não dá para entender o que aconteceu. Em live de conversa, conversa boa não é motivo para descartar.
- score de 0 a 100: potencial de prender quem nunca viu o canal (gancho nos primeiros segundos, reação forte, humor, lance absurdo, frase marcante).
- title_pt: título curto em português do Brasil (até 60 caracteres), chamativo mas fiel ao que aconteceu, sem inventar.
- title_en: o mesmo título em inglês.
- reason: uma frase em português explicando a decisão.
- hashtags: 3 a 5, sem o #, ligadas ao jogo ou assunto e ao tipo de momento.
A transcrição é automática e pode ter erros; o chat pode estar em outro idioma. Responda só com o JSON pedido.`

/** "Just Chatting (conversa)"; sem categoria: "desconhecida (julgue pelo conteúdo)". */
export function categoryLine(game: string | null): string {
  const m = modalityOf(game)
  return m ? `${game} (${MODALITIES[m].label})` : 'desconhecida (julgue pelo conteúdo)'
}

export function buildReviewPrompt(ctx: { channel: string; liveTitle: string }, moments: MomentForAi[]): string {
  const head = `Canal: ${ctx.channel}\nTítulo da live: ${ctx.liveTitle || '(sem título)'}\n`
  const body = moments
    .map(
      (m) =>
        `### Momento ${m.id} (${Math.round(m.durationS)} s)\n` +
        `Categoria: ${categoryLine(m.game)}\n` +
        `Sinais: ${m.reasons.join('; ') || 'nenhum'}\n` +
        `Fala do streamer:\n${m.speech.trim() || '(sem fala reconhecida)'}\n` +
        `Chat logo depois:\n${m.chat.length ? m.chat.map((c) => `- ${c}`).join('\n') : '(sem chat)'}`
    )
    .join('\n\n')
  return `${head}\n${body}`
}

/** Fala do trecho com o segundo relativo de cada frase (quebra a cada pausa de 1,2 s ou 18 palavras). */
export function speechWithTimes(words: { t: number; text: string }[], startMs: number): string {
  const lines: string[] = []
  let cur: string[] = []
  let curT = 0
  let last = -Infinity
  for (const w of words) {
    if (cur.length && (w.t - last > 1200 || cur.length >= 18)) {
      lines.push(`[${curT}s] ${cur.join(' ')}`)
      cur = []
    }
    if (!cur.length) curT = Math.max(0, Math.round((w.t - startMs) / 1000))
    cur.push(w.text)
    last = w.t
  }
  if (cur.length) lines.push(`[${curT}s] ${cur.join(' ')}`)
  return lines.join('\n')
}

/**
 * Nota final.
 * - Sem sinal humano: 40% detectores + 60% IA; descartado pela IA fica com no máximo 30.
 * - Com sinal humano (clipe da comunidade ou pedido do streamer): 70% detectores + 30% IA, sem veto.
 *   A IA só lê fala e chat, não vê a tela; em jogo muito do que é bom é visual (testado em 2026-11-16 com GTA:
 *   a IA descartou todos os 10 trechos que a comunidade clipou, inclusive um de 101 visualizações).
 */
export function combineScore(detector: number, ai: AiVerdict, humanSignal = false): number {
  const a = Math.min(100, Math.max(0, ai.score))
  if (humanSignal) return Math.round(0.7 * detector + 0.3 * a)
  const s = Math.round(0.4 * detector + 0.6 * a)
  return ai.keep ? s : Math.min(30, s)
}
