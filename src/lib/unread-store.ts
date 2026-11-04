'use client';

/**
 * 会话未读计数总线（微信 / QQ 共用）：
 * - localStorage 持久化（wx-chat-unreads / qq-chat-unreads），旧版布尔 true 迁移为 1
 * - 多账号（Task 42）：存储键按「对应 App 当前账号」自动作用域（accLs，wx-/qq- 前缀映射），
 *   并监听账号切换事件重载内存快照——未读角标跟随账号隔离，切换账号不残留上一个账号的角标
 * - 组件通过 useUnreadMap 订阅：会话列表行角标、聊天页返回键角标、底部 tab 角标、
 *   主屏 App 图标角标实时同步
 * - 新消息 bump(id)，进聊天 clear(id)，长按菜单「标为未读/已读」toggle(id)
 */
import { useSyncExternalStore } from 'react';
import { ACCOUNT_CHANGED_EVENT, accLs, accountAppOfKey } from '@/lib/ios/accounts';

export type UnreadMap = Record<string, number>;

const EMPTY: UnreadMap = {};

function loadMap(lsKey: string): UnreadMap {
  try {
    const raw = window.localStorage.getItem(lsKey);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: UnreadMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === true) out[k] = 1;
      else if (typeof v === 'number' && Number.isFinite(v) && v >= 1) out[k] = Math.floor(v);
    }
    return out;
  } catch {
    return {};
  }
}

export interface UnreadStore {
  /** 当前未读表（引用稳定，仅在变更时更换，可安全用作 getSnapshot） */
  get: () => UnreadMap;
  /** 订阅变更（useSyncExternalStore 用），返回退订函数 */
  subscribe: (fn: () => void) => () => void;
  /** 未读 +by（好友来信；封顶 99） */
  bump: (id: string, by?: number) => void;
  /** 清除某人未读（进聊天 / 删除会话） */
  clear: (id: string) => void;
  /** 无未读 → 置 1（标为未读）；有未读 → 清除（标为已读） */
  toggle: (id: string) => void;
  /** 未读总数（可排除某会话：聊天页返回键角标排除当前聊天） */
  total: (excludeId?: string) => number;
  /** 清理幽灵未读：只保留 validIds 里的会话（隐藏会话/已删联系人残留会导致角标卡死无法清除，
   *  App 挂载时用当前可见会话列表 prune 一次；无变化时不写入不通知，可安全放进 useEffect） */
  prune: (validIds: Iterable<string>) => void;
}

export function createUnreadStore(baseKey: string): UnreadStore {
  // 多账号：存储键按对应 App 当前账号作用域（大号原键旧数据零迁移；小号/匿名号各存各的）；
  // 账号切换事件到达时重载新账号的快照并广播（各 App 角标即时切换为当前账号数据）
  const app = accountAppOfKey(baseKey);
  const effKey = () => (app ? accLs(baseKey, app) : baseKey);
  let curKey = effKey();
  let map: UnreadMap = loadMap(curKey);
  const subs = new Set<() => void>();
  const persist = () => {
    try {
      window.localStorage.setItem(curKey, JSON.stringify(map));
    } catch {
      // 持久化失败忽略
    }
  };
  const emit = () => subs.forEach((fn) => fn());
  if (app && typeof window !== 'undefined') {
    window.addEventListener(ACCOUNT_CHANGED_EVENT, (e: Event) => {
      const d = (e as CustomEvent<{ app?: string; id?: string }>).detail;
      if (!d || d.app !== app) return;
      const nextKey = effKey();
      if (nextKey === curKey) return;
      curKey = nextKey;
      map = loadMap(curKey);
      emit();
    });
  }
  return {
    get: () => map,
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    bump(id, by = 1) {
      map = { ...map, [id]: Math.min((map[id] ?? 0) + by, 99) };
      persist();
      emit();
    },
    clear(id) {
      if (map[id] === undefined) return;
      const next = { ...map };
      delete next[id];
      map = next;
      persist();
      emit();
    },
    toggle(id) {
      if (map[id] !== undefined) {
        const next = { ...map };
        delete next[id];
        map = next;
      } else {
        map = { ...map, [id]: 1 };
      }
      persist();
      emit();
    },
    total(excludeId) {
      let sum = 0;
      for (const [id, n] of Object.entries(map)) {
        if (id !== excludeId && n > 0) sum += n;
      }
      return sum;
    },
    prune(validIds) {
      const keep = new Set(validIds);
      const next: UnreadMap = {};
      let changed = false;
      for (const [id, n] of Object.entries(map)) {
        if (keep.has(id)) next[id] = n;
        else changed = true;
      }
      if (!changed) return;
      map = next;
      persist();
      emit();
    },
  };
}

/** 组件侧订阅：SSR 用空表快照避免水合不一致，客户端挂载后即取真实数据 */
export function useUnreadMap(store: UnreadStore): UnreadMap {
  return useSyncExternalStore(
    store.subscribe,
    store.get,
    () => EMPTY
  );
}

/** 订阅未读总数（主屏微信/QQ 图标角标用）：SSR 为 0，客户端挂载后即取真实数据 */
export function useUnreadTotal(store: UnreadStore): number {
  const map = useUnreadMap(store);
  let sum = 0;
  for (const n of Object.values(map)) {
    if (n > 0) sum += n;
  }
  return sum;
}

/** 微信会话未读单例（微信 App 与主屏图标角标共用同一实例，实时同步） */
export const wxUnreads = createUnreadStore('wx-chat-unreads');
/** QQ 会话未读单例（QQ App 与主屏图标角标共用同一实例，实时同步） */
export const qqUnreads = createUnreadStore('qq-chat-unreads');

// ---------------- 轻量数字角标（信息 / 电话 App 主屏图标角标） ----------------

/** 简单数字角标总线：App 内部未读状态的镜像（0-99，localStorage 镜像持久化），
 *  供主屏图标角标订阅；App 挂载/状态变化时 set() 回写同步 */
export interface BadgeStore {
  get: () => number;
  subscribe: (fn: () => void) => () => void;
  /** 直接设置角标数（封顶 99；与当前值相同时不写入不通知，可安全放进 useEffect） */
  set: (n: number) => void;
}

export function createBadgeStore(baseKey: string): BadgeStore {
  // 多账号：存储键按对应 App 当前账号作用域（'ios-chat-' 前缀 → 信息 App；无映射的键全局），
  // 账号切换事件到达时重载新账号的值并广播
  const app = accountAppOfKey(baseKey);
  const effKey = () => (app ? accLs(baseKey, app) : baseKey);
  let curKey = effKey();
  let value = 0;
  try {
    const raw = window.localStorage.getItem(curKey);
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) value = Math.min(Math.floor(n), 99);
  } catch {
    // 读取失败按 0
  }
  const subs = new Set<() => void>();
  if (app && typeof window !== 'undefined') {
    window.addEventListener(ACCOUNT_CHANGED_EVENT, (e: Event) => {
      const d = (e as CustomEvent<{ app?: string; id?: string }>).detail;
      if (!d || d.app !== app) return;
      const nextKey = effKey();
      if (nextKey === curKey) return;
      curKey = nextKey;
      let next = 0;
      try {
        const raw = window.localStorage.getItem(curKey);
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) next = Math.min(Math.floor(n), 99);
      } catch {
        // 按 0
      }
      if (next === value) return;
      value = next;
      subs.forEach((fn) => fn());
    });
  }
  return {
    get: () => value,
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    set(n) {
      const next = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 99) : 0;
      if (next === value) return;
      value = next;
      try {
        window.localStorage.setItem(curKey, String(value));
      } catch {
        // 持久化失败忽略
      }
      subs.forEach((fn) => fn());
    },
  };
}

/** 组件侧订阅数字角标：SSR 为 0，客户端挂载后即取真实数据 */
export function useBadge(store: BadgeStore): number {
  return useSyncExternalStore(store.subscribe, store.get, () => 0);
}

/** 信息 App 主屏角标单例（镜像小助手会话未读态 ios-chat-assistant-read） */
export const chatBadge = createBadgeStore('ios-chat-badge');
/** 电话 App 主屏角标单例（镜像未读语音留言数，IndexedDB voicemails.read=false 计数） */
export const phoneBadge = createBadgeStore('ios-phone-badge');
