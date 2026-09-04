/**
 * 123云盘解析器
 * 支持分享链接解析，获取文件列表和下载直链
 *
 * 分享链接格式:
 *   https://www.123pan.com/s/{shareKey}
 *   https://www.123pan.com/s/{shareKey}.html
 *   带提取码: 需额外传入 code 参数
 *
 * 原理:
 *   shareKey 格式为 {base62(UID)}-{base62(随机数)}，
 *   解码第一部分得到 UID，构造 API 域名 https://{UID}.share.123pan.cn
 */

const https = require('https');
const http = require('http');

// 123云盘自定义 base62 字符集
const CODE62 = 'Tvd3hHA9QEkom14xpfaBJIMwgFYGPXn2sWCNORDr80KuUSl7bZcetizL5q6yVj';

/**
 * base62 解码（123云盘自定义字符集）
 */
function decodeBase62(value) {
  let result = 0;
  for (let i = 0; i < value.length; i++) {
    const digit = CODE62.indexOf(value.charAt(i));
    if (digit < 0) return null;
    result += digit * Math.pow(62, i);
  }
  if (result <= 0 || result > 9007199254740991) return null;
  return result;
}

/**
 * 从分享链接中提取 shareKey
 */
function extractShareKey(url) {
  const match = url.match(/123pan\.(com|cn)\/s\/([^/?#]+)/i);
  if (match) {
    let key = match[2];
    if (key.endsWith('.html')) {
      key = key.slice(0, -5);
    }
    return key;
  }
  return null;
}

/**
 * 从 shareKey 解析 UID 并构造 API 域名
 */
function getApiDomain(shareKey) {
  const keyParts = shareKey.split('-');
  if (keyParts.length !== 2) return null;
  const uid = decodeBase62(keyParts[0]);
  if (uid === null) return null;
  return `https://${uid}.share.123pan.cn`;
}

/**
 * 发起 HTTP/HTTPS 请求
 */
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      }, options.headers || {}),
      timeout: options.timeout || 30000,
    };

    const req = lib.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * 解析 123云盘分享链接
 * @param {string} url - 分享链接
 * @param {string} [code] - 提取码（可选）
 * @returns {Promise<Array>} 文件列表
 */
async function parse(url, code) {
  const shareKey = extractShareKey(url);
  if (!shareKey) {
    throw new Error('无法识别 123云盘分享链接格式');
  }

  const apiDomain = getApiDomain(shareKey);
  if (!apiDomain) {
    throw new Error('无法解析 123云盘分享链接中的 UID');
  }

  const referer = `${apiDomain}/123pan/${shareKey}?notoken=1`;

  // 第一步：获取文件列表
  const listUrl = `${apiDomain}/gsb/s/share-list?OrderId=&SharePwd=${encodeURIComponent(code || '')}&shareKey=${encodeURIComponent(shareKey)}`;
  const listRes = await request(listUrl, {
    headers: { 'Referer': referer },
  });

  let listData;
  try {
    listData = JSON.parse(listRes.body);
  } catch (e) {
    throw new Error('解析文件列表失败: ' + listRes.body.substring(0, 200));
  }

  if (listData.code !== 0) {
    throw new Error(listData.message || '获取文件列表失败 (code=' + listData.code + ')');
  }

  const infoList = listData.data?.InfoList || [];
  if (infoList.length === 0) {
    return [];
  }

  // 第二步：对每个文件获取下载直链
  const files = [];
  for (const item of infoList) {
    const isFolder = item.Type === 1;
    const file = {
      name: item.FileName,
      size: item.Size || 0,
      type: isFolder ? 'folder' : 'file',
      fileId: item.FileId,
    };

    if (!isFolder) {
      try {
        const downloadRes = await request(`${apiDomain}/api/share/download/info`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Referer': referer,
          },
          body: JSON.stringify({
            ShareKey: shareKey,
            FileID: item.FileId,
            S3keyFlag: item.S3KeyFlag,
            Size: item.Size,
            Etag: item.Etag || '',
          }),
        });

        let downloadData;
        try {
          downloadData = JSON.parse(downloadRes.body);
        } catch (e) {
          file.url = null;
          file.error = '解析下载链接失败';
          files.push(file);
          continue;
        }

        if (downloadData.code === 0 && downloadData.data) {
          const prefix = downloadData.data.dispatchList?.[0]?.prefix || '';
          const downloadPath = downloadData.data.downloadPath || '';
          file.url = prefix + downloadPath;
        } else {
          file.url = null;
          file.error = downloadData.message || '获取下载链接失败 (code=' + downloadData.code + ')';
        }
      } catch (e) {
        file.url = null;
        file.error = e.message;
      }
    }

    files.push(file);
  }

  return files;
}

module.exports = { parse, extractShareKey, decodeBase62, getApiDomain };
