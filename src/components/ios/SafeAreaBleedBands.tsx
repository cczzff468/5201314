'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSettings, useSystemDark, useUI } from '@/lib/ios/store';
import { compositeBg, rgbaCss, type Rgba } from '@/lib/ios/bg-sample';

/**
 * 安全区出血条带（v2.4.7）：APK 里把「App 页面自己的底色」延伸铺满安全区条带，
 * 取代 v2.4.6 固定 bg-background 的出血——浅色主题下深色页面（照片查看器黑底、
 * 音乐播放页等）的顶部会露一条白带 + 横屏侧挖孔避让区露白竖条（机主反馈的
 * 「其他界面状态栏没融入 APP」「右缘空白还是没解决」的真根因：那不是滚动条，
 * 而是 AppWindow 出血根的白底）。主屏幕/锁屏不受影响（壁纸层本就铺满物理屏）。
 *
 * 做法（对 AppWindow 出血根内、[data-safe-inset] 之外的四个条带区）：
 * - 顶带（0..sat）/底带（H-sab..H）/右带（W-sar..W）/左带（0..sal）四个
 *   pointer-events-none 的绝对定位条带 div，由本组件渲染并直接改 style（零 React 重渲）；
 * - 每 500ms（与状态栏基调探针同节拍）沿「紧贴条带内侧的那一行/列」多点采样：
 *   elementFromPoint 命中 → compositeBg 沿祖先合成有效背景色（渐变取首停）；
 * - 各点颜色按采样比例拼成 linear-gradient：页面顶部横向有分色（左深右浅等）
 *   时条带随之分段延续，肉眼近似「页面像素延伸进安全区」；
 * - 全部采样点同色时退化纯色背景（渲染更省）；某点命中失败（全局浮层/越界）
 *   沿用上一个成功颜色，防条带缺口。
 *
 * 生效范围：仅 html[data-app-native]（APK 原生壳）且 App 窗口打开中（phase=open、
 * 非锁屏/多任务）；网页端四变量恒 0 → 条带 display:none，零视觉变化。
 */

/** 采样周期：App 内页面切换最迟半秒跟上（实时性主要由依赖变化立即采样兜住） */
const SAMPLE_INTERVAL_MS = 500;
/** 沿条带内侧的采样点比例（避两端极值：圆角/贴边浮层） */
const SAMPLE_RATIOS = [0.06, 0.28, 0.5, 0.72, 0.94] as const;
/** 采样行/列向条带内侧偏移（物理 CSS px）：紧贴接缝，颜色逐像素连续 */
const SEAM_OFFSET_PX = 2;

type BandKind = 'top' | 'right' | 'bottom' | 'left';

/** 采样点 → 停点对 */
type Stop = { ratio: number; color: string };

/** 一组停点 → linear-gradient；同色退化纯色；空组返回 null（本轮不画，保持上一轮） */
function bandBackground(stops: Stop[], horizontal: boolean): string | null {
  if (!stops.length) return null;
  const first = stops[0].color;
  if (stops.every((s) => s.color === first)) return first; // 纯色：省一层渐变合成
  const dir = horizontal ? 'to right' : 'to bottom';
  const parts: string[] = [`${first} 0%`];
  stops.forEach((s) => parts.push(`${s.color} ${Math.round(s.ratio * 100)}%`));
  parts.push(`${stops[stops.length - 1].color} 100%`);
  return `linear-gradient(${dir}, ${parts.join(', ')})`;
}

export default function SafeAreaBleedBands() {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const bandRefs = useRef<Record<BandKind, HTMLDivElement | null>>({
    top: null,
    right: null,
    bottom: null,
    left: null,
  });
  const lastPaint = useRef<Partial<Record<BandKind, string>>>({});

  const activeApp = useUI((s) => s.activeApp);
  const phase = useUI((s) => s.phase);
  const switcherOpen = useUI((s) => s.switcherOpen);
  const locked = useUI((s) => s.locked);
  // 主题深浅变化会翻转页面底色，立即重采（hooks 必须无条件调用）
  const theme = useSettings((s) => s.theme);
  const systemDark = useSystemDark();

  /** 暂停采样：无前台 App / 开场收场动画中 / 锁屏 / 多任务（条带被盖住或无意义） */
  const paused = !activeApp || phase !== 'open' || switcherOpen || locked;

  const readVar = useCallback((name: string): number => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : 0;
  }, []);

  const sample = useCallback(() => {
    const root = holderRef.current?.parentElement as HTMLElement | null;
    if (!root || typeof document === 'undefined') return;
    const nativeMode = document.documentElement.hasAttribute('data-app-native');
    const sat = nativeMode ? readVar('--app-sat') : 0;
    const sar = nativeMode ? readVar('--app-sar') : 0;
    const sab = nativeMode ? readVar('--app-sab') : 0;
    const sal = nativeMode ? readVar('--app-sal') : 0;

    // 网页端（或安全区全 0）：条带零尺寸，display:none 省合成层
    const any = sat > 0 || sar > 0 || sab > 0 || sal > 0;
    for (const kind of Object.keys(bandRefs.current) as BandKind[]) {
      const el = bandRefs.current[kind];
      if (el) el.style.display = any ? 'block' : 'none';
    }
    if (!any) {
      lastPaint.current = {};
      return;
    }

    const rect = root.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // 动画收尾等不可见帧
    // 采样命中必须落在内容盒（[data-safe-inset]）内——命中全局浮层/越界时弃用该点
    const content = root.querySelector('[data-safe-inset]');
    if (!content) return;

    /** 单点采样：命中栈自上而下找第一个属于 App 内容盒的元素（全局浮层如通知中心
     *  下拉边条/悬浮球等透明层会被穿透跳过）→ 合成背景色；栈里找不到则弃点 */
    const pick = (x: number, y: number): string | null => {
      const stack = document.elementsFromPoint(x, y);
      for (const el of stack) {
        if (!content.contains(el)) continue;
        const bg: Rgba | null = compositeBg(el, root);
        if (bg) return rgbaCss(bg);
      }
      return null;
    };
    /** 一条边取色：沿行/列多点采样（坐标恒 (x, y) 对），失败点直接丢弃（不插入伪停点，
     *  成功点保持真实比例位置；全失败本轮不画，条带保持上一轮颜色） */
    const edgeStops = (coords: Array<[number, number, number]>): Stop[] => {
      const out: Stop[] = [];
      for (const [ratio, x, y] of coords) {
        const c = pick(x, y);
        if (c) out.push({ ratio, color: c });
      }
      return out;
    };

    const paint = (kind: BandKind, bg: string | null) => {
      if (!bg) return; // 本轮无有效采样：保持上一轮颜色
      const el = bandRefs.current[kind];
      if (!el) return;
      if (lastPaint.current[kind] === bg) return; // 无变化不写样式
      lastPaint.current[kind] = bg;
      el.style.background = bg;
    };

    if (sat > 0) {
      const y = rect.top + sat + SEAM_OFFSET_PX;
      const stops = edgeStops(SAMPLE_RATIOS.map((r) => [r, rect.left + rect.width * r, y] as [number, number, number]));
      paint('top', bandBackground(stops, true));
    }
    if (sab > 0) {
      const y = rect.bottom - sab - SEAM_OFFSET_PX;
      const stops = edgeStops(SAMPLE_RATIOS.map((r) => [r, rect.left + rect.width * r, y] as [number, number, number]));
      paint('bottom', bandBackground(stops, true));
    }
    if (sar > 0) {
      const x = rect.right - sar - SEAM_OFFSET_PX;
      const stops = edgeStops(SAMPLE_RATIOS.map((r) => [r, x, rect.top + rect.height * r] as [number, number, number]));
      paint('right', bandBackground(stops, false));
    }
    if (sal > 0) {
      const x = rect.left + sal + SEAM_OFFSET_PX;
      const stops = edgeStops(SAMPLE_RATIOS.map((r) => [r, x, rect.top + rect.height * r] as [number, number, number]));
      paint('left', bandBackground(stops, false));
    }
  }, [readVar]);

  // 采样循环：暂停时不跑；恢复 / 前台 App、窗口相位、主题深浅变化后立即一次；
  // resize（APK 旋转：configChanges 不重载页面，安全区变量由原生回调更新）也立即重采
  useEffect(() => {
    if (paused) return;
    sample();
    const timer = window.setInterval(sample, SAMPLE_INTERVAL_MS);
    const onResize = () => sample();
    window.addEventListener('resize', onResize);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [paused, sample, theme, systemDark, activeApp, phase]);

  const bandStyle = (kind: BandKind): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'absolute',
      display: 'none', // 网页端默认隐藏（sample() 在 APK 内翻回 block）
      pointerEvents: 'none',
    };
    switch (kind) {
      case 'top':
        return { ...base, top: 0, left: 0, right: 0, height: 'var(--app-sat, 0px)' };
      case 'bottom':
        return { ...base, bottom: 0, left: 0, right: 0, height: 'var(--app-sab, 0px)' };
      case 'right':
        return { ...base, top: 0, bottom: 0, right: 0, width: 'var(--app-sar, 0px)' };
      case 'left':
        return { ...base, top: 0, bottom: 0, left: 0, width: 'var(--app-sal, 0px)' };
    }
  };

  return (
    <>
      {/* 四条出血条带：铺在出血根的安全区条带上（与 [data-safe-inset] 内容盒不重叠），
          颜色/渐变由 sample() 直接写 style——不进 React 状态，零重渲染 */}
      {(['top', 'right', 'bottom', 'left'] as BandKind[]).map((kind) => (
        <div
          key={kind}
          ref={(el) => {
            bandRefs.current[kind] = el;
          }}
          data-bleed-band={kind}
          aria-hidden="true"
          style={bandStyle(kind)}
        />
      ))}
      {/* hidden 占位：只为拿 parentElement（AppWindow 出血根），零布局影响 */}
      <div ref={holderRef} hidden aria-hidden="true" data-bleed-band-holder="" />
    </>
  );
}
