'use client';

/**
 * 吃醋/查岗·双模式感知层（v2.0「赛博伴侣」重构核心）。
 *
 * 模式隔离铁律（机主规格）：
 * - 网页模式（senseMode='web'）：严格只读**网页内部**状态——虚拟手机当前 App、
 *   停留时长、今日使用账本（web-usage-ledger）。绝不触碰任何真机桥。
 * - 真机模式（senseMode='device'）：严格只读**真实手机**状态（经 Shizuku）——
 *   前台应用包名（dumpsys window）、当前应用使用时长、今日屏幕总亮屏时间
 *   （UsageStats 快照）、静默截屏（可选，识图模型看一眼）。绝不读网页虚拟状态。
 *   两条通道物理隔离（互不 import 对方数据源），杜绝跨模式数据错乱。
 *
 * 真机命令底座（全部走既有 APK 的 shizukuExec 白名单，无需重打 APK）：
 * - pm suspend / pm unsuspend     —— 锁应用 / 解锁（白名单含 pm）
 * - am start -n com.z.aiphone/.MainActivity —— 强行拉回本 APP（白名单含 am）
 * - dumpsys package <pkg>          —— 强制解锁感知（suspended 状态轮询）
 * - dumpsys window / usagestats    —— 前台包名 / 今日亮屏时长
 * - shizukuScreencap               —— 静默截屏（免授权弹窗）
 *
 * 容错（多品牌兜底）：所有真机调用失败（Shizuku 未运行/未授权/绑定失败/
 * 厂商 ROM 对 pm suspend 的额外限制）都返回结构化降级原因（degrade），
 * 上层据此静默跳过本轮或改发消息，绝不把异常炸进决策链。
 */

import type { SenseMode } from './jealousy-sense-types';

export type { SenseMode };

// ---------------- 情报结构 ----------------

export interface SenseIntel {
  /** 采集是否成功（真机模式 Shizuku 全链路失败 → false，上层静默跳过本轮） */
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
  /** 降级原因（Shizuku 各失败形态的人话；ok=true 时为 null） */
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

/** 网页模式情报采集：虚拟手机当前 App + 停留时长 + 今日使用账本 */
async function collectWebIntel(): Promise<SenseIntel> {
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

  return { ok: true, mode: 'web', lines, fgPkg, stayMs, todayTotalMs, peekNote: null, degrade: null };
}

// ---------------- 真机模式采集（绝不读网页虚拟状态） ----------------

/** 真机前台包名（dumpsys window 焦点行；失败 null） */
async function deviceForegroundPkg(): Promise<string | null> {
  try {
    const { nativeShizukuExec } = await import('./native-perception');
    const r = await nativeShizukuExec(['dumpsys', 'window'], { mustContain: ['mCurrentFocus'], maxLines: 30, timeoutMs: 8000 });
    if (!r || !r.ok) return null;
    const line = (r.out ?? '').split('\n').map((l) => l.trim()).find((l) => l.startsWith('mCurrentFocus')) ?? '';
    const m = /mCurrentFocus=Window\{[^ ]+ [^ ]+ ([\w.$]+)\//.exec(line);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Shizuku 失败 reason → 人话降级文案（设置页/决策上下文共用） */
export function shizukuDegradeText(reason: string | undefined | null): string {
  switch (reason ?? '') {
    case 'shizuku-not-running':
      return 'Shizuku 未运行（重启手机后需重新激活）';
    case 'shizuku-no-permission':
      return 'Shizuku 未授权（设置 › 权限给予 › 调试权限 里去授权）';
    case 'bind-timeout':
    case 'bind-binder':
      return 'Shizuku 服务连接失败';
    case 'exec-error':
      return '真机命令执行失败（可能是厂商 ROM 限制）';
    case 'not-native':
      return '当前在浏览器里（真机查岗需要 APK 打开 + Shizuku 激活）';
    default:
      return reason ? `Shizuku 通道异常：${reason}` : 'Shizuku 通道异常';
  }
}

/** 真机模式情报采集：前台包名 + 当前应用时长 + 今日亮屏 + （可选）截屏偷窥 */
async function collectDeviceIntel(peek: boolean): Promise<SenseIntel> {
  const lines: string[] = [];
  let fgPkg: string | null = null;
  let stayMs = 0;
  let todayTotalMs = 0;
  let peekNote: string | null = null;

  // 前台包名（唯一权威数据源：dumpsys window）
  fgPkg = await deviceForegroundPkg();
  if (!fgPkg) {
    // dumpsys 失败可能是 Shizuku 整体断连——用 shizukuStatus 判降级原因
    let reason = 'exec-error';
    try {
      const { nativeShizukuStatus } = await import('./native-perception');
      const st = await nativeShizukuStatus();
      if (!st || !st.running) reason = 'shizuku-not-running';
      else if (!st.granted) reason = 'shizuku-no-permission';
    } catch {
      /* 探测失败保持 exec-error */
    }
    if (!isNativeEnv()) reason = 'not-native';
    return { ok: false, mode: 'device', lines: [], fgPkg: null, stayMs: 0, todayTotalMs: 0, peekNote: null, degrade: shizukuDegradeText(reason) };
  }
  lines.push(`TA 的真实手机此刻前台应用：${fgPkg}`);

  // 当前应用使用时长 + 今日总亮屏（UsageStats 双引擎快照；失败只降级该行）
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

  // 截屏偷窥（可选；Shizuku 静默截屏 + 识图模型）
  if (peek) {
    peekNote = await devicePeekScreen();
    if (peekNote) lines.push(`【你刚刚偷看的屏幕（截屏+识图）】${peekNote}`);
    else lines.push('（截屏偷窥失败：Shizuku 截屏通道或识图模型不可用）');
  }

  return { ok: true, mode: 'device', lines, fgPkg, stayMs, todayTotalMs, peekNote, degrade: null };
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
 */
export async function collectSenseIntel(mode: SenseMode, opts: { peek?: boolean } = {}): Promise<SenseIntel> {
  if (mode === 'device') return collectDeviceIntel(!!opts.peek);
  return collectWebIntel();
}

// ---------------- 真机操控原语（锁/解锁/拉回/偷窥） ----------------

export interface DeviceOpOutcome {
  ok: boolean;
  /** 成功/失败的说明（进 AI 决策与通知链路） */
  text: string;
}

/** 锁真机应用：pm suspend（部分厂商 ROM 限制 shell 执行会失败，如实回传） */
export async function deviceSuspendApp(pkg: string): Promise<DeviceOpOutcome> {
  if (!/^[\w.]+$/.test(pkg)) return { ok: false, text: `包名不合法（${pkg}）` };
  try {
    const { nativeShizukuExec } = await import('./native-perception');
    const r = await nativeShizukuExec(['pm', 'suspend', pkg], { maxLines: 12, timeoutMs: 10_000 });
    if (!r) return { ok: false, text: '锁应用失败：桥无响应（非原生环境或 Shizuku 断连）' };
    if (!r.ok) return { ok: false, text: `锁应用失败：${shizukuDegradeText(r.reason)}` };
    const out = (r.out ?? '').trim();
    if (/Error|error|Exception|denied|not found|Unknown/i.test(out)) {
      return { ok: false, text: `锁应用失败（厂商 ROM 可能限制 pm suspend）：${out.slice(0, 120)}` };
    }
    return { ok: true, text: `已在真实手机上锁住 ${pkg}（pm suspend，桌面图标变灰打不开）` };
  } catch {
    return { ok: false, text: '锁应用异常' };
  }
}

/** 解锁真机应用：pm unsuspend */
export async function deviceUnsuspendApp(pkg: string): Promise<DeviceOpOutcome> {
  if (!/^[\w.]+$/.test(pkg)) return { ok: false, text: `包名不合法（${pkg}）` };
  try {
    const { nativeShizukuExec } = await import('./native-perception');
    const r = await nativeShizukuExec(['pm', 'unsuspend', pkg], { maxLines: 12, timeoutMs: 10_000 });
    if (!r) return { ok: false, text: '解锁失败：桥无响应' };
    if (!r.ok) return { ok: false, text: `解锁失败：${shizukuDegradeText(r.reason)}` };
    return { ok: true, text: `已解锁 ${pkg}` };
  } catch {
    return { ok: false, text: '解锁异常' };
  }
}

/**
 * 查询真机应用的 suspended 状态（强制解锁感知的数据源）。
 * 返回：true=仍被锁 / false=未被锁（锁活跃却 false ⇒ 用户强行打破）/ null=查询失败（不判定）。
 * 兼容多品牌输出差异：suspended=true|false、pkgFlags 里的 SUSPENDED 标志。
 */
export async function deviceSuspendState(pkg: string): Promise<boolean | null> {
  if (!/^[\w.]+$/.test(pkg)) return null;
  try {
    const { nativeShizukuExec } = await import('./native-perception');
    const r = await nativeShizukuExec(['dumpsys', 'package', pkg], { mustContain: ['suspended', 'SUSPENDED', 'pkgFlags'], maxLines: 60, timeoutMs: 12_000 });
    if (!r || !r.ok) return null;
    const out = r.out ?? '';
    // 形态一：suspended=true / suspended=false（多数 ROM）
    const m = /suspended=(true|false)/i.exec(out);
    if (m) return m[1].toLowerCase() === 'true';
    // 形态二：pkgFlags=[ ... SCHEDULED_... SUSPENDED ... ]（部分 Android 13+）
    if (/pkgFlags=\[[^\]]*SUSPENDED/i.test(out)) return true;
    if (/pkgFlags=\[/i.test(out)) return false; // 有 flags 行但无 SUSPENDED
    return null; // 都没匹配到（dumpsys 输出变化）：不判定，绝不误报
  } catch {
    return null;
  }
}

/** 强行拉回：am start 把本 APP（AI Phone）切到真机前台（monkey 兜底） */
export async function devicePullback(): Promise<DeviceOpOutcome> {
  try {
    const { nativeShizukuExec } = await import('./native-perception');
    // am start 优先（机主规格点名）；失败（Activity 名不匹配等）回退 monkey
    const r = await nativeShizukuExec(['am', 'start', '-n', 'com.z.aiphone/.MainActivity'], { maxLines: 20, timeoutMs: 8000 });
    if (r && r.ok && !/Error|Exception|does not exist/i.test(r.out ?? '')) {
      return { ok: true, text: '已把 TA 的真实手机强切回本 APP（am start）' };
    }
    const r2 = await nativeShizukuExec(['monkey', '-p', 'com.z.aiphone', '-c', 'android.intent.category.LAUNCHER', '1'], { maxLines: 20, timeoutMs: 8000 });
    if (r2 && r2.ok && !/aborted|Error/i.test(r2.out ?? '')) {
      return { ok: true, text: '已把 TA 的真实手机强切回本 APP（monkey 拉起）' };
    }
    const reason = !r ? '桥无响应' : !r.ok ? shizukuDegradeText(r.reason) : 'am/monkey 均失败';
    return { ok: false, text: `强行拉回失败：${reason}` };
  } catch {
    return { ok: false, text: '强行拉回异常' };
  }
}

/** 截屏偷窥：Shizuku 静默截屏 → 识图模型（VLM）看一眼 → 屏幕描述文本 */
export async function devicePeekScreen(): Promise<string | null> {
  try {
    const { nativeShizukuScreencap } = await import('./native-perception');
    const r = await nativeShizukuScreencap();
    if (!r || !r.ok || !r.frame) return null;
    // VLM 分析（复用能力实验室链路：/api/phone-vision + 用户识图模型配置）
    const { useSettings } = await import('./store');
    const res = await fetch('/api/phone-vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: r.frame,
        ask: '这是 TA 的真实手机屏幕截图。TA 正在看什么 App、屏幕上有什么内容（视频/聊天/购物/游戏/文章标题等，具体描述）？紧凑输出，不要坐标不要解释。',
        config: useSettings.getState().visionConfig,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => null)) as { desc?: unknown } | null;
    if (res.ok && data && typeof data.desc === 'string' && data.desc.trim()) return data.desc.trim();
    return null;
  } catch {
    return null;
  }
}
