'use client';

/**
 * v1.9.8 全局接力守望者（修「系统通知有时候要点进 APP 才出现」）。
 *
 * 背景（修复前的链路缺口）：
 * 1. 关页/刷新时正在生成的回复走「服务端接力」：/api/chat/bg 生成完放入 pending 队列，
 *    ① Web Push（仅页面关闭且已订阅）② SSE 广播 bg-pending；
 * 2. 但客户端「正式投递 + 弹横幅」只发生在聊天页挂载/回前台拉取（= 点进 APP 进会话）；
 * 3. 且 SSE 连接是懒启动（只有接力窗口等待期间才建立）——平时广播发出来无人监听。
 *    广播丢失（刷新空窗/断线/多实例）时消息一直躺在服务端队列，不点进去永远不弹横幅，
 *    会话列表只有未读角标（peekBgBadgeCounts 不弹横幅）。
 *
 * 本模块（PhoneShell 引入一次，模块级单例与页面存活解耦）：
 * - startBgSse()：SSE 连接改为应用启动即常驻（waitForBgSseEvent 复用同一条连接）；
 * - 常驻订阅 bg-pending 事件 → 事件驱动即时 peek（零延迟）；
 * - SSE 重连成功（onBgSseOpen）→ 补拉一次（断线空窗兜底）；
 * - 回前台（visibilitychange→visible）→ 补拉一次；
 * - 20s 兜底轮询（多实例部署等收不到广播的场景最后防线）；
 * - peek（GET /api/chat/bg?peekAll=1&preview=1）发现有待达消息的会话：
 *   · 该会话正在流式/投递中 → 跳过（原管线投递时会正常弹横幅，不抑制）；
 *   · 否则直接 pushChatNotification 弹灵动岛横幅 + 提示音（页面隐藏时走系统通知；
 *     DND/会话免打扰/系统通知总闸在 pushChatNotification 内统一生效），
 *     并 suppressSessionBanner —— 聊天页稍后正式投递同一批消息时不再重复弹
 *     （观察到该会话投递忙→闲跃迁或 5min TTL 后解除）；
 *   · 不消费服务端队列：正式落盘投递仍由聊天页挂载拉取完成（读拉/写清协议不变）。
 *
 * 去重键 = `${sessionKey}#${count}#${preview hash}`（localStorage 持久化，上限 200 条）：
 * 数量或首条预览变化（新接力到达）才会再次弹；旧条目残留无害（上限淘汰）。
 */

import { onBgPendingEvent, onBgSseOpen, startBgSse } from './bg-turn';
import {
  clearSessionBannerSuppress,
  clearStaleSessionBannerSuppress,
  pushChatNotification,
  suppressSessionBanner,
  type NotifyApp,
  type NotifyTarget,
} from './island-notify';
import { getDeliveringSessionKeys, subscribeAiDeliveryActive } from './ai-delivery';

// ---------------- 常量 ----------------

/** 兜底轮询间隔（收不到 SSE 广播的场景：多实例部署/断线重连空窗） */
const POLL_MS = 20_000;
/** 启动延迟（避开首屏挂载高峰；期间到达的接力由首次 peek 捕获） */
const START_DELAY_MS = 2_500;
/** 启动后首次 peek 延迟（捕获上次会话遗留的 pending） */
const FIRST_PEEK_DELAY_MS = 3_000;
/** bg-pending 事件抖动合并（同一时刻多会话入队只拉一次） */
const EVENT_DEBOUNCE_MS = 300;
/** 已弹横幅批次去重持久化键 */
const SEEN_KEY = 'bg-relay-bannered';
/** 去重集合上限（超出淘汰最旧；旧条目残留无害——服务端队列被消费后重复键不再出现） */
const SEEN_MAX = 200;

// ---------------- sessionKey → 通知归属/点击跳转 ----------------

/** 会话键 → { app, target }；无法识别的键返回 null（不弹）。
 *  sms 会话与 chat.tsx 通知口径一致：storageKey 以 'c:' 开头才有联系人直达目标 */
function parseSessionTarget(sessionKey: string): { app: NotifyApp; target: NotifyTarget } | null {
  let m = /^wx:group:(.+)$/.exec(sessionKey);
  if (m) return { app: 'wechat', target: { app: 'wechat', groupId: m[1] } };
  m = /^wx:(.+)$/.exec(sessionKey);
  if (m) return { app: 'wechat', target: { app: 'wechat', contactId: m[1] } };
  m = /^qq:group:(.+)$/.exec(sessionKey);
  if (m) return { app: 'qq', target: { app: 'qq', groupId: m[1] } };
  m = /^qq:(.+)$/.exec(sessionKey);
  if (m) return { app: 'qq', target: { app: 'qq', contactId: m[1] } };
  m = /^sms:(.+)$/.exec(sessionKey);
  if (m) {
    const key = m[1];
    return {
      app: 'chat',
      target: key.startsWith('c:') ? { app: 'chat', contactId: key.slice(2) } : { app: 'chat' },
    };
  }
  return null;
}

// ---------------- 去重集合（localStorage 持久化，刷新后不重复弹） ----------------

function loadSeen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveSeen(set: Set<string>): void {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-SEEN_MAX)));
  } catch {
    // 持久化失败忽略（内存态去重本次会话仍生效）
  }
}

/** 短字符串 hash（djb2；preview 参与去重键，新内容到达 → 新键 → 再次弹横幅） */
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ---------------- peek ----------------

interface RelayPreview {
  count: number;
  title?: string;
  avatar?: string;
  preview?: string;
}

let peekInflight = false;
let peekQueued = false;

async function peekOnce(): Promise<void> {
  if (peekInflight) {
    peekQueued = true; // 并发触发合并为一次尾随重跑
    return;
  }
  peekInflight = true;
  try {
    const res = await fetch('/api/chat/bg?peekAll=1&preview=1');
    if (!res.ok) return;
    const data = (await res.json()) as { previews?: Record<string, RelayPreview> };
    if (!data.previews || typeof data.previews !== 'object') return;
    // 忙会话快照（含排队批次）：接力波/新回合投递中 → 原管线会正常弹横幅，守望者不抢
    const busy = new Set(getDeliveringSessionKeys());
    const { isChatStreaming } = await import('../chat-stream-store');
    const { isAiDelivering } = await import('./ai-delivery');
    const seen = loadSeen();
    let changed = false;
    for (const [key, p] of Object.entries(data.previews)) {
      if (!p || !(p.count > 0)) continue;
      const parsed = parseSessionTarget(key);
      if (!parsed) continue;
      const preview = (p.preview ?? '').trim() || '[新消息]';
      const batchKey = `${key}#${p.count}#${hashStr(preview)}`;
      if (seen.has(batchKey)) continue; // 这批已弹过横幅（未投递但已告知）
      if (busy.has(key) || isChatStreaming(key) || isAiDelivering(key)) continue; // 投递中：等原管线
      seen.add(batchKey);
      changed = true;
      // v1.9.8.1 关键：这是「新批次」（数量/首条预览变化）——先清掉旧批次的横幅抑制，
      // 否则旧抑制会把新内容的横幅吃掉（实测：首 peek 弹批次#3 并抑制会话后，
      // 5min 内到达的批次#4 横幅被吞）。清旧 → 弹新 → 重新武装，抑制永远只覆盖
      // 「已弹过横幅的当前批」，正式投递同一批时不重复弹
      clearSessionBannerSuppress(key);
      pushChatNotification({
        sessionKey: key,
        app: parsed.app,
        title: p.title?.trim() || '新消息',
        avatar: p.avatar ?? null,
        body: preview,
        target: parsed.target,
      });
      // 正式投递同一批消息时不再重复弹（投递忙→闲跃迁或 TTL 后解除）
      suppressSessionBanner(key);
    }
    if (changed) saveSeen(seen);
  } catch {
    // 网络异常/解析失败静默：下次事件/轮询重试（消息本体在服务端队列，不丢）
  } finally {
    peekInflight = false;
    if (peekQueued) {
      peekQueued = false;
      window.setTimeout(() => void peekOnce(), 50);
    }
  }
}

/** 事件驱动 peek（300ms 抖动合并：服务端一批多会话入队广播多条事件只拉一次） */
let eventTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleEventPeek(): void {
  if (eventTimer) return;
  eventTimer = setTimeout(() => {
    eventTimer = null;
    void peekOnce();
  }, EVENT_DEBOUNCE_MS);
}

// ---------------- 抑制解除（投递忙→闲跃迁 / TTL） ----------------

/** ai-delivery 状态广播：任一会话开始/结束投递时，检查抑制中的会话是否已投完 → 解除 */
function onDeliveryActiveChange(): void {
  clearStaleSessionBannerSuppress(getDeliveringSessionKeys());
}

// ---------------- 启动 ----------------

let started = false;

function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  // SSE 连接常驻（原懒启动：平时无连接，广播无人听——接力横幅不弹的根因之一）
  startBgSse();
  // 常驻订阅（模块级单例永不退订；订阅异常由各回调内部吞掉）
  onBgPendingEvent(scheduleEventPeek);
  onBgSseOpen(() => void peekOnce()); // 重连成功补拉（断线空窗兜底）
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void peekOnce();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  const pollTimer = window.setInterval(() => void peekOnce(), POLL_MS);
  if (pollTimer) void pollTimer; // 定时器句柄随页面生命周期，无需清理
  subscribeAiDeliveryActive(onDeliveryActiveChange);
  // 首拉：捕获上次会话（刷新/重开）遗留的 pending
  window.setTimeout(() => void peekOnce(), FIRST_PEEK_DELAY_MS);
}

if (typeof window !== 'undefined') {
  // dev 测试钩子：E2E 手动触发 peek / 查看内部状态（生产构建被 NODE_ENV 闸挡掉）
  if (process.env.NODE_ENV !== 'production') {
    const w = window as unknown as {
      __bgRelayWatcher?: { peek: () => Promise<void>; state: () => unknown };
    };
    w.__bgRelayWatcher = {
      peek: () => peekOnce(),
      state: () => ({
        started,
        peekInflight,
        pollMs: POLL_MS,
      }),
    };
  }
  // 避开首屏挂载高峰再启动
  window.setTimeout(start, START_DELAY_MS);
}
