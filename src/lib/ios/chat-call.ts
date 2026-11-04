'use client';

/**
 * 微信 / QQ 语音通话引擎（useChatCall）——两 App 共用一套状态机与语音链路：
 *
 * 一、通话流程（与需求一致）：
 *   拨号（dialing，1.8~3.2s 模拟响铃后 AI 接听）/ 来电（incoming，用户接听或拒绝，25s 无应答对方取消）
 *   → 接通（active）：AI 先开口（greeting）→ 免提「自动对话」循环（VAD，无需点任何按钮）：
 *   AI 播完自动开录音待命 → 用户直接说话 → 说完停顿 1.4s 自动结束录音 → STT 转文字
 *   → 交给聊天模型（/api/phone/turn，复用人设/记忆/时间感知链路）→ 用当前角色音色 TTS 播报
 *   → 播完自动回到聆听，循环直到用户挂断或 AI 主动挂断（告别语后输出〔挂断〕标记）。
 *   控制：长按/点按麦克风可临时静音（恢复后自动续听）；说话中点麦克风立即发送；
 *   一直没人说话自动丢弃重听；识别失败自动重试（连续失败暂停并提示，可切文字聊天）。
 *
 * 五、通话中文字聊天（右上角信息图标开关）：接通后底部按钮上方出现内联输入条（消息区+输入框），
 *   开启期间字幕隐藏；用户发文字 → AI 回复文字进消息区（via='text'）同时用角色音色 TTS 播报
 *   （Task 33：只要配置了声音——内置语音免配置恒可用，配了第三方 API 用 API——打字回复也出声）；
 *   共用同一条 /api/phone/turn 链路与人设/记忆上下文，文字/语音轮次写入同一份通话历史（via 标记）；
 *   AI 若输出〔挂断〕标记，呈现完告别后结束通话。
 *
 * 二、音色：speakUserTts 现场解析（角色 voiceId → 全局默认 → 内置默认声线），与语音消息同一套
 *   TTS 配置；AI 回复在 TTS 播报的同时把文字逐字同步到字幕流（aiReveal，onProgress 驱动），
 *   TTS 失败不中断通话——回复文字整句直接显示在字幕流里，通话继续。
 *   用户录音期间并行跑 Web Speech 实时识别（liveHeard 增量更新；字幕仍只显示 AI 说的话）——
 *   Web Speech 是识别主通道：说完停顿 VAD 停录后 stop() 直接取整句文本，无需服务端；
 *   识别兑底（第十六轮）：Web Speech 失败后走 transcribeBlob 三级链
 *   （① SenseVoice 端侧 ② 用户配置的云端 STT ③ 内置 z-ai ASR 免配置）；
 *   识别失败给出提示，通话继续、可重试。
 *
 * 三、权限与边界：麦克风首次使用时 getUserMedia 申请；拒绝后界面提示、文字聊天与其他功能不受影响；
 *   通话不涉及真实电话网络；挂断/卸载时释放录音流、停止播报、停表。
 *
 * 四、通话结果（onEnd 恰好一次回调）：direction / endReason / connected / duration（接通秒数），
 *   由宿主（微信/QQ 聊天页）生成通话卡片消息并持久化；另回传 transcript=通话全程对话转写
 *   （语音+文字轮次快照）——宿主把整通对话按普通消息落进聊天记录（用户要求：全部对话显示在聊天界面）。
 *
 * 五、通话记忆（与文字聊天共用同一套记忆系统，同池存储 / 同互通开关 / 按联系人隔离）：
 *   1) 每轮回复后 memorizeTurn：轮次计数（无持久消息数组固定计 2 条）→ 达提取间隔自动从
 *      通话转写提取记忆碎片（后台异步，失败静默）；
 *   2) 挂断时 summarizeCall：整通电话转写自动总结一次（memSummarizeCallNow），关键信息沉淀；
 *   3) 每轮 requestTurn 前经 memoryBlockFn 以「用户刚说的话」动态召回相关记忆注入 system
 *      （文字聊过的事通话里能接上；通话里说的事文字聊天也能接上——互通开关决定召回范围）；
 *   4) worldbookBlock：宿主用 collectWbBlocks 组装的世界书设定，随人设注入（优先级高于记忆）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContactRecord } from '@/lib/contacts';
import { memAfterAiTurn, memConvoFromRaw, memSummarizeCallNow } from '@/lib/memory';
import { ownerRealNameFor, ownerProfileFor } from './contacts-store';
import { getAccountById, getActiveAccountIdFor } from './accounts';
import { useSettings } from './store';
import { directChatStream } from './direct-api';
// 第十六轮：通话识别三级兑底链（SenseVoice 端侧 → 用户云端 STT → 内置 z-ai ASR 免配置兑底）
import { transcribeBlob } from './cabin-voice';
import { startWebSpeechSession, type WebSpeechSession } from './web-speech';
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
} from './vad';
import { requestAnswerDecision } from './call-decision';
import { requestCallFollowup } from './call-followup';
import { buildCrossContextBlocks } from './cross-app-context';
import { speakUserTts, stopSpeaking } from './tts-client';
import { reportCallSeconds, useGlobalCall } from './global-call';
import { loadBlock, type BlockEntry } from './block-state';
import { getReplyCount } from '../reply-count';

/** fix3-D #42：拉黑静默轮连续上限——拉黑期（byChar/byUser）免提开录循环 + 主动开口计时器
 *  每 3~7s 空转一次（AUTO_WAIT_MS=7000 静默超时/PROACTIVE 3~5s + 250ms 续听），不请求 LLM
 *  但通话永不结束，只能等用户手动挂断。静默轮连续达该阈值自动收尾挂断（落正常结束记录、
 *  通话总结照常，followup 由 #41 守卫跳过）。12 次 ≈ 1~1.5 分钟死寂；正常轮清零计数，
 *  正常通话不受影响 */
const BLOCKED_SILENT_TURN_LIMIT = 12;

// ---------------- 类型 ----------------

export type ChatCallPhase = 'dialing' | 'incoming' | 'active' | 'ended';
/** 通话内细状态（状态区文案用；listening=免提待命听，recording=VAD 检测到你正在说话） */
export type ChatCallStatus = 'connecting' | 'listening' | 'recording' | 'recognizing' | 'thinking' | 'speaking';
/** 通话结束原因（宿主据此生成通话卡片状态） */
export type ChatCallEndReason =
  | 'cancel' // 拨号中用户取消（对方接听前）
  | 'no-answer' // 拨号后对方一直未接（预留）
  | 'reject' // 来电被用户拒绝
  | 'missed-in' // 来电未接听（响铃超时对方取消）
  | 'hangup' // 接通后用户挂断
  | 'ai-hangup'; // 接通后 AI 主动结束

export interface ChatCallResult {
  direction: 'out' | 'in';
  endReason: ChatCallEndReason;
  /** 是否接通过（卡片「已接通/通话时长」依据） */
  connected: boolean;
  /** 接通后的通话秒数（未接通为 0） */
  duration: number;
  /** AI 拒接/未接后的解释文字（接听决策产出；宿主稍后以聊天消息/语音留言呈现） */
  afterText?: string;
  /** 通话全程对话转写（语音轮次 + 文字轮次，挂断时刻快照；空轮次已过滤）——
   *  宿主据此把整通电话的对话内容落进聊天记录（用户要求：全部对话显示在聊天界面，不光打的字）。
   *  挂断续聊文字不在此内（宿主经 onFollowup 另行落库，避免重复） */
  transcript?: ChatCallTextMsg[];
}

export interface ChatCallTurnMsg {
  role: 'user' | 'assistant';
  content: string;
}

/** 通话内消息日志条目（字幕/文字条消息区共用；via 区分轮次渠道） */
export interface ChatCallTextMsg {
  role: 'user' | 'assistant';
  content: string;
  at: number;
  /** 渠道：'voice' = 语音轮次（说话/播报，不出文字）；'text' = 文字聊天轮次（输入条消息区可见）。
   *  缺省视为 'voice'（旧数据兼容） */
  via?: 'voice' | 'text';
}

/** AI 字幕逐字揭示状态（与 TTS 播放进度同步；null = 当前无揭示中的字幕） */
export interface ChatCallReveal {
  text: string;
  shown: number;
}

export interface UseChatCallOptions {
  app: 'wx' | 'qq' | 'phone';
  /** 通话对端联系人（人设/音色来源；kind='user' 时对端不说话，仅保留聆听状态） */
  contact: ContactRecord | null;
  direction: 'out' | 'in';
  /** 进入通话时携带的最近聊天上下文（按 user/assistant 归并），AI 按人设与上下文应答 */
  initialHistory: ChatCallTurnMsg[];
  /** 宿主组装的 system 附加块（记忆召回 / 社交动态 / 时间感知 / 位置感知；发送时原样透传给 turn API）
   *  memoryBlock 为发起时快照（兑底）；memoryBlockFn 每轮以「用户刚说的话」重新召回（优先使用）——
   *  通话里 AI 能随话题变化召回相关记忆，主动提起之前聊过的事 */
  memoryBlock?: string;
  /** 每轮动态召回记忆（宿主组装：memRecallBlock(contactId, app, userText)）；优先于 memoryBlock */
  memoryBlockFn?: (userText: string | null) => string | undefined;
  /** 世界书块（宿主用 collectWbBlocks 组装：全局/局部/专属命中条目 + 使用规则），透传 turn API */
  worldbookBlock?: string;
  momentsBlock?: string;
  timeBlock?: string;
  /** 位置感知块（与文字聊天同一套 buildLocationBlock）：通话里 AI 知道“用户在哪” */
  locBlock?: string;
  /** 跨 App 身份感知互通开关（宿主按联系人读 getMemSettings；undefined = 不注入） */
  multiApp?: boolean;
  /** 通话媒体：voice=语音通话（默认，旧行为不变）/ video=视频通话（界面/规则/记忆场景/卡片按视频分叉） */
  media?: 'voice' | 'video';
  /** 每轮动态注入「用户画面」识图描述（视频通话专用，宿主/界面层采集摄像头帧→识图后提供）：
   *  返回非空串时随 turn API 注入【用户画面】system 块，AI 知道此刻看到什么；返回 undefined 不注入 */
  visionBlockFn?: () => string | undefined;
  /** AI 输出「想看看你」请求标记时回调（C2，Task 28，视频通话专用）：界面据此弹「打开摄像头」
   *  确认条；引擎侧已防重入（每通最多一次）；语音通话不传不触发 */
  onCameraRequest?: () => void;
  /** 通话结束（恰好一次） */
  onEnd: (r: ChatCallResult) => void;
  /** 挂断后 AI 续聊文字生成完毕（引擎异步产出，紧随挂断）：宿主负责呈现——
   *  微信/QQ 以聊天消息落盘，电话 App 以语音留言呈现；文字已并入通话转写一同沉淀记忆 */
  onFollowup?: (texts: string[]) => void;
}

// ---------------- 音效（回铃 / 接通 / 挂断；WebAudio 轻提示音） ----------------

let audioCtxSingleton: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtxSingleton) audioCtxSingleton = new Ctx();
    if (audioCtxSingleton.state === 'suspended') void audioCtxSingleton.resume();
    return audioCtxSingleton;
  } catch {
    return null;
  }
}

function playTone(freq: number, durationMs: number, volume = 0.05, delayMs = 0): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
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
  } catch {
    // 音效失败不影响通话
  }
}

/** 回铃音：450Hz 响 1s 停 4s，循环（来电响铃用更急促的节奏） */
class RingTone {
  private timer: number | null = null;
  start(mode: 'out' | 'in'): void {
    this.stop();
    const beep = () => {
      if (mode === 'in') {
        playTone(440, 400, 0.045);
        playTone(440, 400, 0.045, 600);
      } else {
        playTone(450, 1000, 0.035);
      }
    };
    beep();
    this.timer = window.setInterval(beep, mode === 'in' ? 4000 : 5000);
  }
  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function playConnectBlip(): void {
  playTone(600, 120, 0.05);
  playTone(900, 160, 0.05, 130);
}

function playHangupBlip(): void {
  playTone(600, 180, 0.05);
  playTone(380, 240, 0.05, 190);
}

/** 接通过判定：接通后结束的两个原因一定 connected；其余看计时器是否走过 */
function phaseWasConnected(endReason: ChatCallEndReason): boolean {
  return endReason === 'hangup' || endReason === 'ai-hangup';
}

// ---------------- 引擎 ----------------

/**
 * 陌生来电判定（多账号语义，仅电话 App 拨出链路）：
 * 用户拨出（direction='out'）的电话/视频通话，接电话的 AI 能否「认得」来电人——
 * - 主号：恒认得（机主来电，AI 的联系人就是 TA）；
 * - 小号：仅当联系人分账号关系（relationByAcc）里登记过该账号才认得（来电显示语义：
 *   角色存了这个号码才知道是谁打来的），否则视为陌生号码；
 * - 匿名号：永远不认得（匿名号码语义：AI 不知道来电人是谁）。
 * 微信/QQ 应用内通话不适用（应用内来电显示 = 好友身份，且匿名号不进微信/QQ）；
 * AI 主动来电（direction='in'）不适用（AI 打给它认识的联系人）。
 * 陌生来电时：机主身份/记忆/跨App近况/世界书/朋友圈/多端感知全部不下发。
 */
function phoneCallerUnknown(
  app: 'wx' | 'qq' | 'phone',
  direction: 'in' | 'out',
  contact: { relationByAcc?: Record<string, string> | null } | null | undefined
): boolean {
  if (app !== 'phone' || direction !== 'out') return false;
  const acc = getAccountById(getActiveAccountIdFor(app));
  if (!acc || acc.kind === 'main') return false;
  if (acc.kind === 'anon') return true;
  const scoped = contact?.relationByAcc?.[acc.id];
  return !(typeof scoped === 'string' && scoped.trim());
}

/** 拉黑状态读取（引擎内统一入口）：仅 wx/qq 有拉黑体系；phone（全局视频通话）与其余端返回 null=不拦 */
function blockEntryOf(app: 'wx' | 'qq' | 'phone', contactId?: string | null): BlockEntry | null {
  if (app !== 'wx' && app !== 'qq') return null;
  if (!contactId) return null;
  return loadBlock(app, contactId);
}

/** AI 告别语后的挂断标记（识别后从播报文本中剥除；三端共用，电话 App 也复用） */
export const HANGUP_MARK_RE = /〔挂断〕|【挂断】|\[挂断\]|（挂断）|\(挂断\)/g;

/**
 * AI 主动发起语音通话的触发标记：识别与剥除均兼容半角/全角方括号与圆括号变体
 * （[语音通话]【语音通话】〔语音通话〕（语音通话）(语音通话)——模型偶尔输出全角变体，
 * 只认半角会导致「该来电时不来电、标记原文漏进气泡」）。
 */
const VOICE_CALL_MARK_ONE_RE = /[〔\[【（(]\s*语音通话\s*[〕\]】）)]/;
/** 全局替换用（剥除标记本身，标记不进气泡） */
export const VOICE_CALL_MARK_RE = new RegExp(VOICE_CALL_MARK_ONE_RE.source, 'g');
/** 是否包含语音通话触发标记（全角/半角括号变体都算） */
export function hasVoiceCallMark(t: string): boolean {
  return VOICE_CALL_MARK_ONE_RE.test(t);
}
/** 剥除语音通话触发标记（返回 trim 后文本） */
export function stripVoiceCallMark(t: string): string {
  return t.replace(VOICE_CALL_MARK_RE, ' ').trim();
}

/**
 * AI 主动发起视频通话的触发标记（[视频通话] 等，与 [语音通话] 同一套全半角括号变体兼容）。
 * 宿主（微信/QQ）检测到标记后剥除并按冷却触发视频通话来电；标记原文不进气泡。
 */
const VIDEO_CALL_MARK_ONE_RE = /[〔\[【（(]\s*视频通话\s*[〕\]】）)]/;
/** 全局替换用（剥除标记本身，标记不进气泡） */
export const VIDEO_CALL_MARK_RE = new RegExp(VIDEO_CALL_MARK_ONE_RE.source, 'g');
/** 是否包含视频通话触发标记（全角/半角括号变体都算） */
export function hasVideoCallMark(t: string): boolean {
  return VIDEO_CALL_MARK_ONE_RE.test(t);
}
/** 剥除视频通话触发标记（返回 trim 后文本） */
export function stripVideoCallMark(t: string): string {
  return t.replace(VIDEO_CALL_MARK_RE, ' ').trim();
}

/**
 * AI 请求看用户画面的标记（C2，Task 28）：视频通话中用户摄像头关闭时，允许 AI 在某句话末尾
 * 单独输出 [想看看你]（全半角括号变体同套兼容）；引擎识别后剥除（标记不进字幕/文字条/转写记忆），
 * 并每通最多一次回调 onCameraRequest 让界面弹「打开摄像头」确认条。voice 通话不注入规则也不识别。
 */
const CAMERA_REQUEST_ONE_RE = /[〔\[【（(]\s*想看看你\s*[〕\]】）)]/;
/** 全局替换用（剥除标记本身） */
const CAMERA_REQUEST_MARK_RE = new RegExp(CAMERA_REQUEST_ONE_RE.source, 'g');
/** C2 兜底：AI 偶发忘加括号、直接在句尾写「想看看你」（实测出现过「…在干嘛呀想看看你」）——
 *  去尾部标点后以此结尾即视为请求（句尾恰好以这四字收尾的语句几乎都是表达想看，误伤率极低；
 *  「好想看看你呀」等尾部带字的不算句尾）；触发后同样剥除+弹确认条 */
const CAMERA_REQUEST_BARE_RE = /想看看你[。！!？?～~\s]*$/;
/** C2 意图兜底：AI 口语化表达「想看」但没带标记（变体极多，实测「让我看看你嘛」等，模型对标记规则
 *  遵循不稳定）——命中口语意图即弹确认条；文本不剥除（自然表达保留在字幕/文字条里更顺），只剥除元标记 */
const CAMERA_REQUEST_INTENT_RE = /想看看你|瞅瞅你|看看你嘛|让我看[看瞅]|让我瞅瞅|(?:你|让|把)[^。！!？?]{0,6}(?:打开|开一下|开个|开下)[^。！!？?]{0,2}摄像头/;

/** C2 标记剥除共用：带括号标记剥除、句尾裸「想看看你」剥除、口语意图只检测不剥除——三者都报 requested
 *  （media='video' 专用；字幕/文字条/历史/记忆同源此文本，元标记一处剥除四面干净） */
function stripCamRequest(rawText: string): { text: string; requested: boolean } {
  if (CAMERA_REQUEST_ONE_RE.test(rawText)) {
    return { text: rawText.replace(CAMERA_REQUEST_MARK_RE, ' ').trim(), requested: true };
  }
  if (CAMERA_REQUEST_BARE_RE.test(rawText)) {
    return { text: rawText.replace(CAMERA_REQUEST_BARE_RE, ' ').trim(), requested: true };
  }
  if (CAMERA_REQUEST_INTENT_RE.test(rawText)) {
    return { text: rawText, requested: true };
  }
  return { text: rawText, requested: false };
}

/**
 * 通话场景附加规则（聊天通话：允许 AI 按人设/上下文主动结束通话；三端共用）。
 * 按联系人关系动态生成——不再硬编码「很熟的朋友」：疏远/同事/刚吵架的人设接通后语气
 * 跟着关系走，亲近才亲昵，不熟保持分寸，杜绝「人设疏远、开口熟络」的出戏感。
 * media='video'（视频通话）：措辞与规则按视频通话分叉——AI 知道对方开了摄像头时自己能看到
 * 对方画面（识图描述经 visionBlock 注入），镜头关了/没画面时绝不装作看得见。
 */
export function chatCallExtraRules(
  peer?: { relation?: string | null; relationToUser?: string | null } | null,
  media: 'voice' | 'video' = 'voice',
): string[] {
  const rel = [peer?.relationToUser, peer?.relation]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .join('/');
  const closeness = rel
    ? `你们的关系是「${rel}」——语气疏密按这个关系来：亲近关系才自然亲昵随意，普通/疏远/紧张的关系保持应有的分寸感，不要装熟；`
    : '语气疏密按你们人设与资料里的关系亲疏来：亲近才自然随意，不熟就保持分寸，不要装熟；';
  const videoRules =
    media === 'video'
      ? [
        '如果上下文里有【用户画面】描述，说明对方的摄像头开着、你能实时看到TA：可以像真人视频一样自然地评价/回应画面里看到的东西（TA的样子、表情、在做什么、周围环境），但只基于描述内容回应，不要虚构画面里没有的细节；',
        '如果上下文里没有【用户画面】（对方没开摄像头或你看不到），绝对不要装作看得见对方；',
        // 【100-d】视频卡顿/断线应答引导：网络问题在视频通话里很常见，AI 要像真人一样接住，
        // 不能装没听见，更不能编造「刚才错过了什么」
        '对方说画面卡/听不清/断开了时，像真人一样自然应对（比如「我这边重新连一下」「那我再说一遍」），不要当作没听见，也不要编造刚才错过了什么内容；',
        // C2（Task 28）：摄像头关闭时允许自然地请求看一眼（每通一次，句尾标记由引擎剥除、界面弹确认条）
        '当对方的摄像头处于关闭状态时，你随时可以自然地表达想看看对方（撒娇/好奇/思念，语气符合你的人设）；关键规则：凡是你表达了「想看」的意思（无论说法是「让我看看你」「想瞅瞅你」「打开摄像头嘛」还是别的说法），都必须在那句话的末尾额外带上固定格式标记 [想看看你] —— 也就是方括号包住的这四个字，示例：「让我看看你嘛[想看看你]」「好想瞅瞅你[想看看你]」。不带方括号标记的话对方界面收不到你的请求，等于白说；标记每通电话只带一次，除该句末尾外任何情况都不要输出它；对方还没打开摄像头前，不要假装看见了对方；',
      ]
      : [];
  return [
    `你正在和对方进行实时${media === 'video' ? '视频' : '语音'}通话，保持人设，像真人${media === 'video' ? '视频' : '打'}电话；${closeness}`,
    ...videoRules,
    '如果你想结束通话（话题聊完、要去忙、困了等自然原因），先用一句话自然告别（如「那我先去洗澡啦，回头聊」），然后在告别语的最后单独输出〔挂断〕标记；除此之外的任何情况都不要输出〔挂断〕；',
    '正常聊天时绝对不要输出〔挂断〕标记；每轮只说出口语内容本身。',
  ];
}

/** 请求超时错误识别（#20）：AbortSignal.timeout 抛 DOMException TimeoutError，
 *  name 各浏览器一致优先判，message 兑底（Chromium「signal timed out」/Safari「The operation timed out.」） */
function isTimeoutError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'TimeoutError') return true;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /timeout|timed out/i.test(msg);
}

export interface ChatCallApi {
  phase: ChatCallPhase;
  status: ChatCallStatus;
  /** 接通后的通话秒数 */
  seconds: number;
  recording: boolean;
  muted: boolean;
  speakerOn: boolean;
  /** 麦克风错误（权限拒绝/不可用等；只提示，不中断通话） */
  error: string;
  /** 用户实时说话识别文本（Web Speech 增量；不再作为字幕渲染——我方说话不上屏，仅作 STT 失败兑底） */
  liveHeard: string;
  /** AI 回复逐字揭示（与 TTS 播放进度同步；null = 无揭示中的字幕） */
  aiReveal: ChatCallReveal | null;
  /** 最后一次识别出的「我说的话」（备用） */
  lastHeard: string;
  /** 通话内消息日志（语音轮次 + 文字聊天轮次；文字面板数据源） */
  chatLog: ChatCallTextMsg[];
  /** 文字聊天回复中（面板「对方正在输入…」） */
  textBusy: boolean;
  accept: () => void;
  reject: () => void;
  hangup: () => void;
  /** 麦克风主按钮：说话中点一下=立即发送（不等停顿）；空闲（如识别失败暂停后）=立即开听 */
  tapMic: () => void;
  /** 静音 = 临时关闭麦克风：暂停免提自动听并丢弃进行中的录音；取消静音自动恢复听 */
  toggleMute: () => void;
  toggleSpeaker: () => void;
  /** 进出文字聊天模式（输入条开合：打断进行中的录音/播报；期间字幕隐藏、回复走输入条） */
  setTextMode: (on: boolean) => void;
  /** 文字聊天发送（内联输入条用；AI 配了语音 API 则语音回复，否则文字回复进消息区） */
  sendText: (text: string) => void;
}

export function useChatCall(opts: UseChatCallOptions): ChatCallApi {
  const { app, contact, direction, initialHistory, memoryBlock, memoryBlockFn, worldbookBlock, momentsBlock, timeBlock, locBlock, multiApp, visionBlockFn, onEnd, onFollowup } = opts;
  /** 通话媒体（video=视频通话）：规则/记忆场景/服务端 channel 按此分叉；默认 voice 与既有行为完全一致 */
  const media: 'voice' | 'video' = opts.media ?? 'voice';

  const [phase, setPhase] = useState<ChatCallPhase>(direction === 'in' ? 'incoming' : 'dialing');
  const [status, setStatus] = useState<ChatCallStatus>('connecting');
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [error, setError] = useState('');
  const [liveHeard, setLiveHeard] = useState('');
  const [aiReveal, setAiReveal] = useState<ChatCallReveal | null>(null);
  const [lastHeard, setLastHeard] = useState('');
  const [chatLog, setChatLog] = useState<ChatCallTextMsg[]>([]);
  const [textBusy, setTextBusy] = useState(false);

  // ---------- refs（异步循环里读最新值，避免 stale closure；写 ref 一律入 effect，不在渲染期） ----------
  const endedRef = useRef(false);
  const phaseRef = useRef<ChatCallPhase>(phase);
  const secondsRef = useRef(0);
  const mutedRef = useRef(false);
  const statusRef = useRef<ChatCallStatus>(status);
  const chatLogRef = useRef<ChatCallTextMsg[]>([]);
  const textBusyRef = useRef(false);
  /** 文字聊天模式：输入条打开期间为 true（字幕隐藏；回复文字进消息区且同时照常播报） */
  const textModeRef = useRef(false);
  /** 打开面板时丢弃进行中的录音 */
  const discardRef = useRef(false);
  /** VAD 会话（免提自动听：检测开口/停顿/超时） */
  const vadRef = useRef<VadHandle | null>(null);
  /** 自动重听延迟定时器 */
  const retryTimerRef = useRef<number | null>(null);
  /** 连续识别失败计数（达上限暂停自动听） */
  const sttFailRef = useRef(0);
  /** 免提自动听调度（定义在 startRecording 之后，经 effect 同步进 ref 供上游回调调用） */
  const autoListenRef = useRef<(delayMs?: number) => void>(() => {});
  /** AI 主动开口：聆听状态挂起「用户一直不说话」计时器；触发后转入 AI 独白轮 */
  const proactiveTimerRef = useRef<number | null>(null);
  /** 主动开口已触发（等 recorder onstop 丢弃静默录音后发起） */
  const proactivePendingRef = useRef(false);
  /** 连续主动开口计数（用户真正说话后归零；连续多次后 AI 会告别并挂断） */
  const proactiveCountRef = useRef(0);
  /** fix3-D #42 连续静默轮计数（拉黑守卫命中的轮次累计，正常轮清零；达 BLOCKED_SILENT_TURN_LIMIT 自动挂断收尾） */
  const silentTurnCountRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ringRef = useRef<RingTone | null>(null);
  /** 来电响铃超时定时器（Task 23 修复）：accept 时必须清障——否则 AI 打来的电话即使用户接了，
   *  引擎挂载 25s 后仍会强制造 finish('missed-in') 掊断进行中的通话（用户约 10s 接听 ≈ 通话 15s 就挂） */
  const ringMissTimerRef = useRef<number | undefined>(undefined);
  /** #18 finishRef：生命周期 cleanup 调最新 finish 走完整收尾（页面关闭/PhoneShell 卸载时
   *  进行中通话也落卡片+续聊+记忆总结，不让通话静默消失） */
  const finishRef = useRef<(endReason: ChatCallEndReason, afterText?: string) => void>(() => {});
  /** 录音期间并行的 Web Speech 实时识别会话（liveHeard 字幕来源 + 服务端 STT 失败兑底） */
  const wsRef = useRef<WebSpeechSession | null>(null);
  const busyRef = useRef(false); // STT/turn/TTS 循环进行中
  const historyRef = useRef<ChatCallTurnMsg[]>(initialHistory.slice(-16));
  /** 通话前的最近聊天快照（发起时；挂断续聊的「最近聊天记录」依据，不随通话轮次混入） */
  const recentChatRef = useRef<ChatCallTurnMsg[]>(initialHistory.slice(-8));
  const onEndRef = useRef(onEnd);
  /** 挂断后 AI 续聊文字回调（宿主呈现） */
  const onFollowupRef = useRef(onFollowup);
  /** 跨 App 近况块 + 群聊近况块（Task 40-b，会话级懒构建一次缓存）：
   *  【跨应用近况】（其他 App 最近 10 条原始消息）+【群聊近况】（共同群最近 10 条）随每轮 turn
   *  与挂断续聊注入。跟会话生命周期走：引擎实例 = 一通通话（finishByReplacement 换新引擎/重挂
   *  VoiceCallScreen 时 ref 随之新建自动重建）；通话期间不重算（几秒内的外部变化不影响本通话）。 */
  const crossCtxRef = useRef<{ crossAppBlock: string; groupBlock: string } | null>(null);
  const optsRef = useRef({ app, contact, memoryBlock, memoryBlockFn, worldbookBlock, momentsBlock, timeBlock, locBlock, multiApp, media: (opts.media ?? 'voice') as 'voice' | 'video', visionBlockFn, onCameraRequest: opts.onCameraRequest });
  /** C2（Task 28）：[想看看你] 请求标记本通是否已触发过界面确认条（每通最多一次；引擎随通话实例重建自动复位） */
  const camReqFiredRef = useRef(false);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  /** 追加通话内消息日志（语音轮次与文字轮次统一入口） */
  const appendLog = useCallback((m: ChatCallTextMsg) => {
    chatLogRef.current = [...chatLogRef.current, m].slice(-100);
    setChatLog(chatLogRef.current);
  }, []);
  useEffect(() => {
    onEndRef.current = onEnd;
    onFollowupRef.current = onFollowup;
    optsRef.current = { app, contact, memoryBlock, memoryBlockFn, worldbookBlock, momentsBlock, timeBlock, locBlock, multiApp, media: opts.media ?? 'voice', visionBlockFn, onCameraRequest: opts.onCameraRequest };
  });

  /** 停 VAD + 清自动重听定时器 + 清主动开口计时器（挂断/静音/开文字条时用；不动 MediaRecorder——丢弃或发送由调用方决定） */
  const stopAutoListenTimers = useCallback(() => {
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

  // ---------- 通话记忆接线（微信/QQ 与电话 App 同款）：轮次计数 + 自动提取 + 挂断总结 ----------

  /** 通话转写 → 记忆对话轮次（chatLog 含语音轮次 + 文字轮次，统一转 me/peer） */
  const chatLogToConvo = useCallback(() => {
    return memConvoFromRaw(
      chatLogRef.current.map((m) => ({ role: m.role, text: m.content })),
      '',
    );
  }, []);

  /** 一轮 AI 回复后的记忆管线（runTurn/sendText 成功分支调用；后台异步，失败静默）：
   *  轮次计数（无持久消息数组，固定计 2 条）→ 达提取间隔自动从通话转写提取记忆碎片；
   *  与文字聊天共用同一记忆库（同池存储 / 同互通开关），电话里说过的事文字聊天能接上 */
  const memorizeTurn = useCallback(() => {
    const cur = optsRef.current;
    const cid = cur.contact?.id;
    if (!cid || cur.contact?.kind === 'user') return;
    // 陌生来电（多账号）：记忆写作用「陌生号码」指代来电人（按当前账号作用域隔离，不向机主侧泄露）
    const stranger = phoneCallerUnknown(cur.app, direction, cur.contact);
    // 多账号 v2：机主名按通话所属 App 的当前账号取「我」（cur.app 'wx'|'qq'|'phone' ⊂ AccountApp）
    void (stranger
      ? Promise.resolve('陌生号码')
      : ownerRealNameFor(cur.app).catch(() => '')
    )
      .catch(() => '')
      .then((owner) =>
        memAfterAiTurn(
          cid,
          cur.app,
          useSettings.getState().apiConfig,
          () => chatLogToConvo(),
          () => null, // 无持久消息数组：每轮固定计 2 条（1 用户 + 1 AI）
          // fix3-11 机主名回退链：机主卡片真名 → 设置 profile 名（owner 为空时不再让 names.user 空、
          // 提取 prompt 回退成「用户/对方」代称；与 phone.tsx 挂断总结 owner || profileName 同口径）
          { user: owner || useSettings.getState().profile.name || '', peer: cur.contact?.name || '' },
          // fix3-11 场景标记：通话里说的话在提取 prompt 中标注「语音/视频通话」场景（App 归属由 app 字段自带）
          { scene: media === 'video' ? '视频通话' : '语音通话' },
        ),
      );
  }, [chatLogToConvo, media]);

  /** 挂断时自动总结整通电话：提取关键信息沉淀为记忆（通话结束自动触发一次；失败静默不阻塞收尾） */
  const summarizeCall = useCallback(() => {
    const cur = optsRef.current;
    const cid = cur.contact?.id;
    if (!cid || cur.contact?.kind === 'user') return;
    const turns = chatLogToConvo();
    if (turns.length < 2) return; // 通话太短没有可沉淀的内容
    // 陌生来电（多账号）：记忆总结用「陌生号码」指代来电人（按当前账号作用域隔离）
    const stranger = phoneCallerUnknown(cur.app, direction, cur.contact);
    void (stranger
      ? Promise.resolve('陌生号码')
      : ownerRealNameFor(cur.app).catch(() => '')
    )
      .catch(() => '')
      .then((owner) =>
        memSummarizeCallNow(
          cid,
          cur.app,
          useSettings.getState().apiConfig,
          turns,
          // fix3-11 机主名回退链（同 memorizeTurn）：owner 为空时回退设置 profile 名
          { user: owner || useSettings.getState().profile.name || '', peer: cur.contact?.name || '' },
          // fix3-11 通话方向（机主手机视角，契约尾参）：本引擎 direction 'in'=AI 拨入/'out'=机主拨出，
          // 直接透传——总结 prompt 才能写清「谁打给谁的一通电话」
          { direction, media },
        ),
      );
  }, [chatLogToConvo, direction, media]);

  /** 挂断后 AI 续聊（三端共用逻辑，挂断即触发）+ 记忆总结（一次提取「通话内容+续聊文字」）：
   *  ① 接通后挂断（AI 主动挂断 / 用户挂断）→ 基于人设+通话内容+记忆+最近聊天生成文字，立刻发
   *     （条数上限 = 该会话聊天设置「回复条数」，没话可以少发；真实通话时长随 duration 直传——
   *     刚接通没聊起来的短通话由服务端注入「没聊起来+禁虚构」场景文，AI 打圆场而非接话茬，B-3）；
   *  ② AI 打来的电话被拒/未接（direction in）、拨号被取消（direction out）→ 生成自然的反应消息；
   *  ③ 拨出去被 AI 拒接/未接（direction out 的 reject/no-answer）→ 接听决策 afterText 已覆盖，不重复发。
   *  续聊文字并入通话转写后交 summarizeCall 沉淀（同池互通、按联系人隔离）；请求失败也照常总结。 */
  const followupAndSummarize = useCallback(
    (endReason: ChatCallEndReason) => {
      const peer = optsRef.current.contact;
      // 接通判定（三态口径不变，Task 21）：挂断类原因只在接通后可达；0 秒短通话也如实上报 connected=true，
      // 续聊的「没聊起来」场景由服务端按 duration 分档注入（B-3）——不在此伪造未接通
      const connected = secondsRef.current > 0 || phaseWasConnected(endReason);
      const eligible =
        !!peer &&
        peer.kind !== 'user' &&
        (connected
          ? endReason === 'hangup' || endReason === 'ai-hangup'
          : (direction === 'in' && (endReason === 'reject' || endReason === 'missed-in')) ||
            (direction === 'out' && endReason === 'cancel'));
      if (!eligible) {
        summarizeCall();
        return;
      }
      // fix3-D #41 拉黑守卫（引擎层入口，宿主展示拦截 wechat.tsx:4345 / qq.tsx:3028 保持不动）：
      // wx/qq 通话挂断续聊在拉黑存续期间不再白跑 /api/phone/followup LLM 请求——直接跳到通话总结
      // （沉淀真实发生过的通话内容，与 #33① 记忆总结口径一致）。byChar||byUser 双向同拦，与
      // #33② runTurn 静默轮的双向语义对齐；从 optsRef 现场读取防挂断瞬间状态变更。
      // 电话端同场景由 phone.tsx hangup 内 byUser 前置拦截（#33，仅 byUser 的既有口径不动）
      const blkAtEnd = peer && peer.id ? blockEntryOf(optsRef.current.app, peer.id) : null;
      if (blkAtEnd?.byChar || blkAtEnd?.byUser) {
        summarizeCall();
        return;
      }
      void (async () => {
        let texts: string[] = [];
        // 陌生来电（多账号）：匿名号/未登记小号从电话 App 拨出的通话——续聊不下发机主身份/记忆等
        const callerUnknown = phoneCallerUnknown(optsRef.current.app, direction, peer);
        try {
          const transcript = chatLogRef.current.map((m) => ({ role: m.role, content: m.content }));
          const lastUser = [...transcript].reverse().find((m) => m.role === 'user')?.content ?? null;
          // 多账号 v2：机主资料按通话所属 App 的当前账号取；陌生来电不下发
          const owner = callerUnknown ? null : await ownerProfileFor(optsRef.current.app).catch(() => null);
          // 跨 App 近况块 + 群聊近况块（Task 40-b）：通话内已建则复用缓存；从未发过请求的短通话现算一次；陌生来电不下发
          if (!callerUnknown && !crossCtxRef.current) {
            crossCtxRef.current = peer?.id
              ? await buildCrossContextBlocks(peer.id, optsRef.current.app, owner?.realName || '')
              : { crossAppBlock: '', groupBlock: '' };
          }
          texts = await requestCallFollowup({
            contact: {
              name: peer.name,
              kind: peer.kind,
              gender: peer.gender,
              age: peer.age,
              height: peer.height,
              weight: peer.weight,
              occupation: peer.occupation,
              company: peer.company,
              region: peer.region,
              relation: peer.relation,
              relationByAcc: peer.relationByAcc ?? null,
              relationToUser: peer.relationToUser ?? null,
              birthday: peer.birthday ?? null,
              persona: peer.persona,
              background: peer.background,
              expressStyle: peer.expressStyle ?? null,
              customRules: peer.customRules ?? null,
              nickname: peer.nickname ?? null,
              realName: peer.realName ?? null,
            },
            direction,
            endReason,
            connected,
            duration: secondsRef.current,
            transcript: transcript.slice(-24),
            recentChat: recentChatRef.current.map((m) => ({ role: m.role, content: m.content })),
            memoryBlock: callerUnknown
              ? undefined
              : (optsRef.current.memoryBlockFn?.(lastUser) || optsRef.current.memoryBlock || undefined),
            // 跨 App 近况 + 群聊近况（Task 40-b）：与通话轮次同源同位置（当前 App 记忆之后）；陌生来电不下发
            crossAppBlock: callerUnknown ? undefined : (crossCtxRef.current?.crossAppBlock || undefined),
            groupBlock: callerUnknown ? undefined : (crossCtxRef.current?.groupBlock || undefined),
            worldbookBlock: callerUnknown ? undefined : (optsRef.current.worldbookBlock || undefined),
            timeBlock: optsRef.current.timeBlock || undefined,
            // 跨 App 身份感知：互通开关（陌生来电不下发）
            multiApp: callerUnknown ? undefined : optsRef.current.multiApp,
            // 条数上限 = 该会话聊天设置「回复条数」（A4 修复：电话通道此前读 phone:<id>——
            // 该键从未被任何设置页写入，恒回退默认 5；统一读 sms:c:<id>，与未接留言/主动来电留言同口径）
            replyCount: getReplyCount(optsRef.current.app === 'phone' ? `sms:c:${peer.id}` : `${optsRef.current.app}:${peer.id}`),
            // 通话媒体（Task 22 视频通话）：视频挂断续聊让 AI 知道刚才那通是视频
            media,
            // 机主称呼：只传真名（用户规则：AI 永远不知道机主昵称，userNickname 不再下传）
            userRealName: owner?.realName || undefined,
            // 多账号关系感知：小号续聊读分账号关系（服务端 relationForCtx 同口径）
            accountId: getActiveAccountIdFor(optsRef.current.app),
            // 陌生来电（多账号）：续聊按「刚接到陌生电话」框架
            callerUnknown: callerUnknown || undefined,
          });
        } catch {
          texts = []; // 续聊失败静默：不影响记忆总结
        }
        if (texts.length > 0) {
          // 续聊文字并入通话转写（via='text'）：随后的总结把「通话内容+续聊」一起沉淀（互通）
          const now = Date.now();
          chatLogRef.current = [
            ...chatLogRef.current,
            ...texts.map((t, i) => ({ role: 'assistant' as const, content: t, at: now + i, via: 'text' as const })),
          ];
          try {
            onFollowupRef.current?.(texts);
          } catch {
            // 宿主呈现失败不影响记忆沉淀
          }
        }
        summarizeCall();
      })();
    },
    [direction, media, summarizeCall],
  );

  /** 统一收尾：只执行一次；停录音/停播报/停铃声，回调宿主结果（afterText = AI 拒接/未接后的解释文字） */
  const finish = useCallback((endReason: ChatCallEndReason, afterText?: string) => {
    if (endedRef.current) return;
    endedRef.current = true;
    stopAutoListenTimers();
    ringRef.current?.stop();
    stopSpeaking();
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    } catch {
      // 已停止
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    playHangupBlip();
    setPhase('ended');
    setRecording(false);
    setStatus('listening');
    reportCallSeconds(0);
    // 接通判定（三态口径不变，Task 21）：'hangup'/'ai-hangup' 只在接通后可达，短通话（0 秒）保持 connected=true，
    // 通话卡片三态不变——挂断续聊的「刚接通没聊起来」场景由服务端按 duration 分档处理（B-3）
    const connected = secondsRef.current > 0 || phaseWasConnected(endReason);
    // 挂断后 AI 续聊（立刻发）+ 通话结束自动总结：整通转写（含续聊文字）交给记忆管线提取关键信息（异步，不阻塞宿主落卡片）
    followupAndSummarize(endReason);
    // 全程对话转写快照（空内容过滤）：随 onEnd 交宿主落聊天记录（微信/QQ 聊天页 + 电话存档）
    const transcript = chatLogRef.current.filter((m) => m.content.trim().length > 0);
    onEndRef.current({
      direction: optsRef.current.app === 'wx' || optsRef.current.app === 'qq' ? direction : 'out',
      endReason,
      connected,
      duration: secondsRef.current,
      ...(afterText ? { afterText } : {}),
      ...(transcript.length > 0 ? { transcript } : {}),
    });
  }, [direction, stopAutoListenTimers, followupAndSummarize]);
  // #18 finishRef：同步最新 finish，供生命周期 cleanup 调用（effect deps=[] 避免重跑组件初始化）
  useEffect(() => {
    finishRef.current = finish;
  });

  // ---------- TTS 播报（角色音色；逐字字幕同步；失败整句直出字幕不中断） ----------
  const speakReply = useCallback(
    (text: string, onDone: () => void, onFail?: () => void) => {
      const contactId = optsRef.current.contact?.id ?? null;
      // 播报前剥挂断标记（识别在调用方）；字幕流先挂上整句，随播放进度逐字揭示
      if (!endedRef.current) setAiReveal({ text, shown: 0 });
      void speakUserTts({
        text,
        contactId,
        cancelled: () => endedRef.current,
        onStart: () => {
          if (!endedRef.current) setStatus('speaking');
        },
        onProgress: (ratio) => {
          if (endedRef.current) return;
          setAiReveal((cur) =>
            cur && cur.text === text ? { ...cur, shown: Math.max(cur.shown, Math.ceil(text.length * ratio)) } : cur,
          );
        },
        onEnd: () => {
          if (!endedRef.current) {
            setAiReveal(null); // 揭示完成：整句由 chatLog 字幕流自然呈现
            onDone();
          }
        },
      }).catch(() => {
        // TTS 失败：整句直接显示在字幕流，通话继续；onFail 让调用方做额外降级（如消息区文字呈现）
        if (!endedRef.current) {
          setAiReveal(null);
          if (onFail) onFail();
          else onDone();
        }
      });
    },
    [],
  );

  /** TTS 失败兑底：把最后一条 assistant 消息降级为文字（via='text'）——
   *  文字输入条开着时消息区可见；语音模式字幕本就渲染整句，降级无副作用 */
  const demoteLastReplyToText = useCallback(() => {
    const log = chatLogRef.current;
    const last = log[log.length - 1];
    if (last && last.role === 'assistant' && last.via === 'voice') {
      const next = [...log.slice(0, -1), { ...last, via: 'text' as const }];
      chatLogRef.current = next;
      setChatLog(next);
    }
  }, []);

  // ---------- 请求一轮 LLM 回复（语音轮与文字轮共用；返回纯文本） ----------
  const requestTurn = useCallback(
    async (
      historyBefore: ChatCallTurnMsg[],
      greeting: boolean,
      /** AI 主动开口：用户一直不说话后的第 N 次主动尝试（0 = 正常轮次） */
      proactiveAttempt = 0,
    ): Promise<{ reply: string; error?: string }> => {
      const c = optsRef.current.contact;
      // 陌生来电（多账号）：匿名号/未登记小号从电话 App 拨出的视频通话——AI 不知道来电人是谁
      const callerUnknown = phoneCallerUnknown(optsRef.current.app, direction, c);
      // 本轮用户刚说的话（greeting/主动开口时不存）：供每轮动态召回相关记忆（主动提起之前聊过的事）；
      // 陌生来电不下发记忆（记忆属于机主/已建立身份，注入会直接破功）
      const lastUserText = greeting || proactiveAttempt > 0 ? null : (historyBefore[historyBefore.length - 1]?.content ?? null);
      const recalledBlock = callerUnknown
        ? undefined
        : (optsRef.current.memoryBlockFn?.(lastUserText) || optsRef.current.memoryBlock || undefined);
      // 机主身份：AI 知道软件上显示的名字只是昵称，被问是谁报真名（v2：按通话所属 App 当前账号；陌生来电不下发）
      const owner = callerUnknown ? null : await ownerProfileFor(optsRef.current.app).catch(() => null);
      // 跨 App 近况块 + 群聊近况块（Task 40-b）：首次请求时构建并缓存（联系人/机主名现场取）；陌生来电不下发
      if (!callerUnknown && !crossCtxRef.current) {
        crossCtxRef.current = c?.id
          ? await buildCrossContextBlocks(c.id, optsRef.current.app, owner?.realName || '')
          : { crossAppBlock: '', groupBlock: '' };
      }
      try {
        const res = await fetch('/api/phone/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // 对端号码标识（/api/phone/turn 必填）：微信/QQ 语音联系人往往只有微信号/QQ 号没有手机号，
            // 依次用 手机号→微信号→QQ号→联系人 id 兜底，避免接口 400「缺少号码」
            number: c ? c.phone || c.wechatId || c.qqId || c.id : 'unknown',
            contact: c
              ? {
                  name: c.name,
                  kind: c.kind,
                  gender: c.gender,
                  age: c.age,
                  height: c.height,
                  weight: c.weight,
                  occupation: c.occupation,
                  company: c.company,
                  region: c.region,
                  relation: c.relation,
                  relationByAcc: c.relationByAcc ?? null,
                  relationToUser: c.relationToUser ?? null,
                  birthday: c.birthday ?? null,
                  persona: c.persona,
                  background: c.background,
                  expressStyle: c.expressStyle ?? null,
                  customRules: c.customRules ?? null,
                  nickname: c.nickname ?? null,
                  realName: c.realName ?? null,
                }
              : undefined,
            // 机主称呼：只传真名（用户规则：AI 永远不知道机主昵称，userNickname 不再下传）
            userRealName: owner?.realName || undefined,
            // 陌生来电（多账号）：服务端人设换陌生框架、机主身份不下发
            callerUnknown: callerUnknown || undefined,
            greeting,
            proactiveAttempt: proactiveAttempt > 0 ? proactiveAttempt : undefined,
            history: historyBefore.map((m) => ({ role: m.role, content: m.content })),
            memoryBlock: recalledBlock,
            // 跨 App 近况 + 群聊近况（Task 40-b）：注入在当前 App 记忆之后（服务端同序拼装）；陌生来电不下发
            crossAppBlock: callerUnknown ? undefined : (crossCtxRef.current?.crossAppBlock || undefined),
            groupBlock: callerUnknown ? undefined : (crossCtxRef.current?.groupBlock || undefined),
            worldbookBlock: callerUnknown ? undefined : (optsRef.current.worldbookBlock || undefined),
            momentsBlock: callerUnknown ? undefined : (optsRef.current.momentsBlock || undefined),
            timeBlock: optsRef.current.timeBlock || undefined,
            locBlock: optsRef.current.locBlock || undefined,
            // 跨 App 身份感知：互通开关（陌生来电不下发：身份未知时多端好友语义不成立）
            multiApp: callerUnknown ? undefined : optsRef.current.multiApp,
            // 多账号关系感知：小号通话读分账号关系（与机主资料同账号口径）
            accountId: getActiveAccountIdFor(optsRef.current.app),
            // 通话方向（AI 视角）：out=用户打来的 / in=你打出去的——接通问候语按方向区分主被动
            direction,
            // 通话媒体（voice=语音 / video=视频）：服务端 channel 与场景规则按此分叉
            media,
            // 视频通话：界面层采集的用户画面识图描述（无摄像头/识图未配/还没出结果时为 undefined 不注入）
            visionBlock: optsRef.current.visionBlockFn?.() || undefined,
            // 陌生来电不传联系人：chatCallExtraRules 不注入「你们的关系是{大号关系}」
            //（关系描述属于机主/已建立身份，陌生来电注入会让 AI 把来电人当成「朋友」——谎称认识）
            extraRules: chatCallExtraRules(callerUnknown ? null : c, media),
            config: useSettings.getState().apiConfig,
          }),
          // #20 通话链路超时看门狗：LLM 轮次 45s 到点必失败（AbortSignal.timeout → DOMException
          // TimeoutError）——上游卡住不再永远「正在思考」，错误文案进通话界面已映射为友好中文
          signal: AbortSignal.timeout(45000),
        });
        const data = (await res.json()) as {
          reply?: string;
          error?: string;
          directOnly?: boolean;
          messages?: { role: 'system' | 'user' | 'assistant'; content: string }[];
        };
        if (res.ok && data.directOnly && Array.isArray(data.messages) && data.messages.length > 0) {
          // 内网 API：浏览器直连流式（与电话 App 同策略），取全量文本
          try {
            const full = await directChatStream(useSettings.getState().apiConfig, data.messages, () => undefined);
            return {
              reply: full
                .replace(/[*_`#>~]/g, '')
                .replace(/^["'「『]+|["'」』]+$/g, '')
                .trim(),
            };
          } catch {
            return { reply: '', error: data.error };
          }
        }
        if (res.ok && data.reply) return { reply: data.reply.trim() };
        return { reply: '', error: data.error || '信号不好，请再试一次' };
      } catch (err) {
        // 超时（DOMException TimeoutError）映射成友好中文：错误文案会直接进通话界面顶部
        if (isTimeoutError(err)) return { reply: '', error: '请求超时，请检查网络或稍后再试' };
        return { reply: '', error: '通话网络异常，请再试一次' };
      }
    },
    [direction, media],
  );

  // ---------- 一轮对话：文字 → LLM → TTS ----------
  const runTurn = useCallback(
    async (userText: string | null, greeting: boolean, proactiveAttempt = 0) => {
      const ended = () => endedRef.current;
      if (ended()) return;
      busyRef.current = true;
      setError('');
      if (userText) proactiveCountRef.current = 0; // 用户开口：主动连发计数归零
      // 对端是「机主本人」联系人（自己给自己打）：不说话，只保留聆听
      if (optsRef.current.contact?.kind === 'user') {
        setStatus('listening');
        busyRef.current = false;
        return;
      }
      // #33 拉黑守卫（语音通道与 sendText 同款口径，从 optsRef 现场读取防通话中状态变更）：
      // byChar（角色拉黑了用户）/ byUser（用户拉黑了角色）时 AI 均不应答本轮——用户语音内容
      // 照常进通话记录（appendLog），但不请求 LLM、不产生回复、不做逐轮记忆（memorizeTurn 挂在
      // 成功分支不变）；通话回到聆听继续（解除拉黑后下一轮自然恢复应答），挂断总结/B-1 兜底收尾
      // 不受影响。greeting/主动开口轮同样静默：不产生「被拉黑一方还在絮叨」的假对话
      const blkPeer = optsRef.current.contact;
      const blkEntry = blkPeer?.id ? blockEntryOf(optsRef.current.app, blkPeer.id) : null;
      if (blkEntry?.byChar || blkEntry?.byUser) {
        if (userText) {
          setLiveHeard(''); // 最终文字入列：实时 provisional 字幕让位（与正常轮同口径）
          historyRef.current = [...historyRef.current, { role: 'user' as const, content: userText }].slice(-16);
          appendLog({ role: 'user', content: userText, at: Date.now(), via: 'voice' });
        }
        setStatus('listening');
        busyRef.current = false;
        // fix3-D #42 连续静默轮计数：拉黑期免提开录循环空转永不结束，达阈值自动收尾——
        // finish 落正常结束记录（ai-hangup，卡片同为 ended），followup 由 #41 守卫跳过、总结照常
        silentTurnCountRef.current += 1;
        if (silentTurnCountRef.current >= BLOCKED_SILENT_TURN_LIMIT && !ended()) {
          finish('ai-hangup');
          return;
        }
        // 延迟 250ms 续听：accept/connect 路径 setPhase('active') 尚未经 effect 同步进 phaseRef，
        // 立即调度会被 scheduleAutoListen 的 phase 检查吞掉（同 setTextMode 恢复听延迟口径）
        autoListenRef.current(250);
        return;
      }
      silentTurnCountRef.current = 0; // fix3-D #42：正常轮（守卫放行）清零连续静默计数
      setStatus('thinking');
      const historyBefore = userText
        ? [...historyRef.current, { role: 'user' as const, content: userText }]
        : historyRef.current;
      if (userText) {
        setLiveHeard(''); // 最终文字入列：实时 provisional 字幕让位
        historyRef.current = historyBefore.slice(-16);
        appendLog({ role: 'user', content: userText, at: Date.now(), via: 'voice' });
      }
      const { reply: raw, error: turnError } = await requestTurn(historyBefore, greeting, proactiveAttempt);
      if (ended()) return;
      if (!raw) {
        setError(turnError || '信号不好，请再试一次');
        setStatus('listening');
        busyRef.current = false;
        autoListenRef.current(AUTO_RETRY_DELAY_MS); // 网络恢复后自动续听
        return;
      }
      // AI 主动挂断：告别语后输出〔挂断〕标记 → 播完告别自动结束通话
      const wantHangup = HANGUP_MARK_RE.test(raw);
      let replyText = raw.replace(HANGUP_MARK_RE, '').trim();
      HANGUP_MARK_RE.lastIndex = 0;
      if (!replyText) {
        // 仅输出挂断标记/空回复：按原语义收尾（保持既有行为零变化）
        finish(wantHangup ? 'ai-hangup' : 'hangup');
        return;
      }
      // C2（Task 28）：[想看看你] 请求标记——仅在视频通话识别（voice 无此规则不识别）；
      // 剥除后再分发：字幕流（speakReply→aiReveal）、文字条消息区（chatLog）、LLM 历史/记忆转写
      // 同源此文本，一处剥除三面干净；每通最多一次回调 onCameraRequest 弹「打开摄像头」确认条
      if (media === 'video') {
        const stripped = stripCamRequest(replyText);
        if (stripped.requested) {
          replyText = stripped.text;
          if (!camReqFiredRef.current) {
            camReqFiredRef.current = true;
            try {
              optsRef.current.onCameraRequest?.();
            } catch {
              // 界面回调异常不影响通话
            }
          }
        }
      }
      if (!replyText) {
        // 剥除后无正文（AI 只输出了标记本身）：不播报不上屏，回到聆听继续通话
        setStatus('listening');
        busyRef.current = false;
        autoListenRef.current();
        return;
      }
      const reply = replyText;
      historyRef.current = [...historyRef.current, { role: 'assistant' as const, content: reply }].slice(-16);
      // 回复形态：一律 TTS 播报（speakUserTts 内置引擎兜底，配了 API 用 API）；
      // 文字输入条开着时轮次标为 text（消息区呈现文字，同时照常播报——配置了声音打字回复也要出声）
      appendLog({ role: 'assistant', content: reply, at: Date.now(), via: textModeRef.current ? 'text' : 'voice' });
      memorizeTurn(); // 通话记忆：轮次计数 + 自动提取（后台异步，失败静默）
      speakReply(
        reply,
        () => {
          if (ended()) return;
          if (wantHangup) {
            finish('ai-hangup');
            return;
          }
          setStatus('listening');
          busyRef.current = false;
          autoListenRef.current(); // AI 说完 → 自动开始听（免提循环核心）
        },
        () => {
          // TTS 失败：字幕兜底整句 + 降级为文字（输入条开着时消息区同样可见）
          demoteLastReplyToText();
          if (ended()) return;
          if (wantHangup) {
            finish('ai-hangup');
            return;
          }
          setStatus('listening');
          busyRef.current = false;
          autoListenRef.current(); // 播报失败也继续免提循环（文字已呈现）
        },
      );
    },
    [finish, speakReply, requestTurn, appendLog, demoteLastReplyToText, memorizeTurn, media],
  );

  // ---------- 通话中文字聊天：用户发文字 → LLM → 配了语音 API 语音回复，否则文字回复 ----------
  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, 2000);
      if (!text || endedRef.current) return;
      if (phaseRef.current !== 'active') return;
      if (busyRef.current || textBusyRef.current) return;
      if (optsRef.current.contact?.kind === 'user') return; // 自己给自己发：不回
      // 拉黑守卫（与单聊 send/runAiTurn 同口径，微信/QQ 通话内文字条不再绕过拦截）：
      // - byChar（角色拉黑了用户）：拦截发送——不落库、不触发 AI，提示文案与单聊 toast 一致；
      // - byUser（用户拉黑了角色）：文字照常进通话记录（用户侧发送不受影响），但 AI 不回应——
      //   通话引擎无「解除拉黑申请卡片」通道，等价于单聊 runAiTurn 的 byUser 静默取消分支。
      const peer = optsRef.current.contact;
      const blk = peer?.id ? blockEntryOf(optsRef.current.app, peer.id) : null;
      if (blk?.byChar) {
        setError('对方已将你拉黑，无法发送');
        return;
      }
      const byUserBlocked = blk?.byUser === true;
      textBusyRef.current = true;
      busyRef.current = true;
      setTextBusy(true);
      setError('');
      appendLog({ role: 'user', content: text, at: Date.now(), via: 'text' });
      const historyBefore = [...historyRef.current, { role: 'user' as const, content: text }];
      historyRef.current = historyBefore.slice(-16);
      if (byUserBlocked) {
        textBusyRef.current = false;
        busyRef.current = false;
        setTextBusy(false);
        return;
      }
      silentTurnCountRef.current = 0; // fix3-D #42：正常文字轮（AI 应答）清零连续静默计数
      const { reply: rawReply, error: turnError } = await requestTurn(historyBefore, false);
      if (endedRef.current) return;
      if (!rawReply) {
        textBusyRef.current = false;
        busyRef.current = false;
        setTextBusy(false);
        setError(turnError || '发送失败，请再试一次');
        return;
      }
      const wantHangup = HANGUP_MARK_RE.test(rawReply);
      let replyText = rawReply.replace(HANGUP_MARK_RE, '').trim();
      HANGUP_MARK_RE.lastIndex = 0;
      if (!replyText) {
        // 仅输出挂断标记/空回复：按原语义收尾（保持既有行为零变化）
        textBusyRef.current = false;
        busyRef.current = false;
        setTextBusy(false);
        if (wantHangup) finish('ai-hangup');
        return;
      }
      // C2（Task 28）：[想看看你] 标记剥除（同 runTurn：字幕/文字条/历史/记忆同源一处剥除）+ 每通一次回调
      if (media === 'video') {
        const stripped = stripCamRequest(replyText);
        if (stripped.requested) {
          replyText = stripped.text;
          if (!camReqFiredRef.current) {
            camReqFiredRef.current = true;
            try {
              optsRef.current.onCameraRequest?.();
            } catch {
              // 界面回调异常不影响通话
            }
          }
        }
      }
      if (!replyText) {
        // 剥除后无正文：不上屏不播报，直接收尾本轮
        textBusyRef.current = false;
        busyRef.current = false;
        setTextBusy(false);
        return;
      }
      const reply = replyText;
      historyRef.current = [...historyRef.current, { role: 'assistant' as const, content: reply }].slice(-16);
      // 文字轮回复：文字进消息区（via='text'）+ 同时用角色音色播报（Task 33：配置了声音，
      // 通话里打字发给 AI，AI 回复文字同时要出声；内置语音免配置恒可用，配了第三方 API 用 API）
      appendLog({ role: 'assistant', content: reply, at: Date.now(), via: 'text' });
      memorizeTurn(); // 通话记忆：轮次计数 + 自动提取（后台异步，失败静默）
      speakReply(
        reply,
        () => {
          textBusyRef.current = false;
          busyRef.current = false;
          setTextBusy(false);
          if (endedRef.current) return;
          if (wantHangup) {
            finish('ai-hangup');
            return;
          }
          setStatus('listening');
        },
        () => {
          // TTS 失败：文字已在消息区（无需降级），直接收尾本轮
          textBusyRef.current = false;
          busyRef.current = false;
          setTextBusy(false);
          if (endedRef.current) return;
          if (wantHangup) {
            finish('ai-hangup');
            return;
          }
          setStatus('listening');
        },
      );
    },
    [requestTurn, appendLog, finish, speakReply, memorizeTurn, media],
  );

  /** 进出文字聊天模式：开启=停免提自动听（清重听定时器）、丢弃进行中的录音、打断播报；
   *  期间字幕隐藏、回复走输入条；关闭=恢复免提自动听 */
  const setTextMode = useCallback(
    (on: boolean) => {
      textModeRef.current = on;
      if (on) {
        stopAutoListenTimers();
        if (endedRef.current) return;
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          discardRef.current = true;
          try {
            recorderRef.current.stop();
          } catch {
            // 已停止
          }
        }
        if (statusRef.current === 'speaking') {
          stopSpeaking();
          setAiReveal(null); // 播报被打断：揭示中的字幕让位（整句仍在 chatLog 里）
          setStatus('listening');
        }
        return;
      }
      if (!endedRef.current) autoListenRef.current(250); // 关输入条：恢复免提听
    },
    [stopAutoListenTimers],
  );

  // ---------- 免提自动听（VAD 循环）：AI 说完自动开录待命，说完停顿自动发送，全程无需点按钮 ----------
  /** AI 主动开口：聆听状态挂「用户一直不说话」计时器（3~5s 随机），触发后丢弃静默录音转 AI 独白轮 */
  const armProactiveTimer = useCallback(() => {
    if (proactiveTimerRef.current !== null) {
      window.clearTimeout(proactiveTimerRef.current);
      proactiveTimerRef.current = null;
    }
    proactiveTimerRef.current = window.setTimeout(
      () => {
        proactiveTimerRef.current = null;
        if (endedRef.current || phaseRef.current !== 'active') return;
        if (busyRef.current || mutedRef.current || textModeRef.current) return;
        if (statusRef.current === 'recording') return; // VAD 已检测到你正在说
        if (optsRef.current.contact?.kind === 'user') return;
        // 用户一直没说：丢弃当前静默录音（onstop 的 proactivePending 分支接管），转入主动开口
        proactivePendingRef.current = true;
        discardRef.current = true;
        try {
          if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
        } catch {
          // 已停止
        }
      },
      PROACTIVE_MIN_MS + Math.floor(Math.random() * Math.max(1, PROACTIVE_MAX_MS - PROACTIVE_MIN_MS)),
    );
  }, []);

  const startRecording = useCallback(async () => {
    if (endedRef.current || busyRef.current) return;
    if (mutedRef.current || textModeRef.current) return;
    if (optsRef.current.contact?.kind === 'user') return;
    if (recorderRef.current && recorderRef.current.state === 'recording') return;
    setError('');
    setAiReveal(null);
    setLiveHeard('');
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
      recorder.onstop = () => {
        setRecording(false);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        // 收实时识别会话：丢弃路径直接 abort；正常路径等转写失败时再 stop 取兑底文本
        const ws = wsRef.current;
        wsRef.current = null;
        if (endedRef.current) {
          ws?.abort();
          setLiveHeard('');
          chunksRef.current = [];
          return;
        }
        if (discardRef.current) {
          // 静音/开文字条/超时无人说话：丢弃本轮；未被禁止时自动重新听（免提等待循环）
          discardRef.current = false;
          ws?.abort();
          setLiveHeard('');
          chunksRef.current = [];
          // AI 主动开口：用户一直没说，丢弃静默录音后转 AI 独白轮（第 N 次尝试，计数递增——
          // 连续多次无回应时 system 会提示 AI 可自然告别并挂断）
          if (proactivePendingRef.current) {
            proactivePendingRef.current = false;
            if (!mutedRef.current && !textModeRef.current && phaseRef.current === 'active') {
              busyRef.current = true;
              proactiveCountRef.current += 1;
              void runTurn(null, false, proactiveCountRef.current);
              return;
            }
            if (!mutedRef.current && !textModeRef.current) autoListenRef.current(); // 已挂断竞态：静默丢弃
            return;
          }
          if (!mutedRef.current && !textModeRef.current) autoListenRef.current();
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size < 1200) {
          ws?.abort();
          setLiveHeard('');
          setError('没听到声音，请再说一次');
          setStatus('listening');
          autoListenRef.current(AUTO_RETRY_DELAY_MS);
          return;
        }
        setStatus('recognizing');
        busyRef.current = true;
        void (async () => {
          // 识别主通道：Web Speech（浏览器原生实时识别，录音期间已并行累计，stop() 取整句）；
          // 第十六轮兑底升级：Web Speech 失败/无结果时改走 transcribeBlob 三级链
          //（① SenseVoice 端侧 ② 用户配置的 OpenAI 兼容 STT ③ 内置 z-ai ASR 免配置）——
          //  不支持 Web Speech 的浏览器/识别抖动时，连续语音对话依然可用（不再要求用户先配 STT）
          let text = '';
          let serverError: unknown = null;
          if (ws) {
            try {
              const t = (await ws.stop()).trim();
              // 过滤 ASR 对静音/噪声的典型无意义输出（纯符号），避免当成有效转写
              if (t && !/^[#\s*_\-.,!?~。？！，、…—·]+$/.test(t)) text = t;
            } catch {
              // 实时识别失败：走下方三级兑底
            }
          }
          if (endedRef.current) return;
          if (!text) {
            try {
              const t = (await transcribeBlob(blob)).trim();
              if (t && !/^[#\s*_\-.,!?~。？！，、…—·]+$/.test(t)) text = t;
            } catch (e) {
              serverError = e;
            }
          }
          if (endedRef.current) return;
          if (!text) {
            setLiveHeard('');
            setError(
              serverError instanceof Error && serverError.message
                ? serverError.message
                : '没听清，请再说一次',
            );
            setStatus('listening');
            busyRef.current = false;
            // 自动对话：识别失败自动重听；连续失败达上限暂停（可点麦克风重试 / 切文字聊天）
            sttFailRef.current += 1;
            if (sttFailRef.current < STT_FAIL_LIMIT) autoListenRef.current(AUTO_RETRY_DELAY_MS);
            else setError('连续几次没听清，点麦克风可重试，也可用输入条文字聊');
            return;
          }
          sttFailRef.current = 0;
          setLiveHeard('');
          setLastHeard(text);
          return runTurn(text, false);
        })().catch((e: unknown) => {
          if (endedRef.current) return;
          setLiveHeard('');
          setError(e instanceof Error && e.message ? e.message : '识别失败，请再试一次');
          setStatus('listening');
          busyRef.current = false;
          autoListenRef.current(AUTO_RETRY_DELAY_MS);
        });
      };
      recorder.start();
      setRecording(true);
      setStatus('listening'); // 免提待命等你开口（VAD 检测到声音才进入 recording）
      armProactiveTimer(); // 用户若一直不说话（3~5s），AI 主动开口
      // 并行跑 Web Speech 实时识别（与 MediaRecorder 共享麦克风）：识别主通道——VAD 停录后
      // stop() 直接取整句文本；不支持/启动失败返回 null（配了 OpenAI 兼容 STT 时走服务端兑底）
      wsRef.current = startWebSpeechSession({
        onPartial: (t) => {
          if (!endedRef.current) setLiveHeard(t);
        },
      });
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
          if (!endedRef.current) setStatus('recording');
        },
        onSpeechEnd: (reason) => {
          vadRef.current = null;
          if (endedRef.current) return;
          // silent-timeout：一直没人说话，丢弃本轮重新听（不能一直录）；pause/maxlen：正常发送
          if (reason === 'silent-timeout') discardRef.current = true;
          try {
            if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
          } catch {
            // 已停止
          }
        },
      });
    } catch {
      setError('麦克风不可用，请检查权限后重试');
      setStatus('listening');
    }
  }, [runTurn, armProactiveTimer]);

  /** 免提自动听调度：空闲且未被禁止（挂断/静音/文字条/自己）时开始新一轮聆听；delayMs 缓冲后执行 */
  const scheduleAutoListen = useCallback(
    (delayMs = 0) => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      const go = () => {
        retryTimerRef.current = null;
        if (endedRef.current || phaseRef.current !== 'active') return;
        if (mutedRef.current || textModeRef.current) return;
        if (busyRef.current) return;
        if (optsRef.current.contact?.kind === 'user') return;
        if (recorderRef.current && recorderRef.current.state === 'recording') return;
        void startRecording();
      };
      if (delayMs > 0) retryTimerRef.current = window.setTimeout(go, delayMs);
      else go();
    },
    [startRecording],
  );
  useEffect(() => {
    autoListenRef.current = scheduleAutoListen;
  });

  /** 麦克风主按钮：说话中点一下=立即发送（不等停顿）；空闲（如识别失败暂停后）=立即开听；
   *  待命等你说时无需操作；AI 播报/思考中不打断（免提顺序循环，播完自动听） */
  const tapMic = useCallback(() => {
    if (endedRef.current || phaseRef.current !== 'active') return;
    if (recording) {
      if (statusRef.current !== 'recording') return; // 待命等待说话：无需手动发送
      vadRef.current?.stop();
      vadRef.current = null;
      // 立即发送：停录音触发 onstop → STT → turn
      try {
        recorderRef.current?.stop();
      } catch {
        // 忽略
      }
      return;
    }
    if (busyRef.current) return;
    sttFailRef.current = 0; // 手动重试清失败计数
    void startRecording();
  }, [recording, startRecording]);

  /** 静音 = 临时关闭麦克风：停免提自动听（清定时器）、丢弃进行中的录音；取消静音自动恢复听 */
  const toggleMute = useCallback(() => {
    if (endedRef.current) return;
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) {
      stopAutoListenTimers();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        discardRef.current = true;
        try {
          recorderRef.current.stop();
        } catch {
          // 已停止
        }
      }
      if (statusRef.current === 'recording') setStatus('listening');
    } else {
      autoListenRef.current(200);
    }
  }, [stopAutoListenTimers]);

  const toggleSpeaker = useCallback(() => {
    if (endedRef.current) return;
    setSpeakerOn((s) => !s);
  }, []);

  // ---------- 接听 / 拒绝 / 挂断 ----------
  const accept = useCallback(() => {
    if (endedRef.current || phaseRef.current !== 'incoming') return;
    // Task 23：接听即撤销「25s 无人处理转未接」定时器——已接通的通话绝不能再被它掊断
    if (ringMissTimerRef.current !== undefined) {
      window.clearTimeout(ringMissTimerRef.current);
      ringMissTimerRef.current = undefined;
    }
    ringRef.current?.stop();
    playConnectBlip();
    setPhase('active');
    setStatus('thinking');
    secondsRef.current = 0;
    setSeconds(0);
    // 对方打来的：接通后对方先开口
    void runTurn(null, true);
  }, [runTurn]);

  const reject = useCallback(() => {
    if (endedRef.current || phaseRef.current !== 'incoming') return;
    finish('reject');
  }, [finish]);

  /** 替换前收尾兜底（B-1）：startGlobalCall 检测到已有活动通话时经全局层句柄触发本方法——
   *  按当前阶段映射真实结局走完整收尾（finish → onEnd 落卡片/挂断续聊/记忆总结），不让旧通话被静默杀死：
   *  响铃中被打断 = 未接听（missed-in）/ 拨号中被打断 = 已取消（cancel）/ 已接通被打断 = 对方（机主）挂断（hangup）；
   *  已结束（endedRef）时幂等跳过，绝不 double-finish */
  const finishByReplacement = useCallback(() => {
    if (endedRef.current) return;
    finish(phaseRef.current === 'incoming' ? 'missed-in' : phaseRef.current === 'dialing' ? 'cancel' : 'hangup');
  }, [finish]);

  // 引擎句柄注册（所有方向都注册）：direction='in' 时全局来电弹窗（微信大窗/胶囊）上的接听/忽略按钮
  // 经 useGlobalCall.engine 代理到本页引擎（accept/reject）；finishByReplacement 供全局层 startGlobalCall
  // 替换旧通话前触发完整收尾（B-1 兜底）。phase 变化自动重注册，来电弹窗随 phase（incoming）出现/消失
  useEffect(() => {
    useGlobalCall.getState().setEngine({ accept, reject, finishByReplacement }, phase);
    return () => {
      useGlobalCall.getState().setEngine(null, null);
    };
  }, [accept, reject, finishByReplacement, phase]);

  const hangup = useCallback(() => {
    if (endedRef.current) return;
    // #51 三态映射（与 finishByReplacement:1205 同款）：incoming 阶段挂断 = 未接听（missed-in）/
    // dialing 阶段挂断 = 已取消（cancel）/ 接通后挂断 = 正常结束（hangup）。
    // UI 不暴露 incoming 阶段挂断钮，但 call.hangup 被 useChatCall 导出，宿主在 incoming 相位调它
    // 会把从未接通的电话记成 endReason='hangup' → connected=true，与拒接语义不一致。
    finish(
      phaseRef.current === 'incoming'
        ? 'missed-in'
        : phaseRef.current === 'dialing'
          ? 'cancel'
          : 'hangup'
    );
  }, [finish]);

  // ---------- 生命周期：铃声 / AI 接听决策（接听·拒绝·不接）/ 来电超时 / 计时 / 卸载清理 ----------
  useEffect(() => {
    ringRef.current = new RingTone();
    const ring = ringRef.current;
    let answerTimer: number | undefined;
    let missTimer: number | undefined;
    let peerTimer: number | undefined;

    if (direction === 'out') {
      ring.start('out');
      const connect = () => {
        ring.stop();
        playConnectBlip();
        setPhase('active');
        setStatus('thinking');
        void runTurn(null, true);
      };
      // AI 接听决策：响铃开始就发（人设/关系/当前时间状态/最近聊天 → 接听/拒绝/不接），
      // 失败或超时兜底 answer（宁可多接，不让用户白等）；机主打给自己（kind='user'）不决策。
      // 陌生来电（多账号）：匿名号/未登记小号从电话 App 拨出——AI 不知道来电人是谁，机主身份不下发
      const peer = optsRef.current.contact;
      const decisionCallerUnknown = phoneCallerUnknown(optsRef.current.app, direction, peer);
      const decision =
        peer && peer.kind !== 'user'
          ? (decisionCallerUnknown
              ? requestAnswerDecision({
                  number: peer.phone || '10086',
                  contact: {
                    name: peer.name,
                    kind: peer.kind,
                    gender: peer.gender,
                    age: peer.age,
                    height: peer.height,
                    weight: peer.weight,
                    occupation: peer.occupation,
                    company: peer.company,
                    region: peer.region,
                    relation: peer.relation,
                    relationByAcc: peer.relationByAcc ?? null,
                    relationToUser: peer.relationToUser ?? null,
                    birthday: peer.birthday ?? null,
                    persona: peer.persona,
                    background: peer.background,
                    expressStyle: peer.expressStyle ?? null,
                    customRules: peer.customRules ?? null,
                    nickname: peer.nickname ?? null,
                    realName: peer.realName ?? null,
                  },
                  recentChat: historyRef.current.map((m) => ({ role: m.role, content: m.content })),
                  timeBlock: optsRef.current.timeBlock || undefined,
                  // 陌生来电：机主身份/多端感知不下发，按陌生来电决策
                  callerUnknown: true,
                  accountId: getActiveAccountIdFor(optsRef.current.app),
                  config: useSettings.getState().apiConfig,
                })
              : ownerProfileFor(optsRef.current.app)
                  .then((owner) =>
                    requestAnswerDecision({
                      number: peer.phone || '10086',
                      contact: {
                        name: peer.name,
                        kind: peer.kind,
                        gender: peer.gender,
                        age: peer.age,
                        height: peer.height,
                        weight: peer.weight,
                        occupation: peer.occupation,
                        company: peer.company,
                        region: peer.region,
                        relation: peer.relation,
                        relationByAcc: peer.relationByAcc ?? null,
                        relationToUser: peer.relationToUser ?? null,
                        birthday: peer.birthday ?? null,
                        persona: peer.persona,
                        background: peer.background,
                        expressStyle: peer.expressStyle ?? null,
                        customRules: peer.customRules ?? null,
                        nickname: peer.nickname ?? null,
                        realName: peer.realName ?? null,
                      },
                      recentChat: historyRef.current.map((m) => ({ role: m.role, content: m.content })),
                      timeBlock: optsRef.current.timeBlock || undefined,
                      // 机主称呼：只传真名（用户规则：AI 永远不知道机主昵称，userNickname 不再下传）
                      userRealName: owner?.realName || undefined,
                      // 跨 App 身份感知 + 多账号关系感知（与 followup/turn 同口径）
                      multiApp: optsRef.current.multiApp,
                      accountId: getActiveAccountIdFor(optsRef.current.app),
                      config: useSettings.getState().apiConfig,
                    }),
                  )
          ).catch(() => ({ decision: 'answer' }) as const)
          : null;
      // 先响铃 1.8~3.2s（决策多半已返回；未返回则等它 settle，最长 ANSWER_DECISION_TIMEOUT_MS 兜底）
      answerTimer = window.setTimeout(() => {
        void (async () => {
          if (endedRef.current) return;
          const d = decision ? await decision : ({ decision: 'answer' } as const);
          if (endedRef.current) return;
          if (d.decision === 'reject') {
            // 对方拒绝：再响 0.8~1.6s 后挂断（已响过一阵铃，「几声铃被挂断」更真实）
            peerTimer = window.setTimeout(() => {
              if (!endedRef.current) finish('reject', d.afterText);
            }, 800 + Math.floor(Math.random() * 800));
          } else if (d.decision === 'miss') {
            // 对方不接：继续响 9~15s 然后转「无人接听」
            peerTimer = window.setTimeout(() => {
              if (!endedRef.current) finish('no-answer', d.afterText);
            }, 9000 + Math.floor(Math.random() * 6000));
          } else {
            connect();
          }
        })();
      }, 1800 + Math.floor(Math.random() * 1400));
    } else {
      ring.start('in');
      // 来电 25s 未处理：对方取消（生成「未接听」卡片）；双保险：仅仍在响铃才收尾（已接/已拒/已挂不动），
      // 且定时器句柄同步进 ref，accept() 时主动清障（Task 23 修复 AI 来电接通后 15~25s 被强挂）
      missTimer = window.setTimeout(() => {
        if (!endedRef.current && phaseRef.current === 'incoming') finish('missed-in');
      }, 25000);
      ringMissTimerRef.current = missTimer;
    }

    return () => {
      window.clearTimeout(answerTimer);
      window.clearTimeout(missTimer);
      window.clearTimeout(peerTimer);
      ring.stop();
      // #18 卸载/页面关闭/PhoneShell 卸载时进行中通话也要走完整收尾（落卡片+续聊+记忆总结），
      // 不让进行中通话静默消失。finishRef 读最新 finish（deps=[] 避免重跑初始化）；finish 内幂等置 endedRef。
      if (!endedRef.current) {
        finishRef.current(
          phaseRef.current === 'incoming'
            ? 'missed-in'
            : phaseRef.current === 'dialing'
              ? 'cancel'
              : 'hangup',
        );
      }
      endedRef.current = true;
      stopAutoListenTimers();
      stopSpeaking();
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      } catch {
        // 忽略
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // 接通后计时（秒数同时上报全局总线，悬浮小窗实时显示）
  useEffect(() => {
    if (phase !== 'active') return;
    reportCallSeconds(secondsRef.current);
    const timer = window.setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
      reportCallSeconds(secondsRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  return {
    phase,
    status,
    seconds,
    recording,
    muted,
    speakerOn,
    error,
    liveHeard,
    aiReveal,
    lastHeard,
    chatLog,
    textBusy,
    accept,
    reject,
    hangup,
    tapMic,
    toggleMute,
    toggleSpeaker,
    setTextMode,
    sendText,
  };
}

// ---------------- 工具（宿主生成通话卡片文案用） ----------------

/** 秒 → MM:SS（≥1h 为 H:MM:SS） */
export function formatCallDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = String(m).padStart(2, '0');
  const ssStr = String(ss).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ssStr}` : `${mm}:${ssStr}`;
}
