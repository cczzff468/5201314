import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 电话 App · 通话语音合成（TTS）
 * POST { text: string, gender?: 'male' | 'female' | null }
 * 返回 audio/wav 二进制。按对端性别挑声线：男声 xiaochen（沉稳专业），其余 tongtong（温暖亲切）。
 */

const MAX_TEXT = 900; // SDK 上限 1024，留余量

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
  const text = rawText.slice(0, MAX_TEXT);
  const gender = typeof root.gender === 'string' ? root.gender : null;
  const voice = gender === 'male' ? 'xiaochen' : 'tongtong';
  // B4 表达风格联动：语速由调用方按联系人风格下发（缺省 1；收敛到 0.5~2 防御异常值）
  const speedRaw = typeof root.speed === 'number' && Number.isFinite(root.speed) ? root.speed : 1;
  const speed = Math.min(2, Math.max(0.5, speedRaw));

  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();
    const response = await zai.audio.tts.create({
      input: text,
      voice,
      speed,
      response_format: 'wav',
      stream: false,
    });
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(new Uint8Array(arrayBuffer));
    if (buffer.length === 0) {
      return NextResponse.json({ error: '语音生成失败' }, { status: 502 });
    }
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    console.error('[phone:tts]', err);
    const detail = err instanceof Error && err.message ? err.message : '未知错误';
    return NextResponse.json({ error: `语音生成失败：${detail}` }, { status: 502 });
  }
}
