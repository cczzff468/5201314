/**
 * OpenAI 兼容代理（E2E 测试专用）：/v1/chat/completions → z-ai-web-dev-sdk。
 *
 * 用途：给「仿 iOS 手机系统」的聊天链路（/api/chat toolMode / 浏览器直连 directChatJson）
 * 提供一个本地 OpenAI 兼容端点，让 Agent 多步任务（FC 工具循环）能在沙箱里全链路实测。
 * - 支持 tools / tool_calls / role:"tool" 多轮工具对话（SDK 原生透传）
 * - CORS 全开（directChatJson 浏览器直连场景需要预检）
 * - 每次请求落一行日志（工具链回放调试用）
 */
import ZAI from 'z-ai-web-dev-sdk';

const PORT = 3030;
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

let zaiPromise: Promise<A> | null = null;
type A = Awaited<ReturnType<typeof ZAI.create>>;
function zai(): Promise<A> {
  if (!zaiPromise) zaiPromise = ZAI.create();
  return zaiPromise;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (url.pathname.endsWith('/chat/completions') && req.method === 'POST') {
      let body: Record<string, unknown>;
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      const messages = body.messages as unknown[] | undefined;
      const tools = body.tools as unknown[] | undefined;
      const toolNames = Array.isArray(tools) ? tools.map((t) => (t as { function?: { name?: string } }).function?.name).filter(Boolean) : [];
      const lastRole = Array.isArray(messages) ? (messages[messages.length - 1] as { role?: string })?.role : '?';
      const sysMsg = Array.isArray(messages) ? (messages.find((m) => (m as { role?: string }).role === 'system') as { content?: string } | undefined)?.content ?? '' : '';
      const lastUser = Array.isArray(messages) ? [...messages].reverse().find((m) => (m as { role?: string }).role === 'user') as { content?: string } | undefined : undefined;
      console.log(`[proxy] POST msgs=${messages?.length ?? 0} last=${lastRole} sysLen=${sysMsg.length} userTail=${JSON.stringify((lastUser?.content ?? '').slice(-60))} tools=[${toolNames.join(',')}] choice=${String(body.tool_choice ?? body.toolChoice ?? 'auto')} maxTok=${String(body.max_tokens ?? body.max_completion_tokens ?? 'default')} temp=${String(body.temperature ?? 'default')}`);
      if (sysMsg.length > 1000 && Array.isArray(tools) && tools.length > 0) await Bun.write('/tmp/last-sys-prompt.txt', sysMsg);
      try {
        const cli = await zai();
        const toolChoice = body.toolChoice === 'required' || body.tool_choice === 'required' ? 'required' : 'auto';
        const completion = await cli.chat.completions.create({
          messages: messages as never,
          ...(Array.isArray(tools) && tools.length > 0 ? { tools: tools as never, tool_choice: toolChoice as never } : {}),
          thinking: { type: 'disabled' },
        } as never);
        const msg = (completion as { choices?: Array<{ message?: unknown; finish_reason?: unknown }> }).choices?.[0]?.message ?? null;
        const finish = (completion as { choices?: Array<{ finish_reason?: unknown }> }).choices?.[0]?.finish_reason;
        const usage = (completion as { usage?: unknown }).usage;
        const m = msg as { content?: string | null; tool_calls?: unknown } | null;
        console.log(`[proxy] <- finish=${JSON.stringify(finish)} content=${JSON.stringify((m?.content ?? '').slice(0, 100))} calls=${JSON.stringify(m?.tool_calls ?? null).slice(0, 200)} usage=${JSON.stringify(usage)}`);
        return new Response(
          JSON.stringify({ id: 'chatcmpl-proxy', object: 'chat.completion', created: Date.now() / 1000 | 0, model: 'glm-proxy', choices: [{ index: 0, message: msg, finish_reason: 'stop' }] }),
          { headers: { ...CORS, 'Content-Type': 'application/json' } },
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[proxy] ERROR ${msg.slice(0, 200)}`);
        return new Response(JSON.stringify({ error: msg }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
    }
    if (url.pathname === '/health') return new Response('ok', { headers: CORS });
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
  },
});
console.log(`llm-proxy listening on :${server.port}`);
