'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock as ClockIcon,
  Delete,
  EyeOff,
  Info,
  Loader2,
  Mail,
  Mic,
  MicOff,
  Minus,
  MessageSquare,
  Pause,
  Phone as PhoneIcon,
  PhoneOff,
  Play,
  Plus,
  Search,
  Settings as SettingsIcon,
  Star,
  Trash2,
  UserPlus,
  UserRound,
  Users as UsersIcon,
  Video,
  Voicemail as VoicemailIcon,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import { AnonSwitchSheet, maskAnonPhone } from '@/components/ios/AnonSwitchSheet';
import {
  ACCOUNT_CHANGED_EVENT,
  deleteAccount,
  getActiveAccountFor,
  getActiveAccountIdFor,
  MAIN_ACCOUNT_ID,
  switchAccountFor,
  updateAccount,
  type PhoneAccount,
} from '@/lib/ios/accounts';
import { DefaultAvatar } from '@/components/apps/default-avatar';
import { IOSActionSheet } from '@/components/ios/ActionSheet';
import { isProactiveCallEnabled, setProactiveCallEnabled, getProactiveLevel, setProactiveLevel, type ProactiveLevel } from '@/lib/ios/proactive-call';
import { useSettings, useUI } from '@/lib/ios/store';
import { phoneBadge } from '@/lib/unread-store';
import { directChatStream } from '@/lib/ios/direct-api';
import { localDB, genId, formatDuration, type CallLogRecord, type VoicemailRecord } from '@/lib/ios/db';
// listContactsFor：按 App 投影联系人（phone 槽位优先，回退全局 avatar）——电话 App 内一律用它加载
// ownerRealNameFor/ownerProfileFor：按电话 App 当前账号取「我」的身份（多账号 v2：大号=机主，小号/匿名号=档案）
import { createContact, deleteContact as deleteContactLocal, listContactsFor, ownerProfileFor, ownerRealNameFor, updateContact } from '@/lib/ios/contacts-store';
import { buildNpcPromptExtra } from '@/lib/ios/npc-bond';
import { getMemSettings, memAddEventFragment, memAfterAiTurn, memConvoFromRaw, memRecallBlock, memSummarizeCallNow, setMemScopeForApp } from '@/lib/memory';
import { collectWbBlocks, wbRulesBlock, wbScanText } from '@/lib/ios/worldbook';
import { buildMomentsChatBlock } from '@/lib/moments';
import { getTimeAware, buildTimeAwareBlock } from '@/lib/time-aware';
import { expressStyleTtsSpeed, isTtsConfigured, speakUserTts, stopSpeaking } from '@/lib/ios/tts-client';
// 通话语音识别：Web Speech（浏览器原生实时识别）为主；第十六轮起兜底升级为 transcribeBlob
// 三级链（① SenseVoice 端侧 ② 用户配置的 OpenAI 兼容 STT ③ 内置 z-ai ASR 免配置）
import { transcribeBlob } from '@/lib/ios/cabin-voice';
import { startWebSpeechSession, type WebSpeechSession } from '@/lib/ios/web-speech';
import {
  startVad,
  AUTO_MAX_MS,
  AUTO_RETRY_DELAY_MS,
  AUTO_SILENCE_MS,
  AUTO_WAIT_MS,
  PROACTIVE_MAX_MS,
  PROACTIVE_MIN_MS,
  STT_FAIL_LIMIT,
  type VadHandle,
} from '@/lib/ios/vad';
import { chatCallExtraRules, HANGUP_MARK_RE } from '@/lib/ios/chat-call';
import { isPersonGoneEverywhere } from '@/lib/ios/friend-state';
import { requestAnswerDecision } from '@/lib/ios/call-decision';
import { requestCallFollowup } from '@/lib/ios/call-followup';
import { callOutcomeOf } from '@/lib/ios/call-outcome';
import { buildCrossContextBlocks } from '@/lib/ios/cross-app-context';
import { startGlobalCall, useGlobalCall } from '@/lib/ios/global-call';
import { PENDING_PHONE_ANSWER_EVENT, takePendingPhoneAnswer, useIncomingCall } from '@/lib/ios/incoming-call';
import { loadBlock } from '@/lib/ios/block-state';
import { getReplyCount } from '@/lib/reply-count';
import { isFriendIn, withAvatarForApp, type ContactRecord } from '@/lib/contacts';

/**
 * 电话 App（iOS 电话风格）：
 * - 五个底部 tab（iOS 18 悬浮胶囊样式）：个人收藏 / 通话记录 / 通讯录 / 键盘 / 语音留言
 * - 导航栏：紧凑居中小标题与左侧「返回主屏幕」键同行对齐；键盘 tab 左上「主号」徽章 + 右上新建联系人钮
 * - 通讯录：右上「+」新建联系人（iOS 新建联系人界面：X/✓/大头像/添加照片/姓·名字·公司/手机，保存后自动加为好友）；
 *   点行进「联系人详情页」（大头像 + 信息/视频/电话/邮件操作钮 + 详细信息/语音留言胶囊分段 + 通话记录卡片 + 快捷编辑）；
 *   点「信息」跨 App 跳转到信息 App 对应会话（相当于添加好友，经 useUI.pendingChatContact）
 * - 拨号键盘：大圆键 + DTMF 按键音 + 号码分组显示 + 按号码匹配联系人；退格在呼叫钮右侧
 * - 陌生号码拨打：运营商播报「您拨打的号码是空号」后自动挂断，只留一条「空号」通话记录（无留言）
 * - 语音留言：列表只显示联系人/类型/时长（不剧透内容），点行进详情页回看完整谈话内容；
 *   拨号中挂断（对方未接听）自动生成对端留言；已接通挂断自动存档整通对话内容（kind='call'，永久保存），
 *   TTS 播报 / 已读未读 / 删除，未读数红点角标
 * - 通话全屏层（电话界面·默认）：深色渐变 + 大头像/名字居中 + 单句弹幕字幕（纯文字样式无气泡背景，
 *   与微信/QQ 通话字幕同款：同一时刻只显示 AI 最新一句、我方说话不上屏，超高内部滚动不会被底部按钮遮挡）
 *   + 右上角信息按钮 + 六宫格控制（静音/键盘/扬声器…，聊天界面时收起）+ 红色挂断
 * - 电话聊天界面（点右上角信息按钮进入，无需挂断）：全程对话记录以聊天气泡呈现——对方白色气泡在左/
 *   我方绿色气泡在右，语音轮次带声波小标，点开立即可见（语音说的+打字的全部轮次，点开即显示）
 *   + 底部输入条；退出回到单句弹幕；挂断后整通对话另落语音留言存档（聊天界面样式回看）
 * - 通话界面名字显示：只有「电话联系人」（机主本人/已加好友，通讯录里会出现的人）显示名字+头像；
 *   没加进电话的联系人一律显示电话号码（陌生号语义，iOS 一致）
 * - AI 语音通话：免提全自动——接通后 AI 先开口，说完自动开始聆听（无需点任何按钮），说完停顿自动发送
 *   → Web Speech API（浏览器原生实时识别，与录音并行共用麦克风）→ /api/phone/turn（统一使用设置 App
 *   「API 设置」里配置的模型，按联系人人设回应；公网由服务器转发、内网自动浏览器直连）
 *   → /api/phone/tts 合成语音播放；内置识别模型已移除（设置里配置了 OpenAI 兼容 STT 时才走服务端兜底）；
 *   麦克风不可用/识别失败自动切换键盘文字输入
 * - 通话中文字聊天：右上角信息按钮开关——进入/退出电话聊天界面（全程对话记录气泡+输入条，弹幕暂停）；
 *   AI 回复文字进消息区同时用角色音色播报（Task 33：配置了声音——内置语音恒可用——打字回复也出声）
 *   开启期间暂停免提聆听
 * - 音效：呼叫等待回铃音（450Hz 中国铃流节奏）、接通提示音、挂断提示音，全部 WebAudio 合成
 * - 通话方向：turn 请求带 direction（AI 来电接听交接='in' / 用户主动拨打='out'，缺省 'out'），
 *   接通问候语按方向区分主被动视角；挂断续聊 endReason 传真实挂断方
 *   （AI 主动挂断〔挂断〕标记='ai-hangup' / 用户手动挂断='hangup'）
 * - 卸载守卫：通话中切 App/锁屏导致 CallScreen 随 App 卸载时，若通话仍在进行（未 ended）自动
 *   走与「用户点挂断」完全相同的收尾（通话卡片+AI 续聊+记忆总结+对话存档），不再静默消失
 * - 通话记录持久化 IndexedDB call-logs（DB v3），语音留言持久化 voicemails（DB v4），个人收藏持久化 settings key=phoneFavorites
 */

type PhoneTab = 'favorites' | 'recents' | 'contacts' | 'keypad' | 'voicemail';

interface CallTarget {
  number: string;
  contact: ContactRecord | null;
  /** 来电方向：'in' = AI 打来的电话（跳过拨号，进入即接通，AI 先开口）；缺省 'out' = 机主拨出 */
  direction?: 'out' | 'in';
  /** AI 主动来电目的（Task 40-b 预留：全局来电层写入 pending.proactiveContext，接听后经
   *  consumePendingAnswer 透传；非空时随该通电话所有 turn payload 注入【来电目的】段） */
  proactiveContext?: string;
}

interface CallBubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** 字幕产生时间（epoch ms）—— 时间感知用它计算通话内的说话间隔 */
  t: number;
  /** 轮次渠道：'text' = 通话中文字聊天（消息区呈现）；undefined = 语音轮次（字幕呈现） */
  via?: 'text';
}

const KEYS: { digit: string; letters: string }[] = [
  { digit: '1', letters: '' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: '' },
  { digit: '0', letters: '+' },
  { digit: '#', letters: '' },
];

/** DTMF 双音频频率表（ITU-T Q.23） */
const DTMF_FREQ: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};

const FAV_KEY = 'phoneFavorites';

/** fix3-D #40/#42：拉黑静默轮连续上限（与 chat-call.ts BLOCKED_SILENT_TURN_LIMIT 同阈值同口径）——
 *  拉黑期（byChar/byUser）免提开录循环/主动开口计时器每 3~7s 空转一次且通话永不结束，
 *  连续静默轮达该阈值自动挂断收尾（落正常结束记录、总结照常）；正常轮清零计数，正常通话不受影响 */
const BLOCKED_SILENT_TURN_LIMIT = 12;

/** ASR 对静音/噪声的典型无意义输出（纯符号，如 "#"、"…"）——过滤后按「没听清」处理（与 chat-call.ts 同款） */
const STT_NOISE_RE = /^[#\s*_\-.,!?~。？！，、…—·]+$/;

function stripDigits(s: string): string {
  return s.replace(/\D/g, '');
}

/** 号码显示分组：11 位手机号 3-4-4，其余原样 */
function formatNumber(raw: string): string {
  const d = stripDigits(raw);
  if (raw.startsWith('+') || raw.includes('+')) return raw;
  if (d.length === 11) return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
  if (d.length === 8) return `${d.slice(0, 4)} ${d.slice(4)}`;
  return raw;
}

/** 通话时长（秒）→ "1:23" / "0:05"（沿用全局 m:ss） */
function callDurationText(seconds: number): string {
  if (seconds <= 0) return '';
  return formatDuration(seconds);
}

/** 请求超时错误识别（#20）：AbortSignal.timeout 抛 DOMException TimeoutError，
 *  name 各浏览器一致优先判，message 兑底（Chromium「signal timed out」/Safari「The operation timed out.」） */
function isTimeoutError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'TimeoutError') return true;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /timeout|timed out/i.test(msg);
}

/** 日志时间：今天 HH:mm / 昨天 / 一周内周X / 跨年 YYYY/M/d / M月d日 */
function formatLogTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (days === 1) return '昨天';
  if (days < 7) return `周${'日一二三四五六'[d.getDay()]}`;
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 列表副标题：联系人/个人收藏等列表不显示类型（只显示关系/职业） */
function listSubtitle(c: ContactRecord): string {
  return c.relation?.trim() || c.occupation?.trim() || '';
}

/** 详情页副标题：只显示关系/职业（不显示 char/npc/user 类型字样） */
function detailSubtitle(c: ContactRecord): string {
  return listSubtitle(c);
}

/** 联系人性别 → TTS 声线（男 / 非男 / 未知） */
function contactGender(c: ContactRecord | null): 'male' | 'female' | null {
  if (!c?.gender) return null;
  return c.gender.includes('男') ? 'male' : 'female';
}

/** 未接通时对端转接语音信箱的留言内容（贴近联系人人设的口语化模板） */
function buildVoicemailText(c: ContactRecord | null): string {
  if (!c || c.kind === 'user') return '您好，您拨打的用户暂时无法接听，请在滴声后留言，再见。';
  const rel = c.relation?.trim() || c.occupation?.trim() || '';
  const who = rel || c.name;
  return `喂，是我呀，${who}。刚才没接到你电话，不好意思哈。有什么事就留言吧，我看到马上回你。`;
}

function AvatarBubble({ contact, size, className = '' }: { contact: ContactRecord | null; size: number; className?: string }) {
  if (contact?.avatar) {
    return (
      <span className={`inline-flex shrink-0 overflow-hidden rounded-full ${className}`} style={{ width: size, height: size }}>
        <img src={contact.avatar} alt={contact.name ? `${contact.name}的头像` : '头像'} className="h-full w-full object-cover" />
      </span>
    );
  }
  return <DefaultAvatar size={size} className={className} />;
}

// ---------------- 号码匹配（电话 ↔ 联系人联动） ----------------

/** 号码归一化：去非数字；13 位 86 开头去国码；12 位 0 开头去长途前缀（+86/空格/横线均可对上） */
function phoneKey(raw: string): string {
  let d = stripDigits(raw);
  if (d.length === 13 && d.startsWith('86')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('0')) d = d.slice(1);
  return d;
}

/** 按「联系人里填的电话」匹配出对应人 */
function findContactByNumber(contacts: ContactRecord[], raw: string): ContactRecord | null {
  const key = phoneKey(raw);
  if (!key) return null;
  return contacts.find((c) => c.phone && phoneKey(c.phone) === key) ?? null;
}

// ---------------- 拼音首字母分组（通讯录 A-Z 索引） ----------------

const PINYIN_COLLATOR = new Intl.Collator('zh-Hans-CN');
let pinyinSupported: boolean | null = null;

/**
 * 运行时探测 zh 排序是否按拼音（「一yī」应排在「起qǐ」之后；笔画排序则相反）。
 * 注意：部分 ICU 构建中汉字整体排在拉丁字母之前（compare('啊','z')<0），
 * 因此不能用「与字母比较」定位分组，须用下面一组汉字锚点两两比较。
 */
function chinesePinyinOK(): boolean {
  if (pinyinSupported === null) {
    try {
      pinyinSupported = PINYIN_COLLATOR.compare('啊', '八') < 0 && PINYIN_COLLATOR.compare('一', '起') > 0;
    } catch {
      pinyinSupported = false;
    }
  }
  return pinyinSupported;
}

/** 各字母的拼音锚点字（每个字读音唯一；跳过 I/U/V，与 iOS 中文索引一致） */
const LETTER_ANCHORS: [letter: string, anchor: string][] = [
  ['A', '啊'], ['B', '八'], ['C', '擦'], ['D', '搭'], ['E', '蛾'], ['F', '发'], ['G', '噶'],
  ['H', '哈'], ['J', '击'], ['K', '喀'], ['L', '垃'], ['M', '妈'], ['N', '拿'], ['O', '哦'],
  ['P', '啪'], ['Q', '期'], ['R', '然'], ['S', '撒'], ['T', '塌'], ['W', '挖'], ['X', '昔'],
  ['Y', '压'], ['Z', '匝'],
];

function sectionLetter(name: string): string {
  const c = (name || '?').trim().charAt(0);
  const up = c.toUpperCase();
  if (up >= 'A' && up <= 'Z') return up;
  if (!c || c.charCodeAt(0) < 0x2e80 || !chinesePinyinOK()) return '#';
  let letter = '#';
  for (const [l, anchor] of LETTER_ANCHORS) {
    if (PINYIN_COLLATOR.compare(name, anchor) >= 0) letter = l;
    else break;
  }
  return letter;
}

// ---------------- iOS 通用小组件（搜索框 / 分段控件 / 拨号键盘图标） ----------------

function IOSSearch({ value, onChange, placeholder = '搜索' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex h-[36px] items-center gap-1.5 rounded-[10px] bg-muted px-2.5">
      <Search className="h-[16px] w-[16px] shrink-0 text-muted-foreground/70" strokeWidth={2.2} aria-hidden="true" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/70"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="清空搜索"
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-muted-foreground/40 text-background"
        >
          <X className="h-3 w-3" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

function IOSSegmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex h-[32px] w-full rounded-[9px] bg-muted p-[2px]">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`flex-1 rounded-[7px] text-[13px] font-medium leading-none transition-colors ${
            value === o.key
              ? 'bg-background text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.12)]'
              : 'text-muted-foreground active:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** iOS 拨号键盘图标（3×3 圆点，与系统电话一致） */
function DialpadIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      {[5, 12, 19].map((y) =>
        [5, 12, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={2.1} />)
      )}
    </svg>
  );
}

// ---------------- WebAudio 音效（回铃音 / DTMF / 提示音） ----------------

let audioCtxSingleton: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtxSingleton) audioCtxSingleton = new Ctx();
    if (audioCtxSingleton.state === 'suspended') void audioCtxSingleton.resume();
    return audioCtxSingleton;
  } catch {
    return null;
  }
}

/** 播放一段单频正弦音（gain 包络防爆音） */
function playTone(freq: number, durationMs: number, volume = 0.05, delayMs = 0, freq2?: number): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime + delayMs / 1000;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
  gain.gain.setValueAtTime(volume, t0 + durationMs / 1000 - 0.03);
  gain.gain.linearRampToValueAtTime(0, t0 + durationMs / 1000);
  gain.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(gain);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000 + 0.05);
  if (freq2) {
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq2;
    osc2.connect(gain);
    osc2.start(t0);
    osc2.stop(t0 + durationMs / 1000 + 0.05);
  }
}

function playDtmf(key: string): void {
  const f = DTMF_FREQ[key];
  if (f) playTone(f[0], 140, 0.06, 0, f[1]);
}

/**
 * 呼叫等待回铃音：450Hz，响 1s 停 4s（中国铃流节奏），循环直到 stop。
 * 用 setInterval 每轮触发 1s 的 tone。
 */
class RingbackTone {
  private timer: number | null = null;
  start(): void {
    this.stop();
    playTone(450, 1000, 0.045);
    this.timer = window.setInterval(() => playTone(450, 1000, 0.045), 5000);
  }
  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/** 接通提示音（短双音上扬） */
function playConnectBlip(): void {
  playTone(600, 120, 0.05);
  playTone(900, 160, 0.05, 130);
}

/** 挂断提示音（短促降调） */
function playHangupBlip(): void {
  playTone(600, 180, 0.05);
  playTone(380, 240, 0.05, 190);
}

// ---------------- 录音 → 16kHz 单声道 WAV base64 ----------------

/** 本机选图 → canvas 居中裁剪压缩成 240px JPEG dataURL（与联系人 App 同款，控制入库体积） */
function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        const SIZE = 240;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('画布不可用'));
          return;
        }
        const scale = Math.max(SIZE / img.width, SIZE / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

// ---------------- 通话全屏层 ----------------

type CallPhase = 'dialing' | 'connected' | 'ended';
type PeerStatus = 'ringing' | 'thinking' | 'speaking' | 'listening';

function CallScreen({
  target,
  onEnd,
  onVoicemail,
  onClose,
}: {
  target: CallTarget;
  onEnd: (log: CallLogRecord) => void;
  onVoicemail: (vm: VoicemailRecord) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<CallPhase>('dialing');
  const [seconds, setSeconds] = useState(0);
  const [bubbles, setBubbles] = useState<CallBubble[]>([]);
  const [peerStatus, setPeerStatus] = useState<PeerStatus>('ringing');
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [dtmf, setDtmf] = useState('');
  const [textMode, setTextMode] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [vadSpeaking, setVadSpeaking] = useState(false); // VAD 检测到你正在说话
  const [busy, setBusy] = useState(false); // ASR/LLM/TTS 链路进行中
  const [error, setError] = useState('');
  /** 空号：拨打的号码不在联系人里，运营商播报「空号」后自动挂断 */
  const [emptyNumber, setEmptyNumber] = useState(false);

  const endedRef = useRef(false);
  const emptyRef = useRef(false);
  /** 文字聊天模式（信息图标开关）：回复标记用 ref（回调内读最新值，文字轮次标 via='text' 且同时照常播报） */
  const textModeRef = useRef(false);
  const ringRef = useRef<RingbackTone | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  /** Web Speech 实时识别会话（录音期间并行；onstop 收尾时 stop() 取整句文本/abort 丢弃） */
  const wsRef = useRef<WebSpeechSession | null>(null);
  const secondsRef = useRef(0);
  const phaseRef = useRef<CallPhase>('dialing');
  const bubblesRef = useRef<CallBubble[]>([]);
  const textListRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mutedRef = useRef(false);
  const busyRef = useRef(false);
  /** AI 主动挂断：告别语播完后自动结束（〔挂断〕标记） */
  const pendingHangupRef = useRef(false);
  /** AI 主动开口：聆听状态挂「用户一直不说话」计时器；触发后转 AI 独白轮 */
  const proactiveTimerRef = useRef<number | null>(null);
  /** 主动开口已触发（等 recorder onstop 丢弃静默录音后发起） */
  const proactivePendingRef = useRef(false);
  /** 连续主动开口计数（用户真正说话后归零） */
  const proactiveCountRef = useRef(0);
  /** fix3-D #42 连续静默轮计数（拉黑守卫命中的轮次累计，正常轮清零；达 BLOCKED_SILENT_TURN_LIMIT 自动挂断收尾） */
  const silentTurnCountRef = useRef(0);
  /** 跨 App 近况块 + 群聊近况块（Task 40-b）：每通电话懒构建一次缓存
   *  （CallScreen 实例 = 一通电话，挂断后卸载；【当前环境】行让 AI 知道「现在在电话里」） */
  const crossCtxRef = useRef<{ crossAppBlock: string; groupBlock: string } | null>(null);
  /** AI 拒接/未接：结束原因（状态区文案用） */
  const [peerEnded, setPeerEnded] = useState<'reject' | 'no-answer' | null>(null);
  /** 免提自动听（VAD 循环） */
  const vadRef = useRef<VadHandle | null>(null);
  const vadSpeakingRef = useRef(false);
  const discardRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const sttFailRef = useRef(0);
  /** 免提自动听调度（定义在 toggleRecording 之后，经 effect 同步进 ref 供上游回调调用） */
  const scheduleAutoListenRef = useRef<(delayMs?: number) => void>(() => {});
  const setCallActive = useUI((s) => s.setCallActive);
  // 设置 App「API 设置」里的 OpenAI 兼容接口配置（通话 AI 对话走该配置）
  const apiConfig = useSettings((s) => s.apiConfig);
  /** 机主名字（记忆提取视角统一用：碎片一律用真实名字指代用户；设置 › Apple 账户可改） */
  const profileName = useSettings((s) => s.profile.name);

  phaseRef.current = phase;
  bubblesRef.current = bubbles;
  textModeRef.current = textMode;

  const contact = target.contact;
  const isIncoming = target.direction === 'in';
  /** 陌生来电判定（多账号语义，用户规则：换号打过去 AI 不该认得你）：
   *  用户拨出（direction='out'）时——主号：AI 认得（机主来电）；小号：仅当联系人分账号关系
   *  （relationByAcc）登记过才认得（来电显示语义）；匿名号：AI 永远不认得。
   *  AI 主动来电（direction='in'）是 AI 打给它认识的联系人，不受影响（始终 false）。
   *  陌生来电时：机主身份/记忆/跨App近况/朋友圈/世界书/多端感知全部不下发（服务端人设同步换陌生框架） */
  const callerUnknown = useMemo(() => {
    if (isIncoming) return false;
    const acc = getActiveAccountFor('phone');
    if (acc.kind === 'main') return false;
    if (acc.kind === 'anon') return true;
    const scoped = contact?.relationByAcc?.[acc.id];
    return !(typeof scoped === 'string' && scoped.trim());
  }, [isIncoming, contact]);
  const gender = useMemo(() => contactGender(contact), [contact]);
  /** 最新 hangup（mount effect / speak / runTurn 闭包内引用；定义在后面，运行时已赋值）。
   *  可选 endReason：AI 主动挂断传 'ai-hangup'（挂断续聊按「自己告别收尾」注入，不再说「对方先挂」），
   *  用户手动挂断/卸载守卫不传（缺省 'hangup'） */
  const hangupRef = useRef<(endReason?: 'hangup' | 'ai-hangup') => void>(() => {});
  /** #49 runTurnRef：同步最新 runTurn，供 mount effect deps=[] 闭包读取最新版本
   *  （避免捕获初始 runTurn，其 deps 含 apiConfig，通话中改 API 设置后旧闭包仍用旧 config） */
  const runTurnRef = useRef<(userText: string | null, userVia?: 'text', opts?: { proactive?: boolean }) => Promise<void>>(
    async () => {},
  );

  /** 停 VAD + 清自动重听定时器 + 清主动开口计时器（挂断/静音/开文字条时用；不动 MediaRecorder——丢弃或发送由调用方决定） */
  const stopAutoTimers = useCallback(() => {
    vadRef.current?.stop();
    vadRef.current = null;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (proactiveTimerRef.current !== null) {
      window.clearTimeout(proactiveTimerRef.current);
      proactiveTimerRef.current = null;
    }
  }, []);

  /** TTS 播放一句：优先用户语音 API（设置 › 语音 API；音色 = 联系人独立 voiceId → 全局默认 → 安全默认），
   *  未配置/合成失败回退内置朗读（按性别挑声线）——字幕与文字流程不受影响。
   *  resume 里免提续听延迟 250ms：TTS 失败路径（play reject → catch）同步调 resume 时，
   *  runTurn 的 finally（busyRef=false）尚未执行，立即调度会被 busy 拦截导致免提循环断链 */
  const speak = useCallback(
    async (text: string) => {
      setPeerStatus('speaking');
      const volume = speaker ? 1 : 0.45;
      const resume = () => {
        if (!endedRef.current) {
          // AI 主动挂断：告别语播完自动结束通话（不再回到聆听）；endReason='ai-hangup'
          if (pendingHangupRef.current) {
            pendingHangupRef.current = false;
            hangupRef.current('ai-hangup');
            return;
          }
          setPeerStatus('listening');
          scheduleAutoListenRef.current(250); // AI 说完 → 自动开始听（免提循环核心）
        }
      };
      // ① 用户语音 API：每次播放实时重读联系人 voiceId（切联系人/改音色后下一句即生效）
      if (isTtsConfigured()) {
        try {
          await speakUserTts({
            text,
            contactId: contact?.id ?? null,
            volume,
            cancelled: () => endedRef.current,
            onEnd: resume,
          });
          resume(); // 正常播完 onEnd 已触发；被取消/打断时这里兕底回到听
          return;
        } catch {
          // 合成失败 → 回退内置朗读
        }
      }
      // ② 内置朗读（原有链路）
      try {
        stopSpeaking();
        // #20 通话链路超时看门狗：兜底合成 30s 到点必失败（catch 后回退内置朗读，文案不进 UI）
        const res = await fetch('/api/phone/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, gender, speed: expressStyleTtsSpeed(contact?.expressStyle) }), // B4 表达风格联动语速
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error('tts failed');
        const blob = await res.blob();
        if (endedRef.current) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = speaker ? 1 : 0.45;
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (audioRef.current === audio) audioRef.current = null;
          resume();
        };
        await audio.play().catch(() => {
          URL.revokeObjectURL(url);
          if (audioRef.current === audio) audioRef.current = null;
          resume();
        });
      } catch {
        resume();
        // Task 40：内置兜底合成也失败 → 通话界面字幕区提示（不再完全静默；电话通道有声才重要）
        setError('语音合成不可用，对方暂时无法出声');
      }
    },
    [contact?.id, gender, speaker]
  );

  /** 发起一轮 AI 对话（userText = 用户刚说的话；greeting = 接通问候；via='text' = 文字聊天轮次；
   *  proactive = AI 主动开口：用户一直不说话后的主动独白轮） */
  const runTurn = useCallback(
    async (userText: string | null, userVia?: 'text', opts?: { proactive?: boolean }) => {
      const proactive = opts?.proactive === true;
      setError('');
      if (userText) proactiveCountRef.current = 0; // 用户开口：主动连发计数归零
      // 自己的号码（user）：对方不说话、也不用回复 —— 发出去的话只留字幕
      if (contact?.kind === 'user') {
        if (userText) {
          setBubbles((b) => [...b, { id: genId(), role: 'user' as const, text: userText, t: Date.now(), via: userVia }]);
        }
        setPeerStatus('listening');
        return;
      }
      // fix3-D #40 电话自有引擎拉黑守卫（此前 runTurn/sendText 全程无 loadBlock，与 chat-call.ts #33② 口径不一致）：
      // byChar（角色拉黑用户）/ byUser（用户拉黑角色）→ 静默轮：不请求 LLM、不产生回复、不做逐轮记忆——
      // - 语音/接通问候/主动开口轮：用户语音照常进气泡（挂断后随转写进通话存档，等价 chat-call appendLog），
      //   回聆听并延时 250ms 续听（phase 刚切 connected 时 phaseRef 尚未同步，立即调度会被吞，对齐 #33②）；
      // - 文字轮（userVia==='text'）：byChar 与信息端 send / chat-call sendText 同口径拦截（提示不落转写）；
      //   byUser 文字照常进转写、AI 不回（等价单聊 runAiTurn byUser 静默取消分支）。
      // 解除拉黑后下一轮自然恢复应答；挂断总结照常沉淀真实通话内容（#33① 既有口径不动）。
      const blkEntry = contact?.id ? loadBlock('sms', contact.id) : null;
      const blockedByChar = blkEntry?.byChar === true;
      const blockedByUser = blkEntry?.byUser === true;
      if (blockedByChar || blockedByUser) {
        if (blockedByChar && userVia === 'text') {
          // G-3：电话与信息共用 sms 拉黑键，被角色拉黑后引导去信息 App 走「发送解除申请」
          //（信息端有完整申请卡闭环：submitUserBlockReq → AI [同意/拒绝解除拉黑] 决策）
          setError('对方已将你拉黑，无法发送（可前往信息 App 给 TA 发送解除申请）');
          return;
        }
        if (userText) {
          setBubbles((b) => [...b, { id: genId(), role: 'user' as const, text: userText, t: Date.now(), via: userVia }]);
        }
        // fix3-D #42 电话端同款连续静默轮计数：达阈值自动挂断收尾，防止拉黑期免提循环
        // 死寂空转到用户手动挂断；正常轮在下方清零，正常通话不受影响。
        // fix4 L15 对齐 chat-call 妥协点③口径：byUser 文字轮（sendText 进来的静默取消轮，
        // 等价 chat-call sendText byUser 早退——不计数也不清零）不计入静默/自动挂断计数，
        // 防拉黑期连发文字被误判死寂轮攒满阈值自动挂断；语音/接通问候/主动开口轮照常计数
        //（#42 防免提循环死寂空转的核心场景不变），busy 自清与正常清零路径不受影响
        if (!(blockedByUser && userVia === 'text')) {
          silentTurnCountRef.current += 1;
        }
        // 主动开口路径调用前已置 busy（onstop discard 分支），静默轮提前返回需自行清位
        //（对齐 runTurn finally 口径），否则 scheduleAutoListen 的 busy 检查会吞掉续听调度、免提循环断链
        busyRef.current = false;
        if (!endedRef.current) setBusy(false);
        if (silentTurnCountRef.current >= BLOCKED_SILENT_TURN_LIMIT && !endedRef.current) {
          finishByAiHangup(); // 落正常结束记录（endReason='ai-hangup'），总结在 hangup 内照常执行
          return;
        }
        setPeerStatus('listening');
        scheduleAutoListenRef.current(250);
        return;
      }
      silentTurnCountRef.current = 0; // fix3-D #42：正常轮（守卫放行）清零连续静默计数
      setPeerStatus('thinking');
      // AI 主动开口：递增连续主动计数（用户开口时归零）——第 3 次起 system 会提示可告别挂断
      let proactiveAttempt: number | undefined;
      if (proactive) {
        proactiveCountRef.current += 1;
        proactiveAttempt = proactiveCountRef.current;
      }
      const historyBefore: CallBubble[] = userText
        ? [...bubblesRef.current, { id: genId(), role: 'user' as const, text: userText, t: Date.now(), via: userVia }]
        : bubblesRef.current;
      if (userText) {
        setBubbles((b) => [...b, historyBefore[historyBefore.length - 1]]);
      }
      setBusy(true);
      busyRef.current = true;
      // 记忆库：本轮对话结束后的轮次计数与自动提取（后台异步，失败静默）；
      // 请求前先召回该联系人（互通开关范围）的记忆注入 system（服务端拼到人设后）；
      // 陌生来电不下发记忆（记忆属于机主/已建立身份，对面身份未知时注入会直接破功）
      const memoryBlock = !callerUnknown && contact?.id ? memRecallBlock(contact.id, 'phone', userText ?? '') : undefined;
      // 机主真实名字（动态块/世界书锚点共用一次解析）：动态块用它指代用户（AI 视角统一真名），
      // 取不到真名回退展示名（buildMomentsChatBlock 内部还有一层回退）
      const ownerRealForCall =
        !callerUnknown && contact?.id ? (await ownerRealNameFor('phone').catch(() => '')) || '' : '';
      // 社交动态感知（四）：互通开关打开时把朋友圈/QQ动态注入 system（电话无自有平台，关闭时不注入）；
      // 用户广播动态首次被看到时懒写入该角色记忆（动态 → 记忆双向打通）；陌生来电不下发（同上）；
      // userRealName=机主真名（标签/归属说明用真名称呼用户，与三端聊天同口径）
      const momentsBlock =
        !callerUnknown && contact?.id
          ? buildMomentsChatBlock({
              contactId: contact.id,
              app: 'phone',
              userName: profileName,
              userRealName: ownerRealForCall || undefined,
              peer: { id: contact.id, name: contact.name, nickname: contact.nickname ?? null },
            })
          : '';
      // 时间感知（按联系人独立开关，发送时现场读取；关闭时不注入）：
      // 上次聊天间隔 = 通话内上一条字幕时间戳；本轮是通话第一句时退回最近一次接通的通话记录时间；
      // 陌生来电不注入（「上次通话是x前」属于机主与该联系人的历史，对身份未知的来电人是泄露）
      const priorBubbles = bubblesRef.current;
      let lastChatTime: number | null = priorBubbles.length > 0 ? priorBubbles[priorBubbles.length - 1].t : null;
      if (!lastChatTime && contact?.id && !callerUnknown) {
        try {
          const logs = await localDB.getAll('call-logs');
          const last = logs
            .filter((l) => l.contactId === contact.id && l.duration > 0)
            .sort((a, b) => b.createdAt - a.createdAt)[0];
          lastChatTime = last?.createdAt ?? null;
        } catch {
          lastChatTime = null;
        }
      }
      const timeBlock =
        !callerUnknown && contact?.id && getTimeAware(`phone:${contact.id}`)
          ? buildTimeAwareBlock({ lastMsgTime: lastChatTime, regionHint: contact.region || null })
          : '';
      // 世界书注入通话（与文字聊天同一套 collectWbBlocks：全局常驻 + 局部/专属按触发词命中）：
      // 六个位置块 + 使用规则拼成一个块随人设注入（优先级：人设/世界设定 > 记忆）；
      // 陌生来电不下发（块的「你指谁」锚点与条目内容面向机主，会向陌生来电人泄露机主信息）
      // fix3-9 「你指谁」锚点：charName=角色名、userName=机主真名（回退 profileName），
      // 让每本书包裹块头部标明「文中的你/机主各指谁」（拿不到时不传，库内自动省略锚点行）
      const wbUserName = ownerRealForCall || profileName;
      const callWb =
        !callerUnknown && contact?.id
          ? collectWbBlocks(
              contact.id,
              wbScanText([
                userText,
                ...priorBubbles.slice(-6).map((b) => b.text),
              ]),
              { charName: contact.name, userName: wbUserName },
            )
          : null;
      const worldbookBlock = callWb
        ? (
            [
              callWb.beforeSystem,
              callWb.afterSystem,
              callWb.beforeChar,
              callWb.afterChar,
              callWb.beforeUser,
              callWb.afterUser,
              wbRulesBlock(callWb),
            ]
              .filter(Boolean)
              .join('\n\n') || undefined
          )
        : undefined;
      // 跨 App 近况块 + 群聊近况块（Task 40-b）：每通电话懒构建一次缓存。
      // 【当前环境】行让 AI 知道「现在在电话里」；其他 App 最近原始消息/共同群最近消息仅供衔接话题，
      // 按联系人现场读取（share 互通开关关闭时块内只保留当前环境行）；陌生来电不下发（内容是机主在其他 App 的消息）
      if (!crossCtxRef.current) {
        crossCtxRef.current =
          !callerUnknown && contact?.id
            ? await buildCrossContextBlocks(contact.id, 'phone', profileName)
            : { crossAppBlock: '', groupBlock: '' };
      }
      const memorizeTurn = (reply: string) => {
        if (!contact?.id) return;
        const turns = memConvoFromRaw(
          historyBefore.map((m) => ({ role: m.role, text: m.text })),
          ''
        );
        turns.push({ role: 'peer', text: reply });
        // names：双方真实名字（机主名取电话当前账号的「我」（多账号 v2），回退 Apple 账户名），提取/总结 prompt 视角统一用（禁「对方/用户/我」混用）；
        // 陌生来电的记忆写作用「陌生号码」指代来电人（记忆按当前账号作用域隔离，只在匿名号/小号侧可见，不会向机主侧泄露）
        void (callerUnknown
          ? Promise.resolve('陌生号码')
          : ownerRealNameFor('phone').catch(() => '')
        )
          .catch(() => '')
          .then((owner) =>
            memAfterAiTurn(
              contact.id,
              'phone',
              apiConfig,
              () => turns,
              // 电话通话无持久消息数组：memAfterAiTurn 内部按「1 条用户字幕 + 1 条 AI 回复」固定计数
              () => null,
              { user: owner || profileName, peer: contact.name },
              // fix3-11 记忆碎片补场景标记：电话语音通话的轮次提取 prompt 知道这是通话里说的
              { scene: '电话语音通话' }
            )
          );
      };
      try {
        // 配角圈注入（CHAR=认识的配角，NPC=归属者资料卡）+ 机主身份：全部联系人现场查一次（失败回退无注入/无身份）
        // 头像按 App 投影：电话通话链路读 phone 槽位（无槽位回退全局默认头像）
        const all = contact ? await listContactsFor('phone').catch(() => [] as ContactRecord[]) : [];
        // B8 作用域竞态修复：人设组装读碎片前先落位电话作用域
        setMemScopeForApp('phone');
        const npcExtra = contact ? buildNpcPromptExtra(contact, all) : null;
        // 本账号「我」的资料（多账号 v2）：主号取机主卡片（排除小号/匿名号档案），小号取本账号档案；
        // 陌生来电（匿名号/未登记小号拨出）不下发任何身份（AI 不知道对面是谁，报真名会直接破功）。
        // 此前这里 find(kind==='user') 可能误命中小号档案导致主号通话身份错位，一并修正
        const accForMe = getActiveAccountFor('phone');
        const meUser = callerUnknown
          ? null
          : accForMe.kind === 'main'
            ? (all.find((c) => c.kind === 'user' && !c.altOf) ?? null)
            : (all.find((c) => c.altOf === accForMe.id) ?? null);
        // #20 通话链路超时看门狗：LLM 轮次 45s 到点必失败（AbortSignal.timeout 抛 DOMException
        // TimeoutError）——上游卡住不再永远「正在思考」，catch 里已映射为友好中文
        const res = await fetch('/api/phone/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // 联系人资料由前端直传（本地 IndexedDB，服务端不查库）
            contact: contact
              ? {
                  name: contact.name,
                  kind: contact.kind,
                  gender: contact.gender,
                  age: contact.age,
                  height: contact.height,
                  weight: contact.weight,
                  occupation: contact.occupation,
                  company: contact.company,
                  region: contact.region,
                  relation: contact.relation,
                  relationByAcc: contact.relationByAcc ?? null,
                  relationToUser: contact.relationToUser ?? null,
                  birthday: contact.birthday ?? null,
                  persona: contact.persona,
                  background: contact.background,
                  expressStyle: contact.expressStyle ?? null,
                  customRules: contact.customRules ?? null,
                  nickname: contact.nickname ?? null,
                  realName: contact.realName ?? null,
                  ...(npcExtra ?? {}),
                }
              : undefined,
            // 机主称呼：只传真名（用户规则：AI 永远不知道机主昵称，userNickname 不再下传；陌生来电不下发）
            userRealName: meUser?.name?.trim() || undefined,
            // 多账号关系感知：小号通话读分账号关系（与机主资料同账号口径）
            accountId: getActiveAccountIdFor('phone'),
            // 陌生来电（多账号）：匿名号/未登记小号拨出——服务端人设换陌生框架、机主身份不下发
            callerUnknown: callerUnknown || undefined,
            number: target.number,
            // 通话方向（谁发起）：'in' = AI 打来的电话（AI 来电接听交接进来的，AI 主叫视角问候）/
            // 'out' = 用户在电话 App 里主动拨打（缺省）——服务端按方向区分接通问候语的主被动视角
            direction: isIncoming ? 'in' : 'out',
            // #80 仅首轮 greeting 注入 proactiveContext：首轮问候情境后，后续轮次靠 history 自带语境；
            // 之前每轮都注入会过度框定话题走向（重复「这通电话是你主动打来的，你想：X」）
            greeting: userText === null && !proactive,
            proactiveAttempt,
            history: historyBefore.map((m) => ({ role: m.role, content: m.text })),
            // 主动挂断标记规则（与微信/QQ 语音通话同一套）：AI 可按人设/上下文自然告别后输出〔挂断〕；
            // 语气按联系人关系动态生成（不再硬编码「很熟的朋友」）。
            // 陌生来电不传联系人：chatCallExtraRules 不再注入「你们的关系是{大号关系}」——
            // 关系描述属于机主/已建立身份，陌生来电注入会让 AI 把来电人当成「朋友」（谎称认识）
            extraRules: chatCallExtraRules(callerUnknown ? null : contact),
            memoryBlock,
            // 跨 App 近况 + 群聊近况（Task 40-b）：注入在当前 App 记忆之后（服务端同序拼装）
            crossAppBlock: crossCtxRef.current.crossAppBlock || undefined,
            groupBlock: crossCtxRef.current.groupBlock || undefined,
            // AI 主动来电目的（#80 仅首轮 greeting 注入；后续轮次不传，靠 history 自带语境）
            proactiveContext: userText === null && !proactive ? (target.proactiveContext || undefined) : undefined,
            // 跨 App 身份感知：互通开关（有联系人才注入；陌生号码单场景无需多端感知）
            multiApp: !callerUnknown && contact?.id ? getMemSettings(contact.id).share : undefined,
            // 社交动态块（前端按互通开关现场构建；服务端拼到人设+记忆之后）
            momentsBlock: momentsBlock || undefined,
            // 世界书块（与文字聊天同一套 collectWbBlocks；服务端拼到人设之后、记忆之前）
            worldbookBlock,
            // 时间感知块（前端按联系人开关现场构建；服务端拼到人设+记忆之后）
            timeBlock,
            // 设置 App「API 设置」的配置：服务端优先用它调用户自己的 API
            config: apiConfig,
          }),
          signal: AbortSignal.timeout(45000),
        });
        const data = (await res.json()) as {
          reply?: string;
          error?: string;
          directOnly?: boolean;
          messages?: { role: 'system' | 'user' | 'assistant'; content: string }[];
        };
        if (endedRef.current) return;
        // 内网 / 本机 API：云端服务器不可达 → 浏览器直连（与信息 App 一致），
        // 字幕随流式增量逐字上屏，完成后 TTS 播报
        if (res.ok && data.directOnly && Array.isArray(data.messages) && data.messages.length > 0) {
          const bubbleId = genId();
          setBubbles((b) => [...b, { id: bubbleId, role: 'assistant' as const, text: '', t: Date.now() }]);
          try {
            const full = await directChatStream(apiConfig, data.messages, (delta) => {
              setBubbles((b) =>
                b.map((x) => (x.id === bubbleId ? { ...x, text: x.text + delta } : x))
              );
            });
            if (endedRef.current) return;
            // AI 主动挂断：剥〔挂断〕标记，播完告别自动结束
            const rawFull = full
              .replace(/[*_`#>~[\]]/g, '')
              .replace(/^["'「『]+|["'」』]+$/g, '')
              .trim();
            const wantHangup = HANGUP_MARK_RE.test(rawFull);
            HANGUP_MARK_RE.lastIndex = 0;
            const reply = rawFull.replace(HANGUP_MARK_RE, '').trim();
            if (!reply) {
              setBubbles((b) => b.filter((x) => x.id !== bubbleId));
              if (wantHangup) {
                finishByAiHangup();
                return;
              }
              setError('对方没有回应，请稍后再试');
              setPeerStatus('listening');
              scheduleAutoListenRef.current(AUTO_RETRY_DELAY_MS); // 免提续听
              return;
            }
            // 回复一律播报（speak 内置引擎兜底，配了 API 用 API）；文字条开着时轮次标为 text
            //（消息区呈现文字，同时照常出声——配置了声音打字回复也要出声）
            setBubbles((b) => b.map((x) => (x.id === bubbleId ? { ...x, text: reply, via: textModeRef.current ? ('text' as const) : x.via } : x)));
            memorizeTurn(reply);
            if (wantHangup) pendingHangupRef.current = true; // 播完告别自动挂断（speak resume 检查）
            await speak(reply); // speak 内部播完自动续听（文字条开着时续听被拦截）
          } catch (err) {
            if (endedRef.current) return;
            setBubbles((b) => b.filter((x) => x.id !== bubbleId));
            // 超时（DOMException TimeoutError）映射成友好中文，英文原始错误不进字幕/提示
            setError(
              isTimeoutError(err)
                ? '请求超时，请检查网络或稍后再试'
                : err instanceof Error && err.message
                  ? err.message
                  : '对方信号不好，稍后再试',
            );
            setPeerStatus('listening');
            scheduleAutoListenRef.current(AUTO_RETRY_DELAY_MS); // 免提续听
          }
          return;
        }
        if (!res.ok || !data.reply) {
          setError(data.error || '对方信号不好，稍后再试');
          setPeerStatus('listening');
          scheduleAutoListenRef.current(AUTO_RETRY_DELAY_MS); // 免提续听
          return;
        }
        // AI 主动挂断：剥〔挂断〕标记，播完告别自动结束
        const wantHangup = HANGUP_MARK_RE.test(data.reply);
        HANGUP_MARK_RE.lastIndex = 0;
        const reply = data.reply.replace(HANGUP_MARK_RE, '').trim();
        if (!reply) {
          if (wantHangup) {
            finishByAiHangup();
            return;
          }
          setError('对方没有回应，请稍后再试');
          setPeerStatus('listening');
          scheduleAutoListenRef.current(AUTO_RETRY_DELAY_MS); // 免提续听
          return;
        }
        // 回复一律播报（speak 内置引擎兜底，配了 API 用 API）；文字条开着时轮次标为 text
        //（消息区呈现文字，同时照常出声——配置了声音打字回复也要出声）
        setBubbles((b) => [
          ...b,
          { id: genId(), role: 'assistant' as const, text: reply, t: Date.now(), ...(textModeRef.current ? { via: 'text' as const } : {}) },
        ]);
        memorizeTurn(reply);
        if (wantHangup) pendingHangupRef.current = true; // 播完告别自动挂断（speak resume 检查）
        await speak(reply); // speak 内部播完自动续听（文字条开着时续听被拦截）
      } catch (err) {
        if (!endedRef.current) {
          const msg = err instanceof Error && err.message ? err.message : '';
          setError(
            isTimeoutError(err)
              ? '请求超时，请检查网络或稍后再试'
              : /failed to fetch|networkerror|load failed/i.test(msg)
                ? '通话网络异常，请稍后再试'
                : msg || '通话网络异常，请稍后再试'
          );
          setPeerStatus('listening');
          scheduleAutoListenRef.current(AUTO_RETRY_DELAY_MS); // 免提续听
        }
      } finally {
        busyRef.current = false;
        if (!endedRef.current) setBusy(false);
      }
    },
    [contact, target.number, isIncoming, callerUnknown, speak, apiConfig, profileName]
  );
  // #49 同步最新 runTurn（mount effect deps=[] 闭包通过 ref 读最新版本，避免通话中改 API 设置后首轮问候仍用旧 apiConfig）
  runTurnRef.current = runTurn;

  // 挂断（保存记录 → ended → 回调关闭）。endReason：'hangup' = 用户手动挂断（缺省）/
  // 'ai-hangup' = AI 自己主动挂断（〔挂断〕标记/告别后自动结束）——挂断续聊按真实挂断方注入场景，
  // 只有「对方先挂」（'hangup'）才允许 AI 抱怨挂得快（Task 21 三态语义）
  const hangup = useCallback((endReason: 'hangup' | 'ai-hangup' = 'hangup') => {
    if (endedRef.current) return;
    endedRef.current = true;
    stopAutoTimers();
    ringRef.current?.stop();
    stopSpeaking();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    try {
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.stop();
      }
    } catch {
      // 已停止
    }
    wsRef.current?.abort();
    wsRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    playHangupBlip();
    const phaseAtEnd = phaseRef.current;
    const wasConnected = phaseAtEnd === 'connected';
    // 空号（号码不在联系人里）：只记一条「空号」记录，不产生任何语音留言；
    // 拨号中挂断 = 对方未接听 → 对端「转接语音信箱」，自动生成一条语音留言；
    // 已接通挂断 → 把整通电话的对话内容存进语音留言（永久保存，可随时回听回看）
    const isEmpty = emptyRef.current;
    const unanswered = phaseAtEnd === 'dialing' && !isEmpty;
    const vmText = unanswered ? buildVoicemailText(contact) : '';
    // #54 接通后 0 气泡（用户秒挂）也要至少落一条 kind='call' 存档留言，与 followup 留言区分。
    // 原逻辑仅在 transcript 非空时才落 kind='call'，接通后 0 气泡只靠 followup 写 N 条 kind='voicemail'，
    // 通话记录里缺一条「这通电话接通过」的存档占位。
    const transcript =
      !unanswered && bubblesRef.current.length > 0
        ? bubblesRef.current
            .map((b) => `${b.role === 'user' ? '我' : contact?.name || '对方'}：${b.text}`)
            .join('\n')
        : '';
    const callArchiveText = transcript || (wasConnected && contact?.id ? '（通话刚接通即结束，没有对话内容）' : '');
    setPhase('ended');
    setPeerStatus('listening');
    setRecording(false);
    // 通话结束自动总结 + 挂断续聊（三端共用逻辑，挂断即触发）：
    // AI 续聊文字紧随挂断生成（人设+通话内容+记忆+世界书+时间感知），以「语音留言」呈现
    // （电话 App 无聊天面板，与拒接解释同机制）；文字并入转写后一次提取「通话内容+续聊」
    // 沉淀记忆（同池互通、按联系人隔离）；全程失败静默——绝不阻塞挂断收尾。
    // 机主自己（kind='user'）/没接通的不参与。
    if (contact?.id && contact.kind !== 'user' && wasConnected) {
      const peerContact = contact;
      void (async () => {
        let followupTexts: string[] = [];
        // #33 拉黑口径（对齐 proactive-call.ts recordMissedPhoneCall 的 byUser 抑制）：用户在「信息」
        // App 拉黑了该角色 → 挂断续聊不请求、AI 留言一条不写（followupTexts 保持空 = 下方留言循环
        // 零执行、续聊文字不并入转写），避免「已拉黑还给我留言」的体验断裂；通话记录/对话存档照常落，
        // 记忆总结照常（下方，沉淀真实发生过的通话内容，与短信端 byUser 回合仍走 memAfterAiTurn 同口径）
        const smsBlockedByUser = loadBlock('sms', peerContact.id).byUser === true;
        try {
          if (!smsBlockedByUser) {
            const spoken = bubblesRef.current.filter((b) => b.text.trim());
            const lastUser = [...spoken].reverse().find((b) => b.role === 'user')?.text ?? null;
            // 陌生来电不下发机主身份/记忆/跨App近况/世界书/多端感知（AI 不知道来电人是谁，报真名会直接破功）
            const owner = callerUnknown ? null : await ownerProfileFor('phone').catch(() => null);
            // #15 跨 App 近况块 + 群聊近况块：通话内已建则复用缓存；从未发过 turn 的短通话现算一次
            // （crossCtxRef 在 runTurn 已构建，但挂断续聊是 hangup 路径独立读取，未构建时现算兑底）
            if (!crossCtxRef.current) {
              crossCtxRef.current =
                !callerUnknown && peerContact.id
                  ? await buildCrossContextBlocks(peerContact.id, 'phone', owner?.realName || profileName)
                  : { crossAppBlock: '', groupBlock: '' };
            }
            const wb = callerUnknown
              ? null
              : collectWbBlocks(
                  peerContact.id,
                  wbScanText([lastUser, ...spoken.slice(-6).map((b) => b.text)]),
                  // fix3-9 「你指谁」锚点：charName=角色名、userName=机主真名（ownerProfile 回退 profileName）
                  { charName: peerContact.name, userName: owner?.realName || profileName },
                );
            followupTexts = await requestCallFollowup({
              contact: {
                name: peerContact.name,
                kind: peerContact.kind,
                gender: peerContact.gender,
                age: peerContact.age,
                occupation: peerContact.occupation,
                region: peerContact.region,
                relation: peerContact.relation,
                relationToUser: peerContact.relationToUser ?? null,
                birthday: peerContact.birthday ?? null,
                persona: peerContact.persona,
                background: peerContact.background,
                expressStyle: peerContact.expressStyle ?? null,
                customRules: peerContact.customRules ?? null,
                nickname: peerContact.nickname ?? null,
                realName: peerContact.realName ?? null,
              },
              direction: isIncoming ? 'in' : 'out',
              // 真实挂断方：'ai-hangup' = AI 自己主动挂断（告别收尾）/'hangup' = 用户手动挂断（对方先挂）
              endReason,
              connected: true,
              duration: secondsRef.current,
              transcript: spoken.slice(-24).map((b) => ({ role: b.role, content: b.text })),
              recentChat: [],
              memoryBlock: !callerUnknown ? (memRecallBlock(peerContact.id, 'phone', lastUser ?? '') || undefined) : undefined,
              // #15 跨 App 近况 + 群聊近况（Task 40-b）：与通话轮次同源同位置（当前 App 记忆之后）；陌生来电不下发
              crossAppBlock: crossCtxRef.current.crossAppBlock || undefined,
              groupBlock: crossCtxRef.current.groupBlock || undefined,
              worldbookBlock: callerUnknown
                ? undefined
                : (
                    [
                      wb?.beforeSystem,
                      wb?.afterSystem,
                      wb?.beforeChar,
                      wb?.afterChar,
                      wb?.beforeUser,
                      wb?.afterUser,
                      wb ? wbRulesBlock(wb) : '',
                    ]
                      .filter(Boolean)
                      .join('\n\n') || undefined
                  ),
              timeBlock: getTimeAware(`phone:${peerContact.id}`)
                ? buildTimeAwareBlock({ lastMsgTime: null, regionHint: peerContact.region || null })
                : '',
              // #15 多端互通开关（与 chat-call.ts:512 同位路径同源）：续聊也感知跨 App 身份；陌生来电不下发
              multiApp: callerUnknown ? undefined : getMemSettings(peerContact.id).share,
              // 条数上限 = 该联系人「信息」会话聊天设置里的回复条数（sms:c:<id>，与信息 App 同一份数据，
              // 未设置走全局 DEFAULT_REPLY_COUNT=5）；上限不是任务，没话可以少发
              replyCount: getReplyCount(`sms:c:${peerContact.id}`),
              // 机主称呼：只传真名（用户规则：AI 永远不知道机主昵称，userNickname 不再下传）
              userRealName: owner?.realName || undefined,
              // 陌生来电（多账号）：续聊按「刚接到陌生电话」框架
              callerUnknown: callerUnknown || undefined,
            });
          }
        } catch {
          followupTexts = []; // 续聊失败静默：不影响记忆总结
        }
        // 续聊文字以「语音留言」呈现（未读红点+可回看；屏幕已关也不影响——onVoicemail 直写 IndexedDB）
        for (const t of followupTexts) {
          onVoicemail({
            id: genId(),
            number: target.number,
            contactId: peerContact.id,
            displayName: peerContact.name,
            peerKind: peerContact.kind as VoicemailRecord['peerKind'],
            avatar: peerContact.avatar ?? null,
            text: t,
            duration: Math.max(3, Math.ceil(t.length / 3.2)),
            read: false,
            createdAt: Date.now(),
          });
        }
        const convo = bubblesRef.current
          .filter((b) => b.text.trim())
          .map((b): { role: 'me' | 'peer'; text: string } => ({ role: b.role === 'user' ? 'me' : 'peer', text: b.text }));
        for (const t of followupTexts) convo.push({ role: 'peer', text: t }); // 续聊文字随转写一同沉淀（互通）
        if (convo.length >= 2) {
          // 陌生来电的记忆总结用「陌生号码」指代来电人（按当前账号作用域隔离，不向机主侧泄露）
          void (callerUnknown
            ? Promise.resolve('陌生号码')
            : ownerRealNameFor('phone').catch(() => '')
          )
            .catch(() => '')
            .then((owner) =>
              memSummarizeCallNow(
                peerContact.id,
                'phone',
                apiConfig,
                convo,
                {
                  user: owner || profileName,
                  peer: peerContact.name,
                },
                // fix3-11 通话总结补方向（机主手机视角）：'in'=AI 拨入被接听 / 'out'=机主拨出，
                // 总结 prompt 才能写清「谁打给谁的一通电话」
                { direction: isIncoming ? 'in' : 'out' }
              )
            );
        }
      })();
    }
    onEnd({
      id: genId(),
      number: target.number,
      contactId: contact?.id ?? null,
      displayName: isEmpty ? '空号' : (contact?.name ?? '陌生号码'),
      peerKind: contact ? (contact.kind as CallLogRecord['peerKind']) : 'unknown',
      avatar: contact?.avatar ?? null,
      direction: isIncoming ? 'in' : 'out',
      duration: wasConnected ? secondsRef.current : 0,
      // #27 三态记录：真实挂断原因随记录落盘（渲染端按 callOutcomeOf 分三态展示）——
      // 拨号中挂断（含空号播报后自动挂断，未接通）= 'cancel'（已取消，不算未接来电）；
      // 接通后挂断按真实挂断方：'hangup' = 用户手动 / 'ai-hangup' = AI 主动告别挂断
      endReason: wasConnected ? endReason : 'cancel',
      createdAt: Date.now(),
    });
    if (unanswered) {
      // fix4 M9 拉黑守卫（对齐 chat.tsx:380 / proactive-call.ts:376 的 AI 留言 byUser 抑制）：
      // 用户拉黑了该角色（byUser）→ 拨号中挂断的「转接语音信箱」AI 留言不落库、不写记忆——
      // 避免「已拉黑还收到对方留言」的体验断裂；未接通话记录照常落（上方 onEnd），
      // 接通后的对话存档（transcript/callArchiveText 分支）属事实存档不受影响
      const vmBlockedByUser = contact?.id ? loadBlock('sms', contact.id).byUser === true : false;
      if (!vmBlockedByUser) {
        onVoicemail({
          id: genId(),
          number: target.number,
          contactId: contact?.id ?? null,
          displayName: contact?.name ?? '陌生号码',
          peerKind: contact ? (contact.kind as VoicemailRecord['peerKind']) : 'unknown',
          avatar: contact?.avatar ?? null,
          text: vmText,
          duration: Math.max(3, Math.ceil(vmText.length / 3.2)),
          read: false,
          createdAt: Date.now(),
        });
      }
    } else if (transcript) {
      onVoicemail({
        id: genId(),
        number: target.number,
        contactId: contact?.id ?? null,
        displayName: contact?.name ?? '陌生号码',
        peerKind: contact ? (contact.kind as VoicemailRecord['peerKind']) : 'unknown',
        avatar: contact?.avatar ?? null,
        text: transcript,
        duration: secondsRef.current,
        read: true,
        createdAt: Date.now(),
        kind: 'call',
      });
    } else if (callArchiveText) {
      // #54 接通后 0 气泡（用户秒挂）至少落一条 kind='call' 占位，与 followup 留言区分
      onVoicemail({
        id: genId(),
        number: target.number,
        contactId: contact?.id ?? null,
        displayName: contact?.name ?? '陌生号码',
        peerKind: contact ? (contact.kind as VoicemailRecord['peerKind']) : 'unknown',
        avatar: contact?.avatar ?? null,
        text: callArchiveText,
        duration: secondsRef.current,
        read: true,
        createdAt: Date.now(),
        kind: 'call',
      });
    }
    window.setTimeout(onClose, 1100);
  }, [contact, target.number, isIncoming, callerUnknown, onEnd, onVoicemail, onClose, stopAutoTimers, apiConfig, profileName]);
  hangupRef.current = hangup;

  /** AI 主动挂断（〔挂断〕标记）：与用户挂断同一套收尾（总结/落记录/对话存档），只是触发方是对端；
   *  endReason='ai-hangup'：挂断续聊按「AI 自己告别收尾」注入（不说「对方先挂/挂得快」） */
  const finishByAiHangup = useCallback(() => {
    if (endedRef.current) return;
    hangupRef.current('ai-hangup');
  }, []);

  /** AI 拒接/未接收尾（接听决策）：响铃停止 → 显示原因 → 落「未接通」通话记录 → AI 语音留言解释。
   *  与用户挂断不同：未接通、无对话、不触发记忆总结；afterText 来自决策（人设化解释），缺省用模板留言 */
  const endByPeer = useCallback(
    (reason: 'reject' | 'no-answer', afterText?: string) => {
      if (endedRef.current) return;
      endedRef.current = true;
      ringRef.current?.stop();
      stopAutoTimers();
      setPeerEnded(reason);
      setPhase('ended');
      setPeerStatus('listening');
      onEnd({
        id: genId(),
        number: target.number,
        contactId: contact?.id ?? null,
        displayName: contact?.name ?? '陌生号码',
        peerKind: contact ? (contact.kind as CallLogRecord['peerKind']) : 'unknown',
        avatar: contact?.avatar ?? null,
        direction: 'out',
        duration: 0,
        // #27 三态记录：'reject' = 对方拒接 / 'no-answer' = 响铃超时无人接（与 call-outcome.ts 取值一致）
        endReason: reason,
        createdAt: Date.now(),
      });
      // fix4 M9 拉黑守卫（对齐 chat.tsx:380 / proactive-call.ts:376 的 AI 留言 byUser 抑制）：
      // 用户拉黑了该角色（byUser）→ 拒接/未接的 AI 解释留言不落库——通话记录照常落（上方 onEnd），
      // 避免「已拉黑还收到对方留言」的体验断裂；与 hangup 内 #33 守卫（byUser 跳过挂断续聊留言）
      // 同口径。留言来源 = 接听决策 afterText（requestCallFollowup 链路），同属 AI 生成的留言内容
      if (!(contact?.id && loadBlock('sms', contact.id).byUser)) {
        const text = afterText?.trim() || buildVoicemailText(contact);
        onVoicemail({
          id: genId(),
          number: target.number,
          contactId: contact?.id ?? null,
          displayName: contact?.name ?? '陌生号码',
          peerKind: contact ? (contact.kind as VoicemailRecord['peerKind']) : 'unknown',
          avatar: contact?.avatar ?? null,
          text,
          duration: Math.max(3, Math.ceil(text.length / 3.2)),
          read: false,
          createdAt: Date.now(),
        });
      }
      // fix3-3 拒接/未接零记忆修复：通话记录与留言都进不了轮次提取/挂断总结（没接通、无对话），
      // 事件真实发生（AI 接听决策拒接/未接听机主的来电）→ 直写一条事件碎片进记忆库；
      // 归属句式写明「谁（AI角色本人）+ 何时 + 对谁（机主）做了什么」，AI 之后能想起这通没接的电话；
      // 守卫：仅真实联系人（非临时会话）时写；「之后留言解释」后缀只在留言真的落库时才写
      // （byUser 拉黑时留言被上面的守卫抑制，记忆不能说成已留言）；失败静默
      if (contact?.id) {
        const voicemailLanded = !loadBlock('sms', contact.id).byUser;
        const peerContact = contact;
        const aiName = peerContact.name?.trim() || '对方';
        const d = new Date();
        const when = `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const afterSuffix = voicemailLanded && afterText?.trim() ? `，之后留言解释：「${afterText.trim()}」` : '';
        void (callerUnknown
          ? Promise.resolve('陌生号码')
          : ownerRealNameFor('phone').catch(() => '')
        )
          .catch(() => '')
          .then((owner) => {
            // 机主名：联系人 App「机主」卡片真名 → 设置 profile 名 → 「机主」（与 memorizeTurn 同口径）；
            // 陌生来电不写机主名（写「陌生号码」：角色记忆里只留「拒接了一通陌生来电」，不向记忆链路泄露机主身份）
            const ownerLabel = callerUnknown ? '陌生号码' : owner || profileName || '机主';
            const content =
              reason === 'reject'
                ? `${aiName}（AI角色本人）于${when}拒接了${ownerLabel}打来的电话${afterSuffix}`
                : `${aiName}（AI角色本人）于${when}未接听${ownerLabel}打来的电话${afterSuffix}`;
            try {
              memAddEventFragment(peerContact.id, 'phone', content, { eventTime: Date.now() });
            } catch {
              // 记忆直写失败静默（事件碎片是增强能力，不影响通话收尾）
            }
          });
      }
      window.setTimeout(onClose, 1400);
    },
    [contact, target.number, callerUnknown, onEnd, onVoicemail, onClose, stopAutoTimers, profileName],
  );
  /** mount effect 闭包内引用最新 endByPeer */
  const endByPeerRef = useRef(endByPeer);
  endByPeerRef.current = endByPeer;

  // 挂载：白前景标记 + 回铃音；联系人 → AI 接听决策（接听·拒绝·不接）→ 接通问候；
  // 陌生号码 → 运营商播报「空号」后自动挂断；
  // AI 打来的电话（direction='in'）：接听动作已发生在全局来电层，进入这里即已接通——
  // 跳过拨号回铃/接听决策/空号流程，接通音 + AI 先开口（与拨出接通同一 runTurn(null) greeting 链路）
  useEffect(() => {
    setCallActive(true);
    endedRef.current = false;
    emptyRef.current = false;
    if (isIncoming) {
      playConnectBlip();
      setPhase('connected');
      secondsRef.current = 0;
      setSeconds(0);
      if (contact && contact.kind !== 'user') void runTurnRef.current(null);
      else setPeerStatus('listening');
      return () => {
        // 卸载守卫（切 App/锁屏时本组件随 App 卸载）：通话仍在进行（未 ended）→
        // 走与「用户点挂断按钮」完全相同的收尾（通话卡片+AI 续聊+记忆总结+对话存档），
        // 像用户自己挂断了电话而不是静默消失；endedRef 幂等（正常挂断已收尾则跳过）
        if (!endedRef.current) hangupRef.current();
        endedRef.current = true;
        stopAutoTimers();
        stopSpeaking();
        streamRef.current?.getTracks().forEach((t) => t.stop());
        setCallActive(false);
      };
    }
    const ring = new RingbackTone();
    ring.start();
    ringRef.current = ring;
    let fallbackTimer: number | undefined;
    let peerTimer: number | undefined;
    // 空号：响铃约 2.4~3.2s → TTS 播报「您拨打的号码是空号」→ 播完自动挂断
    const emptyTimer = contact
      ? undefined
      : window.setTimeout(
          () => {
            if (endedRef.current) return;
            ring.stop();
            emptyRef.current = true;
            setEmptyNumber(true);
            void (async () => {
              try {
                // #20 通话链路超时看门狗：空号播报合成 30s 到点必失败（catch 走自动挂断兑底，文案不进 UI）
                const res = await fetch('/api/phone/tts', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: '您好，您拨打的号码是空号，请查证后再拨。', gender: null }),
                  signal: AbortSignal.timeout(30000),
                });
                if (!res.ok || endedRef.current) throw new Error('tts failed');
                const blob = await res.blob();
                if (endedRef.current) return;
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                audioRef.current = audio;
                audio.onended = () => {
                  URL.revokeObjectURL(url);
                  if (audioRef.current === audio) audioRef.current = null;
                  if (!endedRef.current) hangupRef.current();
                };
                await audio.play().catch(() => {
                  URL.revokeObjectURL(url);
                  if (audioRef.current === audio) audioRef.current = null;
                  if (!endedRef.current) hangupRef.current();
                });
              } catch {
                if (!endedRef.current) fallbackTimer = window.setTimeout(() => hangupRef.current(), 2400);
              }
            })();
          },
          2300 + Math.random() * 900
        );
    // AI 接听决策：响铃开始就发（人设/关系/当前时间状态 → 接听/拒绝/不接），
    // 失败或超时兜底 answer；机主打给自己（kind='user'）/陌生号码不决策。
    // 陌生来电（多账号：匿名号/未登记小号拨出）：AI 不知道来电人是谁——机主身份不下发、按陌生来电决策
    const decision =
      contact && contact.kind !== 'user'
        ? (
            callerUnknown
              ? requestAnswerDecision({
                  number: target.number,
                  contact: {
                    name: contact.name,
                    kind: contact.kind,
                    gender: contact.gender,
                    age: contact.age,
                    height: contact.height,
                    weight: contact.weight,
                    occupation: contact.occupation,
                    company: contact.company,
                    region: contact.region,
                    relation: contact.relation,
                    relationByAcc: contact.relationByAcc ?? null,
                    relationToUser: contact.relationToUser ?? null,
                    birthday: contact.birthday ?? null,
                    persona: contact.persona,
                    background: contact.background,
                    expressStyle: contact.expressStyle ?? null,
                    customRules: contact.customRules ?? null,
                    nickname: contact.nickname ?? null,
                    realName: contact.realName ?? null,
                  },
                  recentChat: [],
                  timeBlock: contact.id && getTimeAware(`phone:${contact.id}`)
                    ? buildTimeAwareBlock({ lastMsgTime: null, regionHint: contact.region || null })
                    : '',
                  // 陌生来电：机主身份不下发，按陌生来电决策
                  callerUnknown: true,
                  accountId: getActiveAccountIdFor('phone'),
                  config: apiConfig,
                })
              : ownerProfileFor('phone').then((owner) =>
                  requestAnswerDecision({
                    number: target.number,
                    contact: {
                      name: contact.name,
                      kind: contact.kind,
                      gender: contact.gender,
                      age: contact.age,
                      height: contact.height,
                      weight: contact.weight,
                      occupation: contact.occupation,
                      company: contact.company,
                      region: contact.region,
                      relation: contact.relation,
                      relationByAcc: contact.relationByAcc ?? null,
                      relationToUser: contact.relationToUser ?? null,
                      birthday: contact.birthday ?? null,
                      persona: contact.persona,
                      background: contact.background,
                      expressStyle: contact.expressStyle ?? null,
                      customRules: contact.customRules ?? null,
                      nickname: contact.nickname ?? null,
                      realName: contact.realName ?? null,
                    },
                    recentChat: [],
                    timeBlock: contact.id && getTimeAware(`phone:${contact.id}`)
                      ? buildTimeAwareBlock({ lastMsgTime: null, regionHint: contact.region || null })
                      : '',
                    // 机主称呼：只传真名（用户规则：AI 永远不知道机主昵称，userNickname 不再下传）
                    userRealName: owner?.realName || undefined,
                    // 多账号关系感知：小号来电读分账号关系（与通话轮次同账号口径）
                    accountId: getActiveAccountIdFor('phone'),
                    config: apiConfig,
                  }),
                )
          ).catch(() => ({ decision: 'answer' }) as const)
        : null;
    const connect = () => {
      if (endedRef.current) return;
      ring.stop();
      playConnectBlip();
      setPhase('connected');
      secondsRef.current = 0;
      setSeconds(0);
      if (contact && contact.kind !== 'user') void runTurnRef.current(null);
      else setPeerStatus('listening');
    };
    // 联系人：响铃 1.4~2.6s 后应用决策（决策多半已返回；未返回则等它 settle）
    const timer = contact
      ? window.setTimeout(() => {
          void (async () => {
            if (endedRef.current) return;
            const d = decision ? await decision : ({ decision: 'answer' } as const);
            if (endedRef.current) return;
            if (contact.kind === 'user') {
              connect();
              return;
            }
            if (d.decision === 'reject') {
              // 对方拒绝：再响 0.8~1.6s 挂断（几声铃被挂断更真实），随后 AI 语音留言解释
              peerTimer = window.setTimeout(() => endByPeerRef.current('reject', d.afterText), 800 + Math.random() * 800);
            } else if (d.decision === 'miss') {
              // 对方不接：继续响 9~15s 转「无人接听」，随后 AI 语音留言解释
              peerTimer = window.setTimeout(() => endByPeerRef.current('no-answer', d.afterText), 9000 + Math.random() * 6000);
            } else {
              connect();
            }
          })();
        }, 1400 + Math.random() * 1200)
      : undefined;
    return () => {
      // 卸载守卫（切 App/锁屏时本组件随 App 卸载）：通话仍在进行（未 ended，含拨号中/接通后）→
      // 走与「用户点挂断按钮」完全相同的收尾（同 hangup：拨号中=取消+对端留言、接通后=卡片+续聊+总结）；
      // 用 ref 读最新通话状态（卸载时 state 闭包已过期）；endedRef 幂等，正常挂断/对端拒接不重复收尾
      if (!endedRef.current) hangupRef.current();
      endedRef.current = true;
      window.clearTimeout(timer);
      window.clearTimeout(emptyTimer);
      window.clearTimeout(peerTimer);
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      stopAutoTimers();
      wsRef.current?.abort();
      wsRef.current = null;
      ring.stop();
      stopSpeaking();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setCallActive(false);
    };
  }, []);

  // 接通后计时
  useEffect(() => {
    if (phase !== 'connected') return;
    const timer = window.setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  // 全程对话记录自动滚到底（新气泡/输入条开合/回应中都跟随）
  useEffect(() => {
    const el = textListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bubbles, textMode, busy]);

  /** AI 主动开口：聆听状态挂「用户一直不说话」计时器（3~5s 随机），触发后丢弃静默录音转 AI 独白轮 */
  const armProactiveTimer = useCallback(() => {
    if (proactiveTimerRef.current !== null) {
      window.clearTimeout(proactiveTimerRef.current);
      proactiveTimerRef.current = null;
    }
    proactiveTimerRef.current = window.setTimeout(
      () => {
        proactiveTimerRef.current = null;
        if (endedRef.current || phaseRef.current !== 'connected' || emptyRef.current) return;
        if (busyRef.current || mutedRef.current || textModeRef.current) return;
        if (vadSpeakingRef.current) return; // VAD 已检测到你正在说
        if (contact?.kind === 'user') return;
        // 用户一直没说：丢弃当前静默录音（onstop 的 proactivePending 分支接管），转入主动开口
        proactivePendingRef.current = true;
        discardRef.current = true;
        try {
          if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
        } catch {
          // 已停止
        }
      },
      PROACTIVE_MIN_MS + Math.floor(Math.random() * Math.max(1, PROACTIVE_MAX_MS - PROACTIVE_MIN_MS)),
    );
  }, [contact]);

  // ---------- 免提自动听（VAD 循环）：AI 说完自动开录待命，说完停顿自动发送，全程无需点按钮 ----------
  const toggleRecording = useCallback(async () => {
    if (phase !== 'connected' || endedRef.current) return;
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      // 已在自动听：说话中点一下=立即发送（不等停顿）；待命等你说时无需操作
      if (vadSpeakingRef.current) {
        vadRef.current?.stop();
        vadRef.current = null;
        try {
          recorderRef.current.stop();
        } catch {
          // 忽略
        }
      }
      return;
    }
    if (busyRef.current || mutedRef.current || emptyRef.current) return;
    if (contact?.kind === 'user') return; // 自己的号码：对方不说话也不听
    setError('');
    stopSpeaking();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    try {
      // AEC/NS/AGC：回声消除（免提外放时 AI 尾音不进麦克）、降噪、自动增益
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (endedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        setRecording(false);
        setVadSpeaking(false);
        vadSpeakingRef.current = false;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        // 收 Web Speech 实时识别会话：丢弃/挂断路径直接 abort；发送路径 stop() 取整句文本
        const ws = wsRef.current;
        wsRef.current = null;
        if (endedRef.current) {
          ws?.abort();
          return;
        }
        if (discardRef.current) {
          // 静音/开文字条/超时无人说话：丢弃本轮；未被禁止时自动重新听（免提等待循环）
          discardRef.current = false;
          ws?.abort();
          chunksRef.current = [];
          // AI 主动开口：用户一直没说，丢弃静默录音后转 AI 独白轮（第 N 次尝试）
          if (proactivePendingRef.current) {
            proactivePendingRef.current = false;
            if (!mutedRef.current && !textModeRef.current && phaseRef.current === 'connected') {
              busyRef.current = true;
              setBusy(true);
              void runTurn(null, undefined, { proactive: true });
              return;
            }
            scheduleAutoListenRef.current(); // 已静音/开文字条：不主动开口，静默丢弃
            return;
          }
          scheduleAutoListenRef.current();
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size < 1200) {
          ws?.abort();
          setError('没听到声音，请再说一次');
          scheduleAutoListenRef.current(AUTO_RETRY_DELAY_MS);
          return;
        }
        setBusy(true);
        busyRef.current = true;
        setPeerStatus('thinking');
        try {
          // 识别主通道：Web Speech（浏览器原生实时识别，录音期间已并行累计，stop() 取整句）
          let text = '';
          if (ws) {
            try {
              const t = (await ws.stop()).trim();
              if (t && !STT_NOISE_RE.test(t)) text = t;
            } catch {
              // 实时识别失败：走下方服务端兜底
            }
          }
          if (endedRef.current) return;
          if (!text) {
            // 第十六轮：三级兜底链（SenseVoice → 用户云端 STT → 内置 z-ai ASR 免配置）——
            // 不支持 Web Speech 的浏览器/识别抖动时，连续语音对话依然可用
            try {
              const t = (await transcribeBlob(blob)).trim();
              if (t && !STT_NOISE_RE.test(t)) text = t;
            } catch {
              // 兜底也失败：走统一失败提示
            }
          }
          if (endedRef.current) return;
          if (!text) {
            // 识别失败：提示后自动重听；连续失败达上限切键盘输入（不影响文字聊天）
            setError('没听清，请再说一次');
            sttFailRef.current += 1;
            setPeerStatus('listening');
            if (sttFailRef.current >= STT_FAIL_LIMIT) {
              setTextMode(true);
              setError('连续几次没听清，已切到键盘输入');
            } else {
              scheduleAutoListenRef.current(AUTO_RETRY_DELAY_MS);
            }
            return;
          }
          sttFailRef.current = 0;
          setBusy(false);
          busyRef.current = false;
          await runTurn(text);
        } catch {
          if (!endedRef.current) {
            setError('语音识别失败，请再说一次');
            sttFailRef.current += 1;
            setPeerStatus('listening');
            if (sttFailRef.current >= STT_FAIL_LIMIT) {
              setTextMode(true);
              setError('连续识别失败，已切到键盘输入');
            } else {
              scheduleAutoListenRef.current(AUTO_RETRY_DELAY_MS);
            }
          }
        } finally {
          busyRef.current = false;
          if (!endedRef.current) setBusy(false);
        }
      };
      recorder.start();
      setRecording(true);
      // Web Speech 实时识别（浏览器原生，与录音并行共用麦克风）：通话语音识别主通道——
      // 说完停顿 VAD 停录后 stop() 取整句文本；不支持/启动失败返回 null（走服务端兜底/键盘输入）
      wsRef.current = startWebSpeechSession({});
      armProactiveTimer(); // 用户若一直不说话（3~5s），AI 主动开口
      // VAD（免提核心）：检测你何时开口、何时说完
      vadRef.current = startVad({
        stream,
        silenceMs: AUTO_SILENCE_MS,
        waitMs: AUTO_WAIT_MS,
        maxMs: AUTO_MAX_MS,
        onSpeechStart: () => {
          if (proactiveTimerRef.current !== null) {
            window.clearTimeout(proactiveTimerRef.current); // 你开口了：取消主动开口
            proactiveTimerRef.current = null;
          }
          if (endedRef.current) return;
          vadSpeakingRef.current = true;
          setVadSpeaking(true);
        },
        onSpeechEnd: (reason) => {
          vadRef.current = null;
          vadSpeakingRef.current = false;
          setVadSpeaking(false);
          if (endedRef.current) return;
          // silent-timeout：一直没人说话，丢弃本轮重新听（不能一直录）；pause/maxlen：正常发送
          if (reason === 'silent-timeout') discardRef.current = true;
          try {
            recorderRef.current?.stop();
          } catch {
            // 已停止
          }
        },
      });
    } catch {
      setError('麦克风不可用，请检查权限或用键盘输入');
      setTextMode(true); // 权限兜底：不影响文字聊天
    }
  }, [phase, contact, runTurn, armProactiveTimer]);

  /** 免提自动听调度：空闲且未被禁止（挂断/静音/文字条/空号/自己）时开始新一轮聆听 */
  const scheduleAutoListen = useCallback(
    (delayMs = 0) => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      const go = () => {
        retryTimerRef.current = null;
        if (endedRef.current || phaseRef.current !== 'connected' || emptyRef.current) return;
        if (mutedRef.current || textModeRef.current) return;
        if (busyRef.current) return;
        if (contact?.kind === 'user') return;
        if (recorderRef.current && recorderRef.current.state === 'recording') return;
        void toggleRecording();
      };
      if (delayMs > 0) retryTimerRef.current = window.setTimeout(go, delayMs);
      else go();
    },
    [contact, toggleRecording],
  );
  useEffect(() => {
    scheduleAutoListenRef.current = scheduleAutoListen;
  });

  /** 静音 = 临时关闭麦克风：停免提自动听（清定时器）、丢弃进行中的录音；取消静音自动恢复听 */
  const toggleMute = useCallback(() => {
    if (endedRef.current || phaseRef.current !== 'connected') return;
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) {
      stopAutoTimers();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        discardRef.current = true;
        try {
          recorderRef.current.stop();
        } catch {
          // 已停止
        }
      }
      vadSpeakingRef.current = false;
      setVadSpeaking(false);
    } else {
      scheduleAutoListenRef.current(200);
    }
  }, [stopAutoTimers]);

  /** 信息图标：开/关文字聊天（开启停免提自动听并打断播报；关闭恢复自动听） */
  const toggleTextMode = useCallback(() => {
    if (endedRef.current || phaseRef.current !== 'connected') return;
    const next = !textModeRef.current;
    textModeRef.current = next;
    setTextMode(next);
    if (next) {
      stopAutoTimers();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        discardRef.current = true;
        try {
          recorderRef.current.stop();
        } catch {
          // 已停止
        }
      }
      stopSpeaking();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPeerStatus('listening');
      window.setTimeout(() => inputRef.current?.focus(), 60);
    } else {
      scheduleAutoListenRef.current(250);
    }
  }, [stopAutoTimers]);

  const sendText = useCallback(() => {
    const text = draft.trim();
    // #50 用 busyRef.current 而非 state busy 防止并发 runTurn 毫秒级窗口
    // （state 异步，两个点同时点可都读到 false，难加并发双 runTurn）
    if (!text || phase !== 'connected' || busyRef.current) return;
    setDraft('');
    void runTurn(text, 'text'); // 文字聊天轮次：AI 按是否配置语音 API 决定语音/文字回复
  }, [draft, phase, runTurn]);

  const statusText = (): string => {
    if (emptyNumber) return '您拨打的号码是空号';
    if (peerEnded === 'reject') return '对方已拒绝';
    if (peerEnded === 'no-answer') return '无人接听';
    if (phase === 'dialing') return '正在呼叫…';
    if (phase === 'ended') return '通话结束';
    if (peerStatus === 'speaking') return '正在说话…';
    if (peerStatus === 'thinking' || busy) return '…';
    if (recording && vadSpeaking) return '在听你说…';
    if (recording) return '在听…';
    return callDurationText(seconds);
  };

  // 通话界面名字/号码显示（用户要求）：「电话认识的联系人」才显示名字与头像，
  // 通讯录里查无此人的号码才走陌生号语义（iOS 一致，只显示号码+通用头像）。
  // 「电话认识」口径（头像编辑同步修复）：机主本人、电话好友（isFriend），
  // 或在微信/QQ/信息任一 App 加过好友的联系人——在联系人 App 建了人、改了头像，
  // 打电话界面就应该认识 TA（只建了人、哪都没加好友的仍按陌生号显示号码）
  const phoneKnownContact =
    contact &&
    (contact.kind === 'user' ||
      contact.isFriend ||
      isFriendIn(contact, 'sms') ||
      isFriendIn(contact, 'wx') ||
      isFriendIn(contact, 'qq'))
      ? contact
      : null;
  const name = phoneKnownContact?.name || formatNumber(target.number);
  /** 单句弹幕最新一句：只显示 AI 最新一句（我方说话不上屏，与微信/QQ 通话字幕同款；新句出现旧句消失），
   *  跳过流式中的空气泡，避免新句刚开始流式时闪烁 */
  const lastAiBubble = (() => {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (b.role === 'assistant' && b.text.trim().length > 0) return b;
    }
    return null;
  })();
  /** 电话聊天界面（信息按钮进入）全程对话记录：全部轮次（语音+文字）过滤流式空气泡 */
  const transcriptBubbles = bubbles.filter((b) => b.text.trim().length > 0);
  /** 聊天界面回应中三点显示条件：忙且最后一条是我方/还没有消息（在等对方开口） */
  const lastTranscriptBubble = transcriptBubbles[transcriptBubbles.length - 1];
  /** 文字聊天模式：六宫格收起给输入框腾地方，关闭后恢复 */
  const controlsCollapsed = textMode;
  const controlBtn = (icon: React.ReactNode, label: string, active: boolean, onClick: () => void, disabled = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || phase !== 'connected'}
      className="flex flex-col items-center gap-1.5 transition-opacity active:opacity-60 disabled:opacity-40"
      aria-pressed={active}
    >
      <span
        className={`flex h-[64px] w-[64px] items-center justify-center rounded-full backdrop-blur-md transition-colors ${
          active ? 'bg-white text-black' : 'bg-white/15 text-white'
        }`}
      >
        {icon}
      </span>
      <span className="text-[12px] text-white/85">{label}</span>
    </button>
  );

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-gradient-to-b from-[#3a3a41] via-[#232327] to-[#0b0b0d] text-white"
      role="dialog"
      aria-label={`与${name}的通话界面`}
      data-testid="call-screen"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.08),transparent_55%)]" />

      {/* 信息按钮（右上角）：开关通话中文字输入（开启停免提自动听并聚焦输入框，关闭恢复自动听） */}
      {phase === 'connected' && (
        <button
          type="button"
          onClick={toggleTextMode}
          aria-label={textMode ? '返回通话界面' : '查看聊天记录'}
          aria-pressed={textMode}
          data-testid="call-info-toggle"
          className={`absolute right-4 top-[76px] z-20 flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-md transition-all active:scale-95 ${
            textMode ? 'bg-white text-black' : 'bg-white/15 text-white'
          }`}
        >
          <MessageSquare className="h-5 w-5" />
        </button>
      )}

      {/* 中部：头像 + 名字 + 状态 + 单句弹幕/聊天界面。顶部弹性区在聊天界面收小，把空间让给对话记录 */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center px-6 pb-2 pt-[74px]">
        <div
          className={textMode && phase !== 'dialing' ? 'h-1.5 shrink-0' : 'min-h-2 max-h-[72px] flex-1'}
          aria-hidden="true"
        />
        <div className="relative">
          {phase === 'dialing' && !emptyNumber && (
            <span className="absolute inset-0 animate-ping rounded-full bg-white/20" aria-hidden="true" />
          )}
          <AvatarBubble contact={phoneKnownContact} size={92} className="relative shadow-2xl ring-2 ring-white/25" />
          {peerStatus === 'speaking' && (
            <span className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-end gap-[3px] rounded-full bg-black/50 px-2.5 py-1.5 backdrop-blur-md" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="w-[3px] animate-pulse rounded-full bg-[#34C759]"
                  style={{ height: 6 + (i % 3) * 4, animationDelay: `${i * 140}ms`, animationDuration: '700ms' }}
                />
              ))}
            </span>
          )}
        </div>
        <h2 className="mt-3 max-w-[300px] truncate text-[26px] font-semibold leading-tight">{name}</h2>
        <p className="mt-0.5 flex items-center gap-1.5 text-[14px] text-white/70 tabular-nums" aria-live="polite" data-testid="call-status">
          {phase === 'ended' ? (
            '通话结束'
          ) : emptyNumber ? (
            <PhoneOff className="h-4 w-4 text-[#FF453A]" aria-hidden="true" />
          ) : peerStatus === 'speaking' ? (
            <AudioLines className="h-4 w-4 animate-pulse text-[#34C759]" aria-hidden="true" />
          ) : null}
          {statusText()}
        </p>
        {error && (
          <p className="mt-2 max-w-[320px] rounded-full bg-red-500/20 px-3.5 py-1 text-center text-[12.5px] text-red-200" role="alert">
            {error}
          </p>
        )}
        {/* 电话界面（默认）＝单句弹幕：纯文字字幕（无气泡背景，用户参考截图样式）——同一时刻只显示 AI 最新一句，
            我方说话不上屏，新句出现旧句消失；有界滚动超高内部滚底，长句不会被底部按钮遮挡 */}
        {phase !== 'dialing' && !textMode ? (
          <div
            ref={textListRef}
            className="no-scrollbar flex w-full min-h-0 flex-1 flex-col items-center overflow-y-auto px-2 pb-1 pt-3"
            aria-label="通话字幕"
            aria-live="polite"
            data-testid="call-captions"
          >
            {lastAiBubble && (
              <p
                key={lastAiBubble.id}
                className="animate-call-caption w-full whitespace-pre-wrap break-words text-center text-[17px] leading-[1.6] text-white/60"
              >
                {lastAiBubble.text}
              </p>
            )}
            {busy && !lastAiBubble && (
              <span className="flex items-center gap-1.5 py-2" aria-label="对方正在回应">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/50" style={{ animationDelay: `${d}ms` }} />
                ))}
              </span>
            )}
          </div>
        ) : phase !== 'dialing' && textMode ? (
          /* 电话聊天界面（点右上角信息按钮进入，无需挂断）：全程对话记录以聊天气泡呈现——
             对方白色气泡在左/我方绿色气泡在右，语音轮次带声波小标，点开立即可见（语音说的+打字的全部轮次）；
             可滚动自动滚底，长句不会被底部按钮遮挡 */
          <div
            ref={textListRef}
            className="no-scrollbar mt-2 flex w-full min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1 pb-1"
            aria-label="通话对话记录"
            data-testid="call-transcript"
          >
            {transcriptBubbles.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <p
                  className={`flex max-w-[82%] items-start gap-1.5 whitespace-pre-wrap break-words px-3.5 py-2 text-[14.5px] leading-snug shadow-[0_1px_3px_rgba(0,0,0,0.3)] ${
                    m.role === 'user'
                      ? 'rounded-[16px] rounded-br-[5px] bg-[#34C759] text-white'
                      : 'rounded-[16px] rounded-bl-[5px] bg-white/15 text-white/95'
                  }`}
                >
                  {m.via !== 'text' && <AudioLines className="mt-[3px] h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />}
                  <span className="min-w-0">{m.text}</span>
                </p>
              </div>
            ))}
            {busy && (!lastTranscriptBubble || lastTranscriptBubble.role === 'user') && (
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
        ) : (
          <div className="min-h-2 flex-1" aria-hidden="true" />
        )}
      </div>

      {/* 通话中 DTMF 键盘浮层 */}
      {keypadOpen && (
        <div className="absolute inset-0 z-20 flex flex-col bg-black/70 pt-[80px] backdrop-blur-xl">
          <p className="min-h-[36px] px-6 text-center text-[24px] font-light tracking-[0.3em] text-white/90 tabular-nums">{dtmf}</p>
          <div className="mx-auto mt-4 grid w-[280px] grid-cols-3 gap-x-6 gap-y-4">
            {KEYS.map((k) => (
              <button
                key={k.digit}
                type="button"
                onClick={() => {
                  playDtmf(k.digit);
                  setDtmf((s) => (s.length > 20 ? s : s + k.digit));
                }}
                className="mx-auto flex h-[72px] w-[72px] flex-col items-center justify-center rounded-full bg-white/15 backdrop-blur-md transition-colors active:bg-white/35"
              >
                <span className="text-[28px] font-light leading-none">{k.digit}</span>
                {k.letters && <span className="mt-0.5 text-[9px] tracking-[0.18em] text-white/70">{k.letters}</span>}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setKeypadOpen(false)}
            className="mx-auto mt-6 rounded-full bg-white/15 px-6 py-2 text-[15px] text-white backdrop-blur-md active:bg-white/30"
          >
            隐藏
          </button>
          <div className="flex-1" />
        </div>
      )}

      {/* 控制区（文字聊天/打字输入时自动收起，六宫格按钮消失） */}
      <div
        className={`relative z-10 shrink-0 overflow-hidden px-8 transition-all duration-300 ease-out ${
          controlsCollapsed
            ? 'pointer-events-none max-h-0 -translate-y-2 scale-[0.98] opacity-0'
            : 'max-h-[240px] translate-y-0 scale-100 opacity-100'
        }`}
        aria-hidden={controlsCollapsed}
      >
        {phase !== 'ended' && (
          <div className="grid grid-cols-3 gap-y-5 pb-1">
            {controlBtn(muted ? <MicOff className="h-[22px] w-[22px]" /> : <Mic className="h-[22px] w-[22px]" />, '静音', muted, () => toggleMute())}
            {controlBtn(<DialpadIcon className="h-[22px] w-[22px]" />, '键盘', keypadOpen, () => setKeypadOpen((v) => !v))}
            {controlBtn(speaker ? <Volume2 className="h-[22px] w-[22px]" /> : <VolumeX className="h-[22px] w-[22px]" />, '扬声器', speaker, () => setSpeaker((v) => !v))}
            {controlBtn(<UserPlus className="h-[22px] w-[22px]" />, '添加', false, () => setError('模拟通话暂不支持添加通话'))}
            {controlBtn(<Video className="h-[22px] w-[22px]" />, '视频', false, () => setError('对方不支持视频通话'))}
            {controlBtn(<UserRound className="h-[22px] w-[22px]" />, '联系人', false, () => setError('通话中不可查看联系人'))}
          </div>
        )}
      </div>

      {/* 通话中文字输入（右上角信息按钮开关）+ 挂断——免提全自动：无需点任何按钮即可对话 */}
      <div className="relative z-10 shrink-0 px-5 pb-[22px] pt-2">
        {phase === 'connected' && textMode && (
          <div className="mb-2.5 flex items-center gap-2">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendText()}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="输入要说的话…"
              maxLength={200}
              aria-label="输入要说的话"
              data-testid="call-textbar-input"
              className="h-[42px] flex-1 rounded-full border border-white/20 bg-white/10 px-4 text-[15px] text-white outline-none placeholder:text-white/40 focus:border-white/45"
            />
            <button
              type="button"
              onClick={sendText}
              disabled={!draft.trim() || busy}
              aria-label="发送"
              data-testid="call-textbar-send"
              className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-white text-black transition-opacity active:opacity-60 disabled:opacity-40"
            >
              <ArrowUpRight className="h-5 w-5" />
            </button>
          </div>
        )}

        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => hangup()}
            data-testid="call-end"
            aria-label="挂断"
            className="flex h-[66px] w-[66px] items-center justify-center rounded-full bg-[#FF3B30] text-white shadow-[0_8px_24px_rgba(255,59,48,0.4)] transition-transform active:scale-95"
          >
            <PhoneOff className="h-[27px] w-[27px]" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 语音留言行（列表只显示联系人与时长，点行进详情页看内容） ----------------

function VoicemailRow({
  vm,
  contact,
  active,
  loading,
  onOpen,
  onTogglePlay,
  onLongPress,
}: {
  vm: VoicemailRecord;
  contact: ContactRecord | null;
  active: boolean;
  loading: boolean;
  onOpen: () => void;
  onTogglePlay: () => void;
  onLongPress: () => void;
}) {
  const pressTimer = useRef<number | null>(null);
  const longFired = useRef(false);

  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  useEffect(() => cancelPress, []);

  return (
    <div
      onPointerDown={() => {
        cancelPress();
        longFired.current = false;
        pressTimer.current = window.setTimeout(() => {
          longFired.current = true;
          onLongPress();
        }, 480);
      }}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onContextMenu={(e) => e.preventDefault()}
      className="flex items-center gap-3 py-2.5 pl-3.5 pr-2 transition-colors active:bg-muted/60"
    >
      <AvatarBubble contact={contact} size={44} className={contact ? '' : 'opacity-80'} />
      <button
        type="button"
        onClick={() => {
          // 长按刚触发过动作菜单时，忽略随后的 click（避免误进详情）
          if (longFired.current) {
            longFired.current = false;
            return;
          }
          onOpen();
        }}
        className="min-w-0 flex-1 text-left"
        aria-label={`查看${vm.displayName}的${vm.kind === 'call' ? '通话内容' : '留言'}`}
        data-testid={`vm-open-${vm.id}`}
      >
        <span className="flex items-center gap-1.5">
          {!vm.read && <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#0A84FF]" aria-label="未读" />}
          <span className={`min-w-0 flex-1 truncate text-[16px] leading-snug ${vm.read ? 'font-medium' : 'font-semibold'}`}>
            {vm.displayName}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          {active ? (
            <span className="flex items-end gap-[2px]" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-[3px] animate-pulse rounded-full bg-[#34C759]"
                  style={{ height: 5 + (i % 2) * 3, animationDelay: `${i * 140}ms`, animationDuration: '700ms' }}
                />
              ))}
            </span>
          ) : vm.kind === 'call' ? (
            <PhoneIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
          ) : (
            <VoicemailIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate tabular-nums">{vm.kind === 'call' ? '通话内容' : '留言'}</span>
          <span className="shrink-0 tabular-nums">· {formatDuration(vm.duration)}</span>
        </span>
      </button>
      <span className="shrink-0 text-[12.5px] text-muted-foreground tabular-nums">{formatLogTime(vm.createdAt)}</span>
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={active ? '暂停播放' : '播放'}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] transition-all active:scale-90"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : active ? (
          <Pause className="h-4 w-4" fill="currentColor" strokeWidth={0} />
        ) : (
          <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" strokeWidth={0} />
        )}
      </button>
    </div>
  );
}

// ---------------- 五个 Tab ----------------

function RecentsTab({
  logs,
  contacts,
  onCall,
  onDelete,
}: {
  logs: CallLogRecord[] | null;
  /** 全量联系人池（含未加好友的 CHAR/NPC）：记录回链/按号码回退匹配都用它（编辑同步修复） */
  contacts: ContactRecord[];
  onCall: (number: string, contact: ContactRecord | null) => void;
  onDelete: (log: CallLogRecord) => void;
}) {
  const [sheet, setSheet] = useState<CallLogRecord | null>(null);
  const [filter, setFilter] = useState<'all' | 'missed'>('all');
  const [query, setQuery] = useState('');
  const pressTimer = useRef<number | null>(null);
  const cancelPress = useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);
  useEffect(() => cancelPress, [cancelPress]);

  /** 日志 → 联系人回链：优先 contactId，其次按「联系人里填的电话」匹配（改号/换设备后仍能对上人） */
  const resolve = useCallback(
    (log: CallLogRecord): ContactRecord | null => {
      const live = log.contactId ? contacts.find((c) => c.id === log.contactId) : undefined;
      return live ?? findContactByNumber(contacts, log.number);
    },
    [contacts]
  );

  /** 回拨号码：联系人在 → 用当前号码（改号后记录快照是旧号，拨旧号会「空号」）；不在 → 拨快照号 */
  const callNumber = useCallback(
    (log: CallLogRecord): string => resolve(log)?.phone || log.number,
    [resolve]
  );

  const shown = useMemo(() => {
    let list = logs ?? [];
    if (filter === 'missed') {
      // 未接来电 tab 按结局筛选（#27 三态）：未接听 + 已拒绝 算未接来电；
      // 已取消（呼出未接通，如拨号中自己取消/空号）不算——呼出未接通不算未接来电；
      // 旧记录无 endReason → callOutcomeOf('') 自然回落（接通=ended / 未接通=missed），行为兼容
      list = list.filter((l) => {
        const o = callOutcomeOf(l.endReason ?? '', l.duration > 0);
        return o === 'missed' || o === 'rejected';
      });
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((l) => {
        const c = resolve(l);
        return `${c?.name ?? ''} ${l.displayName} ${l.number}`.toLowerCase().includes(q);
      });
    }
    return list;
  }, [logs, filter, query, resolve]);

  if (logs === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const emptyTip =
    filter === 'missed'
      ? { title: '无未接来电', desc: '没有拨出后未接通的通话' }
      : { title: '还没有通话记录', desc: '去「通讯录」或「拨号键盘」拨出第一通电话吧' };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {logs.length > 0 && (
        <div className="shrink-0">
          <div className="px-4 pb-2">
            <IOSSegmented
              ariaLabel="筛选通话记录"
              value={filter}
              onChange={setFilter}
              options={[
                { key: 'all', label: '所有' },
                { key: 'missed', label: '未接来电' },
              ]}
            />
          </div>
          <div className="px-4 pb-2">
            <IOSSearch value={query} onChange={setQuery} placeholder="搜索" />
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <ClockIcon className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
          <p className="text-[15px] font-medium">{emptyTip.title}</p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{emptyTip.desc}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pb-2">
          <ul className="mx-4 overflow-hidden rounded-[14px] bg-card" data-testid="recents-list">
            {shown.map((log, idx) => {
              const live = resolve(log);
              const name = live?.name || log.displayName || log.number;
              // #27 三态展示：endReason → 结局（rejected/cancelled/missed/ended）；旧记录无 endReason 自然回落
              const outcome = callOutcomeOf(log.endReason ?? '', log.duration > 0);
              // 颜色语义（iOS 惯例 + 对齐微信/QQ 通话卡片）：未接听保持红色；
              // 已取消/已拒绝用中性色非红（呼出未接通不算未接来电，拒接也不是「未接」）
              const missRed = outcome === 'missed';
              const region = live?.region?.trim();
              return (
                <li key={log.id} className={idx > 0 ? 'border-t border-border/50' : ''}>
                  <div className="flex items-center gap-1.5 pl-3.5 pr-2 transition-colors active:bg-muted/60">
                    <button
                      type="button"
                      onClick={() => onCall(callNumber(log), live)}
                      onPointerDown={() => {
                        cancelPress();
                        pressTimer.current = window.setTimeout(() => setSheet(log), 480);
                      }}
                      onPointerUp={cancelPress}
                      onPointerLeave={cancelPress}
                      onContextMenu={(e) => e.preventDefault()}
                      className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
                      aria-label={`呼叫${name}`}
                    >
                      <AvatarBubble contact={live} size={44} className={live ? '' : 'opacity-80'} />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[16px] font-semibold leading-snug ${
                            missRed ? 'text-[#FF3B30] dark:text-[#FF453A]' : ''
                          }`}
                        >
                          {name}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-[12.5px] text-muted-foreground">
                          {/* 方向图标：out=呼出↗、in=呼入↙；未接听红色↗/↙（iOS 语义），
                              已拒绝/已取消用中性灰（非红非绿），接通绿 */}
                          {log.media === 'video' ? (
                            <Video className="h-[13px] w-[13px] shrink-0 text-muted-foreground" aria-hidden="true" />
                          ) : log.direction === 'out' ? (
                            <ArrowUpRight
                              className={`h-[13px] w-[13px] shrink-0 ${
                                missRed
                                  ? 'text-[#FF3B30] dark:text-[#FF453A]'
                                  : outcome === 'ended'
                                    ? 'text-[#34C759]'
                                    : 'text-muted-foreground'
                              }`}
                              aria-hidden="true"
                            />
                          ) : (
                            <ArrowDownLeft
                              className={`h-[13px] w-[13px] shrink-0 ${
                                missRed
                                  ? 'text-[#FF3B30] dark:text-[#FF453A]'
                                  : outcome === 'ended'
                                    ? 'text-[#34C759]'
                                    : 'text-muted-foreground'
                              }`}
                              aria-hidden="true"
                            />
                          )}
                          <span className="truncate tabular-nums">
                            {/* 文案三态：接通=呼入/呼出·时长；未接听/已拒绝/已取消各显示专属文案（#27） */}
                            {outcome === 'ended'
                              ? `${log.media === 'video' ? '视频通话' : log.direction === 'in' ? '呼入' : '呼出'} · ${callDurationText(log.duration)}`
                              : outcome === 'rejected'
                                ? '已拒绝'
                                : outcome === 'cancelled'
                                  ? '已取消'
                                  : '未接听'}
                            {region ? ` · ${region}` : ''}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-[13.5px] text-muted-foreground tabular-nums">{formatLogTime(log.createdAt)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSheet(log)}
                      aria-label={`${name}的通话详情`}
                      data-testid={`log-info-${log.id}`}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors active:bg-muted"
                    >
                      <Info className="h-[21px] w-[21px] text-[#0A84FF]" strokeWidth={1.8} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 单条记录详情：呼叫 / 删除 */}
      <IOSActionSheet
        open={!!sheet}
        actions={
          sheet
            ? [
                {
                  label: `呼叫 ${sheet.displayName || sheet.number}`,
                  onSelect: () => {
                    const t = sheet;
                    setSheet(null);
                    onCall(callNumber(t), resolve(t));
                  },
                },
                {
                  label: '删除该条记录',
                  destructive: true,
                  onSelect: () => {
                    onDelete(sheet);
                    setSheet(null);
                  },
                },
              ]
            : []
        }
        onCancel={() => setSheet(null)}
      />
    </div>
  );
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function ContactsTab({
  contacts,
  favorites,
  onOpenDetail,
  onToggleFavorite,
  onAddFriend,
  loading,
}: {
  contacts: ContactRecord[];
  favorites: string[];
  onOpenDetail: (c: ContactRecord) => void;
  onToggleFavorite: (id: string) => void;
  onAddFriend: () => void;
  loading: boolean;
}) {
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const secRefs = useRef<Record<string, HTMLElement | null>>({});

  /** 按拼音首字母分组（Intl zh 排序；汉字归 A-Z，其余归 #） */
  const sections = useMemo(() => {
    const sorted = [...contacts].sort((a, b) => PINYIN_COLLATOR.compare(a.name, b.name));
    const map = new Map<string, ContactRecord[]>();
    for (const c of sorted) {
      const letter = sectionLetter(c.name);
      const bucket = map.get(letter);
      if (bucket) bucket.push(c);
      else map.set(letter, [c]);
    }
    const letters = ALPHABET.filter((l) => map.has(l));
    if (map.has('#')) letters.push('#');
    return letters.map((letter) => ({ letter, items: map.get(letter)! }));
  }, [contacts]);

  const searching = query.trim().length > 0;
  const results = useMemo(() => {
    if (!searching) return [];
    const q = query.trim().toLowerCase();
    return contacts.filter((c) =>
      [c.name, c.phone, c.relation, c.occupation, c.region].some((f) => (f ?? '').toLowerCase().includes(q))
    );
  }, [contacts, searching, query]);

  const jump = useCallback((letter: string) => {
    const el = secRefs.current[letter];
    const sc = scrollRef.current;
    if (el && sc) sc.scrollTo({ top: Math.max(0, el.offsetTop), behavior: 'smooth' });
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const row = (c: ContactRecord) => {
    const fav = favorites.includes(c.id);
    return (
      <div className="flex items-center gap-1.5 pl-3.5 pr-2 transition-colors active:bg-muted/60">
        <button
          type="button"
          onClick={() => onOpenDetail(c)}
          className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
          aria-label={`查看${c.name}的联系人详情`}
        >
          <AvatarBubble contact={c} size={44} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-semibold leading-snug">{c.name}</span>
            <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground tabular-nums">
              {c.phone || '无号码'}
              {listSubtitle(c) ? ` · ${listSubtitle(c)}` : ''}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onToggleFavorite(c.id)}
          aria-label={fav ? '从个人收藏移除' : '添加到个人收藏'}
          aria-pressed={fav}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors active:bg-muted"
        >
          <Star className={`h-[19px] w-[19px] ${fav ? 'fill-[#F5B800] text-[#F5B800]' : 'text-muted-foreground/50'}`} />
        </button>
      </div>
    );
  };

  if (contacts.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <UsersIcon className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-[15px] font-medium">还没有联系人</p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          点右上角「+」新建联系人并填写电话，添加后即可拨打和发信息
        </p>
        <button
          type="button"
          onClick={() => onAddFriend()}
          data-testid="empty-add-contact"
          className="mt-2 rounded-full bg-[#0A84FF] px-5 py-2 text-[14.5px] font-medium text-white transition-all active:scale-95"
        >
          新建联系人
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden" data-testid="contacts-list">
      <div className="shrink-0 px-4 pb-2">
        <IOSSearch value={query} onChange={setQuery} placeholder="搜索" />
      </div>

      <div ref={scrollRef} className="relative flex-1 overflow-y-auto px-4 pb-2">
        {searching ? (
          results.length > 0 ? (
            <ul className="overflow-hidden rounded-[14px] bg-card">
              {results.map((c, i) => (
                <li key={c.id} className={i > 0 ? 'border-t border-border/50' : ''}>
                  {row(c)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-10 text-center text-[14px] text-muted-foreground">没有找到「{query.trim()}」相关联系人</p>
          )
        ) : (
          sections.map((sec) => (
            <section
              key={sec.letter}
              ref={(el) => {
                secRefs.current[sec.letter] = el;
              }}
              className="pb-3"
            >
              <h3 className="sticky top-0 z-10 -mx-4 bg-background/95 px-5 py-[3px] text-[13px] font-semibold text-muted-foreground backdrop-blur-sm">
                {sec.letter}
              </h3>
              <ul className="overflow-hidden rounded-[14px] bg-card">
                {sec.items.map((c, i) => (
                  <li key={c.id} className={i > 0 ? 'border-t border-border/50' : ''}>
                    {row(c)}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {/* 右侧字母索引（A-Z / #，点按跳组） */}
      {!searching && sections.length > 1 && (
        <nav
          aria-label="字母索引"
          className="absolute bottom-4 right-0 top-24 z-20 flex flex-col justify-center gap-[1px] px-[3px]"
        >
          {sections.map((sec) => (
            <button
              key={sec.letter}
              type="button"
              onClick={() => jump(sec.letter)}
              aria-label={`跳转到${sec.letter}分组`}
              className="flex h-[13px] w-[15px] items-center justify-center rounded text-[9.5px] font-semibold leading-none text-[#0A84FF] transition-colors active:bg-[#0A84FF]/15"
            >
              {sec.letter}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

function FavoritesTab({
  contacts,
  favorites,
  onCall,
  onToggleFavorite,
}: {
  contacts: ContactRecord[];
  favorites: string[];
  onCall: (number: string, contact: ContactRecord | null) => void;
  onToggleFavorite: (id: string) => void;
}) {
  const favContacts = favorites
    .map((id) => contacts.find((c) => c.id === id))
    .filter((c): c is ContactRecord => !!c);
  if (favContacts.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <Star className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-[15px] font-medium">没有个人收藏</p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">在「通讯录」里点星标，把常联系人放这里快速拨打</p>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto pb-2" data-testid="favorites-list">
      <ul className="mx-4 overflow-hidden rounded-[14px] bg-card">
        {favContacts.map((c, i) => (
          <li key={c.id} className={i > 0 ? 'border-t border-border/50' : ''}>
            <div className="flex items-center gap-1.5 pl-3.5 pr-2 transition-colors active:bg-muted/60">
              <button
                type="button"
                onClick={() => onCall(c.phone || '', c)}
                className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
                aria-label={`呼叫${c.name}`}
              >
                <AvatarBubble contact={c} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold leading-snug">{c.name}</span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{listSubtitle(c)}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onToggleFavorite(c.id)}
                aria-label="从个人收藏移除"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors active:bg-muted"
              >
                <Star className="h-[19px] w-[19px] fill-[#F5B800] text-[#F5B800]" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function KeypadTab({
  contacts,
  onCall,
  onNewContact,
  anonPhone,
  onOpenAnon,
  onAnonLongPress,
}: {
  /** 全量联系人池（含未加好友的 CHAR/NPC）：拨号键盘按号码实时匹配「呼叫 XXX」用（编辑同步修复） */
  contacts: ContactRecord[];
  onCall: (number: string, contact: ContactRecord | null) => void;
  /** 右上角 ⊕：用当前输入的号码（可空）新建联系人（添加好友） */
  onNewContact: (prefilledPhone: string) => void;
  /** 当前活跃账号为匿名号时传其号码（用于脱敏徽标与匿名 chip 高亮/后四位），其余传 null（Task 40-E） */
  anonPhone: string | null;
  /** 点「匿名号码」chip → 打开切换弹层（Task 40-E） */
  onOpenAnon: () => void;
  /** 长按「匿名号码」chip → 删除当前匿名号码（Task 40 修正）；无匿名号时回落打开弹层 */
  onAnonLongPress: () => void;
}) {
  const [digits, setDigits] = useState('');

  // 长按删除（Task 40 修正）：匿名号码 chip 按住 500ms 触发；触发后吞掉随后的 click（避免再弹切换弹层）
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);
  const startLongPress = useCallback(() => {
    clearLongPress();
    longPressFired.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      longPressFired.current = true;
      onAnonLongPress();
    }, 500);
  }, [clearLongPress, onAnonLongPress]);
  useEffect(() => clearLongPress, [clearLongPress]);

  const press = useCallback((key: string) => {
    playDtmf(key);
    setDigits((d) => (d.length >= 20 ? d : d + key));
  }, []);

  const matched = useMemo(() => {
    if (stripDigits(digits).length < 3) return null;
    return findContactByNumber(contacts, digits);
  }, [digits, contacts]);

  // 多账号（Task 40-2d v2）：键盘左上身份徽标跟随电话 App 当前账号（大号=主号，小号=账号名，匿名号=匿名）；
  // 渲染期读——切号不刷新网页，PhoneApp 监听事件重渲染时这里读到的是新账号
  const activeAccount = getActiveAccountFor('phone');
  const activeLabel =
    activeAccount.kind === 'main'
      ? '主号'
      : activeAccount.kind === 'anon'
        ? '匿名'
        : activeAccount.name || '小号';
  // 身份选择 chips 的高亮态（iPhone 双卡样式）：当前为主号 →「主号」实心；当前为匿名号 →「匿名号码」实心；
  // 小号身份时两者都不高亮（主号 chip 点击可一键切回主号）
  const isMain = activeAccount.id === MAIN_ACCOUNT_ID;
  const isAnon = activeAccount.kind === 'anon';

  return (
    <div className="flex flex-1 select-none flex-col items-center overflow-y-auto px-6 pb-2" data-testid="keypad-tab">
      {/* 顶部行（最上面，Task 40 修正：身份选择白色小胶囊移到最顶 + 右上角新建联系人 ⊕，原蓝色主号徽章由 chip 高亮替代） */}
      <div className="relative -mx-2 flex w-full shrink-0 items-center justify-center pt-1.5">
        <div className="flex items-center gap-2" role="group" aria-label="主叫身份">
          <button
            type="button"
            data-testid="phone-identity-main"
            onClick={() => {
              // 已是主号则无操作；小号/匿名号身份 → 一键切回主号（switchAccountFor 派发事件，不刷新网页）
              if (!isMain) switchAccountFor('phone', MAIN_ACCOUNT_ID);
            }}
            aria-pressed={isMain}
            aria-label="用主号拨打"
            className={`flex h-9 items-center justify-center gap-1 rounded-full px-3.5 text-[12.5px] font-medium leading-none transition-all active:scale-95 ${
              isMain
                ? 'bg-white text-black shadow-[0_1px_6px_rgba(0,0,0,0.14)] ring-1 ring-black/[0.04] dark:bg-[#ECECEE] dark:text-black dark:ring-white/10'
                : 'bg-white/60 text-black/45 dark:bg-white/[0.10] dark:text-white/50'
            }`}
          >
            <PhoneIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            主号
          </button>
          <button
            type="button"
            data-testid="phone-identity-anon"
            onClick={() => {
              // 长按已触发删除确认 → 吞掉本次 click
              if (longPressFired.current) {
                longPressFired.current = false;
                return;
              }
              onOpenAnon();
            }}
            onPointerDown={startLongPress}
            onPointerUp={clearLongPress}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
            aria-pressed={isAnon}
            aria-haspopup="dialog"
            aria-label={isAnon && anonPhone ? `当前匿名号码 ${maskAnonPhone(anonPhone)}，点按切换，长按删除` : '切换匿名号码'}
            className={`flex h-9 items-center justify-center gap-1 rounded-full px-3.5 text-[12.5px] font-medium leading-none transition-all active:scale-95 ${
              isAnon
                ? 'bg-white text-black shadow-[0_1px_6px_rgba(0,0,0,0.14)] ring-1 ring-black/[0.04] dark:bg-[#ECECEE] dark:text-black dark:ring-white/10'
                : 'bg-white/60 text-black/45 dark:bg-white/[0.10] dark:text-white/50'
            }`}
          >
            <EyeOff className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            匿名号码{isAnon && anonPhone ? ` ${anonPhone.slice(-4)}` : ''}
          </button>
        </div>
        <button
          type="button"
          onClick={() => onNewContact(stripDigits(digits))}
          aria-label="把当前号码新建为联系人"
          data-testid="keypad-new-contact"
          className="absolute right-0 flex h-9 w-9 items-center justify-center rounded-full text-[#0A84FF] transition-colors active:bg-[#0A84FF]/10"
        >
          <UserPlus className="h-[21px] w-[21px]" strokeWidth={1.9} />
        </button>
      </div>

      {/* 号码显示区（非主号身份时顶部加一行小字徽标提醒当前主叫身份：匿名号=脱敏号码，小号=账号名） */}
      <div className="flex min-h-[86px] w-full flex-col items-center justify-center px-1">
        {anonPhone ? (
          <p
            className="mb-1 flex items-center gap-1 text-[12.5px] leading-none text-muted-foreground"
            data-testid="phone-dialer-anon-badge"
          >
            <EyeOff className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            匿名号码 {maskAnonPhone(anonPhone)}
          </p>
        ) : activeAccount.kind === 'alt' ? (
          <p
            className="mb-1 flex items-center gap-1 text-[12.5px] leading-none text-muted-foreground"
            data-testid="phone-dialer-alt-badge"
          >
            <UserRound className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            {activeLabel}
          </p>
        ) : null}
        <p
          className="truncate text-[40px] font-light leading-none tracking-wide text-foreground tabular-nums transition-[font-size] duration-150"
          data-testid="dial-number"
        >
          {formatNumber(digits)}
        </p>
      </div>
      <p className="mb-1 flex h-[22px] items-center gap-1 text-[15px] text-[#0A84FF]" aria-live="polite" data-testid="keypad-match">
        {matched ? (
          <span className="inline-flex items-center gap-[1px]">
            呼叫 {matched.name}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        ) : digits.length >= 3 ? (
          '陌生号码'
        ) : (
          ''
        )}
      </p>

      {/* 12 键拨号盘（小一号圆键 + 加粗数字/字母双层，深按压反馈） */}
      <div className="mt-1 grid w-[272px] grid-cols-3 gap-x-[28px] gap-y-[12px]">
        {KEYS.map((k) => (
          <button
            key={k.digit}
            type="button"
            onClick={() => press(k.digit)}
            data-key={k.digit}
            aria-label={`按键${k.digit}${k.letters || ''}`}
            className="mx-auto flex h-[72px] w-[72px] flex-col items-center justify-center rounded-full bg-foreground/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] transition-all duration-100 ease-out hover:bg-foreground/[0.11] active:scale-[0.9] active:bg-foreground/[0.17] dark:bg-white/[0.11] dark:shadow-none dark:hover:bg-white/[0.15] dark:active:bg-white/[0.23]"
          >
            <span className="text-[29px] font-medium leading-none tracking-tight">{k.digit}</span>
            {k.letters && (
              <span className="mt-[3px] text-[10px] font-medium leading-none tracking-[0.22em] text-muted-foreground/90">
                {k.letters}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 底行：绿色呼叫钮（中，同步缩小一号）· 退格（右，iOS 18 布局） */}
      <div className="mt-[16px] grid w-[272px] grid-cols-3 items-center">
        <span />
        <button
          type="button"
          onClick={() => digits.length > 0 && onCall(digits, matched)}
          disabled={digits.length === 0}
          data-testid="call-start"
          aria-label="呼叫"
          className="mx-auto flex h-[70px] w-[70px] items-center justify-center rounded-full bg-gradient-to-b from-[#3FD860] to-[#2BBF4C] text-white shadow-[0_10px_28px_rgba(52,199,89,0.5),inset_0_1px_0_rgba(255,255,255,0.35)] transition-all duration-100 active:scale-[0.93] disabled:opacity-40"
        >
          <PhoneIcon className="h-[30px] w-[30px]" fill="currentColor" strokeWidth={0} />
        </button>
        <span className="flex justify-center">
          {digits.length > 0 && (
            <button
              type="button"
              onClick={() => setDigits((d) => d.slice(0, -1))}
              aria-label="退格"
              data-testid="keypad-backspace"
              className="flex h-[40px] w-[58px] items-center justify-center rounded-[13px] bg-foreground/[0.07] text-foreground transition-all duration-100 active:scale-90 active:bg-foreground/[0.15] dark:bg-white/[0.11]"
            >
              <Delete className="h-[24px] w-[24px]" strokeWidth={1.8} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

// ---------------- 语音留言 Tab ----------------

function VoicemailTab({
  voicemails,
  contacts,
  playingId,
  loadingId,
  onOpen,
  onTogglePlay,
  onDelete,
  onToggleRead,
}: {
  voicemails: VoicemailRecord[] | null;
  contacts: ContactRecord[];
  playingId: string | null;
  loadingId: string | null;
  onOpen: (vm: VoicemailRecord) => void;
  onTogglePlay: (vm: VoicemailRecord) => void;
  onDelete: (vm: VoicemailRecord) => void;
  onToggleRead: (vm: VoicemailRecord) => void;
}) {
  const [sheet, setSheet] = useState<VoicemailRecord | null>(null);
  const pressTimer = useRef<number | null>(null);
  const cancelPress = useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);
  useEffect(() => cancelPress, [cancelPress]);

  if (voicemails === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (voicemails.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <VoicemailIcon className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-[15px] font-medium">无语音留言</p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          通话结束后，说了什么会自动存档在这里（永久保存）；对方未接听时的留言也会出现在这里。点按留言可回看完整内容。仅长按删除才丢。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto pb-2">
        <ul className="mx-4 overflow-hidden rounded-[14px] bg-card" data-testid="voicemail-list">
          {voicemails.map((vm, idx) => (
            <li key={vm.id} className={idx > 0 ? 'border-t border-border/50' : ''}>
              <VoicemailRow
                vm={vm}
                contact={contacts.find((c) => c.id === vm.contactId) ?? null}
                active={playingId === vm.id}
                loading={loadingId === vm.id}
                onOpen={() => onOpen(vm)}
                onTogglePlay={() => onTogglePlay(vm)}
                onLongPress={() => setSheet(vm)}
              />
            </li>
          ))}
        </ul>
      </div>

      <IOSActionSheet
        open={!!sheet}
        actions={
          sheet
            ? [
                {
                  label: '播放留言',
                  onSelect: () => {
                    const vm = sheet;
                    setSheet(null);
                    onTogglePlay(vm);
                  },
                },
                {
                  label: sheet.read ? '标为未读' : '标为已读',
                  onSelect: () => {
                    onToggleRead(sheet);
                    setSheet(null);
                  },
                },
                {
                  label: '删除留言',
                  destructive: true,
                  onSelect: () => {
                    onDelete(sheet);
                    setSheet(null);
                  },
                },
              ]
            : []
        }
        onCancel={() => setSheet(null)}
      />
    </div>
  );
}

// ---------------- 语音留言详情页（列表点行进入：完整谈话内容 + 播放 + 删除） ----------------

function formatFullTime(ts: number): string {
  const d = new Date(ts);
  const week = '日一二三四五六'[d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${week} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`;
}

function VoicemailDetail({
  vm,
  contact,
  active,
  loading,
  onBack,
  onTogglePlay,
  onDelete,
}: {
  vm: VoicemailRecord;
  contact: ContactRecord | null;
  active: boolean;
  loading: boolean;
  onBack: () => void;
  onTogglePlay: () => void;
  onDelete: () => void;
}) {
  const isCall = vm.kind === 'call';
  /** kind='call' 的转写是「我：…/对方名：…」逐行对话 → 解析成气泡；普通留言整段展示 */
  const dialogue = useMemo(
    () =>
      isCall
        ? vm.text.split('\n').map((line) => {
            const i = line.indexOf('：');
            const speaker = i > 0 ? line.slice(0, i) : '';
            return { speaker, mine: speaker === '我', text: i > 0 ? line.slice(i + 1) : line };
          })
        : [],
    [isCall, vm.text]
  );

  return (
    <div
      className="absolute inset-0 z-[35] flex flex-col overflow-hidden bg-background"
      role="dialog"
      aria-label={`${vm.displayName}的${isCall ? '通话内容' : '语音留言'}详情`}
      data-testid="voicemail-detail"
    >
      {/* 顶栏：圆形返回 + 删除 */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-[54px]">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          data-testid="vm-detail-back"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.08] text-foreground transition-all active:scale-90 active:bg-foreground/[0.16]"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="删除该条留言"
          data-testid="vm-detail-delete"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.08] text-[#FF3B30] transition-all active:scale-90 active:bg-foreground/[0.16]"
        >
          <Trash2 className="h-[18px] w-[18px]" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-10">
        {/* 头像 + 名字 + 号码 */}
        <div className="flex flex-col items-center pt-3">
          <AvatarBubble contact={contact} size={96} className="shadow-xl ring-1 ring-border/60" />
          <h2 className="mt-3.5 max-w-[280px] truncate text-[24px] font-bold leading-tight">{vm.displayName}</h2>
          <p className="mt-0.5 text-[14px] text-[#0A84FF] tabular-nums">{formatNumber(vm.number)}</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground tabular-nums">
            {formatFullTime(vm.createdAt)} · {isCall ? '通话内容' : '语音留言'} · {formatDuration(vm.duration)}
          </p>
        </div>

        {/* 播放钮（TTS 回听） */}
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={onTogglePlay}
            data-testid="vm-detail-play"
            className="flex h-[52px] items-center gap-2.5 rounded-full bg-[#0A84FF] px-7 text-[16px] font-medium text-white shadow-[0_6px_20px_rgba(10,132,255,0.4)] transition-all active:scale-95"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : active ? (
              <span className="flex h-[18px] items-end gap-[3px]" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="w-[3px] animate-pulse rounded-full bg-white"
                    style={{ height: 7 + (i % 2) * 6, animationDelay: `${i * 130}ms`, animationDuration: '700ms' }}
                  />
                ))}
              </span>
            ) : (
              <Play className="h-5 w-5" fill="currentColor" strokeWidth={0} />
            )}
            {active ? '正在播放' : `播放${isCall ? '通话内容' : '留言'}`}
          </button>
        </div>

        {/* 完整内容卡片 */}
        <section className="mt-6 overflow-hidden rounded-[14px] bg-card" data-testid="vm-detail-text">
          <header className="border-b border-border/50 px-4 py-3 text-[15px] font-semibold">
            {isCall ? '这通电话说了什么' : '留言内容'}
          </header>
          {isCall ? (
            <div className="space-y-2.5 px-4 py-4">
              {dialogue.map((d, i) => (
                <div key={i} className={`flex ${d.mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[82%] ${d.mine ? 'items-end' : 'items-start'}`}>
                    {!d.mine && d.speaker && <p className="mb-0.5 px-1 text-[11.5px] text-muted-foreground">{d.speaker}</p>}
                    <p
                      className={`rounded-[16px] px-3.5 py-2 text-[14.5px] leading-snug ${
                        d.mine
                          ? 'rounded-br-[6px] bg-[#34C759]/20 text-foreground'
                          : 'rounded-bl-[6px] bg-foreground/[0.07] text-foreground'
                      }`}
                    >
                      {d.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-4 text-[15px] leading-relaxed text-foreground">{vm.text}</p>
          )}
        </section>
        <p className="mt-3 text-center text-[12px] text-muted-foreground">内容永久保存在本机，仅可手动删除</p>
      </div>
    </div>
  );
}

// ---------------- 联系人详情页（对照 iOS 18 电话联系人界面） ----------------

type DetailSegment = 'info' | 'voicemail';

function DetailSegmented({ value, onChange }: { value: DetailSegment; onChange: (v: DetailSegment) => void }) {
  const options: { key: DetailSegment; label: string }[] = [
    { key: 'info', label: '详细信息' },
    { key: 'voicemail', label: '语音留言' },
  ];
  return (
    <div role="radiogroup" aria-label="联系人详情分区" className="mx-auto flex w-fit rounded-full border border-border/50 bg-foreground/[0.04] p-[3px]">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-full px-5 py-[7px] text-[14px] font-medium leading-none transition-colors ${
            value === o.key
              ? 'bg-foreground/[0.10] text-foreground shadow-[0_1px_4px_rgba(0,0,0,0.08)]'
              : 'text-muted-foreground active:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ContactDetail({
  contact,
  logs,
  voicemails,
  playingId,
  loadingId,
  onBack,
  onCall,
  onVideoCall,
  onMessage,
  onEdit,
  showToast,
  onOpenVoicemail,
  onTogglePlay,
  onDeleteVoicemail,
  onDeleteContact,
}: {
  contact: ContactRecord;
  logs: CallLogRecord[] | null;
  voicemails: VoicemailRecord[];
  playingId: string | null;
  loadingId: string | null;
  onBack: () => void;
  onCall: (number: string, contact: ContactRecord | null) => void;
  /** 点「视频通话」（Task 22）：发起全局视频通话（iOS 黑白灰皮肤，全局层承载） */
  onVideoCall: (c: ContactRecord) => void;
  /** 点「信息」：跨 App 跳到信息 App 与该联系人的会话（相当于添加好友直达聊天） */
  onMessage: (c: ContactRecord) => void;
  onEdit: () => void;
  showToast: (msg: string) => void;
  onOpenVoicemail: (vm: VoicemailRecord) => void;
  onTogglePlay: (vm: VoicemailRecord) => void;
  onDeleteVoicemail: (vm: VoicemailRecord) => void;
  /** 删除联系人（底部红色按钮 → 确认菜单）；user 自己的号码不展示入口 */
  onDeleteContact: (c: ContactRecord) => void;
}) {
  const [segment, setSegment] = useState<DetailSegment>('info');
  const [vmSheet, setVmSheet] = useState<VoicemailRecord | null>(null);
  /** 删除联系人确认菜单 */
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);

  /** 与该联系人相关的通话记录：contactId 优先，号码归一化兜底 */
  const contactLogs = useMemo(() => {
    const key = phoneKey(contact.phone || '');
    return (logs ?? [])
      .filter((l) => (l.contactId && l.contactId === contact.id) || (!!key && phoneKey(l.number) === key))
      .slice(0, 4);
  }, [logs, contact]);

  /** 与该联系人相关的语音留言 */
  const vmList = useMemo(() => {
    const key = phoneKey(contact.phone || '');
    return voicemails.filter((v) => (v.contactId && v.contactId === contact.id) || (!!key && phoneKey(v.number) === key));
  }, [voicemails, contact]);

  const infoRows = useMemo(
    () =>
      [
        { label: '公司', value: contact.company?.trim() || '' },
        { label: '关系', value: contact.relation?.trim() || '' },
        { label: '职业', value: contact.occupation?.trim() || '' },
        { label: '地区', value: contact.region?.trim() || '' },
      ].filter((r) => r.value),
    [contact]
  );

  const actionBtn = (icon: React.ReactNode, label: string, onClick: () => void, testId?: string) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
      className="flex flex-col items-center gap-1.5 transition-opacity active:opacity-50"
    >
      <span className="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-foreground/[0.08] text-foreground transition-colors active:bg-foreground/[0.16]">
        {icon}
      </span>
    </button>
  );

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col overflow-hidden bg-background"
      role="dialog"
      aria-label={`${contact.name}的联系人详情`}
      data-testid="contact-detail"
    >
      {/* 顶栏：圆形返回 + 胶囊编辑 */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-[54px]">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          data-testid="detail-back"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.08] text-foreground transition-all active:scale-90 active:bg-foreground/[0.16]"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={onEdit}
          data-testid="detail-edit"
          className="rounded-full bg-foreground/[0.08] px-4 py-[7px] text-[15px] font-medium leading-none text-foreground transition-all active:scale-95 active:bg-foreground/[0.16]"
        >
          编辑
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {/* 大头像 + 名字 */}
        <div className="flex flex-col items-center pt-2">
          <AvatarBubble contact={contact} size={132} className="shadow-xl ring-1 ring-border/60" />
          <h2 className="mt-4 max-w-[300px] truncate text-[30px] font-bold leading-tight">{contact.name}</h2>
          <p className="mt-0.5 text-[13.5px] text-muted-foreground">{detailSubtitle(contact)}</p>
        </div>

        {/* 操作行：信息 / 电话 / 视频 / 邮件 */}
        <div className="mt-4 flex items-center justify-center gap-[18px]">
          {actionBtn(<MessageSquare className="h-[22px] w-[22px]" />, '发送信息', () => onMessage(contact), 'detail-message')}
          {actionBtn(<PhoneIcon className="h-[22px] w-[22px]" fill="currentColor" strokeWidth={0} />, '拨打电话', () => onCall(contact.phone || '', contact), 'detail-call-avatar')}
          {actionBtn(<Video className="h-[22px] w-[22px]" />, '视频通话', () => onVideoCall(contact), 'detail-video')}
          {actionBtn(<Mail className="h-[22px] w-[22px]" />, '发送邮件', () => showToast('请在「邮件」App 中发送邮件'))}
        </div>

        {/* 详细信息 / 语音留言 胶囊分段 */}
        <div className="mt-5">
          <DetailSegmented value={segment} onChange={setSegment} />
        </div>

        {segment === 'info' ? (
          <div className="mt-4 space-y-3">
            {/* 通话记录卡片 */}
            {contactLogs.length > 0 && (
              <section className="overflow-hidden rounded-[14px] bg-card" data-testid="detail-calllogs">
                <header className="flex items-center justify-between px-4 py-3">
                  <span className="text-[15px] font-semibold">通话记录</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </header>
                <ul className="border-t border-border/50">
                  {contactLogs.map((log, idx) => {
                    // #27 三态展示：endReason → 结局；旧记录无 endReason 自然回落（接通=ended / 未接通=missed）
                    const outcome = callOutcomeOf(log.endReason ?? '', log.duration > 0);
                    // 未接听保持红色（iOS 惯例）；已拒绝/已取消非红（对齐微信/QQ 通话卡片样式）
                    const missRed = outcome === 'missed';
                    const stateText =
                      outcome === 'ended'
                        ? log.direction === 'in'
                          ? '呼入'
                          : '呼出'
                        : outcome === 'rejected'
                          ? '已拒绝'
                          : outcome === 'cancelled'
                            ? '已取消'
                            : '未接来电';
                    return (
                      <li key={log.id} className={idx > 0 ? 'border-t border-border/50' : ''}>
                        <button
                          type="button"
                          onClick={() => onCall(contact.phone || log.number, contact)}
                          className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors active:bg-muted/60"
                          aria-label={`重新呼叫${contact.name}`}
                        >
                          <span className={`text-[14.5px] ${missRed ? 'text-[#FF3B30] dark:text-[#FF453A]' : ''}`}>
                            {stateText}
                          </span>
                          <span className="text-[13px] text-muted-foreground tabular-nums">
                            {formatLogTime(log.createdAt)}
                            {outcome === 'ended' ? ` · ${callDurationText(log.duration)}` : ''}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* 联系人照片与海报 */}
            <button
              type="button"
              onClick={() => showToast('联系人照片与海报即将上线')}
              className="flex w-full items-center gap-3 rounded-[14px] bg-card px-4 py-3 text-left transition-colors active:bg-muted/60"
            >
              <AvatarBubble contact={contact} size={30} />
              <span className="flex-1 text-[15px] font-semibold">联系人照片与海报</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </button>

            {/* 手机号码 */}
            {contact.phone && (
              <section className="overflow-hidden rounded-[14px] bg-card">
                <button
                  type="button"
                  onClick={() => onCall(contact.phone || '', contact)}
                  className="w-full px-4 py-3 text-left transition-colors active:bg-muted/60"
                  aria-label={`呼叫${contact.phone}`}
                >
                  <span className="block text-[13px] text-muted-foreground">手机</span>
                  <span className="mt-0.5 block text-[16px] text-[#0A84FF] tabular-nums">{contact.phone}</span>
                </button>
              </section>
            )}

            {/* 其他信息 */}
            {infoRows.length > 0 && (
              <section className="rounded-[14px] bg-card px-4">
                {infoRows.map((r, idx) => (
                  <div key={r.label} className={`flex items-center justify-between py-2.5 ${idx > 0 ? 'border-t border-border/50' : ''}`}>
                    <span className="text-[13.5px] text-muted-foreground">{r.label}</span>
                    <span className="max-w-[62%] truncate text-[14.5px]">{r.value}</span>
                  </div>
                ))}
              </section>
            )}
          </div>
        ) : (
          <div className="mt-4" data-testid="detail-voicemails">
            {vmList.length === 0 ? (
              <p className="pt-8 text-center text-[14px] text-muted-foreground">暂无语音留言</p>
            ) : (
              <ul className="overflow-hidden rounded-[14px] bg-card">
                {vmList.map((vm, idx) => (
                  <li key={vm.id} className={idx > 0 ? 'border-t border-border/50' : ''}>
                    <VoicemailRow
                      vm={vm}
                      contact={contact}
                      active={playingId === vm.id}
                      loading={loadingId === vm.id}
                      onOpen={() => onOpenVoicemail(vm)}
                      onTogglePlay={() => onTogglePlay(vm)}
                      onLongPress={() => setVmSheet(vm)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 删除联系人（底部红色整行卡片，user 自己的号码不提供删除） */}
        {contact.kind !== 'user' && (
          <button
            type="button"
            onClick={() => setDeleteSheetOpen(true)}
            data-testid="detail-delete"
            className="mt-6 flex w-full items-center justify-center rounded-[14px] bg-card px-4 py-3.5 text-[15.5px] font-medium text-[#FF3B30] transition-colors active:bg-muted/60 dark:text-[#FF453A]"
          >
            删除联系人
          </button>
        )}
      </div>

      {/* 详情内留言长按菜单 */}
      <IOSActionSheet
        open={!!vmSheet}
        actions={
          vmSheet
            ? [
                {
                  label: '播放留言',
                  onSelect: () => {
                    const vm = vmSheet;
                    setVmSheet(null);
                    onTogglePlay(vm);
                  },
                },
                {
                  label: '删除留言',
                  destructive: true,
                  onSelect: () => {
                    onDeleteVoicemail(vmSheet);
                    setVmSheet(null);
                  },
                },
              ]
            : []
        }
        onCancel={() => setVmSheet(null)}
      />

      {/* 删除联系人确认菜单（iOS 风格：红色破坏性动作 + 取消） */}
      <IOSActionSheet
        open={deleteSheetOpen}
        actions={[
          {
            label: '删除联系人',
            destructive: true,
            onSelect: () => {
              setDeleteSheetOpen(false);
              onDeleteContact(contact);
            },
          },
        ]}
        onCancel={() => setDeleteSheetOpen(false)}
      />
    </div>
  );
}

// ---------------- 编辑联系人（详情页「编辑」胶囊；与新建联系人同款全屏样式） ----------------

function QuickEditSheet({
  contact,
  onClose,
  onSaved,
}: {
  contact: ContactRecord;
  onClose: () => void;
  onSaved: (c: ContactRecord) => void;
}) {
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [relation, setRelation] = useState(contact.relation ?? '');
  const [occupation, setOccupation] = useState(contact.occupation ?? '');
  const [region, setRegion] = useState(contact.region ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      const updated = await updateContact(contact.id, {
        phone: phone.trim(),
        relation: relation.trim(),
        occupation: occupation.trim(),
        region: region.trim(),
      });
      if (!updated) throw new Error('联系人不存在');
      onSaved(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-[60] flex flex-col overflow-hidden bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="编辑联系人"
      data-testid="edit-contact-sheet"
    >
      {/* 顶栏：X 关闭 / 标题 / ✓ 保存（与新建联系人同款样式） */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-[54px]">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          data-testid="edit-close"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.08] text-foreground transition-all active:scale-90 active:bg-foreground/[0.16]"
        >
          <X className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <span className="text-[17px] font-semibold">编辑联系人</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          aria-label="保存联系人"
          data-testid="edit-save"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-[0_2px_10px_rgba(10,132,255,0.4)] transition-all active:scale-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-5 w-5" strokeWidth={3} />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-12">
        {/* 大头像（与新建联系人同款尺寸） */}
        <div className="flex flex-col items-center pt-1">
          <AvatarBubble contact={contact} size={122} className="shadow-[0_6px_20px_rgba(0,0,0,0.18)] ring-1 ring-border/60" />
        </div>

        {err && (
          <p className="mt-3 rounded-[10px] bg-red-500/10 px-3 py-2 text-center text-[13px] text-[#FF3B30]" role="alert">
            {err}
          </p>
        )}

        {/* 手机（带清除钮，样式同新建联系人的电话行） */}
        <section className="mt-4 overflow-hidden rounded-[14px] bg-card">
          <div className="flex items-center gap-2.5 border-b border-border/50 px-3.5 py-2">
            <button
              type="button"
              onClick={() => setPhone('')}
              aria-label="清除电话号码"
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#FF3B30] text-white transition-opacity active:opacity-60"
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={3.5} />
            </button>
            <span className="shrink-0 text-[15.5px] text-[#0A84FF]">手机</span>
            <ChevronRight className="-ml-1.5 h-3.5 w-3.5 shrink-0 text-[#0A84FF]/70" aria-hidden="true" />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="电话"
              aria-label="电话号码"
              inputMode="tel"
              maxLength={20}
              data-testid="edit-phone"
              className="h-[38px] min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground/70"
            />
          </div>
        </section>

        {/* 关系 / 职业 / 地区（行式输入，样式同新建联系人的姓·名·公司行） */}
        <section className="mt-4 overflow-hidden rounded-[14px] bg-card">
          <input
            value={relation}
            onChange={(e) => setRelation(e.target.value)}
            placeholder="关系（如 老朋友）"
            aria-label="关系"
            data-testid="edit-relation"
            className={ncRowInputCls}
            maxLength={60}
          />
          <input
            value={occupation}
            onChange={(e) => setOccupation(e.target.value)}
            placeholder="职业（如 司机）"
            aria-label="职业"
            data-testid="edit-occupation"
            className={ncRowInputCls}
            maxLength={40}
          />
          <input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="地区（如 广东 广州）"
            aria-label="地区"
            data-testid="edit-region"
            className={ncRowInputCls}
            maxLength={40}
          />
        </section>
      </div>
    </div>
  );
}

// ---------------- 新建联系人（通讯录右上「+」/ 键盘右上角；保存后自动加为好友） ----------------

const ncRowInputCls =
  'h-[46px] w-full border-b border-border/50 bg-transparent px-4 text-[16px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:bg-foreground/[0.03] last:border-b-0';

function NewContactSheet({
  initialPhone = '',
  onClose,
  onSaved,
}: {
  initialPhone?: string;
  onClose: () => void;
  /** 保存成功：返回已自动加为好友的新联系人 */
  onSaved: (c: ContactRecord) => void;
}) {
  const [surname, setSurname] = useState('');
  const [given, setGiven] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState(initialPhone);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [hint, setHint] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const fullName = `${surname.trim()}${given.trim()}`;
  const avatarChar = fullName ? fullName.charAt(0).toUpperCase() : '';

  const pickAvatar = (file: File | undefined) => {
    if (!file) return;
    setHint('');
    fileToAvatarDataUrl(file)
      .then(setAvatar)
      .catch(() => setErr('图片处理失败，请换一张试试'));
  };

  const save = async () => {
    setHint('');
    if (!fullName) {
      setErr('请填写联系人的姓名');
      return;
    }
    if (!stripDigits(phone)) {
      setErr('请填写电话号码，否则无法拨打');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const created = await createContact({
        kind: 'char',
        name: fullName,
        phone: phone.trim(),
        company: company.trim() || undefined,
        avatar: avatar ?? undefined,
      });
      // 创建后立即加为好友（进电话通讯录 / 信息 App）
      const friended = (await updateContact(created.id, { isFriend: true }).catch(() => null)) ?? created;
      onSaved(friended);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败，请再试一次');
      setSaving(false);
    }
  };

  const plusRow = (label: string, tip: string, testId?: string) => (
    <button
      type="button"
      onClick={() => {
        setErr('');
        setHint(tip);
      }}
      data-testid={testId}
      className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left transition-colors active:bg-muted/60"
    >
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#34C759] text-white">
        <Plus className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
      <span className="text-[15.5px]">{label}</span>
    </button>
  );

  const ringRow = (label: string) => (
    <button
      type="button"
      onClick={() => {
        setErr('');
        setHint(`${label}使用默认铃声`);
      }}
      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors active:bg-muted/60"
    >
      <span className="text-[15.5px]">{label}</span>
      <span className="flex items-center gap-0.5 text-[15.5px] text-[#0A84FF]">
        默认
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </span>
    </button>
  );

  return (
    <div
      className="absolute inset-0 z-[60] flex flex-col overflow-hidden bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="新建联系人"
      data-testid="new-contact-sheet"
    >
      {/* 顶栏：X 关闭 / 标题 / ✓ 保存 */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-[54px]">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          data-testid="new-contact-close"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.08] text-foreground transition-all active:scale-90 active:bg-foreground/[0.16]"
        >
          <X className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <span className="text-[17px] font-semibold">新建联系人</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          aria-label="保存联系人"
          data-testid="new-contact-save"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-[0_2px_10px_rgba(10,132,255,0.4)] transition-all active:scale-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-5 w-5" strokeWidth={3} />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-12">
        {/* 大头像（姓氏首字 / 照片）+ 添加照片 */}
        <div className="flex flex-col items-center pt-1">
          <div className="flex h-[122px] w-[122px] items-center justify-center overflow-hidden rounded-full bg-gradient-to-b from-[#8b8ff0] to-[#5b5fd6] text-[52px] font-medium text-white shadow-[0_6px_20px_rgba(91,95,214,0.35)]">
            {avatar ? (
              <img src={avatar} alt="联系人头像预览" className="h-full w-full object-cover" />
            ) : avatarChar ? (
              <span>{avatarChar}</span>
            ) : (
              <UserRound className="h-14 w-14 text-white/85" aria-hidden="true" />
            )}
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-3 rounded-full bg-foreground/[0.08] px-5 py-[7px] text-[15px] font-medium leading-none transition-all active:scale-95 active:bg-foreground/[0.16]"
          >
            添加照片
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              pickAvatar(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        {err && (
          <p className="mt-3 rounded-[10px] bg-red-500/10 px-3 py-2 text-center text-[13px] text-[#FF3B30]" role="alert">
            {err}
          </p>
        )}
        {hint && !err && <p className="mt-3 text-center text-[13px] text-muted-foreground">{hint}</p>}

        {/* 姓 / 名字 / 公司 */}
        <section className="mt-4 overflow-hidden rounded-[14px] bg-card">
          <input value={surname} onChange={(e) => setSurname(e.target.value)} placeholder="姓（如 李）" aria-label="姓" data-testid="new-surname" className={ncRowInputCls} maxLength={20} />
          <input value={given} onChange={(e) => setGiven(e.target.value)} placeholder="名字" aria-label="名字" data-testid="new-given" className={ncRowInputCls} maxLength={40} />
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="公司" aria-label="公司" data-testid="new-company" className={ncRowInputCls} maxLength={60} />
        </section>

        {/* 电话 */}
        <section className="mt-4 overflow-hidden rounded-[14px] bg-card">
          <div className="flex items-center gap-2.5 border-b border-border/50 px-3.5 py-2">
            <button
              type="button"
              onClick={() => setPhone('')}
              aria-label="清除电话号码"
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#FF3B30] text-white transition-opacity active:opacity-60"
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={3.5} />
            </button>
            <span className="shrink-0 text-[15.5px] text-[#0A84FF]">手机</span>
            <ChevronRight className="-ml-1.5 h-3.5 w-3.5 shrink-0 text-[#0A84FF]/70" aria-hidden="true" />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="电话"
              aria-label="电话号码"
              inputMode="tel"
              maxLength={20}
              data-testid="new-phone"
              className="h-[38px] min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground/70"
            />
          </div>
          {plusRow('添加电话', '暂时只支持保存一个电话号码', 'new-add-phone')}
        </section>

        {/* 邮箱 / 称呼代词 */}
        <section className="mt-4 overflow-hidden rounded-[14px] bg-card">{plusRow('添加电子邮件', '电子邮件暂时不支持，先填电话吧')}</section>
        <section className="mt-4 overflow-hidden rounded-[14px] bg-card">{plusRow('添加称呼代词', '称呼代词暂时不支持')}</section>

        {/* 铃声 */}
        <section className="mt-4 overflow-hidden rounded-[14px] bg-card">{ringRow('电话铃声')}</section>
        <section className="mt-3 overflow-hidden rounded-[14px] bg-card">{ringRow('短信铃声')}</section>
      </div>
    </div>
  );
}

// ---------------- App 主组件 ----------------

const TAB_META: { key: PhoneTab; label: string; icon: (active: boolean) => React.ReactNode }[] = [
  { key: 'favorites', label: '个人收藏', icon: (a) => <Star className="h-[23px] w-[23px]" strokeWidth={a ? 1.5 : 1.9} fill={a ? 'currentColor' : 'none'} /> },
  { key: 'recents', label: '最近通话', icon: (a) => <ClockIcon className="h-[23px] w-[23px]" strokeWidth={a ? 2.5 : 1.9} /> },
  { key: 'contacts', label: '通讯录', icon: (a) => <UserRound className="h-[23px] w-[23px]" strokeWidth={a ? 2.5 : 1.9} /> },
  { key: 'keypad', label: '拨号键盘', icon: () => <DialpadIcon className="h-[23px] w-[23px]" /> },
  { key: 'voicemail', label: '语音留言', icon: (a) => <VoicemailIcon className="h-[23px] w-[23px]" strokeWidth={a ? 2.3 : 1.9} /> },
];

export default function PhoneApp() {
  const [tab, setTab] = useState<PhoneTab>(() => {
    try {
      const saved = window.localStorage.getItem('ios-phone-tab');
      if (
        saved === 'favorites' ||
        saved === 'recents' ||
        saved === 'contacts' ||
        saved === 'keypad' ||
        saved === 'voicemail'
      )
        return saved;
    } catch {
      // 忽略
    }
    return 'keypad';
  });
  const [contacts, setContacts] = useState<ContactRecord[] | null>(null);
  // 全量联系人池（含未加好友的 CHAR/NPC）：拨号解析/记录回拨用——通讯录列表仍只展示好友+USER
  //（好友机制产品语义不变），但「联系人 App 里建了人、编辑了手机号」后按号码必须能拨通，
  // 否则拨号键盘输入该号码会显示「陌生号码」→ 拨出播「空号」
  const [allContacts, setAllContacts] = useState<ContactRecord[] | null>(null);
  const [logs, setLogs] = useState<CallLogRecord[] | null>(null);
  const [voicemails, setVoicemails] = useState<VoicemailRecord[] | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  // 换头像/改资料跨 App 即时生效（引用式架构）：头像只在联系人资料存一份，通话记录/通讯录/详情
  // 渲染端 avatarFor 实时解析；其他 App（联系人/微信/QQ/信息）改了头像或任意资料字段（名字/手机号/
  // 昵称…）时刷新本端联系人缓存（contact-updated），打开中的页面立刻显示新数据
  const reloadBoth = useCallback(() => {
    void listContactsFor('phone')
      .then((all) => {
        setAllContacts(all);
        setContacts(all.filter((c) => c.kind === 'user' || c.isFriend));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    window.addEventListener('contact-avatar-changed', reloadBoth);
    window.addEventListener('contact-updated', reloadBoth);
    return () => {
      window.removeEventListener('contact-avatar-changed', reloadBoth);
      window.removeEventListener('contact-updated', reloadBoth);
    };
  }, [reloadBoth]);
  const [callTarget, setCallTarget] = useState<CallTarget | null>(null);
  // #8 最新通话目标（consumePendingAnswer 判断「通话中收到新来电」用；渲染期同步，同 runTurnRef 模式）
  const callTargetRef = useRef<CallTarget | null>(null);
  callTargetRef.current = callTarget;
  // 全局 toast（consumePendingAnswer 引用 showToast，故上移到其声明之前）
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2200);
  }, []);
  // 全局来电层接听的 AI 电话：进入电方向的通话界面（接听时全局层已 switchToApp 打开本 App，
  // AI 先开口）。消费幂等（取走即清），两个时机：
  // ① 挂载时消费——跨 App 接听：来电层 switchToApp 打开本 App 后由这里取走 pending；
  // ② 监听消费事件——本 App 已在前台时接听，switchToApp 无事发生、挂载消费不会重跑，
  //    来电层派发 PENDING_PHONE_ANSWER_EVENT 让这里立即进通话界面（幽灵来电修复）；
  //    锁屏时接听的 pending 由来电层在解锁后兜底派发，同样走这里。
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  /** 语音留言详情页（列表/联系人详情里点行进入） */
  const [vmDetailId, setVmDetailId] = useState<string | null>(null);
  /** 新建联系人（通讯录右上「+」/ 键盘右上角，可预填号码） */
  const [newContact, setNewContact] = useState<{ open: boolean; phone: string }>({ open: false, phone: '' });
  const [playingVmId, setPlayingVmId] = useState<string | null>(null);
  const [loadingVmId, setLoadingVmId] = useState<string | null>(null);
  // 电话 App 右上角设置图标 Sheet（主动来电开关 + 频率档位，从设置 › 通知页迁移到此）
  const [proactiveSheetOpen, setProactiveSheetOpen] = useState(false);
  const [proactive, setProactive] = useState<boolean>(() => isProactiveCallEnabled());
  const [proactiveLevel, setProactiveLevelState] = useState<ProactiveLevel>(() => getProactiveLevel());
  const PROACTIVE_LEVEL_OPTIONS: { value: ProactiveLevel; label: string; desc: string }[] = [
    { value: 'conservative', label: '保守', desc: '2h 间隔·6h 冷却·120s 轮询' },
    { value: 'standard', label: '标准', desc: '30min 间隔·1h 冷却·60s 轮询（推荐）' },
    { value: 'eager', label: '积极', desc: '10min 间隔·15min 冷却·45s 轮询' },
    { value: 'off', label: '关闭', desc: '完全关闭 AI 主动来电（聊天内标记来电同样不拨出）' },
  ];
  // 多账号（Task 40-2d v2）：电话 App 当前账号身份（匿名号时记住其资料，供拨号键盘脱敏徽标/身份 chip 高亮）。
  // 切号不刷新网页：switchAccountFor 派发 ACCOUNT_CHANGED_EVENT → 下方监听更新本 state + 重读数据
  const [anonAcc, setAnonAcc] = useState<PhoneAccount | null>(() => {
    const acc = getActiveAccountFor('phone');
    return acc.kind === 'anon' ? acc : null;
  });
  // 电话账号切换版本号：每次变化 +1 → 驱动初始加载 effect 按新账号重读通话记录/留言；
  // ref 供异步加载回调校验「读到的还是不是最新账号」，防旧请求晚到覆盖新账号数据
  const [accVer, setAccVer] = useState(0);
  const accVerRef = useRef(0);
  accVerRef.current = accVer;
  /** 匿名号码切换弹层（拨号键盘「匿名号码」身份 chip 入口，与信息 App 共用 AnonSwitchSheet） */
  const [anonSheetOpen, setAnonSheetOpen] = useState(false);
  // 长按「匿名号码」chip → 删除确认（Task 40 修正）：删前自动切回主号；其他 App 正在使用的账号删除时也会自动退出该账号
  const [delAnon, setDelAnon] = useState<{ id: string; phone: string } | null>(null);
  const [delAnonErr, setDelAnonErr] = useState('');
  const confirmDelAnon = useCallback(async () => {
    const t = delAnon;
    if (!t) return;
    try {
      // 电话当前正用这个匿名号 → 先切回主号再删（其他 App 若也在用，deleteAccount 自动切回大号退出该账号）
      if (getActiveAccountIdFor('phone') === t.id) switchAccountFor('phone', MAIN_ACCOUNT_ID);
      const res = await deleteAccount(t.id);
      if (res.ok) {
        setDelAnon(null);
        setDelAnonErr('');
        showToast('已删除匿名号码');
      } else {
        setDelAnonErr(res.error || '删除失败');
      }
    } catch {
      setDelAnonErr('删除失败，请稍后重试');
    }
  }, [delAnon, showToast]);
  const vmAudioRef = useRef<HTMLAudioElement | null>(null);
  const switchToApp = useUI((s) => s.switchToApp);
  const setPendingChatContact = useUI((s) => s.setPendingChatContact);

  // 初始加载：联系人（本地 IndexedDB）+ 通话记录 / 语音留言 / 收藏（IndexedDB）；
  // 依赖 accVer：电话账号切换（不刷新网页）后 +1 重跑，按新账号重读
  useEffect(() => {
    const ver = accVerRef.current;
    let alive = true;
    void (async () => {
      try {
        // 头像按 App 投影：电话 App（通讯录/拨号/收藏/详情/通话记录渲染共用本 state）读 phone 槽位，
        // 无槽位回退全局默认头像；联系人 App 里的全局默认头像不受影响。
        // allContacts 存全量（含未加好友的 CHAR/NPC），供拨号解析/记录回拨按号码匹配（编辑同步修复）
        const all = await listContactsFor('phone');
        if (alive) {
          setAllContacts(all);
          setContacts(all.filter((c) => c.kind === 'user' || c.isFriend));
        }
      } catch {
        if (alive) {
          setAllContacts([]);
          setContacts([]);
        }
      }
      try {
        const all = await localDB.getAll('call-logs');
        // 多账号（Task 40-2d）：只展示电话 App 当前账号的记录（旧记录无 account 字段视为大号）
        const phoneAccId = getActiveAccountIdFor('phone');
        const scoped = all.filter((l) => (l.account ?? 'main') === phoneAccId);
        // 删好友可见性门控：被删好友（微信/QQ 两端都不再是好友且有过删除）的通话记录隐藏，
        // 数据本体保留在 IndexedDB，重新加回好友后自动恢复显示
        const visible: CallLogRecord[] = [];
        for (const l of scoped) {
          if (l.contactId && (await isPersonGoneEverywhere(l.contactId))) continue;
          visible.push(l);
        }
        if (alive && accVerRef.current === ver) setLogs(visible.sort((a, b) => b.createdAt - a.createdAt));
      } catch {
        if (alive && accVerRef.current === ver) setLogs([]);
      }
      try {
        const vms = await localDB.getAll('voicemails');
        // 多账号（Task 40-2d）：留言同样只取电话 App 当前账号的（角标/列表随账号切换）
        const phoneAccId = getActiveAccountIdFor('phone');
        if (alive && accVerRef.current === ver) {
          setVoicemails(vms.filter((v) => (v.account ?? 'main') === phoneAccId).sort((a, b) => b.createdAt - a.createdAt));
        }
      } catch {
        if (alive && accVerRef.current === ver) setVoicemails([]);
      }
      try {
        const rec = await localDB.get('settings', FAV_KEY);
        if (alive && rec && Array.isArray(rec.value)) setFavorites(rec.value as string[]);
      } catch {
        // 忽略
      }
    })();
    return () => {
      alive = false;
    };
  }, [accVer]);

  // 卸载时停掉留言播放
  useEffect(
    () => () => {
      if (vmAudioRef.current) {
        vmAudioRef.current.pause();
        vmAudioRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    try {
      window.localStorage.setItem('ios-phone-tab', tab);
    } catch {
      // 忽略
    }
  }, [tab]);

  const persistFavorites = useCallback((ids: string[]) => {
    setFavorites(ids);
    void localDB.put('settings', { key: FAV_KEY, value: ids });
  }, []);

  const toggleFavorite = useCallback(
    (id: string) => {
      const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
      persistFavorites(next);
      const c = contacts?.find((x) => x.id === id);
      showToast(favorites.includes(id) ? `已从个人收藏移除${c ? `「${c.name}」` : ''}` : `已收藏${c ? `「${c.name}」` : ''}`);
    },
    [favorites, contacts, persistFavorites, showToast]
  );

  const startCall = useCallback(
    (number: string, contact: ContactRecord | null) => {
      const digits = stripDigits(number);
      if (!digits) {
        showToast('这个联系人没有电话号码');
        return;
      }
      // #19 通话进行中（本 App 或微信/QQ 全局通话）防并发拨打——音频叠加体验差，需先挂断；
      // 原逻辑静默返回无 toast，用户在通话中点联系人拨打按钮什么反馈都没有
      if (callTarget) {
        showToast('通话进行中，请先挂断');
        return;
      }
      if (useGlobalCall.getState().session) {
        showToast('通话进行中，请先挂断');
        return;
      }
      // #32 来电响铃中不拨出：来电弹窗/全屏来电界面还在响铃时再拨出会双音频叠加、且会顶掉
      // 未处理的来电（对照 wechat.tsx openVoiceCall 同款守卫；响铃中接听走 consumePendingAnswer，不经这里）
      if (useIncomingCall.getState().call) {
        showToast('有来电正在响铃，请先处理');
        return;
      }
      // 电话 ↔ 联系人联动：未显式指定联系人时，按「联系人里填的电话」匹配出对应人。
      // 用全量池（含未加好友的 CHAR/NPC）：联系人 App 里建的任何人有号码就能拨通；
      // 解析到人时号码一律以联系人当前号码为准——改号后从记录回拨等入口可能带来旧号
      // （记录快照是拨号时的号码），拨旧号会播「空号」/打到旧身份
      const resolved = contact ?? findContactByNumber(allContacts ?? [], digits);
      const finalDigits = resolved?.phone && stripDigits(resolved.phone) ? stripDigits(resolved.phone) : digits;
      // 自己的号码（user）也允许拨打：接通后对方不说话、说的话不需要回复（见 CallScreen）
      setCallTarget({ number: finalDigits, contact: resolved });
    },
    [allContacts, callTarget, contacts, showToast]
  );

  /** 通话结束：写日志 + 刷新列表（多账号 Task 40-2d：记录归属电话 App 当前账号——
   *  CallScreen onEnd / 视频通话 onEnd 的记录对象统一在这里盖账号戳后再入库） */
  const handleCallEnd = useCallback((log: CallLogRecord) => {
    const stamped: CallLogRecord = { ...log, account: getActiveAccountIdFor('phone') };
    setLogs((prev) => {
      const base = prev ?? [];
      return [stamped, ...base].sort((a, b) => b.createdAt - a.createdAt);
    });
    void localDB.put('call-logs', stamped);
  }, []);

  /** 通话结束落一条语音留言：kind='call'（对话内容存档）不弹「发来留言」提示；未接通留言才提示。
   *  多账号（Task 40-2d）：留言归属电话 App 当前账号（CallScreen 各路径的留言对象统一在这里盖账号戳）。
   *  声明在 startVideoCall 之前：视频转写存档（Task 54）也走这里 */
  const handleVoicemail = useCallback(
    (vm: VoicemailRecord) => {
      const stamped: VoicemailRecord = { ...vm, account: getActiveAccountIdFor('phone') };
      setVoicemails((prev) => {
        const base = prev ?? [];
        return [stamped, ...base].sort((a, b) => b.createdAt - a.createdAt);
      });
      void localDB.put('voicemails', stamped);
      showToast(
        vm.kind === 'call'
          ? `与「${vm.displayName}」的通话内容已永久保存到语音留言`
          : `「${vm.displayName}」给你发来一条语音留言`
      );
    },
    [showToast]
  );

  const consumePendingAnswer = useCallback(() => {
    const pending = takePendingPhoneAnswer();
    if (!pending) return;
    // #8 已有通话进行中：新来电不替换正在进行的通话（与 startCall 的防替换口径一致），也不再静默
    // 丢弃——toast + 落一条「未接来电」记录（与 AI 来电被拒/超时的 recordMissedPhoneCall 落库同
    // 口径，进最近通话可回看漏了谁；不触发 AI 留言，选最小实现）
    if (callTargetRef.current) {
      const missed: CallLogRecord = {
        id: genId(),
        number: pending.number,
        contactId: pending.contact?.id ?? null,
        displayName: pending.contact?.name ?? pending.name,
        peerKind: (pending.contact?.kind as CallLogRecord['peerKind']) ?? 'unknown',
        avatar: pending.contact?.avatar ?? null,
        direction: 'missed',
        duration: 0,
        // 多账号（Task 40-2d）：记录归属电话 App 当前账号
        account: getActiveAccountIdFor('phone'),
        createdAt: Date.now(),
      };
      setLogs((prev) => [missed, ...(prev ?? [])].sort((a, b) => b.createdAt - a.createdAt));
      void localDB.put('call-logs', missed);
      showToast('通话中，已忽略新来电');
      return;
    }
    // AI 主动来电目的（pending.proactiveContext，Task 40-d 写入）：随 CallTarget 透传进
    // 该通电话所有 turn payload 的 proactiveContext（普通来电/拨出无此字段，不注入）
    const proactive = pending.proactiveContext;
    // C14 AI 主动视频来电：决策端选 video 时接听直接进全局层视频通话页（不进语音 CallScreen）；
    // direction='in' 通话记录/存档/续聊全按来电方向落，proactiveContext 透传开场情境
    if (pending.media === 'video') {
      const resolved = pending.contact;
      const number = pending.number;
      const vAcc = getActiveAccountFor('phone');
      const vUnknown =
        vAcc.kind === 'anon' ||
        (vAcc.kind === 'alt' && !(resolved?.relationByAcc?.[vAcc.id] ?? '').trim());
      startGlobalCall({
        variant: 'phone',
        media: 'video',
        name: resolved?.name ?? pending.name,
        avatar: resolved?.avatar ?? null,
        myAvatar:
          allContacts?.find((c) => c.kind === 'user' && !c.altOf)?.avatar ||
          useSettings.getState().profile.avatar,
        contact: resolved,
        direction: 'in',
        initialHistory: [],
        memoryBlock:
          resolved?.id && !vUnknown ? (memRecallBlock(resolved.id, 'phone', '') || undefined) : undefined,
        ...(proactive ? { proactiveContext: proactive } : {}),
        onEnd: (r) => {
          handleCallEnd({
            id: genId(),
            number,
            contactId: resolved?.id ?? null,
            displayName: resolved?.name ?? pending.name,
            peerKind: resolved ? (resolved.kind as CallLogRecord['peerKind']) : 'unknown',
            avatar: resolved?.avatar ?? null,
            direction: 'in',
            duration: r.duration,
            endReason: r.endReason,
            media: 'video',
            createdAt: Date.now(),
          });
          const vmTurns = (r.transcript ?? []).filter((t) => t.content.trim().length > 0);
          if (resolved?.id && resolved.kind !== 'user' && r.connected && vmTurns.length > 0) {
            handleVoicemail({
              id: genId(),
              number,
              contactId: resolved.id,
              displayName: resolved.name,
              peerKind: resolved.kind as VoicemailRecord['peerKind'],
              avatar: resolved.avatar ?? null,
              text: vmTurns.map((t) => `${t.role === 'user' ? '我' : resolved.name}：${t.content}`).join('\n'),
              duration: r.duration,
              read: true,
              createdAt: Date.now(),
              kind: 'call',
            });
          }
        },
      });
      return;
    }
    setCallTarget((prev) =>
      prev ?? {
        number: pending.number,
        contact: pending.contact,
        direction: 'in',
        ...(proactive ? { proactiveContext: proactive } : {}),
      },
    );
  }, [showToast, allContacts, handleCallEnd, handleVoicemail]);
  useEffect(() => {
    consumePendingAnswer();
    window.addEventListener(PENDING_PHONE_ANSWER_EVENT, consumePendingAnswer);
    return () => window.removeEventListener(PENDING_PHONE_ANSWER_EVENT, consumePendingAnswer);
  }, [consumePendingAnswer]);

  /** Task 22 视频通话：联系人详情「视频通话」→ 全局通话层视频页（variant='phone' iOS 黑白灰皮肤）。
   *  与语音 CallScreen 完全独立（语音引擎不动）；引擎为三端共用 useChatCall（media='video'），
   *  接通/字幕/记忆/挂断续聊全部复用；通话记录落 CallLogRecord（media:'video'，记录行显示视频图标） */
  const startVideoCall = useCallback(
    (contact: ContactRecord | null) => {
      if (useGlobalCall.getState().session) {
        showToast('通话进行中，请先挂断');
        return;
      }
      if (useIncomingCall.getState().call) {
        showToast('有来电正在响铃，请先处理');
        return;
      }
      if (callTarget) {
        showToast('通话进行中，请先挂断');
        return;
      }
      const resolved = contact;
      const number = resolved?.phone || resolved?.id || 'unknown';
      // 陌生来电判定（与 CallScreen 同口径，多账号）：匿名号/未登记分账号关系的小号拨出的视频通话，
      // AI 不知道来电人是谁——不下发记忆（服务端 chat-call 引擎同样按陌生来电框架组装人设）
      const vcAcc = getActiveAccountFor('phone');
      const vcCallerUnknown =
        vcAcc.kind === 'anon' ||
        (vcAcc.kind === 'alt' && !(resolved?.relationByAcc?.[vcAcc.id] ?? '').trim());
      startGlobalCall({
        variant: 'phone',
        media: 'video',
        name: resolved?.name ?? number,
        avatar: resolved?.avatar ?? null,
        // Task 27：用户（机主）头像——视频通话关摄像头时显示它；
        // 同步修复：优先机主联系人头像（联系人 App 改了自己头像即生效，allContacts 已按 phone 投影），
        // 设置›个人信息头像作兑底（两者双向同步，见 PhoneShell）
        myAvatar:
          allContacts?.find((c) => c.kind === 'user' && !c.altOf)?.avatar ||
          useSettings.getState().profile.avatar,
        contact: resolved,
        direction: 'out',
        initialHistory: [],
        // 电话 App 记忆召回（与语音通话同库同池：文字/语音/视频互通）；陌生来电不下发
        memoryBlock:
          resolved?.id && !vcCallerUnknown ? (memRecallBlock(resolved.id, 'phone', '') || undefined) : undefined,
        onEnd: (r) => {
          handleCallEnd({
            id: genId(),
            number,
            contactId: resolved?.id ?? null,
            displayName: resolved?.name ?? number,
            peerKind: resolved ? (resolved.kind as CallLogRecord['peerKind']) : 'unknown',
            avatar: resolved?.avatar ?? null,
            direction: 'out',
            duration: r.duration,
            endReason: r.endReason,
            media: 'video',
            createdAt: Date.now(),
          });
          // 视频通话转写存档（与语音通话同口径）：接通挂断后把整通对话内容存成 kind='call' 语音留言
          //（永久保存可回看；handleVoicemail 对 kind='call' 有专属提示文案）；挂断续聊不在此内
          const vmTurns = (r.transcript ?? []).filter((t) => t.content.trim().length > 0);
          if (resolved?.id && resolved.kind !== 'user' && r.connected && vmTurns.length > 0) {
            handleVoicemail({
              id: genId(),
              number,
              contactId: resolved.id,
              displayName: resolved.name,
              peerKind: resolved.kind as VoicemailRecord['peerKind'],
              avatar: resolved.avatar ?? null,
              text: vmTurns.map((t) => `${t.role === 'user' ? '我' : resolved.name}：${t.content}`).join('\n'),
              duration: r.duration,
              read: true,
              createdAt: Date.now(),
              kind: 'call',
            });
          }
        },
      });
    },
    [callTarget, showToast, handleCallEnd, handleVoicemail, allContacts]
  );

  const stopVmAudio = useCallback(() => {
    if (vmAudioRef.current) {
      vmAudioRef.current.pause();
      vmAudioRef.current = null;
    }
    setPlayingVmId(null);
  }, []);

  // 多账号（Task 40-2d v2）：电话账号切换事件（switchAccountFor 派发，不刷新网页）——
  // 更新身份 state + 停掉在播留言 + 把列表重置为加载态（防上一账号数据闪现），
  // 再由上方加载 effect（accVer 驱动）按新账号重读；角标随 voicemails 重载后的既有同步 effect 重算。
  // 其他 App（wx/qq/sms）的切号事件对本 App 无影响，忽略。
  useEffect(() => {
    const fn = (e: Event) => {
      const detail = (e as CustomEvent<{ app?: string; id?: string }>).detail;
      if (!detail || detail.app !== 'phone') return;
      const acc = getActiveAccountFor('phone');
      setAnonAcc(acc.kind === 'anon' ? acc : null);
      stopVmAudio();
      setLogs(null);
      setVoicemails(null);
      setAccVer((v) => v + 1);
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, fn);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, fn);
  }, [stopVmAudio]);

  /** 播放/暂停一条语音留言（优先用户语音 API 的联系人音色，失败回退内置 TTS；播放即标为已读） */
  const toggleVmPlay = useCallback(
    async (vm: VoicemailRecord) => {
      if (playingVmId === vm.id) {
        stopVmAudio();
        stopSpeaking();
        return;
      }
      stopVmAudio();
      stopSpeaking();
      setLoadingVmId(vm.id);
      const markRead = () => {
        if (!vm.read) {
          const next = { ...vm, read: true };
          setVoicemails((prev) => (prev ? prev.map((v) => (v.id === vm.id ? next : v)) : prev));
          void localDB.put('voicemails', next);
        }
      };
      try {
        let played = false;
        // ① 用户语音 API：按留言联系人实时解析音色（角色 voiceId → 全局默认 → 安全默认）
        if (isTtsConfigured()) {
          try {
            setPlayingVmId(vm.id);
            await speakUserTts({
              text: vm.text,
              contactId: vm.contactId || null,
              onEnd: () => setPlayingVmId(null),
            });
            played = true;
          } catch {
            setPlayingVmId(null); // 合成失败 → 回退内置朗读
          }
        }
        // ② 内置朗读（原有链路）
        if (!played) {
          try {
            const contact = contacts?.find((c) => c.id === vm.contactId) ?? null;
            // #20 通话链路超时看门狗：留言合成 30s 到点必失败（catch 后 toast 友好提示）
            const res = await fetch('/api/phone/tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: vm.text, gender: contactGender(contact), speed: expressStyleTtsSpeed(contact?.expressStyle) }), // B4 表达风格联动语速
              signal: AbortSignal.timeout(30000),
            });
            if (!res.ok) throw new Error('tts failed');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            vmAudioRef.current = audio;
            audio.onended = () => {
              URL.revokeObjectURL(url);
              if (vmAudioRef.current === audio) vmAudioRef.current = null;
              setPlayingVmId(null);
            };
            setPlayingVmId(vm.id);
            await audio.play().catch(() => {
              URL.revokeObjectURL(url);
              if (vmAudioRef.current === audio) vmAudioRef.current = null;
              setPlayingVmId(null);
              showToast('留言播放失败，请再试一次');
            });
          } catch {
            showToast('留言播放失败，请再试一次');
          }
        }
        markRead();
      } finally {
        setLoadingVmId(null);
      }
    },
    [contacts, playingVmId, showToast, stopVmAudio]
  );

  const deleteVoicemail = useCallback(
    (vm: VoicemailRecord) => {
      if (playingVmId === vm.id) stopVmAudio();
      void localDB.delete('voicemails', vm.id);
      setVoicemails((prev) => (prev ? prev.filter((v) => v.id !== vm.id) : prev));
      showToast('已删除留言');
    },
    [playingVmId, stopVmAudio, showToast]
  );

  const toggleVmRead = useCallback((vm: VoicemailRecord) => {
    const next = { ...vm, read: !vm.read };
    setVoicemails((prev) => (prev ? prev.map((v) => (v.id === vm.id ? next : v)) : prev));
    void localDB.put('voicemails', next);
  }, []);

  /** 打开留言详情页：顺便标为已读 */
  const openVmDetail = useCallback(
    (vm: VoicemailRecord) => {
      setVmDetailId(vm.id);
      if (!vm.read) {
        const next = { ...vm, read: true };
        setVoicemails((prev) => (prev ? prev.map((v) => (v.id === vm.id ? next : v)) : prev));
        void localDB.put('voicemails', next);
      }
    },
    []
  );

  const clearLogs = useCallback(() => {
    // 多账号（Task 40-2d）：只清除电话 App 当前账号的通话记录（其他账号数据保留）
    void (async () => {
      try {
        const acc = getActiveAccountIdFor('phone');
        const all = await localDB.getAll('call-logs');
        await Promise.all(
          all
            .filter((l) => (l.account ?? 'main') === acc)
            .map((l) => localDB.delete('call-logs', l.id)),
        );
      } catch {
        // 存储异常静默（列表已清空，残留记录下次载入时仍按账号过滤不可见）
      }
    })();
    setLogs([]);
    showToast('已清除全部通话记录');
  }, [showToast]);

  const deleteLog = useCallback((log: CallLogRecord) => {
    void localDB.delete('call-logs', log.id);
    setLogs((prev) => (prev ? prev.filter((l) => l.id !== log.id) : prev));
    showToast('已删除该条记录');
  }, [showToast]);

  /** 联系人详情页「删除联系人」：本地删除（NPC 名下级联删）→ 同步移除 → 清理收藏 → 关闭详情 */
  const deleteContact = useCallback(
    async (c: ContactRecord) => {
      try {
        const removed = await deleteContactLocal(c.id);
        if (!removed) throw new Error('联系人不存在');
        // 本地同步移除：主体 + 被级联删除的 NPC（ownerId 指向被删者）
        setContacts((prev) => (prev ? prev.filter((x) => x.id !== c.id && x.ownerId !== c.id) : prev));
        setAllContacts((prev) => (prev ? prev.filter((x) => x.id !== c.id && x.ownerId !== c.id) : prev));
        // 从个人收藏里清理
        if (favorites.includes(c.id)) persistFavorites(favorites.filter((f) => f !== c.id));
        setDetailId(null);
        setEditSheetOpen(false);
        showToast(`已删除联系人「${c.name}」`);
      } catch (e) {
        showToast(e instanceof Error ? e.message : '删除失败，请再试一次');
      }
    },
    [favorites, persistFavorites, showToast]
  );

  /** 详情页「信息」：跨 App 跳到信息 App 与该联系人的会话（相当于添加好友直达聊天）；
   *  通话中/已在前台的 App 间切换用 switchToApp（openApp 只在无前台 App 时生效） */
  const messageContact = useCallback(
    (c: ContactRecord) => {
      if (c.kind === 'user') {
        showToast('不能给自己发信息');
        return;
      }
      setPendingChatContact(c.id);
      switchToApp('chat');
    },
    [setPendingChatContact, switchToApp, showToast]
  );

  const detailContact = useMemo(() => allContacts?.find((c) => c.id === detailId) ?? null, [allContacts, detailId]);
  const vmDetail = useMemo(() => (voicemails ?? []).find((v) => v.id === vmDetailId) ?? null, [voicemails, vmDetailId]);
  const vmDetailContact = useMemo(
    () => (vmDetail ? allContacts?.find((c) => c.id === vmDetail.contactId) ?? null : null),
    [vmDetail, allContacts]
  );
  const loading = contacts === null;
  // 多账号（Task 40-2d）：未读留言数按电话 App 当前账号过滤（state 本身已按账号载入，
  // 这里再过滤一道是渲染期冗余保障，切号重载间隙旧数据不会误算进角标）
  const phoneAccId = getActiveAccountIdFor('phone');
  const unreadVmCount = (voicemails ?? []).filter((v) => !v.read && (v.account ?? 'main') === phoneAccId).length;

  // 主屏电话图标红点同步：未读语音留言数 → unread-store 总线（与微信/QQ 同款；留言载入/已读/删除都会重算）
  useEffect(() => {
    if (voicemails === null) return; // 等 IndexedDB 载入后再同步，避免载入前把已有角标误清成 0
    phoneBadge.set(unreadVmCount);
  }, [voicemails, unreadVmCount]);

  return (
    <IOSScreen>
      <div className="relative flex h-full w-full flex-col overflow-hidden">
        {/* 紧凑标题：小字号居中，与左侧返回键同一行对齐（用户要求标签小一点、和返回键对齐） */}
        <IOSNavBar
          title={TAB_META.find((t) => t.key === tab)?.label ?? '电话'}
          large={false}
          left={
            <>
              {/* 返回主屏幕键（所有 tab 常驻左上） */}
              <BackToHome className="static!" />
            </>
          }
          right={
            <div className="flex items-center gap-1">
              {/* 电话 App 右上角设置图标（所有 tab 常驻）：点开弹 Sheet 配置 AI 主动来电开关 + 频率档位 */}
              <button
                type="button"
                onClick={() => setProactiveSheetOpen(true)}
                aria-label="主动来电设置"
                data-testid="phone-proactive-settings"
                className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors active:bg-foreground/10"
              >
                <SettingsIcon className="h-[22px] w-[22px]" strokeWidth={2} />
              </button>
              {tab === 'contacts' ? (
                <button
                  type="button"
                  onClick={() => setNewContact({ open: true, phone: '' })}
                  aria-label="新建联系人（添加好友）"
                  data-testid="add-contact"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[#0A84FF] transition-colors active:bg-[#0A84FF]/10"
                >
                  <Plus className="h-[24px] w-[24px]" strokeWidth={2} />
                </button>
              ) : tab === 'recents' && logs && logs.length > 0 ? (
                /* 最近通话的「编辑」：右上角（用户要求从左侧移过来） */
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="rounded-full bg-foreground/[0.08] px-4 py-[7px] text-[15px] font-medium leading-none text-foreground transition-all active:scale-95 active:bg-foreground/[0.16]"
                  data-testid="edit-logs"
                >
                  编辑
                </button>
              ) : null}
            </div>
          }
        />

        {toast && (
          <div className="pointer-events-none absolute left-1/2 top-[104px] z-40 -translate-x-1/2" role="status">
            <p className="rounded-full bg-foreground/85 px-4 py-1.5 text-[13px] text-background shadow-lg">{toast}</p>
          </div>
        )}

        {tab === 'favorites' && (
          <FavoritesTab contacts={contacts ?? []} favorites={favorites} onCall={startCall} onToggleFavorite={toggleFavorite} />
        )}
        {tab === 'recents' && (
          <RecentsTab logs={logs} contacts={allContacts ?? []} onCall={startCall} onDelete={deleteLog} />
        )}
        {tab === 'contacts' && (
          <ContactsTab
            contacts={contacts ?? []}
            favorites={favorites}
            onOpenDetail={(c) => setDetailId(c.id)}
            onToggleFavorite={toggleFavorite}
            onAddFriend={() => setNewContact({ open: true, phone: '' })}
            loading={loading}
          />
        )}
        {tab === 'keypad' && (
          <KeypadTab
            contacts={allContacts ?? []}
            onCall={startCall}
            onNewContact={(phone) => setNewContact({ open: true, phone })}
            anonPhone={anonAcc ? anonAcc.phone : null}
            onOpenAnon={() => setAnonSheetOpen(true)}
            onAnonLongPress={() => {
              if (anonAcc) {
                setDelAnonErr('');
                setDelAnon({ id: anonAcc.id, phone: anonAcc.phone });
              } else {
                setAnonSheetOpen(true);
              }
            }}
          />
        )}
        {tab === 'voicemail' && (
          <VoicemailTab
            voicemails={voicemails}
            contacts={allContacts ?? []}
            playingId={playingVmId}
            loadingId={loadingVmId}
            onOpen={openVmDetail}
            onTogglePlay={(vm) => void toggleVmPlay(vm)}
            onDelete={deleteVoicemail}
            onToggleRead={toggleVmRead}
          />
        )}

        {/* 底部五段 tab（iOS 18 悬浮胶囊样式） */}
        <nav
          role="tablist"
          aria-label="电话分区"
          className="z-20 shrink-0 bg-background/85 px-3 pb-[calc(20px+env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl"
        >
          <div className="mx-auto flex items-stretch justify-between gap-[2px] rounded-full border border-border/50 bg-muted/70 p-1 shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
            {TAB_META.map((t) => {
              const active = tab === t.key;
              const badge = t.key === 'voicemail' ? unreadVmCount : 0;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  data-testid={`tab-${t.key}`}
                  className={`relative flex flex-1 flex-col items-center gap-[2px] rounded-full py-[7px] transition-colors ${
                    active ? 'bg-foreground/[0.08] text-[#0A84FF]' : 'text-muted-foreground/75 active:text-foreground'
                  }`}
                >
                  <span className="relative">
                    {t.icon(active)}
                    {badge > 0 && (
                      <span
                        className="absolute -right-2.5 -top-1.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#FF3B30] px-1 text-[9.5px] font-semibold leading-none text-white"
                        aria-label={`${badge}条未读留言`}
                      >
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] font-medium leading-none">{t.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* 联系人详情页（覆盖 tab 区，通话层 z-50 在其上） */}
        {detailId && detailContact && (
          <ContactDetail
            contact={detailContact}
            logs={logs}
            voicemails={voicemails ?? []}
            playingId={playingVmId}
            loadingId={loadingVmId}
            onBack={() => setDetailId(null)}
            onCall={startCall}
            onVideoCall={startVideoCall}
            onMessage={messageContact}
            onEdit={() => setEditSheetOpen(true)}
            showToast={showToast}
            onOpenVoicemail={openVmDetail}
            onTogglePlay={(vm) => void toggleVmPlay(vm)}
            onDeleteVoicemail={deleteVoicemail}
            onDeleteContact={(c) => void deleteContact(c)}
          />
        )}

        {/* 语音留言详情页（在联系人详情之上） */}
        {vmDetail && (
          <VoicemailDetail
            vm={vmDetail}
            contact={vmDetailContact}
            active={playingVmId === vmDetail.id}
            loading={loadingVmId === vmDetail.id}
            onBack={() => setVmDetailId(null)}
            onTogglePlay={() => void toggleVmPlay(vmDetail)}
            onDelete={() => {
              deleteVoicemail(vmDetail);
              setVmDetailId(null);
            }}
          />
        )}

        {/* 新建联系人（通讯录「+」/ 键盘右上角；保存后自动加为好友） */}
        {newContact.open && (
          <NewContactSheet
            initialPhone={newContact.phone}
            onClose={() => setNewContact({ open: false, phone: '' })}
            onSaved={(c) => {
              setContacts((prev) => {
                const base = prev ?? [];
                return [c, ...base];
              });
              setAllContacts((prev) => (prev ? [c, ...prev] : prev));
              setNewContact({ open: false, phone: '' });
              showToast(`已添加「${c.name}」为好友`);
            }}
          />
        )}

        {/* 详情页快捷编辑（手机号/关系/职业/地区 → 本地 updateContact） */}
        {detailContact && editSheetOpen && (
          <QuickEditSheet
            contact={detailContact}
            onClose={() => setEditSheetOpen(false)}
            onSaved={(c) => {
              // 快捷编辑不含头像（不写 avatar/avatars），但 updateContact 返回的是未投影原始记录：
              // 若该联系人设过 phone 槽位头像，直接回写 state 会让头像闪回全局默认——按 phone 投影后再入列表
              const shown = withAvatarForApp(c, 'phone');
              setContacts((prev) => (prev ? prev.map((x) => (x.id === shown.id ? shown : x)) : prev));
              setAllContacts((prev) => (prev ? prev.map((x) => (x.id === shown.id ? shown : x)) : prev));
              // 小号档案在电话 App 里快捷编辑 → 名字/号码同步注册表账号（与联系人 App 编辑同款口径：
              // 微信/QQ 登录列表、账号页等展示取注册表兑底）
              if (c.altOf) {
                updateAccount(c.altOf, {
                  name: c.name,
                  phone: c.phone ?? '',
                  qqId: c.qqId ?? '',
                  wechatId: c.wechatId ?? '',
                });
              }
              setEditSheetOpen(false);
              showToast('已保存');
            }}
          />
        )}

        {/* 编辑通话记录（清除全部） */}
        <IOSActionSheet
          open={editOpen}
          actions={[
            {
              label: '清除全部通话记录',
              destructive: true,
              onSelect: () => {
                setEditOpen(false);
                clearLogs();
              },
            },
          ]}
          onCancel={() => setEditOpen(false)}
        />

        {/* 电话 App 右上角设置：AI 主动来电开关 + 频率档位（从设置 › 通知页迁移到此） */}
        {proactiveSheetOpen && (
          <div className="absolute inset-0 z-[70] flex flex-col justify-end bg-black/50" role="dialog" aria-label="主动来电设置" onClick={() => setProactiveSheetOpen(false)}>
            <div className="rounded-t-[18px] bg-background pb-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
              <div className="relative flex h-12 items-center justify-center border-b border-border/60">
                <button
                  type="button"
                  aria-label="关闭"
                  onClick={() => setProactiveSheetOpen(false)}
                  className="absolute left-3 grid h-8 w-8 place-items-center rounded-full text-muted-foreground active:bg-foreground/10"
                >
                  <X className="h-5 w-5" strokeWidth={2.2} />
                </button>
                <p className="text-[16px] font-medium">主动来电设置</p>
              </div>
              <div className="px-4 pt-4">
                {/* AI 主动来电总开关 */}
                <div className="flex min-h-[52px] items-center gap-3 rounded-[12px] bg-foreground/[0.04] px-4 py-2 dark:bg-foreground/[0.06]">
                  <span className="min-w-0 flex-1 text-[16px] leading-tight">
                    AI 主动来电
                    <span className="mt-0.5 block text-[12px] leading-[16px] text-muted-foreground">
                      AI 可能会根据聊天和心情主动打来电话
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={proactive}
                    aria-label="AI 主动来电"
                    onClick={() => {
                      const v = !proactive;
                      setProactiveCallEnabled(v);
                      setProactive(v);
                    }}
                    className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors ${proactive ? 'bg-[#34C759]' : 'bg-foreground/20'}`}
                  >
                    <span className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-all ${proactive ? 'left-[22px]' : 'left-[2px]'}`} />
                  </button>
                </div>
                {/* 频率档位 4 选 1（iOS 风格单选列表，比点按循环更直观） */}
                <p className="px-1 pb-2 pt-4 text-[13px] font-medium text-muted-foreground">频率</p>
                <div className="overflow-hidden rounded-[12px] bg-foreground/[0.04] dark:bg-foreground/[0.06]">
                  {PROACTIVE_LEVEL_OPTIONS.map((opt, i) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={!proactive}
                      data-testid={`proactive-level-${opt.value}`}
                      onClick={() => {
                        setProactiveLevel(opt.value);
                        setProactiveLevelState(opt.value);
                      }}
                      className={`flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left transition-colors disabled:opacity-40 ${i > 0 ? 'border-t border-border/40' : ''} ${proactiveLevel === opt.value ? 'bg-foreground/[0.06] dark:bg-foreground/[0.1]' : 'active:bg-foreground/[0.04]'}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[16px] leading-tight">{opt.label}</span>
                        <span className="mt-0.5 block text-[12px] leading-[16px] text-muted-foreground">{opt.desc}</span>
                      </span>
                      {proactiveLevel === opt.value ? <Check className="h-5 w-5 shrink-0 text-[#34C759]" strokeWidth={2.5} aria-hidden="true" /> : null}
                    </button>
                  ))}
                </div>
                <p className="px-1 pt-3 text-[12px] leading-relaxed text-muted-foreground">
                  切换档位即时生效，下次调度即用新间隔与冷却。「关闭」= 完全关闭 AI 主动来电（含聊天内标记来电）；所有档位 23 点-早 8 点与系统免打扰时段均不打扰。
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 匿名号码切换弹层（Task 40-E / v2 per-app 账号，与信息 App 共享；切号不刷新网页，
            电话账号变化由 ACCOUNT_CHANGED_EVENT 监听重读数据） */}
        <AnonSwitchSheet app="phone" open={anonSheetOpen} onClose={() => setAnonSheetOpen(false)} />

        {/* 长按匿名号码 chip → 删除确认（iOS 弹窗风；Task 40 修正） */}
        {delAnon && (
          <div className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-8" onClick={() => setDelAnon(null)}>
            <div
              role="dialog"
              aria-label="删除匿名号码"
              className="w-full max-w-[280px] overflow-hidden rounded-[14px] bg-white/95 text-center backdrop-blur-xl dark:bg-[#2C2C2E]/95"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 pt-5">
                <p className="text-[16px] font-semibold">删除匿名号码</p>
                <p className="mt-1.5 text-[13px] leading-[1.6] text-muted-foreground">
                  将删除「匿名号码 {maskAnonPhone(delAnon.phone)}」：该号码的通话记录等本地数据会一并清除，此操作不可恢复。
                </p>
                {delAnonErr && (
                  <p data-testid="anon-delete-error" className="mt-2 text-[12.5px] leading-relaxed text-[#FF3B30]">
                    {delAnonErr}
                  </p>
                )}
              </div>
              <div className="mt-4 flex border-t border-black/10 dark:border-white/10">
                <button
                  type="button"
                  data-testid="anon-delete-cancel"
                  onClick={() => setDelAnon(null)}
                  className="h-11 flex-1 border-r border-black/10 text-[15px] active:bg-black/5 dark:border-white/10 dark:active:bg-white/10"
                >
                  取消
                </button>
                <button
                  type="button"
                  data-testid="anon-delete-confirm"
                  onClick={() => void confirmDelAnon()}
                  className="h-11 flex-1 text-[15px] font-semibold text-[#FF3B30] active:bg-black/5 dark:active:bg-white/10"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 通话全屏层 */}
        {callTarget && (
          <CallScreen
            target={callTarget}
            onEnd={handleCallEnd}
            onVoicemail={handleVoicemail}
            onClose={() => setCallTarget(null)}
          />
        )}
      </div>
    </IOSScreen>
  );
}
