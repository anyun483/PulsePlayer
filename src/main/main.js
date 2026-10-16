'use strict';

const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const { registerSchemePrivileges, registerMediaProtocol, toMediaUrl, MIME } = require('./media-protocol');
const { readTags } = require('./metadata');

const AUDIO_EXT = new Set(Object.keys(MIME));

let mainWindow = null;

/* -------------------- 设置持久化 -------------------- */
const storePath = () => path.join(app.getPath('userData'), 'settings.json');
const defaults = {
  volume: 0.85,
  muted: false,
  theme: 'neon',
  preset: 'neon-bars',
  shuffle: false,
  repeat: 'all',
  sensitivity: 1.0,
  windowBounds: null,
};

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    return { ...defaults, ...raw };
  } catch {
    return { ...defaults };
  }
}
function saveSettings(patch) {
  const cur = loadSettings();
  const next = { ...cur, ...patch };
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    console.error('settings save failed', e);
  }
}

/* -------------------- 单实例锁 -------------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

registerSchemePrivileges();

/* -------------------- 窗口 -------------------- */
function createWindow() {
  const settings = loadSettings();
  const b = settings.windowBounds || {};

  mainWindow = new BrowserWindow({
    width: b.width || 1280,
    height: b.height || 800,
    x: b.x,
    y: b.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#05060a',
    autoHideMenuBar: true,
    title: 'PulsePlayer',
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen()) return;
    saveSettings({ windowBounds: mainWindow.getNormalBounds() });
  };
  mainWindow.on('resized', persistBounds);
  mainWindow.on('moved', persistBounds);
  mainWindow.on('closed', () => { mainWindow = null; });

  // 外部链接走系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* -------------------- 全局媒体键 -------------------- */
function registerShortcuts() {
  const targets = {
    MediaPlayPause: 'playpause',
    MediaNextTrack: 'next',
    MediaPreviousTrack: 'prev',
    MediaStop: 'stop',
  };
  for (const [accel, cmd] of Object.entries(targets)) {
    try {
      const ok = globalShortcut.register(accel, () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut', cmd);
      });
      if (!ok) console.warn(`媒体键 ${accel} 已被其他程序占用，本次不响应`);
    } catch (e) {
      console.warn('shortcut failed', accel, e.message);
    }
  }
}

/* -------------------- 目录扫描 -------------------- */
async function scanDir(dir) {
  const out = [];
  const audio = [];
  const SKIP = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information', '.workbuddy']);

  async function walk(dirPath, depth) {
    if (depth > 8 || out.length >= 5000) return;
    let entries;
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= 5000) return;
      const full = path.join(dirPath, e.name);
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
        await walk(full, depth + 1);
      } else if (e.isFile() && AUDIO_EXT.has(path.extname(e.name).toLowerCase())) {
        audio.push(full);
      }
    }
  }

  await walk(dir, 0);

  // 读取标签（限制并发，避免一次性打开上千个句柄）
  const LIMIT = 8;
  for (let i = 0; i < audio.length; i += LIMIT) {
    const slice = audio.slice(i, i + LIMIT);
    const tagged = await Promise.all(
      slice.map(async (p) => {
        const t = await readTags(p);
        return { path: p, name: path.basename(p), ...t };
      })
    );
    out.push(...tagged);
  }
  return out;
}

/* -------------------- IPC -------------------- */
function setupIpc() {
  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:set', (_e, patch) => {
    saveSettings(patch || {});
    return true;
  });

  ipcMain.handle('library:pickFiles', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择音乐文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '音频文件', extensions: ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'aif', 'aiff', 'ape', 'webm'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths.length) return [];
    const out = [];
    for (let i = 0; i < res.filePaths.length; i += 8) {
      const slice = res.filePaths.slice(i, i + 8);
      out.push(
        ...(await Promise.all(
          slice.map(async (p) => ({ path: p, name: path.basename(p), ...(await readTags(p)) }))
        ))
      );
    }
    return out;
  });

  ipcMain.handle('library:pickFolder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择音乐文件夹（递归扫描）',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return [];
    return scanDir(res.filePaths[0]);
  });

  ipcMain.handle('library:scanPaths', async (_e, paths) => {
    const out = [];
    for (const p of paths || []) {
      try {
        const st = await fsp.stat(p);
        if (st.isDirectory()) {
          out.push(...(await scanDir(p)));
        } else if (st.isFile() && AUDIO_EXT.has(path.extname(p).toLowerCase())) {
          out.push({ path: p, name: path.basename(p), ...(await readTags(p)) });
        }
      } catch { /* 跳过不可读项 */ }
    }
    return out;
  });

  // 把本地路径转成协议 URL，渲染进程用它作为 <audio> src
  ipcMain.handle('media:url', (_e, absPath) => toMediaUrl(absPath));
  // 渲染进程 drag&drop 拿到的可能已经是 file:// URL
  ipcMain.handle('media:toUrl', (_e, raw) => {
    let p = String(raw || '');
    if (p.startsWith('file://')) {
      try { p = decodeURIComponent(new URL(p).pathname.replace(/^\/([A-Za-z]:)/, '$1')); }
      catch { /* 原样处理 */ }
    }
    return toMediaUrl(p);
  });

  ipcMain.handle('shell:showItem', (_e, p) => { shell.showItemInFolder(p); });

  ipcMain.handle('window:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => mainWindow && mainWindow.close());
}

/* -------------------- 生命周期 -------------------- */
app.whenReady().then(() => {
  registerMediaProtocol();
  setupIpc();
  registerShortcuts();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});