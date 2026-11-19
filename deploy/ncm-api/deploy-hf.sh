#!/usr/bin/env bash
# ============================================================
# 一条龙部署网易云 API 到 Hugging Face Spaces（Docker 容器托管）
# 只需要一个 Hugging Face Token（需 Write 权限）：
#   https://huggingface.co/settings/tokens -> Create new token -> Write
# 用法:
#   bash deploy-hf.sh <HF_TOKEN> [space名称，默认 ncm-api]
# 完成后地址: https://<用户名>-<space>.hf.space
# ============================================================
set -uo pipefail

TOKEN="${1:-}"
SPACE="${2:-ncm-api}"
HF="https://huggingface.co"
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$TOKEN" ]; then
  echo "用法: bash deploy-hf.sh <HF_TOKEN> [space名称]"
  echo "获取 token: https://huggingface.co/settings/tokens -> Create new token -> 权限选 Write"
  exit 1
fi

echo "[1/6] 校验 token ..."
WHO=$(curl -s --max-time 20 -H "Authorization: Bearer $TOKEN" "$HF/api/whoami-v2")
USER=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).name||"")}catch(e){}' <<<"$WHO")
if [ -z "$USER" ]; then
  echo "  token 无效或无 write 权限: $WHO"
  exit 1
fi
echo "  账号: $USER"

SPACE_URL="https://$USER-$SPACE.hf.space"
echo "[2/6] 创建 Space: $SPACE_URL"
CODE=$(curl -s -o /tmp/hf-create.json -w '%{http_code}' --max-time 20 -X POST "$HF/api/repos/create" \
  -H "Authorization: Bearer $TOKEN" \
  -d "type=space" -d "name=$SPACE" -d "private=false")
case "$CODE" in
  200|201) echo "  已创建" ;;
  409)     echo "  已存在，直接复用" ;;
  *)       echo "  创建失败 HTTP $CODE: $(cat /tmp/hf-create.json 2>/dev/null)"
           exit 1 ;;
esac

echo "[3/6] 生成部署文件 ..."
WORK=$(mktemp -d)
cat > "$WORK/README.md" <<EOF
---
title: ncm-api
sdk: docker
app_port: 3000
pinned: false
---
NetEase Cloud Music API (api-enhanced v4.41.1) hosted on HF Spaces.
Upstream: https://github.com/cczzff468/api-enhanced
EOF

cat > "$WORK/Dockerfile" <<'EOF'
# api-enhanced 官方镜像，容器内监听 3000 端口
FROM moefurina/ncm-api:latest
ENV PORT=3000
EXPOSE 3000
EOF

cd "$WORK"
git init -q
git config user.email "deploy@ncm-api.local"
git config user.name "ncm-deployer"
git add -A
git commit -qm "deploy ncm-api on HF Spaces"

PUSH_URL="https://$USER:$TOKEN@huggingface.co/spaces/$USER/$SPACE"
git remote add origin "$PUSH_URL"

echo "[4/6] 推送到 Hugging Face ..."
OK=0
for i in 1 2 3 4 5; do
  if git push -q -u origin main --force 2>/tmp/hf-push.log; then OK=1; break; fi
  echo "  第 $i 次推送失败: $(tail -1 /tmp/hf-push.log)，5 秒后重试"
  sleep 5
done
if [ "$OK" != 1 ]; then
  echo "推送失败，请确认 token 有 Write 权限"
  exit 1
fi

echo "[5/6] 等待构建（官方镜像拉取约 2-5 分钟，最长等 10 分钟）"
FALLBACK=0
STAGE=""
for i in $(seq 1 60); do
  STAGE=$(node -e "
fetch('$HF/api/spaces/$USER/$SPACE',{headers:{Authorization:'Bearer $TOKEN'}})
  .then(r=>r.json()).then(j=>console.log((j.runtime&&j.runtime.stage)||'UNKNOWN'))
  .catch(()=>console.log('ERR'))" 2>/dev/null)
  echo "  [${i}/60] stage=$STAGE"
  case "$STAGE" in
    RUNNING) break ;;
    BUILD_ERROR|RUNTIME_ERROR)
      if [ "$FALLBACK" = 0 ]; then
        FALLBACK=1
        echo "  官方镜像构建/启动失败，自动切换兜底方案：从 GitHub 源码构建"
        cat > "$WORK/Dockerfile" <<'EOF'
FROM node:22-alpine
RUN apk add --no-cache git \
 && git clone --depth 1 https://github.com/cczzff468/api-enhanced.git /app
WORKDIR /app
RUN npm i --omit=dev --no-audit --no-fund --ignore-scripts \
 && npm cache clean --force
ENV PORT=3000
EXPOSE 3000
CMD ["node", "app.js"]
EOF
        git add -A && git commit -qm "fallback: build from source"
        git push -q origin main --force || true
      fi
      ;;
    ERR|UNKNOWN) : ;;
  esac
  sleep 10
done

if [ "$STAGE" != "RUNNING" ]; then
  echo "构建超时/失败（最后 stage=$STAGE）"
  echo "请到 https://huggingface.co/spaces/$USER/$SPACE 查看构建日志"
  exit 1
fi

echo "[6/6] 健康检查: $SPACE_URL（首次访问冷启动可能较慢）"
PASSED=0
for t in 1 2 3; do
  if bash "$DIR/check.sh" "$SPACE_URL"; then PASSED=1; break; fi
  echo "  第 $t 轮未全过，10 秒后重试 ..."
  sleep 10
done

echo
if [ "$PASSED" = 1 ]; then
  echo "=============================================="
  echo " 部署完成！API 地址: $SPACE_URL"
  echo " 填进音乐 App: 设置 -> API 地址 -> $SPACE_URL"
  echo "=============================================="
else
  echo "Space 已运行: $SPACE_URL"
  echo "健康检查未全过（多为网易瞬时风控/冷启动），稍后重跑:"
  echo "  bash check.sh $SPACE_URL"
fi
