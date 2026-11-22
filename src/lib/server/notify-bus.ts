/**
 * 通知 SSE 总线（v57 通知系统——服务端广播通道）：
 *
 * - `/api/notify/stream`（GET，SSE 长连接）把每个连接的写入器注册到这里；
 * - `/api/notify/push`（POST）把通知载荷广播给所有在线连接；
 * - 客户端收到事件后经 Service Worker registration.showNotification() 弹系统通知，
 *   通知内容动态携带角色头像（复合图标 dataURL）、角色名字（title）、App 图标（badge）。
 *
 * 状态挂 globalThis（HMR/路由模块热替换后同一实例存活，连接不丢）；
 * 写失败的连接惰性剔除（下个心跳/广播时自然清掉）。
 */

export interface SseClientWriter {
  /** 写一段 SSE 文本（data: …\n\n 或 : ping 注释行）；流已取消返回 false */
  write: (chunk: string) => boolean;
}

const g = globalThis as unknown as { __notifySseClients?: Set<SseClientWriter> };
const clients: Set<SseClientWriter> = (g.__notifySseClients ??= new Set<SseClientWriter>());

export function addSseClient(w: SseClientWriter): void {
  clients.add(w);
}

export function removeSseClient(w: SseClientWriter): void {
  clients.delete(w);
}

/** 当前在线连接数（push 路由返回 delivered 用；调试/监控亦可读） */
export function sseClientCount(): number {
  return clients.size;
}

/** 广播一条通知事件；返回成功写入的连接数（写失败的连接顺手剔除） */
export function broadcastSseEvent(payload: unknown): number {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  let delivered = 0;
  for (const w of [...clients]) {
    if (w.write(data)) delivered += 1;
    else clients.delete(w);
  }
  return delivered;
}
