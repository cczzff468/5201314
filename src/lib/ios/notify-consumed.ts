'use client';

/**
 * v2.4.1 通知消费标记（isConsumed）——「吃醋查岗绝不翻旧账」的底层账本。
 *
 * 机主规格（第二轮）：系统通知明明已被用户点开/清除，下次吃醋时 AI 还在提
 * 「有人给你发消息」——因为通知证据每轮查岗都原样再喂一遍。
 *
 * 消费（Consume）协议：
 * - 任何渲染「通知证据」给 AI 的出口（真机通知快照 / 网页通知中心）统一把
 *   每条通知映射成稳定 key（真机 pkg|title|ts / 网页通知 id），先滤掉已消费的；
 * - 吃醋流程（硬触发/暗中观察/巡检）采集前 beginNotifyCollect() 开采集窗，
 *   窗口内所有被展示过的 key 自动记账；
 * - 只有当 AI 真的把质问消息投递出去（AI 已因这批通知说过话）才
 *   markNotifiesConsumed(keys) 落账——AI 静默（quiet/解析失败/没发消息）绝不消费，
 *   下轮还能再看到；消费过的通知从此在所有出口（查岗证据 + AI 主动调
 *   getRecentNotifications 工具）一律隐身，绝不翻旧账。
 *
 * 存储：IndexedDB kvRaw（idb-kv），FIFO 封顶 240 条（同一通知自然滑出 2h
 * 证据窗后，旧消费键随封顶自动滚出，无需过期时间）。
 */

import { kvGetRaw, kvSetRaw } from './idb-kv';

const CONSUMED_KEY = 'notify-consumed-v1';
const CONSUMED_MAX = 240;

/** 已消费通知 key 集（内存缓存；kvRaw 读即缓存，写穿透） */
let consumedCache: Set<string> | null = null;

function loadConsumed(): Set<string> {
  if (consumedCache) return consumedCache;
  let arr: string[] = [];
  try {
    const raw = kvGetRaw<string[]>(CONSUMED_KEY);
    if (Array.isArray(raw)) arr = raw.filter((k) => typeof k === 'string');
  } catch {
    /* 读失败当空账本 */
  }
  consumedCache = new Set(arr);
  return consumedCache;
}

/** 真机通知稳定 key（MediaListenerService 环形缓冲条目：pkg + 标题 + 原始 postTime） */
export function devNotifyKeyOf(pkg: string, title: string, ts: number): string {
  return `d:${pkg}|${(title ?? '').slice(0, 40)}|${Math.round(ts)}`;
}

/** 网页通知中心条目 key（notification-center 的 item id） */
export function webNotifyKeyOf(id: string): string {
  return `w:${id}`;
}

/** 该通知是否已被 AI 消费过（质问过一次 → isConsumed，后续查岗一律隐身） */
export function isNotifyConsumed(key: string): boolean {
  return loadConsumed().has(key);
}

/** 批量把 AI 质问过的通知记入消费账本（吃醋消息投递成功后调用） */
export function markNotifiesConsumed(keys: string[]): void {
  const uniq = [...new Set(keys.filter(Boolean))];
  if (uniq.length === 0) return;
  const cur = loadConsumed();
  for (const k of uniq) cur.add(k);
  // FIFO 封顶：只留最近 CONSUMED_MAX 条（Set 保序插入）
  let arr = [...cur];
  if (arr.length > CONSUMED_MAX) arr = arr.slice(arr.length - CONSUMED_MAX);
  try {
    kvSetRaw(CONSUMED_KEY, arr);
  } catch {
    /* 落库失败：内存缓存已生效，本轮够用 */
  }
  consumedCache = new Set(arr);
}

// ---------------- 采集窗（吃醋流程专用；普通聊天里 AI 直接调工具不进账） ----------------

let collecting = false;
let shownBuffer: string[] = [];

/** 吃醋回合开采集窗：窗口内所有展示给 AI 的通知 key 自动记账 */
export function beginNotifyCollect(): void {
  collecting = true;
  shownBuffer = [];
}

/** 出口记账：webNotifyLines / deviceNotifyLines / labNotificationSnapshot 渲染时调用 */
export function noteShownNotifyKeys(keys: string[]): void {
  if (!collecting) return;
  for (const k of keys) if (k) shownBuffer.push(k);
}

/** 关采集窗并取走窗口内展示过的 key（决策投递成功后交给 markNotifiesConsumed） */
export function endNotifyCollect(): string[] {
  collecting = false;
  const out = shownBuffer;
  shownBuffer = [];
  return out;
}

// ---------------- dev 测试钩子（仅 dev 生效；生产构建零暴露面） ----------------

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  const w = window as typeof window & {
    __notifyConsumedTest?: {
      is: (key: string) => boolean;
      mark: (keys: string[]) => void;
      all: () => string[];
      collectBegin: () => void;
      collectNote: (keys: string[]) => void;
      collectEnd: () => string[];
    };
  };
  w.__notifyConsumedTest = {
    is: isNotifyConsumed,
    mark: markNotifiesConsumed,
    all: () => [...loadConsumed()],
    collectBegin: beginNotifyCollect,
    collectNote: noteShownNotifyKeys,
    collectEnd: endNotifyCollect,
  };
}
