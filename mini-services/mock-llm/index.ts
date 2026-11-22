/**
 * 通知延迟测量用 mock OpenAI 兼容接口（仅沙盒 E2E 用，不进入生产链路）：
 * POST /v1/chat/completions → SSE 流式回复，首 token 延迟 / token 间隔可控。
 */
const PORT = 3999;
const FIRST_TOKEN_MS = Number(process.env.FIRST_TOKEN_MS ?? 300);
const TOKEN_INTERVAL_MS = Number(process.env.TOKEN_INTERVAL_MS ?? 20);

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (url.pathname.endsWith('/chat/completions')) {
      const t0 = Date.now();
      const body = (await req.json()) as { messages?: { role: string; content: string }[] };
      const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
      const prompt = lastUser?.content ?? '';
      console.log(`[mock] t=0 request received, lastUser=${JSON.stringify(prompt.slice(0, 40))}`);
      // 回复 3 条消息（模拟多条连发，测分段→投递→横幅全链路）
      const reply = '好的呀！我刚刚看到消息啦。\n这一周过得怎么样，有没有好好吃饭？\n等你回来一起去吃火锅！';
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enc = new TextEncoder();
          const send = (text: string) => controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
          send('');
          await new Promise((r) => setTimeout(r, FIRST_TOKEN_MS));
          for (const ch of reply) {
            send(ch);
            await new Promise((r) => setTimeout(r, TOKEN_INTERVAL_MS));
          }
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
          controller.close();
          console.log(`[mock] stream complete in ${Date.now() - t0}ms, reply len=${reply.length}`);
        },
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          ...cors,
        },
      });
    }
    return new Response('not found', { status: 404, headers: cors });
  },
});
console.log(`[mock] openai-compatible mock listening on :${PORT} (first=${FIRST_TOKEN_MS}ms, interval=${TOKEN_INTERVAL_MS}ms)`);
