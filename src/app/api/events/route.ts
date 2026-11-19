import { addSseClient, sseClientCount } from '@/lib/server/event-bus';

/**
 * SSE 长连接端点（GET /api/events）：
 *
 * 客户端（bg-turn.ts 的 EventSource 单例）常驻一条连接；服务端在任何会话产生
 * 「接力回复待达」（/api/chat/bg enqueue）时广播 bg-pending 事件，客户端收到后
 * 立即拉取对应会话 —— 替代旧的 2.5s 轮询（消息到达零延迟、无空转请求）。
 *
 * - 心跳：每 25s 一条 comment 帧（: ping\n\n），防中间代理断开空闲连接；
 * - 断线：EventSource 原生自动重连；重连后客户端首拉一次 pending 兜底
 *   （SSE 只通知「有新消息」，不承载消息本体，丢事件不丢消息）；
 * - runtime=nodejs（长生命周期 ReadableStream；Edge 流式在部分运行时行为不一）。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let removeClient: (() => void) | null = null;
  let streamClosed = false;

  const cleanup = () => {
    streamClosed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    removeClient?.();
    removeClient = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      const write = (chunk: string): boolean => {
        if (streamClosed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          return false;
        }
      };

      // 连接建立：立即发 retry + hello（客户端据此确认通道就绪）
      write('retry: 3000\n\n');
      write(`event: hello\ndata: {"t":${Date.now()}}\n\n`);

      removeClient = addSseClient((event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      heartbeat = setInterval(() => {
        // 写失败 = 连接已断：统一清理（写失败时顺带尝试关流，失败静默）
        if (!write(': ping\n\n')) {
          cleanup();
          try {
            controller.close();
          } catch {
            // 已关闭
          }
        }
      }, 25_000);

      // 客户端断开时部分运行时不触发 cancel → abort 信号兜底同一清理
      req.signal.addEventListener('abort', cleanup, { once: true });
    },
    cancel: () => {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 关闭 Nginx 等反向代理的响应缓冲，保证事件即时到达
      'X-Accel-Buffering': 'no',
    },
  });
}

/** 连接数观测（供日志/调试端点调用） */
export function reportClients(): number {
  return sseClientCount();
}
