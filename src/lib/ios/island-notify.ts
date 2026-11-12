'use client';

/**
 * 全局灵动岛弹窗通知（模拟 iOS 灵动岛通知；微信 / QQ / 信息，单聊群聊共用）。
 *
 * 设计要点：
 * 1. 触发：AI 每落盘一条聊天消息（单聊 / 群聊 / 信息端 / 退群挽留私信）就 push 一次；
 *    系统行（拉黑提示/红包领取通知/凭据卡）不弹。
 * 2. 弹出：由 PhoneShell 内的 IslandNotificationLayer 渲染，卡片从灵动岛几何位
 *    （w-118 h-33 top-11 圆角胶囊）展开为通知卡；展开期间灵动岛隐藏（同一几何位无缝交接），
 *    收起动画结束后灵动岛恢复——全程无闪烁。
 * 3. 全局覆盖：层级 z-93 高于锁屏(65)/切换器(60)/闹钟(90)/状态栏(70)/灵动岛(80)，
 *    仅低于熄屏黑遮罩(95)；不阻塞操作（卡片外全部可正常交互，仅卡片本身可点击）。
 * 4. 每条消息独立弹窗（需求：每发一条信息都要有通知弹窗，不是每次回复一条）：
 *    - 同一会话短时间内多条消息 → 每条消息各弹一次（不再合并计数，后到替换展示中的前一条）；
 *    - 不同会话 → 排队逐条展示（每条 3 秒），队列上限 4 条，超出丢最旧；
 *    - 自动收起计时在页面不可见（切走标签页）或熄屏时冻结，回来自动续期。
 * 5. 离开网页也通知（v57 通知系统重进）：系统通知经 SSE 长连接（/api/notify/stream，
 *    notify-sse 模块加载即挂）广播下发——AI 每落盘一条消息 → POST /api/notify/push →
 *    服务端广播 → 页面收到 → SW registration.showNotification()（Android Chrome 页面无
 *    Notification 构造器，SW 是唯一正路；桌面无 SW 时页面构造器兑底）；通知动态携带
 *    角色头像（复合图标）/角色名字/App 图标，页面可见时同样弹出（旧版仅隐藏时发）。
 *    权限 default 时首次展示应用内说明卡（点「开启」才弹浏览器授权框）；granted 后尽力
 *    注册 SW + Web Push 订阅（/api/push）——页面已关闭时由服务端接力生成的回复也能逐条
 *    推送系统通知（不支持的环境静默降级）；拒绝/不支持/申请失败都不影响应用内灵动岛弹窗。
 *    设置 › 通知「允许通知」开关是系统级通道总闸（isSysNotifyEnabled，localStorage 持久化）：
 *    关闭后 Web Notification / Web Push / SSE 展示 / 预提示卡全部跳过，应用内灵动岛弹窗不受影响。
 * 6. 点击跳转：卡片点击 → switchToApp 到目标 App + 经导航总线（ISLAND_NAV_EVENT +
 *    takeNotifyNavigation）让对应聊天页打开该会话（单聊 / 群聊）；锁屏/熄屏/闹钟响铃时点击只收起不跳转。
 */

import { create } from 'zustand';
import { useUI } from './store';
import { setupPushSubscription } from './push-client';
import { showSystemNotification, isPageBackground } from './system-notify';
// v1.9.6 原生壳判定：APK 内每条 AI 消息直发 Android 系统通知（一条一弹）
import { isNativePerception } from './native-perception';
// v57 通知系统：SSE 长连接（服务端广播 → SW showNotification）；notify-sse 模块加载即挂连接
import { pushSysNotifyViaSse, type SseNotifyPayload } from './notify-sse';
import { wxChatFlags, qqChatFlags } from '@/lib/chat-flags';
import { playNotifySound } from './notify-sound';
// v1.9.2 真 DND 总开关 getter：pushChatNotification 在最早汇合点一次拦净三类出口
//（横幅/提示音/系统通知）；notification-center 运行时零重依赖，不会拖慢本模块加载
import { isNotifyDndActive } from './notification-center';
// v73.5：通知导航进微信单聊全屏时关闭同会话悬浮小窗/胶囊（防全屏与小窗双开同一聊天）
import { useChatFloat } from './chat-float-store';

// ---------------- 类型 ----------------

/** 通知归属 App（AppId 的聊天/生活服务子集；meituan = 订单状态通知，taobao = 淘宝订单状态通知；
 *  v1.9.35 新增 music/forum/notes/clock/weather = Web 工具操作过程卡专用（不进聊天导航链路） */
export type NotifyApp = 'wechat' | 'qq' | 'chat' | 'meituan' | 'taobao' | 'music' | 'forum' | 'notes' | 'clock' | 'weather';

/** 点击跳转目标：单聊给 contactId，群聊给 groupId（群聊宿主在 wechat/qq App 内）；
 *  meituan/taobao 订单目标 contactId = 订单 id（目标订单待支付时可带 pay=true 直达收银台，否则进订单详情） */
export interface NotifyTarget {
  app: NotifyApp;
  contactId?: string;
  groupId?: string;
  pay?: boolean;
}

/** 各端聊天 finalize 调用的通知输入（正文已由调用方按消息类型映射好占位符） */
export interface ChatNotifyInput {
  /** 合并键：会话键（wx:<id> / wx:group:<gid> / qq:<id> / qq:group:<gid> / sms:<key>） */
  sessionKey: string;
  app: NotifyApp;
  /** 角色名字（群聊 = 发言成员） */
  title: string;
  /** 副标题（群聊 = 群名） */
  subtitle?: string;
  /** 角色头像（路径或 dataURL；空展示首字符占位） */
  avatar?: string | null;
  /** 消息预览文本（调用方用 notifyPreviewText 映射，模块内再截断） */
  body: string;
  target: NotifyTarget;
}

export interface IslandNotification {
  id: string;
  /** 合并键 = sessionKey */
  mergeKey: string;
  app: NotifyApp;
  avatar: string | null;
  title: string;
  subtitle: string;
  body: string;
  /** 合并条数（同一会话连续多条 > 1 时展示） */
  count: number;
  target: NotifyTarget;
  /** v1.9.35 Web 工具操作弹窗标记：AI 动手做底层操作时灵动岛弹出的过程卡
   *  （机主需求：底层操作过程不在聊天气泡里出日志，全部改为灵动岛弹窗播报）。
   *  true 时卡片点击=收起（不跳转）、不走聊天免打扰/提示音/系统通知链路。 */
  tool?: boolean;
}

interface IslandNotifyState {
  current: IslandNotification | null;
  /** 收起动画进行中（current 仍持有，动画结束后 finishExit 恢复灵动岛 / 展示下一条） */
  exiting: boolean;
  queue: IslandNotification[];
  show: (n: IslandNotification) => void;
  mergeCurrent: (patch: Partial<IslandNotification>) => void;
  mergeQueued: (key: string, patch: Partial<IslandNotification>) => void;
  enqueue: (n: IslandNotification) => void;
  beginExit: () => void;
  finishExit: () => void;
}

// ---------------- 常量 ----------------

/** 弹窗停留时长（需求：显示时长可控，默认 3 秒后自动收起；点击可立即收起） */
export const AUTO_DISMISS_MS = 3000;
/** 不同会话排队上限（超出丢最旧，防刷屏） */
const MAX_QUEUE = 4;
/** 通知正文最大字符数 */
const BODY_MAX = 80;
/** 导航请求有效期（App 未登录等场景挂起后过期作废） */
const NAV_TTL_MS = 60_000;
/** 灵动岛胶囊几何（与 PhoneShell 静态灵动岛一致，保证无缝形变） */
export const ISLAND_PILL = { width: 118, height: 33, borderRadius: 17 } as const;

// ---------------- Store ----------------

let seq = 0;
const genNotifyId = () => `ntf-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** 收起动画完成：恢复灵动岛 / 展示队列下一条（IslandNotification 动画回调调用） */
export function finishExit(): void {
  useIslandNotify.getState().finishExit();
}

export const useIslandNotify = create<IslandNotifyState>((set, get) => ({
  current: null,
  exiting: false,
  queue: [],
  show: (n) => set({ current: n }),
  mergeCurrent: (patch) =>
    set((s) => (s.current ? { current: { ...s.current, ...patch } } : {})),
  mergeQueued: (key, patch) =>
    set((s) => {
      const idx = s.queue.findIndex((q) => q.mergeKey === key);
      if (idx < 0) return {};
      const queue = s.queue.slice();
      queue[idx] = { ...queue[idx], ...patch };
      return { queue };
    }),
  enqueue: (n) =>
    set((s) => {
      const queue = [...s.queue, n];
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
      return { queue };
    }),
  beginExit: () => {
    if (!get().current || get().exiting) return;
    clearAutoDismiss();
    set({ exiting: true });
  },
  finishExit: () => {
    const { queue } = get();
    const [next, ...rest] = queue;
    set({ current: next ?? null, queue: rest, exiting: false });
    if (next) armAutoDismiss();
  },
}));

// ---------------- 自动收起计时（页面不可见 / 熄屏时冻结，回来续期） ----------------

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function clearAutoDismiss(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

export function armAutoDismiss(): void {
  clearAutoDismiss();
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (useUI.getState().screenOff) return;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    useIslandNotify.getState().beginExit();
  }, AUTO_DISMISS_MS);
}

if (typeof window !== 'undefined') {
  // 切走标签页：冻结计时；切回：未收起的通知续期计时
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearAutoDismiss();
    } else {
      const st = useIslandNotify.getState();
      if (st.current && !st.exiting) armAutoDismiss();
    }
  });

  // 测试钩子（仅 dev）：E2E / 手工验证注入口 —— window.__islandNotifyTest.push(通知输入)
  // （与 notification-center 的 __ncTest 同模式；直接走真实 pushChatNotification 入口，
  //  生产构建被 NODE_ENV 闸挡掉，零泄漏）
  if (process.env.NODE_ENV !== 'production') {
    const w = window as unknown as {
      __islandNotifyTest?: {
        push: typeof pushChatNotification;
        state: () => unknown;
      };
    };
    w.__islandNotifyTest = {
      push: (input) => pushChatNotification(input),
      state: () => useIslandNotify.getState(),
    };
  }
}

// ---------------- 推送入口（各聊天端 finalize 调用） ----------------

export function truncateBody(s: string, max = BODY_MAX): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * 会话免打扰闸门（#15）：按 sessionKey 解析 App 前缀与会话 id，读对应 flags store 的 muted。
 * sessionKey 格式（与 ChatNotifyInput 约定一致）：`wx:<cid>` / `wx:group:<gid>` / `qq:<cid>` /
 * `qq:group:<gid>` / `sms:<key>`；群聊的标志键为 `group:<gid>`（与 wx-group/qq-group 设置页
 * 写入键一致）。微信/QQ 之外的端（信息/电话）无会话级设置总线，恒不静音。
 * 用 store 的同步 get()（非 hook 环境安全）；读不到/异常按不静音（与角标消费端默认一致）。
 */
function chatMuted(sessionKey: string): boolean {
  const m = /^(wx|qq):(group:)?(.+)$/.exec(sessionKey);
  if (!m) return false;
  try {
    const map = m[1] === 'wx' ? wxChatFlags.get() : qqChatFlags.get();
    return map[`${m[2] ?? ''}${m[3]}`]?.muted === true;
  } catch {
    return false;
  }
}

// ---------------- v1.9.8 接力守望者横幅抑制（防同一批接力消息弹两次横幅） ----------------

/**
 * 全局接力守望者（bg-relay-watcher）在消息「还没正式落盘」时就为服务端待达消息弹过横幅
 * （不点进 APP 先看到）；用户随后点进聊天页时，挂载拉取会把同一批消息经原管线正式投递，
 * 投递路径也会调 pushChatNotification —— 若不抑制，同一批消息会弹第二次横幅。
 *
 * 抑制解除（clearStaleSessionBannerSuppress，由守望者订阅 ai-delivery 状态广播调用）：
 * - 观察到该会话投递「忙 → 闲」一次（接力波已正式投完）→ 立即解除，后续新回复照常弹；
 * - 超过 TTL 未观察到投递（用户一直没进聊天页）→ 到期解除，兜底防永久静音。
 * 抑制只跳过横幅/提示音/系统通知三出口，消息落盘、未读角标、会话列表预览都不受影响。
 */
const bannerSuppressUntil = new Map<string, number>();
/** 已观察到「投递中」的抑制会话（忙→闲跃迁后解除） */
const bannerSuppressSeenBusy = new Set<string>();
/** 抑制兜底 TTL：用户始终没进聊天页时最多静音这么久 */
const BANNER_SUPPRESS_TTL_MS = 5 * 60_000;

/** 守望者弹过横幅后调用：该会话后续 pushChatNotification 三出口全部跳过（直到解除/TTL） */
export function suppressSessionBanner(sessionKey: string): void {
  bannerSuppressUntil.set(sessionKey, Date.now() + BANNER_SUPPRESS_TTL_MS);
  bannerSuppressSeenBusy.delete(sessionKey);
}

/** 显式解除（预留；常规解除走 clearStaleSessionBannerSuppress） */
export function clearSessionBannerSuppress(sessionKey: string): void {
  bannerSuppressUntil.delete(sessionKey);
  bannerSuppressSeenBusy.delete(sessionKey);
}

/**
 * 投递状态广播回调：busyKeys = getDeliveringSessionKeys() 快照。
 * 对每个抑制中的会话：先记录「已观察到忙」，再观察到闲（同一波投递排空）即解除；
 * TTL 到期的无条件解除。只在有抑制条目时才有开销（常态 Map 为空，O(1) 返回）。
 */
export function clearStaleSessionBannerSuppress(busyKeys: readonly string[]): void {
  if (bannerSuppressUntil.size === 0) return;
  const busy = new Set(busyKeys);
  const now = Date.now();
  for (const [key, until] of [...bannerSuppressUntil]) {
    if (now >= until) {
      bannerSuppressUntil.delete(key);
      bannerSuppressSeenBusy.delete(key);
      continue;
    }
    if (busy.has(key)) {
      bannerSuppressSeenBusy.add(key);
    } else if (bannerSuppressSeenBusy.has(key)) {
      bannerSuppressUntil.delete(key);
      bannerSuppressSeenBusy.delete(key);
    }
  }
}

function isSessionBannerSuppressed(sessionKey: string): boolean {
  const until = bannerSuppressUntil.get(sessionKey);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    bannerSuppressUntil.delete(sessionKey);
    bannerSuppressSeenBusy.delete(sessionKey);
    return false;
  }
  return true;
}

/**
 * 推送一条 AI 消息通知（每条消息独立弹窗，不合并计数）：
 * v1.9.12「正在输入」实时活动已按机主要求整体下线：通知只在真实消息落盘时弹一条，
 * 不再有「正在输入…」占位卡；后台体感延迟由 ai-delivery 的快速投递（会话没被看着时
 * 跳过打字节奏）压到最短，见 ai-delivery.shouldFastDeliver。
 * v1.9.16 前台闸细化（修复 v1.9.12 两处回归）：
 * - 「App 正被看着」（页面可见 + 未锁屏 + 停在所属 App）→ 不弹横幅不发系统通知，
 *   但提示音照常响（v1.9.12 把铃声一并吞了，机主反馈「通知铃声不响了」）；
 * - 页面已退真实后台（切走标签页/切 App/锁真机屏）→ 绝不被前台闸拦，照常发系统通知
 *   （v1.9.12 的闸没看页面可见性，activeApp 停在目标 App 时退后台收不到通知）。
 * - 会话开了「消息免打扰」（#15）→ 灵动岛弹层与 Web Notification 全部跳过
 *   （未读角标/会话列表逻辑由各自消费端处理，不受本闸门影响）；
 * - 有正在展示的通知 → 直接替换为本次内容（旧条立即让位，视觉上每条消息都弹了一次）；
 * - 无正在展示的 → 立即展示；否则入队排队（不同会话轮流展示）。
 * 页面不可见时同时走 Web Notification 通道（支持且已授权时，每条一个独立系统通知）。
 */
export function pushChatNotification(input: ChatNotifyInput): void {
  const body = truncateBody(input.body);
  if (!body) return;
  if (chatMuted(input.sessionKey)) return; // 消息免打扰：不弹灵动岛、不发系统通知（#15）
  // v1.9.2 真 DND：总开关开启时，聊天消息的三类出口（灵动岛横幅动画 / 提示音 / 系统通知）
  // 在这个最早汇合点一次拦净——下游 playNotifySound 与 maybeWebNotification（SSE/SW/
  // 原生兑底）都只在本函数内被调，提前 return 即全覆盖。未读角标/会话列表由各自消费端
  // 处理不受影响；聊天消息本就不入通知中心历史（中心唯一入口是 local-notify.notifyIfHidden），
  // 不存在「丢记录」问题，无需再走记录钩子。
  if (isNotifyDndActive()) return;
  // v1.9.8 接力守望者抑制：守望者已为该会话的服务端待达消息弹过横幅/提示音/系统通知，
  // 聊天页正式投递同一批消息时三出口跳过（消息落盘、未读角标不受影响，见上方注释）
  if (isSessionBannerSuppressed(input.sessionKey)) return;
  // v1.9.16 前台闸细化（修复 v1.9.12 两处回归：App 内铃声不响 + 退后台系统通知不显示）：
  // - 「App 正被看着」= 页面可见（未退真实后台）+ 未锁屏未熄屏 + 停在所属 App：
  //   只跳过横幅与系统通知（iOS 前台语义），提示音照常响——v1.9.12 把铃声一并吞了，
  //   机主反馈「通知铃声不响了」，本版回归：App 内收消息照响铃，横幅照旧不弹；
  // - 页面已退真实后台（切走标签页/切 App/锁真机屏，visibilityState=hidden）时绝不能被
  //   本闸吞掉——此时 activeApp 可能仍停在目标 App（模拟器状态不随页面隐藏复位），
  //   必须照常走完整管线（横幅冻结计时 + 系统通知），机主退后台就能收到通知栏通知
  if (typeof window !== 'undefined') {
    const ui = useUI.getState();
    const pageHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (!ui.locked && !ui.screenOff && !pageHidden && ui.activeApp === input.target.app) {
      // App 正被看着：提示音照常（回归铃声）；横幅与系统通知跳过（iOS 前台语义）
      playNotifySound(input.sessionKey.includes(':group:') ? 'group' : 'receive');
      return;
    }
  }
  // 通知提示音（设置 › 通知可配）：群会话走「群消息」，其余走「接收消息」；
  // 声音闸门（总开关/分类开关/免打扰）由 playNotifySound 内部判定——静音时弹窗与记录照常
  playNotifySound(input.sessionKey.includes(':group:') ? 'group' : 'receive');
  const st = useIslandNotify.getState();
  const n: IslandNotification = {
    id: genNotifyId(),
    mergeKey: input.sessionKey,
    app: input.app,
    avatar: input.avatar ?? null,
    title: input.title,
    subtitle: input.subtitle ?? '',
    body,
    count: 1,
    target: input.target,
  };
  if (!st.current && !st.exiting) {
    st.show(n);
    armAutoDismiss();
  } else {
    // 展示中/收起动画中：直接顶替当前（当前条未展示完也算弹过了）→ 每条消息都有一次弹出
    if (st.current) {
      st.show(n);
      if (!st.exiting) armAutoDismiss();
    } else {
      st.enqueue(n);
    }
  }
  maybeWebNotification(n);
}

// ---------------- Web 工具操作弹窗（v1.9.35：底层操作过程灵动岛播报） ----------------

/**
 * AI 调用 Web 工具（发消息/发帖/放歌/记备忘录/定闹钟…）时，每一次底层操作都从
 * 灵动岛弹出一张过程卡（机主需求：聊天气泡里严禁出现操作日志，过程全部走这里）。
 *
 * 与聊天通知的差异：
 * - 不走聊天免打扰 / DND / 提示音 / Web 系统通知链路（这是界面反馈不是消息）；
 * - 卡片点击 = 直接收起（不跳转任何会话）；
 * - 同一时间最多排队 4 条（复用聊天通知队列上限，防工具链刷屏）。
 */
export function pushToolIslandCard(input: { app?: NotifyApp; title: string; body: string; avatar?: string | null }): void {
  if (typeof window === 'undefined') return;
  const body = truncateBody(input.body, 100);
  if (!body && !input.title.trim()) return;
  const st = useIslandNotify.getState();
  const n: IslandNotification = {
    id: genNotifyId(),
    mergeKey: 'tool-op',
    app: input.app ?? 'chat',
    avatar: input.avatar ?? null,
    title: truncateBody(input.title, 24),
    subtitle: '',
    body: body || '…',
    count: 1,
    target: { app: input.app ?? 'chat' },
    tool: true,
  };
  if (!st.current && !st.exiting) {
    st.show(n);
    armAutoDismiss();
  } else if (st.current) {
    st.show(n);
    if (!st.exiting) armAutoDismiss();
  } else {
    st.enqueue(n);
  }
}

// ---------------- Web Notification（离开网页也通知；不支持/拒绝 → 应用内弹窗兜底） ----------------

/** App 图标（public 下真实图标，与主屏一致；music/forum/notes/clock/weather 为工具过程卡角标用） */
export const NOTIFY_APP_ICON: Record<NotifyApp, string> = {
  wechat: '/icons/wechat.png',
  qq: '/icons/qq.png',
  chat: '/icons/chat.png',
  meituan: '/icons/meituan-app.png',
  taobao: '/icons/taobao.png',
  music: '/icons/music.png',
  forum: '/icons/forum.png',
  notes: '/icons/notes.png',
  clock: '/icons/clock.png',
  weather: '/icons/weather.png',
};

let webPermAsked = false;

// ---------------- 友好权限申请（首次使用：应用内说明卡 → 用户点「开启」才弹浏览器授权框） ----------------

/**
 * 首次使用时不直接弹浏览器授权框（无说明、无用户手势，容易被浏览器拦/被用户误拒），
 * 先展示应用内说明卡（NotifyPermissionCard 渲染），用户点「开启通知」才 requestPermission。
 * 点「暂不」写入 localStorage，本浏览器不再主动弹（设置›通知页随时可开）。
 */
const PREPROMPT_KEY = 'ios-notify-preprompt';

// ---------------- 系统级通知偏好（设置 › 通知「允许通知」开关；只管系统级通道） ----------------

/**
 * 持久化偏好键（localStorage）：'on' / 'off'，缺省视为 'on'（老用户无记录 = 开）。
 * 这是「系统级通知总闸」：只管 Web Notification / Web Push / 预提示卡；
 * 应用内灵动岛弹窗（模拟 iOS 锁屏通知）不经过此闸门。
 * 修复：原实现开关只是设置页组件局部 state，退出页面即失效，
 * 关闭后切走标签页 Web Notification 照弹、离线 Web Push 照推。
 */
const SYS_NOTIFY_KEY = 'ios-sys-notify-enabled';

/** 系统级通知是否开启（Web Notification / Web Push 投递前必须过此闸门） */
export function isSysNotifyEnabled(): boolean {
  try {
    return window.localStorage.getItem(SYS_NOTIFY_KEY) !== 'off';
  } catch {
    return true; // 存储不可用：保持默认开（与历史行为一致）
  }
}

/** 写入系统级通知偏好（设置 › 通知开关切换时调用） */
export function setSysNotifyEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(SYS_NOTIFY_KEY, on ? 'on' : 'off');
  } catch {
    // 存储不可用：仅本次会话生效
  }
}

interface NotifyPromptState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

export const useNotifyPrompt = create<NotifyPromptState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

/** 用户在预提示卡点「暂不」后调用：本浏览器不再主动弹（设置页开关仍可用） */
export function dismissNotifyPrompt(): void {
  try {
    window.localStorage.setItem(PREPROMPT_KEY, 'later');
  } catch {
    // 存储不可用：仅本次会话不再弹（webPermAsked 已挡）
  }
  useNotifyPrompt.getState().hide();
}

/** 浏览器授权申请（预提示卡「开启」按钮调用；成功后顺带完成 Web Push 订阅） */
export async function requestNotifyPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    const p = await Notification.requestPermission();
    if (p === 'granted') ensurePushSubscription();
    return p;
  } catch {
    return 'unsupported';
  }
}

/**
 * Web Notification 复合图标：角色头像圆底 + App 来源图标角标（右下角白圈），
 * 满足「通知内容包含 App 来源图标」。合成结果按 头像+App 缓存；头像缺失/画布不可用时
 * 降级为 App 图标（与旧行为一致）。
 */
const compositeIconCache = new Map<string, string>();
/** LRU 上限（#59）：合成图标是 dataURL（约 1~3KB/条），无淘汰上限长会话持续增长。32 条足够多角色×多 App 命中。 */
const COMPOSITE_ICON_CACHE_MAX = 32;

function compositeIconCacheGet(key: string): string | undefined {
  const v = compositeIconCache.get(key);
  if (v !== undefined) {
    // 命中后重插使其成为最新（Map 迭代序 = 插入序）
    compositeIconCache.delete(key);
    compositeIconCache.set(key, v);
  }
  return v;
}

function compositeIconCacheSet(key: string, value: string): void {
  if (compositeIconCache.has(key)) compositeIconCache.delete(key);
  compositeIconCache.set(key, value);
  while (compositeIconCache.size > COMPOSITE_ICON_CACHE_MAX) {
    const oldest = compositeIconCache.keys().next().value;
    if (oldest === undefined) break;
    compositeIconCache.delete(oldest);
  }
}

async function buildNotifyIcon(n: IslandNotification): Promise<string> {
  const appIcon = NOTIFY_APP_ICON[n.app];
  if (!n.avatar) return appIcon; // 无头像：直接用 App 图标
  const key = `${n.app}|${n.avatar}`;
  const cached = compositeIconCacheGet(key);
  if (cached) return cached;
  try {
    const [avatarImg, appImg] = await Promise.all(
      [n.avatar, appIcon].map(
        (src) =>
          new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const done = (v: HTMLImageElement | null) => resolve(v);
            const t = setTimeout(() => done(null), 600);
            img.onload = () => {
              clearTimeout(t);
              done(img);
            };
            img.onerror = () => {
              clearTimeout(t);
              done(null);
            };
            img.src = src;
          }),
      ),
    );
    if (!avatarImg || !appImg) return n.avatar; // 任一图加载失败：退回头像原图
    const S = 144;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    if (!ctx) return n.avatar;
    // 角色头像：圆形裁切铺满
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    const side = Math.min(avatarImg.width, avatarImg.height);
    ctx.drawImage(
      avatarImg,
      (avatarImg.width - side) / 2,
      (avatarImg.height - side) / 2,
      side,
      side,
      0,
      0,
      S,
      S,
    );
    ctx.restore();
    // App 来源角标：右下角圆角方块 + 白色描边（与灵动岛通知卡同构）
    const badge = Math.round(S * 0.36);
    const bx = S - badge - 2;
    const by = S - badge - 2;
    const r = Math.round(badge * 0.24);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(bx - 3, by - 3, badge + 6, badge + 6, r + 3);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(bx, by, badge, badge, r);
    ctx.clip();
    ctx.drawImage(appImg, bx, by, badge, badge);
    ctx.restore();
    const url = canvas.toDataURL('image/png');
    compositeIconCacheSet(key, url);
    return url;
  } catch {
    return n.avatar;
  }
}

async function postWebNotification(n: IslandNotification): Promise<void> {
  // v75 通知系统重进：复合图标（角色头像圆底 + App 角标）→ 载荷 → 优先经 SSE 长连接广播
  //（POST /api/notify/push → notify-bus 广播 → 页面 EventSource 收到 → SW showNotification）——
  // 通知动态携带：角色头像（icon）、角色名字（title）、App 图标（badge）；
  // 广播通道异常时直发兜底（同一条 showSystemNotification，SW 通道优先的全平台一致行为不变）
  // v75：target（点击跳转目标）随载荷透传——sw.js notificationclick 读到后 postMessage
  // 回页面导航总线，实现「点击系统通知唤起浏览器并跳回对应聊天界面」
  const body = n.subtitle ? `【${n.subtitle}】${n.body}` : n.body;
  const payload: SseNotifyPayload = {
    title: n.title,
    body,
    tag: n.id, // 每条消息一个独立系统通知（不再按会话替换合并）
    icon: await buildNotifyIcon(n),
    badge: NOTIFY_APP_ICON[n.app],
    target: n.target,
  };
  const viaSse = await pushSysNotifyViaSse(payload);
  if (!viaSse) {
    await showSystemNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: payload.icon,
      badge: payload.badge,
      data: { target: n.target },
      // 页面构造器兜底通道（桌面）：点击 → 直达目标会话（与 SW/原生通道同语义）
      onclick: () => navigateFromSystemNotify(n.target),
    }).catch(() => null);
  }
}

function maybeWebNotification(n: IslandNotification): void {
  // v1.9.6 原生壳（APK）内每条 AI 消息直发 Android 系统通知——一条一弹，有几条消息弹几条：
  // 用户实测根因（测试通知正常、真实消息从不弹）：
  // ① WebView 里 Notification.permission 恒 'denied'（Web API 不映射 Android 运行时权限）
  //    → 下方 Web 分支（perm === 'granted'）永不命中；
  // ② 机主正在使用 APP 时 isPageBackground() 恒 false → 即使有权限也被前台闸拦死。
  // 原生壳不走 Web 通道：showSystemNotification 首选 NativePerception.localNotify（通知栏
  // 即达，双权限闸在原生侧）；tag = chat-<通知id> 每条消息唯一 → Android 按 (tag,hashCode)
  // 独立堆叠，不替换先发（一条消息一条通知）。点击 target 透传 → 原生回传
  // 'local-notify-open' → openCenterItem → navigateFromSystemNotify 精确切到会话。
  // 应用内灵动岛弹窗（pushChatNotification 前半段）不受影响，照常逐条弹。
  if (isNativePerception()) {
    // v1.9.12 机主需求：机主正在用 APP（页面可见）时不发 Android 系统通知——前台提醒由
    // 应用内灵动岛横幅负责；只有 APP 退到后台（页面不可见）才走系统通知栏
    if (!isPageBackground()) return;
    void showSystemNotification(n.title, {
      body: n.subtitle ? `【${n.subtitle}】${n.body}` : n.body,
      tag: `chat-${n.id}`,
      data: { target: n.target },
    }).catch(() => null);
    return;
  }
  if (typeof window === 'undefined' || !('Notification' in window)) return; // 不支持 → 应用内弹窗
  // 系统级通知总闸：用户在设置里关了「允许通知」→ Web Notification / Web Push /
  // 预提示卡全部跳过（应用内灵动岛弹窗已在 pushChatNotification 完成，不受影响）
  if (!isSysNotifyEnabled()) return;
  try {
    const perm = Notification.permission;
    if (perm === 'granted') {
      ensurePushSubscription();
      // v75 修复通知触发方向（原逻辑写反了：前台也狂发系统通知 → 刷屏）：
      // 前台（用户正看着网页）→ 不弹任何系统通知（应用内灵动岛弹窗已足够）；
      // 后台（切走标签页/切 App/锁屏/切到别的窗口）→ 才经 SSE/SW 弹真实系统通知。
      // 判定见 system-notify.isPageBackground（visibilityState + focus/blur 双信号）。
      if (!isPageBackground()) return;
      void postWebNotification(n);
    } else if (perm === 'default' && !webPermAsked) {
      // 首次使用友好申请：不直接弹浏览器授权框，先展示应用内说明卡，
      // 用户点「开启」才 requestPermission（用户手势内触发，浏览器不会被拦）；
      // 拒绝/暂不后不再申请，应用内灵动岛弹窗不受影响
      webPermAsked = true;
      let skipped = false;
      try {
        skipped = window.localStorage.getItem(PREPROMPT_KEY) === 'later';
        // 预览面板 iframe 里的引导卡有独立静音键（ios-notify-iframe-hint）：iframe 里关过
        // 引导只静音 iframe 场景，不影响新标签页里正常申请卡的弹出（两张卡职责不同）
        if (!skipped) {
          let inIframe = false;
          try {
            inIframe = window.self !== window.top;
          } catch {
            inIframe = true;
          }
          if (inIframe && window.localStorage.getItem('ios-notify-iframe-hint') === 'later') {
            skipped = true;
          }
        }
      } catch {
        // 存储不可用：仍展示一次预提示
      }
      if (!skipped) useNotifyPrompt.getState().show();
    }
  } catch {
    // 权限查询异常（旧浏览器）静默降级
  }
}

/** Web Push 订阅（权限 granted 后尽力一次；不支持/iframe 环境静默失败；关闭偏好时不订阅） */
let pushSetupDone = false;
function ensurePushSubscription(): void {
  if (pushSetupDone) return;
  pushSetupDone = true;
  if (!isSysNotifyEnabled()) return; // 设置里关了系统通知：不订阅（重开走设置页 force 路径）
  void setupPushSubscription();
}

if (
  typeof window !== 'undefined' &&
  typeof Notification !== 'undefined' &&
  Notification.permission === 'granted' &&
  isSysNotifyEnabled()
) {
  // 页面加载时权限已授予（上次会话授权过）：启动即订阅，不等到第一条 AI 消息才补 ——
  // 否则关页期间的接力回复永远没有订阅者可推（系统通知不弹的直接原因之一）
  ensurePushSubscription();
}

// ---------------- 点击导航总线 ----------------

/** 导航事件名（已挂载的聊天页监听；新挂载的聊天页挂载时消费 pending） */
export const ISLAND_NAV_EVENT = 'island-notify-nav';

/** 锁屏/熄屏时点系统通知：意图挂起，解锁/亮屏后补跳（60s 内有效） */
let pendingNav: { target: NotifyTarget; at: number } | null = null;

/** 实际执行通知导航：切 App + 关同会话悬浮小窗 + 广播导航事件（由聊天页消费打开会话） */
function runNotifyNav(target: NotifyTarget): void {
  const ui = useUI.getState();
  ui.switchToApp(target.app);
  // v73.5：目标为微信单聊全屏会话时，同一会话的悬浮小窗/胶囊一并关闭——
  // 「进入聊天」（通知菜单）与小窗同屏双开会话冗余；不同会话的小窗不受影响（浮着正是它的意义）。
  // 群聊 target 无 contactId 天然跳过；ChatFloatWindow.maximize 也走这里（其自带 close 变为幂等）
  if (target.app === 'wechat' && target.contactId) {
    const fl = useChatFloat.getState();
    if (fl.contactId === target.contactId) fl.close();
  }
  window.dispatchEvent(new Event(ISLAND_NAV_EVENT));
}

function navigateToNotifyTarget(target: NotifyTarget): void {
  const ui = useUI.getState();
  if (ui.locked || ui.screenOff) return;
  pendingNav = { target, at: Date.now() };
  runNotifyNav(target);
}

/**
 * v75 系统通知点击导航（sw.js postMessage / 开机 #notify= hash 消费共用）：
 * 与应用内卡片点击的差异——锁屏/熄屏时**先记下意图**（不丢弃），用户解锁/亮屏后
 * 由下方订阅补跳（系统通知唤起浏览器时手机常处于锁屏态，直接丢意图会让点击失效）。
 * 通知中心面板内点击条目仍直达（iOS 语义：点开即进 App）。
 */
function navigateFromSystemNotify(target: NotifyTarget): void {
  if (!target || typeof target.app !== 'string') return;
  pendingNav = { target, at: Date.now() };
  const ui = useUI.getState();
  if (!ui.locked && !ui.screenOff) runNotifyNav(target);
}

// C6 应用内通知中心：本函数需被 notification-center.ts（原生 local-notify-open 回传导航）复用
export { navigateFromSystemNotify };

// v75 解锁/亮屏补跳：系统通知点击时手机在锁屏态 → 意图已挂起，解锁/亮屏的瞬间落地
//（60s 内有效，与 takeNotifyNavigation 同口径；订阅挂 useUI 状态变化）
if (typeof window !== 'undefined') {
  useUI.subscribe((s, prev) => {
    const woke = (prev.locked && !s.locked) || (prev.screenOff && !s.screenOff);
    if (!woke) return;
    const p = pendingNav;
    if (p && Date.now() - p.at <= NAV_TTL_MS && p.target.app) {
      pendingNav = null;
      navigateFromSystemNotify(p.target);
    }
  });

  // v75 SW 点击消息监听：sw.js notificationclick → client.postMessage({type:'notify-nav',target})
  // → 走系统通知导航（含锁屏意图挂起）——「点击系统通知唤起浏览器并跳回对应聊天界面」的接收端
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (ev: MessageEvent) => {
      const d = ev.data as { type?: string; target?: NotifyTarget } | null;
      if (d && d.type === 'notify-nav' && d.target) navigateFromSystemNotify(d.target);
    });
  }

  // v75 开机 hash 消费：sw.js 无已开窗口时 openWindow('/#notify=<encoded>') 新开页面——
  // 应用启动后消费该 hash 跳到对应聊天（手机启动默认锁屏 → 意图挂起，解锁后补跳）
  // 提取为 consumeNotifyHash —— 模块加载、hashchange（后置设置 hash 的启动器工具）各消费一次
  const consumeNotifyHash = (): void => {
    try {
      const hm = /[#&]notify=([^&]+)/.exec(window.location.hash);
      if (!hm) return;
      const parsed: unknown = JSON.parse(decodeURIComponent(hm[1]));
      // 清掉 hash 防刷新重复跳转
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      const isNotifyTarget = (v: unknown): v is NotifyTarget =>
        !!v && typeof v === 'object' && typeof (v as NotifyTarget).app === 'string';
      // 裸 target（v75 基线格式）；兼容 {target} 包装形态——统一直达会话
      const t = isNotifyTarget(parsed)
        ? parsed
        : isNotifyTarget((parsed as { target?: unknown } | null)?.target)
          ? (parsed as { target: NotifyTarget }).target
          : null;
      if (t) window.setTimeout(() => navigateFromSystemNotify(t), 900);
    } catch {
      /* 非法 hash 静默忽略 */
    }
  };
  consumeNotifyHash();
  window.addEventListener('hashchange', consumeNotifyHash);
}

/** 点击通知卡片：跳转目标会话（锁屏/熄屏/闹钟时只收起不跳转）+ 收起弹窗 */
export function activateCurrentNotification(): void {
  const cur = useIslandNotify.getState().current;
  if (!cur) return;
  navigateToNotifyTarget(cur.target);
  useIslandNotify.getState().beginExit();
}

/**
 * 聊天页消费导航请求（挂载时 + 收到 ISLAND_NAV_EVENT 时各调一次）：
 * 只取属于本 App 的目标并清空 pending；不属于则原样保留给目标 App。
 * 挂起超过 60s 过期作废，避免陈旧跳转。
 */
export function takeNotifyNavigation(app: NotifyApp): NotifyTarget | null {
  if (!pendingNav || pendingNav.target.app !== app) return null;
  if (Date.now() - pendingNav.at > NAV_TTL_MS) {
    pendingNav = null;
    return null;
  }
  const t = pendingNav.target;
  pendingNav = null;
  return t;
}

/**
 * 通话层跳转入口（QQ 来电「消息回复」/ 电话来电「短信回复」共用）：
 * 与通知卡片点击完全同一套导航协议——写 pendingNav + switchToApp + 派发导航事件：
 * 目标 App 未打开时由其挂载后消费 pending，已打开时事件驱动立即打开会话。
 * 锁屏/熄屏时不跳转（与通知点击一致）。
 */
export function navigateToChatSession(app: NotifyApp, contactId: string, opts?: { pay?: boolean }): void {
  navigateToNotifyTarget({ app, contactId, pay: opts?.pay });
}

// ---------------- 消息 → 通知预览文本（各端共用映射；返回 null = 不弹） ----------------

export interface NotifyMsgInfo {
  /** 消息种类（各端 kind；缺省 = 文本） */
  kind?: string;
  /** 文本内容（语音消息为空串） */
  content?: string;
  /** 语音转写/朗读原文（kind='voice' 时优先展示） */
  voiceText?: string | null;
  /** 红包/转账金额 */
  amount?: number | null;
  /** 红包祝福语 */
  blessing?: string | null;
  /** 转账留言 */
  note?: string | null;
  /** 合并转发（kind='forward' 时展示为 [聊天记录]） */
  mergedFwd?: boolean;
}

/** 通知预览文本映射（与各端会话列表预览口径一致）；系统行/凭据卡返回 null（不弹通知） */
export function notifyPreviewText(m: NotifyMsgInfo): string | null {
  switch (m.kind) {
    case 'sys':
    case 'notice':
    case 'blockreq':
      return null;
    case 'image':
      return '[图片]';
    case 'voice':
      // 语音消息预览只显示[语音]（iOS 原生行为）：不透出转写原文，与各端会话列表预览口径一致
      return '[语音]';
    case 'redpacket':
      return m.amount != null ? `[红包] ¥${m.amount}${m.blessing ? ` ${m.blessing}` : ''}` : '[红包]';
    case 'transfer':
      return m.amount != null ? `[转账] ¥${m.amount}${m.note ? ` ${m.note}` : ''}` : '[转账]';
    case 'family':
      return '[亲属卡]';
    case 'location':
      return '[位置]';
    case 'sticker':
      return '[表情]';
    case 'forward':
      return m.mergedFwd ? '[聊天记录]' : m.content?.trim() || '[转发]';
    case 'groupcard':
      return '[群聊邀请]';
    case 'relcard':
      return '[亲密关系]';
    case 'forumshare':
      // X论坛帖子分享卡：预览显示卡片标题（content 已带帖子摘要），无 content 兜底卡片名
      return m.content?.trim() || '[X论坛帖子]';
    default:
      return m.content?.trim() || null;
  }
}
