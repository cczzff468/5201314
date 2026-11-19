/**
 * Vercel serverless 入口 —— 把酷狗 API 的 Express 应用适配为 Serverless Function。
 * 云端部署：qq/kugou 代理链的云端兜底实例（本机 3012 优先，失联自动切这里）。
 */
const { consturctServer } = require('../server');

let appPromise = null;

module.exports = async (req, res) => {
  if (!appPromise) appPromise = consturctServer();
  const app = await appPromise;
  return app(req, res);
};
