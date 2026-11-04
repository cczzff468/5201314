/**
 * 美团 App 数据层（本地优先，与微信/QQ 同架构）：
 * - 所有美团数据存 IndexedDB kv（idb-kv 内存同步读 + 异步写穿），键按登录账号隔离：
 *   登录身份 uid = `wx:<联系人id>` / `qq:<联系人id>` / `ph:<手机号>`，美团数据键全部带 uid
 *   （`mt-orders:<uid>` 等）——换账号登录互不串数据（需求「美团数据按账号隔离」）；
 * - 登录态存 localStorage `mt-session`（重启后仍保留）；
 * - 订单状态机：待支付 → 待接单 → 商家已接单 → 配送中 → 已送达（已完成）/ 已取消；
 *   按时间戳确定性推进（MeituanOrderWatcher 全局 tick + 打开 App 时 catch-up，重启不丢进度）。
 * 支付不在这里：meituan-pay.ts 动态 import 微信/QQ 钱包模块（避免全局加载 1.4 万行聊天模块）。
 */
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { dsMinutesFor } from './delivery-speed';
import { accLs, getActiveAccountFor, isForceLoginWallActive } from '@/lib/ios/accounts';
import { getContact, listContacts } from '@/lib/ios/contacts-store';
import type { ContactRecord } from '@/lib/contacts';
import { avatarFor } from '@/lib/contacts';
import { MT_COUPON_SEED, MT_COUPON_TYPE_LABEL, MT_GOD_CLAIMS, MT_DEALS, MT_MERCHANTS, mtDealOf, mtDishesOf, mtImg, mtMerchantOf, type MtCouponSeed, type MtCouponType, type MtMerchant, type MtShopCouponDef } from './meituan-data';
import type { OrderCustomMeta } from './order-custom';
import { normalizeOrderCustom } from './order-custom';

// ---------------- 登录态 ----------------

export interface MtSession {
  /** 登录方式：QQ 一键 / 微信一键 / 手机号 */
  idp: 'wx' | 'qq' | 'phone';
  /** wx/qq 登录：联系人记录 id（机主或小号档案） */
  contactId?: string;
  /** 手机号登录：手机号 */
  phone?: string;
  /** 登录途径：'oneclick' 一键授权（登录态跟随微信/QQ App）；'password' 账号密码（独立于微信/QQ App 登录态）。旧会话无此字段按 oneclick 处理 */
  via?: 'oneclick' | 'password';
  name: string;
  avatar: string | null;
  loginAt: number;
}

const LS_SESSION = 'mt-session';
const LS_RECENTS = 'mt-recent-users';
const LS_SEARCH_HIST = 'mt-search-hist';

/** 数据隔离键 uid：不同美团账号（微信/QQ/手机号）各一份购物车/订单/地址 */
export function mtUidOf(s: MtSession): string {
  if (s.idp === 'phone') return `ph:${s.phone ?? ''}`;
  return `${s.idp}:${s.contactId ?? ''}`;
}

export function mtGetSession(): MtSession | null {
  try {
    const raw = window.localStorage.getItem(LS_SESSION);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<MtSession>;
    if (!p || typeof p !== 'object' || (p.idp !== 'wx' && p.idp !== 'qq' && p.idp !== 'phone')) return null;
    if (typeof p.name !== 'string' || !p.name) return null;
    return {
      idp: p.idp,
      contactId: typeof p.contactId === 'string' ? p.contactId : undefined,
      phone: typeof p.phone === 'string' ? p.phone : undefined,
      via: p.via === 'password' || p.via === 'oneclick' ? p.via : undefined,
      name: p.name,
      avatar: typeof p.avatar === 'string' ? p.avatar : null,
      loginAt: typeof p.loginAt === 'number' ? p.loginAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function mtSetSession(s: MtSession | null): void {
  try {
    if (s) {
      window.localStorage.setItem(LS_SESSION, JSON.stringify(s));
      mtPushRecent(s);
    } else {
      window.localStorage.removeItem(LS_SESSION);
    }
  } catch {
    /* 忽略 */
  }
}

/** 最近登录过的美团账号（切换账号页快捷头像，最多 4 个） */
export interface MtRecentUser {
  uid: string;
  idp: 'wx' | 'qq' | 'phone';
  name: string;
  avatar: string | null;
}

export function mtGetRecents(): MtRecentUser[] {
  try {
    const raw = window.localStorage.getItem(LS_RECENTS);
    const arr = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((r): r is MtRecentUser => Boolean(r) && typeof (r as MtRecentUser).uid === 'string' && typeof (r as MtRecentUser).name === 'string')
      .slice(0, 4);
  } catch {
    return [];
  }
}

function mtPushRecent(s: MtSession): void {
  try {
    const uid = mtUidOf(s);
    const rest = mtGetRecents().filter((r) => r.uid !== uid);
    window.localStorage.setItem(LS_RECENTS, JSON.stringify([{ uid, idp: s.idp, name: s.name, avatar: s.avatar }, ...rest].slice(0, 4)));
  } catch {
    /* 忽略 */
  }
}

export function mtGetSearchHist(): string[] {
  try {
    const raw = window.localStorage.getItem(LS_SEARCH_HIST);
    const arr = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
  } catch {
    return [];
  }
}

export function mtPushSearchHist(kw: string): void {
  const k = kw.trim().slice(0, 20);
  if (!k) return;
  try {
    const next = [k, ...mtGetSearchHist().filter((x) => x !== k)].slice(0, 10);
    window.localStorage.setItem(LS_SEARCH_HIST, JSON.stringify(next));
  } catch {
    /* 忽略 */
  }
}

export function mtClearSearchHist(): void {
  try {
    window.localStorage.removeItem(LS_SEARCH_HIST);
  } catch {
    /* 忽略 */
  }
}

// ---------------- 登录身份解析（QQ/微信一键登录） ----------------

/**
 * 微信/QQ App 登录态（需求「一键登录才需要登录微信/QQ，账密登录不需要」）：
 * 会话键 `wx-session-user-id` / `qq-session-user-id`（账号作用域）有值 = 对应 App 有登录过的账号
 * （2025 登录态保持：退出也不删键，供免密切回）；但退出后 App 处于「自由登录墙」
 * （wx/qq-force-login，用户视角即未登录）→ 同样视为未登录。
 * 与微信/QQ App 自身的登录/退出语义同源，美团读取即时生效。
 */
export function mtIdpLoggedIn(idp: 'wx' | 'qq'): boolean {
  try {
    if (isForceLoginWallActive(idp)) return false;
    return Boolean(window.localStorage.getItem(accLs(`${idp}-session-user-id`, idp)));
  } catch {
    return false;
  }
}

/** 是否至少一个授权源（微信或 QQ）在线：一键登录/旧手机号会话以此为前置（账密登录不依赖） */
export function mtAnyIdpLoggedIn(): boolean {
  return mtIdpLoggedIn('wx') || mtIdpLoggedIn('qq');
}

/**
 * 解析微信/QQ 当前账号对应的「人」的联系人（一键登录读取账号信息）：
 * 1) 该端登录会话指针（与微信/QQ App 显示的「我」一致）；
 * 2) 回退：账号槽位关联的档案联系人（main = 机主，alt/anon = altOf/ownerContactId）；
 * 3) 终底：联系人库为空（全新环境/未初始化）→ 本地虚拟账号（contactId 空，uid 仍按端隔离），
 *    保证「一键登录」永不失败；真机上正常走 1/2 拿到真实昵称头像。
 */
export async function mtResolveIdpIdentity(idp: 'wx' | 'qq'): Promise<{ contactId: string; name: string; avatar: string | null }> {
  try {
    const acc = getActiveAccountFor(idp);
    const all = await listContacts();
    let me: ContactRecord | undefined;
    const sid = typeof window !== 'undefined' ? window.localStorage.getItem(accLs(`${idp}-session-user-id`, idp)) : null;
    if (sid) me = all.find((c) => c.id === sid && c.kind === 'user');
    if (!me) {
      me =
        acc.kind === 'main'
          ? all.find((c) => c.kind === 'user' && !c.altOf)
          : (all.find((c) => c.altOf === acc.id) ?? (acc.ownerContactId ? all.find((c) => c.id === acc.ownerContactId) : undefined));
    }
    if (me) {
      const name = (me.nickname?.trim() || me.name || '').trim() || (idp === 'wx' ? '微信用户' : 'QQ用户');
      return { contactId: me.id, name, avatar: avatarFor(me, idp) };
    }
  } catch {
    /* 联系人库异常 → 走虚拟账号兜底 */
  }
  return { contactId: '', name: idp === 'wx' ? '微信用户' : 'QQ用户', avatar: null };
}

/**
 * 登录会话有效性校验（打开 App 时调用）：
 * 1) 登录态联动（需求「一键登录才需要登录微信/QQ，账密登录不需要」）：
 *    - wx/qq 一键会话（via 非 'password'）：对应授权源 App 已退出登录 → 美团同步登出（回登录页）；
 *    - wx/qq 账密会话（via = 'password'）：独立于微信/QQ App 登录态，App 未登录/退出均不影响；
 *    - phone 会话：微信与 QQ 都不在线 → 同步登出。
 * 2) wx/qq 会话对应的联系人被删除 → 视为已退出；
 *    本地虚拟账号（联系人库为空时一键登录的兜底，contactId 空）仅校验登录态。
 */
export async function mtValidateSession(s: MtSession | null): Promise<MtSession | null> {
  if (!s) return null;
  if (s.idp === 'phone') {
    if (!s.phone) return null;
    return mtAnyIdpLoggedIn() ? s : null;
  }
  // 账密登录的会话与微信/QQ App 登录态无关；仅一键授权会话跟随对应 App 会话
  if (s.via !== 'password' && !mtIdpLoggedIn(s.idp)) return null;
  if (!s.contactId) return s;
  try {
    const c = await getContact(s.contactId);
    return c && c.kind === 'user' ? s : null;
  } catch {
    return null;
  }
}

/**
 * 会话资料跟随全局账号信息（需求「我的界面的头像跟随全局信息的头像」）：
 * 按会话绑定的联系人实时读取微信/QQ「我」页的昵称/头像（avatarFor 按 App 投影，与微信/QQ 显示一致），
 * 变化则返回新会话（uid 不变，数据隔离不受影响）；联系人缺失/异常时原样返回。
 * 配合 contact-avatar-changed 事件可实时同步。
 */
export async function mtSyncSessionIdentity(s: MtSession): Promise<MtSession> {
  if (s.idp === 'phone' || !s.contactId) return s;
  try {
    const c = await getContact(s.contactId);
    if (!c || c.kind !== 'user') return s;
    const name = (c.nickname?.trim() || c.name || '').trim() || s.name;
    const avatar = avatarFor(c, s.idp);
    if (name === s.name && avatar === s.avatar) return s;
    return { ...s, name, avatar };
  } catch {
    return s;
  }
}

// ---------------- 购物车（单商家模式：跨店加购需清空换店，对齐真机） ----------------

export interface MtCart {
  merchantId: string | null;
  items: { dishId: string; qty: number; /** 规格文案（大杯/正常冰/珍珠/正常糖） */ spec?: string; /** 含小料加价的单价（覆盖菜品原价） */ unitPrice?: number }[];
}

const cartKey = (uid: string) => `mt-cart:${uid}`;

export function mtLoadCart(uid: string): MtCart {
  const c = kvGet<Partial<MtCart>>(cartKey(uid));
  if (c && typeof c === 'object' && Array.isArray(c.items)) {
    return {
      merchantId: typeof c.merchantId === 'string' ? c.merchantId : null,
      items: c.items.filter((i) => i && typeof i.dishId === 'string' && typeof i.qty === 'number' && i.qty > 0).map((i) => ({
        dishId: i.dishId,
        qty: i.qty,
        spec: typeof i.spec === 'string' && i.spec ? i.spec : undefined,
        unitPrice: typeof i.unitPrice === 'number' && i.unitPrice > 0 ? i.unitPrice : undefined,
      })),
    };
  }
  return { merchantId: null, items: [] };
}

export function mtSaveCart(uid: string, cart: MtCart): void {
  kvSet(cartKey(uid), cart);
}

export function mtCartCount(cart: MtCart): number {
  return cart.items.reduce((s, i) => s + i.qty, 0);
}

// ---------------- 收货地址 ----------------

export interface MtAddress {
  id: string;
  name: string;
  phone: string;
  text: string;
  tag: string;
}

const addrKey = (uid: string) => `mt-addrs:${uid}`;
const LS_CUR_ADDR = 'mt-cur-addr';

export function mtCurAddrId(uid: string): string {
  try {
    return window.localStorage.getItem(`${LS_CUR_ADDR}:${uid}`) ?? '';
  } catch {
    return '';
  }
}

export function mtSetCurAddr(uid: string, id: string): void {
  try {
    window.localStorage.setItem(`${LS_CUR_ADDR}:${uid}`, id);
  } catch {
    /* 忽略 */
  }
}

/** 地址列表（空则播种默认地址；默认地址自动选中） */
export function mtLoadAddresses(uid: string): MtAddress[] {
  const list = kvGet<Partial<MtAddress>[]>(addrKey(uid));
  if (Array.isArray(list) && list.length > 0) {
    return list
      .filter((a) => a && typeof a.text === 'string')
      .map((a, i) => ({
        id: typeof a.id === 'string' ? a.id : `addr${i}`,
        name: typeof a.name === 'string' ? a.name : '收货人',
        phone: typeof a.phone === 'string' ? a.phone : '',
        text: a.text as string,
        tag: typeof a.tag === 'string' && a.tag ? a.tag : '家',
      }));
  }
  const seed: MtAddress[] = [
    { id: 'addr1', name: '陶先生', phone: '156****2929', text: '幸福小区西区 3 栋 2 单元 502', tag: '家' },
    { id: 'addr2', name: '陶先生', phone: '156****2929', text: '科技园写字楼 B 座 12 层 1206', tag: '公司' },
  ];
  kvSet(addrKey(uid), seed);
  mtSetCurAddr(uid, seed[0].id);
  return seed;
}

export function mtSaveAddresses(uid: string, list: MtAddress[]): void {
  kvSet(addrKey(uid), list);
}

// ---------------- 订单 ----------------

export type MtOrderStatus = 'pendingPay' | 'pendingAccept' | 'accepted' | 'delivering' | 'completed' | 'canceled';

export const MT_STATUS_LABEL: Record<MtOrderStatus, string> = {
  pendingPay: '待支付',
  pendingAccept: '待接单',
  accepted: '商家已接单',
  delivering: '配送中',
  completed: '已完成',
  canceled: '已取消',
};

/** 订单履约类型：外卖配送（默认，兼容旧数据）/ 团购到店（支付后直接完成）/ 机票 / 火车票（支付后→待出行→出行中→完成） */
export type MtOrderKind = 'waimai' | 'tuangou' | 'flight' | 'train';

export interface MtOrderItem {
  dishId: string;
  name: string;
  price: number;
  qty: number;
  emoji: string;
  img?: string;
  /** 规格文案（含小料：大杯/正常冰/珍珠/正常糖） */
  spec?: string;
}

// ---------------- 收藏（商家/菜品/团购） ----------------

export interface MtFavs {
  stores: string[];
  dishes: string[];
  deals: string[];
}

const favsKey = (uid: string) => `mt-favs:${uid}`;

export function mtLoadFavs(uid: string): MtFavs {
  const f = kvGet<Partial<MtFavs>>(favsKey(uid));
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { stores: arr(f?.stores), dishes: arr(f?.dishes), deals: arr(f?.deals) };
}

export function mtSaveFavs(uid: string, favs: MtFavs): void {
  kvSet(favsKey(uid), favs);
}

/** 切换收藏状态；返回切换后是否已收藏 */
export function mtToggleFav(uid: string, kind: keyof MtFavs, id: string): boolean {
  const favs = mtLoadFavs(uid);
  const list = favs[kind];
  const has = list.includes(id);
  const next = has ? list.filter((x) => x !== id) : [id, ...list];
  mtSaveFavs(uid, { ...favs, [kind]: next.slice(0, 99) });
  return !has;
}

// ---------------- 浏览记录（商家/团购，按时间倒序） ----------------

export interface MtHistItem {
  kind: 'merchant' | 'deal';
  id: string;
  at: number;
}

const histKey = (uid: string) => `mt-history:${uid}`;
const MAX_HIST = 50;

export function mtLoadHistory(uid: string): MtHistItem[] {
  const list = kvGet<Partial<MtHistItem>[]>(histKey(uid));
  if (!Array.isArray(list)) return [];
  return list
    .filter((h): h is MtHistItem => Boolean(h) && typeof h.id === 'string' && typeof h.at === 'number' && (h.kind === 'merchant' || h.kind === 'deal'))
    .slice(0, MAX_HIST);
}

export function mtPushHistory(uid: string, kind: 'merchant' | 'deal', id: string): void {
  if (!uid || !id) return;
  const rest = mtLoadHistory(uid).filter((h) => !(h.kind === kind && h.id === id));
  kvSet(histKey(uid), [{ kind, id, at: Date.now() }, ...rest].slice(0, MAX_HIST));
}

export function mtClearHistory(uid: string): void {
  kvSet(histKey(uid), []);
}

/** 删除单条浏览记录（浏览记录页管理模式） */
export function mtRemoveHistory(uid: string, kind: 'merchant' | 'deal', id: string): void {
  kvSet(histKey(uid), mtLoadHistory(uid).filter((h) => !(h.kind === kind && h.id === id)));
}

// ---------------- 退款/售后 ----------------

export interface MtRefund {
  reason: string;
  note?: string;
  /** 申请时间 */
  appliedAt: number;
  /** pending=商家审核中 / approved=已退款（原路退回） / failed=退款失败（异常） */
  status: 'pending' | 'approved' | 'failed';
  /** 退款金额（当前为全额） */
  amount: number;
  /** 审核通过/到账时间 */
  doneAt?: number;
  /** 原路退回渠道（微信零钱/QQ钱包余额/亲属卡等） */
  channel?: string;
  /** 失败原因文案（status=failed 时展示） */
  failMsg?: string;
  /** 原路退回入账已完成（防止重复入账的幂等标记） */
  paidBack?: boolean;
}

export interface MtOrder {
  id: string;
  /** 数据隔离 uid（订单归属的美团账号） */
  uid: string;
  merchantId: string;
  merchantName: string;
  merchantEmoji: string;
  merchantImg?: string;
  items: MtOrderItem[];
  itemTotal: number;
  deliveryFee: number;
  discount: number;
  /** 使用的优惠券 id（核销标记） */
  couponId?: string;
  /** 优惠券抵扣金额（含在 discount 内） */
  couponAmount?: number;
  /** 实付金额（pendingPay 时为应付金额） */
  total: number;
  note?: string;
  /** 履约类型（团购单无收货地址，支付后到店直接消费完成） */
  kind?: MtOrderKind;
  address?: MtAddress;
  /** 到店消费完成时间（团购单支付成功即写入） */
  consumedAt?: number;
  /** 退款/售后信息（申请后挂载） */
  refund?: MtRefund;
  /** 支付方式：'wx' | 'qq'（pendingPay 时为空） */
  payIdp?: 'wx' | 'qq' | 'mt';
  /** 具体支付渠道展示名（零钱/银行卡/亲属卡） */
  payChannelLabel?: string;
  /** 亲属卡支付标记（支付方式展示「亲属卡」） */
  payFc?: boolean;
  /** 支付渠道 methodId（退款原路退回定位账户用：balance/银行卡id/fcin-亲属卡id） */
  payMethodId?: string;
  /** 亲属卡多卡分摊明细（退款时按原分摊回补各卡额度） */
  payFcParts?: { cardInId: string; amount: number }[];
  /** 找人代付（待支付时发起）：id = 代付请求（mt-proxy:<id>），name = 代付好友 */
  proxy?: { id: string; name: string };
  status: MtOrderStatus;
  createdAt: number;
  paidAt?: number;
  cancelReason?: string;
  /** 骑手（商家接单后分配） */
  riderName?: string;
  /** 预计送达时间戳（支付后生成） */
  etaAt?: number;
  /** 状态流水（新的在后） */
  statusLog: { status: MtOrderStatus; at: number }[];
  /** 用户评价（订单完成后提交；商详评价 tab 聚合展示） */
  review?: MtOrderReview;
  /** 用户自建订单元数据（首页「创建订单」入库；有值 = 自建单，类型/优惠券/规格选项组） */
  custom?: OrderCustomMeta;
}

/** 订单评价（星级 + 文字 + 标签 + 晒图 + 商家回复，演示图取内容匹配图链） */
export interface MtOrderReview {
  rating: number;
  content: string;
  tags: string[];
  imgs: string[];
  at: number;
  /** 商家回复（店铺管理页「评价」页签回复后写入；买家端店铺页同步展示） */
  reply?: { text: string; at: number };
}

const ordersKey = (uid: string) => `mt-orders:${uid}`;
const MAX_ORDERS = 200;

export function mtLoadOrders(uid: string): MtOrder[] {
  const list = kvGet<Partial<MtOrder>[]>(ordersKey(uid));
  if (!Array.isArray(list)) return [];
  const normalized = list
    .filter((o) => o && typeof o.id === 'string' && Array.isArray(o.items))
    .map((o) => ({
      ...o,
      id: o.id as string,
      uid,
      merchantId: typeof o.merchantId === 'string' ? o.merchantId : '',
      merchantName: typeof o.merchantName === 'string' ? o.merchantName : '商家',
      merchantEmoji: typeof o.merchantEmoji === 'string' ? o.merchantEmoji : '🍜',
      merchantImg: typeof o.merchantImg === 'string' ? o.merchantImg : undefined,
      items: (o.items as MtOrderItem[]).filter((i) => i && typeof i.name === 'string'),
      itemTotal: typeof o.itemTotal === 'number' ? o.itemTotal : 0,
      deliveryFee: typeof o.deliveryFee === 'number' ? o.deliveryFee : 0,
      discount: typeof o.discount === 'number' ? o.discount : 0,
      couponId: typeof o.couponId === 'string' ? o.couponId : undefined,
      couponAmount: typeof o.couponAmount === 'number' ? o.couponAmount : undefined,
      total: typeof o.total === 'number' ? o.total : 0,
      note: typeof o.note === 'string' ? o.note : undefined,
      kind: o.kind === 'tuangou' || o.kind === 'flight' || o.kind === 'train' ? o.kind : 'waimai',
      address: (o.address ?? undefined) as MtAddress | undefined,
      consumedAt: typeof o.consumedAt === 'number' ? o.consumedAt : undefined,
      payIdp: o.payIdp === 'wx' || o.payIdp === 'qq' || o.payIdp === 'mt' ? o.payIdp : undefined,
      payChannelLabel: typeof o.payChannelLabel === 'string' ? o.payChannelLabel : undefined,
      payFc: o.payFc === true,
      payMethodId: typeof o.payMethodId === 'string' ? o.payMethodId : undefined,
      payFcParts: Array.isArray(o.payFcParts)
        ? (o.payFcParts as { cardInId?: unknown; amount?: unknown }[])
            .filter((p) => p && typeof p.cardInId === 'string' && typeof p.amount === 'number')
            .map((p) => ({ cardInId: p.cardInId as string, amount: p.amount as number }))
        : undefined,
      proxy:
        o.proxy && typeof o.proxy === 'object' && typeof (o.proxy as { id?: unknown }).id === 'string'
          ? { id: (o.proxy as { id: string }).id, name: typeof (o.proxy as { name?: unknown }).name === 'string' ? (o.proxy as { name: string }).name : '好友' }
          : undefined,
      refund:
        o.refund && typeof o.refund === 'object' && typeof o.refund.appliedAt === 'number'
          ? {
              reason: typeof o.refund.reason === 'string' ? o.refund.reason : '用户申请退款',
              note: typeof o.refund.note === 'string' ? o.refund.note : undefined,
              appliedAt: o.refund.appliedAt,
              status: o.refund.status === 'approved' ? 'approved' : o.refund.status === 'failed' ? 'failed' : 'pending',
              amount: typeof o.refund.amount === 'number' ? o.refund.amount : 0,
              doneAt: typeof o.refund.doneAt === 'number' ? o.refund.doneAt : undefined,
              channel: typeof o.refund.channel === 'string' ? o.refund.channel : undefined,
              failMsg: typeof o.refund.failMsg === 'string' ? o.refund.failMsg : undefined,
              paidBack: o.refund.paidBack === true,
            }
          : undefined,
      status: (o.status ?? 'pendingPay') as MtOrderStatus,
      createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
      custom: normalizeOrderCustom(o.custom),
      paidAt: typeof o.paidAt === 'number' ? o.paidAt : undefined,
      cancelReason: typeof o.cancelReason === 'string' ? o.cancelReason : undefined,
      riderName: typeof o.riderName === 'string' ? o.riderName : undefined,
      etaAt: typeof o.etaAt === 'number' ? o.etaAt : undefined,
      statusLog: Array.isArray(o.statusLog) ? (o.statusLog as MtOrder['statusLog']).filter((s) => s && typeof s.at === 'number') : [],
      review:
        o.review && typeof o.review === 'object' && typeof o.review.at === 'number'
          ? {
              rating: typeof o.review.rating === 'number' ? Math.min(5, Math.max(1, Math.round(o.review.rating))) : 5,
              content: typeof o.review.content === 'string' ? o.review.content : '',
              tags: Array.isArray(o.review.tags) ? (o.review.tags as unknown[]).filter((x): x is string => typeof x === 'string') : [],
              imgs: Array.isArray(o.review.imgs) ? (o.review.imgs as unknown[]).filter((x): x is string => typeof x === 'string') : [],
              at: o.review.at,
              reply:
                o.review.reply && typeof o.review.reply === 'object' && typeof (o.review.reply as { text?: unknown }).text === 'string'
                  ? { text: (o.review.reply as { text: string }).text, at: typeof (o.review.reply as { at?: unknown }).at === 'number' ? (o.review.reply as { at: number }).at : Date.now() }
                  : undefined,
            }
          : undefined,
    })) as MtOrder[];
  // 旧数据迁移：「待使用+券码」已废弃 → 团购单待使用态直接归档为已完成（消费时间取支付时间）
  return normalized.map((o) => mtBackfillOrderImgs(
    (o.status as string) === 'pendingUse'
      ? { ...o, status: 'completed' as const, consumedAt: o.consumedAt ?? o.paidAt ?? o.createdAt, statusLog: [...o.statusLog, { status: 'completed' as const, at: o.consumedAt ?? o.paidAt ?? Date.now() }] }
      : o
  ));
}

/** 订单图片补全（需求「订单所有的图片补充完整」）：历史订单缺图时按 商品图→团购图→商家图 逐级回填。
 *  第十四轮修复：商家查找改 mtMerchantOf（AI 自主入驻的 aimt-* 店也在注册表里）——
 *  原先只查种子表，AI 自创店/自创菜的单永远回填不到图（真图生成完成后订单里还是 emoji） */
function mtBackfillOrderImgs(o: MtOrder): MtOrder {
  const merchant = mtMerchantOf(o.merchantId);
  const dishes = merchant ? mtDishesOf(merchant) : [];
  /** AI 自主入驻的店（aimt-*）或 AI 自主补的菜（aidish-*）：菜品图是真图管线自动生成的
   *  （第十四轮），始终跟随最新覆盖——下单瞬间真图还没生成完、item.img 是当时的空/卡通
   *  快照，不能因「有图」就跳过升级（种子店种子菜仍保持快照优先，不动既有语义） */
  const aiImgFollow = merchant?.id.startsWith('aimt-') === true || dishes.some((d) => d.id.startsWith('aidish-'));
  let itemsChanged = false;
  const items = o.items.map((it) => {
    const dish = dishes.find((d) => d.id === it.dishId);
    const isAiDish = dish?.id.startsWith('aidish-') ?? false;
    if (!aiImgFollow && !isAiDish && it.img) return it;
    const deal = dish ? undefined : mtDealOf(it.dishId);
    const img = dish?.img ?? it.img ?? deal?.img ?? merchant?.cover;
    if (!img || img === it.img) return it;
    itemsChanged = true;
    return { ...it, img };
  });
  const merchantImg = o.merchantImg ?? merchant?.cover;
  if (!itemsChanged && merchantImg === o.merchantImg) return o;
  return { ...o, items, merchantImg };
}

export function mtSaveOrders(uid: string, list: MtOrder[]): void {
  kvSet(ordersKey(uid), list.slice(0, MAX_ORDERS));
}

export function mtGetOrder(uid: string, id: string): MtOrder | undefined {
  return mtLoadOrders(uid).find((o) => o.id === id);
}

// ---------------- 订单状态机（时间戳确定性推进） ----------------

/**
 * 支付后全程按真实外卖节奏推进（重启按时间戳补推进）：
 * 商家接单/骑手取餐两档按配送总时长等比缩放（接单 ≤2 分钟、取餐在总时长 50% 处）；
 * 预计送达时间(etaAt=支付后5~30分钟)系统确认送达；
 * etaAt 缺失的旧订单按 45 分钟兜底；团购单支付后即完成。
 * 时长与支付页「现在支付，预计XX:XX送达」承诺、详情页 ETA 大字完全一致（同一订单号确定性推导）。
 */
/** 商家接单上限（配送总时长更长时也最多 2 分钟接单） */
const ACCEPT_MS = 2 * 60_000;
/** etaAt 缺失的旧订单兜底送达时长 */
const DELIVERED_MS = 45 * 60_000;
/** 待支付超时（自动取消，对齐真机 15 分钟） */
export const PAY_TIMEOUT_MS = 15 * 60_000;

/**
 * 按订单号（种子）在当前送达速度区间内确定性取分钟：
 * 支付页 ETA、状态机送达时刻、详情页承诺保持一致；
 * 第四十二轮起跟随美团独立「送达速度」设置（快 5-15 / 正常 15-30 / 慢 30-60 / 自定义区间，
 * 美团「我的 › 送达速度」毛玻璃弹窗改后新单立即生效；与淘宝小时级设置互不影响）。
 */
export const mtDeliveryMinutesOf = (orderId: string): number => dsMinutesFor(orderId, 'meituan');

/** 配送总时长（毫秒） */
const deliveryMsOf = (o: { id: string }): number => mtDeliveryMinutesOf(o.id) * 60_000;
/** 商家接单档（总时长 ×35%，上限 2 分钟）：5 分钟单约 1 分 45 秒接单，30 分钟单 2 分钟接单 */
const acceptMsOf = (o: { id: string }): number => Math.min(ACCEPT_MS, Math.round(deliveryMsOf(o) * 0.35));
/** 骑手取餐档（总时长 ×50%）：接单后备餐到一半时长即取餐出发 */
const pickupMsOf = (o: { id: string }): number => Math.round(deliveryMsOf(o) * 0.5);

const RIDER_POOL = ['宋世超', '刘志伟', '王建平', '李海峰', '赵国栋', '陈志强'];

export interface MtOrderTransition {
  order: MtOrder;
  from: MtOrderStatus;
  to: MtOrderStatus;
}

/** 推进某账号全部订单的状态；有变化则持久化并返回变更明细（供灵动岛通知） */
export function mtAdvanceOrders(uid: string): MtOrderTransition[] {
  const orders = mtLoadOrders(uid);
  if (orders.length === 0) return [];
  const now = Date.now();
  const transitions: MtOrderTransition[] = [];
  let changed = false;
  const next = orders.map((o) => {
    let cur = o;
    const step = (to: MtOrderStatus, patch?: Partial<MtOrder>): void => {
      const from = cur.status;
      cur = { ...cur, ...patch, status: to, statusLog: [...cur.statusLog, { status: to, at: now }] };
      transitions.push({ order: cur, from, to });
      changed = true;
    };
    // 多步推进循环（长间隔后一次 tick 可能跨多档）
    for (let guard = 0; guard < 4; guard += 1) {
      if (cur.status === 'pendingPay') {
        if (now - cur.createdAt >= PAY_TIMEOUT_MS) step('canceled', { cancelReason: '超时未支付，订单自动取消' });
        break;
      }
      if (cur.status === 'pendingAccept') {
        if (cur.paidAt && now - cur.paidAt >= acceptMsOf(cur)) {
          // 出行单（机票/火车票）：无骑手概念，直接进入「出行中」
          step('accepted', cur.kind === 'flight' || cur.kind === 'train' ? {} : { riderName: RIDER_POOL[Math.floor(now / 60000) % RIDER_POOL.length] });
          continue;
        }
        break;
      }
      if (cur.status === 'accepted') {
        // 出行单：值机/检票后按预计到达时间完成行程（跳过配送档）
        if (cur.kind === 'flight' || cur.kind === 'train') {
          const doneAt = cur.etaAt ?? (cur.paidAt ? cur.paidAt + DELIVERED_MS : 0);
          if (doneAt && now >= doneAt) {
            step('completed');
            continue;
          }
          break;
        }
        if (cur.paidAt && now - cur.paidAt >= pickupMsOf(cur)) {
          step('delivering');
          continue;
        }
        break;
      }
      if (cur.status === 'delivering') {
        // 按预计送达时间（etaAt）确认送达——与详情页大字/骑手气泡剩余分钟同源
        const doneAt = cur.etaAt ?? (cur.paidAt ? cur.paidAt + DELIVERED_MS : 0);
        if (doneAt && now >= doneAt) {
          step('completed');
          continue;
        }
        break;
      }
      // 团购单：待使用 → 无自动推进，用户到店核销
      break;
    }
    return cur;
  });
  // 退款售后：审核超时自动出结果（原路退回；按订单号确定性地约 1/4 概率退款失败，对齐真机「退款失败」态）
  let refundChanged = false;
  const credited: MtOrder[] = [];
  const withRefunds = next.map((o) => {
    if (!o.refund || o.refund.status !== 'pending') return o;
    if (now - o.refund.appliedAt < REFUND_AUTO_MS) return o;
    refundChanged = true;
    // 确定性伪随机：同一订单结果稳定，重进页面不变卦
    const h = [...o.id].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const failed = h % 4 === 1;
    if (failed) {
      return {
        ...o,
        refund: { ...o.refund, status: 'failed' as const, doneAt: now, failMsg: '退款过程中出现异常，退款失败' },
      };
    }
    const approved: MtOrder = {
      ...o,
      // 未完成的配送单退款后关闭
      status: o.status === 'completed' ? o.status : 'canceled',
      cancelReason: o.status === 'completed' ? o.cancelReason : '退款成功，订单已关闭',
      statusLog:
        o.status === 'completed'
          ? o.statusLog
          : [...o.statusLog, { status: 'canceled' as const, at: now }],
      refund: { ...o.refund, status: 'approved' as const, doneAt: now, channel: mtRefundChannelOf(o), paidBack: true },
    };
    credited.push(approved);
    return approved;
  });
  if (changed || refundChanged) mtSaveOrders(uid, withRefunds);
  // 退款成功 → 原路退回入账（微信零钱/银行卡回补、亲属卡恢复本月额度、QQ钱包余额/银行卡入账）
  for (const o of credited) mtFireRefundCredit(o);
  return transitions;
}

// ---------------- 退款/售后操作 ----------------

/** 审核时长（演示节奏：20 秒后自动通过，原路退回） */
const REFUND_AUTO_MS = 20_000;

/** 是否可申请退款（已支付且未退款未取消） */
export function mtCanRefund(o: MtOrder): boolean {
  return !o.refund && o.status !== 'pendingPay' && o.status !== 'canceled';
}

/**
 * 取消订单并自动退款（对齐真机：取消订单 → 退款/售后列表出现「退款成功」记录，
 * 售后详情退款原因 =「订单取消时，自动退款」）。
 */
export function mtCancelWithRefund(uid: string, orderId: string, cancelReason: string): boolean {
  const orders = mtLoadOrders(uid);
  const target = orders.find((o) => o.id === orderId);
  if (!target || target.status === 'canceled' || target.refund) return false;
  const now = Date.now();
  let refunded: MtOrder | null = null;
  const next = orders.map((o) =>
    o.id === orderId
      ? (refunded = {
            ...o,
            status: 'canceled' as const,
            cancelReason,
            statusLog: [...o.statusLog, { status: 'canceled' as const, at: now }],
            refund: {
              reason: '订单取消时，自动退款',
              appliedAt: now,
              status: 'approved' as const,
              amount: o.total,
              doneAt: now,
              channel: mtRefundChannelOf(o),
              paidBack: true,
            },
          })
      : o
  );
  mtSaveOrders(uid, next);
  window.dispatchEvent(new CustomEvent('mt-orders-changed'));
  // B4：订单取消 → 挂着的 pending 代付请求同步失效（动态 import 防与 mt-proxy-pay 循环依赖）
  void import('./mt-proxy-pay')
    .then((m) => m.mtSyncProxiesForUid(uid))
    .catch(() => undefined);
  if (refunded) mtFireRefundCredit(refunded);
  return true;
}

/** 提交退款申请（全额、原路退回） */
export function mtApplyRefund(uid: string, orderId: string, reason: string, note?: string): boolean {
  const orders = mtLoadOrders(uid);
  const target = orders.find((o) => o.id === orderId);
  if (!target || !mtCanRefund(target)) return false;
  const now = Date.now();
  const next = orders.map((o) =>
    o.id === orderId
      ? {
          ...o,
          refund: {
            reason: reason.trim() || '用户申请退款',
            note: note?.trim() || undefined,
            appliedAt: now,
            status: 'pending' as const,
            amount: o.total,
            channel: o.payChannelLabel ?? (o.payIdp === 'qq' ? 'QQ钱包' : '微信支付'),
          },
        }
      : o
  );
  mtSaveOrders(uid, next);
  window.dispatchEvent(new CustomEvent('mt-orders-changed'));
  return true;
}

/** 原路退回渠道短名（订单详情展示） */
function mtRefundChannelOf(o: MtOrder): string {
  if (o.payChannelLabel) return o.payChannelLabel;
  return o.payIdp === 'qq' ? 'QQ钱包余额' : '微信零钱';
}

/** 退款成功后原路退回入账（异步动态 import 钱包模块，失败静默；幂等由 paidBack 标记保证） */
export function mtFireRefundCredit(o: MtOrder): void {
  void import('./meituan-pay')
    .then((m) => m.mtRefundToOrigin(o))
    .catch(() => undefined);
}

/** 商家接单后写一条骑手取餐前的等待文案（订单详情/通知用；机票/火车票有专属文案） */
export function mtStatusBody(o: MtOrder): string {
  switch (o.status) {
    case 'pendingPay':
      return '订单已提交，请尽快完成支付';
    case 'pendingAccept':
      if (o.kind === 'flight') return `出票成功，已支付¥${o.total.toFixed(2)}，祝您旅途愉快`;
      if (o.kind === 'train') return `购票成功，已支付¥${o.total.toFixed(2)}，请提前到站候车`;
      return `已支付¥${o.total.toFixed(2)}，等待商家接单`;
    case 'accepted':
      if (o.kind === 'flight') return '值机已开始，航班准点，祝您一路平安';
      if (o.kind === 'train') return '检票口已开放，请凭身份证检票乘车';
      return '商家已接单，正在为您准备餐品';
    case 'delivering':
      return `骑手${o.riderName ?? ''}已取餐，正在火速配送`;
    case 'completed':
      if (o.kind === 'flight' || o.kind === 'train') return '行程已结束，感谢乘坐，欢迎评价';
      return o.kind === 'tuangou' ? `团购已完成¥${o.total.toFixed(2)}，感谢光临，欢迎评价` : '订单已送达，感谢您的信任，欢迎评价';
    case 'canceled':
      return o.cancelReason ?? '订单已取消';
  }
}

// ---------------- 催单（催一下） ----------------

export interface MtUrgeResult {
  ok: boolean;
  /** 提示文案（催单结果：提前了多少） */
  msg: string;
  /** 催单后的预计送达时刻（成功时返回） */
  etaAt?: number;
}

/** 时:分（24h，补零） */
function fmtHM(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 催一下：把预计送达时间（etaAt）提前——
 * - 剩余 > 5 分钟：直接提前 5 分钟；
 * - 剩余 ≤ 5 分钟（时间少）：随机提前 10 秒 ~ 1 分钟；
 * - 提前后不早于「现在 + 8 秒」（再催就真的马上送到了）。
 * 仅对进行中的外卖单生效（pendingAccept/accepted/delivering 且已有 etaAt）。
 */
export function mtUrgeOrder(uid: string, orderId: string): MtUrgeResult {
  const orders = mtLoadOrders(uid);
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx < 0) return { ok: false, msg: '订单不存在' };
  const o = orders[idx];
  if (o.status !== 'pendingAccept' && o.status !== 'accepted' && o.status !== 'delivering') {
    return { ok: false, msg: '当前状态无法催单' };
  }
  if (!o.etaAt) return { ok: false, msg: '当前状态无法催单' };
  const now = Date.now();
  const left = o.etaAt - now;
  if (left <= 0) return { ok: false, msg: '骑手马上就到，无需催单' };
  // 剩余多 → 减 5 分钟；剩余少（≤5 分钟）→ 减 10 秒 ~ 1 分钟
  const cutMs = left > 5 * 60_000 ? 5 * 60_000 : (10 + Math.floor(Math.random() * 51)) * 1000;
  const etaAt = Math.max(now + 8_000, o.etaAt - cutMs);
  const savedSec = Math.round((o.etaAt - etaAt) / 1000);
  orders[idx] = { ...o, etaAt };
  mtSaveOrders(uid, orders);
  window.dispatchEvent(new CustomEvent('mt-orders-changed'));
  const msg =
    savedSec >= 60
      ? `已催单，骑手正在加急，预计提前${Math.floor(savedSec / 60)}分钟送达`
      : `已催单，骑手正在加急，预计提前${savedSec}秒送达（预计${fmtHM(etaAt)}送达）`;
  return { ok: true, msg, etaAt };
}

// ---------------- 下单金额计算 ----------------

export interface MtDeals {
  /** 命中的满减（含新客立减）金额合计 */
  discount: number;
  /** 命中的满减标签（价格明细展示） */
  labels: string[];
}

/** 解析「满30减8」类满减标签 → [{min, off}] */
export function mtParseDeals(deals: string[]): { min: number; off: number; label: string }[] {
  const out: { min: number; off: number; label: string }[] = [];
  for (const d of deals) {
    const m = /^满(\d+(?:\.\d+)?)减(\d+(?:\.\d+)?)$/.exec(d.replace(/\s/g, ''));
    if (m) out.push({ min: Number(m[1]), off: Number(m[2]), label: d });
  }
  return out;
}

/** 优惠计算：满减取最优档 + 新客立减（该账号无任何已完成/已支付订单时） */
export function mtCalcDeals(uid: string, merchant: MtMerchant, itemTotal: number, deliveryFee: number): MtDeals {
  const labels: string[] = [];
  let discount = 0;
  const rules = mtParseDeals(merchant.deals)
    .filter((r) => itemTotal >= r.min)
    .sort((a, b) => b.off - a.off);
  if (rules.length > 0) {
    discount += rules[0].off;
    labels.push(rules[0].label);
  }
  const paid = mtLoadOrders(uid).some((o) => o.status !== 'pendingPay' && o.status !== 'canceled');
  if (!paid && itemTotal > 0) {
    discount += 3;
    labels.push('新客立减3');
  }
  // 满额免配送费（对齐真机常现规则）
  if (itemTotal >= 45 && deliveryFee > 0) {
    labels.push('满45免配送费');
  }
  return { discount: Math.round(discount * 100) / 100, labels };
}

/** 结算合计：商品（含规格小料加价）- 满减/新客/菜品券 + 配送费（满45免） */
export function mtCheckoutCalc(uid: string, merchant: MtMerchant, cart: MtCart): { itemTotal: number; deliveryFee: number; discount: number; total: number; labels: string[]; count: number } {
  const all = mtDishesOf(merchant);
  const itemTotal = cart.items.reduce((s, i) => {
    const d = all.find((x) => x.id === i.dishId);
    if (!d) return s;
    const unit = i.unitPrice ?? d.price;
    return s + unit * i.qty;
  }, 0);
  const count = cart.items.reduce((s, i) => s + i.qty, 0);
  const baseFee = merchant.deliveryFee;
  const deals = mtCalcDeals(uid, merchant, itemTotal, baseFee);
  const labels = [...deals.labels];
  // 菜品优惠券：购物车含该菜品且商品总额达门槛时自动抵扣（每菜每单限一次，min=0 无门槛）
  const seenDish = new Set<string>();
  let dishOff = 0;
  for (const it of cart.items) {
    const d = all.find((x) => x.id === it.dishId);
    const c = d?.coupon;
    if (!d || !c || seenDish.has(d.id)) continue;
    seenDish.add(d.id);
    if (itemTotal >= c.min && c.amount > 0) {
      dishOff += c.amount;
      labels.push(`菜品券·${c.name || `${d.name}专享券`}`);
    }
  }
  const discount = Math.round((deals.discount + dishOff) * 100) / 100;
  const freeShip = itemTotal >= 45;
  const deliveryFee = freeShip ? 0 : baseFee;
  const total = Math.max(0.01, Math.round((itemTotal - discount + deliveryFee) * 100) / 100);
  return { itemTotal, deliveryFee, discount, total, labels, count };
}

/** 从订单复制购物车（再来一单，保留规格小料） */
export function mtReorder(uid: string, o: MtOrder): boolean {
  const merchant = MT_MERCHANTS.find((m) => m.id === o.merchantId);
  if (!merchant) return false;
  const all = mtDishesOf(merchant);
  mtSaveCart(
    uid,
    {
      merchantId: merchant.id,
      items: o.items
        .filter((i) => all.some((d) => d.id === i.dishId))
        .map((i) => ({ dishId: i.dishId, qty: i.qty, spec: i.spec, unitPrice: i.price })),
    }
  );
  return true;
}

// ---------------- 优惠券（我的券，按账号隔离） ----------------

export interface MtCoupon {
  id: string;
  name: string;
  type: MtCouponType;
  /** 神券角标 */
  god: boolean;
  /** 面额 */
  amount: number;
  /** 门槛（满 min 可用） */
  min: number;
  /** 到期时间戳 */
  expireAt: number;
  /** 获得时间（最近获得排序） */
  obtainedAt: number;
  /** 使用时间（已使用置灰） */
  usedAt?: number;
}

const couponKey = (uid: string) => `mt-coupons:${uid}`;

export function mtLoadCoupons(uid: string): MtCoupon[] {
  const list = kvGet<Partial<MtCoupon>[]>(couponKey(uid));
  if (Array.isArray(list) && list.length > 0) {
    return list
      .filter((c): c is MtCoupon => Boolean(c) && typeof (c as MtCoupon).id === 'string' && typeof (c as MtCoupon).amount === 'number')
      .map((c) => ({ ...c, type: (c.type ?? 'waimai') as MtCouponType, usedAt: typeof c.usedAt === 'number' ? c.usedAt : undefined }));
  }
  // 首次播种（对齐真机截图1）
  const now = Date.now();
  const seeded: MtCoupon[] = MT_COUPON_SEED.map((s, i) => ({
    id: `cp${now.toString(36)}${i}`,
    name: s.name,
    type: s.type,
    god: s.god,
    amount: s.amount,
    min: s.min,
    expireAt: now + s.ttl,
    obtainedAt: now - (MT_COUPON_SEED.length - i) * 60_000,
  }));
  kvSet(couponKey(uid), seeded);
  return seeded;
}

export function mtSaveCoupons(uid: string, list: MtCoupon[]): void {
  kvSet(couponKey(uid), list.slice(0, 60));
}

/** 领神券/一键领取：发放 MT_GOD_CLAIMS 中未拥有的同名同面额券，返回新领张数 */
export function mtClaimGodCoupons(uid: string): number {
  const cur = mtLoadCoupons(uid);
  const now = Date.now();
  let added = 0;
  const next = [...cur];
  for (const s of MT_GOD_CLAIMS) {
    const exists = cur.some((c) => c.name === s.name && c.amount === s.amount && !c.usedAt);
    if (exists) continue;
    next.unshift({
      id: `cp${now.toString(36)}g${added}`,
      name: s.name,
      type: s.type,
      god: s.god,
      amount: s.amount,
      min: s.min,
      expireAt: now + s.ttl,
      obtainedAt: now,
    });
    added += 1;
  }
  if (added > 0) mtSaveCoupons(uid, next);
  return added;
}

/** 可用于下单的券（类型匹配 + 未使用 + 未过期 + 达到门槛），面额大在前 */
export function mtListUsableCoupons(uid: string, type: 'waimai' | 'daodian', itemTotal: number): { usable: MtCoupon[]; others: MtCoupon[] } {
  const now = Date.now();
  const all = mtLoadCoupons(uid).filter((c) => !c.usedAt && c.expireAt > now);
  const ok = all.filter((c) => c.type === type && itemTotal >= c.min);
  const notOk = all.filter((c) => !(c.type === type && itemTotal >= c.min));
  return { usable: ok.sort((a, b) => b.amount - a.amount), others: notOk };
}

/** 核销优惠券（下单时调用） */
export function mtUseCoupon(uid: string, couponId: string): void {
  const list = mtLoadCoupons(uid);
  mtSaveCoupons(
    uid,
    list.map((c) => (c.id === couponId ? { ...c, usedAt: Date.now() } : c))
  );
}

/** 券类型角标文案 */
export const mtCouponTypeLabel = (t: MtCouponType): string => MT_COUPON_TYPE_LABEL[t] ?? '外卖';

/** 种子类型再导出（UI 层构造用） */
export type { MtCouponSeed };

// ---------------- 商家入驻（我的店铺，按账号隔离） ----------------

/** 店铺券类型从 data 层再导出（入驻表单/商家中心用） */
export type { MtShopCouponDef } from './meituan-data';

const shopsKey = (uid: string) => `mt-shops:${uid}`;

/** 读当前账号的自有店铺（无则空数组；容错过滤残缺数据） */
export function mtLoadShops(uid: string): MtMerchant[] {
  const list = kvGet<Partial<MtMerchant>[]>(shopsKey(uid));
  if (!Array.isArray(list)) return [];
  return list.filter(
    (m): m is MtMerchant =>
      Boolean(m) &&
      typeof (m as MtMerchant).id === 'string' &&
      typeof (m as MtMerchant).name === 'string' &&
      Array.isArray((m as MtMerchant).sections)
  );
}

/** 写当前账号的自有店铺（全量覆盖） */
export function mtSaveShops(uid: string, list: MtMerchant[]): void {
  kvSet(shopsKey(uid), list);
}

/** 按 id 查当前账号的自有店铺 */
export function mtGetShop(uid: string, id: string): MtMerchant | undefined {
  return mtLoadShops(uid).find((s) => s.id === id);
}

// ---------------- 自建商品（第三十六轮：创建订单=创建商品，按账号隔离） ----------------
// 「创建订单」保存的是商品（mtc-shop-* 自建商家 + 单菜品），持久化在此、运行时注册进 meituan-data
// 的自建商品注册表 → 首页「我的商品」区展示，点击走商家页/购物车/结算原生链路真实下单。

const customShopsKey = (uid: string) => `mt-custom-shops:${uid}`;

/** 读当前账号的自建商品（无则空数组；容错过滤残缺数据） */
export function mtLoadCustomShops(uid: string): MtMerchant[] {
  const list = kvGet<Partial<MtMerchant>[]>(customShopsKey(uid));
  if (!Array.isArray(list)) return [];
  return list.filter(
    (m): m is MtMerchant =>
      Boolean(m) &&
      typeof (m as MtMerchant).id === 'string' &&
      (m as MtMerchant).id.startsWith('mtc-shop-') &&
      typeof (m as MtMerchant).name === 'string' &&
      Array.isArray((m as MtMerchant).sections)
  );
}

/** 写当前账号的自建商品（全量覆盖） */
export function mtSaveCustomShops(uid: string, list: MtMerchant[]): void {
  kvSet(customShopsKey(uid), list);
}

/**
 * 领取店铺优惠券：写入「红包卡券」（外卖类型，结算选择弹窗自动可用）。
 * 同名同面额未使用的券不重复发；返回是否新领到。
 */
export function mtClaimShopCoupon(uid: string, coupon: MtShopCouponDef, shopName: string): boolean {
  const cur = mtLoadCoupons(uid);
  const name = `【${shopName}】${coupon.name}`;
  if (cur.some((c) => c.name === name && c.amount === coupon.amount && !c.usedAt)) return false;
  const now = Date.now();
  const next: MtCoupon[] = [
    {
      id: `cp${now.toString(36)}s${Math.random().toString(36).slice(2, 6)}`,
      name,
      type: 'waimai',
      god: false,
      amount: coupon.amount,
      min: coupon.min,
      expireAt: now + 7 * 86_400_000,
      obtainedAt: now,
    },
    ...cur,
  ];
  mtSaveCoupons(uid, next);
  return true;
}

// ---------------- 美团钱包（余额/银行卡/账单/支付密码，按账号隔离） ----------------

/** 美团余额（仅可提现语义对齐真机：余额用于展示，资金进出全部经过银行卡） */
export interface MtWallet {
  balance: number;
}

const walletKey = (uid: string) => `mt-wallet:${uid}`;

export function mtLoadWallet(uid: string): MtWallet {
  const w = kvGet<Partial<MtWallet>>(walletKey(uid));
  if (w && typeof w === 'object' && typeof w.balance === 'number' && Number.isFinite(w.balance) && w.balance >= 0) {
    return { balance: Math.round(w.balance * 100) / 100 };
  }
  return { balance: 0 };
}

export function mtSaveWallet(uid: string, w: MtWallet): void {
  kvSet(walletKey(uid), { balance: Math.max(0, Math.round(w.balance * 100) / 100) });
}

/** 美团银行卡（钱包「提现/充值都从银行卡」的唯一资金通道；演示卡带余额） */
export interface MtBankCard {
  id: string;
  /** 银行名（如 中国工商银行） */
  bank: string;
  /** 卡号后四位 */
  tail: string;
  /** 卡内可用余额（演示） */
  balance: number;
  /** 添加时间（列表排序用） */
  addedAt: number;
}

const cardsKey = (uid: string) => `mt-bank-cards:${uid}`;

export function mtLoadBankCards(uid: string): MtBankCard[] {
  const list = kvGet<Partial<MtBankCard>[]>(cardsKey(uid));
  if (!Array.isArray(list)) return [];
  return list
    .filter((c): c is MtBankCard => Boolean(c) && typeof (c as MtBankCard).id === 'string' && typeof (c as MtBankCard).tail === 'string')
    .map((c) => ({
      id: c.id,
      bank: typeof c.bank === 'string' && c.bank ? c.bank : '银行卡',
      tail: c.tail,
      balance: typeof c.balance === 'number' && Number.isFinite(c.balance) ? Math.max(0, Math.round(c.balance * 100) / 100) : 0,
      addedAt: typeof c.addedAt === 'number' ? c.addedAt : 0,
    }))
    .sort((a, b) => b.addedAt - a.addedAt);
}

export function mtSaveBankCards(uid: string, cards: MtBankCard[]): void {
  kvSet(cardsKey(uid), cards.slice(0, 20));
}

/** 添加银行卡（卡号取后四位；同一尾号 + 同一银行不重复添加） */
export function mtAddBankCard(uid: string, bank: string, tail: string, balance: number): MtBankCard | { error: string } {
  const t = tail.replace(/\D/g, '').slice(-4);
  if (t.length !== 4) return { error: '卡号至少需要 4 位数字' };
  const name = bank.trim() || '银行卡';
  const exists = mtLoadBankCards(uid).find((c) => c.tail === t && c.bank === name);
  if (exists) return { error: '该银行卡已添加' };
  const card: MtBankCard = {
    id: `card${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    bank: name,
    tail: t,
    balance: Math.max(0, Math.round(balance * 100) / 100),
    addedAt: Date.now(),
  };
  mtSaveBankCards(uid, [card, ...mtLoadBankCards(uid)]);
  return card;
}

export function mtRemoveBankCard(uid: string, id: string): void {
  mtSaveBankCards(
    uid,
    mtLoadBankCards(uid).filter((c) => c.id !== id)
  );
}

/** 钱包账单流水（充值/提现/消费/退款/借款/还款，最新在前） */
export interface MtWalletBill {
  id: string;
  kind: 'recharge' | 'withdraw' | 'pay' | 'refund' | 'loan' | 'repay';
  /** 标题（如 充值-中国工商银行 尾号1234） */
  title: string;
  /** 正负金额：充值/退款入账为正，提现/消费为负 */
  amount: number;
  at: number;
  /** 关联卡摘要（如 中国工商银行 尾号1234） */
  card?: string;
  /** 账单状态文案（成功/处理中等，缺省=成功） */
  status?: string;
}

const billsKey = (uid: string) => `mt-wallet-bills:${uid}`;

export function mtLoadWalletBills(uid: string): MtWalletBill[] {
  const list = kvGet<Partial<MtWalletBill>[]>(billsKey(uid));
  if (!Array.isArray(list)) return [];
  return list
    .filter((b): b is MtWalletBill => Boolean(b) && typeof (b as MtWalletBill).id === 'string' && typeof (b as MtWalletBill).amount === 'number')
    .map((b): MtWalletBill => ({
      id: b.id,
      kind: b.kind === 'withdraw' || b.kind === 'pay' || b.kind === 'refund' || b.kind === 'loan' || b.kind === 'repay' ? b.kind : 'recharge',
      title: typeof b.title === 'string' ? b.title : '',
      amount: Math.round(b.amount * 100) / 100,
      at: typeof b.at === 'number' ? b.at : Date.now(),
      card: typeof b.card === 'string' ? b.card : undefined,
      status: typeof b.status === 'string' ? b.status : undefined,
    }))
    .sort((a, b) => b.at - a.at)
    .slice(0, 200);
}

export function mtPushWalletBill(uid: string, bill: Omit<MtWalletBill, 'id'>): void {
  const row: MtWalletBill = { id: `wb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ...bill };
  kvSet(billsKey(uid), [row, ...mtLoadWalletBills(uid)].slice(0, 200));
}

/**
 * 充值：从银行卡 → 美团余额（需求「充值从银行卡」）。
 * 卡余额不足 → 失败；成功返回流水（卡扣款 + 余额入账 + 账单一致完成）。
 */
export function mtWalletRecharge(uid: string, cardId: string, amount: number): { ok: boolean; error?: string } {
  const amt = Math.round(amount * 100) / 100;
  if (!(amt > 0)) return { ok: false, error: '请输入正确的充值金额' };
  const cards = mtLoadBankCards(uid);
  const card = cards.find((c) => c.id === cardId);
  if (!card) return { ok: false, error: '请选择银行卡' };
  if (card.balance < amt) return { ok: false, error: `卡内余额不足（可用 ¥${card.balance.toFixed(2)}）` };
  const label = `${card.bank} 尾号${card.tail}`;
  mtSaveBankCards(
    uid,
    cards.map((c) => (c.id === cardId ? { ...c, balance: Math.round((c.balance - amt) * 100) / 100 } : c))
  );
  mtSaveWallet(uid, { balance: Math.round((mtLoadWallet(uid).balance + amt) * 100) / 100 });
  mtPushWalletBill(uid, { kind: 'recharge', title: '充值', amount: amt, at: Date.now(), card: label });
  return { ok: true };
}

/**
 * 提现：美团余额 → 银行卡（需求「提现从银行卡」，免费实时到账演示口径）。
 * 余额不足 → 失败；成功返回流水（余额扣款 + 卡入账 + 账单一致完成）。
 */
export function mtWalletWithdraw(uid: string, cardId: string, amount: number): { ok: boolean; error?: string } {
  const amt = Math.round(amount * 100) / 100;
  if (!(amt > 0)) return { ok: false, error: '请输入正确的提现金额' };
  const wallet = mtLoadWallet(uid);
  if (wallet.balance < amt) return { ok: false, error: `可用余额不足（可用 ¥${wallet.balance.toFixed(2)}）` };
  const cards = mtLoadBankCards(uid);
  const card = cards.find((c) => c.id === cardId);
  if (!card) return { ok: false, error: '请选择提现到的银行卡' };
  const label = `${card.bank} 尾号${card.tail}`;
  mtSaveWallet(uid, { balance: Math.round((wallet.balance - amt) * 100) / 100 });
  mtSaveBankCards(
    uid,
    cards.map((c) => (c.id === cardId ? { ...c, balance: Math.round((c.balance + amt) * 100) / 100 } : c))
  );
  mtPushWalletBill(uid, { kind: 'withdraw', title: '提现', amount: -amt, at: Date.now(), card: label });
  return { ok: true };
}

/** 美团支付密码（钱包右上角设置：开启/关闭/修改；提现/充值前验证） */
export interface MtPayPwd {
  enabled: boolean;
  /** 6 位数字密码（仅本机存储，不外传） */
  pwd: string | null;
}

const payPwdKey = (uid: string) => `mt-pay-pwd:${uid}`;

export function mtLoadPayPwd(uid: string): MtPayPwd {
  const p = kvGet<Partial<MtPayPwd>>(payPwdKey(uid));
  if (p && typeof p === 'object') {
    const pwd = typeof p.pwd === 'string' && /^\d{6}$/.test(p.pwd) ? p.pwd : null;
    return { enabled: p.enabled === true && pwd !== null, pwd };
  }
  return { enabled: false, pwd: null };
}

export function mtSavePayPwd(uid: string, d: MtPayPwd): void {
  kvSet(payPwdKey(uid), d);
}

// 支付密码暴力试错保护（5 次失败锁定 30s；localStorage 跨组件共享，按账号隔离）
export const MT_PAY_PWD_MAX_FAIL = 5;
export const MT_PAY_PWD_LOCK_MS = 30 * 1000;

export interface MtPayPwdLock {
  fails: number;
  lockedUntil: number;
}

const payPwdLockKey = (uid: string) => `mt-pay-pwd-lock:${uid}`;

export function mtLoadPayPwdLock(uid: string): MtPayPwdLock {
  try {
    const raw = window.localStorage.getItem(payPwdLockKey(uid));
    if (!raw) return { fails: 0, lockedUntil: 0 };
    const p = JSON.parse(raw) as Partial<MtPayPwdLock>;
    return {
      fails: typeof p.fails === 'number' && p.fails >= 0 ? p.fails : 0,
      lockedUntil: typeof p.lockedUntil === 'number' && p.lockedUntil > 0 ? p.lockedUntil : 0,
    };
  } catch {
    return { fails: 0, lockedUntil: 0 };
  }
}

export function mtSavePayPwdLock(uid: string, d: MtPayPwdLock): void {
  try {
    window.localStorage.setItem(payPwdLockKey(uid), JSON.stringify(d));
  } catch {
    /* 忽略 */
  }
}

/** 清零失败次数与锁定（验证成功 / 修改密码成功 / 关闭支付密码时调用） */
export function mtClearPayPwdLock(uid: string): void {
  mtSavePayPwdLock(uid, { fails: 0, lockedUntil: 0 });
}

/** 记录一次失败：累加 fails，达到 5 次设 lockedUntil；返回更新后的状态 */
export function mtRecordPayPwdFail(uid: string): MtPayPwdLock {
  const cur = mtLoadPayPwdLock(uid);
  const fails = cur.fails + 1;
  const lockedUntil = fails >= MT_PAY_PWD_MAX_FAIL ? Date.now() + MT_PAY_PWD_LOCK_MS : cur.lockedUntil;
  const next = { fails, lockedUntil };
  mtSavePayPwdLock(uid, next);
  return next;
}

/** 账单类型 → 展示文案 */
export const MT_WALLET_BILL_LABEL: Record<MtWalletBill['kind'], string> = {
  recharge: '充值',
  withdraw: '提现',
  pay: '消费',
  refund: '退款',
  loan: '借款',
  repay: '还款',
};

// ---------------- 美团借钱（额度/借据/还款，按账号隔离；借款到账美团余额） ----------------

/** 借钱额度账户（点击申请后模拟审批开通；credit=获批总额度） */
export interface MtLoanAccount {
  applied: boolean;
  appliedAt: number;
  /** 获批总额度（元） */
  credit: number;
}

/** 借据（一笔借款；按期均摊还本付息） */
export interface MtLoan {
  id: string;
  /** 借款本金 */
  amount: number;
  /** 期数 */
  periods: 3 | 6 | 12;
  /** 年化利率（单利 %） */
  apr: number;
  /** 每期应还（本金+利息均摊） */
  monthly: number;
  /** 应还总额（本金+总利息） */
  totalDue: number;
  /** 已还期数 */
  paidPeriods: number;
  status: 'active' | 'repaid';
  borrowedAt: number;
  repaidAt?: number;
}

const loanAcctKey = (uid: string) => `mt-loan-acct:${uid}`;
const loansKey = (uid: string) => `mt-loans:${uid}`;

export function mtLoadLoanAccount(uid: string): MtLoanAccount {
  const a = kvGet<Partial<MtLoanAccount>>(loanAcctKey(uid));
  if (a && typeof a === 'object' && a.applied === true && typeof a.credit === 'number' && Number.isFinite(a.credit) && a.credit > 0) {
    return { applied: true, appliedAt: typeof a.appliedAt === 'number' && a.appliedAt > 0 ? a.appliedAt : Date.now(), credit: Math.round(a.credit * 100) / 100 };
  }
  return { applied: false, appliedAt: 0, credit: 0 };
}

/** 提交额度申请 → 模拟审批：额度 8,800 ~ 99,800，取整到百（对齐「最高可享 99,800」口径） */
export function mtApplyLoanCredit(uid: string): MtLoanAccount {
  const credit = Math.round((8800 + Math.random() * (99800 - 8800)) / 100) * 100;
  const acct: MtLoanAccount = { applied: true, appliedAt: Date.now(), credit };
  kvSet(loanAcctKey(uid), acct);
  return acct;
}

export function mtLoadLoans(uid: string): MtLoan[] {
  const list = kvGet<Partial<MtLoan>[]>(loansKey(uid));
  if (!Array.isArray(list)) return [];
  return list
    .filter((l): l is MtLoan => Boolean(l) && typeof (l as MtLoan).id === 'string' && typeof (l as MtLoan).amount === 'number')
    .map((l): MtLoan => {
      const periods: MtLoan['periods'] = l.periods === 6 || l.periods === 12 ? l.periods : 3;
      return {
        id: l.id,
        amount: Math.max(0, Math.round(l.amount * 100) / 100),
        periods,
        apr: typeof l.apr === 'number' && Number.isFinite(l.apr) ? l.apr : mtLoanAprOf(periods),
        monthly: typeof l.monthly === 'number' && Number.isFinite(l.monthly) ? Math.max(0, Math.round(l.monthly * 100) / 100) : 0,
        totalDue: typeof l.totalDue === 'number' && Number.isFinite(l.totalDue) ? Math.max(0, Math.round(l.totalDue * 100) / 100) : 0,
        paidPeriods: typeof l.paidPeriods === 'number' && l.paidPeriods >= 0 ? Math.floor(l.paidPeriods) : 0,
        status: l.status === 'repaid' ? 'repaid' : 'active',
        borrowedAt: typeof l.borrowedAt === 'number' && l.borrowedAt > 0 ? l.borrowedAt : Date.now(),
        ...(typeof l.repaidAt === 'number' && l.repaidAt > 0 ? { repaidAt: l.repaidAt } : {}),
      };
    })
    .sort((a, b) => b.borrowedAt - a.borrowedAt)
    .slice(0, 50);
}

export function mtSaveLoans(uid: string, loans: MtLoan[]): void {
  kvSet(loansKey(uid), loans.slice(0, 50));
}

/** 年化利率（单利）按期数：3期 5.4% / 6期 10.8% / 12期 19.8%（落在产品详情 5.4%-24% 区间） */
export function mtLoanAprOf(periods: 3 | 6 | 12): number {
  return periods === 3 ? 5.4 : periods === 6 ? 10.8 : 19.8;
}

/** 还款计划：总利息 = 本金 × 年化/100 × 期数/12（单利）；每期均摊两位小数，应还总额 = 每期 × 期数（口径一致，无尾差） */
export function mtLoanPlan(amount: number, periods: 3 | 6 | 12): { apr: number; monthly: number; totalInterest: number; totalDue: number } {
  const apr = mtLoanAprOf(periods);
  const principal = Math.max(0, Math.round(amount * 100) / 100);
  const rawTotal = Math.round((principal + ((principal * apr) / 100) * (periods / 12)) * 100) / 100;
  const monthly = Math.round((rawTotal / periods) * 100) / 100;
  const totalDue = Math.round(monthly * periods * 100) / 100;
  const totalInterest = Math.round((totalDue - principal) * 100) / 100;
  return { apr, monthly, totalInterest, totalDue };
}

/** 单笔借据剩余未还（每期应还 × 未还期数；已还清为 0） */
export function mtLoanRemainOf(l: MtLoan): number {
  if (l.status === 'repaid') return 0;
  return Math.max(0, Math.round(l.monthly * (l.periods - l.paidPeriods) * 100) / 100);
}

/** 在贷总额（占用额度） */
export function mtLoanUsedCredit(uid: string): number {
  return Math.round(mtLoadLoans(uid).reduce((s, l) => s + mtLoanRemainOf(l), 0) * 100) / 100;
}

/** 可借额度 = 获批额度 - 在贷余额 */
export function mtLoanAvailable(uid: string): number {
  return Math.max(0, Math.round((mtLoadLoanAccount(uid).credit - mtLoanUsedCredit(uid)) * 100) / 100);
}

/**
 * 借款：校验额度（最低 ¥500）→ 放款到美团余额 + 账单（kind=loan）。
 */
export function mtBorrow(uid: string, amount: number, periods: 3 | 6 | 12): { ok: boolean; error?: string; loan?: MtLoan } {
  const acct = mtLoadLoanAccount(uid);
  if (!acct.applied) return { ok: false, error: '请先申请借款额度' };
  const amt = Math.round(amount * 100) / 100;
  if (!(amt >= 500)) return { ok: false, error: '借款金额最低 ¥500' };
  const avail = mtLoanAvailable(uid);
  if (amt > avail) return { ok: false, error: `超出可借额度（可借 ¥${avail.toFixed(2)}）` };
  const plan = mtLoanPlan(amt, periods);
  const loan: MtLoan = {
    id: `loan${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    amount: amt,
    periods,
    apr: plan.apr,
    monthly: plan.monthly,
    totalDue: plan.totalDue,
    paidPeriods: 0,
    status: 'active',
    borrowedAt: Date.now(),
  };
  mtSaveLoans(uid, [loan, ...mtLoadLoans(uid)]);
  mtSaveWallet(uid, { balance: Math.round((mtLoadWallet(uid).balance + amt) * 100) / 100 });
  mtPushWalletBill(uid, { kind: 'loan', title: '借款', amount: amt, at: Date.now(), card: `放款至美团余额 · ${periods}期` });
  return { ok: true, loan };
}

/** 还一期：美团余额扣款；还完自动结清 */
export function mtRepayLoanPeriod(uid: string, loanId: string): { ok: boolean; error?: string; done?: boolean } {
  const loan = mtLoadLoans(uid).find((l) => l.id === loanId);
  if (!loan || loan.status !== 'active') return { ok: false, error: '借据不存在或已还清' };
  if (loan.paidPeriods >= loan.periods) return { ok: false, error: '各期均已还清' };
  const wallet = mtLoadWallet(uid);
  if (wallet.balance < loan.monthly) return { ok: false, error: `可用余额不足（可用 ¥${wallet.balance.toFixed(2)}），请先充值` };
  mtSaveWallet(uid, { balance: Math.round((wallet.balance - loan.monthly) * 100) / 100 });
  const paidPeriods = loan.paidPeriods + 1;
  const done = paidPeriods >= loan.periods;
  mtSaveLoans(
    uid,
    mtLoadLoans(uid).map((l) =>
      l.id === loanId
        ? { ...l, paidPeriods, status: (done ? 'repaid' : 'active') as MtLoan['status'], ...(done ? { repaidAt: Date.now() } : {}) }
        : l
    )
  );
  mtPushWalletBill(uid, { kind: 'repay', title: '还款', amount: -loan.monthly, at: Date.now(), card: `第${paidPeriods}/${loan.periods}期 · 美团余额` });
  return { ok: true, done };
}

/** 一次还清：剩余全部本息从美团余额扣 */
export function mtRepayLoanAll(uid: string, loanId: string): { ok: boolean; error?: string } {
  const loan = mtLoadLoans(uid).find((l) => l.id === loanId);
  if (!loan || loan.status !== 'active') return { ok: false, error: '借据不存在或已还清' };
  const remain = mtLoanRemainOf(loan);
  if (!(remain > 0)) return { ok: false, error: '借据不存在或已还清' };
  const wallet = mtLoadWallet(uid);
  if (wallet.balance < remain) return { ok: false, error: `可用余额不足（还清需 ¥${remain.toFixed(2)}），请先充值` };
  mtSaveWallet(uid, { balance: Math.round((wallet.balance - remain) * 100) / 100 });
  mtSaveLoans(
    uid,
    mtLoadLoans(uid).map((l) => (l.id === loanId ? { ...l, paidPeriods: l.periods, status: 'repaid' as const, repaidAt: Date.now() } : l))
  );
  mtPushWalletBill(uid, { kind: 'repay', title: '还款', amount: -remain, at: Date.now(), card: '一次还清 · 美团余额' });
  return { ok: true };
}

// ---------------- 我的卡额度（美团联名卡） ----------------

export interface MtCardQuota {
  /** 是否已申领获批 */
  applied: boolean;
  /** 获批总额度（元） */
  total: number;
  appliedAt: number;
}

const cardQuotaKey = (uid: string) => `mt-card-quota:${uid}`;

export function mtLoadCardQuota(uid: string): MtCardQuota {
  const d = kvGet<Partial<MtCardQuota>>(cardQuotaKey(uid));
  if (d && typeof d === 'object' && d.applied === true && typeof d.total === 'number') {
    return { applied: true, total: d.total, appliedAt: typeof d.appliedAt === 'number' ? d.appliedAt : Date.now() };
  }
  return { applied: false, total: 0, appliedAt: 0 };
}

/** 免费申领：模拟审批，随机获批 19,800 ~ 99,800（取整到百） */
export function mtApplyCardQuota(uid: string): MtCardQuota {
  const total = (198 + Math.floor(Math.random() * 801)) * 100;
  const next: MtCardQuota = { applied: true, total, appliedAt: Date.now() };
  kvSet(cardQuotaKey(uid), next);
  return next;
}

/** 已用额度：钱包账单里银行卡支付消费（card 字段含「尾号」的 pay 账单）累计 */
export function mtCardQuotaUsed(uid: string): number {
  return Math.round(
    mtLoadWalletBills(uid)
      .filter((b) => b.kind === 'pay' && (b.card ?? '').includes('尾号'))
      .reduce((s, b) => s + Math.abs(b.amount), 0) * 100
  ) / 100;
}

/** 可用额度 = 总额度 - 已用（不小于 0） */
export function mtCardQuotaAvailable(uid: string): number {
  const q = mtLoadCardQuota(uid);
  return Math.max(0, Math.round((q.total - mtCardQuotaUsed(uid)) * 100) / 100);
}

// ---------------- 购药抵扣金 ----------------

export interface MtDrugFundRecord {
  id: string;
  title: string;
  /** 正数=获得，负数=使用 */
  amount: number;
  at: number;
}

export interface MtDrugFund {
  activated: boolean;
  activatedAt: number;
  balance: number;
  records: MtDrugFundRecord[];
}

const drugFundKey = (uid: string) => `mt-drug-fund:${uid}`;

export function mtLoadDrugFund(uid: string): MtDrugFund {
  const d = kvGet<Partial<MtDrugFund>>(drugFundKey(uid));
  if (d && typeof d === 'object' && d.activated === true) {
    return {
      activated: true,
      activatedAt: typeof d.activatedAt === 'number' ? d.activatedAt : Date.now(),
      balance: typeof d.balance === 'number' ? d.balance : 0,
      records: Array.isArray(d.records) ? d.records : [],
    };
  }
  return { activated: false, activatedAt: 0, balance: 0, records: [] };
}

/** 激活：到账 ¥3.00 抵扣金（记一笔获得明细） */
export function mtActivateDrugFund(uid: string): MtDrugFund {
  const cur = mtLoadDrugFund(uid);
  if (cur.activated) return cur;
  const rec: MtDrugFundRecord = { id: `df${Date.now().toString(36)}`, title: '新用户专享 激活到账', amount: 3, at: Date.now() };
  const next: MtDrugFund = { activated: true, activatedAt: Date.now(), balance: 3, records: [rec] };
  kvSet(drugFundKey(uid), next);
  return next;
}

/** 使用抵扣金（购药订单支付时抵扣；amount > 0，自动不超过余额） */
export function mtUseDrugFund(uid: string, amount: number, title: string): MtDrugFund {
  const cur = mtLoadDrugFund(uid);
  if (!cur.activated) return cur;
  const use = Math.min(cur.balance, Math.round(amount * 100) / 100);
  if (use <= 0) return cur;
  const rec: MtDrugFundRecord = { id: `df${Date.now().toString(36)}`, title, amount: -use, at: Date.now() };
  const next: MtDrugFund = { ...cur, balance: Math.round((cur.balance - use) * 100) / 100, records: [rec, ...cur.records] };
  kvSet(drugFundKey(uid), next);
  return next;
}

// ---------------- 开发票 ----------------

export interface MtInvoice {
  id: string;
  orderId: string;
  merchantName: string;
  amount: number;
  /** 抬头类型 */
  type: '个人' | '单位';
  /** 抬头名称 */
  title: string;
  /** 单位税号 */
  taxNo?: string;
  /** 接收邮箱 */
  email: string;
  status: '开票中' | '已开票';
  at: number;
}

const invoicesKey = (uid: string) => `mt-invoices:${uid}`;

export function mtLoadInvoices(uid: string): MtInvoice[] {
  const arr = kvGet<MtInvoice[]>(invoicesKey(uid));
  return Array.isArray(arr) ? arr : [];
}

export function mtSaveInvoices(uid: string, list: MtInvoice[]): void {
  kvSet(invoicesKey(uid), list);
}

/** 新开发票（插到最前） */
export function mtAddInvoice(uid: string, inv: Omit<MtInvoice, 'id' | 'at' | 'status'>): MtInvoice {
  const full: MtInvoice = { ...inv, id: `inv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, status: '已开票', at: Date.now() };
  mtSaveInvoices(uid, [full, ...mtLoadInvoices(uid)]);
  return full;
}

// ---------------- 历史订单无限生成（需求「只要有订单的地方就能上滑刷新生成，下滑无限生成」） ----------------
//
// - 频道池覆盖 外卖/闪购/团购/机票/火车票/酒店/电影演出/休闲玩乐（商家名+商品名体现频道，图走对应品类插画）；
// - 确定性生成（同批次号同结果），跨批去重（商家名|商品名 组合），绝不与已有订单重复；
// - 生成订单直接写入真实订单存储（unshift 前插保持时间序），详情/评价/退款/券码全链路复用；
// - 下拉刷新出「最近的新单」，上滑到底加载「更早的历史单」（createdAt 随批次向过去递增）。

/** mulberry32：seed → 确定性伪随机序列（与 tb-product-gen 同款） */
function mtRngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mtHashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

const round2Mt = (n: number) => Math.round(n * 100) / 100;

/** 闪购/超市便利池：[商家名， [商品名， 价， 图tag], ...] */
const GEN_SHANGOU: Array<[string, Array<[string, number, string]>]> = [
  ['永辉超市（万达广场店）', [['海南香蕉 1把（约1kg）', 6.9, 'fruit'], ['农夫山泉饮用天然水 550ml×12瓶', 25.9, 'store'], ['乐事薯片经典原味 70g', 5.5, 'snacks']]],
  ['物美超市（新华路店）', [['红富士苹果 4个装', 12.9, 'fruit'], ['蒙牛纯牛奶 250ml×16盒', 49.9, 'milk'], ['心相印抽纸 3层100抽×6包', 29.9, 'store']]],
  ['711便利店（建设路店）', [['饭团（金枪鱼味）', 7.8, 'rice'], ['关东煮（3串组合）', 12.5, 'hotpot'], ['冰镇可乐 500ml', 3.5, 'cola']]],
  ['百果园（朝阳门店）', [['智利车厘子 JJ级 500g', 39.9, 'fruit'], ['泰国金枕榴莲肉 300g盒装', 29.9, 'fruit'], ['当季混装水果切盒', 15.9, 'fruit']]],
  ['康佰馨大药房（文化路店）', [['999感冒灵颗粒 10袋', 15.5, 'medicine'], ['医用外科口罩 50只装', 19.9, 'medicine'], ['维生素C咀嚼片 60片', 29.9, 'medicine']]],
  ['花加生活馆（万象城店）', [['碎冰蓝玫瑰花束 9朵', 99, 'flower'], ['向日葵单支鲜花', 12.9, 'flower'], ['康乃馨混合花束 19朵', 138, 'flower']]],
];

/** 酒店旅行池 */
const GEN_HOTEL: Array<[string, Array<[string, number]>]> = [
  ['亚朵酒店（市中心店）', [['高级大床房 1间1晚', 329], ['豪华双床房 1间1晚（含双早）', 399], ['智能景观大床房 1间1晚', 419]]],
  ['全季酒店（高铁站店）', [['标准大床房 1间1晚', 259], ['商务双床房 1间1晚', 289], ['全季甄选套房 1间1晚', 529]]],
  ['汉庭酒店（步行街店）', [['汉庭优享大床房 1间1晚', 189], ['家庭双床房 1间1晚', 229]]],
  ['希尔顿欢朋（会展中心店）', [['欢朋套房 1间1晚（含双早）', 468], ['高级标间 1间1晚', 358]]],
];

/** 电影演出/休闲玩乐池 */
const GEN_FUN: Array<[string, string, Array<[string, number]>]> = [
  ['万达影城（IMAX万象店）', 'movie', [['热映通兑票 2D/3D通用 1张', 39.9], ['IMAX 2D兑换券 1张', 59.9], ['双人情侣套票（2张+中爆1份）', 99]]],
  ['CGV影城（银泰城店）', 'movie', [['4DX动感影票 1张', 79.9], ['黄金场通兑票 1张', 45]]],
  ['横店影视电影城（高新店）', 'movie', [['2D通兑票 1张', 35.9]]],
  ['纯K party（朝阳店）', 'fun', [['欢唱3小时小包套餐（含果盘）', 128], ['周末欢唱下午场 4小时', 168]]],
  ['万达宝贝王（儿童乐园）', 'fun', [['一大一小畅玩票 全天通用', 88]]],
  ['天空之城密室逃脱', 'fun', [['恐怖主题《回声》单人票', 98], ['古风实景《长安乱》双人票', 188]]],
];

/** 机票/火车票池 */
const GEN_TRIP: Array<[string, 'flight' | 'train', string, number]> = [
  ['美团机票', 'flight', '南航CZ6789 北京→上海 经济舱', 720],
  ['美团机票', 'flight', '东航MU5137 北京→成都 经济舱', 860],
  ['美团机票', 'flight', '国航CA1515 杭州→广州 经济舱', 780],
  ['美团机票', 'flight', '吉祥HO1251 上海→三亚 经济舱', 940],
  ['美团机票', 'flight', '川航3U8882 成都→深圳 经济舱', 810],
  ['美团火车票', 'train', 'G101次 北京南→上海虹桥 二等座', 553],
  ['美团火车票', 'train', 'G39次 北京西→西安北 二等座', 515.5],
  ['美团火车票', 'train', 'D2281次 上海→武汉 二等座', 264],
  ['美团火车票', 'train', 'G87次 北京西→长沙南 一等座', 926],
  ['美团火车票', 'train', 'K599次 郑州→广州 硬卧', 288.5],
];

/** 团购到店池（美食团购：从 MT_DEALS 取真实套餐，图价全对） */
const GEN_TUANGOU_SHOPS = ['上岛咖啡（旗舰店）', '海底捞火锅（万达店）', '西贝莜面村（购物中心店）'];

/** 订单去重 key（商家名|首件商品名）：跨批/与存量订单绝不重复 */
export function mtGenOrderKey(o: Pick<MtOrder, 'merchantName' | 'items'>): string {
  return `${o.merchantName}|${o.items[0]?.name ?? ''}`;
}

/** AI/本地生成条目 → MtOrder（completed/canceled 终态历史单，createdAt 向过去推 daysAgo 天） */
export function mtBuildGenOrder(
  uid: string,
  raw: {
    merchantName: string;
    kind: MtOrderKind;
    /** 频道 tag（决定图标 emoji 与展示）：waimai/shangou/hotel/movie/fun/flight/train/tuangou */
    channel?: string;
    itemName: string;
    price: number;
    qty?: number;
    total?: number;
    spec?: string;
    emoji?: string;
    img?: string;
    daysAgo: number;
    canceled?: boolean;
  },
  idx = 0
): MtOrder {
  const qty = Math.max(1, Math.round(raw.qty ?? 1));
  const price = Math.max(0.01, round2Mt(raw.price));
  const total = Math.max(0.01, round2Mt(raw.total ?? price * qty));
  const now = Date.now();
  const jitter = ((mtHashStr(raw.merchantName + raw.itemName) % 40) + idx * 3) * 3600_000;
  const createdAt = now - Math.max(1, raw.daysAgo) * 86_400_000 - jitter;
  const channel = raw.channel ?? raw.kind;
  const emoji = raw.emoji ?? (channel === 'hotel' ? '🏨' : channel === 'movie' ? '🎬' : channel === 'flight' ? '✈️' : channel === 'train' ? '🚄' : channel === 'shangou' ? '🛒' : channel === 'fun' ? '🎡' : '🍜');
  const canceled = raw.canceled === true;
  const paidAt = createdAt + 2 * 60_000;
  return {
    id: `mtg${mtHashStr(`${raw.merchantName}|${raw.itemName}|${raw.daysAgo}`).toString(36)}${idx}`,
    uid,
    merchantId: channel === 'hotel' ? `fun-hotel-${mtHashStr(raw.merchantName)}` : channel === 'movie' || channel === 'fun' ? `fun-${channel}-${mtHashStr(raw.merchantName)}` : `gen-${mtHashStr(raw.merchantName).toString(36)}`,
    merchantName: raw.merchantName,
    merchantEmoji: emoji,
    merchantImg: raw.img,
    kind: raw.kind,
    items: [{ dishId: `gen-${mtHashStr(raw.itemName).toString(36)}`, name: raw.itemName, price, qty, emoji, img: raw.img, spec: raw.spec }],
    itemTotal: total,
    deliveryFee: raw.kind === 'waimai' ? (channel === 'shangou' ? 3 : 0) : 0,
    discount: 0,
    total,
    status: canceled ? 'canceled' : 'completed',
    createdAt,
    paidAt: canceled ? undefined : paidAt,
    cancelReason: canceled ? '多拍/拍错，主动取消' : undefined,
    consumedAt: !canceled && raw.kind === 'tuangou' ? paidAt + 3600_000 : undefined,
    statusLog: canceled
      ? [{ status: 'pendingPay' as const, at: createdAt }, { status: 'canceled' as const, at: createdAt + 600_000 }]
      : [{ status: 'pendingPay' as const, at: createdAt }, { status: 'pendingAccept' as const, at: paidAt }, { status: 'completed' as const, at: paidAt + 30 * 60_000 }],
  };
}

/** 第 batch 批本地历史订单（频道轮转，一批 3 条，确定性可复现，跨批去重） */
export function mtGenHistoryOrders(uid: string, batch: number, excludeKeys: string[]): MtOrder[] {
  const r = mtRngFrom((mtHashStr('mt-gen-orders') ^ Math.imul(batch + 1, 2654435761)) >>> 0);
  const ex = new Set(excludeKeys);
  const out: MtOrder[] = [];
  const baseDays = 2 + batch * 4;
  const pick2 = <T,>(arr: T[]): T => arr[Math.floor(r() * arr.length) % arr.length];
  let tries = 0;
  while (out.length < 3 && tries < 24) {
    tries += 1;
    const slot = (batch * 3 + tries) % 7;
    let raw: Parameters<typeof mtBuildGenOrder>[1] | null = null;
    if (slot === 0) {
      // 真实外卖商家（MT_MERCHANTS 取店取菜）
      const m = MT_MERCHANTS[Math.floor(r() * MT_MERCHANTS.length) % MT_MERCHANTS.length];
      const dishes = mtDishesOf(m);
      const d = dishes[Math.floor(r() * dishes.length) % dishes.length];
      if (!d) continue;
      raw = { merchantName: m.name, kind: 'waimai', channel: 'waimai', itemName: d.name, price: d.price, qty: 1 + (Math.floor(r() * 2) % 2), emoji: d.emoji, img: d.img ?? m.cover, daysAgo: baseDays + Math.floor(r() * 3), canceled: r() < 0.08 };
    } else if (slot === 1) {
      // 闪购/超市便利
      const [shop, items] = pick2(GEN_SHANGOU);
      const [name, price, tag] = pick2(items);
      raw = { merchantName: shop, kind: 'waimai', channel: 'shangou', itemName: name, price, qty: 1, emoji: '🛒', img: mtImg(tag, 240, 240, 1, 'f'), spec: '极速送 · 30分钟达', daysAgo: baseDays + Math.floor(r() * 3), canceled: r() < 0.08 };
    } else if (slot === 2) {
      // 美食团购到店
      const deals = MT_DEALS.slice(0, 40);
      const d = deals[Math.floor(r() * deals.length) % deals.length];
      raw = { merchantName: d.merchantId ? MT_MERCHANTS.find((m) => m.id === d.merchantId)?.name ?? pick2(GEN_TUANGOU_SHOPS) : pick2(GEN_TUANGOU_SHOPS), kind: 'tuangou', channel: 'tuangou', itemName: d.title, price: d.price, qty: 1, emoji: d.emoji, img: d.img, spec: d.usable, daysAgo: baseDays + Math.floor(r() * 3), canceled: r() < 0.08 };
    } else if (slot === 3) {
      // 机票
      const [shop, , item, price] = pick2(GEN_TRIP.filter((x) => x[1] === 'flight'));
      raw = { merchantName: shop, kind: 'flight', channel: 'flight', itemName: item, price, qty: 1, emoji: '✈️', img: mtImg('flight', 240, 240, 0, 'f'), spec: `${baseDays % 28 + 1}日出行的已出行订单 · 经济舱`, daysAgo: baseDays + Math.floor(r() * 3), canceled: r() < 0.05 };
    } else if (slot === 4) {
      // 酒店
      const [shop, items] = pick2(GEN_HOTEL);
      const [name, price] = pick2(items);
      raw = { merchantName: shop, kind: 'tuangou', channel: 'hotel', itemName: name, price, qty: 1, emoji: '🏨', img: mtImg('hotel', 240, 240, 0, 'f'), spec: '已离店 · 在线选房', daysAgo: baseDays + Math.floor(r() * 3), canceled: r() < 0.08 };
    } else if (slot === 5) {
      // 电影演出/休闲玩乐
      const [shop, ch, items] = pick2(GEN_FUN);
      const [name, price] = pick2(items);
      raw = { merchantName: shop, kind: 'tuangou', channel: ch === 'movie' ? 'movie' : 'fun', itemName: name, price, qty: ch === 'movie' ? 2 : 1, emoji: ch === 'movie' ? '🎬' : '🎡', img: mtImg(ch === 'movie' ? 'movie' : 'store', 240, 240, 0, 'f'), spec: ch === 'movie' ? '已过场次 · 凭码入场' : '已消费 · 到店出示', daysAgo: baseDays + Math.floor(r() * 3), canceled: r() < 0.08 };
    } else {
      // 火车票
      const [shop, , item, price] = pick2(GEN_TRIP.filter((x) => x[1] === 'train'));
      raw = { merchantName: shop, kind: 'train', channel: 'train', itemName: item, price, qty: 1, emoji: '🚄', img: mtImg('train', 240, 240, 0, 'f'), spec: '已出行 · 凭身份证检票', daysAgo: baseDays + Math.floor(r() * 3), canceled: r() < 0.05 };
    }
    if (!raw) continue;
    const order = mtBuildGenOrder(uid, raw, tries);
    const key = mtGenOrderKey(order);
    if (ex.has(key)) continue;
    ex.add(key);
    out.push(order);
  }
  return out;
}

/** 生成订单入库（前插去重，不覆盖用户真实订单；返回实际新增条数）
 *  同时对存量做同 key 去重（保留最新一条）——防止历史遗留重复订单反复出现 */
export function mtInsertGenOrders(uid: string, batch: MtOrder[]): number {
  const list = mtLoadOrders(uid);
  const ex = new Set(list.map(mtGenOrderKey));
  const fresh = batch.filter((o) => !ex.has(mtGenOrderKey(o)) && !list.some((x) => x.id === o.id));
  if (fresh.length === 0) return 0;
  // 存量+新单合并去重（list 已按时间倒序，同 key 保留第一条即最新）
  const seen = new Set<string>();
  const deduped = [...fresh, ...list].filter((o) => {
    const k = mtGenOrderKey(o);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  mtSaveOrders(uid, deduped.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ORDERS));
  return fresh.length;
}

/** 现有订单全部去重 key（下拉/上滑生成前传入防重复） */
export function mtExistingOrderKeys(uid: string): string[] {
  return mtLoadOrders(uid).map(mtGenOrderKey);
}

// ---------------- 外部直达页（第十九轮：情侣空间「情侣酒店」→ 美团「酒店旅行」频道） ----------------

/** 待打开的页面（模块级；MeituanApp 挂载时消费） */
let mtPendingPage: 'travel' | null = null;

/** 外部写入待打开页（情侣空间点击「情侣酒店」时调用） */
export function setMtPendingPage(p: 'travel'): void {
  mtPendingPage = p;
}

/** MeituanApp 挂载时取走待打开页（读后即清） */
export function takeMtPendingPage(): 'travel' | null {
  const p = mtPendingPage;
  mtPendingPage = null;
  return p;
}
