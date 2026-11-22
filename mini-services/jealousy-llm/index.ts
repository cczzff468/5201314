/**
 * jealousy-llm（v1.9.19 E2E 用）：把 z-ai-web-dev-sdk 包装成 OpenAI 兼容的
 * /v1/chat/completions 非流式接口，供 AI Phone 的「设置 › API 配置」指向——
 * 吃醋锁的 LLM 决策链（决策/戏剧性记忆）与普通聊天由此走真模型。
 *
 * 仅沙箱 E2E 用，不进入生产链路（生产用户配自己的 OpenAI 兼容接口）。
 * 绑 0.0.0.0：本机公网 IP（如 21.0.18.126）访问时 /api/chat 的 isPrivateHost
 * 检查放行，服务端代理可达。
 */
import ZAI from 'z-ai-web-dev-sdk';

const PORT = 3031;

const server = Bun.serve({
  hostname: '0.0.0.0',
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);

    if (url.pathname.endsWith('/chat/completions') && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as {
        messages?: { role: 'system' | 'user' | 'assistant'; content: string }[];
      };
      const messages = (body.messages ?? []).filter((m) => m && typeof m.content === 'string');
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      console.log(`[jealousy-llm] req messages=${messages.length} lastUser=${JSON.stringify((lastUser?.content ?? '').slice(0, 60))}`);
      // E2E 调试：system 里是否注入了吃醋锁块 / 是否带解冻指令教学
      const sys = messages.find((m) => m.role === 'system');
      if (sys) {
        const hasLockBlock = sys.content.includes('吃醋锁生效中');
        const hasUnfreezeTeach = sys.content.includes('手机操作:解冻');
        console.log(`[jealousy-llm] system: len=${sys.content.length} jealousyBlock=${hasLockBlock} unfreezeTeach=${hasUnfreezeTeach}`);
      }
      // E2E 调试：记录 AI 回复原文里是否含解冻指令
      const replyDump = (t: string) => {
        if (t.includes('手机操作')) console.log(`[jealousy-llm] REPLY CONTAINS PHONE OP: ${JSON.stringify(t.slice(0, 200))}`);
      };
      try {
        const zai = await ZAI.create();
        const completion = await zai.chat.completions.create({
          messages,
          thinking: { type: 'disabled' },
        });
        const content = completion.choices?.[0]?.message?.content ?? '';
        replyDump(content);
        console.log(`[jealousy-llm] reply len=${content.length} head=${JSON.stringify(content.slice(0, 80))}`);
        return new Response(
          JSON.stringify({
            id: 'chatcmpl-jealousy-e2e',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'zai-llm',
            choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } },
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[jealousy-llm] SDK error: ${msg}`);
        return new Response(JSON.stringify({ error: { message: msg } }), {
          status: 502,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
        });
      }
    }

    // GET 健康检查
    if (req.method === 'GET') {
      return new Response('jealousy-llm ok', { status: 200, headers: cors });
    }
    return new Response(JSON.stringify({ error: { message: 'not found' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
    });
  },
});

console.log(`[jealousy-llm] listening on 0.0.0.0:${PORT}`);
