#!/usr/bin/env bash
# ============================================================
# 一条龙部署网易云 API 到 Vercel（serverless）
# 只需要一个 Vercel Token:
#   https://vercel.com/account/settings/tokens -> Add -> 复制
# 用法:
#   bash deploy-vercel.sh <VERCEL_TOKEN>
# ============================================================
set -uo pipefail

TOKEN="${1:-}"
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$TOKEN" ]; then
  echo "用法: bash deploy-vercel.sh <VERCEL_TOKEN>"
  echo "获取 token: https://vercel.com/account/settings/tokens -> Add"
  exit 1
fi

echo "[1/5] 校验 token（首次需下载 vercel CLI，约 1 分钟）"
WHO=$(npx -y vercel@latest whoami --token "$TOKEN" 2>/dev/null | tail -1)
if [ -z "$WHO" ]; then
  echo "  token 无效"
  exit 1
fi
echo "  账号: $WHO"

WORK=$(mktemp -d)
echo "[2/5] 拉取代码: $WORK/api-enhanced"
git clone -q --depth 1 https://github.com/cczzff468/api-enhanced.git "$WORK/api-enhanced"
cd "$WORK/api-enhanced"

echo "[3/5] 部署到 production（约 2-4 分钟）"
npx -y vercel@latest deploy --prod --yes --token "$TOKEN" > /tmp/vercel-deploy.log 2>&1
RC=$?
tail -5 /tmp/vercel-deploy.log
if [ "$RC" -ne 0 ]; then
  echo "部署失败，完整日志: /tmp/vercel-deploy.log"
  exit 1
fi

URL=$(grep -oE 'https://[a-z0-9-]+\.vercel\.app' /tmp/vercel-deploy.log | tail -1)
if [ -z "$URL" ]; then
  echo "未解析到部署 URL，请查看 /tmp/vercel-deploy.log"
  exit 1
fi

echo "[4/5] 等待实例预热 ..."
sleep 8

echo "[5/5] 健康检查: $URL"
PASSED=0
for t in 1 2 3; do
  if bash "$DIR/check.sh" "$URL"; then PASSED=1; break; fi
  echo "  第 $t 轮未全过（serverless 冷启动常见），15 秒后重试 ..."
  sleep 15
done

echo
echo "部署完成！API 地址: $URL"
if [ "$PASSED" != 1 ]; then
  echo "注意: 健康检查未全过。Vercel 冷启动较慢，稍后重跑:"
  echo "  bash check.sh $URL"
fi
echo "提醒: Vercel 免费版有冷启动 + 共享出口 IP 风控，长期主力建议 Docker 自建（见 README.md 方式 A）"
