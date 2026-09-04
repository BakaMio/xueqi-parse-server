/**
 * 通用直链解析器
 * 对 http/https 文件链接做 HEAD 请求，获取文件名、大小、类型
 */

const COMMON_EXTENSIONS = /\.(mp4|mkv|avi|mov|flv|wmv|webm|m4v|mp3|flac|wav|aac|ogg|m4a|zip|rar|7z|tar|gz|apk|exe|msi|dmg|pkg|deb|rpm|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|csv|json|xml|html|htm|epub|mobi|azw3|iso|img|bin|dat|srt|ass|sub|ttf|otf|woff|woff2|png|jpg|jpeg|gif|bmp|webp|svg|ico)$/i;

function extractFileName(url) {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const last = path.split('/').filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
    return 'download';
  } catch {
    return 'download';
  }
}

function formatSize(bytes) {
  if (!bytes || isNaN(bytes)) return '未知';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

async function parse(url) {
  const name = extractFileName(url);
  const isKnownFile = COMMON_EXTENSIONS.test(url);

  let size = null;
  let contentType = null;

  try {
    // HEAD 请求探测（部分服务器不支持 HEAD，降级为 GET 带 Range）
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let resp;
    try {
      resp = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
    } catch (e) {
      // HEAD 失败，尝试 GET Range: bytes=0-0
      resp = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        signal: ctrl.signal,
        redirect: 'follow'
      });
    }
    clearTimeout(timer);

    if (resp.ok || resp.status === 206) {
      const len = resp.headers.get('content-length');
      if (len) size = parseInt(len, 10);
      contentType = resp.headers.get('content-type') || null;
      // 从 content-disposition 提取文件名
      const cd = resp.headers.get('content-disposition');
      if (cd) {
        const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\s]+)/i);
        if (m) {
          try { name = decodeURIComponent(m[1]); } catch { name = m[1]; }
        }
      }
    }
  } catch (err) {
    // 探测失败不阻断，仍返回链接信息
    console.warn('[direct] HEAD probe failed:', err.message);
  }

  return [{
    name,
    size: size ? formatSize(size) : '未知',
    sizeBytes: size || 0,
    type: isKnownFile ? 'file' : (contentType ? 'file' : 'unknown'),
    url,
    direct: true
  }];
}

module.exports = { parse };
