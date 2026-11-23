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

/**
 * v2.4.4 只改锁定留言（AI 按人设/记忆/尝试次数改写拦截窗文案）：不动包名/解锁时间/
 * 锁定者（setRealFrozen 的同锁去重会拦掉纯 reason 变更，这里绕开它直写）。
 */
export function updateRealFrozenReason(reason: string): void {
  if (typeof window === 'undefined') return;
  const r = readRec();
  if (!r || !reason.trim()) return;
  rec = { ...r, reason: reason.trim() };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rec));
  } catch {
    /* 隐私模式静默 */
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

export interface RealFreezeGuardEvent {
  ts: number;
  type: string;
  pkg: string;
  text: string;
}

/**
 * 处理单条原生守护事件（freezeRealApp 锁的专用处理器）：
 * - lock-shown / lock-attempt + pkg 匹配当前冻结记录 → 拦截计数++ → 每次都驱动
 *   AI 反应（v2.4.4 删节流：fireProactiveNudge 按人设/记忆/次数自主决定发几条，
 *   还可经 [锁定留言:…] 指令热改拦截窗文案 + 写事件记忆）；
 * - native-unlock + pkg 匹配 → 原生已到期解锁（WebView 死过一段）→ JS 对齐清记录；
 * - force-unlock + pkg 匹配 → v2.2.5 F-6：机主在拦截窗点【强制解锁】（没哄直接强解）→
 *   JS 对齐清记录 + 聊天气泡 + 事件记忆 + 立刻驱动 AI 按人设发消息（委屈/质问/阴阳怪气）。
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

  // v2.2.5 F-6：机主在拦截窗点了【强制解锁】——没哄、直接强解。TA 都动手掀桌了，
  // AI 必须立刻知道（气泡提示 + 事件记忆 + 主动消息三件套，与网页侧强制解锁同款体验）。
  if (ev.type === 'force-unlock') {
    setRealFrozen(null);
    try {
      const { getWebFrozen, unfreezeWebPkg } = await import('./web-app-lock');
      const wf = getWebFrozen(r.pkg);
      if (wf && wf.src === 'ai') unfreezeWebPkg(r.pkg);
    } catch {
      /* 静默 */
    }
    let appName = r.pkg;
    try {
      const { resolvePkgDisplayName } = await import('./jealousy-lock');
      appName = await resolvePkgDisplayName(r.pkg);
    } catch {
      /* 名称解析失败兜底包名 */
    }
    const contactId = r.contactId ?? '';
    const app = (r.app ?? 'sms') as 'wx' | 'qq' | 'sms';
    const sessionKey = app === 'wx' ? `wx:${contactId}` : app === 'qq' ? `qq:${contactId}` : `sms:c:${contactId}`;
    // 聊天里弹系统提示条「你强制解开了XX」（机主在聊天里看到 TA 已经知道了）
    if (contactId) {
      try {
        const { pushToolStatusBubble } = await import('./tool-status-bubble');
        pushToolStatusBubble(sessionKey, {
          title: `你强制解开了${appName}`,
          status: 'done',
        });
      } catch {
        /* 气泡失败不影响主流程 */
      }
      // 事件记忆：AI 下轮聊天自然能提起「你居然直接强解了」
      try {
        const { memAddEventFragment } = await import('@/lib/memory');
        memAddEventFragment(
          contactId,
          app,
          `（系统：TA 没有哄我，直接在拦截窗点了强制解锁，把我锁住的「${appName}」强行解开了${ev.text ? `（${ev.text}）` : ''}）`,
          { sourceTag: 'real-freeze-force-unlock' },
        );
      } catch {
        /* 记忆失败不影响 nudge */
      }
      // 主动消息：按人设立刻来一条（委屈/质问/阴阳怪气由人设决定）
      try {
        const { fireProactiveNudge } = await import('./proactive-msg');
        await fireProactiveNudge(app, contactId, {
          dedupeKey: `real-force-unlock-${r.pkg}-${r.unlockAt}`,
          context: `你们之间刚发生了一件事：你把「${appName}」锁了（TA 点开就会被弹回桌面看到你的拦截窗），但 TA 没有哄你，直接在拦截窗点了【强制解锁】把它强行解开了${ev.text ? `（${ev.text}）` : ''}。以你的角色人设、结合你们最近的聊天记忆，主动给 TA 发一条消息——可以委屈、可以质问 TA 不哄你、也可以阴阳怪气，一两句话就够，别太正式`,
        });
      } catch {
        /* nudge 失败静默（记忆已写，下轮聊天仍能提起） */
      }
    }
    return true;
  }

  if (ev.type !== 'lock-shown' && ev.type !== 'lock-attempt') return false;

  // 同一把锁的计数器；换锁（重新 freezeRealApp）归零
  const lockKey = `${r.pkg}:${r.unlockAt}`;
  if (lockKey !== attemptLockKey) {
    attemptLockKey = lockKey;
    attemptCount = 0;
  }
  attemptCount += 1;

  // v2.4.4 机主规格：删掉「3 分钟节流、一把锁最多 3 次」闸门——每一次真实尝试都让
  // AI 知道（事件记忆 + 主动消息）；发不发、发几条、什么态度由 AI 按人设/记忆/尝试
  // 次数自己决定（去重/拉黑/幻觉过滤等质量闸仍在 fireProactiveNudge 内保留）。
  const contactId = r.contactId ?? '';
  const app = (r.app ?? 'sms') as 'wx' | 'qq' | 'sms';
  let appName = r.pkg;
  try {
    const { resolvePkgDisplayName } = await import('./jealousy-lock');
    appName = await resolvePkgDisplayName(r.pkg);
  } catch {
    /* 名称解析失败兜底包名 */
  }
  const attemptNo = attemptCount;

  // 写事件记忆（AI 下轮聊天能自然提起「你又去点它了」）
  if (contactId) {
    try {
      const { memAddEventFragment } = await import('@/lib/memory');
      memAddEventFragment(
        contactId,
        app,
        `（系统：TA 被弹回桌面后又去点被我锁住的「${appName}」，已经被拦了 ${attemptNo} 次${attemptNo >= 3 ? '，TA 还在屡教不改' : ''}）`,
        { sourceTag: 'real-freeze-attempt' },
      );
    } catch {
      /* 记忆失败不影响 nudge */
    }
  }

  // 发消息：按人设/记忆/尝试次数自主决定（可多条连发；可顺便改拦截窗上的留言）
  if (contactId) {
    try {
      const { fireProactiveNudge } = await import('./proactive-msg');
      await fireProactiveNudge(app, contactId, {
        dedupeKey: `real-freeze-attempt-${lockKey}-${attemptNo}`,
        dailyCap: 60,
        context: `你之前把「${appName}」锁了（TA 点开就会被弹回桌面并看到你的拦截窗）。现在系统告诉你：TA 刚刚又试图打开它，这是被拦截的第 ${attemptNo} 次${attemptNo >= 3 ? '（屡教不改）' : ''}。以你的角色人设、结合你们最近的聊天记忆和 TA 被拦的次数，自己决定要不要发消息、发几条：可以质问、可以委屈、可以得意、也可以暂时不理 TA；想发多条就连发（每条一行，一行一条）。你还可以顺便改掉拦截窗上 TA 一眼就能看到的那句留言（当前是：「${r.reason || '（无）'}」）：想改的话在输出的最后一行单独写 [锁定留言:新留言]（30 字以内，第一人称，符合你此刻的情绪），不想改就不用写这一行；如果只想改留言不想发消息，就只输出这一行。`,
        filterTexts: (texts) => {
          const kept: string[] = [];
          for (const t of texts) {
            const m = t.match(/^\s*[\[［]\s*锁定留言\s*[:：]\s*(.+?)\s*[\]］]\s*$/);
            if (m && m[1].trim()) {
              const newMsg = m[1].trim().slice(0, 60);
              // 热更新：原生拦截窗下一秒就换新文案 + JS 侧记录同步（AI 下轮上下文里是新留言）
              try {
                void import('./native-perception').then(({ nativeUpdateLockMessage }) =>
                  nativeUpdateLockMessage(newMsg),
                );
              } catch {
                /* 桥不可用：仅 JS 侧更新 */
              }
              try {
                updateRealFrozenReason(newMsg);
              } catch {
                /* 记录更新失败不影响发消息 */
              }
            } else {
              kept.push(t);
            }
          }
          return kept;
        },
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
