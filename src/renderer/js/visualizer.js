/**
 * 可视化框架
 * ------------------------------------------------------------------
 * 预设接口：
 *   { id, name, theme, init?(ctx), draw(ctx, s, t, dt) }
 *
 * s = 音频状态快照 { bands, bandsRaw, waveform, waveSmooth, bass, mid,
 *                    treble, level, energy, flux, beat, beatPulse, bpm }
 *
 * 渲染循环固定 60fps，DPR 感知，窗口尺寸变化自适应。
 * 预设切换时用 snapshot 做 320ms 交叉淡入淡出，避免硬切。
 */

export class Visualizer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.engine = engine;

    this.presets = new Map();
    this.current = null;
    this.prevId = null;
    this.fade = 1;          // 1 = 完全显示当前预设
    this.fadeDur = 0.32;

    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = 0;
    this.h = 0;

    this.time = 0;
    this.lastTs = 0;
    this.running = false;

    // 拖影缓冲（部分预设自用）
    this.trail = document.createElement('canvas');
    this.trailCtx = this.trail.getContext('2d', { alpha: true });
    this.fadeBuf = document.createElement('canvas');
    this.fadeCtx = this.fadeBuf.getContext('2d', { alpha: true });

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    // 用 ResizeObserver 盯住容器：切换沉浸模式、开关播放列表都会改变舞台尺寸，
    // 但都不触发 window.resize，只靠 window 事件会让画布停在旧尺寸上。
    this._host = canvas.parentElement || canvas;
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(this._host);
    }

    this.resize();
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
  }

  register(preset) {
    this.presets.set(preset.id, preset);
    return this;
  }

  registerAll(list) {
    list.forEach((p) => this.register(p));
    return this;
  }

  get(id) {
    return this.presets.get(id) || null;
  }

  setPreset(id, immediate = false) {
    const next = this.presets.get(id);
    if (!next) return false;
    if (this.current && this.current.id === next.id) return true;

    // 淡出前先抓一帧当前画面
    if (this.current && !immediate) {
      this.fadeCtx.clearRect(0, 0, this.fadeBuf.width, this.fadeBuf.height);
      this.fadeCtx.drawImage(this.canvas, 0, 0);
      this.prevId = this.current.id;
      this.fade = 0;
    } else {
      this.fade = 1;
      this.prevId = null;
    }

    if (next.init) next.init(this.ctx, this.w, this.h);
    this.current = next;
    this.trailCtx.clearRect(0, 0, this.trail.width, this.trail.height);
    return true;
  }

  resize() {
    // 关键：必须量「容器」，不能量 canvas 自己。
    // 以前这里写 this.canvas.style.width = cssW + 'px'，内联样式优先级高于 CSS 的
    // width:100%，于是 canvas 被钉死在首次测量到的尺寸上；下一次 resize 又读到这个
    // 被钉住的旧值，形成闭环 —— 表现就是进全屏后画面永远铺不满。
    const host = this._host || this.canvas.parentElement || this.canvas;
    const rect = host.getBoundingClientRect();
    let cssW = Math.floor(rect.width);
    let cssH = Math.floor(rect.height);
    // 容器被隐藏（display:none）时不要退化成 0 尺寸，保持上一次的有效值
    if (cssW < 1 || cssH < 1) { cssW = this.w || 320; cssH = this.h || 240; }
    cssW = Math.max(320, cssW);
    cssH = Math.max(240, cssH);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = cssW;
    this.h = cssH;

    const pw = Math.floor(cssW * this.dpr);
    const ph = Math.floor(cssH * this.dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      for (const c of [this.canvas, this.trail, this.fadeBuf]) {
        c.width = pw;
        c.height = ph;
      }
    }
    // 不再写内联 width/height：让 CSS 的 inset:0 + width/height:100% 决定显示尺寸，
    // 这样容器一变，画面立刻跟着铺满，不必等下一次 resize。
    this.canvas.style.width = '';
    this.canvas.style.height = '';

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.trailCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.fadeCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (this.current && this.current.init) this.current.init(this.ctx, this.w, this.h);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTs = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
  }

  _frame = (ts) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    this.time += dt;

    // 音频分析
    this.engine.update(dt);

    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / this.fadeDur);

    const s = {
      bands: this.engine.bands,
      bandsRaw: this.engine.bandsRaw,
      waveform: this.engine.waveform,
      waveSmooth: this.engine.waveSmooth,
      waveL: this.engine.waveL,
      waveR: this.engine.waveR,
      rmsL: this.engine.rmsL,
      rmsR: this.engine.rmsR,
      balance: this.engine.balance,
      bass: this.engine.bass,
      mid: this.engine.mid,
      treble: this.engine.treble,
      level: this.engine.level,
      energy: this.engine.energy,
      flux: this.engine.flux,
      beat: this.engine.beat,
      beatPulse: this.engine.beatPulse,
      bpm: this.engine.bpm,
      playing: !this.engine.el || !this.engine.el.paused,
    };

    const ctx = this.ctx;
    ctx.save();
    if (this.current) this.current.draw(ctx, s, this.time, dt, this);
    ctx.restore();

    // 节拍闪烁挂在渲染循环上，节奏才和画面完全同步
    if (this.onFrame) this.onFrame(s);

    // 交叉淡化：旧快照压在下面，随 fade 淡出
    if (this.fade < 1 && this.prevId) {
      const a = 1 - this.fade;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.fadeBuf, 0, 0);
      ctx.restore();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.fade >= 1) this.prevId = null;
    }

    requestAnimationFrame(this._frame);
  };
}

/* ============================================================
 * 绘图工具
 * ============================================================ */

export function clearBg(ctx, w, h, color = '#05060a') {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/** 彩虹渐变（霓虹风格主用） */
export function neonGradient(ctx, x0, y0, x1, y1, alpha = 1, alphaTop = 1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  const a = (v) => `rgba(255,255,255,${v})`;
  const stops = [
    [0.0, `rgba(255,0,128,${alpha})`],
    [0.25, `rgba(150,40,255,${alpha})`],
    [0.5, `rgba(0,200,255,${alpha})`],
    [0.72, `rgba(0,255,190,${alpha})`],
    [1.0, `rgba(255,230,0,${alphaTop})`],
  ];
  stops.forEach(([p, c]) => g.addColorStop(p, c));
  return g;
}

export function hsv(h, s, v, a = 1) {
  return `hsla(${h},${s}%,${v}%,${a})`;
}

/** 中心对称的柱状图，单柱渐变 + 辉光 */
export function drawMirrorBars(ctx, bands, w, h, opts = {}) {
  const n = bands.length;
  const gap = opts.gap ?? 2;
  const bw = Math.max(1, (w - gap * (n - 1)) / n);
  const mid = h / 2;
  const glow = opts.glow ?? 18;
  const mode = opts.mode ?? 'neon';

  ctx.save();
  ctx.shadowBlur = glow;
  ctx.shadowColor = opts.glowColor || 'rgba(255,0,160,0.85)';

  for (let i = 0; i < n; i++) {
    const v = Math.min(1.25, bands[i]);
    const bh = v * (h * 0.46);
    const x = i * (bw + gap);

    let fill;
    if (mode === 'neon') {
      const g = ctx.createLinearGradient(0, mid - bh, 0, mid + bh);
      const hue = 190 + v * 150;
      g.addColorStop(0, hsv(hue + 40, 100, 68));
      g.addColorStop(0.5, hsv(hue, 100, 55));
      g.addColorStop(1, hsv(hue - 50, 100, 62));
      fill = g;
    } else if (mode === 'amber') {
      const g = ctx.createLinearGradient(0, mid - bh, 0, mid + bh);
      g.addColorStop(0, `rgba(255,176,0,${0.5 + v * 0.5})`);
      g.addColorStop(1, `rgba(255,96,0,${0.4 + v * 0.4})`);
      fill = g;
    } else if (mode === 'green') {
      const g = ctx.createLinearGradient(0, mid - bh, 0, mid + bh);
      g.addColorStop(0, `rgba(120,255,140,${0.5 + v * 0.5})`);
      g.addColorStop(1, `rgba(0,190,90,${0.4 + v * 0.4})`);
      fill = g;
    } else {
      // single
      fill = opts.color || 'rgba(120,220,255,0.9)';
    }

    ctx.fillStyle = fill;
    const r = Math.min(bw / 2, 2);
    roundRect(ctx, x, mid - bh, bw, bh * 2, r);
    ctx.fill();
  }
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** 径向拖影：轻微半透明覆盖，代替 clearRect → 天然残影 */
export function fadeTrail(ctx, w, h, alpha = 0.24, color = '#05060a') {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}