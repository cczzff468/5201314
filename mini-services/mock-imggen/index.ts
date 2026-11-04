/**
 * Mock 图像生成上游（仅本地 E2E 验证用）：
 * 提供 OpenAI 兼容的 POST /v1/images/generations 与 /v1/images/edits，
 * 固定返回一张 1x1 PNG（b64_json），供 /api/imggen 代理转发链路测试。
 */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const server = Bun.serve({
  port: 3099,
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'POST' && (url.pathname.endsWith('/images/generations') || url.pathname.endsWith('/images/edits'))) {
      await req.json().catch(() => null); // 消费请求体（不校验内容）
      return Response.json({ created: Math.floor(Date.now() / 1000), data: [{ b64_json: TINY_PNG_B64 }] });
    }
    if (url.pathname === '/health') return Response.json({ ok: true });
    return Response.json({ error: { message: `mock upstream: no route ${req.method} ${url.pathname}` } }, { status: 404 });
  },
});

console.log(`[mock-imggen] listening on http://localhost:${server.port}`);
