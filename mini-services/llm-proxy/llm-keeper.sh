#!/bin/bash
# llm-keeper.sh —— llm-proxy（OpenAI 兼容代理，端口 3030）守护脚本
# 与 ncm-keeper.sh 同模式：PID 单实例守卫 + 端口掉线自动拉起 + 崩溃自愈
# 日志：/tmp/llm-proxy.log

PIDFILE=/tmp/llm-keeper.pid
LOG=/tmp/llm-proxy.log

# 单实例守卫：已有存活实例则退出
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "$(date '+%F %T') keeper already running (pid $(cat "$PIDFILE")), exit" >> "$LOG"
  exit 0
fi
echo $$ > "$PIDFILE"
echo "$(date '+%F %T') keeper started pid=$$" >> "$LOG"

# TCP 连通性检测
port_up() {
  (exec 3<>/dev/tcp/127.0.0.1/3030) 2>/dev/null && { exec 3>&- 3<&-; return 0; }
  return 1
}

while true; do
  if ! port_up; then
    echo "$(date '+%F %T') port 3030 down, starting llm-proxy..." >> "$LOG"
    ( cd "$(dirname "$0")" && exec bun run dev >> "$LOG" 2>&1 & )
    # 等待端口起来（最多 15s）
    for _ in $(seq 1 15); do
      port_up && break
      sleep 1
    done
  fi
  sleep 5
done
