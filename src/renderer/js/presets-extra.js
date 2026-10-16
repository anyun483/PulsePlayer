/**
 * 新增预设（第二批次，9 套）
 * 让总数从 11 提升到 20，形态覆盖瀑布图、透视网格、李萨如、双声道电平等。
 */

import { clearBg, hsv, roundRect } from './visualizer.js';

const GREEN = (l, a = 1) => `hsla(140,72%,${l}%,${a})`;
const AMBER = (l, a = 1) => `hsla(42,92%,${l}%,${a})`;

/* ============================================================
 * 霓虹 · 频谱瀑布：历史频谱逐行下滚
 * 用离屏 canvas 做滚动缓冲，比每帧重绘 64×N 个矩形快得多
 * ============================================================ */
export const neonFall = {
  id: 'neon-fall',
  name: '频谱瀑布',
  theme: 'neon',
  hint: '历史频谱逐行下滚 · 色带时间轴',

  init(ctx, w, h) {
    this.buf = null;
    this.row = 0;
  },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    const bands = s.bands;
    const n = bands.length;

    // 滚动缓冲按 CSS 像素建立，避免 DPR 变化时错位
    if (!this.buf || this.buf.width !== Math.max(1, Math.floor(w)) || this.buf.height !== Math.max(1, Math.floor(h))) {
      this.buf = document.createElement('canvas');
      this.buf.width = Math.max(1, Math.floor(w));
      this.buf.height = Math.max(1, Math.floor(h));
      this.bufCtx = this.buf.getContext('2d');
      this.bufCtx.fillStyle = '#04060c';
      this.bufCtx.fillRect(0, 0, this.buf.width, this.buf.height);
      this.row = 0;
    }

    const bh = this.buf.height;
    const bw = this.buf.width;
    const bctx = this.bufCtx;

    // 把画面整体下移 2px，顶部空出一行写新数据
    bctx.globalCompositeOperation = 'copy';
    bctx.drawImage(this.buf, 0, 2);
    bctx.globalCompositeOperation = 'source-over';

    const cellW = bw / n;
    for (let i = 0; i < n; i++) {
      const v = Math.min(1.3, bands[i]);
      const hue = 190 + v * 165;
      bctx.fillStyle = hsv(hue, 100, 12 + v * 62, 0.28 + v * 0.72);
      bctx.fillRect(i * cellW, 0, Math.ceil(cellW) + 1, 2);
    }

    ctx.save();
    ctx.fillStyle = '#04060c';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.buf, 0, 0, bw, bh, 0, 0, w, h);

    // 顶部一行"当前帧"高亮描边，给出时间轴参照
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const v = Math.min(1.3, bands[i]);
      ctx.fillStyle = hsv(190 + v * 165, 100, 55 + v * 25, 0.85);
      ctx.fillRect(i * (w / n), 0, (w / n) - 0.5, 2.5);
    }

    // 击打时的横向闪线
    if (s.beat) {
      ctx.strokeStyle = `rgba(255,90,220,${0.35 * s.beatPulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.lineTo(w, 4);
      ctx.stroke();
    }
    ctx.restore();
  },
};

/* ============================================================
 * 霓虹 · 透视网格：synthwave 地平线，随节拍加速推进
 * ============================================================ */
export const neonGrid = {
  id: 'neon-grid',
  name: '透视网格',
  theme: 'neon',
  hint: 'synthwave 地平线 · 节拍加速推进',

  init(ctx, w, h) { this.zoff = 0; },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    clearBg(ctx, w, h, '#06030f');

    const cx = w / 2;
    const horizon = h * 0.46;
    this.zoff = (this.zoff + dt * (0.5 + s.energy * 1.6)) % 1;

    // 落日
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sunR = Math.min(w, h) * 0.16 * (1 + s.bass * 0.22);
    const sg = ctx.createRadialGradient(cx, horizon - sunR * 0.35, 0, cx, horizon - sunR * 0.35, sunR * 1.7);
    sg.addColorStop(0, `rgba(255,220,80,${0.55 + s.beatPulse * 0.25})`);
    sg.addColorStop(0.45, `rgba(255,60,150,${0.35 + s.mid * 0.3})`);
    sg.addColorStop(1, 'rgba(80,0,120,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(cx, horizon - sunR * 0.35, sunR * 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 落日上的横向切槽
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) {
      const y = horizon - sunR * 0.35 - sunR * 0.95 + i * (sunR * 0.3) + (this.zoff * 4 % 4);
      ctx.fillRect(cx - sunR * 2, y, sunR * 4, sunR * 0.11);
    }
    ctx.restore();

    // 地面透视网格
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.2;

    const ROWS = 16;
    for (let i = 0; i < ROWS; i++) {
      const z = (i / ROWS + this.zoff) % 1;
      const p = Math.pow(z, 2.4);                 // 透视压缩
      const y = horizon + p * (h - horizon) * 1.15;
      if (y > h) continue;
      const alpha = (1 - p) * (0.35 + s.level * 1.4);
      ctx.strokeStyle = hsv(285 + p * 40, 100, 60, alpha);
      ctx.shadowBlur = 6 * (1 - p);
      ctx.shadowColor = hsv(290, 100, 55, alpha);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 纵向放射线（汇聚到消失点）
    const COLS = 22;
    for (let i = 0; i <= COLS; i++) {
      const f = i / COLS;
      const x = cx + (f - 0.5) * w * 2.6;
      const alpha = 0.1 + s.treble * 0.5;
      ctx.strokeStyle = hsv(292, 100, 58, alpha);
      ctx.shadowBlur = 5;
      ctx.shadowColor = hsv(292, 100, 55, alpha);
      ctx.beginPath();
      ctx.moveTo(cx, horizon);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.restore();

    // 地平线上叠一层频谱剪影
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const n = s.bands.length;
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      const v = Math.min(1.3, s.bands[i]);
      const bh = v * (h - horizon) * 0.55;
      const g = ctx.createLinearGradient(0, horizon - bh, 0, horizon);
      g.addColorStop(0, hsv(190 + v * 150, 100, 66, 0.85));
      g.addColorStop(1, hsv(310, 100, 50, 0.15));
      ctx.fillStyle = g;
      ctx.fillRect(i * bw, horizon - bh, bw - 0.6, bh);
    }
    ctx.restore();
  },
};

/* ============================================================
 * 霓虹 · 丝带：多层相位错开的流动曲线
 * ============================================================ */
export const neonRibbon = {
  id: 'neon-ribbon',
  name: '流动丝带',
  theme: 'neon',
  hint: '多层相位错开 · 频谱驱动振幅',

  init(ctx, w, h) { this.phase = 0; },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    // 拖影营造丝带残影
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    this.phase += dt * (0.9 + s.energy * 2.4);
    const cy = h / 2;
    const LAYERS = 5;
    const N = 128;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let L = 0; L < LAYERS; L++) {
      const lp = this.phase + L * 0.55;
      const yOff = (L - (LAYERS - 1) / 2) * (h * 0.055);
      const amp = h * 0.2 * (0.35 + s.level * 1.6) * (1 - L * 0.11);
      const hue = 185 + L * 34 + s.mid * 60;

      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const x = u * w;
        // 三个不同频率的正弦叠加 → 有机流动感
        const b = s.bands[Math.floor(u * (s.bands.length - 1))] || 0;
        const y =
          cy +
          yOff +
          Math.sin(u * 6.2 + lp) * amp * (0.55 + b * 0.85) +
          Math.sin(u * 2.7 - lp * 0.7) * amp * 0.42 +
          Math.sin(u * 13.5 + lp * 1.6) * amp * 0.18 * (1 + s.treble);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hsv(hue, 100, 62, 0.5 - L * 0.075);
      ctx.lineWidth = (LAYERS - L) * 1.5;
      ctx.shadowBlur = 16;
      ctx.shadowColor = hsv(hue, 100, 58, 0.85);
      ctx.stroke();
    }
    ctx.restore();

    // 节拍时横向掠过一道亮线
    if (s.beatPulse > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const y = cy + (s.balance * h * 0.18);
      const g = ctx.createLinearGradient(0, y - 22, 0, y + 22);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, `rgba(255,255,255,${0.16 * s.beatPulse})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 22, w, 44);
      ctx.restore();
    }
  },
};

/* ============================================================
 * 极简 · 呼吸圆：单圆环随低频呼吸
 * ============================================================ */
export const minBreathe = {
  id: 'min-breathe',
  name: '呼吸圆',
  theme: 'minimal',
  hint: '单圆环 · 随低频缓慢呼吸',

  init(ctx, w, h) { this.pulse = 0; },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    clearBg(ctx, w, h, '#0c0d10');
    const cx = w / 2;
    const cy = h / 2;

    // 呼吸量用低频驱动，慢速跟随
    this.pulse += (s.bass - this.pulse) * Math.min(1, dt * 2.2);
    const R = Math.min(w, h) * (0.17 + this.pulse * 0.16 + s.beatPulse * 0.035);

    // 外圈
    ctx.strokeStyle = `hsla(38,92%,58%,${0.14 + this.pulse * 0.5})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    // 内圈（反向轻微）
    ctx.strokeStyle = `hsla(190,70%,60%,${0.07 + s.treble * 0.3})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2);
    ctx.stroke();

    // 环绕频谱点：把 64 段铺在圆周上，只画点不画柱
    const n = s.bands.length;
    for (let i = 0; i < n; i++) {
      const v = Math.min(1.2, s.bands[i]);
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const rr = R * 1.24 + v * Math.min(w, h) * 0.055;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      ctx.fillStyle = `hsla(38,92%,${50 + v * 22}%,${0.18 + v * 0.62})`;
      ctx.beginPath();
      ctx.arc(x, y, 1 + v * 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // 中心实心点
    ctx.fillStyle = `hsla(38,92%,60%,${0.2 + s.beatPulse * 0.5})`;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5 + this.pulse * 5, 0, Math.PI * 2);
    ctx.fill();
  },
};

/* ============================================================
 * 极简 · 点阵频谱：网格点阵，亮度随频段
 * ============================================================ */
export const minDots = {
  id: 'min-dots',
  name: '点阵频谱',
  theme: 'minimal',
  hint: '网格点阵 · 亮度跟随频段',

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    clearBg(ctx, w, h, '#0b0c0f');

    const COLS = 40;
    const ROWS = 22;
    const padX = w * 0.08;
    const padY = h * 0.12;
    const gw = w - padX * 2;
    const gh = h - padY * 2;
    const stepX = gw / (COLS - 1);
    const stepY = gh / (ROWS - 1);
    const n = s.bands.length;

    for (let c = 0; c < COLS; c++) {
      // 列 → 频段（对数映射和主频段一致：低频列多、高频列少）
      const bi = Math.floor(Math.pow(c / (COLS - 1), 1.35) * (n - 1));
      const v = Math.min(1.2, s.bands[bi] || 0);
      const litRows = Math.round(v * ROWS);

      for (let r = 0; r < ROWS; r++) {
        const x = padX + c * stepX;
        const y = padY + (ROWS - 1 - r) * stepY;
        // 从底部往上点亮
        const on = r < litRows;
        // 顶部几行给一点余晖，避免截断感
        const edge = r === litRows ? 0.35 : 0;
        const a = on ? 0.14 + (r / ROWS) * 0.72 : edge;
        if (a <= 0.02) continue;

        const rr = on ? 1.5 + (r / ROWS) * 1.4 : 1.2;
        ctx.fillStyle = `hsla(38,92%,${52 + (r / ROWS) * 16}%,${a})`;
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 底部分隔线
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, padY + gh + 8);
    ctx.lineTo(padX + gw, padY + gh + 8);
    ctx.stroke();
  },
};

/* ============================================================
 * 极简 · 双声道电平：真实 L/R 电平条 + 峰值保持
 * ============================================================ */
export const minLevels = {
  id: 'min-levels',
  name: '双声道电平',
  theme: 'minimal',
  hint: '真实 L/R 电平 · 峰值保持',

  init(ctx, w, h) {
    this.pkL = 0;
    this.pkR = 0;
    this.holdL = 1;
    this.holdR = 1;
  },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    clearBg(ctx, w, h, '#0c0d10');

    const barW = Math.min(26, w * 0.035);
    const gap = Math.min(60, w * 0.08);
    const cx = w / 2;
    const barH = h * 0.5;
    const top = (h - barH) / 2;

    const draw = (val, xOff, label) => {
      const x = cx + xOff;
      // 外框
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, top, barW, barH);

      // 填充（自底向上）
      const v = Math.max(0, Math.min(1, val * 2.6));
      const fh = v * barH;
      const g = ctx.createLinearGradient(0, top + barH - fh, 0, top + barH);
      g.addColorStop(0, 'hsla(38,92%,64%,0.95)');
      g.addColorStop(0.75, 'hsla(38,92%,52%,0.75)');
      g.addColorStop(1, 'hsla(38,92%,46%,0.5)');
      ctx.fillStyle = g;
      ctx.fillRect(x, top + barH - fh, barW, fh);

      // 标签
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '10px "Consolas", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, x + barW / 2, top + barH + 16);
      return v;
    };

    const vL = draw(s.rmsL, -gap - barW, 'L');
    const vR = draw(s.rmsR, gap, 'R');

    // 峰值保持线（缓慢下落）
    this.pkL = Math.max(vL, this.pkL - dt * 0.28);
    this.pkR = Math.max(vR, this.pkR - dt * 0.28);
    const pk = (p, xOff) => {
      const x = cx + xOff;
      const y = top + barH - p * barH;
      ctx.strokeStyle = 'hsla(190,70%,66%,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 3, y);
      ctx.lineTo(x + barW + 3, y);
      ctx.stroke();
    };
    pk(this.pkL, -gap - barW);
    pk(this.pkR, gap);

    // 声道平衡指示
    ctx.textAlign = 'center';
    ctx.font = '10px "Consolas", monospace';
    const bal = Math.round(s.balance * 100);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillText(`BAL ${bal > 0 ? 'R' : 'L'}${Math.abs(bal)}`, cx, top - 14);

    // 底部频谱细线
    const n = s.bands.length;
    const bw = (w * 0.5) / n;
    const bx = cx - (w * 0.5) / 2;
    const by = top + barH + 44;
    for (let i = 0; i < n; i++) {
      const v = s.bands[i];
      ctx.fillStyle = `hsla(38,92%,55%,${0.08 + v * 0.55})`;
      ctx.fillRect(bx + i * bw, by - v * 30, Math.max(1, bw - 1), Math.max(0.8, v * 30));
    }
  },
};

/* ============================================================
 * 复古 · 李萨如：X-Y 示波器图形（左声道 vs 右声道）
 * ============================================================ */
export const retroLissajous = {
  id: 'retro-lissajous',
  name: '李萨如图',
  theme: 'retro',
  hint: 'X-Y 示波 · 左右声道相位关系',

  init(ctx, w, h) { this.trailA = 0.16; },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    // 磷光余晖
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#010803';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.34;

    // 边框与十字
    ctx.save();
    ctx.strokeStyle = GREEN(35, 0.22);
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - R * 1.25, cy - R * 1.25, R * 2.5, R * 2.5);
    ctx.beginPath();
    ctx.moveTo(cx - R * 1.25, cy);
    ctx.lineTo(cx + R * 1.25, cy);
    ctx.moveTo(cx, cy - R * 1.25);
    ctx.lineTo(cx, cy + R * 1.25);
    ctx.stroke();
    ctx.restore();

    const L = s.waveL;
    const Rr = s.waveR;
    const N = 1024;
    const amp = R * (0.55 + s.energy * 0.7);

    // 主迹线
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowBlur = 12;
    ctx.shadowColor = GREEN(60, 0.9);
    ctx.beginPath();
    for (let i = 0; i < N; i += 2) {
      const x = cx + (L[i] || 0) * amp;
      const y = cy - (Rr[i] || 0) * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = GREEN(68, 0.85);
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // 轻微错相位重影，增强立体感
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    for (let i = 0; i < N; i += 2) {
      const j = (i + 24) % N;
      const x = cx + (L[j] || 0) * amp * 1.06;
      const y = cy - (Rr[i] || 0) * amp * 1.06;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = GREEN(52, 0.6);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // 角落读数
    ctx.save();
    ctx.font = '10px "Consolas", monospace';
    ctx.fillStyle = GREEN(52, 0.6);
    ctx.textAlign = 'left';
    ctx.fillText(`L ${(s.rmsL * 100).toFixed(1)}  R ${(s.rmsR * 100).toFixed(1)}`, cx - R * 1.25 + 8, cy - R * 1.25 - 8);
    ctx.fillText(`BAL ${(s.balance * 100).toFixed(0)}`, cx - R * 1.25 + 8, cy - R * 1.25 + 6);
    ctx.restore();

    // CRT 覆盖
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#00280a';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    ctx.restore();
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  },
};

/* ============================================================
 * 复古 · 频谱瀑布图：CRT 色带自上而下
 * ============================================================ */
export const retroWaterfall = {
  id: 'retro-waterfall',
  name: '瀑布光谱',
  theme: 'retro',
  hint: 'CRT 色带 · 时间轴向下',

  init(ctx, w, h) { this.buf = null; },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    const bands = s.bands;
    const n = bands.length;

    if (!this.buf || this.buf.width !== Math.max(1, Math.floor(w)) || this.buf.height !== Math.max(1, Math.floor(h))) {
      this.buf = document.createElement('canvas');
      this.buf.width = Math.max(1, Math.floor(w));
      this.buf.height = Math.max(1, Math.floor(h));
      this.bufCtx = this.buf.getContext('2d');
      this.bufCtx.fillStyle = '#011004';
      this.bufCtx.fillRect(0, 0, this.buf.width, this.buf.height);
    }

    const bctx = this.bufCtx;
    const bw = this.buf.width;
    bctx.globalCompositeOperation = 'copy';
    bctx.drawImage(this.buf, 0, 2);
    bctx.globalCompositeOperation = 'source-over';

    const cellW = bw / n;
    for (let i = 0; i < n; i++) {
      const v = Math.min(1.3, bands[i]);
      // 复古色阶：暗绿 → 绿 → 琥珀 → 白
      let col;
      if (v < 0.25) col = `hsla(140,72%,${18 + v * 90}%,${0.25 + v})`;
      else if (v < 0.62) col = `hsla(${140 - (v - 0.25) * 130},80%,${48 + v * 14}%,${0.6 + v * 0.4})`;
      else col = `hsla(${42 - (v - 0.62) * 40},92%,${58 + v * 22}%,0.95)`;
      bctx.fillStyle = col;
      bctx.fillRect(i * cellW, 0, Math.ceil(cellW) + 1, 2);
    }

    ctx.save();
    ctx.fillStyle = '#011004';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.buf, 0, 0, bw, this.buf.height, 0, 0, w, h);

    // 频率刻度（顶部）
    ctx.font = '9px "Consolas", monospace';
    ctx.fillStyle = GREEN(50, 0.55);
    ctx.textAlign = 'center';
    const marks = [60, 250, 1000, 4000, 16000];
    const fMin = 26;
    const fMax = 17000;
    marks.forEach((f) => {
      const u = Math.log(f / fMin) / Math.log(fMax / fMin);
      const x = u * w;
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x, 10);
      ctx.fillRect(x, 12, 1, 4);
    });

    // 扫描线 + 暗角
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#00280a';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    ctx.restore();

    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  },
};

/* ============================================================
 * 复古 · 圆形扫描：同心圆由内向外 + 频谱扰动
 * ============================================================ */
export const retroCircleScan = {
  id: 'retro-circlescan',
  name: '圆形扫描',
  theme: 'retro',
  hint: '同心圆外扩 · 频谱扰动半径',

  init(ctx, w, h) { this.zoff = 0; },

  draw(ctx, s, t, dt, vz) {
    const w = vz.w;
    const h = vz.h;
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#010803';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.hypot(cx, cy);
    this.zoff = (this.zoff + dt * (0.42 + s.energy * 1.1)) % 1;

    const RINGS = 14;
    ctx.save();
    ctx.translate(cx, cy);
    for (let i = RINGS - 1; i >= 0; i--) {
      const z = (i / RINGS + this.zoff) % 1;
      const r = Math.pow(z, 1.5) * maxR;
      if (r < 3) continue;
      const alpha = (1 - z) * (0.2 + s.level * 1.1);

      ctx.beginPath();
      const SEG = 72;
      for (let k = 0; k <= SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        const band = s.bands[k % s.bands.length] || 0;
        const rr = r * (1 + band * 0.24 * (0.3 + s.beatPulse));
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = GREEN(50 + (1 - z) * 22, alpha);
      ctx.lineWidth = Math.max(0.8, (1 - z) * 2.6);
      ctx.shadowBlur = (1 - z) * 10 * (0.3 + s.energy);
      ctx.shadowColor = GREEN(60, alpha);
      ctx.stroke();
    }

    // 中心亮度
    const cr = 4 + s.bass * 26 + s.beatPulse * 10;
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, cr * 3);
    cg.addColorStop(0, `rgba(160,255,190,${0.5 + s.beatPulse * 0.4})`);
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(0, 0, cr * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 扫描线
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#00280a';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    ctx.restore();
  },
};