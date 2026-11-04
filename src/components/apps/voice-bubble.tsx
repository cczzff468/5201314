'use client';

/**
 * 语音消息气泡（微信 / QQ / 信息 / 两端群聊共用）：
 * - 微信（theme='wx'）：**1:1 复刻真机微信语音气泡**（用户指定参数，第 19 轮）：
 *   ① 高度固定 42px；② 宽度按公式 width = 65 + 时长 × 2.25（1s≈67px、60s 封顶 200px）；
 *   ③ 圆角 4px（微信气泡微圆角，非大圆角）；④ 尾巴用 CSS 伪元素 ::before 绘制
 *   （10px 正方形 rotate(45deg)、background-color: inherit 与气泡同色、菱形中心悬在
 *   top 18px＝垂直居中偏上、紧贴气泡左/右边缘，见 globals.css .wx-voice-bubble）；
 *   ⑤ 内部 flex + items-center + **数字与图标聚拢**（第八轮反馈：时长数字无论多久都紧贴声波图标，
 *   真机同款——内容聚在尾巴一侧，剩余宽度留白在远端随时长增长；数字与图标间距固定 8px）
 *   ⑥ 喇叭图标两侧**镜像**（第十轮用户反馈：我方气泡 = 时长5″→圆弧→菱形，菱形贴右缘尾巴侧；
 *   对方保持菱形在左、弧线在右），播放中三道弧线按 CSS 动画波纹闪烁（globals.css
 *   @keyframes wx-voice-arc-blink），停止静态；
 *   ⑦ 时长 13px 黑色（第九轮：跟随气泡文字色，浅色模式纯黑），只显示数字 + ″（如 2″）；⑧ 颜色：对方 #FFFFFF / 我方 #95EC69，
 *   文字与图标 #000（深色模式保留既有暗色映射）。点击气泡任意处播放/暂停
 *   （全局单例：新播自动停旧，也停 TTS 朗读）
 * - QQ / 信息：圆形播放钮（**三角/暂停图标，与 QQ 一致**）+ **随宽度伸缩的录音波形条**
 *   （voice.wave，播放中按进度逐根点亮，播放完成恢复默认）+ **固定在气泡右侧的时长**；
 *   宽度 = 60 基础 + 时长 × 3px/秒（1s→63px、60s→240px 封顶）
 * - 圆角与各端文本气泡同规格（微信 4px / QQ 12px / 信息 18px）
 * - 转文字结果（stt='done'）以**白色圆角小面板**显示在气泡下方（微信原生同款：浅色
 *   bg-white / 深色 #2C2C2C，三端通用，紧贴气泡下方 5px）；stt='pending' 显示「转文字中…」
 * - 长按菜单由外层 {...bubblePress} 提供，组件本身只处理点击播放
 */

import { Pause, Play } from 'lucide-react';
import { useVoicePlayback, voicePlayer } from '@/lib/ios/voice-player';
import { voiceDurationLabel } from '@/lib/ios/audio-utils';
import { useSettings } from '@/lib/ios/store';
import { transcriptVisual, type BubbleAppId } from '@/lib/ios/bubble-style';

/** 语音消息数据（各端消息结构统一挂 m.voice） */
export interface VoiceMsgData {
  /** 音频 dataURL（持久化在聊天记录里，重启后仍可播放）；文字转语音/内置引擎 AI 语音消息为空串 */
  url: string;
  /** 秒（≥1） */
  duration: number;
  /** 静态波形（0~1，约 20 根；录音时真实振幅采样）。微信端不展示波形（真机无波形），仅 QQ/信息气泡使用 */
  wave: number[];
  /** 仿真朗读原文（文字转语音消息/AI 静音语音条）。点击气泡：我方消息（无 contactId）走静音
   *  进度动画；AI 语音消息（带 contactId）按角色音色实时朗读真实出声（Task 33）；仅历史存量
   *  synth='builtin' 旧消息同样实时朗读 */
  localText?: string;
  /** AI 语音消息合成通道：'api' = 已存真实音频 dataURL；'builtin' = 内置引擎实时朗读，
   *  仅存在于历史存量旧消息（新版内置通道不发该标记，留空 = 静音语音条，点击由
   *  voice-player 按 contactId 走角色音色实时朗读，配置了声音即出声） */
  synth?: 'builtin' | 'api';
  /** 发送该语音的联系人 id（AI 语音消息实时朗读时解析角色音色用） */
  contactId?: string;
  /** 转文字结果（长按「转文字」后写入 / 文字转语音的原文） */
  transcript?: string;
  /** pending = 识别中；done = 有结果；failed = 识别失败（可长按重试） */
  stt?: 'pending' | 'done' | 'failed';
}

export type VoiceBubbleTheme = 'wx' | 'qq' | 'im';

/** 各端配色（own = 我方绿/蓝气泡；peer = 对方白/灰气泡）；dark = 我方为彩色/深底（白色钮与图标） */
const THEME: Record<VoiceBubbleTheme, { own: string; peer: string; dark: boolean; ownTranscript: string; peerTranscript: string }> = {
  wx: {
    // 用户指定：发送方 #95EC69 / 接收方 #FFFFFF，文字与图标 #000（深色模式保留暗色映射）
    own: 'bg-[#95EC69] text-black dark:bg-[#3EB575] dark:text-black/85',
    peer: 'bg-white text-black dark:bg-[#1E1E1E] dark:text-white/90',
    dark: false,
    // 转文字白面板文字色（微信参考截图：近黑大字；深色面板上 85% 白），三端一致
    ownTranscript: 'text-black/[0.82] dark:text-white/85',
    peerTranscript: 'text-black/[0.82] dark:text-white/85',
  },
  qq: {
    own: 'text-white',
    peer: 'bg-white text-[#1F2329] dark:bg-[#2A2C31] dark:text-white',
    dark: true,
    ownTranscript: 'text-black/70 dark:text-white/80',
    peerTranscript: 'text-black/70 dark:text-white/80',
  },
  im: {
    own: 'text-white',
    peer: 'bg-white text-black dark:bg-[#1E1E1E] dark:text-white',
    dark: true,
    ownTranscript: 'text-black/70 dark:text-white/80',
    peerTranscript: 'text-black/70 dark:text-white/80',
  },
};

/* ───────── 宽度与波形几何（QQ / 信息端） ───────── */

/** QQ/信息：基础宽度 60 + 时长 × 3px/秒，封顶 240：1s→63px、10s→90px、60s→240px（超出不再增长） */
function bubbleWidth(duration: number): number {
  const d = Math.max(1, Math.round(duration));
  return Math.min(240, 60 + d * 3);
}

/** 微信：用户指定公式 width = 65 + 时长 × 2.25，最长 60 秒封顶 200px（1s≈67px） */
function wxBubbleWidth(duration: number): number {
  const d = Math.max(1, Math.round(duration));
  return Math.min(200, 65 + d * 2.25);
}

const BAR_W = 2.5;
const BAR_GAP = 3;
const BAR_STRIDE = BAR_W + BAR_GAP;
const PAD_X = 12; // 气泡水平内边距（px-[6px]）
const GAP_X = 8; // 两处 item 间距（gap-[4px] × 2）
const CIRCLE = 20; // 播放钮直径

/** 波形条数随气泡宽度伸缩（时长文本按字符宽估算、宁多留空不裁切）：1s→1~2 根 … 60s→约 32 根 */
function barCountFor(width: number, label: string): number {
  const labelW = Math.round(label.length * 6.5);
  const avail = width - PAD_X - GAP_X - CIRCLE - labelW - 2;
  return Math.max(1, Math.min(34, Math.floor((avail + BAR_GAP) / BAR_STRIDE)));
}

/** 语音波形 → count 根展示条（0~1，线性插值——宽度连续变化时波形平滑不跳变）；旧数据无 wave 用固定美观波形兜底 */
function waveBarsOf(wave: number[] | undefined, count: number): number[] {
  const src = wave && wave.length > 0 ? wave : DEFAULT_WAVE;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const pos = count === 1 ? (src.length - 1) / 2 : (i / (count - 1)) * (src.length - 1);
    const a = Math.floor(pos);
    const b = Math.ceil(pos);
    const v = a === b ? src[a] : src[a] + ((src[b] ?? src[a]) - src[a]) * (pos - a);
    out.push(Math.max(0.12, Math.min(1, v)));
  }
  return out;
}

const DEFAULT_WAVE = [0.55, 0.85, 0.4, 0.95, 0.6, 0.78, 0.42, 0.9, 0.58, 0.72, 0.46, 0.8, 0.62, 0.88, 0.5, 0.75, 0.42, 0.9, 0.55, 0.7, 0.48, 0.82];

/** 波形条：随气泡宽度伸缩；播放中按进度逐根点亮（bg-current 自适应两端配色），播完恢复默认（QQ/信息端用） */
function VoiceWaveBars({ wave, active, playing, progress, count }: { wave: number[]; active: boolean; playing: boolean; progress: number; count: number }) {
  const bars = waveBarsOf(wave, count);
  return (
    <span className="flex h-[18px] min-w-0 flex-1 items-center gap-[3px] overflow-hidden" aria-hidden="true">
      {bars.map((v, i) => {
        const filled = active && playing && progress * bars.length > i;
        return (
          <span
            key={i}
            className="w-[2.5px] shrink-0 rounded-full bg-current transition-opacity duration-150"
            style={{ height: `${Math.round(4 + v * 14)}px`, opacity: filled ? 0.9 : 0.35 }}
          />
        );
      })}
    </span>
  );
}

/**
 * 微信语音图标（第十轮重制）：收/发两侧**镜像**——
 * - 对方（收到的白气泡）：菱形在左、弧线在右（字形同旧版：M6.6 8.2 L9.2 12 …）；
 * - 我方（发出的绿气泡）：水平镜像 → **弧线在左、菱形在右**（用户指定顺序「数字5″→圆弧→菱形」，
 *   菱形贴右缘尾巴一侧，真机同款）；实现用 CSS scaleX(-1) 镜像同一 SVG，两道弧线/菱形几何不变。
 * 播放中弧线从前往后一个一个出现（globals.css wx-voice-arc-seq），停止静态。
 */
function WxVoiceIcon({ playing = false, mirrored = false }: { playing?: boolean; mirrored?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      className="wx-voice-wave shrink-0"
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
    >
      {/* 实心菱形（5.2×7.6，右尖 x=9.2 与内弧 x=12 保持 2.8 单位间距；镜像后菱形贴右缘尾巴侧） */}
      <path className="wx-cone" d="M6.6 8.2 L9.2 12 L6.6 15.8 L4 12 Z" fill="currentColor" stroke="none" />
      {/* 两道声波弧线（镜像后在左侧；播放中从前往后一个一个出现） */}
      <path className="wx-arc wx-arc-2" d="M12 7 Q 16 12 12 17" />
      <path className="wx-arc wx-arc-3" d="M16 4 Q 22 12 16 20" />
    </svg>
  );
}

/** 微信真机同款时长文字（第九轮：黑色——跟随气泡文字色 currentColor，浅色模式纯黑）；13px，只显示数字 + ″（如 2″，用户指定参数） */
function WxDuration({ label }: { label: string }) {
  return <span className="shrink-0 text-[13px] leading-none tabular-nums text-current">{label}</span>;
}

export function VoiceMsgBubble({
  msgId,
  voice,
  side,
  theme,
  bubbleClassName,
  decorated,
  hideTail,
  style,
  decorApp,
  msgIndex,
}: {
  msgId: string;
  voice: VoiceMsgData;
  /** 'me' | 'peer'：决定配色 */
  side: 'me' | 'peer';
  theme: VoiceBubbleTheme;
  /** 装扮附加类（第十八轮：液态气泡 bub-liquid 等由气泡装扮系统透传） */
  bubbleClassName?: string;
  /** 气泡装扮已接管配色（播放钮/波形改用 currentColor 适配任意底色） */
  decorated?: boolean;
  /** 隐藏尾巴（第十八轮：毛玻璃/液态胶囊无尾巴；仅微信端有原生尾巴可隐藏） */
  hideTail?: boolean;
  /** QQ/信息 我方气泡的底色等自定义样式（由调用方传 backgroundColor） */
  style?: React.CSSProperties;
  /** 气泡装扮宿主 App（第四十二轮：转文字面板跟随气泡装扮——传入即启用；与气泡同语言染色/玻璃） */
  decorApp?: BubbleAppId;
  /** 消息序号（七彩循环取色与气泡一致；decorApp 启用时必传） */
  msgIndex?: number;
}) {
  const { activeId, playing, progress } = useVoicePlayback();
  const mine = side === 'me';
  const t = THEME[theme];
  const isWx = theme === 'wx';
  // 第四十二轮：转文字面板跟随气泡装扮（与所属语音气泡同一装扮语言：染色/七彩/磨砂/液态）。
  // 装扮配置由组件内部订阅（调用方只需传 decorApp + msgIndex，与 bvis 同源同步）
  const bubbleStyle = useSettings((s) => s.bubbleStyle);
  const tvis = decorApp ? transcriptVisual(mine ? 'mine' : 'theirs', bubbleStyle, msgIndex ?? 0, decorApp) : null;
  const isActive = activeId === msgId;
  const isPlaying = isActive && playing;
  const label = voiceDurationLabel(voice.duration);
  /** 气泡宽度随时长动态变化：微信 65 + 2.25px/秒封顶 200（用户指定公式）；QQ/信息 60 基础 + 3px/秒封顶 240 */
  const width = isWx ? wxBubbleWidth(voice.duration) : bubbleWidth(voice.duration);
  /** 波形条数随宽度伸缩（仅 QQ/信息端有波形） */
  const bars = isWx ? 0 : barCountFor(bubbleWidth(voice.duration), label);
  /** 播放钮配色：装扮接管时用 currentColor 半透明底适配任意气泡色；
   *  原生：信息对方品牌蓝；QQ 对方蓝、我方半透明白（微信端不渲染播放钮） */
  const circleCls = decorated
    ? 'bg-black/[0.12] text-current'
    : mine
      ? 'bg-white/25 text-white'
      : theme === 'im'
        ? 'bg-[#007AFF] text-white'
        : 'bg-[#0099FF] text-white';

  /** 圆角：微信 4px（用户指定微圆角）；QQ 12px；信息 18px。微信尾巴由 ::before 伪元素绘制（globals.css）。
   *  装扮接管（第十八轮）：微信语音气泡跟随装扮 —— 纯色/七彩保留原生尾巴（随 inline
   *  backgroundColor 经 background-color:inherit 自动同色），毛玻璃/液态胶囊隐藏尾巴。
   *  第六十四轮（用户指定「语音气泡也跟随气泡样式颜色变化」）：QQ/信息端装扮时同样
   *  剥离原生配色类（bg-white / dark:bg-[#2A2C31]）——底色/文字色全部交给装扮
   *  （inline backgroundColor 或 .bub-retro-qq 渐变类 / .bub-frosted / .bub-liquid）。
   *  关键动机：古早/液态主题的铭件接管 CSS（[data-rt-theme] .bg-white 等）带 !important，
   *  会盖掉对方语音气泡的装扮 inline 色（我方语音泡无 bg 类不受影响）——剥类后不再冲突 */
  /** 第六十九轮：默认（无装扮）语音泡挂语义锚点类（wx-bub-mine/theirs、qq-bub-mine/theirs）——
   *  聊天作用域的示例主题 CSS 靠它们把语音泡和文字泡一起整套换色（装扮泡/信息 App 不受影响） */
  const anchor = decorated || theme === 'im' ? '' : ` ${isWx ? 'wx' : 'qq'}-bub-${mine ? 'mine' : 'theirs'}`;
  const bubbleCls = isWx
    ? `wx-voice-bubble relative h-[42px] rounded-[4px] px-3 ${hideTail ? '' : mine ? 'wx-voice-tail-right' : 'wx-voice-tail-left'} ${
        decorated ? '' : mine ? t.own : t.peer
      }${isPlaying ? ' wx-voice-playing' : ''}${anchor}`
    : theme === 'im'
      ? `rounded-[18px] ${decorated ? '' : mine ? 'text-white' : t.peer}`
      : `rounded-[12px] ${decorated ? '' : mine ? 'text-white' : t.peer}${anchor}`;

  /** 胶囊装扮（毛玻璃/液态，第十八轮终版）：上下收窄（用户指定「上下变小一点」）——
   *  文本气泡由 bubbleVisual 直接压上下 padding；语音气泡高度固定（微信 42 / QQ 40），
   *  在此覆盖为 34px，与苗条文本胶囊同高 */
  const capsule = decorated && (style?.borderRadius as string | undefined) === '999px';

  return (
    <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <button
        type="button"
        data-testid="voice-bubble"
        data-voice-active={isPlaying ? 'true' : 'false'}
        aria-label={isPlaying ? '暂停语音' : '播放语音'}
        onClick={(e) => {
          e.stopPropagation();
          voicePlayer.toggle(msgId, voice.url, voice.localText, { synth: voice.synth, contactId: voice.contactId });
        }}
        className={`flex select-none items-center transition-transform active:scale-[0.98] ${bubbleCls ?? ''} ${bubbleClassName ?? ''} ${
          isWx
            ? /* 第八轮反馈：数字聚拢贴图标（真机同款），不再 justify-between 两端撑开 */
              `gap-[8px] ${mine ? 'justify-end' : 'justify-start'}`
            : 'h-[40px] gap-[4px] px-[6px]'
        }`}
        style={{ width, ...style, ...(capsule ? { height: '34px' } : undefined) }}
      >
        {isWx ? (
          /* 第十轮镜像重制（用户指定：我方气泡从左到右 = 时长 5″→ 圆弧 → 菱形，菱形贴右缘尾巴侧）：
             我方图标 scaleX(-1) 镜像（弧线在左、菱形在右），时长紧挨图标左（固定 8px 间距）；
             对方保持原字形（菱形在左、弧线在右），时长在图标右侧——两侧镜像对称，真机同款 */
          mine ? (
            <>
              <WxDuration label={label} />
              <WxVoiceIcon playing={isPlaying} mirrored />
            </>
          ) : (
            <>
              <WxVoiceIcon playing={isPlaying} />
              <WxDuration label={label} />
            </>
          )
        ) : (
          <>
            {/* 圆形播放钮（三角/暂停，与 QQ 一致） */}
            <span
              className={`grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full ${circleCls}`}
              aria-hidden="true"
            >
              {isPlaying ? (
                <Pause className="h-[9px] w-[9px]" fill="currentColor" strokeWidth={0} />
              ) : (
                <Play className="h-[9px] w-[9px] translate-x-[0.5px]" fill="currentColor" strokeWidth={0} />
              )}
            </span>
            {/* 实时录音波形条：随气泡宽度伸缩；播放中按进度点亮 */}
            <VoiceWaveBars wave={voice.wave} active={isActive} playing={isPlaying} progress={progress} count={bars} />
            {/* 时长固定显示在气泡右侧 */}
            <span className="shrink-0 text-[12.5px] leading-none tabular-nums">{label}</span>
          </>
        )}
      </button>
      {/* 转文字结果：识别中提示 / 已完成的结果（长按菜单「复制」可复制）。微信端为真机同款
          「气泡下方白色面板」——扁平纯白、大字号、无描边阴影，第 22 轮圆角改 4px 与语音气泡同规格
          （用户：白面板圆角和气泡一样大小）；QQ / 信息端维持此前的轻量小面板 */}
      {voice.stt === 'pending' && (
        <span className="mt-[3px] px-1 text-[12px] leading-[1.4] opacity-50" data-testid="voice-stt-pending">
          转文字中…
        </span>
      )}
      {voice.stt === 'done' && voice.transcript && (
        <span
          data-testid="voice-transcript"
          className={
            tvis?.override
              ? /* 装扮接管：与气泡同语言（染色面板/磨砂玻璃/液态玻璃）。第四十九轮：圆角跟随气泡样式
                   （inline borderRadius = tvis.radius——纯色/七彩与气泡同规格、毛玻璃/液态胶囊 999px），
                   不再统一硬编码 12px（用户：微信默认/七彩太圆，要与气泡圆角一样并随装扮变化） */
                `mt-[5px] w-fit max-w-full whitespace-pre-wrap break-words px-3.5 py-2.5 text-[13px] leading-[1.55] ${
                    isWx ? 'text-[15px]' : ''
                  } ${tvis.className}`
              : isWx
              ? `mt-[8px] w-fit max-w-full whitespace-pre-wrap break-words rounded-[4px] bg-white px-[14px] py-[10px] text-[16px] leading-[1.55] dark:bg-[#2C2C2C] ${
                  mine ? t.ownTranscript : t.peerTranscript
                }`
              : `mt-[5px] w-fit max-w-full whitespace-pre-wrap break-words rounded-[8px] bg-white px-[12px] py-[10px] text-[12.5px] leading-[1.55] shadow-[0_1px_4px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.05] dark:bg-[#2C2C2C] dark:ring-white/[0.07] ${
                  mine ? t.ownTranscript : t.peerTranscript
                }`
          }
          style={tvis?.override ? { borderRadius: tvis.radius, ...tvis.style } : undefined}
        >
          {voice.transcript}
        </span>
      )}
    </div>
  );
}
