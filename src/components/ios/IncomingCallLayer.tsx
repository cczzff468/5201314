'use client';

/**
 * 全局来电层（PhoneShell 挂载，覆盖所有 App / 主屏幕 / 锁屏）：
 *
 * - 顶部来电弹窗（z-[94]，锚定灵动岛原位——弹出时盖住灵动岛，收回时无缝交还）：
 *   · 电话来电 = iOS 横幅弹窗（黑色圆角胶囊：头像+名字在左、拒接/接听在右，与灵动岛同宽体系 344）；
 *   · 微信语音来电 = 微信大窗（深色圆角卡：头像+名字+「邀请你语音通话...」+忽略+拒接/接听），
 *     显示 5 秒后自动缩成胶囊小窗（同 344 宽）继续响铃；
 *   · QQ 语音来电 = 复用微信同款大窗/胶囊形态（QQ 主 UI 是全局通话层的全屏来电页，横幅在
 *     全屏页不在前台（如锁屏/被最小化）时兜底显示响铃铃 UI）；
 *   · 弹窗从灵动岛原位弹出：初始为灵动岛几何（118×33 @ top 11）原地弹性放大，全程覆盖灵动岛；
 *     消失时原地缩回灵动岛几何，与真灵动岛同位同色无缝交接（形变范式同 IslandNotification）；
 *   · 弹窗与全屏来电界面互斥：全屏来电界面（电话自动显示/微信点弹窗展开）可见时不显示弹窗；
 *   · 弹窗上的接听/拒绝/忽略按钮直接操作、不跳界面：电话走来电快照回调；微信经全局通话引擎
 *     转发（engine.accept / reject）——微信接听后不进全屏通话页，收成悬浮小窗（点小窗回全屏）；
 *   · 点弹窗除挂断/接听/忽略按钮外的区域 → 回到/跳转到来电界面：微信把全局通话层从 view='hidden'
 *     展开为全屏来电页（expand()）；电话把已退出的全屏来电界面重新展开（showScreen()）；
 * - iOS 全屏来电界面（z-[84]，仅电话来电自动渲染）：深灰渐变背景 + 左上「退出」+ 右上 ⓘ +
 *   头像/名字/「语音通话邀请…」+ 信息/提醒我 + 拒绝/接听大圆钮；
 *   点「退出」收起来电界面（来电继续响铃，只剩顶部弹窗）；
 *   微信语音来电的来电界面不自动显示（全局通话层 view='hidden' 启动，引擎挂载但不可见），
 *   点弹窗非按钮区域才展开；
 * - 电话来电响铃 25 秒无人处理 → 超时未接（onMissed('timeout')：落未接记录 + AI 语音留言）；
 * - 接听交接（幽灵来电修复）：接听回调只写 pending + switchToApp('phone')，两种场景会
 *   「弹层清了、通话界面没开」——①电话 App 已在前台（switchToApp 无事发生，mount-only 消费
 *   不重跑）→ 接听后派发消费事件让已挂载的电话 App 立即进通话；②锁屏/熄屏（switchToApp 被
 *   拦截）→ pending 原样保留，解锁监听在解锁瞬间自动切电话 App 并派发消费事件。
 */

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion, type Transition } from 'framer-motion';
import { Bell, BellOff, ChevronLeft, Info, MessageCircle, Phone, PhoneOff, Video } from 'lucide-react';
import { useGlobalCall } from '@/lib/ios/global-call';
import {
  hasPendingPhoneAnswer,
  notifyPendingPhoneAnswer,
  startIncomingRing,
  stopIncomingRing,
  useIncomingCall,
  type IncomingCallSnapshot,
} from '@/lib/ios/incoming-call';
import { useUI } from '@/lib/ios/store';
import { navigateToChatSession } from '@/lib/ios/island-notify';

// iOS 全屏来电页较重，按需加载（无来电不进包）
const IncomingCallScreen = dynamic(() => Promise.resolve(IncomingCallScreenImpl), { ssr: false });

/** 灵动岛几何/颜色（与 PhoneShell 静态灵动岛完全一致）：弹窗弹出与收回的起点/终点 */
const ISLAND = { width: 118, height: 33, borderRadius: 17, y: 0 } as const;
const ISLAND_BG = '#000000';
/** 弹性形变（尺寸用 spring；背景色短补间，与灵动岛纯黑无缝交接） */
const SPRING_WITH_BG: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.9,
  backgroundColor: { duration: 0.2, ease: 'easeOut' },
};
/** 收回灵动岛用短补间（缩回终点与静态灵动岛同位同色） */
const TWEEN_OUT: Transition = { duration: 0.24, ease: [0.4, 0, 0.2, 1] };

// ---------------- 电话来电接听（幽灵来电修复：交接兜底） ----------------

/**
 * 接听电话来电（顶部弹窗绿钮 / 全屏来电界面绿钮共用）：
 * ① answer() 清层 + 走快照回调（chat.tsx 的 onAnswer：写 pending + switchToApp('phone')）；
 * ② 交接兜底：switchToApp 帮不上忙的两种场景在这里补齐——
 *    · 电话 App 已在前台：switchToApp 无事发生，pending 只由电话 App 挂载时消费（mount-only）
 *      → 派发消费事件让已挂载的电话 App 立即进通话界面；
 *    · 锁屏/熄屏：switchToApp 被拦截 → pending 原样保留，由下方解锁监听在解锁后自动消费。
 */
function answerPhoneCall(): void {
  useIncomingCall.getState().answer();
  const ui = useUI.getState();
  if (ui.locked || ui.screenOff) return; // 锁屏/熄屏：保留 pending，解锁监听兜底
  notifyPendingPhoneAnswer();
}

export default function IncomingCallLayer() {
  const call = useIncomingCall((s) => s.call);
  const screenHidden = useIncomingCall((s) => s.screenHidden);
  const enginePhase = useGlobalCall((s) => s.enginePhase);
  const hasWxSession = useGlobalCall((s) => s.session !== null);
  const gView = useGlobalCall((s) => s.view);
  const isPhone = call?.source === 'phone';
  const isWx = call?.source === 'wx';
  // QQ 来电（source 运行时值 'qq'，快照类型联合未列——见 qq.tsx 触发处注释）：
  // 与微信同走全局通话引擎代理（engine.accept / reject），微信/电话分支零改动
  const callSource = (call?.source ?? '') as string;
  const isQq = callSource === 'qq';
  // 锁屏时全局通话层的全屏来电页（z-62）在锁屏之下不可见：QQ 横幅（z-94）解锁屏场景兜底响铃铃 UI
  const uiLocked = useUI((s) => s.locked);
  // 微信弹窗只在页内引擎「来电响铃」且全屏来电页未展开时显示（接通/结束后随引擎阶段消失）；
  // QQ 弹窗同条件，但全屏来电页已在前台（view='full'）且未锁屏时不叠加（避免双份接听/拒接 UI）
  const wxRinging = isWx && enginePhase === 'incoming' && gView !== 'full';
  const qqRinging = isQq && enginePhase === 'incoming' && (gView !== 'full' || uiLocked);
  // 电话弹窗只在全屏来电界面被「退出」后显示（界面可见时不叠加弹窗）
  const phoneBanner = isPhone && screenHidden;

  // 电话来电：铃声循环 + 25 秒响铃超时（微信铃声/超时由页内引擎自理）
  useEffect(() => {
    if (!isPhone) return;
    startIncomingRing();
    const timer = window.setTimeout(() => {
      useIncomingCall.getState().dismiss('timeout');
    }, 25000);
    return () => {
      stopIncomingRing();
      window.clearTimeout(timer);
    };
  }, [isPhone, call?.id]);

  // 微信/QQ 来电：大窗 5 秒后自动缩成胶囊小窗（响铃继续，直至接听/忽略/超时）；
  // 视频邀请（Task 23）大窗常驻——「底部按钮一直显示」，直至接听/拒绝/超时（对照用户截图要求）
  useEffect(() => {
    if ((!isWx && !isQq) || call?.bannerStage !== 'big') return;
    if (call.media === 'video') return;
    const timer = window.setTimeout(() => {
      useIncomingCall.getState().setStage('pill');
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [isWx, isQq, call?.id, call?.bannerStage, call?.media]);

  // 微信/QQ 来电收尾兜底：页内引擎超时未接（missed-in）会关闭全局会话——
  // 会话消失（session=null）时若弹窗还挂着就同步清掉
  useEffect(() => {
    if ((!isWx && !isQq) || hasWxSession) return;
    useIncomingCall.getState().clear();
  }, [isWx, isQq, hasWxSession]);

  // 来电快照接听/收尾清理（L11）：wx/qq 的快照只服务「响铃横幅」——引擎离开响铃阶段
  // （接听/拒接/超时未接）后快照若滞留，store.openSwitcher 与 PhoneShell 边缘手势会因
  // useIncomingCall.call 非空而在整个通话期间禁掉 App 切换器（通话中 UI 由 GlobalCallLayer
  // 承载，不依赖该快照；新来电/新通话的互斥守卫另有 useGlobalCall.session，不受影响）。
  // 只在「响铃 → 其他阶段」的跳变时清：触发时引擎尚未挂载（phase=null）不能清，
  // 否则横幅会在响铃开始前被误清；电话来电不走此分支（answer() 自带清层）
  const prevPhaseRef = useRef<'dialing' | 'incoming' | 'active' | 'ended' | null>(null);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = enginePhase;
    if ((!isWx && !isQq) || !call) return;
    if (prev !== 'incoming' || enginePhase === 'incoming') return;
    useIncomingCall.getState().clear();
  }, [isWx, isQq, enginePhase, call]);

  // 「忽略」按钮的 dismiss-only 语义（L13）：仅收起本次来电的横幅，不调 engine.reject——
  // 那等于替用户拒接；通话在应用内继续响铃、超时自然转未接。按来电 id 记住被忽略的横幅：
  // 同一次来电不再弹出（新来电 id 必不同，无需清理）；响铃结束后快照由上方接听/收尾
  // 清理 effect 或会话消失兜底清掉
  const [ignoredCallId, setIgnoredCallId] = useState<string | null>(null);

  // 锁屏接听兜底：锁屏/熄屏时点接听，switchToApp 被拦截、pending 滞留成幽灵来电
  // （下次打开电话 App 突然冒出来）——监听 useUI：在「锁屏/熄屏 → 解锁」跳变瞬间若 pending
  // 还在（未被电话 App 消费），自动切到电话 App 并派发消费事件打开通话界面
  useEffect(() => {
    let prevBlocked = useUI.getState().locked || useUI.getState().screenOff;
    return useUI.subscribe((s) => {
      const wasBlocked = prevBlocked;
      prevBlocked = s.locked || s.screenOff;
      if (!wasBlocked || prevBlocked) return; // 只在解锁跳变时兜底，平时不动
      if (!hasPendingPhoneAnswer()) return;
      s.switchToApp('phone');
      notifyPendingPhoneAnswer();
    });
  }, []);

  const showBanner = phoneBanner || wxRinging || qqRinging;

  return (
    <>
      {/* 弹窗锚定容器：顶边与灵动岛同位（top 11），弹窗原地弹出/收回、全程覆盖灵动岛 */}
      <div className="pointer-events-none absolute inset-x-0 top-[11px] z-[94] flex flex-col items-center">
        <AnimatePresence>
          {showBanner && call && call.id !== ignoredCallId ? (
            <CallBanner key={call.id} call={call} onIgnore={() => setIgnoredCallId(call.id)} />
          ) : null}
        </AnimatePresence>
      </div>
      {isPhone && call && !screenHidden ? <IncomingCallScreen call={call} /> : null}
    </>
  );
}

// ---------------- 顶部来电弹窗（胶囊 / 微信大窗；从灵动岛原位弹出，收回无缝交接） ----------------

function CallBanner({ call, onIgnore }: { call: IncomingCallSnapshot; onIgnore: () => void }) {
  // 来源按字符串宽化读取（快照类型联合未列 'qq'——运行时值由 qq.tsx 触发处写入；微信分支保持原样）
  const source = call.source as string;
  const qq = source === 'qq';
  const big = (call.source === 'wx' || qq) && call.bannerStage === 'big';

  /** 接听：电话走快照回调（打开电话 App 进通话）；微信代理到页内引擎 accept——
   *  点按钮不跳界面：接听后全局通话层收成悬浮小窗（点小窗可回全屏通话页）；
   *  QQ 接听同样代理引擎 accept，但直接展开全屏通话页（QQ 接听即进通话界面，可挂断） */
  const answer = () => {
    if (qq) {
      const g = useGlobalCall.getState();
      g.engine?.accept();
      g.expand();
      return;
    }
    if (call.source === 'wx') {
      const g = useGlobalCall.getState();
      g.engine?.accept();
      if (g.session) g.minimize();
      return;
    }
    answerPhoneCall();
  };
  /** 拒绝：电话走快照回调（落未接记录+留言）；微信/QQ 代理到页内引擎 reject
   *  （QQ 拒接经引擎 onEnd 落「已拒绝」通话卡片，与响铃超时未接同口径）。
   *  忽略（L13 改为 dismiss-only）：仅收起横幅、不碰引擎——来电在应用内继续响铃、
   *  超时自然转未接（旧实现忽略=engine.reject，等于替用户拒接） */
  const decline = () => {
    if (call.source === 'wx' || qq) {
      useGlobalCall.getState().engine?.reject();
      return;
    }
    useIncomingCall.getState().dismiss('declined');
  };
  /** 点弹窗除挂断/接听/忽略按钮外的区域 → 回到/跳转到来电界面：
   *  微信/QQ 展开全局通话层全屏来电页（view 'hidden'/'pip' → 'full'）；电话把退出的来电界面重新展开 */
  const openScreen = () => {
    if (call.source === 'wx' || qq) useGlobalCall.getState().expand();
    else useIncomingCall.getState().showScreen();
  };

  // 展开姿态：统一 344 宽（与灵动岛同轴心，原地放大），大窗高自适应 / 胶囊 56 高；
  // 初始与退场都是灵动岛几何——弹出/收回与灵动岛同位同色无缝形变（全程覆盖灵动岛）
  const expanded = big
    ? { width: 344, height: 'auto' as const, borderRadius: 22, y: 0, backgroundColor: 'rgba(28,28,30,0.96)' }
    : { width: 344, height: 56, borderRadius: 28, y: 0, backgroundColor: 'rgba(0,0,0,0.94)' };

  return (
    <motion.div
      initial={{ ...ISLAND, backgroundColor: ISLAND_BG }}
      animate={{ ...expanded, transition: SPRING_WITH_BG }}
      exit={{ ...ISLAND, backgroundColor: ISLAND_BG, transition: TWEEN_OUT }}
      onClick={openScreen}
      className="pointer-events-auto relative cursor-pointer overflow-hidden shadow-[0_18px_44px_rgba(0,0,0,0.5)] ring-1 ring-white/10 backdrop-blur-xl"
      role="alertdialog"
      aria-label={big ? `${qq ? 'QQ' : '微信'}语音通话邀请：${call.name}` : `来电：${call.name}`}
      data-testid={big ? (qq ? 'incoming-banner-qq-big' : 'incoming-banner-wx-big') : 'incoming-banner-pill'}
    >
      {/* 内容：弹出基本完成后淡入（形变过程不露内容）；大窗↔胶囊切换时重新淡入 */}
      <motion.div
        key={big ? 'big' : 'pill'}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.16, delay: 0.12 } }}
        exit={{ opacity: 0, transition: { duration: 0.08 } }}
      >
        {big ? (
          <div className="w-[344px] pb-3 pt-3.5">
            <div className="flex items-center gap-3 px-4">
              <BannerAvatar name={call.name} avatar={call.avatar} wx />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px] font-semibold leading-[22px] text-white">{call.name}</div>
                {/* Task 22 视频通话：文案/接听图标随 media 分叉（微信视频邀请弹窗对照截图 6/7） */}
                <div className="mt-0.5 text-[13px] leading-[18px] text-white/50">{call.media === 'video' ? '邀请你视频通话...' : '邀请你语音通话...'}</div>
              </div>
            </div>
            <div className="mt-3.5 flex items-center justify-between pl-5 pr-4">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  // L13 dismiss-only：只收起横幅（onIgnore → 层级状态），不调 engine.reject
                  onIgnore();
                }}
                aria-label="忽略"
                data-testid="incoming-ignore"
                className="flex h-[44px] items-center gap-1.5 rounded-full bg-white/10 pl-4 pr-5 text-[15px] text-white active:bg-white/15"
              >
                <BellOff className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden="true" />
                忽略
              </button>
              <div className="flex items-center gap-3">
                <CircleBtn tone="red" onClick={decline} label="拒绝" />
                <CircleBtn tone="green" onClick={answer} label={call.media === 'video' ? '接听视频' : '接听'} video={call.media === 'video'} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-[56px] w-[344px] items-center justify-between gap-3 pl-4 pr-3">
            {/* 头像+名字靠左，拒接/接听靠右 */}
            <div className="flex min-w-0 items-center gap-2.5">
              <BannerAvatar name={call.name} avatar={call.avatar} />
              <span className="max-w-[170px] truncate text-[15px] font-medium leading-none text-white">{call.name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <CircleBtn tone="red" onClick={decline} label="拒绝" testId="incoming-pill-reject" />
              <CircleBtn tone="green" onClick={answer} label={call.media === 'video' ? '接听视频' : '接听'} video={call.media === 'video'} testId="incoming-pill-accept" />
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

/** 弹窗头像（微信大窗用白色圆角方形+外圈，胶囊用圆形） */
function BannerAvatar({ name, avatar, wx = false }: { name: string; avatar: string | null; wx?: boolean }) {
  if (avatar) {
    return (
      <img
        src={avatar}
        alt=""
        draggable={false}
        className={`h-[40px] w-[40px] shrink-0 object-cover ring-1 ring-white/20 ${wx ? 'rounded-[10px] p-0' : 'rounded-full'}`}
      />
    );
  }
  return (
    <div
      className={`flex h-[40px] w-[40px] shrink-0 items-center justify-center bg-white/15 text-[16px] font-medium text-white ring-1 ring-white/20 ${
        wx ? 'rounded-[10px]' : 'rounded-full'
      }`}
    >
      {name.slice(0, 1)}
    </div>
  );
}

/** 弹窗圆形按钮（红色拒接 / 绿色接听，44px） */
function CircleBtn({
  tone,
  onClick,
  label,
  testId,
  video = false,
}: {
  tone: 'red' | 'green';
  onClick: () => void;
  label: string;
  testId?: string;
  /** Task 22 视频通话：接听按钮显示摄像机图标（视频邀请弹窗对照截图 6/7） */
  video?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      data-testid={testId}
      className={`flex h-[44px] w-[44px] items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-[0.92] ${
        tone === 'red' ? 'bg-[#FF453A]' : 'bg-[#30D158]'
      }`}
    >
      {tone === 'red' ? (
        <PhoneOff className="h-[19px] w-[19px]" strokeWidth={2.2} aria-hidden="true" />
      ) : video ? (
        <Video className="h-[19px] w-[19px]" strokeWidth={2.2} aria-hidden="true" />
      ) : (
        <Phone className="h-[19px] w-[19px]" strokeWidth={2.2} aria-hidden="true" />
      )}
    </button>
  );
}

// ---------------- iOS 全屏来电界面（电话来电；对照第二张截图） ----------------

function IncomingCallScreenImpl({ call }: { call: IncomingCallSnapshot }) {
  // 接听：走 answerPhoneCall（含电话 App 已在前台/锁屏的交接兜底，避免幽灵来电）
  const answer = () => answerPhoneCall();
  const decline = () => useIncomingCall.getState().dismiss('declined');
  /** 「信息」：拒接来电后跨 App 跳到信息 App 与该联系人的会话（iOS 语义：改用短信回复）。
   *  先 decline() 收尾（清层/停铃/落未接记录+AI 留言）再跳转，不残留响铃；
   *  跳转走灵动岛通知同款导航总线（navigateToChatSession = switchToApp + pending 导航事件）：
   *  信息 App 未打开时挂载后自动进会话、已打开时事件驱动立即打开——
   *  旧实现 openApp 在已有前台 App 时被静默拦截（不跳转），且从不打开对应会话 */
  const replyBySms = () => {
    decline();
    const contactId = call.contact?.id;
    if (contactId) navigateToChatSession('chat', contactId);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      className="pointer-events-auto absolute inset-0 z-[84] flex flex-col overflow-hidden bg-gradient-to-b from-[#4a4a4e] via-[#333336] to-[#1c1c1e] text-white"
      role="dialog"
      aria-label={`来自${call.name}的电话`}
      data-testid="incoming-call-screen"
    >
      {/* 顶部操作行：左上「退出」（收起来电界面，来电继续响铃只剩弹窗）+ 右上信息角标 */}
      <div className="relative pt-[64px]">
        <button
          type="button"
          aria-label="退出来电界面"
          data-testid="incoming-screen-exit"
          onClick={() => useIncomingCall.getState().hideScreen()}
          className="absolute left-5 top-[70px] flex h-8 items-center gap-1 rounded-full bg-black/25 pl-2 pr-3 ring-1 ring-white/30 backdrop-blur-sm active:bg-black/45"
        >
          <ChevronLeft className="h-[17px] w-[17px] text-white/85" strokeWidth={2.2} aria-hidden="true" />
          <span className="text-[13px] leading-none text-white/85">退出</span>
        </button>
        <button
          type="button"
          aria-label="通话信息"
          className="absolute right-5 top-[70px] flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-white/35 active:bg-white/10"
          onClick={(e) => e.preventDefault()}
          tabIndex={-1}
        >
          <Info className="h-[18px] w-[18px] text-white/70" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      {/* 来电人信息（头像 + 「主号」标签 + 名字 + 邀请文案） */}
      <div className="flex flex-1 flex-col items-center justify-start px-8 pt-2">
        <div className="flex h-[124px] w-[124px] items-center justify-center overflow-hidden rounded-full bg-white/15 text-[44px] font-light shadow-2xl ring-1 ring-white/20">
          {call.avatar ? (
            <img src={call.avatar} alt="" draggable={false} className="h-full w-full object-cover" />
          ) : (
            <span aria-hidden="true">{call.name.slice(0, 1)}</span>
          )}
        </div>
        <div className="mt-4 flex items-center gap-1.5">
          <span className="rounded-[5px] bg-black/35 px-1.5 py-0.5 text-[11px] font-medium leading-none text-white/85 ring-1 ring-white/25">
            主号
          </span>
          <span className="text-[13px] leading-none text-white/55">手机来电</span>
        </div>
        <h1 className="mt-1.5 max-w-full truncate text-[38px] font-semibold leading-[46px] tracking-tight">
          {call.name}
        </h1>
        <p className="mt-1 text-[16px] text-white/60">语音通话邀请…</p>
      </div>

      {/* 底部操作区：信息/提醒我 + 拒绝/接听 */}
      <div className="px-10 pb-[44px]">
        <div className="flex items-start justify-between">
          <RoundAction
            icon={<MessageCircle className="h-[24px] w-[24px] text-white" strokeWidth={1.9} aria-hidden="true" />}
            label="信息"
            onClick={replyBySms}
          />
          <RoundAction
            icon={<Bell className="h-[24px] w-[24px] text-white" strokeWidth={1.9} aria-hidden="true" />}
            label="提醒我"
            onClick={decline}
          />
        </div>
        <div className="mt-8 flex items-start justify-between">
          <RoundAction
            icon={<PhoneOff className="h-[30px] w-[30px] text-white" strokeWidth={2.1} aria-hidden="true" />}
            label="拒绝"
            tone="red"
            size="lg"
            onClick={decline}
            testId="incoming-screen-reject"
          />
          <RoundAction
            icon={<Phone className="h-[30px] w-[30px] text-white" strokeWidth={2.1} aria-hidden="true" />}
            label="接听"
            tone="green"
            size="lg"
            onClick={answer}
            testId="incoming-screen-accept"
          />
        </div>
      </div>
    </motion.div>
  );
}

/** 来电界面圆形操作钮（信息/提醒我 = 64px 半透明；拒绝/接听 = 76px 红/绿） */
function RoundAction({
  icon,
  label,
  onClick,
  tone = 'plain',
  size = 'md',
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'plain' | 'red' | 'green';
  size?: 'md' | 'lg';
  testId?: string;
}) {
  const sizeCls = size === 'lg' ? 'h-[76px] w-[76px]' : 'h-[64px] w-[64px]';
  const toneCls =
    tone === 'red' ? 'bg-[#FF453A] shadow-[0_10px_28px_rgba(255,69,58,0.35)]' : tone === 'green' ? 'bg-[#30D158] shadow-[0_10px_28px_rgba(48,209,88,0.35)]' : 'bg-white/15';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
      className="flex w-[84px] flex-col items-center gap-1.5 outline-none"
    >
      <span
        className={`flex ${sizeCls} items-center justify-center rounded-full transition-transform active:scale-90 ${toneCls}`}
      >
        {icon}
      </span>
      <span className="text-[13px] text-white/90">{label}</span>
    </button>
  );
}
