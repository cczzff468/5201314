import { NextRequest, NextResponse } from 'next/server';
import { runInSdkQueue, runSdkHiSession } from '@/lib/server-llm';

export const runtime = 'nodejs';

/**
 * 翻译接口（服务端聚合）：POST { text, lang, config }
 * - config 为用户配置的 OpenAI 兼容接口（与 /api/chat 相同结构）；服务端用与聊天完全相同的
 *   流式路径请求上游（stream:true，兼容性最好），把 SSE 聚合成完整译文后返回 { translation: string }；
 * - 上游 400 报错时按 /api/chat 同款策略自动换参重试（max_completion_tokens / 去温度）；
 * - 内网地址 / 建议直连时返回 directOnly 标记，客户端回退浏览器直连。
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

/**
 * 内置模型兜底（z-ai-web-dev-sdk）：上游故障 / 未配置时把翻译救回来。
 * 429/限流时指数退避重试（1.5s→3s→6s→12s→20s→30s→45s，共 8 次尝试，预算 ~2 分钟）：
 * SDK 被朋友圈/论坛等模块并发占用时频繁限流，是「翻译一直失败」的主要根源。
 * 【高优会话锁】（修复「生成完成后点翻译还是失败」）：整个重试循环包在
 * runSdkHiSession 里——重试的退避等待期间，论坛/朋友圈后台生成任务暂停出队，
 * SDK 配额得以恢复；否则生成任务会在重试间隙里把配额又抽干（恶性循环，
 * 日志实测：translate 502 in 73s 与 forum/moments generate 200 in 43s 交替出现）。
 * 预算耗尽仍 429 时抛出带 rateLimited 标记的错误，客户端据此自动再试一轮
 * 而不是直接报「翻译失败」。并发仍恒为 1（串行队列，429 防护不变）。
 */
async function sdkTranslate(messages: UpstreamMessage[]): Promise<string> {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const waits = [1500, 3000, 6000, 12000, 20000, 30000, 45000];
  return runSdkHiSession(async () => {
    let zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= waits.length; attempt++) {
      try {
        // ZAI.create() 放进 try：限流高峰期 create() 本身也会 429（在 try 外会绕过退避直接抛）
        if (!zai) zai = await ZAI.create();
        const completion = await runInSdkQueue(
          () =>
            zai!.chat.completions.create({
              messages: messages.map((m) => ({
                role: m.role,
                content: m.content,
              })),
              thinking: { type: 'disabled' },
            }),
          { priority: 'high' }, // 交互请求插队：排到后台批量生成任务之前
        );
        const choice = (completion as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0];
        const content = choice?.message?.content;
        const text = typeof content === 'string' ? content.trim() : '';
        if (!text) throw new Error('内置模型返回空内容');
        return text;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const rateLimited = /429|too many requests|rate.?limit/i.test(msg);
        const wait = waits[attempt];
        if (rateLimited && wait !== undefined) {
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        // 最后一搏仍限流：抛出前打上标记（客户端自动再试一轮，不直接报失败）
        if (rateLimited) {
          (err as Error & { rateLimited?: boolean }).rateLimited = true;
        }
        throw err;
      }
    }
    // 兜底标记（循环正常走完的路径；一般不会到这）
    const e = lastErr instanceof Error ? lastErr : new Error('内置模型翻译失败');
    if (/429|too many requests|rate.?limit/i.test(e.message)) {
      (e as Error & { rateLimited?: boolean }).rateLimited = true;
    }
    throw e;
  });
}

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

  // forceSdk：前端在代理 + 浏览器直连都失败后的最终兜底请求（直接用内置模型翻译）
  if (root.forceSdk === true) {
    try {
      return NextResponse.json({ translation: await sdkTranslate(messages), viaSdk: true });
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : '未知错误';
      const limited = (err as { rateLimited?: boolean }).rateLimited === true;
      return NextResponse.json(
        { error: `内置模型翻译失败：${detail}`, ...(limited ? { rateLimited: true } : {}) },
        { status: 502 }
      );
    }
  }

  const config = extractConfig(root.config);
  if (!config) {
    // 未配置也能翻：直接用服务端内置模型，不再拦截报错
    try {
      return NextResponse.json({ translation: await sdkTranslate(messages), viaSdk: true });
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : '未知错误';
      const limited = (err as { rateLimited?: boolean }).rateLimited === true;
      return NextResponse.json(
        {
          error: `还没有配置 AI 接口，且内置模型不可用：${detail}`,
          ...(limited ? { rateLimited: true } : {}),
        },
        { status: 502 }
      );
    }
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
  // 上游完全连不上：先走服务端内置模型兜底（浏览器直连公网地址大概率也不通，
  // 且直连超时长达 120s×2 会把翻译卡住几分钟）；内置也失败才回 directOnly 让浏览器试直连。
  if (lastErr !== null) {
    try {
      return NextResponse.json({ translation: await sdkTranslate(messages), viaSdk: true });
    } catch {
      /* 内置模型也失败：落到 directOnly 报错 */
    }
  }
  return NextResponse.json(
    { error: `无法连接到上游接口：${detail}`, directOnly: true },
    { status: 502 }
  );
}
