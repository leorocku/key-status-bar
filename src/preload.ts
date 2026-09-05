// preload.ts
//
// contextBridge 白名单：renderer 与主进程之间的唯一通道。
// 安全模型是 contextIsolation + nodeIntegration:false，renderer 永远不直接
// 接触 ipcRenderer——每个暴露的方法就是一次显式授权，不要为省事加透传方法。
//
// 方法签名由 types.d.ts 的 ElectronAPI 接口约束（api 常量的类型标注），
// 新增 IPC 通道必须同步改 main.ts handler、本文件、types.d.ts 三处。
import { contextBridge, ipcRenderer } from 'electron';

const api: ElectronAPI = {
  // Config CRUD
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),

  // Key state stream from main process
  onKeysUpdate: (callback) => {
    ipcRenderer.on('keys-update', (_event, keys) => callback(keys));
  },

  // Config change notification
  onConfigChange: (callback) => {
    ipcRenderer.on('config-changed', (_event, config) => callback(config));
  },

  // Caps Lock state updates
  onCapsUpdate: (callback) => {
    ipcRenderer.on('caps-update', (_event, capsOn) => callback(capsOn));
  },

  // Force-release notification (auto-correct fired)
  onForceRelease: (callback) => {
    ipcRenderer.on('force-release', (_event, info) => callback(info));
  },

  // Request window resize (called by statusbar on content change)
  resizeWindow: (width, height) => {
    ipcRenderer.send('resize-window', { width, height });
  }
};

contextBridge.exposeInMainWorld('electronAPI', api);
