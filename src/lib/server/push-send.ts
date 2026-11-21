/**
 * Web Push 服务端发送（全订阅广播 + 失效订阅清理）——
 * 「服务端产生对方消息」的各路径统一出口（当前：/api/chat/bg 离线接力回复；
 * 未来任何服务端主动消息路径直接复用，不再各写一遍 web-push 循环）：
 * - 对 push-subs.json（/lib/server/push-store 双路径存储）里全部订阅逐个 sendNotification，
 *   每条文本一条系统通知（tag 唯一 → 不互相替换，微信式逐条横幅）；
 * - 404/410 = 订阅已失效/已退订 → 自动从订阅表剔除；其余错误（瞬时网络失败等）保留订阅；
 * - 全程尽力而为：无 VAPID / 无订阅 / 发送失败一律静默，不阻塞业务主流程（重开网页仍能
 *   从 pending 队列拉到消息）。
 */

import webpush from 'web-push';
import { getVapidKeys, readPushJson, writePushJson } from './push-store';

/** 单条推送的公共描述：title=联系人名/角色名；icon 支持压缩 dataURL（角色头像）或站内路径 */
export interface PushEnvelope {
  title: string;
  icon?: string;
  /** 通知点击落地页（缺省 '/'，由 sw.js notificationclick 聚焦/新开窗口） */
  url?: string;
  /** 点击跳转目标（NotifyTarget 同构纯对象）——随载荷下发 → sw.js push 处理器
   *  透传进通知 data → notificationclick 回传页面直达目标会话
   *  （关页期间 Web Push 点开也能跳进对应聊天，不再裸开首页） */
  target?: unknown;
  /**
   * 排除发起设备自己的订阅（C2）：按订阅存储里的 tag 字段（/api/push POST 时客户端上报的
   * 设备标识 deviceTag）过滤 —— 服务端无法区分「是谁的动作」时，由客户端在请求里带上自己的
   * tag 并在这里回传，广播时排除发起设备、只推对方设备。向后兼容：无 tag 的旧订阅（或
   * excludeTag 缺省）永不被排除，行为与历史完全一致。
   */
  excludeTag?: string;
}

/** 粗略形状的订阅记录（与 /api/push POST 存入的 PushSubscriptionJSON 同形） */
interface PushSubLike {
  endpoint?: unknown;
  [k: string]: unknown;
}

/** icon（dataURL 头像）长度硬上限：超限丢弃，宁可不带头像也不能超 Web Push 4KB payload */
const ICON_MAX_CHARS = 2600;
/** 单条通知 body 预览长度上限 */
const BODY_PREVIEW_MAX = 120;

/** 消息文本 → 通知正文预览（折叠空白 + 截断） */
function previewOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, BODY_PREVIEW_MAX);
}

/**
 * 向全部已订阅浏览器推送（每条 body 一条系统通知）：
 * - bodies 逐条独立通知（tag 自动加序号唯一化，不互相替换）；
 * - icon 仅接受 data:image/ 开头且不超上限的值（超限/缺失时不带，浏览器用默认图标）；
 * - 发送后把 404/410 失效订阅写回订阅表（ alive 过滤，与 /api/push 的串行口径一致尽力而为）。
 */
export async function pushToAllSubscribers(envelope: PushEnvelope, bodies: string[]): Promise<void> {
  try {
    const vapid = await getVapidKeys();
    if (!vapid) return;
    const subs = await readPushJson<PushSubLike[]>('push-subs.json', []);
    if (!Array.isArray(subs) || subs.length === 0) return;
    const icon =
      typeof envelope.icon === 'string' &&
      envelope.icon.startsWith('data:image/') &&
      envelope.icon.length <= ICON_MAX_CHARS
        ? envelope.icon
        : undefined;
    const stamp = Date.now().toString(36);
    const alive: PushSubLike[] = [];
    await Promise.all(
      subs.map(async (sub) => {
        if (typeof sub.endpoint !== 'string') return; // 形状非法：不回收进表（自然淘汰）
        // excludeTag：跳过发起设备自己的订阅（无 tag 的旧订阅永不被排除，向后兼容）。
        // 「跳过发送」≠「订阅失效」，保留在表里
        const subTag = typeof sub.tag === 'string' ? sub.tag : '';
        if (envelope.excludeTag && subTag && subTag === envelope.excludeTag) {
          alive.push(sub);
          return;
        }
        let dead = false;
        for (let i = 0; i < bodies.length; i++) {
          const body = previewOf(bodies[i]);
          if (!body) continue;
          try {
            await webpush.sendNotification(
              sub as unknown as Parameters<typeof webpush.sendNotification>[0],
              JSON.stringify({
                title: envelope.title,
                body,
                tag: `bg-${stamp}-${i}`, // 每条消息一个独立弹窗（sw.js push 处理器按 tag 展示）
                url: envelope.url ?? '/',
                ...(envelope.target !== undefined ? { target: envelope.target } : {}),
                ...(icon ? { icon } : {}),
              }),
              {
                vapidDetails: {
                  subject: 'mailto:bg-reply@ios-phone.local',
                  publicKey: vapid.publicKey,
                  privateKey: vapid.privateKey,
                },
              },
            );
          } catch (err) {
            const e = err as { statusCode?: number };
            // 404/410 = 订阅已失效/已退订；401/403 = VAPID 钥不匹配/未授权（服务端重置换钥后
            // 旧公钥订阅的典型回执）——都不可恢复，剔除让客户端下次打开时重新订阅；
            // 其余错误（瞬时网络失败等）保留订阅
            if (e?.statusCode === 404 || e?.statusCode === 410 || e?.statusCode === 401 || e?.statusCode === 403) {
              dead = true;
              break;
            }
          }
        }
        if (!dead) alive.push(sub);
      }),
    );
    await writePushJson('push-subs.json', alive);
  } catch {
    // 推送是增强能力：任何失败静默，不影响消息本体投递（pending 队列 / SSE 广播照常）
  }
}
