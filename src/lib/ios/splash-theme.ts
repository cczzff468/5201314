/**
 * 开屏动画主题（第三十四轮：四选一）——共享类型与同步读取器。
 *
 * star=星空月夜（默认·深夜星点+新月）/ mist=雾中远山（灰白雾面+三层山影）/
 * moon=雨落成诗（第三十四轮按机主参考图重做：蓝灰雨窗+水珠+涟漪+散落诗行+手写体 cove）/
 * chat=对话（第三十四轮新增：白底聊天气泡逐条浮现——机主提供的土味情话对话）。
 *
 * 持久化三写（第三十五轮加 cookie）：
 * - localStorage（同步可读）：BootSplash 首帧 useLayoutEffect 换主题，水合后第一帧
 *   即正确主题、零闪烁（IndexedDB 异步来不及）；
 * - IndexedDB settings.splashTheme（与设置页 store 同源）；
 * - cookie（第三十五轮新增）：【修「刚打开先显示另一个开屏、几秒后才变所选」】——
 *   APK WebView 冷启动时 SSR HTML 先于 JS 水合绘制（网络慢时缺口可达数秒），此前
 *   SSR 恒按默认 star 渲染 → 水合前用户看到错误主题。cookie 服务端同步可读：
 *   page.tsx（server component）读 cookie 把 initialTheme 烤进 SSR HTML，
 *   水合前绘制的就是所选主题；BootSplash 水合后再按 localStorage 校准并自愈 cookie。
 *
 * 同构模块（无 'use client' 指令）：window 访问全部带 typeof 守卫，
 * server component（page.tsx 读 cookie）与 client（BootSplash/store）两侧均可导入。
 */

export type CoveSplashTheme = 'star' | 'mist' | 'moon' | 'chat';

/** localStorage 键（同步可读：首帧换主题零闪烁） */
export const SPLASH_THEME_KEY = 'cove-splash-theme';

/** cookie 键（服务端可读：SSR 首屏烤主题，防水合前闪错主题） */
export const SPLASH_THEME_COOKIE = 'cove-splash-theme';

/** 值校验（localStorage / cookie / IndexedDB 三源共用） */
export function validateSplashTheme(v: unknown): CoveSplashTheme | null {
  return v === 'mist' || v === 'moon' || v === 'star' || v === 'chat' ? v : null;
}

/** 同步读持久化主题（无效值/不可用环境回默认 star）——BootSplash 首帧与设置页共用 */
export function readSplashTheme(): CoveSplashTheme {
  try {
    if (typeof window === 'undefined') return 'star';
    return validateSplashTheme(window.localStorage.getItem(SPLASH_THEME_KEY)) ?? 'star';
  } catch {
    /* 隐私模式等不可用：回默认 */
  }
  return 'star';
}

/** 同步写 localStorage（设置页选择时调用；IndexedDB 由 store setter 另行写） */
export function writeSplashThemeSync(t: CoveSplashTheme) {
  try {
    window.localStorage.setItem(SPLASH_THEME_KEY, t);
  } catch {
    /* 写失败静默：IndexedDB 仍在，设置页显示不受影响 */
  }
}

/** 同步写 cookie（一年有效、同源 lax）：下次冷启动 SSR 首屏即烤出所选主题 */
export function writeSplashThemeCookie(t: CoveSplashTheme) {
  try {
    document.cookie = `${SPLASH_THEME_COOKIE}=${t};path=/;max-age=31536000;samesite=lax`;
  } catch {
    /* 写失败静默：localStorage 仍在，仅 SSR 首屏回默认 */
  }
}
