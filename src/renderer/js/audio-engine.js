/**
 * 音频引擎
 * ------------------------------------------------------------------
 * 视觉质量的天花板在这里。关键设计：
 *
 * 1) 双通道 AnalyserNode
 *    - fast:  fftSize 2048 / smoothing 0.0   → 抓瞬态、鼓点、瞬态峰值
 *    - smooth:fftSize 2048 / smoothing 0.78  → 抓稳态频谱轮廓，走视觉主体
 *    单通道做不到"既灵敏又平滑"，这是两套张力的来源。
 *
 * 2) 对数频段聚合
 *    FFT 是线性频率轴，直接画柱状图 → 左边挤成一坨、右边稀稀拉拉。
 *    按 log 频率重映射到 64 段，每段做能量加权和峰值混合，
 *    让柱子的视觉分布接近人耳的感知。
 *
 * 3) 自适应节拍检测
 *    低频(20–160Hz)能量 → 滑动平均 → 超阈值判定。
 *    阈值随灵敏度系数缩放，安静段落不会误触发，密集鼓点不会漏。
 */

const FFT_SIZE = 2048;
const BANDS = 64;
const FLUX_HISTORY = 43;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.el = null;
    this.source = null;
    this.analyserFast = null;
    this.analyserSmooth = null;

    this.freqFast = null;
    this.freqSmooth = null;
    this.wave = null;
    this.timeFast = null;
    this.timeSmooth = null;

    this.bands = new Float32Array(BANDS);
    this.bandsRaw = new Float32Array(BANDS);
    this.prevSmooth = null;

    this.waveform = new Float32Array(1024);
    this.waveSmooth = new Float32Array(1024);

    // 真立体声：AnalyserNode 会把输入降混成单声道，想做李萨如图 / 双声道电平条
    // 必须先用 ChannelSplitter 把左右声道分开，各自接一个 analyser。
    this.waveL = new Float32Array(1024);
    this.waveR = new Float32Array(1024);
    this.rmsL = 0;
    this.rmsR = 0;
    this.balance = 0;   // -1(全左) .. +1(全右)

    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this.level = 0;
    this.bassRaw = 0;
    this.energy = 0;
    this.flux = 0;

    this.beat = false;
    this.beatPulse = 0;     // 击打后的衰减包络 1 → 0
    this.beatCount = 0;
    this.bpm = 0;

    this._fluxHistory = new Float32Array(FLUX_HISTORY);
    this._fluxIndex = 0;
    this._historyFilled = 0;
    this._lowNow = false;
    // 用极小值而非 0：performance.now() 从 0 起算，初值 0 会挡住启动后的首拍
    this._lastBeatAt = -1e9;
    this._recentBeats = [];
    this._smoothLerp = 0.5;

    this.sensitivity = 1.0;
    this.ready = false;
    this._activeSource = null;
  }

  async init(audioEl) {
    if (this.ready) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'playback' });
    this.el = audioEl;

    this.source = this.ctx.createMediaElementSource(audioEl);

    // 限幅，避免鼓点瞬态削顶导致频谱图"发毛"
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;

    this.analyserFast = this.ctx.createAnalyser();
    this.analyserFast.fftSize = FFT_SIZE;
    this.analyserFast.smoothingTimeConstant = 0.0;
    this.analyserFast.minDecibels = -95;
    this.analyserFast.maxDecibels = -12;

    this.analyserSmooth = this.ctx.createAnalyser();
    this.analyserSmooth.fftSize = FFT_SIZE;
    this.analyserSmooth.smoothingTimeConstant = 0.78;
    this.analyserSmooth.minDecibels = -95;
    this.analyserSmooth.maxDecibels = -12;

    this.source.connect(limiter);
    limiter.connect(this.ctx.destination);

    // 两条分析支路挂在压缩器之后，保证听到的和看到的一致
    limiter.connect(this.analyserFast);
    limiter.connect(this.analyserSmooth);

    // 立体声分离：splitter 取不到第二声道时会退化成单声道，不会报错
    this.splitter = this.ctx.createChannelSplitter(2);
    this.analyserL = this.ctx.createAnalyser();
    this.analyserL.fftSize = 1024;
    this.analyserL.smoothingTimeConstant = 0.0;
    this.analyserR = this.ctx.createAnalyser();
    this.analyserR.fftSize = 1024;
    this.analyserR.smoothingTimeConstant = 0.0;
    limiter.connect(this.splitter);
    this.splitter.connect(this.analyserL, 0);
    this.splitter.connect(this.analyserR, 1);
    this._rawL = new Float32Array(1024);
    this._rawR = new Float32Array(1024);

    const n = this.analyserFast.frequencyBinCount;
    this.freqFast = new Float32Array(n);
    this.freqSmooth = new Float32Array(n);
    this.prevSmooth = new Float32Array(n);
    this.wave = new Float32Array(FFT_SIZE);
    this.waveform = new Float32Array(1024);

    // 预计算每个对数频段覆盖的 bin 区间
    this._buildBandMap();

    this.ready = true;
  }

  _buildBandMap() {
    const nyquist = this.ctx.sampleRate / 2;
    const bins = this.analyserFast.frequencyBinCount;
    const fMin = 26;
    const fMax = Math.min(17000, nyquist);
    this.bandRanges = [];

    let prevEnd = 0;
    for (let i = 0; i < BANDS; i++) {
      const f0 = fMin * Math.pow(fMax / fMin, i / BANDS);
      const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / BANDS);

      // 首段强制从 bin 0 起，否则 26Hz 以下的 sub-bass 会整段丢失
      let b0 = i === 0 ? 0 : Math.max(prevEnd, Math.floor((f0 / nyquist) * bins));
      let b1 = Math.ceil((f1 / nyquist) * bins);

      // 夹紧到有效范围，并保证至少 1 个 bin、且与上一段严格相接（不留缝、不重叠）
      b0 = Math.max(0, Math.min(bins - 1, b0));
      b1 = Math.max(b0 + 1, Math.min(bins, b1));

      this.bandRanges.push([b0, b1]);
      prevEnd = b1;
    }

    // 最末尾几段可能被 nyquist 截断，把剩余 bin 并入最后一段，保证全覆盖
    if (prevEnd < bins && this.bandRanges.length) {
      const last = this.bandRanges[this.bandRanges.length - 1];
      last[1] = bins;
    }
  }

  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* 忽略 */ }
    }
  }

  setSensitivity(v) {
    this.sensitivity = Math.max(0.4, Math.min(2.5, v || 1));
  }

  /** 每帧调用一次，产出所有视觉参数 */
  update(dt) {
    if (!this.ready) return;
    this.analyserFast.getFloatFrequencyData(this.freqFast);
    this.analyserSmooth.getFloatFrequencyData(this.freqSmooth);
    this.analyserFast.getFloatTimeDomainData(this.wave);

    const n = this.freqFast.length;

    // dB → 0..1 线性能量
    const toNorm = (db) => {
      if (db <= -95) return 0;
      const v = (db + 95) / 83; // -95..-12 → 0..1
      return v > 0 ? v : 0;
    };

    // ---- 对数频段聚合：峰值 + 均值混合，兼顾"有细节"和"有高度" ----
    for (let i = 0; i < BANDS; i++) {
      const [b0, b1] = this.bandRanges[i];
      let peak = 0;
      let sum = 0;
      for (let b = b0; b < b1; b++) {
        const v = toNorm(this.freqSmooth[b]);
        sum += v;
        if (v > peak) peak = v;
      }
      const avg = sum / Math.max(1, b1 - b0);
      // 高频段天然能量低，做一点频率补偿提亮
      const tilt = 1 + (i / BANDS) * 0.85;
      const raw = Math.min(1.35, (peak * 0.62 + avg * 0.55) * tilt);
      this.bandsRaw[i] = raw;

      // 非对称平滑：上升快、回落慢 → 有"打上去"的冲击感，停下时有余韵
      const cur = this.bands[i];
      const rate = raw > cur ? 0.55 : 0.13;
      this.bands[i] = cur + (raw - cur) * Math.min(1, rate * dt * 60);
    }

    // ---- 三个频段能量 ----
    const nyquist = this.ctx.sampleRate / 2;
    const binOf = (hz) => Math.min(n - 1, Math.max(0, Math.round((hz / nyquist) * n)));
    const bandAvg = (f0, f1) => {
      const b0 = binOf(f0);
      const b1 = Math.max(b0 + 1, binOf(f1));
      let s = 0;
      for (let b = b0; b < b1; b++) s += toNorm(this.freqSmooth[b]);
      return s / (b1 - b0);
    };
    this.bassRaw = bandAvg(20, 160);
    const rawMid = bandAvg(160, 2000);
    const rawTreble = bandAvg(2000, 12000);

    const k = Math.min(1, dt * 7);
    this.bass += (this.bassRaw - this.bass) * k;
    this.mid += (rawMid - this.mid) * k;
    this.treble += (rawTreble - this.treble) * k;

    let lvl = 0;
    for (let i = 0; i < n; i++) lvl += toNorm(this.freqSmooth[i]);
    this.level = lvl / n;
    this.energy = this.level * 3.2;

    // ---- 频谱通量（正差分），用于鼓点/瞬态 ----
    let flux = 0;
    for (let i = 1; i < n; i++) {
      const d = toNorm(this.freqFast[i]) - toNorm(this.prevSmooth[i]);
      if (d > 0) flux += d;
      this.prevSmooth[i] = toNorm(this.freqFast[i]);
    }
    this.prevSmooth[0] = toNorm(this.freqFast[0]);
    this.flux = flux / n;

    this._detectBeat(dt);

    // ---- 波形抽取（降采样到 1024 点用于示波器类预设） ----
    const step = FFT_SIZE / 1024;
    for (let i = 0; i < 1024; i++) {
      this.waveform[i] = this.wave[Math.floor(i * step)];
    }
    // 波形额外做轻度平滑，去掉采样锯齿
    for (let i = 0; i < 1024; i++) {
      const a = this.waveform[Math.max(0, i - 1)];
      const b = this.waveform[i];
      const c = this.waveform[Math.min(1023, i + 1)];
      this.waveSmooth[i] = (a + b * 2 + c) / 4;
    }

    this._updateStereo();
  }

  /** 左右声道波形与 RMS —— 李萨如图 / 双声道电平条的数据来源 */
  _updateStereo() {
    if (!this.analyserL) return;
    this.analyserL.getFloatTimeDomainData(this._rawL);
    this.analyserR.getFloatTimeDomainData(this._rawR);

    let sl = 0;
    let sr = 0;
    const N = 1024;
    for (let i = 0; i < N; i++) {
      const l = this._rawL[i];
      const r = this._rawR[i];
      this.waveL[i] = l;
      this.waveR[i] = r;
      sl += l * l;
      sr += r * r;
    }
    const rmsL = Math.sqrt(sl / N);
    const rmsR = Math.sqrt(sr / N);

    // 快启慢落，读数才不会抖成一团
    const k = 0.35;
    this.rmsL += (rmsL - this.rmsL) * k;
    this.rmsR += (rmsR - this.rmsR) * k;

    const sum = this.rmsL + this.rmsR;
    this.balance = sum > 0.0001 ? (this.rmsR - this.rmsL) / sum : 0;
  }

  _detectBeat(dt) {
    const now = performance.now();
    // 低频能量滑动平均
    this._fluxHistory[this._fluxIndex] = this.bassRaw;
    this._fluxIndex = (this._fluxIndex + 1) % FLUX_HISTORY;
    this._historyFilled = Math.min(FLUX_HISTORY, this._historyFilled + 1);

    let sum = 0;
    for (let i = 0; i < FLUX_HISTORY; i++) sum += this._fluxHistory[i];
    const avg = sum / FLUX_HISTORY;
    this._avgBass = avg;

    // 窗口未填满前不做判定。
    // 否则历史全 0 会让 avg≈0、阈值≈0，任何底噪都被误判成鼓点（表现为满屏乱跳）。
    if (this._historyFilled < FLUX_HISTORY) {
      this._lowNow = false;
      this.beat = false;
      this.beatPulse *= Math.exp(-dt * 5.2);
      return;
    }

    // 灵敏度越高，触发门槛越低
    const thresh = avg * (1.18 + 0.42 / this.sensitivity);

    /* 边沿触发（而非电平触发）
       一个鼓点的包络会连续若干帧都高于阈值。若按电平判定，一次鼓点会被记成
       3~4 次节拍，画面表现为高频抖动而不是干净的"一下"。因此要求低频能量
       从"未超阈"跃迁到"超阈"的那一帧才计数。 */
    const low = this.bassRaw > thresh && this.bassRaw > 0.085;
    const rising = low && !this._lowNow;
    this._lowNow = low;

    const minInterval = 190; // ms，防止同一个鼓点因包络抖动被重复计入

    let beat = false;
    if (rising && now - this._lastBeatAt > minInterval) {
      beat = true;
      this._lastBeatAt = now;
      this.beatCount++;

      // 简易 BPM 估计：取最近若干次击打间隔的中位数
      this._recentBeats.push(now);
      while (this._recentBeats.length > 12) this._recentBeats.shift();
      if (this._recentBeats.length >= 4) {
        const gaps = [];
        for (let i = 1; i < this._recentBeats.length; i++) {
          gaps.push(this._recentBeats[i] - this._recentBeats[i - 1]);
        }
        gaps.sort((a, b) => a - b);
        const med = gaps[Math.floor(gaps.length / 2)];
        if (med > 200) {
          let bpm = 60000 / med;
          while (bpm < 70) bpm *= 2;
          while (bpm > 190) bpm /= 2;
          this.bpm = Math.round(this.bpm ? this.bpm * 0.7 + bpm * 0.3 : bpm);
        }
      }
    }

    this.beat = beat;
    // 击打包络：瞬间拉满，之后按时间常数衰减
    if (beat) this.beatPulse = 1;
    else this.beatPulse *= Math.exp(-dt * 5.2);
    if (this.beatPulse < 0.001) this.beatPulse = 0;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }
}

/* ============================================================
 * 内置示例曲：程序化生成的合成器 Looper
 * 目的：首次打开就有画面和声音，不需要用户先准备音乐文件。
 * 用 OfflineAudioContext 离线渲染成 AudioBuffer，再转成 WAV blob。
 * ============================================================ */
export async function renderDemoTrack(sampleRate = 44100) {
  const bpm = 124;
  const beat = 60 / bpm;
  const bars = 16;
  const dur = beat * 4 * bars;
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * dur), sampleRate);

  const master = ctx.createGain();
  master.gain.value = 0.82;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  master.connect(comp).connect(ctx.destination);

  // ---- 侧链：每拍给 pad 让位，制造"呼吸" ----
  const padBus = ctx.createGain();
  const padComp = ctx.createDynamicsCompressor();
  padComp.threshold.value = -28;
  padComp.ratio.value = 8;
  padBus.connect(padComp).connect(master);

  const kick = (t) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    g.gain.setValueAtTime(1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.4);
  };

  const snare = (t) => {
    // 噪声
    const len = Math.floor(sampleRate * 0.18);
    const buf = ctx.createBuffer(1, len, sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0.55;
    s.connect(bp).connect(g).connect(master);
    s.start(t);

    // 音高层
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.1);
    og.gain.setValueAtTime(0.3, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + 0.15);
  };

  const hat = (t, open) => {
    const dur = open ? 0.16 : 0.045;
    const len = Math.floor(sampleRate * dur);
    const buf = ctx.createBuffer(1, len, sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = open ? 6200 : 8200;
    const g = ctx.createGain();
    g.gain.value = open ? 0.2 : 0.15;
    s.connect(hp).connect(g).connect(master);
    s.start(t);
  };

  const bassNote = (t, freq, dur) => {
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    o2.type = 'square';
    o2.frequency.value = freq * 0.5;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(320, t + dur * 0.8);
    f.Q.value = 6;
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f);
    o2.connect(f);
    f.connect(g).connect(master);
    o.start(t); o2.start(t);
    o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  };

  // A 小调 / F 大调 交替的简单进行
  const roots = [55.0, 55.0, 43.65, 43.65, 49.0, 49.0, 65.41, 58.27];
  const chords = [
    [220.0, 261.63, 329.63], // Am
    [261.63, 329.63, 392.0], // C
    [174.61, 220.0, 261.63], // F
    [196.0, 246.94, 293.66], // G
  ];

  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * beat * 4;
    const root = roots[bar % roots.length];
    const chord = chords[Math.floor(bar / 2) % chords.length];

    // 鼓组
    for (let b = 0; b < 4; b++) {
      const t = t0 + b * beat;
      kick(t);
      kick(t + beat * 0.5);
      if (b === 1 || b === 3) snare(t);
      hat(t + beat * 0.5, false);
      hat(t + beat * 0.25, false);
      hat(t + beat * 0.75, true);
    }
    if (bar % 4 === 3) {
      for (let i = 0; i < 4; i++) snare(t0 + i * beat + beat * 0.5);
    }

    // Bass
    bassNote(t0, root, beat * 0.9);
    bassNote(t0 + beat * 1.5, root, beat * 0.45);
    bassNote(t0 + beat * 2, root * 1.5, beat * 0.4);
    bassNote(t0 + beat * 3, root * (bar % 2 ? 1.5 : 1), beat * 0.9);

    // Pad（三音 + 慢速滤波扫描）
    const padGain = ctx.createGain();
    padGain.gain.value = 0.075;
    const pf = ctx.createBiquadFilter();
    pf.type = 'lowpass';
    pf.Q.value = 3;
    pf.frequency.setValueAtTime(500, t0);
    pf.frequency.linearRampToValueAtTime(3200, t0 + beat * 2);
    pf.frequency.linearRampToValueAtTime(700, t0 + beat * 4);
    padGain.connect(pf).connect(padBus);
    chord.forEach((f, idx) => {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = idx === 0 ? 'sawtooth' : 'triangle';
        o.frequency.value = f * Math.pow(2, det / 1200);
        const g = ctx.createGain();
        g.gain.value = idx === 0 ? 0.5 : 0.34;
        o.connect(g).connect(padGain);
        o.start(t0);
        o.stop(t0 + beat * 4.1);
      }
    });

    // 每小节对 padBus 施加一次侧链下沉
    padBus.gain.setValueAtTime(1, t0);
    padBus.gain.linearRampToValueAtTime(0.55, t0 + 0.05);
    padBus.gain.linearRampToValueAtTime(1, t0 + beat * 0.85);
  }

  const rendered = await ctx.startRendering();
  return encodeWav(rendered);
}

function encodeWav(audioBuffer) {
  const numCh = audioBuffer.numberOfChannels;
  const len = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = len * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const str = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  str(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, dataSize, true);

  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(audioBuffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}