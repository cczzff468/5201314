'use client';

/**
 * 全局语音通话层（挂载在 PhoneShell，与 App 窗口平级）：
 *
 * - 全屏通话页（z-[62]）：会话存在即渲染（组件始终挂载、只做视觉隐藏），view==='full' 时可见，
 *   view='pip'（小窗化）/ view='hidden'（微信 AI 来电响铃中）时不可见；
 *   通话引擎（useChatCall）生命周期与 App 切换完全解耦 —— 退出聊天页 / 打开别的 App 电话不断；
 * - 悬浮小窗（z-[64]，对照用户截图）：微信 = 白色圆角卡 + 绿色电话图标 + 绿色时长；
 *   QQ = 白色圆角卡 + 蓝色带波电话图标 + 蓝色时长 + 底部麦克风/摄像头灰色图标条。
 *   点小窗回全屏通话页；可拖动；把小窗顶着左右边缘往里划（越过边缘再推进）才吸附隐藏，
 *   只露一条边缘；拖到边缘松手不隐藏，小窗停在边缘处照常显示；
 * - 边缘条：小窗被「往边缘里划」吸附后只显示一个边缘，点边缘恢复完整小窗（再次点小窗进全屏）。
 *   小窗未初始化位置时先隐藏一帧，由布局 effect 按壳尺寸摆到右上角。
 */

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { MicOff, Phone, PhoneCall, Video, VideoOff } from 'lucide-react';
import { formatCallDuration } from '@/lib/ios/chat-call';
import { useCallSeconds, useGlobalCall } from '@/lib/ios/global-call';
import { navigateToChatSession } from '@/lib/ios/island-notify';
import { useUI } from '@/lib/ios/store';

// 通话页较重（TTS/STT/录音链路），按需加载；该层仅在有会话时渲染内容
const VoiceCallScreen = dynamic(
  () => import('../apps/voice-call-screen').then((m) => m.VoiceCallScreen),
  { ssr: false },
);
// 视频通话页（Task 22）：camera/识图链路较重，按需加载；语音通话零影响
const VideoCallScreen = dynamic(
  () => import('../apps/video-call-screen').then((m) => m.default),
  { ssr: false },
);

/** 小窗宽度（两皮肤一致）；高度：微信 82 / QQ 106（多一条底部图标栏） */
const PIP_W = 72;
const PIP_RADIUS = 12;
const pipHeightOf = (variant: 'wx' | 'qq' | 'phone'): number => (variant === 'qq' ? 106 : 82);
/** 往边缘里面划：拖动中越过边缘再往里推 ≥该像素 → 吸附隐藏（只露一条边缘）。
 *  注意：只是拖到边缘松手不会隐藏，必须是「顶着边缘往里划」这个主动手势；
 *  阈值给足余量，避免贴边拖动时的轻微越界被误判成往里划 */
const EDGE_PUSH = 26;
/** 小窗纵向活动范围上界（避开状态栏）/ 下界（避开底部横杠） */
const PIP_TOP_MIN = 58;

/** 视口坐标 → 手机壳本地坐标（层根元素即壳内坐标系） */
function clampPipPos(
  root: HTMLElement | null,
  x: number,
  y: number,
  pipH: number,
): { x: number; y: number } {
  const w = root?.clientWidth ?? 390;
  const h = root?.clientHeight ?? 844;
  const maxX = Math.max(2, w - PIP_W - 2);
  const maxY = Math.max(PIP_TOP_MIN, h - pipH - 34);
  return {
    x: Math.min(Math.max(2, x), maxX),
    y: Math.min(Math.max(PIP_TOP_MIN, y), maxY),
  };
}

export default function GlobalCallLayer() {
  const session = useGlobalCall((s) => s.session);
  const view = useGlobalCall((s) => s.view);
  const seq = useGlobalCall((s) => s.seq);
  const pipDocked = useGlobalCall((s) => s.pipDocked);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 小窗首次显示：按壳尺寸摆到右上角（状态栏下方）一次，之后位置随拖动走
  useEffect(() => {
    if (!session || view !== 'pip') return;
    if (useGlobalCall.getState().pipPos) return;
    const el = rootRef.current;
    const w = el?.clientWidth ?? 390;
    useGlobalCall.getState().setPipPos(clampPipPos(el, w - PIP_W - 12, 120, pipHeightOf(session.variant)));
  }, [session, view, seq]);

  if (!session) return null;
  const variant = session.variant;
  const isVideo = session.media === 'video';
  // 语音通话页只有 wx/qq 两皮肤；variant='phone' 仅用于视频（电话 App 视频走全局层），窄化给 VoiceCallScreen
  const voiceVariant: 'wx' | 'qq' = variant === 'phone' ? 'wx' : variant;

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0" data-testid="global-call-layer">
      {/* 全屏通话页：key=seq 保证新通话重挂载；小窗化时只做视觉隐藏（组件必须保持挂载，
          一旦卸载 useChatCall 的清理 effect 会终止通话引擎）——电话不断的关键 */}
      <div
        className={`pointer-events-auto absolute inset-0 z-[62] ${view === 'full' ? '' : 'pointer-events-none invisible'}`}
        aria-hidden={view !== 'full'}
      >
        {isVideo ? (
          /* 视频通话页（Task 22）：同一全局层承载，微信/QQ/电话三皮肤共用引擎；
             电话视频无「消息回复」语义（电话无聊天面板），不传 onMessageReply */
          <VideoCallScreen
            key={seq}
            variant={variant}
            name={session.name}
            avatar={session.avatar}
            myAvatar={session.myAvatar}
            contact={session.contact}
            direction={session.direction}
            initialHistory={session.initialHistory}
            memoryBlock={session.memoryBlock}
            memoryBlockFn={session.memoryBlockFn}
            worldbookBlock={session.worldbookBlock}
            momentsBlock={session.momentsBlock}
            timeBlock={session.timeBlock}
            locBlock={session.locBlock}
            multiApp={session.multiApp}
            onFollowup={session.onFollowup}
            onMinimize={() => useGlobalCall.getState().minimize()}
            // 消息回复（Task 23 视频来电页新增，对照微信截图）：拒接来电并跳回微信/QQ 聊天会话
            // （灵动岛通知同款导航总线：未打开时挂载后自动进会话，已打开时事件驱动立即打开）
            onMessageReply={
              variant === 'phone'
                ? undefined
                : () => {
                    const contactId = session.contact?.id;
                    if (contactId) navigateToChatSession(variant === 'qq' ? 'qq' : 'wechat', contactId);
                    else useUI.getState().switchToApp(variant === 'qq' ? 'qq' : 'wechat');
                  }
            }
            onEnd={(r) => {
              const s = useGlobalCall.getState().session;
              try {
                s?.onEnd(r);
              } finally {
                useGlobalCall.getState().close();
              }
            }}
          />
        ) : (
        <VoiceCallScreen
          key={seq}
          variant={voiceVariant}
          name={session.name}
          avatar={session.avatar}
          contact={session.contact}
          direction={session.direction}
          initialHistory={session.initialHistory}
          memoryBlock={session.memoryBlock}
          memoryBlockFn={session.memoryBlockFn}
          worldbookBlock={session.worldbookBlock}
          momentsBlock={session.momentsBlock}
          timeBlock={session.timeBlock}
          locBlock={session.locBlock}
          multiApp={session.multiApp}
          onFollowup={session.onFollowup}
          onMinimize={() => useGlobalCall.getState().minimize()}
          // QQ 来电「消息回复」：通话页已先 call.reject()（拒接 +「已拒绝」卡片落盘），
          // 这里切到 QQ App 并打开与该来电联系人的聊天会话（灵动岛通知同款导航总线：
          // switchToApp + pending 导航——QQ 未打开时挂载后自动进会话，已打开时事件驱动立即打开；
          // 旧实现传空函数，拒接后停在原界面什么都不发生）
          onMessageReply={
            voiceVariant === 'qq'
              ? () => {
                  const contactId = session.contact?.id;
                  if (contactId) navigateToChatSession('qq', contactId);
                  else useUI.getState().switchToApp('qq');
                }
              : undefined
          }
          onEnd={(r) => {
            // 宿主直写通话卡片（聊天页卸载了也能落盘），随后清理全局会话
            const s = useGlobalCall.getState().session;
            try {
              s?.onEnd(r);
            } finally {
              useGlobalCall.getState().close();
            }
          }}
        />
        )}
      </div>
      {/* 悬浮小窗 / 边缘条（仅小窗化时渲染；全屏页保持挂载在上方） */}
      {view === 'pip' && (pipDocked ? <CallPipEdge /> : <CallPipWindow variant={variant} media={session.media} rootRef={rootRef} />)}
    </div>
  );
}

// ---------------- 悬浮小窗（对照用户截图：微信绿 / QQ 蓝 + 底部图标条） ----------------

function CallPipWindow({
  variant,
  media = 'voice',
  rootRef,
}: {
  variant: 'wx' | 'qq' | 'phone';
  /** 通话媒体（Task 22）：video 小窗显示摄像机图标（绿/蓝同款配色） */
  media?: 'voice' | 'video';
  rootRef: React.RefObject<HTMLDivElement | null>;
}) {
  const seconds = useCallSeconds();
  const pos = useGlobalCall((s) => s.pipPos);
  const setPipPos = useGlobalCall((s) => s.setPipPos);
  const expand = useGlobalCall((s) => s.expand);
  const dock = useGlobalCall((s) => s.dock);
  const pipH = pipHeightOf(variant);
  const isQQ = variant === 'qq';
  const isVideo = media === 'video';

  /** 拖拽状态：起点 + 小窗原始位置 + 是否移动过（区分点击与拖动） */
  const drag = useRef<{ pid: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  /** 结束拖拽（释放指针捕获 + 清拖拽态）；吸附隐藏时与 pointerUp 共用 */
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // 已释放
    }
    drag.current = null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current || !pos) return;
    drag.current = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pid) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 6) return; // 位移过小 = 点击
    d.moved = true;
    // 往边缘里面划（顶着边缘继续往里推）→ 吸附隐藏，只露一条边缘；
    // 只是拖到边缘松手不会隐藏，小窗停在边缘处照常显示
    const w = rootRef.current?.clientWidth ?? 390;
    const rawX = d.ox + dx;
    if (rawX < -EDGE_PUSH) {
      endDrag(e);
      dock('left');
      return;
    }
    if (rawX + PIP_W > w + EDGE_PUSH) {
      endDrag(e);
      dock('right');
      return;
    }
    setPipPos(clampPipPos(rootRef.current, rawX, d.oy + dy, pipH));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pid) return;
    endDrag(e);
    if (!d.moved) {
      // 点小窗 → 进入打电话界面
      expand();
      return;
    }
    // 松手不做任何吸附：拖到边缘松手 = 小窗停在边缘处继续显示
  };

  if (!pos) return null; // 等待布局 effect 初始化位置（渲染一帧空层）

  return (
    <div
      role="button"
      aria-label={`语音通话进行中 ${formatCallDuration(seconds)}，点击回到通话界面`}
      data-testid={`${variant}-call-pip`}
      className="pointer-events-auto absolute z-[64] cursor-pointer select-none overflow-hidden bg-white shadow-[0_12px_32px_rgba(0,0,0,0.24)] transition-opacity active:opacity-90"
      style={{ left: pos.x, top: pos.y, width: PIP_W, height: pipH, borderRadius: PIP_RADIUS, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {isQQ ? (
        <div className="flex h-full flex-col">
          <div className="flex flex-1 flex-col items-center justify-center gap-1">
            {isVideo ? (
              <Video className="h-[25px] w-[25px] text-[#0099FF]" strokeWidth={2.1} aria-hidden="true" />
            ) : (
              <PhoneCall className="h-[25px] w-[25px] text-[#0099FF]" strokeWidth={2.1} aria-hidden="true" />
            )}
            <span className="text-[15px] font-medium leading-none tabular-nums text-[#0099FF]" data-testid="qq-pip-duration">
              {formatCallDuration(seconds)}
            </span>
          </div>
          {/* 底部图标条（对照截图：灰色麦克风静音 / 摄像头关闭） */}
          <div className="flex h-[26px] items-center justify-around border-t border-black/[0.06] bg-black/[0.035]">
            <MicOff className="h-[12px] w-[12px] text-black/25" strokeWidth={2} aria-hidden="true" />
            <VideoOff className={`h-[12px] w-[12px] ${isVideo ? 'text-[#0099FF]' : 'text-black/25'}`} strokeWidth={2} aria-hidden="true" />
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1">
          {isVideo ? (
            <Video className="h-[25px] w-[25px] text-[#07C160]" strokeWidth={2} aria-hidden="true" />
          ) : (
            <Phone className="h-[25px] w-[25px] text-[#07C160]" strokeWidth={0} fill="currentColor" aria-hidden="true" />
          )}
          <span className="text-[15px] font-medium leading-none tabular-nums text-[#07C160]" data-testid="wx-pip-duration">
            {formatCallDuration(seconds)}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------- 边缘条（小窗吸附到边缘后：只显示一个边缘，点击恢复小窗全貌） ----------------

function CallPipEdge() {
  const side = useGlobalCall((s) => s.pipSide);
  const pos = useGlobalCall((s) => s.pipPos);
  const undock = useGlobalCall((s) => s.undock);
  // pos.y 在写入时已按壳高度夹紧（clampPipPos），这里直接使用，不在渲染期读 ref
  const top = pos?.y ?? 120;
  return (
    <button
      type="button"
      aria-label="展开通话小窗"
      data-testid="call-pip-edge"
      onClick={undock}
      className={`pointer-events-auto absolute z-[64] w-[7px] bg-white/90 ring-1 ring-black/15 shadow-[0_2px_12px_rgba(0,0,0,0.25)] transition-opacity active:opacity-70 ${
        side === 'left' ? 'left-0 rounded-r-full' : 'right-0 rounded-l-full'
      }`}
      style={{ top, height: 56 }}
    />
  );
}
