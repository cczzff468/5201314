'use client';

import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Zap } from 'lucide-react';
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

/* ============ inside 模式电池（第三十六轮：SVG 重写——边框跟随实心胶囊）============
 * 第三十六轮按机主反馈重写（span 嵌套 → SVG，三处根修）：
 *  - 【边框跟随实心胶囊整体】：描边分段变色——实心胶囊覆盖段的描边=胶囊色
 *    （浅色黑/深色白），未覆盖的右段描边=灰色（40% 前景色）。实现：恒定灰描边
 *    垫底 + 「胶囊色描边」被 clipPath 按电量宽度裁切叠加——边框跟着胶囊走；
 *  - 【电量黑色时右面没有实心胶囊那就是灰色】：恒定灰描边即满足；凸点同为灰
 *    （凸点永在无胶囊的最右侧，跟随边框灰段）；
 *  - 【内部电量太圆了，整体大小一样】：填充=纯方角矩形全高（不再被大圆角壳
 *    裁腰缩端），边框圆角 5.2 → 3（保留柔和小圆角但不再吃掉填充端部高度）；
 *  - 沿用：充电不变绿/低电不变红（色恒定无状态分支）、方角填充、100% 四边贴满、
 *    凸点 2.5×5.5 + 1.5px 间隙、数字 10.5px bold 反色居中 + 柔和投影、
 *    26% 轨道底、充电数字侧小闪电。 */
const IOS_BAT_H = 14.5; // 本体高
const IOS_BAT_BODY_W = 28; // 本体宽
const IOS_BAT_RADIUS = 3; // 边框圆角（第三十六轮：5.2 → 3——「内部电量太圆了」；填充不再被裁腰）
const IOS_BAT_FILL_RADIUS = 4.2; // 填充圆角（第四十轮：3.2 → 4.2——机主再要「圆一点」，0→2.2→3.2→4.2 四档渐进；13.5px 内腔高下 4.2 仍保上下全高不裁腰、两端圆润接近胶囊)
const IOS_BAT_STROKE = 1; // 描边粗细（灰段/胶囊色段同粗）
const IOS_BAT_INNER_W = 27; // 描边内缘宽（28 - 0.5×2 描边位）
const IOS_BAT_INNER_H = 13.5; // 描边内缘高
const IOS_BAT_CAP_W = 2.5; // 正极凸点宽（第三十三轮：3.5 → 2.5，机主要求小一点点）
const IOS_BAT_CAP_H = 5.5; // 正极凸点高（第三十三轮：7 → 5.5）
const IOS_BAT_CAP_GAP = 1.5; // 本体↔凸点间隙（机主要求离开一点点）
const IOS_BAT_CAP_RADIUS = 1.6; // 凸点圆角（第三十四轮：随「更圆」口径同步微调）
const IOS_BAT_TOTAL_W = IOS_BAT_BODY_W + IOS_BAT_CAP_GAP + IOS_BAT_CAP_W; // 总宽 32

interface BatteryIconProps {
  level: number;
  charging: boolean;
  low: boolean;
  /** 电量百分比显示方式（v2.4.10）：outside=图标外部数字+% / inside=图标内部数字
   *  （第三十一轮：真实 iOS 16.1+ 实心胶囊重建）/ none=不显示 */
  mode: BatteryPercentMode;
  /** 状态栏前景是否浅色（白字）：inside 模式下胶囊为 currentColor——前景浅→白胶囊黑字、
 *  前景深→黑胶囊白字；其余颜色一律走 currentColor 自动适配 */
  light?: boolean;
}

/** 状态栏电池图标（v2.4.10 三模式，设置›电量百分比实时切换）：
 *  - outside：数字+% 在电池左侧（描边电池）
 *  - none：只有描边电池图标，无百分比
 *  - inside：真实 iOS 16.1+ 同款（第三十一轮删除重建）——28×14.5 实心圆润胶囊
 *    （1.93:1）整体填满不按电量比例，胶囊色=状态色（常态前景色/充电绿/低电红），
 *    百分比数字 9px semibold 几何居中反色镂空（黑底白字/白底黑字/彩底白字），
 *    充电时数字右侧白色小闪电；凸点紧贴本体（50% 高）同色实心。无 % 号。
 *  也导出给设置页做实时预览（预览传固定 level + light=false） */
export function BatteryIcon({ level, charging, low, mode, light = false }: BatteryIconProps) {
  const fill = Math.min(100, Math.max(0, level));
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, ''); // clipPath id 唯一化（状态栏/锁屏/设置预览多实例并存）

  if (mode === 'inside') {
    /* 第三十六轮（SVG 重写）：
     * - 【边框跟随实心胶囊整体】：恒定灰描边垫底 + 「胶囊色描边」被 clipPath
     *   按电量宽度裁切叠加——胶囊覆盖段边框=胶囊色、右段=灰色（边框跟胶囊走）；
     * - 【电量黑色时右面无胶囊就是灰色】：灰描边（40% 前景色）恒定；凸点同灰
     *   （永在无胶囊的最右侧）；
     * - 【内部电量太圆了/整体大小一样】：填充=方角矩形全高贴描边内缘（无裁腰），
     *   边框圆角 5.2 → 3 只作用于描边角，不再吃填充端部高度；
     * - 沿用：充电不变绿/低电不变红（色恒定）、100% 四边贴满、数字反色+投影、
     *   26% 轨道、充电数字侧小闪电。 */
    // 数字色 = 填充反色：前景浅→胶囊白→黑字，前景深→胶囊黑→白字（常态恒定，无状态色分支）
    const numColor = light ? '#000000' : '#FFFFFF';
    // 柔和投影：保证数字叠在半透明轨道上仍可读（反相光晕）
    const numHalo = light
      ? '0 0 2px rgba(255,255,255,0.55)'
      : '0 0 2px rgba(0,0,0,0.35)';
    // 恒定灰（描边右段/凸点）：黑胶囊（浅底）配 40% 黑灰；白胶囊（深底）配 40% 白灰
    const gray = light ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.40)';
    const digits = String(Math.round(level));
    // clip 宽度 = 电量比例 × 描边内缘宽（100% 覆盖全内缘；描边/填充 x 0.5 起 → clip 同步）
    const clipW = (IOS_BAT_INNER_W * fill) / 100;
    const clipId = `cove-bat-${uid}`;
    return (
      <span
        role="img"
        aria-label={`电量${Math.round(level)}%${charging ? '，充电中' : ''}`}
        className="battery-container relative inline-block shrink-0"
        style={{ width: IOS_BAT_TOTAL_W, height: IOS_BAT_H }}
      >
        {/* battery-body：SVG 胶囊壳（26% 轨道 + 恒灰描边 + 胶囊色层 clip 分段 + 凸点） */}
        <svg
          width={IOS_BAT_TOTAL_W}
          height={IOS_BAT_H}
          viewBox={`0 0 ${IOS_BAT_TOTAL_W} ${IOS_BAT_H}`}
          aria-hidden="true"
          className="battery-body block"
        >
          <defs>
            {/* 胶囊色描边/填充的裁切区：电量比例宽（边框跟随实心胶囊走） */}
            <clipPath id={clipId}>
              <rect x={IOS_BAT_STROKE / 2} y={0} width={clipW} height={IOS_BAT_H} />
            </clipPath>
          </defs>
          {/* 轨道：currentColor 26%（胶囊未覆盖段的灰底） */}
          <rect
            x={IOS_BAT_STROKE / 2}
            y={IOS_BAT_STROKE / 2}
            width={IOS_BAT_INNER_W}
            height={IOS_BAT_INNER_H}
            rx={IOS_BAT_RADIUS}
            fill="currentColor"
            fillOpacity={0.26}
          />
          {/* 恒定灰描边（右段——无实心胶囊处即灰；充电/低电不变色） */}
          <rect
            x={IOS_BAT_STROKE / 2}
            y={IOS_BAT_STROKE / 2}
            width={IOS_BAT_INNER_W}
            height={IOS_BAT_INNER_H}
            rx={IOS_BAT_RADIUS}
            fill="none"
            stroke={gray}
            strokeWidth={IOS_BAT_STROKE}
          />
          {/* 胶囊色层（clip 到电量宽度）：全高实心填充（第三十八轮：圆角 3.2——机主再要
              「圆一点点」，柔和中圆；宽度=clipW 精确到电比、左右两端同圆角）+ 同色描边——边框跟随实心胶囊 */}
          <g clipPath={`url(#${clipId})`}>
            {/* 实心填充：全高贴描边内缘（整体大小一样），中圆角 3.2（柔和不裁腰） */}
            <rect
              x={IOS_BAT_STROKE / 2}
              y={IOS_BAT_STROKE / 2}
              width={Math.max(clipW, 0.01)}
              height={IOS_BAT_INNER_H}
              rx={IOS_BAT_FILL_RADIUS}
              fill="currentColor"
            />
            {/* 胶囊色描边（与填充同色同圆角——覆盖灰描边段的左段） */}
            <rect
              x={IOS_BAT_STROKE / 2}
              y={IOS_BAT_STROKE / 2}
              width={IOS_BAT_INNER_W}
              height={IOS_BAT_INNER_H}
              rx={IOS_BAT_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth={IOS_BAT_STROKE}
            />
          </g>
          {/* battery-cap：右侧正极凸点（2.5×5.5；右缘圆角、离本体 1.5px；恒灰——跟随边框灰段） */}
          <rect
            x={IOS_BAT_BODY_W + IOS_BAT_CAP_GAP}
            y={(IOS_BAT_H - IOS_BAT_CAP_H) / 2}
            width={IOS_BAT_CAP_W}
            height={IOS_BAT_CAP_H}
            rx={IOS_BAT_CAP_RADIUS}
            ry={IOS_BAT_CAP_RADIUS}
            fill={gray}
          />
        </svg>
        {/* battery-text：居中大号粗体数字（反色 + 柔和投影；光学微左让出凸点） */}
        <span
          aria-hidden="true"
          className="battery-text absolute inset-y-0 left-0 flex -translate-x-[0.5px] items-center justify-center text-[10.5px] font-bold leading-none tabular-nums"
          style={{ width: IOS_BAT_BODY_W, color: numColor, textShadow: numHalo }}
        >
          {digits}
          {/* 充电小闪电（数字右侧、与数字同色同投影） */}
          {charging && (
            <svg
              viewBox="0 0 12 20"
              className="ml-[2px] h-[9px] w-[5.5px] fill-current"
              aria-hidden="true"
              style={{ filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.3))' }}
            >
              <path d="M7.5 1 2 11.5h3.2L4.5 19 10 8.2H6.6L7.5 1Z" />
            </svg>
          )}
        </span>
      </span>
    );
  }

  // outside / none：描边电池（第三十三轮：机主要求「外部/不显示变回原来的」——
  // 回退到第三十轮前的经典样式：40% 半透明细描边 + 比例填充 + 40% 半透明凸点）；
  // outside 在左侧带数字+%，none 只有图标
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
        {/* 外框（不随低电量变红；40% 半透明描边——回退原样式） */}
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
        {/* 正极凸点（40% 半透明同描边色——回退原样式） */}
        <span className="absolute -right-[3.5px] top-1/2 h-[4.5px] w-[2px] -translate-y-1/2 rounded-r-[1.5px] bg-current opacity-40" />
      </span>
    </span>
  );
}

/* ============ v2.4.12 电量详情弹窗（机主需求：点状态栏电池图标弹窗看电量）============
 * iOS 风格卡片（portal 到 body，不受状态栏 pointer-events-none / 层叠上下文限制）：
 * 状态徽标（充电中/电池供电/电量偏低）+ 大号百分比 + 小组件风格大电池条 + 尾注。
 * 行为：点空白处关、Esc 关、5.2s 自动关、入场 200ms 缩放淡入（右上角原点）。 */
function BatteryDetail({
  level,
  charging,
  low,
  onClose,
}: {
  level: number;
  charging: boolean;
  low: boolean;
  onClose: () => void;
}) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    const timer = window.setTimeout(onClose, 5200); // 自动关
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const pct = Math.round(Math.min(100, Math.max(0, level)));
  const tone = charging ? 'text-[#30D158]' : low ? 'text-[#FF453A]' : 'text-black/55 dark:text-white/55';

  return createPortal(
    <>
      {/* 全屏背板：点空白处关闭（portal 出了状态栏的 pointer-events-none 容器） */}
      <button
        type="button"
        aria-label="关闭电量详情"
        data-testid="battery-detail-backdrop"
        className="fixed inset-0 z-[300] cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={`电量详情 ${pct}%`}
        data-testid="battery-detail"
        className="pointer-events-auto fixed right-[10px] top-[58px] z-[310] w-[236px] rounded-[24px] border border-black/[0.07] bg-white/95 p-5 shadow-[0_16px_48px_rgba(0,0,0,0.22)] backdrop-blur-2xl transition-[opacity,transform] duration-200 ease-out dark:border-white/[0.09] dark:bg-zinc-900/[0.95] dark:shadow-[0_16px_48px_rgba(0,0,0,0.55)]"
        style={{
          opacity: entered ? 1 : 0,
          transform: entered ? 'translateY(0) scale(1)' : 'translateY(-6px) scale(0.94)',
          transformOrigin: 'top right',
        }}
      >
        {/* 状态徽标行 */}
        <div className={`flex items-center justify-center gap-[5px] text-[13px] font-semibold ${tone}`}>
          {charging && <Zap aria-hidden="true" className="h-[13px] w-[13px] fill-current" />}
          {charging ? '充电中' : low ? '电量偏低' : '电池供电'}
        </div>
        {/* 大号百分比 */}
        <div className="mt-1 text-center tabular-nums tracking-tight text-black dark:text-white">
          <span className="text-[46px] font-semibold leading-none">{pct}</span>
          <span className="ml-[2px] text-[20px] font-medium opacity-40">%</span>
        </div>
        {/* iOS 小组件风格大电池条（描边槽+填充+右凸点，同款配色规则） */}
        <div className="mt-[14px] flex items-center justify-center">
          <span className="relative flex items-center">
            <span className="relative block h-[13px] w-[168px] overflow-hidden rounded-[4px] border-[1.5px] border-black/25 bg-black/[0.05] dark:border-white/40 dark:bg-white/[0.12]">
              <span
                className={`absolute inset-y-[1.5px] left-[1.5px] rounded-[2px] transition-all duration-500 ${
                  charging ? 'bg-[#30D158]' : low ? 'bg-[#FF453A]' : 'bg-black dark:bg-white'
                }`}
                style={{ width: `calc((100% - 3px) * ${pct / 100})` }}
              />
            </span>
            <span aria-hidden="true" className="ml-[2px] h-[6px] w-[2px] rounded-[1px] bg-black/25 dark:bg-white/40" />
          </span>
        </div>
        {/* 尾注 */}
        <p className="mt-[13px] text-center text-[11.5px] leading-relaxed text-black/45 dark:text-white/45">
          {low && !charging ? '电量不足 20%，建议尽快连接充电器' : '设备真实电量 · 轻点空白处关闭'}
        </p>
      </div>
    </>,
    document.body
  );
}

/**
 * 1:1 仿 iOS 状态栏：左侧实时时间（每秒刷新，24 小时制），右侧信号/WiFi/真实电量。
 * 电量使用 Battery Status API（@/lib/ios/battery），低于 20% 仅电量填充变红（百分比与外框不变色）。
 * 文字颜色由 useLightForeground 判定（默认按背景顶部区域实测明暗，与 Home 横杠同一套逻辑但区域不同）。
 *
 * v2.4.12：点按电池图标弹出 iOS 风格「电量详情」卡片（大号百分比+电池条+充电状态），
 * 点空白处/5 秒自动/Esc 均可关闭——inside 模式数字小，弹窗给出精确电量。
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
  // v2.4.12 电量详情弹窗开关（点状态栏电池图标）
  const [batteryOpen, setBatteryOpen] = useState(false);
  const closeBatteryDetail = useCallback(() => setBatteryOpen(false), []);

  const now = clockSecond > 0 ? new Date(clockSecond * 1000) : null;
  const level = battery?.level ?? 100;
  const low = level < 20 && !battery?.charging;

  return (
    <div
      className={`ph-statusbar pointer-events-none absolute inset-x-0 top-0 z-[70] flex h-[54px] items-center justify-between pb-[12px] pl-[24px] pr-[13px] pt-[4px] text-[15px] font-semibold ${
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
            v2.4.10 三模式：outside=数字+% 在外 / inside=数字嵌电池内（第二十九轮真实 iOS 16.1+ 同款） / none=无百分比。
            v2.4.12 点按弹出电量详情卡（pointer-events-auto 打通状态栏点击；命中区上下扩 9px 便于点按） */}
        <button
          type="button"
          aria-label={`电量 ${Math.round(level)}%，点按查看电量详情`}
          aria-haspopup="dialog"
          aria-expanded={batteryOpen}
          data-testid="statusbar-battery"
          onClick={() => setBatteryOpen((v) => !v)}
          className="pointer-events-auto flex cursor-pointer select-none items-center rounded-lg py-[9px] outline-none transition-opacity duration-150 active:opacity-55 focus-visible:ring-2 focus-visible:ring-current/60"
        >
          <BatteryIcon level={level} charging={battery?.charging ?? false} low={low} mode={batteryPercent} light={lightText} />
        </button>
      </div>
      {/* 电量详情弹窗（portal 到 body；任意电量百分比模式下都可点看精确电量） */}
      {batteryOpen && (
        <BatteryDetail level={level} charging={battery?.charging ?? false} low={low} onClose={closeBatteryDetail} />
      )}
    </div>
  );
}
