'use client';

/**
 * 桌面图标开机自愈（第四十五轮）：
 *
 * 背景：APK 换图标走 activity-alias。覆盖安装新 APK 后，PackageManager 里各别名的启用态
 * 会被重置回 Manifest 默认（3 号·情书字标），而机主的偏好在网页 IndexedDB 里还是他选的
 * 那一号 → 机主每次更新后都看到「桌面图标又变回默认（情书字标）」。
 *
 * 三处兜底（都只做「静默切换」，不弹 HOME、不退进程）：
 * ① 原生 onCreate：按 cove_prefs/icon_current 恢复（WebView 加载前就就位）；
 * ② 原生 BootReceiver：收到 MY_PACKAGE_REPLACED（覆盖安装完成）时恢复；
 * ③ 本模块：网页装载后拿 IndexedDB 权威值对账一次——原生启用态与机主所选不一致时
 *    调 restoreAppIcon 切回（兼容没写过 SharedPreferences 的存量设备）。
 *
 * 纯网页/无桥环境全部静默 no-op。
 */

import { getNativeCurrentIcon, restoreNativeAppIcon } from './native-shell';
import { useSettings } from './store';

/** 把原生桌面图标对齐到网页里机主所选的图标（幂等；无桥/已一致时零动作） */
export function syncChosenAppIcon(): void {
  try {
    const chosen = useSettings.getState().appIcon;
    const current = getNativeCurrentIcon();
    if (!current || current === chosen) return;
    restoreNativeAppIcon(chosen);
  } catch {
    // 图标对账失败不影响主流程（下次启动再试）
  }
}
