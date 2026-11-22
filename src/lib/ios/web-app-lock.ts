'use client';

/**
 * 网页内 App 冻结桥（v1.9.21 → v2.4 多应用批量冻结）——「Shizuku 没打开，就锁网页里的 App」。
 *
 * 吃醋锁（jealousy-lock）在真机原生环境经 Shizuku 执行 pm suspend 真锁应用；
 * Shizuku 未连接（浏览器网页预览 / 原生桥不可用）时降级为**锁定本虚拟手机里的 App**：
 * - jealousy-lock 决策出 lock 且目标包名在网页内有对应体 → setWebFrozen 记冻结态；
 * - useUI.openApp / switchToApp 撞上冻结 App → blockWebAppOpen 拦截 + 请求弹
 *   吃醋锁全屏提示（JealousyLockOverlay 复弹，与真机点灰图标的体验对齐）；
 * - 主屏/Spotlight/Dock 图标按冻结态置灰 + 小锁角标 + 「由 XX 管理」标签。
 *
 * v2.4 批量冻结（机主令：AI 说「把网页上面的 APP 全部冻结」必须真冻结每一个，
 * 绝不允许只冻一个装样子）：冻结态从「单条记录」升级为「按包名的记录表」——
 * - 存储 v2：localStorage `jealousy-web-frozen-v2` = { [pkg]: WebFrozenRec }；
 *   首读自动从 v1 单条结构迁移（v1 键保留不删，回滚旧版本仍可用）；
 * - setWebFrozen(pkg, …) = 按 pkg upsert（不再顶掉其他冻结记录）；
 * - setWebFrozen(null) = 清空全部（兜底语义保留）；
 * - 新增 unfreezeWebPkg(pkg)（只解一个）、clearWebFrozenSrc(src)（按来源清）、
 *   pruneExpiredWebFrozen()（扫掉全部过期记录）、getWebFrozenMap()（全量）；
 * - 点冻结图标 → requestWebLockOverlay(appId) 记住点的是哪个 App，
 *   全屏锁定界面按该 App 的记录展示（多层冻结互不干扰）。
 *
 * 为什么独立小模块：store.ts 不能静态依赖 jealousy-lock（jealousy-lock 经
 * shizuku-autonomy → agent-app-nav 静态依赖 store，再进就是环），而 openApp 拦截
 * 又必须落在 store 里——本模块零运行时依赖（仅 type import AppId），两侧都安全。
 *
 * 冻结态持久化：localStorage（与 jealousy-lock 的锁状态 IndexedDB 持久化同刻
 * 写入/清除）；并带 unlockAt+5min 宽限自愈——两份存储万一分叉（手动清缓存等），
 * 过期后冻结自动失效，绝不把用户的 App 永久锁死。
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
 * v1.9.8：网页模式无安卓系统保护——全部网页内置 App 都可冻结（用户要求）。
 * 含通讯类（微信/QQ/信息/电话）+ 系统类（设置/通讯录）——网页里它们都是模拟应用，
 * 冻结后图标变灰、点击弹锁定界面，不会影响真实手机。
 */
export const WEB_LOCK_APPS: WebLockApp[] = [
  { appId: 'music', pkg: 'com.netease.cloudmusic', name: '网易云音乐' },
  { appId: 'browser', pkg: 'com.android.browser', name: '浏览器' },
  { appId: 'taobao', pkg: 'com.taobao.taobao', name: '淘宝' },
  { appId: 'meituan', pkg: 'com.sankuai.meituan', name: '美团' },
  { appId: 'photos', pkg: 'com.android.gallery3d', name: '照片' },
  { appId: 'forum', pkg: 'com.x.forum', name: 'X论坛' },
  { appId: 'notes', pkg: 'com.android.notes', name: '备忘录' },
  { appId: 'clock', pkg: 'com.android.deskclock', name: '时钟' },
  { appId: 'calendar', pkg: 'com.android.calendar', name: '日历' },
  { appId: 'weather', pkg: 'com.android.weather', name: '天气' },
  { appId: 'camera', pkg: 'com.android.camera', name: '相机' },
  { appId: 'contacts', pkg: 'com.android.contacts', name: '通讯录' },
  { appId: 'settings', pkg: 'com.android.settings', name: '设置' },
  { appId: 'wechat', pkg: 'com.tencent.mm', name: '微信' },
  { appId: 'qq', pkg: 'com.tencent.mobileqq', name: 'QQ' },
  { appId: 'chat', pkg: 'com.android.sms', name: '信息' },
  { appId: 'phone', pkg: 'com.android.dialer', name: '电话' },
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

// ---------------- 冻结态（v2 多应用记录表：localStorage 持久 + 到点自愈） ----------------

/** v2 存储键：{ [pkg]: WebFrozenRec } */
const FROZEN_KEY = 'jealousy-web-frozen-v2';
/** v1 旧键（单条记录结构）——首读迁移源，保留不删（旧版本回滚兼容） */
const FROZEN_KEY_V1 = 'jealousy-web-frozen-v1';

/** v1.9.23 src：冻结来源——'jealousy'=吃醋锁（默认，缺省视为吃醋）；'ai'=AI 工具/标记协议主动冻结（吃醋锁 tick 的「无锁清残留」不清它，自身 unlockAt 到期自愈） */
export interface WebFrozenRec {
  pkg: string;
  /** 倒计时到点时间戳（与 jealousy-lock 的 lock.unlockAt 同源） */
  unlockAt: number;
  /** 锁定者角色名（图标「由 XX 管理」角标与切换器卡片用） */
  charName: string;
  /** 冻结来源：'jealousy'=吃醋锁（缺省视为吃醋）；'ai'=AI 工具/标记协议主动冻结（吃醋锁 tick 的「无锁清残留」不清它，自身 unlockAt 到期自愈） */
  src?: 'jealousy' | 'ai';
  /** AI 冻结自定义理由（按人设/记忆/上下文生成，如"你今天玩了太久照片了，歇会儿"） */
  reason?: string;
  /** 锁定者联系人 id（用于头像解析 + 哄哄去聊天） */
  contactId?: string;
  /** 锁定者所在 App（'wx'/'qq'/'sms'，用于头像解析） */
  app?: string;
}

/** undefined=尚未从 localStorage 读过；null=已读且为空表 */
let frozenMap: Record<string, WebFrozenRec> | null | undefined;

function readFrozenMap(): Record<string, WebFrozenRec> {
  if (frozenMap !== undefined) return frozenMap ?? {};
  if (typeof window === 'undefined') return {};
  const out: Record<string, WebFrozenRec> = {};
  try {
    const raw = window.localStorage.getItem(FROZEN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [pkg, rec] of Object.entries(parsed as Record<string, unknown>)) {
          if (rec && typeof rec === 'object' && typeof (rec as WebFrozenRec).unlockAt === 'number') {
            out[pkg] = rec as WebFrozenRec;
          }
        }
      }
    } else {
      // v1 → v2 迁移：旧单条记录收进记录表（迁移结果不回写 v1 键；v2 下次写入时落盘）
      const rawV1 = window.localStorage.getItem(FROZEN_KEY_V1);
      if (rawV1) {
        const v1 = JSON.parse(rawV1) as WebFrozenRec | null;
        if (v1 && typeof v1 === 'object' && typeof v1.unlockAt === 'number' && v1.pkg) {
          out[v1.pkg] = v1;
          try {
            window.localStorage.setItem(FROZEN_KEY, JSON.stringify(out));
          } catch {
            /* 迁移落盘失败：内存态仍生效 */
          }
        }
      }
    }
  } catch {
    /* 存储损坏：按空表处理 */
  }
  frozenMap = out;
  return out;
}

/** 宽限：unlockAt 后 5 分钟冻结记录自动失效（jealousy-lock 倒计时到点会主动清；
 *  这里兜底自愈，防两份存储分叉把 App 永久锁死——宁可漏锁 5 分钟，不可锁死用户） */
const GRACE_MS = 5 * 60_000;

function alive(rec: WebFrozenRec | null | undefined): boolean {
  return !!rec && typeof rec.unlockAt === 'number' && Date.now() < rec.unlockAt + GRACE_MS;
}

function aliveMap(): Record<string, WebFrozenRec> {
  const out: Record<string, WebFrozenRec> = {};
  for (const [pkg, rec] of Object.entries(readFrozenMap())) {
    if (alive(rec)) out[pkg] = rec;
  }
  return out;
}

/** 当前全部存活冻结记录（v2.4 批量冻结核心读取口；过期视同无） */
export function getWebFrozenMap(): Record<string, WebFrozenRec> {
  return aliveMap();
}

/**
 * 读取冻结记录（兼容单条语义）：
 * - 传 pkg：返回该包名的记录（无/过期 → null）
 * - 不传：返回「主记录」——全部存活记录中 unlockAt 最晚的一条（单锁场景即唯一那条；
 *   批量冻结时兜底展示最长时限的记录，老调用方不传参也能拿到合理值）
 */
export function getWebFrozen(pkg?: string): WebFrozenRec | null {
  const map = aliveMap();
  if (pkg !== undefined) return map[pkg] ?? null;
  let best: WebFrozenRec | null = null;
  for (const rec of Object.values(map)) {
    if (!best || rec.unlockAt > best.unlockAt) best = rec;
  }
  return best;
}

/** 网页 App 是否被冻结（主屏图标/打开拦截判定用） */
export function isWebAppFrozen(appId: AppId): boolean {
  const pkg = PKG_OF_APP.get(appId);
  if (!pkg) return false;
  return alive(readFrozenMap()[pkg]);
}

/** 锁定者角色名（无冻结返回 null；可传 appId 精确取该 App 的锁定者） */
export function webFrozenBy(appId?: AppId): string | null {
  if (appId !== undefined) {
    const pkg = PKG_OF_APP.get(appId);
    if (pkg) return readFrozenMap()[pkg]?.charName ?? null;
  }
  return getWebFrozen()?.charName ?? null;
}

/**
 * 写冻结态（v2.4：按 pkg upsert——批量冻结时每条记录独立保存，互不顶掉）。
 * pkg=null 清空全部（兜底语义保留）。unlockAt/charName 用于宽限自愈与角标展示。
 * opts.reason/contactId/app 为 AI 冻结的自定义理由 + 头像解析信息（可选）。
 */
export function setWebFrozen(
  pkg: string | null,
  unlockAt = 0,
  charName = '',
  src: 'jealousy' | 'ai' = 'jealousy',
  opts?: { reason?: string; contactId?: string; app?: string },
): void {
  if (typeof window === 'undefined') return;
  const cur = readFrozenMap();
  if (pkg) {
    const next: WebFrozenRec = { pkg, unlockAt, charName, src };
    if (opts?.reason) next.reason = opts.reason;
    if (opts?.contactId) next.contactId = opts.contactId;
    if (opts?.app) next.app = opts.app;
    const prev = cur[pkg];
    // 同值去重（jealousy tick 每 30s 重申一次，不白 bump）
    if (prev && prev.unlockAt === next.unlockAt && prev.charName === next.charName && prev.src === next.src) return;
    frozenMap = { ...cur, [pkg]: next };
    try {
      window.localStorage.setItem(FROZEN_KEY, JSON.stringify(frozenMap));
    } catch {
      /* 写盘失败仅本会话生效 */
    }
  } else {
    if (Object.keys(cur).length === 0) {
      frozenMap = {}; // 同步内存态（未落盘过也归一）
      return; // 本来就没有：不白 bump
    }
    frozenMap = {};
    try {
      window.localStorage.removeItem(FROZEN_KEY);
    } catch {
      /* 同上 */
    }
  }
  bump();
}

/** 只解冻一个包名（v2.4：批量冻结时强制解锁/工具解冻单点生效，不动其他冻结记录） */
export function unfreezeWebPkg(pkg: string): void {
  if (typeof window === 'undefined') return;
  const cur = readFrozenMap();
  if (!cur[pkg]) return;
  const next = { ...cur };
  delete next[pkg];
  frozenMap = next;
  try {
    if (Object.keys(next).length === 0) window.localStorage.removeItem(FROZEN_KEY);
    else window.localStorage.setItem(FROZEN_KEY, JSON.stringify(next));
  } catch {
    /* 写盘失败仅本会话生效 */
  }
  bump();
}

/** 按来源清冻结记录（v2.4：吃醋锁 tick「无锁清残留」只清 src!=='ai' 的，AI 批量冻结不受影响） */
export function clearWebFrozenSrc(keepSrc: 'jealousy' | 'ai'): void {
  if (typeof window === 'undefined') return;
  const cur = readFrozenMap();
  const next: Record<string, WebFrozenRec> = {};
  let changed = false;
  for (const [pkg, rec] of Object.entries(cur)) {
    const src = rec.src ?? 'jealousy';
    if (src === keepSrc) next[pkg] = rec;
    else changed = true;
  }
  if (!changed) return;
  frozenMap = next;
  try {
    if (Object.keys(next).length === 0) window.localStorage.removeItem(FROZEN_KEY);
    else window.localStorage.setItem(FROZEN_KEY, JSON.stringify(next));
  } catch {
    /* 写盘失败仅本会话生效 */
  }
  bump();
}

/** 扫掉全部已过期记录（v2.4：批量冻结各自到点自愈；有清理才广播） */
export function pruneExpiredWebFrozen(): void {
  if (typeof window === 'undefined') return;
  const cur = readFrozenMap();
  const next: Record<string, WebFrozenRec> = {};
  let changed = false;
  for (const [pkg, rec] of Object.entries(cur)) {
    if (alive(rec)) next[pkg] = rec;
    else changed = true;
  }
  if (!changed) return;
  frozenMap = next;
  try {
    if (Object.keys(next).length === 0) window.localStorage.removeItem(FROZEN_KEY);
    else window.localStorage.setItem(FROZEN_KEY, JSON.stringify(next));
  } catch {
    /* 写盘失败仅本会话生效 */
  }
  bump();
}

/**
 * openApp/switchToApp 拦截：被冻结返回 true（调用方中止打开），同时请求弹全屏锁定提示。
 * 与真机体验对齐：pm suspend 后点灰图标 → 系统提示「由 Shell 所管理」→ 这里弹 TA 的留言。
 */
export function blockWebAppOpen(appId: AppId): boolean {
  if (!isWebAppFrozen(appId)) return false;
  requestWebLockOverlay(appId);
  return true;
}

// ---------------- 全屏提示请求（点冻结图标 → JealousyLockOverlay 复弹） ----------------

let overlayPending = false;
/** v2.4：用户点的是哪个冻结 App 的图标（overlay 据此展示该 App 的冻结记录/倒计时） */
let overlayPendingApp: AppId | null = null;

/** 请求弹吃醋锁全屏提示（appId = 点的冻结图标；overlay 自动弹过一次后，点冻结图标仍可再看 TA 的留言） */
export function requestWebLockOverlay(appId?: AppId): void {
  overlayPending = true;
  overlayPendingApp = appId ?? null;
  bump();
}

export function isWebLockOverlayPending(): boolean {
  return overlayPending;
}

/** 本次复弹请求对应的 App（null = 未指明，取主记录展示） */
export function getWebLockOverlayApp(): AppId | null {
  return overlayPendingApp;
}

export function clearWebLockOverlayPending(): void {
  if (!overlayPending) return;
  overlayPending = false;
  overlayPendingApp = null;
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
