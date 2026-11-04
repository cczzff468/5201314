/**
 * 联系人 App 共享工具：CHAR（AI 角色）/ USER（用户人设）/ NPC（配角）。
 * 生成函数同时供前端「生成」按钮与后端自动补全使用（纯函数，两端通用）。
 */

export type ContactKind = 'char' | 'user' | 'npc';

export const CONTACT_KINDS: ContactKind[] = ['char', 'user', 'npc'];

export function isContactKind(v: unknown): v is ContactKind {
  return typeof v === 'string' && (CONTACT_KINDS as string[]).includes(v);
}

/** 已保存的联系人记录（GET /api/contacts 返回的形状；createdAt 序列化为字符串） */
export interface ContactRecord {
  id: string;
  kind: ContactKind;
  ownerId: string | null;
  name: string;
  /** 昵称（QQ/微信等社交 App 显示的名字；空 = 显示真实名字） */
  nickname: string | null;
  gender: string | null;
  age: string | null;
  height: string | null;
  weight: string | null;
  persona: string | null;
  background: string | null;
  /** 表达风格（说话的表达方式/风格基调，如「傲娇毒舌」「温柔轻声细语」；与 persona 里的性格描述互补，
   *  注入人设时独立成段【表达风格】；可选字段：历史数据无此键，读取处用 ?. 兼容） */
  expressStyle?: string | null;
  /** 自定义 AI 规则（v49 功能二：用户给这个角色定的私人规矩，一行一条，如「永远叫我宝贝」「别提工作」；
   *  注入人设时独立成段【用户定制的规则】且优先级高于人设/性格/表达风格——用户写什么就遵守什么；
   *  可选字段：历史数据无此键，读取处用 ?. 兼容） */
  customRules?: string | null;
  occupation: string | null;
  company: string | null;
  region: string | null;
  /** 生日（几月几号，如「3月5日」；可不带年份） */
  birthday?: string | null;
  relation: string | null;
  /** 仅 NPC：对机主（USER）的关系（如 网友/同事/用户的朋友/情敌）；relation 是对归属者（CHAR/USER）的关系。
   *  可选字段：历史数据无此键，读取处一律用 ?./?? 兼容 */
  relationToUser?: string | null;
  phone: string | null;
  wechatId: string | null;
  wechatPassword: string | null;
  qqId: string | null;
  qqPassword: string | null;
  avatar: string | null;
  /** 按 App 隔离的头像槽位（可选；历史数据无此键）。
   *  某个 App 没有单独设置头像时回退到全局 avatar（联系人 App 里设置的那张）。
   *  微信里 AI/用户换头像只写 avatars.wx，不影响 QQ/信息/电话。 */
  avatars?: ContactAvatarMap | null;
  /** 是否已添加为好友（手机级状态：联系人/电话 App 用；CHAR/NPC 创建后默认 false；USER 恒为 true） */
  isFriend: boolean;
  /** 微信好友标记（QQ/微信/信息好友相互独立；缺省 = 沿用旧全局 isFriend） */
  friendWx?: boolean;
  /** QQ 好友标记（缺省 = 沿用旧全局 isFriend） */
  friendQq?: boolean;
  /** 信息 App 好友标记（缺省 = 沿用旧全局 isFriend） */
  friendSms?: boolean;
  /** 微信好友标记·按账号隔离（多账号 Task 41）：键 = 账号 id（大号 'main'），值 = 好友与否。
   *  大号无记录时回退旧全局 friendWx/isFriend（旧数据兼容）；小号/匿名号无记录 = 未添加。 */
  friendWxByAcc?: Record<string, boolean> | null;
  /** QQ 好友标记·按账号隔离（结构同 friendWxByAcc） */
  friendQqByAcc?: Record<string, boolean> | null;
  /** 信息好友标记·按账号隔离（结构同 friendWxByAcc；匿名号码与大号/小号互不可见） */
  friendSmsByAcc?: Record<string, boolean> | null;
  /** 与角色的关系·按账号隔离（多账号关系感知）：键 = 账号 id，值 = 该账号视角下的关系文本。
   *  大号把苏晴处成恋人、小号刚加她只是普通朋友，两边互不影响（规则：每个账号和角色的关系独立维护）。
   *  读取口径统一走 relationForAccount（分账号记录优先 → 大号/存量回退旧全局 relation）。 */
  relationByAcc?: Record<string, string> | null;
  /** 真实姓名（withDisplayNames 展示副本专用：昵称替换 name 时把原 name 存到这里；
   *  人设注入用——角色要知道自己的大名/真名，别人用真名叫 TA 时不能不承认） */
  realName?: string | null;
  /** 备注名（仅机主自己可见的显示名；设置后聊天界面/消息列表优先显示备注，AI 人设不变）。
   *  第四十八轮：备注按 App 隔离——微信/QQ/信息各自独立（remarks 槽位优先，
   *  未设置回退此全局 remark，联系人 App 里设的那张对全部 App 生效） */
  remark?: string | null;
  /** 按 App 隔离的备注槽位（第四十八轮；可选，历史数据无此键）。
   *  某个 App 没有单独设置备注时回退全局 remark（联系人 App 里设置的那个）。
   *  微信里改备注只写 remarks.wx，不影响 QQ/信息/电话。 */
  remarks?: ContactRemarkMap | null;
  /** 语音音色（该角色在电话/微信/QQ 里说活用的 voiceId；空 = 用全局默认音色）。
   *  每次播放时实时重读，切角色/改音色后下一句即生效 */
  voiceId?: string | null;
  /** 多账号（Task 40 v2）：非空 = 该 user 联系人是某个小号/匿名号账号的「人」的档案
   *  （值为注册表账号 id，PhoneAccount.ownerContactId 反向引用）。
   *  档案随联系人 App 小号 tab 管理；USER 列表/机主解析（ownerRealName 等）会排除它们。 */
  altOf?: string | null;
  createdAt: string;
}

/** 联系人（API 输入/输出通用形状，全部可选字段由调用方校验） */
export interface ContactPayload {
  id?: string;
  kind: ContactKind;
  ownerId?: string | null;
  name: string;
  nickname?: string | null;
  gender?: string | null;
  age?: string | null;
  height?: string | null;
  weight?: string | null;
  persona?: string | null;
  background?: string | null;
  /** 表达风格（说话方式/风格基调；注入 AI 决策人设【表达风格】段） */
  expressStyle?: string | null;
  /** 自定义 AI 规则（一行一条；注入人设【用户定制的规则】段，优先级高于人设） */
  customRules?: string | null;
  occupation?: string | null;
  company?: string | null;
  region?: string | null;
  /** 生日（几月几号） */
  birthday?: string | null;
  relation?: string | null;
  /** 仅 NPC：对机主（USER）的关系 */
  relationToUser?: string | null;
  phone?: string | null;
  wechatId?: string | null;
  wechatPassword?: string | null;
  qqId?: string | null;
  qqPassword?: string | null;
  avatar?: string | null;
  /** 按 App 隔离的头像槽位（合并写入：传 { wx: dataUrl } 只改微信槽，传 { wx: null } 清除回退全局） */
  avatars?: ContactAvatarMap | null;
  isFriend?: boolean;
  friendWx?: boolean;
  friendQq?: boolean;
  friendSms?: boolean;
  /** 好友标记·按账号隔离（写入传完整 map；见 ContactRecord 同名字段说明） */
  friendWxByAcc?: Record<string, boolean> | null;
  friendQqByAcc?: Record<string, boolean> | null;
  friendSmsByAcc?: Record<string, boolean> | null;
  /** 与角色的关系·按账号隔离（写入传完整 map；见 ContactRecord 同名字段说明） */
  relationByAcc?: Record<string, string> | null;
  remark?: string | null;
  /** 按 App 隔离的备注槽位（合并写入：传 { wx: '小凡' } 只改微信备注，传 { wx: null } 清除回退全局 remark） */
  remarks?: ContactRemarkMap | null;
  /** 语音音色（角色在电话/微信/QQ 里的说话音色；空 = 用全局默认） */
  voiceId?: string | null;
  /** 多账号：小号/匿名号账号档案标记（创建时一次性绑定，见 ContactRecord.altOf） */
  altOf?: string | null;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 展示名：备注 > 昵称 > 真实名字。
 * QQ/微信等社交 App 的联系人显示统一走这里（备注/昵称不是真实名字）。
 * 用户规则：机主本人（kind='user'）在此恒返回真实名字——本函数同时被 AI 邻接链路
 * （cachedOwnerName/群成员解析等）消费，绝不能把机主昵称漏进 AI；
 * 社交 App 展示层要用机主昵称时走 socialNameOf / withDisplayNames({ social: true })。
 * 第四十八轮：传 app 时备注解析按 App 隔离（remarks 槽位优先，回退全局 remark）。
 */
export function displayNameOf(
  c: Pick<ContactRecord, 'name' | 'nickname'> & { remark?: string | null; remarks?: ContactRemarkMap | null; kind?: string | null },
  app?: ContactRemarkApp
): string {
  if (c.kind === 'user') return c.name;
  const rk = (app ? remarkForApp(c, app) : c.remark)?.trim();
  if (rk) return rk;
  const nick = c.nickname?.trim();
  return nick ? nick : c.name;
}

/**
 * 社交展示名（仅 QQ/微信/美团/淘宝等 App 的显示层用；Task 32）：
 * 机主（kind='user'）→ 昵称 ?? 真名（联系人 App 里填的昵称就是这些 App 里显示的名字；
 * AI 永远不知道昵称——本函数只允许进纯显示链路，禁止喂给任何人设/决策 prompt）；
 * 其他联系人同 displayNameOf（备注 > 昵称 > 真名）。
 * 第四十八轮：传 app 时备注解析按 App 隔离。
 */
export function socialNameOf(
  c: Pick<ContactRecord, 'name' | 'nickname' | 'kind'> & { remark?: string | null; remarks?: ContactRemarkMap | null },
  app?: ContactRemarkApp
): string {
  if (c.kind === 'user') {
    const nick = c.nickname?.trim();
    return nick ? nick : c.name;
  }
  return displayNameOf(c, app);
}

/**
 * 把一组联系人的 name 替换成展示名（备注/昵称优先，仅供 QQ/微信/信息等 App 内部显示用，真实名字不变）。
 * opts.social = true：机主本人也按 socialNameOf 替换（QQ/微信/美团/淘宝里我显示昵称，
 * 副本 realName 存真名——addressNameOf/meTileLabel 按 realName 优先，AI 链路不受污染）；
 * 缺省（信息/电话/联系人 App/AI 邻接调用）机主跳过，恒真名（Task 31 口径不变）。
 * opts.app（第四十八轮）：备注按 App 隔离解析（remarks 槽位优先，回退全局 remark）。
 */
export function withDisplayNames(list: ContactRecord[], opts?: { social?: boolean; app?: ContactRemarkApp }): ContactRecord[] {
  const social = opts?.social === true;
  const app = opts?.app;
  return list.map((c) => {
    if (c.kind === 'user') {
      if (!social) return c;
      const sn = socialNameOf(c, app);
      return sn && sn !== c.name ? { ...c, name: sn, realName: c.realName ?? c.name } : c;
    }
    const rk = (app ? remarkForApp(c, app) : c.remark)?.trim();
    return !(rk || c.nickname?.trim()) ? c : { ...c, name: displayNameOf(c, app), realName: c.realName ?? c.name };
  });
}

// ---------------- 名字 / 昵称区分（AI 称呼与成员解析共用） ----------------

/**
 * AI 对用户的称呼方式（全局设置；'name' = 用名字「凡凡」（默认），'nickname' = 用昵称「凑凑」）。
 * 持久化在设置 Store（settings store 'addressMode' 键）。
 */
export type AddressMode = 'name' | 'nickname';

/**
 * AI 称呼名：恒用「真实名字」（旧「用昵称呼叫」设置已废除，mode 仅保留兼容旧存储）。
 * 名字/昵称混淆修复的核心取值函数——原始记录（name=真名）与展示副本（name=昵称、realName=原真名）
 * 两种形状都能正确取到真名：副本 realName / 原始 name，无真名回退 name；昵称永不返回。
 */
export function addressNameOf(c: { name: string; nickname?: string | null; realName?: string | null; kind?: string | null }, _mode?: AddressMode): string {
  void _mode;
  const real = c.realName?.trim() ?? '';
  return real || c.name;
}

/**
 * 联系人的全部可识别名字（去重）：真名 / 展示名 / 昵称 / 备注。
 * AI 写成员名字时可能用其中任何一个（人设里教过大名、聊天里见过昵称）——
 * 群管理标记（禁言/踢人/设管理员）的目标解析全部按这套变体匹配，名字写错一个形式不再导致操作静默失败。
 */
export function contactNameVariants(c: { name: string; nickname?: string | null; realName?: string | null; remark?: string | null }): string[] {
  const out = new Set<string>();
  const push = (v?: string | null) => {
    const t = (v ?? '').trim();
    if (t) out.add(t);
  };
  push(c.realName);
  push(c.name);
  push(c.nickname);
  push(c.remark);
  return [...out];
}

/**
 * 名字变体里是否命中目标名（精确 → 互相包含逐级；n 为空永远不命中）。
 * 与群组件 resolveTarget 的「精确 → 包含」口径一致，供多变体匹配复用。
 */
export function nameVariantHit(variants: string[], n: string): boolean {
  const t = n.trim();
  if (!t) return false;
  if (variants.some((v) => v === t)) return true;
  return variants.some((v) => v.includes(t) || t.includes(v));
}

/**
 * 成员格点显示名（群聊设置页/群聊气泡里「我」的名字标签用）：
 * 机主 → 昵称 ?? 真名（Task 32：社交 App 里我的名字=昵称，没填昵称才回退真名；纯显示位，不进 AI）；
 * 其他联系人 → 称呼名（真名优先）。
 */
export function meTileLabel(c: { name: string; nickname?: string | null; realName?: string | null; kind?: string | null }, _mode?: AddressMode): string {
  void _mode;
  if (c.kind === 'user') {
    const nick = c.nickname?.trim();
    if (nick) return nick;
    const real = c.realName?.trim() ?? '';
    return real || c.name;
  }
  return addressNameOf(c);
}

/** 拥有独立好友状态的社交 App（QQ / 微信 / 信息：一个 App 添加好友不影响其他 App） */
export type FriendApp = 'wx' | 'qq' | 'sms';

/**
 * 多账号：好友标记按「对应 App 当前账号」取。
 * 本模块是前后端通用纯函数，不直接依赖客户端的 lib/ios/accounts——由客户端壳
 * （contacts-store.ts 加载时）注入解析器；未注入（后端/SSR/极端时序）按大号口径走旧逻辑。
 * 解析器返回账号 id（大号恒为 'main'，与 accounts.ts MAIN_ACCOUNT_ID 一致）。
 */
type FriendAccountResolver = (app: 'wx' | 'qq' | 'sms' | 'phone') => string;

let friendAccountResolver: FriendAccountResolver | null = null;

export function setFriendAccountResolver(fn: FriendAccountResolver): void {
  friendAccountResolver = fn;
}

function friendAccountIdOf(app: 'wx' | 'qq' | 'sms' | 'phone'): string {
  try {
    return friendAccountResolver ? friendAccountResolver(app) : 'main';
  } catch {
    return 'main';
  }
}

/**
 * 指定 App 当前账号 id（同步；供人设构建等「发送现场」场景使用）。
 * 与 isFriendIn/relationForAccount 同一解析器：客户端由 contacts-store 注入，
 * 后端/SSR 未注入时返回 'main'（大号口径，零破坏）。
 */
export function activeAccountIdOf(app: 'wx' | 'qq' | 'sms' | 'phone'): string {
  return friendAccountIdOf(app);
}

/**
 * 与角色的关系·按账号取（多账号关系感知）：
 * - 大号：旧全局 relation（历史口径，写侧同样落全局）；
 * - 小号/匿名号：分账号记录（relationByAcc[accId]）优先；
 *   无记录时——该账号有自己的好友标记（Task 41 分账号添加的）→ 视为未设置（空串，
 *   人设回「普通朋友」默认，大号处成的恋人不会自动变成小号的关系）；
 *   连分账号好友标记都没有（存量老数据）→ 回退旧全局 relation（兼容，行为不变）。
 */
export function relationForAccount(
  c: Pick<ContactRecord, 'relation' | 'relationByAcc' | 'friendWxByAcc' | 'friendQqByAcc' | 'friendSmsByAcc'>,
  app: 'wx' | 'qq' | 'sms' | 'phone'
): string {
  const globalRel = c.relation?.trim() ?? '';
  const accId = friendAccountIdOf(app);
  if (accId === 'main') return globalRel;
  const scoped = c.relationByAcc?.[accId];
  const t = typeof scoped === 'string' ? scoped.trim() : '';
  if (t) return t;
  const byAcc = app === 'wx' ? c.friendWxByAcc : app === 'qq' ? c.friendQqByAcc : app === 'sms' ? c.friendSmsByAcc : undefined;
  if (typeof byAcc?.[accId] === 'boolean') return ''; // 该账号自己加的好友：关系独立，不继承大号
  return globalRel;
}

/**
 * 某 App 内「当前账号」是否已添加好友：
 * - USER 恒为好友（自己的账号）
 * - 分账号标记（friendXxByAcc）有记录时以记录为准——大号加了 AI 小号看不见、
 *   小号之间互不可见、信息匿名号码与大号隔离（Task 41）
 * - 大号无分账号记录时回退旧全局标记（friendWx/friendQq/friendSms → isFriend，旧数据兼容）
 * - 小号/匿名号无记录 = 未添加（小号好友列表从零开始，正是隔离语义）
 */
export function isFriendIn(
  c: Pick<
    ContactRecord,
    | 'kind'
    | 'isFriend'
    | 'friendWx'
    | 'friendQq'
    | 'friendSms'
    | 'friendWxByAcc'
    | 'friendQqByAcc'
    | 'friendSmsByAcc'
  >,
  app: FriendApp
): boolean {
  if (c.kind === 'user') return true;
  const byAcc = app === 'wx' ? c.friendWxByAcc : app === 'qq' ? c.friendQqByAcc : c.friendSmsByAcc;
  const accId = friendAccountIdOf(app);
  const scoped = byAcc?.[accId];
  if (typeof scoped === 'boolean') return scoped;
  if (accId === 'main') {
    const legacy = app === 'wx' ? c.friendWx : app === 'qq' ? c.friendQq : c.friendSms;
    return typeof legacy === 'boolean' ? legacy : !!c.isFriend;
  }
  return false;
}

function pick(chars: string): string {
  return chars.charAt(randInt(0, chars.length - 1));
}

/** 手机号：1 + [3-9] + 9 位数字（符合大陆手机号格式） */
export function genPhone(): string {
  let rest = '';
  for (let i = 0; i < 9; i++) rest += String(randInt(0, 9));
  return `1${pick('3456789')}${rest}`;
}

/** 微信号：wxid_ + 8 位小写字母/数字（贴近真实 wxid 格式；字母开头段保证字母主导） */
export function genWechatId(): string {
  const pool = 'abcdefghjkmnpqrstuvwxyz23456789';
  let tail = '';
  for (let i = 0; i < 8; i++) tail += pick(pool);
  return `wxid_${tail}`;
}

/** QQ 号：5-10 位、首位非 0 */
export function genQQ(): string {
  const len = randInt(5, 10);
  let out = String(randInt(1, 9));
  for (let i = 1; i < len; i++) out += String(randInt(0, 9));
  return out;
}

const PWD_LOWER = 'abcdefghjkmnpqrstuvwxyz';
const PWD_UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const PWD_DIGIT = '23456789';
const PWD_SYMBOL = '!@#$%&*?';

/** 密码：10 位，保证含小写/大写/数字/符号各至少 1 个，其余随机 */
export function genPassword(length = 10): string {
  const all = PWD_LOWER + PWD_UPPER + PWD_DIGIT + PWD_SYMBOL;
  const chars = [
    pick(PWD_LOWER),
    pick(PWD_UPPER),
    pick(PWD_DIGIT),
    pick(PWD_SYMBOL),
  ];
  while (chars.length < Math.max(4, length)) chars.push(pick(all));
  // Fisher-Yates 洗牌打乱
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * 生日归一化：把「6.20」「6/20」「6-20」「06.20」「1999.6.20」「6月20」「6月20日」「1999年6月20日」
 * 等常见写法统一转成「6月20日」/「1999年6月20日」，
 * 保证 AI 人设 system prompt 与详情页展示都能无歧义理解；无法解析的写法原样返回。
 */
export function formatBirthday(v?: string | null): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  // 带年份：1999年6月20日 / 1999.6.20 / 1999-6-20 / 1999/6/20
  const full = t.match(/^(\d{4})\s*[年.．/／\-]\s*(\d{1,2})\s*[月.．/／\-]\s*(\d{1,2})\s*日?号?$/);
  if (full) {
    const y = Number(full[1]);
    const mo = Number(full[2]);
    const d = Number(full[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}年${mo}月${d}日`;
  }
  // 不带年份：6月20日 / 6.20 / 6/20 / 6-20 / 06.20
  const short = t.match(/^(\d{1,2})\s*[月.．/／\-]\s*(\d{1,2})\s*日?号?$/);
  if (short) {
    const mo = Number(short[1]);
    const d = Number(short[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${mo}月${d}日`;
  }
  return t.slice(0, 30);
}

/** 文本字段统一 trim；空串归一为 null */
export function normalizeText(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, maxLen);
}

/** 头像 data URL 校验（允许 png/jpeg/webp/gif，限制 400KB，防止把数据库撑爆） */
export function normalizeAvatar(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)) return null;
  if (v.length > 400 * 1024) return null;
  return v;
}

// ---------------- 按 App 隔离的备注（第四十八轮：微信/QQ/信息各自独立，回退全局 remark） ----------------

/** 拥有独立备注槽位的 App（与 FriendApp 同一套短标识；电话/联系人 App 不设独立备注——它们改的是全局 remark） */
export type ContactRemarkApp = 'wx' | 'qq' | 'sms';

export const CONTACT_REMARK_APPS: ContactRemarkApp[] = ['wx', 'qq', 'sms'];

/** 按 App 备注槽位：键缺省/不存在 = 该 App 未单独设置（读时回退全局 remark）；空串/null = 显式清除 */
export type ContactRemarkMap = { [K in ContactRemarkApp]?: string | null };

/**
 * 某 App 里应该显示的备注：App 槽位优先（含空串视为已清除，返回空），
 * 槽位未设置才回退全局 remark（联系人 App 里设置的那个）。
 * 全部读点统一走这里，保证「微信里改备注只影响微信」。
 */
export function remarkForApp(
  c: Pick<ContactRecord, 'remark' | 'remarks'> | null | undefined,
  app: ContactRemarkApp
): string {
  if (!c) return '';
  if (app in (c.remarks ?? {})) {
    const per = c.remarks?.[app];
    return (per ?? '').trim();
  }
  return (c.remark ?? '').trim();
}

/** 备注槽位归一化：非法键丢弃、字符串去空白截 60 字（与全局 remark 同限）、null/空串表示显式清除（保留键）。无有效条目返回 null */
export function normalizeRemarkMap(v: unknown): ContactRemarkMap | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const src = v as Record<string, unknown>;
  const out: ContactRemarkMap = {};
  let any = false;
  for (const k of Object.keys(src)) {
    if (!(CONTACT_REMARK_APPS as string[]).includes(k)) continue;
    const val = src[k];
    if (val == null) {
      out[k as ContactRemarkApp] = null;
      any = true;
      continue;
    }
    if (typeof val !== 'string') continue;
    const t = val.trim().slice(0, 60);
    out[k as ContactRemarkApp] = t;
    any = true;
  }
  return any ? out : null;
}

// ---------------- 按 App 隔离的头像（微信/QQ/信息/电话各自独立，回退全局默认） ----------------

/** 拥有独立头像槽位的 App（与 FriendApp / GroupApp 同一套短标识；phone = 电话 App） */
export type ContactAvatarApp = 'wx' | 'qq' | 'sms' | 'phone';

export const CONTACT_AVATAR_APPS: ContactAvatarApp[] = ['wx', 'qq', 'sms', 'phone'];

/** 按 App 头像槽位：键缺省/不存在 = 该 App 未单独设置（读时回退全局 avatar）；null = 显式清除 */
export type ContactAvatarMap = { [K in ContactAvatarApp]?: string | null };

/**
 * 某 App 里应该显示的头像：App 槽位优先，没有单独设置才回退全局默认（联系人 App 里那张）。
 * 全部读点统一走这里，保证「微信换头像只影响微信」。
 */
export function avatarFor(
  c: Pick<ContactRecord, 'avatar' | 'avatars'> | null | undefined,
  app: ContactAvatarApp
): string | null {
  if (!c) return null;
  const per = c.avatars?.[app];
  if (per) return per;
  return c.avatar ?? null;
}

/** 单个联系人按 App 投影（把 avatar 替换成该 App 应显示的那张；未变化时原样返回，不产生新对象） */
export function withAvatarForApp<T extends ContactRecord>(c: T, app: ContactAvatarApp): T {
  const av = avatarFor(c, app);
  return (av ?? null) === (c.avatar ?? null) ? c : ({ ...c, avatar: av } as T);
}

/**
 * 身份引用 → 联系人（liveAvatarOf 与存量快照瘦身共用的唯一归属口径）：
 * peerId 精确命中优先；无 peerId（legacy 数据 / 机主本人的动态与评论）按「展示名 / 真名 / 昵称」兜底。
 */
export function contactByRef(
  ref: { peerId?: string | null; name?: string | null },
  contacts: ContactRecord[]
): ContactRecord | undefined {
  const byId = ref.peerId ? contacts.find((c) => c.id === ref.peerId) : undefined;
  if (byId) return byId;
  const nm = ref.name ?? '';
  if (!nm) return undefined;
  return contacts.find((c) => displayNameOf(c) === nm || c.name === nm || (c.realName ?? '') === nm);
}

/**
 * 实时头像解析（全 App 唯一读取口，引用式架构的核心）：
 * 历史数据（朋友圈动态/互动消息/新的朋友通知等）只存身份引用（peerId + 展示名），不存头像——
 * 头像只在联系人资料里存一份，这里渲染时实时取当前值，换头像后所有历史展示位自动生效：
 * - peerId 精确命中（legacy 名字兜底）→ avatarFor(contact, app)（App 槽位优先，回退全局默认）；
 * - 联系人已删除（匹配不到）→ 保留快照原值，宁旧勿丢（快照仍在的数据才走这条）。
 * QQ/微信/信息/电话共用这一套读取逻辑（app 传各自标识）。
 */
export function liveAvatarOf(
  snapshot: string | null | undefined,
  ref: { peerId?: string | null; name?: string | null },
  contacts: ContactRecord[],
  app: ContactAvatarApp
): string | null {
  const hit = contactByRef(ref, contacts);
  if (hit) return avatarFor(hit, app);
  return typeof snapshot === 'string' && snapshot ? snapshot : null;
}

/** 一组联系人按 App 投影（与 withDisplayNames 同款展示层手法；配合使用：withDisplayNames(withAvatarsForApp(list, app))） */
export function withAvatarsForApp(list: ContactRecord[], app: ContactAvatarApp): ContactRecord[] {
  return list.map((c) => withAvatarForApp(c, app));
}

/** 头像槽位归一化：非法键丢弃、字符串过 normalizeAvatar、null 表示显式清除（保留键）。无有效条目返回 null */
export function normalizeAvatarMap(v: unknown): ContactAvatarMap | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const src = v as Record<string, unknown>;
  const out: ContactAvatarMap = {};
  let any = false;
  for (const k of Object.keys(src)) {
    if (!(CONTACT_AVATAR_APPS as string[]).includes(k)) continue;
    const val = src[k];
    if (val == null) {
      out[k as ContactAvatarApp] = null;
      any = true;
      continue;
    }
    const norm = normalizeAvatar(val);
    if (norm) {
      out[k as ContactAvatarApp] = norm;
      any = true;
    }
  }
  return any ? out : null;
}
