import { useEffect, useState } from 'react'
import { ExternalLink, FolderOpen, KeyRound, RotateCcw } from 'lucide-react'
import { DETECTORS } from '../../../shared/settings'
import { LAYOUTS } from '../../../shared/clips'
import { FAMILY_LABEL, pickEncoder } from '../../../shared/encoders'
import type { AiProvider, AiStatus } from '../../../shared/types'
import type { AppState } from '../state'
import { Badge, Button, Card, PageHeader, Progress, Section, Segmented, Toggle } from '../ui'
import { SystemPanel } from './System'
import { ProfilePanel } from './Profile'

const PROVIDERS: { value: AiProvider; label: string; cost: string; note: string; ready: boolean }[] = [
  { value: 'gemini', label: 'Gemini', cost: 'Grátis (com cota diária)', note: 'Entende melhor fala e gírias, não pesa no PC. Padrão.', ready: true },
  { value: 'local', label: 'IA local', cost: 'Grátis', note: 'Em breve: roda no PC, sem internet e sem limite. Mais lenta.', ready: false },
  { value: 'codex', label: 'ChatGPT (Codex)', cost: 'Usa seu ChatGPT Plus', note: 'Em breve: experimental, será testado antes de liberar.', ready: false },
  { value: 'openai', label: 'OpenAI API', cost: 'Pago por uso', note: 'Em breve. Separado do ChatGPT Plus.', ready: false },
  { value: 'claude', label: 'Claude API', cost: 'Pago por uso', note: 'Em breve. Separado das assinaturas do Claude.', ready: false }
]

function NumberRow({ label, hint, unit, value, onChange }: { label: string; hint: string; unit: string; value: number; onChange: (v: number) => void }) {
  // Salva só ao sair do campo ou apertar Enter: digitar "300" não passa por "3" (que seria corrigido para o mínimo)
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const n = Number(draft)
    if (Number.isFinite(n) && n !== value) onChange(n)
    else setDraft(String(value))
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-24 rounded-xl border border-line bg-panel px-3 py-1.5 text-right text-sm outline-none focus:border-accent"
        />
        <span className="text-sm text-muted">{unit}</span>
      </div>
    </div>
  )
}

function NumberInput({ value, unit, onChange }: { value: number; unit: string; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const n = Number(draft)
    if (Number.isFinite(n) && n !== value) onChange(n)
    else setDraft(String(value))
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="w-24 rounded-xl border border-line bg-panel px-3 py-1.5 text-right text-sm outline-none focus:border-accent"
      />
      <span className="text-sm text-muted">{unit}</span>
    </div>
  )
}

function FolderRow({ label, hint, value, effective, onPick }: { label: string; hint: string; value: string; effective?: string; onPick: (p: string) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
        <p className="mt-1 truncate text-xs text-text/80" title={effective}>
          <FolderOpen size={12} className="mr-1 inline" />
          {effective ?? '…'} {!value && <span className="text-muted">(padrão)</span>}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => void window.api.pickFolder(label, effective).then((p) => p && onPick(p))}>
          Escolher…
        </Button>
        {value && (
          <Button variant="ghost" onClick={() => onPick('')}>
            Padrão
          </Button>
        )}
      </div>
    </div>
  )
}

const clean = (e: unknown) => ((e as Error).message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Frases do comando de voz, uma por linha; salva ao sair do campo. */
function TriggersRow({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState(value.join('\n'))
  useEffect(() => setDraft(value.join('\n')), [value])
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">Frases do comando de voz</p>
        <p className="text-xs text-muted">Quando o streamer fala uma destas, os 30 s anteriores viram momento. Uma por linha; sem diferença de acento ou maiúscula.</p>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onChange(draft.split('\n').map((x) => x.trim()).filter(Boolean))}
        rows={4}
        className="w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
      />
    </div>
  )
}

function GeminiKeyCard() {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => void window.api.aiStatus().then(setStatus), [])
  const save = async (k: string) => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await window.api.setGeminiKey(k))
      setKey('')
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-gold" />
          <p className="text-sm font-medium">Chave do Gemini</p>
          {status?.hasKey ? <Badge tone="ok">configurada · {status.model}</Badge> : <Badge tone="warn">sem chave</Badge>}
        </div>
        <Button variant="ghost" onClick={() => void window.api.openExternal('https://aistudio.google.com/apikey')}>
          <ExternalLink size={14} /> Criar chave grátis
        </Button>
      </div>
      <p className="text-xs text-muted">
        A chave é grátis (conta Google, no Google AI Studio). Fica guardada criptografada pelo Windows neste PC. Sem chave, os momentos aparecem sem título e sem
        revisão da IA.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={status?.hasKey ? 'Colar outra chave para trocar' : 'Colar a chave aqui'}
          className="min-w-64 flex-1 rounded-xl border border-line bg-panel px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <Button onClick={() => void save(key)} disabled={busy || !key.trim()}>
          {busy ? 'Testando…' : 'Salvar e testar'}
        </Button>
        {status?.hasKey && (
          <Button variant="ghost" onClick={() => void save('')} disabled={busy}>
            Apagar chave
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-err">{error}</p>}
    </Card>
  )
}

function SpeechCard({ state }: { state: AppState }) {
  const s = state.settings!
  const [models, setModels] = useState<{ name: string; path: string }[]>([])
  useEffect(() => void window.api.speechModels().then(setModels), [])
  const whisper = state.tools.find((t) => t.id === 'whisper')
  return (
    <Card className="space-y-4">
      <p className="text-xs text-muted">
        Transcreve tudo o que o streamer fala, com o horário de cada palavra: serve para o comando de voz, para a IA entender o momento e para as legendas. Nesta máquina
        o modelo base transcreve fala contínua cerca de 4 a 5× mais rápido que o tempo real (6 h de live em ~1h20).
      </p>
      {!whisper?.path && <p className="text-xs text-err">whisper-cli não encontrado na pasta de programas.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Modelo</p>
          <p className="text-xs text-muted">{models.length ? `Na pasta "modelos" (${models.length} encontrado(s)).` : 'Nenhum modelo encontrado na pasta "modelos".'}</p>
        </div>
        <select
          value={s.speech.model}
          onChange={(e) => void state.updateSettings({ speech: { model: e.target.value } })}
          className="rounded-xl border border-line bg-panel px-3 py-1.5 text-sm outline-none focus:border-accent"
        >
          <option value="">Automático (o mais preciso)</option>
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Idioma da fala</p>
          <p className="text-xs text-muted">Automático detecta em cada pedaço. Fixar ajuda quando o streamer mistura idiomas.</p>
        </div>
        <Segmented
          value={['auto', 'pt', 'en', 'es'].includes(s.speech.language) ? s.speech.language : 'auto'}
          onChange={(v) => void state.updateSettings({ speech: { language: v } })}
          options={[
            { value: 'auto', label: 'Automático' },
            { value: 'pt', label: 'Português' },
            { value: 'en', label: 'Inglês' },
            { value: 'es', label: 'Espanhol' }
          ]}
        />
      </div>
    </Card>
  )
}

export type SettingsTab = 'deteccao' | 'ia' | 'clipes' | 'gravacao' | 'armazenamento' | 'perfil' | 'sistema'

const TITLES: Record<SettingsTab, { title: string; subtitle: string }> = {
  deteccao: { title: 'Detecção', subtitle: 'Quais sinais viram momento e com que força.' },
  ia: { title: 'IA e fala', subtitle: 'Transcrição com o Whisper e revisão dos momentos pela IA.' },
  clipes: { title: 'Clipes', subtitle: 'Layout, legenda, título, duração e qualidade dos clipes.' },
  gravacao: { title: 'Gravação', subtitle: 'Como as lives são vigiadas e gravadas.' },
  armazenamento: { title: 'Armazenamento', subtitle: 'Onde ficam as gravações e os clipes, e o limite de espaço.' },
  perfil: { title: 'Perfil', subtitle: 'Cada perfil guarda os próprios ajustes e predefinições.' },
  sistema: { title: 'Sistema', subtitle: 'Desempenho, avisos, programas, placa de vídeo e registro.' }
}

export default function SettingsPage({ state, tab }: { state: AppState; tab: SettingsTab }) {
  const { settings: s, updateSettings, resetSettings, hardware, disk, refreshDisk } = state
  if (!s) return null
  const working = hardware?.encoders.filter((e) => e.works) ?? []
  const auto = hardware ? pickEncoder(hardware.encoders, '', s.quality.preset) : null

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-8">
      <PageHeader
        title={TITLES[tab].title}
        subtitle={TITLES[tab].subtitle}
        action={
          tab !== 'perfil' && tab !== 'sistema' ? (
            <Button variant="ghost" onClick={() => confirm('Voltar todos os ajustes deste perfil para o padrão? Pastas e programas ficam.') && void resetSettings()}>
              <RotateCcw size={13} /> Restaurar padrão
            </Button>
          ) : undefined
        }
      />

      {tab === 'perfil' && <ProfilePanel state={state} />}

      {tab === 'deteccao' && (
        <>
      <Section title="Detectores de momentos">
        <p className="-mt-1 text-xs text-muted">Ligue ou desligue cada sinal e ajuste quanto ele pesa na nota final.</p>
        <div className="space-y-2">
          {DETECTORS.filter((d) => d.phase <= 1).map((d) => {
            const cfg = s.detectors[d.id]
            const later = d.phase > 1
            return (
              <Card key={d.id} className="flex items-center gap-4">
                <Toggle label={d.label} checked={cfg.enabled} disabled={later} onChange={(v) => void updateSettings({ detectors: { [d.id]: { enabled: v } } })} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{d.label}</span>
                    {later && <Badge tone="muted">fase {d.phase}</Badge>}
                  </div>
                  <p className="text-xs text-muted">{d.description}</p>
                </div>
                <div className="flex w-44 items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(cfg.weight * 100)}
                    disabled={!cfg.enabled || later}
                    onChange={(e) => void updateSettings({ detectors: { [d.id]: { weight: Number(e.target.value) / 100 } } })}
                    className="w-full disabled:opacity-40"
                    aria-label={`Peso de ${d.label}`}
                  />
                  <span className="w-9 text-right text-xs tabular-nums text-muted">{Math.round(cfg.weight * 100)}%</span>
                </div>
              </Card>
            )
          })}
        </div>
      </Section>

      <Section title="Sensibilidade">
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Nota mínima para virar momento</p>
              <p className="text-xs text-muted">Mais baixa: mais momentos (inclusive fracos). Mais alta: só os melhores.</p>
            </div>
            <div className="flex w-72 items-center gap-2 text-xs text-muted">
              <span>mais</span>
              <input
                type="range"
                min={10}
                max={80}
                value={s.detection.minScore}
                onChange={(e) => void updateSettings({ detection: { minScore: Number(e.target.value) } })}
                className="w-full"
                aria-label="Nota mínima"
              />
              <span>melhores</span>
              <span className="w-8 text-right tabular-nums text-text">{s.detection.minScore}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Máximo de momentos por hora de live</p>
              <p className="text-xs text-muted">Evita encher a fila em lives muito agitadas; ficam os de nota mais alta.</p>
            </div>
            <NumberInput value={s.detection.maxPerHour} unit="por hora" onChange={(v) => void updateSettings({ detection: { maxPerHour: v } })} />
          </div>
          <TriggersRow value={s.detection.voiceTriggers} onChange={(v) => void updateSettings({ detection: { voiceTriggers: v } })} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Atraso do chat</p>
              <p className="text-xs text-muted">Quantos segundos o chat costuma reagir depois do lance; o momento é puxado esse tanto para trás.</p>
            </div>
            <NumberInput value={s.detection.chatLagS} unit="s" onChange={(v) => void updateSettings({ detection: { chatLagS: v } })} />
          </div>
        </Card>
      </Section>

        </>
      )}

      {tab === 'ia' && (
        <>
      <Section title="Fala (Whisper)">
        <SpeechCard state={state} />
      </Section>

      <Section title="Inteligência artificial">
        <div className="grid gap-2 md:grid-cols-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.value}
              type="button"
              disabled={!p.ready}
              onClick={() => void updateSettings({ ai: { provider: p.value } })}
              className="text-left disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Card className={s.ai.provider === p.value ? 'border-accent bg-accent/10' : 'transition hover:border-accent/50'}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{p.label}</span>
                  <Badge tone={p.cost.startsWith('Grátis') ? 'ok' : p.cost.startsWith('Pago') ? 'warn' : 'accent'}>{p.cost}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">{p.note}</p>
              </Card>
            </button>
          ))}
        </div>
        {s.ai.provider === 'gemini' && <GeminiKeyCard />}
        <Card className="flex items-center gap-4">
          <Toggle label="Usar IA local quando a cota acabar" checked={s.ai.fallbackToLocal} onChange={(v) => void updateSettings({ ai: { fallbackToLocal: v } })} />
          <div>
            <p className="text-sm font-medium">Usar a IA local quando a cota do provedor acabar</p>
            <p className="text-xs text-muted">Vale quando a IA local estiver pronta. Por enquanto o app espera a cota voltar e revisa o que faltou depois.</p>
          </div>
        </Card>
      </Section>

        </>
      )}

      {tab === 'clipes' && (
        <>
      <Section title="Qualidade do vídeo">
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Predefinição</p>
              <p className="text-xs text-muted">Rápido para testar, Equilibrado para postar, Máxima para o clipe escolhido.</p>
            </div>
            <Segmented
              value={s.quality.preset}
              onChange={(v) => void updateSettings({ quality: { preset: v } })}
              options={[
                { value: 'fast', label: 'Rápido' },
                { value: 'balanced', label: 'Equilibrado' },
                { value: 'max', label: 'Máxima' }
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Codificador</p>
              <p className="text-xs text-muted">Só aparecem os que passaram no teste desta máquina. Automático agora: {auto ?? 'nenhum'}.</p>
            </div>
            <select
              value={s.quality.encoder}
              onChange={(e) => void updateSettings({ quality: { encoder: e.target.value } })}
              className="rounded-xl border border-line bg-panel px-3 py-1.5 text-sm outline-none focus:border-accent"
            >
              <option value="">Automático</option>
              {working.map((e) => (
                <option key={e.name} value={e.name}>
                  {FAMILY_LABEL[e.family]} · {e.codec.toUpperCase()} ({e.name})
                </option>
              ))}
            </select>
          </div>
        </Card>
      </Section>

      <Section title="Clipes">
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Layout padrão</p>
              <p className="text-xs text-muted">Jogo + facecam precisa da facecam marcada no canal (na janela "Gerar clipe"); sem ela sai em tela inteira.</p>
            </div>
            <Segmented
              value={s.clips.layout}
              onChange={(v) => void updateSettings({ clips: { layout: v } })}
              options={LAYOUTS.map((l) => ({ value: l.id, label: l.label, hint: l.hint }))}
            />
          </div>
          <div className="flex items-center gap-4">
            <Toggle label="Gerar clipes sozinho" checked={s.clips.auto.enabled} onChange={(v) => void updateSettings({ clips: { auto: { enabled: v } } })} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Gerar sozinho os clipes dos momentos fortes</p>
              <p className="text-xs text-muted">
                Depois de cada detecção, os momentos com nota a partir do valor ao lado viram clipe com o layout padrão. Com a IA ligada, espera o título dela;
                os que ela descartou ficam de fora (menos os clipados pela comunidade).
              </p>
            </div>
            <NumberInput value={s.clips.auto.minScore} unit="nota" onChange={(v) => void updateSettings({ clips: { auto: { minScore: v } } })} />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="mb-1 text-sm font-medium">Margem antes</p>
              <NumberInput value={s.clips.padBeforeS} unit="s" onChange={(v) => void updateSettings({ clips: { padBeforeS: v } })} />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Margem depois</p>
              <NumberInput value={s.clips.padAfterS} unit="s" onChange={(v) => void updateSettings({ clips: { padAfterS: v } })} />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Duração máxima</p>
              <NumberInput value={s.clips.maxDurationS} unit="s" onChange={(v) => void updateSettings({ clips: { maxDurationS: v } })} />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted">Momento mais longo que o máximo é cortado em volta do pico (mais tempo antes do que depois). Shorts aceita até 60 s.</p>
        </Card>
        <Card className="space-y-4">
          <div className="flex items-center gap-4">
            <Toggle label="Legenda" checked={s.clips.captions.enabled} onChange={(v) => void updateSettings({ clips: { captions: { enabled: v } } })} />
            <div>
              <p className="text-sm font-medium">Legenda palavra a palavra</p>
              <p className="text-xs text-muted">Usa a transcrição do Whisper; a palavra falada aparece em destaque.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">Palavras por vez na tela</p>
            <NumberInput value={s.clips.captions.words} unit="palavras" onChange={(v) => void updateSettings({ clips: { captions: { words: v } } })} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">Tamanho da letra</p>
            <div className="flex w-72 items-center gap-2">
              <input
                type="range"
                min={4}
                max={12}
                step={0.5}
                value={s.clips.captions.sizePct}
                onChange={(e) => void updateSettings({ clips: { captions: { sizePct: Number(e.target.value) } } })}
                className="w-full"
                aria-label="Tamanho da legenda"
              />
              <span className="w-10 text-right text-xs tabular-nums text-muted">{s.clips.captions.sizePct}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">Cor da palavra falada</p>
            <div className="flex items-center gap-2">
              {['#ffd400', '#3ddc97', '#ff3d8b', '#4cc9f0', '#ffffff'].map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Cor ${c}`}
                  onClick={() => void updateSettings({ clips: { captions: { color: c } } })}
                  className={`size-7 rounded-full border-2 ${s.clips.captions.color === c ? 'border-white' : 'border-transparent'}`}
                  style={{ background: c }}
                />
              ))}
              <input
                type="color"
                value={s.clips.captions.color}
                onChange={(e) => void updateSettings({ clips: { captions: { color: e.target.value } } })}
                className="size-7 cursor-pointer rounded-full border-0 bg-transparent"
                aria-label="Outra cor"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Toggle label="Maiúsculas" checked={s.clips.captions.upper} onChange={(v) => void updateSettings({ clips: { captions: { upper: v } } })} />
            <p className="text-sm font-medium">Legenda em MAIÚSCULAS</p>
          </div>
        </Card>
        <Card className="flex flex-wrap items-center gap-4">
          <Toggle label="Título na tela" checked={s.clips.title.enabled} onChange={(v) => void updateSettings({ clips: { title: { enabled: v } } })} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Título da IA na tela</p>
            <p className="text-xs text-muted">Numa caixa branca: o clipe todo no layout de tela inteira, os 4 primeiros segundos nos outros.</p>
          </div>
          <Segmented
            value={s.clips.title.lang}
            onChange={(v) => void updateSettings({ clips: { title: { lang: v } } })}
            options={[
              { value: 'pt', label: 'Português' },
              { value: 'en', label: 'Inglês' }
            ]}
          />
        </Card>
      </Section>

        </>
      )}

      {tab === 'gravacao' && (
        <>
      <Section title="Gravador">
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Qualidade da gravação</p>
              <p className="text-xs text-muted">
                Grava como vem da plataforma, sem recomprimir. "Máxima" pega a maior que a live oferecer (4K, 2K, 1080p…); os números são um teto, para economizar
                disco. 4K ocupa umas 3 a 4 vezes mais que 1080p.
              </p>
            </div>
            <Segmented
              value={s.recorder.quality}
              onChange={(v) => void updateSettings({ recorder: { quality: v } })}
              options={[
                { value: 'best', label: 'Máxima', hint: 'A maior disponível, inclusive 4K e 2K' },
                { value: '2160', label: 'até 4K' },
                { value: '1440', label: 'até 2K' },
                { value: '1080', label: 'até 1080p' },
                { value: '720', label: 'até 720p' },
                { value: '480', label: 'até 480p' }
              ]}
            />
          </div>
          <NumberRow
            label="Verificar os canais a cada"
            hint="Menos tempo = começa a gravar mais rápido quando a live abre."
            unit="s"
            value={s.recorder.pollSeconds}
            onChange={(v) => void updateSettings({ recorder: { pollSeconds: v } })}
          />
          <NumberRow
            label="Duração de cada pedaço"
            hint="Pedaços menores são processados mais cedo; o padrão é 5 min (300 s)."
            unit="s"
            value={s.recorder.segmentSeconds}
            onChange={(v) => void updateSettings({ recorder: { segmentSeconds: v } })}
          />
          <NumberRow
            label="Esperar antes de encerrar"
            hint="Se a live cair e voltar dentro deste tempo, continua na mesma gravação."
            unit="s"
            value={s.recorder.offlineGraceSeconds}
            onChange={(v) => void updateSettings({ recorder: { offlineGraceSeconds: v } })}
          />
          <div className="flex items-center gap-4">
            <Toggle label="Gravar chat" checked={s.recorder.recordChat} onChange={(v) => void updateSettings({ recorder: { recordChat: v } })} />
            <div>
              <p className="text-sm font-medium">Gravar o chat</p>
              <p className="text-xs text-muted">Necessário para o detector de picos de chat (Twitch e Kick, ao vivo e em VODs).</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Toggle label="Gravar reprises" checked={s.recorder.recordReruns} onChange={(v) => void updateSettings({ recorder: { recordReruns: v } })} />
            <div>
              <p className="text-sm font-medium">Gravar reprises</p>
              <p className="text-xs text-muted">Reprises (rerun) costumam repetir conteúdo já clipado.</p>
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Segundo plano">
        <Card className="space-y-4">
          <div className="flex items-center gap-4">
            <Toggle label="Não deixar o PC suspender" checked={s.background.keepAwake} onChange={(v) => void updateSettings({ background: { keepAwake: v } })} />
            <div>
              <p className="text-sm font-medium">Não deixar o PC suspender enquanto grava</p>
              <p className="text-xs text-muted">Vale enquanto houver live gravando ou tarefa rodando. A tela ainda pode apagar; depois o PC volta a suspender normalmente.</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Toggle label="Fechar para a bandeja" checked={s.background.closeToTray} onChange={(v) => void updateSettings({ background: { closeToTray: v } })} />
            <div>
              <p className="text-sm font-medium">Fechar a janela deixa o app na bandeja</p>
              <p className="text-xs text-muted">Continua vigiando e gravando perto do relógio. Para fechar de vez: botão direito no ícone &gt; Sair.</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Toggle label="Abrir com o Windows" checked={s.background.openAtLogin} onChange={(v) => void updateSettings({ background: { openAtLogin: v } })} />
            <div>
              <p className="text-sm font-medium">Abrir junto com o Windows</p>
              <p className="text-xs text-muted">Começa escondido na bandeja; se o PC reiniciar de madrugada, as gravações voltam sozinhas.</p>
            </div>
          </div>
        </Card>
      </Section>

        </>
      )}

      {tab === 'sistema' && (
        <>
      <Section title="Desempenho">
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Uso da máquina</p>
            <p className="text-xs text-muted">Máximo: usa placa e processador por inteiro. Econômico: uma tarefa pesada por vez.</p>
          </div>
          <Segmented
            value={s.performance.mode}
            onChange={(v) => void updateSettings({ performance: { mode: v } })}
            options={[
              { value: 'max', label: 'Máximo' },
              { value: 'eco', label: 'Econômico' }
            ]}
          />
        </Card>
      </Section>

        </>
      )}

      {tab === 'armazenamento' && (
        <>
      <Section title="Armazenamento">
        <Card className="space-y-4">
          <FolderRow
            label="Pasta das gravações"
            hint="Onde as lives são salvas. Pode ser outro disco (HD grande). As gravações antigas continuam onde estavam."
            value={s.storage.recordingsDir}
            effective={disk?.recordingsDir}
            onPick={(p) => void updateSettings({ storage: { recordingsDir: p } }).then(refreshDisk)}
          />
          <FolderRow
            label="Pasta dos clipes"
            hint="Onde os clipes prontos ficam, numa pasta por canal, cada um com um .txt de título, hashtags e créditos."
            value={s.storage.clipsDir}
            effective={disk?.clipsDir}
            onPick={(p) => void updateSettings({ storage: { clipsDir: p } }).then(refreshDisk)}
          />
        </Card>
        <Card className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Espaço máximo para as gravações</p>
                <p className="text-xs text-muted">0 = sem limite. Uma live de 6 h em 1080p60 ocupa cerca de 13 a 20 GB.</p>
              </div>
              <NumberInput value={s.storage.maxRecordingsGb} unit="GB" onChange={(v) => void updateSettings({ storage: { maxRecordingsGb: v } }).then(refreshDisk)} />
            </div>
            {disk && (
              <div className="space-y-1">
                <Progress value={disk.limitGb ? Math.min(1, disk.recordingsGb / disk.limitGb) : 0} />
                <p className="text-xs text-muted">
                  Gravações usando {disk.recordingsGb.toFixed(2)} GB{disk.limitGb ? ` de ${disk.limitGb} GB` : ''} · {disk.freeGb} GB livres neste disco
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Quando chegar no limite</p>
              <p className="text-xs text-muted">Nunca apaga a live que está sendo gravada agora.</p>
            </div>
            <Segmented
              value={s.storage.whenFull}
              onChange={(v) => void updateSettings({ storage: { whenFull: v } })}
              options={[
                { value: 'deleteOldest', label: 'Apagar as mais antigas' },
                { value: 'stopRecording', label: 'Parar de gravar' }
              ]}
            />
          </div>
        </Card>
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Avisar quando o espaço livre ficar abaixo de</p>
              <p className="text-xs text-muted">Uma live de 6 h em 1080p60 pode passar de 10 GB.</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={s.storage.warnFreeGb}
                onChange={(e) => void updateSettings({ storage: { warnFreeGb: Number(e.target.value) } })}
                className="w-20 rounded-xl border border-line bg-panel px-3 py-1.5 text-right text-sm outline-none focus:border-accent"
              />
              <span className="text-sm text-muted">GB</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Toggle label="Apagar segmentos sem clipe" checked={false} disabled onChange={() => undefined} />
            <div>
              <p className="flex items-center gap-2 text-sm font-medium">
                Apagar pedaços já processados que não viraram clipe <Badge tone="muted">em breve</Badge>
              </p>
              <p className="text-xs text-muted">Economiza disco, mas impede reprocessar a live inteira depois. Por enquanto, use o limite de espaço acima.</p>
            </div>
          </div>
        </Card>
      </Section>

        </>
      )}

      {tab === 'sistema' && (
        <>
      <Section title="Avisos">
        <Card className="flex items-center gap-4">
          <Toggle label="Avisos do Windows" checked={s.notifications.enabled} onChange={(v) => void updateSettings({ notifications: { enabled: v } })} />
          <div>
            <p className="text-sm font-medium">Avisar no Windows quando algo terminar</p>
            <p className="text-xs text-muted">Live começou ou acabou de gravar, momentos encontrados (com o melhor título) e tarefas que falharam.</p>
          </div>
        </Card>
      </Section>

      <SystemPanel state={state} />
        </>
      )}
    </div>
  )
}
