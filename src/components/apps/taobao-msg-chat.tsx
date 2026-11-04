'use client';

/**
 * 淘宝客服聊天界面（旺信会话页，第十六轮）：
 * - 对照真实淘宝旺信：白底头部（返回 + 店铺名/「对方正在输入...」+ 橙色五角星评分 + 进入店铺/更多）、
 *   营销拒收 pill、店家白气泡（客服昵称 + 方头像）、买家浅橙气泡（右侧头像 + 最后一条下方「已读」）、
 *   商品卡消息（选择商品规格/去购买）、订单卡消息（查看订单）、评价客服/自助服务快捷行、
 *   语音/表情/购物袋/加号输入栏（输入非空变橙色「发送」钮）；
 * - 数据：聊天记录经 tb-ai-store 按 uid+shopId 隔离持久化（IndexedDB kv 内存同步读 + 写穿），
 *   挂载时记住店铺 / 清未读，并按需补发 咨询商品卡 / 咨询订单卡 / 欢迎语（防重：最近 6 条去重）；
 * - AI 回复链路：append 用户消息 → 「对方正在输入...」 → tbSellerReply（/api/chat：
 *   用户配置模型 → 内置模型兜底，内部共 3 次尝试，与 ≥900ms 打字节奏并行；全失败返回 null）→
 *   parseSellerReply 拆成 1~10 条文本 + [商品:pid] 标记 → 逐条落库、错峰上屏（第一条立即，
 *   后续每条 +600ms，商品卡追加在最后）；卸载后仍落库、只跳过 setState（alive ref 防竞态）；
 * - 失败不落任何占位回复：触发消息打红色 ! 徽标（tbChatPatch 落库 + setState 双写，参照微信/QQ），
 *   点击重新生成整轮（sendingRef 防并发）；重新生成成功后清除徽标。
 */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BellOff,
  LayoutGrid,
  Mic,
  MoreHorizontal,
  Plus,
  ShoppingBag,
  Smile,
  SmilePlus,
  Store,
} from 'lucide-react';
import { productById, shopById, tbImg, tbKefuAvatarOf } from '@/lib/ios/taobao-data';
import { tbLoadOrders } from '@/lib/ios/taobao-store';
import { getContact } from '@/lib/ios/contacts-store';
import { TbImg } from './tb-img';
import {
  tbChatAppend,
  tbChatClearUnread,
  tbChatLoad,
  tbChatPatch,
  tbChatRememberShop,
  type TbCsMsg,
} from '@/lib/ios/tb-ai-store';
import {
  parseSellerReply,
  tbSellerName,
  tbSellerReply,
  type TbSellerHistoryMsg,
} from '@/lib/ios/tb-chat-ai';

/** 金额展示（与 taobao.tsx fmtMoney 同口径：整数不带小数，其余两位） */
const fmtMoney = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** 时间分割文案：首条/跨天 →「YYYY年M月D日 HH:mm」；同天距上条 ≥5 分钟 →「HH:mm」；否则不显示 */
function timeDivider(at: number, prevAt: number | null): string | null {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (prevAt == null) return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  const p = new Date(prevAt);
  const crossDay = d.getFullYear() !== p.getFullYear() || d.getMonth() !== p.getMonth() || d.getDate() !== p.getDate();
  if (crossDay) return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  if (at - prevAt >= 5 * 60_000) return hm;
  return null;
}

/** 订单卡创建时间「YYYY-MM-DD HH:mm」 */
function fmtOrderTime(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 商品卡消息（bot 推荐 / 买家购物袋按钮发送共用；独立白卡不走气泡）。
 * 商品已不存在（productById 未命中）→ 灰卡「商品已下架」。
 */
function ProductCardMsg({ pid, onOpenProduct }: { pid: string; onOpenProduct: (pid: string) => void }) {
  const product = productById(pid);
  if (!product) {
    return (
      <div className="w-[248px] rounded-2xl bg-black/[0.05] px-3 py-4 text-center text-[13px] text-black/40">商品已下架</div>
    );
  }
  return (
    <div className="w-[248px] rounded-2xl bg-white p-2.5">
      {/* 上行：商品图 + 标题/价格 */}
      <div className="flex items-center gap-2.5">
        <TbImg src={tbImg(product.tag, 160, 160, 0)} alt={product.title} className="h-[76px] w-[76px] shrink-0 rounded-lg object-cover" />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[12.5px] leading-[17px] text-black/90">{product.title}</div>
          <div className="mt-1.5 text-[16px] font-bold leading-none text-[#FF4400]">¥{fmtMoney(product.price)}</div>
        </div>
      </div>
      {/* 下行：选择商品规格 / 去购买（都进商品详情页） */}
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={() => onOpenProduct(product.id)}
          className="h-8 flex-1 rounded-full bg-[#FFF1E4] text-[12.5px] text-[#FF5000] active:opacity-70"
        >
          选择商品规格
        </button>
        <button
          type="button"
          onClick={() => onOpenProduct(product.id)}
          className="h-8 flex-1 rounded-full bg-[#FF5000] text-[12.5px] text-white active:opacity-70"
        >
          去购买
        </button>
      </div>
    </div>
  );
}

/** 订单卡消息（「你正在咨询的订单」白卡；订单已删 → 灰卡「订单不存在」） */
function OrderCardMsg({ uid, orderId, onOpenOrder }: { uid: string; orderId: string; onOpenOrder: (orderId: string) => void }) {
  const order = tbLoadOrders(uid).find((o) => o.id === orderId);
  if (!order) {
    return (
      <div className="w-[264px] rounded-2xl bg-black/[0.05] px-3 py-4 text-center text-[13px] text-black/40">订单不存在</div>
    );
  }
  const first = order.items[0];
  const qty = order.items.reduce((n, it) => n + it.qty, 0);
  return (
    <div className="w-[264px] rounded-2xl bg-white p-3">
      <div className="text-[13.5px] font-bold text-black/90">你正在咨询的订单</div>
      {/* 商品行：首件商品图 + 标题 + 右列 实付金额/件数（历史订单可能存空 img → 按商品 tag 兑底，禁止空 src） */}
      {first ? (
        <div className="mt-2.5 flex items-center gap-2.5">
          <TbImg src={first.img || tbImg(productById(first.pid)?.tag ?? 'snacks', 120, 120, 0)} alt={first.title} className="h-[52px] w-[52px] shrink-0 rounded-lg object-cover" />
          <div className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-[16px] text-black/80">{first.title}</div>
          <div className="shrink-0 text-right">
            <div className="text-[15px] font-bold leading-none text-[#FF4400]">¥{fmtMoney(order.total)}</div>
            <div className="mt-1.5 text-[11px] leading-none text-black/35">共{qty}件商品</div>
          </div>
        </div>
      ) : null}
      {/* 订单号 / 创建时间（label+value 两列） */}
      <div className="mt-2.5 space-y-1">
        <div className="flex items-baseline gap-2 text-[11.5px] leading-[16px] text-black/45">
          <span className="shrink-0">订单号：</span>
          <span className="min-w-0 flex-1 truncate">{order.id}</span>
        </div>
        <div className="flex items-baseline gap-2 text-[11.5px] leading-[16px] text-black/45">
          <span className="shrink-0">创建时间：</span>
          <span>{fmtOrderTime(order.createdAt)}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onOpenOrder(order.id)}
        className="mt-2.5 h-9 w-full rounded-xl bg-[#FFF1E4] text-[13.5px] text-[#FF5000] active:opacity-70"
      >
        查看订单
      </button>
    </div>
  );
}

/**
 * 淘宝客服聊天页（消息页店铺会话 / 商品页客服 / 订单客服 统一进入）。
 * @param uid        淘宝账号 uid（聊天记录数据隔离键）
 * @param shopId     店铺 id
 * @param pid        正在咨询的商品（商品页客服进入带入，自动补发 bot 商品卡）
 * @param orderId    正在咨询的订单（订单/物流页客服进入带入，自动补发 bot 订单卡）
 */
export function TbMsgChatPage({
  uid,
  shopId,
  pid,
  orderId,
  onBack,
  onToast,
  onOpenProduct,
  onOpenOrder,
  userName,
  userAvatar,
}: {
  uid: string;
  shopId: string;
  pid?: string | null;
  orderId?: string | null;
  onBack: () => void;
  onToast: (m: string) => void;
  onOpenProduct: (pid: string) => void;
  onOpenOrder: (orderId: string) => void;
  userName: string;
  userAvatar: string | null;
}) {
  const shop = shopById(shopId);
  const sellerName = tbSellerName(shopId);

  // 聊天记录（持久化）：初始从 tb-chat:<uid>:<shopId> 读，后续一律以 tbChatAppend 返回列表为准
  const [msgs, setMsgs] = useState<TbCsMsg[]>(() => tbChatLoad(uid, shopId));
  const [typing, setTyping] = useState(false); // 客服回复等待中（头部变「对方正在输入...」+ 三点气泡）
  const [input, setInput] = useState('');
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const aliveRef = useRef(true); // 卸载标记（防卸载后 setState）
  const sendingRef = useRef(false); // 发送防并发（一轮问答进行中忽略新发送）
  // 入口参数经 ref 读最新值：挂载 effect 依赖保持 [uid, shopId]（规格口径），父级重渲染不重复补卡
  const pidRef = useRef(pid);
  const orderIdRef = useRef(orderId);

  // 每次渲染后同步最新入口参数（历史/落库统一以 tb-ai-store 为准，不经 msgs ref）
  useEffect(() => {
    pidRef.current = pid;
    orderIdRef.current = orderId;
  });

  // 挂载（uid/shopId 变化）：记住店铺 + 清未读 + 按需补发 咨询商品卡/订单卡/欢迎语
  useEffect(() => {
    aliveRef.current = true;
    tbChatRememberShop(uid, shopId);
    tbChatClearUnread(uid, shopId);
    const existing = tbChatLoad(uid, shopId);
    const recent = existing.slice(-6); // 最近 6 条内去重，防止重复进出刷屏
    const appends: Array<Omit<TbCsMsg, 'id' | 'at'>> = [];
    // 商品页客服进入：最近 6 条内无同 pid 商品卡 → 补发 bot 商品卡
    if (pidRef.current && !recent.some((m) => m.card?.type === 'product' && m.card.pid === pidRef.current)) {
      appends.push({ role: 'bot', card: { type: 'product', pid: pidRef.current } });
    }
    // 订单/物流页客服进入：无同单订单卡 → 补发 bot 订单卡
    if (orderIdRef.current && !recent.some((m) => m.card?.type === 'order' && m.card.orderId === orderIdRef.current)) {
      appends.push({ role: 'bot', card: { type: 'order', orderId: orderIdRef.current } });
    }
    // 空会话 → 客服欢迎语
    if (existing.length === 0) {
      appends.push({ role: 'bot', text: `欢迎光临本店～我是客服${tbSellerName(shopId)}，很高兴为您服务~` });
    }
    setMsgs(appends.length > 0 ? tbChatAppend(uid, shopId, appends) : existing);
    return () => {
      aliveRef.current = false;
    };
  }, [uid, shopId]);

  // 消息/打字态变化后滚到底部（双 rAF 等布局稳定）
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [msgs, typing]);

  /** 给触发消息打/清 replyFail 徽标（tbChatPatch 落库 + setState 双写，参照微信/QQ setReplyFail） */
  const setReplyFail = (msgId: string | null, fail: boolean) => {
    if (!msgId) return;
    const list = tbChatPatch(uid, shopId, msgId, { replyFail: fail || undefined });
    if (aliveRef.current) setMsgs(list);
  };

  /**
   * 生成一轮客服回复（sendText 与失败徽标「重新生成」共用）：
   * ctx 组装 → tbSellerReply（内部共 3 次尝试，全失败返回 null，不再有本地规则兜底）→
   * parseSellerReply 拆成 1~10 条文本 + [商品:pid] → 逐条落库+错峰上屏（第一条立即，
   * 后续每条 +600ms；卸载后仍落库、只跳过 setState）→ 成功清除触发消息上的失败徽标。
   * 失败/空回复 → 对触发消息打红色 ! 徽标（点击可重新生成整轮），绝不落占位文字。
   * @param triggerMsgId 本轮触发的用户消息 id（sendText 现场刚落库 / 徽标重试为失败消息）
   * @param userText      买家本轮输入（sendText 现场传入；徽标重试省略 → 用触发消息自己的文本）
   */
  const runSellerTurn = async (triggerMsgId: string | null, userText?: string) => {
    // 历史与买家输入统一从落库记录组装：截到触发消息为止（sendText 时它是刚落的最后一条，
    // 徽标重试时可能在更早位置），两种入口都取到「本轮用户消息之前」的完整历史
    const base = tbChatLoad(uid, shopId);
    const cut = triggerMsgId ? base.findIndex((m) => m.id === triggerMsgId) : base.length;
    const history: TbSellerHistoryMsg[] = base
      .slice(0, cut < 0 ? base.length : cut)
      .map((m) => ({ role: m.role, text: m.text, card: m.card }));
    const text = userText ?? (triggerMsgId ? (base.find((m) => m.id === triggerMsgId)?.text ?? '') : '');
    // 上下文：店铺 + 正在咨询的商品/订单 + 买家名字
    // 用户规则（Task 32）：AI 永远不知道机主昵称——客服 AI 上下文恒用真实名字
    //（userName 是社交/电商展示名，可能是昵称；只用于气泡显示，不进 prompt）
    let aiCustName = userName;
    if (uid.startsWith('wx:') || uid.startsWith('qq:')) {
      try {
        const c = await getContact(uid.slice(3));
        if (c?.kind === 'user' && c.name?.trim()) aiCustName = c.name.trim();
      } catch {
        /* 联系人库异常 → 回退展示名 */
      }
    }
    const ctx = {
      shop,
      product: pidRef.current ? (productById(pidRef.current) ?? null) : null,
      order: orderIdRef.current ? (tbLoadOrders(uid).find((o) => o.id === orderIdRef.current) ?? null) : null,
      custName: aiCustName,
    };
    // AI 回复与 ≥900ms 最短打字节奏并行
    const [reply] = await Promise.all([tbSellerReply(text, history, ctx), new Promise<void>((r) => setTimeout(r, 900))]);
    // 3 次尝试全失败：本轮不落任何 bot 消息，触发消息打红色 ! 徽标（点击重新生成）
    if (reply == null) {
      setReplyFail(triggerMsgId, true);
      return;
    }
    const { lines, pids } = parseSellerReply(reply);
    // [商品:pid] 标记 → 真实命中的商品转商品卡消息，追加在文本之后
    const hits = [...new Set(pids)].filter((p) => productById(p));
    if (lines.length === 0 && hits.length === 0) {
      // 回复解析后无任何内容（无文本无卡片）≈ 无有效回复：同样打徽标，不落占位
      setReplyFail(triggerMsgId, true);
      return;
    }
    const burst: Array<Omit<TbCsMsg, 'id' | 'at'>> = [
      ...lines.map((t) => ({ role: 'bot' as const, text: t })),
      ...hits.map((p) => ({ role: 'bot' as const, card: { type: 'product' as const, pid: p } })),
    ];
    // 逐条落库+错峰上屏：第一条立即，后续每条间隔 600ms（500~900ms 区间内）；
    // 卸载后仍落库（关页后客服仍会回复），只跳过 setState（aliveRef 防卸载后更新）
    for (let i = 0; i < burst.length; i++) {
      if (i > 0) await new Promise<void>((r) => setTimeout(r, 600));
      const list = tbChatAppend(uid, shopId, [burst[i]]);
      if (aliveRef.current) setMsgs(list);
    }
    // 本轮成功：清除触发消息及历史遗留的 replyFail 徽标（客服已恢复响应，旧失败标记一并清掉）
    const stale = tbChatLoad(uid, shopId).filter((m) => m.replyFail);
    let cleared: TbCsMsg[] | null = null;
    for (const m of stale) cleared = tbChatPatch(uid, shopId, m.id, { replyFail: undefined });
    if (stale.length > 0 && cleared && aliveRef.current) setMsgs(cleared);
  };

  /** 发送文本：落库用户消息 → 「对方正在输入」 → runSellerTurn 生成多条回复（失败打 ! 徽标） */
  const sendText = async (raw: string) => {
    const text = raw.trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    setInput('');
    // 用户消息落库（tbChatAppend 返回含新消息的全量列表，以它为准 setState）
    const list = tbChatAppend(uid, shopId, [{ role: 'user', text }]);
    setMsgs(list);
    if (aliveRef.current) setTyping(true);
    try {
      await runSellerTurn(list[list.length - 1]?.id ?? null, text);
    } finally {
      if (aliveRef.current) setTyping(false);
      sendingRef.current = false;
    }
  };

  /** 失败徽标点击：对该条用户消息重跑整轮（正在生成/上屏时忽略，防并发） */
  const retryReply = (triggerMsgId: string) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    if (aliveRef.current) setTyping(true);
    void (async () => {
      try {
        await runSellerTurn(triggerMsgId);
      } finally {
        if (aliveRef.current) setTyping(false);
        sendingRef.current = false;
      }
    })();
  };

  /** 购物袋按钮：有咨询商品 → 发送买家侧商品卡；否则提示从宝贝页进入 */
  const sendProductCard = () => {
    const p = pidRef.current;
    if (!p) {
      onToast('先从宝贝页进来说说想问的宝贝哦~');
      return;
    }
    setMsgs(tbChatAppend(uid, shopId, [{ role: 'user', card: { type: 'product', pid: p } }]));
  };

  // 最后一条用户消息下渲染「已读」回执
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#F6F6F6]">
      {/* 顶部：返回 + 店铺名（等待回复→「对方正在输入...」）+ 橙色星级评分 + 进入店铺/更多 */}
      <div className="border-b border-black/[0.06] bg-white pt-[54px]">
        <div className="flex items-center gap-2 px-3 pb-2 pt-1">
          <button
            type="button"
            aria-label="返回"
            onClick={onBack}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5"
          >
            <ArrowLeft className="h-[21px] w-[21px] text-black/85" strokeWidth={2.1} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-bold leading-[22px] text-black/90">
              {typing ? '对方正在输入...' : shop.name}
            </div>
            <div className="mt-[3px] flex h-[13px] items-center gap-1.5">
              <span className="text-[11px] leading-none text-[#FF7A2E]">{'★★★★★'}</span>
              <span className="text-[11.5px] leading-none text-black/45">{shop.rating.toFixed(1)}</span>
              {shop.tmall ? <span className="text-[10px] leading-none text-black/35">天猫</span> : null}
            </div>
          </div>
          <button
            type="button"
            aria-label="进入店铺"
            onClick={() => onToast('进入店铺（演示）')}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5"
          >
            <Store className="h-[20px] w-[20px] text-black/75" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="更多"
            onClick={() => onToast('更多（演示）')}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5"
          >
            <MoreHorizontal className="h-[20px] w-[20px] text-black/75" strokeWidth={2} />
          </button>
        </div>
      </div>
      {/* 营销拒收 pill（旺信头部下方） */}
      <div className="flex">
        <button
          type="button"
          onClick={() => onToast('已拒收营销消息（演示）')}
          className="mb-1 ml-4 mt-1.5 flex h-7 shrink-0 items-center gap-1.5 self-start rounded-full bg-black/[0.05] px-2.5 text-[12px] text-black/55 active:opacity-70"
        >
          <BellOff className="h-3.5 w-3.5 text-black/45" strokeWidth={2} />
          拒收本店营销活动消息
        </button>
      </div>
      {/* 消息区（滚动条隐藏） */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {msgs.map((m, i) => {
          const divider = timeDivider(m.at, i > 0 ? msgs[i - 1].at : null);
          const showRead = m.role === 'user' && i === lastUserIdx;
          return (
            <div key={m.id}>
              {divider ? <div className="my-2 text-center text-[11.5px] leading-none text-black/35">{divider}</div> : null}
              {m.role === 'bot' ? (
                // 店家侧（左）：方头像 + 客服昵称 + 白气泡 / 独立卡片
                <div className="mb-2.5 flex items-start gap-2">
                  <img
                    src={tbKefuAvatarOf(shop.id)}
                    alt={shop.name}
                    className="h-9 w-9 shrink-0 rounded-lg object-cover"
                    draggable={false}
                  />
                  <div className="min-w-0">
                    <div className="mb-1 text-[11.5px] leading-none text-black/40">{sellerName}</div>
                    {m.text ? (
                      <div className="max-w-[240px] whitespace-pre-wrap break-words rounded-xl rounded-tl-[4px] bg-white px-3 py-2 text-[14.5px] leading-[21px] text-black/90">
                        {m.text}
                      </div>
                    ) : null}
                    {m.card?.type === 'product' ? (
                      <div className={m.text ? 'mt-1.5' : ''}>
                        <ProductCardMsg pid={m.card.pid} onOpenProduct={onOpenProduct} />
                      </div>
                    ) : null}
                    {m.card?.type === 'order' ? (
                      <div className={m.text ? 'mt-1.5' : ''}>
                        <OrderCardMsg uid={uid} orderId={m.card.orderId} onOpenOrder={onOpenOrder} />
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                // 买家侧（右）：浅橙气泡 / 卡片 + 头像（无昵称行）；
                // 回复失败徽标（红色 !）在气泡左侧：LLM 三次尝试全失败时打在触发消息上，点击重新生成整轮
                <div className="mb-2.5 flex items-start justify-end gap-2">
                  {m.replyFail ? (
                    <button
                      type="button"
                      data-testid={`tb-replyfail-${m.id}`}
                      aria-label="重新生成"
                      title="重新生成"
                      onClick={() => retryReply(m.id)}
                      className="flex h-5 w-5 shrink-0 cursor-pointer self-center items-center justify-center rounded-full bg-[#FA5151] text-[13px] font-bold leading-none text-white transition-opacity active:opacity-70"
                    >
                      !
                    </button>
                  ) : null}
                  <div className="min-w-0">
                    {m.text ? (
                      <div className="ml-auto max-w-[240px] whitespace-pre-wrap break-words rounded-xl rounded-tr-[4px] bg-[#FFE3C6] px-3 py-2 text-[14.5px] leading-[21px] text-black/90">
                        {m.text}
                      </div>
                    ) : null}
                    {m.card?.type === 'product' ? (
                      <div className={`flex justify-end ${m.text ? 'mt-1.5' : ''}`}>
                        <ProductCardMsg pid={m.card.pid} onOpenProduct={onOpenProduct} />
                      </div>
                    ) : null}
                    {m.card?.type === 'order' ? (
                      <div className={`flex justify-end ${m.text ? 'mt-1.5' : ''}`}>
                        <OrderCardMsg uid={uid} orderId={m.card.orderId} onOpenOrder={onOpenOrder} />
                      </div>
                    ) : null}
                  </div>
                  {userAvatar ? (
                    <img
                      src={userAvatar}
                      alt={userName}
                      className="h-9 w-9 shrink-0 rounded-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#E4E6EA] text-[14px] font-semibold text-black/55">
                      {(userName || '客').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </div>
              )}
              {/* 已读回执（最后一条用户消息下方，右对齐留出头像位） */}
              {showRead ? <div className="mb-1 mr-11 text-right text-[11px] leading-none text-black/30">已读</div> : null}
            </div>
          );
        })}
        {/* 打字中：bot 侧白色气泡内三个弹跳圆点 */}
        {typing ? (
          <div className="mb-2.5 flex items-start gap-2">
            <img
              src={tbKefuAvatarOf(shop.id)}
              alt={shop.name}
              className="h-9 w-9 shrink-0 rounded-lg object-cover"
              draggable={false}
            />
            <div className="min-w-0">
              <div className="mb-1 text-[11.5px] leading-none text-black/40">{sellerName}</div>
              <div className="flex items-center gap-1 rounded-xl rounded-tl-[4px] bg-white px-3 py-2.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-black/30" style={{ animationDelay: '0ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-black/30" style={{ animationDelay: '150ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-black/30" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {/* 快捷行：评价客服 / 自助服务 */}
      <div className="flex gap-2 bg-[#F6F6F6] px-3 pb-1.5 pt-1">
        <button
          type="button"
          onClick={() => onToast('感谢您的评价（演示）')}
          className="flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13.5px] text-black/70 active:opacity-70"
        >
          <Smile className="h-4.5 w-4.5 text-black/55" strokeWidth={2} />
          评价客服
        </button>
        <button
          type="button"
          onClick={() => onToast('自助服务（演示）')}
          className="flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13.5px] text-black/70 active:opacity-70"
        >
          <LayoutGrid className="h-4.5 w-4.5 text-black/55" strokeWidth={2} />
          自助服务
        </button>
      </div>
      {/* 输入栏：语音 / 输入框（表情）/ 空态=购物袋+加号 → 非空=橙色「发送」 */}
      <div className="flex items-center gap-3 border-t border-black/[0.06] bg-white px-3 py-2.5">
        <button
          type="button"
          aria-label="语音消息"
          onClick={() => onToast('语音消息（演示）')}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5"
        >
          <Mic className="h-[22px] w-[22px] text-black/75" strokeWidth={2} />
        </button>
        <div className="flex h-9 min-w-0 flex-1 items-center rounded-full bg-black/[0.045] px-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter 发送（中文输入法组词回车不触发）
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void sendText(input);
              }
            }}
            placeholder="说点什么..."
            enterKeyHint="send"
            className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] text-black/90 outline-none placeholder:text-black/35"
          />
          <button
            type="button"
            aria-label="表情"
            onClick={() => onToast('表情（演示）')}
            className="grid h-9 w-9 shrink-0 place-items-center active:opacity-70"
          >
            <SmilePlus className="h-[19px] w-[19px] text-black/45" strokeWidth={2} />
          </button>
        </div>
        {input.trim() ? (
          <button
            type="button"
            onClick={() => void sendText(input)}
            className="h-9 shrink-0 rounded-full bg-[#FF5000] px-4 text-[13.5px] text-white active:opacity-80"
          >
            发送
          </button>
        ) : (
          <>
            <button
              type="button"
              aria-label="咨询宝贝"
              onClick={sendProductCard}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5"
            >
              <ShoppingBag className="h-[22px] w-[22px] text-black/75" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="更多"
              onClick={() => onToast('更多（演示）')}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5"
            >
              <Plus className="h-[22px] w-[22px] text-black/75" strokeWidth={2} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
