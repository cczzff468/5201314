'use client';

/**
 * 商家入驻 / 编辑店铺（美团「我的-入驻美团」）毛玻璃风格：
 * - 店铺信息：店名、店铺背景图（上传压缩 dataURL）、分类多选、公告、地址、起送价、配送费；
 * - 店铺优惠券：自定义券名 / 门槛 / 减免金额（满 0 = 无门槛券），保存后详情页可领，
 *   满减券自动派生首页满减角标；
 * - 菜单（菜品 / 小菜 / 奶茶规格）不在这里维护：提交后进入「店铺管理页」→ 右下角黄色 + 加菜；
 * - 保存 → mtSaveShops（按账号隔离）+ mtRegisterAiMerchant（详情页/搜索/AI 代点即时生效）。
 *   图标全部使用 Lucide 线条图标（无 emoji）。
 */
import { useRef, useState } from 'react';
import {
  BadgePercent,
  ChevronLeft,
  ImagePlus,
  Info,
  Plus,
  Store,
  Ticket,
  Trash2,
} from 'lucide-react';
import {
  mtAutoEmoji,
  mtRegisterAiMerchant,
  type MtDish,
  type MtMerchant,
  type MtShopCouponDef,
} from '@/lib/ios/meituan-data';
import {
  mtCurAddrId,
  mtLoadAddresses,
  mtLoadShops,
  mtSaveShops,
  mtUidOf,
  type MtSession,
} from '@/lib/ios/meituan-store';
import { readImageFile } from './wechat';
import { GLASS_PANEL, MERCHANT_PAGE_BG } from './mt-merchant-ui';

const MT_YELLOW = '#FFD100';

/** 入驻可选分类（首页分类宫格映射的商家筛选 id 子集） */
const JOIN_CATS: { id: string; name: string }[] = [
  { id: 'waimai', name: '外卖' },
  { id: 'meishi', name: '美食' },
  { id: 'yinyin', name: '甜点饮品' },
  { id: 'hamburg', name: '汉堡披萨' },
  { id: 'mala', name: '麻辣烫' },
  { id: 'zaocan', name: '早餐' },
  { id: 'chaoshi', name: '超市便利' },
  { id: 'shuiguo', name: '水果' },
];

const num = (s: string): number => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
};
const money = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** 毛玻璃输入胶囊 */
const glassInput =
  'h-11 w-full rounded-2xl bg-white/62 px-3.5 text-[14px] text-black/85 outline-none backdrop-blur-xl ring-1 ring-white/80 placeholder:text-black/25 focus:bg-white/90 focus:ring-[#FFD100]';

export default function MerchantEditPage({
  session,
  editId,
  onBack,
  onSaved,
  onToast,
}: {
  session: MtSession;
  /** 有值 = 编辑已有店铺；空 = 新入驻 */
  editId: string | null;
  onBack: () => void;
  /** 保存成功（id） */
  onSaved: (id: string) => void;
  onToast: (m: string) => void;
}) {
  const uidKey = mtUidOf(session);
  const editing = editId ? mtLoadShops(uidKey).find((s) => s.id === editId) : undefined;
  const defAddr = (() => {
    try {
      const addrs = mtLoadAddresses(uidKey);
      return addrs.find((a) => a.id === mtCurAddrId(uidKey))?.text ?? addrs[0]?.text ?? '';
    } catch {
      return '';
    }
  })();

  const [name, setName] = useState(editing?.name ?? '');
  const [cover, setCover] = useState<string | undefined>(editing?.cover);
  const [cats, setCats] = useState<string[]>(editing?.cats?.filter((c) => JOIN_CATS.some((j) => j.id === c)) ?? []);
  const [notice, setNotice] = useState(editing?.notice ?? '');
  const [addr, setAddr] = useState(editing?.addr ?? defAddr);
  const [minOrder, setMinOrder] = useState(editing ? money(editing.minOrder) : '0');
  const [deliveryFee, setDeliveryFee] = useState(editing ? money(editing.deliveryFee) : '2');
  // 菜单分区不在本页维护，仅随保存透传（新店给两个默认分区，进店铺管理页加菜）
  const sectionsRef = useRef<{ cat: string; dishes: MtDish[] }[]>(
    editing?.sections ?? [
      { cat: '招牌推荐', dishes: [] },
      { cat: '热销爆款', dishes: [] },
    ]
  );
  const [coupons, setCoupons] = useState<MtShopCouponDef[]>(editing?.coupons ?? []);
  const [cName, setCName] = useState('');
  const [cMin, setCMin] = useState('');
  const [cAmount, setCAmount] = useState('');
  const bgRef = useRef<HTMLInputElement>(null);
  const [bgBusy, setBgBusy] = useState(false);

  const pickBg = async (f: File | null | undefined) => {
    if (!f) return;
    setBgBusy(true);
    try {
      setCover(await readImageFile(f, 1280));
    } catch {
      onToast('图片读取失败，换一张试试');
    }
    setBgBusy(false);
  };

  const save = () => {
    const n = name.trim();
    if (!n) {
      onToast('先给店铺起个名字吧');
      return;
    }
    if (cats.length === 0) {
      onToast('至少选择一个店铺分类');
      return;
    }
    const keptSections = sectionsRef.current.map((s) => ({ cat: s.cat.trim(), dishes: s.dishes })).filter((s) => s.cat);
    const finalSections = keptSections.length > 0 ? keptSections : [
      { cat: '招牌推荐', dishes: [] },
      { cat: '热销爆款', dishes: [] },
    ];
    const minO = num(minOrder);
    const fee = num(deliveryFee);
    const shop: MtMerchant = {
      id: editing?.id ?? `my-shop-${Date.now().toString(36)}`,
      name: n,
      emoji: editing?.emoji ?? mtAutoEmoji(n),
      cover,
      cats,
      rating: editing?.rating ?? 4.8,
      monthSale: editing?.monthSale ?? 88,
      minOrder: Number.isFinite(minO) && minO >= 0 ? minO : 0,
      deliveryFee: Number.isFinite(fee) && fee >= 0 ? fee : 2,
      distanceKm: editing?.distanceKm ?? 0.6,
      deliveryMin: editing?.deliveryMin ?? 28,
      notice: notice.trim() || undefined,
      // 满减券（min>0）自动派生首页满减角标；无门槛券只走领取抵扣
      deals: coupons.filter((c) => c.min > 0).map((c) => `满${money(c.min)}减${money(c.amount)}`),
      hours: '10:00 - 22:00',
      addr: addr.trim() || '附近',
      sections: finalSections,
      reviews: editing?.reviews ?? [],
      mine: true,
      coupons,
      mtStatus: editing?.mtStatus ?? 'open',
    };
    const list = mtLoadShops(uidKey);
    mtSaveShops(uidKey, editing ? list.map((s) => (s.id === editing.id ? shop : s)) : [shop, ...list]);
    // 即时注册进运行时注册表：详情页/搜索/AI 代点不需要重启就生效（同 id 覆盖）
    mtRegisterAiMerchant(shop);
    onToast(editing ? '店铺已保存' : '入驻成功，先去加几道菜吧');
    onSaved(shop.id);
  };

  const addCoupon = () => {
    const mn = num(cMin === '' ? '0' : cMin);
    const am = num(cAmount);
    if (!Number.isFinite(mn) || mn < 0) {
      onToast('门槛金额不正确');
      return;
    }
    if (!Number.isFinite(am) || am <= 0) {
      onToast('先填好减免金额');
      return;
    }
    if (mn > 0 && am > mn) {
      onToast('减免金额不能超过使用门槛');
      return;
    }
    const nm = cName.trim() || (mn > 0 ? '店铺满减券' : '无门槛券');
    setCoupons((p) => [...p, { id: `sc${Date.now().toString(36)}${p.length}`, name: nm, amount: am, min: mn }]);
    setCMin('');
    setCAmount('');
    setCName('');
  };

  return (
    <div className={`flex h-full flex-col ${MERCHANT_PAGE_BG}`}>
      {/* 顶栏（毛玻璃胶囊条） */}
      <div className="z-10 flex shrink-0 items-center gap-2 border-b border-white/60 bg-white/55 px-3 pb-3 pt-[54px] backdrop-blur-2xl">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-white/70 active:bg-white">
          <ChevronLeft className="h-5 w-5 text-black/70" />
        </button>
        <p className="text-[16px] font-bold text-black/85">{editing ? '编辑店铺' : '入驻美团'}</p>
        <span className="ml-auto rounded-full bg-[#FFF3C4] px-2 py-0.5 text-[10px] text-black/55">开店后店铺会出现在首页</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* 店铺信息 */}
        <p className="flex items-center gap-1.5 text-[15px] font-bold text-black/85">
          <Store className="h-4 w-4 text-black/60" strokeWidth={1.9} />
          店铺信息
        </p>
        {/* 背景图 */}
        <button
          type="button"
          data-testid="mt-shop-bg"
          onClick={() => bgRef.current?.click()}
          className="relative mt-3 block h-28 w-full overflow-hidden rounded-3xl bg-white/55 shadow-[0_10px_30px_rgba(96,74,10,0.08)] backdrop-blur-xl ring-1 ring-white/75 active:opacity-90"
          aria-label="上传店铺背景图"
        >
          {cover ? (
            <>
              <img src={cover} alt="店铺背景" className="h-full w-full object-cover" />
              <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white backdrop-blur-md">更换背景图</span>
            </>
          ) : (
            <span className="flex h-full flex-col items-center justify-center gap-1.5 border border-dashed border-black/15 text-black/35">
              {bgBusy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/15 border-t-black/45" /> : <ImagePlus className="h-6 w-6" strokeWidth={1.6} />}
              <span className="text-[12px]">上传店铺背景图</span>
            </span>
          )}
        </button>
        <input ref={bgRef} type="file" accept="image/*" hidden onChange={(e) => { void pickBg(e.target.files?.[0]); e.target.value = ''; }} />

        <div className="mt-3">
          <p className="mb-1.5 text-[12px] text-black/45">店铺名称</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：琳琳的奶茶铺" data-testid="mt-shop-name" className={glassInput} maxLength={16} />
        </div>

        <p className="mb-1.5 mt-3.5 text-[12px] text-black/45">店铺分类（可多选）</p>
        <div className="flex flex-wrap gap-2">
          {JOIN_CATS.map((c) => {
            const on = cats.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                data-testid={`mt-cat-${c.id}`}
                onClick={() => setCats((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                className={`h-8 rounded-full px-3.5 text-[13px] backdrop-blur-xl transition-colors ${on ? 'font-semibold text-black/85 shadow-[0_4px_14px_rgba(255,190,0,0.4)]' : 'bg-white/60 text-black/50 ring-1 ring-white/70'}`}
                style={on ? { background: MT_YELLOW } : undefined}
              >
                {c.name}
              </button>
            );
          })}
        </div>

        <div className="mt-3.5">
          <p className="mb-1.5 text-[12px] text-black/45">店铺公告（可选）</p>
          <input value={notice} onChange={(e) => setNotice(e.target.value)} placeholder="例：新店开业，全场上新价" className={glassInput} maxLength={24} />
        </div>
        <div className="mt-3">
          <p className="mb-1.5 text-[12px] text-black/45">店铺地址</p>
          <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="例：望京街道方恒国际中心B座" className={glassInput} maxLength={30} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1.5 text-[12px] text-black/45">起送价（¥）</p>
            <input value={minOrder} onChange={(e) => setMinOrder(e.target.value.replace(/[^\d.]/g, ''))} className={`${glassInput} text-center`} inputMode="decimal" placeholder="0" />
          </div>
          <div>
            <p className="mb-1.5 text-[12px] text-black/45">配送费（¥）</p>
            <input value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value.replace(/[^\d.]/g, ''))} className={`${glassInput} text-center`} inputMode="decimal" placeholder="2" />
          </div>
        </div>

        {/* 菜单引导（菜单管理已移到店铺管理页） */}
        <div className={`mt-4 flex items-start gap-2 rounded-2xl px-3.5 py-3 ${GLASS_PANEL}`}>
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#B77900]" strokeWidth={1.9} />
          <p className="text-[11px] leading-relaxed text-black/45">
            菜品、小菜、奶茶小料与大小杯定价在「店铺管理页」维护：提交后进入店铺，点右下角黄色 + 即可加菜。
          </p>
        </div>

        {/* 店铺优惠券 */}
        <p className="mt-5 flex items-center gap-1.5 text-[15px] font-bold text-black/85">
          <Ticket className="h-4 w-4 text-black/60" strokeWidth={1.9} />
          店铺优惠券
          <span className="ml-1 text-[11px] font-normal text-black/35">自定义券名 / 金额，买家领取下单抵扣</span>
        </p>
        {coupons.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {coupons.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 rounded-2xl bg-gradient-to-r from-[#FFF3C4]/90 to-[#FFEDAD]/90 px-3.5 py-2.5 shadow-[0_6px_18px_rgba(255,190,0,0.18)] backdrop-blur-xl ring-1 ring-[#FFD100]/55" data-testid={`mt-coupon-row-${c.name}`}>
                <BadgePercent className="h-4 w-4 shrink-0 text-[#8A4B00]" strokeWidth={1.9} />
                <span className="text-[18px] font-bold text-[#8A4B00]">¥{money(c.amount)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-[#5A4200]">{c.name}</p>
                  <p className="text-[10px] text-[#5A4200]/65">{c.min > 0 ? `满 ¥${money(c.min)} 可用` : '无门槛'} · 领取后 7 天有效</p>
                </div>
                <button type="button" aria-label={`删除优惠券${c.name}`} onClick={() => setCoupons((p) => p.filter((x) => x.id !== c.id))} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#5A4200]/50 active:bg-black/5">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2.5 flex items-center gap-1.5">
          <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="券名（可空）" data-testid="mt-coupon-name" className="h-9 w-auto min-w-0 flex-1 rounded-xl bg-white/62 px-2.5 text-[12px] text-black/85 outline-none backdrop-blur-xl ring-1 ring-white/80 placeholder:text-black/25 focus:ring-[#FFD100]" maxLength={8} />
          <span className="shrink-0 text-[12px] text-black/45">满</span>
          <input value={cMin} onChange={(e) => setCMin(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" data-testid="mt-coupon-min" className="h-9 w-[52px] shrink-0 rounded-xl bg-white/62 px-1 text-center text-[13px] text-black/85 outline-none backdrop-blur-xl ring-1 ring-white/80 placeholder:text-black/25 focus:ring-[#FFD100]" style={{ minWidth: 52 }} inputMode="decimal" />
          <span className="shrink-0 text-[12px] text-black/45">减</span>
          <input value={cAmount} onChange={(e) => setCAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="5" data-testid="mt-coupon-amount" className="h-9 w-[52px] shrink-0 rounded-xl bg-white/62 px-1 text-center text-[13px] text-black/85 outline-none backdrop-blur-xl ring-1 ring-white/80 placeholder:text-black/25 focus:ring-[#FFD100]" style={{ minWidth: 52 }} inputMode="decimal" />
          <button
            type="button"
            data-testid="mt-coupon-add"
            onClick={addCoupon}
            className="flex h-9 shrink-0 items-center gap-0.5 rounded-xl px-3 text-[13px] font-semibold text-black/80 shadow-[0_4px_12px_rgba(255,190,0,0.35)] active:opacity-80"
            style={{ background: MT_YELLOW }}
          >
            <Plus className="h-3.5 w-3.5" />
            添加
          </button>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-black/30">满填 0 表示无门槛券；满减券（满&gt;0）会自动生成首页满减角标。</p>

        <p className="px-2 pb-2 pt-5 text-center text-[11px] leading-relaxed text-black/25">
          提交后店铺立即上架到首页瀑布流顶部，买家可以点进店铺下单；
          <br />
          店铺、菜单、券都保存在本机，按账号隔离。
        </p>
      </div>

      {/* 底部提交（毛玻璃条） */}
      <div className="z-10 shrink-0 border-t border-white/60 bg-white/60 px-4 pb-7 pt-3 backdrop-blur-2xl">
        <button
          type="button"
          data-testid="mt-shop-submit"
          onClick={save}
          className="h-12 w-full rounded-full text-[15px] font-bold text-black/85 shadow-[0_8px_22px_rgba(255,190,0,0.45)] active:opacity-85"
          style={{ background: MT_YELLOW }}
        >
          {editing ? '保存修改' : '提交入驻'}
        </button>
      </div>
    </div>
  );
}
