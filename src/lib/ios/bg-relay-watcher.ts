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
 *   · 否则【先落库快照，再逐条弹通知】（v2.4.31「通知与聊天界面实时同步」根修：
 *     snapRelayMessages 把服务端逐条 messages 以 bgsnap-<id> 写进对应 App 的消息库
 *     （IndexedDB）+ 未读角标——机主点进 App 时消息早已躺在本地，不再「点进聊天页才显示」。
 *     原生轮询已弹过的批次（seen 已标记）回前台 peek 时同样补落库，按 id 去重幂等），
 *     然后【逐条】pushChatNotification（v2.4.28：服务端带回逐条 messages，
 *     AI 发几条就弹几次，不再把一批消息合并成一条首条预览横幅），
 *     并 suppressSessionBanner —— 聊天页稍后正式投递同一批消息时不再重复弹
 *     （观察到该会话投递忙→闲跃迁或 5min TTL 后解除）；
 *   · 不消费服务端队列：正式落盘投递仍由聊天页挂载拉取完成（读拉/写清协议不变）；
 *     聊天页正式投递入口会先清掉快照（clearRelaySnaps）再按原管线落盘，两个版本绝不共存；
 * - v2.4.28：APK 新壳（带原生 BgNotifyPoller）页面后台期间不弹网页通知，只叫醒
 *   原生轮询器（pokeBgNotify）立即拉一轮——WebView 后台 JS 可能被冻结，原生侧
 *   不依赖 JS；旧壳/浏览器维持网页自己弹。
 *
 * 去重键 = `${sessionKey}#${count}#${preview hash}`（localStorage 持久化，上限 200 条）：
 * 数量或首条预览变化（新接力到达）才会再次弹；旧条目残留无害（上限淘汰）。
 */

import { onBgPendingEvent, onBgSseOpen, startBgSse } from './bg-turn';
import {
  clearSessionBannerSuppress,
  clearStaleSessionBannerSuppress,
  isSysNotifyEnabled,
  pushChatNotification,
  suppressSessionBanner,
  truncateBody,
  type NotifyApp,
  type NotifyTarget,
} from './island-notify';
import { isNotifyDndActive } from './notification-center';
import { getDeliveringSessionKeys, subscribeAiDeliveryActive, yieldToEventLoop } from './ai-delivery';
// v2.4.31 快照落库：先写库再弹通知（通知与聊天界面实时同步根修第一环）
import { snapRelayMessages } from './relay-snap';
// v1.9.17 后台接力提速：isPageBackground 双信号判定——页面在后台时事件驱动 peek 立即执行
//（后台 setTimeout 被强节流 1s→1次/分钟，防抖反而把接力横幅拖慢，机主退后台收不到通知的根因之一）
import { isPageBackground } from './system-notify';
import { onKeepAliveTick } from './keepalive';

// ---------------- v2.4.27 原生后台通知协作（第四十七轮升级） ----------------

/** APK 原生桥（MainActivity addJavascriptInterface 的 window.AIPhoneNative）上
 *  本模块用到的三个方法（旧壳不存在时全体静默跳过，不影响浏览器端）
 *  v2.4.28 新增 pokeBgNotify：网页在后台收到 SSE 接力广播时叫醒原生轮询线程
 *  立即拉一轮（毫秒级），WebView 冻结时原生自己的快速节奏兑底 */
interface AIPhoneNativeBg {
  setBgNotifyConfig?: (json: string) => void;
  consumeBgNotified?: () => string;
  pokeBgNotify?: () => void;
}

/** 壳是否带【修好的】原生后台轮询器（v2.4.28+ / versionCode 92+，标志=pokeBgNotify 桥）：
 *  有它时页面后台期间的通知完全交给原生（叫醒即拉即弹，避免网页/原生双弹）；
 *  v91 旧壳（有轮询器但无唤醒桥、边界轮询有竞态）与浏览器 → 网页自己弹（维持原行为，
 *  不把通知让位给可能有竞态的旧轮询器——旧壳上宁可冒双弹风险也不冒漏通知风险）。 */
function hasNativeBgPoller(): boolean {
  try {
    const N = (window as unknown as { AIPhoneNative?: AIPhoneNativeBg }).AIPhoneNative;
    return !!N && typeof N.pokeBgNotify === 'function';
  } catch {
    return false;
  }
}

/** 叫醒原生轮询器立即拉一轮（v2.4.28 新桥；旧壳无此方法时静默） */
function pokeNativePoller(): void {
  try {
    const N = (window as unknown as { AIPhoneNative?: AIPhoneNativeBg }).AIPhoneNative;
    if (N && typeof N.pokeBgNotify === 'function') N.pokeBgNotify();
  } catch {
    // 静默：旧壳无此方法
  }
}

/** APK 退后台期间原生 BgNotifyPoller 已弹过 heads-up 的批次，回前台后绝不再弹（防双弹）。
 * 模块加载即同步执行（先于任何聊天页挂载/投递）：原生侧存的是服务端同构 batchKey
 * （`${sessionKey}#${count}#${hash}`），直接并入 seen 集合；对应会话再拉横幅抑制
 * （聊天页正式投递同一批时三出口全跳，与守望者自己弹过后的口径一致）。 */
function absorbNativeNotifiedBatches(): void {
  try {
    const N = (window as unknown as { AIPhoneNative?: AIPhoneNativeBg }).AIPhoneNative;
    if (!N || typeof N.consumeBgNotified !== 'function') return;
    const raw = N.consumeBgNotified();
    if (!raw) return;
    const parsed = JSON.parse(raw) as { batchKeys?: unknown };
    const keys = Array.isArray(parsed.batchKeys)
      ? parsed.batchKeys.filter((k): k is string => typeof k === 'string')
      : [];
    if (keys.length === 0) return;
    const seen = loadSeen();
    let changed = false;
    for (const bk of keys) {
      if (seen.has(bk)) continue;
      seen.add(bk);
      changed = true;
      const key = bk.split('#')[0];
      if (key) suppressSessionBanner(key);
    }
    if (changed) saveSeen(seen);
  } catch {
    // 原生桥不存在/返回异常：静默（非 APK 或旧壳）
  }
}

/** 把「服务器地址 + 通知总闸 + 免打扰」推给原生轮询器（BgNotifyPoller）：
 *  原生只在本页冻结（App 退后台）时轮询 pollNative 视图弹 heads-up；
 *  enabled=false 或免打扰开启时原生侧跳过弹通知。每次 peek 周期与回前台时
 *  同步一次（同步桥调用开销极小，免打扰/总闸切换最多一个周期内生效）。 */
function pushNativePollConfig(): void {
  try {
    const N = (window as unknown as { AIPhoneNative?: AIPhoneNativeBg }).AIPhoneNative;
    if (!N || typeof N.setBgNotifyConfig !== 'function') return;
    N.setBgNotifyConfig(
      JSON.stringify({
        url: window.location.origin,
        enabled: isSysNotifyEnabled(),
        dnd: isNotifyDndActive(),
      }),
    );
  } catch {
    // 静默：非 APK / 旧壳
  }
}

// 模块加载即吸收（PhoneShell 引入本模块，早于聊天页投递）；旧壳/浏览器零动作
if (typeof window !== 'undefined') {
  absorbNativeNotifiedBatches();
  pushNativePollConfig();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      absorbNativeNotifiedBatches();
      pushNativePollConfig();
    }
  });
}

// ---------------- 常量 ----------------

/** 兜底轮询间隔（收不到 SSE 广播的场景：多实例部署/断线重连空窗；v1.9.10 提速 20s→10s） */
const POLL_MS = 10_000;
/** 启动延迟（避开首屏挂载高峰；期间到达的接力由首次 peek 捕获；v1.9.10 提速 2.5s→0.6s） */
const START_DELAY_MS = 600;
/** 启动后首次 peek 延迟（捕获上次会话遗留的 pending；v1.9.10 提速 3s→1s，
 *  重开页面后遗留消息不再等 5.5s 才弹横幅） */
const FIRST_PEEK_DELAY_MS = 1_000;
/** bg-pending 事件抖动合并（同一时刻多会话入队只拉一次；v1.9.10 提速 300ms→120ms） */
const EVENT_DEBOUNCE_MS = 120;
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
  /** v2.4.28：服务端逐条消息（id/文本）——每条消息各弹一次通知（不合并） */
  messages?: { id: string; text: string }[];
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
    // v2.4.28（第四十七轮·后台通知双根修）：APK 新壳（带原生 BgNotifyPoller）在页面
    // 后台期间把系统通知完全交给原生轮询线程——WebView 后台 JS 可能被冻结，网页弹了
    // 也可能被系统挂起；原生侧不依赖 JS，SSE 广播到达时这里只做一件事：叫醒原生
    // 轮询器立即拉一轮（pokeBgNotify，毫秒级），不弹网页通知（防双弹）。
    // 旧壳/浏览器无轮询器 → 维持原行为：网页自己弹（逐条）。
    if (isPageBackground() && hasNativeBgPoller()) {
      pokeNativePoller();
      return;
    }
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
      if (busy.has(key) || isChatStreaming(key) || isAiDelivering(key)) continue; // 投递中：等原管线（快照也不抢写，防与投递队列交错）
      // v2.4.31 数据写入前置：先落库快照再弹通知——无论 seen 与否都落（原生轮询已弹过
      // 通知的批次，回前台 peek 时在这里补落库；按 id 去重幂等，重复 peek 零重复落库）。
      // 落库后机主点进任意入口（通知/图标/会话列表）消息都已在本地库，挂载即渲染；
      // 聊天页正式投递接管时 clearRelaySnaps 清掉快照，绝不双版本共存。
      const snapMsgs = Array.isArray(p.messages)
        ? p.messages.filter((m) => m && typeof m.id === 'string' && typeof m.text === 'string')
        : [];
      if (snapMsgs.length > 0) {
        snapRelayMessages(key, snapMsgs);
      } else {
        // 服务端旧版本无逐条 messages 字段：用首条预览落一条快照（id 用 batchKey 保幂等）
        snapRelayMessages(key, [{ id: batchKey, text: preview }]);
      }
      if (seen.has(batchKey)) continue; // 这批已弹过横幅（未投递但已告知）
      seen.add(batchKey);
      changed = true;
      // v1.9.8.1 关键：这是「新批次」（数量/首条预览变化）——先清掉旧批次的横幅抑制，
      // 否则旧抑制会把新内容的横幅吃掉（实测：首 peek 弹批次#3 并抑制会话后，
      // 5min 内到达的批次#4 横幅被吞）。清旧 → 弹新 → 重新武装，抑制永远只覆盖
      // 「已弹过横幅的当前批」，正式投递同一批时不重复弹
      clearSessionBannerSuppress(key);
      // v2.4.28（第四十七轮·逐条弹根修）：服务端带回逐条消息时每条消息各弹一次
      // （灵动岛横幅逐条排队 + 原生 localNotify 逐条 heads-up，串行间隔 2.4s）——
      // 旧实现一批只弹一条首条预览横幅，机主看到的正是「把 AI 的消息弄到一起了」。
      // 服务端旧版本无 messages 字段时回退单条预览（兼容）。
      const msgs = Array.isArray(p.messages) ? p.messages : [];
      const bodies = msgs
        .filter((m) => m && typeof m.id === 'string' && typeof m.text === 'string')
        .map((m) => truncateBody(m.text))
        .filter((t) => t.length > 0);
      if (bodies.length > 0) {
        for (const body of bodies) {
          pushChatNotification({
            sessionKey: key,
            app: parsed.app,
            title: p.title?.trim() || '新消息',
            avatar: p.avatar ?? null,
            body,
            target: parsed.target,
          });
        }
      } else {
        pushChatNotification({
          sessionKey: key,
          app: parsed.app,
          title: p.title?.trim() || '新消息',
          avatar: p.avatar ?? null,
          body: preview,
          target: parsed.target,
        });
      }
      // 正式投递同一批消息时不再重复弹（投递忙→闲跃迁或 TTL 后解除）
      suppressSessionBanner(key);
    }
    if (changed) saveSeen(seen);
    // v2.4.27：周期同步原生轮询配置（地址/总闸/免打扰）——设置变更最多一个 peek 周期内生效
    pushNativePollConfig();
  } catch {
    // 网络异常/解析失败静默：下次事件/轮询重试（消息本体在服务端队列，不丢）
  } finally {
    peekInflight = false;
    if (peekQueued) {
      peekQueued = false;
      // v1.9.17：MessageChannel 让出替代 setTimeout(50)——后台页定时器被节流时尾随重跑不再被拖慢
      void yieldToEventLoop().then(() => peekOnce());
    }
  }
}

/** 事件驱动 peek：前台 120ms 防抖合并（多会话同时入队只拉一次）；
 *  页面在后台（隐藏/失焦）时立即执行——v1.9.17：后台 setTimeout 被强节流，
 *  120ms 防抖在后台会退化成 1s 甚至 1 分钟，接力横幅「点进 APP 才弹」的直接根因之一 */
let eventTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleEventPeek(): void {
  if (isPageBackground()) {
    void peekOnce();
    return;
  }
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
  // v80 后台保活第二通道：Worker 心跳驱动的兜底轮询（页面后台时 setInterval 被节流到
  // 1 次/分钟，Worker 消息不受节流——10s 兜底轮询照常节奏，接力横幅/系统通知不再拖慢）。
  // lastPoll 与原生 setInterval 共用节奏闸，两通道不会双发同一轮。
  let lastPoll = Date.now();
  const maybePeek = (): void => {
    if (Date.now() - lastPoll < POLL_MS) return;
    lastPoll = Date.now();
    void peekOnce();
  };
  onKeepAliveTick(maybePeek);
  const pollTimer = window.setInterval(() => {
    lastPoll = Date.now();
    void peekOnce();
  }, POLL_MS);
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
