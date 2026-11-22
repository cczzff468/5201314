#!/bin/bash
# qq-keeper.sh —— qqmusic-api（QQ音乐 API，端口 3011）守护脚本
# 与 kg-keeper.sh 同模式：PID 单实例守卫 + 端口掉线自动拉起 + 崩溃自愈
#
# 代码源：jsososo/QQMusicApi（vendor 于本目录，express 服务，入口 bin/www）
# 已定制：端口硬编码 3011、全局 CORS、?cookie= 无状态鉴权、/login/qq|wx/qr/* 扫码登录
#
# 注意：必须用 node 运行（一律使用 node 运行时；node_modules 缺失时自动 bun 补装，
#       bun 装依赖快且不受本机 npm 缓存中失效的 taobao 源影响）。
#
# 日志：/tmp/qqmusic-api.log

PIDFILE=/tmp/qq-keeper.pid
LOG=/tmp/qqmusic-api.log

# 单实例守卫：已有存活实例则退出
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "$(date '+%F %T') keeper already running (pid $(cat "$PIDFILE")), exit" >> "$LOG"
  exit 0
fi
echo $$ > "$PIDFILE"
echo "$(date '+%F %T') keeper started pid=$$" >> "$LOG"

# TCP 连通性检测
port_up() {
  (exec 3<>/dev/tcp/127.0.0.1/3011) 2>/dev/null && { exec 3>&- 3<&-; return 0; }
  return 1
}

while true; do
  if port_up; then
    sleep 5
    continue
  fi
  echo "$(date '+%F %T') port 3011 down, starting qqmusic-api..." >> "$LOG"
  cd /home/z/my-project/mini-services/qqmusic-api || { sleep 5; continue; }
  # 依赖缺失时自动补装（bun 安装生产依赖，秒级完成）
  if [ ! -f node_modules/express/package.json ]; then
    echo "$(date '+%F %T') node_modules missing, running bun install..." >> "$LOG"
    bun install --production --ignore-scripts >> "$LOG" 2>&1
  fi
  # PORT=3011 内联兜底（bin/www 内部也已硬编码 3011，双重保险防环境泄漏 PORT=3000）
  PORT=3011 node bin/www >> "$LOG" 2>&1
  echo "$(date '+%F %T') qqmusic-api exited code=$?, restarting in 3s" >> "$LOG"
  sleep 3
done
