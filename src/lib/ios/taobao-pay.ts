/**
 * 淘宝支付层：复用现有微信/QQ 钱包的支付逻辑（需求「支付复用QQ、微信的支付逻辑」）：
 * - 微信支付 → wxExecutePayment（零钱 / 银行卡 / 亲属卡 fcin-*，含跨月重置与多卡分摊）；
 *   亲属卡成功后走 recordFcSpend（账本流水 + 按赠卡人写记忆碎片 channel='淘宝'）+ 赠卡人聊天通知行
 *   ——AI 下一轮聊天经记忆召回自然知道「用户用亲属卡在淘宝花钱了」（需求 6.3）；
 * - QQ 支付 → qq.executePayment（QQ钱包余额 / 银行卡，写 QQ 钱包账单）；
 * - 钱包模块全部动态 import（淘宝 App 是懒加载 chunk，支付只在拉起支付时才拉钱包模块）；
 * - 渠道列表带可用余额与「额度不足」预检（wxCanPay / qq.canPay 同源），亲属卡不足 →
 *   渠道灰显 + 提示切换其他支付方式；
 * - 退款原路退回（零钱回补 / 卡余额回补 / 亲属卡额度按分摊回补）与 meituan-pay 同一套钱包写入口。
 */
import { ownerRealNameFor } from '@/lib/ios/contacts-store';
import type { TbOrder } from './taobao-store';

export interface TbPayChannel {
  key: string;
  idp: 'wx' | 'qq';
  methodId: string;
  label: string;
  sub: string;
  isFc?: boolean;
  insufficient: boolean;
}

export interface TbFcPart {
  cardInId: string;
  giverId: string | null;
  giverName: string;
  amount: number;
}

export interface TbPayResult {
  ok: boolean;
  error?: string;
  fc?: { total: number; parts: TbFcPart[] };
}

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

/** 拉取某端的可选支付渠道（带余额/额度预检；与美团 mtListPayChannels 同口径） */
export async function tbListPayChannels(idp: 'wx' | 'qq', amount: number): Promise<TbPayChannel[]> {
  if (idp === 'wx') {
    const ww = await import('@/components/apps/wechat-wallet');
    const w = await import('@/components/apps/wechat');
    const chans: TbPayChannel[] = [];
    const bal = ww.loadJSON<{ balance?: number }>(ww.LS_WALLET, {}).balance ?? 0;
    chans.push({ key: 'wx:balance', idp: 'wx', methodId: 'balance', label: '微信零钱', sub: `可用 ¥${fmt2(bal)}`, insufficient: !w.wxCanPay('balance', amount) });
    for (const c of ww.loadCards()) {
      chans.push({
        key: `wx:${c.id}`,
        idp: 'wx',
        methodId: c.id,
        label: c.bank || '银行卡',
        sub: `尾号${c.tail} · 可用 ¥${fmt2(c.balance ?? 0)}`,
        insufficient: !w.wxCanPay(c.id, amount),
      });
    }
    // 亲属卡（我收到的）：按赠卡人聚合可用额度
    const fcs = ww.resetFamilyCardsInMonth();
    const groups = new Map<string, { cards: typeof fcs; avail: number; name: string }>();
    for (const f of fcs) {
      const k = f.friendId ?? f.id;
      const cur = groups.get(k);
      if (cur) {
        cur.cards.push(f);
        cur.avail = Math.round((cur.avail + Math.max(0, f.monthlyLimit - f.used)) * 100) / 100;
      } else {
        groups.set(k, { cards: [f], avail: Math.max(0, f.monthlyLimit - f.used), name: f.fromName });
      }
    }
    for (const g of groups.values()) {
      const anchor = g.cards[0];
      const methodId = anchor.id.startsWith('fcin-') ? anchor.id : `fcin-${anchor.id}`;
      chans.push({
        key: `wx:${methodId}`,
        idp: 'wx',
        methodId,
        label: `${g.name}的亲属卡${g.cards.length > 1 ? `×${g.cards.length}` : ''}`,
        sub: `本月可用 ¥${fmt2(g.avail)}`,
        isFc: true,
        insufficient: g.avail < amount,
      });
    }
    return chans;
  }
  const qq = await import('@/components/apps/qq');
  const chans: TbPayChannel[] = [];
  const bal = qq.loadWallet().balance;
  chans.push({ key: 'qq:balance', idp: 'qq', methodId: 'balance', label: 'QQ钱包余额', sub: `可用 ¥${fmt2(bal)}`, insufficient: !qq.canPay('balance', amount) });
  for (const c of qq.loadBankCards()) {
    chans.push({
      key: `qq:${c.id}`,
      idp: 'qq',
      methodId: c.id,
      label: c.bank || '银行卡',
      sub: `尾号${c.last4} · 可用 ¥${fmt2(c.balance ?? 0)}`,
      insufficient: !qq.canPay(c.id, amount),
    });
  }
  return chans;
}

/**
 * 执行淘宝支付（复用微信/QQ 扣款；亲属卡支付写 AI 记忆 channel='淘宝'）。
 */
export async function tbExecutePay(
  idp: 'wx' | 'qq',
  channel: TbPayChannel,
  amount: number,
  /** 商品摘要（「iPhone 13 等1件」），记忆与通知文案用 */
  goodsBrief: string
): Promise<TbPayResult> {
  if (!(amount > 0)) return { ok: false, error: '支付金额异常，请重试' };
  if (idp === 'wx') {
    const w = await import('@/components/apps/wechat');
    const ww = await import('@/components/apps/wechat-wallet');
    if (!w.wxCanPay(channel.methodId, amount)) {
      return { ok: false, error: channel.isFc ? '亲属卡本月额度不足，请切换其他支付方式' : '余额不足，支付失败，请重试或更换支付方式' };
    }
    const pay = w.wxExecutePayment(channel.methodId, amount, channel.isFc ? '亲属卡付款' : '淘宝购物', { peer: '淘宝' });
    if (!pay) return { ok: false, error: channel.isFc ? '亲属卡本月额度不足，请切换其他支付方式' : '余额不足，支付失败，请重试或更换支付方式' };
    if (pay.fc) {
      // 亲属卡消费感知（需求 6.3：亲属卡支付后 AI 要知道并写入记忆）：
      // 账本 + 赠卡人记忆碎片（channel='淘宝'）+ 赠卡人聊天通知行
      const parts: TbFcPart[] = pay.fc.parts.map((p) => ({ cardInId: p.cardInId, giverId: p.giverId, giverName: p.giverName, amount: p.amount }));
      const owner = (await ownerRealNameFor('wx').catch(() => '')) || '机主';
      ww.recordFcSpend({
        total: amount,
        scene: '亲属卡付款',
        where: `在淘宝购买${goodsBrief}`,
        parts: pay.fc.parts,
        ownerName: owner,
        channel: '淘宝',
      });
      for (const p of pay.fc.parts) {
        if (!p.giverId) continue;
        ww.appendWxChatMsg(p.giverId, {
          id: ww.uid(),
          role: 'peer',
          content: '',
          time: Date.now(),
          kind: 'notice',
          notice: { icon: 'fam', pre: `你用${p.giverName}送的亲属卡在淘宝购物消费了`, accent: `¥${fmt2(amount)}` },
        });
      }
      return { ok: true, fc: { total: amount, parts } };
    }
    return { ok: true };
  }
  const qq = await import('@/components/apps/qq');
  if (!qq.canPay(channel.methodId, amount)) return { ok: false, error: '余额不足，支付失败，请重试或更换支付方式' };
  const ok = qq.executePayment(channel.methodId, amount, '淘宝购物', { avatar: null });
  return ok ? { ok: true } : { ok: false, error: '余额不足，支付失败，请重试或更换支付方式' };
}

/**
 * 退款原路退回入账（订单退款成功后调用）：
 * - 微信零钱 → 零钱回补 + 零钱明细「淘宝购物」收入；微信银行卡 → 卡余额回补 + 零钱明细「淘宝购物」退款收入；
 * - 微信亲属卡 → 按支付时各卡分摊回补本月可用额度；
 * - QQ余额 → QQ钱包入账 + 账单（kind=refund）；QQ银行卡 → 卡余额回补 + 账单。
 */
export async function tbRefundToOrigin(order: TbOrder): Promise<boolean> {
  const amount = Math.round((order.refund?.amount ?? order.total) * 100) / 100;
  const methodId = order.payMethodId;
  if (!(amount > 0) || !order.payIdp || !methodId) return false;
  try {
    if (order.payIdp === 'wx') {
      const w = await import('@/components/apps/wechat');
      const ww = await import('@/components/apps/wechat-wallet');
      if (methodId === 'balance') {
        return w.wxPatchBalance(amount, { kind: '淘宝购物', amount, peer: '淘宝' });
      }
      if (methodId.startsWith('fcin-')) {
        // 亲属卡：恢复本月额度（优先按支付时分摊明细回补）
        const list = ww.resetFamilyCardsInMonth();
        const back = new Map<string, number>();
        if (order.payFcParts && order.payFcParts.length > 0) {
          for (const p of order.payFcParts) back.set(p.cardInId, (back.get(p.cardInId) ?? 0) + p.amount);
        } else {
          const anchor = list.find((f) => f.id === methodId);
          if (!anchor) return false;
          const key = anchor.friendId ?? anchor.id;
          let remain = amount;
          for (const f of list.filter((x) => (x.friendId ?? x.id) === key && x.used > 0)) {
            const take = Math.min(f.used, remain);
            if (take > 0) {
              back.set(f.id, take);
              remain = Math.round((remain - take) * 100) / 100;
            }
            if (remain <= 0) break;
          }
        }
        if (back.size === 0) return false;
        ww.saveFamilyCardsIn(
          list.map((f) => (back.has(f.id) ? { ...f, used: Math.round((f.used - (back.get(f.id) ?? 0)) * 100) / 100 } : f))
        );
        return true;
      }
      const cards = ww.loadCards();
      if (!cards.some((x) => x.id === methodId)) return false;
      // 银行卡退款：卡余额回补 + 零钱明细写退款收入（此前只回补卡余额不写账单，与支付侧不对称）
      return w.wxRefundToBankCard(methodId, amount, '淘宝购物', { peer: '淘宝' });
    }
    const qq = await import('@/components/apps/qq');
    if (methodId === 'balance') {
      qq.gainToWallet(amount, '淘宝购物-退款', { kind: 'refund' });
      return true;
    }
    return qq.refundToBankCard(methodId, amount);
  } catch {
    return false;
  }
}
