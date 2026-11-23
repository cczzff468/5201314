'use client';

/**
 * 吃醋/查岗·双模式感知层（v2.0「赛博伴侣」重构核心；v2.0.0 去 Shizuku 化）。
 *
 * 模式隔离铁律（机主规格）：
 * - 网页模式（senseMode='web'）：严格只读**网页内部**状态——虚拟手机当前 App、
 *   停留时长、今日使用账本（web-usage-ledger）。绝不触碰任何真机桥。
 * - 真机模式（senseMode='device'）：严格只读**真实手机**状态（经原生系统 API +
 *   无障碍服务）——前台应用包名（无障碍事件流/UsageStats）、当前应用使用时长、
 *   今日亮屏时长（UsageStats 快照）、无障碍静默截屏（可选，识图模型看一眼）。
 *   绝不读网页虚拟状态。两条通道物理隔离，杜绝跨模式数据错乱。
 *
 * 真机能力底座（v2.0.0 全部原生，Shizuku 通道退役）：
 * - 前台包名 → AiAccessibilityService 事件流（实时）/ UsageStats 近 20s 兜底
 * - 锁应用/解锁 → LockOverlayService（UsageStats 3s 轮询 + 悬浮窗全屏遮罩）
 * - 强行拉回 → bringToFront（FLAG_ACTIVITY_NEW_TASK）
 * - 静默截屏 → AiAccessibilityService.takeScreenshot（API 30+，免授权弹窗）
 *
 * v2.1「全视之眼」升级：感知维度从「前台+时长」扩到七维（通知/剪贴板/充电屏幕/移动/
 * 正在播放/通话/键盘；真机侧 v2.0.0 起原生可用维度见 jealousy-sense-extra）。
 *
 * 容错（多品牌兜底）：所有真机调用失败（无障碍未开启/使用情况未授权/悬浮窗权限
 * 缺失/旧 APK）都返回结构化降级原因（degrade），上层据此静默跳过本轮或改发消息，
 * 绝不把异常炸进决策链。
 */

import type { SenseMode } from './jealousy-sense-types';
import { collectWebExtraLines, collectDeviceExtraLines, type SenseObserver } from './jealousy-sense-extra';

export type { SenseMode };
export type { SenseObserver };

// ---------------- 情报结构 ----------------

export interface SenseIntel {
  /** 采集是否成功（真机模式原生全链路失败 → false，上层静默跳过本轮） */
  ok: boolean;
  /** 本次采集所用模式（回显进决策上下文，防跨模式串数据） */
  mode: SenseMode;
  /** 情报行（直接拼 LLM user 段；一行一条事实） */
  lines: string[];
  /** 当前前台包名（网页模式=虚拟手机映射包名；主屏/不可知=null） */
  fgPkg: string | null;
  /** 当前应用已停留毫秒（0=不可知） */
  stayMs: number;
  /** 今日总亮屏/前台毫秒（网页=虚拟账本合计；真机=UsageStats 今日合计） */
  todayTotalMs: number;
  /** 截屏偷窥结果（peek=true 且成功时的 VLM 屏幕描述） */
  peekNote: string | null;
  /** 截屏偷窥原图（peek=true 且无障碍截屏成功时的 dataURL；可发进聊天质问用户） */
  peekImage: string | null;
  /** 降级原因（原生通道各失败形态的人话；ok=true 时为 null） */
  degrade: string | null;
}

/** 毫秒 → 「X 分钟」/「X 小时 Y 分钟」人话 */
export function fmtMs(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return '不到 1 分钟';
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

// ---------------- 网页模式采集（绝不触碰真机桥） ----------------

/** 网页虚拟使用账本的「当前段」起点（停留时长数据源） */
function webLedgerCurrent(): { app: string | null; since: number } {
  try {
    const raw = window.localStorage.getItem('web-usage-ledger-v1');
    if (!raw) return { app: null, since: 0 };
    const p = JSON.parse(raw) as { day?: string; lastApp?: string | null; lastAt?: number };
    const today = new Date();
    const dayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (p.day !== dayKey || typeof p.lastAt !== 'number') return { app: null, since: 0 };
    return { app: typeof p.lastApp === 'string' ? p.lastApp : null, since: p.lastAt };
  } catch {
    return { app: null, since: 0 };
  }
}

/** 网页模式情报采集：虚拟手机当前 App + 停留时长 + 今日使用账本 + 全视之眼七维（v2.1） */
async function collectWebIntel(observer: SenseObserver | null): Promise<SenseIntel> {
  const lines: string[] = [];
  let fgPkg: string | null = null;
  let stayMs = 0;
  let todayTotalMs = 0;

  try {
    const { useUI } = await import('./store');
    const ui = useUI.getState();
    const active = ui.activeApp;
    if (active) {
      const { webPkgOfApp } = await import('./web-app-lock');
      const { webAppName } = await import('./web-usage-ledger');
      fgPkg = webPkgOfApp(active);
      lines.push(`TA 此刻在网页手机的「${webAppName(active)}」应用里${fgPkg ? `（${fgPkg}）` : ''}`);
      // 停留时长：账本当前段（lastApp 与 active 一致才可信）
      const cur = webLedgerCurrent();
      if (cur.app === active && cur.since > 0) {
        stayMs = Date.now() - cur.since;
        lines.push(`已经停留 ${fmtMs(stayMs)}`);
      }
    } else {
      lines.push('TA 此刻在主屏（没开任何应用）');
    }
    if (ui.recentApps?.length) {
      const { webAppName } = await import('./web-usage-ledger');
      lines.push(`【最近用过】${ui.recentApps.map((a) => webAppName(a)).join('、')}`);
    }
  } catch {
    lines.push('（虚拟手机状态读取失败）');
  }

  try {
    const { webUsageToday } = await import('./web-usage-ledger');
    const today = webUsageToday();
    todayTotalMs = today.reduce((s, t) => s + t.ms, 0);
    if (today.length > 0) {
      lines.push(`【今日网页使用时长】总计 ${fmtMs(todayTotalMs)}：${today
        .slice(0, 5)
        .map((t) => `${t.name} ${fmtMs(t.ms)}`)
        .join('、')}`);
    }
  } catch {
    /* 账本降级跳过 */
  }

  // v2.1 全视之眼七维：通知栏（自我过滤）/剪贴板/屏幕电源/移动/正在播放/通话/键盘
  // 每维独立降级：缺一维少一行，绝不炸整轮采集
  try {
    lines.push(...(await collectWebExtraLines(observer)));
  } catch {
    /* 扩展感知降级跳过 */
  }

  return { ok: true, mode: 'web', lines, fgPkg, stayMs, todayTotalMs, peekNote: null, peekImage: null, degrade: null };
}

// ---------------- 真机模式采集（绝不读网页虚拟状态） ----------------

/** 真机前台包名（无障碍事件流优先/UsageStats 兜底；失败 null） */
async function deviceForegroundPkg(): Promise<string | null> {
  try {
    const { nativeGetForegroundApp } = await import('./native-perception');
    const r = await nativeGetForegroundApp();
    if (r && r.ok && r.app) return r.app;
    return null;
  } catch {
    return null;
  }
}

/** 原生通道失败 reason → 人话降级文案（设置页/决策上下文共用） */
export function nativeDegradeText(reason: string | undefined | null): string {
  switch (reason ?? '') {
    case 'not-native':
      return '当前在浏览器里（真机查岗需要 APK 打开 + 开启对应系统权限）';
    case 'no-permission':
      return '缺少「使用情况访问」或「无障碍服务」权限（设置 › 权限给予 里开启）';
    case 'no-a11y':
      return '无障碍服务未开启（设置 › 权限给予 › 无障碍服务）';
    case 'no-overlay-permission':
      return '悬浮窗权限未开启（设置 › 权限给予 › 悬浮窗权限，锁定拦截需要）';
    case 'not-supported':
      return '此功能需要 Android 11（API 30）及以上';
    case 'old-apk':
      return 'APP 版本过旧（设置 › APP 更新 升级到 v2.0.0+）';
    default:
      return reason ? `原生通道异常：${reason}` : '原生通道异常';
  }
}

/** Shizuku 时代旧名兼容（内部已改原生通道；防外部 import 断裂） */
export const shizukuDegradeText = nativeDegradeText;

/** 真机模式情报采集：前台包名 + 当前应用时长 + 今日亮屏 + （可选）无障碍截屏偷窥 + 全视之眼（v2.1） */
async function collectDeviceIntel(peek: boolean): Promise<SenseIntel> {
  const lines: string[] = [];
  let fgPkg: string | null = null;
  let stayMs = 0;
  let todayTotalMs = 0;
  let peekNote: string | null = null;
  let peekImage: string | null = null;

  if (!isNativeEnv()) {
    return { ok: false, mode: 'device', lines: [], fgPkg: null, stayMs: 0, todayTotalMs: 0, peekNote: null, peekImage: null, degrade: nativeDegradeText('not-native') };
  }

  // 前台包名（无障碍事件流/UsageStats）
  fgPkg = await deviceForegroundPkg();
  if (!fgPkg) {
    // 查不到前台：大概率「使用情况」与「无障碍」都没开
    return { ok: false, mode: 'device', lines: [], fgPkg: null, stayMs: 0, todayTotalMs: 0, peekNote: null, peekImage: null, degrade: nativeDegradeText('no-permission') };
  }
  lines.push(`TA 的真实手机此刻前台应用：${fgPkg}`);

  // 当前应用使用时长 + 今日总亮屏（UsageStats 快照；失败只降级该行）
  try {
    const { nativeUsageSnapshot } = await import('./native-perception');
    const snap = await nativeUsageSnapshot();
    if (snap?.current && snap.current.app === fgPkg) {
      stayMs = snap.current.ongoingMs;
      lines.push(`这个应用已经连续玩了 ${fmtMs(stayMs)}`);
    }
    if (typeof snap?.todayTotalMs === 'number' && snap.todayTotalMs > 0) {
      todayTotalMs = snap.todayTotalMs;
      lines.push(`【今日屏幕总亮屏时长】${fmtMs(todayTotalMs)}`);
      if (snap.todayApps?.length) {
        lines.push(`【今日应用排行】${snap.todayApps.slice(0, 6).map((t) => `${t.app} ${fmtMs(t.ms)}`).join('、')}`);
      }
    }
  } catch {
    /* UsageStats 未授权/失败：跳过时长行（前台包名已有） */
  }

  // 截屏偷窥（可选；无障碍静默截屏 + 识图模型）
  if (peek) {
    const pk = await devicePeekScreen();
    if (pk) {
      peekNote = pk.desc;
      peekImage = pk.image;
      if (pk.desc) lines.push(`【你刚刚偷看的屏幕（无障碍截屏+识图）】${pk.desc}`);
    } else {
      lines.push('（截屏偷窥失败：无障碍服务未开启/识图模型不可用）');
    }
  }

  // v2.1 全视之眼（真机原生维度：通知/电量/正在播放等；各维独立降级）
  try {
    lines.push(...(await collectDeviceExtraLines()));
  } catch {
    /* 扩展感知降级跳过：主情报（前台+时长）不受影响 */
  }

  return { ok: true, mode: 'device', lines, fgPkg, stayMs, todayTotalMs, peekNote, peekImage, degrade: null };
}

/** 浏览器/原生环境判定（轻量；详版在 native-perception.isNativePerception） */
function isNativeEnv(): boolean {
  try {
    const w = window as unknown as { aiphoneNative?: unknown; androidBridge?: unknown; Capacitor?: unknown };
    return !!(w.aiphoneNative || w.androidBridge || w.Capacitor);
  } catch {
    return false;
  }
}

// ---------------- 统一入口（模式隔离总闸） ----------------

/**
 * 按模式采集查岗情报。**模式隔离的唯一入口**——mode='web' 走网页分支、
 * mode='device' 走真机分支，绝不混读。
 * v2.1：observer=观察者（正在吃醋的 AI）——扩展感知据此自我过滤 AI 自己的通知，
 * 绝不自己吃自己的醋；不传则不过滤观察者会话（仅过滤本 App 自身系统提示）。
 */
export async function collectSenseIntel(
  mode: SenseMode,
  opts: { peek?: boolean; observer?: SenseObserver | null } = {},
): Promise<SenseIntel> {
  if (mode === 'device') return collectDeviceIntel(!!opts.peek);
  return collectWebIntel(opts.observer ?? null);
}

// ---------------- 真机操控原语（v2.0.0：锁定遮罩/解锁/拉回/偷窥，全部原生） ----------------

export interface DeviceOpOutcome {
  ok: boolean;
  /** 成功/失败的说明（进 AI 决策与通知链路） */
  text: string;
}

/**
 * 锁真机应用（v2.0.0：LockOverlayService 全屏拦截锁，替代 pm suspend；
 * v2.2.0 检测到即立即回桌面 + 弹拦截窗 + 拦截事件逐次落盘）。
 * contactId/app v2.2.0 新增：拦截窗【去哄哄 TA】按钮拉起本 App 后直达对应聊天。
 */
export async function deviceLockApp(
  pkg: string,
  opts: { unlockAt?: number; charName?: string; message?: string; contactId?: string; app?: string } = {},
): Promise<DeviceOpOutcome> {
  if (!/^[\w.]+$/.test(pkg)) return { ok: false, text: `包名不合法（${pkg}）` };
  try {
    const { nativeLockApp } = await import('./native-perception');
    const r = await nativeLockApp({
      pkg,
      unlockAt: opts.unlockAt ?? 0,
      charName: opts.charName,
      message: opts.message,
      contactId: opts.contactId,
      app: opts.app,
    });
    if (!r.ok) return { ok: false, text: `锁应用失败：${nativeDegradeText(r.reason)}` };
    return { ok: true, text: `已在真实手机上锁住 ${pkg}（TA 一点开就会被立即弹回桌面并看到你的拦截窗，直到倒计时结束或哄好）` };
  } catch {
    return { ok: false, text: '锁应用异常' };
  }
}

/** 解锁真机应用（停遮罩停守护；哄好/手动解锁共用） */
export async function deviceUnlockApp(): Promise<DeviceOpOutcome> {
  try {
    const { nativeUnlockApp } = await import('./native-perception');
    const r = await nativeUnlockApp();
    if (!r.ok && r.reason) return { ok: false, text: `解锁失败：${nativeDegradeText(r.reason)}` };
    return { ok: true, text: '已解锁（应用恢复正常可用）' };
  } catch {
    return { ok: false, text: '解锁异常' };
  }
}

/** Shizuku 时代旧名兼容（内部改锁定遮罩；防外部 import 断裂） */
export const deviceSuspendApp = (pkg: string): Promise<DeviceOpOutcome> => deviceLockApp(pkg);
export const deviceUnsuspendApp = (): Promise<DeviceOpOutcome> => deviceUnlockApp();

/**
 * 查询真机锁定状态（v2.0.0：LockOverlayService 快照，替代 dumpsys package suspended 轮询）。
 * 返回：true=锁仍活跃 / false=锁已不在（到期/已解锁） / null=查询失败（不判定）。
 */
export async function deviceLockState(pkg: string): Promise<boolean | null> {
  if (!/^[\w.]+$/.test(pkg)) return null;
  try {
    const { nativeJealousyGuardStatus } = await import('./native-perception');
    const st = await nativeJealousyGuardStatus();
    if (!st || typeof st.running !== 'boolean') return null;
    if (!st.running) return false;
    return st.pkg === pkg;
  } catch {
    return null;
  }
}

/** 强行拉回：bringToFront 把本 APP（AI Phone）切到真机前台（FLAG_ACTIVITY_NEW_TASK） */
export async function devicePullback(): Promise<DeviceOpOutcome> {
  try {
    const { nativeBringToFront } = await import('./native-perception');
    const r = await nativeBringToFront();
    if (!r || r.ok === false) {
      return { ok: false, text: `强行拉回失败：${r ? nativeDegradeText(r.reason) : '桥无响应'}` };
    }
    return { ok: true, text: '已把 TA 的真实手机强切回本 APP' };
  } catch {
    return { ok: false, text: '强行拉回异常' };
  }
}

/**
 * 截屏偷窥（v2.0.0：无障碍静默截屏 → 识图模型看一眼）。
 * 返回 {desc, image}（image 为 dataURL 原图，可发进聊天质问用户）；
 * 无障碍未开启/失败返回 null（desc 可为 null=识图不可用但截屏成功）。
 */
export async function devicePeekScreen(): Promise<{ desc: string | null; image: string | null } | null> {
  try {
    const { nativeA11yScreenshot } = await import('./native-perception');
    const r = await nativeA11yScreenshot();
    if (!r || !r.ok || !r.frame) return null;
    const image = r.frame;
    // VLM 分析（/api/phone-vision + 用户识图模型配置）
    const { useSettings } = await import('./store');
    const res = await fetch('/api/phone-vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image,
        ask: '这是 TA 的真实手机屏幕截图。TA 正在看什么 App、屏幕上有什么内容（视频/聊天/购物/游戏/文章标题等，具体描述）？紧凑输出，不要坐标不要解释。',
        config: useSettings.getState().visionConfig,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => null)) as { desc?: unknown } | null;
    const desc = res.ok && data && typeof data.desc === 'string' && data.desc.trim() ? data.desc.trim() : null;
    return { desc, image };
  } catch {
    return null;
  }
}

// ---------------- dev 测试钩子（仅 dev 生效；生产构建零暴露面） ----------------

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  const w = window as typeof window & {
    __senseTest?: {
      /** 直接跑一轮双模式采集（v2.1 全视之眼七维验证入口） */
      collect: (mode: SenseMode, observer?: { contactId: string; app: 'wx' | 'qq' | 'sms' } | null) => Promise<SenseIntel>;
    };
  };
  w.__senseTest = {
    collect: (mode, observer) => collectSenseIntel(mode, { observer: observer ?? null }),
  };
}
