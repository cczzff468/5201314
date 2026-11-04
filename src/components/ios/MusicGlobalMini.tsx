'use client';

/**
 * 全局迷你播放器（第十六轮反馈，第十八/二十/二十一轮修订）：音乐在播时，主屏幕/其他 App 上悬浮的播放控件。
 *
 * 两种显示形态（可互相切换，选择持久化在 localStorage）：
 * - bar    迷你小条（第十八轮反馈：变小+可拖动）：封面 + 歌名 - 歌手 + 播放/暂停 + 列表 + 换样式，
 *          点按条身打开播放页；可在屏幕内任意拖动；右侧唱片图标按钮切换样式（条 ↔ 唱片）；
 * - record 悬浮圆形唱片：点按 = 换样式（切回底部条），可在屏幕内任意拖动；
 *
 * 边缘停靠（第二十一轮反馈：迷你播放器不再有「隐藏」形态，不会消失）：
 * - 圆形唱片状态下，把它左滑/右滑到屏幕边缘松手 → 藏进边缘里只露一条 ~6px 的边框；
 * - 点按露出的边框（边缘有加宽透明热区）→ 唱片弹回之前的位置；
 * - 停靠侧持久化（localStorage），刷新后保持（左停靠的精确位置在挂载后补测层宽得出）；
 * - 右上角 ✕ 按钮已按第二十三轮反馈删除（进停靠态只靠拖到边缘松手）。
 *
 * 实现备注（第二十一轮调试）：子组件 useLayoutEffect 阶段父层 ref 尚未挂上（React 提交顺序），
 * 层宽测量放在 passive useEffect / 拖停时实时读取 getBoundingClientRect。
 *
 * 显示条件：有正在播放/上次的歌 && 未锁屏 && 未熄屏 && 切换器未打开 && 音乐 App 不在前台
 * （音乐 App 内有自己的迷你条，避免双重显示）。离开显示条件后延迟 350ms 卸载：
 * 接住「点按开播放页→卸载→原生 click 落空穿透到底下 App」的竞态（第二十轮修复）。
 *
 * 层级 z-[55]：高于 App 窗口（z-40），低于多任务切换器（z-60）/锁屏（z-65）/状态栏（z-70），
 * 来电/通话等更高层级界面自然盖住。
 */

import { create } from 'zustand';
import { useEffect, useRef, useState } from 'react';
import { motion, type PanInfo } from 'framer-motion';
import { Disc3, ListMusic, Pause, Play } from 'lucide-react';
import { useUI } from '@/lib/ios/store';
import { useMusic, getGuestAvatar } from '@/lib/ios/music-store';
import { useTogetherLive } from '@/lib/ios/music-ai';
import { songArtistText, songCover } from '@/lib/ios/music-api';

// ---------------- 形态/停靠状态（模块级 store：悬浮组件与播放页 ⋮ 面板共用） ----------------

export type MiniMode = 'bar' | 'record';
/** 唱片停靠侧：null = 自由悬浮（第二十一轮反馈） */
export type MiniDock = 'left' | 'right' | null;

const MODE_KEY = 'music-mini-mode';
const DOCK_KEY = 'music-mini-dock';

export const MINI_MODE_LABELS: Record<MiniMode, string> = {
  bar: '底部迷你条',
  record: '悬浮唱片',
};

function readModeFromStorage(): MiniMode {
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    // 第二十一轮：hidden 形态已移除（迷你播放器不再消失），旧存档回退为底部条
    return v === 'record' ? 'record' : 'bar';
  } catch {
    return 'bar';
  }
}

function readDockFromStorage(): MiniDock {
  try {
    const v = window.localStorage.getItem(DOCK_KEY);
    return v === 'left' || v === 'right' ? v : null;
  } catch {
    return null;
  }
}

function writeDockStorage(d: MiniDock): void {
  try {
    if (d) window.localStorage.setItem(DOCK_KEY, d);
    else window.localStorage.removeItem(DOCK_KEY);
  } catch {
    /* 存储不可用仅本次会话生效 */
  }
}

interface MiniPlayerUiState {
  mode: MiniMode;
  setMode: (m: MiniMode) => void;
  /** 循环切换：底部条 ↔ 悬浮唱片（第二十一轮：不再有隐藏形态） */
  cycle: () => MiniMode;
  dock: MiniDock;
  setDock: (d: MiniDock) => void;
  /** 场景压制（拾光小屋）：App 内音乐家具正在放歌时置 true，全局迷你播放器临时隐藏（挂载方负责复位） */
  suppress: boolean;
  setSuppress: (v: boolean) => void;
}

export const useMiniPlayer = create<MiniPlayerUiState>((set, get) => ({
  suppress: false,
  setSuppress: (v) => set({ suppress: v }),
  mode: 'bar',
  setMode: (m) => {
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      /* 存储不可用仅本次会话生效 */
    }
    set({ mode: m });
  },
  cycle: () => {
    const next: MiniMode = get().mode === 'bar' ? 'record' : 'bar';
    get().setMode(next);
    return next;
  },
  dock: null,
  setDock: (d) => {
    writeDockStorage(d);
    set({ dock: d });
  },
}));

if (typeof window !== 'undefined') {
  useMiniPlayer.setState({ mode: readModeFromStorage(), dock: readDockFromStorage() });
}

// ---------------- 组件 ----------------

/** 全局打开播放页：先把音乐 App 切到前台，再把导航置为播放页（两步都是同步 store 写入，挂载后直接渲染播放页） */
function openPlayerGlobal() {
  useMusic.getState().openPlayer();
  useUI.getState().switchToApp('music');
}

/** 内部小按钮的原生 pointer 拦截：阻止冒泡到父级 motion.div（否则按按钮会同时触发拖拽/换样式 tap）。
 *  与唱片 ✕ 同款方案；React onClick 不受影响（stopPropagation 只阻断冒泡，不取消本元素点击） */
function useStopPointerBubble(
  ref: React.RefObject<HTMLElement | null>,
  deps: unknown[],
): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const buttons = Array.from(root.querySelectorAll('button'));
    const offs: Array<() => void> = [];
    for (const el of buttons) {
      const stop = (e: Event) => e.stopPropagation();
      el.addEventListener('pointerdown', stop);
      el.addEventListener('pointerup', stop);
      offs.push(() => {
        el.removeEventListener('pointerdown', stop);
        el.removeEventListener('pointerup', stop);
      });
    }
    return () => offs.forEach((f) => f());
  }, deps);
}

// ---------------- 触屏合成点击吸收垫（v59 修复「点迷你播放器连带打开底下 App」） ----------------

/**
 * 根因（触屏专属，鼠标不受影响）：迷你播放器的点按动作在 pointerup 里同步执行——
 * 唱片点按切回条形（唱片当场卸载、条形在别处挂载）、拖到边缘松手停靠（唱片弹走）、
 * 点条身开播放页（层隐身）——而真实触摸的浏览器要等 touchend 之后才合成
 * mousedown/mouseup/click，合成事件按**当时的坐标**重新命中检测：迷你播放器已不在
 * 原地 → 合成点击落到底下的 App 图标/按钮上，「点播放器连带把底下 App 打开」。
 * （条身开播放页有 350ms 隐身层接住；唱片切样式/停靠松手没有——本垫补齐。）
 *
 * 修复：点按/停靠松手瞬间在指针落点「布防」：window 捕获阶段的 mousedown/mouseup/click
 * 只要在布防坐标 ±32px 内且 450ms 未过期，一律 preventDefault + stopPropagation
 * （合成点击到不了底下的图标）；吞完 click 自动作废；远离布防坐标的正常点击不受影响。
 */
const ABSORB_RADIUS = 32;
const ABSORB_MS = 450;
let tapAbsorb: { x: number; y: number; until: number } | null = null;

function swallowArmed(e: MouseEvent): void {
  if (!tapAbsorb) return;
  if (performance.now() > tapAbsorb.until) {
    tapAbsorb = null;
    return;
  }
  if (Math.hypot(e.clientX - tapAbsorb.x, e.clientY - tapAbsorb.y) > ABSORB_RADIUS) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.type === 'click') tapAbsorb = null; // 完整吞掉一次合成点击序列即收工
}

if (typeof window !== 'undefined') {
  window.addEventListener('mousedown', swallowArmed, true);
  window.addEventListener('mouseup', swallowArmed, true);
  window.addEventListener('click', swallowArmed, true);
}

/** 在指针落点布防合成点击吸收垫（点按/松手动作触发前调用） */
function armTapAbsorb(x: number, y: number): void {
  tapAbsorb = { x, y, until: performance.now() + ABSORB_MS };
}

/** 点按判定（拖拽与点按共存的确定性方案）：pointerdown 记录起点，pointerup 位移 <6px 视为点按。
 *  不用 framer 的 onTap：拖拽结束的 pointerup 与 drag 完成标记存在竞态，拖拽后可能误触发点按。
 *  v59：点按动作会当场改写/卸载迷你播放器 DOM，先在指针落点布防合成点击吸收垫
 *  （详见上方「触屏合成点击吸收垫」注释） */
function useTapGuard(action: () => void) {
  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!down.current) return;
    const d = Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y);
    down.current = null;
    if (d < 6) {
      armTapAbsorb(e.clientX, e.clientY);
      action();
    }
  };
  return { onPointerDown, onPointerUp };
}

/** 迷你小条形态（第十八轮反馈：变小 + 可在屏幕内任意拖动）：
 *  条身点按打开播放页（位移判定的 tap）；内部按钮原生拦截不参与拖拽/点按 */
function GlobalMiniBar({ layerRef }: { layerRef: React.RefObject<HTMLDivElement | null> }) {
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const position = useMusic((s) => s.position);
  const duration = useMusic((s) => s.duration);
  const loginUid = useMusic((s) => s.loginUid);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  const live = useTogetherLive();
  // 播放进度（圆环用）：与音乐 App 内迷你条同款——深色弧段=已播，浅灰整圆=未播轨道
  const progress = current && duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const CIRC = 2 * Math.PI * 14.5;
  const cycle = useMiniPlayer((s) => s.cycle);
  const barRef = useRef<HTMLDivElement | null>(null);
  useStopPointerBubble(barRef, [current?.id, live]);
  const tap = useTapGuard(openPlayerGlobal);
  if (!current) return null;
  return (
    <motion.div
      ref={barRef}
      drag
      dragConstraints={layerRef}
      dragElastic={0.08}
      dragMomentum={false}
      onPointerDown={tap.onPointerDown}
      onPointerUp={tap.onPointerUp}
      className="pointer-events-auto absolute bottom-[36px] left-3 z-[55] flex h-[42px] touch-none select-none items-center gap-1.5 rounded-full bg-white pl-1 pr-1.5 shadow-[0_4px_18px_rgba(0,0,0,0.16)] dark:bg-zinc-800 dark:shadow-[0_4px_18px_rgba(0,0,0,0.6)]"
      data-testid="music-global-mini-bar"
    >
      {live ? (
        <span className="flex shrink-0 items-center">
          {/* live.avatar 可能为空串（联系人没头像/快照缺失）：空串 src 会触发浏览器整页重下载
              （React「An empty string was passed to the src attribute」控制台报错）——
              空时渲染首字占位圆，保持 34px 布局不跳动 */}
          {live.avatar ? (
            <img src={live.avatar} alt={live.name} className="h-[34px] w-[34px] rounded-full bg-muted object-cover" draggable={false} />
          ) : (
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-semibold text-muted-foreground" aria-hidden="true">
              {(live.name || '听').slice(0, 1)}
            </span>
          )}
          <img
            src={loginUid ? loginAvatar || getGuestAvatar() : getGuestAvatar()}
            alt="我"
            className="-ml-2.5 h-[34px] w-[34px] rounded-full object-cover ring-2 ring-white dark:ring-zinc-800"
            draggable={false}
          />
        </span>
      ) : (
        <img
          src={songCover(current)}
          alt={current.name}
          className="h-[34px] w-[34px] shrink-0 rounded-full bg-muted object-cover"
          draggable={false}
        />
      )}
      <span
        className="min-w-0 max-w-[104px] truncate text-[12px] leading-none"
        data-testid="music-global-mini-open"
      >
        <span className="font-bold text-zinc-900 dark:text-zinc-100">{current.name}</span>
        <span className="text-zinc-400 dark:text-zinc-500"> - {songArtistText(current)}</span>
      </span>
      <button
        type="button"
        onClick={() => useMusic.getState().toggle()}
        data-testid="music-global-mini-toggle"
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-800 active:scale-95 dark:text-zinc-100"
        aria-label={playing ? '暂停' : '播放'}
      >
        {/* 进度环（与音乐 App 迷你条同款）：深色弧段=已播，浅灰整圆=未播轨道，12 点顺时针 */}
        <svg viewBox="0 0 32 32" aria-hidden="true" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx="16" cy="16" r="14.5" fill="none" strokeWidth="2.5" className="stroke-zinc-300 dark:stroke-zinc-600" />
          {progress > 0 && (
            <circle
              cx="16"
              cy="16"
              r="14.5"
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - progress)}
              className="stroke-zinc-800 transition-[stroke-dashoffset] duration-300 dark:stroke-zinc-100"
            />
          )}
        </svg>
        {playing ? <Pause className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="ml-0.5 h-3.5 w-3.5" fill="currentColor" />}
      </button>
      <button
        type="button"
        onClick={openPlayerGlobal}
        aria-label="播放列表"
        className="flex h-8 w-7 shrink-0 items-center justify-center text-zinc-800 active:scale-95 dark:text-zinc-100"
      >
        <ListMusic className="h-[18px] w-[18px]" />
      </button>
      {/* 形态切换：底部条 ↔ 悬浮唱片（点按即换样式；第二十一轮：不再切到隐藏） */}
      <button
        type="button"
        onClick={() => cycle()}
        data-testid="music-global-mini-mode"
        aria-label="切换迷你播放器样式"
        title="切换迷你播放器样式"
        className="flex h-8 w-7 shrink-0 items-center justify-center text-zinc-500 active:scale-95 dark:text-zinc-400"
      >
        <Disc3 className="h-[17px] w-[17px]" />
      </button>
    </motion.div>
  );
}

/** 唱片几何：right-[10px] 锚点 + 56px 直径；停靠后只露 PEEK px 的边框 */
const RECORD_SIZE = 56;
const RECORD_INSET = 10;
const PEEK = 6;
/** 松手时唱片中心距屏幕左右边缘 <46px 判定为「滑进边缘停靠」 */
const DOCK_SNAP_PX = 46;
/** 右停靠位移（相对 right-[10px] 锚点）：10 + 56 - 6，恒定无需测量 */
const DOCK_X_RIGHT = RECORD_INSET + RECORD_SIZE - PEEK;

/** 悬浮唱片形态（第二十一轮交互重做）：
 *  - 自由态：可任意拖动；点按 = 换样式（切回底部条）；
 *  - 拖到屏幕左/右边缘松手 → 藏进边缘只露一条边框；
 *  - 停靠态：点边框（或边缘热区）弹回原位置；不可拖动（避免和「点边框显示」打架）。
 *  第二十三轮反馈：右上角 ✕ 按钮删除。 */
function GlobalMiniRecord({ layerRef }: { layerRef: React.RefObject<HTMLDivElement | null> }) {
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const setMode = useMiniPlayer((s) => s.setMode);
  const dock = useMiniPlayer((s) => s.dock);
  const setDock = useMiniPlayer((s) => s.setDock);
  // 点按：停靠态 = 弹回；自由态 = 换样式（读 store 避免闭包过期）
  const tap = useTapGuard(() => {
    const s = useMiniPlayer.getState();
    if (s.dock) s.setDock(null);
    else s.setMode('bar');
  });
  // 自由拖拽的落点（x 相对布局锚点偏移；停靠切换由 animate 接管，弹回时回到这个位置）
  const [freeX, setFreeX] = useState(0);
  // 左停靠位移（相对锚点）。拖停入左缘时按实时 rect 精确计算（无跳动）；
  // 刷新恢复时没有拖拽事件，用 passive effect 补测层宽得出（useLayoutEffect 阶段父层 ref 未挂上）
  const [dockXLeft, setDockXLeft] = useState<number | null>(null);
  const recRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (dock !== 'left' || dockXLeft !== null) return;
    // rAF 回调里测量并写入（effect 体内同步 setState 会触发级联渲染告警）；
    // 测量完成前唱片以 opacity-0 隐藏，不会闪现在锚点位置
    const raf = requestAnimationFrame(() => {
      const w = layerRef.current?.clientWidth ?? 0;
      if (w > 0) setDockXLeft(RECORD_INSET + PEEK - w);
    });
    return () => cancelAnimationFrame(raf);
  }, [dock, dockXLeft, layerRef]);

  const x =
    dock === 'right'
      ? DOCK_X_RIGHT
      : dock === 'left'
        ? (dockXLeft ?? 0)
        : freeX;

  const onDragEnd = (_e: unknown, info: PanInfo): void => {
    // v59：松手可能触发停靠弹走（唱片滑入边缘）→ 在松手点布防合成点击吸收垫防穿透
    armTapAbsorb(info.point.x, info.point.y);
    const rect = recRef.current?.getBoundingClientRect();
    const lRect = layerRef.current?.getBoundingClientRect();
    if (rect && lRect) {
      const cx = rect.left + rect.width / 2;
      if (cx <= lRect.left + DOCK_SNAP_PX) {
        // 目标视觉左缘 = -(56-6)；当前视觉左缘 = rect.left - lRect.left
        // 新位移 = offsetX + (目标 - 当前)，等价于 RECORD_INSET + PEEK - 层宽（无需状态层宽）
        setDockXLeft(info.offset.x + (-(RECORD_SIZE - PEEK) - (rect.left - lRect.left)));
        setDock('left');
        return;
      }
      if (cx >= lRect.right - DOCK_SNAP_PX) {
        setDock('right');
        return;
      }
    }
    setFreeX(info.offset.x);
  };

  if (!current) return null;
  return (
    <>
      <motion.div
        ref={recRef}
        drag={!dock}
        dragConstraints={layerRef}
        dragElastic={0.08}
        dragMomentum={false}
        onPointerDown={tap.onPointerDown}
        onPointerUp={tap.onPointerUp}
        onDragEnd={onDragEnd}
        animate={{ x }}
        transition={dock ? { type: 'spring', stiffness: 380, damping: 32 } : { duration: 0.16 }}
        className={`pointer-events-auto absolute right-[10px] top-[38%] z-[55] touch-none select-none transition-opacity ${
          dock === 'left' && dockXLeft === null ? 'opacity-0' : 'opacity-100'
        }`}
        data-testid="music-global-mini-record"
      >
        <img
          src={songCover(current)}
          alt={current.name}
          draggable={false}
          className="h-[56px] w-[56px] rounded-full bg-muted object-cover shadow-[0_6px_20px_rgba(0,0,0,0.35)] ring-2 ring-white/70 dark:ring-white/20"
          style={{ animation: 'mini-spin 9s linear infinite', animationPlayState: playing ? 'running' : 'paused' }}
        />
      </motion.div>
      {/* 停靠态：露出的边框只有 ~6px 宽难点按，叠一条透明加宽热区（只占边缘一小段，点按弹回） */}
      {dock && (
        <div
          role="button"
          aria-label="展开迷你播放器"
          data-testid="music-global-mini-docked-hit"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={() => setDock(null)}
          className={`pointer-events-auto absolute top-[38%] z-[55] -mt-[6px] h-[68px] w-[18px] ${
            dock === 'right' ? 'right-0' : 'left-0'
          }`}
        />
      )}
    </>
  );
}

export default function MusicGlobalMini() {
  const current = useMusic((s) => s.current);
  const mode = useMiniPlayer((s) => s.mode);
  const suppress = useMiniPlayer((s) => s.suppress);
  const activeApp = useUI((s) => s.activeApp);
  const locked = useUI((s) => s.locked);
  const screenOff = useUI((s) => s.screenOff);
  const switcherOpen = useUI((s) => s.switcherOpen);
  // 拖动约束参照层：整个手机壳内域（唱片只能在本屏内上下拖）
  const layerRef = useRef<HTMLDivElement | null>(null);

  // suppress：拾光小屋等场景内音乐家具（唱片机/八音盒/音箱/钢琴/吉他）正在放歌时压制迷你播放器
  const visible = !!current && !locked && !screenOff && !switcherOpen && activeApp !== 'music' && !suppress;

  // 点击穿透修复（第二十轮反馈：点条身开播放页时，底下 App/图标也被打开）：
  // 点按 → 打开播放页 → activeApp='music' → visible 立即变 false；若此刻直接卸载，
  // 浏览器随后的原生 click 会「落空」重新命中当前位置下的 App 内容/图标（同一次点按穿透到底下 App）。
  // 延迟 350ms 再卸载：期间以透明层（opacity-0，条身仍 pointer-events-auto）留在原地接住这次 click，
  // click 落在条身/按钮上 = 无额外操作；350ms 后正常卸载。
  const [mounted, setMounted] = useState(visible);
  const [prevVisible, setPrevVisible] = useState(visible);
  // visible 变 true 时立即重新挂载（render 期 adjust-state 模式，规避 effect 内 setState）
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) setMounted(true);
  }
  useEffect(() => {
    if (visible) return;
    const t = setTimeout(() => setMounted(false), 350);
    return () => clearTimeout(t);
  }, [visible]);

  if (!mounted || !current) return null;

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 z-[55]"
      style={{ opacity: visible ? 1 : 0 }}
      data-testid="music-global-mini"
      data-suppress-edge-gesture
    >
      {mode === 'bar' ? (
        <GlobalMiniBar layerRef={layerRef} />
      ) : (
        <GlobalMiniRecord layerRef={layerRef} />
      )}
    </div>
  );
}
