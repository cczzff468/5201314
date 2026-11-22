#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const tmpPath = require('os').tmpdir()

async function start() {
  // 检测是否存在 anonymous_token 文件,没有则生成
  if (!fs.existsSync(path.resolve(tmpPath, 'anonymous_token'))) {
    fs.writeFileSync(path.resolve(tmpPath, 'anonymous_token'), '', 'utf-8')
  }
  // 启动时更新anonymous_token
  const generateConfig = require('./generateConfig')
  await generateConfig()
  require('./server').serveNcmApi({
    checkVersion: true,
    // 固定 3010：与 Next 代理链（/api/music/ncm → localhost:3010）约定一致。
    // 必须硬编码——沙箱里若经 `bun run dev`（nodemon）裸启动，serveNcmApi 会退回
    // process.env.PORT||3000，抢先占住 3000 导致 Next 主服务 EADDRINUSE，
    // 预览页就会渲染成「网易云音乐API」落地页。
    port: 3010,
  })
}
start()
