/**
 * 云端 TTS 合成（内置语音的零配置兜底，仅服务端调用）：
 * - 用平台内置 TTS 能力（z-ai-web-dev-sdk，后端专用）合成 mp3，用户无需任何 API Key；
 * - 场景：浏览器本地 speechSynthesis 引擎静音（国内安卓无中文 TTS 引擎、或只有需要连
 *   Google 服务器的网络语音且被墙）时，客户端自动降级到本通道，保证「一定有声音」；
 * - 音色：内置 6 声线映射到云端男女声（女声→tongtong 温暖亲切，男声→xiaochen 沉稳专业）；
 * - 限制：单次输入 ≤1024 字符（调用方已截断），语速 0.5~2.0（越界自动夹取）。
 */

import ZAI from 'z-ai-web-dev-sdk';

/** SDK 实例单例（复用连接，减少冷启动开销） */
let zaiPromise: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null = null;

function getZai() {
  if (!zaiPromise) zaiPromise = ZAI.create();
  return zaiPromise;
}

/**
 * 云端合成一段文本 → mp3 Buffer；失败抛中文错误（调用方决定是否透出）。
 * text 上限 1024 字符（SDK 限制），speed 夹取到 [0.5, 2.0]。
 */
export async function cloudSynthesize(text: string, voice: string, speed: number): Promise<Buffer> {
  const clipped = text.slice(0, 1024);
  const safeSpeed = Math.min(2, Math.max(0.5, Number.isFinite(speed) ? speed : 1));
  const safeVoice = voice.trim() || 'tongtong';
  try {
    const zai = await getZai();
    const res = await zai.audio.tts.create({
      input: clipped,
      voice: safeVoice,
      speed: safeSpeed,
      response_format: 'wav', // 上游仅支持 wav/pcm（mp3 会报 1214），wav 体积可接受
      stream: false,
    });
    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(new Uint8Array(arrayBuffer));
    if (buf.length === 0) throw new Error('云端语音合成返回空音频');
    return buf;
  } catch (err) {
    const msg = err instanceof Error && err.message ? err.message : String(err ?? '');
    throw new Error(`云端语音合成失败：${msg.slice(0, 120)}`);
  }
}
