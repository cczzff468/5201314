'use client';

/**
 * 美团「订单分享」跨 App 链路（订单详情右上角分享 → 微信/QQ → 选好友 → 动态订单卡片进聊天）：
 * - 发起：订单详情（待支付/进行中/配送中/已完成）点分享 → 选平台+联系人 → 生成分享快照
 *   （IDB kv `mt-share:<sid>`，全局键不按美团 uid 隔离——聊天侧按 sid 取）→ 卡片消息写入该
 *   联系人聊天消息流（wx-chat-msgs:/qq-chat-msgs:，与代付卡同机制）→ 广播 MT_SHARE_CARD_EVENT；
 * - 动态卡片：卡片只存快照（商品/金额/商家），状态时间线每次渲染按 uid+orderId 实时读订单
 *   statusLog 推导（提交订单→待商家接单→商家已接单→骑手已接单·骑手名→已送达），订单推进时
 *   卡片自动跟随（监听 mt-orders-changed + 逐秒 tick）。
 */
import { kvGet, kvSet } from './idb-kv';
import { getContact } from './contacts-store';
import { avatarFor, displayNameOf, isFriendIn, type ContactRecord } from '../contacts';
import { mtLoadOrders, type MtOrder } from './meituan-store';

// ---------------- 数据模型 ----------------

export interface MtShareItem {
  name: string;
  qty: number;
  price: number;
  spec?: string;
  emoji?: string;
  img?: string;
  /** 菜品 id（第十四轮：分享卡渲染时用它实时解析 AI 自创菜的真图覆盖） */
  dishId?: string;
}

/** 订单分享快照（静态部分；状态时间线动态推导，不入快照） */
export interface MtOrderShare {
  id: string;
  /** 下单人的美团账号 uid（mt-orders:<uid> 定位订单用） */
  uid: string;
  orderId: string;
  /** 分享渠道平台 */
  idp: 'wx' | 'qq';
  /** 好友（联系人） */
  contactId: string;
  contactName: string;
  contactAvatar: string | null;
  /** 分享人（美团登录账号本人） */
  fromName: string;
  merchantName: string;
  merchantEmoji: string;
  merchantImg?: string;
  amount: number;
  itemCount: number;
  items: MtShareItem[];
  note?: string;
  createdAt: number;
  /** 付款人名（AI 请客代付时 = 角色名；卡片角标显示「X已买单」；普通分享无此字段） */
  paidBy?: string;
}

/** 聊天里的订单分享卡片消息（微信 WxMsg / QQ QQMsg 同构，kind='mtshare'） */
export interface MtShareCardMsg {
  id: string;
  role: 'me' | 'peer';
  content: string;
  time: number;
  kind: 'mtshare';
  mtshare: { sid: string };
}

/** 卡片落库广播（聊天页在场时监听实时合并，与 MT_PROXY_CARD_EVENT 同机制） */
export const MT_SHARE_CARD_EVENT = 'mt-share-card-inserted';

function genSid(): string {
  return `mtsh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function genMsgId(): string {
  return `mtshm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 读取分享快照（容错规范化） */
export function mtGetShare(sid: string): MtOrderShare | null {
  if (!sid) return null;
  const s = kvGet<Partial<MtOrderShare>>(`mt-share:${sid}`);
  if (!s || typeof s !== 'object' || typeof s.id !== 'string' || typeof s.orderId !== 'string') return null;
  return {
    ...s,
    id: s.id,
    uid: typeof s.uid === 'string' ? s.uid : '',
    orderId: s.orderId,
    idp: s.idp === 'qq' ? 'qq' : 'wx',
    contactId: typeof s.contactId === 'string' ? s.contactId : '',
    contactName: typeof s.contactName === 'string' ? s.contactName : '好友',
    contactAvatar: typeof s.contactAvatar === 'string' ? s.contactAvatar : null,
    fromName: typeof s.fromName === 'string' ? s.fromName : '我',
    merchantName: typeof s.merchantName === 'string' ? s.merchantName : '美团商家',
    merchantEmoji: typeof s.merchantEmoji === 'string' ? s.merchantEmoji : '🍜',
    merchantImg: typeof s.merchantImg === 'string' ? s.merchantImg : undefined,
    amount: typeof s.amount === 'number' ? s.amount : 0,
    itemCount: typeof s.itemCount === 'number' ? s.itemCount : 0,
    items: Array.isArray(s.items)
      ? (s.items as MtShareItem[]).filter((i) => i && typeof i.name === 'string').map((i) => ({
          name: i.name,
          qty: typeof i.qty === 'number' ? i.qty : 1,
          price: typeof i.price === 'number' ? i.price : 0,
          spec: typeof i.spec === 'string' && i.spec ? i.spec : undefined,
          emoji: typeof i.emoji === 'string' ? i.emoji : undefined,
          img: typeof i.img === 'string' ? i.img : undefined,
          dishId: typeof i.dishId === 'string' && i.dishId ? i.dishId : undefined,
        }))
      : [],
    note: typeof s.note === 'string' && s.note ? s.note : undefined,
    createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
    paidBy: typeof s.paidBy === 'string' && s.paidBy ? s.paidBy : undefined,
  };
}

// ---------------- 动态状态时间线（卡片核心：跟真实订单 statusLog 走） ----------------

export interface MtShareStage {
  key: 'submit' | 'paid' | 'accepted' | 'delivering' | 'completed';
  label: string;
  /** 到达时刻（未到达 undefined） */
  at?: number;
  /** 骑手已接单阶段附骑手名 */
  riderName?: string;
}

/** 五段动态时间线：提交订单 → 待商家接单 → 商家已接单 → 骑手已接单（骑手名）→ 已送达 */
export function mtShareStagesOf(order: MtOrder | null): MtShareStage[] {
  const logAt = (st: string): number | undefined => order?.statusLog.find((s) => s.status === st)?.at;
  const stages: MtShareStage[] = [
    { key: 'submit', label: '提交订单', at: order?.createdAt },
    { key: 'paid', label: '待商家接单', at: order ? (logAt('pendingAccept') ?? order.paidAt) : undefined },
    { key: 'accepted', label: '商家已接单', at: logAt('accepted') },
    { key: 'delivering', label: '骑手已接单', at: logAt('delivering'), riderName: order?.riderName },
    { key: 'completed', label: '已送达', at: logAt('completed') },
  ];
  // 待支付单：paidAt 未落 →「待商家接单」视为未到达（保持等待态）
  if (order && !order.paidAt) stages[1].at = undefined;
  return stages;
}

/** 快照对应的实时订单（订单被清理时返回 null，卡片按已提交展示） */
export function mtShareOrderOf(share: MtOrderShare): MtOrder | null {
  try {
    return mtLoadOrders(share.uid).find((o) => o.id === share.orderId) ?? null;
  } catch {
    return null;
  }
}

// ---------------- 发起分享 ----------------

export interface MtCreateShareOpts {
  order: MtOrder;
  idp: 'wx' | 'qq';
  contactId: string;
  fromName: string;
  /** 卡片方向（缺省 'me'）：'peer' = AI 角色发给机主（请客代付场景），箭头指左 */
  role?: 'me' | 'peer';
  /** 卡片回退文案（缺省「分享一个xx的订单」） */
  content?: string;
  /** 付款人名（AI 请客代付；卡片角标「X已买单」+ AI 历史序列化用） */
  paidBy?: string;
}

export type MtCreateShareResult = { ok: true; share: MtOrderShare } | { ok: false; error: string };

function insertShareCard(idp: 'wx' | 'qq', contactId: string, msg: MtShareCardMsg): void {
  const key = `${idp === 'wx' ? 'wx' : 'qq'}-chat-msgs:${contactId}`;
  try {
    const cur = kvGet<unknown[]>(key) ?? [];
    kvSet(key, [...cur, msg]); // 聊天记录不封顶（此前截 100 条会把旧记录挤丢）
  } catch {
    /* 落库失败静默 */
  }
  try {
    window.dispatchEvent(new CustomEvent(MT_SHARE_CARD_EVENT, { detail: { cid: contactId, app: idp } }));
  } catch {
    /* 广播失败不影响落库 */
  }
}

/** 平台通知 App 名（AI 请客卡灵动岛通知用） */
export function mtShareNotifyApp(idp: 'wx' | 'qq'): 'wechat' | 'qq' {
  return idp === 'wx' ? 'wechat' : 'qq';
}

/**
 * 发起订单分享：生成快照 + 动态卡片进好友聊天（我发给好友）。
 * 同一订单同一好友 30 秒内防重复连发；好友必须存在且为该平台好友。
 */
export async function mtCreateOrderShare(opts: MtCreateShareOpts): Promise<MtCreateShareResult> {
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

  const share: MtOrderShare = {
    id: genSid(),
    uid: order.uid,
    orderId: order.id,
    idp,
    contactId,
    contactName: displayNameOf(contact),
    contactAvatar: avatarFor(contact, idp),
    fromName,
    merchantName: order.merchantName,
    merchantEmoji: order.merchantEmoji,
    merchantImg: order.merchantImg,
    amount: order.total,
    itemCount: order.items.reduce((s, i) => s + i.qty, 0),
    items: order.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price, spec: i.spec, emoji: i.emoji, img: i.img, dishId: i.dishId })),
    note: order.note,
    createdAt: Date.now(),
    ...(opts.paidBy ? { paidBy: opts.paidBy } : {}),
  };
  kvSet(`mt-share:${share.id}`, share);
  // sid 索引（扫单/管理用；幂等追加）
  try {
    const idx = kvGet<string[]>('mt-share-index') ?? [];
    if (!idx.includes(share.id)) kvSet('mt-share-index', [...idx, share.id].slice(-50));
  } catch {
    /* 忽略 */
  }

  // 卡片进聊天（role 'me' = 机主发给好友；'peer' = AI 角色发给机主（请客代付））
  insertShareCard(idp, contactId, {
    id: genMsgId(),
    role: opts.role === 'peer' ? 'peer' : 'me',
    content: opts.content?.trim() || `[美团订单]分享一个${order.merchantName}的订单`,
    time: Date.now(),
    kind: 'mtshare',
    mtshare: { sid: share.id },
  });
  return { ok: true, share };
}
