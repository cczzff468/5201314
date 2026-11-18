const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const fs = require('fs');
const DataStatistics = require('./util/dataStatistics');
const jsonFile = require('jsonfile');
const Feedback = require('./util/feedback');
const Cache = require('./util/cache');
const config = require('./bin/config');
const Request = require('./util/request');
const GlobalCookie = require('./util/globalCookie');

const app = express();
const dataHandle = new DataStatistics();
const feedback = new Feedback();
const cache = new Cache();
const globalCookie = GlobalCookie();


// 每10分钟存一下数据
config.useDataStatistics && setInterval(() => dataHandle.saveInfo(), 60000 * 10);

// 视图引擎已移除（jade 旧依赖树会破坏 Vercel @vercel/node 的文件追踪：
// transformers/uglify-js 嵌套包缺文件导致构建失败）；错误页改纯 JSON。

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({extended: false}));
app.use(cookieParser());

// CORS：允许任意来源跨域访问（前端经 Caddy 网关 XTransformPort=3011 转发）
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// 无状态鉴权：?cookie=uin%3Dxx%3B%20qm_keyst%3Dxx 非空时注入 req.cookies，
// 让所有依赖 req.cookies.uin / cookie-parser 的路由（配合 ownCookie=1）免 Cookie 头鉴权
app.use((req, res, next) => {
  const queryCookie = typeof req.query.cookie === 'string' ? req.query.cookie : '';
  if (queryCookie) {
    queryCookie.split(';').forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx <= 0) return;
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (key) req.cookies[key] = value;
    });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

config.useDataStatistics && app.use((req, res, next) => dataHandle.record(req, res, next));

const corsMap = {
  '/user/setCookie': true,
}
fs.readdirSync(path.join(__dirname, 'routes')).forEach(file => {
  const filename = file.replace(/\.js$/, '');
  const RouterMap = require(`./routes/${filename}`);
  Object.keys(RouterMap).forEach((path) => {
    app.use(`/${filename}${path}`, (req, res, next) => {
      const router = express.Router();
      const request = Request(req, res, {globalCookie})
      req.query = {
        ...req.query,
        ...req.body,
        ownCookie: 1,
      };
      // qq 登录
      let uin = (req.cookies.uin || '');
      // login_type 2 微信登录
      if (Number(req.cookies.login_type) === 2) {
        uin = req.cookies.wxuin;
      }
      req.cookies.uin = uin.replace(/\D/g, '');
      const func = RouterMap[path];

      const args = {request, dataStatistics: dataHandle, feedback, cache, globalCookie};
      // v1.9.22 崩溃根治：async 路由 handler 抛错（如 vkey.js 曾因 request 未解构 ReferenceError）
      // 会变成 unhandledRejection 直接杀死整个进程（Express 4 不捕获 async 异常）。
      // 统一包 Promise.catch → 返回 500 JSON，单接口故障不再拖垮全服务。
      const safeCall = (fn) => (rq, rs) => {
        Promise.resolve(fn({req: rq, res: rs, ...args})).catch((e) => {
          console.error(`[route-error] /${filename}${path}:`, e && e.message);
          if (!rs.headersSent) {
            rs.status(500).json({result: 500, errMsg: (e && e.message) || '服务异常'});
          }
        });
      };
      router.post('/', safeCall(func));
      router.get('/', safeCall(func));
      if (corsMap[`/${filename}${path}`]) {
        router.options('/', (req, res) => {
          res.set('Access-Control-Allow-Origin', 'https://y.qq.com');
          res.set('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
          res.set('Access-Control-Allow-Headers', 'Content-Type');
          res.set('Access-Control-Allow-Credentials', 'true');
          res.sendStatus(200);
        })
      }
      router(req, res, next);
    })
  });
});

app.use('/', (req, res, next) => {
  const router = express.Router();
  router.get('/', (req, res) => require('./routes/index')['/'](req, res))
  router(req, res, next);
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // 纯 JSON 错误响应（原 jade 错误页已随 view engine 一起移除）
  res.status(err.status || 500);
  res.json({ result: err.status || 500, errMsg: err.message || '服务异常' });
});

module.exports = app;
