#!/usr/bin/env bash
# ============================================================
# 诊断「部署完成但打不开」的自部署网易云 API
# 用法: bash troubleshoot.sh https://你的地址
# 在任何能上网的机器上运行均可（本仓库沙箱内也可以）
# ============================================================
set -u
BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "用法: bash troubleshoot.sh https://你的域名"
  exit 1
fi
BASE="${BASE%/}"
HOST=$(echo "$BASE" | sed -E 's#https?://([^/:]+).*#\1#')
NOW=$(date +%s%3N)

echo "目标: $BASE"
echo
echo "[1/4] DNS 解析: $HOST"
if getent hosts "$HOST" > /dev/null 2>&1; then
  echo "  OK -> $(getent hosts "$HOST" | awk '{print $1}' | head -1)"
else
  echo "  X DNS 解析失败 —— 域名拼错，或该平台尚未分配域名"
fi

echo "[2/4] 根路径 / 状态码"
ROOT_CODE=$(curl -s -o /tmp/ts-root.html -w '%{http_code}' --max-time 25 "$BASE/")
case "$ROOT_CODE" in
  200) echo "  200 OK —— 根路径正常" ;;
  301|302|307|308)
       LOC=$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 20 "$BASE/")
       echo "  $ROOT_CODE 重定向 -> $LOC" ;;
  403) echo "  403 —— 被平台/防火墙拦截" ;;
  404) echo "  404 —— 域名对但路由没生效: serverless 部署不完整/入口文件缺失" ;;
  429) echo "  429 —— 被限流，稍后再试" ;;
  000) echo "  连接失败/超时 —— 实例没起来、域名不对，或平台休眠中" ;;
  5*)  echo "  $ROOT_CODE —— 服务端错误（去部署平台看日志）" ;;
  *)   echo "  $ROOT_CODE —— 非常规状态码" ;;
esac
echo "  根路径返回片段: $(head -c 120 /tmp/ts-root.html 2>/dev/null | tr -d '\n')"
echo

echo "[3/4] API 探测: /login/qr/key"
QR=$(curl -s --max-time 25 "$BASE/login/qr/key?timestamp=$NOW")
echo "  响应: $(echo "$QR" | head -c 200)"
case "$QR" in
  *unikey*)            echo "  OK —— 核心接口正常，API 已可用！" ;;
  *"参数错误"*|*460*)  echo "  接口通了但被网易风控（数据中心 IP 常见），扫码登录一次可缓解" ;;
  *"Cannot GET"*|*404*) echo "  路由未生效 —— serverless 入口/路由配置问题" ;;
  "")                  echo "  无响应 —— 实例未运行或超时（冷启动的等 1-2 分钟再试）" ;;
  *)                   echo "  异常响应 —— 见上方原文" ;;
esac
echo

echo "[4/4] 搜索接口: /cloudsearch?keywords=周杰伦"
CS=$(curl -s --max-time 25 "$BASE/cloudsearch?keywords=%E5%91%A8%E6%9D%B0%E4%BC%A6&timestamp=$NOW")
case "$CS" in
  *songs*)               echo "  OK —— 搜索正常，完整可用" ;;
  *"Cannot GET"*|*404*)  echo "  路由未生效" ;;
  "")                    echo "  无响应" ;;
  *)                     echo "  返回异常（风控或受限）: $(echo "$CS" | head -c 150)" ;;
esac

echo
echo "==== 结论 ===="
if echo "$QR" | grep -q unikey && echo "$CS" | grep -q songs; then
  echo "你的部署其实是【好的】！浏览器打不开多半是:"
  echo "  1) 地址输错/带错前缀（API 地址后面不要加 /api 之类的路径）"
  echo "  2) 你打开的是部署平台后台页，而不是 API 本身的地址"
  echo "  3) 浏览器缓存了之前的错误页（Ctrl+Shift+R 强刷）"
  echo "API 直接用: $BASE"
elif [ "$ROOT_CODE" = "000" ]; then
  echo "实例不通: 域名错/没启动/平台休眠中。把部署平台项目页的状态发出来进一步定位。"
else
  echo "部署有问题: 根路径=$ROOT_CODE，API 探测见上。"
  echo "最常见是 serverless 构建不完整 —— 建议直接用本目录重部:"
  echo "  bash deploy-hf.sh <HF_TOKEN>  或  bash deploy-vercel.sh <VERCEL_TOKEN>"
fi
