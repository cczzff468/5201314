/**
 * 服务端 SSE 事件总线（进程内 pub/sub，globalThis 挂载防 dev HMR 重复实例）：
 *
 * 用途：废除「接力回复就绪后客户端 2.5s 轮询 /api/chat/bg」的旧机制，
 * 改为 /api/chat/bg enqueue 时向所有 SSE 长连接客户端广播 bg-pending 事件，
 * 客户端（bg-turn.ts）收到事件后立即拉取对应会话的待达消息 —— 消息一到就推，
 * 无轮询空转、无最长 2.5s 延迟。
 *
 * 单进程内存实现：本地沙箱 / 自托管单实例部署下精确可靠；Netlify 等多实例函数环境
 * beacon POST 与 SSE GET 可能落在不同实例，广播到不了——客户端保留「连上/回前台时
 * 首拉一次 + 页面关闭场景 Web Push」两条兜底路径，SSE 只是加速与省电的增强通道。
 */

export interface SseClient {
  id: number;
  /** 写一条 SSE 帧（event: xxx\ndata: json\n\n）；返回 false = 连接已断，应剔除 */
  send: (event: string, data: unknown) => boolean;
}

interface BusState {
  seq: number;
  clients: Map<number, SseClient>;
}

const g = globalThis as unknown as { __notifySseBus?: BusState };

function bus(): BusState {
  if (!g.__notifySseBus) {
    g.__notifySseBus = { seq: 0, clients: new Map() };
  }
  return g.__notifySseBus;
}

/** 注册一个 SSE 客户端，返回解绑函数 */
export function addSseClient(send: (event: string, data: unknown) => boolean): () => void {
  const b = bus();
  const id = ++b.seq;
  b.clients.set(id, { id, send });
  return () => {
    b.clients.delete(id);
  };
}

/** 向所有存活客户端广播一条事件；发送失败（连接已断）的客户端顺手剔除 */
export function broadcastEvent(event: string, data: unknown): void {
  const b = bus();
  for (const [id, client] of b.clients) {
    let alive = false;
    try {
      alive = client.send(event, data);
    } catch {
      alive = false;
    }
    if (!alive) b.clients.delete(id);
  }
}

/** 当前连接数（日志/观测用） */
export function sseClientCount(): number {
  return bus().clients.size;
}
