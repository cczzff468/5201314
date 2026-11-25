'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useSettings, useSystemDark, useUI } from '@/lib/ios/store';
import {
  compositeBg,
  rgbaCss,
  imgPixelAt,
  bgImagePixelAt,
  bgImageUrlOf,
  ensureBgImageStrip,
  type Rgba,
} from '@/lib/ios/bg-sample';
import { publishBleedTopStops, type BleedStop } from '@/lib/ios/bleed-band-state';

/**
 * 安全区出血条带（v2.4.8 重做）：APK 里把「App 页面自己的底色/顶边像素」延伸铺满
 * 安全区条带，系统状态栏浮在页面颜色上——每个界面都融入、且【首帧即正确】。
 *
 * 机主反馈 v2.4.7 的三个问题及根因：
 * ①「显示的太慢」——旧版 500ms 轮询：打开 App 后条带最长半秒才换色（期间白条）；
 * ②「有的融合不进去」——采样链 elementFromPoint→compositeBg 只认 CSS 背景：
 *    命中 <img>（照片查看器/商品头图）时颜色回落祖先白底 → 黑图上白条带；
 *    状态栏探针同理（y=27 在 APK 里落在内容层之上，恒采白）；
 * ③ 打开 App 的首帧也白——旧版 useEffect 采样在首帧绘制之后才跑。
 *
 * 本版三层时机：
 * A. 首帧（useLayoutEffect，浏览器绘制前同步采样+上色）——App 打开的第一帧
 *    条带就是页面颜色，零白帧；
 * B. 即时（MutationObserver 监听 App DOM 变化 → 60ms 防抖重采；scroll 捕获
 *    监听 → 80ms 节流重采）——App 内切页/弹层/滚动，条带一两帧内跟上；
 * C. 兜底（500ms 慢轮询 + resize）——渐进动画等无 DOM 事件的颜色变化。
 *
 * 采样源升级（按优先级取色）：
 * 1. <img> 命中 → imgPixelAt（object-fit 真实映射 + 缩绘画布读像素，
 *    跨域图回落第 2 层）——「图片顶边像素延伸」，机主需求的本义；
 * 2. 带 background-image:url() 的元素 → bgImagePixelAt（background-size/position
 *    映射；未解码则 ensureBgImageStrip 异步解码后重采一轮）；
 * 3. CSS 背景 compositeBg（颜色/渐变首停/半透明逐层合成——v2.4.7 的原路径）；
 * 4. 全点失败 → App 根有效背景色（不再沿用上一轮：换 App 立即反映新底色）。
 *
 * 生效范围：仅 html[data-app-native]（APK 原生壳）且 App 窗口打开中；
 * 网页端四变量恒 0 → 条带 display:none。顶带停点发布到 bleed-band-state
 * （StatusBarToneProbe 消费，状态栏图标明暗与条带同源）。
 */

/** 兜底慢轮询周期（即时性主要靠 A/B 两层时机兜住） */
const SAMPLE_INTERVAL_MS = 500;
/** MutationObserver 防抖：App 内切页/弹层的重采延迟 */
const MUTATION_DEBOUNCE_MS = 60;
/** scroll 节流间隔：滚动中条带跟随（黄头滚出→白底） */
const SCROLL_THROTTLE_MS = 80;
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
  /** 异步图片解码完成后待触发的一次重采（ensureBgImageStrip 回调用） */
  const resampleRef = useRef<() => void>(() => {});

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
    // 第三十三轮：顶带改用有效内缩 --app-sat-eff（新壳 45% 挖孔，状态栏上提同源）——
    // 条带高度/采样 y 与内容层顶边对齐；其余三边原值
    const sat = nativeMode ? readVar('--app-sat-eff') : 0;
    const satFull = nativeMode ? readVar('--app-sat') : 0;
    const sar = nativeMode ? readVar('--app-sar') : 0;
    const sab = nativeMode ? readVar('--app-sab') : 0;
    const sal = nativeMode ? readVar('--app-sal') : 0;

    // 网页端（或安全区全 0）：条带零尺寸，display:none 省合成层
    const any = satFull > 0 || sar > 0 || sab > 0 || sal > 0;
    for (const kind of Object.keys(bandRefs.current) as BandKind[]) {
      const el = bandRefs.current[kind];
      if (el) el.style.display = any ? 'block' : 'none';
    }
    if (!any) {
      lastPaint.current = {};
      publishBleedTopStops([]); // 网页端清空（探针回落旧路径）
      return;
    }

    const rect = root.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // 动画收尾等不可见帧
    // 采样命中必须落在内容盒（[data-safe-inset]）内——命中全局浮层/越界时弃用该点
    const content = root.querySelector('[data-safe-inset]');
    if (!content) return;

    /** 结构化兜底色：App 根的有效背景（compositeBg 沿祖先到出血根，恒不透明）。
     *  全点采样失败时用它——换 App/切页立即反映新底色，不再「沿用上一轮颜色」。 */
    let fallbackColor: string | null = null;
    const appRoot = content.firstElementChild;
    if (appRoot instanceof HTMLElement) {
      const bg: Rgba | null = compositeBg(appRoot, root);
      if (bg) fallbackColor = rgbaCss(bg);
    }

    /** 异步媒体待解码标记（本轮有 bg-image 触发了 ensureBgImageStrip） */
    let asyncPending = false;

    /** 单点采样：命中栈自上而下找第一个属于 App 内容盒的元素——
     *  <img> → 像素采样（object-fit 映射）；带 bg-image url → 像素采样（未解码则挂异步）；
     *  其余/未命中 → compositeBg 合成背景色；栈里找不到内容盒元素 → 兜底色 */
    const pick = (x: number, y: number): string | null => {
      const stack = document.elementsFromPoint(x, y);
      for (const el of stack) {
        if (!content.contains(el)) continue; // 全局浮层（通知中心边条/悬浮球）穿透跳过
        if (el instanceof HTMLImageElement) {
          const px = imgPixelAt(el, x, y);
          if (px) return rgbaCss(px); // 图片顶边像素延续
          continue; // letterbox/跨域/未解码 → 沿栈继续找下层元素
        }
        if (el instanceof HTMLElement && bgImageUrlOf(el)) {
          const px = bgImagePixelAt(el, x, y);
          if (px) return rgbaCss(px);
          ensureBgImageStrip(el, () => resampleRef.current()); // 解码完成后重采一轮
          asyncPending = true;
          continue; // 本轮未就绪：沿栈继续（下一轮采样走像素路径）
        }
        const bg: Rgba | null = compositeBg(el, root);
        if (bg) return rgbaCss(bg);
      }
      return fallbackColor;
    };
    /** 一条边取色：沿行/列多点采样（坐标恒 (x, y) 对），失败点用兜底色 */
    const edgeStops = (coords: Array<[number, number, number]>): Stop[] => {
      const out: Stop[] = [];
      for (const [ratio, x, y] of coords) {
        const c = pick(x, y) ?? fallbackColor;
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

    let topStops: Stop[] = [];
    if (sat > 0) {
      const y = rect.top + sat + SEAM_OFFSET_PX;
      topStops = edgeStops(SAMPLE_RATIOS.map((r) => [r, rect.left + rect.width * r, y] as [number, number, number]));
      paint('top', bandBackground(topStops, true));
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

    // 顶带停点发布（StatusBarToneProbe 消费：状态栏图标明暗与条带同源同色）
    if (sat > 0) publishBleedTopStops(topStops as BleedStop[]);
  }, [readVar]);

  // resampleRef 永远指向最新 sample（异步图片解码回调防陈旧闭包）
  useEffect(() => {
    resampleRef.current = sample;
  }, [sample]);

  /** A 层时机：useLayoutEffect——浏览器绘制【前】同步采样上色（App 打开首帧即正确，
   *  消「打开瞬间白条带闪一下」）。依赖变化（换 App/开关动画结束/主题翻转）也走首帧路径。 */
  useLayoutEffect(() => {
    if (paused) return;
    sample();
  }, [paused, sample, theme, systemDark, activeApp, phase]);

  /** B+C 层时机：MutationObserver（切页/弹层）+ scroll 节流 + resize + 500ms 兜底轮询 */
  useEffect(() => {
    if (paused) return;
    // MutationObserver：App 内任何 DOM 变化（页面切换/浮层/列表更新）→ 防抖重采。
    // 条带自身 style 写入也会触发观察器（band 元素在 root 子树内）——
    // 回调里过滤「全部变化都来自条带元素」的批次，防自反馈循环。
    let mutTimer = 0;
    const onMutations = (records: MutationRecord[]) => {
      const meaningful = records.some((r) => {
        const t = r.target as Element;
        return !(t instanceof HTMLElement && t.dataset.bleedBand !== undefined);
      });
      if (!meaningful) return;
      if (mutTimer) return;
      mutTimer = window.setTimeout(() => {
        mutTimer = 0;
        sample();
      }, MUTATION_DEBOUNCE_MS);
    };
    const mo = new MutationObserver(onMutations);
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    let loadTimer = 0;

    // scroll 捕获节流：滚动中页面顶部内容变化（黄头滚出→白底露出），条带即时跟随
    let lastScroll = 0;
    const onScroll = () => {
      const now = performance.now();
      if (now - lastScroll < SCROLL_THROTTLE_MS) return;
      lastScroll = now;
      sample();
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });

    // img 加载捕获：图片解码完成不触发 MutationObserver（load 不改属性）——
    // 晚到的图片（照片查看器/商品头图）就绪后立即重采，条带换上图片像素
    const onLoad = () => {
      if (loadTimer) return;
      loadTimer = window.setTimeout(() => {
        loadTimer = 0;
        sample();
      }, 40);
    };
    document.addEventListener('load', onLoad, { capture: true, passive: true });

    const onResize = () => sample();
    window.addEventListener('resize', onResize);
    const timer = window.setInterval(sample, SAMPLE_INTERVAL_MS);

    return () => {
      mo.disconnect();
      if (mutTimer) window.clearTimeout(mutTimer);
      if (loadTimer) window.clearTimeout(loadTimer);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('load', onLoad, true);
      window.removeEventListener('resize', onResize);
      window.clearInterval(timer);
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
        // 第三十三轮：顶带高度 = 有效内缩（与内容层顶边同步上提）
        return { ...base, top: 0, left: 0, right: 0, height: 'var(--app-sat-eff, 0px)' };
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
