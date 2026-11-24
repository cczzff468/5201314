'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useSettings, useSystemDark, useUI } from '@/lib/ios/store';
import {
  popStatusBarTone,
  pushStatusBarTone,
  type StatusBarTone,
} from '@/lib/ios/status-bar-tone';
import { compositeBg, relativeLuminance, parseCssColor } from '@/lib/ios/bg-sample';
import { getBleedTopStops, subscribeBleedTop } from '@/lib/ios/bleed-band-state';

/**
 * 状态栏自动基调探针（Task 100-f / v2.4.8 重做）：
 * 「App 内所有界面状态栏前景实时跟随实际背景明暗——深底白字、浅底黑字」。
 *
 * v2.4.8 修的两个根因（机主反馈「有的融合不进去、显示太慢」的图标侧）：
 * ① APK 里旧采样 y=+27px 落在内容层（--app-sat 起）【之上】——elementFromPoint
 *   命中的是出血根/AppWindow（恒白），黑底页采出「黑图标压黑条带」。
 *   现改读 SafeAreaBleedBands 发布的顶带停点（与条带同源同色，采集零成本）；
 * ② 500ms 轮询才换基调 → useLayoutEffect 首帧 + 条带发布订阅（publish 即时推）。
 *
 * 网页端（无条带发布）维持原路径：容器中线 y=27、左右两采样点命中 App 内容，
 * compositeBg 合成有效背景色 → 相对亮度 L<0.5 → tone='light'（白前景）。
 * 基调经 pushStatusBarTone/popStatusBarTone 走屏幕级基调栈（foreground.ts
 * 的 toneOverride 通道，仅 !locked 生效），变化时才推/弹（无 emit 风暴）。
 */

/** 采样周期（网页端兜底；APK 端主要靠条带发布订阅即时驱动） */
const SAMPLE_INTERVAL_MS = 500;
/** 状态栏中线（状态栏高 54px 的一半）：网页端采样「状态栏身后」那一行 */
const BAR_MIDLINE_Y = 27;
/** 网页端左右采样点 x 比例：避开顶部中央灵动岛/时间文字 */
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

  const applyTone = useCallback((tone: StatusBarTone) => {
    if (pushedIdRef.current !== null && pushedToneRef.current === tone) return; // 无变化不 emit
    if (pushedIdRef.current !== null) popStatusBarTone(pushedIdRef.current);
    pushedIdRef.current = pushStatusBarTone(tone);
    pushedToneRef.current = tone;
  }, []);

  const sample = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    // ① APK 原生模式：读出血条带顶带停点（SafeAreaBleedBands 同源发布）——
    //    图标明暗永远与所见条带一致；无发布（网页端/未采样）走 ②
    const stops = getBleedTopStops();
    if (stops.length > 0) {
      let chosen: number | null = null;
      for (const s of stops) {
        const c = parseCssColor(s.color);
        if (!c) continue;
        const l = relativeLuminance(c);
        // 多停点各算亮度，取最接近中间值 0.5 的那点裁决（越临界越由它定对比最稳）
        if (chosen === null || Math.abs(l - 0.5) < Math.abs(chosen - 0.5)) chosen = l;
      }
      if (chosen !== null) {
        applyTone(chosen < 0.5 ? 'light' : 'dark');
        return;
      }
    }

    // ② 网页端路径：容器中线左右两点命中 App 内容合成背景
    const container = holderRef.current?.parentElement;
    if (!container) return;
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
      if (chosen === null || Math.abs(l - 0.5) < Math.abs(chosen - 0.5)) chosen = l;
    }
    if (chosen === null) return;
    applyTone(chosen < 0.5 ? 'light' : 'dark');
  }, [applyTone]);

  /** 首帧时机：useLayoutEffect（绘制前）——App 打开首帧基调即正确 */
  useLayoutEffect(() => {
    if (paused) return;
    sample();
  }, [paused, sample, theme, systemDark, activeApp]);

  /** 持续时机：条带发布订阅（APK 端即时）+ 500ms 兜底轮询（网页端） */
  useEffect(() => {
    if (paused) return;
    const unsubscribe = subscribeBleedTop(sample);
    const timer = window.setInterval(sample, SAMPLE_INTERVAL_MS);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [paused, sample, theme, systemDark, activeApp]);

  useEffect(() => release, [release]); // 卸载弹栈（push/pop 幂等，strict mode 双挂载安全）

  // hidden 占位：只为拿 parentElement（AppWindow 容器），零布局影响
  return <div ref={holderRef} hidden aria-hidden="true" data-status-bar-tone-probe="" />;
}
