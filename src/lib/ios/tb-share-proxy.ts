'use client';

/**
 * 淘宝「找人代付 + 订单分享」跨 App 链路（对齐美团 mt-proxy-pay / mt-order-share 同款机制）：
 * - 代付：淘宝收银台「找人代付」→ 选微信/QQ → 选联系人 → 代付请求卡（kind='tbpay', role='req'）
 *   写入好友聊天（wx-chat-msgs:/qq-chat-msgs:）→ 广播 TB_PROXY_CARD_EVENT；AI 角色延时自主决策
 *   （tb-proxy-ai）付款 → 请求卡变已代付 + 完成卡（role='done'，样式对齐美团代付卡）回聊天；
 * - 分享：交易成功详情左下角「更多」/ 已发货详情右上角「三个点」→ 选微信/QQ → 选联系人 →
 *   订单分享卡（kind='tbshare'）进聊天；状态时间线（提交订单→付款成功→商家发货→运输中→已签收）
 *   每次渲染按 uid+orderId 实时读订单推导（动态卡，订单推进自动跟随）；
 * - 快递：微信/QQ 加号面板「快递」入口列出「已确认收货（completed）」的淘宝订单，可一键分享给当前聊天好友；
 * - 快照存 IDB kv 全局键（tb-proxy:/tb-share:，不按淘宝 uid 隔离——聊天侧按 id 直取），索引
 *   tb-proxy-index/tb-share-index 供防重与扫单；订单挂 proxy 快照显示「已请 TA 代付」。
 */
import { kvGet, kvSet } from './idb-kv';
import { getContact, cachedContactRealName } from './contacts-store';
import { avatarFor, displayNameOf, isFriendIn, type ContactRecord } from '../contacts';
import { tbGetSession, tbLoadOrders, tbMarkPaid, tbSaveOrders, tbUidOf, TB_PAY_TTL, type TbOrder } from './taobao-store';

// ---------------- 数据模型 ----------------

export interface TbShareItem {
  name: string;
  qty: number;
  price: number;
  img?: string;
}

/** 订单分享快照（静态部分；状态时间线动态推导，不入快照） */
export interface TbOrderShare {
  id: string;
  /** 下单人的淘宝账号 uid（tb-orders:<uid> 定位订单用） */
  uid: string;
  orderId: string;
  /** 分享渠道平台 */
  idp: 'wx' | 'qq';
  /** 好友（联系人） */
  contactId: string;
  contactName: string;
  contactAvatar: string | null;
  /** 分享人（淘宝登录账号本人） */
  fromName: string;
  shopName: string;
  /** 天猫店标（卡片头部品牌标） */
  tmall: boolean;
  amount: number;
  itemCount: number;
  items: TbShareItem[];
  createdAt: number;
  /** 已由 AI 代买代付时展示「X已买单」语义（对齐美团 mt-order-share） */
  paidBy?: string;
  /** 机主送 TA 的礼物（用户说明「给你买的」后标记）：到驿站后 AI 自主取件 */
  gift?: boolean;
  /** 机主请 TA 帮忙取件（淘宝「找人帮取」分享）：到驿站后 AI 取件并回消息 */
  pickupReq?: boolean;
}

export interface TbProxyPay {
  id: string;
  /** 下单人的淘宝账号 uid（tb-orders:<uid> 定位订单用） */
  uid: string;
  orderId: string;
  /** 代付渠道平台 */
  idp: 'wx' | 'qq';
  /** 付款人联系人（AI 角色） */
  contactId: string;
  contactName: string;
  contactAvatar: string | null;
  /** 请求人（淘宝登录账号本人） */
  fromName: string;
  fromAvatar: string | null;
  shopName: string;
  amount: number;
  itemCount: number;
  items: TbShareItem[];
  note?: string;
  /** pending=待代付；paid=已代付；declined=对方婉拒；expired=请求失效（订单取消/超时/机主已自行支付） */
  status: 'pending' | 'paid' | 'declined' | 'expired';
  createdAt: number;
  paidAt?: number;
  /** 好友支付渠道名（微信支付 / QQ钱包） */
  paidChannel?: string;
  /** 终态说明（declined/expired 时展示） */
  closeReason?: string;
  /** 代付方向（对齐美团 mt-proxy-pay）：'friend' = 机主请 AI 好友代付（缺省，存量数据兼容）；
   *  'me' = AI 角色下单请机主代付（付款人 = 机主，请求卡落在角色聊天里） */
  direction?: 'friend' | 'me';
  /** 卡片所在聊天的联系人 id（direction 'me' 时 = 发起角色 id，与付款人 contactId 不同）；缺省 = contactId */
  chatContactId?: string;
}

/** 聊天里的代付卡片消息（微信 WxMsg / QQ QQMsg 同构，kind='tbpay'） */
export interface TbProxyCardMsg {
  id: string;
  role: 'me' | 'peer';
  content: string;
  time: number;
  kind: 'tbpay';
  /** pid = 代付请求 id（tb-proxy:<pid>）；role：req=代付请求卡 / done=代付完成卡 */
  tbpay: { pid: string; role: 'req' | 'done' };
}

/** 聊天里的订单分享卡片消息（kind='tbshare'） */
export interface TbShareCardMsg {
  id: string;
  role: 'me' | 'peer';
  content: string;
  time: number;
  kind: 'tbshare';
  tbshare: { sid: string };
}

/** 卡片落库广播（聊天页在场时监听实时合并，与 MT_PROXY_CARD_EVENT 同机制） */
export const TB_PROXY_CARD_EVENT = 'tb-proxy-card-inserted';
export const TB_SHARE_CARD_EVENT = 'tb-share-card-inserted';

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 代付请求有效期（与淘宝订单待付款 TTL 同口径：30 分钟） */
export const TB_PROXY_TTL = TB_PAY_TTL;

// ---------------- 快照读写（容错规范化） ----------------

function normItems(raw: unknown): TbShareItem[] {
  return Array.isArray(raw)
    ? (raw as Partial<TbShareItem>[])
        .filter((i) => i && typeof i.name === 'string')
        .map((i) => ({
          name: i.name as string,
          qty: typeof i.qty === 'number' ? i.qty : 1,
          price: typeof i.price === 'number' ? i.price : 0,
          img: typeof i.img === 'string' && i.img ? i.img : undefined,
        }))
    : [];
}

function strOr(v: unknown, dflt: string): string {
  return typeof v === 'string' && v ? v : dflt;
}

/** 读取代付请求（容错规范化） */
export function tbGetProxy(pid: string): TbProxyPay | null {
  if (!pid) return null;
  const p = kvGet<Partial<TbProxyPay>>(`tb-proxy:${pid}`);
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.orderId !== 'string') return null;
  return {
    ...p,
    id: p.id,
    uid: strOr(p.uid, ''),
    orderId: p.orderId,
    idp: p.idp === 'qq' ? 'qq' : 'wx',
    contactId: strOr(p.contactId, ''),
    contactName: strOr(p.contactName, '好友'),
    contactAvatar: typeof p.contactAvatar === 'string' ? p.contactAvatar : null,
    fromName: strOr(p.fromName, '我'),
    fromAvatar: typeof p.fromAvatar === 'string' ? p.fromAvatar : null,
    shopName: strOr(p.shopName, '淘宝店铺'),
    amount: typeof p.amount === 'number' ? p.amount : 0,
    itemCount: typeof p.itemCount === 'number' ? p.itemCount : 0,
    items: normItems(p.items),
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

/** 代付卡片所在聊天（direction 'me' = 发起角色聊天；'friend' = 付款人聊天） */
export function tbProxyChatCid(p: TbProxyPay): string {
  return p.direction === 'me' ? p.chatContactId || p.contactId : p.contactId;
}

/** 读取分享快照（容错规范化） */
export function tbGetShare(sid: string): TbOrderShare | null {
  if (!sid) return null;
  const s = kvGet<Partial<TbOrderShare>>(`tb-share:${sid}`);
  if (!s || typeof s !== 'object' || typeof s.id !== 'string' || typeof s.orderId !== 'string') return null;
  return {
    ...s,
    id: s.id,
    uid: strOr(s.uid, ''),
    orderId: s.orderId,
    idp: s.idp === 'qq' ? 'qq' : 'wx',
    contactId: strOr(s.contactId, ''),
    contactName: strOr(s.contactName, '好友'),
    contactAvatar: typeof s.contactAvatar === 'string' ? s.contactAvatar : null,
    fromName: strOr(s.fromName, '我'),
    shopName: strOr(s.shopName, '淘宝店铺'),
    tmall: s.tmall === true,
    amount: typeof s.amount === 'number' ? s.amount : 0,
    itemCount: typeof s.itemCount === 'number' ? s.itemCount : 0,
    items: normItems(s.items),
    createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
    paidBy: typeof s.paidBy === 'string' && s.paidBy ? s.paidBy : undefined,
    gift: s.gift === true,
    pickupReq: s.pickupReq === true,
  };
}

function pushIndex(key: string, id: string): void {
  try {
    const idx = kvGet<string[]>(key) ?? [];
    if (!idx.includes(id)) kvSet(key, [...idx, id].slice(-60));
  } catch {
    /* 忽略 */
  }
}

// ---------------- 动态状态时间线（分享卡核心：跟真实订单状态/物流走） ----------------

export interface TbShareStage {
  key: 'submit' | 'paid' | 'shipped' | 'transit' | 'received';
  label: string;
  /** 到达时刻（未到达 undefined） */
  at?: number;
  /** 运输中阶段附最新物流摘要 */
  trackText?: string;
}

/** 五段动态时间线：提交订单 → 付款成功 → 商家发货 → 运输中（最新物流摘要）→ 已签收 */
export function tbShareStagesOf(order: TbOrder | null): TbShareStage[] {
  if (!order) {
    return [
      { key: 'submit', label: '提交订单' },
      { key: 'paid', label: '付款成功' },
      { key: 'shipped', label: '商家发货' },
      { key: 'transit', label: '运输中' },
      { key: 'received', label: '已签收' },
    ];
  }
  const lastTrack = order.track.length > 0 ? order.track[order.track.length - 1] : undefined;
  return [
    { key: 'submit', label: '提交订单', at: order.createdAt },
    { key: 'paid', label: '付款成功', at: order.paidAt },
    { key: 'shipped', label: '商家发货', at: order.shipAt },
    {
      key: 'transit',
      label: '运输中',
      at: lastTrack?.at,
      trackText: lastTrack?.text,
    },
    { key: 'received', label: '已签收', at: order.completedAt },
  ];
}

/** 快照对应的实时订单（订单被清理时返回 null，卡片按已提交展示） */
export function tbShareOrderOf(share: TbOrderShare): TbOrder | null {
  try {
    return tbLoadOrders(share.uid).find((o) => o.id === share.orderId) ?? null;
  } catch {
    return null;
  }
}

// ---------------- 聊天卡片写入 ----------------

function insertCard(idp: 'wx' | 'qq', contactId: string, msg: TbProxyCardMsg | TbShareCardMsg, event: string): void {
  const key = `${idp === 'wx' ? 'wx' : 'qq'}-chat-msgs:${contactId}`;
  try {
    const cur = kvGet<unknown[]>(key) ?? [];
    kvSet(key, [...cur, msg]); // 聊天记录不封顶（此前截 100 条会把旧记录挤丢）
  } catch {
    /* 落库失败静默 */
  }
  try {
    window.dispatchEvent(new CustomEvent(event, { detail: { cid: contactId, app: idp } }));
  } catch {
    /* 广播失败不影响落库 */
  }
}

/** 平台支付渠道名（完成卡/详情页展示） */
export function tbProxyChannelName(idp: 'wx' | 'qq'): string {
  return idp === 'wx' ? '微信支付' : 'QQ钱包';
}

// ---------------- 发起代付请求 ----------------

export interface TbCreateProxyOpts {
  order: TbOrder;
  idp: 'wx' | 'qq';
  contactId: string;
  fromName: string;
  fromAvatar: string | null;
}

export type TbCreateProxyResult = { ok: true; proxy: TbProxyPay } | { ok: false; error: string };

/** 某订单的全部待处理代付请求（索引扫，同订单同好友防重复用） */
export function findPendingProxyOfOrder(uid: string, orderId: string): TbProxyPay[] {
  void uid;
  const out: TbProxyPay[] = [];
  try {
    const ids = kvGet<string[]>('tb-proxy-index') ?? [];
    for (const pid of ids) {
      const p = tbGetProxy(pid);
      if (p && p.orderId === orderId && p.status === 'pending') out.push(p);
    }
  } catch {
    /* 忽略 */
  }
  return out;
}

/**
 * 发起代付：生成请求 + 订单挂 proxy 快照 + 请求卡进好友聊天 + 调度 AI 自主决策。
 * 同一订单同一好友防重复；订单非待支付拒绝。
 */
export async function tbCreateProxyRequest(opts: TbCreateProxyOpts): Promise<TbCreateProxyResult> {
  const { order, idp, contactId, fromName, fromAvatar } = opts;
  if (order.status !== 'pendingPay') return { ok: false, error: '订单不是待付款状态，无法发起代付' };
  if (!contactId) return { ok: false, error: '请先选择代付好友' };
  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(contactId);
  } catch {
    contact = null;
  }
  if (!contact || contact.kind === 'user') return { ok: false, error: '代付好友不存在或已删除' };
  if (!isFriendIn(contact, idp)) return { ok: false, error: `该好友不是${idp === 'wx' ? '微信' : 'QQ'}好友` };
  // 防重复放宽（同联系人可走不同平台/会话再次发起）：同订单 + 同联系人 + 同 idp 的 pending 请求才算重复
  //（重复时不报错——调用方可改走 tbReshareProxy 复用同 pid 重发卡「催一催」）
  const dup = findPendingProxyOfOrder(order.uid, order.id).find((p) => p.contactId === contactId && p.idp === idp && p.direction !== 'me');
  if (dup) return { ok: false, error: `已向${displayNameOf(contact)}发送过代付请求，等待TA付款` };

  const proxy: TbProxyPay = {
    id: genId('tbpx'),
    uid: order.uid,
    orderId: order.id,
    idp,
    contactId,
    contactName: displayNameOf(contact),
    contactAvatar: avatarFor(contact, idp),
    fromName,
    fromAvatar,
    shopName: order.shopName,
    amount: order.total,
    itemCount: order.items.reduce((s, i) => s + i.qty, 0),
    items: order.items.map((i) => ({ name: i.title, qty: i.qty, price: i.price, img: i.img })),
    status: 'pending',
    createdAt: Date.now(),
  };
  kvSet(`tb-proxy:${proxy.id}`, proxy);
  pushIndex('tb-proxy-index', proxy.id);

  // 订单挂 proxy 快照（收银台/详情显示「已请 TA 代付」）
  try {
    const { tbSaveOrders } = await import('./taobao-store');
    const list = tbLoadOrders(order.uid);
    const hit = list.find((o) => o.id === order.id);
    if (hit) {
      hit.proxy = { id: proxy.id, name: proxy.contactName };
      tbSaveOrders(order.uid, list);
      window.dispatchEvent(new CustomEvent('tb-orders-changed'));
    }
  } catch {
    /* 挂快照失败不阻断 */
  }

  // 请求卡片进聊天（我发给好友）
  insertCard(idp, contactId, {
    id: genId('tbpxm'),
    role: 'me',
    content: `[淘宝代付]帮我付一下¥${fmt2(proxy.amount)}的订单`,
    time: Date.now(),
    kind: 'tbpay',
    tbpay: { pid: proxy.id, role: 'req' },
  }, TB_PROXY_CARD_EVENT);
  // 目标为 AI 角色 → 调度该角色的自主代付决策（动态 import 防模块循环）
  void import('./tb-proxy-ai')
    .then((m) => m.scheduleTbProxyAiDecision(proxy.id))
    .catch(() => undefined);
  return { ok: true, proxy };
}

// ---------------- 再次分享代付请求（详情页「再次分享」按钮 / 聊天内转发活卡共用） ----------------

export type TbReshareResult = { ok: true; pid: string; resent: boolean; card: TbProxyCardMsg } | { ok: false; error: string };

/**
 * 再次分享代付请求：对同订单再次发起/重发代付请求（详情页按钮选微信/QQ好友、聊天长按转发共用）。
 * - 同订单 + 同联系人 + 同 idp 已有 pending 请求（direction 'friend'）→ 复用同 pid 重新发一张请求卡
 *   到该会话「催一催」（resent=true，并再次调度 AI 决策——冷却中的决策会被防重入守卫忽略）；
 * - 否则复制订单快照新建 proxy → 挂订单 o.proxy 快照 → 请求卡进聊天 → 调度 AI 决策。
 * deferCard：转发路径用——不直接落库卡片，把请求卡消息返回给调用方随转发批次落盘
 * （防 insertCard 与 saveMsgs 批量写重复投递）；不传 = 立即落库+广播。
 */
export async function tbReshareProxy(
  pid: string,
  idp: 'wx' | 'qq',
  contactId: string,
  contactName?: string,
  contactAvatar?: string | null,
  fromName?: string,
  fromAvatar?: string | null,
  opts?: { deferCard?: boolean },
): Promise<TbReshareResult> {
  const src = tbGetProxy(pid);
  if (!src) return { ok: false, error: '代付请求不存在或已被清理' };
  if (src.direction === 'me') return { ok: false, error: '这张请求是别人发给你的，不能转发' };
  if (!contactId) return { ok: false, error: '请先选择好友' };
  // 订单仍是待付款才能再次发起（已支付/已取消 → 提示失效，B4 同步会把旧请求收敛为终态）
  const orders = tbLoadOrders(src.uid);
  const order = orders.find((o) => o.id === src.orderId);
  if (!order || order.status !== 'pendingPay') {
    return { ok: false, error: order?.status === 'cancelled' ? '订单已取消，代付请求失效' : '订单已支付或已关闭，无需再代付' };
  }
  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(contactId);
  } catch {
    contact = null;
  }
  if (!contact || contact.kind === 'user') return { ok: false, error: '好友不存在或已删除' };
  if (!isFriendIn(contact, idp)) return { ok: false, error: `该好友不是${idp === 'wx' ? '微信' : 'QQ'}好友` };

  const buildCard = (proxyId: string, amount: number): TbProxyCardMsg => ({
    id: genId('tbpxm'),
    role: 'me',
    content: `[淘宝代付]帮我付一下¥${fmt2(amount)}的订单`,
    time: Date.now(),
    kind: 'tbpay',
    tbpay: { pid: proxyId, role: 'req' },
  });

  // 复用：同订单 + 同联系人 + 同 idp 的 pending 'friend' 请求 → 同 pid 重发卡「催一催」
  const dup = findPendingProxyOfOrder(src.uid, src.orderId).find((p) => p.contactId === contactId && p.idp === idp && p.direction !== 'me');
  if (dup) {
    const card = buildCard(dup.id, dup.amount);
    if (!opts?.deferCard) insertCard(idp, contactId, card, TB_PROXY_CARD_EVENT);
    // 再催一次 AI 决策（决策进行中/已终态时由守卫与状态复查自然兜住）
    void import('./tb-proxy-ai')
      .then((m) => m.scheduleTbProxyAiDecision(dup.id))
      .catch(() => undefined);
    return { ok: true, pid: dup.id, resent: true, card };
  }

  // 新建：复制订单快照（金额/商品以订单实时数据为准）
  const proxy: TbProxyPay = {
    id: genId('tbpx'),
    uid: src.uid,
    orderId: src.orderId,
    idp,
    contactId,
    contactName: contactName ?? displayNameOf(contact),
    contactAvatar: contactAvatar ?? avatarFor(contact, idp),
    fromName: fromName ?? src.fromName,
    fromAvatar: fromAvatar ?? src.fromAvatar ?? null,
    shopName: order.shopName,
    amount: order.total,
    itemCount: order.items.reduce((s, i) => s + i.qty, 0),
    items: order.items.map((i) => ({ name: i.title, qty: i.qty, price: i.price, img: i.img })),
    note: src.note,
    status: 'pending',
    createdAt: Date.now(),
    direction: 'friend',
  };
  kvSet(`tb-proxy:${proxy.id}`, proxy);
  pushIndex('tb-proxy-index', proxy.id);

  // 订单挂 proxy 快照（收银台/详情显示「已请 TA 代付」跟随最新请求）
  try {
    const { tbSaveOrders } = await import('./taobao-store');
    const list = tbLoadOrders(src.uid);
    const hit = list.find((o) => o.id === src.orderId);
    if (hit) {
      hit.proxy = { id: proxy.id, name: proxy.contactName };
      tbSaveOrders(src.uid, list);
      window.dispatchEvent(new CustomEvent('tb-orders-changed'));
    }
  } catch {
    /* 挂快照失败不阻断 */
  }

  const card = buildCard(proxy.id, proxy.amount);
  if (!opts?.deferCard) insertCard(idp, contactId, card, TB_PROXY_CARD_EVENT);
  void import('./tb-proxy-ai')
    .then((m) => m.scheduleTbProxyAiDecision(proxy.id))
    .catch(() => undefined);
  return { ok: true, pid: proxy.id, resent: false, card };
}

// ---------------- B4 失效联动 ----------------

/** 广播某几条代付卡所在聊天刷新 */
function broadcastProxyRefresh(ps: TbProxyPay[]): void {
  const seen = new Set<string>();
  for (const p of ps) {
    if (seen.has(`${p.idp}:${p.contactId}`)) continue;
    seen.add(`${p.idp}:${p.contactId}`);
    try {
      window.dispatchEvent(new CustomEvent(TB_PROXY_CARD_EVENT, { detail: { cid: p.contactId, app: p.idp } }));
    } catch {
      /* 忽略 */
    }
  }
}

/**
 * B4 失效联动：把某淘宝账号下「挂着的 pending 代付请求」与订单真实状态对齐——
 * 订单已取消/超时取消 → expired（原因透传）；订单已被机主直接支付/不存在 → expired；
 * 订单已支付且该请求就是付款方（paidChannel 已落）→ paid（幂等落定）。
 * 由 tbMarkPaid / tbCancelOrder / 直付收银台调用；返回是否有变更。
 */
export function tbSyncProxiesForUid(uid: string): boolean {
  let changed = false;
  const touched: TbProxyPay[] = [];
  try {
    const ids = kvGet<string[]>('tb-proxy-index') ?? [];
    if (ids.length === 0) return false;
    const orders = tbLoadOrders(uid);
    for (const pid of ids) {
      const p = tbGetProxy(pid);
      if (!p || p.status !== 'pending' || p.uid !== uid) continue;
      const o = orders.find((x) => x.id === p.orderId);
      if (!o) {
        const done: TbProxyPay = { ...p, status: 'expired', closeReason: '订单不存在，代付请求失效' };
        kvSet(`tb-proxy:${done.id}`, done);
        changed = true;
        touched.push(done);
        continue;
      }
      if (o.status === 'cancelled') {
        const done: TbProxyPay = { ...p, status: 'expired', closeReason: o.cancelReason ?? '订单已取消' };
        kvSet(`tb-proxy:${done.id}`, done);
        changed = true;
        touched.push(done);
        continue;
      }
      if (o.status !== 'pendingPay') {
        // 订单已支付：渠道文案带该请求付款人名 → 好友已代付但快照滞后，落 paid；否则机主自己付的 → expired
        const selfPaid = !(o.payChannelLabel && o.payChannelLabel.includes(p.contactName));
        const done: TbProxyPay = selfPaid
          ? { ...p, status: 'expired', closeReason: '机主已自行支付，无需代付' }
          : { ...p, status: 'paid', paidAt: o.paidAt ?? Date.now(), paidChannel: tbProxyChannelName(p.idp) };
        kvSet(`tb-proxy:${done.id}`, done);
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

// ---------------- 好友代付（AI 决策路径） ----------------

export type TbProxyPayResult = { ok: true; proxy: TbProxyPay; order: TbOrder } | { ok: false; error: string };

/** B5 婉拒：AI 决策婉拒后把请求置 declined（请求卡变「对方婉拒了」，订单仍待付款可自付） */
export function tbDeclineProxy(pid: string, reason?: string): boolean {
  const p = tbGetProxy(pid);
  if (!p || p.status !== 'pending') return false;
  const done: TbProxyPay = { ...p, status: 'declined', closeReason: reason ?? '对方婉拒了这次代付' };
  kvSet(`tb-proxy:${done.id}`, done);
  broadcastProxyRefresh([done]);
  return true;
}

/**
 * 代付支付：请求置 paid + 订单支付完成（tbMarkPaid 状态机接手）+ 完成卡片回聊天 + 灵动岛通知。
 * 演示语义：付款人以「微信支付/QQ钱包」付款，不扣本机任何钱包余额。
 * deferCard：AI 动作路径用——不直接落库卡片，把完成卡消息返回给调用方随回复队列投递
 * （防 buildReplyMsgs 的 cur 快照覆盖丢卡）；不传 = 立即落库+广播。
 */
export function tbProxyPayOrder(pid: string, opts?: { deferCard?: boolean }): TbProxyPayResult & { card?: TbProxyCardMsg } {
  const p = tbGetProxy(pid);
  if (!p) return { ok: false, error: '代付请求不存在或已被清理' };
  if (p.status !== 'pending') return { ok: false, error: '该代付请求已处理，请勿重复支付' };
  const orders = tbLoadOrders(p.uid);
  const cur = orders.find((o) => o.id === p.orderId);
  if (!cur) return { ok: false, error: '订单不存在，代付请求失效' };
  if (cur.status !== 'pendingPay') return { ok: false, error: cur.status === 'cancelled' ? '订单已取消，代付请求失效' : '订单已支付，无需重复代付' };

  const now = Date.now();
  const channel = tbProxyChannelName(p.idp);
  const meDir = p.direction === 'me';
  // 支付落账：pendingPay → pendingDeliver（渠道文案带付款人名——B4 据此判定代付方）
  const okPaid = tbMarkPaid(p.uid, p.orderId, {
    payIdp: p.idp,
    payChannelLabel: meDir ? `代付 · ${channel}（${p.contactName}）` : `好友代付 · ${channel}（${p.contactName}）`,
    payMethodId: meDir ? 'proxy-me' : 'proxy',
    payFc: false,
  });
  if (!okPaid) return { ok: false, error: '订单状态已变化，代付未完成' };

  const done: TbProxyPay = { ...p, status: 'paid', paidAt: now, paidChannel: channel };
  kvSet(`tb-proxy:${done.id}`, done);

  // 完成卡片（direction 'friend'：好友发回给我；'me'：我付完回执给角色）
  const card: TbProxyCardMsg = {
    id: genId('tbpxm'),
    role: meDir ? 'me' : 'peer',
    content: meDir ? `[淘宝代付]已帮${p.fromName}代付¥${fmt2(p.amount)}` : `[淘宝代付]已帮你代付¥${fmt2(p.amount)}`,
    time: now,
    kind: 'tbpay',
    tbpay: { pid: p.id, role: 'done' },
  };
  if (opts?.deferCard) {
    // AI 动作路径：卡片随回复投递管线落盘（调用方负责 out.push）
    window.dispatchEvent(new CustomEvent('tb-orders-changed'));
    return { ok: true, proxy: done, order: { ...cur, status: 'pendingDeliver', paidAt: now }, card };
  }
  insertCard(p.idp, tbProxyChatCid(done), card, TB_PROXY_CARD_EVENT);
  window.dispatchEvent(new CustomEvent('tb-orders-changed'));
  // 灵动岛通知（淘宝订单 · 代付完成；点击进淘宝对应订单详情）
  void import('./island-notify')
    .then((m) =>
      m.pushChatNotification({
        sessionKey: `tb:order:${p.orderId}`,
        app: 'taobao',
        title: '淘宝订单',
        avatar: '/icons/taobao.png',
        body: meDir ? `你已帮${p.fromName}代付¥${fmt2(p.amount)}，订单已支付` : `好友${p.contactName}已代付¥${fmt2(p.amount)}，订单已支付`,
        target: { app: 'taobao', contactId: p.orderId },
      })
    )
    .catch(() => undefined);
  return { ok: true, proxy: done, order: { ...cur, status: 'pendingDeliver', paidAt: now } };
}

// ---------------- AI 历史序列化（tbpay/tbshare 卡 → AI 可读文本） ----------------

export function tbProxyHistoryLine(pid: string, cardRole: 'req' | 'done', senderName: string): string {
  const p = tbGetProxy(pid);
  if (!p) return '[淘宝代付卡片]';
  if (cardRole === 'req') {
    const stateText = p.status === 'pending' ? '待代付' : p.status === 'paid' ? '已代付' : p.status === 'declined' ? '已婉拒' : `已失效（${p.closeReason ?? '订单未支付'}）`;
    return `[淘宝代付请求 id:${p.id}]（${senderName}发的：淘宝店「${p.shopName}」¥${fmt2(p.amount)}，${p.items.map((i) => `${i.name}x${i.qty}`).join('、')}${p.note ? `，备注:${p.note}` : ''}，状态:${stateText}）`;
  }
  return `[淘宝代付回执 id:${p.id}]（${senderName}：已代付淘宝店「${p.shopName}」¥${fmt2(p.amount)}，订单支付完成）`;
}

/** AI 请机主代付的请求卡 → AI 可读文本（机主未付时可以撒娇提及） */
export function tbProxyMeHistoryLine(pid: string): string {
  const p = tbGetProxy(pid);
  if (!p) return '[淘宝代付卡片]';
  const stateText = p.status === 'pending' ? '待机主支付' : p.status === 'paid' ? '机主已代付' : p.status === 'declined' ? '机主婉拒了' : `已失效（${p.closeReason ?? ''}）`;
  return `[你的淘宝代付请求 id:${p.id}]（你在淘宝店「${p.shopName}」拍了 ¥${fmt2(p.amount)}，${p.items.map((i) => `${i.name}x${i.qty}`).join('、')}，请机主代付，状态:${stateText}）`;
}

/** 订单分享卡 → AI 可读文本（含实时物流状态/礼物/帮取标记，AI 能自然接话与行动）。
 *  fromName 是社交展示名（可能是机主昵称）：contactId 能解析到真名就替换（用户规则：AI 永不知道机主昵称） */
export function tbShareHistoryLine(sid: string): string {
  const s = tbGetShare(sid);
  if (!s) return '[淘宝订单分享卡片]';
  const order = tbShareOrderOf(s);
  const status = order
    ? order.status === 'pendingPay'
      ? '待付款'
      : order.status === 'pendingDeliver'
        ? '待发货'
        : order.status === 'shipped'
          ? '已发货'
          : order.status === 'completed'
            ? '已签收'
            : '已取消'
    : '未知';
  const flags = [
    s.gift ? '机主说明这是送你的礼物（到驿站后你要自己去取）' : '',
    s.pickupReq ? '机主请你帮忙取件（到驿站后帮忙去取）' : '',
    s.paidBy ? `已由${s.paidBy}代买代付` : '',
  ].filter(Boolean);
  const realFrom = s.contactId ? cachedContactRealName(s.contactId) : '';
  return `[淘宝订单分享 id:${s.id} 订单:${s.orderId}]（${realFrom || s.fromName}分享的：淘宝店「${s.shopName}」¥${fmt2(s.amount)}，${s.items.map((i) => `${i.name}x${i.qty}`).join('、')}，当前状态:${status}${flags.length ? `，${flags.join('，')}` : ''}）`;
}

/** AI 幻觉回显剥除：模型照抄聊天历史里的卡片序列化行当正文时整行剥除（与美团端同口径） */
const TB_ECHO_LINE_RE = /^\s*\[淘宝(?:代付请求|代付回执|代付|订单分享|快递|你的淘宝代付请求|代买)[^\]]*\]\s*（.*）\s*$/;
export function stripTbEchoText(text: string): string {
  const lines = text.split('\n');
  const kept = lines.filter((l) => !TB_ECHO_LINE_RE.test(l));
  return kept.length === lines.length ? text : kept.join('\n');
}

// ---------------- 发起订单分享 ----------------

export interface TbCreateShareOpts {
  order: TbOrder;
  idp: 'wx' | 'qq';
  contactId: string;
  fromName: string;
  /** 'me' = 机主发给好友（缺省）；'peer' = AI 角色发给机主（AI 代买请客） */
  role?: 'me' | 'peer';
  /** 已由 AI 代买代付时展示「X已买单」 */
  paidBy?: string;
  /** 机主送 TA 的礼物（聊天说明「给你买的」时标记） */
  gift?: boolean;
  /** 机主请 TA 帮忙取件（淘宝「找人帮取」） */
  pickupReq?: boolean;
  /** 自定义卡片前置文案（缺省按 role/意图生成） */
  content?: string;
}

export type TbCreateShareResult = { ok: true; share: TbOrderShare } | { ok: false; error: string };

/**
 * 发起订单分享：生成快照 + 动态卡片进好友聊天（我发给好友 / AI 发给机主）。
 * 同一订单同一好友 30 秒内防重复连发；好友必须存在且为该平台好友。
 */
export async function tbCreateOrderShare(opts: TbCreateShareOpts): Promise<TbCreateShareResult> {
  const { order, idp, contactId, fromName } = opts;
  if (!contactId) return { ok: false, error: '请先选择分享好友' };
  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(contactId);
  } catch {
    contact = null;
  }
  if (!contact || contact.kind === 'user') return { ok: false, error: '分享好友不存在或已删除' };
  if (!isFriendIn(contact, idp)) return { ok: false, error: `该好友不是${idp === 'wx' ? '微信' : 'QQ'}好友` };

  const share: TbOrderShare = {
    id: genId('tbsh'),
    uid: order.uid,
    orderId: order.id,
    idp,
    contactId,
    contactName: displayNameOf(contact),
    contactAvatar: avatarFor(contact, idp),
    fromName,
    shopName: order.shopName,
    tmall: order.shopName.includes('天猫'),
    amount: order.total,
    itemCount: order.items.reduce((s, i) => s + i.qty, 0),
    items: order.items.map((i) => ({ name: i.title, qty: i.qty, price: i.price, img: i.img })),
    createdAt: Date.now(),
    ...(opts.paidBy ? { paidBy: opts.paidBy } : {}),
    ...(opts.gift ? { gift: true } : {}),
    ...(opts.pickupReq ? { pickupReq: true } : {}),
  };
  kvSet(`tb-share:${share.id}`, share);
  pushIndex('tb-share-index', share.id);

  // 礼物/帮取标记同步写到订单上（AI 取件 watcher 读订单，不扫分享索引）
  if (opts.gift || opts.pickupReq) {
    try {
      const { tbSaveOrders } = await import('./taobao-store');
      const list = tbLoadOrders(order.uid);
      const hit = list.find((o) => o.id === order.id);
      if (hit && hit.status === 'shipped' && !hit.aiPickup) {
        hit.aiPickup = { contactId, contactName: displayNameOf(contact), app: idp, kind: opts.gift ? 'gift' : 'favor' };
        tbSaveOrders(order.uid, list);
        window.dispatchEvent(new CustomEvent('tb-orders-changed'));
      }
    } catch {
      /* 标记失败不阻断分享 */
    }
  }

  const defaultContent = opts.gift
    ? `[淘宝订单分享]送你的礼物已下单，到货你记得取呀`
    : opts.pickupReq
      ? `[淘宝订单分享]帮我取一下这个快递`
      : opts.paidBy
        ? `[淘宝订单分享]请你吃的「${order.shopName}」已下单，我付好啦`
        : `[淘宝订单分享]分享一个${order.shopName}的订单`;
  insertCard(idp, contactId, {
    id: genId('tbshm'),
    role: opts.role === 'peer' ? 'peer' : 'me',
    content: opts.content?.trim() || defaultContent,
    time: Date.now(),
    kind: 'tbshare',
    tbshare: { sid: share.id },
  }, TB_SHARE_CARD_EVENT);
  return { ok: true, share };
}

// ---------------- AI 帮机主代付（[帮付淘宝]/主动参与执行器用） ----------------

/**
 * AI 帮机主代付指定待付款订单：建 direction 'friend' 代付记录（付款人 = 该 AI 角色）→
 * 立即支付（deferCard，完成卡由调用方投递）。对齐美团 mtAiPayPendingOrder。
 */
export function tbAiPayPendingOrder(
  order: TbOrder,
  char: { id: string; name: string; avatar: string | null },
  idp: 'wx' | 'qq',
): TbProxyPayResult & { card?: TbProxyCardMsg } {
  if (order.status !== 'pendingPay') return { ok: false, error: '订单不是待付款状态' };
  const proxy: TbProxyPay = {
    id: genId('tbpx'),
    uid: order.uid,
    orderId: order.id,
    idp,
    contactId: char.id,
    contactName: char.name,
    contactAvatar: char.avatar,
    fromName: char.name,
    fromAvatar: char.avatar,
    shopName: order.shopName,
    amount: order.total,
    itemCount: order.items.reduce((s, i) => s + i.qty, 0),
    items: order.items.map((i) => ({ name: i.title, qty: i.qty, price: i.price, img: i.img })),
    status: 'pending',
    createdAt: Date.now(),
    direction: 'friend',
  };
  kvSet(`tb-proxy:${proxy.id}`, proxy);
  pushIndex('tb-proxy-index', proxy.id);
  return tbProxyPayOrder(proxy.id, { deferCard: true });
}

// ---------------- AI 请机主代付（direction 'me'，tb-ai-engage [自己买] 用） ----------------

export interface TbCreateProxyByCharOpts {
  order: TbOrder;
  idp: 'wx' | 'qq';
  /** 发起请求的 AI 角色（卡片落在 TA 的聊天里） */
  char: { id: string; name: string; avatar: string | null };
  /** 付款人（机主联系人） */
  payer: { id: string; name: string; avatar: string | null };
}

/**
 * AI 角色请机主代付（direction 'me'）：生成请求 + 请求卡（角色→机主）落在该角色聊天。
 * 同一订单同一角色防重复；订单非待支付拒绝；不调度 AI 决策（付款人是机主本人）。
 */
export async function tbCreateProxyRequestByChar(opts: TbCreateProxyByCharOpts): Promise<TbCreateProxyResult> {
  const { order, idp, char, payer } = opts;
  if (order.status !== 'pendingPay') return { ok: false, error: '订单不是待付款状态，无法发起代付' };
  const dup = findPendingProxyOfOrder(order.uid, order.id).find((p) => p.direction === 'me' && tbProxyChatCid(p) === char.id);
  if (dup) return { ok: false, error: '已经请机主代付这张订单啦' };

  const proxy: TbProxyPay = {
    id: genId('tbpx'),
    uid: order.uid,
    orderId: order.id,
    idp,
    contactId: payer.id,
    contactName: payer.name,
    contactAvatar: payer.avatar,
    fromName: char.name,
    fromAvatar: char.avatar,
    shopName: order.shopName,
    amount: order.total,
    itemCount: order.items.reduce((s, i) => s + i.qty, 0),
    items: order.items.map((i) => ({ name: i.title, qty: i.qty, price: i.price, img: i.img })),
    status: 'pending',
    createdAt: Date.now(),
    direction: 'me',
    chatContactId: char.id,
  };
  kvSet(`tb-proxy:${proxy.id}`, proxy);
  pushIndex('tb-proxy-index', proxy.id);

  // 订单挂 proxy 快照（详情显示「已请机主代付」语义）
  try {
    const { tbSaveOrders } = await import('./taobao-store');
    const list = tbLoadOrders(order.uid);
    const hit = list.find((o) => o.id === order.id);
    if (hit) {
      hit.proxy = { id: proxy.id, name: payer.name };
      tbSaveOrders(order.uid, list);
      window.dispatchEvent(new CustomEvent('tb-orders-changed'));
    }
  } catch {
    /* 挂快照失败不阻断 */
  }

  // 请求卡片进聊天（AI 发给机主）
  insertCard(idp, char.id, {
    id: genId('tbpxm'),
    role: 'peer',
    content: `[淘宝代付]帮我付一下¥${fmt2(proxy.amount)}的订单`,
    time: Date.now(),
    kind: 'tbpay',
    tbpay: { pid: proxy.id, role: 'req' },
  }, TB_PROXY_CARD_EVENT);
  return { ok: true, proxy };
}

// ---------------- 快递入口（微信/QQ 加号面板「快递」） ----------------

/** 已确认收货的淘宝订单（快递面板列表；Task 2-b 放开票务单：演出票核销入场（completed）也可分享；
 *  未登录淘宝 → 空列表） */
export function tbCompletedOrders(): TbOrder[] {
  try {
    const s = tbGetSession();
    if (!s) return [];
    return tbLoadOrders(tbUidOf(s))
      .filter((o) => o.status === 'completed')
      .sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt));
  } catch {
    return [];
  }
}

/** 某聊天内全部待处理代付请求（两个方向都在该聊天内流转；动作规则/等待态用） */
export function tbPendingProxiesOfChat(chatContactId: string): TbProxyPay[] {
  const out: TbProxyPay[] = [];
  try {
    const ids = kvGet<string[]>('tb-proxy-index') ?? [];
    for (const pid of ids) {
      const p = tbGetProxy(pid);
      if (p && p.status === 'pending' && tbProxyChatCid(p) === chatContactId) out.push(p);
    }
  } catch {
    /* 忽略 */
  }
  return out;
}
