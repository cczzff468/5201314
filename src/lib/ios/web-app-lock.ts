'use client';

/**
 * 网页内 App 冻结桥（v1.9.21）——「Shizuku 没打开，就锁网页里的 App」。
 *
 * 吃醋锁（jealousy-lock）在真机原生环境经 Shizuku 执行 pm suspend 真锁应用；
 * Shizuku 未连接（浏览器网页预览 / 原生桥不可用）时降级为**锁定本虚拟手机里的 App**：
 * - jealousy-lock 决策出 lock 且目标包名在网页内有对应体 → setWebFrozen 记冻结态；
 * - useUI.openApp / switchToApp 撞上冻结 App → blockWebAppOpen 拦截 + 请求弹
 *   吃醋锁全屏提示（JealousyLockOverlay 复弹，与真机点灰图标的体验对齐）；
 * - 主屏/Spotlight/Dock 图标按冻结态置灰 + 小锁角标 + 「由 XX 管理」标签。
 *
 * 为什么独立小模块：store.ts 不能静态依赖 jealousy-lock（jealousy-lock 经
 * shizuku-autonomy → agent-app-nav 静态依赖 store，再进就是环），而 openApp 拦截
 * 又必须落在 store 里——本模块零运行时依赖（仅 type import AppId），两侧都安全。
 *
 * 冻结态持久化：localStorage `jealousy-web-frozen-v1`（与 jealousy-lock 的锁状态
 * IndexedDB 持久化同刻写入/清除）；并带 unlockAt+5min 宽限自愈——两份存储万一
 * 分叉（手动清缓存等），过期后冻结自动失效，绝不把用户的 App 永久锁死。
 */

import type { AppId } from './store';

export interface WebLockApp {
  appId: AppId;
  /** 对外统一用真实世界包名——与 ENTERTAIN_PRESETS / PKG_DISPLAY 同一命名空间，
   *  AI 决策、记忆、通知、弹窗文案全部复用既有映射 */
  pkg: string;
  name: string;
}

/**
 * 网页内可被吃醋锁锁定的 App 清单。
 * 收录原则：①有「冷落 AI 独自消遣」叙事价值的（听歌/刷剧/逛淘宝/点外卖/翻相册/泡论坛）；
 * ②微信/QQ/信息/电话/通讯录/设置/相机永不清单（通讯+系统，锁了没法回来哄 AI）；
 * ③情侣空间/拾光小屋是我们俩的家，锁它不符合吃醋叙事，不收。
 */
export const WEB_LOCK_APPS: WebLockApp[] = [
  { appId: 'music', pkg: 'com.netease.cloudmusic', name: '网易云音乐' },
  { appId: 'browser', pkg: 'com.android.browser', name: '浏览器' },
  { appId: 'taobao', pkg: 'com.taobao.taobao', name: '淘宝' },
  { appId: 'meituan', pkg: 'com.sankuai.meituan', name: '美团' },
  { appId: 'photos', pkg: 'com.android.gallery3d', name: '照片' },
  { appId: 'forum', pkg: 'com.x.forum', name: 'X论坛' },
];

const APP_OF_PKG = new Map<string, WebLockApp>(WEB_LOCK_APPS.map((a) => [a.pkg, a]));
const PKG_OF_APP = new Map<AppId, string>(WEB_LOCK_APPS.map((a) => [a.appId, a.pkg]));

/** 包名 → 网页内对应 App（无对应体返回 null：抖音/原神等网页里没有） */
export function webAppOfPkg(pkg: string): WebLockApp | null {
  return APP_OF_PKG.get(pkg) ?? null;
}

/** 网页内 AppId → 包名（不可锁 App 返回 null） */
export function webPkgOfApp(appId: AppId): string | null {
  return PKG_OF_APP.get(appId) ?? null;
}

// ---------------- 冻结态（localStorage 持久 + 到点自愈） ----------------

const FROZEN_KEY = 'jealousy-web-frozen-v1';

/** v1.9.23 src：冻结来源——'jealousy'=吃醋锁（默认，缺省视为吃醋）；'ai'=AI 工具/标记协议主动冻结（吃醋锁 tick 的「无锁清残留」不清它，自身 unlockAt 到期自愈） */
export interface WebFrozenRec {
  pkg: string;
  /** 倒计时到点时间戳（与 jealousy-lock 的 lock.unlockAt 同源） */
  unlockAt: number;
  /** 锁定者角色名（图标「由 XX 管理」角标与切换器卡片用） */
  charName: string;
}

/** undefined=尚未从 localStorage 读过 */
let frozen: WebFrozenRec | null | undefined;

function readFrozen(): WebFrozenRec | null {
  if (frozen !== undefined) return frozen;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(FROZEN_KEY);
    frozen = raw ? (JSON.parse(raw) as WebFrozenRec) : null;
  } catch {
    frozen = null;
  }
  return frozen;
}

/** 宽限：unlockAt 后 5 分钟冻结记录自动失效（jealousy-lock 倒计时到点会主动清；
 *  这里兜底自愈，防两份存储分叉把 App 永久锁死——宁可漏锁 5 分钟，不可锁死用户） */
const GRACE_MS = 5 * 60_000;

function alive(rec: WebFrozenRec | null): boolean {
  return !!rec && typeof rec.unlockAt === 'number' && Date.now() < rec.unlockAt + GRACE_MS;
}

/** 当前冻结记录（过期视同无；不产生副作用） */
export function getWebFrozen(): WebFrozenRec | null {
  const r = readFrozen();
  return alive(r) ? r : null;
}

/** 网页 App 是否被吃醋锁冻结（主屏图标/打开拦截判定用） */
export function isWebAppFrozen(appId: AppId): boolean {
  const pkg = PKG_OF_APP.get(appId);
  if (!pkg) return false;
  return getWebFrozen()?.pkg === pkg;
}

/** 锁定者角色名（无冻结返回 null） */
export function webFrozenBy(): string | null {
  return getWebFrozen()?.charName ?? null;
}

/**
 * 写冻结态（唯一写入方：jealousy-lock 锁定/解锁/自愈同步）。
 * pkg=null 清除。unlockAt/charName 用于宽限自愈与角标展示。
 */
export function setWebFrozen(pkg: string | null, unlockAt = 0, charName = '', src: 'jealousy' | 'ai' = 'jealousy'): void {
  if (typeof window === 'undefined') return;
  if (pkg) {
    const next: WebFrozenRec = { pkg, unlockAt, charName, src };
    const prev = readFrozen();
    if (prev && prev.pkg === next.pkg && prev.unlockAt === next.unlockAt && prev.charName === next.charName) return; // 无变化不 bump（tick 每 30s 同步一次）
    frozen = next;
    try {
      window.localStorage.setItem(FROZEN_KEY, JSON.stringify(next));
    } catch {
      /* 写盘失败仅本会话生效 */
    }
  } else {
    if (readFrozen() === null) {
      frozen = null; // 同步内存态（未落盘过也归一）
      return; // 本来就没有：不白 bump
    }
    frozen = null;
    try {
      window.localStorage.removeItem(FROZEN_KEY);
    } catch {
      /* 同上 */
    }
  }
  bump();
}

/**
 * openApp/switchToApp 拦截：被冻结返回 true（调用方中止打开），同时请求弹全屏锁定提示。
 * 与真机体验对齐：pm suspend 后点灰图标 → 系统提示「由 Shell 所管理」→ 这里弹 TA 的留言。
 */
export function blockWebAppOpen(appId: AppId): boolean {
  if (!isWebAppFrozen(appId)) return false;
  requestWebLockOverlay();
  return true;
}

// ---------------- 全屏提示请求（点冻结图标 → JealousyLockOverlay 复弹） ----------------

let overlayPending = false;

/** 请求弹吃醋锁全屏提示（overlay 自动弹过一次后，点冻结图标仍可再看 TA 的留言） */
export function requestWebLockOverlay(): void {
  overlayPending = true;
  bump();
}

export function isWebLockOverlayPending(): boolean {
  return overlayPending;
}

export function clearWebLockOverlayPending(): void {
  if (!overlayPending) return;
  overlayPending = false;
  bump();
}

// ---------------- 订阅（useSyncExternalStore 用） ----------------

let version = 0;
const listeners = new Set<() => void>();

function bump(): void {
  version += 1;
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* 订阅者异常不影响广播 */
    }
  }
}

export function subscribeWebLock(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getWebLockVersion(): number {
  return version;
}
