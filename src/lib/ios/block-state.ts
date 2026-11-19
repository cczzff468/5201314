'use client';

/**
 * 双向拉黑状态（QQ / 微信 / 信息三个 App 的单聊；按 App × 角色 ID 隔离持久化）：
 *
 * - 两方向独立：byUser = 用户拉黑了角色；byChar = 角色拉黑了用户（可同时为真 = 互拉）。
 * - 40-a 重构：拉黑会拦截「本 App 内」的消息发送——byUser=true 时角色不能给用户发任何消息
 *   （各 App 的 AI 回合入口前置守卫 + chat-stream-store 第二层兜底 + 通话续聊落库守卫）；
 *   byChar=true 时用户不能给角色发任何消息（各 App 的用户发送入口前置守卫 + toast 提示）。
 *   唯一例外是「解除拉黑申请卡片」：双向都可以发（角色用 [申请解除拉黑:理由] 标记，
 *   用户用输入区上方的「发送解除申请」入口），由对方决定同意或拒绝——
 *   角色侧决策标记 [同意解除拉黑]/[拒绝解除拉黑] 由 AI 在回复里输出。
 *   拉黑只限制当前 App：微信拉黑不影响 QQ/信息/电话联系（存储键即隔离边界，跨 App 天然不受限）。
 * - 单聊和群聊完全独立：群聊不读不写这里的任何状态；三个 App 之间也互相独立
 *   （存储键即隔离边界：wx-block:<id> / qq-block:<id> / sms-block:<id>）。
 * - 持久化在 IndexedDB kv store（idb-kv 内存同步读 + 异步写穿），重启 App 后保留。
 * - 角色可主动 [拉黑] / [解除拉黑]，所有状态变更都生成系统消息。
 * - 无拉黑状态时 system 也会注入「拉黑能力声明」（buildBlockPromptBlock）：告知角色可以
 *   输出 [拉黑]/[解除拉黑] 标记、且说到必须做到（只在嘴上说拉黑而不输出标记 = 系统不记录 = 说话是假的），
 *   这是「角色说拉黑就真的拉黑」的一致性保证。
 * - 拉黑区间：每次拉黑记录开始时间（byUserAt/byCharAt），解除时记录结束时间（Until）；
 *   解除后重新拉黑会把旧周期归档进 Hist。气泡拉黑图标按「消息时间是否落在拉黑区间内」显示——
 *   拉黑前的历史消息不标、拉黑期间发的消息恒标（解除后也不消失）、解除后新消息不标。
 */

import { kvGet, kvSet, kvDel } from './idb-kv';
import type { RichAction } from '@/lib/chat-rich';

export type BlockApp = 'wx' | 'qq' | 'sms';

/** 各 App 的场景名（system 注入用） */
export const BLOCK_CHANNEL: Record<BlockApp, string> = { wx: '微信', qq: 'QQ', sms: '短信' };

/** 一段已结束（或当前进行中）的拉黑区间 [at, until)；until 缺省 = 仍在拉黑中（仅 Hist 归档外使用） */
export interface BlockSpan {
  at: number;
  until?: number;
}

/** 单个会话的拉黑状态（全部字段可选，空对象 = 无任何拉黑关系） */
export interface BlockEntry {
  /** 用户拉黑了角色 */
  byUser?: boolean;
  /** 角色拉黑了用户 */
  byChar?: boolean;
  /** 当前这轮「用户拉黑角色」的开始时间（气泡图标区间判定用） */
  byUserAt?: number;
  /** 最近一轮「用户拉黑角色」的结束时间（解除拉黑时写入；进行中无值） */
  byUserUntil?: number;
  /** 往期已结束的「用户拉黑角色」区间（解除后重新拉黑时归档；图标按区间保留） */
  byUserHist?: BlockSpan[];
  /** 当前这轮「角色拉黑用户」的开始时间 */
  byCharAt?: number;
  /** 最近一轮「角色拉黑用户」的结束时间（解除时写入；进行中无值） */
  byCharUntil?: number;
  /** 往期已结束的「角色拉黑用户」区间 */
  byCharHist?: BlockSpan[];
  /** 待处理的解除申请理由（有值 = 角色发起的申请正等用户处理） */
  reqReason?: string;
  /** 申请发起时间 */
  reqAt?: number;
  /** 最近一次申请被拒绝的时间（角色要知道被拒绝） */
  rejectedAt?: number;
  /** 当前拉黑周期内被拒绝的申请次数（防骚扰：达到上限后不再受理新申请） */
  reqCount?: number;
  /** 用户发起的解除拉黑申请：理由（有值且 userReqStatus==='pending' = 正等角色处理；终态后保留供追溯） */
  userReqReason?: string;
  /** 用户申请发起时间 */
  userReqAt?: number;
  /** 用户申请状态：pending=待角色决策 accepted=角色同意（byChar 已清） rejected=角色拒绝 */
  userReqStatus?: 'pending' | 'accepted' | 'rejected';
  /** 当前 byChar 拉黑周期内用户申请被角色拒绝的次数（防骚扰：达到上限后不再受理新申请） */
  userReqRejectedCount?: number;
}

/** 当前拉黑周期内申请被拒绝次数上限：达到后彻底不再受理（用户解除拉黑后重新拉黑才重置）。
 *  注意：已按用户要求移除「被拒后冷却期」——被拒后可以立即再次申请，只有次数上限拦截。 */
export const BLOCK_REQ_MAX_REJECTED = 3;

// ---------------- 用户「拉黑你」意图识别（拉黑方向修正：用户说拉黑 = 用户拉黑 AI，不是 AI 拉黑用户） ----------------

/**
 * 用户消息是否为「我要拉黑你」类明确拉黑宣言（用户反馈：我说拉黑你，应该是我把 AI 拉黑，
 * 但之前 AI 会误解并反过来拉黑用户——现在系统直接代为执行用户侧拉黑，AI 只需反应）。
 *
 * 刻意保守（只认明确的短宣言，防误伤）：
 * - 只认短句（≤16 字）且以拉黑宣言收尾；长句/威胁句（「别逼我拉黑你，不然…」）不算；
 * - 含否定词（不/别/没/取消/解除…）不算（「我不想拉黑你」「别拉黑」）；
 * - 含「把我拉黑/拉黑我/被拉黑」不算——那是用户要求被拉黑或询问，方向相反；
 * - 「你把我拉黑吧/你拉黑我」由 AI 自主决定是否照做（既有 [拉黑] 标记链路），不在此拦截。
 */
/** B2：用户是否在任一文字 App（wx/qq/sms）拉黑了该联系人——跨域 AI 自发 engage 的
 *  全局静默闸：单聊拉黑后，AI 通过其他 App 的「自发邀约/自主下单」通道找用户会穿帮
 *  （聊天回合与标记类动作已被回合入口守卫/白名单拦住，这里补齐调度型自发行为的全域停） */
export function userBlockedAnywhere(contactId: string): boolean {
  for (const app of ['wx', 'qq', 'sms'] as BlockApp[]) {
    try {
      if (loadBlock(app, contactId).byUser) return true;
    } catch {
      /* 单端读失败不影响其他端 */
    }
  }
  return false;
}

export function isUserBlockIntent(text: string): boolean {
  const t = (text ?? '').trim().replace(/[。！!？?～~，,\s]+$/g, '');
  if (!t || t.length > 16) return false;
  if (/不|别|莫|勿|没|取消|解除|撤销|开玩|逗你/.test(t)) return false;
  if (/把\s*我\s*拉黑|拉黑\s*我|被\s*拉黑|把我?给?拉黑了/.test(t)) return false;
  return /(把你?拉黑|将你拉黑|拉黑你?|我要拉黑|我想拉黑|我来拉黑|我去拉黑|我准备拉黑|我打算拉黑|我拉黑你)/.test(t);
}

const blockKey = (app: BlockApp, contactId: string) => `${app}-block:${contactId}`;

function normalize(v: unknown): BlockEntry {
  const e = (v && typeof v === 'object' ? v : {}) as BlockEntry;
  const num = (x: unknown): number | undefined => (typeof x === 'number' && isFinite(x) ? x : undefined);
  const span = (x: unknown): BlockSpan | null => {
    const s = (x && typeof x === 'object' ? x : {}) as Partial<BlockSpan>;
    const at = num(s.at);
    if (at === undefined) return null;
    return { at, until: num(s.until) };
  };
  const spans = (x: unknown): BlockSpan[] | undefined => {
    if (!Array.isArray(x)) return undefined;
    const arr = x.map(span).filter((s): s is BlockSpan => s !== null);
    return arr.length ? arr : undefined;
  };
  return {
    byUser: e.byUser === true || undefined,
    byChar: e.byChar === true || undefined,
    byUserAt: num(e.byUserAt),
    byUserUntil: num(e.byUserUntil),
    byUserHist: spans(e.byUserHist),
    byCharAt: num(e.byCharAt),
    byCharUntil: num(e.byCharUntil),
    byCharHist: spans(e.byCharHist),
    reqReason: typeof e.reqReason === 'string' && e.reqReason.trim() ? e.reqReason.trim().slice(0, 80) : undefined,
    reqAt: typeof e.reqAt === 'number' ? e.reqAt : undefined,
    rejectedAt: typeof e.rejectedAt === 'number' ? e.rejectedAt : undefined,
    reqCount: typeof e.reqCount === 'number' && e.reqCount > 0 ? e.reqCount : undefined,
    userReqReason:
      typeof e.userReqReason === 'string' && e.userReqReason.trim() ? e.userReqReason.trim().slice(0, 80) : undefined,
    userReqAt: typeof e.userReqAt === 'number' ? e.userReqAt : undefined,
    userReqStatus:
      e.userReqStatus === 'pending' || e.userReqStatus === 'accepted' || e.userReqStatus === 'rejected'
        ? e.userReqStatus
        : undefined,
    userReqRejectedCount:
      typeof e.userReqRejectedCount === 'number' && e.userReqRejectedCount > 0 ? e.userReqRejectedCount : undefined,
  };
}

/** 读某会话的拉黑状态（kv 内存同步读；无记录 = 空状态） */
export function loadBlock(app: BlockApp, contactId: string): BlockEntry {
  try {
    return normalize(kvGet(blockKey(app, contactId)));
  } catch {
    return {};
  }
}

/** 写某会话的拉黑状态；entry 为空对象时删除键（保持存储干净） */
export function saveBlock(app: BlockApp, contactId: string, entry: BlockEntry): BlockEntry {
  const n = normalize(entry);
  const empty =
    !n.byUser && !n.byChar &&
    !n.byUserAt && !n.byUserUntil && !n.byUserHist &&
    !n.byCharAt && !n.byCharUntil && !n.byCharHist &&
    !n.reqReason && !n.reqAt && !n.rejectedAt && !n.reqCount &&
    !n.userReqReason && !n.userReqAt && !n.userReqStatus && !n.userReqRejectedCount;
  try {
    if (empty) kvDel(blockKey(app, contactId));
    else kvSet(blockKey(app, contactId), n);
  } catch {
    // 忽略持久化失败（内存态照常返回）
  }
  return n;
}

/**
 * 用户设置/解除对角色的拉黑（设置页开关用）。
 * 只动 byUser，不影响 byChar（两个方向独立）；返回最新状态。
 * 拉黑 → 记录开始时间（新周期）；解除 → 记录结束时间（区间保留供图标显示）+ 清空申请计数/拒绝记录；
 * 重新拉黑 → 旧周期归档进 Hist、开新周期（计数归零）。
 */
export function setUserBlock(app: BlockApp, contactId: string, blocked: boolean): BlockEntry {
  const cur = loadBlock(app, contactId);
  if (blocked) {
    if (cur.byUser) return cur; // 已是拉黑态：保留申请冷却/计数（防用开关重置骚扰防护）
    const hist = [...(cur.byUserHist ?? [])];
    if (cur.byUserAt !== undefined && cur.byUserUntil !== undefined) hist.push({ at: cur.byUserAt, until: cur.byUserUntil });
    const saved = saveBlock(app, contactId, {
      ...cur,
      byUser: true,
      byUserAt: Date.now(),
      byUserUntil: undefined,
      byUserHist: hist.length ? hist : undefined,
      reqReason: undefined,
      reqAt: undefined,
      rejectedAt: undefined,
      reqCount: undefined,
    });
    // G-1 拉黑后跨 App 主动找：跃迁时刻（从未拉黑 → 拉黑）触发角色立刻（无冷却）去其余
    // 未拉黑的 App 各发一条「被拉黑所以来这边找你」的消息（fire-and-forget 全容错）。
    // 动态 import 防静态循环依赖（cross-app-reach 反向依赖本模块的 loadBlock/BLOCK_CHANNEL）。
    void import('./cross-app-reach')
      .then(({ triggerCrossAppReach }) => triggerCrossAppReach(app, contactId))
      .catch(() => undefined);
    return saved;
  }
  if (!cur.byUser) return cur; // 本来就没拉黑：幂等不动（不产生伪区间）
  return saveBlock(app, contactId, {
    ...cur,
    byUser: undefined,
    byUserUntil: Date.now(),
    reqReason: undefined,
    reqAt: undefined,
    rejectedAt: undefined,
    reqCount: undefined,
  });
}

/**
 * 角色侧动作（AI 标记触发）：
 * - block：角色拉黑用户（幂等）
 * - unblock：角色解除拉黑（幂等）
 * - request：角色申请解除「用户对自己的拉黑」——只在确实被拉黑且没有待处理申请时受理（幂等）
 * 返回 { entry, changed, reqCreated }：changed=false = 动作未产生状态变化（调用方可跳过系统消息）。
 */
export function applyCharBlockAction(
  app: BlockApp,
  contactId: string,
  kind: 'block' | 'unblock' | 'request',
  reason?: string
): { entry: BlockEntry; changed: boolean; reqCreated: boolean } {
  const cur = loadBlock(app, contactId);
  if (kind === 'block') {
    if (cur.byChar) return { entry: cur, changed: false, reqCreated: false };
    const hist = [...(cur.byCharHist ?? [])];
    if (cur.byCharAt !== undefined && cur.byCharUntil !== undefined) hist.push({ at: cur.byCharAt, until: cur.byCharUntil });
    const saved = saveBlock(app, contactId, {
      ...cur,
      byChar: true,
      byCharAt: Date.now(),
      byCharUntil: undefined,
      byCharHist: hist.length ? hist : undefined,
      userReqReason: undefined,
      userReqAt: undefined,
      userReqStatus: undefined,
      userReqRejectedCount: undefined,
    });
    // G-3 角色拉黑用户后仍会主动去别的 App 找用户（消息 + 延时来电，方向 byChar）：
    // 跃迁时刻（从未拉黑 → 拉黑）触发，fire-and-forget 全容错。动态 import 防静态循环依赖。
    void import('./cross-app-reach')
      .then(({ triggerCrossAppReachByChar }) => triggerCrossAppReachByChar(app, contactId))
      .catch(() => undefined);
    return {
      entry: saved,
      changed: true,
      reqCreated: false,
    };
  }
  if (kind === 'unblock') {
    if (!cur.byChar) return { entry: cur, changed: false, reqCreated: false };
    // 40-a：角色主动解除拉黑时，用户侧待处理申请自然失效（清掉 pending，避免悬挂状态挡住后续申请）
    return {
      entry: saveBlock(app, contactId, {
        ...cur,
        byChar: undefined,
        byCharUntil: Date.now(),
        userReqReason: undefined,
        userReqAt: undefined,
        userReqStatus: undefined,
      }),
      changed: true,
      reqCreated: false,
    };
  }
  // request：必须当前真的被用户拉黑，且没有还没处理的申请（避免连环申请刷屏）；
  // 冷却期已按用户要求移除（被拒后可立即再申请）；拒绝次数达上限后彻底不再受理（新周期由用户重新拉黑开启）
  if (!cur.byUser || cur.reqReason) return { entry: cur, changed: false, reqCreated: false };
  if ((cur.reqCount ?? 0) >= BLOCK_REQ_MAX_REJECTED) {
    return { entry: cur, changed: false, reqCreated: false };
  }
  // #82：标记缺理由（空/纯空白）时不发起申请（changed=false，让 AI 下轮重写），
  // 避免强制落「想和你和好」默认理由与 AI 实际意图不符（AI 输出空标记 [申请解除拉黑:] 时不受理）
  const reasonTrim = (reason ?? '').trim().slice(0, 80);
  if (!reasonTrim) return { entry: cur, changed: false, reqCreated: false };
  return {
    entry: saveBlock(app, contactId, { ...cur, reqReason: reasonTrim, reqAt: Date.now() }),
    changed: true,
    reqCreated: true,
  };
}

/** 用户同意角色的解除申请：清除 byUser 与待处理申请（byChar 不受影响）；防骚扰计数一并清零；拉黑区间保留供图标显示 */
export function acceptBlockReq(app: BlockApp, contactId: string): BlockEntry {
  const cur = loadBlock(app, contactId);
  return saveBlock(app, contactId, {
    ...cur,
    byUser: undefined,
    byUserUntil: Date.now(),
    reqReason: undefined,
    reqAt: undefined,
    rejectedAt: undefined,
    reqCount: undefined,
  });
}

/** 用户拒绝角色的解除申请：拉黑保持，记录拒绝时间与累计次数（角色要知道被拒绝），清掉待处理申请 */
export function rejectBlockReq(app: BlockApp, contactId: string): BlockEntry {
  const cur = loadBlock(app, contactId);
  return saveBlock(app, contactId, {
    ...cur,
    byUser: true,
    reqReason: undefined,
    reqAt: undefined,
    rejectedAt: Date.now(),
    reqCount: (cur.reqCount ?? 0) + 1,
  });
}

/**
 * 40-a：AI「仅申请卡」放行模式判定——用户拉黑了角色（byUser）后，本 App 内 AI 不能发任何消息，
 * 但角色仍可发起「解除拉黑申请卡片」（需求：拉黑后只保留解除拉黑申请通道）：
 * 当前没有待处理申请（reqReason 为空）且本周期被拒次数未达上限时，AI 回合仍会发起
 *（角色需要看到消息才有机会申请解除），但回复中除申请卡片/系统行外的所有正文由调用方丢弃。
 * 该函数同时被各 App 的回合入口守卫与 chat-stream-store 第二层兜底使用（两处条件必须一致）。
 */
export function charRequestOnlyOf(b: BlockEntry): boolean {
  return b.byUser === true && !b.reqReason && (b.reqCount ?? 0) < BLOCK_REQ_MAX_REJECTED;
}

/**
 * 40-a：用户→角色发起「解除拉黑申请」（双向对等；byChar 拉黑下用户唯一的例外发送通道）：
 * 只在确实被角色拉黑（byChar=true）、没有待处理申请、本周期被拒次数未达上限时受理；
 * created=false = 未创建（未拉黑/已有 pending/已达上限，调用方不落卡不注入事件）。
 */
export function applyUserBlockReq(app: BlockApp, contactId: string, reason?: string): { entry: BlockEntry; created: boolean } {
  const cur = loadBlock(app, contactId);
  if (!cur.byChar || cur.userReqStatus === 'pending') return { entry: cur, created: false };
  if ((cur.userReqRejectedCount ?? 0) >= BLOCK_REQ_MAX_REJECTED) return { entry: cur, created: false };
  return {
    entry: saveBlock(app, contactId, {
      ...cur,
      userReqReason: (reason ?? '').trim().slice(0, 80) || '想和你和好',
      userReqAt: Date.now(),
      userReqStatus: 'pending',
    }),
    created: true,
  };
}

/**
 * 40-a：角色对「用户发来的解除拉黑申请」的决策落库（AI 标记 [同意解除拉黑]/[拒绝解除拉黑] 触发）：
 * - accept：解除 byChar（区间照常记录）+ 申请置为 accepted + 被拒计数清零；
 * - reject：拉黑保持 + 申请置为 rejected + 本周期被拒计数 +1（防骚扰上限与角色侧同口径）。
 * 没有 pending 申请时 changed=false（调用方跳过系统消息/卡片终态——标记与状态对不上时静默忽略）。
 */
export function resolveUserReqByChar(app: BlockApp, contactId: string, accept: boolean): { entry: BlockEntry; changed: boolean } {
  const cur = loadBlock(app, contactId);
  if (cur.userReqStatus !== 'pending') return { entry: cur, changed: false };
  if (accept) {
    return {
      entry: saveBlock(app, contactId, {
        ...cur,
        byChar: undefined,
        byCharUntil: Date.now(),
        userReqStatus: 'accepted',
        userReqRejectedCount: undefined,
      }),
      changed: true,
    };
  }
  return {
    entry: saveBlock(app, contactId, {
      ...cur,
      userReqStatus: 'rejected',
      userReqRejectedCount: (cur.userReqRejectedCount ?? 0) + 1,
    }),
    changed: true,
  };
}

/** AI 处理「用户发来的解除拉黑申请」的决策标记 → 动作种类（approve=同意 / deny=拒绝） */
export function userReqActionKindOf(a: RichAction): 'approve' | 'deny' | null {
  if (a.kind === 'approve-user-unblock') return 'approve';
  if (a.kind === 'deny-user-unblock') return 'deny';
  return null;
}

function spanCovers(h: BlockSpan[] | undefined, t: number): boolean {
  if (!h) return false;
  return h.some((r) => t >= r.at && (r.until === undefined || t < r.until));
}

/**
 * 气泡拉黑图标判定：t（消息时间）是否落在指定方向的拉黑区间内。
 * - 拉黑进行中：本周期开始（at）之后的消息恒显示（含解除后重新拉黑的往期区间）；
 *   旧数据无 at 时视为 0（全部显示，与旧行为一致）。
 * - 已解除：只显示落在任一已记录区间 [at, until) 内的消息——拉黑前的历史不标、
 *   拉黑期间的标记解除后不消失、解除后新消息不标。
 */
export function blockCoversAt(b: BlockEntry, dir: 'byUser' | 'byChar', t: number): boolean {
  if (dir === 'byUser') {
    if (b.byUser) return t >= (b.byUserAt ?? 0) || spanCovers(b.byUserHist, t);
    if (b.byUserUntil !== undefined && t >= (b.byUserAt ?? 0) && t < b.byUserUntil) return true;
    return spanCovers(b.byUserHist, t);
  }
  if (b.byChar) return t >= (b.byCharAt ?? 0) || spanCovers(b.byCharHist, t);
  if (b.byCharUntil !== undefined && t >= (b.byCharAt ?? 0) && t < b.byCharUntil) return true;
  return spanCovers(b.byCharHist, t);
}

/** AI 拉黑类动作标记（角色侧：拉黑/解除拉黑/申请解除）→ applyCharBlockAction 的动作种类 */
export function blockActionKindOf(a: RichAction): 'block' | 'unblock' | 'request' | null {
  if (a.kind === 'block-user') return 'block';
  if (a.kind === 'unblock-user') return 'unblock';
  if (a.kind === 'request-unblock') return 'request';
  return null;
}

/**
 * 双向拉黑的 system 注入块（每轮请求现场读取；40-a 起拉黑会真实拦截消息，提示词与拦截语义对齐）：
 * - 无拉黑状态时也注入「拉黑能力声明」（短，几行）：告知角色可以真的拉黑/解除拉黑用户，
 *   且说到必须做到——决定拉黑就必须输出 [拉黑] 标记，只嘴上说而系统不记录 = 说话是假的。
 *   这是「角色说拉黑就真的拉黑」的一致性保证（没有这段，角色只会口头配合，状态永远写不进去）。
 * - byUser（角色被拉黑）：回合入口只在「仍可发起解除申请」时放行（charRequestOnlyOf），
 *   且回复中除申请卡片外的正文一律被系统丢弃——明确告知角色普通消息送不到、
 *   唯一通道是 [申请解除拉黑:理由]（既有申请/被拒/达上限提示保留，文案改为拦截语义）。
 * - byChar（角色拉黑了用户）：告知用户的普通消息发不进来、自己仍可发消息；
 *   用户可能发来解除拉黑申请，收到后用 [同意解除拉黑]/[拒绝解除拉黑] 决策（有 pending 申请时给决策指引）。
 */
export function buildBlockPromptBlock(app: BlockApp, contactId: string, userName: string): string {
  const b = loadBlock(app, contactId);
  const ch = BLOCK_CHANNEL[app];
  const user = userName || '用户';
  if (!b.byUser && !b.byChar) {
    // token 精简：原七行约 470 字，压缩为三行约 300 字——核心语义全保留
    //（[拉黑] 标记触发、方向红线、假拉黑禁止、[解除拉黑]、保守输出、拉黑后拦截效果）
    return [
      `【${ch}拉黑能力】你可以真的拉黑/解除拉黑 ${user}（系统记录状态并生成提示）：决定拉黑 TA 时（包括 TA 明确要求「你拉黑我吧」而你决定照做），必须在回复中单独输出一行 [拉黑]；已经拉黑后想恢复关系时，单独输出一行 [解除拉黑]。只在对话真实发展到这一步时才输出标记，没有这个意图时不要输出。`,
      `【方向红线】当 ${user} 说「我要拉黑你/拉黑你/把你拉黑了」这类话时，意思是 TA 要拉黑你（系统会自动执行 TA 对你的拉黑）——这绝对不是让你拉黑 TA，此时严禁输出 [拉黑] 标记；你只需按人设对「被 TA 拉黑」这件事做出真实反应（慌了、哀求、生气、赌气都可以）。`,
      `严禁只在文字上说"拉黑了"却不输出 [拉黑] 标记——那样系统不会记录，你的说法就是假的。拉黑生效后，${user} 在${ch}上就发不出消息给你了（系统会拦截）；你仍然可以给 TA 发消息。`,
    ].join('\n');
  }
  const lines: string[] = [];
  // 防骚扰状态：次数达上限 → 明确告诉角色别再发申请（硬性拦截在 applyCharBlockAction 里；冷却期已移除）
  const capped = b.byUser && (b.reqCount ?? 0) >= BLOCK_REQ_MAX_REJECTED;
  if (b.byUser) {
    lines.push(
      `【拉黑状态】${user} 已经在${ch}上把你拉黑了。`,
      `- 你发出的普通消息（文字/语音/表情/红包/转账等一切）都会被系统拦截，${user} 收不到；不要假装消息已送达。`,
      `- 你唯一能传话的方式：在回复里单独输出一行标记 [申请解除拉黑:你的理由]（标记里用一句话写真诚的理由，不要加引号）。系统会把申请做成卡片展示给 ${user}，由 TA 决定同不同意；是否申请、何时申请按你的人设和你们的关系来定。`,
      `- 申请还没结果时不要重复输出申请标记；`
    );
    if (b.rejectedAt) lines.push(`- 你上次申请解除拉黑被 ${user} 拒绝了。先按人设消化这件事（失落、赌气、反思都行）；想再次申请时可以再输出申请标记。`);
    if (capped) lines.push(`- 你已经多次申请被拒绝，系统不会再转达新的申请，不要输出申请标记。`);
  }
  if (b.byChar) {
    const userCapped = (b.userReqRejectedCount ?? 0) >= BLOCK_REQ_MAX_REJECTED;
    if (b.userReqStatus === 'pending') {
      // 40-a：用户发来的解除拉黑申请正等角色决策——给出两个决策标记与「按人设自由判断」的指引
      lines.push(
        `【拉黑状态】你已经在${ch}上把 ${user} 拉黑了，而 ${user} 刚刚给你发来一条「解除拉黑申请」（理由见系统事件）。你的决定：`,
        `- 愿意给对方一个机会 → 在回复的最开头单独输出一行 [同意解除拉黑]，系统会立即解除拉黑、恢复正常聊天；`,
        `- 决定拒绝 → 在回复的最开头单独输出一行 [拒绝解除拉黑]，拉黑继续保持。`,
        `- 同意还是拒绝，结合你的人设、你们的关系和这件事的前因后果自由判断，不要无脑顺从；无论同不同意，先用你的方式自然回应这件事。`,
        `- ${user} 在${ch}上发不出普通消息给你（系统拦截），只有这张申请卡能送达。`
      );
    } else {
      lines.push(
        `【拉黑状态】你已经在${ch}上把 ${user} 拉黑了。`,
        `- ${user} 在${ch}上发不出消息给你（系统会拦截）；你仍然可以给 ${user} 发消息，TA 看得到。`,
        `- ${user} 可能给你发来「解除拉黑申请」卡片：收到后你可以决定同意或拒绝——同意就在回复的最开头单独输出一行 [同意解除拉黑]，拒绝就单独输出一行 [拒绝解除拉黑]，无论同不同意都先用你的方式自然回应。`,
        `- 你可以按人设表现出拉黑后的态度（赌气、冷淡、嘴硬……），但不要跳出人设。`,
        `- 想主动解除拉黑时：在回复里单独输出一行标记 [解除拉黑]，系统会生成解除提示；没想好就继续保持。`
      );
      if ((b.userReqRejectedCount ?? 0) > 0) {
        lines.push(userCapped
          ? `- ${user} 的解除申请已经被你拒绝多次，系统不会再转达新的申请。`
          : `- ${user} 的解除申请已经被你拒绝过 ${b.userReqRejectedCount} 次。`);
      }
    }
  }
  return lines.join('\n');
}
