'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import {
  useUI,
  useWallpaperStyle,
  useSettings,
  useMeasuredWallpaperLight,
  WALLPAPER_PRESETS,
  type AppId,
} from '@/lib/ios/store';
import { APP_MAP, AppIconById } from '../apps/registry';

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
  // 当前主屏幕壁纸（与手机壳同一张，随设置实时同步）；切换器背景模糊展示它
  const wallpaperStyle = useWallpaperStyle();
  // 毛玻璃明暗自适应：按壁纸亮度实测选玻璃罩配比与前景文字颜色（与锁屏/状态栏同一套测量）
  const wallpaperPreset = useSettings((s) => s.wallpaperPreset);
  const customWallpaperUrl = useSettings((s) => s.customWallpaperUrl);
  const measuredLight = useMeasuredWallpaperLight(wallpaperStyle);

  /** 本地退出动画中（点击空白/上滑横杠时先播放淡出再真正关闭）；退出即回主屏幕 */
  const [closing, setClosing] = useState(false);
  const [shown, setShown] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
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

  // #64：组件卸载时清理 onScroll rAF 节流挂起的回调
  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

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

  const CARD_W = 250; // 变窄版卡片
  const CARD_H = Math.round((SCREEN_H * CARD_W) / SCREEN_W); // 保持与真机屏幕 1:1 比例
  const PREVIEW_SCALE = CARD_W / SCREEN_W;
  const CARD_GAP = 20; // gap-5
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
          深色压暗从旧版 0.30 减到 0.20：壁纸的色彩明暗纹理能透过玻璃看出来，不再糊成一团死黑 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ zIndex: -1 }}
      >
        <div className="absolute inset-0" style={wallpaperStyle} />
        <div
          className="absolute inset-0"
          style={{
            backdropFilter: 'blur(46px) saturate(1.65) brightness(1.1)',
            WebkitBackdropFilter: 'blur(46px) saturate(1.65) brightness(1.1)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{ background: lightGlass ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.08)' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: lightGlass ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.20)' }}
        />
      </div>

      {/* 顶部留出状态栏 + 灵动岛 */}
      <div className="h-[64px] shrink-0" />

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
                {/* 「正在使用」徽章（最新使用） */}
                {i === 0 && !isKilling && (
                  <span className="absolute left-2.5 top-2.5 z-10 rounded-full bg-[#1c1c1e]/80 px-2.5 py-[5px] text-[12px] font-medium leading-none text-white ring-1 ring-white/25 backdrop-blur-sm">
                    正在使用
                  </span>
                )}
                {/* 实时 App 预览：按真机 390x844 尺寸渲染后整体等比缩小（1:1 还原界面观感，不可交互；相机特殊处理避免重复占用摄像头） */}
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
