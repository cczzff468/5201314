'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, CloudSun, Flashlight, FlashlightOff } from 'lucide-react';
import { useSettings, useUI, useLockWallpaper, useMeasuredWallpaperLight } from '@/lib/ios/store';
import { formatLunarDate, formatSolarShort } from '@/lib/ios/lunar';
import { formatIOSTime, useNow } from '@/lib/ios/clock';
import { useBattery } from '@/lib/ios/battery';
import { enableHardwareTorch, disableHardwareTorch } from '@/lib/ios/hardware-torch';
import { weatherCodeInfo, useWeatherSnapshot } from '@/components/apps/weather-core';
import PasscodePad from './PasscodePad';
import { CustomWallpaperLayers } from './WallpaperLayers';

// 锁屏直达相机：相机 App 懒加载（点开锁屏相机时才拉取，不拖累首屏）
const CameraApp = dynamic(() => import('@/components/apps/camera'), { ssr: false });

/** 周短格式（模块级缓存，避免每秒新建 Intl.DateTimeFormat） */
const WEEK_FMT = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' });

/**
 * 锁屏（仿 iOS）：
 * - 日期（含农历）+ 超大时钟 + 「×××的iPhone」电量 / 天气 / 日期小组件；
 * - 上滑解锁：未设密码直接解锁，已设密码进入密码键盘；
 * - 手电筒（优先系统硬件闪光灯 Web Torch API，设备不支持时回退白屏补光模拟）与相机快捷入口（锁屏直达相机，不解锁，关闭相机回锁屏）；
 * - 密码验证失败抖动 + 提示，验证通过播放解锁退场动画（由 PhoneShell 的 AnimatePresence 播放）。
 */
export default function LockScreen() {
  const lockConfig = useSettings((s) => s.lockConfig);
  const applyLockConfig = useSettings((s) => s.applyLockConfig);
  const profileName = useSettings((s) => s.profile.name).trim();
  const unlock = useUI((s) => s.unlock);
  const lockCameraOpen = useUI((s) => s.lockCameraOpen);
  const setLockCameraOpen = useUI((s) => s.setLockCameraOpen);
  // 手电筒补光放全局 store：全屏白时前景（状态栏/横杠）需转黑
  const torch = useUI((s) => s.torchOpen);
  const setTorch = useUI((s) => s.setTorchOpen);
  // 手电筒当前形态：idle=硬件请求中；hw=系统闪光灯点亮成功；fallback=不支持硬件→白屏补光回退
  const [torchMode, setTorchMode] = useState<'idle' | 'hw' | 'fallback'>('idle');
  // hw 胶囊提示可见性（显示 1.8s 后自动淡出）
  const [hwPillVisible, setHwPillVisible] = useState(false);

  const now = useNow();
  const battery = useBattery();
  // 锁屏壁纸（主题里可独立设置，未设置时跟随主屏幕）
  const { style: wallpaperStyle, light: presetLight } = useLockWallpaper();
  // 锁屏自定义壁纸 URL：双层绘制用（与主屏同款防裁切策略）
  const lockCustomUrl = useSettings((s) => s.lockCustomWallpaperUrl);

  const [mode, setMode] = useState<'lock' | 'passcode' | 'resetNew' | 'resetConfirm'>('lock');
  const [errText, setErrText] = useState('');
  const [errSignal, setErrSignal] = useState(0);
  /** 忘记密码重设流程中第一次输入的新密码 */
  const [resetCode, setResetCode] = useState('');
  // #58：连续输错锁定（仿 iOS 真机——5 次后 1 分钟）。failCount 仅累计密码错误，
  // 解锁成功/进入重设流程均清零；锁定到期后自动放行（用 Date.now() 推算，无需额外定时器）。
  const MAX_FAILS = 5;
  const LOCK_MS = 60 * 1000;
  const [failCount, setFailCount] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const lockedOut = lockUntil > Date.now();
  const lockRemaining = lockedOut ? Math.ceil((lockUntil - Date.now()) / 1000) : 0;

  // 上滑手势（ref 供事件处理器同步读取，state 供渲染）
  const [dy, setDy] = useState(0);
  const dyRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const startY = useRef(0);

  // 壁纸亮度决定前景色：分区域实测壁纸亮度（顶部 0–35% 管状态栏/日期/时钟/小组件，
  // 底部 86–100% 管上滑提示/快捷按钮）——「上亮下暗」的壁纸（如雾山）两端分别选黑/白字，
  // 测量中或失败时回退预设静态标记；自定义壁纸同样实测，浅色图自动改用黑字
  const measured = useMeasuredWallpaperLight(wallpaperStyle);
  const lightWallpaper = measured.top ?? presetLight;
  const lightWallpaperBottom = measured.bottom ?? presetLight;
  const lightText = !lightWallpaper;
  const lightTextBottom = !lightWallpaperBottom;
  const fg = lightText ? 'text-white' : 'text-black/85';
  const widgetBg = lightText ? 'bg-white/45' : 'bg-white/15 backdrop-blur-md';
  const quickBtn = `flex h-[50px] w-[50px] items-center justify-center rounded-full backdrop-blur-md transition active:scale-90 ${
    lightTextBottom ? 'bg-white/45 text-black/80 active:bg-white/60' : 'bg-white/20 text-white active:bg-white/35'
  }`;

  // 下一个即将响铃的闹钟已随闹钟小组件移除；天气快照供天气小组件使用
  const weather = useWeatherSnapshot();
  const wInfo = weather ? weatherCodeInfo(weather.current.code) : null;
  const WeatherIcon = wInfo?.Icon;
  const wTemp = weather ? `${Math.round(weather.current.temperature)}°` : '--°';
  /** 锁屏设备名：个人信息名字 + 的iPhone（名字来自设置-个人信息） */
  const deviceName = profileName ? `${profileName}的iPhone` : 'iPhone';
  // 日期行含农历换算：直接计算，React Compiler 会按真实依赖自动记忆化
  const dateLine = now ? `${formatSolarShort(now)} · ${formatLunarDate(now)}` : '';
  const weekShort = now ? WEEK_FMT.format(now) : '';

  // #58：锁定到期自动清理提示文案。useNow 每秒驱动重渲染，到期瞬间落到 0 + 清掉旧 errText。
  useEffect(() => {
    if (lockUntil > 0 && Date.now() >= lockUntil) {
      setLockUntil(0);
      setErrText('');
    }
  }, [lockUntil, now]);

  // 手电筒开关 → 硬件闪光灯优先：开启时先复位形态再请求 Torch API（成功→hw，失败→白屏补光回退）；
  // 关闭时停掉相机流（闪光灯随流熄灭）并复位。enableHardwareTorch 内部已吞所有错误，catch 仅双保险
  useEffect(() => {
    if (torch) {
      setTorchMode('idle');
      void enableHardwareTorch()
        .then((r) => setTorchMode(r.ok ? 'hw' : 'fallback'))
        .catch(() => setTorchMode('fallback'));
    } else {
      disableHardwareTorch();
      setTorchMode('idle');
    }
  }, [torch]);

  // 卸载（解锁）即熄灯：硬件闪光灯由常驻相机流维持，解锁后锁屏 UI 消失、前台再无开关可关，
  // LED 会一直亮着；故 LockScreen 卸载时强制停流 + 复位 store，宁可重开一次也不留常亮灯
  useEffect(() => {
    return () => {
      disableHardwareTorch();
      setTorch(false);
    };
  }, [setTorch]);

  // hw 胶囊提示：torchMode 进入 hw 时显示，1.8s 后自动淡出（离开 hw / 卸载时清定时器并隐藏）
  useEffect(() => {
    if (torchMode !== 'hw') {
      setHwPillVisible(false);
      return;
    }
    setHwPillVisible(true);
    const timer = window.setTimeout(() => setHwPillVisible(false), 1800);
    return () => window.clearTimeout(timer);
  }, [torchMode]);

  // ---------------- 上滑解锁手势 ----------------

  const setDyBoth = (v: number) => {
    dyRef.current = v;
    setDy(v);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'lock') return;
    if ((e.target as HTMLElement).closest('button')) return;
    draggingRef.current = true;
    setIsDragging(true);
    startY.current = e.clientY;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const d = e.clientY - startY.current;
    setDyBoth(d < 0 ? d : d * 0.28);
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    const v = dyRef.current;
    if (v < -110) {
      if (lockConfig.enabled && lockConfig.code) {
        setDyBoth(0);
        setMode('passcode');
      } else {
        // 解锁：保留当前拖拽位移，不回弹；退场动画从手指离开的位置继续上滑，
        // 避免先弹回原位再淡出造成的“主屏一闪而过”撕裂感
        unlock();
      }
    } else {
      setDyBoth(0);
    }
  };

  // ---------------- 密码验证 / 忘记密码重设 ----------------

  const verify = (code: string) => {
    // #58：锁定中直接忽略输入（键盘按钮也已 disabled，这里是双保险）。
    if (lockUntil > Date.now()) return;
    if (code === lockConfig.code) {
      setErrText('');
      setFailCount(0);
      setLockUntil(0);
      setMode('lock');
      try {
        navigator.vibrate?.(10);
      } catch {
        /* 震动不可用 */
      }
      unlock();
    } else {
      const next = failCount + 1;
      setFailCount(next);
      setErrSignal((s) => s + 1);
      try {
        navigator.vibrate?.([60, 40, 60]);
      } catch {
        /* 震动不可用 */
      }
      if (next >= MAX_FAILS) {
        // 累计达到 MAX_FAILS 次错误：锁定 1 分钟，期间禁用输入并显示倒计时。
        setLockUntil(Date.now() + LOCK_MS);
        setFailCount(0);
        setErrText('密码错误次数过多，请 1 分钟后再试');
      } else {
        setErrText(`密码错误，请重试（剩 ${MAX_FAILS - next} 次）`);
      }
    }
  };

  const onPadComplete = (code: string) => {
    if (mode === 'resetNew') {
      setResetCode(code);
      setErrText('');
      setMode('resetConfirm');
    } else if (mode === 'resetConfirm') {
      if (code === resetCode) {
        // 新密码生效并直接解锁
        applyLockConfig({ ...lockConfig, enabled: true, code });
        setResetCode('');
        setErrText('');
        setMode('lock');
        try {
          navigator.vibrate?.(10);
        } catch {
          /* 震动不可用 */
        }
        unlock();
      } else {
        setResetCode('');
        setMode('resetNew');
        setErrSignal((s) => s + 1);
        setErrText('两次输入不一致，请重新设置');
        try {
          navigator.vibrate?.([60, 40, 60]);
        } catch {
          /* 震动不可用 */
        }
      }
    } else {
      verify(code);
    }
  };

  const openForgot = () => {
    setResetCode('');
    setErrText('');
    setMode('resetNew');
  };

  const cancelPad = () => {
    // 密码/重设页取消：重设中回密码页，密码页回锁屏
    setMode((m) => (m === 'passcode' ? 'lock' : 'passcode'));
    setResetCode('');
    setErrText('');
  };

  const padTitle = mode === 'passcode' ? '输入密码' : mode === 'resetNew' ? '重设密码' : '再输入一次';

  const batteryLevel = battery ? Math.round(battery.level) : null;
  const lowBattery = battery !== null && battery.level < 20 && !battery.charging;

  return (
    <motion.div
      className="absolute inset-0 z-[65] select-none overflow-hidden"
      style={{ touchAction: 'none' }}
      // 解锁退场：从当前位置继续上滑并淡出（与拖拽手势无缝衔接）
      exit={{ y: -420, opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
      role="dialog"
      aria-label="锁屏"
    >
      {/* 锁屏自绘壁纸层（盖住主屏幕，只透出壁纸）。
          自定义壁纸绘制与主屏 PhoneShell 同用 CustomWallpaperLayers（D6 边缘色延伸带，详见彼处）；
          预设单层 cover */}
      {lockCustomUrl ? (
        <CustomWallpaperLayers url={lockCustomUrl} />
      ) : (
        <div className="absolute -inset-[2px]" style={wallpaperStyle} aria-hidden="true" />
      )}

      {/* initial={false}：冷启动首挂载不走入场淡入（否则刚打开网页时钟/小组件会「闪一下」才浮现）；
          之后锁屏 ↔ 密码键盘切换仍照常播淡入淡出 */}
      <AnimatePresence mode="wait" initial={false}>
        {mode === 'lock' ? (
          <motion.div
            key="lock"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.2 }}
          >
            {/* 可拖拽内容层 */}
            <div
              className={`absolute inset-0 flex flex-col ${fg}`}
              style={{
                transform: `translateY(${dy}px)`,
                opacity: Math.max(0.3, 1 + Math.min(0, dy) / 420),
                transition: isDragging
                  ? 'none'
                  : 'transform 0.32s cubic-bezier(0.32,0.72,0,1), opacity 0.32s ease',
              }}
            >
              {/* 日期 + 农历 + 大时钟 */}
              <div className="flex flex-col items-center px-6 pt-[84px]">
                {dateLine && <p className="text-center text-[17px] font-semibold tracking-wide opacity-95">{dateLine}</p>}
                <p
                  className="mt-1 text-center text-[88px] font-semibold leading-[1.05] tracking-[-0.02em] tabular-nums"
                  style={lightText ? { textShadow: '0 2px 18px rgba(0,0,0,0.15)' } : undefined}
                >
                  {now ? formatIOSTime(now) : ''}
                </p>
              </div>

              {/* 锁屏小组件：×××的iPhone（电量）/ 天气 / 日期（小巧版） */}
              <div className="mt-6 flex items-center justify-center gap-2.5 px-6">
                <div className={`flex h-[64px] w-[118px] flex-col justify-between rounded-[22px] px-3 py-2.5 ${widgetBg}`}>
                  <div className="flex min-w-0 items-center">
                    <span className="min-w-0 truncate text-[11px] font-semibold">{deviceName}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold tabular-nums">
                      {batteryLevel === null ? '--' : `${batteryLevel}%`}
                    </span>
                    <div className={`h-[4px] min-w-0 flex-1 overflow-hidden rounded-full ${lightText ? 'bg-black/15' : 'bg-white/25'}`}>
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${
                          lowBattery ? 'bg-[#FF453A]' : lightText ? 'bg-black/70' : 'bg-white/90'
                        }`}
                        style={{ width: `${batteryLevel === null ? 0 : Math.min(100, Math.max(2, batteryLevel))}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className={`flex h-[64px] w-[64px] flex-col items-center justify-center gap-1 rounded-full ${widgetBg}`} aria-label="锁屏天气">
                  {WeatherIcon ? (
                    <WeatherIcon className="h-[18px] w-[18px]" strokeWidth={2} />
                  ) : (
                    <CloudSun className="h-[18px] w-[18px] opacity-60" strokeWidth={2} />
                  )}
                  <span className="text-[12px] font-semibold tabular-nums">{wTemp}</span>
                </div>
                {/* 日期小组件（iOS 日历风：白底红字） */}
                <div
                  className="flex h-[64px] w-[64px] flex-col items-center justify-center gap-[3px] rounded-full bg-white shadow-[0_5px_14px_rgba(0,0,0,0.2)]"
                  aria-label="锁屏日期"
                >
                  <span className="text-[22px] font-semibold leading-none tabular-nums text-[#FF453A]">
                    {now ? now.getDate() : '--'}
                  </span>
                  <span className="text-[11px] font-medium leading-none text-black/70">{weekShort || '周--'}</span>
                </div>
              </div>

              <div className="flex-1" />

              {/* 底部快捷入口 + 提示 + Home 指示条（颜色跟底部区域壁纸明暗） */}
              <p
                className={`pb-4 text-center text-[13px] font-medium opacity-70 ${
                  lightTextBottom ? 'text-white' : 'text-black/80'
                }`}
              >
                向上轻扫以解锁
              </p>
              <div className="flex items-center justify-between px-12 pb-[58px]">
                <button
                  type="button"
                  aria-label={torch ? '关闭锁屏手电筒' : '打开锁屏手电筒'}
                  aria-pressed={torch}
                  onClick={() => setTorch(!torch)}
                  className={torch ? 'flex h-[50px] w-[50px] items-center justify-center rounded-full bg-white text-black transition active:scale-90' : quickBtn}
                >
                  <Flashlight className="h-[22px] w-[22px]" strokeWidth={1.9} />
                </button>
                <button
                  type="button"
                  aria-label="锁屏相机"
                  onClick={() => setLockCameraOpen(true)}
                  className={quickBtn}
                >
                  <Camera className="h-[22px] w-[22px]" strokeWidth={1.9} />
                </button>
              </div>
            </div>

            {/* 硬件闪光灯点亮成功的轻提示：白玻璃小胶囊悬于时钟下方，1.8s 自动淡出。
                不放进可拖拽层——瞬时 toast 不必跟随上滑位移；pointer-events-none 不挡手势 */}
            <AnimatePresence>
              {torch && torchMode === 'hw' && hwPillVisible && (
                <motion.div
                  key="hw-torch-pill"
                  className="pointer-events-none absolute inset-x-0 top-[214px] z-10 flex justify-center"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <span role="status" className={`rounded-full bg-white/20 px-3 py-1.5 text-[12px] backdrop-blur-md ${fg}`}>
                    已开启系统闪光灯
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div
            key="pass"
            className="absolute inset-0 flex flex-col items-center bg-black/45 pb-[40px] backdrop-blur-2xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="h-[120px]" />
            <p className="text-[17px] font-medium text-white">{padTitle}</p>
            {mode === 'resetNew' && (
              <p className="mt-1 text-[13px] text-white/55">设置一个新的锁屏密码</p>
            )}
            {mode === 'resetConfirm' && (
              <p className="mt-1 text-[13px] text-white/55">请再次输入相同的密码</p>
            )}
            <PasscodePad
              length={lockConfig.len}
              light
              onComplete={onPadComplete}
              errorSignal={errSignal}
              disabled={lockedOut && mode === 'passcode'}
              className="mt-4"
            />
            <p className="mt-3 min-h-[20px] text-[13px] font-medium text-[#FF453A]" role="alert">
              {lockedOut && mode === 'passcode'
                ? `请 ${lockRemaining} 秒后再试`
                : errText}
            </p>
            <button
              type="button"
              className="mt-auto rounded-full px-6 py-2 text-[17px] text-white/90 transition active:opacity-60"
              onClick={cancelPad}
            >
              取消
            </button>
            {mode === 'passcode' && !lockedOut && (
              <button
                type="button"
                onClick={openForgot}
                className="mt-2 text-[14px] text-white/60 underline decoration-white/40 underline-offset-[5px] transition active:opacity-60"
              >
                忘记密码？
              </button>
            )}
            {mode !== 'passcode' && <div className="h-[30px]" aria-hidden="true" />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 手电筒补光（白屏模拟，仅回退用）：系统闪光灯点亮成功（hw）时不铺白屏——真实 LED 已照明，
          铺白屏反而干扰；请求中（idle）与不支持回退（fallback）照旧铺白兜底。
          整屏即关闭热区，避免“一片空白不知如何退出”；
          onPointerDown 阻断冒泡，防止白屏下的拖拽手势把补光层一起拖着走 */}
      <AnimatePresence>
        {torch && torchMode !== 'hw' && (
          <motion.div
            key="torch"
            role="button"
            aria-label="关闭手电筒"
            tabIndex={0}
            onClick={() => setTorch(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setTorch(false);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute inset-0 z-[20] cursor-pointer bg-white outline-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {/* 顶部状态提示 */}
            <div className="flex flex-col items-center pt-[104px] text-black/45">
              <Flashlight className="h-8 w-8" strokeWidth={1.6} />
              <p className="mt-3 text-[15px] font-medium">手电筒已开启</p>
              {/* 仅硬件回退（fallback）时说明：白屏是屏幕补光模拟，非真实闪光灯 */}
              {torchMode === 'fallback' && (
                <p className="mt-1 text-[12px] opacity-70">当前设备不支持系统闪光灯，已使用屏幕补光</p>
              )}
            </div>
            {/* 底部明显关闭按钮（点整屏任意位置同样关闭） */}
            <div className="absolute inset-x-0 bottom-[96px] flex flex-col items-center gap-3">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/[0.12] text-black/80 ring-1 ring-black/15">
                <FlashlightOff className="h-7 w-7" strokeWidth={1.9} />
              </span>
              <span className="text-[13px] font-medium text-black/55">轻点任意位置关闭</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 锁屏直达相机（不解锁；关闭相机回锁屏） */}
      <AnimatePresence>
        {lockCameraOpen && (
          <motion.div
            key="lockcam"
            className="absolute inset-0 z-[30] bg-black"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            <CameraApp onExit={() => setLockCameraOpen(false)} hideGallery />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
