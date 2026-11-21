'use client';

/**
 * 美团「找人代付」跨 App 链路（收银台 → 微信/QQ 聊天卡片 → 好友代付 → 完成卡片）：
 * - 发起：PayPage「找人代付」选平台（微信/QQ）+ 联系人 → 生成代付请求（IDB kv `mt-proxy:<id>`，
 *   全局键不按美团 uid 隔离——聊天侧好友代付时按 pid 取）→ 代付请求卡片写入该联系人聊天消息流
 *   （wx-chat-msgs:/qq-chat-msgs:，与一起听卡片同机制）→ 广播 MT_PROXY_CARD_EVENT
 *   让在场聊天页实时合并；订单挂 proxy 快照（OrdersPage/详情显示「已请 TA 代付」）；
 * - 代付：聊天里点卡片进代付详情（mt-proxy-detail.tsx）→「立即代付」（演示语义：好友以自己
 *   渠道付款，不扣本机钱包）→ 订单状态机接手（待接单/团购完成）+ 请求卡同步变已代付 +
 *   「代付完成卡片」回聊天 + 灵动岛通知（美团订单 · 好友已代付）；
 * - 退款语义：好友代付订单 refund 原路退回给代付人（payMethodId 不落本机账户 → mtRefundToOrigin
 *   自然跳过本机入账，仅展示「原路退还代付人」）。
 */
import { kvGet, kvSet } from './idb-kv';
import { getContact } from './contacts-store';
import { avatarFor, displayNameOf, isFriendIn, type ContactRecord } from '../contacts';
import { mtDeliveryMinutesOf, mtLoadOrders, mtSaveOrders, type MtOrder } from './meituan-store';
import { mtNotifyShopOrderPaid } from './mt-shop-notify';

// ---------------- 数据模型 ----------------

export interface MtProxyItem {
  name: string;
  qty: number;
  price: number;
  spec?: string;
  emoji?: string;
  img?: string;
}

export interface MtProxyPay {
  id: string;
  /** 下单人的美团账号 uid（mt-orders:<uid> 定位订单用） */
  uid: string;
  orderId: string;
  /** 代付渠道平台 */
  idp: 'wx' | 'qq';
  /** 付款人联系人：direction 'friend' = 代付好友（AI 角色）；'me' = 机主自己 */
  contactId: string;
  contactName: string;
  contactAvatar: string | null;
  /** 请求人（direction 'friend' = 美团登录账号本人；'me' = 发起请求的 AI 角色） */
  fromName: string;
  fromAvatar: string | null;
  merchantName: string;
  merchantEmoji: string;
  merchantImg?: string;
  amount: number;
  itemCount: number;
  items: MtProxyItem[];
  note?: string;
  /** pending=待代付；paid=已代付；declined=对方婉拒（B5）；expired=请求失效（B4：订单取消/超时/机主已自行支付） */
  status: 'pending' | 'paid' | 'declined' | 'expired';
  createdAt: number;
  paidAt?: number;
  /** 好友支付渠道名（微信支付 / QQ钱包） */
  paidChannel?: string;
  /** 终态说明（declined/expired 时展示）：如「对方婉拒了这次代付」「订单已超时取消」「机主已自行支付」 */
  closeReason?: string;
  /** 代付方向（旧记录无此字段按 'friend' 处理）：'friend' = 好友代付（请求人=机主，付款人=AI 角色，
   *  付款决策由角色 AI 根据人设/记忆自主做出）；'me' = 机主代付（AI 角色发起，请机主帮付） */
  direction?: 'friend' | 'me';
  /** 卡片所在聊天的联系人 id（direction 'me' 时 = 发起角色 id，与付款人 contactId 不同）；缺省 = contactId */
  chatContactId?: string;
}

/** 聊天里的代付卡片消息（微信 WxMsg / QQ QQMsg 同构，kind='mtpay'） */
export interface MtProxyCardMsg {
  id: string;
  role: 'me' | 'peer';
  content: string;
  time: number;
  kind: 'mtpay';
  /** pid = 代付请求 id；role：req=代付请求卡（我发给好友）/ done=代付完成卡（好友付完回我） */
  mtpay: { pid: string; role: 'req' | 'done' };
}

/** 卡片落库广播（聊天页在场时监听实时合并，与 TG_CARD_INSERTED_EVENT 同机制） */
export const MT_PROXY_CARD_EVENT = 'mt-proxy-card-inserted';

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

function genPid(): string {
  return `mtpx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function genMsgId(): string {
  return `mtpxm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 读取代付请求（容错规范化） */
export function mtGetProxy(pid: string): MtProxyPay | null {
  if (!pid) return null;
  const p = kvGet<Partial<MtProxyPay>>(`mt-proxy:${pid}`);
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.orderId !== 'string') return null;
  return {
    ...p,
    id: p.id,
    uid: typeof p.uid === 'string' ? p.uid : '',
    orderId: p.orderId,
    idp: p.idp === 'qq' ? 'qq' : 'wx',
    contactId: typeof p.contactId === 'string' ? p.contactId : '',
    contactName: typeof p.contactName === 'string' ? p.contactName : '好友',
    contactAvatar: typeof p.contactAvatar === 'string' ? p.contactAvatar : null,
    fromName: typeof p.fromName === 'string' ? p.fromName : '我',
    fromAvatar: typeof p.fromAvatar === 'string' ? p.fromAvatar : null,
    merchantName: typeof p.merchantName === 'string' ? p.merchantName : '美团商家',
    merchantEmoji: typeof p.merchantEmoji === 'string' ? p.merchantEmoji : '🍜',
    merchantImg: typeof p.merchantImg === 'string' ? p.merchantImg : undefined,
    amount: typeof p.amount === 'number' ? p.amount : 0,
    itemCount: typeof p.itemCount === 'number' ? p.itemCount : 0,
    items: Array.isArray(p.items)
      ? (p.items as MtProxyItem[]).filter((i) => i && typeof i.name === 'string').map((i) => ({
          name: i.name,
          qty: typeof i.qty === 'number' ? i.qty : 1,
          price: typeof i.price === 'number' ? i.price : 0,
          spec: typeof i.spec === 'string' && i.spec ? i.spec : undefined,
          emoji: typeof i.emoji === 'string' ? i.emoji : undefined,
          img: typeof i.img === 'string' ? i.img : undefined,
        }))
      : [],
    note: typeof p.note === 'string' && p.note ? p.note : undefined,
    status: p.status === 'paid' ? 'paid' : p.status === 'declined' ? 'declined' : p.status === 'expired' ? 'expired' : 'pending',
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
    paidAt: typeof p.paidAt === 'number' ? p.paidAt : undefined,
    paidChannel: typeof p.paidChannel === 'string' ? p.paidChannel : undefined,
    closeReason: typeof p.closeReason === 'string' && p.closeReason ? p.closeReason : undefined,
    direction: p.direction === 'me' ? 'me' : 'friend',
    chatContactId: typeof p.chatContactId === 'string' && p.chatContactId ? p.chatContactId : undefined,
  };
}

function mtSetProxy(p: MtProxyPay): void {
  kvSet(`mt-proxy:${p.id}`, p);
}

/** 平台支付渠道名（完成卡/详情页展示） */
export function mtProxyChannelName(idp: 'wx' | 'qq'): string {
  return idp === 'wx' ? '微信支付' : 'QQ钱包';
}

/** 代付卡片所在聊天（direction 'me' = 发起角色聊天） */
export function mtProxyChatCid(p: MtProxyPay): string {
  return p.chatContactId ?? p.contactId;
}

// ---------------- 聊天卡片写入 ----------------

function insertProxyCard(idp: 'wx' | 'qq', contactId: string, msg: MtProxyCardMsg): void {
  const key = `${idp === 'wx' ? 'wx' : 'qq'}-chat-msgs:${contactId}`;
  try {
    const cur = kvGet<unknown[]>(key) ?? [];
    kvSet(key, [...cur, msg]); // 聊天记录不封顶（此前截 100 条会把旧记录挤丢）
  } catch {
    /* 落库失败静默 */
  }
  try {
    window.dispatchEvent(new CustomEvent(MT_PROXY_CARD_EVENT, { detail: { cid: contactId, app: idp } }));
  } catch {
    /* 广播失败不影响落库 */
  }
}

// ---------------- 发起代付请求 ----------------

export interface MtCreateProxyOpts {
  order: MtOrder;
  idp: 'wx' | 'qq';
  contactId: string;
  fromName: string;
  fromAvatar: string | null;
}

export type MtCreateProxyResult = { ok: true; proxy: MtProxyPay } | { ok: false; error: string };

/**
 * 发起代付：生成请求 + 订单挂 proxy + 请求卡进聊天。
 * 同一订单同一好友防重复；订单非待支付拒绝。
 */
export async function mtCreateProxyRequest(opts: MtCreateProxyOpts): Promise<MtCreateProxyResult> {
  const { order, idp, contactId, fromName, fromAvatar } = opts;
  if (order.status !== 'pendingPay') return { ok: false, error: '订单不是待支付状态，无法发起代付' };
  if (!contactId) return { ok: false, error: '请先选择代付好友' };
  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(contactId);
  } catch {
    contact = null;
  }
  if (!contact || contact.kind === 'user') return { ok: false, error: '代付好友不存在或已删除' };
  if (!isFriendIn(contact, idp)) return { ok: false, error: `该好友不是${idp === 'wx' ? '微信' : 'QQ'}好友` };
  // 防重复：同订单同好友已有待处理请求
  const dup = findPendingProxyOfOrder(order.uid, order.id).find((p) => p.contactId === contactId);
  if (dup) return { ok: false, error: `已向${displayNameOf(contact)}发送过代付请求，等待TA付款` };

  const proxy: MtProxyPay = {
    id: genPid(),
    uid: order.uid,
    orderId: order.id,
    idp,
    contactId,
    contactName: displayNameOf(contact),
    contactAvatar: avatarFor(contact, idp),
    fromName,
    fromAvatar,
    merchantName: order.merchantName,
    merchantEmoji: order.merchantEmoji,
    merchantImg: order.merchantImg,
    amount: order.total,
    itemCount: order.items.reduce((s, i) => s + i.qty, 0),
    items: order.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price, spec: i.spec, emoji: i.emoji, img: i.img })),
    note: order.note,
    status: 'pending',
    createdAt: Date.now(),
  };
  mtSetProxy(proxy);
  // pid 索引（防重复/扫单用；幂等追加）
  try {
    const idx = kvGet<string[]>('mt-proxy-index') ?? [];
    if (!idx.includes(proxy.id)) kvSet('mt-proxy-index', [...idx, proxy.id].slice(-50));
  } catch {
    /* 忽略 */
  }

  // 订单挂 proxy 快照（订单列表/详情显示「已请 TA 代付」）
  mtSaveOrders(
    order.uid,
    mtLoadOrders(order.uid).map((o) => (o.id === order.id ? { ...o, proxy: { id: proxy.id, name: proxy.contactName } } : o))
  );
  window.dispatchEvent(new CustomEvent('mt-orders-changed'));

  // 请求卡片进聊天（我发给好友）
  insertProxyCard(idp, contactId, {
    id: genMsgId(),
    role: 'me',
    content: `[美团代付]帮我付一下¥${fmt2(proxy.amount)}的订单`,
    time: Date.now(),
    kind: 'mtpay',
    mtpay: { pid: proxy.id, role: 'req' },
  });
  // 目标为 AI 角色（mtCreateProxyRequest 已限定 kind!=='user'）→ 调度该角色的自主代付决策：
  // 延时数秒后按人设/记忆/上下文决定是否代付（mt-ai-engage；动态 import 防模块循环）
  void import('./mt-ai-engage')
    .then((m) => m.scheduleMtProxyAiDecision(proxy.id))
    .catch(() => undefined);
  return { ok: true, proxy };
}

/** 某订单的全部待处理代付请求（索引扫，同订单同好友防重复用） */
export function findPendingProxyOfOrder(uid: string, orderId: string): MtProxyPay[] {
  void uid;
  const out: MtProxyPay[] = [];
  try {
    const ids = kvGet<string[]>('mt-proxy-index') ?? [];
    for (const pid of ids) {
      const p = mtGetProxy(pid);
      if (p && p.orderId === orderId && p.status === 'pending') out.push(p);
    }
  } catch {
    /* 忽略 */
  }
  return out;
}

// ---------------- AI 角色发起代付请求（请机主帮付） ----------------

export interface MtCreateProxyByCharOpts {
  order: MtOrder;
  idp: 'wx' | 'qq';
  /** 发起请求的 AI 角色联系人（卡片落在该角色聊天） */
  char: { id: string; name: string; avatar: string | null };
  /** 付款人（机主）联系人信息 */
  payer: { id: string; name: string; avatar: string | null };
}

/**
 * AI 角色请机主代付（direction 'me'）：生成请求 + 请求卡（角色→机主）落在该角色聊天。
 * 同一订单同角色防重复；订单非待支付拒绝。不挂订单 proxy 快照（订单在机主美团账号里，
 * 「已请 TA 代付」语义只适用好友代付方向；机主可直接在美团收银台支付本单）。
 */
export async function mtCreateProxyRequestByChar(opts: MtCreateProxyByCharOpts): Promise<MtCreateProxyResult> {
  const { order, idp, char, payer } = opts;
  if (order.status !== 'pendingPay') return { ok: false, error: '订单不是待支付状态' };
  const dup = findPendingProxyOfOrder(order.uid, order.id).find((p) => p.direction === 'me' && p.chatContactId === char.id);
  if (dup) return { ok: false, error: '已向机主发送过代付请求' };

  const proxy: MtProxyPay = {
    id: genPid(),
    uid: order.uid,
    orderId: order.id,
    idp,
    contactId: payer.id,
    contactName: payer.name,
    contactAvatar: payer.avatar,
    fromName: char.name,
    fromAvatar: char.avatar,
    merchantName: order.merchantName,
    merchantEmoji: order.merchantEmoji,
    merchantImg: order.merchantImg,
    amount: order.total,
    itemCount: order.items.reduce((s, i) => s + i.qty, 0),
    items: order.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price, spec: i.spec, emoji: i.emoji, img: i.img })),
    note: order.note,
    status: 'pending',
    createdAt: Date.now(),
    direction: 'me',
    chatContactId: char.id,
  };
  mtSetProxy(proxy);
  try {
    const idx = kvGet<string[]>('mt-proxy-index') ?? [];
    if (!idx.includes(proxy.id)) kvSet('mt-proxy-index', [...idx, proxy.id].slice(-50));
  } catch {
    /* 忽略 */
  }
  // 请求卡片进角色聊天（角色发给机主）
  insertProxyCard(idp, char.id, {
    id: genMsgId(),
    role: 'peer',
    content: `[美团代付]想请你帮我付一下¥${fmt2(proxy.amount)}的订单`,
    time: Date.now(),
    kind: 'mtpay',
    mtpay: { pid: proxy.id, role: 'req' },
  });
  return { ok: true, proxy };
}

// ---------------- 请求生命周期扩展（B4 失效联动 / B5 婉拒） ----------------

/** 广播某几条代付卡所在聊天刷新（终态变更后开放中的聊天页即时重读渲染） */
function broadcastProxyRefresh(ps: MtProxyPay[]): void {
  const seen = new Set<string>();
  for (const p of ps) {
    const key = `${p.idp}:${mtProxyChatCid(p)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      window.dispatchEvent(new CustomEvent(MT_PROXY_CARD_EVENT, { detail: { cid: mtProxyChatCid(p), app: p.idp } }));
    } catch {
      /* 广播失败不影响落库 */
    }
  }
}

/**
 * B4 失效联动：把某美团账号下「挂着的 pending 代付请求」与订单真实状态对齐——
 * 订单已取消 → expired（原因透传 cancelReason）；订单已被机主直接支付/不存在 → expired；
 * 订单已支付且该请求就是付款方 → paid（幂等落定，防快照滞后）。
 * 由订单状态机 tick（MeituanOrderWatcher）/收银台直付（finishPay）/取消订单处调用；
 * 返回是否有变更（供调用方决定是否广播）。
 */
export function mtSyncProxiesForUid(uid: string): boolean {
  let changed = false;
  const touched: MtProxyPay[] = [];
  try {
    const ids = kvGet<string[]>('mt-proxy-index') ?? [];
    if (ids.length === 0) return false;
    const orders = mtLoadOrders(uid);
    for (const pid of ids) {
      const p = mtGetProxy(pid);
      if (!p || p.status !== 'pending' || p.uid !== uid) continue;
      const o = orders.find((x) => x.id === p.orderId);
      if (!o) {
        const done: MtProxyPay = { ...p, status: 'expired', closeReason: '订单不存在，代付请求失效' };
        mtSetProxy(done);
        changed = true;
        touched.push(done);
        continue;
      }
      if (o.status === 'canceled') {
        const done: MtProxyPay = { ...p, status: 'expired', closeReason: o.cancelReason ?? '订单已取消' };
        mtSetProxy(done);
        changed = true;
        touched.push(done);
        continue;
      }
      if (o.status !== 'pendingPay') {
        // 订单已支付：若付款渠道文案里带该请求付款人名（好友已代付但快照未及更新）落 paid；
        // 否则按渠道文案区分失效原因（含「代付」=别的好友付的；否则机主自己付的）
        const selfPaid = !(o.payChannelLabel && o.payChannelLabel.includes(p.contactName));
        const done: MtProxyPay = selfPaid
          ? {
              ...p,
              status: 'expired',
              closeReason: o.payChannelLabel && o.payChannelLabel.includes('代付') ? '订单已由其他好友代付' : '机主已自行支付，无需代付',
            }
          : { ...p, status: 'paid', paidAt: o.paidAt ?? Date.now(), paidChannel: mtProxyChannelName(p.idp) };
        mtSetProxy(done);
        changed = true;
        touched.push(done);
      }
    }
  } catch {
    /* 忽略 */
  }
  if (touched.length > 0) broadcastProxyRefresh(touched);
  return changed;
}

/**
 * B5 婉拒：AI 代付决策婉拒后把请求置 declined（卡片「对方婉拒了」、规则块不再列出、
 * 同订单可再向其他好友发起请求）。仅 pending 可婉拒；婉拒不影响订单本身（仍待支付/可自行支付）。
 */
export function mtDeclineProxy(pid: string, reason?: string): boolean {
  const p = mtGetProxy(pid);
  if (!p || p.status !== 'pending') return false;
  const done: MtProxyPay = { ...p, status: 'declined', closeReason: reason ?? '对方婉拒了这次代付' };
  mtSetProxy(done);
  broadcastProxyRefresh([done]);
  return true;
}

/** 某聊天内全部待处理代付请求（两个方向都在该聊天内流转；动作规则/等待态用） */
export function mtPendingProxiesOfChat(chatContactId: string): MtProxyPay[] {
  const out: MtProxyPay[] = [];
  try {
    const ids = kvGet<string[]>('mt-proxy-index') ?? [];
    for (const pid of ids) {
      const p = mtGetProxy(pid);
      if (p && p.status === 'pending' && mtProxyChatCid(p) === chatContactId) out.push(p);
    }
  } catch {
    /* 忽略 */
  }
  return out;
}

// ---------------- 好友代付（聊天侧详情页「立即代付」） ----------------

export type MtProxyPayResult = { ok: true; proxy: MtProxyPay; order: MtOrder } | { ok: false; error: string };

/**
 * 代付支付：请求置 paid + 订单支付完成（状态机接手）+ 完成卡片回聊天 + 灵动岛通知。
 * 演示语义：付款人以「微信支付/QQ钱包」付款，不扣本机任何钱包余额。
 * direction 'friend'：AI 好友代付机主订单（完成卡 role='peer'）；
 * direction 'me'：机主代付 AI 的订单（完成卡 role='me'）。
 * deferCard：AI 动作路径用——不直接落库卡片，把完成卡消息返回给调用方随回复队列投递
 * （防 buildReplyMsgs 的 cur 快照覆盖丢卡）；不传 = 立即落库+广播（UI 按钮路径）。
 */
export function mtProxyPayOrder(
  pid: string,
  opts?: { deferCard?: boolean },
): MtProxyPayResult & { card?: MtProxyCardMsg } {
  const p = mtGetProxy(pid);
  if (!p) return { ok: false, error: '代付请求不存在或已被清理' };
  if (p.status !== 'pending') return { ok: false, error: '该代付请求已处理，请勿重复支付' };
  const orders = mtLoadOrders(p.uid);
  const idx = orders.findIndex((o) => o.id === p.orderId);
  if (idx < 0) return { ok: false, error: '订单不存在，代付请求失效' };
  const cur = orders[idx];
  if (cur.status !== 'pendingPay') return { ok: false, error: cur.status === 'canceled' ? '订单已取消，代付请求失效' : '订单已支付，无需重复代付' };

  const now = Date.now();
  const tuangou = cur.kind === 'tuangou';
  const channel = mtProxyChannelName(p.idp);
  const meDir = p.direction === 'me';
  const paid: MtOrder = {
    ...cur,
    status: tuangou ? 'completed' : 'pendingAccept',
    paidAt: now,
    // 配送时长与收银台直付同口径（5~30 分钟，按订单号确定性推导）
    ...(tuangou ? {} : { etaAt: now + mtDeliveryMinutesOf(cur.id) * 60_000 }),
    payIdp: p.idp,
    payChannelLabel: meDir ? `代付 · ${channel}（${p.contactName}）` : `好友代付 · ${channel}（${p.contactName}）`,
    // 代付不落本机账户渠道：退款原路退还代付人（mtRefundToOrigin 无 methodId 自然跳过本机入账）
    payMethodId: undefined,
    payFc: false,
    statusLog: [...cur.statusLog, { status: tuangou ? 'completed' : 'pendingAccept', at: now }],
  };
  orders[idx] = paid;
  mtSaveOrders(p.uid, orders);
  // 商家接单通知：订单落在机主自己的店铺 → 灵动岛提醒商家（幂等）
  mtNotifyShopOrderPaid(paid);

  const done: MtProxyPay = { ...p, status: 'paid', paidAt: now, paidChannel: channel };
  mtSetProxy(done);

  // 完成卡片（direction 'friend'：好友发回给我；'me'：我付完回执给角色）
  const card: MtProxyCardMsg = {
    id: genMsgId(),
    role: meDir ? 'me' : 'peer',
    content: meDir ? `[美团代付]已帮${p.fromName}代付¥${fmt2(p.amount)}` : `[美团代付]已帮你代付¥${fmt2(p.amount)}`,
    time: now,
    kind: 'mtpay',
    mtpay: { pid: p.id, role: 'done' },
  };
  if (opts?.deferCard) {
    // AI 动作路径：卡片随回复投递管线落盘（调用方负责 out.push）
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    // 完成后同账号其余 pending 请求对齐（defer 路径也要，防同单其他请求悬挂）
    mtSyncProxiesForUid(p.uid);
    return { ok: true, proxy: done, order: paid, card };
  }
  insertProxyCard(p.idp, mtProxyChatCid(p), card);

  window.dispatchEvent(new CustomEvent('mt-orders-changed'));
  // 完成后同账号其余 pending 请求对齐（同单其他好友请求失效/机主自行支付判定）
  mtSyncProxiesForUid(p.uid);
  // 灵动岛通知（美团订单 · 代付完成；点击进订单详情）
  void import('./island-notify')
    .then((m) =>
      m.pushChatNotification({
        sessionKey: `mt:order:${paid.id}`,
        app: 'meituan',
        title: '美团订单',
        avatar: '/icons/meituan-app.png',
        body: meDir ? `你已帮${p.fromName}代付¥${fmt2(p.amount)}，订单已支付` : `好友${p.contactName}已代付¥${fmt2(p.amount)}，订单已支付`,
        target: { app: 'meituan', contactId: paid.id },
      })
    )
    .catch(() => undefined);
  return { ok: true, proxy: done, order: paid };
}

/**
 * AI 帮机主代付指定待支付订单（[帮付:订单ID] 执行器用）：
 * 建 direction 'friend' 代付记录（付款人 = 该 AI 角色）→ 立即支付（deferCard，完成卡由调用方投递）。
 * 幂等：订单非待支付/已有同角色待处理请求时拒绝。
 */
export function mtAiPayPendingOrder(
  order: MtOrder,
  char: { id: string; name: string; avatar: string | null },
  idp: 'wx' | 'qq',
): MtProxyPayResult & { card?: MtProxyCardMsg } {
  if (order.status !== 'pendingPay') return { ok: false, error: '订单不是待支付状态' };
  const proxy: MtProxyPay = {
    id: genPid(),
    uid: order.uid,
    orderId: order.id,
    idp,
    contactId: char.id,
    contactName: char.name,
    contactAvatar: char.avatar,
    fromName: char.name,
    fromAvatar: char.avatar,
    merchantName: order.merchantName,
    merchantEmoji: order.merchantEmoji,
    merchantImg: order.merchantImg,
    amount: order.total,
    itemCount: order.items.reduce((s, i) => s + i.qty, 0),
    items: order.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price, spec: i.spec, emoji: i.emoji, img: i.img })),
    note: order.note,
    status: 'pending',
    createdAt: Date.now(),
    direction: 'friend',
  };
  mtSetProxy(proxy);
  try {
    const idx = kvGet<string[]>('mt-proxy-index') ?? [];
    if (!idx.includes(proxy.id)) kvSet('mt-proxy-index', [...idx, proxy.id].slice(-50));
  } catch {
    /* 忽略 */
  }
  return mtProxyPayOrder(proxy.id, { deferCard: true });
}
