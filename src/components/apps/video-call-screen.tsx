'use client';

/**
 * 微信 / QQ / 电话 App 视频通话界面（Task 22，同一引擎 useChatCall media='video'，三种皮肤）：
 *
 * 完整复用语音通话引擎（chat-call.ts）：状态机（拨号/来电/接通/结束）、AI 接听决策、免提自动对话
 * （VAD）、通话字幕、通话中文字聊天、挂断续聊、通话记忆（提取+总结）全部同源——本组件只加
 * 「视频画面层 + 相机采集 + 识图注入」：
 *
 * - 主画面 = 对方（AI 角色）画面：角色头像 Ken Burns 缓慢缩放的「动态画面」（AI 无法产出真人视频，
 *   以动态头像模拟，纯黑背景清晰不模糊；无头像用 DefaultAvatar 兜底）；
 * - 小窗 = 用户摄像头画面（getUserMedia video-only，音频轨由通话引擎自理）：默认右上角（QQ 左上），
 *   点击主画面/小窗互换大小窗；前后置翻转（facingMode user/environment，切翻转重建流）；
 *   摄像头开关随时可切；关闭/权限拒绝/无设备 → 降级为「用户头像」占位（Task 27，不再显示
 *   「摄像头已关」文字，与微信真实行为一致），通话完全不受影响；
 * - AI 看见用户：接通且摄像头开启时每 10s 抓一帧（canvas 缩帧 → JPEG dataURL）→ 用户自己配置的
 *   识图模型（/api/vision 同链路，内网直连/内置兜底同 describeImages）→ 描述文本缓存；引擎每轮
 *   经 visionBlockFn 取最新描述注入【用户画面】system 块——AI 知道画面内容并按人设回应；
 *   摄像头关/识图未配置/识图失败 → 不注入，AI 规则明确「不装作看得见」（chatCallExtraRules video 分叉）；
 * - 拨号中（我方拨出）：主画面 = 用户摄像头全屏（对照微信真实行为：等待接通时看到自己），
 *   对方头像小窗常显（Task 24：刚拨出界面头像也要一直显示）+名字+状态叠在前；来电响铃：全屏来电页
 *   （头像+邀请你视频通话+拒绝/视频接听）；
 * - 通话拍照（A3，Task 28）：右上角快门按钮（仅接通正常态显示）抓「当前全屏所见」→
 *   canvas 按屏上 <video>/<img> 各自 DOM 矩形合成位图 → 双落盘：photos（照片 App 胶卷）+
 *   albums（联系人视觉相册，备注「视频通话截图」）；页内轻提示 1.5s 自动消失；
 * - Task 28 追加反馈：聊天模式+互换后全屏「我的头像」不再被底部聊天面板盖住——
 *   头像上移（lift 200）+缩小（112px）到消息区上方净空区，视频侧消息区压到 20vh（语音仍 35vh）；
 *   互换后 AI mini 窗同步加高（wx 104×140 / qq·phone 100×132，与拨号卡一致，上下留白更多）；
 * - 识图即时抓帧（B1，Task 28）：翻转/重开摄像头后立即补抓一帧（不等 10s tick），基础轮询不变；
 * - AI 请求看画面（C2，Task 28）：摄像头关闭时 AI 可自然表达想看（规则限每通一次、句尾标记
 *   [想看看你] 由引擎剥除并回调 onCameraRequest）→ 底部按钮上方弹「{name} 想看看你」确认条
 *   （拒绝=本通不再弹；同意=开摄像头）；语音通话不传回调零影响；
 * - 通话卡片/记忆/续聊由引擎与宿主承担（media='video' 分叉：视频通话时长文案、视频通话记忆场景）。
 * - Task 28-d（用户三轮追加）：①聊天模式 AI 头像重新入场——时长下方净空区 112px 动态头像
 *   （与互换态「我的头像」同尺寸同位置，中央不再空白，名字已在顶部小头像行不重复）；
 *   ②右上角 AI 头像卡再次加高（wx 104×160 / qq·phone 100×152，拨号卡+互换卡同步无跳变）；
 *   ③AI 头像卡支持按住拖拽移位（useMiniCardDrag：拨号卡/互换卡整通共享位置，移动 <6px
 *   仍算点按=互换不受影响，位置钳制在屏幕内）。
 * - Task 28-e（用户追加）：①右上角「我的画面卡」与 AI 头像卡一样大（wx 104×160 /
 *   qq·phone 100×152，原自适应高度改为与 AI 卡同高固定）；②「我的画面卡」同样支持
 *   按住拖拽移位（独立 pipDrag 实例与 AI 卡互不干扰，移动 <6px 仍算点按互换；
 *   两卡恒在最上层 z-20）。
 * - Task 28-f（用户追加）：卡内头像也一致——我的画面卡占位头像尺寸/圆角/描边与 AI 卡头像
 *   完全同款（wx 58px 方形圆角 / qq·phone 56px 圆形，原 64px 改为 avatarSize 参数化）。
 *
 * 权限边界：摄像头只在「拨出即开 / 接听时开」首次使用时申请；拒绝后文字/语音聊天与其他功能不受影响。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Camera,
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  PictureInPicture2,
  SwitchCamera,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { DefaultAvatar } from './default-avatar';
import { CallChatHeader, CaptionStream, InlineCallChat, statusLine } from './voice-call-screen';
import { addAlbum } from '@/lib/ios/album-store';
import { genId, localDB } from '@/lib/ios/db';
import {
  formatCallDuration,
  useChatCall,
  type ChatCallApi,
  type ChatCallResult,
  type ChatCallTurnMsg,
} from '@/lib/ios/chat-call';
import type { ContactRecord } from '@/lib/contacts';
import { useSettings } from '@/lib/ios/store';
import {
  captureFrameDataUrl,
  describeUserFrame,
  useLocalCamera,
  videoVisionReady,
  type CameraFacing,
} from '@/lib/ios/camera-capture';

export interface VideoCallScreenProps {
  /** wx=微信皮肤 / qq=QQ皮肤 / phone=电话 App（iOS 黑白灰） */
  variant: 'wx' | 'qq' | 'phone';
  name: string;
  avatar: string | null;
  contact: ContactRecord | null;
  direction: 'out' | 'in';
  /** 进入通话时携带的最近聊天上下文（宿主按会话消息归并） */
  initialHistory: ChatCallTurnMsg[];
  memoryBlock?: string;
  memoryBlockFn?: (userText: string | null) => string | undefined;
  worldbookBlock?: string;
  momentsBlock?: string;
  timeBlock?: string;
  locBlock?: string;
  multiApp?: boolean;
  /** 通话结束（恰好一次）：宿主生成通话卡片并关闭浮层 */
  onEnd: (r: ChatCallResult) => void;
  /** 挂断后 AI 续聊文字生成完毕（引擎异步产出，紧随挂断）：宿主以聊天消息落盘 */
  onFollowup?: (texts: string[]) => void;
  /** 左上角小窗图标点击：收起为全局悬浮小窗（全局层传入；无则仅展示不可点） */
  onMinimize?: () => void;
  /** 用户（机主）自己的头像：关闭摄像头/权限拒绝时小窗与全屏自看页显示它（Task 27，
   *  替代原「摄像头已关」占位；微信/QQ 传各自 App 机主头像，电话传系统设置头像） */
  myAvatar?: string | null;
  /** QQ 来电页「消息回复」：挂断来电并回到聊天 */
  onMessageReply?: () => void;
}

/** 识图轮询间隔（ms）：接通即抓一帧，之后每 10s 刷新一次「用户画面」描述 */
const VISION_TICK_MS = 10_000;

/** 共享运行时：引擎（media='video'）+ 相机 + 识图循环 + 大小窗互换。
 *  Task 28：新增可选 onCameraRequest（透传 useChatCall，C2「想看看你」请求回调；语音通话不传不触发） */
function useVideoCallRuntime(props: VideoCallScreenProps, onCameraRequest?: () => void) {
  const { variant, direction } = props;
  const visionCfg = useSettings((s) => s.visionConfig);
  const visionCfgReady = useMemo(() => videoVisionReady(visionCfg), [visionCfg]);

  const latestVisionRef = useRef('');
  /** 摄像头开关（用户可随时切）；来电响铃阶段不拉流，接听时才申请权限 */
  const camOnRef = useRef(true);
  const [camOn, setCamOn] = useState(true);
  /** 已获准拉流：拨出=true（等待接通就看到自己，对照微信真实行为）/ 来电=接听后 true */
  const [camArmed, setCamArmed] = useState(direction === 'out');
  const [facing, setFacing] = useState<CameraFacing>('user');
  const [swapped, setSwapped] = useState(false);
  /** 用户摄像头实际分辨率（Task 23）：PIP 小窗高度随视频宽高比自适应，避免 object-cover 过度裁剪显得「太放大」 */
  const [camSize, setCamSize] = useState<{ w: number; h: number } | null>(null);
  const onVideoMeta = (w: number, h: number) =>
    setCamSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
  /** B1（Task 28）识图即时抓帧触发器：翻转/重开摄像头后 +1，识图 effect 依赖它不等
   *  下一个 10s tick 立即补抓一帧（新镜头/新画面即时进 AI 视野）；基础 10s 轮询不变 */
  const [visionKick, setVisionKick] = useState(0);

  const call = useChatCall({
    app: variant,
    media: 'video',
    contact: props.contact,
    direction: props.direction,
    initialHistory: props.initialHistory,
    memoryBlock: props.memoryBlock,
    memoryBlockFn: props.memoryBlockFn,
    worldbookBlock: props.worldbookBlock,
    momentsBlock: props.momentsBlock,
    timeBlock: props.timeBlock,
    locBlock: props.locBlock,
    multiApp: props.multiApp,
    visionBlockFn: () => (camOnRef.current ? latestVisionRef.current || undefined : undefined),
    // C2（Task 28）：AI 输出「想看看你」标记时回调（引擎每通最多触发一次）→ 界面弹确认条
    onCameraRequest,
    onEnd: props.onEnd,
    onFollowup: props.onFollowup,
  });

  const camera = useLocalCamera(camArmed && camOn && call.phase !== 'ended', facing);

  // 来电接听：先开摄像头再进通话（权限首次申请时机=接听动作）
  const accept = () => {
    setCamArmed(true);
    call.accept();
  };
  /** 来电页「语音接听」（对照微信截图）：关摄像头只通声音，走正常接听（识图同步停） */
  const acceptAsVoice = () => {
    camOnRef.current = false;
    setCamOn(false);
    latestVisionRef.current = '';
    setCamArmed(true);
    call.accept();
  };
  const toggleCam = () => {
    const next = !camOnRef.current;
    camOnRef.current = next;
    setCamOn(next);
    if (next) {
      // 开摄像头（含来电响铃阶段预开，对照 QQ 截图「摄像头已开」）：允许拉流（首次触发权限申请）；
      // B1（Task 28）：重新打开后立即补抓一帧，AI 马上看见画面
      setCamArmed(true);
      setVisionKick((k) => k + 1);
    } else {
      latestVisionRef.current = ''; // 关摄像头即刻清描述：AI 下一轮起不再注入【用户画面】
    }
  };
  const flipCam = () => {
    setFacing((f) => (f === 'user' ? 'environment' : 'user'));
    setVisionKick((k) => k + 1); // B1（Task 28）：翻转后立即补抓一帧（AI 即时看到新镜头画面）
  };
  const swapViews = () => setSwapped((s) => !s);

  // 识图循环：接通 + 摄像头就绪 + 识图配置就绪才跑；单飞防重入；失败静默（保上一条描述）。
  // B1（Task 28）：翻转/重开摄像头（visionKick 变化）后 700ms 即抓一帧（不等 10s tick；帧未就绪
  // 2.6s 再补一次，仍失败交回 10s 轮询兜底）；基础 10s 轮询不变
  useEffect(() => {
    if (call.phase !== 'active' || !camOn || !camera.ready || !visionCfgReady) return;
    let stopped = false;
    let busy = false;
    let gotFrame = false;
    const tick = async () => {
      if (stopped || busy) return;
      const frame = captureFrameDataUrl(camera.videoRef.current);
      if (!frame) return;
      gotFrame = true;
      busy = true;
      try {
        const desc = await describeUserFrame(visionCfg, frame);
        if (!stopped && desc) latestVisionRef.current = desc;
      } catch {
        // 识图失败静默：AI 下一轮不注入画面（规则侧「不装作看得见」），通话继续
      }
      busy = false;
    };
    // 接通后稍等 1.2s 首抓（等 <video> 出画面）；翻转/重开触发后 700ms 即抓（新流出画快）
    const kick = visionKick > 0;
    const first = window.setTimeout(() => void tick(), kick ? 700 : 1200);
    const second = kick
      ? window.setTimeout(() => {
          if (!gotFrame && !stopped) void tick();
        }, 2600)
      : null;
    const timer = window.setInterval(() => void tick(), VISION_TICK_MS);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      if (second !== null) window.clearTimeout(second);
      window.clearInterval(timer);
    };
  }, [call.phase, camOn, camera.ready, visionCfgReady, facing, visionKick, visionCfg, camera.videoRef]);

  return {
    call,
    accept,
    acceptAsVoice,
    toggleCam,
    flipCam,
    swapViews,
    swapped,
    camOn,
    camera,
    facing,
    visionCfgReady,
    camSize,
    onVideoMeta,
  };
}

type Runtime = ReturnType<typeof useVideoCallRuntime>;

/** 对方（AI 角色）动态画面：纯黑背景 + 头像 Ken Burns 缓慢缩放（AI 无真人视频，动态头像模拟）。
 *  Task 23：微信皮肤头像为正方形圆角（对照微信真实行为），QQ/电话保持圆形；
 *  Task 25：删除模糊放大的头像背景与渐晕（用户反馈顶部/刚接通/切换画面后「是模糊的」），改纯黑清晰画面；
 *  主画面在头像下方显示名字（showName，小字），小窗/拨号头像窗不显示；lift=头像整体上移 px
 *  （主画面避开底部控制区视觉更居中，小窗传 0）
 *  Task 26：主画面头像 168→140、名字 15px→13px、lift 72→96（用户反馈「头像名字小一点，往上移一点」，
 *  同时给底部字幕/文字聊天留出更多空间不叠压） */
function RemoteView({
  avatar,
  name,
  size,
  shape = 'circle',
  showName = false,
  lift = 0,
}: {
  avatar: string | null;
  name: string;
  size: number;
  shape?: 'circle' | 'square';
  /** 头像下方显示名字（主画面用；小窗太小不显示） */
  showName?: boolean;
  /** 头像整体上移 px（主画面避开底部控制区；小窗 0） */
  lift?: number;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={lift > 0 ? { paddingBottom: lift * 2 } : undefined}
      >
        {/* 头像缓慢缩放（Ken Burns）模拟动态画面 */}
        <motion.div
          animate={{ scale: [1, 1.07, 1] }}
          transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
          className="overflow-hidden shadow-2xl ring-1 ring-white/10"
          style={{ width: size, height: size, borderRadius: shape === 'square' ? Math.round(size * 0.12) : size / 2 }}
        >
          {avatar ? (
            <img src={avatar} alt={`${name}的画面`} className="h-full w-full object-cover" />
          ) : (
            <DefaultAvatar size={size} shape={shape === 'square' ? 'square' : 'circle'} className="h-full w-full" />
          )}
        </motion.div>
        {showName && (
          <p className="mt-3 max-w-[200px] truncate px-6 text-center text-[13px] font-medium text-white/90 drop-shadow">{name}</p>
        )}
      </div>
    </div>
  );
}

/** 我方画面（用户摄像头全屏，拨号中/互换后主画面用；基础量拆开传防 ref 容器对象渲染期访问）。
 *  Task 23：前置摄像头镜像预览（照镜子习惯，「画面是反的」修复；后置不镜像）。
 *  Task 24：object-contain 完整显示（不再 object-cover 硬裁剪显得「太放大」）。
 *  Task 25：删除模糊垫底层（用户反馈「刚接通/切换画面以后是模糊的」），改纯黑背景，画面清晰完整
 *  Task 26：object-contain → object-cover 画面铺满全屏（用户反馈「让画面全屏」，上下黑边去掉；
 *  对照微信真实行为：自看画面永远充满全屏，两侧/上下按比例裁剪不变形）
 *  Task 27：删除「你」自看水印（用户要求）；无流（关摄像头/权限拒绝/拉流中）时不再显示
 *  「摄像头已关」占位，改显示用户自己的头像（对照微信真实行为），拨号等待文案由底部控制区承载
 *  Task 28 追加反馈：聊天模式+互换后底部聊天面板（消息区+输入栏+按钮）向上越过屏幕中线，
 *  居中头像被气泡盖住=「我的头像消失」——新增 avatarSize/avatarLift：聊天模式传 112/200
 *  （头像上移到消息区上方净空区始终可见），其余场景默认 140/0 居中不变 */
function LocalFullView({
  videoRef,
  ready,
  mirrored,
  myAvatar,
  shape = 'circle',
  avatarSize = 140,
  avatarLift = 0,
  avatarTestId,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  ready: boolean;
  /** 前置摄像头镜像预览 */
  mirrored: boolean;
  /** 用户头像（无流时显示） */
  myAvatar?: string | null;
  /** 头像形状：wx=方形圆角 / qq·phone=圆形 */
  shape?: 'circle' | 'square';
  /** 头像直径 px（默认 140；聊天模式互换态 112） */
  avatarSize?: number;
  /** 头像整体上移 px（默认 0 居中；聊天模式互换态 200，避开底部聊天面板+AI 请求确认条） */
  avatarLift?: number;
  /** 头像盒 testid（E2E 断言用） */
  avatarTestId?: string;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {ready ? (
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
          aria-label="我的摄像头画面"
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center bg-[#111114]"
          style={avatarLift > 0 ? { paddingBottom: avatarLift * 2 } : undefined}
        >
          <div
            data-testid={avatarTestId}
            className="overflow-hidden shadow-2xl ring-1 ring-white/10"
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: shape === 'square' ? Math.round(avatarSize * 0.12) : avatarSize / 2,
            }}
          >
            {myAvatar ? (
              <img src={myAvatar} alt="我的头像" className="h-full w-full object-cover" />
            ) : (
              <DefaultAvatar size={avatarSize} shape={shape === 'square' ? 'square' : 'circle'} className="h-full w-full" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 我方小窗（用户摄像头 PIP；关/拒绝时显示用户头像占位——Task 27 不再显示「摄像头已关」文字）。
 *  Task 23：前置摄像头镜像预览（后置不镜像）；点击小窗与对方画面互换（Task 23：互换画面按钮已删）。
 *  Task 28-e：尺寸恒与 AI 头像卡一致（wx 104×160 / qq·phone 100×152，不再随视频宽高比自适应）；
 *  支持按住拖拽移位（dragPos/dragHandlers=useMiniCardDrag 产物，独立实例与 AI 卡互不干扰；
 *  移动 <6px 仍算点按互换）；z-20 恒在最上层（与 AI 卡同层，拖到底部不被控制区吞点按）。
 *  Task 28-f：关闭态占位头像与 AI 卡头像同款（avatarSize 传 58/56，圆角同公式、ring/shadow 同样式） */
function LocalPipView({
  videoRef,
  live,
  className,
  testId,
  onClick,
  mirrored,
  myAvatar,
  shape = 'circle',
  avatarSize = 64,
  dragPos = null,
  dragHandlers,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  live: boolean;
  className: string;
  testId: string;
  onClick?: () => void;
  /** 前置摄像头镜像预览 */
  mirrored: boolean;
  /** 用户头像（关闭/拒绝时显示） */
  myAvatar?: string | null;
  /** 头像形状：wx=方形圆角 / qq·phone=圆形 */
  shape?: 'circle' | 'square';
  /** 关闭态占位头像直径（Task 28-f：与 AI 卡头像同尺寸，wx 58 / qq·phone 56） */
  avatarSize?: number;
  /** 拖拽后的绝对定位（null=用 className 里的默认定位类）；尺寸由 className 恒与 AI 卡一致 */
  dragPos?: { left: number; top: number } | null;
  /** 按住拖拽移位（useMiniCardDrag.dragProps 展开；拖拽后自动拦截紧随的 click 防误触互换） */
  dragHandlers?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      aria-label={live ? '我的画面，点击与对方画面互换' : '我的摄像头已关闭，点击与对方画面互换'}
      data-testid={testId}
      onClick={onClick}
      {...dragHandlers}
      style={dragPos ? { left: dragPos.left, top: dragPos.top } : undefined}
      className={`absolute z-20 overflow-hidden ring-1 ring-white/25 shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-transform active:scale-95 select-none touch-none ${className}`}
    >
      {live ? (
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="h-full w-full object-cover"
          style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-[#1b1b1f]">
          {/* Task 28-f：占位头像与 RemoteMiniCard 头像同款（尺寸/圆角公式/ring/shadow 一致，仅无 Ken Burns） */}
          <span
            className="block overflow-hidden shadow-lg ring-1 ring-white/10"
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: shape === 'square' ? Math.round(avatarSize * 0.22) : avatarSize / 2,
            }}
          >
            {myAvatar ? (
              <img src={myAvatar} alt="我的头像" className="h-full w-full object-cover" />
            ) : (
              <DefaultAvatar size={avatarSize} shape={shape === 'square' ? 'square' : 'circle'} className="h-full w-full" />
            )}
          </span>
        </span>
      )}
    </button>
  );
}

/** 来电打字点动画（对照微信/QQ 来电截图：头像下的呼吸点） */
function TypingDots() {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true" data-testid="video-typing-dots">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-white/80"
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{ duration: 1.15, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

/** 右上角 mini 卡「按住拖拽移位」（Task 28-d AI 头像卡 / Task 28-e 我方画面卡，同一 hook）：
 *  - pos=null 时卡片用各自默认定位类（wx 右上/qq 拨号左上…），首次按下拖动时把卡片当前位置
 *    换算成根容器内绝对坐标，此后整通共享该位置（同一皮肤的拨号卡/互换 mini 卡读写同一状态，
 *    拖过一次换到哪张卡都跟随）；我方画面卡与 AI 卡用各自独立 hook 实例，位置互不干扰；
 *  - 指针事件统一鼠标/触摸（setPointerCapture 保证移出卡片仍持续跟踪）；移动 <6px 视为点按
 *    （互换卡的「点按互换」不受影响），拖拽过则在捕获阶段拦截紧随的 click 防误触互换；
 *  - 位置钳制在根容器内（8px 边距），touch-none+select-none 防触摸手势/长按选中劫持拖拽。 */
function useMiniCardDrag(rootRef: React.RefObject<HTMLDivElement | null>) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const dragRef = useRef<{ id: number; startX: number; startY: number; baseLeft: number; baseTop: number } | null>(null);
  const draggedRef = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const root = rootRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const rect = e.currentTarget.getBoundingClientRect();
      dragRef.current = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseLeft: rect.left - rootRect.left,
        baseTop: rect.top - rootRect.top,
      };
      draggedRef.current = false;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* 环境不支持指针捕获时忽略（拖拽仍可用，仅移出卡片的跟踪变弱） */
      }
    },
    [rootRef],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      const root = rootRef.current;
      if (!d || !root || e.pointerId !== d.id) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!draggedRef.current && Math.hypot(dx, dy) < 6) return;
      draggedRef.current = true;
      const rect = e.currentTarget.getBoundingClientRect();
      const maxLeft = Math.max(root.clientWidth - rect.width - 8, 8);
      const maxTop = Math.max(root.clientHeight - rect.height - 8, 8);
      setPos({
        left: Math.min(Math.max(d.baseLeft + dx, 8), maxLeft),
        top: Math.min(Math.max(d.baseTop + dy, 8), maxTop),
      });
    },
    [rootRef],
  );

  const onPointerEnd = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (dragRef.current && e.pointerId === dragRef.current.id) dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  /** 拖拽后拦截紧随的 click（互换卡点按互换不受影响：未拖拽时不拦截） */
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (draggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      draggedRef.current = false;
    }
  }, []);

  /** 展开到卡片上的公共 props（定位样式由调用方按 pos 拼接：pos 非空用 left/top，空用默认类） */
  const dragProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onClickCapture,
    onDragStart: (e: React.DragEvent) => e.preventDefault(),
  } as const;

  return { pos, dragProps };
}

/** 对方（AI）小窗卡片（Task 28 UI 定稿，对照用户截图）：右上角 AI 头像窗不再近乎铺满窗宽——
 *  整窗一块深灰卡（#1b1b1f），居中一块大圆角小头像（方角半径 22%、约窗宽 56%），
 *  Ken Burns 缓慢缩放保留（动态画面感）。用于拨号对方头像窗与互换后的对方 mini 窗
 *  （wx/qq/phone 三皮肤共用；小窗不显示名字） */
function RemoteMiniCard({
  avatar,
  name,
  size,
  shape = 'circle',
}: {
  avatar: string | null;
  name: string;
  /** 头像直径 px（wx 窗 104 宽传 58，qq/phone 窗 100 宽传 56） */
  size: number;
  shape?: 'circle' | 'square';
}) {
  return (
    <span className="flex h-full w-full items-center justify-center bg-[#1b1b1f]">
      <motion.span
        animate={{ scale: [1, 1.07, 1] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        className="block overflow-hidden shadow-lg ring-1 ring-white/10"
        style={{ width: size, height: size, borderRadius: shape === 'square' ? Math.round(size * 0.22) : size / 2 }}
      >
        {avatar ? (
          <img src={avatar} alt={`${name}的画面`} className="h-full w-full object-cover" />
        ) : (
          <DefaultAvatar size={size} shape={shape === 'square' ? 'square' : 'circle'} className="h-full w-full" />
        )}
      </motion.span>
    </span>
  );
}

/** 视频通话页顶部信息（Task 25：删除顶部小头像+名字——与语音通话顶部一致只留时长；
 *  名字移至主画面头像下方（RemoteView showName）；互换后主画面=我方画面，名字回落到顶部显示；
 *  接通后时长下方显示 AI 状态（正在听/正在思考…/正在说话，与语音通话同款 statusLine）；
 *  Task 28 定稿：聊天模式（chatMode）在时长上方显示小头像+名字（CallChatHeader），
 *  此时中央大头像+名字隐藏（Task 28-d：时长下方净空区以 112px 重新显示 AI 动态头像，无名字） */
function VideoTopBar({
  name,
  avatar,
  phase,
  seconds,
  statusText,
  showName,
  chatMode,
  testId,
}: {
  name: string;
  avatar: string | null;
  phase: string;
  seconds: number;
  statusText: string | null;
  /** 互换后主画面=我方画面（对方头像在小窗），名字回落到顶部显示 */
  showName: boolean;
  /** 聊天模式：时长上方显示小头像+名字（中央大头像名字已隐藏） */
  chatMode?: boolean;
  testId: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[54px] z-10 flex flex-col items-center gap-1.5">
      {chatMode && <CallChatHeader name={name} avatar={avatar} />}
      {!chatMode && showName && (
        <span className="max-w-[220px] truncate text-[15px] font-medium text-white/95 drop-shadow">{name}</span>
      )}
      {phase === 'active' && (
        <span className="text-[14px] tabular-nums text-white/85 drop-shadow" data-testid={testId}>
          {formatCallDuration(seconds)}
        </span>
      )}
      {phase === 'active' && statusText && (
        <span className="text-[11px] leading-none text-white/55 drop-shadow" aria-live="polite" data-testid={`${testId}-status`}>
          {statusText}
        </span>
      )}
    </div>
  );
}

/** 小窗图标（收起为全局悬浮小窗；视频页复用语音同款） */
function VideoPipIcon({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label="收起为悬浮小窗"
      data-testid="call-pip-btn"
      onClick={onClick}
      disabled={!onClick}
      className="absolute left-5 top-[58px] z-20 flex h-10 w-10 items-center justify-center rounded-[12px] bg-black/35 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
    >
      <PictureInPicture2 className="h-5 w-5" strokeWidth={1.8} />
    </button>
  );
}

/** 通话字幕（单句；容器由宿主给位：接通后底部控制区第一格，超高内部滚动并底部对齐——最新一句完整贴在
 *  按钮上方，旧句向上裁剪，不再被按钮区「遮住」；复用语音同款 CaptionStream） */
function VideoCaption({ variant, call }: { variant: 'wx' | 'qq'; call: ChatCallApi }) {
  return (
    <div className="pointer-events-none flex max-h-full w-full flex-col items-center justify-end overflow-hidden">
      <CaptionStream variant={variant} call={call} />
    </div>
  );
}

// ---------------- 通话拍照（A3，Task 28） ----------------

/** 把 <video>/<img> 按 object-cover 数学绘入 canvas 指定矩形（前置自看画面有 scaleX(-1) 镜像，
 *  截图同步镜像才与所见一致）；媒体未就绪（尺寸 0）返回 false */
function drawMediaCover(
  ctx: CanvasRenderingContext2D,
  el: HTMLVideoElement | HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const mw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const mh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!mw || !mh) return false;
  try {
    const scale = Math.max(w / mw, h / mh);
    const dw = mw * scale;
    const dh = mh * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(x + w / 2, y + h / 2);
    if (el.style.transform.includes('scaleX(-1)')) ctx.scale(-1, 1);
    ctx.drawImage(el, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    return true;
  } catch {
    return false;
  }
}

/** 抓「当前全屏所见」→ 合成位图：黑底 + 屏上所有 <video>/<img> 按各自 DOM 矩形 object-cover
 *  绘制（接通正常态=主画面对方 Ken Burns 头像 + 角标我方摄像头帧/头像占位，布局随所见还原）。
 *  屏上一个可绘媒体都没有（如双方都只有 SVG 兜底头像）返回 null，由调用方提示无法保存 */
async function captureCallScreenshot(root: HTMLElement | null): Promise<{ blob: Blob; dataUrl: string } | null> {
  if (!root) return null;
  try {
    const W = root.clientWidth || 390;
    const H = root.clientHeight || 844;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const rootRect = root.getBoundingClientRect();
    let drew = false;
    root.querySelectorAll('video, img').forEach((el) => {
      // querySelectorAll('video, img') 的联合元素类型收窄：非 video 即 img
      if (!(el instanceof HTMLVideoElement) && !(el instanceof HTMLImageElement)) return;
      const r = el.getBoundingClientRect();
      const x = Math.round(r.left - rootRect.left);
      const y = Math.round(r.top - rootRect.top);
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (w <= 0 || h <= 0) return;
      if (drawMediaCover(ctx, el, x, y, w, h)) drew = true;
    });
    if (!drew) return null;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return null;
    return { blob, dataUrl: canvas.toDataURL('image/jpeg', 0.85) };
  } catch {
    return null;
  }
}

/** 通话拍照（A3，Task 28，三皮肤共用）：快门 → captureCallScreenshot → 双落盘：
 *  ① photos store（系统相册胶卷，PhotoRecord{blob,name:IMG_时间戳}，照片 App 直接可见）；
 *  ② albums store（联系人视觉相册，AlbumRecord{src:dataURL, name:'视频通话截图', origin:'user'}，
 *     contactId=当前通话联系人）。
 *  轻提示 1.5s 自动消失（通话页无 toast 组件，页内胶囊提示）；busy 防连点 */
function useCallShutter(opts: { rootRef: React.RefObject<HTMLDivElement | null>; contactId?: string | null }) {
  const [tip, setTip] = useState('');
  const [busy, setBusy] = useState(false);
  const tipTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
    },
    [],
  );
  const showTip = (t: string) => {
    setTip(t);
    if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
    tipTimer.current = window.setTimeout(() => setTip(''), 1500);
  };
  const shoot = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const shot = await captureCallScreenshot(opts.rootRef.current);
      if (!shot) {
        showTip('保存失败，画面不可用');
        return;
      }
      const d = new Date();
      const pad = (n: number): string => n.toString().padStart(2, '0');
      const name = `IMG_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(
        d.getMinutes(),
      )}${pad(d.getSeconds())}`;
      try {
        // ① 系统相册（照片 App 胶卷）；② 联系人视觉相册（无联系人 id 跳过）
        await localDB.put('photos', { id: genId(), blob: shot.blob, name, createdAt: Date.now() });
        if (opts.contactId) {
          await addAlbum(opts.contactId, shot.dataUrl, { name: '视频通话截图', origin: 'user' });
        }
        showTip('已保存到相册');
      } catch {
        showTip('保存失败，请重试');
      }
    } finally {
      setBusy(false);
    }
  };
  return { shoot, busy, tip };
}

/** 拍照结果轻提示（顶部小胶囊，1.5s 自动消失） */
function ShotTip({ tip, testId }: { tip: string; testId: string }) {
  if (!tip) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[110px] z-30 flex justify-center">
      <span className="rounded-full bg-black/60 px-3.5 py-1.5 text-[12px] text-white/90 backdrop-blur-sm" data-testid={testId}>
        {tip}
      </span>
    </div>
  );
}

// ---------------- AI「想看看你」确认条（C2，Task 28） ----------------

/** 底部按钮上方确认面板：AI 请求看画面且摄像头关闭时出现；拒绝=本通不再弹；同意=开摄像头并消失。
 *  按钮色按皮肤：wx #07C160 / qq #0099FF / phone iOS 绿 #30D158 */
function CamRequestBar({
  name,
  allowColor,
  onAllow,
  onDeny,
  testIdPrefix,
}: {
  name: string;
  allowColor: string;
  onAllow: () => void;
  onDeny: () => void;
  testIdPrefix: string;
}) {
  return (
    <div
      className="z-20 flex w-full shrink-0 items-center justify-between gap-3 rounded-[14px] bg-black/70 px-4 py-2.5 backdrop-blur-sm"
      data-testid={`${testIdPrefix}-video-cam-req`}
    >
      <span className="min-w-0 truncate text-[13px] text-white/90">{name} 想看看你</span>
      <span className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onDeny}
          aria-label="拒绝打开摄像头"
          data-testid={`${testIdPrefix}-video-cam-req-deny`}
          className="flex h-8 items-center rounded-full bg-white/10 px-3.5 text-[12px] text-white/70 transition-colors active:opacity-70"
        >
          拒绝
        </button>
        <button
          type="button"
          onClick={onAllow}
          aria-label="打开摄像头"
          data-testid={`${testIdPrefix}-video-cam-req-allow`}
          className="flex h-8 items-center rounded-full px-3.5 text-[12px] font-medium text-white transition-colors active:opacity-80"
          style={{ backgroundColor: allowColor }}
        >
          打开摄像头
        </button>
      </span>
    </div>
  );
}

/** C2 确认条状态（三皮肤共用逻辑）：idle=无请求 / asked=AI 已请求 / done=已处理（本通不再弹）。
 *  onCameraRequest 传给 useVideoCallRuntime（再透传引擎，引擎每通最多回调一次）；
 *  宿主在 phase 离开 active 时调 reset()（确认条仅接通态渲染，卸载即消失；reset 防同实例内残留）；
 *  面板仅在摄像头关闭时可见（用户手动开了摄像头自然消失） */
function useCamRequest() {
  const [camReq, setCamReq] = useState<'idle' | 'asked' | 'done'>('idle');
  const onCameraRequest = useCallback(() => setCamReq('asked'), []);
  const reset = useCallback(() => setCamReq('idle'), []);
  const allowCamera = useCallback(() => setCamReq('done'), []);
  const denyCamera = useCallback(() => setCamReq('done'), []);
  return { camReq, onCameraRequest, reset, allowCamera, denyCamera };
}

// ---------------- 微信皮肤 ----------------

function WxVideoCall(props: VideoCallScreenProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Task 28-d：右上角 AI 头像卡拖拽移位（拨号卡/互换卡共享位置，点按互换不受影响）
  const miniDrag = useMiniCardDrag(rootRef);
  // Task 28-e：我的画面卡拖拽移位（独立实例，与 AI 卡位置互不干扰；点按互换不受影响）
  const pipDrag = useMiniCardDrag(rootRef);
  // C2（Task 28）：AI「想看看你」请求确认条状态（回调透传引擎，每通最多触发一次）
  const camReq = useCamRequest();
  const rt = useVideoCallRuntime(props, camReq.onCameraRequest);
  // A3（Task 28）：通话拍照（快门 → photos 系统相册 + albums 联系人视觉相册）
  const shutter = useCallShutter({ rootRef, contactId: props.contact?.id ?? null });
  const { call, camera } = rt;
  const { phase, status, seconds, muted, speakerOn } = call;
  const [textChatOpen, setTextChatOpen] = useState(false);

  // C2（Task 28）：phase 离开 active（挂断/结束）自动清除请求态（本通不再弹）
  useEffect(() => {
    if (phase !== 'active') camReq.reset();
  }, [phase, camReq.reset]);
  /** 确认条可见：AI 已请求 + 未处理 + 接通中 + 当前无实际画面（开关关 or 权限拒绝/无设备；
 *  用户真正看到自己画面后自然消失） */
  const camReqVisible = camReq.camReq === 'asked' && phase === 'active' && !(rt.camOn && camera.ready);
  const allowCamReq = () => {
    if (!rt.camOn) rt.toggleCam();
    camReq.allowCamera();
  };

  // Task 24：接通后与语音通话同款状态文案（正在听/在听你说…/识别中…/正在思考…/正在说话）
  const statusText = phase === 'active' ? statusLine('active', status, 'wx') : null;

  const openTextChat = () => {
    if (phase !== 'active') return;
    call.setTextMode(true);
    setTextChatOpen(true);
  };
  const closeTextChat = () => {
    call.setTextMode(false);
    setTextChatOpen(false);
  };
  const toggleTextChat = () => (textChatOpen ? closeTextChat() : openTextChat());

  /** 聊天模式（Task 28 定稿）：中央大头像+名字隐藏、顶部时长上方小头像+名字、消息区+输入栏、按钮常显 */
  const chatMode = textChatOpen && phase === 'active';

  const dialing = phase === 'dialing';

  const incoming = phase === 'incoming';
  const wxRound = 'flex h-[60px] w-[60px] items-center justify-center rounded-full transition-colors active:opacity-70';

  const camBtn = (
    <button
      type="button"
      onClick={rt.toggleCam}
      aria-label={rt.camOn ? '关闭摄像头' : '打开摄像头'}
      aria-pressed={rt.camOn}
      data-testid="wx-video-cam"
      className={`${wxRound} ${rt.camOn ? 'bg-white/15 text-white' : 'bg-white/10 text-white/50'}`}
    >
      {rt.camOn ? <Video className="h-6 w-6" strokeWidth={1.9} /> : <VideoOff className="h-6 w-6" strokeWidth={1.9} />}
    </button>
  );
  const micBtn = (
    <button
      type="button"
      onClick={call.toggleMute}
      aria-label={muted ? '取消静音' : '静音麦克风'}
      aria-pressed={muted}
      data-testid="wx-video-mic"
      className={`${wxRound} ${muted ? 'bg-white/10 text-white/60' : 'bg-white/15 text-white'}`}
    >
      {muted ? <MicOff className="h-6 w-6" strokeWidth={1.9} /> : <Mic className="h-6 w-6" strokeWidth={1.9} />}
    </button>
  );
  const speakerBtn = (
    <button
      type="button"
      onClick={call.toggleSpeaker}
      aria-label={speakerOn ? '关闭扬声器' : '开启扬声器'}
      aria-pressed={speakerOn}
      data-testid="wx-video-speaker"
      className={`${wxRound} ${speakerOn ? 'bg-white/15 text-white' : 'bg-white/10 text-white/60'}`}
    >
      {speakerOn ? <Volume2 className="h-6 w-6" strokeWidth={1.9} /> : <VolumeX className="h-6 w-6" strokeWidth={1.9} />}
    </button>
  );
  const hangupBtn = (
    <button
      type="button"
      onClick={call.hangup}
      aria-label="挂断"
      data-testid="wx-video-hangup"
      className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full bg-[#FA5151] text-white transition-colors active:opacity-80"
    >
      <PhoneOff className="h-8 w-8" strokeWidth={2} />
    </button>
  );

  return (
    <div ref={rootRef} className="relative h-full w-full overflow-hidden" data-testid="wx-video-screen">
      {/* 画面层：拨号中主画面=我方摄像头（对照微信真实行为）+对方头像小窗常显；来电/接通主画面=对方动态画面，小窗=我方 */}
      {dialing ? (
        <>
          <LocalFullView
            videoRef={camera.videoRef}
            ready={camera.ready}
            mirrored={rt.facing === 'user'}
            myAvatar={props.myAvatar}
            shape="square"
            avatarTestId="wx-video-my-avatar"
          />
          {/* Task 24：刚拨出界面对方头像也要一直显示（位置与接通后我方小窗一致，接通自然衔接）；
              Task 28 UI 定稿（用户截图）：AI 头像窗=深灰卡+居中大圆角小头像（不再铺满窗宽） */}
          <div
            aria-hidden="true"
            data-testid="wx-video-dial-avatar"
            {...miniDrag.dragProps}
            className={`absolute z-20 h-[160px] w-[104px] overflow-hidden rounded-[14px] shadow-[0_8px_24px_rgba(0,0,0,0.45)] ring-1 ring-white/15 select-none touch-none ${
              miniDrag.pos ? '' : 'right-4 top-[108px]'
            }`}
            style={miniDrag.pos ? { left: miniDrag.pos.left, top: miniDrag.pos.top } : undefined}
          >
            {/* Task 28-d（用户：卡片上下再变长一点+可拖拽）：AI 头像卡 104×140→104×160 */}
            <RemoteMiniCard avatar={props.avatar} name={props.name} size={58} shape="square" />
          </div>
        </>
      ) : rt.swapped ? (
        <>
          {/* Task 28 追加反馈：聊天模式头像上移+缩小（不被底部聊天面板盖住），普通态居中 140 不变 */}
          <LocalFullView
            videoRef={camera.videoRef}
            ready={camera.ready}
            mirrored={rt.facing === 'user'}
            myAvatar={props.myAvatar}
            shape="square"
            avatarSize={chatMode ? 112 : 140}
            avatarLift={chatMode ? 200 : 0}
            avatarTestId="wx-video-my-avatar"
          />
          {phase === 'active' && (
            <button
              type="button"
              onClick={rt.swapViews}
              aria-label="与我的画面互换"
              data-testid="wx-video-remote-mini"
              {...miniDrag.dragProps}
              className={`absolute z-20 h-[160px] w-[104px] overflow-hidden rounded-[14px] ring-1 ring-white/15 shadow-[0_8px_24px_rgba(0,0,0,0.45)] select-none touch-none ${
                miniDrag.pos ? '' : 'right-4 top-[108px]'
              }`}
              style={miniDrag.pos ? { left: miniDrag.pos.left, top: miniDrag.pos.top } : undefined}
            >
              {/* Task 28-d（用户：卡片上下再变长一点+可拖拽）：AI 头像窗 104×140→104×160
                  （仍与拨号卡同尺寸同位置，全程无跳变；头像 58px≈窗宽 56% 不变；
                  按住拖拽移位，移动 <6px 仍算点按互换，位置整通共享） */}
              <RemoteMiniCard avatar={props.avatar} name={props.name} size={58} shape="square" />
            </button>
          )}
        </>
      ) : (
        <>
          {/* 微信皮肤：角色头像为正方形圆角（Task 23）；Task 26：头像 140+名字 13px、lift 96 上移，纯黑背景无模糊；
              Task 28-d：聊天模式 AI 头像重新入场——112px/lift 200（与互换态「我的头像」同尺寸同位置，
              时长下方净空区；名字已在顶部小头像行不重复），普通态仍 140+名字 */}
          {!chatMode ? (
            <RemoteView avatar={props.avatar} name={props.name} size={140} shape="square" showName lift={96} />
          ) : (
            <RemoteView avatar={props.avatar} name={props.name} size={112} shape="square" lift={200} />
          )}
          {phase === 'active' && (
            <LocalPipView
              videoRef={camera.videoRef}
              live={rt.camOn && camera.ready}
              className={`h-[160px] w-[104px] rounded-[14px] ${pipDrag.pos ? '' : 'right-4 top-[108px]'}`}
              testId="wx-video-pip"
              onClick={rt.swapViews}
              mirrored={rt.facing === 'user'}
              myAvatar={props.myAvatar}
              shape="square"
              avatarSize={58}
              dragPos={pipDrag.pos}
              dragHandlers={pipDrag.dragProps}
            />
          )}
        </>
      )}

      {/* 顶部信息（Task 25：时长+状态居中，名字只在互换后回落显示；Task 28 定稿聊天模式顶部加小头像名字） + 小窗/翻转/文字聊天入口 */}
      <VideoTopBar
        name={props.name}
        avatar={props.avatar}
        phase={phase}
        seconds={seconds}
        statusText={statusText}
        showName={rt.swapped && phase === 'active'}
        chatMode={chatMode}
        testId="wx-video-duration"
      />
      {/* 拍照结果轻提示（Task 28 A3，1.5s 自动消失） */}
      <ShotTip tip={shutter.tip} testId="wx-video-shot-tip" />
      {(phase === 'active' || dialing) && (
        <>
          <VideoPipIcon onClick={props.onMinimize} />
          {/* 右上角（时长文字旁）：翻转摄像头（Task 23 从底部移上来）+ 发消息 + 拍照（A3，Task 28） */}
          <div className="absolute right-5 top-[58px] z-20 flex items-center gap-2">
            <button
              type="button"
              onClick={rt.flipCam}
              aria-label="翻转摄像头（前后置切换）"
              data-testid="wx-video-flip"
              className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-black/35 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
            >
              <SwitchCamera className="h-5 w-5" strokeWidth={1.8} />
            </button>
            {phase === 'active' && (
              <button
                type="button"
                aria-label="发消息"
                aria-pressed={textChatOpen}
                data-testid="wx-video-textchat-btn"
                onClick={toggleTextChat}
                className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-black/35 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
              >
                <MessageSquare className="h-5 w-5" strokeWidth={1.8} />
              </button>
            )}
            {/* 拍照（A3，Task 28）：仅接通正常态（互换态主画面是我方摄像头，不提供）；抓当前全屏所见存相册 */}
            {phase === 'active' && !rt.swapped && (
              <button
                type="button"
                onClick={() => void shutter.shoot()}
                disabled={shutter.busy}
                aria-label="拍照保存到相册"
                data-testid="wx-video-shutter"
                className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-black/35 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
              >
                <Camera className="h-5 w-5" strokeWidth={1.8} />
              </button>
            )}
          </div>
        </>
      )}

      {/* 来电页（Task 23 对照微信截图：暗底 + 圆形头像 + 呼吸点 + 邀请你视频通话 +
          消息回复/语音接听 + 红拒绝/绿视频接听；底部按钮一直显示） */}
      {incoming && (
        <div className="absolute inset-0 z-10 flex flex-col items-center bg-[#0e0e11]">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-6">
            <div className="relative mt-10">
              <span className="absolute inset-0 animate-ping rounded-full bg-white/10" aria-hidden="true" />
              {props.avatar ? (
                <img src={props.avatar} alt="" className="h-[112px] w-[112px] rounded-full object-cover shadow-2xl ring-1 ring-white/15" />
              ) : (
                <DefaultAvatar size={112} shape="circle" className="shadow-2xl ring-1 ring-white/15" />
              )}
            </div>
            <p className="max-w-[240px] truncate text-[16px] font-medium text-white/95">{props.name}</p>
            <TypingDots />
            <p className="text-[15px] text-white/60" data-testid="wx-video-status">邀请你视频通话</p>
          </div>
          <div className="w-full px-12 pb-[max(34px,env(safe-area-inset-bottom))]">
            {/* 消息回复 / 语音接听（对照微信截图；语音接听=关摄像头只通声音） */}
            <div className="mb-9 flex items-start justify-around">
              {props.onMessageReply && (
                <button
                  type="button"
                  onClick={() => {
                    call.reject();
                    props.onMessageReply?.();
                  }}
                  aria-label="消息回复"
                  data-testid="wx-video-msg-reply"
                  className="flex flex-col items-center gap-2 text-white/90 active:opacity-60"
                >
                  <MessageSquare className="h-8 w-8" strokeWidth={1.6} />
                  <span className="text-[13px]">消息回复</span>
                </button>
              )}
              <button
                type="button"
                onClick={rt.acceptAsVoice}
                aria-label="语音接听（关闭摄像头）"
                data-testid="wx-video-voice-accept"
                className="flex flex-col items-center gap-2 text-white/90 active:opacity-60"
              >
                <Phone className="h-8 w-8" strokeWidth={1.6} />
                <span className="text-[13px]">语音接听</span>
              </button>
            </div>
            <div className="flex w-full items-start justify-between">
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={call.reject}
                  aria-label="拒绝"
                  data-testid="wx-video-reject"
                  className="flex h-[74px] w-[74px] items-center justify-center rounded-full bg-[#FA5151] text-white active:opacity-80"
                >
                  <PhoneOff className="h-8 w-8" strokeWidth={2} />
                </button>
                <span className="text-[13px] text-white/85">拒绝</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={rt.accept}
                  aria-label="接听视频"
                  data-testid="wx-video-accept"
                  className="flex h-[74px] w-[74px] items-center justify-center rounded-full bg-[#07C160] text-white active:opacity-80"
                >
                  <Video className="h-8 w-8" strokeWidth={2} />
                </button>
                <span className="text-[13px] text-white/85">接听</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 接通后底部控制（Task 24 重排：字幕/文字条与按钮同列排布——位置固定不叠压、不再随绝对定位漂移） */}
      {(phase === 'active' || dialing) && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-8 pb-[max(30px,env(safe-area-inset-bottom))] pt-6">
          {/* C2（Task 28）：AI「想看看你」确认条（按钮上方；拒绝/同意后消失） */}
          {camReqVisible && (
            <CamRequestBar
              name={props.name}
              allowColor="#07C160"
              onAllow={allowCamReq}
              onDeny={camReq.denyCamera}
              testIdPrefix="wx"
            />
          )}
          {call.error && !textChatOpen && (
            <p className="shrink-0 text-center text-[12px] text-red-300">{call.error}</p>
          )}
          {phase === 'active' ? (
            textChatOpen ? (
              /* 文字输入条开着时字幕隐藏（与语音通话同口径），关掉恢复；
                 Task 28 定稿：聊天模式（中央头像名字已隐藏、顶部时长上方小头像名字）——
                 消息区+输入栏在按钮上方，底部容器 bottom 锚定 + 按钮行 shrink-0，
                 任何消息量下按钮都完整可见 */
              <div className="w-full shrink-0">
                <InlineCallChat variant="wx" call={call} className="w-full" messagesMaxH="20vh" />
              </div>
            ) : (
              /* Task 26：字幕槽弹性高度（64~112px）+底部对齐：长句内部滚动、最新一行完整贴按钮上方，不再被按钮区遮挡 */
              <div className="flex max-h-[112px] min-h-[64px] w-full shrink-0 flex-col items-center justify-end overflow-hidden pb-1">
                <VideoCaption variant="wx" call={call} />
              </div>
            )
          ) : (
            <p className="shrink-0 text-center text-[15px] text-white/70" data-testid="wx-video-status-dialing">
              正在等待 {props.name} 接受邀请…
            </p>
          )}
          {phase === 'active' && (
            <div className="flex shrink-0 items-start justify-center gap-10">
              <Ctl label={muted ? '麦克风已关' : '麦克风已开'}>{micBtn}</Ctl>
              <Ctl label={speakerOn ? '扬声器已开' : '扬声器已关'}>{speakerBtn}</Ctl>
              <Ctl label={rt.camOn ? '摄像头已开' : '摄像头已关'}>{camBtn}</Ctl>
            </div>
          )}
          {hangupBtn}
          {phase === 'active' && !muted && (
            <p className="shrink-0 text-[11px] text-white/40">免提自动对话 · 直接说话即可</p>
          )}
        </div>
      )}
    </div>
  );
}

/** 底部控制按钮+标签 */
function Ctl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {children}
      <span className="text-[12px] leading-none text-white/70">{label}</span>
    </div>
  );
}

// ---------------- QQ 皮肤 ----------------

function QqVideoCall(props: VideoCallScreenProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Task 28-d：右上角 AI 头像卡拖拽移位（拨号卡/互换卡共享位置，点按互换不受影响）
  const miniDrag = useMiniCardDrag(rootRef);
  // Task 28-e：我的画面卡拖拽移位（独立实例，与 AI 卡位置互不干扰；点按互换不受影响）
  const pipDrag = useMiniCardDrag(rootRef);
  // C2（Task 28）：AI「想看看你」请求确认条状态（回调透传引擎，每通最多触发一次）
  const camReq = useCamRequest();
  const rt = useVideoCallRuntime(props, camReq.onCameraRequest);
  // A3（Task 28）：通话拍照（快门 → photos 系统相册 + albums 联系人视觉相册）
  const shutter = useCallShutter({ rootRef, contactId: props.contact?.id ?? null });
  const { call, camera } = rt;
  const { phase, status, seconds, muted, speakerOn } = call;
  const [textChatOpen, setTextChatOpen] = useState(false);

  // C2（Task 28）：phase 离开 active（挂断/结束）自动清除请求态（本通不再弹）
  useEffect(() => {
    if (phase !== 'active') camReq.reset();
  }, [phase, camReq.reset]);
  /** 确认条可见：AI 已请求 + 未处理 + 接通中 + 当前无实际画面（开关关 or 权限拒绝/无设备；
 *  用户真正看到自己画面后自然消失） */
  const camReqVisible = camReq.camReq === 'asked' && phase === 'active' && !(rt.camOn && camera.ready);
  const allowCamReq = () => {
    if (!rt.camOn) rt.toggleCam();
    camReq.allowCamera();
  };

  // Task 24：接通后与语音通话同款状态文案（正在听/在听你说…/识别中…/正在思考…/正在说话）
  const statusText = phase === 'active' ? statusLine('active', status, 'qq') : null;

  const openTextChat = () => {
    if (phase !== 'active') return;
    call.setTextMode(true);
    setTextChatOpen(true);
  };
  const closeTextChat = () => {
    call.setTextMode(false);
    setTextChatOpen(false);
  };
  const toggleTextChat = () => (textChatOpen ? closeTextChat() : openTextChat());

  /** 聊天模式（Task 28 定稿）：中央大头像+名字隐藏、顶部时长上方小头像+名字、消息区+输入栏、按钮常显 */
  const chatMode = textChatOpen && phase === 'active';

  const dialing = phase === 'dialing';
  const incoming = phase === 'incoming';
  const qqSquare = 'flex h-[72px] w-[72px] items-center justify-center rounded-[26px] transition-colors active:opacity-70';
  const smallSquare = 'flex h-[52px] w-[52px] items-center justify-center rounded-[18px] transition-colors active:opacity-70';
  /** Task 24：底部四按钮行专用（摄像头并入后四钮平行，72px 放不下，收一档保证间距） */
  const qqCtl4 = 'flex h-[66px] w-[66px] items-center justify-center rounded-[22px] transition-colors active:opacity-70';

  return (
    <div ref={rootRef} className="relative h-full w-full overflow-hidden bg-[#050506]" data-testid="qq-video-screen">
      {/* 画面层：拨号中主画面=我方摄像头+左上对方头像小窗常显（Task 24）；接通主画面=对方；小窗（QQ 在左上，对照截图 5）=我方 */}
      {dialing ? (
        <>
          <LocalFullView
            videoRef={camera.videoRef}
            ready={camera.ready}
            mirrored={rt.facing === 'user'}
            myAvatar={props.myAvatar}
          />
          {/* Task 24：刚拨出界面对方头像也要一直显示（位置与接通后我方小窗一致，接通自然衔接）；
              Task 28 UI 定稿（用户截图）：AI 头像窗=深灰卡+居中大圆角小头像（不再铺满窗宽） */}
          <div
            aria-hidden="true"
            data-testid="qq-video-dial-avatar"
            {...miniDrag.dragProps}
            className={`absolute z-20 h-[152px] w-[100px] overflow-hidden rounded-[14px] shadow-[0_8px_24px_rgba(0,0,0,0.45)] ring-1 ring-white/15 select-none touch-none ${
              miniDrag.pos ? '' : 'left-4 top-[100px]'
            }`}
            style={miniDrag.pos ? { left: miniDrag.pos.left, top: miniDrag.pos.top } : undefined}
          >
            {/* Task 28-d（用户：卡片上下再变长一点+可拖拽）：AI 头像卡 100×132→100×152 */}
            <RemoteMiniCard avatar={props.avatar} name={props.name} size={56} />
          </div>
        </>
      ) : rt.swapped ? (
        <>
          {/* Task 28 追加反馈：聊天模式头像上移+缩小（不被底部聊天面板盖住），普通态居中 140 不变 */}
          <LocalFullView
            videoRef={camera.videoRef}
            ready={camera.ready}
            mirrored={rt.facing === 'user'}
            myAvatar={props.myAvatar}
            avatarSize={chatMode ? 112 : 140}
            avatarLift={chatMode ? 200 : 0}
            avatarTestId="qq-video-my-avatar"
          />
          {phase === 'active' && (
            <button
              type="button"
              onClick={rt.swapViews}
              aria-label="与我的画面互换"
              data-testid="qq-video-remote-mini"
              {...miniDrag.dragProps}
              className={`absolute z-20 h-[152px] w-[100px] overflow-hidden rounded-[14px] ring-1 ring-white/15 select-none touch-none ${
                miniDrag.pos ? '' : 'right-4 top-[104px]'
              }`}
              style={miniDrag.pos ? { left: miniDrag.pos.left, top: miniDrag.pos.top } : undefined}
            >
              {/* Task 28-d（用户：卡片上下再变长一点+可拖拽）：AI 头像窗 100×132→100×152
                  （头像 56px≈窗宽 56% 不变；按住拖拽移位，移动 <6px 仍算点按互换，位置整通共享） */}
              <RemoteMiniCard avatar={props.avatar} name={props.name} size={56} />
            </button>
          )}
        </>
      ) : (
        <>
          {/* Task 26：主画面头像 140 + 头像下方名字（小字）、lift 96 上移，纯黑背景无模糊；
              Task 28-d：聊天模式 AI 头像重新入场——112px/lift 200（与互换态「我的头像」同尺寸
              同位置，时长下方净空区；名字已在顶部小头像行不重复） */}
          {!chatMode ? (
            <RemoteView avatar={props.avatar} name={props.name} size={140} showName lift={96} />
          ) : (
            <RemoteView avatar={props.avatar} name={props.name} size={112} lift={200} />
          )}
          {phase === 'active' && (
            <LocalPipView
              videoRef={camera.videoRef}
              live={rt.camOn && camera.ready}
              className={`h-[152px] w-[100px] rounded-[14px] ${pipDrag.pos ? '' : 'left-4 top-[100px]'}`}
              testId="qq-video-pip"
              onClick={rt.swapViews}
              mirrored={rt.facing === 'user'}
              myAvatar={props.myAvatar}
              avatarSize={56}
              dragPos={pipDrag.pos}
              dragHandlers={pipDrag.dragProps}
            />
          )}
        </>
      )}

      <VideoTopBar
        name={props.name}
        avatar={props.avatar}
        phase={phase}
        seconds={seconds}
        statusText={statusText}
        showName={rt.swapped && phase === 'active'}
        chatMode={chatMode}
        testId="qq-video-duration"
      />
      {/* 拍照结果轻提示（Task 28 A3，1.5s 自动消失） */}
      <ShotTip tip={shutter.tip} testId="qq-video-shot-tip" />
      {/* 右上角（时长文字旁）：翻转摄像头（Task 24 从底部小按钮行移上来，与微信同款）+ 发消息；拨号中也可翻转 */}
      {(phase === 'active' || dialing) && (
        <>
          <VideoPipIcon onClick={props.onMinimize} />
          <div className="absolute right-5 top-[58px] z-20 flex items-center gap-2">
            <button
              type="button"
              onClick={rt.flipCam}
              aria-label="翻转摄像头（前后置切换）"
              data-testid="qq-video-flip"
              className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-black/35 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
            >
              <SwitchCamera className="h-5 w-5" strokeWidth={1.8} />
            </button>
            {phase === 'active' && (
              <button
                type="button"
                aria-label="发消息"
                aria-pressed={textChatOpen}
                data-testid="qq-video-textchat-btn"
                onClick={toggleTextChat}
                className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-black/35 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
              >
                <MessageSquare className="h-5 w-5" strokeWidth={1.8} />
              </button>
            )}
            {/* 拍照（A3，Task 28）：仅接通正常态（互换态主画面是我方摄像头，不提供）；抓当前全屏所见存相册 */}
            {phase === 'active' && !rt.swapped && (
              <button
                type="button"
                onClick={() => void shutter.shoot()}
                disabled={shutter.busy}
                aria-label="拍照保存到相册"
                data-testid="qq-video-shutter"
                className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-black/35 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
              >
                <Camera className="h-5 w-5" strokeWidth={1.8} />
              </button>
            )}
          </div>
        </>
      )}

      {/* 来电页（Task 23 对照 QQ 截图：黑底圆形大头像 + 呼吸点 + 邀请你视频通话..
          + 翻转/摄像头预开 + 消息回复 + 红拒绝/绿视频接听；底部按钮一直显示） */}
      {incoming && (
        <div className="absolute inset-0 z-10 flex flex-col items-center bg-[#050506]">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8">
            <div className="relative mt-8">
              <span className="absolute inset-0 animate-ping rounded-full bg-white/10" aria-hidden="true" />
              {props.avatar ? (
                <img src={props.avatar} alt="" className="h-[132px] w-[132px] rounded-full object-cover shadow-2xl ring-1 ring-white/15" />
              ) : (
                <DefaultAvatar size={132} shape="circle" className="shadow-2xl ring-1 ring-white/15" />
              )}
            </div>
            <p className="max-w-[240px] truncate text-[16px] font-medium text-white/95">{props.name}</p>
            <TypingDots />
            <p className="text-[15px] text-white/60" data-testid="qq-video-status">邀请你视频通话..</p>
          </div>
          <div className="flex w-full flex-col items-center px-10 pb-[max(40px,env(safe-area-inset-bottom))]">
            {/* 响铃阶段预置摄像头（对照截图：翻转 / 摄像头已开——开=首次申请权限，接通即带上画面） */}
            <div className="mb-8 flex items-start justify-center gap-12">
              <Ctl label="翻转">
                <button
                  type="button"
                  onClick={rt.flipCam}
                  aria-label="翻转摄像头"
                  data-testid="qq-video-flip"
                  className={`${smallSquare} bg-white/10 text-white`}
                >
                  <SwitchCamera className="h-5 w-5" strokeWidth={1.8} />
                </button>
              </Ctl>
              <Ctl label={rt.camOn ? '摄像头已开' : '摄像头已关'}>
                <button
                  type="button"
                  onClick={rt.toggleCam}
                  aria-label={rt.camOn ? '关闭摄像头' : '打开摄像头'}
                  aria-pressed={rt.camOn}
                  data-testid="qq-video-cam"
                  className={`${smallSquare} ${rt.camOn ? 'bg-white/15 text-white' : 'bg-white/10 text-white/50'}`}
                >
                  {rt.camOn ? <Video className="h-5 w-5" strokeWidth={1.9} /> : <VideoOff className="h-5 w-5" strokeWidth={1.9} />}
                </button>
              </Ctl>
            </div>
            {props.onMessageReply && (
              <button
                type="button"
                onClick={() => {
                  call.reject();
                  props.onMessageReply?.();
                }}
                className="mb-9 flex w-[86px] flex-col items-center gap-2 self-start text-white/90 active:opacity-60"
                data-testid="qq-video-msg-reply"
              >
                <MessageSquare className="h-8 w-8" strokeWidth={1.6} />
                <span className="text-[13px]">消息回复</span>
              </button>
            )}
            <div className="flex w-full items-center justify-between">
              <button type="button" onClick={call.reject} aria-label="拒绝" data-testid="qq-video-reject" className={`${qqSquare} bg-[#F5455C] text-white`}>
                <PhoneOff className="h-8 w-8" strokeWidth={2} />
              </button>
              <button type="button" onClick={rt.accept} aria-label="接听视频" data-testid="qq-video-accept" className={`${qqSquare} bg-[#2FBF71] text-white`}>
                <Video className="h-8 w-8" strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 接通后：字幕/文字条 + 四按钮行（Task 24：摄像头并入底部三按钮→四钮平行；时长/状态在顶部，不再重复）
          与微信同款重排——字幕与按钮同列排布，不再绝对定位互相叠压 */}
      {(phase === 'active' || dialing) && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-4 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-6 pb-[max(28px,env(safe-area-inset-bottom))] pt-6">
          {/* C2（Task 28）：AI「想看看你」确认条（按钮上方；拒绝/同意后消失） */}
          {camReqVisible && (
            <CamRequestBar
              name={props.name}
              allowColor="#0099FF"
              onAllow={allowCamReq}
              onDeny={camReq.denyCamera}
              testIdPrefix="qq"
            />
          )}
          {call.error && !textChatOpen && (
            <p className="shrink-0 text-center text-[12px] text-red-300">{call.error}</p>
          )}
          {phase === 'active' ? (
            textChatOpen ? (
              /* 文字输入条开着时字幕隐藏（与语音通话同口径），关掉恢复；
                 Task 28 定稿：聊天模式（中央头像名字已隐藏、顶部时长上方小头像名字）——
                 消息区+输入栏在按钮上方，底部容器 bottom 锚定 + 按钮行 shrink-0，
                 任何消息量下按钮都完整可见 */
              <div className="w-full shrink-0">
                <InlineCallChat variant="qq" call={call} className="w-full" messagesMaxH="20vh" />
              </div>
            ) : (
              /* Task 26：字幕槽弹性高度（64~112px）+底部对齐：长句内部滚动、最新一行完整贴按钮上方，不再被按钮区遮挡 */
              <div className="flex max-h-[112px] min-h-[64px] w-full shrink-0 flex-col items-center justify-end overflow-hidden pb-1">
                <VideoCaption variant="qq" call={call} />
              </div>
            )
          ) : (
            <p className="shrink-0 text-center text-[15px] text-white/70" data-testid="qq-video-status-dialing">
              正在呼叫 {props.name}…
            </p>
          )}
          {/* 四按钮平行（麦克风/摄像头/挂断/扬声器）；互换画面按钮已删（点小窗互换），翻转移右上角 */}
          <div className="flex w-full shrink-0 items-center justify-between">
            <button
              type="button"
              onClick={call.toggleMute}
              aria-label={muted ? '取消静音' : '静音麦克风'}
              aria-pressed={muted}
              data-testid="qq-video-mic"
              className={`${qqCtl4} ${muted ? 'bg-white/10 text-white/55' : 'bg-white text-black'}`}
            >
              {muted ? <MicOff className="h-6 w-6" strokeWidth={1.9} /> : <Mic className="h-6 w-6" strokeWidth={1.9} />}
            </button>
            <button
              type="button"
              onClick={rt.toggleCam}
              aria-label={rt.camOn ? '关闭摄像头' : '打开摄像头'}
              aria-pressed={rt.camOn}
              data-testid="qq-video-cam"
              className={`${qqCtl4} ${rt.camOn ? 'bg-white/15 text-white' : 'bg-white/10 text-white/50'}`}
            >
              {rt.camOn ? <Video className="h-6 w-6" strokeWidth={1.9} /> : <VideoOff className="h-6 w-6" strokeWidth={1.9} />}
            </button>
            <button type="button" onClick={call.hangup} aria-label="挂断" data-testid="qq-video-hangup" className={`${qqCtl4} bg-[#F5455C] text-white`}>
              <PhoneOff className="h-7 w-7" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={call.toggleSpeaker}
              aria-label={speakerOn ? '关闭扬声器' : '开启扬声器'}
              aria-pressed={speakerOn}
              data-testid="qq-video-speaker"
              className={`${qqCtl4} ${speakerOn ? 'bg-white text-black' : 'bg-white/10 text-white/55'}`}
            >
              {speakerOn ? <Volume2 className="h-6 w-6" strokeWidth={1.9} /> : <VolumeX className="h-6 w-6" strokeWidth={1.9} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 电话 App 皮肤（iOS 黑白灰） ----------------

function PhoneVideoCall(props: VideoCallScreenProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Task 28-d：右上角 AI 头像卡拖拽移位（互换 mini 卡；点按互换不受影响）
  const miniDrag = useMiniCardDrag(rootRef);
  // Task 28-e：我的画面卡拖拽移位（独立实例，与 AI 卡位置互不干扰；点按互换不受影响）
  const pipDrag = useMiniCardDrag(rootRef);
  // C2（Task 28）：AI「想看看你」请求确认条状态（回调透传引擎，每通最多触发一次）
  const camReq = useCamRequest();
  const rt = useVideoCallRuntime(props, camReq.onCameraRequest);
  // A3（Task 28）：通话拍照（快门 → photos 系统相册 + albums 联系人视觉相册）
  const shutter = useCallShutter({ rootRef, contactId: props.contact?.id ?? null });
  const { call, camera } = rt;
  const { phase, seconds, muted, speakerOn } = call;
  const dialing = phase === 'dialing';
  const incoming = phase === 'incoming';

  // C2（Task 28）：phase 离开 active（挂断/结束）自动清除请求态（本通不再弹）
  useEffect(() => {
    if (phase !== 'active') camReq.reset();
  }, [phase, camReq.reset]);
  /** 确认条可见：AI 已请求 + 未处理 + 接通中 + 当前无实际画面（开关关 or 权限拒绝/无设备；
 *  用户真正看到自己画面后自然消失） */
  const camReqVisible = camReq.camReq === 'asked' && phase === 'active' && !(rt.camOn && camera.ready);
  const allowCamReq = () => {
    if (!rt.camOn) rt.toggleCam();
    camReq.allowCamera();
  };

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full overflow-hidden bg-gradient-to-b from-[#3c3c40] via-[#26262a] to-[#0c0c0e]"
      data-testid="phone-video-screen"
    >
      {dialing ? (
        <LocalFullView
          videoRef={camera.videoRef}
          ready={camera.ready}
          mirrored={rt.facing === 'user'}
          myAvatar={props.myAvatar}
        />
      ) : rt.swapped ? (
        <>
          <LocalFullView
            videoRef={camera.videoRef}
            ready={camera.ready}
            mirrored={rt.facing === 'user'}
            myAvatar={props.myAvatar}
          />
          {phase === 'active' && (
            <button
              type="button"
              onClick={rt.swapViews}
              aria-label="与我的画面互换"
              data-testid="phone-video-remote-mini"
              {...miniDrag.dragProps}
              className={`absolute z-20 h-[152px] w-[100px] overflow-hidden rounded-[14px] ring-1 ring-white/15 select-none touch-none ${
                miniDrag.pos ? '' : 'right-4 top-[104px]'
              }`}
              style={miniDrag.pos ? { left: miniDrag.pos.left, top: miniDrag.pos.top } : undefined}
            >
              {/* Task 28-d（用户：卡片上下再变长一点+可拖拽）：AI 头像窗 100×132→100×152
                  （与 wx/qq 同步；头像 56px≈窗宽 56% 不变；按住拖拽移位，位置整通共享） */}
              <RemoteMiniCard avatar={props.avatar} name={props.name} size={56} />
            </button>
          )}
        </>
      ) : (
        <>
          <RemoteView avatar={props.avatar} name={props.name} size={140} showName lift={96} />
          {phase === 'active' && (
            <LocalPipView
              videoRef={camera.videoRef}
              live={rt.camOn && camera.ready}
              className={`h-[152px] w-[100px] rounded-[14px] ${pipDrag.pos ? '' : 'right-4 top-[100px]'}`}
              testId="phone-video-pip"
              onClick={rt.swapViews}
              mirrored={rt.facing === 'user'}
              myAvatar={props.myAvatar}
              avatarSize={56}
              dragPos={pipDrag.pos}
              dragHandlers={pipDrag.dragProps}
            />
          )}
        </>
      )}

      <VideoTopBar
        name={props.name}
        avatar={props.avatar}
        phase={phase}
        seconds={seconds}
        statusText={phase === 'active' ? statusLine('active', call.status, 'wx') : null}
        showName={rt.swapped && phase === 'active'}
        testId="phone-video-duration"
      />
      {phase === 'active' && <VideoPipIcon onClick={props.onMinimize} />}

      {/* 右上角快门（A3，Task 28）：电话皮肤无翻转/发消息顶栏组，仅接通正常态单独提供；抓当前全屏所见存相册 */}
      {phase === 'active' && !rt.swapped && (
        <div className="absolute right-5 top-[58px] z-20 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void shutter.shoot()}
            disabled={shutter.busy}
            aria-label="拍照保存到相册"
            data-testid="phone-video-shutter"
            className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-black/35 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
          >
            <Camera className="h-5 w-5" strokeWidth={1.8} />
          </button>
        </div>
      )}
      {/* 拍照结果轻提示（Task 28 A3，1.5s 自动消失） */}
      <ShotTip tip={shutter.tip} testId="phone-video-shot-tip" />

      {incoming && (
        <div className="absolute inset-0 z-10 flex flex-col items-center bg-[#1c1c1e]">
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8">
            {props.avatar ? (
              <img src={props.avatar} alt="" className="h-[124px] w-[124px] rounded-full object-cover shadow-2xl ring-1 ring-white/20" />
            ) : (
              <DefaultAvatar size={124} shape="circle" className="shadow-2xl ring-1 ring-white/20" />
            )}
            <h1 className="mt-3 max-w-[300px] truncate text-[32px] font-semibold tracking-tight text-white">{props.name}</h1>
            <p className="text-[15px] text-white/60" data-testid="phone-video-status">邀请你视频通话</p>
          </div>
          <div className="flex w-full items-start justify-between px-12 pb-[max(40px,env(safe-area-inset-bottom))]">
            <div className="flex w-[84px] flex-col items-center gap-2">
              <button type="button" onClick={call.reject} aria-label="拒绝" data-testid="phone-video-reject" className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#FF453A] text-white shadow-[0_10px_28px_rgba(255,69,58,0.35)] active:scale-95">
                <PhoneOff className="h-[30px] w-[30px]" strokeWidth={2.1} />
              </button>
              <span className="text-[13px] text-white/90">拒绝</span>
            </div>
            <div className="flex w-[84px] flex-col items-center gap-2">
              <button type="button" onClick={rt.accept} aria-label="接听视频" data-testid="phone-video-accept" className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#30D158] text-white shadow-[0_10px_28px_rgba(48,209,88,0.35)] active:scale-95">
                <Video className="h-[30px] w-[30px]" strokeWidth={2.1} />
              </button>
              <span className="text-[13px] text-white/90">接听</span>
            </div>
          </div>
        </div>
      )}

      {phase === 'active' && (
        /* Task 26：字幕槽改底部对齐+弹性高度（绝对定位 bottom 锚点，长句向上长高、最新一句完整贴控制区上方） */
        <div className="pointer-events-none absolute inset-x-6 bottom-[204px] z-10 flex max-h-[112px] flex-col items-center justify-end overflow-hidden">
          <VideoCaption variant="wx" call={call} />
        </div>
      )}
      {(phase === 'active' || dialing) && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-5 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-8 pb-[max(32px,env(safe-area-inset-bottom))] pt-8">
          {/* C2（Task 28）：AI「想看看你」确认条（按钮上方；拒绝/同意后消失；iOS 绿按钮） */}
          {camReqVisible && (
            <CamRequestBar
              name={props.name}
              allowColor="#30D158"
              onAllow={allowCamReq}
              onDeny={camReq.denyCamera}
              testIdPrefix="phone"
            />
          )}
          {call.error && (
            <p className="shrink-0 text-center text-[12px] text-red-300">{call.error}</p>
          )}
          {phase === 'active' && (
            <div className="flex items-center gap-8">
              <MiniCtl label={muted ? '已静音' : '静音'}>
                <button type="button" onClick={call.toggleMute} aria-label={muted ? '取消静音' : '静音'} aria-pressed={muted} data-testid="phone-video-mic" className={`flex h-[52px] w-[52px] items-center justify-center rounded-full ${muted ? 'bg-white text-black' : 'bg-white/15 text-white'}`}>
                  {muted ? <MicOff className="h-5 w-5" strokeWidth={1.9} /> : <Mic className="h-5 w-5" strokeWidth={1.9} />}
                </button>
              </MiniCtl>
              <MiniCtl label={rt.camOn ? '摄像头开' : '摄像头关'}>
                <button type="button" onClick={rt.toggleCam} aria-label={rt.camOn ? '关闭摄像头' : '打开摄像头'} aria-pressed={rt.camOn} data-testid="phone-video-cam" className={`flex h-[52px] w-[52px] items-center justify-center rounded-full ${rt.camOn ? 'bg-white text-black' : 'bg-white/15 text-white'}`}>
                  {rt.camOn ? <Video className="h-5 w-5" strokeWidth={1.9} /> : <VideoOff className="h-5 w-5" strokeWidth={1.9} />}
                </button>
              </MiniCtl>
              <MiniCtl label="翻转">
                <button type="button" onClick={rt.flipCam} aria-label="翻转摄像头" data-testid="phone-video-flip" className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white/15 text-white">
                  <SwitchCamera className="h-5 w-5" strokeWidth={1.8} />
                </button>
              </MiniCtl>
              <MiniCtl label={speakerOn ? '扬声器开' : '扬声器关'}>
                <button type="button" onClick={call.toggleSpeaker} aria-label={speakerOn ? '关闭扬声器' : '开启扬声器'} aria-pressed={speakerOn} data-testid="phone-video-speaker" className={`flex h-[52px] w-[52px] items-center justify-center rounded-full ${speakerOn ? 'bg-white text-black' : 'bg-white/15 text-white'}`}>
                  {speakerOn ? <Volume2 className="h-5 w-5" strokeWidth={1.9} /> : <VolumeX className="h-5 w-5" strokeWidth={1.9} />}
                </button>
              </MiniCtl>
            </div>
          )}
          {/* 挂断拨号中也显示（此前拨号中无法取消通话） */}
          <button type="button" onClick={call.hangup} aria-label="挂断" data-testid="phone-video-hangup" className="flex h-[70px] w-[70px] items-center justify-center rounded-full bg-[#FF453A] text-white shadow-[0_10px_28px_rgba(255,69,58,0.35)] active:scale-95">
            <PhoneOff className="h-8 w-8" strokeWidth={2} />
          </button>
        </div>
      )}
      {dialing && (
        <p className="absolute inset-x-0 bottom-[190px] z-10 text-center text-[15px] text-white/70" data-testid="phone-video-status-dialing">
          正在呼叫 {props.name}…
        </p>
      )}
    </div>
  );
}

/** 电话皮肤无文字聊天条（iOS 电话语义），字幕恒开 */
function MiniCtl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {children}
      <span className="text-[11px] leading-none text-white/70">{label}</span>
    </div>
  );
}

// ---------------- 出口 ----------------

export default function VideoCallScreen(props: VideoCallScreenProps) {
  const { variant } = props;
  return (
    <div
      className="absolute inset-0 z-[70] overflow-hidden bg-black text-white"
      role="dialog"
      aria-label={`与${props.name}的视频通话`}
      data-testid={`video-screen-${props.variant}`}
    >
      {variant === 'wx' ? <WxVideoCall {...props} /> : variant === 'qq' ? <QqVideoCall {...props} /> : <PhoneVideoCall {...props} />}
    </div>
  );
}
