'use client';

/**
 * 真机 App 冻结记录（v2.2 需求四：AI 自定义锁定时长）。
 *
 * AI 经 freezeRealApp（pm suspend）冻结真机应用时，同步落一份 JS 侧记录：
 * - unlockAt 到点由 RealFreezeWatcher 自动执行 pm unsuspend（解冻失败下轮重试，
 *   超过 4h 放弃自愈——绝不让记录永久悬挂）；
 * - 锁定者信息（charName/contactId/app/reason）供锁定全屏界面复用：动态头像、
 *   【去哄哄 TA】跳聊天、【强制解锁】时一并解冻真机应用；
 * - 被冻结的应用若在网页虚拟手机里有对应体，web-tools 会同时 setWebFrozen
 * （桌面图标变灰、点击弹锁定界面），两侧 unlockAt 同源。
 *
 * 存储：localStorage `ai-real-frozen-v1`（单条记录：一次只冻一个应用，与
 * web-app-lock 的 WebFrozenRec 同款约束）。失败兜底与网页冻结态同构：
 * unlockAt 后仍有宽限判定（这里宽限即重试窗口，见 STALE_MS）。
 */

export interface RealFrozenRec {
  /** 被冻结的真机应用包名（pm suspend 的对象） */
  pkg: string;
  /** 倒计时到点时间戳（到期自动 pm unsuspend） */
  unlockAt: number;
  /** 锁定者角色名（锁定界面文案用） */
  charName: string;
  /** AI 冻结自定义理由（按人设/记忆/上下文生成） */
  reason?: string;
  /** 锁定者联系人 id（头像解析 + 哄哄跳聊天用） */
  contactId?: string;
  /** 锁定者所在 App（'wx'/'qq'/'sms'，头像解析与聊天跳转用） */
  app?: string;
}

const KEY = 'ai-real-frozen-v1';

/** 过期后仍保留 4 小时作解冻重试窗口；超过即放弃自愈清记录（防永久悬挂） */
const STALE_MS = 4 * 60 * 60_000;

let rec: RealFrozenRec | null | undefined;

function readRec(): RealFrozenRec | null {
  if (rec !== undefined) return rec;
  if (typeof window === 'undefined') return (rec = null);
  try {
    const raw = window.localStorage.getItem(KEY);
    rec = raw ? (JSON.parse(raw) as RealFrozenRec) : null;
  } catch {
    rec = null;
  }
  return rec;
}

/** 当前冻结记录（已过 STALE_MS 视同无） */
export function getRealFrozen(): RealFrozenRec | null {
  const r = readRec();
  if (!r || typeof r.unlockAt !== 'number') return null;
  return Date.now() < r.unlockAt + STALE_MS ? r : null;
}

/** 写冻结记录（null 清除）；写盘失败仅本会话生效（与 web-app-lock 同款容错） */
export function setRealFrozen(next: RealFrozenRec | null): void {
  if (typeof window === 'undefined') return;
  if (next) {
    if (rec && rec.pkg === next.pkg && rec.unlockAt === next.unlockAt && rec.charName === next.charName) return;
    rec = next;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* 隐私模式静默 */
    }
  } else {
    if (readRec() === null) {
      rec = null;
      return;
    }
    rec = null;
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* 同上 */
    }
  }
  bump();
}

// ---------------- 到期自动解冻（RealFreezeWatcher 每 30s 调用） ----------------

/** 单飞闸：解冻（pm unsuspend + 桥超时）进行中时避免重入 */
let unfreezing = false;

/**
 * 到期检查：unlockAt 已到 → pm unsuspend 真机应用 + 清记录 + 清同包名的 AI 网页冻结态。
 * 解冻失败（Shizuku 断连等）保留记录，下一轮重试（宽限窗口内）；超过 STALE_MS 放弃并自愈。
 */
export async function checkRealFreezeExpiry(): Promise<void> {
  if (typeof window === 'undefined') return;
  const r = readRec();
  if (!r || typeof r.unlockAt !== 'number') return;

  // 未到期：无事可做
  if (Date.now() < r.unlockAt) return;

  // 超出宽限窗口：放弃解冻重试，直接自愈清记录（绝不让记录永久悬挂）
  if (Date.now() >= r.unlockAt + STALE_MS) {
    setRealFrozen(null);
    return;
  }

  if (unfreezing) return;
  unfreezing = true;
  try {
    const { labUnsuspendApp } = await import('./device-ops');
    const res = await labUnsuspendApp(r.pkg);
    if (res.ok) {
      setRealFrozen(null);
      // 同包名的 AI 网页冻结态一并清（真机已解，网页图标不该继续灰；
      // v2.4 多应用冻结：只解这一个包，不动 AI 批量冻结的其他记录）
      try {
        const { getWebFrozen, unfreezeWebPkg } = await import('./web-app-lock');
        const wf = getWebFrozen(r.pkg);
        if (wf && wf.src === 'ai') unfreezeWebPkg(r.pkg);
      } catch {
        /* 网页态清理失败不影响主流程 */
      }
    }
    // 失败：保留记录，下轮重试
  } catch {
    /* 桥异常：保留记录，下轮重试 */
  } finally {
    unfreezing = false;
  }
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

export function subscribeRealFreeze(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getRealFreezeVersion(): number {
  return version;
}
