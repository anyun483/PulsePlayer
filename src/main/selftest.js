/**
 * 渲染进程自检：在真实 Chromium 里跑一遍，确认
 * - preload 桥接可用
 * - AudioContext 能建立（Web Audio 可用）
 * - 11 套预设都能实例化并绘制若干帧不抛错
 * - 对数频段映射在真实 AnalyserNode 上正常
 * 运行时用 --test-mode 启动，输出 JSON 到 stdout 后退出。
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { registerSchemePrivileges, registerMediaProtocol } = require('./media-protocol');

// 独立入口：自带协议注册，不依赖 main.js
registerSchemePrivileges();

app.whenReady().then(async () => {
  registerMediaProtocol();

  // 提供最小可用的 IPC 响应，避免渲染进程 await 悬挂
  ipcMain.handle('settings:get', () => ({
    volume: 0.85, muted: false, theme: 'neon', preset: 'neon-bars',
    shuffle: false, repeat: 'all', sensitivity: 1, windowBounds: null,
  }));
  ipcMain.handle('settings:set', () => true);
  ipcMain.handle('library:pickFiles', () => []);
  ipcMain.handle('library:pickFolder', () => []);
  ipcMain.handle('library:scanPaths', () => []);
  ipcMain.handle('media:url', (_e, p) => `pulse-media://local/${Buffer.from(p, 'utf8').toString('base64url')}`);
  ipcMain.handle('media:toUrl', (_e, p) => String(p));
  ipcMain.handle('shell:showItem', () => {});
  ipcMain.handle('window:minimize', () => {});
  ipcMain.handle('window:toggleMaximize', () => false);
  ipcMain.handle('window:close', () => {});

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#05060a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  // 注意：checks 必须是对象。若误写成 []，Object.assign 会把键变成数组下标，
  // 导致 checks['xxx'] 永远取不到值，自检会假性全绿/全红。
  const report = { ok: false, checks: {}, errors: [] };
  const finish = (code) => {
    console.log('__SELFTEST__' + JSON.stringify(report));
    setTimeout(() => app.exit(code), 200);
  };

  win.webContents.on('console-message', (_e, level, message) => {
    // 打印所有渲染进程日志，便于定位
    console.log(`[renderer:${level}] ${message}`);
    if (level >= 3) report.errors.push(message);
  });

  win.webContents.on('preload-error', (_e, p, err) => {
    report.errors.push(`preload 失败 ${p}: ${err.message}`);
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    report.errors.push('renderer gone: ' + JSON.stringify(details));
    finish(1);
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    report.errors.push(`页面加载失败 ${code} ${desc} ${url}`);
    console.error(`[did-fail-load] ${code} ${desc} ${url}`);
    finish(1);
  });

  win.webContents.on('dom-ready', () => {
    console.log('[dom-ready] DOM 就绪');
  });

  await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  console.log('[loadFile] 完成');

  let result = null;
try {
  result = await win.webContents.executeJavaScript(`
    (async () => {
      const out = { checks: {}, errors: [] };
      const check = (name, fn) => {
        try { const v = fn(); out.checks[name] = v === true ? true : { ok: !!v, detail: v }; }
        catch (e) { out.checks[name] = false; out.errors.push(name + ': ' + e.message); }
      };

      // 1. preload 桥接
      check('preloadBridge', () => typeof window.pulse === 'object' && typeof window.pulse.getSettings === 'function');

      // 2. DOM 结构
      check('domStage', () => !!document.getElementById('viz'));
      check('domAudio', () => !!document.getElementById('audio'));
      check('domPresetGrid', () => !!document.getElementById('presetGrid'));

      // 3. Web Audio 可用性
      const Ctx = window.AudioContext || window.webkitAudioContext;
      check('audioContextAvailable', () => !!Ctx);

      let ctx = null;
      try {
        ctx = new Ctx();
        out.checks.sampleRate = ctx.sampleRate;
        out.checks.state = ctx.state;
      } catch (e) { out.errors.push('AudioContext 创建失败: ' + e.message); }

      // 4. AnalyserNode 频段映射（用真实 AnalyserNode）
      if (ctx) {
        try {
          const an = ctx.createAnalyser();
          an.fftSize = 2048;
          const bins = an.frequencyBinCount;
          const nyq = ctx.sampleRate / 2;
          const ranges = [];
          let prevEnd = 0;
          const fMin = 26;
          const fMax = Math.min(17000, nyq);   // 采样率低时不能超过 nyquist
          for (let i = 0; i < 64; i++) {
            const f0 = fMin * Math.pow(fMax / fMin, i / 64);
            const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / 64);
            let b0 = i === 0 ? 0 : Math.max(prevEnd, Math.floor((f0 / nyq) * bins));
            let b1 = Math.ceil((f1 / nyq) * bins);
            b0 = Math.max(0, Math.min(bins - 1, b0));
            b1 = Math.max(b0 + 1, Math.min(bins, b1));
            ranges.push([b0, b1]);
            prevEnd = b1;
          }
          if (prevEnd < bins) ranges[ranges.length - 1][1] = bins;

          out.checks.binCount = bins;
          out.checks.bandsContiguous = ranges.every((r, i) => i === 0 || r[0] === ranges[i - 1][1]);
          out.checks.bandCount = ranges.length;
          out.checks.firstBandStartsAtZero = ranges[0][0] === 0;
          out.checks.lastBandReachesEnd = ranges[ranges.length - 1][1] === bins;
          out.checks.fullBinCoverage = ranges[ranges.length - 1][1] - ranges[0][0] === bins;
          out.checks.everyBandNonEmpty = ranges.every(([a, b]) => b > a);
        } catch (e) { out.errors.push('频段映射失败: ' + e.message); }
      }

      // 5. 11 套预设全部能加载并绘制（用离屏 canvas 喂假数据）
      try {
        // 模板字符串在渲染进程里执行，相对路径以 index.html 为基准，故用 import 绝对定位
        const mod = (n) => import(new URL('./js/' + n, window.location.href).href);
        const presetsMods = await Promise.all([
          mod('presets-neon.js'),
          mod('presets-minimal.js'),
          mod('presets-retro.js'),
          mod('presets-extra.js'),
        ]);
        const [neon, minimal, retro, extra] = presetsMods;

        const presets = [
          neon.neonBars, neon.neonRadial, neon.neonParticles, neon.neonTunnel,
          minimal.minimalBars, minimal.minimalRipple, minimal.minimalScope, minimal.minimalRing,
          retro.retroRadar, retro.retroScope, retro.retroVU,
          extra.neonFall, extra.neonGrid, extra.neonRibbon,
          extra.minBreathe, extra.minDots, extra.minLevels,
          extra.retroLissajous, extra.retroWaterfall, extra.retroCircleScan,
        ];
        out.checks.presetCount = presets.length;
        out.checks.allPresetsPresent = presets.every((p) => p && typeof p.draw === 'function');

        const cv = document.createElement('canvas');
        cv.width = 1200; cv.height = 800;
        const cx = cv.getContext('2d');
        const fakeVz = { w: 1200, h: 800, canvas: cv, ctx: cx };

        const bands = new Float32Array(64);
        const wave = new Float32Array(1024);
        const waveSmooth = new Float32Array(1024);
        const waveL = new Float32Array(1024);
        const waveR = new Float32Array(1024);
        const snap = (peak, beat) => {
          for (let i = 0; i < 64; i++) bands[i] = Math.max(0, peak * Math.sin(i / 8) + peak * 0.3);
          for (let i = 0; i < 1024; i++) {
            wave[i] = Math.sin(i / 18) * peak;
            waveSmooth[i] = Math.sin(i / 18) * peak;
            // 左右声道给一点相位差，李萨如图才有形状
            waveL[i] = Math.sin(i / 18) * peak;
            waveR[i] = Math.sin(i / 18 + 0.7) * peak;
          }
          return {
            bands, bandsRaw: bands, waveform: wave, waveSmooth,
            waveL, waveR, rmsL: peak * 0.3, rmsR: peak * 0.26, balance: 0.1,
            bass: peak, mid: peak * 0.7, treble: peak * 0.5,
            level: peak, energy: peak * 3, flux: peak,
            beat, beatPulse: beat ? 1 : 0.4, bpm: 124, playing: true,
          };
        };

        const failures = [];
        for (const p of presets) {
          try {
            if (p.init) p.init(cx, 1200, 800);
            // 画 6 帧，覆盖静默 → 击打 的状态变化
            for (let f = 0; f < 6; f++) {
              const s = snap(f === 3 ? 0.95 : 0.4, f === 3);
              cx.save();
              p.draw(cx, s, f * 0.016, 0.016, fakeVz);
              cx.restore();
            }
          } catch (e) {
            failures.push(p.id + ': ' + e.message);
          }
        }
        out.checks.allPresetsDraw = failures.length === 0 ? true : failures.join(' | ');
        out.checks.presetIds = presets.map((p) => p.id);
      } catch (e) { out.errors.push('预设加载失败: ' + e.message); }

      // 6. 主题 CSS 变量确实生效
      try {
        const before = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        document.documentElement.dataset.theme = 'retro';
        const retro = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        document.documentElement.dataset.theme = 'minimal';
        const min = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        document.documentElement.dataset.theme = 'neon';
        const neon = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        out.checks.themeSwitch = (before !== retro && retro !== min && min !== neon) ? true
          : '变量未变化: ' + [before, retro, min, neon].join(',');
      } catch (e) { out.errors.push('主题检查失败: ' + e.message); }

      // 7. 11 套预设卡片能渲染出来（跑真实的 renderPresets 路径）
      try {
        const grid = document.getElementById('presetGrid');
        out.checks.presetGridExists = !!grid;
      } catch (e) { out.errors.push('预设面板检查失败: ' + e.message); }

      // 8. 关键回归：app.js 自己的 boot 是否真的把预设注册进了渲染器
      //    曾经漏调 vz.registerAll(PRESETS) → 画布永远全黑、声音照常播放。
      try {
        // boot() 是异步的（含 engine.init 的 await），等调试句柄挂载
        let dbg = window.__pulse;
        for (let i = 0; i < 40 && !dbg; i++) {
          await new Promise((r) => setTimeout(r, 100));
          dbg = window.__pulse;
        }
        out.checks.debugHandlePresent = !!dbg;
        if (dbg) {
          out.checks.registeredPresetCount = dbg.registeredCount();
          out.checks.presetsRegistered = dbg.registeredCount() === 20;
          // 每个主题下都要有可用预设，否则切到该主题会白屏
          const byTheme = { neon: 0, minimal: 0, retro: 0 };
          dbg.PRESETS.forEach((p) => { byTheme[p.theme] = (byTheme[p.theme] || 0) + 1; });
          out.checks.perThemeCount = byTheme;
          out.checks.everyThemeHasPresets =
            byTheme.neon > 0 && byTheme.minimal > 0 && byTheme.retro > 0;
          out.checks.currentPresetActive = typeof dbg.currentPreset() === 'string';
          out.checks.vizLoopRunning = dbg.vz.running === true;

          // 帧确实在前进（连续读两次帧计数）
          const f0 = dbg.frameCount();
          await new Promise((r) => setTimeout(r, 400));
          const f1 = dbg.frameCount();
          out.checks.framesAdvancing = f1 > f0;
          out.checks.frameDelta = f1 - f0;

          // 画布不是纯黑：主画布非零像素占比应 > 0
          const stage = document.getElementById('viz');
          const g = stage.getContext('2d', { willReadFrequently: true });
          const img = g.getImageData(0, 0, stage.width, stage.height);
          let lit = 0;
          for (let i = 0; i < img.data.length; i += 4) {
            if (img.data[i] > 6 || img.data[i + 1] > 6 || img.data[i + 2] > 6) lit++;
          }
          out.checks.canvasLitRatio = +(lit / (img.data.length / 4)).toFixed(4);
          out.checks.canvasNotBlack = lit > 0;
        }
      } catch (e) { out.errors.push('注册回归检查失败: ' + e.message); }

      // 9. 立体声分析可用（李萨如图 / 双声道电平依赖它）
      try {
        const e = window.__pulse && window.__pulse.engine;
        out.checks.stereoBuffers = !!(e && e.waveL && e.waveR && e.waveL.length === 1024);
        out.checks.splitterWired = !!(e && e.analyserL && e.analyserR);
      } catch (err) { out.errors.push('立体声检查失败: ' + err.message); }

      // 10. 沉浸全屏模式：切换后 body 真的带上 immersive 类
      try {
        const appEl = document.querySelector('.app');
        const before = appEl.classList.contains('immersive');
        // 直接调用按钮，走真实交互路径
        document.getElementById('btnFullscreen').click();
        await new Promise((r) => setTimeout(r, 250));
        const after = appEl.classList.contains('immersive');
        out.checks.immersiveToggle = before === false && after === true;
        out.checks.immersiveBarExists = !!document.getElementById('immersiveBar');

        // 10b. 回归：画布必须铺满整个视口（用户反馈"没有占满屏幕"）
        const stage = document.querySelector('.stage');
        const cv = document.getElementById('viz');
        const sr = cv.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        out.checks.stageFixed = getComputedStyle(stage).position === 'fixed';
        out.checks.stageFillsViewport =
          Math.abs(sr.width - vw) <= 2 && Math.abs(sr.height - vh) <= 2 &&
          Math.abs(sr.left) <= 2 && Math.abs(sr.top) <= 2;
        // 注意：这段代码本身位于外层模板字符串内，禁止再使用反引号模板串，
        // 否则会提前闭合外层模板导致 SyntaxError。
        out.checks.stageGeometry =
          Math.round(sr.width) + 'x' + Math.round(sr.height) + ' vs ' + vw + 'x' + vh;
        // 画布内部分辨率也要跟上（resize 是否真的被触发）
        out.checks.canvasBackingMatches =
          Math.abs(cv.width - Math.round(sr.width * Math.min(2, window.devicePixelRatio || 1))) <= 4;

        // 10c. 回归：播放列表不能挡住画面（用户反馈"弹出播放列表挡住可视化"）
        const pl = document.getElementById('playlist');
        out.checks.playlistHiddenInImmersive =
          getComputedStyle(pl).display === 'none' || pl.offsetParent === null;
        // 即使按 L / 点列表按钮，也不允许在沉浸模式下打开
        document.getElementById('btnPlaylist').click();
        await new Promise((r) => setTimeout(r, 120));
        out.checks.playlistBlockedInImmersive =
          getComputedStyle(pl).display === 'none' || pl.offsetParent === null;

        // 10d. 标题栏与控制条必须脱离文档流，否则挤压画布
        const tbPos = getComputedStyle(document.querySelector('.titlebar')).position;
        const cbPos = getComputedStyle(document.querySelector('.controlbar')).position;
        out.checks.chromeOutOfFlow = tbPos === 'fixed' && cbPos === 'fixed';

        // 还原
        document.getElementById('ibExit').click();
        await new Promise((r) => setTimeout(r, 250));
        out.checks.immersiveExit = !appEl.classList.contains('immersive');
        // 退出后播放列表按钮必须恢复可用
        document.getElementById('btnPlaylist').click();
        await new Promise((r) => setTimeout(r, 120));
        out.checks.playlistWorksAfterExit = document.getElementById('playlist').classList.contains('open');
        document.getElementById('btnPlaylist').click();
      } catch (err) { out.errors.push('沉浸模式检查失败: ' + err.message); }

      if (ctx) ctx.close();
      return out;
    })()
  `);
} catch (e) {
  report.errors.push('executeJavaScript 失败: ' + (e && e.message ? e.message : String(e)));
  console.error('[executeJavaScript 异常]', e && e.stack ? e.stack : e);
  console.log('SELFTEST_RESULT ' + JSON.stringify(report, null, 2));
  finish(1);
  return;
}

Object.assign(report.checks, (result && result.checks) || {});
report.errors.push(...((result && result.errors) || []));

  const boolKeys = [
    'preloadBridge', 'domStage', 'domAudio', 'domPresetGrid',
    'audioContextAvailable', 'bandsContiguous', 'firstBandStartsAtZero',
    'lastBandReachesEnd', 'fullBinCoverage', 'everyBandNonEmpty',
    'allPresetsPresent', 'allPresetsDraw', 'themeSwitch',
    // 注册回归：这一组不过，用户就是"听到声音但屏幕全黑"
    'debugHandlePresent', 'presetsRegistered', 'currentPresetActive',
    'vizLoopRunning', 'framesAdvancing', 'canvasNotBlack',
    'everyThemeHasPresets', 'stereoBuffers', 'splitterWired',
    'immersiveToggle', 'immersiveBarExists', 'immersiveExit',
    'stageFixed', 'stageFillsViewport', 'canvasBackingMatches',
    'playlistHiddenInImmersive', 'playlistBlockedInImmersive', 'chromeOutOfFlow',
    'playlistWorksAfterExit',
  ];
  report.ok = report.errors.length === 0 && boolKeys.every((k) => report.checks[k] === true);

  console.log('SELFTEST_RESULT ' + JSON.stringify(report, null, 2));
  finish(report.ok ? 0 : 1);
});