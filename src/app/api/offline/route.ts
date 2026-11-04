import { NextRequest, NextResponse } from 'next/server';

import { completeWithFallback, extractUpstreamConfig, readJsonBody, type LLMMessage } from '@/lib/server-llm';

/**
 * 线下模式（约会）生成接口（QQ / 微信 / 信息三端共用）。
 *
 * POST body：
 * - config?:  用户在设置 App「API 设置」里配置的 OpenAI 兼容接口（客户端随请求传入，服务端不读任何设置存储）
 * - messages: [{ role: 'system'|'user'|'assistant', content }] —— 人设/世界书/记忆/时间感知/现场参数
 *             由客户端组装（与线上聊天同构），服务端只负责调用上游并兜底
 * - maxTokens?: 按本次目标字数动态放大（覆盖 config.maxTokens，上限 8000）
 * - temperature?: 覆盖 config.temperature（可选）
 *
 * 响应：{ text, via: 'upstream'|'sdk' }；失败 { error } + 4xx/5xx。
 * 上游未配置/失败时自动落 z-ai-web-dev-sdk 内置模型兜底（与 /api/chat 同策略）。
 */
export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: '请求体非法' }, { status: 400 });

  const rawMsgs = Array.isArray(body.messages) ? body.messages : [];
  const messages: LLMMessage[] = [];
  for (const m of rawMsgs) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if ((role === 'system' || role === 'user' || role === 'assistant') && typeof content === 'string' && content.trim()) {
      messages.push({ role, content });
    }
  }
  if (messages.length === 0) return NextResponse.json({ error: '缺少有效的 messages' }, { status: 400 });

  let cfg = extractUpstreamConfig(body.config);
  if (cfg) {
    if (typeof body.maxTokens === 'number' && Number.isFinite(body.maxTokens) && body.maxTokens > 0) {
      cfg = { ...cfg, maxTokens: Math.min(8000, Math.max(256, Math.floor(body.maxTokens))) };
    }
    if (typeof body.temperature === 'number' && Number.isFinite(body.temperature)) {
      cfg = { ...cfg, temperature: Math.min(2, Math.max(0, body.temperature)) };
    }
  }

  try {
    const { text, via } = await completeWithFallback(cfg, messages);
    return NextResponse.json({ text, via });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '生成失败，请稍后再试' }, { status: 502 });
  }
}
