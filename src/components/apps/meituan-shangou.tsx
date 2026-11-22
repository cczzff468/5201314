'use client';

/**
 * 闪购频道（超市便利/水果/鲜花/药品即时配送，30~60 分钟送达）：
 * - 数据：POST /api/mt-feed filter='shangou'（AI 生成闪购商家）→ 失败/不足时本地种子兜底
 * - 结构：分类 chips → 闪购商家列表（门头/评分/起送/配送/月售）→ 店页（分节商品 + 加购）
 *   → 底部购物车条 → 确认弹层（地址/商品/配送费/包装费）→ kind:'waimai' 建单 → 收银台
 *   （闪购单走外卖配送状态机：接单→骑手→地图轨迹→送达）
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, Minus, Plus, Zap } from 'lucide-react';
import { FoodImg } from './mt-food-img';
import { mtImg, mtRegisterAiMerchant, type MtDish, type MtMerchant } from '@/lib/ios/meituan-data';
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import {
  mtCurAddrId,
  mtDeliveryMinutesOf,
  mtLoadAddresses,
  mtLoadOrders,
  mtSaveOrders,
  mtUidOf,
  type MtAddress,
  type MtOrder,
  type MtSession,
} from '@/lib/ios/meituan-store';
import { useSettings } from '@/lib/ios/store';

// ---------------- 本地种子闪购商家（AI 不可用时的完整兜底） ----------------

const d = (id: string, name: string, price: number, emoji: string, tag: string, monthSale: string | number): MtDish => ({
  id,
  name,
  price,
  emoji,
  monthSale: typeof monthSale === 'number' ? monthSale : Number(String(monthSale).replace(/[^\d]/g, '')) || 300,
  img: mtImg(tag, 480, 360, (id.length * 7) % 20, 'f'),
});

function shopOf(
  id: string,
  name: string,
  emoji: string,
  tag: string,
  rating: number,
  monthSale: number,
  minOrder: number,
  deliveryFee: number,
  deliveryMin: number,
  distanceKm: number,
  deals: string[],
  addr: string,
  sections: { cat: string; dishes: MtDish[] }[]
): MtMerchant {
  return {
    id,
    name,
    emoji,
    cover: mtImg(tag, 480, 360, id.length % 20, 'c'),
    cats: ['shangou'],
    rating,
    monthSale,
    minOrder,
    deliveryFee,
    distanceKm,
    deliveryMin,
    deals,
    hours: '24小时营业',
    addr,
    sections,
    reviews: [],
  };
}

const SEED_SHOPS: MtMerchant[] = [
  shopOf('sg-market', '鲜丰生活超市（幸福里店）', '🛒', 'supermarket', 4.7, 21000, 15, 2, 32, 1.2, ['满29减4', '新客立减3'], '幸福里小区南门东侧', [
    { cat: '热销推荐', dishes: [d('m1', '冰镇可乐 500ml', 3.5, '🥤', 'cola', '月售9000+'), d('m2', '鸡蛋 10 枚装', 12.9, '🥚', 'egg', '月售6000+'), d('m3', '酸奶 200g×3', 15.9, '🥛', 'juice', '月售5000+'), d('m4', '全麦吐司面包', 9.9, '🍞', 'bread', '月售4000+')] },
    { cat: '零食饮料', dishes: [d('m5', '香辣方便面 5 连包', 11.5, '🍜', 'noodles', '月售3000+'), d('m6', '冰镇矿泉水 550ml', 2, '💧', 'cola', '月售9000+')] },
    { cat: '日用清洁', dishes: [d('m7', '抽纸 3 层 8 包', 12.9, '🧻', 'store', '月售7000+'), d('m8', '洗衣液 1kg', 19.9, '🧴', 'store', '月售2000+')] },
  ]),
  shopOf('sg-store', '邻里便利店·南关街 24h', '🏪', 'store', 4.6, 13000, 0, 1, 25, 0.6, ['夜宵热卖中'], '南关老街 12 号', [
    { cat: '热销推荐', dishes: [d('c1', '关东煮 3 串组合', 9.9, '🍢', 'soup', '月售4000+'), d('c2', '溏心卤蛋', 3.5, '🥚', 'egg', '月售3000+'), d('c3', '冰淇淋甜筒', 5.5, '🍦', 'ice-cream', '月售2500+')] },
    { cat: '饮料咖啡', dishes: [d('c4', '冰美式咖啡', 12, '☕', 'coffee', '月售2000+'), d('c5', '冰镇可乐 500ml', 4, '🥤', 'cola', '月售5000+')] },
    { cat: '速食简餐', dishes: [d('c6', '金枪鱼饭团', 7.9, '🍙', 'rice', '月售1800+'), d('c7', '三明治·金枪鱼', 11.9, '🥪', 'sandwich', '月售1500+')] },
  ]),
  shopOf('sg-fruit', '果小满·水果闪购', '🍓', 'fruit', 4.8, 9800, 10, 2, 30, 1.8, ['坏果包赔'], '望京街道湖光中街', [
    { cat: '热销推荐', dishes: [d('f1', '红颜草莓盒 250g', 15.9, '🍓', 'fruit', '月售4000+'), d('f2', '智利车厘子 250g', 29.9, '🍒', 'fruit', '月售3500+'), d('f3', '香蕉 1 把约 5 根', 5.9, '🍌', 'fruit', '月售5000+')] },
    { cat: '当季鲜果', dishes: [d('f4', '麒麟西瓜盒装 500g', 8.9, '🍉', 'fruit', '月售3000+'), d('f5', '进口蓝莓 125g', 12.9, '🫐', 'fruit', '月售2200+'), d('f6', '赣南脐橙 4 个', 9.9, '🍊', 'fruit', '月售2600+')] },
  ]),
  shopOf('sg-flower', '花田小铺·鲜花速递', '💐', 'flower', 4.9, 5600, 20, 3, 40, 2.6, ['30 分钟极速达'], '建设路 88 号', [
    { cat: '热销推荐', dishes: [d('fl1', '红玫瑰花束·9 朵', 59, '🌹', 'flower', '月售900+'), d('fl2', '向日葵单支', 9.9, '🌻', 'flower', '月售1200+'), d('fl3', '康乃馨花束·12 朵', 49, '🌸', 'flower', '月售700+')] },
    { cat: '花束礼盒', dishes: [d('fl4', '满天星花束', 39, '✨', 'flower', '月售600+'), d('fl5', '尤加利配草一把', 6.9, '🌿', 'flower', '月售400+')] },
  ]),
  shopOf('sg-pharm', '益丰堂大药房·闪购店', '💊', 'medicine', 4.8, 7200, 0, 1.5, 28, 1.1, ['24h 应急送药'], '学院路与建设路交叉口', [
    { cat: '应急药品', dishes: [d('p1', '感冒灵颗粒 10 袋', 13.8, '💊', 'pill', '月售2000+'), d('p2', '人工泪液滴眼液', 29, '💧', 'syrup', '月售800+'), d('p3', '医用口罩 10 只装', 9.9, '😷', 'mask', '月售3000+')] },
    { cat: '保健养生', dishes: [d('p4', '维生素C 泡腾片 20 片', 19.9, '🍊', 'vitamin', '月售1100+'), d('p5', '创可贴 20 片装', 6.5, '🩹', 'bandage', '月售1500+')] },
    { cat: '清洁护理', dishes: [d('p6', '免洗洗手液 500ml', 9.9, '🧴', 'sanitizer', '月售900+'), d('p7', '酒精棉片 100 片', 5.9, '🧽', 'sanitizer', '月售800+')] },
  ]),
  shopOf('sg-snack', '嘴不闲零食仓', '🍿', 'store', 4.7, 8800, 12, 1.5, 26, 0.9, ['满 39 减 6'], '红旗路 66 号', [
    { cat: '热销推荐', dishes: [d('s1', '原味薯片大包 104g', 8.9, '🥔', 'store', '月售4000+'), d('s2', '每日坚果混合装 30 包', 39.9, '🥜', 'store', '月售2500+'), d('s3', '海苔片 8 连包', 7.5, '🍙', 'store', '月售2000+')] },
    { cat: '甜品饮品', dishes: [d('s4', '棉花糖 500g 家庭装', 6.9, '🍬', 'dessert', '月售1200+'), d('s5', '冰镇酸梅汤 350ml', 4.9, '🧃', 'juice', '月售1800+')] },
  ]),
  shopOf('sg-clean', '洁管家日用百货', '🧺', 'supermarket', 4.5, 4300, 18, 2, 35, 2.2, ['次日可退'], '幸福里小区北门', [
    { cat: '日用百货', dishes: [d('g1', '垃圾袋 45 只装', 6.9, '🗑️', 'store', '月售1500+'), d('g2', '5 号电池 4 粒装', 9.9, '🔋', 'store', '月售900+'), d('g3', '数据线 1m 三合一', 12.9, '🔌', 'store', '月售700+')] },
    { cat: '清洁用品', dishes: [d('g4', '湿巾 80 抽 3 包', 8.9, '🧷', 'sanitizer', '月售1100+'), d('g5', '洗洁精 1.1kg', 9.9, '🧼', 'store', '月售800+')] },
  ]),
];

const SG_CATS = ['全部', '超市便利', '水果', '鲜花', '药品', '零食饮料', '日用百货'];

/** AI 闪购商家缓存（kv 持久化）：首次进入生成一次，之后进入直接用缓存，不再每次重新生成（需求「不该刷新生成的不要变」） */
const SG_AI_SHOPS_KEY = 'mt-shangou-ai-shops';

function catMatch(c: string, m: MtMerchant): boolean {
  if (c === '全部') return true;
  const kw: Record<string, string[]> = {
    超市便利: ['超市', '便利', '百货'],
    水果: ['水果', '果'],
    鲜花: ['花'],
    药品: ['药房', '药'],
    零食饮料: ['零食'],
    日用百货: ['日用', '洁', '百货'],
  };
  return (kw[c] ?? []).some((k) => m.name.includes(k));
}

// ---------------- 主组件 ----------------

export default function ShangouChannelPage({
  session,
  onBack,
  onOpenPay,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  onOpenPay: (o: MtOrder) => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const apiConfig = useSettings((s) => s.apiConfig);
  const [cat, setCat] = useState('全部');
  const [aiShops, setAiShops] = useState<MtMerchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [shop, setShop] = useState<MtMerchant | null>(null);
  const [cart, setCart] = useState<Record<string, { dish: MtDish; qty: number }>>({});
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // 先读持久缓存：有则直接用（进入页面不再重新生成，商家列表稳定）
      const cached = kvGet<MtMerchant[]>(SG_AI_SHOPS_KEY);
      if (Array.isArray(cached) && cached.length > 0) {
        cached.forEach((m) => mtRegisterAiMerchant(m));
        if (!alive) return;
        setAiShops(cached);
        setLoading(false);
        return;
      }
      try {
        const res = await fetch('/api/mt-feed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filter: 'shangou', count: 12, exclude: [], config: apiConfig }),
        });
        const j = (await res.json()) as { ok?: boolean; merchants?: MtMerchant[] };
        if (!alive) return;
        if (j.ok && Array.isArray(j.merchants) && j.merchants.length > 0) {
          j.merchants.forEach((m) => mtRegisterAiMerchant(m));
          kvSet(SG_AI_SHOPS_KEY, j.merchants);
          setAiShops(j.merchants);
        }
      } catch {
        /* AI 失败走种子兜底 */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const shops = useMemo(() => {
    const merged = [...aiShops, ...SEED_SHOPS.filter((s) => !aiShops.some((a) => a.name === s.name))];
    return merged.filter((m) => catMatch(cat, m));
  }, [aiShops, cat]);

  const addrs: MtAddress[] = useMemo(() => mtLoadAddresses(uid), [uid]);
  const curAddr: MtAddress = useMemo(() => addrs.find((a) => a.id === mtCurAddrId(uid)) ?? addrs[0], [addrs, uid]);

  const cartList = useMemo(() => Object.values(cart), [cart]);
  const cartCount = cartList.reduce((s, i) => s + i.qty, 0);
  const goodsTotal = Math.round(cartList.reduce((s, i) => s + i.dish.price * i.qty, 0) * 100) / 100;
  const packFee = cartCount > 0 ? 1 : 0;
  const payable = Math.round((goodsTotal + (shop?.deliveryFee ?? 0) + packFee) * 100) / 100;

  const setQty = useCallback((dish: MtDish, q: number) => {
    setCart((prev) => {
      if (q <= 0) {
        const next = { ...prev };
        delete next[dish.id];
        return next;
      }
      return { ...prev, [dish.id]: { dish, qty: q } };
    });
  }, []);

  const submit = () => {
    if (!shop || cartCount === 0) return;
    const now = Date.now();
    const order: MtOrder = {
      id: `mt${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      uid,
      merchantId: shop.id,
      merchantName: shop.name,
      merchantEmoji: shop.emoji,
      merchantImg: shop.cover,
      kind: 'waimai',
      items: cartList.map((i) => ({ dishId: i.dish.id, name: i.dish.name, price: i.dish.price, qty: i.qty, emoji: i.dish.emoji, img: i.dish.img })),
      itemTotal: goodsTotal,
      deliveryFee: shop.deliveryFee,
      discount: 0,
      total: Math.max(0.01, payable),
      address: curAddr,
      status: 'pendingPay',
      createdAt: now,
      statusLog: [{ status: 'pendingPay', at: now }],
    };
    mtSaveOrders(uid, [order, ...mtLoadOrders(uid)]);
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    setConfirming(false);
    setCart({});
    setShop(null);
    onToast('下单成功，请完成支付');
    onOpenPay(order);
  };

  // ---------------- 店页 ----------------

  if (shop) {
    const below = goodsTotal < shop.minOrder;
    return (
      <div className="relative flex h-full flex-col bg-[#F4F5F7]">
        <div className="shrink-0 bg-white pb-2.5 pt-[54px]">
          <div className="flex items-center gap-2 px-4">
            <button type="button" aria-label="返回" onClick={() => { setShop(null); setCart({}); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5">
              <ChevronLeft className="h-6 w-6 text-black/70" />
            </button>
            <p className="min-w-0 flex-1 truncate text-[17px] font-bold text-black/90">{shop.name}</p>
          </div>
          <div className="mt-1.5 flex items-center gap-2 px-5 text-[11px] text-black/45">
            <span className="text-[#FF8A00]">★{shop.rating}</span>
            <span>月售{shop.monthSale >= 10000 ? `${(shop.monthSale / 10000).toFixed(1)}万+` : `${shop.monthSale}+`}</span>
            <span>· 配送 ¥{shop.deliveryFee} · {mtDeliveryMinutesOf(shop.id)}分钟</span>
            <span>· {shop.distanceKm}km</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain pb-28">
          {shop.sections.map((sec) => (
            <div key={sec.cat} className="mt-2 bg-white px-4 py-3">
              <p className="text-[14px] font-bold text-black/85">{sec.cat}</p>
              <div className="mt-1 divide-y divide-black/[0.04]">
                {sec.dishes.map((dish) => {
                  const q = cart[dish.id]?.qty ?? 0;
                  return (
                    <div key={dish.id} className="flex items-center gap-3 py-2.5">
                      <FoodImg src={dish.img} emoji={dish.emoji} className="h-16 w-16 shrink-0 rounded-xl" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] text-black/85">{dish.name}</p>
                        <p className="mt-0.5 text-[11px] text-black/35">月售{dish.monthSale}+</p>
                        <p className="mt-1 text-[15px] font-bold" style={{ color: '#FF4B33' }}>
                          <span className="text-[11px]">¥</span>
                          {dish.price}
                        </p>
                      </div>
                      {q > 0 && (
                        <button type="button" aria-label="减少" onClick={() => setQty(dish, q - 1)} className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-black/20 text-black/45 active:bg-black/5">
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {q > 0 && <span className="min-w-5 shrink-0 text-center text-[14px] font-medium">{q}</span>}
                      <button type="button" aria-label="加入购物车" onClick={() => setQty(dish, q + 1)} className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#FFD100] text-black/80 active:opacity-80">
                        <Plus className="h-4 w-4" strokeWidth={2.4} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {/* 购物车条 */}
        <div className="absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-full bg-[#1F2430] py-2 pl-4 pr-2 text-white shadow-lg">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#FFD100] text-[17px]">🛒</span>
          <span className="min-w-0 flex-1 truncate text-[13px]">
            {cartCount > 0 ? (
              <>
                <span className="text-[16px] font-bold">¥{payable}</span>
                <span className="ml-1 text-white/50">配送费¥{shop.deliveryFee}·包装费¥{packFee}</span>
              </>
            ) : (
              <span className="text-white/60">未选购商品（起送 ¥{shop.minOrder}）</span>
            )}
          </span>
          <button
            type="button"
            disabled={cartCount === 0 || below}
            onClick={() => setConfirming(true)}
            className={`shrink-0 rounded-full px-5 py-2.5 text-[14px] font-semibold ${cartCount === 0 || below ? 'bg-white/15 text-white/40' : 'bg-[#FFD100] text-black/90'}`}
          >
            {below && cartCount > 0 ? `差¥${Math.round((shop.minOrder - goodsTotal) * 100) / 100}起送` : '去结算'}
          </button>
        </div>
        {confirming && (
          <div className="absolute inset-0 z-40 flex items-end bg-black/45" onClick={() => setConfirming(false)}>
            <div className="max-h-[80%] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
              <p className="text-[16px] font-bold text-black/90">确认订单</p>
              <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-[#FFF7DB] p-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#FFE066] text-[14px]">📍</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-black/85">{curAddr?.text ?? '请先在「我的-收货地址」添加地址'}</p>
                  <p className="text-[11px] text-black/40">{curAddr ? `${curAddr.name ?? ''} ${curAddr.phone ?? ''}` : ''}</p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {cartList.map((i) => (
                  <div key={i.dish.id} className="flex items-center justify-between text-[13px]">
                    <span className="min-w-0 flex-1 truncate text-black/70">{i.dish.name} × {i.qty}</span>
                    <span className="shrink-0 text-black/85">¥{Math.round(i.dish.price * i.qty * 100) / 100}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1 border-t border-black/[0.06] pt-2 text-[12px] text-black/55">
                <div className="flex justify-between"><span>商品合计</span><span>¥{goodsTotal}</span></div>
                <div className="flex justify-between"><span>配送费</span><span>¥{shop.deliveryFee}</span></div>
                <div className="flex justify-between"><span>包装费</span><span>¥{packFee}</span></div>
                <div className="flex justify-between pt-1 text-[14px] font-bold text-black/90"><span>实付</span><span className="text-[#FF4B33]">¥{payable}</span></div>
              </div>
              <p className="mt-2 flex items-center gap-1 text-[11px] text-black/40">
                <Clock3 className="h-3.5 w-3.5" /> 预计 {mtDeliveryMinutesOf(shop.id)} 分钟送达 · 超时赔付
              </p>
              <button type="button" onClick={submit} className="mt-3 h-12 w-full rounded-full bg-gradient-to-r from-[#FFC300] to-[#FF9500] text-[16px] font-semibold text-black/90 active:opacity-85">
                提交订单
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------------- 频道首页 ----------------

  return (
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      <div className="shrink-0 bg-gradient-to-b from-[#FFE066] to-[#FFEC9E] pb-3 pt-[54px]">
        <div className="flex items-center gap-2 px-4">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/75" />
          </button>
          <p className="text-[19px] font-bold text-black/90">闪购</p>
          <span className="flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-black/70">
            <Zap className="h-3 w-3 text-[#FF8A00]" /> 30分钟送达
          </span>
          <span className="flex-1" />
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SG_CATS.map((c) => (
            <button key={c} type="button" onClick={() => setCat(c)} className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] ${cat === c ? 'bg-[#1F2430] font-semibold text-[#FFD100]' : 'bg-white/85 text-black/65'}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-3">
        {loading && shops.length === 0 && (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 rounded-2xl bg-white p-3">
                <div className="h-20 w-20 shrink-0 animate-pulse rounded-xl bg-black/[0.06]" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-black/[0.06]" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-black/[0.05]" />
                  <div className="h-3 w-3/4 animate-pulse rounded bg-black/[0.05]" />
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-3">
          {shops.map((m) => (
            <button key={m.id} type="button" onClick={() => { setShop(m); setCart({}); }} className="flex w-full gap-3 rounded-2xl bg-white p-3 text-left active:opacity-90">
              <FoodImg src={m.cover} emoji={m.emoji} className="h-20 w-20 shrink-0 rounded-xl" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-black/90">{m.name}</span>
                <span className="mt-0.5 block text-[11px] text-black/45">
                  <span className="font-semibold text-[#FF8A00]">★ {m.rating}</span> 月售{m.monthSale >= 10000 ? `${(m.monthSale / 10000).toFixed(1)}万+` : `${m.monthSale}+`} · {mtDeliveryMinutesOf(m.id)}分钟 · {m.distanceKm}km
                </span>
                <span className="mt-0.5 block text-[11px] text-black/45">起送¥{m.minOrder} · 配送¥{m.deliveryFee}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {m.deals.slice(0, 2).map((x) => (
                    <span key={x} className="rounded-[3px] bg-[#FFECE6] px-1 text-[10px] leading-[1.6] text-[#FF4B33]">{x}</span>
                  ))}
                  <span className="rounded-[3px] bg-[#FFF1C0] px-1 text-[10px] leading-[1.6] text-[#B77900]">首单立减</span>
                </span>
              </span>
              <ChevronRight className="mt-8 h-4 w-4 shrink-0 text-black/20" />
            </button>
          ))}
        </div>
        {!loading && shops.length === 0 && (
          <p className="pt-16 text-center text-[13px] text-black/40">该分类暂无闪购商家</p>
        )}
      </div>
    </div>
  );
}
