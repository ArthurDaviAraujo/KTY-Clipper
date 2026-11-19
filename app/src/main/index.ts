import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, Notification, powerSaveBlocker, protocol, shell, Tray } from 'electron'
import { pathToFileURL } from 'url'
import { Readable } from 'stream'
import { setHttpFetch } from './platforms/http'
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { DatabaseSync } from 'node:sqlite'
import { userInfo } from 'os'
import { ProfileStore } from './profiles'
import { dirname, isAbsolute, join, resolve } from 'path'
import { openDb, kvGet, kvSet, type Db } from './db'
import { JobQueue, limitsFor } from './jobs'
import { Logger } from './logs'
import { SearchService } from './search'
import { smartChannelSearch, type ChannelSearchDeps } from './channelSearch'
import { getTools, toolPath } from './tools'
import { baseHardware, testEncoders } from './hardware'
import { diskSpace } from './disk'
import { LiveService } from './live'
import { VodService } from './vod'
import { MomentsService } from './moments'
import { ClipService } from './render'
import { AssistantService } from './assistant'
import { assistantSystem, buildAssistantTools } from './assistantTools'
import { findWhisperModels } from './speech'
import { getSecret, secretUnreadable, setSecret } from './secrets'
import { listGeminiModels, pickGeminiModel } from './ai/gemini'
import { BACKUPS, backupJson, listBackupModels, pickBackupModel, type Backup, type BackupId } from './ai/backups'
import { programDirs } from './tools'

// Protocolo próprio para as telas mostrarem miniaturas do disco (clipador://miniatura/<id>)
protocol.registerSchemesAsPrivileged([{ scheme: 'clipador', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
import { GB, clipsRoot, deleteOldest, deleteUnused, exportRoot, recordingsRoot, usageBytes } from './storage'
import { defaultSettings, detectEveryMinutes, mergeSettings, portableSettings, sanitizeSettings, withMachine } from '../shared/settings'
import type { Modality } from '../shared/modality'
import type { AiBackupStatus, AiStatus, AppInfo, ClipOptions, ClipRecord, ClipReview, DeepPartial, DiskInfo, HardwareInfo, Platform, Rect, Settings } from '../shared/types'
import { DISCARDED_AFTER_MS } from '../shared/types'

/**
 * Pasta de dados: em desenvolvimento fica em <projeto>/dados (fora do git);
 * no app instalado, na pasta de dados do usuário.
 * Usar a pasta do projeto em dev também evita a cópia privada do %APPDATA% criada
 * quando o app é aberto pelo Claude desktop.
 */
// CLIPADOR_DADOS: pasta de dados de teste (uma cópia isolada do app, com --user-data-dir próprio, sem mexer na do usuário)
const dataDir = process.env.CLIPADOR_DADOS
  ? process.env.CLIPADOR_DADOS
  : app.isPackaged
    ? join(app.getPath('userData'), 'dados')
    : join(dirname(app.getAppPath()), 'dados')
mkdirSync(dataDir, { recursive: true })
const dbPath = join(dataDir, 'clipador.db')

let db: Db
let logger: Logger
let search: SearchService
const clipNowPending: { liveId: number; tMs: number }[] = []
/** Busca de canal com IA: o mesmo Gemini do resto do app */
const channelSearchDeps = (): ChannelSearchDeps => ({
  db,
  log: logger,
  lookup: (n) => live.lookup(n),
  backups: aiBackups,
  gemini: () => {
    const key = getSecret(db, 'gemini')
    return key && settings.ai.provider === 'gemini' && settings.ai.geminiModel ? { key, model: settings.ai.geminiModel } : null
  }
})
let queue: JobQueue
let settings: Settings
let hardware: HardwareInfo
let live: LiveService
let vod: VodService
let moments: MomentsService
let clips: ClipService
let assistant: AssistantService
let profiles: ProfileStore
let win: BrowserWindow | null = null

const send = (channel: string, payload: unknown) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

/** Uma cópia só do app: duas gravariam as mesmas lives no mesmo banco. Abrir de novo só mostra a janela. */
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()
app.on('second-instance', () => showWindow())

/** Aberto pelo Windows ao ligar o PC: começa escondido na bandeja. */
const startHidden = process.argv.includes('--hidden')

function showWindow(): void {
  if (!app.isReady()) return
  if (!win || win.isDestroyed()) return createWindow(true)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// ---------- segundo plano: bandeja, PC acordado e abrir com o Windows ----------

let tray: Tray | null = null
let trayHintShown = false

function setupTray(): void {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'icon.png')).resize({ width: 32, height: 32, quality: 'best' })
  tray = new Tray(icon)
  tray.on('click', () => showWindow())
  refreshTray()
}

function refreshTray(): void {
  if (!tray) return
  const n = live?.activeLiveIds().size ?? 0
  const status = n ? `Gravando ${n} live${n > 1 ? 's' : ''}` : 'Nenhuma gravação agora'
  tray.setToolTip(`Clipador KTY · ${status}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Clipador KTY', click: () => showWindow() },
      { label: status, enabled: false },
      { type: 'separator' },
      { label: 'Sair (para de gravar)', click: () => app.quit() }
    ])
  )
}

/** Impede o Windows de suspender enquanto há live gravando ou tarefa rodando (a tela ainda pode apagar). */
let awakeId: number | null = null
function updateKeepAwake(): void {
  if (!settings || !live || !queue) return
  const recording = live.activeLiveIds().size
  const want = settings.background.keepAwake && (recording > 0 || queue.runningTotal() > 0)
  if (want && awakeId == null) {
    awakeId = powerSaveBlocker.start('prevent-app-suspension')
    logger.info('energia', 'O PC não vai suspender enquanto houver gravação ou tarefa rodando.')
  } else if (!want && awakeId != null) {
    powerSaveBlocker.stop(awakeId)
    awakeId = null
    logger.info('energia', 'Nada gravando nem rodando: o PC pode suspender de novo.')
  }
}

/** Atalho de inicialização do Windows (só mexe no registro quando a opção foi ligada alguma vez). */
function applyLoginItem(): void {
  const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden']
  const opts = { path: process.execPath, args }
  const on = settings.background.openAtLogin
  if (!on && !app.getLoginItemSettings(opts).openAtLogin) return
  app.setLoginItemSettings({ ...opts, openAtLogin: on })
}

/** Ajustes do perfil ativo (os de antes dos perfis ficam como base do primeiro). */
function loadSettings(): Settings {
  const raw = profiles.settingsOf(profiles.activeId()) ?? kvGet<unknown>(db, 'settings') ?? {}
  const s = sanitizeSettings(mergeSettings(defaultSettings(), raw))
  // Pasta salva que não é caminho absoluto volta para o padrão (evita travar o app ao abrir)
  for (const k of ['recordingsDir', 'clipsDir', 'exportDir'] as const) if (s.storage[k] && !isAbsolute(s.storage[k])) s.storage[k] = ''
  return s
}

function saveSettings(next: Settings): Settings {
  settings = sanitizeSettings(next)
  profiles.saveSettings(profiles.activeId(), settings)
  // Cópia da máquina: base para perfis novos e para o próximo início
  kvSet(db, 'settings', settings)
  return settings
}

/** Entra noutro perfil: os ajustes dele valem, mas pastas e programas continuam os deste PC. */
function enterProfile(id: number): void {
  profiles.setActive(id)
  const theirs = sanitizeSettings(mergeSettings(defaultSettings(), profiles.settingsOf(id) ?? {}))
  saveSettings(withMachine(theirs, settings))
  send('settings', settings)
  send('profiles', profiles.list())
  const p = profiles.list().profiles.find((x) => x.id === id)
  logger.info('perfil', `Perfil ativo: ${p?.name ?? id}.`)
}

function loadHardware(): HardwareInfo {
  const saved = kvGet<HardwareInfo>(db, 'hardware')
  return { ...baseHardware(), encoders: saved?.encoders ?? [], encodersTestedAt: saved?.encodersTestedAt ?? null }
}

function registerJobs(): void {
  queue.register('diagnostico:codificadores', 'gpu', async (_p, ctx) => {
    const ffmpeg = toolPath(settings, 'ffmpeg')
    if (!ffmpeg) throw new Error('FFmpeg não encontrado. Coloque o ffmpeg.exe na pasta "programas".')
    const encoders = await testEncoders(ffmpeg, ctx.progress, ctx.signal)
    hardware = { ...hardware, encoders, encodersTestedAt: Date.now() }
    kvSet(db, 'hardware', { encoders, encodersTestedAt: hardware.encodersTestedAt })
    send('hardware', hardware)
    const ok = encoders.filter((e) => e.works).map((e) => e.name)
    logger.info('diagnóstico', `Codificadores que funcionam: ${ok.join(', ') || 'nenhum'}`)
    return { working: ok }
  })
}

function getDisk(): DiskInfo {
  const rec = recordingsRoot(settings, dataDir)
  const { freeGb, totalGb } = diskSpace(rec)
  return {
    path: rec,
    freeGb,
    totalGb,
    low: freeGb < settings.storage.warnFreeGb,
    recordingsGb: Math.round((usageBytes(db) / GB) * 100) / 100,
    limitGb: settings.storage.maxRecordingsGb,
    recordingsDir: rec,
    clipsDir: clipsRoot(settings, dataDir),
    exportDir: exportRoot(settings, dataDir)
  }
}

/** Aviso do Windows (some sozinho); clicar traz o app para a frente. */
function notify(title: string, body: string): void {
  if (!settings.notifications.enabled || !Notification.isSupported()) return
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => showWindow())
  n.show()
}

/** Momentos já avisados (não repete o mesmo lance a cada nova detecção durante a live). */
const notifiedMoments = new Set<string>()

function notifyMoments(liveId: number): void {
  const recording = live.activeLiveIds().has(liveId)
  const all = moments.list(liveId).filter((m) => !m.ai || m.ai.keep)
  const name = all[0]?.channelName
  const fresh = all.filter((m) => {
    const key = `${liveId}:${Math.round(m.peakS / 20)}`
    if (notifiedMoments.has(key)) return false
    // Durante a gravação só avisa dos fortes, para não incomodar a cada 5 min
    if (recording && m.score < Math.max(60, settings.detection.minScore)) return false
    notifiedMoments.add(key)
    return true
  })
  if (!fresh.length) return
  const best = fresh.sort((a, b) => b.score - a.score)[0]
  const label = best.ai?.titlePt ?? best.reasons[0] ?? ''
  notify(
    `${fresh.length} momento(s) ${recording ? 'novo(s)' : 'encontrado(s)'}: ${name}`,
    `Melhor (nota ${best.score}): ${label}`.slice(0, 180)
  )
}

/**
 * Serve um vídeo do disco para o player das telas, com pedidos por faixa de bytes
 * (sem isso o <video> não consegue pular para o meio).
 */
function serveVideo(path: string, req: Request): Response {
  const size = statSync(path).size
  const base = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' }
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '')
  if (!m) return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { status: 200, headers: { ...base, 'Content-Length': String(size) } })
  let start = m[1] ? Number(m[1]) : size - Number(m[2] || 0)
  let end = m[1] && m[2] ? Number(m[2]) : size - 1
  start = Math.max(0, start)
  end = Math.min(end, size - 1)
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, {
    status: 206,
    headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` }
  })
}

/** Pastas dos modelos do Whisper: "modelos" ao lado da pasta de gravações (no D:, no PC do usuário) e a pasta de programas. */
function modelDirs(): string[] {
  return [join(dirname(recordingsRoot(settings, dataDir)), 'modelos'), ...programDirs().map((d) => join(d, 'whisper', 'models'))]
}

let geminiAvailable: string[] = []

/** Reservas prontas, na ordem da fila: Groq, OpenRouter, Mistral e, por último, a IA local (se ligada). */
function aiBackups(): Backup[] {
  const out: Backup[] = []
  for (const b of BACKUPS) {
    const model = settings.ai.backupModels?.[b.id]
    if (!model) continue
    if (b.id === 'ollama') {
      if (settings.ai.fallbackToLocal) out.push({ id: b.id, name: b.name, base: b.base, key: null, model })
      continue
    }
    const key = getSecret(db, b.id)
    if (key) out.push({ id: b.id, name: b.name, base: b.base, key, model })
  }
  return out
}

/** Reservas com chave guardada mas sem modelo escolhido: escolhe agora (ao abrir o app). Falha de rede fica para a próxima. */
async function fillBackupModels(): Promise<void> {
  for (const b of BACKUPS) {
    if (!b.needsKey || settings.ai.backupModels?.[b.id]) continue
    const key = getSecret(db, b.id)
    if (!key) continue
    try {
      const model = pickBackupModel(b.id, await listBackupModels(b.id, key))
      if (!model) continue
      saveSettings(mergeSettings(settings, { ai: { backupModels: { [b.id]: model } } }))
      logger.info('ia', `Reserva da KaTY pronta: ${b.name} (${model}).`)
    } catch (e) {
      logger.warn('ia', `Reserva ${b.name}: ${(e as Error).message}`)
    }
  }
}

function backupStatus(): AiBackupStatus[] {
  const ready = new Set(aiBackups().map((b) => b.id))
  return BACKUPS.map((b) => ({
    id: b.id,
    name: b.name,
    needsKey: b.needsKey,
    keyUrl: b.keyUrl,
    note: b.note,
    ready: ready.has(b.id),
    hasKey: b.needsKey ? !!getSecret(db, b.id) : false,
    model: settings.ai.backupModels?.[b.id] || null
  }))
}

const geminiTarget = () => {
  const key = getSecret(db, 'gemini')
  return key && settings.ai.geminiModel ? { key, model: settings.ai.geminiModel } : null
}

function aiStatus(): AiStatus {
  return { hasKey: !!getSecret(db, 'gemini'), keyUnreadable: secretUnreadable(db, 'gemini'), model: settings.ai.geminiModel || null, available: geminiAvailable }
}

function checkDisk(): void {
  try {
    const d = getDisk()
    if (d.low) logger.warn('disco', `Pouco espaço: ${d.freeGb} GB livres em ${d.path} (aviso abaixo de ${settings.storage.warnFreeGb} GB).`)
  } catch (e) {
    logger.error('disco', `Não foi possível ler o espaço em disco: ${(e as Error).message}`)
  }
}

/**
 * Aplica o limite de espaço das gravações:
 * - "apagar as mais antigas": remove pedaços de lives já encerradas, das mais velhas para as mais novas;
 * - "parar de gravar": pausa as gravações até o espaço ser liberado ou o limite aumentado.
 * Também pausa se o disco estiver quase cheio (menos de 2 GB livres), para não travar o PC.
 */
let enforcing = false
async function enforceStorage(): Promise<void> {
  if (enforcing) return
  enforcing = true
  try {
    const s = settings.storage
    const { freeGb } = diskSpace(recordingsRoot(settings, dataDir))
    if (freeGb < 2) return void (await live.setBlocked(`o disco das gravações tem só ${freeGb} GB livres.`))
    if (!s.maxRecordingsGb) return void (await live.setBlocked(null))
    const limit = s.maxRecordingsGb * GB
    const over = usageBytes(db) - limit
    if (over <= 0) return void (await live.setBlocked(null))
    if (s.whenFull === 'deleteOldest') {
      // Nunca apaga o que está sendo gravado ou importado agora
      const r = deleteOldest(db, over, new Set([...live.activeLiveIds(), ...vod.importingIds()]))
      if (r.deletedSegments)
        logger.info('disco', `Limite de ${s.maxRecordingsGb} GB: apagados ${r.deletedSegments} pedaço(s) antigo(s), ${(r.freedBytes / GB).toFixed(2)} GB liberados.`)
      if (r.stillOverBytes > 0) await live.setBlocked(`limite de ${s.maxRecordingsGb} GB atingido e não há gravações antigas para apagar.`)
      else await live.setBlocked(null)
    } else {
      await live.setBlocked(`limite de ${s.maxRecordingsGb} GB das gravações atingido. Aumente o limite ou apague gravações.`)
    }
  } catch (e) {
    logger.error('disco', `Falha ao aplicar o limite de espaço: ${(e as Error).message}`)
  } finally {
    enforcing = false
  }
}

/**
 * "Apagar pedaços que não viraram clipe": nas lives já terminadas (há mais de 30 min, analisadas e sem nada
 * na fila), guarda só os trechos dos clipes e momentos e apaga o resto. Descartados não seguram nada.
 */
function cleanUnused(): void {
  if (!settings.storage.deleteUnusedSegments) return
  try {
    const r = deleteUnused(db, new Set([...live.activeLiveIds(), ...vod.importingIds()]))
    if (r.deletedSegments)
      logger.info(
        'disco',
        `Limpeza: apagados ${r.deletedSegments} pedaço(s) sem clipe nem momento de ${r.lives} live(s), ${(r.freedBytes / GB).toFixed(2)} GB liberados.`
      )
  } catch (e) {
    logger.error('disco', `Falha na limpeza das gravações: ${(e as Error).message}`)
  }
}

/**
 * Apaga sozinho os clipes em Descartados, pela opção da aba: ao abrir o app (todos) ou depois do prazo escolhido.
 */
function purgeDiscarded(atStartup = false): void {
  const mode = settings.clips.discardedDelete
  const after = DISCARDED_AFTER_MS[mode]
  if (mode === 'never' || (mode === 'startup' && !atStartup)) return
  try {
    const n = clips.purgeRejected(after ?? 0)
    if (n) logger.info('clipes', `${n} clipe(s) descartado(s) apagado(s) do disco${mode === 'startup' ? ' ao abrir o app' : ''}.`)
  } catch (e) {
    logger.error('clipes', `Falha ao apagar os descartados: ${(e as Error).message}`)
  }
}

/** Aplica uma mudança nos ajustes (pelas telas ou pelo assistente) e reage ao que mudou. */
function applySettings(patch: DeepPartial<Settings>): Settings {
  const before = settings.performance.mode
  const prevStorage = settings.storage
  const prevBackground = settings.background
  const prevDiscarded = settings.clips.discardedDelete
  const merged = mergeSettings(settings, patch)
  // Pastas só aceitam caminho absoluto (ou vazio = padrão); qualquer outra coisa mantém a anterior
  for (const k of ['recordingsDir', 'clipsDir', 'exportDir'] as const) {
    const v = merged.storage[k]
    if (v && !isAbsolute(v)) {
      logger.warn('ajustes', `Pasta inválida ignorada: "${v}". Escolha uma pasta pelo botão.`)
      merged.storage[k] = prevStorage[k]
    }
  }
  const next = saveSettings(merged)
  if (next.performance.mode !== before) logger.info('ajustes', `Modo de desempenho: ${next.performance.mode === 'max' ? 'máximo' : 'econômico'}.`)
  if (next.storage.recordingsDir !== prevStorage.recordingsDir)
    logger.info('disco', `Novas gravações vão para ${recordingsRoot(next, dataDir)}. As antigas continuam onde estavam.`)
  if (next.storage.maxRecordingsGb !== prevStorage.maxRecordingsGb || next.storage.whenFull !== prevStorage.whenFull) void enforceStorage()
  if (next.storage.deleteUnusedSegments && !prevStorage.deleteUnusedSegments) cleanUnused()
  if (next.clips.discardedDelete !== prevDiscarded) purgeDiscarded()
  if (next.background.openAtLogin !== prevBackground.openAtLogin) {
    applyLoginItem()
    logger.info('ajustes', next.background.openAtLogin ? 'O Clipador vai abrir junto com o Windows, na bandeja.' : 'O Clipador não abre mais junto com o Windows.')
  }
  if (next.background.keepAwake !== prevBackground.keepAwake) updateKeepAwake()
  return next
}

/** Banco sem nada ainda (app recém-instalado) */
function isFresh(): boolean {
  const n = (q: string) => (db.prepare(q).get() as { n: number }).n
  return n('SELECT COUNT(*) AS n FROM channels') + n('SELECT COUNT(*) AS n FROM lives') + n('SELECT COUNT(*) AS n FROM clips') === 0
}

/** Banco trazido de outra pasta, trocado pelo atual depois que o app fecha (e então reabre) */
let pendingImport: string | null = null

/**
 * Traz os dados de outra pasta "dados" (por exemplo, do modo de desenvolvimento ou de outro PC):
 * fotografia consistente do banco (VACUUM INTO) e fotos de perfil. O banco atual é trocado ao reiniciar.
 * As gravações e os clipes ficam onde estão (o banco guarda os caminhos).
 */
async function importData(): Promise<string | null> {
  const teste = process.env.CLIPADOR_TESTE_IMPORTAR
  const pick = teste
    ? { canceled: false, filePaths: [teste] }
    : await dialog.showOpenDialog(win!, {
    title: 'Escolha a pasta "dados" do Clipador que você usava',
    defaultPath: join(app.getPath('desktop'), 'Clipador KTY', 'dados'),
    properties: ['openDirectory']
  })
  if (pick.canceled || !pick.filePaths[0]) return null
  const dir = pick.filePaths[0]
  const src = join(dir, 'clipador.db')
  if (!existsSync(src)) throw new Error('Essa pasta não tem o arquivo clipador.db. Escolha a pasta "dados" do Clipador.')
  if (resolve(dir) === resolve(dataDir)) throw new Error('Essa já é a pasta de dados deste app.')
  const answer = teste
    ? { response: 0 }
    : await dialog.showMessageBox(win!, {
    type: 'warning',
    buttons: ['Trazer os dados', 'Cancelar'],
    defaultId: 0,
    cancelId: 1,
    title: 'Trazer dados',
    message: 'Trocar os dados deste app pelos da pasta escolhida?',
    detail: 'Canais, lives, momentos, clipes, ajustes e perfis daqui são substituídos pelos de lá. As gravações e os clipes no disco não mudam. O app reinicia sozinho.'
  })
  if (answer.response !== 0) return null
  const tmp = join(dataDir, 'importando.db')
  rmSync(tmp, { force: true })
  const from = new DatabaseSync(src, { readOnly: true })
  try {
    from.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`)
  } finally {
    from.close()
  }
  if (existsSync(join(dir, 'perfis'))) cpSync(join(dir, 'perfis'), join(dataDir, 'perfis'), { recursive: true, force: true })
  logger.info('app', `Dados trazidos de ${dir}. Reiniciando para usar.`)
  pendingImport = tmp
  setImmediate(() => app.quit())
  return dir
}

function registerIpc(): void {
  ipcMain.handle('app:info', (): AppInfo => ({ version: app.getVersion(), dataDir, dbPath, dev: !app.isPackaged, fresh: isFresh() }))
  ipcMain.handle('data:import', () => importData())
  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:update', (_e, patch: DeepPartial<Settings>) => applySettings(patch))
  ipcMain.handle('settings:reset', () => {
    logger.info('ajustes', 'Ajustes restaurados para o padrão (pastas e programas deste PC mantidos).')
    return saveSettings(withMachine(defaultSettings(), settings))
  })
  ipcMain.handle('assistant:state', () => assistant.state())
  ipcMain.handle('assistant:send', (_e, text: string) => assistant.send(String(text ?? '').slice(0, 4000)))
  ipcMain.handle('assistant:confirm', (_e, id: string, ok: boolean) => assistant.confirm(String(id), !!ok))
  ipcMain.handle('assistant:stop', () => assistant.stop())
  ipcMain.handle('assistant:clear', () => assistant.clear())
  ipcMain.handle('tools:get', (_e, refresh?: boolean) => getTools(settings, !!refresh))
  ipcMain.handle('hardware:get', () => hardware)
  ipcMain.handle('hardware:testEncoders', () => queue.enqueue('diagnostico:codificadores', 'Testar codificadores de vídeo', null, { maxAttempts: 1 }).id)
  ipcMain.handle('disk:get', () => getDisk())
  ipcMain.handle('dialog:pickFolder', async (_e, title: string, current?: string) => {
    const r = await dialog.showOpenDialog(win!, { title, defaultPath: current || undefined, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })
  ipcMain.handle('jobs:list', (_e, limit?: number) => queue.list(limit))
  ipcMain.handle('jobs:cancel', (_e, id: number) => queue.cancel(id))
  ipcMain.handle('jobs:retry', (_e, id: number) => queue.retry(id))
  ipcMain.handle('jobs:clearFinished', () => queue.clearFinished())
  ipcMain.handle('logs:list', (_e, limit?: number) => logger.list(limit))
  ipcMain.handle('shell:openPath', (_e, p: string) => shell.openPath(p).then(() => undefined))
  ipcMain.handle('channels:list', () => live.list())
  ipcMain.handle('channels:add', (_e, platform: Platform, input: string) => live.add(platform, input))
  ipcMain.handle('channels:remove', (_e, id: number) => live.remove(id))
  ipcMain.handle('channels:lookup', (_e, name: string) => live.lookup(String(name ?? '').slice(0, 200)))
  ipcMain.handle('channels:search', (_e, text: string) => smartChannelSearch(channelSearchDeps(), String(text ?? '').slice(0, 200)))
  ipcMain.handle('channels:setEnabled', (_e, id: number, enabled: boolean) => live.setEnabled(id, enabled))
  ipcMain.handle('channels:setRecord', (_e, id: number, record: boolean) => live.setRecord(Number(id), !!record))
  ipcMain.handle('channels:setModality', (_e, id: number, modality: string | null) => live.setModality(id, modality as Modality | null))
  ipcMain.handle('channels:checkNow', () => live.checkNow())
  ipcMain.handle('channels:stopRecording', (_e, id: number) => live.stopRecording(id, 'ended'))
  ipcMain.handle('lives:list', (_e, limit?: number) => vod.list(limit))
  ipcMain.handle('vod:import', (_e, url: string, startS?: number | null, endS?: number | null) => vod.importVod(url, startS, endS))
  ipcMain.handle('vod:cancel', (_e, id: number) => vod.cancel(id))
  ipcMain.handle('vod:retry', (_e, id: number) => vod.retry(id))
  ipcMain.handle('lives:delete', (_e, id: number) => vod.delete(id))
  ipcMain.handle('moments:list', (_e, liveId?: number) => moments.list(liveId))
  ipcMain.handle('search:text', (_e, q: string) => search.search(String(q ?? '').slice(0, 200)))
  ipcMain.handle('search:ai', (_e, q: string) => search.searchAi(String(q ?? '').slice(0, 300)))
  ipcMain.handle('moments:at', (_e, liveId: number, tMs: number, label: string) => moments.createAt(Number(liveId), Number(tMs), String(label ?? '')))
  ipcMain.handle('moments:timeline', (_e, liveId: number) => moments.timeline(liveId))
  ipcMain.handle('moments:detect', (_e, liveId: number) => moments.enqueue(liveId, 'pedido manual'))
  ipcMain.handle('moments:open', async (_e, id: number) => {
    const p = moments.segmentOf(id)
    if (p) await shell.openPath(p)
  })
  ipcMain.handle('ai:status', () => aiStatus())
  ipcMain.handle('ai:backups', () => backupStatus())
  // Chave de uma reserva: testa listando os modelos, escolhe o melhor e guarda (vazio = apagar)
  ipcMain.handle('ai:setBackupKey', async (_e, id: BackupId, key: string) => {
    const b = BACKUPS.find((x) => x.id === id && x.needsKey)
    if (!b) throw new Error('Reserva desconhecida.')
    // Cópia com espaço, quebra de linha ou aspas em volta: limpa antes de testar
    const k = String(key ?? '').replace(/\s+/g, '').replace(/^["'`]+|["'`]+$/g, '')
    if (!k) {
      setSecret(db, b.id, null)
      saveSettings(mergeSettings(settings, { ai: { backupModels: { [b.id]: '' } } }))
      logger.info('ia', `Chave do ${b.name} apagada.`)
      return backupStatus()
    }
    const model = pickBackupModel(b.id, await listBackupModels(b.id, k))
    if (!model) throw new Error(`A chave do ${b.name} funciona, mas não há modelo de texto grátis disponível para ela.`)
    setSecret(db, b.id, k)
    saveSettings(mergeSettings(settings, { ai: { backupModels: { [b.id]: model } } }))
    logger.info('ia', `Reserva da KaTY pronta: ${b.name} (${model}).`)
    // Lances das últimas 24 h sem análise (a IA estava fora): analisa agora com a reserva
    const pending = db
      .prepare(`SELECT DISTINCT live_id FROM moments WHERE ai IS NULL AND status IN ('new', 'kept') AND created_at > ?`)
      .all(Date.now() - 24 * 3600_000) as { live_id: number }[]
    for (const p of pending) moments.enqueue(p.live_id, `reserva ${b.name} pronta`)
    return backupStatus()
  })
  // IA local: procura o Ollama aberto neste PC e escolhe o modelo
  // Testar uma reserva sozinha: um pedido pequeno no mesmo formato da análise dos lances
  ipcMain.handle('ai:testBackup', async (_e, id: BackupId) => {
    const b = aiBackups().find((x) => x.id === id)
    if (!b) throw new Error('Essa reserva ainda não está pronta.')
    const t0 = Date.now()
    const r = await backupJson<{ title_pt: string }>(
      b,
      'Você dá títulos curtos de clipes de live, em CAIXA ALTA, com 1 emoji no fim, em português do Brasil.',
      'O streamer tentou um salto de moto, caiu do prédio e o chat explodiu de rir. Dê o título.',
      { type: 'OBJECT', properties: { title_pt: { type: 'STRING' } }, required: ['title_pt'] }
    )
    return { ms: Date.now() - t0, model: b.model, answer: String(r.title_pt ?? '').slice(0, 120) }
  })
  ipcMain.handle('ai:checkLocal', async () => {
    try {
      const model = pickBackupModel('ollama', await listBackupModels('ollama', null))
      if (!model) throw new Error('O Ollama está aberto, mas sem nenhum modelo baixado (ex.: rode "ollama pull qwen3" no terminal).')
      saveSettings(mergeSettings(settings, { ai: { backupModels: { ollama: model } } }))
      logger.info('ia', `IA local encontrada: Ollama (${model}).`)
    } catch (e) {
      saveSettings(mergeSettings(settings, { ai: { backupModels: { ollama: '' } } }))
      const m = (e as Error).message
      throw new Error(/fetch|ECONNREFUSED|Failed/i.test(m) ? 'Ollama não encontrado neste PC (instale e abra o Ollama).' : m)
    }
    return backupStatus()
  })
  ipcMain.handle('ai:setGeminiKey', async (_e, key: string) => {
    const k = key.trim()
    if (!k) {
      setSecret(db, 'gemini', null)
      geminiAvailable = []
      saveSettings(mergeSettings(settings, { ai: { geminiModel: '' } }))
      logger.info('ia', 'Chave do Gemini apagada.')
      return aiStatus()
    }
    // Testa a chave antes de guardar e já escolhe o modelo
    const models = await listGeminiModels(k)
    const model = pickGeminiModel(models)
    if (!model) throw new Error('A chave funciona, mas não há modelo Gemini de texto disponível para ela.')
    setSecret(db, 'gemini', k)
    geminiAvailable = models
    saveSettings(mergeSettings(settings, { ai: { geminiModel: model } }))
    logger.info('ia', `Chave do Gemini salva. Modelo: ${model}.`)
    // Lances das últimas 24 h que ficaram sem análise (a chave estava fora do ar): analisa agora e põe os títulos que faltaram
    const pending = db
      .prepare(`SELECT DISTINCT live_id FROM moments WHERE ai IS NULL AND status IN ('new', 'kept') AND created_at > ?`)
      .all(Date.now() - 24 * 3600_000) as { live_id: number }[]
    for (const p of pending) moments.enqueue(p.live_id, 'chave do Gemini salva')
    return aiStatus()
  })
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('speech:models', () => findWhisperModels(modelDirs()))
  ipcMain.handle('clips:draft', (_e, momentId: number) => clips.draft(momentId))
  ipcMain.handle('clips:preview', (_e, momentId: number, o: ClipOptions) => clips.preview(momentId, o))
  ipcMain.handle('clips:frame', (_e, momentId: number) => clips.frame(momentId))
  ipcMain.handle('clips:setFacecam', (_e, channelId: number, rect: Rect | null) => clips.setFacecam(channelId, rect))
  ipcMain.handle('clips:detectFacecam', (_e, momentId: number) => clips.detectFacecam(momentId, true))
  ipcMain.handle('clips:render', (_e, momentId: number, o: ClipOptions) => clips.request(momentId, o))
  ipcMain.handle('clips:list', (_e, liveId?: number) => clips.list(liveId))
  ipcMain.handle('clips:delete', (_e, id: number) => clips.delete(id))
  ipcMain.handle('clips:purgeRejected', () => {
    const n = clips.purgeRejected(0)
    if (n) logger.info('clipes', `${n} clipe(s) descartado(s) apagado(s) do disco.`)
    return n
  })
  ipcMain.handle('clips:export', (_e, id: number) => clips.exportClip(id))
  ipcMain.handle('clips:exportApproved', () => clips.exportApproved())
  ipcMain.handle('clips:posted', (_e, id: number, platform: 'youtube' | 'tiktok', posted: boolean) => clips.markPosted(id, platform, !!posted))
  ipcMain.handle('clips:postText', (_e, id: number, field: 'youtubeTitle' | 'youtubeDescription' | 'tiktokCaption', text: string | null) =>
    clips.setPostText(id, field, text)
  )
  // Arrastar o vídeo do app para a página de envio do navegador: precisa ser síncrono, no mesmo evento de arrastar
  ipcMain.on('clips:drag', (e, id: number) => {
    const file = clips.uploadFile(Number(id))
    if (!file) return
    const cover = clips.coverIfExists(Number(id))
    const icon = nativeImage.createFromPath(cover ?? join(app.getAppPath(), 'resources', 'icon.png')).resize({ width: 64 })
    e.sender.startDrag({ file, icon })
  })
  ipcMain.handle('clips:review', (_e, id: number, review: ClipReview) => clips.setReview(id, review))
  ipcMain.handle('moments:dismiss', (_e, id: number) => moments.dismiss(id))
  ipcMain.handle('shell:showInFolder', (_e, p: string) => shell.showItemInFolder(p))

  ipcMain.handle('profiles:list', () => profiles.list())
  ipcMain.handle('profiles:create', (_e, name: string) => {
    const id = profiles.create(name, withMachine(defaultSettings(), settings))
    enterProfile(id)
    return profiles.list()
  })
  ipcMain.handle('profiles:switch', (_e, id: number) => {
    if (id !== profiles.activeId()) enterProfile(id)
    return profiles.list()
  })
  ipcMain.handle('profiles:update', (_e, id: number, patch: { name?: string; color?: string }) => {
    profiles.update(id, patch)
    send('profiles', profiles.list())
    return profiles.list()
  })
  ipcMain.handle('profiles:photo', async (_e, id: number) => {
    const r = await dialog.showOpenDialog(win!, { title: 'Foto do perfil', properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
    if (!r.canceled && r.filePaths[0]) profiles.setPhoto(id, r.filePaths[0])
    send('profiles', profiles.list())
    return profiles.list()
  })
  ipcMain.handle('profiles:delete', (_e, id: number) => {
    profiles.delete(id)
    send('profiles', profiles.list())
    return profiles.list()
  })
  ipcMain.handle('profiles:export', async () => {
    const p = profiles.list().profiles.find((x) => x.id === profiles.activeId())
    const r = await dialog.showSaveDialog(win!, {
      title: 'Exportar predefinições',
      defaultPath: join(app.getPath('documents'), `${(p?.name ?? 'perfil').replace(/[<>:"/\\|?*]/g, '')}.clipador.json`),
      filters: [{ name: 'Predefinições do Clipador', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, JSON.stringify({ app: 'clipador-kty', version: 1, name: p?.name, color: p?.color, settings: portableSettings(settings) }, null, 2), 'utf8')
    logger.info('perfil', `Predefinições exportadas para ${r.filePath}.`)
    return r.filePath
  })
  ipcMain.handle('profiles:import', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Importar predefinições', properties: ['openFile'], filters: [{ name: 'Predefinições do Clipador', extensions: ['json'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    let data: { app?: string; name?: string; color?: string; settings?: unknown }
    try {
      data = JSON.parse(readFileSync(r.filePaths[0], 'utf8'))
    } catch {
      throw new Error('Arquivo inválido (não é JSON).')
    }
    if (data.app !== 'clipador-kty') throw new Error('Este arquivo não é de predefinições do Clipador.')
    const imported = withMachine(sanitizeSettings(mergeSettings(defaultSettings(), data.settings ?? {})), settings)
    const id = profiles.create(`${data.name ?? 'Perfil'} (importado)`, imported)
    if (data.color) profiles.update(id, { color: data.color })
    enterProfile(id)
    return profiles.list()
  })
}

function createWindow(forceShow = false): void {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#191523',
    title: 'Clipador KTY',
    // Ícone da janela e da barra de tarefas (logo do Clipador)
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1b1726', symbolColor: '#cfc8e6', height: 48 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  win.once('ready-to-show', () => {
    if (forceShow || !startHidden) win?.show()
  })
  // Fechar a janela deixa o app na bandeja, gravando; "Sair" no ícone da bandeja fecha de vez
  win.on('close', (e) => {
    if (quitting || !settings?.background.closeToTray) return
    e.preventDefault()
    win?.hide()
    if (!trayHintShown) {
      trayHintShown = true
      notify('O Clipador continua aberto', 'Segue gravando na bandeja, perto do relógio. Para fechar de vez: botão direito no ícone > Sair.')
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

// No Windows, os avisos só aparecem com um id de aplicativo definido
app.setAppUserModelId('dev.clipador.kty')

app.whenReady().then(() => {
  // Outra cópia já está aberta: ela recebe o "second-instance" e mostra a janela
  if (!singleInstance) return
  setHttpFetch((input, init) => net.fetch(input as string, init))
  db = openDb(dbPath)
  logger = new Logger(db)
  profiles = new ProfileStore(db, join(dataDir, 'perfis'))
  profiles.ensure(kvGet<unknown>(db, 'settings'), userInfo().username || 'Meu perfil')
  settings = loadSettings()
  hardware = loadHardware()
  queue = new JobQueue(db, () => limitsFor(settings.performance.mode, hardware.cores))
  queue.on('job', (j) => send('job', j))
  queue.on('resumed', (n: number) => logger.info('fila', `${n} tarefa(s) interrompida(s) voltaram para a fila.`))
  logger.on('log', (e) => send('log', e))
  live = new LiveService(
    db,
    logger,
    () => settings,
    () => {
      const ffmpeg = toolPath(settings, 'ffmpeg')
      return ffmpeg ? { ffmpeg, ytdlp: toolPath(settings, 'ytdlp'), streamlink: toolPath(settings, 'streamlink') } : null
    },
    () => recordingsRoot(settings, dataDir)
  )
  live.on('channels', (c) => {
    send('channels', c)
    send('lives', null)
    refreshTray()
    updateKeepAwake()
  })
  queue.on('job', () => updateKeepAwake())
  // Confere o limite de espaço a cada pedaço novo
  live.on('segment', () => void enforceStorage())
  live.on('lives', () => send('lives', null))
  vod = new VodService(
    db,
    logger,
    queue,
    () => settings,
    () => {
      const ffmpeg = toolPath(settings, 'ffmpeg')
      return ffmpeg ? { ffmpeg, ytdlp: toolPath(settings, 'ytdlp'), streamlink: toolPath(settings, 'streamlink') } : null
    },
    () => recordingsRoot(settings, dataDir)
  )
  vod.on('lives', () => send('lives', null))
  vod.on('segment', () => void enforceStorage())
  moments = new MomentsService({
    db,
    log: logger,
    queue,
    settings: () => settings,
    ffmpeg: () => toolPath(settings, 'ffmpeg'),
    speech: () => {
      const ffmpeg = toolPath(settings, 'ffmpeg')
      const whisper = toolPath(settings, 'whisper')
      const models = findWhisperModels(modelDirs())
      const model = models.find((m) => m.name === settings.speech.model) ?? models[0]
      return ffmpeg && whisper && model ? { ffmpeg, whisper, model: model.path } : null
    },
    gemini: geminiTarget,
    backups: aiBackups
  })
  moments.on('moments', (liveId: number) => send('moments', liveId))
  search = new SearchService({
    db,
    log: logger,
    moments,
    gemini: geminiTarget,
    backups: aiBackups
  })
  clips = new ClipService({
    db,
    log: logger,
    queue,
    settings: () => settings,
    tools: () => {
      const ffmpeg = toolPath(settings, 'ffmpeg')
      const ffprobe = toolPath(settings, 'ffprobe')
      return ffmpeg && ffprobe ? { ffmpeg, ffprobe } : null
    },
    encoders: () => hardware.encoders,
    clipsRoot: () => clipsRoot(settings, dataDir),
    exportRoot: () => exportRoot(settings, dataDir),
    cacheDir: join(dataDir, 'cache'),
    aiReady: () => (settings.ai.provider === 'gemini' && !!geminiTarget()) || aiBackups().length > 0,
    // Achar a facecam olhando quadros da live: só o Gemini enxerga imagem (as reservas são só texto)
    vision: () => geminiTarget()
  })
  clips.on('clips', () => send('clips', null))
  // Assistente: conversa com o Gemini, que usa as mesmas ações das telas
  assistant = new AssistantService({
    db,
    log: logger,
    gemini: () => {
      const key = getSecret(db, 'gemini')
      return key && settings.ai.geminiModel ? { key, model: settings.ai.geminiModel } : null
    },
    tools: buildAssistantTools({
      live,
      vod,
      moments,
      clips,
      queue,
      log: logger,
      settings: () => settings,
      updateSettings: (patch) => {
        const next = applySettings(patch)
        send('settings', next)
        return next
      },
      disk: () => getDisk(),
      programs: () => getTools(settings),
      aiReady: () => !!getSecret(db, 'gemini') && !!settings.ai.geminiModel,
      navigate: (to) => send('assistant:navigate', to),
      openPath: (p) => void shell.openPath(p),
      search,
      channelSearch: (text) => smartChannelSearch(channelSearchDeps(), text)
    }),
    system: () => assistantSystem({ profile: profiles.list().profiles.find((p) => p.id === profiles.activeId())?.name ?? '', now: new Date() })
  })
  assistant.on('state', (st) => send('assistant', st))
  // "Clipar agora" numa live: o trecho são os últimos ~30 s; espera o pedaço gravado que os contém fechar
  const clipNowTick = () => {
    for (const p of [...clipNowPending]) {
      const end = (db.prepare(`SELECT MAX(start_utc + COALESCE(duration_s, 0) * 1000) AS e FROM segments WHERE live_id = ? AND status != 'deleted'`).get(p.liveId) as { e: number | null }).e ?? 0
      const late = Date.now() - p.tMs > 6 * 60_000
      if (end < p.tMs + 12_000 && !late) continue
      clipNowPending.splice(clipNowPending.indexOf(p), 1)
      try {
        const id = moments.createAt(p.liveId, p.tMs, 'Pedido ao vivo (Clipar agora)')
        if (db.prepare('SELECT 1 FROM clips WHERE moment_id = ?').get(id)) {
          logger.info('clipes', 'Clipar agora: este lance já tinha virado clipe.')
          continue
        }
        clips.request(id, clips.draft(id).options)
      } catch (e) {
        logger.warn('clipes', `Clipar agora não deu certo: ${(e as Error).message}`)
      }
    }
  }
  ipcMain.handle('live:clipNow', (_e, liveId: number) => {
    const tMs = Date.now() - 18_000
    clipNowPending.push({ liveId: Number(liveId), tMs })
    clipNowTick()
    return tMs
  })
  // Aviso: clipe pedido à mão avisa sozinho; os automáticos de uma live avisam juntos quando o último termina
  const autoReady = new Map<number, number>()
  clips.on('ready', (c: ClipRecord | null) => {
    if (!c) return
    // Clipe ao vivo: quanto tempo depois do lance ele ficou pronto
    if (c.auto && c.liveId != null && c.momentId != null && live.activeLiveIds().has(c.liveId)) {
      const m = db.prepare('SELECT peak_utc FROM moments WHERE id = ?').get(c.momentId) as { peak_utc: number } | undefined
      if (m) logger.info('clipes', `Clipe ao vivo pronto ${Math.max(1, Math.round((Date.now() - m.peak_utc) / 60_000))} min depois do lance: ${c.channelName} · ${c.title.slice(0, 60)}`)
    }
    if (!c.auto) return notify(`Clipe pronto: ${c.channelName}`, c.title.slice(0, 180))
    const k = c.liveId ?? 0
    autoReady.set(k, (autoReady.get(k) ?? 0) + 1)
    const pending = clips.list(c.liveId ?? undefined).some((x) => x.auto && (x.status === 'queued' || x.status === 'rendering'))
    if (pending) return
    notify(`${autoReady.get(k)} clipe(s) pronto(s): ${c.channelName}`, 'Gerados sozinhos a partir dos melhores momentos. Veja em Clipes > Para revisar.')
    autoReady.delete(k)
  })
  moments.on('detected', (liveId: number) => {
    notifyMoments(liveId)
    clips.retitleMissing(liveId)
    clips.autoForLive(liveId, live.activeLiveIds().has(liveId))
  })
  live.on('wentLive', (r: { name: string; title: string; game: string | null }) =>
    notify(`Ao vivo: ${r.name}`, `${r.title || 'Entrou ao vivo.'}${r.game ? ` (${r.game})` : ''} · só vigiando, não está gravando.`.slice(0, 180))
  )
  live.on('recordingStarted', (r: { name: string; title: string; resumed: boolean }) =>
    notify(r.resumed ? `Gravação retomada: ${r.name}` : `Gravando: ${r.name}`, (r.title || 'A live começou.').slice(0, 180))
  )
  live.on('recordingEnded', (liveId: number) => {
    const l = vod.list(300).find((x) => x.id === liveId)
    if (l) notify(`Live encerrada: ${l.channelName}`, `${l.segments} pedaço(s) gravados. Procurando os momentos…`)
  })
  // Falha definitiva (depois de todas as tentativas); a fila emite o mesmo estado mais de uma vez
  const failedNotified = new Set<number>()
  queue.on('job', (j: { id: number; status: string; finishedAt: number | null; label: string; error: string | null }) => {
    if (j.status !== 'failed' || !j.finishedAt || failedNotified.has(j.id)) return
    failedNotified.add(j.id)
    notify(`Falhou: ${j.label}`, (j.error ?? '').slice(0, 180))
  })
  // Quando procurar momentos: VOD pronto, a cada ~5 min de gravação e no fim da live
  vod.on('ready', (liveId: number) => moments.enqueue(liveId, 'VOD importado'))
  live.on('segment', (s: { liveId: number }) => {
    moments.enqueueThrottled(s.liveId, detectEveryMinutes(settings))
    clipNowTick()
  })
  live.on('recordingEnded', (liveId: number) => moments.enqueue(liveId, 'live encerrada'))
  protocol.handle('clipador', async (req) => {
    const url = new URL(req.url)
    const m = url.pathname.match(/^\/(\d+)/)
    if (m && url.hostname === 'clipe') {
      const p = clips.pathOf(Number(m[1]))
      return p ? serveVideo(p, req) : new Response('não encontrado', { status: 404 })
    }
    if (m && url.hostname === 'perfil') {
      const p = profiles.photoPath(Number(m[1]))
      return p ? net.fetch(pathToFileURL(p).href) : new Response('não encontrado', { status: 404 })
    }
    if (m && url.hostname === 'capa') {
      const p = await clips.cover(Number(m[1])).catch(() => null)
      return p ? net.fetch(pathToFileURL(p).href) : new Response('não encontrado', { status: 404 })
    }
    const p = m && url.hostname === 'miniatura' ? moments.thumbPath(Number(m[1])) : null
    return p ? net.fetch(pathToFileURL(p).href) : new Response('não encontrado', { status: 404 })
  })
  registerJobs()
  registerIpc()
  createWindow()
  void fillBackupModels()
  setupTray()
  applyLoginItem()
  if (startHidden) logger.info('app', 'Aberto junto com o Windows, na bandeja.')

  logger.info('app', `Clipador KTY ${app.getVersion()} iniciado. Dados em ${dataDir}.`)
  const missing = getTools(settings).filter((t) => t.required && !t.path)
  if (missing.length) logger.warn('programas', `Faltando: ${missing.map((t) => t.label).join(', ')}.`)
  if (!hardware.encodersTestedAt) queue.enqueue('diagnostico:codificadores', 'Testar codificadores de vídeo', null, { maxAttempts: 1 })

  queue.start()
  live.start()
  void enforceStorage()
  checkDisk()
  setInterval(checkDisk, 10 * 60 * 1000)
  cleanUnused()
  setInterval(cleanUnused, 10 * 60 * 1000)
  purgeDiscarded(true)
  setInterval(() => purgeDiscarded(), 10 * 60 * 1000)
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting || !queue) return
  e.preventDefault()
  quitting = true
  // Fecha as gravações com o último pedaço íntegro antes de sair
  void Promise.allSettled([live?.stop(), queue.stop()]).finally(() => {
    db.close()
    // Dados trazidos de outra pasta: troca o banco com o app fechado e reabre
    if (pendingImport && existsSync(pendingImport)) {
      for (const ext of ['', '-wal', '-shm']) rmSync(dbPath + ext, { force: true })
      renameSync(pendingImport, dbPath)
      app.relaunch()
    }
    app.quit()
  })
})

app.on('window-all-closed', () => app.quit())
