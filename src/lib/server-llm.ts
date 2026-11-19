import { NextRequest } from 'next/server';

/**
 * 服务端 LLM 调用工具（记忆提取/总结专用，与 /api/chat、/api/phone/turn 同一策略）：
 * 只使用设置 App「API 设置」里配置的 OpenAI 兼容接口（非流式，服务端代理）。
 * 内置 z-ai-web-dev-sdk 兜底已移除（v82）：未配置/上游失败直接抛中文错误，
 * 由各调用方自行降级（静默跳过或返回错误提示）。
 */

export interface UpstreamConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 从请求体提取上游配置：必须有 baseUrl（反代/中转接口可能无需 Key）。
 *  优化：baseUrl 还是默认的 api.openai.com 且没填 Key——这是「从未配置」的状态，
 *  直接当没有配置处理（null）：省掉每次注定 401 的无效往返，尽快落到 SDK 队列。 */
export function extractUpstreamConfig(raw: unknown): UpstreamConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const baseUrl = typeof r.baseUrl === 'string' ? r.baseUrl.trim() : '';
  if (!baseUrl) return null;
  const apiKey = typeof r.apiKey === 'string' ? r.apiKey.trim() : '';
  // 默认 OpenAI 地址 + 空 Key = 未配置（撞 api.openai.com 必 401，纯粹浪费一圈）
  if (!apiKey && /(^|\.)api\.openai\.com$/i.test(safeHost(baseUrl))) return null;
  return {
    baseUrl,
    apiKey,
    model: typeof r.model === 'string' && r.model.trim() ? r.model.trim() : 'gpt-4o-mini',
    temperature: typeof r.temperature === 'number' ? r.temperature : 0.7,
    maxTokens: typeof r.maxTokens === 'number' && Number.isFinite(r.maxTokens) && r.maxTokens > 0 ? Math.floor(r.maxTokens) : 2048,
  };
}

/** 从 baseUrl 提取 hostname（解析失败返回空串——当未配置处理） */
function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    try {
      return new URL(/^https?:\/\//.test(baseUrl) ? baseUrl : `https://${baseUrl}`).hostname;
    } catch {
      return '';
    }
  }
}

/** baseUrl 候选端点（与 /api/chat 一致：自动补 /v1/chat/completions、修 /v1/v1） */
function buildChatCandidates(baseUrl: string): string[] {
  const trimmed = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/(\/v\d+)\/v\d+$/, '$1')
    .replace(/(\/v\d+)\/v\d+(?=\/chat\/completions)/, '$1');
  if (trimmed.endsWith('/chat/completions')) return [trimmed];
  if (/\/v\d+$/.test(trimmed)) return [`${trimmed}/chat/completions`];
  return [`${trimmed}/v1/chat/completions`, `${trimmed}/chat/completions`];
}

interface UpstreamChoice {
  message?: { content?: unknown };
  text?: unknown;
}

/** 用户上游非流式补全；失败抛错（由调用方兜底）。429 限流时退避重试一次。 */
async function upstreamComplete(config: UpstreamConfig, messages: LLMMessage[]): Promise<string> {
  const body = JSON.stringify({
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    stream: false,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  };
  let lastErr = '';
  for (const url of buildChatCandidates(config.baseUrl)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(60_000) });
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        break; // 网络不通：换下一个候选端点
      }
      if (!res.ok) {
        if (res.status === 429 && attempt === 0) {
          // 429 限流：退避 2.5s 后同端点重试一次
          await new Promise((r) => setTimeout(r, 2500));
          continue;
        }
        lastErr = `上游 ${res.status}`;
        break; // 换下一个候选端点
      }
      const data: unknown = await res.json().catch(() => null);
      const choice = (data as { choices?: UpstreamChoice[] })?.choices?.[0];
      const content =
        (typeof choice?.message?.content === 'string' ? choice.message.content : '') ||
        (typeof choice?.text === 'string' ? choice.text : '');
      if (content.trim()) return content;
      lastErr = '上游返回空内容';
      break;
    }
  }
  throw new Error(lastErr || '上游不可用');
}

/** 统一补全入口（v82：仅用户配置的上游，无内置模型兜底）。
 * 返回 { text, via: 'upstream' }；未配置/上游失败抛中文错误（由调用方降级）。 */
export async function completeWithFallback(
  config: UpstreamConfig | null,
  _messages: LLMMessage[]
): Promise<{ text: string; via: 'upstream' }> {
  if (!config) {
    throw new Error('还没有配置 AI 接口：请先到「设置 › API 配置」填写 OpenAI 兼容的 API 地址与 API Key');
  }
  return { text: await upstreamComplete(config, _messages), via: 'upstream' };
}

/** 解析请求体 JSON（非法时返回 null） */
export async function readJsonBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 从模型回复中解析 JSON（容忍 ```json 围栏与前后杂文本） */
export function parseLooseJSON<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start < 0) return null;
  const open = cleaned[start];
  const close = open === '{' ? '}' : ']';
  const end = cleaned.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
