'use client';

/**
 * 商家接单通知（商家入驻：机主自己的店铺收到「已支付」订单时）：
 * - 触发点 = 订单从待支付变为已支付（收银台直付 / 微信QQ渠道支付 / AI 代付·帮付·请客），
 *   未支付的脏单（15 分钟超时自动取消）不打扰商家；
 * - 灵动岛弹卡：app 'meituan'，点击进该订单详情（复用既有美团导航协议）；
 * - 红点：kv `mt-shop-notify:<uid>` = Record<shopId, 上次查看订单页签的时间戳>，
 *   店铺管理页「订单」页签按 paidAt > lastSeen 计未看数，进入页签时 mtMarkShopOrdersSeen 清零；
 * - 消息中心同步：本店订单本来就在 mtLoadOrders（账号级）里，消息中心「订单通知」天然可见；
 * - AI 买家附言（「在你家点了 xx」）在 mt-ai-engage.ts 的各下单流里发送，不在这里。
 */
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { mtMerchantOf } from './meituan-data';
import type { MtOrder } from './meituan-store';
import { pushChatNotification } from './island-notify';

const notifyKey = (uid: string) => `mt-shop-notify:${uid}`;
const doneKey = (orderId: string) => `mt-shop-notify-done:${orderId}`;

/** 订单商品摘要（最多 3 个品名，超出「等N样」） */
function itemSummary(o: MtOrder): string {
  const names = o.items.map((i) => `${i.name}${i.qty > 1 ? `x${i.qty}` : ''}`);
  return names.slice(0, 3).join('、') + (names.length > 3 ? `等${names.length}样` : '');
}

/**
 * 订单支付成功 → 若商家是机主自己的店铺：灵动岛弹「您的小店有新订单」+ 红点计数基线。
 * 幂等（同订单只通知一次）；非自有店铺/团购频道静默跳过。
 */
export function mtNotifyShopOrderPaid(o: MtOrder): void {
  try {
    const merchant = mtMerchantOf(o.merchantId);
    if (!merchant?.mine) return;
    if (kvGet<boolean>(doneKey(o.id))) return;
    kvSet(doneKey(o.id), true);
    pushChatNotification({
      sessionKey: `mtshop:${o.merchantId}`,
      app: 'meituan',
      title: o.merchantName,
      subtitle: '商家中心 · 新订单',
      avatar: null,
      body: `${itemSummary(o)}，实收¥${o.total.toFixed(2)}，请及时接单`,
      target: { app: 'meituan', contactId: o.id },
    });
  } catch {
    /* 通知失败不影响支付主流程 */
  }
}

/** 商家查看过「订单」页签：红点清零（记录查看时刻） */
export function mtMarkShopOrdersSeen(uid: string, shopId: string): void {
  try {
    const map = kvGet<Record<string, number>>(notifyKey(uid)) ?? {};
    map[shopId] = Date.now();
    kvSet(notifyKey(uid), map);
  } catch {
    /* 忽略 */
  }
}

/**
 * 未看新单数（paidAt 晚于上次查看时刻的未取消订单）。
 * 首次使用（无查看记录）= 从未查看 → 已支付的未取消订单全部计为未看（符合真实商家直觉：
 * 有单没看过就红点；首次进入「订单」页签即清零建立基线）。
 */
export function mtShopUnseenCount(uid: string, shopId: string, orders: MtOrder[]): number {
  try {
    const map = kvGet<Record<string, number>>(notifyKey(uid));
    const seen = map && typeof map[shopId] === 'number' ? (map[shopId] as number) : 0;
    return orders.filter((o) => typeof o.paidAt === 'number' && o.paidAt > seen && o.status !== 'canceled').length;
  } catch {
    return 0;
  }
}
