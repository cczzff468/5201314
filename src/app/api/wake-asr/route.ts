import { NextRequest, NextResponse } from 'next/server';

/**
 * 唤醒监听 · 服务端识别（POST /api/wake-asr）——喊名唤醒的浏览器兜底通道专用：
 *
 * 背景：浏览器端连续唤醒监听的三条通道（见 agent-voice.ts useAgentWakeLoop）——
 * ① 离线端侧转写（APK 已下载模型时首选）；② Web Speech 实时识别（Chrome 内置，但语音服务
 * 走 Google，大陆网络不可达 → 持续 network 错误形同虚设）；③ 本路由：前端 VAD 检测到说话
 * 才录一小段（3~4s）→ 16k WAV → base64 交到这里 → z-ai ASR 转写 → 前端匹配唤醒名。
 * 安静环境零请求、说一句才发一次，不烧额度也不受 Google 可达性影响。
 *
 * 请求体（JSON）：{ audio: "<16k 单声道 WAV 的 base64>" }（≤2.8MB ≈ 87s，唤醒片段通常 3~4s）
 * 返回：{ text }；失败 { error }（中文文案）。识别失败/空结果 text 为空串，由前端判 unmatched。
 */

export const runtime = 'nodejs';

/** base64 最大长度（2.8MB ≈ 87s 16k 单声道 16bit WAV；正常唤醒片段 3~4s ≈ 190KB base64） */
const MAX_AUDIO_BASE64 = 2_800_000;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { audio?: unknown } | null;
    const audio = typeof body?.audio === 'string' ? body.audio : '';
    if (!audio || audio.length > MAX_AUDIO_BASE64) {
      return NextResponse.json({ error: '音频数据无效或过大' }, { status: 400 });
    }
    const { default: ZAI } = await import('z-ai-web-dev-sdk');
    const zai = await ZAI.create();
    const r = (await zai.audio.asr.create({ file_base64: audio })) as { text?: unknown };
    const text = typeof r?.text === 'string' ? r.text.trim() : '';
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '服务端识别失败，请稍后再试' },
      { status: 502 },
    );
  }
}
