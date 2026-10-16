/**
 * 极简暗色 audiophile 风格预设（4 套）
 * 深灰底 + 单一强调色（琥珀），动效克制但依然跟节拍。
 * 设计原则：一屏最多两种字号、一种强调色、大量留白。
 */

import { clearBg, roundRect } from './visualizer.js';

const ACCENT = { h: 38, s: 92, l: 58 };   // 琥珀
const ACCENT2 = { h: 190, s: 70, l: 60 };  // 冷调对比

const a = (l, alpha = 1) => `hsla(${ACCENT.h},${ACCENT.s}%,${l}%,${alpha})`;
const a2 = (l, alpha = 1) => `hsla(${ACCENT2.h},${ACCENT2.s}%,${l}%,${alpha})`;

/* ============================================================
 * 1) 极简频谱 — 细线柱，无辉光，留白
 * ============================================================ */
export const minimalBars = {
  id: 'min-bars',
  name: '极简频谱',
  theme: 'minimal',
  hint: '细线柱 · 无辉光 · 大量留白',

  init(ctx, w, h) { this.peaks = new Float32Array(64); },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    clearBg(ctx, w, h, '#0c0d10');

    const mid = h * 0.58;
    const n = s.bands.length;
    const bw = Math.max(1, (w * 0.72) / n);
    const startX = (w - bw * n) / 2;
    const maxH = h * 0.3;

    // 极淡中线
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.1, mid);
    ctx.lineTo(w * 0.9, mid);
    ctx.stroke();

    for (let i = 0; i < n; i++) {
      const v = Math.min(1.2, s.bands[i]);
      const bh = v * maxH;
      const x = startX + i * bw;

      // 柱体：底部实、顶部淡
      const g = ctx.createLinearGradient(0, mid, 0, mid - bh);
      g.addColorStop(0, a(50, 0.15 + v * 0.55));
      g.addColorStop(1, a(62, 0.35 + v * 0.65));
      ctx.fillStyle = g;
      ctx.fillRect(x, mid - bh, Math.max(1, bw - 1.5), bh);

      // 镜像弱化
      ctx.fillStyle = a(48, 0.06 + v * 0.16);
      ctx.fillRect(x, mid + 1, Math.max(1, bw - 1.5), bh * 0.42);

      // 峰值细线
      this.peaks[i] = Math.max(v, (this.peaks[i] || 0) - dt * 0.4);
      ctx.fillStyle = a(72, 0.5);
      ctx.fillRect(x, mid - this.peaks[i] * maxH - 1, Math.max(1, bw - 1.5), 1);
    }

    // 低频呼吸圆（唯一的大动作，克制）
    const R = Math.min(w, h) * 0.045 * (1 + s.bass * 0.5 + s.beatPulse * 0.25);
    ctx.strokeStyle = a(58, 0.18 + s.beatPulse * 0.3);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.24, R, 0, Math.PI * 2);
    ctx.stroke();
  },
};

/* ============================================================
 * 2) 涟漪 — 鼓点落水扩散的同心圆
 * ============================================================ */
export const minimalRipple = {
  id: 'min-ripple',
  name: '涟漪',
  theme: 'minimal',
  hint: '鼓点落水 · 同心圆扩散',

  init(ctx, w, h) { this.ripples = []; },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    clearBg(ctx, w, h, '#0b0c0f');

    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) * 0.46;

    if (s.beat) {
      this.ripples.push({ r: 0, life: 1, w: 2.2 + s.bass * 3 });
      // 副涟漪，制造层次
      if (s.bass > 0.4) this.ripples.push({ r: -14, life: 0.8, w: 1.4 });
    }

    ctx.save();
    ctx.lineCap = 'round';
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.r += dt * (150 + s.energy * 320);
      rp.life -= dt * 0.85;
      if (rp.life <= 0 || rp.r > maxR * 1.3) {
        this.ripples.splice(i, 1);
        continue;
      }
      const alpha = rp.life * 0.5 * (1 - rp.r / (maxR * 1.25));
      ctx.strokeStyle = a(58, Math.max(0, alpha));
      ctx.lineWidth = rp.w * rp.life;
      ctx.beginPath();
      ctx.arc(cx, cy, rp.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // 中心静止圆 + 低频脉冲
    ctx.save();
    ctx.strokeStyle = a2(60, 0.1);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * 0.72, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const coreR = 6 + s.bass * 20 + s.beatPulse * 12;
    ctx.fillStyle = a(60, 0.1 + s.beatPulse * 0.28);
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();

    // 频谱作为底部一条极细的能量条
    const n = s.bands.length;
    const bw = (w * 0.6) / n;
    const bx = (w - bw * n) / 2;
    const by = h * 0.9;
    for (let i = 0; i < n; i++) {
      const v = s.bands[i];
      ctx.fillStyle = a(55, 0.06 + v * 0.5);
      ctx.fillRect(bx + i * bw, by - v * 26, Math.max(1, bw - 1), Math.max(0.6, v * 26));
    }
  },
};

/* ============================================================
 * 3) 示波线 — 单条平滑波形线
 * ============================================================ */
export const minimalScope = {
  id: 'min-scope',
  name: '示波线',
  theme: 'minimal',
  hint: '单线波形 · 平滑追踪',

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    clearBg(ctx, w, h, '#0a0b0e');

    const cy = h / 2;
    const amp = h * 0.26 * (0.55 + s.energy * 0.9);

    // 网格：极淡十字准线
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.moveTo(w / 2, h * 0.16);
    ctx.lineTo(w / 2, h * 0.84);
    ctx.stroke();

    const wave = s.waveSmooth;
    const N = wave.length;

    // 主线
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w;
      const y = cy - wave[i] * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = a(60, 0.9);
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 线下方极淡填充，制造体积感
    ctx.lineTo(w, cy);
    ctx.lineTo(0, cy);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, cy - amp, 0, cy + amp);
    g.addColorStop(0, a(58, 0.14 + s.level * 0.2));
    g.addColorStop(0.5, a(58, 0.02));
    g.addColorStop(1, a2(60, 0.06));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    // 击打时在准线上打一个小标记（克制但明确）
    if (s.beatPulse > 0.02) {
      ctx.fillStyle = a(70, s.beatPulse * 0.5);
      ctx.beginPath();
      ctx.arc(w / 2, cy, 3 + s.beatPulse * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/* ============================================================
 * 4) 频谱环 — 极简环形，单色描边，无填充
 * ============================================================ */
export const minimalRing = {
  id: 'min-ring',
  name: '频谱环',
  theme: 'minimal',
  hint: '极简描边环 · 呼吸缩放',

  init(ctx, w, h) { this.rot = 0; },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    clearBg(ctx, w, h, '#0b0c0f');

    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.3;
    this.rot += dt * (0.05 + s.mid * 0.18);

    // 底层完整圆环
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    // 频谱段：向外延伸的细线
    const n = s.bands.length;
    const step = (Math.PI * 2) / n;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.rot);
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const v = Math.min(1.25, s.bands[i]);
      const ang = i * step;
      const len = v * R * 0.5;
      const inside = R;
      ctx.strokeStyle = a(58, 0.22 + v * 0.75);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * (inside - 0.5), Math.sin(ang) * (inside - 0.5));
      ctx.lineTo(Math.cos(ang) * (inside + len), Math.sin(ang) * (inside + len));
      ctx.stroke();
    }
    ctx.restore();

    // 内侧镜像环（反向）
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-this.rot * 0.6);
    for (let i = 0; i < n; i++) {
      const v = Math.min(1.25, s.bands[i]);
      const ang = i * step;
      const len = v * R * 0.26;
      ctx.strokeStyle = a2(58, 0.08 + v * 0.34);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * (R - 1), Math.sin(ang) * (R - 1));
      ctx.lineTo(Math.cos(ang) * (R - 1 - len), Math.sin(ang) * (R - 1 - len));
      ctx.stroke();
    }
    ctx.restore();

    // 中心：低频驱动的细十字
    const cs = 8 + s.bass * 26 + s.beatPulse * 14;
    ctx.strokeStyle = a(60, 0.2 + s.beatPulse * 0.4);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - cs, cy);
    ctx.lineTo(cx + cs, cy);
    ctx.moveTo(cx, cy - cs);
    ctx.lineTo(cx, cy + cs);
    ctx.stroke();
  },
};