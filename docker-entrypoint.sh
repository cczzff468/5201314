#!/usr/bin/env bash
# AI Phone 容器入口：AI 网关注入 → netease-api → SQLite 卷初始化 → Next 主服务
# 设计原则：附属服务失败绝不阻断主服务（音乐/AI 降级可用，网页壳永远起来）
set -uo pipefail

APP_DIR="/app"
DATA_DIR="${DATA_DIR:-/data}"

echo "[entrypoint] AI Phone starting..."

# ---------- 1) AI 网关配置注入（z-ai-web-dev-sdk 读 /app/.z-ai-config） ----------
# ZAI_BASE_URL / ZAI_API_KEY（Railway 变量面板配置，OpenAI 兼容 /v1 端点）
# SDK 的 /chat/completions 与 /images/generations 均为 OpenAI 兼容路径；
# 缺省不写配置文件 → SDK create() 抛错 → 各 API route 已有 try/catch 降级。
if [ -n "${ZAI_BASE_URL:-}" ] && [ -n "${ZAI_API_KEY:-}" ]; then
  cat > "$APP_DIR/.z-ai-config" <<EOF
{"baseUrl": "${ZAI_BASE_URL%/}", "apiKey": "${ZAI_API_KEY}"}
EOF
  echo "[entrypoint] AI gateway configured (${ZAI_BASE_URL%/})"
else
  echo "[entrypoint] AI gateway NOT configured (set ZAI_BASE_URL + ZAI_API_KEY to enable AI)"
fi

# ---------- 2) netease-api（后台，失败不阻断） ----------
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

# ---------- 3) SQLite 数据卷初始化（/data 由 Railway Volume 挂载） ----------
mkdir -p "$DATA_DIR"
export DATABASE_URL="${DATABASE_URL:-file:$DATA_DIR/custom.db}"
echo "[entrypoint] database: $DATABASE_URL"
cd "$APP_DIR"
bunx prisma db push --accept-data-loss --skip-generate 2>&1 | grep -vE "^$|Generated" || true

# ---------- 4) Next.js standalone 主服务 ----------
# Railway 注入 PORT（缺省 3000）；HOSTNAME 0.0.0.0 容器外可达
export PORT="${PORT:-3000}"
export HOSTNAME=0.0.0.0
echo "[entrypoint] starting Next.js standalone on :$PORT"
cd "$APP_DIR/.next/standalone"
exec node server.js
