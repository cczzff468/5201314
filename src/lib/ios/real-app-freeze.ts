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

// ---------------- v2.2.0 需求三：AI 感知强行突破（拦截事件驱动 AI 反应） ----------------

/** 本次锁期间的拦截次数（原生 lock-attempt 事件累计；解锁/换锁时归零） */
let attemptCount = 0;
let attemptLockKey = '';
/** 上次 AI 反应时间（节流：首条立即，后续至少间隔 3 分钟，一锁最多 3 次） */
let lastAttemptReactAt = 0;
let attemptReacts = 0;

const ATTEMPT_REACT_MIN_GAP_MS = 3 * 60_000;
const ATTEMPT_REACT_MAX = 3;

export interface RealFreezeGuardEvent {
  ts: number;
  type: string;
  pkg: string;
  text: string;
}

/**
 * 处理单条原生守护事件（freezeRealApp 锁的专用处理器）：
 * - lock-shown / lock-attempt + pkg 匹配当前冻结记录 → 拦截计数++ → 节流驱动
 *   AI 反应（fireProactiveNudge 按人设/记忆发质问 + 写事件记忆）；
 * - native-unlock + pkg 匹配 → 原生已到期解锁（WebView 死过一段）→ JS 对齐清记录。
 * 返回 true=事件属于本处理器（已消费）。
 * 注：jealousy-lock 的 drainJealousyGuardEvents 也会把事件先转到这里——双 drain
 * 入口谁先取到都不丢 freezeRealApp 锁的拦截信号。
 */
export async function handleRealFreezeGuardEvent(ev: RealFreezeGuardEvent): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const r = readRec();
  if (!r || !r.pkg || r.pkg !== ev.pkg) return false;

  if (ev.type === 'native-unlock') {
    // 原生守护已到期自解（WebView 可能死过）→ JS 对齐：清记录 + 清网页冻结态
    setRealFrozen(null);
    try {
      const { getWebFrozen, unfreezeWebPkg } = await import('./web-app-lock');
      const wf = getWebFrozen(r.pkg);
      if (wf && wf.src === 'ai') unfreezeWebPkg(r.pkg);
    } catch {
      /* 静默 */
    }
    return true;
  }

  if (ev.type !== 'lock-shown' && ev.type !== 'lock-attempt') return false;

  // 同一把锁的计数器；换锁（重新 freezeRealApp）归零
  const lockKey = `${r.pkg}:${r.unlockAt}`;
  if (lockKey !== attemptLockKey) {
    attemptLockKey = lockKey;
    attemptCount = 0;
    attemptReacts = 0;
    lastAttemptReactAt = 0;
  }
  attemptCount += 1;

  // 节流闸：首条立即反应；后续 ≥3 分钟；一把锁最多 3 次（防轰炸）
  const now = Date.now();
  if (attemptReacts >= ATTEMPT_REACT_MAX) return true;
  if (attemptReacts > 0 && now - lastAttemptReactAt < ATTEMPT_REACT_MIN_GAP_MS) return true;
  lastAttemptReactAt = now;
  attemptReacts += 1;

  const contactId = r.contactId ?? '';
  const app = (r.app ?? 'sms') as 'wx' | 'qq' | 'sms';
  // 写事件记忆（AI 下轮聊天能自然提起「你又去点它了」）
  if (contactId) {
    try {
      const { memAddEventFragment } = await import('@/lib/memory');
      memAddEventFragment(
        contactId,
        app,
        `（系统：TA 被弹回桌面后又去点被我锁住的「${r.pkg}」，已经被拦了 ${attemptCount} 次${attemptCount >= 3 ? '，TA 还在屡教不改' : ''}）`,
        { sourceTag: 'real-freeze-attempt' },
      );
    } catch {
      /* 记忆失败不影响 nudge */
    }
  }

  // 发消息：按人设/记忆/上下文质问（fireProactiveNudge 内置人设注入/去重/守卫）
  if (contactId) {
    try {
      const { fireProactiveNudge } = await import('./proactive-msg');
      await fireProactiveNudge(app, contactId, {
        dedupeKey: `real-freeze-attempt-${lockKey}-${attemptReacts}`,
        context: `你之前把「${r.reason || r.pkg}」锁了（TA 点开就会被弹回桌面并看到你的拦截窗）。现在系统告诉你：TA 刚刚又试图打开它，这是被拦截的第 ${attemptCount} 次${attemptCount >= 3 ? '，屡教不改' : ''}。以你的角色人设、结合你们最近的聊天记忆，主动给 TA 发一条消息——可以质问、可以委屈、也可以得意，一两句话就够，别太正式。`,
      });
    } catch {
      /* nudge 失败静默（记忆已写，下轮聊天仍能提起） */
    }
  }
  return true;
}

/**
 * drain 原生守护事件（RealFreezeWatcher 每 30s 调用；有冻结记录才拉取）：
 * freezeRealApp 锁不依赖吃醋锁配置——这里是它独立的拦截信号源。
 */
export async function drainRealFreezeGuardEvents(): Promise<void> {
  if (typeof window === 'undefined') return;
  const r = readRec();
  if (!r) return;
  try {
    const { nativeJealousyGuardDrainEvents } = await import('./native-perception');
    const events = await nativeJealousyGuardDrainEvents();
    if (!events || events.length === 0) return;
    for (const ev of events) {
      try {
        await handleRealFreezeGuardEvent(ev);
      } catch {
        /* 单条失败不影响后续 */
      }
    }
  } catch {
    /* 桥异常静默（下轮再试） */
  }
}

// ---------------- 外部 store 订阅 ----------------

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
