/**
 * xueqi助手 网盘解析后端
 * 提供 /api/parse 接口，自动识别网盘类型并解析文件列表
 *
 * 启动: node server.js
 * 端口: 默认 3000，可用环境变量 PORT 修改
 */

const express = require('express');
const cors = require('cors');
const { parseUrl, SUPPORTED_TYPES } = require('./parsers');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'xueqi-parse-server',
    version: '1.0.0',
    supported: SUPPORTED_TYPES,
    time: new Date().toISOString()
  });
});

// 解析接口
app.post('/api/parse', async (req, res) => {
  const { url, code } = req.body || {};

  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({
      success: false,
      error: '缺少 url 参数',
      message: '请传入需要解析的分享链接'
    });
  }

  const rawUrl = url.trim();

  try {
    const result = await parseUrl(rawUrl, code);
    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[parse error]', err.message);
    return res.status(502).json({
      success: false,
      error: err.message || '解析失败',
      message: '解析过程中出现错误，请检查链接是否有效或稍后重试'
    });
  }
});

// 兜底 404
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not Found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  xueqi助手 解析后端已启动');
  console.log('  本地访问:  http://127.0.0.1:' + PORT);
  console.log('  局域网访问: http://<本机IP>:' + PORT);
  console.log('  健康检查:  http://127.0.0.1:' + PORT + '/api/health');
  console.log('========================================');
});
