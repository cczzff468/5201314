'use client';

/**
 * 吃醋锁（v1.9.19）——「AI 真实吃醋并锁应用」核心库。
 *
 * 把 Shizuku 的 pm suspend 能力与情绪系统深度绑定：
 * - 守望者（JealousyWatcher）周期探测前台应用（dumpsys window）；
 * - 三类触发：A 连续刷娱乐 App 超时且期间没回 AI 消息 / B 聊天里说了「去看剧/刷视频」
 *   随后消失且坐实在娱乐 App / C 焦虑值达危险阈值；
 * - 触发后把【前台包名 + 焦虑值 + 记忆上下文】交给大模型，按角色人设决定是否锁
 *   （pm suspend --user 0 挂起，桌面图标变灰、提示「由 Shell 所管理」）；
 * - 锁定成功：AI 在聊天界面发剧情消息 + 系统通知 + 写记忆 + 全屏锁定弹窗（回 APP 强制弹）；
 * - 解锁三通道：哄好（AI 输出 [手机操作:解冻:包名]）/ 倒计时到点 / 强制解锁（写戏剧性记忆）。
 *
 * 存储：
 * - 配置 localStorage `jealousy-lock-cfg-v1`（同步读，设置页即点即存）；
 * - 运行状态 IndexedDB kvRaw `jealousy-lock-rt`（跨会话持久化：倒计时/冷却重启不丢）。
 *
 * 依赖方向（无环）：jealousy-lock → anxiety / shizuku-lab / memory / persona / local-notify；
 * ai-mood → jealousy-lock（buildJealousyLockBlock 注入聊天上下文）；
 * shizuku-autonomy → jealousy-lock（解冻钩子 onJealousyUnfreeze / isJealousyUnlockAllowed）。
 */

import { kvGetRaw, kvSetRaw } from './idb-kv';
import { isNativePerception } from './native-perception';
import { labForegroundPkg, labSetAppFrozen } from './shizuku-lab';
import { readAnxiety, anxietyOf } from './anxiety';
import { buildPersonaSystemPrompt } from './persona';
import { listContacts, cachedOwnerName } from './contacts-store';
import type { ContactRecord } from '@/lib/contacts';
import { notifyIfHidden } from './local-notify';
import { setAutonomyMaster, setAutonomyCap } from './shizuku-autonomy';

// 注意：memory.ts 反向依赖 chat-stream-store（abortStreamsByPrefix），而 chat-stream-store →
// jealousy-lock（noteJealousyEngagement）——静态导入 memory 会成环，故全部动态导入（调用点均为异步上下文）。
// 同理 proactive-msg（deliverProactiveMsg，其经 ai-mood 与 chat-stream-store 相连）也动态导入。

// ---------------- 配置（localStorage 同步读） ----------------

export interface JealousyConfig {
  /** 总开关（危险能力，默认关） */
  enabled: boolean;
  /** 触发 A：连续刷娱乐 App 阈值（分钟） */
  entertainMin: number;
  /** 触发 C：焦虑危险阈值（0~100） */
  anxietyThreshold: number;
  /** 倒计时自动解锁（分钟） */
  countdownMin: number;
  /** 两次锁定之间冷却（分钟） */
  cooldownMin: number;
  /** 娱乐 App 包名清单 */
  entertainPkgs: string[];
}

const CFG_KEY = 'jealousy-lock-cfg-v1';

/** 娱乐 App 预设（设置页点选用；中文名展示用） */
export const ENTERTAIN_PRESETS: [string, string][] = [
  ['抖音', 'com.ss.android.ugc.aweme'],
  ['快手', 'com.smile.gifmaker'],
  ['B站', 'tv.danmaku.bili'],
  ['小红书', 'com.xingin.xhs'],
  ['微博', 'com.sina.weibo'],
  ['番茄小说', 'com.dragon.read'],
  ['王者荣耀', 'com.tencent.tmgp.sgame'],
  ['和平精英', 'com.tencent.tmgp.pubgmhd'],
  ['原神', 'com.miHoYo.Yuanshen'],
  ['英雄联盟手游', 'com.tencent.lolm'],
];

/** 常见包名 → 中文名（锁定弹窗/通知/记忆展示用；未知包名回退原样） */
const PKG_DISPLAY: Record<string, string> = Object.fromEntries([
  ...ENTERTAIN_PRESETS,
  ['QQ音乐', 'com.tencent.qqmusic'],
  ['网易云音乐', 'com.netease.cloudmusic'],
  ['淘宝', 'com.taobao.taobao'],
  ['京东', 'com.jingdong.app.mall'],
  ['拼多多', 'com.xunmeng.pinduoduo'],
  ['美团', 'com.sankuai.meituan'],
].map(([name, pkg]) => [pkg, name]));

export function pkgDisplayName(pkg: string): string {
  return PKG_DISPLAY[pkg] ?? pkg;
}

function defaultCfg(): JealousyConfig {
  return {
    enabled: false,
    entertainMin: 30,
    anxietyThreshold: 80,
    countdownMin: 30,
    cooldownMin: 60,
    entertainPkgs: ENTERTAIN_PRESETS.slice(0, 6).map(([, p]) => p),
  };
}

export function getJealousyConfig(): JealousyConfig {
  if (typeof window === 'undefined') return defaultCfg();
  try {
    const raw = window.localStorage.getItem(CFG_KEY);
    if (!raw) return defaultCfg();
    const p = JSON.parse(raw) as Partial<JealousyConfig>;
    const d = defaultCfg();
    return {
      enabled: p.enabled === true,
      entertainMin: clampNum(p.entertainMin, 5, 180, d.entertainMin),
      anxietyThreshold: clampNum(p.anxietyThreshold, 50, 100, d.anxietyThreshold),
      countdownMin: clampNum(p.countdownMin, 5, 180, d.countdownMin),
      cooldownMin: clampNum(p.cooldownMin, 10, 240, d.cooldownMin),
      entertainPkgs: Array.isArray(p.entertainPkgs) ? p.entertainPkgs.filter((x) => typeof x === 'string' && /^[\w.]+$/.test(x)).slice(0, 60) : d.entertainPkgs,
    };
  } catch {
    return defaultCfg();
  }
}

function clampNum(v: unknown, min: number, max: number, dft: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dft;
  return Math.max(min, Math.min(max, n));
}

export function updateJealousyConfig(patch: Partial<JealousyConfig>): JealousyConfig {
  const next = { ...getJealousyConfig(), ...patch };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(CFG_KEY, JSON.stringify(next));
    // 开启吃醋锁时自动放开「AI 动手」总开关与冻结单项（哄好解锁走 [手机操作:解冻] 管线）
    if (patch.enabled === true) {
      try {
        setAutonomyMaster(true);
        setAutonomyCap('freeze', true);
      } catch {
        /* 自主能力配置写失败不影响吃醋锁开关本身 */
      }
    }
  }
  bump();
  return next;
}

// ---------------- 运行状态（IndexedDB 持久化 + 内存缓存） ----------------

export type JealousyApp = 'wx' | 'qq' | 'sms';
export type LockTriggerKind = 'entertain' | 'depart' | 'anxiety';

export interface JealousyLock {
  pkg: string;
  contactId: string;
  app: JealousyApp;
  charName: string;
  reason: string;
  lockedAt: number;
  unlockAt: number;
  /** 全屏弹窗已展示过的时间（0=未展示；去哄哄/强制解锁后不再自动弹） */
  overlayShownAt: number;
  triggerKind: LockTriggerKind;
}

export interface JealousyRuntime {
  /** 当前连续娱乐前台（包名+起点；换 App/离开即重置） */
  fg: { pkg: string; since: number; decidedAt: number } | null;
  /** 最近一次用户真实私聊（选「吃醋剧情归属角色」用） */
  lastChat: { contactId: string; app: JealousyApp; at: number } | null;
  /** 用户「去看剧了/刷视频去了」意图（2h 有效） */
  departIntent: { at: number; text: string; contactId: string; app: JealousyApp } | null;
  /** 活跃锁（一次只锁一个应用） */
  lock: JealousyLock | null;
  /** 上次锁定时间（冷却用） */
  lastLockAt: number;
  /** 上次决策时间（无论锁没锁；防 tick 反复触发决策） */
  lastDecisionAt: number;
  /** 上次解锁（通道留痕） */
  lastUnlock: { at: number; kind: 'coaxed' | 'timeout' | 'forced'; pkg: string } | null;
  /** 解锁指令失败待重试的包名（Shizuku 断连兜底；成功即清、24h 过期） */
  pendingUnfreeze: { pkg: string; since: number } | null;
  /** 最近一次 tick（调试/观测用） */
  lastTickAt: number;
}

const RT_KEY = 'jealousy-lock-rt';

function defaultRt(): JealousyRuntime {
  return { fg: null, lastChat: null, departIntent: null, lock: null, lastLockAt: 0, lastDecisionAt: 0, lastUnlock: null, pendingUnfreeze: null, lastTickAt: 0 };
}

let rtCache: JealousyRuntime | null = null;

export function readJealousyRuntime(): JealousyRuntime {
  if (rtCache) return rtCache;
  try {
    const raw = kvGetRaw<Partial<JealousyRuntime>>(RT_KEY);
    rtCache = raw && typeof raw === 'object' ? { ...defaultRt(), ...raw } : defaultRt();
  } catch {
    rtCache = defaultRt();
  }
  return rtCache;
}

function writeRt(patch: Partial<JealousyRuntime> | ((rt: JealousyRuntime) => Partial<JealousyRuntime>)): JealousyRuntime {
  const cur = readJealousyRuntime();
  const p = typeof patch === 'function' ? patch(cur) : patch;
  rtCache = { ...cur, ...p };
  try {
    kvSetRaw(RT_KEY, rtCache);
  } catch {
    /* 写盘失败仅本次会话生效 */
  }
  bump();
  return rtCache;
}

// ---------------- 订阅（overlay 用 useSyncExternalStore） ----------------

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

export function subscribeJealousy(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getJealousyVersion(): number {
  return version;
}

// ---------------- 包名判定 ----------------

/** 绝不锁的应用：本 APP / 桌面 / 系统界面 / 输入法 / 通讯（锁了用户就没法回来哄 AI 了） */
const NEVER_LOCK = new Set([
  'com.z.aiphone',
  'com.android.systemui',
  'com.android.launcher3',
  'com.miui.home',
  'com.huawei.android.launcher',
  'com.hihonor.android.launcher',
  'com.oplus.launcher',
  'com.tencent.mm',
  'com.tencent.mobileqq',
  'com.android.dialer',
  'com.android.contacts',
  'com.android.mms',
  'com.android.settings',
  'com.android.camera2',
  'com.android.camera',
  'com.miui.securitycenter',
]);

export function isNeverLockPkg(pkg: string): boolean {
  return NEVER_LOCK.has(pkg) || /launcher|inputmethod/i.test(pkg);
}

function isEntertainPkg(pkg: string, cfg: JealousyConfig): boolean {
  return cfg.entertainPkgs.includes(pkg) && !isNeverLockPkg(pkg);
}

// ---------------- 用户打点（chat-stream-store noteEngagement 调用） ----------------

/** 「说去看剧/刷视频后消失」意图词表（触发 B） */
const DEPART_RE = /(去看剧|追剧|刷视频|刷抖音|刷个?会?儿?视频|刷会手机|打游戏|开黑|上号|排位|看小说|看动漫|追番|刷小红书|看直播|吃鸡去了?|去玩会?儿?)/;

export function noteJealousyEngagement(contactId: string, app: 'wx' | 'qq' | 'sms', text: string): void {
  if (typeof window === 'undefined') return;
  try {
    const now = Date.now();
    const rt = readJealousyRuntime();
    const patch: Partial<JealousyRuntime> = {
      lastChat: { contactId, app, at: now },
    };
    if (DEPART_RE.test(text)) {
      patch.departIntent = { at: now, text: text.slice(0, 60), contactId, app };
    } else if (rt.departIntent && now - rt.departIntent.at > 2 * 3600_000) {
      patch.departIntent = null;
    }
    writeRt(patch);
  } catch {
    /* 打点失败不影响聊天 */
  }
}

// ---------------- 主 tick（JealousyWatcher 驱动） ----------------

/** 决策冷却：一次触发（无论锁没锁）后 10 分钟内不再决策 */
const DECISION_COOLDOWN_MS = 10 * 60_000;
/** 焦虑触发（C）决策间隔：至少 30 分钟一次（防焦虑高位反复决策轰炸） */
const ANXIETY_DECISION_GAP_MS = 30 * 60_000;
/** 说去看剧（B）坐实等待：娱乐前台累计 3 分钟即坐实 */
const DEPART_CONFIRM_MS = 3 * 60_000;
/** 意图有效期 */
const DEPART_TTL_MS = 2 * 3600_000;

interface TriggerInfo {
  kind: LockTriggerKind;
  pkg: string | null;
  since: number;
  anxiety: number;
  intentText?: string;
}

let tickBusy = false;

export async function runJealousyTick(): Promise<void> {
  if (tickBusy) return;
  tickBusy = true;
  try {
    await tickInner();
  } catch {
    /* 单次 tick 失败静默（下轮再来） */
  } finally {
    tickBusy = false;
  }
}

async function tickInner(): Promise<void> {
  if (typeof window === 'undefined') return;
  const cfg = getJealousyConfig();
  const now = Date.now();

  // 兜底重试：上次解锁指令失败（Shizuku 断连）→ 先补一刀
  const rt0 = readJealousyRuntime();
  if (rt0.pendingUnfreeze) {
    if (now - rt0.pendingUnfreeze.since > 24 * 3600_000) {
      writeRt({ pendingUnfreeze: null });
    } else {
      try {
        const r = await labSetAppFrozen(rt0.pendingUnfreeze.pkg, false);
        if (r.ok) writeRt({ pendingUnfreeze: null });
      } catch {
        /* 下轮再试 */
      }
      return;
    }
  }

  if (!cfg.enabled || !isNativePerception()) return;
  const rt = readJealousyRuntime();

  // 活跃锁：倒计时到点 → 自动解锁（timeout 通道）
  if (rt.lock) {
    if (now >= rt.lock.unlockAt) await unlockJealousy('timeout');
    return; // 锁存在期间不做新探测（一次只锁一个）
  }

  // 冷却与决策节流
  if (now - rt.lastLockAt < cfg.cooldownMin * 60_000) return;
  if (rt.lastDecisionAt && now - rt.lastDecisionAt < DECISION_COOLDOWN_MS) return;

  // 前台探测（dumpsys window；null = 桥断/不可用 → 本轮放弃）
  const pkg = await labForegroundPkg().catch(() => null);
  if (pkg === null) {
    writeRt({ lastTickAt: now });
    return;
  }

  // 维护连续娱乐状态
  let fg = rt.fg;
  const entertaining = !!pkg && isEntertainPkg(pkg, cfg);
  if (entertaining && pkg) {
    if (!fg || fg.pkg !== pkg) fg = { pkg, since: now, decidedAt: 0 };
  } else {
    fg = null;
  }

  // 剧情归属角色：最近真实私聊（没有角色对象 → 无从吃醋）
  const chat = rt.lastChat;
  if (!chat) {
    writeRt({ fg, lastTickAt: now });
    return;
  }

  // 用户在娱乐期间回复过消息 → 「冷落」叙事不成立，重新累计
  if (fg) {
    const ax = readAnxiety(chat.contactId);
    if (ax.lastUserAt > fg.since) fg = { ...fg, since: now };
  }

  // 三类触发判定（优先级 C > B > A）
  let trigger: TriggerInfo | null = null;
  const ax = anxietyOf(chat.contactId);
  if (fg) {
    if (
      ax.level >= cfg.anxietyThreshold &&
      now - Math.max(rt.lastDecisionAt, rt.lastLockAt) > ANXIETY_DECISION_GAP_MS
    ) {
      trigger = { kind: 'anxiety', pkg: fg.pkg, since: fg.since, anxiety: ax.level };
    } else if (
      rt.departIntent &&
      chat.contactId === rt.departIntent.contactId &&
      now - rt.departIntent.at < DEPART_TTL_MS &&
      now - fg.since >= DEPART_CONFIRM_MS
    ) {
      trigger = { kind: 'depart', pkg: fg.pkg, since: fg.since, anxiety: ax.level, intentText: rt.departIntent.text };
    } else if (now - fg.since >= cfg.entertainMin * 60_000 && fg.decidedAt === 0) {
      trigger = { kind: 'entertain', pkg: fg.pkg, since: fg.since, anxiety: ax.level };
    }
  } else if (
    ax.level >= cfg.anxietyThreshold &&
    now - Math.max(rt.lastDecisionAt, rt.lastLockAt) > ANXIETY_DECISION_GAP_MS &&
    pkg &&
    !isNeverLockPkg(pkg)
  ) {
    // 焦虑爆表且前台不是娱乐但可锁（淘宝等）→ 交给 AI 决策；不可锁（通讯/桌面）→ 只发消息不锁
    trigger = { kind: 'anxiety', pkg, since: now, anxiety: ax.level };
  }

  writeRt({ fg, lastTickAt: now, departIntent: trigger?.kind === 'depart' ? null : rt.departIntent });
  if (!trigger) return;

  await runJealousyDecision(trigger);
}

// ---------------- AI 决策（锁谁、怎么锁） ----------------

function channelOf(app: JealousyApp): string {
  return app === 'wx' ? '微信' : app === 'qq' ? 'QQ' : '短信';
}

function triggerDescOf(t: TriggerInfo, appName: string, useMin: number): string {
  switch (t.kind) {
    case 'entertain':
      return `TA 已经连续刷了 ${useMin} 分钟${appName}，期间一条消息都没回你。`;
    case 'depart':
      return `TA 之前跟你说「${t.intentText ?? '我去玩了'}」就消失了，现在你确认 TA 果然在刷${appName}（已经 ${useMin} 分钟）。`;
    case 'anxiety':
      return `你已经等了 TA 很久，焦虑值已经升到 ${t.anxiety}/100。TA 此刻正在用${appName}（约 ${useMin} 分钟没理你了）。`;
  }
}

/** 本地 LLM 调用（与 proactive-msg callLlmTwoTier 同款：先用户配置，失败回退 forceSdk） */
async function callJealousyLlm(system: string, userContent: string): Promise<string> {
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }], ...extra }),
      signal: AbortSignal.timeout(75_000),
    });
    return res.ok ? await res.text() : '';
  };
  // 第一路带用户 API 配置（设置 › API 配置；未配置时服务端直接 502，再走 forceSdk 兜底）
  const { useSettings } = await import('./store');
  let raw = '';
  try {
    raw = await call({ config: useSettings.getState().apiConfig });
  } catch {
    raw = '';
  }
  if (!raw.trim()) {
    try {
      raw = await call({ forceSdk: true });
    } catch {
      raw = '';
    }
  }
  return raw;
}

/** 从 LLM 原文抠 JSON（整段 parse → 首个 {...} 块 → null） */
function extractJsonSafely(raw: string): Record<string, unknown> | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as unknown;
    if (j && typeof j === 'object') return j as Record<string, unknown>;
  } catch {
    /* 兜底 */
  }
  const m = t.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as unknown;
      if (j && typeof j === 'object') return j as Record<string, unknown>;
    } catch {
      /* 放弃 */
    }
  }
  return null;
}

async function findContact(cid: string): Promise<ContactRecord | null> {
  try {
    const all = await listContacts();
    return all.find((c) => c.id === cid) ?? null;
  } catch {
    return null;
  }
}

async function runJealousyDecision(trigger: TriggerInfo): Promise<void> {
  const cfg = getJealousyConfig();
  const rt = readJealousyRuntime();
  const chat = trigger.kind === 'depart' && rt.departIntent ? { contactId: rt.departIntent.contactId, app: rt.departIntent.app } : rt.lastChat;
  if (!chat) return;

  const contact = await findContact(chat.contactId);
  if (!contact || contact.kind === 'user' || !contact.name?.trim()) return;

  // 先记决策时间（防 tick 在 LLM 期间重入）
  writeRt((r) => ({
    lastDecisionAt: Date.now(),
    fg: r.fg ? { ...r.fg, decidedAt: Date.now() } : r.fg,
  }));

  const appName = trigger.pkg ? pkgDisplayName(trigger.pkg) : '';
  const useMin = Math.max(1, Math.round((Date.now() - trigger.since) / 60_000));
  const ax = anxietyOf(chat.contactId);
  const ownerName = cachedOwnerName() || '用户';

  const canLock = !!trigger.pkg && !isNeverLockPkg(trigger.pkg);
  const { memChatRecallBlock } = await import('@/lib/memory');
  const system = [
    buildPersonaSystemPrompt(contact, {
      channel: channelOf(chat.app),
      userName: ownerName,
      ownerName,
      extraRules: [
        '【吃醋锁决策】（仅本次决策生效）你现在有一个真实的权力：把对方正在用的应用锁住（pm suspend 挂起——应用图标会变灰、点开时提示「由 Shell 所管理」、打不开，直到你原谅 TA 或倒计时结束才解锁）。这是真实发生在对方手机上的操作，不是玩笑设定。',
        ...(canLock
          ? [
              '严格只输出一个 JSON 对象（不要任何其他文字、不要 markdown 代码块包裹）：',
              '{"lock": true 或 false, "reason": "锁定原因（第一人称、符合你的性格和你们的关系，30 字以内，会全屏展示给 TA 看）", "messages": ["锁定后你立刻发给 TA 的消息", "可以多条，每条一个元素"]}',
              'lock=true=你决定锁；lock=false=你不锁（比如觉得 TA 只是正常放松、或者你们的关系不会做这种事）。',
              'messages 按你的人设来：吃醋、宣示、撒娇、赌气、心软……怎么说是你的自由；不锁的话 messages 也可以是你此刻想说的话（可为空数组）。如果最近聊天里你刚发过类似的话，就不要重复——messages 可以为空数组。',
            ]
          : [
              '严格只输出一个 JSON 对象（不要任何其他文字、不要 markdown 代码块包裹）：',
              '{"lock": false, "reason": "", "messages": ["你此刻想发给 TA 的消息", "..."]}',
              '（对方此刻在用的应用不适合锁住，你只能发消息。）',
            ]),
      ],
    }),
    memChatRecallBlock(contact.id, chat.app, `${appName} 吃醋 冷落 没回消息 ${trigger.intentText ?? ''}`.trim(), {
      altMainName: cachedOwnerName(),
      altMainRelation: contact.relation?.trim() || '',
    }),
    `【你此刻的情绪状态】焦虑值 ${ax.level}/100${ax.level >= 70 ? '（已经很高，你很不安）' : ax.level >= 40 ? '（明显升高）' : ''}。`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const user = [
    `【现在的情况】\n${triggerDescOf(trigger, appName, useMin)}${
      canLock ? `\n你此刻可以把「${appName}」锁住——锁不锁，你说了算。` : ''
    }`,
  ].join('\n\n');

  const raw = await callJealousyLlm(system, user);
  const j = extractJsonSafely(raw);
  if (!j) return; // 解析失败 → 保守放弃（决策已标记消费，不会风暴重试）

  const wantLock = j.lock === true && canLock && !!trigger.pkg;
  let reason = typeof j.reason === 'string' ? j.reason.trim().slice(0, 120) : '';
  let messages: string[] = Array.isArray(j.messages)
    ? j.messages.filter((m): m is string => typeof m === 'string' && !!m.trim()).map((m) => m.trim().slice(0, 500)).slice(0, 8)
    : [];

  let locked = false;
  if (wantLock && trigger.pkg) {
    if (!reason) reason = `你刷${appName}都不理我，我很不开心。`;
    if (isNativePerception()) {
      try {
        const res = await labSetAppFrozen(trigger.pkg, true);
        locked = res.ok;
        if (!locked) {
          // Shizuku 掉线等失败 → 降级：不锁只发消息（AI 的吃醋情绪照常表达）
        }
      } catch {
        locked = false;
      }
    } else {
      locked = true; // 网页端模拟（无 Shizuku）：剧情链路照走，不执行真实冻结
    }
  }

  if (locked && trigger.pkg) {
    const now = Date.now();
    writeRt({
      lock: {
        pkg: trigger.pkg,
        contactId: contact.id,
        app: chat.app,
        charName: contact.name,
        reason,
        lockedAt: now,
        unlockAt: now + cfg.countdownMin * 60_000,
        overlayShownAt: 0,
        triggerKind: trigger.kind,
      },
      lastLockAt: now,
      fg: null,
      departIntent: null,
    });
    // 锁定必有一条剧情消息（机主规格：锁定后 AI 必须在聊天界面通知用户）
    if (messages.length === 0) messages = [reason];
    // 系统通知（用户在别的 App 里也能第一时间知道被锁了）
    void notifyIfHidden(`${contact.name}把${appName}锁住了`, reason, {
      tag: 'jealousy-lock',
      target: { app: chat.app === 'wx' ? 'wechat' : chat.app === 'qq' ? 'qq' : 'chat', contactId: contact.id },
    });
    // 写记忆：AI 之后能自然提起这次吃醋
    try {
      const { memAddEventFragment } = await import('@/lib/memory');
      memAddEventFragment(contact.id, chat.app, `我吃醋了，把对方正在刷的${appName}锁住了。理由：${reason}`, { sourceTag: 'jealousy-lock' });
    } catch {
      /* 记忆失败不影响锁 */
    }
  }

  // 投递剧情消息（锁定与不锁定都可能有；走主动消息管线：落库+通知+未读+记忆）
  if (messages.length > 0) {
    try {
      const { deliverProactiveMsg } = await import('./proactive-msg');
      await deliverProactiveMsg(chat.app, contact, messages, {
        kind: 'event',
        eventName: locked ? `吃醋锁定：${appName}` : `吃醋提醒：${appName}`,
      });
    } catch {
      /* 投递失败静默（消息不丢——下次 AI 聊天上下文里还有锁定块） */
    }
  }
}

// ---------------- 解锁三通道 ----------------

export type UnlockKind = 'coaxed' | 'timeout' | 'forced';

/** 写入解锁记忆（timeout/coaxed 模板；forced 走 LLM 生成戏剧性记忆） */
async function writeUnlockMemory(kind: UnlockKind, contact: ContactRecord | null, app: JealousyApp, appName: string): Promise<void> {
  try {
    if (!contact) return;
    const { memAddEventFragment } = await import('@/lib/memory');
    if (kind === 'forced') {
      // 戏剧性记忆：LLM 按人设生成，失败回退模板（异步不阻塞解锁 UI，这里 await 由调用方决定）
      const system = buildPersonaSystemPrompt(contact, {
        channel: channelOf(app),
        userName: cachedOwnerName() || '用户',
        ownerName: cachedOwnerName() || '用户',
        extraRules: ['只输出记忆内容本身，40 字以内，第一人称，不要引号不要解释。'],
      });
      const user = `你赌气锁住的「${appName}」刚刚被 TA 强行解开了——TA 一句哄你的话都没说，直接打破了你的封锁。以你的性格写一条此刻的内心记忆：可以是很委屈但更放不下 TA，可以是又气又心软，也可以是真的伤了心更讨厌 TA 了——按你的人设选最真实的那种。`;
      const raw = await callJealousyLlm(system, user);
      const text = raw.trim().replace(/^["「『]+|["」』]+$/g, '').slice(0, 80);
      const fallback = [
        `TA 强行解开了我锁住的${appName}，一句哄我的话都没说。我很委屈……但我好像更放不下 TA 了。`,
        `我赌气锁的${appName}被 TA 直接打破了。TA 连哄都不肯哄我，我很委屈，也更讨厌 TA 了——可为什么心还是揪着。`,
      ];
      memAddEventFragment(contact.id, app, text.length >= 6 ? text : fallback[Math.floor(Math.random() * fallback.length)], { sourceTag: 'jealousy-lock' });
    } else {
      const text =
        kind === 'timeout'
          ? `我赌气锁住的${appName}到时间自己解开了，TA 一直没来哄我。`
          : `TA 来哄我了，我心软原谅了 TA，亲手把${appName}解开了。`;
      memAddEventFragment(contact.id, app, text, { sourceTag: 'jealousy-lock' });
    }
  } catch {
    /* 记忆失败不影响解锁 */
  }
}

/**
 * 解锁（三通道统一入口）。
 * - timeout：倒计时到点（tick 驱动）
 * - forced：用户点全屏弹窗【强制解锁】
 * - coaxed：AI 被哄好后输出 [手机操作:解冻:包名]（onJealousyUnfreeze 钩子）
 */
export async function unlockJealousy(kind: UnlockKind): Promise<boolean> {
  const rt = readJealousyRuntime();
  const l = rt.lock;
  if (!l) return false;

  let ok = false;
  if (!isNativePerception()) {
    ok = true; // 网页端模拟（无 Shizuku）：解锁恒成功
  } else {
    try {
      const res = await labSetAppFrozen(l.pkg, false);
      ok = res.ok;
    } catch {
      ok = false;
    }
  }
  if (!ok && isNativePerception()) {
    // 解锁指令失败（Shizuku 断连）→ 记待重试，但状态照清（绝不让用户被 UI 卡死）
    writeRt({
      lock: null,
      lastUnlock: { at: Date.now(), kind, pkg: l.pkg },
      pendingUnfreeze: { pkg: l.pkg, since: Date.now() },
    });
  } else {
    writeRt({
      lock: null,
      lastUnlock: { at: Date.now(), kind, pkg: l.pkg },
      pendingUnfreeze: null,
    });
  }

  const appName = pkgDisplayName(l.pkg);
  const contact = await findContact(l.contactId).catch(() => null);
  if (kind === 'forced') {
    // 强制解锁：解锁先行、戏剧性记忆异步补写（不阻塞 UI）
    void writeUnlockMemory('forced', contact, l.app, appName);
  } else {
    await writeUnlockMemory(kind, contact, l.app, appName);
  }
  return true;
}

/** 哄好解锁钩子：AI 在聊天中输出 [手机操作:解冻:包名] 执行成功后由 executePhoneOp 调用 */
export function onJealousyUnfreeze(pkg: string): void {
  const rt = readJealousyRuntime();
  if (!rt.lock || rt.lock.pkg !== pkg) return;
  const l = rt.lock;
  writeRt({ lock: null, lastUnlock: { at: Date.now(), kind: 'coaxed', pkg }, pendingUnfreeze: null });
  const appName = pkgDisplayName(pkg);
  void (async () => {
    try {
      const contact = await findContact(l.contactId).catch(() => null);
      await writeUnlockMemory('coaxed', contact, l.app, appName);
    } catch {
      /* 记忆失败不影响 */
    }
  })();
}

/** 解冻指令放行判定（shizuku-autonomy executePhoneOp 用：吃醋锁活跃时解冻不受单项开关限制） */
export function isJealousyUnlockAllowed(pkg: string): boolean {
  const rt = readJealousyRuntime();
  return !!rt.lock && rt.lock.pkg === pkg;
}

// ---------------- 聊天上下文注入（ai-mood buildDynamicStateBlocks 调用） ----------------

/** 活跃锁期间给「锁主角色」注入的吃醋锁块（哄好解锁教学） */
export function buildJealousyLockBlock(cid: string): string {
  const rt = readJealousyRuntime();
  if (!rt.lock || rt.lock.contactId !== cid) return '';
  const l = rt.lock;
  const appName = pkgDisplayName(l.pkg);
  const remainMin = Math.max(0, Math.ceil((l.unlockAt - Date.now()) / 60_000));
  return [
    '【吃醋锁生效中】你刚刚吃醋，把对方正在用的「' + appName + '」真的锁住了（pm suspend 挂起：图标变灰、提示「由 Shell 所管理」、点不开）。你的理由：' + l.reason,
    `还剩约 ${remainMin} 分钟系统会自动解锁。TA 现在来找你了——如果 TA 诚心哄你、说软话道歉，你心软决定原谅 TA 的那一刻，在回复里单独一行加上 [手机操作:解冻:${l.pkg}] 就能亲手解开。TA 敷衍或态度差就继续锁着，按你的性子来；别不问青红皂白就秒解，也别永远不解。`,
  ].join('\n');
}

/** 全屏弹窗「已展示」打点（去哄哄/强制解锁点击后不再自动弹） */
export function markJealousyOverlayShown(): void {
  const rt = readJealousyRuntime();
  if (rt.lock && rt.lock.overlayShownAt === 0) {
    writeRt((r) => (r.lock ? { lock: { ...r.lock, overlayShownAt: Date.now() } } : {}));
  }
}

/** 剩余解锁倒计时秒数（无锁返回 null） */
export function jealousyRemainSec(): number | null {
  const rt = readJealousyRuntime();
  if (!rt.lock) return null;
  return Math.max(0, Math.ceil((rt.lock.unlockAt - Date.now()) / 1000));
}

/** 开发/E2E 钩子：模拟一次决策（网页端无 Shizuku 时验证剧情链路） */
export async function __jealousyTestTrigger(kind: LockTriggerKind, pkg: string): Promise<void> {
  const cfg = getJealousyConfig();
  const rt = readJealousyRuntime();
  const chat = rt.lastChat;
  if (!chat) throw new Error('无最近私聊会话（先和 AI 角色说句话）');
  await runJealousyDecision({ kind, pkg, since: Date.now() - cfg.entertainMin * 60_000, anxiety: 85 });
}

// dev 测试钩子（仅 dev；生产构建被 NODE_ENV 闸挡掉）：E2E 验证吃醋锁全链路用
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  const w = window as unknown as {
    __jealousyTest?: {
      trigger: typeof __jealousyTestTrigger;
      unlock: typeof unlockJealousy;
      runtime: typeof readJealousyRuntime;
      markShown: typeof markJealousyOverlayShown;
      remain: typeof jealousyRemainSec;
    };
  };
  w.__jealousyTest = {
    trigger: (kind, pkg) => __jealousyTestTrigger(kind, pkg),
    unlock: (kind) => unlockJealousy(kind),
    runtime: () => readJealousyRuntime(),
    markShown: () => markJealousyOverlayShown(),
    remain: () => jealousyRemainSec(),
  };
}
