/**
 * NPC 配角社交圈（system prompt 注入数据的组装）：
 * - CHAR/user 视角：TA 认识的配角（名下 ownerId 指向 TA 的 NPC）→「你认识的配角」段，
 *   用户和 CHAR 聊到这些 NPC 时，CHAR 能按设定自然接话；
 * - NPC 视角：归属者（CHAR/USER）资料卡 →「你了解的X」段，NPC 知道自己归属的 CHAR 是谁、
 *   与用户是什么关系（人设里只需写对自己的了解，归属者的资料由系统注入，不用重复手写）；
 * - 互动近况（背景记忆）：双方记忆库里提到对方名字的碎片 →「最近发生的事」段，
 *   让 CHAR/NPC 知道「最近发生了什么」（如用户跟 CHAR 聊过某 NPC，CHAR 再遇该话题时接得上）。
 *
 * 约束：
 * - 全部同步纯函数（联系人列表由调用方传入，记忆碎片走 memory.ts 的 localStorage 读取），
 *   可安全用于各聊天 App 的发送流程与 chat.tsx 打开会话时的人设组装；
 * - 记忆隔离边界不变：只读「当前聊天对端自己」的记忆库，绝不读其它联系人的记忆（含归属者/配角的）；
 * - 数据缺失一律安全回退（无 NPC/无记忆 → 返回空数组，prompt 不注入对应段）。
 */

import { displayNameOf, type ContactRecord } from '@/lib/contacts';
import { getMemSettings, listFragments, noteBondFragmentIds } from '@/lib/memory';
import { fadeState, isMemExpired, type FadeInput } from '@/lib/memory-core';
import type { NpcCircleEntry } from './persona';

/** 摘要截断（prompt 注入保持紧凑，避免人设段膨胀吃 token） */
function snippet(s: string | null | undefined, max: number): string {
  const t = (s ?? '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * CHAR/user 视角：TA 认识的配角圈（名下 NPC）。
 * 条目 = 名字 + 对 CHAR 的关系（relation）+ 对机主用户的关系（relationToUser）+ 一句话人设。
 * 上限 6 条（按创建时间倒序即可，列表本身就是倒序传入）。
 */
export function npcCircleFor(peer: ContactRecord, all: ContactRecord[]): NpcCircleEntry[] {
  if (peer.kind === 'npc') return [];
  return all
    .filter((c) => c.kind === 'npc' && c.ownerId === peer.id)
    .slice(0, 6)
    .map((npc) => ({
      name: displayNameOf(npc) || npc.name,
      relation: npc.relation?.trim() || '认识的人',
      relationToUser: npc.relationToUser?.trim() ?? '',
      persona: snippet(npc.persona || npc.background, 42),
    }));
}

/**
 * NPC 视角：归属者（CHAR/USER）资料卡行 → NPC「了解」自己归属的 CHAR 是谁。
 * 行：基础资料（性别/年龄/职业/地区）+ 人设/背景摘要（各 80 字）。
 * 归属者不存在（脏数据）→ 空数组不注入。
 */
export function ownerCardFor(npc: ContactRecord, all: ContactRecord[]): string[] {
  if (npc.kind !== 'npc' || !npc.ownerId) return [];
  const owner = all.find((c) => c.id === npc.ownerId);
  if (!owner) return [];
  const facts = [owner.gender, owner.age ? `${owner.age}岁` : '', owner.occupation, owner.region]
    .map((x) => (x ?? '').trim())
    .filter(Boolean);
  const lines: string[] = [facts.length > 0 ? `${owner.name}（${facts.join('，')}）` : owner.name];
  const persona = snippet(owner.persona, 80);
  if (persona) lines.push(`TA的性格/风格：${persona}`);
  const background = snippet(owner.background, 80);
  if (background) lines.push(`TA的背景：${background}`);
  return lines;
}

/**
 * 背景/互动近况：从 contactId 自己的记忆库里找「内容提到任一关键词」的最新碎片（≤3 条）。
 * - CHAR：关键词 = 配角圈 NPC 名字 → 「我记忆里关于这些配角的事」；
 * - NPC：关键词 = 归属者名字（+归属者的昵称）→ 「我记忆里关于归属者的事」。
 * 时间格式 M月D日，最新在前（listFragments 本身 createdAt 倒序）。
 */
export function bondNotesFor(contactId: string, keywords: string[], limit = 3): string[] {
  // #41：放宽关键词长度过滤——原 ≥2 漏掉中文单字人名（「凡」「安」），改为按字符类型分支：
  // 含中文字符的关键词允许单字（中文单字人名/物名是合法关键词），纯英文/数字仍 ≥2（避免「a」「1」噪声）
  const words = keywords
    .map((k) => (k ?? '').trim())
    .filter((k) => {
      if (!k) return false;
      // 含中文字符 → 允许单字；纯 ASCII（英文/数字/符号）→ 至少 2 字
      const hasCJK = /[\u4e00-\u9fff]/.test(k);
      return hasCJK ? k.length >= 1 : k.length >= 2;
    });
  if (words.length === 0) return [];
  const now = Date.now();
  const { forget } = getMemSettings(contactId);
  const frags = listFragments(contactId).filter((f) => {
    // 已入核心记忆（consumedAt）/被更新取代（supersededAt）/已过期/已淡化的碎片不再作为「最近发生的事」
    // 注入——与 memChatRecallBlock 完全同口径（B8：消除重复注入与陈旧注入）
    if (f.consumedAt || f.supersededAt || isMemExpired(f, now)) return false;
    if (fadeState(f as FadeInput, forget, now) === 'faded') return false;
    const content = f.content ?? '';
    return words.some((w) => content.includes(w));
  });
  const picked = frags.slice(0, limit);
  // B8：把本轮选用的碎片 id 登记给记忆召回侧（memRecallBlock 排除同一批碎片，跨块去重）
  noteBondFragmentIds(picked.map((f) => f.id));
  return picked.map((f) => {
    const d = new Date(f.sourceTime || f.createdAt);
    return `${d.getMonth() + 1}月${d.getDate()}日：${snippet(f.content, 60)}`;
  });
}

/** 组装结果（透传给 buildPersonaSystemPrompt 的 ctx 扩展字段；全空 → null 不注入） */
export interface NpcPromptExtra {
  /** CHAR/user：认识的配角圈 */
  npcCircle?: NpcCircleEntry[];
  /** NPC：归属者显示名（供 prompt 里「你与X的关系 / 你了解的X」段使用） */
  ownerLabel?: string;
  /** NPC：归属者资料卡行 */
  ownerCard?: string[];
  /** 背景/互动近况行 */
  backgroundNotes?: string[];
}

/**
 * 一站式组装：按聊天对端类型返回 prompt 注入数据。
 * - peer = CHAR/user → npcCircle（名下 NPC）+ backgroundNotes（自己记忆提到名下 NPC 的事）；
 * - peer = NPC → ownerCard（归属者资料卡）+ backgroundNotes（自己记忆提到归属者的事）。
 * all = 全部联系人（调用方手头现成的列表，避免重复查 IndexedDB）。
 * 全部为空时返回 null（调用方直接不传，prompt 与旧行为完全一致）。
 */
export function buildNpcPromptExtra(peer: ContactRecord, all: ContactRecord[]): NpcPromptExtra | null {
  if (peer.kind === 'npc') {
    const owner = peer.ownerId ? all.find((c) => c.id === peer.ownerId) : undefined;
    const ownerNames = owner
      ? Array.from(new Set([owner.name, displayNameOf(owner)]))
      : [];
    const extra: NpcPromptExtra = {
      ownerLabel: owner ? displayNameOf(owner) || owner.name : undefined,
      ownerCard: ownerCardFor(peer, all),
      backgroundNotes: ownerNames.length > 0 ? bondNotesFor(peer.id, ownerNames) : [],
    };
    const empty =
      !extra.ownerLabel &&
      (!extra.ownerCard || extra.ownerCard.length === 0) &&
      (!extra.backgroundNotes || extra.backgroundNotes.length === 0);
    return empty ? null : extra;
  }
  const circle = npcCircleFor(peer, all);
  if (circle.length === 0) return null;
  const extra: NpcPromptExtra = {
    npcCircle: circle,
    backgroundNotes: bondNotesFor(peer.id, circle.map((n) => n.name)),
  };
  const empty =
    (!extra.npcCircle || extra.npcCircle.length === 0) &&
    (!extra.backgroundNotes || extra.backgroundNotes.length === 0);
  return empty ? null : extra;
}
