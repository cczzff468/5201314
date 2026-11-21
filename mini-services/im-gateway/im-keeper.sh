#!/bin/bash
# im-keeper.sh —— im-gateway（内置 IM 网关，端口 3100）守护脚本
# 与 llm-keeper.sh 同模式：PID 单实例守卫 + 端口掉线自动拉起 + 崩溃自愈
# 日志：/tmp/im-gateway.log
# v8 背景：网关状态在内存里，进程崩溃/服务重启就静默掉线（用户反馈「有时候会断连」）——
# 守护 + gateway-state.json 启动自恢复（index.ts 内置）双保险，掉线秒级自动回在线。

PIDFILE=/tmp/im-keeper.pid
LOG=/tmp/im-gateway.log

# 单实例守卫：已有存活实例则退出
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "$(date '+%F %T') keeper already running (pid $(cat "$PIDFILE")), exit" >> "$LOG"
  exit 0
fi
echo $$ > "$PIDFILE"
echo "$(date '+%F %T') keeper started pid=$$" >> "$LOG"

# TCP 连通性检测
port_up() {
  (exec 3<>/dev/tcp/127.0.0.1/3100) 2>/dev/null && { exec 3>&- 3<&-; return 0; }
  return 1
}

while true; do
  if ! port_up; then
    echo "$(date '+%F %T') port 3100 down, starting im-gateway..." >> "$LOG"
    ( cd "$(dirname "$0")" && exec setsid bun run dev >> "$LOG" 2>&1 < /dev/null & )
    # 等待端口起来（最多 15s）
    for _ in $(seq 1 15); do
      port_up && break
      sleep 1
    done
  fi
  sleep 5
done
