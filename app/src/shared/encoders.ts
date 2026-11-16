import type { EncoderFamily, EncoderInfo } from './types'

/** Codificadores que o app sabe usar, do mais preferido ao menos, dentro de cada formato. */
export const ENCODER_CANDIDATES: Omit<EncoderInfo, 'works'>[] = [
  { name: 'h264_amf', codec: 'h264', family: 'amd' },
  { name: 'hevc_amf', codec: 'hevc', family: 'amd' },
  { name: 'av1_amf', codec: 'av1', family: 'amd' },
  { name: 'h264_nvenc', codec: 'h264', family: 'nvidia' },
  { name: 'hevc_nvenc', codec: 'hevc', family: 'nvidia' },
  { name: 'av1_nvenc', codec: 'av1', family: 'nvidia' },
  { name: 'h264_qsv', codec: 'h264', family: 'intel' },
  { name: 'hevc_qsv', codec: 'hevc', family: 'intel' },
  { name: 'av1_qsv', codec: 'av1', family: 'intel' },
  { name: 'h264_mf', codec: 'h264', family: 'windows' },
  { name: 'hevc_mf', codec: 'hevc', family: 'windows' },
  { name: 'libx264', codec: 'h264', family: 'cpu' },
  { name: 'libx265', codec: 'hevc', family: 'cpu' },
  { name: 'libsvtav1', codec: 'av1', family: 'cpu' }
]

export const FAMILY_LABEL: Record<EncoderFamily, string> = {
  amd: 'Placa AMD',
  nvidia: 'Placa NVIDIA',
  intel: 'Intel (QuickSync)',
  windows: 'Genérico do Windows',
  cpu: 'Processador'
}

/** Ordem de preferência por família para o modo Rápido/Equilibrado (placa primeiro). */
const HW_FIRST: EncoderFamily[] = ['nvidia', 'amd', 'intel', 'windows', 'cpu']

/**
 * Escolhe o codificador padrão: o configurado, se funciona;
 * senão o primeiro H.264 que funciona, priorizando placa de vídeo.
 * No modo Máxima prefere o processador (melhor qualidade por tamanho).
 */
export function pickEncoder(encoders: EncoderInfo[], configured: string, preset: 'fast' | 'balanced' | 'max'): string | null {
  const ok = encoders.filter((e) => e.works)
  if (configured && ok.some((e) => e.name === configured)) return configured
  const order: EncoderFamily[] = preset === 'max' ? ['cpu', ...HW_FIRST.filter((f) => f !== 'cpu')] : HW_FIRST
  for (const fam of order) {
    const e = ok.find((x) => x.family === fam && x.codec === 'h264')
    if (e) return e.name
  }
  return ok[0]?.name ?? null
}
