import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 识图模型代理（设置 › 识图模型）：把用户在聊天里发送的图片转成文字描述。
 *
 * - 请求体：{ images: string[]（data:image/ 内联数据）, text?: string, config: { baseUrl, apiKey, model } }
 * - 识图模型只负责「看」：服务端把图片组装成 OpenAI 兼容的多模态 messages（非流式），
 *   换回描述文本 { desc } 交给聊天侧作为上下文；最终回复仍由聊天模型生成。
 * - 图片只内联转发到用户自己配置的接口，不落盘、不上传任何第三方。
 * - 与 /api/chat 同策略：内网地址 → directOnly 标记（客户端改浏览器直连）；
 *   上游 400 报错按 max_completion_tokens 兼容重试。
 */

interface VisionUpstreamConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 单张图片 data URL 上限（base64 字符数，约 5MB 二进制） */
const MAX_IMAGE_CHARS = 5_000_000;
/** 单轮最多识图张数（聊天端选图上限 9 张，识图取前几张控制开销） */
const MAX_IMAGES = 4;

const SYSTEM_PROMPT =
  '你是聊天应用内置的图片识别助手。用户在聊天中发来图片，请用中文客观、简洁地描述图片内容（有什么人/物/场景/可见文字），不要寒暄、不要评论、只输出描述本身；单张图片 150 字以内。如果一次发来了多张图片，必须逐张分行描述：每行以「图1：」「图2：」等编号开头、按图片顺序排列，每行 80 字以内。如果消息附带了文字问题，请结合图片回答该问题。';

function extractConfig(value: unknown): VisionUpstreamConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
  if (!baseUrl) return null;
  return {
    baseUrl,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '',
    model: typeof raw.model === 'string' ? raw.model.trim() : '',
  };
}

/** 收窄图片列表：仅接受 data:image/ 内联数据（拒绝 http(s) 远程地址——不代理图片下载） */
function extractImages(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const images: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.startsWith('data:image/')) continue;
    if (item.length > MAX_IMAGE_CHARS) continue;
    images.push(item);
    if (images.length >= MAX_IMAGES) break;
  }
  return images.length > 0 ? images : null;
}

/** 与 /api/chat 一致的 baseUrl 归一化候选列表 */
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

/** 从任意形态的错误体提取 message */
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

/** 从非流式响应提取描述文本（content 兼容 string / 多模态分段数组） */
function extractText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  const choices = Array.isArray(obj.choices) ? obj.choices : [];
  const first: unknown = choices[0];
  const pick = (part: unknown): string => {
    if (typeof part !== 'object' || part === null) return '';
    const content = (part as { content?: unknown }).content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
        .join('');
    }
    return '';
  };
  if (first && typeof first === 'object') {
    const rec = first as { message?: unknown; delta?: unknown };
    const t = pick(rec.message) || pick(rec.delta);
    if (t) return t;
  }
  if (typeof obj.content === 'string') return obj.content;
  if (typeof obj.response === 'string') return obj.response;
  return '';
}

/**
 * 内置识图兜底（z-ai-web-dev-sdk createVision）：用户识图接口故障 / 未配置时把图片描述救回来。
 * 与 /api/chat 兜底策略一致；图片 data URL 直接作为 image_url 传入。
 */
async function sdkVision(images: string[], text: string): Promise<string> {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();
  const userContent = [
    { type: 'text' as const, text: text || '请描述这张图片' },
    ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ];
  const completion = await zai.chat.completions.createVision({
    model: 'glm-4.5v',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  });
  const payload = completion as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = payload?.choices?.[0]?.message?.content;
  const desc = typeof content === 'string' ? content.trim() : '';
  if (!desc) throw new Error('内置识图模型返回空内容');
  return desc;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  const config = extractConfig(root.config);
  const images = extractImages(root.images);
  if (!images) {
    return NextResponse.json({ error: '没有可识别的图片数据' }, { status: 400 });
  }
  const text = typeof root.text === 'string' ? root.text.trim().slice(0, 500) : '';

  // forceSdk：前端识图链路故障后的兜底请求；未配置识图模型时也直接用内置识图
  if (root.forceSdk === true || !config || !config.model) {
    try {
      return NextResponse.json({ desc: await sdkVision(images, text), viaSdk: true });
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : '未知错误';
      if (root.forceSdk === true) {
        return NextResponse.json({ error: `内置识图模型失败：${detail}` }, { status: 502 });
      }
      // 未配置：保留原提示语义，附带内置模型失败原因
      return NextResponse.json(
        { error: `还没有配置识图模型（内置识图也不可用：${detail}），请到「设置 › 识图模型」填写` },
        { status: 502 }
      );
    }
  }

  // 内网地址：云端服务器必然不可达，标记 directOnly 让客户端改用浏览器直连
  try {
    if (isPrivateHost(new URL(config.baseUrl).hostname)) {
      return NextResponse.json(
        { error: '识图接口位于局域网/本机，云端服务器无法访问，已改用浏览器直连', directOnly: true },
        { status: 502 }
      );
    }
  } catch {
    // URL 解析失败走正常流程
  }

  const userContent: unknown[] = [
    { type: 'text', text: text || '请描述这张图片' },
    ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  };

  // 参数兼容（与 /api/chat 同策略）：新模型拒绝 max_tokens 时换 max_completion_tokens 重试
  let useMaxCompletion = false;
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const requestBody = JSON.stringify({
      model: config.model,
      messages,
      ...(useMaxCompletion ? { max_completion_tokens: 512 } : { max_tokens: 512 }),
      stream: false,
    });
    for (const endpoint of buildChatCandidates(config.baseUrl)) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: requestBody,
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) {
          const raw = await res.text().catch(() => '');
          let msg = '';
          if (raw.startsWith('{')) {
            try {
              msg = extractErrorMessage(JSON.parse(raw) as unknown);
            } catch {
              msg = raw.slice(0, 160);
            }
          } else {
            msg = raw.slice(0, 160);
          }
          if (res.status === 400 && !useMaxCompletion && /max_completion_tokens|unsupported parameter.{0,40}max_tokens/i.test(msg)) {
            useMaxCompletion = true;
            break; // 换参后重试全部候选
          }
          lastErr =
            res.status === 401
              ? 'API Key 无效或未授权（401）'
              : res.status === 404
                ? '接口路径或模型不存在（404），请检查识图 API 地址与模型名'
                : msg || `识图接口返回 ${res.status}`;
          continue;
        }
        const payload: unknown = await res.json().catch(() => null);
        const desc = extractText(payload).trim();
        if (desc) return NextResponse.json({ desc });
        // 200 但无内容：尝试透出错误信息后继续下一候选
        lastErr = extractErrorMessage(payload) || '识图接口返回了空内容';
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }
    if (useMaxCompletion && attempt === 0) continue;
    break;
  }

  // 上游识图接口全部失败：内置识图兜底，识图体验不中断
  try {
    return NextResponse.json({ desc: await sdkVision(images, text), viaSdk: true });
  } catch {
    // 内置识图也失败：返回上游侧真实原因
  }

  return NextResponse.json(
    { error: lastErr || '识图接口不可用，请稍后重试' },
    { status: 502 }
  );
}
