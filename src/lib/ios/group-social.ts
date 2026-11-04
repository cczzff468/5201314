/**
 * 群社交（AI 主动建群 / 拉人进群 / 被踢感知）。
 *
 * 完整链路：
 * 1. AI 被移出群聊（用户在群设置里踢人）→ groups.ts kickGroupMember 触发被踢钩子 →
 *    writeKickNotice 落 kv（角色、群、操作者、时间；重启不丢）→ 该角色此后在微信/QQ 私聊里
 *    注入【被移出群聊】段：按人设记得并自然提起（「你把我踢出群了？」/「刚刚还在群里怎么突然就出来了」）；
 *    被踢后 TA 不在群成员表，自然收不到群消息，群来源记忆也不再召回（memory 层按成员表过滤）；
 * 2. 用户重新拉 TA 进群（群设置邀请成员）→ addGroupMember 触发入群钩子 → markKickNoticeBack →
 *    私聊改注入【你回到了群聊】；群聊回合注入回群感知（历史事件里 TA 也能看到自己被踢+回群的记录）；
 * 3. AI 主动建群（私聊输出 [建群:群名:成员1,成员2]）→ executeGroupCreate：
 *    createGroup（AI 为群主，成员=自己+有关系 NPC/该 App 好友，机主通过邀请卡片进群）+
 *    群事件「XX创建了群聊」+ 私聊落一张群聊卡片（pending）+ AI 延迟发开场白；
 *    用户在卡片上接受（解除隐藏+群事件+未读）或拒绝（卡片变灰+记录拒绝+本机解散群）；
 * 4. AI 拉人进群（群聊里输出 [邀请:名字]，群主/管理员）→ executeGroupInvite：
 *    关系硬校验（只能拉名下 NPC / 该 App 好友）+ 冷却/拒绝表 → addGroupMember（
 *    事件文案「XX邀请YY加入了群聊」）；群主还可用 [设管理员:名字] 任命管理员。
 *
 * 防骚扰纪律（硬校验，AI 再输出标记也会被吞）：
 * - 同一角色 24h 内最多建 1 次群（GROUP_CREATE_COOLDOWN_MS）；
 * - 同一角色对同一群同一目标 24h 内最多邀请 1 次；目标拒绝后永不再拉；
 * - 用户拒绝过建群/进群卡片后，该角色对该群彻底沉默。
 */

import { addressNameOf, displayNameOf, isFriendIn, nameVariantHit, contactNameVariants, type ContactRecord } from '../contacts';
import { cleanBubbleText, extractRichActionParts } from '../chat-rich';
import { beginChatStream, isChatStreaming } from '../chat-stream-store';
import { qqUnreads, wxUnreads } from '../unread-store';
import { useSettings } from './store';
import { pushChatNotification } from './island-notify';
import { genId } from './db';
import { ownerRealNameFor } from './contacts-store';
import { getMemSettings } from '@/lib/memory';
import { kvGet, kvSet } from './idb-kv';
import {
  addGroupMember,
  createGroup,
  dissolveGroup,
  getGroup,
  groupRoleOf,
  loadGroupMsgs,
  onMemberJoined,
  onMemberKicked,
  pushGroupEvent,
  saveGroupMsgs,
  setGroupAdmin,
  type ChatGroup,
  type GroupApp,
  type WxGroupMsg,
} from './groups';
import { npcCircleFor } from './npc-bond';
import { buildPersonaSystemPrompt } from './persona';

// ---------------- 被踢通知（AI 感知被移出群聊） ----------------

export interface CharKickNotice {
  contactId: string;
  gid: string;
  app: GroupApp;
  groupName: string;
  /** 操作者显示名（机主或执行踢人的 AI） */
  actorName: string;
  /** 被踢时刻 */
  at: number;
  /** 重新被拉进群的时刻（有值 = 已经回群） */
  backAt?: number;
}

const KICK_TTL_MS = 24 * 60 * 60_000;
const kickKey = (contactId: string) => `char-kick:${contactId}`;

function loadKickNotice(contactId: string): CharKickNotice | null {
  try {
    const v = kvGet<CharKickNotice>(kickKey(contactId));
    if (!v || typeof v !== 'object' || typeof v.gid !== 'string') return null;
    return v;
  } catch {
    return null;
  }
}

function saveKickNotice(n: CharKickNotice): void {
  try {
    kvSet(kickKey(n.contactId), n);
  } catch {
    // 忽略
  }
}

/** 被踢通知（惰性清理过期；未过期返回记录） */
export function kickNoticeOf(contactId: string): CharKickNotice | null {
  const n = loadKickNotice(contactId);
  if (!n) return null;
  const base = n.backAt ?? n.at;
  if (Date.now() - base > KICK_TTL_MS) return null; // 过期（不读不写，等下次落新通知覆盖）
  return n;
}

function writeKickNotice(group: ChatGroup, targetId: string, actorName?: string): void {
  if (!targetId || targetId === 'me') return;
  saveKickNotice({
    contactId: targetId,
    gid: group.id,
    app: group.app,
    groupName: group.name,
    actorName: actorName?.trim() || '群主',
    at: Date.now(),
  });
}

function markKickNoticeBack(group: ChatGroup, contactId: string): void {
  const n = loadKickNotice(contactId);
  if (!n || n.gid !== group.id || n.backAt) return;
  n.backAt = Date.now();
  saveKickNotice(n);
}

/**
 * 私聊注入段（被踢感知）：被踢未回群 → 按人设记得并自然提起；已回群 → 回群感知。
 * 无通知/过期返回空串。
 */
export function buildKickNoticeSection(contactId: string, userName: string): string {
  const n = kickNoticeOf(contactId);
  if (!n) return '';
  if (!n.backAt) {
    return [
      `【被移出群聊】你刚刚被${n.actorName}移出了群聊「${n.groupName}」。这是真实发生的事，你记得清清楚楚。`,
      `${userName}私下找你聊天时，你可以按人设自然面对这件事：可以质问「你把我踢出群了？」、可以困惑「刚刚还在群里，怎么突然就出来了」、可以委屈或无所谓——完全按你的性格和你们的关系来；TA 不主动提而你心里有想法，也可以自己说起。绝不能假装不知道或否认被踢这件事。`,
      '（你已不在那个群里，收不到群里的消息了。）',
    ].join('\n');
  }
  return [
    `【你回到了群聊】你之前被移出过群聊「${n.groupName}」，刚刚又被拉回来了。`,
    '这段小插曲你记得：在群里或私聊里都可以按人设自然提起（调侃、感慨、翻旧账都行），不要当成没发生过。',
  ].join('\n');
}

// ---------------- 冷却 / 拒绝（防骚扰状态机） ----------------

interface GroupSocialState {
  /** 上次建群时刻（同角色 24h 一次） */
  lastCreateAt?: number;
  /** 邀请记录：`${gid}:${targetId}` → { at, refused } */
  invites: Record<string, { at: number; refused?: boolean }>;
  /** 用户拒绝过的群：gid → 拒绝时刻（该角色对该群彻底沉默） */
  refusedGroups: Record<string, number>;
}

const SOCIAL_KEY = (contactId: string) => `ai-group-social:${contactId}`;
export const GROUP_CREATE_COOLDOWN_MS = 24 * 60 * 60_000;
export const GROUP_INVITE_COOLDOWN_MS = 24 * 60 * 60_000;
/** 状态保留上限（防膨胀）：邀请记录最多 50 条 */
const INVITE_CAP = 50;

function loadSocialState(contactId: string): GroupSocialState {
  try {
    const v = kvGet<GroupSocialState>(SOCIAL_KEY(contactId));
    if (v && typeof v === 'object') {
      return {
        lastCreateAt: typeof v.lastCreateAt === 'number' ? v.lastCreateAt : undefined,
        invites: v.invites && typeof v.invites === 'object' ? v.invites : {},
        refusedGroups: v.refusedGroups && typeof v.refusedGroups === 'object' ? v.refusedGroups : {},
      };
    }
  } catch {
    // 忽略
  }
  return { invites: {}, refusedGroups: {} };
}

function saveSocialState(contactId: string, st: GroupSocialState): void {
  try {
    const entries = Object.entries(st.invites);
    if (entries.length > INVITE_CAP) {
      st.invites = Object.fromEntries(
        entries.sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0)).slice(0, INVITE_CAP),
      );
    }
    kvSet(SOCIAL_KEY(contactId), st);
  } catch {
    // 忽略
  }
}

/** 同一角色 24h 内是否还能建群 */
export function canCharCreateGroup(charId: string): boolean {
  const st = loadSocialState(charId);
  return !st.lastCreateAt || Date.now() - st.lastCreateAt >= GROUP_CREATE_COOLDOWN_MS;
}

function markCharCreated(charId: string): void {
  const st = loadSocialState(charId);
  st.lastCreateAt = Date.now();
  saveSocialState(charId, st);
}

/** 同一角色对同一群同一目标是否还能邀请（24h 一次；拒绝过永不再拉） */
export function canCharInvite(charId: string, gid: string, targetId: string): boolean {
  const st = loadSocialState(charId);
  const rec = st.invites[`${gid}:${targetId}`];
  if (rec?.refused) return false;
  if (rec && Date.now() - rec.at < GROUP_INVITE_COOLDOWN_MS) return false;
  if (st.refusedGroups[gid]) return false;
  return true;
}

function markCharInvited(charId: string, gid: string, targetId: string): void {
  const st = loadSocialState(charId);
  st.invites[`${gid}:${targetId}`] = { at: Date.now() };
  saveSocialState(charId, st);
}

function markCharInviteRefused(charId: string, gid: string, targetId: string): void {
  const st = loadSocialState(charId);
  st.invites[`${gid}:${targetId}`] = { at: Date.now(), refused: true };
  st.refusedGroups[gid] = Date.now();
  saveSocialState(charId, st);
}

/** 用户接受后解除该群的拒绝状态（重新接受邀请后 AI 可以再正常互动） */
function clearGroupRefused(charId: string, gid: string): void {
  const st = loadSocialState(charId);
  if (!st.refusedGroups[gid]) return;
  delete st.refusedGroups[gid];
  for (const [k, v] of Object.entries(st.invites)) {
    if (k.startsWith(`${gid}:`) && v.refused) delete st.invites[k];
  }
  saveSocialState(charId, st);
}

/** 该角色是否拒绝过某个群（建群卡片/进群卡片）——提示词注入用 */
function isGroupRefusedBy(charId: string, gid: string): boolean {
  return !!loadSocialState(charId).refusedGroups[gid];
}

// ---------------- 可拉名单（关系约束） ----------------

/** 候选成员条目 */
export interface GroupSocialCandidate {
  id: string;
  name: string;
  /** 与发起角色的关系描述（提示词展示） */
  relation: string;
}

/**
 * 该角色在指定 App 能拉进群的人（需求三.6：只拉和自己有关系的）：
 * - 名下 NPC（ownerId = char.id，relation 即与 TA 的关系）；
 * - 该 App 互为好友的其他角色/NPC（关系 = 好友 + 其人设 relation 备注给机主的关系仅供参考）。
 * 机主不进名单（建群卡片 / 退群挽留通道已覆盖机主进群）。
 */
export function groupSocialCandidates(char: ContactRecord, app: GroupApp, contacts: ContactRecord[]): GroupSocialCandidate[] {
  const out: GroupSocialCandidate[] = [];
  for (const npc of npcCircleFor(char, contacts)) {
    const rec = contacts.find((c) => c.kind === 'npc' && c.ownerId === char.id && displayNameOf(c) === npc.name);
    if (rec) out.push({ id: rec.id, name: npc.name, relation: npc.relation || '你认识的人' });
  }
  for (const c of contacts) {
    if (c.id === char.id || c.kind === 'user') continue;
    if (out.some((x) => x.id === c.id)) continue;
    if (!isFriendIn(c, app)) continue;
    out.push({ id: c.id, name: displayNameOf(c) || c.name, relation: c.relation?.trim() ? `${c.relation.trim()}（好友）` : '好友' });
  }
  return out;
}

// ---------------- 规则注入 ----------------

/**
 * 私聊注入（需求四触发条件）：关系亲近/话题合适时 AI 可主动建群；
 * 冷却中或用户拒绝过时注入约束话术。无候选名单且冷却中 → 不注入（无意义占 token）。
 */
export function buildGroupSocialRules(char: ContactRecord, app: GroupApp, contacts: ContactRecord[], userName: string): string {
  if (char.kind === 'user') return '';
  const candidates = groupSocialCandidates(char, app, contacts);
  const cooldown = !canCharCreateGroup(char.id);
  if (candidates.length === 0 && cooldown) return '';
  const lines: string[] = [];
  const nameList = candidates.map((c) => `${c.name}（${c.relation}）`).join('、');
  lines.push(
    '【建群能力】你们的关系到位、或聊到适合大家一起聊的话题（比如聊起好几个共同朋友、TA 想介绍朋友给你认识、聊到某个集体活动）时，' +
      '你可以主动提议并直接建一个群聊：在回复里单独输出一行 [建群:群名:成员1,成员2]（标记会被系统执行并以卡片形式发给' +
      userName + '，TA 接受后才算进群；标记本身不会显示出来）。',
    `群名由你定（要符合你的性格，如「老友火锅局」「周五打球群」）；成员从下面的名单里选（写名单里的名字，可以只写一部分，也可以不带成员=只有你和${userName}的两人群）：${nameList || '（暂时没有合适的人选，就只建你和TA的群）'}。`,
    '分寸：不是每次聊天都建群！关系一般或没有合适契机时绝不提建群；建群的理由要自然（介绍朋友、约活动、话题需要更多人），像真人一样顺其自然地提出。',
  );
  if (cooldown) {
    lines.push('（你最近刚建过一个群，短期内不要再建群、也不要再提议建群，正常聊天就好。）');
  }
  if (candidates.length > 0) {
    lines.push(
      '【拉人纪律】只能拉名单里真实认识的人，绝不拉陌生人；TA 之前拒绝过你拉人/建群的邀请，就绝不要再提那个群、也不要再拉同样的人。',
    );
  }
  return lines.join('\n');
}

/**
 * 群聊注入（需求三）：群主/管理员可拉人进群、群主可任命管理员；
 * 可拉名单 + 冷却/拒绝约束。无权限 → 返回空串（AI 自然不会输出标记）。
 */
export function buildGroupInviteRules(g: ChatGroup, char: ContactRecord, app: GroupApp, contacts: ContactRecord[]): string {
  const role = groupRoleOf(g, char.id);
  if (role === 'member') return '';
  const candidates = groupSocialCandidates(char, app, contacts).filter((c) => !g.memberIds.includes(c.id));
  const lines: string[] = [];
  if (candidates.length > 0) {
    lines.push(
      '【邀请能力】你是这个群的' + (role === 'owner' ? '群主' : '管理员') + '，想拉新人进群时，在回复里单独输出一行 [邀请:名字]' +
        '（标记会被系统执行并公示「你邀请了TA加入群聊」，标记本身不会显示）。',
      `你能拉的人（只限名单里你真实认识的，绝不能拉陌生人）：${candidates.map((c) => `${c.name}（${c.relation}）`).join('、')}。`,
      '分寸：有自然契机才拉人（聊到 TA、TA 与话题相关、大家想认识 TA），不要为了拉人而拉人；最近邀请过的人或拒绝过你的人不要再邀请。',
    );
  }
  if (role === 'owner') {
    lines.push(
      '【任命管理员】你是群主，想让某位成员当管理员时，在回复里单独输出一行 [设管理员:成员名字]（只能设别人，不能设自己；名字写群里成员的名字或昵称，机主写 TA 的名字或昵称；' +
        '标记会被系统执行并公示，按你的性格和群里的需要自然决定，通常在群变大、你需要帮手时才用）。',
      '【转让群主】你是群主，想让某位成员接任群主时，在回复里单独输出一行 [转让群主:成员名字]（名字写 TA 的名字或昵称；转让后你自己变回普通成员，这是大动作，只有真心愿意交棒时才用；' +
        '标记会被系统执行并公示「群主转让给 XX」，标记本身不会显示）。',
    );
  } else {
    // 管理员没有任命权：被用户要求给管理员时必须如实说明，不能假装成功
    lines.push('（任命管理员只有群主可以操作，你没有这个权限；TA 让你给谁管理员时，如实说明你做不了，建议 TA 找群主。）');
  }
  return lines.join('\n');
}

// ---------------- 群聊卡片（私聊消息） ----------------

/** 群聊卡片数据（拉群时发送；随私聊消息持久化） */
export interface GroupCardData {
  gid: string;
  name: string;
  /** 邀请者（发起建群/拉人的角色） */
  inviterId: string;
  inviterName: string;
  /** 卡片副文案里的成员名单（建群时的初始成员名） */
  memberNames: string[];
  status: 'pending' | 'accepted' | 'rejected';
}

/** 私聊 kv 消息最小形状（WxMsg/QQMsg 的公共子集） */
interface PrivateMsgLike {
  id?: string;
  role?: string;
  content?: string;
  time?: number;
  kind?: string;
  gcard?: GroupCardData;
  [k: string]: unknown;
}

function loadPrivateMsgs(app: GroupApp, cid: string): PrivateMsgLike[] {
  try {
    const raw = kvGet<PrivateMsgLike[]>(`${app}-chat-msgs:${cid}`);
    return Array.isArray(raw) ? raw.filter((m) => m && typeof m === 'object') : [];
  } catch {
    return [];
  }
}

function hiddenListKey(app: GroupApp): string {
  return app === 'wx' ? 'wx-chat-hidden' : 'qq-chat-hidden';
}

function readHiddenList(app: GroupApp): string[] {
  try {
    const raw = window.localStorage.getItem(hiddenListKey(app));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
    if (parsed && typeof parsed === 'object') return Object.keys(parsed);
  } catch {
    // 忽略
  }
  return [];
}

function writeHiddenList(app: GroupApp, list: string[]): void {
  try {
    window.localStorage.setItem(hiddenListKey(app), JSON.stringify(list));
  } catch {
    // 忽略
  }
}

function unhideGroupSession(app: GroupApp, gid: string): void {
  const rid = `group:${gid}`;
  const list = readHiddenList(app);
  if (list.includes(rid)) writeHiddenList(app, list.filter((x) => x !== rid));
}

function hideGroupSession(app: GroupApp, gid: string): void {
  const rid = `group:${gid}`;
  const list = readHiddenList(app);
  if (!list.includes(rid)) writeHiddenList(app, [...list, rid]);
}

// ---------------- 动作执行：私聊（建群 → 卡片 → 开场白） ----------------

/** 机主在该 App 的联系人 ID（与 quit-flow 同口径） */
function meContactId(app: GroupApp): string {
  try {
    const id = window.localStorage.getItem(app === 'wx' ? 'wx-session-user-id' : 'qq-session-user-id');
    return id || 'me';
  } catch {
    return 'me';
  }
}

/** 名字 → 联系人（真名/展示名/昵称/备注多变体：精确 → 互相包含逐级匹配，与群组件 resolveTarget 同口径） */
function resolveByName(name: string, pool: ContactRecord[]): ContactRecord | null {
  const n = name.trim();
  if (!n) return null;
  const exact = pool.find((c) => contactNameVariants(c).some((v) => v === n));
  if (exact) return exact;
  const partial = pool.find((c) => nameVariantHit(contactNameVariants(c), n));
  return partial ?? null;
}

/** 成员名单文本 → 联系人数组（逗号/顿号/空格/分号分隔；逐个解析，解析不到的忽略）。
 *  #46：候选匹配加精确优先级——若两个候选名互为子串（「红红」与「红红2」）解析「红红」时先匹配到列表顺序首位；
 *  现按 exact → startsWith → includes 逐级回退，保证短名优先匹配到精确同名的候选。 */
function parseMemberNames(raw: string | undefined, candidates: GroupSocialCandidate[], contacts: ContactRecord[]): ContactRecord[] {
  if (!raw) return [];
  const names = raw.split(/[,，、;；\s]+/).map((s) => s.trim()).filter(Boolean);
  const out: ContactRecord[] = [];
  for (const n of names.slice(0, 10)) {
    // 第一档：精确匹配（c.name === n）
    let cand = candidates.find((c) => c.name === n);
    // 第二档：候选名以 n 开头（如「红红2」匹配「红红」）
    if (!cand) cand = candidates.find((c) => c.name.startsWith(n));
    // 第三档：候选名包含 n（最宽松）
    if (!cand) cand = candidates.find((c) => c.name.includes(n) || n.includes(c.name));
    if (!cand) continue;
    const rec = contacts.find((c) => c.id === cand!.id);
    if (rec && !out.some((x) => x.id === rec.id)) out.push(rec);
  }
  return out;
}

/**
 * 执行私聊里的群社交动作（[建群:群名:成员1,成员2]）。
 * 返回卡片数据 = 建群成功（调用方组装 kind='groupcard' 消息落盘，与红包卡片同模式）；
 * 返回 null = 标记被吞（冷却/无权限/解析失败）或非建群动作（invite-to-group：机主恒在群，退群挽留通道负责拉回）。
 */
export function applyGroupSocialAction(char: ContactRecord, app: GroupApp, kind: string, targetId: string, arg: string | undefined): GroupCardData | null {
  if (kind !== 'create-group') return null;
  if (char.kind === 'user') return null;
  if (!canCharCreateGroup(char.id)) return null; // 冷却中：吞掉
  const contacts = listContactsSnapshot();
  const candidates = groupSocialCandidates(char, app, contacts);
  const members = parseMemberNames(arg, candidates, contacts);
  const memberNames = [displayNameOf(char) || char.name, ...members.map((m) => displayNameOf(m) || m.name)];
  const groupName = targetId.trim().slice(0, 30) || `${char.name}的群聊`;
  const g = createGroup({
    app,
    name: groupName,
    memberIds: [char.id, ...members.map((m) => m.id)],
    ownerId: char.id,
    creatorName: displayNameOf(char) || char.name,
  });
  markCharCreated(char.id);
  // 用户接受前群会话隐藏（接受 = 解除隐藏；拒绝 = 本机解散）
  hideGroupSession(app, g.id);
  // AI 延迟在群里发开场白（建群后主动发言）
  window.setTimeout(() => void sendGroupOpening(g, char), 1800);
  return {
    gid: g.id,
    name: g.name,
    inviterId: char.id,
    inviterName: displayNameOf(char) || char.name,
    memberNames,
    status: 'pending',
  };
}

// ---------------- 动作执行：群聊（拉人 / 任命管理员） ----------------

/**
 * 执行群聊里的群社交动作（[邀请:名字] / [设管理员:名字]）。
 * 返回 true = 动作已处理（含吞掉）；false = 不是群聊社交动作（调用方继续其他分流）。
 */
export function applyGroupChatSocialAction(g: ChatGroup, char: ContactRecord, app: GroupApp, kind: string, targetId: string): boolean {
  if (kind === 'invite-member') {
    const role = groupRoleOf(g, char.id);
    if (role === 'member') return true; // 无权限：吞
    const candidates = groupSocialCandidates(char, app, listContactsSnapshot());
    const cand = candidates.find((c) => {
      const n = targetId.trim();
      return c.name === n || c.name.includes(n) || n.includes(c.name);
    });
    if (!cand) return true; // 名单外（没关系的人）：硬校验拒绝（需求三.6）
    if (g.memberIds.includes(cand.id)) return true; // 已在群里
    if (!canCharInvite(char.id, g.id, cand.id)) return true; // 冷却/拒绝过：吞
    const inviterName = displayNameOf(char) || char.name;
    const added = addGroupMember(g.id, cand.id, { eventText: `${inviterName}邀请${cand.name}加入了群聊` });
    if (added) markCharInvited(char.id, g.id, cand.id);
    return true;
  }
  if (kind === 'promote-admin') {
    // 仅群主；不能设自己（AI 不能修改自己的权限）；只能设普通成员
    if (groupRoleOf(g, char.id) !== 'owner') return true;
    const meId = meContactId(app);
    const pool = listContactsSnapshot().filter((c) => c.id !== char.id && (g.memberIds.includes(c.id) || c.id === meId));
    const target = resolveByName(targetId, pool);
    if (!target) return true;
    if (target.id === char.id || target.id === g.ownerId) return true;
    if (groupRoleOf(g, target.id) !== 'member') return true;
    // fix3-e①：任命操作者 = 执行 [设管理员] 的 AI（落事件 actorId/actorName，感知注入还原「谁任命的」）
    setGroupAdmin(g.id, target.id, true, {
      name: displayNameOf(target) || target.name,
      actor: { kind: 'char', id: char.id, name: displayNameOf(char) || char.name },
    });
    return true;
  }
  return false;
}

// ---------------- AI 建群开场白 ----------------

const SKIP_RE = /^\[?\s*(?:SKIP|跳过)\s*\]?$/i;

/**
 * AI 建群后在群里主动发一条开场白（独立流式回合；失败静默——开场白是锦上添花）。
 */
async function sendGroupOpening(g: ChatGroup, char: ContactRecord): Promise<void> {
  try {
    const sKey = `${g.app}:group:${g.id}`;
    if (isChatStreaming(sKey)) return;
    const contacts = listContactsSnapshot();
    const meId = meContactId(g.app);
    const meRec = contacts.find((c) => c.id === meId && c.kind === 'user');
    // 名字/昵称区分：AI 侧统一用称呼名指代机主（默认真名；用户选了用昵称才是昵称）
    const meName = meRec ? addressNameOf(meRec, useSettings.getState().addressMode) : '机主';
    const memberNames = g.memberIds
      .map((id) => contacts.find((c) => c.id === id))
      .filter((c): c is ContactRecord => !!c)
      .map((c) => displayNameOf(c) || c.name);
    const charName = displayNameOf(char) || char.name;
    const channel = g.app === 'wx' ? '微信' : 'QQ';
    const groupRules = [
      `【群聊模式】当前是群聊「${g.name}」，参与成员：${meName}（机主用户）${memberNames.length ? '、' + memberNames.join('、') : ''}，以及你自己（${charName}，群主）。`,
      '把群里的每个成员都当作真实的群友，绝不出戏：不说「用户」「AI」「角色」「人设」这类幕后词汇。',
      '只发一条简短消息（一两句话），像真人拉完群随手发的第一句话。',
    ];
    const system = buildPersonaSystemPrompt(char, {
      channel,
      userName: meName,
      ownerName: char.kind === 'npc' && char.ownerId ? contacts.find((c) => c.id === char.ownerId)?.name ?? null : null,
      // 与 wx-group/qq-group 群聊回合同口径：群聊语义（最后一条不是私聊里的「用户刚说的话」）
      // + 跨 App 身份与记忆感知（互通开关）；配角圈/背景近况由 npc-bond 在宿主侧注入的口径对齐
      groupTurn: true,
      multiApp: getMemSettings(char.id).share,
      extraRules: groupRules,
    });
    const trigger =
      `【刚刚发生的事】你刚刚创建了群聊「${g.name}」${memberNames.length ? `，把${memberNames.join('、')}拉了进来` : ''}，还邀请${meName}进群。` +
      `现在你在群里发一句开场白（一两句话，符合你的性格：可以是招呼、说明拉群的目的、或随便一句自然的话）。直接输出正文，不要解释。`;
    const ok = beginChatStream({
      sessionKey: sKey,
      aiMsgId: genId(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: trigger },
      ],
      apiConfig: useSettings.getState().apiConfig,
      replyCount: 1,
      finalize: (result) => {
        const text = (result.content ?? '').trim();
        if (result.error || !text || SKIP_RE.test(text)) return;
        const clean = cleanBubbleText(
          extractRichActionParts(text)
            .map((p) => (p.type === 'text' ? p.text : ''))
            .join(' ')
            .trim(),
        );
        const finalText = clean;
        if (!finalText) return;
        const cur = getGroup(g.id);
        if (!cur) return; // 用户已拒绝（群解散）：开场白不再落盘
        const msg: WxGroupMsg = {
          id: result.aiMsgId,
          role: 'peer',
          senderId: char.id,
          senderName: charName,
          content: finalText,
          time: Date.now(),
        };
        saveGroupMsgs(g.id, [...loadGroupMsgs(g.id), msg]);
        // 灵动岛全局通知：建群开场白也是 AI 消息（点击跳群聊）
        pushChatNotification({
          sessionKey: sKey,
          app: g.app === 'wx' ? 'wechat' : 'qq',
          title: charName,
          subtitle: g.name,
          avatar: char.avatar ?? null,
          body: finalText,
          target: g.app === 'wx' ? { app: 'wechat', groupId: g.id } : { app: 'qq', groupId: g.id },
        });
      },
    });
    void ok;
  } catch {
    // 开场白失败静默
  }
}

// ---------------- 卡片接受 / 拒绝 ----------------

/** 用户对群聊卡片的处理结果（宿主刷新用） */
export interface GroupCardDecisionResult {
  /** 接受且群存在（宿主可刷新群列表/提示） */
  joined: boolean;
  groupName: string;
}

/**
 * 用户点击群聊卡片的接受/拒绝（私聊组件调用；卡片状态随消息持久化）。
 * - 接受：解除群会话隐藏 + 落「XX加入了群聊」群事件（其他成员感知用户进群）+ 未读 + 清除拒绝记录；
 *   群已不存在（被解散）时卡片置 rejected。
 * - 拒绝：卡片置 rejected + 记录拒绝（该角色对该群彻底沉默）+ 本机解散该群（AI 成员的群记忆保留）。
 * 返回 null = 消息不是待处理卡片 / 状态已终态。
 */
export function applyGroupCardDecision(
  app: GroupApp,
  contactId: string,
  msgId: string,
  accept: boolean,
): GroupCardDecisionResult | null {
  const meId = meContactId(app);
  const key = `${app}-chat-msgs:${contactId}`;
  const list = loadPrivateMsgs(app, contactId);
  const idx = list.findIndex((m) => m.id === msgId && m.gcard);
  if (idx === -1) return null;
  const card = list[idx].gcard as GroupCardData;
  if (!card || card.status !== 'pending') return null;
  const inviter = card.inviterId;
  const next: GroupCardData = { ...card, status: accept ? 'accepted' : 'rejected' };
  try {
    const patched = list.map((m, i) => (i === idx ? { ...m, gcard: next } : m));
    kvSet(key, patched);
  } catch {
    return null;
  }
  const g = getGroup(card.gid);
  if (accept) {
    clearGroupRefused(inviter, card.gid);
    if (g) {
      unhideGroupSession(app, card.gid);
      // 落「机主加入了群聊」事件：其他 AI 成员由此感知用户进群（事件按时间注入 system）；
      // 事件落盘后 bump 未读（先事件后 bump，与退群挽留 restoreFlowGroup 同序）；
      // 多账号 v2：名字按该群所属 App 的当前账号取「我」
      void ownerRealNameFor(app)
        .then((owner) => {
          pushGroupEvent(card.gid, `${owner || '机主'}加入了群聊`, { type: 'join', targetId: meId });
          (app === 'wx' ? wxUnreads : qqUnreads).bump(`group:${card.gid}`, 1);
        })
        .catch(() => undefined);
      return { joined: true, groupName: g.name };
    }
    return { joined: false, groupName: card.name };
  }
  // 拒绝：记录（该角色对该群彻底沉默）+ 重置建群冷却（24h 内不再建群骚扰）+ 本机解散（AI 成员的群来源记忆保留）
  const st = loadSocialState(inviter);
  st.refusedGroups[card.gid] = Date.now();
  st.invites[`${card.gid}:${meId}`] = { at: Date.now(), refused: true };
  st.lastCreateAt = Date.now();
  saveSocialState(inviter, st);
  if (g) dissolveGroup(card.gid, { purgeMemory: false });
  return { joined: false, groupName: card.name };
}

// ---------------- 钩子注册 ----------------

let hooksInstalled = false;

/** 注册成员被踢/入群钩子（QuitFlowScheduler 挂载时调用；幂等） */
export function ensureGroupSocialHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  onMemberKicked((group, targetId, actorName) => writeKickNotice(group, targetId, actorName));
  onMemberJoined((group, contactId) => markKickNoticeBack(group, contactId));
}

// ---------------- 联系人快照 ----------------

let contactsSnapshot: ContactRecord[] = [];

/** 宿主把联系人列表喂给本模块（App 渲染时调用；执行器/名单组装用，避免循环依赖联系人存储） */
export function setGroupSocialContacts(list: ContactRecord[]): void {
  contactsSnapshot = list;
}

function listContactsSnapshot(): ContactRecord[] {
  return contactsSnapshot;
}
