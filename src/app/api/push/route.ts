import { NextRequest, NextResponse } from 'next/server';

/**
 * Web Push 订阅管理（退出网页后也收「每条消息一条系统通知」）：
 * - GET：返回 VAPID 公钥（客户端订阅用）；密钥来源：环境变量 VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY
 *   （Netlify 等只读 FS 部署设置一次即稳定）→ .data/vapid.json → 首次现场生成；
 * - POST：保存浏览器推送订阅（push-subs.json，按 endpoint 去重；只读 FS 自动落 /tmp 兜底）；
 * - DELETE：移除订阅（浏览器退订时调用）。
 * 订阅在服务端为尽力而为的增强能力：不支持 Service Worker / Push 的环境注册失败静默跳过，
 * 应用内灵动岛弹窗与页面隐藏时的 Web Notification 不受影响。
 *
 * 鉴权（可选共享 token）：配置了环境变量 PUSH_SHARED_TOKEN 时，GET/POST/DELETE 均校验
 * 请求头 x-shared-token 必须等于该值，否则 401（防公网部署上被第三方任意写入/清洗订阅表、
 * 探测 VAPID 公钥）；未配置（本地沙箱默认）行为完全不变。
 */

import { getVapidKeys, readPushJson, runSubsMutation, writePushJson, type SubRec } from '@/lib/server/push-store';

export const runtime = 'nodejs';

/** 可选共享 token（环境变量未配置 = 不启用鉴权，历史行为不变） */
const TOKEN = process.env.PUSH_SHARED_TOKEN;

/** 共享 token 校验：未配置恒通过；已配置时请求头 x-shared-token 必须精确匹配 */
function tokenOk(req: Request): boolean {
  if (!TOKEN) return true;
  try {
    return req.headers.get('x-shared-token') === TOKEN;
  } catch {
    return false;
  }
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!tokenOk(req)) return unauthorized();
  try {
    const keys = await getVapidKeys();
    if (!keys?.publicKey) {
      return NextResponse.json({ error: '推送初始化失败' }, { status: 500 });
    }
    return NextResponse.json({ publicKey: keys.publicKey });
  } catch {
    return NextResponse.json({ error: '推送初始化失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!tokenOk(req)) return unauthorized();
  const body = (await req.json().catch(() => null)) as {
    subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  } | null;
  const endpoint = body?.subscription?.endpoint;
  // 最小形状校验：endpoint 必须为非空字符串，且 keys.p256dh/auth 必须为字符串——
  // web-push 协议必需这两项作为加密材料，缺失会让发送时 422 直接报错且占用订阅槽位。
  if (
    typeof endpoint !== 'string' ||
    !endpoint ||
    typeof body?.subscription?.keys?.p256dh !== 'string' ||
    !body.subscription.keys.p256dh ||
    typeof body?.subscription?.keys?.auth !== 'string' ||
    !body.subscription.keys.auth
  ) {
    return NextResponse.json({ error: 'subscription 无效' }, { status: 400 });
  }
  // 串行化读-改-写：两个并发 POST 各自 read→filter→write 后写覆盖前写、订阅会丢失。
  const result = await runSubsMutation(async () => {
    const subs = await readPushJson<SubRec[]>('push-subs.json', []);
    const next = Array.isArray(subs) ? subs.filter((s) => s && s.endpoint !== endpoint) : [];
    next.push(body!.subscription as SubRec);
    await writePushJson('push-subs.json', next.slice(-50));
    return NextResponse.json({ ok: true });
  });
  return result;
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  if (!tokenOk(req)) return unauthorized();
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== 'string') return NextResponse.json({ error: 'endpoint 无效' }, { status: 400 });
  // 与 POST 同一串行链，避免 DELETE 与 POST 互撞。
  const result = await runSubsMutation(async () => {
    const subs = await readPushJson<SubRec[]>('push-subs.json', []);
    await writePushJson('push-subs.json', subs.filter((s) => s && s.endpoint !== body!.endpoint));
    return NextResponse.json({ ok: true });
  });
  return result;
}
