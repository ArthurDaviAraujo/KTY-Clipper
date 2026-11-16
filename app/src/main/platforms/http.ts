/**
 * Função de rede usada pelos módulos das plataformas.
 * No app, o processo principal troca pelo `net.fetch` do Electron (pilha de rede do Chromium):
 * a Kick (Cloudflare) recusa com 403 o fetch do Node embutido no Electron, mas aceita o do Chromium.
 * Nos testes fica o fetch do Node.
 */
export let httpFetch: typeof fetch = (...args) => fetch(...args)

export function setHttpFetch(f: typeof fetch): void {
  httpFetch = f
}
