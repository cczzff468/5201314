/**
 * Vercel serverless 入口 —— QQ 音乐 API（jsososo vendor + 自研扫码登录 + v2 现代接口）。
 * 云端部署：qq 代理链的云端兜底实例（本机 3011 优先，失联自动切这里）。
 */
const app = require('../app');

module.exports = app;
