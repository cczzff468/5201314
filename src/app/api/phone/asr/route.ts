import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 电话 App · 通话语音识别（ASR）
 * POST { audioBase64: string }（WAV 16kHz 单声道，客户端 AudioContext 解码后重采样编码）
 * v82：内置 z-ai-web-dev-sdk ASR 兜底已移除——该通道依赖沙箱专属 SDK。
 * 识别链降级为：① SenseVoice 端侧模型（离线）→ ② 用户配置的云端 STT（设置 › 语音识别）；
 * 两者都不可用时语音输入返回错误（键盘输入不受影响）。
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
  return NextResponse.json(
    {
      error:
        '内置语音识别已下线：请在 设置 › 语音识别 里下载离线识别模型（SenseVoice）或配置云端 STT；也可以改用键盘输入',
    },
    { status: 501 }
  );
}
