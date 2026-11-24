/**
 * v1.9.46 APK 原生壳桥（window.AIPhoneNative，由 MainActivity addJavascriptInterface 注入）。
 *
 * 能力（先探后用，浏览器/网页中无此对象——全部静默降级，绝不能抛错）：
 * - getSafeArea()：当前窗口真实安全区（CSS px；竖屏 = 上下系统条/挖孔，横屏 = 左右挖孔避让，
 *   原生侧 inset 监听实时缓存，旋转后由原生 evaluateJavascript 调 window.__aiphoneApplySafeArea 推送）；
 * - setSystemBarsStyle(style)：系统状态栏/导航栏图标明暗（'LIGHT'=深色图标配浅背景，
 *   'DARK'=白色图标配深背景，'DEFAULT'=随系统主题）——壁纸明暗联动，暗壁纸上黑图标隐身的问题根除。
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

interface NativeBridge {
  getSafeArea(): string;
  setSystemBarsStyle(style: NativeBarStyle): void;
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

/** 同步系统状态栏/导航栏图标明暗（无桥静默） */
export function setNativeSystemBarsStyle(style: NativeBarStyle): void {
  const N = getNativeBridge();
  if (!N || typeof N.setSystemBarsStyle !== 'function') return;
  try {
    N.setSystemBarsStyle(style);
  } catch {
    /* 原生侧异常不影响网页运行 */
  }
}
