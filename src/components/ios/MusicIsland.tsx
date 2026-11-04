'use client';

/**
 * 音乐灵动岛（第十六轮反馈，第十八轮修订；灵动岛堆叠二轮修订）：
 * - 小弹窗：黑色胶囊（封面 + 歌名 + 红色波形动画），常驻显示（主屏幕/所有 App/锁屏都显示）；
 * - 大弹窗：展开的播放卡（封面 + 歌名 + 当前歌词行 + 进度条 + 上/暂停/下 + 红心），
 *   自动展开时显示 5 秒后收回小弹窗；开始播放/切歌时自动展开一次（仅独占模式）；
 * - 点小弹窗 → 展开为大弹窗并一直显示（不自动收回）；
 * - 点大弹窗 → 收起堆叠并跳转到音乐 App 听歌界面（锁屏/熄屏时只展开收起不跳转）；
 * - 点大弹窗以外的地方 → 收回小弹窗（透明捕获层，仅展开期间存在）；
 * - 不放音乐（无歌/暂停）时弹窗整体消失，恢复播放后小弹窗回归；
 * - 聊天消息灵动岛通知展示期间 → 音乐弹窗整体消失（通知收起后恢复）；
 *   来电响铃/熄屏期间同样隐身；设置里关闭状态栏（灵动岛）时一并隐藏。
 * - 【灵动岛堆叠】播放音乐时淘宝/美团配送灵动岛出现 → 不再整体隐身（原让位逻辑撤销）：
 *   在配送小窗左侧渲染一个歌曲封面小圆圈（组合形态：左圆圈 + 右配送小窗），
 *   点小圆圈 → 【只展开音乐大窗】（二轮修订：先把已展开的淘宝/美团大窗全部收起，
 *   配送岛在音乐大窗展开期间整体隐身，不在下方显示）；
 *   点配送小窗 → 所有灵动岛大窗一起出现（音乐大窗同时展开、圆圈消失，堆叠时音乐永远在最上）。
 *   三轮修订：淘宝/美团/音乐三大窗同显（大窗不互斥，互斥只作用小窗：小窗仍只显示最新事件一方）；
 *   淘宝/美团大窗按「下单时刻」依次排在音乐大窗之下（早下单的沉底，早的在下面）；
 *   左侧封面小圆圈美化：黑色圆形边框（border-2 border-black）+ 柔和投影。
 *   自动展开只在独占模式进行（组合模式不抢屏）。
 * - 大弹窗不下沉（第二十三轮反馈：恢复原位 top=11）；
 * - 弹窗可见时状态栏只隐藏「移动数据」（信号）图标，WiFi/电量保留（真实 iPhone 灵动岛同语义），
 *   弹窗消失后图标恢复——可见性由本组件写入 music-store.islandVisible，StatusBar 只读。
 *
 * 层级：小弹窗/圆圈/大弹窗 z-[82]（与淘宝/美团岛同层，堆叠布局互不重叠），
 * 低于聊天通知卡（z-93）；「点击别处」捕获层 z-[80]。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, type Transition } from 'framer-motion';
import { Heart, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useSettings, useSystemDark, useUI } from '@/lib/ios/store';
import { useIslandNotify } from '@/lib/ios/island-notify';
import { useGlobalCall } from '@/lib/ios/global-call';
import { useIncomingCall } from '@/lib/ios/incoming-call';
import { useMusic } from '@/lib/ios/music-store';
import { setMusicIslandVisible } from '@/lib/ios/music-island-flag';
import { useMtIsland } from '@/lib/ios/mt-island-store';
import { useTbIsland } from '@/lib/ios/tb-island-store';
import {
  ISLAND_TOP,
  islandNextSlotTop,
  islandTopOf,
  useIslandStack,
} from '@/lib/ios/island-stack';
import { songCover } from '@/lib/ios/music-api';
import { fmtClock } from '@/components/apps/music-shared';

/** 小弹窗胶囊几何（第十七轮反馈：左右收窄） */
const PILL = { width: 156, height: 33, borderRadius: 16.5 } as const;
/** 大弹窗展开姿态 */
const EXPANDED = { width: 348, height: 'auto', borderRadius: 26 } as const;
const SPRING: Transition = { type: 'spring', stiffness: 380, damping: 32, mass: 0.9 };
/** 自动展开停留时长（大弹窗显示 5 秒） */
const AUTO_COLLAPSE_MS = 5000;
/** 暂停/关闭音乐后弹窗延迟消失时长（第二十轮反馈：不立马消失，显示 5 秒再收起） */
const PAUSE_GRACE_MS = 5000;
/** 组合形态几何（二轮修订：整体收窄不挡状态栏时间/电量）：
 *  组合总宽 = 封面圆圈 33 + 间距 6 + 配送小窗 156 = 195，整体居中于灵动岛锚位。
 *  390 屏上占 97.5..292.5：状态栏时间文字止于 ~72、电量起于 ~315（信号/WiFi 已隐藏），完全不遮挡 */
const COMBO_CIRCLE_LEFT = 'calc(50% - 97.5px)';

/** 来电展示中（与 IslandNotificationLayer 同口径，只读两个通话 store） */
function useIncomingCallPresenting(): boolean {
  const call = useIncomingCall((s) => s.call);
  const enginePhase = useGlobalCall((s) => s.enginePhase);
  if (call?.source === 'phone') return true;
  const source = (call?.source ?? '') as string;
  if (source === 'wx' || source === 'qq') return enginePhase === 'incoming';
  return false;
}

/** 非订阅环境下判断整层是否隐身（订阅回调用；与组件内 hidden 派生同口径） */
function isHiddenNow(): boolean {
  const m = useMusic.getState();
  if (!m.current || !m.playing) return true; // 第十八轮反馈：不放音乐（无歌/暂停）时弹窗消失
  // v58：状态栏关闭不再隐藏音乐岛（APP 灵动岛独立于状态栏开关，用户要求）
  if (useUI.getState().screenOff) return true;
  // 灵动岛堆叠：淘宝/美团配送岛出现时音乐岛不再隐身（改为左侧封面小圆圈组合形态）
  const n = useIslandNotify.getState();
  if (n.current || n.exiting) return true;
  const c = useIncomingCall.getState().call;
  if (c?.source === 'phone') return true;
  const source = (c?.source ?? '') as string;
  if (source === 'wx' || source === 'qq') return useGlobalCall.getState().enginePhase === 'incoming';
  return false;
}

/** 全局打开播放页（锁屏/熄屏守卫；把音乐 App 切到前台 + 导航置为播放页） */
function openPlayerFromIsland(): void {
  const ui = useUI.getState();
  if (ui.locked || ui.screenOff) return;
  useMusic.getState().openPlayer();
  ui.switchToApp('music');
}

/** 弹窗尾部的波形动画（第二十轮反馈：按用户截图改为白色圆角竖条声纹样式）；
 *  中间最高、两头渐矮的对称声纹（首条贴截图的小圆点），播放时竖条从中位依次起伏律动（阶梯相位差=声纹滚动感），
 *  暂停时压平成一排小圆点；big = 大弹窗标题行右侧的加高版（小 7 条 / 大 9 条） */
function Waveform({ playing, big = false }: { playing: boolean; big?: boolean }) {
  const H = big ? 26 : 15;
  const N = big ? 9 : 7;
  const BAR_W = big ? 3 : 2.5;
  const GAP = big ? 2.5 : 2;
  const shape = big ? [4, 9, 15, 21, 24, 21, 15, 9, 4] : [3, 6, 10, 13, 13, 10, 6];
  const W = N * BAR_W + (N - 1) * GAP;
  return (
    <span
      className="flex shrink-0 items-center"
      style={{ width: W, height: H, gap: GAP }}
      aria-hidden="true"
      data-testid="music-island-wave"
    >
      {shape.map((h, i) => (
        <motion.span
          key={i}
          className="rounded-full bg-white/70"
          style={{ width: BAR_W, height: h }}
          animate={playing ? { scaleY: [1, 0.35, 1] } : { scaleY: 0.14 }}
          transition={
            playing
              ? { duration: 0.9, ease: 'easeInOut', repeat: Infinity, delay: i * 0.09 }
              : { duration: 0.22 }
          }
        />
      ))}
    </span>
  );
}

export default function MusicIsland() {
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const position = useMusic((s) => s.position);
  const duration = useMusic((s) => s.duration);
  const liked = useMusic((s) => (s.current ? s.likedIds.has(s.current.id) : false));
  const lyricLines = useMusic((s) => s.lyricLines);
  const lyricFor = useMusic((s) => s.lyricFor);
  const screenOff = useUI((s) => s.screenOff);
  const chatNotifyShowing = useIslandNotify((s) => s.current !== null || s.exiting);
  const callPresenting = useIncomingCallPresenting();
  // 淘宝/美团配送灵动岛展示中 → 组合形态（左侧封面小圆圈 + 右侧配送小窗），音乐岛不再整体隐身
  const mtIslandVisible = useMtIsland((s) => s.visible);
  const tbIslandVisible = useTbIsland((s) => s.visible);
  // 堆叠协调：展开中的大窗序 + 实测高度 + 各岛出现时刻（决定各大窗/圆圈的垂直锚位与排序）
  const stackOrder = useIslandStack((s) => s.order);
  const stackHeights = useIslandStack((s) => s.heights);
  const stackAppearedAt = useIslandStack((s) => s.appearedAt);

  /** 展开态来自堆叠 store（与淘宝/美团大窗统一排序堆叠） */
  const expanded = stackOrder.includes('music');
  /** 自动展开（5 秒收回）还是手动展开（一直显示） */
  const expandedAutoRef = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPlayIdRef = useRef<number | null>(null);
  /** 大窗内容测量（高度回写堆叠 store，供后续槽位定位） */
  const largeRef = useRef<HTMLDivElement | null>(null);

  // 第二十轮反馈：暂停/关闭音乐后弹窗不立即消失，显示 5 秒再收起（宽限期内恢复播放则继续显示）。
  // 只在「播放中 → 暂停」的跳变时进入宽限；冷启动（本来就暂停）不显示弹窗。
  const [pauseGrace, setPauseGrace] = useState(false);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playingRef = useRef(playing);
  useEffect(() => {
    const onMusicChange = (s: { playing: boolean }) => {
      if (playingRef.current && !s.playing) {
        // 刚暂停：进入 5 秒宽限期
        if (graceTimer.current) clearTimeout(graceTimer.current);
        setPauseGrace(true);
        graceTimer.current = setTimeout(() => {
          graceTimer.current = null;
          setPauseGrace(false);
        }, PAUSE_GRACE_MS);
      } else if (s.playing) {
        // 恢复播放：立即结束宽限
        if (graceTimer.current) {
          clearTimeout(graceTimer.current);
          graceTimer.current = null;
        }
        setPauseGrace(false);
      }
      playingRef.current = s.playing;
    };
    return useMusic.subscribe(onMusicChange);
  }, []);
  useEffect(
    () => () => {
      if (graceTimer.current) clearTimeout(graceTimer.current);
    },
    [],
  );

  // 不放音乐（暂停超过 5 秒宽限 / 无歌）时弹窗整体消失（第十八轮反馈 + 第二十轮宽限）
  // 拾光小屋家具（音箱/黑胶）播放中（ambient）也不弹岛 —— 用户在音乐 App 内点歌/打开 App 自动恢复（v5.9）
  // v58：状态栏关闭不再隐藏音乐岛（APP 灵动岛独立于状态栏开关，用户要求）
  const ambient = useMusic((s) => s.ambient);
  const hidden =
    screenOff || chatNotifyShowing || callPresenting || !current || (!playing && !pauseGrace) || ambient;

  // 弹窗可见性 → music-store.islandVisible（StatusBar 据此隐藏/恢复「移动数据」图标）。
  // 订阅外部派生值（含 pauseGrace 内部态）在回调里 setState，渲染期不碰 store
  useEffect(() => {
    if (useMusic.getState().islandVisible !== !hidden) {
      useMusic.setState({ islandVisible: !hidden });
    }
    setMusicIslandVisible(!hidden);
  }, [hidden]);

  const clearAuto = () => {
    if (autoTimer.current) {
      clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
  };

  /** 整层隐身（不放音乐/消息通知/来电/熄屏/关闭状态栏）时把展开态复位，恢复后从小弹窗开始：
   *  订阅相关 store 在回调里 setState（外部系统订阅），渲染期不碰 ref */
  useEffect(() => {
    const maybeReset = () => {
      if (!isHiddenNow()) return;
      if (autoTimer.current) {
        clearTimeout(autoTimer.current);
        autoTimer.current = null;
      }
      expandedAutoRef.current = false;
      useIslandStack.getState().collapse('music');
    };
    maybeReset();
    const unsubs = [
      useMusic.subscribe(maybeReset),
      useUI.subscribe(maybeReset),
      useSettings.subscribe(maybeReset),
      useIslandNotify.subscribe(maybeReset),
      useIncomingCall.subscribe(maybeReset),
      useGlobalCall.subscribe(maybeReset),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  /** 换歌/开始播放：自动展开大弹窗 5 秒（仅独占模式；组合形态/已展开/整层隐身时不抢）。
   *  订阅外部系统（zustand 播放引擎）在回调里 setState —— 响应的是真正的播放事件而非渲染派生 */
  useEffect(() => {
    return useMusic.subscribe((s) => {
      const song = s.current;
      if (!s.playing || !song) return;
      if (lastPlayIdRef.current === song.id) return;
      lastPlayIdRef.current = song.id;
      if (useIslandStack.getState().order.includes('music')) return;
      // 灵动岛堆叠：配送岛（淘宝/美团）展示中不自动抢屏，保持组合形态（左圆圈 + 右配送小窗）
      if (useMtIsland.getState().visible || useTbIsland.getState().visible) return;
      // 整层隐身期间（消息通知/来电/熄屏）不抢展开，恢复后从小弹窗开始（v58：状态栏关闭不再拦截）
      if (useUI.getState().screenOff) return;
      if (useIslandNotify.getState().current || useIslandNotify.getState().exiting) return;
      if (useIncomingCall.getState().call) return;
      expandedAutoRef.current = true;
      useIslandStack.getState().expand('music');
      if (autoTimer.current) clearTimeout(autoTimer.current);
      autoTimer.current = setTimeout(() => {
        autoTimer.current = null;
        if (expandedAutoRef.current) useIslandStack.getState().collapse('music'); // 只有自动展开才 5 秒收回
      }, AUTO_COLLAPSE_MS);
    });
  }, []);

  useEffect(() => clearAuto, []);

  /** 手动展开（点小弹窗/组合模式点左侧封面圆圈）：一直显示（不自动收回）。
   *  二轮修订：点圆圈 → 【只展开音乐大窗】——先把已展开的淘宝/美团大窗全部收起，
   *  配送岛会因「音乐大窗展开而自身未展开」整体隐身，不在音乐大窗下方显示别的灵动岛 */
  const expandManually = () => {
    expandedAutoRef.current = false;
    clearAuto();
    const st = useIslandStack.getState();
    if (st.order.includes('tb')) st.collapse('tb');
    if (st.order.includes('mt')) st.collapse('mt');
    st.expand('music');
  };

  const collapse = () => {
    expandedAutoRef.current = false;
    clearAuto();
    useIslandStack.getState().collapse('music');
  };

  // 大弹窗展开时补拉歌词（歌词行随进度联动）
  useEffect(() => {
    if (!expanded || !current || lyricFor === current.id) return;
    void useMusic.getState().loadLyric(current.id);
  }, [expanded, current, lyricFor]);

  // 大窗高度实测 → 回写堆叠 store（后续槽位/让位锚位据此计算）
  useEffect(() => {
    if (!expanded) return;
    const el = largeRef.current;
    if (!el) return;
    const write = () => useIslandStack.getState().setHeight('music', el.offsetHeight);
    Promise.resolve().then(write);
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  /** 当前歌词行（无歌词/未加载时显示歌手占位） */
  const lyricText = useMemo(() => {
    if (!current) return '';
    if (lyricFor === current.id && lyricLines.length) {
      let text = '';
      for (const l of lyricLines) {
        if (l.t <= position + 0.2) text = l.text;
        else break;
      }
      if (text.trim()) return text.trim();
    }
    return current.artists?.map((a) => a.name).join('/') || '';
  }, [current, lyricFor, lyricLines, position]);

  if (hidden) return null;

  const combo = mtIslandVisible || tbIslandVisible;
  const deliveryExpanded = stackOrder.includes('tb') || stackOrder.includes('mt');

  // ---------- 组合形态（音乐在播 + 配送岛在显）且音乐大窗未展开：只渲染左侧封面小圆圈 ----------
  // （二轮修订：配送大窗自动展开时圆圈仍让位到堆叠下一槽位；点圆圈 = expandManually → 只出音乐大窗）
  if (combo && !expanded) {
    const top = deliveryExpanded ? islandNextSlotTop(stackOrder, stackHeights) : ISLAND_TOP;
    return (
      <motion.div
        className="pointer-events-none absolute z-[82]"
        initial={false}
        animate={{ top }}
        transition={SPRING}
        style={{ left: COMBO_CIRCLE_LEFT }}
        data-testid="music-island-combo"
      >
        <button
          type="button"
          aria-label="展开音乐播放控制"
          data-testid="music-island-circle"
          onClick={expandManually}
          className="pointer-events-auto block h-[33px] w-[33px] cursor-pointer overflow-hidden rounded-full border-2 border-black bg-black shadow-[0_3px_10px_rgba(0,0,0,0.5)] outline-none active:scale-95"
        >
          <img
            src={songCover(current!)}
            alt=""
            draggable={false}
            className="h-full w-full rounded-full object-cover"
          />
        </button>
      </motion.div>
    );
  }

  const dur = duration || (current?.dt ?? 0) / 1000 || 0;
  const pct = dur > 0 ? Math.min(100, (position / dur) * 100) : 0;
  // 展开大窗的垂直锚位按堆叠序计算（独占模式 order=['music'] → 原位 top=11；
  // 三大窗同显时音乐恒在最上，淘宝/美团按下单时刻新→旧排在下方）
  const top = expanded ? islandTopOf(stackOrder, stackHeights, 'music', stackAppearedAt) : ISLAND_TOP;

  return (
    <>
      {/* 大弹窗展开期间：点击别处收回全部堆叠大窗（透明捕获层，iOS 灵动岛同语义；锁屏时同样可收起） */}
      {expanded && (
        <div
          className="absolute inset-0 z-[80]"
          onClick={() => useIslandStack.getState().collapseAll()}
          data-testid="music-island-catcher"
          aria-label="收起音乐弹窗"
        />
      )}
      <motion.div
        className="pointer-events-none absolute inset-x-0 z-[82] flex flex-col items-center"
        initial={false}
        animate={{ top }}
        transition={SPRING}
      >
        <motion.div
          ref={largeRef}
          data-testid="music-island"
          role="button"
          aria-label={expanded ? '音乐弹窗：打开听歌界面' : '音乐弹窗：展开播放控制'}
          initial={false}
          animate={{ width: expanded ? EXPANDED.width : PILL.width, height: expanded ? EXPANDED.height : PILL.height, borderRadius: expanded ? EXPANDED.borderRadius : PILL.borderRadius }}
          transition={SPRING}
          onClick={() => {
            if (!expanded) {
              expandManually();
            } else {
              // 点大弹窗 → 收起堆叠并进入听歌界面（灵动岛堆叠：点大窗进对应界面）
              useIslandStack.getState().collapseAll();
              openPlayerFromIsland();
            }
          }}
          className="pointer-events-auto relative cursor-pointer overflow-hidden bg-black text-white shadow-[0_10px_30px_-8px_rgba(0,0,0,0.5)] outline-none"
        >
          {/* ---------- 小弹窗内容（绝对定位不参与流式布局，展开时淡出；第十七轮反馈：左右收窄） ---------- */}
          <motion.div
            initial={false}
            animate={{ opacity: expanded ? 0 : 1 }}
            transition={{ duration: 0.14 }}
            className="absolute inset-x-0 top-0 flex items-center gap-1.5 pl-[3px] pr-2.5"
            style={{ height: PILL.height }}
          >
            <img
              src={songCover(current!)}
              alt=""
              draggable={false}
              className="h-[26px] w-[26px] shrink-0 rounded-full bg-zinc-800 object-cover"
            />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-none text-white/90">
              {current?.name}
            </span>
            <Waveform playing={playing} />
          </motion.div>

          {/* ---------- 大弹窗内容（展开基本完成后淡入） ---------- */}
          <motion.div
            initial={false}
            animate={{ opacity: expanded ? 1 : 0 }}
            transition={{ duration: expanded ? 0.18 : 0.08 }}
            className={expanded ? 'block' : 'hidden'}
          >
            <div className="flex items-center gap-3 p-3 pb-2">
                <img
                src={songCover(current!)}
                alt=""
                draggable={false}
                className="h-[54px] w-[54px] shrink-0 rounded-xl bg-zinc-800 object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold leading-[20px]" data-testid="music-island-title">
                  {current?.name}
                </p>
                <p className="mt-0.5 truncate text-[12px] leading-[16px] text-white/55" data-testid="music-island-lyric">
                  {lyricText}
                </p>
              </div>
              {/* 标题行右侧：波形动画（第十八轮反馈：图标动画改为波形动画） */}
              <Waveform playing={playing} big />
            </div>

            {/* 进度条 + 时间（点击不跳转，只拖动进度） */}
            <div
              className="flex items-center gap-2 px-4"
              onClick={(e) => e.stopPropagation()}
              data-testid="music-island-progress"
            >
              <span className="shrink-0 text-[10px] tabular-nums text-white/55">{fmtClock(position)}</span>
              <div
                className="relative h-[4px] min-w-0 flex-1 rounded-full bg-white/25"
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
                  if (dur > 0) useMusic.getState().seek(Math.min(Math.max(0, ratio), 1) * dur);
                }}
              >
                <div className="absolute inset-y-0 left-0 rounded-full bg-white/90" style={{ width: `${pct}%` }} />
                <div
                  className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
                  style={{ left: `${pct}%` }}
                />
              </div>
              <span className="shrink-0 text-[10px] tabular-nums text-white/55">{fmtClock(dur)}</span>
            </div>

            {/* 控制条：上一首 / 播放暂停 / 下一首居中，红心同行贴右并与按钮垂直居中对齐
                （第十八轮反馈：爱心与前进/后退/暂停按钮对齐）；点击不跳转 */}
            <div className="relative flex items-center justify-center gap-10 px-6 py-3" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                aria-label="上一首"
                data-testid="music-island-prev"
                onClick={() => void useMusic.getState().prev()}
                className="p-1.5 active:scale-90"
              >
                <SkipBack className="h-[22px] w-[22px] text-white" fill="currentColor" />
              </button>
              <button
                type="button"
                aria-label={playing ? '暂停' : '播放'}
                data-testid="music-island-toggle"
                onClick={() => useMusic.getState().toggle()}
                className="p-1.5 active:scale-90"
              >
                {playing ? (
                  <Pause className="h-[26px] w-[26px] text-white" fill="currentColor" />
                ) : (
                  <Play className="h-[26px] w-[26px] text-white" fill="currentColor" />
                )}
              </button>
              <button
                type="button"
                aria-label="下一首"
                data-testid="music-island-next"
                onClick={() => void useMusic.getState().next()}
                className="p-1.5 active:scale-90"
              >
                <SkipForward className="h-[22px] w-[22px] text-white" fill="currentColor" />
              </button>
              {/* 红心：与控制按钮同一水平线（top-1/2 垂直居中对齐；点击不跳转，只收藏） */}
              <button
                type="button"
                aria-label={liked ? '取消红心' : '红心'}
                data-testid="music-island-like"
                onClick={() => {
                  if (current) void useMusic.getState().toggleLike(current);
                }}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 active:scale-90"
              >
                <Heart
                  className={`h-[20px] w-[20px] ${liked ? 'text-[#EC4141]' : 'text-white/85'}`}
                  fill={liked ? 'currentColor' : 'none'}
                />
              </button>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </>
  );
}
