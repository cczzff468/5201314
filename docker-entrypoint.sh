#!/usr/bin/env bash
# AI Phone 容器入口：netease-api → SQLite 卷初始化 → Next 主服务
# 设计原则：附属服务失败绝不阻断主服务（音乐降级可用，网页壳永远起来）
# v82：z-ai-web-dev-sdk 及其 .z-ai-config 注入已移除——AI 能力完全由用户在
# 「设置 › API 配置」里自行配置（客户端随请求传入服务端代理，无需环境变量）
set -uo pipefail

APP_DIR="/app"
DATA_DIR="${DATA_DIR:-/data}"

echo "[entrypoint] AI Phone starting..."

# ---------- 1) netease-api（后台，失败不阻断） ----------
# 沙箱版用 ncm-keeper.sh 守护链（硬编码 /home/z/my-project），容器内直接起进程即可。
# 海外服务器访问 music.163.com 可能慢：仅影响音乐 App，超时/失败静默降级。
if [ -f "$APP_DIR/mini-services/netease-api/app.js" ]; then
  (
    cd "$APP_DIR/mini-services/netease-api" || exit 1
    # 依赖已在镜像构建时安装；双保险静默补装
    [ -d node_modules ] || npm install --omit=dev --no-audit --no-fund --loglevel=error >/dev/null 2>&1
    PORT=3010 nohup node app.js >/var/log/ncm.log 2>&1 &
    echo "[entrypoint] netease-api started on :3010 (pid $!)"
  ) || echo "[entrypoint] netease-api failed to start (music degraded)"
fi

# ---------- 2) SQLite 数据卷初始化（/data 由 Railway Volume 挂载） ----------
mkdir -p "$DATA_DIR"
export DATABASE_URL="${DATABASE_URL:-file:$DATA_DIR/custom.db}"
echo "[entrypoint] database: $DATABASE_URL"
cd "$APP_DIR"
bunx prisma db push --accept-data-loss --skip-generate 2>&1 | grep -vE "^$|Generated" || true

# ---------- 3) Next.js standalone 主服务 ----------
# Railway 注入 PORT（缺省 3000）；HOSTNAME 0.0.0.0 容器外可达
export PORT="${PORT:-3000}"
export HOSTNAME=0.0.0.0
echo "[entrypoint] starting Next.js standalone on :$PORT"
cd "$APP_DIR/.next/standalone"
exec node server.js
