'use client';

/**
 * 跨 App 环境感知（Task 40-b）：跨 App 原始消息携带 + 群聊原始消息携带。
 *
 * 职责：
 * - buildCrossAppBlock(contactId, currentApp, userName)：AI 知道「现在在哪个 App 聊天」
 *   （【当前环境】行恒存在），并带上最近在其他三个 App 里与该角色的原始聊天消息
 *   （每 App 最近 10 条、时间升序、机主=「用户：」/AI 角色=「你：」、已标注来源 App）；
 * - buildGroupRecentBlock(contactId, userName)：该角色与机主有共同群聊时，带上每个群
 *   最近 10 条群消息（按群最近消息时间取前 3 个群，标注「哪个群 + 谁说的」；群与群、群与
 *   私聊都按群 ID/会话键天然隔离，这里只做只读汇聚，绝不写回）；
 * - buildCrossContextBlocks(contactId, currentApp, userName)：上面两个的并行打包
 *   （一次拿全两块，供通话引擎/聊天页一次性调用）。
 *
 * 注入顺序约定（systemFull 拼装，各调用方遵守）：
 *   当前 App 记忆块(memoryBlock) → 跨 App 块(crossAppBlock) → 群聊块(groupBlock) →
 *   其他块（动态/时间/位置…）——即「当前 App 记忆 → 其他 App 最近 10 条 → 群聊最近 10 条 →
 *   长期记忆 → 核心记忆」（长期/核心在 memoryBlock 内部，由 memRecallBlock 保证层级）。
 *
 * 互通门控：getMemSettings(contactId).share === false（用户关掉「跨 App 互通记忆」）时
 * buildCrossAppBlock 只输出【当前环境】行（AI 仍知道自己在哪个 App，但不携带其他 App 消息），
 * buildGroupRecentBlock 直接返回空串（群聊原始消息同样不外流；群级另有 memoryInterop 门控）。
 *
 * 调用方清单（注入点交接，详见 worklog Task 40-b）：
 * - src/lib/ios/chat-call.ts（微信/QQ 语音通话引擎）：requestTurn payload + followupAndSummarize
 *   （currentApp = optsRef.current.app，会话级构建一次缓存）；
 * - src/components/apps/phone.tsx（电话 App 通话引擎）：runTurn payload（currentApp='phone'，
 *   userName=profileName；另透传 AI 主动来电的 proactiveContext）；
 * - /api/phone/turn、/api/phone/followup：透传 root.crossAppBlock / root.groupBlock 进 systemFull
 *   （位置：worldbookBlock → memoryBlock → crossAppBlock → groupBlock → …）；
 * - wechat.tsx / qq.tsx / chat.tsx 私聊（主协调者后续统一注入，签名即本文件导出函数）。
 *
 * 数据源（只读，全部防御性容错：键不存在/JSON 坏/字段缺 → 跳过该来源，绝不抛错）：
 * - 微信私聊 kv `wx-chat-msgs:<contactId>`；QQ 私聊 kv `qq-chat-msgs:<contactId>`；
 *   信息私聊 kv `ios-chat-msgs:c:<contactId>`（AI 助手会话是独立键，天然排除）；
 * - 电话：IndexedDB 'call-logs' 最近 3 通 + 'voicemails'（kind='call'）末通转写；
 * - 群：groups.ts 群池 `wx-chat-groups` / `qq-chat-groups`（listGroups）+ `wx-group-msgs:<gid>` /
 *   `qq-group-msgs:<gid>`（loadGroupMsgs）；成员匹配口径与 memory.ts 一致
 *   （memberIds 含该联系人，ownerId 兜底防转让后数据缺员）。
 */

import { kvGet } from './idb-kv';
import { kvGetRaw } from './idb-kv';
// 多账号（Task 40-2d v2 + 大小号隔离修复）：跨 App 读其他 App 的消息一律按「当前聊天身份的
// 账号」作用域读原样键（main=原键 / 小号=--{accId} 后缀）——不再按各源 App 当前账号读：
// 否则小号在微信聊天时会读到主号在信息里的消息、并标成小号说的（把大号说的话算到小号头上）
import { getActiveAccountIdFor } from './accounts';
import { localDB, type CallLogRecord, type VoicemailRecord } from './db';
import { getContact } from './contacts-store';
import { loadBlock, type BlockApp } from './block-state';
import { getMemSettings } from '@/lib/memory';
import { listGroups, loadGroupMsgs, type WxGroupMsg } from './groups';
import { musicUid } from './music-api';

/** 五端标识（与 memory-core 的 MemApp 同形；本模块不 import memory-core 避免耦合）。
 *  music = 音乐 App（Task 68）：一起听聊天以 'music' 身份接入跨 App 感知，
 *  其他四端聊天也能读到音乐 App 的听歌动态（正在听/最近播放/收藏/一起听消息）。 */
export type CrossAppId = 'wx' | 'qq' | 'sms' | 'phone' | 'music';

/** App 显示名（system 文案用） */
const APP_LABEL: Record<CrossAppId, string> = { wx: '微信', qq: 'QQ', sms: '信息', phone: '电话', music: '音乐' };

/** 各私聊 App 的消息 kv 键（与各 App 落盘键严格一致；sms 会话键形如 c:<contactId>；music 无私聊消息键） */
function chatMsgsKey(app: Exclude<CrossAppId, 'phone' | 'music'>, contactId: string): string {
  return app === 'wx' ? `wx-chat-msgs:${contactId}` : app === 'qq' ? `qq-chat-msgs:${contactId}` : `ios-chat-msgs:c:${contactId}`;
}

/** 当前聊天身份的账号 id（大小号隔离：跨 App 近况描述的是「当前这个身份」在其他 App 的经历）：
 *  currentApp 是四聊天 App 之一 → 取其当前账号；music 等非账号场景回退大号。 */
function chatAccountScope(currentApp: CrossAppId): string {
  if (currentApp === 'wx' || currentApp === 'qq' || currentApp === 'sms' || currentApp === 'phone') {
    try {
      return getActiveAccountIdFor(currentApp) || 'main';
    } catch {
      return 'main';
    }
  }
  return 'main';
}

/** 跨 App 块总预算（字符）：超限从最早的 App 记录开始裁 */
const CROSS_APP_BUDGET = 2600;
/** 群聊块总预算（字符） */
const GROUP_BLOCK_BUDGET = 2000;
/** 每 App 注入条数（原始消息） */
const MSGS_PER_APP = 10;
/** 共同群注入个数（按群最近消息时间倒序） */
const GROUPS_LIMIT = 3;
/** 群每群注入条数 */
const MSGS_PER_GROUP = 10;
/** 私聊/群聊单条文本截断长度 */
const LINE_CAP_PRIVATE = 150;
const LINE_CAP_GROUP = 120;
/** 电话转写与通话记录匹配的时间窗（转写与通话记录同刻落盘，取宽松窗防时钟差） */
const VM_MATCH_WINDOW_MS = 2 * 60_000;

// ---------------- 小工具 ----------------

function truncate(t: string, cap: number): string {
  const s = t.trim();
  return s.length > cap ? `${s.slice(0, cap)}…` : s;
}

/** 「2月14日 20:31」（通话摘要行用） */
function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 通话时长口语化：45 秒 / 5 分钟 */
function fmtCallDur(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return s < 60 ? `${s}秒` : `${Math.max(1, Math.round(s / 60))}分钟`;
}

// ---------------- 消息 → 文本行（全类型归一化，数据形状按各 App 落盘结构鸭子读取） ----------------

/**
 * 单条聊天/群消息归一化为 AI 可读文本（不带说话人前缀）：
 * text→content；voice→[语音] 转写；image→[图片]（识图描述）；call→[语音通话 方向·时长]；
 * sticker→[表情]；location→[位置]；红包/转账/亲属卡/群邀请/解除拉黑申请/转发→占位；
 * notice/sys 系统行与撤回消息返回 null（跳过）。返回空串/null 都视为无内容。
 * 防御点：content 可能是 dataURL（QQ 旧图片消息 content=dataURL）→ 永不原样带出。
 */
function msgText(m: unknown): string | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (o.recalled === true) return null; // 撤回消息不进上下文（各 App 同口径）
  const kind = typeof o.kind === 'string' ? o.kind : 'text';
  if (kind === 'notice' || kind === 'sys') return null; // 系统通知行/状态提示行（居中灰字）
  if (kind === 'voice') {
    const v = o.voice as { transcript?: unknown; localText?: unknown } | null | undefined;
    const t =
      (typeof v?.transcript === 'string' && v.transcript.trim()) ||
      (typeof v?.localText === 'string' && v.localText.trim()) ||
      '';
    return t ? truncate(`[语音] ${t}`, LINE_CAP_PRIVATE) : '[语音]';
  }
  if (kind === 'image') {
    const img = o.img as { desc?: unknown } | null | undefined;
    const d = typeof img?.desc === 'string' && img.desc.trim() ? img.desc.trim() : '';
    return d ? truncate(`[图片]（图片内容：${d}）`, LINE_CAP_PRIVATE) : '[图片]';
  }
  if (kind === 'call') {
    const c = o.call as { state?: unknown; duration?: unknown; direction?: unknown; endReason?: unknown } | null | undefined;
    const dur = typeof c?.duration === 'number' && Number.isFinite(c.duration) && c.duration > 0 ? c.duration : 0;
    // fix3-2 通话卡方向反转（原「来电/去电」主语不明，AI 会把用户拨出说成自己打的）：
    // 按行主语 × direction 换算成 AI 视角双向明确表述。数据里卡片 role 恒由 direction 派生
    // （out=机主拨出→me 行、in=AI 拨入→peer 行，见 wechat/qq writeCallCard），另两组合仅为防御。
    // direction 取值域（机主手机视角）：'out'=机主拨出 / 'in'=AI 拨入（chat-call ChatCallResult 同域）
    const mine = isMine(o); // 机主行（用户卡）= true / AI 行（peer 卡）= false
    const out = c?.direction !== 'in'; // 缺省按 'out'（与卡片落盘缺省一致）
    const main = mine
      ? out
        ? '用户打给你的电话'
        : '你打去、用户接听的电话'
      : out
        ? '用户打来、你接听的电话'
        : '你打给用户的电话';
    if (dur > 0) return `[语音通话：${main}，通话${fmtCallDur(dur)}]`;
    // 未接通按 endReason 细分（存量卡片只有 state，取值同源：rejected/rejected、cancelled/cancel、
    // no-answer/missed-in 同为「被叫没接」），细分主语按 direction：out=主叫机主→被叫是你，in=主叫你→被叫是用户
    const state = typeof c?.state === 'string' ? c.state : '';
    const reason = typeof c?.endReason === 'string' ? c.endReason : '';
    const how = reason || state;
    if (how === 'reject' || how === 'rejected') {
      return `[语音通话：${main}，${out ? '你拒接了' : '用户拒接了'}]`;
    }
    if (how === 'cancel' || how === 'cancelled') {
      return `[语音通话：${main}，${out ? '用户取消了' : '你取消了'}]`;
    }
    return `[语音通话：${main}，没接]`; // no-answer / missed-in / 未知：被叫一直没接
  }
  if (kind === 'sticker') {
    const s = o.stk as { meaning?: unknown } | null | undefined;
    const mean = typeof s?.meaning === 'string' && s.meaning.trim() ? s.meaning.trim() : '';
    return mean ? truncate(`[表情] ${mean}`, LINE_CAP_PRIVATE) : '[表情]';
  }
  if (kind === 'location') {
    const l = o.loc as { name?: unknown } | null | undefined;
    const n = typeof l?.name === 'string' && l.name.trim() ? l.name.trim() : '';
    return n ? truncate(`[位置] ${n}`, LINE_CAP_PRIVATE) : '[位置]';
  }
  if (kind === 'redpacket') return '[红包]';
  if (kind === 'transfer') return '[转账]';
  if (kind === 'family') return '[亲属卡]';
  if (kind === 'song') {
    // 歌曲卡片（音乐 App × AI 深度互动）：AI 读到歌名/歌手，知道分享过什么歌
    const s = o.song as { name?: unknown; artist?: unknown } | null | undefined;
    const n = typeof s?.name === 'string' ? s.name.trim() : '';
    const a = typeof s?.artist === 'string' ? s.artist.trim() : '';
    return n ? truncate(`[歌曲卡片]《${n}》${a}`.trim(), LINE_CAP_PRIVATE) : '[歌曲卡片]';
  }
  if (kind === 'groupcard') return '[群聊邀请]';
  if (kind === 'blockreq') {
    const b = o.blkreq as { reason?: unknown } | null | undefined;
    const r = typeof b?.reason === 'string' && b.reason.trim() ? b.reason.trim() : '';
    return r ? truncate(`[申请解除拉黑：${r}]`, LINE_CAP_PRIVATE) : '[申请解除拉黑]';
  }
  if (kind === 'forward') {
    const f = o.fwd as { merged?: unknown } | null | undefined;
    if (f?.merged === true) return '[聊天记录]';
    const c = typeof o.content === 'string' ? o.content.trim() : '';
    return c && !c.startsWith('data:') ? truncate(`[转发] ${c}`, LINE_CAP_PRIVATE) : '[转发]';
  }
  // text / 未知 kind：content 兜底（dataURL 防泄漏：旧记录图片可能存 content）
  const c = typeof o.content === 'string' ? o.content.trim() : '';
  if (!c) return null;
  if (c.startsWith('data:')) return '[图片]';
  return truncate(c, LINE_CAP_PRIVATE);
}

/** 私聊消息是否机主发的（wx/qq 用 role me/peer；信息端用 user/assistant） */
function isMine(m: Record<string, unknown>): boolean {
  return m.role === 'me' || m.role === 'user';
}

/** 时间升序防御排序（正常落盘已按序，防历史数据乱序） */
function sortAsc<T extends { time?: unknown }>(list: T[]): T[] {
  return [...list].sort((a, b) => (typeof a.time === 'number' ? a.time : 0) - (typeof b.time === 'number' ? b.time : 0));
}

// ---------------- 分节拼装（超预算从最早一节的旧消息开始裁） ----------------

interface BlockSection {
  header: string;
  lines: string[];
}

function joinSections(intro: string, sections: BlockSection[], budget: number): string {
  const render = (): string => {
    const parts: string[] = [];
    for (const s of sections) {
      if (s.lines.length === 0) continue;
      parts.push(s.header, ...s.lines);
    }
    return [intro, ...parts].filter(Boolean).join('\n');
  };
  let out = render();
  let gi = 0; // 最早的一节先裁（逐条丢最旧消息；整节裁空自动去节头）
  while (out.length > budget && gi < sections.length) {
    if (sections[gi].lines.length === 0) {
      gi++;
      continue;
    }
    sections[gi].lines.shift();
    out = render();
  }
  return out;
}

// ---------------- 音乐动态（Task 68：音乐 App 听歌数据注入所有聊天端） ----------------

/** 鸭子读一首歌的《名》（歌手）文本（music-now/history/liked 的 song 都是 NcmSong 形状） */
function songBrief(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const s = raw as Record<string, unknown>;
  const name = typeof s.name === 'string' ? s.name.trim() : '';
  if (!name) return '';
  let artist = '';
  const arts = Array.isArray(s.artists) ? s.artists : Array.isArray(s.ar) ? s.ar : [];
  for (const a of arts) {
    const n = a && typeof a === 'object' && typeof (a as Record<string, unknown>).name === 'string' ? ((a as Record<string, unknown>).name as string).trim() : '';
    if (n) artist = artist ? `${artist}/${n}` : n;
  }
  return `《${name}》${artist ? `（${artist}）` : ''}`;
}

/**
 * 音乐 App 动态行（AI 知道用户在听什么）：
 * - 正在听的歌（music-now 全局快照；含是否在一起听中）；
 * - 最近播放前 5（music-history:{uid}）；
 * - 红心收藏前 3（music-liked:{uid}）；
 * - 与该角色的一起听近况：活跃会话在听哪首 + 最近几条一起听消息（机主=userLabel/角色=你）。
 * 全部直接读 kv（不依赖音乐 App 是否打开过），防御性容错，任何失败跳过该行。
 */
function readMusicLines(contactId: string, userLabel: string, currentApp: CrossAppId): string[] {
  const lines: string[] = [];
  try {
    const uid = musicUid();
    // 正在听（全局快照；仅当属当前音乐账号时采信——切号后旧快照不读）
    const now = kvGet<{ song?: unknown; at?: number; uid?: unknown }>('music-now');
    const inTg = currentApp !== 'music' && Boolean(kvGet<unknown>(`music-together-active:${uid}`));
    const cur = songBrief(now?.song);
    if (cur && (now?.uid ?? uid) === uid) {
      lines.push(`正在听：${cur}${inTg ? '（正在和 AI 角色一起听）' : ''}`);
    }
    // 最近播放（新歌在前）
    const hist = kvGet<{ song?: unknown }[]>(`music-history:${uid}`);
    if (Array.isArray(hist) && hist.length > 0) {
      const items = hist.slice(0, 5).map((h) => songBrief(h?.song)).filter(Boolean);
      if (items.length > 0) lines.push(`最近听过：${items.join('、')}`);
    }
    // 红心收藏
    const liked = kvGet<{ song?: unknown }[]>(`music-liked:${uid}`);
    if (Array.isArray(liked) && liked.length > 0) {
      const items = liked.slice(0, 3).map((h) => songBrief(h?.song)).filter(Boolean);
      if (items.length > 0) lines.push(`收藏的歌（红心）：${items.join('、')}`);
    }
    // 与该角色的一起听近况（消息按角色隔离，只读本角色的）
    if (contactId) {
      const tgMsgs = kvGet<{ role?: unknown; text?: unknown; songs?: unknown }[]>(`music-together:${uid}:${contactId}`);
      if (Array.isArray(tgMsgs) && tgMsgs.length > 0) {
        const recent = tgMsgs.slice(-3);
        const rows: string[] = [];
        for (const m of recent) {
          const text = typeof m?.text === 'string' ? m.text.trim() : '';
          if (!text) continue;
          const who = m.role === 'me' ? userLabel : m.role === 'recs' ? '你' : '你';
          const body = m.role === 'recs' ? `（你推荐了歌：${text}）` : text;
          rows.push(`${who}：${truncate(body, 60)}`);
        }
        if (rows.length > 0) lines.push(`你们在音乐 App 一起听时的对话（最近）：`, ...rows);
      }
    }
  } catch {
    // 音乐数据读不到：跳过（不阻断消息发送）
  }
  return lines;
}

// ---------------- 跨 App 块 ----------------

/** 读某私聊 App 的最近消息行（机主=userLabel/角色=你：；userLabel 缺省回退「机主」；空返回 []）。
 *  多账号（Task 40-2d v2 + 大小号隔离修复）：accId = 当前聊天身份的账号 id——
 *  main 读原样键（机主自己的记录）；小号/匿名号读 --{accId} 后缀键（本账号自己的记录）。
 *  绝不读其他账号的记录：小号在微信聊天时不能把大号在信息里说的话当成小号说的。 */
function readPrivateLines(
  app: Exclude<CrossAppId, 'phone' | 'music'>,
  contactId: string,
  userLabel?: string,
  accId = 'main',
): string[] {
  const base = chatMsgsKey(app, contactId);
  const raw: unknown = accId === 'main' ? kvGetRaw(base) : kvGetRaw(`${base}--${accId}`);
  if (!Array.isArray(raw)) return [];
  const msgs = sortAsc(raw.filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')).slice(-MSGS_PER_APP);
  // fix3-4 私聊行主语用传入的机主名（原先硬编码「用户」与角色名两套自称并存；缺省回退「机主」）
  const me = (userLabel ?? '').trim().slice(0, 20) || '机主';
  const lines: string[] = [];
  for (const m of msgs) {
    const text = msgText(m);
    if (!text) continue;
    lines.push(`${isMine(m) ? me : '你'}：${text}`);
  }
  return lines;
}

/** 电话来源：call-logs 最近 3 通摘要 + 末通 kind='call' 转写（没有转写只有摘要行）；
 *  charName = 角色（AI）名，转写行「角色名：」前缀映射为「你：」（fix3-4，可空）。
 *  多账号（Task 40-2d v2 + 大小号隔离修复）：只读当前聊天身份账号（accId）的通话记录/留言
 *  （旧记录无 account 字段视为大号）；小号侧不读大号的通话历史（反之亦然） */
async function readPhoneLines(contactId: string, charName?: string, accId = 'main'): Promise<string[]> {
  if (!contactId) return [];
  let logs: CallLogRecord[] = [];
  let vms: VoicemailRecord[] = [];
  try {
    const allLogs = await localDB.getAll('call-logs');
    logs = allLogs
      .filter((l) => l && l.contactId === contactId && (l.account ?? 'main') === accId)
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return []; // IndexedDB 不可用：电话来源跳过
  }
  if (logs.length === 0) return [];
  try {
    const allVms = await localDB.getAll('voicemails');
    vms = allVms.filter(
      (v) => v && v.contactId === contactId && v.kind === 'call' && (v.account ?? 'main') === accId,
    );
  } catch {
    vms = []; // 转写读不到不影响摘要行
  }
  const recent = logs.slice(0, 3);
  const lines: string[] = [];
  // 摘要行按时间升序（最旧在前最新在后，与聊天记录行同口径）
  for (const l of [...recent].reverse()) {
    const ts = typeof l.createdAt === 'number' ? l.createdAt : 0;
    const when = ts > 0 ? fmtDateTime(ts) : '';
    const dur = typeof l.duration === 'number' && Number.isFinite(l.duration) && l.duration > 0 ? l.duration : 0;
    // fix3-2 电话摘要行带方向主语（原先只有「通话X分钟/未接来电」，AI 分不清谁打的）：
    // call-logs direction 取值域（机主手机视角）：'out'=机主拨出 / 'in'=AI 拨入被接听 /
    // 'missed'=AI 拨出未被接（proactive-call.ts / chat.tsx AI 来电未接、phone.tsx 通话中忽略来电三处专用）
    const caller = l.direction === 'out' ? '用户打给你' : '你打给用户';
    let detail: string;
    if (dur > 0) detail = `，通话${fmtCallDur(dur)}`;
    else if (l.direction === 'missed') detail = '，未接通';
    else if (l.endReason === 'reject') detail = l.direction === 'out' ? '，你拒接了' : '，用户拒接了';
    else if (l.endReason === 'no-answer') detail = '，没接';
    else if (l.endReason === 'cancel') detail = l.direction === 'out' ? '，用户取消了' : '，你取消了';
    else detail = '，未接通';
    lines.push([when, `${caller}${detail}`].filter(Boolean).join(' '));
  }
  // 末通转写：只带最近一通的对话内容（我：→用户：／对方：／角色名：→你：；转写与通话记录同刻落盘，按时间窗匹配）
  const latestTs = typeof recent[0].createdAt === 'number' ? recent[0].createdAt : 0;
  const vm = vms
    .map((v) => ({ ts: typeof v.createdAt === 'number' ? v.createdAt : 0, text: typeof v.text === 'string' ? v.text : '' }))
    .sort((a, b) => b.ts - a.ts)
    .find(({ ts }) => Math.abs(ts - latestTs) <= VM_MATCH_WINDOW_MS);
  if (vm && vm.text.trim()) {
    lines.push(`${latestTs > 0 ? fmtDateTime(latestTs) : '最近一通'} 通话内容（转写）：`);
    // fix3-4 自称归一：电话转写行前缀有三种——「我：」（机主）、「对方：」与「角色名：」（都是 AI 本人，
    // phone.tsx 落转写时用 contact.name 兼容旧数据的「对方」），后两者都映射为「你：」
    const name = (charName ?? '').trim();
    for (const rawLine of vm.text.split('\n').slice(0, MSGS_PER_APP)) {
      const t = rawLine.trim();
      if (!t) continue;
      lines.push(
        truncate(
          t.startsWith('我：')
            ? `用户：${t.slice(2)}`
            : (name && t.startsWith(`${name}：`)) || t.startsWith('对方：')
              ? `你：${t.startsWith('对方：') ? t.slice(3) : t.slice(name.length + 1)}`
              : t,
          LINE_CAP_PRIVATE
        )
      );
    }
  }
  return lines;
}

/**
 * 跨 App 环境块：【当前环境】恒存在（AI 永远知道自己在哪个 App）；
 * 其他三个 App 有记录时追加【跨应用近况】（每 App 最近 10 条、时间升序、已标注来源）。
 * share=false（用户关闭跨 App 互通）→ 只输出【当前环境】行。
 */
export async function buildCrossAppBlock(contactId: string, currentApp: CrossAppId, userName: string): Promise<string> {
  try {
    if (!contactId) return '';
    // 大小号隔离：跨 App 近况全部按「当前聊天身份的账号」作用域读（小号侧=小号自己的其他 App 记录）
    const chatAccId = chatAccountScope(currentApp);
    const me = (userName ?? '').trim().slice(0, 20) || '用户';
    // fix3-4 私聊行主语/块头锚点用的机主称呼：缺省回退「机主」（与行前缀一致，不与角色自称混淆）
    const userLabel = (userName ?? '').trim().slice(0, 20) || '机主';
    const envLine = `【当前环境】你现在正在「${APP_LABEL[currentApp] ?? '聊天'}」上和「${me}」聊天。每个 App 是独立的聊天空间，别把其他应用里说的话当成这里发生的。`;
    let share = true;
    try {
      share = getMemSettings(contactId).share !== false;
    } catch {
      share = true; // 设置读不到按默认互通（与 getMemSettings 默认值一致）
    }
    if (!share) return envLine;
    // fix3-4 角色（AI）名：电话转写行的「角色名：」前缀也要归一到「你：」（拿不到不影响其他映射）
    let charName = '';
    try {
      charName = (await getContact(contactId))?.name?.trim() ?? '';
    } catch {
      charName = '';
    }
    const others = (['wx', 'qq', 'sms', 'phone', 'music'] as CrossAppId[]).filter((a) => a !== currentApp);
    const sections: BlockSection[] = [];
    for (const app of others) {
      const lines =
        app === 'phone'
          ? await readPhoneLines(contactId, charName, chatAccId)
          : app === 'music'
            ? readMusicLines(contactId, userLabel, currentApp)
            : readPrivateLines(app, contactId, userLabel, chatAccId);
      if (lines.length === 0) continue; // 空会话的 App 整段跳过
      // 音乐节单独标注背景定位（第二十三轮反馈：修「AI 回复被音乐带偏、不回应用户的话」——
      // 单独播放时所有聊天 App 共用同一套优先级：用户消息最高，音乐只是背景，对方不聊歌就不聊歌）
      // C2 拉黑感知标注：拉黑不切断跨 App 近况（cross-app-reach 依赖 AI「记得」别处的事），
      // 但 AI 必须知道拉黑事实本身——否则拉黑期间用户单方面发的气话会像正常历史一样被接话穿帮
      const blockedNote = (() => {
        if (app !== 'wx' && app !== 'qq' && app !== 'sms') return '';
        try {
          const blk = loadBlock(app as BlockApp, contactId);
          if (blk.byUser) return `（注意：${me} 已经在这个 App 把你拉黑了——你在那边发的消息 TA 收不到，下面的记录只是历史）`;
          if (blk.byChar) return `（你在这个 App 把 ${me} 拉黑了，TA 在那边发不出消息给你）`;
        } catch {
          /* 读不到按无拉黑 */
        }
        return '';
      })();
      const header =
        app === 'music'
          ? `▶ 音乐 听歌动态（只是背景信息：知道${me}在听什么即可，${me}不主动提歌就不要聊歌，回复永远以${me}刚说的话为先）：`
          : `▶ ${APP_LABEL[app]} 最近${app === 'phone' ? '通话' : '对话'}：${blockedNote}`;
      sections.push({ header, lines });
    }
    if (sections.length === 0) return envLine; // 全部其他 App 都无记录：只保留当前环境行
    // fix3-4 块头锚点：「你：」= AI 本人说过的话；「{userLabel}：」= 机主说的（与行前缀实际用字一致）
    const anchor =
      userLabel === '机主'
        ? '（『你：』开头的是你自己说过的话；『机主：』开头的是机主本人说的）'
        : `（『你：』开头的是你自己说过的话；『${userLabel}：』开头的是机主「${userLabel}」说的）`;
    const rest = joinSections(
      `【跨应用近况】以下是最近在其他应用里的聊天记录（已标注来源，仅供衔接话题，注意别混淆）：\n${anchor}`,
      sections,
      Math.max(200, CROSS_APP_BUDGET - envLine.length - 2),
    );
    return rest ? `${envLine}\n\n${rest}` : envLine;
  } catch {
    return ''; // 任何意外都不阻断消息发送（与记忆注入同款容错约定）
  }
}

// ---------------- 群聊块 ----------------

/** 群消息 → 文本行（说话人=名字；机主=用户：；notice/撤回跳过） */
function groupMsgLines(msgs: WxGroupMsg[]): string[] {
  const lines: string[] = [];
  for (const m of sortAsc(msgs).slice(-MSGS_PER_GROUP)) {
    if (m.kind === 'notice' || m.recalled === true) continue; // 系统事件行/撤回（与群聊页上下文同口径）
    const text = msgText(m);
    if (!text) continue;
    const sender = m.role === 'me' ? '用户' : (m.senderName ?? '').trim().slice(0, 20) || '成员';
    lines.push(`${sender}：${truncate(text, LINE_CAP_GROUP)}`);
  }
  return lines;
}

/**
 * 群聊近况块：机主与该角色有共同群聊时，按「群最近一条消息时间」倒序取前 3 个群，
 * 每群带最近 10 条（升序、标注群名与发言人）。无共同群/无消息返回空串（调用方跳过注入）。
 * 群间隔离：每群消息只从自己的 <app>-group-msgs:<gid> 键读取，块内逐群标注，绝不混写。
 * userName 参数与 buildCrossAppBlock 签名对齐（群内机主发言统一「用户」，与私聊行口径一致）。
 *
 * 互通门控（#7，与 buildCrossAppBlock 同款双层）：
 * - 联系人级：getMemSettings(contactId).share === false（用户关掉「跨 App 互通」）→ 返回空串，
 *   群聊原始消息不再流入私聊上下文（此前只有跨 App 块有此闸门，关掉互通不真隔离）；
 * - 群级：群记录的 memoryInterop 开关（对照 memory.ts 的群 interop 门控，语义同「默认关闭 =
 *   群与私聊隔离」）未开启的群不参与注入——群内容流向私聊 AI 上下文比总结记忆更原始，
 *   用户关掉群记忆互通时原始消息同样不应外流。
 */
/**
 * C17 隔离依赖说明：群聊块的账号隔离完全依赖 loadGroupMsgs 的 kvGet 自动作用域
 * （wx-group-msgs:<gid> 命中 wx- 前缀 → effKey 加当前账号后缀）。若未来群消息键改风格
 * （脱离 wx-/qq- 前缀命名），这里会静默失去账号隔离——改动键名前必须同步审查本函数。
 */
export async function buildGroupRecentBlock(contactId: string, userName: string): Promise<string> {
  try {
    if (!contactId) return '';
    // 联系人级互通总闸（设置读不到按默认互通，与 buildCrossAppBlock 口径一致）
    let share = true;
    try {
      share = getMemSettings(contactId).share !== false;
    } catch {
      share = true;
    }
    if (!share) return '';
    // 成员匹配口径与 memory.ts memRecentGroupConvo 一致：memberIds 含该联系人，ownerId 兜底
    const groups = listGroups()
      // 群级记忆互通门控：该群设置页未开启「记忆与私聊互通」→ 群内原始消息不进本块
      .filter((g) => g.memoryInterop === true)
      .filter((g) => g.memberIds.includes(contactId) || g.ownerId === contactId)
      .map((g) => {
        let msgs: WxGroupMsg[] = [];
        try {
          msgs = loadGroupMsgs(g.id);
        } catch {
          msgs = [];
        }
        // 群最近消息时间（升序排序后取末条；空群=0 沉底）
        const asc = sortAsc(msgs);
        return { g, msgs: asc, lastTs: asc.length > 0 ? (asc[asc.length - 1]?.time ?? 0) : 0 };
      })
      .filter(({ msgs }) => msgs.length > 0)
      .sort((a, b) => b.lastTs - a.lastTs)
      .slice(0, GROUPS_LIMIT);
    if (groups.length === 0) return '';
    // 全是系统事件行/撤回的群跳过（无可读对话）
    const sections: BlockSection[] = groups
      .map(({ g, msgs }) => ({
        header: `▶ ${g.app === 'qq' ? 'QQ群' : '微信群'}「${(g.name ?? '').trim() || '未命名群聊'}」：`,
        lines: groupMsgLines(msgs),
      }))
      .filter((s) => s.lines.length > 0);
    if (sections.length === 0) return '';
    // fix3-4 块头锚点：群聊行前缀仍是「用户：」（机主）/「成员名：」（角色与群员），开头先说明「你指谁」
    const anchor = `（『你：』开头的是你自己说过的话；『用户：』开头的是机主「${(userName ?? '').trim().slice(0, 20) || '机主'}」说的）`;
    return joinSections(
      `【群聊近况】你们有共同的群聊，最近群里发生了这些（已标注群名和发言人，别和私聊混淆）：\n${anchor}`,
      sections,
      GROUP_BLOCK_BUDGET,
    );
  } catch {
    return ''; // 任何意外都不阻断消息发送
  }
}

// ---------------- 打包 ----------------

/** 一次拿全两块（通话引擎/聊天页用；Promise.all 并行，互不阻塞） */
export async function buildCrossContextBlocks(
  contactId: string,
  currentApp: CrossAppId,
  userName: string,
): Promise<{ crossAppBlock: string; groupBlock: string }> {
  const [crossAppBlock, groupBlock] = await Promise.all([
    buildCrossAppBlock(contactId, currentApp, userName),
    buildGroupRecentBlock(contactId, userName),
  ]);
  return { crossAppBlock, groupBlock };
}
