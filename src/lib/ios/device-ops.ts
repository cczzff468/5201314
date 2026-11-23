'use client';

/**
 * 真机操作底座（v2.0.0 去 Shizuku 化重写）：
 *
 * 全部能力改经 native-perception 的原生桥实现（安卓系统 API + 无障碍服务）：
 *  - 点按/滑动/输入/按键 → AiAccessibilityService（dispatchGesture / ACTION_SET_TEXT /
 *    performGlobalAction）
 *  - 静默截屏 → AiAccessibilityService.takeScreenshot（API 30+，免授权弹窗）
 *  - 前台应用 → 无障碍事件流（实时）/ UsageStats 兜底
 *  - 应用锁定 → LockOverlayService（UsageStats 3s 轮询 + 悬浮窗全屏遮罩）
 *  - 拉起应用/拉回本 App → PackageManager LaunchIntent / FLAG_ACTIVITY_NEW_TASK
 *  - 电量/音量 → BatteryManager / AudioManager；通知/短信 → 通知环形缓冲 / ContentResolver
 *
 * 旧 Shizuku shell 通道（input/am/pm/monkey/dumpsys/media/wm 白名单执行）全部退役；
 * 「强杀应用」无公开 API 等价物（需 shell 权限），如实报不可用并建议用「锁定」替代。
 *
 * Web 模式（默认）完全不经过本模块——device-autonomy.executePhoneOp 里按
 * aiActionTarget 分流；本文件的 UI 类函数要求原生环境 + 无障碍服务已开启。
 */

import {
  isNativePerception,
  nativeA11yInput,
  nativeA11yKey,
  nativeA11yScreenshot,
  nativeA11ySwipe,
  nativeA11yTap,
  nativeBringToFront,
  nativeGetBatteryStatus,
  nativeGetBrightness,
  nativeGetForegroundApp,
  nativeGetRecentNotifications,
  nativeGetRecentSMS,
  nativeGetScreenSize,
  nativeGetVolume,
  nativeListInstalledApps,
  nativeLockApp,
  nativeOpenApp,
  nativeSetBrightness,
  nativeSetRingerMode,
  nativeSetVolume,
  nativeUnlockApp,
} from './native-perception';
import { useSettings } from './store';

export type DeviceOpResult = { ok: boolean; text: string };

/** 本 APP 包名（锁定名单禁锁主体） */
export const OWN_PKG = 'com.z.aiphone';

/** 永不锁定/强杀名单（锁屏界面/系统 UI/自身/拨号：盖住锁屏 = 变砖） */
export const NEVER_LOCK_PKGS = [
  'com.z.aiphone',
  'com.android.systemui',
  'com.android.phone',
  'com.android.dialer',
  'com.android.incallui',
  'com.android.settings',
];

/** 无障碍/原生通道失败的统一文案（reason → 人话） */
function a11yGateText(reason?: string): string {
  if (reason === 'no-a11y') return '无障碍服务未开启：去 设置 › 权限给予 › 无障碍服务 开启「AI 手机操控与感知」（一次开启终身有效）';
  if (reason === 'not-supported') return '此功能需要 Android 11（API 30）及以上，静默截屏在更低版本不可用';
  if (reason === 'no-permission') return '缺少对应系统权限：去 设置 › 权限给予 逐项开启';
  if (reason === 'no-overlay-permission') return '悬浮窗权限未开启：去 设置 › 权限给予 › 悬浮窗权限 开启后才能全屏拦截';
  if (reason === 'no-write-settings') return '「修改系统设置」权限未开启：去 设置 › 权限给予 › 修改系统设置 打开开关后才能调亮度/设静音';
  if (reason === 'no-audio-manager') return '读不到音频服务（系统异常，稍后重试）';
  if (reason === 'no-focus') return '当前没有焦点输入框（先点一下要输入的输入框）';
  if (reason === 'not-editable') return '焦点处不是可编辑输入框';
  if (reason === 'not-found') return '应用未安装（找不到启动入口）';
  if (reason === 'old-apk') return 'APP 版本过旧：去 设置 › APP 更新 升级到 v2.0.0 及以上';
  if (reason) return `原生通道失败：${reason}`;
  return '原生通道失败';
}

/** 前置检查：必须原生环境（浏览器里直接给可读话术，不浪费桥超时） */
export function requireDevice(): DeviceOpResult | null {
  if (!isNativePerception()) {
    return { ok: false, text: '当前在浏览器里，无法操控真机——请用 APP（APK）打开，或在 设置 › 权限给予 把 AI 动手范围切回「网站里面」' };
  }
  return null;
}

// ================= 动手（UI 级操作：无障碍 dispatchGesture） =================

/** 点按坐标（无障碍手势） */
export async function labTap(x: number, y: number): Promise<DeviceOpResult> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, text: '坐标不合法' };
  const r = await nativeA11yTap(x, y);
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (!r.ok) return { ok: false, text: `点按失败：${a11yGateText(r.reason)}` };
  return { ok: true, text: `已点按 (${Math.round(x)}, ${Math.round(y)})` };
}

/** 滑动 (x1,y1) → (x2,y2)，duration 毫秒（无障碍手势） */
export async function labSwipe(x1: number, y1: number, x2: number, y2: number, duration = 300): Promise<DeviceOpResult> {
  const r = await nativeA11ySwipe(x1, y1, x2, y2, duration);
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (!r.ok) return { ok: false, text: `滑动失败：${a11yGateText(r.reason)}` };
  return { ok: true, text: `已滑动 (${Math.round(x1)},${Math.round(y1)})→(${Math.round(x2)},${Math.round(y2)})` };
}

/** 常用按键 → 无障碍全局动作名（标记命令「按键:返回/主页/…」映射用） */
export const KEY_WORDS: Record<string, string> = {
  返回: 'back',
  back: 'back',
  主页: 'home',
  home: 'home',
  桌面: 'home',
  多任务: 'recents',
  切换: 'recents',
  appswitch: 'recents',
  recents: 'recents',
  通知: 'notifications',
  notifications: 'notifications',
  通知栏: 'notifications',
  锁屏: 'lock',
  lock: 'lock',
};

/**
 * 按键（无障碍 performGlobalAction）：
 * 支持返回/主页/多任务/通知栏/锁屏；音量类经 AudioManager 处理；
 * 其余按键（回车/删除/媒体键）无公开 API 等价物 → 如实报不可用。
 */
export async function labKey(keycode: number | string): Promise<DeviceOpResult> {
  const raw = String(keycode).trim().toLowerCase();
  const action = KEY_WORDS[raw] ?? KEY_WORDS[String(keycode)] ?? raw;
  if (action === '音量加' || action === 'volumeup' || action === '24') return volumeStep(1);
  if (action === '音量减' || action === 'volumedown' || action === '25') return volumeStep(-1);
  const r = await nativeA11yKey(action);
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (!r.ok) {
    if (['back', 'home', 'recents', 'notifications', 'lock', 'power_dialog', 'quick_settings'].includes(action)) {
      return { ok: false, text: `按键失败：${a11yGateText(r.reason)}` };
    }
    return { ok: false, text: `按键「${keycode}」不支持：无障碍通道只支持 返回/主页/多任务/通知栏/锁屏（回车/删除/媒体键等无公开 API）` };
  }
  return { ok: true, text: `已按按键 ${keycode}` };
}

/** 音量步进（AudioManager；±1 档） */
async function volumeStep(dir: 1 | -1): Promise<DeviceOpResult> {
  const cur = await nativeGetVolume();
  if (cur?.ok && typeof cur.volume === 'number') {
    return labSetVolume(cur.volume + dir);
  }
  return { ok: false, text: '音量调节失败（原生通道不可用）' };
}

/** 输入文字（无障碍 ACTION_SET_TEXT：向当前焦点输入框整体注入，原生支持中文/emoji） */
export async function deviceInputText(text: string): Promise<DeviceOpResult> {
  const s = text.trim();
  if (!s) return { ok: false, text: '要输入的内容为空' };
  const r = await nativeA11yInput(s);
  if (r === null) return { ok: false, text: '输入失败：原生桥无响应' };
  if (!r.ok) return { ok: false, text: `输入失败：${a11yGateText(r.reason)}` };
  return { ok: true, text: `已输入：${s}` };
}

/** 还原输入法（v2.0.0 起 no-op：无障碍 SET_TEXT 不切换输入法，保留函数兼容旧调用方） */
export async function restoreIme(): Promise<void> {
  /* no-op */
}

/** 拉起真机 App（PackageManager LaunchIntent） */
export async function labOpenApp(pkg: string): Promise<DeviceOpResult> {
  if (!/^[\w.]+$/.test(pkg)) return { ok: false, text: `包名不合法（收到「${pkg}」，需要形如 com.tencent.mm）` };
  const r = await nativeOpenApp(pkg);
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (!r.ok) return { ok: false, text: `拉起失败：${a11yGateText(r.reason)}` };
  return { ok: true, text: `已拉起 ${pkg}` };
}

/** 把本 App 强行拉到前台（吃醋拉回/切回聊天）；v2.2.0 原生侧后台启动限制三段修复 */
export async function labBringToFront(): Promise<DeviceOpResult> {
  const r = await nativeBringToFront();
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (!r.ok) {
    if (r.reason === 'background-blocked-no-overlay') {
      return {
        ok: false,
        text: '手机系统不允许后台直接拉起 APP（Android 10+ 安全限制）：已发一条高优先级通知，TA 点一下就能回到聊天。想彻底解锁后台拉回：去 设置 › 权限给予 开启「悬浮窗权限」',
      };
    }
    return { ok: false, text: `拉回失败：${a11yGateText(r.reason)}` };
  }
  // via: foreground/overlay-exempt = 直接切回；notification = 通知兑底（已弹横幅）
  if (r.via === 'notification') {
    return { ok: true, text: '已弹高优先级通知把 TA 喊回来（系统不允许后台硬拉，点通知即回聊天）' };
  }
  return { ok: true, text: '已把 AI Phone 拉到前台' };
}

/**
 * 强杀真机 App —— v2.0.0 去 Shizuku 化后不可用（am force-stop 需要 shell 权限，
 * 普通应用无公开 API 等价物）。如实报不可用，建议用「锁定」替代。
 */
export async function labForceStop(_pkg: string): Promise<DeviceOpResult> {
  return {
    ok: false,
    text: '去 Shizuku 化后普通应用无法强杀其他应用（系统安全限制）——可改用「锁定应用」：全屏遮罩拦截，效果更强',
  };
}

// ================= 看见（只读探测：原生系统 API） =================

/** 静默截屏（无障碍 takeScreenshot API 30+）：ok 时 text 为说明、image 为 dataURL */
export async function labScreencap(): Promise<DeviceOpResult & { image?: string }> {
  const r = await nativeA11yScreenshot();
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (r.ok && r.frame) return { ok: true, text: '截屏成功（无障碍静默截屏）', image: r.frame };
  return { ok: false, text: `截屏失败：${a11yGateText(r.reason)}` };
}

/** 屏幕分辨率（原生 DisplayMetrics；滑动/识屏坐标换算用） */
export async function labScreenSize(): Promise<{ w: number; h: number } | null> {
  const r = await nativeGetScreenSize();
  if (r?.ok && r.width && r.height) return { w: r.width, h: r.height };
  return null;
}

/** 实时前台应用（无障碍事件流优先，UsageStats 兜底） */
export async function labForegroundApp(): Promise<DeviceOpResult> {
  const r = await nativeGetForegroundApp();
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (r.ok && r.app) {
    const via = r.via === 'a11y' ? '（无障碍实时）' : '（使用情况兜底）';
    return { ok: true, text: `前台应用：${r.app}${r.name && r.name !== r.app ? `（${r.name}）` : ''}${via}` };
  }
  if (r.reason === 'no-permission') {
    return { ok: false, text: '查不到前台应用：需要开启「使用情况访问」或「无障碍服务」任一项（设置 › 权限给予）' };
  }
  return { ok: false, text: `前台应用查询失败：${a11yGateText(r.reason)}` };
}

/** 电量状态（BatteryManager 粘性广播） */
export async function labBattery(): Promise<DeviceOpResult> {
  const r = await nativeGetBatteryStatus();
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (r.ok && typeof r.level === 'number' && r.level >= 0) {
    return { ok: true, text: `电量 ${r.level}%${r.charging ? '（充电中）' : ''}` };
  }
  return { ok: false, text: `电量查询失败：${a11yGateText(r.reason)}` };
}

/** 音量档位（AudioManager STREAM_MUSIC） */
export async function labVolume(): Promise<DeviceOpResult> {
  const r = await nativeGetVolume();
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (r.ok && typeof r.volume === 'number') {
    return { ok: true, text: `媒体音量档位：${r.volume}/${r.max ?? '?'}` };
  }
  return { ok: false, text: `音量查询失败：${a11yGateText(r.reason)}` };
}

/** 调媒体音量（AudioManager，0~max 自动钳制） */
export async function labSetVolume(index: number): Promise<DeviceOpResult> {
  const v = Math.max(0, Math.min(15, Math.round(index)));
  const r = await nativeSetVolume(v);
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (!r.ok) return { ok: false, text: `音量调节失败：${a11yGateText(r.reason)}` };
  return { ok: true, text: `媒体音量已调到 ${r.volume ?? v}` };
}

/** 查屏幕亮度（Settings.System；percent 1-100 + 自动/手动模式） */
export async function labGetBrightness(): Promise<DeviceOpResult> {
  const r = await nativeGetBrightness();
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (!r.ok) return { ok: false, text: `亮度查询失败：${a11yGateText(r.reason)}` };
  return { ok: true, text: `屏幕亮度：${r.percent}%（${r.auto ? '自动亮度开' : '手动'}）` };
}

/** 调屏幕亮度（percent 1-100；原生先切手动亮度模式再写 SCREEN_BRIGHTNESS，防全黑钳 2-255） */
export async function labSetBrightness(percent: number): Promise<DeviceOpResult> {
  const v = Math.max(1, Math.min(100, Math.round(percent)));
  const r = await nativeSetBrightness(v);
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (!r.ok) return { ok: false, text: `亮度调节失败：${a11yGateText(r.reason)}` };
  return { ok: true, text: `屏幕亮度已调到 ${r.percent ?? v}%` };
}

/** 设置铃声模式（silent/vibrate/normal；ringerMode 优先，静音降级零铃声量） */
export async function labSetRingerMode(mode: 'silent' | 'vibrate' | 'normal'): Promise<DeviceOpResult> {
  const label = mode === 'silent' ? '静音' : mode === 'vibrate' ? '振动' : '正常响铃';
  const r = await nativeSetRingerMode(mode);
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (!r.ok) return { ok: false, text: `铃声模式设置失败：${a11yGateText(r.reason)}` };
  return { ok: true, text: `铃声模式已设为${label}${r.via === 'ring-volume' ? '（铃声量方式）' : ''}` };
}

/** 最近通知（通知环形缓冲，需「通知使用权」） */
export async function labNotificationSnapshot(limit = 10): Promise<DeviceOpResult> {
  const r = await nativeGetRecentNotifications(limit);
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (!Array.isArray(r)) return { ok: false, text: `通知读取失败：${a11yGateText(r.error)}` };
  if (r.length === 0) return { ok: true, text: '通知栏没有可见通知' };
  const rows = r.map((n) => {
    const t = new Date(n.ts);
    const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    const title = n.title || n.text;
    return `${hhmm} ${n.app}：${title}${n.text && n.title ? `（${n.text.slice(0, 60)}）` : ''}`;
  });
  return { ok: true, text: `最近通知：\n${rows.join('\n')}` };
}

/** 最近短信（ContentResolver 收件箱，需 READ_SMS） */
export async function labRecentSMS(limit = 10): Promise<DeviceOpResult> {
  const r = await nativeGetRecentSMS(limit);
  if (r === null) return { ok: false, text: '桥无响应（原生调用超时）' };
  if (!Array.isArray(r)) return { ok: false, text: `短信读取失败：${a11yGateText(r.error)}` };
  if (r.length === 0) return { ok: true, text: '收件箱没有短信' };
  const rows = r.map((m) => {
    const t = new Date(m.ts);
    const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    return `${hhmm} ${m.address || '未知号码'}：${m.body.slice(0, 80)}`;
  });
  return { ok: true, text: `最近短信：\n${rows.join('\n')}` };
}

// ================= 识屏（截屏 + VLM 视觉理解） =================

/**
 * 截屏交 VLM 分析（/api/phone-vision，识图模型走设置 › 识图模型 配置）：
 * 返回模型对屏幕的描述（界面/文字/可点元素及坐标）。识图未配置/超时抛错，
 * 调用方按「识屏不可用」降级（截屏本身已成功）。
 */
export async function visionAsk(image: string, ask: string, timeoutMs = 90_000): Promise<string> {
  const res = await fetch('/api/phone-vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, ask, config: useSettings.getState().visionConfig }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => null)) as { desc?: unknown; error?: unknown } | null;
  if (res.ok && data && typeof data.desc === 'string' && data.desc.trim()) return data.desc.trim();
  const msg = typeof data?.error === 'string' && data.error ? data.error : `屏幕分析请求失败（HTTP ${res.status}）`;
  throw new Error(msg);
}

/** 「看屏幕」完整链：无障碍静默截屏 → VLM 描述（识图失败时只报截屏成功）。
 *  v2.2.0 提示词精简（机主实测旧版返回带「归一化坐标 + 像素估算」双坐标系统的长篇
 *  罗列，AI 还会原文复述给机主）——现在要求紧凑清单（≤10 行、单坐标系统），
 *  并在结果尾部附「勿复述」指引：向机主汇报用一句话概括，情报仅供 AI 自己定位用。 */
export async function labLookScreen(detailed: boolean): Promise<DeviceOpResult & { image?: string }> {
  const shot = await labScreencap();
  if (!shot.ok) return shot;
  try {
    const ask = detailed
      ? '用紧凑清单描述手机屏幕（总长不超过 10 行）：第一行「当前：应用名·界面名」；后面每行一个可点元素，格式「名称 x,y」（像素坐标）；最多列 10 个最重要的元素。不要归一化坐标、不要像素估算说明、不要布局描述、不要解释坐标含义。'
      : '一句话（不超过 30 字）说明当前屏幕是什么应用什么页面，正在显示什么。';
    const desc = await visionAsk(shot.image ?? '', ask, 30_000);
    return {
      ok: true,
      text: `${desc}\n（这份情报仅供你定位用：向机主汇报时用一句自然的话概括即可，绝不许把这份坐标清单原文复述给机主）`,
      image: shot.image,
    };
  } catch (e) {
    return {
      ok: true,
      text: `截屏成功（识屏不可用：${e instanceof Error ? e.message.slice(0, 100) : '识图服务异常'}；可在 设置 › 识图模型 配置后重试）`,
      image: shot.image,
    };
  }
}

// ================= 应用搜索与锁定（真机模式） =================

/** 列出真机已安装的第三方应用（PackageManager）。
 *  返回包名数组；失败返回空数组。供 searchRealApp 模糊匹配用。 */
export async function labListPackages(_includeSystem = false): Promise<string[]> {
  try {
    const apps = await nativeListInstalledApps();
    if (!apps) return [];
    return apps.map((a) => a.pkg);
  } catch {
    return [];
  }
}

/** 已安装应用清单（pkg + 中文名；供锁定名单/搜索按名字解析包名） */
export async function labInstalledApps(): Promise<{ pkg: string; name: string }[]> {
  try {
    return (await nativeListInstalledApps()) ?? [];
  } catch {
    return [];
  }
}

/** 锁定名单禁锁校验（自身/系统核心：锁了会导致手机无法操作） */
export function isNeverLockPkg(pkg: string): boolean {
  return NEVER_LOCK_PKGS.includes(pkg);
}

/**
 * 锁定应用（v2.0.0：LockOverlayService 全屏拦截锁，v2.2.0 检测到即回桌面 + 弹拦截窗）：
 * 无障碍实时钩子 + UsageStats 兑底双通道感知 → 锁定应用一露头立即弹回桌面 +
 * 弹拦截窗（AI 质问文案 + 每秒倒计时 + 去哄哄按钮）；unlockAt=0 锁到哄好为止。
 * v2.2.0 新增 contactId/app：拦截窗【去哄哄 TA】拉起本 App 后直达对应聊天。
 */
export async function labLockApp(
  pkg: string,
  opts: { unlockAt?: number; charName?: string; message?: string; contactId?: string; app?: string } = {},
): Promise<DeviceOpResult> {
  // v2.1.1 防伪包名：合法 Android 包名必含「.」（如 com.tencent.mm）——「QQ」「抖音」
  // 这类应用名混进来直接报错指路（中文名解析在上层 toolFreezeRealApp/lockApp 工具完成），
  // 不再让原生拿到永不命中的伪包名「静默锁成功」
  if (!/^[\w.]+$/.test(pkg) || !pkg.includes('.')) {
    return {
      ok: false,
      text: `「${pkg}」不是合法的 Android 包名（形如 com.tencent.mm）。锁定真机应用请填中文名（如「QQ」「抖音」）或包名——中文名会自动解析成包名`,
    };
  }
  if (isNeverLockPkg(pkg)) {
    return { ok: false, text: `禁止锁定核心应用（${pkg}）——锁了会导致手机无法操作` };
  }
  const r = await nativeLockApp({ pkg, ...opts });
  if (!r.ok) return { ok: false, text: `锁定失败：${a11yGateText(r.reason)}` };
  const dur = opts.unlockAt ? `，${Math.max(1, Math.round((opts.unlockAt - Date.now()) / 60_000))} 分钟后自动解锁` : '（直到哄好才解锁）';
  return { ok: true, text: `已在真实手机上锁定 ${pkg}${dur}：一点开就会被立即弹回桌面并看到你的拦截窗` };
}

/** 解锁应用（停遮罩停守护） */
export async function labUnlockApp(): Promise<DeviceOpResult> {
  const r = await nativeUnlockApp();
  if (!r.ok && r.reason !== undefined) return { ok: false, text: `解锁失败：${a11yGateText(r.reason)}` };
  return { ok: true, text: '已解锁（应用恢复正常可用）' };
}

/** 真机「冻结」应用（v2.0.0 语义变更：pm suspend 退役 → 全屏拦截锁；函数名保留兼容） */
export async function labSuspendApp(pkg: string): Promise<DeviceOpResult> {
  return labLockApp(pkg);
}

/** 真机「解冻」应用（v2.0.0 语义变更：解锁拦截锁；函数名保留兼容） */
export async function labUnsuspendApp(_pkg: string): Promise<DeviceOpResult> {
  return labUnlockApp();
}
