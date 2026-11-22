'use client';

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
import { LocalToast, useLocalToast } from './page-toast';
import { FoodImg } from './mt-food-img';
import { MtOrderCreatePage } from './mt-order-create';
import { MtProductManagePage } from './mt-product-manage';
import { OrderImgGenSheet, type ImgGenModelOption } from './order-img-gen';
import { generateFreePhoto } from '@/lib/imggen';
import { libPromptTextMulti } from '@/lib/prompt-entries';
import type { ImgGenConfig } from '@/lib/ios/store';
import MerchantCenterPage from './mt-merchant-center';
import MerchantEditPage from './mt-merchant-edit';
import ShopManagePage from './mt-shop-manage';
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
import TravelChannelPage from './meituan-travel';
import ShangouChannelPage from './meituan-shangou';
import { useSettings, useUI } from '@/lib/ios/store';
import { GoodsStyleSheet, GoodsStyleThumb } from './goods-style-sheet';
import { DeliverySpeedSheet } from './delivery-speed-sheet';
import { dsDescShort } from '@/lib/ios/delivery-speed';
import { mtNotifyShopOrderPaid } from '@/lib/ios/mt-shop-notify';
import { ScanOverlayWhen, openScan } from './mt-scan';
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
import { TbPullIndicator, useTbPullRefresh } from './tb-pull-refresh';
import { WxPayPwdGate, wxLoadPayPwd } from './wechat-wallet';
import { PayPwdGate as QqPayPwdGate, loadPayPwd as qqLoadPayPwd } from './qq';
import { mtCreateProxyRequest, mtGetProxy, mtSyncProxiesForUid } from '@/lib/ios/mt-proxy-pay';
import { mtCreateOrderShare } from '@/lib/ios/mt-order-share';
import { MT_RIDERS, mtGetRiderId, mtRiderSrcOf, mtSetRiderId } from '@/lib/ios/mt-rider';
import { listContacts, loginQQ, loginWechat } from '@/lib/ios/contacts-store';
import { avatarFor, displayNameOf, isFriendIn, type ContactRecord } from '@/lib/contacts';
import { MtProxyDetailPage } from './mt-proxy-detail';

import { Page, Tab, MT_YELLOW, MT_PRICE, MT_PINK, MT_ORANGE, mtCountUnit, fmtMoney, fmtTime, fmtDateTime, fmtDate, fmtDateTimeSec, maskPhone, MT_KEEPER_SURNAMES, mtMerchantContact, fmtTrackTime, mtStatusText, Stepper, useOrdersTick, EMPTY_FAVS, useFavs, TuanMark, DealCard, DealListCard, ShopAvatar, MerchantCard, FeedItem, feedName, interleave, shuffle, homeFeedCache, MT_HOME_FEED_KEY, MT_HOME_SCROLL_KEY, mtRestoreHomeFeed, mtPersistHomeFeed, mtPersistHomeScroll, localBatch, SmallPill, CopyBtn, InfoRow, stripDealQty, MtShareGlyph, ShareSheet, SettingsIcon, mtCatNameOf } from './meituan/shared';
import { MT_BANK_NAMES, MT_BANK_META, MT_SHEET_CSS, MT_BALANCE_FAQS, MT_LOAN_GUARDS, mtW2, mtAmtComma, mtAmtWan, mtBankMeta, mtGenCardNo, mtFmtCardNo, mtBillGroupLabel, mtBillItemTime, mtBillIcon, MtWalletSheet, MtWalletCardPicker, MtPayPwdSheet, MtPayPwdGate, WalletPage, WalletBalancePage, WalletCardsPage, WalletBillsPage, WalletLoanPage, LoanBorrowSheet, LoanRepaySheet, WalletCardQuotaPage, WalletDrugFundPage, InvoicePage, InvoiceSheet, WalletPayPwdPage } from './meituan/wallet';
import { FunKind, useFunChannel, ChannelSkeleton, RatingBadge, submitFunOrder, funDates, HOTEL_TABS, HotelChannelPage, HotelCard, RoomSheet, HotelConfirmSheet, FUN_CATS, FunChannelPage, FunDealConfirmSheet, POSTER_GRADS, PosterArt, MovieCard, MoviesChannelPage, MovieDetailPage, MovieConfirmSheet } from './meituan/fun';
import { ORDER_TABS, OrderFilterKey, ORDER_FILTERS, OrdersPage, MT_ROAD_POOL, MT_ROUTE_P0, MT_ROUTE_PC, MT_ROUTE_P1, DeliveryMap, OrderDetailPage, REFUND_REASONS, RefundApplySheet, REFUND_FAQS, RefundSatisfaction, RefundDetailPage, RATE_TAGS, RateSheet } from './meituan/orders';
import { DealDetailPage, MtCustomProductPage, MT_CHOICE_RE, DealConfirmSheet, CouponPickerSheet, DishSpecSheet, CouponCat, COUPON_CATS, CouponsPage, qrGridOf, CouponCodePage } from './meituan/deals';
import { AddressesPage, AddAddressPage, AddrHits, MyPage, SettingsRow, SettingsPage, FavTab, FAV_TABS, FavEmptyIllust, FavoritesPage, HistTab, WEEK_HEADS, HistoryPage, MessagesPage, mtTimeShort, MEMBER_LEVELS, MemberPage } from './meituan/me';


// ================================ 登录页（截图1） ================================

function LoginPage({ onLogin, onToast }: { onLogin: (s: MtSession) => void; onToast: (m: string) => void }) {
  const closeApp = useUI((s) => s.closeApp);
  const [agree, setAgree] = useState(true);
  const [auth, setAuth] = useState<{ idp: 'wx' | 'qq'; contactId: string; name: string; avatar: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  // 账号密码登录：先选登录方式（微信/QQ）→ 输入对应账号 + 密码
  const [idp, setIdp] = useState<'wx' | 'qq' | null>(null);
  const [account, setAccount] = useState('');
  const [pwd, setPwd] = useState('');
  const [pwdErr, setPwdErr] = useState('');

  /** 底部一键登录（授权卡流程，与微信/QQ App 登录态联动） */
  const tapIdp = async (v: 'wx' | 'qq') => {
    if (busy) return;
    if (!agree) {
      onToast('请先阅读并同意《美团用户协议》和《隐私政策》');
      return;
    }
    // 登录态联动（需求：微信/QQ 没有登录时美团就登录不了）：对应授权源未在线 → 拦截并引导
    if (!mtIdpLoggedIn(v)) {
      onToast(v === 'wx' ? '微信尚未登录，请先登录微信后再试' : 'QQ尚未登录，请先登录QQ后再试');
      return;
    }
    setBusy(true);
    try {
      const id = await mtResolveIdpIdentity(v);
      setAuth({ idp: v, contactId: id.contactId, name: id.name, avatar: id.avatar });
    } finally {
      setBusy(false);
    }
  };

  const confirmAuth = async () => {
    if (!auth) return;
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 700));
      onLogin({ idp: auth.idp, contactId: auth.contactId, name: auth.name, avatar: auth.avatar, via: 'oneclick', loginAt: Date.now() });
    } finally {
      setBusy(false);
    }
  };

  /** 选择登录方式（再次点击可取消选择），切换时清空输入与错误提示 */
  const pickIdp = (v: 'wx' | 'qq') => {
    if (busy) return;
    setPwdErr('');
    setIdp((cur) => (cur === v ? null : v));
    setAccount('');
    setPwd('');
  };

  /** 账号密码登录：校验对应微信/QQ 的真实账号密码（与微信/QQ App 同源校验）。
   *  需求：仅一键登录才要求微信/QQ App 在线；账密登录独立，凭账号密码即可登录（无需打开对应 App） */
  const pwdLogin = async () => {
    if (busy || !idp) return;
    if (!agree) {
      onToast('请先阅读并同意《美团用户协议》和《隐私政策》');
      return;
    }
    const acc = account.trim();
    if (!acc) {
      onToast(idp === 'wx' ? '请输入微信号/QQ号/手机号' : '请输入QQ号');
      return;
    }
    if (!pwd) {
      onToast('请输入密码');
      return;
    }
    setBusy(true);
    setPwdErr('');
    try {
      const res = idp === 'wx' ? await loginWechat('wechat', acc, pwd) : await loginQQ('account', acc, pwd);
      if (!res.ok) {
        setPwdErr(res.error);
        return;
      }
      // 账密会话独立于微信/QQ App 登录态（via: 'password'），不校验与当前在线账号的一致性
      onLogin({ idp, contactId: res.user.id, name: res.user.name, avatar: res.user.avatar, via: 'password', loginAt: Date.now() });
    } finally {
      setBusy(false);
    }
  };

  const idpName = idp === 'wx' ? '微信' : 'QQ';
  const idpBrand = idp === 'wx' ? '#07C160' : '#12B7F5';
  const pwdReady = account.trim().length > 0 && pwd.length > 0;

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-white">
      {/* 顶栏：关闭 / 语言 / 帮助 */}
      <div className="flex items-center gap-2 px-4 pt-[58px]">
        <button
          type="button"
          aria-label="关闭"
          onClick={closeApp}
          className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.06] active:bg-black/10"
        >
          <X className="h-5 w-5 text-black/80" strokeWidth={2.4} />
        </button>
        <span className="flex-1" />
        <button type="button" onClick={() => onToast('多语言（演示）')} className="flex items-center gap-1.5 px-1 text-[15px] text-black/85 active:opacity-60">
          <Languages className="h-[18px] w-[18px]" />
          Language
          <ChevronRight className="h-3.5 w-3.5 rotate-90 text-black/50" />
        </button>
        <span className="h-4 w-px bg-black/15" />
        <button type="button" onClick={() => onToast('美团客服：0539-000-0000（演示）')} className="px-1 text-[15px] text-black/85 active:opacity-60">
          帮助
        </button>
      </div>

      <p className="mt-10 px-6 text-[30px] font-bold tracking-wide text-black/90">欢迎登录美团</p>
      <p className="mt-2 px-6 text-[13px] text-black/40">请选择登录方式，使用账号和密码登录</p>

      {/* 选择登录方式：微信 / QQ 两张可选卡 */}
      <div className="mt-7 grid grid-cols-2 gap-3 px-6">
        {(
          [
            ['wx', '/icons/wechat.png', '微信登录', '#07C160'],
            ['qq', '/icons/qq.png', 'QQ登录', '#12B7F5'],
          ] as ['wx' | 'qq', string, string, string][]
        ).map(([v, img, label, brand]) => {
          const on = idp === v;
          return (
            <button
              key={v}
              type="button"
              data-testid={`login-pick-${v}`}
              onClick={() => pickIdp(v)}
              className={`relative flex items-center gap-2.5 rounded-2xl border-2 bg-white px-4 py-3.5 text-left transition-colors active:opacity-80 ${on ? 'shadow-[0_4px_14px_rgba(0,0,0,0.06)]' : 'border-black/[0.08]'}`}
              style={on ? { borderColor: brand } : undefined}
            >
              <img src={img} alt="" className="h-10 w-10 shrink-0 rounded-xl" />
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold text-black/85">{label}</span>
                <span className="block text-[10.5px] text-black/35">{on ? '账号密码登录' : '点击选择'}</span>
              </span>
              {on && (
                <span className="absolute -right-1.5 -top-1.5 grid h-[20px] w-[20px] place-items-center rounded-full text-white" style={{ background: brand }}>
                  <Check className="h-3 w-3" strokeWidth={3.2} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 账号密码输入区（选择登录方式后出现） */}
      {idp && (
        <div className="mt-5 space-y-3.5 px-6" data-testid="login-pwd-form">
          <div className="flex h-[52px] items-center gap-2 rounded-full bg-[#F5F6F7] px-5">
            <span className="w-[64px] shrink-0 text-[15px] text-black/45">账号</span>
            <input
              value={account}
              onChange={(e) => {
                setAccount(e.target.value);
                setPwdErr('');
              }}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder={idp === 'wx' ? '微信号 / QQ号 / 手机号' : 'QQ号'}
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30"
            />
            <img src={idp === 'wx' ? '/icons/wechat.png' : '/icons/qq.png'} alt="" className="h-5 w-5 shrink-0 rounded" />
          </div>
          <div className="flex h-[52px] items-center gap-2 rounded-full bg-[#F5F6F7] px-5">
            <span className="w-[64px] shrink-0 text-[15px] text-black/45">密码</span>
            <input
              value={pwd}
              onChange={(e) => {
                setPwd(e.target.value);
                setPwdErr('');
              }}
              type="password"
              placeholder={`请输入${idpName}密码`}
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30"
            />
            <EyeOff className="h-5 w-5 shrink-0 text-black/50" />
          </div>
          {pwdErr && <p className="px-2 text-[12px] text-[#FF4B33]" data-testid="login-pwd-err">{pwdErr}</p>}
          <div className="flex items-center justify-between px-2">
            <div>
              <p className="text-[12px] text-black/35">无需登录{idpName}App，凭账号密码即可登录</p>
              <p className="mt-0.5 text-[12px] text-black/35">密码与{idpName}App登录密码一致</p>
            </div>
            <button type="button" onClick={() => onToast('密码找回：请到「联系人」App 查看账号密码')} className="shrink-0 text-[12px] text-black/45 active:opacity-60">
              忘记密码？
            </button>
          </div>
        </div>
      )}

      {/* 协议 */}
      <button type="button" onClick={() => setAgree((a) => !a)} className="mt-5 flex items-center gap-2 px-6 text-left">
        <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full ${agree ? 'bg-[#FFC300]' : 'border border-black/25'}`}>
          {agree && <Check className="h-3 w-3 text-black/85" strokeWidth={3.2} />}
        </span>
        <span className="text-[13px] text-black/60">
          我已阅读并同意<span className="text-[#2A7BF6]">《美团用户协议》</span>和<span className="text-[#2A7BF6]">《隐私政策》</span>
        </span>
      </button>

      {/* 登录按钮（未选方式/未就绪淡黄 → 就绪美团黄） */}
      <div className="mt-5 px-6">
        <button
          type="button"
          data-testid="login-pwd-submit"
          onClick={() => void pwdLogin()}
          disabled={!idp || busy}
          className={`h-[52px] w-full rounded-full text-[17px] font-medium active:opacity-85 ${idp && pwdReady ? 'bg-[#FFD100] text-black/90 shadow-[0_4px_14px_rgba(255,209,0,0.3)]' : 'bg-[#F6EC9F] text-black/45'} disabled:opacity-70`}
        >
          {busy ? '登录中…' : idp ? `${idpName}账号登录` : '请先选择登录方式'}
        </button>
      </div>

      {/* 底部三方一键登录 */}
      <div className="mt-auto pb-[max(30px,env(safe-area-inset-bottom))] pt-9">
        <div className="mb-4 flex items-center gap-3 px-10">
          <span className="h-px flex-1 bg-black/[0.08]" />
          <span className="text-[11px] text-black/35">一键登录（免输入）</span>
          <span className="h-px flex-1 bg-black/[0.08]" />
        </div>
        <div className="flex items-center justify-center gap-10">
          <button type="button" aria-label="微信一键登录" data-testid="login-onetap-wx" onClick={() => void tapIdp('wx')} disabled={busy} className="flex flex-col items-center gap-1.5 active:opacity-70">
            <span className="grid h-[52px] w-[52px] place-items-center overflow-hidden rounded-full bg-[#07C160] shadow-sm">
              <img src="/icons/wechat.png" alt="" className="h-full w-full rounded-full object-cover" />
            </span>
            <span className="text-[10px] text-black/40">微信一键登录</span>
          </button>
          <button type="button" onClick={() => onToast('数字身份登录暂未开通，试试微信/QQ')} className="flex flex-col items-center gap-1.5 active:opacity-70">
            <span className="grid h-[52px] w-[52px] place-items-center rounded-full bg-[#F0412E] text-center text-[11px] font-semibold leading-[1.15] text-white shadow-sm">
              数字
              <br />
              身份
            </span>
            <span className="text-[10px] text-black/40">数字身份</span>
          </button>
          <button type="button" aria-label="QQ一键登录" data-testid="login-onetap-qq" onClick={() => void tapIdp('qq')} disabled={busy} className="flex flex-col items-center gap-1.5 active:opacity-70">
            <span className="grid h-[52px] w-[52px] place-items-center overflow-hidden rounded-full bg-[#12B7F5] shadow-sm">
              <img src="/icons/qq.png" alt="" className="h-full w-full rounded-full object-cover" />
            </span>
            <span className="text-[10px] text-black/40">QQ一键登录</span>
          </button>
        </div>
      </div>

      {auth && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 px-8" onClick={() => !busy && setAuth(null)}>
          <div className="w-full rounded-2xl bg-white/85 backdrop-blur-2xl backdrop-saturate-150 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5">
              <img src={auth.idp === 'wx' ? '/icons/wechat.png' : '/icons/qq.png'} alt="" className="h-9 w-9 rounded-lg" />
              <img src="/icons/meituan-app.png" alt="" className="h-6 w-6 rounded-md" />
              <p className="text-[15px] font-semibold text-black/80">{auth.idp === 'wx' ? '微信' : 'QQ'}授权登录</p>
            </div>
            <p className="mt-3 text-[13px] text-black/55">美团申请获取以下信息：</p>
            <div className="mt-2 space-y-1.5 rounded-xl bg-[#F5F6F7] p-3 text-[13px] text-black/70">
              <p>· 你的昵称、头像</p>
              <p>· 你的{auth.idp === 'wx' ? '微信' : 'QQ'}OpenID（用于识别账号）</p>
            </div>
            <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-black/5 p-2.5">
              {auth.avatar ? (
                <img src={auth.avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#FFD100] text-[16px] font-bold text-black/70">{auth.name.slice(0, 1)}</span>
              )}
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-black/80">{auth.name}</p>
                <p className="text-[11px] text-black/40">{auth.idp === 'wx' ? '当前登录的微信账号' : '当前登录的QQ账号'}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void confirmAuth()}
              disabled={busy}
              className={`mt-4 h-11 w-full rounded-full text-[15px] font-medium text-white active:opacity-85 disabled:opacity-60 ${auth.idp === 'wx' ? 'bg-[#07C160]' : 'bg-[#12B7F5]'}`}
            >
              {busy ? '登录中…' : '同意授权'}
            </button>
            <button type="button" onClick={() => setAuth(null)} className="mt-2 h-9 w-full text-[13px] text-black/40">
              拒绝
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ================================ 底部导航（首页/购物车/我的） ================================

/** 底部 Tab：第四十二轮改「毛玻璃胶囊」悬浮条（bg-white/80 + backdrop-blur-2xl + 白高光描边圆角胶囊）；
 *  首页=房子、购物车=推车、我的=笑脸+金皇冠；选中态黄底 pill + 变黄（「我的」选中变黑：黑底黄脸） */

export function BottomTabBar({ active, onTab }: { active: Tab; onTab: (t: Tab) => void }) {
  const labelCls = (on: boolean, activeCls: string) => `text-[10px] leading-none ${on ? `font-semibold ${activeCls}` : 'font-medium text-black/75'}`;
  const homeOn = active === 'home';
  const cartOn = active === 'cart';
  const myOn = active === 'my';
  return (
    <div className="relative z-20 shrink-0 px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
      <div className="flex items-center rounded-[26px] border border-white/60 bg-white/80 py-[7px] shadow-[0_10px_36px_rgba(0,0,0,0.16)] backdrop-blur-2xl backdrop-saturate-150">
        {/* 首页：房子（选中=黄色 pill）；未选中用 text-black/90 类而非内联色——深色模式下随 shop-dark 翻白
            （第六十八轮修复：内联 rgba(0,0,0,0.9) 无法被覆盖，深色下黑图标画在深底上不可见） */}
        <button type="button" onClick={() => onTab('home')} className={`flex flex-1 flex-col items-center gap-[4px] rounded-full py-[3px] active:opacity-70 ${homeOn ? 'bg-[#FFC300]/25' : ''}`}>
          <House className={`h-[24px] w-[24px] ${homeOn ? 'text-[#FFC300]' : 'text-black/90'}`} strokeWidth={homeOn ? 2.4 : 1.8} />
          <span className={labelCls(homeOn, 'text-[#FFA200]')}>首页</span>
        </button>
        {/* 购物车（选中=黄色 pill） */}
        <button type="button" onClick={() => onTab('cart')} className={`flex flex-1 flex-col items-center gap-[4px] rounded-full py-[3px] active:opacity-70 ${cartOn ? 'bg-[#FFC300]/25' : ''}`}>
          <ShoppingCart className={`h-[24px] w-[24px] ${cartOn ? 'text-[#FFC300]' : 'text-black/90'}`} strokeWidth={cartOn ? 2.4 : 1.8} />
          <span className={labelCls(cartOn, 'text-[#FFA200]')}>购物车</span>
        </button>
        {/* 我的：笑脸 + 金皇冠（选中=黑色 pill：黑底黄脸） */}
        <button type="button" onClick={() => onTab('my')} className={`flex flex-1 flex-col items-center gap-[4px] rounded-full py-[3px] active:opacity-70 ${myOn ? 'bg-black/[0.06]' : ''}`}>
          <span className="relative">
            <span className={`grid h-[24px] w-[24px] place-items-center rounded-full ${myOn ? 'bg-gradient-to-b from-[#2E2E2E] to-[#0A0A0A]' : 'bg-gradient-to-b from-[#FFE14D] to-[#FFC300]'}`}>
              <svg viewBox="0 0 24 24" className="h-[24px] w-[24px]" aria-hidden="true">
                <circle cx="8.8" cy="10" r="1.5" fill={myOn ? '#FFD100' : '#3A2B00'} />
                <circle cx="15.2" cy="10" r="1.5" fill={myOn ? '#FFD100' : '#3A2B00'} />
                <path d="M7.8 13.8c1.3 1.8 2.7 2.7 4.2 2.7s2.9-.9 4.2-2.7" stroke={myOn ? '#FFD100' : '#3A2B00'} strokeWidth="1.7" strokeLinecap="round" fill="none" />
              </svg>
            </span>
            <Crown className="absolute -right-[7px] -top-[6px] h-[13px] w-[13px] text-[#E8A200]" fill="#FFC93A" strokeWidth={1.4} />
          </span>
          <span className={labelCls(myOn, 'text-black/95')}>我的</span>
        </button>
      </div>
    </div>
  );
}

// ================================ 首页（截图2） ================================

/** 团购卡（瀑布流） */

export const GRID_ICONS: Record<string, LucideIcon> = {
  Bike,
  Ticket,
  Building,
  Zap,
  Cross,
  Utensils,
  Gamepad2,
  Footprints,
  Rabbit,
  Clapperboard,
  Scissors,
  Plane,
  Stethoscope,
  BookOpen,
  LayoutGrid,
  PackagePlus,
  PackageSearch,
};

/** 菜品图（共享实现见 ./mt-food-img：内容匹配图全链有图 + 一次重试 + 加载期 shimmer） */

/** 数量步进器（对齐真机：灰色 − / 描边数量框 / 灰色 +） */


// ================================ 首页（第三十七轮：自建商品混入瀑布流置顶，不再单独分区） ================================

function HomePage({
  session,
  onOpenMerchant,
  onOpenDeal,
  onOpenSearch,
  onOpenChannel,
  onOpenMessages,
  onOpenCreateOrder,
  onOpenManage,
  onOpenCustomProduct,
  onScan,
  onToast,
}: {
  session: MtSession;
  onOpenMerchant: (id: string) => void;
  onOpenDeal: (id: string) => void;
  onOpenChannel: (c: 'hotel' | 'fun' | 'movies' | 'shangou' | 'travel') => void;
  onOpenMessages: () => void;
  onOpenSearch: (kw?: string) => void;
  /** 宫格「创建商品」入口（自建订单入库） */
  onOpenCreateOrder: () => void;
  /** 宫格「管理商品」入口（第三十八轮：编辑/删除自建商品） */
  onOpenManage: () => void;
  /** 第三十九轮：点首页自建商品卡 → 自建商品详情页（不再进店铺页） */
  onOpenCustomProduct: (mid: string) => void;
  onScan: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const addrs = useMemo(() => mtLoadAddresses(uid), [uid]);
  const cur = addrs.find((a) => a.id === mtCurAddrId(uid)) ?? addrs[0];
  // 首帧初始化：内存缓存为空时先从 kv 恢复上次信息流（Task 46：点开不刷新，缓存上次刷新的）——
  // 必须在 feed/listData/generating 初始化前执行，lazy initializer 保证顺序
  const [filter, setFilter] = useState<string | null>(() => {
    mtRestoreHomeFeed();
    return homeFeedCache.filter;
  }); // null=推荐流 / 'tuangou' / 商家分类id
  const [hintIdx, setHintIdx] = useState(0);
  const [gridPage, setGridPage] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  // AI 信息流：进入页面 / 下拉刷新 / 切换分类 → 重新生成；上滑 → 下方追加全新内容（上方不变）
  const scrollRef = useRef<HTMLDivElement>(null);
  const [feed, setFeed] = useState<FeedItem[]>(homeFeedCache.feed);
  const [listData, setListData] = useState<{ deals: MtDeal[]; title: string | null }>({
    deals: homeFeedCache.listDeals,
    title: homeFeedCache.listTitle,
  });
  const [generating, setGenerating] = useState(!homeFeedCache.ready); // 首屏/刷新骨架动画
  const [loadingMore, setLoadingMore] = useState(false);
  const [pullDist, setPullDist] = useState(0);
  const [pullHint, setPullHint] = useState<'pull' | 'release'>('pull');
  // 设置 › API 配置里用户配置好的模型（OpenAI 兼容），随请求体传给 /api/mt-feed
  const apiConfig = useSettings((s) => s.apiConfig);
  const apiCfgRef = useRef(apiConfig);
  apiCfgRef.current = apiConfig;
  // 自建商品变化令牌（第三十七轮：创建/删除商品后置顶区即时重算）
  const [customTick, setCustomTick] = useState(0);
  useEffect(() => {
    const bump = () => setCustomTick((t) => t + 1);
    window.addEventListener('mt-custom-products-changed', bump);
    return () => window.removeEventListener('mt-custom-products-changed', bump);
  }, []);
  // 自建商品商家（创建订单=创建商品）：与普通商家混排且永远置顶——刷新/切分类/上滑追加全部排在它后面；
  // 渲染层前置（不在 setFeed 时拼接），缓存恢复/任何刷新路径自动生效
  const customFeed = useMemo<FeedItem[]>(() => {
    void customTick;
    mtRegisterCustomMerchants(mtLoadCustomShops(uid)); // 幂等恢复（进页/创建后均可安全重入）
    return mtCustomMerchantsAll().map((m) => ({ t: 'm' as const, m }));
  }, [uid, customTick]);
  // 第三十八轮：置顶商家卡右上角×已按需求删除，删除统一收口到「管理商品」页
  const genSeqRef = useRef(0); // 竞态丢弃：刷新/切分类期间旧响应作废
  const generatingRef = useRef(!homeFeedCache.ready);
  const loadingRef = useRef(false);
  const filterRef = useRef(filter);
  const feedRef = useRef<FeedItem[]>([]);
  feedRef.current = feed;
  const pullStartRef = useRef<number | null>(null);

  useEffect(() => {
    const iv = setInterval(() => setHintIdx((i) => (i + 1) % HOME_SEARCH_HINTS.length), 3200);
    return () => clearInterval(iv);
  }, []);

  // ---- AI 取数：/api/mt-feed（用户配置模型 → 服务端内置模型兜底），失败走本地洗牌兜底 ----
  const fetchBatch = useCallback(
    async (
      f: string | null,
      exclude: string[]
    ): Promise<{ items: FeedItem[]; listDeals: MtDeal[]; listTitle: string | null }> => {
      try {
        const res = await fetch('/api/mt-feed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: apiCfgRef.current,
            filter: f,
            exclude,
            count: 15 + Math.floor(Math.random() * 4),
          }),
        });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          merchants?: MtMerchant[];
          deals?: MtDeal[];
          listTitle?: string | null;
        } | null;
        if (!res.ok || !data || data.ok !== true) throw new Error('AI 生成失败');
        const merchants = (data.merchants ?? []).map((m) => {
          mtRegisterAiMerchant(m);
          return m;
        });
        const deals = (data.deals ?? []).map((d) => {
          mtRegisterAiDeal(d);
          return d;
        });
        if (merchants.length === 0 && deals.length === 0) throw new Error('空数据');
        mtPersistAiRegistry(); // AI 商家/团购写穿 kv：刷新/重开 App 后原样恢复（点开不刷新）
        let items: FeedItem[];
        let listDeals: MtDeal[] = [];
        let listTitle: string | null = null;
        if (f === 'tuangou') {
          items = deals.map<FeedItem>((d) => ({ t: 'deal', d }));
        } else if (f) {
          items = merchants.map<FeedItem>((m) => ({ t: 'm', m }));
        } else {
          // 推荐流：前 2 个团购进「特价团」聚合卡（AI 生成），其余进瀑布流；AI 未给主题 → 种子兜底
          const ld = deals.slice(0, 2);
          if (ld.length > 0) {
            listDeals = ld;
            listTitle = data.listTitle ?? null;
            items = interleave(deals.slice(2), merchants);
          } else {
            listDeals = MT_HOME_LIST.dealIds
              .map((id) => MT_DEALS.find((d) => d.id === id))
              .filter((d): d is MtDeal => !!d)
              .slice(0, 2);
            listTitle = MT_HOME_LIST.title;
            items = interleave(deals, merchants);
          }
        }
        // 数量下限：AI 偶发只返回 2~5 条（并发单批 429/截断）→ 本地池补齐到 ≥10，
        // 保证任何情况下分类页/推荐流都有 7~15 家不重复店铺
        if (items.length < 7) {
          const seenNames = new Set(items.map(feedName).filter(Boolean));
          const pad = localBatch(f, [...exclude, ...seenNames]);
          items = [...items, ...pad.items.filter((p) => !seenNames.has(feedName(p)))].slice(0, 12);
        }
        return { items, listDeals, listTitle };
      } catch {
        return localBatch(f, exclude);
      }
    },
    []
  );

  // 重新生成：下拉刷新 / 切换分类 / 首次进入（排除名单 = 上一次已展示内容 → 出来的是全新内容）
  // 商家入驻：当前账号的自有店铺（营业中）置顶露出在瀑布流最前面
  const regenerate = useCallback(async () => {
    const seq = ++genSeqRef.current;
    const f = filterRef.current;
    const myShops = mtLoadShops(uid).filter((s) => s.mine && s.mtStatus !== 'closed' && (f === null || s.cats.includes(f)));
    const exclude = [
      ...feedRef.current.map(feedName).filter(Boolean).slice(0, 80),
      ...myShops.map((s) => s.name),
      ...mtCustomMerchantsAll().map((m) => m.name), // 自建商品店名进排除名单：AI 不生成同名
    ];
    const keepY = scrollRef.current?.scrollTop ?? 0; // 刷新前的浏览位置：新内容渲染后回到这里（不强制回顶部）
    generatingRef.current = true;
    loadingRef.current = false;
    setGenerating(true);
    setLoadingMore(false);
    setPullDist(0);
    const batch = await fetchBatch(f, exclude);
    if (genSeqRef.current !== seq) return; // 期间又触发了刷新/切分类：丢弃过期批次
    setFeed([...myShops.map((m) => ({ t: 'm' as const, m })), ...batch.items]);
    setListData({ deals: batch.listDeals, title: batch.listTitle });
    generatingRef.current = false;
    setGenerating(false);
    if (keepY > 0) {
      // 双 rAF：等新内容完成布局后回到刷新前的位置（内容变短则夹到最大可滚动处）
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (el) el.scrollTop = Math.min(keepY, Math.max(0, el.scrollHeight - el.clientHeight));
        }),
      );
    }
  }, [fetchBatch, uid]);

  // 首次挂载：有缓存直接恢复（从详情页/其他 tab 返回不重新生成）；否则生成
  // 之后 filter 变化（切分类/切回推荐）→ 重新生成
  const firstRunRef = useRef(true);
  useEffect(() => {
    filterRef.current = filter;
    if (firstRunRef.current) {
      firstRunRef.current = false;
      if (homeFeedCache.ready && homeFeedCache.filter === filter) {
        generatingRef.current = false;
        setGenerating(false);
        return;
      }
    }
    void regenerate();
  }, [filter, regenerate]);

  // 信息流写入缓存：返回首页时原样恢复；同步写穿 kv（Task 46：重开 App/刷新页面也原样恢复）
  useEffect(() => {
    homeFeedCache.ready = !generating && feed.length > 0;
    homeFeedCache.filter = filter;
    homeFeedCache.feed = feed;
    homeFeedCache.listDeals = listData.deals;
    homeFeedCache.listTitle = listData.title;
    if (homeFeedCache.ready) mtPersistHomeFeed();
  }, [feed, generating, filter, listData]);

  // 上滑追加：新内容接在下方，上方已展示内容保持不变（每批 15~20 条）
  const loadMore = useCallback(async () => {
    if (loadingRef.current || generatingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    const f = filterRef.current;
    const exclude = feedRef.current.map(feedName).filter(Boolean).slice(0, 80);
    const batch = await fetchBatch(f, exclude);
    if (filterRef.current !== f || generatingRef.current) {
      // 等待期间切换了分类/触发了刷新 → 丢弃这批
      loadingRef.current = false;
      setLoadingMore(false);
      return;
    }
    setFeed((prev) => [...prev, ...batch.items]);
    loadingRef.current = false;
    setLoadingMore(false);
  }, [fetchBatch]);

  const onHomeScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    homeFeedCache.scroll = el.scrollTop; // 随时记录浏览位置（返回/刷新后恢复用）
    mtPersistHomeScroll(el.scrollTop); // 节流写穿 kv（重开 App 也回到离开时的位置）
    if (generatingRef.current || loadingRef.current) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 280) void loadMore();
  }, [loadMore]);

  // 返回恢复浏览位置：布局完成后、首次绘制前跳回离开时的位置（无闪顶）
  useLayoutEffect(() => {
    const y = homeFeedCache.scroll;
    if (homeFeedCache.ready && y > 0) {
      const el = scrollRef.current;
      if (el) el.scrollTop = Math.min(y, Math.max(0, el.scrollHeight - el.clientHeight));
    }
  }, []);

  // ---- 下拉刷新手势：顶部继续下拉 → 松手重新生成（需求三：下拉刷新，重新生成） ----
  const onTouchStart = (e: React.TouchEvent) => {
    pullStartRef.current = (scrollRef.current?.scrollTop ?? 1) <= 0 ? e.touches[0].clientY : null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (pullStartRef.current === null || generatingRef.current) return;
    const d = e.touches[0].clientY - pullStartRef.current;
    if (d > 0) {
      setPullDist(Math.min(Math.round(d * 0.45), 110));
      setPullHint(d > 90 ? 'release' : 'pull');
    }
  };
  const onTouchEnd = () => {
    const shouldRefresh = pullStartRef.current !== null && pullDist > 55 && !generatingRef.current;
    pullStartRef.current = null;
    setPullDist(0);
    if (shouldRefresh) void regenerate();
  };

  const tapCat = (c: (typeof MT_HOME_GRID)[number][number]) => {
    // 创建商品（自建订单入库，替代原「按摩足疗」占位）
    if (c.filter === 'create') {
      onOpenCreateOrder();
      return;
    }
    // 管理商品（第三十八轮：编辑/删除自建商品统一收口）
    if (c.filter === 'manage') {
      onOpenManage();
      return;
    }
    // 三大频道：酒店旅行 / 休闲玩乐 / 电影演出 → 独立频道页（AI 生成内容）
    if (c.filter === 'hotel' || c.filter === 'xiuxian' || c.filter === 'dianying') {
      onOpenChannel(c.filter === 'hotel' ? 'hotel' : c.filter === 'xiuxian' ? 'fun' : 'movies');
      return;
    }
    if (c.filter === 'shangou' || c.filter === 'travel') {
      onOpenChannel(c.filter);
      return;
    }
    if (c.filter === null || c.filter === undefined) {
      onToast(`「${c.name}」频道即将上线`);
      return;
    }
    setFilter((f) => (f === c.filter ? null : c.filter!));
  };

  return (
    <div
      ref={scrollRef}
      onScroll={onHomeScroll}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="h-full overflow-y-auto overscroll-contain bg-[#F4F5F7] pb-4"
    >
      {/* 黄头（再浅一档的淡黄）+ 毛玻璃装饰光斑：定位 / 消息 / 扫一扫 / 搜索 */}
      <div className="relative overflow-hidden bg-[#FFF0A8] px-4 pb-3 pt-[54px]">
        {/* 装饰光斑（搜索框 backdrop-blur 的磨砂来源，毛玻璃质感） */}
        <span aria-hidden="true" className="pointer-events-none absolute -right-7 top-1 h-28 w-28 rounded-full bg-white/55 blur-2xl" />
        <span aria-hidden="true" className="pointer-events-none absolute left-6 top-14 h-24 w-32 rounded-full bg-[#FFD100]/45 blur-2xl" />
        <span aria-hidden="true" className="pointer-events-none absolute right-28 top-20 h-16 w-16 rounded-full bg-[#FF9F1C]/25 blur-xl" />
        <div className="relative flex items-center gap-2">
          {/* 左上角定位：点击退回手机主界面（iOS Home；收货地址在「我的-收货地址/下单页」仍可改） */}
          <button
            type="button"
            data-testid="home-locate"
            aria-label="定位，点按返回手机主界面"
            onClick={() => useUI.getState().closeApp()}
            className="flex min-w-0 items-center gap-1 text-left active:opacity-70"
          >
            <MapPin className="h-[17px] w-[17px] shrink-0 text-black/80" strokeWidth={2.1} />
            <span className="truncate text-[17px] font-semibold text-black/90">{cur ? cur.text.slice(0, 9) : '选择地址'}</span>
          </button>
          <span className="flex-1" />
          <button type="button" aria-label="消息" onClick={onOpenMessages} className="grid shrink-0 place-items-center rounded-full p-1 active:opacity-60">
            <MessageCircleMore className="h-[22px] w-[22px] text-black/75" strokeWidth={1.9} />
          </button>
          <button type="button" aria-label="扫一扫" onClick={onScan} data-testid="home-scan" className="grid shrink-0 place-items-center rounded-full p-1 active:opacity-60">
            <ScanLine className="h-[22px] w-[22px] text-black/75" strokeWidth={1.9} />
          </button>
        </div>
        <button type="button" onClick={() => onOpenSearch(HOME_SEARCH_HINTS[hintIdx])} className="relative mt-3 flex h-10 w-full items-center gap-2 rounded-full bg-white/55 pl-4 pr-1 text-left shadow-[0_4px_16px_rgba(160,120,0,0.10)] ring-1 ring-white/70 backdrop-blur-xl active:opacity-95">
          <SearchIcon className="h-[15px] w-[15px] shrink-0 text-black/45" strokeWidth={2.2} />
          <span key={hintIdx} className="min-w-0 flex-1 truncate text-[14px] text-black/75">{HOME_SEARCH_HINTS[hintIdx]}</span>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-[#FFD100] px-5 py-[7px] text-[14px] font-semibold text-black/85 shadow-[0_2px_8px_rgba(255,180,0,0.35)]">搜索</span>
        </button>
      </div>

      {/* 分类宫格（两页 + 圆点） */}
      <div className="bg-white">
        <div
          ref={gridRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setGridPage(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
          }}
          className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {MT_HOME_GRID.map((pageCats, pi) => (
            <div key={pi} className="grid w-full shrink-0 snap-center grid-cols-5 gap-y-5 px-2 py-4">
              {pageCats.map((c) => {
                const activeFilter = filter !== null && c.filter === filter;
                const GIcon = GRID_ICONS[c.icon] ?? LayoutGrid;
                return (
                  <button key={c.id} type="button" onClick={() => tapCat(c)} className="flex flex-col items-center gap-2 active:opacity-70">
                    <GIcon
                      className={`h-[26px] w-[26px] ${activeFilter ? 'text-[#F5A700]' : 'text-black/80'}`}
                      strokeWidth={1.8}
                    />
                    <span className={`text-[11px] leading-none ${activeFilter ? 'font-semibold text-[#F5A700]' : 'text-black/65'}`}>{c.name}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-1.5 pb-2.5">
          {MT_HOME_GRID.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`第${i + 1}页`}
              onClick={() => gridRef.current?.scrollTo({ left: i * gridRef.current.clientWidth, behavior: 'smooth' })}
              className={`h-[5px] rounded-full transition-all ${gridPage === i ? 'w-4 bg-[#FFC300]' : 'w-[5px] bg-black/15'}`}
            />
          ))}
        </div>
      </div>

      {/* 生成中 / 下拉刷新提示（分类宫格图标下方） */}
      <div
        className="grid place-items-center overflow-hidden transition-[height] duration-150"
        style={{ height: generating ? 48 : pullDist }}
      >
        {generating ? (
          <span className="flex items-center gap-1.5 text-[12px] text-black/40">
            <RotateCw className="h-4 w-4 animate-spin text-[#FFC300]" />
            AI 正在生成新内容…
          </span>
        ) : (
          pullDist > 8 && (
            <span className="flex items-center gap-1 text-[12px] text-black/35">
              <ArrowDown className={`h-3.5 w-3.5 transition-transform ${pullHint === 'release' ? 'rotate-180' : ''}`} />
              {pullHint === 'release' ? '松手刷新' : '下拉刷新'}
            </span>
          )
        )}
      </div>

      {/* 瀑布流：AI 生成内容（生成中显示骨架动画） */}
      {generating ? (
        <div className="mt-2 columns-2 gap-2 px-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="mb-2 break-inside-avoid rounded-xl bg-white p-2.5">
              <div className="h-[110px] w-full animate-pulse rounded-lg bg-black/[0.06]" />
              <div className="mt-2 h-3.5 w-3/4 animate-pulse rounded bg-black/[0.06]" />
              <div className="mt-1.5 h-3 w-1/2 animate-pulse rounded bg-black/[0.06]" />
              <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-black/[0.06]" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="mt-2 columns-2 gap-2 px-2">
            {/* 自建商品商家（第三十六轮）：永远置顶——与普通商家同卡混排；第三十九轮：点击直达自建商品详情页 */}
            {customFeed.map((it, i) =>
              it.t === 'm' ? <MerchantCard key={`c-${it.m.id}-${i}`} m={it.m} onOpen={() => onOpenCustomProduct(it.m.id)} /> : null
            )}
            {filter === null && <DealListCard title={listData.title ?? MT_HOME_LIST.title} deals={listData.deals} onOpen={onOpenDeal} />}
            {feed.map((it, i) =>
              it.t === 'deal' ? (
                <DealCard key={`deal-${it.d.id}-${i}`} deal={it.d} onOpen={() => onOpenDeal(it.d.id)} />
              ) : it.t === 'm' ? (
                <MerchantCard key={`m-${it.m.id}-${i}`} m={it.m} onOpen={() => onOpenMerchant(it.m.id)} />
              ) : null
            )}
          </div>
          {feed.length === 0 && customFeed.length === 0 ? (
            <p className="mx-3 mt-6 rounded-2xl bg-white p-8 text-center text-[13px] text-black/40">该分类下暂无商家</p>
          ) : (
            <p className="py-3 text-center text-[12px] text-black/35">
              {loadingMore ? 'AI 正在生成更多好店…' : '上滑加载更多 · 下拉刷新'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ================================ 搜索页 ================================

/** 搜索结果条目：商家 / 菜品（带所属商家） */


const HOME_SEARCH_HINTS = ['衣服女装套装', '珍珠奶茶', '爆款汉堡4件套', '麻辣烫', '应季草莓', '电影票'];

export type SearchHit = { t: 'm'; m: MtMerchant } | { t: 'd'; m: MtMerchant; d: MtDish };

/** 搜索相关性打分：名称命中 > 菜品命中 > 分类命中 > 分节命中；0 分 = 不相关（不再进结果池） */

export function searchScore(m: MtMerchant, kw: string): number {
  let s = 0;
  if (m.name.includes(kw)) s += 4;
  if (mtDishesOf(m).some((d) => d.name.includes(kw))) s += 3;
  if (m.cats.some((c) => { const n = MT_CATS.find((x) => x.id === c)?.name; return !!n && (n.includes(kw) || kw.includes(n)); })) s += 2;
  if (m.sections.some((sec) => sec.cat.includes(kw))) s += 1;
  return s;
}

/** 组装搜索池：相关性优先；「猜你喜欢」只从相关商家（同分类延伸）补齐，不再全库硬凑（修复搜「奶茶」混出药房/汉堡） */

export function makeSearchPool(kw: string): { hits: SearchHit[]; pool: SearchHit[] } {
  const all = mtAllMerchants();
  const scored = all.map((m) => ({ m, s: searchScore(m, kw) })).filter((x) => x.s > 0);
  const hits: SearchHit[] = shuffle(scored.filter((x) => x.s >= 3).map((x) => ({ t: 'm' as const, m: x.m })));
  const hitD = scored.flatMap((x) => mtDishesOf(x.m).filter((d) => d.name.includes(kw)).map((d) => ({ t: 'd' as const, m: x.m, d })));
  const seen = new Set<string>([...hits.map((h) => `m:${h.m.id}`), ...hitD.map((h) => `m:${h.m.id}`)]);
  // 猜你喜欢：相关商家（分类/分节擦边命中）→ 与命中商家同分类的其余商家，两级补齐后不再硬凑
  const weak = shuffle(scored.filter((x) => x.s >= 1 && !seen.has(`m:${x.m.id}`)).map((x) => ({ t: 'm' as const, m: x.m })));
  weak.forEach((h) => seen.add(`m:${h.m.id}`));
  const hitCats = new Set(scored.filter((x) => x.s >= 2).flatMap((x) => x.m.cats));
  const sameCat = shuffle(
    all.filter((m) => !seen.has(`m:${m.id}`) && m.cats.some((c) => hitCats.has(c))).map((m) => ({ t: 'm' as const, m }))
  );
  return { hits: [...hits, ...hitD], pool: [...weak, ...sameCat] };
}

/** 每批 15~20 个（需求「搜索以后要加载 15~20 个，下滑还可以加载」） */

export const searchBatchSize = () => 15 + Math.floor(Math.random() * 6);


function SearchPage({ seedKw, onBack, onOpenMerchant }: { seedKw: string; onBack: () => void; onOpenMerchant: (id: string) => void }) {
  const [kw, setKw] = useState(seedKw);
  const [done, setDone] = useState('');
  const [hist, setHist] = useState<string[]>(() => mtGetSearchHist());
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hits, setHits] = useState<SearchHit[]>([]); // 精确命中
  const [res, setRes] = useState<SearchHit[]>([]); // 已展示（命中 + 猜你喜欢）
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);
  const poolRef = useRef<SearchHit[]>([]);
  const doneRef = useRef('');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = (k: string) => {
    const key = k.trim();
    if (!key) return;
    setKw(key);
    setDone(key);
    doneRef.current = key;
    const next = [key, ...mtGetSearchHist().filter((x) => x !== key)].slice(0, 10);
    try {
      window.localStorage.setItem('mt-search-hist', JSON.stringify(next));
    } catch {
      /* 忽略 */
    }
    setHist(next);
    const { hits: hs, pool } = makeSearchPool(key);
    setHits(hs);
    poolRef.current = pool;
    setRes([...hs, ...poolRef.current.splice(0, searchBatchSize())]);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  // 下滑加载下一批 15~20 个；垫池耗尽 → 重洗全库续上（每次内容随机，刷新不一样）
  const loadMore = useCallback(() => {
    if (loadingRef.current || !doneRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    window.setTimeout(() => {
      if (poolRef.current.length === 0) poolRef.current = makeSearchPool(doneRef.current).pool;
      const batch = poolRef.current.splice(0, searchBatchSize());
      setRes((prev) => [...prev, ...batch]);
      loadingRef.current = false;
      setLoadingMore(false);
    }, 450);
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loadingRef.current) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 280) loadMore();
  }, [loadMore]);

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-black/[0.04] bg-white px-3 pb-2.5 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-6 w-6 text-black/70" />
        </button>
        <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-[#F5F6F7] px-3.5">
          <SearchIcon className="h-4 w-4 shrink-0 text-black/35" />
          <input
            ref={inputRef}
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run(kw);
            }}
            placeholder="搜索商家、菜品"
            className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-black/30"
          />
          {kw && (
            <button type="button" aria-label="清空" onClick={() => { setKw(''); setDone(''); }} className="shrink-0">
              <X className="h-4 w-4 text-black/30" />
            </button>
          )}
        </div>
        {/* 横排搜索按钮（shrink-0 防挤压换行） */}
        <button type="button" onClick={() => run(kw)} className="shrink-0 whitespace-nowrap rounded-full bg-[#FFD100] px-4 py-2 text-[14px] font-medium text-black/85 active:opacity-80">
          搜索
        </button>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain p-4">
        {!done && (
          <>
            {hist.length > 0 && (
              <>
                <div className="flex items-center">
                  <p className="text-[14px] font-semibold text-black/70">搜索历史</p>
                  <button
                    type="button"
                    onClick={() => {
                      mtClearSearchHist();
                      setHist([]);
                    }}
                    className="ml-auto text-[12px] text-black/35"
                  >
                    清空
                  </button>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {hist.map((h) => (
                    <button key={h} type="button" onClick={() => run(h)} className="rounded-full bg-[#F5F6F7] px-3 py-1.5 text-[12px] text-black/65 active:opacity-70">
                      {h}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="mt-5 flex items-center">
              <p className="text-[14px] font-semibold text-black/70">热门榜单</p>
              <span className="ml-1.5 rounded-[3px] bg-[#FFF1C0] px-1 text-[10px] leading-[1.6] text-[#B77900]">实时</span>
            </div>
            <div className="mt-1.5 divide-y divide-black/[0.03]">
              {SEARCH_TOP.map((h, i) => (
                <button key={h} type="button" onClick={() => run(h)} className="flex w-full items-center gap-3 py-2.5 text-left active:bg-black/[0.02]">
                  <span className={`w-5 shrink-0 text-center text-[14px] font-bold italic ${i < 3 ? 'text-[#FF6000]' : 'text-black/30'}`}>{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-black/80">{h}</span>
                  {i < 3 && <span className="shrink-0 text-[10px] font-semibold text-[#FF4B33]">热</span>}
                </button>
              ))}
            </div>
            <p className="mt-5 text-[14px] font-semibold text-black/70">搜索发现</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {['奶茶', '汉堡', '麻辣烫', '水果', '药品', '比萨', '盖浇饭', '火锅'].map((h) => (
                <button key={h} type="button" onClick={() => run(h)} className="rounded-full bg-[#F5F6F7] px-3 py-1.5 text-[12px] text-black/65 active:opacity-70">
                  {h}
                </button>
              ))}
            </div>
          </>
        )}

        {done && (
          <>
            {hits.length === 0 ? (
              <div className="mt-2">
                <div className="text-center">
                  <p className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#F5F6F7]">
                    <SearchIcon className="h-6 w-6 text-black/25" strokeWidth={1.8} />
                  </p>
                  <p className="mt-2 text-[13px] text-black/40">没有找到「{done}」相关的商家或菜品</p>
                </div>
                <p className="mt-5 text-[13px] font-semibold text-black/45">猜你喜欢</p>
              </div>
            ) : (
              <p className="text-[13px] font-semibold text-black/45">找到「{done}」相关结果</p>
            )}
            <div className="mt-2 divide-y divide-black/[0.04]">
              {res.map((it, i) =>
                it.t === 'm' ? (
                  <SearchMerchantRow key={`sm-${it.m.id}-${i}`} m={it.m} onOpen={() => onOpenMerchant(it.m.id)} />
                ) : (
                  <button key={`sd-${it.d.id}-${i}`} type="button" onClick={() => onOpenMerchant(it.m.id)} className="flex w-full items-center gap-3 p-2.5 text-left active:bg-black/[0.02]">
                    <FoodImg src={it.d.img} emoji={it.d.emoji} className="h-12 w-12 shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-black/85">{it.d.name}</span>
                      <span className="block text-[11px] text-black/40">{it.m.name}</span>
                    </span>
                    <span className="shrink-0 text-[15px] font-semibold" style={{ color: MT_PRICE }}>
                      ¥{fmtMoney(it.d.price)}
                    </span>
                  </button>
                )
              )}
            </div>
            {res.length > 0 && (
              <p className="py-3 text-center text-[12px] text-black/35">{loadingMore ? '正在加载更多…' : '上滑加载更多'}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** 热门榜单（固定演示榜，前 3 标热） */

export const SEARCH_TOP = ['奶茶', '麻辣烫', '汉堡', '火锅', '水果', '比萨', '药品', '盖浇饭', '咖啡', '早餐'];

/** 搜索结果商家行（列表式） */

export function SearchMerchantRow({ m, onOpen }: { m: MtMerchant; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full gap-3 p-3 text-left active:bg-black/[0.02]">
      <ShopAvatar m={m} className="h-[76px] w-[76px] shrink-0 rounded-xl" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-black/85">{m.name}</span>
        <span className="mt-1 flex items-center gap-1.5 text-[12px]">
          <span className="flex items-center gap-0.5 text-[#FF6000]">
            <Star className="h-3 w-3 fill-[#FF6000]" strokeWidth={0} />
            <span className="font-semibold">{m.rating}</span>
          </span>
          <span className="text-black/40">月售{m.monthSale >= 10000 ? `${(m.monthSale / 10000).toFixed(1)}万` : m.monthSale}+</span>
          <span className="text-black/40">{mtDeliveryMinutesOf(m.id)}分钟 · {m.distanceKm}km</span>
        </span>
        <span className="mt-1 block text-[12px] text-black/55">
          起送 ¥{m.minOrder} · 配送 ¥{m.deliveryFee}
          {m.minOrder === 0 && <span className="ml-1 text-[#00A661]">免起送</span>}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-1">
          {m.deals.slice(0, 2).map((d) => (
            <span key={d} className="rounded border border-[#FF4B33]/35 px-1 py-px text-[10px] leading-[1.5] text-[#FF4B33]">
              {d}
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

// ================================ 商家详情页 ================================

/** 商家页页签记忆（进订单详情再返回时停留在原页签，如「订单」） */
let merchantTabMemo: '点菜' | '评价' | '商家' | '订单' = '点菜';


function MerchantPage({ merchant, onBack, onCheckout, onOpenOrder, onToast }: { merchant: MtMerchant; onBack: () => void; onCheckout: (mid?: string) => void; onOpenOrder: (id: string) => void; onToast: (m: string) => void }) {
  const { favs, toggle } = useFavs();
  const storeFav = favs.stores.includes(merchant.id);
  const session = mtGetSession();
  const uid = session ? mtUidOf(session) : '';
  const [tab, setTab] = useState<'点菜' | '评价' | '商家' | '订单'>(merchantTabMemo);
  const [cart, setCart] = useState<MtCart>(() => mtLoadCart(uid));
  const [cartOpen, setCartOpen] = useState(false);
  const [activeCat, setActiveCat] = useState(0);
  const [specDish, setSpecDish] = useState<MtDish | null>(null); // 规格/小料选择弹窗
  // 店铺头像生成弹层（第三十七轮：点头像 → 选模型+自定义提示词生成新头像，覆盖存储）
  const [avatarGenOpen, setAvatarGenOpen] = useState(false);
  const [avatarGenBusy, setAvatarGenBusy] = useState(false);
  const [avatarGenErr, setAvatarGenErr] = useState('');
  const [avatarTick, setAvatarTick] = useState(0);
  const genShopAvatar = async (prompt: string, cfg: ImgGenConfig & { mode?: 'proxy' | 'direct' }) => {
    setAvatarGenBusy(true);
    setAvatarGenErr('');
    try {
      const src = await generateFreePhoto(cfg, prompt);
      mtSetShopAvatar(merchant.id, src);
      setAvatarGenOpen(false);
      setAvatarTick((t) => t + 1);
      onToast('店铺头像已生成');
    } catch (e) {
      setAvatarGenErr(e instanceof Error ? e.message : '生成失败，请重试');
    } finally {
      setAvatarGenBusy(false);
    }
  };
  // 商品图生成（第三十七轮：规格弹窗菜品图可点击 → 选模型+可编辑提示词生成，自建+原有通用）
  const [dishGen, setDishGen] = useState<MtDish | null>(null);
  const [dishGenBusy, setDishGenBusy] = useState(false);
  const [dishGenErr, setDishGenErr] = useState('');
  const genDishImg = async (prompt: string, cfg: ImgGenConfig & { mode?: 'proxy' | 'direct' }) => {
    if (!dishGen) return;
    setDishGenBusy(true);
    setDishGenErr('');
    try {
      const src = await generateFreePhoto(cfg, prompt);
      mtSetProductImg(dishGen.id, src);
      setDishGen(null);
      onToast('商品图片已生成');
    } catch (e) {
      setDishGenErr(e instanceof Error ? e.message : '生成失败，请重试');
    } finally {
      setDishGenBusy(false);
    }
  };
  const catRefs = useRef<(HTMLDivElement | null)[]>([]);
  useOrdersTick();
  const shopOrders = uid ? mtLoadOrders(uid).filter((o) => o.merchantId === merchant.id) : [];
  /** 本账号在该商家的真实评价（评价晒单提交后聚合进评价 tab；含商家回复） */
  const myReviews = shopOrders
    .filter((o) => o.review)
    .map((o) => ({
      orderId: o.id,
      user: `${session?.name ?? '我'}（本店订单）`,
      rating: o.review!.rating,
      content: o.review!.content,
      time: new Date(o.review!.at).toLocaleDateString('zh-CN'),
      tags: o.review!.tags,
      imgs: o.review!.imgs,
      reply: o.review!.reply,
    }));

  const calc = mtCheckoutCalc(uid, merchant, cart);
  const cartMerchantOk = cart.merchantId === null || cart.merchantId === merchant.id || cart.items.length === 0;
  // 跨店购物车：当前购物车属于其他商家（对齐真机：底栏展示他店商品，可一键清空或去他店结算）
  const foreignMerchant = cart.merchantId && cart.merchantId !== merchant.id && cart.items.length > 0 ? mtMerchantOf(cart.merchantId) : undefined;
  const foreignCalc = foreignMerchant ? mtCheckoutCalc(uid, foreignMerchant, cart) : null;

  /** 函数式更新 + 持久化（连续点击同一帧内也正确累加，避免 stale state 相互覆盖） */
  const mutateCart = (updater: (prev: MtCart) => MtCart): void => {
    setCart((prev) => {
      const next = updater(prev);
      mtSaveCart(uid, next);
      return next;
    });
  };

  const add = (d: MtDish) => {
    if (d.soldOut) {
      onToast('这道菜已售罄，看看别的吧');
      return;
    }
    if (merchant.mine && merchant.mtStatus === 'closed') {
      onToast('店铺已打烊，暂停接单');
      return;
    }
    if (!cartMerchantOk && cart.items.length > 0) {
      onToast('不同商家商品不能合并结算，请先结算或清空购物车');
      return;
    }
    // 有规格的菜品（奶茶小料/食物配菜）先弹规格选择弹窗
    if (d.specs && d.specs.length > 0) {
      setSpecDish(d);
      return;
    }
    mutateCart((prev) => ({
      merchantId: merchant.id,
      items: prev.items.some((i) => i.dishId === d.id)
        ? prev.items.map((i) => (i.dishId === d.id ? { ...i, qty: i.qty + 1 } : i))
        : [...prev.items, { dishId: d.id, qty: 1 }],
    }));
  };
  /** 规格弹窗「选好了」：同菜不同规格分行（dishId+spec 为唯一键）；静默入车（对齐真机无 toast，角标即反馈） */
  const addWithSpec = (d: MtDish, qty: number, spec: string, unitPrice: number) => {
    if (merchant.mine && merchant.mtStatus === 'closed') {
      onToast('店铺已打烊，暂停接单');
      setSpecDish(null);
      return;
    }
    if (!cartMerchantOk && cart.items.length > 0) {
      onToast('不同商家商品不能合并结算，请先结算或清空购物车');
      setSpecDish(null);
      return;
    }
    mutateCart((prev) => {
      const sameKey = (i: { dishId: string; spec?: string }): boolean => i.dishId === d.id && (i.spec ?? '') === spec;
      const items = prev.items.some(sameKey)
        ? prev.items.map((i) => (sameKey(i) ? { ...i, qty: i.qty + qty } : i))
        : [...prev.items, { dishId: d.id, qty, spec, unitPrice }];
      return { merchantId: merchant.id, items };
    });
    setSpecDish(null);
  };
  const dec = (d: MtDish) => {
    // 多规格分行：减最后一个同菜行
    mutateCart((prev) => {
      const idx = prev.items.map((i) => i.dishId).lastIndexOf(d.id);
      if (idx < 0) return prev;
      const items = prev.items.map((i, k) => (k === idx ? { ...i, qty: i.qty - 1 } : i)).filter((i) => i.qty > 0);
      return { merchantId: items.length > 0 ? merchant.id : null, items };
    });
  };
  const clearCart = () => {
    const next: MtCart = { merchantId: null, items: [] };
    setCart(next);
    mtSaveCart(uid, next);
    setCartOpen(false);
  };

  const qtyOf = (dishId: string): number => cart.items.find((i) => i.dishId === dishId)?.qty ?? 0;
  const belowMin = calc.itemTotal < merchant.minOrder;
  /** 商家入驻：自有店铺营业状态（closed = 详情页打烊横幅 + 加购/结算拦截） */
  const shopClosed = merchant.mine && merchant.mtStatus === 'closed';
  const shopCoupons = merchant.mine ? merchant.coupons ?? [] : [];
  const [claimedCouponIds, setClaimedCouponIds] = useState<string[]>([]);

  // 点菜分区滚动跟随
  const onCatTap = (idx: number) => {
    setActiveCat(idx);
    catRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      {/* 头图（店铺背景：欢迎光临手绘图，所有店铺统一）+ 悬浮搜索条 */}
      <div className="relative h-[128px] shrink-0">
        <FoodImg src={MT_SHOP_BG} emoji={merchant.emoji} cap={merchant.name} className="h-full w-full" />
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 px-3 pt-[54px]">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/35 text-white active:opacity-75">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-white/95 px-3">
            <SearchIcon className="h-3.5 w-3.5 shrink-0 text-black/40" />
            <span className="truncate text-[13px] text-black/70">{merchant.name}</span>
            <span className="ml-auto shrink-0 rounded-full bg-[#FFD100] px-3 py-1 text-[12px] font-medium text-black/85">搜索</span>
          </div>
          <button
            type="button"
            aria-label="收藏商家"
            onClick={() => onToast(toggle('stores', merchant.id) ? '已收藏，可在收藏中查看' : '已取消收藏商家')}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/35 text-white active:opacity-75"
          >
            <Star className={`h-4 w-4 ${storeFav ? 'fill-[#FFD100] text-[#FFD100]' : ''}`} />
          </button>
        </div>
      </div>

      {/* 商家入驻打烊横幅（自有店铺，暂停接单） */}
      {shopClosed && (
        <div className="relative z-10 bg-black/80 py-1.5 text-center text-[12px] text-white" data-testid="mt-shop-closed-banner">
          店铺已打烊 · 暂停接单
        </div>
      )}

      {/* 商家信息（白底直排无面板） */}
      <div className="relative z-10 -mt-6 border-y border-black/[0.05] bg-white px-4 py-3.5">
          <div className="flex gap-3">
            {/* 店铺头像（所有店铺统一「正在营业」印章；点击生成自定义头像） */}
            <button
              type="button"
              aria-label="点击生成店铺头像"
              data-testid="mt-shop-avatar"
              onClick={(e) => {
                e.stopPropagation();
                setAvatarGenOpen(true);
              }}
              className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl active:opacity-80"
            >
              <ShopAvatar key={avatarTick} m={merchant} className="h-full w-full" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[17px] font-bold text-black/85">{merchant.name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-black/50">
                <span className="flex items-center gap-0.5 text-[#FF6000]">
                  <Star className="h-3 w-3 fill-[#FF6000]" strokeWidth={0} />
                  <span className="font-semibold">{merchant.rating}</span>
                </span>
                <span>月售{merchant.monthSale >= 10000 ? `${(merchant.monthSale / 10000).toFixed(1)}万` : merchant.monthSale}+</span>
                <span>{mtDeliveryMinutesOf(merchant.id)}分钟 · {merchant.distanceKm}km</span>
              </p>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {merchant.deals.map((d) => (
              <span key={d} className="rounded bg-[#FFF0EB] px-1.5 py-0.5 text-[11px] text-[#FF4B33]">
                {d}
              </span>
            ))}
            <span className="ml-auto text-[11px] text-black/35">公告：{merchant.notice?.slice(0, 12) ?? '无'}</span>
          </div>
          {/* 商家入驻：店铺券（可领，进「红包卡券」结算自动可用） */}
          {shopCoupons.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5" data-testid="mt-shop-coupons">
              {shopCoupons.map((c) => {
                const got = claimedCouponIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      if (got || !uid) return;
                      if (mtClaimShopCoupon(uid, c, merchant.name)) {
                        setClaimedCouponIds((p) => [...p, c.id]);
                        onToast('已领取到「红包卡券」，结算时可用');
                      } else {
                        onToast('该券已领过，未使用的在卡券包里');
                      }
                    }}
                    className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 ${got ? 'border-black/10 bg-black/[0.03] text-black/35' : 'border-[#FF4B33]/30 bg-[#FFF0EB] text-[#FF4B33]'} active:opacity-80`}
                  >
                    <span className="text-[13px] font-bold">¥{fmtMoney(c.amount)}</span>
                    <span className="text-[10px] leading-tight">
                      满{fmtMoney(c.min)}可用
                      <br />
                      {c.name} · {got ? '已领取' : '领取'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
      </div>

      {/* 页签（点菜/评价/商家/本店订单） */}
      <div className="mt-0 flex shrink-0 items-center gap-6 px-5">
        {(['点菜', '评价', '商家', '订单'] as const).map((t) => (
          <button key={t} type="button" onClick={() => { merchantTabMemo = t; setTab(t); }} className={`relative py-2 text-[15px] ${tab === t ? 'font-bold text-black/85' : 'text-black/45'}`}>
            {t}
            {t === '订单' && shopOrders.some((o) => ['pendingAccept', 'accepted', 'delivering'].includes(o.status)) && (
              <span className="absolute -right-2.5 top-1 grid h-[14px] min-w-[14px] place-items-center rounded-full bg-[#FF3B30] px-0.5 text-[9px] font-bold text-white">
                {shopOrders.filter((o) => ['pendingAccept', 'accepted', 'delivering'].includes(o.status)).length}
              </span>
            )}
            {tab === t && <span className="absolute -bottom-px left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-full bg-[#FFD100]" />}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      {tab === '点菜' && (
        <div className="flex min-h-0 flex-1">
          <div className="w-[88px] shrink-0 overflow-y-auto bg-[#EDEEF0] pb-28 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {merchant.sections.map((s, i) => (
              <button key={s.cat} type="button" onClick={() => onCatTap(i)} className={`flex w-full flex-col items-center gap-0.5 px-2 py-3.5 text-[12px] leading-tight ${activeCat === i ? 'bg-white font-semibold text-black/85' : 'text-black/50'}`}>
                <span>{s.cat}</span>
                <span className="text-[10px] text-black/35">{s.dishes.length}种</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto bg-white pb-32 px-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {merchant.sections.map((s, i) => (
              <div key={s.cat} ref={(el) => { catRefs.current[i] = el; }} className="scroll-mt-2">
                <p className="py-2.5 text-[14px] font-bold text-black/80">{s.cat}</p>
                {s.dishes.map((d) => (
                  <div key={d.id} className={`flex gap-2.5 py-2 ${d.soldOut ? 'opacity-55' : ''}`}>
                    <span className="relative shrink-0">
                      <button
                        type="button"
                        aria-label="点击生成商品图片"
                        data-testid={`mt-dish-imggen-${d.name}`}
                        onClick={() => setDishGen(d)}
                        className="block active:opacity-85"
                      >
                        <FoodImg src={d.img} emoji={d.emoji} cap={d.name} className="h-[72px] w-[72px] rounded-lg" />
                      </button>
                      <button
                        type="button"
                        aria-label="收藏菜品"
                        onClick={() => onToast(toggle('dishes', d.id) ? '已收藏菜品' : '已取消收藏菜品')}
                        className="absolute right-0.5 top-0.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-black/30 active:scale-90"
                      >
                        <Heart className={`h-3 w-3 ${favs.dishes.includes(d.id) ? 'fill-[#FF2D7E] text-[#FF2D7E]' : 'text-white'}`} strokeWidth={2.4} />
                      </button>
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="flex items-center gap-1 text-[14px] font-medium leading-snug text-black/85">
                        <span className="truncate">{d.name}</span>
                        {d.sig && <span className="shrink-0 rounded bg-[#FFF3B8] px-1 text-[10px] text-[#B77900]">招牌</span>}
                        {d.soldOut && (
                          <span className="shrink-0 rounded bg-black/[0.07] px-1 py-px text-[10px] text-black/45" data-testid={`mt-dish-soldout-${d.name}`}>
                            已售罄
                          </span>
                        )}
                      </p>
                      {d.desc && <p className="mt-0.5 line-clamp-1 text-[11px] text-black/40">{d.desc}</p>}
                      {d.coupon && (
                        <p className="mt-0.5 flex items-center gap-0.5 text-[10px] text-[#FF4B33]" data-testid={`mt-buyer-dish-coupon-${d.name}`}>
                          <Ticket className="h-2.5 w-2.5" />
                          券·{d.coupon.min > 0 ? `满${fmtMoney(d.coupon.min)}` : '无门槛'}减{fmtMoney(d.coupon.amount)}，下单自动抵扣
                        </p>
                      )}
                      <p className="mt-0.5 text-[11px] text-black/35">月售{d.monthSale >= 10000 ? `${(d.monthSale / 10000).toFixed(1)}万` : d.monthSale}</p>
                      <div className="mt-auto flex items-end justify-between pt-1">
                        <span className="text-[16px] font-bold" style={{ color: MT_PRICE }}>
                          <span className="text-[11px]">¥</span>
                          {fmtMoney(d.price)}
                          {d.origPrice && <span className="ml-1 text-[11px] font-normal text-black/30 line-through">¥{fmtMoney(d.origPrice)}</span>}
                        </span>
                        {d.soldOut ? (
                          <span className="rounded-full bg-black/[0.05] px-3 py-1 text-[11px] text-black/35">已售罄</span>
                        ) : (
                          <Stepper qty={qtyOf(d.id)} onAdd={() => add(d)} onDec={() => dec(d)} />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === '评价' && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-white px-4 pb-28 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex items-end gap-2">
            <span className="text-[34px] font-bold leading-none text-[#FF6000]">{merchant.rating}</span>
            <span className="pb-1 text-[12px] text-black/40">综合评分 · 月售{merchant.monthSale >= 10000 ? `${(merchant.monthSale / 10000).toFixed(1)}万` : merchant.monthSale}+</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {['全部({n})', '味道赞', '配送快', '包装好', '分量足'].map((t, i) => (
              <span key={t} className={`rounded-full px-3 py-1.5 text-[12px] ${i === 0 ? 'bg-[#FFF3B8] font-medium text-[#B77900]' : 'bg-[#F5F6F7] text-black/55'}`}>
                {t.replace('({n})', `(${merchant.reviews.length + myReviews.length})`)}
              </span>
            ))}
          </div>
          <div className="mt-4 space-y-4">
            {myReviews.map((r, i) => (
              <div key={`my-${i}`} className="flex gap-2.5 border-b border-black/5 pb-4 last:border-0">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FFF1C0] to-[#FFD100] text-[14px] font-bold text-black/60">{r.user.slice(0, 1)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-black/75">{r.user}</p>
                  <p className="mt-0.5 flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, si) => (
                      <Star key={si} className={`h-3 w-3 ${si < Math.round(r.rating) ? 'fill-[#FF6000] text-[#FF6000]' : 'text-black/15'}`} strokeWidth={1.5} />
                    ))}
                    <span className="ml-1 text-[11px] text-black/30">{r.time}</span>
                  </p>
                  {r.content && <p className="mt-1 text-[13px] leading-relaxed text-black/70">{r.content}</p>}
                  {r.imgs.length > 0 && (
                    <p className="mt-1.5 flex gap-1.5">
                      {r.imgs.map((im, ii) => (
                        <FoodImg key={ii} src={im} className="h-16 w-16 rounded-lg" />
                      ))}
                    </p>
                  )}
                  {r.tags.length > 0 && (
                    <p className="mt-1.5 flex flex-wrap gap-1">
                      {r.tags.map((t) => (
                        <span key={t} className="rounded bg-[#F5F6F7] px-1.5 py-0.5 text-[10px] text-black/45">{t}</span>
                      ))}
                    </p>
                  )}
                  {r.reply && (
                    <p className="mt-1.5 rounded-lg bg-[#FFF7E6] px-2.5 py-1.5 text-[12px] leading-relaxed text-black/60" data-testid={`mt-buyer-reply-${r.orderId}`}>
                      <span className="font-medium text-[#B77900]">商家回复：</span>
                      {r.reply.text}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {merchant.reviews.map((r, i) => (
              <div key={`${r.user}-${i}`} className="flex gap-2.5 border-b border-black/5 pb-4 last:border-0">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FFE0D1] to-[#FFB08A] text-[14px] font-bold text-black/60">{r.user.slice(0, 1)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-black/75">{r.user}</p>
                  <p className="mt-0.5 flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, si) => (
                      <Star key={si} className={`h-3 w-3 ${si < Math.round(r.rating) ? 'fill-[#FF6000] text-[#FF6000]' : 'text-black/15'}`} strokeWidth={1.5} />
                    ))}
                    <span className="ml-1 text-[11px] text-black/30">{r.time}</span>
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-black/70">{r.content}</p>
                  {r.tags && (
                    <p className="mt-1.5 flex flex-wrap gap-1">
                      {r.tags.map((t) => (
                        <span key={t} className="rounded bg-[#F5F6F7] px-1.5 py-0.5 text-[10px] text-black/45">
                          {t}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === '商家' && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-white px-4 pb-28 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="space-y-3.5 text-[13px]">
            {[
              ['商家地址', merchant.addr],
              ['营业时间', merchant.hours],
              ['起送价', `¥${merchant.minOrder}`],
              ['配送费', `¥${merchant.deliveryFee}（满45免配送费）`],
              ['预计送达', `约 ${mtDeliveryMinutesOf(merchant.id)} 分钟`],
              ['商家公告', merchant.notice ?? '暂无公告'],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <span className="w-[64px] shrink-0 text-black/40">{k}</span>
                <span className="flex-1 leading-relaxed text-black/75">{v}</span>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => onToast('已拨打商家电话（演示）')} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full border border-black/10 py-3 text-[14px] text-black/70 active:bg-black/5">
            <PhoneIcon className="h-4 w-4" /> 联系商家
          </button>
        </div>
      )}

      {tab === '订单' && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-white pb-28 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {shopOrders.length === 0 ? (
            <div className="mt-14 text-center">
              <p className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-black/[0.05]">
                <Receipt className="h-6 w-6 text-black/25" />
              </p>
              <p className="mt-3 text-[13px] text-black/40">在本店还没有订单，下一单吧</p>
            </div>
          ) : (
            <div>
              {shopOrders.map((o) => (
                <button key={o.id} type="button" onClick={() => onOpenOrder(o.id)} className="block w-full border-t-[7px] border-[#F5F6F7] px-4 py-3.5 text-left active:opacity-80">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-black/85">{o.items[0] ? stripDealQty(o.items[0].name) : o.merchantName}</span>
                    <span className={`shrink-0 text-[12px] ${['pendingPay', 'pendingAccept', 'accepted', 'delivering'].includes(o.status) ? 'font-medium text-[#FF6000]' : 'text-[#9A9A9A]'}`}>{mtStatusText(o)}</span>
                  </span>
                  <span className="mt-2 flex items-center gap-2.5">
                    <FoodImg src={o.items[0]?.img} emoji={o.items[0]?.emoji ?? o.merchantEmoji} className="h-11 w-11 shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-black/45">{o.items.length > 1 ? `${o.items[0] ? stripDealQty(o.items[0].name) : ''} 等${o.items.reduce((s, i) => s + i.qty, 0)}件商品` : `共${o.items.reduce((s, i) => s + i.qty, 0)}件`}</span>
                    <span className="shrink-0 text-[14px] font-semibold text-black/85">¥{o.total.toFixed(2)}</span>
                  </span>
                  <span className="mt-1.5 block text-[11px] text-black/30">下单：{fmtDateTime(o.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 购物车底栏 */}
      {tab === '点菜' && (
        <div className="relative z-20 shrink-0 px-3 pb-3">
          {cartOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-2 rounded-2xl bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.12)]">
              <div className="flex items-center justify-between border-b border-black/5 px-4 py-2.5">
                <p className="text-[13px] font-semibold text-black/70">已选商品</p>
                <button type="button" onClick={clearCart} className="flex items-center gap-1 text-[12px] text-black/40">
                  <Trash2 className="h-3.5 w-3.5" /> 清空
                </button>
              </div>
              <div className="max-h-52 overflow-y-auto px-4 py-1">
                {cart.items.map((i) => {
                  // 跨店购物车：行按购物车归属商家的菜品解析
                  const d = mtDishesOf(foreignMerchant ?? merchant).find((x) => x.id === i.dishId);
                  if (!d) return null;
                  return (
                    <div key={`${i.dishId}-${i.spec ?? ''}`} className="flex items-center gap-2.5 py-2.5">
                      <FoodImg src={d.img} emoji={d.emoji} className="h-10 w-10 shrink-0 rounded-lg" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-black/80">{d.name}</span>
                        {i.spec && <span className="block truncate text-[11px] text-black/40">{i.spec}</span>}
                      </span>
                      <span className="text-[14px] font-semibold" style={{ color: MT_PRICE }}>
                        ¥{fmtMoney((i.unitPrice ?? d.price) * i.qty)}
                      </span>
                      <Stepper qty={i.qty} onAdd={() => (d.specs?.length ? setSpecDish(d) : add(d))} onDec={() => dec(d)} />
                    </div>
                  );
                })}
                {cart.items.length === 0 && <p className="py-6 text-center text-[12px] text-black/30">购物车是空的</p>}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 rounded-full bg-[#2B2B33] py-2 pl-2 pr-2 shadow-lg">
            <button type="button" aria-label="购物车" onClick={() => setCartOpen((o) => !o)} className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#FFD100] active:opacity-85">
              <ShoppingCart className="h-5 w-5 text-black/80" />
              {(foreignCalc ? foreignCalc.count : calc.count) > 0 && (
                <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#FF4B33] px-1 text-[10px] font-bold text-white">{foreignCalc ? foreignCalc.count : calc.count}</span>
              )}
            </button>
            {foreignMerchant && foreignCalc ? (
              /* 跨店：底栏展示他店购物车 + 一键清空/去他店结算（对齐真机跨店提示） */
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold text-white">¥{fmtMoney(foreignCalc.itemTotal)}</span>
                  <span className="block truncate text-[10px] text-white/45">已选「{foreignMerchant.name.split('（')[0]}」的商品 · 不能合并结算</span>
                </span>
                <button
                  type="button"
                  onClick={clearCart}
                  className="h-11 shrink-0 rounded-full border border-white/25 px-4 text-[13px] text-white/85 active:bg-white/10"
                >
                  清空
                </button>
                <button
                  type="button"
                  onClick={() => onCheckout(foreignMerchant.id)}
                  className="h-11 shrink-0 rounded-full bg-[#FFD100] px-6 text-[15px] font-semibold text-black/90 active:opacity-85"
                >
                  去结算
                </button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-bold text-white">
                    ¥{fmtMoney(calc.itemTotal)}
                    {calc.discount > 0 && <span className="ml-1.5 text-[11px] font-normal text-white/50">已优惠¥{fmtMoney(calc.discount)}</span>}
                  </span>
                  <span className="block text-[10px] text-white/45">{belowMin ? `还差 ¥${fmtMoney(merchant.minOrder - calc.itemTotal)} 起送` : '配送费 ¥' + fmtMoney(calc.deliveryFee) + (calc.itemTotal >= 45 ? '（已免）' : '')}</span>
                </span>
                <button
                  type="button"
                  disabled={belowMin || calc.count === 0 || shopClosed}
                  onClick={() => onCheckout()}
                  className={`h-11 shrink-0 rounded-full px-6 text-[15px] font-semibold ${belowMin || calc.count === 0 || shopClosed ? 'bg-white/15 text-white/40' : 'bg-[#FFD100] text-black/90 active:opacity-85'}`}
                >
                  {shopClosed ? '已打烊' : belowMin && calc.count > 0 ? `¥${fmtMoney(merchant.minOrder)}起送` : '去结算'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 规格/小料选择弹窗（奶茶小料/食物配菜；第三十七轮：菜品图可点生成） */}
      <AnimatePresence>
        {specDish && (
          <DishSpecSheet
            key={`${specDish.id}-${cart.items.reduce((s, i) => s + (i.dishId === specDish.id ? i.qty : 0), 0)}`}
            dish={specDish}
            onClose={() => setSpecDish(null)}
            onConfirm={({ qty, spec, unitPrice }) => addWithSpec(specDish, qty, spec, unitPrice)}
            onGenDish={(d) => setDishGen(d)}
          />
        )}
      </AnimatePresence>

      {/* 店铺头像生成弹层（点头像 → 选模型+自定义提示词） */}
      <OrderImgGenSheet
        open={avatarGenOpen}
        title="生成店铺头像"
        initialPrompt={libPromptTextMulti(['lib:meituan-4'], { name: merchant.name }, `${merchant.name} 店铺头像，可爱手绘印章风格，简洁背景`) ?? ''}
        busy={avatarGenBusy}
        error={avatarGenErr}
        accent="#FF6000"
        submitLabel="生成头像"
        onSubmit={(p, cfg) => void genShopAvatar(p, cfg)}
        onClose={() => (avatarGenBusy ? undefined : setAvatarGenOpen(false))}
      />

      {/* 商品图生成弹层（第三十七轮：点菜品详情图 → 选模型 + 可编辑提示词） */}
      <OrderImgGenSheet
        open={!!dishGen}
        title="生成商品图片"
        initialPrompt={dishGen ? libPromptTextMulti(['lib:meituan-5'], { name: dishGen.name }, `${dishGen.name}，真实感商品照片，明亮色泽，特写构图`) ?? '' : ''}
        busy={dishGenBusy}
        error={dishGenErr}
        accent="#FF6000"
        onSubmit={(p, cfg) => void genDishImg(p, cfg)}
        onClose={() => (dishGenBusy ? undefined : setDishGen(null))}
      />
    </div>
  );
}


// ================================ 地址选择弹层 ================================

function AddressPickerSheet({ uid, onClose, onPicked, onManage }: { uid: string; onClose: () => void; onPicked: (a: MtAddress) => void; onManage: () => void }) {
  const addrs = mtLoadAddresses(uid);
  const cur = mtCurAddrId(uid);
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/45" onClick={onClose}>
      <div className="max-h-[70%] overflow-y-auto rounded-t-2xl bg-white/80 backdrop-blur-2xl backdrop-saturate-150 pb-6" onClick={(e) => e.stopPropagation()}>
        <p className="py-3.5 text-center text-[16px] font-semibold text-black/85">选择收货地址</p>
        <div className="px-4">
          {addrs.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                onPicked(a);
                onClose();
              }}
              className="flex w-full items-center gap-3 rounded-2xl p-3 text-left active:bg-black/[0.03]"
            >
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${a.id === cur ? 'bg-[#FFC300]' : 'border border-black/20'}`}>
                {a.id === cur && <Check className="h-3.5 w-3.5 text-black/80" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="rounded bg-[#FFF3B8] px-1 text-[10px] text-[#B77900]">{a.tag}</span>
                  <span className="text-[14px] font-medium text-black/85">{a.name}</span>
                  <span className="text-[12px] text-black/40">{a.phone}</span>
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-black/50">{a.text}</span>
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            onManage();
            onClose();
          }}
          className="mx-4 mt-2 flex h-11 items-center justify-center gap-1 rounded-full bg-[#F5F6F7] text-[14px] text-black/70 active:opacity-75"
        >
          <MapPin className="h-4 w-4" /> 管理收货地址
        </button>
      </div>
    </div>
  );
}

// ================================ 支付收银台（对齐真机截图：订单 / 倒计时 / 美团支付绿卡 / 其他支付方式 / 确认交易） ================================

/** 美团支付「工商银行储蓄卡」立减金额（最优惠） */

export const ICBC_OFF = 2.28;


function PayPage({
  order,
  session,
  onClose,
  onPaid,
  onProxySent,
  onOpenWallet,
  onToast,
}: {
  order: MtOrder;
  session: MtSession;
  onClose: () => void;
  onPaid: (o: MtOrder) => void;
  /** 代付请求已发出（关收银台 → 回订单列表待付款页签） */
  onProxySent: () => void;
  /** 去美团钱包（收银台跳转：开通/充值余额/添加银行卡） */
  onOpenWallet: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  // 美团支付（真实钱包数据）：余额 + 银行卡列表，与 微信/QQ 渠道二选一
  const [wallet, setWallet] = useState(() => mtLoadWallet(uid));
  const [cards, setCards] = useState(() => mtLoadBankCards(uid));
  // 购药抵扣金（看病买药商家订单可用，自动抵扣）
  const [fund, setFund] = useState(() => mtLoadDrugFund(uid));
  const [useDrug, setUseDrug] = useState(true);
  // selMt: 'balance'=美团余额 / 银行卡id / null=未选（替代旧的演示 selBank）
  const [selMt, setSelMt] = useState<'balance' | string | null>(null);
  // 余额/银行卡支付密码验证浮层（开启美团支付密码后，美团支付前先验证）
  const [pwdGate, setPwdGate] = useState<null | 'balance' | 'card'>(null);
  // 微信/QQ 渠道支付密码验证浮层（对应 App 开启了支付密码时：美团里用微信支付验微信密码，QQ 同理，三者相互独立）
  const [idpGate, setIdpGate] = useState<'wx' | 'qq' | null>(null);
  const [idp, setIdp] = useState<'wx' | 'qq' | null>(null);
  const [chans, setChans] = useState<MtPayChannel[] | null>(null);
  const [chanKey, setChanKey] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'processing' | 'fail'>('idle');
  const [err, setErr] = useState('');
  const [tried, setTried] = useState(0);
  const [, tick] = useState(0);
  // 找人代付：plat = 选平台 / contact = 选好友；null = 关闭
  const [proxyStep, setProxyStep] = useState<'plat' | 'contact' | null>(null);
  const [proxyPlat, setProxyPlat] = useState<'wx' | 'qq' | null>(null);
  const [proxyContact, setProxyContact] = useState<string | null>(null);
  const [proxySending, setProxySending] = useState(false);

  // 待支付倒计时（15 分钟，对齐真机「交易剩余时间」）
  useEffect(() => {
    const iv = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  const leftMs = Math.max(0, order.createdAt + PAY_TIMEOUT_MS - Date.now());
  const countdown = `${String(Math.floor(leftMs / 60000)).padStart(2, '0')}:${String(Math.floor((leftMs % 60000) / 1000)).padStart(2, '0')}`;

  // 选中工商银行储蓄卡 → 立减（其余方式原价）；余额/其他卡按原价
  const selCard = selMt && selMt !== 'balance' ? (cards.find((c) => c.id === selMt) ?? null) : null;
  const icbcOff = selCard?.bank === '中国工商银行' ? Math.min(ICBC_OFF, order.total) : 0;
  // 购药抵扣金：看病买药商家 + 已激活且有余额 → 自动抵扣（最多抵到 0.01 元）
  const isPharmacy = mtMerchantOf(order.merchantId)?.cats.includes('maiyao') ?? false;
  const drugAvail = fund.activated && fund.balance > 0 ? fund.balance : 0;
  const drugOff = isPharmacy && drugAvail > 0 && useDrug ? Math.min(drugAvail, Math.max(0, Math.round((order.total - icbcOff - 0.01) * 100) / 100)) : 0;
  const payAmount = Math.max(0.01, Math.round((order.total - icbcOff - drugOff) * 100) / 100);
  /** 各卡需覆盖的金额（工行卡按立减后口径，抵扣金对全部方式生效） */
  const cardNeed = (c: MtBankCard) =>
    Math.max(0.01, Math.round((order.total - (c.bank === '中国工商银行' ? Math.min(ICBC_OFF, order.total) : 0) - drugOff) * 100) / 100);
  const balanceOk = wallet.balance >= payAmount;
  /** 支付成功后核销抵扣金（记一笔使用明细） */
  const consumeDrugFund = () => {
    if (drugOff <= 0) return;
    mtUseDrugFund(uid, drugOff, `购药抵扣 · ${order.merchantName}`);
    setFund(mtLoadDrugFund(uid));
  };

  // 展开微信/QQ → 拉取渠道（余额/额度预检）；展开时自动选中首个可用渠道（对齐真机）
  useEffect(() => {
    if (!idp) {
      setChans(null);
      return;
    }
    let alive = true;
    setChans(null);
    mtListPayChannels(idp, order.total)
      .then((c) => {
        if (!alive) return;
        setChans(c);
        setChanKey((k) => (k && c.some((x) => x.key === k) ? k : (c.find((x) => !x.insufficient)?.key ?? null)));
      })
      .catch(() => alive && setChans([]));
    return () => {
      alive = false;
    };
  }, [idp, order.total]);

  /** 选美团支付方式（余额/某张银行卡；可再点取消选中） */
  const pickMt = (v: 'balance' | string) => {
    if (state === 'processing') return;
    setErr('');
    setState('idle');
    setSelMt((cur) => (cur === v ? null : v));
    setChanKey(null);
  };

  const toggleIdp = (v: 'wx' | 'qq') => {
    if (state === 'processing') return;
    setErr('');
    setState('idle');
    setIdp((cur) => (cur === v ? null : v));
    setSelMt(null);
    setChanKey(null);
  };

  const chan = chans?.find((c) => c.key === chanKey) ?? null;
  const chanOfIdp = (v: 'wx' | 'qq') => (idp === v ? chan : null);

  /** 统一收尾：写订单已支付（+余额支付账单）→ 回调跳详情；mtMethod 留痕原路退回渠道 */
  const finishPay = (label: string, off: number, walletDeduct?: number, mtMethod?: string) => {
    const now = Date.now();
    const tuangouDone = order.kind === 'tuangou';
    const paid: MtOrder = {
      ...order,
      total: Math.max(0.01, Math.round((order.total - off) * 100) / 100),
      discount: Math.round((order.discount + off) * 100) / 100,
      status: tuangouDone ? 'completed' : 'pendingAccept',
      paidAt: now,
      // 团购单：支付后=待使用（券码页出示券码核销）
      ...(tuangouDone ? {} : { etaAt: now + mtDeliveryMinutesOf(order.id) * 60_000 }),
      payChannelLabel: label,
      // 美团钱包支付：记 payIdp='mt' + payMethodId（退款原路退回用）
      ...(mtMethod ? { payIdp: 'mt' as const, payMethodId: mtMethod } : {}),
      statusLog: [...order.statusLog, { status: tuangouDone ? 'completed' : 'pendingAccept', at: now }],
    };
    mtSaveOrders(order.uid, mtLoadOrders(order.uid).map((o) => (o.id === order.id ? paid : o)));
    // 商家接单通知：订单落在机主自己的店铺 → 灵动岛提醒商家（幂等，未支付不提醒）
    mtNotifyShopOrderPaid(paid);
    // B4：机主直接付掉了 → 该单挂着的 pending 代付请求失效（「机主已自行支付」），卡片/详情同步
    try {
      if (mtSyncProxiesForUid(order.uid)) window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    } catch {
      /* 忽略 */
    }
    if (typeof walletDeduct === 'number') {
      // 余额支付 → 钱包账单记一笔消费（卡支付已在扣款处记账）
      mtPushWalletBill(uid, { kind: 'pay', title: '消费', amount: -walletDeduct, at: Date.now(), card: `${order.merchantName} · 美团余额` });
    }
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    onToast(off > 0 ? `支付成功，已立减${fmtMoney(off)}元` : '支付成功');
    onPaid(paid);
  };

  /** 美团支付·余额扣款（真实扣美团钱包余额；支付密码验证后调用） */
  const payWithBalance = async () => {
    setErr('');
    setState('processing');
    await new Promise((r) => setTimeout(r, 1100));
    const randomFail = tried === 0 && Math.random() < 0.12;
    setTried((t) => t + 1);
    if (randomFail) {
      setErr('网络异常，支付失败，请重试');
      setState('fail');
      return;
    }
    const cur = mtLoadWallet(uid);
    if (cur.balance < payAmount) {
      setWallet(cur);
      setErr('余额不足，请先充值或更换支付方式');
      setState('fail');
      return;
    }
    mtSaveWallet(uid, { balance: Math.round((cur.balance - payAmount) * 100) / 100 });
    setWallet(mtLoadWallet(uid));
    consumeDrugFund();
    finishPay(`美团支付 · 余额${drugOff > 0 ? '（抵扣金已抵）' : ''}`, icbcOff + drugOff, payAmount, 'mt-balance');
  };

  /** 美团支付·银行卡扣款（真实扣卡内余额；工行卡享立减） */
  const payWithCard = async (card: MtBankCard) => {
    setErr('');
    setState('processing');
    await new Promise((r) => setTimeout(r, 1100));
    const randomFail = tried === 0 && Math.random() < 0.12;
    setTried((t) => t + 1);
    if (randomFail) {
      setErr('网络异常，支付失败，请重试');
      setState('fail');
      return;
    }
    const off = card.bank === '中国工商银行' ? Math.min(ICBC_OFF, order.total) : 0;
    const amt = cardNeed(card);
    const cur = mtLoadBankCards(uid).find((c) => c.id === card.id);
    if (!cur || cur.balance < amt) {
      setCards(mtLoadBankCards(uid));
      setErr('卡内余额不足，请更换支付方式');
      setState('fail');
      return;
    }
    mtSaveBankCards(
      uid,
      mtLoadBankCards(uid).map((c) => (c.id === card.id ? { ...c, balance: Math.round((c.balance - amt) * 100) / 100 } : c))
    );
    setCards(mtLoadBankCards(uid));
    mtPushWalletBill(uid, { kind: 'pay', title: '消费', amount: -amt, at: Date.now(), card: `${card.bank} 尾号${card.tail}` });
    consumeDrugFund();
    finishPay(`美团支付 · ${card.bank}尾号${card.tail}${off + drugOff > 0 ? `（已优惠${fmtMoney(off + drugOff)}元）` : ''}`, off + drugOff, undefined, `mt-card:${card.id}`);
  };

  const confirm = async () => {
    if (state === 'processing') return;
    if (selMt === 'balance') {
      // 美团支付·余额：开启支付密码 → 先验证再扣款
      if (mtLoadPayPwd(uid).enabled) {
        setPwdGate('balance');
        return;
      }
      await payWithBalance();
      return;
    }
    if (selMt && selMt !== 'balance') {
      const card = cards.find((c) => c.id === selMt);
      if (card) {
        // 美团支付·银行卡：开启支付密码同样先验证（美团支付密码独立于微信/QQ）
        if (mtLoadPayPwd(uid).enabled) {
          setPwdGate('card');
          return;
        }
        await payWithCard(card);
        return;
      }
    }
    if (chan) {
      // 独立支付密码：用微信支付 → 校验微信支付密码；用QQ支付 → 校验QQ支付密码
      // （三者相互独立：微信设 123456 就输 123456，美团设 000000 互不影响）
      if (chan.idp === 'wx' && wxLoadPayPwd().enabled) {
        setIdpGate('wx');
        return;
      }
      if (chan.idp === 'qq' && qqLoadPayPwd().enabled) {
        setIdpGate('qq');
        return;
      }
      await payViaChannel();
      return;
    }
    onToast('请先选择支付方式');
  };

  /** 微信/QQ 渠道扣款（支付密码验证后调用；扣 payAmount=抵扣金后金额，资金走对应 App 钱包） */
  const payViaChannel = async () => {
    if (!chan) return;
    setErr('');
    setState('processing');
    await new Promise((r) => setTimeout(r, 1100));
    const randomFail = tried === 0 && Math.random() < 0.12;
    setTried((t) => t + 1);
    const res = await mtExecutePay(chan.idp, chan, payAmount, order.merchantName, randomFail);
    if (!res.ok) {
      setErr(res.error ?? '支付失败，请重试');
      setState('fail');
      return;
    }
    const now = Date.now();
    const tuangouDone = order.kind === 'tuangou';
    const paid: MtOrder = {
      ...order,
      total: Math.max(0.01, Math.round((order.total - drugOff) * 100) / 100),
      discount: Math.round((order.discount + drugOff) * 100) / 100,
      status: tuangouDone ? 'completed' : 'pendingAccept',
      paidAt: now,
      // 团购单：支付后=待使用（券码页出示券码核销）
      ...(tuangouDone ? {} : { etaAt: now + mtDeliveryMinutesOf(order.id) * 60_000 }),
      payIdp: chan.idp,
      payChannelLabel: `${chan.idp === 'wx' ? '微信' : 'QQ'}${chan.isFc ? '亲属卡' : ''} · ${chan.label}`,
      payFc: chan.isFc === true,
      payMethodId: chan.methodId,
      payFcParts: res.fc ? res.fc.parts.map((p) => ({ cardInId: p.cardInId, amount: p.amount })) : undefined,
      statusLog: [...order.statusLog, { status: tuangouDone ? 'completed' : 'pendingAccept', at: now }],
    };
    mtSaveOrders(order.uid, mtLoadOrders(order.uid).map((o) => (o.id === order.id ? paid : o)));
    // 商家接单通知：订单落在机主自己的店铺 → 灵动岛提醒商家（幂等，未支付不提醒）
    mtNotifyShopOrderPaid(paid);
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    consumeDrugFund();
    if (res.fc) onToast(`已用${res.fc.parts[0]?.giverName ?? '亲属卡'}支付 ¥${fmtMoney(res.fc.total)}`);
    else onToast(drugOff > 0 ? `支付成功，抵扣金已抵¥${fmtMoney(drugOff)}` : '支付成功');
    onPaid(paid);
  };

  /** 发送代付请求：生成请求 + 卡片进好友聊天 + 关收银台回订单列表 */
  const sendProxy = async () => {
    if (!proxyPlat || !proxyContact || proxySending) return;
    setProxySending(true);
    await new Promise((r) => setTimeout(r, 650));
    const res = await mtCreateProxyRequest({
      order,
      idp: proxyPlat,
      contactId: proxyContact,
      fromName: session.name,
      fromAvatar: session.avatar,
    });
    setProxySending(false);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    setProxyStep(null);
    onToast(`代付请求已发给${res.proxy.contactName}，等TA付款`);
    onProxySent();
  };

  const Radio = ({ on }: { on: boolean }) => (
    <span className={`grid h-[21px] w-[21px] shrink-0 place-items-center rounded-full ${on ? 'bg-[#FFC300]' : 'border-[1.5px] border-black/15'}`}>
      {on && <Check className="h-3.5 w-3.5 text-black/80" strokeWidth={3.2} />}
    </span>
  );

  const chanIcon = (c: MtPayChannel) => {
    if (c.isFc) return <Users className="h-[17px] w-[17px] text-[#FF6000]" strokeWidth={2} />;
    if (c.methodId === 'balance') return <Wallet className={`h-[17px] w-[17px] ${c.idp === 'wx' ? 'text-[#06C160]' : 'text-[#12B7F5]'}`} strokeWidth={2} />;
    return <CreditCard className="h-[17px] w-[17px] text-black/55" strokeWidth={2} />;
  };

  return (
    <motion.div className="absolute inset-0 z-50 flex flex-col bg-white" initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 24, opacity: 0 }} transition={{ duration: 0.18 }}>
      {/* 顶栏：返回 + 居中「订单」 */}
      <div className="relative grid h-[100px] shrink-0 place-items-center border-b border-black/[0.04] pt-[50px]">
        <button type="button" aria-label="返回" onClick={onClose} className="absolute left-1 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-[24px] w-[24px] text-black/85" strokeWidth={2.2} />
        </button>
        <p className="text-[20px] font-semibold text-black/90">订单</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* 倒计时 + 金额 */}
        <p className="mt-3 text-center text-[15px] text-black/50">交易剩余时间 {countdown}</p>
        <p className="mt-1 text-center text-[42px] font-bold leading-tight tracking-tight text-black/90">
          <span className="text-[26px]">¥</span>
          {payAmount.toFixed(2)}
        </p>

        {/* 支付方式：美团支付（真实钱包：余额 + 银行卡列表，资金真实扣减） */}
        <div className="mt-4 border-t-[7px] border-[#F5F6F7] px-4 pt-3">
          <div className="flex items-center gap-2 pb-1">
            <span className="grid h-[26px] w-[26px] place-items-center rounded-[8px] bg-gradient-to-br from-[#FFD100] to-[#FFB800] shadow-sm">
              <Zap className="h-[15px] w-[15px] fill-white text-white" strokeWidth={0} />
            </span>
            <span className="text-[17px] font-bold text-black/90">美团支付</span>
            <span className="ml-auto flex items-center gap-1 text-[12px] font-medium text-[#3D8B37]">
              美团账户安全保障中
              <Leaf className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
          </div>
          <div>
            {/* 使用余额（美团钱包余额；不足灰显拦截） */}
            <button
              type="button"
              onClick={() => (balanceOk ? pickMt('balance') : onToast('余额不足，可去钱包用银行卡充值后再试'))}
              className={`flex w-full items-center gap-2.5 py-[13px] text-left ${balanceOk ? 'active:opacity-80' : 'opacity-60'}`}
            >
              <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-[#FFF6D9]">
                <Wallet className="h-[14px] w-[14px] text-[#C8860D]" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] text-black/85">使用余额</span>
                <span className="block text-[10.5px] text-black/40">可用余额 ¥{mtW2(wallet.balance)}</span>
              </span>
              {!balanceOk && <span className="shrink-0 text-[11px] text-[#FF4B33]">余额不足</span>}
              <Radio on={selMt === 'balance'} />
            </button>
            {/* 购药抵扣金（看病买药订单可用；已激活有余额时展示，可切换是否抵扣） */}
            {isPharmacy && fund.activated && fund.balance > 0 && (
              <button type="button" data-testid="pay-drugfund" onClick={() => setUseDrug((v) => !v)} className="flex w-full items-center gap-2.5 border-t border-black/[0.05] py-[13px] text-left active:opacity-80">
                <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-[#E5F8EE]">
                  <Cross className="h-[14px] w-[14px] text-[#00A860]" strokeWidth={2.4} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-black/85">购药抵扣金</span>
                  <span className="block text-[10.5px] text-black/40">可用 ¥{mtW2(fund.balance)} · 本单抵扣 ¥{fmtMoney(drugOff)}</span>
                </span>
                <Radio on={useDrug} />
              </button>
            )}
            {/* 银行卡（真实钱包卡列表；工行卡最优惠立减） */}
            {cards.map((c) => {
              const meta = mtBankMeta(c.bank);
              const ok = c.balance >= cardNeed(c);
              const icbc = c.bank === '中国工商银行';
              return (
                <div key={c.id} className="border-t border-black/[0.05]">
                  <button
                    type="button"
                    onClick={() => (ok ? pickMt(c.id) : onToast('卡内余额不足，请更换支付方式'))}
                    className={`flex w-full items-center gap-2.5 py-[13px] text-left ${ok ? 'active:opacity-80' : 'opacity-60'}`}
                  >
                    <span className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] bg-gradient-to-br ${meta.grad} text-[11px] font-bold text-white shadow-sm`}>
                      {meta.short}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] text-black/85">{c.bank}（尾号{c.tail}）</span>
                      <span className="block text-[10.5px] text-black/40">卡内余额 ¥{mtW2(c.balance)}</span>
                    </span>
                    {icbc && ok && (
                      <span className="ml-auto flex shrink-0 items-center gap-2">
                        <span className="rounded-[4px] bg-[#FF4B33] px-1 py-px text-[10px] font-semibold text-white">最优惠</span>
                        <span className="text-[15px] font-medium text-[#FF4B33]">- ¥ {fmtMoney(Math.min(ICBC_OFF, order.total))}</span>
                      </span>
                    )}
                    {!ok && <span className="ml-auto shrink-0 text-[11px] text-[#FF4B33]">余额不足</span>}
                    <Radio on={selMt === c.id} />
                  </button>
                </div>
              );
            })}
            <div className="border-t border-black/[0.05]" />
            {/* 去钱包：充值余额 / 添加银行卡 */}
            <button type="button" onClick={onOpenWallet} className="flex w-full items-center gap-1.5 py-[13px] text-left active:opacity-70">
              <Plus className="h-4 w-4 shrink-0 text-black/40" strokeWidth={2.2} />
              <span className="min-w-0 flex-1 truncate text-[15px] text-black/50">
                {cards.length === 0 && wallet.balance <= 0 ? '开通美团钱包：充值余额或添加银行卡' : '管理余额与银行卡'}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-black/25" />
            </button>
            <div className="border-t border-black/[0.05]" />
            <button type="button" onClick={() => onToast('更多绑卡优惠即将上线，敬请期待')} className="flex w-full items-center gap-1 py-[13px] text-left active:opacity-70">
              <span className="text-[15px] text-black/50">查看更多绑卡优惠</span>
            </button>
          </div>
        </div>

        {/* 其他支付方式：微信 / QQ（点行展开渠道） */}
        <div className="border-t-[7px] border-[#F5F6F7] px-4 pt-3">
          <p className="pb-2 text-[15px] text-black/50">其他支付方式</p>
          {(
            [
              ['wx', '/icons/wechat.png', '微信支付'],
              ['qq', '/icons/qq.png', 'QQ支付'],
            ] as ['wx' | 'qq', string, string][]
          ).map(([v, img, name], i) => {
            const cur = chanOfIdp(v);
            return (
              <div key={v} className={i > 0 ? 'border-t border-black/[0.05]' : ''}>
                <button type="button" onClick={() => toggleIdp(v)} className="flex w-full items-center gap-3 py-[13px] text-left active:opacity-80">
                  <img src={img} alt="" className="h-[28px] w-[28px] shrink-0 rounded-[7px]" />
                  <span className="flex-1 text-[15px] font-medium text-black/85">{name}</span>
                  <Radio on={Boolean(cur)} />
                </button>
                {/* 展开的渠道列表（缩进，微信：零钱/银行卡/亲属卡；QQ：余额/银行卡） */}
                {idp === v && (
                  <div className="pb-1.5 pl-[40px]">
                    {chans === null ? (
                      <p className="py-3 text-[12px] text-black/35">正在获取支付渠道…</p>
                    ) : chans.length === 0 ? (
                      <p className="py-3 text-[12px] text-black/35">该支付方式暂无可用渠道，请更换</p>
                    ) : (
                      chans.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => {
                            if (c.insufficient) {
                              onToast(c.isFc ? '亲属卡本月额度不足，请切换其他支付方式' : '该渠道余额不足，请更换支付方式');
                              return;
                            }
                            setSelMt(null);
                            setChanKey(c.key);
                            setErr('');
                            setState('idle');
                          }}
                          className={`flex w-full items-center gap-2.5 border-t border-black/[0.04] py-2.5 text-left ${c.insufficient ? 'opacity-45' : 'active:opacity-70'}`}
                        >
                          <span className="grid h-[22px] w-[22px] shrink-0 place-items-center">{chanIcon(c)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] text-black/85">{c.label}</span>
                            <span className="block text-[10.5px] text-black/40">{c.sub}</span>
                          </span>
                          {c.insufficient ? (
                            <span className="shrink-0 text-[11px] text-[#FF4B33]">{c.isFc ? '额度不足' : '余额不足'}</span>
                          ) : (
                            <Radio on={chanKey === c.key} />
                          )}
                        </button>
                      ))
                    )}
                    {v === 'wx' && <p className="border-t border-black/[0.04] py-2 text-[10.5px] leading-relaxed text-black/30">使用亲属卡支付将由赠卡人买单，消费后赠卡人会收到通知</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 找人代付（发给微信/QQ好友帮付） */}
        <div className="border-t-[7px] border-[#F5F6F7] px-4 pt-3">
          <p className="pb-2 text-[15px] text-black/50">帮付</p>
          <button
            type="button"
            data-testid="pay-proxy-entry"
            onClick={() => {
              if (state === 'processing') return;
              setProxyPlat(null);
              setProxyContact(null);
              setErr('');
              setProxyStep('plat');
            }}
            className="flex w-full items-center gap-3 py-[13px] text-left active:opacity-80"
          >
            <span className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-[7px] bg-gradient-to-br from-[#FFC300] to-[#FF9500]">
              <HandCoins className="h-[16px] w-[16px] text-white" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-black/85">找人代付</span>
              <span className="block text-[10.5px] text-black/40">发给微信/QQ好友，帮你支付本单</span>
            </span>
            {order.proxy && (
              <span className="shrink-0 rounded-full bg-[#FFF0EB] px-2 py-1 text-[10px] font-medium text-[#FF6000]">已请{order.proxy.name}代付</span>
            )}
          </button>
          {order.proxy && (
            <p className="border-t border-black/[0.04] py-2 text-[10.5px] leading-relaxed text-black/30">
              已向{order.proxy.name}发送代付请求，好友付款后本单自动完成；也可以继续自己支付。
            </p>
          )}
        </div>

        <p className="px-2 pb-1 pt-3.5 text-center text-[11px] leading-relaxed text-black/30">支付结果以商家订单为准 · 资金由微信支付/QQ钱包保障</p>
      </div>

      {/* 底部：立减横幅 + 确认交易 */}
      <div className="shrink-0 border-t border-white/60 bg-white/80 backdrop-blur-2xl backdrop-saturate-150 px-3.5 pb-[max(12px,env(safe-area-inset-bottom))] pt-1.5">
        <div className="mt-1 flex items-center gap-3 bg-[#FFF6D8] px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold text-black/85">
              使用工商银行储蓄卡立减 <span className="text-[#FF4B33]">2.28</span> 元
            </p>
            <p className="mt-0.5 text-[11px] text-black/40">美团支付限时专享福利</p>
          </div>
          <button type="button" onClick={() => onToast('已领取，支付时自动抵扣')} className="shrink-0 rounded-full bg-gradient-to-r from-[#FF5A3C] to-[#FF3B6B] px-4 py-2 text-[13px] font-semibold text-white active:opacity-85">
            去领取
          </button>
        </div>
        {state === 'fail' && <p className="mt-2 flex items-center justify-center gap-1 text-[12px] text-[#FF4B33]"><TriangleAlert className="h-3.5 w-3.5" />{err}</p>}
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={!selMt && !chan}
          className={`mt-2.5 h-[52px] w-full rounded-[26px] text-[17px] font-bold active:opacity-85 ${selMt || chan ? 'bg-[#FFD100] text-black/90 shadow-[0_4px_14px_rgba(255,190,0,0.35)]' : 'bg-[#F6EC9F] text-black/40'}`}
        >
          {state === 'processing' ? '正在支付…' : state === 'fail' ? '重新支付' : '确认交易'}
        </button>
      </div>

      {/* 找人代付弹层（选平台 → 选好友 → 发送请求） */}
      <AnimatePresence>
        {proxyStep && (
          <ProxySheet
            key={proxyStep}
            step={proxyStep}
            plat={proxyPlat}
            contactId={proxyContact}
            sending={proxySending}
            onPickPlat={(v) => {
              setProxyPlat(v);
              setProxyContact(null);
              setProxyStep('contact');
            }}
            onPickContact={setProxyContact}
            onBack={() => (proxyStep === 'contact' ? setProxyStep('plat') : setProxyStep(null))}
            onClose={() => setProxyStep(null)}
            onSend={() => void sendProxy()}
          />
        )}
      </AnimatePresence>

      {/* 美团支付密码验证浮层（余额/银行卡支付时；美团密码独立于微信/QQ） */}
      {pwdGate && (
        <MtPayPwdGate
          uid={uid}
          label={`支付 ¥${fmtMoney(payAmount)}`}
          onOk={() => {
            const kind = pwdGate;
            setPwdGate(null);
            if (kind === 'balance') void payWithBalance();
            else if (kind === 'card' && selCard) void payWithCard(selCard);
          }}
          onClose={() => setPwdGate(null)}
        />
      )}

      {/* 微信支付密码验证浮层（微信 App 里开启了支付密码时：美团用微信支付验微信的密码） */}
      {idpGate === 'wx' && (
        <WxPayPwdGate
          label={`向美团支付 ¥${fmtMoney(payAmount)}`}
          onOk={() => {
            setIdpGate(null);
            void payViaChannel();
          }}
          onClose={() => setIdpGate(null)}
        />
      )}

      {/* QQ支付密码验证浮层（QQ App 里开启了支付密码时：美团用QQ支付验QQ的密码） */}
      {idpGate === 'qq' && (
        <QqPayPwdGate
          label={`向美团支付 ¥${fmtMoney(payAmount)}`}
          onOk={() => {
            setIdpGate(null);
            void payViaChannel();
          }}
          onClose={() => setIdpGate(null)}
        />
      )}
    </motion.div>
  );
}

/** 找人代付弹层：第一步选平台（微信/QQ好友），第二步选联系人 → 发送代付请求（卡片进好友聊天） */

export function ProxySheet({
  step,
  plat,
  contactId,
  sending,
  onPickPlat,
  onPickContact,
  onBack,
  onClose,
  onSend,
}: {
  step: 'plat' | 'contact';
  plat: 'wx' | 'qq' | null;
  contactId: string | null;
  sending: boolean;
  onPickPlat: (v: 'wx' | 'qq') => void;
  onPickContact: (id: string) => void;
  onBack: () => void;
  onClose: () => void;
  onSend: () => void;
}) {
  /** 平台好友列表（第二步加载；kind!=='user' 且该平台好友标记为真；组件按 step 重建，进入即为 null） */
  const [friends, setFriends] = useState<ContactRecord[] | null>(null);
  useEffect(() => {
    if (step !== 'contact' || !plat) return;
    let alive = true;
    listContacts()
      .then((all) => {
        if (alive) setFriends(all.filter((c) => c.kind !== 'user' && isFriendIn(c, plat)));
      })
      .catch(() => {
        if (alive) setFriends([]);
      });
    return () => {
      alive = false;
    };
  }, [step, plat]);

  const platName = plat === 'wx' ? '微信' : 'QQ';
  const Radio = ({ on }: { on: boolean }) => (
    <span className={`grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full border-2 ${on ? 'border-[#FFC300] bg-[#FFC300]' : 'border-black/20'}`}>
      {on && <Check className="h-3 w-3 text-black/75" strokeWidth={3.4} />}
    </span>
  );
  return (
    <motion.div
      className="absolute inset-0 z-[70] flex flex-col justify-end bg-black/45"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={onClose}
    >
      <motion.div
        className="max-h-[82%] overflow-y-auto rounded-t-3xl bg-white/80 backdrop-blur-2xl backdrop-saturate-150 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 shadow-2xl"
        initial={{ y: 260 }}
        animate={{ y: 0 }}
        exit={{ y: 260 }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 拖拽条 + 左对齐标题/副标题（与情侣空间邀请弹层同款结构） */}
        <div className="mx-auto h-1 w-10 rounded-full bg-[#e0e0e5]" />
        <div className="mt-3 text-[17px] font-bold text-[#26262b]">{step === 'contact' && plat ? `选择${platName}好友` : '找人代付'}</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[#9a9aa2]">
          {step === 'plat' ? '把订单发给好友，TA付款后订单自动完成；15分钟内未付款订单自动取消' : `从${platName}好友里选一位帮忙支付本单`}
        </p>

        {step === 'plat' ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {([
              ['wx', '/icons/wechat.png', '通过微信发送'],
              ['qq', '/icons/qq.png', '通过QQ发送'],
            ] as ['wx' | 'qq', string, string][]).map(([v, img, name]) => (
              <button
                key={v}
                type="button"
                data-testid={`proxy-plat-${v}`}
                onClick={() => onPickPlat(v)}
                className="flex h-14 items-center justify-center gap-2 rounded-xl bg-[#f6f6f8] text-[14px] font-medium text-[#3a3a40] transition-colors active:bg-[#eeeef0]"
              >
                <img src={img} alt="" className="h-6 w-6 rounded-md object-cover" />
                {name}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-4 max-h-[44vh] space-y-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {friends === null ? (
              <p className="py-8 text-center text-[12px] text-black/35">正在获取好友列表…</p>
            ) : friends.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-[13px] text-black/45">暂无{platName}好友</p>
                <p className="mt-1 text-[11px] text-black/30">先去{platName}App添加好友，再回来发起代付</p>
              </div>
            ) : (
              friends.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`proxy-contact-${c.id}`}
                  onClick={() => onPickContact(c.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${contactId === c.id ? 'bg-[#FFF8DF]' : 'active:bg-[#f6f6f8]'}`}
                >
                  {avatarFor(c, plat ?? 'wx') ? (
                    <img src={avatarFor(c, plat ?? 'wx') ?? ''} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#FFF3B8] text-[15px] font-semibold text-black/60">
                      {displayNameOf(c).slice(0, 1)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] text-[#26262b]">{displayNameOf(c)}</span>
                    {c.relation && <span className="block text-[11px] text-black/40">{c.relation}</span>}
                  </span>
                  <Radio on={contactId === c.id} />
                </button>
              ))
            )}
          </div>
        )}

        {/* 底部按钮 */}
        <div className="mt-4 flex gap-3">
          {step === 'contact' && (
            <button
              type="button"
              aria-label="返回上一步"
              onClick={onBack}
              className="h-12 w-[86px] shrink-0 rounded-2xl bg-[#f0f0f3] text-[15px] font-medium text-[#5a5a62] active:bg-[#e8e8ec]"
            >
              上一步
            </button>
          )}
          {step === 'plat' ? (
            <button
              type="button"
              disabled={!plat}
              onClick={() => plat && onPickPlat(plat)}
              className={`h-12 flex-1 rounded-2xl text-[15.5px] font-semibold ${plat ? 'bg-[linear-gradient(135deg,#ffd100,#ffb62e)] text-black/85 shadow-[0_5px_14px_rgba(255,182,46,0.35)] active:opacity-85' : 'bg-[#f6ec9f] text-black/40'}`}
            >
              下一步
            </button>
          ) : (
            <button
              type="button"
              data-testid="proxy-send"
              disabled={!contactId || sending}
              onClick={onSend}
              className={`h-12 flex-1 rounded-2xl text-[15.5px] font-semibold ${contactId && !sending ? 'bg-[linear-gradient(135deg,#ffd100,#ffb62e)] text-black/85 shadow-[0_5px_14px_rgba(255,182,46,0.35)] active:opacity-85' : 'bg-[#f6ec9f] text-black/40'}`}
            >
              {sending ? '正在发送…' : '发送代付请求'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/** 分享图标（箭头式，简约）：向上箭头穿出圆角托盘（iOS 分享语义）；
 *  纯线条无杂饰，替换原 Share2 三点盒（用户要求「变成箭头一样的，简约」） */


// ================================ 外卖确认订单弹窗（截图7 弹窗式，非独立页面） ================================

function CheckoutSheet({
  session,
  merchant,
  onClose,
  onOpenPay,
  onPickAddress,
  onToast,
}: {
  session: MtSession;
  merchant: MtMerchant;
  onClose: () => void;
  onOpenPay: (o: MtOrder) => void;
  onPickAddress: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const addrs = mtLoadAddresses(uid);
  const [addrId, setAddrId] = useState(() => mtCurAddrId(uid) || addrs[0]?.id || '');
  const cur = addrs.find((a) => a.id === addrId) ?? addrs[0];
  const cart = mtLoadCart(uid);
  const calc = mtCheckoutCalc(uid, merchant, cart);
  const [note, setNote] = useState('');
  // 优惠券（外卖券，达门槛可用）
  const [selCoupon, setSelCoupon] = useState<MtCoupon | null>(null);
  const [couponPick, setCouponPick] = useState(false);
  const couponOff = selCoupon ? Math.min(selCoupon.amount, Math.max(0.01, calc.total - 0.01)) : 0;
  const payable = Math.max(0.01, Math.round((calc.total - couponOff) * 100) / 100);
  const usableCoupons = mtListUsableCoupons(uid, 'waimai', calc.itemTotal);

  const items = cart.items
    .map((i) => {
      const d = mtDishesOf(merchant).find((x) => x.id === i.dishId);
      return d ? { dish: d, qty: i.qty, spec: i.spec, unitPrice: i.unitPrice } : null;
    })
    .filter((x): x is { dish: MtDish; qty: number; spec: string | undefined; unitPrice: number | undefined } => x !== null);

  const submit = () => {
    if (items.length === 0) {
      onToast('购物车是空的');
      return;
    }
    if (!cur) {
      onToast('请先选择收货地址');
      return;
    }
    const now = Date.now();
    // 自建商品订单：custom 元数据（类型/优惠券名/规格选项组）随首个自建菜品快照进订单（列表「自建·类型」角标）
    const firstCustom = items.map(({ dish }) => dish.custom).find(Boolean);
    const order: MtOrder = {
      id: `mt${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      uid,
      merchantId: merchant.id,
      merchantName: merchant.name,
      merchantEmoji: merchant.emoji,
      merchantImg: merchant.cover,
      kind: 'waimai',
      items: items.map(({ dish, qty, spec, unitPrice }) => ({ dishId: dish.id, name: dish.name, price: unitPrice ?? dish.price, qty, emoji: dish.emoji, img: dish.img, spec })),
      itemTotal: calc.itemTotal,
      deliveryFee: calc.deliveryFee,
      discount: Math.round((calc.discount + couponOff) * 100) / 100,
      couponId: selCoupon?.id,
      couponAmount: couponOff > 0 ? couponOff : undefined,
      total: payable,
      note: note.trim() || undefined,
      address: cur,
      status: 'pendingPay',
      createdAt: now,
      statusLog: [{ status: 'pendingPay', at: now }],
      ...(firstCustom ? { custom: firstCustom } : {}),
    };
    if (selCoupon) mtUseCoupon(uid, selCoupon.id);
    const list = mtLoadOrders(uid);
    mtSaveOrders(uid, [order, ...list]);
    mtSaveCart(uid, { merchantId: null, items: [] });
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    onClose();
    onOpenPay(order);
  };

  return (
    <motion.div className="absolute inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
      {/* 遮罩：点击弹窗外任意区域关闭 */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        className="absolute inset-x-0 bottom-0 top-[72px] flex flex-col overflow-hidden rounded-t-[20px] bg-white/80 backdrop-blur-2xl backdrop-saturate-150"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.34 }}
      >
        {/* 标题行（拖动指示 + 关闭） */}
        <div className="relative flex shrink-0 items-center bg-white px-3 pb-2.5 pt-3.5">
          <span className="absolute left-1/2 top-[7px] h-1 w-9 -translate-x-1/2 rounded-full bg-black/12" aria-hidden="true" />
          <span className="w-9" />
          <p className="flex-1 text-center text-[16px] font-semibold text-black/85">确认订单</p>
          <button type="button" aria-label="关闭" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-black/[0.05] active:bg-black/10">
            <X className="h-4 w-4 text-black/60" />
          </button>
        </div>

        {items.length === 0 ? (
          /* 空车守卫（订单已提交但关闭支付弹层后重开） */
          <div className="flex flex-1 flex-col items-center justify-center px-8">
            <p className="grid h-16 w-16 place-items-center rounded-full bg-black/[0.05]">
              <Receipt className="h-7 w-7 text-black/25" />
            </p>
            <p className="mt-3 text-center text-[14px] leading-relaxed text-black/50">
              购物车是空的
              <br />
              如有已提交未支付的订单，可在「订单」页继续支付
            </p>
            <button type="button" onClick={onClose} className="mt-5 rounded-full bg-[#FFD100] px-8 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
              返回商家
            </button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* 地址 */}
              <button type="button" onClick={onPickAddress} className="w-full px-4 py-4 text-left active:bg-black/[0.02]">
                <span className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#FF6000]" />
                  <span className="min-w-0 flex-1">
                    {cur ? (
                      <>
                        <span className="flex items-center gap-2">
                          <span className="text-[15px] font-semibold text-black/85">{cur.name} {cur.phone}</span>
                          <span className="rounded bg-[#FFF3B8] px-1 text-[10px] text-[#B77900]">{cur.tag}</span>
                        </span>
                        <span className="mt-0.5 block text-[12px] text-black/50">{cur.text}</span>
                      </>
                    ) : (
                      <span className="text-[14px] text-black/50">请选择收货地址</span>
                    )}
                  </span>
                </span>
                <span className="mt-2 flex items-center gap-1.5 border-t border-black/5 pt-2 text-[11px] text-black/40">
                  {/* 配送时长与支付后真实 ETA 同口径（5~30 分钟，mtDeliveryMinutesOf 按商家号预演推导） */}
                  <ClockIcon className="h-3.5 w-3.5" /> 立即配送 · 预计 {mtDeliveryMinutesOf(merchant.id)} 分钟送达
                </span>
              </button>

              {/* 商品 */}
              <div className="border-t border-black/5 px-4 py-3.5">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                  <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md">
                    <ShopAvatar m={merchant} className="h-full w-full" />
                  </span>
                  {merchant.name}
                </div>
                <div className="mt-2.5 space-y-2.5">
                  {items.map(({ dish, qty, spec, unitPrice }) => (
                    <div key={`${dish.id}-${spec ?? ''}`} className="flex items-center gap-2.5">
                      <FoodImg src={dish.img} emoji={dish.emoji} className="h-10 w-10 shrink-0 rounded-lg" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-black/75">{dish.name}</span>
                        {spec && <span className="block truncate text-[11px] text-black/40">{spec}</span>}
                      </span>
                      <span className="text-[12px] text-black/40">×{qty}</span>
                      <span className="w-14 text-right text-[13px] text-black/80">¥{fmtMoney((unitPrice ?? dish.price) * qty)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-1.5 border-t border-black/5 pt-2.5 text-[12px]">
                  <p className="flex justify-between text-black/55">
                    <span>商品总价</span>
                    <span>¥{fmtMoney(calc.itemTotal)}</span>
                  </p>
                  <p className="flex justify-between text-black/55">
                    <span>配送费{calc.itemTotal >= 45 && <span className="ml-1 text-[#00A661]">（满45已免）</span>}</span>
                    <span>¥{fmtMoney(calc.deliveryFee)}</span>
                  </p>
                  <button type="button" onClick={() => setCouponPick(true)} className="flex w-full justify-between text-black/55 active:opacity-70">
                    <span>优惠券</span>
                    <span className={`flex items-center gap-0.5 ${selCoupon || couponOff > 0 ? 'font-medium text-[#FF4B33]' : 'text-black/40'}`}>
                      {selCoupon ? `-¥${fmtMoney(couponOff)}` : usableCoupons.usable.length > 0 ? `${usableCoupons.usable.length}张可用` : '暂无可用'}
                    </span>
                  </button>
                  {calc.discount > 0 && (
                    <p className="flex justify-between text-[#FF4B33]">
                      <span>满减优惠{calc.labels.length > 0 && `（${calc.labels.join('、')}）`}</span>
                      <span>-¥{fmtMoney(calc.discount)}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* 备注 */}
              <div className="border-t border-black/5 px-4 py-3.5">
                <p className="text-[13px] font-semibold text-black/75">订单备注</p>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 50))}
                  rows={2}
                  placeholder="口味偏好、放门口等（选填）"
                  className="mt-2 w-full resize-none rounded-xl bg-[#F5F6F7] p-2.5 text-[13px] outline-none placeholder:text-black/25"
                />
              </div>
            </div>

            {/* 底栏 */}
            <div className="shrink-0 border-t border-black/5 bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="text-[13px] text-black/45">合计 </span>
                  <span className="text-[20px] font-bold" style={{ color: MT_PRICE }}>
                    ¥{payable.toFixed(2)}
                  </span>
                  {calc.discount + couponOff > 0 && <span className="ml-1 text-[11px] text-black/35">已优惠¥{fmtMoney(calc.discount + couponOff)}</span>}
                </span>
                <button type="button" onClick={submit} className="h-12 rounded-full bg-[#FFD100] px-8 text-[16px] font-semibold text-black/90 shadow active:opacity-85">
                  提交订单
                </button>
              </div>
            </div>
          </>
        )}

        {/* 优惠券选择弹层 */}
        <AnimatePresence>
          {couponPick && (
            <CouponPickerSheet
              key="mt-coupon-pick"
              uid={uid}
              type="waimai"
              itemTotal={calc.itemTotal}
              selId={selCoupon?.id ?? null}
              onClose={() => setCouponPick(false)}
              onPick={(c) => {
                setSelCoupon(c);
                setCouponPick(false);
              }}
              onToast={onToast}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}


// ================================ 购物车页（截图3） ================================

function CartPage({
  session,
  onOpenMerchant,
  onCheckout,
  onOpenFavorites,
  onToast,
}: {
  session: MtSession;
  onOpenMerchant: (id: string) => void;
  onCheckout: (merchantId: string) => void;
  onOpenFavorites: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const [, setVer] = useState(0);
  const [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<Set<string> | null>(null); // null = 全选态
  const addrs = mtLoadAddresses(uid);
  const cur = addrs.find((a) => a.id === mtCurAddrId(uid)) ?? addrs[0];
  const cart = mtLoadCart(uid);
  const merchant = cart.merchantId ? mtMerchantOf(cart.merchantId) : undefined;
  const rows = cart.items
    .map((i) => {
      if (!merchant) return null;
      const d = mtDishesOf(merchant).find((x) => x.id === i.dishId);
      return d ? { dish: d, qty: i.qty, spec: i.spec, unitPrice: i.unitPrice } : null;
    })
    .filter((x): x is { dish: MtDish; qty: number; spec: string | undefined; unitPrice: number | undefined } => x !== null);

  const selIds = selected ?? new Set(rows.map((r) => r.dish.id));
  const selRows = rows.filter((r) => selIds.has(r.dish.id));
  const sum = selRows.reduce((s, r) => s + (r.unitPrice ?? r.dish.price) * r.qty, 0);
  const allSel = selRows.length === rows.length && rows.length > 0;

  const mutate = (next: MtCart) => {
    mtSaveCart(uid, next);
    setVer((v) => v + 1);
  };

  const dec = (dish: MtDish) => {
    const items = cart.items.map((i) => (i.dishId === dish.id ? { ...i, qty: i.qty - 1 } : i)).filter((i) => i.qty > 0);
    mutate({ merchantId: items.length > 0 ? cart.merchantId : null, items });
  };
  const add = (dish: MtDish) => {
    mutate({ merchantId: cart.merchantId, items: cart.items.map((i) => (i.dishId === dish.id ? { ...i, qty: i.qty + 1 } : i)) });
  };
  const removeRow = (dish: MtDish) => {
    const items = cart.items.filter((i) => i.dishId !== dish.id);
    mutate({ merchantId: items.length > 0 ? cart.merchantId : null, items });
    onToast('已删除');
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 头部 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.04] bg-white px-4 pb-2.5 pt-[54px]">
        <p className="shrink-0 text-[22px] font-bold text-black/90">购物车</p>
        <button type="button" onClick={() => onToast('地址选择请到「我的-收货地址」或下单时选择')} className="flex min-w-0 flex-1 items-center gap-1 text-left active:opacity-60">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-black/45" />
          <span className="truncate text-[13px] text-black/50">{cur ? cur.text : '暂无地址'}</span>
        </button>
        {rows.length > 0 && (
          <button type="button" onClick={() => setManage((m) => !m)} className="shrink-0 text-[15px] text-black/75 active:opacity-60">
            {manage ? '完成' : '管理'}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {/* 收藏入口（星星+收藏+箭头，白底直排不套面板） */}
        <button type="button" onClick={onOpenFavorites} className="mx-4 mt-2 flex items-center gap-1.5 py-2 text-left active:opacity-70">
          <Star className="h-[18px] w-[18px] fill-[#FFB800] text-[#FFB800]" />
          <span className="text-[14px] text-black/80">收藏</span>
        </button>

        {rows.length === 0 || !merchant ? (
          /* 空态（对齐截图3插画） */
          <div className="py-12 text-center">
            <div className="relative mx-auto h-16 w-20">
              <span className="absolute left-1/2 top-2 h-10 w-16 -translate-x-1/2 rotate-[-4deg] rounded-lg bg-gradient-to-br from-[#C9CDFF] to-[#A7AEFF] shadow-sm" />
              <span className="absolute left-1/2 top-6 h-9 w-16 -translate-x-1/2 rotate-[3deg] rounded-lg bg-gradient-to-br from-[#B5BCFF] to-[#8E96FF] shadow" />
              <span className="absolute left-[30%] top-[34px] h-1 w-6 rounded bg-white/80" />
            </div>
            <p className="mt-4 text-[14px] text-black/45">还没有加购任何商品，快去选购吧</p>
            <button type="button" onClick={() => onOpenMerchant('m-mixue')} className="mt-4 rounded-full bg-[#FFD100] px-7 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
              去逛逛
            </button>
          </div>
        ) : (
          <>
            {/* 商家组 */}
            <div className="border-t-[7px] border-[#F5F6F7] px-4 py-3.5">
              <button type="button" onClick={() => onOpenMerchant(merchant.id)} className="flex w-full items-center gap-1.5 text-left active:opacity-70">
                <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md">
                  <ShopAvatar m={merchant} className="h-full w-full" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-black/85">{merchant.name}</span>
              </button>
              <div className="mt-1 divide-y divide-black/[0.04]">
                {rows.map(({ dish, qty, spec, unitPrice }) => {
                  const checked = selIds.has(dish.id);
                  return (
                    <div key={`${dish.id}-${spec ?? ''}`} className="flex items-center gap-2.5 py-3">
                      <button
                        type="button"
                        aria-label={checked ? '取消选择' : '选择'}
                        onClick={() => {
                          const next = new Set(selIds);
                          if (next.has(dish.id)) next.delete(dish.id);
                          else next.add(dish.id);
                          setSelected(next);
                        }}
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${checked ? 'bg-[#FFC300]' : 'border border-black/20'}`}
                      >
                        {checked && <Check className="h-3 w-3 text-black/80" strokeWidth={3} />}
                      </button>
                      <FoodImg src={dish.img} emoji={dish.emoji} className="h-16 w-16 shrink-0 rounded-lg" />
                      <div className="flex min-w-0 flex-1 flex-col self-stretch">
                        <p className="line-clamp-1 text-[14px] font-medium text-black/85">{dish.name}</p>
                        {spec && <p className="mt-0.5 line-clamp-1 text-[11px] text-black/40">{spec}</p>}
                        {manage && (
                          <button type="button" onClick={() => removeRow(dish)} className="mt-1 w-fit rounded-full border border-[#FF4B33]/40 px-2.5 py-0.5 text-[11px] text-[#FF4B33] active:bg-black/5">
                            删除
                          </button>
                        )}
                        <div className="mt-auto flex items-center justify-between">
                          <span className="text-[16px] font-bold" style={{ color: MT_PRICE }}>
                            <span className="text-[11px]">¥</span>
                            {fmtMoney(unitPrice ?? dish.price)}
                          </span>
                          {!manage && <Stepper qty={qty} onAdd={() => add(dish)} onDec={() => dec(dish)} />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {manage && (
              <button
                type="button"
                onClick={() => {
                  mutate({ merchantId: null, items: [] });
                  onToast('购物车已清空');
                }}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 border-t-[7px] border-[#F5F6F7] py-3 text-[13px] text-[#FF4B33] active:bg-black/[0.02]"
              >
                <Trash2 className="h-4 w-4" /> 清空购物车
              </button>
            )}
          </>
        )}
      </div>

      {/* 底部结算条（非空才显示） */}
      {rows.length > 0 && (
        <div className="flex shrink-0 items-center gap-2.5 border-t border-black/[0.06] bg-white px-4 py-3">
          <button
            type="button"
            onClick={() => setSelected(allSel ? new Set<string>() : null)}
            className="flex items-center gap-2 active:opacity-70"
          >
            <span className={`grid h-5 w-5 place-items-center rounded-full ${allSel ? 'bg-[#FFC300]' : 'border border-black/20'}`}>
              {allSel && <Check className="h-3 w-3 text-black/80" strokeWidth={3} />}
            </span>
            <span className="text-[14px] text-black/60">全选</span>
          </button>
          <span className="flex-1" />
          <span className="text-[14px] text-black/75">
            合计: <span className="text-[19px] font-bold" style={{ color: MT_PRICE }}>¥{fmtMoney(sum)}</span>
          </span>
          <button
            type="button"
            disabled={selRows.length === 0}
            onClick={() => {
              if (!merchant) return;
              if (selRows.length === 0) {
                onToast('请先选择商品');
                return;
              }
              onCheckout(merchant.id);
            }}
            className={`h-11 rounded-full px-8 text-[16px] font-semibold ${selRows.length > 0 ? 'bg-[#FFD100] text-black/90 shadow active:opacity-85' : 'bg-[#F6EC9F] text-black/40'}`}
          >
            结算{selRows.length > 0 ? `(${selRows.length})` : ''}
          </button>
        </div>
      )}
    </div>
  );
}

// ================================ 美团钱包（主页/余额/银行卡/账单/借钱/支付密码） ================================

/** 金额统一两位小数（钱包规范：整数也显示 0.00 格式） */


// ================================ 根组件 ================================

export default function MeituanApp() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<MtSession | null>(null);
  // AI 自创商品真图就绪刷新钟（仅触发重渲染，值本身不参与渲染）
  const [, setAiImgTick] = useState(0);
  const [page, setPage] = useState<Page>('main');
  const [tab, setTab] = useState<Tab>('home');
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderFrom, setOrderFrom] = useState<'orders' | 'merchant'>('orders');
  const [dealId, setDealId] = useState<string | null>(null);
  const [dealMode, setDealMode] = useState<'group' | 'direct'>('direct');
  const [orderTab, setOrderTab] = useState('全部');
  const [editAddr, setEditAddr] = useState<MtAddress | null>(null);
  const [addrPicker, setAddrPicker] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  /** 结算目标商家（跨店底栏「去结算」传购物车归属商家；空 = 当前商家页） */
  const [checkoutMid, setCheckoutMid] = useState<string | null>(null);
  const [dealConfirmOpen, setDealConfirmOpen] = useState(false);
  const [payFor, setPayFor] = useState<MtOrder | null>(null);
  const [payPage, setPayPage] = useState(false);
  const [refundFor, setRefundFor] = useState<MtOrder | null>(null);
  const [refundOrderId, setRefundOrderId] = useState<string | null>(null);
  const [refundFrom, setRefundFrom] = useState<'order' | 'orders'>('order');
  // 二级页返回目标（设置页进入的 收货地址/关于美团 返回时回设置）
  const [subReturn, setSubReturn] = useState<'main' | 'settings'>('main');
  /** 搜索页预填词（首页热词点击带入） */
  const [searchSeed, setSearchSeed] = useState('');
  /** 第三十八轮：编辑中的自建商品（管理商品页→编辑→创建商品页预填原位更新；null = 新建） */
  const [editShop, setEditShop] = useState<MtMerchant | null>(null);
  /** 第三十九轮：自建商品详情页目标（mtc-shop-* id；点首页自建商品卡直达，不再进店铺页） */
  const [customMid, setCustomMid] = useState<string | null>(null);
  /** 评价弹层目标订单 */
  const [rateFor, setRateFor] = useState<MtOrder | null>(null);
  /** 找人代付详情（订单列表「代付详情」入口；只读） */
  const [proxyViewId, setProxyViewId] = useState<string | null>(null);
  /** 商家入驻：编辑中的店铺 id（null = 新建） */
  const [editShopId, setEditShopId] = useState<string | null>(null);
  /** 商家入驻：编辑页返回目标（商家中心列表 / 店铺管理页） */
  const [editFrom, setEditFrom] = useState<'center' | 'manage'>('center');
  /** 店铺管理页（商家中心 → 管理店铺）当前店铺 id */
  const [manageShopId, setManageShopId] = useState<string | null>(null);
  /** 发票页返回目标（我的宫格 / 订单页顶栏两个入口） */
  const [invoicesReturn, setInvoicesReturn] = useState<'main' | 'orders'>('main');
  const [toastMsg, showToast] = useLocalToast();
  const sessionRef = useRef<MtSession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  // AI 商家/团购注册表恢复（Task 46：幂等；详情页/搜索等直访 AI 条目时无感命中）
  useEffect(() => {
    mtRestoreAiRegistry();
  }, []);

  // AI 自创菜品/门头真图生成完成（第十四轮）：图片渲染时实时读覆盖，真图落库广播事件 →
  // 根组件计一次刷新钟，打开中的首页/商家页/订单页立即从卡通图升级成真图
  useEffect(() => {
    const fn = () => setAiImgTick((t) => t + 1);
    window.addEventListener(AI_PRODUCT_IMG_EVENT, fn);
    return () => window.removeEventListener(AI_PRODUCT_IMG_EVENT, fn);
  }, []);

  // 启动：恢复登录态（资料跟随全局账号）+ 消费灵动岛通知点击跳转（订单详情）
  useEffect(() => {
    void (async () => {
      let v = await mtValidateSession(mtGetSession());
      if (v) {
        const synced = await mtSyncSessionIdentity(v);
        if (synced !== v) {
          v = synced;
          mtSetSession(synced);
        }
      }
      setSession(v);
      setBooting(false);
      // 商家入驻：登录态恢复后把本账号自有店铺重新注册进运行时注册表（详情页/搜索/AI 代点即时可用）
      if (v) mtRegisterMyMerchants(mtLoadShops(mtUidOf(v)));
      // 自建商品（创建订单=创建商品）：登录态恢复后同步恢复注册（首页商品流置顶 / 商家页 / 下单链路即时可用）
      if (v) {
        mtRegisterCustomMerchants(mtLoadCustomShops(mtUidOf(v)));
        // 商品图生成覆盖（第三十七轮）：详情界面点图生成的结果写回内存菜品对象
        mtApplyProductImgOverrides();
      }
      const nav = takeNotifyNavigation('meituan');
      if (nav?.contactId && v) {
        // AI 代点草稿「确认下单」带 pay=true：目标订单仍待支付时直达收银台，否则进订单详情
        const target = mtLoadOrders(mtUidOf(v)).find((o) => o.id === nav.contactId);
        setOrderId(nav.contactId);
        setTab('orders');
        if (nav.pay && target && target.status === 'pendingPay') {
          setPayFor(target);
          setPayPage(true);
        } else {
          setPage('orderDetail');
        }
      }
      // 情侣空间「情侣酒店」外部直达（第十九轮需求48）：已登录 → 直接进「酒店旅行」频道；未登录留在主页先登录
      if (takeMtPendingPage() === 'travel' && v) {
        setPage('travel');
      }
    })();
    const onNav = () => {
      const nav = takeNotifyNavigation('meituan');
      if (nav?.contactId && sessionRef.current) {
        const target = mtLoadOrders(mtUidOf(sessionRef.current)).find((o) => o.id === nav.contactId);
        setOrderId(nav.contactId);
        setTab('orders');
        if (nav.pay && target && target.status === 'pendingPay') {
          setPayFor(target);
          setPayPage(true);
        } else {
          setPage('orderDetail');
        }
      }
    };
    window.addEventListener(ISLAND_NAV_EVENT, onNav);
    return () => window.removeEventListener(ISLAND_NAV_EVENT, onNav);
  }, []);

  // 头像/昵称跟随全局账号信息：微信/QQ 内改头像、换装扮后实时同步到美团（contact-avatar-changed）；
  // contact-updated：联系人任意资料字段（含昵称）变更也同步——改昵称不换头像时美团不再持旧名。
  // 打开 App 时先对齐一次：改头像时美团没开着，下次打开也能刷新旧快照。
  useEffect(() => {
    const onAvatarChanged = () => {
      const s = sessionRef.current;
      if (!s) return;
      void (async () => {
        const synced = await mtSyncSessionIdentity(s);
        if (synced !== s) {
          mtSetSession(synced);
          setSession(synced);
        }
      })();
    };
    onAvatarChanged();
    window.addEventListener('contact-avatar-changed', onAvatarChanged);
    window.addEventListener('contact-updated', onAvatarChanged);
    return () => {
      window.removeEventListener('contact-avatar-changed', onAvatarChanged);
      window.removeEventListener('contact-updated', onAvatarChanged);
    };
  }, []);

  const login = useCallback((s: MtSession) => {
    mtSetSession(s);
    setSession(s);
    setTab('home');
    setPage('main');
    mtRegisterMyMerchants(mtLoadShops(mtUidOf(s)));
    mtRegisterCustomMerchants(mtLoadCustomShops(mtUidOf(s)));
    mtApplyProductImgOverrides();
    showToast(`欢迎回来，${s.name}`);
  }, [showToast]);

  const logout = useCallback(() => {
    mtSetSession(null);
    setSession(null);
    // 商家入驻：退出登录后注销本账号自有店铺（防跨账号残留在搜索池/详情页）
    mtUnregisterMyMerchants();
    // 自建商品：退出登录后注销全部自建商品商家（防跨账号残留；换号登录会按新账号恢复）
    for (const m of mtCustomMerchantsAll()) mtUnregisterCustomMerchant(m.id);
    setTab('home');
    setPage('main');
  }, []);

  const goSub = useCallback((p: 'addresses' | 'about', from: 'main' | 'settings') => {
    setSubReturn(from);
    setPage(p);
  }, []);

  const openPay = useCallback((o: MtOrder) => {
    // 收银台（全页）：选支付方式 → 确认交易，全在 PayPage 内完成
    setPayFor(o);
    setPayPage(true);
  }, []);

  const openRefundById = useCallback((id: string, from: 'order' | 'orders') => {
    setRefundOrderId(id);
    // 从订单详情进 → 返回时回订单详情；从订单列表进 → 返回时回订单列表
    setRefundFrom(from);
    setPage('refundDetail');
  }, []);

  const openRefund = useCallback((o: MtOrder) => {
    openRefundById(o.id, page === 'orderDetail' ? 'order' : 'orders');
  }, [page, openRefundById]);

  const openMerchant = useCallback((id: string) => {
    // 浏览记录打点（商家）
    if (sessionRef.current) mtPushHistory(mtUidOf(sessionRef.current), 'merchant', id);
    setMerchantId(id);
    setPage('merchant');
  }, []);

  const openOrder = useCallback((id: string, from: 'orders' | 'merchant' = 'orders') => {
    setOrderId(id);
    setOrderFrom(from);
    setPage('orderDetail');
  }, []);

  const openDeal = useCallback((id: string) => {
    // 浏览记录打点（团购）
    if (sessionRef.current) mtPushHistory(mtUidOf(sessionRef.current), 'deal', id);
    setDealId(id);
    setPage('deal');
  }, []);

  const goHome = useCallback(() => {
    setTab('home');
    setPage('main');
  }, []);

  const goOrders = useCallback((t?: string) => {
    if (t) setOrderTab(t);
    setTab('orders');
    setPage('main');
  }, []);

  const backFromOrder = useCallback(() => {
    if (orderFrom === 'merchant' && merchantId) {
      setPage('merchant');
      return;
    }
    setTab('orders');
    setPage('main');
  }, [orderFrom, merchantId]);

  if (booting) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#FFD100]">
        <img src="/icons/meituan-app.png" alt="美团" className="h-20 w-20 rounded-[22px] shadow-lg" />
        <p className="mt-4 text-[15px] font-semibold text-black/70">美团 · 吃喝玩乐什么都有</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="relative h-full overflow-hidden bg-white">
        <LoginPage onLogin={login} onToast={showToast} />
        <LocalToast msg={toastMsg} />
      </div>
    );
  }

  const uid = mtUidOf(session);
  const merchant = merchantId ? mtMerchantOf(merchantId) : undefined;
  const deal = dealId ? mtDealOf(dealId) : undefined;
  const customMerchant = customMid ? mtMerchantOf(customMid) : undefined;
  const checkoutMerchant = (checkoutMid ?? merchantId) ? mtMerchantOf((checkoutMid ?? merchantId) as string) : undefined;

  // 兜底（渲染期状态修正，React 官方模式）：商家/团购详情目标不存在（如「再来一单」引用重启后
  // 未再注册的 AI 商家）→ 立即回主页重渲染，避免白屏卡死
  if (page === 'merchant' && merchantId && !merchant) setPage('main');
  if (page === 'deal' && dealId && !deal) setPage('main');
  if (page === 'customProduct' && customMid && !customMerchant) setPage('main');

  const pickAddr = (a: MtAddress) => {
    mtSetCurAddr(uid, a.id);
    showToast(`已选择：${a.text.slice(0, 12)}`);
  };

  return (
    <div className="relative h-full overflow-hidden bg-[#F4F5F7]">
      {/* 页面路由（早退式，与微信/QQ 同模式） */}
      {page === 'main' && (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            {tab === 'home' && (
              <HomePage
                session={session}
                onOpenMerchant={openMerchant}
                onOpenDeal={openDeal}
                onOpenSearch={(kw) => {
                  setSearchSeed(kw ?? '');
                  setPage('search');
                }}
                onOpenChannel={(c) => setPage(c)}
                onOpenMessages={() => setPage('messages')}
                onOpenCreateOrder={() => {
                  setEditShop(null);
                  setPage('createOrder');
                }}
                onOpenManage={() => setPage('manageProducts')}
                onOpenCustomProduct={(mid) => {
                  setCustomMid(mid);
                  setPage('customProduct');
                }}
                onScan={() => openScan('meituan')}
                onToast={showToast}
              />
            )}
            {tab === 'orders' && (
              <OrdersPage
                session={session}
                tab={orderTab}
                setTab={setOrderTab}
                onOpenOrder={openOrder}
                onOpenDeal={openDeal}
                onOpenMerchant={openMerchant}
                onOpenRefund={(id) => openRefundById(id, 'orders')}
                onGoHome={goHome}
                onRate={(o) => setRateFor(o)}
                onOpenCouponCode={(o) => {
                  setOrderId(o.id);
                  setPage('couponCode');
                }}
                onOpenProxy={(pid) => setProxyViewId(pid)}
                onOpenInvoices={() => {
                  setInvoicesReturn('orders');
                  setPage('invoices');
                }}
                onToast={showToast}
              />
            )}
            {tab === 'cart' && (
              <CartPage
                session={session}
                onOpenMerchant={openMerchant}
                onCheckout={(mid) => {
                  setMerchantId(mid);
                  setCheckoutOpen(true);
                }}
                onOpenFavorites={() => setPage('favorites')}
                onToast={showToast}
              />
            )}
            {tab === 'my' && (
              <MyPage
                session={session}
                onOpenOrders={goOrders}
                onOpenSettings={() => setPage('settings')}
                onOpenFavorites={() => setPage('favorites')}
                onOpenHistory={() => setPage('history')}
                onOpenCoupons={() => setPage('coupons')}
                onOpenMember={() => setPage('member')}
                onOpenWallet={() => setPage('wallet')}
                onOpenLoan={() => setPage('walletLoan')}
                onOpenCardQuota={() => setPage('walletCardQuota')}
                onOpenDrugFund={() => setPage('walletDrugFund')}
                onOpenAddresses={() => goSub('addresses', 'main')}
                onOpenInvoices={() => {
                  setInvoicesReturn('main');
                  setPage('invoices');
                }}
                onOpenMerchantCenter={() => setPage('merchantCenter')}
                onClaimCoupons={() => {
                  const n = mtClaimGodCoupons(uid);
                  showToast(n > 0 ? `已领取${n}张神券，可在「红包卡券」查看` : '神券已领取过了');
                }}
                onToast={showToast}
              />
            )}
          </div>
          {/* 底部导航（订单页为独立页：无底部 tab） */}
          {tab !== 'orders' && <BottomTabBar active={tab} onTab={(t) => setTab(t)} />}
        </div>
      )}
      {page === 'search' && <SearchPage seedKw={searchSeed} onBack={() => setPage('main')} onOpenMerchant={openMerchant} />}
      {page === 'customProduct' && session && customMerchant && (
        <MtCustomProductPage
          session={session}
          merchant={customMerchant}
          onBack={() => setPage('main')}
          onCheckout={(mid) => {
            setCheckoutMid(mid);
            setCheckoutOpen(true);
          }}
          onToast={showToast}
        />
      )}
      {page === 'manageProducts' && session && (
        <MtProductManagePage
          session={session}
          onBack={() => setPage('main')}
          onEdit={(m) => {
            setEditShop(m);
            setPage('createOrder');
          }}
          onToast={showToast}
        />
      )}
      {page === 'createOrder' && session && (
        <MtOrderCreatePage
          key={editShop?.id ?? 'new'}
          session={session}
          editing={editShop}
          onBack={() => setPage(editShop ? 'manageProducts' : 'main')}
          onSaved={() => {
            // 保存成功：新建 → 回首页立即可见；编辑 → 回管理商品页
            if (editShop) {
              setEditShop(null);
              setPage('manageProducts');
            } else {
              setTab('home');
              setPage('main');
            }
          }}
          onToast={showToast}
        />
      )}
      {page === 'messages' && session && <MessagesPage session={session} onBack={() => setPage('main')} onOpenOrder={(id) => { setOrderId(id); setOrderFrom('orders'); setPage('orderDetail'); }} onOpenCoupons={() => setPage('coupons')} onToast={showToast} />}
      {page === 'member' && session && <MemberPage session={session} onBack={() => setPage('main')} onOpenCoupons={() => setPage('coupons')} onClaimCoupons={() => { const n = mtClaimGodCoupons(uid); showToast(n > 0 ? `已领取${n}张神券，可在「红包卡券」查看` : '神券已领取过了'); }} onToast={showToast} />}
      {page === 'couponCode' && session && orderId && <CouponCodePage session={session} orderId={orderId} onBack={() => setPage(orderFrom === 'orders' ? 'main' : 'orderDetail')} onToast={showToast} />}
      {page === 'wallet' && (
        <WalletPage
          session={session}
          onClose={() => setPage('main')}
          onOpenBalance={() => setPage('walletBalance')}
          onOpenCards={() => setPage('walletCards')}
          onOpenBills={() => setPage('walletBills')}
          onOpenPayPwd={() => setPage('walletPayPwd')}
          onOpenLoan={() => setPage('walletLoan')}
          onOpenCardQuota={() => setPage('walletCardQuota')}
          onOpenDrugFund={() => setPage('walletDrugFund')}
          onToast={showToast}
        />
      )}
      {page === 'walletBalance' && <WalletBalancePage session={session} onClose={() => setPage('wallet')} onOpenCards={() => setPage('walletCards')} onToast={showToast} />}
      {page === 'walletCards' && <WalletCardsPage session={session} onClose={() => setPage('wallet')} onOpenBills={() => setPage('walletBills')} onOpenPayPwd={() => setPage('walletPayPwd')} onOpenDrugFund={() => setPage('walletDrugFund')} onToast={showToast} />}
      {page === 'walletBills' && <WalletBillsPage session={session} onClose={() => setPage('wallet')} />}
      {page === 'walletLoan' && <WalletLoanPage session={session} onClose={() => setPage('wallet')} onToast={showToast} />}
      {page === 'walletCardQuota' && <WalletCardQuotaPage session={session} onClose={() => setPage('wallet')} onToast={showToast} />}
      {page === 'walletDrugFund' && <WalletDrugFundPage session={session} onClose={() => setPage('wallet')} onToast={showToast} />}
      {page === 'invoices' && <InvoicePage session={session} onBack={() => (invoicesReturn === 'orders' ? goOrders() : setPage('main'))} onToast={showToast} />}
      {page === 'walletPayPwd' && <WalletPayPwdPage session={session} onClose={() => setPage('wallet')} onToast={showToast} />}
      {page === 'travel' && session && <TravelChannelPage session={session} onBack={() => setPage('main')} onOpenPay={openPay} onToast={showToast} />}
      {page === 'shangou' && session && <ShangouChannelPage session={session} onBack={() => setPage('main')} onOpenPay={openPay} onToast={showToast} />}
      {page === 'hotel' && <HotelChannelPage onBack={() => setPage('main')} onOpenPay={openPay} onToast={showToast} />}
      {page === 'fun' && <FunChannelPage onBack={() => setPage('main')} onOpenPay={openPay} onToast={showToast} />}
      {page === 'movies' && <MoviesChannelPage onBack={() => setPage('main')} onOpenPay={openPay} onToast={showToast} />}
      {page === 'merchant' && merchant && (
        <MerchantPage
          merchant={merchant}
          onBack={() => setPage('main')}
          onCheckout={(mid) => {
            setCheckoutMid(mid ?? null);
            setCheckoutOpen(true);
          }}
          onOpenOrder={(id) => openOrder(id, 'merchant')}
          onToast={showToast}
        />
      )}
      {page === 'merchantCenter' && (
        <MerchantCenterPage
          session={session}
          onBack={() => setPage('main')}
          onCreate={() => {
            setEditShopId(null);
            setEditFrom('center');
            setPage('merchantEdit');
          }}
          onEdit={(id) => {
            setEditShopId(id);
            setEditFrom('center');
            setPage('merchantEdit');
          }}
          onManage={(id) => {
            setManageShopId(id);
            setPage('shopManage');
          }}
          onChanged={() => {
            homeFeedCache.ready = false; // 首页下次挂载重新生成，露出新店/改动
          }}
          onToast={showToast}
        />
      )}
      {page === 'shopManage' && manageShopId && (
        <ShopManagePage
          session={session}
          shopId={manageShopId}
          onBack={() => setPage('merchantCenter')}
          onEditShop={() => {
            setEditShopId(manageShopId);
            setEditFrom('manage');
            setPage('merchantEdit');
          }}
          onChanged={() => {
            homeFeedCache.ready = false; // 菜品/上下架改动后首页重新生成
          }}
          onToast={showToast}
        />
      )}
      {page === 'merchantEdit' && (
        <MerchantEditPage
          session={session}
          editId={editShopId}
          onBack={() => {
            setEditShopId(null);
            setPage(editFrom === 'manage' ? 'shopManage' : 'merchantCenter');
          }}
          onSaved={(id) => {
            homeFeedCache.ready = false; // 保存/新建后首页重新生成，新店置顶露出
            const isNew = editShopId === null; // 新入驻：直接带进店铺管理页加菜
            setEditShopId(null);
            if (editFrom === 'manage' || isNew) {
              setManageShopId(id);
              setPage('shopManage');
            } else {
              setPage('merchantCenter');
            }
          }}
          onToast={showToast}
        />
      )}
      {page === 'deal' && deal && (
        <DealDetailPage
          deal={deal}
          onBack={() => setPage('main')}
          onBuy={(m) => {
            setDealMode(m);
            setDealConfirmOpen(true);
          }}
          onOpenMerchant={openMerchant}
          onToast={showToast}
        />
      )}
      {page === 'orderDetail' && orderId && (
        <OrderDetailPage
          session={session}
          orderId={orderId}
          onBack={backFromOrder}
          onOpenPay={openPay}
          onGoOrders={() => goOrders()}
          onOpenDeal={openDeal}
          onOpenMerchant={openMerchant}
          onPickAddress={() => setAddrPicker(true)}
          onApplyRefund={(o) => setRefundFor(o)}
          onOpenRefund={openRefund}
          onRate={(o) => setRateFor(o)}
          onOpenCouponCode={(o) => setPage('couponCode')}
          onToast={showToast}
        />
      )}
      {page === 'refundDetail' && refundOrderId && (
        <RefundDetailPage
          session={session}
          orderId={refundOrderId}
          onBack={() => {
            if (refundFrom === 'order' && orderId) {
              setPage('orderDetail');
              return;
            }
            setTab('orders');
            setPage('main');
          }}
          onToast={showToast}
        />
      )}
      {page === 'settings' && (
        <SettingsPage
          session={session}
          onBack={() => setPage('main')}
          onOpenAddresses={() => goSub('addresses', 'settings')}
          onOpenAbout={() => goSub('about', 'settings')}
          onLogout={logout}
          onToast={showToast}
        />
      )}
      {page === 'favorites' && (
        <FavoritesPage
          session={session}
          onBack={() => setPage('main')}
          onOpenMerchant={openMerchant}
          onOpenDeal={openDeal}
          onToast={showToast}
        />
      )}
      {page === 'history' && (
        <HistoryPage
          session={session}
          onBack={() => setPage('main')}
          onOpenMerchant={openMerchant}
          onOpenDeal={openDeal}
          onToast={showToast}
        />
      )}
      {page === 'coupons' && (
        <CouponsPage
          session={session}
          onBack={() => setPage('main')}
          onGoUse={() => {
            // 去使用：回首页逛对应频道（外卖/团购卡都在首页瀑布流）
            setTab('home');
            setPage('main');
            showToast('选好商品后，结算时选择该券即可抵扣');
          }}
          onOpenWallet={() => setPage('wallet')}
          onToast={showToast}
        />
      )}
      {page === 'addresses' && (
        <AddressesPage
          session={session}
          onBack={() => setPage(subReturn)}
          onAdd={() => {
            setEditAddr(null);
            setPage('addAddress');
          }}
          onEdit={(a) => {
            setEditAddr(a);
            setPage('addAddress');
          }}
          onToast={showToast}
        />
      )}
      {page === 'addAddress' && (
        <AddAddressPage session={session} onBack={() => setPage('addresses')} editing={editAddr} onToast={showToast} />
      )}
      {page === 'about' && (
        <div className="flex h-full flex-col items-center justify-center bg-white px-8 text-center">
          <img src="/icons/meituan-app.png" alt="美团" className="h-20 w-20 rounded-[22px] shadow-lg" />
          <p className="mt-4 text-[19px] font-bold text-black/85">美团</p>
          <p className="mt-1 text-[12px] text-black/40">v10.18.0 · 演示版</p>
          <p className="mt-4 text-[12px] leading-relaxed text-black/45">
            当前账号：{session.name}（{session.idp === 'wx' ? '微信' : session.idp === 'qq' ? 'QQ' : '手机号'}登录）
            <br />
            购物车 / 订单 / 地址按账号隔离存储在本机
          </p>
          <button type="button" onClick={() => (subReturn === 'settings' ? setPage('settings') : goHome())} className="mt-6 rounded-full bg-[#FFD100] px-8 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
            {subReturn === 'settings' ? '返回设置' : '返回首页'}
          </button>
        </div>
      )}

      {/* 弹层 */}
      {addrPicker && <AddressPickerSheet uid={uid} onClose={() => setAddrPicker(false)} onPicked={pickAddr} onManage={() => goSub('addresses', 'main')} />}

      {/* 下单确认弹窗（外卖结算 / 团购确认，slide-up 覆盖在商家页/团购详情页上） */}
      <AnimatePresence>
        {checkoutOpen && checkoutMerchant && (
          <CheckoutSheet
            key="mt-checkout"
            session={session}
            merchant={checkoutMerchant}
            onClose={() => {
              setCheckoutOpen(false);
              setCheckoutMid(null);
            }}
            onOpenPay={openPay}
            onPickAddress={() => setAddrPicker(true)}
            onToast={showToast}
          />
        )}
        {dealConfirmOpen && deal && (
          <DealConfirmSheet
            key="mt-deal-confirm"
            deal={deal}
            mode={dealMode}
            onClose={() => setDealConfirmOpen(false)}
            onOpenPay={openPay}
            onToast={showToast}
          />
        )}
      </AnimatePresence>

      {/* 评价晒单弹层（订单列表/详情「评价」） */}
      {rateFor && <RateSheet order={rateFor} onClose={() => setRateFor(null)} onToast={showToast} />}

      {payFor && payPage && (
        <AnimatePresence>
          <PayPage
            key={payFor.id}
            order={payFor}
            session={session}
            onClose={() => {
              // 返回 → 取消支付，回到来源页（订单保持待支付，可继续支付）
              setPayPage(false);
              setPayFor(null);
            }}
            onPaid={(o) => {
              setPayPage(false);
              setPayFor(null);
              setOrderId(o.id);
              setOrderFrom('orders');
              setTab('orders');
              setPage('orderDetail');
            }}
            onProxySent={() => {
              // 代付请求已发出 → 关收银台，回订单列表待付款页签（卡片已进好友聊天）
              setPayPage(false);
              setPayFor(null);
              setOrderTab('待付款');
              setTab('orders');
              setPage('main');
            }}
            onOpenWallet={() => {
              // 收银台 → 美团钱包（充值余额/添加银行卡后可回来支付）
              setPayPage(false);
              setPayFor(null);
              setPage('wallet');
            }}
            onToast={showToast}
          />
        </AnimatePresence>
      )}

      {/* 退款申请弹层（退款售后） */}
      <AnimatePresence>
        {refundFor && (
          <RefundApplySheet
            key={refundFor.id}
            order={refundFor}
            onClose={() => setRefundFor(null)}
            onToast={showToast}
          />
        )}
      </AnimatePresence>

      {/* 找人代付详情（只读视角：等待好友付款中） */}
      {proxyViewId && <MtProxyDetailPage pid={proxyViewId} canPay={false} onBack={() => setProxyViewId(null)} onToast={showToast} />}

      {/* 扫一扫（首页顶部入口；扫到自家店铺码直达店铺页 / 神券真实入卡券包） */}
      <ScanOverlayWhen flavor="meituan" onOpenShop={openMerchant} onOpenCoupons={() => setPage('coupons')} />

      <LocalToast msg={toastMsg} />
    </div>
  );
}

