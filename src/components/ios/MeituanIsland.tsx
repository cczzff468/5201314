'use client';

/**
 * 美团外卖灵动岛（对齐真机「美团外卖 × iOS 灵动岛」体验，用户规格）：
 * - 小窗（黑色胶囊）：有进行中的外卖单时常驻显示（所有界面：主屏/各 App/锁屏）——
 *   左侧当前骑手形象 + 状态文案（商家接单中/商家备餐中/送货中），右侧剩余时间「还有X分钟」黄色 + 「送达」
 *   （用户需求：美团岛不显示几点几分，改剩余分钟倒计时；<1分钟 → 即将送达）；
 * - 大窗（展开卡）：商家图 + 黄色「还有X分钟送达」+ 状态副文案 + 美团袋鼠标 +
 *   接单→取餐→送达 三节点进度条（骑手形象骑在进度上，随时间推进）；
 *   状态变化（支付成功/商家接单/骑手取餐）时自动展开一次，显示 5 秒收回小窗；
 * - 点小窗 → 展开大窗（一直显示，不自动收回）；
 * - 点大窗 → 收起堆叠并进入美团订单详情（复用灵动岛导航总线：switchToApp('meituan') + 订单详情）；
 * - 点大窗以外的地方 → 收回大窗（透明捕获层，iOS 灵动岛同语义）；
 * - 聊天消息灵动岛通知展示期间/来电响铃/熄屏/关闭状态栏时整层隐身，恢复后小窗回归；
 * - 剩余分钟按真实时钟每秒推算（etaAt），催单（催一下）提前 eta 后小窗/大窗数字即时变小。
 *
 * 【灵动岛堆叠】音乐在播（音乐岛可见）时不让位：小窗整体右移，左侧留给音乐封面小圆圈
 * （组合形态：左圆圈 + 右配送小窗；二轮修订：组合总宽收窄 237→195px——胶囊 198→156 +
 * 短状态文案，不挡状态栏时间/电量）；
 * 二轮修订交互：①点左侧圆圈只出音乐大窗——音乐大窗展开而本窗未展开时本岛整体隐身，
 * 不在音乐大窗下方显示小窗/大窗；②点本小窗 → 所有灵动岛大窗一起出现（音乐大窗同时展开、
 * 圆圈消失），堆叠时音乐大窗永远在最上（island-stack TOP_PRIORITY）。
 * 三轮修订：③【大窗不互斥】原「淘宝/美团互斥」只作用于小窗——本岛大窗展开时不再让位，
 * 点任一配送小窗 → 淘宝+美团+音乐大窗全部同显（对方有进行中单也一起展开）；
 * ④堆叠排序：音乐大窗恒在最上，淘宝/美团按「下单时刻」依次排（早下单的沉底，早的在下面）。
 * 大窗垂直堆叠、可同时显示（island-stack 协调），点大窗进对应界面。
 *
 * 小窗互斥保留（用户三轮确认「小窗就显示最近的那个」）：两者都有进行中单时
 * 「最新事件的一方」展示小窗（另一让位），但不再隐藏已展开的大窗。
 *
 * 层级：小窗/大窗 z-[82]（与音乐岛同层，堆叠布局互不重叠），
 * 低于聊天通知卡（z-93）。大窗的「点击别处」捕获层 z-[80]。
 */

import { useEffect, useRef, useState } from 'react';
import { motion, type Transition } from 'framer-motion';
import { useUI } from '@/lib/ios/store';
import { useIslandNotify, navigateToChatSession } from '@/lib/ios/island-notify';
import { useGlobalCall } from '@/lib/ios/global-call';
import { useIncomingCall } from '@/lib/ios/incoming-call';
import { useMusic } from '@/lib/ios/music-store';
import { useMtIsland } from '@/lib/ios/mt-island-store';
import { islandTopOf, useIslandStack } from '@/lib/ios/island-stack';
import { mtCurrentRider } from '@/lib/ios/mt-rider';
import { mtGetSession, mtLoadOrders, mtUidOf, type MtOrder } from '@/lib/ios/meituan-store';
import { tbGetSession, tbLoadOrders, tbUidOf } from '@/lib/ios/taobao-store';

/** 小窗胶囊几何（独占模式用） */
const PILL = { width: 198, height: 33, borderRadius: 16.5 } as const;
/** 组合模式胶囊几何（二轮修订：收窄 198→156，左侧留给音乐封面圆圈后总宽 195 不挡状态栏时间/电量） */
const COMBO_PILL = { width: 156, height: 33, borderRadius: 16.5 } as const;
/** 大窗展开姿态 */
const EXPANDED = { width: 348, height: 'auto', borderRadius: 26 } as const;
const SPRING: Transition = { type: 'spring', stiffness: 380, damping: 32, mass: 0.9 };
/** 自动展开停留时长（大窗显示 5 秒） */
const AUTO_COLLAPSE_MS = 5000;
/** 胶囊/展开态的垂直锚位（与静态灵动岛同位） */
const PILL_TOP = 11;
/** 组合形态：配送小窗右移后的左缘（组合总宽 195=圆圈33+间距6+胶囊156，整体居中：左缘 97.5、胶囊左缘 136.5） */
const COMBO_PILL_LEFT = 'calc(50% - 58.5px)';

/** 来电展示中（与 IslandNotificationLayer 同口径，只读两个通话 store） */
function useIncomingCallPresenting(): boolean {
  const call = useIncomingCall((s) => s.call);
  const enginePhase = useGlobalCall((s) => s.enginePhase);
  if (call?.source === 'phone') return true;
  const source = (call?.source ?? '') as string;
  if (source === 'wx' || source === 'qq') return enginePhase === 'incoming';
  return false;
}

/** 进行中的外卖单（配送三态；团购/出行单不进灵动岛） */
function inProgressOf(o: MtOrder): boolean {
  const kind = o.kind ?? 'waimai';
  return kind === 'waimai' && (o.status === 'pendingAccept' || o.status === 'accepted' || o.status === 'delivering');
}

/** 小窗状态文案 */
function pillLabelOf(o: MtOrder): string {
  if (o.status === 'pendingAccept') return '商家接单中';
  if (o.status === 'accepted') return '商家备餐中';
  return '送货中';
}

/** 组合模式短状态文案（胶囊收窄到 156 后改用三字文案，保证 状态+还有X分钟+送达 完整放下不溢出） */
function pillLabelComboOf(o: MtOrder): string {
  if (o.status === 'pendingAccept') return '接单中';
  if (o.status === 'accepted') return '备餐中';
  return '送货中';
}

/** 大窗副文案（对齐参考截图） */
function subLabelOf(o: MtOrder): string {
  if (o.status === 'pendingAccept') return '订单已支付，等待商家接单';
  if (o.status === 'accepted') return '商家已接单，商品备餐中';
  return '商家已出餐，骑手正赶往商家';
}

/** 剩余时间文案（用户需求：美团岛不显示几点几分，改「还有X分钟送达」；<1分钟 → 即将） */
function minutesLeftOf(leftMs: number): string {
  if (leftMs < 60_000) return '即将';
  return `还有${Math.max(1, Math.ceil(leftMs / 60_000))}分钟`;
}

/** 三节点进度（0~1）：接单前起步、备餐中到取餐节点前、配送段按真实时间在 取餐→送达 间推进 */
function progressOf(o: MtOrder, now: number): number {
  if (o.status === 'pendingAccept') return 0.1;
  if (o.status === 'accepted') return 0.36;
  const delAt = o.statusLog.find((s) => s.status === 'delivering')?.at ?? o.paidAt ?? now;
  const end = o.etaAt ?? delAt + 60_000;
  const frac = end > delAt ? Math.min(1, Math.max(0, (now - delAt) / (end - delAt))) : 1;
  return 0.55 + 0.42 * frac;
}

/** 淘宝进行中快递单的最新事件时刻（0=无单）：灵动岛小窗互斥——两岛都有进行中单时「最新事件方」展示 */
function tbActiveLatestAt(): number {
  try {
    const s = tbGetSession();
    if (!s) return 0;
    let latest = 0;
    for (const o of tbLoadOrders(tbUidOf(s))) {
      if (o.ticket) continue;
      if (o.status !== 'pendingDeliver' && o.status !== 'shipped') continue;
      const t = Math.max(
        o.paidAt ?? o.createdAt,
        o.shipAt ?? 0,
        o.track.length > 0 ? o.track[o.track.length - 1].at : 0,
      );
      if (t > latest) latest = t;
    }
    return latest;
  } catch {
    return 0;
  }
}

export default function MeituanIsland() {
  const screenOff = useUI((s) => s.screenOff);
  const chatNotifyShowing = useIslandNotify((s) => s.current !== null || s.exiting);
  const callPresenting = useIncomingCallPresenting();
  // 音乐岛可见（播放中/暂停宽限期）→ 组合形态：小窗右移，左侧留给音乐封面小圆圈
  const musicIslandVisible = useMusic((s) => s.islandVisible);
  // 堆叠协调：展开中的大窗序 + 实测高度 + 各岛出现时刻（决定各大窗/小窗的锚位与排序）
  const stackOrder = useIslandStack((s) => s.order);
  const stackHeights = useIslandStack((s) => s.heights);
  const stackAppearedAt = useIslandStack((s) => s.appearedAt);

  /** active = 当前进行中的外卖单（每秒重读 kv；null = 无单隐身） */
  const [active, setActive] = useState<MtOrder | null>(null);
  /** 每秒刷新的时钟（剩余分钟/进度推进） */
  const [nowTs, setNowTs] = useState(() => Date.now());

  /** 展开态来自堆叠 store（与音乐/淘宝大窗统一排序堆叠） */
  const expanded = stackOrder.includes('mt');
  // 灵动岛堆叠二轮：音乐大窗已展开而本窗未展开（用户点了左侧封面圆圈）→ 本岛整体隐身，
  // 不在音乐大窗下方显示小窗/大窗（用户要求「点圆圈只出音乐大窗」）；音乐大窗收起后本岛自动回归
  const musicExpandedAlone = stackOrder.includes('music') && !expanded;
  const autoExpandRef = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 已消费的状态签名（订单id|状态）：变化即自动展开大窗 5 秒（含通知层让位后的补放） */
  const seenSigRef = useRef<string>('');
  /** 大窗内容测量（高度回写堆叠 store，供后续槽位定位） */
  const largeRef = useRef<HTMLDivElement | null>(null);

  const readActive = () => {
    try {
      const s = mtGetSession();
      if (!s) {
        setActive(null);
        return;
      }
      const list = mtLoadOrders(mtUidOf(s)).filter(inProgressOf);
      // 多单进行中：取最近支付的一单
      list.sort((a, b) => (b.paidAt ?? b.createdAt) - (a.paidAt ?? a.createdAt));
      setActive(list[0] ?? null);
    } catch {
      /* kv 未就绪等异常：保持现状 */
    }
  };

  const clearAuto = () => {
    if (autoTimer.current) {
      clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
  };

  /** 自动展开大窗 5 秒（仅小窗形态时） */
  const autoExpand = () => {
    if (useIslandStack.getState().order.includes('mt')) return;
    autoExpandRef.current = true;
    useIslandStack.getState().expand('mt');
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => {
      autoTimer.current = null;
      if (autoExpandRef.current) useIslandStack.getState().collapse('mt');
    }, AUTO_COLLAPSE_MS);
  };

  /** 手动展开（点小窗）：一直显示。
   *  二轮修订：点配送小窗 → 所有灵动岛大窗一起出现——音乐岛可见时同时展开音乐大窗
   *  （圆圈随音乐大窗展开而消失，堆叠时音乐永远在最上）；音乐岛不可见（没在放歌/被通知遮挡）不强展。
   *  三轮修订：对方配送岛（淘宝）有进行中单也一起展开——大窗不互斥，三大窗同显（早的下单沉底） */
  const expandManually = () => {
    autoExpandRef.current = false;
    clearAuto();
    const st = useIslandStack.getState();
    st.expand('mt');
    if (tbActiveLatestAt() > 0) st.expand('tb');
    if (useMusic.getState().islandVisible) st.expand('music');
  };

  const collapse = () => {
    autoExpandRef.current = false;
    clearAuto();
    useIslandStack.getState().collapse('mt');
  };

  // 数据源：每秒轮询（kv 无订阅总线）+ 订单变化事件即时刷新 + 时钟推进
  // （首帧读取包进微任务，规避 react-hooks/set-state-in-effect）
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => {
      if (!alive) return;
      readActive();
      setNowTs(Date.now());
    });
    const iv = window.setInterval(() => {
      readActive();
      setNowTs(Date.now());
    }, 1000);
    const onChanged = () => readActive();
    window.addEventListener('mt-orders-changed', onChanged);
    return () => {
      alive = false;
      window.clearInterval(iv);
      window.removeEventListener('mt-orders-changed', onChanged);
    };
  }, []);

  useEffect(() => () => { clearAuto(); }, []);

  // 小窗互斥（只作用小窗，三轮修订）：淘宝快递灵动岛有进行中单且其最新事件更新 → 美团小窗让位
  // （小窗互斥，平局美团优先）；本岛大窗已展开时不让位（大窗同显，点小窗三大窗全部出现）
  const tbWinsSmall = (() => {
    const tbLatest = tbActiveLatestAt();
    if (tbLatest <= 0 || !active) return false;
    const mtLatest = Math.max(
      active.paidAt ?? active.createdAt,
      active.statusLog.length > 0 ? active.statusLog[active.statusLog.length - 1].at : 0,
    );
    return tbLatest > mtLatest;
  })();

  const hidden =
    // v58：状态栏关闭不再隐藏美团岛（APP 灵动岛独立于状态栏开关，用户要求）
    screenOff ||
    chatNotifyShowing ||
    callPresenting ||
    !active ||
    musicExpandedAlone ||
    (tbWinsSmall && !expanded);

  // 记录本岛当前订单的下单时刻（堆叠排序「早的在下面」用；同值幂等）
  useEffect(() => {
    if (!active) return;
    useIslandStack.getState().markAppeared('mt', active.paidAt ?? active.createdAt);
  }, [active]);

  // 状态签名变化（新单/接单/取餐）→ 自动展开大窗 5 秒；
  // 通知层/来电占位期间隐身时不消费签名，恢复可见（hidden 翻转触发本 effect 重跑）后补放
  useEffect(() => {
    if (hidden) return;
    const sig = active ? `${active.id}|${active.status}` : '';
    if (!sig) {
      seenSigRef.current = '';
      return;
    }
    if (sig === seenSigRef.current) return;
    seenSigRef.current = sig;
    // 微任务里展开（规则：effect 内不同步 setState）
    Promise.resolve().then(() => autoExpand());
  }, [active, hidden]);

  // 可见性写入共享 store（音乐岛组合判定/状态栏消费）+ 隐身时收回展开态（微任务里 setState）
  useEffect(() => {
    useMtIsland.getState().setVisible(!hidden);
    if (hidden && useIslandStack.getState().order.includes('mt')) {
      Promise.resolve().then(() => useIslandStack.getState().collapse('mt'));
    }
  }, [hidden]);

  // 大窗高度实测 → 回写堆叠 store（后续槽位/让位锚位据此计算）
  useEffect(() => {
    if (!expanded) return;
    const el = largeRef.current;
    if (!el) return;
    const write = () => useIslandStack.getState().setHeight('mt', el.offsetHeight);
    Promise.resolve().then(write);
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  if (hidden || !active) return null;

  // 预计送达剩余时间（秒级刷新；催单后立刻变小；显示「还有X分钟」而非几点几分）
  const leftMs = Math.max(0, (active.etaAt ?? 0) - nowTs);
  const leftText = minutesLeftOf(leftMs);

  const p = progressOf(active, nowTs);
  const stageDone = (k: 0 | 1 | 2) => {
    if (k === 0) return active.status !== 'pendingAccept';
    if (k === 1) return active.status === 'delivering';
    return false;
  };
  const riderSrc = mtCurrentRider().src;

  /** 小窗内容（combo=true 组合形态：短状态文案 + 收窄胶囊专用；combo=false 独占 198 胶囊） */
  const pillContent = (combo: boolean) => (
    <div className="absolute inset-x-0 top-0 flex items-center gap-1.5 pl-[3px] pr-3" style={{ height: PILL.height }}>
      <img
        src={riderSrc}
        alt=""
        draggable={false}
        className="h-[27px] w-[27px] shrink-0 select-none object-contain"
        style={{ filter: 'drop-shadow(0 1.5px 2px rgba(0,0,0,0.35))' }}
      />
      <span className="min-w-0 shrink-0 text-[12px] font-medium leading-none text-white/90">
        {combo ? pillLabelComboOf(active) : pillLabelOf(active)}
      </span>
      <span className="min-w-0 flex-1" />
      <span className="shrink-0 whitespace-nowrap text-[12px] leading-none">
        <span className="font-bold text-[#FFC300]" data-testid="mt-island-left">
          {leftText}
        </span>
        {leftMs >= 60_000 && <span className="ml-[3px] text-white/75">送达</span>}
      </span>
    </div>
  );

  // ---------- 组合形态（音乐岛可见 + 本窗未展开）：小窗右移收窄，左侧留给音乐封面小圆圈 ----------
  // （音乐大窗展开时本岛已整体隐身（musicExpandedAlone → hidden），能走到这里音乐大窗必未展开，
  //   所以小窗固定在灵动岛原位，不再让位到堆叠下一槽位）
  if (musicIslandVisible && !expanded) {
    return (
      <motion.div
        className="pointer-events-none absolute z-[82]"
        initial={false}
        animate={{ top: PILL_TOP }}
        transition={SPRING}
        style={{ left: COMBO_PILL_LEFT }}
        data-testid="mt-island-combo"
      >
        <motion.div
          data-testid="mt-island"
          role="button"
          aria-label="美团配送弹窗：展开配送进度"
          initial={false}
          animate={{ width: COMBO_PILL.width, height: COMBO_PILL.height, borderRadius: COMBO_PILL.borderRadius }}
          transition={SPRING}
          onClick={expandManually}
          className="pointer-events-auto relative cursor-pointer overflow-hidden bg-black text-white shadow-[0_10px_30px_-8px_rgba(0,0,0,0.5)] outline-none"
        >
          {pillContent(true)}
        </motion.div>
      </motion.div>
    );
  }

  // 展开大窗的垂直锚位按堆叠序计算（独占模式 order=['mt'] → 原位 top=11；
  // 淘宝/美团同显时按下单时刻新→旧排，早下单的沉底）
  const top = expanded ? islandTopOf(stackOrder, stackHeights, 'mt', stackAppearedAt) : PILL_TOP;

  return (
    <>
      {/* 大窗展开期间：点击别处收回全部堆叠大窗（透明捕获层，iOS 灵动岛同语义） */}
      {expanded && (
        <div
          className="absolute inset-0 z-[80]"
          onClick={() => useIslandStack.getState().collapseAll()}
          aria-label="收起美团配送弹窗"
          data-testid="mt-island-catcher"
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
          data-testid="mt-island"
          role="button"
          aria-label={expanded ? '美团配送弹窗：打开订单详情' : '美团配送弹窗：展开配送进度'}
          initial={false}
          animate={{
            width: expanded ? EXPANDED.width : PILL.width,
            height: expanded ? EXPANDED.height : PILL.height,
            borderRadius: expanded ? EXPANDED.borderRadius : PILL.borderRadius,
          }}
          transition={SPRING}
          onClick={() => {
            if (!expanded) {
              expandManually();
            } else {
              // 点大窗 → 收起堆叠并进订单详情（灵动岛堆叠：点大窗进对应界面；
              // 锁屏/熄屏时 navigateToChatSession 内部守卫不跳转）
              useIslandStack.getState().collapseAll();
              navigateToChatSession('meituan', active.id);
            }
          }}
          className="pointer-events-auto relative cursor-pointer overflow-hidden bg-black text-white shadow-[0_10px_30px_-8px_rgba(0,0,0,0.5)] outline-none"
        >
          {/* ---------- 小窗内容（绝对定位不参与流式布局，展开时淡出） ---------- */}
          <motion.div
            initial={false}
            animate={{ opacity: expanded ? 0 : 1 }}
            transition={{ duration: 0.14 }}
          >
            {pillContent(false)}
          </motion.div>

          {/* ---------- 大窗内容（宽度形变基本完成后错峰淡入，避免形变中内容被裁切的观感） ---------- */}
          <motion.div
            initial={false}
            animate={{ opacity: expanded ? 1 : 0 }}
            transition={{ duration: expanded ? 0.2 : 0.08, delay: expanded ? 0.18 : 0 }}
            className={expanded ? 'block' : 'hidden'}
          >
            <div className="flex items-center gap-2.5 p-3 pb-2">
              {/* 商家图 */}
              {active.merchantImg ? (
                <img src={active.merchantImg} alt="" draggable={false} className="h-[46px] w-[46px] shrink-0 rounded-[10px] bg-zinc-800 object-cover" />
              ) : (
                <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[10px] bg-zinc-800 text-[20px]">{active.merchantEmoji}</span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-bold leading-[22px] text-[#FFC300]" data-testid="mt-island-eta">
                  {leftMs >= 60_000 ? `${leftText}送达` : '即将送达'}
                </p>
                <p className="mt-0.5 truncate text-[12px] leading-[16px] text-white/85" data-testid="mt-island-sub">
                  {subLabelOf(active)}
                </p>
              </div>
              {/* 美团图标（黄底圆角方块直出：去白底容器，黑底高对比，任何缩放下无二次裁切/描边漏白） */}
              <img
                src="/icons/meituan-app.png?v=2"
                alt=""
                draggable={false}
                className="h-[34px] w-[34px] shrink-0 select-none object-contain"
              />
            </div>

            {/* 接单 → 取餐 → 送达 进度条（骑手形象骑在进度上；pt-6 顶部净空，骑手不压上方商家图/文案） */}
            <div className="px-5 pb-1 pt-6">
              <div className="relative h-[10px]">
                {/* 骑手（骑在进度线上：头部探出线上方，不侵入上方内容行） */}
                <img
                  src={riderSrc}
                  alt=""
                  draggable={false}
                  className="absolute h-[30px] w-[30px] -translate-x-1/2 select-none object-contain transition-[left] duration-700 ease-linear"
                  style={{ left: `${p * 100}%`, bottom: -6, filter: 'drop-shadow(0 3px 3px rgba(0,0,0,0.4))' }}
                />
                {/* 轨道 */}
                <div className="absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 rounded-full bg-white/22">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#FFD100] to-[#FFC300]" style={{ width: `${p * 100}%` }} />
                </div>
                {/* 节点（首尾贴边：接单/送达在轨道两端，取餐居中） */}
                {[0, 1, 2].map((k) => (
                  <span
                    key={k}
                    className={`absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
                      stageDone(k as 0 | 1 | 2) ? 'border-[#FFC300] bg-[#FFC300]' : 'border-white/45 bg-black'
                    } ${k === 0 ? 'left-0' : k === 1 ? 'left-1/2' : 'left-full'}`}
                  />
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[11px] leading-none text-white/75">
                <span>接单</span>
                <span className={active.status === 'delivering' ? 'font-medium text-white' : ''}>取餐</span>
                <span>送达</span>
              </div>
            </div>
            {/* 底部呼吸留白 */}
            <div className="h-1.5" />
          </motion.div>
        </motion.div>
      </motion.div>
    </>
  );
}
