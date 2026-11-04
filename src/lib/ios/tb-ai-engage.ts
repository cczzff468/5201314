'use client';

/**
 * 淘宝 AI 联动引擎（对齐美团 mt-ai-engage 同一套交互口径）：
 * - 上下文注入 buildTbEngageCtx：机主淘宝订单实时动态（AI 知道买了什么/哪家店/多少钱/快递状态）
 *   + 待付订单 [帮付淘宝]（AI 按人设/记忆/关系主动代付）+ 在途快递 [帮取快递]（帮机主取件）
 *   + 聊到购物时的商品目录与 [帮你买]（AI 代买草稿，支持多商品，机主确认后 AI 出钱付款；
 *   第 22 轮起付款后宝贝**不用等物流直接送达**——订单立即已完成、同步落进礼物页；
 *   目录按最近聊天相关性前置，修「要玩偶给了手机」的错品推荐）
 *   与 [自己买]（AI 自己想要，下单后请机主代付）教学；聊到演出/买票时的近期演出清单与
 *   [帮你买票]（AI 按人设自主帮机主买喜剧脱口秀/演唱会票）；聊天内 pending 的代付请求
 *   [代付淘宝:请求id]（机主再次开口时 AI 真正执行代付）；
 * - 动作执行 applyTbEngageAction：帮付/代付请求支付/代买草稿/自己买/帮取快递/收礼物确认/帮买演出票等标记落地；
 * - 礼物链路：机主分享订单后说「给你买的」→ AI 结合人设/记忆/上下文自主确认（输出 [收礼物:sid]，
 *   「买给你妹妹/送你个表情包」这类话不误标）→ 包裹到驿站后 AI 自主取件（tbEngageTick）；
 *   取到后要不要主动说、说什么全部由 LLM 按人设/记忆/上下文现场决策（不发模板道谢，也可以不说）；
 * - 主动参与：tbEngageTick 发现机主有待付款订单时，最近聊天的 AI 角色按人设/记忆决定要不要
 *   主动帮忙付掉（全付；每单只问一次 + 全局冷却，不刷屏）；LLM 失败时本地兑底直接帮付
 *   + 一句兑底话术（不再静默：用户要求机主一定能看到一次参与）；到货/发货主动问候由 AI 自主
 *   决定发不发（没聊天对象不消耗机会，不发模板）；
 * - 自主创建宝贝（第十三轮用户反馈）：[帮你买]/[送礼物]/[自己买] 里写目录没有的宝贝（*名字
 *   或直接中文名）→ 现场创建上架再买/送，不再报「没有找到这个商品」；
 * - 金额无硬门槛（用户要求全部取消）：帮付/代买/请客都不设金额上限，超过与否由 AI 按人设/关系/
 *   上下文自然拿捉（不再用同意词表，判断全部交给 LLM）；
 * - 全部动作写事件记忆（memAddEventFragment），代付/订单互相关联（订单挂 proxy 快照）。
 */
import { kvGet, kvSet } from './idb-kv';
import { getContact, ownerProfileFor, listContacts } from './contacts-store';
import { avatarFor, isFriendIn, type ContactRecord } from '../contacts';
import { buildPersonaSystemPrompt } from './persona';
import { getMemSettings } from '@/lib/memory';
import { memChatRecallBlock, memAddEventFragment } from '@/lib/memory';
import { getTimeAware, buildTimeAwareBlock } from '@/lib/time-aware';
import { pushChatNotification } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { getActiveAccountIdFor, getActiveAccountFor, type AccountApp } from './accounts';
import { productById, shopById, tbSearchPool, tbShopIdForTag, type TbCatId, type TbProduct } from './taobao-data';
import { fireAiProductImg } from './ai-product-img';
import {
  tbArrivedAtStation,
  tbConfirmReceive,
  tbCreateOrder,
  tbCreateTicketOrder,
  tbCurAddr,
  tbGetSession,
  tbInstantCompleteAiOrder,
  tbLoadOrders,
  tbMainImg,
  tbSaveOrders,
  tbStatusText,
  tbUidOf,
  type TbOrder,
  type TbOrderItem,
} from './taobao-store';
import {
  TB_BEST_ZONE,
  TB_COMEDY_SHOWS,
  TB_CONCERTS,
  TB_SEAT_LAYOUT,
  tbRealDate,
  tbSeatSold,
  tbSessionStarted,
  tbSessionTime,
} from './taobao-channels-data';
import {
  TB_PROXY_CARD_EVENT,
  tbAiPayPendingOrder,
  tbCreateProxyRequestByChar,
  tbGetProxy,
  tbGetShare,
  tbPendingProxiesOfChat,
  tbProxyChatCid,
  tbProxyPayOrder,
  tbShareOrderOf,
} from './tb-share-proxy';
import { callTbLlm, extractJsonObject, deliverPeerMsgs } from './tb-proxy-ai';
import { tbPersistAiProducts } from './tb-ai-store';
import { tbSkuForTag } from './tb-product-gen';
import type { RichAction } from '@/lib/chat-rich';

export type TbEngageApp = 'wx' | 'qq';

/** 礼物说明的追溯窗口（分享后 2 小时内说「给你买的」都算） */
const GIFT_WINDOW_MS = 2 * 60 * 60_000;

// 第十二轮用户反馈：参与冷却（原 5min/角色 + 3min 全局）整体删除——机主让买/让送多少次都照办，不再有「刚刚才送过，先歇一歇」拦截。

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ownerNameSync(): string {
  try {
    const s = tbGetSession();
    return s?.name || '机主';
  } catch {
    return '机主';
  }
}

/** 角色人设 system 段（人设+机主称呼+账号上下文；主动消息/取件道谢等场景共用） */
async function tbPersonaSystemFor(contact: ContactRecord, app: TbEngageApp): Promise<string> {
  const meName = ownerNameSync();
  return buildPersonaSystemPrompt(contact, {
    channel: app === 'wx' ? '微信' : 'QQ',
    userName: meName,
    ownerName: meName,
    accountId: getActiveAccountIdFor(app as AccountApp),
    multiApp: getMemSettings(contact.id).share,
  });
}

// ---------------- 购物话题扫描（目录/代买教学只在聊到买时注入，平时不占 token） ----------------

const SHOP_TEXT_RE =
  /(淘宝|买|购物|购物车|下单|种草|剁手|好物|商品|店铺|包邮|快递|包裹|取件|驿站|签收|收货|发货|物流|双十一|双11|618|年货|礼物|缺什么|推荐一|安利)/;

export function tbScanShopText(texts: (string | undefined | null)[]): boolean {
  for (const t of texts) {
    if (typeof t === 'string' && t && SHOP_TEXT_RE.test(t)) return true;
  }
  return false;
}

/** 机主说明「订单是给 AI 买的」的表达（礼物链路自动标记用） */
const GIFT_TEXT_RE = /(给你买|买给你|送给你|送你的|买给你的|给你的礼物|给你带|给你准备的)/;

// ---------------- AI 买演出票（[帮你买票:演出id]，喜剧脱口秀/演唱会；Task 3） ----------------

/** 演出/票务话题扫描（与商品目录同模式：聊到才注入演出清单，平时不占 token） */
const TICKET_TEXT_RE = /(买票|订票|购票|门票|演出|脱口秀|演唱会|相声|喜剧|话剧|舞台剧|漫才|音乐节|看演出)/;

/** 喜剧脱口秀固定场次时刻（对齐 taobao-channels 的 COMEDY_SESSION_TIMES，索引 = 偏移天数） */
const TB_AI_COMEDY_SESSIONS = [
  { start: '19:30', end: '21:30', price: 120 },
  { start: '19:30', end: '21:40', price: 120 },
  { start: '14:30', end: '16:40', price: 100 },
];

/** 喜剧小剧场自动配座（AI 买票）：随机挑 N 连座（最佳观影区优先，全区扫兑底） */
function tbAiPickComedySeats(qty: number): string[] {
  const runs: { r: number; c: number }[] = [];
  for (let r = 0; r < TB_SEAT_LAYOUT.length; r++) {
    const row = TB_SEAT_LAYOUT[r] ?? [];
    for (let c = 0; c + qty <= row.length; c++) {
      let ok = true;
      for (let k = 0; k < qty; k++) {
        if (!row[c + k] || tbSeatSold(r, c + k)) {
          ok = false;
          break;
        }
      }
      if (ok) runs.push({ r, c });
    }
  }
  const best = runs.filter((x) => x.r >= TB_BEST_ZONE.r1 && x.r <= TB_BEST_ZONE.r2);
  const pool = best.length > 0 ? best : runs;
  const pick = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : { r: 0, c: 0 };
  return Array.from({ length: qty }, (_, k) => `${pick.r + 1}排${pick.c + k + 1}座`);
}

export type TbAiTicketBuildResult =
  | { ok: true; order: TbOrder; desc: string }
  | { ok: false; error: string };

/**
 * 按演出 id（TB_COMEDY_SHOWS 喜剧脱口秀 / TB_CONCERTS 演唱会）生成真实场次并创建待付款票务订单
 * （喜剧=2 连座自动配座；演唱会=最低价可用票档×2；已开演/未开售/找不到 → 报错文案）。
 * 付款由调用方接 tbAiPayPendingOrder（AI 代付 → tbMarkPaid 票务特判直接出票 shipped）。
 */
export function tbAiBuildTicketOrder(uid: string, showId: string): TbAiTicketBuildResult {
  const sid = showId.trim();
  if (!sid) return { ok: false, error: '没有找到这场演出，买不了票' };
  const show = TB_COMEDY_SHOWS.find((s) => s.id === sid);
  if (show) {
    const day = [0, 1, 2].find((i) => !tbSessionStarted(tbRealDate(i).isoDate, TB_AI_COMEDY_SESSIONS[i].start));
    if (day === undefined) return { ok: false, error: '近期场次都已开演，买不了票' };
    const sess = TB_AI_COMEDY_SESSIONS[day];
    const real = tbRealDate(day);
    const seats = tbAiPickComedySeats(2);
    const order = tbCreateTicketOrder(uid, {
      kind: 'comedy',
      title: show.title,
      posterC1: show.c1,
      posterC2: show.c2,
      badge: show.tag,
      qty: 2,
      venue: show.venue,
      hall: '小剧场',
      date: real.isoDate,
      dateLabel: `${real.label} ${real.md}`,
      start: sess.start,
      end: sess.end,
      seats,
      unitPrice: sess.price,
    });
    return { ok: true, order, desc: `「${show.title}」的脱口秀门票（${seats.join('、')}）` };
  }
  const concert = TB_CONCERTS.find((c) => c.id === sid);
  if (!concert) return { ok: false, error: '没有找到这场演出，买不了票' };
  if (concert.status !== 'on') return { ok: false, error: `「${concert.artist}」的演唱会还没正式开售` };
  const tier = concert.tiers.filter((t) => t.left !== '已售罄').sort((a, b) => a.price - b.price)[0];
  if (!tier) return { ok: false, error: '这场演唱会的票都售罄了' };
  const sm = concert.dateRange.match(/(\d{1,2}:\d{2})/);
  const start = sm ? sm[1] : '19:00';
  const day = [0, 1, 2].find((i) => !tbSessionStarted(tbRealDate(i).isoDate, start));
  if (day === undefined) return { ok: false, error: '近期场次都已开演，买不了票' };
  const sess = tbSessionTime(day, start, { hours: 3 });
  const qty = 2;
  const order = tbCreateTicketOrder(
    uid,
    {
      kind: 'concert',
      title: `${concert.artist}「${concert.tour}」`,
      posterC1: concert.c1,
      posterC2: concert.c2,
      badge: '演唱会',
      qty,
      venue: concert.venue,
      hall: tier.name,
      date: sess.isoDate,
      dateLabel: `${sess.label} ${sess.md}`,
      start: sess.start,
      end: sess.end,
      seats: [`${tier.name}×${qty}`],
      unitPrice: tier.price,
    },
    { total: Math.round(tier.price * qty * 100) / 100 },
  );
  return { ok: true, order, desc: `${concert.artist}「${concert.tour}」的演唱会门票（${tier.name}×${qty}）` };
}

// ---------------- 商品目录（AI 推荐口径：多品类抽样 + 按最近聊天相关性前置；id 原样输出用） ----------------

/**
 * 第 22 轮重写（修「让 AI 买玩偶、AI 给买了手机」）：
 * - 相关前置：把机主最近几句话传进来，按「商品标题的 2-gram/英文词在聊天文本中的命中数」
 *   给全量商品打分，命中的商品整段前置成【与机主正在聊的相关商品】
 *   （聊「玩偶/毛绒玩具」→ 安抚玩偶毛绒玩具等贴题宝贝排在最上面，AI 抄 id 就不会再拿手机凑数）；
 * - 基础抽样：同 tag 去重多品类抽样（上限 14，控制 token），保证日常推荐不总是一类；
 * - 挑品纪律写进目录标题：没有贴合的商品就直说没有，绝不推荐毫不相干的品类。
 */
function catalogBlock(recentTexts: (string | undefined | null)[]): string {
  try {
    const all = tbSearchPool().filter((p) => p.id && p.title && p.price > 0);
    if (all.length === 0) return '';
    const text = recentTexts
      .filter((t): t is string => typeof t === 'string')
      .join(' ')
      .slice(-500);

    // 相关度打分：中文取标题相邻 2 字滑窗在聊天文本中命中（+1/个）；英文取 ≥3 字母词命中（+2/个）
    const gramScore = (title: string): number => {
      if (!text) return 0;
      const lower = text.toLowerCase();
      let score = 0;
      const norm = title.toLowerCase();
      for (let i = 0; i < norm.length - 1; i++) {
        const g = norm.slice(i, i + 2);
        if (/^[\u4e00-\u9fff]{2}$/.test(g) && lower.includes(g)) score += 1;
      }
      for (const w of norm.split(/[^a-z0-9]+/)) {
        if (w.length >= 3 && lower.includes(w)) score += 2;
      }
      return score;
    };

    const rel = all
      .map((p) => ({ p, s: gramScore(p.title) }))
      .filter((x) => x.s >= 1)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((x) => x.p);

    const seenTag = new Set<string>();
    const base: typeof all = [];
    for (const p of all) {
      if (base.length >= 14) break;
      if (seenTag.has(p.tag)) continue;
      seenTag.add(p.tag);
      base.push(p);
    }
    const line = (p: (typeof all)[number]) => `· id=${p.id} ${p.title.slice(0, 30)} ¥${fmt2(p.price)}`;
    const relFresh = rel.filter((p) => !base.includes(p));
    const parts: string[] = [];
    if (relFresh.length > 0) {
      parts.push(`【与机主正在聊的相关商品】（机主想要什么就优先从这里选最贴合的）\n${relFresh.map(line).join('\n')}`);
    }
    parts.push(`【其他在售商品】\n${base.map(line).join('\n')}`);
    return (
      `【淘宝在售商品目录】（推荐/代买只能从这份清单里选，id 必须原样抄写；` +
      `没有贴合机主所说的商品就直说没有或换个说法，绝不推荐毫不相干的品类凑数）\n${parts.join('\n\n')}`
    );
  } catch {
    return '';
  }
}

// ---------------- AI 代买草稿（kind='tbdraft'，机主确认后 AI 出钱下单；支持多商品，跨店分组下单） ----------------

/** 草稿商品条目 */
export interface TbDraftItem {
  pid: string;
  title: string;
  img?: string;
  price: number;
  qty: number;
  shopId: string;
  shopName: string;
}

export interface TbAiDraft {
  id: string;
  /** 淘宝账号 uid（订单归属） */
  uid: string;
  /** 商品清单（1~5 件；旧数据单商品在读取时回填为单元素数组） */
  items: TbDraftItem[];
  /** 发起的 AI 角色 */
  charId: string;
  charName: string;
  app: TbEngageApp;
  status: 'pending' | 'confirmed' | 'declined';
  createdAt: number;
  /** 首单订单 id（跨店多单时 = 第一单；旧数据/单店场景与 orderId 相同） */
  orderId?: string;
  /** 全部订单 id（跨店分组后可能多单） */
  orderIds?: string[];
  /** 实付金额（确认下单后回填，多单合计） */
  total?: number;
}

/** 草稿预估合计（未下单时展示） */
export function tbDraftEstimate(d: Pick<TbAiDraft, 'items'>): number {
  return Math.round(d.items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
}

export const TB_DRAFT_EVENT = 'tb-draft-changed';

function genDid(): string {
  return `tbdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function bumpDraftIndex(did: string): void {
  try {
    const idx = kvGet<string[]>('tb-draft-index') ?? [];
    if (!idx.includes(did)) kvSet('tb-draft-index', [...idx, did].slice(-30));
  } catch {
    /* 忽略 */
  }
}

function fireDraftEvent(): void {
  try {
    window.dispatchEvent(new CustomEvent(TB_DRAFT_EVENT));
  } catch {
    /* 忽略 */
  }
}

export function tbGetDraft(did: string): TbAiDraft | null {
  if (!did) return null;
  const d = kvGet<Partial<TbAiDraft> & { pid?: string; title?: string; price?: number; qty?: number; shopId?: string; shopName?: string; img?: string }>(`tb-draft:${did}`);
  if (!d || typeof d !== 'object' || (typeof d.pid !== 'string' && !Array.isArray(d.items))) return null;
  // 旧数据（单商品字段）回填为 items 单元素数组；新数据 items 必为非空数组
  const items: TbDraftItem[] = Array.isArray(d.items) && d.items.length > 0
    ? d.items.map((it) => ({
        pid: typeof it?.pid === 'string' ? it.pid : '',
        title: typeof it?.title === 'string' ? it.title : '淘宝商品',
        img: typeof it?.img === 'string' && it.img ? it.img : undefined,
        price: typeof it?.price === 'number' ? it.price : 0,
        qty: typeof it?.qty === 'number' && it.qty > 0 ? it.qty : 1,
        shopId: typeof it?.shopId === 'string' ? it.shopId : '',
        shopName: typeof it?.shopName === 'string' ? it.shopName : '淘宝好店',
      })).filter((it) => it.pid)
    : [
        {
          pid: typeof d.pid === 'string' ? d.pid : '',
          title: typeof d.title === 'string' ? d.title : '淘宝商品',
          img: typeof d.img === 'string' && d.img ? d.img : undefined,
          price: typeof d.price === 'number' ? d.price : 0,
          qty: typeof d.qty === 'number' && d.qty > 0 ? d.qty : 1,
          shopId: typeof d.shopId === 'string' ? d.shopId : '',
          shopName: typeof d.shopName === 'string' ? d.shopName : '淘宝好店',
        },
      ];
  if (items.length === 0) return null;
  return {
    ...d,
    id: typeof d.id === 'string' && d.id ? d.id : did,
    uid: typeof d.uid === 'string' ? d.uid : '',
    items,
    charId: typeof d.charId === 'string' ? d.charId : '',
    charName: typeof d.charName === 'string' ? d.charName : '好友',
    app: d.app === 'qq' ? 'qq' : 'wx',
    status: d.status === 'confirmed' ? 'confirmed' : d.status === 'declined' ? 'declined' : 'pending',
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
    orderId: typeof d.orderId === 'string' ? d.orderId : undefined,
    orderIds: Array.isArray(d.orderIds) ? d.orderIds.filter((x): x is string => typeof x === 'string') : undefined,
    total: typeof d.total === 'number' ? d.total : undefined,
  };
}

export type TbCreateDraftResult = { ok: true; draft: TbAiDraft } | { ok: false; error: string };

/** 创建 AI 代买草稿（商品必须存在于商品库；1~5 件，跨店也可；金额按商品价 × 数量预估） */
export function tbCreateAiDraft(opts: {
  uid: string;
  items: { pid: string; qty?: number }[];
  charId: string;
  charName: string;
  app: TbEngageApp;
}): TbCreateDraftResult {
  const items: TbDraftItem[] = [];
  for (const raw of opts.items.slice(0, 5)) {
    const p = productById(raw.pid);
    if (!p) return { ok: false, error: '没有找到这个商品，换一个推荐吧' };
    const qty = Math.max(1, Math.min(5, Math.round(raw.qty ?? 1)));
    if (items.some((it) => it.pid === p.id)) continue; // 同商品去重
    items.push({ pid: p.id, title: p.title, img: tbMainImg(p), price: p.price, qty, shopId: p.shopId, shopName: shopById(p.shopId).name });
  }
  if (items.length === 0) return { ok: false, error: '没有找到这个商品，换一个推荐吧' };
  const draft: TbAiDraft = {
    id: genDid(),
    uid: opts.uid,
    items,
    charId: opts.charId,
    charName: opts.charName,
    app: opts.app,
    status: 'pending',
    createdAt: Date.now(),
  };
  kvSet(`tb-draft:${draft.id}`, draft);
  bumpDraftIndex(draft.id);
  fireDraftEvent();
  return { ok: true, draft };
}

export function tbDeclineAiDraft(did: string): boolean {
  const d = tbGetDraft(did);
  if (!d || d.status !== 'pending') return false;
  kvSet(`tb-draft:${did}`, { ...d, status: 'declined' });
  fireDraftEvent();
  return true;
}

export type TbConfirmDraftResult = { ok: true; orderId: string; total: number } | { ok: false; error: string };

/**
 * 机主确认 AI 代买：商品按店铺分组建待付款订单（地址用当前收货地址）→ AI 逐单立即付款（演示语义）
 * → 每单一张订单分享卡（role peer，「X已买单」）回聊天 + 角色记忆。商品下架时拒绝。
 */
export function tbConfirmAiDraft(did: string): TbConfirmDraftResult {
  const d = tbGetDraft(did);
  if (!d) return { ok: false, error: '代买请求不存在或已过期' };
  if (d.status !== 'pending') return { ok: false, error: '这张代买请求已经处理过了' };
  // 全部商品仍在售才下单（任一下架拒绝，防跨店多商品漏买）
  for (const it of d.items) {
    if (!productById(it.pid)) return { ok: false, error: '有商品已下架，没法下单啦' };
  }
  // 按店铺分组建单（跨店多包裹）
  const groups = new Map<string, TbDraftItem[]>();
  for (const it of d.items) {
    const arr = groups.get(it.shopId);
    if (arr) arr.push(it);
    else groups.set(it.shopId, [it]);
  }
  const orders: TbOrder[] = [];
  for (const its of groups.values()) {
    const items: TbOrderItem[] = its.map((it) => ({ pid: it.pid, title: it.title, img: it.img ?? '', sku: {}, price: it.price, qty: it.qty }));
    const order = tbCreateOrder({ uid: d.uid, items, address: tbCurAddr(d.uid) ?? undefined });
    orders.push(order);
  }
  // 先落确认态防重复点击（金额以订单合计为准）
  const total = Math.round(orders.reduce((s, o) => s + o.total, 0) * 100) / 100;
  kvSet(`tb-draft:${did}`, { ...d, status: 'confirmed', orderId: orders[0].id, orderIds: orders.map((o) => o.id), total });
  fireDraftEvent();
  try {
    window.dispatchEvent(new CustomEvent('tb-orders-changed'));
  } catch {
    /* 忽略 */
  }
  // AI 出钱：逐单建 friend 方向代付记录并立即支付（完成回执卡丢弃，用订单分享卡替代）。
  // 第 22 轮（用户：AI 买东西不用等发货，挑好直接发给我）：付款成功后**直接送达**——
  // 跳过物流链路（待发货→已发货→驿站→取件）立即置为已完成，分享卡显示「已完成」，
  // 宝贝同步落进「礼物」页（已收货订单列表）
  for (const order of orders) {
    try {
      const paid = tbAiPayPendingOrder(order, { id: d.charId, name: d.charName, avatar: null }, d.app);
      if (paid.ok) tbInstantCompleteAiOrder(d.uid, order.id);
    } catch {
      /* 支付失败不阻断其余包裹 */
    }
  }
  // 订单分享卡（AI 发给机主，「X已买单」+ 实时状态时间线；跨店多单每单一张）+ 记忆
  void (async () => {
    try {
      const { tbCreateOrderShare } = await import('./tb-share-proxy');
      const all = tbLoadOrders(d.uid);
      for (const first of orders) {
        const fresh = all.find((o) => o.id === first.id) ?? first;
        await tbCreateOrderShare({
          order: fresh,
          idp: d.app,
          contactId: d.charId,
          fromName: d.charName,
          role: 'peer',
          paidBy: d.charName,
          content: `[淘宝订单分享]帮你挑好啦，直接买下送到你手上了~`,
        });
      }
    } catch {
      /* 分享卡失败不影响下单 */
    }
    const meName = ownerNameSync();
    const brief = d.items.map((i) => `「${i.title}」x${i.qty}`).join('、');
    const shops = [...new Set(d.items.map((i) => i.shopName))].join('、');
    memAddEventFragment(
      d.charId,
      d.app,
      `你帮机主${meName}在淘宝（${shops}）下单了${brief}（共¥${fmt2(total)}），已由你付款并直接送到TA手上（不用等物流）`,
      { eventTime: Date.now(), sourceTag: 'tb-buy-for' },
    );
  })();
  return { ok: true, orderId: orders[0].id, total };
}

// ---------------- 上下文注入（wechat/qq 私聊每回合构建） ----------------

export interface TbEngageCtx {
  /** 注入 system 的动态块（机主淘宝订单实时动态） */
  block: string;
  /** 追加到处理动作规则后的段落（礼物标记/待付订单/快递/代买教学；按条件出现） */
  rules: string[];
}

function orderBrief(o: TbOrder): string {
  const items = o.items.map((i) => `${i.title.slice(0, 14)}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、');
  return `· ${fmtClock(o.createdAt)} 「${o.shopName}」 ${items} ¥${fmt2(o.total)} · ${tbStatusText(o)}`;
}

/**
 * 每回合现场构建（全同步 kv 读，无副作用）。
 * 礼物候选：机主本轮/最近几句话说「给你买的」→ 不再直接标记（词表会误伤「买给你妹妹」「送你个表情包」），
 * 改为注入「礼物确认」规则让 AI 结合人设/记忆/上下文自主判断是不是真的送 AI 的礼物，
 * 是则输出 [收礼物:分享id]（执行器 tb-gift 落地礼物标记 + AI 取件安排 + 记忆）。
 */
export function buildTbEngageCtx(
  chatContactId: string,
  app: TbEngageApp,
  recentTexts: (string | undefined | null)[],
): TbEngageCtx {
  const empty: TbEngageCtx = { block: '', rules: [] };
  let session: ReturnType<typeof tbGetSession> = null;
  try {
    session = tbGetSession();
  } catch {
    session = null;
  }
  if (!session) return empty;
  const uid = tbUidOf(session);
  const owner = ownerNameSync();
  const orders = tbLoadOrders(uid);
  const rules: string[] = [];

  // —— 礼物候选（判断全交给 AI）：说「给你买的」类话 + 本聊天 2h 内未标记的分享卡 → 让 AI 自主确认
  const giftHit = GIFT_TEXT_RE.test(recentTexts.filter((t): t is string => typeof t === 'string').join(' '));
  if (giftHit) {
    try {
      const ids = kvGet<string[]>('tb-share-index') ?? [];
      const target = ids
        .map((sid) => tbGetShare(sid))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .filter((s) => s.idp === app && s.contactId === chatContactId && !s.gift && !s.paidBy && Date.now() - s.createdAt < GIFT_WINDOW_MS)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (target) {
        const order = tbShareOrderOf(target);
        const takable = !!order && order.status !== 'completed' && order.status !== 'cancelled' && !order.ticket;
        rules.push(
          `【礼物确认（由你判断）】机主最近的话里提到「给你买的」这类说法，而本聊天里有一张机主分享的淘宝订单（id:${target.id}，淘宝店「${target.shopName}」的${target.items.map((i) => `${i.name}x${i.qty}`).join('、')}，¥${fmt2(target.amount)}）。` +
            `结合你们正在聊的内容和你对这段关系的记忆判断：机主是不是说这张订单是送你的礼物？` +
            (takable
              ? `如果是 → 本轮回复里输出标记 [收礼物:${target.id}]（id 原样抄写；系统会记下这份礼物，包裹到驿站后你自己去取），正文同时按人设自然回应；`
              : `这张订单已不能代取（已签收/取消），不用输出标记，按人设自然聊就好；`) +
            `如果机主说的是买给别人（TA的家人朋友）、送表情包之类虚拟物、或只是随口一提不是礼物 → 不要输出标记，正常聊天。`,
        );
      }
    } catch {
      /* 礼物候选扫描失败不影响聊天 */
    }
  }

  // —— 动态块：最近订单（AI 知道机主买了什么/哪家店/多少钱/什么时候/快递状态，可自然提起、主动问）
  const recent = orders.filter((o) => o.status !== 'cancelled' && !o.ticket).slice(0, 5);
  const block = recent.length > 0
    ? `【${owner}的淘宝动态】（实时状态，可以自然提起、主动关心快递进度）\n${recent.map(orderBrief).join('\n')}`
    : '';

  // —— 聊天内的代付请求（direction 'friend'：机主发给该 AI 的；待付 + 已婉拒可改主意）→ [代付淘宝:请求id]
  //（机主再次开口说「帮我代付/付一下」时，AI 用这个标记真正执行支付——修「AI 只能嘴上说再发一次」的死锁）
  const friendPending = tbPendingProxiesOfChat(chatContactId).filter((p) => p.direction === 'friend');
  const friendDeclined = (() => {
    try {
      return (kvGet<string[]>('tb-proxy-index') ?? [])
        .map((pid) => tbGetProxy(pid))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .filter((p) => p.direction === 'friend' && p.status === 'declined' && tbProxyChatCid(p) === chatContactId)
        // 订单仍是待付款才教「可以改主意帮付」（已支付/取消的单支付必失败，不占上下文）
        .filter((p) => {
          try {
            const o = tbLoadOrders(p.uid).find((x) => x.id === p.orderId);
            return !!o && o.status === 'pendingPay';
          } catch {
            return false;
          }
        })
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 2);
    } catch {
      return [];
    }
  })();
  if (friendPending.length > 0 || friendDeclined.length > 0) {
    const lines = [
      ...friendPending.map((p) => `· id=${p.id} 淘宝店「${p.shopName}」 ¥${fmt2(p.amount)}（${p.items.map((i) => `${i.name}x${i.qty}`).join('、')}）${p.note ? ` 备注:${p.note}` : ''} · 请求人:${p.fromName} · 待代付`),
      ...friendDeclined.map((p) => `· id=${p.id} 淘宝店「${p.shopName}」 ¥${fmt2(p.amount)}（${p.items.map((i) => `${i.name}x${i.qty}`).join('、')}） · 请求人:${p.fromName} · 你之前婉拒了（订单还在待付款，机主又开口的话可以改主意）`),
    ];
    rules.push(
      `【待你处理的淘宝代付请求】\n${lines.join('\n')}\n` +
        `机主希望你帮忙支付上面的订单（订单仍是待付款状态才能代付）。是否代付完全由你按人设、你们的关系、记忆和金额自主决定：愿意就先说一句，再单独输出标记 [代付淘宝:请求id]（系统会立即支付并发出回执卡片，id 必须原样抄写；之前婉拒过的也可以改主意帮TA付，系统会把请求卡改成已代付）；不想付或觉得不合适就用正文自然婉拒（可以调侃、可以撒娇说下次），不要输出标记——婉拒后这张请求卡会显示「对方婉拒了」，TA还可以自己支付或再找别人。30 分钟内不付款订单会自动取消。`,
    );
  }

  // —— AI 自己发出去的代付请求（等机主付）
  const mePending = tbPendingProxiesOfChat(chatContactId).filter((p) => p.direction === 'me');
  if (mePending.length > 0) {
    rules.push(
      `【你发出去的淘宝代付请求（等机主帮你付）】\n${mePending.map((p) => `· 淘宝店「${p.shopName}」 ¥${fmt2(p.amount)}（${p.items.map((i) => `${i.name}x${i.qty}`).join('、')}）· 待机主支付`).join('\n')}\n可以自然提起（按人设撒娇催一催），机主点卡片就能帮你付；不要重复发请求。`,
    );
  }

  // —— 待付款订单 → [帮付淘宝:订单id]（一/五：AI 按人设记忆判断是否主动代付）
  const proxyOrderIds = new Set<string>();
  try {
    for (const pid of kvGet<string[]>('tb-proxy-index') ?? []) {
      const p = tbGetProxy(pid);
      if (p && p.status === 'pending') proxyOrderIds.add(p.orderId);
    }
  } catch {
    /* 忽略 */
  }
  const helpable = orders.filter((o) => o.status === 'pendingPay' && !proxyOrderIds.has(o.id));
  if (helpable.length > 0) {
    const lines = helpable.slice(0, 4).map((o) => `· 订单id=${o.id} 淘宝店「${o.shopName}」 ${o.items.map((i) => `${i.title.slice(0, 14)}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、')} ¥${fmt2(o.total)}`);
    rules.push(
      `【${owner}的待付款淘宝订单】\n${lines.join('\n')}\n` +
        `如果符合你的人设、你们的关系和上面的记忆（说好要送TA、想宠TA、TA正好缺这个等），可以主动帮TA付掉：输出标记 [帮付淘宝:订单id]（id 必须原样抄写，系统会立即支付并回执）。` +
        `要不要直接付、还是先在正文里提一句看TA反应，都由你按人设/关系/上下文自然拿捉（没有金额限制，也别每次都抢着付）。`,
    );
  }

  // —— 在途快递 → [帮取快递:订单id]（机主开口让 AI 取件）
  const express = orders.filter((o) => o.status === 'shipped' && !o.ticket && !o.aiPickup);
  if (express.length > 0) {
    const lines = express.slice(0, 4).map((o) => `· 订单id=${o.id} 淘宝店「${o.shopName}」 ${o.items.map((i) => `${i.title.slice(0, 14)}`).join('、')} · ${tbArrivedAtStation(o) ? '已到驿站待取件' : '还在路上'}`);
    rules.push(
      `【${owner}的淘宝快递】\n${lines.join('\n')}\n` +
        `机主让你帮忙取快递/取件时：输出标记 [帮取快递:订单id]（id 原样抄写）。已到驿站的会立即取好；还在路上的会记下来，到驿站后你自动去取并回消息。取完记得按人设说一句。`,
    );
  }

  // —— 购物话题 → 商品目录 + [帮你买]（直接买+即时送达+礼物卡，仅微信）+ [自己买]（自己买请机主付）
  if (tbScanShopText(recentTexts)) {
    const cat = catalogBlock(recentTexts);
    if (cat) {
      // [帮你买] 直购与 [送礼物] 都是微信端礼物卡链路：QQ 端不注入教学（执行器会拒，避免 AI 空承诺）
      const buyRule =
        app === 'wx'
          ? `【帮机主买淘宝商品（你出钱，直接买）】聊到想买什么/缺什么/让你推荐/求你买时，结合你记得的偏好、当前季节节日、机主买过的东西先聊一句，然后直接输出标记 [帮你买:商品id|数量?,商品id|数量?]（id 原样抄目录，数量可省略默认 1；多个商品用英文逗号分隔，最多 5 件）。选品必须贴合机主正在说的东西（优先从【与机主正在聊的相关商品】里选；比如机主说想买玩偶/毛绒玩具就绝不能推荐手机数码）。目录里没有想要的？不用放弃——直接把宝贝名字写进标记并在最前面加 *（例如 [帮你买:*定制款奶油兔玩偶大号|1]），系统会现场帮你把这个宝贝上架，再由你付款买下直接送出（一样走礼物卡+礼物页），所以几乎任何合理的东西你都能买到送TA。系统会立即下单（你付款）、不用等物流直接送达，并以礼物卡片形式送进聊天（TA 点开就能收下），宝贝同时落进 TA 的礼物页——没有确认卡片、不用再问一遍。金额没有上限，买多少钱由你按人设/关系/上下文自然拿捉。机主说「再买一个/换一个/重新买/没送对」时同样直接输出标记，可以连续多次买，没有任何次数或频率限制；决不能因为「刚送过」就拒绝或空口答应。\n【回执行不是标记】历史里形如 [礼物卡片 ID:…]（你送出…）的方括号行是系统内部的记录格式，你只能读它，绝不能把它复制/仿写到你的回复里——抄了也没有任何效果，真实送出只有 [帮你买:…]/[送礼物:…] 标记才会执行。\n`
          : '';
      const giftRule =
        app === 'wx'
          ? `【你想送礼物给机主（你出钱直接送）】聊到送礼物/生日节日纪念日/哄TA开心/TA提到喜欢什么时（按人设与关系判断），输出标记 [送礼物:商品id]（id 原样抄目录，选贴合对方心意的）——系统会把礼物以卡片形式送到聊天里，TA 点开就能收下；目录里没有合心意的就直接写宝贝名字并在前面加 *（例如 [送礼物:*永生花礼盒]），系统会现场帮你上架这个宝贝再送出。送之前用正文铺垫一句心意。送过几次都不受限制，机主要就送；别把历史里的 [礼物卡片 ID:…]（你送出…）回执行照抄进回复，那不是标记、没有效果。`
          : '';
      rules.push(
        `${cat}\n\n` +
          buyRule +
          `【你自己想买（机主出钱）】你自己种草了什么/缺什么的时候（按人设判断，别频繁），输出标记 [自己买:商品id|数量?]——系统会生成待付款订单并请机主帮你代付，记得用正文说一句让TA帮你付。` +
          (giftRule ? `\n${giftRule}` : ''),
      );
    }
  }

  // —— 演出/票务话题 → 近期演出清单 + [帮你买票]（AI 自主决定帮机主买喜剧脱口秀/演唱会票）
  if (tbScanShopText(recentTexts) || TICKET_TEXT_RE.test(recentTexts.filter((t): t is string => typeof t === 'string').join(' '))) {
    const showLines = TB_COMEDY_SHOWS.slice(0, 4).map((s) => `· 喜剧脱口秀 id=${s.id} 「${s.title}」 ${s.venue} · ${s.dateRange} · ¥${s.price}`);
    const concertLines = TB_CONCERTS.slice(0, 4).map((c) => {
      const ps = c.tiers.map((t) => t.price);
      return `· 演唱会 id=${c.id} 「${c.artist}《${c.tour}》」 ${c.venue} · ${c.dateRange} · ¥${Math.min(...ps)}-${Math.max(...ps)}${c.status === 'soon' ? '（预售未开售）' : ''}`;
    });
    rules.push(
      `【近期演出（帮机主买票只能从这个清单选，id 必须原样抄写）】\n${[...showLines, ...concertLines].join('\n')}\n` +
        `机主想让你帮买票/订票时，结合你的人设、关系和金额自主决定买不买、买哪场：愿意就输出标记 [帮你买票:演出id]（系统会自动选场次下单、由你付款出票，并把订单分享到聊天）；不想买或觉得不合适就正常聊天婉拒。金额没有上限，但别每次都抢着买。`,
    );
  }

  return { block, rules };
}

// ---------------- 运行时兜底（第十二轮反馈） ----------------

/**
 * 按聊天文本从淘宝目录挑最贴合的商品 id（机主明确要买/要送但 AI 只嘴上答应、没输出
 * [帮你买]/[送礼物] 标记时，wechat.tsx 兜底合成代买动作用）。
 * 评分与 catalogBlock 同款：中文标题 2 字滑窗在文本中命中 +1/个、英文 ≥3 字母词 +2/个；
 * 阈值 ≥2（单个常见双字撞词不触发），无达标返回 null（目录实在没贴合就尊重 AI 的婉拒）。
 */
export function tbPickProductForText(text: string): string | null {
  try {
    const all = tbSearchPool().filter((p) => p.id && p.title && p.price > 0);
    if (!all.length || !text.trim()) return null;
    const lower = text.toLowerCase();
    const gramScore = (title: string): number => {
      let score = 0;
      const norm = title.toLowerCase();
      for (let i = 0; i < norm.length - 1; i++) {
        const g = norm.slice(i, i + 2);
        if (/^[\u4e00-\u9fff]{2}$/.test(g) && lower.includes(g)) score += 1;
      }
      for (const w of norm.split(/[^a-z0-9]+/)) {
        if (w.length >= 3 && lower.includes(w)) score += 2;
      }
      return score;
    };
    let best: { id: string; s: number } | null = null;
    for (const p of all) {
      const s = gramScore(p.title);
      if (s >= 2 && (!best || s > best.s)) best = { id: p.id, s };
    }
    return best?.id ?? null;
  } catch {
    return null;
  }
}

// ---------------- AI 自主创建宝贝（第十三轮用户反馈：目录里没有的现场创建，不再「没找到这个商品」） ----------------

/** 宝贝名 → 淘宝品类启发式（分类/图/店铺都按它走） */
function guessTbCat(name: string): TbCatId {
  const n = name.toLowerCase();
  if (/手机|耳机|电脑|笔记本|平板|手表|键盘|音箱|音响|充电|相机|摄像机|鼠标|显示器|电视|无人机|手柄|硬盘|路由|智能|戒指环|灯泡智能/.test(n)) return 'digital';
  if (/口红|香水|护肤|面膜|面霜|乳液|精华|眼影|粉底|化妆|眉笔|睫毛|美容仪/.test(n)) return 'beauty';
  if (/零食|糖果|糖|茶|咖啡豆|坚果|辣条|饼干|蛋糕|巧克力|蜂蜜|果汁|饮料|大米|粮油|挂面/.test(n)) return 'food';
  if (/书|小说|漫画|绘本|教辅|杂志|字典|词典/.test(n)) return 'book';
  if (/衣|裙|裤|鞋|袜|帽|包|围巾|皮带|衫|卫衣|外套|西装|睡衣|家居服|领带|首饰|项链|手链|戒指|耳环/.test(n)) return 'fashion';
  return 'home';
}

/** 宝贝名 → 主图 tag 启发式（本地卡通图池关键词映射；未命中走品类默认图，任何情况都有图） */
function guessTbTag(name: string, cat: TbCatId): string {
  const n = name.toLowerCase();
  const rules: [RegExp, string][] = [
    [/玩偶|娃娃|公仔|毛绒|抱枕|手办|盲盒/, 'toy'],
    [/手机/, 'phone'], [/耳机/, 'earbuds'], [/电脑|笔记本/, 'laptop'], [/平板/, 'tablet'], [/手表/, 'watch'],
    [/键盘/, 'keyboard'], [/音箱|音响/, 'speaker'], [/充电|充电宝/, 'powerbank'], [/相机/, 'camera'],
    [/鼠标/, 'mouse'], [/显示器/, 'monitor'], [/电视/, 'tv'], [/风扇/, 'fan'], [/加湿/, 'humidifier'],
    [/口红|唇釉|唇泥/, 'lipstick'], [/香水/, 'perfume'], [/面膜|面霜|乳液|精华|水乳|护肤/, 'skincare'], [/眼影|粉底|气垫|腮红/, 'makeup'],
    [/零食|坚果|辣条|礼包/, 'snacks'], [/饼干|曲奇|糕|蛋糕|甜点/, 'cookies'], [/茶|茶叶/, 'tea'],
    [/沙发/, 'sofa'], [/床|被|四件套|枕/, 'bedding'], [/台灯|灯/, 'lamp'], [/杯/, 'water-bottle'], [/马克杯|陶瓷杯/, 'mug'],
    [/花瓶|鲜花|花/, 'vase'], [/伞/, 'umbrella'], [/鞋/, 'sneakers'], [/裙|连衣裙/, 'dress'], [/卫衣|连帽/, 'hoodie'],
    [/外套|夹克|风衣|大衣/, 'jacket'], [/包|背包|双肩/, 'backpack'], [/围巾|手套/, 'scarf'], [/行李箱|旅行箱/, 'suitcase'],
    [/钱包|卡包/, 'wallet'], [/墨镜|太阳镜/, 'sunglasses'], [/梳|化妆刷|刷/, 'brush'], [/项链|手链|戒指|耳环|首饰/, 'gift'],
    [/礼物|礼品|礼盒/, 'gift'], [/书|小说|漫画|绘本/, 'books'],
  ];
  for (const [re, tag] of rules) {
    if (re.test(n)) return tag;
  }
  return cat === 'digital' ? 'phone' : cat === 'fashion' ? 'tshirt' : cat === 'beauty' ? 'skincare' : cat === 'food' ? 'snacks' : cat === 'book' ? 'books' : 'gift';
}

/** 宝贝名 → 价格启发式（元） */
function guessTbPrice(name: string): number {
  const n = name.toLowerCase();
  if (/手机|笔记本|电脑|相机|摄像机/.test(n)) return 2999;
  if (/平板|显示器|电视|无人机/.test(n)) return 1599;
  if (/手表|音箱|键盘|耳机/.test(n)) return 199;
  if (/香水|精华|美容仪/.test(n)) return 129;
  if (/口红|唇釉|眼影|粉底/.test(n)) return 79;
  if (/玩偶|娃娃|公仔|毛绒|手办|盲盒/.test(n)) return 45;
  if (/衣|裙|裤|鞋|包|卫衣|外套/.test(n)) return 99;
  if (/零食|糖|茶|坚果|饼干|蛋糕|书|小说|漫画/.test(n)) return 39.9;
  if (/杯|伞|灯|枕|摆件/.test(n)) return 29.9;
  return 68;
}

/**
 * 宝贝名 → 商品（永不失败）：AI 在 [帮你买]/[送礼物]/[自己买] 里写了一个目录里没有的宝贝名时
 * 现场创建并注册上架（价格/分类/图按名启发式；id 走 ai- 前缀 → 随 AI 商品注册表持久化，
 * 刷新恢复后照常可搜/可下单，下次同名直接命中）。
 */
function ensureTbProductAi(name: string, uid: string): TbProduct {
  const clean = name.trim().slice(0, 40);
  const cat = guessTbCat(clean);
  const tag = guessTbTag(clean, cat);
  const price = guessTbPrice(clean);
  const p: TbProduct = {
    id: `ai-c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: clean,
    price,
    originPrice: Math.round(price * 1.6),
    sales: 500 + Math.floor(Math.random() * 4000),
    shopId: tbShopIdForTag(tag),
    cat,
    tag,
    freight: 0,
    tags: ['退货宝', '正品保证'],
    skus: tbSkuForTag(tag, price),
  };
  try {
    tbPersistAiProducts(uid, [p]); // 注册进运行时注册表 + 按 uid 持久化（刷新恢复）
  } catch {
    /* 持久化失败不影响本次下单 */
  }
  // 第十四轮：AI 自创宝贝自动生成写实真图（设置›图像生成模型优先，内置服务端兜底；
  // fire-and-forget 不阻塞下单，成功后覆盖管线落库+广播事件，全渲染点即时换真图）
  try {
    fireAiProductImg('tb', p.id, clean);
  } catch {
    /* 生图调度失败不影响本次下单 */
  }
  return p;
}

/** 标记体里的一段是否是「自定义宝贝名」（含中文、去掉可选 * 前缀后 2~40 字；商品 id 全 ASCII 不会误伤） */
function customProductName(raw: string): string | null {
  const s = raw.trim().replace(/^[*＊]+/, '').trim();
  if (s.length < 2 || s.length > 40) return null;
  if (!/[\u4e00-\u9fff]/.test(s)) return null;
  return s;
}

/**
 * 第十三轮运行时兜底配套：从聊天文本里提取「机主想要的宝贝名」（目录里实在没有、
 * AI 又只嘴上答应没输出标记时，由 wechat.tsx 兕底合成为 [帮你买:*名字] 走自创链路）。
 * 提取不到合理宝贝名返回 null（不强买）。
 */
export function tbCustomProductFromText(text: string): string | null {
  try {
    // 净化：门牌号[M33]/方括号标记/引号统一替换为句读（防止标记残骸混进宝贝名）
    const t = text.replace(/\s+/g, '').replace(/\[M\d+\]/g, '，').replace(/\[[^\]]{1,16}\]/g, '，').replace(/[「」『』"]/g, '');
    const valids: string[] = [];
    const consider = (cap?: string) => {
      if (!cap) return;
      const s = cap
        .replace(/^(一个|一份|一只|一台|一盒|一套|这个|那个|就|个)+/g, '')
        .split(/我要|我想|请你|麻烦你|给我买|帮我买|买一个|买一份|谢谢/)[0]
        .replace(/[吧呀哦嗯呢哈嘛呗了啦～~!！?？。，,.\s]+$/g, '')
        .trim();
      if (s.length >= 2 && s.length <= 14 && /[\u4e00-\u9fff]/.test(s) && !/的$/.test(s) && !/^(东西|礼物|宝贝|它|这个|那个|送我|给我|我来|一个)$/.test(s) && !/(话题|别的|聊天|风格|音乐|歌|铃声|故事|天气|给你|送给你|送我|谢谢|好不好)/.test(s)) valids.push(s);
    };
    // A 欲望动词式：「想要/就要/买个…X」（到句读/语气词为止）
    for (const m of t.matchAll(/(?:想要|想买|要买|就要|就想|买个|买一|买台|买只|买份|来个|弄个|整个|给我整|给我来)([^，。！？!?,.～~]{2,16}?)(?=[，。！？!?,.~～]|吧|呀|哦|嘛|呗|哈|啦|了|谢谢|好不好|可以|送我|给我|下单|放|摆|挂|吃|穿|戴|用|抱|铺|盖|$)/g)) consider(m[1]);
    // B 指示式：「这个/那个 X（吧/了/，）」
    for (const m of t.matchAll(/(?:这个|那个)([^，。！？!?,.～~]{2,16}?)(?=[，。！？!?,.~～]|吧|呀|哦|嘛|了|就|的|啦|$)/g)) consider(m[1]);
    // C 拍板式：「那 X 就定了/就那个」
    for (const m of t.matchAll(/(?:那|那就)([^，。！？!?,.～~]{2,16}?)(?=就定了|定了|就那个|就这个|就它|吧|啦|$)/g)) consider(m[1]);
    // D AI 承诺式：「弄/买/送 一个 X（上架/给你/送你…）」
    for (const m of t.matchAll(/(?:弄|买|做|找|送)一?[个份只台盒套]([^，。！？!?,.～~]{2,14}?)(?=上架|给你|送你|送我|买好|寄|啦|了|哦|呀|哈|$)/g)) consider(m[1]);
    // 多个候选时取最短（口语尾巴剥得最干净的那个，如「草莓加湿器」胜过「草莓加湿器就定了」）
    return valids.sort((a, b) => a.length - b.length)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * 第十三轮兜底防双投递守卫：同一回合管线可能对同一段回复二次构建（文本消息同 id 会被去重，
 * 兜底卡若用随机 id 会双投）。同一把 key（会话+机主原话+AI回复）90 秒内只放行一次。
 */
let tbFallbackLast = { key: '', at: 0 };
export function tbFallbackShouldFire(key: string): boolean {
  const now = Date.now();
  if (tbFallbackLast.key === key && now - tbFallbackLast.at < 90_000) return false;
  tbFallbackLast = { key, at: now };
  return true;
}

/** 兜底礼物卡确定性 id（同 seed 永远同 id：即使守卫窗口外的重复构建也能被按 id 去重） */
export function tbFallbackCardId(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `tbgift-fb-${h.toString(36)}-${seed.length}`;
}

// ---------------- 动作执行（wechat/qq buildReplyMsgs 分流调用） ----------------

export type TbEngageActionKind = 'tb-pay-for' | 'tb-order-draft' | 'tb-order-self' | 'tb-pickup' | 'tb-gift' | 'tb-proxy-pay' | 'tb-buy-ticket' | 'tb-gift-send';

export function isTbEngageActionKind(kind: string): kind is TbEngageActionKind {
  return kind === 'tb-pay-for' || kind === 'tb-order-draft' || kind === 'tb-order-self' || kind === 'tb-pickup' || kind === 'tb-gift' || kind === 'tb-proxy-pay' || kind === 'tb-buy-ticket' || kind === 'tb-gift-send';
}

/** 执行器产出的卡片消息（微信 WxMsg / QQ QQMsg 结构子集，直接 push 进回复队列） */
export type TbEngageCard =
  | { id: string; role: 'peer'; content: string; time: number; kind: 'tbpay'; tbpay: { pid: string; role: 'req' | 'done' } }
  | { id: string; role: 'peer'; content: string; time: number; kind: 'tbdraft'; tbdraft: { did: string } }
  /** 礼物卡片（第 21 轮 [送礼物:商品id]，仅微信端）：结构兼容 wx-gift.tsx WxGiftData（lib 不反向引组件，内联同构） */
  | { id: string; role: 'peer'; content: string; time: number; kind: 'giftcard'; gift: { id: string; name: string; countLabel: string; image: string; shop?: string; accepted?: boolean } };

export interface TbEngageExecResult {
  msgs: TbEngageCard[];
  /** 需要以系统行展示的提示（执行失败原因等）；空 = 静默 */
  sys?: string;
}

/** 异步流失败的系统提示行直写聊天并广播（与美团 insertEngageSys 同款） */
function insertEngageSys(app: TbEngageApp, contactId: string, text: string): void {
  try {
    const key = `${app}-chat-msgs:${contactId}`;
    const cur = kvGet<unknown[]>(key) ?? [];
    kvSet(key, [
      ...cur,
      { id: `tbsy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, role: 'peer', content: '', time: Date.now(), kind: 'sys', sys: { text } },
    ].slice(-100));
  } catch {
    /* 落库失败静默 */
  }
  try {
    window.dispatchEvent(new CustomEvent(TB_PROXY_CARD_EVENT, { detail: { cid: contactId, app } }));
  } catch {
    /* 忽略 */
  }
}

export function tbEngageSessionUid(): { uid: string; name: string } | null {
  try {
    const s = tbGetSession();
    return s ? { uid: tbUidOf(s), name: s.name } : null;
  } catch {
    return null;
  }
}

/** 机主联系人（direction 'me' 代付的付款人；与美团 mtOwnerContactFor 同口径） */
export async function tbOwnerContactFor(app: TbEngageApp): Promise<{ id: string; name: string; avatar: string | null } | null> {
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

export function applyTbEngageAction(
  action: RichAction,
  peer: ContactRecord,
  opts: { app: TbEngageApp; meName?: string; recentTexts?: (string | undefined | null)[] },
): TbEngageExecResult {
  const now = Date.now();
  const kind = action.kind;
  const meName = opts.meName?.trim() || ownerNameSync() || '机主';
  const uidInfo = tbEngageSessionUid();

  if (kind === 'tb-gift') {
    // [收礼物:分享id]：AI 结合人设/记忆/上下文自主确认「机主说的是送我的礼物」后才落地
    //（词表粗筛会误伤「买给你妹妹」「送你个表情包」，判断权全在 AI）
    const sid = action.targetId.trim();
    const share = sid ? tbGetShare(sid) : null;
    if (!share || share.idp !== opts.app || share.contactId !== peer.id) return { msgs: [] };
    if (share.gift) return { msgs: [] }; // 已标记过（幂等）
    const order = tbShareOrderOf(share);
    kvSet(`tb-share:${share.id}`, { ...share, gift: true });
    if (order && !order.aiPickup && order.status !== 'completed' && order.status !== 'cancelled' && !order.ticket) {
      const list = tbLoadOrders(order.uid);
      const hit = list.find((o) => o.id === order.id);
      if (hit && !hit.aiPickup) {
        hit.aiPickup = { contactId: peer.id, contactName: peer.name, app: opts.app, kind: 'gift' };
        tbSaveOrders(order.uid, list);
        try {
          window.dispatchEvent(new CustomEvent('tb-orders-changed'));
        } catch {
          /* 忽略 */
        }
      }
    }
    memAddEventFragment(
      peer.id,
      opts.app,
      `机主${meName}把淘宝「${share.shopName}」的订单（${share.items.map((i) => `${i.name}x${i.qty}`).join('、')}，¥${fmt2(share.amount)}）送给你了——包裹到驿站后你要自己去取`,
      { eventTime: now, sourceTag: 'tb-gift' },
    );
    return { msgs: [] };
  }

  if (kind === 'tb-pay-for') {
    // [帮付淘宝:订单id]：AI 主动为机主的待付款订单代付（无金额门槛，
    // 要不要付由 AI 按人设/记忆/上下文自主拿捉——词表判定已按用户要求移除）
    if (!uidInfo) return { msgs: [], sys: '（淘宝尚未登录，无法帮付）' };
    const order = tbLoadOrders(uidInfo.uid).find((o) => o.id === action.targetId.trim());
    if (!order || order.status !== 'pendingPay') return { msgs: [], sys: '（订单不存在或已支付）' };
    const res = tbAiPayPendingOrder(order, { id: peer.id, name: peer.name, avatar: avatarFor(peer, opts.app) }, opts.app);
    if (!res.ok) return { msgs: [], sys: `（帮付未成功：${res.error}）` };
    const summary = order.items.map((i) => `${i.title.slice(0, 14)}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、');
    memAddEventFragment(
      peer.id,
      opts.app,
      `你主动帮机主${meName}付了淘宝「${order.shopName}」¥${fmt2(order.total)}的订单（${summary}）`,
      { eventTime: now, sourceTag: 'tb-help-pay' },
    );
    return { msgs: res.card ? [res.card as TbEngageCard] : [] };
  }

  if (kind === 'tb-proxy-pay') {
    // [代付淘宝:请求id]：AI 支付机主发来的代付请求（仅 direction 'friend' 且落在自己聊天）。
    // 这是用户明确再次开口的代付执行路径（机主发了请求卡后 AI 第一次没付/婉拒，TA 在聊天里
    // 再说「帮我代付/付一下」）——仅校验状态防重复；
    // 之前婉拒的请求也允许改主意帮付（先复活为待付再走支付，请求卡随回执卡一起变已代付）
    const pid = action.targetId.trim();
    const p = tbGetProxy(pid);
    if (!p || (p.status !== 'pending' && p.status !== 'declined') || p.direction !== 'friend' || tbProxyChatCid(p) !== peer.id) {
      return { msgs: [], sys: '（代付请求不存在或已处理）' };
    }
    if (p.status === 'declined') kvSet(`tb-proxy:${p.id}`, { ...p, status: 'pending' });
    const res = tbProxyPayOrder(pid, { deferCard: true });
    if (!res.ok) {
      // 支付失败（订单已支付/取消）：婉拒复活的请求回滚为婉拒，避免残留 pending 死锁
      if (p.status === 'declined') kvSet(`tb-proxy:${p.id}`, { ...p, status: 'declined', closeReason: '对方婉拒了这次代付' });
      return { msgs: [], sys: `（代付未成功：${res.error}）` };
    }
    if (!res.card) return { msgs: [], sys: '（代付未完成，请稍后再试）' };
    const summary = p.items.map((i) => `${i.name}x${i.qty}`).join('、');
    memAddEventFragment(peer.id, opts.app, `机主${meName}在淘宝请你代付「${p.shopName}」的订单（¥${fmt2(p.amount)}，${summary}），你同意并已支付`, { eventTime: now, sourceTag: 'tb-proxy-pay' });
    return { msgs: [res.card as TbEngageCard] };
  }

  if (kind === 'tb-buy-ticket') {
    // [帮你买票:演出id]：AI 按人设自主帮机主买演出票（喜剧脱口秀/演唱会）——
    // 真实场次生成 pendingPay 票务订单 → AI 代付（tbMarkPaid 票务特判直接出票 shipped）→ 订单分享卡回聊天
    if (!uidInfo) return { msgs: [], sys: '（淘宝尚未登录，无法买票）' };
    const built = tbAiBuildTicketOrder(uidInfo.uid, action.targetId);
    if (!built.ok) return { msgs: [], sys: `（${built.error}）` };
    const payRes = tbAiPayPendingOrder(built.order, { id: peer.id, name: peer.name, avatar: avatarFor(peer, opts.app) }, opts.app);
    if (!payRes.ok) return { msgs: [], sys: `（买票未成功：${payRes.error}）` };
    // 异步收尾：订单分享卡（AI 发给机主「X已买单」；票务单渲染演出票卡）+ 角色记忆（完成回执卡用分享卡替代）
    const appSnapshot = opts.app;
    const meNameSnapshot = meName;
    void (async () => {
      try {
        const { tbCreateOrderShare } = await import('./tb-share-proxy');
        const fresh = tbLoadOrders(uidInfo.uid).find((o) => o.id === built.order.id) ?? built.order;
        await tbCreateOrderShare({
          order: fresh,
          idp: appSnapshot,
          contactId: peer.id,
          fromName: peer.name,
          role: 'peer',
          paidBy: peer.name,
          content: `[淘宝订单分享]帮你在「${fresh.shopName}」买好票啦，我付好了~`,
        });
      } catch {
        /* 分享卡失败不影响出票 */
      }
      memAddEventFragment(peer.id, appSnapshot, `你帮机主${meNameSnapshot}买了${built.desc}（¥${fmt2(built.order.total)}），已由你付款出票`, { eventTime: Date.now(), sourceTag: 'tb-buy-ticket' });
    })();
    return { msgs: [] };
  }

  if (kind === 'tb-order-draft') {
    // [帮你买:商品id|数量?,...]（第二十二轮用户反馈：删除「帮你挑的宝贝」确认卡——机主说买就直接买）：
    // 立即建单（按店分组）→ AI 付款 → 跳过物流即时送达（tbInstantCompleteAiOrder，宝贝同步落进礼物页已收货列表）
    // → 以微信礼物卡（kind='giftcard'，点卡开收礼弹窗）发进聊天；多商品跨店分单但聊天里只发一张礼物卡
    if (!uidInfo) return { msgs: [], sys: '（淘宝尚未登录，无法代买）' };
    if (opts.app !== 'wx') return { msgs: [], sys: '（直接代买送礼物暂时只在微信里支持）' };
    const body = parseTbBuyBody(action.targetId);
    if (!body) return { msgs: [], sys: '（代买格式有误，未能下单）' };
    // 商品校验 + 数量规范（任一商品不存在则整单拒绝，提示 AI 别乱买）；
    // 第十三轮起：目录里没有的可以直接写宝贝名（*前缀或直接中文名）→ AI 自主创建上架再买
    const buys: { pid: string; title: string; img: string; price: number; qty: number; shopId: string; shopName: string }[] = [];
    for (const raw of body.items.slice(0, 5)) {
      let p = productById(raw.pid);
      if (!p) {
        const custom = customProductName(raw.pid);
        if (custom) p = ensureTbProductAi(custom, uidInfo.uid);
      }
      if (!p) return { msgs: [], sys: '（没有找到这个商品，没下单——要贴合机主说的品类重新选，没有合适的就明说）' };
      const qty = Math.max(1, Math.min(5, Math.round(raw.qty ?? 1)));
      if (buys.some((it) => it.pid === p.id)) continue; // 同商品去重
      buys.push({ pid: p.id, title: p.title, img: tbMainImg(p), price: p.price, qty, shopId: p.shopId, shopName: shopById(p.shopId).name });
    }
    if (buys.length === 0) return { msgs: [], sys: '（没有找到这个商品，没有下单）' };
    // 按店铺分组建单（跨店多包裹）→ AI 逐单付款 + 即时送达
    const groups = new Map<string, typeof buys>();
    for (const it of buys) {
      const arr = groups.get(it.shopId);
      if (arr) arr.push(it);
      else groups.set(it.shopId, [it]);
    }
    const orders: TbOrder[] = [];
    for (const its of groups.values()) {
      const items: TbOrderItem[] = its.map((it) => ({ pid: it.pid, title: it.title, img: it.img, sku: {}, price: it.price, qty: it.qty }));
      const order = tbCreateOrder({ uid: uidInfo.uid, items, address: tbCurAddr(uidInfo.uid) ?? undefined });
      orders.push(order);
    }
    for (const order of orders) {
      try {
        const paid = tbAiPayPendingOrder(order, { id: peer.id, name: peer.name, avatar: avatarFor(peer, opts.app) }, opts.app);
        if (paid.ok) tbInstantCompleteAiOrder(uidInfo.uid, order.id);
      } catch {
        /* 支付失败不阻断其余包裹与礼物卡投递 */
      }
    }
    const total = Math.round(orders.reduce((s, o) => s + o.total, 0) * 100) / 100;
    const first = buys[0];
    const qtyAll = buys.reduce((s, b) => s + b.qty, 0);
    memAddEventFragment(
      peer.id,
      opts.app,
      `你直接下单送了礼物给机主${meName}：淘宝「${[...new Set(buys.map((b) => b.shopName))].join('、')}」的${buys.map((b) => `「${b.title}」x${b.qty}`).join('、')}（共¥${fmt2(total)}），已即时送达并以礼物卡片发到了聊天里`,
      { eventTime: now, sourceTag: 'tb-buy-gift' },
    );
    return {
      msgs: [{
        id: `tbgift-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        role: 'peer',
        content: `[礼物]送你一份心意：「${first.title}」${buys.length > 1 ? ` 等${buys.length}件宝贝` : ''}（我买好直接送你啦，请收下呀）`,
        time: now,
        kind: 'giftcard',
        gift: {
          id: orders[0].id,
          name: buys.length > 1 ? `${first.title} 等${buys.length}件宝贝` : first.title,
          countLabel: `共 ${qtyAll} 件`,
          image: first.img,
          shop: first.shopName,
          accepted: false,
        },
      }],
    };
  }

  if (kind === 'tb-order-self') {
    // [自己买:商品id|数量?]：异步流——建待付款订单 + 请机主代付（direction 'me' 请求卡；取首个商品）
    if (!uidInfo) return { msgs: [], sys: '（淘宝尚未登录，无法下单）' };
    const body = parseTbBuyBody(action.targetId);
    if (!body) return { msgs: [], sys: '（下单格式有误）' };
    const first = body.items[0];
    let p = productById(first.pid);
    if (!p) {
      const custom = customProductName(first.pid);
      if (custom) p = ensureTbProductAi(custom, uidInfo.uid);
    }
    if (!p) return { msgs: [], sys: '（没有找到这个商品，没法下单）' };
    void tbSelfOrderFlow({ pid: p.id, qty: first.qty }, peer, opts).catch(() => undefined);
    return { msgs: [] };
  }

  if (kind === 'tb-gift-send') {
    // [送礼物:商品id]（第 21 轮）：AI 自己买淘宝商品直接以礼物卡发给机主（真机微信礼物语义：虚拟下单秒送）。
    // giftcard 是微信 WxMsg 卡片——仅微信端启用，QQ/信息端回退系统提示
    if (opts.app !== 'wx') return { msgs: [], sys: '（送礼物暂时只在微信里支持）' };
    let p = productById(action.targetId.trim());
    if (!p) {
      // 第十三轮起：目录里没有 → AI 自主创建宝贝再送（*前缀或直接中文名都认）
      const custom = customProductName(action.targetId);
      const uidInfoGift = uidInfo;
      if (custom && uidInfoGift) p = ensureTbProductAi(custom, uidInfoGift.uid);
    }
    if (!p) return { msgs: [], sys: '（没有找到这个商品，礼物没送出去）' };
    const gid = `tbgf-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    void memAddEventFragment(peer.id, opts.app, `你给机主${meName}买了一份礼物「${p.title}」（¥${fmt2(p.price)}），以礼物卡片送到了聊天里`, { eventTime: now, sourceTag: 'tb-gift-send' });
    return {
      msgs: [{
        id: gid,
        role: 'peer',
        content: '',
        time: now,
        kind: 'giftcard',
        gift: {
          id: `tb:${p.id}`,
          name: p.title,
          countLabel: '共 1 件',
          image: tbMainImg(p),
          shop: shopById(p.shopId).name || undefined,
          accepted: false,
        },
      }],
    };
  }

  // tb-pickup：[帮取快递:订单id] —— 已到驿站立即取；没到先记下（到驿站自动取）
  const order = uidInfo ? tbLoadOrders(uidInfo.uid).find((o) => o.id === action.targetId.trim()) : null;
  if (!order || order.ticket) return { msgs: [], sys: '（快递订单不存在）' };
  if (order.status === 'completed') return { msgs: [], sys: '（这个快递已经取过了）' };
  if (order.status !== 'shipped') return { msgs: [], sys: '（还没发货呢，先别急着取）' };
  if (order.aiPickup) return { msgs: [] };
  const list = tbLoadOrders(uidInfo!.uid);
  const hit = list.find((o) => o.id === order.id);
  if (!hit) return { msgs: [], sys: '（快递订单不存在）' };
  hit.aiPickup = { contactId: peer.id, contactName: peer.name, app: opts.app, kind: 'favor' };
  tbSaveOrders(uidInfo!.uid, list);
  memAddEventFragment(peer.id, opts.app, `机主${meName}让你帮忙取淘宝「${hit.shopName}」的快递（${hit.items.map((i) => i.title.slice(0, 12)).join('、')}），你答应了${tbArrivedAtStation(hit) ? '，已经去取好啦' : '，到驿站后你会去取'}`, { eventTime: now, sourceTag: 'tb-pickup' });
  if (tbArrivedAtStation(hit)) {
    // 已到驿站：当场取掉（watcher 也会兜底，这里立即执行让回复即时生效）
    void tbRunPickup(uidInfo!.uid, order.id).catch(() => undefined);
  }
  return { msgs: [] };
}

/** [自己买] 异步全流程：建单 → direction 'me' 代付请求（卡片经事件合并进聊天）→ 角色记忆 */
async function tbSelfOrderFlow(
  body: { pid: string; qty: number },
  peer: ContactRecord,
  opts: { app: TbEngageApp; meName?: string },
): Promise<void> {
  const uidInfo = tbEngageSessionUid();
  if (!uidInfo) return;
  const p = productById(body.pid);
  if (!p) {
    insertEngageSys(opts.app, peer.id, '（没有找到这个商品，没法下单）');
    return;
  }
  const item: TbOrderItem = { pid: p.id, title: p.title, img: tbMainImg(p), sku: {}, price: p.price, qty: body.qty };
  const order = tbCreateOrder({ uid: uidInfo.uid, items: [item], address: tbCurAddr(uidInfo.uid) ?? undefined });
  const payer = await tbOwnerContactFor(opts.app);
  if (!payer) {
    insertEngageSys(opts.app, peer.id, '（代付请求没有发出去：找不到机主的联系人信息）');
    return;
  }
  await tbCreateProxyRequestByChar({
    order,
    idp: opts.app,
    char: { id: peer.id, name: peer.name, avatar: avatarFor(peer, opts.app) },
    payer,
  });
  const meName = opts.meName?.trim() || ownerNameSync() || '机主';
  memAddEventFragment(peer.id, opts.app, `你在淘宝给自己拍了「${p.title}」（¥${fmt2(order.total)}），请机主${meName}帮你代付`, { eventTime: order.createdAt, sourceTag: 'tb-self-order' });
}

// ---------------- watcher 联动（tbEngageTick，淘宝订单状态机每 10s 接力） ----------------

/** 最近聊过天的 AI 角色（跨微信/QQ，主动参与/到货问候的发起人；无候选返回 null） */
async function tbPickRecentAiChat(): Promise<{ app: TbEngageApp; contact: ContactRecord } | null> {
  try {
    const all = await listContacts();
    let best: { app: TbEngageApp; contact: ContactRecord; t: number } | null = null;
    for (const c of all) {
      if (c.kind === 'user') continue;
      for (const app of ['wx', 'qq'] as const) {
        if (!isFriendIn(c, app)) continue;
        const msgs = kvGet<{ time?: number }[]>(`${app}-chat-msgs:${c.id}`);
        const t = Array.isArray(msgs) && msgs.length > 0 ? (msgs[msgs.length - 1]?.time ?? 0) : 0;
        if (t > 0 && (!best || t > best.t)) best = { app, contact: c, t };
      }
    }
    return best ? { app: best.app, contact: best.contact } : null;
  } catch {
    return null;
  }
}

/**
 * 取件消息：LLM 按人设+记忆+上下文现场生成，发不发/说由 AI 自主决策——
 * - gift（机主送的礼物）：输出 {"say":bool,"lines":[...]}；say=false 或模型失败 → 不发消息
 *   （用户要求：不要礼物道谢信息，让 AI 根据人设/记忆/上下文自己决定要不要说、说什么，
 *   可以只说取到了也可以不说话；禁止「谢谢你XX」式客套道谢）；
 * - favor（帮机主取件）：交差信息（出发/取到两条）还是要说的，失败返回空由调用方兑底。
 */
async function tbPickupLinesViaLlm(
  contact: ContactRecord,
  app: TbEngageApp,
  kind: 'gift' | 'favor',
  order: TbOrder,
  meName: string,
  summary: string,
): Promise<string[]> {
  const sessionKey = `${app}:${contact.id}`;
  const system = [
    await tbPersonaSystemFor(contact, app),
    memChatRecallBlock(
      contact.id,
      app,
      kind === 'gift' ? '礼物 惊喜 感谢 喜欢 收到' : '帮忙取快递 取件 顺路 帮忙',
      {},
    ),
    getTimeAware(sessionKey) ? buildTimeAwareBlock({ regionHint: contact.region || null }) : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const user =
    kind === 'gift'
      ? [
          `【刚发生的事】${meName}之前在淘宝送了你一件礼物（「${order.shopName}」的${summary}，¥${fmt2(order.total)}），现在包裹到驿站了，你把它取回来了。`,
          '【任务】要不要主动给TA发消息，由你结合人设、你们的关系、当前时间（比如大半夜可以不说）和你们相处的记忆自己决定：',
          '想说的话发 1~2 条，像平时聊天——可以说包裹取到了、聊聊礼物本身、开个玩笑都行；禁止「我超喜欢，谢谢你XX」这类客套道谢句式，也不要复述「到驿站/取件」流程细节；',
          '觉得没必要主动说/不想打扰 → say 填 false（这单就不说话了，之后TA聊起来再自然回应）。',
          '输出 JSON：{"say":true或false,"lines":["要说的话（每句一条，最多2条，say=false时给空数组）"]}',
          '严禁输出 JSON 以外的文字。',
        ].join('\n\n')
      : [
          `【刚发生的事】${meName}的淘宝快递（「${order.shopName}」的${summary}）到驿站了，TA之前请你帮忙取件，你正去取。`,
          '【任务】生成你要发的两条消息：第一条是出发去取时说的；第二条是取到之后交差的话（按你的人设自然说，比如放哪了/让TA来拿/顺路这些你们之间才会有的说法，禁止套模板，也不要复述流程细节）。',
          '输出 JSON：{"out":"出发时那条","done":"取到后那条"}（各 1 句，像平时聊天）。',
          '严禁输出 JSON 以外的文字。',
        ].join('\n\n');
  const raw = await callTbLlm(system, user);
  const clean = (s?: string): string =>
    (s ?? '')
      .trim()
      .replace(/^[「"'『]+|[」"'』]+$/g, '')
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)[0] ?? '';
  if (kind === 'gift') {
    const parsed = extractJsonObject(raw) as { say?: boolean; lines?: unknown } | null;
    if (parsed?.say !== true) return [];
    const arr = Array.isArray(parsed.lines) ? parsed.lines : [];
    const lines = arr.map((x) => clean(typeof x === 'string' ? x : '')).filter(Boolean).slice(0, 2);
    return lines;
  }
  const parsed = extractJsonObject(raw) as { out?: string; done?: string } | null;
  const out = clean(parsed?.out);
  const done = clean(parsed?.done);
  if (!out || !done) return [];
  return [out, done];
}

/** 取件执行：确认收货 + 清标记 + AI 报喜消息（礼物=道谢 / 帮取=交差）+ 事件记忆 */
export async function tbRunPickup(uid: string, orderId: string): Promise<void> {
  const order = tbLoadOrders(uid).find((o) => o.id === orderId);
  if (!order || !order.aiPickup || order.status !== 'shipped' || !tbArrivedAtStation(order)) return;
  const pick = order.aiPickup;
  // fromAi=true：跳过确认收货触发的跨 App 联动（本函数自己会发报喜消息，别重复）
  if (!tbConfirmReceive(uid, orderId, { fromAi: true })) return;
  // 清标记（幂等：读改写防覆盖）
  const list = tbLoadOrders(uid);
  const hit = list.find((o) => o.id === orderId);
  if (hit) {
    delete hit.aiPickup;
    tbSaveOrders(uid, list);
    try {
      window.dispatchEvent(new CustomEvent('tb-orders-changed'));
    } catch {
      /* 忽略 */
    }
  }
  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(pick.contactId);
  } catch {
    contact = null;
  }
  const app: TbEngageApp = pick.app === 'qq' ? 'qq' : 'wx';
  const meName = ownerNameSync();
  const summary = order.items.map((i) => `${i.title.slice(0, 12)}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、');
  const now = Date.now();
  // 消息按人设+记忆+上下文现场生成：gift 场景 AI 自主决定发不发/说什么（不发模板道谢，可以不说）；
  // favor 场景交差信息要说到，模型不可用时才退回本地兑底文案
  let lines: string[] = [];
  if (contact) {
    try {
      lines = await tbPickupLinesViaLlm(contact, app, pick.kind, order, meName, summary);
    } catch {
      lines = [];
    }
  }
  if (pick.kind === 'gift') {
    // gift：0~2 条都接受（AI 自主决定说几条/不说），不兑底模板（用户要求不要礼物道谢信息）
    if (lines.length > 2) lines = lines.slice(0, 2);
  } else if (lines.length < 2) {
    // favor：交差信息要说到，模型不可用时才退回本地兑底文案
    lines = [`${meName}，你的快递到驿站了，我帮你去取~`, `取回来啦，放你门口了哈`];
  }
  if (contact) {
    memAddEventFragment(
      pick.contactId,
      app,
      pick.kind === 'gift'
        ? `机主${meName}送你的淘宝礼物（${summary}，¥${fmt2(order.total)}）到驿站后你自己去取回来了`
        : `你帮机主${meName}取了淘宝「${order.shopName}」的快递（${summary}），已确认收货`,
      { eventTime: now, sourceTag: pick.kind === 'gift' ? 'tb-gift-pickup' : 'tb-favor-pickup' },
    );
    if (lines.length > 0) {
      await deliverPeerMsgs(app, contact, lines.map((content, i) => ({ id: `tbpick-${now.toString(36)}-${i}`, role: 'peer' as const, content, time: now + i * 4000 })));
    }
  }
}

/** 主动代付决策（机主没开口，AI 自己看到待付款订单）：人设+记忆+金额 → 付或不付都聊一句 */
async function runProactivePayEngage(uid: string, orderId: string): Promise<void> {
  const picked = await tbPickRecentAiChat();
  if (!picked) return;
  const { app, contact } = picked;
  const order = tbLoadOrders(uid).find((o) => o.id === orderId);
  if (!order || order.status !== 'pendingPay') return;
  const sessionKey = `${app}:${contact.id}`;
  const owner = await ownerProfileFor(app as AccountApp).catch(() => null);
  const meName = owner?.realName || ownerNameSync();
  const persona = buildPersonaSystemPrompt(contact, {
    channel: app === 'wx' ? '微信' : 'QQ',
    userName: meName,
    ownerName: meName,
    accountId: getActiveAccountIdFor(app as AccountApp),
    multiApp: getMemSettings(contact.id).share,
  });
  const summary = order.items.map((i) => `${i.title.slice(0, 14)}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、');
  const memoryBlock = memChatRecallBlock(contact.id, app, `淘宝 待付款 代付 购物 ${order.shopName} ${summary}`, {});
  const timeBlock = getTimeAware(sessionKey) ? buildTimeAwareBlock({ regionHint: contact.region || null }) : '';
  const system = [persona, memoryBlock, timeBlock].filter(Boolean).join('\n\n');
  const user = [
    `【你看到的一件事】${meName}刚在淘宝「${order.shopName}」下单还没付款：${summary}，共 ¥${fmt2(order.total)}（30 分钟内不付会自动取消）。`,
    '【任务】结合你的人设、你们的关系、上面的记忆和金额，决定怎么参与（演示语义，不会真花钱）：',
    '- 直接全付：输出 {"pay":"all"}；不想付：输出 {"pay":false}，用正文自然提一嘴（调侃/关心/催TA去买单都行）。',
    '关系亲近/人设大方/正好想宠TA → 可以付（全付）；人设节俭/关系一般/刚闹过矛盾 → 不付。怎么选都自然，没有标准答案。',
    '输出 JSON：{"pay":"all"或false,"reply":"给对方发的一句话（像平时聊天，1~2句；付了说已付+人设话，没付就自然聊）"}',
    '严禁输出 JSON 以外的文字。',
  ].join('\n\n');
  let parsed: { pay?: boolean | string; reply?: string } | null = null;
  try {
    const raw = await callTbLlm(system, user);
    parsed = extractJsonObject(raw) as { pay?: boolean | string; reply?: string } | null;
  } catch {
    parsed = null;
  }
  const reply = (parsed?.reply ?? '').trim().replace(/^[「"'『]+|[」"'』]+$/g, '').split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
  // 决策落定前复查（机主可能已自己付款/取消）
  const cur = tbLoadOrders(uid).find((o) => o.id === orderId);
  if (!cur || cur.status !== 'pendingPay') return;
  const payer = { id: contact.id, name: contact.name, avatar: avatarFor(contact, app) };
  const outMsgs: { id: string; role: 'me' | 'peer'; content: string; time: number; kind?: string; tbpay?: { pid: string; role: 'req' | 'done' } }[] = [];
  const decision = parsed?.pay;
  if (parsed && (decision === true || decision === 'all')) {
    // LLM 决策：全付
    const res = tbAiPayPendingOrder(cur, payer, app);
    if (res.ok && res.card) {
      outMsgs.push(res.card);
      memAddEventFragment(
        contact.id,
        app,
        `你看到机主${meName}在淘宝「${cur.shopName}」有待付款订单（¥${fmt2(cur.total)}，${summary}），主动帮TA付了`,
        { eventTime: Date.now(), sourceTag: 'tb-proactive-pay' },
      );
    }
  }
  if (reply) outMsgs.push({ id: `tbpp-${Date.now().toString(36)}`, role: 'peer', content: reply, time: Date.now() + 1 });
  if (outMsgs.length === 0) {
    // 兑底（用户反馈：LLM 失败不再静默——订单被标「问过一次」后用户什么都看不到）：
    // 模型不可用/没给出任何产出 → 本地直接帮付 + 一句兑底话术，保证机主一定能看到这次参与
    const res = tbAiPayPendingOrder(cur, payer, app);
    if (res.ok && res.card) {
      outMsgs.push(res.card);
      memAddEventFragment(contact.id, app, `你看到机主${meName}在淘宝「${cur.shopName}」有待付款订单（¥${fmt2(cur.total)}，${summary}），主动帮TA付了`, { eventTime: Date.now(), sourceTag: 'tb-proactive-pay' });
    }
    outMsgs.push({ id: `tbpp-${Date.now().toString(36)}`, role: 'peer', content: `看到你在淘宝拍了东西还没付款，我先帮你付啦，别跟我客气~`, time: Date.now() + 2 });
  }
  try {
    const { isProactiveChatActive } = await import('./proactive-msg');
    const notifyApp = app === 'wx' ? ('wechat' as const) : ('qq' as const);
    await deliverPeerMsgs(app, contact, outMsgs);
    void pushChatNotification({
      sessionKey,
      app: notifyApp,
      title: contact.name,
      avatar: avatarFor(contact, app),
      body: outMsgs[outMsgs.length - 1]?.content ?? '',
      target: { app: notifyApp, contactId: contact.id },
    });
    if (!isProactiveChatActive(app, contact.id)) {
      if (app === 'wx') wxUnreads.bump(contact.id, outMsgs.length);
      else qqUnreads.bump(contact.id, outMsgs.length);
    }
  } catch {
    /* 投递失败静默 */
  }
}

/** 订单状态机 tick 接力（taobao-store watcher 每 10s 调用）：取件/主动代付/到货问候/终态记忆 */
export async function tbEngageTick(uid: string): Promise<void> {
  try {
    const orders = tbLoadOrders(uid);
    // (a) AI 取件（礼物/帮取）：到驿站即取
    for (const o of orders) {
      if (o.aiPickup && o.status === 'shipped' && tbArrivedAtStation(o)) {
        await tbRunPickup(uid, o.id);
      }
    }
    // (b) 主动代付参与：待付款超 20s 未处理且没挂代付请求 → 最近的 AI 角色自主决策（每单一次）
    const proxyOrderIds = new Set<string>();
    try {
      for (const pid of kvGet<string[]>('tb-proxy-index') ?? []) {
        const p = tbGetProxy(pid);
        if (p && p.status === 'pending') proxyOrderIds.add(p.orderId);
      }
    } catch {
      /* 忽略 */
    }
    const now = Date.now();
    const target = orders.find(
      (o) => o.status === 'pendingPay' && !o.aiAsked && !proxyOrderIds.has(o.id) && now - o.createdAt > 20_000,
    );
    if (target) {
      const list = tbLoadOrders(uid);
      const hit = list.find((o) => o.id === target.id);
      if (hit) {
        hit.aiAsked = true;
        tbSaveOrders(uid, list);
        await runProactivePayEngage(uid, target.id);
        return; // 一轮只做一件主动事
      }
    }
    // (c) 到驿站不再发任何主动问候（用户明确要求：快递到了不要 AI 发提醒消息）；
    // 有礼物/帮取安排的仍由取件流程说话（取件交差，不属于到站提醒）
    // (d) 终态记忆：AI 参与代付的单签收后给角色补一条（幂等 kv 标记）
    for (const o of orders) {
      if (o.status !== 'completed' || !o.proxy || kvGet<boolean>(`tb-memo-done:${o.id}`)) continue;
      const p = tbGetProxy(o.proxy.id);
      if (!p || p.status !== 'paid' || p.direction === 'me') continue;
      kvSet(`tb-memo-done:${o.id}`, true);
      let contact: ContactRecord | null = null;
      try {
        contact = await getContact(p.contactId);
      } catch {
        contact = null;
      }
      if (!contact) continue;
      memAddEventFragment(
        p.contactId,
        p.idp,
        `你帮机主代付的淘宝「${o.shopName}」订单（${o.items.map((i) => i.title.slice(0, 12)).join('、')}，¥${fmt2(o.total)}）已签收`,
        { eventTime: Date.now(), sourceTag: 'tb-order-terminal' },
      );
    }
  } catch {
    /* tick 失败静默 */
  }
}

// ---------------- 淘宝「找人帮取」分享后的 AI 响应 ----------------

/**
 * 机主在淘宝详情点「找人帮取」分享给 AI 后调度：延时让角色「看到请求」——
 * 已到驿站 → 立即取件 + 报喜；没到 → 答应下来（到驿站后 watcher 自动取）。
 * 人设化回复（LLM），模型不可用时用本地兜底文案。
 */
export function tbSchedulePickupResponse(sid: string): void {
  window.setTimeout(async () => {
    try {
      const share = tbGetShare(sid);
      if (!share || !share.pickupReq) return;
      const contact = await getContact(share.contactId);
      if (!contact || contact.kind === 'user') return;
      const app: TbEngageApp = share.idp;
      const uid = share.uid;
      const order = tbLoadOrders(uid).find((o) => o.id === share.orderId);
      if (!order || order.status === 'cancelled') return;
      // 幂等防双响应（用户反馈「找ai取件回复两遍」）：取件已完成或另一路径（聊天 [帮取快递] 标记/watcher）
      // 已在帮取流程中 → 不再重复答应/取件
      if (order.status === 'completed' || order.aiPickup) return;
      // 标记帮取（分享时可能因状态没写上，这里补；completed 已在上面的幂等检查里排除）
      if (!order.aiPickup) {
        const list = tbLoadOrders(uid);
        const hit = list.find((o) => o.id === order.id);
        if (hit && !hit.aiPickup) {
          hit.aiPickup = { contactId: contact.id, contactName: contact.name, app, kind: 'favor' };
          tbSaveOrders(uid, list);
        }
      }
      const meName = ownerNameSync();
      const summary = order.items.map((i) => i.title.slice(0, 12)).join('、');
      if (tbArrivedAtStation(order) && order.status === 'shipped') {
        await tbRunPickup(uid, order.id);
        return; // tbRunPickup 已投递报喜消息
      }
      // 还在路上：人设化答应一句
      const persona = buildPersonaSystemPrompt(contact, {
        channel: app === 'wx' ? '微信' : 'QQ',
        userName: meName,
        ownerName: meName,
        accountId: getActiveAccountIdFor(app as AccountApp),
        multiApp: getMemSettings(contact.id).share,
      });
      const user = [
        `【刚收到的事】${meName}在淘宝把「${order.shopName}」的快递订单分享给你，请你帮忙取件（${summary}）。包裹还在路上，到驿站后你会去取。`,
        '按你的人设自然回应一句（答应下来，1~2 句，像平时聊天）。',
        '直接输出这句话本身，不要 JSON、不要引号。',
      ].join('\n\n');
      let line = '';
      try {
        line = (await callTbLlm(persona, user)).trim().replace(/^[「"'『]+|[」"'』]+$/g, '').split('\n')[0]?.trim() ?? '';
      } catch {
        line = '';
      }
      if (!line) line = '好呀，到你家驿站了我就去帮你取~';
      const now = Date.now();
      await deliverPeerMsgs(app, contact, [{ id: `tbpr-${now.toString(36)}`, role: 'peer', content: line, time: now }]);
      memAddEventFragment(contact.id, app, `机主${meName}请你帮忙取淘宝「${order.shopName}」的快递（${summary}），你答应了`, { eventTime: now, sourceTag: 'tb-pickup-req' });
    } catch {
      /* 静默 */
    }
  }, 4200 + Math.floor(Math.random() * 3600));
}

// ---------------- 标记体解析（[帮你买/自己买:商品id|数量?]） ----------------

export function parseTbBuyBody(raw: string): { items: { pid: string; qty: number }[] } | null {
  // 多商品格式：[帮你买:商品id1|数量,商品id2|数量,...]（兼容单商品旧格式「商品id|数量」；最多 5 件）
  const segs = raw.split('，').join(',').split(',').map((s) => s.trim()).filter(Boolean);
  const items: { pid: string; qty: number }[] = [];
  for (const seg of segs) {
    const parts = seg.split('|').map((x) => x.trim());
    const pid = parts[0] ?? '';
    if (!pid) continue;
    let qty = 1;
    const q = parts[1];
    if (q) {
      const n = Number.parseInt(q, 10);
      if (Number.isFinite(n) && n > 0) qty = Math.min(5, n);
    }
    if (!items.some((it) => it.pid === pid)) items.push({ pid, qty });
    if (items.length >= 5) break;
  }
  return items.length > 0 ? { items } : null;
}

/** AI 代买草稿卡 → AI 可读文本（确认/取消状态可回看；多商品全列） */
export function tbDraftHistoryLine(did: string): string {
  const d = tbGetDraft(did);
  if (!d) return '[淘宝代买卡片]';
  const status = d.status === 'pending' ? '待机主确认' : d.status === 'confirmed' ? `已下单（订单${(d.orderIds ?? [d.orderId]).filter(Boolean).join('、')}，你已付款）` : '机主已取消';
  const shops = [...new Set(d.items.map((i) => i.shopName))].join('、');
  const goods = d.items.map((i) => `「${i.title}」x${i.qty}`).join('、');
  return `[淘宝代买 id:${d.id}]（${d.charName}帮机主买的：淘宝店「${shops}」的${goods}，约¥${fmt2(d.total ?? tbDraftEstimate(d))}，状态:${status}）`;
}
