'use client';

/**
 * 多账号系统（Task 40 架构 v2）：大号（main）/ 小号（alt）/ 匿名号码（anon）。
 *
 * 数据隔离模型（v2：单库 + 键作用域 + per-app 当前账号）：
 * - 所有数据都在同一个 IndexedDB 库 `ios-phone-db`——设备还是同一台手机，切换账号
 *   「不是换了一部手机」：照片/音乐/备忘录/日历/联系人/主题/字体等全部设备级共享不变；
 * - 只有微信 / QQ / 信息 / 电话四个 App 的数据随账号切换：
 *   ① kv 层（idb-kv.ts）对 `wx-*` / `qq-*` / `ios-chat-*` / `sms-*` 前缀的键按「对应 App 的
 *      当前账号」自动追加 `--{accountId}` 后缀（大号保持原键，旧数据零迁移）；
 *   ② 电话 call-logs / voicemails store 的记录带 account 字段（缺省视为大号）；
 *   ③ 记忆 mem-* 键由 memory.ts 按「聊天所在 App 的当前账号」加后缀（同账号跨 App 共享记忆）。
 * - 当前账号按 App 独立：`ios-phone-active-accounts` = {wx,qq,sms,phone}——QQ 切小号
 *   不影响微信还登着大号（App 之间切换账号分开，不是全局）。
 * - 切换账号 = 写入对应 App 的标记 + 派发 `ios-phone-account-changed` 事件；各 App 监听后
 *   中断在途流并重读自己的数据——**全程不刷新网页**。
 * - 账号注册表存 localStorage `ios-phone-accounts`（设备级）。小号的「人」的档案
 *   （头像/性别/人设/密码等）存为联系人 App 里一条 altOf 指向该账号的 user 联系人，
 *   注册表只记 ownerContactId 引用（登录校验/资料展示复用既有联系人链路）。
 */

export type AccountKind = 'main' | 'alt' | 'anon';

/** 账号跟随的 App（账号按 App 独立切换；'forum' = X论坛，固定大号作用域不参与切换——
 *  论坛是机主的公开社交空间，记忆写入/召回始终落大号（小号视角下论坛记忆不可见，与朋友圈同语义） */
export type AccountApp = 'wx' | 'qq' | 'sms' | 'phone' | 'cabin' | 'forum';

export interface PhoneAccount {
  /** 稳定 id：大号恒为 'main'，其余为创建时生成的 a{ts}{rand} */
  id: string;
  kind: AccountKind;
  /**
   * 小号/匿名号账号的档位（kind='main' 的机主主账号无此字段）：
   * 'alt' = 小号（默认；历史数据无此键等同 'alt'）；
   * 'main' = 大号档（完整身份主账号，在切换账号列表带「大号」标记展示）。
   * 微信/QQ 切换账号页「添加账号」可新建大号档账号；功能与数据隔离同普通小号。
   */
  grade?: 'main' | 'alt';
  /** 显示名：小号默认「小号N」，匿名号默认「匿名账号」；大号留空（各页面优先用本机资料/登录态实时显示） */
  name: string;
  /** 手机号（大号留空用本机资料；小号/匿名号均为 1 开头 11 位虚拟号，与普通手机号同格式） */
  phone: string;
  /** QQ 号（小号生成；匿名号同号复用） */
  qqId: string;
  /** 微信号（小号生成；匿名号同号复用） */
  wechatId: string;
  createdAt: number;
  /**
   * 该账号关联的「人」的档案联系人（联系人 App 中 kind='user' 且 altOf=本账号 id 的记录）。
   * 小号在联系人 App 以 USER 同款表单创建时回填；旧账号（v1 自动建档）在开机时补齐。
   * 大号恒为空（机主联系人自管理）。
   */
  ownerContactId?: string;
}

const REG_KEY = 'ios-phone-accounts';
/** v1 全局当前账号键（只作迁移源读取，不再写入） */
export const ACTIVE_KEY = 'ios-phone-active-account';
/** v2 per-app 当前账号键：JSON {wx,qq,sms,phone} */
const ACTIVE_APPS_KEY = 'ios-phone-active-accounts';
/** 账号切换事件（detail: { app, id }）——各 App 监听并重读数据，全程不刷新网页 */
export const ACCOUNT_CHANGED_EVENT = 'ios-phone-account-changed';
export const MAIN_ACCOUNT_ID = 'main';

/** 键作用域后缀（kv 键与 localStorage 键统一）：小号/匿名号 `--{id}`，大号无后缀 */
const SCOPE_SEP = '--';

// ---------------- 工具 ----------------

function readLs(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeLs(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 存储异常静默：账号功能降级为仅大号
  }
}

/** 生成小号/匿名号的虚拟号码（本地随机，不保证电信唯一性——单机模拟场景足够） */
function genDigits(prefix: string, total: number): string {
  let s = prefix;
  while (s.length < total) s += Math.floor(Math.random() * 10).toString();
  return s;
}

function genWechatId(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = 'a';
  for (let i = 0; i < 9; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

// ---------------- 注册表 ----------------

/** 账号注册表（无则自动补大号条目；大号条目不删） */
export function getAccounts(): PhoneAccount[] {
  let list: PhoneAccount[] = [];
  try {
    const raw = readLs(REG_KEY);
    if (raw) list = JSON.parse(raw) as PhoneAccount[];
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) list = [];
  if (!list.some((a) => a && a.id === MAIN_ACCOUNT_ID)) {
    list.unshift({
      id: MAIN_ACCOUNT_ID,
      kind: 'main',
      name: '',
      phone: '',
      qqId: '',
      wechatId: '',
      createdAt: 0,
    });
  }
  return list;
}

function saveAccounts(list: PhoneAccount[]): void {
  writeLs(REG_KEY, JSON.stringify(list));
}

export function getAccountById(id: string): PhoneAccount | null {
  return getAccounts().find((a) => a.id === id) ?? null;
}

/** 编辑账号（联系人 App 创建/编辑小号时同步注册表）；目标不存在返回 null */
export function updateAccount(
  id: string,
  patch: Partial<Pick<PhoneAccount, 'name' | 'ownerContactId' | 'phone' | 'qqId' | 'wechatId'>>,
): PhoneAccount | null {
  const list = getAccounts();
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  const next: PhoneAccount = { ...list[idx], ...patch };
  if (id === MAIN_ACCOUNT_ID) {
    // 大号条目字段由各页面实时资料兜底，仅允许改 name 备用值
    next.kind = 'main';
    next.ownerContactId = undefined;
  }
  list[idx] = next;
  saveAccounts(list);
  return next;
}

// ---------------- per-app 当前账号 ----------------

type ActiveApps = Record<AccountApp, string>;
const DEFAULT_APPS: ActiveApps = { wx: MAIN_ACCOUNT_ID, qq: MAIN_ACCOUNT_ID, sms: MAIN_ACCOUNT_ID, phone: MAIN_ACCOUNT_ID, cabin: MAIN_ACCOUNT_ID, forum: MAIN_ACCOUNT_ID };

let activeAppsCache: ActiveApps | null = null;

function readActiveApps(): ActiveApps {
  if (activeAppsCache) return activeAppsCache;
  let parsed: Partial<ActiveApps> = {};
  try {
    const raw = readLs(ACTIVE_APPS_KEY);
    if (raw) parsed = JSON.parse(raw) as Partial<ActiveApps>;
  } catch {
    parsed = {};
  }
  const out: ActiveApps = { ...DEFAULT_APPS };
  (Object.keys(DEFAULT_APPS) as AccountApp[]).forEach((app) => {
    const v = parsed[app];
    if (typeof v === 'string' && v && getAccountById(v)) out[app] = v;
  });
  activeAppsCache = out;
  return out;
}

function writeActiveApps(apps: ActiveApps): void {
  activeAppsCache = apps;
  writeLs(ACTIVE_APPS_KEY, JSON.stringify(apps));
}

/** 指定 App 当前账号 id（'main' = 大号） */
export function getActiveAccountIdFor(app: AccountApp): string {
  return readActiveApps()[app] ?? MAIN_ACCOUNT_ID;
}

export function getActiveAccountFor(app: AccountApp): PhoneAccount {
  const id = getActiveAccountIdFor(app);
  return getAccountById(id) ?? getAccounts()[0];
}

export function isMainFor(app: AccountApp): boolean {
  return getActiveAccountIdFor(app) === MAIN_ACCOUNT_ID;
}

/**
 * 切换指定 App 的账号（持久化 + 事件通知，**不刷新网页**）。
 * 同账号重复切换 no-op 返回 false；成功返回 true。
 */
export function switchAccountFor(app: AccountApp, id: string): boolean {
  if (!getAccountById(id)) return false;
  const apps = readActiveApps();
  if (apps[app] === id) return false;
  apps[app] = id;
  writeActiveApps(apps);
  try {
    window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT, { detail: { app, id } }));
  } catch {
    // 极端环境忽略
  }
  return true;
}

/** 指定账号正被哪些 App 使用（删除账号前的占用检查用） */
export function accountUsedBy(id: string): AccountApp[] {
  const apps = readActiveApps();
  return (Object.keys(apps) as AccountApp[]).filter((app) => apps[app] === id);
}

// ---------------- 键作用域（kv 与 localStorage 共用后缀约定） ----------------

/**
 * kv 键所属的账号 App（idb-kv 层自动作用域映射依据）：
 * `wx-*` → 微信；`qq-*` → QQ；`ios-chat-*` / `sms-*` → 信息。
 * 其余键（mem-* 由 memory.ts 自行处理；设备级键）返回 null 不映射。
 * 注意：群本体 group:* / 朋友圈引擎 moments-* / 拉黑 friend-del:* 等跨 App 键不映射（设备级共享）。
 */
export function accountAppOfKey(key: string): AccountApp | null {
  if (key.startsWith('wx-')) return 'wx';
  if (key.startsWith('qq-')) return 'qq';
  if (key.startsWith('ios-chat-') || key.startsWith('sms-')) return 'sms';
  return null;
}

/** 显式构造「指定账号作用域」的键（跨 App 读取其他账号数据用：digest/跨App近况等） */
export function scopedKvKey(key: string, app: AccountApp): string {
  const id = getActiveAccountIdFor(app);
  return id === MAIN_ACCOUNT_ID ? key : `${key}${SCOPE_SEP}${id}`;
}

/**
 * 解析带作用域后缀的键 → { base, accId }；无后缀（大号原键）返回 null。
 * 后缀取最后一个 `--` 之后的部分（键 base 与账号 id 均不含 `--`）。
 */
export function parseScopedKey(key: string): { base: string; accId: string } | null {
  const i = key.lastIndexOf(SCOPE_SEP);
  if (i === -1) return null;
  const accId = key.slice(i + SCOPE_SEP.length);
  if (!accId || accId === MAIN_ACCOUNT_ID) return null;
  return { base: key.slice(0, i), accId };
}

/** 按账号作用域的 localStorage 键：大号返回原键（旧数据/登录态无缝兼容） */
export function accLs(key: string, app: AccountApp): string {
  return scopedKvKey(key, app);
}

/**
 * 会话级语义键按账号作用域（localStorage map 的内层键 / 非映射前缀 kv 键通用）：
 * 键带 `wx-` / `qq-` / `ios-chat-` / `sms-` 前缀 → 按对应 App 当前账号追加 `--{id}` 后缀
 * （大号保持原键，旧数据零迁移）；其余键原样返回。
 * 用途：未读角标 / 置顶免打扰 / 时间感知 / 回复条数 / 表情开关等「按会话记录的状态」
 * 必须跟随账号隔离（规则：切换账号不能沿用上一个账号的数据）。
 */
export function scopedConvKey(key: string): string {
  // 会话键风格一：`wx:<cid>` / `qq:<cid>` / `sms:<key>` / `phone:<cid>`（冒号风格，sessionKey）
  let app: AccountApp | null = null;
  if (key.startsWith('wx:')) app = 'wx';
  else if (key.startsWith('qq:')) app = 'qq';
  else if (key.startsWith('sms:')) app = 'sms';
  else if (key.startsWith('phone:')) app = 'phone';
  // 会话键风格二：kv 语义键的连字符前缀（wx-chat-msgs:* / qq-group-msgs:* / sms-* 等）
  if (!app) app = accountAppOfKey(key);
  if (!app) return key;
  return scopedKvKey(key, app);
}

// ---------------- 兼容层（v1 全局账号 API → sms 语义；存量调用点迁移后删除） ----------------

/** @deprecated 用 getActiveAccountIdFor(app) */
export function getActiveAccountId(): string {
  return getActiveAccountIdFor('sms');
}

/** @deprecated 用 getActiveAccountFor(app) */
export function getActiveAccount(): PhoneAccount {
  return getActiveAccountFor('sms');
}

/** @deprecated 用 isMainFor(app) */
export function isMainAccount(): boolean {
  return isMainFor('sms');
}

/** @deprecated 用 accLs(key, app) */
export function accountScopedKey(key: string): string {
  return accLs(key, 'sms');
}

/** @deprecated 库名恒定（v2 单库）；仅供过渡期引用，迁移后删除 */
export function accountDbName(_id: string): string {
  return 'ios-phone-db';
}

/** @deprecated 用 switchAccountFor(app, id)（不刷新网页） */
export function switchAccount(id: string): void {
  switchAccountFor('sms', id);
}

// ---------------- 登录历史 / 退出后自由登录墙（Task 41） ----------------

/**
 * 登录历史（设备级 localStorage，每 App 一份 id 数组）：
 * 切换账号列表只显示「登录过」的小号——联系人 App 里刚创建、从未在对应 App 登录过的账号
 * 不进列表（真实微信/QQ 同款体验：列表 = 登录记录，不是账号全集）。
 * 登录成功时由各 App 根组件 handleLogin 调 markAccountLoginHistory 记录。
 */
const LOGIN_HIST_KEY: Record<AccountApp, string> = {
  wx: 'wx-login-hist',
  qq: 'qq-login-hist',
  sms: 'sms-login-hist',
  phone: 'phone-login-hist',
  cabin: 'cabin-login-hist',
  forum: 'forum-login-hist',
};

export function markAccountLoginHistory(app: AccountApp, id: string): void {
  if (!id) return;
  const key = LOGIN_HIST_KEY[app];
  let list: string[] = [];
  try {
    const raw = readLs(key);
    if (raw) list = JSON.parse(raw) as string[];
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) list = [];
  if (list.includes(id)) return;
  try {
    writeLs(key, JSON.stringify([...list.filter((x) => typeof x === 'string'), id].slice(-50)));
  } catch {
    // 存储异常静默：仅影响切换列表展示
  }
}

export function accountLoginHistory(app: AccountApp): string[] {
  try {
    const raw = readLs(LOGIN_HIST_KEY[app]);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 退出登录后的「自由登录墙」标记（设备级 localStorage）：
 * 退出账号后不自动登录任何账号（即使大号会话还在）、不锁定登录身份——
 * 登录墙进自由模式（想登哪个登哪个）。各 App 启动 effect 首件事 isForceLoginWallActive：
 * 有标记 → 跳过会话恢复直接进登录墙（**只检查不消费**——标记持续到下一次登录成功，
 * 由各 App handleLogin 调 clearForceLoginWall 清除。这样「退出 → 关掉 App → 再打开」
 * 仍是自由登录墙，而登录过一次后所有账号恢复正常免登录语义）。
 * 2025 补充（登录态保持）：退出登录不再删除该账号的会话键——所有账号（含刚退出的）
 * 的登录状态都保留，重新登录后切换任意账号均免重新输入密码。
 */
const FORCE_LOGIN_KEY: Record<AccountApp, string> = {
  wx: 'wx-force-login',
  qq: 'qq-force-login',
  sms: 'sms-force-login',
  phone: 'phone-force-login',
  cabin: 'cabin-force-login',
  forum: 'forum-force-login',
};

export function requestForceLoginWall(app: AccountApp): void {
  writeLs(FORCE_LOGIN_KEY[app], '1');
}

/** 是否处于「退出后自由登录墙」（只检查不消费；登录成功时由 clearForceLoginWall 清除） */
export function isForceLoginWallActive(app: AccountApp): boolean {
  return readLs(FORCE_LOGIN_KEY[app]) === '1';
}

/** 登录成功：解除自由登录墙，恢复正常会话恢复/免登录切换 */
export function clearForceLoginWall(app: AccountApp): void {
  try {
    window.localStorage.removeItem(FORCE_LOGIN_KEY[app]);
  } catch {
    // 忽略
  }
}

// ---------------- 创建 / 删除 ----------------

/**
 * 新建账号（alt=小号 / anon=匿名号码）并持久化注册表。
 * 不自动切换：调用方拿到 id 后可自行 switchAccountFor()。
 * ownerContactId：小号在联系人 App 以 USER 表单创建时传入其档案联系人 id。
 */
export function createAccount(
  kind: 'alt' | 'anon',
  name?: string,
  opts?: { ownerContactId?: string; grade?: 'main' | 'alt' },
): PhoneAccount {
  const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const list = getAccounts();
  const seq = list.filter((a) => a.kind === 'alt').length + 1;
  /** 大号档（grade='main'）与小号同池编号，默认名区分大号/小号 */
  const grade = opts?.grade === 'main' ? 'main' : 'alt';
  const acc: PhoneAccount =
    kind === 'anon'
      ? {
          id,
          kind: 'anon',
          name: (name ?? '').trim() || '匿名账号',
          // 与普通手机号同格式：1 开头 11 位（Task 40 修正：原 32 开头 10 位不像真实号码）
          phone: genDigits('1', 11),
          qqId: '',
          wechatId: '',
          createdAt: Date.now(),
          ownerContactId: opts?.ownerContactId,
        }
      : {
          id,
          kind: 'alt',
          grade,
          name: (name ?? '').trim() || (grade === 'main' ? `大号${seq}` : `小号${seq}`),
          phone: genDigits('1', 11),
          qqId: genDigits('3', 10),
          wechatId: genWechatId(),
          createdAt: Date.now(),
          ownerContactId: opts?.ownerContactId,
        };
  saveAccounts([...list, acc]);
  return acc;
}

/**
 * 删除账号：移出注册表 + 清理该账号的 localStorage 后缀键 + 清理主库中该账号作用域的
 * kv 键 / 通话记录 / 语音留言 + 删除其档案联系人（altOf）。大号不可删。
 * opts.keepData=true 时保留该账号的全部本地数据（聊天记录/记忆/朋友圈等后缀键、通话
 * 记录、档案联系人）——由用户在删除确认弹窗中决定（规则：删除账号后数据是否保留由
 * 用户决定）；保留的数据成为无归属的孤儿数据（不可见、可在清除浏览器数据时一并清掉）。
 * 正在被某 App 使用的账号可直接删除：使用中的 App 自动切回大号（= 自动退出该账号，
 * switchAccountFor 事件驱动重读数据/登录态，全程不刷新网页；大号登录态保留）。
 */
export async function deleteAccount(
  id: string,
  opts?: { keepData?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  if (id === MAIN_ACCOUNT_ID) return { ok: false, error: '大号不能删除' };
  const list = getAccounts();
  const target = list.find((a) => a.id === id);
  if (!target) return { ok: false, error: '账号不存在' };
  const usedBy = accountUsedBy(id);
  saveAccounts(list.filter((a) => a.id !== id));
  const keepData = opts?.keepData === true;
  // 清理该账号的隔离 localStorage 键（统一后缀 --{id}）；保留数据时跳过
  if (keepData) return finishAccountRemoval(id, usedBy);
  try {
    const suffix = `${SCOPE_SEP}${id}`;
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.endsWith(suffix)) doomed.push(k);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // 忽略
  }
  // 清理主库中该账号作用域的数据（kv 后缀键 + 电话记录 + 档案联系人）
  try {
    const { localDB } = await import('./db');
    const rows = await localDB.getAll('kv');
    await Promise.all(
      rows
        .filter((r) => r && typeof r.key === 'string' && r.key.endsWith(`${SCOPE_SEP}${id}`))
        .map((r) => localDB.delete('kv', r.key)),
    );
    const suffix = `${SCOPE_SEP}${id}`;
    const logs = await localDB.getAll('call-logs');
    await Promise.all(
      logs.filter((l) => l.account === id).map((l) => localDB.delete('call-logs', l.id)),
    );
    const vms = await localDB.getAll('voicemails');
    await Promise.all(
      vms.filter((v) => v.account === id).map((v) => localDB.delete('voicemails', v.id)),
    );
    // 档案联系人：保留数据时一并保留（否则联系人 App 里这个「人」会消失）
    if (!keepData) {
      const contacts = await localDB.getAll('contacts');
      await Promise.all(
        contacts
          .filter((c) => (c as { altOf?: string }).altOf === id)
          .map((c) => localDB.delete('contacts', c.id)),
      );
    }
  } catch {
    // 存储异常忽略（注册表已删，残留数据不可见）
  }
  return finishAccountRemoval(id, usedBy);
}

/** 删除收尾：正在使用该账号的 App 自动切回大号（保留数据时数据不清理但同样要退出登录态） */
async function finishAccountRemoval(id: string, usedBy: AccountApp[]): Promise<{ ok: boolean }> {
  // 正在使用该账号的 App 自动切回大号（= 自动退出该账号）：事件驱动各 App 重读数据/登录态，
  // 全程不刷新网页。必须放在数据清理之后——App 收到事件时旧账号数据已清干净，
  // 大号作用域数据/登录态（原键）不受影响，直接可用。
  for (const app of usedBy) {
    switchAccountFor(app, MAIN_ACCOUNT_ID);
  }
  return { ok: true };
}

// ---------------- v1 → v2 迁移 ----------------

/**
 * v1（每账号独立库 + 全局当前账号）→ v2（单库 + 键作用域 + per-app 账号）开机迁移：
 * ① 全局标记 ios-phone-active-account 有值 → 四个 App 的当前账号都指向它；
 * ② 旧账号库 ios-phone-db--{id} 存在 → 把 kv 键加后缀搬进主库、机主联系人搬进主库
 *    （联系人 altOf=账号 id，注册表补 ownerContactId）、通话记录/留言带 account 字段搬入；
 *    其余 store（照片等）不搬（v2 里设备级数据以主库为准）→ 搬完删除旧库。
 * 幂等：迁移成功即删库，失败下次开机重试（put 幂等）。
 * 必须在 ensureKvReady() 注水之前调用（迁移产生的后缀键要进同一份内存）。
 */
export async function migrateLegacyAccounts(): Promise<void> {
  if (typeof window === 'undefined') return;
  // ① 全局标记迁移
  const legacyActive = readLs(ACTIVE_KEY);
  if (legacyActive && legacyActive !== MAIN_ACCOUNT_ID && getAccountById(legacyActive)) {
    const apps = readActiveApps();
    const untouched = (Object.keys(apps) as AccountApp[]).every((a) => apps[a] === MAIN_ACCOUNT_ID);
    if (untouched) {
      writeActiveApps({ wx: legacyActive, qq: legacyActive, sms: legacyActive, phone: legacyActive, cabin: MAIN_ACCOUNT_ID, forum: MAIN_ACCOUNT_ID });
    }
  }
  // ② 旧账号库数据迁移
  const legacyIds = getAccounts()
    .filter((a) => a.kind !== 'main')
    .map((a) => a.id);
  if (legacyIds.length === 0) return;
  let local: typeof import('./db').localDB | null = null;
  try {
    const mod = await import('./db');
    local = mod.localDB;
  } catch {
    return;
  }
  const { openDB } = await import('idb');
  for (const id of legacyIds) {
    const legacyName = `ios-phone-db${SCOPE_SEP}${id}`;
    let hadData = false;
    try {
      const db = await openDB(legacyName);
      try {
        if (!db.objectStoreNames.contains('kv')) continue;
        const suffix = `${SCOPE_SEP}${id}`;
        // kv：键加后缀搬入主库
        const rows = (await db.getAll('kv')) as { key: string; value: unknown }[];
        for (const row of rows) {
          if (!row || typeof row.key !== 'string') continue;
          hadData = true;
          if (row.key.endsWith(suffix)) continue; // 已是后缀键（极端重复迁移）原样搬
          await local.put('kv', { key: `${row.key}${suffix}`, value: row.value });
        }
        // 联系人：只搬该账号的机主 user 档案（CHAR 等共享数据以主库为准）
        if (db.objectStoreNames.contains('contacts')) {
          const contacts = (await db.getAll('contacts')) as { id: string; kind?: string; name?: string }[];
          const owner = contacts.find((c) => c && c.kind === 'user');
          if (owner && owner.id) {
            const exists = await local.get('contacts', owner.id);
            if (!exists) {
              hadData = true;
              await local.put('contacts', { ...owner, altOf: id } as never);
              updateAccount(id, { ownerContactId: owner.id });
            } else if ((exists as { altOf?: string }).altOf === id) {
              updateAccount(id, { ownerContactId: owner.id });
            }
          }
        }
        // 电话：通话记录/留言带 account 字段搬入
        if (db.objectStoreNames.contains('call-logs')) {
          const logs = (await db.getAll('call-logs')) as { id: string }[];
          for (const l of logs) {
            if (!l?.id) continue;
            hadData = true;
            await local.put('call-logs', { ...l, account: id } as never);
          }
        }
        if (db.objectStoreNames.contains('voicemails')) {
          const vms = (await db.getAll('voicemails')) as { id: string }[];
          for (const v of vms) {
            if (!v?.id) continue;
            hadData = true;
            await local.put('voicemails', { ...v, account: id } as never);
          }
        }
      } finally {
        db.close();
      }
    } catch {
      // 库不存在/打不开：无旧数据，跳过
      continue;
    }
    // 有数据（或库确实存在）才删；空库/打开失败静默跳过（openDB 对不存在库会顺手建空库，这里删除之）
    try {
      indexedDB.deleteDatabase(legacyName);
    } catch {
      // 忽略
    }
    void hadData;
  }
}

/** 供账号页展示：返回该账号的显示名（大号回退「机主」，由页面用实时资料优先） */
export function accountDisplayName(acc: PhoneAccount): string {
  if (acc.id === MAIN_ACCOUNT_ID) return acc.name.trim() || '机主';
  return acc.name;
}
