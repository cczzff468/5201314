'use client';

/** QQ钱包数据层（余额/银行卡/账单/支付密码/小金库） —— v1.9.27 任务10 从 qq.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { X } from 'lucide-react';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
// 美团×AI 联动：QQ 私聊与微信同构接入（规则注入+动作执行），历史里的代付/分享/代点卡片序列化为 AI 可读文本
// Task 40 错误提示优化：错误分类文案 + 连续失败冷却 + 错误详情（居中灰字提示行用，原始报错不直接展示）
// Task 40 草稿箱：输入框文本按会话隔离持久化（刷新/切会话回来不丢，发送成功清空；不进 AI 上下文）
// Task 40 错误提示行：失败消息位置渲染的居中灰字（点击重试/长按菜单）
// 第十六轮：AI 动态状态（情绪+作息）注入
import { // 【fix3-d-4】引擎统一动态视图：转发弹层用显式 author 判定原作者（不再按名字猜）
  listMomentPosts, // 【20-d】升级图重新生成（A2）：长按/右键升级过的真图打开弹层重绘（预填上次描述）
  regenerateMomentImage } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// 多账号 v2（Task 40-2b）：kv 裸键自动按 qq 当前账号作用域；purge 限账号用 kvKeysByPrefix+kvDelRaw
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
// 多账号（Task 40 v2）：注册表/切换/创建走 per-app accounts API；QQ 登录态等 LS 键每次经 accLs(key,'qq')
// 现算（大号原键，小号 --{id} 后缀）；切换账号不刷新网页，根组件监听 ACCOUNT_CHANGED_EVENT 重读
// 头像按 App 隔离：QQ 端读取/写入一律走 qq 槽位（listContactsFor 投影读取，updateContact 的 avatars 合并写入），不再共享联系人 App 的全局默认头像
// 古早主题（retro）：复古 Tab 图标 + 拟物图标底座 + 配色表（QQ 版）
// 生图（锁脸）：照片标签（[图片:描述]/[照片:描述]）提取/生成/规则构建（与微信端共用同一逻辑层，未配置/失败降级文字图片卡片）；
// 手动「文字图片」为卡片版（autoCardText），不走生图
// 【20-d】补充流式分段 carry-over 工具（splitUnfinishedPhotoTag/stripUnfinishedPhotoTag）：
// 流式把 [图片:xxx] 标签切成两段时跨段拼接还原 + 尾部半截标签兜底剥除（与微信/信息端同口径）

import { LS_WALLET, LS_WALLET_BILLS, LS_WALLET_CARDS, localDateKey, uid } from './core';

// ---------------- QQ 钱包（个人中心抽屉「钱包」入口；对照真机：主页/余额/小金库/银行卡/提现/充值/账单） ----------------

export interface WalletData {
  /** 余额（元） */
  balance: number;
  /** Q币 */
  qb: number;
  /** 小金库（元） */
  vault: number;
}

export interface BankCard {
  id: string;
  /** 持卡人 */
  holder: string;
  /** 卡号尾号 4 位（仅本机保存，不上传） */
  last4: string;
  /** 银行名 */
  bank: string;
  /** 完整卡号（自生成卡号无隐私问题；旧版本卡片可能缺失，展示时兜底为星号分组） */
  no?: string;
  /** 卡内金额（元，添加时自定义） */
  balance?: number;
  /** 卡类型：储蓄卡 / 信用卡 */
  type?: string;
  /** 添加时间戳 */
  createdAt?: number;
}

/** 预设银行品牌元数据：卡片渐变品牌色 + 发卡行 BIN 前缀（卡号生成用） */
export const BANK_META: Record<string, { from: string; to: string; bin: string }> = {
  工商银行: { from: '#D62E36', to: '#A3121A', bin: '62220' },
  建设银行: { from: '#0A6EBD', to: '#094E85', bin: '62172' },
  农业银行: { from: '#0DA45F', to: '#087A45', bin: '62284' },
  中国银行: { from: '#B4232C', to: '#821720', bin: '62166' },
  交通银行: { from: '#1263A0', to: '#0B3F6B', bin: '62226' },
  招商银行: { from: '#D2302F', to: '#96191C', bin: '62258' },
  邮储银行: { from: '#0E8A50', to: '#096A3B', bin: '62179' },
};
/** 未识别银行的兜底配色 */
export const BANK_FALLBACK = { from: '#4C6B8A', to: '#2E4A66' };

/** Luhn 校验位：由前 n-1 位算出第 n 位（生成的卡号可通过标准银行卡校验） */
export function luhnCheckDigit(digits: string): number {
  let sum = 0;
  let dbl = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return (10 - (sum % 10)) % 10;
}

/** 生成符合 Luhn 校验的银行卡号：储蓄卡 19 位 / 信用卡 16 位，BIN 前缀跟随所选银行 */
export function genCardNo(bank: string, type: string): string {
  const bin = BANK_META[bank]?.bin ?? '6222';
  const len = type === '信用卡' ? 16 : 19;
  let body = bin;
  while (body.length < len - 1) body += Math.floor(Math.random() * 10).toString();
  return body + luhnCheckDigit(body);
}

/** 卡号展示：4 位一组空格分组；无完整卡号的旧数据兜底为 **** **** **** 尾号 */
export function formatCardNo(card: Pick<BankCard, 'no' | 'last4'>): string {
  const src = card.no && /^\d{15,19}$/.test(card.no) ? card.no : `****${card.last4}`;
  return src.replace(/(\d{4})(?=\d)/g, '$1 ');
}

export interface WalletBill {
  id: string;
  title: string;
  /** 正=收入 负=支出 */
  amount: number;
  ts: number;
  /** 账单类型（美化版账单页筛选/图标用；旧数据缺省按标题推断） */
  kind?: 'redpacket' | 'transfer' | 'topup' | 'withdraw' | 'vault' | 'refund';
  /** 对方头像（转账条目显示对方头像；旧数据/群场景缺省用图标兕底） */
  avatar?: string | null;
  /** 已退款金额（原支出条目下方红色「已退款X元」标注） */
  refund?: number;
}

/** 默认钱包（对照真机演示数据：余额 1.03 / Q币 0.10 / 小金库 0.00） */
export const DEFAULT_WALLET: WalletData = { balance: 1.03, qb: 0.1, vault: 0 };

export function loadWallet(): WalletData {
  try {
    const p: unknown = kvGet(LS_WALLET);
    if (p && typeof p === 'object') {
      const d = p as Partial<WalletData>;
      return {
        balance: typeof d.balance === 'number' && d.balance >= 0 ? d.balance : DEFAULT_WALLET.balance,
        qb: typeof d.qb === 'number' && d.qb >= 0 ? d.qb : DEFAULT_WALLET.qb,
        vault: typeof d.vault === 'number' && d.vault >= 0 ? d.vault : DEFAULT_WALLET.vault,
      };
    }
  } catch {
    // 忽略
  }
  return { ...DEFAULT_WALLET };
}

export function saveWallet(d: WalletData): void {
  try {
    kvSet(LS_WALLET, d);
  } catch {
    // 忽略
  }
}

export function loadBankCards(): BankCard[] {
  try {
    const p: unknown = kvGet<BankCard[]>(LS_WALLET_CARDS);
    if (Array.isArray(p)) return p.filter((c) => c && typeof c === 'object' && typeof (c as BankCard).last4 === 'string');
  } catch {
    // 忽略
  }
  return [];
}

export function saveBankCards(list: BankCard[]): void {
  try {
    kvSet(LS_WALLET_CARDS, list);
  } catch {
    // 忽略
  }
}

export function loadWalletBills(): WalletBill[] {
  try {
    const p: unknown = kvGet<WalletBill[]>(LS_WALLET_BILLS);
    if (Array.isArray(p)) return p.filter((b) => b && typeof b === 'object' && typeof (b as WalletBill).amount === 'number');
  } catch {
    // 忽略
  }
  return [];
}

export function saveWalletBills(list: WalletBill[]): void {
  try {
    kvSet(LS_WALLET_BILLS, list);
  } catch {
    // 忽略
  }
}

/** 从钱包余额扣款（发红包/转账用）：成功返回 true；余额不足返回 false；同步写账单 */
export function payFromWallet(amount: number, billTitle: string, meta?: { kind?: WalletBill['kind']; avatar?: string | null }): boolean {
  const w = loadWallet();
  if (!(amount > 0) || w.balance < amount) return false;
  saveWallet({ ...w, balance: round2(w.balance - amount) });
  saveWalletBills([
    { id: uid(), title: billTitle, amount: -amount, ts: Date.now(), kind: meta?.kind, avatar: meta?.avatar },
    ...loadWalletBills(),
  ].slice(0, 100));
  return true;
}

/** 收款入钱包余额（领取红包用），同步写账单 */
export function gainToWallet(amount: number, billTitle: string, meta?: { kind?: WalletBill['kind']; avatar?: string | null }): void {
  const w = loadWallet();
  saveWallet({ ...w, balance: round2(w.balance + amount) });
  saveWalletBills([
    { id: uid(), title: billTitle, amount, ts: Date.now(), kind: meta?.kind, avatar: meta?.avatar },
    ...loadWalletBills(),
  ].slice(0, 100));
}

/** 退款入钱包余额（红包/转账被退回/拒收/过期）：余额照常增加；账单侧不给收入条目，
 *  而是给最近一条同场景未退款的支出条目标注 refund（美化账单页原条目下红字「已退款X元」，对齐真机） */
export function refundToWallet(amount: number, kind: 'redpacket' | 'transfer'): void {
  if (!(amount > 0)) return;
  const w = loadWallet();
  saveWallet({ ...w, balance: round2(w.balance + amount) });
  const bills = loadWalletBills();
  const idx = bills.findIndex((b) => b.kind === kind && b.amount === -amount && b.refund === undefined);
  if (idx >= 0) {
    saveWalletBills(bills.map((b, i) => (i === idx ? { ...b, refund: amount } : b)));
  } else {
    // 找不到原条目（可能是旧数据/群聊）：兑底写一条退款收入条目，保证资金可追溯
    const fallback: WalletBill = { id: uid(), title: kind === 'redpacket' ? 'QQ红包-退回' : '转账-退回', amount, ts: Date.now(), kind: 'refund' };
    saveWalletBills([fallback, ...bills].slice(0, 100));
  }
}

// ---------------- 支付密码 / 支付方式（红包/转账可选余额或银行卡支付） ----------------

// 支付密码加密落盘（v1.9.2）：与微信/美团共用 pay-pwd-box —— 内存明文缓存同步读（函数签名零变化），
// kv 里落 secret-box enc:v1 密文串，IndexedDB 不再存明文；锁键（qq-pay-pwd-lock）非秘密仍存 localStorage 不动
import { createPwdBox, QQ_PAY_PWD_KEY } from '@/lib/ios/pay-pwd-box';

export interface PayPwdData {
  enabled: boolean;
  /** 6 位数字密码（AES-GCM 加密存本机 IndexedDB，不外传） */
  pwd: string | null;
}

// 键的唯一事实来源在 pay-pwd-box（开机注水按同一常量建 box），此处引用保持 kv 键不变
export const LS_PAY_PWD = QQ_PAY_PWD_KEY;

/** 支付密码 kv box：明文进内存缓存（同步读快路径），密文落 IndexedDB（createPwdBox 按 key 去重，与开机注水共享实例） */
export const qqPayPwdBox = createPwdBox<Partial<PayPwdData>>(LS_PAY_PWD);

export function loadPayPwd(): PayPwdData {
  try {
    const d = qqPayPwdBox.load();
    if (d) {
      // 6 位数字语义校验保持在调用侧（与旧版一致）：box 只管存取形态，不管业务规则
      const pwd = typeof d.pwd === 'string' && /^\d{6}$/.test(d.pwd) ? d.pwd : null;
      return { enabled: d.enabled === true && pwd !== null, pwd };
    }
  } catch {
    // 忽略
  }
  return { enabled: false, pwd: null };
}

export function savePayPwd(d: PayPwdData): void {
  qqPayPwdBox.save(d);
}

// #97 支付密码暴力试错保护——照搬微信 #48 同款：5 次失败 30s 锁定（localStorage 跨组件共享）
export const QQ_LS_PAY_PWD_LOCK = 'qq-pay-pwd-lock';
export const QQ_PAY_PWD_MAX_FAIL = 5;
export const QQ_PAY_PWD_LOCK_MS = 30 * 1000;

export interface QqPayPwdLockData {
  fails: number;
  lockedUntil: number;
}

export function qqLoadPayPwdLock(): QqPayPwdLockData {
  try {
    const raw = window.localStorage.getItem(QQ_LS_PAY_PWD_LOCK);
    if (!raw) return { fails: 0, lockedUntil: 0 };
    const p = JSON.parse(raw) as Partial<QqPayPwdLockData>;
    return {
      fails: typeof p.fails === 'number' && p.fails >= 0 ? p.fails : 0,
      lockedUntil: typeof p.lockedUntil === 'number' && p.lockedUntil > 0 ? p.lockedUntil : 0,
    };
  } catch {
    return { fails: 0, lockedUntil: 0 };
  }
}

export function qqSavePayPwdLock(d: QqPayPwdLockData): void {
  try {
    window.localStorage.setItem(QQ_LS_PAY_PWD_LOCK, JSON.stringify(d));
  } catch {
    // 忽略
  }
}

/** 清零失败次数与锁定（成功支付/修改密码成功/关闭支付密码时调用） */
export function qqClearPayPwdLock(): void {
  qqSavePayPwdLock({ fails: 0, lockedUntil: 0 });
}

/** 记录一次失败：累加 fails，达到 5 次设 lockedUntil = now + 30s；返回更新后的状态 */
export function qqRecordPayPwdFail(): QqPayPwdLockData {
  const cur = qqLoadPayPwdLock();
  const fails = cur.fails + 1;
  const lockedUntil = fails >= QQ_PAY_PWD_MAX_FAIL ? Date.now() + QQ_PAY_PWD_LOCK_MS : cur.lockedUntil;
  const next = { fails, lockedUntil };
  qqSavePayPwdLock(next);
  return next;
}

/** 从指定银行卡扣款（红包/转账选卡支付用），同步写账单；卡不存在或余额不足返回 false */
export function payFromCard(cardId: string, amount: number, billTitle: string, meta?: { kind?: WalletBill['kind']; avatar?: string | null }): boolean {
  if (!(amount > 0)) return false;
  const list = loadBankCards();
  const idx = list.findIndex((c) => c.id === cardId);
  if (idx < 0) return false;
  const card = list[idx];
  if ((card.balance ?? 0) < amount) return false;
  list[idx] = { ...card, balance: round2((card.balance ?? 0) - amount) };
  saveBankCards(list);
  saveWalletBills([
    { id: uid(), title: `${billTitle}（${card.bank}尾号${card.last4}）`, amount: -amount, ts: Date.now(), kind: meta?.kind, avatar: meta?.avatar },
    ...loadWalletBills(),
  ].slice(0, 100));
  return true;
}

/** 支付前预检：所选支付方式（余额/银行卡）余额是否充足 */
export function canPay(methodId: string, amount: number): boolean {
  if (!(amount > 0)) return false;
  if (methodId === 'balance') return loadWallet().balance >= amount;
  const c = loadBankCards().find((x) => x.id === methodId);
  return Boolean(c) && (c?.balance ?? 0) >= amount;
}

/** 按所选支付方式扣款（余额 / 银行卡），同步写账单；meta 传对方名/头像（账单条目展示用） */
export function executePayment(methodId: string, amount: number, billTitle: string, meta?: { kind?: WalletBill['kind']; avatar?: string | null }): boolean {
  if (!(amount > 0)) return false;
  if (methodId === 'balance') return payFromWallet(amount, billTitle, meta);
  return payFromCard(methodId, amount, billTitle, meta);
}

/** 退款原路退回银行卡（美团退款用）：卡余额回补 + 写一条收入账单（kind=refund） */
export function refundToBankCard(cardId: string, amount: number, billTitle = '美团外卖-退款'): boolean {
  if (!(amount > 0)) return false;
  const list = loadBankCards();
  const idx = list.findIndex((c) => c.id === cardId);
  if (idx < 0) return false;
  const card = list[idx];
  list[idx] = { ...card, balance: round2((card.balance ?? 0) + amount) };
  saveBankCards(list);
  saveWalletBills([
    { id: uid(), title: `${billTitle}（${card.bank}尾号${card.last4}）`, amount, ts: Date.now(), kind: 'refund' as const },
    ...loadWalletBills(),
  ].slice(0, 100));
  return true;
}

/** 支付方式展示名（支付密码验证浮层副标题用） */
export function methodLabel(methodId: string): string {
  if (methodId === 'balance') return 'QQ钱包余额';
  const c = loadBankCards().find((x) => x.id === methodId);
  return c ? `${c.bank}（尾号${c.last4}）` : '支付方式';
}

// ---------------- 小金库收益（按七日年化每日结算，localStorage 持久化） ----------------

/** 演示利率：最高七日年化 1.5120% */
export const VAULT_RATE = 0.015120;
export const VAULT_DAILY_RATE = VAULT_RATE / 365;

export interface VaultEarnEntry {
  /** 本地日期键（2026-2-4） */
  date: string;
  /** 当日收益（元） */
  amount: number;
}

export interface VaultEarnData {
  /** 上次结算日期（本地日期键） */
  lastDate: string;
  log: VaultEarnEntry[];
}

export const LS_VAULT_EARN = 'qq-vault-earn';

export function loadVaultEarn(): VaultEarnData {
  try {
    const p: unknown = kvGet(LS_VAULT_EARN);
    if (p && typeof p === 'object') {
      const d = p as Partial<VaultEarnData>;
      if (typeof d.lastDate === 'string' && Array.isArray(d.log)) {
        return { lastDate: d.lastDate, log: d.log.filter((e) => Boolean(e) && typeof e.date === 'string' && typeof e.amount === 'number') };
      }
    }
  } catch {
    // 忽略
  }
  return { lastDate: '', log: [] };
}

export function saveVaultEarn(d: VaultEarnData): void {
  try {
    kvSet(LS_VAULT_EARN, d);
  } catch {
    // 忽略
  }
}

/** 本地日期键转 Date（避免 'Y-M-D' 非 ISO 串的解析差异） */
export function parseDateKey(key: string): Date | null {
  const parts = key.split('-').map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/** 结算小金库收益：从上次结算日（首次回溯到最早一笔小金库账单日）逐日补记到今天，按当前余额近似；同日重复调用直接返回缓存 */
export function settleVaultEarn(vault: number): VaultEarnData {
  const today = localDateKey();
  const prev = loadVaultEarn();
  if (prev.lastDate === today) return prev;
  let start = prev.lastDate;
  if (!start) {
    const vaultBills = loadWalletBills().filter((b) => b.title === '转入小金库' || b.title === '小金库转出');
    start = vaultBills.length ? localDateKey(new Date(Math.min(...vaultBills.map((b) => b.ts)))) : today;
  }
  const log = [...prev.log];
  const cur = parseDateKey(start) ?? parseDateKey(today);
  const end = parseDateKey(today);
  if (cur && end) {
    let it = cur <= end ? new Date(cur) : new Date(end); // 时钟回拨兜底：从今天起算
    let guard = 0;
    while (guard < 400) {
      guard += 1;
      const key = localDateKey(it);
      const amt = Math.round(vault * VAULT_DAILY_RATE * 10000) / 10000;
      if (amt > 0 && !log.some((e) => e.date === key)) log.push({ date: key, amount: amt });
      if (key === today) break;
      it.setDate(it.getDate() + 1);
    }
  }
  log.sort((a, b) => (a.date < b.date ? -1 : 1));
  const next: VaultEarnData = { lastDate: today, log: log.slice(-90) };
  saveVaultEarn(next);
  return next;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export function fmtMoney(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 金额大数字：整数大号 + 两位小数小号（对照真机余额/Q币「1.03」排版） */
export function MoneyDigits({ value, className = '', fracClassName = '' }: { value: number; className?: string; fracClassName?: string }) {
  const [int, frac] = Math.abs(value).toFixed(2).split('.');
  return (
    <span className={className}>
      {value < 0 ? '-' : ''}
      {int}
      <span className={fracClassName}>.{frac}</span>
    </span>
  );
}

/** 金额输入通用约束：最多 7 位整数 + 2 位小数 */
export function sanitizeAmount(v: string): string {
  return /^\d{0,7}(\.\d{0,2})?$/.test(v) ? v : v.slice(0, -1);
}
