# Cove 预览镜像（Koyeb / 任意 Docker 平台）
#
# 为什么用 Dockerfile：项目是 Next 16 standalone 输出，运行要 node + prisma 引擎 +
# public 资源；Koyeb 的 Node buildpack 会走 `bun` 启动脚本（容器里没有 bun），
# 用 Dockerfile 可以把构建和启动都钉死，避免各平台默认行为不一样。
#
# 构建：docker build -t cove .
# 运行：docker run -p 8000:8000 cove   → http://localhost:8000
# 数据：容器内 /app/db/custom.db 是仓库里的库副本（容器磁盘临时，重启回到初始状态）

# ---------- 构建阶段（用完整镜像，带 python3/make/g++，防个别依赖要编译） ----------
FROM node:22-bookworm AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
# --legacy-peer-deps：项目里 react 19 与个别库 peer 声明不一致，npm 严格模式会拦
RUN npm install --legacy-peer-deps --no-audit --no-fund

COPY . .
RUN npx prisma generate && npm run build

# ---------- 运行阶段（只要 standalone 产物 + 数据库文件） ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# build 脚本已把 .next/static 与 public 复制进 standalone 目录，整包拷过来即可
COPY --from=builder /app/.next/standalone ./
# 仓库自带 SQLite 库（账号/内容），相对 WORKDIR 解析 → /app/db/custom.db
COPY --from=builder /app/db ./db

# Koyeb/大多数平台会注入 PORT；没注入时默认 8000
ENV PORT=8000
EXPOSE 8000
CMD ["node", "server.js"]
