/**
 * v1.9.46 APK 原生壳桥（window.AIPhoneNative，由 MainActivity addJavascriptInterface 注入）。
 *
 * 能力（先探后用，浏览器/网页中无此对象——全部静默降级，绝不能抛错）：
 * - getSafeArea()：当前窗口真实安全区（CSS px；竖屏 = 顶部挖孔（v2.4.9 状态栏已隐藏）+ 底部系统条，
 *   横屏 = 左右挖孔避让，原生侧 inset 监听实时缓存，旋转后由原生 evaluateJavascript 调
 *   window.__aiphoneApplySafeArea 推送）；
 * - setSystemBarsStyle(style)：状态栏/导航栏图标同色设置（旧接口，兼容保留）；
 * - setSystemBarStyles(statusStyle, navStyle)（v2.4.9）：状态栏/导航栏图标明暗分别设置——
 *   状态栏临时呼出时浮在顶部背景上、按顶色；导航栏常驻底部、按底色（上下双色壁纸不错色）。
 *   'LIGHT'=深色图标配浅背景，'DARK'=白色图标配深背景，'DEFAULT'=随系统主题。
 * - setStatusBarMode(mode)（v2.4.22·第三十九轮）：状态栏外观模式——'transparent' 透明融合
 *   （物理系统条常驻透明显示）/ 'hidden' 完全隐藏（三通道隐藏真全屏沉浸）。
 *
 * 注意：安全区 CSS 变量的「预注入」不在本模块——layout.tsx 的 body 首位内联脚本在
 * HTML 解析期同步读取本桥（早于首帧），React 水合后任何组件都可直接用 var(--app-sat) 等
 * 四个变量；本模块供需要「值」而非「变量」的场合（如横竖屏判定、调试显示）。
 */

export interface NativeSafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type NativeBarStyle = 'LIGHT' | 'DARK' | 'DEFAULT';

/** 状态栏外观模式（第三十九轮）：transparent=透明融合 / hidden=完全隐藏 */
export type NativeStatusBarMode = 'transparent' | 'hidden';
/** 既有导出别名（store/theme 等消费方按此名引入；第四十一轮补齐导出修既有 tsc 基线错） */
export type StatusBarMode = NativeStatusBarMode;

export type AppIconAliasId = '1' | '2' | '3' | '4' | '5';

/** v2.4.21 一键换图标桥（MainActivity.NativeBridge——方法存在即 v2.4.21+ 壳）
 *  第四十一轮：switchAppIcon 升级为返回状态字符串（v2.4.24+ 壳）——'ok'=切换已受理
 *  （App 将退回桌面）/ 其它或 undefined=旧壳不支持该别名或失败（网页侧立即恢复，
 *  修复「点新图标卡在『正在为您更换图标』永远不退」） */
interface NativeIconBridge {
  /** 当前启用的图标别名 '1'~'5'（第四十一轮五变体；APK 覆盖安装后重置回 Manifest 默认 3 号，以原生为准） */
  getCurrentIcon(): string;
  /** 切换图标别名（先启目标再关其余 + HOME + System.exit 强退回桌面）；
 *  v2.4.24+ 返回 'ok'（受理）/ 'bad_alias'（旧壳不认识该别名） */
  switchAppIcon(alias: string): string | void;
}

interface NativeBridge {
  getSafeArea(): string;
  setSystemBarsStyle(style: NativeBarStyle): void;
  setSystemBarStyles?(statusStyle: NativeBarStyle, navStyle: NativeBarStyle): void;
  getCurrentIcon?(): string;
  switchAppIcon?(alias: string): string | void;
  setStatusBarMode?(mode: string): void;
}

declare global {
  interface Window {
    AIPhoneNative?: NativeBridge;
    __aiphoneApplySafeArea?: (payload: string | NativeSafeArea) => void;
  }
}

/** 是否在 APK 原生壳内（网页/桌面预览恒 false） */
export function isNativeShell(): boolean {
  return getNativeBridge() !== null;
}

function getNativeBridge(): NativeBridge | null {
  if (typeof window === 'undefined') return null;
  const N = window.AIPhoneNative;
  return N && typeof N.getSafeArea === 'function' ? N : null;
}

/** 读取当前安全区数值（无桥 → null；桥异常 → null，调用方自行兜底） */
export function getNativeSafeArea(): NativeSafeArea | null {
  const N = getNativeBridge();
  if (!N) return null;
  try {
    const parsed = JSON.parse(N.getSafeArea() || '{}') as Partial<NativeSafeArea>;
    return {
      top: Number(parsed.top) || 0,
      right: Number(parsed.right) || 0,
      bottom: Number(parsed.bottom) || 0,
      left: Number(parsed.left) || 0,
    };
  } catch {
    return null;
  }
}

/** 同步系统状态栏/导航栏图标明暗（无桥静默；旧 APK 无拆分接口时回落同色版） */
export function setNativeSystemBarsStyle(style: NativeBarStyle): void {
  const N = getNativeBridge();
  if (!N || typeof N.setSystemBarsStyle !== 'function') return;
  try {
    N.setSystemBarsStyle(style);
  } catch {
    /* 原生侧异常不影响网页运行 */
  }
}

/** 状态栏/导航栏图标明暗分别设置（v2.4.9）：状态栏（临时呼出）按顶部背景明暗、
 *  导航栏（常驻底部）按底部背景明暗；无桥或旧 APK 无拆分接口时回落同色版。 */
export function setNativeSystemBarStyles(statusStyle: NativeBarStyle, navStyle: NativeBarStyle): void {
  const N = getNativeBridge();
  if (!N) return;
  try {
    if (typeof N.setSystemBarStyles === 'function') {
      N.setSystemBarStyles(statusStyle, navStyle);
    } else if (typeof N.setSystemBarsStyle === 'function') {
      N.setSystemBarsStyle(statusStyle);
    }
  } catch {
    /* 原生侧异常不影响网页运行 */
  }
}

/** v2.4.21 一键无感换图标（Activity Alias）：换图标桥是否可用
 *  （方法存在 = v2.4.21+ APK 壳；旧壳/浏览器恒 null——网格静默走 PWA 自动跟随流）
 *  第四十一轮：返回的包装同时透传原生返回值（v2.4.24+ 'ok'/'bad_alias'；旧壳 undefined） */
export function getNativeIconBridge(): NativeIconBridge | null {
  if (typeof window === 'undefined') return null;
  const N = window.AIPhoneNative;
  if (!N || typeof N.switchAppIcon !== 'function' || typeof N.getCurrentIcon !== 'function') return null;
  return {
    getCurrentIcon: () => N.getCurrentIcon!(),
    switchAppIcon: (a: string) => N.switchAppIcon!(a),
  };
}

/** 读原生当前启用图标别名 '1'~'5'（无桥/异常回 null，调用方自行兜底） */
export function getNativeCurrentIcon(): AppIconAliasId | null {
  const N = window.AIPhoneNative;
  if (typeof window === 'undefined' || !N || typeof N.getCurrentIcon !== 'function') return null;
  try {
    const raw = N.getCurrentIcon();
    return raw === '1' || raw === '2' || raw === '3' || raw === '4' || raw === '5' ? raw : null;
  } catch {
    return null;
  }
}

/** v2.4.22+ 壳判定（第三十九轮）：状态栏模式桥是否存在（旧壳/浏览器恒 false——
 *  网页侧据此决定透明模式下自绘状态栏是否让位给物理系统条，防双状态栏） */
export function hasNativeStatusBarMode(): boolean {
  if (typeof window === 'undefined') return false;
  const N = window.AIPhoneNative;
  return !!N && typeof N.setStatusBarMode === 'function';
}

/** v2.4.22 状态栏外观模式（第三十九轮）：'transparent'（透明融合·物理系统条常驻透明
 *  显示+内容全额安全区避让）/ 'hidden'（完全隐藏·三通道隐藏真全屏）。
 *  返回是否成功送达原生（旧壳/浏览器恒 false，调用方静默降级为纯网页行为）；
 *  原生侧同步写 SharedPreferences，冷启动 onCreate 即按记忆模式布局（防首帧闪错）。 */
export function setNativeStatusBarMode(mode: NativeStatusBarMode): boolean {
  if (typeof window === 'undefined') return false;
  const N = window.AIPhoneNative;
  if (!N || typeof N.setStatusBarMode !== 'function') return false;
  try {
    N.setStatusBarMode(mode);
    return true;
  } catch {
    return false;
  }
}
