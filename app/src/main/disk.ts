import { mkdirSync, statfsSync } from 'fs'

const GB = 1024 ** 3

/** Espaço livre e total do disco onde fica `path` (a pasta é criada se não existir). */
export function diskSpace(path: string): { freeGb: number; totalGb: number } {
  mkdirSync(path, { recursive: true })
  const s = statfsSync(path)
  return { freeGb: Math.round(((s.bavail * s.bsize) / GB) * 10) / 10, totalGb: Math.round((s.blocks * s.bsize) / GB) }
}
