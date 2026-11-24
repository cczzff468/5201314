'use client';

/** 美团 App 订单域（第十八轮 #8 拆分）：订单列表（五页签筛选）/骑手地图/订单详情/退款售后/评价弹层。 */

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


// ================================ 订单列表页（截图5） ================================

export const ORDER_TABS: { key: string; match: (o: MtOrder) => boolean }[] = [
  { key: '全部', match: () => true },
  { key: '待付款', match: (o) => o.status === 'pendingPay' },
  { key: '待收货/待使用', match: (o) => o.status === 'pendingAccept' || o.status === 'accepted' || o.status === 'delivering' },
  { key: '评价', match: (o) => o.status === 'completed' },
  // 退款/售后：只显示买了以后退款的（有退款记录的已支付订单；未支付就取消的不算售后）
  { key: '退款/售后', match: (o) => !!o.refund },
];

/** 订单筛选（顶栏筛选按钮：状态细分，与页签叠加） */

export type OrderFilterKey = 'all' | 'pendingPay' | 'live' | 'delivering' | 'completed' | 'canceled';

export const ORDER_FILTERS: { key: OrderFilterKey; label: string; match: (o: MtOrder) => boolean }[] = [
  { key: 'all', label: '全部', match: () => true },
  { key: 'pendingPay', label: '待付款', match: (o) => o.status === 'pendingPay' },
  { key: 'live', label: '进行中', match: (o) => o.status === 'pendingAccept' || o.status === 'accepted' },
  { key: 'delivering', label: '配送中', match: (o) => o.status === 'delivering' },
  { key: 'completed', label: '已送达', match: (o) => o.status === 'completed' },
  { key: 'canceled', label: '已取消', match: (o) => o.status === 'canceled' },
];


export function OrdersPage({
  session,
  tab,
  setTab,
  onOpenOrder,
  onOpenDeal,
  onOpenMerchant,
  onOpenRefund,
  onGoHome,
  onRate,
  onOpenCouponCode,
  onOpenProxy,
  onOpenInvoices,
  onToast,
}: {
  session: MtSession;
  tab: string;
  setTab: (t: string) => void;
  onOpenOrder: (id: string) => void;
  onOpenDeal: (id: string) => void;
  onOpenMerchant: (id: string) => void;
  onOpenRefund: (id: string) => void;
  onGoHome: () => void;
  onRate: (o: MtOrder) => void;
  onOpenCouponCode: (o: MtOrder) => void;
  onOpenProxy: (pid: string) => void;
  onOpenInvoices: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  useOrdersTick();
  const orders = mtLoadOrders(uid);
  const cur = ORDER_TABS.find((t) => t.key === tab) ?? ORDER_TABS[0];

  // 下拉刷新：只提示更新（历史单无限生成已按需求移除——订单只在真实下单后新增，持久保存）
  const pull = useTbPullRefresh(async () => {
    onToast('订单已更新');
  });

  // 搜索（商家/菜品/订单号）+ 状态筛选（与页签叠加）
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderFilterKey>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const filterDef = ORDER_FILTERS.find((f) => f.key === statusFilter) ?? ORDER_FILTERS[0];
  const kw = q.trim().toLowerCase();
  const list = orders.filter(
    (o) =>
      cur.match(o) &&
      filterDef.match(o) &&
      (!kw || o.merchantName.toLowerCase().includes(kw) || o.id.toLowerCase().includes(kw) || o.items.some((i) => i.name.toLowerCase().includes(kw)))
  );

  const cancelOrder = (o: MtOrder) => {
    // 取消订单自动退款：退款/售后列表出现「退款成功」记录（对齐真机）
    mtCancelWithRefund(uid, o.id, '用户主动取消');
    onToast('订单已取消，款项将自动退回');
  };

  const reorder = (o: MtOrder) => {
    // 自建商品订单：商品仍在（mtc-* 商家可解析）→ 正常进店重新挑；已删除则提示
    if (o.custom && !mtMerchantOf(o.merchantId)) {
      onToast('商品已下架，暂不支持再来一单');
      return;
    }
    // 再来一单：跳回对应商家页重新挑选（团购跳团购详情），不再直接塞购物车
    if (o.kind === 'tuangou') {
      const deal = mtDealOf(o.items[0]?.dishId ?? '');
      if (deal) {
        onOpenDeal(deal.id);
        return;
      }
    }
    onOpenMerchant(o.merchantId);
  };

  return (
    <div className="relative flex h-full flex-col bg-white">
      {/* 返回 + 搜索 + 筛选 + 发票（独立页：无底部 tab，顶部返回键回首页） */}
      <div className="shrink-0 border-b border-black/[0.04] bg-white px-3 pb-1 pt-[54px]">
        <div className="flex items-center gap-2.5">
          <button type="button" aria-label="返回" onClick={onGoHome} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/75" />
          </button>
          <div className="flex h-[38px] min-w-0 flex-1 items-center gap-2 rounded-full bg-white px-3.5 shadow-sm">
            <SearchIcon className="h-4 w-4 shrink-0 text-black/35" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索商家 / 菜品 / 订单号"
              data-testid="mt-order-search"
              className="h-full w-full min-w-0 bg-transparent text-[14px] text-black/85 outline-none placeholder:text-black/30"
              maxLength={20}
            />
            {q && (
              <button type="button" aria-label="清空搜索" onClick={() => setQ('')} className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-black/[0.06] text-black/40 active:bg-black/[0.12]">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            data-testid="mt-order-filter-btn"
            className={`relative flex w-[44px] shrink-0 flex-col items-center gap-0.5 ${statusFilter !== 'all' ? 'font-medium text-[#FF6000]' : 'text-black/70'} active:opacity-60`}
          >
            {statusFilter !== 'all' && <span className="absolute right-2.5 top-0 h-1.5 w-1.5 rounded-full bg-[#FF6000]" />}
            <Filter className="h-[19px] w-[19px]" strokeWidth={1.8} />
            <span className="text-[10px]">{statusFilter !== 'all' ? ORDER_FILTERS.find((f) => f.key === statusFilter)?.label ?? '筛选' : '筛选'}</span>
          </button>
          <button type="button" onClick={onOpenInvoices} data-testid="mt-order-invoice-btn" className="flex w-[44px] shrink-0 flex-col items-center gap-0.5 text-black/70 active:opacity-60">
            <FileText className="h-[19px] w-[19px]" strokeWidth={1.8} />
            <span className="text-[10px]">发票</span>
          </button>
        </div>
        {/* 页签（自适应换行，无横向滚动） */}
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
          {ORDER_TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`relative pb-2.5 text-[16px] ${tab === t.key ? 'font-bold text-black/90' : 'text-black/55'}`}>
              {t.key}
              {tab === t.key && <span className="absolute inset-x-0 bottom-[6px] mx-auto h-[3px] w-7 rounded-full bg-[#FF6000]" />}
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={pull.scrollRef}
          {...pull.bind}
          className="h-full overflow-y-auto pb-4"
        >
        {list.length === 0 && (
          <div className="mt-24 text-center">
            <p className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-black/[0.05]">
              <ShoppingBag className="h-7 w-7 text-black/25" strokeWidth={1.8} />
            </p>
            <p className="mt-3 text-[13px] text-black/40">还没有相关订单，去下一单吧</p>
            <button type="button" onClick={onGoHome} className="mt-4 rounded-full bg-[#FFD100] px-6 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
              去逛逛
            </button>
          </div>
        )}
        <div>
          {list.map((o) => {
            const tuangou = o.kind === 'tuangou';
            const qtyTotal = o.items.reduce((s, i) => s + i.qty, 0);
            // 退款/售后页签：对齐真机专项卡（橙色圆标↓ + 商家名 + 右侧退款状态 + 总价行 + 退款进度橙钮）
            // 页签只显示买了以后退款的订单（均有退款记录）
            if (tab === '退款/售后') {
              const rs = o.refund!.status;
              const statusText = rs === 'pending' ? '退款中' : rs === 'failed' ? '退款失败' : '退款成功';
              const statusTone = rs === 'approved' ? 'text-black/45' : 'text-[#FF6000]';
              return (
                <div key={o.id} className="border-t-[7px] border-[#F5F6F7] px-4 py-3.5">
                  <button
                    type="button"
                    onClick={() => onOpenRefund(o.id)}
                    className="w-full text-left active:opacity-80"
                  >
                    <span className="flex items-center gap-2">
                      <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FF8A21] to-[#FF6000]">
                        <ArrowDown className="h-3.5 w-3.5 text-white" strokeWidth={2.6} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[16px] font-bold text-black/90">{o.merchantName.split('（')[0]}</span>
                      <span className={`shrink-0 text-[14px] ${statusTone}`}>{statusText}</span>
                    </span>
                    <span className="mt-3 flex items-center gap-3">
                      <FoodImg src={o.items[0]?.img} emoji={o.items[0]?.emoji ?? o.merchantEmoji} className="h-[72px] w-[72px] shrink-0 rounded-xl" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[17px] font-bold text-black/90">总价：¥{o.total.toFixed(2)}</span>
                        <span className="mt-1 block truncate text-[13px] text-black/40">
                          {tuangou ? `有效期至 ${fmtDate(o.createdAt + 90 * 86400_000)} 23:59` : `下单：${fmtDate(o.createdAt)}`}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-black/35">{o.refund!.reason}</span>
                      </span>
                    </span>
                  </button>
                  <div className="mt-3 flex items-center justify-end border-t border-black/[0.05] pt-2.5">
                    <button
                      type="button"
                      onClick={() => onOpenRefund(o.id)}
                      className="rounded-full bg-gradient-to-r from-[#FF8A21] to-[#FF6000] px-5 py-2 text-[13px] font-medium text-white active:opacity-85"
                    >
                      退款进度
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div key={o.id} className="border-t-[7px] border-[#F5F6F7] px-4 py-3.5">
                <button type="button" onClick={() => onOpenOrder(o.id)} className="w-full text-left">
                  <span className="flex items-center gap-1.5">
                    <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-[#FFF3DC]">
                      <Utensils className="h-3 w-3 text-[#FF8A00]" strokeWidth={2.4} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[16px] font-bold text-black/90">{o.merchantName.split('（')[0]}</span>
                    {o.custom && (
                      <span className="shrink-0 rounded-[3px] border border-[#FFD100]/70 bg-[#FFFBE0] px-1 py-px text-[10px] font-medium leading-[14px] text-[#B77900]" data-testid="mt-custom-tag">
                        {o.custom.type ? `自建·${o.custom.type}` : '自建订单'}
                      </span>
                    )}
                    <span className={`shrink-0 text-[13px] ${['pendingPay', 'pendingAccept', 'accepted', 'delivering'].includes(o.status) ? 'font-medium text-[#FF6000]' : 'text-[#9A9A9A]'}`}>
                      {mtStatusText(o)}
                    </span>
                    {o.refund && (
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ${
                          o.refund.status === 'pending' ? 'bg-[#FFF0EB] text-[#FF6000]' : o.refund.status === 'failed' ? 'bg-[#FDECEC] text-[#F53F3F]' : 'bg-[#F5F6F7] text-black/45'
                        }`}
                      >
                        {o.refund.status === 'pending' ? '退款中' : o.refund.status === 'failed' ? '退款失败' : '已退款'}
                      </span>
                    )}
                    {o.proxy && o.status === 'pendingPay' && (
                      <span className="shrink-0 rounded-full bg-[#FFF0EB] px-1.5 py-px text-[10px] font-medium text-[#FF6000]" data-testid="order-proxy-chip">
                        已请{o.proxy.name}代付
                      </span>
                    )}
                  </span>
                  <span className="mt-2.5 flex items-center gap-2.5">
                    <FoodImg src={o.items[0]?.img} emoji={o.items[0]?.emoji ?? o.merchantEmoji} className="h-[64px] w-[64px] shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] text-black/85">{o.items[0] ? stripDealQty(o.items[0].name) : ''}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-black/45">
                        {o.status === 'completed' && o.consumedAt ? `消费时间: ${fmtDate(o.consumedAt)}` : o.status === 'canceled' ? `下单: ${fmtDate(o.createdAt)}` : `下单: ${fmtDate(o.createdAt)}`}
                      </span>
                      {tuangou && (
                        <span className="mt-1 flex gap-1">
                          <span className="rounded-[3px] border border-black/15 px-1 py-px text-[10px] text-black/45">免预约</span>
                          <span className="rounded-[3px] border border-black/15 px-1 py-px text-[10px] text-black/45">{o.items[0]?.name.includes('早餐') ? '限早餐时段' : '周一至周日可用'}</span>
                        </span>
                      )}
                      {!tuangou && <span className="mt-0.5 block text-[12px] text-black/40">{o.items.length > 1 ? `等${qtyTotal}件商品` : `共${qtyTotal}件`}</span>}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[16px] font-semibold text-black/90">¥{o.total.toFixed(2)}</span>
                      {tuangou && qtyTotal > 1 && <span className="block text-[11px] text-black/40">共{qtyTotal}{mtCountUnit(o.items[0]?.name ?? '')}</span>}
                    </span>
                  </span>
                </button>
                <div className="mt-3 flex items-center justify-end gap-2 border-t border-black/[0.06] pt-2.5">
                  <button type="button" onClick={() => onToast('更多操作（演示）')} className="mr-auto text-[13px] text-black/45 active:opacity-60">
                    更多
                  </button>
                  {o.refund && (
                    <button type="button" onClick={() => onOpenRefund(o.id)} className="rounded-full border border-black/15 px-4 py-1.5 text-[12px] text-black/60 active:bg-black/5">
                      售后详情
                    </button>
                  )}
                  {o.status === 'pendingPay' && (
                    <>
                      {o.proxy && (
                        <button type="button" onClick={() => onOpenProxy(o.proxy!.id)} className="rounded-full border border-[#FF6000] px-4 py-1.5 text-[12px] font-medium text-[#FF6000] active:opacity-75" data-testid="order-proxy-detail-btn">
                          代付详情
                        </button>
                      )}
                      <button type="button" onClick={() => cancelOrder(o)} className="rounded-full border border-black/15 px-4 py-1.5 text-[12px] text-black/60 active:bg-black/5">
                        取消订单
                      </button>
                      <button type="button" onClick={() => onOpenOrder(o.id)} className="rounded-full bg-[#FFD100] px-4 py-1.5 text-[12px] font-semibold text-black/90 active:opacity-85">
                        去支付
                      </button>
                    </>
                  )}
                  {(o.status === 'pendingAccept' || o.status === 'accepted' || o.status === 'delivering') && (
                    <button type="button" onClick={() => onOpenOrder(o.id)} className="rounded-full bg-[#FFD100] px-4 py-1.5 text-[12px] font-semibold text-black/90 active:opacity-85">
                      查看进度
                    </button>
                  )}
                  {(o.status === 'completed' || o.status === 'canceled') && (
                    <>
                      {o.status === 'completed' && o.kind === 'tuangou' && (
                        <button type="button" onClick={() => onOpenCouponCode(o)} className="rounded-full border border-black/15 px-4 py-1.5 text-[12px] text-black/60 active:bg-black/5">
                          券码
                        </button>
                      )}
                      {o.status === 'completed' &&
                        (o.review ? (
                          <button type="button" onClick={() => onToast('已评价过了，感谢您的反馈')} className="rounded-full border border-black/15 px-4 py-1.5 text-[12px] text-black/60">
                            已评价
                          </button>
                        ) : (
                          <button type="button" onClick={() => onRate(o)} className="rounded-full border border-black/15 px-4 py-1.5 text-[12px] text-black/60 active:bg-black/5">
                            评价
                          </button>
                        ))}
                      <button
                        type="button"
                        onClick={() => {
                          const n = mtClaimGodCoupons(uid);
                          onToast(n > 0 ? `已领取${n}张神券，可在「红包卡券」查看` : '神券已领过了，未使用的在卡券包里');
                        }}
                        data-testid="mt-order-claim-god"
                        className="rounded-full border border-black/15 px-4 py-1.5 text-[12px] text-black/60 active:bg-black/5"
                      >
                        领神券
                      </button>
                      <button type="button" onClick={() => reorder(o)} className="rounded-full border border-[#FF6000] px-4 py-1.5 text-[12px] font-medium text-[#FF6000] active:opacity-75">
                        再来一单
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <div className="py-3 text-center text-[12px] text-black/35">—— 到底啦 ——</div>
        </div>
        </div>
        <TbPullIndicator h={pull} />
      </div>

      {/* 筛选弹层（状态细分，与页签叠加） */}
      <AnimatePresence>
        {filterOpen && (
          <motion.div key="mt-order-filter" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50">
            <button type="button" aria-label="关闭筛选" className="absolute inset-0 bg-black/45" onClick={() => setFilterOpen(false)} />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'tween', duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white/80 backdrop-blur-2xl backdrop-saturate-150 px-5 pb-9 pt-5 shadow-[0_-16px_50px_rgba(0,0,0,0.18)]"
              data-testid="mt-order-filter-sheet"
            >
              <div className="flex items-center">
                <p className="text-[16px] font-bold text-black/85">按状态筛选</p>
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className="ml-auto text-[12px] text-black/45 active:opacity-70"
                >
                  重置
                </button>
              </div>
              <div className="mt-3.5 flex flex-wrap gap-2">
                {ORDER_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setStatusFilter(f.key)}
                    className={`h-9 rounded-full px-4 text-[13px] ${statusFilter === f.key ? 'font-semibold text-black/85 shadow-[0_4px_14px_rgba(255,190,0,0.45)]' : 'bg-[#F5F6F7] text-black/60'}`}
                    style={statusFilter === f.key ? { background: '#FFD100' } : undefined}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setFilterOpen(false)}
                className="mt-5 h-12 w-full rounded-full text-[15px] font-bold text-black/85 shadow-[0_8px_22px_rgba(255,190,0,0.45)] active:opacity-85"
                style={{ background: '#FFD100' }}
              >
                查看{list.length}单
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ================================ 订单详情页（截图8/9/10） ================================

/** 配送小地图（纯地图：绿地水系/路网 + 商家/家扁平小标记 + 立体骑手形象；全部白色圆角面板已按需求移除。
 *  地名按真实地址显示：商家侧路名取自商家数据 addr、收货侧小区取自订单收货地址（如「幸福小区西区 3 栋…」→「幸福小区西区」），
 *  其余路网名从美团在售商家真实路名池按商家名散列选取，同一商家稳定不变。
 *  骑手按真实配送时间从商家图标单向驶向家图标（不再来回）：取餐时刻→预计送达时刻沿贝塞尔曲线插值，父组件逐秒刷新） */

export const MT_ROAD_POOL = ['解放大道', '红旗路', '建设路', '朝阳路', '人民路', '文化路', '东风路', '新华路', '学院路', '濮上中路'];

/** 配送路线二次贝塞尔曲线（与 SVG path M 75 139 Q 241 92 443 177 同一条，viewBox 500×208） */

export const MT_ROUTE_P0: [number, number] = [75, 139];

export const MT_ROUTE_PC: [number, number] = [241, 92];

export const MT_ROUTE_P1: [number, number] = [443, 177];


export function DeliveryMap({
  merchantName,
  merchantId,
  addressText,
  deliveringAt,
  etaAt,
}: {
  merchantName: string;
  merchantId: string;
  addressText?: string;
  /** 骑手取餐时刻（delivering 流水时间）：进度起点 */
  deliveringAt?: number;
  /** 预计送达时刻（etaAt，催单后已提前）：进度终点 */
  etaAt?: number;
}) {
  // 真实地址推导：商家路名 / 收货小区 / 交叉路名（按商家名散列稳定选取）
  const addr = mtMerchantOf(merchantId)?.addr ?? '';
  const road = addr.match(/[\u4e00-\u9fa5]{2,6}(?:大道|路|街)/)?.[0] ?? '解放大道';
  const community = (addressText ?? '').trim().split(/\s+/)[0] || '幸福小区西区';
  const otherCommunity = community.includes('科技园') ? '幸福小区西区' : '科技园写字楼';
  const hash = [...merchantName].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const others = MT_ROAD_POOL.filter((r) => r !== road);
  const cross = others[hash % others.length];
  const third = others[(hash + 3) % others.length];
  const storeShort = merchantName.split(/[（(]/)[0] ?? merchantName;
  // 骑手进度：取餐(0%)→预计送达(100%) 按真实时间插值；无流水/异常时刻兜底起点，永不倒退出地图
  const prog = (() => {
    const start = deliveringAt ?? Date.now();
    const end = etaAt && etaAt > start ? etaAt : start + 30 * 60_000;
    return Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
  })();
  const u = 1 - prog;
  // 二次贝塞尔插值（x/500、y/208 → 百分比，preserveAspectRatio=none 拉伸铺满容器）
  const riderX = (u * u * MT_ROUTE_P0[0] + 2 * u * prog * MT_ROUTE_PC[0] + prog * prog * MT_ROUTE_P1[0]) / 5;
  const riderY = (u * u * MT_ROUTE_P0[1] + 2 * u * prog * MT_ROUTE_PC[1] + prog * prog * MT_ROUTE_P1[1]) / 2.08;
  return (
    <div className="relative h-52 overflow-hidden rounded-xl bg-[#EAF0E3] ring-1 ring-black/5" aria-label={`${merchantName} 配送地图`}>
      {/* 绿地与水系 */}
      <div className="absolute -left-8 top-6 h-24 w-40 rounded-[46%] bg-[#D7E7C9]" />
      <div className="absolute -right-10 -top-6 h-28 w-48 rounded-[48%] bg-[#DDEBD0]" />
      <div className="absolute -bottom-10 left-16 h-24 w-44 rounded-[48%] bg-[#C7DFF2]" />
      <div className="absolute bottom-10 right-[-30px] h-16 w-28 rounded-[45%] bg-[#D7E7C9]" />
      {/* 建筑块 */}
      <div className="absolute bottom-[30%] right-[26%] h-5 w-9 rounded-[3px] bg-black/[0.05]" />
      <div className="absolute bottom-[36%] right-[34%] h-4 w-6 rounded-[3px] bg-black/[0.05]" />
      <div className="absolute left-[30%] top-[14%] h-4 w-8 rounded-[3px] bg-black/[0.05]" />
      {/* 路网 */}
      <div className="absolute left-0 right-0 top-[42%] h-[7px] -rotate-3 bg-white/90" />
      <div className="absolute bottom-[-4%] left-[34%] top-[-4%] w-[6px] rotate-6 bg-white/90" />
      <div className="absolute left-[-6%] right-[24%] top-[70%] h-[5px] rotate-6 bg-white/75" />
      <div className="absolute bottom-[-6%] left-[68%] top-[12%] w-[5px] -rotate-12 bg-white/75" />
      <div className="absolute left-[-4%] right-[-4%] top-[16%] h-[4px] rotate-2 bg-white/60" />
      {/* 地名（按真实地址：商家路名 + 收货小区 + 在售商家真实路名池） */}
      <span className="absolute left-[7%] top-[24%] text-[11px] text-black/30">中心广场</span>
      <span className="absolute right-[7%] top-[7%] text-[12px] font-medium text-black/40">{otherCommunity}</span>
      <span className="absolute right-[4%] top-[47%] text-[11px] tracking-wide text-black/30">{cross}</span>
      <span className="absolute left-[34%] top-[60%] -rotate-3 text-[12px] tracking-wide text-black/35">{road}</span>
      <span className="absolute bottom-[14%] left-[52%] text-[11px] text-black/30">{third}</span>
      {/* 收货小区（家标记上方，跟真实收货地址） */}
      <span className="absolute bottom-[24%] right-[4%] text-[11px] font-medium text-black/45">{community}</span>
      {/* 商家名（商家标记上方，跟真实店铺） */}
      <span className="absolute left-[4%] top-[48%] max-w-[38%] truncate text-[10px] font-medium text-black/45">{storeShort}</span>
      {/* 配送路线（商家标记 → 家标记 的弧线虚线；与骑手内联插值同一条二次贝塞尔曲线，
          viewBox 拉伸铺满容器（preserveAspectRatio=none），坐标即百分比×(500,208)，骑手永不跑出地图） */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 500 208" preserveAspectRatio="none" fill="none" aria-hidden="true">
        <path d="M 75 139 Q 241 92 443 177" stroke="#FFC300" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 9" opacity="0.85" />
      </svg>
      {/* 商家标记（扁平小图标，无白底面板） */}
      <Store className="absolute left-[12%] top-[62%] h-[22px] w-[22px] text-[#FF8A00] drop-shadow-[0_2px_2px_rgba(0,0,0,0.22)]" strokeWidth={2.2} />
      {/* 家标记 */}
      <HomeIcon className="absolute bottom-[9%] right-[8%] h-6 w-6 text-[#F5A300] drop-shadow-[0_2px_2px_rgba(0,0,0,0.22)]" strokeWidth={2.2} />
      {/* 骑手形象（立体投影 + 颠簸；透明 PNG 无白边，形象在「我的-骑手」选择；
          位置按真实配送时间沿曲线从商家→家单向前进，46px 缩小一号不遮挡路线） */}
      <span className="mt-rider absolute block" style={{ left: `calc(${riderX}% - 23px)`, top: `calc(${riderY}% - 23px)` }}>
        <img
          src={mtRiderSrcOf(mtGetRiderId())}
          alt="外卖骑手"
          draggable={false}
          className="mt-rider-img h-[46px] w-[46px] select-none object-contain"
          style={{ filter: 'drop-shadow(0 5px 4px rgba(0,0,0,0.25)) drop-shadow(0 1.5px 2px rgba(0,0,0,0.18))' }}
        />
      </span>
    </div>
  );
}

/** 信息行（订单信息卡） */


export function OrderDetailPage({
  session,
  orderId,
  onBack,
  onOpenPay,
  onGoOrders,
  onOpenDeal,
  onOpenMerchant,
  onPickAddress,
  onApplyRefund,
  onOpenRefund,
  onRate,
  onOpenCouponCode,
  onToast,
}: {
  session: MtSession;
  orderId: string;
  onBack: () => void;
  onOpenPay: (o: MtOrder) => void;
  onGoOrders: () => void;
  onOpenDeal: (id: string) => void;
  onOpenMerchant: (id: string) => void;
  onPickAddress: () => void;
  onApplyRefund: (o: MtOrder) => void;
  onOpenRefund: (o: MtOrder) => void;
  onRate: (o: MtOrder) => void;
  onOpenCouponCode: (o: MtOrder) => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  useOrdersTick();
  const [, forceTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  // 面板状态：订单信息展开 / 订单跟踪底栏 / 待支付更多操作 / 订单分享（hooks 必须在提前 return 之前）
  const [infoOpen, setInfoOpen] = useState(false);
  const [trackOpen, setTrackOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // 分享面板：plat → contact → 发送动态卡片进好友聊天
  const [shareStep, setShareStep] = useState<'plat' | 'contact' | null>(null);
  const [sharePlat, setSharePlat] = useState<'wx' | 'qq' | null>(null);
  const [shareContact, setShareContact] = useState<string | null>(null);
  const [shareSending, setShareSending] = useState(false);
  const order = mtGetOrder(uid, orderId);
  if (!order) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-white">
        <p className="text-[13px] text-black/40">订单不存在</p>
        <button type="button" onClick={onGoOrders} className="mt-3 rounded-full bg-[#FFD100] px-5 py-2 text-[13px] font-medium text-black/85">
          返回订单列表
        </button>
      </div>
    );
  }

  const tuangou = order.kind === 'tuangou';
  const trip = order.kind === 'flight' || order.kind === 'train';

  const steps: { key: string; icon: 'pay' | 'store' | 'bike' | 'home'; at?: number }[] = trip
    ? [
        { key: '已支付', icon: 'pay', at: order.paidAt },
        { key: order.kind === 'flight' ? '值机' : '检票', icon: 'store', at: order.statusLog.find((s) => s.status === 'accepted')?.at },
        { key: order.kind === 'flight' ? '飞行中' : '乘车中', icon: 'bike', at: order.statusLog.find((s) => s.status === 'delivering')?.at },
        { key: '已到达', icon: 'home', at: order.statusLog.find((s) => s.status === 'completed')?.at },
      ]
    : [
        { key: '已支付', icon: 'pay', at: order.paidAt },
        { key: '商家接单', icon: 'store', at: order.statusLog.find((s) => s.status === 'accepted')?.at },
        { key: '骑手取餐', icon: 'bike', at: order.statusLog.find((s) => s.status === 'delivering')?.at },
        { key: '已送达', icon: 'home', at: order.statusLog.find((s) => s.status === 'completed')?.at },
      ];
  const doneIdx = steps.reduce((acc, s, i) => (s.at ? i : acc), -1);

  const cancel = () => {
    if (order.status === 'pendingAccept') {
      // 已支付单取消 → 自动原路退款（退款/售后可查）
      mtCancelWithRefund(uid, order.id, '用户取消，支付金额将原路退回');
      onToast('订单已取消，款项将自动退回');
      return;
    }
    const list = mtLoadOrders(uid).map((x) =>
      x.id === order.id ? { ...x, status: 'canceled' as const, cancelReason: '用户主动取消', statusLog: [...x.statusLog, { status: 'canceled' as const, at: Date.now() }] } : x
    );
    mtSaveOrders(uid, list);
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    onToast('订单已取消');
  };

  const copy = (text: string) => {
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      /* 忽略 */
    }
    onToast('已复制');
  };

  // 待支付 15 分钟真实倒计时（对齐真机「请在 14:10 内支付」）
  const payCountdown = (() => {
    const left = Math.max(0, order.createdAt + PAY_TIMEOUT_MS - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  })();
  // 配送时长（31~40 分钟，按订单号确定性推导）→ 承诺送达时刻（与支付页/状态机完全同源）
  const deliveryMin = mtDeliveryMinutesOf(order.id);
  const payEtaText = fmtTime(order.createdAt + deliveryMin * 60_000);
  const inProgress = order.status === 'pendingAccept' || order.status === 'accepted' || order.status === 'delivering';
  const trackable = inProgress || order.status === 'completed' || order.status === 'canceled';
  const etaText = order.etaAt ? fmtTime(order.etaAt) : '--:--';
  const couponAmt = Math.min(order.couponAmount ?? 0, order.discount);
  const voucherCut = Math.max(0, Math.round((order.discount - couponAmt) * 100) / 100);

  const reorder = () => {
    // 自建商品订单：商品仍在（mtc-* 商家可解析）→ 正常进店重新挑；已删除则提示
    if (order.custom && !mtMerchantOf(order.merchantId)) {
      onToast('商品已下架，暂不支持再来一单');
      return;
    }
    // 再来一单：跳回商家页重新挑选（团购跳团购详情），不再直接塞购物车
    if (tuangou) {
      const deal = mtDealOf(order.items[0]?.dishId ?? '');
      if (deal) {
        onOpenDeal(deal.id);
        return;
      }
    }
    onOpenMerchant(order.merchantId);
  };

  /** 发送订单分享：动态卡片进好友聊天（买的什么/金额/五段状态/骑手名实时同步） */
  const sendShare = async () => {
    if (!sharePlat || !shareContact || shareSending) return;
    setShareSending(true);
    await new Promise((r) => setTimeout(r, 650));
    const res = await mtCreateOrderShare({ order, idp: sharePlat, contactId: shareContact, fromName: session.name });
    setShareSending(false);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    setShareStep(null);
    onToast(`订单动态已分享给${res.share.contactName}`);
  };

  // 美化分享按钮（箭头式简约图标 + 美团黄渐变圆钮：待支付/进行中/配送中/已完成详情右上角统一）
  const shareBtn = (
    <button
      type="button"
      aria-label="分享"
      data-testid="order-share-btn"
      onClick={() => setShareStep('plat')}
      className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#FFD100] to-[#FFB800] shadow-[0_2px_8px_rgba(255,180,0,0.45)] active:opacity-80"
    >
      <MtShareGlyph className="h-[18px] w-[18px] text-white" />
    </button>
  );

  // 详情头文案（待支付=真实倒计时；进行中=ETA 大字；机票/火车票用出行专属文案）
  const hero: { big: ReactNode; sub: ReactNode; tag?: string } = (() => {
    if (order.status === 'pendingPay') {
      return {
        big: (
          <>
            请在 <span data-testid="pay-countdown">{payCountdown}</span> 内支付
          </>
        ),
        sub: order.proxy ? (
          // B4/B5：请求终态时副文案如实反映（婉拒/失效/已代付），不再一律「好友付款后自动完成」
          (() => {
            const st = mtGetProxy(order.proxy.id)?.status;
            if (st === 'declined') return `已请「${order.proxy.name}」代付，对方婉拒了——可以直接自己支付`;
            if (st === 'expired') return `已请「${order.proxy.name}」代付，请求已失效——可以直接自己支付`;
            return `已请「${order.proxy.name}」代付，好友付款后自动完成`;
          })()
        ) : (
          <>
            现在支付，预计<span className="font-medium text-[#FF6000]">{payEtaText}</span>送达
          </>
        ),
      };
    }
    if (trip) {
      if (order.status === 'pendingAccept') return { big: '待出行', sub: mtStatusBody(order), tag: order.kind === 'flight' ? '已出票' : '购票成功' };
      if (order.status === 'accepted') return { big: '出行中', sub: mtStatusBody(order) };
      if (order.status === 'completed') return { big: '行程已结束', sub: '感谢乘坐，欢迎评价' };
      return { big: '订单已取消', sub: order.cancelReason ?? '订单已取消' };
    }
    if (order.status === 'pendingAccept') return { big: etaText, sub: '等待商家接单', tag: '预计送达' };
    if (order.status === 'accepted') return { big: etaText, sub: '商家已接单，商品备餐中', tag: '预计送达' };
    if (order.status === 'delivering') return { big: etaText, sub: '骑手正在送货', tag: '预计送达' };
    if (order.status === 'completed') {
      if (tuangou && !order.consumedAt) return { big: '团购已购，待使用', sub: '到店出示券码即可核销' };
      if (tuangou) return { big: '团购已消费', sub: '感谢光临，欢迎再次光临' };
      return { big: '订单已完成', sub: '订单已送达，请厉行节约，拒绝浪费，期待能再次光临' };
    }
    return { big: '订单已取消', sub: order.cancelReason ?? '订单已取消' };
  })();

  // 订单跟踪时间线（全部取真实状态流水时间，对齐真机「订单跟踪」底栏）
  const trackEvents: { text: string; at: number; rider?: boolean; final?: boolean }[] = (() => {
    const logAt = (s: string) => order.statusLog.find((x) => x.status === s)?.at;
    const evs: { text: string; at: number; rider?: boolean; final?: boolean }[] = [];
    if (trip) {
      evs.push({ text: '您提交了订单，请完成支付', at: order.createdAt });
      if (order.paidAt) evs.push({ text: order.kind === 'flight' ? '支付成功，出票成功，值机选座已开启' : '支付成功，购票成功，请提前到站候车', at: logAt('pendingAccept') ?? order.paidAt });
      const acc = logAt('accepted');
      if (acc) evs.push({ text: order.kind === 'flight' ? '航班起飞，行程开始' : '列车发车，行程开始', at: acc });
      const done = logAt('completed');
      if (done) {
        evs.push({ text: order.kind === 'flight' ? '航班落地，行程结束' : '列车到达，行程结束', at: done });
        evs.push({ text: '订单已完成', at: done, final: true });
      }
      return evs;
    }
    if (tuangou) {
      evs.push({ text: '您提交了订单，请完成支付', at: order.createdAt });
      if (order.paidAt) evs.push({ text: '支付成功，团购券已发放', at: logAt('completed') ?? order.paidAt });
      if (order.consumedAt) evs.push({ text: '到店核销成功，订单已完成', at: order.consumedAt, final: true });
      return evs;
    }
    evs.push({ text: '您提交了订单，请等待第三方卖家系统确认', at: order.createdAt });
    if (order.paidAt) evs.push({ text: '待商家接单', at: logAt('pendingAccept') ?? order.paidAt });
    const acc = logAt('accepted');
    if (acc) evs.push({ text: '商家已接单，商品备餐中', at: acc });
    const del = logAt('delivering');
    if (del) evs.push({ text: `骑手已接单，骑手 ${order.riderName ?? ''}`, at: del, rider: true });
    const done = logAt('completed');
    if (done) {
      evs.push({ text: '订单已送达，感谢您的信任，期待能再次为您服务', at: done });
      evs.push({ text: '订单已完成', at: done, final: true });
    }
    if (order.status === 'canceled') evs.push({ text: order.cancelReason ?? '订单已取消', at: logAt('canceled') ?? Date.now(), final: true });
    return evs;
  })();

  // 顶栏（待支付=返回+客服胶囊；进行中=返回+分享/客服/刷新；完成/取消=返回+客服）
  const topBar = (() => {
    if (order.status === 'pendingPay') {
      return (
        <div className="flex items-center justify-between px-3 pb-1 pt-[54px]">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-white shadow-sm ring-1 ring-black/5 active:opacity-75">
            <ChevronLeft className="h-5 w-5 text-black/80" />
          </button>
          <span className="flex items-center gap-2">
            {shareBtn}
            <button type="button" aria-label="联系客服" onClick={() => onToast('美团客服：0539-000-0000（演示）')} className="flex h-9 items-center gap-1 rounded-full bg-white px-3.5 shadow-sm ring-1 ring-black/5 active:opacity-75">
              <Headset className="h-4 w-4 text-black/70" strokeWidth={1.9} />
              <span className="text-[13px] font-medium text-black/75">客服</span>
            </button>
          </span>
        </div>
      );
    }
    if (inProgress) {
      return (
        <div className="flex items-center gap-1 px-3 pb-1 pt-[54px]">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/75" />
          </button>
          <span className="flex-1" />
          {shareBtn}
          <button type="button" aria-label="客服" onClick={() => onToast('美团客服：0539-000-0000（演示）')} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <Headset className="h-[19px] w-[19px] text-black/70" strokeWidth={1.8} />
          </button>
          <button type="button" aria-label="刷新" onClick={() => forceTick((t) => t + 1)} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <RotateCw className="h-[18px] w-[18px] text-black/70" strokeWidth={1.8} />
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1 px-3 pb-1 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-6 w-6 text-black/75" />
        </button>
        <span className="flex-1" />
        {order.status === 'completed' && shareBtn}
        <button type="button" aria-label="客服" onClick={() => onToast('美团客服：0539-000-0000（演示）')} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <Headset className="h-[19px] w-[19px] text-black/70" strokeWidth={1.8} />
        </button>
      </div>
    );
  })();

  // 状态 hero（白色块：ETA 大字可点开「订单跟踪」；待支付/完成后灰底直排）
  const heroTitle = (
    <p className="flex items-center gap-1.5 text-[26px] font-bold leading-tight text-black/90">
      {hero.big}
      {hero.tag && <span className="text-[13px] font-normal text-black/45">{hero.tag}</span>}
      {trackable && <ChevronRight className="h-5 w-5 text-black/30" />}
    </p>
  );
  const heroBlock = (
    <div className="px-4 pb-2 pt-1">
      {trackable ? (
        <button type="button" data-testid="open-track" onClick={() => setTrackOpen(true)} className="w-full text-left active:opacity-70">
          {heroTitle}
        </button>
      ) : (
        heroTitle
      )}
      <p className="mt-1 text-[15px] font-semibold text-black/80">{hero.sub}</p>
    </div>
  );

  // 四节点进度（黄色已完节点 + 灰色待完成，对齐真机）
  const progressBlock = !tuangou && order.status !== 'pendingPay' && order.status !== 'canceled' ? (
    <div className="mt-2 px-5 pb-1">
      <div className="flex items-center">
        {steps.map((s, i) => (
          <div key={s.key} className="flex flex-1 items-center last:flex-none">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${i <= doneIdx ? 'bg-[#FFD100] text-black/85' : 'bg-[#F0F1F2] text-black/30'}`}>
              {s.icon === 'pay' && <span className="text-[13px] font-bold">¥</span>}
              {s.icon === 'store' && <Store className="h-4 w-4" strokeWidth={2.2} />}
              {s.icon === 'bike' && <Bike className="h-4 w-4" strokeWidth={2.4} />}
              {s.icon === 'home' && <Check className="h-4 w-4" strokeWidth={3} />}
            </span>
            {i < steps.length - 1 && <span className={`mx-0.5 h-[5px] flex-1 rounded-full ${i < doneIdx ? 'bg-[#FFD100]' : 'bg-[#F0F1F2]'}`} />}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-black/45">
        {steps.map((s) => (
          <span key={s.key} className="w-8 text-center first:text-left last:text-right">{s.key}</span>
        ))}
      </div>
    </div>
  ) : null;

  // 配送地图（仅配送中；骑手按真实时间从商家→家单向前进，形象在「我的-骑手」选择，剩余分钟见 ETA 大标题；地名跟真实商家/收货地址）
  const mapBlock = order.status === 'delivering' ? (
    <div className="px-3 pb-1 pt-3">
      <DeliveryMap
        merchantName={order.merchantName}
        merchantId={order.merchantId}
        addressText={order.address?.text}
        deliveringAt={order.statusLog.find((s) => s.status === 'delivering')?.at}
        etaAt={order.etaAt}
      />
    </div>
  ) : null;

  // 操作按钮行（进行中；对齐真机：更多平铺 + 白胶囊 + 联系骑手黄描边）
  const actionBlock = trip && (order.status === 'pendingAccept' || order.status === 'accepted') ? (
    <div className="flex gap-2 overflow-x-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {['更多', order.kind === 'flight' ? '值机选座' : '改签', '联系客服', order.kind === 'flight' ? '航班动态' : '正晚点查询'].map((t, i) => (
        <button
          key={t}
          type="button"
          onClick={() => onToast(i === 0 ? '更多服务（演示）' : `${t}（演示）`)}
          className={`flex-1 whitespace-nowrap rounded-full border py-2.5 text-[12px] active:bg-black/5 ${i === 1 ? 'border-[#FFD100] bg-[#FFFBE0] font-medium text-[#B77900]' : 'border-black/10 bg-white text-black/65'}`}
        >
          {t}
        </button>
      ))}
    </div>
  ) : !trip && (order.status === 'accepted' || order.status === 'delivering') ? (
    <div className="flex items-center gap-2 overflow-x-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button type="button" onClick={() => onToast('更多服务（演示）')} className="shrink-0 px-2 text-[13px] text-black/65 active:opacity-70">
        更多
      </button>
      <button
        type="button"
        onClick={() => {
          // 催一下：真实催单（etaAt 提前——剩余>5分钟减5分钟，剩余少减10秒~1分钟）
          onToast(mtUrgeOrder(uid, order.id).msg);
        }}
        className="shrink-0 whitespace-nowrap rounded-full border border-black/10 bg-white px-4 py-2.5 text-[12px] text-black/70 active:bg-black/5"
      >
        催一下
      </button>
      {['申请售后', '联系商家'].map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onToast(t === '申请售后' ? '售后申请已提交（演示）' : '已发起联系（演示）')}
          className="shrink-0 whitespace-nowrap rounded-full border border-black/10 bg-white px-4 py-2.5 text-[12px] text-black/70 active:bg-black/5"
        >
          {t}
        </button>
      ))}
      <button type="button" onClick={() => onToast('已发起联系（演示）')} className="shrink-0 whitespace-nowrap rounded-full border border-[#FFC53D] bg-white px-4 py-2.5 text-[12px] font-medium text-black/80 active:bg-black/5">
        联系骑手
      </button>
    </div>
  ) : null;

  // 帮助胶囊（待支付=收货码/改地址/红包；其余=保单/邀请红包/充值）
  const helpPills: { t: string; a: () => void }[] =
    order.status === 'pendingPay'
      ? [
          { t: '收货码的作用', a: () => onToast('收货码用于确认收货（演示）') },
          { t: '修改订单地址', a: onPickAddress },
          { t: '红包无法使用', a: () => onToast('红包可与商家券叠加使用（演示）') },
        ]
      : [
          { t: '如何查询保单号', a: () => onToast('放心吃保单可在客服处查询（演示）') },
          { t: '邀请领红包', a: () => onToast('邀请好友下单得红包（演示）') },
          { t: '充值享优惠', a: () => onToast('充值享优惠（演示）') },
        ];

  return (
    <div className="relative flex h-full flex-col bg-[#F4F5F7]">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 顶部：进行中为白色块（顶栏+ETA+进度+地图+操作行），其余灰底直排 */}
        {inProgress ? (
          <div className="bg-white pb-1">
            {topBar}
            {heroBlock}
            {progressBlock}
            {mapBlock}
            {actionBlock}
          </div>
        ) : (
          <>
            {topBar}
            {heroBlock}
          </>
        )}

        {/* 待支付操作行：⋮ / 他人代付 / 立即支付（对齐真机收银台样式） */}
        {order.status === 'pendingPay' && (
          <div className="flex items-center gap-2 px-3 pb-1 pt-3">
            <button type="button" aria-label="更多操作" onClick={() => setMoreOpen(true)} className="grid h-10 w-9 shrink-0 place-items-center rounded-full active:bg-black/5">
              <EllipsisVertical className="h-5 w-5 text-black/70" />
            </button>
            <button type="button" onClick={() => onOpenPay(order)} className="h-10 shrink-0 rounded-full bg-white px-4 text-[14px] font-medium text-black/80 shadow-sm ring-1 ring-black/5 active:opacity-80">
              他人代付
            </button>
            <button type="button" onClick={() => onOpenPay(order)} className="h-10 min-w-0 flex-1 truncate rounded-full bg-[#FFD100] text-[15px] font-semibold text-black/90 active:opacity-85">
              立即支付 ¥{fmtMoney(order.total)}
            </button>
          </div>
        )}

        {/* 退款/售后进度（点击进「售后详情」） */}
        {order.refund && (
          <div className="mx-3 mt-2.5 rounded-xl bg-white px-4 py-4">
            <button type="button" onClick={() => onOpenRefund(order)} className="flex w-full items-center gap-2.5 text-left active:opacity-75">
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                  order.refund.status === 'pending' ? 'bg-[#FFF0EB]' : order.refund.status === 'failed' ? 'bg-[#FDECEC]' : 'bg-[#E8F9EF]'
                }`}
              >
                <Undo2
                  className={`h-[18px] w-[18px] ${order.refund.status === 'pending' ? 'text-[#FF6000]' : order.refund.status === 'failed' ? 'text-[#F53F3F]' : 'text-[#00A661]'}`}
                  strokeWidth={2}
                />
              </span>
              <p className="min-w-0 flex-1 text-[15px] font-bold text-black/85">
                {order.refund.status === 'pending' ? '退款审核中' : order.refund.status === 'failed' ? '退款失败' : '已退款'}
              </p>
              <span className="shrink-0 text-[16px] font-bold" style={{ color: MT_PRICE }}>
                ¥{fmtMoney(order.refund.amount)}
              </span>
            </button>
            <div className="mt-1.5">
              <InfoRow k="退款原因" v={order.refund.reason} />
              {order.refund.note && <InfoRow k="补充说明" v={order.refund.note} />}
              {order.refund.status === 'failed' && order.refund.failMsg && <InfoRow k="失败原因" v={order.refund.failMsg} />}
              <InfoRow k="退款方式" v={`原路退回 · ${order.refund.channel ?? (order.payIdp === 'qq' ? 'QQ钱包' : '微信支付')}`} />
              <InfoRow k="申请时间" v={fmtDateTime(order.refund.appliedAt)} />
              {order.refund.doneAt && order.refund.status !== 'failed' && <InfoRow k="退款时间" v={fmtDateTime(order.refund.doneAt)} />}
            </div>
            <button type="button" onClick={() => onOpenRefund(order)} className="mt-2 flex w-full items-center justify-between border-t border-dashed border-black/10 pt-3 active:opacity-75">
              <span className="text-[12px] text-black/55">
                {order.refund.status === 'pending'
                  ? '商家审核中，退款将原路退回您的支付账户'
                  : order.refund.status === 'failed'
                    ? '退款失败，点击查看详情并重新发起'
                    : '退款已原路退回，查看售后详情'}
              </span>
              <span className="flex items-center text-[12px] font-medium text-black/75">
                售后详情
              </span>
            </button>
          </div>
        )}

        {/* 订单信息（灰底白卡；待支付=取件/收件地址+可展开明细，其余=配送信息） */}
        <div className="mx-3 mt-2.5 rounded-xl bg-white px-4 py-4">
          <p className="text-[16px] font-bold text-black/85">订单信息</p>
          {order.status === 'pendingPay' && !tuangou && !trip ? (
            <>
              <div className="mt-2 space-y-3">
                <div className="flex items-start justify-between gap-5">
                  <span className="shrink-0 text-[13px] text-black/35">取件地址</span>
                  <span className="min-w-0 text-right text-[13px] leading-[1.6] text-black/80">
                    {order.merchantName}
                    <br />
                    {mtMerchantContact(order.merchantId || order.id)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-5">
                  <span className="shrink-0 text-[13px] text-black/35">收件地址</span>
                  <span className="min-w-0 text-right text-[13px] leading-[1.6] text-black/80">
                    {order.address?.text ?? '—'}
                    <br />
                    {order.address ? `${order.address.name} ${maskPhone(order.address.phone)}` : ''}
                  </span>
                </div>
              </div>
              <div className="mt-3 border-t border-dashed border-black/10 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-black/60">实付款</span>
                  <span className="text-[17px] font-bold text-black/90">¥{fmtMoney(order.total)}</span>
                </div>
              </div>
              <button type="button" onClick={() => setInfoOpen((v) => !v)} className="mx-auto mt-2.5 flex items-center gap-0.5 text-[12px] text-black/35 active:opacity-70">
                订单号/下单时间/费用明细
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${infoOpen ? 'rotate-180' : ''}`} />
              </button>
              {infoOpen && (
                <div className="mt-1 border-t border-black/5 pt-1">
                  <InfoRow k="订单号码" v={order.id} action={<CopyBtn onClick={() => copy(order.id)} />} />
                  <InfoRow k="下单时间" v={fmtDateTimeSec(order.createdAt)} />
                  <InfoRow k="商品总价" v={`¥${fmtMoney(order.itemTotal)}`} />
                  {!tuangou && <InfoRow k="配送费" v={`¥${fmtMoney(order.deliveryFee)}`} />}
                  {order.discount > 0 && <InfoRow k="优惠共减" v={`-¥${fmtMoney(order.discount)}`} />}
                </div>
              )}
            </>
          ) : (
            <>
          <div className="mt-1.5">
            {tuangou ? (
              <>
                <InfoRow k="期望时间" v="免预约 · 随时可用" />
                <InfoRow k="适用门店" v={`${order.merchantName}（门店通用）`} />
                <InfoRow k="使用规则" v="随时退 · 过期自动退" />
              </>
            ) : trip ? (
              <>
                <InfoRow k="出行人" v={session.name} />
                <InfoRow k="出行信息" v={order.items[0]?.spec ?? order.merchantName} />
                <InfoRow k="出票状态" v={order.kind === 'flight' ? '已出票 · 凭身份证值机' : '购票成功 · 凭身份证进站'} />
                <InfoRow k="退改规则" v={order.kind === 'flight' ? '按航司规则 · 含延误取消保障' : '开车前可退 · 按铁路局规则收费'} />
              </>
            ) : (
              <>
                <InfoRow k="期望时间" v="立即配送" />
                <InfoRow k="配送地址" v={order.address ? `${order.address.text}（${order.address.name} ${maskPhone(order.address.phone)}）` : '—'} />
                <InfoRow k="餐具数量" v="2份" />
                {order.paidAt && <InfoRow k="配送服务" v="美团专送" />}
                {(order.status === 'accepted' || order.status === 'delivering') && (
                  <InfoRow
                    k="配送骑手"
                    v={order.riderName ?? '待分配'}
                    action={<SmallPill onClick={() => onToast('打赏/查看骑手（演示）')}>打赏/查看骑手</SmallPill>}
                  />
                )}
                {order.paidAt && <InfoRow k="号码保护" v="保护隐私，服务护航" />}
                {order.paidAt && <InfoRow k="录音保护" v="交餐录音，保护安全" />}
              </>
            )}
          </div>
          <div className="mt-2 border-t border-dashed border-black/10 pt-1.5">
            <InfoRow k="订单号码" v={order.id} action={<CopyBtn onClick={() => copy(order.id)} />} />
            <InfoRow k="下单时间" v={fmtDateTimeSec(order.createdAt)} />
            <InfoRow k="支付方式" v={order.paidAt ? (order.payChannelLabel ?? (order.payIdp === 'wx' ? '微信支付' : order.payIdp === 'qq' ? 'QQ支付' : '美团支付')) : '在线支付（未支付）'} />
            {tuangou && order.consumedAt && <InfoRow k="消费时间" v={fmtDateTime(order.consumedAt)} />}
          </div>
            </>
          )}
        </div>

        {/* 商品费用（灰底白卡：明细 + 红包/神券分项 + 已优惠合计，对齐真机） */}
        <div className="mx-3 mt-2.5 rounded-xl bg-white px-4 py-4">
          <div className="flex items-center gap-2">
            {order.merchantImg ? (
              <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md">
                <FoodImg src={order.merchantImg} emoji={order.merchantEmoji} className="h-full w-full" />
              </span>
            ) : (
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[#FFF3B8] text-[14px]">{order.merchantEmoji}</span>
            )}
            <p className="min-w-0 flex-1 truncate text-[16px] font-bold text-black/85">{order.merchantName}</p>
            <button type="button" onClick={() => onToast('已加入商家粉丝群（演示）')} className="shrink-0 text-[12px] font-medium text-[#FF6000]">
              进商家粉丝群
            </button>
          </div>
          <div className="mt-2.5 space-y-2">
            {order.items.map((i) => (
              <div key={`${i.dishId}-${i.spec ?? ''}`} className="flex items-center gap-2.5">
                <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg">
                  {i.img ? (
                    <FoodImg src={i.img} emoji={i.emoji} className="h-full w-full" />
                  ) : (
                    <span className="grid h-full w-full place-items-center bg-[#F5F6F7] text-[16px]">{i.emoji}</span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-black/75">{stripDealQty(i.name)}</span>
                  {i.spec && <span className="block truncate text-[11px] text-black/40">{stripDealQty(i.spec)}</span>}
                </span>
                <span className="text-[12px] text-black/35">×{i.qty}</span>
                <span className="w-14 text-right text-[13px] text-black/80">¥{fmtMoney(i.price * i.qty)}</span>
              </div>
            ))}
          </div>
          {order.note && <p className="mt-2.5 rounded-lg bg-[#F5F6F7] p-2 text-[11px] text-black/50">备注：{order.note}</p>}
          <div className="mt-3 space-y-1.5 border-t border-black/5 pt-2.5 text-[13px]">
            <p className="flex justify-between text-black/55">
              <span>商品总价{!tuangou && '（共1单）'}</span>
              <span>¥{fmtMoney(order.itemTotal)}</span>
            </p>
            {!tuangou && (
              <p className="flex justify-between text-black/55">
                <span>配送费{order.deliveryFee === 0 && order.itemTotal >= 45 ? <span className="ml-1 text-[#00A661]">（满45已免）</span> : null}</span>
                <span>¥{fmtMoney(order.deliveryFee)}</span>
              </p>
            )}
            {order.paidAt && !tuangou && (
              <p className="flex justify-between text-black/55">
                <span>放心吃（商家赠送）</span>
                <span>¥0</span>
              </p>
            )}
            {voucherCut > 0 && (
              <p className="flex justify-between text-black/55">
                <span>神券省钱包</span>
                <span>-¥{fmtMoney(voucherCut)}</span>
              </p>
            )}
            {couponAmt > 0 && (
              <p className="flex justify-between text-[#FF4B33]">
                <span className="flex items-center gap-1.5">
                  <span className="grid h-4 w-4 place-items-center rounded-[4px] bg-[#F53F3F] text-[9px] font-bold leading-none text-white">¥</span>
                  美团红包
                </span>
                <span>-¥{fmtMoney(couponAmt)}</span>
              </p>
            )}
            <p className="flex items-baseline justify-end gap-2 border-t border-black/5 pt-2.5">
              {order.discount > 0 && <span className="text-[12px] font-medium text-[#FF4B33]">已优惠 ¥{fmtMoney(order.discount)}</span>}
              <span className="text-[13px] text-black/55">合计</span>
              <span className="text-[17px] font-bold text-black/90">¥{fmtMoney(order.total)}</span>
            </p>
          </div>
        </div>

        {/* 遇到问题需要帮助（灰底白卡 + 胶囊 + 待支付地址反馈行） */}
        <div className="mx-3 mb-4 mt-2.5 rounded-xl bg-white px-4 py-4">
          <p className="text-[15px] font-bold text-black/85">遇到问题需要帮助?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {helpPills.map((p) => (
              <button key={p.t} type="button" onClick={p.a} className="whitespace-nowrap rounded-full bg-[#F5F6F7] px-3.5 py-2 text-[12px] text-black/65 active:bg-black/10">
                {p.t}
              </button>
            ))}
          </div>
          {order.status === 'pendingPay' && (
            <button
              type="button"
              onClick={() => onToast('感谢反馈，客服将尽快核实处理（演示）')}
              className="mt-3 flex w-full items-center gap-1.5 border-t border-dashed border-black/10 pt-3 text-left active:opacity-70"
            >
              <TriangleAlert className="h-4 w-4 shrink-0 text-black/45" strokeWidth={1.9} />
              <span className="flex-1 text-[13px] text-black/70">地址有误，我要反馈</span>
              <span className="flex items-center text-[13px] text-black/55">
                去反馈
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </button>
          )}
        </div>
      </div>

      {/* 底部操作（待支付的操作已上移到标题下方） */}
      {order.status !== 'pendingPay' && (
        <div className="shrink-0 border-t border-black/5 bg-white px-4 pb-3 pt-3">
          <div className="flex items-center justify-end gap-2.5">
            {order.status === 'pendingAccept' && (
              <button type="button" onClick={cancel} className="rounded-full border border-black/15 px-6 py-2.5 text-[13px] text-black/60 active:bg-black/5">
                取消订单（退款）
              </button>
            )}
            {['pendingAccept', 'accepted', 'delivering', 'completed'].includes(order.status) && mtCanRefund(order) && (
              <button
                type="button"
                onClick={() => onApplyRefund(order)}
                className="rounded-full border border-[#FF6000] px-6 py-2.5 text-[13px] font-medium text-[#FF6000] active:opacity-75"
              >
                申请退款
              </button>
            )}
            {(order.status === 'completed' || order.status === 'canceled') && (
              <>
                {order.status === 'completed' && order.kind === 'tuangou' && (
                  <button type="button" onClick={() => onOpenCouponCode(order)} className="rounded-full border border-black/15 px-6 py-2.5 text-[13px] text-black/60 active:bg-black/5">
                    券码
                  </button>
                )}
                {order.status === 'completed' &&
                  (order.review ? (
                    <button type="button" onClick={() => onToast('已评价过了，感谢您的反馈')} className="rounded-full border border-black/15 px-6 py-2.5 text-[13px] text-black/60">
                      已评价
                    </button>
                  ) : (
                    <button type="button" onClick={() => onRate(order)} className="rounded-full border border-black/15 px-6 py-2.5 text-[13px] text-black/60 active:bg-black/5">
                      评价
                    </button>
                  ))}
                <button type="button" onClick={reorder} className="rounded-full bg-[#FFD100] px-7 py-2.5 text-[14px] font-semibold text-black/90 active:opacity-85">
                  再来一单
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 订单跟踪底栏（真实状态流水时间线，对齐真机） */}
      <AnimatePresence>
        {trackOpen && (
          <motion.div key="track" className="absolute inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button type="button" aria-label="关闭订单跟踪" className="absolute inset-0 bg-black/45" onClick={() => setTrackOpen(false)} />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-x-0 bottom-0 flex max-h-[76%] flex-col rounded-t-2xl bg-white/80 backdrop-blur-2xl backdrop-saturate-150"
            >
              <div className="relative flex shrink-0 items-center justify-center py-4">
                <p className="text-[16px] font-bold text-black/85">订单跟踪</p>
                <button type="button" aria-label="关闭" onClick={() => setTrackOpen(false)} className="absolute right-3 grid h-8 w-8 place-items-center rounded-full active:bg-black/5">
                  <X className="h-5 w-5 text-black/55" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-1">
                {trackEvents.map((e, i) => {
                  const last = i === trackEvents.length - 1;
                  return (
                    <div key={`${e.text}-${i}`} className="flex gap-3">
                      <div className="flex w-3 shrink-0 flex-col items-center">
                        <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${e.final ? 'bg-[#F53F3F]' : last ? 'bg-[#FFD100]' : 'bg-black/15'}`} />
                        {!last && <span className="w-px flex-1 bg-black/[0.08]" />}
                      </div>
                      <div className={`min-w-0 flex-1 ${last ? '' : 'pb-7'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <p className={`min-w-0 text-[14px] leading-[1.55] ${e.final || last ? 'font-medium text-black/85' : 'text-black/55'}`}>{e.text}</p>
                          <span className={`shrink-0 text-[13px] ${e.final ? 'font-semibold text-black/85' : 'text-black/40'}`}>{fmtTrackTime(e.at)}</span>
                        </div>
                        {e.rider && (
                          <button
                            type="button"
                            onClick={() => onToast('已发起联系（演示）')}
                            className="mt-2 flex items-center gap-1.5 rounded-md border border-black/15 px-3 py-1.5 text-[13px] text-black/75 active:bg-black/5"
                          >
                            <PhoneIcon className="h-3.5 w-3.5" strokeWidth={1.9} />
                            联系骑手
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 待支付 ⋮ 操作面板（取消订单/联系客服） */}
      <AnimatePresence>
        {moreOpen && (
          <motion.div key="more" className="absolute inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/40" onClick={() => setMoreOpen(false)} />
            <motion.div initial={{ y: 140 }} animate={{ y: 0 }} exit={{ y: 160 }} transition={{ type: 'tween', duration: 0.24, ease: [0.32, 0.72, 0, 1] }} className="absolute inset-x-3 bottom-3">
              <div className="overflow-hidden rounded-xl bg-white">
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    cancel();
                  }}
                  className="w-full py-3.5 text-center text-[15px] text-[#F53F3F] active:bg-black/5"
                >
                  取消订单
                </button>
                <div className="h-px bg-black/5" />
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    onToast('美团客服：0539-000-0000（演示）');
                  }}
                  className="w-full py-3.5 text-center text-[15px] text-black/80 active:bg-black/5"
                >
                  联系客服
                </button>
              </div>
              <button type="button" onClick={() => setMoreOpen(false)} className="mt-2 w-full rounded-xl bg-white py-3.5 text-center text-[15px] font-medium text-black/85 active:bg-black/5">
                取消
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 订单分享弹层（动态订单卡片进好友聊天） */}
      <AnimatePresence>
        {shareStep && (
          <ShareSheet
            step={shareStep}
            plat={sharePlat}
            contactId={shareContact}
            sending={shareSending}
            onPickPlat={(v) => {
              setSharePlat(v);
              if (shareStep === 'plat') setShareStep('contact');
            }}
            onPickContact={(id) => setShareContact(id)}
            onBack={() => setShareStep('plat')}
            onClose={() => setShareStep(null)}
            onSend={() => void sendShare()}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** 小按钮（修改 / 打赏骑手） */

// ================================ 退款申请弹层（退款售后） ================================

export const REFUND_REASONS = ['不想要了', '商家超时未接单', '骑手配送太慢', '餐品洒漏/包装破损', '商家告知缺货', '其他原因'];


export function RefundApplySheet({ order, onClose, onToast }: { order: MtOrder; onClose: () => void; onToast: (m: string) => void }) {
  const session = mtGetSession();
  const uid = session ? mtUidOf(session) : '';
  const [reason, setReason] = useState(REFUND_REASONS[0]);
  const [note, setNote] = useState('');

  const submit = () => {
    if (!uid) {
      onToast('登录状态异常，请重试');
      return;
    }
    if (mtApplyRefund(uid, order.id, reason, note)) {
      onToast('退款申请已提交，等待商家审核');
      onClose();
    } else {
      onToast('该订单暂无法申请退款');
    }
  };

  return (
    <motion.div className="absolute inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
      {/* 点击弹窗外任意区域关闭 */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        className="absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[20px] bg-white/80 backdrop-blur-2xl backdrop-saturate-150"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.32 }}
      >
        <div className="relative flex shrink-0 items-center justify-center bg-white px-3 pb-2.5 pt-4">
          <span className="absolute left-1/2 top-[7px] h-1 w-9 -translate-x-1/2 rounded-full bg-black/12" aria-hidden="true" />
          <p className="text-[16px] font-semibold text-black/85">申请退款</p>
          <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-3 grid h-8 w-8 place-items-center rounded-full bg-black/[0.05] active:bg-black/10">
            <X className="h-4 w-4 text-black/60" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="mt-1 flex items-center justify-between bg-[#FFF7F3] px-4 py-3">
            <span className="text-[14px] text-black/70">退款金额</span>
            <span className="text-[20px] font-bold" style={{ color: MT_PRICE }}>
              ¥{order.total.toFixed(2)}
            </span>
          </div>
          <p className="mt-1 px-1 text-[11px] text-black/35">退款将原路退回您的支付账户（{order.payChannelLabel ?? (order.payIdp === 'qq' ? 'QQ钱包' : '微信支付')}）</p>

          <p className="mt-4 text-[14px] font-semibold text-black/80">退款原因</p>
          <div className="mt-1.5 divide-y divide-black/[0.04]">
            {REFUND_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className="flex w-full items-center py-3 text-left active:bg-black/[0.02]">
                <span className={`flex-1 text-[14px] ${reason === r ? 'font-medium text-black/90' : 'text-black/65'}`}>{r}</span>
                <span className={`grid h-[19px] w-[19px] place-items-center rounded-full ${reason === r ? 'bg-[#FFC300]' : 'border border-black/20'}`}>
                  {reason === r && <Check className="h-3 w-3 text-black/80" strokeWidth={3} />}
                </span>
              </button>
            ))}
          </div>

          <p className="mt-3 text-[14px] font-semibold text-black/80">补充说明</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 60))}
            rows={2}
            placeholder="选填，最多60字"
            className="mt-1.5 w-full resize-none rounded-xl bg-[#F5F6F7] p-3 text-[13px] outline-none placeholder:text-black/25"
          />
        </div>

        <div className="shrink-0 border-t border-white/60 bg-white/80 backdrop-blur-2xl backdrop-saturate-150 px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <button type="button" onClick={submit} className="h-12 w-full rounded-full bg-[#FFD100] text-[16px] font-semibold text-black/90 shadow-sm active:opacity-85">
            提交申请
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}


// ================================ 售后详情页（截图1/3：退款成功绿色卡 / 退款失败红色页） ================================

export const REFUND_FAQS = ['查询退款进度', '查询退款退回账户', '我要删除订单', '优惠券是否可退', '能否撤销退款申请', '退款金额不对'];

/** 退款失败页的满意度评分（0-10 分 + 三档表情，对齐截图3） */

export function RefundSatisfaction({ onToast }: { onToast: (m: string) => void }) {
  const [show, setShow] = useState(true);
  const [score, setScore] = useState<number | null>(null);
  if (!show) return null;
  return (
    <div className="border-t-[7px] border-[#F5F6F7] px-4 py-4">
      <div className="flex items-start">
        <p className="flex-1 text-[15px] font-bold text-black/85">您对本次退款体验满意吗?</p>
        <button type="button" aria-label="关闭" onClick={() => setShow(false)} className="grid h-6 w-6 place-items-center rounded-full text-black/30 active:bg-black/5">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between px-1">
        {[
          [Frown, '非常不满意'],
          [Meh, '一般'],
          [Laugh, '非常满意'],
        ].map(([Icon, label], i) => (
          <button key={label as string} type="button" onClick={() => onToast('感谢您的反馈')} className="flex items-center gap-1.5 active:opacity-60">
            <Icon className={`h-5 w-5 ${i === 2 ? 'text-[#FFB800]' : 'text-[#FFC46B]'}`} strokeWidth={1.8} />
            <span className="text-[13px] text-black/60">{label as string}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between px-0.5">
        {Array.from({ length: 11 }).map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              setScore(i);
              onToast(`已提交 ${i} 分评价，感谢反馈`);
            }}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] transition-colors ${
              score === i ? 'bg-[#FF6000] font-semibold text-white' : 'bg-[#F5F6F7] text-black/70 active:bg-black/10'
            }`}
          >
            {i}
          </button>
        ))}
      </div>
    </div>
  );
}


export function RefundDetailPage({
  session,
  orderId,
  onBack,
  onToast,
}: {
  session: MtSession;
  orderId: string;
  onBack: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  useOrdersTick();
  const [open, setOpen] = useState(true);
  const order = mtGetOrder(uid, orderId);

  if (!order || !order.refund) {
    return (
      <div className="flex h-full flex-col bg-[#F5F6F7]">
        <div className="relative grid h-[100px] shrink-0 place-items-center pt-[50px]">
          <button type="button" aria-label="返回" onClick={onBack} className="absolute left-1 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
          </button>
          <p className="text-[19px] font-semibold text-black/90">售后详情</p>
        </div>
        <p className="mt-24 text-center text-[13px] text-black/40">该订单没有进行中的售后</p>
      </div>
    );
  }
  const r = order.refund;
  const done = r.status === 'approved';
  const failed = r.status === 'failed';
  const idpName = order.payIdp === 'qq' ? 'QQ钱包' : '微信';
  // 到账承诺：申请后 3 天内（对齐截图「预计最晚2026年05月14日前到账」）
  const expectDate = (() => {
    const d = new Date(r.appliedAt + 3 * 24 * 3600_000);
    return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`;
  })();

  // 退款流程时间线（新的在上）
  const flow: { title: string; body: string; at: number; danger?: boolean; link?: string }[] = failed
    ? [
        { title: r.failMsg ?? '退款过程中出现异常，退款失败', body: '', at: r.doneAt ?? r.appliedAt, danger: true, link: '查看详情' },
        { title: '退款受理完成', body: '', at: (r.doneAt ?? r.appliedAt + 21_000) - 20_000 },
        { title: '发起退款申请', body: '系统审核通过后将为您退款', at: r.appliedAt },
      ]
    : done
      ? [
          { title: '退款完成', body: `已成功退款至您的${order.payIdp === 'qq' ? 'QQ钱包' : '微信支付'}。如有疑问可拨打${idpName}客服电话95017。`, at: r.doneAt ?? r.appliedAt },
          { title: `${idpName}已受理退款`, body: `您的退款已被${idpName}成功受理`, at: (r.doneAt ?? r.appliedAt + 21_000) - 20_000 },
          { title: '美团审核通过', body: '美团已受理您的退款申请', at: r.appliedAt + 1000 },
          { title: '发起取消订单申请', body: '系统审核通过后将为您退款', at: r.appliedAt },
        ]
      : [
          { title: '商家审核中', body: '商家已收到您的退款申请，审核通过后原路退回', at: r.appliedAt },
          { title: '发起取消订单申请', body: '系统审核通过后将为您退款', at: r.appliedAt },
        ];
  const flowShown = open ? flow : flow.slice(0, 1);

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 顶栏：返回 + 居中标题 + 客服（失败页对齐截图3） */}
      <div className="relative grid h-[100px] shrink-0 place-items-center border-b border-black/[0.04] pt-[50px]">
        <button type="button" aria-label="返回" onClick={onBack} className="absolute left-1 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
        </button>
        <p className="text-[19px] font-semibold text-black/90">{failed ? '退款详情' : '售后详情'}</p>
        {failed && (
          <button type="button" aria-label="客服" onClick={() => onToast('美团客服：0539-000-0000（演示）')} className="absolute right-3 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
            <Headset className="h-[20px] w-[20px] text-black/80" strokeWidth={1.8} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {failed ? (
          /* ===== 退款失败（截图3：红 X + 大金额 + 明细 + 进度 + 您可能想问 + 满意度） ===== */
          <>
            <div className="px-5 py-5">
              <div className="flex items-center gap-3">
                <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-[#F53F3F]">
                  <X className="h-[18px] w-[18px] text-white" strokeWidth={3} />
                </span>
                <p className="min-w-0 flex-1 text-[24px] font-bold leading-tight text-black/90">退款失败</p>
                <p className="shrink-0 text-[26px] font-bold text-[#F53F3F]">¥{r.amount.toFixed(2)}</p>
              </div>
              <div className="mt-1 text-right">
                <button type="button" onClick={() => setOpen((o) => !o)} className="text-[14px] text-black/55 active:opacity-60">
                  明细
                  <ChevronUp className={`ml-0.5 inline h-4 w-4 transition-transform ${open ? '' : 'rotate-180'}`} />
                </button>
              </div>
              {open && (
                <div className="mt-2 space-y-1.5 rounded-xl bg-[#F7F8FA] p-3.5 text-[13px]">
                  <p className="flex justify-between text-black/60">
                    <span>订单金额</span>
                    <span className="text-black/80">¥{order.total.toFixed(2)}</span>
                  </p>
                  <p className="flex justify-between text-black/60">
                    <span>退回渠道</span>
                    <span className="text-black/80">{r.channel ?? (order.payIdp === 'qq' ? 'QQ钱包' : '微信支付')}</span>
                  </p>
                  <p className="flex justify-between text-[#F53F3F]">
                    <span>退款失败金额</span>
                    <span>¥{r.amount.toFixed(2)}</span>
                  </p>
                </div>
              )}
            </div>

            {/* 退款进度 */}
            <div className="border-t-[7px] border-[#F5F6F7] px-4 py-4">
              <p className="text-[17px] font-bold text-black/85">退款进度</p>
              <div className="mt-3">
                {flow.map((f, i) => (
                  <div key={`${f.title}-${f.at}`} className="relative flex gap-3 pb-5 last:pb-0">
                    <span className="relative flex w-3 shrink-0 justify-center">
                      {i === 0 ? (
                        <span className="z-10 mt-1 h-[11px] w-[11px] rounded-full bg-[#F53F3F]" />
                      ) : (
                        <span className="z-10 mt-[7px] h-[7px] w-[7px] rounded-full bg-black/15" />
                      )}
                      {i < flow.length - 1 && <span className="absolute top-3 bottom-0 w-px bg-black/10" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`flex items-center gap-1.5 text-[15px] font-semibold ${i === 0 ? 'text-black/90' : 'text-black/45'}`}>
                        {f.title}
                        {i === 0 ? (
                          <button type="button" onClick={() => onToast('异常原因：收款账户状态异常，资金将退回美团余额')} className="text-[13px] font-normal text-[#4E6EF2] active:opacity-60">
                            {f.link}
                          </button>
                        ) : null}
                      </span>
                      {f.body && <span className="mt-1 block text-[13px] text-black/45">{f.body}</span>}
                      <span className="mt-1 block text-[12px] text-black/30">{fmtDateTime(f.at)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 您可能想问 */}
            <div className="border-t-[7px] border-[#F5F6F7] px-4 py-4">
              <div className="flex items-center">
                <p className="flex-1 text-[17px] font-bold text-black/85">您可能想问</p>
                <button type="button" onClick={() => onToast('更多问题请拨打客服电话（演示）')} className="text-[13px] text-black/45 active:opacity-60">
                  更多问题
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2.5">
                {REFUND_FAQS.map((q) => (
                  <button key={q} type="button" onClick={() => onToast(`「${q}」演示入口`)} className="rounded-full bg-[#F5F6F7] px-4 py-2 text-[13px] text-black/70 active:bg-black/10">
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <RefundSatisfaction onToast={onToast} />
          </>
        ) : (
          /* ===== 退款成功 / 处理中（截图1：绿色渐变状态卡 + 时间线 + 退款信息） ===== */
          <>
            {/* 状态卡（绿色渐变 + 右上大对勾水印） */}
              <div className="relative overflow-hidden bg-gradient-to-br from-[#F3FBF3] via-[#EAF7EC] to-[#DDF2E1] p-5">
                <span className="pointer-events-none absolute -right-4 -top-6 text-[150px] leading-none text-[#C8E9CF]/70" aria-hidden="true">
                  ✓
                </span>
                <p className="relative text-[24px] font-bold leading-tight text-black/90">{done ? '退款成功' : '退款处理中'}</p>
                <p className="relative mt-1.5 text-[13px] text-black/45">预计最晚{expectDate}前到账</p>
                <div className="relative mt-4 bg-white/70 p-4">
                <p className="flex items-baseline justify-between">
                  <span className="text-[14px] text-black/60">退款金额</span>
                  <span className="text-[19px] font-bold text-black/90">¥{fmtMoney(r.amount)}</span>
                </p>
                <p className="mt-0.5 text-[12px] text-black/35">申请通过后退回至原账户</p>
                <p className="mt-4 flex items-baseline justify-between">
                  <span className="text-[14px] text-black/60">退回红包</span>
                  <span className="text-[15px] font-bold text-black/90">1张红包</span>
                </p>
                <p className="mt-0.5 text-[12px] text-black/35">
                  已退回至美团红包{' '}
                  <button type="button" onClick={() => onToast('红包已退回，可在「我的-红包卡券」查看')} className="font-medium text-[#FF6000]">
                    查看
                  </button>
                </p>
              </div>
            </div>

            {/* 退款流程 */}
            <div className="flex items-center justify-between px-4 pt-5">
              <p className="text-[17px] font-bold text-black/85">退款流程</p>
              <button type="button" onClick={() => onToast('已通知商家，将尽快处理您的售后')} className="flex items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[12px] text-black/70 active:opacity-70">
                <span className="relative">
                  <Bike className="h-3.5 w-3.5 text-black/60" />
                  <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[#FF3B30]" />
                </span>
                联系商家
              </button>
            </div>
            <div className="mx-4 mt-2 border-t border-black/[0.05] pt-4">
              {flowShown.map((f, i) => {
                const first = i === 0;
                return (
                  <div key={`${f.title}-${f.at}`} className="relative flex gap-3 pb-5 last:pb-0">
                    {/* 节点 + 连线 */}
                    <span className="relative flex w-3 shrink-0 justify-center">
                      {first ? (
                        <span className="z-10 mt-1 h-[11px] w-[11px] rounded-full border-[3px] border-[#FFC300] bg-white" />
                      ) : (
                        <span className="z-10 mt-[7px] h-[7px] w-[7px] rounded-full bg-black/15" />
                      )}
                      {i < flowShown.length - 1 && <span className="absolute top-3 bottom-0 w-px bg-black/10" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[15px] font-semibold ${first ? 'text-black/90' : 'text-black/45'}`}>{f.title}</span>
                      <span className={`mt-1 block text-[13px] leading-relaxed ${first ? 'text-black/75' : 'text-black/40'}`}>{f.body}</span>
                      <span className="mt-1 block text-[12px] text-black/30">{fmtDateTime(f.at)}</span>
                    </span>
                  </div>
                );
              })}
              <button type="button" onClick={() => setOpen((o) => !o)} className="mx-auto mt-1 flex items-center gap-0.5 text-[12px] text-black/35 active:opacity-60">
                点击{open ? '收起' : '展开'}
                <ChevronUp className={`h-3.5 w-3.5 transition-transform ${open ? '' : 'rotate-180'}`} />
              </button>
            </div>

            {/* 退款信息 */}
            <p className="border-t-[7px] border-[#F5F6F7] px-4 pt-5 text-[17px] font-bold text-black/85">退款信息</p>
            <div className="mx-4 mt-3 pb-2">
              <div className="flex gap-3">
                <FoodImg src={order.items[0]?.img} emoji={order.items[0]?.emoji ?? order.merchantEmoji} className="h-14 w-14 shrink-0 rounded-lg" />
                <p className="line-clamp-2 min-w-0 flex-1 text-[14px] leading-snug text-black/85">{order.items[0] ? stripDealQty(order.items[0].name) : order.merchantName}</p>
                <p className="shrink-0 text-[14px] font-bold text-black/90">¥{fmtMoney(r.amount)}</p>
              </div>
              <p className="mt-1.5 truncate text-[11px] text-black/35">
                {order.merchantName} · {order.items.map((i) => `${stripDealQty(i.name)}×${i.qty}`).join('，')} × 1
              </p>
              <div className="mt-3 border-t border-black/[0.05] pt-1">
                <p className="flex items-center justify-between py-[7px]">
                  <span className="text-[13px] text-black/35">退款原因</span>
                  <span className="min-w-0 truncate pl-3 text-[13px] text-black/80">{r.reason}</span>
                </p>
                {r.note && (
                  <p className="flex items-center justify-between py-[7px]">
                    <span className="text-[13px] text-black/35">补充说明</span>
                    <span className="min-w-0 truncate pl-3 text-[13px] text-black/80">{r.note}</span>
                  </p>
                )}
                <p className="flex items-center justify-between py-[7px]">
                  <span className="text-[13px] text-black/35">订单号码</span>
                  <span className="min-w-0 truncate pl-3 text-[13px] text-black/80">{order.id}</span>
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 设置图标（齿轮） */


// ================================ 评价晒单弹层（订单列表/详情「评价」进入） ================================

export const RATE_TAGS = ['味道赞', '配送快', '包装好', '分量足', '态度好', '回头客'];


export function RateSheet({ order, onClose, onToast }: { order: MtOrder; onClose: () => void; onToast: (m: string) => void }) {
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [imgs, setImgs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (busy) return;
    setBusy(true);
    const list = mtLoadOrders(order.uid).map((o) =>
      o.id === order.id
        ? {
            ...o,
            review: { rating, content: content.trim(), tags, imgs, at: Date.now() },
          }
        : o
    );
    mtSaveOrders(order.uid, list);
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    onToast('评价成功，成长值+20');
    onClose();
  };

  return (
    <div className="absolute inset-0 z-40 flex items-end bg-black/45" onClick={onClose}>
      <div className="max-h-[86%] w-full overflow-y-auto rounded-t-2xl bg-white/80 backdrop-blur-2xl backdrop-saturate-150 p-4 pb-[max(16px,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[16px] font-bold text-black/90">评价订单</p>
          <button type="button" aria-label="关闭" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-full bg-black/[0.05]">
            <X className="h-4 w-4 text-black/50" />
          </button>
        </div>
        <p className="mt-1 truncate text-[12px] text-black/45">
          {order.merchantName} · {order.items[0] ? stripDealQty(order.items[0].name) : ''}
        </p>

        {/* 星级 */}
        <div className="mt-4 flex items-center justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-label={`${n}星`} onClick={() => setRating(n)} className="active:scale-90">
              <Star className={`h-9 w-9 ${n <= rating ? 'fill-[#FF6000] text-[#FF6000]' : 'text-black/15'}`} strokeWidth={1.5} />
            </button>
          ))}
        </div>
        <p className="mt-1 text-center text-[12px] font-medium text-[#FF6000]">{['', '很差', '较差', '一般', '满意', '超赞'][rating]}</p>

        {/* 标签 */}
        <div className="mt-4 flex flex-wrap gap-2">
          {RATE_TAGS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))}
              className={`rounded-full px-3 py-1.5 text-[12px] ${tags.includes(t) ? 'bg-[#FFF3B8] font-medium text-[#B77900]' : 'bg-[#F5F6F7] text-black/55'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* 文字 */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, 140))}
          placeholder="说说这家店的口味、包装、配送体验吧（选填）"
          className="mt-3 h-24 w-full resize-none rounded-xl bg-[#F7F8FA] p-3 text-[13px] outline-none placeholder:text-black/25"
        />
        <p className="text-right text-[11px] text-black/30">{content.length}/140</p>

        {/* 晒图（演示图取内容匹配图链，最多 3 张） */}
        <div className="mt-1 flex flex-wrap gap-2">
          {imgs.map((im, i) => (
            <span key={i} className="relative">
              <FoodImg src={im} className="h-16 w-16 rounded-lg" />
              <button
                type="button"
                aria-label="删除图片"
                onClick={() => setImgs((prev) => prev.filter((_, ii) => ii !== i))}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {imgs.length < 3 && (
            <button
              type="button"
              onClick={() => setImgs((prev) => [...prev, mtImg('food', 480, 360, Date.now() % 20 + prev.length, 'f')])}
              className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-black/20 text-black/35 active:bg-black/5"
              aria-label="添加图片"
            >
              <Plus className="h-5 w-5" />
            </button>
          )}
        </div>
        <p className="mt-1 text-[10px] text-black/30">晒图将从图库自动挑选演示图（演示环境无相机）</p>

        <button type="button" onClick={submit} className="mt-3 h-12 w-full rounded-full bg-gradient-to-r from-[#FFC300] to-[#FF9500] text-[16px] font-semibold text-black/90 active:opacity-85">
          发布评价
        </button>
      </div>
    </div>
  );
}
