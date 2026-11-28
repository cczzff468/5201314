/**
 * Web Push 服务端发送（全订阅广播 + 失效订阅清理）——
 * 「服务端产生对方消息」的各路径统一出口（当前：/api/chat/bg 离线接力回复；
 * 未来任何服务端主动消息路径直接复用，不再各写一遍 web-push 循环）：
 * - 对 push-subs.json（/lib/server/push-store 双路径存储）里全部订阅逐个 sendNotification；
 * - 404/410 = 订阅已失效/已退订 → 自动从订阅表剔除；其余错误（瞬时网络失败等）保留订阅；
 * - 全程尽力而为：无 VAPID / 无订阅 / 发送失败一律静默，不阻塞业务主流程（重开网页仍能
 *   从 pending 队列拉到消息）。
 *
 * v2.4.29（第四十八轮·通知合并与排版根修）：
 * - 【旧病】入参 bodies 是「逐条消息」时每条一发（连发 5 条 = 5 条通知刷屏）；
 *   入参是 single 模式的整段原文时更糟——整段原文（换行折叠成空格）直接塞进一条通知，
 *   全部消息无缝拼成一大段（机主反馈「mua收到啦嘿嘿 你今天怎么这么会呀…」）。
 * - 【新口径】messages = 拆分后的逐条消息（/api/chat/bg 的 splitSingleReply 已按
 *   &&& + 换行拆好），一批消息只发一条通知：
 *   · 1 条 → title = 角色名，body = 该条消息（超长省略号截断）；
 *   · N>1 条 → title = 「角色名：发来了 N 条新消息」，body = 最后一条消息预览
 *     （如「再说一个嘛…」）——绝不把多条消息文本无缝拼接。
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
/** 多条合并时副标题预览最后一条的长度上限（副标题更短，锁屏上一目了然） */
const BODY_MERGED_MAX = 60;

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
 * 一批消息 → 通知标题/正文（机主规格 v2.4.29）：
 * - 单条：title = 角色名，body = 消息全文预览（超长省略号）；
 * - 多条：title = 「角色名：发来了 N 条新消息」，body = 最后一条消息预览（省略号）。
 */
export function composeBatchNotification(
  title: string,
  messages: string[],
): { title: string; body: string } | null {
  const cleaned = messages.map(previewOf).filter((t) => t.length > 0);
  if (cleaned.length === 0) return null;
  const last = cleaned[cleaned.length - 1] ?? '';
  if (cleaned.length === 1) {
    return { title, body: ellipsize(last, BODY_PREVIEW_MAX) };
  }
  return {
    title: `${title}：发来了 ${cleaned.length} 条新消息`,
    body: ellipsize(last, BODY_MERGED_MAX),
  };
}

/**
 * 向全部已订阅浏览器推送（一批消息一条系统通知，v2.4.29 合并口径）：
 * - messages 为拆分后的逐条消息（调用方负责拆分；single 原文勿直接传入）；
 * - icon 仅接受 data:image/ 开头且不超上限的值（超限/缺失时不带，浏览器用默认图标）；
 * - 发送后把 404/410 失效订阅写回订阅表（ alive 过滤，与 /api/push 的串行口径一致尽力而为）。
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
    const composed = composeBatchNotification(envelope.title, messages);
    if (!composed) return;
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
        try {
          await webpush.sendNotification(
            sub as unknown as Parameters<typeof webpush.sendNotification>[0],
            JSON.stringify({
              title: composed.title,
              body: composed.body,
              // 一批一条：tag 固定（sw.js 按 tag 展示，同批不重复）
              tag: `bg-${stamp}`,
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
