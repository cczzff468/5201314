import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 电话 App · 通话语音识别（ASR）
 * POST { audioBase64: string }（WAV 16kHz 单声道，客户端 AudioContext 解码后重采样编码）
 * 返回 { text }。
 */

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const audioBase64 = typeof root.audioBase64 === 'string' ? root.audioBase64.trim() : '';
  if (!audioBase64) {
    return NextResponse.json({ error: '缺少音频数据' }, { status: 400 });
  }
  // 60 秒 16kHz 16bit 单声道 ≈ 1.9MB ≈ base64 2.5MB，超限直接拒绝
  if (audioBase64.length > 4_000_000) {
    return NextResponse.json({ error: '录音太长，请说短一点' }, { status: 413 });
  }

  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();
    const response = await zai.audio.asr.create({ file_base64: audioBase64 });
    const text = (response?.text ?? '').trim();
    if (!text) {
      return NextResponse.json({ error: '没有听清，请再说一遍' }, { status: 200 });
    }
    return NextResponse.json({ text });
  } catch (err) {
    console.error('[phone:asr]', err);
    const detail = err instanceof Error && err.message ? err.message : '未知错误';
    return NextResponse.json({ error: `语音识别失败：${detail}` }, { status: 502 });
  }
}
