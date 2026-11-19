import { safeStorage } from 'electron'
import { kvGet, kvSet, type Db } from './db'

/**
 * Segredos (como a chave do Gemini) guardados no banco já criptografados pelo Windows (DPAPI, via safeStorage).
 * Só o processo principal lê; as telas sabem apenas se a chave existe.
 */
export function setSecret(db: Db, name: string, value: string | null): void {
  if (!value) return kvSet(db, `secret:${name}`, null)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Criptografia do Windows indisponível para guardar a chave.')
  kvSet(db, `secret:${name}`, safeStorage.encryptString(value).toString('base64'))
}

/** Existe um segredo guardado que este Windows não consegue abrir (ex.: salvo por outro usuário ou outro ambiente)? */
export function secretUnreadable(db: Db, name: string): boolean {
  return !!kvGet<string | null>(db, `secret:${name}`) && getSecret(db, name) == null
}

export function getSecret(db: Db, name: string): string | null {
  const v = kvGet<string | null>(db, `secret:${name}`)
  if (!v) return null
  try {
    return safeStorage.decryptString(Buffer.from(v, 'base64'))
  } catch {
    return null
  }
}
