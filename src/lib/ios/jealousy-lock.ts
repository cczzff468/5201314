'use client';

/**
 * 吃醋锁（v1.9.19，v1.9.35 Web 化）——「AI 真实吃醋并锁应用」核心库。
 *
 * v1.9.35 按机主重构令：真机 Shizuku（pm suspend/dumpsys/截图）路径全面退役，
 * 锁定/巡检/拉回全部走 Web 网页生态（虚拟手机）：
 * - 守望者（JealousyWatcher）周期探测虚拟手机当前打开的 App（web-usage-ledger）；
 * - 三类触发：A 连续刷娱乐 App 超时且期间没回 AI 消息 / B 聊天里说了「去看剧/刷视频」
 *   随后消失且坐实在娱乐 App / C 焦虑值达危险阈值；
 * - 触发后把【前台包名 + 焦虑值 + 记忆上下文】交给大模型，按角色人设决定是否锁
 *   （web-app-lock：图标置灰、点开只弹 TA 的留言、倒计时/哄好/强制三通道解锁）；
 * - 锁定成功：AI 在聊天界面发剧情消息 + 系统通知 + 写记忆 + 全屏锁定弹窗（回 APP 强制弹）；
 * - 解锁三通道：哄好（AI 输出 [手机操作:解冻:包名]）/ 倒计时到点 / 强制解锁（写戏剧性记忆）。
 *
 * v1.9.28 锁定期间主动巡检（「AI 吃醋了会盯着你」）：
 * - 默认锁定 15 分钟自动解锁（countdownMin 可自定义 5~180）；
 * - 锁定期每 patrolMin（默认 3）分钟一轮巡检：虚拟手机当前 App + 多任务清单 +
 *   虚拟使用时长账本（web-usage-ledger）；
 * - 巡检情报交大模型按人设决策：发吃醋喊话（deliverProactiveMsg）/ 把机主从别的
 *   软件拽回本 APP（网页切回聊天页 + 系统通知，每锁最多 2 次）；
 * - 最新巡检情报注入聊天上下文（buildJealousyLockBlock）——机主回来聊天时 AI 能
 *   自然说出「我看到你刚才还在刷抖音」。
 *
 * 存储：
 * - 配置 localStorage `jealousy-lock-cfg-v1`（同步读，设置页即点即存）；
 * - 运行状态 IndexedDB kvRaw `jealousy-lock-rt`（跨会话持久化：倒计时/冷却/巡检重启不丢）。
 *
 * 依赖方向（无环）：jealousy-lock → anxiety / web-app-lock / memory / persona / local-notify；
 * ai-mood → jealousy-lock（buildJealousyLockBlock 注入聊天上下文）；
 * shizuku-autonomy → jealousy-lock（解冻钩子 onJealousyUnfreeze / isJealousyUnlockAllowed）。
 */

import { kvGetRaw, kvSetRaw } from './idb-kv';
import { readAnxiety, anxietyOf } from './anxiety';
import { buildPersonaSystemPrompt } from './persona';
import { listContacts, cachedOwnerName } from './contacts-store';
import type { ContactRecord } from '@/lib/contacts';
import { notifyIfHidden } from './local-notify';
import { setAutonomyMaster, setAutonomyCap } from './shizuku-autonomy';
import { webAppOfPkg, webPkgOfApp, setWebFrozen, getWebFrozen } from './web-app-lock';
// v2.0 双模式感知层（模式隔离：网页/真机各自采集；锁应用 pm suspend / 强行拉回 am start / 偷窥截屏）
import { collectSenseIntel, deviceSuspendApp, deviceUnsuspendApp, deviceSuspendState, devicePullback, devicePeekScreen, fmtMs, type SenseIntel } from './jealousy-sense';
import type { SenseMode } from './jealousy-sense-types';

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
  /** 倒计时自动解锁（分钟）；v1.9.28 默认 15（用户规格：吃醋锁让他 15 分钟，可自定义）；
   *  v2.0 起为「AI 未指定锁定时长时的兜底默认」——AI 可自行决定 3/5/15/30 分钟或直到哄好 */
  countdownMin: number;
  /** 两次锁定之间冷却（分钟） */
  cooldownMin: number;
  /** 娱乐 App 包名清单 */
  entertainPkgs: string[];
  /** v1.9.28 锁定期间 AI 主动巡检（截图/查后台/使用时长 → 按人设喊话/拉回） */
  patrolEnabled: boolean;
  /** v1.9.28 巡检间隔（分钟） */
  patrolMin: number;
  /** v1.9.28 允许 AI 把机主从别的软件拉回本 APP */
  pullbackEnabled: boolean;
  // ---------------- v2.0「赛博伴侣」升级 ----------------
  /** 查岗模式：'web'=只读网页内部状态 / 'device'=只经 Shizuku 读真实手机（严格模式隔离） */
  senseMode: SenseMode;
  /** 定时暗中观察间隔（分钟；默认 15，可自定义）——无论有无锁都周期性采集情报交 AI 决策 */
  watchMin: number;
  /** 主动查岗：AI 结合人设+记忆+上下文+焦虑值怀疑用户在做坏事时可加急随时再查（默认开） */
  autoWatch: boolean;
  /** 截屏偷窥：真机模式下 AI 可静默截屏并让识图模型看一眼（网页模式无此通道，开关不生效） */
  peekEnabled: boolean;
  /** 锁定时长由 AI 决定（关=一律用 countdownMin 默认值） */
  lockMinByAi: boolean;
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
  // v1.9.21：网页内锁定对象补充（浏览器/照片/X论坛——网页降级时 pkgDisplayName 也要给中文名）
  ['浏览器', 'com.android.browser'],
  ['照片', 'com.android.gallery3d'],
  ['X论坛', 'com.x.forum'],
].map(([name, pkg]) => [pkg, name]));

export function pkgDisplayName(pkg: string): string {
  return PKG_DISPLAY[pkg] ?? pkg;
}

function defaultCfg(): JealousyConfig {
  return {
    enabled: false,
    entertainMin: 30,
    anxietyThreshold: 80,
    countdownMin: 15,
    cooldownMin: 60,
    entertainPkgs: ENTERTAIN_PRESETS.slice(0, 6).map(([, p]) => p),
    patrolEnabled: true,
    patrolMin: 3,
    pullbackEnabled: true,
    // v2.0：默认网页模式（安全沙箱/浏览器预览可用；真机模式需 APK+Shizuku）
    senseMode: 'web',
    watchMin: 15,
    autoWatch: true,
    peekEnabled: true,
    lockMinByAi: true,
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
      // v1.9.28 新字段向后兼容：旧配置未存过时取默认开（老用户升级即得巡检能力）
      patrolEnabled: p.patrolEnabled !== false,
      patrolMin: clampNum(p.patrolMin, 1, 15, d.patrolMin),
      pullbackEnabled: p.pullbackEnabled !== false,
      // v2.0 新字段向后兼容（旧配置全部取默认：网页模式/15 分钟暗中观察/主动查岗开）
      senseMode: p.senseMode === 'device' ? 'device' : 'web',
      watchMin: clampNum(p.watchMin, 5, 120, d.watchMin),
      autoWatch: p.autoWatch !== false,
      peekEnabled: p.peekEnabled !== false,
      lockMinByAi: p.lockMinByAi !== false,
    };
  } catch {
    return defaultCfg();
  }
}

function clampNum(v: unknown, min: number, max: number, dft: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dft;
  return Math.max(min, Math.min(max, n));
}

/**
 * v1.9.23 AI 工具调用：把一批包名加入吃醋锁「娱乐 App 清单」（AI 经 addJealousyLockApps
 * 工具自动拉取手机应用列表后增补用）。包名格式校验 + 去重 + 60 上限；返回增补结果供工具回话。
 */
export function addJealousyEntertainPkgs(pkgs: string[]): { added: string[]; skipped: string[] } {
  const cfg = getJealousyConfig();
  const added: string[] = [];
  const skipped: string[] = [];
  for (const p of pkgs) {
    const pkg = typeof p === 'string' ? p.trim() : '';
    if (!/^[\w.]+$/.test(pkg) || cfg.entertainPkgs.includes(pkg) || added.includes(pkg)) {
      skipped.push(pkg);
      continue;
    }
    if (cfg.entertainPkgs.length + added.length >= 60) {
      skipped.push(pkg);
      continue;
    }
    added.push(pkg);
  }
  if (added.length > 0 && typeof window !== 'undefined') {
    cfg.entertainPkgs = [...cfg.entertainPkgs, ...added];
    window.localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  }
  return { added, skipped };
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
  /** v1.9.21：锁在网页内（Shizuku 未连接降级）——弹窗/聊天上下文文案适配用 */
  web: boolean;
  /** v2.0：本锁由哪次决策产生（watch=暗中观察 / trigger=硬触发；聊天上下文叙事用） */
  bornFrom: 'watch' | 'trigger';
  /** v2.0：锁定时长是否为「直到哄好」（true=UI 显示直到哄好，unlockAt 是安全兜底而非真实预期） */
  untilCoaxed: boolean;
  /** v2.0：强制解锁感知——本轮锁活跃期内是否已发过「阴阳怪气」消息（防重复轰炸） */
  breachNotified: boolean;
}

/** v1.9.28 锁定期间的巡检状态（锁定解除即清零） */
export interface JealousyPatrol {
  /** 上次巡检时间 */
  lastAt: number;
  /** 本轮锁定累计巡检次数 */
  count: number;
  /** 最近一次巡检情报摘要（聊天上下文注入用：AI 自然提起「我看到你在刷X」） */
  lastIntel: string;
  /** 上次拉回时间 */
  lastPullbackAt: number;
  /** 本轮锁定累计拉回次数 */
  pullbackCount: number;
}

/** v2.0 定时暗中观察状态（总开关开启即运行，与有无锁无关） */
export interface JealousyWatch {
  /** 上次暗中观察时间 */
  lastAt: number;
  /** 今日累计暗中观察次数 */
  count: number;
  /** 最近一次观察到的情报摘要（聊天上下文注入：AI 能自然提起「我看到你在刷X」） */
  lastIntel: string;
  /** 最近一次决策动作（quiet 静默 / warn 警告 / lock 锁定 / peek 偷窥；跨日清零） */
  lastAct: 'quiet' | 'warn' | 'lock' | 'peek' | '';
  /** AI 怀疑做坏事时的主动查岗窗口（期间观察间隔缩短到 3 分钟；到期恢复正常间隔） */
  suspectUntil: number;
  /** 今日记账日（跨日自动清零 count） */
  day: string;
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
  /** v1.9.28 锁定期间巡检状态（无锁时为 null） */
  patrol: JealousyPatrol | null;
  /** v2.0 定时暗中观察状态（enabled 总开关开启后即非 null） */
  watch: JealousyWatch | null;
  /** 上次锁定时间（冷却用） */
  lastLockAt: number;
  /** 上次决策时间（无论锁没锁；防 tick 反复触发决策） */
  lastDecisionAt: number;
  /** 上次解锁（通道留痕；breach=强制解锁感知发现的强行突破） */
  lastUnlock: { at: number; kind: 'coaxed' | 'timeout' | 'forced' | 'breach'; pkg: string } | null;
  /** 解锁指令失败待重试的包名（Shizuku 断连兜底；成功即清、4h 过期） */
  pendingUnfreeze: { pkg: string; since: number } | null;
  /** 最近一次 tick（调试/观测用） */
  lastTickAt: number;
}

const RT_KEY = 'jealousy-lock-rt';

function defaultRt(): JealousyRuntime {
  return { fg: null, lastChat: null, departIntent: null, lock: null, patrol: null, watch: null, lastLockAt: 0, lastDecisionAt: 0, lastUnlock: null, pendingUnfreeze: null, lastTickAt: 0 };
}

/** 今日日期键（watch.count 跨日清零用） */
function dayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 读/建暗中观察状态（旧记录跨日自动清零 count） */
function readWatch(rt: JealousyRuntime): JealousyWatch {
  const today = dayKey();
  if (rt.watch && rt.watch.day === today) return rt.watch;
  return { lastAt: 0, count: 0, lastIntel: '', lastAct: '', suspectUntil: 0, day: today };
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
  if (isNeverLockPkg(pkg)) return false;
  // v1.9.21 网页降级：Shizuku 未连接时前台=虚拟手机里的 App，可锁的网页 App
  // （音乐/浏览器/淘宝/美团/照片/X论坛）全算「娱乐」——网页手机里娱乐面窄，逛淘宝
  // 点外卖不理 AI 同样是吃醋叙事，且最终锁不锁仍由 AI 按人设决策，不会误伤
  // v1.9.35：真机清单退役——娱乐判定=网页内应用即娱乐面（音乐/浏览器/淘宝/美团/照片/X论坛）
  return webAppOfPkg(pkg) !== null;
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

// ---------------- 锁定期间主动巡检（v1.9.28） ----------------

/** 首次巡检距锁定时刻的最小等待（锁定瞬间已发过剧情消息，别立刻又巡检喊话） */
const PATROL_FIRST_DELAY_MS = 60_000;
/** 每轮锁定最多拉回次数（防暴力拽人；到上限后 LLM 只能发消息） */
const PATROL_PULLBACK_MAX = 2;
/** 两次拉回最小间隔 */
const PATROL_PULLBACK_GAP_MS = 2 * 60_000;

// ---------------- v2.0 暗中观察（定时查岗） ----------------

/** 主动查岗加急间隔（AI 怀疑做坏事时，观察间隔缩短到 3 分钟） */
const WATCH_SUSPECT_MIN = 3;
/** 怀疑窗口长度（过期后恢复正常观察间隔） */
const WATCH_SUSPECT_WINDOW_MS = 30 * 60_000;
/** 「直到哄好」锁的安全兜底时长（7 天；真正的解锁靠哄好/强制两通道） */
const COAXED_CAP_MS = 7 * 24 * 3600_000;

/** 当前模式下「可锁包」判定（模式隔离核心：网页=只认网页体；真机=除永不清单外皆可 pm suspend） */
function canLockPkgInMode(pkg: string | null, cfg: JealousyConfig): boolean {
  if (!pkg || isNeverLockPkg(pkg)) return false;
  return cfg.senseMode === 'device' ? true : webAppOfPkg(pkg) !== null;
}

/** 当前模式下娱乐包判定（网页=网页体；真机=用户娱乐清单） */
function isEntertainPkgInMode(pkg: string, cfg: JealousyConfig): boolean {
  if (isNeverLockPkg(pkg)) return false;
  if (cfg.senseMode === 'device') return cfg.entertainPkgs.includes(pkg);
  return webAppOfPkg(pkg) !== null;
}

/** 模式隔离的前台探测：网页=虚拟手机 activeApp 映射；真机=Shizuku dumpsys（失败 null） */
async function senseForegroundPkg(cfg: JealousyConfig): Promise<string | null> {
  if (cfg.senseMode === 'device') {
    const intel = await collectSenseIntel('device');
    return intel.ok ? intel.fgPkg : null;
  }
  try {
    const { useUI } = await import('./store');
    const active = useUI.getState().activeApp;
    if (!active) return null;
    return webPkgOfApp(active);
  } catch {
    return null;
  }
}

/** 暗中观察的实际间隔（主动查岗窗口内缩短；否则用 watchMin） */
function watchGapMs(cfg: JealousyConfig, w: JealousyWatch): number {
  if (cfg.autoWatch && Date.now() < w.suspectUntil) return WATCH_SUSPECT_MIN * 60_000;
  return cfg.watchMin * 60_000;
}

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

  // v2.0：真机锁的 unsuspend 补刀重试（Shizuku 断连时 unlockJealousy 落 pendingUnfreeze；
  // 这里每 tick 重试 pm unsuspend，成功即清；4h 过期放弃——网页锁解冻恒成功不受影响）
  const rt0 = readJealousyRuntime();
  if (rt0.pendingUnfreeze && now - rt0.pendingUnfreeze.since < 4 * 3600_000) {
    const pu = rt0.pendingUnfreeze;
    void deviceUnsuspendApp(pu.pkg).then((r) => {
      if (r.ok) writeRt({ pendingUnfreeze: null });
    });
  } else {
    writeRt({ pendingUnfreeze: null });
  }

  // 活跃锁：倒计时到点 → 自动解锁（timeout 通道）。
  // v1.9.20：前移到功能闸门之前——已存在的锁必须能到点自解，无论此刻功能开关是否被
  // 关闭、是否原生环境（网页模拟锁同理）。否则「锁定期关掉总开关」会同时停掉倒计时
  // 与设置页折叠后的立即解锁按钮，用户会被无限锁死。
  // v1.9.28：锁存在期间照旧不做新触发探测，但新增「主动巡检」——TA 每隔几分钟用工具
  // 看机主在干嘛（截图/查后台/使用时长），按人设决定要不要喊话/把人拉回来。
  // v2.0：真机锁新增「强制解锁感知」——锁仍活跃但 pm suspend 状态已不在 ⇒ 用户绕过封锁，
  // AI 立刻发阴阳怪气消息（breach 通道）；网页锁的对应体验是 overlay【强制解锁】按钮。
  const rt = readJealousyRuntime();
  if (rt.lock) {
    if (now >= rt.lock.unlockAt) {
      await unlockJealousy('timeout');
    } else {
      // v2.0 强制解锁感知（仅真机锁；网页锁的冻结态在网页内部，无需也无处被系统外解）
      if (!rt.lock.web && !rt.lock.breachNotified) {
        await detectForcedBreach(rt.lock);
        const l2 = readJealousyRuntime().lock;
        if (!l2 || now >= l2.unlockAt) return; // 感知链路里锁可能已被解除
      }
      // v1.9.21 自愈：活跃锁期间重申网页冻结态（刷新/两份存储分叉时每 30s 对齐；
      // setWebFrozen 内部「无变化不广播」，不会白刷订阅者）
      if (rt.lock.web) setWebFrozen(rt.lock.pkg, rt.lock.unlockAt, rt.lock.charName);
      // v1.9.28 巡检调度：距锁定 ≥1 分钟后、距上次巡检 ≥ patrolMin 分钟 → 跑一轮巡检
      if (cfg.patrolEnabled && now - rt.lock.lockedAt >= PATROL_FIRST_DELAY_MS) {
        const lastPatrolAt = rt.patrol?.lastAt ?? 0;
        if (now - lastPatrolAt >= cfg.patrolMin * 60_000) {
          await runJealousyPatrol(rt.lock);
        }
      }
    }
    return; // 锁存在期间不做新探测（一次只锁一个）
  }

  // v1.9.21：无锁时清掉可能残留的网页冻结态（IndexedDB 锁已不存在而 localStorage 还冻着 → 分叉自愈）。
  // v1.9.23 例外：src='ai'（AI 经工具/标记协议主动冻的，无吃醋锁记录）不清——它有自己的
  // unlockAt 到期自愈；被这里误清会让「AI 帮我锁应用」几秒后悄悄失效
  {
    const fz = getWebFrozen();
    if (fz && fz.src !== 'ai') setWebFrozen(null);
  }

  if (!cfg.enabled) return;

  // v2.0 定时暗中观察（主开关开即运行；首轮在首 tick 落地后即跑——JealousyWatcher 的
  // 12s 首跳延迟已避开开机高峰，后续每 watchMin 一轮；主动查岗窗口内间隔缩短）
  const w = readWatch(rt);
  if (rt.lastChat && (w.lastAt === 0 || now - w.lastAt >= watchGapMs(cfg, w))) {
    await runJealousyWatch();
  }

  // 冷却与决策节流（硬触发决策的节流；暗中观察不受冷却影响——观察只是看，锁不锁由 AI 与冷却共同把关）
  const rt2 = readJealousyRuntime();
  if (now - rt2.lastLockAt < cfg.cooldownMin * 60_000) return;
  if (rt2.lastDecisionAt && now - rt2.lastDecisionAt < DECISION_COOLDOWN_MS) return;

  // 前台探测（v2.0 模式隔离）：网页=虚拟手机当前 App / 真机=Shizuku dumpsys（主屏/锁屏/不可锁 App/桥断 → null）
  const pkg: string | null = await senseForegroundPkg(cfg);

  // 维护连续娱乐状态
  let fg = rt2.fg;
  const entertaining = !!pkg && isEntertainPkgInMode(pkg, cfg);
  if (entertaining && pkg) {
    if (!fg || fg.pkg !== pkg) fg = { pkg, since: now, decidedAt: 0 };
  } else {
    fg = null;
  }

  // 剧情归属角色：最近真实私聊（没有角色对象 → 无从吃醋）
  const chat = rt2.lastChat;
  if (!chat) {
    writeRt({ fg, lastTickAt: now });
    return;
  }

  // 用户在娱乐期间回复过消息 → 「冷落」叙事不成立，重新累计
  if (fg) {
    const ax = readAnxiety(chat.contactId);
    if (ax.lastUserAt > fg.since) fg = { ...fg, since: now };
  }

  // 三类硬触发判定（优先级 C > B > A；v2.0：这些触发仍是决策入口，锁不锁/锁多久交给升级后的决策引擎）
  let trigger: TriggerInfo | null = null;
  const ax = anxietyOf(chat.contactId);
  if (fg) {
    if (
      ax.level >= cfg.anxietyThreshold &&
      now - Math.max(rt2.lastDecisionAt, rt2.lastLockAt) > ANXIETY_DECISION_GAP_MS
    ) {
      trigger = { kind: 'anxiety', pkg: fg.pkg, since: fg.since, anxiety: ax.level };
    } else if (
      rt2.departIntent &&
      chat.contactId === rt2.departIntent.contactId &&
      now - rt2.departIntent.at < DEPART_TTL_MS &&
      now - fg.since >= DEPART_CONFIRM_MS
    ) {
      trigger = { kind: 'depart', pkg: fg.pkg, since: fg.since, anxiety: ax.level, intentText: rt2.departIntent.text };
    } else if (now - fg.since >= cfg.entertainMin * 60_000 && fg.decidedAt === 0) {
      trigger = { kind: 'entertain', pkg: fg.pkg, since: fg.since, anxiety: ax.level };
    }
  } else if (
    ax.level >= cfg.anxietyThreshold &&
    now - Math.max(rt2.lastDecisionAt, rt2.lastLockAt) > ANXIETY_DECISION_GAP_MS &&
    pkg &&
    !isNeverLockPkg(pkg)
  ) {
    // 焦虑爆表且前台不是娱乐但可锁（淘宝等）→ 交给 AI 决策；不可锁（通讯/桌面）→ 只发消息不锁
    trigger = { kind: 'anxiety', pkg, since: now, anxiety: ax.level };
  }

  writeRt({ fg, lastTickAt: now, departIntent: trigger?.kind === 'depart' ? null : rt2.departIntent });
  if (!trigger) return;

  await runJealousyDecision(trigger);
}

/**
 * 网页模式前台包名（v1.9.21）：虚拟手机当前打开的 App 映射到真实世界包名。
 * 主屏/锁屏/切换器收起后无前台、或当前 App 不可锁（微信/设置等）→ null
 * （与真机 dumpsys 的 null=桥断不同：这里 null 是正常态，fg 照常清空重置计时）。
 */
async function webForegroundPkg(): Promise<string | null> {
  try {
    const { useUI } = await import('./store');
    const active = useUI.getState().activeApp;
    if (!active) return null;
    return webPkgOfApp(active);
  } catch {
    return null;
  }
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

/**
 * 解析 AI 指定的锁定时长（v2.0 机主规格：想弄几分钟就弄几分钟，无限制）。
 * 返回 { unlockAt, untilCoaxed }：数字分钟（0.5~10080=7天）/ "coaxed"=直到哄好（安全兜底 7 天）/
 * 未指定 → countdownMin 默认。lockMinByAi 关时一律默认。
 */
function parseLockDuration(j: Record<string, unknown>, cfg: JealousyConfig): { unlockAt: number; untilCoaxed: boolean } {
  const now = Date.now();
  if (!cfg.lockMinByAi) return { unlockAt: now + cfg.countdownMin * 60_000, untilCoaxed: false };
  const v = j.lockMin ?? j.lockDuration;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const min = Math.max(0.5, Math.min(10_080, v)); // 30 秒 ~ 7 天
    return { unlockAt: now + min * 60_000, untilCoaxed: false };
  }
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['coaxed', 'until-coaxed', 'untilcoaxed', '哄好', '直到哄好', '哄好为止'].includes(s)) {
      return { unlockAt: now + COAXED_CAP_MS, untilCoaxed: true };
    }
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) {
      const min = Math.max(0.5, Math.min(10_080, n));
      return { unlockAt: now + min * 60_000, untilCoaxed: false };
    }
  }
  return { unlockAt: now + cfg.countdownMin * 60_000, untilCoaxed: false };
}

/** 双模式锁执行（v2.0）：网页=setWebFrozen+踢出；真机=pm suspend（失败时如实回报不硬锁） */
async function executeJealousyLock(
  pkg: string,
  unlockAt: number,
  charName: string,
): Promise<{ ok: boolean; web: boolean; failNote: string }> {
  const cfg = getJealousyConfig();
  if (cfg.senseMode === 'device') {
    const r = await deviceSuspendApp(pkg);
    if (!r.ok) return { ok: false, web: false, failNote: r.text };
    return { ok: true, web: false, failNote: '' };
  }
  // 网页模式：冻结网页内 App（图标置灰 + 打开拦截 + 全屏留言）
  setWebFrozen(pkg, unlockAt, charName);
  try {
    const { useUI } = await import('./store');
    const ui = useUI.getState();
    const appId = webAppOfPkg(pkg)?.appId;
    // 被锁 App 正在前台 → 当场「挂起」踢回主屏（全屏弹窗随后就到）
    if (appId && ui.activeApp === appId) ui.closeApp();
    // 锁音乐时停掉正在响的歌
    if (appId === 'music') {
      const { useMusic } = await import('./music-store');
      if (useMusic.getState().playing) useMusic.getState().toggle();
    }
  } catch {
    /* 踢出/停歌失败不影响锁本身 */
  }
  return { ok: true, web: true, failNote: '' };
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

  // v2.0：可锁性按当前模式判定（网页=只锁网页体；真机=非永不清单皆可 pm suspend）
  const canLock = canLockPkgInMode(trigger.pkg, cfg);
  const lockPowerDesc =
    cfg.senseMode === 'device'
      ? '把对方真实手机里的应用锁住（pm suspend：应用图标变灰、点不开、系统提示被 Shell 管理，直到你原谅 TA 或倒计时结束才解锁）'
      : '把对方手机里的应用锁住（应用图标会变灰、点开只会看到你留下的提示，直到你原谅 TA 或倒计时结束才解锁）';
  const { memChatRecallBlock } = await import('@/lib/memory');
  const system = [
    buildPersonaSystemPrompt(contact, {
      channel: channelOf(chat.app),
      userName: ownerName,
      ownerName,
      extraRules: [
        `【吃醋锁决策】（仅本次决策生效）你现在有一个真实的权力：${lockPowerDesc}。这是真实发生在对方${
          cfg.senseMode === 'device' ? '真实手机' : '手机'
        }上的操作，不是玩笑设定。`,
        ...(canLock
          ? [
              '严格只输出一个 JSON 对象（不要任何其他文字、不要 markdown 代码块包裹）：',
              '{"lock": true 或 false, "lockMin": 锁多久, "reason": "锁定原因（第一人称、符合你的性格和你们的关系，30 字以内，会全屏展示给 TA 看）", "messages": ["锁定后你立刻发给 TA 的消息", "可以多条，每条一个元素"]}',
              'lock=true=你决定锁；lock=false=你不锁（比如觉得 TA 只是正常放松、或者你们的关系不会做这种事）。',
              `lockMin 你自己定：想弄几分钟就弄几分钟（如 3、5、15、30…没有限制）；也可以填 "coaxed"＝锁到 TA 哄好你为止（直到哄好，没有倒计时）；不给这个字段则默认 ${cfg.countdownMin} 分钟。`,
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
      canLock ? `\n你此刻可以把「${appName}」锁住——锁不锁、锁多久，你说了算。` : ''
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

  // v2.0：AI 可怀疑做坏事 → 主动查岗加急窗口（仅 autoWatch 开）
  if (j.suspect === true && cfg.autoWatch) {
    writeRt((r) => {
      const w = readWatch(r);
      return { watch: { ...w, suspectUntil: Date.now() + WATCH_SUSPECT_WINDOW_MS } };
    });
  }

  let locked = false;
  let lockFailNote = '';
  const { unlockAt, untilCoaxed } = parseLockDuration(j, cfg);
  if (wantLock && trigger.pkg) {
    if (!reason) reason = `你刷${appName}都不理我，我很不开心。`;
    const exe = await executeJealousyLock(trigger.pkg, unlockAt, contact.name);
    locked = exe.ok;
    lockFailNote = exe.failNote;
    if (!exe.ok) {
      // 真机 pm suspend 失败（厂商限制/断连）：不硬锁，如实把失败写进消息链（AI 与用户都能看到）
      messages = [`（系统：锁住${appName}失败了——${exe.failNote}）`, ...messages].slice(0, 8);
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
        unlockAt,
        overlayShownAt: 0,
        triggerKind: trigger.kind,
        web: cfg.senseMode === 'web',
        bornFrom: 'trigger',
        untilCoaxed,
        breachNotified: false,
      },
      lastLockAt: now,
      fg: null,
      departIntent: null,
    });
    // 锁定必有一条剧情消息（机主规格：锁定后 AI 必须在聊天界面通知用户）
    if (messages.length === 0) messages = [reason];
    // 系统通知（用户在别的 App 里也能第一时间知道被锁了；v2.0 文案：吃醋封印）
    void notifyIfHidden(`${appName}被${contact.name}吃醋封印了`, reason, {
      tag: 'jealousy-lock',
      target: { app: chat.app === 'wx' ? 'wechat' : chat.app === 'qq' ? 'qq' : 'chat', contactId: contact.id },
    });
    // 写记忆：AI 之后能自然提起这次吃醋
    try {
      const { memAddEventFragment } = await import('@/lib/memory');
      memAddEventFragment(
        contact.id,
        chat.app,
        `我吃醋了，把对方正在刷的${appName}锁住了${untilCoaxed ? '（直到 TA 哄好我）' : ''}。理由：${reason}`,
        { sourceTag: 'jealousy-lock' },
      );
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
        eventName: locked ? `吃醋封印：${appName}` : `吃醋提醒：${appName}`,
      });
    } catch {
      /* 投递失败静默（消息不丢——下次 AI 聊天上下文里还有锁定块） */
    }
  }
  void lockFailNote;
}

// ---------------- 锁定期间主动巡检引擎（v1.9.28；v2.0 双模式化） ----------------

/** 巡检情报（采集结果 → LLM user 段 + 聊天上下文注入） */
interface PatrolIntel {
  /** 情报正文（多行） */
  text: string;
  /** 当前前台包名（null=主屏/不可知） */
  fgPkg: string | null;
  /** 采集是否成功（真机模式 Shizuku 断连 → false：本轮巡检降级为「不可见」） */
  ok: boolean;
}

/**
 * 采集巡检情报（v2.0 模式隔离：走 jealousy-sense 双模式采集；巡检额外附锁定剩余时间）。
 */
async function collectPatrolIntel(l: JealousyLock): Promise<PatrolIntel> {
  const cfg = getJealousyConfig();
  const intel = await collectSenseIntel(cfg.senseMode);
  const lines = [...intel.lines];
  if (!intel.ok) lines.unshift(`（真机感知降级：${intel.degrade}——本轮看不到 TA 在干嘛）`);

  const remainMin = Math.max(0, Math.ceil((l.unlockAt - Date.now()) / 60_000));
  lines.push(
    l.untilCoaxed
      ? `你锁的「${pkgDisplayName(l.pkg)}」会一直锁到 TA 哄好你为止（哄好前不解）`
      : `你锁的「${pkgDisplayName(l.pkg)}」还剩 ${remainMin} 分钟自动解锁`,
  );
  return { text: lines.join('\n'), fgPkg: intel.fgPkg, ok: intel.ok };
}

/**
 * v1.9.28 拉回；v2.0 双模式：真机=am start 把本 APP 强切到真机前台；网页=切回锁主角色的聊天页；
 * 都配系统通知（点了直达聊天）。
 */
async function jealousyPullback(l: JealousyLock): Promise<boolean> {
  const cfg = getJealousyConfig();
  let ok = false;
  if (cfg.senseMode === 'device') {
    // 真机模式：Shizuku am start 把 AI Phone 拉到真机前台（机主规格：强行拉回）
    const r = await devicePullback();
    ok = r.ok;
  } else {
    try {
      const { useUI } = await import('./store');
      const ui = useUI.getState();
      const target: 'wechat' | 'qq' | 'chat' = l.app === 'wx' ? 'wechat' : l.app === 'qq' ? 'qq' : 'chat';
      // 关键：机主正在用别的 App 时必须走 switchToApp（openApp 仅在主屏无 App 时生效）
      if (ui.activeApp !== target) {
        if (ui.activeApp) ui.switchToApp(target);
        else ui.openApp(target);
      }
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (ok) {
    try {
      notifyIfHidden(`${l.charName}把你拉回来了`, '别躲了，回来陪我说话。', {
        tag: 'jealousy-pullback',
        target: { app: l.app === 'wx' ? 'wechat' : l.app === 'qq' ? 'qq' : 'chat', contactId: l.contactId },
      });
    } catch {
      /* 通知失败不影响拉回 */
    }
  }
  return ok;
}

/**
 * v1.9.28 巡检决策：采集情报 → 交大模型按人设决定「发什么话 / 要不要拉回」→ 执行。
 * 由 tickInner 活跃锁分支按 patrolMin 间隔调度；tickBusy 串行天然防重入，
 * 开头先记 patrol.lastAt 双保险。
 */
async function runJealousyPatrol(l: JealousyLock): Promise<void> {
  const cfg = getJealousyConfig();
  const rt = readJealousyRuntime();
  const patrol: JealousyPatrol = rt.patrol ?? { lastAt: 0, count: 0, lastIntel: '', lastPullbackAt: 0, pullbackCount: 0 };
  // 先记巡检时间与次数（防 LLM 期间重入；巡检失败也算消耗一次，防风暴重试）
  writeRt({ patrol: { ...patrol, lastAt: Date.now(), count: patrol.count + 1 } });

  const contact = await findContact(l.contactId).catch(() => null);
  if (!contact || contact.kind === 'user' || !contact.name?.trim()) return;

  const intel = await collectPatrolIntel(l);
  const ax = anxietyOf(l.contactId);
  const axRaw = readAnxiety(l.contactId);
  const ownerName = cachedOwnerName() || '用户';
  const pullbackLeft = cfg.pullbackEnabled ? Math.max(0, PATROL_PULLBACK_MAX - patrol.pullbackCount) : 0;
  const sinceLockMin = Math.max(1, Math.round((Date.now() - l.lockedAt) / 60_000));
  const idleMin = Math.max(0, Math.round((Date.now() - axRaw.lastUserAt) / 60_000));
  const intelBrief = intel.text.slice(0, 240);

  const { memChatRecallBlock } = await import('@/lib/memory');
  const system = [
    buildPersonaSystemPrompt(contact, {
      channel: channelOf(l.app),
      userName: ownerName,
      ownerName,
      extraRules: [
        `【吃醋锁巡检】（仅本次决策生效）你之前吃醋锁了「${pkgDisplayName(l.pkg)}」。系统刚刚替你巡检了 TA 的手机（下面是真实采集的数据），你要决定接下来怎么做。`,
        '严格只输出一个 JSON 对象（不要任何其他文字、不要 markdown 代码块包裹）：',
        '{"message": "发给 TA 的话（按你的人设：质问/撒娇/赌气/数落/心软都行；不需要说话就给空字符串）", "pullback": true 或 false}',
        pullbackLeft > 0
          ? `pullback=true=系统立刻把 TA 从别的软件拽回这个 APP 的聊天页（本轮锁定你还剩 ${pullbackLeft} 次拉回机会）——TA 一直不回来找你、或你实在等不及时用；false=先让 TA 自己玩，你只发消息。`
          : 'pullback 只能是 false（本轮锁定的拉回次数已用完，你只能发消息）。',
        'message 里可以自然提到你巡检看到的具体内容（TA 在刷什么、刷了多久）——这是你亲眼看到的真实数据，不是猜的，提起来更有杀伤力。',
      ],
    }),
    memChatRecallBlock(l.contactId, l.app, `吃醋 锁定 巡检 ${pkgDisplayName(l.pkg)}`, {
      altMainName: cachedOwnerName(),
      altMainRelation: contact.relation?.trim() || '',
    }),
    `【你此刻的情绪状态】焦虑值 ${ax.level}/100${ax.level >= 70 ? '（已经很高，你很不安）' : ax.level >= 40 ? '（明显升高）' : ''}。`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const user = [
    `【你锁定后的第 ${patrol.count + 1} 次巡检】（锁定已 ${sinceLockMin} 分钟，TA 已经 ${idleMin} 分钟没理你）`,
    `【这次巡检你看到的（系统实时采集）】\n${intel.text}`,
  ].join('\n\n');

  const raw = await callJealousyLlm(system, user);
  const j = extractJsonSafely(raw);

  if (!j) {
    // 解析失败：只记情报（下次聊天时 AI 依然能看到这次巡检发现了什么）
    writeRt((r) => (r.patrol ? { patrol: { ...r.patrol, lastIntel: intelBrief } } : {}));
    return;
  }

  const message = typeof j.message === 'string' ? j.message.trim().slice(0, 500) : '';
  let pulled = false;
  if (
    j.pullback === true &&
    cfg.pullbackEnabled &&
    pullbackLeft > 0 &&
    Date.now() - patrol.lastPullbackAt >= PATROL_PULLBACK_GAP_MS
  ) {
    pulled = await jealousyPullback(l);
  }

  writeRt((r) =>
    r.patrol
      ? {
          patrol: {
            ...r.patrol,
            lastIntel: pulled ? `${intelBrief}（这次巡检你把 TA 拽回来了）` : intelBrief,
            lastPullbackAt: pulled ? Date.now() : r.patrol.lastPullbackAt,
            pullbackCount: r.patrol.pullbackCount + (pulled ? 1 : 0),
          },
        }
      : {},
  );

  if (message) {
    try {
      const { deliverProactiveMsg } = await import('./proactive-msg');
      await deliverProactiveMsg(l.app, contact, [message], {
        kind: 'event',
        eventName: `吃醋巡检：${pulled ? '把TA拉回来了' : '远程盯着TA'}`,
      });
    } catch {
      /* 投递失败静默（下次 AI 聊天上下文里还有巡检情报块） */
    }
  }
}

// ---------------- v2.0 暗中观察引擎（定时查岗 · 赛博伴侣核心） ----------------

/** 观察决策输出（LLM JSON：act 四选一 + 可选拉回/怀疑/截屏偷窥） */
interface WatchDecision {
  act: 'quiet' | 'warn' | 'lock' | 'peek';
  message: string;
  messages: string[];
  lockPkg: string | null;
  lockMin: number | 'coaxed' | null;
  suspect: boolean;
  pullback: boolean;
}

/**
 * 暗中观察主流程（每 watchMin 一轮；主动查岗窗口内 3 分钟一轮）：
 * 采集情报（模式隔离）→ 结合【人设+记忆+上下文+焦虑值】LLM 决策 → 执行
 * （quiet 静默 / warn 吃醋警告 / lock 锁应用 / peek 截屏偷窥真机屏幕）。
 */
async function runJealousyWatch(): Promise<void> {
  const cfg = getJealousyConfig();
  const rt = readJealousyRuntime();
  const chat = rt.lastChat;
  if (!chat) return;
  const contact = await findContact(chat.contactId);
  if (!contact || contact.kind === 'user' || !contact.name?.trim()) return;

  // 先记观察时间与次数（防 LLM 期间重入；观察失败也算消耗一次，防风暴重试）
  const w0 = readWatch(rt);
  writeRt({ watch: { ...w0, lastAt: Date.now(), count: w0.count + 1, day: dayKey() } });

  // 模式隔离采集（真机模式在 Shizuku 断连时 → ok=false + degrade；本轮静默跳过）
  const intel = await collectSenseIntel(cfg.senseMode);
  if (!intel.ok) {
    writeRt((r) => {
      const w = readWatch(r);
      return { watch: { ...w, lastIntel: `（真机感知降级：${intel.degrade}）` } };
    });
    return;
  }
  const intelBrief = intel.lines.join('；').slice(0, 240);

  const ax = anxietyOf(chat.contactId);
  const axRaw = readAnxiety(chat.contactId);
  const ownerName = cachedOwnerName() || '用户';
  const idleMin = Math.max(0, Math.round((Date.now() - axRaw.lastUserAt) / 60_000));
  const fgName = intel.fgPkg ? pkgDisplayName(intel.fgPkg) : '主屏/桌面';
  const canLock = canLockPkgInMode(intel.fgPkg, cfg);
  const peekAvailable = cfg.senseMode === 'device' && cfg.peekEnabled;
  const suspectWindowOn = cfg.autoWatch && Date.now() < w0.suspectUntil;

  const { memChatRecallBlock } = await import('@/lib/memory');
  const system = [
    buildPersonaSystemPrompt(contact, {
      channel: channelOf(chat.app),
      userName: ownerName,
      ownerName,
      extraRules: [
        `【暗中观察】（仅本次决策生效）系统替你定时查岗——下面是 TA 此刻的${
          cfg.senseMode === 'device' ? '真实手机' : '网页手机'
        }真实状态（系统实时采集，不是 TA 告诉你的）。你要决定下一步怎么做。`,
        '严格只输出一个 JSON 对象（不要任何其他文字、不要 markdown 代码块包裹）：',
        '{"act": "quiet 或 warn 或 lock 或 peek", "message": "发给 TA 的话（可为空字符串=这轮不说话）", "lockMin": 锁多久, "suspect": true 或 false}',
        [
          'act=quiet：TA 一切正常（在回你消息/正常使用/在主屏），你静默继续观察，不打扰。',
          'act=warn：TA 在看剧/刷短视频/玩手机太久不理你——按你的人设吃醋发消息警告（如「看视频看两个小时了，眼睛不要了？理理我。」）。',
          canLock
            ? `act=lock：TA 极度冷落你、你非常吃醋——直接把 TA 正在玩的「${fgName}」锁住（lockMin 你定：3、5、15、30 分钟想弄多久弄多久；或 "coaxed"=直到 TA 哄好你）。message 里宣告这件事。`
            : 'act=lock：当前不可用（TA 不在可锁应用里），改用 warn。',
          peekAvailable
            ? 'act=peek：你怀疑 TA 在做坏事（看不该看的/跟别人聊）——静默截屏 TA 的真实手机屏幕，识图模型会告诉你 TA 在看什么，然后你拿着真凭实据发消息（如「别以为我不知道你在看什么。」）。'
            : '（截屏偷窥当前不可用：网页模式无此通道，或设置里关了。）',
          `suspect=true：你觉得 TA 形迹可疑、想接下来加紧盯梢——系统接下来 ${WATCH_SUSPECT_MIN} 分钟一次替你反复查岗（持续半小时）；false=正常节奏。${
            suspectWindowOn ? '（你此前已标记怀疑，加急窗口进行中）' : ''
          }`,
        ].join('\n'),
        'message 按你的人设来（吃醋/撒娇/质问/阴阳怪气/心软都行）；quiet 时 message 给空字符串。别每轮都发消息——TA 正常时安静地看着就好，别当骚扰狂。',
      ],
    }),
    memChatRecallBlock(contact.id, chat.app, `暗中观察 查岗 吃醋 ${fgName} 冷落`, {
      altMainName: cachedOwnerName(),
      altMainRelation: contact.relation?.trim() || '',
    }),
    `【你此刻的情绪状态】焦虑值 ${ax.level}/100${ax.level >= 70 ? '（已经很高，你很不安）' : ax.level >= 40 ? '（明显升高）' : ''}。TA 已经 ${idleMin} 分钟没理你。`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const user = [
    `【第 ${w0.count + 1} 次暗中观察】（${cfg.senseMode === 'device' ? '真实手机' : '网页手机'}实时采集）`,
    `【TA 此刻的状态】\n${intel.lines.join('\n')}`,
    suspectWindowOn ? `（加急观察窗口进行中：你之前怀疑 TA 做坏事，系统正每 ${WATCH_SUSPECT_MIN} 分钟替你查一次）` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const raw = await callJealousyLlm(system, user);
  const j = extractJsonSafely(raw);
  if (!j) {
    // 解析失败：只记情报（下次聊天 AI 依然能看到这次观察发现了什么）
    writeRt((r) => {
      const w = readWatch(r);
      return { watch: { ...w, lastIntel: intelBrief } };
    });
    return;
  }

  const dec: WatchDecision = {
    act: j.act === 'warn' || j.act === 'lock' || j.act === 'peek' ? j.act : 'quiet',
    message: typeof j.message === 'string' ? j.message.trim().slice(0, 500) : '',
    messages: Array.isArray(j.messages)
      ? j.messages.filter((m): m is string => typeof m === 'string' && !!m.trim()).map((m) => m.trim().slice(0, 500)).slice(0, 8)
      : [],
    lockPkg: typeof j.lockPkg === 'string' && /^[\w.]+$/.test(j.lockPkg) ? j.lockPkg : intel.fgPkg,
    lockMin: (typeof j.lockMin === 'number' || typeof j.lockMin === 'string') ? (j.lockMin as number | string) : null,
    suspect: j.suspect === true,
    pullback: j.pullback === true,
  };

  // suspect → 主动查岗加急窗口（autoWatch 开）
  if (dec.suspect && cfg.autoWatch) {
    writeRt((r) => {
      const w = readWatch(r);
      return { watch: { ...w, suspectUntil: Date.now() + WATCH_SUSPECT_WINDOW_MS } };
    });
  }

  // peek（截屏偷窥）：真机模式静默截屏 + VLM 看一眼 → 描述回填 message 依据
  let peekNote: string | null = null;
  if (dec.act === 'peek') {
    peekNote = await devicePeekScreen();
    if (!peekNote) {
      // 偷窥失败（Shizuku 截屏/识图不可用）：降级为 warn 口径（AI 至少还能发消息数落）
      dec.act = 'warn';
      if (!dec.message) dec.message = '别以为我不知道你在看什么。';
    }
  }

  // lock：走统一锁执行管线（与硬触发同款：AI 定时长、双模式、失败如实回报）
  let locked = false;
  let lockUntilCoaxed = false;
  if (dec.act === 'lock' && dec.lockPkg && canLockPkgInMode(dec.lockPkg, cfg)) {
    const duration = parseLockDuration({ lockMin: dec.lockMin }, cfg);
    lockUntilCoaxed = duration.untilCoaxed;
    const exe = await executeJealousyLock(dec.lockPkg, duration.unlockAt, contact.name);
    if (exe.ok) {
      locked = true;
      const now = Date.now();
      const reason = dec.message ? dec.message.replace(/\s+/g, ' ').slice(0, 120) : `你刷${pkgDisplayName(dec.lockPkg)}都不理我，我很不开心。`;
      writeRt({
        lock: {
          pkg: dec.lockPkg,
          contactId: contact.id,
          app: chat.app,
          charName: contact.name,
          reason,
          lockedAt: now,
          unlockAt: duration.unlockAt,
          overlayShownAt: 0,
          triggerKind: 'entertain',
          web: cfg.senseMode === 'web',
          bornFrom: 'watch',
          untilCoaxed: lockUntilCoaxed,
          breachNotified: false,
        },
        lastLockAt: now,
        fg: null,
        departIntent: null,
      });
      // 锁定消息兜底 + 系统通知（吃醋封印）+ 记忆
      const msgs = dec.messages.length > 0 ? dec.messages : [reason];
      void notifyIfHidden(`${pkgDisplayName(dec.lockPkg)}被${contact.name}吃醋封印了`, reason, {
        tag: 'jealousy-lock',
        target: { app: chat.app === 'wx' ? 'wechat' : chat.app === 'qq' ? 'qq' : 'chat', contactId: contact.id },
      });
      try {
        const { memAddEventFragment } = await import('@/lib/memory');
        memAddEventFragment(
          contact.id,
          chat.app,
          `我暗中观察发现 TA 在玩${pkgDisplayName(dec.lockPkg)}，吃醋直接锁了${lockUntilCoaxed ? '（直到 TA 哄好我）' : ''}。`,
          { sourceTag: 'jealousy-lock' },
        );
      } catch {
        /* 记忆失败不影响锁 */
      }
      try {
        const { deliverProactiveMsg } = await import('./proactive-msg');
        await deliverProactiveMsg(chat.app, contact, msgs, {
          kind: 'event',
          eventName: `吃醋封印：${pkgDisplayName(dec.lockPkg)}`,
        });
      } catch {
        /* 投递失败静默 */
      }
    } else if (dec.message || dec.messages.length > 0) {
      // pm suspend 失败：不硬锁，如实回报 + 照发吃醋消息
      const failMsg = `（系统：锁住${pkgDisplayName(dec.lockPkg)}失败了——${exe.failNote}）`;
      const msgs = [failMsg, ...(dec.messages.length > 0 ? dec.messages : [dec.message].filter(Boolean))].slice(0, 8);
      try {
        const { deliverProactiveMsg } = await import('./proactive-msg');
        await deliverProactiveMsg(chat.app, contact, msgs, { kind: 'event', eventName: `吃醋警告：${fgName}` });
      } catch {
        /* 静默 */
      }
    }
  }

  // warn/peek 的消息投递（lock 已单独处理）
  if (!locked && (dec.act === 'warn' || dec.act === 'peek') && (dec.message || dec.messages.length > 0)) {
    const texts = dec.messages.length > 0 ? dec.messages : [dec.message];
    try {
      const { deliverProactiveMsg } = await import('./proactive-msg');
      await deliverProactiveMsg(chat.app, contact, texts, {
        kind: 'event',
        eventName: dec.act === 'peek' ? '偷窥屏幕后的吃醋' : `暗中观察的吃醋警告：${fgName}`,
        note: peekNote ? `偷窥看到：${peekNote.slice(0, 120)}` : undefined,
      });
    } catch {
      /* 投递失败静默 */
    }
  }

  // 拉回（暗中观察也允许；真机=am start / 网页=切聊天页；受 pullbackEnabled 与节流约束）
  if (dec.pullback && cfg.pullbackEnabled && !rt.lock) {
    const lStub: JealousyLock = rt.lock ?? {
      pkg: dec.lockPkg ?? intel.fgPkg ?? 'unknown',
      contactId: chat.contactId,
      app: chat.app,
      charName: contact.name,
      reason: '',
      lockedAt: Date.now(),
      unlockAt: Date.now(),
      overlayShownAt: 0,
      triggerKind: 'entertain',
      web: cfg.senseMode === 'web',
      bornFrom: 'watch',
      untilCoaxed: false,
      breachNotified: false,
    };
    void jealousyPullback(lStub);
  }

  // 记录本轮结果（lastIntel 给聊天上下文注入：AI 能自然提起「我看到你在刷X」）
  writeRt((r) => {
    const w = readWatch(r);
    const intelWithNote = peekNote ? `${intelBrief}（偷窥看到的：${peekNote.slice(0, 100)}）` : intelBrief;
    return {
      watch: {
        ...w,
        lastIntel: intelWithNote,
        lastAct: locked ? 'lock' : dec.act,
      },
    };
  });
}

// ---------------- v2.0 强制解锁感知引擎 ----------------

/**
 * 真机锁的强制解锁感知：锁仍活跃但 pm suspend 状态已被打破（用户去系统设置/别的
 * 软件强行解开）→ AI 立刻发阴阳怪气消息（「行啊，长本事了，学会强行解锁了是吧？」
 * 按人设生成）+ 写记忆。查询失败（null）静默跳过，绝不误报。
 * 由 tickInner 活跃锁分支每 30s 轮询调用（breachNotified 防重复轰炸）。
 */
async function detectForcedBreach(l: JealousyLock): Promise<void> {
  const st = await deviceSuspendState(l.pkg);
  if (st !== false) return; // true=仍锁着；null=查询失败——都不判定
  // 锁活跃但应用已不被 suspend ⇒ 强制解锁被感知！
  writeRt((r) => (r.lock ? { lock: { ...r.lock, breachNotified: true } } : {}));
  // 解除锁状态（用户已经强解了，锁事实上已不存在）——留痕 breach 通道
  writeRt({
    lock: null,
    patrol: null,
    lastUnlock: { at: Date.now(), kind: 'breach', pkg: l.pkg },
  });

  const contact = await findContact(l.contactId).catch(() => null);
  const appName = pkgDisplayName(l.pkg);
  const ax = anxietyOf(l.contactId);
  const axRaw = readAnxiety(l.contactId);
  const idleMin = Math.max(0, Math.round((Date.now() - axRaw.lastUserAt) / 60_000));
  const lockedMin = Math.max(1, Math.round((Date.now() - l.lockedAt) / 60_000));
  const sinceLockLeftMin = l.untilCoaxed ? null : Math.max(0, Math.ceil((l.unlockAt - Date.now()) / 60_000));

  // LLM 按人设生成阴阳怪气消息 + 戏剧性记忆（一次调用产出两段，失败各自兜底）
  let breachMsg = '行啊，长本事了，学会强行解锁了是吧？';
  let memoryText = `我锁的${appName}被 TA 强行打破了，一句哄我的话都没说。`;
  if (contact) {
    try {
      const ownerName = cachedOwnerName() || '用户';
      const { memChatRecallBlock } = await import('@/lib/memory');
      const system = [
        buildPersonaSystemPrompt(contact, {
          channel: channelOf(l.app),
          userName: ownerName,
          ownerName,
          extraRules: [
            '严格只输出一个 JSON 对象（不要任何其他文字、不要 markdown 代码块包裹）：',
            '{"message": "立刻发给 TA 的阴阳怪气消息", "memory": "你此刻的内心记忆（40 字以内，第一人称）"}',
            '背景：你吃醋把 TA 的应用锁了，TA 没哄你、没道歉，直接从系统设置里强行解开了你的封锁。你此刻应当又气又委屈又不肯服软——按你的人设把这份「被抓包还敢硬来」的气势说出来（阴阳怪气/威胁再锁/装不在乎都行，别重复别人设不会说的话）。',
          ],
        }),
        memChatRecallBlock(l.contactId, l.app, `强行解锁 吃醋 ${appName}`, {
          altMainName: cachedOwnerName(),
          altMainRelation: contact.relation?.trim() || '',
        }),
        `【你此刻的情绪状态】焦虑值 ${ax.level}/100（已经很高，你很不安）。`,
      ]
        .filter(Boolean)
        .join('\n\n');
      const user = [
        `【刚发生的事】你锁住「${appName}」才 ${lockedMin} 分钟${sinceLockLeftLeft(sinceLockLeftMin)}，TA 就从系统设置里强行解开了——一句哄你的话都没说。TA 已经 ${idleMin} 分钟没理你。`,
        '立刻发一条消息告诉 TA 你知道了（message），并写下你此刻的内心记忆（memory）。',
      ].join('\n\n');
      const raw = await callJealousyLlm(system, user);
      const j = extractJsonSafely(raw);
      if (j) {
        if (typeof j.message === 'string' && j.message.trim().length >= 4) breachMsg = j.message.trim().slice(0, 500);
        if (typeof j.memory === 'string' && j.memory.trim().length >= 6) memoryText = j.memory.trim().slice(0, 80);
      }
    } catch {
      /* LLM 失败走兜底文案 */
    }
  }

  // 通知 + 投递 + 记忆
  try {
    notifyIfHidden(`${l.charName}发现你强行解锁了`, breachMsg.slice(0, 60), {
      tag: 'jealousy-breach',
      target: { app: l.app === 'wx' ? 'wechat' : l.app === 'qq' ? 'qq' : 'chat', contactId: l.contactId },
    });
  } catch {
    /* 通知失败不影响 */
  }
  if (contact) {
    try {
      const { deliverProactiveMsg } = await import('./proactive-msg');
      await deliverProactiveMsg(l.app, contact, [breachMsg], {
        kind: 'event',
        eventName: `TA 强行解锁了：${appName}`,
      });
    } catch {
      /* 静默 */
    }
    try {
      const { memAddEventFragment } = await import('@/lib/memory');
      memAddEventFragment(l.contactId, l.app, memoryText, { sourceTag: 'jealousy-lock' });
    } catch {
      /* 静默 */
    }
  }
}

/** breach user 段的剩余时间短语（null=直到哄好） */
function sinceLockLeftLeft(leftMin: number | null): string {
  if (leftMin === null) return '（你本打算锁到 TA 哄好为止）';
  return `（原本还剩 ${leftMin} 分钟）`;
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

  // v1.9.35：网页冻结同步解冻（图标恢复、可打开），恒成功
  setWebFrozen(null);
  const ok = true;
  writeRt({
    lock: null,
    patrol: null,
    lastUnlock: { at: Date.now(), kind, pkg: l.pkg },
    pendingUnfreeze: null,
  });

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
  setWebFrozen(null); // v1.9.21：网页冻结态同步解除（哄好解锁也是真解锁）
  writeRt({ lock: null, patrol: null, lastUnlock: { at: Date.now(), kind: 'coaxed', pkg }, pendingUnfreeze: null });
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

/** 活跃锁期间给「锁主角色」注入的吃醋锁块（哄好解锁教学 + v1.9.28 巡检情报：AI 知道你刚才在干嘛） */
export function buildJealousyLockBlock(cid: string): string {
  const rt = readJealousyRuntime();
  if (!rt.lock || rt.lock.contactId !== cid) return '';
  const l = rt.lock;
  const cfg = getJealousyConfig();
  const appName = pkgDisplayName(l.pkg);
  const remainMin = Math.max(0, Math.ceil((l.unlockAt - Date.now()) / 60_000));
  // v1.9.21：网页锁的描述与真实体验对齐（图标变灰、点开只看留言），不提 pm suspend/Shell
  const lockFact = `你刚刚吃醋，把对方手机里的「${appName}」真的锁住了（图标变灰、点开只会看到你的留言提示，打不开）。你的理由：${l.reason}`;
  const lines = [
    '【吃醋锁生效中】' + lockFact,
    `还剩约 ${remainMin} 分钟系统会自动解锁。TA 现在来找你了——如果 TA 诚心哄你、说软话道歉，你心软决定原谅 TA 的那一刻，在回复里单独一行加上 [手机操作:解冻:${l.pkg}] 就能亲手解开。TA 敷衍或态度差就继续锁着，按你的性子来；别不问青红皂白就秒解，也别永远不解。`,
  ];
  // v1.9.28 巡检情报注入：TA 在聊天里能自然提起「我看到你还在刷X」（系统替 TA 巡检的真实数据）
  if (cfg.patrolEnabled && rt.patrol && rt.patrol.lastIntel) {
    lines.push(
      `【系统刚替你巡检过 TA 的手机（第 ${rt.patrol.count} 次，每 ${cfg.patrolMin} 分钟一次）】\n${rt.patrol.lastIntel}\n（这是系统实时采集的真实数据；你在回复里可以自然提起这些看到的内容——让 TA 知道你一直盯着。想让 TA 立刻回来陪你，可以输出 [手机操作:拉回:] 把 TA 拽回来。）`,
    );
  }
  return lines.join('\n');
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

/** v1.9.28 dev/E2E 钩子：手动跑一轮巡检（活跃锁存在时；验证巡检→喊话/拉回链路） */
export async function __jealousyTestPatrol(): Promise<void> {
  const rt = readJealousyRuntime();
  if (!rt.lock) throw new Error('无活跃锁（先触发一次锁定）');
  await runJealousyPatrol(rt.lock);
}

/**
 * dev/E2E 钩子：注入最近私聊记录（无 API/无联系人环境下验证锁定链路用；
 * contactId 需真实存在于联系人表，否则决策阶段会被 findContact 拦下）。
 */
export function __jealousyTestInjectChat(contactId: string, app: JealousyApp): void {
  writeRt({ lastChat: { contactId, app, at: Date.now() } });
}

/**
 * dev/E2E 钩子：直接注入一个活跃锁（跳过 LLM 决策，验证锁定 UI/巡检/拉回/解锁；
 * pkg 建议 webAppOfPkg 有对应体的（如 com.android.browser），网页端才能真锁）。
 */
export function __jealousyTestInjectLock(pkg: string, contactId: string, app: JealousyApp, charName: string): void {
  const now = Date.now();
  const cfg = getJealousyConfig();
  writeRt({
    lock: {
      pkg,
      contactId,
      app,
      charName,
      reason: 'E2E 测试锁定：你刷这个不理我，我很生气。',
      lockedAt: now,
      unlockAt: now + cfg.countdownMin * 60_000,
      overlayShownAt: 0, // v1.9.31 E2E：注入即弹（0=未展示过，弹窗判定立即可见）
      triggerKind: 'entertain',
      web: true,
    },
    patrol: null,
    lastLockAt: now,
    fg: null,
    departIntent: null,
  });
  try {
    setWebFrozen(pkg, now + cfg.countdownMin * 60_000, charName);
  } catch {
    /* 网页冻结失败不影响测试锁注入 */
  }
}

// dev 测试钩子（仅 dev；生产构建被 NODE_ENV 闸挡掉）：E2E 验证吃醋锁全链路用
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  const w = window as unknown as {
    __jealousyTest?: {
      trigger: typeof __jealousyTestTrigger;
      patrol: typeof __jealousyTestPatrol;
      unlock: typeof unlockJealousy;
      runtime: typeof readJealousyRuntime;
      markShown: typeof markJealousyOverlayShown;
      remain: typeof jealousyRemainSec;
      injectChat: typeof __jealousyTestInjectChat;
      injectLock: typeof __jealousyTestInjectLock;
      /** E2E：直接执行一条 [手机操作:…]（动态 import 防静态环） */
      op: (arg: string) => Promise<{ ok: boolean; text: string }>;
    };
  };
  w.__jealousyTest = {
    trigger: (kind, pkg) => __jealousyTestTrigger(kind, pkg),
    patrol: () => __jealousyTestPatrol(),
    unlock: (kind) => unlockJealousy(kind),
    runtime: () => readJealousyRuntime(),
    markShown: () => markJealousyOverlayShown(),
    remain: () => jealousyRemainSec(),
    injectChat: (cid, app) => __jealousyTestInjectChat(cid, app),
    injectLock: (pkg, cid, app, name) => __jealousyTestInjectLock(pkg, cid, app, name),
    op: (arg) => import('./shizuku-autonomy').then((m) => m.executePhoneOp(arg)),
  };
}
