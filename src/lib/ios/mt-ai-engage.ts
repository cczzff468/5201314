'use client';

/**
 * 美团 × AI 聊天联动引擎（外卖参与 + 双向代付）：
 * - AI 帮机主点外卖：AI 输出 [帮点外卖:商家ID|菜名x数量,...|备注] → 生成「代点草稿卡」
 *   （mt-draft:<id>）落到聊天，机主确认后创建美团待支付订单并跳收银台支付；
 * - AI 请客点外卖：AI 输出 [请客点外卖:商家ID|菜名x数量,...|备注] → 直接下单并由 AI 付款
 *   （mtAiPayPendingOrder，演示语义）→ 以订单分享卡（role peer，角标「X已买单」）发给机主，
 *   机主无需付款，卡片内嵌实时配送状态时间线；
 * - AI 给自己点外卖：AI 输出 [自己点外卖:商家ID|菜名x数量,...] → 创建待支付订单 +
 *   direction 'me' 代付请求（请机主帮付），请求卡落在该角色聊天；
 * - AI 主动帮付：AI 输出 [帮付:订单ID] → 为机主的待支付订单立即代付（direction 'friend'，
 *   完成卡随回复队列投递）；
 * - AI 代付决策：机主发起找人代付后（mtCreateProxyRequest），调度本角色的 LLM 决策——
 *   按人设/记忆/上下文决定是否代付，付则出完成卡+回复，婉拒则只回复；两者都写角色记忆；
 * - 感知注入：buildMtEngageCtx 每回合现场构建【美团外卖动态】（最近订单/待支付订单/
 *   待处理代付请求，状态实时读 kv）与【美团外卖精选】目录（食物话题命中时，按时段加权 B7）
 *   + 动作教学规则；群聊 scope 只下发目录+帮点外卖（C11，草稿由机主确认自付）；
 *   美团未登录+食物话题时注入「先登录」口径（C10）；
 * - 自主开店/补菜（第十三轮用户反馈）：目录里没有想点的店，商家ID直接写店名 → 现场入驻
 *   （ensureMerchantForAi，随 mt-ai-registry 持久化）；菜名没有 → ensureDish 现场上架，
 *   AI 想点的几乎任何东西都能真的点到；
 * - 节流（B6→已废）：原「同角色 5 分钟最多 1 次」的引擎级冷却已按第十三轮用户反馈整体删除
 *   （连点/连请都照办）；金额门槛与同意词表已按用户要求全部取消——请不请/付不付/付多少
 *   全由 AI 按人设/关系/上下文自主拿捉；
 * - 失败反馈（A3）：请客/自己点外卖的商家/菜品/地址问题不再静默——落系统提示行到聊天；
 * - 终态记忆（C9）：订单送达/取消时给参与角色补写事件记忆（买单史/代点史长期可忆）；
 * - 记忆：AI 参与（代付/帮付/代点/请付）的时刻按角色 contactId 直写事件记忆
 *   （memAddEventFragment，sourceTag 防同模板互吞）；普通订单靠动态块实时感知不刷记忆；
 * - 隔离：草稿按美团 uid + 角色双写；记忆按角色 contactId（既有机制）；不涉及真实资金。
 */
import { kvGet, kvSet } from './idb-kv';
import { fireAiProductImg } from './ai-product-img';
import { getContact, listContacts, ownerProfileFor, cachedOwnerName, cachedContactRealName } from './contacts-store';
import { avatarFor, type ContactRecord } from '../contacts';
import { getMemSettings } from '@/lib/memory';
import { getActiveAccountFor, getActiveAccountIdFor, type AccountApp } from './accounts';
import {
  mtGetSession,
  mtUidOf,
  mtLoadOrders,
  mtSaveOrders,
  mtCurAddrId,
  mtLoadAddresses,
  mtCheckoutCalc,
  mtLoadCoupons,
  MT_STATUS_LABEL,
  type MtOrder,
} from './meituan-store';
import { mtAllMerchants, mtMerchantOf, mtDishesOf, mtRegisterAiDish, mtRegisterAiMerchant, type MtDish, type MtMerchant } from './meituan-data';
import {
  mtGetProxy,
  mtProxyChatCid,
  mtPendingProxiesOfChat,
  mtProxyPayOrder,
  mtCreateProxyRequestByChar,
  mtAiPayPendingOrder,
  mtDeclineProxy,
  MT_PROXY_CARD_EVENT,
  type MtProxyCardMsg,
} from './mt-proxy-pay';
import { buildPersonaSystemPrompt } from './persona';
import { memChatRecallBlock, memAddEventFragment } from '@/lib/memory';
import { buildTimeAwareBlock, getTimeAware } from '@/lib/time-aware';
import { pushChatNotification } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { scheduleAiDelivery } from './ai-delivery';
import { useSettings } from './store';
import { mtGetShare, mtCreateOrderShare } from './mt-order-share';
import type { RichAction } from '@/lib/chat-rich';

export type MtEngageApp = 'wx' | 'qq';

// ---------------- 主动参与（第十三轮用户反馈）----------------
// 第十三轮用户反馈：美团参与冷却（原 5min/角色引擎级冷却 MT_ENGAGE_COOLDOWN_MS）整体删除——
// 机主让点/让请/让帮付多少次都照办，与淘宝礼物链路同口径（第十二轮已删），不再有「先歇一歇」拦截。

// ---------------- AI 代点外卖草稿 ----------------

export interface MtDraftItem {
  dishId?: string;
  name: string;
  qty: number;
  price: number;
  emoji?: string;
  img?: string;
}

export interface MtAiDraft {
  id: string;
  /** 美团账号 uid（下单归属） */
  uid: string;
  merchantId: string;
  merchantName: string;
  merchantEmoji: string;
  merchantImg?: string;
  items: MtDraftItem[];
  /** 创建时的预览合计（确认下单时按 mtCheckoutCalc 重算，以订单为准） */
  estimate: number;
  note?: string;
  /** 发起的 AI 角色 */
  charId: string;
  charName: string;
  app: MtEngageApp;
  status: 'pending' | 'confirmed' | 'declined';
  createdAt: number;
  orderId?: string;
  /** 确认下单后的应付金额（与美团订单一致） */
  total?: number;
}

export const MT_DRAFT_EVENT = 'mt-draft-changed';

function genDid(): string {
  return `mtdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function bumpDraftIndex(did: string): void {
  try {
    const idx = kvGet<string[]>('mt-draft-index') ?? [];
    if (!idx.includes(did)) kvSet('mt-draft-index', [...idx, did].slice(-30));
  } catch {
    /* 忽略 */
  }
}

function fireDraftEvent(): void {
  try {
    window.dispatchEvent(new CustomEvent(MT_DRAFT_EVENT));
  } catch {
    /* 忽略 */
  }
}

export function mtGetDraft(did: string): MtAiDraft | null {
  if (!did) return null;
  const d = kvGet<Partial<MtAiDraft>>(`mt-draft:${did}`);
  if (!d || typeof d !== 'object' || typeof d.id !== 'string' || typeof d.merchantId !== 'string') return null;
  return {
    ...d,
    id: d.id,
    uid: typeof d.uid === 'string' ? d.uid : '',
    merchantId: d.merchantId,
    merchantName: typeof d.merchantName === 'string' ? d.merchantName : '美团商家',
    merchantEmoji: typeof d.merchantEmoji === 'string' ? d.merchantEmoji : '🍜',
    merchantImg: typeof d.merchantImg === 'string' ? d.merchantImg : undefined,
    items: Array.isArray(d.items)
      ? (d.items as MtDraftItem[]).filter((i) => i && typeof i.name === 'string').map((i) => ({ ...i, qty: typeof i.qty === 'number' ? i.qty : 1, price: typeof i.price === 'number' ? i.price : 0 }))
      : [],
    estimate: typeof d.estimate === 'number' ? d.estimate : 0,
    note: typeof d.note === 'string' && d.note ? d.note : undefined,
    charId: typeof d.charId === 'string' ? d.charId : '',
    charName: typeof d.charName === 'string' ? d.charName : '好友',
    app: d.app === 'qq' ? 'qq' : 'wx',
    status: d.status === 'confirmed' ? 'confirmed' : d.status === 'declined' ? 'declined' : 'pending',
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
    orderId: typeof d.orderId === 'string' ? d.orderId : undefined,
    total: typeof d.total === 'number' ? d.total : undefined,
  };
}

/** 解析 [帮点外卖/自己点外卖] 标记体：商家ID|菜名x数量,菜名x数量|备注? */
export function parseMtOrderBody(raw: string): { merchantId: string; items: { name: string; qty: number }[]; note?: string } | null {
  const segs = raw.split('|').map((s) => s.trim());
  const merchantId = segs[0] ?? '';
  if (!merchantId) return null;
  const items: { name: string; qty: number }[] = [];
  for (const seg of (segs[1] ?? '').split(/[,，、]/)) {
    const s = seg.trim();
    if (!s) continue;
    const m = /^(.{1,40}?)\s*[xX×*]\s*(\d{1,2})$/.exec(s);
    if (m) {
      const name = m[1].replace(/[xX×*]\s*$/, '').trim();
      if (name) items.push({ name, qty: Math.max(1, Math.min(20, Number(m[2]))) });
    } else {
      items.push({ name: s.replace(/[xX×*]\s*$/, '').trim(), qty: 1 });
    }
  }
  if (items.length === 0) return null;
  const note = segs.slice(2).join('|').trim() || undefined;
  return { merchantId, items, note };
}

/** 菜名 → 菜品（精确 → 包含；均不中返回 null） */
function resolveDish(merchant: MtMerchant, name: string): MtDish | null {
  const all = mtDishesOf(merchant);
  const clean = name.trim();
  if (!clean) return null;
  return all.find((d) => d.name === clean) ?? all.find((d) => d.name.includes(clean) || clean.includes(d.name)) ?? null;
}

// ---------------- AI 自主补菜（Task 26：菜单没有的菜自动创建，不再「代点失败」） ----------------

/** 菜名 → 价格启发式（元）：甜品/蛋糕类偏高，饮品中等，主食/小吃平价，默认 22 */
function guessDishPrice(name: string): number {
  const n = name.toLowerCase();
  if (/蛋糕|慕斯|千层|提拉米苏|舒芙蕾/.test(n)) return 28;
  if (/奶茶|咖啡|果茶|柠檬茶|气泡水|奶昔|圣代/.test(n)) return 16;
  if (/小龙虾|螃蟹|海鲜|和牛|烤鱼/.test(n)) return 58;
  if (/汉堡|炸鸡|披萨|牛排|猪脚饭|烧鹅饭/.test(n)) return 25;
  if (/饭|面|粉|粥|馄饨|饺子|包|麻辣烫|冒菜|螺蛳粉/.test(n)) return 18;
  if (/串|烤|卤味|小龙|凉菜|沙拉|小食|薯条|鸡翅/.test(n)) return 15;
  if (/可乐|雪碧|矿泉水|豆奶|酸奶/.test(n)) return 5;
  return 22;
}

/** 菜名 → emoji 启发式 */
function guessDishEmoji(name: string): string {
  if (/蛋糕|慕斯|千层|提拉米苏|甜点|舒芙蕾/.test(name)) return '🍰';
  if (/奶茶|奶昔/.test(name)) return '🧋';
  if (/咖啡/.test(name)) return '☕';
  if (/汉堡/.test(name)) return '🍔';
  if (/披萨/.test(name)) return '🍕';
  if (/炸鸡|鸡翅|鸡腿/.test(name)) return '🍗';
  if (/面|粉/.test(name)) return '🍜';
  if (/饭|煲/.test(name)) return '🍛';
  if (/粥/.test(name)) return '🥣';
  if (/串|烤/.test(name)) return '🍢';
  if (/火锅|麻辣烫|冒菜|麻辣香锅/.test(name)) return '🍲';
  if (/虾/.test(name)) return '🦐';
  if (/蟹/.test(name)) return '🦀';
  if (/鱼/.test(name)) return '🐟';
  if (/可乐|雪碧|汽水|气泡水/.test(name)) return '🥤';
  if (/果|茶/.test(name)) return '🍹';
  if (/冰淇淋|圣代/.test(name)) return '🍨';
  if (/包|饺|馄饨/.test(name)) return '🥟';
  if (/沙拉/.test(name)) return '🥗';
  if (/薯条/.test(name)) return '🍟';
  return '🍱';
}

/**
 * 菜名 → 菜品（永不失败）：菜单里没有时 AI 自主创建并注册（价格/emoji 按菜名启发式），
 * 下次点同名菜直接命中；菜品随 AI 菜品注册表持久化（kv 'mt-ai-dish-registry'）。
 * 用户诉求：AI 买东西菜单没有时自己添加，而不是报「代点失败」。
 */
function ensureDish(merchant: MtMerchant, name: string): MtDish {
  const found = resolveDish(merchant, name);
  if (found) return found;
  const clean = name.trim().slice(0, 40);
  const dish: MtDish = {
    id: `aidish-${merchant.id.slice(-8)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: clean,
    price: guessDishPrice(clean),
    emoji: guessDishEmoji(clean),
    desc: '店家现做，AI 替你加上架的菜',
    monthSale: 12 + Math.floor(Math.random() * 87),
  };
  mtRegisterAiDish(merchant.id, dish);
  // 第十四轮：AI 自创菜品自动生成写实美食图（设置›图像生成优先，内置服务端兜底；
  // fire-and-forget 不阻塞下单，成功后覆盖管线落库+广播事件，菜单/订单即时换真图）
  try {
    fireAiProductImg('mt-dish', dish.id, clean);
  } catch {
    /* 生图调度失败不影响本次下单 */
  }
  return dish;
}

/** 商家可下单校验（存在 + 未打烊；AI 代点/请客/自己点共用） */
function checkMerchantOrderable(merchant: MtMerchant | undefined): string | null {
  if (!merchant) return null; // 不存在时由调用方各自报错（文案带商家 ID）
  if (merchant.mine && merchant.mtStatus === 'closed') return `「${merchant.name}」已打烊，今天点不了`;
  return null;
}

// ---------------- AI 自主开店（第十三轮用户反馈：目录里没有想点的店，AI 直接写店名 → 现场入驻再下单） ----------------

/** 店名 → emoji 启发式 */
function guessShopEmoji(name: string): string {
  if (/奶茶|茶/.test(name)) return '🧋';
  if (/咖啡/.test(name)) return '☕';
  if (/火锅|麻辣烫|冒菜|香锅/.test(name)) return '🍲';
  if (/面|粉/.test(name)) return '🍜';
  if (/饭|煲|菜馆|小厨|食堂/.test(name)) return '🍛';
  if (/烧烤|烤|串/.test(name)) return '🍢';
  if (/披萨/.test(name)) return '🍕';
  if (/汉堡|炸鸡/.test(name)) return '🍔';
  if (/甜品|蛋糕|烘培|面包/.test(name)) return '🍰';
  if (/粥|早/.test(name)) return '🥣';
  if (/果|鲜/.test(name)) return '🍉';
  if (/药/.test(name)) return '💊';
  return '🍜';
}

/** 标记里的一段是否是「自定义店名」（含中文、去可选 * 前缀后 2~16 字；纯 ASCII 商家 id 不会误伤） */
function customMerchantName(raw: string): string | null {
  const s = raw.trim().replace(/^[*＊]+/, '').trim();
  if (s.length < 2 || s.length > 16) return null;
  if (!/[\u4e00-\u9fff]/.test(s)) return null;
  return s;
}

/**
 * 商家ID/店名 → 商家（目录内命中直接返回；否则若是店名 → AI 自主帮这家店入驻）：
 * 挂进 AI 商家注册表（随 mt-ai-registry 持久化）→ 搜索/首页/下单全链路无感命中；
 * 菜单先留空，AI 报的菜名会由 ensureDish 现场自动上架。
 */
function ensureMerchantForAi(idOrName: string): MtMerchant | null {
  const hit = mtMerchantOf(idOrName);
  if (hit) return hit;
  const name = customMerchantName(idOrName);
  if (!name) return null;
  const merchant: MtMerchant = {
    id: `aimt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    emoji: guessShopEmoji(name),
    cats: ['waimai'],
    rating: 4.6,
    monthSale: 80 + Math.floor(Math.random() * 600),
    minOrder: 0,
    deliveryFee: 2,
    distanceKm: Math.round((0.8 + Math.random() * 2.4) * 10) / 10,
    deliveryMin: 25 + Math.floor(Math.random() * 20),
    notice: '新店入驻，欢迎光临',
    deals: [],
    hours: '09:00-23:00',
    addr: '离你最近的新店',
    sections: [],
    reviews: [],
    mtStatus: 'open',
  };
  try {
    mtRegisterAiMerchant(merchant);
  } catch {
    /* 持久化失败不影响本次下单 */
  }
  // 第十四轮：AI 自主入驻的店自动生成写实门头图（同上 fire-and-forget）
  try {
    fireAiProductImg('mt-cover', merchant.id, name);
  } catch {
    /* 生图调度失败不影响本次下单 */
  }
  return merchant;
}

/**
 * 第十三轮运行时兜底配套：从机主原话解析「请客/代点外卖」诉求（AI 只嘴上答应、没输出
 * [请客点外卖]/[帮点外卖] 标记时，由 wechat.tsx 兜底合成动作——冷却已删，说点就点）。
 * 支持三种句式：「点外卖：商家名|菜xN…」「请你点一[份杯]商家名的菜名」「在商家名点菜名」。
 * 解析不出「商家 + 菜品」组合返回 null（不瞎点）。
 */
export function parseMtAskFromText(text: string): { merchantId: string; items: { name: string; qty: number }[]; treat: boolean } | null {
  try {
    // 净化：门牌号/方括号标记替换为句读（防标记残骸混进店名/菜名）
    const t = text.replace(/\s+/g, '').replace(/\[M\d+\]/g, '，').replace(/\[[^\]]{1,16}\]/g, '，').replace(/[「」『』"]/g, '');
    const treat = /(请你点|请客|你来买单|我请客|你请|请我|请我吃|请我喝|我买单|你买单)/.test(t);
    let merchant = '';
    let rest = '';
    const mColon = /(?:点外卖|点个外卖|帮我点|请你点|给我点)[：:，,]([^，。！？!?,.|]{2,14}?)(?:的|，|、|\||$)(.*)$/.exec(t);
    const mDe = /(?:请你点|给我点|帮我点|来一?份|点一?[份杯])一?[份杯个]?([^，。！？!?,.]{2,14}?)的([^，。！？!?,.]{2,30})/.exec(t);
    const mAt = /在([^，。！？!?,.]{2,14}?)(?:点|买)(.*)$/.exec(t);
    if (mColon) {
      merchant = mColon[1];
      rest = mColon[2] ?? '';
    } else if (mDe) {
      merchant = mDe[1];
      rest = mDe[2] ?? '';
    } else if (mAt) {
      merchant = mAt[1];
      rest = mAt[2] ?? '';
    }
    if (!merchant) return null;
    // 菜品段：菜名x数量（和/、/，分隔；跳过口语残句）
    const items: { name: string; qty: number }[] = [];
    for (const seg of rest.split(/[，,、和跟加]/)) {
      const s = seg.trim().replace(/^点?一?[份杯个只碗串]*/, '');
      if (!s || /[你我吧呢哦嘛谢呀哈买单]/.test(s)) continue;
      const m = /^(.{1,16}?)\s*[xX×*]\s*(\d{1,2})$/.exec(s);
      if (m) {
        const name = m[1].trim();
        if (name.length >= 2) items.push({ name, qty: Math.max(1, Math.min(9, Number(m[2]))) });
      } else {
        const name = s.replace(/[一份杯个只碗串]+$/, '').replace(/^(来|点|要|再)/, '').trim();
        if (name.length >= 2 && name.length <= 16) items.push({ name, qty: 1 });
      }
      if (items.length >= 6) break;
    }
    if (items.length === 0) return null;
    return { merchantId: merchant, items, treat };
  } catch {
    return null;
  }
}

export type MtCreateDraftResult = { ok: true; draft: MtAiDraft } | { ok: false; error: string };

/** 创建代点草稿（菜品按商家菜单解析，金额按菜单价 + 满减/免配送预估） */
export function mtCreateAiDraft(opts: {
  uid: string;
  merchantId: string;
  items: { name: string; qty: number }[];
  note?: string;
  charId: string;
  charName: string;
  app: MtEngageApp;
}): MtCreateDraftResult {
  const merchant = mtMerchantOf(opts.merchantId);
  if (!merchant) return { ok: false, error: `没有找到这家店（${opts.merchantId}）` };
  const closedErr = checkMerchantOrderable(merchant);
  if (closedErr) return { ok: false, error: closedErr };
  const items: MtDraftItem[] = [];
  for (const it of opts.items) {
    const dish = ensureDish(merchant, it.name); // 菜单没有 → AI 自主补菜（Task 26）
    if (dish.soldOut) return { ok: false, error: `「${dish.name}」已售罄，换点别的吧` };
    items.push({ dishId: dish.id, name: dish.name, qty: it.qty, price: dish.price, emoji: dish.emoji, img: dish.img });
  }
  const cartItems = items.map((i) => ({ dishId: i.dishId as string, qty: i.qty }));
  const calc = mtCheckoutCalc(opts.uid, merchant, { merchantId: merchant.id, items: cartItems });
  const draft: MtAiDraft = {
    id: genDid(),
    uid: opts.uid,
    merchantId: merchant.id,
    merchantName: merchant.name,
    merchantEmoji: merchant.emoji,
    merchantImg: merchant.cover,
    items,
    estimate: calc.total,
    note: opts.note,
    charId: opts.charId,
    charName: opts.charName,
    app: opts.app,
    status: 'pending',
    createdAt: Date.now(),
  };
  kvSet(`mt-draft:${draft.id}`, draft);
  bumpDraftIndex(draft.id);
  fireDraftEvent();
  return { ok: true, draft };
}

/** 拒绝代点草稿 */
export function mtDeclineAiDraft(did: string): boolean {
  const d = mtGetDraft(did);
  if (!d || d.status !== 'pending') return false;
  kvSet(`mt-draft:${did}`, { ...d, status: 'declined' });
  fireDraftEvent();
  return true;
}

export type MtConfirmDraftResult = { ok: true; orderId: string; total: number } | { ok: false; error: string };

/**
 * 确认代点草稿 → 创建美团待支付订单（金额/满减与正常下单同口径 mtCheckoutCalc，地址用当前选中地址），
 * 调用方随后跳美团收银台支付；写发起角色记忆（「你帮机主点了外卖」）。
 */
export function mtConfirmAiDraft(did: string): MtConfirmDraftResult {
  const d = mtGetDraft(did);
  if (!d) return { ok: false, error: '代点请求不存在' };
  if (d.status !== 'pending') return { ok: false, error: '该代点请求已处理' };
  if (!d.uid) return { ok: false, error: '请先登录美团' };
  const merchant = mtMerchantOf(d.merchantId);
  if (!merchant) return { ok: false, error: '商家已下架' };
  const calc = mtCheckoutCalc(d.uid, merchant, { merchantId: merchant.id, items: d.items.map((i) => ({ dishId: i.dishId as string, qty: i.qty })) });
  const addrs = mtLoadAddresses(d.uid);
  const curId = mtCurAddrId(d.uid);
  const addr = addrs.find((a) => a.id === curId) ?? addrs[0];
  if (!addr) return { ok: false, error: '请先在美团里选择收货地址' };
  const now = Date.now();
  const order: MtOrder = {
    id: `mt${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    uid: d.uid,
    merchantId: merchant.id,
    merchantName: merchant.name,
    merchantEmoji: merchant.emoji,
    merchantImg: merchant.cover,
    kind: 'waimai',
    items: d.items.map((i) => ({ dishId: i.dishId ?? i.name, name: i.name, price: i.price, qty: i.qty, emoji: i.emoji ?? '🍱', img: i.img })),
    itemTotal: calc.itemTotal,
    deliveryFee: calc.deliveryFee,
    discount: calc.discount,
    total: calc.total,
    note: d.note,
    address: addr,
    status: 'pendingPay',
    createdAt: now,
    statusLog: [{ status: 'pendingPay', at: now }],
  };
  mtSaveOrders(d.uid, [order, ...mtLoadOrders(d.uid)]);
  kvSet(`mt-draft:${did}`, { ...d, status: 'confirmed', orderId: order.id, total: calc.total });
  fireDraftEvent();
  try {
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
  } catch {
    /* 忽略 */
  }
  // 写发起角色记忆（按角色隔离；sourceTag 防同模板互吞）
  const summary = d.items.map((i) => `${i.name}x${i.qty}`).join('、');
  memAddEventFragment(d.charId, d.app, `你帮机主在美团点了「${merchant.name}」的外卖（${summary}，应付¥${calc.total}），订单已提交等机主支付`, { eventTime: now, sourceTag: 'mt-ai-order' });
  // 商家附言：点的是机主自己的店 → 去该角色聊天里说一句（商家视角的活味）
  if (merchant.mine) {
    mtScheduleShopOrderChatLine(d.app, d.charId, `帮你在自家店里安排了${summary}，坐等老板接单啦~`);
  }
  return { ok: true, orderId: order.id, total: calc.total };
}

// ---------------- 场景识别 + 每回合上下文/规则 ----------------

const FOOD_TEXT_RE = /(吃|饿|外卖|点餐|点单|午餐|午饭|晚饭|晚餐|早餐|下午茶|夜宵|宵夜|奶茶|咖啡|火锅|麻辣烫|汉堡|披萨|炸鸡|寿司|甜品|蛋糕|干饭|美食|美团|加个鸡腿|有什么吃的)/;

export function mtScanFoodText(texts: (string | undefined | null)[]): boolean {
  return texts.some((t) => typeof t === 'string' && FOOD_TEXT_RE.test(t));
}

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p = (v: number): string => String(v).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function orderItemSummary(o: MtOrder, max = 3): string {
  const names = o.items.map((i) => `${i.name}${i.qty > 1 ? `x${i.qty}` : ''}`);
  return names.slice(0, max).join('、') + (names.length > max ? `等${names.length}样` : '');
}

/** 当前时段（B7 目录加权与规则文案共用）：匹配的商家类目排前 */
function mtFoodSlotOf(h: number): { label: string; cats: string[] } {
  if (h >= 5 && h < 10) return { label: '早餐时段', cats: ['zaocan'] };
  if (h >= 10 && h < 14) return { label: '午餐时段', cats: ['waimai', 'hamburg', 'mala', 'meishi'] };
  if (h >= 14 && h < 17) return { label: '下午茶时段', cats: ['yinyin', 'chaoshi', 'shuiguo'] };
  if (h >= 17 && h < 21) return { label: '晚餐时段', cats: ['waimai', 'meishi', 'mala', 'hamburg'] };
  return { label: '夜宵时段', cats: ['yinyin', 'waimai', 'mala', 'hamburg'] };
}

/** 美团外卖精选目录（食物话题命中时注入；时段加权稳定排序——同权重保持原顺序，确定性不换店）。
 *  排除机主自己的打烊店铺（AI 不该推荐点不了的店）与已售罄菜品。 */
function buildCatalogBlock(): string {
  const foodCats = new Set(['waimai', 'meishi', 'yinyin', 'hamburg', 'mala', 'zaocan', 'chaoshi', 'shuiguo']);
  const slot = mtFoodSlotOf(new Date().getHours());
  const shopOpen = (m: MtMerchant): boolean => !(m.mine && m.mtStatus === 'closed');
  const pool = mtAllMerchants().filter((m) => shopOpen(m) && m.cats.some((c) => foodCats.has(c)));
  const slotFit = (m: MtMerchant): number => (slot.cats.some((c) => m.cats.includes(c)) ? 0 : 1);
  pool.sort((a, b) => slotFit(a) - slotFit(b));
  const picked = pool.slice(0, 10);
  const lines = picked.map((m) => {
    const dishes = [...mtDishesOf(m)].filter((d) => !d.soldOut).sort((a, b) => (b.sig ? 1 : 0) - (a.sig ? 1 : 0)).slice(0, 3);
    const dishText = dishes.length > 0 ? dishes.map((d) => `${d.name}(¥${fmt2(d.price)})`).join('、') : '（暂无在售菜品）';
    return `· ${m.id} 「${m.name}」 评分${m.rating} 月售${m.monthSale} 起送¥${fmt2(m.minOrder)} 配送费¥${fmt2(m.deliveryFee)} 约${m.deliveryMin}分钟 ｜ ${dishText}`;
  });
  return `【美团外卖精选】（现在是${slot.label}，匹配时段的店排前面；商家ID就是标记里要用的 ID；菜名必须原样抄写；已售罄的菜不会出现在这里，别点）\n${lines.join('\n')}`;
}

/** C10：美团未登录 + 聊到吃的时的口径（不输出任何标记，防止落生硬的系统报错） */
const MT_NOT_LOGGED_IN_RULE =
  '【美团未登录】机主还没登录美团账号，现在点不了外卖：聊到想吃/点外卖的话题时，用正文自然回应（可以聊口味、推荐吃什么），' +
  '但不要输出 [帮点外卖]/[请客点外卖]/[自己点外卖]/[帮付]/[代付] 任何标记——发了也下不了单；可以顺势提醒TA先去美团登录，登录后就能让你帮忙点了。';

/**
 * 复购推荐候选：从历史订单聚合最常点的商家+菜品（商家≥2 单才算常点，确定性同额字典序）。
 * 菜品已售罄/店铺已打烊/全部菜品下架时不推荐。
 */
function mtRepeatPickOf(orders: MtOrder[]): { merchant: MtMerchant; dishName: string; times: number } | null {
  const done = orders.filter((o) => o.status !== 'canceled');
  if (done.length === 0) return null;
  const mCount = new Map<string, number>();
  for (const o of done) mCount.set(o.merchantId, (mCount.get(o.merchantId) ?? 0) + 1);
  let topMid = '';
  let topN = 0;
  for (const [mid, n] of mCount) {
    if (n > topN || (n === topN && mid > topMid)) {
      topMid = mid;
      topN = n;
    }
  }
  if (!topMid || topN < 2) return null;
  const merchant = mtMerchantOf(topMid);
  if (!merchant || (merchant.mine && merchant.mtStatus === 'closed')) return null;
  const dCount = new Map<string, number>();
  for (const o of done) {
    if (o.merchantId !== topMid) continue;
    for (const it of o.items) dCount.set(it.name, (dCount.get(it.name) ?? 0) + it.qty);
  }
  let topDish = '';
  let dN = 0;
  for (const [dn, n] of dCount) {
    if (n > dN || (n === dN && dn > topDish)) {
      topDish = dn;
      dN = n;
    }
  }
  if (!topDish) return null;
  const dish = mtDishesOf(merchant).find((d) => d.name === topDish);
  if (!dish || dish.soldOut) return null;
  return { merchant, dishName: topDish, times: dN };
}

/**
 * 券到期提醒（一次性）：24 小时内过期的未用券 → 注入规则让 AI 借聊天自然提一嘴。
 * 注入即写 kv 标记（每张券最多提醒一轮，避免每回合复读）。
 */
function mtExpiringCouponRule(uid: string, ownerName: string): string | null {
  const now = Date.now();
  const expiring = mtLoadCoupons(uid).filter((c) => !c.usedAt && c.expireAt > now && c.expireAt - now < 24 * 3_600_000);
  const toRemind = expiring.filter((c) => {
    try {
      return !kvGet<boolean>(`mt-coupon-remind:${c.id}`);
    } catch {
      return false;
    }
  });
  if (toRemind.length === 0) return null;
  for (const c of toRemind) {
    try {
      kvSet(`mt-coupon-remind:${c.id}`, true);
    } catch {
      /* 忽略 */
    }
  }
  const lines = toRemind.slice(0, 2).map((c) => `·「${c.name}」减¥${fmt2(c.amount)}${c.min > 0 ? `（满¥${fmt2(c.min)}可用）` : '（无门槛）'}`);
  return (
    `【券快过期】${ownerName}有 ${toRemind.length} 张美团券 24 小时内就要过期了：\n${lines.join('\n')}\n` +
    `找自然的时机提醒TA用掉（比如“你那张券今晚就过期了，要不要点点什么把它用掉？”），提醒过一次就好，别反复念叨；TA没兴趣就正常聊。`
  );
}

export interface MtEngageCtx {
  /** 注入 system 的动态块（最近订单/待支付订单实时状态） */
  block: string;
  /** 追加到处理动作规则后的段落（代付请求/帮付/点外卖教学；按条件出现） */
  rules: string[];
}

/**
 * 每回合现场构建（全同步 kv 读）：代付请求/订单状态实时、按角色聊天隔离。
 * recentTexts = 本轮触发文本 + 最近几条消息文本（食物话题命中时才注入商家目录）。
 * opts.scope = 'group'（C11）：群聊口径——只注入订单动态 + 目录 + 帮点外卖教学（代付/帮付/
 * 请客/自己点都是单聊语义，群聊不下发），冷却规则也不适用（草稿需机主确认，无刷屏风险）。
 */
export function buildMtEngageCtx(
  chatContactId: string,
  app: MtEngageApp,
  recentTexts: (string | undefined | null)[],
  opts?: { scope?: 'dm' | 'group' },
): MtEngageCtx {
  const empty: MtEngageCtx = { block: '', rules: [] };
  const group = opts?.scope === 'group';
  const foodHit = mtScanFoodText(recentTexts);
  let session: ReturnType<typeof mtGetSession> = null;
  try {
    session = mtGetSession();
  } catch {
    session = null;
  }
  // C10：未登录只在聊到吃的时候提醒，平时不噪音
  if (!session) return foodHit ? { block: '', rules: [MT_NOT_LOGGED_IN_RULE] } : empty;
  const uid = mtUidOf(session);
  const ownerName = cachedOwnerName() || session.name;
  const orders = mtLoadOrders(uid);
  const pendingPay = orders.filter((o) => o.status === 'pendingPay');
  const recentDone = orders.filter((o) => o.status !== 'pendingPay' && o.status !== 'canceled').slice(0, 5);

  // 动态块：最近订单（AI 知道机主点了什么/哪家店/金额/什么时候/配送状态）
  const blockParts: string[] = [];
  if (recentDone.length > 0) {
    const lines = recentDone.map((o) => `· ${fmtClock(o.createdAt)} 「${o.merchantName}」 ${orderItemSummary(o)} ¥${fmt2(o.total)} · ${MT_STATUS_LABEL[o.status]}${o.payChannelLabel ? `（${o.payChannelLabel}）` : ''}`);
    blockParts.push(`【${ownerName}的美团外卖动态】（实时状态，可自然提起）\n${lines.join('\n')}`);
  }

  // 规则段
  const rules: string[] = [];
  if (!group) {
    const proxies = mtPendingProxiesOfChat(chatContactId);
    const friendPending = proxies.filter((p) => p.direction === 'friend');
    const mePending = proxies.filter((p) => p.direction === 'me');
    if (friendPending.length > 0) {
      const lines = friendPending.map((p) => `· id=${p.id} 商家「${p.merchantName}」 ¥${fmt2(p.amount)}（${p.items.map((i) => `${i.name}x${i.qty}`).join('、')}）${p.note ? ` 备注:${p.note}` : ''} · 请求人:${p.fromName}`);
      rules.push(
        `【美团代付请求（机主发来请你代付）】\n${lines.join('\n')}\n` +
          `机主希望你帮忙支付上面的订单。是否代付完全由你按人设、你们的关系、记忆和金额自主决定：愿意就先说一句，再单独输出标记 [代付:请求id]（系统会立即支付并发出回执卡片，id 必须原样抄写）；不想付或觉得不合适就用正文自然婉拒（可以调侃、可以撒娇说下次），不要输出标记——婉拒后这张请求卡会显示「对方婉拒了」，TA还可以自己支付或再找别人。15 分钟内不处理订单会自动取消。`
      );
    }
    if (mePending.length > 0) {
      rules.push(
        `【你发出去的代付请求（等机主帮你付）】\n${mePending.map((p) => `· 商家「${p.merchantName}」 ¥${fmt2(p.amount)} · 待机主支付`).join('\n')}\n` +
          `可以自然提起（撒娇催一催），机主点卡片就能帮你付；不要重复发请求。`
      );
    }
    // A2/B8：全部 pending 代付请求涉及的订单（任何方向/任何聊天）不进帮付清单——
    // 防 AI 帮付「自己刚请机主代付」的单（语义自相矛盾），也防同一单 [代付:pid] 与 [帮付:订单id] 双口径
    const proxyOrderIds = new Set<string>();
    try {
      for (const pid of (kvGet<string[]>('mt-proxy-index') ?? [])) {
        const p = mtGetProxy(pid);
        if (p && p.status === 'pending') proxyOrderIds.add(p.orderId);
      }
    } catch {
      /* 忽略 */
    }
    const helpable = pendingPay.filter((o) => !proxyOrderIds.has(o.id));
    if (helpable.length > 0) {
      const lines = helpable.slice(0, 4).map((o) => `· 订单id=${o.id} 商家「${o.merchantName}」 ${orderItemSummary(o)} ¥${fmt2(o.total)}`);
      rules.push(
        `【${ownerName}的待支付外卖订单】\n${lines.join('\n')}\n` +
          `如果符合你的人设和你们的关系（说好请客、想宠TA等），可以主动帮TA付：输出标记 [帮付:订单id]（系统立即支付并回执）。` +
          `金额没有上限，付不付/付多少由你按人设/关系/上下文自然拿捉；也别每次都抢着付。`
      );
    }
    // 第十三轮用户反馈：参与冷却已整体删除，不再注入「参与节流」规则（连点/连请都照办）
    // 券到期提醒（一次性）：与食物话题无关，任何单聊回合都可能自然提一嘴
    const couponRule = mtExpiringCouponRule(uid, ownerName);
    if (couponRule) rules.push(couponRule);
  }
  if (foodHit) {
    if (group) {
      rules.push(
        `${buildCatalogBlock()}\n\n` +
          `【帮机主点外卖（群里）】聊到吃的、有人说饿/懒得动/想点外卖时，你可以结合当前时段（早餐/午餐/夜宵）和大家的口味推荐上面的商家和菜品；` +
          `有人想要你帮忙点时输出标记 [帮点外卖:商家ID|菜名x数量,菜名x数量|备注?]（菜名优先原样抄目录里的名字，目录里实在没有的也可以直接写——系统会自动帮你上架；备注可省略；目录里没有想点的店，可以把商家ID直接写成店名，系统会自动帮这家店入驻）。` +
          `系统会生成一张代点卡片，机主确认后才真正下单并自己付款。别频繁发，一次就好；只帮机主点，不要帮其他成员下单。`
      );
    } else {
      rules.push(
        `${buildCatalogBlock()}\n\n` +
          `【帮机主点外卖（机主自己付款）】聊到吃的、机主说饿/懒得动/让你推荐时，你可以先问问口味或结合你记得的偏好、当前时间（早餐/午餐/夜宵）推荐上面的商家和菜品；机主同意后输出标记 [帮点外卖:商家ID|菜名x数量,菜名x数量|备注?]（菜名优先原样抄目录里的名字，目录里实在没有的也可以直接写——系统会自动帮你上架；备注可省略；目录里没有想点的店，可以把商家ID直接写成店名——系统会自动帮这家店入驻）。系统会生成一张代点卡片，机主确认后才真正下单并自己付款，你不用再重复确认。\n` +
          `【请客点外卖（你直接付好）】如果你按人设/你们的关系想直接请TA吃（说好了请客、想宠TA、庆祝纪念等，别频繁），可以输出标记 [请客点外卖:商家ID|菜名x数量,菜名x数量|备注?]——系统会直接下单并由你付款（演示语义，不扣真钱），TA会收到一张已支付的订单卡片（实时显示配送状态），不需要再付款；目录里没有想点的店，商家ID直接写店名就行（系统自动帮这家店入驻）。金额没有上限，请不请/请多少由你按人设/关系/上下文自然拿捉；连着请也照办，没有次数限制。\n` +
          `【给你自己点外卖】你自己想吃/馋了的时候（按人设判断，别频繁），可以输出标记 [自己点外卖:商家ID|菜名x数量,菜名x数量]——系统会生成待支付订单并请机主帮你代付，记得用正文说一句让TA帮你付。`
      );
      const repeat = mtRepeatPickOf(orders);
      if (repeat) {
        rules.push(
          `【复购彩蛋】${ownerName}最近常点「${repeat.merchant.name}」（已经点过 ${repeat.times} 次），最常点「${repeat.dishName}」——如果你一时想不出推荐什么，可以自然提议“要不要再来一次那家？”，TA感兴趣就按上面的 [帮点外卖] 教学输出标记（一次就好，别太刻意）。`
        );
      }
    }
  }
  return { block: blockParts.join('\n\n'), rules };
}

// ---------------- AI 动作执行（wechat/QQ buildReplyMsgs 分流调用） ----------------

/** AI 可输出的美团联动动作（chat-rich ACTION_LABELS 登记同名标记） */
export type MtEngageActionKind = 'mt-proxy-pay' | 'mt-pay-for' | 'mt-order-draft' | 'mt-order-self' | 'mt-order-treat';

export function isMtEngageActionKind(kind: string): kind is MtEngageActionKind {
  return kind === 'mt-proxy-pay' || kind === 'mt-pay-for' || kind === 'mt-order-draft' || kind === 'mt-order-self' || kind === 'mt-order-treat';
}

/** 执行器产出的卡片消息（微信 WxMsg / QQ QQMsg 结构子集，直接 push 进回复队列） */
export type MtEngageCard = MtProxyCardMsg | { id: string; role: 'peer'; content: string; time: number; kind: 'mtdraft'; mtdraft: { did: string } };

export interface MtEngageExecResult {
  /** 随回复队列投递的卡片（mtpay 完成卡 / mtdraft 代点卡） */
  msgs: MtEngageCard[];
  /** 需要以系统行展示的提示（执行失败原因等）；空 = 静默 */
  sys?: string;
}

/** A3：异步流（请客/自己点）的失败反馈——系统提示行直写聊天并广播合并（开放中的聊天页实时可见） */
function insertEngageSys(app: MtEngageApp, contactId: string, text: string): void {
  try {
    const key = `${app}-chat-msgs:${contactId}`;
    const cur = kvGet<unknown[]>(key) ?? [];
    kvSet(key, [
      ...cur,
      { id: `mtsy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, role: 'peer', content: '', time: Date.now(), kind: 'sys', sys: { text } },
    ].slice(-100));
  } catch {
    /* 落库失败静默 */
  }
  try {
    window.dispatchEvent(new CustomEvent(MT_PROXY_CARD_EVENT, { detail: { cid: contactId, app } }));
  } catch {
    /* 忽略 */
  }
}

/** 美团当前登录态（动作执行/规则构建共用） */
export function mtEngageSessionUid(): { uid: string; name: string } | null {
  try {
    const s = mtGetSession();
    return s ? { uid: mtUidOf(s), name: s.name } : null;
  } catch {
    return null;
  }
}

export function applyMtEngageAction(
  action: RichAction,
  peer: ContactRecord,
  opts: { app: MtEngageApp; meName?: string; /** 保留字段（兼容调用方传参）：同意词表已删，不再消费 */ recentTexts?: (string | undefined | null)[] },
): MtEngageExecResult {
  const now = Date.now();
  const kind = action.kind;
  const meName = opts.meName?.trim() || cachedOwnerName() || '机主';
  if (kind === 'mt-proxy-pay') {
    // [代付:pid]：AI 支付机主发来的代付请求（仅 direction 'friend' 且落在自己聊天）
    const pid = action.targetId.trim();
    const p = mtGetProxy(pid);
    if (!p || p.status !== 'pending' || p.direction !== 'friend' || mtProxyChatCid(p) !== peer.id) {
      return { msgs: [], sys: '（代付请求不存在或已处理）' };
    }
    const res = mtProxyPayOrder(pid, { deferCard: true });
    if (!res.ok) return { msgs: [], sys: `（代付未成功：${res.error}）` };
    if (!res.card) return { msgs: [], sys: '（代付未完成，请稍后再试）' };
    const summary = p.items.map((i) => `${i.name}x${i.qty}`).join('、');
    memAddEventFragment(peer.id, opts.app, `机主${meName}在美团请你代付「${p.merchantName}」的订单（¥${fmt2(p.amount)}，${summary}），你同意并已支付`, { eventTime: now, sourceTag: 'mt-proxy-pay' });
    return { msgs: [res.card] };
  }
  if (kind === 'mt-pay-for') {
    // [帮付:订单id]：AI 主动为机主的待支付订单代付
    const uidInfo = mtEngageSessionUid();
    if (!uidInfo) return { msgs: [], sys: '（美团尚未登录，无法帮付）' };
    const order = mtLoadOrders(uidInfo.uid).find((o) => o.id === action.targetId.trim());
    if (!order || order.status !== 'pendingPay') return { msgs: [], sys: '（订单不存在或已支付）' };
    // 第十三轮用户反馈：帮付冷却已删——机主让帮多少次都照办
    const res = mtAiPayPendingOrder(order, { id: peer.id, name: peer.name, avatar: avatarFor(peer, opts.app) }, opts.app);
    if (!res.ok) return { msgs: [], sys: `（帮付未成功：${res.error}）` };
    if (!res.card) return { msgs: [], sys: '（帮付未完成，请稍后再试）' };
    const summary = order.items.map((i) => `${i.name}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、');
    memAddEventFragment(peer.id, opts.app, `你主动帮机主${meName}付了美团「${order.merchantName}」¥${fmt2(order.total)}的订单（${summary}）`, { eventTime: now, sourceTag: 'mt-help-pay' });
    return { msgs: [res.card] };
  }
  if (kind === 'mt-order-draft') {
    // [帮点外卖:商家ID|菜名x数量,...|备注?]：生成代点草稿卡（机主确认后才下单）
    const uidInfo = mtEngageSessionUid();
    if (!uidInfo) return { msgs: [], sys: '（美团尚未登录，无法代点外卖）' };
    const body = parseMtOrderBody(action.targetId);
    if (!body) return { msgs: [], sys: '（代点外卖格式有误，未能下单）' };
    // 第十三轮起：目录里没有的店可以直接写店名 → AI 自主帮这家店入驻再代点
    const m = ensureMerchantForAi(body.merchantId);
    if (!m) return { msgs: [], sys: `（代点失败：没有找到这家店（${body.merchantId}））` };
    const res = mtCreateAiDraft({
      uid: uidInfo.uid,
      merchantId: m.id,
      items: body.items,
      note: body.note,
      charId: peer.id,
      charName: peer.name,
      app: opts.app,
    });
    if (!res.ok) return { msgs: [], sys: `（代点失败：${res.error}）` };
    return {
      msgs: [{
        id: `mtdm-${res.draft.id}`,
        role: 'peer',
        content: `[美团代点]帮你挑了「${res.draft.merchantName}」的外卖，确认后就去下单`,
        time: now,
        kind: 'mtdraft',
        mtdraft: { did: res.draft.id },
      }],
    };
  }
  // mt-order-self：[自己点外卖:商家ID|菜名x数量,...] —— 异步流：创建待支付订单 + 请机主代付
  if (kind === 'mt-order-self') {
    const uidInfo = mtEngageSessionUid();
    if (!uidInfo) return { msgs: [], sys: '（美团尚未登录，无法点外卖）' };
    const parsed = parseMtOrderBody(action.targetId);
    if (!parsed) return { msgs: [], sys: '（点外卖格式有误，未能下单）' };
    // 第十三轮起：目录里没有的店 → AI 自主入驻
    const ensured = ensureMerchantForAi(parsed.merchantId);
    const body = { ...parsed, merchantId: ensured ? ensured.id : parsed.merchantId };
    // 第十三轮用户反馈：冷却已删；A3 同步预校验：商家/菜品/地址问题当场报，不再静默进异步流
    const pre = mtValidateParsedOrder(uidInfo.uid, body);
    if (!pre.ok) return { msgs: [], sys: `（点外卖失败：${pre.error}）` };
    void mtSelfOrderFlow(body, peer, opts).catch(() => undefined);
    return { msgs: [] };
  }
  // mt-order-treat：[请客点外卖:商家ID|菜名x数量,...|备注?] —— 异步流：直接下单 + AI 付款 + 发已支付订单卡
  const uidInfo2 = mtEngageSessionUid();
  if (!uidInfo2) return { msgs: [], sys: '（美团尚未登录，无法点外卖）' };
  const parsed2 = parseMtOrderBody(action.targetId);
  if (!parsed2) return { msgs: [], sys: '（请客点外卖格式有误，未能下单）' };
  // 第十三轮起：目录里没有的店 → AI 自主入驻
  const ensured2 = ensureMerchantForAi(parsed2.merchantId);
  const body2 = { ...parsed2, merchantId: ensured2 ? ensured2.id : parsed2.merchantId };
  // 第十三轮用户反馈：请客冷却已删——机主让请多少次都照办
  const pre2 = mtValidateParsedOrder(uidInfo2.uid, body2);
  if (!pre2.ok) return { msgs: [], sys: `（请客失败：${pre2.error}）` };
  void mtTreatOrderFlow(body2, peer, opts).catch(() => undefined);
  return { msgs: [] };
}

/**
 * [自己点外卖]/[请客点外卖] 共用校验（A3/B6 预检）：商家存在、菜品全部能对上、地址已选、
 * 金额按菜单价 + 满减/免配送算好。只读不落盘——真正建单由 mtBuildParsedOrder 复用本结果。
 */
function mtValidateParsedOrder(
  uid: string,
  body: { merchantId: string; items: { name: string; qty: number }[]; note?: string },
): { ok: true; merchant: MtMerchant; total: number } | { ok: false; error: string } {
  const merchant = mtMerchantOf(body.merchantId);
  if (!merchant) return { ok: false, error: `没有找到这家店（${body.merchantId}）` };
  const closedErr = checkMerchantOrderable(merchant);
  if (closedErr) return { ok: false, error: closedErr };
  const items: { dishId: string; name: string; qty: number; price: number; emoji?: string; img?: string }[] = [];
  for (const it of body.items) {
    const dish = ensureDish(merchant, it.name); // 菜单没有 → AI 自主补菜（Task 26）
    if (dish.soldOut) return { ok: false, error: `「${dish.name}」已售罄，换点别的吧` };
    items.push({ dishId: dish.id, name: dish.name, qty: it.qty, price: dish.price, emoji: dish.emoji, img: dish.img });
  }
  const addrs = mtLoadAddresses(uid);
  const addr = addrs.find((a) => a.id === mtCurAddrId(uid)) ?? addrs[0];
  if (!addr) return { ok: false, error: '请先在美团里选择收货地址' };
  const calc = mtCheckoutCalc(uid, merchant, { merchantId: merchant.id, items: items.map((i) => ({ dishId: i.dishId, qty: i.qty })) });
  return { ok: true, merchant, total: calc.total };
}

/** [自己点外卖]/[请客点外卖] 共用：按解析体创建美团待支付订单（金额/满减与正常下单同口径；地址用当前选中地址） */
function mtBuildParsedOrder(
  uid: string,
  body: { merchantId: string; items: { name: string; qty: number }[]; note?: string },
  fallbackNote: string,
): { ok: true; order: MtOrder } | { ok: false; error: string } {
  const merchant = mtMerchantOf(body.merchantId);
  if (!merchant) return { ok: false, error: `没有找到这家店（${body.merchantId}）` };
  const items: { dishId: string; name: string; qty: number; price: number; emoji?: string; img?: string }[] = [];
  for (const it of body.items) {
    const dish = ensureDish(merchant, it.name); // 菜单没有 → AI 自主补菜（Task 26）
    items.push({ dishId: dish.id, name: dish.name, qty: it.qty, price: dish.price, emoji: dish.emoji, img: dish.img });
  }
  const calc = mtCheckoutCalc(uid, merchant, { merchantId: merchant.id, items: items.map((i) => ({ dishId: i.dishId, qty: i.qty })) });
  const addrs = mtLoadAddresses(uid);
  const addr = addrs.find((a) => a.id === mtCurAddrId(uid)) ?? addrs[0];
  if (!addr) return { ok: false, error: '请先在美团里选择收货地址' };
  const now = Date.now();
  const order: MtOrder = {
    id: `mt${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    uid,
    merchantId: merchant.id,
    merchantName: merchant.name,
    merchantEmoji: merchant.emoji,
    merchantImg: merchant.cover,
    kind: 'waimai',
    items: items.map((i) => ({ ...i, emoji: i.emoji ?? '🍱' })),
    itemTotal: calc.itemTotal,
    deliveryFee: calc.deliveryFee,
    discount: calc.discount,
    total: calc.total,
    note: body.note ?? fallbackNote,
    address: addr,
    status: 'pendingPay',
    createdAt: now,
    statusLog: [{ status: 'pendingPay', at: now }],
  };
  mtSaveOrders(uid, [order, ...mtLoadOrders(uid)]);
  try {
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
  } catch {
    /* 忽略 */
  }
  return { ok: true, order };
}

/** [自己点外卖] 异步全流程：建单 → direction 'me' 代付请求（卡片经事件合并进聊天）→ 角色记忆。
 *  失败不再静默（A3）：落系统提示行说明原因。 */
async function mtSelfOrderFlow(
  body: { merchantId: string; items: { name: string; qty: number }[]; note?: string },
  peer: ContactRecord,
  opts: { app: MtEngageApp; meName?: string },
): Promise<void> {
  const uidInfo = mtEngageSessionUid();
  if (!uidInfo) return;
  const built = mtBuildParsedOrder(uidInfo.uid, body, `${peer.name}想吃的`);
  if (!built.ok) {
    insertEngageSys(opts.app, peer.id, `（点外卖失败：${built.error}）`);
    return;
  }
  const order = built.order;
  const payer = await mtOwnerContactFor(opts.app);
  if (!payer) {
    insertEngageSys(opts.app, peer.id, '（代付请求没有发出去：找不到机主的联系人信息）');
    return;
  }
  await mtCreateProxyRequestByChar({
    order,
    idp: opts.app,
    char: { id: peer.id, name: peer.name, avatar: avatarFor(peer, opts.app) },
    payer,
  });
  const meName = opts.meName?.trim() || cachedOwnerName() || '机主';
  const summary = order.items.map((i) => `${i.name}x${i.qty}`).join('、');
  memAddEventFragment(peer.id, opts.app, `你在美团给自己点了「${order.merchantName}」的外卖（${summary}，¥${fmt2(order.total)}），请机主${meName}帮你代付`, { eventTime: order.createdAt, sourceTag: 'mt-self-order' });
  // 商家附言：在自己老板店里点的，让老板接单+记得帮付
  const selfMerchant = mtMerchantOf(order.merchantId);
  if (selfMerchant?.mine) {
    mtScheduleShopOrderChatLine(opts.app, peer.id, `我在你家店里点了${summary}，快接单呀，等下记得帮我付~`);
  }
}

/**
 * [请客点外卖] 异步全流程：建单 → AI 立即付款（mtAiPayPendingOrder，演示语义不扣真钱）→
 * 以订单分享卡（role peer，角标「X已买单」，内嵌实时状态时间线）发给机主 → 灵动岛通知/未读角标 → 角色记忆。
 * 机主全程无需付款；点击卡片进美团订单详情。
 */
async function mtTreatOrderFlow(
  body: { merchantId: string; items: { name: string; qty: number }[]; note?: string },
  peer: ContactRecord,
  opts: { app: MtEngageApp; meName?: string },
): Promise<void> {
  const uidInfo = mtEngageSessionUid();
  if (!uidInfo) return;
  const built = mtBuildParsedOrder(uidInfo.uid, body, `${peer.name}请客的`);
  if (!built.ok) {
    insertEngageSys(opts.app, peer.id, `（请客失败：${built.error}）`);
    return;
  }
  const order = built.order;
  // AI 付款：建 direction 'friend' 代付记录并立即支付（完成回执卡丢弃，用订单动态卡替代）
  const payRes = mtAiPayPendingOrder(order, { id: peer.id, name: peer.name, avatar: avatarFor(peer, opts.app) }, opts.app);
  if (!payRes.ok || !payRes.order) {
    insertEngageSys(opts.app, peer.id, `（请客失败：${!payRes.ok ? payRes.error : '支付未完成'}）`);
    return;
  }
  const paidOrder = payRes.order;
  // 已支付订单动态卡发给机主（实时状态时间线，点击进订单详情）
  const shareRes = await mtCreateOrderShare({
    order: paidOrder,
    idp: opts.app,
    contactId: peer.id,
    fromName: peer.name,
    role: 'peer',
    paidBy: peer.name,
    content: `[美团订单]请你吃的「${paidOrder.merchantName}」已下单，我付好啦`,
  });
  if (!shareRes.ok) {
    insertEngageSys(opts.app, peer.id, '（订单已支付，但分享卡片没有发出去：可到美团订单页查看）');
    return;
  }
  // 灵动岛通知 + 未读角标（聊天不在场也能感知；与主动消息同管线）
  const notifyApp = opts.app === 'wx' ? ('wechat' as const) : ('qq' as const);
  const itemSummary = paidOrder.items.map((i) => `${i.name}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、');
  try {
    pushChatNotification({
      sessionKey: `${opts.app}:${peer.id}`,
      app: notifyApp,
      title: peer.name,
      avatar: avatarFor(peer, opts.app),
      body: `请你吃了「${paidOrder.merchantName}」的外卖（¥${fmt2(paidOrder.total)}），已经付好啦`,
      target: { app: notifyApp, contactId: peer.id },
    });
  } catch {
    /* 忽略 */
  }
  try {
    const { isProactiveChatActive } = await import('./proactive-msg');
    if (!isProactiveChatActive(opts.app, peer.id)) {
      if (opts.app === 'wx') wxUnreads.bump(peer.id, 1);
      else qqUnreads.bump(peer.id, 1);
    }
  } catch {
    /* 忽略 */
  }
  const meName2 = opts.meName?.trim() || cachedOwnerName() || '机主';
  memAddEventFragment(peer.id, opts.app, `你请机主${meName2}在美团吃了「${paidOrder.merchantName}」的外卖（${itemSummary}，¥${fmt2(paidOrder.total)}），订单已由你付款`, { eventTime: Date.now(), sourceTag: 'mt-treat-order' });
  // 商家附言：请客点的是机主自家店 → 自产自销一句
  const treatMerchant = mtMerchantOf(paidOrder.merchantId);
  if (treatMerchant?.mine) {
    mtScheduleShopOrderChatLine(opts.app, peer.id, `请你在你家店里吃了${itemSummary}，自产自销哈哈`);
  }
}

// ---------------- C9：订单终态记忆（送达/取消 → 参与角色的事件记忆） ----------------

/**
 * 订单到达终态（completed/canceled）时，给所有参与过这张单的 AI 角色补写一条事件记忆：
 * - friend 方向已支付的代付记录（帮付/请客/代付决策）→「你为机主买单的 xx 已送达/取消退款」；
 * - me 方向（AI 自己的单，机主帮付）→「你点的 xx 已送达/被取消」；
 * - 确认过的代点草稿 →「你帮机主点的 xx 已送达/被取消」。
 * 让买单史/代点史在动态块滚动丢失后仍留在角色长期记忆里。由订单状态机 tick 调用（幂等：
 * 每个状态只推进一次，同单多参与方用去重避免同模板互吞）。
 */
export function mtWriteOrderTerminalMemory(o: MtOrder): void {
  try {
    if (o.status !== 'completed' && o.status !== 'canceled') return;
    const summary = o.items.map((i) => `${i.name}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、');
    const cancelTail = o.status === 'canceled' ? (o.cancelReason ? `（${o.cancelReason}）` : '') : '';
    const written = new Set<string>();
    for (const pid of kvGet<string[]>('mt-proxy-index') ?? []) {
      const p = mtGetProxy(pid);
      if (!p || p.orderId !== o.id) continue;
      if (p.direction === 'friend') {
        // 只有真的付过钱的请求才写「买单」记忆（婉拒/失效不算）
        if (p.status !== 'paid') continue;
        const key = `${p.idp}:${p.contactId}`;
        if (written.has(key)) continue;
        written.add(key);
        memAddEventFragment(
          p.contactId,
          p.idp,
          `你为机主买单的「${o.merchantName}」外卖（${summary}，¥${fmt2(o.total)}）${o.status === 'completed' ? '已送达' : `被取消了${cancelTail}，钱原路退回`}`,
          { eventTime: Date.now(), sourceTag: 'mt-order-terminal' },
        );
      } else {
        // AI 自己点的单：卡片所在聊天才是角色本人
        const charId = p.chatContactId ?? '';
        if (!charId) continue;
        const key = `${p.idp}:${charId}:me`;
        if (written.has(key)) continue;
        written.add(key);
        memAddEventFragment(
          charId,
          p.idp,
          `你在美团点的「${o.merchantName}」外卖（${summary}，¥${fmt2(o.total)}）${o.status === 'completed' ? '已送达，机主帮你付的钱' : `被取消了${cancelTail}`}`,
          { eventTime: Date.now(), sourceTag: 'mt-order-terminal' },
        );
      }
    }
    for (const did of kvGet<string[]>('mt-draft-index') ?? []) {
      const d = mtGetDraft(did);
      if (!d || d.orderId !== o.id || d.status !== 'confirmed') continue;
      const key = `${d.app}:${d.charId}:draft`;
      if (written.has(key)) continue;
      written.add(key);
      memAddEventFragment(d.charId, d.app, `你帮机主点的「${o.merchantName}」外卖（${summary}，¥${fmt2(o.total)}）${o.status === 'completed' ? '已送达' : `被取消了${cancelTail}`}`, { eventTime: Date.now(), sourceTag: 'mt-order-terminal' });
    }
  } catch {
    /* 忽略 */
  }
}

/** 机主联系人（direction 'me' 代付的付款人） */
export async function mtOwnerContactFor(app: MtEngageApp): Promise<{ id: string; name: string; avatar: string | null } | null> {
  try {
    const acc = getActiveAccountFor(app as AccountApp);
    const all = await listContacts();
    let me = acc.kind === 'main' ? all.find((c) => c.kind === 'user' && !c.altOf) : (all.find((c) => c.altOf === acc.id) ?? (acc.ownerContactId ? all.find((c) => c.id === acc.ownerContactId) : undefined));
    if (!me) me = all.find((c) => c.kind === 'user' && !c.altOf);
    if (!me) return null;
    const name = (me.nickname?.trim() || me.name || '').trim() || '我';
    return { id: me.id, name, avatar: avatarFor(me, app) };
  } catch {
    return null;
  }
}

// ---------------- AI 历史序列化（mtpay/mtshare/mtdraft 卡 → AI 可读文本） ----------------

export function mtProxyHistoryLine(pid: string, cardRole: 'req' | 'done', senderName: string): string {
  const p = mtGetProxy(pid);
  if (!p) return `[美团代付卡片]`;
  if (cardRole === 'req') {
    const stateText = p.status === 'pending' ? '待代付' : p.status === 'paid' ? '已代付' : p.status === 'declined' ? '已婉拒' : `已失效（${p.closeReason ?? '订单未支付'}）`;
    return `[美团代付请求 id:${p.id}]（${senderName}发的：商家「${p.merchantName}」¥${fmt2(p.amount)}，${p.items.map((i) => `${i.name}x${i.qty}`).join('、')}${p.note ? `，备注:${p.note}` : ''}，状态:${stateText}）`;
  }
  return `[美团代付回执 id:${p.id}]（${senderName}：已代付「${p.merchantName}」¥${fmt2(p.amount)}，订单支付完成）`;
}

export function mtDraftHistoryLine(did: string, senderName: string): string {
  const d = mtGetDraft(did);
  if (!d) return '[美团代点卡片]';
  const status = d.status === 'pending' ? '待机主确认' : d.status === 'confirmed' ? `已下单（订单${d.orderId ?? ''}）` : '机主已取消';
  return `[美团代点 id:${d.id}]（${senderName}帮机主点的：商家「${d.merchantName}」，${d.items.map((i) => `${i.name}x${i.qty}`).join('、')}，约¥${fmt2(d.total ?? d.estimate)}，状态:${status}）`;
}

/** 订单分享卡 → AI 可读文本（含实时配送状态与付款人，AI 能自然接话）。
 *  fromName 是社交展示名（可能是机主昵称）：contactId 能解析到真名就替换（用户规则：AI 永不知道机主昵称） */
export function mtOrderShareHistoryLine(sid: string): string {
  const s = mtGetShare(sid);
  if (!s) return '[美团订单分享卡片]';
  const order = mtLoadOrders(s.uid).find((o) => o.id === s.orderId);
  const status = order ? MT_STATUS_LABEL[order.status] : '未知';
  const realFrom = s.contactId ? cachedContactRealName(s.contactId) : '';
  const who = s.paidBy ? `${s.paidBy}请客已付的（机主无需付款）` : `${realFrom || s.fromName}分享的`;
  return `[美团订单分享]（${who}：「${s.merchantName}」¥${fmt2(s.amount)}，${s.items.map((i) => `${i.name}x${i.qty}`).join('、')}，当前状态:${status}）`;
}

/** AI 幻觉回显剥除：模型有时照抄聊天历史里的卡片序列化行（[美团代付/代点/订单分享…]（…））
 *  当正文发出来——这些行是系统视角的卡片描述不是发言，整行剥除（只剥「整行都是该模式」的行）。
 *  说明文字里的金额/数量常见嵌套括号（如「珍珠奶茶（冰）」），尾段用贪婪匹配到行尾而不是 [^）]*，
 *  否则嵌套括号会让 $ 断言失败、整行剥不掉（实测复现：AI 把分享卡序列化行原样发了出来） */
const MT_ECHO_LINE_RE = /^\s*\[美团(?:代付|代点|订单分享)[^\]]*\]\s*（.*）\s*$/;
export function stripMtEchoText(text: string): string {
  const lines = text.split('\n');
  const kept = lines.filter((l) => !MT_ECHO_LINE_RE.test(l));
  return kept.length === lines.length ? text : kept.join('\n');
}

// ---------------- AI 代付决策（机主发起代付请求后的自主决策） ----------------

const decisionInFlight = new Set<string>();

/** 机主发起找人代付后调用：延时让该 AI 角色「看到请求」并按人设/记忆决策是否代付 */
export function scheduleMtProxyAiDecision(pid: string): void {
  if (decisionInFlight.has(pid)) return;
  decisionInFlight.add(pid);
  const delay = 5200 + Math.floor(Math.random() * 6800);
  window.setTimeout(() => {
    void runProxyDecision(pid)
      .catch(() => undefined)
      .finally(() => decisionInFlight.delete(pid));
  }, delay);
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as unknown;
    if (j && typeof j === 'object') return j as Record<string, unknown>;
  } catch {
    /* 继续兜底 */
  }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as unknown;
      if (j && typeof j === 'object') return j as Record<string, unknown>;
    } catch {
      /* 放弃 */
    }
  }
  return null;
}

async function callLlm(system: string, userContent: string): Promise<string> {
  const apiConfig = useSettings.getState().apiConfig;
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }], ...extra }),
      signal: AbortSignal.timeout(75_000),
    });
    return res.ok ? await res.text() : '';
  };
  let raw = '';
  try {
    raw = await call({ config: apiConfig });
  } catch {
    raw = '';
  }
  if (!raw.trim()) {
    try {
      raw = await call({ forceSdk: true });
    } catch {
      raw = '';
    }
  }
  return raw;
}

interface ProxyDecision {
  pay: boolean;
  reply: string;
}

async function runProxyDecision(pid: string): Promise<void> {
  const p = mtGetProxy(pid);
  if (!p || p.status !== 'pending') return;
  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(p.contactId);
  } catch {
    contact = null;
  }
  if (!contact || contact.kind === 'user') return;
  const app = p.idp;
  const sessionKey = `${app}:${contact.id}`;
  const owner = await ownerProfileFor(app as AccountApp).catch(() => null);
  const meName = owner?.realName || p.fromName || '机主';

  const persona = buildPersonaSystemPrompt(contact, {
    channel: app === 'wx' ? '微信' : 'QQ',
    userName: owner?.realName || null,
    ownerName: owner?.realName || null,
    accountId: getActiveAccountIdFor(app as AccountApp),
    // 跨 App 身份与记忆感知（与 proactive-msg/friend-state 等代际调用点同口径；按每联系人互通开关）
    multiApp: getMemSettings(contact.id).share,
  });
  const summary = p.items.map((i) => `${i.name}x${i.qty}`).join('、');
  const memoryBlock = memChatRecallBlock(contact.id, app, `美团 代付 外卖 ${p.merchantName} ${summary} ${p.note ?? ''}`, {});
  const timeBlock = getTimeAware(sessionKey) ? buildTimeAwareBlock({ regionHint: contact.region || null }) : '';
  const system = [persona, memoryBlock, timeBlock].filter(Boolean).join('\n\n');

  const user = [
    `【刚收到的美团代付请求】\n${meName}（${p.fromName}）在美团拍了「${p.merchantName}」的外卖：${summary}，共 ¥${fmt2(p.amount)}，想请你代付。${p.note ? `订单备注：${p.note}。` : ''}15 分钟内不处理订单会自动取消。`,
    '【任务】结合你的人设、性格、你们的关系、上面的记忆和金额，决定要不要帮TA付这笔钱（演示语义，不会真花钱）。',
    '一般来说：关系亲近、金额不大、人设大方/爱请客/正好想宠TA → 可以付；人设节俭/关系一般/金额偏大/刚闹过矛盾 → 可以婉拒或调侃。两种选择都自然，没有标准答案。',
    '输出 JSON：{"pay":true或false,"reply":"无论付不付都要给对方的一句话回复（像平时聊天，1~2句；付了可以说已付+一句人设话，婉拒就自然说）"}',
    '严禁输出 JSON 以外的文字。',
  ].join('\n\n');

  const raw = await callLlm(system, user);
  const parsed = extractJsonObject(raw) as Partial<ProxyDecision> | null;
  if (!parsed || typeof parsed.reply !== 'string' || !parsed.reply.trim()) return;
  const reply = parsed.reply.trim().replace(/^[「"'『]+|[」"'』]+$/g, '').split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
  if (!reply) return;

  // 决策落定前复查状态（机主可能已取消/自己付了）
  const cur = mtGetProxy(pid);
  if (!cur || cur.status !== 'pending') return;

  const now = Date.now();
  const outMsgs: { id: string; role: 'me' | 'peer'; content: string; time: number; kind?: 'mtpay'; mtpay?: { pid: string; role: 'req' | 'done' } }[] = [];
  if (parsed.pay === true) {
    const res = mtProxyPayOrder(pid, { deferCard: true });
    if (!res.ok || !res.card) return;
    outMsgs.push(res.card);
    const itemSummary = cur.items.map((i) => `${i.name}x${i.qty}`).join('、');
    memAddEventFragment(contact.id, app, `机主${meName}在美团请你代付「${cur.merchantName}」的订单（¥${fmt2(cur.amount)}，${itemSummary}），你决定帮TA付了`, { eventTime: now, sourceTag: 'mt-proxy-pay' });
  } else {
    // B5：婉拒 → 请求置 declined，请求卡同步变「对方婉拒了」（订单仍待支付，机主可自付/再找别人）
    mtDeclineProxy(pid, '对方婉拒了这次代付');
    memAddEventFragment(contact.id, app, `机主${meName}在美团请你代付「${cur.merchantName}」的订单（¥${fmt2(cur.amount)}），你婉拒了`, { eventTime: now, sourceTag: 'mt-proxy-decline' });
  }
  outMsgs.push({ id: `mtpxr-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, role: 'peer', content: reply, time: now + 1 });

  await deliverPeerMsgs(app, contact, outMsgs);
}

/** 决策消息投递（落库 + 灵动岛通知 + 未读角标；与主动消息同管线） */
async function deliverPeerMsgs(app: MtEngageApp, contact: ContactRecord, msgs: { id: string; role: 'me' | 'peer'; content: string; time: number; kind?: string; mtpay?: { pid: string; role: 'req' | 'done' } }[]): Promise<void> {
  const cid = contact.id;
  const sessionKey = `${app}:${cid}`;
  const notifyApp = app === 'wx' ? ('wechat' as const) : ('qq' as const);
  const { isProactiveChatActive } = await import('./proactive-msg');
  await scheduleAiDelivery<(typeof msgs)[number]>(
    sessionKey,
    msgs,
    (m) => {
      try {
        const key = `${app}-chat-msgs:${cid}`;
        const rawList = kvGet<unknown[]>(key);
        const list = Array.isArray(rawList) ? rawList : [];
        kvSet(key, [...list, m]); // 聊天记录不封顶（此前截 200 条会把旧记录挤丢）
      } catch {
        /* 落库失败静默 */
      }
      pushChatNotification({
        sessionKey,
        app: notifyApp,
        title: contact.name,
        avatar: avatarFor(contact, app),
        body: m.content,
        target: { app: notifyApp, contactId: cid },
      });
      if (!isProactiveChatActive(app, cid)) {
        if (app === 'wx') wxUnreads.bump(cid, 1);
        else qqUnreads.bump(cid, 1);
      }
    },
    { initialDelay: 0 },
  );
}

// ---------------- 商家附言（AI 在机主自家店里下单后去聊天里说一句） ----------------

/**
 * AI 买家附言：订单落在机主自己的店铺时，延时数秒让该 AI 角色在对应聊天里自然说一句
 * （「在你家点了 xx，记得接单呀」），把「商家视角」的闭环串起来。
 * 走与决策回复同一条投递管线（落库 + 灵动岛 + 未读角标）；找不到联系人/是机主本人时静默跳过。
 */
export function mtScheduleShopOrderChatLine(app: MtEngageApp, charId: string, text: string, delayMs?: number): void {
  if (!charId || !text.trim()) return;
  const delay = delayMs ?? 2600 + Math.floor(Math.random() * 3400);
  window.setTimeout(() => {
    void (async () => {
      try {
        const contact = await getContact(charId);
        if (!contact || contact.kind === 'user') return;
        await deliverPeerMsgs(app, contact, [
          { id: `mtshopline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, role: 'peer', content: text.trim(), time: Date.now() },
        ]);
      } catch {
        /* 附言失败静默 */
      }
    })();
  }, delay);
}

