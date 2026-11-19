/**
 * A KaTY acha a facecam (a câmera do streamer por cima do jogo) olhando quadros da live.
 *
 * Por que assim (pesquisa de 2026-11-18, no Segundo Cérebro "Cortes que viralizam - pesquisa e padrões"):
 * - detector de rosto clássico (OpenCV Haar, usado pelo clipsmith) também acha rostos DENTRO do jogo;
 * - o Gemini tem treino extra para detecção e devolve caixas no formato box_2d [ymin, xmin, ymax, xmax] de 0 a 1000;
 * - a webcam é um retângulo FIXO: com 3 quadros de horários diferentes, só ela fica no mesmo lugar (checagem no tempo).
 */
import type { Rect } from '../../shared/types'

export const FACECAM_SYSTEM = `Você analisa quadros de uma live (Twitch, Kick ou YouTube) para montar clipes verticais.
Os quadros são da MESMA live, em horários diferentes. Ache a FACECAM: o retângulo com a câmera ao vivo do streamer
(o rosto ou o corpo da pessoa real), sobreposto à tela do jogo ou do conteúdo, que fica no MESMO lugar em todos os quadros.
Não confunda com: personagens ou rostos do jogo, avatares, fotos fixas, alertas, chat, logos, QR code ou vídeos que o streamer está assistindo.
Se a câmera ocupa a tela inteira (live IRL ou só conversa) ou não existe facecam, responda found=false.
box_2d = [ymin, xmin, ymax, xmax] normalizado de 0 a 1000 em relação à imagem, cobrindo a facecam inteira (com a moldura, se houver).
confidence de 0 a 100. Responda só com o JSON pedido.`

export const FACECAM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    found: { type: 'BOOLEAN' },
    box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
    confidence: { type: 'INTEGER' },
    reason: { type: 'STRING' }
  },
  required: ['found', 'box_2d', 'confidence', 'reason'],
  propertyOrdering: ['reason', 'found', 'box_2d', 'confidence']
}

export interface FacecamAnswer {
  found: boolean
  box_2d: number[]
  confidence: number
  reason: string
}

/**
 * Caixa do Gemini → facecam em frações do quadro, ou o motivo de não servir.
 * Recusa: não achou, pouca confiança, caixa pequena demais (menos de 0,5% da tela) ou grande demais (mais de 40%: tela inteira não é facecam).
 */
export function facecamFromAnswer(a: Partial<FacecamAnswer> | null | undefined): { rect: Rect | null; why: string } {
  if (!a || !a.found) return { rect: null, why: a?.reason ? `Não achou: ${a.reason}` : 'Não achou facecam nesta live.' }
  const b = a.box_2d
  if (!Array.isArray(b) || b.length !== 4 || !b.every((x) => Number.isFinite(x))) return { rect: null, why: 'A resposta veio sem caixa.' }
  if ((a.confidence ?? 0) < 50) return { rect: null, why: `Pouca certeza (${a.confidence ?? 0}%).` }
  const c = (v: number) => Math.min(1, Math.max(0, v / 1000))
  const [y0, x0, y1, x1] = [c(b[0]), c(b[1]), c(b[2]), c(b[3])]
  const x = Math.min(x0, x1)
  const y = Math.min(y0, y1)
  const w = Math.abs(x1 - x0)
  const h = Math.abs(y1 - y0)
  const area = w * h
  if (w < 0.04 || h < 0.04 || area < 0.005) return { rect: null, why: 'A caixa achada é pequena demais para ser a câmera.' }
  if (area > 0.4) return { rect: null, why: 'A câmera ocupa quase a tela toda (não é facecam por cima do jogo).' }
  const r = (v: number) => Math.round(v * 1000) / 1000
  return { rect: { x: r(x), y: r(y), w: r(w), h: r(h) }, why: a.reason ?? '' }
}
