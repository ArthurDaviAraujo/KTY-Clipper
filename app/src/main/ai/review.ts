/**
 * Revisão dos momentos por IA de texto (montagem do pedido e combinação da nota).
 * Funções puras: o pedido HTTP fica em gemini.ts.
 */

import { MODALITIES, modalityOf, type Modality } from '../../shared/modality'

export const CATEGORIES = ['engraçado', 'ação', 'falha', 'jogada', 'reação', 'história', 'polêmica', 'talento', 'informação', 'fofo', 'outro'] as const
export type Category = (typeof CATEGORIES)[number]

export interface MomentForAi {
  id: number
  durationS: number
  /** Janela de fala mostrada à IA (s) e onde o lance detectado fica dentro dela */
  windowS?: number
  fromS?: number
  toS?: number
  peakS?: number
  /** Categoria da live no instante do momento (o streamer pode trocar de jogo no meio) */
  game: string | null
  /** Modalidade fixada no canal; sem ela, vem da categoria */
  modality?: Modality | null
  reasons: string[]
  /** Fala do streamer no trecho, com segundos relativos ao início do clipe: "[3s] texto" */
  speech: string
  chat: string[]
}

/** Nota por partes (a soma vira a nota da IA): o que faz um corte prender quem nunca viu o canal */
export interface ScoreParts {
  /** Os 3 primeiros segundos prendem? (0–30) */
  gancho: number
  /** Tem desfecho claro que paga a expectativa? (0–30) */
  desfecho: number
  /** Reação forte: riso, grito, susto, raiva (0–20) */
  emocao: number
  /** Dá vontade de mandar para alguém ou comentar? (0–20) */
  compartilhavel: number
}

export interface AiVerdict {
  id: number
  /** Raciocínio curto antes da decisão: o que aconteceu, onde está o gancho e onde está o desfecho */
  analise?: string
  /** O que prende nos primeiros segundos do corte */
  gancho?: string
  notas?: ScoreParts
  keep: boolean
  score: number
  category: Category
  title_pt: string
  title_en: string
  reason: string
  hashtags: string[]
  /** Começo e fim do corte escolhidos pela IA, em segundos dentro da janela de fala */
  clip_start?: number
  clip_end?: number
  /** Segunda olhada com vídeo: o que ela viu na tela e se há spoiler da história do jogo */
  visto?: string
  spoiler?: boolean
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
          analise: { type: 'STRING' },
          gancho: { type: 'STRING' },
          notas: {
            type: 'OBJECT',
            properties: { gancho: { type: 'INTEGER' }, desfecho: { type: 'INTEGER' }, emocao: { type: 'INTEGER' }, compartilhavel: { type: 'INTEGER' } },
            required: ['gancho', 'desfecho', 'emocao', 'compartilhavel'],
            propertyOrdering: ['gancho', 'desfecho', 'emocao', 'compartilhavel']
          },
          keep: { type: 'BOOLEAN' },
          score: { type: 'INTEGER' },
          category: { type: 'STRING', enum: [...CATEGORIES] },
          title_pt: { type: 'STRING' },
          title_en: { type: 'STRING' },
          reason: { type: 'STRING' },
          hashtags: { type: 'ARRAY', items: { type: 'STRING' } },
          clip_start: { type: 'NUMBER' },
          clip_end: { type: 'NUMBER' }
        },
        required: ['id', 'analise', 'gancho', 'notas', 'keep', 'score', 'category', 'title_pt', 'title_en', 'reason', 'hashtags', 'clip_start', 'clip_end'],
        // A análise vem primeiro: a IA pensa antes de decidir (o Gemini respeita esta ordem)
        propertyOrdering: ['id', 'analise', 'gancho', 'notas', 'clip_start', 'clip_end', 'keep', 'score', 'category', 'title_pt', 'title_en', 'reason', 'hashtags']
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

Pense como os editores dos canais de cortes que mais crescem: quem vê o corte NUNCA viu o canal e decide em 1 a 3 segundos se fica.
O corte que viraliza tem GANCHO (prende logo de cara), TENSÃO (dá vontade de saber o que vem) e DESFECHO (paga o que o começo prometeu), e funciona sozinho.
Siga estes passos para cada momento e escreva o resumo deles em "analise" ANTES de decidir o resto:
1. O que aconteceu: pela fala e pelo chat, conte em uma frase o fato (quem fez o quê). O chat é o termômetro: "KKKK", "CLIPA", "????", "F", muitos emojis
   ou spam de uma palavra mostram onde foi o pico e qual foi a emoção. Se não dá para dizer o que aconteceu, é keep=false (menos com clipe da comunidade ou pedido de clipe).
2. Gancho: escolha o clip_start para que os 3 primeiros segundos já tenham algo forte. Entre no meio da ação, nunca no preparo lento:
   - jogo/esporte/IRL: comece pouco antes do lance ou já na reação (a consequência pode vir primeiro), com só o contexto mínimo para entender;
   - conversa: comece na primeira palavra da pergunta, da frase polêmica ou do começo da história, sem cumprimento, "então…", "pera aí" ou silêncio.
   Escreva em "gancho" o que prende nesses primeiros segundos (a frase dita ou a situação).
3. Desfecho: escolha o clip_end logo depois do ponto alto e da reação ao lance (riso, grito, comentário do streamer). Corte antes de a conversa esfriar:
   terminar no desfecho faz a pessoa rever o corte. Nunca termine antes do ponto alto nem no meio de uma frase.
4. Teste do estranho: alguém que nunca viu o canal entende e se importa? Piada interna que depende de horas de live, papo morno,
   tela de espera, propaganda, leitura de doação sem graça: keep=false. Em live de conversa, conversa boa não é motivo para descartar.
5. Notas (somadas viram o score de 0 a 100): gancho 0–30 (os primeiros segundos prendem?), desfecho 0–30 (tem resolução clara?),
   emocao 0–20 (reação forte: riso, susto, raiva, choque), compartilhavel 0–20 (dá vontade de mandar para alguém ou comentar: polêmica, absurdo, frase marcante, "você decide").
   Seja exigente: um corte bom de verdade passa de 70; um mediano fica perto de 50.
6. Título e hashtags (veja as regras abaixo).
Duração: cortes que viralizam têm em geral de 40 a 75 s. O TikTok só paga vídeos de 60 s ou mais: se a história completa passa de 60 s, mantenha;
qualquer corte pode ir até 150 s se a história pedir (conversa até 120 s). Nunca encha com conversa morna antes ou depois. O corte precisa conter o lance detectado.

Campos:
- analise: 1 a 3 frases curtas com os passos 1 a 4.
- gancho: o que prende nos primeiros segundos.
- notas: { gancho, desfecho, emocao, compartilhavel }; score = a soma.
- keep: se vira um bom clipe sozinho.
- title_pt: no estilo dos cortes que mais viralizam no TikTok e no Shorts (análise de cortes de canais brasileiros):
  EM CAIXA ALTA, de 35 a 55 caracteres, com o assunto logo no começo (quem e o quê), uma afirmação forte ou uma pergunta, terminando com "!" ou "?" e 1 emoji que combine
  (😱 susto/absurdo, 😂 engraçado, 🤔 dúvida/opinião, 🔥 lance incrível, 💰 dinheiro). Cite o nome do streamer, do convidado ou do jogo quando ajudar.
  Uma frase marcante dita no trecho, entre aspas, também funciona. Exemplos: "GAULES PERDEU TUDO NO ÚLTIMO ROUND! 😱", "O JOGO NOVO VAI TER MAIS DE 50 HORAS DE CAMPANHA? 🤔",
  "“ISSO NÃO É NORMAL” O STREAMER TRAVOU COM O FINAL! 😱".
  Chamativo, mas fiel: prometer o que o trecho não mostra faz a pessoa sair e derruba o corte. Em jogo lançado há pouco, não conte reviravolta da história no título (spoiler).
- title_en: o mesmo título em inglês, no mesmo estilo.
- reason: uma frase em português explicando a decisão.
- hashtags: 5, sem o #: 2 ou 3 específicas (jogo, streamer, assunto) e 2 ou 3 gerais que trazem público (ex.: games, ps5, podcast, cortes, humor).
- clip_start e clip_end: em segundos da fala mostrada (a janela vai de 0 até o fim indicado), pelos passos 2 e 3.
A transcrição é automática e pode ter erros; o chat pode estar em outro idioma.
Devolva UM item para CADA momento recebido, com o mesmo id (mesmo os que você descartar, com keep=false). Responda só com o JSON pedido.`

/**
 * Segunda olhada, VENDO o vídeo do trecho (só para os lances mais fortes): a KaTY revê a análise que fez pela fala e pelo chat.
 * Mesmo formato da análise normal, para um momento só, com o que ela viu e se há spoiler da história do jogo.
 */
export const VIDEO_REVIEW_SYSTEM = `${REVIEW_SYSTEM}

AGORA VOCÊ VÊ O VÍDEO. Você recebeu o vídeo da janela do lance (com o som) e a análise que fez antes só pela fala e pelo chat.
O vídeo começa no segundo 0 da janela, a mesma referência de clip_start e clip_end. Reveja tudo olhando a tela:
- O que aconteceu de fato na tela (batida, fuga, morte, susto, bug, jogada, cena engraçada) e a reação do streamer na facecam (riso, grito, cara de choque).
- Lance visual forte com pouca fala é bom clipe (keep=true); tela de menu, carregamento, mapa, propaganda ou nada acontecendo é keep=false.
- Ajuste clip_start para quando a ação começa na tela e clip_end para logo depois da reação, pelo que você vê.
- Título contando o que se vê ("BATEU O CARRO NA POLÍCIA E FUGIU A PÉ!"), fiel ao vídeo.
- spoiler=true se o trecho mostra cena da história do jogo que estraga a surpresa (final, morte de personagem, reviravolta); nesse caso o título não conta a reviravolta.
- visto: 1 frase com o que aparece na tela.
Devolva o JSON de um momento (o mesmo id).`

export const VIDEO_REVIEW_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ...(REVIEW_SCHEMA.properties.moments.items as { properties: Record<string, unknown> }).properties,
    visto: { type: 'STRING' },
    spoiler: { type: 'BOOLEAN' }
  },
  required: [...(REVIEW_SCHEMA.properties.moments.items as { required: string[] }).required, 'visto', 'spoiler'],
  propertyOrdering: ['id', 'visto', 'analise', 'gancho', 'notas', 'clip_start', 'clip_end', 'spoiler', 'keep', 'score', 'category', 'title_pt', 'title_en', 'reason', 'hashtags']
}

/** Pedido da segunda olhada: o momento (como na análise normal) e o que a KaTY achou antes, só pelo texto. */
export function buildVideoPrompt(ctx: { channel: string; liveTitle: string }, m: MomentForAi, before: AiVerdict): string {
  return `${buildReviewPrompt(ctx, [m])}

### O que você achou antes, só pela fala e pelo chat
keep=${before.keep}, notas=${JSON.stringify(before.notas ?? {})}, clip ${before.clip_start ?? '?'}–${before.clip_end ?? '?'} s, título "${before.title_pt}".
${before.analise ? `Análise: ${before.analise}` : ''}
Agora veja o vídeo e devolva a análise final.`
}

/**
 * Quais lances recebem a segunda olhada com vídeo: os que a KaTY manteve (ou que tiveram clipe da comunidade
 * ou pedido de clipe) com nota de pelo menos 35, dos mais fortes para os mais fracos, até `max`.
 */
export function pickForVideo(vs: { id: number; keep: boolean; score: number; human?: boolean }[], max: number): number[] {
  return vs
    .filter((v) => (v.keep || v.human) && v.score >= 35)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, max))
    .map((v) => v.id)
}

/**
 * Nota da IA a partir das partes (gancho 30, desfecho 30, emoção 20, compartilhável 20).
 * Sem partes válidas (resposta antiga ou de uma reserva que não mandou), fica o score que ela deu.
 */
export function rubricScore(v: Pick<AiVerdict, 'score' | 'notas'>): number {
  const n = v.notas
  const part = (x: unknown, max: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(0, Math.round(x))) : null)
  const p = n ? [part(n.gancho, 30), part(n.desfecho, 30), part(n.emocao, 20), part(n.compartilhavel, 20)] : []
  if (p.length === 4 && p.every((x) => x != null)) return p.reduce<number>((a, x) => a + (x ?? 0), 0)
  return Math.min(100, Math.max(0, Math.round(Number(v.score) || 0)))
}

/** "Just Chatting (conversa)"; sem categoria: "desconhecida (julgue pelo conteúdo)". A modalidade fixada no canal vale mais que a categoria. */
export function categoryLine(game: string | null, fixed?: Modality | null): string {
  const m = fixed ?? modalityOf(game)
  if (!m) return 'desconhecida (julgue pelo conteúdo)'
  return `${game ?? 'sem categoria'} (${MODALITIES[m].label}${fixed ? ', definida para o canal' : ''})`
}

export function buildReviewPrompt(ctx: { channel: string; liveTitle: string }, moments: MomentForAi[]): string {
  const head = `Canal: ${ctx.channel}\nTítulo da live: ${ctx.liveTitle || '(sem título)'}\n`
  const body = moments
    .map(
      (m) =>
        `### Momento ${m.id} (${Math.round(m.durationS)} s)\n` +
        (m.windowS != null
          ? `Fala mostrada: de 0 a ${Math.round(m.windowS)} s. O lance detectado fica entre ${Math.round(m.fromS ?? 0)} s e ${Math.round(m.toS ?? 0)} s (pico em ${Math.round(m.peakS ?? 0)} s).\n`
          : '') +
        `Categoria: ${categoryLine(m.game, m.modality)}\n` +
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
