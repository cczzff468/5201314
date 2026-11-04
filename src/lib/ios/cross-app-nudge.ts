'use client';

/**
 * 跨 App 事件联动（第十六轮）—— 别的 App 里发生的事，AI 主动到微信/QQ 聊天里聊起：
 *
 * - 美团外卖送达 / 淘宝快递签收 → 恋人 AI 按情境主动发一条消息（「外卖到啦，趁热吃」这类）；
 * - 接收者 = 情侣空间绑定的 partner（partnerContactId + partnerApp）——情侣手机的核心场景；
 *   未绑定恋人关系时不发（不打扰普通好友）；
 * - 投递走 fireProactiveNudge（幂等键=事件类型+订单号，24h 不重发；每日上限 3 条防风暴）；
 * - 依赖方向：本模块被 MeituanOrderWatcher / taobao 确认收货链路调用；
 *   couple-invite 与 proactive-msg 均经动态 import 引入（与 mt-ai-engage 现有防环模式一致）。
 */

interface NudgePartner {
  app: 'wx' | 'qq';
  cid: string;
}

/** 读恋人绑定的 partner（未绑定/数据损坏返回 null） */
async function couplePartner(): Promise<NudgePartner | null> {
  try {
    const { readInviteMeta } = await import('./couple-invite');
    const meta = readInviteMeta();
    if (!meta.partnerContactId) return null;
    return { app: meta.partnerApp === 'qq' ? 'qq' : 'wx', cid: meta.partnerContactId };
  } catch {
    return null;
  }
}

/** 通用：按情境给恋人发一条跨 App 联动消息（返回是否投递） */
async function nudgePartner(dedupeKey: string, context: string, dailyCap = 3): Promise<boolean> {
  const p = await couplePartner();
  if (!p) return false;
  try {
    const { fireProactiveNudge } = await import('./proactive-msg');
    return await fireProactiveNudge(p.app, p.cid, { dedupeKey, context, dailyCap });
  } catch {
    return false;
  }
}

/** 美团订单（meituan-store 的 MtOrder 形状按需取字段） */
interface MtOrderLike {
  id: string;
  merchantName?: string;
  items?: { name: string; qty: number }[];
  total?: number;
}

/** 淘宝订单（taobao-store 的 TbOrder 形状按需取字段） */
interface TbOrderLike {
  id: string;
  shopName?: string;
  items?: { title: string }[];
  total?: number;
}

/** 美团外卖送达 → 恋人 AI 主动聊（MeituanOrderWatcher 状态机 completed 时调用） */
export function mtOrderArrivedNudge(o: MtOrderLike): void {
  try {
    const summary = (o.items ?? []).map((i) => `${i.name}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、').slice(0, 40);
    const what = o.merchantName ? `「${o.merchantName}」的外卖（${summary}）` : '点的外卖';
    void nudgePartner(
      `mt-arrive-${o.id}`,
      `你们的朋友圈之外发生了一件事：${what}刚刚送到了（骑手已送达）。以恋人身份自然地在聊天里提起这件事——可以催 TA 趁热吃、问问好不好吃、或者接着你们最近聊过的话题说；一两句话就够，别报菜名别太正式`,
    );
  } catch {
    /* 静默 */
  }
}

/** 淘宝订单签收（确认收货/帮取件/票务散场）→ 恋人 AI 主动聊 */
export function tbOrderArrivedNudge(o: TbOrderLike): void {
  try {
    const summary = (o.items ?? []).map((i) => (i.title ?? '').slice(0, 12)).filter(Boolean).join('、').slice(0, 40);
    const what = o.shopName ? `淘宝「${o.shopName}」的快递（${summary}）` : '淘宝的快递';
    void nudgePartner(
      `tb-arrive-${o.id}`,
      `你们之间发生了一件事：${what}刚刚取到/签收了。以恋人身份自然地在聊天里提起这件事——可以问买的东西怎么样、是不是 TA 之前念叨想要的、或者开玩笑说拆快递像拆盲盒；一两句话就够，别太正式`,
    );
  } catch {
    /* 静默 */
  }
}
