# netease-api（网易云 API 服务，端口 3010）

## 代码来源

本目录是 **[NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)** v4.41.1 的 **vendor（ vendored copy，去除 .git 与开发期文件）**。

- 上游是 `Binaryify/NeteaseCloudMusicApi`（原版 30k+ star，2024 年归档）的社区复活项目，
  同一条版本线（4.32.0 → 4.41.1），**200+ 接口向下完全兼容**，持续维护中（MIT）。
- 用户 GitHub 已 fork：**https://github.com/cczzff468/api-enhanced**（上游更新后可同步）。
- 本仓库（5200）vendor 它是为了沙箱内自包含部署与版本化。

vendor 时保留：`module/ util/ plugins/ data/ public/ server.js main.js generateConfig.js`
`app.js index.mjs interface.d.ts package.json LICENSE README.MD Dockerfile vercel.json` 等。
去除：`.git .github test/ examples/ module_example/ scripts/ pnpm-* 各类 lint 配置`。

## 与上游的差异（仅 1 个文件）

- **`index.js`**：本项目的启动包装器（上游同名文件被覆盖），职责：
  1. 拉起 `next-keeper.sh`（沙箱 Next dev server 守护链，见 instrumentation.ts 注释）
  2. 沿用上游 app.js 初始化（anonymous_token → generateConfig）
  3. `serveNcmApi({ port: 3010, checkVersion: false })` 固定端口启动
  - 端口可用 `NCM_PORT` 环境变量覆盖（仅测试用，如 3999 试运行）。

## 运行要求

- **必须 Node 运行**（沙箱 Node 24）：bun 的 crypto 与 eapi 加密（aes-128-ecb）不兼容，
  会导致 `/login/qr/key` 等接口被网易返回「参数错误」。
- 依赖安装：`npm i --omit=dev --no-audit --no-fund --ignore-scripts`
  （`--ignore-scripts` 跳过 husky prepare，非 git 目录必需）。
- `node_modules/NeteaseCloudMusicApi/package.json` 是一个 **stub**：防旧 keeper 脚本
  内存分支误触发 bun install（历史兼容，新 ncm-keeper.sh 已改为检查 express）。

## 守护链（沙箱内）

```
Next server（启动树）→ instrumentation.register()
  → ncm-keeper.sh（守护 3010，PID 单实例）
    → node index.js（本服务）
      → next-keeper.sh（守护 3000，PID 单实例）
```

日志：`/tmp/ncm-api.log`。

## 接入通道

1. 前端 → Caddy(:81)：`/login/qr/key?XTransformPort=3010`（原路径转发）
2. 前端 → Next 同源代理：`/api/music/ncm/<path>` → `localhost:3010/<path>`
   （见 `src/app/api/music/ncm/[...path]/route.ts`）
3. 前端自定义模式：音乐 App 设置页填外部 baseUrl + apiKey 直连。

## 启动期非致命告警说明

启动日志中可能出现（均被 generateConfig 内部 try/catch 捕获，不影响核心接口）：
- `Error: xeapi public key is missing` —— 增强版 xeapi 加密通道的公钥获取失败，
  仅影响极少数增强接口，核心 200+ 接口走经典 weapi/eapi 不受影响。
- `Z_BUF_ERROR / unexpected end of file` —— neapi key 注册响应解压失败的同类告警。

## 更新上游版本

```bash
git clone --depth 1 https://github.com/cczzff468/api-enhanced.git /tmp/api-enhanced
# 覆盖本目录运行时文件（保留 index.js / ncm-keeper.sh / next-keeper.sh / 本文件）
# 然后重装依赖并重启：
npm i --omit=dev --no-audit --no-fund --ignore-scripts
kill $(ss -tlnp | grep :3010 | grep -oP 'pid=\K[0-9]+')   # keeper 会自动拉起新代码
```

## 沙箱外部署（离开本项目环境时）

**🚀 推荐：直接用仓库里的部署包 `deploy/ncm-api/`**（docker-compose 一键起 + check.sh 健康检查
+ 完整中文指南），详见 `deploy/ncm-api/README.md`。要点：

- Docker：`cd deploy/ncm-api && docker compose up -d`（从 fork cczzff468/api-enhanced 构建，
  宿主机 3010 端口，与本项目默认代理地址一致零配置对接；或直接用上游镜像 `moefurina/ncm-api`）
- 源码部署：clone fork → `pnpm i --prod --ignore-scripts` → `PORT=3010 node app.js`，pm2 守护
- API 换了地址/主机：给 App 设环境变量 `NCM_API_UPSTREAM=http://主机:端口`（route.ts 已支持），
  或音乐 App 设置页填 baseUrl 直连
