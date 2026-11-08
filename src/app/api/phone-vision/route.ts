import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 手机屏幕视觉分析端点（Shizuku 自主权的「眼睛」，v1.4 UI 级操作核心）。
 *
 * 与 /api/vision（聊天图片描述）职责分开——这里面向 UI 自动化：
 *  - 界面分析：「看屏幕」→ 当前 App/页面、可见内容、可点元素及归一化坐标清单；
 *  - 目标定位：「点文字」→ 找到写着某文字/图标语义的元素，输出归一化 bbox。
 *
 * 请求体：{ image: string（data:image/ 内联）, ask: string（分析指令）,
 *           config?: { baseUrl, apiKey, model }（用户配置的识图模型，可空） }
 * 响应：{ desc: string }。
 *
 * 策略：只走用户配置的识图模型（OpenAI 兼容多模态，非流式）；未配置 / 内网地址 /
 * 上游故障返回明确错误（v82：内置 z-ai-web-dev-sdk 兜底已移除）。
 */

interface VisionUpstreamConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 单张截图 data URL 上限（base64 字符数，约 5MB 二进制） */
const MAX_IMAGE_CHARS = 5_000_000;

const SYSTEM_PROMPT =
  '你是安卓手机界面自动化助手。用户会发来手机屏幕截图并给出分析指令，你需要精确执行：识别当前App与页面、列出可点元素、或定位指定目标元素的位置。坐标一律用相对整张图的 0~1000 归一化数值（左上角为原点，右下角为 1000,1000）。严格按指令要求的格式紧凑输出：不要寒暄、不要解释坐标含义、不要输出坐标以外的多余内容。';

function extractConfig(value: unknown): VisionUpstreamConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  if (!baseUrl || !model) return null;
  return { baseUrl, model, apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '' };
}

/** 私有/本机地址（云端服务器不可达）。与 /api/vision 不同：这里不回 directOnly（客户端无直连链路），改走内置 SDK */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

/** 与 /api/chat、/api/vision 一致的 baseUrl 归一化候选列表 */
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

/** 从任意形态的错误体提取 message */
function extractErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as { error?: unknown; message?: unknown; content?: unknown; response?: unknown };
  if (typeof obj.error === 'string') return obj.error;
  if (typeof obj.message === 'string') return obj.message;
  if (typeof obj.content === 'string') return obj.content;
  if (typeof obj.response === 'string') return obj.response;
  return '';
}

// v82：内置屏幕视觉分析（z-ai-web-dev-sdk createVision）已移除——未配置/失败返回明确错误

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  const image = typeof root.image === 'string' ? root.image : '';
  if (!image.startsWith('data:image/') || image.length > MAX_IMAGE_CHARS) {
    return NextResponse.json({ error: '没有可识别的屏幕截图数据' }, { status: 400 });
  }
  const ask = typeof root.ask === 'string' ? root.ask.trim().slice(0, 600) : '';
  if (!ask) {
    return NextResponse.json({ error: '缺少分析指令（ask）' }, { status: 400 });
  }

  const config = extractConfig(root.config);

  // 未配置识图模型 / 内网地址（v82：不再内置兜底）→ 配置引导
  let privateHost = false;
  if (config) {
    try {
      privateHost = isPrivateHost(new URL(config.baseUrl).hostname);
    } catch {
      privateHost = false;
    }
  }
  if (!config || privateHost) {
    return NextResponse.json(
      { error: '还没有配置识图模型：请到「设置 › 识图模型」填写支持图片输入的模型（屏幕分析需要视觉能力）' },
      { status: 502 }
    );
  }

  // 用户识图模型（公网）→ 转发；失败降级内置 SDK（定位是硬需求，尽量救回来）
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: ask },
        { type: 'image_url', image_url: { url: image } },
      ],
    },
  ];
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  };

  // 参数兼容（与 /api/vision 同策略）：新模型拒绝 max_tokens 时换 max_completion_tokens 重试
  let useMaxCompletion = false;
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const requestBody = JSON.stringify({
      model: config.model,
      messages,
      ...(useMaxCompletion ? { max_completion_tokens: 900 } : { max_tokens: 900 }),
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
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { choices?: Array<{ message?: { content?: unknown } }> }
            | null;
          const content = data?.choices?.[0]?.message?.content;
          const desc = typeof content === 'string' ? content.trim() : '';
          if (desc) return NextResponse.json({ desc });
          lastErr = '识图接口返回空内容';
          continue;
        }
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
      } catch (err) {
        lastErr = err instanceof Error && err.message ? err.message : '网络请求失败';
      }
    }
  }

  // 上游全部失败（v82：直接返回真实原因）
  return NextResponse.json(
    { error: `屏幕视觉分析失败：${lastErr || '识图接口不可用'}` },
    { status: 502 }
  );
}
