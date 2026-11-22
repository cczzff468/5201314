#!/bin/bash
# kg-keeper.sh —— kugou-api（酷狗音乐 API，端口 3012）守护脚本
# 与 ncm-keeper.sh 同模式：PID 单实例守卫 + 端口掉线自动拉起 + 崩溃自愈
#
# 代码源：MakcRe/KuGouMusicApi v1.6.3（vendor 于本目录，netease 风格 API）
#
# 注意：必须用 node 运行 app.js（bun 的 crypto 与部分 Node 加密行为不兼容，
#       一律使用 node 运行时，Keeper 内在 node_modules 缺失时自动 npm 补装）。
#
# 日志：/tmp/kugou-api.log

PIDFILE=/tmp/kg-keeper.pid
LOG=/tmp/kugou-api.log

# 单实例守卫：已有存活实例则退出
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "$(date '+%F %T') keeper already running (pid $(cat "$PIDFILE")), exit" >> "$LOG"
  exit 0
fi
echo $$ > "$PIDFILE"
echo "$(date '+%F %T') keeper started pid=$$" >> "$LOG"

# TCP 连通性检测
port_up() {
  (exec 3<>/dev/tcp/127.0.0.1/3012) 2>/dev/null && { exec 3>&- 3<&-; return 0; }
  return 1
}

while true; do
  if port_up; then
    sleep 5
    continue
  fi
  echo "$(date '+%F %T') port 3012 down, starting kugou-api..." >> "$LOG"
  cd /home/z/my-project/mini-services/kugou-api || { sleep 5; continue; }
  # 依赖缺失时自动补装（防止 node_modules 被清理后服务起不来；npm + Node 24 运行时）
  if [ ! -f node_modules/express/package.json ]; then
    echo "$(date '+%F %T') node_modules missing, running npm install..." >> "$LOG"
    npm i --omit=dev --no-audit --no-fund --ignore-scripts >> "$LOG" 2>&1
  fi
  PORT=3012 node app.js >> "$LOG" 2>&1
  echo "$(date '+%F %T') kugou-api exited code=$?, restarting in 3s" >> "$LOG"
  sleep 3
done
