import { useCallback, useEffect, useState } from 'react'
import type { AppInfo, ChannelState, ClipRecord, DeepPartial, DiskInfo, HardwareInfo, Job, LiveRecord, LogEntry, Settings, ToolInfo } from '../../shared/types'

export interface AppState {
  info: AppInfo | null
  settings: Settings | null
  tools: ToolInfo[]
  hardware: HardwareInfo | null
  disk: DiskInfo | null
  jobs: Job[]
  logs: LogEntry[]
  channels: ChannelState[]
  lives: LiveRecord[]
  /** Todos os clipes (para a tela Clipes, o Início e o número no menu) */
  clips: ClipRecord[]
  refreshLives(): Promise<void>
  updateSettings(patch: DeepPartial<Settings>): Promise<void>
  resetSettings(): Promise<void>
  refreshTools(): Promise<void>
  refreshDisk(): Promise<void>
  clearFinishedJobs(): Promise<void>
}

/** Estado global das telas, carregado do processo principal e atualizado por eventos. */
export function useAppState(): AppState {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [disk, setDisk] = useState<DiskInfo | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [channels, setChannels] = useState<ChannelState[]>([])
  const [lives, setLives] = useState<LiveRecord[]>([])
  const [clips, setClips] = useState<ClipRecord[]>([])

  useEffect(() => {
    const api = window.api
    void api.listClips().then(setClips)
    const offClips = api.onClips(() => void api.listClips().then(setClips))
    // A biblioteca muda com muitos eventos (pedaços, chat, progresso): recarrega no máximo a cada 1 s
    let livesTimer: ReturnType<typeof setTimeout> | null = null
    const reloadLives = () => {
      if (livesTimer) return
      livesTimer = setTimeout(() => {
        livesTimer = null
        void api.listLives().then(setLives)
      }, 1000)
    }
    void api.listLives().then(setLives)
    const offLives = api.onLives(reloadLives)
    void Promise.all([api.appInfo(), api.getSettings(), api.getTools(), api.getHardware(), api.getDisk(), api.listJobs(), api.listLogs(), api.listChannels()]).then(
      ([i, s, t, h, d, j, l, c]) => {
        setInfo(i)
        setSettings(s)
        setTools(t)
        setHardware(h)
        setDisk(d)
        setJobs(j)
        setLogs(l)
        setChannels(c)
      }
    )
    const offChannels = api.onChannels(setChannels)
    const offJob = api.onJob((job) => {
      if (job.type.startsWith('vod:')) reloadLives()
      setJobs((prev) => {
        const idx = prev.findIndex((x) => x.id === job.id)
        if (idx === -1) return [job, ...prev].slice(0, 200)
        const next = prev.slice()
        next[idx] = job
        return next
      })
    })
    const offLog = api.onLog((e) => setLogs((prev) => [...prev, e].slice(-300)))
    const offHw = api.onHardware(setHardware)
    const t = setInterval(() => void api.getDisk().then(setDisk), 60_000)
    return () => {
      offJob()
      offLog()
      offHw()
      offChannels()
      offLives()
      offClips()
      if (livesTimer) clearTimeout(livesTimer)
      clearInterval(t)
    }
  }, [])

  const updateSettings = useCallback(async (patch: DeepPartial<Settings>) => {
    setSettings(await window.api.updateSettings(patch))
  }, [])
  const resetSettings = useCallback(async () => {
    setSettings(await window.api.resetSettings())
  }, [])
  const refreshTools = useCallback(async () => {
    setTools(await window.api.getTools(true))
  }, [])
  const refreshDisk = useCallback(async () => {
    setDisk(await window.api.getDisk())
  }, [])

  const clearFinishedJobs = useCallback(async () => {
    await window.api.clearFinishedJobs()
    setJobs(await window.api.listJobs())
  }, [])

  const refreshLives = useCallback(async () => {
    setLives(await window.api.listLives())
  }, [])

  return { info, settings, tools, hardware, disk, jobs, logs, channels, lives, clips, refreshLives, updateSettings, resetSettings, refreshTools, refreshDisk, clearFinishedJobs }
}
