'use client';

import { useMemo } from 'react';
import {
  useSettings,
  useSystemDark,
  useUI,
  useMeasuredWallpaperLight,
  resolveWallpaperStyle,
  WALLPAPER_PRESETS,
  type AppId,
} from '@/lib/ios/store';
import { useStatusBarTone } from './status-bar-tone';

/** 与 registry 各 App 声明的 statusBarLight 保持一致（内联小表，避免为取一个布尔值把整个 App 注册表拉进首屏包） */
const APP_STATUS_BAR_LIGHT: Partial<Record<AppId, boolean>> = {
  weather: true, // 全屏蓝天渐变
  camera: true, // 黑底取景器
};

/**
 * 前景明暗（状态栏文字 / 底部 Home 横杠共用的同一套判定）：
 * 返回 true = 身后背景偏深，用白色前景；false = 背景偏浅，用黑色前景。
 * region：'top' = 顶部区域（状态栏），'bottom' = 底部区域（Home 横杠）；
 * 壁纸明暗按区域实测（上亮下暗的壁纸两端可分别选黑/白），App 前台等非壁纸场景两区域同值。
 *
 * 判定优先级：
 * 1. App 前台：App 声明的 statusBarLight（天气蓝天/相机黑底）优先，否则随主题深浅；
 *    多任务切换器盖在 App 上时除外——身后是毛玻璃（≈壁纸），状态栏改随壁纸明暗；
 * 2. 锁屏手电筒补光（全屏白）：强制黑前景；
 * 3. 闹钟响铃弹层（背景色）：随主题深浅；
 * 4. 锁屏 / 主屏幕：跟随身后壁纸明暗（锁屏壁纸完全独立，锁屏永远用锁屏壁纸）；
 *    明暗不再只看预设静态标记 —— 壁纸亮度实测（图片缩到 32×32 取均值 / 渐变解析色值），
 *    自定义浅色壁纸也会自动改用黑前景；测量中回退静态标记。
 *    锁屏直达相机（纯黑）强制白前景。
 *
 * 之前横杠用 mix-blend-difference，在饱和色背景上会呈现互补色（如蓝天→橙杠），
 * 改为按背景明暗直接选黑/白，观感与 iOS 一致。
 */
export function useLightForeground(region: 'top' | 'bottom' = 'top'): boolean {
  const activeApp = useUI((s) => s.activeApp);
  const switcherOpen = useUI((s) => s.switcherOpen);
  const lockCameraOpen = useUI((s) => s.lockCameraOpen);
  const locked = useUI((s) => s.locked);
  const torchOpen = useUI((s) => s.torchOpen);
  const alarmRinging = useUI((s) => s.alarmRinging);
  const callActive = useUI((s) => s.callActive);
  const theme = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const wallpaperPreset = useSettings((s) => s.wallpaperPreset);
  const customWallpaperUrl = useSettings((s) => s.customWallpaperUrl);
  // 锁屏壁纸完全独立，锁屏时前景颜色始终跟随锁屏壁纸
  const lockWallpaperPreset = useSettings((s) => s.lockWallpaperPreset);
  const lockCustomWallpaperUrl = useSettings((s) => s.lockCustomWallpaperUrl);

  const dark = theme === 'auto' ? systemDark : theme === 'dark';

  // 壁纸明暗：静态标记兜底 + 实测亮度。hooks 必须无条件调用，故先算好再走分支
  const onLock = locked;
  const effPresetId = onLock ? lockWallpaperPreset : wallpaperPreset;
  const effCustom = onLock ? lockCustomWallpaperUrl : customWallpaperUrl;
  const effStyle = useMemo(
    () => resolveWallpaperStyle(effPresetId, effCustom),
    [effPresetId, effCustom]
  );
  const measured = useMeasuredWallpaperLight(effStyle);
  const preset = WALLPAPER_PRESETS.find((w) => w.id === effPresetId);
  const staticLight = !effCustom && (preset?.light ?? false);
  const lightWallpaper = (region === 'top' ? measured.top : measured.bottom) ?? staticLight;
  // 屏幕级实时基调（第三十三轮）：最上层页面自己声明的背景明暗（如音乐 App 白底页/深色播放页切换）
  const toneOverride = useStatusBarTone();

  if (callActive) return true; // 电话通话全屏层（深色渐变，盖在 App 上）→ 白前景
  if (activeApp && !switcherOpen) {
    // 屏幕级基调最优先（锁屏时页面虽仍挂载但状态栏在锁屏壁纸上，基调不越界）；
    // 无覆盖时回落 App 静态声明/主题
    if (toneOverride && !locked) return toneOverride === 'light';
    return APP_STATUS_BAR_LIGHT[activeApp] ?? dark;
  }
  if (torchOpen) return false; // 全屏白 → 黑前景
  if (alarmRinging) return dark; // 响铃弹层为背景色 → 随主题
  // 锁屏（无 App 前台）时永远用锁屏壁纸（锁屏壁纸已完全独立），其余用主屏壁纸
  return !lightWallpaper || lockCameraOpen;
}

/**
 * 主屏壁纸整体亮度（true = 壁纸偏浅 → 图标标签/页点等主屏元素用深色）：
 * 图标网格与页点分布在整块主屏，不用锁屏那种顶/底分区，取整体平均亮度实测；
 * 测量中（图片解码前）回退预设静态标记（自定义壁纸视为深色壁纸 → 白字，与状态栏兜底一致）。
 */
export function useHomeWallpaperLight(): boolean {
  const wallpaperPreset = useSettings((s) => s.wallpaperPreset);
  const customWallpaperUrl = useSettings((s) => s.customWallpaperUrl);
  const style = useMemo(
    () => resolveWallpaperStyle(wallpaperPreset, customWallpaperUrl),
    [customWallpaperUrl, wallpaperPreset]
  );
  const measured = useMeasuredWallpaperLight(style);
  const preset = WALLPAPER_PRESETS.find((w) => w.id === wallpaperPreset);
  return measured.all ?? (!customWallpaperUrl && (preset?.light ?? false));
}
