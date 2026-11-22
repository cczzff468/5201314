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
  /** v75：点击跳转目标（App + 会话 id；透传到客户端，随 notification.data 下发，
 *  sw.js notificationclick 读到后 postMessage 回页面导航总线跳到对应聊天） */
  target?: unknown;
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
    // v75：target 结构校验后透传（只收 App/会话 id 标量，防任意注入）
    target:
      p.target && typeof p.target === 'object'
        ? {
            app: typeof (p.target as { app?: unknown }).app === 'string' ? (p.target as { app: string }).app : undefined,
            contactId:
              typeof (p.target as { contactId?: unknown }).contactId === 'string'
                ? (p.target as { contactId: string }).contactId.slice(0, 120)
                : undefined,
            groupId:
              typeof (p.target as { groupId?: unknown }).groupId === 'string'
                ? (p.target as { groupId: string }).groupId.slice(0, 120)
                : undefined,
            pay: (p.target as { pay?: unknown }).pay === true ? true : undefined,
          }
        : undefined,
  };
  const delivered = broadcastSseEvent(payload);
  return Response.json({ ok: true, delivered, online: sseClientCount() });
}
