/**
 * 聊天 LLM mock 服务（E2E 测试用）：OpenAI 兼容 /v1/chat/completions，SSE 流式返回固定回复。
 *
 * 端点（端口 3032）：
 * - GET  /v1/models → { data: [{ id: 'mock-llm' }] }
 * - POST /v1/chat/completions（stream=true 走 SSE 分块；stream=false 走普通 JSON）
 *   回复内容：回显用户最后一条消息 + 固定文案（便于断言「AI 真的回了 N 条」）。
 * - 全部带 CORS 头（Access-Control-Allow-Origin: *），支持浏览器直连；OPTIONS 预检 204。
 *
 * 用途：浏览器 E2E 里把 设置›API配置 的 baseUrl 指向本服务 → 信息/微信等端发消息
 * → 真实走 deliverAiMsg → pushChatNotification → 灵动岛 + 系统通知全链路可断言。
 */

const PORT = 3032;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function buildReplyText(messages) {
  const users = (messages || []).filter((m) => m && m.role === 'user');
  const last = users.length ? String(users[users.length - 1].content || '') : '';
  const said = last.replace(/\s+/g, ' ').trim().slice(0, 40) || '（空消息）';
  return `收到啦！你说的是：「${said}」。今天天气不错，记得多喝水～`;
}

function sseChunk(id, content) {
  const payload = JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    model: 'mock-llm',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  });
  return 'data: ' + payload + '\n\n';
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/v1/models' && req.method === 'GET') {
      return new Response(JSON.stringify({ data: [{ id: 'mock-llm' }] }), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      let body = {};
      try {
        body = await req.json();
      } catch {
        /* 忽略非法 JSON：按空消息处理 */
      }
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const wantStream = body.stream === true;
      const reply = buildReplyText(messages);
      const id = `chatcmpl-${Date.now().toString(36)}`;
      const created = Math.floor(Date.now() / 1000);

      console.log(`[mock-llm] ${wantStream ? 'stream' : 'json'} reply, user msgs=${messages.length}`);

      if (!wantStream) {
        const payload = {
          id,
          object: 'chat.completion',
          created,
          model: 'mock-llm',
          choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        };
        return new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json', ...CORS },
        });
      }

      // SSE 流式：分 3 块吐正文，再发 finish_reason=stop 与 [DONE]
      const parts = [reply.slice(0, Math.ceil(reply.length / 3)), reply.slice(Math.ceil(reply.length / 3), Math.ceil((reply.length * 2) / 3)), reply.slice(Math.ceil((reply.length * 2) / 3))];
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          for (const p of parts) {
            controller.enqueue(enc.encode(sseChunk(id, p)));
          }
          controller.enqueue(
            enc.encode(
              'data: ' +
                JSON.stringify({
                  id,
                  object: 'chat.completion.chunk',
                  created,
                  model: 'mock-llm',
                  choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                }) +
                '\n\n',
            ),
          );
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          ...CORS,
        },
      });
    }

    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  },
});

console.log(`[mock-llm] listening on http://localhost:${PORT}`);
