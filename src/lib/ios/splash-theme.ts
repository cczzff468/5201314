/**
 * 开屏动画主题（第三十四轮：四选一）——共享类型与同步读取器。
 *
 * star=星空月夜（默认·深夜星点+新月）/ mist=雾中远山（灰白雾面+三层山影）/
 * moon=雨落成诗（第三十四轮按机主参考图重做：蓝灰雨窗+水珠+涟漪+散落诗行+手写体 cove）/
 * chat=对话（第三十四轮新增：白底聊天气泡逐条浮现——机主提供的土味情话对话）。
 *
 * 持久化双写：
 * - localStorage（同步可读）：BootSplash 首帧 useLayoutEffect 换主题，冷启动第一帧
 *   即正确主题、零闪烁（IndexedDB 异步来不及）；
 * - IndexedDB settings.splashTheme（与设置页 store 同源）。
 */
'use client';

export type CoveSplashTheme = 'star' | 'mist' | 'moon' | 'chat';

/** localStorage 键（同步可读：首帧换主题零闪烁） */
export const SPLASH_THEME_KEY = 'cove-splash-theme';

/** 同步读持久化主题（无效值/不可用环境回默认 star）——BootSplash 首帧与设置页共用 */
export function readSplashTheme(): CoveSplashTheme {
  try {
    if (typeof window === 'undefined') return 'star';
    const v = window.localStorage.getItem(SPLASH_THEME_KEY);
    if (v === 'mist' || v === 'moon' || v === 'star' || v === 'chat') return v;
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
