import { addSseClient, removeSseClient } from '@/lib/server/notify-bus';

/**
 * 通知 SSE 长连接（v57 通知系统）：
 * GET /api/notify/stream → text/event-stream，连接挂起直至客户端断开。
 * - 服务端每 25s 写一行 `: ping` 注释行保活（防中间层空闲断连）；
 * - 通知事件由 /api/notify/push 广播（data: {…}\n\n）；
 * - EventSource 断线自动重连（客户端零逻辑），HMR 下旧流 cancel → 新流重注册。
 */

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 25_000;

export async function GET(): Promise<Response> {
  const enc = new TextEncoder();
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const writer = {
    write: (chunk: string): boolean => {
      if (!ctrl) return false;
      try {
        ctrl.enqueue(enc.encode(chunk));
        return true;
      } catch {
        return false;
      }
    },
  };

  const cleanup = (): void => {
    removeSseClient(writer);
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
      addSseClient(writer);
      writer.write(': connect\n\n');
      heartbeat = setInterval(() => {
        if (!writer.write(': ping\n\n')) cleanup();
      }, HEARTBEAT_MS);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
