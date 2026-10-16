/**
 * 复古终端 / 雷达风格预设（3 套）
 * 琥珀 CRT 扫描线 + 荧光绿磷光余晖，怀旧但上瘾。
 */

import { clearBg } from './visualizer.js';

const GREEN = (l, alpha = 1) => `hsla(140,72%,${l}%,${alpha})`;
const AMBER = (l, alpha = 1) => `hsla(42,92%,${l}%,${alpha})`;

/** 画 CRT 扫描线纹理 + 轻微暗角，覆于画面之上 */
function crtOverlay(ctx, w, h, opts = {}) {
  const { lineAlpha = 0.055, lineGap = 3, tint = '0,0,0', vignette = 0.55 } = opts;

  // 扫描线
  ctx.save();
  ctx.globalAlpha = lineAlpha;
  ctx.fillStyle = tint === '0,0,0' ? '#000' : `rgb(${tint})`;
  for (let y = 0; y < h; y += lineGap) {
    ctx.fillRect(0, y, w, 1);
  }
  ctx.restore();

  // 暗角
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${vignette})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** 顶部跳动的数值栏，像老式示波器 */
function readout(ctx, w, h, s, color, label) {
  ctx.save();
  ctx.font = '11px "Consolas", "Courier New", monospace';
  ctx.textBaseline = 'top';

  ctx.fillStyle = color(58, 0.5);
  ctx.textAlign = 'left';
  ctx.fillText(label, 18, 16);

  ctx.textAlign = 'right';
  ctx.fillStyle = color(64, 0.85);
  ctx.fillText(`BPM ${String(s.bpm || '---').padStart(3, ' ')}`, w - 18, 16);
  ctx.fillStyle = color(58, 0.6);
  ctx.fillText(`LVL ${(s.level * 100).toFixed(0).padStart(3, ' ')}%`, w - 18, 32);

  ctx.textAlign = 'left';
  ctx.fillStyle = color(58, 0.6);
  const bars = 8;
  for (let i = 0; i < bars; i++) {
    const on = i / bars < s.bass * 1.4;
    ctx.fillStyle = on ? color(66, 0.85) : color(30, 0.7);
    ctx.fillRect(18 + i * 9, 32, 6, 8);
  }
  ctx.restore();
}

/* ============================================================
 * 1) 雷达扫描 — 旋转扫描线 + 频谱回波
 * ============================================================ */
export const retroRadar = {
  id: 'retro-radar',
  name: '雷达扫描',
  theme: 'retro',
  hint: 'CRT 雷达 · 频谱回波 + 余晖',

  init(ctx, w, h) {
    this.angle = 0;
    // 注意：Float32Array 没有 map 的对象语义（会返回数字），必须显式构造数组
    this.echoes = Array.from({ length: 72 }, () => ({ v: 0 }));
    this.blips = [];
  },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    // 磷光余晖：用半透明绿覆盖代替清屏
    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = '#020a05';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const cx = w / 2;
    const cy = h * 0.54;
    const R = Math.min(w, h) * 0.36;

    this.angle = (this.angle + dt * (1.1 + s.energy * 2.2)) % (Math.PI * 2);

    // 距离环 + 方位刻度
    ctx.save();
    ctx.strokeStyle = GREEN(38, 0.28);
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (R / 4) * i, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const long = i % 6 === 0;
      ctx.strokeStyle = GREEN(38, long ? 0.4 : 0.18);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R * 0.93), cy + Math.sin(a) * (R * 0.93));
      ctx.lineTo(cx + Math.cos(a) * (R * (long ? 1.02 : 0.99)), cy + Math.sin(a) * (R * (long ? 1.02 : 0.99)));
      ctx.stroke();
    }
    // 十字轴
    ctx.strokeStyle = GREEN(38, 0.22);
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();
    ctx.restore();

    // 频谱回波：把 bands 映射到 72 个方位角
    const N = 72;
    const n = s.bands.length;
    for (let i = 0; i < N; i++) {
      const bi = Math.floor((i / N) * n);
      const target = Math.min(1.25, s.bands[bi]);
      const e = this.echoes[i];
      // 扫描线扫过时写入新值，其余自然衰减
      const delta = Math.abs(((this.angle - (i / N) * Math.PI * 2 + Math.PI * 4) % (Math.PI * 2)));
      if (delta < 0.16) e.v = target;
      else e.v *= Math.exp(-dt * 1.1);

      if (e.v < 0.02) continue;
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      const len = e.v * R * 0.85;
      // 越新越亮：扫描线附近高亮
      const freshness = Math.max(0, 1 - delta / 1.2);
      ctx.save();
      ctx.strokeStyle = GREEN(50 + freshness * 34, 0.22 + e.v * 0.6 + freshness * 0.3);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.shadowBlur = 6 + freshness * 14;
      ctx.shadowColor = GREEN(60, 0.8);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.14, cy + Math.sin(a) * R * 0.14);
      ctx.lineTo(cx + Math.cos(a) * (R * 0.14 + len), cy + Math.sin(a) * (R * 0.14 + len));
      ctx.stroke();
      ctx.restore();
    }

    // 旋转扫描扇形
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.angle);
    const sweep = ctx.createLinearGradient(0, 0, R, 0);
    sweep.addColorStop(0, GREEN(60, 0.32));
    sweep.addColorStop(1, GREEN(60, 0));
    ctx.fillStyle = sweep;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, -0.42, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = GREEN(70, 0.85);
    ctx.lineWidth = 1.4;
    ctx.shadowBlur = 14;
    ctx.shadowColor = GREEN(70, 0.9);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(R, 0);
    ctx.stroke();
    ctx.restore();

    // 鼓点亮斑
    if (s.beat) {
      const a = Math.random() * Math.PI * 2;
      const r = R * (0.3 + Math.random() * 0.55);
      this.blips.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, life: 1 });
    }
    for (let i = this.blips.length - 1; i >= 0; i--) {
      const b = this.blips[i];
      b.life -= dt * 0.9;
      if (b.life <= 0) {
        this.blips.splice(i, 1);
        continue;
      }
      ctx.fillStyle = GREEN(72, b.life);
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.5 * b.life, 0, Math.PI * 2);
      ctx.fill();
    }

    // 中心辉光
    ctx.save();
    ctx.fillStyle = GREEN(60, 0.1 + s.bass * 0.2 + s.beatPulse * 0.2);
    ctx.beginPath();
    ctx.arc(cx, cy, 5 + s.bass * 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    readout(ctx, w, h, s, GREEN, 'RADAR / SCAN');
    crtOverlay(ctx, w, h, { tint: '0,40,20', lineAlpha: 0.05, vignette: 0.6 });
  },
};

/* ============================================================
 * 2) 示波器网格 — 绿色荧光网格 + 波形迹线 + 余晖
 * ============================================================ */
export const retroScope = {
  id: 'retro-scope',
  name: '示波器网格',
  theme: 'retro',
  hint: '磷光网格 · 波形迹线 + 重影',

  init(ctx, w, h) { this.trace = []; },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    // 余晖
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#010803';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const padX = Math.min(90, w * 0.08);
    const padY = Math.min(70, h * 0.1);
    const gw = w - padX * 2;
    const gh = h - padY * 2;
    const cx = w / 2;
    const cy = h / 2;

    // 网格
    ctx.save();
    ctx.lineWidth = 1;
    const divX = 10;
    const divY = 8;
    for (let i = 0; i <= divX; i++) {
      const x = padX + (gw / divX) * i;
      const major = i % 5 === 0;
      ctx.strokeStyle = GREEN(35, major ? 0.3 : 0.12);
      ctx.beginPath();
      ctx.moveTo(x, padY);
      ctx.lineTo(x, padY + gh);
      ctx.stroke();
    }
    for (let i = 0; i <= divY; i++) {
      const y = padY + (gh / divY) * i;
      const major = i % 4 === 0;
      ctx.strokeStyle = GREEN(35, major ? 0.3 : 0.12);
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(padX + gw, y);
      ctx.stroke();
    }
    // 中轴加亮
    ctx.strokeStyle = GREEN(45, 0.42);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(padX, cy);
    ctx.lineTo(padX + gw, cy);
    ctx.moveTo(cx, padY);
    ctx.lineTo(cx, padY + gh);
    ctx.stroke();
    // 边框
    ctx.strokeStyle = GREEN(40, 0.35);
    ctx.strokeRect(padX, padY, gw, gh);
    ctx.restore();

    // 波形迹线：主 + 延迟重影
    const wave = s.waveSmooth;
    const N = wave.length;
    const amp = gh * 0.36 * (0.6 + s.energy * 0.8);

    const tracePath = (alpha, offsetY, color) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1.7;
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 10;
      ctx.shadowColor = GREEN(60, 0.8);
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = padX + (i / (N - 1)) * gw;
        const y = cy - wave[i] * amp + offsetY;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    };

    tracePath(0.16, 6, GREEN(50));      // 重影
    tracePath(0.3, -5, GREEN(50));
    tracePath(1.0, 0, GREEN(70, 0.95)); // 主迹线

    // 频谱作为底部小柱状叠加在网格里
    const n = s.bands.length;
    const bw = gw / n;
    const baseY = padY + gh * 0.94;
    for (let i = 0; i < n; i++) {
      const v = s.bands[i];
      const bh = v * gh * 0.2;
      ctx.fillStyle = GREEN(50, 0.1 + v * 0.42);
      ctx.fillRect(padX + i * bw, baseY - bh, Math.max(1, bw - 1), bh);
    }

    // 触发指示灯
    ctx.fillStyle = s.beatPulse > 0.5 ? AMBER(70, 0.9) : AMBER(40, 0.5);
    ctx.beginPath();
    ctx.arc(padX + 12, padY + 12, 3.5, 0, Math.PI * 2);
    ctx.fill();

    readout(ctx, w, h, s, GREEN, 'SCOPE / TRIG');
    crtOverlay(ctx, w, h, { tint: '0,40,20', lineAlpha: 0.06, vignette: 0.5 });
  },
};

/* ============================================================
 * 3) 扫描线 VU — 琥珀色横向 VU 表 + 数字
 * ============================================================ */
export const retroVU = {
  id: 'retro-vu',
  name: '扫描线 VU',
  theme: 'retro',
  hint: '琥珀 VU 表 · 双通道指针 + 数字',

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    clearBg(ctx, w, h, '#0a0703');

    const cx = w / 2;
    const meterW = Math.min(w * 0.72, 780);
    const meterH = Math.min(h * 0.2, 130);
    const mx = cx - meterW / 2;
    const my = h * 0.34;

    // 表体
    ctx.save();
    ctx.fillStyle = 'rgba(20,14,6,0.85)';
    ctx.beginPath();
    ctx.roundRect(mx, my, meterW, meterH, 8);
    ctx.fill();
    ctx.strokeStyle = AMBER(30, 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();

    // 刻度弧
    const pad = 34;
    const arcW = meterW - pad * 2;
    const cxm = cx;
    const cym = my + meterH * 1.15;
    const r = meterH * 1.02;

    const a0 = Math.PI * 1.18;
    const a1 = Math.PI * 1.82;

    // 绿色安全区 → 琥珀 → 红区
    const zones = [
      [0, 0.62, GREEN(42, 0.35)],
      [0.62, 0.85, AMBER(45, 0.4)],
      [0.85, 1, 'rgba(255,80,60,0.55)'],
    ];
    for (const [s0, s1, col] of zones) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cxm, cym, r, a0 + (a1 - a0) * s0, a0 + (a1 - a0) * s1);
      ctx.stroke();
    }

    // 刻度线 + 数字
    ctx.font = '10px "Consolas", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 20; i++) {
      const f = i / 20;
      const a = a0 + (a1 - a0) * f;
      const major = i % 4 === 0;
      const r0 = r - 5;
      const r1 = r + (major ? 11 : 6);
      ctx.strokeStyle = f > 0.85 ? 'rgba(255,90,70,0.7)' : AMBER(55, major ? 0.7 : 0.35);
      ctx.lineWidth = major ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(cxm + Math.cos(a) * r0, cym + Math.sin(a) * r0);
      ctx.lineTo(cxm + Math.cos(a) * r1, cym + Math.sin(a) * r1);
      ctx.stroke();
      if (major) {
        const val = Math.round(-60 + f * 66);
        ctx.fillStyle = AMBER(52, 0.6);
        ctx.fillText(String(val).padStart(3, ' '), cxm + Math.cos(a) * (r + 24), cym + Math.sin(a) * (r + 24));
      }
    }
    ctx.restore();

    // 两个指针：左=低频 右=高频（模拟双通道 VU）
    const drawNeedle = (val, col, phase) => {
      const f = Math.max(0, Math.min(1, val));
      // VU 表特有的二阶阻尼余震
      this['_n' + phase] = this['_n' + phase] === undefined ? f : this['_n' + phase] + (f - this['_n' + phase]) * Math.min(1, dt * (phase === 1 ? 9 : 6));
      const nv = this['_n' + phase];
      const jitter = s.beatPulse * (phase === 1 ? 0.012 : 0.02) * (Math.random() - 0.5);
      const a = a0 + (a1 - a0) * (nv + jitter);
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.shadowColor = col;
      ctx.beginPath();
      ctx.moveTo(cxm, cym);
      ctx.lineTo(cxm + Math.cos(a) * (r + 2), cym + Math.sin(a) * (r + 2));
      ctx.stroke();
      ctx.restore();
    };
    drawNeedle(s.bass * 0.9 + s.level * 0.25, AMBER(60, 0.9), 1);
    drawNeedle(s.treble * 0.85 + s.mid * 0.45, GREEN(58, 0.75), 2);

    // 数字读数
    ctx.save();
    ctx.font = '600 34px "Consolas", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = AMBER(62, 0.85);
    ctx.shadowBlur = 14;
    ctx.shadowColor = AMBER(60, 0.7);
    const db = s.level > 0 ? (20 * Math.log10(Math.max(0.0001, s.level * 3))).toFixed(1) : '-inf';
    ctx.fillText(`${db} dB`, cx, my + meterH + 52);
    ctx.shadowBlur = 0;
    ctx.font = '11px "Consolas", monospace';
    ctx.fillStyle = AMBER(50, 0.55);
    ctx.fillText(`BPM ${s.bpm || '---'}    PEAK ${(s.flux * 900).toFixed(1)}`, cx, my + meterH + 78);
    ctx.restore();

    // 底部频谱条
    const n = s.bands.length;
    const bw = meterW / n;
    const baseY = h * 0.78;
    for (let i = 0; i < n; i++) {
      const v = s.bands[i];
      const bh = v * h * 0.16;
      const g = ctx.createLinearGradient(0, baseY - bh, 0, baseY);
      g.addColorStop(0, AMBER(60, 0.2 + v * 0.8));
      g.addColorStop(1, AMBER(45, 0.1 + v * 0.35));
      ctx.fillStyle = g;
      ctx.fillRect(mx + i * bw, baseY - bh, Math.max(1, bw - 1.2), bh);
    }

    readout(ctx, w, h, s, AMBER, 'VU / RMS');
    crtOverlay(ctx, w, h, { tint: '40,25,0', lineAlpha: 0.045, vignette: 0.58 });
  },
};