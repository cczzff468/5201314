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
 * 5. 离开网页也通知：页面不可见且浏览器支持 Web Notification 且已授权 → 发系统通知
 *    （tag 每条唯一，每条消息一个独立系统通知，不互相替换）；权限 default 时首次自动申请一次；
 *    权限 granted 后尽力注册 Service Worker + Web Push 订阅（/api/push）——
 *    页面已关闭时由服务端接力生成的回复也能逐条推送系统通知（不支持的环境静默降级）；
 *    拒绝/不支持/申请失败都不影响应用内灵动岛弹窗。
 *    设置 › 通知「允许通知」开关是系统级通道总闸（isSysNotifyEnabled，localStorage 持久化）：
 *    关闭后 Web Notification / Web Push / 预提示卡全部跳过，应用内灵动岛弹窗不受影响。
 * 6. 点击跳转：卡片点击 → switchToApp 到目标 App + 经导航总线（ISLAND_NAV_EVENT +
 *    takeNotifyNavigation）让对应聊天页打开该会话（单聊 / 群聊）；锁屏/熄屏/闹钟响铃时点击只收起不跳转。
 */

import { create } from 'zustand';
import { useUI } from './store';
import { setupPushSubscription } from './push-client';
import { showSystemNotification } from './system-notify';
import { wxChatFlags, qqChatFlags } from '@/lib/chat-flags';
import { playNotifySound } from './notify-sound';

// ---------------- 类型 ----------------

/** 通知归属 App（AppId 的聊天/生活服务子集；meituan = 订单状态通知，taobao = 淘宝订单状态通知） */
export type NotifyApp = 'wechat' | 'qq' | 'chat' | 'meituan' | 'taobao';

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

/**
 * 推送一条 AI 消息通知（每条消息独立弹窗，不合并计数）：
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

// ---------------- Web Notification（离开网页也通知；不支持/拒绝 → 应用内弹窗兜底） ----------------

/** App 图标（public 下真实图标，与主屏一致） */
export const NOTIFY_APP_ICON: Record<NotifyApp, string> = {
  wechat: '/icons/wechat.png',
  qq: '/icons/qq.png',
  chat: '/icons/chat.png',
  meituan: '/icons/meituan-app.png',
  taobao: '/icons/taobao.png',
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
  // SW showNotification 优先（Android Chrome 页面里无 Notification 构造器，直接 new 会抛
  // Illegal constructor——必须走 Service Worker 通道）；桌面无 SW 时自动落到页面构造器兜底；
  // 两条通道都不可用时返回 null → 静默降级为应用内灵动岛弹窗（已在 pushChatNotification 弹过）
  await showSystemNotification(n.title, {
    body: n.subtitle ? `【${n.subtitle}】${n.body}` : n.body,
    tag: n.id, // 每条消息一个独立系统通知（不再按会话替换合并）
    icon: await buildNotifyIcon(n),
    badge: NOTIFY_APP_ICON[n.app],
    onclick: () => navigateToNotifyTarget(n.target),
  }).catch(() => null);
}

function maybeWebNotification(n: IslandNotification): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return; // 不支持 → 应用内弹窗
  // 系统级通知总闸：用户在设置里关了「允许通知」→ Web Notification / Web Push /
  // 预提示卡全部跳过（应用内灵动岛弹窗已在 pushChatNotification 完成，不受影响）
  if (!isSysNotifyEnabled()) return;
  try {
    const perm = Notification.permission;
    if (perm === 'granted') {
      ensurePushSubscription();
      // 页面可见时灵动岛弹窗足够，不重复打扰；只有用户切走/锁屏才发系统通知
      if (document.visibilityState === 'hidden') void postWebNotification(n);
    } else if (perm === 'default' && !webPermAsked) {
      // 首次使用友好申请：不直接弹浏览器授权框，先展示应用内说明卡，
      // 用户点「开启」才 requestPermission（用户手势内触发，浏览器不会被拦）；
      // 拒绝/暂不后不再申请，应用内灵动岛弹窗不受影响
      webPermAsked = true;
      let skipped = false;
      try {
        skipped = window.localStorage.getItem(PREPROMPT_KEY) === 'later';
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

let pendingNav: { target: NotifyTarget; at: number } | null = null;

function navigateToNotifyTarget(target: NotifyTarget): void {
  const ui = useUI.getState();
  if (ui.locked || ui.screenOff) return;
  pendingNav = { target, at: Date.now() };
  ui.switchToApp(target.app);
  window.dispatchEvent(new Event(ISLAND_NAV_EVENT));
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
