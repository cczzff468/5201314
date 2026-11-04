/**
 * 语音识别（STT）客户端：语音消息「转文字」服务端兑底链路（微信/QQ/信息/群聊）。
 * - 识别主通道是 Web Speech（浏览器原生实时识别，见 web-speech.ts）：录音按住期间内置转文字，
 *   语音消息发送时直接附带 transcript；内置识别模型（z-ai ASR）已移除；
 * - 本模块仅在「设置 App 配置了 OpenAI 兼容服务商（/audio/transcriptions）」时启用：
 *   长按旧语音气泡转文字（无实时识别文本时）/ 实时识别失败的服务端兑底 / 录音文件转写；
 * - 配置来源：设置 App「语音 API › 语音识别 STT」（useSettings.sttConfig），每次调用现场读取
 *   → 保存即生效，无需重启；与 TTS 配置相互独立、互不覆盖；
 * - openai：原始录音 Blob 以 multipart 交给 /api/stt，由服务端转发到 OpenAI 兼容 /audio/transcriptions
 *   （Key 只随请求体/表单发给本站代理，不进日志、不出现在前端存储之外的任何地方）；
 * - 失败抛错（中文文案），调用方决定提示方式——不影响文字聊天
 */

import { useSettings, type SttConfig } from './store';
import { isOfflineAsrReady, offlineAsrTranscribe } from './offline-asr';

export type { SttConfig } from './store';

/**
 * fetch + 超时看门狗（#20）：上游卡住时到点必失败，不无限等待。
 * AbortSignal.timeout 到点抛 DOMException TimeoutError（message 各浏览器不一致）——
 * 错误文本可能直接进 UI/气泡，统一映射成友好中文再抛出。
 */
async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeoutMs = 60000): Promise<Response> {
  try {
    return await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name ?? '';
    const msg = err instanceof Error ? err.message : String(err ?? '');
    if (name === 'TimeoutError' || /timeout|timed out/i.test(msg)) {
      throw new Error('请求超时，请检查网络或稍后再试');
    }
    throw err;
  }
}

/**
 * 服务端识别是否可用：内置识别模型已移除（builtin 恒为 false）——
 * 仅在设置 App 配置了 OpenAI 兼容服务商（地址 + Key）时可用；
 * 未配置时识别一律走 Web Speech（浏览器原生实时识别），录音文件转写不可用。 */
export function isSttReady(cfg?: SttConfig): boolean {
  const c = cfg ?? useSettings.getState().sttConfig;
  if (c.provider !== 'openai') return false;
  return Boolean(c.apiKey.trim() && c.baseUrl.trim());
}

/**
 * 把录音 Blob 转成文字。空结果返回 ''（调用方按失败处理）。
 * 失败抛 Error（中文文案，不回显 Key）。
 *
 * 优先级（已验证的离线方案）：端侧模型已就绪 → 本地 WASM（SenseVoice）识别，断网可用；
 * 本地失败/无文本 → 静默降级云端 STT（需已配置服务商）；云端也失败才抛错。
 */
export async function transcribeAudioBlob(blob: Blob): Promise<string> {
  // ① 端侧离线识别（零配置、断网可用）：失败静默降级，不阻塞云端兑底
  if (isOfflineAsrReady()) {
    try {
      const localText = await offlineAsrTranscribe(blob);
      if (localText) return localText;
    } catch {
      // 本地引擎失败（初始化中/解码异常/超时）：静默降级云端
    }
  }

  // ② 云端 STT（需配置 OpenAI 兼容服务商）
  const cfg = useSettings.getState().sttConfig;
  if (!isSttReady(cfg)) {
    throw new Error('请先配置语音识别（STT）或下载离线识别模型');
  }
  const configPart = { provider: 'openai' as const, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model };

  // OpenAI 兼容：multipart 原样转发（webm/m4a whisper 系直接吃）
  const fd = new FormData();
  fd.append('config', JSON.stringify(configPart));
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  fd.append('audio', blob, `voice.${ext}`);
  // #20 通话链路超时看门狗：识别请求 60s 到点必失败
  const res = await fetchWithTimeout('/api/stt', { method: 'POST', body: fd }, 60000);

  if (!res.ok) {
    let msg = '转文字失败，请重试';
    try {
      const j = (await res.json()) as { error?: string } | null;
      if (j?.error) msg = j.error;
    } catch {
      // 非 JSON 错误体用默认文案
    }
    throw new Error(msg);
  }
  const j = (await res.json()) as { text?: string };
  return typeof j.text === 'string' ? j.text.trim() : '';
}

/**
 * 直发语音的自动转写（AI 感知用，五端共用）：
 * 录音期间 Web Speech 实时识别已在结果上附带 transcript（发送方优先使用，零服务端）；
 * 本函数是缺 transcript 时的服务端兑底（仅 OpenAI 兼容 STT 配置后可用；内置识别已移除）：
 * 成功 → 回填 transcript，AI 当轮就能读到内容；失败 / 超时 / 未配置 → 返回空串，
 * AI 按「语音占位」防编造规则回应，绝不假装听过。不抛错，调用方无需 try/catch。
 */
export async function autoTranscribeForAi(blob: Blob | undefined, timeoutMs = 20000): Promise<string> {
  if (!blob) return '';
  // 端侧离线优先（就绪即用，零成本零延迟无外发流量）
  if (isOfflineAsrReady()) {
    try {
      const localText = await Promise.race([
        offlineAsrTranscribe(blob),
        new Promise<string>((_, rej) => window.setTimeout(() => rej(new Error('离线识别超时')), timeoutMs)),
      ]);
      if (localText.trim()) return localText.trim();
    } catch {
      // 本地失败静默降级云端
    }
  }
  if (!isSttReady()) return '';
  try {
    const text = await Promise.race([
      transcribeAudioBlob(blob),
      new Promise<string>((_, rej) => window.setTimeout(() => rej(new Error('转文字超时')), timeoutMs)),
    ]);
    const cleaned = text.trim();
    // 过滤 ASR 对静音/噪声的典型无意义输出（纯符号，如 "#"、"…"），避免当成有效转写
    if (!cleaned || /^[#\s*_\-.,!?~。？！，、…—·]+$/.test(cleaned)) return '';
    return cleaned;
  } catch {
    return '';
  }
}
