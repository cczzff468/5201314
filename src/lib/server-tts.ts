/**
 * 语音 API 服务端共享层（/api/tts 路由）：
 * - MiniMax（t2a_v2 合成）、OpenAI 兼容（audio/speech）、Fish Audio（/v1/tts，reference_id 即音色）三类服务商
 * - node:https 强制 IPv4：沙箱 undici 对含 AAAA 记录的主机有 IPv6 回退缺陷（同天气路由）
 * - 安全：API Key 只在内存里转发，绝不写日志；上游错误透出业务文案不透出 Key
 */

import http from 'node:http';
import https from 'node:https';

export type TtsProvider = 'minimax' | 'openai' | 'fishaudio';

export interface TtsUpstreamConfig {
  provider: TtsProvider;
  baseUrl: string;
  apiKey: string;
  /** MiniMax 专属：账户 GroupId（t2a_v2 合成必填） */
  groupId?: string;
  model?: string;
}

/** 归一化 URL：去空白；非法/非 http(s) 返回 null（避免 SSRF 到 file: 等协议） */
export function normalizeTtsBaseUrl(raw: string): string | null {
  const t = raw.trim().replace(/\/+$/, '');
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}

/**
 * OpenAI 兼容：拼 audio/speech 端点。
 * 用户可能填 https://api.openai.com/v1、https://xxx/v1 或完整端点——三种都兼容：
 * 已含 audio/speech 原样用；以 /v1 结尾追加 /audio/speech；否则追加 /v1/audio/speech。
 */
export function openaiSpeechUrl(base: string): string {
  if (/audio\/speech/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/audio/speech`;
  return `${base}/v1/audio/speech`;
}

/** MiniMax：拼 /v1 端点（用户填的 base 可能带 /v1 也可能不带） */
export function minimaxUrl(base: string, path: string): string {
  const stripped = /\/v1$/i.test(base) ? base.replace(/\/v1$/, '') : base;
  return `${stripped}/v1/${path}`;
}

/** Fish Audio：拼 /v1 端点（官方 base=https://fishaudio.org/v1，TTS=/v1/tts）；
 *  用户可能填 https://fishaudio.org、https://fishaudio.org/v1 或完整端点——三种都兼容 */
export function fishAudioUrl(base: string, path: string): string {
  const stripped = /\/v1$/i.test(base) ? base.replace(/\/v1$/, '') : base;
  return `${stripped}/v1/${path}`;
}

// ---------------- node:https 强制 IPv4 请求 ----------------

interface HttpsOptions {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string | Buffer;
  timeoutMs: number;
}

/** 返回 {status, json} 或 {status, binary}；非 2xx 也返回（由调用方决定错误文案）。
 *  https 用 node:https 强制 IPv4；http（本地/局域网 TTS/STT 服务器）走 node:http。
 *  导出给 /api/stt 的 OpenAI 兼容 multipart 转发复用（body 可为 Buffer）。 */
export function httpsRequest(opts: HttpsOptions): Promise<{ status: number; json: unknown; binary: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(opts.url);
    const isHttps = u.protocol === 'https:';
    if (!isHttps && u.protocol !== 'http:') {
      reject(new Error('API 地址协议必须是 http(s)'));
      return;
    }
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        method: opts.method,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        // 统一强制 IPv4：部分环境 localhost 解析为 ::1 而上游只绑 IPv4（或 IPv6 不可达）时会拒连
        family: 4,
        headers: opts.headers,
        signal: AbortSignal.timeout(opts.timeoutMs),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const binary = Buffer.concat(chunks);
          const contentType = String(res.headers['content-type'] ?? '');
          let json: unknown = null;
          if (/json/i.test(contentType) || (!contentType && /^\s*[[{]/.test(binary.toString('utf8', 0, 32)))) {
            try {
              json = JSON.parse(binary.toString('utf8'));
            } catch {
              json = null;
            }
          }
          resolve({ status, json, binary, contentType });
        });
      }
    );
    req.on('error', (e) => {
      // Node 的连接类错误 message 常为空串，统一映射成可读中文文案
      const code = typeof (e as NodeJS.ErrnoException)?.code === 'string' ? (e as NodeJS.ErrnoException).code : '';
      let msg = e instanceof Error && e.message ? e.message : '';
      if (code === 'ECONNREFUSED') msg = '无法连接到服务商服务器，请检查 API 地址与端口';
      else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') msg = 'API 地址的域名无法解析，请检查拼写';
      else if (code === 'ETIMEDOUT' || /timeout/i.test(msg)) msg = '连接服务商超时，请稍后重试';
      else if (!msg) msg = '网络请求失败';
      reject(new Error(msg));
    });
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/** MiniMax t2a_v2 合成：返回 mp3 Buffer；失败抛中文错误 */
export async function minimaxSynthesize(cfg: TtsUpstreamConfig, text: string, voiceId: string, speed: number): Promise<Buffer> {
  const base = normalizeTtsBaseUrl(cfg.baseUrl);
  if (!base) throw new Error('API 地址无效');
  if (!cfg.apiKey.trim()) throw new Error('请先填写 API Key');
  if (!cfg.groupId?.trim()) throw new Error('MiniMax 需要填写 GroupId（在 MiniMax 控制台「账户管理」里查看）');
  const url = `${minimaxUrl(base, 't2a_v2')}?GroupId=${encodeURIComponent(cfg.groupId.trim())}`;
  const payload = {
    model: cfg.model?.trim() || 'speech-01-turbo',
    text,
    stream: false,
    voice_setting: { voice_id: voiceId, speed, vol: 1, pitch: 0 },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
  };
  const res = await httpsRequest({
    method: 'POST',
    url,
    headers: {
      Authorization: `Bearer ${cfg.apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    timeoutMs: 60_000,
  });
  const root = res.json as { data?: { audio?: unknown }; base_resp?: { status_code?: number; status_msg?: string } } | null;
  const status = root?.base_resp?.status_code;
  if (status !== undefined && status !== 0) {
    throw new Error(`MiniMax 合成失败（${status}）：${root?.base_resp?.status_msg || '未知错误'}`);
  }
  const audioRaw = root?.data?.audio;
  if (typeof audioRaw === 'string' && audioRaw.length > 0) {
    const buf = hexOrBase64ToBuffer(audioRaw);
    if (buf && buf.length > 0) return buf;
    throw new Error('MiniMax 返回了无法解析的音频数据');
  }
  if (res.status >= 400) throw new Error(upstreamStatusMessage(res.status));
  throw new Error('MiniMax 未返回音频数据');
}

/** OpenAI 兼容 audio/speech 合成：返回音频 Buffer（mp3）；模型名留空 = 不发送 model 字段（部分服务商不需要模型） */
export async function openaiSynthesize(cfg: TtsUpstreamConfig, text: string, voiceId: string, speed: number): Promise<Buffer> {
  const base = normalizeTtsBaseUrl(cfg.baseUrl);
  if (!base) throw new Error('API 地址无效');
  if (!cfg.apiKey.trim()) throw new Error('请先填写 API Key');
  const model = cfg.model?.trim();
  const payload: Record<string, unknown> = { input: text, voice: voiceId, response_format: 'mp3', speed };
  if (model) payload.model = model;
  const res = await httpsRequest({
    method: 'POST',
    url: openaiSpeechUrl(base),
    headers: {
      Authorization: `Bearer ${cfg.apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    timeoutMs: 60_000,
  });
  if (res.status >= 400) {
    const err = res.json as { error?: { message?: string } | string } | null;
    const msg = typeof err?.error === 'string' ? err.error : err?.error?.message;
    throw new Error(msg ? `合成失败：${msg}` : upstreamStatusMessage(res.status));
  }
  if (res.binary.length === 0) throw new Error('服务商未返回音频数据');
  return res.binary;
}

// ---------------- 工具 ----------------

/** Fish Audio /v1/tts 合成：reference_id 即音色模型 ID（留空 = Fish Audio 平台默认音色）；
 *  返回 mp3 Buffer（响应体就是音频二进制）；当前接口不支持语速参数（speed 保留签名兼容统一调用） */
export async function fishaudioSynthesize(cfg: TtsUpstreamConfig, text: string, voiceId: string, speed: number): Promise<Buffer> {
  void speed; // Fish Audio /v1/tts 无语速字段；参数保留以统一三服务商调用签名
  const base = normalizeTtsBaseUrl(cfg.baseUrl);
  if (!base) throw new Error('API 地址无效');
  if (!cfg.apiKey.trim()) throw new Error('请先填写 API Key');
  const payload: Record<string, unknown> = {
    text,
    format: 'mp3',
    mp3_bitrate: 128,
    chunk_length: 200,
    normalize: true,
    latency: 'normal',
  };
  const ref = voiceId.trim();
  if (ref) payload.reference_id = ref; // 留空 = 平台默认音色（客户端/服务端兜底链都不配音色时依然能出声）
  const res = await httpsRequest({
    method: 'POST',
    url: fishAudioUrl(base, 'tts'),
    headers: {
      Authorization: `Bearer ${cfg.apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    timeoutMs: 60_000,
  });
  if (res.status >= 400) {
    const err = res.json as { message?: string } | null;
    throw new Error(err?.message ? `Fish Audio 合成失败：${err.message}` : upstreamStatusMessage(res.status));
  }
  if (res.binary.length === 0) throw new Error('Fish Audio 未返回音频数据');
  return res.binary;
}

// ---------------- 工具（解码/通用解析） ----------------

/** 十六进制 / base64 自适应解码（MiniMax t2a_v2 历史上返回 hex，兼容个别 base64 返回） */
function hexOrBase64ToBuffer(s: string): Buffer | null {
  const t = s.trim();
  if (!t) return null;
  if (/^[0-9a-fA-F]+$/.test(t) && t.length % 2 === 0) {
    return Buffer.from(t, 'hex');
  }
  try {
    const b = Buffer.from(t, 'base64');
    return b.length > 0 ? b : null;
  } catch {
    return null;
  }
}

/** 上游 HTTP 状态 → 中文文案（不含任何 Key 信息） */
export function upstreamStatusMessage(status: number): string {
  if (status === 401 || status === 403) return 'API Key 无效或无权限';
  if (status === 404) return '接口路径不存在，请检查 API 地址';
  if (status === 429) return '请求频率超限，请稍后再试';
  if (status >= 500) return '服务商服务器暂时不可用';
  return `服务商返回错误（${status}）`;
}
