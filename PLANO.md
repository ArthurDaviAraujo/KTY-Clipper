# Clipador KTY — Plano do projeto

> Versão 1 do plano, 2026-11-16 (atualizado em 2026-11-17). Documento vivo: muda conforme testamos.

## 1. O que é

App desktop para Windows que vigia canais de streamers (Twitch e Kick), grava as lives, encontra os melhores momentos com IA e entrega clipes verticais prontos (legenda, título, hashtags) para canais de YouTube Shorts e TikTok, em português e inglês.

- **Para quem:** uso pessoal e de alguns amigos. Cada um roda no próprio PC, com os próprios canais e chaves.
- **Para qualquer live (decisão do usuário, 2026-11-17):** qualquer jogo, streamer e modalidade (jogo, conversa como Just Chatting, podcast e react, IRL, esporte, música e arte). O lançamento do GTA 6 (19/11/2026) é a primeira grande motivação, não o limite: nada no app depende de um jogo.
- **Princípio:** todo recurso pode ser ligado e desligado, e cada detector tem peso ajustável.
- **Projeto separado** do yt-dlp Studio. Podemos copiar ideias e trechos de lá quando fizer sentido, sempre trazendo para dentro deste repositório.

## 2. O melhor de cada referência

| Recurso | Referência | Nosso diferencial |
|---|---|---|
| Vigiar canais e pegar lives novas | AutoClip | Começa a gravar no momento em que a live abre |
| Clipar durante a live | TL;DR | Janela deslizante sobre a gravação em andamento |
| Picos de chat comparados ao normal do canal | ClipFinder (Hype Map) | Chat capturado ao vivo (não depende de API não oficial de replay) |
| Voz, gritos, risadas, "clip that" | Auto-Clipper, StreamLadder | Gatilhos em PT e EN editáveis |
| Transcrição + IA que entende a fala | ClipFinder, clipsmith | Provedor de IA plugável (local, API ou assinatura) |
| Eventos na tela do jogo | Auto-Clipper, Powder | Perfis por jogo (o primeiro será o GTA 6, depois do lançamento) |
| **Mesmo momento em vários streamers** | Ninguém | Agrupa por horário real (UTC) e por assunto |
| Nota de viralidade 0–100 | StreamLadder | Nota explicada: quais sinais pesaram |
| Aprender por canal e por desempenho | AutoClip | Usa as métricas reais dos seus canais |
| Buscar momento por descrição ou palavra | StreamLadder | Busca na transcrição e nos eventos |
| Vertical com facecam, legenda palavra a palavra | StreamLadder, ClipFinder | Layouts salvos por streamer |
| Vídeo longo com os melhores momentos | ClipFinder, StreamLadder | Fase 3 |
| Fila de aprovação, agendamento, limite diário | AutoClip, ClipFinder | Aprovação em 1 tecla; auto-postar opcional por canal |
| IA local sem custo de nuvem | Powder | Local por padrão, nuvem opcional |

## 3. Arquitetura

```
┌────────────────────── App Electron (React + TypeScript + Tailwind) ──────────────────────┐
│  Telas: Início · Clipes · Canais · Ajustes  (busca, atividade e perfil no topo)           │
└───────────────┬──────────────────────────────────────────────────────────────────────────┘
                │ IPC
┌───────────────▼──────────────── Processo principal (Node) ───────────────────────────────┐
│ Vigia (Twitch/Kick)  →  Gravador (vídeo em segmentos + chat ao vivo)                      │
│        ↓                                                                                  │
│ Fila de jobs (SQLite)  →  Detectores (cada um liga/desliga, com peso)                     │
│        ↓                    chat · áudio · fala (Whisper) · IA de texto · tela · voz       │
│ Fusão + nota 0–100  →  Cruzamento entre streamers  →  Gerador de clipe (ffmpeg)            │
│        ↓                                                                                  │
│ Fila de aprovação  →  Exportar pasta / Postar (YouTube, TikTok)  →  Métricas → aprendizado │
└──────────────────────────────────────────────────────────────────────────────────────────┘
   Programas externos: ffmpeg/ffprobe, yt-dlp, streamlink, whisper.cpp (Vulkan, placa AMD)
   Opcional (fase 3): worker Python para visão (OpenCV/ONNX com DirectML)
```

### Decisões técnicas (propostas)
- **Electron + React + TypeScript + Tailwind:** mesma família do yt-dlp Studio, que você já conhece e que roda nesta máquina (Node instalado, sem Rust).
- **SQLite** (`better-sqlite3`) para canais, lives, momentos, clipes e postagens.
- **Gravação:** `streamlink` ou `yt-dlp` gravando o HLS da live em segmentos de alguns minutos (permite processar enquanto a live continua).
- **Chat ao vivo:** Twitch pelo IRC oficial (leitura anônima); Kick pelo canal de chat em WebSocket que o site usa (não oficial, isolado num módulo para trocar fácil).
- **Saber quando a live começa:** Twitch pela API oficial (Helix/EventSub, precisa de Client ID gratuito); Kick pela API pública dele (a confirmar no começo da fase 1).
- **Transcrição:** `whisper.cpp` com Vulkan para usar a RX 7600 (a medir velocidade); idioma detectado por live.
- **Detecção ao vivo vs. depois:** os mesmos detectores rodam sobre segmentos; "ao vivo" é só rodar com atraso de poucos minutos.

### Provedor de IA (plugável, escolhido em Ajustes)
1. **Local (padrão grátis):** Ollama com um modelo pequeno. Viabilidade na RX 7600 com 8 GB a testar.
2. **API barata:** Gemini Flash-Lite (o ClipFinder gasta ~US$ 0,01 por live de 7 h); OpenAI e Claude como alternativas.
3. **Assinatura que você já paga (experimental):** ChatGPT Plus não inclui API. O caminho seria o Codex CLI logado com a conta ChatGPT (`codex exec`), com limites de uso da assinatura e uso fora do propósito principal dele (código). Fica como opção desligada por padrão, testada antes de confiar.

## 4. Fases

### Fase 0 — Fundação ✅ (2026-11-16)
Feito: app Electron + React + TS em `app/`; banco SQLite embutido (`node:sqlite`, sem módulo nativo) com migrações; fila de tarefas persistente com retomada, novas tentativas e limite por recurso; localizador de programas; diagnóstico do PC (placas e teste real de cada codificador); ajustes com liga/desliga e pesos; logs; aviso de disco; telas Início, Sistema e Ajustes no visual da referência; 13 testes.
Medido nesta máquina: funcionam `h264_amf`, `hevc_amf`, `av1_amf`, `h264_mf`, `libx264`, `libx265` (o ffmpeg atual não traz `libsvtav1`). O whisper.cpp copiado é a versão de processador (sem Vulkan): trocar na fase 1.

Lista original:
- Repositório, Electron + React + TS, tema, estrutura de pastas.
- Ajustes com liga/desliga e pesos; localizador de programas (ffmpeg, yt-dlp, streamlink, whisper).
- Banco SQLite, fila de jobs com retomada, logs, aviso de espaço em disco.

### Fase 1 — Gravar e clipar (primeira versão útil)

**Etapa 1a — gravador (2026-11-16, testado com lives reais):** cadastro de canais Twitch/Kick (nome ou link), aviso de live sem chave (Twitch: GraphQL do site; Kick: API v2 do site, via `net.fetch` do Electron porque a Cloudflare recusa o fetch do Node com 403), gravação em pedaços com ffmpeg (`-f segment`, sem recodificar, 1080p60), retomada da mesma live ao reabrir o app, reinício automático se a conexão cair, chat da Twitch pelo IRC anônimo salvo no banco, tela Ao vivo e avatares no trilho.
**Complementos da 1a (2026-11-16):** Streamlink 8.6.3 instalado em `programas/streamlink` (SHA-256 conferido) → Twitch grava limpa (0 erros de decodificação); escolha de pasta das gravações e dos clipes (no PC do usuário: `D:\Clipador KTY\...`, para não lotar o SSD); limite de espaço com "apagar as mais antigas" ou "parar de gravar" (nunca mexe na live em andamento; pausa também se o disco tiver menos de 2 GB); qualidade "Máxima" que pega 4K/2K quando a live oferece, mais tetos de 2160p a 480p; na Kick a resolução é escolhida lendo a playlist mestre; resolução real mostrada no cartão.
**Etapa 1b — importar VOD (2026-11-16, testado):** tela "Gravações" com importação por link (Twitch `twitch.tv/videos/…`, Kick `kick.com/<canal>/videos/…`), trecho opcional (início/fim), mesma estrutura das lives (pedaços + chat com horário real), tarefa na fila com progresso, cancelar, tentar de novo continuando de onde parou, apagar (arquivos e banco). Chat do VOD da Twitch baixado por tempo; Kick sem chat (1c). Biblioteca lista lives gravadas e VODs; parar de vigiar um canal não apaga as gravações dele.
**Etapa 1c — detectores rápidos (2026-11-16, testado com VODs reais):** volume por segundo de cada pedaço (só o áudio é decodificado), blocos de 5 s com chat (mensagens, pessoas, risadas em vários idiomas, hype, emotes) e áudio, "normal" local (mediana de ±10 min), áudio também comparado ao minuto em volta (pico × trecho alto), atraso do chat, fusão probabilística com os pesos dos Ajustes, nota 0–100 explicada, limite por hora, miniatura do lance, tela "Momentos" com gráfico de hype e filtros, sensibilidade nos Ajustes. Detecção roda sozinha: VOD importado, a cada ~5 min de gravação e no fim da live. Chat da Kick (ao vivo e VOD) pelo histórico do site.
**Etapa 1d — fala e IA (2026-11-16, parte testada):** transcrição de tudo com whisper.cpp (CPU, modelo base, ~28× tempo real nesta máquina; palavra por palavra com horário, guardada em `speech_words`), modelos em `D:\Clipador KTY\modelos`, comando de voz ("clipa isso", "clip that"… editável) que vira momento dos 30 s anteriores, revisão por IA (Gemini, JSON com formato fixo, lotes de 8, título PT/EN, categoria, motivo, hashtags, nota combinada 40/60, reaproveita análise já feita), chave guardada criptografada pelo Windows. Testado com VOD real em português. IA testada com a chave do usuário (`gemini-3.5-flash-lite`): títulos, categorias e descartes coerentes. Correções: Whisper com `-mc 0` (acabou o loop de frase repetida) e nova tentativa em erro 503 do Gemini. Velocidade real do Whisper base em CPU com fala contínua: ~4,5× tempo real. IA local, OpenAI, Claude e Codex marcados "em breve".
**Clipes da comunidade (2026-11-16):** clipes feitos pelos espectadores (Twitch e Kick) viram sinal forte; com eles a IA não veta (ela não vê a tela). Avisos do Windows quando algo termina.
**Etapa 1e — clipes verticais com legenda (2026-11-16, testado com os VODs do spkclb):**
- **Layouts:** jogo + facecam (facecam marcada uma vez por canal, arrastando um retângulo num quadro da live), tela inteira com fundo desfocado, recorte do centro (posição ajustável) e horizontal 16:9. Sem facecam, "jogo + facecam" sai em tela inteira.
- **Texto na tela:** legenda palavra a palavra do Whisper (a palavra falada em destaque; cor, tamanho, palavras por vez e maiúsculas nos Ajustes) e título da IA numa caixa branca (PT ou EN).
- **Trecho:** margem antes e depois e duração máxima, cortando em volta do pico; o clipe pode juntar dois pedaços gravados.
- **Som e codificação:** volume normalizado (−14 LUFS). Qualidade Rápido 720p30, Equilibrado 1080p60, Máxima 1440p (4K se a fonte for 4K). Codificador escolhido pelo teste da máquina; se a placa falhar, refaz no processador.
- **Janela "Gerar clipe":** prévia de um quadro com o layout, a legenda e o título.
- **Clipes automáticos:** depois da detecção, os momentos com nota ≥ 60 viram clipe sozinhos (espera o título da IA; os que ela descartou ficam de fora, menos os clipados pela comunidade).
- **Saída:** clipes no D: (`clipes/<canal>/`) com um `.txt` de títulos, hashtags e créditos. Player dentro do app, que pula para qualquer ponto.
- **Proteção:** momento com clipe fica guardado e não some quando a detecção roda de novo.
- **Medido:** clipe de 60 s em 1080×1920 gerado em ~20 s com `h264_amf`, 59,94 fps, −14,2 LUFS.

**Etapa 1f — fila de aprovação e telas novas (2026-11-16, aprovada pelo usuário em 2026-11-17; falta a exportação):**
- **Revisão:** cada clipe fica "para revisar", "aprovado" ou "descartado". Aprovar e descartar no player e nos cartões; os descartados podem ser restaurados ou apagados. Um clipe por momento: gerar de novo substitui o anterior.
- **Telas:** 4 abas (Início, Clipes, Canais, Ajustes) no lugar das 7 antigas, com menu lateral que muda conforme a aba. O Início mostra saudação, clipes para revisar, o que está rodando, canais e atalhos, mais as páginas Atividade e Primeiros passos. A busca no topo filtra os clipes.
- **Perfis:** cada perfil guarda os próprios ajustes; pastas, programas e desempenho são da máquina e valem para todos. Exportar e importar em `.clipador.json`. Só no PC (sem login na nuvem).
- **Falta:** a exportação para pasta (item 6 abaixo), a definir. Ainda não testados: restaurar e apagar os descartados, descartar momento.

**Qualquer live e várias ao mesmo tempo (2026-11-17, testado com 4 lives reais):**
- **Categoria ao longo da live:** cada troca de categoria fica anotada com o horário (tabela `live_games`). Em VOD da Twitch, vem dos capítulos (ex.: just volleyball → Just Chatting → Parasite Eve). Cada momento e cada clipe mostram a categoria do instante em que aconteceram.
- **Modalidades:** a categoria vira jogo, conversa, IRL, esporte ou criativo. A IA recebe a categoria de cada momento e julga conforme a modalidade: em conversa, a fala é o conteúdo e não é descartada por ser conversa. Nada no pedido da IA fala em GTA.
- **Segundo plano:** o PC não suspende sozinho enquanto há gravação ou tarefa rodando. Fechar a janela deixa o app na bandeja, gravando. Opção de abrir com o Windows, direto na bandeja (desligada por padrão). Só uma cópia do app: abrir de novo só mostra a janela. Suspender o PC à mão ainda para a gravação.
- **Whisper com várias lives:** no automático, os núcleos livres são divididos entre as detecções que rodam juntas.
- **Teste de carga (Ryzen 7 5700X, 16 threads):** 4 lives brasileiras ao mesmo tempo por 32 min (Just Chatting, GTA V, Counter-Strike e IRL), em qualidade Máxima.
  - Cerca de 2,2 a 2,9 GB por hora por live.
  - Com 4 detecções rodando juntas, cada pedaço de 5 min foi analisado em 2 a 3 min: a detecção acompanha as lives sem acumular atraso.
  - A IA manteve o que cada modalidade tem de bom (história no Just Chatting, perrengue no IRL, clutch no CS) e gerou 3 clipes sozinha.
  - O uso de CPU não foi medido: os contadores do Windows desta máquina voltaram vazios.
- **Corrigido com o teste:**
  - Duas detecções da mesma live rodavam juntas quando ela acabava no meio de uma; agora a fila tem chave por live e a segunda espera.
  - Apagar uma live durante a detecção dava "Permission denied"; agora cancela a detecção e os clipes dela na fila, espera soltar os arquivos e apaga.
  - Busca de clipes da comunidade quebrava quando a Twitch devolvia "service error"; agora vira um aviso legível.
- **Limite de disco:** 180 GB para as gravações no PC do usuário, apagando as mais antigas.
Ideias para depois: IA lendo a transcrição inteira; Whisper na placa (Vulkan).
Descobertas: a Twitch costura anúncios no vídeo (fMP4 com `EXT-X-DISCONTINUITY`/`EXT-X-MAP` de outro codificador) e o ffmpeg direto corrompe todos os quadros → **Twitch exige Streamlink** (`--twitch-disable-ads`); a Kick grava limpa só com ffmpeg. O chat da Kick mudou para credenciais vindas do servidor (Pusher/Centrifugo) → fica para a 1c.

1. **Gravador primeiro:** cadastrar canais Twitch/Kick, detectar "ao vivo", gravar vídeo + chat. Assim o material do lançamento não se perde enquanto o resto é feito.
2. Importar VOD por link (para testar e reprocessar).
3. Detectores: picos de chat, áudio (volume, risada), fala (Whisper), gatilhos de voz, IA de texto (título, motivo, nota).
4. Fusão com nota 0–100 explicada; corte com margem antes do pico.
5. Gerador vertical: layouts (jogo + facecam, tela cheia), legenda palavra a palavra PT/EN, título e hashtags no idioma do canal.
6. Fila de aprovação ✅ e exportação para pasta (falta).

### Fase 2 — Publicar e aprender
- Postagem no YouTube (API oficial, OAuth); TikTok pela API de postagem (contas não auditadas podem ficar limitadas a privado: verificar). Agendamento e limite diário.
- Coleta de métricas e ajuste dos pesos por canal.
- Busca por descrição e por palavra.

### Fase 3 — Diferenciais
- Clipar ao vivo com atraso de poucos minutos.
- Perfis de tela por jogo (o GTA 6 é o primeiro, depois do lançamento): juntar quadros, marcar eventos (morte, polícia, explosão, gol, vitória) e treinar ou usar IA de visão.
- Padrões por modalidade: duração, layout e pesos dos detectores próprios para jogo, conversa, IRL, esporte e criativo (a modalidade já é reconhecida pela categoria).
- Cruzamento entre streamers (mesmo evento em várias lives).
- Vídeo longo automático com os melhores momentos.

### Fase 4 — Para os amigos
- Instalador, atualização automática, assistente de primeira execução, guia curto.

## 4.1 Linguagens e tecnologias

| Camada | Escolha | Por quê |
|---|---|---|
| Linguagem principal | **TypeScript** (modo estrito) | Uma linguagem só para tela e lógica; erros pegos antes de rodar |
| App desktop | Electron + electron-vite | Já funciona nesta máquina (yt-dlp Studio) |
| Telas | React + Tailwind CSS + lucide-react | Rápido de montar o visual da referência |
| Banco | SQLite (`better-sqlite3`) | Arquivo local, sem servidor, aguenta milhões de linhas |
| Vídeo | ffmpeg/ffprobe (binários) | Corte, vertical, legenda, codificação na placa AMD (`h264_amf`/`hevc_amf`) |
| Gravação | streamlink e yt-dlp (binários) | Gravam a live em qualidade original |
| Transcrição | whisper.cpp (binário, Vulkan) | Usa a RX 7600; sem Python |
| IA de visão | ONNX Runtime para Node com DirectML (fase 3) | Roda modelos na placa AMD sem Python (a testar); Python só se faltar alguma biblioteca |
| IA de texto | Provedor plugável (Ollama, Gemini, OpenAI, Claude, Codex) | Escolha em Ajustes |
| Testes | Vitest (lógica) + Playwright (app real) | Ver 4.2 |
| Qualidade do código | ESLint + Prettier + checagem de tipos | Padrão único |

Linguagens no total: TypeScript (quase tudo), SQL (consultas), e programas externos prontos (C/C++). Sem Rust e, se der, sem Python.

## 4.2 Qualidade

### Qualidade do vídeo
- **Gravar na fonte** ("source", normalmente 1080p60) sem recodificar: os segmentos são copiados como vêm da plataforma.
- **Codificar uma única vez**, só no clipe final, com taxa alta (as plataformas recomprimem; mandar com folga evita borrão).
- **Problema do vertical:** recortar 9:16 de um vídeo 1920×1080 dá só ~608×1080 de imagem. Soluções, à escolha por layout:
  1. Layout dividido (jogo largo em cima, facecam embaixo) — mostra mais imagem e precisa de menos ampliação.
  2. Fundo desfocado do próprio vídeo atrás do jogo inteiro.
  3. Ampliação com bom filtro (lanczos) ou por placa AMD (`sr_amf`), e IA (Real-ESRGAN) opcional para clipes escolhidos, porque é lenta.
- **60 fps mantidos** quando a fonte tem.
- **Legenda nítida:** desenhada por ffmpeg/libass (texto vetorial), não como imagem ampliada.
- **Som:** volume normalizado (padrão de ~-14 LUFS das redes) e sem estouro.
- **Prévia antes de exportar** e comparação lado a lado com a fonte.

### Opções de qualidade (em Ajustes e por clipe)
- Predefinições: **Rápido** (prévia e teste), **Equilibrado** (padrão para postar), **Máxima** (clipe escolhido, sem pressa).
- Modo manual: resolução (720p, 1080p, 1440p, 4K vertical), fps (30/60), taxa de bits ou qualidade constante, codec (H.264, H.265, AV1), método de ampliação (lanczos, placa, IA), layout.
- Predefinições salvas por canal de destino (ex.: TikTok e Shorts com perfis diferentes).

### Alternativas de processamento (o app detecta o que cada PC tem)
Cada amigo pode ter uma placa diferente; o app testa cada opção com um vídeo de 0,1 s (como no yt-dlp Studio) e mostra só as que funcionam.

| Tipo | Opções | Observação |
|---|---|---|
| Placa AMD | `h264_amf`, `hevc_amf`, `av1_amf` | RX 7600 tem AV1 por hardware (a confirmar no teste) |
| Placa NVIDIA | `h264_nvenc`, `hevc_nvenc`, `av1_nvenc` | Para amigos com NVIDIA |
| Intel | `h264_qsv`, `hevc_qsv`, `av1_qsv` | Gráficos Intel e Arc |
| Windows genérico | `h264_mf` | Usa o que o Windows oferecer |
| Processador | `libx264`, `libx265`, `libsvtav1` | Mais lento, melhor qualidade por tamanho; ideal no modo Máxima |

Transcrição também com alternativas: whisper.cpp com Vulkan (AMD/Intel), CUDA (NVIDIA) ou processador; tamanho do modelo escolhível (mais rápido x mais preciso).

### Custo das IAs de texto
| Provedor | Custo | Observação |
|---|---|---|
| Local (Ollama) | Grátis | Usa o PC; qualidade depende do modelo que couber na placa |
| Gemini API | Tem nível grátis com limites; pago custa centavos por live | No nível grátis o Google pode usar os dados para melhorar produtos (conferir termos atuais) |
| OpenAI API | Pago por uso | Separado do ChatGPT Plus |
| Claude API | Pago por uso | Separado de assinaturas do Claude |
| ChatGPT via Codex CLI | Sem custo extra (usa o Plus) | Experimental; sujeito aos limites da assinatura |

Padrão sugerido: Gemini no nível grátis, com Local como alternativa sem internet. Preços e limites mudam; o app mostra o gasto estimado por live.

### Modo "custo zero" (padrão)
Todo o caminho funciona sem pagar nada:
- Gravação, chat, ffmpeg, whisper.cpp, banco: grátis e locais.
- Detecção de live: API da Twitch (Client ID grátis); Kick a confirmar.
- Postagem no YouTube: API oficial com cota diária grátis.
- IA de texto: **Local** ou **Gemini nível grátis**, cada amigo com a própria chave. O app usa a IA só nas janelas candidatas (o ClipFinder fez ~12 momentos de uma live de 7 h com ~28 mil tokens), o que cabe com folga em limites de algumas centenas de pedidos por dia. Se a cota acabar, o app cai para Local sozinho.
- Provedores pagos ficam desligados até alguém ligar em Ajustes.

**Decisão (2026-11-16, usuário):** padrão = **Gemini nível grátis**; Local como alternativa. A troca é sempre uma escolha em Ajustes (o app só sugere; cair para Local quando a cota acaba também é uma opção que pode ser desligada).

| | Gemini grátis | Local |
|---|---|---|
| Qualidade de entendimento | Maior (modelo grande; gírias, PT e EN) | Menor, depende do modelo que cabe na placa |
| Velocidade | Rápida, não usa o PC | Mais lenta; divide a placa com Whisper e ffmpeg |
| Internet | Precisa | Não precisa |
| Limite | Cota diária | Sem limite |
| Privacidade | Google pode usar os textos para melhorar produtos | Nada sai do PC |
| Instalação | Só uma chave grátis | Baixar modelo de alguns GB |
| Imagem (fase 3) | Aceita quadros do jogo | Precisaria de modelo de visão local |

### IA local no PC dos amigos
- Roda em qualquer PC com Windows; a velocidade depende da placa.
- O app mede a máquina e escolhe o modelo: placa com 8 GB ou mais usa um modelo médio; placa menor ou sem placa usa um modelo pequeno (mais lento no processador).
- A tarefa da IA aqui é leve (ler trechos curtos da transcrição e do chat, dar título, nota e motivo), então modelos pequenos dão conta; a qualidade será medida contra as lives de teste.
- Se o PC for fraco demais, a opção é o Gemini grátis.

### ChatGPT Plus via Codex CLI (a estudar melhor)
O que se sabe (fontes de terceiros e ajuda da OpenAI; conferir antes de usar):
- `codex login` entra com a conta ChatGPT; `codex exec` roda sem tela e reaproveita esse login.
- O limite do Plus é contado numa janela móvel de 5 h e é **dividido** com o uso do Codex no site e no editor.
- Guias recomendam login ChatGPT para uso interativo e chave de API para automação; não achamos regra oficial clara sobre automação com o login ChatGPT.
- Há relato de erro de "limite atingido" com cota disponível.
Plano: protótipo isolado na fase 1 medindo quantos pedidos uma live consome e se o limite atrapalha seu uso normal do Codex; só vira opção se passar.

### Qualidade da detecção
- Cada aprovação ou rejeição na fila vira um exemplo marcado (bom/ruim).
- Conjunto de lives de teste com os momentos marcados à mão; toda mudança nos detectores é medida contra ele (quantos momentos bons achou, quantos ruins trouxe).
- A nota mostra por que o clipe foi escolhido, para dar para corrigir os pesos.

### Qualidade do código e do app
- TypeScript estrito, lint e formatação automáticos.
- Testes da lógica (detectores, fusão, cortes) com arquivos pequenos de exemplo.
- Testes do app real abrindo a janela (como foi feito no yt-dlp Studio via CDP).
- Logs por tarefa, tela de erros e "tentar de novo" por segmento.
- Git desde o primeiro dia, com commits pequenos.

## 5. Riscos conhecidos
- **Disco:** 6 h de live em 1080p60 podem passar de 10 GB. Gravar em qualidade configurável e apagar depois de processar.
- **APIs não oficiais** (chat da Kick): podem quebrar; ficam isoladas em módulos.
- **HUD do GTA 6** só existe depois do lançamento; detecção de tela fica para a fase 3.
- **Velocidade do Whisper na placa AMD:** medir na fase 0.
- **Limites de postagem** das plataformas; respeitar para não perder o canal.

## 5.1 Lives muito longas (8–12 h) sem travar

Queixa comum na comunidade: ferramentas travam ou recusam lives longas (o ClipFinder limita a 5 h por vídeo e o dono recomenda dividir uma VOD de 10 h). Regras do Clipador KTY:

1. **Nunca existe "um vídeo de 10 h" para processar.** A gravação já nasce em segmentos de ~5 min; cada segmento é uma tarefa pequena e independente.
2. **Processar durante a live.** Cada segmento é analisado assim que fecha; quando a live termina, quase tudo já foi feito.
3. **Sobreposição entre segmentos** (~30 s) para não cortar um momento ao meio; momentos repetidos na emenda são unidos.
4. **Ponto de retomada.** O estado de cada segmento e de cada detector fica no SQLite; se o app ou o PC fechar, continua de onde parou, sem refazer o que já terminou.
5. **Cada etapa num processo filho** (ffmpeg, whisper, visão), com limite de memória e tempo. Se um processo cair, só aquele segmento é refeito; o app não fecha.
6. **Nada carregado inteiro na memória.** Áudio extraído uma vez por segmento; chat processado em fluxo; vídeo lido por streaming.
7. **Trabalho caro só onde importa.** Chat e volume (baratos) rodam em tudo; Whisper pula silêncio (VAD); IA de texto e de visão só recebem janelas candidatas, não a live inteira. Resumo da live em duas etapas (por hora, depois o todo), para não estourar o limite de contexto da IA.
8. **Visão em cópia leve.** Detecção de tela usa uma versão reduzida (ex.: 480p, 2–4 quadros/s); o corte final sai da gravação original.
9. **Corte direto dos segmentos.** O clipe junta só os pedaços necessários, sem reprocessar a live.
10. **Fila com limite de tarefas simultâneas** ajustável. O usuário não joga nem faz live no PC do app (2026-11-16), então o padrão é usar a máquina ao máximo (placa e processador ocupados com gravação, transcrição e cortes em paralelo), com um modo "econômico" opcional.
11. **Disco vigiado.** Aviso antes de encher; apagar segmentos já processados que não viraram clipe (configurável).
12. **VOD importada por link** também é baixada e cortada em segmentos antes de qualquer análise.

Por ser local, não há limite de plano, envio de arquivo gigante nem fila de servidor compartilhada.

## 6. Visual (aprovado pelo usuário em 2026-11-17)

Estilo de uma segunda referência enviada pelo usuário (app no estilo do Creative Cloud), com acabamento de site da Apple:
- **Aparência:** vidro escuro em roxo-acinzentado, botões azuis em pílula, listas translúcidas, cantos de 16 px e bastante respiro.
- **Topo:** abas Início · Clipes · Canais · Ajustes, busca, sino de atividade e perfil no canto direito.
- **Menu lateral por aba:**
  - Início: Visão geral, Atividade, Primeiros passos e atalhos.
  - Clipes: para revisar, aprovados, descartados e cada live.
  - Canais: todos, ao vivo, biblioteca e cada canal.
  - Ajustes: detecção, IA, clipes, gravação, armazenamento, perfil e sistema.
- **Fonte:** Inter com tamanho óptico, empacotada no app. Substitui a SF Pro, que só pode ser usada em plataformas da Apple.
- **Logo própria:** `app/resources/logo.svg`, `icon.png` (ícone da janela) e `icon.ico` (para o instalador da fase 4).
- **Largura:** o conteúdo ocupa até 1680 px em tela cheia e se ajusta com a janela restaurada.

A primeira referência (2026-11-16: app escuro em vinho e magenta, com trilho de avatares e banner) foi substituída por este visual.

## 7. Estrutura de pastas (proposta)
```
Clipador KTY/
  PLANO.md
  app/                 Electron (main, preload, renderer)
    src/main/          vigia, gravador, jobs, detectores, ffmpeg
    src/renderer/      telas React
    src/shared/        tipos e utilitários
  programas/           ffmpeg, yt-dlp, streamlink, whisper (fora do git)
  dados/               banco, gravações, clipes (fora do git)
```
