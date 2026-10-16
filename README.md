# PulsePlayer

一款本地音乐播放器，核心是**跟随音乐节奏实时变动的电子脉冲可视化** —— 对标 Poweramp 的视觉冲击力，但把三套截然不同的风格都做进来，随时切换。

![技术栈](https://img.shields.io/badge/Electron-33-47848F)

![预设数](https://img.shields.io/badge/可视化预设-20-ff2d95)

![风格](https://img.shields.io/badge/风格-3-00d8ff)

![License](https://img.shields.io/badge/license-MIT-green)

[![CI](https://github.com/anyun483/PulsePlayer/actions/workflows/ci.yml/badge.svg)](https://github.com/anyun483/PulsePlayer/actions/workflows/ci.yml)

纯本地运行，不联网、不上传、无遥测。零运行时依赖 —— 标签解析、频谱分析、示例曲合成全部自研。

---

## 亮点

### 20 套可视化预设，3 种风格

| 风格           | 预设     | 说明                   |
| ------------ | ------ | -------------------- |
| **霓虹赛博** (7) | 霓虹频谱柱  | 对称柱体 + 地面反射 + 辉光，主视觉 |
|              | 环形频谱   | 径向放射，随中频缓慢自转         |
|              | 粒子脉冲   | 鼓点喷发粒子，中心漩涡吸积        |
|              | 波形隧道   | 沿 Z 轴推进的同心环，频谱扰动半径   |
|              | 频谱瀑布   | 历史频谱逐行下滚的时间轴         |
|              | 透视网格   | synthwave 地平线，节拍加速推进 |
|              | 流动丝带   | 多层相位错开的流动曲线          |
| **极简暗色** (7) | 极简频谱   | 细线柱，无辉光，大量留白         |
|              | 涟漪     | 鼓点落水式同心圆扩散           |
|              | 示波线    | 单条平滑波形线              |
|              | 频谱环    | 极简描边环 + 内侧镜像         |
|              | 呼吸圆    | 单圆环随低频缓慢呼吸           |
|              | 点阵频谱   | 网格点阵，亮度跟随频段          |
|              | 双声道电平  | 真实 L/R 电平 + 峰值保持     |
| **复古终端** (6) | 雷达扫描   | CRT 雷达，频谱回波 + 磷光余晖   |
|              | 示波器网格  | 绿色荧光网格 + 波形迹线重影      |
|              | 扫描线 VU | 琥珀双指针 VU 表 + dB 数字   |
|              | 李萨如图   | X-Y 示波，左右声道相位关系      |
|              | 瀑布光谱   | CRT 色带时间轴向下滚动        |
|              | 圆形扫描   | 同心圆外扩 + 频谱扰动         |

切换风格时**整个界面**（不只是画布）跟着换气质 —— 包括配色、圆角、字体、辉光强度。

### 沉浸全屏

仿 Poweramp：按 `F` 或双击画布进入，隐藏所有界面元素只留画面。  
鼠标移动唤出控制条与曲目信息，静止 2.5 秒后自动淡出并隐藏光标。`Esc` / `F` 退出。

即使浏览器拒绝原生全屏（无用户手势时会拒绝），也会退化为**窗口内沉浸**——界面照样隐藏，不会点了没反应。

沉浸模式下：

- 画布 `position: fixed` 贴满整个视口，标题栏与控制条同步脱离文档流，画面不会被挤压
- 播放列表强制隐藏，按 `L` 也不会弹出（会提示先按 `Esc` 退出），保证画面完整
- 舞台尺寸变化由 `ResizeObserver` 接管，切换全屏后画布立即重算，不需要手动 resize

### 频谱引擎

视觉质量的核心在这几个设计：

- **双通道 AnalyserNode**  
  `fast`（smoothing 0.0）抓鼓点瞬态，`smooth`（smoothing 0.78）抓稳态轮廓。单通道做不到"既灵敏又平滑"，这是画面张力的来源。
- **对数频段聚合**  
  FFT 是线性频率轴，直接画柱状图会左边挤成一坨、右边稀稀拉拉。映射到 **64 段对数频段**，每段做峰值与均值混合，让柱子的视觉分布贴近人耳感知。
- **非对称平滑**  
  上升快（0.55）、回落慢（0.13）—— 鼓点打上去有冲击感，停顿时有余韵，而不是生硬的方波。
- **自适应节拍检测**  
  低频 20–160Hz 能量 → 43 帧滑动平均 → 超阈值判定。阈值随灵敏度系数缩放，安静段落不误触发、密集鼓点不漏。附带 BPM 估算。

  这里有两个容易踩的坑，都已处理：
  - **窗口预热**：历史未填满时平均值为 0，会让阈值≈0，任何底噪都被判成鼓点（表现为满屏乱跳）。窗口填满前不做判定。
  - **边沿触发**：一个鼓点的包络会横跨 3~~4 帧。按电平判定，一次鼓点会被记成 3~~4 次，画面表现为高频抖动而不是干净的"一下"。因此要求低频能量从"未超阈"跃迁到"超阈"的那一帧才计数。
- **压缩器限幅**  
  分析支路挂在 `DynamicsCompressor` 之后，鼓点瞬态不会削顶导致频谱"发毛"。

### 其他

- **本地音乐**：文件夹递归扫描 / 多选文件 / 拖拽导入
- **标签解析**：自研 ID3v2 / ID3v1 / FLAC Vorbis / MP4 ilst 解析（含内嵌封面），不依赖任何第三方库
- **内置示例曲**：程序化合成的 124 BPM Looper，首次打开就有声有画，不用先准备歌
- **全局媒体键**：播放键 / 上下一曲 / 停止（系统级注册，其他程序也响应）
- **流式媒体协议**：自建 `pulse-media://` 协议并手动处理 HTTP Range，保证大文件拖动进度条不卡
- **设置持久化**：音量、风格、预设、灵敏度、随机循环、窗口位置

---

## 下载

不想自己构建的话，直接去 **[Releases](https://github.com/anyun483/PulsePlayer/releases)** 下现成的：

| 文件                                  | 说明                       |
| ----------------------------------- | ------------------------ |
| `PulsePlayer-1.1.0-win-x64-portable.exe` | **免安装版**，双击即用，不写注册表 |
| `PulsePlayer-1.1.0-win-x64-setup.exe`    | 安装版，创建开始菜单 / 桌面快捷方式   |

系统要求：Windows 10 / 11 x64。

## 从源码运行

```bash
git clone https://github.com/anyun483/PulsePlayer.git
cd PulsePlayer
npm install
npm start
```

**Windows** 也可以直接双击 `启动.bat`（已内置 `ELECTRON_RUN_AS_NODE` 清理逻辑）。

### 首次启动点「播放内置示例曲」，立刻能看到效果。

不需要提前准备音乐文件 —— 内置曲是程序化合成的 124 BPM Looper，打开就有声有画。

### 国内网络安装慢？

Electron 运行时约 100MB，直连 GitHub 可能非常慢。用镜像：

```bash
# Windows
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install

# macOS / Linux
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

### 启动即崩溃：`Cannot read properties of undefined (reading 'requestSingleInstanceLock')`

说明你的环境里设置了 `ELECTRON_RUN_AS_NODE=1`。该变量会让 Electron 以纯 Node 模式运行，`require('electron')` 返回字符串路径而不是 API 对象。

直接用 `启动.bat` 或 `./start.sh` 启动即可（已内置清理逻辑）。注意 `ELECTRON_RUN_AS_NODE=`（空值）**无效**，必须从环境中彻底移除：

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe .
```

## 测试

```bash
npm test           # 核心逻辑：标签解析 / 频段映射 / 节拍检测 / Range / 安全配置
npm run test:renderer   # 渲染进程自检：真实 Chromium 里跑 Web Audio + 20 套预设
npm run test:all
```

渲染自检会在真实浏览器内核里建立 AudioContext、逐个绘制 20 套预设、验证三套主题切换，输出 JSON 报告。
目前核心逻辑 **99 项断言**、渲染自检 **33 项检查**，全部通过。

## 打包

```bash
npm run pack   # 免安装 exe
npm run dist   # 安装包 + 免安装版
```

产物在 `dist/`。国内网络建议：

```bash
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ npm run dist
```

> 打包配置里设了 `signAndEditExecutable: false`。electron-builder 默认要下载  
> `winCodeSign` 来给 exe 写入图标和版本信息，但那个包里含 macOS 的符号链接，  
> 在没有开发者模式的 Windows 上会解压失败。跳过它不影响程序运行，只是 exe 用的是  
> Electron 默认图标。装了开发者模式后可以去掉这个配置。
>
> 想要自定义图标的话，把 `build/icon.svg` 转成 `build/icon.ico` 放进 `build/` 即可。

---

## 键盘快捷键

| 按键            | 功能                 |
| ------------- | ------------------ |
| `空格`          | 播放 / 暂停            |
| `←` `→`       | 上一首 / 下一首          |
| `Shift + ←/→` | 后退 / 前进 10 秒       |
| `↑` `↓`       | 音量 ±6%             |
| `M`           | 静音                 |
| `S`           | 随机播放               |
| `R`           | 循环模式（列表 → 单曲 → 顺序） |
| `T`           | 切换风格               |
| `V`           | 切换预设               |
| `F`           | 沉浸全屏（再按一次退出）       |
| `Esc`         | 退出全屏 / 关闭面板        |
| 双击画面          | 进入 / 退出沉浸全屏        |
| `L`           | 播放列表               |
| `O`           | 可视化面板              |
| `H`           | 显示频谱 HUD（看实时数值）    |

按 `H` 打开 HUD 可以直接看到 bass / mid / treble / flux 的实时数值，调灵敏度时很直观。

---

## 项目结构

```
src/
├── main/
│   ├── main.js            主进程：窗口、菜单、IPC、媒体键
│   ├── media-protocol.js  pulse-media:// 流式协议（Range 支持）
│   ├── metadata.js        ID3 / FLAC / MP4 标签解析
│   └── selftest.js        渲染层自检入口（真实 Chromium）
├── preload/
│   └── preload.js         contextBridge 安全桥接
└── renderer/
    ├── index.html
    ├── styles/
    │   ├── base.css       结构与组件
    │   └── themes.css     三套主题变量
    └── js/
        ├── app.js         主控制器
        ├── audio-engine.js Web Audio + 频谱分析 + 示例曲合成
        ├── visualizer.js  渲染循环与预设调度
        ├── player.js      播放列表与播放控制
        ├── presets-neon.js      4 套（霓虹基础款）
        ├── presets-minimal.js   4 套（极简基础款）
        ├── presets-retro.js     3 套（复古基础款）
        └── presets-extra.js     9 套（第二批：瀑布 / 网格 / 丝带 / 李萨如等，补齐三种风格）

test/
└── core.test.js         核心逻辑断言（node 直接跑，不需要 Electron）
```

---

## 调节手感

不满意视觉反应速度的话，**可视化面板 → 灵敏度**：

- 调高（1.5–2.2）：鼓点触发更频繁，低音更活跃，画面更"跳"
- 调低（0.5–0.8）：更沉稳，只在强拍上有反应

想改视觉本身的话，各预设都是独立对象，`draw(ctx, s, t, dt, vz)` 一个方法，`s` 里拿到的音频参数：

```js
s.bands       // 64 段对数频谱 0..1.3（已平滑，主视觉用这个）
s.bandsRaw    // 未平滑原始值
s.waveform    // 1024 点波形
s.waveSmooth  // 平滑后的波形
s.waveL / s.waveR   // 左/右声道波形（ChannelSplitter 分离，李萨如图用）
s.rmsL / s.rmsR     // 左右声道 RMS
s.balance     // -1(全左) .. +1(全右)
s.bass / s.mid / s.treble
s.level / s.energy / s.flux
s.beat        // 本帧是否击打
s.beatPulse   // 击打包络 1 → 0
s.bpm         // 估算 BPM
```

新增预设只要往 `presets-*.js` 里加一个对象，然后注册进 `app.js` 的 `PRESETS` 数组即可。

## 支持格式

mp3 · flac · wav · m4a · aac · ogg · opus · wma · aif/aiff · ape · webm

## 参与贡献

欢迎 PR，尤其是**新的可视化预设** —— 这部分门槛最低、效果最直观：

1. 在 `src/renderer/js/presets-*.js` 里加一个对象
2. 注册进 `src/renderer/js/app.js` 的 `PRESETS` 数组
3. 跑 `npm run test:all`，自检会自动绘制所有预设并验证不抛错

预设接口只有 `draw(ctx, s, t, dt, vz)` 一个方法，`s` 里的音频参数见上方「调节手感」。
修 bug 的话建议先跑一遍 `npm test` 确认没有回归。

## 已知限制

- **仅支持桌面端**，没有移动版。曾评估过装到丰田车机，但车机是 ARM + 车规 Linux，与 Windows x64 二进制不兼容，且厂商有应用白名单。详见 issue 讨论
- 打包出的 exe 使用 Electron 默认图标（原因见上方打包说明）
- 全局媒体键依赖系统注册，若被其他程序抢占则本次不响应（控制台会打印提示）

## License

MIT —— 随便用，包括商用。
