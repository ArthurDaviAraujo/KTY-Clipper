/**
 * Argumentos de cada codificador para uma qualidade constante `q`
 * (14 = quase sem perda, 20 = boa para postar, 24 = rápido/menor). Vindo do yt-dlp GUI, onde foi medido na RX 7600.
 */
const hvc1 = ['-tag:v', 'hvc1']

export function encoderArgs(enc: string, q = 20): string[] {
  switch (enc) {
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', `${q}`, '-qp_p', `${q + 2}`, '-qp_b', `${q + 4}`]
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', `${q + 1}`, '-b:v', '0']
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'slow', '-global_quality', `${q + 1}`]
    case 'h264_mf':
      return ['-c:v', 'h264_mf', '-b:v', q <= 18 ? '24M' : q <= 21 ? '16M' : '8M']
    // H.265: na mesma qualidade visual o QP fica 1 acima do H.264
    case 'hevc_amf':
      return ['-c:v', 'hevc_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', `${q + 1}`, '-qp_p', `${q + 3}`, ...hvc1]
    case 'hevc_nvenc':
      return ['-c:v', 'hevc_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', `${q + 2}`, '-b:v', '0', ...hvc1]
    case 'hevc_qsv':
      return ['-c:v', 'hevc_qsv', '-preset', 'slow', '-global_quality', `${q + 2}`, ...hvc1]
    case 'hevc_mf':
      return ['-c:v', 'hevc_mf', '-b:v', q <= 18 ? '16M' : q <= 21 ? '10M' : '6M', ...hvc1]
    case 'libx265':
      return ['-c:v', 'libx265', '-preset', 'medium', '-crf', `${q + 1}`, '-x265-params', 'log-level=error', ...hvc1]
    // AV1: QP de 0 a 255; 4× o valor do H.264 deu a mesma qualidade com ~30% menos arquivo
    case 'av1_amf':
      return ['-c:v', 'av1_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', `${q * 4}`, '-qp_p', `${q * 4 + 8}`]
    case 'av1_nvenc':
      return ['-c:v', 'av1_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', `${q + 4}`, '-b:v', '0']
    case 'av1_qsv':
      return ['-c:v', 'av1_qsv', '-preset', 'slow', '-global_quality', `${q + 4}`]
    case 'libsvtav1':
      return ['-c:v', 'libsvtav1', '-preset', '8', '-crf', `${q + 10}`]
    default:
      return ['-c:v', 'libx264', '-preset', q <= 18 ? 'slow' : 'medium', '-crf', `${q}`]
  }
}

/** Os H.264 de placa não passam de 4096 pixels no lado maior; acima disso só o processador grava. */
export const fitEncoder = (enc: string, W: number, H: number) => (Math.max(W, H) > 4096 && /^h264_/.test(enc) ? 'libx264' : enc)

/** Codificador de processador equivalente (plano B quando a placa recusa o tamanho ou falha). */
export const cpuFallback = (enc: string) => (/^hevc_|^libx265/.test(enc) ? 'libx265' : /^av1_|^libsvtav1/.test(enc) ? 'libsvtav1' : 'libx264')
