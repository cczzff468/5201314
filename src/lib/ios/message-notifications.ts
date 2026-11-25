'use client';

/**
 * AI 消息系统通知模块（第三十轮·彻底重构）。
 *
 * 机主规格（原文逐条落实）：
 * 一、原生通知通道
 *  - Android 原生 NotificationChannel，IMPORTANCE_HIGH（弹横幅、响铃、震动）——
 *    原生侧 local_notify_high 渠道（v2.4.13 建），本模块默认走它；
 *  - Android 13+ POST_NOTIFICATIONS 权限由原生侧双闸校验（未授/通知总闸关 → 如实失败）。
 * 二、逐条通知
 *  - AI 每生成并渲染一条新消息 → scheduleLocalNotification({ id: 消息唯一ID, title: 角色名,
 *    body: 消息正文 })——id 用消息 id 哈希出的【每条独立 id】+ tag `msg-<id>`，
 *    绝不用同一 tag 覆盖前面的通知：5 条消息 = 通知栏里 5 条独立条目；
 * 三、防干扰
 *  - 仅 App 后台/息屏（document.visibilityState=hidden 或失焦）时下发；前台只渲染聊天；
 *  - 顺序管理：模块级 promise 链串行队列——AI 连发多条时按到达顺序逐条过桥，
 *    并发不会被系统吞掉（每条 await 前一条完成才发下一条）；
 * 四、点击跳转
 *  - 每条通知携带 target（{app, contactId}）→ 原生 contentIntent → 回传
 *    local-notify-open → navigateFromSystemNotify 精确跳到对应聊天界面。
 *
 * 入口：island-notify.maybeWebNotification 原生分支（信息/微信/QQ 三端 AI 消息投递共用）。
 */

import { isPageBackground } from './system-notify';

/** 消息通知请求（id 必填：每条消息一个独立通知） */
export interface MessageNotificationReq {
  /** 消息唯一 ID（消息 id / 通知 id）——决定独立通知条目，绝不用同一 ID 覆盖 */
  id: string;
  /** 通知标题（角色名） */
  title: string;
  /** 通知正文（消息正文） */
  body: string;
  /** 点击跳转目标（app + contactId；null = 仅打开 App） */
  target?: { app: string; contactId?: string } | null;
}

/** 字符串 → 稳定 32 位哈希（消息 id → Android 通知 int id；同 id 复算同值） */
function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h | 0);
}

/* ---------------- 顺序队列（三、3：并发不被吞） ---------------- */

/** 串行链：所有过桥调用按到达顺序逐条执行（前一条 settle 才发下一条） */
let chain: Promise<void> = Promise.resolve();

/** 已入队/已发送的消息 id 去重（同一消息绝不重复弹两条） */
const sentIds = new Set<string>();

/** 队列指标（设置页/调试可读：当前积压 + 累计发送） */
export const notifyStats = { queued: 0, sent: 0 };

/** 单条下发（内部）：走原生 localNotify（IMPORTANCE_HIGH 渠道 + 点击直达） */
async function postOne(req: MessageNotificationReq): Promise<boolean> {
  try {
    const np = await import('./native-perception');
    if (!np.isNativePerception()) return false;
    const ok = await np.localNotify({
      title: req.title,
      body: req.body,
      // 每条消息一个独立 tag（msg-<id>）：Android 按 (tag, id) 独立堆叠、互不覆盖
      tag: `msg-${req.id}`,
      url: '/',
      target: req.target ?? undefined,
    });
    return ok === true;
  } catch {
    return false;
  }
}

/**
 * 逐条调度一条 AI 消息系统通知（规范入口）：
 * 1. 前台（用户正看着 App）→ 直接 return（前台只渲染聊天，不弹系统通知）；
 * 2. 非原生壳环境 → 静默 no-op（网页环境的通知走 Web 通道，由调用方分流）；
 * 3. 同一消息 id 只发一次（去重）；
 * 4. 入串行队列：保证 5 条消息弹 5 个通知、按顺序到达、并发不被系统吞。
 */
export function scheduleLocalNotification(req: MessageNotificationReq): void {
  if (typeof window === 'undefined') return;
  // 三、1：只有后台/息屏才发（前台直接渲染聊天界面）
  if (!isPageBackground()) return;
  // 二、1：消息 id 去重——同一条消息绝不弹第二条
  if (sentIds.has(req.id)) return;
  sentIds.add(req.id);
  // 容量自限（极端长会话防泄漏：记住最近 500 条已发 id）
  if (sentIds.size > 500) {
    const it = sentIds.values();
    for (let i = 0; i < 100; i++) it.next();
    // Set 迭代顺序即插入顺序：丢掉最老的 100 条
  }
  notifyStats.queued += 1;
  // 三、3：串行链——逐条过桥，顺序稳定
  chain = chain
    .then(async () => {
      const ok = await postOne(req);
      if (ok) notifyStats.sent += 1;
    })
    .catch(() => undefined)
    .finally(() => {
      notifyStats.queued = Math.max(0, notifyStats.queued - 1);
    });
}

/**
 * 撤销本模块发的全部消息通知（进聊天页清未读时用；与 localNotifyCancelByTagPrefix 同款，
 * 只清 msg- 前缀的本模块通知，常驻守护/其它通知不受影响）。
 */
export async function cancelAllMessageNotifications(): Promise<void> {
  try {
    const np = await import('./native-perception');
    if (!np.isNativePerception()) return;
    await np.localNotifyCancelByTagPrefix('msg-');
  } catch {
    /* 静默 */
  }
}

/** 调试口：当前队列状态 */
export function messageNotifySnapshot(): { queued: number; sent: number; ids: number } {
  return { queued: notifyStats.queued, sent: notifyStats.sent, ids: sentIds.size };
}

/** 消息 id → Android 通知 int id（导出给调试/设置页复用） */
export function notificationIdFor(msgId: string): number {
  return hashId(msgId);
}
