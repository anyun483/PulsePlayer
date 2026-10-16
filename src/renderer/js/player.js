/**
 * 播放列表与播放控制
 */

export class Player extends EventTarget {
  constructor(engine, audioEl) {
    super();
    this.engine = engine;
    this.el = audioEl;

    this.tracks = [];
    this.index = -1;
    this.order = [];          // 随机播放的实际顺序
    this.shuffle = false;
    this.repeat = 'all';      // 'off' | 'all' | 'one'
    this.volume = 0.85;
    this.muted = false;
    this._mediaUrlCache = new Map();

    this._bindEvents();
  }

  _bindEvents() {
    const el = this.el;

    el.addEventListener('timeupdate', () => {
      this.dispatchEvent(new CustomEvent('progress', {
        detail: { current: el.currentTime, duration: el.duration || 0 },
      }));
    });

    el.addEventListener('loadedmetadata', () => {
      this.dispatchEvent(new CustomEvent('meta', { detail: { duration: el.duration || 0 } }));
    });

    el.addEventListener('play', () => this.dispatchEvent(new CustomEvent('playstate', { detail: true })));
    el.addEventListener('pause', () => this.dispatchEvent(new CustomEvent('playstate', { detail: false })));
    el.addEventListener('waiting', () => this.dispatchEvent(new CustomEvent('buffering', { detail: true })));
    el.addEventListener('playing', () => this.dispatchEvent(new CustomEvent('buffering', { detail: false })));

    el.addEventListener('ended', () => {
      if (this.repeat === 'one') {
        el.currentTime = 0;
        el.play();
        return;
      }
      this.next(true);
    });

    el.addEventListener('error', () => {
      // 单曲解码失败：跳过而不是卡死
      if (this.tracks.length > 1) {
        this.dispatchEvent(new CustomEvent('trackerror', {
          detail: this.tracks[this.index] || null,
        }));
        setTimeout(() => this.next(true), 400);
      } else {
        this.dispatchEvent(new CustomEvent('fatal', { detail: '音频文件无法解码' }));
      }
    });
  }

  get current() {
    return this.tracks[this.index] || null;
  }

  async setTracks(list, startIndex = 0) {
    const curPath = this.current?.path;
    const map = new Map(this.tracks.map((t) => [t.path, t]));
    for (const t of list) {
      if (!map.has(t.path)) {
        map.set(t.path, t);
        this.tracks.push(t);
      }
    }
    // 保持当前曲目不变
    if (curPath) {
      const i = this.tracks.findIndex((t) => t.path === curPath);
      this.index = i >= 0 ? i : startIndex;
    } else {
      this.index = startIndex;
    }
    this._rebuildOrder();
    this.dispatchEvent(new CustomEvent('listchange', { detail: this.tracks }));
    if (this.index < 0 && this.tracks.length) this.index = 0;
  }

  _rebuildOrder() {
    this.order = this.tracks.map((_, i) => i);
    if (this.shuffle) {
      for (let i = this.order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
      }
    }
  }

  async _urlFor(track) {
    if (this._mediaUrlCache.has(track.path)) return this._mediaUrlCache.get(track.path);
    // 内置示例曲等内存对象没有磁盘路径，直接用 blob URL
    if (track.blobUrl) {
      this._mediaUrlCache.set(track.path, track.blobUrl);
      return track.blobUrl;
    }
    const url = await window.pulse.toMediaUrl(track.path);
    this._mediaUrlCache.set(track.path, url);
    return url;
  }

  async load(index, autoplay = true) {
    if (index < 0 || index >= this.tracks.length) return;
    this.index = index;
    const track = this.tracks[index];
    const url = await this._urlFor(track);
    this.el.src = url;
    this.el.load();
    this.dispatchEvent(new CustomEvent('trackchange', { detail: { track, index } }));
    if (autoplay) {
      await this.engine.resume();
      try {
        await this.el.play();
      } catch {
        this.dispatchEvent(new CustomEvent('fatal', { detail: '浏览器阻止了自动播放，请再点一次播放' }));
      }
    }
  }

  async play() {
    await this.engine.resume();
    if (!this.el.src && this.tracks.length) {
      return this.load(this.index < 0 ? 0 : this.index, true);
    }
    try {
      return await this.el.play();
    } catch (e) {
      this.dispatchEvent(new CustomEvent('fatal', { detail: e.message }));
    }
  }

  pause() {
    this.el.pause();
  }

  toggle() {
    if (this.el.paused) this.play();
    else this.pause();
  }

  stop() {
    this.el.pause();
    this.el.currentTime = 0;
  }

  next(auto = false) {
    if (!this.tracks.length) return;
    if (this.repeat === 'off' && auto && this.index === this.tracks.length - 1 && !this.shuffle) {
      this.stop();
      return;
    }
    const pos = this.shuffle ? this.order.indexOf(this.index) : this.index;
    const nxt = (pos + 1) % this.tracks.length;
    const target = this.shuffle ? this.order[nxt] : nxt;
    this.load(target, true);
  }

  prev() {
    if (!this.tracks.length) return;
    // 播放超过 3 秒时，上一首先回到本曲开头（和主流播放器一致）
    if (this.el.currentTime > 3) {
      this.el.currentTime = 0;
      return;
    }
    const pos = this.shuffle ? this.order.indexOf(this.index) : this.index;
    const prv = (pos - 1 + this.tracks.length) % this.tracks.length;
    const target = this.shuffle ? this.order[prv] : prv;
    this.load(target, true);
  }

  jump(index) {
    if (index < 0 || index >= this.tracks.length) return;
    this.load(index, true);
  }

  seek(ratio) {
    const d = this.el.duration;
    if (!d || !Number.isFinite(d)) return;
    this.el.currentTime = Math.max(0, Math.min(d, ratio * d));
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.el.volume = this.muted ? 0 : this.volume;
    this.dispatchEvent(new CustomEvent('volume', {
      detail: { volume: this.volume, muted: this.muted },
    }));
  }

  setMuted(m) {
    this.muted = m;
    this.el.volume = m ? 0 : this.volume;
    this.dispatchEvent(new CustomEvent('volume', {
      detail: { volume: this.volume, muted: this.muted },
    }));
  }

  setShuffle(on) {
    this.shuffle = on;
    const cur = this.index;
    this._rebuildOrder();
    // 保证当前曲目仍能在 order 中找到
    if (on && !this.order.includes(cur)) {
      this.order.unshift(cur);
    }
    this.dispatchEvent(new CustomEvent('modechange', {
      detail: { shuffle: this.shuffle, repeat: this.repeat },
    }));
  }

  setRepeat(mode) {
    this.repeat = mode;
    this.dispatchEvent(new CustomEvent('modechange', {
      detail: { shuffle: this.shuffle, repeat: this.repeat },
    }));
  }

  removeAt(index) {
    if (index < 0 || index >= this.tracks.length) return;
    const wasCurrent = index === this.index;
    this.tracks.splice(index, 1);
    if (wasCurrent) {
      if (this.tracks.length === 0) {
        this.el.removeAttribute('src');
        this.el.load();
        this.index = -1;
      } else {
        this.index = Math.min(index, this.tracks.length - 1);
        this.load(this.index, true);
      }
    } else if (index < this.index) {
      this.index--;
    }
    this._rebuildOrder();
    this.dispatchEvent(new CustomEvent('listchange', { detail: this.tracks }));
  }

  clear() {
    this.tracks = [];
    this.index = -1;
    this.el.removeAttribute('src');
    this.el.load();
    this._rebuildOrder();
    this.dispatchEvent(new CustomEvent('listchange', { detail: this.tracks }));
  }
}