import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * 「TA 主动分享生活」配图 · 服务端生图（W1-B5）：
 * - 只走内置 z-ai-web-dev-sdk images.generations（SDK 仅允许服务端使用，客户端组件绝不引入）；
 * - 请求体（JSON）：{ prompt: 生图提示词, size?: 尺寸档 }；size 收敛到 SDK 支持的档位，
 *   默认 768x1344（竖幅——最接近手机随手拍出来的照片画幅）；
 * - 响应：{ src: dataURL }（base64 直转，按魔数嗅探 mime）或 { error }（中文文案）；
 * - SDK 本身没有超时参数，用 Promise 竞速做 130 秒兜底（实测一次约 30 秒）；
 * - ZAI 实例全局单例复用（create 有握手开销，与 /api/wake-asr 的 getZai 同款模式）；
 * - 客户端若已配置「设置 › 图像生成」（用户自己的生图模型），优先走 /api/imggen 管线，
 *   本路由仅作未配置/失败时的兜底通道（与 v82「用户模型优先」的口径一致）。
 */

/** SDK 支持的尺寸档（d.ts CreateImageGenerationBody['size'] 的字面量集合） */
const SIZES = new Set(['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440']);
/** 默认竖幅（手机随手拍观感） */
const DEFAULT_SIZE = '768x1344';
/** 生图兜底超时（SDK 无自身超时；实测约 30s，留足余量） */
const TIMEOUT_MS = 130_000;
/** 提示词长度上限（防滥用/防拼进上游报错） */
const MAX_PROMPT_LEN = 600;

/** ZAI 的最小生图形态（只用到的字段收窄声明，避免 any 外泄） */
interface ZaiImageClient {
  images: {
    generations: {
      create: (body: { prompt: string; size?: string }) => Promise<{ data?: Array<{ base64?: unknown }> }>;
    };
  };
}

/** 全局单例 ZAI（懒建；create 有握手开销，高频小请求必须复用） */
let zaiPromise: Promise<ZaiImageClient> | null = null;
function getZai(): Promise<ZaiImageClient> {
  zaiPromise ??= (async () => {
    const { default: ZAI } = await import('z-ai-web-dev-sdk');
    return (await ZAI.create()) as unknown as ZaiImageClient;
  })();
  return zaiPromise;
}

/** Promise 竞速超时（SDK 无超时参数；超时按失败返回，绝不悬挂整个请求） */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('生图请求超时')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** base64 按魔数嗅探 mime（SDK 声明 PNG，实际可能回 JPEG；嗅错 mime 部分浏览器不渲染） */
function sniffMime(base64: string): string {
  try {
    const head = base64.slice(0, 8).toUpperCase();
    if (head.startsWith('FFD8FF')) return 'image/jpeg';
    if (head.startsWith('89504E47')) return 'image/png';
  } catch {
    /* 嗅探失败按 png */
  }
  return 'image/png';
}

export async function POST(req: NextRequest) {
  let prompt = '';
  let size = DEFAULT_SIZE;
  try {
    const body = (await req.json().catch(() => null)) as { prompt?: unknown; size?: unknown } | null;
    prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    const s = typeof body?.size === 'string' ? body.size.trim() : '';
    if (SIZES.has(s)) size = s;
  } catch {
    /* 解析失败按空处理 */
  }
  if (!prompt) return NextResponse.json({ error: '缺少生图提示词' }, { status: 400 });
  if (prompt.length > MAX_PROMPT_LEN) prompt = prompt.slice(0, MAX_PROMPT_LEN);

  try {
    const zai = await getZai();
    const res = await withTimeout(zai.images.generations.create({ prompt, size }), TIMEOUT_MS);
    const b64 = res?.data?.[0]?.base64;
    if (typeof b64 === 'string' && b64.length > 64) {
      return NextResponse.json({ src: `data:${sniffMime(b64)};base64,${b64}` });
    }
    return NextResponse.json({ error: '生图服务没有返回图片' }, { status: 502 });
  } catch (e) {
    // 单例建坏了（如配置文件缺失）要允许下次重建：清缓存再返回错误
    zaiPromise = null;
    const msg = e instanceof Error ? e.message : '生图失败';
    return NextResponse.json({ error: `生活分享配图生成失败：${msg}` }, { status: 502 });
  }
}
