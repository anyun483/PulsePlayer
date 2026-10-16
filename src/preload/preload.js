'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * 渲染进程只能通过这里访问主进程能力。
 * contextIsolation 开启，不暴露任何 Node API。
 */
contextBridge.exposeInMainWorld('pulse', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  pickFiles: () => ipcRenderer.invoke('library:pickFiles'),
  pickFolder: () => ipcRenderer.invoke('library:pickFolder'),
  scanPaths: (paths) => ipcRenderer.invoke('library:scanPaths', paths),

  toMediaUrl: (absPath) => ipcRenderer.invoke('media:url', absPath),
  normalizeDropped: (raw) => ipcRenderer.invoke('media:toUrl', raw),

  showInFolder: (p) => ipcRenderer.invoke('shell:showItem', p),

  winMinimize: () => ipcRenderer.invoke('window:minimize'),
  winToggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  winClose: () => ipcRenderer.invoke('window:close'),

  onShortcut: (cb) => {
    const handler = (_e, cmd) => cb(cmd);
    ipcRenderer.on('shortcut', handler);
    return () => ipcRenderer.removeListener('shortcut', handler);
  },

  /**
   * Electron 32+ 移除了 File.path，用 webUtils 换取真实磁盘路径。
   * 这是拖拽导入能读到任意目录的关键。
   */
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
});