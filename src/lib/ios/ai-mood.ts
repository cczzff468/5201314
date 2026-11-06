'use client';

/**
 * AI 情绪系统（第十六轮）—— 每个 AI 角色一份独立的「心情」：
 *
 * - 心情值 mood 0~100（默认 75 平静）+ 情绪标签 tag（开心/甜蜜/平静/吃醋/委屈/生气/想念）；
 * - 随互动实时变化：
 *   · 用户说亲密/夸奖的话（词表）→ 开心；送礼物/红包 → 甜蜜 +8；
 *   · 提到别的异性（词表）→ 吃醋 -10；骂人/负面词 → 生气 -8；冷淡敷衍短回复 → 委屈；
 *   · 长时间没聊（≥6h）之后回来 → 想念；情绪自然衰减回归平静（每 40min 一档）；
 * - 注入提示词（buildMoodBlock）：让 AI 的说话语气贴合当前情绪（开心时轻快、吃醋时带酸意、
 *   委屈时软软的想要哄…），并影响发表情/表情包的倾向；
 * - 打点入口：beginChatStream（三端聊天统一入口，每条用户消息）+ 语音通话 runTurn；
 *   礼物/红包等事件经 noteMoodEvent（gift/redpacket/…）。
 * 存储：localStorage ai-mood:{cid}（轻量、同步读、不用进 IndexedDB）。
 */

export type MoodTag = 'happy' | 'sweet' | 'normal' | 'jealous' | 'sad' | 'angry' | 'miss';

export interface AiMoodState {
  /** 心情值 0~100 */
  mood: number;
  /** 当前情绪标签 */
  tag: MoodTag;
  /** 标签产生时间（衰减回归用） */
  tagAt: number;
  /** 最近一次互动时间（想念判定用） */
  lastTouchAt: number;
}

const MOOD_KEY = (cid: string) => `ai-mood:${cid}`;
const DEFAULT_MOOD: AiMoodState = { mood: 75, tag: 'normal', tagAt: 0, lastTouchAt: 0 };

/** 情绪展示（emoji + 中文名） */
export const MOOD_DISPLAY: Record<MoodTag, { emoji: string; label: string }> = {
  happy: { emoji: '😊', label: '开心' },
  sweet: { emoji: '🥰', label: '甜蜜' },
  normal: { emoji: '🙂', label: '平静' },
  jealous: { emoji: '😗', label: '吃醋' },
  sad: { emoji: '🥺', label: '委屈' },
  angry: { emoji: '😤', label: '生气' },
  miss: { emoji: '🥲', label: '想念' },
};

// ---------------- 词表（轻量本地匹配，不耗 LLM） ----------------

/** 亲密/夸奖 → 开心 */
const HAPPY_WORDS = [
  '爱你', '爱你哟', '我爱你', '喜欢你', '想你', '好想你', '想你了', '宝贝', '宝宝', '亲爱的',
  '亲亲', '抱抱', '抱一个', 'mua', '么么', '么么哒', '哈哈', '嘿嘿', '嘻嘻', '太好啦', '太好了',
  '开心', '真棒', '厉害', '牛', '优秀', '可爱', '最好了', '最喜欢', '谢谢你', '谢谢啦', '爱你哦',
];
/** 提到别的异性 → 吃醋 */
const JEALOUS_WORDS = [
  '别的女生', '别的男人', '别的男孩', '其他女生', '其他男人', '小姐姐', '小哥哥', '大帅哥',
  '大美女', '前女友', '前男友', '前任', '暗恋', '表白', '相亲', '网友妹妹', '网友姐姐', '学妹', '学姐',
];
/** 骂人/负面 → 生气 */
const ANGRY_WORDS = [
  '滚', '闭嘴', '烦死了', '讨厌你', '你有病', '有病吧', '傻逼', '恶心', '分手', '不理你了',
  '拉黑你', '哼，不理', '你好烦', '别烦我', '滚开',
];
/** 冷淡敷衍（且消息很短）→ 委屈 */
const COLD_SHORT = ['哦', '嗯', '嗯嗯', '哦哦', '呵呵', '随便', '行吧', '好吧', '知道了', '忙吧', '先这样', '在忙'];

function getMoodState(cid: string): AiMoodState {
  try {
    const raw = window.localStorage.getItem(MOOD_KEY(cid));
    if (!raw) return { ...DEFAULT_MOOD };
    const j = JSON.parse(raw) as Partial<AiMoodState>;
    if (typeof j.mood !== 'number' || !j.tag) return { ...DEFAULT_MOOD };
    return {
      mood: Math.max(0, Math.min(100, j.mood)),
      tag: (j.tag as MoodTag) in MOOD_DISPLAY ? (j.tag as MoodTag) : 'normal',
      tagAt: typeof j.tagAt === 'number' ? j.tagAt : 0,
      lastTouchAt: typeof j.lastTouchAt === 'number' ? j.lastTouchAt : 0,
    };
  } catch {
    return { ...DEFAULT_MOOD };
  }
}

function setMoodState(cid: string, s: AiMoodState): void {
  try {
    window.localStorage.setItem(MOOD_KEY(cid), JSON.stringify(s));
  } catch {
    /* 落盘失败按内存用 */
  }
}

/** 读当前情绪（展示用：情侣空间/聊天页小图标） */
export function aiMoodOf(cid: string): AiMoodState {
  const s = getMoodState(cid);
  decayIfDue(cid, s);
  return s;
}

/** 情绪衰减：非平静情绪持续 40 分钟以上，每 40 分钟向平静回归一档 */
function decayIfDue(cid: string, s: AiMoodState): void {
  if (s.tag === 'normal') {
    // 心情值缓慢回到 75（每小时 ±5 以内）
    return;
  }
  const age = Date.now() - s.tagAt;
  const steps = Math.floor(age / (40 * 60 * 1000));
  if (steps <= 0) return;
  // 每档回归：心情值向 75 靠 12 点；2 档以上直接回平静
  const mood = steps >= 2 ? 75 : Math.max(0, Math.min(100, s.mood + (s.mood < 75 ? 12 : -12)));
  const next: AiMoodState =
    steps >= 2
      ? { mood: 75, tag: 'normal', tagAt: Date.now(), lastTouchAt: s.lastTouchAt }
      : { ...s, mood, tagAt: s.tagAt + 40 * 60 * 1000 };
  setMoodState(cid, next);
  Object.assign(s, next);
}

/** 情绪事件（外部显式触发：礼物/红包/视频通话等） */
export function noteMoodEvent(cid: string, kind: 'gift' | 'redpacket' | 'call' | 'coldlong'): void {
  const s = getMoodState(cid);
  const now = Date.now();
  if (kind === 'gift') {
    setMoodState(cid, { mood: Math.min(100, s.mood + 8), tag: 'sweet', tagAt: now, lastTouchAt: now });
  } else if (kind === 'redpacket') {
    setMoodState(cid, { mood: Math.min(100, s.mood + 6), tag: 'sweet', tagAt: now, lastTouchAt: now });
  } else if (kind === 'call') {
    setMoodState(cid, { mood: Math.min(100, s.mood + 4), tag: s.tag === 'normal' ? 'happy' : s.tag, tagAt: s.tag === 'normal' ? now : s.tagAt, lastTouchAt: now });
  } else if (kind === 'coldlong') {
    // 长时间没聊（调用方判定）→ 想念
    setMoodState(cid, { mood: Math.max(40, s.mood - 4), tag: 'miss', tagAt: now, lastTouchAt: s.lastTouchAt });
  }
}

/**
 * 用户发消息打点（三端聊天统一入口 beginChatStream + 语音通话转写均调用）。
 * 返回更新后的情绪（供调用方按需使用）。
 */
export function noteUserMsgMood(cid: string, text: string): AiMoodState {
  const s = getMoodState(cid);
  const now = Date.now();
  const t = (text || '').trim();
  const short = t.length <= 6;

  // 长时间没聊（≥6h）后再次开口 → 想念（优先级最低，先记着）
  const backAfterLong = s.lastTouchAt > 0 && now - s.lastTouchAt >= 6 * 3600_000;

  let tag: MoodTag | null = null;
  let delta = 0;
  if (JEALOUS_WORDS.some((w) => t.includes(w))) {
    tag = 'jealous';
    delta = -10;
  } else if (ANGRY_WORDS.some((w) => t.includes(w))) {
    tag = 'angry';
    delta = -8;
  } else if (HAPPY_WORDS.some((w) => t.includes(w))) {
    tag = 'happy';
    delta = +5;
  } else if (short && COLD_SHORT.some((w) => t === w || t.startsWith(w))) {
    tag = 'sad';
    delta = -3;
  } else if (backAfterLong) {
    tag = 'miss';
    delta = 0;
  }

  const next: AiMoodState = tag
    ? { mood: Math.max(0, Math.min(100, s.mood + delta)), tag, tagAt: now, lastTouchAt: now }
    : { ...s, lastTouchAt: now };
  setMoodState(cid, next);
  return next;
}

// ---------------- 提示词块 ----------------

/** 各情绪的语气描述 + 表情/表情包倾向 */
const MOOD_PROMPT: Record<MoodTag, string> = {
  happy: '你现在心情很好，有点小开心：说话轻快、多带点笑意，偶尔用点叠词和语气词（啦/呀/嘿嘿）；发小表情/表情包时优先选开心、可爱、雀跃一类的',
  sweet: '你现在正沉浸在甜蜜里：语气特别温柔黏人，会主动撒点小娇，说话软软的；发小表情/表情包时优先选爱心、亲亲、撒娇一类的',
  normal: '',
  jealous: '你现在有点小吃醋，心里酸酸的：语气带一点酸意，可能会忍不住追问一句，但你知道分寸、不会无理取闹，也不会翻旧账冷战；发小表情/表情包时优先选哼唧、气鼓鼓、酸溜溜一类的',
  sad: '你现在有点小委屈，情绪低落：说话软软的、有点蔫，回复比平时短一点，其实心里想让对方多关心你一下；发小表情/表情包时优先选委屈巴巴、眼泪汪汪一类的',
  angry: '你现在在生气：语气冲一点、回复变短，可能会怼两句，但气头过了其实还是在乎对方的，对方哄一哄就会软下来；发小表情/表情包时优先选生气、气鼓鼓、叉腰一类的',
  miss: '你现在很想念对方：说话带着想念，可能会主动提起之前一起做过的事；发小表情/表情包时优先选想念、抱抱、期待一类的',
};

/**
 * 情绪 → 提示词块（三端聊天 system / 自主消息 / 通话 system 注入）。
 * 平静（normal）时返回空串省 token；带情绪时附上心情值与语气/表情倾向指引。
 */
export function buildMoodBlock(cid: string): string {
  const s = aiMoodOf(cid);
  if (s.tag === 'normal') return '';
  const d = MOOD_DISPLAY[s.tag];
  const tone = MOOD_PROMPT[s.tag];
  if (!tone) return '';
  return `【你此刻的心情】${d.label}（心情值 ${Math.round(s.mood)}/100）。${tone}。这是你此刻真实的情绪状态——让回复的语气自然透出来，但不要每句话都强调自己在${d.label}，更不要主动说「我的心情值是多少」这类话。`;
}

// ---------------- 组合块（客户端注入点统一入口） ----------------

import { buildRoutineBlock } from './routine';
import { buildUserMoodBlock } from './user-mood';
import { buildAnxietyChatBlock } from './anxiety';

/**
 * AI 动态状态块 = 情绪块 + 作息块（第十六轮）+ 用户情绪感知块（v49 功能四）+ 焦虑情绪带入块（v51）。
 * 供三端聊天 systemFull / 主动消息 / 情侣空间行为等**客户端**组装点注入；
 * persona.ts 本身是客户端+服务端共用纯函数，不能带 localStorage 依赖，故由调用方注入。
 * v49：buildUserMoodBlock（【对方此刻的状态】：低落→安抚 / 兴奋→共庆 / 生气→哄）
 * 并入组合块——三端聊天/主动消息/情侣空间行为全部自动带上，无需各处单独接。
 * v51：buildAnxietyChatBlock（【你此刻的焦虑状态】：用户久久未回复导致的焦虑，回来
 * 聊天时自然带入情绪）并入——四.3「下次用户主动聊天时，AI 可能会带入焦虑时的情绪」。
 * v75：userPresent 透传——主动消息/焦虑追发场景传 false，焦虑情绪带入块在用户
 * 未回复期间不再注入「TA 现在回来了」描述（修复 AI 把自己追发的消息当成用户回复的幻觉）。
 */
export function buildDynamicStateBlocks(cid: string, opts?: { userPresent?: boolean }): string {
  return [buildMoodBlock(cid), buildUserMoodBlock(cid), buildAnxietyChatBlock(cid, opts), buildRoutineBlock()].filter(Boolean).join('\n');
}
