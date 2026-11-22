'use client';

/**
 * 「TA 主动分享生活」引擎（W1-B5）——TA（AI 角色）每天不定期把「刚拍的照 / 刚吃的饭」
 * 这类生活日常主动发给用户：1~3 条短消息 + 一张配图，照片同时进 TA 的相册。
 *
 * 调度（复用现有主动引擎基础设施，不新增常驻定时器）：
 * - 挂进 runProactiveMsgTick 的 tickInner（ProactiveMsgWatcher 5s tick / keepalive Worker
 *   心跳双通道驱动，App 不打开也生效）；总开关 / 通话闹钟互斥 / 免打扰（DND）沿用引擎口径；
 * - 每天按「频率档」随机生成当日的触发时刻计划（低/中/高 ≈ 1/2/4 次，默认中档），
 *   计划时刻只落在 08:00~22:30（避开深夜）；错过窗口 12 分钟内仍补发（页面没开场景）；
 * - 去重：同一场景当天不重复（usedScenes 按自然日清空）；频率档变更当日按剩余窗口重排，
 *   当日实际投递量以频率上限闸兜底，绝不因重排超发。
 *
 * 内容：
 * - 场景池随机取题（刚吃的饭/路上看到的天空/工位一角/窗外夜景/奶茶咖啡/偶遇的猫狗/
 *   新买的小物件等 14 类）；文案经 LLM 按人设 + 记忆 + 关系生成 1~3 条短消息（复用
 *   proactive-msg 的 callLlmTwoTier 两级调用链）；LLM 不可用时退化为场景模板句，功能不崩；
 * - 配图：优先用户自配生图模型（复用 /api/imggen 管线，generateFreePhoto），未配置/失败
 *   走 /api/life-img（服务端 z-ai-web-dev-sdk 生图，客户端绝不引入 SDK）；图片统一压缩到
 *   512px 档（相册/聊天同源 dataURL，防 IndexedDB 膨胀）；生成失败只发文字，绝不阻塞主聊天。
 *
 * 投递：走 ai-delivery 逐条节奏管线落到与 TA 的信息主会话（sms:c:<cid>，信息 App），
 * 文字在前图片在后；通知走 pushChatNotification（图片按「[图片] 描述」占位）；
 * 相册联动：addAlbum 写入 TA 的相册（origin 'ai'，与聊天里的图同源）；记忆走
 * notePhotoMemory（30 分钟节流）。微信/QQ 真机通道目前只收文字（send-active texts），
 * 带图下发不可行——按「站内为主」处理，不硬做。
 *
 * 存储（设备级 kv，不按 App 账号作用域——投递固定进信息主会话，三端设置页共用一份配置）：
 * - life-share-cfg:<cid>：{ on, freq }；- life-share-last:<cid>：调度状态（当日计划/去重/防重）。
 */

import { genId } from './db';
import { kvGet, kvSet, kvDel } from './idb-kv';
import { getActiveAccountIdFor } from './accounts';
import { listContacts, ownerProfileFor, cachedOwnerName } from './contacts-store';
import { avatarFor, type ContactRecord } from '@/lib/contacts';
import { buildPersonaSystemPrompt } from './persona';
import { isDndWindowActive } from './notify-sound';
import { loadBlock } from './block-state';
import { getMemSettings, memChatRecallBlock } from '@/lib/memory';
import { buildTimeAwareBlock } from '@/lib/time-aware';
import { extractThinkBlocks } from '@/lib/think-filter';
import { stripLiteralQuotePrefix } from '@/lib/chat-rich';
import { callLlmTwoTier, extractJsonObjectSafely } from './proactive-msg';
import { scheduleAiDelivery } from './ai-delivery';
import { pushChatNotification } from './island-notify';
import { addAlbum } from './album-store';
import { generateFreePhoto, compressImageSrc, imgGenConfigReady, notePhotoMemory } from '@/lib/imggen';
import { useSettings } from './store';

// ---------------- 类型与常量 ----------------

/** 频率档位：低/中/高 ≈ 1/2/4 次每天（默认中档） */
export type LifeShareFreq = 'low' | 'mid' | 'high';

/** 生活分享配置（设备级，按联系人） */
export interface LifeShareConfig {
  on: boolean;
  freq: LifeShareFreq;
}

/** 调度状态（当日计划 + 去重 + 防重；设备级 kv 持久化） */
interface LifeShareState {
  /** 当日（本地时区 YYYY-MM-DD） */
  day: string;
  /** 当日随机触发时刻（自零点起的分钟数，升序） */
  plan: number[];
  /** 计划窗口已消费数（含错过跳过） */
  fired: number;
  /** 当日已实际投递次数（频率上限闸；重排计划不清零，防超发） */
  sentToday: number;
  /** 当日已用场景 id（同一场景当日不重复） */
  usedScenes: string[];
  /** 最近一次投递时间（发送间隔闸） */
  sentAt?: number;
  /** 最近分享过的文案（防重；保留最后 6 条） */
  recentTexts?: string[];
}

const CFG_KEY_PREFIX = 'life-share-cfg:';
const STATE_KEY_PREFIX = 'life-share-last:';

/** 触发时刻窗口：08:00~22:30（避开深夜；自主触发同口径的静默时段是 23:00~08:00，这里更保守） */
const WINDOW_START_MIN = 8 * 60;
const WINDOW_END_MIN = 22 * 60 + 30;
/** 错过窗口的补发宽限（分钟）：页面没开/休眠后回来，超窗不补（跳过该次） */
const GRACE_MIN = 12;
/** 对话活跃守卫（与引擎 CONVO_ACTIVE_MS 同口径）：用户 5 分钟内在信息端说过话 → 顺延 */
const CONVO_ACTIVE_MS = 300_000;
/** 同角色两次生活分享最小间隔（防与其它主动消息背靠背连发轰炸） */
const MIN_SEND_GAP_MS = 45_000;
/** 频率档 → 每天次数 */
const FREQ_COUNT: Record<LifeShareFreq, number> = { low: 1, mid: 2, high: 4 };
/** 配图压缩档位（px）：项目现有档位里偏小的一档，聊天清晰 + 相册容量可控 */
const IMG_MAX_PX = 512;
/** 内置生图通道超时（/api/life-img 服务端自身另有 130s 竞速兜底） */
const IMG_TIMEOUT_MS = 150_000;

// ---------------- 场景池 ----------------

/** 生活场景（随机取题；ctx 进 LLM 文案情境，img 是配图主体描述，label 是兜底文案/相册描述） */
export interface LifeScene {
  id: string;
  /** 场景短名（模板句/相册描述兜底） */
  label: string;
  /** 注入 LLM 的情境说明 */
  ctx: string;
  /** 配图主体描述（不拼风格词，风格统一由 buildLifePhotoPrompt 补） */
  img: string;
}

const LIFE_SCENES: LifeScene[] = [
  { id: 'meal', label: '刚吃的饭', ctx: '你刚吃的一顿饭（外卖或自己做的都行）', img: '刚吃完的一顿日常饭菜摆在桌上，手机随手拍视角' },
  { id: 'sky', label: '路上看到的天空', ctx: '你路上抬头看到的天空', img: '走在路上抬头看到的天空，云和光线自然' },
  { id: 'desk', label: '工位一角', ctx: '你的工位或书桌一角', img: '办公工位一角，键盘水杯显示器和日常杂物' },
  { id: 'nightview', label: '窗外夜景', ctx: '你窗外此刻的夜景', img: '夜晚从居民楼窗户看出去的城市灯火' },
  { id: 'drink', label: '奶茶咖啡', ctx: '你手边刚买的奶茶或咖啡', img: '桌上一杯刚买的奶茶，杯壁挂着水珠' },
  { id: 'cat-dog', label: '偶遇的猫狗', ctx: '你今天偶遇的一只猫或狗', img: '街边偶遇的一只猫，懒洋洋趴着晒太阳' },
  { id: 'newstuff', label: '新买的小物件', ctx: '你刚到手的一个小物件', img: '刚拆封的新买小物件摆在桌面上' },
  { id: 'sunset', label: '傍晚的晚霞', ctx: '傍晚看到的晚霞', img: '傍晚天空的橘色晚霞和楼群剪影' },
  { id: 'street', label: '街边小店', ctx: '你路过的一家小店或便利店', img: '夜晚街边亮着灯的便利店门口' },
  { id: 'commute', label: '通勤路上', ctx: '你通勤路上的一刻（地铁/公交/步行）', img: '傍晚通勤路上的人流和街景' },
  { id: 'rain', label: '雨天的车窗', ctx: '下雨天车窗或玻璃上的雨滴', img: '雨天车窗玻璃上的雨滴和模糊街景' },
  { id: 'plant', label: '阳台的绿植', ctx: '你家里养的一盆绿植', img: '窗边一盆绿植，叶片上有光' },
  { id: 'snack', label: '今天的零食', ctx: '你正在吃的零食或水果', img: '摊开放着的日常零食和水果' },
  { id: 'moon', label: '今晚的月亮', ctx: '今晚抬头看到的月亮', img: '夜空里的月亮和薄云' },
];

/** 模板句兜底（LLM 不可用时按场景随机取 1~2 条；措辞保持随手分享口吻） */
const SCENE_TEMPLATES: Record<string, string[]> = {
  meal: ['刚吃完饭，今天这家味道还挺行的', '今日份干饭，随便拍了一张给你看看'],
  sky: ['路上的天空还挺好看的，随手拍了一张', '抬头看到这个天，想给你看看'],
  desk: ['我的工位今日实况，主打一个乱中有序', '忙里偷闲，给你看一眼我的工位'],
  nightview: ['窗外的夜景，今晚灯挺亮的', '刚在窗边站了一会儿，拍给你看'],
  drink: ['今天这杯奶茶有点甜，不过还挺好喝', '续命的水已就位，给你看看'],
  'cat-dog': ['刚刚路上一只猫挡着路不让走，气死', '今天偶遇一只小狗，太可爱了，发你看'],
  newstuff: ['刚拆了个快递，新买的小东西还挺好看', '新到的，给你看看值不值'],
  sunset: ['今天的晚霞也太好了吧', '下班路上看到晚霞，随手拍给你'],
  street: ['楼下便利店今晚灯光挺好，买了点吃的', '路过常去的那家店，今天人不多'],
  commute: ['通勤路上，今天居然不挤', '下班路上随手一拍，路上还挺堵'],
  rain: ['下雨了，窗玻璃上的水珠还挺好看', '雨天路上全是伞，拍了一张'],
  plant: ['我那盆绿植又长新叶子了，开心', '浇水的时候随手拍的，长得还行吧'],
  snack: ['今天的水果感觉不太甜，将就吃', '拆了包零食边吃边看剧，舒服'],
  moon: ['今晚月亮很圆，拍给你看看', '刚抬头看到月亮，突然有点想你'],
};

/** 「生活随手拍」质感提示词（手机摄影感，不做精修大片感） */
const LIFE_PHOTO_STYLE = '生活随手拍质感，手机摄影，自然光，轻微颗粒感，构图随意不刻意，真实日常场景，不精修不摆拍';

// ---------------- 配置读写 ----------------

/** 频率档短标签（设置页 chips 用） */
export const LIFE_FREQ_LABEL: { v: LifeShareFreq; label: string }[] = [
  { v: 'low', label: '低 · 1次' },
  { v: 'mid', label: '中 · 2次' },
  { v: 'high', label: '高 · 4次' },
];

const DEFAULT_LIFE_CFG: LifeShareConfig = { on: true, freq: 'mid' };

function sanitizeCfg(raw: unknown): LifeShareConfig {
  const r = (raw ?? {}) as Partial<LifeShareConfig>;
  const freq = r.freq === 'low' || r.freq === 'high' ? r.freq : 'mid';
  return { on: r.on !== false, freq };
}

/** 读某联系人的生活分享配置（默认开启 · 中档；设备级，三端设置页共用） */
export function getLifeShareCfg(cid: string): LifeShareConfig {
  try {
    return sanitizeCfg(kvGet<unknown>(CFG_KEY_PREFIX + cid));
  } catch {
    return { ...DEFAULT_LIFE_CFG };
  }
}

/** 写配置 */
export function setLifeShareCfg(cid: string, cfg: LifeShareConfig): void {
  try {
    kvSet(CFG_KEY_PREFIX + cid, sanitizeCfg(cfg));
  } catch {
    /* 写失败静默（下次读回默认） */
  }
}

// ---------------- 调度状态 ----------------

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 当日随机计划：N 个时刻均匀随机撒在窗口内（含端点，升序） */
function planFor(count: number): number[] {
  const span = WINDOW_END_MIN - WINDOW_START_MIN;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(WINDOW_START_MIN + Math.floor(Math.random() * (span + 1)));
  }
  return out.sort((a, b) => a - b);
}

function sanitizeState(raw: unknown): LifeShareState | null {
  const r = (raw ?? {}) as Partial<LifeShareState>;
  if (typeof r.day !== 'string' || !Array.isArray(r.plan)) return null;
  const plan = r.plan.filter((n) => Number.isInteger(n) && n >= 0 && n <= 1439).slice(0, 8);
  return {
    day: r.day,
    plan,
    fired: Number.isInteger(r.fired) && r.fired >= 0 ? r.fired : 0,
    sentToday: Number.isInteger(r.sentToday) && r.sentToday >= 0 ? r.sentToday : 0,
    usedScenes: Array.isArray(r.usedScenes) ? r.usedScenes.filter((s) => typeof s === 'string').slice(0, 14) : [],
    sentAt: typeof r.sentAt === 'number' ? r.sentAt : undefined,
    recentTexts: Array.isArray(r.recentTexts) ? r.recentTexts.filter((t) => typeof t === 'string').slice(-6) : undefined,
  };
}

/**
 * 取调度状态并保证「当日有效」：
 * 跨天 / 频率档变更（计划条数与档位不符）→ 重排当日计划；同日变更保留
 * sentToday/usedScenes/recentTexts/sentAt（上限闸与去重不清零，防重排后超发）。
 */
function ensureState(cid: string): LifeShareState {
  const today = todayKey();
  const target = FREQ_COUNT[getLifeShareCfg(cid).freq];
  let st: LifeShareState | null = null;
  try {
    st = sanitizeState(kvGet<unknown>(STATE_KEY_PREFIX + cid));
  } catch {
    st = null;
  }
  const sameDay = st?.day === today;
  if (!st || !sameDay || st.plan.length !== target) {
    st = {
      day: today,
      plan: planFor(target),
      fired: 0,
      sentToday: sameDay ? (st?.sentToday ?? 0) : 0,
      usedScenes: sameDay ? (st?.usedScenes ?? []) : [],
      sentAt: st?.sentAt,
      recentTexts: sameDay ? st?.recentTexts : undefined,
    };
    saveState(cid, st);
  }
  return st;
}

function saveState(cid: string, st: LifeShareState): void {
  try {
    kvSet(STATE_KEY_PREFIX + cid, st);
  } catch {
    /* 写失败静默（下次 tick 重读重建） */
  }
}

/** 随机取一个场景（优先当日未用过的；全用过则放开重用） */
function pickScene(st: LifeShareState): LifeScene {
  const fresh = LIFE_SCENES.filter((s) => !st.usedScenes.includes(s.id));
  const pool = fresh.length > 0 ? fresh : LIFE_SCENES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** 投递成功后推进状态（场景去重 / 间隔闸 / 防重文案） */
function markShared(cid: string, scene: LifeScene, texts: string[]): void {
  try {
    const st = ensureState(cid);
    st.usedScenes = [...st.usedScenes, scene.id].slice(-14);
    st.sentAt = Date.now();
    st.recentTexts = [...(st.recentTexts ?? []), ...texts].slice(-6);
    saveState(cid, st);
  } catch {
    /* 状态失败不影响已完成的投递 */
  }
}

// ---------------- 信息端消息读取（守卫 + 上下文共用） ----------------

const SMS_MSGS_KEY = (cid: string): string => `ios-chat-msgs:c:${cid}`;

interface SmsMsgShape {
  role: 'user' | 'assistant';
  time: number;
  content?: unknown;
  kind?: unknown;
  img?: { desc?: unknown } | null;
  voice?: { transcript?: unknown; localText?: unknown } | null;
  recalled?: unknown;
  sys?: unknown;
}

/** 信息端消息的最小文本化（sys/通知/卡片类跳过；图片 → [图片] 描述占位；语音 → 转写文本） */
function smsMsgText(r: Record<string, unknown>): string {
  if (r.recalled === true || r.sys) return '';
  const kind = typeof r.kind === 'string' ? r.kind : 'text';
  const content = typeof r.content === 'string' ? r.content.trim() : '';
  if (kind === 'voice') {
    const t = typeof r.voice?.transcript === 'string' ? r.voice.transcript.trim() : '';
    const l = typeof r.voice?.localText === 'string' ? r.voice.localText.trim() : '';
    return l || t || '[语音]';
  }
  if (kind === 'image') {
    const d = typeof r.img?.desc === 'string' ? r.img.desc.trim() : '';
    return d ? `[图片] ${d}` : '[图片]';
  }
  if (kind === 'text' || kind === 'textcard' || kind === undefined) return content;
  return '';
}

function readSmsMsgs(cid: string): SmsMsgShape[] {
  try {
    const raw = kvGet<unknown[]>(SMS_MSGS_KEY(cid));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
      .map((r) => ({
        role: r.role === 'user' ? ('user' as const) : 'assistant' as const,
        time: typeof r.time === 'number' ? r.time : 0,
        content: r.content,
        kind: r.kind,
        img: (r.img as { desc?: unknown } | null | undefined) ?? null,
        voice: (r.voice as { transcript?: unknown; localText?: unknown } | null | undefined) ?? null,
        recalled: r.recalled,
        sys: r.sys,
      }))
      .sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}

/** 用户 5 分钟内在信息端有互动 → 视为会话活跃（守卫：不打断正在进行的聊天） */
function isSmsConvActive(cid: string, now: number): boolean {
  const msgs = readSmsMsgs(cid);
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') return now - msgs[i].time < CONVO_ACTIVE_MS;
  }
  return false;
}

/** 信息端最后一条 AI 发言时间（发送间隔闸：与其它主动消息不背靠背） */
function lastSmsAssistantAt(cid: string): number {
  const msgs = readSmsMsgs(cid);
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant') return msgs[i].time;
  return 0;
}

/** 三端任一端有聊天记录（成本闸：从没聊过天的角色不启动生活分享） */
function hasAnyChatHistory(cid: string): boolean {
  try {
    for (const k of [`wx-chat-msgs:${cid}`, `qq-chat-msgs:${cid}`, SMS_MSGS_KEY(cid)]) {
      const raw = kvGet<unknown[]>(k);
      if (Array.isArray(raw) && raw.length > 0) return true;
    }
  } catch {
    /* 读失败按无记录 */
  }
  return false;
}

// ---------------- 文案生成（LLM 两级链路 → 模板句兜底） ----------------

function formatNowForPrompt(): string {
  const d = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${week} ${hm}`;
}

/** 单条分享文案清洗（剥引用前缀/引号包裹/列表符号；与主动消息同口径） */
function cleanShareLine(s: string): string {
  return stripLiteralQuotePrefix(s)
    .replace(/^[-–—•·\d.、]+\s*/, '')
    .replace(/^[「"'『]+|[」"'』]+$/g, '')
    .trim()
    .slice(0, 200);
}

/** 场景模板句（LLM 不可用时 1~2 条随机拼装，功能不崩） */
function templateTextsOf(scene: LifeScene): string[] {
  const pool = SCENE_TEMPLATES[scene.id] ?? [`${scene.label}，随手拍了一张给你看看`];
  const n = Math.random() < 0.55 ? 1 : Math.min(2, pool.length);
  const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, n);
  return picked;
}

/** 生成规则（人设 extraRules 注入） */
function lifeRules(scene: LifeScene): string[] {
  return [
    '【主动分享生活场景】你现在要主动给对方分享生活——不是回复，对方没有在等你说话，是你随手把刚发生/刚看到的小事发过去。',
    `你刚经历的生活场景：${scene.ctx}（按你的实际生活具体化：是什么、什么样、在哪）。`,
    '输出一个 JSON 对象（只输出 JSON，禁止任何额外文字）：{"messages":["第1条","第2条","第3条"],"photoDesc":"配图的画面描述"}',
    'messages：1~3 条短消息，像随手分享时连发的那样——先一句话说起这事，再说点感受/吐槽/调侃，最后一条自然带出「拍给你看看」的意思；每条 8~40 字，口语化，贴合你的人设和你们的关系；禁止 emoji、禁止标题/解释/括号说明。',
    'photoDesc：这张随手拍的具体画面（15~40 字，写清主体/光线/构图；不要出现人名、文字、水印要求；画面里一般没有人物，除非场景本身有）。',
    '内容符合当前真实时间（清晨/午后/深夜要合理），不要重复你最近分享过的内容，也不要复述对方的话。',
    '下面注入的记忆、近况都是你亲身经历的事：内容必须有来处，绝不能编造记录里没有的细节。',
  ];
}

/** LLM 生成 1~3 条分享短消息 + 配图描述（两级兜底；失败返回 null 走模板句） */
async function generateLifeTexts(contact: ContactRecord, scene: LifeScene, st: LifeShareState): Promise<{ texts: string[]; photoDesc: string } | null> {
  const owner = await ownerProfileFor('sms').catch(() => null);
  const userName = owner?.realName || '用户';
  const msgs = readSmsMsgs(contact.id);

  const persona = buildPersonaSystemPrompt(contact, {
    channel: '短信',
    userName: owner?.realName || null,
    ownerName: owner?.realName || null,
    multiApp: getMemSettings(contact.id).share,
    accountId: getActiveAccountIdFor('sms'),
    extraRules: lifeRules(scene),
  });
  const memoryBlock = memChatRecallBlock(contact.id, 'sms', `你刚${scene.ctx}，想把这份生活日常随手分享给对方`, {
    altMainName: cachedOwnerName(),
    altMainRelation: contact.relation?.trim() || '',
  });
  const timeBlock = buildTimeAwareBlock({ lastMsgTime: msgs.length > 0 ? msgs[msgs.length - 1].time : null, regionHint: contact.region || null });
  const system = [persona, memoryBlock, timeBlock].filter(Boolean).join('\n\n');

  const parts: string[] = [`【当前时间】${formatNowForPrompt()}`];
  const recent = msgs
    .slice(-8)
    .map((m) => {
      const t = smsMsgText(m as unknown as Record<string, unknown>);
      return t ? `${m.role === 'user' ? userName : contact.name}：${t}` : '';
    })
    .filter(Boolean)
    .join('\n');
  if (recent) parts.push(`【最近聊天】\n${recent}`);
  else parts.push('【最近聊天】\n（最近没有聊天记录）');
  if (st.recentTexts && st.recentTexts.length > 0) {
    parts.push(`【你最近分享过的内容（严禁重复或换汤不换药）】\n${st.recentTexts.map((t) => `- ${t}`).join('\n')}`);
  }
  parts.push('【任务】输出 JSON。');

  const raw = await callLlmTwoTier(system, parts.join('\n\n'), useSettings.getState().apiConfig);
  const stripped = extractThinkBlocks(raw ?? '').text;
  if (!stripped.trim()) return null;
  const parsed = extractJsonObjectSafely(stripped) as { messages?: unknown; photoDesc?: unknown } | null;
  if (!parsed) return null;
  const texts = (Array.isArray(parsed.messages) ? parsed.messages : [])
    .filter((t): t is string => typeof t === 'string')
    .map(cleanShareLine)
    .filter(Boolean)
    .slice(0, 3);
  const photoDesc = typeof parsed.photoDesc === 'string' ? parsed.photoDesc.trim().slice(0, 60) : '';
  if (texts.length === 0) return null;
  return { texts, photoDesc };
}

// ---------------- 配图（用户模型优先 → 服务端 SDK 兜底 → 失败降级只发文字） ----------------

/** 生图最终提示词：LLM 给的画面描述优先，否则场景主体描述；统一拼随手拍风格 */
function buildLifePhotoPrompt(scene: LifeScene, photoDesc: string): string {
  const subject = photoDesc && photoDesc !== scene.label ? photoDesc : scene.img;
  return `${subject}，${LIFE_PHOTO_STYLE}`;
}

/**
 * 生成一张生活随手拍照片（返回 512px 压缩 dataURL；失败返回 null——只发文字，不阻塞）：
 * ① 用户自配生图模型（设置 › 图像生成）→ 复用 /api/imggen 管线（generateFreePhoto，proxy/direct 与 150s 超时沿用）；
 * ② 未配置/失败 → /api/life-img（服务端 z-ai-web-dev-sdk 生图；SDK 只在服务端，客户端零引入）；
 * ③ 再失败 → null（调用方降级为只发文字）。
 */
export async function generateLifeSharePhoto(prompt: string): Promise<string | null> {
  // ① 用户自己的生图模型优先（与全站「用户配置优先」口径一致）
  try {
    const cfg = useSettings.getState().imgGenConfig;
    if (cfg.enabled && imgGenConfigReady(cfg)) {
      const raw = await generateFreePhoto(cfg, prompt);
      const src = await compressImageSrc(raw, IMG_MAX_PX, 0.8);
      if (src.startsWith('data:image/')) return src;
    }
  } catch {
    /* 落到内置通道 */
  }
  // ② 服务端 SDK 生图（/api/life-img）
  try {
    const res = await fetch('/api/life-img', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, size: '768x1344' }),
      signal: AbortSignal.timeout(IMG_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { src?: string; error?: string } | null;
      if (data?.src && data.src.startsWith('data:image/')) {
        const src = await compressImageSrc(data.src, IMG_MAX_PX, 0.8);
        if (src.startsWith('data:image/')) return src;
      }
    }
  } catch {
    /* 降级：只发文字 */
  }
  return null;
}

// ---------------- 投递（信息主会话 + 通知 + 相册 + 记忆） ----------------

/** 一次生活分享的组装产物 */
interface ComposedLifeShare {
  texts: string[];
  imgSrc: string | null;
  photoDesc: string;
}

/** 组装一次分享：LLM 文案（模板句兜底）+ 配图（失败降级为纯文字） */
async function composeLifeShare(contact: ContactRecord, scene: LifeScene, st: LifeShareState): Promise<ComposedLifeShare> {
  const llm = await generateLifeTexts(contact, scene, st).catch(() => null);
  const texts = llm && llm.texts.length > 0 ? llm.texts : templateTextsOf(scene);
  const photoDesc = (llm?.photoDesc ?? '').trim() || scene.label;
  const prompt = buildLifePhotoPrompt(scene, photoDesc);
  const imgSrc = await generateLifeSharePhoto(prompt).catch(() => null);
  return { texts, imgSrc, photoDesc };
}

/** 落库的消息形态（与信息端 ChatMsg 兼容子集：text/image 两种气泡） */
interface LifeShareMsg {
  id: string;
  role: 'assistant';
  content: string;
  time: number;
  kind?: 'text' | 'image';
  img?: { src: string; desc: string };
}

/**
 * 投递一轮生活分享：文字气泡（1~3 条）在前、图片气泡在后，走 ai-delivery 逐条节奏
 * 落到与 TA 的信息主会话（sms:c:<cid>）；通知按消息类型映射占位文本；图片同源写入
 * TA 的相册（origin 'ai'）+ 记忆节流打点。失败静默（后台增强能力，绝不阻塞主聊天）。
 */
async function deliverLifeShare(args: { contact: ContactRecord; texts: string[]; imgSrc: string | null; photoDesc: string; scene: LifeScene }): Promise<boolean> {
  const { contact, texts, imgSrc, photoDesc, scene } = args;
  if (texts.length === 0 && !imgSrc) return false;
  const cid = contact.id;
  const sessionKey = `sms:c:${cid}`;
  const now = Date.now();
  const items: LifeShareMsg[] = [];
  texts.forEach((t, i) => items.push({ id: genId(), role: 'assistant', content: t, time: now + i * 60, kind: 'text' }));
  if (imgSrc) items.push({ id: genId(), role: 'assistant', content: '', time: now + texts.length * 60, kind: 'image', img: { src: imgSrc, desc: photoDesc } });

  const saveOne = (m: LifeShareMsg): void => {
    try {
      const raw = kvGet<unknown[]>(SMS_MSGS_KEY(cid));
      const list = Array.isArray(raw) ? raw : [];
      kvSet(SMS_MSGS_KEY(cid), [...list, m]);
    } catch {
      /* 落库失败静默 */
    }
  };

  await scheduleAiDelivery<LifeShareMsg>(
    sessionKey,
    items,
    (m) => {
      saveOne(m);
      const body = m.kind === 'image' ? (m.img?.desc ? `[图片] ${m.img.desc}` : '[图片]') : m.content;
      pushChatNotification({
        sessionKey,
        app: 'chat',
        title: contact.name,
        avatar: avatarFor(contact, 'sms'),
        body,
        target: { app: 'chat', contactId: cid },
      });
    },
    { initialDelay: 0 },
  );

  // 相册联动：同一份 dataURL 写进 TA 的相册（相册 App 可见，与聊天里的图同源）
  if (imgSrc) {
    try {
      void addAlbum(cid, imgSrc, { desc: photoDesc || scene.label, name: `生活分享 · ${scene.label}`, origin: 'ai' });
    } catch {
      /* 相册写入失败不影响聊天投递 */
    }
  }
  // 记忆打点（30 分钟节流；失败静默）
  try {
    notePhotoMemory(cid, 'sms', photoDesc || scene.label);
  } catch {
    /* 静默 */
  }
  return true;
}

// ---------------- 调度引擎（挂进 runProactiveMsgTick） ----------------

/** 联系人级生成锁：同一角色正在生成/投递时其他 tick 跳过 */
const generating = new Set<string>();

/**
 * 生活分享调度 tick（tickInner 末尾调用；总开关/通话/闹钟互斥由 tickInner 入口统一把守）：
 * 全联系人扫描（与焦虑追发 anxLoop 同思路——生活分享默认开启，无需先配置过其它触发），
 * 守卫链：拉黑 → 三端无聊天记录 → DND → 计划到期（含宽限补发/过期跳过）→ 当日额度 →
 * 会话活跃/发送间隔 → 消费窗口并异步生成投递（fire-and-forget，绝不阻塞 tick 节奏）。
 */
export async function runLifeShareTick(allContacts: ContactRecord[]): Promise<void> {
  if (isDndWindowActive()) return; // 系统免打扰：整体顺延（计划与宽限窗口保留，DND 结束后自然补）
  const now = Date.now();
  const d = new Date(now);
  const minuteOfDay = d.getHours() * 60 + d.getMinutes();

  for (const contact of allContacts) {
    if (contact.kind === 'user' || !contact.name?.trim()) continue;
    const cid = contact.id;
    let cfg: LifeShareConfig;
    let st: LifeShareState;
    try {
      cfg = getLifeShareCfg(cid);
      if (!cfg.on) continue;
      if (loadBlock('sms', cid).byUser) continue; // 拉黑期间不打扰（与引擎四类触发同口径）
      if (!hasAnyChatHistory(cid)) continue; // 从没聊过天的角色不启动
      st = ensureState(cid); // 当日有效性保证（跨天/换档重排，见内）
    } catch {
      continue;
    }

    // 推进消费指针：彻底错过的窗口（超出宽限）静默跳过，不积压
    while (st.fired < st.plan.length && minuteOfDay - st.plan[st.fired] > GRACE_MIN) st.fired += 1;

    // 当日额度已满 / 窗口未到 / 无剩余窗口 → 跳过
    if (st.sentToday >= FREQ_COUNT[cfg.freq]) continue;
    if (st.fired >= st.plan.length) continue;
    const planMin = st.plan[st.fired];
    if (minuteOfDay < planMin) continue;

    // 静音守卫：用户 5 分钟内在信息端互动 / 刚发过消息（45s）→ 顺延（窗口不消费，宽限内自然补）
    if (isSmsConvActive(cid, now)) continue;
    if (now - lastSmsAssistantAt(cid) < MIN_SEND_GAP_MS) continue;
    if (now - (st.sentAt ?? 0) < MIN_SEND_GAP_MS) continue;
    if (generating.has(cid)) continue;

    // 消费窗口 + 占用当日额度（先落状态再异步生成：tick 重入不会重复触发同一窗口）
    st.fired += 1;
    st.sentToday += 1;
    saveState(cid, st);
    generating.add(cid);
    void (async () => {
      try {
        const scene = pickScene(st);
        const composed = await composeLifeShare(contact, scene, st);
        if (composed.texts.length > 0 || composed.imgSrc) {
          const ok = await deliverLifeShare({ contact, texts: composed.texts, imgSrc: composed.imgSrc, photoDesc: composed.photoDesc, scene });
          if (ok) markShared(cid, scene, composed.texts);
        }
      } catch {
        /* 生成/投递失败静默（本轮已消费，下轮按新窗口走） */
      } finally {
        generating.delete(cid);
      }
    })();
  }
}

// ---------------- 手动触发（设置页「立即分享一条」测试按钮） ----------------

/**
 * 立即生成并投递一条生活分享（设置页手动测试；不消费当日计划窗口，
 * 但计入当日额度并参与场景去重，与自动触发完全同一套生成/投递链路）。
 */
export async function manuallyShareLife(cid: string): Promise<boolean> {
  try {
    const all = await listContacts().catch(() => [] as ContactRecord[]);
    const contact = all.find((c) => c.id === cid);
    if (!contact || contact.kind === 'user' || !contact.name?.trim()) return false;
    if (loadBlock('sms', cid).byUser) return false;
    if (generating.has(cid)) return false; // 正在生成中：避免重复点击连发
    generating.add(cid);
    try {
      const st = ensureState(cid);
      const scene = pickScene(st);
      const composed = await composeLifeShare(contact, scene, st);
      if (composed.texts.length === 0 && !composed.imgSrc) return false;
      const ok = await deliverLifeShare({ contact, texts: composed.texts, imgSrc: composed.imgSrc, photoDesc: composed.photoDesc, scene });
      if (ok) {
        markShared(cid, scene, composed.texts);
        // 手动也算当日一条（额度口径一致；当日状态在额度满时手动按钮依旧可用——它不消费计划窗口）
        const s = ensureState(cid);
        s.sentToday += 1;
        saveState(cid, s);
      }
      return ok;
    } finally {
      generating.delete(cid);
    }
  } catch {
    return false;
  }
}

// ---------------- 联系人删除清理 ----------------

/** 删除联系人时清扫生活分享痕迹（配置 + 调度状态）；由 purgeProactiveForContact 级联调用 */
export function purgeLifeShareForContact(cid: string): void {
  try {
    kvDel(CFG_KEY_PREFIX + cid);
    kvDel(STATE_KEY_PREFIX + cid);
  } catch {
    /* 清理失败静默 */
  }
}
