'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Camera, Lock } from 'lucide-react';
import {
  useUI,
  useWallpaperStyle,
  useSettings,
  useMeasuredWallpaperLight,
  WALLPAPER_PRESETS,
  type AppId,
} from '@/lib/ios/store';
import { APP_MAP, AppIconById } from '../apps/registry';
// v1.9.21 吃醋锁网页降级：冻结 App 的多任务卡片盖「已冻结」遮罩（点击仍会被 openApp/switchToApp 拦截弹全屏提示）
import { isWebAppFrozen, webFrozenBy, subscribeWebLock, getWebLockVersion } from '@/lib/ios/web-app-lock';
// 第三十四轮：Android WebView 渲染降级（backdrop-filter 光栅化缺陷 → 切换器背景改静态缩图模糊）
import { useAndroidWebView } from '@/lib/ios/webview-render';

/** 手机屏幕逻辑尺寸（App 按此尺寸 1:1 渲染再整体缩放进卡片，保证卡片内是真实界面的等比还原） */
const SCREEN_W = 390;
const SCREEN_H = 844;

/**
 * 多任务切换器（仿截图）：
 * - 背景为毛玻璃（frosted glass）：当前主屏幕壁纸重度模糊 + 半透明玻璃罩——
 *   亮壁纸→奶白玻璃罩+深色文字，深壁纸→深色玻璃罩+白色文字（亮度实测自适应，与锁屏同一套测量）；
 *   上面横向滑动大圆角 App 卡片（App 按 390x844 真实尺寸渲染后等比缩放进卡片，1:1 还原真实界面，卡片不可交互）；
 * - 最近使用的卡片左上角带「正在使用」徽章；
 * - 卡片下方显示当前居中卡片的 App 图标 + 名称；
 * - 点击空白处返回主屏幕（前台 App 退到后台）；卡片上滑彻底关闭该 App。
 */
export default function AppSwitcher() {
  const open = useUI((s) => s.switcherOpen);
  const recentApps = useUI((s) => s.recentApps);
  const switchToApp = useUI((s) => s.switchToApp);
  const closeSwitcher = useUI((s) => s.closeSwitcher);
  const exitForegroundApp = useUI((s) => s.exitForegroundApp);
  const killApp = useUI((s) => s.killApp);
  // v1.9.21：吃醋锁冻结态变化时重渲染卡片（锁定/解锁即时反映）
  useSyncExternalStore(subscribeWebLock, getWebLockVersion);
  // 当前主屏幕壁纸（与手机壳同一张，随设置实时同步）；切换器背景模糊展示它
  const wallpaperStyle = useWallpaperStyle();
  // 毛玻璃明暗自适应：按壁纸亮度实测选玻璃罩配比与前景文字颜色（与锁屏/状态栏同一套测量）
  const wallpaperPreset = useSettings((s) => s.wallpaperPreset);
  const customWallpaperUrl = useSettings((s) => s.customWallpaperUrl);
  const measuredLight = useMeasuredWallpaperLight(wallpaperStyle);
  // 第三十四轮：Android WebView 下 backdrop-filter 光栅化缺陷（毛玻璃/液态图标模式下
  // 切换器背景塌纯黑 + 卡片内容塌灰块——机主真机截图实测），改静态缩图模糊实现
  const webview = useAndroidWebView();

  /** 本地退出动画中（点击空白/上滑横杠时先播放淡出再真正关闭）；退出即回主屏幕 */
  const [closing, setClosing] = useState(false);
  const [shown, setShown] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  /** 第三十三轮：卡片行可用高度（滚动容器实测，ResizeObserver 跟随——短屏机型
   *  （如 360×800 WebView：64+卡片 541+图标行 52+提示 22+横杠 30 超出视口）卡片
   *  底部被硬裁（机主截图反馈「后台应用卡片有点问题：卡到一半被切、底部圆角没了」），
   *  现按可用高自适应卡片尺寸（保持 390:844 等比，宽度随之收窄），任何屏都完整展示 */
  // 第三十三轮：卡片行可用高度实测（打开后 rAF 首帧量一次 + ResizeObserver 跟随
  // 旋屏/窗口变化；老 WebView 无 RO 时一次性测量仍生效，旋屏后重开重测）。
  // 量的是滚动容器内容盒高——卡片净可用 = 容器高 - 上下 py-12（96px 阴影呼吸位）。
  // 第三十六轮：同步量容器宽（卡片「太小了」按机主反馈放大：宽 78% 屏幅，上限 340）。
  const [availH, setAvailH] = useState<number | null>(null);
  const [availW, setAvailW] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ id: AppId; dy: number } | null>(null);
  const [killing, setKilling] = useState<AppId | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pointer = useRef<{ id: AppId; x: number; y: number; axis: 'x' | 'y' | null } | null>(null);
  /** 本次按压是否已判定为拖拽（抑制随后的 click 误触打开） */
  const movedRef = useRef(false);
  // 主屏幕指示条：上滑返回主屏幕
  const barY = useRef<number | null>(null);
  // #64：onScroll rAF 节流——避免每个 scroll 事件都 setState 触发重渲染（快速横滑密集触发）
  const scrollRafRef = useRef<number | null>(null);

  // 进场动画 + 打开时重置轮播位置（setState 均在 rAF 回调内，非 effect 同步调用）
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setShown(true);
        setActiveIdx(0);
      })
    );
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // 第三十六轮：切换器打开期间全局禁用 backdrop-filter（html.task-switching）——
  // WebView 卡片改实况渲染真实界面后，App 内大量 backdrop-blur 元素在旧 Chromium
  // 光栅化下会塔灰块（机主真机实测）；打开期间整页 backdrop-filter 临时关闭
  // （全部被切换器全屏覆盖遮住，无视觉感知），关闭/卸载时同步摘除。
  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add('task-switching');
    return () => document.documentElement.classList.remove('task-switching');
  }, [open]);

  // #64：组件卸载时清理 onScroll rAF 节流挂起的回调
  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  // 第三十三轮：卡片行可用高度实测（打开后 rAF 首帧量一次 + ResizeObserver 跟随
  // 旋屏/窗口变化；老 WebView 无 RO 时一次性测量仍生效，旋屏后重开重测）。
  // 量的是滚动容器内容盒高——卡片净可用 = 容器高 - 上下 py-12（96px 阴影呼吸位）。
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      setAvailH(el.clientHeight);
      setAvailW(el.clientWidth);
    };
    const raf = requestAnimationFrame(measure);
    try {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    } catch {
      /* 无 RO 环境静默 */
    }
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [open]);

  if (!open && !closing) return null;

  // 毛玻璃明暗（WallpaperLightness 返回布尔：true=该区域偏浅 / null=测量中）：
  // 上、下区域都实测为亮 → 奶白玻璃+深色文字；全暗/上亮下暗/测量中回退 → 深色玻璃+白色文字（对比度最稳）
  const presetMeta = WALLPAPER_PRESETS.find((w) => w.id === wallpaperPreset);
  const staticLight = !customWallpaperUrl && (presetMeta?.light ?? false);
  const topLight = measuredLight.top;
  const bottomLight = measuredLight.bottom;
  const lightGlass =
    topLight != null && bottomLight != null
      ? topLight && bottomLight
      : (topLight ?? bottomLight ?? staticLight);

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    setShown(false);
    // 立即把前台 App 退到后台（淡出时露出的是主屏幕，不会中途跳变）
    exitForegroundApp();
    window.setTimeout(() => {
      closeSwitcher();
      setClosing(false);
    }, 240);
  };

  const CARD_GAP = 20; // gap-5
  // 第三十六轮：卡片放大（机主反馈「卡片太小了」）——目标宽 = 容器宽 78%
  // （iOS 切换器同比例），上限 340；再受可用高预算约束等比收窄（短屏机型完整展示）。
  // （第三十三轮旧基准：固定 250 起步 → 升到 78% 屏幅，390 逻辑屏上≈304、短屏自适应）
  const CARD_W_TARGET = availW != null ? Math.round(availW * 0.78) : 305;
  const CARD_W_BASE = Math.min(340, Math.max(250, CARD_W_TARGET));
  const budgetH = availH != null ? availH - 96 : null; // 减 py-12×2（96px 阴影呼吸位）
  const CARD_W =
    budgetH != null
      ? Math.min(CARD_W_BASE, Math.max(220, Math.round((budgetH * SCREEN_W) / SCREEN_H)))
      : CARD_W_BASE;
  const CARD_H = Math.round((SCREEN_H * CARD_W) / SCREEN_W);
  const PREVIEW_SCALE = CARD_W / SCREEN_W;
  const STEP = CARD_W + CARD_GAP;

  const onScroll = () => {
    // #64：rAF 节流——一个 frame 内多次 scroll 事件合批为单次 setActiveIdx。
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      setActiveIdx(Math.round(el.scrollLeft / STEP));
    });
  };

  // ---------------- 卡片手势：纵向拖动 = 上滑关闭；横向交给原生滚动 ----------------
  const onCardPointerDown = (e: React.PointerEvent<HTMLElement>, id: AppId) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (killing) return;
    movedRef.current = false;
    pointer.current = { id, x: e.clientX, y: e.clientY, axis: null };
  };

  const onCardPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const p = pointer.current;
    if (!p || killing) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.axis) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) p.axis = 'x';
      else if (Math.abs(dy) > 8) p.axis = 'y';
      else return;
    }
    movedRef.current = true;
    if (p.axis === 'y' && dy < 0) setDrag({ id: p.id, dy });
  };

  const onCardPointerUp = (e: React.PointerEvent<HTMLElement>, id: AppId) => {
    const p = pointer.current;
    pointer.current = null;
    if (!p || killing) return;
    const dy = e.clientY - p.y;
    if (p.axis === 'y' && dy < -100) {
      // 上滑关闭：先播放飞出动画再移除
      setDrag(null);
      setKilling(id);
      try {
        navigator.vibrate?.(10);
      } catch {
        /* 震动不可用 */
      }
      window.setTimeout(() => {
        killApp(id);
        setKilling(null);
        const rest = useUI.getState().recentApps;
        setActiveIdx((i) => Math.max(0, Math.min(i, rest.length - 1)));
        if (rest.length === 0) requestClose();
      }, 260);
    } else {
      setDrag(null);
    }
  };

  const onCardClick = (id: AppId) => {
    if (movedRef.current) {
      movedRef.current = false; // 拖拽/滑动后的 click 不算点击
      return;
    }
    if (killing) return;
    switchToApp(id); // 无论当前是否有 App 在前台，直接切到目标 App
  };

  const onBackdropClick = (e: React.MouseEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    if (!t.closest('[data-card-zone]')) requestClose();
  };

  const focusApp = recentApps[Math.min(activeIdx, recentApps.length - 1)];

  return (
    <div
      data-bleed=""
      className={`absolute inset-0 z-[60] flex flex-col transition-opacity duration-[240ms] ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ pointerEvents: open && !closing ? 'auto' : 'none' }}
      onClick={onBackdropClick}
      role="dialog"
      aria-label="多任务切换器"
    >
      {/* 背景：毛玻璃（frosted glass）。
          主体 backdrop-filter：直接对身后真实画面（主屏壁纸+图标 / 被切换 App 的画面）模糊——iOS 同款实现。
          不再用「复制壁纸层 + filter:blur(56px)」的超大模糊层：移动端 Chrome 对超大 blur 层有光栅化 bug
          （会整块发黑/顶部漏出未模糊的原图条带），且复制层 cover 缩放与真实壁纸存在错位；
          底下保留一张「不模糊的壁纸拷贝」：根节点 opacity 渐入渐出（<1）时会成为 backdrop 采样边界、
          页面内容不参与采样，这张拷贝保证淡入淡出全程玻璃都有内容可模糊（也兜底不支持 backdrop 的环境）。
          玻璃罩两层：白色半透明罩提亮 + 轻压暗罩保对比度——
          亮壁纸=奶白毛玻璃（白 0.42/黑 0.06）配深色文字；深壁纸=深色毛玻璃（白 0.08/黑 0.20）配白色文字；
          深色压暗从旧版 0.30 减到 0.20：壁纸的色彩明暗纹理能透过玻璃看出来，不再糊成一团死黑。
          【第三十四轮 WebView 分支】Android WebView（旧 Chromium）的 backdrop-filter 光栅化
          缺陷：毛玻璃/液态图标模式下切换器 46px 超大 backdrop-filter 采样含 24 枚嵌套
          backdrop-blur 的图标 → 整帧 backdrop-filter 塌缩成黑/灰块（机主真机实测：背景纯黑、
          卡片内容全灰无文字）。WebView 下改「静态缩图模糊」：60×128 小图层 blur(3px)
          （光栅成本趋近零）+ transform scale(8) 双线性放大（天然雾面）+ 玻璃罩同款双层 ——
          不采样任何 backdrop，从根本上免疫该缺陷；视觉上仍是壁纸雾化毛玻璃。 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ zIndex: -1 }}
      >
        {webview ? (
          /* WebView：静态缩图模糊（小图 + 轻模糊 + 8 倍放大 = 雾面壁纸，零 backdrop-filter） */
          <div
            className="absolute left-1/2 top-1/2 h-[128px] w-[60px]"
            style={{
              ...wallpaperStyle,
              filter: 'blur(3px) saturate(1.35) brightness(1.06)',
              transform: 'translate(-50%, -50%) scale(8)',
            }}
          />
        ) : (
          /* 浏览器：backdrop-filter 实时毛玻璃（原实现） */
          <>
            <div className="absolute inset-0" style={wallpaperStyle} />
            <div
              className="absolute inset-0"
              style={{
                backdropFilter: 'blur(46px) saturate(1.65) brightness(1.1)',
                WebkitBackdropFilter: 'blur(46px) saturate(1.65) brightness(1.1)',
              }}
            />
          </>
        )}
        <div
          className="absolute inset-0"
          style={{ background: lightGlass ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.08)' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: lightGlass ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.20)' }}
        />
      </div>

      {/* 顶部留出状态栏 + 灵动岛（v1.9.46 ph-switcher-top：APK 里叠加真实安全区——毛玻璃根已出血铺满物理屏，
          系统状态栏浮在玻璃上，卡片行从安全区下方开始） */}
      <div className="ph-switcher-top h-[64px] shrink-0" />

      {/* 卡片横向轮播。
          滚动容器必须带垂直内边距（py-12）：外层 items-center 会把它收缩到正好卡片高，
          overflow-x-auto 的裁剪边界于是恰好压在卡片上下边缘——卡片阴影会被硬切成一条横贯
          全屏的「线条」（用户反馈的背景分隔线）；上下各留 48px（> 阴影延展 ≈38px）后阴影
          在边界内自然衰减，卡片位置因对称居中保持不变 */}
      <div className="flex min-h-0 flex-1 items-center">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className={`no-scrollbar flex w-full snap-x snap-mandatory gap-5 overflow-x-auto py-12 transition-transform duration-[240ms] ease-out ${
            shown ? 'translate-y-0 scale-100' : 'translate-y-4 scale-[0.96]'
          }`}
          style={{ paddingLeft: 'max(24px, calc((100% - ' + CARD_W + 'px) / 2))', paddingRight: 'max(24px, calc((100% - ' + CARD_W + 'px) / 2))' }}
        >
          {recentApps.length === 0 && (
            <p
              className={`w-full py-16 text-center text-[14px] ${
                lightGlass ? 'text-black/55' : 'text-white/55'
              }`}
            >
              最近使用的 App 会显示在这里
            </p>
          )}
          {recentApps.map((id, i) => {
            const meta = APP_MAP[id];
            if (!meta) return null;
            const isDrag = drag?.id === id;
            const isKilling = killing === id;
            // 卡片阴影务必「小半径+低透明度」：大 blur/高 α 阴影在均匀毛玻璃底上会拉出可见的渐变色带
            // （用户看到的「卡片上下横线」），且纵向延展一旦超过卡片与滚动容器的上下空隙（≈67px）
            // 还会被 overflow 裁出硬切边；0 10px 28px 延展 ≈38px，两样都碰不到
            return (
              <div
                key={id}
                data-card-zone
                role="button"
                tabIndex={0}
                aria-label={`打开${meta.name}`}
                className="relative shrink-0 snap-center overflow-hidden rounded-[30px] bg-background shadow-[0_10px_28px_rgba(0,0,0,0.30)] ring-1 ring-white/10"
                style={{
                  width: CARD_W,
                  height: CARD_H,
                  touchAction: 'pan-x',
                  transform: isDrag
                    ? `translateY(${drag.dy}px) scale(${Math.max(0.85, 1 + drag.dy / 2400)})`
                    : isKilling
                      ? 'translateY(-130%) scale(0.88)'
                      : undefined,
                  opacity: isKilling ? 0 : 1,
                  transition: isDrag ? 'none' : 'transform 0.26s ease, opacity 0.26s ease',
                }}
                onPointerDown={(e) => onCardPointerDown(e, id)}
                onPointerMove={onCardPointerMove}
                onPointerUp={(e) => onCardPointerUp(e, id)}
                onPointerCancel={() => {
                  pointer.current = null;
                  setDrag(null);
                }}
                onClick={() => onCardClick(id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') switchToApp(id);
                }}
              >
                {/* 「正在使用」徽章（最新使用；WebView 下免 backdrop-blur——旧 Chromium 光栅化风险） */}
                {i === 0 && !isKilling && (
                  <span
                    className={`absolute left-2.5 top-2.5 z-10 rounded-full bg-[#1c1c1e]/85 px-2.5 py-[5px] text-[12px] font-medium leading-none text-white ring-1 ring-white/25 ${
                      webview ? '' : 'backdrop-blur-sm'
                    }`}
                  >
                    正在使用
                  </span>
                )}
                {/* v1.9.21 吃醋锁：被冻结的 App 卡片盖深色遮罩+小锁（预览置灰不可辨，点卡片弹全屏留言；
                    WebView 下免 backdrop-blur） */}
                {isWebAppFrozen(id) && !isKilling && (
                  <div
                    className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/60 ${
                      webview ? '' : 'backdrop-blur-[2px]'
                    }`}
                    data-testid={`web-frozen-card-${id}`}
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#ff5c8a]/90 shadow-lg">
                      <Lock size={18} strokeWidth={2.4} className="text-white" aria-hidden />
                    </span>
                    <span className="text-[13px] font-medium text-white">由 {webFrozenBy(id) ?? 'TA'} 锁住了</span>
                    <span className="text-[11px] text-white/55">哄好 TA 或等倒计时结束才能打开</span>
                  </div>
                )}
                {/* 卡片预览（第三十六轮：统一实况渲染真实界面）：
                    按 390x844 真实尺寸渲染后整体等比缩放进卡片（1:1 还原界面观感，
                    不可交互；相机特殊处理避免重复占用摄像头）——Android WebView 同样
                    实况渲染（机主要求「后台卡片要真实的界面」）；灰块风险由切换器
                    打开期间全局禁用 backdrop-filter（html.task-switching）兜底，
                    背景 WebView 侧仍走第三十四轮静态缩图模糊（超大 backdrop 采样
                    是实锤缺陷，小面积 App 内元素经全局禁用后无碍）。 */}
                <div className="pointer-events-none h-full w-full select-none overflow-hidden">
                  {id === 'camera' ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-black text-white/35">
                      <Camera className="h-12 w-12" strokeWidth={1.2} />
                      <span className="text-[13px]">相机</span>
                    </div>
                  ) : (
                    <div
                      style={{
                        width: SCREEN_W,
                        height: SCREEN_H,
                        transform: `scale(${PREVIEW_SCALE})`,
                        transformOrigin: 'top left',
                      }}
                    >
                      <meta.component />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 当前居中卡片：图标 + 名称 */}
      <div className="flex h-[52px] shrink-0 items-center justify-center gap-2.5">
        {focusApp && APP_MAP[focusApp] && (
          <>
            {/* 30px 小尺寸下图标必须是「圆角方形」而非圆形：registry 的 RealIconTile 内层
                写死 rounded-[15px]（按 60px 主屏槽位设计），作用到 30px 槽位正好内切成圆——
                这里用子选择器压掉内层圆角与自带投影，圆角交给本容器 rounded-[8px] 统一裁剪 */}
            <span className="block h-[30px] w-[30px] overflow-hidden rounded-[8px] ring-1 ring-black/10 [&>div>span]:rounded-none [&>div>span]:shadow-none">
              {/* 图标随全局「图标样式」三选一实时变化（主题页切换后多任务同步） */}
              <AppIconById id={focusApp} />
            </span>
            <span className={`text-[16px] font-medium ${lightGlass ? 'text-black/85' : 'text-white'}`}>
              {APP_MAP[focusApp].name}
            </span>
          </>
        )}
      </div>

      {/* 底部提示 */}
      <p className={`shrink-0 pb-1 text-center text-[13px] ${lightGlass ? 'text-black/55' : 'text-white/55'}`}>
        点击空白处返回主屏幕 · 上滑卡片可关闭应用
      </p>

      {/* 主屏幕指示条：上滑返回主屏幕
          （Pointer 事件：鼠标/触摸统一支持，旧 touch 实现桌面鼠标无法触发；
          pointerdown 时捕获指针，滑出横杠后 move 仍持续跟踪，一下就能触发） */}
      <div
        aria-hidden="true"
        className="z-[5] flex h-[30px] shrink-0 touch-none items-end justify-center pb-[8px]"
        onPointerDown={(e) => {
          barY.current = e.clientY;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* 捕获不可用时退化为仅跟踪元素内移动 */
          }
        }}
        onPointerMove={(e) => {
          if (barY.current !== null && barY.current - e.clientY > 24) {
            barY.current = null;
            requestClose();
          }
        }}
        onPointerUp={() => {
          barY.current = null;
        }}
        onPointerCancel={() => {
          barY.current = null;
        }}
      >
        <div className={`h-[5px] w-[134px] rounded-full ${lightGlass ? 'bg-black/80' : 'bg-white/90'}`} />
      </div>
    </div>
  );
}
