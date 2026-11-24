'use client';

/** 美团 App 频道域（第十八轮 #8 拆分）：酒店旅行/休闲玩乐/电影演出三频道（useFunChannel 数据钩子 + 页面/确认弹层）。 */

/**
 * 美团 App（桌面生活服务 App，仿真机界面）—— UI 对齐真机截图（2026-10 版）：
 * - 登录（截图1）：白底「欢迎登录美团」+86/密码胶囊输入、协议勾选、淡黄登录按钮、
 *   验证码登录切换、底部微信/数字身份/QQ 三圆标一键登录（读取联系人当前账号 + 授权卡）；
 *   登录态 localStorage mt-session 持久化，数据按 uid 隔离（meituan-store.ts）；
 * - 首页（截图2）：黄头定位/消息/扫一扫 + 搜索胶囊、两页 15 宫格分类（圆点翻页）、
 *   瀑布流「特价团」团购卡 + 商家外卖卡；
 * - 团购详情（截图6）/ 确认订单（截图7）：粉色特价团风格，直接购买/拼团 → 提交订单 → 支付；
 * - 购物车（截图3）：独立 Tab 页，收藏入口、空态插画、全选/合计/结算；
 * - 我的（截图4）：淡黄渐变头部 + 会员卡（右上切角会员中心白卡/五角星/成长值/三权益白卡/神券行）
 *   + 宫格 + 钱包 + 服务宫格 + 地址/切换账号/退出（已迁设置页）；
 * - 订单列表（截图5）：搜索/筛选/发票 + 全部/待付款/待收货·待使用/评价/退款售后 五页签，
 *   团购卡带「消费时间/免预约/共N杯」、更多/领神券/再来一单；
 * - 订单详情（截图8/9+取餐流程参考图）：白底 ETA 大标题（可点开「订单跟踪」时间线底栏，真实流水时间）+
 *   黄节点四段进度条 + 圆角骑手假地图（美团专送/真实剩余单量分钟气泡/放心吃）+ 更多/售后/催单/联系商家骑手 +
 *   灰底白卡订单信息（取件/收件地址、可展开订单号/下单时间/费用明细）+ 费用明细卡（放心吃/神券/红包/已优惠合计）
 *   + 遇到问题帮助卡；
 * - 待支付详情（截图10）：请在 XX:XX 内支付（15分钟真实倒计时）+ 现在支付预计送达 + ⋮/他人代付/立即支付 +
 *   取件/收件地址 + 实付款 + 帮助卡，⋮ 面板可取消订单；
 * - 支付：微信/QQ → 零钱/银行卡/亲属卡渠道（meituan-pay.ts 复用现有钱包），失败重试；
 *   亲属卡消费 recordFcSpend(channel='美团') → AI 记忆感知；余额不足灰显拦截；
 * - 图片：菜品/门头图统一本地 kawaii 卡通插画（goods-img.ts 预生成，Task 58；不再请求外部图库），
 *   订单/店铺小菜大图内底部带订单名白字贴片（FoodImg cap）；
 * - 全局状态推进与灵动岛通知见 MeituanOrderWatcher。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BadgePercent,
  BadgeJapaneseYen,
  Bell,
  Bike,
  BookOpen,
  BriefcaseMedical,
  Building,
  Cake,
  Car as CarIcon,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleDollarSign,
  Clapperboard,
  Plus,
  Clock as ClockIcon,
  Coins,
  Copy,
  CreditCard,
  Cross,
  Crosshair,
  Crown,
  Delete,
  Ellipsis,
  EllipsisVertical,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Frown,
  Footprints,
  Gamepad2,
  Gift,
  Gem,
  HandCoins,
  Handshake,
  Headset,
  Heart,
  Home as HomeIcon,
  House,
  Image as ImageIcon,
  ImageOff,
  Languages,
  Laugh,
  LayoutGrid,
  Leaf,
  Lock,
  MapPin,
  Meh,
  MessageCircleMore,
  Minus,
  PartyPopper,
  Phone as PhoneIcon,
  Plane,
  Orbit,
  PackagePlus,
  PackageSearch,
  Rabbit,
  Receipt,
  RefreshCw,
  RotateCw,
  ScanLine,
  Scissors,
  Search as SearchIcon,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Star,
  Stethoscope,
  Store,
  Ticket,
  Timer,
  Trash2,
  TriangleAlert,
  TreePine,
  Undo2,
  Users,
  Utensils,
  Wallet,
  Wand2,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { ISLAND_NAV_EVENT, takeNotifyNavigation } from '@/lib/ios/island-notify';
import { LocalToast, useLocalToast } from '../page-toast';
import { FoodImg } from '../mt-food-img';
import { MtOrderCreatePage } from '../mt-order-create';
import { MtProductManagePage } from '../mt-product-manage';
import { OrderImgGenSheet, type ImgGenModelOption } from '../order-img-gen';
import { generateFreePhoto } from '@/lib/imggen';
import { libPromptTextMulti } from '@/lib/prompt-entries';
import type { ImgGenConfig } from '@/lib/ios/store';
import MerchantCenterPage from '../mt-merchant-center';
import MerchantEditPage from '../mt-merchant-edit';
import ShopManagePage from '../mt-shop-manage';
import {
  MT_CATS,
  MT_DEALS,
  MT_HOME_GRID,
  MT_HOME_LIST,
  MT_MERCHANTS,
  MT_SHOP_BG,
  mtAllMerchants,
  mtApplyProductImgOverrides,
  mtCustomMerchantsAll,
  mtDealOf,
  mtDishesOf,
  mtImg,
  mtMerchantOf,
  mtPersistAiRegistry,
  mtRegisterAiDeal,
  mtRegisterAiMerchant,
  mtRegisterCustomMerchants,
  mtRegisterMyMerchants,
  mtRestoreAiRegistry,
  mtSetDealImg,
  mtSetProductImg,
  mtSetShopAvatar,
  mtShopAvatarOf,
  mtUnregisterCustomMerchant,
  mtUnregisterMyMerchants,
  type MtDeal,
  type MtDealPackage,
  type MtDish,
  type MtMerchant,
} from '@/lib/ios/meituan-data';
import { AI_PRODUCT_IMG_EVENT } from '@/lib/ios/ai-product-img';
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import type { FunDeal, FunHotel, FunMovie, FunRoom, FunVenue } from '@/app/api/mt-fun/route';
import TravelChannelPage from '../meituan-travel';
import ShangouChannelPage from '../meituan-shangou';
import { useSettings, useUI } from '@/lib/ios/store';
import { GoodsStyleSheet, GoodsStyleThumb } from '../goods-style-sheet';
import { DeliverySpeedSheet } from '../delivery-speed-sheet';
import { dsDescShort } from '@/lib/ios/delivery-speed';
import { mtNotifyShopOrderPaid } from '@/lib/ios/mt-shop-notify';
import { ScanOverlayWhen, openScan } from '../mt-scan';
import {
  mtAddBankCard,
  mtAddInvoice,
  mtActivateDrugFund,
  mtApplyCardQuota,
  mtApplyRefund,
  mtCanRefund,
  mtCardQuotaAvailable,
  mtCardQuotaUsed,
  mtCancelWithRefund,
  mtCheckoutCalc,
  mtClaimGodCoupons,
  mtClaimShopCoupon,
  mtClearHistory,
  mtClearPayPwdLock,
  mtClearSearchHist,
  mtCouponTypeLabel,
  mtCurAddrId,
  mtDeliveryMinutesOf,
  mtGetOrder,
  mtGetSearchHist,
  mtGetSession,
  mtApplyLoanCredit,
  mtBorrow,
  mtIdpLoggedIn,
  mtListUsableCoupons,
  mtLoanAvailable,
  mtLoanAprOf,
  mtLoanPlan,
  mtLoanRemainOf,
  mtLoanUsedCredit,
  mtLoadAddresses,
  mtLoadBankCards,
  mtLoadCart,
  mtLoadCoupons,
  mtLoadCustomShops,
  mtLoadFavs,
  mtLoadHistory,
  mtLoadCardQuota,
  mtLoadDrugFund,
  mtLoadInvoices,
  mtLoadLoanAccount,
  mtLoadLoans,
  mtLoadOrders,
  mtLoadPayPwd,
  mtLoadPayPwdLock,
  mtLoadShops,
  mtLoadWallet,
  mtLoadWalletBills,
  mtPushHistory,
  mtPushWalletBill,
  mtRecordPayPwdFail,
  mtRemoveBankCard,
  mtRemoveHistory,
  mtRepayLoanAll,
  mtRepayLoanPeriod,
  mtResolveIdpIdentity,
  mtSaveAddresses,
  mtSaveBankCards,
  mtSaveCart,
  mtSaveCustomShops,
  mtSaveOrders,
  mtSavePayPwd,
  mtSavePayPwdLock,
  mtSaveWallet,
  mtSetCurAddr,
  mtSetSession,
  mtSyncSessionIdentity,
  mtToggleFav,
  mtStatusBody,
  mtUidOf,
  mtUseCoupon,
  mtUseDrugFund,
  mtUrgeOrder,
  mtValidateSession,
  mtWalletRecharge,
  mtWalletWithdraw,
  MT_PAY_PWD_LOCK_MS,
  MT_PAY_PWD_MAX_FAIL,
  MT_STATUS_LABEL,
  MT_WALLET_BILL_LABEL,
  PAY_TIMEOUT_MS,
  takeMtPendingPage,
  type MtAddress,
  type MtBankCard,
  type MtCart,
  type MtCoupon,
  type MtFavs,
  type MtInvoice,
  type MtHistItem,
  type MtLoan,
  type MtLoanAccount,
  type MtOrder,
  type MtPayPwdLock,
  type MtSession,
  type MtWalletBill,
} from '@/lib/ios/meituan-store';
import { mtExecutePay, mtListPayChannels, type MtPayChannel } from '@/lib/ios/meituan-pay';
import { TbPullIndicator, useTbPullRefresh } from '../tb-pull-refresh';
import { WxPayPwdGate, wxLoadPayPwd } from '../wechat-wallet';
import { PayPwdGate as QqPayPwdGate, loadPayPwd as qqLoadPayPwd } from '../qq';
import { mtCreateProxyRequest, mtGetProxy, mtSyncProxiesForUid } from '@/lib/ios/mt-proxy-pay';
import { mtCreateOrderShare } from '@/lib/ios/mt-order-share';
import { MT_RIDERS, mtGetRiderId, mtRiderSrcOf, mtSetRiderId } from '@/lib/ios/mt-rider';
import { listContacts, loginQQ, loginWechat } from '@/lib/ios/contacts-store';
import { avatarFor, displayNameOf, isFriendIn, type ContactRecord } from '@/lib/contacts';
import { MtProxyDetailPage } from '../mt-proxy-detail';

import { Page, Tab, MT_YELLOW, MT_PRICE, MT_PINK, MT_ORANGE, mtCountUnit, fmtMoney, fmtTime, fmtDateTime, fmtDate, fmtDateTimeSec, maskPhone, MT_KEEPER_SURNAMES, mtMerchantContact, fmtTrackTime, mtStatusText, Stepper, useOrdersTick, EMPTY_FAVS, useFavs, TuanMark, DealCard, DealListCard, ShopAvatar, MerchantCard, FeedItem, feedName, interleave, shuffle, homeFeedCache, MT_HOME_FEED_KEY, MT_HOME_SCROLL_KEY, mtRestoreHomeFeed, mtPersistHomeFeed, mtPersistHomeScroll, localBatch, SmallPill, CopyBtn, InfoRow, stripDealQty, MtShareGlyph, ShareSheet, SettingsIcon, mtCatNameOf } from './shared';


// ================================ 频道页：酒店旅行 / 休闲玩乐 / 电影演出 ================================
// 首页宫格三大频道（/api/mt-fun AI 生成，失败走服务端种子）；图片走 /api/mt-img v7
// （Wikimedia Commons 真实酒店房间/电玩/KTV 实景）。下单复用 MtOrder（kind='tuangou'）→ 支付收银台。

export type FunKind = 'fun' | 'hotel' | 'movie';

/** 频道数据获取：挂载/主题变化 → /api/mt-fun（用户配置模型 → 内置模型 → 服务端种子） */

export function useFunChannel<T>(kind: FunKind, topic: string): { data: T[]; loading: boolean; reload: () => void } {
  const apiConfig = useSettings((s) => s.apiConfig);
  const apiCfgRef = useRef(apiConfig);
  useEffect(() => {
    apiCfgRef.current = apiConfig;
  }, [apiConfig]);
  const [payload, setPayload] = useState<{ topic: string; list: T[] } | null>(null);
  const fetchList = useCallback(
    async (t: string): Promise<T[]> => {
      try {
        const res = await fetch('/api/mt-fun', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, topic: t, config: apiCfgRef.current, count: 8 }),
        });
        const j = (await res.json().catch(() => null)) as { venues?: T[]; hotels?: T[]; movies?: T[] } | null;
        return kind === 'fun' ? (j?.venues ?? []) : kind === 'hotel' ? (j?.hotels ?? []) : (j?.movies ?? []);
      } catch {
        return [];
      }
    },
    [kind],
  );
  useEffect(() => {
    let live = true;
    void fetchList(topic).then((list) => {
      if (live) setPayload({ topic, list });
    });
    return () => {
      live = false; // 期间已切主题/刷新：丢弃过期批次
    };
  }, [topic, fetchList]);
  const reload = useCallback(() => {
    void fetchList(`${topic}换一批`).then((list) => setPayload({ topic, list }));
  }, [topic, fetchList]);
  const loading = payload === null || payload.topic !== topic;
  return { data: loading ? [] : payload.list, loading, reload };
}

/** 频道页骨架屏（列表加载动画） */

export function ChannelSkeleton({ card }: { card: 'hotel' | 'venue' | 'movie' }) {
  return (
    <div className="space-y-2.5 px-3 pt-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-3 rounded-xl bg-white p-3">
          <div className={card === 'movie' ? 'h-[120px] w-[90px] shrink-0 animate-pulse rounded-lg bg-black/[0.06]' : 'h-[86px] w-[116px] shrink-0 animate-pulse rounded-lg bg-black/[0.06]'} />
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-black/[0.06]" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-black/[0.05]" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-black/[0.05]" />
            <div className="h-5 w-20 animate-pulse rounded bg-black/[0.04]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 评分徽章（黄底白字，酒店/玩乐卡通用） */

export function RatingBadge({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="rounded-l-[4px] rounded-r-[2px] bg-[#FFB800] px-[5px] py-px text-[11px] font-bold text-white">{rating.toFixed(1)}</span>
      <span className="flex items-center">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} className={`h-[10px] w-[10px] ${i < Math.round(rating) ? 'fill-[#FFB800] text-[#FFB800]' : 'fill-black/10 text-black/10'}`} strokeWidth={0} />
        ))}
      </span>
    </span>
  );
}

/** 频道确认下单公共逻辑：建 MtOrder（kind='tuangou' 到店消费）→ 落库 → 进收银台 */

export function submitFunOrder(opts: {
  merchantId: string;
  merchantName: string;
  merchantEmoji: string;
  merchantImg?: string;
  item: { dishId: string; name: string; price: number; qty: number; emoji: string; img?: string; spec?: string };
  itemTotal: number;
  total: number;
}): MtOrder | null {
  const session = mtGetSession();
  const uid = session ? mtUidOf(session) : '';
  if (!uid) return null;
  const now = Date.now();
  const order: MtOrder = {
    id: `mt${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    uid,
    merchantId: opts.merchantId,
    merchantName: opts.merchantName,
    merchantEmoji: opts.merchantEmoji,
    merchantImg: opts.merchantImg,
    kind: 'tuangou',
    items: [{ dishId: opts.item.dishId, name: opts.item.name, price: opts.item.price, qty: opts.item.qty, emoji: opts.item.emoji, img: opts.item.img, spec: opts.item.spec }],
    itemTotal: Math.round(opts.itemTotal * 100) / 100,
    deliveryFee: 0,
    discount: Math.round((opts.itemTotal - opts.total) * 100) / 100,
    total: Math.max(0.01, Math.round(opts.total * 100) / 100),
    status: 'pendingPay',
    createdAt: now,
    statusLog: [{ status: 'pendingPay', at: now }],
  };
  const list = mtLoadOrders(uid);
  mtSaveOrders(uid, [order, ...list]);
  window.dispatchEvent(new CustomEvent('mt-orders-changed'));
  return order;
}

/** 今天/明天入住日期（MM-DD） */

export function funDates(): { checkIn: string; checkOut: string; label: string } {
  const d1 = new Date();
  const d2 = new Date(Date.now() + 86_400_000);
  const f = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { checkIn: f(d1), checkOut: f(d2), label: `${f(d1)} 入住 · ${f(d2)} 离店` };
}


// ---------------- 酒店旅行频道 ----------------

export const HOTEL_TABS = ['我的附近', '电竞开黑', '特色民宿', '大屏观影', '亲子遛娃'];


export function HotelChannelPage({ onBack, onOpenPay, onToast }: { onBack: () => void; onOpenPay: (o: MtOrder) => void; onToast: (m: string) => void }) {
  const [tab, setTab] = useState(HOTEL_TABS[0]);
  const { data: hotels, loading } = useFunChannel<FunHotel>('hotel', tab);
  const [sel, setSel] = useState<FunHotel | null>(null); // 酒店详情（房型列表）
  const [roomSel, setRoomSel] = useState<{ hotel: FunHotel; room: FunRoom } | null>(null); // 房型详情弹层
  const [confirmSel, setConfirmSel] = useState<{ hotel: FunHotel; room: FunRoom } | null>(null); // 确认订单弹层
  const scrollRef = useRef<HTMLDivElement>(null);
  const dates = funDates();

  if (sel) {
    return (
      <div className="flex h-full flex-col bg-[#F4F5F7]">
        <div className="relative shrink-0">
          <FoodImg src={sel.img} emoji={sel.emoji} cap={sel.name} className="h-[210px] w-full rounded-b-none" />
          <button type="button" aria-label="返回" onClick={() => setSel(null)} className="absolute left-3 top-[52px] grid h-9 w-9 place-items-center rounded-full bg-black/40 text-white active:opacity-75">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="absolute bottom-3 right-3 rounded-full bg-black/45 px-2 py-0.5 text-[11px] text-white">实景拍摄 · 相册</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="bg-white px-4 pb-3 pt-3">
            <p className="text-[19px] font-bold leading-snug text-black/90">{sel.name}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="rounded-[4px] bg-black/[0.05] px-1.5 py-px text-[11px] text-black/60">{sel.level}</span>
              {sel.tags.map((t) => (
                <span key={t} className="rounded-[4px] bg-[#FFF4E0] px-1.5 py-px text-[11px] text-[#B26B00]">{t}</span>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <RatingBadge rating={sel.rating} />
              <span className="text-[12px] text-black/45">「{sel.quote}」</span>
            </div>
            <p className="mt-2 flex items-center gap-1 text-[12px] text-black/50">
              <MapPin className="h-3.5 w-3.5 shrink-0" /> {sel.addr} · 距您驾车{sel.distanceKm}公里 · 约{sel.minutes}分钟
            </p>
          </div>
          <p className="px-4 pb-1 pt-3 text-[15px] font-bold text-black/85">选择房型</p>
          <div className="space-y-2 px-3 pb-6 pt-1">
            {sel.rooms.map((room) => (
              <button key={room.id} type="button" onClick={() => setRoomSel({ hotel: sel, room })} className="flex w-full gap-3 rounded-xl bg-white p-3 text-left active:bg-black/[0.02]">
                <FoodImg src={room.img} emoji="🛏️" className="h-[76px] w-[104px] shrink-0 rounded-lg" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[14px] font-semibold text-black/90">{room.name}</span>
                  <span className="mt-1 text-[11px] leading-relaxed text-black/45">{room.size} · {room.window} · {room.smoking} · {room.capacity}人</span>
                  <span className="text-[11px] text-black/45">{room.bed} · {room.breakfast}</span>
                  <span className="mt-auto flex items-end justify-between">
                    <span className="text-[16px] font-bold text-[#FF4B33]">¥{fmtMoney(room.price)}<span className="ml-0.5 text-[10px] font-normal text-black/35">起</span></span>
                    <span className="rounded-full bg-[#FFD100] px-4 py-1 text-[12px] font-semibold text-black/85">订</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <AnimatePresence>
          {roomSel && (
            <RoomSheet
              key="room-sheet"
              hotel={roomSel.hotel}
              room={roomSel.room}
              onClose={() => setRoomSel(null)}
              onBook={() => {
                setConfirmSel(roomSel);
                setRoomSel(null);
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {confirmSel && (
            <HotelConfirmSheet
              key="hotel-confirm"
              hotel={confirmSel.hotel}
              room={confirmSel.room}
              onClose={() => setConfirmSel(null)}
              onOpenPay={onOpenPay}
              onToast={onToast}
            />
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      {/* 顶栏：返回 + 酒店 + 日期 + 查找 */}
      <div className="shrink-0 bg-[#FFD100] px-3 pb-2.5 pt-[52px]">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/10">
            <ChevronLeft className="h-5 w-5 text-black/80" />
          </button>
          <span className="text-[17px] font-bold text-black/90">酒店</span>
          <span className="ml-1 flex min-w-0 flex-1 items-center gap-2 rounded-full bg-white px-3 py-1.5">
            <span className="shrink-0 text-[13px] font-semibold text-black/85">濮阳县</span>
            <span className="h-4 w-px shrink-0 bg-black/10" />
            <span className="flex min-w-0 flex-col leading-none">
              <span className="flex items-center gap-1 text-[10px] text-black/45">住 <span className="text-[11px] font-medium text-black/80">{dates.checkIn}</span></span>
              <span className="mt-0.5 flex items-center gap-1 text-[10px] text-black/45">离 <span className="text-[11px] font-medium text-black/80">{dates.checkOut}</span></span>
            </span>
            <span className="min-w-0 flex-1 truncate pl-1 text-[12px] text-black/35">位置/品牌</span>
            <SearchIcon className="h-3.5 w-3.5 shrink-0 text-black/40" />
          </span>
          <span className="shrink-0 rounded-full bg-white/0 px-1 text-[14px] font-semibold text-black/85">查找</span>
        </div>
        {/* 促销双卡 */}
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between rounded-xl bg-gradient-to-r from-[#FFE7B8] to-[#FFD98A] px-3 py-2">
            <span>
              <span className="block text-[14px] font-bold text-black/85">特价酒店</span>
              <span className="block text-[10px] text-black/50">好酒店 真便宜</span>
            </span>
            <Zap className="h-4 w-4 fill-[#FF6000] text-[#FF6000]" strokeWidth={0} />
          </div>
          <div className="flex items-center justify-between rounded-xl bg-gradient-to-r from-[#E8E0FF] to-[#CDB8FF] px-3 py-2">
            <span>
              <span className="block text-[14px] font-bold text-black/85">酒店团购</span>
              <span className="block text-[10px] text-black/50">全国通兑百元起</span>
            </span>
            <Ticket className="h-4 w-4 text-[#7A4AE0]" strokeWidth={2.1} />
          </div>
        </div>
        {/* 主题页签（自适应换行，无横向滚动） */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1">
          {HOTEL_TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setSel(null);
              }}
              className={`pb-1.5 text-[15px] ${tab === t ? 'font-bold text-black/90' : 'text-black/55'}`}
            >
              {t}
              <span className={`mx-auto mt-1 block h-[3px] w-6 rounded-full ${tab === t ? 'bg-[#FFC300]' : 'bg-transparent'}`} />
            </button>
          ))}
        </div>
      </div>

      {/* 排序筛选条 */}
      <div className="flex shrink-0 items-center gap-2 bg-white px-3 py-2">
        {['附近5公里内', '智能排序', '价格·星级', '筛选'].map((t, i) => (
          <span key={t} className={`flex items-center gap-0.5 rounded-full px-2.5 py-1 text-[12px] ${i === 0 ? 'bg-[#FFF6D6] font-medium text-[#B26B00]' : 'bg-black/[0.04] text-black/60'}`}>
            {t}
            {i < 3 && <ChevronDown className="h-3 w-3" />}
          </span>
        ))}
      </div>

      {/* 酒店列表 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        {loading ? (
          <ChannelSkeleton card="hotel" />
        ) : (
          <>
            <div className="divide-y divide-black/[0.04] bg-white px-3">
              {hotels.slice(0, 3).map((h) => (
                <HotelCard key={h.id} hotel={h} onOpen={() => setSel(h)} />
              ))}
            </div>
            <p className="flex items-center justify-between px-4 py-3 text-[13px] text-black/40">
              已显示附近的酒店
              <button type="button" onClick={onBack} className="rounded-full border border-black/15 px-3 py-1 text-[12px] text-black/60 active:bg-black/5">扩大搜索范围</button>
            </p>
            <p className="flex items-center gap-1 px-3 pb-1.5 pt-1 text-[13px] font-semibold text-black/70">
              <Star className="h-4 w-4 fill-[#FFC300] text-[#FFC300]" strokeWidth={0} /> 为您推荐附近的酒店
            </p>
            <div className="divide-y divide-black/[0.04] bg-white px-3">
              {hotels.slice(3).map((h) => (
                <HotelCard key={h.id} hotel={h} onOpen={() => setSel(h)} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* 确认订单弹层 */}
      <AnimatePresence>
        {confirmSel && (
          <HotelConfirmSheet
            key="hotel-confirm"
            hotel={confirmSel.hotel}
            room={confirmSel.room}
            onClose={() => setConfirmSel(null)}
            onOpenPay={onOpenPay}
            onToast={onToast}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** 酒店列表卡（对齐真机：图左 + 名称/等级/评分短评/券包标签/距离/价格） */

export function HotelCard({ hotel, onOpen }: { hotel: FunHotel; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full gap-3 py-3 text-left active:bg-black/[0.02]">
      <FoodImg src={hotel.img} emoji={hotel.emoji} className="h-[88px] w-[116px] shrink-0 rounded-lg" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[15px] font-bold text-black/90">{hotel.name}</span>
          <span className="shrink-0 rounded-[3px] bg-black/[0.05] px-1 py-px text-[10px] text-black/55">{hotel.level}</span>
        </span>
        <span className="mt-1 flex items-center gap-1.5">
          <RatingBadge rating={hotel.rating} />
          <span className="min-w-0 truncate text-[11px] text-black/45">“{hotel.quote}”</span>
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          {hotel.tags.slice(0, 2).map((t) => (
            <span key={t} className="rounded-[3px] bg-[#FFF0E6] px-1 py-px text-[10px] text-[#C45A1B]">{t}</span>
          ))}
        </span>
        <span className="mt-1 text-[11px] text-black/40">距您驾车{hotel.distanceKm}公里 · 约{hotel.minutes}分钟</span>
        <span className="mt-auto flex items-end justify-between">
          <span className="text-[17px] font-bold text-[#FF4B33]">
            ¥{fmtMoney(hotel.priceFrom)}<span className="text-[11px] font-medium"> 起</span>
          </span>
          {hotel.promo && <span className="rounded-[3px] bg-[#FFE9EC] px-1.5 py-px text-[10px] font-medium text-[#E5333F]">{hotel.promo}</span>}
        </span>
      </span>
    </button>
  );
}

/** 房型详情弹层（对齐截图：房型照片 + 属性 + 会员权益 + 底部立即预订） */

export function RoomSheet({ hotel, room, onClose, onBook }: { hotel: FunHotel; room: FunRoom; onClose: () => void; onBook: () => void }) {
  return (
    <motion.div className="absolute inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
      <div className="absolute inset-0 bg-black/55" onClick={onClose} />
      <motion.div
        className="absolute inset-x-0 bottom-0 top-[46px] flex flex-col overflow-hidden rounded-t-[18px] bg-white/80 backdrop-blur-2xl backdrop-saturate-150"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.32 }}
      >
        <button type="button" aria-label="关闭" onClick={onClose} className="absolute left-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white">
          <X className="h-4 w-4" />
        </button>
        <FoodImg src={room.img} emoji="🛏️" className="h-[220px] w-full shrink-0" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 pb-4 pt-3">
            <p className="text-[18px] font-bold leading-snug text-black/90">{room.name}</p>
            <div className="mt-3 grid grid-cols-3 gap-y-2.5 text-[12px] text-black/70">
              <span className="flex items-center gap-1"><Building className="h-3.5 w-3.5 text-black/35" /> {room.floor}</span>
              <span className="flex items-center gap-1">🛏 {room.bed}</span>
              <span className="flex items-center gap-1">📐 {room.size}</span>
              <span className="flex items-center gap-1">🪟 {room.window}</span>
              <span className="flex items-center gap-1">🚭 {room.smoking}</span>
              <span className="flex items-center gap-1">👥 {room.capacity}人</span>
            </div>
            <p className="mt-2.5 text-[12px] text-black/50">早餐：{room.breakfast} · 加床：该房型不可加床</p>
          </div>
          <div className="mx-4 mb-3 rounded-xl bg-gradient-to-b from-[#FFF7DC] to-[#FFFDF4] p-3.5">
            <p className="flex items-center gap-1.5 text-[14px] font-bold text-black/85">
              <Crown className="h-4 w-4 text-[#E8A200]" /> 普通会员
            </p>
            <p className="mt-2 text-[13px] font-semibold text-black/80">住就送 <span className="ml-1 font-normal text-black/40">入住当日可到账</span></p>
            <div className="mt-2 rounded-lg bg-white/80 p-2.5">
              <p className="flex items-center justify-between text-[13px] font-bold text-[#E5333F]">
                35元券包
                <span className="flex items-center text-[11px] font-normal text-black/40">详情 <ChevronRight className="h-3 w-3" /></span>
              </p>
              <p className="mt-1 text-[11px] text-black/45">满30减10元外卖券*1 | 满35减10元闪购券*1…</p>
            </div>
            <p className="mt-2.5 text-[12px] text-black/60">
              <span className="font-semibold text-black/80">可享权益</span> ｜ 填写订单时兑换 · 离店后每间每晚预估可获赠{Math.round(room.price)}积分
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-black/[0.06] px-4 py-3">
          <p className="text-[15px] font-bold text-[#FF4B33]">
            ¥{fmtMoney(room.price)}
            {room.origPrice && <span className="ml-1 text-[11px] font-normal text-black/30 line-through">¥{fmtMoney(room.origPrice)}</span>}
          </p>
          <button type="button" onClick={onBook} className="rounded-full bg-gradient-to-r from-[#FFD100] to-[#FFC300] px-8 py-2.5 text-[15px] font-semibold text-black/90 active:opacity-85">
            立即预订
          </button>
        </div>
        <p className="pb-2 text-center text-[10px] text-black/25">{hotel.name} · 到店办理入住</p>
      </motion.div>
    </motion.div>
  );
}

/** 酒店确认订单弹层（日期/间夜/明细 → 提交订单 → 收银台） */

export function HotelConfirmSheet({ hotel, room, onClose, onOpenPay, onToast }: { hotel: FunHotel; room: FunRoom; onClose: () => void; onOpenPay: (o: MtOrder) => void; onToast: (m: string) => void }) {
  const [nights, setNights] = useState(1);
  const dates = funDates();
  const unit = room.price;
  const origTotal = Math.round((room.origPrice ?? room.price) * nights * 100) / 100;
  const total = Math.round(unit * nights * 100) / 100;
  const submit = () => {
    const order = submitFunOrder({
      merchantId: `fun-hotel-${hotel.id}`,
      merchantName: hotel.name,
      merchantEmoji: '🏨',
      merchantImg: hotel.img,
      item: {
        dishId: room.id,
        name: room.name,
        price: room.origPrice ?? room.price,
        qty: nights,
        emoji: '🛏️',
        img: room.img,
        spec: `${dates.label} · ${nights}间${nights}晚`,
      },
      itemTotal: origTotal,
      total,
    });
    if (!order) {
      onToast('数据异常，请返回重试');
      return;
    }
    onClose();
    onOpenPay(order);
  };
  return (
    <motion.div className="absolute inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        className="absolute inset-x-0 bottom-0 top-[110px] flex flex-col overflow-hidden rounded-t-[18px] bg-white/80 backdrop-blur-2xl backdrop-saturate-150"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.34 }}
      >
        <div className="flex shrink-0 items-center gap-2 bg-[#2E5C8C] px-4 py-2.5">
          <span className="text-[15px] font-bold text-white">确认订单</span>
          <span className="text-[12px] text-white/70">{hotel.name}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex gap-3 px-4 py-3.5">
            <FoodImg src={room.img} emoji="🛏️" className="h-[76px] w-[104px] shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold leading-snug text-black/90">{room.name}</p>
              <p className="mt-1 text-[11px] text-black/45">{room.bed} · {room.breakfast} · {room.smoking}</p>
              <p className="mt-1 flex items-center gap-1 text-[11px] text-black/45"><MapPin className="h-3 w-3" /> {hotel.addr}</p>
            </div>
          </div>
          <div className="px-4">
            <div className="rounded-xl bg-black/[0.03] p-3.5">
              <p className="flex items-center justify-between text-[14px]">
                <span className="text-black/55">入住/离店</span>
                <span className="font-semibold text-black/85">{dates.checkIn} ~ {dates.checkOut}</span>
              </p>
              <p className="mt-2.5 flex items-center justify-between text-[14px]">
                <span className="text-black/55">间夜</span>
                <span className="flex items-center gap-2">
                  <button type="button" aria-label="减少" onClick={() => setNights((n) => Math.max(1, n - 1))} className="grid h-6 w-6 place-items-center rounded-full text-[16px] text-black/45 active:bg-black/10">−</button>
                  <span className="grid h-[26px] min-w-[36px] place-items-center rounded-[5px] border border-black/15 bg-white px-1 text-[13px] font-medium">{nights}晚</span>
                  <button type="button" aria-label="增加" onClick={() => setNights((n) => Math.min(30, n + 1))} className="grid h-6 w-6 place-items-center rounded-full text-[16px] text-black/45 active:bg-black/10">＋</button>
                </span>
              </p>
            </div>
            <div className="mt-3 space-y-2 text-[13px]">
              <p className="flex justify-between"><span className="text-black/50">房费 ¥{fmtMoney(unit)} × {nights}晚</span><span className="text-black/80">¥{fmtMoney(Math.round(unit * nights * 100) / 100)}</span></p>
              <p className="flex justify-between"><span className="text-black/50">会员优惠</span><span className="text-[#E5333F]">−¥{fmtMoney(Math.max(0, Math.round((origTotal - total) * 100) / 100))}</span></p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-black/[0.06] px-4 py-3">
          <p className="text-[15px] font-bold text-[#FF4B33]">¥{fmtMoney(total)}</p>
          <button type="button" onClick={submit} className="rounded-full bg-gradient-to-r from-[#FFD100] to-[#FFC300] px-8 py-2.5 text-[15px] font-semibold text-black/90 active:opacity-85">
            提交订单
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}


// ---------------- 休闲玩乐频道 ----------------

export const FUN_CATS = ['全部', '电玩城', 'KTV', '密室逃脱', '洗浴按摩', '游泳健身', '景区', '游乐场', '棋牌', '台球'];


export function FunChannelPage({ onBack, onOpenPay, onToast }: { onBack: () => void; onOpenPay: (o: MtOrder) => void; onToast: (m: string) => void }) {
  const { data: venues, loading } = useFunChannel<FunVenue>('fun', '全部门店');
  const [cat, setCat] = useState('全部');
  const [sel, setSel] = useState<FunVenue | null>(null); // 门店详情
  const [detailTab, setDetailTab] = useState<'deal' | 'review'>('deal');
  const [buy, setBuy] = useState<{ venue: FunVenue; deal: FunDeal } | null>(null); // 团购确认弹层
  const list = venues.filter((v) => cat === '全部' || v.category === cat || (cat === '棋牌' && v.category.includes('棋牌')));

  if (sel) {
    const dealImg = (i: number) => mtImg(sel.tag, 300, 300, i, 'f');
    return (
      <div className="flex h-full flex-col bg-white">
        {/* 头图 */}
        <div className="relative shrink-0">
          <FoodImg src={sel.cover} emoji={sel.emoji} className="h-[200px] w-full" />
          <button type="button" aria-label="返回" onClick={() => setSel(null)} className="absolute left-3 top-[52px] grid h-9 w-9 place-items-center rounded-full bg-black/40 text-white active:opacity-75">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="absolute bottom-3 right-3 rounded-full bg-black/45 px-2 py-0.5 text-[11px] text-white">相册 ›</span>
        </div>
        {/* 门店信息 */}
        <div className="shrink-0 px-4 pb-3 pt-3">
          <p className="text-[20px] font-bold leading-snug text-black/90">{sel.name}</p>
          {sel.rank && (
            <button type="button" onClick={() => onToast(`${sel.rank} · 口碑好店`)} className="mt-1.5 flex items-center gap-1 rounded-[4px] bg-[#FFF0E6] px-1.5 py-0.5 text-[11px] text-[#C45A1B] active:opacity-70">
              {sel.rank} <ChevronRight className="h-3 w-3" />
            </button>
          )}
          <div className="mt-2 flex items-center gap-2">
            <RatingBadge rating={sel.rating} />
            <span className="text-[12px] text-[#FF6000]">{sel.reviewCount}条评价 ›</span>
            <span className="ml-auto text-[12px] text-black/45">¥{sel.pricePer}/人 | {sel.category}›</span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 border-t border-black/[0.05] pt-2.5">
            <span className="text-[13px] font-medium text-black/80">{sel.openState} {sel.openHours}</span>
            {sel.tags.map((t) => (
              <span key={t} className="rounded-[3px] bg-black/[0.04] px-1.5 py-px text-[10px] text-black/55">{t}</span>
            ))}
            <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-black/25" />
          </div>
          <div className="mt-2.5 flex items-center gap-2 border-t border-black/[0.05] pt-2.5">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 truncate text-[13px] text-black/75">{sel.addr} ›</span>
              <span className="mt-0.5 block text-[11px] text-black/40">距您驾车{sel.distanceKm}公里</span>
            </span>
            <button type="button" onClick={() => onToast('已为你规划驾车路线（演示）')} className="flex flex-col items-center gap-0.5 px-2 text-[10px] text-black/60 active:opacity-60">
              <CarIcon className="h-5 w-5 text-black/70" /> 打车
            </button>
            <button type="button" onClick={() => onToast('已拨打门店电话（演示）')} className="flex flex-col items-center gap-0.5 px-2 text-[10px] text-black/60 active:opacity-60">
              <PhoneIcon className="h-5 w-5 text-black/70" /> 电话
            </button>
          </div>
        </div>
        {/* 团购/评价页签 */}
        <div className="flex shrink-0 items-center gap-7 border-b border-black/[0.06] px-4">
          {([['deal', '团购'], ['review', '评价']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setDetailTab(k)} className={`py-2.5 text-[15px] ${detailTab === k ? 'border-b-2 border-[#FF6000] font-bold text-black/90' : 'text-black/55'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#F7F8FA] pb-4">
          {detailTab === 'deal' ? (
            <div className="mt-2 space-y-2 bg-white px-4 py-3">
              {sel.deals.map((d, i) => (
                <div key={d.id} className="flex gap-3 border-b border-black/[0.04] pb-3 last:border-0 last:pb-0">
                  <FoodImg src={dealImg(i)} emoji={sel.emoji} className="h-[72px] w-[72px] shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-black/90">{d.title}</p>
                    <p className="mt-0.5 text-[11px] text-black/40">{d.sub}</p>
                    <p className="mt-1 text-right text-[10px] text-black/35">{d.sold}</p>
                    <div className="flex items-end justify-between">
                      <p className="flex items-baseline gap-1.5">
                        <span className="text-[17px] font-bold text-[#FF4B33]">¥{fmtMoney(d.price)}</span>
                        <span className="rounded-[3px] bg-[#FFE9EC] px-1 py-px text-[10px] text-[#E5333F]">{d.discount}</span>
                        {d.unit && <span className="text-[10px] text-black/35">{d.unit}</span>}
                        <span className="text-[11px] text-black/30 line-through">¥{fmtMoney(d.origPrice)}</span>
                      </p>
                      <button type="button" onClick={() => setBuy({ venue: sel, deal: d })} className="rounded-full bg-gradient-to-r from-[#FF9A21] to-[#FF6F1E] px-4 py-1.5 text-[13px] font-semibold text-white active:opacity-85">
                        抢购
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {sel.deals.length === 0 && <p className="py-10 text-center text-[13px] text-black/30">暂无团购套餐</p>}
            </div>
          ) : (
            <div className="mt-2 space-y-3 bg-white px-4 py-3">
              {sel.reviews.map((r, i) => (
                <div key={i} className="border-b border-black/[0.04] pb-3 last:border-0 last:pb-0">
                  <p className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-[#FFD100] text-[12px] font-bold text-black/70">{r.name.slice(0, 1)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-black/80">{r.name}</span>
                      <RatingBadge rating={r.rating} />
                    </span>
                    <span className="text-[11px] text-black/30">{r.date}</span>
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed text-black/70">{r.text}</p>
                </div>
              ))}
              {sel.reviews.length === 0 && <p className="py-10 text-center text-[13px] text-black/30">暂无评价</p>}
            </div>
          )}
        </div>
        <AnimatePresence>
          {buy && (
            <FunDealConfirmSheet
              key="fun-deal-confirm-detail"
              venue={buy.venue}
              deal={buy.deal}
              onClose={() => setBuy(null)}
              onOpenPay={onOpenPay}
              onToast={onToast}
            />
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      {/* 顶栏 */}
      <div className="shrink-0 bg-[#FFD100] px-3 pb-3 pt-[52px]">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/10">
            <ChevronLeft className="h-5 w-5 text-black/80" />
          </button>
          <span className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-white px-3.5 py-2">
            <SearchIcon className="h-4 w-4 shrink-0 text-black/40" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-black/40">搜索玩乐 · 电玩/KTV/密室/洗浴</span>
          </span>
        </div>
        {/* 品类筛选（自适应换行，无横向滚动） */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {FUN_CATS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setCat(t)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] ${cat === t ? 'bg-black/85 font-semibold text-white' : 'bg-white/70 text-black/65'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* 门店列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        {loading ? (
          <ChannelSkeleton card="venue" />
        ) : (
          <div className="divide-y divide-black/[0.04] px-3">
            {list.map((v) => (
              <button key={v.id} type="button" onClick={() => setSel(v)} className="flex w-full gap-3 bg-white py-3 text-left first:mt-2 last:mb-2 active:bg-black/[0.02]">
                <FoodImg src={v.cover} emoji={v.emoji} className="h-[88px] w-[116px] shrink-0 rounded-lg" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-bold text-black/90">{v.name}</span>
                  {v.rank && <span className="mt-0.5 w-fit rounded-[4px] bg-[#FFF0E6] px-1.5 py-px text-[10px] text-[#C45A1B]">{v.rank} ›</span>}
                  <span className="mt-1 flex items-center gap-1.5">
                    <RatingBadge rating={v.rating} />
                    <span className="text-[11px] text-[#FF6000]">{v.reviewCount}条评价</span>
                    <span className="ml-auto text-[11px] text-black/45">¥{v.pricePer}/人</span>
                  </span>
                  <span className="mt-1 flex items-center gap-1 text-[11px] text-black/45">
                    {v.openState} {v.openHours}
                    {v.tags.slice(0, 1).map((t) => (
                      <span key={t} className="rounded-[3px] bg-black/[0.04] px-1 py-px text-[10px] text-black/50">{t}</span>
                    ))}
                  </span>
                  <span className="mt-auto truncate text-[11px] text-black/40">{v.addr} · 距您{v.distanceKm}公里</span>
                </span>
              </button>
            ))}
            {list.length === 0 && <p className="py-16 text-center text-[13px] text-black/30">该品类暂无门店，试试其他分类</p>}
          </div>
        )}
      </div>

      {/* 团购确认弹层 */}
      <AnimatePresence>
        {buy && (
          <FunDealConfirmSheet
            key="fun-deal-confirm"
            venue={buy.venue}
            deal={buy.deal}
            onClose={() => setBuy(null)}
            onOpenPay={onOpenPay}
            onToast={onToast}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** 休闲玩乐团购确认弹层（数量/单价/明细 → 提交订单） */

export function FunDealConfirmSheet({ venue, deal, onClose, onOpenPay, onToast }: { venue: FunVenue; deal: FunDeal; onClose: () => void; onOpenPay: (o: MtOrder) => void; onToast: (m: string) => void }) {
  const [qty, setQty] = useState(1);
  const total = Math.round(deal.price * qty * 100) / 100;
  const itemTotal = Math.round(deal.origPrice * qty * 100) / 100;
  const submit = () => {
    const order = submitFunOrder({
      merchantId: `fun-venue-${venue.id}`,
      merchantName: venue.name,
      merchantEmoji: venue.emoji,
      merchantImg: venue.cover,
      item: {
        dishId: deal.id,
        name: deal.title,
        price: deal.origPrice,
        qty,
        emoji: venue.emoji,
        img: mtImg(venue.tag, 400, 400, 1, 'f'),
        spec: deal.sub,
      },
      itemTotal,
      total,
    });
    if (!order) {
      onToast('数据异常，请返回重试');
      return;
    }
    onClose();
    onOpenPay(order);
  };
  return (
    <motion.div className="absolute inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        className="absolute inset-x-0 bottom-0 top-[150px] flex flex-col overflow-hidden rounded-t-[18px] bg-white/80 backdrop-blur-2xl backdrop-saturate-150"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.34 }}
      >
        <div className="flex shrink-0 items-center gap-2 bg-[#FF8A00] px-4 py-2.5">
          <span className="text-[15px] font-bold text-white">确认订单</span>
          <span className="text-[12px] text-white/80">{venue.name}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex gap-3 px-4 py-3.5">
            <FoodImg src={venue.cover} emoji={venue.emoji} className="h-[72px] w-[72px] shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-black/90">{deal.title}</p>
              <p className="mt-1 text-[11px] text-black/40">{deal.sub} · {deal.sold}</p>
            </div>
          </div>
          <div className="px-4">
            <div className="rounded-xl bg-black/[0.03] p-3.5">
              <p className="flex items-center justify-between text-[14px]">
                <span className="text-black/55">数量</span>
                <span className="flex items-center gap-2">
                  <button type="button" aria-label="减少" onClick={() => setQty((n) => Math.max(1, n - 1))} className="grid h-6 w-6 place-items-center rounded-full text-[16px] text-black/45 active:bg-black/10">−</button>
                  <span className="grid h-[26px] min-w-[36px] place-items-center rounded-[5px] border border-black/15 bg-white px-1 text-[13px] font-medium">{qty}</span>
                  <button type="button" aria-label="增加" onClick={() => setQty((n) => Math.min(20, n + 1))} className="grid h-6 w-6 place-items-center rounded-full text-[16px] text-black/45 active:bg-black/10">＋</button>
                </span>
              </p>
              <p className="mt-2.5 flex justify-between text-[13px]">
                <span className="text-black/50">小计 ¥{fmtMoney(deal.price)} × {qty}</span>
                <span className="text-black/80">¥{fmtMoney(total)}</span>
              </p>
              <p className="mt-1.5 flex justify-between text-[13px]">
                <span className="text-black/50">已省（{deal.discount}）</span>
                <span className="text-[#E5333F]">−¥{fmtMoney(Math.max(0, Math.round((itemTotal - total) * 100) / 100))}</span>
              </p>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-black/35">购买后可随时退 · 过期自动退 · 到店出示券码使用</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-black/[0.06] px-4 py-3">
          <p className="text-[15px] font-bold text-[#FF4B33]">¥{fmtMoney(total)}</p>
          <button type="button" onClick={submit} className="rounded-full bg-gradient-to-r from-[#FF9A21] to-[#FF6F1E] px-8 py-2.5 text-[15px] font-semibold text-white active:opacity-85">
            提交订单
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}


// ---------------- 电影演出频道 ----------------

export const POSTER_GRADS: [string, string][] = [
  ['#8C1D13', '#E0452B'],
  ['#0F2027', '#2C5364'],
  ['#4A2B8C', '#8B5CF6'],
  ['#123B2A', '#2E7D4F'],
  ['#5A1A0F', '#C45A1B'],
  ['#283593', '#5C6BC0'],
  ['#5A2B0F', '#B8642B'],
  ['#1A202C', '#4A5568'],
];

/** 影片海报（本地算法图：片名哈希渐变 + 竖排片名，不用 AI 生图） */

export function PosterArt({ movie, className = '' }: { movie: FunMovie; className?: string }) {
  let h = 0;
  for (const ch of movie.title) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const [c1, c2] = POSTER_GRADS[Math.abs(h) % POSTER_GRADS.length];
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: `linear-gradient(165deg, ${c2} 0%, ${c1} 100%)` }}>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-1 text-center">
        <span className="text-[8px] tracking-[0.2em] text-white/45">{movie.genres.split(' ')[0]}</span>
        <span
          className={`font-black text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.5)] ${movie.title.length <= 5 ? 'text-[16px] leading-[1.25]' : 'text-[13px] leading-snug'}`}
          style={movie.title.length <= 4 ? { writingMode: 'vertical-rl', letterSpacing: '0.12em' } : undefined}
        >
          {movie.title}
        </span>
        <span className="max-w-full truncate px-0.5 text-[7px] uppercase tracking-wider text-white/40">{movie.en}</span>
      </div>
      <Clapperboard className="absolute right-1 top-1 h-3 w-3 text-white/25" strokeWidth={2} />
    </div>
  );
}

/** 影片列表卡（想看/看过 + 热映购票） */

export function MovieCard({ movie, mark, onMark, onOpen, onBuy }: { movie: FunMovie; mark: 'want' | 'seen' | undefined; onMark: (m: 'want' | 'seen') => void; onOpen: () => void; onBuy: () => void }) {
  return (
    <div className="flex gap-3 bg-white px-3 py-3">
      <button type="button" onClick={onOpen} className="shrink-0 active:opacity-80" aria-label={`查看《${movie.title}》详情`}>
        <PosterArt movie={movie} className="h-[126px] w-[94px] rounded-lg" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <button type="button" onClick={onOpen} className="min-w-0 text-left">
          <p className="truncate text-[16px] font-bold text-black/90">{movie.title}</p>
          <p className="mt-0.5 truncate text-[11px] uppercase text-black/35">{movie.en}</p>
          <p className="mt-1 truncate text-[12px] text-[#B26B00]">“{movie.quote}”</p>
          <p className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-black/45">
            <span className="truncate">{movie.genres}</span>
            {movie.ver.slice(0, 1).map((v) => (
              <span key={v} className="shrink-0 rounded-[3px] border border-black/15 px-1 py-px text-[9px]">{v}</span>
            ))}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-black/40">{movie.release}{movie.status === 'soon' ? ` · ${movie.wantSee}人想看` : ''}</p>
        </button>
        <div className="mt-auto flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => onMark('want')}
            className={`flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] active:opacity-70 ${mark === 'want' ? 'border-[#FF2D7E] bg-[#FFF0F6] font-semibold text-[#FF2D7E]' : 'border-black/15 text-black/60'}`}
          >
            <Heart className={`h-3.5 w-3.5 ${mark === 'want' ? 'fill-[#FF2D7E]' : ''}`} strokeWidth={2} /> 想看
          </button>
          {movie.status === 'now' ? (
            <button type="button" onClick={onBuy} className="rounded-full bg-gradient-to-r from-[#FF9A21] to-[#FF6F1E] px-4 py-1.5 text-[12px] font-semibold text-white active:opacity-85">
              选座购票
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onMark('seen')}
              className={`flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] active:opacity-70 ${mark === 'seen' ? 'border-[#FFC300] bg-[#FFF6D6] font-semibold text-[#B26B00]' : 'border-black/15 text-black/60'}`}
            >
              <Star className={`h-3.5 w-3.5 ${mark === 'seen' ? 'fill-[#FFC300]' : ''}`} strokeWidth={0} /> 看过
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


export function MoviesChannelPage({ onBack, onOpenPay, onToast }: { onBack: () => void; onOpenPay: (o: MtOrder) => void; onToast: (m: string) => void }) {
  const { data: movies, loading } = useFunChannel<FunMovie>('movie', '热映影片');
  const [seg, setSeg] = useState<'now' | 'soon'>('now');
  const [marks, setMarks] = useState<Record<string, 'want' | 'seen'>>({});
  const [sel, setSel] = useState<FunMovie | null>(null); // 影片详情
  const [buy, setBuy] = useState<FunMovie | null>(null); // 购票确认弹层
  const list = movies.filter((m) => m.status === seg);

  if (sel) {
    return (
      <>
        <MovieDetailPage movie={sel} mark={marks[sel.id]} onMark={(m) => setMarks((p) => ({ ...p, [sel.id]: m }))} onBack={() => setSel(null)} onBuy={() => setBuy(sel)} />
        <AnimatePresence>
          {buy && <MovieConfirmSheet key="movie-confirm-detail" movie={buy} onClose={() => setBuy(null)} onOpenPay={onOpenPay} onToast={onToast} />}
        </AnimatePresence>
      </>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      {/* 顶栏 */}
      <div className="shrink-0 bg-[#FFD100] px-3 pb-2.5 pt-[52px]">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/10">
            <ChevronLeft className="h-5 w-5 text-black/80" />
          </button>
          <span className="text-[17px] font-bold text-black/90">电影</span>
          <span className="ml-2 flex min-w-0 flex-1 items-center gap-2 rounded-full bg-white px-3.5 py-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-black/50" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-black/80">濮阳县</span>
          </span>
        </div>
        <div className="mt-2 flex items-center gap-6">
          {([['now', '正在热映'], ['soon', '即将上映']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setSeg(k)} className={`pb-1.5 text-[15px] ${seg === k ? 'font-bold text-black/90' : 'text-black/50'}`}>
              {label}
              <span className={`mx-auto mt-1 block h-[3px] w-7 rounded-full ${seg === k ? 'bg-[#FFC300]' : 'bg-transparent'}`} />
            </button>
          ))}
        </div>
      </div>

      {/* 影片列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        {loading ? (
          <ChannelSkeleton card="movie" />
        ) : (
          <div className="divide-y divide-black/[0.04] bg-white">
            {list.map((m) => (
              <MovieCard
                key={m.id}
                movie={m}
                mark={marks[m.id]}
                onMark={(mk) => setMarks((p) => ({ ...p, [m.id]: p[m.id] === mk ? undefined : mk } as Record<string, 'want' | 'seen'>))}
                onOpen={() => setSel(m)}
                onBuy={() => setBuy(m)}
              />
            ))}
            {list.length === 0 && <p className="py-16 text-center text-[13px] text-black/30">暂无影片</p>}
          </div>
        )}
      </div>

      <AnimatePresence>
        {buy && (
          <MovieConfirmSheet key="movie-confirm" movie={buy} onClose={() => setBuy(null)} onOpenPay={onOpenPay} onToast={onToast} />
        )}
      </AnimatePresence>
    </div>
  );
}

/** 影片详情页（对齐截图：深色影厅风格 + 想看/看过 + 猫眼想看卡 + 特殊场 + 简介 + 特惠购票 + 演职人员 + 底部购票） */

export function MovieDetailPage({ movie, mark, onMark, onBack, onBuy }: { movie: FunMovie; mark: 'want' | 'seen' | undefined; onMark: (m: 'want' | 'seen') => void; onBack: () => void; onBuy: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="relative flex h-full flex-col bg-[#12332E]">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24">
        {/* 头部（深色影厅） */}
        <div className="relative bg-gradient-to-b from-[#0E2824] via-[#12332E] to-[#12332E] px-4 pb-4 pt-[54px]">
          <button type="button" aria-label="返回" onClick={onBack} className="absolute left-3 top-[52px] grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white active:opacity-75">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" aria-label="分享" onClick={onBack} className="absolute right-3 top-[52px] grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white active:opacity-75">
            <MtShareGlyph className="h-4 w-4" />
          </button>
          <div className="mt-2 flex gap-4">
            <PosterArt movie={movie} className="h-[172px] w-[124px] shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col pt-1">
              <p className="text-[22px] font-bold leading-tight text-white">{movie.title}</p>
              <p className="mt-1 truncate text-[13px] uppercase tracking-wide text-white/50">{movie.en}</p>
              <p className="mt-2 line-clamp-2 text-[13px] text-[#FFD77A]">“{movie.quote}”</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {movie.genres.split(' ').map((g) => (
                  <span key={g} className="text-[12px] text-white/70">{g}</span>
                ))}
                {movie.ver.map((v) => (
                  <span key={v} className="rounded-[3px] bg-white/10 px-1.5 py-px text-[10px] text-white/70">{v}</span>
                ))}
              </div>
              <button type="button" onClick={onBuy} className="mt-auto flex items-center gap-0.5 truncate text-left text-[12px] text-white/60 active:opacity-70">
                {movie.release} <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              </button>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => onMark('want')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[14px] font-semibold active:opacity-80 ${mark === 'want' ? 'bg-[#FF2D7E] text-white' : 'bg-white/10 text-white/85'}`}
            >
              <Heart className={`h-4 w-4 ${mark === 'want' ? 'fill-white' : ''}`} strokeWidth={2} /> 想看
            </button>
            <button
              type="button"
              onClick={() => onMark('seen')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[14px] font-semibold active:opacity-80 ${mark === 'seen' ? 'bg-[#FFC300] text-black/90' : 'bg-white/10 text-white/85'}`}
            >
              <Star className={`h-4 w-4 ${mark === 'seen' ? 'fill-[#FFC300] text-[#FFC300]' : ''}`} strokeWidth={0} /> 看过
            </button>
          </div>
        </div>

        {/* 猫眼想看卡 */}
        <div className="mx-3 mt-3 rounded-xl bg-white/[0.06] p-3.5">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-white/85">
            <Clapperboard className="h-4 w-4 text-[#FFC300]" /> 猫眼想看
          </p>
          <p className="mt-2 text-center">
            <span className="text-[26px] font-bold text-[#FFC300]">{movie.wantSee.toLocaleString('en-US')}</span>
            <span className="ml-1 text-[13px] text-white/60">人想看</span>
          </p>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-white/45">
            <span className="flex -space-x-1.5">
              {['🧑', '👩'].map((e, i) => (
                <span key={i} className="grid h-5 w-5 place-items-center rounded-full bg-white/15 text-[10px]">{e}</span>
              ))}
            </span>
            想看 {Math.floor(movie.wantSee % 60) + 1}分钟前
          </p>
        </div>

        {/* 特殊场 */}
        <div className="mx-3 mt-3 divide-y divide-white/[0.07] rounded-xl bg-white/[0.06] px-3.5">
          <button type="button" onClick={onBuy} className="flex w-full items-center gap-2 py-3 text-left active:opacity-70">
            <span className="shrink-0 rounded-[3px] border border-[#FFC300]/50 px-1 py-px text-[10px] text-[#FFC300]">特殊场</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">限时买一赠一，{movie.title}爽片来袭！</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
          </button>
          <button type="button" onClick={onBuy} className="flex w-full items-center gap-2 py-3 text-left active:opacity-70">
            <span className="shrink-0 rounded-[3px] border border-[#FFC300]/50 px-1 py-px text-[10px] text-[#FFC300]">纪念票</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">购票领取限定票根，爽看{movie.title}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
          </button>
        </div>

        {/* 简介 */}
        <div className="px-4 pt-5">
          <p className="flex items-center justify-between text-[17px] font-bold text-white/90">
            简介
            <button type="button" onClick={() => setExpanded((v) => !v)} className="flex items-center text-[12px] font-normal text-white/40 active:opacity-60">
              {expanded ? '收起' : '展开'} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          </p>
          <p className={`mt-2 text-[14px] leading-relaxed text-white/70 ${expanded ? '' : 'line-clamp-3'}`}>{movie.summary} {movie.title}由{movie.director}执导，{movie.actors.join('、')}等主演，片长{movie.duration}。</p>
        </div>

        {/* 特惠购票横幅 */}
        <button type="button" onClick={onBuy} className="mx-3 mt-4 flex w-[calc(100%-24px)] items-center justify-between overflow-hidden rounded-xl bg-gradient-to-r from-[#A6121B] via-[#C41820] to-[#E03A2A] px-4 py-3.5 text-left active:opacity-85">
          <span>
            <span className="block text-[16px] font-black text-white">{movie.status === 'now' ? '正在热映' : '即将上映'}</span>
            <span className="mt-0.5 block text-[11px] text-white/70">限时拼团 最高立减8元</span>
          </span>
          <span className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-semibold text-white">立即参与 ›</span>
        </button>

        {/* 演职人员 */}
        <div className="pt-5">
          <p className="flex items-center justify-between px-4 text-[17px] font-bold text-white/90">
            演职人员
            <span className="text-[12px] font-normal text-white/40">全部{movie.staff}人 ›</span>
          </p>
          <div className="mt-3 flex gap-3 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[{ name: movie.director, role: '导演' }, ...movie.actors.map((a) => ({ name: a, role: '主演' }))].map((p, i) => (
              <span key={i} className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
                <span className="grid h-[64px] w-[64px] place-items-center overflow-hidden rounded-full bg-white/10 text-[22px]">{i === 0 ? '🎬' : '🧑‍🎬'}</span>
                <span className="w-full truncate text-center text-[11px] text-white/75">{p.name}</span>
                <span className="text-[9px] text-white/35">{p.role}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 底部购票条 */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-[#0E2824] px-4 pb-5 pt-3">
        <span className="relative shrink-0">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-[#FF4B33] to-[#E5333F] text-[16px]">🧧</span>
          <span className="absolute -top-1 left-8 whitespace-nowrap rounded-full bg-[#FFC300] px-1.5 py-px text-[9px] font-semibold text-black/80">正在派发限时红包</span>
        </span>
        <button type="button" onClick={onBuy} className="min-w-0 flex-1 rounded-full bg-gradient-to-r from-[#E5333F] to-[#FF4B33] py-3 text-[16px] font-bold text-white active:opacity-85">
          领券购票
        </button>
      </div>
    </div>
  );
}

/** 影片购票确认弹层：选影院/场次/数量 → 提交订单 */

export function MovieConfirmSheet({ movie, onClose, onOpenPay, onToast }: { movie: FunMovie; onClose: () => void; onOpenPay: (o: MtOrder) => void; onToast: (m: string) => void }) {
  const CINEMAS = ['金逸影城（濮阳店）', '万达影城（CBD店）', '横店电影城（悦尚店）'];
  const [cinema, setCinema] = useState(0);
  const [showIdx, setShowIdx] = useState(0);
  const [qty, setQty] = useState(2);
  const verPremium = (v: string): number => (/IMAX/.test(v) ? 15 : /巨幕/.test(v) ? 10 : /CINITY|杜比/.test(v) ? 8 : 0);
  const shows = movie.ver.flatMap((v, vi) =>
    [`${12 + vi * 3}:${movie.title.length % 2 === 0 ? '20' : '45'}`, `${17 + vi}:${movie.title.length % 3 === 0 ? '10' : '35'}`].map((time, si) => ({
      ver: v,
      time,
      lang: '国语 2D',
      price: Math.round((38 + verPremium(v) + ((movie.title.charCodeAt(0) + vi * 7 + si * 13) % 9)) * 10) / 10,
    })),
  );
  const show = shows[Math.min(showIdx, shows.length - 1)];
  const total = Math.round(show.price * qty * 100) / 100;
  const origTotal = Math.round(show.price * 1.25 * qty * 100) / 100;
  const submit = () => {
    const order = submitFunOrder({
      merchantId: `fun-cinema-${cinema}`,
      merchantName: CINEMAS[cinema],
      merchantEmoji: '🎬',
      item: {
        dishId: `${movie.id}-${show.time}`,
        name: `《${movie.title}》电影票`,
        price: Math.round(show.price * 1.25 * 10) / 10,
        qty,
        emoji: '🎬',
        img: mtImg('cinema', 400, 400, movie.title.length % 5, 'f'),
        spec: `${show.time} ${show.lang} ${show.ver} · ${CINEMAS[cinema]}`,
      },
      itemTotal: origTotal,
      total,
    });
    if (!order) {
      onToast('数据异常，请返回重试');
      return;
    }
    onClose();
    onOpenPay(order);
  };
  return (
    <motion.div className="absolute inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        className="absolute inset-x-0 bottom-0 top-[90px] flex flex-col overflow-hidden rounded-t-[18px] bg-white/80 backdrop-blur-2xl backdrop-saturate-150"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.34 }}
      >
        <div className="flex shrink-0 items-center gap-2 bg-[#A6121B] px-4 py-2.5">
          <span className="text-[15px] font-bold text-white">选座购票</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-white/75">《{movie.title}》 {movie.genres} · {movie.duration}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="px-4 pb-2 pt-3.5 text-[14px] font-bold text-black/85">选择影院</p>
          <div className="flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {CINEMAS.map((c, i) => (
              <button
                key={c}
                type="button"
                onClick={() => setCinema(i)}
                className={`shrink-0 rounded-lg border px-3 py-2 text-[12px] ${cinema === i ? 'border-[#E5333F] bg-[#FFF0F1] font-semibold text-[#E5333F]' : 'border-black/10 text-black/60'}`}
              >
                {c}
              </button>
            ))}
          </div>
          <p className="px-4 pb-2 pt-4 text-[14px] font-bold text-black/85">选择场次</p>
          <div className="grid grid-cols-2 gap-2 px-4">
            {shows.map((s, i) => (
              <button
                key={`${s.time}-${s.ver}-${i}`}
                type="button"
                onClick={() => setShowIdx(i)}
                className={`rounded-lg border px-3 py-2 text-left ${showIdx === i ? 'border-[#E5333F] bg-[#FFF0F1]' : 'border-black/10'}`}
              >
                <span className="block text-[13px] font-semibold text-black/85">{s.time}</span>
                <span className="mt-0.5 block text-[10px] text-black/40">{s.lang} · {s.ver}</span>
                <span className="mt-0.5 block text-[12px] font-bold text-[#FF4B33]">¥{fmtMoney(s.price)}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-xl bg-black/[0.03] mx-4 p-3.5">
            <p className="flex items-center justify-between text-[14px]">
              <span className="text-black/55">数量</span>
              <span className="flex items-center gap-2">
                <button type="button" aria-label="减少" onClick={() => setQty((n) => Math.max(1, n - 1))} className="grid h-6 w-6 place-items-center rounded-full text-[16px] text-black/45 active:bg-black/10">−</button>
                <span className="grid h-[26px] min-w-[36px] place-items-center rounded-[5px] border border-black/15 bg-white px-1 text-[13px] font-medium">{qty}张</span>
                <button type="button" aria-label="增加" onClick={() => setQty((n) => Math.min(6, n + 1))} className="grid h-6 w-6 place-items-center rounded-full text-[16px] text-black/45 active:bg-black/10">＋</button>
              </span>
            </p>
            <p className="mt-2.5 flex justify-between text-[13px]">
              <span className="text-black/50">特惠价 ¥{fmtMoney(show.price)} × {qty}张</span>
              <span className="text-black/80">¥{fmtMoney(total)}</span>
            </p>
            <p className="mt-1.5 flex justify-between text-[13px]">
              <span className="text-black/50">限时拼团立减</span>
              <span className="text-[#E5333F]">−¥{fmtMoney(Math.max(0, Math.round((origTotal - total) * 100) / 100))}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-black/[0.06] px-4 py-3">
          <p className="text-[15px] font-bold text-[#FF4B33]">¥{fmtMoney(total)}</p>
          <button type="button" onClick={submit} className="rounded-full bg-gradient-to-r from-[#E5333F] to-[#FF4B33] px-8 py-2.5 text-[15px] font-semibold text-white active:opacity-85">
            提交订单
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
