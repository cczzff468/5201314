'use client';

/**
 * Cove 韩系开屏动画（第三十一轮：App 改名 Cove，机主要求「韩系的」开屏）。
 *
 * 形态：冷启动（页面加载）时全屏先播一段 ~1.8s 的开屏——
 *  - 奶油白底 + 两团大色晕（暖玫瑰 / 淡抹茶）缓慢漂移（韩系柔和氛围）；
 *  - 中央所选 App 图标（设置 › App 图标 三选一实时跟随）弹性入场 + 柔和光晕；
 *  - 下方「Cove」wordmark 细字距拉宽，逐字错峰上浮；
 *  - 底部细进度条上一道微光循环扫过；
 *  - 1.25s 后整层淡出（0.55s，+轻放大观感），完全卸载——手机壳与锁屏入场不被抢戏。
 *
 * 挂载在 page.tsx 顶层（fixed 全屏、z-[9999] 盖住一切，包括桌面端的灰色页面底与手机壳），
 * 自身管理生命周期：每个页面会话只播一次。
 */
import { useEffect, useState } from 'react';
import { useSettings } from '@/lib/ios/store';

/** 开屏总时长：1.25s 起播淡出（0.55s）→ 1.8s 完全卸载 */
const HOLD_MS = 1250;
const FADE_MS = 550;

export default function BootSplash() {
  const appIcon = useSettings((s) => s.appIcon);
  const [phase, setPhase] = useState<'hold' | 'fade' | 'gone'>('hold');

  useEffect(() => {
    const t1 = window.setTimeout(() => setPhase('fade'), HOLD_MS);
    const t2 = window.setTimeout(() => setPhase('gone'), HOLD_MS + FADE_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  if (phase === 'gone') return null;

  const word = 'Cove'.split('');

  return (
    <div
      aria-hidden="true"
      data-testid="cove-boot-splash"
      className="pointer-events-none fixed inset-0 z-[9999] select-none overflow-hidden"
      style={
        phase === 'fade'
          ? { animation: `cove-splash-fade ${FADE_MS}ms cubic-bezier(0.4,0,0.2,1) forwards` }
          : undefined
      }
    >
      {/* 奶油底 */}
      <div className="absolute inset-0 bg-[#FAF8F3]" />
      {/* 两团柔和大色晕（缓慢漂移，韩系氛围） */}
      <div
        className="absolute left-[-18%] top-[-12%] h-[62%] w-[85%] rounded-full opacity-70 blur-[70px]"
        style={{
          background: 'radial-gradient(closest-side, #F6D9D2 0%, #F9E9E2 55%, rgba(250,248,243,0) 100%)',
          animation: 'cove-splash-orb-a 7s ease-in-out infinite',
        }}
      />
      <div
        className="absolute bottom-[-16%] right-[-20%] h-[58%] w-[80%] rounded-full opacity-65 blur-[70px]"
        style={{
          background: 'radial-gradient(closest-side, #DDE8DC 0%, #E9F0E6 55%, rgba(250,248,243,0) 100%)',
          animation: 'cove-splash-orb-b 8.5s ease-in-out infinite',
        }}
      />
      {/* 中央内容：图标 + wordmark + 微光进度条 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[30px]">
        {/* App 图标（设置三选一实时跟随；弹性入场 + 柔和光晕） */}
        <img
          src={`/icons/app/icon-${appIcon}-192.png`}
          alt=""
          className="h-[88px] w-[88px] rounded-[21px] object-cover shadow-[0_14px_38px_rgba(96,84,74,0.20)]"
          style={{ animation: 'cove-splash-icon-in 620ms cubic-bezier(0.34,1.4,0.44,1) 90ms both' }}
        />
        {/* wordmark：细字距 + 逐字错峰上浮 */}
        <div
          className="flex items-baseline text-[26px] font-medium tracking-[0.42em] text-[#3E3A35]"
          style={{ textIndent: '0.42em' /* 抵消末字后半距，保持几何居中 */ }}
        >
          {word.map((ch, i) => (
            <span
              key={i}
              style={{ animation: `cove-splash-word-in 560ms cubic-bezier(0.22,0.9,0.3,1) ${260 + i * 90}ms both` }}
            >
              {ch}
            </span>
          ))}
        </div>
        {/* 微光进度条（开屏期间循环扫过） */}
        <div className="relative h-[3px] w-[104px] overflow-hidden rounded-full bg-black/[0.06]">
          <span
            className="absolute inset-y-0 left-0 w-[34%] rounded-full"
            style={{
              background: 'linear-gradient(90deg, rgba(214,170,158,0) 0%, #D99F8F 45%, #C88A78 60%, rgba(199,138,120,0) 100%)',
              animation: 'cove-splash-shimmer 1.25s cubic-bezier(0.4,0,0.6,1) infinite',
            }}
          />
        </div>
      </div>
    </div>
  );
}
