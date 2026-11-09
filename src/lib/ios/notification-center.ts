'use client';

/**
 * C6 应用内通知中心 store（下拉通知栏的历史记录层）。
 *
 * 定位：local-notify.ts（系统通知统一入口）的「历史账本」——
 * 无论本次系统通知最终有没有弹出来（前台被闸门拦下 / 原生通道 / 浏览器权限未授予），
 * 都先在中心里记一条，保证「网页端没系统通知也能回看历史，不漏消息」。
 *
 * 设计要点：
 * 1. 数据结构 { id, title, body, tag?, url?, target?, icon?, ts, read }，上限 50 条（FIFO 淘汰）；
 *    同 tag 新通知「替换」旧条目（对齐 Android tag 去重心智）并置为未读。
 * 2. 持久化：localStorage（key ios-notify-center-v1），读写全程 try-catch 静默——
 *    ≤50 条小体量字符串，不需要 IndexedDB；存储不可用时退化为本次会话内存态。
 * 3. 订阅：轻量 zustand store（与 agent-voice.ts 同款 create 用法），
 *    持久化走模块级 subscribe 单点写入（items 引用变了才落盘）。
 * 4. 未读计数：unreadCountOf + useNotifyUnreadCount（返回原始 number，避免引用比较重渲染），
 *    状态栏小红点消费。
 * 5. 面板开关 open 也收在本 store：local-notify 的原生点击监听导航后可直接 closeCenter() 收面板
 *    （「store 加 close 钩子」），UI 组件只订阅不持有真相。
 * 6. 点击导航：target 走 island-notify.navigateFromSystemNotify（动态 import，避免把
 *    灵动岛大模块拖进仅用 local-notify 的入口包）；无 target 时 window.location.href = url（'/' 不跳）。
 */

import { create } from 'zustand';
// 仅类型引入（编译期擦除），不产生运行时依赖
import type { NotifyTarget } from './island-notify';

// ---------------- 类型 ----------------

/** 通知中心单条记录 */
export interface NotificationCenterItem {
  id: string;
  title: string;
  body: string;
  /** 通知 tag：同 tag 替换（Android 心智）；cancelLocalNotify 按 tag 定向移除 */
  tag?: string;
  /** 点击落地页路径（原生点击回传 / 面板条目点击共用） */
  url?: string;
  /** 2-b 原生侧点击导航 target（NotifyTarget 形状），这里按 unknown 容错透传 */
  target?: unknown;
  /** 来源应用图标（可选；缺省按 tag 映射，见 NotificationCenter.tsx appMetaOf） */
  icon?: string;
  /** 记录时间戳（相对时间展示用） */
  ts: number;
  /** 已读标记（点条目 / 全部已读 / 原生点击回传匹配后置 true） */
  read: boolean;
}

/** recordCenterNotification 的入参（与 local-notify 的 opts 对齐，target 容错 unknown） */
export interface CenterRecordInput {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  target?: unknown;
  icon?: string;
}

interface NotificationCenterState {
  items: NotificationCenterItem[];
  /** 下拉面板是否展开（UI 与原生点击监听共享的开关真相） */
  open: boolean;
  /** 记录一条（同 tag 替换旧条目并置未读；超 50 条 FIFO 淘汰） */
  add: (n: CenterRecordInput) => void;
  /** 单条删除（条目上的「清除」按钮） */
  remove: (id: string) => void;
  /** 批量删除（v1.9.2 分组组级清除：一次 set 一次落盘，避免逐条 remove 反复触发持久化订阅） */
  removeMany: (ids: string[]) => void;
  /** 按 tag 移除（cancelLocalNotify 同步撤销中心内条目） */
  removeByTag: (tag: string) => void;
  /** 按 id 置已读 */
  markRead: (id: string) => void;
  /** 按 tag 优先、url 兜底匹配置已读（原生 local-notify-open 回传只有 url/target） */
  markReadBy: (m: { tag?: string; url?: string }) => void;
  markAllRead: () => void;
  clearAll: () => void;
  openCenter: () => void;
  closeCenter: () => void;
  toggleCenter: () => void;
}

// ---------------- 常量与工具 ----------------

const STORAGE_KEY = 'ios-notify-center-v1';
/** 历史上限（FIFO 淘汰最旧） */
const MAX_ITEMS = 50;

let seq = 0;
const genId = () => `nc-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** localStorage 读取（SSR/隐私模式/损坏数据全部静默回退空表） */
function loadItems(): NotificationCenterItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // 宽松校验：仅收下形状合法的条目（老版本/脏数据容错）
    const list: NotificationCenterItem[] = [];
    for (const it of parsed) {
      const o = it as Partial<NotificationCenterItem> | null;
      if (o && typeof o.id === 'string' && typeof o.title === 'string' && typeof o.body === 'string' && typeof o.ts === 'number') {
        list.push({
          id: o.id,
          title: o.title,
          body: o.body,
          ...(o.tag ? { tag: o.tag } : {}),
          ...(o.url ? { url: o.url } : {}),
          ...(o.target !== undefined ? { target: o.target } : {}),
          ...(o.icon ? { icon: o.icon } : {}),
          ts: o.ts,
          read: o.read === true,
        });
      }
    }
    return list.slice(0, MAX_ITEMS);
  } catch {
    return []; // JSON 损坏/存储不可用：静默回退
  }
}

/** localStorage 写入（静默失败：隐私模式等场景仅本次会话生效） */
function saveItems(items: NotificationCenterItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // 静默
  }
}

/** 未读条数（store 选择器与命令式读取共用） */
export function unreadCountOf(items: NotificationCenterItem[]): number {
  let n = 0;
  for (const it of items) if (!it.read) n++;
  return n;
}

/** target 是否为 island-notify.NotifyTarget 形状（app 为必填 string；2-b 字段容错） */
export function isNotifyTarget(t: unknown): t is NotifyTarget {
  return !!t && typeof t === 'object' && typeof (t as { app?: unknown }).app === 'string';
}

// ---------------- Store ----------------

export const useNotifyCenter = create<NotificationCenterState>((set) => ({
  items: loadItems(),
  open: false,

  add: (n) =>
    set((s) => {
      const item: NotificationCenterItem = {
        id: genId(),
        title: n.title,
        body: n.body,
        ...(n.tag ? { tag: n.tag } : {}),
        ...(n.url ? { url: n.url } : {}),
        ...(n.target !== undefined ? { target: n.target } : {}),
        ...(n.icon ? { icon: n.icon } : {}),
        ts: Date.now(),
        read: false,
      };
      // 同 tag「替换」：旧条目移除、新条目置顶并置未读（对齐 Android tag 去重心智）
      const rest = n.tag ? s.items.filter((i) => i.tag !== n.tag) : s.items;
      return { items: [item, ...rest].slice(0, MAX_ITEMS) };
    }),

  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

  removeMany: (ids) => {
    if (ids.length === 0) return;
    const dead = new Set(ids);
    set((s) => ({ items: s.items.filter((i) => !dead.has(i.id)) }));
  },

  removeByTag: (tag) => {
    if (!tag) return;
    set((s) => ({ items: s.items.filter((i) => i.tag !== tag) }));
  },

  markRead: (id) =>
    set((s) => ({ items: s.items.map((i) => (i.id === id && !i.read ? { ...i, read: true } : i)) })),

  markReadBy: (m) =>
    set((s) => {
      // 匹配口径：tag 优先（同一通知的 tag 最精确）；无 tag 命中时按 url 兜底
      let hit = false;
      if (m.tag) hit = s.items.some((i) => i.tag === m.tag);
      if (!hit && m.url) hit = s.items.some((i) => i.url === m.url);
      if (!hit) return {};
      return {
        items: s.items.map((i) => {
          const match = m.tag ? i.tag === m.tag : i.url === m.url;
          return match && !i.read ? { ...i, read: true } : i;
        }),
      };
    }),

  markAllRead: () => set((s) => ({ items: s.items.map((i) => (i.read ? i : { ...i, read: true })) })),

  clearAll: () => set({ items: [] }),

  openCenter: () => set({ open: true }),
  closeCenter: () => set({ open: false }),
  toggleCenter: () => set((s) => ({ open: !s.open })),
}));

// ---------------- 持久化订阅（items 引用变化才落盘，单点收口） ----------------

if (typeof window !== 'undefined') {
  useNotifyCenter.subscribe((s, prev) => {
    if (s.items !== prev.items) saveItems(s.items);
  });
}

// ---------------- 命令式钩子（local-notify.ts 调用；非 hook 环境安全，全程静默） ----------------

/**
 * 记录一条进通知中心（notifyIfHidden 入口钩子调用）：
 * 无论前台后台、无论原生/浏览器通道、无论通知是否真弹出都会先走到这里，
 * 保证中心历史完整；同 tag 由 store.add 的替换逻辑去重并置未读。
 */
export function recordCenterNotification(n: CenterRecordInput): void {
  try {
    useNotifyCenter.getState().add(n);
  } catch {
    // 静默：记录绝不影响通知主链路
  }
}

/** 按 tag 移除中心条目（cancelLocalNotify 同步钩子调用） */
export function removeCenterByTag(tag: string): void {
  try {
    useNotifyCenter.getState().removeByTag(tag);
  } catch {
    // 静默
  }
}

// ---------------- 真 DND 总开关（v1.9.2 全局免打扰模式） ----------------

/**
 * 持久化键（localStorage）：'on' / 'off'，缺省视为 'off'（老用户无记录 = 未开启）。
 *
 * 真 DND 语义（与「声音与铃声」的提示音总开关相互独立、同时生效）：
 * 开 = 静掉「灵动岛横幅动画 + 通知声音 + 系统通知」三类出口，通知中心记录照常入账（静但不丢）；
 * 闹钟 / 提醒（ReminderWatcher）/ AI 来电与未接留言（ai-call-* / ai-vm-* 链路）豁免——
 * 用户明确要求的打扰不受 DND 影响（与 notify-sound 免打扰时段的豁免哲学一致）。
 *
 * 为什么放在本文件：DND 闸门的三个消费方（island-notify / local-notify / notify-sound）都需要它，
 * 而本模块是唯一被它们共同依赖、运行时近乎零依赖（仅 zustand）的轻模块——不会引入循环依赖，
 * 也不会把重模块拖进轻入口包（与 local-notify 只静态依赖本模块的既有设计一致）。
 */
const NOTIFY_DND_MASTER_KEY = 'ios-notify-dnd-master';

/** 真 DND 是否开启（模块级 getter，非 hook 环境安全；与 island-notify.isSysNotifyEnabled 同风格） */
export function isNotifyDndActive(): boolean {
  try {
    return window.localStorage.getItem(NOTIFY_DND_MASTER_KEY) === 'on';
  } catch {
    return false; // 存储不可用/SSR：按未开启（DND 是增强行为，缺省绝不能吞通知）
  }
}

/**
 * 轻量响应式镜像 store：设置页开关行与通知中心面板快捷开关订阅它获得跨入口即时联动。
 * 为什么不直接用 localStorage：它不是响应式源，UI 侧得各自 useState 镜像 + effect 同步
 * （既写重渲染又报 react-hooks/set-state-in-effect）；这里以 getter/setter 为持久化真相，
 * store 只是「已水合的镜像」。缺省 false 为 SSR 安全值；本模块在客户端加载即水合一次，
 * 而消费方 NotificationCenter 是 ssr:false 动态组件（水合前已就绪），无撕裂窗口。
 */
export const useNotifyDnd = create<{ on: boolean }>(() => ({ on: false }));

/** 写入真 DND 开关（设置 › 通知开关行 / 通知中心面板快捷开关调用）：先落盘再同步镜像 */
export function setNotifyDnd(on: boolean): void {
  try {
    window.localStorage.setItem(NOTIFY_DND_MASTER_KEY, on ? 'on' : 'off');
  } catch {
    // 存储不可用：仅本次会话生效
  }
  useNotifyDnd.setState({ on }); // 镜像同步：所有订阅入口即时联动（无 effect、无重渲染级联）
}

// 客户端模块加载即从 localStorage 水合镜像（闸门读 getter 不受影响；早于任何面板渲染）
if (typeof window !== 'undefined') {
  useNotifyDnd.setState({ on: isNotifyDndActive() });
}

// ---------------- 未读计数 hook（状态栏小红点用；返回原始 number 避免重渲染） ----------------

export function useNotifyUnreadCount(): number {
  return useNotifyCenter((s) => unreadCountOf(s.items));
}

// ---------------- 点击激活（面板条目 / 原生回传共用导航与收面板） ----------------

/** 单条目激活导航：target 优先走灵动岛导航总线，否则 location.href（'/' 不跳） */
function navigateForItem(item: { url?: string; target?: unknown }): void {
  if (isNotifyTarget(item.target)) {
    // 动态 import：island-notify 是重模块（推送/SSE/聊天标志等），只在真正需要导航时加载，
    // 也避免 local-notify → 本模块 → island-notify 的静态链把大模块拖进轻入口包
    void import('./island-notify')
      .then((m) => m.navigateFromSystemNotify(item.target as NotifyTarget))
      .catch(() => {
        // 动态加载失败 → url 兜底
        if (item.url && item.url !== '/') {
          try {
            window.location.href = item.url;
          } catch {
            // 静默
          }
        }
      });
    return;
  }
  if (item.url && item.url !== '/') {
    try {
      window.location.href = item.url;
    } catch {
      // 静默
    }
  }
}

/**
 * 面板内点击条目：置已读 + 收面板 + 导航（url/target）。
 * 面板关闭经由 store.open（原生监听/外部钩子同源），UI 组件订阅后自动播收起动画。
 */
export function activateCenterItem(item: NotificationCenterItem): void {
  useNotifyCenter.getState().markRead(item.id);
  useNotifyCenter.getState().closeCenter();
  navigateForItem(item);
}

/**
 * 原生 local-notify-open 回传处理（local-notify.ts 的 MessageEvent 监听调用）：
 * 按 tag/url 匹配置已读 + 导航 + 收起面板（导航后不能让面板挡住新落地的界面）。
 */
export function openCenterItem(payload: { url?: string; target?: unknown }): void {
  useNotifyCenter.getState().markReadBy({ url: payload.url });
  useNotifyCenter.getState().closeCenter();
  navigateForItem(payload);
}

// ---------------- 测试钩子（仅 dev 生效） ----------------

/**
 * 测试钩子（仅 dev）：E2E / 手工验证注入口 —— window.__ncTest.add('标题','正文',{tag,url,target})。
 * 生产构建（NODE_ENV=production）下不挂载，无任何暴露面。
 */
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  const w = window as typeof window & {
    __ncTest?: {
      add: (title: string, body: string, opts?: CenterRecordInput) => void;
      open: () => void;
      close: () => void;
      clear: () => void;
      list: () => NotificationCenterItem[];
    };
  };
  w.__ncTest = {
    add: (title, body, opts) => useNotifyCenter.getState().add({ title, body, ...opts }),
    open: () => useNotifyCenter.getState().openCenter(),
    close: () => useNotifyCenter.getState().closeCenter(),
    clear: () => useNotifyCenter.getState().clearAll(),
    list: () => useNotifyCenter.getState().items,
  };
}
