# Clipador KTY

Clipador automático com IA para lives da Twitch e da Kick (uso pessoal). O plano completo está em [PLANO.md](PLANO.md).

## Rodar em desenvolvimento

```bash
cd app
npm install
node node_modules/electron/install.js   # baixa o Electron na primeira vez
npm run dev
```

## Programas

Coloque na pasta `programas/` (fora do git):

- `ffmpeg.exe`, `ffprobe.exe`, `yt-dlp.exe` (obrigatórios)
- `whisper/whisper-cli.exe` e DLLs (fase 1)
- `streamlink/` (fase 1)

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Abre o app com recarga automática |
| `npm run build` | Gera `app/out` |
| `npm run typecheck` | Checa os tipos |
| `npm test` | Roda os testes |

## Dados

Em desenvolvimento, banco e arquivos ficam em `dados/` (fora do git).
