'use client';

/**
 * 商家中心 = 全部我入驻的店铺（美团「我的-入驻美团 / 添加商户」入口页）毛玻璃风格：
 * - 顶部概览条：已入驻 N 家 · 营业中 M 家；
 * - 店铺卡（毛玻璃）：封面（无图用渐变+线条图标，不用 emoji）、名称+营业状态、评分/菜品数/起送/配送、券摘要；
 *   轻点卡片 → 管理店铺；长按卡片 → 呼出「编辑 / 删除」毛玻璃操作弹层（卡上不放按钮）；
 * - 「添加店铺」大按钮 + 空状态入驻引导；
 * - 任何改动后回调 onChanged（父组件把首页信息流缓存置为失效，新店/改动即时露出）。
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  Pencil,
  Plus,
  Star,
  Store,
  Ticket,
  Trash2,
} from 'lucide-react';
import { MT_CATS, mtRegisterMyMerchants, mtUnregisterMerchant, mtUnregisterMyMerchants, type MtMerchant } from '@/lib/ios/meituan-data';
import { mtLoadCart, mtLoadShops, mtSaveCart, mtSaveShops, mtUidOf, type MtSession } from '@/lib/ios/meituan-store';
import { GLASS_CAPSULE, GLASS_PANEL, HoldActionsSheet, MERCHANT_PAGE_BG, ShopImg, useLongPress, type HoldAction } from './mt-merchant-ui';

const MT_YELLOW = '#FFD100';
const money = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
/** 分类 id → 展示名（未知 id 原样展示） */
const catName = (id: string): string => MT_CATS.find((c) => c.id === id)?.name ?? id;

/** 单张店铺卡（独立组件以便挂长按 hook） */
function CenterShopCard({
  shop,
  onTap,
  onHold,
  onToggle,
}: {
  shop: MtMerchant;
  onTap: () => void;
  onHold: () => void;
  onToggle: () => void;
}) {
  const hold = useLongPress(onHold);
  const { pressing, ...holdProps } = hold;
  const closed = shop.mtStatus === 'closed';
  const dishCount = shop.sections.reduce((acc, x) => acc + x.dishes.length, 0);
  return (
    <div
      {...holdProps}
      data-testid="mt-center-shop"
      className={`relative overflow-hidden rounded-3xl shadow-[0_10px_32px_rgba(96,74,10,0.08)] backdrop-blur-2xl ring-1 ring-white/75 transition-all ${pressing ? 'scale-[0.985] bg-white/85' : 'bg-white/68'} ${closed ? 'opacity-75' : ''}`}
    >
      <div className="flex items-center gap-3 p-3">
        <button type="button" aria-label={`管理店铺${shop.name}`} onClick={onTap} className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-2xl active:opacity-80">
          <ShopImg name={shop.name} cover={shop.cover} className="h-full w-full" />
        </button>
        <button type="button" onClick={onTap} className="min-w-0 flex-1 text-left active:opacity-80">
          <span className="flex items-center gap-1.5 text-[15px] font-bold text-black/85">
            <span className="truncate">{shop.name}</span>
            <span className={`shrink-0 rounded px-1 py-px text-[9px] font-normal ${closed ? 'bg-black/[0.06] text-black/45' : 'bg-[#FFF3C4] text-[#8A6A00]'}`}>{closed ? '已打烊' : '营业中'}</span>
          </span>
          <span className="mt-1 flex items-center gap-1 text-[11px] text-black/45">
            <span className="flex items-center gap-0.5 text-[#FF6000]">
              <Star className="h-2.5 w-2.5 fill-[#FF6000]" strokeWidth={0} />
              {shop.rating}
            </span>
            <span>· {dishCount}道菜 · 起送¥{money(shop.minOrder)} · 配送¥{money(shop.deliveryFee)}</span>
          </span>
          {shop.coupons && shop.coupons.length > 0 ? (
            <span className="mt-1 flex items-center gap-1 truncate text-[11px] text-[#FF4B33]">
              <Ticket className="h-3 w-3 shrink-0" />
              {shop.coupons.map((c) => (c.min > 0 ? `满${money(c.min)}减${money(c.amount)}` : `无门槛减${money(c.amount)}`)).join(' · ')}
            </span>
          ) : (
            <span className="mt-1 block truncate text-[11px] text-black/30">{shop.cats.map(catName).join(' / ')}</span>
          )}
        </button>
        {/* 营业开关 */}
        <span className="flex shrink-0 flex-col items-center gap-0.5">
          <button
            type="button"
            role="switch"
            aria-checked={!closed}
            aria-label={`营业状态：${shop.name}`}
            data-testid={`mt-shop-toggle-${shop.id}`}
            onClick={onToggle}
            className="relative h-[26px] w-[46px] rounded-full transition-colors"
            style={{ background: closed ? '#D8D8D8' : MT_YELLOW }}
          >
            <span className="absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all" style={{ left: closed ? 2 : 22 }} />
          </button>
          <span className="text-[9px] text-black/35">{closed ? '打烊' : '营业'}</span>
        </span>
      </div>
      {/* 长按提示条 */}
      <p className="border-t border-white/60 bg-white/40 px-3.5 py-1.5 text-center text-[10px] text-black/30">轻点进店管理 · 长按可编辑 / 删除</p>
    </div>
  );
}

export default function MerchantCenterPage({
  session,
  onBack,
  onCreate,
  onEdit,
  onManage,
  onChanged,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  /** 新建店铺 → 入驻表单 */
  onCreate: () => void;
  /** 编辑店铺 → 入驻表单（回填） */
  onEdit: (id: string) => void;
  /** 管理店铺 → 店铺管理页（头图+页签+黄色加号加菜） */
  onManage: (id: string) => void;
  /** 店铺数据有变（增/删/上下架）→ 首页信息流失效 */
  onChanged: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const [shops, setShops] = useState<MtMerchant[]>(() => mtLoadShops(uid));
  const [confirmDel, setConfirmDel] = useState<MtMerchant | null>(null);
  const [holdShop, setHoldShop] = useState<MtMerchant | null>(null);

  const reload = () => setShops(mtLoadShops(uid));

  const toggleStatus = (s: MtMerchant) => {
    const nextStatus: 'open' | 'closed' = s.mtStatus === 'closed' ? 'open' : 'closed';
    const list = mtLoadShops(uid).map((x) => (x.id === s.id ? { ...x, mtStatus: nextStatus } : x));
    mtSaveShops(uid, list);
    // 注册表重建：先清全部 my-shop-* 再挂回现存列表（详情页/搜索池即时同步）
    mtUnregisterMyMerchants();
    mtRegisterMyMerchants(list);
    onChanged();
    reload();
    onToast(nextStatus === 'closed' ? `「${s.name}」已打烊，首页不再展示` : `「${s.name}」恢复营业`);
  };

  const removeShop = (s: MtMerchant) => {
    const list = mtLoadShops(uid).filter((x) => x.id !== s.id);
    mtSaveShops(uid, list);
    mtUnregisterMerchant(s.id);
    // 该店若正挂在购物车里 → 清空购物车行（订单历史快照不受影响）
    const cart = mtLoadCart(uid);
    if (cart.merchantId === s.id) {
      mtSaveCart(uid, { merchantId: null, items: [] });
    }
    setConfirmDel(null);
    onChanged();
    reload();
    onToast(`「${s.name}」已删除`);
  };

  const holdActions = (s: MtMerchant): HoldAction[] => [
    { label: '编辑店铺', icon: Pencil, testid: `mt-hold-edit-${s.id}`, onClick: () => onEdit(s.id) },
    { label: '删除店铺', icon: Trash2, testid: `mt-hold-del-${s.id}`, danger: true, onClick: () => setConfirmDel(s) },
  ];

  const openCount = shops.filter((s) => s.mtStatus !== 'closed').length;

  return (
    <div className={`relative flex h-full flex-col ${MERCHANT_PAGE_BG}`}>
      {/* 顶栏（毛玻璃胶囊条） */}
      <div className="z-10 flex shrink-0 items-center gap-2 border-b border-white/60 bg-white/55 px-3 pb-3 pt-[54px] backdrop-blur-2xl">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-white/70 active:bg-white">
          <ChevronLeft className="h-5 w-5 text-black/70" />
        </button>
        <div className="min-w-0">
          <p className="text-[16px] font-bold leading-tight text-black/85">商家中心</p>
          <p className="text-[10px] leading-tight text-black/35">全部我入驻的店铺</p>
        </div>
        <button
          type="button"
          aria-label="添加店铺"
          data-testid="mt-center-add-top"
          onClick={onCreate}
          className="ml-auto grid h-9 w-9 place-items-center rounded-full shadow-[0_6px_16px_rgba(255,190,0,0.4)] active:opacity-80"
          style={{ background: MT_YELLOW }}
        >
          <Plus className="h-5 w-5 text-black/85" strokeWidth={2.4} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* 概览条（毛玻璃胶囊） */}
        {shops.length > 0 && (
          <div className={`flex items-center gap-2.5 rounded-3xl px-4 py-3 ${GLASS_PANEL}`} data-testid="mt-center-summary">
            <span className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-[#FFF3C4] to-[#FFD100]/70">
              <Store className="h-4.5 w-4.5 text-[#8A4B00]" strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-black/80">已入驻 {shops.length} 家店铺</p>
              <p className="text-[11px] text-black/40">营业中 {openCount} 家{shops.length - openCount > 0 ? ` · 已打烊 ${shops.length - openCount} 家` : ''}</p>
            </div>
          </div>
        )}

        {shops.length === 0 ? (
          /* 空状态引导（毛玻璃卡） */
          <div className={`mt-14 flex flex-col items-center rounded-[32px] px-6 py-10 ${GLASS_PANEL}`} data-testid="mt-center-empty">
            <span className="grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-[#FFF3C4] to-[#FFD100]/60 shadow-[0_10px_30px_rgba(255,190,0,0.25)]">
              <Store className="h-10 w-10 text-[#8A4B00]" strokeWidth={1.6} />
            </span>
            <p className="mt-4 text-[17px] font-bold text-black/85">入驻美团，开一家自己的小店</p>
            <p className="mt-1.5 text-center text-[12px] leading-relaxed text-black/40">
              自定义店名与背景、上传菜品与小菜、
              <br />
              给奶茶配小料和大小杯定价、发店铺优惠券
            </p>
            <button
              type="button"
              data-testid="mt-center-create"
              onClick={onCreate}
              className="mt-6 h-12 rounded-full px-14 text-[15px] font-bold text-black/85 shadow-[0_10px_26px_rgba(255,190,0,0.45)] active:opacity-85"
              style={{ background: MT_YELLOW }}
            >
              立即入驻
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {shops.map((s) => (
              <CenterShopCard key={s.id} shop={s} onTap={() => onManage(s.id)} onHold={() => setHoldShop(s)} onToggle={() => toggleStatus(s)} />
            ))}
            <button
              type="button"
              data-testid="mt-center-add-more"
              onClick={onCreate}
              className={`flex h-12 items-center justify-center gap-1 rounded-3xl border border-dashed border-black/15 text-[14px] font-medium text-black/55 active:bg-white/80 ${GLASS_CAPSULE}`}
            >
              <Plus className="h-4 w-4" />
              添加店铺
            </button>
          </div>
        )}
      </div>

      {/* 长按操作弹层（编辑 / 删除） */}
      <AnimatePresence>
        {holdShop && (
          <HoldActionsSheet key={`mt-shop-hold-${holdShop.id}`} title={`「${holdShop.name}」`} actions={holdActions(holdShop)} onClose={() => setHoldShop(null)} />
        )}
      </AnimatePresence>

      {/* 删除确认（毛玻璃弹层） */}
      <AnimatePresence>
        {confirmDel && (
          <motion.div key="mt-del-confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50">
            <button type="button" aria-label="取消删除" className="absolute inset-0 bg-black/50" onClick={() => setConfirmDel(null)} />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'tween', duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-x-3 bottom-3 rounded-[32px] bg-white/80 px-6 pb-9 pt-6 shadow-[0_18px_50px_rgba(40,30,0,0.22)] backdrop-blur-2xl ring-1 ring-white/70"
              data-testid="mt-del-sheet"
            >
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#FFF0EB]">
                <Trash2 className="h-6 w-6 text-[#FF4B33]" strokeWidth={1.9} />
              </span>
              <p className="mt-3 text-center text-[16px] font-bold text-black/85">删除店铺「{confirmDel.name}」？</p>
              <p className="mt-2 text-center text-[12px] leading-relaxed text-black/40">
                删除后首页不再展示、无法再进店下单；
                <br />
                历史订单记录保留。该操作不可恢复。
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmDel(null)}
                  className="h-11 flex-1 rounded-full bg-black/[0.05] text-[14px] font-medium text-black/70 active:bg-black/[0.1]"
                >
                  再想想
                </button>
                <button
                  type="button"
                  data-testid="mt-del-confirm-btn"
                  onClick={() => removeShop(confirmDel)}
                  className="h-11 flex-1 rounded-full bg-[#FF4B33] text-[14px] font-semibold text-white shadow-[0_8px_22px_rgba(255,75,51,0.35)] active:opacity-85"
                >
                  确认删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
