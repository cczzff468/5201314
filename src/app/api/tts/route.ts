import { NextRequest, NextResponse } from 'next/server';

/**
 * 语音 API · 文本转语音代理（POST /api/tts）
 * POST { config: { provider, baseUrl, apiKey, groupId?, model? }, voiceId: string, text: string, speed?: number }
 * 返回 audio/mpeg 二进制；失败返回 JSON { error }（中文文案，不回显 API Key）。
 * 配置由前端「设置 › 语音 API」下发，保存后下一次请求即生效（无缓存、无重启）。
 *
 * provider='server'：零配置云端合成兜底（内置 SDK，无需任何 Key）——本地 speechSynthesis
 * 引擎静音（国内安卓常见）时由客户端自动降级调用，保证语音功能「一定有声音」。 */

import { fishaudioSynthesize, minimaxSynthesize, openaiSynthesize, type TtsProvider, type TtsUpstreamConfig } from '@/lib/server-tts';
import { cloudSynthesize } from '@/lib/server/cloud-tts';

export const runtime = 'nodejs';

const MAX_TEXT = 1000;
const PROVIDERS: TtsProvider[] = ['minimax', 'openai', 'fishaudio'];

/** 各服务商的程序安全默认音色（角色/全局都没配时的兜底）；fishaudio 留空 = 平台默认音色 */
export const SAFE_VOICE: Record<TtsProvider, string> = {
  minimax: 'female-shaonv',
  openai: 'alloy',
  fishaudio: '',
};

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const cfgRoot = typeof root.config === 'object' && root.config !== null ? (root.config as Record<string, unknown>) : {};

  const provider = PROVIDERS.includes(cfgRoot.provider as TtsProvider) ? (cfgRoot.provider as TtsProvider) : null;
  // ---- 零配置云端合成兜底（provider='server'，无需 baseUrl/apiKey）----
  if (cfgRoot.provider === 'server') {
    const text = typeof root.text === 'string' ? root.text.trim().slice(0, MAX_TEXT) : '';
    if (!text) return NextResponse.json({ error: '缺少文本' }, { status: 400 });
    const voiceId = typeof root.voiceId === 'string' ? root.voiceId.trim().slice(0, 200) : '';
    const speedRaw = typeof root.speed === 'number' && Number.isFinite(root.speed) ? root.speed : 1;
    try {
      const buffer = await cloudSynthesize(text, voiceId, speedRaw);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': String(buffer.length),
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : '未知错误';
      return NextResponse.json({ error: detail }, { status: 502 });
    }
  }
  if (!provider) {
    return NextResponse.json({ error: '不支持的服务商' }, { status: 400 });
  }
  const text = typeof root.text === 'string' ? root.text.trim().slice(0, MAX_TEXT) : '';
  if (!text) {
    return NextResponse.json({ error: '缺少文本' }, { status: 400 });
  }
  const voiceId = typeof root.voiceId === 'string' ? root.voiceId.trim().slice(0, 200) : '';
  // Fish Audio 允许空音色（/v1/tts 不带 reference_id = 平台默认音色）；其余服务商必须带
  if (!voiceId && provider !== 'fishaudio') {
    return NextResponse.json({ error: '缺少音色' }, { status: 400 });
  }
  const speedRaw = typeof root.speed === 'number' && Number.isFinite(root.speed) ? root.speed : 1;
  const speed = Math.min(2, Math.max(0.5, speedRaw));

  const cfg: TtsUpstreamConfig = {
    provider,
    baseUrl: typeof cfgRoot.baseUrl === 'string' ? cfgRoot.baseUrl : '',
    apiKey: typeof cfgRoot.apiKey === 'string' ? cfgRoot.apiKey : '',
    groupId: typeof cfgRoot.groupId === 'string' ? cfgRoot.groupId : '',
    model: typeof cfgRoot.model === 'string' ? cfgRoot.model : '',
  };
  const voice = voiceId || SAFE_VOICE[provider];

  try {
    const buffer =
      provider === 'minimax'
        ? await minimaxSynthesize(cfg, text, voice, speed)
        : provider === 'fishaudio'
          ? await fishaudioSynthesize(cfg, text, voice, speed)
          : await openaiSynthesize(cfg, text, voice, speed);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    // 安全：只透出错误文案，绝不打印 config/apiKey
    const detail = err instanceof Error && err.message ? err.message : '未知错误';
    return NextResponse.json({ error: detail }, { status: 502 });
  }
}
