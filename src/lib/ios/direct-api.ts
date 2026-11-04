'use client';

/**
 * 浏览器直连 OpenAI 兼容 API 工具。
 *
 * 背景：本项目前端部署在云端，服务器端代理（/api/chat、/api/settings/*）无法访问
 * 用户所在局域网的 API（如手机/家庭内网跑的网关 http://192.168.1.5:7863/v1）。
 * 对这类地址，改由「用户的浏览器」直接请求目标 API（同网可达），并解析 SSE 流。
 * 若网关未开启跨域（CORS），直连会失败并给出针对性提示。
 */

import type { ApiConfig } from '@/lib/ios/store';

// ---------------- 地址判断 ----------------

/** 是否私有/本机地址（云端服务器大概率不可达，需浏览器直连） */
export function isPrivateApiUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl.trim()).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) return true;
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

// ---------------- 端点归一化（与 /api/chat 服务器端逻辑一致） ----------------

/** baseUrl 归一化候选：完整端点 / /v1 结尾 / 裸域名，自动修 /v1/v1 */
function buildCandidates(baseUrl: string, suffix: 'chat/completions' | 'models'): string[] {
  const trimmed = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/(\/v\d+)\/v\d+$/, '$1')
    .replace(/(\/v\d+)\/v\d+(?=\/chat\/completions)/, '$1');
  const stripMarker = (u: string): string => {
    const idx = u.indexOf('chat/completions');
    return idx === -1 ? u : u.slice(0, idx).replace(/\/+$/, '');
  };
  const base = suffix === 'chat/completions' ? trimmed : stripMarker(trimmed);
  if (base.endsWith(`/${suffix}`)) return [base];
  if (/\/v\d+$/.test(base)) return [`${base}/${suffix}`];
  return [`${base}/v1/${suffix}`, `${base}/${suffix}`];
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
  };
}

/** 直连失败的统一友好提示（fetch 抛错 = 网络不通或 CORS 拦截，两者无法区分；本机网关给出针对性指引） */
export function directFetchErrorHint(rawUrl?: string): string {
  try {
    const host = rawUrl ? new URL(rawUrl.trim()).hostname.toLowerCase() : '';
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return '浏览器直连失败：本机网关需允许跨域（CORS）——LM Studio 开启「Enable CORS」；Ollama 设 OLLAMA_ORIGINS=*；其他网关请开启跨域支持';
    }
  } catch {
    // URL 解析失败用通用提示
  }
  return '浏览器直连失败：请确认当前设备与该 API 在同一网络，且 API 已允许跨域访问（CORS）';
}

// ---------------- 测试连接（非流式，极小请求） ----------------

export interface DirectTestResult {
  ok: boolean;
  latencyMs: number;
  model: string;
  error?: string;
}

export async function directTest(config: ApiConfig, timeoutMs = 20000): Promise<DirectTestResult> {
  const model = config.model.trim() || 'gpt-4o-mini';
  const candidates = buildCandidates(config.baseUrl, 'chat/completions');

  // 参数兼容（与服务器端 /api/settings/test 一致）：新模型要求 max_completion_tokens、只支持默认温度
  let useMaxCompletion = false;
  let curTemperature: number | undefined = config.temperature;

  let lastErr: unknown = null;
  for (const url of candidates) {
    // 参数兼容重试：最多 3 次（原始 → 换 max_completion_tokens → 去掉 temperature）
    for (let attempt = 0; attempt < 3; attempt++) {
      const body = JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        ...(curTemperature === undefined ? {} : { temperature: curTemperature }),
        ...(useMaxCompletion ? { max_completion_tokens: 16 } : { max_tokens: 16 }),
        stream: false,
      });
      const startedAt = Date.now();
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: authHeaders(config.apiKey),
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const latencyMs = Date.now() - startedAt;
        if (res.ok) return { ok: true, latencyMs, model };
        // 读错误体给出具体原因（401/403/404/429…）
        const raw = await res.text().catch(() => '');
        let msg = '';
        try {
          const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
          if (typeof parsed.error === 'string') msg = parsed.error;
          else if (parsed.error && typeof parsed.error === 'object' && typeof (parsed.error as { message?: unknown }).message === 'string') {
            msg = (parsed.error as { message: string }).message;
          } else if (typeof parsed.message === 'string') msg = parsed.message;
        } catch {
          // 非 JSON
        }
        if (res.status === 400) {
          // 按上游提示逐项调整后重试
          if (!useMaxCompletion && /max_completion_tokens|unsupported parameter.{0,40}max_tokens/i.test(msg)) {
            useMaxCompletion = true;
            continue;
          }
          if (curTemperature !== undefined && /temperature/i.test(msg)) {
            curTemperature = undefined;
            continue;
          }
        }
        const friendly =
          res.status === 401
            ? 'API Key 无效或未授权（401）'
            : res.status === 404
              ? '接口路径或模型不存在（404），请检查 API 地址与模型名'
              : msg || raw.slice(0, 160) || `上游接口返回 ${res.status}`;
        return { ok: false, latencyMs, model, error: friendly };
      } catch (err) {
        lastErr = err;
        // CORS 兑底：改用「简单请求」（text/plain、不带 Authorization，本地网关通常不需要 Key），
        // 不触发预检 OPTIONS。能拉取模型（GET 简单请求）但 POST 被预检拦住的网关可由此修复。
        try {
          const res2 = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (res2.ok) return { ok: true, latencyMs: Date.now() - startedAt, model };
          if (res2.status === 400) {
            // 兑底路径同样支持参数兼容重试（换 max_completion_tokens / 去温度）
            const raw2 = await res2.text().catch(() => '');
            let msg2 = '';
            try {
              const p2 = JSON.parse(raw2) as { error?: unknown; message?: unknown };
              if (typeof p2.error === 'string') msg2 = p2.error;
              else if (p2.error && typeof p2.error === 'object' && typeof (p2.error as { message?: unknown }).message === 'string') {
                msg2 = (p2.error as { message: string }).message;
              } else if (typeof p2.message === 'string') msg2 = p2.message;
            } catch {
              msg2 = raw2.slice(0, 160);
            }
            if (!useMaxCompletion && /max_completion_tokens|unsupported parameter.{0,40}max_tokens/i.test(msg2)) {
              useMaxCompletion = true;
              continue;
            }
            if (curTemperature !== undefined && /temperature/i.test(msg2)) {
              curTemperature = undefined;
              continue;
            }
          }
        } catch {
          // 兑底也失败：换下一个候选
        }
        break; // 网络不通：换下一个候选
      }
    }
  }
  return {
    ok: false,
    latencyMs: 0,
    model,
    error: lastErr instanceof Error && /timeout|abort/i.test(lastErr.message)
      ? '浏览器直连超时：地址不可达或网络受限'
      : directFetchErrorHint(config.baseUrl),
  };
}

// ---------------- 拉取模型 ----------------

/** 从任意形态的模型列表响应提取 id（{data:[...]} / {models:[...]} / 裸数组） */
function extractModelIds(payload: unknown): string[] {
  const ids: string[] = [];
  const push = (item: unknown): void => {
    if (typeof item === 'string') {
      if (item && !ids.includes(item)) ids.push(item);
      return;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const id = obj.id ?? obj.name ?? obj.model;
      if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);
    }
  };
  if (Array.isArray(payload)) payload.forEach(push);
  else if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.data)) obj.data.forEach(push);
    else if (Array.isArray(obj.models)) obj.models.forEach(push);
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

/** 浏览器直连拉取模型列表；接口可达但无模型列表时返回空数组 + hint */
export async function directFetchModels(
  baseUrl: string,
  apiKey: string,
  timeoutMs = 15000
): Promise<{ models: string[]; error?: string; hint?: string }> {
  const candidates = buildCandidates(baseUrl, 'models');
  const headers: Record<string, string> = {};
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;

  let lastErr: unknown = null;
  let sawAnyResponse = false;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
      sawAnyResponse = true;
      if (res.status === 401) return { models: [], error: 'API Key 无效或未授权（401）' };
      if (res.status === 404 || res.status === 405 || res.status === 501) {
        // 该路径不存在：尝试下一个候选（很多网关只有 chat/completions）
        continue;
      }
      if (!res.ok) return { models: [], error: `服务返回异常（HTTP ${res.status}）` };
      const payload: unknown = await res.json().catch(() => null);
      if (!payload) continue;
      const models = extractModelIds(payload);
      if (models.length > 0) return { models };
      return {
        models: [],
        hint: '该 API 未提供模型列表接口，不影响聊天使用；请直接手动填写模型名。',
      };
    } catch (err) {
      lastErr = err;
    }
  }
  if (sawAnyResponse) {
    // 有响应但都没解析出模型（多候选全 404 等）：优雅降级为手动填写，不误报网络错误
    return {
      models: [],
      hint: '该 API 未提供模型列表接口，不影响聊天使用；请直接手动填写模型名。',
    };
  }
  return {
    models: [],
    error:
      lastErr instanceof Error && /timeout|abort/i.test(lastErr.message)
        ? '浏览器直连超时：地址不可达或网络受限'
        : directFetchErrorHint(baseUrl),
  };
}

// ---------------- 识图（非流式多模态，图片理解用） ----------------

/** 从非流式多模态响应提取文本（复用 pickDelta：兼容 string / 分段数组两种 content） */
function pickVisionText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  const choices = Array.isArray(obj.choices) ? obj.choices : [];
  const first: unknown = choices[0];
  if (first && typeof first === 'object') {
    const rec = first as { message?: unknown; delta?: unknown };
    const t = pickDelta(rec.message) || pickDelta(rec.delta);
    if (t) return t;
  }
  if (typeof obj.content === 'string') return obj.content;
  if (typeof obj.response === 'string') return obj.response;
  return '';
}

/**
 * 浏览器直连识图：把图片（data URL）作为多模态 user 消息发给用户配置的接口，
 * 非流式取回描述文本。与 directTest 同款兜底（CORS 简单请求重试）与 400 参数兼容重试。
 */
export async function directVisionDescribe(
  config: Pick<ApiConfig, 'baseUrl' | 'apiKey' | 'model'>,
  images: string[],
  text: string,
  systemPrompt: string,
  timeoutMs = 60000
): Promise<string> {
  const model = config.model.trim();
  const candidates = buildCandidates(config.baseUrl, 'chat/completions');
  const content: unknown[] = [
    { type: 'text', text: text.trim() || '请描述这张图片' },
    ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
  const body = JSON.stringify({
    ...(model ? { model } : {}),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ],
    max_tokens: 512,
    stream: false,
  });

  /** 从非 2xx 响应提取错误 message（同 directTest） */
  const readError = async (res: Response): Promise<string> => {
    const raw = await res.text().catch(() => '');
    try {
      const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
      if (typeof parsed.error === 'string') return parsed.error;
      if (parsed.error && typeof parsed.error === 'object' && typeof (parsed.error as { message?: unknown }).message === 'string') {
        return (parsed.error as { message: string }).message;
      }
      if (typeof parsed.message === 'string') return parsed.message;
    } catch {
      // 非 JSON
    }
    return raw.slice(0, 160);
  };

  let lastErr: unknown = null;
  for (const url of candidates) {
    // 参数兼容重试：最多 3 次（原始 → 换 max_completion_tokens → 去 temperature——识图本就不带温度，保留结构对齐）
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: authHeaders(config.apiKey),
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastErr = err;
        // CORS 兜底：简单请求（text/plain、不带 Authorization）避开预检
        try {
          const res2 = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (res2.ok) return pickVisionText(await res2.json().catch(() => null));
        } catch {
          // 兜底也失败：换下一个候选
        }
        break; // 网络不通：换下一个候选
      }
      if (!res.ok) {
        const msg = await readError(res);
        if (res.status === 400 && attempt === 0 && /max_completion_tokens|unsupported parameter.{0,40}max_tokens/i.test(msg)) {
          // 新模型拒绝 max_tokens：改用 max_completion_tokens 重试一次
          const retryBody = JSON.stringify({
            ...(model ? { model } : {}),
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content },
            ],
            max_completion_tokens: 512,
            stream: false,
          });
          try {
            const res2 = await fetch(url, {
              method: 'POST',
              headers: authHeaders(config.apiKey),
              body: retryBody,
              signal: AbortSignal.timeout(timeoutMs),
            });
            if (res2.ok) return pickVisionText(await res2.json().catch(() => null));
          } catch {
            // 重试失败走统一错误
          }
        }
        throw new Error(
          res.status === 401
            ? 'API Key 无效或未授权（401）'
            : res.status === 404
              ? '接口路径或模型不存在（404），请检查识图 API 地址与模型名'
              : msg || `识图接口返回 ${res.status}`
        );
      }
      const text2 = pickVisionText(await res.json().catch(() => null));
      if (text2.trim()) return text2.trim();
      throw new Error('识图接口返回了空内容');
    }
  }
  throw new Error(
    lastErr instanceof Error && /timeout|abort/i.test(lastErr.message)
      ? '识图直连超时：地址不可达或网络受限'
      : directFetchErrorHint(config.baseUrl)
  );
}

// ---------------- 聊天（SSE 流式） ----------------

interface DirectChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** 从 SSE chunk 提取增量文本（兼容 delta / message / 多模态分段） */
function pickDelta(part: unknown): string {
  if (typeof part !== 'object' || part === null) return '';
  const content = (part as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string'
          ? (p as { text: string }).text
          : ''
      )
      .join('');
  }
  return '';
}

function extractDeltaText(chunk: unknown): string {
  if (typeof chunk !== 'object' || chunk === null) return '';
  let choices = (chunk as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) choices = [chunk];
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first: unknown = choices[0];
  if (typeof first !== 'object' || first === null) return '';
  const rec = first as { delta?: unknown; message?: unknown };
  return pickDelta(rec.delta) || pickDelta(rec.message);
}

/**
 * 浏览器直连流式聊天：请求上游 SSE，逐段回调 onDelta（增量），返回完整文本。
 * 上游返回非流式 JSON / 纯文本时也能解析（一次性回调）。
 */
export async function directChatStream(
  config: ApiConfig,
  messages: DirectChatMessage[],
  onDelta: (delta: string) => void,
  timeoutMs = 120000
): Promise<string> {
  const model = config.model.trim() || 'gpt-4o-mini';
  const candidates = buildCandidates(config.baseUrl, 'chat/completions');

  // 参数兼容（与服务器端 /api/chat 一致）：按上游 400 报错换 max_completion_tokens / 去温度后重试
  let useMaxCompletion = false;
  let curTemperature: number | undefined = config.temperature;

  const makeBody = (): string =>
    JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      ...(curTemperature === undefined ? {} : { temperature: curTemperature }),
      ...(useMaxCompletion ? { max_completion_tokens: config.maxTokens } : { max_tokens: config.maxTokens }),
      stream: true,
    });

  /** 从非 2xx 响应提取错误 message */
  const readError = async (res: Response): Promise<string> => {
    const raw = await res.text().catch(() => '');
    try {
      const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
      if (typeof parsed.error === 'string') return parsed.error;
      if (parsed.error && typeof parsed.error === 'object' && typeof (parsed.error as { message?: unknown }).message === 'string') {
        return (parsed.error as { message: string }).message;
      }
      if (typeof parsed.message === 'string') return parsed.message;
    } catch {
      // 非 JSON
    }
    return raw.slice(0, 160);
  };

  let lastErr: unknown = null;
  for (const url of candidates) {
    // 参数兼容重试：最多 3 次
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: authHeaders(config.apiKey),
          body: makeBody(),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastErr = err;
        // CORS 兑底：改用「简单请求」（text/plain、不带 Authorization）避开预检，
        // 供本地网关（未开预检支持）场景使用
        try {
          const res2 = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: makeBody(),
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (res2.ok) {
            return await consumeStream(res2, onDelta);
          }
          if (res2.status === 400) {
            // 兑底路径同样支持参数兼容重试
            const msg2 = await readError(res2);
            if (!useMaxCompletion && /max_completion_tokens|unsupported parameter.{0,40}max_tokens/i.test(msg2)) {
              useMaxCompletion = true;
              continue;
            }
            if (curTemperature !== undefined && /temperature/i.test(msg2)) {
              curTemperature = undefined;
              continue;
            }
          }
        } catch {
          // 兑底也失败：换下一个候选
        }
        break; // 网络不通：换下一个候选
      }

      if (!res.ok) {
        const msg = await readError(res);
        if (res.status === 400) {
          if (!useMaxCompletion && /max_completion_tokens|unsupported parameter.{0,40}max_tokens/i.test(msg)) {
            useMaxCompletion = true;
            continue;
          }
          if (curTemperature !== undefined && /temperature/i.test(msg)) {
            curTemperature = undefined;
            continue;
          }
        }
        const friendly =
          res.status === 401
            ? 'API Key 无效或未授权（401）'
            : res.status === 404
              ? '接口路径或模型不存在（404），请检查 API 地址与模型名'
              : msg || `上游接口返回 ${res.status}`;
        throw new Error(friendly);
      }

      // ---- 流式：逐行解析 SSE ----
      return await consumeStream(res, onDelta);
    }
  }

  throw new Error(
    lastErr instanceof Error && /timeout|abort/i.test(lastErr.message)
      ? '浏览器直连超时：地址不可达或网络受限'
      : directFetchErrorHint(config.baseUrl)
  );
}

/** 读取直连响应体：SSE 逐段回调 + 非流式 JSON / 纯文本兜底，返回完整文本 */
async function consumeStream(res: Response, onDelta: (delta: string) => void): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let acc = '';
  const handleLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;
    const payload = trimmed.slice(5).trim();
    if (!payload) return false;
    if (payload === '[DONE]') return true;
    try {
      const delta = extractDeltaText(JSON.parse(payload));
      if (delta) {
        acc += delta;
        onDelta(delta);
      }
    } catch {
      // 忽略无法解析的行
    }
    return false;
  };
  let done = false;
  for (;;) {
    const { done: streamDone, value } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (handleLine(line)) {
        done = true;
        break;
      }
    }
    if (done) break;
  }
  if (!done && buffer.trim()) handleLine(buffer);

  // ---- 非流式 JSON / 纯文本响应兜底 ----
  if (!acc.trim()) {
    const raw = buffer.trim();
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const choices = Array.isArray(parsed.choices) ? (parsed.choices as unknown[]) : [];
        const first = choices[0];
        let text = '';
        if (first && typeof first === 'object') {
          const rec = first as { message?: unknown; delta?: unknown };
          text = pickDelta(rec.message) || pickDelta(rec.delta);
        }
        if (!text && typeof parsed.content === 'string') text = parsed.content;
        if (!text && typeof parsed.response === 'string') text = parsed.response;
        if (text) {
          acc = text;
          onDelta(text);
        }
      } catch {
        // 非 JSON，忽略
      }
    } else if (raw && !raw.startsWith('data:')) {
      acc = raw;
      onDelta(raw);
    }
  }
  return acc;
}
