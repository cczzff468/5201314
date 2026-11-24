'use client';

import { useSyncExternalStore } from 'react';
import { formatIOSTime } from '@/lib/ios/clock';
import { useBattery } from '@/lib/ios/battery';
import { useLightForeground } from '@/lib/ios/foreground';
import { useSettings, type BatteryPercentMode } from '@/lib/ios/store';
// 性能：音乐岛可见性走微型 flag store（StatusBar 是首屏静态组件，不把 music-store+music-api
// 千行级模块拖进首屏 bundle；MusicIsland 写入时双写同步）
import { useMusicIslandVisible } from '@/lib/ios/music-island-flag';
import { useMtIsland } from '@/lib/ios/mt-island-store';
import { useTbIsland } from '@/lib/ios/tb-island-store';

function SignalBars() {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor" aria-hidden="true">
      <rect x="0" y="8" width="3" height="4" rx="1" />
      <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
      <rect x="10" y="3" width="3" height="9" rx="1" />
      <rect x="15" y="0.5" width="3" height="11.5" rx="1" />
    </svg>
  );
}

interface BatteryIconProps {
  level: number;
  charging: boolean;
  low: boolean;
  /** 电量百分比显示方式（v2.4.10）：outside=图标外部数字+% / inside=图标内部数字
   * （iOS 16+ 风格：纯填充块、数字嵌电池内、无 % 号）/ none=不显示百分比 */
  mode: BatteryPercentMode;
  /** 状态栏前景是否浅色（白字）：决定 inside 模式里嵌入数字用反色（黑）保证对比；
 *  外部/描边样式不受影响（跟随 currentColor） */
  light?: boolean;
}

/** 状态栏电池图标（v2.4.10 三模式，设置›电量百分比实时切换）：
 *  - outside：数字+% 在电池左侧（默认/现行样式，描边电池）
 *  - none：只有描边电池图标，无百分比
 *  - inside：iOS 16+ 同款（用户参考图）：纯填充块无描边，左侧充入部分前景色/
 *    充电绿/低电红，其余半透明轨道，数字（无 % 号）嵌在电池内反色居中，右侧浅灰凸点。
 *  也导出给设置页做实时预览（预览传固定 level + light=false） */
export function BatteryIcon({ level, charging, low, mode, light = false }: BatteryIconProps) {
  const fill = Math.min(100, Math.max(0, level));

  if (mode === 'inside') {
    // iOS 16+ 内嵌式：无描边纯填充；数字反前景色（浅色状态栏→黑字，深色→白字）
    const numColor = light ? 'text-black' : 'text-white';
    return (
      <span
        role="img"
        aria-label={`电量${Math.round(level)}%${charging ? '，充电中' : ''}`}
        className="relative inline-block h-[14px] w-[37px] shrink-0"
      >
        {/* 电池本体轨道（未充入部分）：半透明前景色（浅底=浅灰、深底=暗灰，随状态栏主题） */}
        <span className="absolute inset-0 rounded-[4.5px] bg-current opacity-[0.32]" />
        {/* 充入电量：充电绿 / 低电红 / 前景色（充电与低电时数字保持反色可读） */}
        <span
          className={`absolute inset-y-0 left-0 rounded-[4.5px] transition-all duration-300 ${
            charging ? 'bg-[#30D158]' : low ? 'bg-[#FF453A]' : 'bg-current'
          }`}
          style={{ width: `${fill}%` }}
        />
        {/* 嵌入数字（无 % 号，几何居中——参考图实测口径） */}
        <span
          className={`absolute inset-0 flex items-center justify-center text-[8.5px] font-semibold leading-none tabular-nums ${numColor}`}
        >
          {Math.round(level)}
        </span>
        {/* 正极凸点（与轨道同色调） */}
        <span className="absolute -right-[3px] top-1/2 h-[5px] w-[2px] -translate-y-1/2 rounded-r-[1.5px] bg-current opacity-40" />
      </span>
    );
  }

  // outside / none：描边电池（现行样式）；outside 在左侧带数字+%，none 只有图标
  return (
    <span
      role="img"
      aria-label={`电量${Math.round(level)}%${charging ? '，充电中' : ''}`}
      className="flex items-center gap-[3px]"
    >
      {mode === 'outside' && (
        <span className="text-[12px] font-semibold tabular-nums">{Math.round(level)}%</span>
      )}
      <span className="relative inline-block h-[12.5px] w-[25px]">
        {/* 外框（不随低电量变红） */}
        <span className="absolute inset-0 rounded-[4.5px] border-[1.2px] border-current opacity-40" />
        {/* 电量填充：低电量时仅填充变红，百分比与外框保持前景色（用户要求） */}
        <span
          className={`absolute bottom-[1.8px] left-[1.8px] top-[1.8px] rounded-[2.5px] transition-all duration-300 ${
            charging ? 'bg-[#30D158]' : low ? 'bg-[#FF453A]' : 'bg-current'
          }`}
          style={{ width: `calc((100% - 3.6px) * ${fill / 100})` }}
        />
        {/* 充电闪电 */}
        {charging && (
          <svg
            viewBox="0 0 12 20"
            className="absolute left-1/2 top-1/2 h-[11px] w-[7px] -translate-x-1/2 -translate-y-1/2 fill-white drop-shadow-[0_0_1px_rgba(0,0,0,0.4)]"
            aria-hidden="true"
          >
            <path d="M7.5 1 2 11.5h3.2L4.5 19 10 8.2H6.6L7.5 1Z" />
          </svg>
        )}
        {/* 正极凸点 */}
        <span className="absolute -right-[3.5px] top-1/2 h-[4.5px] w-[2px] -translate-y-1/2 rounded-r-[1.5px] bg-current opacity-40" />
      </span>
    </span>
  );
}

/**
 * 1:1 仿 iOS 状态栏：左侧实时时间（每秒刷新，24 小时制），右侧信号/WiFi/真实电量。
 * 电量使用 Battery Status API（@/lib/ios/battery），低于 20% 仅电量填充变红（百分比与外框不变色）。
 * 文字颜色由 useLightForeground 判定（默认按背景顶部区域实测明暗，与 Home 横杠同一套逻辑但区域不同）。
 *
 * 第二十三轮反馈：灵动岛音乐弹窗（小/大）可见期间，只有「移动数据」（信号）图标消失，
 * WiFi/电量保留（真机 iOS 灵动岛同语义）；弹窗消失后图标恢复。
 * 最新反馈：美团外卖配送小窗可见期间，WiFi 图标也要跟着隐藏（对齐真机灵动岛占位后的
 * 状态栏收紧效果），信号/WiFi 同时消失，仅保留电量；小窗消失后两个图标一同恢复。
 * 可见性由 MusicIsland 写入 music-store.islandVisible（美团/淘宝岛同读）+ music-island-flag
 * 微型 store（本组件只读后者），不重复维护口径。
 */
export default function StatusBar() {
  const clockSecond = useSyncExternalStore(
    (onChange) => {
      const timer = window.setInterval(onChange, 1000);
      return () => window.clearInterval(timer);
    },
    () => Math.floor(Date.now() / 1000),
    () => 0
  );
  const battery = useBattery();
  const lightText = useLightForeground();
  // v2.4.10 电量百分比显示方式（设置›电量百分比三选一，实时跟随）
  const batteryPercent = useSettings((s) => s.batteryPercent);
  const musicIslandVisible = useMusicIslandVisible();
  const mtIslandVisible = useMtIsland((s) => s.visible);
  const tbIslandVisible = useTbIsland((s) => s.visible);
  // 音乐灵动岛：仅隐藏信号（第二十三轮口径）；美团/淘宝配送灵动岛：信号 + WiFi 一起隐藏，仅保留电量（最新反馈）
  const hideSignal = musicIslandVisible || mtIslandVisible || tbIslandVisible;
  const hideWifi = mtIslandVisible || tbIslandVisible;

  const now = clockSecond > 0 ? new Date(clockSecond * 1000) : null;
  const level = battery?.level ?? 100;
  const low = level < 20 && !battery?.charging;

  return (
    <div
      className={`ph-statusbar pointer-events-none absolute inset-x-0 top-0 z-[70] flex h-[54px] items-center justify-between pl-[30px] pr-[13px] pt-[6px] text-[15px] font-semibold ${
        lightText ? 'text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.25)]' : 'text-black'
      }`}
      aria-label="状态栏"
    >
      <time className="w-[70px] leading-none tabular-nums tracking-tight">{now ? formatIOSTime(now) : ''}</time>
      <div className="flex items-center gap-[4px] leading-none">
        {/* 移动数据（信号）：任一灵动岛弹窗可见时隐藏，弹窗消失后恢复 */}
        {!hideSignal && <SignalBars />}
        {/* WiFi（加大版）：美团外卖灵动岛小窗/大窗可见期间随信号一起隐藏（真机灵动岛同语义），其余时刻常驻 */}
        {!hideWifi && (
        <svg width="21" height="16" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true" className="relative -top-[1.5px]">
          <path d="M8 9.6a1.7 1.7 0 0 1 1.7 1.7c0 .3-.5.7-1.7.7s-1.7-.4-1.7-.7A1.7 1.7 0 0 1 8 9.6Z" />
          <path d="M8 5.9c1.5 0 2.9.6 3.9 1.6l-1.3 1.3a3.7 3.7 0 0 0-5.2 0L4.1 7.5A5.5 5.5 0 0 1 8 5.9Z" />
          <path d="M8 2.2c2.5 0 4.8 1 6.5 2.7l-1.3 1.3A7.3 7.3 0 0 0 8 4a7.3 7.3 0 0 0-5.2 2.2L1.5 4.9A9.2 9.2 0 0 1 8 2.2Z" />
        </svg>
        )}
        {/* 电量图标常驻（未就绪时按 100% 绘制；缓存已在首帧绘制前同步恢复，不再闪断）。
            v2.4.10 三模式：outside=数字+% 在外 / inside=数字嵌电池内（iOS 16+） / none=无百分比 */}
        <BatteryIcon level={level} charging={battery?.charging ?? false} low={low} mode={batteryPercent} light={lightText} />
      </div>
    </div>
  );
}
