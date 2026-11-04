import { broadcastSseEvent, sseClientCount } from '@/lib/server/notify-bus';

/**
 * 通知广播入口（v57 通知系统）：
 * POST /api/notify/push { title, body, tag?, icon?, badge? }
 * → 广播给所有 /api/notify/stream 长连接客户端（客户端经 SW showNotification 弹系统通知）。
 *
 * 载荷约定：
 * - title：角色名字（群聊 = 发言成员名）；
 * - body：消息预览（发送方已截断）；
 * - icon：复合图标 dataURL（角色头像圆底 + App 角标，island-notify.buildNotifyIcon 合成）；
 * - badge：App 图标路径（/icons/wechat.png 等）；
 * - tag：通知去重键（每条消息一个独立通知）。
 * 返回 { ok, delivered }（delivered = 广播到的连接数，0 = 当前无人在线——
 * 单机自推自收场景下 0 通常意味着长连接还没建立，发送方有直发兜底）。
 */

interface PushPayload {
  title?: unknown;
  body?: unknown;
  tag?: unknown;
  icon?: unknown;
  badge?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  const p = (await req.json().catch(() => null)) as PushPayload | null;
  if (!p || typeof p.title !== 'string' || !p.title.trim()) {
    return Response.json({ ok: false, error: 'title required' }, { status: 400 });
  }
  const payload = {
    title: p.title.slice(0, 120),
    body: typeof p.body === 'string' ? p.body.slice(0, 240) : '',
    tag: typeof p.tag === 'string' ? p.tag.slice(0, 120) : undefined,
    // icon 是复合头像 dataURL（1~3KB）不截断；badge 是 App 图标路径
    icon: typeof p.icon === 'string' ? p.icon : undefined,
    badge: typeof p.badge === 'string' ? p.badge : undefined,
  };
  const delivered = broadcastSseEvent(payload);
  return Response.json({ ok: true, delivered, online: sseClientCount() });
}
