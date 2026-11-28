'use client';

/**
 * AI 消息系统通知模块（第四十八轮 v2.4.29·合并排版重做）。
 *
 * 机主规格（原文逐条落实）：
 * 一、排版
 *  - 绝不把多条消息的文本无缝拼接成一大段；
 *  - 单条通知：正文就是那一条消息（超长省略号，展开见全文）；
 *  - 连发多条（5s 内的突发批次）：合并为一条通知——标题「角色名：发来了 N 条新消息」，
 *    副标题预览最后一条消息（如「再说一个嘛…」）；同批次后续消息到达时原地更新同一条
 *    通知（计数 +1、预览换成最新），不再一条消息弹一条刷屏。
 * 二、头像
 *  - 通知大图标 = 当前聊天角色头像（island-notify 传入的 avatar：路径转绝对 URL 由原生
 *    侧下载，dataURL 直接解码）；小图标 = App 自有单色图标（原生 ic_stat_cove）。
 *  - 大文本展开（BigTextStyle）由原生 localNotify 渲染：下拉通知栏可见完整最新一条消息。
 * 三、通道与点击直达
 *  - Android 原生 IMPORTANCE_HIGH 渠道（弹横幅、响铃、震动）；
 *  - 点击携带 target（{app, contactId}）→ 原生 contentIntent → 回传 local-notify-open
 *    → navigateFromSystemNotify 精确跳到对应聊天界面。
 *
 * 入口：island-notify.maybeWebNotification 原生分支（信息/微信/QQ 三端 AI 消息投递共用）。
 */

/** 消息通知请求（id 必填：每条消息入队去重；同批突发共用一个通知 tag） */
export interface MessageNotificationReq {
  /** 消息唯一 ID（去重用：同一消息绝不弹第二条） */
  id: string;
  /** 通知标题（角色名） */
  title: string;
  /** 通知正文（消息正文） */
  body: string;
  /** 点击跳转目标（app + contactId；null = 仅打开 App） */
  target?: { app: string; contactId?: string } | null;
  /** 角色头像（路径 / dataURL；原生侧作通知大图标） */
  avatar?: string | null;
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

/* ---------------- 串行队列（并发不被吞） ---------------- */

/** 串行链：所有过桥调用按到达顺序逐条执行（前一条 settle 才发下一条） */
let chain: Promise<void> = Promise.resolve();

/** 已入队/已发送的消息 id 去重（同一消息绝不重复弹两条） */
const sentIds = new Set<string>();

/** 队列指标（设置页/调试可读：当前积压 + 累计发送） */
export const notifyStats = { queued: 0, sent: 0 };

/* ---------------- 突发批次合并（v2.4.29 机主规格） ---------------- */

/** 同一会话两条消息间隔 ≤ 该值视为同一突发批次：合并进同一条通知（计数 +1、预览换最新） */
const BURST_WINDOW_MS = 5_000;

interface BurstState {
  /** 本批次的通知 tag（msg- 前缀：cancelAllMessageNotifications 按前缀批量撤销） */
  tag: string;
  /** 批次内消息条数（含首条） */
  count: number;
  /** 最近一条到达时刻 */
  lastAt: number;
}

/** 合并键（目标会话）→ 批次状态 */
const bursts = new Map<string, BurstState>();

/** 请求 → 合并键（同会话同批；无 target 退回标题） */
function burstKeyOf(req: MessageNotificationReq): string {
  const t = req.target;
  if (t) return `${t.app}:${t.contactId ?? ''}`;
  return `title:${req.title}`;
}

/** 批次状态过期清理（超过窗口的键顺手淘汰，防 Map 无限增长） */
function pruneBursts(): void {
  const now = Date.now();
  for (const [k, b] of bursts) {
    if (now - b.lastAt > BURST_WINDOW_MS * 4) bursts.delete(k);
  }
}

/* ---------------- 头像规范化（原生侧下载/解码） ---------------- */

/** 头像 → 原生可解析的绝对地址：站内路径补 origin；dataURL 原样；空返回 undefined */
function normalizeAvatar(src: string | null | undefined): string | undefined {
  if (!src || typeof src !== 'string') return undefined;
  const s = src.trim();
  if (!s) return undefined;
  if (s.startsWith('data:image/')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) {
    try {
      return new URL(s, window.location.origin).href;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** 单条下发（内部）：走原生 localNotify（IMPORTANCE_HIGH 渠道 + BigTextStyle + 头像大图标） */
async function postOne(req: MessageNotificationReq): Promise<boolean> {
  try {
    const np = await import('./native-perception');
    if (!np.isNativePerception()) return false;
    // 突发批次判定：同会话 5s 内的后续消息并入同一条通知（tag 不变 → 原地更新）
    const key = burstKeyOf(req);
    const now = Date.now();
    const prev = bursts.get(key);
    const inBurst = !!prev && now - prev.lastAt <= BURST_WINDOW_MS;
    const burst: BurstState = inBurst
      ? { tag: prev.tag, count: prev.count + 1, lastAt: now }
      : { tag: `msg-${key}-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, count: 1, lastAt: now };
    bursts.set(key, burst);
    pruneBursts();
    const ok = await np.localNotify({
      // 多条合并格式（机主规格）：「角色名：发来了 N 条新消息」；单条就是角色名
      title: burst.count > 1 ? `${req.title}：发来了 ${burst.count} 条新消息` : req.title,
      // 副标题永远只展示【最新一条】消息（绝不拼接多条文本）
      body: req.body,
      // 同批次共用 tag：后到的消息原地更新同一条通知，不刷屏
      tag: burst.tag,
      url: '/',
      target: req.target ?? undefined,
      avatar: normalizeAvatar(req.avatar),
    });
    return ok === true;
  } catch {
    return false;
  }
}

/**
 * 调度一条 AI 消息系统通知（规范入口）：
 * 1. 同一消息 id 只发一次（去重）；
 * 2. 入串行队列：顺序稳定，并发不被系统吞；
 * 3. 同会话 5s 突发批次合并为一条「发来了 N 条新消息」通知（原地更新）。
 */
export function scheduleLocalNotification(req: MessageNotificationReq): void {
  if (typeof window === 'undefined') return;
  // 消息 id 去重——同一条消息绝不弹第二条
  if (sentIds.has(req.id)) return;
  sentIds.add(req.id);
  // 容量自限（极端长会话防泄漏：记住最近 500 条已发 id）
  if (sentIds.size > 500) {
    const it = sentIds.values();
    for (let i = 0; i < 100; i++) it.next();
    // Set 迭代顺序即插入顺序：丢掉最老的 100 条
  }
  notifyStats.queued += 1;
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
 * 只清 msg- 前缀的本模块通知，常驻守护/其它通知不受影响）。同时清空突发批次状态
 * （旧批次 tag 已被撤销，下一批必须用新 tag）。
 */
export async function cancelAllMessageNotifications(): Promise<void> {
  bursts.clear();
  try {
    const np = await import('./native-perception');
    if (!np.isNativePerception()) return;
    await np.localNotifyCancelByTagPrefix('msg-');
  } catch {
    /* 静默 */
  }
}

/** 调试口：当前队列状态 */
export function messageNotifySnapshot(): { queued: number; sent: number; ids: number; bursts: number } {
  return { queued: notifyStats.queued, sent: notifyStats.sent, ids: sentIds.size, bursts: bursts.size };
}

/** 消息 id → Android 通知 int id（导出给调试/设置页复用） */
export function notificationIdFor(msgId: string): number {
  return hashId(msgId);
}
