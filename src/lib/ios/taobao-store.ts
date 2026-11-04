/**
 * 淘宝 App 数据层（本地优先，与美团/微信/QQ 同架构）：
 * - 所有淘宝数据存 IndexedDB kv（idb-kv 内存同步读 + 异步写穿），键按登录账号隔离：
 *   登录身份 uid = `wx:<联系人id>` / `qq:<联系人id>` / `ph:<手机号>`，淘宝数据键全部带 uid
 *   （`tb-orders:<uid>` 等）——换账号登录互不串数据（需求「淘宝数据按账号隔离」）；
 * - 登录态存 localStorage `tb-session`（重启后仍保留）；
 * - 订单状态机（确定性时间戳推进，MeituanOrderWatcher 同款思路：全局 tick + 打开 App catch-up，
 *   重启不丢进度）：待付款(30min 超时自动取消) → 支付 → 待发货(SHIP_DELAY 自动发货) →
 *   待收货(物流节点每 TRACK_STEP 推进：已揽收→运输中→派送中→已到驿站) → 确认收货 → 已完成；
 *   待付款可取消 → 已取消；待发货/待收货/已完成可退款 → 退款成功原路退回（taobao-pay.ts）→ 已取消；
 * - 支付不在这里：taobao-pay.ts 动态 import 微信/QQ 钱包模块（支付复用现有 QQ、微信逻辑）。
 */
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { DS_RANGES, dsDesc, dsGet, dsMinutesFor, dsSet } from './delivery-speed';
import { accLs, getActiveAccountFor } from './accounts';
import type { OrderCustomMeta } from './order-custom';
import {
  productById,
  shopById,
  tbImg,
  tbReviewsOf,
  tbShopIdForTag,
  tbRegisterCustomProduct,
  tbUnregisterCustomProduct,
  tbProductImgOverride,
  TB_SHOPS,
  type TbProduct,
  type TbShop,
} from './taobao-data';
import { tbGenProducts } from './tb-product-gen';

// ---------------- 登录态 ----------------

export interface TbSession {
  /** 登录方式：QQ 一键 / 微信一键 / 手机号 */
  idp: 'wx' | 'qq' | 'phone';
  /** wx/qq 登录：联系人记录 id */
  contactId?: string;
  phone?: string;
  /** 'oneclick' 一键授权（跟随微信/QQ App 登录态）/ 'password' 账号密码独立会话 */
  via?: 'oneclick' | 'password';
  name: string;
  avatar: string | null;
  loginAt: number;
}

const LS_SESSION = 'tb-session';

export function tbUidOf(s: TbSession): string {
  if (s.idp === 'phone') return `ph:${s.phone ?? ''}`;
  return `${s.idp}:${s.contactId ?? ''}`;
}

export function tbGetSession(): TbSession | null {
  try {
    const raw = window.localStorage.getItem(LS_SESSION);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<TbSession>;
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

export function tbSetSession(s: TbSession | null): void {
  try {
    if (s) window.localStorage.setItem(LS_SESSION, JSON.stringify(s));
    else window.localStorage.removeItem(LS_SESSION);
  } catch {
    /* 存储失败静默（隐私模式等） */
  }
}

/** 一键登录前提：微信/QQ App 在线（与美团 mtIdpLoggedIn 同口径：会话键 `wx-session-user-id` / `qq-session-user-id` 账号作用域） */
export function tbIdpLoggedIn(idp: 'wx' | 'qq'): boolean {
  try {
    return window.localStorage.getItem(accLs(`${idp}-session-user-id`, idp)) !== null;
  } catch {
    return false;
  }
}

/** 一键登录身份解析（与美团 mtResolveIdpIdentity 同源：会话指针 → 账号槽位档案 → 虚拟账号兜底） */
export async function tbResolveIdpIdentity(idp: 'wx' | 'qq'): Promise<{ contactId: string; name: string; avatar: string | null }> {
  try {
    const { listContacts } = await import('./contacts-store');
    const acc = getActiveAccountFor(idp);
    const all = await listContacts();
    let me: (typeof all)[number] | undefined;
    const sid = window.localStorage.getItem(accLs(`${idp}-session-user-id`, idp)) ?? '';
    if (sid) me = all.find((c) => c.id === sid && c.kind === 'user');
    if (!me) {
      me = acc.kind === 'main' ? all.find((c) => c.kind === 'user' && !c.altOf) : all.find((c) => c.altOf === acc.id);
    }
    if (me) return { contactId: me.id, name: me.name || (idp === 'wx' ? '微信用户' : 'QQ用户'), avatar: me.avatar ?? null };
  } catch {
    /* 联系人库异常 → 走虚拟账号兜底 */
  }
  return { contactId: '', name: idp === 'wx' ? '微信用户' : 'QQ用户', avatar: null };
}

/**
 * 会话资料跟随全局账号信息（与美团 mtSyncSessionIdentity 同款）：
 * 按会话绑定的联系人实时读取「我」的最新昵称/头像（avatarFor 按 App 投影，与微信/QQ 显示一致），
 * 变化则返回新会话（uid 不变，数据隔离不受影响）；联系人缺失/异常时原样返回。
 * 配合 contact-avatar-changed / contact-updated 事件可实时同步——
 * 在联系人 App（或微信/QQ 资料页）改头像/昵称后，淘宝不再持旧快照。
 */
export async function tbSyncSessionIdentity(s: TbSession): Promise<TbSession> {
  if (s.idp === 'phone' || !s.contactId) return s;
  try {
    const { getContact } = await import('./contacts-store');
    const { avatarFor } = await import('@/lib/contacts');
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

// ---------------- kv 基础 ----------------

function load<T>(key: string, def: T): T {
  const v = kvGet(key);
  if (v == null) return def;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return def;
  }
}

function save(key: string, v: unknown): void {
  kvSet(key, JSON.stringify(v));
}

/** 清空某账号全部淘宝数据（退出登录不清理，重登数据还在；仅「设置-清除淘宝数据」用） */
export function tbWipeUid(uid: string): void {
  for (const base of ['tb-cart', 'tb-favs', 'tb-foots', 'tb-addrs', 'tb-coupons', 'tb-orders', 'tb-msgs', 'tb-shopfollow', 'tb-search']) save(`${base}:${uid}`, []);
  save(`tb-curaddr:${uid}`, '');
}

// ---------------- 购物车 ----------------

export interface TbCartItem {
  pid: string;
  /** 已选规格（组名 → 选项） */
  sku: Record<string, string>;
  qty: number;
  checked: boolean;
  at: number;
}

const cartKey = (uid: string) => `tb-cart:${uid}`;

export function tbLoadCart(uid: string): TbCartItem[] {
  return load<TbCartItem[]>(cartKey(uid), []);
}

export function tbSaveCart(uid: string, v: TbCartItem[]): void {
  save(cartKey(uid), v);
}

/** 加入购物车（同商品同规格合并数量；skuKey = 组名:选项 用 | 串接） */
export function tbAddToCart(uid: string, pid: string, sku: Record<string, string>, qty: number): void {
  const list = tbLoadCart(uid);
  const sig = tbSkuSig(sku);
  const hit = list.find((c) => c.pid === pid && tbSkuSig(c.sku) === sig);
  if (hit) hit.qty = Math.min(99, hit.qty + qty);
  else list.push({ pid, sku, qty: Math.min(99, Math.max(1, qty)), checked: true, at: Date.now() });
  save(cartKey(uid), list);
}

/** 规格签名（合并/展示用：颜色分类:蓝色|尺码:L） */
export function tbSkuSig(sku: Record<string, string>): string {
  return Object.keys(sku)
    .sort()
    .map((k) => `${k}:${sku[k]}`)
    .join('|');
}

export function tbCartQty(uid: string): number {
  return tbLoadCart(uid).reduce((n, c) => n + c.qty, 0);
}

export function tbUpdateCartItem(uid: string, pid: string, sig: string, patch: { qty?: number; checked?: boolean }): void {
  const list = tbLoadCart(uid);
  const hit = list.find((c) => c.pid === pid && tbSkuSig(c.sku) === sig);
  if (!hit) return;
  if (patch.qty !== undefined) {
    // 需求：数量减到 0 自动移除
    if (patch.qty <= 0) {
      save(cartKey(uid), list.filter((c) => c !== hit));
      return;
    }
    hit.qty = Math.min(99, patch.qty);
  }
  if (patch.checked !== undefined) hit.checked = patch.checked;
  save(cartKey(uid), list);
}

export function tbRemoveCartItems(uid: string, keys: { pid: string; sig: string }[]): void {
  const set = new Set(keys.map((k) => `${k.pid}|${k.sig}`));
  save(
    cartKey(uid),
    tbLoadCart(uid).filter((c) => !set.has(`${c.pid}|${tbSkuSig(c.sku)}`))
  );
}

export function tbSetCartAllChecked(uid: string, checked: boolean): void {
  save(
    cartKey(uid),
    tbLoadCart(uid).map((c) => ({ ...c, checked }))
  );
}

/** 结算后清掉已购商品 */
export function tbClearCheckedCart(uid: string): void {
  save(
    cartKey(uid),
    tbLoadCart(uid).filter((c) => !c.checked)
  );
}

/** 店铺置顶（购物车管理模式）：该店铺全部商品移到列表最前（保序稳定） */
export function tbPinCartShop(uid: string, shopId: string, shopOf: (pid: string) => string): void {
  const list = tbLoadCart(uid);
  const head = list.filter((c) => shopOf(c.pid) === shopId);
  if (head.length === 0 || head.length === list.length) return;
  save(
    cartKey(uid),
    [...head, ...list.filter((c) => shopOf(c.pid) !== shopId)]
  );
}

// ---------------- 收藏 / 足迹 ----------------

const favKey = (uid: string) => `tb-favs:${uid}`;

export function tbLoadFavs(uid: string): string[] {
  return load<string[]>(favKey(uid), []);
}

export function tbToggleFav(uid: string, pid: string): boolean {
  const list = tbLoadFavs(uid);
  const i = list.indexOf(pid);
  if (i >= 0) {
    list.splice(i, 1);
    save(favKey(uid), list);
    return false;
  }
  list.unshift(pid);
  save(favKey(uid), list);
  return true;
}

const footKey = (uid: string) => `tb-foots:${uid}`;

export interface TbFoot {
  pid: string;
  at: number;
}

/** 浏览商品即记录足迹（同商品去重置顶，上限 60 条） */
export function tbPushFoot(uid: string, pid: string): void {
  const list = load<TbFoot[]>(footKey(uid), []).filter((f) => f.pid !== pid);
  list.unshift({ pid, at: Date.now() });
  save(footKey(uid), list.slice(0, 60));
}

export function tbLoadFoots(uid: string): TbFoot[] {
  return load<TbFoot[]>(footKey(uid), []);
}

// ---------------- 收货地址 ----------------

export interface TbAddress {
  id: string;
  name: string;
  phone: string;
  /** 省市区（简化文本） */
  region: string;
  detail: string;
  tag: string;
}

const addrKey = (uid: string) => `tb-addrs:${uid}`;
const LS_CUR_ADDR = 'tb-cur-addr';

export function tbLoadAddrs(uid: string): TbAddress[] {
  return load<TbAddress[]>(addrKey(uid), []);
}

export function tbSaveAddrs(uid: string, list: TbAddress[]): void {
  save(addrKey(uid), list);
}

export function tbCurAddrId(uid: string): string {
  try {
    return window.localStorage.getItem(`${LS_CUR_ADDR}:${uid}`) ?? '';
  } catch {
    return '';
  }
}

export function tbSetCurAddr(uid: string, id: string): void {
  try {
    window.localStorage.setItem(`${LS_CUR_ADDR}:${uid}`, id);
  } catch {
    /* 静默 */
  }
}

/** 当前地址（无记录取第一条；仍无返回 null） */
export function tbCurAddr(uid: string): TbAddress | null {
  const list = tbLoadAddrs(uid);
  const cur = list.find((a) => a.id === tbCurAddrId(uid));
  return cur ?? list[0] ?? null;
}

// ---------------- 优惠券 ----------------

export interface TbCoupon {
  id: string;
  /** 券名（消费券/服饰加补券…） */
  name: string;
  amount: number;
  /** 门槛（满 N 可用，0 无门槛） */
  min: number;
  /** 适用商品 pid（空 = 全场通用） */
  pids: string[];
  expireAt: number;
  usedAt?: number;
  /** 用在哪个订单 */
  usedOrderId?: string;
}

const couponKey = (uid: string) => `tb-coupons:${uid}`;

export function tbLoadCoupons(uid: string): TbCoupon[] {
  return load<TbCoupon[]>(couponKey(uid), []);
}

export function tbSaveCoupons(uid: string, list: TbCoupon[]): void {
  save(couponKey(uid), list);
}

/** 领取领券中心券（每张券每账号限领 1 次） */
export function tbClaimCoupon(uid: string, c: Omit<TbCoupon, 'id' | 'expireAt' | 'usedAt'>): boolean {
  const list = tbLoadCoupons(uid);
  if (list.some((x) => x.name === c.name && !x.usedAt)) return false;
  list.unshift({ ...c, id: `tbc${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`, expireAt: Date.now() + 7 * 86_400_000 });
  save(couponKey(uid), list);
  return true;
}

/** 订单可用的最优券（按抵扣最大取；门槛已满足且在有效期内且未核销） */
export function tbBestCoupon(uid: string, pid: string, amount: number): TbCoupon | null {
  const now = Date.now();
  const ok = tbLoadCoupons(uid).filter(
    (c) => !c.usedAt && c.expireAt > now && (c.pids.length === 0 || c.pids.includes(pid)) && amount >= c.min
  );
  if (ok.length === 0) return null;
  return ok.sort((a, b) => b.amount - a.amount)[0];
}

/** 核销/回滚 */
export function tbUseCoupon(uid: string, cid: string, orderId: string): void {
  const list = tbLoadCoupons(uid);
  const hit = list.find((c) => c.id === cid);
  if (hit) {
    hit.usedAt = Date.now();
    hit.usedOrderId = orderId;
    save(couponKey(uid), list);
  }
}

export function tbUnuseCoupon(uid: string, cid: string): void {
  const list = tbLoadCoupons(uid);
  const hit = list.find((c) => c.id === cid);
  if (hit) {
    delete hit.usedAt;
    delete hit.usedOrderId;
    save(couponKey(uid), list);
  }
}

/** 领券中心种子（「我的」页横滑领取 + 领券中心页领取） */
export const TB_COUPON_SEEDS: { name: string; amount: number; min: number; pids: string[] }[] = [
  { name: '消费券', amount: 10, min: 0, pids: [] },
  { name: '服饰加补券', amount: 15, min: 59, pids: [] },
  { name: '数码加补券', amount: 50, min: 199, pids: [] },
  { name: '美妆加补券', amount: 20, min: 79, pids: [] },
  { name: '食品加补券', amount: 5, min: 0, pids: [] },
];

/** 领券中心页种子（超级88领好券：截图口径 三档消费券/家电数码券/平台加补券/预告券） */
export const TB_CC_SEEDS: {
  consume: { amount: number; min: number }[];
  bonus: { amount: number; min: number };
  digital: { amount: number; min: number }[];
  extra: { name: string; amount: number; min: number; count: number; scope: string; tag: string }[];
  upcoming: { name: string; amount: number; min: number; count: number }[];
} = {
  consume: [
    { amount: 3, min: 20 },
    { amount: 20, min: 200 },
    { amount: 50, min: 500 },
  ],
  bonus: { amount: 15, min: 125 },
  digital: [
    { amount: 150, min: 1500 },
    { amount: 300, min: 3000 },
    { amount: 500, min: 5000 },
  ],
  extra: [
    { name: '超市加补券', amount: 926, min: 0, count: 10, scope: '限超市部分商品可用', tag: 'grocery' },
    { name: '母婴加补券', amount: 40, min: 0, count: 2, scope: '限母婴部分商品可用', tag: 'toy' },
  ],
  upcoming: [
    { name: '服饰加补券', amount: 100, min: 0, count: 3 },
    { name: '秋装加补券', amount: 200, min: 0, count: 4 },
    { name: '饰品加补券', amount: 165, min: 0, count: 3 },
  ],
};

// ---------------- 店铺关注 ----------------

const followKey = (uid: string) => `tb-shopfollow:${uid}`;

export function tbLoadShopFollows(uid: string): string[] {
  return load<string[]>(followKey(uid), []);
}

export function tbToggleShopFollow(uid: string, shopId: string): boolean {
  const list = tbLoadShopFollows(uid);
  const i = list.indexOf(shopId);
  if (i >= 0) {
    list.splice(i, 1);
    save(followKey(uid), list);
    return false;
  }
  list.unshift(shopId);
  save(followKey(uid), list);
  return true;
}

// ---------------- 搜索历史 ----------------

const searchKey = (uid: string) => `tb-search:${uid}`;

export function tbLoadSearchHist(uid: string): string[] {
  return load<string[]>(searchKey(uid), []);
}

export function tbPushSearchHist(uid: string, kw: string): void {
  const k = kw.trim();
  if (!k) return;
  const list = tbLoadSearchHist(uid).filter((x) => x !== k);
  list.unshift(k);
  save(searchKey(uid), list.slice(0, 12));
}

export function tbClearSearchHist(uid: string): void {
  save(searchKey(uid), []);
}

// ---------------- 订单 ----------------

export type TbOrderStatus = 'pendingPay' | 'pendingDeliver' | 'shipped' | 'completed' | 'cancelled';

/** 票务订单信息（第十三轮淘票票：电影/喜剧脱口秀/演唱会出票；无物流，直接待收货） */
export interface TbTicketInfo {
  kind: 'movie' | 'comedy' | 'concert';
  /** 影片/演出名 */
  title: string;
  /** 海报渐变色（无实体图时渲染渐变海报） */
  posterC1: string;
  posterC2: string;
  /** 版本行（国语 2D / 脱口秀 / 演唱会） */
  badge: string;
  qty: number;
  /** 影院/剧场/场馆 */
  venue: string;
  /** 影厅/场馆区域 */
  hall: string;
  /** 场次日期 YYYY-MM-DD */
  date: string;
  /** 场次日期文案（明天 10-10） */
  dateLabel: string;
  start: string;
  end: string;
  /** 座位（演唱会为票档名） */
  seats: string[];
  /** 取票号（4×4 数字分组） */
  ticketNo: string;
  unitPrice: number;
  /** 退款信息（票详情已退款态判定优先于时间） */
  refunded?: { amount: number; at: number };
  /** 核销入场时间（详情页「扫码入场」= 确认收货后写入；区分「已入场」与散场自动完成） */
  enteredAt?: number;
}

export interface TbOrderItem {
  pid: string;
  title: string;
  img: string;
  sku: Record<string, string>;
  /** 单价（下单时快照） */
  price: number;
  qty: number;
}

export interface TbOrder {
  id: string;
  /** 数据隔离 uid（订单归属的淘宝账号） */
  uid: string;
  shopId: string;
  shopName: string;
  items: TbOrderItem[];
  itemTotal: number;
  freight: number;
  /** 优惠总额（券抵扣含在内） */
  discount: number;
  couponId?: string;
  couponAmount?: number;
  /** 实付（pendingPay 时为应付） */
  total: number;
  /** 'wx' | 'qq'（pendingPay 为空） */
  payIdp?: 'wx' | 'qq';
  payChannelLabel?: string;
  payFc?: boolean;
  payMethodId?: string;
  payFcParts?: { cardInId: string; amount: number }[];
  address?: TbAddress;
  status: TbOrderStatus;
  createdAt: number;
  paidAt?: number;
  shipAt?: number;
  completedAt?: number;
  cancelReason?: string;
  /** 物流轨迹（发货后生成，新的在后） */
  track: { text: string; at: number }[];
  /** 退款信息 */
  refund?: { amount: number; reason: string; at: number };
  /** 用户评价（已完成提交） */
  review?: { rating: number; content: string; tags: string[]; at: number };
  /** 票务信息（有值 = 票务订单：无物流、无地址，卡/详情走票务渲染） */
  ticket?: TbTicketInfo;
  /** 找人代付（待支付时发起）：id = 代付请求（tb-proxy:<id>），name = 代付好友 */
  proxy?: { id: string; name: string };
  /** AI 取件联动（tb-ai-engage）：gift = 机主送的礼物（AI 到驿站自己去取）；
   *  favor = AI 答应帮机主取（聊天 [帮取快递] / 淘宝「找人帮取」分享）；取完由 watcher 清理 */
  aiPickup?: { contactId: string; contactName: string; app: 'wx' | 'qq'; kind: 'gift' | 'favor' };
  /** 主动代付参与标记（tbEngageTick：每单只主动问过一次，防噪） */
  aiAsked?: boolean;
  /** 已作为礼物送出（第七轮反馈：礼物页送出后从列表消失，不能再送第二次）；淘宝订单列表不受影响 */
  giftedAt?: number;
  /** 用户自建订单元数据（淘宝首页「创建订单」入库；有值 = 自建单：类型/优惠券/规格选项组） */
  custom?: OrderCustomMeta;
}

const orderKey = (uid: string) => `tb-orders:${uid}`;

/** 存量订单店铺自愈（修「买衣服显示零食铺子」）：首件商品品类与订单店铺 tag 不符时，
 *  纠正为品类归类店铺（AI 商品旧注册表随机挂店的存量单一次性收敛；找不到商品/票务单不动）
 *  + 旧数据字段兜底（track/items 缺失时补空数组——pendingPay 旧单可能没有 track，防 OrderCard/物流页读 length 崩溃） */
function healOrderShops(orders: TbOrder[]): { list: TbOrder[]; changed: boolean } {
  let changed = false;
  const list = orders.map((raw) => {
    let o = raw;
    if (!Array.isArray(o.track)) {
      o = { ...o, track: [] };
      changed = true;
    }
    if (!Array.isArray(o.items)) {
      o = { ...o, items: [] };
      changed = true;
    }
    const tag = o.items[0] ? productById(o.items[0].pid)?.tag : undefined;
    if (!tag) return o;
    const cur = TB_SHOPS.find((s) => s.id === o.shopId);
    if (cur?.tag === tag) return o;
    const shop = shopById(tbShopIdForTag(tag));
    if (shop.id === o.shopId) return o;
    changed = true;
    return { ...o, shopId: shop.id, shopName: shop.name };
  });
  return { list, changed };
}

export function tbLoadOrders(uid: string): TbOrder[] {
  const raw = load<TbOrder[]>(orderKey(uid), []);
  const { list, changed } = healOrderShops(raw);
  if (changed) save(orderKey(uid), list);
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

export function tbSaveOrders(uid: string, list: TbOrder[]): void {
  // 内存/存储上限（对齐美团 MAX_ORDERS=200）：订单是滚动窗口数据，保存时裁剪旧单
  // 防止长期使用后无界增长（每 10s tick 全量序列化写盘，数组越大写放大越重）
  const capped = list.length > 200 ? [...list].sort((a, b) => b.createdAt - a.createdAt).slice(0, 200) : list;
  save(orderKey(uid), capped);
}

export function tbOrderById(uid: string, id: string): TbOrder | undefined {
  return tbLoadOrders(uid).find((o) => o.id === id);
}

/**
 * 礼物卡真图实时解析（第十四轮）：礼物 image 是发出瞬间的快照——AI 自创宝贝的写真图
 * 生成较慢（数秒～数十秒），落库后卡片要能升级：AI 送（gift.id = `tb:商品id`）直接查
 * 商品图覆盖；订单送礼（gift.id = 订单 id）查首件商品的覆盖；无覆盖回退快照。
 */
export function tbGiftLiveImg(giftId: string, fallback: string): string {
  try {
    let pid = giftId.startsWith('tb:') ? giftId.slice(3) : '';
    if (!pid) {
      const s = tbGetSession();
      if (!s) return fallback;
      pid = tbOrderById(tbUidOf(s), giftId)?.items[0]?.pid ?? '';
    }
    if (!pid) return fallback;
    return tbProductImgOverride(pid) ?? fallback;
  } catch {
    return fallback;
  }
}

/** 标记订单已作为礼物送出（微信礼物页过滤用；幂等，已标记不重写）：
 *  当前登录淘宝账号下定位订单，找不到/未登录静默忽略（送礼链路不因存储异常阻断） */
export function tbMarkOrderGifted(orderId: string): void {
  try {
    const s = tbGetSession();
    if (!s) return;
    const uid = tbUidOf(s);
    const list = tbLoadOrders(uid);
    if (!list.some((o) => o.id === orderId && !o.giftedAt)) return;
    tbSaveOrders(
      uid,
      list.map((o) => (o.id === orderId && !o.giftedAt ? { ...o, giftedAt: Date.now() } : o)),
    );
  } catch {
    /* 忽略 */
  }
}

/** 包裹是否已到驿站（最后一节点 = 菜鸟驿站）：一键取件/AI 取件/分享卡确认收货的公共判定 */
export function tbArrivedAtStation(o: TbOrder | null | undefined): boolean {
  if (!o || o.status !== 'shipped' || o.track.length === 0) return false;
  return o.track[o.track.length - 1].text.includes('驿站');
}

// 状态机参数：待付款超时仍用固定 30min；发货/物流节奏改为「送达速度」驱动（下方 tbDeliveryTiming）
export const TB_PAY_TTL = 30 * 60_000; // 待付款 30min 超时自动取消
export const TB_TRACK_NODES = ['包裹已由商家揽收', '运输中：包裹已到达【杭州转运中心】', '派送中：快递员正在为您派送', '包裹已放入菜鸟驿站，请凭取件码领取'];

/** 送达速度（第四十二轮：淘宝独立小时级——
 *  快的 30 分钟-1 小时送达、正常 1-2 小时、慢的 3-4 小时，另支持自定义区间；
 *  存储在 delivery-speed.ts 按 App 分键（delivery-speed:taobao，与美团互不影响），
 *  选择器为「我的淘宝 › 送达速度」行点击弹毛玻璃弹窗；
 *  全店订单（新单/在途单/生成历史单）统一跟随） */
export type TbDeliverySpeed = 'fast' | 'normal' | 'slow' | 'custom';
export const TB_SPEED_ORDER: TbDeliverySpeed[] = ['fast', 'normal', 'slow', 'custom'];
export const TB_SPEED_LABEL: Record<TbDeliverySpeed, string> = { fast: '快', normal: '正常', slow: '慢', custom: '自定义' };

/** 读送达速度档位（淘宝独立设置，uid 参数保留兼容旧调用点） */
export function tbGetDeliverySpeed(_uid: string): TbDeliverySpeed {
  return dsGet('taobao').preset;
}

/** 当前速度的动态文案（如「30分钟-1小时送达」，custom 时显示自定义区间） */
export function tbSpeedDescText(): string {
  return dsDesc('taobao');
}

/** 兼容旧签名：写三档档位（custom 请直接用 delivery-speed.ts 的 dsSet('taobao', …)） */
export function tbSetDeliverySpeed(_uid: string, speed: 'fast' | 'normal' | 'slow'): void {
  const r = DS_RANGES.taobao[speed];
  dsSet('taobao', { preset: speed, min: r.min, max: r.max });
}

/** 速度 → 时间参数（全真实时钟，第四十二轮改淘宝小时级窗口 + 自定义区间）：
 *  total = 付款→送达总时长（在当前速度区间内按订单哈希抖动，跟随淘宝送达速度）；
 *  shipDelay = 付款→发货（按总时长等比 12%，夹在 2 分钟~40 分钟，小时级下也能先发货）；
 *  trackStep = 相邻物流节点间隔（4 节点走完即送达） */
export function tbDeliveryTiming(
  _uid: string,
  seed: string
): { totalMs: number; shipDelayMs: number; trackStepMs: number } {
  const totalMs = dsMinutesFor(seed, 'taobao') * 60_000;
  const shipDelayMs = Math.min(40 * 60_000, Math.max(2 * 60_000, Math.round(totalMs * 0.12)));
  const trackStepMs = Math.max(30_000, Math.round((totalMs - shipDelayMs) / TB_TRACK_NODES.length));
  return { totalMs, shipDelayMs, trackStepMs };
}

/** 下单（购物车结算 / 立即购买共用）：创建待付款订单 */
export function tbCreateOrder(opts: {
  uid: string;
  items: TbOrderItem[];
  address?: TbAddress;
  couponId?: string;
  couponAmount?: number;
}): TbOrder {
  const { uid, items, address, couponId, couponAmount } = opts;
  const itemTotal = Math.round(items.reduce((n, it) => n + it.price * it.qty, 0) * 100) / 100;
  const freight = items.reduce((n, it) => {
    const p = productById(it.pid);
    return n + (p?.freight ?? 0);
  }, 0);
  const discount = Math.round((couponAmount ?? 0) * 100) / 100;
  const total = Math.round((itemTotal + freight - discount) * 100) / 100;
  const shopIds = Array.from(new Set(items.map((it) => productById(it.pid)?.shopId ?? '')));
  // 自建商品订单：custom 元数据（类型/优惠券名/规格选项组）随首个自建商品快照进订单（列表「自建·类型」角标/详情展示）
  const custom = items.map((it) => productById(it.pid)?.custom).find(Boolean);
  const order: TbOrder = {
    id: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    uid,
    shopId: shopIds[0] ?? '',
    shopName: shopIds[0] ? shopById(shopIds[0]).name : '淘宝好店',
    items,
    itemTotal,
    freight,
    discount,
    couponId,
    couponAmount,
    total: Math.max(0, total),
    address,
    status: 'pendingPay',
    createdAt: Date.now(),
    track: [],
    ...(custom ? { custom } : {}),
  };
  const list = tbLoadOrders(uid);
  list.unshift(order);
  tbSaveOrders(uid, list);
  return order;
}

/** 取票号（4×4 数字分组：3353 8086 1298 6080 口径，确定性派生自订单号） */
function ticketNoOf(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const digits: string[] = [];
  for (let i = 0; i < 16; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    digits.push(String((h >>> 0) % 10));
  }
  return digits.join('').replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** 票务下单（淘票票电影/喜剧脱口秀/演唱会共用）：
 *  需求——确认选座/选票不再直接出票，先创建 pendingPay 待付款订单（票务信息照挂），
 *  由根组件拉起淘宝收银台，用户点支付后才扣款出票（tbMarkPaid 对票务单直接 shipped）。
 *  待付款票务单可取消（tbCancelOrder）/超时自动取消（tbTickOrders），无物流不写 track */
export function tbCreateTicketOrder(
  uid: string,
  t: Omit<TbTicketInfo, 'ticketNo'>,
  opts?: { total?: number }
): TbOrder {
  const total = opts?.total ?? Math.round(t.unitPrice * t.qty * 100) / 100;
  const order: TbOrder = {
    id: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    uid,
    shopId: '',
    shopName: '淘票票',
    items: [
      {
        pid: `ticket-${t.kind}-${t.title}`,
        title: t.title,
        img: '',
        sku: {},
        price: t.unitPrice,
        qty: t.qty,
      },
    ],
    itemTotal: total,
    freight: 0,
    discount: 0,
    total,
    status: 'pendingPay',
    createdAt: Date.now(),
    track: [],
    ticket: { ...t, ticketNo: '' },
  };
  order.ticket!.ticketNo = ticketNoOf(order.id);
  const list = tbLoadOrders(uid);
  list.unshift(order);
  tbSaveOrders(uid, list);
  return order;
}

/** 淘票票周边商城下单（实体货走正常待付款→发货→物流链路） */
export function tbCreateMerchOrder(uid: string, m: { id: string; title: string; tag: string; price: number }, qty: number): TbOrder {
  const items: TbOrderItem[] = [
    { pid: `merch-${m.id}`, title: m.title, img: tbImg(m.tag, 300, 300), sku: { 类型: '官方周边' }, price: m.price, qty },
  ];
  const itemTotal = Math.round(m.price * qty * 100) / 100;
  const order: TbOrder = {
    id: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    uid,
    shopId: '',
    shopName: '淘票票周边商城',
    items,
    itemTotal,
    freight: 0,
    discount: 0,
    total: itemTotal,
    address: tbCurAddr(uid) ?? undefined,
    status: 'pendingPay',
    createdAt: Date.now(),
    track: [],
  };
  const list = tbLoadOrders(uid);
  list.unshift(order);
  tbSaveOrders(uid, list);
  return order;
}

/** 状态推进 catch-up：全局 tick 与打开 App 时都调用（确定性时间戳，重启不丢进度）；
 *  发货/物流节奏跟随「送达速度」设置（真实时钟：快 30min-1h / 正常 1-3h / 慢 3-6h 送达） */
export function tbTickOrders(uid: string): boolean {
  let changed = false;
  let ttlCancelled = false;
  const list = tbLoadOrders(uid);
  const now = Date.now();
  for (const o of list) {
    // 票务订单：散场（end 时间过）自动完成（详情页已同步切换「电影已放映」）
    if (o.ticket && o.status === 'shipped') {
      const endAt = new Date(`${o.ticket.date}T${o.ticket.end}:00`).getTime();
      if (Number.isFinite(endAt) && now > endAt) {
        o.status = 'completed';
        o.completedAt = now;
        changed = true;
      }
      continue;
    }
    if (o.status === 'pendingPay' && now - o.createdAt > TB_PAY_TTL) {
      o.status = 'cancelled';
      o.cancelReason = '超时未付款，订单自动取消';
      changed = true;
      ttlCancelled = true;
      continue;
    }
    // 发货/物流：按当前送达速度重算时间轴（切换速度后在途单自动跟随新节奏）
    const timing = tbDeliveryTiming(uid, o.id);
    if (o.status === 'pendingDeliver' && o.paidAt && now - o.paidAt > timing.shipDelayMs) {
      o.status = 'shipped';
      o.shipAt = o.paidAt + timing.shipDelayMs;
      o.track = [{ text: TB_TRACK_NODES[0], at: o.shipAt }];
      changed = true;
      continue;
    }
    if (o.status === 'shipped' && o.shipAt) {
      // 物流节点逐步推进（全部节点走完即「已到驿站」可确认收货）；节点时间锚定发货时间，重启不漂移
      const elapsed = now - o.shipAt;
      const nodeCount = Math.min(TB_TRACK_NODES.length, 1 + Math.floor(elapsed / timing.trackStepMs));
      if (o.track.length < nodeCount) {
        o.track = TB_TRACK_NODES.slice(0, nodeCount).map((text, i) => ({ text, at: o.shipAt! + (i + 1) * timing.trackStepMs }));
        changed = true;
      }
    }
  }
  if (changed) tbSaveOrders(uid, list);
  if (ttlCancelled) {
    // B4 联动：待付款超时自动取消 → 挂着的 pending 代付请求同步置 expired
    //（防残留 pending 请求继续占用 proxyOrderIds；动态 import 防循环依赖，与 tbCancelOrder 同口径）
    void import('./tb-share-proxy')
      .then((m) => m.tbSyncProxiesForUid(uid))
      .catch(() => undefined);
  }
  return changed;
}

/** 状态中文（订单卡/详情/消息页统一口径）；
 *  shipped 详情页标题用「已发货」——与订单卡右上动态状态一致（用户：点「已发货」卡片
 *  要进入对应状态的已发货详情页，页面标题不能再写「待收货」造成两个界面） */
export function tbStatusText(o: TbOrder): string {
  switch (o.status) {
    case 'pendingPay':
      return '待付款';
    case 'pendingDeliver':
      return '待发货';
    case 'shipped':
      return '已发货';
    case 'completed':
      return '已完成';
    case 'cancelled':
      return o.refund ? '退款成功' : '已取消';
  }
}

/** 确认收货（fromAi=true 时不再触发跨 App 联动——AI 帮取件场景自己会在聊天里报喜） */
export function tbConfirmReceive(uid: string, id: string, opts?: { fromAi?: boolean }): boolean {
  const o = tbOrderById(uid, id);
  if (!o || o.status !== 'shipped') return false;
  const list = tbLoadOrders(uid);
  const hit = list.find((x) => x.id === id);
  if (!hit) return false;
  hit.status = 'completed';
  hit.completedAt = Date.now();
  // 票务单：确认收货 = 扫码入场核销（写 enteredAt，票详情/分享卡区分「已入场」与散场自动完成）
  if (hit.ticket && !hit.ticket.enteredAt) hit.ticket.enteredAt = hit.completedAt;
  tbSaveOrders(uid, list);
  // 第十六轮：跨 App 联动——快递签收 → 恋人 AI 主动到微信/QQ 聊天里聊起
  //（动态 import 防环，与 tbCancelReceive/tbCancelOrder 的 tb-share-proxy 模式一致；fireProactiveNudge 幂等键含订单号）
  if (!opts?.fromAi) {
    void import('./cross-app-nudge')
      .then((m) => m.tbOrderArrivedNudge(hit))
      .catch(() => undefined);
  }
  return true;
}

/**
 * AI 代买直送（第 22 轮，用户：AI 买东西不用等发货，挑好直接送到手上）：
 * AI 代买的订单付款成功后立即跳过物流链路（待发货→已发货→驿站→取件），直接置为已完成。
 * 已完成/已取消的单不动；track 补一条直送节点防物流页空轨迹。
 */
export function tbInstantCompleteAiOrder(uid: string, id: string): boolean {
  const list = tbLoadOrders(uid);
  const hit = list.find((x) => x.id === id);
  if (!hit || hit.status === 'completed' || hit.status === 'cancelled') return false;
  const now = Date.now();
  hit.status = 'completed';
  hit.paidAt = hit.paidAt ?? now;
  hit.shipAt = hit.shipAt ?? now;
  hit.completedAt = now;
  if (hit.track.length === 0) hit.track = [{ text: '宝贝已由好友直接送到你手上', at: now }];
  tbSaveOrders(uid, list);
  return true;
}

/** 取消订单（仅待付款） */
export function tbCancelOrder(uid: string, id: string, reason: string): boolean {
  const o = tbOrderById(uid, id);
  if (!o || o.status !== 'pendingPay') return false;
  const list = tbLoadOrders(uid);
  const hit = list.find((x) => x.id === id);
  if (!hit) return false;
  hit.status = 'cancelled';
  hit.cancelReason = reason;
  tbSaveOrders(uid, list);
  // B4：订单取消 → 挂着的 pending 代付请求同步失效（动态 import 防与 tb-share-proxy 循环依赖）
  void import('./tb-share-proxy')
    .then((m) => m.tbSyncProxiesForUid(uid))
    .catch(() => undefined);
  return true;
}

/** 标记退款（taobao-pay 原路退回成功后调用）；票务单同步写 ticket.refunded（票详情已退款态） */
export function tbMarkRefund(uid: string, id: string, amount: number, reason: string): boolean {
  const list = tbLoadOrders(uid);
  const hit = list.find((x) => x.id === id);
  if (!hit) return false;
  hit.status = 'cancelled';
  hit.refund = { amount, reason, at: Date.now() };
  if (hit.ticket && !hit.ticket.refunded) hit.ticket.refunded = { amount, at: Date.now() };
  tbSaveOrders(uid, list);
  return true;
}

/** 删除订单（交易关闭/已取消详情「删除订单」按钮）：从订单列表移除 */
export function tbDeleteOrder(uid: string, id: string): boolean {
  const list = tbLoadOrders(uid);
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  tbSaveOrders(uid, next);
  return true;
}

/** 提交评价 */
export function tbSubmitReview(uid: string, id: string, rating: number, content: string, tags: string[]): boolean {
  const list = tbLoadOrders(uid);
  const hit = list.find((x) => x.id === id);
  if (!hit || hit.status !== 'completed' || hit.review) return false;
  hit.review = { rating, content, tags, at: Date.now() };
  tbSaveOrders(uid, list);
  return true;
}

/** 支付成功落账：pendingPay → pendingDeliver（payInfo 由 taobao-pay 写入）；
 *  票务单例外：付款即出票，直接 pendingPay → shipped（已出票待入场，无发货/物流环节） */
export function tbMarkPaid(
  uid: string,
  id: string,
  pay: { payIdp: 'wx' | 'qq'; payChannelLabel: string; payMethodId: string; payFc?: boolean; payFcParts?: { cardInId: string; amount: number }[] }
): boolean {
  const list = tbLoadOrders(uid);
  const hit = list.find((x) => x.id === id);
  if (!hit || hit.status !== 'pendingPay') return false;
  hit.status = hit.ticket ? 'shipped' : 'pendingDeliver';
  hit.paidAt = Date.now();
  if (hit.ticket) hit.shipAt = hit.paidAt; // 票务单出票时刻（不产 track，仅作时间线锚点）
  hit.payIdp = pay.payIdp;
  hit.payChannelLabel = pay.payChannelLabel;
  hit.payMethodId = pay.payMethodId;
  hit.payFc = pay.payFc;
  hit.payFcParts = pay.payFcParts;
  tbSaveOrders(uid, list);
  // B4：机主直接付掉 → 该单挂着的 pending 代付请求同步失效（动态 import 防循环依赖）
  void import('./tb-share-proxy')
    .then((m) => m.tbSyncProxiesForUid(uid))
    .catch(() => undefined);
  return true;
}

// ---------------- 历史订单无限生成（需求「淘宝订单上滑/下滑刷新生成」） ----------------
//
// - 下拉刷新出「最近的新单」、上滑到底加载「更早的历史单」，本地确定性生成（同批次同结果）；
// - 商品经 tbGenProducts 全品类生成器产出（品牌/型号/类型多样化，图片与商品一致必有图）；
// - 生成订单直接写入真实订单存储（按 createdAt 归位排序），详情/评价/退款/再买一单全链路复用；
// - 首件标题去重：跨批、与存量订单绝不重复（需求「订单上面和下面有一样的」根治）。

/** mulberry32：seed → 确定性伪随机序列（与 tb-product-gen 同款） */
function tbRngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tbHashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/** 订单去重 key（店铺名|首件标题） */
export function tbGenOrderKey(o: Pick<TbOrder, 'shopName' | 'items'>): string {
  return `${o.shopName}|${o.items[0]?.title ?? ''}`;
}

/** AI/本地生成条目 → TbOrder：所有时间锚定真实时钟、按送达速度展开——
 *  待发货单创建于发货倒计时内、已发货单在途若干节点、已完成单已送达（此前过去 N 天改为过去 N×8 小时，
 *  日期显示与真实推进一致）；daysAgo 仅作确定性散布种子与去重 id 成分，不再代表真实天数 */
export function tbBuildGenOrder(
  uid: string,
  raw: {
    shopName?: string;
    shopId?: string;
    itemTitle: string;
    tag: string;
    skuText?: string;
    price: number;
    qty?: number;
    daysAgo: number;
    canceled?: boolean;
  },
  idx = 0
): TbOrder {
  const qty = Math.max(1, Math.round(raw.qty ?? 1));
  const price = Math.max(0.01, Math.round(raw.price * 100) / 100);
  const now = Date.now();
  // 店铺按品类就近归类（修「买衣服显示零食铺子」：AI 给的 tag 无同 tag 店铺时不再随机乱挂）
  const shop = shopById(tbShopIdForTag(raw.tag, tbHashStr(raw.itemTitle)));
  // 外部给的店铺名/id：仅当其指向的店铺与商品品类同 tag 时才采纳（AI 随手编的错位店名一律弃用）
  const namedShop = raw.shopId
    ? shopById(raw.shopId)
    : raw.shopName && raw.shopName.trim() !== ''
      ? TB_SHOPS.find((s) => s.name === raw.shopName!.trim().slice(0, 14))
      : undefined;
  const useShop = namedShop && namedShop.tag === shop.tag ? namedShop : shop;
  const canceled = raw.canceled === true;
  const r = tbRngFrom(tbHashStr(`${raw.itemTitle}|st`));
  const roll = r();
  const status: TbOrderStatus = canceled ? 'cancelled' : roll < 0.42 ? 'shipped' : roll < 0.9 ? 'completed' : 'pendingDeliver';
  // 送达速度时间轴（真实时钟）
  const timing = tbDeliveryTiming(uid, raw.itemTitle);
  const { shipDelayMs, trackStepMs, totalMs } = timing;
  // 各状态相对 now 的下单时刻（小时级散布，daysAgo×8h 往前推——老批次更早但仍在真实时间轴上）
  const back = raw.daysAgo * 8 * 3_600_000;
  let createdAt: number;
  let paidAt: number | undefined;
  let shipAt: number | undefined;
  let completedAt: number | undefined;
  let track: { text: string; at: number }[] = [];
  if (canceled) {
    createdAt = now - back - 30 * 60_000;
  } else if (status === 'pendingDeliver') {
    // 刚拍下不久：仍在发货倒计时内（时间随速度）
    createdAt = now - Math.max(60_000, Math.round(shipDelayMs * (0.15 + r() * 0.6)));
    paidAt = createdAt + Math.min(2 * 60_000, Math.round((now - createdAt) * 0.5));
  } else if (status === 'shipped') {
    // 在途：已发 1-3 个节点
    const nodes = 1 + Math.floor(r() * 2.99);
    createdAt = now - shipDelayMs - Math.round(nodes * trackStepMs * (0.55 + r() * 0.35));
    paidAt = createdAt + 2 * 60_000;
    shipAt = paidAt + shipDelayMs;
    track = TB_TRACK_NODES.slice(0, nodes).map((text, i) => ({ text, at: shipAt! + (i + 1) * trackStepMs }));
  } else {
    // 已完成：整个配送窗走完后再过一段（小时级真实散布）
    createdAt = now - totalMs - back;
    paidAt = createdAt + 2 * 60_000;
    shipAt = paidAt + shipDelayMs;
    completedAt = shipAt + totalMs - shipDelayMs;
    track = TB_TRACK_NODES.map((text, i) => ({ text, at: shipAt! + (i + 1) * trackStepMs }));
  }
  // skuText「颜色分类：曜金黑；存储容量：16GB+512G」→ { 颜色分类: 曜金黑, 存储容量: 16GB+512G }
  const sku: Record<string, string> = {};
  for (const seg of (raw.skuText ?? '').split(/[；;]/)) {
    const [k, ...rest] = seg.split('：');
    const v = rest.join('：').trim();
    if (k?.trim() && v) sku[k.trim()] = v;
  }
  const total = Math.round(price * qty * 100) / 100;
  return {
    id: `tbg${tbHashStr(`${raw.itemTitle}|${raw.daysAgo}`).toString(36)}${idx}`,
    uid,
    shopId: useShop.id,
    shopName: useShop.name,
    items: [{ pid: `gen-${tbHashStr(raw.itemTitle).toString(36)}`, title: raw.itemTitle, img: tbImg(raw.tag, 300, 300, 0), sku, price, qty }],
    itemTotal: total,
    freight: 0,
    discount: 0,
    total,
    address: undefined,
    status,
    createdAt,
    paidAt,
    shipAt,
    completedAt,
    cancelReason: canceled ? '不想要了/多拍/拍错' : undefined,
    track,
  };
}

/** 第 batch 批本地历史订单（tbGenProducts 全品类产出，一批 2 条，跨批去重） */
export function tbGenHistoryOrders(uid: string, batch: number, excludeTitles: string[]): TbOrder[] {
  const seed = (tbHashStr('tb-gen-orders') ^ Math.imul(batch + 1, 2654435761)) >>> 0;
  const products = tbGenProducts(seed, 2, { idPrefix: `tbg-${batch}`, excludeTitles });
  const ex = new Set(excludeTitles);
  const out: TbOrder[] = [];
  products.forEach((p, i) => {
    if (ex.has(p.title)) return;
    ex.add(p.title);
    const sku: Record<string, string> = {};
    for (const g of p.skus) {
      if (g.options.length > 0 && !g.options[0].soldOut) sku[g.name] = g.options[0].label;
    }
    const r = tbRngFrom(seed + i * 97);
    out.push(
      tbBuildGenOrder(
        uid,
        {
          shopId: p.shopId,
          itemTitle: p.title,
          tag: p.tag,
          skuText: Object.entries(sku)
            .map(([k, v]) => `${k}：${v}`)
            .join('；'),
          price: p.price,
          qty: 1,
          daysAgo: 2 + batch * 4 + Math.floor(r() * 3),
          canceled: r() < 0.08,
        },
        i
      )
    );
  });
  return out;
}

/** 生成订单入库（按 createdAt 归位去重，不覆盖用户真实订单；返回实际新增条数）
 *  同时对存量做同 key 去重（保留最新一条）——根治「订单上面和下面有的一样」 */
export function tbInsertGenOrders(uid: string, batch: TbOrder[]): number {
  const list = tbLoadOrders(uid);
  const exKeys = new Set(list.map(tbGenOrderKey));
  const exIds = new Set(list.map((o) => o.id));
  const fresh = batch.filter((o) => !exIds.has(o.id) && !exKeys.has(tbGenOrderKey(o)));
  if (fresh.length === 0) return 0;
  // 存量+新单合并去重（list 已按时间倒序，同 key 保留第一条即最新），根治「订单上下重复」
  const seen = new Set<string>();
  const deduped = [...fresh, ...list].filter((o) => {
    const k = tbGenOrderKey(o);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  tbSaveOrders(uid, deduped.sort((a, b) => b.createdAt - a.createdAt));
  return fresh.length;
}

/** 现有订单去重素材（生成前传入防重复） */
export function tbExistingOrderTitles(uid: string): string[] {
  return tbLoadOrders(uid).map((o) => o.items[0]?.title ?? '').filter(Boolean);
}

// ---------------- 站内消息（交易物流 / 售后保障） ----------------

export interface TbMsg {
  id: string;
  /** 'logistics' 交易物流 | 'refund' 售后保障 */
  kind: 'logistics' | 'refund';
  title: string;
  text: string;
  at: number;
  /** 关联订单（点击跳订单详情） */
  orderId?: string;
}

const msgKey = (uid: string) => `tb-msgs:${uid}`;

export function tbLoadMsgs(uid: string): TbMsg[] {
  return load<TbMsg[]>(msgKey(uid), []).sort((a, b) => b.at - a.at);
}

export function tbPushMsg(uid: string, m: Omit<TbMsg, 'id' | 'at'>): void {
  const list = load<TbMsg[]>(msgKey(uid), []);
  list.push({ ...m, id: `tbm${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`, at: Date.now() });
  // 上限 500 条（客服消息滚动窗口）：防止长期对话无界增长
  save(msgKey(uid), list.length > 500 ? list.slice(-500) : list);
}

/** 未读口径：消息时间晚于已读时间戳即未读（「消息-清除未读」用） */
const msgReadKey = (uid: string) => `tb-msgs-read:${uid}`;

export function tbMsgsReadAt(uid: string): number {
  return load<number>(msgReadKey(uid), 0);
}

export function tbSetMsgsReadAt(uid: string, ts: number): void {
  save(msgReadKey(uid), ts);
}

export function tbMsgUnreadCount(uid: string): number {
  const r = tbMsgsReadAt(uid);
  return tbLoadMsgs(uid).filter((m) => m.at > r).length;
}

// ---------------- 全局状态推进 tick ----------------

let tickTimer: ReturnType<typeof setInterval> | null = null;

/** 全局订单推进（App 挂载时启动一次）：每 10s catch-up 所有已登录账号；
 *  推进后接力 tbEngageTick（AI 取件/主动代付等联动，动态 import 防循环依赖）。
 *  性能：页面不可见时跳过（订单按时间戳 catch-up，回前台一拍即补齐；避免后台标签页
 *  每 10s 白白全量序列化订单表抢主线程） */
export function tbStartOrderWatcher(): void {
  if (tickTimer || typeof window === 'undefined') return;
  tickTimer = setInterval(() => {
    try {
      if (document.hidden) return;
      const s = tbGetSession();
      if (!s) return;
      const uid = tbUidOf(s);
      tbTickOrders(uid);
      void import('./tb-ai-engage')
        .then((m) => m.tbEngageTick(uid))
        .catch(() => undefined);
    } catch {
      /* 静默 */
    }
  }, 10_000);
}

// ---------------- 商品口径辅助 ----------------

/** 商品主图（首图，s 取变体） */
export function tbMainImg(p: TbProduct, s = 0): string {
  // 自建商品优先用自有主图（上传/AI 生成），无图走品类图兜底
  return p.img ?? tbImg(p.tag, 600, 600, s);
}

// ---------------- 自建商品持久化（第三十六轮：创建订单=创建商品，按账号隔离） ----------------
// 「创建订单」保存的是商品（tbc-p-* 商品 + tbc-s-* 自建店铺），持久化在此；
// 进 App 恢复注册进 taobao-data 自建商品注册表 → 首页「我的商品」区展示，
// 点击走商品详情/SKU/购物车/结算原生链路真实下单。

const customProductsKey = (uid: string) => `tb-custom-products:${uid}`;

export interface TbCustomEntry {
  p: TbProduct;
  shop: TbShop;
}

/** 读当前账号的自建商品（无则空数组；容错过滤残缺数据） */
export function tbLoadCustomProducts(uid: string): TbCustomEntry[] {
  const list = kvGet<Partial<TbCustomEntry>[]>(customProductsKey(uid));
  if (!Array.isArray(list)) return [];
  return list.filter(
    (e): e is TbCustomEntry =>
      Boolean(e) &&
      typeof e.p?.id === 'string' &&
      e.p.id.startsWith('tbc-') &&
      typeof e.p.title === 'string' &&
      typeof e.p.price === 'number' &&
      typeof e.shop?.id === 'string' &&
      typeof e.shop.name === 'string'
  );
}

/** 写当前账号的自建商品（全量覆盖），并同步注册进运行时注册表（保存后首页立即可见） */
export function tbSaveCustomProducts(uid: string, list: TbCustomEntry[]): void {
  kvSet(customProductsKey(uid), list);
  for (const e of list) tbRegisterCustomProduct(e.p, e.shop);
}

/** 删除单个自建商品（落库 + 注销运行时注册表） */
export function tbRemoveCustomProduct(uid: string, id: string): void {
  tbSaveCustomProducts(
    uid,
    tbLoadCustomProducts(uid).filter((e) => e.p.id !== id)
  );
  tbUnregisterCustomProduct(id);
}

/** 商品详情评价（种子 3 条 + 订单晒单评价聚合在 UI 层做） */
export function tbSeedReviews(pid: string) {
  return tbReviewsOf(pid);
}
