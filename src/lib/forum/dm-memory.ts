'use client';

/**
 * X论坛 · NPC 私信独立记忆库（用户规格三/四：极其重要）。
 *
 * 每位 NPC（npc:/mnpc:/dyn: 虚拟网友）拥有一个完全独立的、外界不可见的小型记忆库，
 * 只存「TA 与用户在论坛私信里聊过的事」：
 * - 【20 条触发总结】用户与该 NPC 的私信（双向消息都计）累计满 20 条 → 触发一次
 *   LLM 总结（提取关键信息）→ 永久存入该 NPC 的独立记忆库（ summaries 永不删除，
 *   展示层最多带最近 6 条，越攒越「懂你」）；
 * - 【账号隔离】大号会话与匿名会话物理分仓（bank.counts / bank.summaries 各带
 *   main/anon 两套）——匿名小号在 NPC 眼里就是另一个陌生人，绝不穿帮；
 * - 【说破关联】仅当用户在私信里亲口暴露身份（detectForumAnonDisclosure 命中，
 *   按联系人/NPC 粒度落标记），该 NPC 的后续回复才把两个仓合并看待
 *   （读取侧单向合并 + 明示「你认出这是同一个人」）；
 * - 【角色隔离】AI 角色（char:）的私信【不写入】任何 NPC 记忆库（防止两个系统
 *   数据串台）；char 走自己的 charMemoryDigest 管线（见 engine dmReply）。
 *
 * 本模块只做数据读写与 prompt 块拼装，不 import engine（避免循环依赖）；
 * LLM 调用与任务调度在 engine.ts（dmSummary pending job）。
 */
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { forumData, isUserAuthor, relTime, type AuthorKey } from './core';
import { isForumAnonDisclosed, markForumAnonDisclosed } from '@/lib/ios/forum-anon';

// ---------------- 类型 ----------------

/** 一条永久记忆（某 20 条私信窗口的总结沉淀） */
export interface DmSummaryRec {
  /** 总结落库时刻 */
  at: number;
  /** 沉淀正文（≤200 字） */
  text: string;
  /** 生成方式：llm=LLM 提取 / fallback=机械压缩（LLM 失败时兜底，记忆不丢档） */
  src: 'llm' | 'fallback';
}

/** 每 NPC 一份的记忆仓（main/anon 物理分仓） */
interface DmBank {
  v: 1;
  /** 各账号累计消息数（双向；满 20 触发总结） */
  counts: { main: number; anon: number };
  /** 各账号已总结覆盖到的消息时刻（此前的消息已沉淀进 summaries） */
  lastSummaryAt: { main: number; anon: number };
  /** 各账号的永久记忆条目（只增不删；展示层带最近 6 条） */
  summaries: { main: DmSummaryRec[]; anon: DmSummaryRec[] };
}

const emptyBank = (): DmBank => ({
  v: 1,
  counts: { main: 0, anon: 0 },
  lastSummaryAt: { main: 0, anon: 0 },
  summaries: { main: [], anon: [] },
});

// ---------------- 谁有独立记忆库 ----------------

/** 私信对端是否是「NPC 网友」（有独立记忆库的群体）——
 *  char 角色【绝不写入】（用户规格五：防两个系统数据串台），官方号不聊天。 */
export function isNpcDmPeer(peerKey: string): peerKey is AuthorKey {
  return peerKey.startsWith('npc:') || peerKey.startsWith('mnpc:') || peerKey.startsWith('dyn:');
}

// ---------------- 存储 ----------------

function bankKey(peerKey: string): string {
  return `forum-dm-mem:${peerKey}`;
}

function readBank(peerKey: string): DmBank {
  try {
    const raw = kvGet<DmBank>(bankKey(peerKey));
    if (raw && typeof raw === 'object' && raw.v === 1) return raw;
    return emptyBank();
  } catch {
    return emptyBank();
  }
}

function writeBank(peerKey: string, bank: DmBank): void {
  try {
    // summaries 永久保留（只增不删——「永久存入这个独立记忆库」）；
    // 防御性封顶 40 条/账号（极端长聊场景，旧记忆仍在但太远的不占 prompt）
    for (const acc of ['main', 'anon'] as const) {
      if (bank.summaries[acc].length > 40) bank.summaries[acc] = bank.summaries[acc].slice(-40);
    }
    kvSet(bankKey(peerKey), bank);
  } catch {
    /* 静默 */
  }
}

// ---------------- 说破关联（按对端粒度） ----------------

/** kv：Record<peerKey, { at, evidence }> —— 该 NPC 已亲口被告知「匿名号=用户本人」 */
const DM_DISCLOSE_KEY = 'forum-dm-disclose-v1';

interface DmDiscloseRec {
  at: number;
  evidence?: string;
}

function readDiscloseMap(): Record<string, DmDiscloseRec> {
  try {
    const raw = kvGet<Record<string, DmDiscloseRec>>(DM_DISCLOSE_KEY);
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** NPC 侧是否已知晓「当前匿名会话的那个人 = 大号本人」（用户在私信里亲口说破） */
export function isDmNpcDisclosed(peerKey: string): boolean {
  try {
    return Boolean(readDiscloseMap()[peerKey]);
  } catch {
    return false;
  }
}

/** 落「对该 NPC 说破」标记（幂等；返回是否为新写入） */
export function markDmNpcDisclosed(peerKey: string, evidence?: string): boolean {
  try {
    if (!isNpcDmPeer(peerKey)) return false;
    const map = readDiscloseMap();
    if (map[peerKey]) return false;
    map[peerKey] = { at: Date.now(), evidence: (evidence ?? '').slice(0, 60) || undefined };
    kvSet(DM_DISCLOSE_KEY, map);
    return true;
  } catch {
    return false;
  }
}

/** 统一入口：这位对端是否已知晓匿名号=用户本人。
 *  NPC 网友 → per-NPC 私信标记；char 角色 → 复用全局联系人粒度标记（chat/论坛共享）。 */
export function isDmPeerDisclosed(peerKey: string): boolean {
  if (peerKey.startsWith('char:')) return isForumAnonDisclosed(peerKey.slice('char:'.length));
  return isDmNpcDisclosed(peerKey);
}

/** 统一入口：对当前对端落说破标记（dms.tsx 发送时检测调用）。 */
export function markDmPeerDisclosed(peerKey: string, evidence?: string): boolean {
  if (peerKey.startsWith('char:')) return markForumAnonDisclosed(peerKey.slice('char:'.length), evidence);
  return markDmNpcDisclosed(peerKey, evidence);
}

// ---------------- 计数与总结触发 ----------------

/** 一次私信落库后调用（双向消息都计）：把 n 条消息记到 account 仓的累计数上。
 *  返回非 null = 该仓已满 20 条窗口，需要触发一次总结（engine 拿去排 dmSummary job）。 */
export interface DmSummaryDue {
  peerKey: AuthorKey;
  account: 'main' | 'anon';
  /** 本次应总结的消息窗口起点（at > coveredAt 的消息入窗） */
  coveredAt: number;
  /** 窗口内消息数（供 engine 截取 dm.messages 用） */
  pending: number;
}

export function afterDmMessage(
  peerKey: AuthorKey,
  account: 'main' | 'anon',
  n = 1,
): DmSummaryDue | null {
  try {
    if (!isNpcDmPeer(peerKey)) return null; // char/official 绝不写 NPC 记忆库
    const bank = readBank(peerKey);
    bank.counts[account] += n;
    writeBank(peerKey, bank);
    const total = bank.counts[account];
    if (total >= 20) {
      return {
        peerKey,
        account,
        coveredAt: bank.lastSummaryAt[account],
        pending: Math.min(total, 40),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** 总结落库（dmSummary job 成功后调用）：沉淀正文 + 推进窗口边界。
 *  consumed = 本窗口消化掉的消息数（一般 20；不足时全量消化）。 */
export function commitDmSummary(
  peerKey: AuthorKey,
  account: 'main' | 'anon',
  text: string,
  coveredAt: number,
  consumed: number,
  src: 'llm' | 'fallback',
): void {
  try {
    if (!isNpcDmPeer(peerKey)) return;
    const clean = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!clean) return;
    const bank = readBank(peerKey);
    bank.summaries[account].push({ at: Date.now(), text: clean, src });
    bank.counts[account] = Math.max(0, bank.counts[account] - Math.max(1, consumed));
    bank.lastSummaryAt[account] = Math.max(bank.lastSummaryAt[account], coveredAt);
    writeBank(peerKey, bank);
  } catch {
    /* 静默 */
  }
}

// ---------------- 读取（NPC 回复私信时的长期记忆注入） ----------------

/** 该 NPC 在 account 仓的永久记忆条目（时间正序，最多 limit 条）。
 *  disclosed=true 时并入另一账号仓（NPC 已认出两个号是同一个人）。 */
function bankSummaries(peerKey: AuthorKey, account: 'main' | 'anon', limit: number): DmSummaryRec[] {
  const bank = readBank(peerKey);
  const list = bank.summaries[account].slice(-limit);
  if (isDmNpcDisclosed(peerKey)) {
    const other = bank.summaries[account === 'main' ? 'anon' : 'main'].slice(-limit);
    return [...list, ...other].sort((a, b) => a.at - b.at).slice(-limit);
  }
  return list;
}

/**
 * NPC 私信回复 prompt 的长期记忆块（engine dmReply 注入）：
 * 【你对TA的长期私信记忆】——之前每满 20 条消息沉淀下来的总结。
 * 匿名会话（stranger）调用方不注入；说破后 disclosed=true → 合并视角 + 认人明示。
 * 空库返回 ''（第一窗口还没攒满，只有 history 上下文）。
 */
export function dmLongMemoryBlock(peerKey: AuthorKey, account: 'main' | 'anon', disclosed: boolean): string {
  try {
    if (!isNpcDmPeer(peerKey)) return '';
    const recs = bankSummaries(peerKey, account, 6);
    if (!recs.length) return '';
    const now = Date.now();
    const lines = recs.map((r) => `- ${relTime(r.at, now)}你们私信聊过：${r.text.slice(0, 110)}`);
    const knownLine = disclosed
      ? '\n（你认得TA：TA的大号和匿名号你都聊过——两个号是同一个人，你对TA的整体印象延续）'
      : '';
    return [
      `【你对TA的长期私信记忆（你们之前聊天的沉淀——自然运用：昨天骂过的人今天接着骂，聊过的约定要记得兑现；别逐条复述，像老熟人那样随口带出来）】${knownLine}`,
      ...lines,
    ].join('\n');
  } catch {
    return '';
  }
}

// ---------------- 调试/可见性 ----------------

/** 记忆库只属于 NPC 自己（用户规格三：「谁也看不见」）——对外仅暴露
 *  条数统计（设置页/调试用）；正文永不透出。 */
export function dmBankStats(peerKey: AuthorKey): { main: number; anon: number } {
  const bank = readBank(peerKey);
  return { main: bank.summaries.main.length, anon: bank.summaries.anon.length };
}

/** 供 engine dmSummary job 取窗口消息：从最新快照里截取该账号仓木总结的消息。
 *  （对端视角：「peer」= NPC 自己，「user」= 用户；混合线程里另一账号的消息
 *  属于别的仓，不进本窗口——按「当前会话账号」归仓，与计数口径一致） */
export function formatDmWindow(
  peerKey: AuthorKey,
  account: 'main' | 'anon',
  coveredAt: number,
  cap: number,
): { texts: { from: 'peer' | 'user'; text: string; at: number }[]; newCoveredAt: number; consumed: number } | null {
  try {
    const d = forumData();
    const dm = d.dms.find((x) => x.peerKey === peerKey);
    if (!dm) return null;
    const out: { from: 'peer' | 'user'; text: string; at: number }[] = [];
    let currentAcc: 'main' | 'anon' = 'main';
    for (const m of dm.messages) {
      if (isUserAuthor(m.from)) currentAcc = m.from === 'anon' ? 'anon' : 'main';
      if (m.at <= coveredAt) continue;
      if (currentAcc !== account && isUserAuthor(m.from)) continue;
      if (out.length >= cap) break;
      out.push({ from: isUserAuthor(m.from) ? 'user' : 'peer', text: (m.text ?? '').slice(0, 100), at: m.at });
    }
    if (!out.length) return null;
    return { texts: out, newCoveredAt: out[out.length - 1].at, consumed: out.length };
  } catch {
    return null;
  }
}

// 注意：char 对端走 charMemoryDigest 管线（engine dmReply），不经本模块——
// 用户规格五：AI 角色聊天记录不写入 NPC 专属记忆库，防两个系统数据串台。
