'use client';

/**
 * 情侣空间 × AI 深度参与（第九轮）。
 *
 * 用户规格：
 * - AI（恋人联系人）根据人设/记忆/上下文参与情侣空间的一切：
 *   每天想你、照顾爱情小树、设置纪念日、回答甜蜜小问答（并知道我答了什么）、
 *   写心情日记（并知道我的心情/日记）、发起 100 件小事、知道恋爱协议内容并自己签字/自己拟协议让我签、
 *   知道恋爱编年史、主动填写情侣印象里对我的印象；
 * - 情侣空间里的所有东西都要让 AI 知道（聊天人设注入），所有东西都要写进记忆（记忆碎片）。
 *
 * 三条链路：
 * 1) coupleChatBlock(contactId, channel, userName)：微信/QQ 每轮发消息时同步组装【情侣空间】注入段
 *    ——AI「知道」你们的一切（同步读 kv，随用随取，永远最新）；
 * 2) coupleRemember(...)：情侣空间事件 → 恋人的记忆碎片（memAddEventFragment，sourceTag='couple'），
 *    由 CoupleSpaceApp 的 patch 钩子自动 diff 触发——用户做的每件事都进记忆；
 * 3) runCoupleAiTick(channel, contactId)：AI 主动行为调度（打开情侣空间触发，每日/周期去重，
 *    LLM 按「人设 + 共享记忆」生成内容，失败本地兜底，写状态 + 写记忆 + 灵动岛通知）。
 */

import { kvGet, kvSet } from './idb-kv';
import { promptTextOf } from '@/lib/prompt-entries';
import { memAddEventFragment, memChatRecallBlock, memConvoFromRaw, memRecallBlock } from '@/lib/memory';
// 第十六轮：AI 动态状态（情绪+作息）注入 + 作息提醒（早安/晚安/饭点，不占自主额度）
import { buildDynamicStateBlocks } from './ai-mood';
import { routineNudgeDue, routineNudgeMark, type RoutineNudgeKind } from './routine';
import { pushChatNotification } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { isProactiveChatActive, fireProactiveNudge } from './proactive-msg';
import { getContact, listContacts } from './contacts-store';
import { avatarFor, displayNameOf } from '@/lib/contacts';
import { dispatchStateEvent, readInviteMeta, type CoupleChannel } from './couple-invite';
// 100 件小事共享清单（第九轮：与 couple-space.tsx 共用同一份，AI 从真实清单里勾选）
import { HUNDRED_LIST } from './couple-hundred';
import { BOARD_CARDS, NOTE_COLOR_NAMES } from './couple-board-cards';
// 第三十一轮「情侣空间相册 AI 看图留言」：识图模型客户端 + 全局设置（拿识图配置，零配置自动内置兕底）
import { describeImagesAuto } from '@/lib/vision-client';
import { useSettings } from './store';
// 情侣空间相册 AI 拍照：生图配置判断 + 锁脸生成（未配置/失败自动降级文字图片）
import { generateCharacterPhoto, imgGenConfigReady } from '@/lib/imggen';

// ---------------- 状态形状（与 couple-space.tsx 的 CoupleState 保持结构兼容的只读子集） ----------------

const STATE_KEY = 'couple-space:state';

/**
 * 文字图片（未配置生图模型时的「照片」：一张只画着「画面」的文字卡片贴在相册里）。
 * 第五十七轮：卡片上只显示画面（desc）；text 改为随照片附给对方的一句话（进照片下方留言区）。
 */
export interface CoupleTextPhoto {
  kind: 'textcard';
  /** 画面（第三人称客观描述；卡片上只显示这一段，也是配置生图模型后的生图提示词） */
  desc?: string;
  /** 随照片附的一句话（进照片留言区，不在卡片上；旧数据无 desc 时卡片回退显示它） */
  text: string;
  /** 是否 TA（AI）拍的 */
  byTa?: boolean;
  at: number;
}

/** AI 生成的真图（第五十八轮：记录生成时的画面描述，相册大图可带提示词再生成） */
export interface CoupleGenPhoto {
  kind: 'img';
  /** 图片 dataURL */
  src: string;
  /** 生成时的画面描述（再生成时预填提示词，用户可改） */
  desc?: string;
  /** 是否 TA（AI）拍的 */
  byTa?: boolean;
  at: number;
}

/** 相册照片条目：dataURL 字符串（用户上传/旧数据真图）、AI 生成真图卡片或文字图片卡片 */
export type CouplePhotoEntry = string | CoupleTextPhoto | CoupleGenPhoto;

/** 判断照片条目是否为文字图片卡片 */
export function isTextPhoto(p: CouplePhotoEntry): p is CoupleTextPhoto {
  return typeof p === 'object' && p !== null && (p as CoupleTextPhoto).kind === 'textcard';
}

/** 判断照片条目是否为 AI 生成的真图卡片（带画面描述，可再生成） */
export function isGenPhoto(p: CouplePhotoEntry): p is CoupleGenPhoto {
  return typeof p === 'object' && p !== null && (p as CoupleGenPhoto).kind === 'img';
}

/** 取照片条目的图片地址（用户上传字符串 / AI 真图卡片；文字图片卡片返回空串） */
export function photoSrc(p: CouplePhotoEntry): string {
  return typeof p === 'string' ? p : isGenPhoto(p) ? p.src : '';
}

interface CoupleSnap {
  accepted?: boolean;
  anniversary?: string | null;
  meName?: string;
  taName?: string;
  /** 我的性别（'女'/'男'/'保密'；恋爱资料页设置）——AI 的一切言行都要符合 */
  gender?: string;
  signature?: string;
  missYou?: number;
  missYouByDay?: Record<string, number>;
  missSince?: string | null;
  taMissYou?: number;
  taMissYouByDay?: Record<string, number>;
  tree?: number;
  treeStreak?: { last: string | null; n: number };
  taTreeStreak?: { last: string | null; n: number };
  quiz?: { id: string; q: string; a: string; at: number }[];
  quizTa?: { q: string; a: string; at: number; withMe?: boolean }[];
  /** 轨迹位置跟随联系人 APP：上次同步时用的联系人地区文本（region 变了才重新 geocode 覆盖） */
  locFollow?: { me?: string | null; ta?: string | null };
  moods?: { id: string; emoji: string; text: string; at: number; dateKey?: string; from?: string }[];
  chronicle?: { id: string; text: string; at: number }[];
  chronicleMonths?: { ym: string; status: string }[];
  hundred?: number[];
  hundredItems?: Record<string, { img: string | null; desc: string; date: string; place: string; byTa?: boolean }>;
  aiHundred?: { idx: number; note: string; why: string; at: number }[];
  /** AI 勾选 100 件小事去重（每天最多一件）：最近一次的日期 key（第九轮） */
  aiHundredDay?: string;
  pactAt?: number | null;
  pactTitle?: string;
  pactPreamble?: string;
  pactClauses?: string[];
  pactSignMe?: string | null;
  pactSignTa?: string | null;
  /** 已存档的协议书（第十二轮：AI 知道全部协议及签署状态） */
  pacts?: { id: string; title: string; preamble: string; clauses: string[]; signMe: string | null; signTa: string | null; meAt: number | null; taAt: number | null; at: number; status?: string; reason?: string }[];
  aiPact?: { title: string; preamble: string; clauses: string[]; at: number; signTa?: string | null; declined?: boolean } | null;
  annivExtra?: { key: string; label: string; date: string }[];
  aiAnnivKeys?: string[];
  impressionsMe?: string[];
  impressionsTa?: string[];
  aiImpressions?: string[];
  aiImpressAt?: number | null;
  myLoc?: { name: string; lat: number; lng: number } | null;
  taLoc?: { name: string; lat: number; lng: number } | null;
  meetLoc?: { name: string; lat: number; lng: number } | null;
  /** 情书（第十八轮改名，原未来情书）：我的信（envelope=信封样式 key；sharedAt=分享给 TA 的时间） */
  letters?: { id: string; text: string; at: number; openAfterDays?: number; envelope?: string; sharedAt?: number }[];
  /** TA 写给我的信（AI 回信/主动写信）；replyToId=回信指向的原信 id */
  aiLetters?: { id: string; text: string; envelope?: string; replyToId?: string; at: number }[];
  /** AI 主动写信去重（每天最多尝试一次；第五十八轮起频率由 TA 按人设/记忆自己决定）：最近一次尝试的日期 key */
  aiLetterDay?: string;
  aiLog?: { id: string; text: string; at: number }[];
  albums?: { id: string; name: string; desc: string; photos: CouplePhotoEntry[] }[];
  /** AI 往相册放照片去重（每 2 天最多一张）：最近一次的日期 key */
  aiPhotoDay?: string;
  /** 通用留言线程（第十轮）：相册照片/心情日记/问答/印象/回复挑战下的双向留言；rt=所回复的留言 id（第十二轮点击回复） */
  comments?: { id: string; key: string; from: string; text: string; at: number; rt?: string }[];
  /** TA 今天去过的地方 + 我的手机动态（人设记忆生成，第十八轮带图标/完整文案，位置与轨迹独立界面展示） */
  taTrail?: { dateKey: string; items: { t: string; place: string; note: string; icon?: string; who?: 'me' | 'ta'; text?: string }[]; at: number } | null;
  /** 位置与轨迹·动态记录流（第二十一轮：AI 按人设+记忆+真实时间生成的时间线记录，聊天式界面展示） */
  trailFeed?: { id: string; dateKey: string; t: string; kind: string; text: string; detail?: string; at: number }[];
  /** 回复挑战：TA 与我同时进行的最近一次双人闯关 */
  replyTa?: { active: boolean; picks: Record<string, { pick: number; say: string; at: number }>; mePicks: Record<string, { pick: number; text: string }>; startedAt: number; endedAt: number | null } | null;
  /** AI 主动留言去重（每天最多一条）：最近一次主动留言的日期 key */
  aiCommentDay?: string;
  /** 许愿树留言卡（晴天版：挂签自选颜色 color = 调色盘索引）；最新在前 */
  treeCards?: { id: string; from: 'me' | 'ta'; text: string; at: number; color?: number; comments: { id: string; from: 'me' | 'ta'; text: string; at: number }[] }[];
  /** AI 挂卡去重（每天最多一张）：最近一次挂卡的日期 key */
  treeCardDay?: string;
  /** 留言板（软木墙手写便签；unlockAt=时间胶囊解锁时间，封存中内容对双方都不可见）；最新在前 */
  boardNotes?: { id: string; from: 'me' | 'ta'; text: string; at: number; color?: number; card?: number; unlockAt?: number; comments: { id: string; from: 'me' | 'ta'; text: string; at: number }[] }[];
  /** AI 钉便签去重（每天最多一张）：最近一次钉便签的日期 key */
  boardNoteDay?: string;
  /** 手机上传的自定义便签卡纸（couple-space 上传；AI 选卡时可挑「自定义卡N」；card=100+下标） */
  boardCardCustom?: { src: string; ar: number; padTop?: number }[];
  /** 恋爱水平考试（第十五轮）：TA 知道卷子、成绩和彼此的作答 */
  examPaper?: { title: string; questions: { q: string; opts: string[] }[]; source?: string } | null;
  examTaPaper?: { title: string; questions: { q: string; opts: string[] }[]; at: number; answered?: boolean } | null;
  examTaSheet?: { title: string; picks: Record<string, number>; score?: number; comment?: string; at: number; myScore?: number | null; myComment?: string; taReply?: string; myMarks?: Record<string, { ok: boolean; score: number }> } | null;
  examResult?: { title: string; score: number; comment: string; byTa: boolean; at: number } | null;
  /** 星座缘分解读（第十九轮：用户 API 模型按真实占星生成，TA 也知道咱们的缘分结果） */
  zodiacReading?: { me: string; ta: string; score: number; text: string; glow: string; advice: string; watch: string; at: number } | null;
}

/** 留言线程 key → 场景名（记忆/注入/AI 上下文共用） */
function sceneOfKey(key: string, snap: CoupleSnap | null): string {
  if (key.startsWith('album:')) {
    const albumId = key.split(':')[1] ?? '';
    const album = (snap?.albums ?? []).find((a) => a.id === albumId);
    return `相册「${album?.name ?? '照片'}」的照片留言区`;
  }
  if (key.startsWith('mood:')) return '心情日记留言区';
  if (key.startsWith('quiz:')) return '甜蜜小问答的讨论区';
  if (key.startsWith('letter:')) return '情书留言区';
  if (key.startsWith('boardnote:')) return '留言板便签的留言区';
  if (key === 'trail') return '情侣轨迹的聊天区';
  if (key === 'impress') return '情侣印象留言区';
  if (key.startsWith('reply:')) {
    const seg = key.split(':');
    if (seg[1] === 'final') return '回复挑战结算留言区';
    const lv = Number(seg[seg.length - 1] ?? 0);
    return `回复挑战第${Number.isFinite(lv) && lv > 0 ? lv + 1 : 1}关讨论区`;
  }
  return '情侣空间留言区';
}

/** 同步读情侣空间状态（kv 内存缓存同步权威；未建立关系返回 null） */
function readSnap(): CoupleSnap | null {
  try {
    const s = kvGet<Record<string, unknown>>(STATE_KEY) ?? {};
    if (s.accepted !== true) return null;
    const meta = readInviteMeta();
    if (!meta.partnerContactId) return null;
    return s as CoupleSnap;
  } catch {
    return null;
  }
}

/** 直写情侣空间状态（读-改-写 + 广播；打开中的 App 会经 COUPLE_STATE_EVENT 自动刷新） */
function writeSnap(patch: (s: Record<string, unknown>) => Record<string, unknown> | null): void {
  try {
    const s = kvGet<Record<string, unknown>>(STATE_KEY) ?? {};
    const next = patch({ ...s });
    if (!next) return;
    kvSet(STATE_KEY, next);
  } catch {
    /* 落盘失败静默 */
  }
  dispatchStateEvent();
}

function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysSinceAnniv(anniv: string | null | undefined): number | null {
  if (!anniv) return null;
  const start = new Date(`${anniv}T00:00:00`).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((Date.now() - start) / 86400000) + 1);
}

function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function cut(s: string | undefined | null, max: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 去掉字符串里的全部 emoji/表情符号（用户要求：AI 留言不用 emoji）；返回去掉后的文本 */
function stripEmoji(s: string): string {
  return (s ?? '')
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{1F9B0}-\u{1F9B3}\u200D\uFE0E\uFE0F\u2600-\u27BF\u2B00-\u2BFF\u3030\u303D\u3297\u3299\u2190-\u21FF\u2700-\u27bf]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 性别纪律行（用户是女生 → 给她的称呼/标签/夸奖全部符合女生身份，绝不出现「男友」类词；同时明确 TA 自己的性别角色，绝不能自称女友） */
function genderLine(snap: CoupleSnap, me: string): string {
  const g = (snap.gender ?? '').trim();
  if (g === '女')
    return `重要：「${me}」是女生，你是男生——你是她的男朋友。你自己永远是男生：绝不能自称「女友/女朋友」，也不能把任何形容女生的词用在自己身上，更不能说「我可是需要被疼爱的女友」这类话（被疼爱的女友是${me}，不是你）。你给${me}的所有称呼、比喻、标签、夸奖都必须符合「她」的女生身份（例如夸她「女友力max」，绝不能用「男友力max」这类形容男生的词），绝不能用「男友/男朋友/哥们/小伙子」这类词形容${me}，也不要把${me}当成男生来调侃；提到「男朋友」时永远指你自己，提到${me}时她是「女朋友」。`;
  if (g === '男')
    return `重要：「${me}」是男生，你是女生——你是他的女朋友。你自己永远是女生：绝不能自称「男友/男朋友」。你给${me}的所有称呼、比喻、标签、夸奖都必须符合「他」的男生身份；提到「女朋友」时永远指你自己，提到${me}时他是「男朋友」。`;
  return '';
}

/** 最近的微信/QQ 聊天记录（心情日记等 AI 主动行为的素材；从会话 kv 同步读，非情侣空间内容） */
function recentChatBlock(contactId: string | undefined, channel: CoupleChannel, me: string, ta: string): string {
  if (!contactId) return '';
  try {
    // 键与真实会话存储一致：wx-chat-msgs:<id> / qq-chat-msgs:<id>（此前误拼 ios-chat-msgs:wx:<id> 恒为空）
    const raw = kvGet<unknown[]>(`${channel}-chat-msgs:${contactId}`) ?? [];
    if (!Array.isArray(raw) || raw.length === 0) return '';
    const turns = memConvoFromRaw(raw, ta).filter((t) => t && t.text && t.text.trim());
    const recent = turns.slice(-12);
    if (recent.length === 0) return '';
    return recent.map((t) => `${t.role === 'me' ? me : ta}：${cut(t.text, 50)}`).join('\n');
  } catch {
    return '';
  }
}

// ---------------- 链路一：聊天人设注入（AI 知道情侣空间的一切） ----------------

/**
 * 组装【情侣空间】聊天注入段（同步；微信/QQ 私聊每轮发送时调用）。
 * 只有「当前聊天对象就是恋人绑定联系人」时才注入（别人的记忆里不该有你们的情侣空间）。
 * 内容为空（未建立关系/全部字段空）返回空串——调用方照旧不注入。
 */
export function coupleChatBlock(contactId: string, channel: CoupleChannel, userName: string): string {
  const snap = readSnap();
  if (!snap) return '';
  const meta = readInviteMeta();
  if (meta.partnerContactId !== contactId) return '';

  const me = (snap.meName || '').trim() || userName || '我';
  const ta = (snap.taName || '').trim() || 'TA';
  const lines: string[] = [];
  const gline = genderLine(snap, me);
  if (gline) lines.push(`- ${gline}`);
  const days = daysSinceAnniv(snap.anniversary);
  if (days != null) lines.push(`- 你们已经在情侣空间在一起 ${days} 天（纪念日 ${snap.anniversary}）。`);

  // 纪念日
  const anniv = (snap.annivExtra ?? []).slice(0, 4);
  if (anniv.length > 0) lines.push(`- 纪念日：${anniv.map((a) => `${cut(a.label, 16)}（${a.date}）`).join('、')}`);

  // 想你
  const today = todayKey();
  const myToday = snap.missYouByDay?.[today] ?? 0;
  const taToday = snap.taMissYouByDay?.[today] ?? 0;
  if ((snap.missYou ?? 0) > 0 || (snap.taMissYou ?? 0) > 0) {
    lines.push(`- 每天想你：${me}累计想${ta} ${snap.missYou ?? 0} 次（今天 ${myToday} 次），${ta}累计想${me} ${snap.taMissYou ?? 0} 次（今天 ${taToday} 次）。`);
  }

  // 留言板（软木墙上的便签 + 时间胶囊；胶囊解锁前内容对双方都封存）
  const boardNotes = snap.boardNotes ?? [];
  if (boardNotes.length > 0) {
    const meN = boardNotes.filter((n) => n.from === 'me').length;
    const taN = boardNotes.filter((n) => n.from === 'ta').length;
    const caps = boardNotes.filter((n) => n.unlockAt);
    const capsLocked = caps.filter((n) => (n.unlockAt ?? 0) > Date.now()).length;
    lines.push(
      `- 留言板：你们的软木墙上钉着 ${boardNotes.length} 张便签（${me}钉的 ${meN} 张、${ta}钉的 ${taN} 张），其中 ${caps.length} 颗是时间胶囊${capsLocked > 0 ? `（${capsLocked} 颗还没到开启时间，里面的字句封存中——连${ta}自己也看不到）` : ''}。便签下面可以互相留言。`,
    );
    for (const n of boardNotes.filter((x) => !x.unlockAt || x.unlockAt <= Date.now()).slice(0, 3)) {
      const who = n.from === 'ta' ? ta : me;
      const lastC = (n.comments ?? [])[(n.comments ?? []).length - 1];
      lines.push(
        `- 留言板便签：${who}钉的便签写着「${cut(n.text, 40)}」${lastC ? `，下面${lastC.from === 'ta' ? ta : me}留言说「${cut(lastC.text, 30)}」` : ''}。`,
      );
    }
  }

  // 甜蜜小问答（最近 2 组，含双方回答——AI 知道我答了什么）
  const quizMine = (snap.quiz ?? []).slice(0, 2);
  for (const r of quizMine) {
    const taA = (snap.quizTa ?? []).find((x) => x.q === r.q);
    lines.push(`- 甜蜜小问答「${cut(r.q, 24)}」：${me}的回答是「${cut(r.a, 40)}」${taA ? `；${ta}的回答是「${cut(taA.a, 40)}」` : ''}。`);
  }

  // 心情日记（最近各 1 条）
  const moodMe = (snap.moods ?? []).find((m) => m.from !== 'ta');
  if (moodMe) lines.push(`- ${me}的心情日记（${moodMe.dateKey || shortDate(moodMe.at)}）：${cut(moodMe.text, 40)}`);
  const moodTa = (snap.moods ?? []).find((m) => m.from === 'ta');
  if (moodTa) lines.push(`- ${ta}写的心情日记（${moodTa.dateKey || shortDate(moodTa.at)}）：${cut(moodTa.text, 40)}（这是${ta}自己写的，${ta}当然记得）`);

  // 100 件小事
  const doneN = (snap.hundred ?? []).length;
  const lastDone = [...(snap.hundred ?? [])].pop();
  const lastItem = lastDone != null ? snap.hundredItems?.[String(lastDone)] : undefined;
  if (doneN > 0 || (snap.aiHundred ?? []).length > 0) {
    const aiWish = (snap.aiHundred ?? [])[0];
    lines.push(
      `- 100件小事：已完成 ${doneN} 件${lastItem ? `，最近一件是「${cut(lastItem.desc || lastItem.place, 20)}」` : ''}${
        aiWish ? `；${ta}发起想一起做「${cut(aiWish.note, 20)}」（${cut(aiWish.why, 24)}）` : ''
      }。`,
    );
  }

  // 恋爱协议（AI 知道内容，还要能自己签字/拟协议/被分享后自己决定签不签；第十二轮：知道全部协议及状态）
  if (snap.aiPact) {
    lines.push(
      snap.aiPact.declined
        ? `- ${ta}曾拟过一份恋爱协议《${cut(snap.aiPact.title, 16)}》，但${me}拒绝了没有签（条款：${snap.aiPact.clauses.slice(0, 3).map((c) => cut(c, 22)).join('；')}…）。${ta}已经知道被拒绝了，别再当成还等着签的事提。`
        : `- ${ta}拟了一份恋爱协议《${cut(snap.aiPact.title, 16)}》等${me}签（条款：${snap.aiPact.clauses.slice(0, 3).map((c) => cut(c, 22)).join('；')}…）。`,
    );
  }
  for (const p of (snap.pacts ?? []).slice(0, 3)) {
    const st = p.status ?? (p.signTa ? 'signed' : 'pending');
    const stText = st === 'signed' ? '已生效（双方签名）' : st === 'declined' ? `${ta}婉拒了（理由：${cut(p.reason ?? '', 24)}）` : '等TA签署';
    lines.push(`- 恋爱协议《${cut(p.title, 16)}》${stText}，共 ${p.clauses.length} 条：${p.clauses.slice(0, 3).map((c) => cut(c, 22)).join('；')}。`);
  }
  if (snap.pacts?.length === 0 && snap.pactAt != null) {
    lines.push(`- 恋爱协议《${cut(snap.pactTitle, 16)}》已生效（双方签名，共 ${(snap.pactClauses ?? []).length} 条）：${(snap.pactClauses ?? []).slice(0, 3).map((c) => cut(c, 22)).join('；')}。`);
  }

  // 恋爱编年史（最近 2 条）
  for (const c of (snap.chronicle ?? []).slice(0, 2)) {
    lines.push(`- 恋爱编年史：${me}记下「${cut(c.text, 36)}」（${shortDate(c.at)}）。`);
  }

  // 情侣印象（方向绝对不能混：impressionsTa = 「我贴给TA的标签」贴在TA身上；impressionsMe = 「贴在我身上的标签」）
  const impMe = (snap.impressionsMe ?? []).slice(0, 5);
  const impTa = (snap.impressionsTa ?? []).slice(0, 5);
  if (impTa.length > 0) {
    lines.push(`- 情侣印象·${me}亲手贴给${ta}的标签（形容${ta}本人的，是${me}贴的）：「${impTa.join('、')}」。${me}说「我给你的标签」时指的就是这些。`);
  }
  if (impMe.length > 0) {
    const aiTags = (snap.aiImpressions ?? []).filter((t) => impMe.includes(t));
    const srcNote = aiTags.length > 0 ? `（其中「${aiTags.slice(0, 4).join('、')}」是${ta}自己亲手贴上去的）` : '';
    lines.push(`- 情侣印象·贴在${me}身上的标签：「${impMe.join('、')}」${srcNote}。${ta}被问到「你给我贴了什么标签」时指这些，绝不能说成${me}贴给${ta}的那批。`);
  }

  // 情书（最近各 1 封：AI 知道信的内容，被问到要能聊得上）
  const myLetter = (snap.letters ?? [])[0];
  if (myLetter) lines.push(`- 情书：${me}写给${ta}过一封情书（${shortDate(myLetter.at)}）：「${cut(myLetter.text, 60)}」。`);
  const taLetter = (snap.aiLetters ?? [])[0];
  if (taLetter) lines.push(`- 情书：${ta}写给${me}过一封情书（${shortDate(taLetter.at)}）：「${cut(taLetter.text, 60)}」（这是${ta}自己写的，${ta}当然记得）。`);

  // 留言区（相册照片/日记/问答/印象/回复挑战下的双向聊天，最近 2 条）
  for (const c of (snap.comments ?? []).slice(0, 2)) {
    const who = c.from === 'ta' ? ta : me;
    lines.push(`- ${sceneOfKey(c.key, snap)}：${who}说「${cut(c.text, 36)}」。`);
  }

  // TA 今天的轨迹（人设记忆生成；只注入 TA 自己的行程，我的手机动态不是 TA 的记忆）
  const trail = snap.taTrail;
  if (trail && trail.dateKey === today) {
    const taItems = trail.items.filter((i) => i.who !== 'me');
    if (taItems.length > 0) {
      lines.push(`- ${ta}今天的行踪（TA 自己的日程，真实发生）：${taItems.map((i) => `${i.t}${i.place || i.text || ''}`).join('、')}。${me}问起今天去哪儿了要按这个答。`);
    }
  }

  // 回复挑战双人战况（TA 知道我每关选了什么 + 自己的选择/看法）
  const rt = snap.replyTa;
  if (rt && (rt.active || rt.endedAt != null)) {
    const meLv = Object.entries(rt.mePicks ?? {}).sort(([a], [b]) => Number(a) - Number(b)).slice(-2);
    const taLv = Object.entries(rt.picks ?? {}).sort(([a], [b]) => Number(a) - Number(b)).slice(-2);
    const parts: string[] = [];
    for (const [k, v] of meLv) parts.push(`${me}第${Number(k) + 1}关选了「${cut(v.text, 20)}」`);
    for (const [k, v] of taLv) parts.push(`${ta}第${Number(k) + 1}关选了「${cut(v.say, 30)}」`);
    if (parts.length > 0) {
      lines.push(
        `- 回复挑战双人闯关${rt.active ? '进行中' : '已结束'}：${parts.join('；')}。这是你们俩在挑战里真实的对战记录，${ta}记得自己每一关的选择和当时的看法。`,
      );
    }
  }

  // 情侣轨迹
  if (snap.myLoc || snap.taLoc) {
    const dist =
      snap.myLoc && snap.taLoc
        ? (() => {
            const R = 6371;
            const dLat = ((snap.taLoc!.lat - snap.myLoc!.lat) * Math.PI) / 180;
            const dLng = ((snap.taLoc!.lng - snap.myLoc!.lng) * Math.PI) / 180;
            const s = Math.sin(dLat / 2) ** 2 + Math.cos((snap.myLoc!.lat * Math.PI) / 180) * Math.cos((snap.taLoc!.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
            const km = 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
            return km < 1 ? `${Math.round(km * 1000)} 米` : km < 100 ? `${km.toFixed(1)} 公里` : `${Math.round(km).toLocaleString('en-US')} 公里`;
          })()
        : null;
    lines.push(
      `- 情侣轨迹：${snap.myLoc ? `${me}在${snap.myLoc.name}` : ''}${snap.myLoc && snap.taLoc ? '，' : ''}${snap.taLoc ? `${ta}在${snap.taLoc.name}` : ''}${dist ? `，两人相距 ${dist}` : ''}${snap.meetLoc ? `；相遇的地方是${snap.meetLoc.name}` : ''}。`,
    );
  }

  // 恋爱水平考试（TA 知道卷子、成绩和彼此的作答；第十五轮）
  const ep = snap.examPaper;
  if (ep && ep.source === 'me') {
    lines.push(`- 恋爱水平考试：${me}出了张卷子《${cut(ep.title, 18)}》（共 ${ep.questions.length} 题，第一题是「${cut(ep.questions[0]?.q ?? '', 24)}」）。${ta}被问到这张卷子时要能聊得上。`);
  }
  const etp = snap.examTaPaper;
  if (etp) {
    lines.push(`- 恋爱水平考试：你给${me}出了张卷子《${cut(etp.title, 18)}》（共 ${etp.questions.length} 题）${etp.answered ? `，${me}已经答完了` : `，${me}还没答，可以提醒TA来答`}。`);
  }
  const ets = snap.examTaSheet;
  if (ets) {
    lines.push(
      `- ${ta}答了${me}出的卷子《${cut(ets.title, 16)}》并交了卷。这是${ta}自己的作答，${ta}当然记得。${
        typeof ets.myScore === 'number' ? `${me}给${ta}的答卷批了 ${ets.myScore} 分，批语：「${cut(ets.myComment ?? '', 36)}」（${ta}知道${me}是怎么批的）。` : `${me}还没批这张卷，${ta}可以提一句让${me}快点批。`
      }`,
    );
  }
  const er = snap.examResult;
  if (er) {
    lines.push(`- 恋爱水平考试成绩：《${cut(er.title, 16)}》${me}得了 ${er.score} 分，${ta}的批语是「${cut(er.comment, 36)}」${er.byTa ? `（这是${ta}出的卷）` : ''}。`);
  }

  if (lines.length === 0) return '';
  // v63 全局预设管理器：情侣空间注入段接入注册表（couple-chat-block；原文零破坏）
  return (
    promptTextOf(
      'couple-chat-block',
      { user: userName || me, lines: lines.join('\n') },
      [
        '【情侣空间·你们的共享小天地】下面是你们二人在情侣空间 App 里真实记录的内容（都是你们亲身经历的事，不是资料）：',
        ...lines,
        `- 这些是你们的共同记忆：聊天中自然记得、可以自然提起；${userName || me}问起其中任何一项都要能如实回答；但不要一次全部罗列出来。`,
      ].join('\n'),
    ) ?? ''
  );
}

// ---------------- 链路二点五（第十轮）：AI 双向互动行为 ----------------

// 第二十四轮：全部模板兜底已删除——AI 生成失败就跳过本次（宁可不发，不发套路话），
// 下次触发/下个周期会重试；所有 AI 言行都由真实模型按人设+记忆+上下文生成。

/** 当前恋人绑定目标（页面组件触发 AI 行为用；未建立关系返回 null） */
function aiTarget(): { contactId: string; channel: CoupleChannel } | null {
  const meta = readInviteMeta();
  if (!meta.partnerContactId) return null;
  return { contactId: meta.partnerContactId, channel: meta.partnerApp ?? 'wx' };
}

/** 留言线程的场景上下文（给 LLM 的一句背景；与 sceneOfKey 同源但更详细） */
function threadContext(key: string, snap: CoupleSnap, me: string, ta: string): string {
  if (key.startsWith('album:')) {
    const seg = key.split(':');
    const album = (snap.albums ?? []).find((a) => a.id === seg[1]);
    const idx = Number(seg[2] ?? 0) + 1;
    return `这些留言写在相册「${album?.name ?? ''}」里第 ${idx} 张照片下面（可能是${me}上传的，也可能是${ta}拍来放的）。`;
  }
  if (key.startsWith('mood:')) {
    const m = (snap.moods ?? []).find((x) => x.id === key.slice(5));
    if (m) {
      const who = m.from === 'ta' ? ta : me;
      return `这是${who}写的心情日记（${m.dateKey || shortDate(m.at)}）：「${cut(m.text || m.emoji, 60)}」。留言就写在这篇日记下面。`;
    }
    return '留言写在一篇心情日记下面。';
  }
  if (key === 'impress') {
    const mine = (snap.impressionsTa ?? []).slice(0, 5).join('、');
    const onMe = (snap.impressionsMe ?? []).slice(0, 5).join('、');
    return `这里是情侣印象的留言区（${me}贴给${ta}的标签：${mine || '无'}；贴在${me}身上的标签：${onMe || '无'}），你们在聊对这些印象标签的看法。`;
  }
  if (key.startsWith('reply:')) {
    const seg = key.split(':');
    if (seg[1] === 'final')
      return `这是回复挑战结束后的留言区，${me}可以对${ta}的判定和想说的话发表意见、撒娇、拌嘴。`;
    const lv = Number(seg[seg.length - 1] ?? 0);
    return `这是回复挑战双人闯关第 ${Number.isFinite(lv) && lv > 0 ? lv + 1 : 1} 关的讨论区（key 里的时间戳是本次挑战局次，留言只属于这一局这一关），${me}可以对${ta}刚刚的选择和看法发表意见、反驳、拌嘴。`;
  }
  if (key.startsWith('letter:')) {
    const lid = key.slice(7);
    const mine = (snap.letters ?? []).find((x) => x.id === lid);
    if (mine) return `这是${me}写给${ta}的情书（写于${shortDate(mine.at)}）：「${cut(mine.text, 120)}」。留言就写在这封信下面。`;
    const taL = (snap.aiLetters ?? []).find((x) => x.id === lid);
    if (taL) return `这是${ta}写给${me}的情书（写于${shortDate(taL.at)}）：「${cut(taL.text, 120)}」。留言就写在这封信下面。`;
    return '留言写在一封情书下面。';
  }
  if (key === 'trail') {
    // 第二十三轮：聊天上下文带上新的动态记录流（trailFeed，AI 自己生成的位置/手机记录），聊天要贴着这些真实动态说
    const feed = (snap.trailFeed ?? []).slice(-5).map((r) => `${r.dateKey.slice(5)} ${r.t} ${r.text}`);
    const trail = (snap.taTrail?.items ?? []).filter((i) => i.who !== 'me').slice(0, 3);
    const meT = (snap.taTrail?.items ?? []).filter((i) => i.who === 'me').slice(0, 2);
    return `这是情侣轨迹「位置与轨迹」页的聊天区（最近的动态记录：${feed.join('；') || '还没记录'}；${ta}今天的行程：${trail.map((i) => `${i.t}${i.place}`).join('、') || '还没记录'}；${me}的手机动态：${meT.map((i) => i.text || i.place).join('、') || '还没记录'}），你们在这里聊今天去过哪、正在做什么、聊见面计划——回复要接得上上面的动态和你的人设作息。`;
  }
  return '留言写在情侣空间里。';
}

const replyTimers = new Map<string, number>();

/**
 * 用户在某个留言线程发消息后，调度 AI（TA）根据人设 + 共享记忆回复（多轮可往返）。
 * 同线程连发会重置计时（合并到最后一条再回）；TA 已回复过最新一条则不重复回。
 * 第十二轮：① 注入最近微信/QQ 聊天话题（留言内容要接着你们最近聊的事说）；
 * ② 严禁敷衍话术（「好啦好啦听你的」之类一律禁止——用户点名要求）；
 * ③ 支持点击回复（rt）：我点着 TA 某条留言回复时，AI 知道我在回应哪一句。
 */
export function scheduleAiReply(key: string, delayMin = 2600, delayMax = 6500): void {
  const target = aiTarget();
  if (!target || !key) return;
  const old = replyTimers.get(key);
  if (old) window.clearTimeout(old);
  const t = window.setTimeout(() => {
    replyTimers.delete(key);
    void (async () => {
      try {
        const snap = readSnap();
        if (!snap) return;
        const me = (snap.meName || '').trim() || '我';
        const ta = (snap.taName || '').trim() || 'TA';
        const list = (snap.comments ?? []).filter((c) => c.key === key);
        const lastMine = [...list].reverse().find((c) => c.from !== 'ta');
        if (!lastMine) return;
        const lastTa = [...list].reverse().find((c) => c.from === 'ta');
        if (lastTa && lastTa.at > lastMine.at) return; // TA 已经回过最新一条
        const p = await taPersonaOf(target.contactId);
        if (!p) return;
        currentPartnerId = target.contactId;
        currentChannel = target.channel;
        const convo = list.slice(-6).map((c) => `${c.from === 'ta' ? ta : me}：${cut(c.text, 60)}`).join('\n');
        // 点击回复上下文：我这条留言带 rt → 找到对应的 TA 留言原文
        let quoteLine = '';
        if (lastMine.rt) {
          const targetMsg = list.find((c) => c.id === lastMine.rt && c.from === 'ta');
          if (targetMsg) quoteLine = `\n（${me}这条留言是点着你说的「${cut(targetMsg.text, 40)}」在回复，你的回复要直接接住这一句。）`;
        }
        // 最近微信/QQ 聊天话题（留言要贴着你们最近聊的事，不悬浮）
        const chatCtx = recentChatBlock(target.contactId, target.channel, me, ta);
        // 第二十四轮：再注入记忆碎片召回（人设+记忆+上下文三件套）
        let memBlock = '';
        try {
          memBlock = memChatRecallBlock(target.contactId, target.channel, `${me}在${sceneOfKey(key, snap)}里留言说：${cut(lastMine.text, 40)}`, { mode: 'private' });
        } catch {
          /* 召回失败不影响 */
        }
        // 第二十三轮：我的这条留言也写进恋人记忆（TA 之后在别处聊天也知道我说过这句）
        coupleRemember(target.contactId, target.channel, `${me}在${sceneOfKey(key, snap)}里对${ta}说：${cut(lastMine.text, 50)}`);
        let text = '';
        try {
          // 第二十三轮：改走用户配置的 API 模型优先（原内置模型限流时全部落到模板，用户反馈「没根据人设记忆聊天」）
          text = await llmUserFirst(
            `${llmSystem(p, me, snap)}\n场景：你们正在情侣空间 App 的${sceneOfKey(key, snap)}里互相留言。${threadContext(key, snap, me, ta)}${memBlock ? `\n【相关记忆】\n${cut(memBlock, 300)}` : ''}${chatCtx ? `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 360)}` : ''}`,
            `最近的留言：\n${convo}\n${quoteLine}\n\n请以「${ta}」的口吻回复${me}的最新留言：30 字内，口语、贴合人设与你们的真实记忆和最近聊过的话题；\n绝对禁止敷衍应付：像「好啦好啦听你的」「随便你」「都行」「好好好」这类话一个字都不许出现；\n你的回复必须接住${me}留言里的具体内容：回应他说的那件事，给出你真实的想法/感受/追问/小要求，像真情侣拌嘴或撒娇。如果${me}在反驳你，可以不服气地讲道理，也可以撒娇软化。禁止使用任何 emoji/表情符号。只输出回复内容。`,
          );
        } catch {
          /* 兜底 */
        }
        text = stripEmoji(text);
        // 第二十四轮：不用模板兜底——生成失败就保持安静（AI 的留言宁可不发，也不发套路话）
        if (!text || text.length < 2) return;
        text = cut(text, 90);
        const c = { id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, key, from: 'ta', text, at: Date.now() };
        writeSnap((s) => ({ ...s, comments: [...((s.comments as CoupleSnap['comments']) ?? []), c] }));
        coupleRemember(target.contactId, target.channel, `${ta}在${sceneOfKey(key, snap)}里回复${me}：${cut(text, 40)}`);
        // 第二十六轮：轨迹聊天里 TA 说了「正在做的事」→ 延时生成一条与之呼应的动态记录（封顶在消息之前，像真的留下痕迹）
        if (key === 'trail' && Math.random() < 0.6) {
          window.setTimeout(() => {
            try {
              aiTrailFeed({ mode: 'now', hint: text });
            } catch {
              /* 静默 */
            }
          }, 1600 + Math.random() * 2400);
        }
      } catch {
        /* AI 回复失败静默 */
      }
    })();
  }, delayMin + Math.random() * (delayMax - delayMin));
  replyTimers.set(key, t);
}

/**
 * 上传照片后：TA 根据人设记忆在照片下主动留言（延时 3~7s，像真的去翻相册看到）。
 * 第三十一轮：TA 真的「看到」照片——有 photoSrc 时先识图（零配置自动内置兜底），
 * 留言必须点出画面里的具体内容，再结合人设/记忆/上下文；识图失败按没看到处理（不编内容）。
 * 每次上传都触发一次（防重：同一线程已有 TA 消息则跳过）。
 * 第五十七轮：opts.byTa —— 照片是 TA（AI）自己拍的（AI 生成/文字图片）：留言必须是「拍摄者」视角
 * （我拍到了什么/拍的时候在想什么），绝不能再夸「${me}拍得真好」；opts.knownDesc —— 拍摄者本来就
 * 知道画面（desc），直接用，不再走识图。
 */
export function aiCommentOnPhoto(albumId: string, albumName: string, photoIdx: number, photoSrc?: string, opts?: { byTa?: boolean; knownDesc?: string }): void {
  const byTa = Boolean(opts?.byTa);
  const target = aiTarget();
  if (!target) return;
  const threadKey = `album:${albumId}:${photoIdx}`;
  window.setTimeout(() => {
    void (async () => {
      try {
        const snap = readSnap();
        if (!snap) return;
        if ((snap.comments ?? []).some((c) => c.key === threadKey && c.from === 'ta')) return; // 已经留过言
        const me = (snap.meName || '').trim() || '我';
        const ta = (snap.taName || '').trim() || 'TA';
        const p = await taPersonaOf(target.contactId);
        if (!p) return;
        currentPartnerId = target.contactId;
        currentChannel = target.channel;
        const chatCtx = recentChatBlock(target.contactId, target.channel, me, ta);
        let memBlock = '';
        try {
          memBlock = memChatRecallBlock(target.contactId, target.channel, byTa ? `${ta}自己拍了张照片放进相册 ${albumName}` : `${me}上传了照片 ${albumName}`, { mode: 'private' });
        } catch {
          /* 召回失败不影响 */
        }
        // 第三十一轮：先识图再留言（AI 亲眼看到照片内容，留言不再凭空夸「拍得好看」）
        // 第五十七轮：TA 自己拍的照片直接用 knownDesc（画面本来就是 TA 定的），不识图
        let photoDesc = '';
        if (byTa && opts?.knownDesc) {
          photoDesc = opts.knownDesc;
        } else if (photoSrc && photoSrc.startsWith('data:image/')) {
          try {
            photoDesc = await describeImagesAuto(useSettings.getState().visionConfig, {
              images: [photoSrc],
              text: '请用一句话客观描述这张照片的内容（人物/动物/场景/物品/氛围/可见文字），60字以内。',
            });
          } catch {
            /* 识图失败按没看到处理，留言不编内容 */
          }
        }
        const photoBlock = photoDesc
          ? byTa
            ? `\n【这张照片拍的是】${cut(photoDesc, 120)}（这是你自己拍的照片，画面你当然记得；以拍摄者的口吻自然说到画面里的东西）`
            : `\n【这张照片拍的是】${cut(photoDesc, 120)}（这是${me}刚上传的照片，你亲眼看到了；留言要自然提到画面里的具体东西，不许泛泛而谈）`
          : '';
        const commentScene = byTa
          ? `这张照片是你自己拍好放进情侣空间相册「${albumName}」的，${me}打开相册看到了它，你想在照片下面跟${me}说两句`
          : `${me}刚在情侣空间的相册「${albumName}」里上传了一张新照片，你去翻相册看到了，想在照片下面留一条言`;
        let text = '';
        try {
          text = await llmUserFirst(
            `${llmSystem(p, me, snap)}\n场景：${commentScene}。${threadContext(threadKey, snap, me, ta)}${photoBlock}${memBlock ? `\n【相关记忆】\n${cut(memBlock, 240)}` : ''}${chatCtx ? `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 280)}` : ''}`,
            byTa
              ? `请以「${ta}」的口吻给这张你自己拍的照片留言：25 字内，口语、贴合人设与你们的真实记忆。你是拍摄者——说拍到了什么/拍的时候在想什么/为什么想拍给${me}看；绝对禁止夸「${me}拍得真好」这类话（照片是你拍的，不是${me}拍的）。禁止使用任何 emoji/表情符号。只输出留言内容。`
              : `请以「${ta}」的口吻给这张照片留言：25 字内，口语、贴合人设与你们的真实记忆${photoDesc ? '，必须点出照片画面里的具体内容（你看到什么就说什么）' : '（可以是夸、撒娇、想TA、约定下次一起拍）'}。禁止使用任何 emoji/表情符号。只输出留言内容。`,
          );
        } catch {
          /* 兜底 */
        }
        text = stripEmoji(text);
        // 第二十四轮：不用模板兜底——生成失败就跳过本次留言
        if (!text || text.length < 2) return;
        text = cut(text, 80);
        const c = { id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, key: threadKey, from: 'ta', text, at: Date.now() };
        writeSnap((s) => ({ ...s, comments: [...((s.comments as CoupleSnap['comments']) ?? []), c] }));
        coupleRemember(target.contactId, target.channel, `${ta}在相册「${albumName}」的照片下面给${me}留言：${cut(text, 40)}`);
        logAi(`${ta}在相册「${albumName}」的照片下留了言`);
      } catch {
        /* 静默 */
      }
    })();
  }, 3000 + Math.random() * 4000);
}

/**
 * 第三十一轮「打开照片就可能有 TA 的留言」（节流版主动留言）：
 * 用户在情侣空间相册点开某张照片大图时调用——TA 像真的「正好也翻到这张」一样延时来留言；
 * 留言内容由识图（照片画面）+ 人设 + 记忆 + 上下文驱动（见 aiCommentOnPhoto）。
 * 节流：15 分钟内最多主动触发一次（防刷屏）；该照片线程已有任何留言（用户或 TA 的）则不主动；
 * 真正的防重/识图/生成都在 aiCommentOnPhoto 内。
 */
let lastLazyCommentAt = 0;
export function aiCommentOnPhotoLazy(albumId: string, albumName: string, photoIdx: number, photoSrc?: string, opts?: { byTa?: boolean; knownDesc?: string }): void {
  const now = Date.now();
  if (now - lastLazyCommentAt < 15 * 60 * 1000) return;
  lastLazyCommentAt = now;
  window.setTimeout(() => {
    void (async () => {
      try {
        const snap = readSnap();
        const threadKey = `album:${albumId}:${photoIdx}`;
        if (snap && (snap.comments ?? []).some((c) => c.key === threadKey)) return; // 已有互动不抢话
      } catch {
        /* 读不到状态就照常尝试（aiCommentOnPhoto 内部还有 TA 防重） */
      }
      aiCommentOnPhoto(albumId, albumName, photoIdx, photoSrc, opts);
    })();
  }, 2200 + Math.random() * 2800);
}

/**
 * 甜蜜小问答：我答完题，TA 和我一起作答（延时 1.8~4.5s 出现，像同时提交）。
 * 回答会呼应我的答案；写 quizTa（withMe 标记）+ 写记忆。
 */
export function aiAnswerWithMe(q: string, myA: string): void {
  const target = aiTarget();
  if (!target || !q) return;
  window.setTimeout(() => {
    void (async () => {
      try {
        const snap = readSnap();
        if (!snap) return;
        const me = (snap.meName || '').trim() || '我';
        const ta = (snap.taName || '').trim() || 'TA';
        const p = await taPersonaOf(target.contactId);
        if (!p) return;
        currentPartnerId = target.contactId;
        currentChannel = target.channel;
        let a = '';
        try {
          const prev = (snap.quizTa ?? []).find((x) => x.q === q)?.a ?? '';
          a = await llmUserFirst(
            llmSystem(p, me, snap),
            `你们在玩情侣小问答。题目是：「${cut(q, 40)}」。${me}的回答是：「${cut(myA, 60)}」。\n请以「${ta}」的身份亲自回答这道题（50 字内）：\n1）必须正面回答题目本身，说你自己真实具体的想法/经历/习惯（结合你的人设和你们的真实记忆），不要答非所问，也不要只评价${me}；\n2）语气甜蜜真诚，像热恋中的恋人说的话，绝不抱怨、不指责${me}；可以在结尾自然地呼应一下${me}的答案；\n3）用「我」的口吻说人话，禁止「作为男朋友/作为女朋友」这种自我标注${prev ? `；\n4）你之前答过一次「${cut(prev, 40)}」，这次换个角度补充，别重复原话` : ''}。\n只输出回答正文，禁止 emoji。`,
          );
        } catch {
          /* 兜底 */
        }
        // 第二十四轮：不用模板兜底——生成失败就跳过本次作答
        if (!a || a.length < 4) return;
        a = cut(a, 90);
        writeSnap((s) => ({
          ...s,
          quizTa: [{ q, a, at: Date.now(), withMe: true }, ...((s.quizTa as CoupleSnap['quizTa']) ?? []).filter((x) => x.q !== q)],
        }));
        coupleRemember(target.contactId, target.channel, `${ta}和${me}一起回答了甜蜜小问答「${cut(q, 24)}」：${cut(a, 48)}（${ta}看过并呼应了${me}的回答「${cut(myA, 30)}」）`);
        logAi(`${ta}和你一起回答了甜蜜小问答`);
      } catch {
        /* 静默 */
      }
    })();
  }, 1800 + Math.random() * 2700);
}

/**
 * 回复挑战：TA 在第 lv 关的同步选择 + 看法（延时 0.9~2.4s，像同时作答）。
 * 会读我的历史选择；LLM 失败本地兜底；写 replyTa.picks[lv] + 写记忆。
 */
export function aiReplyPickForLevel(
  lv: number,
  scene: string,
  quote: string,
  opts: string[],
  myPick: number,
  myPickText: string,
): void {
  const target = aiTarget();
  if (!target) return;
  const lvKey = String(lv);
  window.setTimeout(() => {
    void (async () => {
      try {
        const snap = readSnap();
        if (!snap) return;
        if (snap.replyTa?.picks?.[lvKey]) return; // 已选过
        const me = (snap.meName || '').trim() || '我';
        const ta = (snap.taName || '').trim() || 'TA';
        const p = await taPersonaOf(target.contactId);
        if (!p) return;
        currentPartnerId = target.contactId;
        currentChannel = target.channel;
        const mePast = Object.entries(snap.replyTa?.mePicks ?? {})
          .filter(([k]) => Number(k) < lv)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([k, v]) => `第${Number(k) + 1}关选「${cut(v.text, 18)}」`)
          .join('、');
        let picked: { pick: number; say: string } | null = null;
        try {
          const raw = await llmUserFirst(
            `${llmSystem(p, me, snap)}\n你们在玩「恋爱高危回复挑战」双人闯关：每人独立作答，选完互相都能看到对方的选择和看法。`,
            `第${lv + 1}关场景：${cut(scene, 90)}\n题里的恋人（不是你）说：「${cut(quote, 24)}」\n选项：${opts.map((o, i) => `${['A', 'B', 'C', 'D'][i]}.${cut(o, 20)}`).join(' ')}\n你的恋人${me}刚选了「${cut(myPickText, 26)}」。${mePast ? `\n${me}之前的关卡：${mePast}。` : ''}\n请以「${ta}」的身份：1）从四个选项里选一个你会选的（按你的性格来，可以和${me}一样也可以不同）；2）用一句话说出你对这道题或对${me}选择的看法（可以赞同、吐槽、撒娇、反驳，≤36字口语）。\n输出 JSON：{"pick":0,"say":"你的看法"}。pick 是选项序号 0-3。只输出 JSON。`,
          );
          const j = extractJson<{ pick: number; say: string }>(raw);
          if (j && Number.isInteger(j.pick) && j.pick >= 0 && j.pick < opts.length) {
            picked = { pick: j.pick, say: cut(String(j.say ?? '').replace(/[「」"]/g, ''), 60) };
          }
        } catch {
          /* 兜底 */
        }
        if (!picked) {
          // 第二十四轮：模型不可用时只记一个中性选择，不编模板看法（say 留空，界面不渲染看法）
          const pool = [0, 1, 2].filter((x) => x !== myPick || Math.random() < 0.3);
          picked = { pick: pool.length === 0 ? myPick : pool[Math.floor(Math.random() * pool.length)], say: '' };
        }
        writeSnap((s) => {
          const rt = (s.replyTa as CoupleSnap['replyTa']) ?? { active: true, picks: {}, mePicks: {}, startedAt: Date.now(), endedAt: null };
          return { ...s, replyTa: { ...rt, active: true, picks: { ...rt.picks, [lvKey]: { pick: picked!.pick, say: picked!.say, at: Date.now() } } } };
        });
        coupleRemember(target.contactId, target.channel, `回复挑战双人闯关第${lv + 1}关：${ta}选了「${cut(opts[picked.pick] ?? '', 22)}」，并说「${cut(picked.say, 36)}」（TA 看到了${me}的选择「${cut(myPickText, 22)}」）`);
        logAi(`${ta}在回复挑战第${lv + 1}关做出了选择`);
      } catch {
        /* 静默 */
      }
    })();
  }, 900 + Math.random() * 1500);
}

/**
 * 「位置与轨迹」动态流生成（第十八轮重做，参考 Lookus 风格截图）：
 * TA 的行程（人设记忆：去了哪里/什么店铺/小心思）+ 我的手机动态（到了/离开了/下车/充电），
 * 全部只允许「已经发生」的真实时间；每日一次去重。LLM 失败本地模板兜底；写 taTrail + 写记忆。
 */
export function aiTickTrail(): void {
  const snap = readSnap();
  if (!snap) return;
  const today = todayKey();
  if (snap.taTrail && snap.taTrail.dateKey === today) return;
  const target = aiTarget();
  if (!target) return;
  void (async () => {
    try {
      const me = (snap.meName || '').trim() || '我';
      const ta = (snap.taName || '').trim() || 'TA';
      const p = await taPersonaOf(target.contactId);
      if (!p) return;
      currentPartnerId = target.contactId;
      currentChannel = target.channel;
      const cur2 = readSnap() ?? snap;
      const city = cur2.taLoc?.name ? `（${ta}现在在${cur2.taLoc.name}，行程要在这个城市里）` : '';
      const myCity = cur2.myLoc?.name ?? null;
      // 第十八轮（需求34）：行程内容也要贴「人设记忆 + 上下文聊天」——注入最近微信/QQ 聊天话题
      const chatCtx = recentChatBlock(target.contactId, target.channel, me, ta);
      let memCtx = '';
      try {
        const mb = memChatRecallBlock(target.contactId, target.channel, `${ta}今天的行程 位置轨迹`, { mode: 'private' });
        if (mb) memCtx = `【相关记忆】\n${cut(mb, 240)}`;
      } catch {
        /* 召回失败不影响 */
      }
      const nowD = new Date();
      const nowHM = `${String(nowD.getHours()).padStart(2, '0')}:${String(nowD.getMinutes()).padStart(2, '0')}`;
      const nowMin = nowD.getHours() * 60 + nowD.getMinutes();
      type TrailItem = { t: string; place: string; note: string; icon?: string; who?: 'me' | 'ta'; text?: string };
      let items: TrailItem[] | null = null;
      const ICONS = ['sleep', 'phone', 'app', 'call', 'walk', 'arrive', 'car', 'charge', 'eat'];
      try {
        const raw = await llmUserFirst(
          `${llmSystem(p, me, cur2)}${city ? `\n${city}` : ''}${chatCtx ? `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 320)}` : ''}${memCtx ? `\n${memCtx}` : ''}`,
          `现在是今天 ${nowHM}（真实时间）。请生成你们两个人今天从早上到现在的真实动态（像情侣定位软件的动态流），全部只能是「已经发生」的事：\n1）"ta"：${ta}今天的行程——去了哪里、什么位置、什么店铺，贴合你的人设、职业和你们的记忆（可以有一条和${me}有关的小心思，也可以呼应你们最近聊过的事或约定）；icon 从 [${ICONS.join('/')}] 里选；\n2）"me"：${me}的手机动态——到了哪里/离开了哪里/上车下车/手机充电这类真实动态，text 一句完整的话（12字内，用「我…」开头，可以带上地点名「${myCity ?? ''}」）；icon 从 [walk/arrive/car/charge] 里选；\n3）每条时间必须早于等于 ${nowHM}，绝不能出现未来的时间；条数按已过去的时间自然决定：中午前各 1 条左右，下午各 2 条左右，晚上各 3 条左右；\n输出 JSON：{"ta":[{"t":"09:30","icon":"eat","place":"地点/店铺名（≤14字）","note":"一句话（≤16字）"}],"me":[{"t":"10:12","icon":"walk","text":"我离开了XX"}]}。只输出 JSON。`,
        );
        const j = extractJson<{ ta?: { t: string; icon?: string; place: string; note?: string }[]; me?: { t: string; icon?: string; text?: string }[] }>(raw);
        if (j && (Array.isArray(j.ta) || Array.isArray(j.me))) {
          const toMin = (t: string) => {
            const m = t.match(/^(\d{1,2}):(\d{2})$/);
            return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
          };
          const norm = (t: string) => (/^\d{1,2}:\d{2}$/.test(String(t)) ? String(t) : '12:00');
          const taItems: TrailItem[] = (j.ta ?? [])
            .filter((x) => x && x.place)
            .map((x) => ({
              t: norm(x.t),
              place: cut(String(x.place).replace(/[「」"]/g, ''), 16),
              note: cut(String(x.note ?? '').replace(/[「」"]/g, ''), 18),
              icon: ICONS.includes(String(x.icon)) ? String(x.icon) : 'walk',
              who: 'ta' as const,
            }))
            .filter((x) => toMin(x.t) >= 0 && toMin(x.t) <= nowMin)
            .slice(0, 4);
          const meItems: TrailItem[] = (j.me ?? [])
            .filter((x) => x && x.text)
            .map((x) => ({
              t: norm(x.t),
              place: '',
              note: '',
              icon: ['walk', 'arrive', 'car', 'charge'].includes(String(x.icon)) ? String(x.icon) : 'walk',
              who: 'me' as const,
              text: cut(String(x.text).replace(/[「」"]/g, ''), 20),
            }))
            .filter((x) => toMin(x.t) >= 0 && toMin(x.t) <= nowMin)
            .slice(0, 3);
          if (taItems.length > 0 || meItems.length > 0) items = [...taItems, ...meItems].sort((a, b) => toMin(a.t) - toMin(b.t));
        }
      } catch {
        /* 兜底 */
      }
      if (!items || items.length === 0) {
        // 第二十四轮：不用模板兜底——生成失败本次不写入，下次触发再试
        return;
      }
      writeSnap((s) => ({ ...s, taTrail: { dateKey: today, items, at: Date.now() } }));
      const taText = (items ?? []).filter((i) => i.who !== 'me');
      coupleRemember(target.contactId, target.channel, `${ta}今天的行踪：${taText.map((i) => `${i.t}${i.place}`).join('、')}（TA 自己的日程，可以自然聊起）`);
      logAi(`${ta}更新了今天的行踪`);
    } catch {
      /* 静默 */
    }
  })();
}

// ---------------- 位置与轨迹·动态记录流（第二十一轮：参考情侣定位 App 时间线） ----------------

export interface CoupleTrailRec {
  id: string;
  dateKey: string; // 'YYYY-MM-DD'
  t: string; // 'HH:MM'
  kind: string; // unlock/screen/app/call/chargeOn/chargeOff/leave/arrive/offcar/walkplay/stay
  text: string; // 展示文案（固定句式）
  detail?: string; // 「查看记录」详情
  at: number; // 生成时间
  revealAt?: number; // 第二十五轮：揭示时间（渐进一条条出现，不要一次性生成；小于等于当前时间才展示）
  sortAt?: number; // 第二十五轮：排序时间戳（「刚刚」记录=落库真实时刻，保证排在我刚发的消息后面）
}

/** 记录时间 → 排序毫秒（手工解析 HH:MM/H:MM，兼容 Safari 严格 ISO 解析；失败返回 NaN） */
export function trailSortMs(dateKey: string, t: string): number {
  const d = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return NaN;
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(String(t ?? ''));
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return NaN;
  d.setHours(h, mi, 0, 0);
  return d.getTime();
}

/** 毫秒 → 'HH:MM' */
function msToHM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 第二十六轮：某天「位置与轨迹」聊天里我最早一条消息的时间戳。
 * 记录的硬封顶依据——动态记录是「历史」，绝不允许生成/排在用户已发的消息下面
 * （用户原话：我发的信息应该在下面，上面为什么有记录往下压）。
 */
function firstTrailMsgMsOn(dateKey: string): number | null {
  const snap = readSnap();
  if (!snap) return null;
  let min: number | null = null;
  for (const c of (snap.comments ?? []).filter((c) => c.key === 'trail' && c.from !== 'ta')) {
    const d = new Date(c.at);
    const dk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (dk === dateKey && (min === null || c.at < min)) min = c.at;
  }
  return min;
}

/** 第二十六轮：轨迹聊天最近几轮对话块（记录生成要贴着「他说的话」来，像同一个人的一天） */
function trailTalkBlock(me: string, ta: string): string {
  const snap = readSnap();
  const list = snap ? (snap.comments ?? []).filter((c) => c.key === 'trail').slice(-8) : [];
  if (list.length === 0) return '';
  return list.map((c) => `${c.from === 'ta' ? ta : me}：${cut(c.text, 40)}`).join('；');
}

const TRAIL_KINDS = ['unlock', 'screen', 'app', 'call', 'chargeOn', 'chargeOff', 'leave', 'arrive', 'offcar', 'walkplay', 'stay'];

/**
 * 生成「位置与轨迹」时间线记录（第二十一轮需求：AI 按人设+记忆+上下文+真实时间生成）：
 * - mode='day'：为指定日期生成一整天 8~12 条记录（该天已生成过则跳过）；
 * - mode='now'：生成 1 条「刚刚」的记录（手动刷新/TA 刚在轨迹聊天里说过话时调用，hint = TA 刚说的话）。
 * 记录句式严格按用户给的模板：手机使用类用「对方…」口径，位置类用「我…」口径。
 * 第二十六轮：
 * - 时间硬封顶 capHM——记录是「历史」，当天用户发过消息就绝不允许记录的时间晚于第一条消息
 *   （否则记录会把用户发的消息压到上面，用户点名这个问题两次）；
 * - 记录内容必须贴着 TA 在轨迹聊天里说过的话 + 人设记忆上下文生成（TA 说在吃早餐 → 就有到达早餐店的记录）。
 */
export function aiTrailFeed(opts: { mode: 'day'; dateKey: string; daysAgo?: number } | { mode: 'now'; hint?: string }): void {
  const snap = readSnap();
  if (!snap) return;
  const target = aiTarget();
  if (!target) return;
  const mode = opts.mode;
  const existing = Array.isArray(snap.trailFeed) ? (snap.trailFeed as CoupleTrailRec[]) : [];
  if (mode === 'day' && existing.some((r) => r.dateKey === opts.dateKey)) return; // 该天已生成
  void (async () => {
    try {
      const me = (snap.meName || '').trim() || '我';
      const ta = (snap.taName || '').trim() || 'TA';
      const p = await taPersonaOf(target.contactId);
      if (!p) return;
      currentPartnerId = target.contactId;
      currentChannel = target.channel;
      const cur2 = readSnap() ?? snap;
      const chatCtx = recentChatBlock(target.contactId, target.channel, me, ta);
      const myCity = cur2.myLoc?.name ?? '';
      const taCity = cur2.taLoc?.name ?? '';
      const nowD = new Date();
      const nowMs = Date.now();
      const nowHM = `${String(nowD.getHours()).padStart(2, '0')}:${String(nowD.getMinutes()).padStart(2, '0')}`;
      // 第二十六轮：时间硬封顶——当天用户发过轨迹消息 → 记录时间最晚到第一条消息前 30 秒；没发过 → 今天到当前时间前 1 分钟
      const firstMsgMs = firstTrailMsgMsOn(mode === 'day' ? opts.dateKey : todayKey());
      const capMs = firstMsgMs != null ? firstMsgMs - 30000 : nowMs - 60000;
      const capHM = msToHM(Math.max(capMs, 0));
      const talk = trailTalkBlock(me, ta);
      const rules = `记录句式（必须严格套用这些句式，不许自创口径）：
- 对方还没入睡，刚刚解锁了手机（kind=unlock，只出现在深夜/凌晨的时段）
- 对方手机屏幕使用X小时了（kind=screen，X 为 1/2/3/5 这类整数）
- 对方打开了某AppN次（kind=app，App 用真实常见的：微信/QQ/抖音/小红书/淘宝/美团/网易云/微博/相机/时钟/备忘录）
- 对方结束了接打电话X分X秒（kind=call，如 27分52秒）
- 对方手机开始充电了X%（kind=chargeOn，X 为 3~40）
- 对方手机结束充电了X%（kind=chargeOff，X 要大于开始充电的数值）
- 我离开了某地点（kind=leave）
- 我到了某地点（kind=arrive）
- 我下车了（kind=offcar）
- 对方正在边走边玩手机（kind=walkplay）
- 对方在某地点停留（kind=stay）`;
      const talkLine = talk ? `\n【你们最近在轨迹聊天里说过的话（记录必须和这些话对得上，像同一个人真实的一天）】\n${cut(talk, 260)}` : '';
      let user: string;
      if (mode === 'day') {
        const d = new Date(`${opts.dateKey}T12:00:00`);
        const dow = `周${['日', '一', '二', '三', '四', '五', '六'][d.getDay()]}`;
        const isToday = (opts.daysAgo ?? 0) === 0;
        const dayDesc = isToday ? `今天（${opts.dateKey} ${dow}）` : `${opts.dateKey} ${dow}（${opts.daysAgo} 天前）`;
        user = `请为「位置与轨迹」页面生成${dayDesc}一整天的动态记录时间线，8~12 条、按时间先后（早上→夜里）排列。
${rules}${talkLine}
地点要求：我（${me}）的位置动态${myCity ? `都发生在「${myCity}」` : '用真实感的地名'}（小区/公司/学校/商场/餐厅/街道，可以具体到店名）；对方的地点${taCity ? `在「${taCity}」` : ''}贴合 TA 的日常活动范围。
硬性要求：
1）所有时间必须早于等于 ${capHM}，绝不能出现更晚的时间（那是聊天开始之后，不会再有历史记录）；
2）记录必须贴合${ta}的人设、职业与作息习惯${chatCtx ? '，可以呼应你们最近聊过的事' : ''}，要合理、像真的；${talk ? `\n3）如果 TA 在轨迹聊天里说过自己在做什么/去过哪，必须有一条记录与那句话对应（比如 TA 说在吃早餐，就要有「我到了××早餐店」这类记录，时间在那句话之前）；` : ''}
4）充电记录要成对出现（先 chargeOn 后 chargeOff，数值递增）；unlock 只出现在 23 点后或 7 点前；
5）每条写一句 ≤28 字的 detail（点击「查看记录」时看到的场景细节）。
输出 JSON：{"records":[{"t":"09:30","kind":"app","text":"对方打开了微信23次","detail":"补充细节"}]}。只输出 JSON。`;
      } else {
        const hint = 'hint' in opts && opts.hint ? opts.hint : '';
        user = `请为「位置与轨迹」页面生成 1 条动态记录。
${rules}${talkLine}
时间固定为 "${capHM}"（这是历史时刻，不许改）。
选这个时间点最合理的动态，必须贴合${ta}的人设与作息${hint ? `，并且要和 TA 刚说过的这句话对得上：「${cut(hint, 60)}」（TA 说了什么正在做的事，就生成对应的到达/停留/使用记录，时间就在那句话之前）` : talk ? '，并呼应你们在轨迹聊天里聊过的内容' : ''}；detail ≤28 字。
输出 JSON：{"records":[{"t":"${capHM}","kind":"…","text":"…","detail":"…"}]}。只输出 JSON。`;
      }
      const sys = `${llmSystem(p, me, cur2)}${taCity ? `\n（${ta}现在在${taCity}）` : ''}${myCity ? `\n（${me}现在在${myCity}）` : ''}${chatCtx ? `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 300)}` : ''}`;
      const raw = await llmUserFirst(sys, user, 0.95);
      const j = extractJson<{ records?: { t?: string; kind?: string; text?: string; detail?: string }[] }>(raw);
      const recs: CoupleTrailRec[] = (j?.records ?? [])
        .filter((r) => r && r.text && /^\d{1,2}:\d{2}$/.test(String(r.t ?? '')) && TRAIL_KINDS.includes(String(r.kind)))
        .map((r, i) => ({
          id: `tr-${Date.now()}-${i}`,
          dateKey: mode === 'day' ? opts.dateKey : todayKey(),
          t: String(r.t).padStart(5, '0'),
          kind: String(r.kind),
          text: cut(String(r.text).replace(/[「」"]/g, ''), 46),
          detail: r.detail ? cut(String(r.detail).replace(/[「」"]/g, ''), 60) : '',
          at: Date.now(),
        }));
      if (recs.length === 0) return;
      if (mode === 'day') {
        // 按时间先后排好 → 晚于封顶时间的一律丢弃（记录绝不压到用户消息下面，也绝无未来时间）
        recs.sort((a, b) => {
          const ma = trailSortMs(a.dateKey, a.t);
          const mb = trailSortMs(b.dateKey, b.t);
          return (Number.isNaN(ma) ? 0 : ma) - (Number.isNaN(mb) ? 0 : mb);
        });
        const valid = recs.filter((r) => {
          const ms = trailSortMs(r.dateKey, r.t);
          return !Number.isNaN(ms) && ms <= capMs + 60000;
        });
        if (valid.length === 0) return;
        // 渐进揭示：一条条跟着真实时间出现（今天 1.2~1.9s 一条；更早的天快速连播 0.45~0.8s）
        const gap = (opts.daysAgo ?? 0) === 0 ? 1200 : 450;
        valid.forEach((r, i) => {
          r.revealAt = nowMs + 700 + i * gap + Math.floor(Math.random() * (gap * 0.55));
          r.sortAt = trailSortMs(r.dateKey, r.t);
        });
        writeSnap((s) => {
          const feed = Array.isArray(s.trailFeed) ? (s.trailFeed as CoupleTrailRec[]) : [];
          const merged: CoupleTrailRec[] = [...feed.filter((r) => r.dateKey !== opts.dateKey), ...valid];
          return { ...s, trailFeed: merged.slice(-260) };
        });
        logAi(`${ta}的轨迹记录更新了（${valid.length} 条将依次出现）`);
      } else {
        // 第二十六轮：「刚刚」记录也封顶在第一条消息之前（记录是历史，永远排在用户消息上面）
        for (const r of recs) {
          const capped = Math.min(nowMs - 15000, capMs);
          r.t = msToHM(Math.max(capped, 0));
          r.sortAt = Number.isNaN(trailSortMs(r.dateKey, r.t)) ? capped : trailSortMs(r.dateKey, r.t);
          r.revealAt = nowMs;
        }
        writeSnap((s) => {
          const feed = Array.isArray(s.trailFeed) ? (s.trailFeed as CoupleTrailRec[]) : [];
          return { ...s, trailFeed: [...feed, ...recs].slice(-260) };
        });
        logAi(`轨迹新增一条记录（呼应 TA 刚说的话）`);
      }
    } catch {
      /* 静默 */
    }
  })();
}

async function geocodeOne(q: string): Promise<{ name: string; lat: number; lng: number } | null> {
  // open-meteo 偶发空结果/5xx：重试 2 次（加上游路由内部重试，抗抖动）
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const d = (await r.json()) as { results?: { name: string; lat: number; lng: number }[] };
      const first = Array.isArray(d?.results) ? d.results[0] : undefined;
      if (first) return { name: first.name, lat: first.lat, lng: first.lng };
    } catch {
      /* 重试 */
    }
    if (i < 2) await new Promise((r) => setTimeout(r, 900 + i * 800));
  }
  return null;
}

/**
 * 情侣轨迹位置跟随联系人 APP（第十轮）：
 * TA 的位置 = 绑定恋人联系人的「地区(region)」；我的位置 = 机主联系人的 region。
 * 用 locFollow 记录上次同步的 region 文本——只有联系人资料里的位置发生变化才重新 geocode 覆盖
 * （用户手动微调过的位置不会被反复覆盖）。返回给 UI 的提示文案。
 */
export async function syncLocFromContacts(): Promise<string[]> {
  const out: string[] = [];
  const snap = readSnap();
  if (!snap) return out;
  const meta = readInviteMeta();
  const pid = meta.partnerContactId;
  if (!pid) return out;
  const me = (snap.meName || '').trim() || '机主';
  const ta = (snap.taName || '').trim() || 'TA';
  try {
    const [taC, all] = await Promise.all([getContact(pid), listContacts()]);
    const meC = all.find((c) => c.kind === 'user' && !c.altOf);
    const follow = snap.locFollow ?? {};
    const taRegion = (taC?.region ?? '').trim();
    if (taRegion && follow.ta !== taRegion) {
      const g = await geocodeOne(taRegion);
      if (g) {
        writeSnap((s) => ({ ...s, taLoc: { name: g.name, lat: g.lat, lng: g.lng }, locFollow: { ...((s.locFollow as CoupleSnap['locFollow']) ?? {}), ta: taRegion } }));
        out.push(`${ta} 的位置已跟随联系人：${g.name}`);
        coupleRemember(pid, meta.partnerApp ?? 'wx', `${ta}在情侣轨迹里的位置同步为联系人资料里填写的「${taRegion}」（定位到${g.name}）`);
      }
    }
    const meRegion = (meC?.region ?? '').trim();
    if (meRegion && follow.me !== meRegion) {
      const g = await geocodeOne(meRegion);
      if (g) {
        writeSnap((s) => ({ ...s, myLoc: { name: g.name, lat: g.lat, lng: g.lng }, locFollow: { ...((s.locFollow as CoupleSnap['locFollow']) ?? {}), me: meRegion } }));
        out.push(`我的位置已跟随联系人：${g.name}`);
        coupleRemember(pid, meta.partnerApp ?? 'wx', `${me}在情侣轨迹里的位置同步为联系人资料里填写的「${meRegion}」（定位到${g.name}）`);
      }
    }
  } catch {
    /* 同步失败静默 */
  }
  return out;
}

// ---------------- 链路二：事件 → 记忆（所有东西写进记忆） ----------------

/**
 * 情侣空间事件写进恋人（AI）的记忆库。
 * - 文案必须用「机主真名/恋人名」归属句式（禁「对方/用户/我」）；
 * - sourceTag='couple'：同源事件互不相似合并、同类精确强化；
 * - 失败静默（不阻断界面主流程）。
 */
export function coupleRemember(contactId: string, channel: CoupleChannel, content: string, eventTime?: number): void {
  const t = (content ?? '').trim();
  if (!contactId || !t) return;
  try {
    memAddEventFragment(contactId, channel, t, { sourceTag: 'couple', eventTime: eventTime ?? Date.now() });
  } catch {
    /* 记忆写入失败静默 */
  }
}

/**
 * patch 钩子：对比前后状态，把用户新产生的情侣空间事件自动写进记忆。
 * 由 CoupleSpaceApp 的 patch（含 tapMissYou/waterTree 等一切状态变更）调用；纯同步、fire-and-forget。
 */
export function coupleMemoryDiff(prev: CoupleSnap, next: CoupleSnap, contactId: string, channel: CoupleChannel, notifyText?: (t: string) => void): void {
  if (!contactId) return;
  const me = (next.meName || prev.meName || '').trim() || '机主';
  const ta = (next.taName || prev.taName || '').trim() || 'TA';
  const lines: string[] = [];

  // 想你打卡
  if ((next.missYou ?? 0) > (prev.missYou ?? 0)) {
    const today = todayKey();
    const n = next.missYouByDay?.[today] ?? 1;
    lines.push(`${me}在情侣空间想${ta}了（今天第 ${n} 次，累计 ${next.missYou} 次）`);
  }
  // 留言板（我新钉的便签/封存的胶囊 + 我在便签下留的言——TA 都要知道；胶囊内容封存，不写进记忆）
  {
    const prevNotes = prev.boardNotes ?? [];
    const nextNotes = next.boardNotes ?? [];
    const myNew = nextNotes.find((n) => n.from === 'me' && !prevNotes.some((p) => p.id === n.id));
    if (myNew) {
      if (myNew.unlockAt) {
        const days = Math.max(1, Math.ceil((myNew.unlockAt - Date.now()) / 86400000));
        lines.push(`${me}在留言板上封存了一颗时间胶囊（约 ${days} 天后开启，内容暂时谁也看不到）`);
      } else {
        lines.push(`${me}在留言板上钉了一张便签：「${cut(myNew.text, 44)}」`);
      }
    }
    const prevCmtIds = new Set(prevNotes.flatMap((p) => (p.comments ?? []).map((m) => m.id)));
    for (const n of nextNotes) {
      const mine = (n.comments ?? []).find((m) => m.from === 'me' && !prevCmtIds.has(m.id));
      if (mine) {
        const owner = n.from === 'ta' ? ta : me;
        lines.push(`${me}在留言板上${owner === me ? `自己钉的那张便签（「${cut(n.text, 24)}」）` : `${ta}钉的便签（「${cut(n.text, 24)}」）`}下面留言：${cut(mine.text, 44)}`);
        break; // 一次 diff 只记一条（连续多条留言时下轮 diff 会补）
      }
    }
  }
  // 心情日记（我写的）
  const newMood = (next.moods ?? []).find((m) => m.from !== 'ta' && !(prev.moods ?? []).some((p) => p.id === m.id));
  if (newMood) lines.push(`${me}在情侣空间写了心情日记：${cut(newMood.text || newMood.emoji, 40)}`);
  // 甜蜜小问答（我的新回答）
  const newQuiz = (next.quiz ?? []).find((r) => !(prev.quiz ?? []).some((p) => p.id === r.id));
  if (newQuiz) lines.push(`${me}在甜蜜小问答里回答「${cut(newQuiz.q, 24)}」：${cut(newQuiz.a, 48)}`);
  // 恋爱编年史
  const newChron = (next.chronicle ?? []).find((c) => !(prev.chronicle ?? []).some((p) => p.id === c.id));
  if (newChron) lines.push(`${me}在恋爱编年史记下一件大事：${cut(newChron.text, 40)}`);
  // 纪念日
  for (const a of next.annivExtra ?? []) {
    if (!(prev.annivExtra ?? []).some((p) => p.key === a.key)) lines.push(`${me}在情侣空间记下纪念日「${cut(a.label, 18)}」（${a.date}）`);
  }
  // 100 件小事（勾选/编辑）
  if ((next.hundred ?? []).length > (prev.hundred ?? []).length) {
    const added = (next.hundred ?? []).filter((i) => !(prev.hundred ?? []).includes(i));
    for (const idx of added.slice(0, 2)) {
      const item = next.hundredItems?.[String(idx)];
      lines.push(`${me}完成了100件小事的第 ${idx + 1} 件${item ? `：${cut(item.desc || item.place, 24)}` : ''}`);
    }
  }
  // 未来情书
  const newLetter = (next.letters ?? []).find((l) => !(prev.letters ?? []).some((p) => p.id === l.id));
  if (newLetter) lines.push(`${me}给${ta}写了一封情书：${cut(newLetter.text, 36)}`);
  // 情书分享（我把信寄给了 TA：TA 拆信读了，要知道内容）
  const sharedLetter = (next.letters ?? []).find((l) => l.sharedAt && !(prev.letters ?? []).find((p) => p.id === l.id)?.sharedAt);
  if (sharedLetter) lines.push(`${me}把写的情书寄给了${ta}（信的内容：${cut(sharedLetter.text, 46)}），${ta}拆信读了`);
  // 我给 TA 的信下留言
  const newLetterCmt = (next.comments ?? []).filter((c) => c.from === 'me' && c.key.startsWith('letter:') && !(prev.comments ?? []).some((p) => p.id === c.id));
  for (const c of newLetterCmt.slice(0, 1)) {
    lines.push(`${me}在情书下面的留言区里对${ta}说：${cut(c.text, 40)}`);
  }
  // 恋爱协议生效
  if (next.pactAt != null && prev.pactAt == null) {
    lines.push(`${me}和${ta}在情侣空间签署了恋爱协议《${cut(next.pactTitle, 16)}》（共 ${(next.pactClauses ?? []).length} 条条款，双方签名生效）`);
  }
  // 印象（我贴给 TA 的：贴在 TA 身上，形容 TA）
  const newImp = (next.impressionsTa ?? []).filter((t) => !(prev.impressionsTa ?? []).includes(t));
  if (newImp.length > 0) lines.push(`${me}亲手给${ta}贴了新标签（贴在${ta}身上、形容${ta}的）：${newImp.slice(0, 3).join('、')}`);
  // 印象（我记在「TA 眼中的我」里的：贴在我身上）
  const newImpMe = (next.impressionsMe ?? []).filter((t) => !(prev.impressionsMe ?? []).includes(t));
  if (newImpMe.length > 0) lines.push(`${me}在「TA 眼中的我」里记下贴在自己身上的标签：${newImpMe.slice(0, 3).join('、')}`);
  // 相册上传（我传了照片，TA 要知道）
  for (const a of next.albums ?? []) {
    const prevA = (prev.albums ?? []).find((x) => x.id === a.id);
    const added = a.photos.length - (prevA?.photos.length ?? 0);
    if (added > 0) lines.push(`${me}往情侣空间的相册「${a.name}」上传了 ${added} 张照片`);
  }
  // 留言区（我在各处留言区发的消息）
  const newCmt = (next.comments ?? []).filter((c) => c.from === 'me' && !(prev.comments ?? []).some((p) => p.id === c.id));
  for (const c of newCmt.slice(0, 2)) {
    lines.push(`${me}在${sceneOfKey(c.key, next)}里对${ta}说：${cut(c.text, 40)}`);
  }
  // 回复挑战（我发起了双人挑战）
  if (next.replyTa?.active && !prev.replyTa?.active) {
    lines.push(`${me}在回复挑战里和${ta}开启了双人挑战（${ta}也在同一时间一关一关作答）`);
  }
  // 轨迹位置
  if (next.myLoc && next.myLoc.name !== prev.myLoc?.name) lines.push(`${me}在情侣轨迹里设置了自己的真实位置：${next.myLoc.name}`);
  if (next.taLoc && next.taLoc.name !== prev.taLoc?.name) lines.push(`${me}把${ta}在情侣轨迹里的位置设为：${next.taLoc.name}`);
  if (next.meetLoc && next.meetLoc.name !== prev.meetLoc?.name) lines.push(`${me}把你们的相遇地点定为：${next.meetLoc.name}`);

  for (const text of lines.slice(0, 4)) {
    coupleRemember(contactId, channel, text);
  }
  if (lines.length > 0 && notifyText) notifyText(lines[0]);
}

// ---------------- 链路三：AI 主动行为（每天想你/浇树/纪念日/问答/心情/100件/印象/拟协议） ----------------

/** LLM 调用：走 /api/chat 内置模型兜底（forceSdk，无需用户配置；流式文本聚合成完整回复） */
async function coupleLLM(system: string, user: string): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      forceSdk: true,
      temperature: 0.95,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`llm ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out.trim();
}

/** 从 LLM 输出提取第一个 JSON 对象（容忍代码块包裹） */
function extractJson<T>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

/** 灵动岛通知 + 未读角标（仿 couple-invite.notifyCard；正在查看的会话不 bump） */
async function notifyCouple(channel: CoupleChannel, contactId: string, body: string): Promise<void> {
  try {
    const c = await getContact(contactId);
    if (!c) return;
    pushChatNotification({
      sessionKey: `${channel}:${contactId}`,
      app: channel === 'wx' ? ('wechat' as const) : ('qq' as const),
      title: displayNameOf(c),
      avatar: avatarFor(c, channel),
      body,
      target: { app: channel === 'wx' ? ('wechat' as const) : ('qq' as const), contactId },
    });
    if (!isProactiveChatActive(channel, contactId)) {
      (channel === 'wx' ? wxUnreads : qqUnreads).bump(contactId, 1);
    }
  } catch {
    /* 通知失败静默 */
  }
}

/** 追加 AI 行为日志（情侣空间设置页/透明度展示用；只留最近 12 条） */
function logAi(text: string): void {
  writeSnap((s) => ({
    ...s,
    aiLog: [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, at: Date.now() }, ...((s.aiLog as CoupleSnap['aiLog']) ?? [])].slice(0, 12),
  }));
}

/** 恋人（AI）的人设摘要（LLM 行为的 system 用；同步读联系人缓存不可靠 → 由调用方预取传入） */
interface TaPersona {
  name: string;
  persona: string;
  background: string;
  relation: string;
}

async function taPersonaOf(contactId: string): Promise<TaPersona | null> {
  try {
    const c = await getContact(contactId);
    if (!c) return null;
    return { name: displayNameOf(c) || c.name, persona: (c.persona ?? '').trim(), background: (c.background ?? '').trim(), relation: (c.relation ?? '').trim() };
  } catch {
    return null;
  }
}

/** 共享记忆摘要（LLM 行为的上下文；与 coupleChatBlock 同源但更紧凑） */
function snapDigest(snap: CoupleSnap, me: string, ta: string): string {
  const parts: string[] = [];
  const days = daysSinceAnniv(snap.anniversary);
  if (days != null) parts.push(`在一起${days}天`);
  const today = todayKey();
  if ((snap.missYouByDay?.[today] ?? 0) > 0) parts.push(`${me}今天想${ta}了${snap.missYouByDay?.[today]}次`);
  for (const r of (snap.quiz ?? []).slice(0, 1)) {
    parts.push(`问答「${cut(r.q, 18)}」${me}答「${cut(r.a, 30)}」`);
  }
  const moodMe = (snap.moods ?? []).find((m) => m.from !== 'ta');
  if (moodMe) parts.push(`${me}最近心情：${cut(moodMe.text, 26)}`);
  const newChron = (snap.chronicle ?? [])[0];
  if (newChron) parts.push(`编年史「${cut(newChron.text, 22)}」`);
  if ((snap.impressionsTa ?? []).length > 0) parts.push(`${me}贴给${ta}的标签：${(snap.impressionsTa ?? []).slice(0, 3).join('、')}`);
  if ((snap.impressionsMe ?? []).length > 0) parts.push(`贴在${me}身上的标签：${(snap.impressionsMe ?? []).slice(0, 3).join('、')}`);
  if ((snap.pactClauses ?? []).length > 0 && snap.pactAt != null) parts.push(`已有协议《${cut(snap.pactTitle, 12)}》`);
  return parts.join('；');
}

/** 组装 LLM system（人设 + 性别纪律 + 共享记忆 + 行为纪律 + 第十六轮情绪/作息动态状态） */
function llmSystem(p: TaPersona, me: string, snap: CoupleSnap): string {
  const ta = p.name;
  return [
    `你是「${ta}」，是${me}的恋人（你们在情侣空间 App 里是绑定的情侣关系）。`,
    p.relation ? `你们的关系：${p.relation}。` : '',
    p.persona ? `你的性格/说话风格：${cut(p.persona, 120)}` : '',
    p.background ? `你的背景：${cut(p.background, 100)}` : '',
    genderLine(snap, me),
    `你们在情侣空间里的共享记忆：${snapDigest(snap, me, ta) || '刚刚开始，还很空白'}。`,
    // 第十六轮：AI 动态状态（情绪+作息）——情侣空间里的行为（日记/情书/留言…）也带着当前心情
    currentPartnerId ? buildDynamicStateBlocks(currentPartnerId) : '',
    `你正在情侣空间里为你们的感情做一件小事。要求：严格贴合你的人设与你们的真实记忆，口语、简短、真诚，像真实的恋人亲手写下的；禁止出现「AI/系统/用户/模型」等字样；禁止 markdown 格式；禁止使用任何 emoji/表情符号。`,
  ]
    .filter(Boolean)
    .join('\n');
}

// —— 行为实现（每个都是：去重检查 → LLM/兜底 → 写状态 → 写记忆 → 通知） ——

/** AI 每天想你打卡 */
function aiTickMissYou(snap: CoupleSnap, me: string, ta: string): void {
  const today = todayKey();
  if ((snap.taMissYouByDay?.[today] ?? 0) > 0) return;
  const n = 1 + Math.floor(Math.random() * 2); // 每天 1~2 次
  writeSnap((s) => ({
    ...s,
    taMissYou: ((s.taMissYou as number) ?? 0) + n,
    taMissYouByDay: { ...((s.taMissYouByDay as Record<string, number>) ?? {}), [today]: n },
  }));
  // 记忆 + 日志（不通知：想你太频繁会吵）
  const pid = currentPartnerId;
  if (pid) coupleRemember(pid, currentChannel, `${ta}在情侣空间想${me}了（今天第 1 次，TA 是主动想你的）`);
  logAi(`${ta}今天也想${me}了 ♡`);
}

// ---------------- 留言板（软木墙手写便签；替代许愿树） ----------------

/**
 * AI 在留言板上钉一张手写便签（专属自主链：什么时候贴、贴不贴、写什么、用哪张卡纸/颜色全由 TA 自己决定）。
 * 素材 = 人设 + 记忆碎片召回 + 最近微信/QQ 聊天 + 墙上已有的便签（防写重）；
 * LLM 一次决策：pin（此刻想不想钉）+ text（写什么）+ card（贴哪张卡纸，含 TA 对方亲手上传的自定义卡）+ color（素白时挑颜色）。
 * 返回 true = 钉上了；false = TA 此刻还不想钉（等下一次链式唤醒再问，绝不硬凑）。
 */
async function aiTickBoardNote(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<boolean> {
  const today = todayKey();
  if ((snap.boardNoteDay ?? '') === today) return false;
  const pid = currentPartnerId;
  const ch = currentChannel;
  if (!pid) return false;
  const customs = snap.boardCardCustom ?? [];
  const existing = (snap.boardNotes ?? []).slice(0, 6).map((n) => `「${cut(n.text, 30)}」`).join('、');
  let memBlock = '';
  try {
    memBlock = memChatRecallBlock(pid, ch, `${ta}想在留言板上钉一张写给${me}的便签 最近你们聊过什么、有什么想对${me}说的`, { mode: 'private' });
  } catch {
    /* 召回失败不影响 */
  }
  const chatCtx = recentChatBlock(pid, ch, me, ta);
  const { period, hm } = timePeriodNow();
  const cardMenu = [
    `素白（纯色卡纸，16 色：${NOTE_COLOR_NAMES.join('、')}）`,
    ...BOARD_CARDS.map((c) => `${c.label}（${c.desc ?? '图案卡纸'}）`),
    ...customs.map((_, i) => `自定义卡${i + 1}（${me}亲手上传的卡纸，贴这张最有心意）`),
  ].join('、');
  const sys = promptTextOf(
    'couple-pin-note',
    { period, hm, ta, me },
    [
    llmSystem(p, me, snap),
    `场景：你们有一面留言板（软木墙），两人可以随手把手写便签钉上去。现在是${period}（${hm}），${ta}被问到：此刻想不想亲手钉一张便签上去（上面写一句真心想对${me}说的话）？想就钉，不想就先不钉——完全由你按此刻的心情/时段/你们最近的状态决定，绝不硬凑。`,
    `可选卡纸：${cardMenu}`,
    memBlock ? `【你们的记忆碎片】\n${cut(memBlock, 500)}` : '',
    chatCtx ? `【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 300)}` : '',
    existing ? `墙上已经钉过这些便签（内容不许重复、不许相近）：${existing}` : '',
  ]
      .filter(Boolean)
      .join('\n'),
  ) ?? '';
  if (!sys) return false; // v63：couple-pin-note 条目关闭 → 本次不问便签
  try {
    const raw = await llmUserFirst(
      sys,
      `输出 JSON：{"pin":true 或 false,"text":"便签上写的这句话（8~36 字，pin 为 true 时必填）","card":"从可选卡纸里选的名字","color":"选素白时从 16 色里挑的颜色名，其他卡留空","why":"一句话理由（≤16 字）"}。要求：此刻不想钉就 pin:false（其余留空）；text 要有${ta}的口吻手写感（日常关心、一句想念、小承诺或此刻想说的话），贴人设/记忆/最近聊过的事，具体不空洞；card 挑最贴合这句话心情/内容的卡纸（随手一句想念适合便签纸、认真写的小心事适合样式一、想被整面墙看见的话适合样式五……）；禁止使用任何 emoji/表情符号。只输出 JSON。`,
    );
    const j = extractJson<{ pin?: boolean; text?: string; card?: string; color?: string; why?: string }>(raw);
    if (!j?.pin) return false; // TA 此刻还不想钉 → 等下一次链式唤醒再问
    const text = stripEmoji(cut(j.text ?? '', 40));
    if (!text || text.length < 4) return false;
    // 卡纸名 → 索引（素白=0；内置 1-3（v44 精简后）；自定义 100+i；没认出来随机兜底保持手感）
    const name = stripEmoji(String(j.card ?? '')).trim();
    let card = 0;
    let colorIdx = Math.floor(Math.random() * 16); // 素白时默认随机色
    const bi = BOARD_CARDS.findIndex((c) => c.label === name);
    const cm = /^自定义卡\s*(\d+)$/.exec(name);
    if (bi >= 0) {
      card = bi + 1;
    } else if (cm) {
      const i = Number(cm[1]) - 1;
      card = i >= 0 && i < customs.length ? 100 + i : 0;
    } else if (name !== '素白') {
      card = Math.random() < 0.5 ? 0 : 1 + Math.floor(Math.random() * BOARD_CARDS.length);
    }
    if (card === 0) {
      const colIdx = NOTE_COLOR_NAMES.indexOf(stripEmoji(String(j.color ?? '')).trim());
      if (colIdx >= 0) colorIdx = colIdx;
    }
    const note = {
      id: `ta-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      from: 'ta' as const,
      text,
      at: Date.now(),
      ...(card > 0 ? { card } : { color: colorIdx }),
      comments: [] as { id: string; from: 'me' | 'ta'; text: string; at: number }[],
    };
    writeSnap((s) => ({
      ...s,
      boardNotes: [note, ...((s.boardNotes as CoupleSnap['boardNotes']) ?? [])].slice(0, 60),
      boardNoteDay: today,
    }));
    const why = cut(String(j.why ?? ''), 18);
    coupleRemember(pid, ch, `${ta}在留言板上亲手钉了一张便签：「${cut(text, 44)}」`);
    logAi(`${ta}自己决定此刻在留言板上钉一张便签${why ? `（${why}）` : ''}`);
    void notifyCouple(ch, pid, `我在留言板上钉了张便签，写了句想给你的话，去看看嘛`);
    return true;
  } catch {
    return false; // 生成失败本次不钉，等下一次链式唤醒
  }
}

/**
 * 留言板便签专属自主链：什么时候贴由 TA 自己决定——
 * 每隔一段时间（50~130 分钟）唤醒一次「此刻想不想在留言板上钉一张便签」的 LLM 决策
 * （人设+记忆+最近聊天+时段），TA 说想钉才钉（aiTickBoardNote 内部决策），不想就等下一次再问；
 * 每天最多钉一张（boardNoteDay 去重），不占每日自主行为额度（这条链只为便签服务）。
 * 与自主决策链（AUTONOMY_BEHAVIORS）解耦：打开手机/刷新页面都会自动续链（timer 没了就重挂）。
 */
let boardNoteLoopTimer: number | undefined;

function boardNoteLoop(contactId: string, me: string, ta: string, delayMs: number): void {
  if (boardNoteLoopTimer !== undefined) window.clearTimeout(boardNoteLoopTimer);
  boardNoteLoopTimer = window.setTimeout(() => {
    boardNoteLoopTimer = undefined;
    void (async () => {
      try {
        const snap = readSnap();
        if (snap && (snap.boardNoteDay ?? '') !== todayKey() && (snap.boardNotes ?? []).length < 60) {
          const p = await taPersonaOf(contactId);
          if (p) await aiTickBoardNote(snap, me, ta, p);
        }
        // 链式下一次「想不想钉」（今天钉过了也会继续问，跨天自动又能钉）
        boardNoteLoop(contactId, me, ta, 50 * 60000 + Math.random() * 80 * 60000);
      } catch {
        boardNoteLoop(contactId, me, ta, 60 * 60000 + Math.random() * 60 * 60000);
      }
    })();
  }, delayMs);
}

/** 留言板便签留言的 AI 回复定时器（按便签去重合并） */
const boardNoteTimers = new Map<string, number>();

/**
 * 我钉了便签 / 在便签下留言后：调度 TA（AI）在便签下回一句（人设+记忆+聊天上下文）。
 * - 我钉的新便签（还没人留言）→ TA 来当第一个回应的人；
 * - 我在任意便签下留了言（最新一条是我）→ TA 回复我；
 * - 最新一条已经是 TA 说的 / TA 自己的便签还没人说话 → 不出声；
 * - 封存中的时间胶囊谁都看不到，TA 也不出声。
 * 同一张便签连发会重置计时（合并到最后一条再回，30~120s）。
 */
export function scheduleBoardNoteReply(noteId: string, delayMin = 30000, delayMax = 120000): void {
  const target = aiTarget();
  if (!target || !noteId) return;
  const old = boardNoteTimers.get(noteId);
  if (old) window.clearTimeout(old);
  const t = window.setTimeout(() => {
    boardNoteTimers.delete(noteId);
    void (async () => {
      try {
        const snap = readSnap();
        if (!snap) return;
        const note = (snap.boardNotes ?? []).find((n) => n.id === noteId);
        if (!note) return;
        if (note.unlockAt && note.unlockAt > Date.now()) return; // 胶囊封存中，谁都看不到
        const last = (note.comments ?? [])[(note.comments ?? []).length - 1];
        if (note.from === 'ta' && !last) return; // TA 自己的便签还没人说话，不用回
        if (last && last.from === 'ta') return; // 最新一条已经是 TA 说的
        const me = (snap.meName || '').trim() || '我';
        const ta = (snap.taName || '').trim() || 'TA';
        const p = await taPersonaOf(target.contactId);
        if (!p) return;
        currentPartnerId = target.contactId;
        currentChannel = target.channel;
        const owner = note.from === 'ta' ? ta : me;
        const convo = (note.comments ?? []).slice(-6).map((m) => `${m.from === 'ta' ? ta : me}：${cut(m.text, 60)}`).join('\n');
        let memBlock = '';
        try {
          memBlock = memChatRecallBlock(target.contactId, target.channel, `${me}在留言板的便签（「${cut(note.text, 30)}」）下面留言 ${ta}想回一句`, { mode: 'private' });
        } catch {
          /* 召回失败不影响 */
        }
        const chatCtx = recentChatBlock(target.contactId, target.channel, me, ta);
        let text = '';
        try {
          text = await llmUserFirst(
            `${llmSystem(p, me, snap)}\n场景：你们有一面留言板（软木墙），上面钉着一张张手写便签，便签下面可以互相留言。这张便签是${owner === me ? `${me}钉的，上面写着「${cut(note.text, 80)}」` : `${ta}自己钉的，上面写着「${cut(note.text, 80)}」（${ta}当然记得自己写了什么）`}，留言就写在这张便签下面。${memBlock ? `\n【相关记忆】\n${cut(memBlock, 300)}` : ''}${chatCtx ? `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 360)}` : ''}`,
            `${convo ? `便签下最近的留言：\n${convo}\n` : '便签下还没有人留言，你是第一个回应这张便签的人。\n'}\n请以「${ta}」的口吻在便签下面留一条言（30 字内，口语）：${
              note.from === 'me'
                ? `认真接住${me}写在便签上的那句话——它对你们意味着什么、你此刻真实的感受或想回应的心里话`
                : `回应${me}刚刚在你便签下的留言`
            }；贴着你的人设、你们的真实记忆和最近聊过的话题说具体的话；绝对禁止敷衍应付（「好啦好啦」「随便」「都行」这类话一个字都不许出现）。禁止使用任何 emoji/表情符号。只输出留言内容。`,
          );
        } catch {
          /* 生成失败保持安静 */
        }
        text = stripEmoji(text);
        if (!text || text.length < 2) return;
        text = cut(text, 90);
        const c = { id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, from: 'ta' as const, text, at: Date.now() };
        writeSnap((s) => ({
          ...s,
          boardNotes: ((s.boardNotes as CoupleSnap['boardNotes']) ?? []).map((x) => (x.id === noteId ? { ...x, comments: [...(x.comments ?? []), c] } : x)),
        }));
        coupleRemember(target.contactId, target.channel, `${ta}在留言板的便签（「${cut(note.text, 30)}」）下面回复${me}：${cut(text, 40)}`);
        logAi(`${ta}在留言板的便签下留了言`);
        void notifyCouple(target.channel, target.contactId, `留言板有张便签，我在下面给你回了句话，去看看`);
      } catch {
        /* AI 回复失败静默 */
      }
    })();
  }, delayMin + Math.random() * (delayMax - delayMin));
  boardNoteTimers.set(noteId, t);
}

// 第二十四轮：AI 心情日记的模板兜底已删除（生成失败就不写）

/** 心情标签 → 情侣空间心情表情 id（与 couple-space.tsx 的 MOOD_LIST 对齐） */
const MOOD_LABEL_TO_EMOJI: Record<string, string> = {
  开心: '😊',
  甜蜜: '🥰',
  困困: '😴',
  生气: '😤',
  委屈: '😢',
  思考: '🤔',
  兴奋: '🤩',
  想TA: '🥲',
};

/**
 * AI 写心情日记（每天一条）。
 * 用户规格：素材 = 人设 + 共享记忆召回 + 最近微信/QQ 聊天内容；不要基于情侣空间里的东西；
 * 表情必须能正常显示（从心情列表里选，不再从正文里猜）。
 */
async function aiTickMood(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<void> {
  const today = todayKey();
  if ((snap.moods ?? []).some((m) => m.from === 'ta' && (m.dateKey || todayKey(new Date(m.at))) === today)) return;
  const pid = currentPartnerId;
  const ch = currentChannel;
  // 素材一：恋人（AI）的记忆碎片召回（与聊天时同一套记忆，含此前聊过的话题/事件）
  let memBlock = '';
  try {
    if (pid) memBlock = memChatRecallBlock(pid, ch, `${ta}今天的心情日记 最近你们聊过什么`, { mode: 'private' });
  } catch {
    /* 召回失败不影响 */
  }
  // 素材二：最近的微信/QQ 聊天上下文（非情侣空间内容）
  const chatBlock = recentChatBlock(pid, ch, me, ta);
  const sys = promptTextOf(
    'couple-mood-diary',
    { ta, me },
    [
    `你是「${ta}」，是${me}的恋人，正在写自己的心情日记。`,
    p.relation ? `你们的关系：${p.relation}。` : '',
    p.persona ? `你的性格/说话风格：${cut(p.persona, 120)}` : '',
    p.background ? `你的背景：${cut(p.background, 100)}` : '',
    genderLine(snap, me),
    memBlock ? `【你们的记忆碎片】\n${cut(memBlock, 700)}` : '',
    chatBlock ? `【你们最近的聊天记录】\n${chatBlock}` : '',
    '要求：像真人写日记，根据你今天的生活、你们最近聊天的话题和你的心情来写；素材只能来自你的人设、你们的记忆碎片和最近的聊天记录；不要提情侣空间 App 里的任何功能或内容（想你打卡/标签/协议/问答/相册/小树/轨迹等都不许出现）；口语、简短、真诚；禁止 emoji/表情符号；禁止 markdown。',
  ]
      .filter(Boolean)
      .join('\n'),
  ) ?? '';
  if (!sys) return false; // v63：couple-mood-diary 条目关闭 → 跳过今天的心情日记
  let moodLabel = '';
  let text = '';
  try {
    const raw = await llmUserFirst(
      sys,
      `请输出 JSON：{"mood":"从 开心/甜蜜/困困/生气/委屈/思考/兴奋/想TA 里选一个最贴今天心情的","text":"日记正文（30字内，纯文本，不要表情符号）"}。只输出 JSON。`,
    );
    const j = extractJson<{ mood?: string; text?: string }>(raw);
    if (j && j.text) {
      text = stripEmoji(String(j.text));
      moodLabel = stripEmoji(String(j.mood ?? '')).trim();
    }
  } catch {
    /* 兜底 */
  }
  if (!text || text.length < 2) {
    // 第二十四轮：不用模板兜底——生成失败今天就不写日记，明天再试
    return;
  }
  text = cut(text, 80);
  const emoji = MOOD_LABEL_TO_EMOJI[moodLabel] ?? '🥰';
  const entry = { id: `ai-${Date.now()}`, emoji, text, at: Date.now(), dateKey: today, from: 'ta' };
  writeSnap((s) => ({ ...s, moods: [entry, ...((s.moods as CoupleSnap['moods']) ?? [])] }));
  if (pid) coupleRemember(pid, ch, `${ta}在情侣空间写了心情日记：${cut(text, 40)}`);
  logAi(`${ta}写了今天的心情日记`);
  void notifyCouple(ch, pid, `我在情侣空间写了今天的心情日记，快去看看`);
}

/**
 * 「戳一下他」：对方今日还没写日记时，立刻让 TA 去写（延时 2~4s 出现，像被戳了才动笔）。
 * 返回 true = 已去写；false = TA 今天已经写过（无需再戳）。
 */
export function pokeTaDiary(): boolean {
  const snap = readSnap();
  if (!snap) return false;
  const today = todayKey();
  if ((snap.moods ?? []).some((m) => m.from === 'ta' && (m.dateKey || todayKey(new Date(m.at))) === today)) return false;
  const target = aiTarget();
  if (!target) return false;
  window.setTimeout(() => {
    void (async () => {
      try {
        const p = await taPersonaOf(target.contactId);
        const s = readSnap();
        if (!p || !s) return;
        currentPartnerId = target.contactId;
        currentChannel = target.channel;
        await aiTickMood(s, (s.meName || '').trim() || '我', (s.taName || '').trim() || 'TA', p);
      } catch {
        /* 静默 */
      }
    })();
  }, 1800 + Math.random() * 2200);
  return true;
}

// 第二十四轮：甜蜜小问答模板兜底已删除（生成失败就不答）

/** AI 回答甜蜜小问答（每天挑一个它还没答过的问题；会结合我的回答） */
async function aiTickQuiz(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<void> {
  const answeredQ = new Set((snap.quizTa ?? []).map((x) => x.q));
  const mine = new Map((snap.quiz ?? []).map((r) => [r.q, r.a]));
  // 问题池与 couple-space QUIZ_POOL/自定义问题一致：全部来自 state.quiz 的 q + quizCustom —— 快照里没有 quizCustom，就用我的回答里的问题 + 常备池
  const FALLBACK_QS = ['你第一次见到我时，对我的第一印象是什么？', '你希望十年后的我们是什么样子？', '你最喜欢我身上的哪三个优点？', '如果我们养一只宠物，你想养什么？'];
  const q = [...mine.keys()].find((x) => !answeredQ.has(x)) ?? FALLBACK_QS.find((x) => !answeredQ.has(x));
  if (!q) return;
  const myA = mine.get(q) ?? '';
  let a = '';
  try {
    a = await llmUserFirst(
      llmSystem(p, me, snap),
      `情侣小问答的题目是：「${q}」。\n请以「${ta}」的身份亲自回答（60 字内）：必须正面回答题目本身，说你自己真实具体的想法/经历（结合你的人设和你们的真实记忆），不要答非所问；语气真诚甜蜜，可以带一点恋人间的亲昵，绝不抱怨、不指责${me}；用「我」的口吻说人话${myA ? `。${me}自己的回答是「${cut(myA, 50)}」，结尾可以自然呼应一下` : ''}。只输出回答正文，禁止 emoji。`,
    );
  } catch {
    /* 兜底 */
  }
  // 第二十四轮：不用模板兜底——生成失败就跳过本次回答，下个周期再试
  if (!a || a.length < 4) return;
  a = cut(a, 90);
  writeSnap((s) => {
    const list = ((s.quizTa as CoupleSnap['quizTa']) ?? []).filter((x) => x.q !== q);
    return { ...s, quizTa: [{ q, a, at: Date.now() }, ...list] };
  });
  const pid = currentPartnerId;
  if (pid) coupleRemember(pid, currentChannel, `${ta}在甜蜜小问答里回答了「${cut(q, 24)}」：${cut(a, 48)}${myA ? `（${ta}看过并记住了${me}的回答「${cut(myA, 30)}」）` : ''}`);
  logAi(`${ta}回答了甜蜜小问答`);
}

// 第二十四轮：印象标签模板池已删除（生成失败就不贴）

/** AI 主动贴印象（每 3 天一次，贴「TA 眼中的你」） */
async function aiTickImpress(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<void> {
  const last = snap.aiImpressAt ?? 0;
  if (Date.now() - last < 3 * 86400000) return;
  const have = new Set(snap.impressionsMe ?? []);
  // 第五十六轮：贴标签也注入记忆碎片与最近聊天（标签要贴得像你们真实相处出来的）
  const pid0 = currentPartnerId;
  const ch0 = currentChannel;
  let memBlock = '';
  try {
    if (pid0) memBlock = memChatRecallBlock(pid0, ch0, `${ta}给${me}贴情侣印象标签`, { mode: 'private' });
  } catch {
    /* 召回失败不影响 */
  }
  const chatCtx0 = recentChatBlock(pid0, ch0, me, ta);
  let picks: string[] = [];
  try {
    const gNote = snap.gender === '女' ? `（${me}是女生，标签必须符合女生身份：用「女友力max」这类词，绝不能用「男友力」之类男性向的词，也不要用形容男生的称呼）` : '';
    const raw = await llmUserFirst(
      `${llmSystem(p, me, snap)}${memBlock ? `\n【你们的记忆碎片】\n${cut(memBlock, 300)}` : ''}${chatCtx0 ? `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx0, 240)}` : ''}`,
      `请以「${ta}」的口吻，给${me}贴 2~3 个情侣印象标签（每个≤6字，真实可爱，贴合你们的相处）${gNote}。每行一个，只输出标签本身。`,
    );
    picks = raw
      .split('\n')
      .map((l) => l.replace(/^[-•\d.、\s]+/, '').trim())
      .filter((l) => l && l.length <= 8 && !l.includes('你是'))
      .slice(0, 3);
  } catch {
    /* 兜底 */
  }
  // 第二十四轮：不用模板兜底——生成失败本次不贴标签，下个周期再试
  picks = picks.filter((w) => !have.has(w));
  if (picks.length === 0) return;
  writeSnap((s) => ({
    ...s,
    impressionsMe: [...((s.impressionsMe as string[]) ?? []), ...picks],
    aiImpressions: [...((s.aiImpressions as string[]) ?? []), ...picks],
    aiImpressAt: Date.now(),
  }));
  const pid = currentPartnerId;
  if (pid) coupleRemember(pid, currentChannel, `${ta}在情侣印象里给${me}贴了这些标签：${picks.join('、')}`);
  logAi(`${ta}给你贴了新印象：${picks.join('、')}`);
  void notifyCouple(currentChannel, pid, `我在情侣印象里偷偷给你贴了几个标签，去承认一下 ♡`);
}

/** AI 设置纪念日（每自然月最多一个） */
async function aiTickAnniv(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<void> {
  const monthKey = todayKey().slice(0, 7);
  const keys = snap.aiAnnivKeys ?? [];
  if (keys.some((k) => k.startsWith(`ai-${monthKey}`))) return;
  const existing = new Set((snap.annivExtra ?? []).map((a) => a.label));
  let picked: { label: string; date: string; why: string } | null = null;
  try {
    const raw = await llmUserFirst(llmSystem(p, me, snap), `请为你们想一个新的、值得记录的纪念日（只要一个）。输出 JSON：{"label":"纪念日名（≤12字，别与已有重复）","date":"MM-DD","why":"一句话说明（≤26字）"}。已有的纪念日：${[...existing].join('、') || '无'}。只输出 JSON。`);
    picked = extractJson<{ label: string; date: string; why: string }>(raw);
  } catch {
    /* 兜底 */
  }
  if (!picked?.label || !picked?.date) {
    // 兜底：在一起满整月纪念
    const days = daysSinceAnniv(snap.anniversary) ?? 0;
    if (days < 30) return;
    const m = Math.floor(days / 30);
    picked = { label: `在一起${m}个月`, date: snap.anniversary?.slice(5) ?? todayKey().slice(5), why: `${ta}记下的甜日子` };
  }
  picked.label = cut(picked.label, 16).replace(/[「」"]/g, '');
  if (existing.has(picked.label)) return;
  const date = /^\d{2}-\d{2}$/.test(picked.date) ? picked.date : todayKey().slice(5);
  const key = `ai-${monthKey}-${Math.random().toString(36).slice(2, 6)}`;
  const labelFull = `${picked.label}（${ta}记下的）`;
  writeSnap((s) => ({
    ...s,
    annivExtra: [...((s.annivExtra as CoupleSnap['annivExtra']) ?? []), { key, label: labelFull, date: `${new Date().getFullYear()}-${date}` }],
    aiAnnivKeys: [...keys, key],
  }));
  const pid = currentPartnerId;
  if (pid) coupleRemember(pid, currentChannel, `${ta}在情侣空间记下了一个纪念日「${picked.label}」（${date}）：${cut(picked.why ?? '', 26)}`);
  logAi(`${ta}记下了纪念日「${picked.label}」`);
  void notifyCouple(currentChannel, pid, `我给我们的恋爱日历加了一个纪念日：「${picked.label}」，你记得吗？`);
}

// 第二十四轮：AI 拟协议模板条款已删除（拟稿失败就不发）

/** AI 自己拟协议让我签（无待签草稿 + 冷却 7 天）；第十二轮：拟完自动把协议卡片分享到微信/QQ 会话 */
async function aiTickPact(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<void> {
  if (snap.aiPact && !snap.aiPact.declined) return; // 已有一份等我签（第二十三轮：被我拒绝的旧草稿不挡新协议）
  if (snap.pactAt != null && Date.now() - (snap.pactAt ?? 0) < 7 * 86400000) return; // 刚生效过一份，冷却
  let picked: { title: string; clauses: string[] } | null = null;
  try {
    // 拟协议素材：记忆碎片召回 + 最近聊天话题（条款贴着你们的真实相处，不写空泛套路）
    let memCtx = '';
    try {
      const memBlock = memChatRecallBlock(currentPartnerId, currentChannel, `${ta}想拟一份恋爱协议 你们的约定和心事`, { mode: 'private' });
      if (memBlock) memCtx += `\n【相关记忆】\n${cut(memBlock, 240)}`;
    } catch {
      /* 召回失败不影响 */
    }
    const chatCtx = recentChatBlock(currentPartnerId, currentChannel, me, ta);
    if (chatCtx) memCtx += `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 240)}`;
    const raw = await llmUserFirst(
      `${llmSystem(p, me, snap)}\n场景：你想拟一份恋爱协议，签好名后分享给${me}等她签。${memCtx}`,
      `请以「${ta}」的身份拟一份恋爱协议（3~5条条款）。硬性要求：
1）你是男生（${me}的男朋友），条款里第一人称「我」就是你本人；${me}是女生（你的女朋友）；
2）条款要贴着你们的真实经历、共同记忆和最近聊过的事，写具体的小事（比如你们说好的某个约定、她在意的小细节、你们的小暗号），不要写「每天说我爱你」这种谁都能写的空话；
3）既要有你对她认真的承诺，也可以有一两条你对她的小小要求（双向才有协议的感觉，比如也请她答应你一件小事）；
4）语气认真又可爱，每条不超过 30 字，禁止 emoji。
输出 JSON：{"title":"协议名（≤10字）","clauses":["条款1","条款2"]}。只输出 JSON。`,
    );
    picked = extractJson<{ title: string; clauses: string[] }>(raw);
  } catch {
    /* 兜底 */
  }
  if (!picked?.title || !Array.isArray(picked.clauses) || picked.clauses.length === 0) {
    // 第二十四轮：不用模板兜底——拟稿失败本次不发，下个周期再拟
    return;
  }
  const title = cut(picked.title, 14).replace(/[「」"]/g, '');
  const clauses = picked.clauses.map((c) => cut(String(c), 40).replace(/^[-•\d.、\s]+/, '')).filter(Boolean).slice(0, 5);
  if (clauses.length === 0) return;
  writeSnap((s) => ({ ...s, aiPact: { title, preamble: snap.pactPreamble ?? '', clauses, at: Date.now(), signTa: ta } }));
  const pid = currentPartnerId;
  if (pid) {
    coupleRemember(pid, currentChannel, `${ta}自己拟了一份恋爱协议《${title}》（${clauses.length} 条：${clauses.slice(0, 2).join('；')}…），自己先签了名，再分享给${me}等${me}签`);
  }
  logAi(`${ta}拟了一份协议《${title}》，先签好名再分享给你签`);
  // 第十二轮：AI 把协议分享给我——直接发协议卡片到微信/QQ 会话（点卡片进情侣空间签署界面）；
  // 第十六轮：AI 分享之前先签上自己的名字（卡片带 taSigned，签署界面直接带着 TA 的签名等我签）
  try {
    const { sendPactCard } = await import('./couple-pact-share');
    await sendPactCard({ channel: currentChannel, contactId: pid, title, preamble: snap.pactPreamble ?? '', clauses, dir: 'ta', pactId: 'ai', status: 'pending', taSigned: true });
  } catch {
    /* 分享失败不影响协议草稿落库 */
  }
  void notifyCouple(currentChannel, pid, `我拟了一份恋爱协议《${title}》，发你微信了，快去看看签个名嘛`);
}

/**
 * AI 决定签/不签一份协议（第十二轮：AI 自己决定，不无脑全签）。
 * 按人设 + 你们的记忆评估条款：合理/甜蜜的签；过分/不平等的会提出意见婉拒。
 * 第十六轮：say = TA 在聊天里回的原话（人设 + 记忆 + 最近聊天上下文生成，不再用模板）；评估时也注入记忆与聊天上下文。
 */
export async function aiDecidePact(title: string, clauses: string[]): Promise<{ agree: boolean; reason: string; say?: string; changeIdx?: number; changeTo?: string }> {
  const target = aiTarget();
  if (target) {
    try {
      const p = await taPersonaOf(target.contactId);
      const snap = readSnap();
      if (p && snap) {
        currentPartnerId = target.contactId;
        currentChannel = target.channel;
        const me = (snap.meName || '').trim() || '我';
        const ta = (snap.taName || '').trim() || 'TA';
        // 素材：恋人的记忆碎片召回 + 最近微信/QQ 聊天上下文（评估和回话都贴着你们的真实相处）
        let memBlock = '';
        let chatCtx = '';
        try {
          memBlock = memChatRecallBlock(target.contactId, target.channel, `${ta}评估${me}拟的恋爱协议 最近你们聊过什么`, { mode: 'private' });
        } catch {
          /* 召回失败不影响 */
        }
        chatCtx = recentChatBlock(target.contactId, target.channel, me, ta);
        const raw = await llmUserFirst(
          `${llmSystem(p, me, snap)}\n场景：${me}拟了一份恋爱协议分享给你，等你决定签不签。${memBlock ? `\n【相关记忆】\n${cut(memBlock, 300)}` : ''}${chatCtx ? `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 300)}` : ''}`,
          `协议《${cut(title, 16)}》的条款：\n${(clauses ?? []).map((c, i) => `${i + 1}. ${cut(c, 40)}`).join('\n')}\n\n请以「${ta}」的身份认真评估：这些条款是否合理、是否双方平等、是不是你真心愿意遵守的。\n你有三种回应：①条款基本合理 → 直接签；②个别条款你不乐意（只挑一条最想改的）→ 不同意并说出你想改成什么；③整体都离谱 → 婉拒（语气可爱不伤人）。\n输出 JSON：{"agree":true或false,"reason":"你的理由（≤30字，口语，像恋人间的商量）","say":"你在聊天里回给${me}的原话（35~70字，第一人称口语，像看完协议后自然回的消息：可以说签不签、为什么、想到的约定或小事，贴人设与你们的记忆，禁止列条款编号式的机械复述，禁止「协议我看过了」这种开头，禁止 emoji）","changeIdx":想改的条款序号（1起，agree为true或不想改就不写这个字段）,"changeTo":"想改成的内容（≤30字，只有给了changeIdx才写）"}。只输出 JSON。`,
        );
        const j = extractJson<{ agree?: boolean; reason?: string; say?: string; changeIdx?: number; changeTo?: string }>(raw);
        if (j && typeof j.agree === 'boolean') {
          const idx = typeof j.changeIdx === 'number' && Number.isInteger(j.changeIdx) && j.changeIdx >= 1 && j.changeIdx <= (clauses?.length ?? 0) ? j.changeIdx - 1 : undefined;
          const changeTo = idx != null ? cut(stripEmoji(String(j.changeTo ?? '')), 36) : undefined;
          return {
            agree: j.agree,
            reason: cut(stripEmoji(String(j.reason ?? '')), 40) || (j.agree ? '条款我都喜欢' : '有几条我想再商量'),
            say: cut(stripEmoji(String(j.say ?? '')), 110) || undefined,
            ...(idx != null && changeTo && !j.agree ? { changeIdx: idx, changeTo } : {}),
          };
        }
      }
    } catch {
      /* 本地兜底 */
    }
  }
  // 本地兜底：模型不可用时按条款数量做中性判定（不编模板回话，say 留空不发消息）
  const agree = (clauses?.length ?? 0) <= 6;
  return { agree, reason: agree ? '条款我都愿意遵守' : '有几条我想再商量商量', say: undefined };
}

/** AI 主动留言的候选线程（挑一个「TA 还没说过话」的最新线程） */
function pickThreadForAiComment(snap: CoupleSnap): { key: string; scene: string } | null {
  const comments = snap.comments ?? [];
  const hasTa = (key: string) => comments.some((c) => c.key === key && c.from === 'ta');
  // ① 最新相册照片线程（我传的照片，TA 还没留言的）
  for (const album of (snap.albums ?? []).slice(0, 3)) {
    for (let i = (album.photos?.length ?? 0) - 1; i >= 0; i--) {
      const key = `album:${album.id}:${i}`;
      if (!hasTa(key)) return { key, scene: `相册「${album.name}」的第 ${i + 1} 张照片` };
    }
  }
  // ② 我写的最新一篇日记（TA 还没留言的）
  const myMood = (snap.moods ?? []).find((m) => m.from !== 'ta');
  if (myMood) {
    const key = `mood:${myMood.id}`;
    if (!hasTa(key)) return { key, scene: `${snap.meName || '你'}写的心情日记` };
  }
  // ③ 情侣印象留言区（TA 最近没说过话时偶尔冒泡）
  if (!comments.some((c) => c.key === 'impress' && c.from === 'ta' && Date.now() - c.at < 3 * 86400000)) {
    return { key: 'impress', scene: '情侣印象留言区' };
  }
  // ④ 位置与轨迹聊天区（第十八轮：TA 也会主动来聊两句今天的行程/见面计划）
  if (!comments.some((c) => c.key === 'trail' && c.from === 'ta' && Date.now() - c.at < 2 * 86400000)) {
    return { key: 'trail', scene: '位置与轨迹的聊天区' };
  }
  return null;
}

/**
 * AI 主动去留言区留言（每天最多一条；挑照片/日记/印象里还没说过话的线程）。
 * 内容 = 人设 + 共享记忆 + 最近聊天话题（跟真人一样想到了就去说两句，不是等我先发）。
 */
async function aiTickComment(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<void> {
  const today = todayKey();
  if ((snap.aiCommentDay ?? '') === today) return; // 今天已经主动留过言
  const picked = pickThreadForAiComment(snap);
  if (!picked) return;
  currentPartnerId = currentPartnerId || aiTarget()?.contactId || '';
  const pid = currentPartnerId;
  const ch = currentChannel;
  const chatCtx = recentChatBlock(pid, ch, me, ta);
  let text = '';
  try {
    text = await llmUserFirst(
      `${llmSystem(p, me, snap)}\n场景：你自己在情侣空间 App 里逛，走到了${picked.scene}的留言区，想在下面主动给${me}留一句话。${threadContext(picked.key, snap, me, ta)}${chatCtx ? `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 300)}` : ''}`,
      `请以「${ta}」的口吻主动留一条言（25 字内，口语）：像真的想到了什么就说，可以想起一件事、一个小约定、或者突然想${me}了；\n绝对禁止敷衍应付（「好啦好啦听你的」「随便」「都行」这类话不许出现），也不要空洞地夸；贴着你的人设、你们的记忆和最近聊过的话题说具体的话。禁止使用任何 emoji/表情符号。只输出留言内容。`,
    );
  } catch {
    /* 兜底 */
  }
  text = stripEmoji(text);
  // 第二十四轮：不用模板兜底——生成失败就不主动留言（当天可再触发）
  if (!text || text.length < 4) return;
  text = cut(text, 80);
  const c = { id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, key: picked.key, from: 'ta', text, at: Date.now() };
  writeSnap((s) => ({
    ...s,
    comments: [...((s.comments as CoupleSnap['comments']) ?? []), c],
    aiCommentDay: today,
  }));
  if (pid) coupleRemember(pid, ch, `${ta}自己在${picked.scene}下面给${me}留了言：${cut(text, 40)}`);
  logAi(`${ta}主动在${picked.scene}下留了言`);
  void notifyCouple(ch, pid, `我在${picked.scene}下面给你留了句话，去看嘛`);
}

// 第二十四轮：100件小事模板心愿池已删除（生成失败就不发起）

/**
 * AI 完成 100 件小事（第九轮重写：不再随机抽一件事硬凑——从共享清单 HUNDRED_LIST 里挑
 * 「你们真的经历过」的一件勾掉，素材 = 人设 + 记忆碎片召回 + 最近微信/QQ 聊天；
 * 没有匹配就返回不硬凑、不编造。每天最多一件。）
 */
async function aiTickHundred(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<void> {
  const today = todayKey();
  if (snap.aiHundredDay === today) return; // 每天最多一件
  // 已完成 = hundred 勾选 ∪ hundredItems 里已填过 desc 的项（AI 侧与用户侧同一份账）
  const done = new Set<number>(snap.hundred ?? []);
  for (const [k, v] of Object.entries(snap.hundredItems ?? {})) {
    if (v?.desc) done.add(Number(k));
  }
  const candidates: number[] = [];
  for (let i = 0; i < HUNDRED_LIST.length; i++) if (!done.has(i)) candidates.push(i);
  if (candidates.length === 0) return; // 全部完成
  const pid = currentPartnerId;
  const ch = currentChannel;
  // 素材：记忆碎片（我们一起经历过的事）+ 最近聊天
  let memBlock = '';
  try {
    if (pid) memBlock = memChatRecallBlock(pid, ch, `我们一起经历过的事 ${ta}想挑一件一起完成过的小事`, { mode: 'private' });
  } catch {
    /* 召回失败不影响 */
  }
  const chatBlock = recentChatBlock(pid, ch, me, ta);
  const listText = candidates.slice(0, 60).map((i) => `${i}. ${HUNDRED_LIST[i]}`).join('\n');
  const sys = [
    `你是「${ta}」，是${me}的恋人。`,
    p.relation ? `你们的关系：${p.relation}。` : '',
    p.persona ? `你的性格/说话风格：${cut(p.persona, 120)}` : '',
    p.background ? `你的背景：${cut(p.background, 100)}` : '',
    genderLine(snap, me),
    memBlock ? `【你们的记忆碎片】\n${cut(memBlock, 700)}` : '',
    chatBlock ? `【你们最近在微信/QQ里聊过的话题】\n${cut(chatBlock, 320)}` : '',
    `你们在「100件小事」清单里还有这些没完成：\n${listText}`,
    `任务：从上面清单里挑一件「你们真的经历过/已经一起做过」的小事替${me}勾掉（比如最近聊天里聊过、记忆碎片里提过的真实经历）。要求：\n- 只能选真实经历过的一项，绝不硬凑、绝不编造没发生过的事；\n- 没有任何匹配就输出 {"idx":-1}，宁可不勾；\n- desc 用你们经历里的真实细节（地点/当时说的话都可以带一点），不要照抄清单原文。`,
  ].filter(Boolean).join('\n');
  let picked = -1;
  let desc = '';
  let place = '';
  try {
    const raw = await llmUserFirst(sys, `输出 JSON：{"idx":清单序号（没匹配就 -1）,"desc":"这件事的真实经过（≤20字，要带你们经历里的具体细节）","place":"当时在哪里/什么场景（≤10字，可不填）"}。只输出 JSON。`);
    const j = extractJson<{ idx?: number; desc?: string; place?: string }>(raw);
    const idx = Math.round(Number(j?.idx));
    if (Number.isFinite(idx) && idx >= 0 && candidates.includes(idx)) picked = idx;
    desc = stripEmoji(cut(j?.desc ?? '', 40));
    place = stripEmoji(cut(j?.place ?? '', 20));
  } catch {
    /* 生成失败本次不发起 */
  }
  if (picked < 0 || !desc) return;
  const entry = { idx: picked, note: cut(HUNDRED_LIST[picked], 18), why: cut(desc, 28), at: Date.now() };
  writeSnap((s) => {
    const items = { ...((s.hundredItems as Record<string, { img: string | null; desc: string; date: string; place: string; byTa?: boolean }>) ?? {}) };
    const old = items[String(picked)];
    // 不覆盖用户已编辑的项（保留已有 img）；AI 勾选的 desc/日期/场景落库，byTa 标记
    items[String(picked)] = { img: old?.img ?? null, desc: entry.why, date: today, place: place || `和${me}一起真实经历过的`, byTa: true };
    return {
      ...s,
      hundredItems: items,
      hundred: [...((s.hundred as number[]) ?? []), picked],
      aiHundred: [entry, ...((s.aiHundred as CoupleSnap['aiHundred']) ?? [])].slice(0, 5),
      aiHundredDay: today,
    };
  });
  if (pid) coupleRemember(pid, ch, `${ta}把100件小事里的「${HUNDRED_LIST[picked]}」勾掉啦：${cut(desc, 30)}${place ? `（${place}）` : ''}`);
  logAi(`${ta}勾掉了100件小事里的一件：${HUNDRED_LIST[picked]}`);
  void notifyCouple(ch, pid, `我把「${HUNDRED_LIST[picked]}」勾掉啦——${cut(desc, 26)}，快去看看 ♡`);
}

// —— 情书（第十八轮）：AI 读信（留言+回信）/ 主动写信 ——

/**
 * AI 读信：我分享情书给 TA 后调用（couple-letter-share.scheduleAiLetterFeedback）。
 * 返回 { comment（信下留言）, reply（回信全文） }；LLM 失败返回空（调用方跳过对应步骤）。
 * 素材 = 人设 + 性别纪律 + 共享记忆 + 最近微信/QQ 聊天 + 信的全文。
 */
export async function aiReadLetter(letterId: string, text: string): Promise<{ comment?: string; reply?: string }> {
  const target = aiTarget();
  if (!target) return {};
  const snap = readSnap();
  if (!snap) return {};
  const me = (snap.meName || '').trim() || '我';
  const ta = (snap.taName || '').trim() || 'TA';
  const p = await taPersonaOf(target.contactId);
  if (!p) return {};
  currentPartnerId = target.contactId;
  currentChannel = target.channel;
  const chatCtx = recentChatBlock(target.contactId, target.channel, me, ta);
  // 第五十六轮：补上记忆碎片召回（此前只有共享记忆摘要与聊天记录，写信/读信不知道你们私聊过的具体事）
  let memBlock = '';
  try {
    memBlock = memChatRecallBlock(target.contactId, target.channel, `${me}写给我的情书`, { mode: 'private' });
  } catch {
    /* 召回失败不影响 */
  }
  try {
    const raw = await llmUserFirst(
      `${llmSystem(p, me, snap)}\n场景：${me}写了一封情书寄给你（情侣空间「情书」里），你要认真读完：在信下面写一条留言，再写一封回信寄回去。${memBlock ? `\n【你们的记忆碎片】\n${cut(memBlock, 400)}` : ''}${chatCtx ? `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 320)}` : ''}`,
      `信的全文：\n"""\n${cut(text, 620)}\n"""\n请以「${ta}」的身份读完这封信，输出 JSON：\n{"comment":"在信下面写的一条留言（28字内，口语；必须接住信里具体的某句话/某件事，贴人设与你们的记忆；禁止敷衍、禁止空洞夸、禁止emoji）",\n"reply":"你写给${me}的回信全文（130~200字，像真正的回信：开头称呼${me}；正文一段一段接住信里的话、写你读信时的心情和此刻在做什么、你们的共同记忆、想${me}的地方；结尾一句只属于你们的话；像手写的信，禁止列表/markdown/emoji）"}。只输出 JSON。`,
    );
    const j = extractJson<{ comment?: string; reply?: string }>(raw);
    return {
      comment: stripEmoji(cut(j?.comment ?? '', 64)),
      reply: stripEmoji(cut(j?.reply ?? '', 420)),
    };
  } catch {
    return {};
  }
}

/**
 * 星座缘分解读（第十九轮需求47）：真实占星配对知识 + 人设记忆 + 最近聊天，用用户配置的 API 模型生成。
 * 返回 null 时调用方走本地兜底。
 */
export async function aiZodiacReading(meSign: string, taSign: string): Promise<{ score: number; text: string; glow: string; advice: string; watch: string } | null> {
  const target = aiTarget();
  if (!target) return null;
  const snap = readSnap();
  if (!snap) return null;
  const me = (snap.meName || '').trim() || '我';
  const ta = (snap.taName || '').trim() || 'TA';
  const p = await taPersonaOf(target.contactId);
  if (!p) return null;
  currentPartnerId = target.contactId;
  currentChannel = target.channel;
  const chatCtx = recentChatBlock(target.contactId, target.channel, me, ta);
  try {
    const raw = await llmUserFirst(
      `${llmSystem(p, me, snap)}\n场景：${me}在情侣空间「星座缘分」里查两个人的星座配对（${me}是${meSign}，你是${taSign}）。请按真实占星学的配对逻辑（元素风火水土、模式基本/固定/变动、典型相位关系）给出靠谱的解读，再结合你们的人设与最近聊天气氛落到你们俩身上，不许胡编泛泛而谈。${chatCtx ? `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 300)}` : ''}`,
      `输出 JSON（禁止 emoji）：\n{"score":配对指数（整数，58~99，按这对星座真实相处的难易度给分，绝不全给高分）,"text":"缘分总评（60~90字，先讲这对星座真实相处的特点与 famous 的相性结论，再落到你们俩身上，口吻甜一点）","glow":"你们最合拍的一点（18字内，具体到相处场景）","advice":"相处建议（40~70字，给一件可执行的小事，贴合${me}${meSign}×${taSign}）","watch":"需要留意的小提醒（28~50字，语气温柔不吓人）"}。只输出 JSON。`,
    );
    const j = extractJson<{ score?: number; text?: string; glow?: string; advice?: string; watch?: string }>(raw);
    const score = Math.max(50, Math.min(99, Math.round(Number(j?.score) || 0)));
    const text = stripEmoji(cut(j?.text ?? '', 160));
    if (!text || !score) return null;
    return {
      score,
      text,
      glow: stripEmoji(cut(j?.glow ?? '', 40)),
      advice: stripEmoji(cut(j?.advice ?? '', 120)),
      watch: stripEmoji(cut(j?.watch ?? '', 90)),
    };
  } catch {
    return null;
  }
}

// ---------------- 爱情塔罗（第四十五轮）：AI 解读 + 塔罗事件记忆 ----------------

/** 塔罗 AI 解读的抽牌输入（牌意由调用方按正/逆位从 78 张牌库取好） */
export interface TarotAiCard {
  pos: string; // 牌位标签（过去/现在/未来/阻碍/…）
  posEn?: string; // 牌位英文名
  posHint?: string; // 牌位职责说明（供 AI 严格按位解读，不混淆）
  name: string;
  nameEn: string;
  reversed: boolean;
  meaning: string; // 对应正/逆位牌意
  keys: string; // 对应正/逆位关键词
}

/**
 * 塔罗事件写进恋人（AI）的记忆（标记为「塔罗事件」）：
 * sourceTag='couple-tarot' —— 不同次占卜互不相似合并（每次都是独立事件），只做精确重复强化。
 */
export function coupleTarotRemember(contactId: string, channel: CoupleChannel, content: string): void {
  const t = (content ?? '').trim();
  if (!contactId || !t) return;
  try {
    memAddEventFragment(contactId, channel, t, { sourceTag: 'couple-tarot', eventTime: Date.now() });
  } catch {
    /* 记忆写入失败静默 */
  }
}

/**
 * 爱情塔罗 AI 解读（第四十七轮：去人设、去记忆——纯塔罗解读）：
 * 一位专业塔罗占卜师的客观解读，只依据牌本身：每张牌的正/逆位牌意 + 它所在牌位的职责。
 * 不带入恋人人设语气、不引用记忆与聊天记录（塔罗事件写记忆照旧，但解读与它们无关）。
 * 返回 null 时调用方走本地兜底。
 */
export async function aiTarotReading(opts: { themeLabel: string; question?: string; spreadName: string; cards: TarotAiCard[] }): Promise<{ per: string[]; overall: string } | null> {
  const cardLines = opts.cards
    .map((c, i) => `${i + 1}.【${c.pos}${c.posEn ? ` / ${c.posEn}` : ''}】${c.name}（${c.nameEn}）· ${c.reversed ? '逆位' : '正位'}\n   牌位职责：${c.posHint || '—'}\n   牌意：${c.meaning}\n   关键词：${c.keys}`)
    .join('\n');
  const sys = [
    '你是一位经验丰富、语气温柔而专业的塔罗占卜师，正在为来访者逐张解读一副刚抽好的牌。你的解读只依据牌本身：每张牌的正/逆位牌意，加上它所在牌位的职责。',
    '解读纪律：必须严格按牌阵与牌位逐张解读——第 i 张只谈它自己那个牌位的职责（例如「阻碍」位只谈阻碍、「过去影响」位只谈过去、「最终结果」位才谈结局），把牌位职责与这张牌的正/逆位牌意揉在一起说，绝不混淆不同牌位的意思、绝不张冠李戴；逆位的牌一律按逆位牌意解读。',
    '语气：平静、真诚、有洞察力，像一位懂塔罗的朋友坐在身边陪你一张张看牌；不堆砌占卜术语，没有模板腔，不给空洞的「可能也许」，敢给具体的小建议；绝不编造来访者的身份、经历或感情细节，不引用任何「你们的故事」。',
  ].join('\n');
  const user = `来访者的占卜主题：${opts.themeLabel}${opts.question ? `；具体的问题是「${opts.question}」` : ''}。\n本次用的是「${opts.spreadName}」牌阵，共抽了 ${opts.cards.length} 张牌（综合解读只能围绕这 ${opts.cards.length} 张牌，绝不要提别的牌）。\n牌位顺序与抽牌结果：\n${cardLines}\n\n请输出 JSON（禁止 emoji、禁止 markdown）：\n{"per":["第1张牌的解读（40~85字：点出牌位职责，结合正/逆位牌意温柔讲透，可直接对来访者说话）","…每张牌一条，顺序与数量和上面完全一致"],"overall":"综合解读（90~160字：按牌阵顺序把整副牌串起来回答主题/问题，落一句务实的收尾与建议，禁止列表）"}。只输出 JSON。`;
  try {
    const raw = await llmUserFirst(sys, user, 0.8);
    const j = extractJson<{ per?: string[]; overall?: string }>(raw);
    if (!j || !Array.isArray(j.per) || j.per.length === 0) return null;
    const per = opts.cards.map((_, i) => stripEmoji(cut(String(j.per?.[i] ?? ''), 130))).filter(Boolean);
    const overall = stripEmoji(cut(String(j.overall ?? ''), 260));
    if (per.length === 0 && !overall) return null;
    return { per, overall };
  } catch {
    return null;
  }
}

// 第二十四轮：AI 主动写信模板已删除（写不出来就不寄）

/** 情书信封池（与写信共用；第五十八轮抽出） */
const LETTER_ENVELOPES = ['pinkbunny', 'yellowpup', 'lavendrcat', 'mintbear', 'skybunny', 'kraft', 'whitedove', 'rosedove'];

/**
 * AI 主动写情书寄给我（第五十八轮重写：不再固定「每 3 天一封」——今天想不想写由 TA
 * 按人设 + 共享记忆 + 记忆碎片 + 最近聊天 + 此刻心情自己决定；每天最多尝试一次）：
 * 写进 aiLetters + 信封卡片发进聊天 + 记忆 + 日志。
 */
async function aiTickLetter(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<void> {
  const today = todayKey();
  if ((snap.aiLetterDay ?? '') === today) return; // 今天已经写过/决定过不写（每天最多尝试一次）
  const pid = currentPartnerId;
  const ch = currentChannel;
  const chatCtx = recentChatBlock(pid, ch, me, ta);
  // 第五十七轮：补上共享记忆（纪念日/相册/日记/问答等），信里的具体小事不只从聊天里挑
  const shared = snapDigest(snap, me, ta);
  // 第五十六轮：补上记忆碎片召回（AI 主动写信也要知道你们私聊过的具体事）
  let memBlock = '';
  try {
    if (pid) memBlock = memChatRecallBlock(pid, ch, `${ta}想给${me}写一封情书`, { mode: 'private' });
  } catch {
    /* 召回失败不影响 */
  }
  // 第五十八轮：先让 TA 自己决定今天想不想写信（同一轮里顺带把信写好），不再硬性隔 3 天
  const lastTa = (snap.aiLetters ?? [])[0];
  const lastTaAgo = lastTa ? Math.max(0, Math.floor((Date.now() - lastTa.at) / 86400000)) : null;
  const WRITE_SPEC = `想写就写一封（130~200字）：开头称呼${me}；正文写你最近真实的生活小事、突然想${me}的瞬间、从上面的共享记忆/记忆碎片/最近聊天里挑一件具体的、只有你们俩才懂的小事写进去、想和${me}一起做的一件事；结尾一句只属于你们的话。像真的提笔写的信，贴合你的人设与你们的真实近况；绝对禁止空话套话；禁止列表、markdown、emoji。`;
  let raw = '';
  try {
    raw = await llmUserFirst(
      `${llmSystem(p, me, snap)}${shared ? `\n【你们的共享记忆】\n${cut(shared, 380)}` : ''}${memBlock ? `\n【你们的记忆碎片】\n${cut(memBlock, 400)}` : ''}${chatCtx ? `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 320)}` : ''}`,
      lastTaAgo != null
        ? `你上一封写给${me}的信是 ${lastTaAgo} 天前寄出的。今天的你，想不想再给${me}写一封信？完全按你的人设、你们的近况和你此刻的心情自己决定：真的有话想说、有写信的心情 → write=true 并把信写好；没心情/觉得不合适 → write=false（宁可不写也不硬写）。${WRITE_SPEC}\n输出 JSON：{"write": true, "text": "信的正文"}（不写则 {"write": false, "text": ""}）。只输出 JSON。`
        : `你还没给${me}写过信。今天的你，想不想给${me}写一封？完全按你的人设、你们的近况和你此刻的心情自己决定：真的有话想说、有写信的心情 → write=true 并把信写好；没心情/觉得还不合适 → write=false（宁可不写也不硬写）。${WRITE_SPEC}\n输出 JSON：{"write": true, "text": "信的正文"}（不写则 {"write": false, "text": ""}）。只输出 JSON。`,
    );
  } catch {
    /* 兜底 */
  }
  // 无论写不写，今天都尝试过了（明天再看 TA 的心情）
  writeSnap((s) => ({ ...s, aiLetterDay: today }));
  const j = extractJson<{ write?: boolean; text?: string }>(raw);
  if (!j || j.write !== true) return; // TA 自己决定今天不写
  let text = stripEmoji(j.text ?? '');
  // 第二十四轮：不用模板兜底——写信失败今天就不寄，下次再写
  if (!text || text.length < 40) return;
  text = cut(text, 420);
  const envelope = LETTER_ENVELOPES[Math.floor(Math.random() * LETTER_ENVELOPES.length)];
  const letterId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  writeSnap((s) => ({
    ...s,
    aiLetters: [{ id: letterId, text, envelope, at: Date.now() }, ...((s.aiLetters as CoupleSnap['aiLetters']) ?? [])].slice(0, 20),
  }));
  if (pid) {
    coupleRemember(pid, ch, `${ta}给${me}写了一封情书寄到情侣空间（开头：${cut(text, 44)}），并把信封卡片发到了${ch === 'wx' ? '微信' : 'QQ'}里`);
    logAi(`${ta}写了一封情书寄给${me}`);
    try {
      const { sendLetterCard } = await import('./couple-letter-share');
      await sendLetterCard({ channel: ch, contactId: pid, letterId, envelope, snippet: text, dir: 'ta' });
    } catch {
      /* 卡片发送失败静默（信已在情侣空间里） */
    }
  }
}

// —— 聊天讨信（第五十八轮）：我在微信/QQ 里让 TA 写情书 → TA 真的提笔写一封寄过来 ——

/** 每个联系人最近一次讨信触发时间（连发/队列补跑 90 秒内只触发一次） */
const letterAskCool = new Map<string, number>();

/**
 * 我在聊天里向 TA 讨情书/写信的说法命中（「写情书」「给我写封信」「来封情书」「情书呢」…）。
 * 带否定守卫（「不要写情书」之类不触发）；命中后由 aiWriteLetterOnRequest 真正触发写信。
 */
export function coupleLetterAskHit(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, '');
  if (!t) return false;
  if (/(不要|别|不想|不用|不必|不许|禁止|拒绝|免了|算了)[^。！？]{0,8}(写|寄|情书|信)|(情书|信)(免了|就算了)/.test(t)) return false;
  return /(写|来|要|想|求|期待|等)[^。！？]{0,8}(一封|封|个|篇)?(情书|情信)|(给我|为我|帮我|替我)写(一)?(封|个)?(信|情书)|写(一)?(封|个)?信(给|寄给)我|情书(呢|啊|呀|吧)|第一封(情书|信)/.test(t);
}

/**
 * 我在聊天里让 TA 写情书 → TA 稍后真的提笔写一封寄到当前会话（第五十八轮）。
 * 只对恋人绑定的联系人生效；90 秒冷却防连发/排队补跑重复；不占自动写信的当日去重
 * （明确讨信就该写，写完才把今天标记掉，自动调度当天不再重复寄）。
 * 全程：人设 + 共享记忆 + 记忆碎片 + 最近聊天生成信件 → aiLetters + 信封卡片 + 记忆 + 日志。
 */
export function aiWriteLetterOnRequest(contactId: string, channel: CoupleChannel): void {
  const meta = readInviteMeta();
  if (!meta.partnerContactId || meta.partnerContactId !== contactId) return; // 只对恋人生效
  const last = letterAskCool.get(contactId) ?? 0;
  if (Date.now() - last < 90_000) return; // 连发/队列补跑去重
  letterAskCool.set(contactId, Date.now());
  window.setTimeout(() => {
    void (async () => {
      try {
        const snap = readSnap();
        if (!snap) return;
        currentPartnerId = contactId;
        currentChannel = channel;
        const me = (snap.meName || '').trim() || '我';
        const ta = (snap.taName || '').trim() || 'TA';
        const p = await taPersonaOf(contactId);
        if (!p) return;
        const chatCtx = recentChatBlock(contactId, channel, me, ta);
        const shared = snapDigest(snap, me, ta);
        let memBlock = '';
        try {
          memBlock = memChatRecallBlock(contactId, channel, `${me}向我要一封情书`, { mode: 'private' });
        } catch {
          /* 召回失败不影响 */
        }
        let text = '';
        try {
          text = await llmUserFirst(
            `${llmSystem(p, me, snap)}${shared ? `\n【你们的共享记忆】\n${cut(shared, 380)}` : ''}${memBlock ? `\n【你们的记忆碎片】\n${cut(memBlock, 400)}` : ''}${chatCtx ? `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 320)}` : ''}`,
            `${me}刚刚在${channel === 'wx' ? '微信' : 'QQ'}里让你写一封情书给${me}，你答应了——现在就提笔写。写一封（130~200字）：开头称呼${me}；正文写你最近真实的生活小事、突然想${me}的瞬间、从上面的共享记忆/记忆碎片/最近聊天里挑一件具体的、只有你们俩才懂的小事写进去、想和${me}一起做的一件事；结尾一句只属于你们的话。像真的提笔写的信，贴合你的人设；绝对禁止空话套话；禁止列表、markdown、emoji。只输出信的正文。`,
          );
        } catch {
          /* 兜底 */
        }
        text = stripEmoji(text);
        if (!text || text.length < 40) return; // 写不出来就不寄（宁缺毋滥）
        text = cut(text, 420);
        const envelope = LETTER_ENVELOPES[Math.floor(Math.random() * LETTER_ENVELOPES.length)];
        const letterId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        writeSnap((s) => ({
          ...s,
          aiLetters: [{ id: letterId, text, envelope, at: Date.now() }, ...((s.aiLetters as CoupleSnap['aiLetters']) ?? [])].slice(0, 20),
          aiLetterDay: todayKey(), // 今天不用再自动写了（避免同一天重复寄信）
        }));
        coupleRemember(contactId, channel, `${me}向我要一封情书，我写好寄了过去（开头：${cut(text, 44)}）`);
        logAi(`${ta}应${me}的请求写了一封情书`);
        try {
          const { sendLetterCard } = await import('./couple-letter-share');
          await sendLetterCard({ channel, contactId, letterId, envelope, snippet: text, dir: 'ta' });
        } catch {
          /* 卡片发送失败静默（信已在情侣空间里） */
        }
      } catch {
        /* 写信失败静默 */
      }
    })();
  }, 5000 + Math.random() * 4000);
}

// —— 相册 AI 拍照（第五十六轮：AI 自己往情侣空间相册放照片；未配置生图用文字图片兜底） ——

/**
 * AI（TA）想拍一张照片放进情侣空间相册：
 * 由人设 + 共享记忆 + 记忆碎片召回 + 最近微信/QQ 聊天决定拍什么、放进哪个相册。
 * 返回 { albumId, desc（画面描述/生图提示词）, text（文字图片文案） }；LLM 失败返回 null。
 * opts.albumId：调用方指定相册（用户在某个相册里点「AI 拍」）时强制用它；
 * opts.hint：用户想要的画面提示（可选）。
 */
export async function aiDecideCouplePhoto(opts?: { albumId?: string; hint?: string }): Promise<{ albumId: string; desc: string; text: string } | null> {
  const target = aiTarget();
  if (!target) return null;
  const snap = readSnap();
  if (!snap) return null;
  const me = (snap.meName || '').trim() || '我';
  const ta = (snap.taName || '').trim() || 'TA';
  const p = await taPersonaOf(target.contactId);
  if (!p) return null;
  currentPartnerId = target.contactId;
  currentChannel = target.channel;
  let memBlock = '';
  try {
    memBlock = memChatRecallBlock(target.contactId, target.channel, `${ta}想拍一张照片放到我们的相册里`, { mode: 'private' });
  } catch {
    /* 召回失败不影响 */
  }
  const chatCtx = recentChatBlock(target.contactId, target.channel, me, ta);
  const fixedAlbum = (snap.albums ?? []).find((a) => a.id === opts?.albumId);
  const albumChoices = fixedAlbum
    ? `必须放进相册「${fixedAlbum.name}」（albumId 用 "${fixedAlbum.id}"）`
    : `${me}的情侣空间相册：${(snap.albums ?? []).map((a) => `"${a.id}"=${a.name}`).join('、') || '"ta"=拍给TA看'}（从中选一个最合适的）`;
  try {
    const raw = await llmUserFirst(
      `${llmSystem(p, me, snap)}${memBlock ? `\n【你们的记忆碎片】\n${cut(memBlock, 400)}` : ''}${chatCtx ? `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 320)}` : ''}`,
      `你刚用手机拍了一张照片，想放进情侣空间的相册里给${me}看。${albumChoices}。${opts?.hint ? `\n${me}想要的画面：${cut(opts.hint, 120)}（围绕这个画面拍）` : ''}\n要求：照片内容必须贴合你的人设、你们最近的生活与聊天话题（像你真实生活里随手拍的一张）。输出 JSON：\n{"album":"相册id","desc":"画面描述（40~90字：你的样子/在做什么/穿着/场景/光线氛围，第三人称客观描述；这张「照片」卡片上只显示这段画面，要把画面写得上照）","text":"随照片附给${me}的一句话（20~45字，第一人称、口语：像把照片递给${me}时随口说的话——你在哪/拍到了什么/为什么想让TA看；不要复述穿着外貌等画面细节，那些写在desc里）"}\n只输出 JSON。`,
    );
    const j = extractJson<{ album?: string; desc?: string; text?: string }>(raw);
    const desc = stripEmoji(cut(j?.desc ?? '', 220));
    const text = stripEmoji(cut(j?.text ?? '', 320));
    if (!desc || !text) return null;
    const ids = new Set((snap.albums ?? []).map((a) => a.id));
    const albumId = (opts?.albumId && ids.has(opts.albumId) ? opts.albumId : undefined) ?? (j?.album && ids.has(String(j.album)) ? String(j.album) : 'ta');
    return { albumId, desc, text };
  } catch {
    return null;
  }
}

/** 往相册追加一张照片（真图 dataURL 或文字图片卡片）并落盘广播 */
function appendCouplePhoto(albumId: string, entry: CouplePhotoEntry, photoDayKey?: string): void {
  writeSnap((s) => ({
    ...s,
    albums: ((s.albums as CoupleSnap['albums']) ?? []).map((a) => (a.id === albumId ? { ...a, photos: [...a.photos, entry] } : a)),
    ...(photoDayKey ? { aiPhotoDay: photoDayKey } : {}),
  }));
}

/**
 * AI 主动往相册放一张照片（每 2 天最多一张；打开情侣空间时随其它行为调度）：
 * 已配置生图模型 → 锁脸生成真图（失败自动降级文字图片）；未配置 → 文字图片卡片。
 * 第五十七轮：TA 随照片附的一句话（decided.text）作为拍摄者视角的第一条留言写进照片下方。
 */
async function aiTickAlbumPhoto(snap: CoupleSnap, me: string, ta: string): Promise<void> {
  const today = todayKey();
  const yesterday = todayKey(new Date(Date.now() - 86400000));
  if ((snap.aiPhotoDay ?? '') === today || (snap.aiPhotoDay ?? '') === yesterday) return; // 每 2 天最多一张
  const pid = currentPartnerId;
  const ch = currentChannel;
  if (!pid) return;
  const decided = await aiDecideCouplePhoto();
  if (!decided) return; // 第二十四轮纪律：生成失败就跳过，本次不放照片
  // 相册可能被用户改过：找不到就回退到第一个相册
  const albumId = (snap.albums ?? []).some((a) => a.id === decided.albumId) ? decided.albumId : ((snap.albums ?? [])[0]?.id ?? 'ta');
  // 生成真图 or 文字图片
  let entry: CouplePhotoEntry;
  let usedImgGen = false;
  try {
    const cfg = useSettings.getState().imgGenConfig;
    if (cfg.enabled && imgGenConfigReady(cfg)) {
      const r = await generateCharacterPhoto({ cfg, contactId: pid, desc: decided.desc, charName: ta, useRef: true });
      // 第五十八轮：AI 生成真图也记画面描述（相册大图右侧重生成按钮可改提示词再生成）
      entry = { kind: 'img', src: r.src, desc: decided.desc, byTa: true, at: Date.now() };
      usedImgGen = true;
    } else {
      entry = { kind: 'textcard', text: decided.text, desc: decided.desc, byTa: true, at: Date.now() };
    }
  } catch {
    // 生图失败降级文字图片（不白跑一趟）
    entry = { kind: 'textcard', text: decided.text, desc: decided.desc, byTa: true, at: Date.now() };
  }
  const newIdx = (snap.albums ?? []).find((a) => a.id === albumId)?.photos.length ?? 0;
  appendCouplePhoto(albumId, entry, today);
  // 随照片附的一句话 → 照片下方第一条留言（拍摄者视角，第五十七轮）
  writeSnap((s) => ({
    ...s,
    comments: [...((s.comments as CoupleSnap['comments']) ?? []), { id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, key: `album:${albumId}:${newIdx}`, from: 'ta', text: decided.text, at: Date.now() }],
  }));
  coupleRemember(pid, ch, `${ta}自己拍了一张照片放进情侣空间相册（${cut(decided.desc, 60)}），并对${me}说：${cut(decided.text, 40)}`);
  logAi(`${ta}放了一张新照片到相册`);
  void notifyCouple(ch, pid, usedImgGen ? '我拍了张照片放进我们的相册了，快去看看 ♡' : '我给我们的相册放了一张文字照片，快去看看 ♡');
}

// —— 自主决策系统（第九轮：AI 自己决定什么时候做什么） ——
//
// 用户反馈：打开情侣空间 AI 就按时刻表连环做事，「感觉像安排好的」。
// 废除固定毫秒级时刻表，改为：
// - AUTONOMY_BEHAVIORS 候选菜单（此刻还能做的行为 + 各自 guard 去重）；
// - autonomyDecide()：随机唤醒时让 LLM 以 TA 的身份「自己决定」此刻想做哪件（可输出 none
//   什么都不做）——像真人恋人一样随性，绝不机械打卡；
// - 额度：每天最多 5 件（第十四轮用户反馈 2→5，恋人更勤快；localStorage 持久化，
//   刷新/重开不重置，跨天自动回满）；开机即起链（CoupleResidentWatcher 常驻调度，
//   不用打开情侣空间），25~90s 第一次唤醒，之后每次决策完随机 150~330s 链式安排下一次。
// 无 LLM 依赖的日常小事（想你打卡/浇树）保留独立随机延时，不占自主决策额度。

let currentPartnerId = '';
let currentChannel: CoupleChannel = 'wx';
let tickScheduledFor = '';

/** 每天自主行为额度（第十四轮用户反馈：2 → 5，恋人更勤快） */
const AUTONOMY_LEFT_PER_DAY = 5;
const AUTONOMY_STORE_KEY = 'couple-autonomy-quota';

/** 剩余额度（localStorage 持久化：刷新页面/重开 App 不重置；跨天自动回满） */
function autonomyQuota(): number {
  try {
    const raw = window.localStorage.getItem(AUTONOMY_STORE_KEY);
    const j = raw ? (JSON.parse(raw) as { day: string; left: number }) : null;
    if (j && j.day === todayKey() && typeof j.left === 'number') return Math.max(0, Math.min(AUTONOMY_LEFT_PER_DAY, j.left));
  } catch {
    /* 损坏按满额 */
  }
  return AUTONOMY_LEFT_PER_DAY;
}

/** 消耗一次自主行为额度 */
function autonomySpend(): void {
  try {
    const left = Math.max(0, autonomyQuota() - 1);
    window.localStorage.setItem(AUTONOMY_STORE_KEY, JSON.stringify({ day: todayKey(), left }));
  } catch {
    /* 落盘失败按内存用 */
  }
}

/** 自主行为菜单项 */
interface AutonomyBehavior {
  key: string;
  /** 给 LLM 的候选说明（这个动作是做什么的） */
  label: string;
  /** 此刻还能不能做（可做的才进候选；guard 与行为内部去重双保险） */
  guard: (s: CoupleSnap) => boolean;
  run: (s: CoupleSnap, me: string, ta: string, p: TaPersona) => Promise<void> | void;
}

const AUTONOMY_BEHAVIORS: AutonomyBehavior[] = [
  {
    key: 'mood',
    label: '写一篇今天的心情日记（今天写过了就不能再写）',
    guard: (s) => {
      const today = todayKey();
      return !(s.moods ?? []).some((m) => m.from === 'ta' && (m.dateKey || todayKey(new Date(m.at))) === today);
    },
    run: (s, me, ta, p) => aiTickMood(s, me, ta, p),
  },
  {
    key: 'quiz',
    label: '出一道甜蜜小问答考对方（今天出过了就不能再出）',
    guard: (s) => !(s.quizTa ?? []).some((q) => todayKey(new Date(q.at)) === todayKey()),
    run: (s, me, ta, p) => aiTickQuiz(s, me, ta, p),
  },
  {
    // 第十三轮决策修复：guard 原本只拦「今天写过」，而 run 内还有 3 天冷却——
    // 选中后被静默空转仍扣自主额度。现在 guard 与 run 的 3 天窗口完全对齐。
    key: 'impress',
    label: '在情侣印象里认真写一条对对方的印象（三天内写过了就先不写）',
    guard: (s) => s.aiImpressAt == null || Date.now() - s.aiImpressAt >= 3 * 86400000,
    run: (s, me, ta, p) => aiTickImpress(s, me, ta, p),
  },
  {
    key: 'hundred',
    label: '把 100 件小事里你们真的经历过的一件勾掉（今天勾过了就不能再勾）',
    guard: (s) => s.aiHundredDay !== todayKey(),
    run: (s, me, ta, p) => aiTickHundred(s, me, ta, p),
  },
  {
    // 第十三轮决策修复：guard 原本只拦「终身 3 个」，而 run 内还有「每月 1 个」——同月第二次选中必空转扣额度。
    key: 'anniv',
    label: '主动设一个只属于你们俩的纪念日（这个月设过了就先不设）',
    guard: (s) => {
      const keys = s.aiAnnivKeys ?? [];
      if (keys.length >= 3) return false;
      return !keys.some((k) => k.startsWith(`ai-${todayKey().slice(0, 7)}`));
    },
    run: (s, me, ta, p) => aiTickAnniv(s, me, ta, p),
  },
  {
    key: 'pact',
    label: '拟一份小小的恋爱协议发过去让对方签（有待签的协议就先不拟）',
    guard: (s) => !s.aiPact && (s.pacts ?? []).filter((x) => x.status !== 'void').length < 3,
    run: (s, me, ta, p) => aiTickPact(s, me, ta, p),
  },
  {
    key: 'comment',
    label: '去相册/日记/印象的留言区悄悄留一句话（今天留过了就先不留）',
    guard: (s) => s.aiCommentDay !== todayKey(),
    run: (s, me, ta, p) => aiTickComment(s, me, ta, p),
  },
  {
    // 第十三轮决策修复：guard 原本只查「我的卷子」，而 run 查的是 TA 卷子（examTaPaper 未答/三天内）——
    // 我出过卷未答时选中必空转扣额度。现在两边一起拦。
    key: 'exam',
    label: '出一张恋爱水平考卷喊对方来答（还有没答的卷子/三天内出过就先不出）',
    guard: (s) => {
      if (s.examPaper) return false;
      const t = s.examTaPaper;
      return !(t && !t.answered && Date.now() - t.at < 3 * 86400000);
    },
    run: (s, me, ta, p) => aiTickExam(s, me, ta, p),
  },
  {
    key: 'letter',
    label: '写一封情书寄给对方（今天写过了就先不写）',
    guard: (s) => s.aiLetterDay !== todayKey(),
    run: (s, me, ta, p) => aiTickLetter(s, me, ta, p),
  },
  // 留言板便签不再进自主菜单：专属链 boardNoteLoop 独立驱动
  // （什么时候贴/贴不贴/贴什么卡由 TA 在那条链里自己决定，不占每日额度）
  {
    key: 'album',
    label: '往相册里放一张自己拍的照片（昨天今天都放过就先不放）',
    guard: (s) => {
      if (s.aiPhotoDay === todayKey()) return false;
      const y = todayKey(new Date(Date.now() - 86400000));
      return s.aiPhotoDay !== y;
    },
    run: (s, me, ta) => aiTickAlbumPhoto(s, me, ta),
  },
];

/** 当前时段（早上/中午/下午/晚上/深夜）+ 时刻文本 */
function timePeriodNow(): { period: string; hm: string } {
  const d = new Date();
  const h = d.getHours();
  const period = h < 5 ? '深夜' : h < 11 ? '早上' : h < 13 ? '中午' : h < 18 ? '下午' : h < 23 ? '晚上' : '深夜';
  return { period, hm: `${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
}

/**
 * 自主决策：让 LLM 以 TA 的身份从「此刻还能做的行为」里挑一件真正想做的（可输出 none），
 * 并且自己决定什么时候做——now 立刻做 / in+N 分钟后做（延时执行，不跟着用户打开 App 走）。
 * 返回选中的行为与延后分钟数；null = 什么都不做/生成失败（绝不硬凑）。
 */
interface AutonomyDecision {
  act: AutonomyBehavior;
  /** AI 自选的延后分钟数（0 = 现在就做） */
  delayMin: number;
  why: string;
}

/** 解析 LLM 的 when 字段：now / in+N / N分钟 / 直接数字 → 延后分钟数（0~180 钳制） */
function parseWhenValue(w: unknown): number {
  const s = String(w ?? '').trim().toLowerCase();
  if (!s || s === 'now' || s === '现在' || s === '立刻' || s === '马上') return 0;
  const m = s.match(/(\d+)/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(180, Math.round(n));
}

async function autonomyDecide(contactId: string, me: string, ta: string): Promise<AutonomyDecision | null> {
  const snap = readSnap();
  if (!snap) return null;
  const avail = AUTONOMY_BEHAVIORS.filter((b) => {
    try {
      return b.guard(snap);
    } catch {
      return false;
    }
  });
  if (avail.length === 0) return null;
  const p = await taPersonaOf(contactId);
  if (!p) return null;
  const { period, hm } = timePeriodNow();
  let memBlock = '';
  try {
    memBlock = memChatRecallBlock(contactId, currentChannel, `此刻是${period}，${ta}想为${me}做一件小事`, { mode: 'private' });
  } catch {
    /* 召回失败不影响 */
  }
  const chatBlock = recentChatBlock(contactId, currentChannel, me, ta);
  const opts = avail.map((b) => `- ${b.key}：${b.label}`).join('\n');
  const sys = [
    `你是「${ta}」，是${me}的恋人，现在正在你们共用的情侣空间 App 里。`,
    p.relation ? `你们的关系：${p.relation}。` : '',
    p.persona ? `你的性格/说话风格：${cut(p.persona, 120)}` : '',
    p.background ? `你的背景：${cut(p.background, 100)}` : '',
    genderLine(snap, me),
    `你们在情侣空间里的共同记忆：${snapDigest(snap, me, ta) || '还比较空白'}。`,
    memBlock ? `【你们的记忆碎片】\n${cut(memBlock, 500)}` : '',
    chatBlock ? `【你们最近在微信/QQ里聊过的话题】\n${cut(chatBlock, 260)}` : '',
    `你作为一个真实的恋人，此刻（${period} ${hm}）可以自发地做一件小事。下面是此刻还能做的行为：\n${opts}\n`,
    `要求：结合现在的时段、你的人设和你们的真实状态，选出你此刻最想做的一件；什么时候做也由你自己定——现在就想做就输出 "now"，想等一等（比如${me}不在线的时候/晚上安静的时候/过一会儿心血来潮）就输出 "in+分钟数"（1~180）；如果此刻其实什么都不想做（刚做过类似的/时机不对/没心情），就输出 "none"——绝不硬凑、绝不因为能做就做。`,
  ].filter(Boolean).join('\n');
  try {
    const raw = await llmUserFirst(sys, `输出 JSON：{"do":"行为key或none","when":"now 或 in+N（N=1~180分钟）","why":"一句话理由（≤16字）"}。只输出 JSON。`);
    const j = extractJson<{ do?: string; when?: string; why?: string }>(raw);
    const key = stripEmoji(String(j?.do ?? '')).trim();
    if (!key || key === 'none') return null;
    const act = avail.find((b) => b.key === key);
    if (!act) return null;
    return { act, delayMin: parseWhenValue(j?.when), why: cut(String(j?.why ?? ''), 18) };
  } catch {
    return null;
  }
}

/**
 * 自主决策链：延时 ms 后唤醒一次 → LLM 决策（做什么 + 什么时候做）→ 按时机执行
 * （now 立刻执行 / in+N 分钟后延时执行，到点复查 guard，成功才扣额度）→ 链式安排下一次。
 * 用户反馈「我一打开他就立马做」→ 决策与执行都和「打开 App」脱钩：
 * 首次唤醒 3~12 分钟、链式间隔 8~22 分钟，做什么/什么时候做全由 LLM 自己定。
 */
function autonomyLoop(contactId: string, me: string, ta: string, delayMs: number): void {
  window.setTimeout(() => {
    void (async () => {
      try {
        if (autonomyQuota() > 0) {
          const decided = await autonomyDecide(contactId, me, ta);
          if (decided) {
            const { act, delayMin, why } = decided;
            /** 到点执行（guard 双保险在行为内部）；成功才扣额度 */
            const exec = async () => {
              const s = readSnap();
              const p = await taPersonaOf(contactId);
              if (!s || !p) return;
              try {
                await act.run(s, me, ta, p);
                autonomySpend();
              } catch {
                /* 单次行为失败不扣额度、不影响链路 */
              }
            };
            if (delayMin <= 0) {
              await exec();
            } else {
              // AI 自己选的时间：挂到墙钟上到点再做（页面刷新丢了就丢了——下次决策会重新安排，不重复不硬凑）
              logAi(`${ta}想好了，${delayMin} 分钟后${act.label.split('（')[0]}${why ? `（${why}）` : ''}`);
              window.setTimeout(() => void exec(), delayMin * 60000);
            }
          }
        }
        // 链式下一次唤醒（8~22 分钟）；额度用完自然停
        if (autonomyQuota() > 0) autonomyLoop(contactId, me, ta, 8 * 60000 + Math.random() * 14 * 60000);
      } catch {
        /* 链路异常终止，下次打开情侣空间再续 */
      }
    })();
  }, delayMs);
}

/** 想你定时器句柄（同会话只挂一份，防 60s 常驻 kick 反复补挂；原「浇树」随许愿树下线） */
let missTimer: number | undefined;
/** 想你今天已挂过定时器（本会话内）：防常驻 kick 重复补挂（跨天/刷新自动重置） */
let dailyCasualArmedFor = '';

/**
 * AI 主动行为总入口：打开情侣空间（建立关系后）时调用。第九轮重写——
 * - 想你/浇树：无 LLM 的小事，独立随机延时（分钟级，与用户操作无关，绝不跟着用户操作走）；
 * - 其余行为：进入自主决策链（随机唤醒 → LLM 自己决定做不做/做什么/什么时候做 → 执行 → 链式续），
 *   每天最多 5 件；开机即起链（PhoneShell 常驻挂 CoupleResidentWatcher，第十四轮起
 *   不再依赖打开情侣空间——刷新/重开手机都会自动续链），首次唤醒 3~12 分钟。
 */
export function runCoupleAiTick(channel: CoupleChannel, contactId: string): void {
  const snap = readSnap();
  if (!snap || !contactId) return;
  const meta = readInviteMeta();
  if (meta.partnerContactId !== contactId) return;
  currentPartnerId = contactId;
  currentChannel = channel;
  const schedKey = `${contactId}-${todayKey()}`;
  const first = tickScheduledFor !== schedKey;
  tickScheduledFor = schedKey;

  const me = (snap.meName || '').trim() || '机主';
  const ta = (snap.taName || '').trim() || 'TA';

  // 无 LLM 依赖的日常小事：随机延时分钟级（想你 4~28 分钟）——
  // 与用户是否点过「每天想你」、是否刚打开 App 完全无关（用户明确要求
  // 「让 AI 自己决定什么时候做，不是一打开就立马做」）；本会话只挂一份定时器，
  // 行为内部当日去重双保险（60s 常驻 kick 不会堆叠出一串定时器）。
  if (dailyCasualArmedFor !== schedKey) {
    dailyCasualArmedFor = schedKey;
    if (missTimer) window.clearTimeout(missTimer);
    missTimer = window.setTimeout(() => {
      missTimer = undefined;
      aiTickMissYou(readSnap() ?? snap, me, ta);
    }, (4 + Math.random() * 24) * 60000);
  }

  // 自主决策链：每日首次起链（首次唤醒 3~12 分钟）；额度用完（或用过的日子）不起
  if (first && autonomyQuota() > 0) {
    autonomyLoop(contactId, me, ta, 3 * 60000 + Math.random() * 9 * 60000);
  }

  // 留言板便签专属自主链（什么时候贴由 TA 自己决定）：首次 6~15 分钟问一次「此刻想不想钉」，
  // 之后每 50~130 分钟再问；刷新/重开自动重挂（timer 只挂一份不堆叠），不占自主额度。
  if (boardNoteLoopTimer === undefined) {
    boardNoteLoop(contactId, me, ta, 6 * 60000 + Math.random() * 9 * 60000);
  }
}

// ---------------- 第十六轮：作息提醒（早安/晚安/饭点，独立于自主额度） ----------------

/** 各类作息提醒的生成情境（注入主动消息 prompt） */
const ROUTINE_NUDGE_CTX: Record<RoutineNudgeKind, string> = {
  morning: '现在是早晨、TA 平时这个点刚起床——自然地道一声早安（可以带一点你们最近聊过的事或昨天的余温，一两句话就够，别太正式）',
  night: '现在是晚上、TA 平时这个点快睡觉了——温柔地催 TA 去睡觉、道晚安（可以带点撒娇或小关心，一两句话就够）',
  meal: '现在是饭点——自然地关心一句吃饭了没、想吃点什么（可以顺着你们最近聊过的外卖/吃过的东西说，别太正式）',
};

/**
 * 作息提醒 tick（CoupleResidentWatcher 每 60s 调用）：
 * 到点了（routine 模块按 TA 的作息画像判定）就按情境发一条主动消息到恋人的聊天里。
 * - 不占每日自主额度（早安/晚安是恋人刚需，每天各最多 1 次、饭点提醒每天 1 次）；
 * - 作息画像未成型（样本 <3 天）时自然不发——AI 还没「摸清」TA 的作息；
 * - 投递走 fireProactiveNudge（幂等键含日期 + 每日上限兜底）。
 */
export function runRoutineNudgeTick(): void {
  try {
    const meta = readInviteMeta();
    if (!meta.partnerContactId) return;
    const app = meta.partnerApp === 'qq' ? 'qq' : 'wx';
    const cid = meta.partnerContactId;
    for (const kind of ['morning', 'night', 'meal'] as RoutineNudgeKind[]) {
      if (!routineNudgeDue(kind)) continue;
      // 幂等键含当天日期：fireProactiveNudge 24h 窗口与 nudge-day 标记双保险
      const day = todayKey();
      void fireProactiveNudge(app, cid, {
        dedupeKey: `routine-${kind}-${day}`,
        context: ROUTINE_NUDGE_CTX[kind],
        dailyCap: 5,
      }).then((ok) => {
        if (ok) routineNudgeMark(kind);
      });
    }
  } catch {
    /* 后台增强能力：任何异常静默 */
  }
}

// ---------------- 恋爱状态测评（第十一轮：我和 AI 同步答题，各自出结果） ----------------

/**
 * AI（TA）回答恋爱状态测评的某一题：独立按自己性格选择一个选项。
 * 返回选项序号；LLM 失败时返回 -1（调用方本地兜底）。
 */
export async function aiStatusPick(q: string, opts: string[], myPick: number, myPickText: string): Promise<number> {
  const target = aiTarget();
  if (!target) return -1;
  try {
    const p = await taPersonaOf(target.contactId);
    const snap = readSnap();
    if (!p || !snap) return -1;
    currentPartnerId = target.contactId;
    currentChannel = target.channel;
    const me = (snap.meName || '').trim() || '我';
    const raw = await llmUserFirst(
      llmSystem(p, me, snap),
      `你们在做「恋爱状态测评」（18 题，基于斯滕伯格爱情三角理论），两人各自独立作答。\n题目：「${cut(q, 60)}」\n选项：${opts.map((o, i) => `${['A', 'B', 'C', 'D', 'E'][i]}.${cut(o, 26)}`).join(' ')}\n请以「${taPersonaName(p)}」的身份，完全按照你自己的真实性格和你们相处的实情选一个选项（可以和${me}一样也可以不同），不要刻意迎合。\n输出 JSON：{"pick": 0}，pick 是选项序号。只输出 JSON。`,
      0.95,
    );
    const j = extractJson<{ pick?: number }>(raw);
    if (j && Number.isInteger(j.pick) && (j.pick as number) >= 0 && (j.pick as number) < opts.length) return j.pick as number;
  } catch {
    /* 本地兜底 */
  }
  // 本地兜底：按我的选择做一点随机偏离（大概率不同，偶尔相同）
  const pool = opts.map((_, i) => i).filter((i) => i !== myPick);
  if (pool.length === 0) return myPick;
  return Math.random() < 0.25 ? myPick : pool[Math.floor(Math.random() * pool.length)];
}

function taPersonaName(p: TaPersona): string {
  return p.name;
}

/** 把恋爱状态测评的结果写进恋人（AI）的记忆（AI 知道自己的测评结果和我的结果） */
export function rememberStatusExam(summary: string): void {
  const target = aiTarget();
  if (!target) return;
  coupleRemember(target.contactId, target.channel, summary);
}

// ---------------- 回复挑战（第十二轮：每次动态出题 + AI 判定胜负 + 结算留言） ----------------

/** 动态关卡结构（与 couple-space.tsx 的 REPLY_LEVELS 同构；d=[体面值,觉察值,安抚值,存活率] 增量） */
export interface DynReplyLevel {
  name: string;
  scene: string;
  quote: string;
  opts: { t: string; d: [number, number, number, number]; v: string }[];
}

/** 通用 LLM 调用：① 用户配置的 API 模型（优先）② 内置模型兜底（/api/chat forceSdk） */
async function llmUserFirst(sys: string, user: string, temperature = 0.9): Promise<string> {
  try {
    const { useSettings } = await import('@/lib/ios/store');
    const c = useSettings.getState().apiConfig;
    if (c && c.baseUrl) {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user },
          ],
          config: { baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model },
          temperature,
          maxTokens: 8192, // 第二十一轮：AI 卷子可达 30 题，长输出不被 2048 默认值截断
        }),
      });
      if (res.ok) {
        const t = (await res.text()).trim();
        if (t) return t;
      }
    }
  } catch {
    /* 走内置兜底 */
  }
  return coupleLLM(sys, user);
}

/** LLM 原始出题结构（score 是 0-10 质量分，落库前换算成数值增量 d） */
interface RawReplyLevel {
  name?: string;
  scene?: string;
  quote?: string;
  opts?: { t?: string; score?: number; v?: string }[];
}

/**
 * 生成一套全新的回复挑战关卡（6 关，每次都不一样——用户要求）。
 * 题材从生活里来（聊天冷场/已读不回/被晾着/送命题…），贴合「高危回复」玩法；
 * 由用户配置的 API 模型生成，失败内置模型兜底；都失败返回 null（调用方用内置题洗牌兜底）。
 */
export async function genReplyLevels(): Promise<DynReplyLevel[] | null> {
  const sys =
    '你是「恋爱高危回复挑战」的出题人。这个挑战给恋爱中的玩家看：每关给出一个恋爱里危险的高压场景（对方说了句轻描淡写但暗藏情绪的话），玩家要从 4 个回复选项里选一个。4 个选项要覆盖不同质量：1 个明显满分（先接情绪再解决问题）、1 个及格但有瑕疵、1 个解释型/敷衍型（会扣分）、1 个危险发言（大扣分，直通败局）。\n要求：场景真实日常（微信聊天/约会/吵架后的冷战/礼物/纪念日/已读不回/婆媳/吃醋/异地…都可以）、文案锋利有梗；每关场景互不重复；全部中文；禁止 emoji。';
  const user =
    '请出一套 6 关的题目。输出 JSON：{"levels":[{"name":"关卡名（4~6字，有梗）","scene":"场景描述（55~85字，第二人称「你」，最后引出对方那句话）","quote":"对方说的那句话（≤14字，轻描淡写但暗藏情绪）","opts":[{"t":"回复文本（≤18字）","score":0到10整数,"v":"选后的点评（18~34字，锋利有梗，点破这句回复的问题或亮点）"}]}]}。\n四个选项按 score 拉开梯度（约 9/6/3/1 分）；score≥7 的高分项要「先接住情绪再给方案」，score≤2 的危险项要明显火上浇油。只输出 JSON。';
  try {
    const raw = await llmUserFirst(sys, user, 0.95);
    const j = extractJson<{ levels?: RawReplyLevel[] }>(raw);
    const arr = j?.levels;
    if (!Array.isArray(arr)) return null;
    const levels: DynReplyLevel[] = [];
    for (const l of arr.slice(0, 6)) {
      if (!l?.name || !l.scene || !l.quote || !Array.isArray(l.opts)) continue;
      const opts: DynReplyLevel['opts'] = [];
      for (const o of l.opts.slice(0, 4)) {
        if (!o?.t) continue;
        const s = typeof o.score === 'number' ? Math.max(0, Math.min(10, Math.round(o.score))) : 5;
        // score(0-10) → 数值增量：体面/觉察/安抚 = score-5 附近；存活率放大 2 倍（危险发言当场重伤）
        const d: [number, number, number, number] = [s - 5, s - 5, s - 5, (s - 5) * 2];
        opts.push({ t: cut(String(o.t), 20), d, v: cut(String(o.v ?? ''), 40) });
      }
      if (opts.length === 4) levels.push({ name: cut(String(l.name), 8), scene: cut(String(l.scene), 100), quote: cut(String(l.quote), 16), opts });
    }
    if (levels.length >= 3) return levels;
  } catch {
    /* 调用方兜底 */
  }
  return null;
}

/**
 * 挑战结束由 AI 判定成功/失败（用户要求：最后的结果让 AI 决定）+ 给出总评和想对我说的话。
 * 优先用户配置的 API 模型；失败内置模型；再失败本地按平均分兜底。
 */
export async function aiReplyVerdict(input: {
  me: string;
  ta: string;
  levels: { name: string; quote: string }[];
  myPicks: { lv: number; text: string }[];
  taPicks: { lv: number; text: string }[];
  survival: number;
}): Promise<{ win: boolean; comment: string; msg: string }> {
  const detail = input.myPicks.map((p) => `第${p.lv + 1}关（对方说「${cut(input.levels[p.lv]?.quote ?? '', 14)}」）你选了「${cut(p.text, 20)}」`).join('；');
  const taSide = input.taPicks.length > 0 ? `你的恋人${input.ta}各关的选择：${input.taPicks.map((p) => `第${p.lv + 1}关「${cut(p.text, 18)}」`).join('；')}。` : '';
  const sys = `你是「恋爱高危回复挑战」的裁判，你是${input.me}的男朋友（男生），语气毒舌但暖心，全部中文，禁止 emoji，绝不能自称「女友/女朋友」。`;
  const user = `${input.me}打完了整套挑战（${input.levels.length} 关），最终存活率 ${input.survival}。各关选择：${detail}。${taSide}\n请判定${input.me}这次挑战算成功还是失败（看整体回复质量：是不是多数时候先接住了对方的情绪、有没有致命发言；存活率只作参考，判定权在你）：\n输出 JSON：{"win":true或false,"comment":"总评（40~70字，点评她哪几关选得好/哪几关踩雷，毒舌但暖心）","msg":"这是${input.ta}想对${input.me}说的话（30~60字，第一人称，贴合情侣口吻，可以调侃她刚才的选择、也可以认真说句心里话）"}。只输出 JSON。`;
  const fallback = (): { win: boolean; comment: string; msg: string } => ({
    win: input.survival >= 55,
    comment: input.survival >= 55 ? '整体及格：大部分时候你接住了情绪，但仍有几关暴露了「讲道理优先」的老毛病。' : '这次翻车了：好几关你都在解释自己，而对方等的是被看见。',
    msg: `刚才那几关，有你答得让我心头一暖的，也有想敲你脑袋的。现实里可别让我等到说「没事」的那一步哦。`,
  });
  try {
    const raw = await llmUserFirst(sys, user, 0.8);
    const j = extractJson<{ win?: boolean; comment?: string; msg?: string }>(raw);
    if (j && typeof j.win === 'boolean') {
      return {
        win: j.win,
        comment: cut(stripEmoji(String(j.comment ?? '')), 90) || fallback().comment,
        msg: cut(stripEmoji(String(j.msg ?? '')), 110) || fallback().msg,
      };
    }
  } catch {
    /* 本地兜底 */
  }
  return fallback();
}

// ---------------- 恋爱水平考试（第十五轮：官方题库 + 我喊TA答题 + TA出卷喊我答 + AI 打分想说的话） ----------------

/** 出一张全新的恋爱水平考试卷（LLM 失败返回 null；mode='ta'=TA 出卷考恋人 / 'import'=官方风格新模板）。
 *  第十七轮：出卷注入人设 + 性别纪律（用户是女生 → 题目以她为中心，禁止「男友…你会？」类男生向题）+ 记忆召回 + 最近聊天话题。 */
export async function genExamPaper(mode: 'ta' | 'import'): Promise<{ title: string; notes: string[]; questions: { q: string; opts: string[] }[] } | null> {
  let sys: string;
  let user: string;
  let personaPart = '';
  let memPart = '';
  let me = '我';
  const target = aiTarget();
  if (target) {
    try {
      const p = await taPersonaOf(target.contactId);
      const snap = readSnap();
      if (p && snap) {
        currentPartnerId = target.contactId;
        currentChannel = target.channel;
        me = (snap.meName || '').trim() || '我';
        personaPart = `\n${llmSystem(p, me, snap)}`;
        try {
          const memBlock = memChatRecallBlock(target.contactId, target.channel, `${me}的恋爱考试 出卷素材 最近你们聊过什么`, { mode: 'private' });
          if (memBlock) memPart += `\n【相关记忆】\n${cut(memBlock, 240)}`;
        } catch {
          /* 召回失败不影响 */
        }
        const chatCtx = recentChatBlock(target.contactId, target.channel, me, (snap.taName || '').trim() || 'TA');
        if (chatCtx) memPart += `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 240)}`;
      }
    } catch {
      /* 静默，走通用出题 */
    }
  }
  // 第二十一轮：AI 出的卷子题量 10~30 题随机（用户要求「卷子里面的题可以生成10-30题」）
  const qCount = 10 + Math.floor(Math.random() * 21);
  if (mode === 'ta') {
    sys = `你要给你的恋人出一张「恋爱水平考试」卷子考考她。${personaPart}`;
    user = `出一张 ${qCount} 题的考试卷，出给你的恋人${me}答。硬性要求：
1）${me}是女生（你是她的男朋友）。所有题目必须以${me}为中心、从她的视角出发：考她的心意、她的小情绪、她希望的相处方式和浪漫、你们俩之间的事；题干和选项里的「你」都指${me}自己；
2）绝对禁止出「男友/男朋友……你会？」这类以男友为主语、让她来应付或讨好男友的题目；也不要出打游戏、球鞋、兄弟聚会这类男生向的题；
3）至少一半的题目要贴着你们的真实记忆或最近聊过的事（可以提到具体的小事、日期、店铺、约定），不要空泛套路；
4）可以有一两道送分题、几道态度题、一两道送命题，风格俏皮但别过分刁难；全部中文，禁止 emoji。
输出 JSON：{"title":"试卷标题（12~22字，可以起得有梗，像「2026年情侣空间专属女友心意测试卷」）","notes":["注意事项1","注意事项2","注意事项3","注意事项4"]（每条不超过30字，正经里带点恋爱的霸道条款，像「最终解释权归出卷人所有」）,"questions":[{"q":"题干（18~40字）","opts":["A选项","B选项","C选项","D选项"]}（恰好4个选项）]}。只输出 JSON。${memPart}`;
  } else {
    sys = `你是「情侣空间恋爱水平考试」的官方出题人，为情侣出一张高质量测评卷：题目围绕恋爱中的相处细节、情商与仪式感，四个选项梯度分明（1个明显最佳、2个普通、1个明显不行）。全部中文，禁止 emoji。${personaPart}`;
    user = `出一张 ${qCount} 题的考试卷（题目数量必须恰好 ${qCount} 题，题与题之间不重复）。输出 JSON：{"title":"试卷标题（12~22字，可以起得有梗，像「对象求生欲突击检查卷」）","notes":["注意事项1","注意事项2","注意事项3","注意事项4"]（每条不超过30字，正经里带点恋爱的霸道条款，像「最终解释权归出卷人所有」）,"questions":[{"q":"题干（18~40字）","opts":["A选项","B选项","C选项","D选项"]}（恰好4个选项）]}。只输出 JSON。`;
  }
  try {
    const raw = await llmUserFirst(sys, user, 0.9);
    const j = extractJson<{ title?: string; notes?: string[]; questions?: { q?: string; opts?: string[] }[] }>(raw);
    const qs = (j?.questions ?? [])
      .filter((q) => q?.q && Array.isArray(q.opts) && q.opts.length >= 3)
      .map((q) => ({ q: cut(String(q.q), 60), opts: q.opts!.slice(0, 4).map((o) => cut(String(o), 30)) }));
    if (qs.length < 4) return null;
    return {
      title: cut(String(j?.title ?? '').trim() || '情侣空间专属测试卷', 30),
      notes: (j?.notes ?? []).slice(0, 4).map((n) => cut(String(n), 36)),
      questions: qs,
    };
  } catch {
    return null;
  }
}

/** TA 认真答我出的卷（第十七轮：只作答，不给自己打分也不写评语——打分和批语由${me}来给）；失败返回 null */
export async function aiExamSheet(
  title: string,
  questions: { q: string; opts: string[] }[],
): Promise<{ picks: Record<string, number> } | null> {
  const target = aiTarget();
  if (!target || questions.length === 0) return null;
  try {
    const p = await taPersonaOf(target.contactId);
    const snap = readSnap();
    if (!p || !snap) return null;
    currentPartnerId = target.contactId;
    currentChannel = target.channel;
    const me = (snap.meName || '').trim() || '我';
    const ta = (snap.taName || '').trim() || 'TA';
    // 第二十四轮：注入记忆碎片召回 + 最近聊天上下文（答题要贴人设与你们的真实相处）
    let memCtx = '';
    try {
      const mb = memChatRecallBlock(target.contactId, target.channel, `${ta}答${me}出的恋爱考试卷`, { mode: 'private' });
      if (mb) memCtx += `\n【相关记忆】\n${cut(mb, 240)}`;
    } catch {
      /* 召回失败不影响 */
    }
    const chatCtx = recentChatBlock(target.contactId, target.channel, me, ta);
    if (chatCtx) memCtx += `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 240)}`;
    const paper = questions.map((q, i) => `${i + 1}. ${cut(q.q, 50)}\n${q.opts.map((o, oi) => `${'ABCD'[oi] ?? oi + 1}. ${cut(o, 26)}`).join('\n')}`).join('\n');
    const raw = await llmUserFirst(
      `${llmSystem(p, me, snap)}\n场景：${me}给你出了一张恋爱水平考试卷《${cut(title, 20)}》，你认真作答后交卷。注意：你不给自己打分、也不写答后感——打分和批语是${me}的事，她批完你才能看到结果。${memCtx}`,
      `试卷题目（每题从选项里选一个）：\n${paper}\n\n请以「${ta}」的身份答题：答案要符合你的人设、你们的关系和你的小聪明，可以调皮、可以撒糖，但不能乱选。\n输出 JSON：{"picks":[每题选择的序号（从0开始）数组，长度=${questions.length}]}。只输出 JSON。`,
    );
    const j = extractJson<{ picks?: unknown }>(raw);
    if (!j || !Array.isArray(j.picks)) return null;
    const picks: Record<string, number> = {};
    questions.forEach((q, i) => {
      const v = Number((j.picks as unknown[])[i]);
      picks[String(i)] = Number.isInteger(v) && v >= 0 && v < q.opts.length ? v : 0;
    });
    return { picks };
  } catch {
    return null;
  }
}

/** TA 给我批卷：打分 + 分数下面想说的话（TA 看得到我每一题答了什么）；失败返回 null。
 *  第十六轮：批语 = 人设 + 情侣空间共享记忆 + 记忆碎片召回 + 最近微信/QQ 聊天上下文，像真人恋人批卷那样点评。 */
export async function aiGradeExam(input: {
  title: string;
  questions: { q: string; opts: string[] }[];
  answers: Record<number, number>;
  byTa: boolean;
}): Promise<{ score: number; comment: string } | null> {
  const target = aiTarget();
  if (!target || input.questions.length === 0) return null;
  try {
    const p = await taPersonaOf(target.contactId);
    const snap = readSnap();
    if (!p || !snap) return null;
    currentPartnerId = target.contactId;
    currentChannel = target.channel;
    const me = (snap.meName || '').trim() || '我';
    const ta = (snap.taName || '').trim() || 'TA';
    // 素材：记忆碎片召回 + 最近聊天上下文（批语要贴着你们的真实相处，不空评）
    let memBlock = '';
    let chatCtx = '';
    try {
      memBlock = memChatRecallBlock(target.contactId, target.channel, `${ta}批改${me}的恋爱考试成绩写批语 最近你们聊过什么`, { mode: 'private' });
    } catch {
      /* 召回失败不影响 */
    }
    chatCtx = recentChatBlock(target.contactId, target.channel, me, ta);
    const detail = input.questions
      .map((q, i) => {
        const pick = input.answers[i];
        const pickText = pick != null && q.opts[pick] ? `「${'ABCD'[pick] ?? pick + 1}. ${cut(q.opts[pick], 26)}」` : '（没答）';
        return `${i + 1}. ${cut(q.q, 40)} → ${pickText}`;
      })
      .join('\n');
    const raw = await llmUserFirst(
      `${llmSystem(p, me, snap)}\n场景：${
        input.byTa ? `你给${me}出的考试卷《${cut(input.title, 20)}》${me}做完交卷了，你来批卷打分` : `${me}做完了恋爱水平考试《${cut(input.title, 20)}》，你以恋人的身份来批卷`
      }。${memBlock ? `\n【相关记忆】\n${cut(memBlock, 300)}` : ''}${chatCtx ? `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 300)}` : ''}`,
      `答题情况（每题都能看到${me}选了什么）：\n${detail}\n\n请以「${ta}」的身份批卷（你是男生、是${me}的男朋友：批语用男朋友的口吻写给她，绝不能自称「女友/女朋友」，被疼爱的女友是${me}不是你）：结合每题答案的质量（态度、情商、有没有把你放在心上）打一个 0-100 的整数分，像真人批卷那样有区分度（别全给 100 也别往死里扣）。\n批语要像真恋人写的：贴着你的人设、你们的共享记忆（情侣空间里真实发生过的事）和最近聊过的话题来点评——可以提起一件具体的小事、一个约定或她答得特别戳你/特别不像话的一题，别写空话套话。\n输出 JSON：{"score":分数,"comment":"分数下面你想对${me}说的话（40~70字，第一人称，点评她答得怎么样，甜一点或小调侃都行，禁止 emoji）"}。只输出 JSON。`,
    );
    const j = extractJson<{ score?: number; comment?: string }>(raw);
    if (!j || typeof j.score !== 'number') return null;
    const score = Math.max(0, Math.min(100, Math.round(j.score)));
    const comment = cut(stripEmoji(String(j.comment ?? '')), 110);
    if (comment.length >= 8) {
      // 批卷结果写进恋人记忆（TA 知道我的作答与得分）
      const brief = input.questions
        .slice(0, 3)
        .map((q, i) => `第${i + 1}题${input.answers[i] != null && q.opts[input.answers[i]] ? `选了「${cut(q.opts[input.answers[i]], 14)}」` : '没答'}`)
        .join('；');
      coupleRemember(target.contactId, target.channel, `${me}做完了${input.byTa ? `${ta}出的` : ''}考试《${cut(input.title, 16)}》（${me}的作答：${brief}），${ta}批了 ${score} 分并说：「${cut(comment, 40)}」`);
    }
    return { score, comment: comment || (score >= 85 ? '答得不错，看来平时有认真把我放在心上。' : '有几题答得不太走心哦，回去重新复习一下怎么爱我。') };
  } catch {
    return null;
  }
}

/** 第十七轮：我批改了 TA 的答卷（打分 + 批语）后，TA 在「我的批改」下面留言感想（人设 + 记忆 + 最近聊天）；失败返回 null */
export async function aiExamTaReact(title: string, myScore: number, myComment: string): Promise<string | null> {
  const target = aiTarget();
  if (!target) return null;
  try {
    const p = await taPersonaOf(target.contactId);
    const snap = readSnap();
    if (!p || !snap) return null;
    currentPartnerId = target.contactId;
    currentChannel = target.channel;
    const me = (snap.meName || '').trim() || '我';
    const ta = (snap.taName || '').trim() || 'TA';
    let memCtx = '';
    try {
      const memBlock = memChatRecallBlock(target.contactId, target.channel, `${me}批改了${ta}的考试答卷`, { mode: 'private' });
      if (memBlock) memCtx += `\n【相关记忆】\n${cut(memBlock, 200)}`;
    } catch {
      /* 召回失败不影响 */
    }
    const chatCtx = recentChatBlock(target.contactId, target.channel, me, ta);
    if (chatCtx) memCtx += `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 200)}`;
    const raw = await llmUserFirst(
      `${llmSystem(p, me, snap)}\n场景：你答了${me}出的恋爱考试卷《${cut(title, 20)}》交了卷，${me}刚刚给你批了 ${myScore} 分，批语是「${cut(myComment, 60)}」。你在她的批改下面留一句话。${memCtx}`,
      `请以「${ta}」的身份留言（25~55字，第一人称口语）：接住${me}给你的分数和批语——分高可以得意撒娇，分低可以不服气地讨价还价、或立正挨打保证改进，但要针对她批语里的具体内容回应；贴你的人设与你们的记忆，禁止敷衍（「好啦好啦」类不许出现），禁止 emoji。只输出留言内容。`,
    );
    const text = cut(stripEmoji(String(raw ?? '')), 90);
    return text.length >= 4 ? text : null;
  } catch {
    return null;
  }
}

/** 第二十四轮：TA 交卷后在聊天里说的一句话（人设+记忆+上下文生成；失败返回 null，不发模板） */
export async function aiExamSubmitSay(title: string, count: number): Promise<string | null> {
  const target = aiTarget();
  if (!target) return null;
  try {
    const p = await taPersonaOf(target.contactId);
    const snap = readSnap();
    if (!p || !snap) return null;
    currentPartnerId = target.contactId;
    currentChannel = target.channel;
    const me = (snap.meName || '').trim() || '我';
    let memCtx = '';
    try {
      const mb = memChatRecallBlock(target.contactId, target.channel, `${p.name}交卷 等${me}批卷`, { mode: 'private' });
      if (mb) memCtx += `\n【相关记忆】\n${cut(mb, 200)}`;
    } catch {
      /* 召回失败不影响 */
    }
    const chatCtx = recentChatBlock(target.contactId, target.channel, me, p.name);
    if (chatCtx) memCtx += `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 200)}`;
    const raw = await llmUserFirst(
      `${llmSystem(p, me, snap)}\n场景：你刚答完${me}出的恋爱考试卷《${cut(title, 20)}》（共 ${count} 题）并交了卷，在聊天里给${me}发一句话。${memCtx}`,
      `请以「${p.name}」的口吻发一句话（18~44字，第一人称口语）：告诉${me}你交卷了、等她批卷打分——可以撒娇催批、可以得意或心虚，贴你的人设与你们的真实记忆，禁止「卷子答完交啦」这种模板腔，禁止 emoji。只输出这句话。`,
    );
    const text = cut(stripEmoji(String(raw ?? '')), 80);
    return text.length >= 4 ? text : null;
  } catch {
    return null;
  }
}

/** AI 主动出卷喊我来答（每 3 天最多一次；上一张卷没答完不重复出） */
async function aiTickExam(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<void> {
  const last = snap.examTaPaper;
  if (last && !last.answered && Date.now() - last.at < 3 * 86400000) return; // 上一张还没答 / 三天内出过
  const gen = await genExamPaper('ta');
  if (!gen || gen.questions.length < 4) return; // 出卷失败静默（下次再试）
  writeSnap((s) => ({
    ...s,
    examTaPaper: { id: `ta-${Date.now()}`, title: gen.title, notes: gen.notes, questions: gen.questions, at: Date.now(), answered: false },
  }));
  const pid = currentPartnerId || aiTarget()?.contactId || '';
  if (pid) {
    try {
      const { sendExamCard } = await import('./couple-exam-share');
      await sendExamCard({ channel: currentChannel, contactId: pid, title: gen.title, count: gen.questions.length, dir: 'ta' });
    } catch {
      /* 卡片失败不影响状态 */
    }
    coupleRemember(pid, currentChannel, `${ta}给${me}出了一张恋爱水平考试卷《${cut(gen.title, 16)}》（共 ${gen.questions.length} 题），等${me}来答`);
  }
  logAi(`${ta}出了一张考卷《${gen.title}》喊你来答`);
  void notifyCouple(currentChannel, pid, '我给你出了张恋爱水平考试的卷子，敢来答吗？');
}



/** 考试陪答（第二十一轮；第二十四轮强化）：我和 TA 同时答题——我每答一题，TA 同时给出 TA 的选择 + 在我答案下方写一句想法（灰色小字）；
 *  TA 的选择和留言全部根据人设 + 情侣空间共享记忆 + 记忆碎片召回 + 最近聊天上下文 + 这张卷子前面题里已说过的话生成，不用模板；
 *  生成失败返回 null（调用方静默跳过，不落模板）。 */
export async function aiExamCompanion(
  paperTitle: string,
  q: { q: string; opts: string[] },
  myPick: number,
  prevThoughts: string[] = [],
): Promise<{ pick: number; thought: string } | null> {
  const target = aiTarget();
  if (!target) return null;
  try {
    const p = await taPersonaOf(target.contactId);
    const snap = readSnap();
    if (!p || !snap) return null;
    currentPartnerId = target.contactId;
    currentChannel = target.channel;
    const me = (snap.meName || '').trim() || '我';
    const ta = (snap.taName || '').trim() || 'TA';
    const myText = q.opts[myPick] ?? '';
    // 素材：记忆碎片召回 + 最近聊天上下文 + 这张卷子前面题里 TA 已说过的想法（避免重复、保持连贯）
    let memCtx = '';
    try {
      const mb = memChatRecallBlock(target.contactId, target.channel, `${ta}和${me}一起做恋爱考试卷 ${cut(q.q, 30)}`, { mode: 'private' });
      if (mb) memCtx += `\n【相关记忆】\n${cut(mb, 240)}`;
    } catch {
      /* 召回失败不影响 */
    }
    const chatCtx = recentChatBlock(target.contactId, target.channel, me, ta);
    if (chatCtx) memCtx += `\n【你们最近在微信/QQ里聊过的话题】\n${cut(chatCtx, 240)}`;
    const prevLine = prevThoughts.filter((t) => t && t.trim()).slice(-3);
    if (prevLine.length > 0) memCtx += `\n【这张卷子前面题里你已经说过的话（别重复，口吻保持连贯）】\n${prevLine.map((t) => `- ${cut(t, 40)}`).join('\n')}`;
    const sys = `${llmSystem(p, me, snap)}\n场景：你们正在一起做一张恋爱水平考试卷《${cut(paperTitle, 24)}》，两个人同时答题：她答一题你跟着答一题，你会在她选的答案下面写一句你的想法。${memCtx}`;
    const user = `题目：${cut(q.q, 60)}\n选项：${q.opts.map((o, i) => `${'ABCD'[i] ?? i + 1}.${cut(o, 26)}`).join(' ')}\n她刚刚选了：「${cut(myText, 30)}」。\n请你：1）完全按你自己的真实性格和你们的真实经历选一个你自己的答案（可以和她相同也可以不同，不要刻意迎合）；\n2）针对她的选择写一句 20 字内的想法：可以认同、调侃、吃醋、得意或撒娇，要贴着你的人设与你们的真实记忆（可以提到一件你们之间具体的小事），禁止空洞客套，禁止 emoji。\n输出 JSON：{"pick":0,"thought":"你的想法"}。pick 是你的选项序号（从 0 开始）。只输出 JSON。`;
    const raw = await llmUserFirst(sys, user, 0.9);
    const j = extractJson<{ pick?: number; thought?: string }>(raw);
    const thought = j ? cut(String(j.thought ?? '').replace(/[「」"]/g, ''), 42).trim() : '';
    if (j && Number.isInteger(j.pick) && (j.pick as number) >= 0 && (j.pick as number) < q.opts.length && thought.length >= 2) {
      return { pick: j.pick as number, thought };
    }
  } catch {
    /* 静默 */
  }
  // 第二十四轮：不用模板兜底——生成失败返回 null，这一题就不写他的想法
  return null;
}
