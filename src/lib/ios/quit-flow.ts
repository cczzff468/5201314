/**
 * 退群挽留流程（用户退出群聊后的 AI 主动行为）。
 *
 * 完整链路：
 * 1. 机主退出群聊 → groups.ts quitGroup() 触发退群钩子 → captureQuitSnapshot 快照
 *    （群对象 + 最近消息 + 群事件，随 kv 持久化，重启不丢）；
 * 2. QuitFlowScheduler（挂 PhoneShell，App 不打开也生效）每 5s tick：
 *    到点（退群后 20~50s，落在 1 分钟窗口内）选一位最合适的群成员（群主 AI → 管理员 → 普通成员，
 *    取在该 App 与机主互为好友的第一位），按人设 + 退群事件 + 群里最近发生的事 + 记忆生成一条
 *    主动私信，经 beginChatStream 全局总线流式发出并落进对应 App 的私聊（未读/预览自动刷新，
 *    机主正开着该私聊页还能实时看到「正在输入」气泡）。AI 按人设自判要不要私信（[SKIP] = 不发）；
 * 3. 机主回复私信（或主动私聊该群成员）→ 私聊管线经 activeQuitFlowFor 注入「退群背景」段：
 *    AI 可按人设与关系决定是否把机主拉回群（[拉回群聊]，仅群主/管理员有效，每次退群最多一次），
 *    回群后可授予身份（[设为管理员] / [转让群主]，仅群主有效），机主明确不想回来时
 *    （[放弃邀请]）彻底停止，不再反复拉群骚扰；
 * 4. 拉回群 = restoreQuitGroup 原样恢复群记录与最近消息（历史不断档），落「XX加入了群聊」
 *    事件并给群会话加未读；授予身份走 setGroupAdmin/transferGroupOwner（自动落系统消息）。
 *
 * 边界与纪律：
 * - 每次退群事件最多 1 条主动私信 + 最多 1 次拉群邀请（状态机保证，AI 再输出标记也会被吞掉）；
 * - 退群后机主若已先私信了该成员，则不再补发主动私信（避免重复打招呼）；
 * - 快照 24h 过期自动清理；同群再次退群覆盖旧快照，开启新一轮挽留；
 * - 解散群聊不触发挽留（群对所有人都没了）。
 */

import { addressNameOf, displayNameOf, isFriendIn, type ContactRecord } from '../contacts';
import { memRecallBlock, getMemSettings } from '../memory';
import { cleanBubbleText, extractRichActionParts, type RichAction } from '../chat-rich';
import { beginChatStream, isChatStreaming, type ChatPayloadMessage } from '../chat-stream-store';
import { qqUnreads, wxUnreads } from '../unread-store';
import { useSettings } from './store';
import { genId } from './db';
import { listContacts, ownerRealNameFor } from './contacts-store';
import {
  getGroup,
  groupRoleOf,
  onGroupQuit,
  restoreQuitGroup,
  setGroupAdmin,
  transferGroupOwner,
  type ChatGroup,
  type GroupApp,
  type WxGroupMsg,
} from './groups';
import { buildNpcPromptExtra } from './npc-bond';
import { buildPersonaSystemPrompt } from './persona';
import { kvDel, kvGet, kvSet } from './idb-kv';
import { pushChatNotification } from './island-notify';
// 【100-d】挽留私信补时间感知：与主动消息（proactive-msg）同一套会话级开关 + 构建函数
import { buildTimeAwareBlock, getTimeAware } from '../time-aware';

// ---------------- 状态与存储 ----------------

export interface QuitFlowState {
  gid: string;
  app: GroupApp;
  groupName: string;
  /** 退群时刻（快照基准 / 私信窗口与 TTL 的起点） */
  quitAt: number;
  /** 群快照（拉回群时原样恢复：成员/身份/禁言/公告全保留） */
  snapshot: ChatGroup;
  /** 退群前的最近群消息（含事件通知；私信参考 + 恢复历史两用） */
  recentMsgs: WxGroupMsg[];
  /** 主动私信状态 */
  dm: {
    /** 被选中的私信发起人（联系人 ID）；null = 尚未挑选 */
    contactId: string | null;
    /** 计划触发时间（quitAt + 20~50s，保证落在 1 分钟窗口内） */
    fireAt: number;
    /** 已发出时刻 */
    sentAt?: number;
    /** 不再私信（AI 人设拒绝 / 错过窗口 / 机主已先开口 / 找不到合适人选） */
    declined?: boolean;
    /** 发送失败次数（流被占用/请求失败；下一 tick 重试，超限放弃） */
    failed?: number;
  };
  /** 拉回群流程状态 */
  winback: {
    /** 已提出过邀请（每次退群最多一次） */
    offered?: boolean;
    /** 机主明确拒绝（彻底不再提） */
    refused?: boolean;
    /** 已拉回（流程完成） */
    resolved?: boolean;
  };
  /** 机主是被 AI 移出群聊（非主动退出）：私信与背景文案按被踢口径生成（旧数据缺省 = 主动退出） */
  kicked?: boolean;
}

const INDEX_KEY = 'quit-flow:index';
const stateKey = (gid: string) => `quit-flow:${gid}`;
/** 快照保质期：超过后整个流程作废（AI 不会再提退群的事，也不再拉群） */
export const QUIT_FLOW_TTL_MS = 24 * 60 * 60_000;
/** 私信宽限窗：计划触发点后还在窗内就发（页面曾关着导致调度中断时，重开尽快补上）；超窗放弃 */
const DM_WINDOW_MS = 10 * 60_000;
/** 同一次退群私信的最大重试次数（流一直被占用/一直失败时放弃） */
const DM_MAX_TRIES = 8;

function loadIndex(): string[] {
  try {
    const v = kvGet<string[]>(INDEX_KEY);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveIndex(v: string[]): void {
  try {
    kvSet(INDEX_KEY, v.slice(-20));
  } catch {
    // 忽略
  }
}

function loadState(gid: string): QuitFlowState | null {
  try {
    const v = kvGet<QuitFlowState>(stateKey(gid));
    if (!v || typeof v !== 'object' || typeof v.gid !== 'string' || !v.snapshot || !Array.isArray(v.recentMsgs)) return null;
    if (!v.dm || typeof v.dm.fireAt !== 'number') return null;
    if (!v.winback || typeof v.winback !== 'object') v.winback = {};
    return v;
  } catch {
    return null;
  }
}

function saveState(st: QuitFlowState): void {
  try {
    kvSet(stateKey(st.gid), st);
    const idx = loadIndex();
    if (!idx.includes(st.gid)) saveIndex([...idx, st.gid]);
  } catch {
    // 忽略
  }
}

function deleteState(gid: string): void {
  try {
    kvDel(stateKey(gid));
  } catch {
    // 忽略
  }
  saveIndex(loadIndex().filter((x) => x !== gid));
}

// ---------------- 退群快照（钩子） ----------------

/**
 * 退群钩子入口：快照群与最近消息，开启一轮挽留流程。
 * 同群旧快照直接覆盖（再次退群 = 新一轮，邀请/私信配额重置）。
 * opts.kicked = 机主是被 AI 移出群聊（私信/背景文案按被踢口径生成）。
 */
export function captureQuitSnapshot(group: ChatGroup, msgs: WxGroupMsg[], opts?: { kicked?: boolean }): void {
  const st: QuitFlowState = {
    gid: group.id,
    app: group.app,
    groupName: group.name,
    quitAt: Date.now(),
    snapshot: group,
    recentMsgs: msgs.slice(-40),
    dm: { contactId: null, fireAt: Date.now() + 8_000 + Math.floor(Math.random() * 12_000) },
    winback: {},
    kicked: opts?.kicked === true || undefined,
  };
  saveState(st);
}

let hookInstalled = false;

/** 注册退群钩子（QuitFlowScheduler 挂载时调用；幂等；opts.kicked 透传被踢口径） */
export function ensureQuitHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  onGroupQuit((g, msgs, opts) => captureQuitSnapshot(g, msgs, opts));
}

// ---------------- 私聊侧：退群背景注入 ----------------

/** 机主展示名缓存（每 App 独立，tick 时刷新；退群背景段同步读取用，未就绪时回退「机主」）。
 *  v2 per-app 账号：wx/qq 账号独立——会话联系人查不到时按各自 App 当前账号的「我」回退
 *  （cachedOwnerNames，ownerRealNameFor 解析：大号=机主、小号/匿名号=其档案名） */
let cachedMeNames: { wx: string; qq: string } = { wx: '', qq: '' };
let cachedOwnerNames: { wx: string; qq: string } = { wx: '', qq: '' };

function meNameOf(app: GroupApp): string {
  return cachedMeNames[app] || cachedOwnerNames[app] || '机主';
}

/** 机主在该 App 的联系人 ID（会话登录账号；缺省回退字面量 'me' 兼容旧口径）。
 *  授予身份/禁言/踢人等群状态表的键统一用联系人 ID，与群创建时 ownerId = me.id 的口径一致。 */
function meContactId(app: GroupApp): string {
  try {
    const id = window.localStorage.getItem(app === 'wx' ? 'wx-session-user-id' : 'qq-session-user-id');
    return id || 'me';
  } catch {
    return 'me';
  }
}

export function refreshMeNameCache(contacts: ContactRecord[]): void {
  try {
    // 名字/昵称区分：缓存「称呼名」（默认真名「凡凡」；用户选了用昵称才是「凑凑」）——
    // 私信人设/退群背景/历史标注统一用称呼名指代机主，与聊天主链路同口径
    const mode = useSettings.getState().addressMode;
    const wxId = window.localStorage.getItem('wx-session-user-id');
    const qqId = window.localStorage.getItem('qq-session-user-id');
    const wxHit = wxId ? contacts.find((c) => c.id === wxId && c.kind === 'user') : null;
    const qqHit = qqId ? contacts.find((c) => c.id === qqId && c.kind === 'user') : null;
    cachedMeNames = {
      wx: wxHit ? addressNameOf(wxHit, mode) : '',
      qq: qqHit ? addressNameOf(qqHit, mode) : '',
    };
  } catch {
    // 忽略
  }
  // v2 per-app 账号：机主回退名按各 App 当前账号解析（wx/qq 账号独立，互不影响）
  void ownerRealNameFor('wx')
    .then((n) => {
      if (n) cachedOwnerNames.wx = n;
    })
    .catch(() => undefined);
  void ownerRealNameFor('qq')
    .then((n) => {
      if (n) cachedOwnerNames.qq = n;
    })
    .catch(() => undefined);
}

/** 群快照消息 → 可读文本行（「名字：内容」；富媒体按占位符） */
function snapshotMsgLine(m: WxGroupMsg, meName: string): string {
  const who = m.role === 'me' ? meName : m.senderName || '群成员';
  const text =
    m.kind === 'image'
      ? '[图片]'
      : m.kind === 'sticker'
        ? `[表情]${m.stk?.meaning ? ` ${m.stk.meaning}` : ''}`
        : m.kind === 'redpacket'
          ? '[红包]'
          : m.kind === 'transfer'
            ? '[转账]'
            : m.kind === 'location'
              ? `[位置] ${m.loc?.name ?? ''}`.trim()
              : m.recalled
                ? '（撤回了一条消息）'
                : m.content;
  return `${who}：${text}`;
}

/** 活跃退群挽留上下文（该联系人所在群有未完结的退群流程时返回注入段；否则 null） */
export interface QuitFlowContext {
  gid: string;
  groupName: string;
  app: GroupApp;
  /** 该联系人在群里的身份 */
  role: 'owner' | 'admin' | 'member';
  /** 是否有拉群权限（群主/管理员） */
  canInvite: boolean;
  /** 追加到私聊 system 的背景段 */
  section: string;
}

export function activeQuitFlowFor(contactId: string): QuitFlowContext | null {
  const now = Date.now();
  let best: QuitFlowState | null = null;
  for (const gid of loadIndex()) {
    const st = loadState(gid);
    if (!st) continue;
    // 已拒绝/过期：不再注入（已拉回的保留到 TTL，后续还可以授管理员/群主）
    if (st.winback.refused) continue;
    if (now - st.quitAt > QUIT_FLOW_TTL_MS) continue;
    if (!st.snapshot.memberIds.includes(contactId)) continue;
    if (!best || st.quitAt > best.quitAt) best = st;
  }
  if (!best) return null;
  const st = best;
  const meName = meNameOf(st.app);
  const role = groupRoleOf(st.snapshot, contactId);
  const canInvite = role === 'owner' || role === 'admin';
  // 已拉回：退群背景不再重复，只保留授身份能力（后续回复里仍可 [设为管理员]/[转让群主]）
  if (st.winback.resolved) {
    const lines = [`【群务】${meName}已经回到群聊「${st.groupName}」了，正常聊天即可。`];
    if (canInvite) {
      lines.push(
        '如果你想给 TA 管理员身份，在回复里单独输出一行 [设为管理员]；想让 TA 接任群主（仅你是群主时有效），输出 [转让群主]。' +
          '按你的性格和 TA 的意愿自然决定（TA 开口要就顺着给，TA 没提就不必主动兜售）；标记由系统执行并以群通知公示，标记本身不会显示。',
      );
    }
    return { gid: st.gid, groupName: st.groupName, app: st.app, role, canInvite, section: lines.join('\n') };
  }
  const lines: string[] = [];
  const evtLines = st.recentMsgs
    .filter((m) => m.evt && m.noticeText)
    .slice(-6)
    .map((m) => `- ${m.noticeText}`);
  const dlgLines = st.recentMsgs
    .filter((m) => m.kind !== 'notice' && !m.recalled)
    .slice(-8)
    .map((m) => `- ${snapshotMsgLine(m, meName)}`);
  const quitDesc = st.kicked ? `被移出了群聊「${st.groupName}」（不是 TA 自己退的）` : `刚刚退出了群聊「${st.groupName}」`;
  lines.push(
    `【退群背景】${meName}${quitDesc}（你是该群的${role === 'owner' ? '群主' : role === 'admin' ? '管理员' : '普通成员'}）。这件事你从群里知道了，TA 私下找你聊天时你可以按人设与你们的关系自然面对这件事。退群前后群里最近的情况：`,
  );
  if (evtLines.length > 0) lines.push('最近事件：', ...evtLines);
  if (dlgLines.length > 0) lines.push('最近对话：', ...dlgLines);
  if (canInvite) {
    lines.push(
      '要不要提起退群、怎么提，完全由你的性格和你们的关系决定（不必每次都提，也不必刻意挽留）。' +
        '如果你真心想请 TA 回到群里（符合你的性格才提；这个邀请最多只能发一次，TA 明确拒绝过就绝不再提），' +
        '在回复里单独输出一行标记 [拉回群聊]，系统会把 TA 拉回群里；' +
        'TA 回群后你想让 TA 当管理员，可以再输出一行 [设为管理员]；想让 TA 接任群主（仅你是群主时有效），输出 [转让群主]。',
      // 拉回群·执行铁律（防「我说拉回来了但实际没拉」）：标记是唯一执行方式，系统通知是唯一凭据
      '【拉回群·执行铁律】[拉回群聊] 标记是唯一真的能把 TA 拉回群的方式——只在正文里说「我把你拉回来了」「我拉一下」而没输出标记，系统不会执行任何操作，TA 也绝不会回到群里；' +
        '拉回是否成功以群里出现的系统通知「XX加入了群聊」为准，没看到这条通知就等于没拉成，绝不能在没输出标记的情况下声称已经把 TA 拉回群里；' +
        '如果标记输出后系统没有公示「XX加入了群聊」，要如实告诉 TA「没拉成/可能拉不了」，绝不能嘴上说成功了。',
    );
  } else {
    lines.push(
      '（你不是这个群的群主或管理员，没有办法把 TA 拉回群。TA 让你拉 TA 回去时，必须如实说明你拉不了——你不是群主/管理员，系统不会执行你的拉回操作；可以建议 TA 自己从群聊里重新加入，或让 TA 找群主。绝不能假装已经把 TA 拉回来了。）',
    );
  }
  lines.push(
    '如果你判断 TA 明确不想回来、拒绝了你的邀请，输出一行 [放弃邀请]，之后彻底不再提拉回群的事，也不要纠缠。',
    '标记系统会执行并以群通知公示，标记本身不会显示；想说的话都用正文按你的人设正常说。',
  );
  if (st.winback.offered) {
    lines.push('（你已经邀请过 TA 一次了，不要再输出 [拉回群聊]，耐心等 TA 的决定。）');
  }
  return { gid: st.gid, groupName: st.groupName, app: st.app, role, canInvite, section: lines.join('\n') };
}

// ---------------- 私聊侧：挽留动作执行 ----------------

/** 进行中的群恢复（同一群的恢复串行化：[拉回群聊] 与同回复里后续的 [设为管理员]/[转让群主] 有先后依赖） */
const restoreInFlight = new Map<string, Promise<void>>();

function restoreFlowGroup(st: QuitFlowState): Promise<void> {
  const existing = restoreInFlight.get(st.gid);
  if (existing) return existing;
  const p = (async () => {
    try {
      // 先挂群未读再恢复：宿主列表监听恢复事件刷新后，幽灵未读清理才不会把它当成列表外残留删掉
      (st.app === 'wx' ? wxUnreads : qqUnreads).bump(`group:${st.gid}`, 1);
      // 多账号 v2：拉回群落「机主加入了群聊」事件，名字按该群所属 App 的当前账号取「我」
      const owner = await ownerRealNameFor(st.app);
      restoreQuitGroup(st.snapshot, st.recentMsgs, { joinName: owner || '机主' });
      // 通知宿主（微信/QQ App 根组件）刷新群列表，恢复的群立即可见
      try {
        window.dispatchEvent(new CustomEvent('quit-flow:group-restored', { detail: { gid: st.gid, app: st.app } }));
      } catch {
        // 忽略
      }
    } catch {
      // 拉群失败不影响聊天
    }
  })();
  restoreInFlight.set(st.gid, p);
  void p.catch(() => undefined).then(() => restoreInFlight.delete(st.gid));
  return p;
}

/** 等同群的恢复落定后执行授身份动作（恢复已完成后立即执行） */
function afterRestore(st: QuitFlowState, grant: () => void): void {
  const p = restoreInFlight.get(st.gid) ?? Promise.resolve();
  void p
    .then(grant)
    .catch(() => undefined);
}

/**
 * 执行私聊 AI 回复里的挽留动作（[拉回群聊]/[设为管理员]/[转让群主]/[放弃邀请]）。
 * 返回 true 表示动作属于挽留流程（调用方不再按红包/转账卡片动作处理）。
 * 权限与配额在此硬性校验：无权限/已邀请过/已拒绝的标记一律吞掉不执行（防骚扰兜底）。
 */
export function applyQuitWinbackAction(contactId: string, action: RichAction): boolean {
  const ctx = activeQuitFlowFor(contactId);
  if (!ctx) return false;
  const st = loadState(ctx.gid);
  if (!st) return false;
  switch (action.kind) {
    case 'reinvite-user': {
      if (st.winback.refused) return true;
      // 已拉回过：群已真实恢复 → 吞掉重复标记；群不存在（上次恢复失败/被手动删除）→ 允许幂等重拉一次
      if (st.winback.resolved || st.winback.offered) {
        if (getGroup(st.gid)) return true;
      }
      if (ctx.role !== 'owner' && ctx.role !== 'admin') return true; // 无权限：吞掉
      st.winback.offered = true;
      st.winback.resolved = true;
      saveState(st);
      void restoreFlowGroup(st);
      return true;
    }
    case 'grant-admin': {
      if (!st.winback.resolved) return true; // 人还没回群：忽略（提示词要求先拉回）
      void afterRestore(st, () => {
        const g = getGroup(st.gid);
        if (!g || groupRoleOf(g, contactId) !== 'owner') return; // 只有群主能给管理员
        const meId = meContactId(st.app);
        void ownerRealNameFor(st.app)
          .then((owner) => setGroupAdmin(st.gid, meId, true, { name: owner || '机主' }))
          .catch(() => undefined);
      });
      return true;
    }
    case 'grant-owner': {
      if (!st.winback.resolved) return true;
      void afterRestore(st, () => {
        const g = getGroup(st.gid);
        if (!g || groupRoleOf(g, contactId) !== 'owner') return; // 只有群主能转让
        const meId = meContactId(st.app);
        void ownerRealNameFor(st.app)
          .then((owner) => transferGroupOwner(st.gid, meId, { name: owner || '机主' }))
          .catch(() => undefined);
      });
      return true;
    }
    case 'abandon-invite': {
      st.winback.refused = true;
      saveState(st);
      return true;
    }
    default:
      return false;
  }
}

// ---------------- 调度：主动私信 ----------------

/** [SKIP] 判定（人设自判不私信；与群聊组件同一口径） */
const SKIP_RE = /^\[?\s*(?:SKIP|跳过)\s*\]?$/i;

/** 私聊 kv 消息的最小读取形状（微信 WxMsg / QQ QQMsg 的公共子集） */
interface PrivateMsgLike {
  id?: string;
  role?: string;
  content?: string;
  time?: number;
  kind?: string;
  recalled?: boolean;
  stk?: { meaning?: string };
}

function loadPrivateMsgs(app: GroupApp, cid: string): PrivateMsgLike[] {
  try {
    const raw = kvGet<PrivateMsgLike[]>(`${app}-chat-msgs:${cid}`);
    return Array.isArray(raw) ? raw.filter((m) => m && typeof m === 'object') : [];
  } catch {
    return [];
  }
}

/** 把 AI 私信落进对应 App 的私聊（与各 App saveMsgs 同口径：封顶 + 未读 + 恢复被删会话） */
function persistPrivateAiMsg(app: GroupApp, cid: string, msg: { id: string; content: string; time: number }): void {
  try {
    const key = `${app}-chat-msgs:${cid}`;
    const list = loadPrivateMsgs(app, cid).map((m) => ({ ...m, role: m.role === 'me' ? 'me' : 'peer' }));
    const cap = app === 'wx' ? 100 : 200;
    kvSet(key, [...list, { id: msg.id, role: 'peer', content: msg.content, time: msg.time, kind: 'text' }].slice(-cap));
    // 微信：新消息自动恢复被「删除/不显示」的会话（与 wechat.tsx saveMsgs 行为一致）
    if (app === 'wx') {
      try {
        const raw = localStorage.getItem('wx-chat-hidden');
        if (raw) {
          const hid = JSON.parse(raw) as unknown;
          if (Array.isArray(hid) && hid.includes(cid)) {
            localStorage.setItem('wx-chat-hidden', JSON.stringify(hid.filter((x) => x !== cid)));
          } else if (hid && typeof hid === 'object' && cid in (hid as Record<string, unknown>)) {
            const map = hid as Record<string, unknown>;
            delete map[cid];
            localStorage.setItem('wx-chat-hidden', JSON.stringify(map));
          }
        }
      } catch {
        // 忽略
      }
    }
    (app === 'wx' ? wxUnreads : qqUnreads).bump(cid, 1);
  } catch {
    // 忽略
  }
}

/** 私聊历史 → 请求消息（最近 8 条；撤回/通知跳过，富媒体按占位符） */
function privateHistory(app: GroupApp, cid: string, meName: string): ChatPayloadMessage[] {
  return loadPrivateMsgs(app, cid)
    .filter((m) => !m.recalled && m.kind !== 'notice' && typeof m.content === 'string' && m.content !== '')
    .slice(-8)
    .map((m) => {
      const text =
        m.kind === 'image'
          ? '[图片]'
          : m.kind === 'sticker'
            ? `[发送了表情：${m.stk?.meaning || '无描述'}]`
            : (m.content ?? '');
      return m.role === 'me'
        ? { role: 'user' as const, content: `${meName}：${text}` }
        : { role: 'assistant' as const, content: text };
    });
}

/**
 * 发送一条退群主动私信（所选成员按人设生成；[SKIP] = 该角色不愿主动私信）。
 * 返回 'sent'（已进入流式，结果在 finalize 落盘）/ 'skip'（人设放弃或无人可选）/ 'retry'（流被占用，下轮再试）。
 */
async function sendQuitDm(st: QuitFlowState, contacts: ContactRecord[]): Promise<'sent' | 'skip' | 'retry'> {
  const app = st.app;
  // 选人（只选一次，固定不变）：群主 AI → 管理员 → 普通成员，第一个「在该 App 与机主互为好友」的
  if (!st.dm.contactId) {
    const ordered = [
      ...(st.snapshot.ownerId && st.snapshot.ownerId !== 'me' ? [st.snapshot.ownerId] : []),
      ...st.snapshot.adminIds.filter((id) => id !== 'me' && id !== st.snapshot.ownerId),
      ...st.snapshot.memberIds.filter((id) => id !== st.snapshot.ownerId),
    ];
    const hit = ordered
      .map((id) => contacts.find((c) => c.id === id))
      .find((c): c is ContactRecord => !!c && c.kind !== 'user' && isFriendIn(c, app));
    if (!hit) return 'skip';
    st.dm.contactId = hit.id;
    saveState(st);
  }
  const contact = contacts.find((c) => c.id === st.dm.contactId);
  if (!contact) return 'skip';
  const sKey = `${app}:${contact.id}`;
  if (isChatStreaming(sKey)) return 'retry'; // 机主正和 TA 聊着（AI 回合中）：下一 tick 再试

  const meName = meNameOf(app);
  const channel = app === 'wx' ? '微信' : 'QQ';
  const npcExtra = buildNpcPromptExtra(contact, contacts);
  const share = getMemSettings(contact.id).share;
  const quitFact = st.kicked
    ? `你（或群里的管理员）刚刚把${meName}移出了群聊「${st.groupName}」`
    : `${meName}刚刚退出了群聊「${st.groupName}」`;
  const lastUserTurn =
    `【刚刚发生的事】${quitFact}（这是系统事件，不是 TA 发给你的消息）。` +
    `你现在决定要不要主动私信 TA。说什么、怎么说，完全按你的人设和你们的关系来：可以关心、问原因、道歉、挽留、吐槽，也可以装作随意聊起群里最近的事，甚至觉得没必要打扰就保持沉默。` +
    `要私信就直接输出你发给 TA 的正文（一两句话，像真人随手打字）；如果你觉得以你的性格根本不会主动私信，只回复 [SKIP]。`;
  const dmRules = [
    '这是你主动发起的一轮：没有对方刚发来的消息需要回应，不要自我介绍式的突兀开场，像平时给 TA 发消息一样自然。',
    '不要提及「系统」「通知」「标记」等幕后词汇，输出的正文就是私信本身。',
  ];
  const system = buildPersonaSystemPrompt(contact, {
    channel,
    userName: meName,
    ownerName: npcExtra?.ownerLabel ?? null,
    multiApp: share,
    ...npcExtra,
    extraRules: dmRules,
  });
  const memContext = [`${meName}退出了群聊「${st.groupName}」`, `为什么退群`, `和${meName}的关系`, ...st.recentMsgs.filter((m) => m.kind !== 'notice' && !m.recalled).slice(-4).map((m) => snapshotMsgLine(m, meName))]
    .join(' ');
  const memoryBlock = memRecallBlock(contact.id, app, memContext, { interopOn: () => share });
  // 时间感知（【100-d】）：挽留私信与主动消息同一套开关判断（会话级 time-aware，sKey = wx/qq:<cid> 与
  // 主聊天同键）与同一构建函数；开关关闭时 timeBlock 为空串，sysFull 结构与注入行为和之前完全一致。
  // 修复：深夜触发的挽留私信没有时间参照，可能发出不合时宜的元气挽留
  const lastPrivMsgTime = (() => {
    const msgs = loadPrivateMsgs(app, contact.id);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const t = msgs[i].time;
      if (typeof t === 'number' && t > 0) return t;
    }
    return null;
  })();
  const timeBlock = getTimeAware(sKey)
    ? buildTimeAwareBlock({ lastMsgTime: lastPrivMsgTime, regionHint: contact.region || null })
    : '';
  // 群聊近况（需求五.3：私信要参考群里最近发生的事件和对话）——从退群快照取，退群前的真实在场记录
  const evtLines = st.recentMsgs
    .filter((m) => m.evt && m.noticeText)
    .slice(-6)
    .map((m) => `- ${m.noticeText}`);
  const dlgLines = st.recentMsgs
    .filter((m) => m.kind !== 'notice' && !m.recalled)
    .slice(-8)
    .map((m) => `- ${snapshotMsgLine(m, meName)}`);
  const recentBlock =
    evtLines.length > 0 || dlgLines.length > 0
      ? ['【群聊近况】退群前群里的情况（你都在场，这些是真实发生过的）：', ...(evtLines.length > 0 ? ['最近事件：', ...evtLines] : []), ...(dlgLines.length > 0 ? ['最近对话：', ...dlgLines] : [])].join('\n')
      : '';
  const sysFull = [system, recentBlock, memoryBlock, timeBlock].filter(Boolean).join('\n\n');
  const quitAt = st.quitAt;
  const ok = beginChatStream({
    sessionKey: sKey,
    aiMsgId: genId(),
    messages: [
      { role: 'system', content: sysFull },
      ...privateHistory(app, contact.id, meName),
      { role: 'user', content: lastUserTurn },
    ],
    apiConfig: useSettings.getState().apiConfig,
    replyCount: 1,
    finalize: (result) => {
      const cur = loadState(st.gid);
      const text = (result.content ?? '').trim();
      // 失败 / 空回复 / 人设拒绝（[SKIP]）：记失败重试或放弃；错误文案不落盘（私信没有「重试」按钮可给）
      if (result.error || !text || SKIP_RE.test(text)) {
        if (cur && cur.quitAt === quitAt && !cur.dm.sentAt) {
          cur.dm.failed = (cur.dm.failed ?? 0) + 1;
          if (result.error || cur.dm.failed >= DM_MAX_TRIES) cur.dm.declined = true;
          saveState(cur);
        }
        return;
      }
      // 剥掉任何动作标记（私信不该有管理/卡片标记，兜底防漏），首尾清洗
      const clean = cleanBubbleText(
        extractRichActionParts(text)
          .map((p) => (p.type === 'text' ? p.text : ''))
          .join(' ')
          .trim(),
      );
      const finalText = clean || '……';
      persistPrivateAiMsg(app, contact.id, { id: result.aiMsgId, content: finalText, time: Date.now() });
      // 灵动岛全局通知：AI 主动私信也弹（App 不打开也会推送；点击跳对应私聊）
      pushChatNotification({
        sessionKey: `${app}:${contact.id}`,
        app: app === 'wx' ? 'wechat' : 'qq',
        title: contact.name,
        avatar: contact.avatar ?? null,
        body: finalText,
        target: app === 'wx' ? { app: 'wechat', contactId: contact.id } : { app: 'qq', contactId: contact.id },
      });
      const cur2 = loadState(st.gid);
      if (cur2 && cur2.quitAt === quitAt && !cur2.dm.sentAt) {
        cur2.dm.sentAt = Date.now();
        saveState(cur2);
      }
    },
  });
  return ok ? 'sent' : 'retry';
}

/**
 * 调度 tick（QuitFlowScheduler 每 5s 调一次）：
 * - 清理已完结/过期的快照；
 * - 到点且在窗口内的退群 → 发起主动私信（失败/被占用自动重试，超限放弃）。
 */
export async function runQuitFlowTick(contacts: ContactRecord[]): Promise<void> {
  const now = Date.now();
  refreshMeNameCache(contacts);
  for (const gid of loadIndex()) {
    const st = loadState(gid);
    if (!st) {
      deleteState(gid);
      continue;
    }
    // 已拒绝 / 过期：清理。已拉回（resolved）的保留到 TTL——后续回复里 AI 还可以授管理员/群主
    if (st.winback.refused || now - st.quitAt > QUIT_FLOW_TTL_MS) {
      deleteState(gid);
      continue;
    }
    if (st.dm.sentAt || st.dm.declined) continue;
    if (now < st.dm.fireAt) continue;
    // 机主退群后已经先私聊过该成员：不再补发主动私信（避免重复打招呼），背景注入走正常聊天
    const dmContact = st.dm.contactId
      ? contacts.find((c) => c.id === st.dm.contactId)
      : null;
    if (dmContact) {
      const lastMine = loadPrivateMsgs(st.app, dmContact.id)
        .filter((m) => m.role === 'me' && typeof m.time === 'number')
        .pop();
      if (lastMine && typeof lastMine.time === 'number' && lastMine.time > st.quitAt) {
        st.dm.declined = true;
        saveState(st);
        continue;
      }
    }
    if (now > st.quitAt + DM_WINDOW_MS || (st.dm.failed ?? 0) >= DM_MAX_TRIES) {
      st.dm.declined = true;
      saveState(st);
      continue;
    }
    try {
      await sendQuitDm(st, contacts);
    } catch {
      // 挽留是增强能力：单群失败不影响其他群
    }
  }
}

/** 当前是否存在活跃的退群挽留（调试/测试辅助） */
export function hasActiveQuitFlow(): boolean {
  const now = Date.now();
  return loadIndex().some((gid) => {
    const st = loadState(gid);
    return !!st && !st.winback.resolved && !st.winback.refused && now - st.quitAt <= QUIT_FLOW_TTL_MS;
  });
}
