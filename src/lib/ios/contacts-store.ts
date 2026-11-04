/**
 * 联系人本地存储（IndexedDB 'contacts' store）：
 * - 联系人 App / 电话 / 信息 / 微信 四 App 共享同一份本地数据（同一浏览器）
 * - 服务端不再存联系人：增删改查、编号自动生成、微信登录校验、NPC 级联删除全部在本地完成
 * - migrateFromServer()：旧版本把联系人存在服务端 SQLite（按浏览器工作区隔离），
 *   升级后首次加载把「本浏览器工作区」的服务端联系人 + 微信背景图一次性搬进本地，
 *   搬完（全部落库成功后）才通知服务端清空对应数据——先搬后删，中途失败下次重来（put 幂等）
 */
import { localDB, genId } from './db';
import {
  getAccountById,
  getActiveAccountFor,
  getActiveAccountIdFor,
  getAccounts,
  MAIN_ACCOUNT_ID,
  scopedConvKey,
  updateAccount,
  deleteAccount as deleteAccountFromRegistry,
  type AccountApp,
  type PhoneAccount,
} from './accounts';
import { kvDel, kvDelRaw, kvGet, kvSet } from './idb-kv';
import { clearContactBinding } from './worldbook';
import { memPurgeContact } from '@/lib/memory';
import { wxChatFlags, qqChatFlags } from '@/lib/chat-flags';
import { phoneBadge, qqUnreads, wxUnreads } from '@/lib/unread-store';
import { wsHeaders } from './workspace';
import {
  avatarFor,
  displayNameOf,
  socialNameOf,
  genPhone,
  genQQ,
  genWechatId,
  isContactKind,
  normalizeAvatar,
  normalizeAvatarMap,
  normalizeRemarkMap,
  normalizeText,
  setFriendAccountResolver,
  withAvatarsForApp,
  type ContactAvatarApp,
  type ContactAvatarMap,
  type ContactPayload,
  type ContactRecord,
  type ContactRemarkApp,
  type ContactRemarkMap,
} from '@/lib/contacts';
import { purgeContactFromGroups } from './groups';
// #46：删联系人时精确中止该联系人单聊会话的在途流式回复与投递尾巴
//（chat-stream-store / ai-delivery 均无对本模块的反向依赖，不引入循环引用）
import { abortStreamsByPrefix } from '@/lib/chat-stream-store';
import { purgeDeliveryQueueByPrefix } from './ai-delivery';

const MIGRATED_KEY = 'ios-contacts-migrated';

// 多账号 Task 41：好友标记按账号隔离的读取口径在 lib/contacts.isFriendIn（纯函数模块）——
// 这里注入「App → 当前账号 id」解析器（getActiveAccountIdFor 兼容 FriendApp 子集），
// 模块加载即安装：所有 App 组件都经 contacts-store 链路加载，渲染前解析器必然就绪。
setFriendAccountResolver(getActiveAccountIdFor);

/**
 * 按当前账号写好友标记（Task 41 加/删好友统一入口）：
 * - 标记落在当前账号作用域（friendWxByAcc/friendQqByAcc/friendSmsByAcc[accId]）——
 *   大号加了 AI 小号看不见、小号之间互不可见、信息匿名号码与大号隔离；
 * - 大号同时同步旧全局标记（friendWx/friendQq/friendSms），
 *   未感知账号的读取点（联系人/电话 App、isPersonGoneEverywhere 等）保持一致；
 * - USER 联系人不适用（恒为好友），直接原样返回。
 */
export async function setAppFriendFlag(
  app: 'wx' | 'qq' | 'sms',
  contactId: string,
  friend: boolean,
): Promise<ContactRecord | null> {
  const existing = await getContact(contactId);
  if (!existing || existing.kind === 'user') return existing ?? null;
  const accId = getActiveAccountIdFor(app);
  const mapKey = app === 'wx' ? 'friendWxByAcc' : app === 'qq' ? 'friendQqByAcc' : 'friendSmsByAcc';
  const legacyKey = app === 'wx' ? 'friendWx' : app === 'qq' ? 'friendQq' : 'friendSms';
  const map: Record<string, boolean> = { ...((existing[mapKey] as Record<string, boolean> | null | undefined) ?? {}), [accId]: friend };
  const patch: Partial<ContactPayload> = { [mapKey]: map } as unknown as Partial<ContactPayload>;
  if (accId === MAIN_ACCOUNT_ID) {
    (patch as Record<string, unknown>)[legacyKey] = friend;
  }
  return updateContact(contactId, patch);
}

/**
 * 按当前账号写「与角色的关系」（多账号关系感知；与 setAppFriendFlag 同款入口）：
 * - 大号：写旧全局 relation（历史口径，联系人 App 表单同样落全局）；
 * - 小号/匿名号：写 relationByAcc[accId]（该账号与角色的关系独立维护，互不影响）；
 * - USER 联系人不适用，原样返回。
 */
export async function setAppRelation(
  app: 'wx' | 'qq' | 'sms' | 'phone',
  contactId: string,
  relation: string,
): Promise<ContactRecord | null> {
  const existing = await getContact(contactId);
  if (!existing || existing.kind === 'user') return existing ?? null;
  const accId = getActiveAccountIdFor(app);
  const value = normalizeText(relation, 60);
  if (accId === MAIN_ACCOUNT_ID) {
    return updateContact(contactId, { relation: value });
  }
  const map: Record<string, string> = { ...(existing.relationByAcc ?? {}) };
  if (value) map[accId] = value;
  else delete map[accId];
  return updateContact(contactId, { relationByAcc: Object.keys(map).length > 0 ? map : null });
}

/**
 * 申请持久化存储权限：联系人/微信账号现在只存本地 IndexedDB，
 * 不申请的话浏览器在磁盘压力下可能不经询问清掉数据（eviction）。
 * 在启动时（首次用户手势前）调用通常拿不到 granted，但 Chrome 对「已安装/常用站点」
 * 会自动授予；失败静默忽略，不影响正常使用。
 */
async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // 不支持/被拒绝：静默忽略
  }
}

/** 微信背景图本地 settings 键（迁移时从服务端搬入） */
export const WX_BG_SETTING_PREFIX = 'wx-bg-';
export type WxBgKey = 'moments' | 'me';
export interface WxBgLocal {
  data: string;
  version: string;
}

/**
 * 联系人专属背景图 settings store 前缀（微信朋友圈/资料页 或 QQ 空间等「按角色隔离」的背景）。
 * key 形如 peer-bg:wx:<contactId> / peer-bg:qq:<contactId>，value 为 data URL（字符串）。
 * 联系人删除时由 purgeChatTracesFor 清扫。
 */
const PEER_BG_PREFIX = 'peer-bg:';

function sortDesc(list: ContactRecord[]): ContactRecord[] {
  return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** 机主显示名缓存（listContacts 每次刷新；仅客户端联系人加载后非空；
 *  注意：displayNameOf 对机主恒真名（socialNameOf 才用昵称）→ 本缓存是 AI 安全的真名，
 *  供 mt-ai-engage/chat-stream-store/altMainName 等 AI 邻接链路消费，勿改回展示名口径） */
let ownerNameCache = '';

/** 全量联系人（createdAt 倒序，与旧服务端 GET 顺序一致） */
export async function listContacts(): Promise<ContactRecord[]> {
  const all = await localDB.getAll('contacts');
  const out = sortDesc(all as ContactRecord[]);
  // 真名同步缓存重建（cachedContactRealName 消费；展示名替换不影响原始记录）
  contactRealNameCache.clear();
  for (const c of out) {
    const nm = c.name?.trim();
    if (nm) contactRealNameCache.set(c.id, nm);
  }
  // 机主显示名缓存（同步读取口 cachedOwnerName 用；人设构建「发送现场」需要同步拿到大号身份名）
  const owner = out.find((c) => c.kind === 'user' && !c.altOf);
  ownerNameCache = owner ? displayNameOf(owner) || owner.name || '' : '';
  return out;
}

/** 同步取机主显示名（备注/昵称优先）：多账号关系感知的人设注入（【用户的另一个身份】段）用；
 *  尚未加载过联系人时返回空串（调用方自行回退「机主」） */
export function cachedOwnerName(): string {
  return ownerNameCache;
}

/**
 * 联系人真名同步缓存（listContacts 每次刷新全量重建）：
 * 美团/淘宝订单分享卡等「落库存的是社交展示名（可能是机主昵称）」的数据，
 * 序列化进 AI 历史时用它把展示名换回真名（用户规则：AI 永不知道机主昵称）。
 * 未加载过（SSR/极端时序）返回空串，调用方回退原展示名。
 */
const contactRealNameCache = new Map<string, string>();
export function cachedContactRealName(id: string): string {
  return contactRealNameCache.get(id) ?? '';
}

/**
 * 按 App 投影的联系人列表：avatar 已替换成该 App 应显示的那张
 * （App 槽位优先，没单独设置回退全局默认）。微信/QQ/信息/电话的加载点统一用它，
 * 保证「微信里换的头像只影响微信」。
 */
export async function listContactsFor(app: ContactAvatarApp): Promise<ContactRecord[]> {
  return withAvatarsForApp(await listContacts(), app);
}

export async function getContact(id: string): Promise<ContactRecord | null> {
  const rec = await localDB.get('contacts', id);
  return (rec as ContactRecord | undefined) ?? null;
}

/**
 * 机主（kind='user' 且非小号档案的联系人）的真实名字：记忆视角统一用它指代用户（取 name 字段，非昵称）。
 * 记忆文本一律用「机主真实名字 + 联系人名字」指代双方；无 user 联系人或名字为空返回空串
 * （调用方自行回退，如微信/QQ 账号名、Apple 账户名）。
 * 多账号 v2：排除小号/匿名号的档案联系人（altOf 非空）——它们是账号的「人」，不是机主。
 */
export async function ownerRealName(): Promise<string> {
  try {
    const me = (await listContacts()).find((c) => c.kind === 'user' && !c.altOf);
    return me?.name?.trim() ?? '';
  } catch {
    return '';
  }
}

/** 当前 App 账号对应的「人」的联系人：main = 机主；alt/anon = altOf/ownerContactId 关联的档案 */
function pickOwnerContact(acc: PhoneAccount, all: ContactRecord[]): ContactRecord | undefined {
  if (acc.kind === 'main') return all.find((c) => c.kind === 'user' && !c.altOf);
  const byAlt = all.find((c) => c.altOf === acc.id);
  if (byAlt) return byAlt;
  if (acc.ownerContactId) return all.find((c) => c.id === acc.ownerContactId);
  return undefined;
}

/**
 * 指定 App 当前账号的「我」的真实名字（多账号 v2）：大号 = 机主联系人；
 * 小号/匿名号 = 其档案联系人名（无档案回退注册表名）。记忆/AI 视角用它指代用户。
 */
export async function ownerRealNameFor(app: AccountApp): Promise<string> {
  try {
    const acc = getActiveAccountFor(app);
    const me = pickOwnerContact(acc, await listContacts());
    const name = me?.name?.trim() || '';
    if (acc.kind !== 'main') return name || acc.name?.trim() || '';
    return name;
  } catch {
    return '';
  }
}

/**
 * 机主资料（真实名字 + 昵称）：仅用于展示/同步链路（美团/淘宝 mtSyncSessionIdentity 口径同源：
 * 社交/电商 App 里我显示昵称）。AI 链路一律只取 realName（用户规则：AI 永远不知道机主昵称）。
 * 无 user 联系人或名字为空返回 null（调用方自行回退）。
 */
export async function ownerProfile(): Promise<{ realName: string; nickname: string | null } | null> {
  try {
    const me = (await listContacts()).find((c) => c.kind === 'user' && !c.altOf);
    if (!me?.name?.trim()) return null;
    return { realName: me.name.trim(), nickname: me.nickname?.trim() || null };
  } catch {
    return null;
  }
}

/**
 * 指定 App 当前账号的「我」的资料（多账号 v2）：大号 = 机主；小号/匿名号 = 档案联系人
 * （无档案回退注册表名）。通话/记忆等链路按各自 App 的账号取身份。
 * 用户规则：机主昵称已全面废除（AI 决策/人设永远不知道机主昵称）——本函数不再返回 nickname。
 */
export async function ownerProfileFor(
  app: AccountApp,
): Promise<{ realName: string } | null> {
  try {
    const acc = getActiveAccountFor(app);
    const me = pickOwnerContact(acc, await listContacts());
    const realName = me?.name?.trim() || (acc.kind !== 'main' ? acc.name?.trim() || '' : '');
    if (!realName) return null;
    return { realName };
  } catch {
    return null;
  }
}

/**
 * 联系人（AI 角色）的真实名字：记忆视角统一用它指代 AI（取 name 字段，非昵称）。
 * 与 ownerRealName() 同源同规则——QQ/微信等 App 的展示层会用昵称替换 name（withDisplayNames），
 * 记忆提取/总结不能被污染；联系人不存在或名字为空返回空串（调用方自行回退）。
 */
export async function contactRealName(id: string): Promise<string> {
  try {
    const c = await getContact(id);
    return c?.name?.trim() ?? '';
  } catch {
    return '';
  }
}

/**
 * 手机号归一化比较键（#14）：与 phone.tsx 的 phoneKey/stripDigits 同款实现——去非数字字符；
 * 13 位且 86 开头去国码；12 位且 0 开头去长途前缀（+86/空格/横线均可对上）。
 * phone.tsx 的 phoneKey 未导出（该文件本任务只读不改），这里复制同款逻辑，
 * 两处任一改动必须同步（注释即契约）。
 */
function normalizePhoneKey(raw: string | null | undefined): string {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('86')) return d.slice(2);
  if (d.length === 12 && d.startsWith('0')) return d.slice(1);
  return d;
}

/**
 * 账号唯一性查重（审计 #12）：手机号/微信号/QQ号是否已被其他联系人占用。
 * 登录（loginWechat/loginQQ 的 hits[0]）与电话按号码解析（phone.tsx）都取「第一个命中」，
 * 账号重复时登录/拨号会静默串到别人——这里供联系人保存流程在落库前警示（确认后仍可保存）。
 * 命中返回占用该值的联系人（listContacts 的 createdAt 倒序 = 与登录解析同款取序），无冲突返回 null；
 * value 空串/纯空白不算冲突（新建留空会自动生成）；excludeId 传编辑中的联系人 id 以排除自身不误报。
 * #14：phone 改按拨号解析同款归一化后比较（裸号码/+86/国码/长途 0/空格横线视为同一号码）——
 * 否则「拨号会解析到同一个人」的两个写法能同时保存，查重口径与 phone.tsx phoneKey 漂移；
 * 归一化后为空（纯符号等）不查重；wxid/qq 维持存值精确匹配（登录解析就是全等比较）。
 */
export async function findContactValueConflict(
  kind: 'phone' | 'wxid' | 'qq',
  value: string,
  excludeId?: string
): Promise<ContactRecord | null> {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return null;
  const vKey = kind === 'phone' ? normalizePhoneKey(v) : '';
  if (kind === 'phone' && !vKey) return null;
  const all = await listContacts();
  const hit = all.find((c) => {
    if (excludeId && c.id === excludeId) return false;
    // phone：按拨号归一化键比较（vKey 非空，对端归一化为空不可能相等）；
    // wxid/qq：与登录解析同口径的精确匹配（存值已经 normalizeText 去首尾空白）
    if (kind === 'phone') return normalizePhoneKey(c.phone) === vKey;
    if (kind === 'wxid') return c.wechatId === v;
    return c.qqId === v;
  });
  return hit ?? null;
}

/**
 * 大号（main）机主资料（Task 40 账号页展示用；v2 单库后直接本库查询）：
 * 取 kind='user' 且非小号档案（altOf 空）的联系人。读取失败返回 null，调用方回退注册表字段。
 */
export async function mainOwnerContact(): Promise<{
  name: string;
  phone: string;
  qqId: string;
  wechatId: string;
  avatar: string | null;
} | null> {
  const pick = (c: ContactRecord | undefined) =>
    c
      ? {
          name: c.name ?? '',
          phone: c.phone ?? '',
          qqId: c.qqId ?? '',
          wechatId: c.wechatId ?? '',
          avatar: c.avatar ?? null,
        }
      : null;
  try {
    return pick((await listContacts()).find((c) => c.kind === 'user' && !c.altOf));
  } catch {
    return null;
  }
}

/**
 * 多账号（Task 40）：为所有缺少档案联系人的小号/匿名号账号自动建 user 档案（altOf 关联）——
 * 注册表里的名字/号码落到联系人，QQ/微信登录列表、电话拨号解析、账号页资料即刻可用；
 * 联系人 App 小号 tab 以 USER 同款表单创建的小号已自带档案（altOf），此处跳过。
 * AI 对该身份零认知（无任何历史），符合「小号对 AI 是陌生人」。大号绝不自动建。
 */
export async function ensureAccountOwnerContacts(): Promise<void> {
  try {
    const all = await listContacts();
    for (const acc of getAccounts()) {
      if (!acc || acc.kind === 'main') continue;
      const linked = all.find((c) => c.altOf === acc.id);
      if (linked) {
        if (acc.ownerContactId !== linked.id) updateAccount(acc.id, { ownerContactId: linked.id });
        continue;
      }
      if (acc.ownerContactId) {
        const oc = all.find((c) => c.id === acc.ownerContactId);
        if (oc && oc.altOf === acc.id) continue; // 引用有效
      }
      const rec = await createContact({
        kind: 'user',
        name: acc.name?.trim() || (acc.kind === 'anon' ? '匿名账号' : '小号'),
        phone: acc.phone || undefined,
        qqId: acc.qqId || undefined,
        wechatId: acc.wechatId || undefined,
        altOf: acc.id,
      });
      updateAccount(acc.id, { ownerContactId: rec.id });
    }
  } catch {
    // 失败静默：账号仍可用（登录列表为空时用户可手动在联系人 App 建号）
  }
}

/**
 * 新建联系人（行为与旧服务端 POST /api/contacts 一致）：
 * kind/name 校验 → NPC 归属必须存在且非 NPC → 编号留空自动生成 → USER 恒为好友
 */
export async function createContact(payload: ContactPayload): Promise<ContactRecord> {
  if (!isContactKind(payload.kind)) throw new Error('kind 必须是 char/user/npc');
  const name = normalizeText(payload.name, 60);
  if (!name) throw new Error('名字不能为空');

  let ownerId: string | null = null;
  if (payload.kind === 'npc') {
    ownerId = normalizeText(payload.ownerId, 64);
    if (!ownerId) throw new Error('请选择为谁添加 NPC');
    const owner = await getContact(ownerId);
    if (!owner || owner.kind === 'npc') throw new Error('归属对象不存在或类型无效');
  }

  const rec: ContactRecord = {
    id: genId(),
    kind: payload.kind,
    ownerId,
    name,
    nickname: normalizeText(payload.nickname, 60),
    gender: normalizeText(payload.gender, 12),
    age: normalizeText(payload.age, 12),
    height: normalizeText(payload.height, 12),
    weight: normalizeText(payload.weight, 12),
    persona: normalizeText(payload.persona, 5000),
    background: normalizeText(payload.background, 5000),
    expressStyle: normalizeText(payload.expressStyle, 2000),
    customRules: normalizeText(payload.customRules, 4000),
    occupation: normalizeText(payload.occupation, 40),
    company: normalizeText(payload.company, 60),
    region: normalizeText(payload.region, 40),
    birthday: normalizeText(payload.birthday, 20),
    relation: normalizeText(payload.relation, 60),
    relationToUser: normalizeText(payload.relationToUser, 60),
    phone: normalizeText(payload.phone, 20) ?? genPhone(),
    wechatId: normalizeText(payload.wechatId, 40) ?? genWechatId(),
    wechatPassword: normalizeText(payload.wechatPassword, 64),
    qqId: normalizeText(payload.qqId, 16) ?? genQQ(),
    qqPassword: normalizeText(payload.qqPassword, 64),
    avatar: normalizeAvatar(payload.avatar),
    avatars: normalizeAvatarMap(payload.avatars),
    remark: normalizeText(payload.remark, 60),
    remarks: normalizeRemarkMap(payload.remarks),
    voiceId: normalizeText(payload.voiceId, 120),
    altOf: normalizeText(payload.altOf, 40) ?? null,
    isFriend: payload.kind === 'user',
    createdAt: new Date().toISOString(),
  };
  await localDB.put('contacts', rec);

  // 新建联系人广播（与 updateContact 的 contact-updated 同款口径）：新建的联系人（尤其机主 USER 档案）
  // 各 App（电话/微信/QQ/信息等）与机主身份双向同步（owner-profile-sync）都需要感知——
  // 建了人之后打开中的页面/监听方立刻按最新名单刷新，不再等下次任意编辑才补上
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('contact-updated', {
          detail: { contactId: rec.id, changed: Object.keys(rec), created: true },
        }),
      );
    } catch {
      // 忽略
    }
  }

  return rec;
}

/**
 * 编辑联系人 / 添加好友（行为与旧服务端 PATCH /api/contacts/[id] 一致）：
 * 只更新传入的键；名字不能清空；NPC 可改归属（须指向存在的非 NPC）；USER 恒为好友。
 * 联系人不存在返回 null；校验失败抛错（错误文案与旧服务端一致）。
 */
export async function updateContact(id: string, patch: Partial<ContactPayload>): Promise<ContactRecord | null> {
  const existing = await getContact(id);
  if (!existing) return null;
  const next: ContactRecord = { ...existing };

  if ('name' in patch) {
    const name = normalizeText(patch.name, 60);
    if (!name) throw new Error('名字不能为空');
    next.name = name;
  }
  if ('nickname' in patch) next.nickname = normalizeText(patch.nickname, 60);
  if ('gender' in patch) next.gender = normalizeText(patch.gender, 12);
  if ('age' in patch) next.age = normalizeText(patch.age, 12);
  if ('height' in patch) next.height = normalizeText(patch.height, 12);
  if ('weight' in patch) next.weight = normalizeText(patch.weight, 12);
  if ('persona' in patch) next.persona = normalizeText(patch.persona, 5000);
  if ('background' in patch) next.background = normalizeText(patch.background, 5000);
  if ('expressStyle' in patch) next.expressStyle = normalizeText(patch.expressStyle, 2000);
  if ('customRules' in patch) next.customRules = normalizeText(patch.customRules, 4000);
  if ('occupation' in patch) next.occupation = normalizeText(patch.occupation, 40);
  if ('company' in patch) next.company = normalizeText(patch.company, 60);
  if ('region' in patch) next.region = normalizeText(patch.region, 40);
  if ('birthday' in patch) next.birthday = normalizeText(patch.birthday, 20);
  if ('relation' in patch) next.relation = normalizeText(patch.relation, 60);
  if ('relationToUser' in patch) next.relationToUser = normalizeText(patch.relationToUser, 60);
  if ('wechatId' in patch) next.wechatId = normalizeText(patch.wechatId, 40);
  if ('wechatPassword' in patch) next.wechatPassword = normalizeText(patch.wechatPassword, 64);
  if ('qqId' in patch) next.qqId = normalizeText(patch.qqId, 16);
  if ('qqPassword' in patch) next.qqPassword = normalizeText(patch.qqPassword, 64);
  if ('avatar' in patch) next.avatar = normalizeAvatar(patch.avatar);
  // 按 App 隔离的头像槽位：合并写入（patch 里只传要改的 App；null = 清除该 App 槽位回退全局）
  if ('avatars' in patch) {
    const merged: ContactAvatarMap = { ...(existing.avatars ?? {}) };
    const inc = normalizeAvatarMap(patch.avatars);
    if (inc) {
      for (const k of Object.keys(inc) as ContactAvatarApp[]) {
        const v = inc[k];
        if (v == null) delete merged[k];
        else merged[k] = v;
      }
    }
    next.avatars = Object.keys(merged).length > 0 ? merged : null;
  }
  // 手机号可编辑但留空不自动生成（避免编辑时悄悄换号）
  if ('phone' in patch) next.phone = normalizeText(patch.phone, 20);
  if ('remark' in patch) next.remark = normalizeText(patch.remark, 60);
  // 按 App 隔离的备注槽位（第四十八轮）：合并写入（patch 里只传要改的 App；null/空串 = 清除该 App 槽位回退全局 remark）
  if ('remarks' in patch) {
    const merged: ContactRemarkMap = { ...(existing.remarks ?? {}) };
    const inc = normalizeRemarkMap(patch.remarks);
    if (inc) {
      for (const k of Object.keys(inc) as ContactRemarkApp[]) {
        const v = inc[k];
        if (v == null || !v) delete merged[k];
        else merged[k] = v;
      }
    }
    next.remarks = Object.keys(merged).length > 0 ? merged : null;
  }
  // 语音音色（角色独立声线；空 = 清除，回退全局默认）
  if ('voiceId' in patch) next.voiceId = normalizeText(patch.voiceId, 120);

  if ('ownerId' in patch && existing.kind === 'npc') {
    const ownerId = normalizeText(patch.ownerId, 64);
    if (ownerId) {
      const owner = await getContact(ownerId);
      if (!owner || owner.kind === 'npc') throw new Error('归属对象不存在或类型无效');
    }
    next.ownerId = ownerId;
  }

  if (typeof patch.isFriend === 'boolean') {
    next.isFriend = existing.kind === 'user' ? true : patch.isFriend;
  }
  // 分 App 好友标记（QQ/微信/信息相互独立，一个 App 添加不影响其他 App）
  if (typeof patch.friendWx === 'boolean') next.friendWx = existing.kind === 'user' ? true : patch.friendWx;
  if (typeof patch.friendQq === 'boolean') next.friendQq = existing.kind === 'user' ? true : patch.friendQq;
  if (typeof patch.friendSms === 'boolean') next.friendSms = existing.kind === 'user' ? true : patch.friendSms;
  // 分账号好友标记（Task 41）：写入传完整 map（调用方 setAppFriendFlag 已按现有 map 合并）
  if ('friendWxByAcc' in patch) next.friendWxByAcc = patch.friendWxByAcc ?? null;
  if ('friendQqByAcc' in patch) next.friendQqByAcc = patch.friendQqByAcc ?? null;
  if ('friendSmsByAcc' in patch) next.friendSmsByAcc = patch.friendSmsByAcc ?? null;
  // 分账号关系（多账号关系感知）：写入传完整 map（调用方 setAppRelation 已按现有 map 合并）
  if ('relationByAcc' in patch) next.relationByAcc = patch.relationByAcc ?? null;

  await localDB.put('contacts', next);

  // 头像变化 → 广播事件（引用式架构的即时刷新口）：各 App（微信/QQ/信息/电话）监听后
  // 刷新自己的联系人缓存，渲染端 liveAvatarOf/avatarFor 实时解析 → 打开中的页面立刻显示新头像。
  // 头像只在联系人资料存一份，历史动态/互动消息只存 peerId 身份引用，无需任何快照同步。
  const globalAvatarChanged = 'avatar' in patch && (next.avatar ?? null) !== (existing.avatar ?? null);
  const slotAvatarChanged =
    'avatars' in patch && JSON.stringify(next.avatars ?? null) !== JSON.stringify(existing.avatars ?? null);
  if ((globalAvatarChanged || slotAvatarChanged) && typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('contact-avatar-changed', { detail: { contactId: id } }));
    } catch {
      // 忽略
    }
  }

  // 资料变更广播（编辑同步修复）：任何字段（名字/手机号/昵称/人设/关系/好友标记…）落库成功都
  // 派发 'contact-updated'——此前只有头像变化才广播，改手机号后各 App（电话/微信/QQ/信息/美团/音乐）
  // 仍持旧快照：拨号按号码解析不到人（播「空号」）、会话面板显示旧名字、美团昵称不同步等。
  // 各 App 监听本事件重载联系人缓存（与 contact-avatar-changed 同款 handler），保存动作本身低频，
  // 本地 IndexedDB 全量重读毫秒级，无性能顾虑。
  // detail.changed = 本次实际发生值变化的字段名（diff next/existing）——机主身份双向同步
  // （owner-profile-sync）只镜像名字/头像，靠它避免「编辑无关字段也覆盖设置侧头像」的误同步
  const changedFields = (Object.keys(next) as (keyof ContactRecord)[]).filter(
    (k) => JSON.stringify((next as ContactRecord)[k] ?? null) !== JSON.stringify((existing as ContactRecord)[k] ?? null)
  );
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('contact-updated', { detail: { contactId: id, changed: changedFields } }));
    } catch {
      // 忽略
    }
  }

  return next;
}

/**
 * #46：按联系人 id 精确中止其单聊会话（wx/qq/sms 三端）的在途流式回复与投递尾巴。
 * fix3-B 的 abortStreamsByPrefix / purgeDeliveryQueueByPrefix 均为裸前缀（startsWith）语义——
 * 传 'wx:c1' 会误伤另一联系人 'wx:c12' 的在途回复；这里加精确边界判断：三端单聊会话键都是
 * 「固定前缀 + 裸联系人 id」，仅当「没有其他存活联系人 id 以本 id 为字符串前缀」时前缀调用
 * 才与精确匹配等价，可安全调用；存在前缀碰撞的存活联系人时跳过中止（宁漏勿伤：本联系人的
 * 数据随后本就被清除，不能为它误中止别人的在途回复）。存活 id 由 genId 生成（21 位定长、
 * 不含冒号），结构上不可能互为前缀，该守卫主要覆盖服务端迁移来的旧格式 id；
 * 极短的旧 id 也可能前缀命中 'wx:group:<gid>' 群会话键，一并防御。
 */
function abortInFlightForContact(id: string, survivingContactIds: readonly string[]): void {
  if (!id) return;
  if (survivingContactIds.some((other) => other && other.startsWith(id))) return;
  if ('group:'.startsWith(id)) return; // 防御极短旧 id 前缀命中群会话键
  for (const sk of [`wx:${id}`, `qq:${id}`, `sms:c:${id}`]) {
    abortStreamsByPrefix(sk);
    purgeDeliveryQueueByPrefix(sk);
  }
}

/**
 * 跨全部账号精确删一个语义键（大号裸键 + 每个非 main 账号的后缀键）：
 * 删联系人是「数据本体没了」，任何账号视角都不该残留；键本身含完整联系人 id，
 * 不能用 kvDelByPrefix（前缀碰撞 c1/c12）。
 */
function kvDelAllAccounts(key: string): void {
  kvDelRaw(key);
  for (const acc of getAccounts()) {
    if (acc.kind === 'main') continue;
    kvDelRaw(`${key}--${acc.id}`);
  }
}

/**
 * 删除联系人后清理其全部「聊天痕迹」与「按联系人 id 派生的互动状态」
 * （NPC 级联删除时对每个被删 id 各调一次）：
 * - 聊天记录（已迁 IndexedDB kv store）：微信 wx-chat-msgs:<id> / QQ qq-chat-msgs:<id> /
 *   信息 ios-chat-msgs:c:<id>（kvDel 同步删内存 + 异步删库；localStorage 旧键一并清扫兼容）；
 * - 会话级设置 map 条目：chat-time-aware（时间感知）与 chat-reply-counts（回复条数）里
 *   该联系人的 wx:<id> / qq:<id> / sms:c:<id> / phone:<id> 四个键；
 * - 互动状态孤儿键（kv store，全部按裸联系人 id 派生）：转发感知事件 wx-ai-events:<id> /
 *   qq-ai-events:<id>、QQ 好感 qq-bond:<id>、QQ 朋友圈点赞 qq-friend-likes:<id>、
 *   被踢·回群感知 char-kick:<id>、AI 建群冷却/邀请/拒绝 ai-group-social:<id>、
 *   三端拉黑状态 wx-block:<id> / qq-block:<id> / sms-block:<id>（block-state 的 `${app}-block:<id>`）；
 * - 互动状态孤儿键（localStorage 直存）：AI 主动来电冷却时间戳 wx-vc-last:<id> /
 *   qq-vc-last:<id> / sms-vc-last:<id>；
 * - 单键 JSON map 里的按联系人条目（读-改-写）：chat-translate-cfg（翻译配置，wx:<id> /
 *   qq:<id> / sms:c:<id>）、sms-queued-turns（信息排队补跑，c:<id>）、wx-queued-turns /
 *   qq-queued-turns（微信/QQ 排队补跑，裸 id；注意 wechat.tsx/qq.tsx 内存单例在同会话内
 *   下次队列写回可能复活条目——刷新后即彻底消失，无功能性影响）；
 * - 朋友圈/QQ空间自动发动态配置（kv 单键 map moments-auto-cfg，条目 <id>:wx / <id>:qq）；
 * - 会话未读角标：wx-chat-unreads / qq-chat-unreads 里的条目（走 unread-store 总线 clear，
 *   内存单例与 localStorage 及订阅者同步，避免下次持久化写回复活）；
 * - 会话标志（置顶/免打扰/背景标记）：wx-chat-flags / qq-chat-flags 里的条目
 *   （走 chat-flags 总线的 reset，内存快照与 localStorage 同步，避免后续 update 写回复活）；
 * - 聊天背景图本体（IndexedDB settings store）：chat-bg:wx:<id> / chat-bg:qq:<id>；
 * - 语音留言本体（IndexedDB voicemails store，VoicemailRecord.contactId 归属）：删除该联系人全部
 *   留言，并按剩余未读数重算电话角标（unread-store phoneBadge，键 ios-phone-badge，HomeScreen
 *   镜像消费），避免「未读语音留言继续计角标」；
 * - 电话 App 个人收藏（IndexedDB settings 键 phoneFavorites，phone.tsx FAV_KEY，值为联系人 id
 *   数组）：移除该联系人条目（phone.tsx 自己的删除路径会同步清，这里兜底其他 App 的删除入口）；
 * - 微信亲属卡两张表（IndexedDB kv，wechat-wallet.tsx LS_FC/LS_FC_IN）：wx-family-cards（我赠送的，
 *   条目 friendId）与 wx-family-cards-in（我收到的，条目 friendId 旧数据可缺省）按 friendId 过滤删除；
 *   注意钱包页持有 useState 快照，同会话内再次保存可能复活条目（同下方排队补跑条目口径，
 *   刷新后彻底消失，条目对已删联系人不可再消费）；
 * - 通话记录 call-logs 按 iOS 惯例保留不删（记录已带名字/号码/头像快照字段，历史可查）；
 * - 在途中止（#46，放在最前）：该联系人单聊会话（wx:<id> / qq:<id> / sms:c:<id>）的在途流式回复
 *   预置已收尾（finalize 不再落盘）并作废服务端接力生成，投递队列未投递尾巴一并丢弃——
 *   防止清除后的落盘回调把刚清掉的聊天记录复活（经前缀碰撞守卫，见 abortInFlightForContact）；
 * - 记忆计数/锚点兜底（#46）：mem-msgcount / mem-anchor 按 memory.ts 键构成精确 kvDel 再清一次
 *   （「已读旧消息尚未写键」的在途回调可能把 memPurgeContact 已清的键写回）；
 * - AI 语音频率/计数器（#44）：ai-voice-freq / ai-voice-counters（localStorage 单键 JSON map）里
 *   的单聊条目 wx:<id> / qq:<id> / sms:c:<id>（信息端联系人会话跟随微信键系）。
 * 全部尽力而为（单键失败不阻塞删除）；记忆库主体由 memPurgeContact 负责不在本函数范围。
 */
function purgeChatTracesFor(id: string, survivingContactIds: readonly string[], name?: string): void {
  if (!id) return;
  try {
    // #46 在途中止（放在最前，先于一切清除）：见函数头注释与 abortInFlightForContact——
    // 中止后 runStream 收尾跳过 finalize（fix3-B 实现预置 finalized=true），
    // 旧会话回复不会写回下方刚清掉的聊天记录键
    abortInFlightForContact(id, survivingContactIds);
    // #46 记忆计数/锚点兜底：memPurgeContact（deleteContact 里先于本函数执行）已清一次，
    // 但在途回调仍可能在其后写回（deleteContact 的 await import('@/lib/moments') 窗口
    // 足以让排队的 memAfterAiTurn 插进同步块之间）——按 memory.ts countKey/anchorKey 键构成
    // 再精确清一次；跨全部账号精确删（mem 键按账号带后缀，见 memory.ts 键构成）
    kvDelAllAccounts(`mem-msgcount:${id}`);
    for (const app of ['wx', 'qq', 'sms', 'phone'] as const) {
      kvDelAllAccounts(`mem-msgcount:${id}:${app}`);
      kvDelAllAccounts(`mem-anchor:${id}:${app}`);
    }
    // 聊天记录（IndexedDB kv store；sms-chat-msgs:<id> 为更早版本的遗留键，一并清扫；跨全部账号）
    for (const k of [
      `wx-chat-msgs:${id}`,
      `qq-chat-msgs:${id}`,
      `ios-chat-msgs:c:${id}`,
      `sms-chat-msgs:${id}`,
    ]) {
      kvDelAllAccounts(k);
      // 兼容清扫：迁移器已删旧键，这里再删一次防历史残留复活
      window.localStorage.removeItem(k);
    }
    // 会话级设置 map（时间感知 / 回复条数）：按会话键删除该联系人条目
    // 多账号（Task 42）：会话键已按账号作用域（wx:<id>--{accId} 变体），一并匹配删除
    for (const mapKey of ['chat-time-aware', 'chat-reply-counts']) {
      const raw = window.localStorage.getItem(mapKey);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const obj = parsed as Record<string, unknown>;
      let changed = false;
      for (const sk of [`wx:${id}`, `qq:${id}`, `sms:c:${id}`, `phone:${id}`]) {
        for (const k of Object.keys(obj)) {
          if (k === sk || k.startsWith(`${sk}--`)) {
            delete obj[k];
            changed = true;
          }
        }
      }
      if (changed) window.localStorage.setItem(mapKey, JSON.stringify(obj));
    }
    // AI 语音频率/计数器（ai-voice.ts FREQ_STORE_KEY / COUNTER_STORE_KEY，localStorage 单键
    // JSON map，#44）：单聊条目键 = 会话键——微信 wx:<id> / QQ qq:<id>；信息端联系人会话跟随
    // 微信键系（chat.tsx voiceFreqKey = `wx:<联系人 id>`，频率与微信同键），历史 sms:c:<id>
    // 形式一并清扫；群条目键带 'group:' 前缀 / '#' 成员后缀（wx:group:<gid>、<群会话键>#<成员 id>），
    // 精确键删除不会误伤其他联系人或群聊（写法对照 groups.ts 群解散的 removeLocalMapKey 同口径）
    for (const mapKey of ['ai-voice-freq', 'ai-voice-counters']) {
      const raw = window.localStorage.getItem(mapKey);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const obj = parsed as Record<string, unknown>;
      let changed = false;
      for (const sk of [`wx:${id}`, `qq:${id}`, `sms:c:${id}`]) {
        for (const k of Object.keys(obj)) {
          if (k === sk || k.startsWith(`${sk}--`)) {
            delete obj[k];
            changed = true;
          }
        }
      }
      if (changed) window.localStorage.setItem(mapKey, JSON.stringify(obj));
    }
    // 小号「机主身份披露」标记（memory.ts 披露门控，localStorage 独立键 mem-alt-disc:{app}:{id}）：
    // 删除联系人时一并清除（跨全部账号后缀变体；phone 端=电话 App 披露标记，账号关联预写同样覆盖）
    // ——重新添加后 AI 回到纯陌生人
    try {
      for (const app of ['wx', 'qq', 'sms', 'phone'] as const) {
        const base = `mem-alt-disc:${app}:${id}`;
        window.localStorage.removeItem(base);
        for (const acc of getAccounts()) {
          if (acc.id !== MAIN_ACCOUNT_ID) window.localStorage.removeItem(`${base}--${acc.id}`);
        }
      }
    } catch {
      // 尽力而为
    }
    // 大号侧「账号关联」记忆（memory.ts mem-acc-link:{id}，kv 设备级共享键）：删除联系人时一并清除
    try {
      kvDelAllAccounts(`mem-acc-link:${id}`);
      window.localStorage.removeItem(`mem-acc-link:${id}`);
    } catch {
      // 尽力而为
    }
    // 互动状态孤儿键（IndexedDB kv store，全部按裸联系人 id 派生；38-c）：
    // 转发感知事件（wechat/wx-group/qq/qq-group 各自的 lsAiEventsKey）/ QQ 好感（qq.tsx lsBondKey）/
    // QQ 朋友圈点赞（qq.tsx LS_FRIEND_LIKE）/ 被踢·回群感知（group-social.ts kickKey）/
    // AI 建群冷却·邀请·拒绝（group-social.ts SOCIAL_KEY）/ 三端拉黑状态（block-state.ts blockKey）
    for (const k of [
      `wx-ai-events:${id}`,
      `qq-ai-events:${id}`,
      `qq-bond:${id}`,
      `qq-friend-likes:${id}`,
      `char-kick:${id}`,
      `ai-group-social:${id}`,
      `wx-block:${id}`,
      `qq-block:${id}`,
      `sms-block:${id}`,
    ]) {
      kvDelAllAccounts(k);
      // 兼容清扫：这些键均由迁移层/运行期直写 kv，localStorage 不会有意写入，这里兜底无害
      window.localStorage.removeItem(k);
    }
    // AI 主动来电冷却时间戳（localStorage 直存，读取处每次现读无内存缓存）：三端同删
    for (const k of [`wx-vc-last:${id}`, `qq-vc-last:${id}`, `sms-vc-last:${id}`]) {
      window.localStorage.removeItem(k);
    }
    // 单键 JSON map 里的按联系人条目（读-改-写，与上方时间感知/回复条数同写法；38-c）：
    // - chat-translate-cfg（翻译配置，chat-translate.ts CFG_KEY）：会话键 wx:<id> / qq:<id> / sms:c:<id>
    //   （chat.tsx 的 sessionKey = `sms:${storageKey}`，联系人会话 storageKey = `c:<id>`）；
    // - 排队补跑回合表：sms-queued-turns 条目键为 storageKey（c:<id>）、wx/qq-queued-turns 条目键为裸联系人 id；
    //   注意 wechat.tsx/qq.tsx 持有内存单例，同会话内下次队列写回可能复活条目（刷新后即彻底消失，
    //   条目对已删联系人不可再消费，无功能性影响）
    for (const [mapKey, sessionKeys] of [
      ['chat-translate-cfg', [`wx:${id}`, `qq:${id}`, `sms:c:${id}`]],
      ['sms-queued-turns', [`c:${id}`]],
      ['wx-queued-turns', [id]],
      ['qq-queued-turns', [id]],
    ] as const) {
      const raw = window.localStorage.getItem(mapKey);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const obj = parsed as Record<string, unknown>;
      let changed = false;
      for (const sk of sessionKeys) {
        if (sk in obj) {
          delete obj[sk];
          changed = true;
        }
      }
      if (changed) window.localStorage.setItem(mapKey, JSON.stringify(obj));
    }
    // 朋友圈/QQ空间自动发动态配置（moments.ts AUTO_CFG_KEY，kv 单键 map，条目键 <contactId>:<platform>）
    try {
      const cfgRaw = kvGet<Record<string, unknown>>('moments-auto-cfg');
      if (cfgRaw && typeof cfgRaw === 'object' && !Array.isArray(cfgRaw)) {
        const cfgObj = cfgRaw as Record<string, unknown>;
        let cfgChanged = false;
        for (const sk of [`${id}:wx`, `${id}:qq`]) {
          if (sk in cfgObj) {
            delete cfgObj[sk];
            cfgChanged = true;
          }
        }
        if (cfgChanged) kvSet('moments-auto-cfg', cfgObj);
      }
    } catch {
      // 清理失败不阻塞删除
    }
    // 微信亲属卡两张表（wechat-wallet.tsx LS_FC/LS_FC_IN，IndexedDB kv 单键数组）：
    // 我赠送的（条目必有 friendId）与我收到的（条目 friendId 旧数据可缺省）都按 friendId 过滤删除；
    // 无 friendId 的旧条目保留（无法归属，宁留勿误删）。钱包页 useState 快照可能同会话复活条目，
    // 同上方排队补跑条目口径：对已删联系人不可再消费，刷新后彻底消失
    for (const fcKey of ['wx-family-cards', 'wx-family-cards-in'] as const) {
      const list = kvGet<Record<string, unknown>[]>(fcKey);
      if (!Array.isArray(list)) continue;
      const next = list.filter((card) => card && typeof card === 'object' && card.friendId !== id);
      if (next.length !== list.length) kvSet(fcKey, next);
    }
    // Task 49 主动发消息痕迹清扫（配置/执行记录/提醒任务/索引；动态 import 防循环依赖：
    // proactive-msg 反向依赖本模块的 listContacts/ownerProfileFor/cachedOwnerName）
    void import('./proactive-msg')
      .then((m) => m.purgeProactiveForContact(id))
      .catch(() => undefined);
  } catch {
    // 清理失败不阻塞删除
  }
  // 会话未读角标：走 unread-store 总线 clear（内存单例 + localStorage + 订阅广播同步）
  try {
    wxUnreads.clear(id);
    qqUnreads.clear(id);
  } catch {
    // 清理失败不阻塞删除
  }
  // 会话标志：走总线 reset（内存 + localStorage + 订阅广播同步）
  wxChatFlags.reset(id);
  qqChatFlags.reset(id);
  // 多账号（Task 42）：未读/标志/时间感知/回复条数/语音频率的存储已按账号作用域，
  // 上方总线只清了当前账号；这里跨全部账号变体键兜底清扫（联系人本体已删，任何账号都不该残留）
  try {
    const stripId = (lsKey: string) => {
      const raw = window.localStorage.getItem(lsKey);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const obj = parsed as Record<string, unknown>;
      const doomed = Object.keys(obj).filter((k) => k === id || k === scopedConvKey(`wx:${id}`) || k === scopedConvKey(`qq:${id}`) || k === scopedConvKey(`sms:c:${id}`) || k.endsWith(`--${id}`));
      if (doomed.length === 0) return;
      for (const k of doomed) delete obj[k];
      window.localStorage.setItem(lsKey, JSON.stringify(obj));
    };
    const suffix = `--${id}`;
    const mapKeyVariants = (base: string): string[] => {
      const out = [base];
      for (const acc of getAccounts()) {
        if (acc.kind !== 'main') out.push(`${base}${suffix}`);
      }
      return out;
    };
    for (const base of ['wx-chat-unreads', 'qq-chat-unreads', 'wx-chat-flags', 'qq-chat-flags']) {
      for (const k of mapKeyVariants(base)) stripId(k);
    }
  } catch {
    // 兜底清扫失败不阻塞删除
  }
  // 群聊级联：把被删联系人从所有群的成员里移除（成员清空的群自动解散，群消息/未读/标志一并清理）；
  // 带上名字让留下的成员收到「XX退出了群聊」事件（AI 由此知道人为什么不见了）
  try {
    purgeContactFromGroups(id, { name });
  } catch {
    // 清理失败不阻塞删除
  }
  // 聊天背景图本体（IndexedDB）：异步清理，失败忽略
  void localDB.delete('settings', `chat-bg:wx:${id}`).catch(() => undefined);
  void localDB.delete('settings', `chat-bg:qq:${id}`).catch(() => undefined);
  // AI 视觉相册 + 视觉决策日志（按联系人隔离）：动态 import 避免与 album-store 循环引用
  //（与 moments 同模式）；级联删除该联系人的全部相册条目与决策历史
  void (async () => {
    try {
      const { deleteAlbumsByContact, deleteVisionDecisionsByContact } = await import('./album-store');
      await Promise.all([deleteAlbumsByContact(id), deleteVisionDecisionsByContact(id)]);
    } catch {
      // 清理失败不阻塞删除
    }
  })();
  // 联系人专属背景图（微信朋友圈/资料页 + QQ 空间等按角色隔离的背景）
  void localDB.delete('settings', `${PEER_BG_PREFIX}wx:${id}`).catch(() => undefined);
  void localDB.delete('settings', `${PEER_BG_PREFIX}qq:${id}`).catch(() => undefined);
  // 电话 App 个人收藏（IndexedDB settings 键 phoneFavorites，值为联系人 id 数组）：异步移除该联系人
  // 条目，失败忽略（键名以 phone.tsx FAV_KEY 为准，phone.tsx 自身删除路径会同步清，这里兜底其他入口）
  void (async () => {
    try {
      const rec = await localDB.get('settings', 'phoneFavorites');
      const list = rec?.value;
      if (Array.isArray(list) && list.includes(id)) {
        await localDB.put('settings', { key: 'phoneFavorites', value: list.filter((x: unknown) => x !== id) });
      }
    } catch {
      // 清理失败不阻塞删除
    }
  })();
  // 语音留言本体（IndexedDB voicemails，按 contactId 归属）：删除该联系人全部留言；
  // 未读留言数由 unread-store phoneBadge（键 ios-phone-badge）镜像 HomeScreen 电话角标，
  // 删库后按剩余未读数重算，避免已删联系人的未读留言继续计角标（phone.tsx 打开时还会再校准）
  void (async () => {
    try {
      const all = await localDB.getAll('voicemails');
      const victims = all.filter((v) => v.contactId === id);
      if (victims.length === 0) return;
      await Promise.all(victims.map((v) => localDB.delete('voicemails', v.id)));
      const rest = await localDB.getAll('voicemails');
      // 多账号 v2：电话角标只统计电话 App 当前账号的未读留言
      const phoneAcc = getActiveAccountFor('phone').id;
      phoneBadge.set(rest.filter((v) => !v.read && (v.account ?? 'main') === phoneAcc).length);
    } catch {
      // 清理失败不阻塞删除
    }
  })();
}

/** 删除联系人（归属对象被删时其名下 NPC 一并级联删除，同旧服务端 DELETE）；删除了返回 true */
export async function deleteContact(id: string): Promise<boolean> {
  const existing = await getContact(id);
  if (!existing) return false;
  const cascadedNpcIds: string[] = [];
  if (existing.kind !== 'npc') {
    const all = await localDB.getAll('contacts');
    for (const c of all as ContactRecord[]) {
      if (c.kind === 'npc' && c.ownerId === id) {
        await localDB.delete('contacts', c.id);
        // 记忆库：级联删除的 NPC 其记忆一并清理（记忆按联系人 ID 隔离，联系人没了记忆也没有归属）
        memPurgeContact(c.id);
        cascadedNpcIds.push(c.id);
      }
    }
  }
  await localDB.delete('contacts', id);
  // 记忆库：删除联系人时其全部记忆（碎片/长期记忆/设置/轮次计数）一并删除，不留孤儿数据
  memPurgeContact(id);
  // 朋友圈/QQ动态：被删联系人（含级联 NPC）的动态/点赞/评论/待回复队列一并清理
  // （动态引入避免与 moments.ts 的静态循环依赖：moments.ts 也引用本模块解析真实名字）
  try {
    const { purgeMomentsForContact } = await import('@/lib/moments');
    for (const npcId of cascadedNpcIds) purgeMomentsForContact(npcId);
    purgeMomentsForContact(id);
  } catch {
    // 清理失败不阻塞删除
  }
  // 聊天痕迹：被删联系人（含级联删除的名下 NPC）的聊天记录/时间感知/回复条数/翻译配置/
  // 排队补跑条目/转发事件/QQ好感·点赞/拉黑/被踢感知/建群冷却/来电冷却/未读角标/会话标志/背景图/
  // AI 语音频率·计数器/在途流式回复与投递尾巴（先中止再清）/记忆计数锚点兜底 一并清理；
  // #46 传清库后的存活联系人 id（本联系人与名下 NPC 已删），供在途中止的前缀碰撞精确边界检查
  const survivingContactIds = (await localDB.getAll('contacts')).map((c) => c.id);
  for (const npcId of cascadedNpcIds) purgeChatTracesFor(npcId, survivingContactIds);
  purgeChatTracesFor(id, survivingContactIds, existing.name);
  // 线下模式（约会）：进行中的见面/见面历史/现场设置/模板覆盖/世界背景缓存 一并清理
  const { purgeOfflineMeetForContact } = await import('@/lib/offline-meet');
  purgeOfflineMeetForContact(id);
  for (const npcId of cascadedNpcIds) purgeOfflineMeetForContact(npcId);
  // 世界书：清理被删联系人（含级联 NPC）的挂载关系键；书籍本体与条目是用户创作，保留不删
  //（专属条目目标指向已删联系人时永远不激活，属无害死配置，用户可在条目编辑里改）
  clearContactBinding(id);
  for (const npcId of cascadedNpcIds) clearContactBinding(npcId);
  // 多账号 v2：被删的是小号/匿名号的档案联系人（altOf）→ 同步删除其注册表账号
  //（账号数据 [kv 后缀键/通话记录/留言] 由 deleteAccount 清理；联系人本体已在上方删除，
  // deleteAccount 里的联系人清理找不到该 id 无副作用）。该账号正在某 App（微信/QQ 等）
  // 使用中 → 该 App 自动切回大号 = 自动退出该账号（事件驱动，不刷新网页），不拦截删除。
  if (existing.altOf) {
    try {
      await deleteAccountFromRegistry(existing.altOf);
    } catch {
      // 注册表清理失败不阻塞联系人删除
    }
  }
  return true;
}

export interface WxLoginSuccess {
  ok: true;
  user: {
    id: string;
    /** 显示名（备注/昵称优先） */
    name: string;
    /** 真实姓名（联系人 name 字段；AI 称呼与记忆统一用） */
    realName: string;
    /** 昵称（只是昵称，不是正式名字） */
    nickname: string | null;
    avatar: string | null;
    wechatId: string | null;
    phone: string | null;
    qqId: string | null;
    persona: string | null;
    /** 多账号 Task 41：非空 = 命中的是小号/匿名号档案（值为注册表账号 id），登录后切到该账号作用域 */
    altOf: string | null;
  };
}
export type WxLoginResult = WxLoginSuccess | { ok: false; error: string };

/**
 * 微信登录校验（本地版，行为与旧服务端 POST /api/wechat/login 一致）：
 * mode 'phone' 手机号+微信密码；'qq' QQ号+QQ密码；'wechat' 微信号优先、其次 QQ 号自动识别。
 * 仅允许 kind='user' 的联系人登录。
 */
export async function loginWechat(mode: 'phone' | 'wechat' | 'qq', rawAccount: string, password: string): Promise<WxLoginResult> {
  const account = typeof rawAccount === 'string' ? rawAccount.trim().slice(0, 120) : '';
  if (!account) return { ok: false, error: '请填写账号' };
  if (!password.trim()) return { ok: false, error: '请填写密码' };

  const all = await listContacts();
  const find = (m: 'phone' | 'wechat' | 'qq', acc: string) => {
    if (m === 'phone') return { hits: all.filter((c) => c.phone === acc), label: '手机号', pwdKind: 'wechat' as const };
    if (m === 'qq') return { hits: all.filter((c) => c.qqId === acc), label: 'QQ 号', pwdKind: 'qq' as const };
    const byWx = all.filter((c) => c.wechatId === acc);
    if (byWx.length > 0) return { hits: byWx, label: '微信号', pwdKind: 'wechat' as const };
    return { hits: all.filter((c) => c.qqId === acc), label: /^\d+$/.test(acc) ? 'QQ 号' : '账号', pwdKind: 'qq' as const };
  };

  const { hits, label, pwdKind } = find(mode, account);
  if (hits.length === 0) return { ok: false, error: `登录失败：该${label}尚未注册微信` };

  const hit = hits[0];
  if (hit.kind !== 'user') return { ok: false, error: '该账号类型暂不支持登录，请使用 user 账号' };

  const expect = pwdKind === 'qq' ? hit.qqPassword : hit.wechatPassword;
  if (!expect || expect !== password) {
    // Task 41（自由登录首次激活）：档案从未设过任何密码 → 首次登录即写入（与槽位登录同规则），
    // 否则无密码的账号在自由登录墙永远登不进；已设密码但当前字段为空时回退另一字段校验
    const other = pwdKind === 'qq' ? hit.wechatPassword : hit.qqPassword;
    if (!expect && !other) {
      const patched = await updateContact(
        hit.id,
        pwdKind === 'qq' ? { qqPassword: password.trim() } : { wechatPassword: password.trim() },
      );
      if (!patched) return { ok: false, error: '登录失败，请稍后重试' };
    } else if (!expect || expect !== password) {
      return { ok: false, error: '账号或密码不正确，请重新输入' };
    }
  }

  return {
    ok: true,
    user: {
      id: hit.id,
      // 微信/QQ 登录返回的显示名用社交展示名（昵称 ?? 真名，Task 32）：登录后 App 内「我」
      // 显示的就是联系人 App 里填的昵称；realName 另带真名供 AI 链路使用
      name: socialNameOf(hit),
      realName: hit.name,
      nickname: hit.nickname ?? null,
      avatar: avatarFor(hit, 'wx'),
      wechatId: hit.wechatId,
      phone: hit.phone,
      qqId: hit.qqId,
      persona: hit.persona,
      // 多账号 Task 41：命中档案联系人 altOf → 自由登录落到对应小号账号作用域（null = 大号机主）
      altOf: hit.altOf ?? null,
    },
  };
}

/**
 * 小号/匿名号槽位的绑定登录（Task 40 修正）：登录墙只认「当前槽位档案联系人」的账号密码——
 * 防止在 A 小号的登录墙里登了 B 的账号密码，导致登录态串槽
 * （表现为：切换账号页绿点显示错账号、再切回已登录过的小号还要重新登录）。
 * - 账号标识必须匹配档案的 手机号/微信号/QQ号 之一（手机号走归一化比较，+86/空格均可）；
 * - 密码匹配档案的 wechatPassword/qqPassword（任一非空匹配即通过）；
 * - 档案从未设过密码 → 首次登录即写入（首次激活），与真实设备「首次登录设置密码」体验一致；
 * - 槽位没有档案联系人（异常场景，开机 ensureAccountOwnerContacts 会自动补建）→ 明确报错。
 * 大号槽位不适用本函数（保持原 loginWechat/loginQQ 自由登录）。
 */
export interface AltSlotLoginSuccess {
  ok: true;
  user: {
    id: string;
    /** 显示名（备注/昵称优先） */
    name: string;
    realName: string;
    nickname: string | null;
    avatar: string | null;
    wechatId: string | null;
    phone: string | null;
    qqId: string | null;
    persona: string | null;
    /** 槽位对应的注册表账号 id（Task 41：登录成功后根组件据此记登录历史） */
    altOf: string | null;
  };
}
export type AltSlotLoginResult = AltSlotLoginSuccess | { ok: false; error: string };

export async function loginAltSlot(
  app: 'wx' | 'qq',
  slot: PhoneAccount,
  rawAccount: string,
  password: string,
): Promise<AltSlotLoginResult> {
  const account = typeof rawAccount === 'string' ? rawAccount.trim().slice(0, 120) : '';
  if (!account) return { ok: false, error: '请填写账号' };
  if (!password.trim()) return { ok: false, error: '请填写密码' };
  const all = await listContacts();
  const profile = all.find(
    (c) => c.kind === 'user' && (c.altOf === slot.id || c.id === slot.ownerContactId),
  );
  if (!profile) return { ok: false, error: `「${slot.name?.trim() || (slot.kind === 'anon' ? '匿名账号' : '小号')}」还没有身份资料，请重启应用后再试` };
  // 槽位名与登录后 App 内显示同口径（Task 40-S；Task 32 改社交展示名：档案昵称优先）
  const slotName = socialNameOf(profile).trim() || slot.name?.trim() || (slot.kind === 'anon' ? '匿名账号' : '小号');

  // 账号标识匹配：手机号归一化比较；微信号/QQ号精确比较
  const accNorm = normalizePhoneKey(account);
  const ids = [profile.phone, profile.wechatId, profile.qqId];
  const idMatched = ids.some((v) => {
    const t = (v ?? '').trim();
    if (!t) return false;
    return t === account || (normalizePhoneKey(t) && normalizePhoneKey(t) === accNorm);
  });
  if (!idMatched) {
    return { ok: false, error: `请使用「${slotName}」的账号密码登录` };
  }

  const pwdWx = profile.wechatPassword?.trim() || '';
  const pwdQq = profile.qqPassword?.trim() || '';
  if (!pwdWx && !pwdQq) {
    // 首次激活：把本次输入的密码写入该 App 对应的密码字段
    const patched = await updateContact(
      profile.id,
      app === 'wx' ? { wechatPassword: password.trim() } : { qqPassword: password.trim() },
    );
    if (!patched) return { ok: false, error: '登录失败，请稍后重试' };
  } else if (password !== pwdWx && password !== pwdQq) {
    return { ok: false, error: '账号或密码不正确，请重新输入' };
  }

  const user = {
    id: profile.id,
    name: socialNameOf(profile),
    realName: profile.name,
    nickname: profile.nickname ?? null,
    avatar: avatarFor(profile, app),
    wechatId: profile.wechatId,
    phone: profile.phone,
    qqId: profile.qqId,
    persona: profile.persona,
    altOf: slot.id,
  };
  return app === 'wx' ? { ok: true, user } : { ok: true, user };
}

/**
 * QQ 登录校验（本地版，与微信登录同源同规则）：
 * mode 'account' QQ号/QID/邮箱 + QQ密码；'phone' 手机号 + QQ密码。
 * 仅允许 kind='user' 的联系人登录；char / npc 一律拦截（「该账号类型暂不支持登录」）。
 * 登录密码统一用联系人的 qqPassword 字段。
 */

export interface QQLoginSuccess {
  ok: true;
  user: {
    id: string;
    /** 显示名（备注/昵称优先） */
    name: string;
    /** 真实姓名（联系人 name 字段；AI 称呼与记忆统一用） */
    realName: string;
    /** 昵称（只是昵称，不是正式名字） */
    nickname: string | null;
    avatar: string | null;
    qqId: string | null;
    phone: string | null;
    persona: string | null;
    /** 多账号 Task 41：非空 = 命中的是小号/匿名号档案（值为注册表账号 id），登录后切到该账号作用域 */
    altOf: string | null;
  };
}
export type QQLoginResult = QQLoginSuccess | { ok: false; error: string };

export async function loginQQ(mode: 'phone' | 'account', rawAccount: string, password: string): Promise<QQLoginResult> {
  const account = typeof rawAccount === 'string' ? rawAccount.trim().slice(0, 120) : '';
  if (!account) return { ok: false, error: '请填写账号' };
  if (!password.trim()) return { ok: false, error: '请填写密码' };

  const all = await listContacts();
  let hits: ContactRecord[];
  let label: string;
  if (mode === 'phone') {
    hits = all.filter((c) => c.phone === account);
    label = '手机号';
  } else {
    // 账密登录：QQ号 / QID / 邮箱（联系人目前只有 qqId 字段，统一按 QQ 号匹配）
    hits = all.filter((c) => c.qqId === account);
    label = 'QQ 号';
  }
  if (hits.length === 0) return { ok: false, error: `登录失败：该${label}尚未注册QQ` };

  const hit = hits[0];
  // char / npc 账号暂不支持登录（与微信一致，只放行 user）
  if (hit.kind !== 'user') return { ok: false, error: '该账号类型暂不支持登录，请使用 user 账号' };

  if (!hit.qqPassword || hit.qqPassword !== password) {
    // Task 41（自由登录首次激活）：从未设过 QQ 密码 → 首次登录即写入（与槽位登录同规则）
    if (!hit.qqPassword) {
      const patched = await updateContact(hit.id, { qqPassword: password.trim() });
      if (!patched) return { ok: false, error: '登录失败，请稍后重试' };
    } else {
      return { ok: false, error: '账号或密码不正确，请重新输入' };
    }
  }

  return {
    ok: true,
    user: {
      id: hit.id,
      // QQ 登录显示名同微信：社交展示名（昵称 ?? 真名，Task 32）
      name: socialNameOf(hit),
      realName: hit.name,
      nickname: hit.nickname ?? null,
      avatar: avatarFor(hit, 'qq'),
      qqId: hit.qqId,
      phone: hit.phone,
      persona: hit.persona,
      // 多账号 Task 41：命中档案联系人 altOf → 自由登录落到对应小号账号作用域（null = 大号机主）
      altOf: hit.altOf ?? null,
    },
  };
}

/** 微信背景图（本地 settings store 存 data URL） */
export async function getWxBg(key: WxBgKey): Promise<WxBgLocal | null> {
  const rec = await localDB.get('settings', `${WX_BG_SETTING_PREFIX}${key}`);
  const value = (rec as { value?: unknown } | undefined)?.value as WxBgLocal | undefined;
  return value && typeof value.data === 'string' ? value : null;
}

export async function setWxBg(key: WxBgKey, data: string): Promise<WxBgLocal> {
  const rec: WxBgLocal = { data, version: String(Date.now()) };
  await localDB.put('settings', { key: `${WX_BG_SETTING_PREFIX}${key}`, value: rec });
  return rec;
}

/**
 * 聊天背景图（微信 / QQ 聊天设置页「从手机上传」；本地 settings store 存 data URL，永久保存）。
 * 图片本体较大不入 localStorage，chat-flags 表里只存 bgMode='image' 标记 + bgV 版本号。
 */
const CHAT_BG_PREFIX = 'chat-bg:';

export async function getChatBgImage(app: 'wx' | 'qq', contactId: string): Promise<string | null> {
  const rec = await localDB.get('settings', `${CHAT_BG_PREFIX}${app}:${contactId}`);
  const data = (rec as { value?: { data?: unknown } } | undefined)?.value?.data;
  return typeof data === 'string' && data ? data : null;
}

export async function setChatBgImage(app: 'wx' | 'qq', contactId: string, data: string): Promise<void> {
  await localDB.put('settings', { key: `${CHAT_BG_PREFIX}${app}:${contactId}`, value: { data, version: String(Date.now()) } });
}

export async function removeChatBgImage(app: 'wx' | 'qq', contactId: string): Promise<void> {
  await localDB.delete('settings', `${CHAT_BG_PREFIX}${app}:${contactId}`);
}

/**
 * 联系人专属背景图（微信朋友圈/资料页 或 QQ 空间等「按角色隔离」的背景）：本地 settings store
 * 存 data URL，永久保存。与 wx-bg-（全局微信背景） / chat-bg:（聊天会话背景）不同——这里按联系人
 * id 隔离，联系人删除时随级联清理。value 为纯字符串 data URL（不裹 {data,version} 结构，轻量化存取）。
 */
export async function getPeerBg(app: 'wx' | 'qq', contactId: string): Promise<string | null> {
  try {
    const rec = await localDB.get('settings', `${PEER_BG_PREFIX}${app}:${contactId}`);
    const v = (rec as { value?: unknown } | undefined)?.value;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

export async function setPeerBg(app: 'wx' | 'qq', contactId: string, data: string): Promise<void> {
  try {
    await localDB.put('settings', { key: `${PEER_BG_PREFIX}${app}:${contactId}`, value: data });
  } catch {
    // 写入失败不阻塞调用方主流程
  }
}

export async function removePeerBg(app: 'wx' | 'qq', contactId: string): Promise<void> {
  try {
    await localDB.delete('settings', `${PEER_BG_PREFIX}${app}:${contactId}`);
  } catch {
    // 删除失败不阻塞调用方主流程
  }
}

/** QQ 个人资料页背景图（本地 settings store 存 data URL，永久保存） */
const QQ_PROFILE_BG_KEY = 'qq-profile-bg';

export async function getQqProfileBg(): Promise<string | null> {
  const rec = await localDB.get('settings', QQ_PROFILE_BG_KEY);
  const data = (rec as { value?: { data?: unknown } } | undefined)?.value?.data;
  return typeof data === 'string' && data ? data : null;
}

export async function setQqProfileBg(data: string): Promise<void> {
  await localDB.put('settings', { key: QQ_PROFILE_BG_KEY, value: { data, version: String(Date.now()) } });
}

/**
 * 一次性迁移：服务端 SQLite → 本地 IndexedDB。
 * POST /api/contacts/migrate 返回本浏览器工作区的联系人 + 全局微信背景图；
 * 全部落库成功后 POST /api/contacts/migrate/done 通知服务端清空（数据不留）。
 * 任一步失败都不写 migrated 标记，下次启动自动重试（本地 put 按 id 幂等）。
 */
export async function migrateFromServer(): Promise<void> {
  if (typeof window === 'undefined') return;
  // 联系人/微信账号只存本地：启动即申请持久化存储（防浏览器磁盘压力下清除 IndexedDB），不阻塞迁移
  void requestPersistentStorage();
  try {
    if (window.localStorage.getItem(MIGRATED_KEY)) return;

    const res = await fetch('/api/contacts/migrate', { method: 'POST', headers: wsHeaders() }).catch(() => null);
    if (!res || !res.ok) return; // 服务暂不可用：下次启动重试
    const data = (await res.json().catch(() => null)) as
      | { contacts?: unknown; backgrounds?: unknown }
      | null;
    const rows = Array.isArray(data?.contacts) ? (data?.contacts as ContactRecord[]) : [];
    const bgs = (data?.backgrounds ?? {}) as Record<string, unknown>;

    for (const row of rows) {
      // 只收合法记录：必须有 id 且 kind 合法（字段原样保留，id 不变 → 聊天记录/收藏引用不断）
      if (!row || typeof row !== 'object') continue;
      const rec = row as ContactRecord;
      if (typeof rec.id !== 'string' || !rec.id || !isContactKind(rec.kind)) continue;
      await localDB.put('contacts', rec);
    }
    let bgCount = 0;
    for (const key of Object.keys(bgs) as WxBgKey[]) {
      const dataUrl = bgs[key];
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
        await setWxBg(key, dataUrl);
        bgCount += 1;
      }
    }

    if (rows.length > 0 || bgCount > 0) {
      // 本地全部就绪 → 通知服务端清空对应数据（先搬后删）
      const done = await fetch('/api/contacts/migrate/done', { method: 'POST', headers: wsHeaders() }).catch(() => null);
      if (!done || !done.ok) return; // 清空失败：不写标记，下次重试（服务端数据还在，本地 put 幂等）
    }
    window.localStorage.setItem(MIGRATED_KEY, '1');
  } catch {
    // 迁移失败不阻塞使用；下次启动重试
  }
}
