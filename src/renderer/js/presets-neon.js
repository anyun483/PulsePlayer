/**
 * 霓虹赛博风格预设（4 套）
 * 高饱和霓虹渐变 + 加色混合辉光 + 对称/径向几何，追求 Poweramp 那种"眼花缭乱但很舒服"的冲击。
 */

import { clearBg, neonGradient, hsv, roundRect, drawMirrorBars } from './visualizer.js';

/* ============================================================
 * 1) 霓虹频谱柱 — 主视觉
 * 上下对称柱 + 辉光 + 地面反射 + 击打时全屏闪白
 * ============================================================ */
export const neonBars = {
  id: 'neon-bars',
  name: '霓虹频谱柱',
  theme: 'neon',
  hint: '经典主视觉 · 对称柱体 + 地面反射',

  init(ctx, w, h) {
    this.reflections = [];
    this.prev = new Float32Array(64);
    this.peaks = new Float32Array(64);
  },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    clearBg(ctx, w, h, '#05060a');

    const mid = h / 2;
    const bp = s.beatPulse;

    // 背景径向光晕
    const bg = ctx.createRadialGradient(w / 2, mid, 0, w / 2, mid, Math.max(w, h) * 0.62);
    bg.addColorStop(0, `rgba(80,0,140,${0.16 + bp * 0.3})`);
    bg.addColorStop(0.5, `rgba(20,0,60,${0.1 + bp * 0.12})`);
    bg.addColorStop(1, 'rgba(5,6,10,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const bands = s.bands;
    const n = bands.length;
    const gap = 2;
    const bw = Math.max(1.2, (w * 0.94 - gap * (n - 1)) / n);
    const startX = (w - (bw * n + gap * (n - 1))) / 2;
    const maxH = mid * 0.88;

    // 地面网格地平线
    ctx.save();
    ctx.strokeStyle = `rgba(0,220,255,${0.05 + s.bass * 0.1})`;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 7; i++) {
      const y = mid + (h - mid) * Math.pow(i / 7, 1.7);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();

    // 反射层（画在下半区，垂直翻转 + 淡出）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.32;
    ctx.translate(0, mid * 2);
    ctx.scale(1, -1);
    this._bars(ctx, bands, startX, bw, gap, n, maxH * 0.55, s, t, h, true);
    ctx.restore();

    // 主柱体
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    this._bars(ctx, bands, startX, bw, gap, n, maxH, s, t, h, false);
    ctx.restore();

    // 顶部峰值帽
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const v = bands[i];
      this.peaks[i] = Math.max(v, (this.peaks[i] || 0) - dt * 0.55);
      const y = mid - this.peaks[i] * maxH;
      const x = startX + i * (bw + gap);
      ctx.fillStyle = hsv(190 + this.peaks[i] * 170, 100, 72, 0.9);
      ctx.shadowBlur = 12;
      ctx.shadowColor = hsv(190 + this.peaks[i] * 170, 100, 60, 0.9);
      ctx.fillRect(x, y - 2, bw, 2.5);
    }
    ctx.restore();

    // 击打闪白
    if (s.beat) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const fg = ctx.createRadialGradient(w / 2, mid, 0, w / 2, mid, Math.max(w, h) * 0.5);
      fg.addColorStop(0, `rgba(180,60,255,${0.1 * bp})`);
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  },

  _bars(ctx, bands, startX, bw, gap, n, maxH, s, t, h, isRefl) {
    const mid = h / 2;
    for (let i = 0; i < n; i++) {
      const v = Math.min(1.3, bands[i]);
      if (v < 0.012) continue;
      const bh = v * maxH;
      const x = startX + i * (bw + gap);

      const hue = 185 + v * 165;
      const g = ctx.createLinearGradient(0, mid - bh, 0, mid + bh);
      g.addColorStop(0, hsv(hue + 45, 100, 70, isRefl ? 0.5 : 0.95));
      g.addColorStop(0.5, hsv(hue, 100, 58, isRefl ? 0.6 : 1));
      g.addColorStop(1, hsv(hue - 55, 100, 64, isRefl ? 0.5 : 0.95));

      ctx.shadowBlur = isRefl ? 10 : 22 + v * 26;
      ctx.shadowColor = hsv(hue, 100, 55, 0.9);
      ctx.fillStyle = g;
      roundRect(ctx, x, mid - bh, bw, bh * 2, Math.min(bw / 2, 2));
      ctx.fill();
    }
  },
};

/* ============================================================
 * 2) 环形频谱 — 中心向外放射的圆周柱体
 * ============================================================ */
export const neonRadial = {
  id: 'neon-radial',
  name: '环形频谱',
  theme: 'neon',
  hint: '径向放射 · 缓慢自转 + 呼吸',

  init(ctx, w, h) { this.rot = 0; },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    clearBg(ctx, w, h, '#04050c');

    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.27;
    this.rot += dt * (0.12 + s.mid * 0.5);

    const bp = s.beatPulse;
    const rPulse = R * (1 + bp * 0.1);

    // 外圈刻度
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.rot * 0.4);
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const len = i % 8 === 0 ? 12 : 5;
      ctx.strokeStyle = `rgba(0,220,255,${0.12 + (i % 8 === 0 ? 0.2 : 0)})`;
      ctx.lineWidth = i % 8 === 0 ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (rPulse + 16), Math.sin(a) * (rPulse + 16));
      ctx.lineTo(Math.cos(a) * (rPulse + 16 + len), Math.sin(a) * (rPulse + 16 + len));
      ctx.stroke();
    }
    ctx.restore();

    // 中心辉光核
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, rPulse * 1.5);
    core.addColorStop(0, `rgba(255,255,255,${0.22 + bp * 0.45})`);
    core.addColorStop(0.22, `rgba(180,60,255,${0.3 + bp * 0.35})`);
    core.addColorStop(0.6, `rgba(0,180,255,${0.12 + s.bass * 0.16})`);
    core.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, rPulse * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 环形柱体
    const n = s.bands.length;
    const step = (Math.PI * 2) / n;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.rot);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const v = Math.min(1.3, s.bands[i]);
      const a = i * step;
      const len = v * Math.min(w, h) * 0.19;
      const hue = 190 + v * 165;

      ctx.strokeStyle = hsv(hue, 100, 62, 0.92);
      ctx.shadowBlur = 16 + v * 22;
      ctx.shadowColor = hsv(hue, 100, 55, 0.9);
      ctx.lineWidth = Math.max(2, (Math.PI * 2 * rPulse) / n - 3);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * rPulse, Math.sin(a) * rPulse);
      ctx.lineTo(Math.cos(a) * (rPulse + len), Math.sin(a) * (rPulse + len));
      ctx.stroke();
    }
    ctx.restore();

    // 击打冲击环
    if (s.beat) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,120,255,${0.55 * bp})`;
      ctx.lineWidth = 2.5 * bp;
      ctx.beginPath();
      ctx.arc(cx, cy, rPulse + (1 - bp) * Math.min(w, h) * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  },
};

/* ============================================================
 * 3) 粒子脉冲 — 频谱驱动的粒子喷发 + 中心漩涡
 * ============================================================ */
export const neonParticles = {
  id: 'neon-particles',
  name: '粒子脉冲',
  theme: 'neon',
  hint: '鼓点喷发粒子 · 中心漩涡吸积',

  init(ctx, w, h) {
    this.parts = [];
    this.swirl = [];
    for (let i = 0; i < 220; i++) {
      this.swirl.push({
        a: Math.random() * Math.PI * 2,
        r: 40 + Math.random() * 200,
        sp: 0.4 + Math.random() * 1.4,
        sz: 0.6 + Math.random() * 1.8,
      });
    }
  },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    // 拖影代替清屏 → 天然残影
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#04030a';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const cx = w / 2;
    const cy = h / 2;

    // 漩涡粒子向内吸
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.swirl) {
      p.a += dt * p.sp * (0.3 + s.mid * 2.2);
      p.r -= dt * (18 + s.bass * 150) * p.sp;
      if (p.r < 12) {
        p.r = Math.max(w, h) * (0.35 + Math.random() * 0.25);
        p.a = Math.random() * Math.PI * 2;
      }
      const x = cx + Math.cos(p.a) * p.r;
      const y = cy + Math.sin(p.a) * p.r;
      const alpha = Math.min(1, (1 - p.r / (Math.max(w, h) * 0.6)) * (0.25 + s.energy));
      ctx.fillStyle = hsv(190 + (p.r / 300) * 160, 100, 62, alpha);
      ctx.beginPath();
      ctx.arc(x, y, p.sz * (1 + s.beatPulse * 0.9), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 鼓点喷发
    if (s.beat) {
      const count = 14 + Math.floor(s.bass * 40);
      const n = s.bands.length;
      for (let i = 0; i < count; i++) {
        const bi = Math.floor(Math.random() * n);
        const v = s.bands[bi];
        const a = (bi / n) * Math.PI * 2 + Math.random() * 0.16;
        const sp = 120 + v * 480 + Math.random() * 200;
        this.parts.push({
          x: cx + Math.cos(a) * 60,
          y: cy + Math.sin(a) * 60,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 1,
          decay: 0.7 + Math.random() * 1.1,
          hue: 190 + v * 165,
          sz: 1 + Math.random() * 2.6,
        });
      }
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.965;
      p.vy *= 0.965;
      p.life -= dt * p.decay;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      ctx.fillStyle = hsv(p.hue, 100, 60, p.life * 0.85);
      ctx.shadowBlur = 10;
      ctx.shadowColor = hsv(p.hue, 100, 55, p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.sz * p.life * (1 + s.beatPulse), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 中心脉冲环
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const R = Math.min(w, h) * 0.2;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, `rgba(255,255,255,${0.3 * s.beatPulse})`);
    g.addColorStop(0.5, `rgba(200,60,255,${0.24 * s.beatPulse + s.bass * 0.1})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 限流，防止粒子无限增长
    if (this.parts.length > 1400) this.parts.splice(0, this.parts.length - 1400);
  },
};

/* ============================================================
 * 4) 波形隧道 — 沿 Z 轴推进的同心环，频谱扰动半径
 * ============================================================ */
export const neonTunnel = {
  id: 'neon-tunnel',
  name: '波形隧道',
  theme: 'neon',
  hint: '纵深推进 · 频谱扭曲环半径',

  init(ctx, w, h) { this.zoff = 0; },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    clearBg(ctx, w, h, '#03040a');

    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.hypot(cx, cy);
    this.zoff = (this.zoff + dt * (0.28 + s.energy * 0.55)) % 1;

    const RINGS = 26;
    const SEG = 96;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, cy);

    for (let r = RINGS - 1; r >= 0; r--) {
      const z = (r / RINGS + this.zoff) % 1;
      const scale = Math.pow(1 - z, 2.3);          // 透视
      const radius = scale * maxR * 1.25;
      if (radius < 2) continue;

      const alpha = (1 - z) * (0.25 + s.level * 1.5);
      const hue = 185 + (1 - z) * 170;

      ctx.beginPath();
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        // 用频谱扰动半径
        const band = s.bands[(i % s.bands.length)] || 0;
        const wobble = 1 + band * 0.42 * (0.4 + s.beatPulse);
        const rr = radius * wobble;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr * 0.82;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = hsv(hue, 100, 60, Math.min(0.85, alpha));
      ctx.lineWidth = Math.max(0.6, (1 - z) * 3.4);
      ctx.shadowBlur = (1 - z) * 20 * (0.4 + s.energy);
      ctx.shadowColor = hsv(hue, 100, 55, alpha);
      ctx.stroke();
    }

    // 中心黑洞 + 吸入辉光
    const coreR = Math.min(w, h) * 0.06 * (1 + s.beatPulse * 0.5);
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR * 3.4);
    cg.addColorStop(0, `rgba(255,255,255,${0.5 * s.beatPulse + 0.06})`);
    cg.addColorStop(0.4, `rgba(180,50,255,${0.28 * s.beatPulse + s.bass * 0.14})`);
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(0, 0, coreR * 3.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(0, 0, coreR * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
};