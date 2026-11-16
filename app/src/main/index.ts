import { app, BrowserWindow, dialog, ipcMain, net, Notification, protocol, shell } from 'electron'
import { pathToFileURL } from 'url'
import { Readable } from 'stream'
import { setHttpFetch } from './platforms/http'
import { createReadStream, mkdirSync, statSync } from 'fs'
import { dirname, isAbsolute, join } from 'path'
import { openDb, kvGet, kvSet, type Db } from './db'
import { JobQueue, limitsFor } from './jobs'
import { Logger } from './logs'
import { getTools, toolPath } from './tools'
import { baseHardware, testEncoders } from './hardware'
import { diskSpace } from './disk'
import { LiveService } from './live'
import { VodService } from './vod'
import { MomentsService } from './moments'
import { ClipService } from './render'
import { findWhisperModels } from './speech'
import { getSecret, setSecret } from './secrets'
import { listGeminiModels, pickGeminiModel } from './ai/gemini'
import { programDirs } from './tools'

// Protocolo próprio para as telas mostrarem miniaturas do disco (clipador://miniatura/<id>)
protocol.registerSchemesAsPrivileged([{ scheme: 'clipador', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
import { GB, clipsRoot, deleteOldest, recordingsRoot, usageBytes } from './storage'
import { defaultSettings, mergeSettings, sanitizeSettings } from '../shared/settings'
import type { AiStatus, AppInfo, ClipOptions, ClipRecord, DeepPartial, DiskInfo, HardwareInfo, Platform, Rect, Settings } from '../shared/types'

/**
 * Pasta de dados: em desenvolvimento fica em <projeto>/dados (fora do git);
 * no app instalado, na pasta de dados do usuário.
 * Usar a pasta do projeto em dev também evita a cópia privada do %APPDATA% criada
 * quando o app é aberto pelo Claude desktop.
 */
const dataDir = app.isPackaged ? join(app.getPath('userData'), 'dados') : join(dirname(app.getAppPath()), 'dados')
mkdirSync(dataDir, { recursive: true })
const dbPath = join(dataDir, 'clipador.db')

let db: Db
let logger: Logger
let queue: JobQueue
let settings: Settings
let hardware: HardwareInfo
let live: LiveService
let vod: VodService
let moments: MomentsService
let clips: ClipService
let win: BrowserWindow | null = null

const send = (channel: string, payload: unknown) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function loadSettings(): Settings {
  const s = sanitizeSettings(mergeSettings(defaultSettings(), kvGet<unknown>(db, 'settings') ?? {}))
  // Pasta salva que não é caminho absoluto volta para o padrão (evita travar o app ao abrir)
  for (const k of ['recordingsDir', 'clipsDir'] as const) if (s.storage[k] && !isAbsolute(s.storage[k])) s.storage[k] = ''
  return s
}

function saveSettings(next: Settings): Settings {
  settings = sanitizeSettings(next)
  kvSet(db, 'settings', settings)
  return settings
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
    clipsDir: clipsRoot(settings, dataDir)
  }
}

/** Aviso do Windows (some sozinho); clicar traz o app para a frente. */
function notify(title: string, body: string): void {
  if (!settings.notifications.enabled || !Notification.isSupported()) return
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
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
function aiStatus(): AiStatus {
  return { hasKey: !!getSecret(db, 'gemini'), model: settings.ai.geminiModel || null, available: geminiAvailable }
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

function registerIpc(): void {
  ipcMain.handle('app:info', (): AppInfo => ({ version: app.getVersion(), dataDir, dbPath, dev: !app.isPackaged }))
  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:update', (_e, patch: DeepPartial<Settings>) => {
    const before = settings.performance.mode
    const prevStorage = settings.storage
    const merged = mergeSettings(settings, patch)
    // Pastas só aceitam caminho absoluto (ou vazio = padrão); qualquer outra coisa mantém a anterior
    for (const k of ['recordingsDir', 'clipsDir'] as const) {
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
    return next
  })
  ipcMain.handle('settings:reset', () => {
    logger.info('ajustes', 'Ajustes restaurados para o padrão.')
    return saveSettings(defaultSettings())
  })
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
  ipcMain.handle('channels:setEnabled', (_e, id: number, enabled: boolean) => live.setEnabled(id, enabled))
  ipcMain.handle('channels:checkNow', () => live.checkNow())
  ipcMain.handle('channels:stopRecording', (_e, id: number) => live.stopRecording(id, 'ended'))
  ipcMain.handle('lives:list', (_e, limit?: number) => vod.list(limit))
  ipcMain.handle('vod:import', (_e, url: string, startS?: number | null, endS?: number | null) => vod.importVod(url, startS, endS))
  ipcMain.handle('vod:cancel', (_e, id: number) => vod.cancel(id))
  ipcMain.handle('vod:retry', (_e, id: number) => vod.retry(id))
  ipcMain.handle('lives:delete', (_e, id: number) => vod.delete(id))
  ipcMain.handle('moments:list', (_e, liveId?: number) => moments.list(liveId))
  ipcMain.handle('moments:timeline', (_e, liveId: number) => moments.timeline(liveId))
  ipcMain.handle('moments:detect', (_e, liveId: number) => moments.enqueue(liveId, 'pedido manual'))
  ipcMain.handle('moments:open', async (_e, id: number) => {
    const p = moments.segmentOf(id)
    if (p) await shell.openPath(p)
  })
  ipcMain.handle('ai:status', () => aiStatus())
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
  ipcMain.handle('clips:render', (_e, momentId: number, o: ClipOptions) => clips.request(momentId, o))
  ipcMain.handle('clips:list', (_e, liveId?: number) => clips.list(liveId))
  ipcMain.handle('clips:delete', (_e, id: number) => clips.delete(id))
  ipcMain.handle('shell:showInFolder', (_e, p: string) => shell.showItemInFolder(p))
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#1a0710',
    title: 'Clipador KTY',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a0710', symbolColor: '#f5d0e0', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  win.once('ready-to-show', () => win?.show())
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
  setHttpFetch((input, init) => net.fetch(input as string, init))
  db = openDb(dbPath)
  logger = new Logger(db)
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
  })
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
    gemini: () => {
      const key = getSecret(db, 'gemini')
      return key && settings.ai.geminiModel ? { key, model: settings.ai.geminiModel } : null
    }
  })
  moments.on('moments', (liveId: number) => send('moments', liveId))
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
    aiReady: () => settings.ai.provider === 'gemini' && !!settings.ai.geminiModel && !!getSecret(db, 'gemini')
  })
  clips.on('clips', () => send('clips', null))
  // Aviso: clipe pedido à mão avisa sozinho; os automáticos de uma live avisam juntos quando o último termina
  const autoReady = new Map<number, number>()
  clips.on('ready', (c: ClipRecord | null) => {
    if (!c) return
    if (!c.auto) return notify(`Clipe pronto: ${c.channelName}`, c.title.slice(0, 180))
    const k = c.liveId ?? 0
    autoReady.set(k, (autoReady.get(k) ?? 0) + 1)
    const pending = clips.list(c.liveId ?? undefined).some((x) => x.auto && (x.status === 'queued' || x.status === 'rendering'))
    if (pending) return
    notify(`${autoReady.get(k)} clipe(s) pronto(s): ${c.channelName}`, 'Gerados sozinhos a partir dos melhores momentos. Veja em Momentos.')
    autoReady.delete(k)
  })
  moments.on('detected', (liveId: number) => {
    notifyMoments(liveId)
    clips.autoForLive(liveId, live.activeLiveIds().has(liveId))
  })
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
  live.on('segment', (s: { liveId: number }) => moments.enqueueThrottled(s.liveId))
  live.on('recordingEnded', (liveId: number) => moments.enqueue(liveId, 'live encerrada'))
  protocol.handle('clipador', (req) => {
    const url = new URL(req.url)
    const m = url.pathname.match(/^\/(\d+)/)
    if (m && url.hostname === 'clipe') {
      const p = clips.pathOf(Number(m[1]))
      return p ? serveVideo(p, req) : new Response('não encontrado', { status: 404 })
    }
    const p = m && url.hostname === 'miniatura' ? moments.thumbPath(Number(m[1])) : null
    return p ? net.fetch(pathToFileURL(p).href) : new Response('não encontrado', { status: 404 })
  })
  registerJobs()
  registerIpc()
  createWindow()

  logger.info('app', `Clipador KTY ${app.getVersion()} iniciado. Dados em ${dataDir}.`)
  const missing = getTools(settings).filter((t) => t.required && !t.path)
  if (missing.length) logger.warn('programas', `Faltando: ${missing.map((t) => t.label).join(', ')}.`)
  if (!hardware.encodersTestedAt) queue.enqueue('diagnostico:codificadores', 'Testar codificadores de vídeo', null, { maxAttempts: 1 })

  queue.start()
  live.start()
  void enforceStorage()
  checkDisk()
  setInterval(checkDisk, 10 * 60 * 1000)
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting || !queue) return
  e.preventDefault()
  quitting = true
  // Fecha as gravações com o último pedaço íntegro antes de sair
  void Promise.allSettled([live?.stop(), queue.stop()]).finally(() => {
    db.close()
    app.quit()
  })
})

app.on('window-all-closed', () => app.quit())
