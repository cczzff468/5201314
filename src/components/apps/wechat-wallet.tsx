'use client';

/**
 * 微信「服务」页面栈（钱包体系）：
 * 服务主页 → 钱包 → 零钱 / 零钱明细 / 零钱通 / 银行卡 / 亲属卡（介绍 → 选人 → 设置 → 管理）
 * 数据独立存 IndexedDB kv store（wx-wallet / wx-wallet-cards / wx-change-bills / wx-lcq / wx-family-cards），与 QQ 钱包互不影响
 * 界面按微信真实截图 1:1 还原：零钱页、零钱通黄色主题、银行卡添加页、亲属卡三页
 */

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  BedDouble,
  Building2,
  CarTaxiFront,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  CreditCard,
  Delete,
  Dices,
  Flower2,
  Gamepad2,
  Gem,
  Heart,
  HeartPulse,
  Navigation,
  Plus,
  ScanLine,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  TrainFront,
  TrendingUp,
  Umbrella,
  Utensils,
  UtensilsCrossed,
  Wallet as WalletIcon,
  X,
} from 'lucide-react';
import { WxIcChange, WxIcFund, WxIcBankCard, WxIcFamilyCard } from './wx-icons';
import type { ContactRecord } from '@/lib/contacts';
// 亲属卡付款（商户消费）扣款：wxExecutePayment 定义在 wechat.tsx（循环引用仅在事件回调中运行时调用，安全）
import { wxExecutePayment } from './wechat';

// ---------------- 数据层 ----------------

export interface WxCard {
  id: string;
  bank: string;
  /** 完整卡号（生成的 16 位 Luhn 合法卡号；旧数据可能为空） */
  no: string;
  tail: string;
  holder: string;
  balance: number;
  /** 添加时间戳（旧数据可能缺失） */
  createdAt?: number;
}

interface WxBill {
  id: string;
  kind: '充值' | '提现' | '转入零钱通' | '零钱通转出' | '红包' | '转账' | '亲属卡付款' | '红包退款' | '转账退款' | '美团外卖' | '淘宝购物';
  amount: number; // 正 = 零钱增加
  time: number;
  /** 对方名（红包/转账/亲属卡条目标题与头像解析用；旧数据/群场景缺省） */
  peer?: string;
  /** 对方头像（dataURL；转账条目显示对方头像，缺省用图标兕底） */
  avatar?: string | null;
  /** 原支出条目已被退款（账单页金额下方红色「对方已退还/已全额退款」标注） */
  refunded?: boolean;
}

export type WxBillKind = WxBill['kind'];

interface WxLcq {
  balance: number;
  totalEarn: number;
  yesterdayEarn: number;
  /** 收益已结算到的日期（Y-M-D），同日幂等 */
  lastDate: string;
}

/** 我赠送的亲属卡（钱包管理页列表；赠送时同步向聊天写入卡片消息） */
export interface WxFamilyCard {
  id: string;
  friendId: string;
  friendName: string;
  friendAvatar: string | null;
  relation: string;
  monthlyLimit: number;
  used: number;
  /** #23：returned = AI 退回/拒收（终态，管理页灰显「已退回」；此前该状态缺失，卡面 pending 永挂） */
  status: 'pending' | 'active' | 'returned';
  message: string;
  createdAt: number;
  /** 审计4-L4：来源卡消息 id（赠送时与聊天卡消息同 id 生成，同 WxFamilyCardIn.msgId 口径）——
   *  聊天侧详情页改额度按它精确匹配单张卡；旧数据缺失时调用方退回 friendId 匹配 */
  msgId?: string;
}

export const LS_WALLET = 'wx-wallet';
export const LS_CARDS = 'wx-wallet-cards';
export const LS_BILLS = 'wx-change-bills';
const LS_LCQ = 'wx-lcq';
const LS_FC = 'wx-family-cards';
/** 零钱通七日年化收益率（易方达易理财货币A） */
const LCQ_RATE = 0.00913;

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    // 钱包数据已迁 IndexedDB kv store（内存同步读）；localStorage 仅作迁移前旧数据源
    const v = kvGet<T>(key);
    return v === null || v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    kvSet(key, value);
  } catch {
    // 持久化失败忽略
  }
}

function loadWallet(): { balance: number } {
  const w = loadJSON<{ balance?: number }>(LS_WALLET, {});
  return { balance: typeof w.balance === 'number' && w.balance >= 0 ? w.balance : 0 };
}

export function loadCards(): WxCard[] {
  const list = loadJSON<Partial<WxCard>[]>(LS_CARDS, []);
  if (!Array.isArray(list)) return [];
  return list.filter((c) => c && typeof c.tail === 'string').map((c) => ({
    id: typeof c.id === 'string' ? c.id : uid(),
    bank: typeof c.bank === 'string' ? c.bank : '储蓄卡',
    no: typeof c.no === 'string' ? c.no : '',
    tail: c.tail as string,
    holder: typeof c.holder === 'string' ? c.holder : '',
    balance: typeof c.balance === 'number' ? c.balance : 0,
    createdAt: typeof c.createdAt === 'number' ? c.createdAt : undefined,
  }));
}

function loadBills(): WxBill[] {
  const list = loadJSON<Partial<WxBill>[]>(LS_BILLS, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((b) => b && typeof b.kind === 'string' && typeof b.amount === 'number' && typeof b.time === 'number')
    .map((b) => ({
      id: typeof b.id === 'string' ? b.id : uid(),
      kind: b.kind as WxBill['kind'],
      amount: b.amount as number,
      time: b.time as number,
      peer: typeof b.peer === 'string' ? b.peer : undefined,
      avatar: typeof b.avatar === 'string' ? b.avatar : null,
      refunded: b.refunded === true,
    }));
}

function loadLcq(): WxLcq {
  const l = loadJSON<Partial<WxLcq>>(LS_LCQ, {});
  return {
    balance: typeof l.balance === 'number' && l.balance >= 0 ? l.balance : 0,
    totalEarn: typeof l.totalEarn === 'number' ? l.totalEarn : 0,
    yesterdayEarn: typeof l.yesterdayEarn === 'number' ? l.yesterdayEarn : 0,
    lastDate: typeof l.lastDate === 'string' ? l.lastDate : '',
  };
}

/** 我收到的亲属卡（AI 好友赠送，发红包/转账可用它支付——消费由赠卡人买单，不动我的零钱） */
export interface WxFamilyCardIn {
  id: string;
  /** 赠卡人联系人 ID（解除时同步把对应聊天卡片标记已退回；旧数据可能缺失） */
  friendId?: string;
  fromName: string;
  fromAvatar: string | null;
  relation: string;
  monthlyLimit: number;
  used: number;
  /** 本月额度已重置到的月份（'YYYY-MM' 本地时区；审计 #6 跨月惰性重置；旧数据缺失视为需重置） */
  lastResetMonth?: string;
  /** #22：来源卡消息 id（领取幂等去重键 + 解除时精确反查聊天卡片；旧数据缺失） */
  msgId?: string;
  createdAt: number;
}

const LS_FC_IN = 'wx-family-cards-in';

export function loadFamilyCardsIn(): WxFamilyCardIn[] {
  const list = loadJSON<Partial<WxFamilyCardIn>[]>(LS_FC_IN, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((f) => f && typeof f.fromName === 'string')
    .map((f) => ({
      id: typeof f.id === 'string' ? f.id : uid(),
      friendId: typeof f.friendId === 'string' ? f.friendId : undefined,
      fromName: f.fromName as string,
      fromAvatar: typeof f.fromAvatar === 'string' ? f.fromAvatar : null,
      relation: typeof f.relation === 'string' ? f.relation : '家人',
      monthlyLimit: typeof f.monthlyLimit === 'number' ? f.monthlyLimit : 0,
      used: typeof f.used === 'number' ? f.used : 0,
      lastResetMonth: typeof f.lastResetMonth === 'string' ? f.lastResetMonth : undefined,
      msgId: typeof f.msgId === 'string' ? f.msgId : undefined,
      createdAt: typeof f.createdAt === 'number' ? f.createdAt : Date.now(),
    }));
}

export function saveFamilyCardsIn(list: WxFamilyCardIn[]): void {
  saveJSON(LS_FC_IN, list);
}

/** 审计 #6：亲属卡「本月可用」跨月惰性重置——在所有读取可用额度的入口调用：
 *  lastResetMonth（'YYYY-MM' 本地时区）不等于当前月（旧数据缺失视为需重置）→ used=0、
 *  lastResetMonth=当前月并持久化写回；同月重复调用幂等（无写入）。返回规范后的列表供调用方直接使用 */
export function resetFamilyCardsInMonth(): WxFamilyCardIn[] {
  const list = loadFamilyCardsIn();
  const d = new Date();
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  let changed = false;
  const next = list.map((f) => {
    if (f.lastResetMonth === month) return f;
    changed = true;
    return { ...f, used: 0, lastResetMonth: month };
  });
  if (changed) saveFamilyCardsIn(next);
  return next;
}

// ---------------- 聊天消息联动（亲属卡赠送/接收 → 写入微信聊天消息流） ----------------

/** 与 wechat.tsx 的 lsMsgsKey 保持一致的消息存储 key 前缀 */
import { kvGet, kvSet } from '@/lib/ios/idb-kv';

const WX_LS_MSGS_PREFIX = 'wx-chat-msgs:';

/** 向指定联系人的微信聊天消息流末尾追加一条消息（跨模块写入：钱包赠送亲属卡 → 聊天卡片） */
export function appendWxChatMsg(contactId: string, msg: Record<string, unknown>): void {
  try {
    const key = WX_LS_MSGS_PREFIX + contactId;
    const parsed: unknown = kvGet<unknown[]>(key);
    // 审计4-L6：键不存在（该好友从未打开过聊天）→ 初始化空消息流放入本条消息再写回——
    // 此前静默 no-op，钱包赠送亲属卡给未开过聊天的好友时卡面 pending 悬空、AI 永不知情；
    // 键存在但非数组（脏数据）保持原防御静默 no-op，不覆盖
    if (parsed === null || parsed === undefined) {
      kvSet(key, [msg]);
      return;
    }
    if (!Array.isArray(parsed)) return;
    parsed.push(msg);
    kvSet(key, parsed); // 聊天记录不封顶（此前截 100 条会把旧记录挤丢）
  } catch {
    // 读写失败忽略
  }
}

export function loadFamilyCards(): WxFamilyCard[] {
  const list = loadJSON<Partial<WxFamilyCard>[]>(LS_FC, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((f) => f && typeof f.friendName === 'string')
    .map((f) => ({
      id: typeof f.id === 'string' ? f.id : uid(),
      friendId: typeof f.friendId === 'string' ? f.friendId : '',
      friendName: f.friendName as string,
      friendAvatar: typeof f.friendAvatar === 'string' ? f.friendAvatar : null,
      relation: typeof f.relation === 'string' ? f.relation : '其他亲人',
      monthlyLimit: typeof f.monthlyLimit === 'number' ? f.monthlyLimit : 0,
      used: typeof f.used === 'number' ? f.used : 0,
      status: f.status === 'active' ? 'active' : f.status === 'returned' ? 'returned' : 'pending',
      message: typeof f.message === 'string' ? f.message : '我为你准备了亲属卡，你消费我买单',
      createdAt: typeof f.createdAt === 'number' ? f.createdAt : Date.now(),
      msgId: typeof f.msgId === 'string' ? f.msgId : undefined,
    }));
}

export function saveFamilyCards(list: WxFamilyCard[]): void {
  saveJSON(LS_FC, list);
}

// ---------------- 亲属卡消费感知（账本流水 + 赠卡人记忆） ----------------

import { memAddEventFragment } from '@/lib/memory';

/** wxExecutePayment 亲属卡扣款明细中的一张卡（分摊时多张） */
export interface WxFcPayPart {
  /** 来源卡 id（WxFamilyCardIn.id） */
  cardInId: string;
  /** 赠卡人联系人 id（旧数据可能缺失） */
  giverId: string | null;
  /** 赠卡人展示名 */
  giverName: string;
  /** 本卡分摊金额（两位小数） */
  amount: number;
}

/** wxExecutePayment 成功结果：fc 存在 = 本次用了亲属卡（消费感知依据） */
export interface WxFcPayResult {
  ok: true;
  /** 亲属卡扣款明细；零钱/银行卡支付时省略 */
  fc?: { total: number; parts: WxFcPayPart[] };
}

/** 亲属卡消费流水（kv 'wx-family-ledger'，IndexedDB 持久化，重启后仍在；上限 300 条，新的在前） */
export interface WxFcLedgerRec {
  id: string;
  ts: number;
  amount: number;
  /** 消费场景：'红包' | '转账' | '亲属卡付款' */
  scene: '红包' | '转账' | '亲属卡付款';
  /** 花在哪（发给「小雪」的红包 / 转给「小雪」的转账 / 在「肯德基」的消费） */
  where: string;
  /** 备注（祝福语 / 转账留言 / 付款备注；无则省略） */
  note?: string;
  /** 首张扣款卡的赠卡人（多卡分摊时取第一张） */
  giverId?: string;
  giverName: string;
  /** 首张扣款卡 id */
  cardInId?: string;
}

const LS_FC_LEDGER = 'wx-family-ledger';

export function loadFcLedger(): WxFcLedgerRec[] {
  const list = loadJSON<Partial<WxFcLedgerRec>[]>(LS_FC_LEDGER, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((r) => r && typeof r.ts === 'number' && typeof r.amount === 'number')
    .map((r) => ({
      id: typeof r.id === 'string' ? r.id : uid(),
      ts: r.ts as number,
      amount: r.amount as number,
      scene: r.scene === '转账' || r.scene === '亲属卡付款' ? r.scene : '红包',
      where: typeof r.where === 'string' ? r.where : '',
      note: typeof r.note === 'string' ? r.note : undefined,
      giverId: typeof r.giverId === 'string' ? r.giverId : undefined,
      giverName: typeof r.giverName === 'string' ? r.giverName : '亲属卡',
      cardInId: typeof r.cardInId === 'string' ? r.cardInId : undefined,
    }));
}

/** 追加一条消费流水（新的在前；超容量丢弃最旧） */
export function addFcLedgerRec(rec: Omit<WxFcLedgerRec, 'id'>): void {
  const list = loadFcLedger();
  list.unshift({ ...rec, id: uid() });
  saveJSON(LS_FC_LEDGER, list.slice(0, 300));
}

function fmtFcWhen(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

/**
 * 亲属卡消费感知（需求三件套中的两件：账本流水 + 赠卡人记忆碎片；聊天内系统通知行由调用方按端插入）：
 * - 每次亲属卡扣款成功落一条流水（金额/场景/花在哪/时间/赠卡人），持久化，重启后仍在；
 * - 按赠卡人聚合金额各写一条记忆碎片（归属句式：「机主…用你（AI角色本人）送的亲属卡支付了…」），
 *   AI 下一轮聊天经记忆召回感知「用户花钱了」，按人设反应或沉默——本函数绝不触发 AI 回合（不跟发消息）；
 * - giverId 缺失（旧卡数据）只记账不写记忆。
 */
export function recordFcSpend(opts: {
  total: number;
  scene: WxFcLedgerRec['scene'];
  /** 花在哪短语，如 发给「小雪」的红包 / 转给「小雪」的转账 / 在「肯德基」的消费 */
  where: string;
  /** 原始备注（祝福语/留言），流水展示用 */
  note?: string;
  parts: WxFcPayPart[];
  /** 机主真实名字（记忆句式用；空则跳过记忆只记账） */
  ownerName: string;
  /** 消费渠道（记忆句式「在{channel}里」用；缺省 '微信'，美团App 传 '美团'——AI 记住的是在哪花的钱） */
  channel?: string;
}): void {
  const ts = Date.now();
  const first = opts.parts[0];
  addFcLedgerRec({
    ts,
    amount: Math.round(opts.total * 100) / 100,
    scene: opts.scene,
    where: opts.where,
    note: opts.note?.trim() ? opts.note.trim() : undefined,
    giverId: first?.giverId ?? undefined,
    giverName: first?.giverName ?? '亲属卡',
    cardInId: first?.cardInId ?? undefined,
  });
  const owner = opts.ownerName.trim();
  if (!owner) return;
  const byGiver = new Map<string, { giverId: string | null; name: string; amount: number }>();
  for (const p of opts.parts) {
    const k = p.giverId ?? `name:${p.giverName}`;
    const cur = byGiver.get(k);
    if (cur) cur.amount = Math.round((cur.amount + p.amount) * 100) / 100;
    else byGiver.set(k, { giverId: p.giverId, name: p.giverName, amount: p.amount });
  }
  const note = opts.note?.trim();
  for (const g of byGiver.values()) {
    if (!g.giverId) continue;
    const text = `机主「${owner}」于${fmtFcWhen(ts)}在${opts.channel ?? '微信'}里用你（AI角色本人）送的亲属卡支付了${opts.where}，金额¥${fmtMoney(g.amount)}${note ? `（备注「${note}」）` : ''}。`;
    try {
      // sourceTag 'fc-spend'：同模板的不同消费事件互不相似合并（每笔消费都是独立记忆）
      memAddEventFragment(g.giverId, 'wx', text, { eventTime: ts, sourceTag: 'fc-spend' });
    } catch {
      /* 记忆写入失败不阻塞支付主流程 */
    }
  }
}

// ---------------- 日期工具（零钱通每日收益结算） ----------------

function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function parseDayKey(k: string): number {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getTime();
}

function addDaysKey(k: string, n: number): string {
  const t = parseDayKey(k) + n * 86400000;
  return dayKeyOf(new Date(t));
}

/** 最早一笔「转入零钱通」账单的日期（收益从此日起算） */
function earliestBuyDay(bills: WxBill[]): string | null {
  let min: number | null = null;
  for (const b of bills) {
    if (b.kind !== '转入零钱通') continue;
    if (min === null || b.time < min) min = b.time;
  }
  return min === null ? null : dayKeyOf(new Date(min));
}

/** 零钱通收益每日结算：按当前余额 × 七日年化 ÷ 365，同日幂等，今天不计息 */
function settleLcq(base: WxLcq, earliestBuy: string | null): WxLcq {
  const today = dayKeyOf(new Date());
  if (base.lastDate === today) return base;
  let start: string;
  if (base.lastDate) start = addDaysKey(base.lastDate, 1);
  else if (earliestBuy) start = earliestBuy;
  else return { ...base, lastDate: today, yesterdayEarn: 0 };
  let total = base.totalEarn;
  let yesterday = 0;
  let d = start;
  let guard = 0;
  while (parseDayKey(d) < parseDayKey(today) && guard < 400) {
    const earn = Math.round(((base.balance * LCQ_RATE) / 365) * 100) / 100;
    total += earn;
    yesterday = earn;
    d = addDaysKey(d, 1);
    guard += 1;
  }
  return {
    balance: base.balance,
    totalEarn: Math.round(total * 100) / 100,
    yesterdayEarn: yesterday,
    lastDate: today,
  };
}

// ---------------- 金额键盘输入 ----------------

export function pushAmount(cur: string, key: string): string {
  if (key === 'del') return cur.slice(0, -1);
  if (key === '.') return cur.includes('.') ? cur : `${cur === '' ? '0' : cur}.`;
  const [int, dec] = cur.split('.');
  if (dec !== undefined) {
    if (dec.length >= 2) return cur;
    return cur + key;
  }
  if (cur === '0') return key;
  if (int.length >= 6) return cur;
  return cur + key;
}

export function fmtMoney(n: number): string {
  return n.toFixed(2);
}

export function fmtBillTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------------- 通用小组件 ----------------

const BANK_COLORS: Record<string, [string, string]> = {
  工商银行: ['#B3000C', '#E2483F'],
  建设银行: ['#0B62C1', '#3E8EDE'],
  农业银行: ['#008C4A', '#35B478'],
  中国银行: ['#8E0722', '#C43A52'],
  招商银行: ['#D03A2B', '#E8604F'],
  交通银行: ['#073C8C', '#3C6FC4'],
  邮储银行: ['#007A3D', '#37A468'],
};

/** 各银行发卡 BIN 前缀（生成卡号用） */
const BANK_BINS: Record<string, string> = {
  工商银行: '622202',
  建设银行: '621700',
  农业银行: '622848',
  中国银行: '621785',
  招商银行: '622588',
  交通银行: '622260',
  邮储银行: '621758',
};

/** 生成 16 位 Luhn 校验合法的银行卡号（BIN 前缀 + 随机数 + 校验位） */
function genCardNo(bank: string): string {
  let no = BANK_BINS[bank] ?? '622848';
  while (no.length < 15) no += String(Math.floor(Math.random() * 10));
  let sum = 0;
  const rev = no.split('').reverse();
  for (let i = 0; i < rev.length; i++) {
    let d = Number(rev[i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return no + String((10 - (sum % 10)) % 10);
}

/** 卡号展示：4 位一组空格分组；无完整卡号的旧数据兜底为 ****尾号（与 QQ 钱包 formatCardNo 同款） */
function formatWxCardNo(no: string, tail: string): string {
  const src = /^\d{15,19}$/.test(no) ? no : `****${tail}`;
  return src.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** 银行渐变圆标（取银行名首字；支付方式弹层等外部复用） */
export function BankDot({ bank, size = 38 }: { bank: string; size?: number }) {
  const [c1, c2] = BANK_COLORS[bank] ?? ['#5A6068', '#878E96'];
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${c1}, ${c2})`, fontSize: Math.round(size * 0.42) }}
    >
      {bank.charAt(0)}
    </span>
  );
}

/** 方形圆角头像（微信风格，与主文件 WxAvatar 同款） */
function MiniAvatar({ src, alt, size = 40 }: { src: string | null; alt: string; size?: number }) {
  const radius = Math.max(4, Math.round(size * 0.11));
  const style = { width: size, height: size, borderRadius: radius };
  if (src) return <img src={src} alt={alt} className="shrink-0 bg-muted object-cover" style={style} />;
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center bg-[#C9C9CE] text-white dark:bg-[#3C3C42]"
      style={style}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: size * 0.6, height: size * 0.6 }}>
        <circle cx="12" cy="8.2" r="4.3" />
        <path d="M12 14.1c-4.7 0-8.1 2.7-8.1 6.3 0 .9.7 1.6 1.6 1.6h13c.9 0 1.6-.7 1.6-1.6 0-3.6-3.4-6.3-8.1-6.3z" />
      </svg>
    </div>
  );
}

/** 顶部导航：返回 + 居中标题 + 右上角动作 */
function WxNav({
  title,
  onBack,
  right,
  light = false,
  testId,
}: {
  title?: string;
  onBack: () => void;
  right?: React.ReactNode;
  light?: boolean;
  testId?: string;
}) {
  return (
    <div className={`shrink-0 pt-[54px] ${light ? 'text-white' : 'text-black dark:text-white'}`}>
      <div className="relative flex h-11 items-center px-2">
        <button type="button" aria-label="返回" data-testid={testId} onClick={onBack} className="active:opacity-50">
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        {title !== undefined && <div className="flex-1 pr-8 text-center text-[17px] font-medium">{title}</div>}
        {right && <div className="absolute right-4 top-0 flex h-11 items-center">{right}</div>}
      </div>
    </div>
  );
}

/** 「···」更多 */
function MoreDots() {
  return (
    <span aria-hidden="true" className="flex items-center gap-[3px]">
      <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
      <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
      <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
    </span>
  );
}

/** 自绘数字键盘（微信亲属卡/金额弹层同款：3 列数字 + 右列删除 + 竖跨确认键；红包页用红色确认键） */
export function NumPad({
  onKey,
  onSubmit,
  submitLabel,
  submitTestId,
  submitColor = 'green',
}: {
  onKey: (k: string) => void;
  onSubmit: () => void;
  submitLabel: string;
  submitTestId?: string;
  submitColor?: 'green' | 'red';
}) {
  const keyBtn =
    'flex h-[52px] items-center justify-center rounded-[8px] bg-white text-[22px] text-black active:bg-black/10 dark:bg-[#2C2C30] dark:text-white dark:active:bg-white/10';
  const submitBg = submitColor === 'red' ? 'bg-[#F04A3A]' : 'bg-[#07C160]';
  return (
    <div className="grid shrink-0 grid-cols-4 gap-[6px] bg-[#E9E9E9] p-[6px] pb-[max(6px,env(safe-area-inset-bottom))] dark:bg-[#161616]">
      {['1', '2', '3'].map((k) => (
        <button key={k} type="button" data-testid={`wx-pad-${k}`} onClick={() => onKey(k)} className={keyBtn}>
          {k}
        </button>
      ))}
      <button
        type="button"
        aria-label="删除"
        data-testid="wx-pad-del"
        onClick={() => onKey('del')}
        className="flex h-[52px] items-center justify-center rounded-[8px] bg-white text-black/70 active:bg-black/10 dark:bg-[#2C2C30] dark:text-white/70 dark:active:bg-white/10"
      >
        <Delete className="h-6 w-6" strokeWidth={1.7} />
      </button>
      {['4', '5', '6'].map((k) => (
        <button key={k} type="button" data-testid={`wx-pad-${k}`} onClick={() => onKey(k)} className={keyBtn}>
          {k}
        </button>
      ))}
      <button
        type="button"
        data-testid={submitTestId ?? 'wx-pad-submit'}
        onClick={onSubmit}
        className={`row-span-3 rounded-[8px] text-[17px] font-medium text-white active:brightness-95 ${submitBg}`}
      >
        {submitLabel}
      </button>
      {['7', '8', '9'].map((k) => (
        <button key={k} type="button" data-testid={`wx-pad-${k}`} onClick={() => onKey(k)} className={keyBtn}>
          {k}
        </button>
      ))}
      <button type="button" data-testid="wx-pad-0" onClick={() => onKey('0')} className={keyBtn}>
        0
      </button>
      <button type="button" data-testid="wx-pad-dot" onClick={() => onKey('.')} className={keyBtn}>
        .
      </button>
      <div aria-hidden="true" />
    </div>
  );
}

/** 底部金额弹层：标题 +（可选自定义行）+ 金额大字 + 数字键盘 */
function AmountPadSheet({
  title,
  note,
  submitLabel,
  submitTestId,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  note?: string;
  submitLabel: string;
  submitTestId?: string;
  onSubmit: (amount: number) => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const [val, setVal] = useState('');
  const num = parseFloat(val || '0');
  const ok = num > 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" data-testid="wx-amount-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] dark:bg-[#1E1E1E]">
        <div className="relative flex h-14 items-center justify-center border-b border-black/5 dark:border-white/10">
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="absolute left-3 flex h-9 w-9 items-center justify-center text-black/60 active:opacity-60 dark:text-white/60"
          >
            <X className="h-6 w-6" strokeWidth={1.8} />
          </button>
          <div className="text-[16px] font-medium text-black dark:text-white">{title}</div>
        </div>
        {children}
        <div className="py-5 text-center" data-testid="wx-amount-value">
          <div className="text-[34px] font-semibold text-black dark:text-white">¥ {val || '0.00'}</div>
          {note && <div className="mt-1 text-[12px] text-black/40 dark:text-white/40">{note}</div>}
        </div>
        <NumPad
          onKey={(k) => setVal((v) => pushAmount(v, k))}
          onSubmit={() => ok && onSubmit(num)}
          submitLabel={submitLabel}
          submitTestId={submitTestId}
        />
      </div>
    </div>
  );
}

/** 底部操作菜单（ActionSheet） */
function ActionSheet({
  actions,
  onClose,
}: {
  actions: Array<{ label: string; danger?: boolean; onClick: () => void }>;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="取消" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative mx-3 mb-6 overflow-hidden rounded-[12px] bg-[#F7F7F7] pb-[max(0px,env(safe-area-inset-bottom))] dark:bg-[#242424]">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.onClick}
            className={`w-full border-b border-black/5 py-[15px] text-center text-[17px] active:bg-black/5 dark:border-white/10 dark:active:bg-white/10 ${
              a.danger ? 'text-[#FA5151]' : 'text-black dark:text-white'
            }`}
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full bg-white py-[15px] text-center text-[17px] text-black active:bg-black/5 dark:bg-[#1A1A1A] dark:text-white dark:active:bg-white/10"
        >
          取消
        </button>
      </div>
    </div>
  );
}

// ---------------- 服务主页（微信官方版式：绿色收付款|钱包大块 + 分类白卡） ----------------

function ServicesHome({
  balance,
  onExit,
  onOpen,
  onToast,
}: {
  balance: number;
  onExit: () => void;
  onOpen: (v: 'wallet' | 'lcq' | 'cards') => void;
  onToast: (m: string) => void;
}) {
  const tile = (label: string, color: string, icon: React.ReactNode, onClick: () => void, testId?: string) => (
    <button
      key={label}
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex flex-col items-center gap-[7px] py-[13px] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
    >
      <span className="flex h-[30px] w-[30px] items-center justify-center" style={{ color }} aria-hidden="true">
        {icon}
      </span>
      <span className="text-[12px] leading-none text-black/85 dark:text-white/85">{label}</span>
    </button>
  );
  const section = (title: string, cols: 3 | 4, children: React.ReactNode) => (
    <div className="mt-3 overflow-hidden rounded-[12px] bg-white px-1 pb-1.5 pt-3 dark:bg-[#1A1A1A]">
      <p className="mb-0.5 px-3 text-[14px] text-black/45 dark:text-white/45">{title}</p>
      <div className={cols === 3 ? 'grid grid-cols-3' : 'grid grid-cols-4'}>{children}</div>
    </div>
  );
  return (
    <div className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-services-home">
      <WxNav
        title="服务"
        onBack={onExit}
        testId="wx-services-back"
        right={
          <button type="button" aria-label="更多" onClick={() => onToast('更多功能暂未开放')}>
            <MoreDots />
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        {/* 收付款 | 钱包（绿色渐变整块） */}
        <div className="grid grid-cols-2 overflow-hidden rounded-[12px] bg-gradient-to-br from-[#0BC268] to-[#069A4E] shadow-sm">
          <button
            type="button"
            data-testid="wx-services-pay"
            onClick={() => onToast('收付款暂未开放')}
            className="flex flex-col items-center justify-center gap-2 py-[26px] active:bg-white/10"
          >
            <ScanLine className="h-[34px] w-[34px] text-white" strokeWidth={1.5} />
            <span className="text-[16px] font-medium text-white">收付款</span>
          </button>
          <button
            type="button"
            data-testid="wx-services-wallet"
            onClick={() => onOpen('wallet')}
            className="flex flex-col items-center justify-center gap-2 py-[26px] active:bg-white/10"
          >
            <WalletIcon className="h-[34px] w-[34px] text-white" strokeWidth={1.5} />
            <span className="text-[16px] font-medium text-white">钱包</span>
            <span className="-mt-1.5 text-[13px] text-white/75" data-testid="wx-services-balance">
              ¥{fmtMoney(balance)}
            </span>
          </button>
        </div>

        {/* 金融理财 */}
        {section(
          '金融理财',
          3,
          <>
            {tile('信用卡还款', '#07C160', <CreditCard className="h-[25px] w-[25px]" strokeWidth={1.7} />, () => onToast('信用卡还款暂未开放'))}
            {tile('理财通', '#4D9CF8', <TrendingUp className="h-[25px] w-[25px]" strokeWidth={1.7} />, () => onToast('理财通暂未开放'))}
            {tile('保险服务', '#ED6C4E', <Umbrella className="h-[25px] w-[25px]" strokeWidth={1.7} />, () => onToast('保险服务暂未开放'))}
          </>
        )}

        {/* 生活服务 */}
        {section(
          '生活服务',
          4,
          <>
            {tile('手机充值', '#4D9CF8', <Smartphone className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('手机充值暂未开放'))}
            {tile('生活缴费', '#07C160', <CircleCheck className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('生活缴费暂未开放'))}
            {tile('Q币充值', '#4D9CF8', <Gamepad2 className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('Q币充值暂未开放'))}
            {tile('城市服务', '#07C160', <Building2 className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('城市服务暂未开放'))}
            {tile('腾讯公益', '#FA5151', <Flower2 className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('腾讯公益暂未开放'))}
            {tile('医疗健康', '#ED6C4E', <HeartPulse className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('医疗健康暂未开放'))}
          </>
        )}

        {/* 交通出行 */}
        {section(
          '交通出行',
          4,
          <>
            {tile('出行服务', '#4D9CF8', <Navigation className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('出行服务暂未开放'))}
            {tile('火车票机票', '#07C160', <TrainFront className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('火车票机票暂未开放'))}
            {tile('滴滴出行', '#F7A500', <CarTaxiFront className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('滴滴出行暂未开放'))}
            {tile('酒店民宿', '#07C160', <BedDouble className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('酒店民宿暂未开放'))}
          </>
        )}

        {/* 购物消费 */}
        {section(
          '购物消费',
          4,
          <>
            {tile('京东购物', '#ED6C4E', <ShoppingBag className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('京东购物暂未开放'))}
            {tile('拼多多', '#FA5151', <ShoppingBasket className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('拼多多暂未开放'))}
            {tile('美团外卖', '#F7A500', <Utensils className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('美团外卖暂未开放'))}
            {tile('饿了么', '#4D9CF8', <UtensilsCrossed className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('饿了么暂未开放'))}
          </>
        )}

        <p className="mt-7 text-center text-[12px] text-black/35 dark:text-white/35">微信支付 · 本服务由财付通提供</p>
      </div>
    </div>
  );
}

// ---------------- 钱包页 ----------------

function WalletPage({
  balance,
  cards,
  familyCards,
  familyInCount,
  onBack,
  onOpen,
  onToast,
}: {
  balance: number;
  cards: WxCard[];
  familyCards: WxFamilyCard[];
  /** 我收到的亲属卡张数（收到的卡也直接进管理页，无需先赠送） */
  familyInCount: number;
  onBack: () => void;
  onOpen: (v: 'change' | 'lcq' | 'cards' | 'fcIntro' | 'fcManage' | 'paySettings' | 'bill') => void;
  onToast: (m: string) => void;
}) {
  const row = (
    label: string,
    icon: React.ReactNode,
    right: React.ReactNode,
    onClick: () => void,
    testId: string,
    first = false
  ) => (
    <button
      key={label}
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="relative flex w-full items-center gap-3 px-4 py-[15px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
    >
      {!first && <span className="absolute left-[62px] right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />}
      {icon}
      <span className="min-w-0 flex-1 truncate text-[16px]">{label}</span>
      <span className="text-[14px] text-black/45 dark:text-white/45">{right}</span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
    </button>
  );
  return (
    <div className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-wallet-page">
      <WxNav
        title="钱包"
        onBack={onBack}
        testId="wx-wallet-back"
        right={
          <button type="button" data-testid="wx-wallet-bill-link" onClick={() => onOpen('bill')} className="text-[15px] active:opacity-50">
            账单
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        <div className="overflow-hidden rounded-[12px] bg-white dark:bg-[#1A1A1A]">
          {row(
            '零钱',
            <WxIcChange />,
            `¥${fmtMoney(balance)}`,
            () => onOpen('change'),
            'wx-wallet-change',
            true
          )}
          {row(
            '零钱通',
            <WxIcFund />,
            <span className="text-[#F7A500]">收益率{(LCQ_RATE * 100).toFixed(4)}%</span>,
            () => onOpen('lcq'),
            'wx-wallet-lcq'
          )}
          {row(
            '银行卡',
            <WxIcBankCard />,
            cards.length > 0 ? `${cards.length}张` : '添加',
            () => onOpen('cards'),
            'wx-wallet-cards'
          )}
          {row(
            '亲属卡',
            <WxIcFamilyCard />,
            familyCards.length + familyInCount > 0 ? `${familyCards.length + familyInCount}张` : '未开通',
            () => onOpen(familyCards.length + familyInCount > 0 ? 'fcManage' : 'fcIntro'),
            'wx-wallet-fc'
          )}
          {row(
            '支付设置',
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center" aria-hidden="true">
              <ShieldCheck className="h-[24px] w-[24px] text-[#6F7B8C]" strokeWidth={1.8} />
            </span>,
            wxLoadPayPwd().enabled && wxLoadPayPwd().pwd ? '已开启' : '未开启',
            () => onOpen('paySettings'),
            'wx-wallet-payset'
          )}
        </div>
        <p className="mt-10 text-center text-[12px] text-black/35 dark:text-white/35">本服务由财付通提供</p>
      </div>
    </div>
  );
}

// ---------------- 零钱页 ----------------

function ChangePage({
  balance,
  onBack,
  onOpenDetail,
  onRecharge,
  onWithdraw,
  onToast,
}: {
  balance: number;
  onBack: () => void;
  onOpenDetail: () => void;
  onRecharge: () => void;
  onWithdraw: () => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="relative flex h-full w-full flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-change-page">
      <WxNav
        onBack={onBack}
        testId="wx-change-back"
        right={
          <button type="button" data-testid="wx-change-detail-link" onClick={onOpenDetail} className="text-[15px] active:opacity-50">
            零钱明细
          </button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto pt-[7vh]">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#F7B500] text-[30px] font-semibold text-white" aria-hidden="true">
          ¥
        </span>
        <p className="mt-8 text-[16px]">我的零钱</p>
        <p className="mt-3 font-semibold" data-testid="wx-change-balance">
          <span className="text-[24px]">¥</span>
          <span className="ml-1 text-[42px]">{fmtMoney(balance)}</span>
        </p>
        <button type="button" onClick={() => onToast('请在零钱通页转入')} className="mt-5 flex items-center gap-0.5 text-[15px] text-[#FA9D3B] active:opacity-60">
          转入零钱通，能赚又能花
          <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>
      <div className="shrink-0 px-[22%] pb-2">
        <button
          type="button"
          data-testid="wx-change-recharge"
          onClick={onRecharge}
          className="h-12 w-full rounded-[8px] bg-[#07C160] text-[17px] font-medium text-white active:brightness-95"
        >
          充值
        </button>
        <button
          type="button"
          data-testid="wx-change-withdraw"
          onClick={onWithdraw}
          className="mt-4 h-12 w-full rounded-[8px] bg-[#F2F2F2] text-[17px] text-black active:bg-black/5 dark:bg-[#2A2A2A] dark:text-white dark:active:bg-white/10"
        >
          提现
        </button>
      </div>
      <div className="shrink-0 pb-7 pt-5 text-center">
        <button type="button" onClick={() => onToast('常见问题暂未开放')} className="text-[14px] text-[#576B95] active:opacity-60">
          常见问题
        </button>
        <p className="mt-2 text-[12px] text-black/30 dark:text-white/30">本服务由财付通提供</p>
      </div>
    </div>
  );
}

// ---------------- 零钱明细页 ----------------

function BillIcon({ kind }: { kind: WxBill['kind'] }) {
  const map: Record<WxBill['kind'], [string, React.ReactNode]> = {
    充值: ['#07C160', <Plus key="i" className="h-4 w-4" strokeWidth={2.2} />],
    提现: ['#4D9CF8', <WalletIcon key="i" className="h-4 w-4" strokeWidth={2.2} />],
    转入零钱通: ['#F7A500', <Gem key="i" className="h-4 w-4" strokeWidth={2.2} />],
    零钱通转出: ['#8E8E93', <Gem key="i" className="h-4 w-4" strokeWidth={2.2} />],
    红包: ['#F04A3A', <Heart key="i" className="h-4 w-4" strokeWidth={2.2} />],
    红包退款: ['#F04A3A', <Heart key="i" className="h-4 w-4" strokeWidth={2.2} />],
    转账: ['#F5A63C', <ArrowLeftRight key="i" className="h-4 w-4" strokeWidth={2.2} />],
    转账退款: ['#F5A63C', <ArrowLeftRight key="i" className="h-4 w-4" strokeWidth={2.2} />],
    亲属卡付款: ['#F5A63C', <ArrowLeftRight key="i" className="h-4 w-4" strokeWidth={2.2} />],
    美团外卖: ['#FFB800', <ShoppingBag key="i" className="h-4 w-4" strokeWidth={2.2} />],
    淘宝购物: ['#FF5F00', <ShoppingBag key="i" className="h-4 w-4" strokeWidth={2.2} />],
  };
  // 兑底：未知 kind 不崩溃（同 WxBillEntryIcon）
  const [color, icon] = map[kind] ?? ['#8E8E93', <WalletIcon key="i" className="h-4 w-4" strokeWidth={2.2} />];
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${color}1A`, color }} aria-hidden="true">
      {icon}
    </span>
  );
}

function ChangeDetailPage({ bills, onBack }: { bills: WxBill[]; onBack: () => void }) {
  return (
    <div className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-change-detail-page">
      <WxNav title="零钱明细" onBack={onBack} testId="wx-change-detail-back" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        {bills.length === 0 ? (
          <p className="pt-24 text-center text-[14px] text-black/35 dark:text-white/35">暂无零钱明细</p>
        ) : (
          <div className="overflow-hidden rounded-[12px] bg-white dark:bg-[#1A1A1A]">
            {bills.map((b, i) => (
              <div
                key={b.id}
                data-testid="wx-change-bill-item"
                className={`relative flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.06]' : ''}`}
              >
                <BillIcon kind={b.kind} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15.5px]">{b.kind}</p>
                  <p className="mt-0.5 text-[12px] text-black/40 dark:text-white/40">{fmtBillTime(b.time)}</p>
                </div>
                <p className="text-[16px] font-medium">
                  {b.amount >= 0 ? '+' : '-'}
                  {fmtMoney(Math.abs(b.amount))}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- 账单页（钱包页右上角「账单」：筛选行 + 月份汇总 + 平铺列表 + 选择筛选项弹层） ----------------

/** 红包封套小图标（圆底白色红包封，微信/QQ 账单红包条目统一用） */
export function RedPacketGlyph({ size = 20, bg = '#FA5151', fg = '#F26D3D' }: { size?: number; bg?: string; fg?: string }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, backgroundColor: bg }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" style={{ width: size * 0.62, height: size * 0.62 }}>
        <rect x="4.5" y="3" width="15" height="18" rx="2.4" fill="#fff" />
        <path d="M4.5 7.2c4.4 3.6 10.6 3.6 15 0" stroke={fg} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <circle cx="12" cy="11.6" r="1.8" fill={fg} />
      </svg>
    </span>
  );
}

/** 账单条目展示标题（对齐真机：「微信红包-发给X」「转账-转给X」「转账-退款」…） */
function wxBillDisplayTitle(b: WxBill): string {
  const peer = b.peer || '对方';
  switch (b.kind) {
    case '红包':
      return b.amount >= 0 ? `微信红包-来自${peer}` : `微信红包-发给${peer}`;
    case '红包退款':
      return '微信红包-退款';
    case '转账':
      return b.amount >= 0 ? `转账-来自${peer}` : `转账-转给${peer}`;
    case '转账退款':
      return '转账-退款';
    case '亲属卡付款':
      return `亲属卡-付款给${peer}`;
    case '美团外卖':
      return b.amount >= 0 ? '美团外卖-退款' : `美团外卖-${peer}`;
    case '淘宝购物':
      return b.amount >= 0 ? '淘宝网-退款' : '淘宝网-商品消费';
    default:
      return b.kind;
  }
}

/** 账单时间（对齐真机「9月27日 07:34」补零格式） */
function wxBillWhen(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 月份键（'2026-8'）与文案（'2026年9月'）互转 */
const billMonthKey = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}`;
};
const billMonthLabel = (key: string): string => {
  const [y, m] = key.split('-');
  return `${y}年${Number(m) + 1}月`;
};

/** 账单条目左侧圆形图标：红包=橙红红包封；转账=对方头像；其余沿用零钱明细色板 */
function WxBillEntryIcon({ b }: { b: WxBill }) {
  if (b.kind === '红包' || b.kind === '红包退款') return <RedPacketGlyph size={40} bg="#F26D3D" fg="#F26D3D" />;
  if ((b.kind === '转账' || b.kind === '转账退款') && b.avatar) return <MiniAvatar src={b.avatar} alt={b.peer || '对方'} size={40} />;
  const map: Record<WxBill['kind'], [string, React.ReactNode]> = {
    充值: ['#07C160', <Plus key="i" className="h-[18px] w-[18px]" strokeWidth={2.2} />],
    提现: ['#4D9CF8', <WalletIcon key="i" className="h-[18px] w-[18px]" strokeWidth={2.2} />],
    转入零钱通: ['#F7A500', <Gem key="i" className="h-[18px] w-[18px]" strokeWidth={2.2} />],
    零钱通转出: ['#8E8E93', <Gem key="i" className="h-[18px] w-[18px]" strokeWidth={2.2} />],
    红包: ['#F26D3D', <RedPacketGlyph key="i" size={36} bg="transparent" fg="#F26D3D" />],
    红包退款: ['#F26D3D', <RedPacketGlyph key="i" size={36} bg="transparent" fg="#F26D3D" />],
    转账: ['#4D9CF8', <ArrowLeftRight key="i" className="h-[18px] w-[18px]" strokeWidth={2.2} />],
    转账退款: ['#4D9CF8', <ArrowLeftRight key="i" className="h-[18px] w-[18px]" strokeWidth={2.2} />],
    亲属卡付款: ['#F7A500', <Heart key="i" className="h-[18px] w-[18px]" strokeWidth={2.2} />],
    美团外卖: ['#FFB800', <ShoppingBag key="i" className="h-[18px] w-[18px]" strokeWidth={2.2} />],
    淘宝购物: ['#FF5F00', <ShoppingBag key="i" className="h-[18px] w-[18px]" strokeWidth={2.2} />],
  };
  // 兜底：未知 kind（旧数据/跨版本新 kind 未同步映射）不再解构 undefined 崩账单页，回退灰色钱包图标
  const [color, icon] = map[b.kind] ?? ['#8E8E93', <WalletIcon key="i" className="h-[18px] w-[18px]" strokeWidth={2.2} />];
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: `${color}1A`, color }}
      aria-hidden="true"
    >
      {icon}
    </span>
  );
}

/** 选择筛选项底部弹层（收支类型 + 交易类型 + 取消/确定） */
type BillIOFilter = '全部' | '支出' | '收入';
type BillSceneFilter = '全部' | '红包' | '转账' | '群收款' | '二维码收付款' | '商户消费' | '充值提现' | '信用卡还款' | '有退款';
const BILL_SCENES: BillSceneFilter[] = ['全部', '红包', '转账', '群收款', '二维码收付款', '商户消费', '充值提现', '信用卡还款', '有退款'];

function FilterChip({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`grid h-[50px] place-items-center rounded-[6px] text-[16px] ${
        on ? 'bg-[#E8F8EE] text-[#07C160] dark:bg-[#0E3A20]' : 'bg-[#F7F7F7] text-black dark:bg-[#2A2A2A] dark:text-white'
      }`}
    >
      {label}
    </span>
  );
}

function WxBillFilterSheet({
  io,
  scene,
  onClose,
  onApply,
}: {
  io: BillIOFilter;
  scene: BillSceneFilter;
  onClose: () => void;
  onApply: (io: BillIOFilter, scene: BillSceneFilter) => void;
}) {
  const [dIo, setDIo] = useState<BillIOFilter>(io);
  const [dScene, setDScene] = useState<BillSceneFilter>(scene);
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label="选择筛选项" onClick={onClose}>
      <div className="rounded-t-[14px] bg-[#EDEDED] px-5 pb-6 pt-6 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()} data-testid="wx-bill-filter-sheet">
        <p className="text-[20px] font-medium">选择筛选项</p>
        <p className="mt-6 text-[13px] text-black/45 dark:text-white/45">收支类型</p>
        <div className="mt-2 grid grid-cols-3 gap-3">
          {(['全部', '支出', '收入'] as BillIOFilter[]).map((x) => (
            <button key={x} type="button" onClick={() => setDIo(x)}>
              <FilterChip label={x} on={dIo === x} />
            </button>
          ))}
        </div>
        <p className="mt-5 text-[13px] text-black/45 dark:text-white/45">交易类型</p>
        <div className="mt-2 grid grid-cols-3 gap-3">
          {BILL_SCENES.map((x) => (
            <button key={x} type="button" onClick={() => setDScene(x)}>
              <FilterChip label={x} on={dScene === x} />
            </button>
          ))}
        </div>
        <div className="mt-8 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-[50px] flex-1 rounded-[6px] bg-white text-[16px] dark:bg-[#2A2A2A]"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="wx-bill-filter-ok"
            onClick={() => onApply(dIo, dScene)}
            className="h-[50px] flex-1 rounded-[6px] bg-[#07C160] text-[16px] font-medium text-white active:brightness-95"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

/** 月份/年份选择底部弹层（账单页月份切换、收支统计口径切换共用样式） */
function WxBillMonthSheet({
  title,
  options,
  selected,
  onPick,
  onClose,
}: {
  title: string;
  options: string[];
  selected: string;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label={title} onClick={onClose}>
      <div className="max-h-[60%] overflow-y-auto rounded-t-[14px] bg-[#EDEDED] px-3 pb-8 pt-4 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()}>
        <p className="px-2 pb-2 text-center text-[16px] font-medium">{title}</p>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => {
              onPick(opt);
              onClose();
            }}
            className={`flex h-12 w-full items-center justify-between rounded-[8px] px-4 text-[16px] active:bg-black/[0.05] ${
              opt === selected ? 'text-[#07C160]' : 'text-black dark:text-white'
            }`}
          >
            {opt}
            {opt === selected && <Check className="h-5 w-5" strokeWidth={2.2} />}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 账单页主体（×关闭 + 全部账单/查找交易/收支统计 + 月份汇总 + 平铺列表） */
function WxBillPage({
  bills,
  onToast,
  onClose,
  onOpenStats,
}: {
  bills: WxBill[];
  onToast: (m: string) => void;
  onClose: () => void;
  onOpenStats: () => void;
}) {
  /** 当前查看月份（'all'=全部月份；默认最新有账单的月份，对齐真机） */
  const [month, setMonth] = useState<string>(() =>
    bills.length > 0 ? bills.reduce((acc, b) => (billMonthKey(b.time) > acc ? billMonthKey(b.time) : acc), billMonthKey(bills[0].time)) : 'all'
  );
  const [monthSheet, setMonthSheet] = useState(false);
  /** 已应用筛选（收支类型/交易类型） */
  const [appliedIo, setAppliedIo] = useState<BillIOFilter>('全部');
  const [appliedScene, setAppliedScene] = useState<BillSceneFilter>('全部');
  const [filterSheet, setFilterSheet] = useState(false);
  /** 查找交易 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');

  const monthKeys = Array.from(new Set(bills.map((b) => billMonthKey(b.time)))).sort((a, b) => b.localeCompare(a));
  const monthOptions = ['全部月份', ...monthKeys.map(billMonthLabel)];
  const monthFilter = (b: WxBill): boolean => month === 'all' || billMonthKey(b.time) === month;
  const ioFilter = (b: WxBill): boolean => (appliedIo === '全部' ? true : appliedIo === '支出' ? b.amount < 0 : b.amount > 0);
  const sceneFilter = (b: WxBill): boolean => {
    switch (appliedScene) {
      case '全部':
        return true;
      case '红包':
        return b.kind === '红包' || b.kind === '红包退款';
      case '转账':
        return b.kind === '转账' || b.kind === '转账退款';
      case '有退款':
        return b.refunded === true || b.kind === '红包退款' || b.kind === '转账退款';
      case '充值提现':
        return b.kind === '充值' || b.kind === '提现' || b.kind === '转入零钱通' || b.kind === '零钱通转出';
      case '商户消费':
        return b.kind === '亲属卡付款' || b.kind === '淘宝购物';
      default:
        return false; // 群收款/二维码收付款/信用卡还款：本机无此数据源
    }
  };
  const searchFilter = (b: WxBill): boolean => !searchOpen || !search.trim() || wxBillDisplayTitle(b).includes(search.trim());

  const shown = bills.filter((b) => monthFilter(b) && ioFilter(b) && sceneFilter(b) && searchFilter(b));
  const outSum = shown.filter((b) => b.amount < 0).reduce((s, b) => s + b.amount, 0);
  const inSum = shown.filter((b) => b.amount > 0).reduce((s, b) => s + b.amount, 0);
  const monthCaret = month === 'all' ? '全部月份' : billMonthLabel(month);

  return (
    <div className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-bill-page">
      {/* 顶栏：× 关闭 + 账单 + ··· */}
      <div className="shrink-0 pt-[54px]">
        <div className="relative flex h-11 items-center px-4">
          <button type="button" aria-label="关闭账单" data-testid="wx-bill-close" onClick={onClose} className="active:opacity-50">
            <X className="h-6 w-6" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">账单</div>
          <button type="button" aria-label="更多" onClick={() => onToast('更多功能暂未开放')} className="absolute right-4">
            <MoreDots />
          </button>
        </div>
      </div>

      {/* 过滤行：全部账单 ▾ | 查找交易 | 收支统计 › */}
      <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3">
        <button
          type="button"
          data-testid="wx-bill-filter-open"
          onClick={() => setFilterSheet(true)}
          className="flex h-[36px] items-center gap-1 rounded-full bg-white px-4 text-[15px] dark:bg-[#1E1E1E]"
        >
          {appliedIo === '全部' && appliedScene === '全部' ? '全部账单' : `${appliedIo === '全部' ? '' : appliedIo + ' '}${appliedScene}`}
          <svg viewBox="0 0 12 8" className="h-2 w-3" aria-hidden="true">
            <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          data-testid="wx-bill-search-open"
          onClick={() => setSearchOpen((v) => !v)}
          className="flex h-[36px] items-center gap-1.5 rounded-full bg-white px-4 text-[15px] dark:bg-[#1E1E1E]"
        >
          <Search className="h-[15px] w-[15px] text-black/45 dark:text-white/45" strokeWidth={2.2} />
          查找交易
        </button>
        <span className="flex-1" />
        <button type="button" data-testid="wx-bill-stats-link" onClick={onOpenStats} className="flex items-center text-[15px] active:opacity-60">
          收支统计
          <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>

      {/* 查找交易输入行（内联展开） */}
      {searchOpen && (
        <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-1.5">
          <div className="flex h-[36px] flex-1 items-center gap-2 rounded-full bg-white px-4 dark:bg-[#1E1E1E]">
            <Search className="h-[15px] w-[15px] shrink-0 text-black/40 dark:text-white/40" strokeWidth={2.2} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="输入关键词，如「红包」或对方昵称"
              className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setSearchOpen(false);
            }}
            className="text-[15px] active:opacity-60"
          >
            取消
          </button>
        </div>
      )}

      {/* 月份行：月份 ▾ + 当月收支汇总 */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-2">
        <button type="button" data-testid="wx-bill-month" onClick={() => setMonthSheet(true)} className="flex items-center gap-1 text-[17px] font-medium">
          {monthCaret}
          <svg viewBox="0 0 12 8" className="h-2 w-3" aria-hidden="true">
            <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <p className="text-[14.5px]">
          支出 <span className="font-medium">{fmtMoney(Math.abs(outSum))}</span>
          <span className="ml-3">
            收入 <span className="font-medium">{fmtMoney(inSum)}</span>
          </span>
        </p>
      </div>

      {/* 平铺列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-white dark:bg-[#1A1A1A]">
        {shown.length === 0 ? (
          <p className="pt-24 text-center text-[14px] text-black/35 dark:text-white/35">该条件下暂无账单</p>
        ) : (
          shown.map((b, i) => {
            const refundLabel = b.refunded ? (b.kind === '红包' ? '已全额退款' : '对方已退还') : null;
            return (
              <div
                key={b.id}
                data-testid="wx-bill-item"
                className={`relative flex items-center gap-3 px-4 py-[11px] ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.06]' : ''}`}
              >
                <WxBillEntryIcon b={b} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15.5px]">{wxBillDisplayTitle(b)}</p>
                  <p className="mt-0.5 text-[12.5px] text-black/40 dark:text-white/40">{wxBillWhen(b.time)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-[16px] font-medium ${b.amount >= 0 ? 'text-[#F5A623]' : ''}`}>
                    {b.amount >= 0 ? '+' : '-'}
                    {fmtMoney(Math.abs(b.amount))}
                  </p>
                  {refundLabel && <p className="mt-0.5 text-[11.5px] leading-none text-[#FA5151]">{refundLabel}</p>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {filterSheet && (
        <WxBillFilterSheet
          io={appliedIo}
          scene={appliedScene}
          onClose={() => setFilterSheet(false)}
          onApply={(io, scene) => {
            setAppliedIo(io);
            setAppliedScene(scene);
            setFilterSheet(false);
          }}
        />
      )}
      {monthSheet && (
        <WxBillMonthSheet
          title="选择月份"
          options={monthOptions}
          selected={monthCaret}
          onPick={(label) =>
            setMonth(label === '全部月份' ? 'all' : (monthKeys.find((k) => billMonthLabel(k) === label) ?? 'all'))
          }
          onClose={() => setMonthSheet(false)}
        />
      )}
    </div>
  );
}

// ---------------- 收支统计页（账单页「收支统计」入口：绿色头部 + 月/年账单 + 每月支出对比柱状图 + 当月支出构成） ----------------

type BillTab = 'month' | 'year';
type BillMetric = '支出' | '收入' | '其他';

/** 支出构成行定义：名称 + 图标 + 进度条颜色 */
interface BillBreakdownRow {
  name: string;
  total: number;
  color: string;
  icon: React.ReactNode;
}

function WxBillStatsPage({ bills, onToast, onClose }: { bills: WxBill[]; onToast: (m: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<BillTab>('month');
  const [metric, setMetric] = useState<BillMetric>('支出');
  /** 月账单选中的月份键 / 年账单选中的年份 */
  const [monthKey, setMonthKey] = useState<string>(() =>
    bills.length > 0 ? bills.reduce((acc, b) => (billMonthKey(b.time) > acc ? billMonthKey(b.time) : acc), billMonthKey(bills[0].time)) : billMonthKey(Date.now())
  );
  const [yearKey, setYearKey] = useState<string>(() => monthKey.split('-')[0]);
  const [picker, setPicker] = useState<null | { kind: BillTab }>(null);

  const metricFilter = (b: WxBill): boolean => {
    if (metric === '支出') return b.amount < 0;
    if (metric === '收入') return b.amount > 0 && b.kind !== '红包退款' && b.kind !== '转账退款' && b.kind !== '淘宝购物';
    return b.amount > 0 && (b.kind === '红包退款' || b.kind === '转账退款' || b.kind === '淘宝购物'); // 其他 = 退款（含淘宝退款）
  };

  /** 头部合计：月账单=选中月；年账单=选中年 */
  const scoped = bills.filter((b) => (tab === 'month' ? billMonthKey(b.time) === monthKey : billMonthKey(b.time).split('-')[0] === yearKey));
  const counted = scoped.filter(metricFilter);
  const total = Math.abs(counted.reduce((s, b) => s + b.amount, 0));
  const metricWord = metric === '其他' ? '其他' : metric;

  /** 柱状图数据：月账单=最近 6 个月（含选中月）；年账单=选中年 12 个月；固定展示支出对比 */
  const barMonths = (() => {
    if (tab === 'year') {
      const list: Array<{ key: string; label: string }> = [];
      for (let m = 0; m < 12; m++) list.push({ key: `${yearKey}-${m}`, label: `${m + 1}月` });
      return list;
    }
    const [y, m] = monthKey.split('-').map(Number);
    const list: Array<{ key: string; label: string }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(y, m - i, 1);
      list.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: `${d.getMonth() + 1}月` });
    }
    return list;
  })();
  const barData = barMonths.map(({ key, label }) => ({
    key,
    label,
    value: Math.abs(bills.filter((b) => billMonthKey(b.time) === key && b.amount < 0).reduce((s, b) => s + b.amount, 0)),
  }));
  const barMax = Math.max(...barData.map((d) => d.value), 0.01);

  /** 构成：按类别聚合（支出=支出类别；收入=收款类别；其他=退款） */
  const breakdown = (() => {
    const rows: BillBreakdownRow[] = [];
    const sumKind = (kinds: WxBill['kind'][], sign: 1 | -1) =>
      Math.abs(counted.filter((b) => kinds.includes(b.kind) && (sign === 1 ? b.amount > 0 : b.amount < 0)).reduce((s, b) => s + b.amount, 0));
    if (metric === '支出') {
      const defs: Array<{ name: string; kinds: WxBill['kind'][]; color: string; icon: React.ReactNode }> = [
        { name: '转账', kinds: ['转账'], color: '#07C160', icon: <ArrowLeftRight className="h-[15px] w-[15px]" strokeWidth={2.2} /> },
        { name: '微信红包', kinds: ['红包'], color: '#F26D3D', icon: <RedPacketGlyph size={30} bg="transparent" fg="#F26D3D" /> },
        { name: '亲属卡', kinds: ['亲属卡付款'], color: '#F7A500', icon: <Heart className="h-[15px] w-[15px]" strokeWidth={2.2} /> },
        { name: '零钱通', kinds: ['转入零钱通', '零钱通转出'], color: '#F7A500', icon: <Gem className="h-[15px] w-[15px]" strokeWidth={2.2} /> },
        { name: '充值', kinds: ['充值'], color: '#07C160', icon: <Plus className="h-[15px] w-[15px]" strokeWidth={2.2} /> },
        { name: '提现', kinds: ['提现'], color: '#4D9CF8', icon: <WalletIcon className="h-[15px] w-[15px]" strokeWidth={2.2} /> },
        { name: '淘宝', kinds: ['淘宝购物'], color: '#FF5F00', icon: <ShoppingBag className="h-[15px] w-[15px]" strokeWidth={2.2} /> },
      ];
      for (const d of defs) {
        const total_ = sumKind(d.kinds, -1);
        if (total_ > 0) rows.push({ name: d.name, total: total_, color: d.color, icon: d.icon });
      }
    } else {
      const defs: Array<{ name: string; kinds: WxBill['kind'][]; color: string; icon: React.ReactNode }> = [
        { name: '微信红包', kinds: ['红包'], color: '#F26D3D', icon: <RedPacketGlyph size={30} bg="transparent" fg="#F26D3D" /> },
        { name: '转账', kinds: ['转账'], color: '#07C160', icon: <ArrowLeftRight className="h-[15px] w-[15px]" strokeWidth={2.2} /> },
        { name: '退款', kinds: ['红包退款', '转账退款', '淘宝购物'], color: '#F5A623', icon: <RedPacketGlyph size={30} bg="transparent" fg="#F5A623" /> },
      ];
      for (const d of defs) {
        const total_ = sumKind(d.kinds, 1);
        if (total_ > 0) rows.push({ name: d.name, total: total_, color: d.color, icon: d.icon });
      }
    }
    return rows.sort((a, b) => b.total - a.total);
  })();
  const breakdownMax = Math.max(...breakdown.map((r) => r.total), 0.01);

  /** 年份选项（出现过年份 + 当前年） */
  const yearOptions = Array.from(new Set([...bills.map((b) => billMonthKey(b.time).split('-')[0]), String(new Date().getFullYear())])).sort((a, b) => b.localeCompare(a));

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-bill-stats-page">
      {/* 绿色头部 */}
      <div className="relative shrink-0 bg-[#07C160] pb-16 text-white">
        <span aria-hidden="true" className="pointer-events-none absolute -right-6 top-24 h-40 w-56 rotate-[-14deg] rounded-[22px] bg-white/10" />
        <span aria-hidden="true" className="pointer-events-none absolute -right-10 top-40 h-24 w-40 rotate-[8deg] rounded-[18px] bg-white/10" />
        <div className="relative pt-[54px]">
          <div className="relative flex h-11 items-center px-5">
            <button type="button" aria-label="关闭收支统计" data-testid="wx-bill-stats-close" onClick={onClose} className="active:opacity-50">
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          </div>
          {/* 月账单 / 年账单 tab */}
          <div className="mt-1 flex items-center justify-center gap-9">
            {(['month', 'year'] as BillTab[]).map((t) => (
              <button
                key={t}
                type="button"
                data-testid={`wx-bill-stats-tab-${t}`}
                onClick={() => setTab(t)}
                className={`relative pb-1.5 text-[16px] font-medium ${tab === t ? 'text-white' : 'text-white/60'}`}
              >
                {t === 'month' ? '月账单' : '年账单'}
                {tab === t && <span className="absolute inset-x-1.5 bottom-0 h-[3px] rounded-full bg-white" aria-hidden="true" />}
              </button>
            ))}
          </div>
          {/* 月份/年份 + 口径胶囊 */}
          <div className="mt-5 flex items-center justify-between px-5">
            <button
              type="button"
              data-testid="wx-bill-stats-month"
              onClick={() => setPicker({ kind: tab })}
              className="flex items-center gap-1 text-[17px] font-medium"
            >
              {tab === 'month' ? billMonthLabel(monthKey) : `${yearKey}年`}
              <svg viewBox="0 0 12 8" className="h-2 w-3" aria-hidden="true">
                <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <div className="flex items-center gap-2">
              {(['支出', '收入', '其他'] as BillMetric[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMetric(m)}
                  className={`rounded-full px-3 py-[2px] text-[12px] ${
                    metric === m ? 'border border-white/85 text-white' : 'text-white/70'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          {/* 合计 */}
          <div className="px-5 pt-4">
            <p className="text-[12px] text-white/85">
              共{metricWord}
              {counted.length}笔，合计
            </p>
            <p className="mt-0.5 text-[40px] font-medium leading-tight" data-testid="wx-bill-stats-total">
              ¥ {fmtMoney(total)}
            </p>
          </div>
        </div>
      </div>

      {/* 白色面板：记账本 + 每月支出对比 + 当期支出构成 */}
      <div className="relative -mt-12 min-h-0 flex-1 overflow-y-auto rounded-t-[16px] bg-white pb-10 dark:bg-[#1A1A1A]">
        <button
          type="button"
          onClick={() => onToast('记账本暂未开放')}
          className="mx-4 mt-3.5 flex w-[calc(100%-32px)] items-center gap-2.5 rounded-[10px] bg-[#F6F6F6] px-3.5 py-3 text-left active:bg-black/[0.04] dark:bg-[#242424] dark:active:bg-white/[0.06]"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#07C160] text-white" aria-hidden="true">
            <Check className="h-4 w-4" strokeWidth={2.4} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13.5px]">使用记账本，查看分类统计(餐饮、交通等)</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-black/30 dark:text-white/30" strokeWidth={2.2} />
        </button>

        <p className="mt-6 px-4 text-[15px] font-medium">{tab === 'month' ? '每月支出对比' : '每月支出对比'}</p>
        <div className="mt-2.5 flex h-[168px] items-end justify-between border-b border-black/[0.06] px-3 dark:border-white/[0.08]">
          {barData.map((d) => {
            const h = d.value <= 0 ? 3 : Math.max(5, Math.round((d.value / barMax) * 114));
            const cur = tab === 'month' ? d.key === monthKey : d.key === monthKey;
            return (
              <div key={d.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className={`text-[10px] leading-none ${cur ? 'font-medium text-[#07C160]' : 'text-[#9CCFAD]'}`}>{fmtMoney(d.value)}</span>
                <span className="w-[18px] rounded-[3px]" style={{ height: h, backgroundColor: cur ? '#07C160' : '#C9E9D4' }} aria-hidden="true" />
                <span className="truncate text-[10.5px] text-black/40 dark:text-white/40">{d.label}</span>
              </div>
            );
          })}
        </div>

        <p className="mt-6 px-4 text-[15px] font-medium">
          {tab === 'month' ? '当月' : '当年'}
          {metric === '其他' ? '其他' : metric}构成
        </p>
        {breakdown.length === 0 ? (
          <p className="px-4 py-7 text-center text-[13px] text-black/35 dark:text-white/35">暂无{metric === '其他' ? '其他' : metric}数据</p>
        ) : (
          <div className="mt-0.5">
            {breakdown.map((r) => (
              <button
                key={r.name}
                type="button"
                onClick={() => onToast('分类明细暂未开放')}
                className="flex w-full items-center gap-2.5 border-t border-black/[0.05] px-4 py-3 text-left first:border-t-0 dark:border-white/[0.07]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ color: r.color }} aria-hidden="true">
                  {r.icon}
                </span>
                <span className="w-[64px] shrink-0 truncate text-[14px]">{r.name}</span>
                <span className="h-[5px] min-w-0 flex-1 rounded-full bg-black/[0.06] dark:bg-white/[0.1]" aria-hidden="true">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${Math.max(4, Math.round((r.total / breakdownMax) * 100))}%`, backgroundColor: r.color }}
                  />
                </span>
                <span className="shrink-0 text-[14.5px] font-medium">¥{fmtMoney(r.total)}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-black/30 dark:text-white/30" strokeWidth={2.2} />
              </button>
            ))}
          </div>
        )}
      </div>

      {picker && (
        <WxBillMonthSheet
          title={picker.kind === 'month' ? '选择月份' : '选择年份'}
          options={picker.kind === 'month' ? Array.from(new Set([...bills.map((b) => billMonthLabel(billMonthKey(b.time))), billMonthLabel(monthKey)])) : yearOptions.map((y) => `${y}年`)}
          selected={picker.kind === 'month' ? billMonthLabel(monthKey) : `${yearKey}年`}
          onPick={(label) => {
            if (picker.kind === 'month') {
              const hit = Array.from(new Set(bills.map((b) => billMonthKey(b.time)))).find((k) => billMonthLabel(k) === label);
              if (hit) {
                setMonthKey(hit);
                setYearKey(hit.split('-')[0]);
              }
            } else {
              setYearKey(label.replace(/年$/, ''));
            }
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

// ---------------- 零钱通页 ----------------

function ChangePlusPage({
  lcq,
  onBack,
  onOpenDetail,
  onTransferIn,
  onTransferOut,
  onToast,
}: {
  lcq: WxLcq;
  onBack: () => void;
  onOpenDetail: () => void;
  onTransferIn: () => void;
  onTransferOut: () => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-gradient-to-b from-[#F7A400] to-[#F8B500] text-white" data-testid="wx-lcq-page">
      {/* 斜向高光装饰 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{ background: 'linear-gradient(115deg, transparent 52%, rgba(255,255,255,0.22) 52.3%, rgba(255,255,255,0.22) 72%, transparent 72.3%)' }}
      />
      <div className="relative">
        <WxNav
          onBack={onBack}
          testId="wx-lcq-back"
          light
          right={
            <button type="button" aria-label="更多" onClick={() => onToast('更多功能暂未开放')}>
              <MoreDots />
            </button>
          }
        />
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto pb-6">
        <div className="flex flex-col items-center pt-2">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20" aria-hidden="true">
            <Gem className="h-7 w-7 text-white" strokeWidth={1.8} />
          </span>
          <p className="mt-2 text-[19px] font-semibold">零钱通</p>
          <button type="button" onClick={() => onToast('资金安全由保险公司保障')} className="mt-1.5 flex items-center gap-1 text-[13px] text-white/90 active:opacity-60">
            <ShieldCheck className="h-4 w-4" strokeWidth={2} />
            资金安全保障中
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        </div>

        {/* 主卡片 */}
        <div className="mx-3 mt-4 rounded-[16px] bg-white px-6 py-6 text-black shadow-sm dark:bg-[#1A1A1A] dark:text-white">
          <p className="text-center text-[15px] text-black/60 dark:text-white/60">账户余额</p>
          <p className="mt-1 text-center font-semibold" data-testid="wx-lcq-balance">
            <span className="text-[22px]">¥</span>
            <span className="ml-1 text-[38px]">{fmtMoney(lcq.balance)}</span>
          </p>
          <div className="mt-1 text-center">
            <button type="button" data-testid="wx-lcq-detail" onClick={onOpenDetail} className="text-[14px] text-[#576B95] active:opacity-60">
              资金明细
            </button>
          </div>

          <div className="mt-7 flex items-stretch">
            <div className="flex-1 text-center">
              <button type="button" onClick={() => onToast('易方达易理财货币A · 七日年化 0.9130%')} className="inline-flex items-center gap-0.5 text-[13px] text-black/45 dark:text-white/45">
                7日年化收益率
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
              <p className="mt-1 text-[23px] font-semibold">0.9130%</p>
              <span className="mt-2 inline-block rounded-full bg-black/[0.05] px-2.5 py-1 text-[11.5px] text-black/50 dark:bg-white/10 dark:text-white/50">
                易方达易理财货币A
              </span>
            </div>
            <div className="w-px bg-black/[0.07] dark:bg-white/[0.1]" aria-hidden="true" />
            <div className="flex-1 text-center">
              <button type="button" className="inline-flex items-center gap-0.5 text-[13px] text-black/45 dark:text-white/45" onClick={() => onToast('收益每日发放')}>
                累计收益
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
              <p className="mt-1 text-[23px] font-semibold" data-testid="wx-lcq-earn-total">
                ¥{fmtMoney(lcq.totalEarn)}
              </p>
              <span className="mt-2 inline-block rounded-full bg-black/[0.05] px-2.5 py-1 text-[11.5px] text-black/50 dark:bg-white/10 dark:text-white/50" data-testid="wx-lcq-earn-yesterday">
                昨日 ¥{fmtMoney(lcq.yesterdayEarn)}
              </span>
            </div>
          </div>

          <div className="mt-8 flex gap-4 px-6">
            <button
              type="button"
              data-testid="wx-lcq-out"
              onClick={onTransferOut}
              className="h-12 flex-1 rounded-[8px] bg-[#F7F7F7] text-[17px] text-black active:bg-black/5 dark:bg-[#2A2A2A] dark:text-white dark:active:bg-white/10"
            >
              转出
            </button>
            <button
              type="button"
              data-testid="wx-lcq-in"
              onClick={onTransferIn}
              className="h-12 flex-1 rounded-[8px] bg-[#F7A500] text-[17px] font-medium text-white active:brightness-95"
            >
              转入
            </button>
          </div>

          <button type="button" onClick={() => onToast('定时转入暂未开放')} className="mx-auto mt-6 flex items-center gap-1.5 text-[14px] text-black/45 dark:text-white/45">
            <Clock className="h-4 w-4" strokeWidth={2} />
            设置定时转入
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        </div>

        {/* 更多产品 */}
        <p className="mb-2 mt-5 px-4 text-[14px] text-white/95">更多产品</p>
        <div className="mx-3 overflow-hidden rounded-[16px] bg-white px-5 py-1 text-black dark:bg-[#1A1A1A] dark:text-white">
          <button type="button" onClick={() => onToast('理财通暂未开放')} className="flex w-full items-center gap-3 py-3.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.06]">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#4D9CF8] to-[#2F6FE0]" aria-hidden="true">
              <TrendingUp className="h-4 w-4 text-white" strokeWidth={2.2} />
            </span>
            <span className="flex-1 text-[17px]">理财通</span>
            <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
          <div className="flex items-center gap-3 border-t border-black/[0.05] py-3.5 dark:border-white/[0.08]">
            <div className="min-w-0 flex-1">
              <p className="text-[15px]">活期理财</p>
              <p className="mt-0.5 text-[13px] text-black/45 dark:text-white/45">转出最快秒到账</p>
            </div>
            <div className="text-right">
              <p className="text-[17px] font-medium text-[#ED6C4E]">1.51%</p>
              <p className="mt-0.5 text-[12px] text-black/45 dark:text-white/45">收益率</p>
            </div>
          </div>
          <div className="flex items-center gap-3 border-t border-black/[0.05] py-3.5 dark:border-white/[0.08]">
            <div className="min-w-0 flex-1">
              <p className="text-[15px]">定期理财</p>
              <p className="mt-0.5 text-[13px] text-black/45 dark:text-white/45">追求更高收益</p>
            </div>
            <div className="text-right">
              <p className="text-[17px] font-medium text-[#ED6C4E]">2.33%</p>
              <p className="mt-0.5 text-[12px] text-black/45 dark:text-white/45">最高收益率</p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-8 text-[14px] text-white/95">
          <button type="button" onClick={() => onToast('了解零钱通暂未开放')}>了解零钱通 ›</button>
          <button type="button" onClick={() => onToast('常见问题暂未开放')}>常见问题 ›</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 银行卡页（QQ 同款卡片视觉 + 详情页：生成卡号 / 自定义金额 / 持卡人真实姓名 / 解绑） ----------------

/** 实体卡视觉（与 QQ 钱包银行卡同款：85.6:54 比例 + 银行品牌渐变 + 圆标 + 金色芯片 + 闪付波纹 + 持卡人/余额） */
function BankCardArt({ card, onClick }: { card: WxCard; onClick: () => void }) {
  const [c1, c2] = BANK_COLORS[card.bank] ?? ['#5A6068', '#878E96'];
  return (
    <button
      type="button"
      data-testid="wx-card-item"
      onClick={onClick}
      className="relative block w-full overflow-hidden rounded-[16px] text-left shadow-lg shadow-black/15 transition-transform active:scale-[0.985]"
      style={{ backgroundImage: `linear-gradient(135deg, ${c1}, ${c2})` }}
    >
      {/* 高光装饰 */}
      <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-white/10" />
      <span aria-hidden="true" className="pointer-events-none absolute -right-20 top-10 h-28 w-28 rounded-full bg-white/[0.07]" />
      <span className="relative flex aspect-[85.6/54] flex-col justify-between p-4">
        {/* 银行圆标 + 名称 + 卡类型 */}
        <span className="flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/25 text-[15px] font-semibold text-white backdrop-blur-sm"
            aria-hidden="true"
          >
            {card.bank.slice(0, 1)}
          </span>
          <span className="truncate text-[16px] font-semibold text-white">{card.bank}</span>
          <span className="ml-auto shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] leading-4 text-white/95">储蓄卡</span>
        </span>
        {/* 金色芯片 + 闪付波纹 */}
        <span className="mt-2 flex items-center gap-2.5" aria-hidden="true">
          <span className="relative h-7 w-10 shrink-0 overflow-hidden rounded-[5px] bg-gradient-to-br from-[#F3D47C] to-[#C9962E]">
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/15" />
            <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-black/15" />
          </span>
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-white/80" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M7 9a7.5 7.5 0 0 1 0 6" />
            <path d="M11 6.8a11.5 11.5 0 0 1 0 10.4" />
            <path d="M15 4.6a15.5 15.5 0 0 1 0 14.8" />
          </svg>
        </span>
        {/* 卡号 + 持卡人 + 卡内余额 */}
        <span className="block">
          <span
            className="block text-[17px] font-medium tracking-[0.1em] text-white [font-variant-numeric:tabular-nums]"
            data-testid="wx-card-no"
          >
            {formatWxCardNo(card.no, card.tail)}
          </span>
          <span className="mt-2 flex items-end justify-between gap-2">
            <span className="truncate text-[12px] text-white/85" data-testid="wx-card-holder">
              持卡人 {card.holder || '—'}
            </span>
            <span className="shrink-0 text-[12px] font-medium text-white/95">¥{fmtMoney(card.balance)}</span>
          </span>
        </span>
      </span>
    </button>
  );
}

/** 银行卡详情页（点击卡片进入：大卡视觉 + 卡内余额 + 持卡人/卡号/银行/类型/时间 + 两步确认解绑） */
function WxCardDetailPage({
  card,
  onBack,
  onUnbind,
  onToast,
}: {
  card: WxCard;
  onBack: () => void;
  onUnbind: () => void;
  onToast: (m: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    []
  );
  const tapUnbind = () => {
    if (armed) {
      onUnbind();
      return;
    }
    setArmed(true);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmed(false), 3000);
  };
  const fmtTime = (ts: number): string => new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const rows: Array<{ k: string; v: React.ReactNode }> = [
    { k: '卡类型', v: '储蓄卡' },
    { k: '持卡人', v: card.holder || '—' },
    { k: '所属银行', v: card.bank },
    { k: '银行卡号', v: <span className="tracking-wider">{formatWxCardNo(card.no, card.tail)}</span> },
  ];
  return (
    <div className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-card-detail">
      <WxNav title="银行卡详情" onBack={onBack} testId="wx-card-detail-back" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        <BankCardArt card={card} onClick={() => {}} />
        <div className="mt-3 overflow-hidden rounded-[12px] bg-white dark:bg-[#1A1A1A]">
          <div className="border-b border-black/[0.04] px-4 pb-4 pt-5 text-center dark:border-white/[0.08]">
            <p className="text-[13px] text-black/45 dark:text-white/45">卡内余额（元）</p>
            <p className="mt-1 font-semibold" data-testid="wx-card-detail-balance">
              <span className="text-[20px]">¥</span>
              <span className="ml-1 text-[34px]">{fmtMoney(card.balance)}</span>
            </p>
          </div>
          {rows.map((r) => (
            <div
              key={r.k}
              className="flex min-h-[50px] items-center justify-between gap-3 border-b border-black/[0.04] px-4 py-2 last:border-b-0 dark:border-white/[0.06]"
            >
              <span className="shrink-0 text-[15px] text-black/45 dark:text-white/45">{r.k}</span>
              <span className="min-w-0 truncate text-right text-[15px]">{r.v}</span>
            </div>
          ))}
          {typeof card.createdAt === 'number' && (
            <div className="flex min-h-[50px] items-center justify-between gap-3 px-4 py-2">
              <span className="shrink-0 text-[15px] text-black/45 dark:text-white/45">添加时间</span>
              <span className="text-right text-[15px]">{fmtTime(card.createdAt)}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          data-testid="wx-card-unbind"
          onClick={tapUnbind}
          className={`mt-5 h-12 w-full rounded-[8px] text-[17px] font-medium text-white active:brightness-95 ${armed ? 'bg-[#D6453C]' : 'bg-[#FA5151]/85'}`}
        >
          {armed ? '再点一次确认解除绑定' : '解除绑定'}
        </button>
        <p className="mt-8 text-center text-[12px] text-black/35 dark:text-white/35">本服务由财付通提供</p>
      </div>
    </div>
  );
}

/** 添加银行卡弹层（每次打开重新挂载：持卡人预填真实姓名、金额默认可改） */
function AddCardSheet({
  myRealName,
  onSubmit,
  onClose,
  onToast,
}: {
  myRealName: string;
  onSubmit: (c: { bank: string; no: string; tail: string; holder: string; balance: number }) => void;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [bank, setBank] = useState('招商银行');
  const [no, setNo] = useState('');
  const [amount, setAmount] = useState('8888.88');
  const [holder, setHolder] = useState(myRealName);
  const digits = no.replace(/\D/g, '');
  const amt = Math.round((parseFloat(amount.replace(/[^\d.]/g, '') || '0') || 0) * 100) / 100;
  const canAdd = digits.length >= 12 && digits.length <= 19 && holder.trim().length > 0 && amt >= 0;

  const field = 'h-11 w-full rounded-[8px] bg-black/[0.04] px-3 text-[16px] text-black outline-none placeholder:text-black/30 dark:bg-white/[0.08] dark:text-white dark:placeholder:text-white/30';

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" data-testid="wx-add-card-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative max-h-[92%] overflow-y-auto rounded-t-2xl bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 dark:bg-[#1E1E1E]">
        <div className="relative flex h-10 items-center justify-center">
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="absolute left-0 flex h-9 w-9 items-center justify-center text-black/60 active:opacity-60 dark:text-white/60"
          >
            <X className="h-6 w-6" strokeWidth={1.8} />
          </button>
          <div className="text-[16px] font-medium text-black dark:text-white">添加银行卡</div>
        </div>
        <p className="mb-2 mt-4 text-[13px] text-black/45 dark:text-white/45">选择银行</p>
        <div className="flex flex-wrap gap-2">
          {Object.keys(BANK_COLORS).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBank(b)}
              className={`rounded-full border px-3.5 py-1.5 text-[14px] active:opacity-70 ${
                bank === b
                  ? 'border-[#07C160] bg-[#07C160]/10 text-[#07C160]'
                  : 'border-black/10 text-black/70 dark:border-white/15 dark:text-white/70'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
        <p className="mb-1 mt-4 text-[13px] text-black/45 dark:text-white/45">卡号</p>
        <div className="flex gap-2">
          <input
            value={no}
            onChange={(e) => setNo(e.target.value)}
            inputMode="numeric"
            placeholder="手填或点击生成"
            data-testid="wx-add-card-no"
            className={`${field} flex-1 font-mono tracking-wide`}
          />
          <button
            type="button"
            data-testid="wx-add-card-gen"
            onClick={() => setNo(genCardNo(bank))}
            className="flex h-11 shrink-0 items-center gap-1 rounded-[8px] bg-[#07C160]/10 px-3 text-[14px] text-[#07C160] active:bg-[#07C160]/20 dark:bg-[#07C160]/20 dark:text-[#2BD579]"
          >
            <Dices className="h-4 w-4" strokeWidth={2} />
            生成卡号
          </button>
        </div>
        <p className="mb-1 mt-4 text-[13px] text-black/45 dark:text-white/45">卡内金额（元）</p>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="自定义卡内金额"
          data-testid="wx-add-card-amount"
          className={field}
        />
        <div className="mt-2 flex gap-2">
          {[888.88, 10000, 100000, 1000000].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(String(v))}
              className="rounded-full bg-black/[0.04] px-3 py-1 text-[12.5px] text-black/60 active:bg-black/[0.08] dark:bg-white/[0.08] dark:text-white/60 dark:active:bg-white/[0.15]"
            >
              ¥{v.toLocaleString('en-US')}
            </button>
          ))}
        </div>
        <p className="mb-1 mt-4 text-[13px] text-black/45 dark:text-white/45">持卡人</p>
        <input
          value={holder}
          onChange={(e) => setHolder(e.target.value)}
          placeholder="请输入持卡人姓名"
          data-testid="wx-add-card-holder"
          className={field}
        />
        <p className="mt-2 text-[12px] text-black/35 dark:text-white/35">持卡人须为真实姓名，与银行预留一致</p>
        <button
          type="button"
          data-testid="wx-add-card-confirm"
          onClick={() => {
            if (!canAdd) {
              onToast('请填写正确的卡号、金额和持卡人');
              return;
            }
            onSubmit({ bank, no: digits, tail: digits.slice(-4), holder: holder.trim(), balance: amt });
          }}
          className={`mt-6 h-12 w-full rounded-[8px] text-[17px] font-medium text-white active:brightness-95 ${
            canAdd ? 'bg-[#07C160]' : 'bg-[#07C160]/40'
          }`}
        >
          添加
        </button>
      </div>
    </div>
  );
}

function BankCardsPage({
  cards,
  myRealName,
  onBack,
  onAdd,
  onOpenCard,
  onToast,
}: {
  cards: WxCard[];
  myRealName: string;
  onBack: () => void;
  onAdd: (card: { bank: string; no: string; tail: string; holder: string; balance: number }) => void;
  onOpenCard: (card: WxCard) => void;
  onToast: (m: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-cards-page">
      <WxNav
        title="银行卡"
        onBack={onBack}
        testId="wx-cards-back"
        right={
          <button type="button" aria-label="更多" onClick={() => onToast('更多功能暂未开放')}>
            <MoreDots />
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        {cards.length > 0 ? (
          <div className="space-y-3">
            {cards.map((c) => (
              <BankCardArt key={c.id} card={c} onClick={() => onOpenCard(c)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center pt-16 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/[0.04] dark:bg-white/[0.08]" aria-hidden="true">
              <CreditCard className="h-8 w-8 text-black/30 dark:text-white/30" strokeWidth={1.5} />
            </span>
            <p className="mt-4 text-[15px] text-black/45 dark:text-white/45">还没有绑定银行卡</p>
            <p className="mt-1 text-[13px] text-black/35 dark:text-white/35">绑定后可用于充值、提现</p>
          </div>
        )}
        <button
          type="button"
          data-testid="wx-cards-add"
          onClick={() => setAddOpen(true)}
          className={`flex w-full items-center gap-3 rounded-[12px] bg-white px-4 py-5 text-left active:bg-black/[0.03] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06] ${
            cards.length > 0 ? 'mt-3' : ''
          }`}
        >
          <Plus className="h-6 w-6 shrink-0 text-black/70 dark:text-white/70" strokeWidth={2} />
          <span className="text-[17px]">添加银行卡</span>
          <span className="ml-1 text-[13px] text-[#F7A500]">绑新卡送立减金</span>
        </button>
        <p className="mt-10 text-center text-[12px] text-black/35 dark:text-white/35">本服务由财付通提供</p>
      </div>

      {/* 添加银行卡弹层 */}
      {addOpen && (
        <AddCardSheet
          myRealName={myRealName}
          onClose={() => setAddOpen(false)}
          onSubmit={(c) => {
            onAdd(c);
            setAddOpen(false);
            onToast('添加成功');
          }}
          onToast={onToast}
        />
      )}
    </div>
  );
}

// ---------------- 亲属卡：介绍页 ----------------

const FC_RELATIONS = ['爸爸', '妈妈', '儿子', '女儿', '爷爷', '奶奶', '兄弟姐妹', '其他亲人'];

function FamilyIntroPage({ onBack, onGo, onToast }: { onBack: () => void; onGo: () => void; onToast: (m: string) => void }) {
  const [agree, setAgree] = useState(false);
  return (
    <div className="relative flex h-full w-full flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fc-intro">
      <WxNav onBack={onBack} testId="wx-fc-intro-back" />
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto pt-[6vh]">
        {/* 卡片插画（旋转黄卡 + 椭圆轨道） */}
        <div className="relative h-[130px] w-[160px]" aria-hidden="true">
          <div className="absolute left-1/2 top-1/2 h-[78px] w-[108px] -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-[14px] bg-gradient-to-br from-[#FFE9A8] to-[#FFD44D] shadow-sm" />
          <div className="absolute left-1/2 top-1/2 h-[64px] w-[156px] -translate-x-1/2 -translate-y-1/2 -rotate-[24deg] rounded-[50%] border-2 border-[#F5C63C]" />
        </div>
        <h1 className="mt-8 text-[28px] font-semibold">亲属卡</h1>
        <div className="mt-8 text-center text-[17px] leading-[46px]">
          <p>送家人亲属卡</p>
          <p>对方消费我买单</p>
          <p>让支付更简单</p>
        </div>
      </div>
      <div className="shrink-0 px-10 pb-1">
        <button type="button" data-testid="wx-fc-agree" onClick={() => setAgree((v) => !v)} className="mx-auto flex items-center justify-center gap-1.5 active:opacity-70">
          <span
            aria-hidden="true"
            className={`flex h-[18px] w-[18px] items-center justify-center rounded-full ${
              agree ? 'bg-black/25 dark:bg-white/30' : 'border border-black/25 dark:border-white/35'
            } text-white`}
          >
            {agree && <Check className="h-3 w-3" strokeWidth={3} />}
          </span>
          <span className="text-[14px]">我已阅读并同意</span>
          <span className="text-[14px] text-[#576B95]" onClick={(e) => { e.stopPropagation(); onToast('使用说明暂未开放'); }}>
            使用说明
          </span>
        </button>
        <button
          type="button"
          data-testid="wx-fc-go"
          onClick={() => {
            if (!agree) {
              onToast('请先阅读并同意使用说明');
              return;
            }
            onGo();
          }}
          className="mt-4 h-12 w-full rounded-[8px] bg-[#07C160] text-[17px] font-medium text-white active:brightness-95"
        >
          赠送亲属卡
        </button>
      </div>
      <p className="shrink-0 pb-7 pt-4 text-center text-[12px] text-black/30 dark:text-white/30">本服务由财付通提供</p>
    </div>
  );
}

// ---------------- 亲属卡：选择家人 ----------------

function FamilyPickPage({
  friends,
  onBack,
  onPicked,
}: {
  friends: ContactRecord[];
  onBack: () => void;
  onPicked: (friend: ContactRecord, relation: string) => void;
}) {
  const [pickFriend, setPickFriend] = useState<ContactRecord | null>(null);
  return (
    <div className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fc-pick">
      <WxNav title="选择家人" onBack={onBack} testId="wx-fc-pick-back" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        {friends.length === 0 ? (
          <p className="pt-24 text-center text-[14px] text-black/35 dark:text-white/35">还没有好友，先去添加朋友吧</p>
        ) : (
          <div className="overflow-hidden rounded-[12px] bg-white dark:bg-[#1A1A1A]">
            {friends.map((f, i) => (
              <button
                key={f.id}
                type="button"
                data-testid="wx-fc-friend-item"
                onClick={() => setPickFriend(f)}
                className={`relative flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                  i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.08]' : ''
                }`}
              >
                <MiniAvatar src={f.avatar} alt={f.name} />
                <span className="min-w-0 flex-1 truncate text-[16px]">{f.name}</span>
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
              </button>
            ))}
          </div>
        )}
      </div>
      {pickFriend && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end">
          <button type="button" aria-label="取消" onClick={() => setPickFriend(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative mx-3 mb-6 rounded-[12px] bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))] dark:bg-[#242424]">
            <div className="flex items-center gap-3 border-b border-black/5 pb-3 dark:border-white/10">
              <MiniAvatar src={pickFriend.avatar} alt={pickFriend.name} size={36} />
              <span className="text-[16px] font-medium">给 {pickFriend.name} 选择关系</span>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {FC_RELATIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  data-testid={`wx-fc-rel-${r}`}
                  onClick={() => onPicked(pickFriend, r)}
                  className="rounded-[8px] bg-black/[0.04] py-2.5 text-[14px] text-black active:bg-black/10 dark:bg-white/[0.08] dark:text-white dark:active:bg-white/15"
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 亲属卡：设置页（额度 + 自绘键盘） ----------------

function FamilySetupPage({
  friend,
  relation,
  onBack,
  onGift,
  onToast,
}: {
  friend: ContactRecord;
  relation: string;
  onBack: () => void;
  onGift: (amount: number, message: string) => void;
  onToast: (m: string) => void;
}) {
  const [val, setVal] = useState('');
  const [message, setMessage] = useState('我为你准备了亲属卡，你消费我买单');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message);
  const num = parseFloat(val || '0');

  const submit = () => {
    if (!(num >= 0.01)) {
      onToast('请设置每月消费上限');
      return;
    }
    if (num > 3000) {
      onToast('每月消费上限不能超过 3000 元');
      return;
    }
    onGift(num, message);
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-[#F7F7F7] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fc-setup">
      <WxNav title="设置亲属卡" onBack={onBack} testId="wx-fc-setup-back" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
        <div className="flex items-center gap-3">
          <MiniAvatar src={friend.avatar} alt={friend.name} size={42} />
          <span className="text-[17px]" data-testid="wx-fc-setup-name">
            {friend.name}（{relation}）
          </span>
        </div>

        <p className="mt-5 text-[15px] leading-relaxed">
          {message}
          {!editing && (
            <button
              type="button"
              data-testid="wx-fc-edit-msg"
              onClick={() => {
                setDraft(message);
                setEditing(true);
              }}
              className="ml-2 text-[#576B95] active:opacity-60"
            >
              修改留言
            </button>
          )}
        </p>
        {editing && (
          <div className="mt-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={40}
              rows={2}
              className="w-full resize-none rounded-[8px] bg-black/[0.04] p-3 text-[15px] text-black outline-none dark:bg-white/[0.08] dark:text-white"
            />
            <button
              type="button"
              onClick={() => {
                setMessage(draft.trim() || '我为你准备了亲属卡，你消费我买单');
                setEditing(false);
              }}
              className="mt-1.5 text-[14px] text-[#576B95] active:opacity-60"
            >
              完成
            </button>
          </div>
        )}

        {/* 每月消费上限卡片（黄色星球装饰） */}
        <div className="relative mt-4 overflow-hidden rounded-[12px] bg-white px-6 py-7 dark:bg-[#1A1A1A]">
          <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-gradient-to-br from-[#FFF3C4] to-[#FFE79A] opacity-90" />
          <div aria-hidden="true" className="pointer-events-none absolute right-2 top-6 h-16 w-32 rounded-[50%] border-2 border-[#F5C63C] opacity-70" style={{ transform: 'rotate(-18deg)' }} />
          <p className="relative text-[15px]">设置每月消费上限</p>
          <p className="relative mt-2 font-semibold" data-testid="wx-fc-limit">
            <span className="text-[22px]">¥</span>
            <span className="ml-1 text-[38px]">{val || '0.00'}</span>
          </p>
        </div>
      </div>
      <NumPad onKey={(k) => setVal((v) => pushAmount(v, k))} onSubmit={submit} submitLabel="赠送" submitTestId="wx-fc-gift" />
    </div>
  );
}

// ---------------- 亲属卡：管理页 ----------------

function FamilyManagePage({
  cards,
  received,
  myRealName,
  onBack,
  onUnbind,
  onUnbindReceived,
  onSimulateReceive,
  onAdd,
  onToast,
  onPaid,
}: {
  cards: WxFamilyCard[];
  received: WxFamilyCardIn[];
  /** 机主真实名字（消费记忆句式用） */
  myRealName: string;
  onBack: () => void;
  onUnbind: (id: string) => void;
  /** 解除（退回）收到的亲属卡：从列表移除 + 同步把聊天卡片标记已退回 */
  onUnbindReceived: (id: string) => void;
  onSimulateReceive: () => void;
  onAdd: () => void;
  onToast: (m: string) => void;
  /** 亲属卡付款成功后刷新「本月剩余」（父级重读 kv） */
  onPaid: () => void;
}) {
  const [unbind, setUnbind] = useState<WxFamilyCard | null>(null);
  const [unbindIn, setUnbindIn] = useState<WxFamilyCardIn | null>(null);
  const [payIn, setPayIn] = useState<WxFamilyCardIn | null>(null);
  const [ledgerIn, setLedgerIn] = useState<WxFamilyCardIn | null>(null);
  return (
    <div className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fc-manage">
      <WxNav
        title="亲属卡"
        onBack={onBack}
        testId="wx-fc-manage-back"
        right={
          <button type="button" aria-label="更多" onClick={() => onToast('更多功能暂未开放')}>
            <MoreDots />
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        {cards.length > 0 && (
          <>
            <p className="mb-2 px-1 text-[14px] text-black/45 dark:text-white/45">我赠送的亲属卡</p>
            <div className="space-y-3">
              {cards.map((c) => (
                <div key={c.id} data-testid="wx-fc-card" className="rounded-[12px] bg-white px-4 py-4 dark:bg-[#1A1A1A]">
                  <button type="button" onClick={() => setUnbind(c)} className="flex w-full items-center gap-3 text-left active:opacity-70">
                    <MiniAvatar src={c.friendAvatar} alt={c.friendName} size={38} />
                    <span className="min-w-0 flex-1 truncate text-[17px]">
                      {c.friendName}（{c.relation}）
                    </span>
                    {/* #23：returned=AI 退回/拒收终态，灰显「已退回」（与 pending/active 同构渲染） */}
                    <span
                      className={`shrink-0 text-[15px] ${
                        c.status === 'pending'
                          ? 'text-[#FA9D3B]'
                          : c.status === 'returned'
                            ? 'text-black/35 dark:text-white/35'
                            : 'text-[#07C160]'
                      }`}
                    >
                      {c.status === 'pending' ? '待对方领取' : c.status === 'returned' ? '已退回' : '使用中'}
                    </span>
                  </button>
                  <div className="mt-4 flex items-stretch">
                    <div className="flex-1 text-center">
                      <p className="text-[13px] text-black/45 dark:text-white/45">月额度</p>
                      <p className="mt-1 text-[20px] font-semibold">¥ {fmtMoney(c.monthlyLimit)}</p>
                    </div>
                    <div className="w-px bg-black/[0.07] dark:bg-white/[0.1]" aria-hidden="true" />
                    <div className="flex-1 text-center">
                      <p className="text-[13px] text-black/45 dark:text-white/45">已用额度</p>
                      <p className="mt-1 text-[20px] font-semibold">{c.used > 0 ? `¥ ${fmtMoney(c.used)}` : '—'}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {received.length > 0 && (
          <>
            <p className="mb-2 mt-6 px-1 text-[14px] text-black/45 dark:text-white/45">我收到的亲属卡</p>
            <div className="space-y-3">
              {received.map((c) => (
                <div key={c.id} data-testid="wx-fc-in-card" className="rounded-[12px] bg-white px-4 py-4 dark:bg-[#1A1A1A]">
                  <button type="button" onClick={() => setUnbindIn(c)} className="flex w-full items-center gap-3 text-left active:opacity-70">
                    <MiniAvatar src={c.fromAvatar} alt={c.fromName} size={38} />
                    <span className="min-w-0 flex-1 truncate text-[17px]">
                      {c.fromName}（{c.relation}）
                    </span>
                    <span className="shrink-0 text-[15px] text-[#07C160]">使用中</span>
                  </button>
                  <div className="mt-4 flex items-stretch">
                    <div className="flex-1 text-center">
                      <p className="text-[13px] text-black/45 dark:text-white/45">月额度</p>
                      <p className="mt-1 text-[20px] font-semibold">¥ {fmtMoney(c.monthlyLimit)}</p>
                    </div>
                    <div className="w-px bg-black/[0.07] dark:bg-white/[0.1]" aria-hidden="true" />
                    <div className="flex-1 text-center">
                      <p className="text-[13px] text-black/45 dark:text-white/45">本月剩余</p>
                      <p className="mt-1 text-[20px] font-semibold">¥ {fmtMoney(Math.max(0, c.monthlyLimit - c.used))}</p>
                    </div>
                  </div>
                  {/* 亲属卡付款（商户消费）+ 消费记录（金额/商户/时间/花在哪，持久化） */}
                  <div className="mt-3 flex items-stretch border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
                    <button
                      type="button"
                      data-testid="wx-fc-pay-open"
                      onClick={() => setPayIn(c)}
                      className="flex-1 text-center text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
                    >
                      亲属卡付款
                    </button>
                    <div className="w-px bg-black/[0.06] dark:bg-white/[0.08]" aria-hidden="true" />
                    <button
                      type="button"
                      data-testid="wx-fc-ledger-open"
                      onClick={() => setLedgerIn(c)}
                      className="flex-1 text-center text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
                    >
                      消费记录
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {received.length === 0 && (
          <button
            type="button"
            data-testid="wx-fc-sim-receive"
            onClick={onSimulateReceive}
            className="mt-4 w-full rounded-[12px] border border-dashed border-black/20 px-4 py-3 text-[14px] text-black/45 active:bg-black/[0.03] dark:border-white/20 dark:text-white/45 dark:active:bg-white/[0.06]"
          >
            让好友在聊天中发我一张亲属卡（点卡片领取）
          </button>
        )}
        <button
          type="button"
          data-testid="wx-fc-add-row"
          onClick={onAdd}
          className="mt-3 flex w-full items-center rounded-[12px] bg-white px-4 py-4 text-left text-[17px] active:bg-black/[0.03] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
        >
          <span className="flex-1">赠送亲属卡</span>
          <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
        </button>
        <div className="mt-10 text-center">
          <button type="button" onClick={() => onToast('客服中心暂未开放')} className="text-[14px] text-[#576B95] active:opacity-60">
            客服中心
          </button>
        </div>
      </div>
      {unbind && (
        <ActionSheet
          actions={[
            {
              label: `解除 ${unbind.friendName}（${unbind.relation}）的亲属卡`,
              danger: true,
              onClick: () => {
                onUnbind(unbind.id);
                setUnbind(null);
                onToast('已解除亲属卡');
              },
            },
          ]}
          onClose={() => setUnbind(null)}
        />
      )}
      {unbindIn && (
        <ActionSheet
          actions={[
            {
              label: `退还并解除 ${unbindIn.fromName}（${unbindIn.relation}）送的亲属卡`,
              danger: true,
              onClick: () => {
                onUnbindReceived(unbindIn.id);
                setUnbindIn(null);
                onToast('已退还并解除亲属卡');
              },
            },
          ]}
          onClose={() => setUnbindIn(null)}
        />
      )}
      {payIn && (
        <FcPaySheet
          card={payIn}
          myRealName={myRealName}
          onDone={() => {
            setPayIn(null);
            onPaid();
          }}
          onClose={() => setPayIn(null)}
          onToast={onToast}
        />
      )}
      {ledgerIn && <FcLedgerSheet card={ledgerIn} onClose={() => setLedgerIn(null)} />}
    </div>
  );
}

/** 输入行统一样式（付款弹层用） */
const FC_PAY_INPUT_CLS =
  'w-full rounded-[8px] bg-white px-3 py-2.5 text-[16px] outline-none placeholder:text-black/25 dark:bg-[#2A2A2A] dark:placeholder:text-white/25';

/**
 * 亲属卡付款（商户消费）弹层：用收到的亲属卡向商户付款 →
 * wxExecutePayment 扣款（亲属卡额度）→ 消费流水 + 赠卡人记忆碎片（recordFcSpend）
 * + 赠卡人聊天内通知行（appendWxChatMsg，持久化）。绝不触发 AI 回合（不跟发消息）。
 */
function FcPaySheet({
  card,
  myRealName,
  onDone,
  onClose,
  onToast,
}: {
  card: WxFamilyCardIn;
  myRealName: string;
  onDone: () => void;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const remain = Math.max(0, card.monthlyLimit - card.used);
  const submit = () => {
    const m = merchant.trim().slice(0, 30);
    const n = Math.round(Number(amount) * 100) / 100;
    if (!m) {
      onToast('请填写商户名');
      return;
    }
    if (!amount || Number.isNaN(n) || n <= 0) {
      onToast('请输入正确的金额');
      return;
    }
    if (n > remain) {
      onToast('亲属卡本月额度不足');
      return;
    }
    // 支付方式行的 methodId 就是卡自身 id（claimFamily 生成的 id 已带 fcin- 前缀），不可再拼前缀
    const pay = wxExecutePayment(card.id, n, '亲属卡付款');
    if (!pay || !pay.fc) {
      onToast('亲属卡本月额度不足');
      return;
    }
    recordFcSpend({ total: n, scene: '亲属卡付款', where: `在「${m}」的消费`, note: note.trim() || undefined, parts: pay.fc.parts, ownerName: myRealName });
    if (card.friendId) {
      // 赠卡人聊天里也能看到这条消费记录（系统通知行，持久化；不触发 AI 回合）
      appendWxChatMsg(card.friendId, {
        id: uid(),
        role: 'peer',
        content: '',
        time: Date.now(),
        kind: 'notice',
        notice: { icon: 'fam', pre: `你用${card.fromName}送的亲属卡在「${m}」消费`, accent: `¥${fmtMoney(n)}` },
      });
    }
    onToast('付款成功');
    onDone();
  };
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end bg-black/45" onClick={onClose} data-testid="wx-fc-pay-sheet">
      <div className="rounded-t-[14px] bg-[#EDEDED] px-4 pb-8 pt-4 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()}>
        <p className="pb-3 text-center text-[17px]">亲属卡付款</p>
        <p className="pb-3 text-center text-[13px] text-black/45 dark:text-white/45">
          {card.fromName}（{card.relation}）· 本月剩余 ¥{fmtMoney(remain)}
        </p>
        <div className="space-y-2">
          <input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="商户名（如：肯德基）"
            maxLength={30}
            className={FC_PAY_INPUT_CLS}
            data-testid="wx-fc-pay-merchant"
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="金额（元）"
            inputMode="decimal"
            className={FC_PAY_INPUT_CLS}
            data-testid="wx-fc-pay-amount"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="备注（选填）"
            maxLength={40}
            className={FC_PAY_INPUT_CLS}
            data-testid="wx-fc-pay-note"
          />
        </div>
        <button
          type="button"
          data-testid="wx-fc-pay-submit"
          onClick={submit}
          className="mt-4 h-12 w-full rounded-[8px] bg-[#07C160] text-[17px] text-white active:opacity-80"
        >
          付款
        </button>
      </div>
    </div>
  );
}

/** 消费记录弹层：该赠卡人名下的亲属卡消费流水（金额/花在哪/备注/时间；kv 持久化，重启后仍在） */
function FcLedgerSheet({ card, onClose }: { card: WxFamilyCardIn; onClose: () => void }) {
  const recs = loadFcLedger().filter((r) =>
    r.giverId ? r.giverId === card.friendId : r.cardInId ? r.cardInId === card.id : r.giverName === card.fromName
  );
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end bg-black/45" onClick={onClose} data-testid="wx-fc-ledger-sheet">
      <div className="max-h-[72%] overflow-hidden rounded-t-[14px] bg-[#EDEDED] pb-6 pt-4 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()}>
        <p className="pb-1 text-center text-[17px]">消费记录</p>
        <p className="pb-3 text-center text-[13px] text-black/45 dark:text-white/45">
          {card.fromName}（{card.relation}）送的亲属卡
        </p>
        {recs.length === 0 ? (
          <p className="py-10 text-center text-[14px] text-black/35 dark:text-white/35" data-testid="wx-fc-ledger-empty">
            暂无消费记录
          </p>
        ) : (
          <div className="max-h-[52vh] overflow-y-auto px-4">
            {recs.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 border-b border-black/[0.05] py-3 last:border-0 dark:border-white/[0.06]">
                <div className="min-w-0">
                  <p className="truncate text-[15px]">
                    {r.where}
                    {r.note ? <span className="text-black/40 dark:text-white/40">（{r.note}）</span> : null}
                  </p>
                  <p className="mt-0.5 text-[12px] text-black/35 dark:text-white/35">{fmtBillTime(r.ts)}</p>
                </div>
                <span className="shrink-0 text-[16px] font-medium">¥{fmtMoney(r.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- 页面栈 ----------------

type View = 'home' | 'wallet' | 'change' | 'changeDetail' | 'lcq' | 'cards' | 'cardDetail' | 'fcIntro' | 'fcPick' | 'fcSetup' | 'fcManage' | 'paySettings' | 'bill' | 'billStats';

export function WxServices({ friends, myRealName, onExit }: { friends: ContactRecord[]; myRealName: string; onExit: () => void }) {
  const [view, setView] = useState<View>('home');
  const [wallet, setWallet] = useState(() => loadWallet());
  const [cards, setCards] = useState(() => loadCards());
  const [bills, setBills] = useState(() => loadBills());
  const [familyCards, setFamilyCards] = useState(() => loadFamilyCards());
  /** 我收到的亲属卡（可用于发红包/转账支付；挂载时先做跨月惰性重置，亲属卡页「本月剩余」即本月真实额度） */
  const [familyIn, setFamilyIn] = useState(() => resetFamilyCardsInMonth());
  // 零钱通：挂载时惰性结算每日收益（同日幂等）
  const [lcq, setLcq] = useState(() => {
    const settled = settleLcq(loadLcq(), earliestBuyDay(loadBills()));
    saveJSON(LS_LCQ, settled);
    return settled;
  });
  /** 零钱明细返回目标（从零钱 / 零钱通都可进入） */
  const [detailFrom, setDetailFrom] = useState<View>('change');
  /** 充值 / 提现 / 转入 / 转出弹层 */
  const [moneySheet, setMoneySheet] = useState<'recharge' | 'withdraw' | 'lcqIn' | 'lcqOut' | null>(null);
  /** 充值 / 提现选中的银行卡 */
  const [payCardId, setPayCardId] = useState<string | null>(null);
  const [cardPickOpen, setCardPickOpen] = useState(false);
  /** 亲属卡赠送流程 */
  const [fcFriend, setFcFriend] = useState<ContactRecord | null>(null);
  const [fcRelation, setFcRelation] = useState('');
  /** 银行卡详情页当前卡 */
  const [detailCardId, setDetailCardId] = useState<string | null>(null);

  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1600);
  };

  // #4（audit3-wx）：钱包页 React state 只是打开页面那一刻的快照，后台回合（AI 领取/退款/24h 过期
  // 清算、聊天里发红包/转账扣款）随时经 wxPatchBalance/wxPushBill/wxExecutePayment 直写存储。
  // 三个提交入口改为「重读存储现值 → 应用本次增量 → 持久化」的读改写合并（与 wxPatchBalance/
  // wxPushBill 同口径）——不再以快照整表覆盖，后台新增的退款/账单/银行卡变动不被旧快照吞掉。
  const commitWalletDelta = (delta: number): boolean => {
    const next = Math.round((loadWallet().balance + delta) * 100) / 100;
    if (next < 0) return false; // 与 wxPatchBalance 同款不足拦截：快照预检与提交之间余额可能已被后台变动
    const nextWallet = { balance: next };
    setWallet(nextWallet);
    saveJSON(LS_WALLET, nextWallet);
    return true;
  };
  const commitCards = (updater: (list: WxCard[]) => WxCard[]) => {
    const next = updater(loadCards());
    setCards(next);
    saveJSON(LS_CARDS, next);
  };
  const pushBill = (kind: WxBill['kind'], amount: number) => {
    // 账单以存储现值为基准前插（快照里没有后台新账单，基于快照拼接会吞掉它们）；展示态保留全量、落盘截断 100 条
    const next = [{ id: uid(), kind, amount, time: Date.now() }, ...loadBills()];
    setBills(next);
    saveJSON(LS_BILLS, next.slice(0, 100));
  };
  const commitLcq = (next: WxLcq) => {
    setLcq(next);
    saveJSON(LS_LCQ, next);
  };
  const commitFamily = (updater: (list: WxFamilyCard[]) => WxFamilyCard[]) => {
    // 审计4-L3：以存储现值为基准读改写（与 commitCards/commitWalletDelta 同口径）——后台
    // wxApplyAiActions 随时直写 LS_FC（AI 领取/退回把卡置 active/returned），以页面快照整表
    // 覆盖会把后台状态变更回退；各调用点变更语义不变，只换基准数据来源
    const next = updater(loadFamilyCards());
    setFamilyCards(next);
    saveJSON(LS_FC, next);
  };

  const payCard = cards.find((c) => c.id === (payCardId ?? cards[0]?.id)) ?? null;
  /** 银行卡详情页当前卡（解绑/返回后 detailCardId 置空避免悬挂） */
  const detailCard = view === 'cardDetail' ? cards.find((c) => c.id === detailCardId) ?? null : null;

  const openMoneySheet = (s: 'recharge' | 'withdraw' | 'lcqIn' | 'lcqOut') => {
    if ((s === 'recharge' || s === 'withdraw') && cards.length === 0) {
      showToast('请先添加银行卡');
      setView('cards');
      return;
    }
    if (s === 'lcqOut' && lcq.balance <= 0) {
      showToast('零钱通余额不足');
      return;
    }
    if (s === 'withdraw' && wallet.balance <= 0) {
      showToast('零钱余额不足');
      return;
    }
    if (s === 'lcqIn' && wallet.balance <= 0) {
      showToast('零钱余额不足，请先充值');
      return;
    }
    setPayCardId(cards[0]?.id ?? null);
    setMoneySheet(s);
  };

  const doRecharge = (amount: number) => {
    if (!payCard) return;
    if (payCard.balance < amount) {
      showToast('银行卡余额不足');
      return;
    }
    commitCards((list) => list.map((c) => (c.id === payCard.id ? { ...c, balance: Math.round((c.balance - amount) * 100) / 100 } : c)));
    commitWalletDelta(amount);
    pushBill('充值', amount);
    setMoneySheet(null);
    showToast('充值成功');
  };

  const doWithdraw = (amount: number) => {
    if (!payCard) return;
    if (wallet.balance < amount) {
      showToast('零钱余额不足');
      return;
    }
    // 先扣零钱（以存储现值为基准，不足即拦）再回填银行卡：避免先回填后扣款失败的资金不一致
    if (!commitWalletDelta(-amount)) {
      showToast('零钱余额不足');
      return;
    }
    commitCards((list) => list.map((c) => (c.id === payCard.id ? { ...c, balance: Math.round((c.balance + amount) * 100) / 100 } : c)));
    pushBill('提现', -amount);
    setMoneySheet(null);
    showToast('提现成功，已到账银行卡');
  };

  const doLcqIn = (amount: number) => {
    if (wallet.balance < amount) {
      showToast('零钱余额不足');
      return;
    }
    // 审计4-M3：对齐 doWithdraw——先扣零钱（以存储现值为基准，不足即拦）再入账零钱通；
    // commitWalletDelta 返回 false 说明快照预检与提交之间零钱已被后台变动（聊天发红包/转账扣款等），
    // 中止：不入账零钱通、不写账单、不关弹层（旧实现忽略失败返回 → 零钱通凭空入账 + 假成功提示）
    if (!commitWalletDelta(-amount)) {
      showToast('零钱余额不足');
      return;
    }
    commitLcq({ ...lcq, balance: Math.round((lcq.balance + amount) * 100) / 100 });
    pushBill('转入零钱通', -amount);
    setMoneySheet(null);
    showToast('已转入零钱通');
  };

  const doLcqOut = (amount: number) => {
    if (lcq.balance < amount) {
      showToast('零钱通余额不足');
      return;
    }
    commitLcq({ ...lcq, balance: Math.round((lcq.balance - amount) * 100) / 100 });
    commitWalletDelta(amount);
    pushBill('零钱通转出', amount);
    setMoneySheet(null);
    showToast('已转出到零钱');
  };

  /** 付款方式行（充值 / 提现弹层用） */
  const payRow = payCard && (
    <button
      type="button"
      data-testid="wx-pay-card-row"
      onClick={() => setCardPickOpen(true)}
      className="mt-3 flex w-full items-center gap-2.5 rounded-[8px] bg-black/[0.03] px-3 py-2.5 text-left active:bg-black/[0.06] dark:bg-white/[0.06] dark:active:bg-white/[0.1]"
    >
      <BankDot bank={payCard.bank} size={26} />
      <span className="flex-1 text-[14px] text-black dark:text-white">
        {payCard.bank}（尾号{payCard.tail}）
      </span>
      <span className="text-[12px] text-black/40 dark:text-white/40">可用 {fmtMoney(payCard.balance)}</span>
      <ChevronRight className="h-4 w-4 text-black/30 dark:text-white/30" strokeWidth={2} />
    </button>
  );

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#EDEDED] dark:bg-[#111111]">
      {view === 'home' && (
        <ServicesHome
          balance={wallet.balance}
          onExit={onExit}
          onOpen={(v) => setView(v)}
          onToast={showToast}
        />
      )}
      {view === 'wallet' && (
        <WalletPage
          balance={wallet.balance}
          cards={cards}
          familyCards={familyCards}
          familyInCount={familyIn.length}
          onBack={() => setView('home')}
          onOpen={(v) => setView(v)}
          onToast={showToast}
        />
      )}
      {view === 'change' && (
        <ChangePage
          balance={wallet.balance}
          onBack={() => setView('wallet')}
          onOpenDetail={() => {
            setDetailFrom('change');
            setView('changeDetail');
          }}
          onRecharge={() => openMoneySheet('recharge')}
          onWithdraw={() => openMoneySheet('withdraw')}
          onToast={showToast}
        />
      )}
      {view === 'changeDetail' && <ChangeDetailPage bills={bills} onBack={() => setView(detailFrom)} />}
      {view === 'bill' && <WxBillPage bills={bills} onToast={showToast} onClose={() => setView('wallet')} onOpenStats={() => setView('billStats')} />}
      {view === 'billStats' && <WxBillStatsPage bills={bills} onToast={showToast} onClose={() => setView('bill')} />}
      {view === 'lcq' && (
        <ChangePlusPage
          lcq={lcq}
          onBack={() => setView('home')}
          onOpenDetail={() => {
            setDetailFrom('lcq');
            setView('changeDetail');
          }}
          onTransferIn={() => openMoneySheet('lcqIn')}
          onTransferOut={() => openMoneySheet('lcqOut')}
          onToast={showToast}
        />
      )}
      {view === 'cards' && (
        <BankCardsPage
          cards={cards}
          myRealName={myRealName}
          onBack={() => setView('wallet')}
          onAdd={(c) => {
            commitCards((list) => [...list, { id: uid(), bank: c.bank, no: c.no, tail: c.tail, holder: c.holder, balance: c.balance, createdAt: Date.now() }]);
          }}
          onOpenCard={(c) => {
            setDetailCardId(c.id);
            setView('cardDetail');
          }}
          onToast={showToast}
        />
      )}
      {view === 'cardDetail' && detailCard && (
        <WxCardDetailPage
          card={detailCard}
          onBack={() => setView('cards')}
          onUnbind={() => {
            commitCards((list) => list.filter((x) => x.id !== detailCard.id));
            showToast('已解除绑定');
            setView('cards');
          }}
          onToast={showToast}
        />
      )}
      {view === 'fcIntro' && (
        <FamilyIntroPage
          onBack={() => setView('wallet')}
          onGo={() => {
            if (friends.length === 0) {
              showToast('还没有好友可以赠送');
              return;
            }
            setView('fcPick');
          }}
          onToast={showToast}
        />
      )}
      {view === 'fcPick' && (
        <FamilyPickPage
          friends={friends}
          onBack={() => setView('fcIntro')}
          onPicked={(f, r) => {
            setFcFriend(f);
            setFcRelation(r);
            setView('fcSetup');
          }}
        />
      )}
      {view === 'fcSetup' && fcFriend && (
        <FamilySetupPage
          friend={fcFriend}
          relation={fcRelation}
          onBack={() => setView('fcPick')}
          onGift={(amount, message) => {
            // 审计4-L4：卡消息 id 先生成、同时记入钱包卡 msgId（同 WxFamilyCardIn 口径）——
            // 聊天侧详情页改额度/后续定位单卡可按消息 id 精确匹配，不再依赖 friendId 连改
            const giftMsgId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
            const card: WxFamilyCard = {
              id: uid(),
              friendId: fcFriend.id,
              friendName: fcFriend.name,
              friendAvatar: fcFriend.avatar,
              relation: fcRelation,
              monthlyLimit: amount,
              used: 0,
              status: 'pending',
              message,
              createdAt: Date.now(),
              msgId: giftMsgId,
            };
            commitFamily((list) => [card, ...list]);
            // 同步向与该好友的微信聊天发送一张亲属卡卡片消息（待对方领取；cid 供 AI 动作标记引用）
            appendWxChatMsg(fcFriend.id, {
              id: giftMsgId,
              role: 'me',
              content: '',
              time: Date.now(),
              kind: 'family',
              fam: { monthlyLimit: amount, relation: fcRelation, message, claimed: false, used: 0, method: '零钱', cid: `fam-${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-3)}` },
            });
            showToast('亲属卡已发送到聊天，等待对方领取');
            setView('fcManage');
          }}
          onToast={showToast}
        />
      )}
      {view === 'fcManage' && (
        <FamilyManagePage
          cards={familyCards}
          received={familyIn}
          myRealName={myRealName}
          onPaid={() => setFamilyIn(resetFamilyCardsInMonth())}
          onBack={() => setView('wallet')}
          onUnbind={(id) => commitFamily((list) => list.filter((c) => c.id !== id))}
          onUnbindReceived={(id) => {
            // 解除收到的亲属卡：从列表移除 + 同步把对应聊天卡片标记已退回（卡片变灰、状态行显示已退回）+ 追加通知行
            const card = familyIn.find((c) => c.id === id);
            const next = familyIn.filter((c) => c.id !== id);
            setFamilyIn(next);
            saveFamilyCardsIn(next);
            if (card?.friendId) {
              try {
                const parsed: unknown = kvGet<unknown[]>(WX_LS_MSGS_PREFIX + card.friendId);
                if (Array.isArray(parsed)) {
                  const msgs = parsed as Array<Record<string, unknown>>;
                  const fam = card;
                  let nowTs = Date.now();
                  const updated = msgs.map((m) => {
                    const f = m.fam as Record<string, unknown> | undefined;
                    if (m.kind !== 'family' || !f || f.claimed !== true || f.rejected) return m;
                    // #22：领取时记录了来源卡消息 id → 按消息精确反查（同一联系人多张同额度卡不再误标其余卡）；
                    // 旧数据无 msgId 时退回「同额度+已领取」启发式（原口径）
                    const matched = fam.msgId ? m.id === fam.msgId : f.monthlyLimit === fam.monthlyLimit;
                    if (!matched) return m;
                    nowTs += 1;
                    return { ...m, fam: { ...f, rejected: true } };
                  });
                  updated.push({
                    id: `${nowTs.toString(36)}-notice`,
                    role: 'peer',
                    content: '',
                    time: nowTs,
                    kind: 'notice',
                    notice: { icon: 'fam', pre: '你退回了', accent: '亲属卡' },
                  });
                  kvSet(WX_LS_MSGS_PREFIX + card.friendId, updated);
                }
              } catch {
                // 同步失败不影响解除本身
              }
            }
          }}
          onSimulateReceive={() => {
            const from = friends.find((f) => f.kind === 'char') ?? friends[0];
            if (!from) {
              showToast('还没有好友可以赠送亲属卡');
              return;
            }
            // 改为聊天链路：好友在聊天中发来一张待领取的亲属卡卡片，点卡片领取后进入「我收到的亲属卡」
            appendWxChatMsg(from.id, {
              id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
              role: 'peer',
              content: '',
              time: Date.now(),
              kind: 'family',
              fam: { monthlyLimit: 3000, relation: '女朋友', message: '我为你准备了亲属卡，你消费我买单', claimed: false, used: 0, method: '零钱' },
            });
            showToast(`${from.name}给你发来一张亲属卡，去聊天中领取`);
          }}
          onAdd={() => {
            if (friends.length === 0) {
              showToast('还没有好友可以赠送');
              return;
            }
            setView('fcPick');
          }}
          onToast={showToast}
        />
      )}

      {view === 'paySettings' && <WxPaySettingsPage onBack={() => setView('wallet')} onToast={showToast} />}

      {/* 金额弹层（充值 / 提现 / 转入 / 转出） */}
      {moneySheet === 'recharge' && (
        <AmountPadSheet title="充值" note="从银行卡转入零钱" submitLabel="充值" submitTestId="wx-recharge-confirm" onSubmit={doRecharge} onClose={() => setMoneySheet(null)}>
          {payRow}
        </AmountPadSheet>
      )}
      {moneySheet === 'withdraw' && (
        <AmountPadSheet title="提现" note="到账银行卡" submitLabel="提现" submitTestId="wx-withdraw-confirm" onSubmit={doWithdraw} onClose={() => setMoneySheet(null)}>
          {payRow}
        </AmountPadSheet>
      )}
      {moneySheet === 'lcqIn' && (
        <AmountPadSheet title="转入" note="从零钱转入零钱通" submitLabel="转入" submitTestId="wx-lcqin-confirm" onSubmit={doLcqIn} onClose={() => setMoneySheet(null)} />
      )}
      {moneySheet === 'lcqOut' && (
        <AmountPadSheet title="转出" note="转出到零钱，秒到账" submitLabel="转出" submitTestId="wx-lcqout-confirm" onSubmit={doLcqOut} onClose={() => setMoneySheet(null)} />
      )}

      {/* 银行卡选择浮层（充值 / 提现） */}
      {cardPickOpen && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end" data-testid="wx-card-pick">
          <button type="button" aria-label="取消" onClick={() => setCardPickOpen(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative mx-3 mb-6 rounded-[12px] bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))] dark:bg-[#242424]">
            <p className="mb-3 text-center text-[15px] font-medium text-black dark:text-white">选择银行卡</p>
            <div className="space-y-1">
              {cards.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setPayCardId(c.id);
                    setCardPickOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-[8px] px-2 py-2.5 text-left active:bg-black/[0.05] dark:active:bg-white/[0.08]"
                >
                  <BankDot bank={c.bank} size={30} />
                  <span className="flex-1 text-[15px] text-black dark:text-white">
                    {c.bank}（尾号{c.tail}）
                  </span>
                  {payCard?.id === c.id && <Check className="h-5 w-5 text-[#07C160]" strokeWidth={2.4} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2 rounded-[8px] bg-black/75 px-4 py-2.5 text-[14px] text-white">
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------- 支付设置 / 支付密码（发红包/转账支付验证；微信风格 6 位自绘键盘） ----------------

interface WxPayPwdData {
  enabled: boolean;
  /** 6 位数字密码（仅本机 IndexedDB 加密存储之外的本机保存，不外传） */
  pwd: string | null;
}

export const WX_LS_PAY_PWD = 'wx-pay-pwd';

// #48：支付密码暴力试错保护——失败次数与锁定到期时间戳（5 次失败 30s 锁定），存 localStorage 跨组件共享
export const WX_LS_PAY_PWD_LOCK = 'wx-pay-pwd-lock';
export const WX_PAY_PWD_MAX_FAIL = 5;
export const WX_PAY_PWD_LOCK_MS = 30 * 1000;

interface WxPayPwdLockData {
  /** 累计失败次数（成功后清零） */
  fails: number;
  /** 锁定到期时间戳（Date.now() + LOCK_MS）；未锁定时为 0 */
  lockedUntil: number;
}

export function wxLoadPayPwdLock(): WxPayPwdLockData {
  try {
    const raw = window.localStorage.getItem(WX_LS_PAY_PWD_LOCK);
    if (!raw) return { fails: 0, lockedUntil: 0 };
    const p = JSON.parse(raw) as Partial<WxPayPwdLockData>;
    return {
      fails: typeof p.fails === 'number' && p.fails >= 0 ? p.fails : 0,
      lockedUntil: typeof p.lockedUntil === 'number' && p.lockedUntil > 0 ? p.lockedUntil : 0,
    };
  } catch {
    return { fails: 0, lockedUntil: 0 };
  }
}

export function wxSavePayPwdLock(d: WxPayPwdLockData): void {
  try {
    window.localStorage.setItem(WX_LS_PAY_PWD_LOCK, JSON.stringify(d));
  } catch {
    // 忽略
  }
}

/** 清零失败次数与锁定（成功支付 / 修改密码成功 / 关闭支付密码时调用） */
export function wxClearPayPwdLock(): void {
  wxSavePayPwdLock({ fails: 0, lockedUntil: 0 });
}

/** 记录一次失败：累加 fails，达到 5 次设 lockedUntil = now + 30s；返回更新后的状态 */
export function wxRecordPayPwdFail(): WxPayPwdLockData {
  const cur = wxLoadPayPwdLock();
  const fails = cur.fails + 1;
  const lockedUntil = fails >= WX_PAY_PWD_MAX_FAIL ? Date.now() + WX_PAY_PWD_LOCK_MS : cur.lockedUntil;
  const next = { fails, lockedUntil };
  wxSavePayPwdLock(next);
  return next;
}

export function wxLoadPayPwd(): WxPayPwdData {
  try {
    const p: unknown = kvGet(WX_LS_PAY_PWD);
    if (p && typeof p === 'object') {
      const d = p as Partial<WxPayPwdData>;
      const pwd = typeof d.pwd === 'string' && /^\d{6}$/.test(d.pwd) ? d.pwd : null;
      return { enabled: d.enabled === true && pwd !== null, pwd };
    }
  } catch {
    // 忽略
  }
  return { enabled: false, pwd: null };
}

export function wxSavePayPwd(d: WxPayPwdData): void {
  saveJSON(WX_LS_PAY_PWD, d);
}

/** 微信风格 6 位支付密码自绘数字键盘（不唤起系统键盘；校验由父级完成，errorKey 变化时父级重挂载 → 清空并抖动） */
export function WxPwdSheet({
  title,
  sub,
  hint,
  errorKey,
  locked = false,
  onComplete,
  onClose,
}: {
  title: string;
  sub?: string;
  hint?: string;
  errorKey: number;
  /** #48：锁定期间禁用输入（键位 click 失效、视觉灰显） */
  locked?: boolean;
  onComplete: (pwd: string) => void;
  onClose: () => void;
}) {
  const [digits, setDigits] = useState('');
  // 用 ref 累加避免同一 tick 内连点被 React 批处理吞掉（每次 push 都基于最新串）
  const acc = useRef('');
  const push = (d: string) => {
    if (locked) return;
    const next = (acc.current + d).slice(0, 6);
    acc.current = next;
    setDigits(next);
    if (next.length === 6) {
      const done = next;
      acc.current = '';
      window.setTimeout(() => onComplete(done), 150);
    }
  };
  const keyBtn =
    'flex h-[52px] items-center justify-center bg-white text-[22px] font-medium text-black active:bg-black/[0.07] dark:bg-[#1E1E1E] dark:text-white dark:active:bg-white/10';
  const keyBtnLocked =
    'flex h-[52px] items-center justify-center bg-white/60 text-[22px] font-medium text-black/30 dark:bg-[#1E1E1E]/60 dark:text-white/30';
  return (
    <div className="rounded-t-[18px] bg-[#F7F7F7] pb-7 dark:bg-[#1B1B1B]" onClick={(e) => e.stopPropagation()} data-testid="wx-keypad">
      <style>{'@keyframes wxShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(4px)}}'}</style>
      <div className="relative flex h-12 items-center justify-center border-b border-black/[0.06] dark:border-white/[0.08]">
        <button
          type="button"
          aria-label="关闭"
          data-testid="wx-keypad-close"
          onClick={onClose}
          disabled={locked}
          className="absolute left-3 grid h-8 w-8 place-items-center rounded-full text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10 disabled:opacity-40"
        >
          <X className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <p className="text-[16px] font-medium text-black dark:text-white">{title}</p>
      </div>
      {sub ? <p className="pb-1 pt-2 text-center text-[13px] text-black/45 dark:text-white/45">{sub}</p> : null}
      <div className="mx-auto mt-2 flex w-fit gap-2.5" style={errorKey > 0 ? { animation: 'wxShake 0.46s' } : undefined}>
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className="grid h-11 w-10 place-items-center rounded-[6px] border border-black/15 bg-white dark:border-white/20 dark:bg-white/[0.06]"
            aria-hidden="true"
          >
            {i < digits.length ? <span className="h-2.5 w-2.5 rounded-full bg-black dark:bg-white" /> : null}
          </span>
        ))}
      </div>
      <p className="mt-2 h-5 text-center text-[13px] text-[#FA5151]" aria-live="polite">
        {hint ?? ''}
      </p>
      <div className="grid grid-cols-3 gap-[1px] border-t border-black/10 bg-black/10 dark:border-white/10 dark:bg-white/10">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} type="button" data-testid={`wx-keypad-${k}`} onClick={() => push(k)} disabled={locked} className={locked ? keyBtnLocked : keyBtn}>
            {k}
          </button>
        ))}
        <span className="bg-white dark:bg-[#1E1E1E]" aria-hidden="true" />
        <button type="button" data-testid="wx-keypad-0" onClick={() => push('0')} disabled={locked} className={locked ? keyBtnLocked : keyBtn}>
          0
        </button>
        <button
          type="button"
          aria-label="删除"
          data-testid="wx-keypad-del"
          disabled={locked}
          onClick={() => { acc.current = acc.current.slice(0, -1); setDigits(acc.current); }}
          className={locked ? keyBtnLocked : keyBtn}
        >
          <Delete className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** 支付密码验证浮层（发红包/转账支付前调用；正确回调 onOk，错误清空重输）。
 *  #48：5 次失败 30s 锁定——锁定期间禁用输入并显示倒计时，防止暴力试错 */
export function WxPayPwdGate({ label, onOk, onClose }: { label: string; onOk: () => void; onClose: () => void }) {
  const [errKey, setErrKey] = useState(0);
  const [lock, setLock] = useState<WxPayPwdLockData>(() => wxLoadPayPwdLock());
  // 倒计时（秒）：每秒刷新一次让 UI 显示剩余时间
  const [remainSec, setRemainSec] = useState(0);
  useEffect(() => {
    if (lock.lockedUntil <= 0) return;
    const tick = () => {
      const remain = Math.max(0, Math.ceil((lock.lockedUntil - Date.now()) / 1000));
      setRemainSec(remain);
      if (remain <= 0) {
        // 锁到期：清掉 lockedUntil（fails 也一并清零，给用户重新试的机会）
        const cleared = { fails: 0, lockedUntil: 0 };
        wxSavePayPwdLock(cleared);
        setLock(cleared);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lock.lockedUntil]);
  const isLocked = lock.lockedUntil > 0 && Date.now() < lock.lockedUntil;
  return (
    <div className="absolute inset-0 z-[60] flex flex-col justify-end bg-black/60" role="dialog" aria-label="验证支付密码" onClick={isLocked ? undefined : onClose}>
      <WxPwdSheet
        key={errKey}
        title="请输入支付密码"
        sub={label}
        hint={isLocked ? `密码错误次数过多，请 ${remainSec} 秒后再试` : errKey > 0 ? `密码错误，请重新输入${lock.fails > 0 ? `（已失败 ${lock.fails} 次，5 次后将锁定 30 秒）` : ''}` : undefined}
        errorKey={errKey}
        locked={isLocked}
        onClose={onClose}
        onComplete={(pwd) => {
          if (isLocked) return;
          const d = wxLoadPayPwd();
          if (d.pwd && pwd === d.pwd) {
            wxClearPayPwdLock();
            onOk();
          } else {
            const next = wxRecordPayPwdFail();
            setLock(next);
            setErrKey((k) => k + 1);
          }
        }}
      />
    </div>
  );
}

/** 支付设置页（支付密码开启/关闭/修改；微信风格自绘 6 位数字键盘） */
function WxPaySettingsPage({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const [data, setData] = useState(() => wxLoadPayPwd());
  const [flow, setFlow] = useState<null | { mode: 'set' | 'confirm' | 'verify-off' | 'verify-change'; first?: string }>(null);
  const [errKey, setErrKey] = useState(0);
  // #100 锁定状态（verify-off/verify-change 失败累加，成功清零；5 次 30s 锁定，对称 QQ #97）
  const [lock, setLock] = useState<WxPayPwdLockData>(() => wxLoadPayPwdLock());
  const [remainSec, setRemainSec] = useState(0);
  useEffect(() => {
    if (lock.lockedUntil <= 0) return;
    const tick = () => {
      const remain = Math.max(0, Math.ceil((lock.lockedUntil - Date.now()) / 1000));
      setRemainSec(remain);
      if (remain <= 0) {
        const cleared = { fails: 0, lockedUntil: 0 };
        wxSavePayPwdLock(cleared);
        setLock(cleared);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lock.lockedUntil]);
  const isLocked = lock.lockedUntil > 0 && Date.now() < lock.lockedUntil;
  const enabled = data.enabled && !!data.pwd;
  const meta = flow
    ? flow.mode === 'set'
      ? { title: '设置支付密码', sub: '请输入 6 位数字' }
      : flow.mode === 'confirm'
        ? { title: '确认支付密码', sub: '请再次输入' }
        : flow.mode === 'verify-off'
          ? { title: '关闭支付密码', sub: '验证后即可关闭' }
          : { title: '修改支付密码', sub: '请输入原支付密码' }
    : null;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-pay-settings">
      <WxNav title="支付设置" onBack={onBack} testId="wx-pay-settings-back" />
      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        <div className="flex items-start gap-3 rounded-[10px] bg-[#FFF7E8] px-4 py-3.5 text-[13px] leading-relaxed text-[#8A6A3F] dark:bg-[#3A3222]/60 dark:text-[#E3C893]">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0" strokeWidth={1.7} aria-hidden="true" />
          开启后，发红包、转账都需要先验证支付密码
        </div>
        <div className="mt-4 overflow-hidden rounded-[10px] bg-white dark:bg-[#1A1A1A]">
          <div className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[16px]">支付密码</span>
              <span className="mt-0.5 block text-[12px] text-black/40 dark:text-white/40">{enabled ? '已开启 · 支付时需验证' : '未开启'}</span>
            </span>
            <button
              type="button"
              data-testid="wx-pay-toggle"
              aria-label={enabled ? '关闭支付密码' : '开启支付密码'}
              aria-pressed={enabled}
              onClick={() => {
                setErrKey(0);
                setFlow(enabled ? { mode: 'verify-off' } : { mode: 'set' });
              }}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${enabled ? 'bg-[#07C160]' : 'bg-black/20 dark:bg-white/25'}`}
            >
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} aria-hidden="true" />
            </button>
          </div>
          {enabled && (
            <button
              type="button"
              data-testid="wx-pay-change"
              onClick={() => {
                setErrKey(0);
                setFlow({ mode: 'verify-change' });
              }}
              className="relative flex min-h-[52px] w-full items-center px-4 py-2.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.06]"
            >
              <span className="absolute left-4 right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />
              <span className="flex-1 text-[16px]">修改支付密码</span>
              <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
            </button>
          )}
        </div>
        <p className="px-1 pt-4 text-[12px] leading-relaxed text-black/35 dark:text-white/35">支付密码为 6 位数字，仅保存在本机浏览器，用于本机演示支付验证。</p>
      </div>
      {flow && meta ? (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/55" role="dialog" aria-label={meta.title} onClick={() => setFlow(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <WxPwdSheet
              key={`${flow.mode}-${errKey}`}
              title={meta.title}
              sub={meta.sub}
              hint={isLocked ? `密码错误次数过多，请 ${remainSec} 秒后再试` : errKey > 0 ? `密码错误，请重新输入${lock.fails > 0 ? `（已失败 ${lock.fails} 次，5 次后将锁定 30 秒）` : ''}` : undefined}
              errorKey={errKey}
              locked={isLocked}
              onClose={() => setFlow(null)}
              onComplete={(pwd) => {
                if (isLocked) return;
                if (flow.mode === 'set') {
                  setErrKey(0);
                  setFlow({ mode: 'confirm', first: pwd });
                } else if (flow.mode === 'confirm') {
                  if (pwd === flow.first) {
                    wxSavePayPwd({ enabled: true, pwd });
                    setData(wxLoadPayPwd());
                    wxClearPayPwdLock();
                    setFlow(null);
                    onToast('支付密码已开启');
                  } else {
                    onToast('两次输入不一致，请重新设置');
                    setErrKey((k) => k + 1);
                    setFlow({ mode: 'set' });
                  }
                } else if (flow.mode === 'verify-off') {
                  if (pwd === data.pwd) {
                    wxSavePayPwd({ enabled: false, pwd: null });
                    setData(wxLoadPayPwd());
                    wxClearPayPwdLock();
                    setFlow(null);
                    onToast('支付密码已关闭');
                  } else {
                    setLock(wxRecordPayPwdFail());
                    setErrKey((k) => k + 1);
                  }
                } else if (pwd === data.pwd) {
                  setErrKey(0);
                  wxClearPayPwdLock();
                  setFlow({ mode: 'set' });
                } else {
                  setLock(wxRecordPayPwdFail());
                  setErrKey((k) => k + 1);
                }
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
