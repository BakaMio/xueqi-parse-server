/**
 * 蓝奏云解析器（适配 2025+ 新版页面结构）
 *
 * 流程:
 *   1. GET 分享页 -> 提取 文件名/大小/iframe src/fid
 *   2. 若需密码 -> POST 密码获取 cookie -> 重新 GET 分享页
 *   3. GET iframe 页 -> 提取 wp_sign/ajaxdata
 *   4. POST /ajaxfile.php?file=fid -> 获取 {dom, url}
 *   5. 直链 = dom + "/file/" + url
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE = 'https://www.lanzoux.com';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 从蓝奏云链接提取文件 ID */
function extractId(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length > 0 && parts[0] !== 'fn' && parts[0] !== 's') return parts[0];
    // 文件夹分享 /s/xxx 形式暂不支持
    return null;
  } catch {
    const m = url.match(/([a-zA-Z0-9]{5,})$/);
    return m ? m[1] : null;
  }
}

/** 合并 cookie */
function mergeCookies(existing, setCookieHeaders) {
  const map = {};
  if (existing) {
    existing.split(';').forEach(c => {
      const [k, ...v] = c.trim().split('=');
      if (k) map[k] = v.join('=');
    });
  }
  if (setCookieHeaders) {
    setCookieHeaders.forEach(h => {
      const part = h.split(';')[0];
      const [k, ...v] = part.trim().split('=');
      if (k) map[k] = v.join('=');
    });
  }
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
}

/** 通用 GET，返回 {html, cookies, status} */
async function getPage(url, cookies, referer) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' };
  if (cookies) headers['Cookie'] = cookies;
  if (referer) headers['Referer'] = referer;
  const resp = await fetch(url, { headers, redirect: 'follow' });
  const setCookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
  const html = await resp.text();
  return { html, cookies: mergeCookies(cookies, setCookies), status: resp.status, finalUrl: resp.url };
}

/** 检测页面是否需要密码 */
function needPassword(html) {
  return /(name=["']pwd["']|id=["']pwd["']|请输入密码|提取码)/i.test(html);
}

/** 提交密码 */
async function submitPassword(pageUrl, pwd, cookies) {
  const body = new URLSearchParams({ pwd });
  const headers = {
    'User-Agent': UA,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer': pageUrl,
    'Accept-Language': 'zh-CN,zh;q=0.9'
  };
  if (cookies) headers['Cookie'] = cookies;
  const resp = await fetch(pageUrl, { method: 'POST', headers, body, redirect: 'follow' });
  const setCookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
  return mergeCookies(cookies, setCookies);
}

/** 从分享页提取关键信息 */
function extractShareInfo(html) {
  const info = {};
  // 文件名
  const mName = html.match(/font-size:\s*30px[^>]*>([^<]+)</);
  if (mName) info.name = mName[1].trim();
  // 文件大小
  const mSize = html.match(/文件大小：<\/span>([^<]+)/);
  if (mSize) info.size = mSize[1].trim();
  // iframe src
  const mIframe = html.match(/<iframe[^>]+src="(\/fn\?[^"]+)"/);
  if (mIframe) info.iframeSrc = mIframe[1];
  // fid
  const mFid = html.match(/var\s+fid\s*=\s*(\d+)/);
  if (mFid) info.fid = mFid[1];
  return info;
}

/** 从 iframe 页提取签名数据 */
function extractIframeSign(html) {
  const sign = {};
  const mWp = html.match(/var\s+wp_sign\s*=\s*'([^']+)'/);
  if (mWp) sign.wp_sign = mWp[1];
  const mAjax = html.match(/var\s+ajaxdata\s*=\s*'([^']+)'/);
  if (mAjax) sign.ajaxdata = mAjax[1];
  return sign;
}

/** 请求下载直链（新版接口 /ajaxfile.php） */
async function requestDirectLink(fid, sign, cookies, referer) {
  const body = new URLSearchParams();
  body.append('action', 'downprocess');
  body.append('websignkey', sign.ajaxdata || '');
  body.append('signs', sign.ajaxdata || '');
  body.append('sign', sign.wp_sign || '');
  body.append('websign', '');
  body.append('kd', '1');
  body.append('ves', '1');

  const headers = {
    'User-Agent': UA,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer': referer,
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'X-Requested-With': 'XMLHttpRequest'
  };
  if (cookies) headers['Cookie'] = cookies;

  const url = `${BASE}/ajaxfile.php?file=${fid}`;
  const resp = await fetch(url, { method: 'POST', headers, body });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('蓝奏云下载接口返回非 JSON: ' + text.substring(0, 200));
  }
}

async function parse(url, code) {
  const id = extractId(url);
  if (!id) throw new Error('无法从链接中提取蓝奏云文件 ID（文件夹分享暂不支持）');

  const pageUrl = `${BASE}/${id}`;

  // 1. GET 分享页
  let { html, cookies } = await getPage(pageUrl, null, null);

  // 2. 密码处理
  if (needPassword(html)) {
    if (!code) throw new Error('该蓝奏云链接需要提取码，请在解析时传入 code 参数');
    cookies = await submitPassword(pageUrl, code, cookies);
    await sleep(300);
    const re = await getPage(pageUrl, cookies, pageUrl);
    html = re.html;
    cookies = re.cookies;
    if (needPassword(html)) throw new Error('提取码错误或已失效');
  }

  // 3. 提取分享页信息
  const shareInfo = extractShareInfo(html);
  if (!shareInfo.iframeSrc) throw new Error('无法从分享页提取下载 iframe，页面结构可能已变更或文件已失效');
  if (!shareInfo.fid) throw new Error('无法从分享页提取文件 ID (fid)');

  const iframeUrl = BASE + shareInfo.iframeSrc;

  // 4. GET iframe 页
  const iframeResult = await getPage(iframeUrl, cookies, pageUrl);
  cookies = iframeResult.cookies;

  const sign = extractIframeSign(iframeResult.html);
  if (!sign.wp_sign || !sign.ajaxdata) {
    throw new Error('无法从 iframe 页提取下载签名数据 (wp_sign/ajaxdata)');
  }

  // 5. POST 下载接口
  const result = await requestDirectLink(shareInfo.fid, sign, cookies, iframeUrl);

  if (result.zt != 1 || !result.dom || !result.url) {
    throw new Error('蓝奏云返回下载失败: ' + (result.inf || JSON.stringify(result)));
  }

  const directUrl = result.dom + '/file/' + result.url;

  return [{
    name: result.name || shareInfo.name || `蓝奏云文件_${id}`,
    size: result.size || shareInfo.size || '未知',
    type: 'file',
    url: directUrl,
    direct: true,
    referer: pageUrl,
    source: '蓝奏云'
  }];
}

module.exports = { parse, extractId };
