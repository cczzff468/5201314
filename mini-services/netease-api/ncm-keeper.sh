#!/bin/bash
# ncm-keeper.sh —— netease-api（网易云 API，端口 3010）守护脚本
# 与 next-keeper.sh 同模式：PID 单实例守卫 + 端口掉线自动拉起 + 崩溃自愈
#
# 代码源：cczzff468/api-enhanced（NeteaseCloudMusicApiEnhanced v4.41.1 vendor 于本目录，
#         原 NeteaseCloudMusicApi@4.32.0 npm 包方案已替换，接口向下兼容）。
#
# 注意：必须用 node 运行 index.js（bun 的 crypto 与 eapi 加密不兼容，
#       会导致 /login/qr/key 等接口被网易返回「参数错误」，见 index.js 注释）。
#
# 日志：/tmp/ncm-api.log

PIDFILE=/tmp/ncm-keeper.pid
LOG=/tmp/ncm-api.log

# 单实例守卫：已有存活实例则退出
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "$(date '+%F %T') keeper already running (pid $(cat "$PIDFILE")), exit" >> "$LOG"
  exit 0
fi
echo $$ > "$PIDFILE"
echo "$(date '+%F %T') keeper started pid=$$" >> "$LOG"

# TCP 连通性检测
port_up() {
  (exec 3<>/dev/tcp/127.0.0.1/3010) 2>/dev/null && { exec 3>&- 3<&-; return 0; }
  return 1
}

while true; do
  if port_up; then
    sleep 5
    continue
  fi
  echo "$(date '+%F %T') port 3010 down, starting netease-api..." >> "$LOG"
  cd /home/z/my-project/mini-services/netease-api || { sleep 5; continue; }
  # 依赖缺失时自动补装（防止 node_modules 被清理后服务起不来；npm + Node 24 运行时）
  if [ ! -f node_modules/express/package.json ]; then
    echo "$(date '+%F %T') node_modules missing, running npm install..." >> "$LOG"
    npm i --omit=dev --no-audit --no-fund --ignore-scripts >> "$LOG" 2>&1
  fi
  node index.js >> "$LOG" 2>&1
  echo "$(date '+%F %T') netease-api exited code=$?, restarting in 3s" >> "$LOG"
  sleep 3
done
