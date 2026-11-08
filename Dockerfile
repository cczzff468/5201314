# syntax=docker/dockerfile:1
# AI Phone — Railway 生产镜像（单阶段：简单可靠，云端构建无资源压力）
#
# 运行形态（一个容器内两个进程，容器内 localhost 互通）：
#   1. netease-api（网易云 API，端口 3010，node）——音乐 App 的数据源；
#      海外访问 music.163.com 可能慢/受限，失败仅音乐降级，不阻断主服务
#   2. Next.js standalone（端口 $PORT，Railway 注入）——主应用
#
# AI 能力（v82）：z-ai-web-dev-sdk 已从运行时移除——AI 完全走用户在
#   「设置 › API 配置」自行配置的 OpenAI 兼容接口（客户端随请求传入服务端代理，
#   无需任何环境变量/网关注入）；未配置时返回明确引导，其余功能正常。

FROM node:20-bookworm-slim

# bun：install/build 提速（node:20 跑 netease-api 更稳）
# npm 全局装 bun：bun.sh/install 脚本在 Railway 构建环境会静默失败（实测 bun: not found），
# npm registry 在构建机访问稳定可靠
RUN npm install -g bun
# prisma 引擎与 netease-api 原生依赖需要的运行库
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依赖层（独立缓存层）
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# 源码（.railwayignore 已排除 .git/android-shell/db 等）
COPY . .

# Prisma Client 生成（生成到 node_modules，runtime 复用）
RUN bunx prisma generate

# netease-api 依赖（音乐 App 数据源；node 跑，npm 装保证 CJS 生态兼容）
# --ignore-scripts：跳过 husky prepare（devDependency 未安装会报错）
RUN cd mini-services/netease-api && npm install --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error

# Next 生产构建（ignoreBuildErrors 已在 next.config 关闭类型检查）
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=file:/tmp/build-placeholder.db
RUN bun run build

# entrypoint：netease-api + db push + 主服务
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "/app/docker-entrypoint.sh"]
