/**
 * 解析器路由：自动识别网盘类型并分发
 */

const lanzou = require('./lanzou');
const pan123 = require('./pan123');
const direct = require('./direct');

// 已接入真实解析的网盘
const SUPPORTED_TYPES = ['lanzou (蓝奏云)', '123pan (123云盘)', 'direct (通用直链)'];

// 已知但暂未接入真实解析的网盘（保留识别，返回提示）
const UNSUPPORTED_PATTERNS = [
  { regex: /aliyundrive\.(com|net)/i,            name: '阿里云盘' },
  { regex: /pan\.quark\.cn/i,                      name: '夸克网盘' },
  { regex: /pan\.baidu\.com/i,                     name: '百度网盘' },
  { regex: /share\.weiyun\.com/i,                  name: '微云' },
  { regex: /(cloud\.189|189)\.cn/i,               name: '天翼云盘' },
  { regex: /pan\.xunlei\.com/i,                    name: '迅雷网盘' },
  { regex: /drive\.uc\.cn/i,                       name: 'UC网盘' },
  { regex: /(caiyun\.139|and\.10086)\.cn/i,      name: '移动云盘' }
];

function detectType(url) {
  // 蓝奏云（多域名）
  if (/lanzou\w*\.(com|cn|net)/i.test(url)) return 'lanzou';
  // 123云盘
  if (/123pan\.(com|cn)/i.test(url)) return 'pan123';
  // 已知未接入网盘
  for (const p of UNSUPPORTED_PATTERNS) {
    if (p.regex.test(url)) return { type: 'unsupported', name: p.name };
  }
  // 其他 http/https 链接按直链处理
  if (/^https?:\/\//i.test(url)) return 'direct';
  return 'unknown';
}

async function parseUrl(url, code) {
  const detected = detectType(url);

  if (detected && detected.type === 'unsupported') {
    return {
      type: detected.name,
      supported: false,
      message: `${detected.name}暂未接入真实解析，可在后端 parsers/ 目录扩展对应解析器`,
      files: []
    };
  }

  if (detected === 'unknown') {
    return {
      type: 'unknown',
      supported: false,
      message: '无法识别的链接格式，请输入以 http:// 或 https:// 开头的有效链接',
      files: []
    };
  }

  if (detected === 'lanzou') {
    const files = await lanzou.parse(url, code);
    return { type: '蓝奏云', supported: true, files };
  }

  if (detected === 'pan123') {
    const files = await pan123.parse(url, code);
    return { type: '123云盘', supported: true, files };
  }

  if (detected === 'direct') {
    const files = await direct.parse(url);
    return { type: '直链', supported: true, files };
  }

  throw new Error('未处理的解析类型: ' + detected);
}

module.exports = { parseUrl, SUPPORTED_TYPES, detectType };
