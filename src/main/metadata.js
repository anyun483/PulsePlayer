'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

/* ============================================================
 * 标签解析：主进程里直接读文件头部字节，解析 ID3v2 / ID3v1 /
 * FLAC Vorbis Comment / MP4 ilst。只取需要的字段，不引入依赖。
 * ============================================================ */

const TEXT_FIELDS = new Set(['TIT2', 'TT2', 'TPE1', 'TP1', 'TALB', 'TAL', 'TRCK', 'TRK', 'TYER', 'TDRC', 'TDRL']);

function decodeText(bytes) {
  if (!bytes || !bytes.length) return '';
  let encoding = bytes[0];
  let body = bytes.subarray(1);
  try {
    switch (encoding) {
      case 0:
        return latin1ToUtf8(body);
      case 1: {
        if (body[0] === 0xff && body[1] === 0xfe) return body.subarray(2).swap16().toString('utf16le');
        if (body[0] === 0xfe && body[1] === 0xff) return body.subarray(2).swap16().toString('utf16le');
        return body.swap16().toString('utf16le');
      }
      case 2:
        return body.swap16().toString('utf16le');
      case 3:
        return body.toString('utf8');
      default:
        return body.toString('utf8');
    }
  } catch {
    return body.toString('latin1');
  }
}

function latin1ToUtf8(buf) {
  let out = '';
  for (let i = 0; i < buf.length; i++) out += String.fromCharCode(buf[i]);
  try {
    return decodeURIComponent(escape(out));
  } catch {
    return out;
  }
}

function cleanTag(s) {
  if (!s) return '';
  return s.replace(/\0+$/g, '').replace(/\s+/g, ' ').trim();
}

function parseSyncSafe(b, off) {
  return ((b[off] & 0x7f) << 21) | ((b[off + 1] & 0x7f) << 14) | ((b[off + 2] & 0x7f) << 7) | (b[off + 3] & 0x7f);
}

function parseId3v2(buf) {
  const tags = {};
  // 必须跳过 10 字节 ID3v2 标签头，否则会把 "ID3\x04" 当成第一个帧 ID
  const version = buf[3];
  const flags = buf[5];
  let pos = 10;

  // 扩展头：v2.3 是 4 字节自身长度，v2.4 是 syncsafe 的长度（不含自身 4 字节）
  if (flags & 0x40 && pos + 4 <= buf.length) {
    let extSize;
    if (version === 4) {
      extSize = parseSyncSafe(buf, pos);
    } else {
      extSize = buf.readUInt32BE(pos);
    }
    pos += (version === 4 ? extSize : extSize) + 4;
  }

  while (pos + 10 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    // 全局填充标记：v2.4 用帧头全 0 表示 padding 到这里结束
    if (id === '\0\0\0\0') break;

    let size;
    let headerLen = 10;
    if (version === 4) {
      size = parseSyncSafe(buf, pos + 4);
    } else {
      size = buf.readUInt32BE(pos + 4);
    }
    if (size <= 0 || pos + headerLen + size > buf.length) break;

    let body = buf.subarray(pos + headerLen, pos + headerLen + size);

    // v2.4 帧级 unsynchronisation：去掉插入的 0x00
    const frameFlags = buf[pos + 8];
    if (version === 4 && frameFlags & 0x02 && body.length > 1) {
      const de = Buffer.allocUnsafe(body.length);
      let di = 0;
      for (let i = 0; i < body.length; i++) {
        de[di++] = body[i];
        if (body[i] === 0xff && body[i + 1] === 0x00) i++;
      }
      body = de.subarray(0, di);
    }

    if (TEXT_FIELDS.has(id)) {
      const val = cleanTag(decodeText(body));
      if (val) {
        if (id === 'TIT2' || id === 'TT2') tags.title = val;
        else if (id === 'TPE1' || id === 'TP1') tags.artist = val;
        else if (id === 'TALB' || id === 'TAL') tags.album = val;
        else if (id === 'TRCK' || id === 'TRK') tags.track = val.split('/')[0];
        else if (id === 'TYER' || id === 'TDRC' || id === 'TDRL') tags.year = val.slice(0, 4);
      }
    }
    pos += headerLen + size;
  }
  return tags;
}

function parseId3v1(buf) {
  if (buf.length < 128) return {};
  const tail = buf.subarray(buf.length - 128);
  if (tail.toString('latin1', 0, 3) !== 'TAG') return {};
  const s = (a, b) => cleanTag(tail.toString('latin1', a, b).replace(/\0/g, ''));
  const tags = {};
  const title = s(3, 33);
  const artist = s(33, 63);
  const album = s(63, 93);
  if (title) tags.title = title;
  if (artist) tags.artist = artist;
  if (album) tags.album = album;
  return tags;
}

function parseFlac(buf) {
  const tags = {};
  if (buf.toString('latin1', 0, 4) !== 'fLaC') return tags;
  let pos = 4;
  while (pos + 4 <= buf.length) {
    const last = (buf[pos] & 0x80) !== 0;
    const type = buf[pos] & 0x7f;
    const len = buf.readUIntBE(pos + 1, 3);
    const body = buf.subarray(pos + 4, pos + 4 + len);
    if (type === 0) {
      // VORBIS_COMMENT
      try {
        let p = 0;
        const vlen = body.readUInt32LE(p);
        p += 4 + vlen;
        const count = body.readUInt32LE(p);
        p += 4;
        for (let i = 0; i < count && p + 4 <= body.length; i++) {
          const clen = body.readUInt32LE(p);
          p += 4;
          const entry = body.toString('utf8', p, p + clen);
          p += clen;
          const eq = entry.indexOf('=');
          if (eq < 0) continue;
          const k = entry.slice(0, eq).toUpperCase();
          const v = cleanTag(entry.slice(eq + 1));
          if (!v) continue;
          if (k === 'TITLE') tags.title = v;
          else if (k === 'ARTIST') tags.artist = v;
          else if (k === 'ALBUM') tags.album = v;
          else if (k === 'TRACKNUMBER') tags.track = v;
          else if (k === 'DATE') tags.year = v.slice(0, 4);
        }
      } catch { /* 忽略畸形块 */ }
    } else if (type === 4) {
      // PICTURE
      try {
        let p = 4;
        const mimeLen = body.readUInt32BE(p);
        p += 4 + mimeLen + 1;
        const descLen = body.readUInt32BE(p);
        p += 4 + descLen + 16;
        if (p < body.length) {
          tags.picture = body.subarray(p).toString('base64');
        }
      } catch { /* 忽略 */ }
    }
    pos += 4 + len;
    if (last) break;
  }
  return tags;
}

function parseMp4(buf) {
  const tags = {};
  const ilstIndex = buf.indexOf('ilst', 0, 'latin1');
  if (ilstIndex < 0) return tags;
  const stop = Math.min(buf.length, ilstIndex + 8192);
  const findBox = (name) => {
    const i = buf.indexOf(name, 0, 'latin1');
    return i >= 0 && i < stop ? i : -1;
  };
  const readData = (box) => {
    try {
      const dataIdx = buf.indexOf('data', box, 'latin1');
      if (dataIdx < 0 || dataIdx > box + 4096) return '';
      const size = buf.readUInt32BE(dataIdx + 4);
      const payload = buf.subarray(dataIdx + 8, dataIdx + 8 + Math.max(0, size - 16));
      return cleanTag(payload.toString('utf8'));
    } catch {
      return '';
    }
  };
  const title = findBox('\xa9nam');
  if (title >= 0) tags.title = readData(title);
  const artist = findBox('\xa9ART');
  if (artist >= 0) tags.artist = readData(artist);
  const album = findBox('\xa9alb');
  if (album >= 0) tags.album = readData(album);
  const covr = findBox('covr');
  if (covr >= 0) {
    try {
      const dataIdx = buf.indexOf('data', covr, 'latin1');
      const size = buf.readUInt32BE(dataIdx + 4);
      tags.picture = buf.subarray(dataIdx + 8, dataIdx + 8 + Math.max(0, size - 16)).toString('base64');
    } catch { /* 忽略 */ }
  }
  return tags;
}

/** 从文件名兜底解析 "歌手 - 歌名" */
function fromFilename(name) {
  const base = path.basename(name, path.extname(name)).trim();
  const m = /^(.+?)\s*[-–—]\s*(.+)$/.exec(base);
  if (m) return { artist: cleanTag(m[1]), title: cleanTag(m[2]) };
  return { title: base };
}

/** 读取音频文件标签。永不抛错，任何失败都退回文件名解析。 */
async function readTags(absPath) {
  let tags = {};
  const ext = path.extname(absPath).toLowerCase();
  try {
    const fh = await fsp.open(absPath, 'r');
    try {
      // 注意：FileHandle.stat() 返回 Promise，必须 await。
      // 写成 fh.stat.size 会得到 undefined → Buffer.alloc(undefined) 抛错 → 被下方 catch 吞掉，
      // 表现为所有标签都读不出来。
      const st = await fh.stat();
      const size = Math.min(1024 * 512, st.size);
      const buf = Buffer.alloc(size);
      await fh.read(buf, 0, size, 0);
      if (ext === '.flac') {
        tags = parseFlac(buf);
      } else if (ext === '.m4a' || ext === '.mp4' || ext === '.m4b' || ext === '.aac') {
        tags = parseMp4(buf);
      } else if (ext === '.wav') {
        tags = parseId3v1(buf);
      }
      if (!tags.title && !tags.artist) {
        const head = buf.toString('latin1', 0, 3);
        if (head === 'ID3') tags = { ...parseId3v2(buf), ...tags };
        else tags = { ...parseId3v1(buf), ...tags };
      }
    } finally {
      await fh.close();
    }
  } catch { /* 读不到就只用文件名 */ }

  const fallback = fromFilename(absPath);
  return {
    title: tags.title || fallback.title || path.basename(absPath),
    artist: tags.artist || fallback.artist || '未知歌手',
    album: tags.album || '',
    year: tags.year || '',
    track: tags.track || '',
    picture: tags.picture || null,
  };
}

module.exports = { readTags };