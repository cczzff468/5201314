import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 翻译接口（服务端聚合）：POST { text, lang, config }
 * - config 为用户配置的 OpenAI 兼容接口（与 /api/chat 相同结构）；服务端用与聊天完全相同的
 *   流式路径请求上游（stream:true，兼容性最好），把 SSE 聚合成完整译文后返回 { translation: string }；
 * - 上游 400 报错时按 /api/chat 同款策略自动换参重试（max_completion_tokens / 去温度）；
 * - 内网地址 / 建议直连时返回 directOnly 标记，客户端回退浏览器直连。
 * - v82：内置 z-ai-web-dev-sdk 兜底已移除——未配置/上游失败返回明确错误。
 */

interface UpstreamConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

interface UpstreamMessage {
  role: 'system' | 'user';
  content: string;
}

/** 从非流式 JSON 响应中提取回复文本（兼容多种网关返回结构） */
function pickContent(part: unknown): string {
  if (typeof part !== 'object' || part === null) return '';
  const content = (part as { content?: unknown }).content;
  if (typeof content === 'string') return content;
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
  if (typeof obj.content === 'string') return obj.content;
  if (typeof obj.response === 'string') return obj.response;
  return '';
}

/** 解析 SSE 文本，返回拼接内容。
 *  【修复】不再只读 choices[0].content——SSE 分块的真正字段是 choices[0].delta.content
 *  （旧实现永远解析为空，导致原始流被当成「纯文本译文」返回给前端满屏渲染 data: {...}）；
 *  复用 extractNonStreamText：兼容 delta.content / message.content / 分段数组 / text 等各种形态。 */
function parseSseText(raw: string): string {
  let acc = '';
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      acc += extractNonStreamText(JSON.parse(payload) as unknown);
    } catch {
      // 忽略无法解析的行（注释 / event: 行 / 半截 JSON）
    }
  }
  return acc;
}

/** 结果是否仍是未解析的原始 SSE / JSON 分块（绝不能当译文返回给前端渲染）。
 *  真实译文不会出现以 data: 开头的行，也不会包含 [DONE] 标记。 */
function looksLikeRawStream(text: string): boolean {
  return /^\s*data:/m.test(text) || text.includes('[DONE]') || /\"id\"\s*:\s*\"chatcmpl-/.test(text);
}

function extractConfig(value: unknown): UpstreamConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
  if (!baseUrl) return null;
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
  // 默认 OpenAI 地址 + 空 Key = 从未配置（撞 api.openai.com 必 401 白费一圈）：
  // 当没有配置处理，直接走内置模型
  let host = '';
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    host = '';
  }
  if (!apiKey && /(^|\.)api\.openai\.com$/i.test(host)) return null;
  return {
    baseUrl,
    apiKey,
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : 'gpt-4o-mini',
    temperature:
      typeof raw.temperature === 'number' && raw.temperature >= 0 && raw.temperature <= 2 ? raw.temperature : 0.3,
    maxTokens:
      typeof raw.maxTokens === 'number' && Number.isFinite(raw.maxTokens) && raw.maxTokens > 0
        ? Math.min(Math.floor(raw.maxTokens), 1024)
        : 512,
  };
}

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

/** baseUrl 归一化候选列表（与 /api/chat 一致） */
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

// v82：内置模型翻译兜底（z-ai-web-dev-sdk）已移除——未配置/上游失败返回明确错误

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  const text = typeof root.text === 'string' ? root.text.trim() : '';
  const lang = typeof root.lang === 'string' ? root.lang.trim() : '';
  if (!text || text.length > 5000) {
    return NextResponse.json({ error: 'text 不能为空且不超过 5000 字' }, { status: 400 });
  }
  if (!lang || lang.length > 30) {
    return NextResponse.json({ error: 'lang 不能为空或过长（≤30 字符）' }, { status: 400 });
  }
  // 组装翻译 messages（供上游与内置模型兜底共用）
  const messages: UpstreamMessage[] = [
    {
      role: 'system',
      content:
        `你是一个翻译引擎。把用户发来的内容准确、自然地翻译成${lang}。` +
        `只输出译文本身：不要解释、不要加引号、不要输出原文或任何多余内容；` +
        `保留原文的语气、标点和表情符号；如果内容本身已经是${lang}，原样输出。`,
    },
    { role: 'user', content: text },
  ];

  // forceSdk（v82：内置模型已移除）→ 直接返回配置引导
  if (root.forceSdk === true) {
    return NextResponse.json(
      { error: '还没有配置 AI 接口：请先到「设置 › API 配置」填写后再使用翻译' },
      { status: 502 }
    );
  }

  const config = extractConfig(root.config);
  if (!config) {
    // v82：未配置直接返回引导（不再内置模型免配置翻译）
    return NextResponse.json(
      { error: '还没有配置 AI 接口：请先到「设置 › API 配置」填写后再使用翻译' },
      { status: 502 }
    );
  }
  try {
    if (isPrivateHost(new URL(config.baseUrl).hostname)) {
      return NextResponse.json(
        { error: '该地址位于局域网/本机，云端服务器无法访问，已改用浏览器直连', directOnly: true },
        { status: 502 }
      );
    }
  } catch {
    // URL 解析失败走正常流程
  }

  // forceSdk / 未配置兜底已在上文处理；上游走下面正常流程

  const candidates = buildChatCandidates(config.baseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  };

  // 参数兼容重试（与 /api/chat 一致）：新模型拒绝 max_tokens / 温度时按上游 400 提示调整。
  // 【修复】默认 stream:false 一次性拿完整 JSON（前端不再有机会碰到流式原文）；
  // 仅当上游 400 明确要求流式（部分网关只支持 stream:true）才回退流式，服务端聚合后再返回。
  let useMaxCompletion = false;
  let useStream = false;
  let curTemperature: number | undefined = config.temperature;

  const makeBody = (): string =>
    JSON.stringify({
      model: config.model,
      messages,
      ...(curTemperature === undefined ? {} : { temperature: curTemperature }),
      ...(useMaxCompletion ? { max_completion_tokens: config.maxTokens } : { max_tokens: config.maxTokens }),
      stream: useStream,
    });

  let lastErr: unknown = null;
  for (const endpoint of candidates) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: makeBody(),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (err) {
        lastErr = err;
        break; // 网络不通：换下一个候选端点
      }
      if (!res.ok) {
        let detail = '';
        try {
          detail = (await res.text()).slice(0, 300);
        } catch {
          // 忽略读取失败
        }
        let upstreamMsg = '';
        if (detail.startsWith('{')) {
          try {
            upstreamMsg = extractErrorMessage(JSON.parse(detail) as unknown);
          } catch {
            // 非 JSON
          }
        }
        if (res.status === 400) {
          if (!useMaxCompletion && /max_completion_tokens|unsupported parameter.{0,40}max_tokens/i.test(upstreamMsg)) {
            useMaxCompletion = true;
            continue;
          }
          if (curTemperature !== undefined && /temperature/i.test(upstreamMsg)) {
            curTemperature = undefined;
            continue;
          }
          // 网关只支持流式：回退 stream:true 重试（服务端聚合 SSE 后返回）
          if (!useStream && /stream/i.test(upstreamMsg) && !/max_completion_tokens|max_tokens/i.test(upstreamMsg)) {
            useStream = true;
            continue;
          }
        }
        const friendly =
          res.status === 401
            ? 'API Key 无效或未授权（401）'
            : res.status === 404
              ? '接口路径或模型不存在（404），请检查 API 地址与模型名'
              : upstreamMsg || detail || `上游接口返回 ${res.status}`;
        const directOnly = res.status === 403 || res.status === 429;
        return NextResponse.json(
          { error: `翻译失败：${friendly}`, ...(directOnly ? { directOnly: true } : {}) },
          { status: 502 }
        );
      }
      // 200：解析响应体——非流式 JSON / 流式 SSE（部分网关无视 stream:false）/ 纯文本三兼容。
      // 【修复】不再以「开头是否 data:」为门槛：带注释行（: keep-alive）/ event: 行 / 前置空行的
      // SSE 全文扫描 data: 行（旧逻辑会把整段原始流当纯文本译文返回 → 前端满屏 data: {...}）。
      const raw = await res.text().catch(() => '');
      const trimmed = raw.trim();
      let translation = parseSseText(raw).trim(); // ① 全文扫描 SSE data: 行（兼容 delta.content）
      if (!translation && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
        // ② 标准非流式 JSON
        try {
          translation = extractNonStreamText(JSON.parse(trimmed) as unknown).trim();
        } catch {
          // 非 JSON：按纯文本处理
        }
      }
      if (
        !translation &&
        trimmed &&
        !/^\s*data:/m.test(trimmed) &&
        !trimmed.includes('[DONE]') &&
        !trimmed.startsWith('{') &&
        !trimmed.startsWith('[')
      ) {
        // ③ 纯文本译文（网关直接回裸文本）；含流式痕迹的响应绝不落入此分支
        translation = trimmed;
      }
      // 【修复】最终拦截：解析结果仍是原始流/分块 → 报错而不是把 data: {...} 返回给前端渲染
      if (translation && looksLikeRawStream(translation)) {
        return NextResponse.json(
          { error: '翻译失败：上游返回了无法解析的流式响应，请检查 API 地址或模型名' },
          { status: 502 }
        );
      }
      if (translation) return NextResponse.json({ translation });
      // 响应带 data: 行但一条都没解析出内容 → 也是流式响应问题（提示更准确）
      if (/^\s*data:/m.test(trimmed) || trimmed.includes('[DONE]')) {
        return NextResponse.json(
          { error: '翻译失败：上游返回了无法解析的流式响应，请检查 API 地址或模型名' },
          { status: 502 }
        );
      }
      return NextResponse.json(
        { error: '翻译失败：上游返回了空响应，请检查模型名或稍后重试' },
        { status: 502 }
      );
    }
  }

  const detail = lastErr instanceof Error && lastErr.message ? lastErr.message : String(lastErr ?? '');
  // 上游完全连不上（v82：不再内置兜底，直接返回 directOnly 让浏览器试直连）
  return NextResponse.json(
    { error: `无法连接到上游接口：${detail}`, directOnly: true },
    { status: 502 }
  );
}
