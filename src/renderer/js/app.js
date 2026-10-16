/**
 * 应用主控制器
 * 串起：音频引擎 → 可视化 → 播放控制 → UI 事件 → 设置持久化
 */

import { AudioEngine, renderDemoTrack } from './audio-engine.js';
import { Visualizer } from './visualizer.js';
import { Player } from './player.js';

import { neonBars, neonRadial, neonParticles, neonTunnel } from './presets-neon.js';
import { minimalBars, minimalRipple, minimalScope, minimalRing } from './presets-minimal.js';
import { retroRadar, retroScope, retroVU } from './presets-retro.js';
import {
  neonFall, neonGrid, neonRibbon,
  minBreathe, minDots, minLevels,
  retroLissajous, retroWaterfall, retroCircleScan,
} from './presets-extra.js';

const PRESETS = [
  neonBars, neonRadial, neonParticles, neonTunnel, neonFall, neonGrid, neonRibbon,
  minimalBars, minimalRipple, minimalScope, minimalRing, minBreathe, minDots, minLevels,
  retroRadar, retroScope, retroVU, retroLissajous, retroWaterfall, retroCircleScan,
];

const THEMES = {
  neon: { label: '霓虹赛博', presets: PRESETS.filter((p) => p.theme === 'neon') },
  minimal: { label: '极简暗色', presets: PRESETS.filter((p) => p.theme === 'minimal') },
  retro: { label: '复古终端', presets: PRESETS.filter((p) => p.theme === 'retro') },
};

const $ = (id) => document.getElementById(id);

const el = {
  html: document.documentElement,
  viz: $('viz'),
  audio: $('audio'),
  empty: $('empty'),
  dropzone: $('dropzone'),
  overlayInfo: $('overlayInfo'),
  oiArt: $('oiArt'),
  oiArtIcon: $('oiArtIcon'),
  oiTitle: $('oiTitle'),
  oiArtist: $('oiArtist'),
  nmTitle: $('nmTitle'),
  nmArtist: $('nmArtist'),
  bpmBadge: $('bpmBadge'),
  bpmNum: $('bpmNum'),
  playlist: $('playlist'),
  plList: $('plList'),
  plCount: $('plCount'),
  plFilter: $('plFilter'),
  plSummary: $('plSummary'),
  seek: $('seek'),
  seekFill: $('seekFill'),
  seekBuffer: $('seekBuffer'),
  seekKnob: $('seekKnob'),
  tCur: $('tCur'),
  tDur: $('tDur'),
  btnPlay: $('btnPlay'),
  btnPrev: $('btnPrev'),
  btnNext: $('btnNext'),
  btnShuffle: $('btnShuffle'),
  btnRepeat: $('btnRepeat'),
  repeatBadge: $('repeatBadge'),
  btnMute: $('btnMute'),
  volSeek: $('volSeek'),
  volFill: $('volFill'),
  volKnob: $('volKnob'),
  btnVis: $('btnVis'),
  btnTheme: $('btnTheme'),
  btnPlaylist: $('btnPlaylist'),
  visPanel: $('visPanel'),
  presetGrid: $('presetGrid'),
  themeTabs: $('themeTabs'),
  sensSlider: $('sensSlider'),
  sensVal: $('sensVal'),
  hud: $('hud'),
  toast: $('toast'),
};

const state = {
  theme: 'neon',
  preset: 'neon-bars',
  filter: '',
  settings: null,
  demoTrack: null,
  demoBusy: false,
  hduFps: 0,
  fpsAcc: 0,
  fpsCount: 0,
  scrubbing: false,
};

const engine = new AudioEngine();
const player = new Player(engine, el.audio);
const vz = new Visualizer(el.viz, engine);

/* ============================================================
   工具
   ============================================================ */
function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

let toastTimer = null;
function toast(msg, isErr = false) {
  el.toast.textContent = msg;
  el.toast.classList.toggle('err', isErr);
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), isErr ? 4200 : 2400);
}

function totalDuration() {
  return player.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
}

/* ============================================================
   主题 / 预设
   ============================================================ */
function applyTheme(theme, persist = true) {
  if (!THEMES[theme]) return;
  state.theme = theme;
  el.html.dataset.theme = theme;

  // 主题可用预设的第一个作为默认
  const list = THEMES[theme].presets;
  let target = list.find((p) => p.id === state.preset);
  if (!target) {
    target = list[0];
    state.preset = target.id;
  }
  vz.setPreset(target.id);

  renderPresets();
  updateThemeTabs();
  if (persist) saveSettings({ theme, preset: state.preset });
}

function renderPresets() {
  const list = THEMES[state.theme].presets;
  el.presetGrid.innerHTML = '';
  list.forEach((p) => {
    const card = document.createElement('button');
    card.className = 'pcard' + (p.id === state.preset ? ' active' : '');
    card.dataset.preset = p.id;
    card.innerHTML = `
      <div class="pcard-name">
        ${p.id === state.preset ? '<span class="pcard-active-dot"></span>' : ''}
        ${p.name}
      </div>
      <div class="pcard-hint">${p.hint || ''}</div>
    `;
    card.addEventListener('click', () => {
      state.preset = p.id;
      vz.setPreset(p.id);
      renderPresets();
      updateImmersiveInfo();
      saveSettings({ preset: p.id });
      toast(`可视化：${p.name}`);
    });
    el.presetGrid.appendChild(card);
  });
}

function updateThemeTabs() {
  el.themeTabs.querySelectorAll('.ttab').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === state.theme);
  });
}

function cycleTheme() {
  const keys = Object.keys(THEMES);
  const next = keys[(keys.indexOf(state.theme) + 1) % keys.length];
  applyTheme(next);
  toast(`风格：${THEMES[next].label} · ${THEMES[next].presets.length} 套预设`);
}

function cyclePreset() {
  const list = THEMES[state.theme].presets;
  const i = list.findIndex((p) => p.id === state.preset);
  const next = list[(i + 1) % list.length];
  state.preset = next.id;
  vz.setPreset(next.id);
  renderPresets();
  saveSettings({ preset: next.id });
  toast(`可视化：${next.name}`);
}

let saveTimer = null;
function saveSettings(patch) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.pulse.setSettings(patch).catch(() => { /* 忽略写入失败 */ });
  }, 220);
}

/* ============================================================
   沉浸全屏模式
   仿 Poweramp：隐藏界面 chrome，只留画面。
   鼠标移动 → 控制条淡入；静止 2.5s → 隐藏并隐藏光标。
   ============================================================ */
const immersive = {
  get el() { return document.querySelector('.app'); },
  get bar() { return $('immersiveBar'); },
  get controlbar() { return document.querySelector('.controlbar'); },
};

let idleTimer = null;
let immersiveOn = false;

function revealChrome() {
  if (!immersiveOn) return;
  immersive.bar.classList.add('reveal');
  immersive.controlbar.classList.add('reveal');
  immersive.el.classList.remove('cursor-hidden');

  clearTimeout(idleTimer);
  idleTimer = setTimeout(hideChrome, 2500);
}

function hideChrome() {
  if (!immersiveOn) return;
  immersive.bar.classList.remove('reveal');
  immersive.controlbar.classList.remove('reveal');
  immersive.el.classList.add('cursor-hidden');
}

async function enterImmersive() {
  if (immersiveOn) return;
  immersiveOn = true;

  // 先切 UI，再请求全屏。
  // 顺序很关键：requestFullscreen 在没有用户手势时会返回一个永不 settle 的 Promise，
  // 若先 await 它，界面就卡在"点了没反应"。全屏失败不影响窗口内沉浸模式。
  immersive.el.classList.add('immersive');
  $('btnFullscreen').classList.add('on');

  // 关闭可能开着的侧栏与面板
  el.playlist.classList.remove('open');
  el.btnPlaylist.classList.remove('on');
  el.visPanel.classList.remove('open');
  el.btnVis.classList.remove('on');

  updateImmersiveInfo();
  revealChrome();
  vz.resize();

  // 异步请求原生全屏，失败或超时都无所谓
  try {
    if (!document.fullscreenElement) {
      await Promise.race([
        document.documentElement.requestFullscreen(),
        new Promise((r) => setTimeout(r, 600)),
      ]);
      vz.resize();
    }
  } catch { /* 被浏览器策略拒绝 → 退化为窗口内沉浸 */ }
}

async function exitImmersive() {
  if (!immersiveOn) return;
  immersiveOn = false;
  clearTimeout(idleTimer);

  immersive.el.classList.remove('immersive', 'cursor-hidden');
  immersive.bar.classList.remove('reveal');
  immersive.controlbar.classList.remove('reveal');
  $('btnFullscreen').classList.remove('on');

  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch { /* 忽略 */ }

  vz.resize();
}

function toggleImmersive() {
  if (immersiveOn) exitImmersive();
  else enterImmersive();
}

function updateImmersiveInfo() {
  const t = player.current;
  $('ibTitle').textContent = t ? (t.title || t.name) : '—';
  $('ibArtist').textContent = t ? (t.artist || '未知歌手') : '—';
  const p = vz.current;
  $('ibPreset').textContent = p ? `${THEMES[state.theme].label} · ${p.name}` : '';
}

/* ============================================================
   播放列表 UI
   ============================================================ */
function renderPlaylist() {
  const q = state.filter.trim().toLowerCase();
  const list = player.tracks
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => {
      if (!q) return true;
      return (
        (t.title || '').toLowerCase().includes(q) ||
        (t.artist || '').toLowerCase().includes(q) ||
        (t.album || '').toLowerCase().includes(q)
      );
    });

  el.plList.innerHTML = '';

  if (!player.tracks.length) {
    el.plList.innerHTML = '<div class="pl-empty">列表还是空的<br>导入文件夹，或播放内置示例曲</div>';
  } else if (!list.length) {
    el.plList.innerHTML = '<div class="pl-empty">没有匹配的曲目</div>';
  }

  const frag = document.createDocumentFragment();
  list.forEach(({ t, i }) => {
    const row = document.createElement('div');
    const isCur = i === player.index;
    row.className = 'pl-item' + (isCur ? ' active' : '') + (isCur && !el.audio.paused ? ' playing' : '');
    row.innerHTML = `
      <span class="pl-idx">${isCur && !el.audio.paused ? '▶' : i + 1}</span>
      <span class="pl-meta">
        <div class="pl-name">${escapeHtml(t.title || t.name)}</div>
        <div class="pl-sub">${escapeHtml(t.artist || '未知歌手')}${t.album ? ' · ' + escapeHtml(t.album) : ''}</div>
      </span>
      <span class="pl-dur">${t.duration ? fmtTime(t.duration) : '--:--'}</span>
      <button class="pl-del" title="移除">✕</button>
    `;
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('pl-del')) {
        player.removeAt(i);
        renderPlaylist();
        return;
      }
      player.jump(i);
    });
    row.addEventListener('dblclick', () => {
      window.pulse.showInFolder(t.path);
    });
    frag.appendChild(row);
  });
  el.plList.appendChild(frag);

  el.plCount.textContent = player.tracks.length;
  const total = totalDuration();
  el.plSummary.textContent = player.tracks.length
    ? `${player.tracks.length} 首 · ${fmtTime(total)}`
    : '列表为空';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function updateNowPlaying() {
  const t = player.current;
  const has = !!t;
  el.empty.classList.toggle('hidden', has);
  el.overlayInfo.classList.toggle('show', has);
  el.bpmBadge.classList.toggle('show', has);

  if (!has) {
    el.nmTitle.textContent = '未播放';
    el.nmArtist.textContent = '导入音乐或点击播放示例曲';
    el.oiTitle.textContent = '—';
    el.oiArtist.textContent = '—';
    return;
  }

  el.nmTitle.textContent = t.title || t.name;
  el.nmArtist.textContent = `${t.artist || '未知歌手'}${t.album ? ' · ' + t.album : ''}`;
  el.oiTitle.textContent = t.title || t.name;
  el.oiArtist.textContent = `${t.artist || '未知歌手'}${t.year ? ' · ' + t.year : ''}`;
  updateImmersiveInfo();

  if (t.picture) {
    el.oiArt.innerHTML = `<img src="data:image/jpeg;base64,${t.picture}" alt="" />`;
  } else {
    el.oiArt.innerHTML = '<span>♪</span>';
  }
}

function updatePlayIcon() {
  el.btnPlay.classList.toggle('playing', !el.audio.paused);
}

/* ============================================================
   进度条 / 音量
   ============================================================ */
function setProgressUI(cur, dur) {
  const ratio = dur > 0 ? cur / dur : 0;
  el.seekFill.style.width = `${ratio * 100}%`;
  el.seekKnob.style.left = `${ratio * 100}%`;
  el.tCur.textContent = fmtTime(cur);
  el.tDur.textContent = fmtTime(dur);
}

function updateVolumeUI() {
  const v = player.muted ? 0 : player.volume;
  el.volFill.style.width = `${v * 100}%`;
  el.volKnob.style.left = `${v * 100}%`;
  el.btnMute.classList.toggle('muted', player.muted);
}

/* ============================================================
   导入
   ============================================================ */
async function addTracks(tracks) {
  if (!tracks || !tracks.length) return 0;
  await player.setTracks(tracks, player.tracks.length);
  renderPlaylist();
  updateNowPlaying();
  toast(`已添加 ${tracks.length} 首`);
  return tracks.length;
}

async function importFolder() {
  try {
    const t = await window.pulse.pickFolder();
    if (!t.length) return;
    await addTracks(t);
    if (player.index < 0) player.load(0, false);
  } catch (e) {
    toast('导入文件夹失败：' + e.message, true);
  }
}

async function importFiles() {
  try {
    const t = await window.pulse.pickFiles();
    if (!t.length) return;
    await addTracks(t);
    if (player.index < 0) player.load(0, false);
  } catch (e) {
    toast('导入文件失败：' + e.message, true);
  }
}

/* ---------------- 拖拽 ---------------- */
let dragDepth = 0;
function setupDragDrop() {
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    el.dropzone.classList.add('active');
  });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) el.dropzone.classList.remove('active');
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.dropzone.classList.remove('active');

    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;

    const paths = [];
    for (const f of files) {
      const p = window.pulse.pathForFile(f);
      if (p) paths.push(p);
    }
    if (!paths.length) {
      toast('无法读取拖入项的路径', true);
      return;
    }
    try {
      const tracks = await window.pulse.scanPaths(paths);
      if (!tracks.length) {
        toast('未找到可播放的音频文件', true);
        return;
      }
      await addTracks(tracks);
      if (player.index < 0) player.load(0, true);
    } catch (err) {
      toast('导入失败：' + err.message, true);
    }
  });
}

/* ============================================================
   内置示例曲
   ============================================================ */
async function playDemo() {
  if (state.demoBusy) return;
  state.demoBusy = true;
  const btn = $('btnDemo');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '正在合成…';
  }
  try {
    if (!state.demoTrack) {
      toast('正在合成示例曲（约 1 秒）…');
      const blob = await renderDemoTrack(44100);
      state.demoTrack = {
        isDemo: true,
        path: '__demo__',
        name: 'PulsePlayer 示例曲.wav',
        title: '光脉冲 · 示例曲',
        artist: '内置合成器',
        album: 'Procedural Sessions',
        duration: 0,
        blobUrl: URL.createObjectURL(blob),
      };
    }
    const demo = state.demoTrack;
    await player.setTracks([demo], 0);
    renderPlaylist();
    updateNowPlaying();
    await engine.resume();
    // 走统一加载路径：触发 trackchange，封面与 BPM 重置才一致
    await player.load(0, true);

    // 读出真实时长写回条目
    const finish = () => {
      demo.duration = el.audio.duration;
      renderPlaylist();
      el.audio.removeEventListener('loadedmetadata', finish);
    };
    el.audio.addEventListener('loadedmetadata', finish);
  } catch (e) {
    toast('示例曲播放失败：' + e.message, true);
  } finally {
    state.demoBusy = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = '▶ 播放内置示例曲';
    }
  }
}

/* ============================================================
   事件绑定
   ============================================================ */
function setupUI() {
  // 播放控制
  el.btnPlay.addEventListener('click', () => {
    if (!player.tracks.length) return playDemo();
    player.toggle();
  });
  el.btnPrev.addEventListener('click', () => player.prev());
  el.btnNext.addEventListener('click', () => player.next());
  el.btnShuffle.addEventListener('click', () => {
    player.setShuffle(!player.shuffle);
    el.btnShuffle.classList.toggle('on', player.shuffle);
    saveSettings({ shuffle: player.shuffle });
    toast(player.shuffle ? '随机播放：开' : '随机播放：关');
  });
  el.btnRepeat.addEventListener('click', () => {
    const order = ['all', 'one', 'off'];
    const next = order[(order.indexOf(player.repeat) + 1) % order.length];
    player.setRepeat(next);
    el.btnRepeat.classList.toggle('one', next === 'one');
    saveSettings({ repeat: next });
    toast({ all: '列表循环', one: '单曲循环', off: '顺序播放' }[next]);
  });

  el.btnMute.addEventListener('click', () => {
    player.setMuted(!player.muted);
    updateVolumeUI();
    saveSettings({ muted: player.muted });
  });

  // 进度条拖拽
  let dragging = false;
  const ratioFromEvent = (e) => {
    const r = el.seek.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  el.seek.addEventListener('pointerdown', (e) => {
    dragging = true;
    state.scrubbing = true;
    el.seek.setPointerCapture(e.pointerId);
    setProgressUI(ratioFromEvent(e) * (el.audio.duration || 0), el.audio.duration || 0);
  });
  el.seek.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    setProgressUI(ratioFromEvent(e) * (el.audio.duration || 0), el.audio.duration || 0);
  });
  el.seek.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    state.scrubbing = false;
    el.seek.releasePointerCapture(e.pointerId);
    player.seek(ratioFromEvent(e));
  });

  // 音量拖拽
  let volDragging = false;
  const volRatio = (e) => {
    const r = el.volSeek.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  el.volSeek.addEventListener('pointerdown', (e) => {
    volDragging = true;
    el.volSeek.setPointerCapture(e.pointerId);
    player.setVolume(volRatio(e));
    updateVolumeUI();
  });
  el.volSeek.addEventListener('pointermove', (e) => {
    if (!volDragging) return;
    player.setVolume(volRatio(e));
    updateVolumeUI();
  });
  el.volSeek.addEventListener('pointerup', (e) => {
    volDragging = false;
    el.volSeek.releasePointerCapture(e.pointerId);
    saveSettings({ volume: player.volume });
  });

  // 侧栏与面板
  const togglePl = () => {
    // 沉浸全屏下播放列表会压在画面上，直接拒绝打开并给出提示
    if (immersiveOn) {
      toast('沉浸全屏中 · 按 Esc 或 F 退出后再打开列表');
      return;
    }
    el.playlist.classList.toggle('open');
    el.btnPlaylist.classList.toggle('on', el.playlist.classList.contains('open'));
    if (el.playlist.classList.contains('open')) renderPlaylist();
    vz.resize();
  };
  el.btnPlaylist.addEventListener('click', togglePl);
  $('btnClosePl').addEventListener('click', togglePl);

  const toggleVis = () => {
    const open = el.visPanel.classList.toggle('open');
    el.btnVis.classList.toggle('on', open);
  };
  el.btnVis.addEventListener('click', toggleVis);
  $('btnCloseVis').addEventListener('click', toggleVis);
  el.btnTheme.addEventListener('click', cycleTheme);

  // 沉浸全屏
  $('btnFullscreen').addEventListener('click', toggleImmersive);
  $('ibExit').addEventListener('click', exitImmersive);
  // 双击画布进入/退出沉浸（Poweramp 的交互习惯）
  el.viz.addEventListener('dblclick', toggleImmersive);
  // 移动鼠标唤出控制条
  window.addEventListener('mousemove', () => {
    if (immersiveOn) revealChrome();
  });

  el.themeTabs.querySelectorAll('.ttab').forEach((b) => {
    b.addEventListener('click', () => applyTheme(b.dataset.theme));
  });

  el.sensSlider.addEventListener('input', () => {
    const v = parseFloat(el.sensSlider.value);
    engine.setSensitivity(v);
    el.sensVal.textContent = v.toFixed(2);
    saveSettings({ sensitivity: v });
  });

  // 导入
  el.plFilter.addEventListener('input', () => {
    state.filter = el.plFilter.value;
    renderPlaylist();
  });
  $('btnAddFolder').addEventListener('click', importFolder);
  $('btnAddFiles').addEventListener('click', importFiles);
  $('btnFolder').addEventListener('click', importFolder);
  $('btnFiles').addEventListener('click', importFiles);
  $('btnDemo').addEventListener('click', playDemo);
  $('btnClear').addEventListener('click', () => {
    player.clear();
    renderPlaylist();
    updateNowPlaying();
    toast('列表已清空');
  });

  // 窗口控制
  $('btnMin').addEventListener('click', () => window.pulse.winMinimize());
  $('btnMax').addEventListener('click', () => window.pulse.winToggleMaximize());
  $('btnClose').addEventListener('click', () => window.pulse.winClose());
}

function setupKeys() {
  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }

    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (!player.tracks.length) playDemo();
        else player.toggle();
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey) player.seek(Math.min(1, (el.audio.currentTime + 10) / (el.audio.duration || 1)));
        else player.next();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey) player.seek(Math.max(0, (el.audio.currentTime - 10) / (el.audio.duration || 1)));
        else player.prev();
        break;
      case 'ArrowUp':
        e.preventDefault();
        player.setVolume(Math.min(1, player.volume + 0.06));
        updateVolumeUI();
        break;
      case 'ArrowDown':
        e.preventDefault();
        player.setVolume(Math.max(0, player.volume - 0.06));
        updateVolumeUI();
        break;
      case 'm':
      case 'M':
        player.setMuted(!player.muted);
        updateVolumeUI();
        saveSettings({ muted: player.muted });
        break;
      case 's':
      case 'S':
        player.setShuffle(!player.shuffle);
        el.btnShuffle.classList.toggle('on', player.shuffle);
        saveSettings({ shuffle: player.shuffle });
        break;
      case 'r':
      case 'R': {
        const order = ['all', 'one', 'off'];
        const next = order[(order.indexOf(player.repeat) + 1) % order.length];
        player.setRepeat(next);
        el.btnRepeat.classList.toggle('one', next === 'one');
        saveSettings({ repeat: next });
        break;
      }
      case 't':
      case 'T':
        cycleTheme();
        break;
      case 'v':
      case 'V':
        cyclePreset();
        break;
      case 'l':
      case 'L':
        el.btnPlaylist.click();
        break;
      case 'o':
      case 'O':
        el.btnVis.click();
        break;
      case 'h':
      case 'H':
        el.hud.classList.toggle('show');
        break;
      case 'Escape':
        if (immersiveOn) exitImmersive();
        else if (el.visPanel.classList.contains('open')) el.btnVis.click();
        else if (el.playlist.classList.contains('open')) el.btnPlaylist.click();
        break;
      case 'f':
      case 'F':
        toggleImmersive();
        break;
      default:
        break;
    }
  });

  // 全局媒体键
  window.pulse.onShortcut((cmd) => {
    if (cmd === 'playpause') {
      if (!player.tracks.length) playDemo();
      else player.toggle();
    } else if (cmd === 'next') player.next();
    else if (cmd === 'prev') player.prev();
    else if (cmd === 'stop') player.stop();
  });
}

function setupPlayerEvents() {
  player.addEventListener('playstate', () => {
    updatePlayIcon();
    renderPlaylist();
  });
  player.addEventListener('trackchange', () => {
    updateNowPlaying();
    renderPlaylist();
    // 新歌开始，BPM 需要重新学习
    engine.bpm = 0;
  });
  player.addEventListener('listchange', renderPlaylist);
  player.addEventListener('progress', (e) => {
    if (state.scrubbing) return;
    setProgressUI(e.detail.current, e.detail.duration);
    // 缓冲进度
    try {
      if (el.audio.buffered.length && el.audio.duration) {
        const end = el.audio.buffered.end(el.audio.buffered.length - 1);
        el.seekBuffer.style.width = `${(end / el.audio.duration) * 100}%`;
      }
    } catch { /* 忽略 */ }
  });
  player.addEventListener('meta', (e) => {
    const t = player.current;
    if (t) {
      t.duration = e.detail.duration;
      renderPlaylist();
    }
  });
  player.addEventListener('modechange', () => {
    el.btnShuffle.classList.toggle('on', player.shuffle);
    el.btnRepeat.classList.toggle('one', player.repeat === 'one');
  });
  player.addEventListener('trackerror', (e) => {
    const name = e.detail ? (e.detail.title || e.detail.name) : '该文件';
    toast(`无法播放「${name}」，已跳过`, true);
  });
  player.addEventListener('fatal', (e) => toast(e.detail, true));
}

/* HUD 刷新 */
function setupHud() {
  setInterval(() => {
    if (!el.hud.classList.contains('show')) return;
    $('hudBass').textContent = engine.bass.toFixed(3);
    $('hudMid').textContent = engine.mid.toFixed(3);
    $('hudTreble').textContent = engine.treble.toFixed(3);
    $('hudFlux').textContent = engine.flux.toFixed(3);
  }, 120);
}

/* ============================================================
   启动
   ============================================================ */
async function boot() {
  const settings = (await window.pulse.getSettings()) || {};
  state.settings = settings;

  player.setVolume(settings.volume ?? 0.85);
  player.setMuted(!!settings.muted);
  player.setShuffle(!!settings.shuffle);
  player.setRepeat(settings.repeat || 'all');
  engine.setSensitivity(settings.sensitivity ?? 1);

  el.sensSlider.value = String(settings.sensitivity ?? 1);
  el.sensVal.textContent = Number(settings.sensitivity ?? 1).toFixed(2);

  state.theme = settings.theme || 'neon';
  state.preset = settings.preset || 'neon-bars';

  el.btnShuffle.classList.toggle('on', player.shuffle);
  el.btnRepeat.classList.toggle('one', player.repeat === 'one');
  updateVolumeUI();
  updatePlayIcon();
  updateNowPlaying();
  renderPlaylist();

  setupUI();
  setupKeys();
  setupPlayerEvents();
  setupDragDrop();
  setupHud();

  // 初始化音频引擎（需要用户手势才能真正启动 AudioContext，这里先建好上下文）
  await engine.init(el.audio);

  // 关键：必须把预设注册进渲染器，否则 setPreset 查无此项、画布永远不画
  vz.registerAll(PRESETS);

  applyTheme(state.theme, false);
  vz.setPreset(state.preset, true);

  vz.start();

  // 节拍闪烁：每帧直接写 class，与画面的 pulse 严格同帧
  vz.onFrame = (s) => {
    el.bpmBadge.classList.toggle('hit', s.beatPulse > 0.55);
    // FPS 统计（仅 HUD 打开时有意义）
    state.fpsAcc += 1;
  };

  // 用户用系统方式退出全屏（F11 / 任务栏）时，同步退出沉浸模式，
// 否则会停在"界面已隐藏但窗口已还原"的错位状态
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && immersiveOn) exitImmersive();
});

// 首次点击时唤醒 AudioContext
  const wake = async () => {
    await engine.resume();
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
  };
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);

  // BPM 数值
  setInterval(() => {
    el.bpmNum.textContent = engine.bpm ? String(engine.bpm) : '---';
  }, 150);

  // 调试句柄：自检脚本用来确认渲染器真实状态（预设注册、帧循环、当前预设）
  window.__pulse = {
    engine,
    player,
    vz,
    state,
    PRESETS,
    frameCount: () => state.fpsAcc,
    currentPreset: () => (vz.current ? vz.current.id : null),
    registeredCount: () => vz.presets.size,
  };
}

boot().catch((e) => {
  console.error(e);
  toast('启动失败：' + e.message, true);
});