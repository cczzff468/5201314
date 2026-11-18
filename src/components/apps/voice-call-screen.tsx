'use client';

/**
 * 微信 / QQ 语音通话界面（同一引擎 useChatCall，两种皮肤）：
 *
 * - 微信皮肤（对照用户截图）：深色背景；接通后顶部居中显示通话时长；方形圆角头像；
 *   底部三个圆形按钮（麦克风 / 挂断 / 扬声器，麦克风任何时候都在，拨号中也可看可按）；
 *   来电页「邀请你语音通话」+ 红拒绝/绿接听圆形按钮 +
 *   「1小时内隐藏他的来电」胶囊；点按麦克风说话、再点发送，长按麦克风静音。
 * - QQ 皮肤（对照用户截图）：深色背景；圆形大头像；呼叫中「正在呼叫…」；接通后时长显示在
 *   底部按钮上方；底部三个圆角方形按钮（麦克风 / 扬声器 / 挂断，居中拉开间距）；
 *   来电页「邀请你语音通话」+「消息回复」+ 红挂断/绿接听圆角方按钮；长按麦克风静音。
 *
 * - 免提「自动对话」模式（VAD）：AI 说完自动开始听 → 用户直接说话（无需点任何按钮）→
 *   说完停顿 1.4s 自动发送 → AI 回复播完自动回到聆听，循环；麦克风按钮点一下=临时静音
 *   （长按亦可）；说话中点麦克风立即发送；状态区「在听你说…/正在听/正在思考…/识别中…」等。
 * - 通话单句弹幕（CaptionStream）：同一时刻只显示 AI 最新一句（我方说话不上屏），新句出现旧句消失；
 *   完整聊天气泡在挂断后落进聊天记录（引擎回传 transcript，宿主 writeCallCard 逐条落库）——
 *   「打电话界面显示单句弹幕，聊天界面才显示聊天气泡」；文字聊天不再单设消息区（弹幕继续显示，信息开关只控输入条）。
 * - 通话中文字聊天：接通后右上角信息图标开关——打开即进入「信息界面」（与打电话界面同款：
 *   语音说的+打字的全部轮次以气泡完整呈现，语音轮次带声波小标），开启期间字幕隐藏；
 *   AI 回复文字进消息区同时用角色音色 TTS 播报
 *   （Task 33：只要配置了声音——内置语音免配置恒可用，配了第三方语音 API 用 API——打字回复也出声）；
 *   关闭输入条字幕恢复，通话不断；QQ 电话同样。
 * - 通话卡片（CallCardBubble）：结束后插入聊天记录——普通文字气泡同款样式（跟普通气泡一样），
 *   电话图标 + 文案（已取消（点击重拨）/ 对方未接听 / 对方已拒绝 / 已拒绝 / 未接听 / 通话时长）；
 *   QQ 蓝底白字图标在文字前，微信我方绿底文字在前、对方白底图标在前；微信图标朝下（通话记录样式）。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AudioLines,
  BellOff,
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  PictureInPicture2,
  SendHorizontal,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { DefaultAvatar } from './default-avatar';
import {
  formatCallDuration,
  useChatCall,
  type ChatCallApi,
  type ChatCallResult,
  type ChatCallTurnMsg,
} from '@/lib/ios/chat-call';
import type { ContactRecord } from '@/lib/contacts';

// ---------------- 通话界面 ----------------

export interface VoiceCallScreenProps {
  variant: 'wx' | 'qq';
  name: string;
  avatar: string | null;
  contact: ContactRecord | null;
  direction: 'out' | 'in';
  /** 进入通话时携带的最近聊天上下文（宿主按会话消息归并） */
  initialHistory: ChatCallTurnMsg[];
  /** 宿主组装的 system 附加块（记忆/动态/时间感知）
   *  memoryBlock 为发起时快照（兜底）；memoryBlockFn 每轮以「用户刚说的话」重新召回（优先使用） */
  memoryBlock?: string;
  /** 每轮动态召回记忆（宿主组装；引擎逐轮调用，优先于 memoryBlock） */
  memoryBlockFn?: (userText: string | null) => string | undefined;
  /** 世界书块（宿主 collectWbBlocks 组装；随人设注入 turn API） */
  worldbookBlock?: string;
  momentsBlock?: string;
  timeBlock?: string;
  /** 位置感知块（与文字聊天同一套 buildLocationBlock）：通话里 AI 知道“用户在哪” */
  locBlock?: string;
  multiApp?: boolean;
  /** 通话结束（恰好一次）：宿主生成通话卡片并关闭浮层 */
  onEnd: (r: ChatCallResult) => void;
  /** 挂断后 AI 续聊文字生成完毕（引擎异步产出，紧随挂断）：宿主以聊天消息落盘 */
  onFollowup?: (texts: string[]) => void;
  /** 左上角小窗图标点击：收起为全局悬浮小窗（全局层传入；无则仅展示不可点） */
  onMinimize?: () => void;
  /** QQ 来电页「消息回复」：挂断来电并回到聊天 */
  onMessageReply?: () => void;
}

export function VoiceCallScreen(props: VoiceCallScreenProps) {
  const { variant } = props;
  return (
    <div
      className="absolute inset-0 z-[70] flex flex-col overflow-hidden text-white"
      style={{
        background:
          variant === 'wx'
            ? 'radial-gradient(120% 90% at 50% 0%, #3a3a41 0%, #232327 42%, #0b0b0d 100%)'
            : 'radial-gradient(120% 90% at 50% 10%, #33333a 0%, #202024 45%, #0a0a0c 100%)',
      }}
      role="dialog"
      aria-label={`与${props.name}的语音通话`}
      data-testid={`vc-screen-${props.variant}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.07),transparent_55%)]" />
      {variant === 'wx' ? <WxCallScreen {...props} /> : <QqCallScreen {...props} />}
    </div>
  );
}

/** 头像（微信方形圆角 / QQ 圆形） */
function CallAvatar({ variant, avatar, size }: { variant: 'wx' | 'qq'; avatar: string | null; size: number }) {
  if (avatar) {
    return (
      <img
        src={avatar}
        alt=""
        className={`shrink-0 object-cover shadow-2xl ring-1 ring-white/15 ${variant === 'wx' ? 'rounded-[16px]' : 'rounded-full'}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <DefaultAvatar
      size={size}
      shape={variant === 'wx' ? 'square' : 'circle'}
      className={`${variant === 'wx' ? 'rounded-[16px]' : 'rounded-full'} shadow-2xl ring-1 ring-white/15`}
    />
  );
}

/** 左上角小窗图标（两 App 通话页都有；点击收起为全局悬浮小窗，通话不断） */
function PipIcon({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label="收起为悬浮小窗"
      data-testid="call-pip-btn"
      onClick={onClick}
      disabled={!onClick}
      className="absolute left-5 top-16 z-10 flex h-10 w-10 items-center justify-center rounded-[12px] bg-white/10 text-white/80 backdrop-blur-sm transition-colors active:opacity-60"
    >
      <PictureInPicture2 className="h-5 w-5" strokeWidth={1.8} />
    </button>
  );
}

/** 状态区文案（正在说话 / 正在听 / 正在思考… / 识别中…）；导出供视频通话页复用（Task 24：视频通话同款状态显示） */
export function statusLine(
  phase: 'dialing' | 'incoming' | 'active' | 'ended',
  status: 'connecting' | 'listening' | 'recording' | 'recognizing' | 'thinking' | 'speaking',
  variant: 'wx' | 'qq',
): string {
  if (phase === 'incoming') return '邀请你语音通话';
  if (phase === 'dialing') return variant === 'wx' ? '等待对方接受邀请' : '正在呼叫…';
  switch (status) {
    case 'speaking':
      return '正在说话';
    case 'thinking':
      return '正在思考…';
    case 'recognizing':
      return '识别中…';
    case 'recording':
      return '在听你说…';
    default:
      return '正在听';
  }
}

// ---------------- 通话字幕（居中单句模式；语音/视频通话页同用） ----------------

/** 单句字幕（只显示 AI 说的话——我方说话不上屏，用户反馈「不好看」）：
 *  居中对齐、字号加大（17px）、柔白；弹跳入场；无头像无光标竖线 */
function CaptionLine({ children }: { children: ReactNode }) {
  return (
    <p className="animate-call-caption w-full whitespace-pre-wrap break-words px-1 text-center text-[17px] leading-[1.6] text-white/60">
      {children}
    </p>
  );
}

/**
 * 通话字幕（单句弹幕；宿主把容器放在头像名字下方，超高内部滚动并自动滚底）：
 * - 只显示 AI 说的话（我说的话不再上屏——用户反馈；录音期间的 Web Speech 实时识别增量仅作
 *   liveHeard 展示，不作为字幕渲染）；
 * - 同一时刻只渲染 AI 最新一句：揭示中（aiReveal 与 TTS 播放进度同步逐字）渲染部分文本，
 *   否则渲染 chatLog 里最后一条 assistant 消息；AI 开新口，上一句自动被替换。
 *   完整聊天气泡在挂断后落进聊天记录（ChatCallResult.transcript → 宿主 writeCallCard）。
 */
/** 导出供语音/视频通话页共用：单句弹幕字幕（只显示 AI 说的话） */
export function CaptionStream({ variant, call }: { variant: 'wx' | 'qq'; call: ChatCallApi }) {
  const { chatLog, aiReveal } = call;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 新句替换/逐字揭示时保持滚到底（超长句内部滚动可见最新）
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatLog, aiReveal]);

  // AI 最新一句（chatLog 从尾部向前找 assistant；用户消息不入字幕）
  let lastAsstIdx = -1;
  for (let i = chatLog.length - 1; i >= 0; i--) {
    if (chatLog[i].role === 'assistant') {
      lastAsstIdx = i;
      break;
    }
  }
  const revealing =
    aiReveal !== null && lastAsstIdx >= 0 && chatLog[lastAsstIdx].content === aiReveal.text;

  let line: ReactNode = null;
  if (lastAsstIdx >= 0) {
    const m = chatLog[lastAsstIdx];
    const partial = revealing && aiReveal;
    const text = partial ? aiReveal.text.slice(0, aiReveal.shown) : m.content;
    line = <CaptionLine key={`${m.at}-${lastAsstIdx}`}>{text}</CaptionLine>;
  }

  return (
    <div
      ref={scrollRef}
      className="no-scrollbar flex max-h-full w-full flex-col items-center justify-end overflow-y-auto"
      aria-live="polite"
      data-testid={`${variant}-call-captions`}
    >
      {line}
    </div>
  );
}

// ---------------- 通话中文字聊天内联条（右上角信息图标开关；AI 配了语音 API 语音回复，否则文字） ----------------

/**
 * 聊天模式顶部 header（Task 28 定稿）：小头像（24px 圆形，无头像用 DefaultAvatar 兜底）+名字
 * （15px，超长 truncate），宿主放在通话时长上方——「头像名字变小放在顶部时长上面」；
 * 聊天模式下通话页中央的大头像+名字隐藏（Task 28 定稿），此行即当前通话对象标识。
 * 导出供语音/视频通话四屏共用。
 */
export function CallChatHeader({ name, avatar }: { name: string; avatar: string | null }) {
  return (
    <div className="flex max-w-[260px] items-center gap-2" data-testid="call-chat-header">
      {avatar ? (
        <img src={avatar} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-white/20" />
      ) : (
        <DefaultAvatar size={24} shape="circle" className="shrink-0" />
      )}
      <span className="min-w-0 truncate text-[15px] font-medium text-white/95">{name}</span>
    </div>
  );
}

/**
 * 通话中文字聊天内联条（消息区+输入栏；原全屏文字面板已废弃）：
 * - 右上角信息图标开关：开启期间字幕隐藏（用户需求），关闭字幕恢复；通话不断；
 * - Task 28 定稿（用户反馈）：面板不再自带 header——小头像+名字由宿主 CallChatHeader 放到屏幕
 *   顶部时长上方；聊天模式下中央大头像+名字隐藏，「头像名字下面都是文字输入」，底部按钮不消失；
 * - 信息界面与打电话界面同款（用户需求）：显示【全部轮次】——语音说的（带声波小标）+
 *   打字的全部上屏，对方白气泡在左/我方绿气泡在右，可滚动自动滚底；不再只显示文字轮次；
 *   fill=true（语音通话页）时消息列表 flex-1 撑满剩余空间（与打电话页同构），
 *   否则用 messagesMaxH 限高（视频通话页 20vh，防顶到互换态全屏「我的头像」；
 *   用内联样式而非 Tailwind 任意值类——max-h-[20vh] 类在部分构建管线下不生成 CSS）；
 * - 消息区底部锚定按钮均为流式/底部锚定布局，消息区再高按钮也不会被顶出屏幕；
 * - AI 回复形态由引擎决定（sendText/runTurn）：配置了第三方语音 API → TTS 语音回复（不出文字），
 *   没配 → 文字回复（消息区气泡）；AI 回应中显示三点动画。
 */
/** 导出供视频通话页复用（Task 22） */
export function InlineCallChat({
  variant,
  call,
  className = '',
  messagesMaxH = '35vh',
  fill = false,
}: {
  variant: 'wx' | 'qq';
  call: ChatCallApi;
  className?: string;
  /** 消息区最大高（CSS 值，内联 style maxHeight）：默认 35vh；视频通话传 20vh。
   *  fill=true 时忽略（消息列表 flex-1 填满剩余空间） */
  messagesMaxH?: string;
  /** true = 消息列表 flex-1 填满（语音通话页与打电话页同构）；默认 false（限高模式） */
  fill?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const { chatLog, textBusy, error } = call;
  const listRef = useRef<HTMLDivElement | null>(null);
  // 信息界面显示全部轮次（与打电话界面同款）：语音说的 + 打字的，空消息（流式空气泡）过滤
  const transcriptMsgs = chatLog.filter((m) => m.content.trim().length > 0);
  const lastMsg = transcriptMsgs[transcriptMsgs.length - 1];

  // 新消息/回应中自动滚到底
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatLog.length, textBusy]);

  const send = () => {
    const t = draft.trim();
    if (!t || textBusy) return;
    call.sendText(t);
    setDraft('');
  };

  return (
    <div className={`${fill ? 'flex min-h-0 flex-1 flex-col' : 'shrink-0'} ${className}`} data-testid={`${variant}-call-textbar`}>
      {/* 全部轮次消息（语音+文字；超高滚动；无滚动条）——与打电话信息界面同款 */}
      {(transcriptMsgs.length > 0 || textBusy) && (
        <div
          ref={listRef}
          style={fill ? undefined : { maxHeight: messagesMaxH }}
          className="no-scrollbar mx-1 mb-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
        >
          {transcriptMsgs.map((m, i) => (
            <div key={`${m.at}-${i}`} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <p
                className={`flex max-w-[82%] items-start gap-1.5 whitespace-pre-wrap break-words px-3.5 py-2 text-[14.5px] leading-snug shadow-[0_1px_3px_rgba(0,0,0,0.3)] ${
                  m.role === 'user'
                    ? 'rounded-[16px] rounded-br-[5px] bg-[#34C759] text-white'
                    : 'rounded-[16px] rounded-bl-[5px] bg-white/15 text-white/95'
                }`}
              >
                {/* 语音轮次带声波小标（与打电话信息界面同款：语音说的也能看出来） */}
                {m.via !== 'text' && <AudioLines className="mt-[3px] h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />}
                <span className="min-w-0">{m.content}</span>
              </p>
            </div>
          ))}
          {textBusy && (!lastMsg || lastMsg.role === 'user') && (
            <div className="flex justify-start">
              <p
                className="flex items-center gap-1.5 rounded-[16px] rounded-bl-[5px] bg-white/15 px-3.5 py-2.5"
                aria-label="对方正在回应"
              >
                {[0, 150, 300].map((d) => (
                  <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60" style={{ animationDelay: `${d}ms` }} />
                ))}
              </p>
            </div>
          )}
        </div>
      )}
      {error && <p className="px-2 pb-1.5 text-center text-[12px] text-red-300">{error}</p>}
      {/* 输入栏（三按钮上方；信息图标开合）——与打电话界面同款胶囊输入框 */}
      <div className="flex shrink-0 items-center gap-2 pb-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="输入要说的话…"
          maxLength={200}
          aria-label="输入要说的话"
          data-testid={`${variant}-call-textbar-input`}
          className="h-10 min-w-0 flex-1 rounded-full border border-white/20 bg-white/10 px-4 text-[15px] text-white outline-none transition-colors placeholder:text-white/35 focus:border-white/45"
        />
        <button
          type="button"
          onClick={send}
          disabled={!draft.trim() || textBusy}
          aria-label="发送"
          data-testid={`${variant}-call-textbar-send`}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors active:opacity-70 ${
            draft.trim() && !textBusy ? 'bg-white text-black' : 'bg-white/10 text-white/40'
          }`
        }
        >
          <SendHorizontal className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

// ---------------- 微信皮肤 ----------------

function WxCallScreen({ name, avatar, contact, direction, initialHistory, memoryBlock, memoryBlockFn, worldbookBlock, momentsBlock, timeBlock, locBlock, multiApp, onEnd, onFollowup, onMinimize }: VoiceCallScreenProps) {
  const call = useChatCall({ app: 'wx', contact, direction, initialHistory, memoryBlock, memoryBlockFn, worldbookBlock, momentsBlock, timeBlock, locBlock, multiApp, onEnd, onFollowup });
  const { phase, status, seconds, muted, speakerOn, error } = call;
  const [textChatOpen, setTextChatOpen] = useState(false);

  const openTextChat = () => {
    if (phase !== 'active') return;
    call.setTextMode(true); // 打断进行中的录音/播报；字幕隐藏，回复走输入条
    setTextChatOpen(true);
  };
  const closeTextChat = () => {
    call.setTextMode(false);
    setTextChatOpen(false);
  };
  const toggleTextChat = () => (textChatOpen ? closeTextChat() : openTextChat());

  // 长按麦克风 = 静音切换；点按 = 说话/发送
  const holdTimer = useRef<number | null>(null);
  const longFired = useRef(false);
  const holdStart = () => {
    longFired.current = false;
    if (phase !== 'active') return;
    holdTimer.current = window.setTimeout(() => {
      longFired.current = true;
      call.toggleMute();
    }, 550);
  };
  const holdEnd = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  const micClick = () => {
    if (longFired.current) return;
    if (muted) {
      call.toggleMute();
      return;
    }
    call.tapMic();
  };

  const wxRound = 'flex h-[74px] w-[74px] items-center justify-center rounded-full transition-colors active:opacity-70';

  return (
    <div className="relative z-10 flex h-full flex-col">
      <PipIcon onClick={onMinimize} />
      {/* 接通后顶部：普通模式=居中计时（对照截图 12:00:00）；聊天模式=小头像+名字在时长上方
          （Task 28 定稿「头像名字变小放在顶部时长上面」），时长下再带一行 AI 状态 */}
      {phase === 'active' && textChatOpen && (
        <div className="flex flex-col items-center gap-1.5 pt-[56px]">
          <CallChatHeader name={name} avatar={avatar} />
          <div className="text-[15px] tabular-nums text-white/85" data-testid="wx-call-duration">
            {formatCallDuration(seconds)}
          </div>
          <div className="text-[11px] leading-none text-white/55" aria-live="polite">
            {statusLine('active', status, 'wx')}
          </div>
        </div>
      )}
      {phase === 'active' && !textChatOpen && (
        <div className="pt-[70px] text-center text-[20px] font-light tabular-nums text-white/95" data-testid="wx-call-duration">
          {formatCallDuration(seconds)}
        </div>
      )}
      {/* 右上角信息图标：接通后可开关文字聊天输入条（再点一次关闭） */}
      {phase === 'active' && (
        <button
          type="button"
          aria-label="发消息"
          aria-pressed={textChatOpen}
          data-testid="wx-call-textchat-btn"
          onClick={toggleTextChat}
          className={`absolute right-5 top-[64px] z-10 flex h-10 w-10 items-center justify-center rounded-[12px] backdrop-blur-sm transition-colors active:opacity-60 ${
            textChatOpen ? 'bg-white/25 text-white' : 'bg-white/10 text-white/80'
          }`}
        >
          <MessageSquare className="h-5 w-5" strokeWidth={1.8} />
        </button>
      )}

      {/* 中部：普通模式=头像名字居中（顶部弹性区封顶，把空间让给单句弹幕——与电话 App 同款，
          拨号中与接通后头像位置连续不跳）；聊天模式：完整对话记录（语音+文字全部轮次，
          与打电话信息界面同款）+ 输入栏，底部按钮不受影响仍在 */}
      {textChatOpen && phase === 'active' ? (
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-1">
          <InlineCallChat variant="wx" call={call} className="w-full" fill />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center px-8 pb-9">
          <div className="min-h-4 max-h-[72px] flex-1" aria-hidden="true" />
          <div className="relative mt-1">
            {phase === 'dialing' && <span className="absolute inset-0 animate-ping rounded-[16px] bg-white/10" aria-hidden="true" />}
            <CallAvatar variant="wx" avatar={avatar} size={104} />
          </div>
          <h2 className="mt-5 max-w-[280px] truncate text-[22px] font-medium leading-tight">{name}</h2>
          <p className="mt-1.5 text-[14px] text-white/60" aria-live="polite" data-testid="wx-call-status">
            {statusLine(phase, status, 'wx')}
          </p>
          {error && <p className="mt-2 max-w-[280px] text-center text-[12px] text-red-300">{error}</p>}
          {phase === 'active' ? (
            <div
              className="flex min-h-[44px] w-full flex-1 flex-col overflow-hidden px-1 pt-4"
              aria-label="通话字幕"
            >
              {/* 单句弹幕：只显示 AI 最新一句（我方说话不上屏）；完整聊天气泡在挂断后的聊天记录里看 */}
              <CaptionStream variant="wx" call={call} />
            </div>
          ) : (
            <div className="min-h-4 flex-1" aria-hidden="true" />
          )}
        </div>
      )}

      {/* 底部按钮区 */}
      {phase === 'incoming' ? (
        <div className="flex flex-col items-center px-8 pb-[max(30px,env(safe-area-inset-bottom))]">
          <div className="flex w-full items-start justify-between px-6">
            <div className="flex flex-col items-center gap-2">
              <button type="button" onClick={call.reject} aria-label="拒绝" data-testid="wx-call-reject" className={`${wxRound} bg-[#FA5151] text-white`}>
                <PhoneOff className="h-8 w-8" strokeWidth={2} />
              </button>
              <span className="text-[13px] text-white/85">拒绝</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button type="button" onClick={call.accept} aria-label="接听" data-testid="wx-call-accept" className={`${wxRound} bg-[#07C160] text-white`}>
                <Phone className="h-8 w-8" strokeWidth={2} />
              </button>
              <span className="text-[13px] text-white/85">接听</span>
            </div>
          </div>
          <div className="mt-8 flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-[13px] text-white/70 backdrop-blur-sm">
            <BellOff className="h-4 w-4" strokeWidth={1.8} />
            1小时内隐藏他的来电
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center px-8 pb-[max(34px,env(safe-area-inset-bottom))]">
          <div className="flex w-full items-end justify-center gap-12">
            {/* 麦克风：任何时候都在（拨号中也在，对照微信原生）；免提自动听，点按/长按=临时静音 */}
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                aria-label={muted ? '取消静音' : status === 'recording' ? '立即发送' : '麦克风（免提自动听）'}
                aria-pressed={muted}
                data-testid="wx-call-mic"
                onPointerDown={holdStart}
                onPointerUp={holdEnd}
                onPointerLeave={holdEnd}
                onContextMenu={(e) => e.preventDefault()}
                onClick={micClick}
                className={`${wxRound} select-none ${
                  status === 'recording' ? 'bg-white text-black ring-2 ring-[#07C160]' : muted ? 'bg-white/10 text-white/85' : 'bg-white/10 text-white'
                }`}
              >
                {muted ? <MicOff className="h-7 w-7" strokeWidth={1.9} /> : <Mic className={`h-7 w-7 ${status === 'recording' ? 'animate-pulse' : ''}`} strokeWidth={1.9} />}
              </button>
              <span className="max-w-[86px] text-center text-[12px] leading-tight text-white/75">
                {muted ? '麦克风已关' : '麦克风已开'}
              </span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button type="button" onClick={call.hangup} aria-label="挂断" data-testid="wx-call-hangup" className={`${wxRound} bg-[#FA5151] text-white`}>
                <PhoneOff className="h-8 w-8" strokeWidth={2} />
              </button>
              <span className="text-[13px] text-white/85">挂断</span>
            </div>
            {/* 扬声器（拨号中也可切换） */}
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={call.toggleSpeaker}
                aria-label={speakerOn ? '关闭扬声器' : '开启扬声器'}
                aria-pressed={speakerOn}
                data-testid="wx-call-speaker"
                className={`${wxRound} ${speakerOn ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
              >
                {speakerOn ? <Volume2 className="h-7 w-7" strokeWidth={1.9} /> : <VolumeX className="h-7 w-7" strokeWidth={1.9} />}
              </button>
              <span className="text-[12px] text-white/75">{speakerOn ? '扬声器已开' : '扬声器已关'}</span>
            </div>
          </div>
          {phase === 'active' && !muted && (
            <p className="mt-4 text-[11px] text-white/35">免提自动对话 · 直接说话即可 · 点按/长按静音</p>
          )}
        </div>
      )}

    </div>
  );
}

// ---------------- QQ 皮肤 ----------------

function QqCallScreen({ name, avatar, contact, direction, initialHistory, memoryBlock, memoryBlockFn, worldbookBlock, momentsBlock, timeBlock, locBlock, multiApp, onEnd, onFollowup, onMinimize, onMessageReply }: VoiceCallScreenProps) {
  const call = useChatCall({ app: 'qq', contact, direction, initialHistory, memoryBlock, memoryBlockFn, worldbookBlock, momentsBlock, timeBlock, locBlock, multiApp, onEnd, onFollowup });
  const { phase, status, seconds, muted, speakerOn, error } = call;
  const [textChatOpen, setTextChatOpen] = useState(false);

  const openTextChat = () => {
    if (phase !== 'active') return;
    call.setTextMode(true); // 打断进行中的录音/播报；字幕隐藏，回复走输入条
    setTextChatOpen(true);
  };
  const closeTextChat = () => {
    call.setTextMode(false);
    setTextChatOpen(false);
  };
  const toggleTextChat = () => (textChatOpen ? closeTextChat() : openTextChat());

  // 长按麦克风 = 静音切换（原三条横杠菜单里的静音入口移到长按手势）；点按 = 说话/发送
  const holdTimer = useRef<number | null>(null);
  const longFired = useRef(false);
  const holdStart = () => {
    longFired.current = false;
    if (phase !== 'active') return;
    holdTimer.current = window.setTimeout(() => {
      longFired.current = true;
      call.toggleMute();
    }, 550);
  };
  const holdEnd = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  const micClick = () => {
    if (longFired.current) return;
    if (muted) {
      call.toggleMute();
      return;
    }
    call.tapMic();
  };

  const qqSquare =
    'flex h-[72px] w-[72px] items-center justify-center rounded-[26px] transition-colors active:opacity-70';
  const darkBtn = `${qqSquare} bg-white/10 text-white`;
  const whiteBtn = `${qqSquare} bg-white text-black`;

  return (
    <div className="relative z-10 flex h-full flex-col">
      <PipIcon onClick={onMinimize} />

      {/* 右上角信息图标：接通后可开关文字聊天输入条（与微信皮肤一致，再点一次关闭） */}
      {phase === 'active' && (
        <button
          type="button"
          aria-label="发消息"
          aria-pressed={textChatOpen}
          data-testid="qq-call-textchat-btn"
          onClick={toggleTextChat}
          className={`absolute right-5 top-16 z-10 flex h-10 w-10 items-center justify-center rounded-[12px] backdrop-blur-sm transition-colors active:opacity-60 ${
            textChatOpen ? 'bg-white/25 text-white' : 'bg-white/10 text-white/80'
          }`}
        >
          <MessageSquare className="h-5 w-5" strokeWidth={1.8} />
        </button>
      )}

      {/* 聊天模式顶部（Task 28 定稿）：小头像+名字在时长上方——QQ 平时时长在底部按钮上方，
          聊天模式下时长随头像名字一起到顶部（避免同屏两处时长），关聊天恢复 */}
      {textChatOpen && phase === 'active' && (
        <div className="flex flex-col items-center gap-1.5 pt-[52px]">
          <CallChatHeader name={name} avatar={avatar} />
          <div className="text-[15px] tabular-nums text-white/85" data-testid="qq-call-duration">
            {formatCallDuration(seconds)}
          </div>
          <div className="text-[11px] leading-none text-white/55" aria-live="polite">
            {statusLine('active', status, 'qq')}
          </div>
        </div>
      )}

      {/* 中部：普通模式=头像名字居中（顶部弹性区封顶——与微信皮肤/电话 App 同款，把空间让给单句弹幕）；
          聊天模式：完整对话记录（语音+文字全部轮次，与打电话信息界面同款）+ 输入栏，
          底部按钮不受影响仍在 */}
      {textChatOpen && phase === 'active' ? (
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-1">
          <InlineCallChat variant="qq" call={call} className="w-full" fill />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center px-8 pb-14 pt-[62px]">
          <div className="min-h-4 max-h-[72px] flex-1" aria-hidden="true" />
          <div className="relative">
            {phase === 'dialing' && <span className="absolute inset-0 animate-ping rounded-full bg-white/10" aria-hidden="true" />}
            <CallAvatar variant="qq" avatar={avatar} size={direction === 'in' ? 132 : 168} />
          </div>
          <h2 className="mt-6 max-w-[280px] truncate text-[24px] font-normal leading-tight">{name}</h2>
          <p className="mt-2 text-[15px] text-white/65" aria-live="polite" data-testid="qq-call-status">
            {statusLine(phase, status, 'qq')}
          </p>
          {error && <p className="mt-2 max-w-[280px] text-center text-[12px] text-red-300">{error}</p>}
          {phase === 'active' ? (
            <div
              className="flex min-h-[44px] w-full flex-1 flex-col overflow-hidden px-1 pt-4"
              aria-label="通话字幕"
            >
              {/* 单句弹幕：只显示 AI 最新一句（我方说话不上屏）；完整聊天气泡在挂断后的聊天记录里看 */}
              <CaptionStream variant="qq" call={call} />
            </div>
          ) : (
            <div className="min-h-4 flex-1" aria-hidden="true" />
          )}
        </div>
      )}

      {/* 底部按钮区 */}
      {phase === 'incoming' ? (
        <div className="flex flex-col px-10 pb-[max(40px,env(safe-area-inset-bottom))]">
          {/* 消息回复（对照截图：左侧气泡图标 + 文案；挂断来电回到聊天，生成「已拒绝」卡片） */}
          {onMessageReply && (
            <button
              type="button"
              onClick={() => {
                call.reject();
                onMessageReply();
              }}
              className="mb-9 flex w-[86px] flex-col items-center gap-2 self-start text-white/90 active:opacity-60"
              data-testid="qq-call-msg-reply"
            >
              <MessageSquare className="h-8 w-8" strokeWidth={1.6} />
              <span className="text-[13px]">消息回复</span>
            </button>
          )}
          <div className="flex items-center justify-between">
            <button type="button" onClick={call.reject} aria-label="拒绝" data-testid="qq-call-reject" className={`${qqSquare} bg-[#F5455C] text-white`}>
              <PhoneOff className="h-8 w-8" strokeWidth={2} />
            </button>
            <button type="button" onClick={call.accept} aria-label="接听" data-testid="qq-call-accept" className={`${qqSquare} bg-[#2FBF71] text-white`}>
              <Phone className="h-8 w-8" strokeWidth={2} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center px-6 pb-[max(28px,env(safe-area-inset-bottom))]">
          {/* 接通后：时长显示在按钮上方（对照截图 00:03）；聊天模式时长已随头像名字移到顶部，不重复显示 */}
          {phase === 'active' && !textChatOpen && (
            <div className="mb-7 text-center text-[17px] tabular-nums text-white/85" data-testid="qq-call-duration">
              {formatCallDuration(seconds)}
            </div>
          )}
          {/* 三个按钮居中拉开间距（原三条横杠菜单按钮已删除，长按麦克风可静音） */}
          <div className="flex w-full items-center justify-center gap-12">
            {/* 麦克风：免提自动听（点按/长按=临时静音）；说话中高亮、点一下立即发送 */}
            <button
              type="button"
              onClick={micClick}
              onPointerDown={holdStart}
              onPointerUp={holdEnd}
              onPointerLeave={holdEnd}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={status === 'recording' ? '立即发送' : muted ? '取消静音' : '麦克风（免提自动听）'}
              aria-pressed={muted}
              data-testid="qq-call-mic"
              className={`${status === 'recording' ? `${whiteBtn} ring-2 ring-[#2FBF71]` : muted ? `${darkBtn} opacity-60` : whiteBtn} select-none`}
            >
              <Mic className={`h-7 w-7 ${status === 'recording' ? 'animate-pulse' : ''}`} strokeWidth={1.9} />
            </button>
            {/* 扬声器 */}
            <button
              type="button"
              onClick={call.toggleSpeaker}
              aria-label={speakerOn ? '关闭扬声器' : '开启扬声器'}
              aria-pressed={speakerOn}
              data-testid="qq-call-speaker"
              className={speakerOn ? whiteBtn : darkBtn}
            >
              {speakerOn ? <Volume2 className="h-7 w-7" strokeWidth={1.9} /> : <VolumeX className="h-7 w-7" strokeWidth={1.9} />}
            </button>
            {/* 挂断 */}
            <button type="button" onClick={call.hangup} aria-label="挂断" data-testid="qq-call-hangup" className={`${qqSquare} bg-[#F5455C] text-white`}>
              <PhoneOff className="h-8 w-8" strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

// ---------------- 通话卡片（结束后插入聊天记录） ----------------

export type CallCardState = 'cancelled' | 'no-answer' | 'rejected' | 'missed-in' | 'ended';

/** 通话媒体（Task 22 视频通话）：卡片图标/文案按此分叉；缺省 voice 与旧行为完全一致 */
export type CallCardMedia = 'voice' | 'video';

/** 通话结果 → 卡片状态（宿主落盘用；与媒体无关，语音/视频同一套状态机） */
export function callResultToCardState(r: ChatCallResult): CallCardState {
  if (r.connected && r.endReason !== 'cancel' && r.endReason !== 'reject') return 'ended';
  switch (r.endReason) {
    case 'cancel':
      return 'cancelled';
    case 'no-answer':
      return 'no-answer';
    case 'reject':
      return 'rejected';
    case 'missed-in':
      return 'missed-in';
    default:
      return 'ended';
  }
}

/**
 * 通话卡片文案（对照用户截图；media='video' 时按视频通话分叉——Task 22）：
 * - QQ：我方取消 = 「已取消，点击重拨」（整卡可点重拨）；对方拒接 = 「对方已拒绝」；
 * - 微信：我方取消 = 「已取消」；对方拒接 = 「对方已拒绝」、我方拒接来电 = 「已拒绝」；
 * - 视频：接通时长文案为「视频通话时长 MM:SS」，其余状态文案与语音一致（不重复「视频」二字）。
 */
export function callCardText(state: CallCardState, duration: number, direction: 'out' | 'in', variant: 'wx' | 'qq', media: CallCardMedia = 'voice'): string {
  switch (state) {
    case 'cancelled':
      return variant === 'qq' ? '已取消，点击重拨' : '已取消';
    case 'no-answer':
      return '对方未接听';
    case 'rejected':
      return direction === 'out' ? '对方已拒绝' : '已拒绝';
    case 'missed-in':
      return '未接听';
    default:
      return media === 'video' ? `视频通话时长 ${formatCallDuration(duration)}` : `通话时长 ${formatCallDuration(duration)}`;
  }
}

/**
 * AI 可读的通话摘要（进聊天上下文）：主叫者口吻（卡片 role 恒与主叫一致——我方打出=me、AI 打出=peer，
 * 历史映射后正好是主叫者的声音），结局措辞与 call-outcome.ts 三态严格对齐：
 * 拒接/未接/取消都写明「没接通、一句话没说上」，防止 AI 把「被拒接」误读成「接通后被挂断」。
 * media='video'（Task 22 视频通话）：摘要写「视频通话」，AI 知道这通是视频不是语音。
 */
export function callCardAiText(state: CallCardState, duration: number, media: CallCardMedia = 'voice'): string {
  const label = media === 'video' ? '视频通话' : '语音通话';
  switch (state) {
    case 'cancelled':
      return `[${label}：我打给你，还没接通就取消了，没有说上话]`;
    case 'no-answer':
      return `[${label}：我打给你，你没接听，没有接通]`;
    case 'rejected':
      return `[${label}：我打给你，你按了拒接，${media === 'video' ? '视频' : '电话'}没有接通，一句话都没说上]`;
    case 'missed-in':
      return `[${label}：我打给你，响了很久没人接，没有接通，一句话都没说上]`;
    default:
      // fix3-6 已接通卡片补主叫方：卡片主人恒为主叫（role 派生自 direction），「我」=主叫者口吻
      // 与其他态的「我打给你」同构——否则接通卡是唯一读不出「谁打给谁」的态
      return `[${label}：我打给对方的${media === 'video' ? '视频' : '电'}话，${media === 'video' ? '视频通话时长' : '通话时长'} ${formatCallDuration(duration)}]`;
  }
}

/**
 * 通话记录卡片（微信/QQ 聊天气泡内）：跟普通文字气泡完全同款——同底色、同圆角、同小三角尾巴，
 * 内容为电话图标 + 文案。图标位置对照两 App 原生：QQ 图标恒在文字前（我方蓝底白图标，
 * 对方白底深图标）；微信我方文字在前（绿底）、对方图标在前（白底）。
 * 整卡可点：点击任意通话卡片即回拨（onRedial 由宿主传入；用户需求「点击通话卡片就能回拨电话」）。
 */
export function CallCardBubble({
  variant,
  state,
  duration,
  direction = 'out',
  media = 'voice',
  onRedial,
}: {
  variant: 'wx' | 'qq';
  state: CallCardState;
  duration: number;
  direction?: 'out' | 'in';
  /** 通话媒体（Task 22 视频通话）：video 显示摄像机图标+「视频通话时长」文案；缺省语音电话图标 */
  media?: CallCardMedia;
  onRedial?: () => void;
}) {
  const mine = direction === 'out';
  const clickable = Boolean(onRedial);
  const text = callCardText(state, duration, direction, variant, media);
  const isWx = variant === 'wx';
  const iconFirst = variant === 'qq' || !mine;
  const isVideo = media === 'video';
  // 微信电话图标凹口朝下（lucide Phone 默认凹口朝右上，rotate-45 朝右，rotate-[135deg] 才朝下——用户反馈「凹的地方朝下，不是朝右」）；QQ 不转；视频通话用摄像机图标（不旋转）
  const phoneIcon = isVideo ? (
    <Video className="h-[18px] w-[18px] shrink-0" strokeWidth={variant === 'qq' && mine ? 0 : 2} {...(variant === 'qq' && mine ? { fill: 'currentColor' } : {})} aria-hidden="true" />
  ) : (
    <Phone
      className={`${isWx ? 'h-[17px] w-[17px] rotate-[135deg]' : 'h-[18px] w-[18px]'} shrink-0`}
      strokeWidth={variant === 'qq' && mine ? 0 : 2}
      {...(variant === 'qq' && mine ? { fill: 'currentColor' } : {})}
      aria-hidden="true"
    />
  );
  return (
    <button
      type="button"
      onClick={clickable ? onRedial : undefined}
      aria-label={`${isVideo ? '视频通话' : '语音通话'}：${text}${clickable ? '，点击回拨' : ''}`}
      data-testid={`${variant}-call-card`}
      className={`relative flex w-fit min-w-0 max-w-full select-none items-center gap-1.5 text-left transition-colors ${
        isWx
          ? `rounded-[5px] px-3 py-2 text-[16px] leading-[1.45] ${
              mine ? 'bg-[#95EC69] text-black dark:bg-[#3EB575] dark:text-black' : 'bg-white text-black dark:bg-[#1E1E1E] dark:text-white'
            }`
          : `rounded-[10px] px-3.5 py-[9px] text-[16px] leading-[1.5] ${
              mine ? 'text-white' : 'bg-white text-[#1F2329] dark:bg-[#2A2C31] dark:text-white'
            }`
      } ${clickable ? 'cursor-pointer active:opacity-70' : 'cursor-default'}`}
      style={variant === 'qq' && mine ? { backgroundColor: '#0099FF' } : undefined}
    >
      {/* 小三角尾巴（微信同款；QQ 无尾巴） */}
      {isWx && (
        <span
          aria-hidden="true"
          className={`absolute top-[11px] h-[8px] w-[8px] rotate-45 ${
            mine ? '-right-[3px] bg-[#95EC69] dark:bg-[#3EB575]' : '-left-[3px] bg-white dark:bg-[#1E1E1E]'
          }`}
        />
      )}
      {iconFirst && phoneIcon}
      <span className="whitespace-nowrap" data-testid={`${variant}-call-card-sub`}>
        {text}
      </span>
      {!iconFirst && phoneIcon}
    </button>
  );
}
