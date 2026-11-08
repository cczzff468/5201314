import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 电话 App · 通话语音合成（TTS）
 * POST { text: string, gender?: 'male' | 'female' | null }
 * v82：内置 z-ai-web-dev-sdk TTS 兜底已移除——该通道依赖沙箱专属 SDK，无用户可配置的直连通道。
 * 现返回 501 与说明；前端 catch 后回退浏览器本地朗读（speechSynthesis）并提示。
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const rawText = typeof root.text === 'string' ? root.text.trim() : '';
  if (!rawText) {
    return NextResponse.json({ error: '缺少文本' }, { status: 400 });
  }
  void rawText; // 仅为参数校验保留
  return NextResponse.json(
    { error: '通话语音合成已下线（内置语音服务已移除）；将使用浏览器本地朗读' },
    { status: 501 }
  );
}
