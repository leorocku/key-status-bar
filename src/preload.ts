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
