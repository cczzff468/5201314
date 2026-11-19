'use client';

/**
 * 运行包构建 v6（v13 真机同源提示词 / v14 微信真表情包 + 语音频率档位）：把「微信/QQ 凭证 +
 * 绑定角色人设 + 模型 API + 历史种子」打包成 config.json，部署时上传到用户自己 Supabase 的
 * 私有桶 wx-cloud —— 云端助手（Edge Function / 内置网关）运行期就从这里读，改绑定/换 API
 * 后重新同步即可，无需重新部署。
 *
 * v6 变化（机主定调「让 AI 在真机微信/QQ 上回复的和网页上的一样」）：
 * - 人设提示词改为【直接复用站内组装器】：buildPersonaPrompt（wx-app/qq-app core）原样产出
 *   人设七要素 + 【连发短消息】条数块 + 沉浸规则（表情清单/引用/动作描写/语音条告知——
 *   全局预设管理器里用户的编辑与开关全部生效）+ 情绪动态状态块 + 记忆召回 + 深度思考开关；
 * - 世界书随包上云（cfg.<ch>.worldbook）：全局书常驻、局部/专属按触发词——云端核心 v13
 *   运行期按「来消息 + 最近历史」扫描命中注入（六位置同站内语义）；
 * - 连发标志 multi（回复条数 > 1）：云端按网站同款句界切分逐条连发；
 * - 贴纸 ID 表 stickerMap（微信）+ QQ 表情包（含内置全量、带 ID）——站内清单教 AI 输出
 *   [表情包:ID]，云端按 ID 解析：QQ 发真图（富媒体）、微信转经典表情代码。
 * v5 变化（保留）：
 * - 历史种子真打包：绑定联系人线程的最近 20 条随包上云（云端冷启动不失忆，回复内容与
 *   手机 App 聊天同源连续）；
 * - 人设提示词收敛：真机通道不叠加风格改写（行为对齐网站聊天），只保留通道能力约束。
 * v14 变化（机主定调「网站里内置的表情包真机微信也要能发」+ 语音频率档位）：
 * - 微信表情包全量上云：buildCloudEmoticons('wx') 打包进独立文件 emoticons.json（{wechat:[…]}，
 *   避开 config.json 的 800KB 单文件上传上限），云端核心按官方 iLink 媒体协议（AES-128-ECB
 *   → getuploadurl → CDN → image_item）发真图，失败降级经典表情代码；
 * - QQ 语音条频率跟随站内「AI 语音频率」档位（voiceEveryOf：关闭0/每条1/经常3/偶尔7/不经常12，
 *   v14 前恒为 3）。
 * v15 变化（机主能力清单表）：
 * - QQ 斗图模式（qq.stickerBattle，站内开关随包上云）：开启后云端核心把每轮表情包发送
 *   上限 3→5 张，并注入斗图提示词段。
 * v16 变化（机主定调同 sources.ts v16）：
 * - QQ 定时主动消息（早安/晚安）字段删除——主动消息改由站内「主动发消息」引擎驱动
 *   （deliverProactiveMsg → send-active），真机行为跟随网站设置；
 * - 照片能力（[照片:描述] 教学/生图链路）两通道全部删除；
 * - 微信人设里剥掉【引用回复】教学行 + 负规则（微信通道引用功能下线）；QQ 人设里剥掉
 *   【内置小表情】代码约定行 + 负规则（真机 QQ 不渲染 [微笑] 文字代码）；
 * - 表情包打包剔除「官方经典小表情」（builtin 无分组那批——即用户截图里「没内置却
 *   常发的大眼微笑脸」：站内面板把经典表情也教给了 AI，云端把它的图当表情包发成了大图）；
 *   只发用户收藏 + 内置大贴纸包（太阳小狗/小狗豹/小凑狗/古早企鹅）——与机主要求
 *   「网站里用户添加的表情包、内置的表情包可以发到真机」对齐；
 * - 未绑定角色的兑底人设补默认连发指令（站内 DEFAULT_REPLY_COUNT 同源）。
 */

import { buildDynamicStateBlocks } from '../ai-mood';
import { getMemSettings, memChatRecallBlock, setMemScopeForApp } from '@/lib/memory';
import { getContact, listContacts, ownerProfileFor } from '../contacts-store';
import { useSettings } from '../store';
import { wxIlinkLoginSnapshot, useWxConnect } from '../weixin-connect';
import { qqBotLoginSnapshot, useQqConnect } from '../qq-connect';
import { wxCloudSnapshot, ensureTaskSecret } from './store';
import { loadMsgs as loadWxThreadMsgs } from '@/components/apps/wx-app/core';
import { loadMsgs as loadQqThreadMsgs } from '@/components/apps/qq-app/core';
// v13 真机同源提示词：直接复用站内两端的组装器（人设 + 连发 + 沉浸规则 + 注册表用户编辑）
import { buildPersonaPrompt as buildWxPersonaPrompt, type WxUser } from '@/components/apps/wx-app/core';
import { buildPersonaPrompt as buildQqPersonaPrompt, type QQUser } from '@/components/apps/qq-app/core';
import { buildNpcPromptExtra } from '../npc-bond';
import { getDeepThinkOn, DEEP_THINK_RULE } from '@/lib/deep-think';
import { promptRule } from '@/lib/prompt-entries';
import { buildReplyCountPrompt, getReplyCount, DEFAULT_REPLY_COUNT } from '@/lib/reply-count';
import { getStickersOn } from '@/lib/sticker-toggle';
import { getActionDescOn } from '@/lib/action-desc';
import { getAiVoiceFreq } from '../ai-voice';
import { getQqStickerBattle } from '../qq-cloud-features';
import { loadStickers, type Sticker } from '../stickers';
import { loadBooks, getBoundBookIds } from '../worldbook';

export interface WxRunPersona {
  contactId: string;
  contactName: string;
  system: string;
}

/** 云端 QQ 表情包（打包进运行包：AI 输出 [表情包:ID/名字]，云端转图片经官方富媒体接口发出）
 *  v13：带 id——站内表情清单教的是 [表情包:ID]，云端按 ID 直选；name 仍是意思首词（自然语句变体解析用） */
export interface QqEmoticon {
  name: string;
  id: string;
  /** data URL（体积小：微信官方面 PNG + 包表情 webp） */
  dataUrl: string;
}

/** 云端 QQ 语音条 TTS（OpenAI 兼容 /audio/speech，wav → silk → 官方富媒体 file_type=3） */
export interface QqTtsConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
}

/** 云端历史种子（网站聊天最近 20 条：me→user / peer→assistant；云端冷启动续上下文） */
export interface WxSeedMsg {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

/** 云端世界书条目（站内 WbEntry 瘦身版：kw 触发词 / c 内容 / p 位置 / pr 优先级 / ic 忽略大小写） */
export interface WbCloudEntry {
  kw: string[];
  c: string;
  p: string;
  pr: number;
  ic: boolean;
}

/** 云端世界书书籍（g=全局常驻，其余按触发词命中） */
export interface WbCloudBook {
  name: string;
  g: boolean;
  entries: WbCloudEntry[];
}

export interface WxRunPackage {
  version: 2;
  /** 任务密钥（手动「云端测试一次」/ verify-qq 等函数动作鉴权用） */
  secret: string;
  wechat: {
    botToken: string;
    botId: string;
    /** confirmed 回包的 baseurl（云端 Bot API 走它；缺省回 ilinkai.weixin.qq.com） */
    baseUrl?: string;
    persona: WxRunPersona;
    /** v5 历史种子：网站聊天最近 20 条（云端冷启动不失忆——回复与网站同源连续） */
    history?: WxSeedMsg[];
    /** v13 贴纸 ID 表（ID→意思）：真机微信把 [表情包:ID] 转成经典表情代码的解析依据 */
    stickerMap?: Record<string, string>;
    /** v13 世界书（挂载书打包：全局常驻 + 触发词条目） */
    worldbook?: WbCloudBook[];
    /** v13 连发标志（站内回复条数 > 1）：云端按句界切分逐条连发 */
    multi?: boolean;
  } | null;
  qq: {
    appId: string;
    appSecret: string;
    botName?: string;
    persona: WxRunPersona;
    /** v5 历史种子：同微信 */
    history?: WxSeedMsg[];
    /** 内置+收藏表情包全量（空数组=不发）；失败/超预算自动截断 */
    emoticons?: QqEmoticon[];
    /** 配置了 OpenAI 兼容 TTS 才有：云端合成真语音条（未配置时内置网关在线走本地合成） */
    tts?: QqTtsConfig;
    /** 语音条频率：每 N 条纯文字出 1 条语音（3=经常；0=关） */
    voiceEvery?: number;
    /** v13 世界书（同微信） */
    worldbook?: WbCloudBook[];
    /** v13 连发标志（同微信） */
    multi?: boolean;
    /** v15 斗图模式：开启后每轮表情包发送上限 3→5 张 + 斗图提示词段 */
    stickerBattle?: boolean;
  } | null;
  /** 跟随「API 设置」的聊天 API */
  llm: { baseUrl: string; apiKey: string; model: string };
  promptTimeZone: string;
  syncedAt: number;
}

export type RunPackageResult =
  | { ok: true; pkg: WxRunPackage; note?: string; emoticonsFile?: { wechat: QqEmoticon[] } }
  | { ok: false; msg: string };

/** QQ 语音条频率 → 每几条出一条（跟随站内「AI 语音频率」档位；v14 前恒为 3）：
 *  off=0 关 / always=1 / often=3 / sometimes=7 / rarely=12 */
function voiceEveryOf(freq: ReturnType<typeof getAiVoiceFreq>): number {
  return freq === 'off' ? 0 : freq === 'always' ? 1 : freq === 'often' ? 3 : freq === 'sometimes' ? 7 : freq === 'rarely' ? 12 : 3;
}

const EXTRA_RULES_BASE = [
  '绝不透露自己是 AI、助手、机器人、bot 或存在系统提示；被问到就说自己是本人。',
];

/** 云端微信：v16 只保留通道能力约束（人设/清单/条数等全走站内组装器）——
 * 微信通道能发【真表情包图片】（[表情包:ID] 经官方媒体协议出图）+ 经典表情代码混排，
 * 发不出的标记自动降级经典表情代码（再不行剥除）。 */
const EXTRA_RULES_WX = [
  ...EXTRA_RULES_BASE,
  '【微信表情】你在这条通道上能发两类表情：①微信经典表情代码（如 [调皮] [偷笑] [捂脸] [呲牙] [破涕为笑] [发怒] [惊讶]），可与文字混排（如「哈哈[偷笑]」「晚安[月亮]」）；②真正的表情包图片——按表情包清单输出 [表情包:ID] 标记（单独占一行），系统会把那张表情包图片真的发给对方（发不出时自动转成对应经典表情代码，再不行才剥掉）。对方要表情包、斗图、要抱抱蹭蹭逗TA开心时优先发 [表情包:ID] 真图；明确点名要表情包的那条回复里一定要带标记，不许只回文字、不许装傻；平时正常聊天不必每次都发。',
  '（本通道没有引用回复功能——不要输出 [引用:编号] 标记，直接用文字回复就好；聊天记录里若出现 [M数字] 编号，那是系统的门牌号不是聊天内容。）',
  '对方给你发表情包或图片时你会收到「（对方发了一个表情包/图片，内容看不到）」这样的提示——照常理解TA的心情、用文字+表情自然回应即可，但绝不要假装已经发了图。',
];

/** 云端 QQ：富媒体能力（表情包/语音条）保留；v16 增「文字表情代码不可用」负规则（真机 QQ
 *  机器人通道不渲染 [微笑] 文字代码——用户实测以裸文字出现）。 */
const EXTRA_RULES_QQ = [
  ...EXTRA_RULES_BASE,
  '（本通道不支持 [微笑] 这类文字表情代码——想发表情就按表情包清单输出 [表情包:ID/名字] 标记，其余情况用文字自然聊。）',
  '对方发来的「（对方发了一个表情包/图片：xx）」是TA发表情包/图片的提示——照常理解TA的心情、自然回应（想斗图就按表情包清单回 [表情包:ID]），不要装作没见。',
];

/** v15 斗图模式提示词段（qq.stickerBattle 开启时注入云端 QQ 人设） */
function qqBattleRule(): string {
  return '【斗图模式】已开启：对方发表情包、挑衅斗图、发表情包怼你时，要接招反击——连发多张表情包（3~5 个 [表情包:名字或ID] 标记，各自单独占一行，可夹一两句短文字助战），斗出气势赢下这一局；对方认怂/换正常话题就停，别刷屏没完。平时正常聊天不必开启表情轰炸。';
}

/** 云端 QQ 内置表情兜底清单（loadStickers 读取失败/为空时才用；体积小优先；
 *  v16 剔除经典小表情（大眼微笑脸之谜）——兜底也只装大贴纸包） */
const CLOUD_EMOTICON_SOURCES: Array<{ name: string; url: string }> = [
  { name: '抱抱', url: '/stickers/sunny/16.webp' },
  { name: '贴贴', url: '/stickers/leopard/78.webp' },
  { name: '摸摸头', url: '/stickers/leopard/12.webp' },
  { name: '蹭蹭', url: '/stickers/sunny/04.webp' },
  { name: '睡觉', url: '/stickers/sunny/26.webp' },
  { name: '开心', url: '/stickers/leopard/68.webp' },
];

/** 单张表情的 base64 体积上限（dataUrl 长度；QQ 富媒体上传上限 2MB，这里收严保加载快） */
const EMOTICON_MAX_BYTES = 60 * 1024;
/** 表情包总预算（dataUrl 总长；防 config.json 过大拖慢云端加载） */
const EMOTICON_TOTAL_BUDGET = 512 * 1024;
/** 世界书打包总预算（内容字符数；超预算条目跳过） */
const WB_CLOUD_BUDGET = 30000;
/** 世界书单条截断长度 */
const WB_CLOUD_ENTRY_MAX = 3000;

/** 图片源 → dataUrl（dataURL 原样返回；相对路径/http(s) URL 走 fetch——跨域被拦就跳过该张） */
async function toEmoticonDataUrl(src: string): Promise<string> {
  if (/^data:image\//i.test(src)) {
    return src.length <= EMOTICON_MAX_BYTES ? src : '';
  }
  const res = await fetch(src, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res || !res.ok) return '';
  const blob = await res.blob();
  if (!blob.size || blob.size > EMOTICON_MAX_BYTES) return '';
  return await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  });
}

/** v16 真机可发表情筛选：剔除「官方经典小表情」（builtin 且不属于大贴纸包）——
 *  即用户截图里「没内置过却常发」的大眼微笑脸：站内面板把它们教给了 AI（ID 可选），
 *  云端把它的图当表情包发成了大图。真机只发【用户收藏 + 内置大贴纸包】；
 *  经典小表情在微信走 [微笑] 文字代码渲染（stickerMap→经典表情转换），在 QQ 干脆不发。 */
function cloudRealStickers(list: Sticker[]): Sticker[] {
  return list.filter((s) => !(s.builtin && !(s.groupId || '').startsWith('pk-')));
}

/** v16 人设规则行剥除（真机通道差异化）：删掉以指定标记开头的整行（各规则都是单行长文本）。
 *  - QQ：【内置小表情】代码约定行（真机 QQ 机器人通道不渲染 [微笑] 文字代码）
 *  - 微信：【引用回复·按需使用】教学行（微信通道引用功能下线）
 *  行不到（用户在全局预设管理器里改过开头等）也不炸——运行时另有负规则兑底。 */
function stripRuleLines(system: string, markers: string[]): string {
  return String(system || '')
    .split('\n')
    .filter((line) => !markers.some((m) => line.trimStart().startsWith(m)))
    .join('\n');
}

/**
 * 云端表情包打包 v13/v14/v16：网站表情包面板上云（机主定调「网站里用户添加的表情包、
 * 内置的表情包（大贴纸包）真机 QQ/微信也要能发」）：v14 参数化 app——QQ 进 config.json 的
 * qq.emoticons，微信进独立文件 emoticons.json 的 wechat 段；v16 剔除官方经典小表情
 * （cloudRealStickers——只发用户收藏 + 大贴纸包）。
 * - 总预算 EMOTICON_TOTAL_BUDGET 内能装多少装多少（单张 ≤60KB），失败/跨域跳过不阻塞同步；
 * - 读取失败/一张都没装上时退回精选兜底清单（v16 兜底也只装大贴纸包）。
 */
async function buildCloudEmoticons(app: 'wx' | 'qq'): Promise<QqEmoticon[]> {
  const out: QqEmoticon[] = [];
  const seen = new Set<string>();
  let total = 0;
  const push = (name: string, id: string, dataUrl: string): boolean => {
    if (!dataUrl || !name || seen.has(id || name)) return false;
    if (total + dataUrl.length > EMOTICON_TOTAL_BUDGET) return false;
    seen.add(id || name);
    out.push({ name, id, dataUrl });
    total += dataUrl.length;
    return true;
  };
  // ① 网站表情包（v16：用户收藏 + 大贴纸包；顺序 = 面板顺序）
  try {
    const all = cloudRealStickers(loadStickers(app));
    for (const s of all) {
      if (total > EMOTICON_TOTAL_BUDGET) break;
      const name = (s.meaning || '').trim().split(/[，,。.、\s]/)[0].slice(0, 12);
      if (!name) continue; // 没意思没法点名，跳过
      const dataUrl = await toEmoticonDataUrl(s.url);
      push(name, s.id, dataUrl);
    }
  } catch {
    /* 读取失败：走兜底清单 */
  }
  // ② 精选兜底（一张都没装上才补）
  if (out.length === 0) {
    for (const src of CLOUD_EMOTICON_SOURCES) {
      if (total > EMOTICON_TOTAL_BUDGET) break;
      try {
        const dataUrl = await toEmoticonDataUrl(src.url);
        push(src.name, '', dataUrl);
      } catch {
        /* 单张失败跳过 */
      }
    }
  }
  return out;
}

/** 贴纸 ID 表（微信）：loadStickers 的 id→意思（真机微信把 [表情包:ID] 解析成意思、再映射经典表情） */
function buildStickerMap(app: 'wx' | 'qq'): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const s of loadStickers(app)) {
      const meaning = (s.meaning || '').trim();
      if (s.id && meaning) out[s.id] = meaning.slice(0, 24);
    }
  } catch {
    /* 读取失败：空表（标记转换退回剥除） */
  }
  return out;
}

/**
 * 世界书随包上云（v13）：该联系人「本轮生效」的书——全局（常驻）+ 局部（挂载）+ 专属（绑定TA）。
 * 条目按 {kw, c, p, pr, ic} 瘦身打包；云端核心运行期按「来消息 + 最近历史」扫描命中注入。
 */
function buildWorldbookPack(contactId: string): WbCloudBook[] {
  try {
    const books = loadBooks();
    if (!books.length) return [];
    const bound = new Set(getBoundBookIds(contactId));
    const active = books.filter(
      (b) =>
        b.enabled !== false &&
        (b.scope === 'global' ||
          (b.scope === 'local' && bound.has(b.id)) ||
          (b.scope === 'exclusive' && b.targetContactId === contactId)),
    );
    const out: WbCloudBook[] = [];
    let used = 0;
    for (const b of active) {
      const entries: WbCloudEntry[] = [];
      for (const e of b.entries) {
        if (!e.enabled || !e.content.trim()) continue;
        const c =
          e.content.length > WB_CLOUD_ENTRY_MAX
            ? e.content.slice(0, WB_CLOUD_ENTRY_MAX) + '…（本条世界设定超长，已截断）'
            : e.content;
        if (used + c.length > WB_CLOUD_BUDGET) continue; // 超总预算：该条目跳过（后面的条目仍可能装下）
        used += c.length;
        entries.push({
          kw: e.keywords.filter((k) => typeof k === 'string' && k.trim()).slice(0, 12),
          c,
          p: e.position,
          pr: e.priority,
          ic: !!e.ignoreCase,
        });
      }
      if (entries.length) out.push({ name: b.name?.trim() || '未命名世界书', g: b.scope === 'global', entries });
    }
    return out;
  } catch {
    return [];
  }
}

async function buildPersona(
  loginBoundId: string,
  fallbackName: string,
  channel: '微信' | 'QQ',
  contextText: string,
): Promise<WxRunPersona> {
  // v15 斗图模式：QQ 通道且站内开关开启时，斗图提示词段随人设上云（云端核心按它连发表情包反击）
  const qqBattleOn = channel === 'QQ' ? getQqStickerBattle() : false;
  const extraRules = channel === '微信' ? EXTRA_RULES_WX : qqBattleOn ? [...EXTRA_RULES_QQ, qqBattleRule()] : EXTRA_RULES_QQ;
  // v6 兑底人设：还没绑定角色时也有一套说得过去的基础人设（凭证照上云、网关照连接——
  // 旧版直接要求 boundContactId 才把 QQ 段打进包，没绑角色时云端永远看不到 QQ 凭证，
  // 网关 QQ 通道永远「正在连接」，用户实测踩坑）。绑好角色后 autoSync 自动重推完整人设。
  // v16：兑底人设也带站内同款默认连发指令（DEFAULT_REPLY_COUNT=30 同源——未绑定不再只回一条）。
  const fallbackSystem = `你和主人在真实${channel}上聊天，回复简短自然、口语化，严格保持角色，绝不透露自己是AI${fallbackName ? `；你在${channel}上的昵称是「${fallbackName}」` : ''}。`;
  let system = [fallbackSystem, buildReplyCountPrompt(DEFAULT_REPLY_COUNT), ...extraRules].filter(Boolean).join('\n\n');
  let contactName = fallbackName;
  const contact = loginBoundId ? await getContact(loginBoundId).catch(() => null) : null;
  if (contact) {
    contactName = contact.nickname || contact.name;
    const app: 'wx' | 'qq' = channel === '微信' ? 'wx' : 'qq';
    const sessionKey = `${app}:${contact.id}`;
    // v13：站内组装器原样复用——人设七要素 + 连发 + 沉浸规则 + 表情清单 + 引用教学 +
    // 全局预设管理器里用户的编辑与开关全部生效（与网页聊天同一套 system 文本）
    const owner = await ownerProfileFor(app).catch(() => null);
    const ownerName = owner?.realName || null;
    // v16：真机人设表情清单剔除官方经典小表情（与 emoticons 打包同口径——AI 只能选
    // 用户收藏 + 大贴纸包，不会再把经典小表情当大图表情包发出）
    const stickers = cloudRealStickers(loadStickers(app));
    const stickersOn = getStickersOn(sessionKey);
    const actionDescOn = getActionDescOn(sessionKey);
    const replyCount = getReplyCount(sessionKey);
    // v78 机主定的顺序：连发信息（回复条数指令）拼在人设块正下方——与站内 chat-page 同参
    const replyCountBlock = replyCount > 1 ? buildReplyCountPrompt(replyCount) : '';
    // QQ 通道有语音条能力（云端 TTS / 网关本地合成）→ 文字升级语音条告知一并带上；微信通道发不了语音
    const aiVoiceOn = app === 'qq' ? getAiVoiceFreq(sessionKey) !== 'off' : false;
    // 机主身份最小化桩（组装器只取称呼名 addressNameOf：真名 > 显示名）
    const me = {
      id: 'owner',
      name: ownerName || '我',
      realName: ownerName,
      nickname: null,
      avatar: null,
      wechatId: null,
      phone: null,
      qqId: null,
      persona: null,
    } as WxUser;
    // 记忆作用域先行（站内 B8 同款：召回读账号作用域前显式落位）
    setMemScopeForApp(app);
    const npcExtra = buildNpcPromptExtra(contact, await listContacts().catch(() => []));
    const persona =
      app === 'wx'
        ? buildWxPersonaPrompt(contact, me, ownerName, stickers, stickersOn, actionDescOn, npcExtra, aiVoiceOn, replyCountBlock)
        : buildQqPersonaPrompt(
            contact,
            me as unknown as QQUser,
            ownerName,
            stickers,
            stickersOn,
            actionDescOn,
            npcExtra,
            aiVoiceOn,
            replyCountBlock,
          );
    // 情绪/作息动态状态（站内 chat-page 的 buildDynamicStateBlocks 同款，全视之眼不进真机）
    const mood = buildDynamicStateBlocks(contact.id, { excludeWatch: true });
    // 记忆召回：真实最近上下文 + 互通开关 + 小号披露门控（站内私聊同参数语义）
    const userSide = contextText
      .split('\n')
      .filter((l) => l.startsWith('我:'))
      .join(' ')
      .slice(-400);
    const memRecall = memChatRecallBlock(contact.id, app, contextText, {
      interopOn: getMemSettings(contact.id).share,
      disclosureText: userSide,
    });
    // 深度思考开关（站内三端单聊同款；云端核心发送前剥掉 [思考] 块）
    const deepThink = getDeepThinkOn(contact.id) ? promptRule('deep-think', DEEP_THINK_RULE) ?? '' : '';
    // v16 真机差异化行剥：QQ 剥【内置小表情】代码约定行（真机 QQ 不渲染文字表情代码），
    // 微信剥【引用回复】教学行（微信通道引用下线）——EXTRA_RULES 里的负规则兜底
    const rawSystem = [persona, mood, memRecall, deepThink, ...extraRules].filter(Boolean).join('\n\n');
    system = app === 'qq'
      ? stripRuleLines(rawSystem, ['【内置小表情】'])
      : stripRuleLines(rawSystem, ['【引用回复·按需使用】']);
  }
  return { contactId: loginBoundId, contactName, system };
}

/** 线程消息 → 历史种子（v5：最近 20 条文字消息；me→user / peer→assistant） */
function threadSeed(contactId: string, channel: 'wx' | 'qq'): WxSeedMsg[] {
  try {
    const list = channel === 'wx' ? loadWxThreadMsgs(contactId) : loadQqThreadMsgs(contactId);
    const msgs = (Array.isArray(list) ? list : []) as Array<{ role?: string; content?: string; time?: number; kind?: string }>;
    return msgs
      .filter((m) => (m.role === 'me' || m.role === 'peer') && typeof m.content === 'string' && m.content.trim() && (!m.kind || m.kind === 'text'))
      .slice(-20)
      .map((m) => ({
        role: m.role === 'me' ? ('user' as const) : ('assistant' as const),
        content: String(m.content).slice(0, 500),
        ts: Number(m.time) || Date.now(),
      }));
  } catch {
    return [];
  }
}

/** 最近上下文文本（记忆召回用：最近条消息拼成 我/TA: 内容） */
function threadContext(seed: WxSeedMsg[]): string {
  return seed.map((m) => `${m.role === 'user' ? '我' : 'TA'}: ${m.content}`).join('\n').slice(-1500);
}

/** 构建运行包（失败给出可读原因：未配置模型 API）。
 *  未接入微信/QQ 时不再阻断——依赖方向是「先部署云端 → 再接入微信/QQ」，接入成功会
 *  自动重新同步运行包（autoSyncRunPackageIfDeployed），这里只带一条引导提示。 */
export async function buildRunPackage(): Promise<RunPackageResult> {
  // v11 boot 竞态修复：打包前先等微信/QQ 登录 store boot 完（幂等——已 boot 直通）。
  // 旧版在 boot 未完成时就读快照（解密 kv 是异步的）：已接入 QQ 的浏览器也会打包出
  // qq:null 的空包上云 → 网关/云端永远拿不到 QQ 凭证 → QQ 通道永远「正在连接/未接入」。
  try {
    await useWxConnect.getState().boot();
    await useQqConnect.getState().boot();
  } catch {
    /* boot 失败不阻断打包：按当前快照出包 */
  }
  const wxLogin = wxIlinkLoginSnapshot();
  const qqLogin = qqBotLoginSnapshot();
  const note =
    !wxLogin && !qqLogin
      ? '（提示：还没接入真机微信/QQ——先部署，之后到 微信 → 我 → 接入真机微信 或 QQ → 动态 → 接入QQ 扫码/填写接入即可，接入成功会自动同步到云端）'
      : undefined;

  // 模型 API：跟随「API 设置」（云端运行时用不了内置 SDK）
  const apiConfig = useSettings.getState().apiConfig;
  if (!apiConfig?.baseUrl) {
    return { ok: false, msg: '云端需要你在 设置 → API 设置 里配置自己的模型 API（BaseUrl + Key）——云端用不了 App 内置模型' };
  }

  // QQ 语音条：仅 OpenAI 兼容 TTS（/audio/speech，云端能直接调）；其它 provider 不带——
  // 内置网关在线时走网关本地合成（z-ai SDK wav），不依赖用户配置
  const ttsConfig = useSettings.getState().ttsConfig;
  const cloudTts: QqTtsConfig | null =
    ttsConfig.provider === 'openai' && ttsConfig.baseUrl.trim() && ttsConfig.apiKey.trim()
      ? {
          baseUrl: ttsConfig.baseUrl.trim(),
          apiKey: ttsConfig.apiKey.trim(),
          model: ttsConfig.model.trim() || 'tts-1',
          voice: ttsConfig.defaultVoiceId.trim() || 'alloy',
        }
      : null;

  // v5 历史种子：绑定联系人线程的最近 20 条（云端冷启动续上下文 + 记忆召回的真实上下文）
  const wxSeed = wxLogin?.boundContactId ? threadSeed(wxLogin.boundContactId, 'wx') : [];
  const qqSeed = qqLogin?.boundContactId ? threadSeed(qqLogin.boundContactId, 'qq') : [];

  const wechat = wxLogin
    ? {
        botToken: wxLogin.botToken,
        botId: wxLogin.botId,
        // confirmed 回包的 baseurl（云端 Bot API 走它；缺省回 ilinkai.weixin.qq.com）
        ...(wxLogin.baseUrl ? { baseUrl: wxLogin.baseUrl } : {}),
        persona: await buildPersona(wxLogin.boundContactId, wxLogin.boundContactName, '微信', threadContext(wxSeed)),
        ...(wxSeed.length ? { history: wxSeed } : {}),
        // v13：贴纸 ID 表 + 世界书 + 连发标志（绑定了角色才带；未绑定时兑底人设无清单可教）
        ...(wxLogin.boundContactId
          ? {
              stickerMap: buildStickerMap('wx'),
              worldbook: buildWorldbookPack(wxLogin.boundContactId),
              multi: getReplyCount(`wx:${wxLogin.boundContactId}`) > 1,
            }
          : {}),
      }
    : null;

  // v14 微信表情包（真图发送，独立文件 emoticons.json）：与 QQ 同源同预算，只装到上限；
  // 没接入微信时不打包（空数组不下文件，旧文件自然过期）
  const wxEmoticons = wxLogin ? await buildCloudEmoticons('wx') : [];
  const emoticonsFile = wxEmoticons.length ? { wechat: wxEmoticons } : undefined;

  const qq = qqLogin
    ? {
        appId: qqLogin.appId,
        appSecret: qqLogin.appSecret,
        botName: qqLogin.botName,
        // v6：不再要求已绑角色——凭证必须无条件上云（网关拿到凭证才能连 QQ，
        // 没绑角色时用兑底人设；绑好后 autoSync 重推完整人设）。与微信段同构。
        persona: await buildPersona(qqLogin.boundContactId || '', qqLogin.boundContactName || '', 'QQ', threadContext(qqSeed)),
        ...(qqSeed.length ? { history: qqSeed } : {}),
        // 表情包（网站全量带 ID）+ 语音条 + 世界书 + 连发标志（云端 QQ 能力：图片/语音走官方富媒体接口；
        // 加载失败静默降级文字；v14 voiceEvery 跟随站内「AI 语音频率」档位——机主表格里
        // 「语音频率可调：现在每 3 条 1 条，可做成设置档位」的落地）
        emoticons: await buildCloudEmoticons('qq'),
        voiceEvery: voiceEveryOf(getAiVoiceFreq(qqLogin.boundContactId ? `qq:${qqLogin.boundContactId}` : 'qq:default')),
        // v15 斗图模式（站内开关随包上云，云端核心消费；旧运行时读到只是忽略不出错）。
        // v16：qq.proactive（定时主动）字段已删除——主动消息改站内引擎驱动（send-active）
        stickerBattle: getQqStickerBattle(),
        ...(qqLogin.boundContactId
          ? {
              worldbook: buildWorldbookPack(qqLogin.boundContactId),
              multi: getReplyCount(`qq:${qqLogin.boundContactId}`) > 1,
            }
          : {}),
        ...(cloudTts ? { tts: cloudTts } : {}),
      }
    : null;

  const pkg: WxRunPackage = {
    version: 2,
    secret: ensureTaskSecret(),
    wechat,
    qq,
    llm: { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey ?? '', model: apiConfig.model ?? '' },
    promptTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    syncedAt: Date.now(),
  };
  // v14：微信表情包（emoticons.json 独立文件，同步端另传；QQ 表情仍在 pkg.qq.emoticons）
  return { ok: true, pkg, ...(note ? { note } : {}), ...(emoticonsFile ? { emoticonsFile } : {}) };
}
