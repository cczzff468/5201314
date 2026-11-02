'use client';

/**
 * X论坛 · 匿名账号（小号）「揭秘时刻」状态与检测。
 *
 * 认知隔离语义（用户规则三/四）：
 * - 默认：匿名账号对全部 AI 角色是「陌生网友」——两个账号的记忆完全隔离，
 *   AI 绝不能把小号与大号（机主）关联；
 * - 揭秘：机主在私聊里亲口说破（「那是我小号」「那个帖子是我发的」）后，
 *   该联系人按联系人为粒度落一条关联记忆 + 持久披露标记——之后 TA 分享/聊到
 *   小号的帖子时，AI 的初始认知就是「这是 TA 本人（钓鱼实锤）」，态度可以转变；
 * - 粒度：按联系人隔离（对谁说破，谁才知道）；其他角色仍然不知情。
 *
 * 本模块只做检测与状态读写，不 import engine/social（避免循环依赖）；
 * 记忆落库由调用方（chat-stream-store / forum-share）完成。
 */
import { kvGet, kvSet } from './idb-kv';
import { forumData, resolveAuthor, ANON_KEY } from '@/lib/forum/core';

/** 披露状态 kv 键：Record<contactId, { at, evidence }> */
export const FORUM_ANON_DISCLOSED_KEY = 'forum-anon-disclosed-v1';

interface AnonDisclosedRec {
  at: number;
  /** 命中的原话（≤60 字；调试/后续提示可用） */
  evidence?: string;
}

function readDisclosedMap(): Record<string, AnonDisclosedRec> {
  try {
    const raw = kvGet<Record<string, AnonDisclosedRec>>(FORUM_ANON_DISCLOSED_KEY);
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** 该联系人是否已知情「匿名账号 = 机主本人」（说破后持久生效，幂等） */
export function isForumAnonDisclosed(contactId: string): boolean {
  if (!contactId) return false;
  try {
    return Boolean(readDisclosedMap()[contactId]);
  } catch {
    return false;
  }
}

/** 落披露标记（幂等；返回是否为新写入） */
export function markForumAnonDisclosed(contactId: string, evidence?: string): boolean {
  if (!contactId) return false;
  try {
    const map = readDisclosedMap();
    if (map[contactId]) return false;
    map[contactId] = { at: Date.now(), evidence: (evidence ?? '').slice(0, 60) || undefined };
    kvSet(FORUM_ANON_DISCLOSED_KEY, map);
    return true;
  } catch {
    return false;
  }
}

/**
 * 检测用户发言是否是「匿名账号是我」的披露表述。
 *
 * 两级模式（都带否定守卫——「不是我的小号」「别说是我发的」不算）：
 * - A 级（帖子指向明确，直接命中）：「那个帖子是我发的」「楼主就是我」
 *   「我小号发的帖子」「我匿名发的」「那个号就是我的」「那个网友是我」等；
 * - B 级（泛指「我的小号/马甲」）：仅当微信/QQ 多账号系统没有命中同名披露时才归论坛小号
 *   （调用方传 altHit=false；两者都说「小号」时优先归聊天 App 小号，防误关联）。
 *
 * 仅当匿名账号已创建（用户真的有小号）时才会命中——没建小号时说「小号」
 * 与论坛无关，一律返回 null。
 */
export function detectForumAnonDisclosure(text: string, altHit = false): string | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  // 前提：匿名账号真实存在
  try {
    if (!forumData().anon) return null;
  } catch {
    return null;
  }
  const negated = (idx: number): boolean => {
    const head = t.slice(Math.max(0, idx - 3), idx);
    return /[不没别非无]|难道|岂|哪|莫非/.test(head);
  };
  // A 级：帖子/楼主/网友/账号明确指向 + 第一人称归属
  const tierA: RegExp[] = [
    /(那|这|刚|上)?(个|条|篇)?(帖子|微博)(就)?是(我|本人)(发|写)的?/,
    /楼主(就)?是(我|本人)|我(就)?是楼主/,
    /我(是)?用?(小号|马甲|匿名|匿名账号)(发的?|发的那条|水的那条)/,
    /(我|本人)(刚|才)?(用)?(小号|马甲|匿名账号)?发的?(那|这)?(个|条)(帖子|微博)/,
    /(那|这)(个|条)(号|账号|网友)(就)?是(我|我的|本人)/,
    /匿名(账号)?(就)?是(我|本人)/,
    /小号(就)?是(我|本人)在?用?/,
  ];
  for (const re of tierA) {
    const m = re.exec(t);
    if (m && !negated(m.index)) return m[0];
  }
  // B 级：泛指「我的小号/我的马甲」——聊天 App 小号系统没认领时才归论坛
  if (!altHit) {
    const m = /(我|我的|本人)(的)?(小号|马甲)|小号(就)?是(我|本人)/.exec(t);
    if (m && !negated(m.index)) return m[0];
  }
  return null;
}

/**
 * 匿名身份在「该联系人认知里」的描述行（分享/聊天提示词用）：
 * - 未揭秘：陌生网友框架——AI 初始认知是「一个不认识的网友发的帖子」；
 * - 已揭秘：关联框架——「TA 亲口承认这是 TA 的小号」，态度可以转变（吃醋/调侃钓鱼）。
 */
export function forumAnonCognitionLine(contactId: string): string {
  const anon = resolveAuthor(ANON_KEY);
  if (isForumAnonDisclosed(contactId)) {
    return `「${anon.name}」其实是TA本人的小号（匿名账号）——TA已经亲口向你承认过。`;
  }
  return `「${anon.name}」是你不认识的陌生网友`;
}
