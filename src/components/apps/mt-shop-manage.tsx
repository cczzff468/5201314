'use client';

/**
 * 店铺管理页（商家中心 → 点某个店铺进入；视觉对齐买家端店铺页）：
 * - 头图 + 店铺信息（logo / 店名 / ★评分 月售 时长·距离 / 公告）；
 * - 页签：点菜（左分区栏 + 右菜品列表，点菜品进编辑）/ 评价 / 商家 / 订单；
 * - 右下角「黄色大加号」悬浮按钮（外圈黄色光晕包裹）→ 添加菜品（独立全屏页）；
 * - 商家页签：店铺信息 / 营业开关 / 优惠券 / 编辑店铺 / 删除店铺（二次确认）；
 * - 全部图标使用 Lucide 线条图标（无 emoji），无图菜品用渐变 + 线条图标占位。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BadgePercent,
  Bike,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  Megaphone,
  PackageOpen,
  Pencil,
  Plus,
  QrCode,
  Receipt,
  Reply,
  Star,
  Store,
  Tags,
  Ticket,
  Trash2,
} from 'lucide-react';
import { MT_CATS, mtRegisterAiMerchant, mtUnregisterMerchant, type MtDish, type MtMerchant } from '@/lib/ios/meituan-data';
import {
  MT_STATUS_LABEL,
  mtLoadCart,
  mtLoadOrders,
  mtLoadShops,
  mtSaveCart,
  mtSaveOrders,
  mtSaveShops,
  mtDeliveryMinutesOf,
  mtUidOf,
  type MtOrder,
  type MtSession,
} from '@/lib/ios/meituan-store';
import { mtMarkShopOrdersSeen, mtShopUnseenCount } from '@/lib/ios/mt-shop-notify';
import { DishImg, GLASS_PANEL, MERCHANT_PAGE_BG, ShopImg } from './mt-merchant-ui';
import { PseudoQr } from './mt-scan';
import DishEditPage from './mt-dish-edit';

const MT_YELLOW = '#FFD100';
const MT_PRICE = '#FF4B33';

const money = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmtMoney = (n: number): string => money(Math.round(n * 100) / 100);
/** 分类 id → 展示名（未知 id 原样展示） */
const catName = (id: string): string => MT_CATS.find((c) => c.id === id)?.name ?? id;

export default function ShopManagePage({
  session,
  shopId,
  onBack,
  onEditShop,
  onChanged,
  onToast,
}: {
  session: MtSession;
  shopId: string;
  onBack: () => void;
  /** 编辑店铺信息（店名/背景/分类/优惠券）→ 入驻表单回填 */
  onEditShop: () => void;
  /** 店铺数据有变 → 首页信息流失效 */
  onChanged: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const loadShop = useCallback((): MtMerchant | undefined => mtLoadShops(uid).find((s) => s.id === shopId), [uid, shopId]);
  const [shop, setShop] = useState<MtMerchant | undefined>(() => loadShop());
  const [tab, setTab] = useState<'点菜' | '评价' | '商家' | '订单'>('点菜');
  const [activeCat, setActiveCat] = useState(0);
  const [dishPage, setDishPage] = useState<{ catIdx: number; dish: MtDish | null } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [orders, setOrders] = useState<MtOrder[]>(() => mtLoadOrders(uid).filter((o) => o.merchantId === shopId));
  const [unseen, setUnseen] = useState(0);
  const [qrOpen, setQrOpen] = useState(false);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const catRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 订单状态推进刷新（事件 + 轮询双通道，同 useOrdersTick 口径）
  useEffect(() => {
    const bump = () => setOrders(mtLoadOrders(uid).filter((o) => o.merchantId === shopId));
    const iv = setInterval(bump, 3000);
    window.addEventListener('mt-orders-changed', bump);
    return () => {
      clearInterval(iv);
      window.removeEventListener('mt-orders-changed', bump);
    };
  }, [uid, shopId]);

  // 商家接单红点：已支付未查看的新单数（进入「订单」页签时清零）
  useEffect(() => {
    setUnseen(mtShopUnseenCount(uid, shopId, orders));
  }, [uid, shopId, orders]);

  const reload = () => setShop(loadShop());

  /** 持久化店铺：保存 + 注册表同步 + 首页信息流失效 */
  const persist = (next: MtMerchant, toast: string) => {
    const list = mtLoadShops(uid);
    mtSaveShops(uid, list.map((s) => (s.id === next.id ? next : s)));
    mtRegisterAiMerchant(next);
    setShop(next);
    onChanged();
    onToast(toast);
  };

  const closed = shop?.mtStatus === 'closed';

  const toggleStatus = () => {
    if (!shop) return;
    const nextStatus: 'open' | 'closed' = shop.mtStatus === 'closed' ? 'open' : 'closed';
    persist({ ...shop, mtStatus: nextStatus }, nextStatus === 'closed' ? `「${shop.name}」已打烊，首页不再展示` : `「${shop.name}」恢复营业`);
  };

  const removeShop = () => {
    if (!shop) return;
    const list = mtLoadShops(uid).filter((x) => x.id !== shop.id);
    mtSaveShops(uid, list);
    mtUnregisterMerchant(shop.id);
    const cart = mtLoadCart(uid);
    if (cart.merchantId === shop.id) mtSaveCart(uid, { merchantId: null, items: [] });
    onChanged();
    onToast(`「${shop.name}」已删除`);
    onBack();
  };

  const saveDish = (catIdx: number, d: MtDish) => {
    if (!shop) return;
    const sections = shop.sections.map((s, i) => {
      if (i !== catIdx) return s;
      const exists = s.dishes.some((x) => x.id === d.id);
      return { ...s, dishes: exists ? s.dishes.map((x) => (x.id === d.id ? d : x)) : [...s.dishes, d] };
    });
    persist({ ...shop, sections }, '菜品已保存');
    setDishPage(null);
  };

  const deleteDish = (catIdx: number, d: MtDish) => {
    if (!shop) return;
    const sections = shop.sections.map((s, i) => (i !== catIdx ? s : { ...s, dishes: s.dishes.filter((x) => x.id !== d.id) }));
    persist({ ...shop, sections }, `「${d.name}」已删除`);
    setDishPage(null);
  };

  const myReviews = useMemo(
    () =>
      orders
        .filter((o) => o.review)
        .map((o) => ({
          orderId: o.id,
          user: `${session.name}（本店订单）`,
          rating: o.review!.rating,
          content: o.review!.content,
          time: new Date(o.review!.at).toLocaleDateString('zh-CN'),
          reply: o.review!.reply,
        })),
    [orders, session.name]
  );

  /** 商家回复买家评价（写入订单评价 reply，买家端店铺页同步展示） */
  const submitReply = () => {
    const orderId = replyFor;
    const text = replyText.trim();
    if (!orderId || !text) return;
    mtSaveOrders(
      uid,
      mtLoadOrders(uid).map((o) => (o.id === orderId && o.review ? { ...o, review: { ...o.review, reply: { text, at: Date.now() } } } : o))
    );
    setOrders(mtLoadOrders(uid).filter((o) => o.merchantId === shopId));
    setReplyFor(null);
    setReplyText('');
    onToast('已回复买家评价');
  };

  /** 打开「订单」页签：红点清零 */
  const openOrdersTab = () => {
    setTab('订单');
    mtMarkShopOrdersSeen(uid, shopId);
    setUnseen(0);
  };

  if (!shop) {
    // 店铺刚被删除等极端情况：给出兜底返回
    return (
      <div className={`flex h-full flex-col items-center justify-center gap-3 ${MERCHANT_PAGE_BG}`}>
        <PackageOpen className="h-10 w-10 text-black/25" strokeWidth={1.6} />
        <p className="text-[14px] text-black/45">店铺不存在或已删除</p>
        <button type="button" onClick={onBack} className="h-10 rounded-full px-8 text-[14px] font-medium text-black/80 shadow-[0_6px_16px_rgba(255,190,0,0.4)]" style={{ background: MT_YELLOW }}>
          返回商家中心
        </button>
      </div>
    );
  }

  const dishTotal = shop.sections.reduce((acc, s) => acc + s.dishes.length, 0);
  const liveOrderCount = orders.filter((o) => ['pendingPay', 'pendingAccept', 'accepted', 'delivering'].includes(o.status)).length;

  // 经营小统计（今日口径；从本店订单流水实时算，无新表）：今日订单/营业额/热销
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const paidOrders = orders.filter((o) => o.status !== 'canceled' && o.status !== 'pendingPay');
  const todayOrders = paidOrders.filter((o) => o.createdAt >= startOfToday.getTime());
  const todayRevenue = Math.round(todayOrders.reduce((s, o) => s + o.total, 0) * 100) / 100;
  const hotMap = new Map<string, number>();
  for (const o of todayOrders.length > 0 ? todayOrders : paidOrders) {
    for (const it of o.items) hotMap.set(it.name, (hotMap.get(it.name) ?? 0) + it.qty);
  }
  let hotName = '';
  let hotCount = 0;
  for (const [n, c] of hotMap) {
    if (c > hotCount || (c === hotCount && n > hotName)) {
      hotName = n;
      hotCount = c;
    }
  }

  return (
    <div className={`flex h-full flex-col ${MERCHANT_PAGE_BG}`}>
      {/* 头图（店铺背景；不放编辑笔图标，编辑入口在店铺信息右侧与「商家」页签） */}
      <div className="relative h-[150px] shrink-0">
        <ShopImg name={shop.name} cover={shop.cover} className="h-full w-full" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3 pt-[54px]">
          <button type="button" aria-label="返回商家中心" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-black/35 text-white backdrop-blur-md active:opacity-75">
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>
        {closed && (
          <div className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-center text-[11px] text-white">已打烊 · 首页暂停展示</div>
        )}
      </div>

      {/* 店铺信息（对齐买家端店铺头，毛玻璃 + 右侧编辑入口） */}
      <div className="relative z-10 border-b border-white/60 bg-white/60 px-4 pb-3.5 pt-3.5 backdrop-blur-2xl">
        <div className="flex gap-3">
          <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/80">
            <ShopImg name={shop.name} cover={shop.cover} className="h-full w-full" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-[19px] font-bold leading-snug text-black/85">
              {shop.name}
              <span className={`shrink-0 rounded px-1.5 py-px text-[9px] font-medium ${closed ? 'bg-black/[0.07] text-black/45' : 'bg-[#FFF3C4] text-[#8A6A00]'}`}>
                {closed ? '已打烊' : '营业中'}
              </span>
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[12px] text-black/50">
              <span className="flex items-center gap-0.5 text-[#FF6000]">
                <Star className="h-3 w-3 fill-[#FF6000]" strokeWidth={0} />
                <span className="font-semibold">{shop.rating}</span>
              </span>
              <span>月售{shop.monthSale}+</span>
              <span>{mtDeliveryMinutesOf(shop.id)}分钟 · {shop.distanceKm}km</span>
            </p>
          </div>
          {/* 编辑店铺入口（替代原头图右上角笔图标） */}
          <button
            type="button"
            aria-label="编辑店铺信息"
            data-testid="mt-manage-edit-shop"
            onClick={onEditShop}
            className="flex h-8 shrink-0 items-center gap-1 self-start rounded-full bg-white/75 px-3 text-[12px] font-medium text-[#B77900] shadow-sm backdrop-blur-xl ring-1 ring-[#FFD100]/60 active:opacity-75"
          >
            <Pencil className="h-3 w-3" />
            编辑
          </button>
        </div>
        <p className="mt-2 text-right text-[11px] text-black/35">公告：{shop.notice?.slice(0, 14) || '无'}</p>
      </div>

      {/* 页签（点菜/评价/商家/订单，毛玻璃胶囊条） */}
      <div className="z-10 flex shrink-0 items-center gap-6 border-b border-white/60 bg-white/55 px-5 backdrop-blur-2xl">
        {(['点菜', '评价', '商家', '订单'] as const).map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`mt-manage-tab-${t}`}
            onClick={() => (t === '订单' ? openOrdersTab() : setTab(t))}
            className={`relative py-2.5 text-[15px] ${tab === t ? 'font-bold text-black/85' : 'text-black/45'}`}
          >
            {t}
            {t === '订单' && unseen > 0 && (
              <span className="absolute -right-3 top-1.5 grid h-[14px] min-w-[14px] place-items-center rounded-full bg-[#FF3B30] px-0.5 text-[9px] font-bold text-white" data-testid="mt-manage-orders-dot">
                {unseen > 9 ? '9+' : unseen}
              </span>
            )}
            {t === '订单' && unseen === 0 && liveOrderCount > 0 && (
              <span className="absolute -right-3 top-1.5 grid h-[14px] min-w-[14px] place-items-center rounded-full bg-[#FF3B30] px-0.5 text-[9px] font-bold text-white">
                {liveOrderCount}
              </span>
            )}
            {tab === t && <span className="absolute -bottom-px left-1/2 h-[3px] w-7 -translate-x-1/2 rounded-full" style={{ background: MT_YELLOW }} />}
          </button>
        ))}
      </div>

      {/* 点菜：左分区栏 + 菜品列表（点菜品 → 编辑） */}
      {tab === '点菜' && (
        <div className="relative flex min-h-0 flex-1">
          <div className="w-[88px] shrink-0 overflow-y-auto bg-[#EDEEF0] pb-28 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {shop.sections.map((s, i) => (
              <button
                key={`${s.cat}-${i}`}
                type="button"
                onClick={() => {
                  setActiveCat(i);
                  catRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`flex w-full flex-col items-center gap-0.5 px-2 py-3.5 text-[12px] leading-tight ${activeCat === i ? 'bg-white font-semibold text-black/85' : 'text-black/50'}`}
              >
                <span>{s.cat}</span>
                <span className="text-[10px] text-black/35">{s.dishes.length}种</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto bg-white px-3 pb-32 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {shop.sections.map((s, i) => (
              <div key={`${s.cat}-${i}`} ref={(el) => { catRefs.current[i] = el; }} className="scroll-mt-2">
                <p className="py-2.5 text-[15px] font-bold text-black/80">{s.cat}</p>
                {s.dishes.length === 0 && (
                  <p className="pb-2 text-[12px] text-black/30">这个分区还没有菜，点右下角黄色「+」添加</p>
                )}
                {s.dishes.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    data-testid={`mt-manage-dish-${d.name}`}
                    onClick={() => setDishPage({ catIdx: i, dish: d })}
                    className={`flex w-full gap-2.5 py-2 text-left active:opacity-80 ${d.soldOut ? 'opacity-60' : ''}`}
                  >
                    <span className="relative shrink-0">
                      <DishImg name={d.name} img={d.img} className="h-[80px] w-[80px] rounded-xl" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1 text-[15px] font-semibold leading-snug text-black/85">
                        <span className="truncate">{d.name}</span>
                        {d.specs && d.specs.length > 0 && (
                          <span className="shrink-0 rounded bg-[#FFF3C4] px-1 py-px text-[9px] font-normal text-[#8A6A00]">{d.specs.length}组规格</span>
                        )}
                      </span>
                      {d.desc && <span className="mt-0.5 line-clamp-1 text-[11px] text-black/40">{d.desc}</span>}
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className="text-[11px] text-black/35">月售{d.monthSale}</span>
                        {d.coupon && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-[#FFF0EB] px-1 py-px text-[10px] text-[#FF4B33]" data-testid={`mt-dish-coupon-tag-${d.name}`}>
                            <Ticket className="h-2.5 w-2.5" />
                            券·{d.coupon.min > 0 ? `满${money(d.coupon.min)}` : '无门槛'}减{money(d.coupon.amount)}
                          </span>
                        )}
                        {d.soldOut && (
                          <span className="inline-flex items-center rounded bg-black/[0.06] px-1 py-px text-[10px] text-black/45" data-testid={`mt-manage-dish-soldout-${d.name}`}>
                            已售罄
                          </span>
                        )}
                      </span>
                      <span className="mt-auto flex items-end pt-1 text-[17px] font-bold" style={{ color: MT_PRICE }}>
                        <span className="text-[11px]">¥</span>
                        {fmtMoney(d.price)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {dishTotal === 0 && (
              <div className="flex flex-col items-center gap-2 pb-6 pt-14 text-black/30">
                <PackageOpen className="h-9 w-9" strokeWidth={1.5} />
                <p className="text-[13px]">还没有菜品，点右下角「+」添加第一道菜</p>
              </div>
            )}
          </div>

          {/* 右下角：黄色大加号（外圈黄色光晕包裹） */}
          <button
            type="button"
            aria-label="添加菜品"
            data-testid="mt-manage-add-dish"
            onClick={() => setDishPage({ catIdx: Math.min(activeCat, shop.sections.length - 1), dish: null })}
            className="group absolute bottom-7 right-5 z-20"
          >
            <span className="absolute -inset-2 rounded-full bg-[#FFD100]/30 transition-transform group-active:scale-90" aria-hidden="true" />
            <span
              className="relative grid h-14 w-14 place-items-center rounded-full shadow-[0_10px_24px_rgba(255,190,0,0.5)] ring-4 ring-white/70 transition-transform group-active:scale-90"
              style={{ background: MT_YELLOW }}
            >
              <Plus className="h-7 w-7 text-black/85" strokeWidth={2.8} />
            </span>
          </button>
        </div>
      )}

      {/* 评价 */}
      {tab === '评价' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className={`rounded-3xl px-4 pb-4 pt-3.5 ${GLASS_PANEL}`}>
            <div className="flex items-end gap-2">
              <span className="text-[34px] font-bold leading-none text-[#FF6000]">{shop.rating}</span>
              <span className="pb-1 text-[12px] text-black/40">综合评分 · 月售{shop.monthSale}+</span>
            </div>
          </div>
          {shop.reviews.length === 0 && myReviews.length === 0 ? (
            <div className="flex flex-col items-center gap-2 pb-10 pt-16 text-black/30">
              <Star className="h-9 w-9" strokeWidth={1.5} />
              <p className="text-[13px]">还没有评价，买家晒单后会显示在这里</p>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {myReviews.map((r, i) => (
                <div key={`my-${i}`} className="flex gap-2.5 border-b border-black/5 pb-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FFF1C0] to-[#FFD100] text-[14px] font-bold text-black/60">
                    {r.user.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-black/75">{r.user}</p>
                    <p className="mt-0.5 flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, si) => (
                        <Star key={si} className={`h-3 w-3 ${si < Math.round(r.rating) ? 'fill-[#FF6000] text-[#FF6000]' : 'text-black/15'}`} strokeWidth={1.5} />
                      ))}
                      <span className="ml-1 text-[11px] text-black/30">{r.time}</span>
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-black/70">{r.content}</p>
                    {r.reply && (
                      <p className="mt-1.5 rounded-xl bg-[#FFF7E6]/90 px-2.5 py-1.5 text-[12px] leading-relaxed text-black/65 backdrop-blur-xl" data-testid={`mt-shop-reply-${r.orderId}`}>
                        <span className="font-semibold text-[#B77900]">商家回复：</span>
                        {r.reply.text}
                      </p>
                    )}
                    {!r.reply && replyFor === r.orderId && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') submitReply();
                          }}
                          placeholder="回复买家…（最多40字）"
                          maxLength={40}
                          data-testid="mt-reply-input"
                          className="h-9 w-auto min-w-0 flex-1 rounded-xl bg-white/70 px-2.5 text-[12px] text-black/85 outline-none ring-1 ring-white/80 backdrop-blur-xl placeholder:text-black/25 focus:ring-[#FFD100]"
                        />
                        <button
                          type="button"
                          onClick={submitReply}
                          disabled={!replyText.trim()}
                          data-testid="mt-reply-send"
                          className={`h-9 shrink-0 rounded-xl px-3.5 text-[12px] font-semibold ${replyText.trim() ? 'text-black/85 shadow-[0_4px_12px_rgba(255,190,0,0.35)]' : 'bg-black/[0.06] text-black/30'}`}
                          style={replyText.trim() ? { background: MT_YELLOW } : undefined}
                        >
                          发送
                        </button>
                      </div>
                    )}
                    {!r.reply && replyFor !== r.orderId && (
                      <button
                        type="button"
                        onClick={() => {
                          setReplyFor(r.orderId);
                          setReplyText('');
                        }}
                        data-testid={`mt-reply-btn-${r.orderId}`}
                        className="mt-1.5 flex items-center gap-1 text-[12px] font-medium text-[#B77900] active:opacity-70"
                      >
                        <Reply className="h-3 w-3" />
                        回复
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {shop.reviews.map((r, i) => (
                <div key={`seed-${i}`} className="flex gap-2.5 border-b border-black/5 pb-4 last:border-0">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FFF1C0] to-[#FFD100] text-[14px] font-bold text-black/60">
                    {r.user.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-black/75">{r.user}</p>
                    <p className="mt-0.5 flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, si) => (
                        <Star key={si} className={`h-3 w-3 ${si < Math.round(r.rating) ? 'fill-[#FF6000] text-[#FF6000]' : 'text-black/15'}`} strokeWidth={1.5} />
                      ))}
                      <span className="ml-1 text-[11px] text-black/30">{r.time}</span>
                    </p>
                    {r.content && <p className="mt-1 text-[13px] leading-relaxed text-black/70">{r.content}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 商家：信息 / 营业开关 / 优惠券 / 危险操作（毛玻璃卡） */}
      {tab === '商家' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className={`rounded-3xl p-4 ${GLASS_PANEL}`}>
            <p className="flex items-center gap-1.5 text-[14px] font-bold text-black/80">
              <Store className="h-4 w-4 text-black/55" strokeWidth={1.9} />
              店铺信息
              <button type="button" data-testid="mt-manage-edit-info" onClick={onEditShop} className="ml-auto flex items-center gap-0.5 text-[12px] font-medium text-[#B77900] active:opacity-70">
                编辑店铺信息
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </p>
            <div className="mt-2.5 flex flex-col gap-2.5 text-[13px]">
              {([
                [Tags, '店铺分类', shop.cats.map(catName).join(' / ')],
                [Megaphone, '店铺公告', shop.notice || '无'],
                [Receipt, '店铺地址', shop.addr],
                [CalendarClock, '营业时间', shop.hours],
                [PackageOpen, '起送价', `¥${money(shop.minOrder)}`],
                [Bike, '配送费', `¥${money(shop.deliveryFee)}`],
              ] as [typeof Tags, string, string][]).map(([Icon, label, val]) => (
                <p key={label} className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-black/35" strokeWidth={1.9} />
                  <span className="w-16 shrink-0 text-black/40">{label}</span>
                  <span className="min-w-0 flex-1 truncate text-black/75">{val}</span>
                </p>
              ))}
            </div>
          </div>

          <div className={`mt-3 flex items-center rounded-3xl p-4 ${GLASS_PANEL}`}>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-black/80">营业状态</p>
              <p className="mt-0.5 text-[11px] text-black/40">{closed ? '已打烊：首页不再展示，买家无法下单' : '营业中：首页正常展示、可接单'}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!closed}
              aria-label="营业状态开关"
              data-testid="mt-manage-toggle"
              onClick={toggleStatus}
              className="relative h-[28px] w-[50px] shrink-0 rounded-full transition-colors"
              style={{ background: closed ? '#D8D8D8' : MT_YELLOW }}
            >
              <span className="absolute top-[2px] h-[24px] w-[24px] rounded-full bg-white shadow transition-all" style={{ left: closed ? 2 : 24 }} />
            </button>
          </div>

          {/* 店铺码（扫码直达本店；与美团「扫一扫」闭环） */}
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            data-testid="mt-manage-shop-qr"
            className={`mt-3 flex w-full items-center gap-3 rounded-3xl p-4 text-left ${GLASS_PANEL} active:opacity-80`}
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#FFF3C4] to-[#FFD100]/70">
              <QrCode className="h-5 w-5 text-[#8A4B00]" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-bold text-black/80">店铺码</span>
              <span className="block text-[11px] text-black/40">贴在店里 / 发给朋友，美团「扫一扫」直达本店</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-black/30" />
          </button>

          <div className={`mt-3 rounded-3xl p-4 ${GLASS_PANEL}`}>
            <div className="flex items-center">
              <p className="flex items-center gap-1.5 text-[14px] font-bold text-black/80">
                <Ticket className="h-4 w-4 text-black/55" strokeWidth={1.9} />
                店铺优惠券（{(shop.coupons ?? []).length}）
              </p>
              <button type="button" data-testid="mt-manage-coupon-edit" onClick={onEditShop} className="ml-auto flex items-center gap-0.5 text-[12px] font-medium text-[#B77900] active:opacity-70">
                去添加 / 编辑
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            {(shop.coupons ?? []).length === 0 ? (
              <p className="mt-2 text-[12px] text-black/35">还没有发券，满减券能帮店铺带来更多下单</p>
            ) : (
              <div className="mt-2.5 flex flex-col gap-2">
                {(shop.coupons ?? []).map((c) => (
                  <div key={c.id} className="flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[#FFF3C4]/90 to-[#FFEDAD]/90 px-3 py-2 ring-1 ring-[#FFD100]/50">
                    <BadgePercent className="h-4 w-4 shrink-0 text-[#8A4B00]" strokeWidth={1.9} />
                    <span className="text-[16px] font-bold text-[#8A4B00]">¥{money(c.amount)}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[#5A4200]/80">
                      {c.name} · {c.min > 0 ? `满 ¥${money(c.min)} 可用` : '无门槛券'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            data-testid="mt-manage-delete"
            onClick={() => setConfirmDel(true)}
            className="mt-3 flex h-12 w-full items-center justify-center gap-1.5 rounded-3xl bg-white/62 text-[14px] font-medium text-[#FF4B33] ring-1 ring-[#FF4B33]/25 backdrop-blur-xl active:bg-[#FFF0EB]"
          >
            <Trash2 className="h-4 w-4" />
            删除店铺
          </button>
        </div>
      )}

      {/* 订单：经营小统计 + 本店订单列表 */}
      {tab === '订单' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* 经营小统计（今日口径；从本店订单流水实时算，无新表） */}
          <div className={`rounded-3xl px-4 py-3.5 ${GLASS_PANEL}`} data-testid="mt-manage-stats">
            <p className="flex items-center gap-1.5 text-[14px] font-bold text-black/80">
              <Flame className="h-4 w-4 text-[#FF6000]" strokeWidth={1.9} />
              今日经营
            </p>
            <div className="mt-2.5 grid grid-cols-3 items-end gap-2 text-center">
              <div>
                <p className="text-[20px] font-bold leading-none text-black/85">{todayOrders.length}</p>
                <p className="mt-1.5 text-[10px] text-black/40">今日订单</p>
              </div>
              <div>
                <p className="text-[20px] font-bold leading-none" style={{ color: MT_PRICE }}>
                  ¥{fmtMoney(todayRevenue)}
                </p>
                <p className="mt-1.5 text-[10px] text-black/40">今日营业额</p>
              </div>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-bold leading-none text-black/85" title={hotName}>
                  {hotName || '—'}
                </p>
                <p className="mt-1.5 text-[10px] text-black/40">{hotName ? `热销·已售${hotCount}份` : '暂无热销'}</p>
              </div>
            </div>
            {todayOrders.length === 0 && paidOrders.length > 0 && (
              <p className="mt-2.5 text-[11px] text-black/35">今天还没开张 · 热销取自开店以来全部订单</p>
            )}
          </div>
          {orders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 pb-10 pt-16 text-black/30">
              <Receipt className="h-9 w-9" strokeWidth={1.5} />
              <p className="text-[13px]">还没有订单，买家下单后会显示在这里</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {orders.map((o) => {
                const canceled = o.status === 'canceled';
                return (
                  <div key={o.id} className={`rounded-3xl bg-white/68 p-3.5 backdrop-blur-2xl ring-1 ring-white/75 ${canceled ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 shrink-0 text-black/30" />
                      <span className="text-[11px] text-black/35">{new Date(o.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      <span className={`ml-auto text-[12px] font-semibold ${canceled ? 'text-black/35' : 'text-[#FF6000]'}`}>{MT_STATUS_LABEL[o.status]}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-black/75">
                      {o.items.map((it) => `${it.name}x${it.qty}`).join('，')}
                    </p>
                    <p className="mt-1.5 text-right text-[14px] font-bold text-black/85">
                      实收 <span style={{ color: MT_PRICE }}>¥{fmtMoney(o.total)}</span>
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 添加/编辑菜品（独立全屏页，页内推入动画） */}
      <AnimatePresence>
        {dishPage && dishPage.catIdx >= 0 && shop.sections[dishPage.catIdx] && (
          <motion.div
            key={`dish-${dishPage.catIdx}-${dishPage.dish?.id ?? 'new'}`}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-0 z-[60] bg-white"
          >
            <DishEditPage
              catName={shop.sections[dishPage.catIdx].cat}
              initial={dishPage.dish}
              onBack={() => setDishPage(null)}
              onSave={(d) => saveDish(dishPage.catIdx, d)}
              onDelete={(d) => deleteDish(dishPage.catIdx, d)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 删除店铺二次确认 */}
      <AnimatePresence>
        {confirmDel && (
          <motion.div key="mt-shop-del-confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[65]">
            <button type="button" aria-label="取消删除" className="absolute inset-0 bg-black/50" onClick={() => setConfirmDel(false)} />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'tween', duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-x-3 bottom-3 rounded-[32px] bg-white/80 px-6 pb-9 pt-6 shadow-[0_18px_50px_rgba(40,30,0,0.22)] backdrop-blur-2xl ring-1 ring-white/70"
              data-testid="mt-shop-del-sheet"
            >
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#FFF0EB]">
                <Trash2 className="h-6 w-6 text-[#FF4B33]" strokeWidth={1.9} />
              </span>
              <p className="mt-3 text-center text-[16px] font-bold text-black/85">删除店铺「{shop.name}」？</p>
              <p className="mt-2 text-center text-[12px] leading-relaxed text-black/40">
                删除后首页不再展示、无法再进店下单；
                <br />
                历史订单记录保留。该操作不可恢复。
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmDel(false)}
                  className="h-11 flex-1 rounded-full bg-black/[0.05] text-[14px] font-medium text-black/70 active:bg-black/[0.1]"
                >
                  再想想
                </button>
                <button
                  type="button"
                  data-testid="mt-shop-del-confirm-btn"
                  onClick={removeShop}
                  className="h-11 flex-1 rounded-full bg-[#FF4B33] text-[14px] font-semibold text-white shadow-[0_8px_22px_rgba(255,75,51,0.35)] active:opacity-85"
                >
                  确认删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 店铺码弹窗（伪二维码，同一店铺永远同一图案） */}
      <AnimatePresence>
        {qrOpen && (
          <motion.div key="mt-shop-qr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[70]">
            <button type="button" aria-label="关闭店铺码" className="absolute inset-0 bg-black/55" onClick={() => setQrOpen(false)} />
            <motion.div
              initial={{ scale: 0.9, y: 24 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'tween', duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              className="absolute left-1/2 top-1/2 w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white/92 px-6 pb-6 pt-7 text-center shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl ring-1 ring-white/70"
              data-testid="mt-shop-qr-modal"
            >
              <p className="truncate text-[15px] font-bold text-black/85">{shop.name}</p>
              <p className="mt-0.5 text-[11px] text-black/40">美团店铺码 · 扫一扫直达本店</p>
              <PseudoQr seed={shop.id} className="mx-auto mt-3.5 h-[196px] w-[196px]" />
              <p className="mt-3 text-[11px] text-black/35">打开美团「扫一扫」识别即可进店</p>
              <button type="button" onClick={() => setQrOpen(false)} className="mt-4 h-10 w-full rounded-full bg-black/[0.05] text-[13px] font-medium text-black/65 active:bg-black/[0.1]">
                关闭
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
