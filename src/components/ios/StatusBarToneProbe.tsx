'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSettings, useSystemDark, useUI } from '@/lib/ios/store';
import {
  popStatusBarTone,
  pushStatusBarTone,
  type StatusBarTone,
} from '@/lib/ios/status-bar-tone';
import { compositeBg, relativeLuminance } from '@/lib/ios/bg-sample';

/**
 * 状态栏自动基调探针（Task 100-f）：
 * 用户要求「App 内所有界面（不只音乐）状态栏前景实时跟随实际背景明暗——深底白字、浅底黑字」。
 * 音乐 App 已自管基调（按页面 push/pop），其余 App 没有页面级声明，靠静态表/主题兜底覆盖不到
 * App 内部界面差异（如天气管理页白底、聊天进入深色会话等）。
 *
 * 本组件渲染一个 hidden 占位 div（纯逻辑、零 UI），挂在 AppWindow 容器内 <App/> 之后；
 * 用 parentElement 拿到 App 容器，周期性对「状态栏身后那一行像素」做命中采样：
 * - 状态栏中线 y=+27px，左右 x=18% / 82% 两个采样点（避开顶部中央灵动岛/时间文字；
 *   全局状态栏层是 pointer-events-none，elementFromPoint 天然穿透）；
 * - 命中元素必须被容器包含，否则本轮弃用该点（防采样到灵动岛通知/来电层等全局浮层）；
 * - 从命中元素向上走祖先按标准 alpha compositing 合成有效背景色（半透明层逐层叠加），
 *   走出链路仍未不透明时弃用该点；backgroundColor 透明且带渐变时取渐变首停
 *   （天气全屏蓝天等 backgroundImage 实现）——合成器在 @/lib/ios/bg-sample 共享
 *   （v2.4.7 起与 SafeAreaBleedBands 出血条带共用同一套采样底层）；
 * - 相对亮度 L < 0.5 → 背景深 → tone='light'（白前景），否则 'dark'；
 *   两点各算一个亮度，取更接近中间值 0.5 的那点裁决（越临界越由它定对比最稳）。
 *
 * 基调经 pushStatusBarTone/popStatusBarTone 走既有屏幕级基调栈（foreground.ts 的
 * toneOverride 通道，仅 !locked 时生效），只在基调变化时推/弹（栈内 emit 不风暴）；
 * 暂停条件（锁屏 / 多任务切换器 / 无前台 App / 容器不可见）时弹栈回落壁纸逻辑，
 * 恢复后自动重新采样。weather/camera 的静态声明保留作首帧兜底（探针给出一致值）。
 */

/** 采样周期：App 内页面切换最迟半秒跟上（实时性主要由依赖变化立即采样兜住） */
const SAMPLE_INTERVAL_MS = 500;
/** 状态栏中线（状态栏高 54px 的一半）：采样「状态栏身后」那一行 */
const BAR_MIDLINE_Y = 27;
/** 左右采样点 x 比例：避开顶部中央灵动岛/时间文字 */
const SAMPLE_X_RATIOS = [0.18, 0.82] as const;

export default function StatusBarToneProbe() {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const pushedIdRef = useRef<number | null>(null);
  const pushedToneRef = useRef<StatusBarTone | null>(null);

  const activeApp = useUI((s) => s.activeApp);
  const switcherOpen = useUI((s) => s.switcherOpen);
  const locked = useUI((s) => s.locked);
  // 主题深浅变化会翻转容器 bg-background，立即重采一次（hooks 必须无条件调用）
  const theme = useSettings((s) => s.theme);
  const systemDark = useSystemDark();

  /** 暂停采样：锁屏 / 多任务切换器 / 无前台 App（状态栏在壁纸上，基调不越界） */
  const paused = locked || switcherOpen || !activeApp;

  const release = useCallback(() => {
    if (pushedIdRef.current !== null) {
      popStatusBarTone(pushedIdRef.current);
      pushedIdRef.current = null;
    }
    pushedToneRef.current = null;
  }, []);

  useEffect(() => {
    if (paused) release();
  }, [paused, release]);

  const sample = useCallback(() => {
    const container = holderRef.current?.parentElement;
    if (!container || typeof window === 'undefined' || typeof document === 'undefined') return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // 容器不可见（关闭动画末尾等）

    const y = rect.top + BAR_MIDLINE_Y;
    let chosen: number | null = null;
    for (const ratio of SAMPLE_X_RATIOS) {
      const x = rect.left + rect.width * ratio;
      const hit = document.elementFromPoint(x, y);
      // 命中容器之外（灵动岛通知/来电层等全局浮层）→ 弃用该点，保持现基调防误采样
      if (!hit || !container.contains(hit)) continue;
      const bg = compositeBg(hit, container);
      if (!bg) continue;
      const l = relativeLuminance(bg);
      // 两点各得一个亮度，取更接近中间值 0.5 的那点裁决
      if (chosen === null || Math.abs(l - 0.5) < Math.abs(chosen - 0.5)) chosen = l;
    }
    if (chosen === null) return;

    const tone: StatusBarTone = chosen < 0.5 ? 'light' : 'dark';
    if (pushedIdRef.current !== null && pushedToneRef.current === tone) return; // 无变化不 emit
    if (pushedIdRef.current !== null) popStatusBarTone(pushedIdRef.current);
    pushedIdRef.current = pushStatusBarTone(tone);
    pushedToneRef.current = tone;
  }, []);

  // 采样循环：暂停时不跑；恢复 / 锁屏、切换器、前台 App、主题深浅变化后立即一次
  useEffect(() => {
    if (paused) return;
    sample();
    const timer = window.setInterval(sample, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [paused, sample, theme, systemDark]);

  useEffect(() => release, [release]); // 卸载弹栈（push/pop 幂等，strict mode 双挂载安全）

  // hidden 占位：只为拿 parentElement（AppWindow 容器），零布局影响
  return <div ref={holderRef} hidden aria-hidden="true" data-status-bar-tone-probe="" />;
}
