import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// ---------------- 类型 ----------------

interface ChatApiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface UpstreamConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

/** OpenAI 兼容 SSE / 非流式响应中的最小结构 */
interface SSEChunk {
  choices?: Array<{
    delta?: unknown;
    message?: unknown;
  }>;
}

// ---------------- 校验与收窄工具（禁止 any：全部 unknown + 收窄） ----------------

function isValidMessages(value: unknown): value is ChatApiMessage[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const rec = item as { role?: unknown; content?: unknown };
    if (rec.role !== 'user' && rec.role !== 'assistant' && rec.role !== 'system') return false;
    return typeof rec.content === 'string';
  });
}

function extractConfig(value: unknown): UpstreamConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
  // 反代/中转接口可能无需 Key：只要求 baseUrl，apiKey 允许为空
  if (!baseUrl) return null;
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
  return {
    baseUrl,
    apiKey,
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : 'gpt-4o-mini',
    temperature:
      typeof raw.temperature === 'number' && raw.temperature >= 0 && raw.temperature <= 2 ? raw.temperature : 0.7,
    maxTokens:
      typeof raw.maxTokens === 'number' && Number.isFinite(raw.maxTokens) && raw.maxTokens > 0
        ? Math.floor(raw.maxTokens)
        : 2048,
  };
}

function pickContent(part: unknown): string {
  if (typeof part !== 'object' || part === null) return '';
  const content = (part as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  // 兼容多模态分段格式：content: [{ type: 'text', text: '...' }, ...]
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (p && typeof p === 'object') {
          const t = (p as { text?: unknown }).text;
          if (typeof t === 'string') return t;
        }
        return '';
      })
      .join('');
  }
  return '';
}

/** 从非流式 JSON 响应中提取回复文本（兼容多种网关返回结构） */
function extractNonStreamText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  const choices = Array.isArray(obj.choices) ? obj.choices : [];
  const first: unknown = choices[0];
  if (first && typeof first === 'object') {
    const rec = first as { message?: unknown; delta?: unknown; text?: unknown };
    const fromMessage = pickContent(rec.message) || pickContent(rec.delta);
    if (fromMessage) return fromMessage;
    if (typeof rec.text === 'string') return rec.text;
  }
  // 部分简化网关：{ content: "..." } / ollama 风格 { response: "..." }
  if (typeof obj.content === 'string') return obj.content;
  if (typeof obj.response === 'string') return obj.response;
  return '';
}

/** 解析可能被错误标注 content-type 的 SSE 文本，返回拼接内容（无内容返回空串） */
function parseSseText(raw: string): string {
  let acc = '';
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      acc += extractDelta(JSON.parse(payload) as SSEChunk);
    } catch {
      // 忽略无法解析的行
    }
  }
  return acc;
}

function extractDelta(chunk: unknown): string {
  if (typeof chunk !== 'object' || chunk === null) return '';
  let choices = (chunk as { choices?: unknown }).choices;
  // 兼容直接传入单个 choice 对象的调用方式
  if (!Array.isArray(choices)) {
    choices = [chunk];
  }
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first: unknown = choices[0];
  if (typeof first !== 'object' || first === null) return '';
  const rec = first as { delta?: unknown; message?: unknown };
  return pickContent(rec.delta) || pickContent(rec.message);
}

/** baseUrl 归一化候选列表：兼容完整端点 / /v1 结尾 / 裸域名三种写法；自动修复 /v1/v1 重复版本段；裸域名额外提供无版本号备选 */
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

/** 私有/本机地址（云端服务器不可达，客户端应改用浏览器直连） */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

// ---------------- 上游代理（用户自己的 OpenAI 兼容接口） ----------------

function sseToTextStream(upstreamBody: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstreamBody.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const pushText = (text: string) => {
        if (!text) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // 客户端已断开：静默
        }
      };
      /** 处理一行 SSE，返回 true 表示收到 [DONE] */
      const processLine = (line: string): boolean => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return false;
        const payload = trimmed.slice(5).trim();
        if (!payload) return false;
        if (payload === '[DONE]') return true;
        try {
          const chunk = JSON.parse(payload) as SSEChunk;
          const choice = chunk.choices?.[0];
          pushText(extractDelta(choice));
        } catch {
          // 忽略无法解析的行
        }
        return false;
      };
      try {
        let doneFlag = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (processLine(line)) {
              doneFlag = true;
              break;
            }
          }
          if (doneFlag) break;
        }
        if (!doneFlag && buffer.trim()) processLine(buffer);
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      } catch (err) {
        // 上游异常：把错误传播到下游 reader.read()，让客户端 streamOnce 外层 catch 捕获并
        // 走 SDK 兜底（配合 chat-stream-store 重建 raw/scanner 后由 SDK 文本接管）；
        // 不再静默 close()，否则客户端会把「截断回复」当成完整回复落地
        try {
          controller.error(err);
        } catch {
          // 已关闭/已取消：尽力传播
          try {
            controller.close();
          } catch {
            // 已关闭
          }
        }
      }
    },
    cancel() {
      void upstreamBody.cancel().catch(() => undefined);
    },
  });
}

/** 从任意形态的错误体提取 message（{error:{message}} / {error:"..."} / {message}） */
function extractErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as { error?: unknown; message?: unknown };
  if (typeof obj.error === 'string') return obj.error;
  if (obj.error && typeof obj.error === 'object') {
    const msg = (obj.error as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  if (typeof obj.message === 'string') return obj.message;
  return '';
}

/** 从 400 错误响应提取 message（消费了响应体后重建响应供后续流程使用） */
async function read400Message(res: Response): Promise<{ msg: string; replay: Response }> {
  const raw = await res.text().catch(() => '');
  let msg = '';
  if (raw) {
    try {
      msg = extractErrorMessage(JSON.parse(raw) as unknown);
    } catch {
      msg = raw.slice(0, 160);
    }
  }
  // 响应体已被消费：重建一个等价响应供调用方继续读取
  const replay = new Response(raw, {
    status: 400,
    statusText: res.statusText,
    headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
  });
  return { msg, replay };
}

async function proxyToUpstream(config: UpstreamConfig, messages: ChatApiMessage[]): Promise<Response> {
  const candidates = buildChatCandidates(config.baseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  };

  // 参数兼容（拉模型成功但聊天失败的最常见原因）：
  // 新版 OpenAI 系模型（o1/o3/gpt-5 等）拒绝 max_tokens（要求 max_completion_tokens）、
  // 只支持默认温度。按上游 400 报错逐项调整后自动重试。
  let useMaxCompletion = false;
  let curTemperature: number | undefined = config.temperature;

  const makeBody = (): string =>
    JSON.stringify({
      model: config.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      ...(curTemperature === undefined ? {} : { temperature: curTemperature }),
      ...(useMaxCompletion ? { max_completion_tokens: config.maxTokens } : { max_tokens: config.maxTokens }),
      stream: true,
    });

  /** 对全部候选端点发一次请求；404 换下一个候选 */
  const tryCandidates = async (): Promise<{ res?: Response; endpoint: string; err?: unknown }> => {
    let lastErr: unknown = null;
    for (const endpoint of candidates) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: makeBody(),
          signal: AbortSignal.timeout(60_000),
        });
        if (res.status === 404 && endpoint !== candidates[candidates.length - 1]) {
          continue; // 路径不存在：尝试下一个候选端点
        }
        return { res, endpoint };
      } catch (err) {
        lastErr = err;
      }
    }
    return { endpoint: candidates[candidates.length - 1], err: lastErr };
  };

  /** 带参数兼容重试的首次请求：400 提示换参时重发（最多 2 次调整） */
  const fetchWithCompat = async (): Promise<
    { res?: Response; endpoint: string; err?: unknown }
  > => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const out = await tryCandidates();
      if (!out.res) return out;
      if (out.res.status === 400) {
        const { msg, replay } = await read400Message(out.res);
        if (!useMaxCompletion && /max_completion_tokens|unsupported parameter.{0,40}max_tokens/i.test(msg)) {
          useMaxCompletion = true;
          continue;
        }
        if (curTemperature !== undefined && /temperature/i.test(msg)) {
          curTemperature = undefined;
          continue;
        }
        // 无法再调整：返回重建的 400 响应，走下方统一错误处理
        return { res: replay, endpoint: out.endpoint };
      }
      return out;
    }
    // 理论不可达（attempt 上限内必返回）
    return { endpoint: candidates[candidates.length - 1] };
  };

  const first = await fetchWithCompat();
  if (!first.res) {
    const detail = first.err instanceof Error ? first.err.message : String(first.err ?? '');
    return NextResponse.json(
      {
        error: `无法连接到上游接口：${detail}（实际请求端点：${first.endpoint}）`,
        directOnly: true,
      },
      { status: 502 }
    );
  }
  const upstream = first.res;

  const contentType = upstream.headers.get('content-type') ?? '';

  // 标准流式响应：SSE 逐行解析
  if (upstream.ok && upstream.body && /text\/event-stream/i.test(contentType)) {
    return new Response(sseToTextStream(upstream.body), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  }

  if (!upstream.ok || !upstream.body) {
    let detail = '';
    try {
      detail = (await upstream.text()).slice(0, 300);
    } catch {
      // 忽略读取失败
    }
    // 尽力从上游 JSON 错误体中提取 message
    let upstreamMsg = '';
    if (detail.startsWith('{')) {
      try {
        const parsed: unknown = JSON.parse(detail);
        if (parsed && typeof parsed === 'object') {
          const errField = (parsed as { error?: unknown }).error;
          if (typeof errField === 'string') upstreamMsg = errField;
          else if (errField && typeof errField === 'object') {
            const msg = (errField as { message?: unknown }).message;
            if (typeof msg === 'string') upstreamMsg = msg;
          }
        }
      } catch {
        // 非 JSON，保留原文
      }
    }

    const REGION_BLOCKED =
      /country|region|territory|unsupported|blocked/i.test(upstreamMsg) ||
      /unsupported_country/i.test(detail);

    let friendly: string;
    let directOnly = false;
    if (upstream.status === 401) {
      friendly = 'API Key 无效或未授权（401）';
    } else if (upstream.status === 403) {
      if (REGION_BLOCKED) {
        directOnly = true;
        friendly = `服务拒绝访问（403）：${upstreamMsg || '地区限制'} —— 该服务商对服务器所在地区限制，可尝试浏览器直连或换用国内 API（DeepSeek / Kimi / 智谱 等）`;
      } else {
        friendly = `服务拒绝访问（403）${upstreamMsg ? `：${upstreamMsg}` : ''}`;
      }
    } else if (upstream.status === 404) {
      friendly = '接口路径或模型不存在（404），请检查 API 地址与模型名';
    } else if (upstream.status === 429) {
      directOnly = true;
      friendly = '请求频率超限（429），请稍后再试';
    } else {
      friendly = upstreamMsg || detail || `上游接口返回 ${upstream.status}`;
    }
    return NextResponse.json({ error: friendly, ...(directOnly ? { directOnly: true } : {}) }, { status: 502 });
  }

  // 非流式分支：很多反代/中转不支持 stream 参数，会直接返回完整 JSON 或纯文本
  const raw = await upstream.text();
  const trimmed = raw.trim();
  if (!trimmed) {
    return NextResponse.json(
      { error: '上游接口返回了空响应，请检查模型名是否正确或稍后重试' },
      { status: 502 }
    );
  }

  // 个别网关把 SSE 标成 application/json：正文仍是 data: 行，按 SSE 解析
  if (trimmed.startsWith('data:')) {
    const text = parseSseText(trimmed);
    if (text) {
      return new Response(text, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        },
      });
    }
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const payload: unknown = JSON.parse(trimmed);
      const text = extractNonStreamText(payload);
      if (text) {
        return new Response(text, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
          },
        });
      }
      // 200 却没有内容字段：尽力透出错误信息（部分网关用 200 包裹错误体）
      const errMsg = extractErrorMessage(payload);
      return NextResponse.json(
        { error: errMsg || '上游返回了无法识别的 JSON 结构，请确认该接口为 OpenAI 兼容接口' },
        { status: 502 }
      );
    } catch {
      // JSON 解析失败：按纯文本透传
    }
  }

  return new Response(raw, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}

// ---------------- 内置模型兜底（与 server-llm.ts 同策略） ----------------

/** 服务端内置模型（z-ai-web-dev-sdk）：用户上游故障 / 未配置时把回复救回来，聊天体验不中断。
 *  temperature（可选）：客户端传入时透传给内置模型——Task 20：低温度下同输入得到近乎相同的回复，
 *  是「一起听」复读体验的根因之一，SDK 兜底同样需要多样性。 */
async function sdkChat(messages: ChatApiMessage[], temperature?: number): Promise<string> {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    // z-ai SDK 的 ChatMessage 类型实际接受 system 角色，直接传人设/世界书/记忆 system 块
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    thinking: { type: 'disabled' },
    ...(typeof temperature === 'number' && Number.isFinite(temperature) ? { temperature } : {}),
  });
  const text = completion.choices[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('内置模型返回空内容');
  return text;
}

function textResponse(text: string): Response {
  return new Response(text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Reply-Via': 'sdk-fallback',
    },
  });
}

/** SDK 兜底失败时的统一错误响应 */
function sdkErrorResponse(sdkErr: unknown, hint: string): NextResponse {
  const detail = sdkErr instanceof Error && sdkErr.message ? sdkErr.message : '未知错误';
  return NextResponse.json({ error: `${hint}（内置模型也不可用：${detail}）` }, { status: 502 });
}

// ---------------- 路由入口 ----------------

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }

  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  if (!isValidMessages(root.messages)) {
    return NextResponse.json(
      { error: 'messages 不能为空，且每条消息必须包含合法的 role 与 content' },
      { status: 400 }
    );
  }
  // 上下文裁剪：保留首条 system（人设 + 世界书 + 记忆块）+ 末 39 条，避免 App 传入 >40 条时
  // 直接 slice(-40) 裁掉首条 system 导致 AI 失忆；首条非 system 时仍走 slice(-40)
  const allMsgs = root.messages as ChatApiMessage[];
  const messages: ChatApiMessage[] =
    allMsgs.length > 40 && allMsgs[0]?.role === 'system'
      ? allMsgs.slice(0, 1).concat(allMsgs.slice(-39))
      : allMsgs.slice(-40);

  // 可选 temperature（Task 20）：SDK 兜底路径透传，驱动输出多样性；非法/缺省时不传（SDK 用自身默认值）
  const temperature = typeof root.temperature === 'number' && Number.isFinite(root.temperature) ? root.temperature : undefined;

  // forceSdk：前端在代理 + 浏览器直连都失败后的最终兜底请求（直接用内置模型生成）
  if (root.forceSdk === true) {
    try {
      return textResponse(await sdkChat(messages, temperature));
    } catch (sdkErr) {
      return sdkErrorResponse(sdkErr, '内置模型生成失败');
    }
  }

  const config = extractConfig(root.config);
  if (!config) {
    // 未配置也能聊：直接用服务端内置模型，不再拦截报错
    try {
      return textResponse(await sdkChat(messages, temperature));
    } catch (sdkErr) {
      return sdkErrorResponse(
        sdkErr,
        '还没有配置 AI 接口：请先到「设置 › API 配置」填写 OpenAI 兼容的 API 地址与 API Key'
      );
    }
  }
  // 内网地址：云端服务器必然不可达，返回 directOnly 标记让客户端改用浏览器直连
  try {
    if (isPrivateHost(new URL(config.baseUrl).hostname)) {
      return NextResponse.json(
        {
          error: '该地址位于局域网/本机，云端服务器无法访问，已改用浏览器直连',
          directOnly: true,
        },
        { status: 502 }
      );
    }
  } catch {
    // URL 解析失败走正常流程
  }
  try {
    const res = await proxyToUpstream(config, messages);
    // 上游成功：原样透传
    if (res.status < 400) return res;
    // directOnly（内网地址 / 403 地区限制 / 429）：交给前端先试浏览器直连，
    // 直连失败后前端会再发 forceSdk 请求兜底 —— 这里保持原响应语义
    let directOnly = false;
    try {
      const data: unknown = await res.clone().json();
      if (data && typeof data === 'object') {
        directOnly = (data as { directOnly?: unknown }).directOnly === true;
      }
    } catch {
      // 非 JSON 错误体按非 directOnly 处理
    }
    if (directOnly) return res;
    // 其余上游失败（连接失败 / 401 / 404 / 空响应 / 5xx）：服务端直接用内置模型兜底，聊天不中断
    try {
      return textResponse(await sdkChat(messages, temperature));
    } catch {
      // SDK 也失败：返回原始上游错误，保留真实原因
      return res;
    }
  } catch (err) {
    const detail = err instanceof Error && err.message ? err.message : '未知错误';
    return NextResponse.json({ error: `AI 服务暂时不可用：${detail}` }, { status: 500 });
  }
}
