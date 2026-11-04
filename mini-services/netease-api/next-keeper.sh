#!/bin/bash
# next-keeper.sh —— Next.js dev server 守护脚本
# 由 netease-api（容器启动树成员，免于工具调用进程回收）拉起，因此本进程及其子进程
# 继承启动树身份，可在 Bash 工具调用间隙存活。
#
# 职责：
#   1. 端口 3000 无监听时启动 `bun run dev`（前台阻塞运行，退出后自动重启）
#   2. Next.js OOM/崩溃自愈（5 秒内拉起）
#   3. PID 文件保证全局单实例（node --watch 多次重启也不会叠加）
#
# 日志：/tmp/next-keeper.log

PIDFILE=/tmp/next-keeper.pid
LOG=/tmp/next-keeper.log

# 单实例守卫：已有存活实例则退出
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "$(date '+%F %T') keeper already running (pid $(cat "$PIDFILE")), exit" >> "$LOG"
  exit 0
fi
echo $$ > "$PIDFILE"
echo "$(date '+%F %T') keeper started pid=$$" >> "$LOG"

# 顺带拉起网易云 API 守护（ncm-keeper，3010；PID 文件单实例守卫，已在跑则自动退出）
NCM_KEEPER=/home/z/my-project/mini-services/netease-api/ncm-keeper.sh
if [ -f "$NCM_KEEPER" ]; then
  nohup bash "$NCM_KEEPER" >> /tmp/ncm-api.log 2>&1 &
fi

# TCP 连通性检测（比 HTTP 探测更快更稳，编译慢不会误判）
port_up() {
  (exec 3<>/dev/tcp/127.0.0.1/3000) 2>/dev/null && { exec 3>&- 3<&-; return 0; }
  return 1
}

while true; do
  if port_up; then
    sleep 5
    continue
  fi
  echo "$(date '+%F %T') port 3000 down, starting next dev..." >> "$LOG"
  cd /home/z/my-project || { sleep 5; continue; }
  # 堆上限 1GB：防止 dev server 内存膨胀再次触发 OOM
  NODE_OPTIONS="--max-old-space-size=1024" bun run dev >> /tmp/next-keeper.log 2>&1
  echo "$(date '+%F %T') next dev exited code=$?, restarting in 3s" >> "$LOG"
  sleep 3
done
