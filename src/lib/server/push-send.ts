/**
 * Web Push 服务端发送（全订阅广播 + 失效订阅清理）——
 * 「服务端产生对方消息」的各路径统一出口（当前：/api/chat/bg 离线接力回复；
 * 未来任何服务端主动消息路径直接复用，不再各写一遍 web-push 循环）：
 * - 对 push-subs.json（/lib/server/push-store 双路径存储）里全部订阅逐个 sendNotification；
 * - 404/410 = 订阅已失效/已退订 → 自动从订阅表剔除；其余错误（瞬时网络失败等）保留订阅；
 * - 全程尽力而为：无 VAPID / 无订阅 / 发送失败一律静默，不阻塞业务主流程（重开网页仍能
 *   从 pending 队列拉到消息）。
 *
 * v2.4.29（第四十八轮）：一批消息合并成一条通知（「角色名：发来了 N 条新消息」）。
 * v2.4.31（「通知与聊天界面实时同步」根修·一消息一推）：机主规格「AI 发几条就弹几次」
 * 重申——Web Push 与灵动岛/原生 heads-up 同口径，【逐条】发送（每条消息一条独立通知，
 * tag = bg-<批次>-<序号> 唯一不合并）；修复 v2.4.30「一消息一弹窗」重构漏改的服务端
 * 合并口径（页面关闭期间 Web Push 仍把 N 条折成一条）。
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
/** 单条消息预览长度上限（超长截断加省略号） */
const BODY_PREVIEW_MAX = 120;

/** 消息文本 → 通知正文预览（折叠空白） */
function previewOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 截断加省略号：超长时截 max 长并补「…」，不长原样返回 */
function ellipsize(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/**
 * 向全部已订阅浏览器推送（v2.4.31 一消息一推：每条消息一条独立系统通知，
 * 与灵动岛/原生 heads-up 的「AI 发几条就弹几次」同口径）：
 * - messages 为拆分后的逐条消息（调用方负责拆分；single 原文勿直接传入）；
 * - icon 仅接受 data:image/ 开头且不超上限的值（超限/缺失时不带，浏览器用默认图标）；
 * - 发送后把 404/410 失效订阅写回订阅表（alive 过滤，与 /api/push 的串行口径一致尽力而为）。
 */
export async function pushToAllSubscribers(
  envelope: PushEnvelope,
  messages: string[],
): Promise<void> {
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
    // v2.4.31 逐条推送：每条消息一条独立通知（tag 唯一防同批合并），
    // 发送顺序 = 消息顺序（锁屏上自上而下与聊天一致）；空消息过滤在前
    const cleaned = messages.map(previewOf).filter((t) => t.length > 0);
    if (cleaned.length === 0) return;
    const stamp = Date.now().toString(36);
    const vapidDetails = {
      subject: 'mailto:bg-reply@ios-phone.local',
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
    };
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
        for (let i = 0; i < cleaned.length && !dead; i++) {
          try {
            await webpush.sendNotification(
              sub as unknown as Parameters<typeof webpush.sendNotification>[0],
              JSON.stringify({
                title: envelope.title,
                body: ellipsize(cleaned[i], BODY_PREVIEW_MAX),
                // 一消息一推：tag 按序号唯一（sw.js 按 tag 展示，同批不折叠、不同批不覆盖）
                tag: `bg-${stamp}-${i}`,
                url: envelope.url ?? '/',
                ...(envelope.target !== undefined ? { target: envelope.target } : {}),
                ...(icon ? { icon } : {}),
              }),
              { vapidDetails },
            );
          } catch (err) {
            const e = err as { statusCode?: number };
            // 404/410 = 订阅已失效/已退订；401/403 = VAPID 钥不匹配/未授权（服务端重置换钥后
            // 旧公钥订阅的典型回执）——都不可恢复，剔除让客户端下次打开时重新订阅；
            // 其余错误（瞬时网络失败等）保留订阅（本批剩余条目停发，下批再试）
            if (e?.statusCode === 404 || e?.statusCode === 410 || e?.statusCode === 401 || e?.statusCode === 403) {
              dead = true;
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
