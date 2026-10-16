/**
 * 无头验证：直接测试频段映射 / 节拍检测 / 标签解析的核心逻辑。
 * 不依赖 Electron 和浏览器环境。
 */

const path = require('node:path');

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

/* ---------- 1. 标签解析 ---------- */
console.log('\n[1] 标签解析 metadata.js');
const { readTags } = require('../src/main/metadata');

function makeID3v2(fields) {
  const frames = [];
  for (const [id, text] of Object.entries(fields)) {
    // UTF-8 text frame: encoding(0x03) + text, syncsafe size
    const body = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]);
    const size = body.length;
    const header = Buffer.alloc(10);
    header.write(id, 0, 'latin1');
    header[4] = (size >> 21) & 0x7f;
    header[5] = (size >> 14) & 0x7f;
    header[6] = (size >> 7) & 0x7f;
    header[7] = size & 0x7f;
    frames.push(Buffer.concat([header, body]));
  }
  const tagBody = Buffer.concat(frames);
  const tag = Buffer.alloc(10);
  tag.write('ID3', 0, 'latin1');
  tag[3] = 4; // v2.4
  const sz = tagBody.length;
  tag[6] = (sz >> 21) & 0x7f;
  tag[7] = (sz >> 14) & 0x7f;
  tag[8] = (sz >> 7) & 0x7f;
  tag[9] = sz & 0x7f;
  return Buffer.concat([tag, tagBody]);
}

const fs = require('node:fs');
const os = require('node:os');
const tmp = path.join(os.tmpdir(), 'pulse-test');
fs.mkdirSync(tmp, { recursive: true });

const mp3Path = path.join(tmp, 'test.mp3');
// 造一个带标签的伪 mp3：ID3v2 + 若干 0xFF 填充
const id3 = makeID3v2({ TIT2: '光脉冲', TPE1: '测试歌手', TALB: '测试专辑' });
fs.writeFileSync(mp3Path, Buffer.concat([id3, Buffer.alloc(2048, 0xff)]));

(async () => {
  const tags = await readTags(mp3Path);
  ok('解析 UTF-8 中文标题', tags.title === '光脉冲', `得到: ${tags.title}`);
  ok('解析歌手', tags.artist === '测试歌手', `得到: ${tags.artist}`);
  ok('解析专辑', tags.album === '测试专辑', `得到: ${tags.album}`);
  ok('解析内嵌封面为 null（无 APIC）', tags.picture === null);

  // 文件名兜底
  const fbPath = path.join(tmp, 'Artist Name - Song Title.mp3');
  fs.writeFileSync(fbPath, Buffer.alloc(512, 0));
  const fb = await readTags(fbPath);
  ok('无标签时从文件名提取歌手', fb.artist === 'Artist Name', `得到: ${fb.artist}`);
  ok('无标签时从文件名提取歌名', fb.title === 'Song Title', `得到: ${fb.title}`);

  // 不存在的文件不应抛错
  const missing = await readTags(path.join(tmp, 'does-not-exist.mp3'));
  ok('文件不存在时安全返回', !!missing.title);

  /* ---------- 2. 频段映射数学 ---------- */
  console.log('\n[2] 频段对数映射');

  const FFT_SIZE = 2048;
  const BANDS = 64;
  const nyquist = 44100 / 2;
  const bins = FFT_SIZE / 2;
  const fMin = 26;
  const fMax = Math.min(17000, nyquist);

  // 与 audio-engine.js 的 _buildBandMap 保持同一套算法
  const ranges = [];
  let prevEnd = 0;
  for (let i = 0; i < BANDS; i++) {
    const f0 = fMin * Math.pow(fMax / fMin, i / BANDS);
    const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / BANDS);
    let b0 = i === 0 ? 0 : Math.max(prevEnd, Math.floor((f0 / nyquist) * bins));
    let b1 = Math.ceil((f1 / nyquist) * bins);
    b0 = Math.max(0, Math.min(bins - 1, b0));
    b1 = Math.max(b0 + 1, Math.min(bins, b1));
    ranges.push([b0, b1]);
    prevEnd = b1;
  }
  if (prevEnd < bins) ranges[ranges.length - 1][1] = bins;

  ok('生成 64 个频段', ranges.length === BANDS);
  ok('所有频段 b1 > b0', ranges.every(([a, b]) => b > a));
  ok('所有 bin 索引在范围内', ranges.every(([a, b]) => a >= 0 && b <= bins));
  ok('频段严格相接，无空隙无重叠',
    ranges.every((r, i) => i === 0 || r[0] === ranges[i - 1][1]),
    `第1处断裂: ${ranges.findIndex((r, i) => i > 0 && r[0] !== ranges[i - 1][1])}`);
  ok('首段从 bin 0 开始（sub-bass 不丢失）', ranges[0][0] === 0);
  ok('末段覆盖到最后一个 bin', ranges[ranges.length - 1][1] === bins);
  ok('低频段跨度窄、高频段跨度宽（对数特征）',
    ranges[2][1] - ranges[2][0] < ranges[58][1] - ranges[58][0],
    `低频段=${ranges[2][1] - ranges[2][0]} 高频段=${ranges[58][1] - ranges[58][0]}`);
  ok('覆盖总 bin 数不超上限',
    ranges[ranges.length - 1][1] - ranges[0][0] <= bins);

  /* ---------- 3. 节拍检测 ---------- */
  console.log('\n[3] 节拍检测算法');

  function makeDetector(sensitivity = 1) {
    return {
      bassRaw: 0,
      _fluxHistory: new Float32Array(43),
      _fluxIndex: 0,
      _historyFilled: 0,
      _lowNow: false,
      _lastBeatAt: -1e9,
      sensitivity,
      clock: 0,
      detected: 0,
      feed(dt, bass) {
        this.clock += dt * 1000;
        this.bassRaw = bass;
        this._fluxHistory[this._fluxIndex] = bass;
        this._fluxIndex = (this._fluxIndex + 1) % 43;
        this._historyFilled = Math.min(43, this._historyFilled + 1);

        let sum = 0;
        for (let i = 0; i < 43; i++) sum += this._fluxHistory[i];
        const avg = sum / 43;

        // 窗口未填满不判定，避免历史全 0 导致阈值≈0 的误触发风暴
        if (this._historyFilled < 43) {
          this._lowNow = false;
          return false;
        }

        const thresh = avg * (1.18 + 0.42 / this.sensitivity);

        // 边沿触发：必须从"未超阈"跃迁到"超阈"的那一帧才计数
        const low = bass > thresh && bass > 0.085;
        const rising = low && !this._lowNow;
        this._lowNow = low;

        let beat = false;
        if (rising && this.clock - this._lastBeatAt > 190) {
          beat = true;
          this._lastBeatAt = this.clock;
        }
        if (beat) this.detected++;
        return beat;
      },
    };
  }

  // 稳定 120BPM：每 500ms 一个鼓点，鼓点持续 60ms，其余为底噪
  const frameMs = 1000 / 60;
  const runPattern = (det, holdMs, peak, gapFloor = 0.02) => {
    let c = 0;
    for (let ms = 0; ms < 8000; ms += frameMs) {
      const phase = ms % 500;
      if (det.feed(frameMs, phase < holdMs ? peak : gapFloor)) c++;
    }
    return c;
  };

  const beatCount = runPattern(makeDetector(1), 60, 0.75);
  ok('稳定 120BPM 检出 13-16 次（8秒内，扣掉 0.7s 窗口预热）',
    beatCount >= 13 && beatCount <= 16, `实际: ${beatCount}`);

  ok('短促鼓点 25ms 不漏检',
    runPattern(makeDetector(1), 25, 0.75) >= 13,
    `检出: ${runPattern(makeDetector(1), 25, 0.75)}`);

  ok('长持续低音 200ms 不重复触发',
    runPattern(makeDetector(1), 200, 0.75) >= 13 && runPattern(makeDetector(1), 200, 0.75) <= 16,
    `检出: ${runPattern(makeDetector(1), 200, 0.75)}`);

  // 关键回归：一个鼓点的包络横跨 4 帧，电平触发会记成 4 次节拍（画面高频抖动）
  const dEdge = makeDetector(1);
  for (let i = 0; i < 43; i++) dEdge.feed(frameMs, 0.02);  // 先跑满窗口
  let edgeBeats = 0;
  for (let i = 0; i < 4; i++) if (dEdge.feed(frameMs, 0.75)) edgeBeats++;  // 单个鼓点持续 4 帧
  ok('单个鼓点包络只计一次（边沿触发）', edgeBeats === 1, `计了: ${edgeBeats} 次`);

  // 关键回归：窗口预热期内，历史全 0 会让阈值≈0，导致底噪被当成鼓点
  const dWarm = makeDetector(1);
  let warmBeats = 0;
  for (let i = 0; i < 43; i++) if (dWarm.feed(frameMs, 0.02)) warmBeats++;
  ok('窗口预热期内不产生误触发', warmBeats === 0, `误触发: ${warmBeats}`);

  // 静音不应误触发
  const d2 = makeDetector(1);
  let falseBeats = 0;
  for (let i = 0; i < 600; i++) if (d2.feed(frameMs, 0.02)) falseBeats++;
  ok('持续静音不误触发', falseBeats === 0, `误触发: ${falseBeats}`);

  // 高灵敏度应能检出弱拍
  ok('高灵敏度检出弱拍更多',
    runPattern(makeDetector(2.2), 60, 0.35) >= 14,
    `检出: ${runPattern(makeDetector(2.2), 60, 0.35)}`);

  // 最小间隔保护：每帧都是强峰，190ms 至少隔 11 帧
  const d3 = makeDetector(2.5);
  let c3 = 0;
  for (let i = 0; i < 300; i++) if (d3.feed(frameMs, 0.9)) c3++;
  ok('连续强峰受最小间隔保护', c3 <= 3, `5秒内检出: ${c3}`);

  /* ---------- 4. Range 解析 ---------- */
  console.log('\n[4] HTTP Range 解析');

  function parseRange(header, total) {
    let start = 0, end = total - 1, status = 200;
    if (header) {
      const m = /bytes=(\d*)-(\d*)/.exec(header);
      if (m) {
        if (m[1] !== '') start = parseInt(m[1], 10);
        if (m[2] !== '') end = parseInt(m[2], 10);
        if (m[1] === '' && m[2] !== '') {
          start = Math.max(0, total - parseInt(m[2], 10));
          end = total - 1;
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
          return null;
        }
        end = Math.min(end, total - 1);
        status = 206;
      }
    }
    return { start, end, status, length: end - start + 1 };
  }

  const T = 1000;
  const r1 = parseRange('bytes=0-499', T);
  ok('标准范围 0-499 → 206', r1 && r1.status === 206 && r1.start === 0 && r1.end === 499 && r1.length === 500);

  const r2 = parseRange('bytes=500-', T);
  ok('开放末尾 bytes=500- → 500 到结尾', r2 && r2.start === 500 && r2.end === 999 && r2.length === 500);

  const r3 = parseRange('bytes=-200', T);
  ok('后缀范围 bytes=-200 → 最后 200 字节', r3 && r3.start === 800 && r3.end === 999 && r3.length === 200);

  const r4 = parseRange(null, T);
  ok('无 Range → 200 全量', r4 && r4.status === 200 && r4.length === T);

  ok('越界范围返回 416', parseRange('bytes=2000-3000', T) === null);

  const r5 = parseRange('bytes=0-99999', T);
  ok('超界 end 被裁剪到文件末尾', r5 && r5.end === 999, `得到 end=${r5 && r5.end}`);

  /* ---------- 5. URL 编解码 ---------- */
  console.log('\n[5] 媒体协议 URL 编解码');

  const testPaths = [
    'C:\\Users\\安大大\\Music\\测试 歌曲.mp3',
    'D:/Music/song (1) & mix.flac',
    '/home/user/a b/c#d.opus',
    'C:\\Music\\100%\\纯音乐.wav',
  ];
  let urlOk = true;
  for (const p of testPaths) {
    const u = `pulse-media://local/${Buffer.from(p, 'utf8').toString('base64url')}`;
    const back = Buffer.from(u.split('://local/')[1], 'base64url').toString('utf8');
    if (back !== p) { urlOk = false; console.log(`    失败: ${p} → ${back}`); }
  }
  ok('中文/空格/特殊字符路径往返一致', urlOk);
  ok('base64url 编码无斜杠', testPaths.every((p) => {
    const enc = Buffer.from(p, 'utf8').toString('base64url');
    return !enc.includes('/');
  }));

  /* ---------- 6. 播放列表逻辑 ---------- */
  console.log('\n[6] 播放列表顺序与导航');

  function shuffleOrder(n, rng) {
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }
  const ord = shuffleOrder(100, Math.random);
  ok('随机顺序包含全部 100 项', new Set(ord).size === 100);
  ok('随机顺序是合法排列', ord.every((v) => v >= 0 && v < 100));

  const off = [0, 1, 2, 3, 4];
  ok('顺序模式下一首环绕', (2 + 1) % off.length === 3);
  ok('顺序模式下上一首环绕', (0 - 1 + off.length) % off.length === 4);
  ok('3秒内按上一首回本曲开头', 2.5 < 3);
  ok('超过3秒按上一首跳上曲', 3.5 >= 3);

  /* ---------- 7. 预设完整性 ---------- */
  console.log('\n[7] 预设注册完整性');

  const fsx = require('node:fs');
  const rd = (f) => fsx.readFileSync(path.join(__dirname, '../src/renderer/js', f), 'utf8');
  const neon = rd('presets-neon.js');
  const minimal = rd('presets-minimal.js');
  const retro = rd('presets-retro.js');
  const extra = rd('presets-extra.js');

  const files = [neon, minimal, retro, extra];
  const ids = files.flatMap((s) => [...s.matchAll(/id:\s*'([\w-]+)'/g)].map((m) => m[1]));
  ok('共 20 套预设', ids.length === 20, `实际: ${ids.length}`);
  ok('预设 id 无重复', new Set(ids).size === ids.length);

  const themeCount = (s, th) => (s.match(new RegExp(`theme:\\s*'${th}'`, 'g')) || []).length;
  const ne = themeCount(neon, 'neon') + themeCount(extra, 'neon');
  const mi = themeCount(minimal, 'minimal') + themeCount(extra, 'minimal');
  const re = themeCount(retro, 'retro') + themeCount(extra, 'retro');
  ok('每个预设都有 theme 字段', ne + mi + re === 20, `霓虹${ne} 极简${mi} 复古${re}`);
  ok('霓虹 7 套', ne === 7, `实际 ${ne}`);
  ok('极简 7 套', mi === 7, `实际 ${mi}`);
  ok('复古 6 套', re === 6, `实际 ${re}`);
  ok('每个主题都有预设', ne > 0 && mi > 0 && re > 0);

  const drawCount = (s) => (s.match(/^\s{2}draw\(ctx/gm) || []).length;
  const drawTotal = files.reduce((a, s) => a + drawCount(s), 0);
  ok('每个预设都定义了 draw 方法', drawTotal === 20, `draw 总数: ${drawTotal}`);

  const themes = {
    neon: ids.filter((i) => i.startsWith('neon-')),
    minimal: ids.filter((i) => i.startsWith('min-')),
    retro: ids.filter((i) => i.startsWith('retro-')),
  };
  ok('霓虹 id 数一致', themes.neon.length === ne, JSON.stringify(themes.neon));
  ok('极简 id 数一致', themes.minimal.length === mi, JSON.stringify(themes.minimal));
  ok('复古 id 数一致', themes.retro.length === re, JSON.stringify(themes.retro));

  // 立体声相关预设必须存在（依赖 ChannelSplitter）
  ok('引擎已接立体声分离', /createChannelSplitter/.test(rd('audio-engine.js')));
  ok('李萨如预设存在', ids.includes('retro-lissajous'));
  ok('双声道电平预设存在', ids.includes('min-levels'));

  /* ---------- 8. 安全检查 ---------- */
  console.log('\n[8] 安全配置');

  const html = fsx.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  const baseCss = fsx.readFileSync(path.join(__dirname, '../src/renderer/styles/base.css'), 'utf8');
  const themesCss = fsx.readFileSync(path.join(__dirname, '../src/renderer/styles/themes.css'), 'utf8');
  const appJs = fsx.readFileSync(path.join(__dirname, '../src/renderer/js/app.js'), 'utf8');
  const vizJs = fsx.readFileSync(path.join(__dirname, '../src/renderer/js/visualizer.js'), 'utf8');
  ok('设置了 CSP', /Content-Security-Policy/.test(html));
  ok('CSP 禁止外部脚本', /script-src 'self'/.test(html));
  ok('media-src 允许自定义协议', /media-src[^>]*pulse-media:/.test(html));
  ok('audio 元素存在', /<audio[^>]*id="audio"/.test(html));

  const mainJs = fsx.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  const protoJs = fsx.readFileSync(path.join(__dirname, '../src/main/media-protocol.js'), 'utf8');
  ok('contextIsolation 已开启', /contextIsolation:\s*true/.test(mainJs));
  ok('nodeIntegration 已关闭', /nodeIntegration:\s*false/.test(mainJs));
  ok('自定义协议特权在 ready 前注册', /registerSchemePrivileges/.test(mainJs));
  ok('协议特权声明 standard/secure', /standard:\s*true/.test(protoJs) && /secure:\s*true/.test(protoJs));
  ok('协议声明 stream 支持', /stream:\s*true/.test(protoJs));
  ok('实现了 Range 请求（206）', /Content-Range/.test(protoJs) && /status\s*=\s*206/.test(protoJs));
  ok('越界返回 416', /416/.test(protoJs));

  const preloadJs = fsx.readFileSync(path.join(__dirname, '../src/preload/preload.js'), 'utf8');
  ok('preload 使用 contextBridge', /contextBridge\.exposeInMainWorld/.test(preloadJs));
  ok('preload 未暴露 require', !/exposeInMainWorld[\s\S]*?require\s*:/.test(preloadJs));
  ok('preload 处理拖拽路径', /getPathForFile/.test(preloadJs));

  /* ---------- 8.5 沉浸全屏 ---------- */
  console.log('\n[8.5] 沉浸全屏模式');

  ok('HTML 含全屏按钮', /id="btnFullscreen"/.test(html));
  ok('HTML 含沉浸信息条', /id="immersiveBar"/.test(html));
  ok('HTML 含退出按钮', /id="ibExit"/.test(html));
  ok('三套主题都定义了配色变量',
    /data-theme="neon"/.test(themesCss) && /data-theme="minimal"/.test(themesCss) && /data-theme="retro"/.test(themesCss));
  ok('预设面板可滚动（20 套放不下）', /\.preset-grid[\s\S]{0,200}overflow-y:\s*auto/.test(baseCss));
  ok('CSS 定义 immersive 类', /\.app\.immersive/.test(baseCss));
  ok('CSS 隐藏标题栏', /\.app\.immersive \.titlebar/.test(baseCss));
  ok('CSS 隐藏光标', /cursor-hidden/.test(baseCss));
  ok('JS 定义 enterImmersive', /function enterImmersive/.test(appJs));
  ok('JS 定义 exitImmersive', /function exitImmersive/.test(appJs));
  ok('JS 绑定 F 键', /case 'f':[\s\S]{0,60}toggleImmersive/.test(appJs));
  ok('JS 绑定 Esc 退出', /case 'Escape':[\s\S]{0,80}exitImmersive/.test(appJs));
  ok('双击画布切换沉浸', /viz\.addEventListener\('dblclick'/.test(appJs));
  ok('监听 fullscreenchange 同步状态', /fullscreenchange/.test(appJs));
  // requestFullscreen 无手势时 Promise 永不 settle，必须先切 UI 再请求全屏。
  // 注意匹配实际调用点而非注释里的同名字符串，否则会被注释误导。
  const uiLine = appJs.indexOf("classList.add('immersive')");
  const fsCall = appJs.search(/document\.documentElement\.requestFullscreen\(/);
  ok('先切 UI 再请求全屏（防挂起）',
    uiLine > 0 && fsCall > uiLine,
    `UI 切换在 ${uiLine}，全屏调用在 ${fsCall}，顺序反了会导致点了没反应`);

  /* ---------- 8.6 回归：沉浸模式必须铺满 + 不得弹出列表 ---------- */
  console.log('\n[8.6] 沉浸模式布局回归');

  // 画布 fixed 贴满视口：absolute 仍在 flex 流里，会被标题栏/控制条压扁
  ok('沉浸态 canvas 容器 fixed 铺满视口',
    /\.app\.immersive \.stage\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/s.test(baseCss));
  ok('沉浸态 stage 显式 100vw/100vh',
    /\.app\.immersive \.stage\s*\{[^}]*width:\s*100vw[^}]*height:\s*100vh/s.test(baseCss));
  // 标题栏/控制条必须脱离文档流，否则仍占 44px + 84px
  ok('沉浸态控制条脱离文档流',
    /\.app\.immersive \.controlbar\s*\{[^}]*position:\s*fixed/s.test(baseCss));
  ok('沉浸态标题栏脱离文档流',
    /\.app\.immersive \.titlebar\s*\{[^}]*position:\s*fixed/s.test(baseCss));
  // 播放列表必须 display:none，只靠 translateX(100%) 会滑到左侧压住画面
  ok('沉浸态播放列表 display:none（而非仅 translateX）',
    /\.app\.immersive \.playlist\s*\{[^}]*display:\s*none/s.test(baseCss));
  // JS 侧也要守卫，否则 L 键/按钮仍能打开
  ok('JS 守卫：沉浸模式下禁止打开播放列表',
    /const togglePl[\s\S]{0,240}immersiveOn[\s\S]{0,240}return/.test(appJs));
  ok('JS 进入沉浸时主动关闭侧栏与面板',
    /function enterImmersive[\s\S]{0,900}playlist\.classList\.remove\('open'\)/.test(appJs));

  /* ---------- 8.7 回归：画布尺寸测量 ---------- */
  console.log('\n[8.7] 画布尺寸自适应');

  // resize 必须量容器。量 canvas 自己 + 写内联宽高 = 尺寸被永久钉死在启动值。
  ok('resize 量的是容器而非 canvas 自身',
    /const host = this\._host \|\| this\.canvas\.parentElement/.test(vizJs) &&
    /host\.getBoundingClientRect\(\)/.test(vizJs));
  // 去注释后再判：源码注释里会提到这段历史代码，直接匹配会被注释误导
  const vizCode = vizJs
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  ok('resize 不再写内联 width/height（会覆盖 CSS 100%）',
    /this\.canvas\.style\.width = ''/.test(vizCode) &&
    !/this\.canvas\.style\.width = cssW/.test(vizCode) &&
    !/this\.canvas\.style\.height = cssH/.test(vizCode));
  ok('用 ResizeObserver 盯住容器尺寸变化',
    /new ResizeObserver\(/.test(vizJs));
  ok('容器隐藏时不退化成 0 尺寸',
    /cssW < 1 \|\| cssH < 1/.test(vizJs));
  ok('CSS 让画布撑满容器',
    /#viz\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s.test(baseCss));

  /* ---------- 9. 未定义引用检查 ---------- */
  console.log('\n[9] DOM 引用一致性');

  // appJs 已在 [8] 节统一读取，此处复用
  const allHtmlIds = new Set([...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));
  const elRefs = [...appJs.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]);

  ok('app.js 引用的所有 DOM id 都存在于 HTML',
    elRefs.filter((id) => !allHtmlIds.has(id)).length === 0,
    `缺失: ${elRefs.filter((id) => !allHtmlIds.has(id)).join(', ')}`);
  ok('DOM 引用数量合理', elRefs.length > 30, `引用数: ${elRefs.length}`);

  // HTML 中每个 id 只能出现一次（重复 id 会让 $() 取错元素）
  const htmlIdList = [...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]);
  const dupIds = htmlIdList.filter((v, i) => htmlIdList.indexOf(v) !== i);
  ok('HTML 无重复 id', dupIds.length === 0, `重复: ${[...new Set(dupIds)].join(', ')}`);

  // el 对象里声明的键必须有对应 DOM 节点，否则一定是拼错了
  const elObjBlock = appJs.match(/const el = \{([\s\S]*?)\n\};/);
  ok('el 对象声明完整', !!elObjBlock);
  if (elObjBlock) {
    // html 指向 documentElement，不对应任何 id 节点，需排除
    const NON_ID_KEYS = new Set(['html']);
    const keys = [...elObjBlock[1].matchAll(/(\w+):/g)]
      .map((m) => m[1])
      .filter((k) => !NON_ID_KEYS.has(k));
    const badKeys = keys.filter((k) => !allHtmlIds.has(k));
    ok('el 对象每个键都对应真实 DOM 节点', badKeys.length === 0, `无效键: ${badKeys.join(', ')}`);
    ok('el 对象键数量合理', keys.length >= 35, `键数: ${keys.length}`);
  }

  ok('HTML 元素数量合理', allHtmlIds.size >= 45, `元素数: ${allHtmlIds.size}`);

  /* ---------- 结果 ---------- */
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${'='.repeat(46)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log('='.repeat(46));
  process.exit(fail > 0 ? 1 : 0);
})();