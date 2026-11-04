# 网易云 API 外部部署指南（离开沙箱也能用）

> API 本体：**api-enhanced v4.41.1**（[上游](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) ·
> [你自己的 fork：cczzff468/api-enhanced](https://github.com/cczzff468/api-enhanced)）。
> 沙箱内已 vendor 部署于 `mini-services/netease-api`（3010 端口）；
> 本目录让你在**任何服务器 / 本机 / NAS** 上 5 分钟跑起同一套服务，并与手机模拟器 App 无缝对接。

---

## 〇、让我替你部署（只需一个 Token）

不想自己动手？把下面任意一个 token 发给助手（聊天里直接粘贴），其余全自动：
创建实例、部署、健康检查、给你成品 API 地址。

| 平台 | 获取 Token（约 30 秒） | 特点 |
|---|---|---|
| **Hugging Face（推荐）** | 打开 https://huggingface.co/settings/tokens → Create new token → 权限选 **Write** → 复制 `hf_` 开头的串 | 真 Node 容器、无 serverless 怪癖；免费；闲置 48h 自动休眠、下次访问自动唤醒（约 1 分钟） |
| Vercel | 打开 https://vercel.com/account/settings/tokens → Add → 复制 | 部署快，但免费版冷启动慢 + 共享出口 IP 风控高发 |

助手拿到 token 后执行的就是这两个脚本（你自己在任何机器上也能跑）：

```bash
bash deploy/ncm-api/deploy-hf.sh <HF_TOKEN>          # HF Spaces 一条龙
bash deploy/ncm-api/deploy-vercel.sh <VERCEL_TOKEN>  # Vercel 一条龙
```

> 安全提示：token 等同于账号写权限，用完可在平台设置页随时吊销。

### 已经自己部署过但「打不开」？

把你的访问地址发出来让助手查，或直接跑诊断脚本：

```bash
bash deploy/ncm-api/troubleshoot.sh https://你的地址
```

常见原因速查：
- `404` = serverless 构建不完整/入口缺失；
- `连接失败/000` = 实例没启动或平台休眠；
- `域名打不开但接口其实通` = 打开的是部署平台后台页，不是 API 地址本身；
- `接口通但报参数错误` = 网易对数据中心 IP 风控（扫码登录一次可缓解）。

---

## 一、部署方式

### 方式 A：Docker Compose（推荐，两条命令）

前提：机器上装有 Docker（`curl -fsSL https://get.docker.com | bash` 一键安装）。

```bash
# 把 5200 仓库拉到服务器（或只拷贝 deploy/ncm-api 目录也行）
git clone https://github.com/cczzff468/5200.git && cd 5200/deploy/ncm-api

docker compose up -d     # 从你的 fork 构建并启动，约 1-2 分钟
bash check.sh            # 健康检查，应看到 9 项全 ✅
```

- 服务自动常驻（`restart: unless-stopped`，开机自启随 docker 服务）
- 升级版本：`docker compose build --pull && docker compose up -d`
- 想用上游官方镜像免构建：编辑 `docker-compose.yml`，注释 `build:` 行、解开 `image: moefurina/ncm-api:latest`
- 日志：`docker compose logs -f`

### 方式 B：Node + pm2（不想用 Docker）

要求 Node ≥ 18（推荐 22+）。**必须用 Node 运行**——bun/deno 的 crypto 与 eapi 加密不兼容，
扫码登录等接口会报「参数错误」。

```bash
git clone https://github.com/cczzff468/api-enhanced.git && cd api-enhanced
pnpm i --prod --ignore-scripts      # 或 npm i --omit=dev --ignore-scripts
npm i -g pm2
PORT=3010 pm2 start app.js --name ncm-api && pm2 save && pm2 startup
```

---

## 二、与手机模拟器 App（5200 仓库）对接

三种方式按场景选一，**前两种不用动 App 任何代码**：

| 场景 | 做法 |
|---|---|
| **API 与 App 同机** | 零配置。compose 已映射宿主机 3010 端口，App 的 `/api/music/ncm` 代理默认指向 `localhost:3010` |
| **API 在其它机器/端口** | 给 App 设环境变量 `NCM_API_UPSTREAM=http://API主机:端口`（写进 5200 项目根目录 `.env` 或 `.env.local`，重启 dev server 生效） |
| **API 给多端/公网共用** | 音乐 App → 设置 → 「API 地址」填完整 baseUrl（如 `https://api.xxx.com`），可选填 API Key；前端直连，无需经过 App 代理 |

App 侧相关文件（供参考）：代理 `src/app/api/music/ncm/[...path]/route.ts`；
前端双模式 `src/lib/ios/music-api.ts`；设置页 `src/components/apps/music-settings.tsx`。

---

## 三、验证

```bash
bash check.sh                          # 本机默认 3010
bash check.sh http://服务器IP:3010     # 远程实例
```

9 项全 ✅ 即部署成功。个别项偶发「参数错误 / 460」= 网易瞬时风控，隔几秒重试即可。

---

## 四、上线前建议（重要）

1. **HTTPS**：若 App 部署在 https 域名下，直连 http 的 API 会被浏览器混合内容策略拦截。
   给 API 套一层反代最省事（Caddy 两行配置自动签证书）：
   ```caddyfile
   api.example.com {
       reverse_proxy 127.0.0.1:3010
   }
   ```
   音频/封面播放不受此影响——App 内 `/api/music/stream` 白名单代理已解决混合内容与防盗链。
2. **风控**：云服务器数据中心 IP 的风控比家用宽带严。建议：
   - 用真实账号**扫码登录一次**，之后 cookie（`MUSIC_U`）由 App 自持复用，不要每次匿名刷接口；
   - 不要高频轮询（健康检查脚本已控制在 9 次以内）；
   - 生产环境给 API 加个简单鉴权/限流（上游支持 `X-API-Key`，App 设置页可直接填）。
3. **Vercel / Serverless**：上游带 `vercel.json` 理论可部署，但 serverless 超时 + 共享出口 IP
   风控高发，**不推荐作为主力**，自建服务器体验最稳。
4. **公网暴露**：API 默认无鉴权，公网部署务必加反代鉴权或防火墙白名单，防止被白嫖刷量。

---

## 五、常用运维

```bash
docker compose ps                # 状态（healthcheck 应为 healthy）
docker compose logs -f --tail=100
docker compose restart
docker compose down
docker compose build --pull && docker compose up -d   # 升级到 fork 最新
```

同步上游更新到你的 fork：GitHub 页面点 "Sync fork"，或本地
`git pull upstream main && git push`，然后 `docker compose build --pull`。
