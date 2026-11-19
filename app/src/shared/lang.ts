/** Idiomas que a pessoa pode escolher para a legenda (o resto fica no automático) */
export const SPEECH_LANGS: { value: string; label: string }[] = [
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'Inglês' },
  { value: 'es', label: 'Espanhol' }
]

/** "PT", "pt-BR", "Portuguese" → "pt"; o que não for um idioma de 2 letras vira null */
export function langCode(v: string | null | undefined): string | null {
  if (!v) return null
  const names: Record<string, string> = {
    portuguese: 'pt',
    english: 'en',
    spanish: 'es',
    french: 'fr',
    german: 'de',
    italian: 'it',
    russian: 'ru',
    japanese: 'ja',
    korean: 'ko'
  }
  const s = v.trim().toLowerCase()
  if (names[s]) return names[s]
  const m = s.match(/^([a-z]{2})(?:[-_][a-z]{2,4})?$/)
  return m ? m[1] : null
}

/**
 * Em que idioma transcrever a fala, por ordem de força:
 * 1. escolhido à mão no canal;
 * 2. fixado nas Configurações (vale para todos);
 * 3. já decidido nesta live;
 * 4. "auto" (ainda aprendendo nesta live).
 */
export function speechLangFor(o: { channelChoice: string | null; global: string; live: string | null }): string {
  if (o.channelChoice && o.channelChoice !== 'auto') return o.channelChoice
  if (o.global && o.global !== 'auto') return o.global
  return o.live ?? 'auto'
}

/**
 * Decide o idioma do streamer nesta live pelo que o Whisper achou em cada pedaço (só os ouvidos no automático).
 * Domina com pelo menos 3 pedaços e 60%. Com só 2 pedaços, a dica (o idioma que a plataforma informa,
 * ou o aprendido nas lives anteriores) já vale se ela estiver em pelo menos metade deles.
 */
export function decideStreamerLang(langs: (string | null | undefined)[], hint: string | null): string | null {
  const ok = langs.filter((l): l is string => typeof l === 'string' && /^[a-z]{2}$/.test(l))
  const count = new Map<string, number>()
  for (const l of ok) count.set(l, (count.get(l) ?? 0) + 1)
  if (ok.length >= 3) {
    const [top, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0]
    if (n / ok.length >= 0.6) return top
  }
  if (hint && ok.length >= 2 && (count.get(hint) ?? 0) / ok.length >= 0.5) return hint
  return null
}
