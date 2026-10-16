'use strict';

const { protocol } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const SCHEME = 'pulse-media';

/** 在 app ready 之前调用：把自定义协议注册为 standard/secure，媒体元素才能像正常网页源一样使用 */
function registerSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ]);
}

const MIME = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.wma': 'audio/x-ms-wma',
  '.ape': 'audio/x-monkeys-audio',
  '.m4b': 'audio/mp4',
};

function mimeFor(p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

/** 本地绝对路径 → 播放器可用的 URL（base64url 编码，避免中文/特殊字符/斜杠破坏 URL 结构） */
function toMediaUrl(absPath) {
  return `${SCHEME}://local/${Buffer.from(absPath, 'utf8').toString('base64url')}`;
}

/** 播放器回传 base64url → 本地绝对路径 */
function fromMediaUrl(raw) {
  try {
    const u = new URL(raw);
    const b64 = u.pathname.replace(/^\/+/, '');
    const p = Buffer.from(b64, 'base64url').toString('utf8');
    return p || null;
  } catch {
    return null;
  }
}

/**
 * 注册流式文件协议。
 * 手动处理 Range 请求是必须的：Chromium 的媒体元素靠 206 + Content-Range 做 seek，
 * 少了这段，mp3/flac 拖进度条会直接跳回开头或报错。
 */
function registerMediaProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const filePath = fromMediaUrl(request.url);
    if (!filePath) return new Response('bad request', { status: 400 });

    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return new Response('not found', { status: 404 });
    }
    if (!stat.isFile()) return new Response('not a file', { status: 400 });

    const total = stat.size;
    const type = mimeFor(filePath);
    const rangeHeader = request.headers.get('Range');

    let start = 0;
    let end = total - 1;
    let status = 200;

    if (rangeHeader) {
      const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      if (m) {
        if (m[1] !== '') {
          start = parseInt(m[1], 10);
        }
        if (m[2] !== '') {
          end = parseInt(m[2], 10);
        }
        if (m[1] === '' && m[2] !== '') {
          // bytes=-N → 最后 N 字节
          start = Math.max(0, total - parseInt(m[2], 10));
          end = total - 1;
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${total}` },
          });
        }
        end = Math.min(end, total - 1);
        status = 206;
      }
    }

    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };

    if (status === 206) {
      headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
      headers['Content-Length'] = String(end - start + 1);
    } else {
      headers['Content-Length'] = String(total);
    }

    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(stream, { status, headers });
  });
}

module.exports = { registerSchemePrivileges, registerMediaProtocol, toMediaUrl, fromMediaUrl, mimeFor, MIME, SCHEME };