import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api } from '../shared/types'

const subscribe =
  <T>(channel: string) =>
  (cb: (v: T) => void) => {
    const fn = (_e: IpcRendererEvent, v: T) => cb(v)
    ipcRenderer.on(channel, fn)
    return () => {
      ipcRenderer.removeListener(channel, fn)
    }
  }

const api: Api = {
  appInfo: () => ipcRenderer.invoke('app:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  getTools: (refresh) => ipcRenderer.invoke('tools:get', refresh),
  getHardware: () => ipcRenderer.invoke('hardware:get'),
  testEncoders: () => ipcRenderer.invoke('hardware:testEncoders'),
  getDisk: () => ipcRenderer.invoke('disk:get'),
  listJobs: (limit) => ipcRenderer.invoke('jobs:list', limit),
  cancelJob: (id) => ipcRenderer.invoke('jobs:cancel', id),
  retryJob: (id) => ipcRenderer.invoke('jobs:retry', id),
  clearFinishedJobs: () => ipcRenderer.invoke('jobs:clearFinished'),
  listLogs: (limit) => ipcRenderer.invoke('logs:list', limit),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  pickFolder: (title, current) => ipcRenderer.invoke('dialog:pickFolder', title, current),
  onJob: subscribe('job'),
  onLog: subscribe('log'),
  onHardware: subscribe('hardware'),
  listChannels: () => ipcRenderer.invoke('channels:list'),
  addChannel: (platform, input) => ipcRenderer.invoke('channels:add', platform, input),
  removeChannel: (id) => ipcRenderer.invoke('channels:remove', id),
  setChannelEnabled: (id, enabled) => ipcRenderer.invoke('channels:setEnabled', id, enabled),
  checkChannelsNow: () => ipcRenderer.invoke('channels:checkNow'),
  stopRecording: (id) => ipcRenderer.invoke('channels:stopRecording', id),
  onChannels: subscribe('channels'),
  listLives: (limit) => ipcRenderer.invoke('lives:list', limit),
  importVod: (url, startS, endS) => ipcRenderer.invoke('vod:import', url, startS, endS),
  cancelImport: (id) => ipcRenderer.invoke('vod:cancel', id),
  retryImport: (id) => ipcRenderer.invoke('vod:retry', id),
  deleteLive: (id) => ipcRenderer.invoke('lives:delete', id),
  onLives: subscribe('lives'),
  listMoments: (liveId) => ipcRenderer.invoke('moments:list', liveId),
  getTimeline: (liveId) => ipcRenderer.invoke('moments:timeline', liveId),
  detectNow: (liveId) => ipcRenderer.invoke('moments:detect', liveId),
  openMoment: (id) => ipcRenderer.invoke('moments:open', id),
  onMoments: subscribe('moments'),
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  setGeminiKey: (key) => ipcRenderer.invoke('ai:setGeminiKey', key),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  speechModels: () => ipcRenderer.invoke('speech:models'),
  clipDraft: (momentId) => ipcRenderer.invoke('clips:draft', momentId),
  previewClip: (momentId, options) => ipcRenderer.invoke('clips:preview', momentId, options),
  momentFrame: (momentId) => ipcRenderer.invoke('clips:frame', momentId),
  setFacecam: (channelId, rect) => ipcRenderer.invoke('clips:setFacecam', channelId, rect),
  renderClip: (momentId, options) => ipcRenderer.invoke('clips:render', momentId, options),
  listClips: (liveId) => ipcRenderer.invoke('clips:list', liveId),
  deleteClip: (id) => ipcRenderer.invoke('clips:delete', id),
  reviewClip: (id, review) => ipcRenderer.invoke('clips:review', id, review),
  dismissMoment: (id) => ipcRenderer.invoke('moments:dismiss', id),
  showInFolder: (p) => ipcRenderer.invoke('shell:showInFolder', p),
  onClips: subscribe('clips')
}

contextBridge.exposeInMainWorld('api', api)
