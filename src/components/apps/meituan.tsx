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

type Page = 'main' | 'search' | 'merchant' | 'orderDetail' | 'addresses' | 'addAddress' | 'about' | 'deal' | 'settings' | 'favorites' | 'history' | 'refundDetail' | 'coupons' | 'hotel' | 'fun' | 'movies' | 'travel' | 'shangou' | 'messages' | 'member' | 'couponCode' | 'wallet' | 'walletBalance' | 'walletCards' | 'walletBills' | 'walletPayPwd' | 'walletLoan' | 'walletCardQuota' | 'walletDrugFund' | 'invoices' | 'merchantCenter' | 'merchantEdit' | 'shopManage' | 'createOrder' | 'manageProducts' | 'customProduct';
type Tab = 'home' | 'orders' | 'cart' | 'my';

const MT_YELLOW = '#FFD100';
const MT_PRICE = '#FF4B33';
const MT_PINK = '#FF2D7E';
const MT_ORANGE = '#FF6000';

// ================================ 骑手形象（「我的」可选，配送地图立体巡航） ================================
// 形象数据与读写已抽到 @/lib/ios/mt-rider（配送地图 / 灵动岛小窗共用同一选中形象）

/** 计数单位：饮品/奶茶类「杯」，其余「件」（对齐真机量词，奶茶不再用「张」） */
const mtCountUnit = (name: string): string => (/奶茶|奶绿|奶昔|果茶|柠檬水|咖啡|豆浆|杨枝甘露|可乐|果汁|茶饮|奶蒂/.test(name) ? '杯' : '件');

const fmtMoney = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const fmtDateTime = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const fmtDate = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 下单时间（带秒，对齐真机 2025.02.26 09:55:37 格式） */
const fmtDateTimeSec = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

/** 手机号脱敏（139****0171） */
const maskPhone = (p: string): string => (/^1\d{10}$/.test(p) ? `${p.slice(0, 3)}****${p.slice(7)}` : p);

/** 商家联系人（订单详情「取件地址」行，按商家 id 确定性生成，对齐真机脱敏样式） */
const MT_KEEPER_SURNAMES = ['黄', '李', '张', '王', '陈', '陶', '刘', '周'];
const mtMerchantContact = (id: string): string => {
  const h = [...id].reduce((acc, ch) => (acc * 33 + ch.charCodeAt(0)) >>> 0, 9);
  return `${MT_KEEPER_SURNAMES[h % MT_KEEPER_SURNAMES.length]}老板 139****${String(h % 10000).padStart(4, '0')}`;
};

/** 订单跟踪时间标签：今天/昨天 HH:MM（跨天回退日期） */
const fmtTrackTime = (ts: number): string => {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  if (new Date(now.getTime() - 86_400_000).toDateString() === d.toDateString()) return `昨天 ${hm}`;
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`;
};

/** 状态展示文案（对齐真机：待付款/已关闭；机票/火车票：待出行/出行中） */
const mtStatusText = (o: MtOrder): string => {
  if (o.status === 'pendingPay') return '待付款';
  if (o.kind === 'tuangou' && o.status === 'canceled') return '已关闭';
  if ((o.kind === 'flight' || o.kind === 'train') && o.status === 'pendingAccept') return '待出行';
  if ((o.kind === 'flight' || o.kind === 'train') && o.status === 'accepted') return '出行中';
  return MT_STATUS_LABEL[o.status];
};

/** 菜单分节名「N选M」识别（鲜果 3选1 / 比萨 4选1 → 购买弹窗内必选分组） */
const MT_CHOICE_RE = /（?(\d+)\s*选\s*(\d+)）?/;

/** 首页宫格图标（icon key → Lucide 线条图标，简约单色风） */
const GRID_ICONS: Record<string, LucideIcon> = {
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
function Stepper({ qty, onAdd, onDec }: { qty: number; onAdd: () => void; onDec: () => void }) {
  return (
    <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {qty > 0 && (
        <>
          <button type="button" aria-label="减少" onClick={onDec} className="grid h-6 w-6 place-items-center rounded-full text-[18px] leading-none text-black/45 active:bg-black/5">
            <span className="mt-[-2px]">−</span>
          </button>
          <span className="grid h-[26px] min-w-[32px] place-items-center rounded-[5px] border border-black/15 bg-white px-1 text-[14px] font-medium">{qty}</span>
        </>
      )}
      <button type="button" aria-label="增加" onClick={onAdd} className="grid h-6 w-6 place-items-center rounded-full text-[18px] leading-none text-black/45 active:bg-black/5">
        <span className="mt-[-2px]">＋</span>
      </button>
    </span>
  );
}

/** 订单状态推进刷新 hook：事件 + 定时器双通道 */
function useOrdersTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const iv = setInterval(bump, 3000);
    window.addEventListener('mt-orders-changed', bump);
    return () => {
      clearInterval(iv);
      window.removeEventListener('mt-orders-changed', bump);
    };
  }, []);
  return tick;
}

const EMPTY_FAVS: MtFavs = { stores: [], dishes: [], deals: [] };

/** 收藏状态 hook（商家/菜品/团购）：读当前登录账号，切换后强制刷新；返回切换后是否已收藏 */
function useFavs() {
  const [, setVer] = useState(0);
  const session = mtGetSession();
  const uid = session ? mtUidOf(session) : '';
  const favs = uid ? mtLoadFavs(uid) : EMPTY_FAVS;
  const toggle = useCallback(
    (kind: keyof MtFavs, id: string): boolean => {
      if (!uid) return false;
      const on = mtToggleFav(uid, kind, id);
      setVer((v) => v + 1);
      return on;
    },
    [uid]
  );
  return { favs, toggle, uid };
}

/** 「特⚡价团」字标（黄色闪电为 SVG，不用 emoji） */
const TuanMark = ({ className = '' }: { className?: string }) => (
  <span className={`inline-flex items-center whitespace-nowrap font-bold ${className}`}>
    <span className="text-[#FF2D7E]">特</span>
    <Zap className="h-[0.82em] w-[0.82em] fill-[#FFB300] text-[#FFB300]" strokeWidth={0} />
    <span className="text-[#FF2D7E]">价团</span>
  </span>
);

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
function BottomTabBar({ active, onTab }: { active: Tab; onTab: (t: Tab) => void }) {
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
function DealCard({ deal, onOpen }: { deal: MtDeal; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="mb-2 block w-full break-inside-avoid overflow-hidden rounded-xl bg-white text-left shadow-[0_1px_6px_rgba(0,0,0,0.04)] active:opacity-90">
      <span className="relative block">
        <FoodImg src={deal.img} emoji={deal.emoji} className="h-[150px] w-full" />
        <span className="absolute bottom-2 left-2 flex gap-1">
          <span className="rounded-[4px] bg-[#FF3B30] px-1.5 py-0.5 text-[10px] font-medium text-white">团购</span>
          <span className="rounded-[4px] bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{deal.distanceKm.toFixed(1)}km</span>
        </span>
      </span>
      <span className="block px-2.5 pb-2.5 pt-2">
        <span className="flex items-center gap-1 text-[14px] font-bold leading-snug text-black/90">
          <TuanMark className="shrink-0 text-[14px]" />
          <span className="truncate">{stripDealQty(deal.title)}</span>
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[12px]">
          <span className="font-medium text-[#FF2D7E]">{deal.tips}</span>
          <span className="text-black/45">{deal.praise}</span>
        </span>
        <span className="mt-1 flex items-baseline gap-1.5">
          <span className="shrink-0 text-[19px] font-bold leading-none" style={{ color: MT_PRICE }}>
            <span className="text-[12px]">¥</span>
            {fmtMoney(deal.price)}
          </span>
          <span className="shrink-0 text-[12px] leading-none text-black/40">{deal.discount}</span>
          <span className="min-w-0 flex-1 truncate text-right text-[11px] leading-none text-black/40">{deal.sold}</span>
        </span>
      </span>
    </button>
  );
}

/** 特价团聚合卡（列表位）：主题名 + 2 个团购由 AI 生成（AI 未给时用种子兜底） */
function DealListCard({ title, deals, onOpen }: { title: string; deals: MtDeal[]; onOpen: (id: string) => void }) {
  if (deals.length === 0) return null;
  return (
    <div className="mb-2 break-inside-avoid rounded-xl bg-white p-3 shadow-[0_1px_6px_rgba(0,0,0,0.04)]">
      <button type="button" onClick={() => onOpen(deals[0].id)} className="flex w-full items-center gap-1.5 text-left active:opacity-70">
        <TuanMark className="shrink-0 text-[15px]" />
        <span className="shrink-0 rounded-[4px] bg-[#FF3B30] px-1 py-px text-[10px] font-medium text-white">特价团</span>
      </button>
      <p className="mt-1.5 truncate text-[13px] font-bold text-black/85">{title}</p>
      <div className="mt-2.5 space-y-3">
        {deals.map((d) => (
          <button key={d.id} type="button" onClick={() => onOpen(d.id)} className="flex w-full items-center gap-2.5 text-left active:opacity-80">
            <FoodImg src={d.img} emoji={d.emoji} className="h-[56px] w-[56px] shrink-0 rounded-lg" />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[13px] leading-snug text-black/85">{stripDealQty(d.title)}</span>
              <span className="mt-1 flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                <span className="shrink-0 rounded-[3px] bg-[#FFE8F1] px-1 text-[10px] leading-[1.6] text-[#FF2D7E]">{d.discount}</span>
                <span className="shrink-0 text-[15px] font-bold leading-none" style={{ color: MT_PRICE }}>
                  ¥{fmtMoney(d.price)}
                </span>
                <span className="w-full whitespace-nowrap text-[10px] leading-none text-black/30 line-through">¥{fmtMoney(d.origPrice)}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 店铺头像（第三十七轮：所有店铺统一「该用户正在营业」印章；生成覆盖后显示生成图）
 *  第三十八轮：仅保留给店铺详情页/列表行等「店铺身份」场景使用；首页商家卡封面改用商品图（见 MerchantCard）。 */
function ShopAvatar({ m, className = '' }: { m: MtMerchant; className?: string }) {
  return <FoodImg src={mtShopAvatarOf(m.id)} emoji={m.emoji} className={className} />;
}

/** 外卖商家卡（瀑布流）
 *  第三十八轮起封面显示商品图片；第四十轮改为单张商品图（首菜图/emoji 兜底，不再三宫格拼贴）——
 *  店铺图仅在店铺详情页展示；无「自建」角标与右上角×（删除统一收口到管理商品页）。 */
function MerchantCard({ m, onOpen }: { m: MtMerchant; onOpen: () => void }) {
  // 第四十轮：封面显示一张商品图（不再三宫格多图拼贴；店铺图仅在店铺详情页展示）
  const dish = mtDishesOf(m)[0];
  return (
    <button type="button" onClick={onOpen} className="relative mb-2 block w-full break-inside-avoid overflow-hidden rounded-xl bg-white text-left shadow-[0_1px_6px_rgba(0,0,0,0.04)] active:opacity-90">
      <FoodImg src={dish?.img} emoji={dish?.emoji ?? m.emoji} className="h-[150px] w-full" />
      {m.mine && (
        <span className="absolute left-2 top-2 rounded-md bg-[#FFD100] px-1.5 py-0.5 text-[10px] font-bold text-black/85 shadow-sm" data-testid="merchant-mine-badge">
          我的小店
        </span>
      )}
      <span className="block px-2.5 pb-2.5 pt-2">
        <span className="block truncate text-[14px] font-bold text-black/90">{m.name}</span>
        <span className="mt-1 flex items-center gap-1.5 text-[11px]">
          <span className="flex items-center gap-0.5 text-[#FF6000]">
            <Star className="h-3 w-3 fill-[#FF6000]" strokeWidth={0} />
            <span className="font-semibold">{m.rating}</span>
          </span>
          <span className="text-black/40">月售{m.monthSale >= 10000 ? `${(m.monthSale / 10000).toFixed(1)}万` : m.monthSale}+</span>
        </span>
        <span className="mt-0.5 block text-[11px] text-black/45">
          起送 ¥{m.minOrder} · 配送 ¥{m.deliveryFee} · {m.distanceKm}km
        </span>
        {m.deals[0] && (
          <span className="mt-1.5 inline-block rounded-[3px] border border-[#FF4B33]/35 px-1 py-px text-[10px] leading-[1.5] text-[#FF4B33]">{m.deals[0]}</span>
        )}
      </span>
    </button>
  );
}

const HOME_SEARCH_HINTS = ['衣服女装套装', '珍珠奶茶', '爆款汉堡4件套', '麻辣烫', '应季草莓', '电影票'];

type FeedItem = { t: 'deal'; d: MtDeal } | { t: 'list' } | { t: 'm'; m: MtMerchant };

const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** FeedItem 的展示名（刷新排重用：AI 排除名单 / 本地兜底排重） */
const feedName = (it: FeedItem): string => (it.t === 'm' ? it.m.name : it.t === 'deal' ? it.d.title : '');

/** 团购与商家交替排列（推荐流更像真实信息流） */
function interleave(deals: MtDeal[], merchants: MtMerchant[]): FeedItem[] {
  const out: FeedItem[] = [];
  let di = 0;
  let mi = 0;
  let dealTurn = Math.random() < 0.5;
  while (di < deals.length || mi < merchants.length) {
    if (dealTurn && di < deals.length) out.push({ t: 'deal', d: deals[di++] });
    else if (mi < merchants.length) out.push({ t: 'm', m: merchants[mi++] });
    else if (di < deals.length) out.push({ t: 'deal', d: deals[di++] });
    dealTurn = !dealTurn;
  }
  return out;
}

/** 首页信息流缓存：从详情页/其他 tab 返回时直接恢复，不重新生成（仅首次进入/下拉刷新/切分类才生成）；
 *  scroll=离开时的浏览位置，返回时原样恢复（不回顶部） */
const homeFeedCache: {
  ready: boolean;
  filter: string | null;
  feed: FeedItem[];
  listDeals: MtDeal[];
  listTitle: string | null;
  scroll: number;
} = { ready: false, filter: null, feed: [], listDeals: [], listTitle: null, scroll: 0 };

// ---------------- 信息流持久化（Task 46：美团点开不刷新，缓存上次刷新的内容） ----------------
// 旧口径：homeFeedCache 仅内存，页面刷新即丢 → 每次进 App 都重新生成。
// 新口径：feed 存条目引用（m=商家 id / deal=团购 id / list=聚合卡占位），listData 存团购 id，
// 连同 filter/scroll 写穿 kv；进首页时内存缓存为空则从 kv 恢复（AI 注册表先恢复才能解析 id），
// 只有用户主动下拉刷新/切分类才重新生成。

const MT_HOME_FEED_KEY = 'mt-home-feed';
const MT_HOME_SCROLL_KEY = 'mt-home-feed-scroll';
let homeFeedRestored = false;

/** 从 kv 恢复上次的美团首页信息流（幂等；内存缓存就绪时直接跳过；返回是否恢复成功） */
function mtRestoreHomeFeed(): boolean {
  if (homeFeedCache.ready) return true;
  if (homeFeedRestored) return false;
  homeFeedRestored = true;
  try {
    mtRestoreAiRegistry(); // 信息流引用的 AI 商家/团购必须先回注册表
    const v = kvGet(MT_HOME_FEED_KEY) as {
      filter?: unknown;
      items?: unknown;
      listDealIds?: unknown;
      listTitle?: unknown;
    } | null;
    if (!v || !Array.isArray(v.items)) return false;
    const feed: FeedItem[] = [];
    for (const it of v.items.slice(-80)) {
      if (!it || typeof it !== 'object') continue;
      const ref = it as { t?: unknown; id?: unknown };
      if (ref.t === 'list') feed.push({ t: 'list' });
      else if (ref.t === 'm' && typeof ref.id === 'string') {
        const m = mtMerchantOf(ref.id);
        if (m) feed.push({ t: 'm', m });
      } else if (ref.t === 'deal' && typeof ref.id === 'string') {
        const d = mtDealOf(ref.id);
        if (d) feed.push({ t: 'deal', d });
      }
    }
    if (feed.length === 0) return false;
    homeFeedCache.feed = feed;
    homeFeedCache.filter = v.filter === null || typeof v.filter === 'string' ? (v.filter as string | null) : null;
    homeFeedCache.listDeals = Array.isArray(v.listDealIds)
      ? (v.listDealIds as unknown[]).map((id) => (typeof id === 'string' ? mtDealOf(id) : undefined)).filter((d): d is MtDeal => !!d)
      : [];
    homeFeedCache.listTitle = typeof v.listTitle === 'string' ? v.listTitle : null;
    const sv = kvGet(MT_HOME_SCROLL_KEY) as unknown;
    homeFeedCache.scroll = typeof sv === 'number' && sv > 0 ? sv : 0;
    homeFeedCache.ready = true;
    return true;
  } catch {
    return false;
  }
}

/** 当前信息流写穿 kv（feed/filter/listData 变化时调用；scroll 另键节流持久化） */
function mtPersistHomeFeed(): void {
  try {
    kvSet(MT_HOME_FEED_KEY, {
      filter: homeFeedCache.filter,
      items: homeFeedCache.feed.slice(-80).map((it) =>
        it.t === 'list' ? { t: 'list' } : it.t === 'm' ? { t: 'm', id: it.m.id } : { t: 'deal', id: it.d.id },
      ),
      listDealIds: homeFeedCache.listDeals.map((d) => d.id),
      listTitle: homeFeedCache.listTitle,
    });
  } catch {
    /* 存储不可用忽略 */
  }
}

/** 浏览位置节流持久化（≤3s 一次；重开 App/刷新后回到离开时的位置） */
let lastScrollPersist = 0;
function mtPersistHomeScroll(y: number): void {
  const now = Date.now();
  if (now - lastScrollPersist < 3000) return;
  lastScrollPersist = now;
  kvSet(MT_HOME_SCROLL_KEY, y);
}

/** 本地兜底批（AI 不可用时）：种子池洗牌 + 排除已展示名称；池子耗尽 → 分店变体续流 */
function localBatch(filter: string | null, exclude: string[]): { items: FeedItem[]; listDeals: MtDeal[]; listTitle: string | null } {
  const ex = new Set(exclude);
  const target = 15 + Math.floor(Math.random() * 4);
  const out: FeedItem[] = [];
  const takeM = (m: MtMerchant) => {
    if (out.length < target && !ex.has(m.name)) {
      ex.add(m.name);
      out.push({ t: 'm', m });
    }
  };
  const takeD = (d: MtDeal) => {
    if (out.length < target && !ex.has(d.title)) {
      ex.add(d.title);
      out.push({ t: 'deal', d });
    }
  };
  if (filter === 'tuangou') {
    shuffle(MT_DEALS).forEach(takeD);
    while (out.length < target) out.push({ t: 'deal', d: MT_DEALS[Math.floor(Math.random() * MT_DEALS.length)] });
    return { items: out, listDeals: [], listTitle: null };
  }
  const merchants = filter ? MT_MERCHANTS.filter((m) => m.cats.includes(filter)) : MT_MERCHANTS;
  shuffle(merchants).forEach(takeM);
  if (!filter) shuffle(MT_DEALS).forEach(takeD);
  // 池子耗尽 → 分店变体（注册进注册表，点击可打开详情）：
  // 变体不只是换店名——评分/月售/起送/配送/距离/优惠全部随机扰动，避免「同一张卡复制 16 遍」的观感
  const BRANCHES = ['望京店', '国贸店', '五道口店', '中关村店', '亚运村店', '回龙观店', '双井店', '上地店'];
  const DEAL_POOL = ['满30减5', '满59减8', '满99减12', '新客立减4', '满39减6', '满79减10', '免配送费', '满20减3'];
  let guard = 0;
  while (out.length < target && merchants.length > 0 && guard < BRANCHES.length * 3) {
    const base = merchants[Math.floor(Math.random() * merchants.length)];
    // 分店名从基名剥离原「（…店）」尾缀再拼新分店，避免「xx（解放路店）·望京店」式长名被截断成同名卡
    const stem = base.name.replace(/（[^）]*）$/, '');
    const name = `${stem}·${BRANCHES[guard % BRANCHES.length]}`;
    guard++;
    if (ex.has(name)) continue; // 分店撞名（池子极小且刷新多轮）：跳过，不产出同名卡
    ex.add(name);
    const clone: MtMerchant = {
      ...base,
      id: `ai-m-local-${Date.now().toString(36)}-${guard}`,
      name,
      rating: Math.round(Math.min(4.9, Math.max(3.8, base.rating + (Math.random() * 0.5 - 0.35))) * 10) / 10,
      monthSale: 300 + Math.floor(Math.random() * 8000),
      minOrder: [0, 0, 15, 20, 30][Math.floor(Math.random() * 5)],
      deliveryFee: Math.round(Math.random() * 4 * 10) / 10,
      distanceKm: Math.round((0.3 + Math.random() * 6.5) * 10) / 10,
      deliveryMin: 25 + Math.floor(Math.random() * 45),
      deals: [DEAL_POOL[Math.floor(Math.random() * DEAL_POOL.length)]],
    };
    mtRegisterAiMerchant(clone);
    out.push({ t: 'm', m: clone });
  }
  // 特价团聚合卡兜底：种子聚合卡
  const seedDeals = MT_HOME_LIST.dealIds
    .map((id) => MT_DEALS.find((d) => d.id === id))
    .filter((d): d is MtDeal => !!d)
    .slice(0, 2);
  return { items: out, listDeals: filter === null ? seedDeals : [], listTitle: filter === null ? MT_HOME_LIST.title : null };
}

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
type SearchHit = { t: 'm'; m: MtMerchant } | { t: 'd'; m: MtMerchant; d: MtDish };

/** 搜索相关性打分：名称命中 > 菜品命中 > 分类命中 > 分节命中；0 分 = 不相关（不再进结果池） */
function searchScore(m: MtMerchant, kw: string): number {
  let s = 0;
  if (m.name.includes(kw)) s += 4;
  if (mtDishesOf(m).some((d) => d.name.includes(kw))) s += 3;
  if (m.cats.some((c) => { const n = MT_CATS.find((x) => x.id === c)?.name; return !!n && (n.includes(kw) || kw.includes(n)); })) s += 2;
  if (m.sections.some((sec) => sec.cat.includes(kw))) s += 1;
  return s;
}

/** 组装搜索池：相关性优先；「猜你喜欢」只从相关商家（同分类延伸）补齐，不再全库硬凑（修复搜「奶茶」混出药房/汉堡） */
function makeSearchPool(kw: string): { hits: SearchHit[]; pool: SearchHit[] } {
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
const searchBatchSize = () => 15 + Math.floor(Math.random() * 6);

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
const SEARCH_TOP = ['奶茶', '麻辣烫', '汉堡', '火锅', '水果', '比萨', '药品', '盖浇饭', '咖啡', '早餐'];

/** 搜索结果商家行（列表式） */
function SearchMerchantRow({ m, onOpen }: { m: MtMerchant; onOpen: () => void }) {
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
            <div className="mt-2.5 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="mt-shop-coupons">
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
const ICBC_OFF = 2.28;

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
function ProxySheet({
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
function MtShareGlyph({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* 向上箭头（穿出托盘） */}
      <path d="M12 3.2v10.3" />
      <path d="M8.4 6.6 12 3l3.6 3.6" />
      {/* 圆角托盘（顶部开口，箭头从中穿出） */}
      <path d="M8.6 10.6H7.4A2.9 2.9 0 0 0 4.5 13.5v4.6a2.9 2.9 0 0 0 2.9 2.9h9.2a2.9 2.9 0 0 0 2.9-2.9v-4.6a2.9 2.9 0 0 0-2.9-2.9h-1.2" />
    </svg>
  );
}

/** 订单分享弹层：第一步选平台（微信/QQ好友），第二步选联系人 → 动态订单卡片进好友聊天（与找人代付同交互） */
function ShareSheet({
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
        <div className="mt-3 text-[17px] font-bold text-[#26262b]">{step === 'contact' && plat ? `分享到${platName}` : step === 'plat' ? '分享订单' : ''}</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[#9a9aa2]">
          {step === 'plat' ? '把订单动态卡片发给好友，买的什么、金额、配送状态都会实时同步' : `从${platName}好友里选一位分享本单动态`}
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
                data-testid={`share-plat-${v}`}
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
                <p className="mt-1 text-[11px] text-black/30">先去{platName}App添加好友，再回来分享订单</p>
              </div>
            ) : (
              friends.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`share-contact-${c.id}`}
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
              data-testid="share-send"
              disabled={!contactId || sending}
              onClick={onSend}
              className={`h-12 flex-1 rounded-2xl text-[15.5px] font-semibold ${contactId && !sending ? 'bg-[linear-gradient(135deg,#ffd100,#ffb62e)] text-black/85 shadow-[0_5px_14px_rgba(255,182,46,0.35)] active:opacity-85' : 'bg-[#f6ec9f] text-black/40'}`}
            >
              {sending ? '正在发送…' : '分享给TA'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

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

// ================================ 订单列表页（截图5） ================================

const ORDER_TABS: { key: string; match: (o: MtOrder) => boolean }[] = [
  { key: '全部', match: () => true },
  { key: '待付款', match: (o) => o.status === 'pendingPay' },
  { key: '待收货/待使用', match: (o) => o.status === 'pendingAccept' || o.status === 'accepted' || o.status === 'delivering' },
  { key: '评价', match: (o) => o.status === 'completed' },
  // 退款/售后：只显示买了以后退款的（有退款记录的已支付订单；未支付就取消的不算售后）
  { key: '退款/售后', match: (o) => !!o.refund },
];

/** 订单筛选（顶栏筛选按钮：状态细分，与页签叠加） */
type OrderFilterKey = 'all' | 'pendingPay' | 'live' | 'delivering' | 'completed' | 'canceled';
const ORDER_FILTERS: { key: OrderFilterKey; label: string; match: (o: MtOrder) => boolean }[] = [
  { key: 'all', label: '全部', match: () => true },
  { key: 'pendingPay', label: '待付款', match: (o) => o.status === 'pendingPay' },
  { key: 'live', label: '进行中', match: (o) => o.status === 'pendingAccept' || o.status === 'accepted' },
  { key: 'delivering', label: '配送中', match: (o) => o.status === 'delivering' },
  { key: 'completed', label: '已送达', match: (o) => o.status === 'completed' },
  { key: 'canceled', label: '已取消', match: (o) => o.status === 'canceled' },
];

function OrdersPage({
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
        {/* 页签 */}
        <div className="mt-2.5 flex gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ORDER_TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`relative shrink-0 pb-2.5 text-[16px] ${tab === t.key ? 'font-bold text-black/90' : 'text-black/55'}`}>
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
const MT_ROAD_POOL = ['解放大道', '红旗路', '建设路', '朝阳路', '人民路', '文化路', '东风路', '新华路', '学院路', '濮上中路'];

/** 配送路线二次贝塞尔曲线（与 SVG path M 75 139 Q 241 92 443 177 同一条，viewBox 500×208） */
const MT_ROUTE_P0: [number, number] = [75, 139];
const MT_ROUTE_PC: [number, number] = [241, 92];
const MT_ROUTE_P1: [number, number] = [443, 177];

function DeliveryMap({
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
function InfoRow({ k, v, action }: { k: string; v: string; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-[7px]">
      <span className="w-[60px] shrink-0 text-[13px] leading-[1.5] text-black/35">{k}</span>
      <span className="min-w-0 flex-1 break-all text-[13px] leading-[1.5] text-black/80">{v}</span>
      {action}
    </div>
  );
}

/** 团购标题里带的数量（如「厚芋泥奶茶 经典芋泥 3杯」「A套餐·经典芋泥3杯」）在订单详情里不再显示：
 *  商品行已有 ×N 数量列，再带「3杯」读起来重复；历史订单（已落库的旧名称）渲染时同样生效 */
const stripDealQty = (s: string): string =>
  s
    .replace(/\s*\d+杯/g, '')
    .replace(/（\s*）/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[·、]\s*$/u, '')
    .trim();

function OrderDetailPage({
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
          <div className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {helpPills.map((p) => (
              <button key={p.t} type="button" onClick={p.a} className="shrink-0 whitespace-nowrap rounded-full bg-[#F5F6F7] px-3.5 py-2 text-[12px] text-black/65 active:bg-black/10">
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
function SmallPill({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ml-1 shrink-0 rounded-full border border-black/15 px-2.5 py-1 text-[11px] leading-none text-black/60 active:bg-black/5">
      {children}
    </button>
  );
}

/** 复制按钮 */
function CopyBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ml-1 shrink-0 rounded-full border border-black/15 px-2.5 py-1 text-[11px] leading-none text-black/60 active:bg-black/5">
      复制
    </button>
  );
}

// ================================ 团购详情页（截图6） ================================

function DealDetailPage({ deal, onBack, onBuy, onOpenMerchant, onToast }: { deal: MtDeal; onBack: () => void; onBuy: (mode: 'group' | 'direct') => void; onOpenMerchant: (id: string) => void; onToast: (m: string) => void }) {
  const merchant = mtMerchantOf(deal.merchantId);
  const groupPrice = deal.groupPrice ?? Math.max(0.1, Math.round((deal.price - 2) * 10) / 10);
  const { favs, toggle } = useFavs();
  const dealFav = favs.deals.includes(deal.id);
  // 第三十九轮：点头图 → AI 生图弹层（选模型+可编辑提示词，生成的图 mutate+kv 持久化永久保存）
  const [dealGenOpen, setDealGenOpen] = useState(false);
  const [dealGenBusy, setDealGenBusy] = useState(false);
  const [dealGenErr, setDealGenErr] = useState('');
  const [dealImgTick, setDealImgTick] = useState(0);
  void dealImgTick;
  const genDealImg = async (prompt: string, cfg: ImgGenConfig & { mode?: 'proxy' | 'direct' }) => {
    setDealGenBusy(true);
    setDealGenErr('');
    try {
      const src = await generateFreePhoto(cfg, prompt);
      mtSetDealImg(deal.id, src);
      setDealImgTick((t) => t + 1); // deal 对象已 mutate，tick 触发重渲染显示新图
      setDealGenOpen(false);
      onToast('图片已生成并保存');
    } catch (e) {
      setDealGenErr(e instanceof Error ? e.message : '生成失败，请重试');
    } finally {
      setDealGenBusy(false);
    }
  };
  if (!merchant) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <p className="text-[13px] text-black/40">团购不存在</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 头图 + 悬浮搜索（第三十九轮：点图可 AI 生成；套餐缩略条已删，图延伸显示） */}
        <div className="relative h-[340px]">
          <button type="button" aria-label="点击生成团购图片" data-testid="mt-deal-imggen" onClick={() => setDealGenOpen(true)} className="block h-full w-full active:opacity-95">
            <FoodImg src={deal.img} emoji={deal.emoji} className="h-full w-full" />
          </button>
          <div className="absolute inset-x-0 top-0 flex items-center gap-2 px-3 pt-[54px]">
            <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/35 text-white active:opacity-75">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => onToast('搜索（演示）')} className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-white/95 px-3">
              <SearchIcon className="h-3.5 w-3.5 shrink-0 text-black/40" />
              <span className="truncate text-[13px] text-black/70">{merchant.name.split('（')[0]}</span>
              <span className="ml-auto shrink-0 rounded-full bg-[#FFD100] px-3 py-1 text-[12px] font-medium text-black/85">搜索</span>
            </button>
            <button
              type="button"
              aria-label="收藏团购"
              onClick={() => onToast(toggle('deals', deal.id) ? '已收藏，可在收藏中查看' : '已取消收藏')}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/35 text-white active:opacity-75"
            >
              <Star className={`h-4 w-4 ${dealFav ? 'fill-[#FFD100] text-[#FFD100]' : ''}`} />
            </button>
            <button type="button" aria-label="分享" onClick={() => onToast('分享（演示）')} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/35 text-white active:opacity-75">
              <MtShareGlyph className="h-4 w-4" />
            </button>
          </div>
          <span className="absolute bottom-3 right-3 rounded-full bg-black/45 px-2 py-0.5 text-[10px] text-white">1/3</span>
        </div>

        {/* 价格块（粉）+ 标题/须知/门店/规则/详情（第三十九轮：套餐缩略条已删，价格块紧贴延伸后的头图） */}
        <div className="overflow-hidden border-b-[7px] border-[#F5F6F7]">
          <div className="bg-gradient-to-r from-[#FF2D7E] to-[#FF5E9E] px-4 pb-3 pt-3">
            <div className="flex items-center gap-1.5">
              <p className="flex shrink-0 items-baseline whitespace-nowrap leading-none">
                <span className="text-[15px] font-bold text-[#A5001F]">¥</span>
                <span className="text-[28px] font-bold tracking-tight text-[#A5001F]">{fmtMoney(deal.price)}</span>
              </p>
              <span className="shrink-0 whitespace-nowrap rounded-full bg-white px-1.5 py-[3px] text-[11px] font-semibold leading-none text-[#FF2D7E]">
                {deal.discount}
              </span>
              <span className="shrink-0 whitespace-nowrap text-[12px] leading-none text-white/85 line-through">¥{fmtMoney(deal.origPrice)}</span>
              <span className="min-w-0 flex-1 truncate whitespace-nowrap text-right text-[12px] leading-none text-white/90">{deal.sold}</span>
              <span className="shrink-0 rounded-lg bg-[#E6197A] px-2 py-1 text-center text-[10px] font-bold leading-[1.35] text-white">
                <span className="block whitespace-nowrap">限量·低价</span>
                <span className="block whitespace-nowrap">特价团</span>
              </span>
            </div>
            <p className="mt-1.5 flex items-center gap-1 whitespace-nowrap text-[12px] text-white/95">
              <Zap className="h-3.5 w-3.5 shrink-0" />
              品牌新客价
            </p>
          </div>

          <div className="bg-white px-4 pb-4 pt-3">
            <p className="text-[18px] font-bold leading-snug text-black/90">{deal.title}</p>
            <div className="mt-2.5 flex items-center gap-1.5 text-[12px]">
              <span className="text-black/35">需知</span>
              <span className="rounded-[3px] border border-[#FF2D7E]/45 px-1 py-px text-[10px] text-[#FF2D7E]">{deal.tips}</span>
              <span className="rounded-[3px] border border-[#FF2D7E]/45 px-1 py-px text-[10px] text-[#FF2D7E]">到店取</span>
              <span className="min-w-0 flex-1 truncate text-black/45">{deal.usable} · 随时退 · 过期自动退</span>
            </div>

            <button type="button" onClick={() => onOpenMerchant(merchant.id)} className="mt-4 flex w-full items-center text-left">
              <span className="text-[15px] font-bold text-black/85">适用门店</span>
              <span className="ml-auto text-[12px] text-black/45">5家门店通用</span>
            </button>
            <div className="mt-2 rounded-xl bg-[#F7F8FA] p-3">
              <div className="flex items-center gap-2.5">
                <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-white shadow-sm">
                  <ShopAvatar m={merchant} className="h-full w-full" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-[15px] font-bold text-black/85">
                    {merchant.name}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12px]">
                    <span className="flex items-center gap-0.5 text-[#FF6000]">
                      <Star className="h-3 w-3 fill-[#FF6000]" strokeWidth={0} />
                      <span className="font-semibold">{merchant.rating}</span>
                    </span>
                    <span className="text-black/45">{MT_CATS.find((c) => c.id === merchant.cats[0])?.name ?? '美食'}</span>
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {deal.storeTags.map((t, i) => (
                  <span key={t} className={`rounded-[3px] px-1.5 py-0.5 text-[10px] ${i === 0 ? 'bg-[#FFF3B8] text-[#B77900]' : 'border border-black/10 bg-white text-black/45'}`}>
                    {t}
                  </span>
                ))}
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-black/60">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-black/40" />
                <span className="truncate">距您{deal.distanceKm}km，{merchant.addr}</span>
              </p>
              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-black/60">
                <ClockIcon className="h-3.5 w-3.5 shrink-0 text-black/40" />
                营业中 {merchant.hours}
              </p>
            </div>

            {/* 拼团规则 */}
            <div className="mt-4 flex items-center">
              <span className="text-[15px] font-bold text-black/85">拼团规则</span>
              <span className="ml-auto text-[12px] text-black/45">查看拼团规则</span>
            </div>
            <div className="mt-2.5 flex items-center text-[12px] text-black/60">
              <span className="flex items-center gap-1"><Receipt className="h-3.5 w-3.5" />下单支付</span>
              <span className="mx-2 flex-1 border-t border-dashed border-black/20" />
              <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />邀请新用户拼团</span>
              <span className="mx-2 flex-1 border-t border-dashed border-black/20" />
              <span className="flex items-center gap-1"><PartyPopper className="h-3.5 w-3.5" />人满成团</span>
            </div>
          </div>
        </div>

        {/* 团购详情 */}
        <div className="border-y-[7px] border-[#F5F6F7] px-4 py-4">
          <p className="text-[16px] font-bold text-black/85">团购详情</p>
          {/* 可选套餐清单（与购买弹窗内选择一致） */}
          {(deal.packages?.length ?? 0) > 1 && (
            <div className="mt-3">
              <p className="text-[14px] font-bold text-black/80">可选套餐</p>
              <div className="mt-2 space-y-2">
                {deal.packages!.map((p, i) => (
                  <div key={`${p.name}-${i}`} className="rounded-lg bg-[#FFF3F8] p-2.5">
                    <p className="flex items-center gap-2 text-[13px] font-semibold text-black/80">
                      <span className="shrink-0 rounded bg-[#FF2D7E] px-1 py-px text-[10px] font-bold text-white">{String.fromCharCode(65 + i)}</span>
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="shrink-0 font-bold text-[#FF2D7E]">¥{fmtMoney(p.price)}</span>
                    </p>
                    {p.items && p.items.length > 0 && <p className="mt-1 text-[11px] leading-relaxed text-black/50">{p.items.join(' / ')}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {deal.menu.map((sec) => (
            <div key={sec.sec} className="mt-3">
              <p className="text-[14px] font-bold text-black/80">{sec.sec}</p>
              <div className="mt-1.5 space-y-2">
                {sec.items.map((it, i) => (
                  <p key={`${it.name}-${i}`} className="flex items-baseline gap-2 text-[13px]">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-black/25" />
                    <span className="min-w-0 flex-1 text-black/75">{it.name}</span>
                    <span className="shrink-0 text-black/40">（1份）</span>
                    <span className="shrink-0 font-medium text-black/80">¥{fmtMoney(it.price)}</span>
                  </p>
                ))}
              </div>
            </div>
          ))}
          <p className="mt-3 border-t border-black/5 pt-2.5 text-[12px] text-black/40">备注：【温馨提示】具体产品过敏原信息请查看商家小程序产品界面</p>
        </div>
      </div>

      {/* 底部：拼团 + 直接购买 */}
      <div className="shrink-0 border-t border-black/5 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onBuy('group')}
            className="flex h-12 flex-1 items-center justify-center gap-1 rounded-full border-[1.5px] border-[#FF2D7E] text-[#FF2D7E] active:opacity-80"
          >
            <span className="text-[17px] font-bold">¥{fmtMoney(groupPrice)}</span>
            <span className="text-[13px]">2人拼团</span>
          </button>
          <button
            type="button"
            onClick={() => onBuy('direct')}
            className="flex h-12 flex-1 items-center justify-center gap-1 rounded-full bg-gradient-to-r from-[#FF2D7E] to-[#FF5E9E] text-white shadow-sm active:opacity-85"
          >
            <span className="text-[17px] font-bold">¥{fmtMoney(deal.price)}</span>
            <span className="text-[15px] font-medium">直接购买</span>
          </button>
        </div>
      </div>

      {/* 团购图生成弹层（第三十九轮：点头图 → 选模型+可编辑提示词，生成结果持久化） */}
      <OrderImgGenSheet
        open={dealGenOpen}
        title="生成团购图片"
        initialPrompt={libPromptTextMulti(['lib:meituan-6'], { title: deal.title }, `${deal.title}，真实感商品照片，明亮色泽，特写构图`) ?? ''}
        busy={dealGenBusy}
        error={dealGenErr}
        accent="#FF2D7E"
        onSubmit={(p, cfg) => void genDealImg(p, cfg)}
        onClose={() => (dealGenBusy ? undefined : setDealGenOpen(false))}
      />
    </div>
  );
}

// ================================ 自建商品详情页（第三十九轮：点自建商品卡直达，不再是店铺详细界面） ================================

function MtCustomProductPage({
  session,
  merchant,
  onBack,
  onCheckout,
  onToast,
}: {
  session: MtSession;
  merchant: MtMerchant;
  onBack: () => void;
  /** 立即购买确认后打开结算弹层（购物车已写好本商品） */
  onCheckout: (mid: string) => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const dish = merchant.sections[0]?.dishes[0];
  const [tick, setTick] = useState(0);
  void tick; // 商品图 mutate 后触发重渲染
  // 生图弹层（第三十九轮：详情页点图也能用 API 图像生成模型生成，结果持久化）
  const [genOpen, setGenOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genErr, setGenErr] = useState('');
  // 规格选择（有规格先弹规格弹窗再结算；复用 DishSpecSheet）
  const [specOpen, setSpecOpen] = useState(false);
  const genImg = async (prompt: string, cfg: ImgGenConfig & { mode?: 'proxy' | 'direct' }) => {
    if (!dish) return;
    setGenBusy(true);
    setGenErr('');
    try {
      const src = await generateFreePhoto(cfg, prompt);
      mtSetProductImg(dish.id, src);
      setTick((t) => t + 1);
      setGenOpen(false);
      onToast('图片已生成并保存');
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : '生成失败，请重试');
    } finally {
      setGenBusy(false);
    }
  };
  if (!dish) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <p className="text-[13px] text-black/40">商品不存在</p>
      </div>
    );
  }
  const type = dish.custom?.type || (merchant.notice?.startsWith('自建商品 · ') ? merchant.notice.slice('自建商品 · '.length) : '');
  const groups = dish.custom?.optionGroups ?? [];
  /** 立即购买：写购物车（本商品单独结算语义，替换跨店残留）→ 打开结算弹层 */
  const buy = ({ qty, spec, unitPrice }: { qty: number; spec: string; unitPrice: number }) => {
    mtSaveCart(uid, {
      merchantId: merchant.id,
      items: [{ dishId: dish.id, qty, ...(spec ? { spec } : {}), ...(unitPrice > dish.price ? { unitPrice } : {}) }],
    });
    onCheckout(merchant.id);
  };
  const directBuy = () => {
    if ((dish.specs?.length ?? 0) > 0) {
      setSpecOpen(true);
      return;
    }
    buy({ qty: 1, spec: '', unitPrice: dish.price });
  };

  return (
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 大图（点图可 AI 生成） */}
        <div className="relative h-[340px] bg-white">
          <button type="button" aria-label="点击生成商品图片" data-testid="mt-custom-imggen" onClick={() => setGenOpen(true)} className="block h-full w-full active:opacity-95">
            <FoodImg src={dish.img} emoji={dish.emoji} className="h-full w-full" />
          </button>
          <div className="absolute inset-x-0 top-0 flex items-center px-3 pt-[54px]">
            <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-black/35 text-white active:opacity-75">
              <ChevronLeft className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 价格 + 标题 + 类型/规格 */}
        <div className="bg-white px-4 pb-4 pt-3">
          <div className="flex items-baseline gap-2">
            <span className="text-[26px] font-bold leading-none" style={{ color: MT_PRICE }}>
              <span className="text-[15px]">¥</span>
              {fmtMoney(dish.price)}
            </span>
            {dish.coupon ? <span className="rounded-[3px] bg-[#FFE8F1] px-1.5 py-0.5 text-[11px] font-medium text-[#FF2D7E]">{dish.coupon.name} 下单减¥{fmtMoney(dish.coupon.amount)}</span> : null}
            <span className="ml-auto text-[11px] text-black/35">月售{dish.monthSale}+</span>
          </div>
          <p className="mt-2 text-[17px] font-bold leading-snug text-black/90">{dish.name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {type ? <span className="rounded-[4px] bg-[#FFF3DC] px-1.5 py-0.5 text-[11px] font-medium text-[#B77900]">{type}</span> : null}
            {groups.map((g) => (
              <span key={g.name} className="rounded-[4px] bg-black/[0.04] px-1.5 py-0.5 text-[11px] text-black/55">
                {g.name}：{g.values.join('、')}
              </span>
            ))}
          </div>
          {/* 保障行（对齐真机商品详情的放心买条） */}
          <div className="mt-3 flex items-center gap-3 border-t border-black/5 pt-2.5 text-[11px] text-black/45">
            <span className="flex items-center gap-1"><Check className="h-3 w-3 text-[#FF6000]" strokeWidth={3} />正品保障</span>
            <span className="flex items-center gap-1"><Check className="h-3 w-3 text-[#FF6000]" strokeWidth={3} />随时退</span>
            <span className="flex items-center gap-1"><Check className="h-3 w-3 text-[#FF6000]" strokeWidth={3} />过期自动退</span>
          </div>
        </div>

        {/* 店铺信息行（纯展示，点击商品不再进店铺页） */}
        <div className="mt-2 flex items-center gap-2.5 bg-white px-4 py-3">
          <FoodImg src={mtShopAvatarOf(merchant.id)} emoji={merchant.emoji} className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold text-black/85">{merchant.name}</p>
            <p className="text-[11px] text-black/40">线上商品 · 全国包邮</p>
          </div>
        </div>
      </div>

      {/* 底部：立即购买 */}
      <div className="shrink-0 border-t border-white/60 bg-white/80 backdrop-blur-2xl backdrop-saturate-150 px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <button
          type="button"
          data-testid="mt-custom-buy"
          onClick={directBuy}
          className="h-12 w-full rounded-full bg-gradient-to-r from-[#FFD100] to-[#FF9500] text-[16px] font-bold text-black/90 shadow-sm active:opacity-85"
        >
          立即购买
        </button>
      </div>

      {/* 规格弹窗（有规格先选规格再结算；弹窗内菜品图同样可点生成） */}
      <AnimatePresence>
        {specOpen && (
          <DishSpecSheet
            dish={dish}
            onClose={() => setSpecOpen(false)}
            onConfirm={(payload) => {
              setSpecOpen(false);
              buy(payload);
            }}
            onGenDish={() => setGenOpen(true)}
          />
        )}
      </AnimatePresence>

      {/* 商品图生成弹层 */}
      <OrderImgGenSheet
        open={genOpen}
        title="生成商品图片"
        initialPrompt={libPromptTextMulti(['lib:meituan-7'], { name: dish.name }, `${dish.name}，真实感商品照片，明亮色泽，特写构图`) ?? ''}
        busy={genBusy}
        error={genErr}
        accent="#FF6000"
        onSubmit={(p, cfg) => void genImg(p, cfg)}
        onClose={() => (genBusy ? undefined : setGenOpen(false))}
      />
    </div>
  );
}

// ================================ 团购确认订单弹窗（截图7：面板外顶部提示条 + 特价团粉横幅） ================================

function DealConfirmSheet({
  deal,
  mode,
  onClose,
  onOpenPay,
  onToast,
}: {
  deal: MtDeal;
  mode: 'group' | 'direct';
  onClose: () => void;
  onOpenPay: (o: MtOrder) => void;
  onToast: (m: string) => void;
}) {
  const session = mtGetSession();
  const uid = session ? mtUidOf(session) : '';
  const merchant = mtMerchantOf(deal.merchantId);
  const [qty, setQty] = useState(1);
  // 可选套餐（购买弹窗内单选：选中后价格/内容/订单项联动；无套餐数据时回退单体套餐不出选择器）
  const pkgs: MtDealPackage[] =
    deal.packages && deal.packages.length > 0
      ? deal.packages
      : [{ name: deal.title, price: deal.price, origPrice: deal.origPrice }];
  const hasPkgs = (deal.packages?.length ?? 0) > 0;
  const [selPkg, setSelPkg] = useState(0);
  const pkg = pkgs[Math.min(selPkg, pkgs.length - 1)];
  // 规格/小料（购买弹窗内选择：奶茶=规格/温度/小料/糖度，食物=小料配菜；加价计入实付）
  const specs = deal.specs ?? [];
  const [selSpec, setSelSpec] = useState<Record<string, string[]>>(() => {
    const m: Record<string, string[]> = {};
    for (const g of specs) m[g.name] = g.multi ? [] : [g.options[0]?.label ?? ''];
    return m;
  });
  const specOptPrice = (gName: string, label: string): number => specs.find((g) => g.name === gName)?.options.find((o) => o.label === label)?.price ?? 0;
  const tapSpec = (gName: string, label: string) => {
    const g = specs.find((x) => x.name === gName);
    if (!g) return;
    setSelSpec((prev) => {
      const cur = prev[gName] ?? [];
      if (g.multi) {
        const has = cur.includes(label);
        if (has) return { ...prev, [gName]: cur.filter((x) => x !== label) };
        const max = g.max ?? g.options.length;
        if (cur.length >= max) return { ...prev, [gName]: [...cur.slice(1), label] };
        return { ...prev, [gName]: [...cur, label] };
      }
      return { ...prev, [gName]: [label] };
    });
  };
  const specExtra = specs.reduce((s, g) => s + (selSpec[g.name] ?? []).reduce((t, l) => t + specOptPrice(g.name, l), 0), 0);
  const specText = specs
    .map((g) => (selSpec[g.name] ?? []).join('、'))
    .filter(Boolean)
    .join('/');
  // 菜单 N选1 分组（如「鲜果 3选1」「比萨 4选1」）：购买弹窗内必选，默认选前 M 项；价格已含在套餐内
  const choiceGroups = deal.menu
    .filter((s) => MT_CHOICE_RE.test(s.sec) && s.items.length > 0)
    .map((s) => {
      const m = MT_CHOICE_RE.exec(s.sec);
      const pick = Math.max(1, Math.min(m ? Number(m[2]) || 1 : 1, 3));
      return { name: s.sec, pick, multi: pick > 1, options: s.items.slice(0, 8).map((it) => ({ label: it.name })) };
    });
  const [selChoice, setSelChoice] = useState<Record<string, string[]>>(() => {
    const m: Record<string, string[]> = {};
    for (const g of choiceGroups) m[g.name] = g.options.slice(0, g.pick).map((o) => o.label);
    return m;
  });
  const tapChoice = (gName: string, label: string) => {
    const g = choiceGroups.find((x) => x.name === gName);
    if (!g) return;
    setSelChoice((prev) => {
      const cur = prev[gName] ?? [];
      if (g.multi) {
        const has = cur.includes(label);
        if (has) return { ...prev, [gName]: cur.filter((x) => x !== label) };
        if (cur.length >= g.pick) return { ...prev, [gName]: [...cur.slice(1), label] };
        return { ...prev, [gName]: [...cur, label] };
      }
      return { ...prev, [gName]: [label] };
    });
  };
  const choiceText = choiceGroups.map((g) => (selChoice[g.name] ?? []).join('、')).filter(Boolean).join('；');
  // 优惠券（到店券）
  const [selCoupon, setSelCoupon] = useState<MtCoupon | null>(null);
  const [couponPick, setCouponPick] = useState(false);
  // 有套餐时：直接购买 = 所选套餐价；拼团 = 套餐价 - 2；无套餐保持原逻辑
  const baseDealPrice =
    mode === 'group'
      ? hasPkgs
        ? Math.max(0.1, Math.round((pkg.price - 2) * 10) / 10)
        : (deal.groupPrice ?? Math.max(0.1, Math.round((deal.price - 2) * 10) / 10))
      : pkg.price;
  const unitPrice = Math.max(0.1, Math.round((baseDealPrice + specExtra) * 100) / 100);
  const itemTotal = Math.round((pkg.origPrice ?? deal.origPrice) * qty * 100) / 100;
  const baseTotal = Math.round(unitPrice * qty * 100) / 100;
  const couponOff = selCoupon ? Math.min(selCoupon.amount, Math.max(0.01, baseTotal - 0.01)) : 0;
  const total = Math.max(0.01, Math.round((baseTotal - couponOff) * 100) / 100);
  const discount = Math.round((itemTotal - total) * 100) / 100;
  const usableCoupons = uid ? mtListUsableCoupons(uid, 'daodian', baseTotal) : { usable: [], others: [] };

  const submit = () => {
    if (!merchant || !uid) {
      onToast('数据异常，请返回重试');
      return;
    }
    const now = Date.now();
    const order: MtOrder = {
      id: `mt${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      uid,
      merchantId: merchant.id,
      merchantName: merchant.name,
      merchantEmoji: merchant.emoji,
      merchantImg: merchant.cover,
      kind: 'tuangou',
      items: [
        {
          dishId: deal.id,
          name: hasPkgs && pkgs.length > 1 ? `${deal.title}（${pkg.name}）` : deal.title,
          price: pkg.origPrice ?? deal.origPrice,
          qty,
          emoji: deal.emoji,
          img: deal.img,
          spec: [hasPkgs && pkgs.length > 1 ? pkg.name : '', choiceText, specText].filter(Boolean).join(' / ') || undefined,
        },
      ],
      itemTotal,
      deliveryFee: 0,
      discount,
      couponId: selCoupon?.id,
      couponAmount: couponOff > 0 ? couponOff : undefined,
      total,
      status: 'pendingPay',
      createdAt: now,
      statusLog: [{ status: 'pendingPay', at: now }],
    };
    if (selCoupon) mtUseCoupon(uid, selCoupon.id);
    const list = mtLoadOrders(uid);
    mtSaveOrders(uid, [order, ...list]);
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    onClose();
    onOpenPay(order);
  };

  return (
    <motion.div className="absolute inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
      {/* 遮罩：点击弹窗外任意区域关闭（需求：点击别的地方弹窗消失） */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <motion.div
        className="absolute inset-x-0 bottom-0 top-[64px] flex flex-col overflow-hidden rounded-t-[20px] bg-white/80 backdrop-blur-2xl backdrop-saturate-150"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.34 }}
      >
        {/* 特价团粉横幅（面板顶部，对齐截图7） */}
        <div className="flex shrink-0 items-center gap-2 bg-[#FF2D7E] px-4 py-2.5">
          <span className="flex items-center whitespace-nowrap text-[16px] font-bold text-white">
            特
            <Zap className="h-[13px] w-[13px] fill-[#FFD100] text-[#FFD100]" strokeWidth={0} />
            价团
          </span>
          <span className="text-[13px] text-white">本单为你额外节省{fmtMoney(discount)}元</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div>
            {/* 商品卡 */}
            <div className="px-4 py-3.5">
              <div className="flex gap-3">
                <FoodImg src={deal.img} emoji={deal.emoji} className="h-[84px] w-[84px] shrink-0 rounded-xl" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="text-[15px] font-bold leading-snug text-black/90">{deal.title}</p>
                  <p className="mt-1 flex items-center gap-1 text-[12px] text-black/45">
                    {deal.usable}
                    <span className="grid h-3.5 w-3.5 place-items-center rounded-full border border-black/20 text-[9px] text-black/40">?</span>
                  </p>
                  <div className="mt-auto flex items-end justify-between">
                    <span className="text-[15px] font-bold text-black/85">¥{fmtMoney(pkg.origPrice ?? deal.origPrice)}</span>
                    <Stepper
                      qty={qty}
                      onAdd={() => setQty((q) => Math.min(9, q + 1))}
                      onDec={() => setQty((q) => Math.max(1, q - 1))}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 选择套餐（可选套餐单选，选中后价格/内容联动） */}
            {pkgs.length > 1 && (
              <div className="border-t border-black/5 px-4 py-3.5">
                <p className="text-[14px] font-semibold text-black/80">选择套餐</p>
                <div className="mt-2.5 space-y-2">
                  {pkgs.map((p, i) => {
                    const on = i === selPkg;
                    return (
                      <button
                        key={`${p.name}-${i}`}
                        type="button"
                        onClick={() => setSelPkg(i)}
                        aria-pressed={on}
                        className={`flex w-full items-start gap-2.5 rounded-xl border-[1.5px] p-3 text-left transition-colors ${
                          on ? 'border-[#FF2D7E] bg-[#FFEBF3]' : 'border-transparent bg-[#F5F6F7]'
                        }`}
                      >
                        <span
                          className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px] ${
                            on ? 'border-[#FF2D7E]' : 'border-black/25'
                          }`}
                        >
                          {on && <span className="h-2 w-2 rounded-full bg-[#FF2D7E]" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[14px] font-medium text-black/85">{p.name}</span>
                            <span className="ml-auto shrink-0 text-[15px] font-bold" style={{ color: MT_PINK }}>
                              ¥{fmtMoney(p.price)}
                            </span>
                          </span>
                          {p.items && p.items.length > 0 && (
                            <span className="mt-1 block line-clamp-2 text-[11px] leading-relaxed text-black/45">{p.items.join(' / ')}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 选择内容（菜单 N选1 分组必选：鲜果 3选1 / 比萨 4选1 等，价格已含在套餐内） */}
            {choiceGroups.length > 0 && (
              <div className="border-t border-black/5 px-4 py-3.5">
                <p className="text-[14px] font-semibold text-black/80">选择内容</p>
                {choiceGroups.map((g) => (
                  <div key={g.name} className="mt-3">
                    <p className="text-[12px] text-black/50">{g.multi ? `${g.name}（选${g.pick}样）` : g.name}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {g.options.map((o) => {
                        const on = (selChoice[g.name] ?? []).includes(o.label);
                        return (
                          <button
                            key={o.label}
                            type="button"
                            onClick={() => tapChoice(g.name, o.label)}
                            aria-pressed={on}
                            className={`flex min-h-[38px] items-center justify-center rounded-lg px-1.5 text-[13px] transition-colors ${
                              on ? 'border-[1.5px] border-[#FF2D7E] bg-[#FFEBF3] font-medium text-[#FF2D7E]' : 'border-[1.5px] border-transparent bg-[#F5F6F7] text-black/80'
                            }`}
                          >
                            <span className="truncate">{o.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 规格/小料（购买弹窗内选择：奶茶=规格/温度/小料/糖度，食物=小料配菜，加价计入实付） */}
            {specs.length > 0 && (
              <div className="border-t border-black/5 px-4 py-3.5">
                <p className="text-[14px] font-semibold text-black/80">选择规格</p>
                {specs.map((g) => (
                  <div key={g.name} className="mt-3">
                    <p className="text-[12px] text-black/50">{g.multi && g.max ? `${g.name}（最多可选${g.max}份）` : g.name}</p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {g.options.map((o) => {
                        const on = (selSpec[g.name] ?? []).includes(o.label);
                        return (
                          <button
                            key={o.label}
                            type="button"
                            onClick={() => tapSpec(g.name, o.label)}
                            className={`flex min-h-[38px] items-center justify-center rounded-lg px-1.5 text-[13px] transition-colors ${
                              on ? 'border-[1.5px] border-[#FF2D7E] bg-[#FFEBF3] font-medium text-[#FF2D7E]' : 'border-[1.5px] border-transparent bg-[#F5F6F7] text-black/80'
                            }`}
                          >
                            <span className="truncate">{o.label}</span>
                            {g.multi && o.price !== undefined && o.price !== 0 && (
                              <span className="ml-0.5 shrink-0 text-[11px]">{o.price > 0 ? `+¥${o.price}` : `-¥${-o.price}`}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 优惠券（到店券） */}
            <button type="button" onClick={() => setCouponPick(true)} className="flex w-full items-center border-t border-black/5 px-4 py-3.5 text-left active:opacity-70">
              <span className="flex-1 text-[14px] text-black/80">优惠券</span>
              <span className={`flex items-center gap-0.5 text-[13px] ${selCoupon || usableCoupons.usable.length > 0 ? 'font-medium text-[#FF2D7E]' : 'text-black/40'}`}>
                {selCoupon ? `-¥${fmtMoney(couponOff)}` : usableCoupons.usable.length > 0 ? `${usableCoupons.usable.length}张可用` : '暂无可用'}
              </span>
            </button>

            {/* 过期提醒 */}
            <div className="flex items-center gap-2 border-t border-black/5 px-4 py-3">
              <Bell className="h-4 w-4 shrink-0 text-black/55" />
              <p className="text-[12px] leading-relaxed text-black/55">{deal.notice}</p>
            </div>

            {/* 价格卡 */}
            <div className="space-y-3.5 border-t border-black/5 px-4 py-4">
              <p className="flex items-baseline justify-between text-[14px]">
                <span className="text-black/80">
                  商品总价<span className="ml-1 text-[12px] text-black/40">（共{qty}件）</span>
                </span>
                <span className="text-[16px] font-bold text-black/90">¥{fmtMoney(itemTotal)}</span>
              </p>
              <p className="flex items-center justify-between text-[14px]">
                <span className="text-black/80">优惠共减</span>
                <span className="flex items-center gap-0.5 font-medium text-[#FF2D7E]">
                  -¥{fmtMoney(discount)}
                  <ChevronRight className="h-4 w-4 rotate-90 text-black/25" />
                </span>
              </p>
              <p className="flex items-baseline justify-between border-t border-black/5 pt-3 text-[14px]">
                <span className="font-semibold text-black/85">实付</span>
                <span className="text-[18px] font-bold" style={{ color: MT_PINK }}>
                  ¥{fmtMoney(total)}
                </span>
              </p>
            </div>

            {/* 购买后可领 */}
            <div className="flex items-center gap-3 border-t border-black/5 px-4 py-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#FF6A4D] to-[#FF3B30] shadow-sm">
                <Gift className="h-5 w-5 text-white" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-black/85">
                  购买后可领1次 <span className="font-bold text-[#FF3B30]">休闲玩乐</span>
                </p>
                <p className="mt-0.5 text-[11px] text-black/45">附近门店可用，休闲玩乐N选1免费兑换</p>
              </div>
            </div>

            {/* 评价后享 */}
            <div className="flex items-center justify-between border-t border-black/5 px-4 py-3.5">
              <span className="text-[14px] text-black/80">评价后享</span>
              <span className="text-[13px] text-black/55">
                评价可得最高<span className="font-semibold text-[#FF3B30]">100积分</span>
              </span>
            </div>

            <p className="px-4 pt-3 text-[11px] leading-relaxed text-black/35">订单支付后即可消费，如有问题可随时申请退款</p>
          </div>
        </div>

        {/* 底栏 */}
        <div className="shrink-0 border-t border-black/5 bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[20px] font-bold leading-tight" style={{ color: MT_PINK }}>
                ¥{fmtMoney(total)}
              </p>
              <p className="text-[11px] text-black/40">
                共{qty}件 总优惠 ¥{fmtMoney(discount)}
              </p>
            </div>
            <button type="button" onClick={submit} className="h-12 rounded-full bg-gradient-to-r from-[#FF2D7E] to-[#FF5E9E] px-9 text-[16px] font-semibold text-white shadow-sm active:opacity-85">
              提交订单
            </button>
          </div>
        </div>
      </motion.div>

      {/* 优惠券选择弹层（到店券） */}
      <AnimatePresence>
        {couponPick && uid && (
          <CouponPickerSheet
            key="mt-deal-coupon-pick"
            uid={uid}
            type="daodian"
            itemTotal={baseTotal}
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
  );
}

// ================================ 优惠券选择弹层（下单用券） ================================

function CouponPickerSheet({
  uid,
  type,
  itemTotal,
  selId,
  onClose,
  onPick,
  onToast,
}: {
  uid: string;
  type: 'waimai' | 'daodian';
  itemTotal: number;
  selId: string | null;
  onClose: () => void;
  onPick: (c: MtCoupon | null) => void;
  onToast: (m: string) => void;
}) {
  const { usable, others } = mtListUsableCoupons(uid, type, itemTotal);
  return (
    <motion.div className="absolute inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      {/* 点弹窗外任意区域关闭 */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        className="absolute inset-x-0 bottom-0 flex max-h-[72%] flex-col overflow-hidden rounded-t-[20px] bg-white/80 backdrop-blur-2xl backdrop-saturate-150"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.3 }}
      >
        <div className="relative flex shrink-0 items-center justify-center pb-2.5 pt-4">
          <span className="absolute left-1/2 top-[7px] h-1 w-9 -translate-x-1/2 rounded-full bg-black/12" aria-hidden="true" />
          <p className="text-[16px] font-semibold text-black/85">选择优惠券</p>
          <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-3 grid h-8 w-8 place-items-center rounded-full bg-black/[0.05] active:bg-black/10">
            <X className="h-4 w-4 text-black/60" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* 不使用优惠券 */}
          <button type="button" onClick={() => onPick(null)} className="flex w-full items-center justify-between border-b border-black/[0.05] py-3.5 text-left active:bg-black/[0.02]">
            <span className="text-[14px] text-black/75">不使用优惠券</span>
            <span className={`grid h-[19px] w-[19px] place-items-center rounded-full ${selId === null ? 'bg-[#FFC300]' : 'border border-black/20'}`}>
              {selId === null && <Check className="h-3 w-3 text-black/80" strokeWidth={3} />}
            </span>
          </button>

          {usable.map((c) => (
            <button key={c.id} type="button" onClick={() => onPick(c)} className="flex w-full items-center gap-3 border-b border-black/[0.05] py-3.5 text-left active:bg-black/[0.02]">
              <span className="grid h-11 w-[64px] shrink-0 place-items-center bg-gradient-to-br from-[#FF5A3C] to-[#FF3B6B] text-white">
                <span className="text-[19px] font-bold leading-none">
                  <span className="text-[11px]">¥</span>
                  {c.amount}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-black/85">{c.name}</span>
                <span className="block text-[11px] text-black/40">
                  满{c.min}可用 · {fmtDate(c.expireAt)}前有效
                </span>
              </span>
              <span className={`grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full ${selId === c.id ? 'bg-[#FFC300]' : 'border border-black/20'}`}>
                {selId === c.id && <Check className="h-3 w-3 text-black/80" strokeWidth={3} />}
              </span>
            </button>
          ))}

          {others.length > 0 && (
            <>
              <p className="mt-3 text-[12px] text-black/35">不可用券</p>
              {others.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onToast(c.type === type ? `未满足使用门槛（满${c.min}可用）` : '该券与当前订单类型不符')}
                  className="flex w-full items-center gap-3 py-3.5 text-left opacity-45"
                >
                  <span className="grid h-11 w-[64px] shrink-0 place-items-center bg-black/15 text-white">
                    <span className="text-[19px] font-bold leading-none">
                      <span className="text-[11px]">¥</span>
                      {c.amount}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-black/85">{c.name}</span>
                    <span className="block text-[11px] text-black/40">{c.type === type ? `满${c.min}可用` : `限${mtCouponTypeLabel(c.type)}使用`}</span>
                  </span>
                </button>
              ))}
            </>
          )}
          {usable.length === 0 && <p className="py-8 text-center text-[13px] text-black/35">暂无本单可用的优惠券</p>}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ================================ 商品规格选择弹窗（奶茶小料/食物小料配菜） ================================

/** 菜品规格弹窗（对齐截图2：图+标题、单选/多选粉选芯片、底价+步进+选好了） */
function DishSpecSheet({
  dish,
  onClose,
  onConfirm,
  onGenDish,
}: {
  dish: MtDish;
  onClose: () => void;
  onConfirm: (payload: { qty: number; spec: string; unitPrice: number }) => void;
  /** 第三十七轮：点菜品详情图 → 打开图片生成弹层（自建+原有商品通用） */
  onGenDish?: (dish: MtDish) => void;
}) {
  const specs = dish.specs ?? [];
  // 初始选中：单选组默认第一项；多选组默认空
  const initSel = (): Record<string, string[]> => {
    const m: Record<string, string[]> = {};
    for (const g of specs) m[g.name] = g.multi ? [] : [g.options[0]?.label ?? ''];
    return m;
  };
  const [sel, setSel] = useState<Record<string, string[]>>(initSel);
  const [qty, setQty] = useState(1);

  const optionPrice = (gName: string, label: string): number => specs.find((g) => g.name === gName)?.options.find((o) => o.label === label)?.price ?? 0;

  const tapOption = (gName: string, label: string) => {
    const g = specs.find((x) => x.name === gName);
    if (!g) return;
    setSel((prev) => {
      const cur = prev[gName] ?? [];
      if (g.multi) {
        const has = cur.includes(label);
        if (has) return { ...prev, [gName]: cur.filter((x) => x !== label) };
        const max = g.max ?? g.options.length;
        if (cur.length >= max) {
          // 超上限：替换最早选中（保持可选，体验顺滑）
          return { ...prev, [gName]: [...cur.slice(1), label] };
        }
        return { ...prev, [gName]: [...cur, label] };
      }
      return { ...prev, [gName]: [label] };
    });
  };

  const unitPrice = Math.max(0.1, dish.price + specs.reduce((s, g) => s + (sel[g.name] ?? []).reduce((t, l) => t + optionPrice(g.name, l), 0), 0));
  const specText = specs
    .map((g) => {
      const picked = sel[g.name] ?? [];
      if (picked.length === 0) return '';
      return picked.join('、');
    })
    .filter(Boolean)
    .join('/');

  const chipBase = 'min-h-[44px] rounded-lg px-2 text-[15px] transition-colors';
  const chipOn = 'border-[1.5px] border-[#FF2D7E] bg-[#FFEBF3] font-medium text-[#FF2D7E]';
  const chipOff = 'border-[1.5px] border-transparent bg-[#F5F6F7] text-black/80';

  return (
    <motion.div className="absolute inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      {/* 点弹窗外任意区域关闭 */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        className="absolute inset-x-0 bottom-0 top-[56px] flex flex-col overflow-hidden rounded-t-[20px] bg-white/80 backdrop-blur-2xl backdrop-saturate-150"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.3 }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* 头部：图（第三十七轮：点图可生成） + 标题 + 关闭 */}
          <div className="flex items-start gap-3">
            {onGenDish ? (
              <button
                type="button"
                aria-label="点击生成商品图片"
                data-testid="mt-dish-imggen"
                onClick={() => onGenDish(dish)}
                className="relative shrink-0 active:opacity-85"
              >
                <FoodImg src={dish.img} emoji={dish.emoji} cap={dish.name} className="h-[88px] w-[88px] rounded-xl" />
                <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded-full bg-black/45 px-1.5 py-0.5 text-[9px] leading-none text-white">
                  <Wand2 className="h-2.5 w-2.5" strokeWidth={2} />
                  生成
                </span>
              </button>
            ) : (
              <FoodImg src={dish.img} emoji={dish.emoji} cap={dish.name} className="h-[88px] w-[88px] shrink-0 rounded-xl" />
            )}
            <p className="min-w-0 flex-1 pt-1 text-[17px] font-bold leading-snug text-black/90">{dish.name}</p>
            <button type="button" aria-label="关闭" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/[0.05] active:bg-black/10">
              <X className="h-4 w-4 text-black/60" />
            </button>
          </div>

          {specs.map((g, gi) => (
            <div key={g.name} className="mt-5">
              <p className="text-[16px] font-semibold text-black/90">
                {g.name === '规格' && gi === 0 ? '' : g.multi && g.max ? `${g.name}（最多可选${g.max}份）` : g.name}
              </p>
              <div className="mt-2.5 grid grid-cols-3 gap-2.5">
                {g.options.map((o) => {
                  const on = (sel[g.name] ?? []).includes(o.label);
                  return (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => tapOption(g.name, o.label)}
                      className={`${chipBase} ${on ? chipOn : chipOff} ${o.price !== undefined && g.multi ? 'flex items-center justify-between px-3' : 'flex items-center justify-center'}`}
                    >
                      <span className="truncate">{o.label}</span>
                      {o.price !== undefined && g.multi && (
                        <>
                          <span className="mx-2 h-4 w-px shrink-0 bg-black/10" aria-hidden="true" />
                          <span className="shrink-0">{o.price > 0 ? `¥${o.price}` : o.price < 0 ? `-¥${-o.price}` : ''}</span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 底部：价格 + 步进 + 选好了 */}
        <div className="shrink-0 border-t border-white/60 bg-white/80 backdrop-blur-2xl backdrop-saturate-150 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
          <div className="flex items-center gap-2">
            <span className="text-[24px] font-bold leading-none text-[#FF2D7E]">
              <span className="text-[14px]">¥</span>
              {fmtMoney(unitPrice)}
            </span>
            {dish.origPrice && dish.origPrice > dish.price && <span className="text-[13px] font-medium text-[#FF2D7E]">已优惠¥{fmtMoney(Math.round((dish.origPrice - dish.price) * 100) / 100)}</span>}
            <span className="flex-1" />
            <span className="flex items-center gap-2.5">
              <button
                type="button"
                aria-label="减少"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="grid h-8 w-8 place-items-center rounded-full border border-black/15 text-black/55 active:bg-black/5"
              >
                <Minus className="h-4 w-4" strokeWidth={2.4} />
              </button>
              <span className="min-w-5 text-center text-[16px] font-semibold">{qty}</span>
              <button
                type="button"
                aria-label="增加"
                onClick={() => setQty((q) => Math.min(9, q + 1))}
                className="grid h-8 w-8 place-items-center rounded-full bg-[#FF2D7E] text-white active:opacity-85"
              >
                <span className="-mt-px text-[18px] leading-none">＋</span>
              </button>
            </span>
          </div>
          <button
            type="button"
            onClick={() => onConfirm({ qty, spec: specText, unitPrice })}
            className="mt-3 h-[52px] w-full rounded-[26px] bg-gradient-to-r from-[#FF2D7E] to-[#FF5E9E] text-[17px] font-bold text-white shadow-[0_4px_14px_rgba(255,45,126,0.3)] active:opacity-85"
          >
            选好了
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ================================ 我的券（优惠券页，对齐截图1） ================================

type CouponCat = 'all' | 'waimai' | 'daodian' | 'hotel' | 'shangou';
const COUPON_CATS: { key: CouponCat; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'waimai', label: '外卖' },
  { key: 'daodian', label: '美食' },
  { key: 'hotel', label: '酒店民宿' },
  { key: 'shangou', label: '闪购' },
];

function CouponsPage({
  session,
  onBack,
  onGoUse,
  onOpenWallet,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  onGoUse: () => void;
  onOpenWallet: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const [, setVer] = useState(0);
  const [cat, setCat] = useState<CouponCat>('all');
  const [quick, setQuick] = useState<string | null>(null);
  const [listTab, setListTab] = useState<'coupon' | 'card'>('coupon');
  const coupons = mtLoadCoupons(uid);
  const now = Date.now();

  // 即将过期（24h 内）
  const expiringSoon = coupons.filter((c) => !c.usedAt && c.expireAt - now < 24 * 3600_000 && c.expireAt > now).length;

  const list = (() => {
    let arr = [...coupons];
    if (cat !== 'all') arr = arr.filter((c) => c.type === cat);
    if (quick === 'god') arr = arr.filter((c) => c.god);
    else if (quick === 'recent') arr.sort((a, b) => b.obtainedAt - a.obtainedAt);
    else if (quick === 'expiring') arr = arr.filter((c) => !c.usedAt && c.expireAt - now < 24 * 3600_000 && c.expireAt > now);
    else if (quick === 'discount') arr.sort((a, b) => b.amount / Math.max(1, b.min) - a.amount / Math.max(1, a.min));
    else if (quick === 'big') arr.sort((a, b) => b.amount - a.amount);
    else arr.sort((a, b) => Number(Boolean(a.usedAt)) - Number(Boolean(b.usedAt)) || b.obtainedAt - a.obtainedAt);
    return arr;
  })();

  const claim = () => {
    const n = mtClaimGodCoupons(uid);
    setVer((v) => v + 1);
    onToast(n > 0 ? `已领取${n}张神券，快去下单使用吧` : '神券已领取过了，可在列表查看');
  };

  const expireLine = (c: MtCoupon): ReactNode => {
    const left = c.expireAt - now;
    if (c.usedAt) return <span className="text-black/30">已使用</span>;
    if (left <= 24 * 3600_000) {
      const h = Math.max(0, Math.floor(left / 3600_000));
      const mnt = Math.max(0, Math.floor((left % 3600_000) / 60_000));
      const s = Math.max(0, Math.floor((left % 60_000) / 1000));
      return (
        <>
          <span className="text-[#FF6000]">仅剩{String(h).padStart(2, '0')}:{String(mnt).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>
          <span className="text-black/35"> 规则</span>
        </>
      );
    }
    if (left <= 2 * 24 * 3600_000) {
      return (
        <>
          <span className="text-black/45">明日到期</span>
          <span className="text-black/35"> 规则</span>
        </>
      );
    }
    return (
      <>
        <span className="text-black/45">{fmtDate(c.expireAt)}到期</span>
        <span className="text-black/35"> 规则</span>
      </>
    );
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 顶栏：返回 + 我的券/卡 胶囊 + 更多 */}
      <div className="relative grid h-[100px] shrink-0 place-items-center border-b border-black/[0.04] bg-white pt-[50px]">
        <button type="button" aria-label="返回" onClick={onBack} className="absolute left-1 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.2} />
        </button>
        <div className="flex h-[40px] items-center rounded-full bg-[#F1F2F4] p-[3px]">
          {([
            ['coupon', '我的券'],
            ['card', '卡'],
          ] as ['coupon' | 'card', string][]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setListTab(k)}
              className={`h-[34px] rounded-full px-5 text-[15px] font-medium transition-colors ${listTab === k ? 'bg-white text-black/90 shadow-sm' : 'text-black/45'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" aria-label="更多" onClick={() => onToast('券码兑换/帮助中心（演示）')} className="absolute right-3 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <span className="flex gap-[3px]">
            <span className="h-[4px] w-[4px] rounded-full bg-black/60" />
            <span className="h-[4px] w-[4px] rounded-full bg-black/60" />
            <span className="h-[4px] w-[4px] rounded-full bg-black/60" />
          </span>
        </button>
      </div>

      {listTab === 'card' ? (
        /* 卡 tab：卡包空态 */
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-black/[0.05]">
            <CreditCard className="h-7 w-7 text-black/25" strokeWidth={1.8} />
          </span>
          <p className="mt-4 text-[15px] font-medium text-black/60">暂无可用的卡</p>
          <p className="mt-1 text-[12px] text-black/35">美团联名卡、储值卡将展示在这里</p>
        </div>
      ) : (
        <>
          {/* 分类页签 */}
          <div className="shrink-0 bg-white px-4">
            <div className="flex gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {COUPON_CATS.map((t) => (
                <button key={t.key} type="button" onClick={() => setCat(t.key)} className={`relative shrink-0 py-3 text-[16px] ${cat === t.key ? 'font-bold text-black/90' : 'text-black/55'}`}>
                  {t.label}
                  {cat === t.key && <span className="absolute inset-x-0 bottom-[4px] mx-auto h-[3px] w-6 rounded-full bg-[#FFC300]" />}
                </button>
              ))}
            </div>
          </div>

          {/* 快捷筛选 chips */}
          <div className="shrink-0 border-b border-black/[0.04] bg-white px-3 pb-2.5">
            <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {([
                ['god', '神券', true],
                ['recent', '最近获得', false],
                ['expiring', `即将过期(${expiringSoon})`, false],
                ['discount', '折扣最大', false],
                ['big', '面额最大', false],
              ] as [string, string, boolean][]).map(([k, label, hot]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setQuick((q) => (q === k ? null : k))}
                  className={`shrink-0 rounded-lg px-3.5 py-2 text-[13px] transition-colors ${quick === k ? 'bg-[#FFF3B8] font-semibold text-[#B77900]' : hot ? 'bg-[#F5F6F7] font-bold text-[#FF3B30]' : 'bg-[#F5F6F7] text-black/70'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 券列表 */}
          <div className="min-h-0 flex-1 overflow-y-auto pb-28 pt-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {list.length === 0 ? (
              <div className="pt-20 text-center">
                <p className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-black/[0.05]">
                  <Ticket className="h-7 w-7 text-black/25" strokeWidth={1.8} />
                </p>
                <p className="mt-3 text-[14px] text-black/45">暂无相关优惠券</p>
                <button type="button" onClick={claim} className="mt-4 rounded-full bg-[#FFD100] px-6 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
                  去领神券
                </button>
              </div>
            ) : (
              <div>
                {list.map((c) => {
                  const used = Boolean(c.usedAt);
                  const expired = c.expireAt <= now && !used;
                  const dead = used || expired;
                  return (
                    <div key={c.id} className={`relative flex items-stretch border-t-[7px] border-[#F5F6F7] ${dead ? 'opacity-55' : ''}`}>
                      {/* 左侧信息 */}
                      <div className="min-w-0 flex-1 p-3.5">
                        <p className="flex items-center gap-1.5">
                          {c.god && (
                            <span className="rounded-t-md rounded-br-md bg-gradient-to-r from-[#FF5A3C] to-[#FF3B6B] px-1.5 py-px text-[11px] font-bold italic text-white">神券</span>
                          )}
                          <span className="rounded-t-md rounded-br-md bg-[#FFF0C2] px-1.5 py-px text-[11px] text-[#B77900]">{mtCouponTypeLabel(c.type)}</span>
                        </p>
                        <p className="mt-1.5 truncate text-[17px] font-bold text-black/90">{c.name}</p>
                        <p className="mt-1.5 flex items-center text-[12px]">
                          {expireLine(c)}
                        </p>
                      </div>
                      {/* 右侧面额 + 去使用 */}
                      <div className="flex w-[110px] shrink-0 flex-col items-center justify-center gap-1.5 border-l border-dashed border-black/[0.08] py-3">
                        <span className="text-[26px] font-bold leading-none text-[#FF3B30]">
                          {c.amount}
                          <span className="text-[14px]">元</span>
                        </span>
                        <span className="text-[11px] text-black/40">满{c.min}可用</span>
                        <button
                          type="button"
                          disabled={dead}
                          onClick={() => {
                            if (dead) {
                              onToast(used ? '该券已使用' : '该券已过期');
                              return;
                            }
                            onGoUse();
                          }}
                          className={`mt-1 rounded-full px-5 py-1.5 text-[13px] font-semibold ${dead ? 'bg-[#F5F6F7] text-black/30' : 'bg-[#FFD100] text-black/90 active:opacity-85'}`}
                        >
                          {used ? '已使用' : expired ? '已过期' : '去使用'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 底部功能条：我的钱包 / 领神券 / 返利 / 会员中心 */}
          <div className="absolute inset-x-0 bottom-0 flex shrink-0 items-start border-t border-white/60 bg-white/80 backdrop-blur-2xl backdrop-saturate-150 pb-[max(8px,env(safe-area-inset-bottom))] pt-2.5">
            <button type="button" onClick={onOpenWallet} className="flex flex-1 flex-col items-center gap-1 active:opacity-70">
              <Wallet className="h-[22px] w-[22px] text-black/80" strokeWidth={1.8} />
              <span className="text-[11px] text-black/70">我的钱包</span>
            </button>
            <button type="button" onClick={claim} className="flex flex-1 flex-col items-center active:opacity-80">
              <span className="grid h-[46px] w-[46px] -translate-y-1.5 place-items-center rounded-full bg-gradient-to-br from-[#FF5A3C] to-[#FF3B6B] px-1 text-center text-[12px] font-bold italic leading-[1.15] text-white shadow-[0_3px_10px_rgba(255,59,107,0.4)]">
                领神券
              </span>
            </button>
            <button type="button" onClick={() => onToast('返利 1 笔待提现（演示）')} className="flex flex-1 flex-col items-center gap-1 active:opacity-70">
              <span className="grid h-[22px] w-[22px] place-items-center rounded-full border-[1.5px] border-black/70 text-[12px] font-bold text-black/75">返</span>
              <span className="text-[11px] text-black/70">1笔返利</span>
            </button>
            <button type="button" onClick={() => onToast('会员中心（演示）')} className="flex flex-1 flex-col items-center gap-1 active:opacity-70">
              <Crown className="h-[22px] w-[22px] text-black/80" strokeWidth={1.8} />
              <span className="text-[11px] text-black/70">会员中心</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ================================ 地址管理页 ================================

function AddressesPage({ session, onBack, onAdd, onEdit, onToast }: { session: MtSession; onBack: () => void; onAdd: () => void; onEdit: (a: MtAddress) => void; onToast: (m: string) => void }) {
  const uid = mtUidOf(session);
  const [, setVer] = useState(0);
  const addrs = mtLoadAddresses(uid);
  const cur = mtCurAddrId(uid);

  const remove = (a: MtAddress) => {
    if (addrs.length <= 1) {
      onToast('至少保留一个收货地址');
      return;
    }
    const next = addrs.filter((x) => x.id !== a.id);
    mtSaveAddresses(uid, next);
    if (cur === a.id) mtSetCurAddr(uid, next[0].id);
    setVer((v) => v + 1);
    onToast('地址已删除');
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.04] bg-white px-3 pb-2.5 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-6 w-6 text-black/70" />
        </button>
        <p className="flex-1 text-center text-[16px] font-semibold text-black/85">收货地址</p>
        <span className="h-9 w-9" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div>
          {addrs.map((a) => (
            <div key={a.id} className="border-b border-black/[0.04] px-4 py-4 last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="rounded bg-[#FFF3B8] px-1.5 text-[11px] text-[#B77900]">{a.tag}</span>
                <span className="text-[15px] font-semibold text-black/85">{a.name}</span>
                <span className="text-[13px] text-black/45">{a.phone}</span>
                {a.id === cur && <span className="ml-auto rounded-full bg-[#E8F9EF] px-2 py-0.5 text-[10px] text-[#00A661]">默认</span>}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-black/65">{a.text}</p>
              <div className="mt-2.5 flex items-center gap-4 border-t border-black/5 pt-2.5 text-[12px]">
                <button type="button" onClick={() => { mtSetCurAddr(uid, a.id); setVer((v) => v + 1); onToast('已设为默认地址'); }} className="flex items-center gap-1 text-black/55 active:opacity-60">
                  <CircleCheck className="h-3.5 w-3.5" /> 设为默认
                </button>
                <button type="button" onClick={() => onEdit(a)} className="text-black/55 active:opacity-60">
                  编辑
                </button>
                <button type="button" onClick={() => remove(a)} className="ml-auto text-[#FF4B33] active:opacity-60">
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="shrink-0 border-t border-black/5 bg-white px-4 py-3">
        <button type="button" onClick={onAdd} className="h-12 w-full rounded-full bg-[#FFD100] text-[15px] font-semibold text-black/90 active:opacity-85">
          + 新增收货地址
        </button>
      </div>
    </div>
  );
}

function AddAddressPage({ session, onBack, editing, onToast }: { session: MtSession; onBack: () => void; editing: MtAddress | null; onToast: (m: string) => void }) {
  const uid = mtUidOf(session);
  const [name, setName] = useState(editing?.name ?? '');
  const [phone, setPhone] = useState(editing?.phone ?? '');
  const [addr, setAddr] = useState(editing?.text ?? '');
  const [door, setDoor] = useState('');
  const [tag, setTag] = useState(editing?.tag ?? '家');
  const [gender, setGender] = useState<'先生' | '女士'>('先生');
  const [pickOpen, setPickOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  /** 从一段文本里抽手机号 + 地址（智能识别） */
  const recognize = (raw: string): boolean => {
    if (!raw.trim()) return false;
    const phoneHit = raw.match(/1[3-9]\d{9}/);
    const rest = raw.replace(/1[3-9]\d{9}/g, '').replace(/[,，;；\s]+/g, ' ').trim();
    if (phoneHit) setPhone(phoneHit[0]);
    if (rest) setAddr(rest);
    return Boolean(phoneHit || rest);
  };

  const save = () => {
    if (!name.trim() || !addr.trim()) {
      onToast('请填写联系人和地址');
      return;
    }
    const finalText = door.trim() && addr.trim() ? `${addr.trim()} ${door.trim()}` : addr.trim();
    const addrs = mtLoadAddresses(uid);
    if (editing) {
      mtSaveAddresses(uid, addrs.map((a) => (a.id === editing.id ? { ...a, name: name.trim(), phone: phone.trim(), text: finalText || editing.text, tag } : a)));
    } else {
      mtSaveAddresses(uid, [...addrs, { id: `addr${Date.now().toString(36)}`, name: name.trim(), phone: phone.trim() || '138****0000', text: finalText, tag }]);
    }
    onToast('地址已保存');
    onBack();
  };

  const pasteFromBoard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) {
        onToast('剪贴板是空的');
        return;
      }
      if (recognize(t)) onToast('已识别地址信息');
      else onToast('没有识别出地址，请手动填写');
    } catch {
      onToast('剪贴板不可用，请在下方输入后点识别');
    }
  };

  const canSave = Boolean(name.trim() && addr.trim());

  return (
    <div className="relative flex h-full flex-col bg-[#F4F5F7]">
      {/* 顶部悬浮栏：返回 + 标题 + 搜索（悬浮在地图上） */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
        <div className="pointer-events-auto flex items-center gap-2 px-3 pt-[54px]">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-white/85 shadow-sm backdrop-blur active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/75" />
          </button>
          <p className="flex-1 text-center text-[17px] font-semibold text-black/90">{editing ? '编辑地址' : '新增地址'}</p>
          <button type="button" data-testid="mt-addr-search" onClick={() => setPickOpen(true)} className="flex h-9 items-center gap-1 rounded-full bg-white/90 px-3.5 shadow-sm backdrop-blur active:opacity-80">
            <SearchIcon className="h-[14px] w-[14px] text-black/70" strokeWidth={2.2} />
            <span className="text-[14px] font-medium text-black/80">搜索</span>
          </button>
        </div>
      </div>

      {/* 假地图（纯 SVG 绘制，无外部依赖）：路网 + 绿地 + 水域 + 建筑块 */}
      <div className="relative h-[300px] shrink-0 overflow-hidden">
        <svg viewBox="0 0 500 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <rect width="500" height="300" fill="#F0EFE9" />
          <path d="M300 0 H500 V120 Q430 150 380 110 Q330 70 300 40 Z" fill="#D3EBC0" />
          <path d="M0 210 Q80 190 130 230 Q160 255 120 300 H0 Z" fill="#DCEFC9" opacity="0.9" />
          <path d="M470 220 Q500 240 500 300 H430 Q440 250 470 220 Z" fill="#C9E3F5" />
          <path d="M-10 150 L510 110" stroke="#FFFFFF" strokeWidth="14" fill="none" />
          <path d="M120 -10 L180 310" stroke="#FFFFFF" strokeWidth="12" fill="none" />
          <path d="M-10 60 L510 30" stroke="#FFFFFF" strokeWidth="8" fill="none" />
          <path d="M330 -10 L300 310" stroke="#FFFFFF" strokeWidth="8" fill="none" />
          <path d="M-10 240 L510 260" stroke="#FFFFFF" strokeWidth="10" fill="none" />
          <path d="M240 -10 L270 310" stroke="#FFFFFF" strokeWidth="5" fill="none" />
          <path d="M-10 200 L240 170" stroke="#FFFFFF" strokeWidth="5" fill="none" />
          <path d="M400 150 L510 190" stroke="#FFFFFF" strokeWidth="5" fill="none" />
          {[
            [30, 90, 34, 22],
            [90, 70, 26, 18],
            [220, 60, 30, 20],
            [380, 170, 30, 22],
            [40, 260, 36, 20],
            [200, 220, 28, 18],
            [300, 200, 24, 16],
            [150, 130, 22, 14],
          ].map(([x, y, w, h], i) => (
            <rect key={i} x={x} y={y} width={w} height={h} rx="3" fill="#E4E2DA" />
          ))}
        </svg>
        {/* Marker：地址气泡 + 针杆 + 蓝点（文案随地址输入实时变） */}
        <div className="absolute left-1/2 top-[64%] -translate-x-1/2 -translate-y-full text-center">
          <div className="mx-auto max-w-[240px] truncate rounded-lg bg-white px-3 py-1.5 text-[13px] font-medium text-black/85 shadow-[0_4px_14px_rgba(0,0,0,0.12)]" data-testid="mt-addr-marker">
            {addr.trim() || '点击搜索选择地址'}
          </div>
          <span aria-hidden="true" className="mx-auto block h-5 w-[2.5px] bg-black/85" />
          <span aria-hidden="true" className="mx-auto block h-3 w-3 rounded-full border-2 border-white bg-[#3B82F6] shadow" />
        </div>
        <button type="button" aria-label="定位" onClick={() => onToast('已回到当前定位')} className="absolute bottom-4 right-4 grid h-10 w-10 place-items-center rounded-xl bg-white shadow-[0_3px_10px_rgba(0,0,0,0.12)] active:opacity-80">
          <Crosshair className="h-5 w-5 text-black/70" strokeWidth={2} />
        </button>
      </div>

      {/* 表单面板（上拉圆角盖住地图底部，对齐真机截图） */}
      <div className="relative -mt-5 flex min-h-0 flex-1 flex-col rounded-t-[20px] bg-white/80 backdrop-blur-2xl backdrop-saturate-150 shadow-[0_-6px_20px_rgba(0,0,0,0.06)]">
        <span aria-hidden="true" className="mx-auto mt-2 block h-1 w-9 shrink-0 rounded-full bg-black/10" />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* 地址：点开联想浮层 */}
          <button type="button" data-testid="mt-addr-pick" onClick={() => setPickOpen(true)} className="flex w-full items-center gap-2 rounded-2xl border border-black/[0.07] bg-[#FAFAF8] px-4 py-4 text-left active:opacity-80">
            <span className="w-[52px] shrink-0 text-[14px] text-black/50">地址</span>
            <span className="min-w-0 flex-1 truncate text-[18px] font-bold text-black/90">{addr.trim() || '选择收货地址'}</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/30" />
          </button>

          {/* 门牌号 */}
          <label className="flex items-center gap-2 border-b border-black/[0.05] py-4">
            <span className="w-[52px] shrink-0 text-[14px] text-black/50">门牌号</span>
            <input value={door} onChange={(e) => setDoor(e.target.value)} placeholder="输入详细地址，例1单元101" className="h-8 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30" />
          </label>

          {/* 联系人 + 先生/女士 */}
          <div className="flex items-center gap-2 border-b border-black/[0.05] py-4">
            <span className="w-[52px] shrink-0 text-[14px] text-black/50">联系人</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="输入收货人姓名" className="h-8 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30" />
            <div className="flex shrink-0 items-center gap-3">
              {(['先生', '女士'] as const).map((g) => (
                <button key={g} type="button" onClick={() => setGender(g)} className="flex items-center gap-1 text-[14px] text-black/80">
                  <span className={`grid h-[18px] w-[18px] place-items-center rounded-full border-2 ${gender === g ? 'border-[#FFD100] bg-[#FFD100]' : 'border-black/20 bg-white'}`}>
                    {gender === g && <span className="h-[6px] w-[6px] rounded-full bg-white" />}
                  </span>
                  {g}
                </button>
              ))}
            </div>
          </div>

          {/* 手机号 */}
          <label className="flex items-center gap-2 border-b border-black/[0.05] py-4">
            <span className="w-[52px] shrink-0 text-[14px] text-black/50">手机号</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="输入收货人手机号" inputMode="numeric" className="h-8 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30" />
          </label>

          {/* 标签 */}
          <div className="flex items-center gap-2.5 py-4">
            <span className="w-[52px] shrink-0 text-[14px] text-black/50">标签</span>
            {['家', '公司', '学校'].map((t) => (
              <button key={t} type="button" onClick={() => setTag(t)} className={`rounded-xl px-5 py-2 text-[14px] transition-colors ${tag === t ? 'bg-[#FFF6D8] font-semibold text-[#B77900] ring-1 ring-[#FFD100]' : 'bg-[#F5F6F7] text-black/60'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* 粘贴智能识别条 */}
        <div className="mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-2xl bg-[#F7F7F5] px-4 py-2.5">
          <input value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="粘贴文本，智能识别地址信息" className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-black/30" />
          {pasteText.trim() ? (
            <button type="button" data-testid="mt-addr-recognize" onClick={() => { if (recognize(pasteText)) { setPasteText(''); onToast('已识别地址信息'); } else onToast('没有识别出地址，请手动填写'); }} className="shrink-0 rounded-full bg-[#FFD100] px-3.5 py-1.5 text-[13px] font-semibold text-black/85 active:opacity-80">
              识别
            </button>
          ) : (
            <button type="button" data-testid="mt-addr-paste" onClick={() => void pasteFromBoard()} className="shrink-0 rounded-full border border-black/15 px-3.5 py-1.5 text-[13px] text-black/70 active:opacity-70">
              粘贴
            </button>
          )}
        </div>

        {/* 保存（未填完=灰禁用态；填完=黄渐变） */}
        <div className="shrink-0 px-4 pb-5 pt-1">
          <button type="button" onClick={save} data-testid="mt-addr-save" className={`h-[52px] w-full rounded-full text-[16px] font-semibold transition-colors ${canSave ? 'bg-gradient-to-r from-[#FFDC30] to-[#FFC300] text-black/90 shadow-[0_4px_14px_rgba(255,180,0,0.35)] active:opacity-85' : 'bg-[#F0F0F0] text-black/30'}`}>
            保存地址
          </button>
        </div>
      </div>

      {/* 地址联想浮层（本地池：已存地址 + 内置小区/地标，输入过滤） */}
      <AnimatePresence>
        {pickOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-30 flex flex-col justify-end bg-black/40" onClick={() => setPickOpen(false)}>
            <motion.div
              initial={{ y: '45%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 330 }}
              className="rounded-t-[20px] bg-white/80 backdrop-blur-2xl backdrop-saturate-150 pb-6"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="py-3.5 text-center text-[16px] font-semibold text-black/85">选择收货地址</p>
              <div className="px-4">
                <div className="flex h-10 items-center gap-2 rounded-full bg-[#F5F6F7] px-4">
                  <SearchIcon className="h-4 w-4 shrink-0 text-black/35" strokeWidth={2.2} />
                  <input autoFocus value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="搜索小区 / 写字楼 / 学校" className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-black/30" />
                  {addr && (
                    <button type="button" aria-label="清空" onClick={() => setAddr('')} className="shrink-0">
                      <X className="h-4 w-4 text-black/30" />
                    </button>
                  )}
                </div>
              </div>
              <AddrHits uid={uid} query={addr} onPick={(s) => { setAddr(s); setPickOpen(false); }} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 地址联想列表（本地池：已存地址 + 内置小区/地标；空匹配时可直接用输入内容） */
function AddrHits({ uid, query, onPick }: { uid: string; query: string; onPick: (s: string) => void }) {
  const pool = useMemo(() => {
    const builtin = [
      '幸福小区西区 3 号院',
      '幸福小区东区 5 号楼',
      '阳光花园 12 号楼',
      '科技园写字楼 B 座',
      '万达广场（朝阳店）',
      '第一人民医院门诊部',
      '实验中学（南门）',
      '星河湾 6 号楼',
      '滨河公寓 2 单元',
      '望江名邸 8 栋',
    ];
    const saved = mtLoadAddresses(uid).map((a) => a.text);
    return [...new Set([...saved, ...builtin])];
  }, [uid]);
  const q = query.trim();
  const hits = q ? pool.filter((s) => s.includes(q)) : pool;
  const showUseRaw = q && !pool.some((s) => s === q);
  return (
    <div className="mt-2 max-h-[44vh] overflow-y-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {hits.map((s) => (
        <button key={s} type="button" onClick={() => onPick(s)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-black/[0.04]">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#FFF6D8]">
            <MapPin className="h-4 w-4 text-[#B77900]" strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[14.5px] text-black/85">{s}</span>
        </button>
      ))}
      {showUseRaw && (
        <button type="button" onClick={() => onPick(q)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-black/[0.04]">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#EFF6EE]">
            <Check className="h-4 w-4 text-[#3D9A50]" strokeWidth={2.2} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[14.5px] text-black/85">
            使用「{q}」
          </span>
        </button>
      )}
      {!hits.length && !showUseRaw && <p className="py-8 text-center text-[13px] text-black/35">暂无匹配地址</p>}
    </div>
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
const mtW2 = (n: number): string => n.toFixed(2);
/** 千分位金额（借钱额度/借据展示用）：整数不带小数，非整数两位小数 */
const mtAmtComma = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 万元口径展示（额度/金额 ≥1万 → 「9.98万」，否则原值逗号分隔） */
const mtAmtWan = (n: number): string => {
  if (n >= 10000) {
    const w = n / 10000;
    return `${Number.isInteger(w) ? w : w.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}万`;
  }
  return mtAmtComma(n);
};

/** 支持添加的银行（演示） */
const MT_BANK_NAMES = ['中国工商银行', '中国建设银行', '中国农业银行', '中国银行', '招商银行', '交通银行', '中国邮政储蓄银行'];

/** 银行品牌信息：简称 / 卡面品牌色渐变 / 卡号前缀（自动生成卡号用） */
const MT_BANK_META: Record<string, { short: string; grad: string; prefix: string }> = {
  中国工商银行: { short: '工', grad: 'from-[#D81920] to-[#8E000A]', prefix: '622202' },
  中国建设银行: { short: '建', grad: 'from-[#0A6EB4] to-[#054A78]', prefix: '621700' },
  中国农业银行: { short: '农', grad: 'from-[#0AAE76] to-[#046A47]', prefix: '622848' },
  中国银行: { short: '中', grad: 'from-[#BC0A24] to-[#7A0016]', prefix: '621785' },
  招商银行: { short: '招', grad: 'from-[#E4392C] to-[#9E0E14]', prefix: '622588' },
  交通银行: { short: '交', grad: 'from-[#0A57A8] to-[#03325F]', prefix: '622260' },
  中国邮政储蓄银行: { short: '邮', grad: 'from-[#0A9455] to-[#045C33]', prefix: '621799' },
};
const mtBankMeta = (bank: string) => MT_BANK_META[bank] ?? { short: bank.slice(0, 1) || '卡', grad: 'from-[#F3D3A0] to-[#C8860D]', prefix: '622888' };

/** 自动生成 16 位银行卡号（银行前缀 + 随机 10 位） */
const mtGenCardNo = (bank: string): string => {
  let no = mtBankMeta(bank).prefix;
  for (let i = 0; i < 10; i++) no += Math.floor(Math.random() * 10);
  return no;
};

/** 卡号 4 位一组空格分隔展示 */
const mtFmtCardNo = (s: string): string => s.replace(/(\d{4})(?=\d)/g, '$1 ');

/** 弹层动效（面板上滑 + 遮罩淡入 + 错误抖动），MtWalletSheet / MtPayPwdSheet 共用 */
const MT_SHEET_CSS =
  '@keyframes mtSheetUp{from{transform:translateY(55%);opacity:.35}to{transform:translateY(0);opacity:1}}' +
  '@keyframes mtFadeIn{from{opacity:0}to{opacity:1}}' +
  '@keyframes mtShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(4px)}}';

/** 余额页常见问题（首条默认展开） */
const MT_BALANCE_FAQS: { q: string; a: string; a2?: string; link?: string; tail?: string }[] = [
  {
    q: '为什么要完善账户信息？',
    a: '根据人民银行《非银行支付机构网络支付业务管理办法》、《支付机构反洗钱和反恐怖融资管理办法》等法律法规规定，支付机构需要对用户进行实名制管理，登记用户的身份基本信息，按规定核对有效身份证件并留存有效身份证件复印件或者影印件。',
    a2: '因此若您尚未在美团上传身份证，或上传的证件已过期，建议您上传或更新证件信息，以正常使用美团余额充值、支付功能。您可以点击 ',
    link: '完善身份信息',
    tail: ' 直接完善您的身份信息。请您放心，美团会严格保障用户隐私安全，不会泄露任何个人信息。',
  },
  { q: '我想变更实名，怎么清空余额？', a: '变更实名前需先将余额全部提现至本人银行卡，余额清零后即可解绑当前实名并重新认证（演示文案）。' },
  { q: '余额无法支付怎么办？', a: '请确认已完成实名认证且账户状态正常；若仍无法支付，可尝试更换支付方式或联系在线客服处理（演示文案）。' },
  { q: '实名非本人无法提现或支付怎么办？', a: '为保障资金安全，仅支持向本人实名银行卡提现；若实名信息非本人，请先完成本人实名认证后再操作（演示文案）。' },
  { q: '余额能否提现到微信或支付宝？', a: '目前余额仅支持提现到本人实名银行卡，暂不支持提现到微信零钱或支付宝余额（演示文案）。' },
];

/** 借钱页四大安全保障（演示文案） */
const MT_LOAN_GUARDS: { t: string; d: string }[] = [
  { t: '严格遵守国家法律规定', d: '资质齐全，符合国家监管政策要求，借贷资金全部来自持牌金融机构。' },
  { t: '利率公开透明', d: '年化利率明确公示，无任何隐藏费用，还款计划清晰可查。' },
  { t: '个人信息保护', d: '金融级加密传输与存储，未经您的授权绝不向第三方泄露。' },
  { t: '规范催收承诺', d: '催收流程规范合规，绝不骚扰联系人，逾期可主动协商（演示文案）。' },
];

/** 账单按日期分组标题（今天/昨天/M月d日） */
const mtBillGroupLabel = (ts: number): string => {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return '今天';
  const yest = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === yest.toDateString()) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/** 账单条目时间（M月d日 HH:mm） */
const mtBillItemTime = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 账单类型 → 圆图标（充值↓绿/提现↑橙/消费购物袋/借款金币/还款↑红/退款旋转） */
const mtBillIcon = (kind: MtWalletBill['kind']): { Icon: LucideIcon; cls: string } => {
  switch (kind) {
    case 'recharge':
      return { Icon: ArrowDown, cls: 'bg-[#E8F8EF] text-[#07C160]' };
    case 'withdraw':
      return { Icon: ArrowUp, cls: 'bg-[#FFF3E0] text-[#FF7D00]' };
    case 'pay':
      return { Icon: ShoppingBag, cls: 'bg-[#F1F2F4] text-black/55' };
    case 'loan':
      return { Icon: CircleDollarSign, cls: 'bg-[#FFF6D9] text-[#C8860D]' };
    case 'repay':
      return { Icon: ArrowUp, cls: 'bg-[#FDEBEB] text-[#E64340]' };
    default:
      return { Icon: RotateCw, cls: 'bg-[#FFF8E1] text-[#C8860D]' };
  }
};

/** 钱包通用底部弹层（充值/提现/添加卡/卡片管理共用；点击遮罩关闭；上滑入场 + 遮罩淡入动效） */
function MtWalletSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="absolute inset-0 z-40 flex flex-col justify-end bg-black/55"
      role="dialog"
      aria-label={title}
      onClick={onClose}
      style={{ animation: 'mtFadeIn 0.22s ease both' }}
    >
      <style>{MT_SHEET_CSS}</style>
      <div
        className="max-h-[88%] overflow-y-auto rounded-t-[22px] bg-white/80 backdrop-blur-2xl backdrop-saturate-150 pb-[30px] no-scrollbar"
        style={{ animation: 'mtSheetUp 0.32s cubic-bezier(0.2, 0.85, 0.3, 1) both', boxShadow: '0 -10px 40px rgba(0,0,0,0.18)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-white/85 backdrop-blur-2xl backdrop-saturate-150">
          <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-black/15" aria-hidden="true" />
          <div className="relative flex h-11 items-center justify-center">
            <p className="text-[16px] font-bold text-black/90">{title}</p>
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="absolute right-3 grid h-7 w-7 place-items-center rounded-full bg-black/[0.05] text-black/45 transition-colors active:bg-black/10"
            >
              <X className="h-4 w-4" strokeWidth={2.4} />
            </button>
          </div>
          <div className="h-px bg-black/[0.04]" />
        </div>
        {children}
      </div>
    </div>
  );
}

/** 银行卡单选列表（充值选付款卡 / 提现选到账卡共用；银行品牌色徽标） */
function MtWalletCardPicker({ cards, value, onPick }: { cards: MtBankCard[]; value: string | null; onPick: (id: string) => void }) {
  return (
    <div className="max-h-60 overflow-y-auto px-4 no-scrollbar">
      {cards.map((c) => {
        const meta = mtBankMeta(c.bank);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c.id)}
            className="flex w-full items-center gap-3 border-b border-black/[0.04] py-3 text-left last:border-b-0 active:bg-black/[0.03]"
          >
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br ${meta.grad} text-[15px] font-bold text-white shadow-sm`}>
              {meta.short}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-black/85">{c.bank}</span>
              <span className="mt-0.5 block truncate text-[11px] text-black/40">尾号{c.tail} · 可用余额 ¥{mtW2(c.balance)}</span>
            </span>
            <span
              className={`grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border-2 transition-colors ${
                value === c.id ? 'border-[#FFC300] bg-[#FFC300]' : 'border-black/15'
              }`}
            >
              {value === c.id && <Check className="h-3 w-3 text-black" strokeWidth={3.5} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 美团风格 6 位支付密码自绘数字键盘（不唤起系统键盘；校验由父级完成，errorKey 变化时父级重挂载 → 清空并抖动） */
function MtPayPwdSheet({
  title,
  sub,
  hint,
  errorKey,
  locked = false,
  onComplete,
  onClose,
}: {
  title: string;
  sub?: string;
  hint?: string;
  errorKey: number;
  /** 锁定期间禁用输入（键位 click 失效、视觉灰显） */
  locked?: boolean;
  onComplete: (pwd: string) => void;
  onClose: () => void;
}) {
  const [digits, setDigits] = useState('');
  // 用 ref 累加避免同一 tick 内连点被 React 批处理吞掉（每次 push 都基于最新串）
  const acc = useRef('');
  const push = (d: string) => {
    if (locked) return;
    const next = (acc.current + d).slice(0, 6);
    acc.current = next;
    setDigits(next);
    if (next.length === 6) {
      const done = next;
      acc.current = '';
      window.setTimeout(() => onComplete(done), 150);
    }
  };
  const keyBtn = 'flex h-[52px] items-center justify-center bg-white text-[22px] font-medium text-black transition-colors active:bg-black/[0.06]';
  const keyBtnLocked = 'flex h-[52px] items-center justify-center bg-white/60 text-[22px] font-medium text-black/30';
  return (
    <div
      className="rounded-t-[22px] bg-white/80 backdrop-blur-2xl backdrop-saturate-150 pb-[30px]"
      style={{ animation: 'mtSheetUp 0.32s cubic-bezier(0.2, 0.85, 0.3, 1) both' }}
      onClick={(e) => e.stopPropagation()}
      data-testid="mt-keypad"
    >
      <style>{MT_SHEET_CSS}</style>
      <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-black/15" aria-hidden="true" />
      <div className="relative mt-1 flex h-11 items-center justify-center">
        <p className="text-[16px] font-bold text-black/90">{title}</p>
        <button
          type="button"
          aria-label="关闭"
          data-testid="mt-keypad-close"
          onClick={onClose}
          disabled={locked}
          className="absolute right-3 grid h-7 w-7 place-items-center rounded-full bg-black/[0.05] text-black/45 transition-colors active:bg-black/10 disabled:opacity-40"
        >
          <X className="h-4 w-4" strokeWidth={2.4} />
        </button>
      </div>
      {sub ? <p className="pb-1 text-center text-[12.5px] text-black/45">{sub}</p> : null}
      <div className="mx-auto mt-2 flex w-fit gap-2.5" style={errorKey > 0 ? { animation: 'mtShake 0.46s' } : undefined}>
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className={`grid h-11 w-10 place-items-center rounded-[9px] border bg-white transition-colors ${i < digits.length ? 'border-[#FFC300]' : 'border-black/15'}`}
            style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)' }}
            aria-hidden="true"
          >
            {i < digits.length ? <span className="h-2.5 w-2.5 rounded-full bg-black" /> : null}
          </span>
        ))}
      </div>
      <p className="mt-2 h-5 text-center text-[12.5px] text-[#FF3B30]" aria-live="polite">
        {hint ?? ''}
      </p>
      <div className="mt-1 grid grid-cols-3 gap-[1px] overflow-hidden rounded-t-[10px] border-t border-black/[0.08] bg-black/[0.08]">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} type="button" data-testid={`mt-keypad-${k}`} onClick={() => push(k)} disabled={locked} className={locked ? keyBtnLocked : keyBtn}>
            {k}
          </button>
        ))}
        <span className="bg-white" aria-hidden="true" />
        <button type="button" data-testid="mt-keypad-0" onClick={() => push('0')} disabled={locked} className={locked ? keyBtnLocked : keyBtn}>
          0
        </button>
        <button
          type="button"
          aria-label="删除"
          data-testid="mt-keypad-del"
          disabled={locked}
          onClick={() => {
            acc.current = acc.current.slice(0, -1);
            setDigits(acc.current);
          }}
          className={locked ? keyBtnLocked : keyBtn}
        >
          <Delete className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** 美团支付密码验证浮层（充值/提现/修改/关闭前验证；正确回调 onOk；5 次失败锁定 30s 防暴力试错） */
function MtPayPwdGate({ uid, label, onOk, onClose }: { uid: string; label?: string; onOk: () => void; onClose: () => void }) {
  const [errKey, setErrKey] = useState(0);
  const [lock, setLock] = useState<MtPayPwdLock>(() => mtLoadPayPwdLock(uid));
  // 倒计时（秒）：每秒刷新一次让 UI 显示剩余时间
  const [remainSec, setRemainSec] = useState(0);
  useEffect(() => {
    if (lock.lockedUntil <= 0) return;
    const tick = () => {
      const remain = Math.max(0, Math.ceil((lock.lockedUntil - Date.now()) / 1000));
      setRemainSec(remain);
      if (remain <= 0) {
        // 锁到期：清掉 lockedUntil（fails 一并清零，给用户重新试的机会）
        const cleared = { fails: 0, lockedUntil: 0 };
        mtSavePayPwdLock(uid, cleared);
        setLock(cleared);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lock.lockedUntil, uid]);
  const isLocked = lock.lockedUntil > 0 && Date.now() < lock.lockedUntil;
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/60" role="dialog" aria-label="验证支付密码" onClick={isLocked ? undefined : onClose} style={{ animation: 'mtFadeIn 0.22s ease both' }}>
      <MtPayPwdSheet
        key={errKey}
        title="请输入支付密码"
        sub={label}
        hint={
          isLocked
            ? `密码错误次数过多，请 ${remainSec} 秒后再试`
            : errKey > 0
              ? `密码错误，请重新输入（已失败 ${lock.fails} 次，${MT_PAY_PWD_MAX_FAIL} 次后将锁定 ${Math.round(MT_PAY_PWD_LOCK_MS / 1000)} 秒）`
              : undefined
        }
        errorKey={errKey}
        locked={isLocked}
        onClose={onClose}
        onComplete={(pwd) => {
          if (isLocked) return;
          const d = mtLoadPayPwd(uid);
          if (d.pwd && pwd === d.pwd) {
            mtClearPayPwdLock(uid);
            onOk();
          } else {
            const next = mtRecordPayPwdFail(uid);
            setLock(next);
            setErrKey((k) => k + 1);
          }
        }}
      />
    </div>
  );
}

/** 钱包主页（截图对齐：黄头 + 标题旁眼睛 + ¥徽章设置 + 白卡四宫格 + 借钱联名卡 + 彩色图标行 + 账单 + 金融 tab + 笔笔返 + 底部领券浮条） */
function WalletPage({
  session,
  onClose,
  onOpenBalance,
  onOpenCards,
  onOpenBills,
  onOpenPayPwd,
  onOpenLoan,
  onOpenCardQuota,
  onOpenDrugFund,
  onToast,
}: {
  session: MtSession;
  onClose: () => void;
  onOpenBalance: () => void;
  onOpenCards: () => void;
  onOpenBills: () => void;
  onOpenPayPwd: () => void;
  onOpenLoan: () => void;
  onOpenCardQuota: () => void;
  onOpenDrugFund: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const wallet = mtLoadWallet(uid);
  const cards = mtLoadBankCards(uid);
  const drugFund = mtLoadDrugFund(uid);
  const [hideAmt, setHideAmt] = useState(false);
  const [finTab, setFinTab] = useState<'loan' | 'card' | 'drug'>('loan');
  const [promo, setPromo] = useState(true);
  const amtText = hideAmt ? '****' : wallet.balance % 1 === 0 ? String(wallet.balance) : mtW2(wallet.balance);
  const nameTail = session.name.slice(-1) || '*';

  const statCell = (label: string, value: string, onTap: () => void) => (
    <button key={label} type="button" onClick={onTap} className="flex flex-col items-center gap-0.5 active:opacity-70">
      <span className="text-[14px] leading-tight text-black/75">{label}</span>
      <span className="text-[17px] font-semibold leading-tight text-black/90">{value}</span>
    </button>
  );

  const iconCell = (label: string, grad: string, onTap: () => void, children: ReactNode) => (
    <button key={label} type="button" onClick={onTap} className="flex flex-col items-center gap-1.5 active:opacity-75">
      <span className={`grid h-[42px] w-[42px] place-items-center rounded-[13px] bg-gradient-to-br ${grad} shadow-[0_4px_10px_rgba(0,0,0,0.12)]`}>{children}</span>
      <span className="text-[11px] text-black/70">{label}</span>
    </button>
  );

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F8F0CB]">
      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        {/* 黄色渐变头部：返回 + 标题 + 眼睛 + 实名胶囊 + ¥徽章设置 + 实名提示条 */}
        <div className="bg-gradient-to-b from-[#FFDB00] via-[#FFE24D] to-[#F8F0CB] px-4 pb-5 pt-[54px]">
          <div className="relative flex h-10 items-center">
            <button type="button" aria-label="返回" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full active:bg-black/10">
              <ChevronLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.4} />
            </button>
            <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
              <p className="text-[17px] font-bold text-black/90">**{nameTail}的钱包</p>
              <button
                type="button"
                aria-label={hideAmt ? '显示余额' : '隐藏余额'}
                onClick={() => {
                  setHideAmt((v) => !v);
                  onToast(hideAmt ? '余额已显示' : '余额已隐藏');
                }}
                className="grid h-7 w-7 place-items-center rounded-full active:bg-black/10"
              >
                {hideAmt ? <EyeOff className="h-[17px] w-[17px] text-black/70" strokeWidth={1.9} /> : <Eye className="h-[17px] w-[17px] text-black/70" strokeWidth={1.9} />}
              </button>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onToast('实名信息待完善（演示）')}
                className="relative rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-medium text-black/75 active:opacity-80"
              >
                实名待完善
                <span className="absolute -right-0.5 -top-0.5 h-[7px] w-[7px] rounded-full border border-white bg-[#FF3B30]" />
              </button>
              <button type="button" aria-label="钱包设置" onClick={onOpenPayPwd} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/10">
                <BadgeJapaneseYen className="h-[21px] w-[21px] text-black/80" strokeWidth={1.8} />
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onToast('实名信息完善（演示）')}
            className="mt-3 flex w-full items-center justify-between rounded-[12px] bg-white/45 px-3.5 py-3 active:bg-white/60"
          >
            <span className="flex items-center gap-2 text-[13px] font-medium text-black/80">
              <TriangleAlert className="h-4 w-4 text-black/65" strokeWidth={2} />
              立即完善实名信息，解锁更多服务
            </span>
            <span className="text-[13px] font-semibold text-black/80">去完善 &gt;</span>
          </button>
        </div>

        {/* 白卡四宫格：余额/银行卡/药划算/笔笔返（标签在上、数值在下） */}
        <div className="mt-1 px-4">
          <div className="grid grid-cols-4 rounded-[16px] bg-white px-2 py-4 shadow-[0_2px_10px_rgba(90,60,10,0.05)]">
            {statCell('余额', amtText, onOpenBalance)}
            {statCell('银行卡', String(cards.length), onOpenCards)}
            {statCell('药划算', drugFund.activated ? `${drugFund.records.length}笔` : '1个', onOpenDrugFund)}
            {statCell('笔笔返', '0', () => onToast('笔笔返（演示）'))}
          </div>
        </div>

        {/* 白卡双列：美团借钱 | 联名卡 + 新客专属条 */}
        <div className="mt-3 px-4">
          <div className="rounded-[16px] bg-white p-4 shadow-[0_2px_10px_rgba(90,60,10,0.05)]">
            <div className="grid grid-cols-2 divide-x divide-black/[0.06]">
              <button type="button" onClick={onOpenLoan} className="flex flex-col items-start gap-0.5 pr-4 text-left active:opacity-70">
                <span className="text-[15px] font-bold text-black/85">美团借钱</span>
                <span className="text-[20px] font-extrabold leading-tight tracking-[3px] text-black/85">*****</span>
                <span className="text-[11px] text-black/40">随借随还 &gt;</span>
              </button>
              <button type="button" data-testid="wallet-quota-entry" onClick={onOpenCardQuota} className="flex flex-col items-start gap-0.5 pl-4 text-left active:opacity-70">
                <span className="text-[15px] font-bold text-black/85">联名卡</span>
                <span className="text-[20px] font-extrabold leading-tight tracking-[3px] text-black/85">****</span>
                <span className="text-[11px] text-black/40">查看详情 &gt;</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => onToast('新客专属额度（演示）')}
              className="mt-3 flex w-full items-center justify-between rounded-[10px] bg-[#FFF1F1] px-3 py-2.5 active:opacity-80"
            >
              <span className="flex items-center text-[12.5px] text-black/80">
                <span className="mr-2 rounded-[4px] bg-gradient-to-r from-[#FF4D4F] to-[#FF2E63] px-1.5 py-[3px] text-[10px] font-bold text-white">新客专属</span>
                <span>
                  点击领取<span className="font-semibold text-[#FF3B30]">10月额度</span>
                </span>
              </span>
              <span className="text-[12.5px] font-semibold text-[#FF3B30]">去看看 &gt;</span>
            </button>
          </div>
        </div>

        {/* 白卡彩色图标行：借钱/美团保/笔笔返/银行卡/全部 */}
        <div className="mt-3 px-4">
          <div className="grid grid-cols-5 rounded-[16px] bg-white py-4 shadow-[0_2px_10px_rgba(90,60,10,0.05)]">
            {iconCell('借钱', 'from-[#7CB0FF] to-[#3D7BFF]', onOpenLoan, <HandCoins className="h-5 w-5 text-white" strokeWidth={2} />)}
            {iconCell('美团保', 'from-[#FFB02E] to-[#FF6A00]', () => onToast('美团保（演示）'), <span className="text-[15px] font-bold leading-none text-white">保</span>)}
            {iconCell('笔笔返', 'from-[#FF7EB3] to-[#FF2E63]', () => onToast('笔笔返（演示）'), <BadgePercent className="h-5 w-5 text-white" strokeWidth={2.1} />)}
            {iconCell('银行卡', 'from-[#FFC24D] to-[#FF8A00]', onOpenCards, <ShieldCheck className="h-5 w-5 text-white" strokeWidth={2.1} />)}
            {iconCell('全部', 'from-[#FF8A8A] to-[#FF3B5C]', () => onToast('更多钱包服务（演示）'), <Ellipsis className="h-5 w-5 text-white" strokeWidth={2.6} />)}
          </div>
        </div>

        {/* 账单入口 */}
        <div className="mt-3 px-4">
          <button type="button" onClick={onOpenBills} className="flex w-full items-center justify-between rounded-[16px] bg-white px-4 py-4 shadow-[0_2px_10px_rgba(90,60,10,0.05)] active:bg-black/[0.02]">
            <span className="text-[15px] font-bold text-black/85">账单</span>
            <span className="flex items-center text-[12px] text-black/40">
              查看
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </button>
        </div>

        {/* 金融 tab 白卡 */}
        <div className="mt-3 px-4">
          <div className="relative overflow-hidden rounded-[16px] bg-white p-4 shadow-[0_2px_10px_rgba(90,60,10,0.05)]">
            <span className="absolute right-3 top-3 select-none text-[10px] font-medium tracking-[3px] text-[#E8C880]/80">金融服务</span>
            <div className="flex gap-5">
              {(
                [
                  ['loan', '借钱'],
                  ['card', '联名卡'],
                  ['drug', '药划算'],
                ] as ['loan' | 'card' | 'drug', string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFinTab(k)}
                  className={`relative pb-2 text-[14.5px] transition-colors ${finTab === k ? 'font-bold text-black/85' : 'text-black/45'}`}
                >
                  {label}
                  {finTab === k && <span className="absolute inset-x-0 -bottom-px mx-auto h-[3px] w-7 rounded-full bg-[#FFC300]" />}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <p className="text-[11px] text-black/40">最高可享额度</p>
                <p className="mt-1 text-[30px] font-extrabold leading-none text-black/85">{finTab === 'loan' ? '99,800.00' : finTab === 'card' ? '6,600.00' : '300.00'}</p>
              </div>
              <button
                type="button"
                data-testid="wallet-fin-apply"
                onClick={() => (finTab === 'loan' ? onOpenLoan() : finTab === 'card' ? onOpenCardQuota() : onOpenDrugFund())}
                className="rounded-full bg-gradient-to-r from-[#FFD100] to-[#FFC300] px-5 py-2.5 text-[13px] font-bold text-black/80 shadow-[0_4px_12px_rgba(255,195,0,0.35)] active:opacity-85"
              >
                去申领
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              {['10月额度升级', '首年免年费', '100元现金券'].map((t) => (
                <span key={t} className="rounded-[6px] border border-[#FF3B30]/50 px-1.5 py-0.5 text-[10px] leading-4 text-[#FF3B30]">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* 钱包笔笔返 */}
        <div className="mt-3 px-4">
          <div className="rounded-[16px] bg-white p-4 shadow-[0_2px_10px_rgba(90,60,10,0.05)]">
            <button type="button" onClick={() => onToast('钱包笔笔返（演示）')} className="flex w-full items-center justify-between active:opacity-80">
              <span className="text-[15px] font-bold text-black/85">钱包笔笔返</span>
              <span className="flex items-center text-[12px] text-black/40">
                支付可抵钱
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </button>
            <div className="mt-3 rounded-[12px] bg-gradient-to-r from-[#FFF0F3] to-[#FFE9EC] px-4 py-3">
              <div className="grid grid-cols-3">
                {(
                  [
                    ['1笔', '今日笔笔返'],
                    ['500个', '美团币可抵钱'],
                    ['更多', '奖励待解锁'],
                  ] as [string, string][]
                ).map(([v, l], i) => (
                  <div key={l} className={`flex flex-col items-center ${i > 0 ? 'border-l border-[#FF2E63]/10' : ''}`}>
                    <p className="text-[15px] font-bold text-[#FF2E63]">{v}</p>
                    <p className="mt-0.5 text-[10.5px] text-black/40">{l}</p>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => onToast('支付奖励（演示）')} className="mt-2.5 flex w-full items-center justify-between border-t border-[#FF2E63]/10 pt-2.5 active:opacity-70">
                <span className="text-[11.5px] text-black/55">支付奖励</span>
                <span className="text-[11.5px] text-black/40">点击查看 &gt;</span>
              </button>
            </div>
          </div>
        </div>

        {/* 底部领券浮条（可关闭，吸附滚动区底部） */}
        {promo && (
          <div className="sticky bottom-3 z-20 mx-3 mt-4">
            <div className="flex items-center gap-2.5 rounded-[14px] bg-[#1C1C1E]/95 px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.25)] backdrop-blur">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-[#FF5E7E] to-[#FF2E63] text-[18px]" aria-hidden="true">
                🧧
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-white">点击领3元外卖券</p>
                <p className="truncate text-[10.5px] text-white/55">订阅月付交易通知可领</p>
              </div>
              <button type="button" onClick={() => onToast('已领取3元外卖券（演示）')} className="shrink-0 rounded-full bg-[#FFC300] px-3.5 py-1.5 text-[12px] font-bold text-black/85 active:opacity-85">
                去领取
              </button>
              <button type="button" aria-label="关闭" onClick={() => setPromo(false)} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white/50 active:bg-white/10">
                <X className="h-4 w-4" strokeWidth={2.2} />
              </button>
            </div>
          </div>
        )}
        <div className="h-4" />
      </div>
    </div>
  );
}

/** 余额页（仅可提现）：黄头余额卡 + 提现/充值 + 常见问题手风琴 + 美团支付 */
function WalletBalancePage({ session, onClose, onOpenCards, onToast }: { session: MtSession; onClose: () => void; onOpenCards: () => void; onToast: (m: string) => void }) {
  const uid = mtUidOf(session);
  const [, setVer] = useState(0);
  const [hideAmt, setHideAmt] = useState(false);
  const [sheet, setSheet] = useState<'recharge' | 'withdraw' | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [amtText, setAmtText] = useState('');
  const [amtErr, setAmtErr] = useState('');
  const [gate, setGate] = useState<null | { action: 'recharge' | 'withdraw' }>(null);
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  const wallet = mtLoadWallet(uid);
  const cards = mtLoadBankCards(uid);

  const openSheet = (s: 'recharge' | 'withdraw') => {
    setSheet(s);
    setCardId(cards.length > 0 ? (cards[0]?.id ?? null) : null);
    setAmtText('');
    setAmtErr('');
  };

  const amtNum = (() => {
    const n = Number.parseFloat(amtText);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  })();
  const limit = sheet === 'recharge' ? (cards.find((c) => c.id === cardId)?.balance ?? 0) : wallet.balance;

  /** 校验通过后：开支付密码 → 验证后 exec；未开密码 → 直接 exec */
  const confirmAmt = () => {
    if (!(amtNum > 0)) {
      setAmtErr('请输入正确的金额');
      return;
    }
    if (amtNum > limit) {
      setAmtErr(sheet === 'recharge' ? '超出卡内可用余额' : '超出可用余额');
      return;
    }
    if (!cardId) {
      setAmtErr(sheet === 'recharge' ? '请选择银行卡' : '请选择到账银行卡');
      return;
    }
    setAmtErr('');
    if (mtLoadPayPwd(uid).enabled) setGate({ action: sheet === 'recharge' ? 'recharge' : 'withdraw' });
    else exec();
  };

  /** 执行充值/提现（store 内已完成卡扣款/余额入账/账单流水） */
  const exec = () => {
    setGate(null);
    if (!cardId) return;
    if (sheet === 'recharge') {
      const r = mtWalletRecharge(uid, cardId, amtNum);
      if (!r.ok) {
        onToast(r.error ?? '充值失败');
        return;
      }
      onToast('充值成功');
    } else {
      const r = mtWalletWithdraw(uid, cardId, amtNum);
      if (!r.ok) {
        onToast(r.error ?? '提现失败');
        return;
      }
      const card = mtLoadBankCards(uid).find((c) => c.id === cardId);
      onToast(card ? `提现成功，已到账 ${card.bank} 尾号${card.tail}` : '提现成功');
    }
    setSheet(null);
    setAmtText('');
    setCardId(null);
    setVer((v) => v + 1);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F7F8FA]">
      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        {/* 黄色渐变头部：顶栏 + 余额卡（提现/充值按钮在卡内，对齐截图） */}
        <div className="bg-gradient-to-b from-[#FFDB00] via-[#FFE24D] to-[#F7F8FA] px-4 pb-6 pt-[54px]">
          <div className="relative flex h-10 items-center">
            <button type="button" aria-label="返回" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full active:bg-black/10">
              <ChevronLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.4} />
            </button>
            <p className="absolute left-1/2 -translate-x-1/2 text-[16px] font-bold text-black/85">余额（仅可提现）</p>
            <div className="ml-auto flex items-center">
              <button type="button" aria-label="联系客服" onClick={() => onToast('在线客服（演示）')} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/10">
                <Headset className="h-[19px] w-[19px] text-black/75" strokeWidth={1.9} />
              </button>
              <button type="button" aria-label="更多" onClick={() => onToast('余额帮助（演示）')} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/10">
                <Ellipsis className="h-[19px] w-[19px] text-black/75" strokeWidth={1.9} />
              </button>
            </div>
          </div>
          <div className="mt-3 rounded-[18px] bg-white px-5 pb-5 pt-5 shadow-[0_4px_16px_rgba(90,60,10,0.06)]">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] text-black/45">可用余额 (元)</span>
              <button
                type="button"
                aria-label={hideAmt ? '显示余额' : '隐藏余额'}
                onClick={() => setHideAmt((v) => !v)}
                className="grid h-6 w-6 place-items-center rounded-full active:bg-black/5"
              >
                {hideAmt ? <EyeOff className="h-3.5 w-3.5 text-black/40" strokeWidth={1.9} /> : <Eye className="h-3.5 w-3.5 text-black/40" strokeWidth={1.9} />}
              </button>
            </div>
            <p className="mt-1.5 text-[42px] font-bold leading-none text-black/90">{hideAmt ? '****' : mtW2(wallet.balance)}</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => openSheet('withdraw')}
                className="rounded-full border border-black/[0.12] bg-white py-3 text-[15px] font-semibold text-black/85 active:opacity-80"
              >
                提现
              </button>
              <button
                type="button"
                onClick={() => openSheet('recharge')}
                className="rounded-full bg-[#FFC300] py-3 text-[15px] font-bold text-black/85 shadow-[0_4px_12px_rgba(255,195,0,0.3)] active:opacity-90"
              >
                充值
              </button>
            </div>
          </div>
        </div>

        {/* 常见问题手风琴（黄色「问」徽章 + 展开答案含蓝色链接，对齐截图） */}
        <div className="px-4 pt-4">
          <div className="rounded-[18px] bg-white px-4 py-2 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
            <div className="flex items-center justify-between py-2.5">
              <p className="text-[16px] font-bold text-black/85">常见问题</p>
              <button type="button" onClick={() => onToast('更多常见问题（演示）')} className="flex items-center text-[12px] text-black/40">
                更多
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            {MT_BALANCE_FAQS.map((f, i) => (
              <div key={f.q} className={i > 0 ? 'border-t border-black/[0.04]' : ''}>
                <button type="button" onClick={() => setFaqOpen((o) => (o === i ? null : i))} className="flex w-full items-center gap-2.5 py-3.5 text-left">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#FFC300] text-[11px] font-bold text-white">问</span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-black/85">{f.q}</span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-black/30 transition-transform ${faqOpen === i ? 'rotate-180' : ''}`} />
                </button>
                {faqOpen === i && (
                  <div className="pb-4 pl-[30px] pr-1">
                    <p className="text-[12.5px] leading-relaxed text-black/45">{f.a}</p>
                    {f.a2 ? (
                      <p className="mt-2 text-[12.5px] leading-relaxed text-black/45">
                        {f.a2}
                        <button type="button" onClick={() => onToast('完善身份信息（演示）')} className="text-[#1677FF]">
                          {f.link}
                        </button>
                        {f.tail}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="pb-[30px] pt-10 text-center">
          <p className="text-[15px] font-semibold text-black/20">美团支付</p>
          <p className="mt-1 text-[10px] text-black/15">美团支付，省钱省心</p>
        </div>
      </div>

      {/* 充值/提现弹层：选卡 → 输金额 → 确认（→ 支付密码验证） */}
      {sheet && (
        <MtWalletSheet title={sheet === 'recharge' ? '余额充值' : '余额提现'} onClose={() => setSheet(null)}>
          {cards.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-9">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-[#FFF6D9]">
                <CreditCard className="h-7 w-7 text-[#C8860D]" strokeWidth={1.8} />
              </span>
              <p className="text-[13px] text-black/45">暂无银行卡{sheet === 'recharge' ? '，无法充值' : '，无法提现'}</p>
              <button
                type="button"
                onClick={onOpenCards}
                className="rounded-full bg-gradient-to-r from-[#FFD100] to-[#FFC300] px-6 py-2.5 text-[13px] font-bold text-black/85 shadow-[0_4px_12px_rgba(255,195,0,0.3)] active:opacity-90"
              >
                去添加银行卡
              </button>
            </div>
          ) : (
            <div className="pt-3">
              <p className="px-4 pb-2 text-[12px] font-medium text-black/45">{sheet === 'recharge' ? '选择付款银行卡' : '选择到账银行卡'}</p>
              <MtWalletCardPicker
                cards={cards}
                value={cardId}
                onPick={(id) => {
                  setCardId(id);
                  setAmtErr('');
                }}
              />
              <div className="px-4 pt-4">
                <p className="pb-2 text-[12px] font-medium text-black/45">
                  {sheet === 'recharge' ? '充值金额' : `提现金额（可用 ¥${mtW2(wallet.balance)}）`}
                </p>
                <div className="flex items-center gap-2 rounded-[12px] border border-black/[0.08] bg-[#F7F8FA] px-4 py-3 transition-colors focus-within:border-[#FFC300]">
                  <span className="text-[20px] font-bold text-black/70">¥</span>
                  <input
                    value={amtText}
                    onChange={(e) => {
                      setAmtText(e.target.value.replace(/[^\d.]/g, '').slice(0, 10));
                      setAmtErr('');
                    }}
                    inputMode="decimal"
                    placeholder={sheet === 'recharge' ? '从该卡划转至余额' : '全部提现可输入可用余额'}
                    className="min-w-0 flex-1 bg-transparent text-[19px] font-semibold text-black/85 outline-none placeholder:text-[12px] placeholder:font-normal placeholder:text-black/30"
                    aria-label={sheet === 'recharge' ? '充值金额' : '提现金额'}
                  />
                  {sheet === 'withdraw' && wallet.balance > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setAmtText(String(wallet.balance));
                        setAmtErr('');
                      }}
                      className="shrink-0 rounded-full bg-[#FFF6D9] px-2.5 py-1 text-[11px] font-semibold text-[#C8860D] active:opacity-80"
                    >
                      全部
                    </button>
                  ) : null}
                </div>
                {amtErr ? <p className="mt-1.5 text-[12px] text-[#FF3B30]">{amtErr}</p> : null}
                <div className="mt-3 flex gap-2">
                  {[50, 100, 200, 500].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        setAmtText(String(v));
                        setAmtErr('');
                      }}
                      className="flex-1 rounded-full border border-black/[0.08] bg-white py-1.5 text-[12px] text-black/65 transition-colors active:border-[#FFC300]"
                    >
                      ¥{v}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={confirmAmt}
                  className="mt-4 w-full rounded-full bg-gradient-to-r from-[#FFD100] to-[#FFC300] py-3 text-[15px] font-bold text-black/85 shadow-[0_6px_16px_rgba(255,195,0,0.35)] active:opacity-90"
                >
                  确认{sheet === 'recharge' ? '充值' : '提现'}
                </button>
                <p className="mt-2.5 text-center text-[11px] text-black/35">资金仅在本人银行卡与余额间划转（演示环境）</p>
              </div>
            </div>
          )}
        </MtWalletSheet>
      )}

      {/* 支付密码验证浮层 */}
      {gate && (
        <MtPayPwdGate
          uid={uid}
          label={`${gate.action === 'recharge' ? '充值' : '提现'} ¥${mtW2(amtNum)}`}
          onOk={exec}
          onClose={() => setGate(null)}
        />
      )}
    </div>
  );
}

/** 银行卡专区（黑金主题）：金句 + 特性 + 添加卡流程 + 卡列表 + 图标行 + 权益活动 */
function WalletCardsPage({ session, onClose, onOpenBills, onOpenPayPwd, onOpenDrugFund, onToast }: { session: MtSession; onClose: () => void; onOpenBills: () => void; onOpenPayPwd: () => void; onOpenDrugFund: () => void; onToast: (m: string) => void }) {
  const uid = mtUidOf(session);
  const [, setVer] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [addStep, setAddStep] = useState<'bank' | 'no' | 'bal'>('bank');
  const [bank, setBank] = useState<string | null>(null);
  const [cardNo, setCardNo] = useState('');
  const [balText, setBalText] = useState('1000');
  const [addErr, setAddErr] = useState('');
  const [manageId, setManageId] = useState<string | null>(null);
  const cards = mtLoadBankCards(uid);
  const manageCard = manageId ? cards.find((c) => c.id === manageId) : undefined;

  const openAdd = () => {
    setAddOpen(true);
    setAddStep('bank');
    setBank(null);
    setCardNo('');
    setBalText('1000');
    setAddErr('');
  };

  const confirmAdd = () => {
    const digits = cardNo.replace(/\D/g, '');
    if (digits.length < 4) {
      setAddErr('请输入至少 4 位卡号');
      return;
    }
    const bal = Number.parseFloat(balText);
    const balance = Number.isFinite(bal) && bal > 0 ? Math.round(bal * 100) / 100 : 0;
    const r = mtAddBankCard(uid, bank ?? '银行卡', digits, balance);
    if ('error' in r) {
      setAddErr(r.error);
      onToast(r.error);
      return;
    }
    setAddOpen(false);
    setVer((v) => v + 1);
    onToast(`已添加${r.bank} 尾号${r.tail}`);
  };

  const removeCard = (id: string) => {
    const card = cards.find((c) => c.id === id);
    mtRemoveBankCard(uid, id);
    setManageId(null);
    setVer((v) => v + 1);
    onToast(card ? `已删除${card.bank} 尾号${card.tail}` : '已删除银行卡');
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#0A0A0A]">
      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        {/* 黑金首屏：星空背景 + 顶栏（返回+标题左对齐/设置/客服）+ 金句 + 三特性 + 金色添加按钮 + 卡列表 */}
        <div className="relative overflow-hidden bg-[#0A0A0A] px-4 pb-7 pt-[54px]">
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
            style={{
              backgroundImage:
                'radial-gradient(1.2px 1.2px at 12% 16%, rgba(255,255,255,0.85) 50%, transparent 51%), radial-gradient(1px 1px at 30% 7%, rgba(255,255,255,0.5) 50%, transparent 51%), radial-gradient(1.4px 1.4px at 56% 20%, rgba(255,255,255,0.7) 50%, transparent 51%), radial-gradient(1px 1px at 76% 10%, rgba(255,255,255,0.55) 50%, transparent 51%), radial-gradient(1.6px 1.6px at 90% 28%, rgba(255,236,190,0.85) 50%, transparent 51%), radial-gradient(1px 1px at 20% 36%, rgba(255,255,255,0.4) 50%, transparent 51%), radial-gradient(1.2px 1.2px at 66% 40%, rgba(255,255,255,0.5) 50%, transparent 51%), radial-gradient(1px 1px at 44% 30%, rgba(255,255,255,0.35) 50%, transparent 51%), linear-gradient(115deg, transparent 40%, rgba(255,214,130,0.16) 47%, transparent 53%), linear-gradient(60deg, transparent 58%, rgba(255,214,130,0.1) 65%, transparent 71%)',
            }}
          />
          <div className="relative">
            <div className="flex items-center">
              <button type="button" aria-label="返回" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full active:bg-white/10">
                <ChevronLeft className="h-[22px] w-[22px] text-white" strokeWidth={2.4} />
              </button>
              <p className="ml-1 text-[17px] font-bold text-white">银行卡专区</p>
              <div className="ml-auto flex items-center">
                <button type="button" aria-label="支付设置" onClick={onOpenPayPwd} className="grid h-9 w-9 place-items-center rounded-full active:bg-white/10">
                  <Settings className="h-[19px] w-[19px] text-white/85" strokeWidth={1.9} />
                </button>
                <button type="button" aria-label="联系客服" onClick={() => onToast('在线客服（演示）')} className="grid h-9 w-9 place-items-center rounded-full active:bg-white/10">
                  <Headset className="h-[19px] w-[19px] text-white/85" strokeWidth={1.9} />
                </button>
              </div>
            </div>

            <p className="mt-7 bg-gradient-to-r from-[#E8B96A] via-[#FFEDC9] to-[#E8B96A] bg-clip-text text-center text-[24px] font-bold italic leading-snug text-transparent">
              添加你在美团的第{cards.length + 1}张银行卡
            </p>

            <div className="mt-7 grid grid-cols-3">
              {(
                [
                  ['无卡号添加', CreditCard],
                  ['支付随心控', CircleDollarSign],
                  ['优惠权益多', ShieldCheck],
                ] as [string, LucideIcon][]
              ).map(([label, Icon]) => (
                <div key={label} className="flex flex-col items-center gap-2">
                  <span className="grid h-[50px] w-[50px] place-items-center rounded-[16px] bg-[#17171A] ring-1 ring-[#E8B96A]/25">
                    <Icon className="h-[22px] w-[22px] text-[#E8B96A]" strokeWidth={1.8} />
                  </span>
                  <span className="text-[12px] text-[#E8C890]">{label}</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={openAdd}
              className="mt-7 flex w-full items-center justify-center gap-1 rounded-full bg-gradient-to-r from-[#F3D3A0] to-[#E4B36B] py-3.5 text-[16px] font-bold text-[#5A3A10] shadow-[0_8px_24px_rgba(228,179,107,0.22)] active:opacity-90"
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={2.8} />
              添加银行卡
            </button>

            {/* 已添加卡列表（银行品牌色卡面） */}
            {cards.length > 0 && (
              <div className="mt-6 space-y-3.5">
                {cards.map((c) => {
                  const meta = mtBankMeta(c.bank);
                  return (
                    <div key={c.id} className={`relative overflow-hidden rounded-[16px] bg-gradient-to-br ${meta.grad} p-4 shadow-[0_10px_28px_rgba(0,0,0,0.45)]`}>
                      <span className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/10" aria-hidden="true" />
                      <div className="relative flex items-start justify-between">
                        <div className="min-w-0">
                          <p className="text-[15px] font-bold text-white">{c.bank}</p>
                          <p className="mt-0.5 text-[10.5px] text-white/65">储蓄卡 · 尾号{c.tail}</p>
                        </div>
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/20 text-[13px] font-bold text-white">{meta.short}</span>
                      </div>
                      <p className="relative mt-4 text-[16px] font-semibold tracking-[3px] text-white/95">**** **** **** {c.tail}</p>
                      <div className="relative mt-3.5 flex items-end justify-between">
                        <p className="text-[11px] text-white/60">
                          卡内余额 <span className="text-[17px] font-bold text-white">¥{mtW2(c.balance)}</span>
                        </p>
                        <button type="button" onClick={() => setManageId(c.id)} className="rounded-full bg-white/20 px-3.5 py-1 text-[11px] font-medium text-white active:bg-white/30">
                          管理
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 白色圆角面板：彩色图标行 + 翻页点 + 权益活动 + 底部落款 */}
        <div className="relative min-h-[430px] rounded-t-[22px] bg-white/80 backdrop-blur-2xl backdrop-saturate-150 px-4 pb-6 pt-4">
          <div className="grid grid-cols-5 py-1">
            {(
              [
                ['交易明细', Receipt, 'from-[#FF7EB3] to-[#FF2E63]', onOpenBills],
                ['支付设置', Settings, 'from-[#FFB02E] to-[#FF6A00]', onOpenPayPwd],
                ['极速支付', Zap, 'from-[#FFD54D] to-[#FFAB00]', () => onToast('极速支付（演示）')],
                ['联名卡', CreditCard, 'from-[#5AA9FF] to-[#2E7BFF]', () => onToast('联名卡（演示）')],
                ['积分专区', Star, 'from-[#FFA24D] to-[#FF7A00]', () => onToast('积分专区（演示）')],
              ] as [string, LucideIcon, string, () => void][]
            ).map(([label, Icon, grad, onTap]) => (
              <button key={label} type="button" onClick={onTap} className="flex flex-col items-center gap-1.5 active:opacity-70">
                <span className={`grid h-[42px] w-[42px] place-items-center rounded-[13px] bg-gradient-to-br ${grad} shadow-[0_4px_10px_rgba(0,0,0,0.12)]`}>
                  <Icon className="h-5 w-5 text-white" strokeWidth={2} />
                </span>
                <span className="text-[10.5px] text-black/70">{label}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-center gap-1">
            <span className="h-1 w-4 rounded-full bg-[#FFC300]" />
            <span className="h-1 w-1.5 rounded-full bg-black/15" />
          </div>

          <p className="mt-6 text-[17px] font-bold text-black/85">权益活动</p>
          <div className="mt-3 rounded-[16px] bg-gradient-to-br from-[#FFF9EC] to-[#FFF3DC] p-4">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5">
                  <span className="text-[16px] font-bold text-black/85">天天领券</span>
                  <span className="h-3 w-px bg-black/15" aria-hidden="true" />
                  <span className="text-[11px] font-medium text-[#FF3B30]">今日已上新</span>
                </p>
                <p className="mt-1 text-[11.5px] text-black/40">快来银行卡专区免费领福利吧</p>
                <button
                  type="button"
                  onClick={() => onToast('已领取银行卡专享券（演示）')}
                  className="mt-2.5 rounded-full bg-gradient-to-r from-[#FF5E4D] to-[#FF3B30] px-4 py-1.5 text-[12px] font-bold text-white shadow-[0_4px_10px_rgba(255,59,48,0.3)] active:opacity-85"
                >
                  去领取
                </button>
              </div>
              <span className="shrink-0 text-[38px] leading-none" aria-hidden="true">
                🍔🧧
              </span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2.5 rounded-[16px] bg-[#FFF6D9] p-3.5">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-[#FF5E4D] to-[#E4372B] text-[10px] font-bold leading-none text-[#FFE9B8]"
              aria-hidden="true"
            >
              限时
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-bold text-black/85">你有一笔购药抵扣金待激活</p>
              <p className="mt-0.5 text-[10.5px] text-black/40">美团优质用户专享</p>
            </div>
            <button type="button" data-testid="cards-drugfund-entry" onClick={onOpenDrugFund} className="shrink-0 rounded-full bg-[#FFC300] px-3.5 py-1.5 text-[12px] font-bold text-black/85 active:opacity-85">
              点我激活
            </button>
          </div>
          <div className="mt-3 flex items-center justify-center gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`h-1 rounded-full ${i === 0 ? 'w-3.5 bg-black/35' : 'w-1 bg-black/15'}`} />
            ))}
          </div>

          <div className="pt-9 text-center">
            <p className="text-[15px] font-semibold text-black/20">美团支付</p>
            <p className="mt-1 text-[10px] tracking-[2px] text-black/15">— 美团旗下金融服务 —</p>
          </div>
        </div>
      </div>

      {/* 添加银行卡流程弹层（美化版）：选银行 → 卡面预览 + 自动生成卡号（可换/可改）→ 初始余额 */}
      {addOpen && (
        <MtWalletSheet title="添加银行卡" onClose={() => setAddOpen(false)}>
          <div className="px-4 pb-2 pt-3">
            {/* 步骤指示条 */}
            <div className="mb-4 flex items-center justify-center gap-1.5">
              {(['bank', 'no', 'bal'] as const).map((s, i) => {
                const cur = ['bank', 'no', 'bal'].indexOf(addStep);
                return <span key={s} className={`h-1 rounded-full transition-all ${addStep === s ? 'w-6 bg-[#FFC300]' : i < cur ? 'w-2.5 bg-[#FFD900]/50' : 'w-2.5 bg-black/10'}`} />;
              })}
            </div>

            {addStep === 'bank' && (
              <>
                <p className="pb-2.5 text-[12px] font-medium text-black/45">选择银行</p>
                <div className="grid max-h-64 grid-cols-2 gap-2.5 overflow-y-auto no-scrollbar">
                  {MT_BANK_NAMES.map((b) => {
                    const meta = mtBankMeta(b);
                    return (
                      <button
                        key={b}
                        type="button"
                        onClick={() => {
                          setBank(b);
                          setCardNo(mtGenCardNo(b));
                          setAddErr('');
                          setAddStep('no');
                        }}
                        className={`flex items-center gap-2.5 rounded-[12px] border px-3 py-3 text-left transition-colors active:opacity-80 ${
                          bank === b ? 'border-[#E4B36B] bg-[#FFF8E9]' : 'border-black/[0.08] bg-[#F7F8FA]'
                        }`}
                      >
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-gradient-to-br ${meta.grad} text-[13px] font-bold text-white`}>{meta.short}</span>
                        <span className="min-w-0 truncate text-[12.5px] font-medium text-black/80">{b}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {addStep === 'no' && bank && (
              <>
                {/* 卡面实时预览 */}
                <div className={`relative overflow-hidden rounded-[16px] bg-gradient-to-br ${mtBankMeta(bank).grad} p-4 text-white shadow-[0_10px_26px_rgba(0,0,0,0.22)]`}>
                  <span className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/10" aria-hidden="true" />
                  <div className="relative flex items-center justify-between">
                    <p className="text-[14px] font-bold">{bank}</p>
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20 text-[12px] font-bold">{mtBankMeta(bank).short}</span>
                  </div>
                  <div className="relative mt-4 h-7 w-10 rounded-[5px] bg-gradient-to-br from-[#FFE9A8] to-[#D8A93F]" aria-hidden="true">
                    <span className="absolute left-1 top-1/2 h-[1.5px] w-8 -translate-y-1/2 bg-[#B58524]/60" />
                  </div>
                  <p className="relative mt-3 text-[17px] font-semibold tracking-[2px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {mtFmtCardNo(cardNo) || '•••• •••• •••• ••••'}
                  </p>
                  <div className="relative mt-2.5 flex items-center justify-between text-[10.5px] text-white/70">
                    <span>储蓄卡</span>
                    <span>美团演示卡</span>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <p className="flex items-center text-[12px] font-medium text-black/45">
                    银行卡号
                    <span className="ml-2 rounded-[4px] bg-[#FFF6D9] px-1.5 py-0.5 text-[10px] font-medium text-[#C8860D]">已自动生成 · 可修改</span>
                  </p>
                  <button type="button" onClick={() => { setCardNo(mtGenCardNo(bank)); setAddErr(''); }} className="flex items-center gap-1 text-[12px] font-semibold text-[#C8860D] active:opacity-70">
                    <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.2} />
                    换一个
                  </button>
                </div>
                <input
                  value={mtFmtCardNo(cardNo)}
                  onChange={(e) => {
                    setCardNo(e.target.value.replace(/\D/g, '').slice(0, 19));
                    setAddErr('');
                  }}
                  inputMode="numeric"
                  placeholder="请输入或使用自动生成的卡号"
                  className="mt-2 w-full rounded-[12px] border border-black/[0.08] bg-[#F7F8FA] px-4 py-3 text-[15px] tracking-[1.5px] text-black/85 outline-none transition-colors placeholder:tracking-normal placeholder:text-[12px] placeholder:text-black/30 focus:border-[#FFC300]"
                  aria-label="银行卡号"
                />
                {addErr ? <p className="mt-1.5 text-[12px] text-[#FF3B30]">{addErr}</p> : null}
                <div className="mt-4 flex gap-3">
                  <button type="button" onClick={() => setAddStep('bank')} className="flex-1 rounded-full border border-black/[0.12] py-2.5 text-[14px] text-black/70 active:opacity-80">
                    上一步
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (cardNo.replace(/\D/g, '').length < 4) {
                        setAddErr('请输入至少 4 位卡号');
                        return;
                      }
                      setAddErr('');
                      setAddStep('bal');
                    }}
                    className="flex-1 rounded-full bg-gradient-to-r from-[#FFD100] to-[#FFC300] py-2.5 text-[14px] font-bold text-black/85 shadow-[0_4px_12px_rgba(255,195,0,0.3)] active:opacity-90"
                  >
                    下一步
                  </button>
                </div>
              </>
            )}

            {addStep === 'bal' && bank && (
              <>
                <div className="flex items-center gap-3 rounded-[12px] bg-[#F7F8FA] p-3">
                  <span className={`grid h-10 w-10 place-items-center rounded-[10px] bg-gradient-to-br ${mtBankMeta(bank).grad} text-[15px] font-bold text-white`}>{mtBankMeta(bank).short}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-black/85">{bank}</p>
                    <p className="mt-0.5 truncate text-[11px] text-black/40">尾号{cardNo.replace(/\D/g, '').slice(-4)} · {mtFmtCardNo(cardNo)}</p>
                  </div>
                </div>
                <p className="mt-4 pb-2 text-[12px] font-medium text-black/45">卡内余额（演示用）</p>
                <div className="flex items-center gap-2 rounded-[12px] border border-black/[0.08] bg-[#F7F8FA] px-4 py-3 transition-colors focus-within:border-[#FFC300]">
                  <span className="text-[18px] font-bold text-black/70">¥</span>
                  <input
                    value={balText}
                    onChange={(e) => {
                      setBalText(e.target.value.replace(/[^\d.]/g, '').slice(0, 10));
                      setAddErr('');
                    }}
                    inputMode="decimal"
                    className="min-w-0 flex-1 bg-transparent text-[17px] font-semibold text-black/85 outline-none"
                    aria-label="卡内余额"
                  />
                </div>
                {addErr ? <p className="mt-1.5 text-[12px] text-[#FF3B30]">{addErr}</p> : null}
                <div className="mt-3 flex gap-2">
                  {[500, 1000, 5000, 10000].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        setBalText(String(v));
                        setAddErr('');
                      }}
                      className="flex-1 rounded-full border border-black/[0.08] bg-white py-1.5 text-[12px] text-black/65 transition-colors active:border-[#FFC300]"
                    >
                      ¥{v >= 10000 ? '1万' : v >= 1000 ? `${v / 1000}千` : v}
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex gap-3">
                  <button type="button" onClick={() => setAddStep('no')} className="flex-1 rounded-full border border-black/[0.12] py-2.5 text-[14px] text-black/70 active:opacity-80">
                    上一步
                  </button>
                  <button
                    type="button"
                    onClick={confirmAdd}
                    className="flex-1 rounded-full bg-gradient-to-r from-[#FFD100] to-[#FFC300] py-2.5 text-[14px] font-bold text-black/85 shadow-[0_4px_12px_rgba(255,195,0,0.3)] active:opacity-90"
                  >
                    确认添加
                  </button>
                </div>
              </>
            )}
          </div>
        </MtWalletSheet>
      )}

      {/* 卡片管理弹层（美化版）：卡摘要 + 删除/取消 */}
      {manageId && (
        <MtWalletSheet title="卡片管理" onClose={() => setManageId(null)}>
          <div className="px-4 py-3">
            {manageCard ? (
              <div className="flex items-center gap-3 rounded-[12px] bg-[#F7F8FA] p-3">
                <span className={`grid h-10 w-10 place-items-center rounded-[10px] bg-gradient-to-br ${mtBankMeta(manageCard.bank).grad} text-[15px] font-bold text-white`}>
                  {mtBankMeta(manageCard.bank).short}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-black/85">
                    {manageCard.bank} 尾号{manageCard.tail}
                  </p>
                  <p className="mt-0.5 text-[11px] text-black/40">卡内余额 ¥{mtW2(manageCard.balance)}</p>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => manageId && removeCard(manageId)}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-[#FFF0F0] py-3 text-[14px] font-medium text-[#FF3B30] active:opacity-80"
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
              删除卡片
            </button>
            <button type="button" onClick={() => setManageId(null)} className="mt-2 w-full rounded-full bg-[#F7F8FA] py-3 text-[14px] text-black/70 active:opacity-80">
              取消
            </button>
          </div>
        </MtWalletSheet>
      )}
    </div>
  );
}

/** 账单页：按日分组（今天/昨天/M月d日）流水列表 */
function WalletBillsPage({ session, onClose }: { session: MtSession; onClose: () => void }) {
  const uid = mtUidOf(session);
  const [toastMsg, showToast] = useLocalToast();
  const bills = mtLoadWalletBills(uid);
  const groups: { label: string; items: MtWalletBill[] }[] = [];
  for (const b of bills) {
    const label = mtBillGroupLabel(b.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(b);
    else groups.push({ label, items: [b] });
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F7F8FA]">
      {/* 顶栏：返回 + 账单 + 按月 */}
      <div className="relative flex h-[94px] shrink-0 items-center border-b border-black/[0.04] bg-white px-3 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.2} />
        </button>
        <p className="absolute left-1/2 top-[74px] -translate-x-1/2 -translate-y-1/2 text-[16px] font-semibold text-black/85">账单</p>
        <button type="button" onClick={() => showToast('按月查看（演示）')} className="ml-auto pr-1 text-[12px] text-black/45 active:opacity-70">
          按月
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pt-3 no-scrollbar">
        {bills.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-24">
            <Receipt className="h-10 w-10 text-black/15" strokeWidth={1.5} />
            <p className="text-[13px] text-black/35">暂无账单</p>
          </div>
        ) : (
          groups.map((g) => (
            <div key={`${g.label}-${g.items[0]?.id ?? ''}`} className="px-4 pb-3">
              <p className="pb-1.5 text-[12px] font-medium text-black/40">{g.label}</p>
              <div className="divide-y divide-black/[0.04] rounded-[14px] bg-white px-4">
                {g.items.map((b) => {
                  const { Icon, cls } = mtBillIcon(b.kind);
                  return (
                    <div key={b.id} className="flex items-center gap-3 py-3">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${cls}`}>
                        <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium text-black/85">{b.title || MT_WALLET_BILL_LABEL[b.kind]}</p>
                        <p className="mt-0.5 truncate text-[11px] text-black/35">{[b.card, mtBillItemTime(b.at)].filter(Boolean).join(' · ')}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-[15px] font-bold ${b.amount >= 0 ? 'text-[#07C160]' : 'text-black/85'}`}>
                          {b.amount >= 0 ? '+' : '-'}¥{mtW2(Math.abs(b.amount))}
                        </p>
                        {b.status ? <p className="mt-0.5 text-[10px] text-black/35">{b.status}</p> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
        <div className="h-[28px]" />
      </div>
      <LocalToast msg={toastMsg} />
    </div>
  );
}

/** 借钱页：额度申请（模拟审批）→ 去借款（金额/期数/还款计划）→ 还一期/一次还清（美团余额扣款）→ 借款记录 */
function WalletLoanPage({ session, onClose, onToast }: { session: MtSession; onClose: () => void; onToast: (m: string) => void }) {
  const uid = mtUidOf(session);
  const [acct, setAcct] = useState(() => mtLoadLoanAccount(uid));
  const [loans, setLoans] = useState(() => mtLoadLoans(uid));
  const [wallet, setWallet] = useState(() => mtLoadWallet(uid));
  const [agree, setAgree] = useState(false);
  const [approving, setApproving] = useState(false);
  /** 借款弹层 / 还款弹层（loanId + 模式） */
  const [borrowOpen, setBorrowOpen] = useState(false);
  const [repayFor, setRepayFor] = useState<null | { loanId: string; mode: 'period' | 'all' }>(null);

  const refresh = () => {
    setAcct(mtLoadLoanAccount(uid));
    setLoans(mtLoadLoans(uid));
    setWallet(mtLoadWallet(uid));
  };

  const used = mtLoanUsedCredit(uid);
  const avail = mtLoanAvailable(uid);
  const activeLoans = loans.filter((l) => l.status === 'active');
  const remainTotal = Math.round(activeLoans.reduce((s, l) => s + mtLoanRemainOf(l), 0) * 100) / 100;
  const repayLoan = repayFor ? (loans.find((l) => l.id === repayFor.loanId) ?? null) : null;

  /** 申请额度：模拟审批（1.4s 审批中 → 随机获批 8,800~99,800） */
  const apply = async () => {
    if (approving) return;
    if (!agree) {
      onToast('请先勾选同意协议');
      return;
    }
    setApproving(true);
    await new Promise((r) => setTimeout(r, 1400));
    mtApplyLoanCredit(uid);
    setApproving(false);
    refresh();
    onToast('审批通过，恭喜获得借款额度');
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#FAFAF8]">
      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        {/* 黄渐变头部：返回 + 客服 + logo 行 + 大标题 */}
        <div className="bg-gradient-to-b from-[#FFE9A0] via-[#FFF4C9] to-[#FAFAF8] px-4 pb-6 pt-[54px]">
          <div className="relative flex h-10 items-center">
            <button type="button" aria-label="返回" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full active:bg-black/10">
              <ChevronLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.4} />
            </button>
            <button type="button" aria-label="联系客服" onClick={() => onToast('在线客服（演示）')} className="ml-auto grid h-9 w-9 place-items-center rounded-full active:bg-black/10">
              <Headset className="h-[19px] w-[19px] text-black/70" strokeWidth={1.9} />
            </button>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#FFD100] text-[11px] font-bold leading-none text-black/85">美团</span>
            <span className="text-[18px] font-bold text-black/85">美团·借钱</span>
          </div>
          <p className="mt-3 text-[30px] font-extrabold leading-tight tracking-wide text-[#5C3A18]">生活周转小帮手</p>
        </div>

        {/* 额度白卡：未申请（大约可借 ****** + 协议 + 申请）/ 已申请（可借额度 + 去借款） */}
        <div className="px-4">
          <div className="rounded-[18px] bg-white px-5 py-6 shadow-[0_4px_16px_rgba(90,60,10,0.05)]">
            {!acct.applied ? (
              <>
                <p className="text-center text-[13.5px] text-black/55">大约可借 (元)</p>
                <p className="mt-2 text-center text-[42px] font-extrabold leading-none tracking-[6px] text-black/85">******</p>
                <p className="mt-3 text-center text-[11.5px] text-black/35">最终获取额度，以实际审批为准</p>
                <button
                  type="button"
                  data-testid="loan-apply"
                  onClick={() => void apply()}
                  disabled={approving}
                  className="mt-5 w-full rounded-full bg-[#FFD100] py-3.5 text-[16px] font-bold text-black/85 shadow-[0_6px_16px_rgba(255,209,0,0.35)] active:opacity-90 disabled:opacity-70"
                >
                  {approving ? (
                    <span className="flex items-center justify-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.4} />
                      审批中…
                    </span>
                  ) : (
                    '点击申请'
                  )}
                </button>
                <div className="mt-4 flex items-start gap-2">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={agree}
                    aria-label="同意协议"
                    onClick={() => setAgree((v) => !v)}
                    className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors ${agree ? 'border-[#FFC300] bg-[#FFC300]' : 'border-black/25'}`}
                  >
                    {agree && <Check className="h-2.5 w-2.5 text-black" strokeWidth={3.5} />}
                  </button>
                  <p className="text-[10.5px] leading-relaxed text-black/40">
                    已同意<span className="text-[#1677FF]">协议</span>
                    ，将您美团留存的手机号、银行卡及身份证号用于美团金融服务，该服务由美团小贷及其合作金融机构提供
                  </p>
                </div>
              </>
            ) : (
              <>
                <p className="text-center text-[13.5px] text-black/55">可借额度 (元)</p>
                <p className="mt-2 text-center text-[42px] font-extrabold leading-none text-black/85" data-testid="loan-avail">
                  {mtAmtComma(avail)}
                </p>
                <div className="mt-3 flex items-center justify-center gap-2.5 text-[11.5px] text-black/40">
                  <span>总额度 ¥{mtAmtComma(acct.credit)}</span>
                  <span className="h-2.5 w-px bg-black/10" />
                  <span>在贷 ¥{mtAmtComma(used)}</span>
                  <span className="h-2.5 w-px bg-black/10" />
                  <span>余额 ¥{mtW2(wallet.balance)}</span>
                </div>
                <button
                  type="button"
                  data-testid="loan-borrow-entry"
                  onClick={() => (avail >= 500 ? setBorrowOpen(true) : onToast('可借额度不足 ¥500，可先还款释放额度'))}
                  className="mt-5 w-full rounded-full bg-[#FFD100] py-3.5 text-[16px] font-bold text-black/85 shadow-[0_6px_16px_rgba(255,209,0,0.35)] active:opacity-90"
                >
                  去借款
                </button>
              </>
            )}
          </div>
        </div>

        {/* 还款中借据（还一期 / 一次还清，均从美团余额扣款） */}
        {activeLoans.length > 0 && (
          <div className="mt-6 px-4">
            <div className="flex items-end justify-between pb-2">
              <p className="text-[16px] font-bold text-black/85">还款中</p>
              <p className="text-[11.5px] text-black/40">
                剩余待还 <span className="font-bold text-[#FF4B33]">¥{mtW2(remainTotal)}</span>
              </p>
            </div>
            <div className="divide-y divide-black/[0.04] rounded-[14px] bg-white px-4 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
              {activeLoans.map((l) => (
                <div key={l.id} className="py-3.5" data-testid="loan-active-item">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#FFF6D9]">
                      <CircleDollarSign className="h-[17px] w-[17px] text-[#C8860D]" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-bold text-black/85">借款 ¥{mtAmtComma(l.amount)}</p>
                      <p className="mt-0.5 truncate text-[11px] text-black/40">
                        {l.periods}期 · 年化(单利) {l.apr}% · 每期 ¥{mtW2(l.monthly)} · 已还 {l.paidPeriods}/{l.periods} 期
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[#FFF6D9] px-2 py-0.5 text-[10px] font-semibold text-[#C8860D]">还款中</span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2 pl-[46px]">
                    <p className="min-w-0 flex-1 text-[11px] text-black/45">
                      剩余待还 <span className="text-[13px] font-bold text-[#FF4B33]">¥{mtW2(mtLoanRemainOf(l))}</span>
                    </p>
                    <button
                      type="button"
                      data-testid="loan-repay-period"
                      onClick={() => setRepayFor({ loanId: l.id, mode: 'period' })}
                      className="shrink-0 rounded-full bg-[#FFD100] px-3.5 py-1.5 text-[12px] font-bold text-black/85 active:opacity-85"
                    >
                      还一期
                    </button>
                    <button
                      type="button"
                      data-testid="loan-repay-all"
                      onClick={() => setRepayFor({ loanId: l.id, mode: 'all' })}
                      className="shrink-0 rounded-full border border-black/15 px-3.5 py-1.5 text-[12px] font-semibold text-black/70 active:opacity-70"
                    >
                      一次还清
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 借款记录 */}
        {loans.length > 0 && (
          <div className="mt-6 px-4">
            <p className="pb-2 text-[16px] font-bold text-black/85">借款记录</p>
            <div className="divide-y divide-black/[0.04] rounded-[14px] bg-white px-4 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
              {loans.slice(0, 8).map((l) => (
                <div key={l.id} className="flex items-center gap-3 py-3.5">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${l.status === 'repaid' ? 'bg-[#F1F2F4]' : 'bg-[#FFF6D9]'}`}>
                    <CircleDollarSign className={`h-[17px] w-[17px] ${l.status === 'repaid' ? 'text-black/30' : 'text-[#C8860D]'}`} strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-black/85">
                      借款 ¥{mtAmtComma(l.amount)} · {l.periods}期
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-black/35">{fmtDateTime(l.borrowedAt)} · 年化(单利) {l.apr}%</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-[11px] font-semibold ${l.status === 'repaid' ? 'text-black/35' : 'text-[#C8860D]'}`}>{l.status === 'repaid' ? '已还清' : '还款中'}</p>
                    {l.status === 'active' && <p className="mt-0.5 text-[10.5px] text-black/35">剩 ¥{mtW2(mtLoanRemainOf(l))}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 产品详情（居中节标题 + 灰卡行） */}
        <p className="pt-7 text-center text-[16px] font-bold text-black/85">产品详情</p>
        <div className="mt-3 px-4">
          <div className="divide-y divide-black/[0.04] rounded-[14px] bg-[#F5F6F7] px-4">
            {(
              [
                ['借款额度', '500 - 200,000'],
                ['年化利率 (单利)', '5.4% - 24%'],
                ['分期期限', '3、6、12 期'],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between py-3.5">
                <span className="text-[13px] text-black/50">{k}</span>
                <span className="text-[13.5px] font-semibold text-black/85">{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 四大安全保障 */}
        <p className="pt-7 text-center text-[16px] font-bold text-black/85">四大安全保障</p>
        <div className="mt-3 px-4 pb-[28px]">
          <div className="divide-y divide-black/[0.04] rounded-[14px] bg-white px-4 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
            {MT_LOAN_GUARDS.map((g) => (
              <div key={g.t} className="py-3.5">
                <p className="text-[13.5px] font-bold text-black/85">{g.t}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-black/45">{g.d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 借款弹层（金额/期数/还款计划 → 放款到美团余额） */}
      {borrowOpen && (
        <LoanBorrowSheet
          uid={uid}
          avail={avail}
          balance={wallet.balance}
          onClose={() => setBorrowOpen(false)}
          onDone={() => {
            setBorrowOpen(false);
            refresh();
          }}
          onToast={onToast}
        />
      )}
      {/* 还款确认弹层（美团余额扣款；不足提示先充值） */}
      {repayLoan && repayFor && (
        <LoanRepaySheet
          uid={uid}
          loan={repayLoan}
          mode={repayFor.mode}
          balance={wallet.balance}
          onClose={() => setRepayFor(null)}
          onDone={() => {
            setRepayFor(null);
            refresh();
          }}
          onToast={onToast}
        />
      )}
    </div>
  );
}

/** 借款弹层：金额（快捷chips）+ 期数（年化利率）+ 还款计划预览 → 确认借款放款到美团余额 */
function LoanBorrowSheet({
  uid,
  avail,
  balance,
  onClose,
  onDone,
  onToast,
}: {
  uid: string;
  avail: number;
  balance: number;
  onClose: () => void;
  onDone: () => void;
  onToast: (m: string) => void;
}) {
  const [amt, setAmt] = useState('');
  const [periods, setPeriods] = useState<3 | 6 | 12>(3);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const num = Math.round((parseFloat(amt) || 0) * 100) / 100;
  const plan = num >= 500 && num <= avail ? mtLoanPlan(num, periods) : null;

  const submit = async () => {
    if (busy) return;
    if (!(num >= 500)) {
      setErr('借款金额最低 ¥500');
      return;
    }
    if (num > avail) {
      setErr(`超出可借额度（可借 ¥${mtAmtComma(avail)}）`);
      return;
    }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 900));
    const res = mtBorrow(uid, num, periods);
    setBusy(false);
    if (!res.ok) {
      setErr(res.error ?? '借款失败，请重试');
      return;
    }
    onToast(`借款成功，¥${mtW2(num)} 已到账美团余额`);
    onDone();
  };

  return (
    <MtWalletSheet title="去借款" onClose={onClose}>
      <div className="px-4 pb-2">
        {/* 可借额度 / 美团余额 */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-[14px] bg-[#FFFBEA] px-4 py-3">
            <p className="text-[11.5px] text-[#8A6116]/70">可借额度</p>
            <p className="mt-0.5 text-[17px] font-extrabold text-black/85">¥{mtAmtComma(avail)}</p>
          </div>
          <div className="rounded-[14px] bg-[#F7F8FA] px-4 py-3">
            <p className="text-[11.5px] text-black/45">美团余额（放款至）</p>
            <p className="mt-0.5 text-[17px] font-extrabold text-black/85">¥{mtW2(balance)}</p>
          </div>
        </div>

        <p className="pb-2 pt-4 text-[14px] font-semibold text-black/80">借款金额</p>
        <div className="flex items-center gap-1.5 rounded-[12px] border border-black/10 bg-white px-4 transition-colors focus-within:border-[#FFC300]">
          <span className="text-[22px] font-bold text-black/80">¥</span>
          <input
            value={amt}
            onChange={(e) => {
              setAmt(e.target.value.replace(/[^\d.]/g, '').replace(/(\..*?)\./g, '$1'));
              setErr('');
            }}
            inputMode="decimal"
            placeholder="最低500元"
            aria-label="借款金额"
            className="h-12 min-w-0 flex-1 bg-transparent text-[18px] font-bold text-black/90 outline-none placeholder:text-[13px] placeholder:font-normal placeholder:text-black/25"
          />
          {amt !== '' && (
            <button type="button" aria-label="清空" onClick={() => setAmt('')}>
              <X className="h-4 w-4 text-black/30" />
            </button>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {[500, 1000, 5000, 10000].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setAmt(String(v));
                setErr('');
              }}
              disabled={v > avail}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${v > avail ? 'bg-black/[0.04] text-black/25' : 'bg-[#FFF6D9] text-[#8A6116] active:opacity-80'}`}
            >
              ¥{v.toLocaleString('en-US')}
            </button>
          ))}
          {avail >= 500 && (
            <button
              type="button"
              onClick={() => {
                setAmt(String(Math.floor(avail)));
                setErr('');
              }}
              className="rounded-full bg-[#FFF6D9] px-3.5 py-1.5 text-[12.5px] font-semibold text-[#8A6116] active:opacity-80"
            >
              全部
            </button>
          )}
        </div>

        <p className="pb-2 pt-4 text-[14px] font-semibold text-black/80">借款期限</p>
        <div className="grid grid-cols-3 gap-2.5">
          {([3, 6, 12] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriods(p)}
              className={`rounded-[12px] border py-2.5 text-center transition-colors ${periods === p ? 'border-[#FFC300] bg-[#FFFBEA]' : 'border-black/10 bg-white'}`}
            >
              <span className={`block text-[15px] font-bold ${periods === p ? 'text-black/90' : 'text-black/60'}`}>{p}期</span>
              <span className="mt-0.5 block text-[10px] text-black/40">年化 {mtLoanAprOf(p)}%</span>
            </button>
          ))}
        </div>

        {/* 还款计划预览 */}
        <div className={`mt-4 rounded-[14px] px-4 py-3.5 ${plan ? 'bg-[#FFFBEA]' : 'bg-[#F7F8FA]'}`} data-testid="loan-plan">
          {plan ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-black/50">每期应还（共{periods}期）</span>
                <span className="text-[16px] font-extrabold text-black/90">¥{mtW2(plan.monthly)}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[12px]">
                <span className="text-black/40">总利息</span>
                <span className="text-black/70">¥{mtW2(plan.totalInterest)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[12px]">
                <span className="text-black/40">到期应还总额</span>
                <span className="text-black/70">¥{mtW2(plan.totalDue)}</span>
              </div>
            </>
          ) : (
            <p className="text-center text-[12px] text-black/35">输入金额后查看每期还款计划</p>
          )}
        </div>
        {err && <p className="mt-2 text-center text-[12px] text-[#FF4B33]">{err}</p>}
        <p className="mt-3 text-[10.5px] leading-relaxed text-black/35">借款将放款至美团余额，可用于消费支付或提现到银行卡；还款从美团余额扣款。</p>
        <button
          type="button"
          data-testid="loan-borrow-confirm"
          onClick={() => void submit()}
          disabled={busy}
          className="mt-3 w-full rounded-full bg-gradient-to-r from-[#FFD100] to-[#FFC300] py-3.5 text-[16px] font-bold text-black/85 shadow-[0_6px_16px_rgba(255,209,0,0.35)] active:opacity-90 disabled:opacity-60"
        >
          {busy ? '放款中…' : '确认借款'}
        </button>
      </div>
    </MtWalletSheet>
  );
}

/** 还款确认弹层：还一期 / 一次还清（美团余额扣款；余额不足提示先充值） */
function LoanRepaySheet({
  uid,
  loan,
  mode,
  balance,
  onClose,
  onDone,
  onToast,
}: {
  uid: string;
  loan: MtLoan;
  mode: 'period' | 'all';
  balance: number;
  onClose: () => void;
  onDone: () => void;
  onToast: (m: string) => void;
}) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const remain = mtLoanRemainOf(loan);
  const amt = mode === 'period' ? loan.monthly : remain;
  const isLast = loan.paidPeriods + 1 >= loan.periods;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 700));
    if (mode === 'period') {
      const res = mtRepayLoanPeriod(uid, loan.id);
      setBusy(false);
      if (!res.ok) {
        setErr(res.error ?? '还款失败，请重试');
        return;
      }
      onToast(res.done ? '已还清，借据结清' : `已还第${loan.paidPeriods + 1}期`);
    } else {
      const res = mtRepayLoanAll(uid, loan.id);
      setBusy(false);
      if (!res.ok) {
        setErr(res.error ?? '还款失败，请重试');
        return;
      }
      onToast('一次还清成功，借据已结清');
    }
    onDone();
  };

  return (
    <MtWalletSheet title={mode === 'period' ? '立即还款' : '一次还清'} onClose={onClose}>
      <div className="px-4 pb-2">
        <div className="rounded-[14px] bg-[#FFFBEA] px-4 py-3.5">
          <p className="text-[12px] text-black/45">
            借款 ¥{mtAmtComma(loan.amount)} · {loan.periods}期 · 已还 {loan.paidPeriods}/{loan.periods} 期
          </p>
          <p className="mt-1.5 text-[28px] font-extrabold leading-none text-black/90">¥{mtW2(amt)}</p>
          <p className="mt-1.5 text-[11px] text-black/40">
            {mode === 'period' ? (isLast ? '本期为最后一期，还完自动结清' : `第${loan.paidPeriods + 1}期应还（本息均摊）`) : `剩余全部本息（${loan.periods - loan.paidPeriods}期）`}
          </p>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-[14px] bg-white px-4 py-3 ring-1 ring-black/[0.06]">
          <span className="min-w-0 flex-1 text-[13px] text-black/55">美团余额（还款来源）</span>
          <span className="shrink-0 text-[14px] font-bold text-black/85">¥{mtW2(balance)}</span>
        </div>
        {err && <p className="mt-2 text-center text-[12px] text-[#FF4B33]">{err}</p>}
        <button
          type="button"
          data-testid="loan-repay-confirm"
          onClick={() => void submit()}
          disabled={busy}
          className="mt-3 w-full rounded-full bg-gradient-to-r from-[#FFD100] to-[#FFC300] py-3.5 text-[16px] font-bold text-black/85 shadow-[0_6px_16px_rgba(255,209,0,0.35)] active:opacity-90 disabled:opacity-60"
        >
          {busy ? '还款中…' : '确认还款'}
        </button>
        <p className="mt-3 text-[10.5px] leading-relaxed text-black/35">余额不足时，可先在钱包「余额」页用银行卡充值后再还款。</p>
      </div>
    </MtWalletSheet>
  );
}

// ================================ 我的卡额度（美团联名卡，钱包区入口） ================================

/** 我的卡额度页：未申领（免费申领+协议+模拟审批）/ 已获批（总额度·已用·可用 + 消费记录 + 权益） */
function WalletCardQuotaPage({ session, onClose, onToast }: { session: MtSession; onClose: () => void; onToast: (m: string) => void }) {
  const uid = mtUidOf(session);
  const [quota, setQuota] = useState(() => mtLoadCardQuota(uid));
  const [agree, setAgree] = useState(false);
  const [approving, setApproving] = useState(false);
  const cards = mtLoadBankCards(uid);
  const used = mtCardQuotaUsed(uid);
  const avail = mtCardQuotaAvailable(uid);
  /** 联名卡消费记录：钱包账单里的银行卡支付 */
  const bills = mtLoadWalletBills(uid)
    .filter((b) => b.kind === 'pay' && (b.card ?? '').includes('尾号'))
    .slice(0, 8);

  /** 免费申领：模拟审批（1.4s → 随机获批 19,800~99,800） */
  const apply = async () => {
    if (approving) return;
    if (!agree) {
      onToast('请先勾选同意协议');
      return;
    }
    setApproving(true);
    await new Promise((r) => setTimeout(r, 1400));
    mtApplyCardQuota(uid);
    setApproving(false);
    setQuota(mtLoadCardQuota(uid));
    onToast('申领成功，恭喜获得联名卡额度');
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#FAFAF8]">
      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        {/* 黄渐变头部：返回 + 联名卡标识 + 大标题 */}
        <div className="bg-gradient-to-b from-[#FFE9A0] via-[#FFF4C9] to-[#FAFAF8] px-4 pb-6 pt-[54px]">
          <div className="relative flex h-10 items-center">
            <button type="button" aria-label="返回" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full active:bg-black/10">
              <ChevronLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.4} />
            </button>
            <button type="button" aria-label="联系客服" onClick={() => onToast('在线客服（演示）')} className="ml-auto grid h-9 w-9 place-items-center rounded-full active:bg-black/10">
              <Headset className="h-[19px] w-[19px] text-black/70" strokeWidth={1.9} />
            </button>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#FFD100] text-[11px] font-bold leading-none text-black/85">美团</span>
            <span className="text-[18px] font-bold text-black/85">我的卡额度</span>
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-[#8A6A1F]">美团联名卡 · 合作金融机构提供</span>
          </div>
          <p className="mt-3 text-[30px] font-extrabold leading-tight tracking-wide text-[#5C3A18]">免费申领 先享后付</p>
        </div>

        {/* 额度白卡：未申领（最高可享 ****** + 协议 + 免费申领）/ 已获批（可用额度 + 总额·已用） */}
        <div className="px-4">
          <div className="rounded-[18px] bg-white px-5 py-6 shadow-[0_4px_16px_rgba(90,60,10,0.05)]">
            {!quota.applied ? (
              <>
                <p className="text-center text-[13.5px] text-black/55">最高可享额度 (元)</p>
                <p className="mt-2 text-center text-[42px] font-extrabold leading-none tracking-[6px] text-black/85" data-testid="cardquota-hero">
                  ******
                </p>
                <p className="mt-3 text-center text-[11.5px] text-black/35">最终获取额度，以实际审批为准</p>
                <button
                  type="button"
                  data-testid="cardquota-apply"
                  onClick={() => void apply()}
                  disabled={approving}
                  className="mt-5 w-full rounded-full bg-[#FFD100] py-3.5 text-[16px] font-bold text-black/85 shadow-[0_6px_16px_rgba(255,209,0,0.35)] active:opacity-90 disabled:opacity-70"
                >
                  {approving ? (
                    <span className="flex items-center justify-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.4} />
                      审批中…
                    </span>
                  ) : (
                    '免费申领'
                  )}
                </button>
                <div className="mt-4 flex items-start gap-2">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={agree}
                    aria-label="同意协议"
                    onClick={() => setAgree((v) => !v)}
                    className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors ${agree ? 'border-[#FFC300] bg-[#FFC300]' : 'border-black/25'}`}
                  >
                    {agree && <Check className="h-2.5 w-2.5 text-black" strokeWidth={3.5} />}
                  </button>
                  <p className="text-[10.5px] leading-relaxed text-black/40">
                    已同意<span className="text-[#1677FF]">《美团联名卡服务协议》</span>及<span className="text-[#1677FF]">《个人信息处理授权书》</span>
                    ，同意合作金融机构查询并留存必要信息用于额度审批
                  </p>
                </div>
              </>
            ) : (
              <>
                <p className="text-center text-[13.5px] text-black/55">可用额度 (元)</p>
                <p className="mt-2 text-center text-[42px] font-extrabold leading-none text-black/85" data-testid="cardquota-avail">
                  {mtAmtComma(avail)}
                </p>
                <div className="mt-3 flex items-center justify-center gap-2.5 text-[11.5px] text-black/40">
                  <span data-testid="cardquota-total">总额度 ¥{mtAmtComma(quota.total)}</span>
                  <span className="h-2.5 w-px bg-black/10" />
                  <span>已用 ¥{mtAmtComma(used)}</span>
                  <span className="h-2.5 w-px bg-black/10" />
                  <span>{fmtDate(quota.appliedAt)} 获批</span>
                </div>
                <button type="button" onClick={() => onToast('额度会随使用情况不定期提升')} className="mt-4 w-full rounded-full border border-[#FFC300] bg-[#FFFBEB] py-3 text-[15px] font-bold text-[#B77900] active:opacity-85">
                  申请提额
                </button>
              </>
            )}
          </div>
        </div>

        {/* 绑定银行卡（联名卡额度绑定本机添加的银行卡展示） */}
        <div className="mt-6 px-4">
          <p className="pb-2 text-[16px] font-bold text-black/85">绑定银行卡</p>
          {cards.length === 0 ? (
            <button type="button" onClick={() => onToast('请在钱包「银行卡」页添加银行卡后再使用额度')} className="w-full rounded-[14px] bg-white px-4 py-5 text-center text-[13px] text-black/45 shadow-[0_2px_10px_rgba(0,0,0,0.03)] active:opacity-80">
              还没有绑定银行卡，去钱包添加
            </button>
          ) : (
            <div className="divide-y divide-black/[0.04] rounded-[14px] bg-white px-4 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
              {cards.map((c) => {
                const meta = mtBankMeta(c.bank);
                return (
                  <div key={c.id} className="flex items-center gap-3 py-3.5">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-gradient-to-br ${meta.grad} text-[11px] font-bold text-white shadow-sm`}>{meta.short}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-black/85">{c.bank}（尾号{c.tail}）</p>
                      <p className="mt-0.5 text-[11px] text-black/40">卡内余额 ¥{mtW2(c.balance)}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[#FFF6D9] px-2 py-0.5 text-[10px] font-semibold text-[#C8860D]">额度可用</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 消费记录（额度使用流水：钱包账单里银行卡支付） */}
        {bills.length > 0 && (
          <div className="mt-6 px-4">
            <p className="pb-2 text-[16px] font-bold text-black/85">消费记录</p>
            <div className="divide-y divide-black/[0.04] rounded-[14px] bg-white px-4 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
              {bills.map((b) => (
                <div key={b.id} className="flex items-center gap-3 py-3.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#FDEBEB]">
                    <ArrowUp className="h-[16px] w-[16px] text-[#E64340]" strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-black/85">{b.card}</p>
                    <p className="mt-0.5 truncate text-[11px] text-black/35">{fmtDateTime(b.at)} · 消费</p>
                  </div>
                  <span className="shrink-0 text-[14px] font-bold text-[#E64340]">-¥{mtW2(Math.abs(b.amount))}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 三大用卡权益 */}
        <p className="pt-7 text-center text-[16px] font-bold text-black/85">用卡权益</p>
        <div className="mt-3 px-4 pb-[28px]">
          <div className="divide-y divide-black/[0.04] rounded-[14px] bg-white px-4 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
            {(
              [
                ['终身免年费', '联名卡不分卡种、不设门槛，终身免年费'],
                ['支付立减优惠', '美团支付使用联名卡，随机立减最高 2.28 元/笔'],
                ['笔笔返积分', '消费 1 元累计 1 积分，积分可兑红包与优惠券'],
              ] as [string, string][]
            ).map(([t, d]) => (
              <div key={t} className="py-3.5">
                <p className="text-[13.5px] font-bold text-black/85">{t}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-black/45">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ================================ 购药抵扣金（钱包区入口） ================================

/** 购药抵扣金页：未激活（点我激活 ¥3.00）/ 已激活（余额 + 明细 + 使用规则）；看病买药订单支付时自动抵扣 */
function WalletDrugFundPage({ session, onClose, onToast }: { session: MtSession; onClose: () => void; onToast: (m: string) => void }) {
  const uid = mtUidOf(session);
  const [fund, setFund] = useState(() => mtLoadDrugFund(uid));

  const activate = () => {
    const next = mtActivateDrugFund(uid);
    setFund({ ...next });
    onToast('激活成功，¥3.00 购药抵扣金已到账');
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#FAFAF8]">
      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        {/* 绿调渐变头部：返回 + 标识 + 大标题 */}
        <div className="bg-gradient-to-b from-[#D9F5E4] via-[#ECFBF1] to-[#FAFAF8] px-4 pb-6 pt-[54px]">
          <div className="relative flex h-10 items-center">
            <button type="button" aria-label="返回" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full active:bg-black/10">
              <ChevronLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.4} />
            </button>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#00B578] text-white">
              <Cross className="h-4 w-4" strokeWidth={2.4} />
            </span>
            <span className="text-[18px] font-bold text-black/85">购药抵扣金</span>
            <span className="rounded-full bg-white/75 px-2 py-0.5 text-[10px] font-medium text-[#0A8F5B]">看病买药专享</span>
          </div>
          <p className="mt-3 text-[30px] font-extrabold leading-tight tracking-wide text-[#0A6B47]">买药立抵 实名专享</p>
        </div>

        {/* 金额白卡：未激活（¥3.00 待激活）/ 已激活（余额） */}
        <div className="px-4">
          <div className="rounded-[18px] bg-white px-5 py-6 shadow-[0_4px_16px_rgba(20,90,60,0.06)]">
            {!fund.activated ? (
              <>
                <p className="text-center text-[13.5px] text-black/55">你的专享抵扣金</p>
                <p className="mt-2 text-center text-[42px] font-extrabold leading-none text-[#00A860]" data-testid="drugfund-hero">
                  ¥3.00
                </p>
                <p className="mt-3 text-center text-[11.5px] text-black/35">激活后看病买药下单时自动抵扣</p>
                <button
                  type="button"
                  data-testid="drugfund-activate"
                  onClick={activate}
                  className="mt-5 w-full rounded-full bg-[#FFD100] py-3.5 text-[16px] font-bold text-black/85 shadow-[0_6px_16px_rgba(255,209,0,0.35)] active:opacity-90"
                >
                  点我激活
                </button>
              </>
            ) : (
              <>
                <p className="text-center text-[13.5px] text-black/55">抵扣金余额</p>
                <p className="mt-2 text-center text-[42px] font-extrabold leading-none text-[#00A860]" data-testid="drugfund-balance">
                  ¥{mtW2(fund.balance)}
                </p>
                <div className="mt-3 flex items-center justify-center gap-2.5 text-[11.5px] text-black/40">
                  <span>{fmtDate(fund.activatedAt)} 激活</span>
                  <span className="h-2.5 w-px bg-black/10" />
                  <span>{fund.records.length} 笔记录</span>
                </div>
                <button
                  type="button"
                  data-testid="drugfund-use"
                  onClick={() => onToast(fund.balance > 0 ? '去「看病买药」下单，支付时自动抵扣' : '抵扣金已用完，可关注后续活动再次领取')}
                  className="mt-4 w-full rounded-full bg-[#FFD100] py-3.5 text-[16px] font-bold text-black/85 shadow-[0_6px_16px_rgba(255,209,0,0.35)] active:opacity-90"
                >
                  去使用
                </button>
              </>
            )}
          </div>
        </div>

        {/* 明细 */}
        {fund.records.length > 0 && (
          <div className="mt-6 px-4">
            <p className="pb-2 text-[16px] font-bold text-black/85">明细记录</p>
            <div className="divide-y divide-black/[0.04] rounded-[14px] bg-white px-4 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
              {fund.records.map((r) => (
                <div key={r.id} className="flex items-center gap-3 py-3.5">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${r.amount >= 0 ? 'bg-[#E5F8EE]' : 'bg-[#FDEBEB]'}`}>
                    {r.amount >= 0 ? <ArrowDown className="h-[16px] w-[16px] text-[#00A860]" strokeWidth={2} /> : <ArrowUp className="h-[16px] w-[16px] text-[#E64340]" strokeWidth={2} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-black/85">{r.title}</p>
                    <p className="mt-0.5 truncate text-[11px] text-black/35">{fmtDateTime(r.at)}</p>
                  </div>
                  <span className={`shrink-0 text-[14px] font-bold ${r.amount >= 0 ? 'text-[#00A860]' : 'text-[#E64340]'}`}>
                    {r.amount >= 0 ? '+' : '-'}¥{mtW2(Math.abs(r.amount))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 使用规则 */}
        <p className="pt-7 text-center text-[16px] font-bold text-black/85">使用规则</p>
        <div className="mt-3 px-4 pb-[28px]">
          <div className="divide-y divide-black/[0.04] rounded-[14px] bg-white px-4 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
            {(
              [
                ['适用范围', '看病买药频道（大药房/医药连锁等商家）的外卖订单，下单支付时自动抵扣'],
                ['抵扣方式', '每单最多抵扣 1 笔抵扣金，抵扣金额不高于订单实付金额'],
                ['有效期', '激活到账后 30 天内有效，到期未使用自动清零'],
                ['其他说明', '抵扣金不找零、不可转让；退款订单按实际抵扣金额退回抵扣金'],
              ] as [string, string][]
            ).map(([t, d]) => (
              <div key={t} className="py-3.5">
                <p className="text-[13.5px] font-bold text-black/85">{t}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-black/45">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ================================ 开发票（服务宫格入口） ================================

/** 开发票页：待开票（已支付订单列表）+ 开票记录；抬头类型/抬头/税号/邮箱表单提交 */
function InvoicePage({ session, onBack, onToast }: { session: MtSession; onBack: () => void; onToast: (m: string) => void }) {
  const uid = mtUidOf(session);
  const [tab, setTab] = useState<'todo' | 'done'>('todo');
  const [, setVer] = useState(0);
  const invoices = mtLoadInvoices(uid);
  const invoicedIds = new Set(invoices.map((i) => i.orderId));
  const orders = mtLoadOrders(uid)
    .filter((o) => o.paidAt && o.status !== 'pendingPay' && o.status !== 'canceled' && !invoicedIds.has(o.id))
    .reverse();
  const [invFor, setInvFor] = useState<MtOrder | null>(null);

  return (
    <div className="flex h-full flex-col bg-[#F7F8FA]">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.04] bg-white px-3 pb-2.5 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-6 w-6 text-black/70" />
        </button>
        <p className="flex-1 text-center text-[16px] font-semibold text-black/85">开发票</p>
        <span className="h-9 w-9" />
      </div>

      {/* 页签：待开票 / 开票记录 */}
      <div className="flex shrink-0 gap-6 bg-white px-5">
        {(
          [
            ['todo', `待开票${orders.length > 0 ? ` (${orders.length})` : ''}`],
            ['done', `开票记录${invoices.length > 0 ? ` (${invoices.length})` : ''}`],
          ] as ['todo' | 'done', string][]
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`relative py-3 text-[15px] ${tab === k ? 'font-bold text-black/90' : 'text-black/45'}`}>
            {label}
            {tab === k && <span className="absolute inset-x-1 -bottom-px h-[3px] rounded-full bg-[#FFC300]" />}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar px-4 py-3">
        {tab === 'todo' ? (
          orders.length === 0 ? (
            <div className="flex flex-col items-center pt-24 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-white shadow-sm">
                <Receipt className="h-7 w-7 text-black/25" strokeWidth={1.6} />
              </span>
              <p className="mt-4 text-[14px] text-black/45">暂无可开发票的订单</p>
              <p className="mt-1 text-[11.5px] text-black/30">订单完成支付后即可在这里申请开票</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {orders.map((o) => (
                <div key={o.id} className="rounded-[14px] bg-white p-4 shadow-[0_1px_6px_rgba(0,0,0,0.03)]">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[14.5px] font-bold text-black/85">{o.merchantName}</p>
                    <span className="shrink-0 text-[15px] font-bold" style={{ color: MT_PRICE }}>
                      ¥{fmtMoney(o.total)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[11.5px] text-black/40">{o.items.map((it) => `${it.name}×${it.qty}`).join('、')}</p>
                  <div className="mt-2.5 flex items-center justify-between border-t border-black/[0.04] pt-2.5">
                    <p className="text-[11px] text-black/35">{fmtDateTime(o.paidAt ?? o.createdAt)} 支付</p>
                    <button type="button" data-testid={`invoice-open-${o.id}`} onClick={() => setInvFor(o)} className="rounded-full bg-[#FFD100] px-4 py-1.5 text-[12px] font-bold text-black/85 active:opacity-85">
                      开发票
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center pt-24 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-white shadow-sm">
              <FileText className="h-7 w-7 text-black/25" strokeWidth={1.6} />
            </span>
            <p className="mt-4 text-[14px] text-black/45">暂无开票记录</p>
            <p className="mt-1 text-[11.5px] text-black/30">开票成功后会在这里展示</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {invoices.map((inv) => (
              <div key={inv.id} className="rounded-[14px] bg-white p-4 shadow-[0_1px_6px_rgba(0,0,0,0.03)]">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-[#FFF3B8] px-1.5 py-0.5 text-[10px] text-[#B77900]">{inv.type}抬头</span>
                  <p className="min-w-0 flex-1 truncate text-[14.5px] font-bold text-black/85">{inv.title}</p>
                  <span className="shrink-0 rounded-full bg-[#E8F9EF] px-2 py-0.5 text-[10px] text-[#00A661]">{inv.status}</span>
                </div>
                <p className="mt-1.5 truncate text-[11.5px] text-black/40">
                  {inv.merchantName} · 电子发票已发送至 {inv.email}
                </p>
                <div className="mt-2.5 flex items-center justify-between border-t border-black/[0.04] pt-2.5">
                  <p className="text-[11px] text-black/35">{fmtDateTime(inv.at)}</p>
                  <span className="text-[14px] font-bold text-black/85">¥{fmtMoney(inv.amount)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 开票表单弹层 */}
      <AnimatePresence>
        {invFor && (
          <InvoiceSheet
            key={invFor.id}
            uid={uid}
            order={invFor}
            onClose={() => setInvFor(null)}
            onDone={(inv) => {
              setInvFor(null);
              setVer((v) => v + 1);
              setTab('done');
              onToast(`开票成功，电子发票已发送至 ${inv.email}`);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** 开票表单弹层：抬头类型（个人/单位）+ 抬头 + 税号（单位）+ 邮箱 → 提交开票 */
function InvoiceSheet({ uid, order, onClose, onDone }: { uid: string; order: MtOrder; onClose: () => void; onDone: (inv: MtInvoice) => void }) {
  const [type, setType] = useState<'个人' | '单位'>('个人');
  const [title, setTitle] = useState('');
  const [taxNo, setTaxNo] = useState('');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const t = title.trim();
    if (!t) {
      setErr('请填写发票抬头');
      return;
    }
    if (type === '单位' && !taxNo.trim()) {
      setErr('单位抬头需要填写税号');
      return;
    }
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setErr('请填写正确的接收邮箱');
      return;
    }
    setErr('');
    setBusy(true);
    await new Promise((r) => setTimeout(r, 900));
    const inv = mtAddInvoice(uid, {
      orderId: order.id,
      merchantName: order.merchantName,
      amount: order.total,
      type,
      title: t,
      ...(type === '单位' ? { taxNo: taxNo.trim() } : {}),
      email: em,
    });
    setBusy(false);
    onDone(inv);
  };

  return (
    <MtWalletSheet title="开发票" onClose={onClose}>
      <div className="max-h-[72vh] overflow-y-auto px-4 pb-5">
        {/* 订单摘要 */}
        <div className="flex items-center gap-2.5 rounded-[12px] bg-[#F7F8FA] px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-bold text-black/85">{order.merchantName}</p>
            <p className="mt-0.5 truncate text-[11px] text-black/40">{order.items.map((it) => `${it.name}×${it.qty}`).join('、')}</p>
          </div>
          <span className="shrink-0 text-[16px] font-bold" style={{ color: MT_PRICE }}>
            ¥{fmtMoney(order.total)}
          </span>
        </div>

        {/* 抬头类型 */}
        <p className="mt-4 text-[13px] font-semibold text-black/70">抬头类型</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(['个人', '单位'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`h-11 rounded-[10px] border text-[14px] font-medium active:opacity-80 ${type === t ? 'border-[#FFC300] bg-[#FFFBEB] text-black/85' : 'border-black/10 text-black/55'}`}
            >
              {t}抬头
            </button>
          ))}
        </div>

        {/* 表单 */}
        <p className="mt-4 text-[13px] font-semibold text-black/70">抬头名称</p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={type === '个人' ? '填写个人姓名' : '填写单位全称'}
          className="mt-2 h-11 w-full rounded-[10px] border border-black/10 px-3.5 text-[14px] outline-none placeholder:text-black/25 focus:border-[#FFC300]"
        />
        {type === '单位' && (
          <>
            <p className="mt-3 text-[13px] font-semibold text-black/70">单位税号</p>
            <input
              value={taxNo}
              onChange={(e) => setTaxNo(e.target.value)}
              placeholder="统一社会信用代码"
              className="mt-2 h-11 w-full rounded-[10px] border border-black/10 px-3.5 text-[14px] outline-none placeholder:text-black/25 focus:border-[#FFC300]"
            />
          </>
        )}
        <p className="mt-3 text-[13px] font-semibold text-black/70">接收邮箱</p>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoCapitalize="none"
          placeholder="电子发票将发送至该邮箱"
          className="mt-2 h-11 w-full rounded-[10px] border border-black/10 px-3.5 text-[14px] outline-none placeholder:text-black/25 focus:border-[#FFC300]"
        />

        {err && <p className="mt-3 text-[12px] text-[#FF4B33]">{err}</p>}

        <button
          type="button"
          data-testid="invoice-submit"
          onClick={() => void submit()}
          disabled={busy}
          className="mt-5 w-full rounded-full bg-gradient-to-r from-[#FFD100] to-[#FFC300] py-3.5 text-[16px] font-bold text-black/85 shadow-[0_6px_16px_rgba(255,209,0,0.35)] active:opacity-90 disabled:opacity-60"
        >
          {busy ? '提交中…' : `提交开票（¥${fmtMoney(order.total)}）`}
        </button>
        <p className="mt-3 text-[10.5px] leading-relaxed text-black/35">电子发票将在提交后即时开具并发送至邮箱，可在「开票记录」中查看。</p>
      </div>
    </MtWalletSheet>
  );
}

/** 支付密码设置页：开启（两遍输入）/ 修改（旧密码验证→新密码）/ 关闭（验证后关闭） */
function WalletPayPwdPage({ session, onClose, onToast }: { session: MtSession; onClose: () => void; onToast: (m: string) => void }) {
  const uid = mtUidOf(session);
  const [data, setData] = useState(() => mtLoadPayPwd(uid));
  const [flow, setFlow] = useState<null | { kind: 'open' | 'change'; step: 'set' | 'confirm'; first?: string }>(null);
  const [gateFor, setGateFor] = useState<'change' | 'off' | null>(null);
  const [errKey, setErrKey] = useState(0);

  const refresh = () => setData(mtLoadPayPwd(uid));

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F7F8FA]">
      {/* 顶栏 */}
      <div className="relative flex h-[94px] shrink-0 items-center border-b border-black/[0.04] bg-white px-3 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.2} />
        </button>
        <p className="absolute left-1/2 top-[74px] -translate-x-1/2 -translate-y-1/2 text-[16px] font-semibold text-black/85">支付密码设置</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 no-scrollbar">
        {/* 状态卡 */}
        <div className="flex items-center gap-3 rounded-[14px] bg-white p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#FFF6D9]">
            <Lock className={`h-5 w-5 ${data.enabled ? 'text-[#C8860D]' : 'text-black/30'}`} strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-black/85">{data.enabled ? '已开启' : '未开启'}</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-black/45">开启后，余额提现、充值等资金操作需验证 6 位支付密码（仅保存在本机）</p>
          </div>
        </div>
        {!data.enabled ? (
          <button
            type="button"
            onClick={() => {
              setErrKey(0);
              setFlow({ kind: 'open', step: 'set' });
            }}
            className="mt-5 w-full rounded-full bg-gradient-to-r from-[#FFD100] to-[#FFC300] py-3 text-[15px] font-bold text-black/85 active:opacity-85"
          >
            开启支付密码
          </button>
        ) : (
          <div className="mt-4 divide-y divide-black/[0.04] rounded-[14px] bg-white px-4">
            <button
              type="button"
              onClick={() => {
                setGateFor('change');
              }}
              className="flex w-full items-center justify-between py-4 active:opacity-70"
            >
              <span className="text-[14px] text-black/85">修改支付密码</span>
              <ChevronRight className="h-4 w-4 text-black/25" />
            </button>
            <button
              type="button"
              onClick={() => {
                setGateFor('off');
              }}
              className="flex w-full items-center justify-between py-4 active:opacity-70"
            >
              <span className="text-[14px] text-[#FF3B30]">关闭支付密码</span>
              <ChevronRight className="h-4 w-4 text-black/25" />
            </button>
          </div>
        )}
        <p className="px-1 pt-3 text-[11px] leading-relaxed text-black/35">支付密码用于余额提现、充值等资金操作的身份验证；请勿设置连续、重复等过于简单的数字。</p>
        <div className="h-[28px]" />
      </div>

      {/* 旧密码验证浮层（修改 / 关闭前） */}
      {gateFor && (
        <MtPayPwdGate
          uid={uid}
          label={gateFor === 'change' ? '验证旧支付密码后设置新密码' : '验证后关闭支付密码'}
          onOk={() => {
            if (gateFor === 'off') {
              mtSavePayPwd(uid, { enabled: false, pwd: null });
              mtClearPayPwdLock(uid);
              refresh();
              setGateFor(null);
              onToast('支付密码已关闭');
            } else {
              mtClearPayPwdLock(uid);
              setGateFor(null);
              setErrKey(0);
              setFlow({ kind: 'change', step: 'set' });
            }
          }}
          onClose={() => setGateFor(null)}
        />
      )}

      {/* 新密码输入浮层（开启 / 修改的第二步） */}
      {flow && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/60" role="dialog" aria-label="设置支付密码" onClick={() => setFlow(null)}>
          <MtPayPwdSheet
            key={`${flow.kind}-${flow.step}-${errKey}`}
            title={flow.step === 'set' ? '请输入新密码' : '请再次输入新密码'}
            sub={flow.step === 'confirm' ? '两次输入需一致' : undefined}
            hint={errKey > 0 ? '两次输入不一致，请重新输入' : undefined}
            errorKey={errKey}
            onClose={() => setFlow(null)}
            onComplete={(pwd) => {
              if (flow.step === 'set') {
                setErrKey(0);
                setFlow({ kind: flow.kind, step: 'confirm', first: pwd });
                return;
              }
              if (pwd !== flow.first) {
                setErrKey((k) => k + 1);
                setFlow({ kind: flow.kind, step: 'set' });
                onToast('两次输入不一致，请重新输入');
                return;
              }
              mtSavePayPwd(uid, { enabled: true, pwd });
              mtClearPayPwdLock(uid);
              refresh();
              setFlow(null);
              onToast(flow.kind === 'open' ? '支付密码已开启' : '支付密码已修改');
            }}
          />
        </div>
      )}
    </div>
  );
}

// ================================ 我的页（截图4） ================================

function MyPage({
  session,
  onOpenOrders,
  onOpenSettings,
  onOpenFavorites,
  onOpenHistory,
  onOpenCoupons,
  onOpenMember,
  onOpenWallet,
  onOpenLoan,
  onOpenCardQuota,
  onOpenDrugFund,
  onOpenAddresses,
  onOpenInvoices,
  onOpenMerchantCenter,
  onClaimCoupons,
  onToast,
}: {
  session: MtSession;
  onOpenOrders: (tab?: string) => void;
  onOpenSettings: () => void;
  onOpenFavorites: () => void;
  onOpenHistory: () => void;
  onOpenCoupons: () => void;
  onOpenMember: () => void;
  onOpenWallet: () => void;
  /** 钱包区三项真实入口：借钱 / 我的卡额度 / 购药抵扣金 */
  onOpenLoan: () => void;
  onOpenCardQuota: () => void;
  onOpenDrugFund: () => void;
  /** 服务宫格：地址 / 开发票 */
  onOpenAddresses: () => void;
  onOpenInvoices: () => void;
  /** 商家入驻：入驻美团 / 添加商户都进「全部我入驻的店铺」商家中心（含添加店铺） */
  onOpenMerchantCenter: () => void;
  onClaimCoupons: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  useOrdersTick();
  const orders = mtLoadOrders(uid);
  const inFlight = orders.filter((o) => ['pendingAccept', 'accepted', 'delivering'].includes(o.status)).length;
  const idpLabel = session.idp === 'wx' ? '微信账号' : session.idp === 'qq' ? 'QQ账号' : `手机用户 ${session.phone ?? ''}`;
  // 钱包区三项动态值：借钱可借额度 / 联名卡额度 / 抵扣金笔数
  const loanAcct = mtLoadLoanAccount(uid);
  const loanAvail = mtLoanAvailable(uid);
  const cardQuota = mtLoadCardQuota(uid);
  const drugFund = mtLoadDrugFund(uid);
  // 骑手形象选择（原美团币入口改为骑手，选中形象用于配送地图）
  const [riderOpen, setRiderOpen] = useState(false);
  const [riderId, setRiderId] = useState<string>(() => mtGetRiderId());
  const openRiderSheet = () => setRiderOpen(true);
  // 商品图片样式选择弹层（第六十六轮：从主题 App 迁出，工作兼职位改为选择器入口）
  const [goodsStyleOpen, setGoodsStyleOpen] = useState(false);
  const goodsImgStyle = useSettings((s) => s.goodsImgStyle);
  // 送达速度毛玻璃弹窗（第四十一轮：原「我的碳账户」位改为送达速度，全局共享设置）
  const [speedOpen, setSpeedOpen] = useState(false);
  const [, speedTick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const onSpeed = () => speedTick();
    window.addEventListener('delivery-speed-changed', onSpeed);
    return () => window.removeEventListener('delivery-speed-changed', onSpeed);
  }, []);

  const cell = (Icon: LucideIcon, label: string, badge: number | null, onTap: () => void, tint = 'text-black/75') => (
    <button key={label} type="button" onClick={onTap} className="flex flex-col items-center gap-1.5 active:opacity-70">
      <span className="relative">
        <Icon className={`h-[22px] w-[22px] ${tint}`} strokeWidth={1.8} />
        {badge !== null && badge > 0 && (
          <span className="absolute -right-2 -top-1 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[#FF3B30] px-1 text-[9px] font-bold text-white">{badge}</span>
        )}
      </span>
      <span className="text-[11px] text-black/70">{label}</span>
    </button>
  );

  return (
    <>
      <div className="h-full overflow-y-auto bg-white pb-4">
      {/* 淡黄头部 + 会员卡（对齐截图：浅黄渐变背景、右上会员中心切角白卡、三权益白卡、神券行） */}
      <div className="bg-gradient-to-b from-[#FFF8CF] via-[#FFF2A6] to-white px-4 pb-4 pt-[58px]">
        <div className="flex items-center gap-3">
          {session.avatar ? (
            <img src={session.avatar} alt="" className="h-[54px] w-[54px] rounded-full object-cover ring-2 ring-white/70" />
          ) : (
            <span className="grid h-[54px] w-[54px] place-items-center overflow-hidden rounded-full bg-white shadow">
              <img src="/icons/meituan-app.png" alt="" className="h-full w-full object-cover" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[22px] font-bold text-black/90">{session.name}</p>
            <p className="mt-0.5 truncate text-[12px] text-black/45">{idpLabel}</p>
          </div>
          <button type="button" onClick={() => onToast('美团客服：0539-000-0000（演示）')} className="flex flex-col items-center gap-0.5 active:opacity-60">
            <Headset className="h-[22px] w-[22px] text-black/80" strokeWidth={1.8} />
            <span className="text-[10px] text-black/60">客服</span>
          </button>
          <button type="button" onClick={onOpenSettings} className="relative ml-2 flex flex-col items-center gap-0.5 active:opacity-60">
            <span className="relative">
              <SettingsIcon />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#FF3B30]" />
            </span>
            <span className="text-[10px] text-black/60">设置</span>
          </button>
        </div>

        {/* 会员卡（淡黄渐变 + 右上切角白卡 + 三权益白卡 + 神券行，对齐截图） */}
        <div className="relative mt-3 overflow-hidden rounded-2xl bg-gradient-to-br from-[#FFEF9E] to-[#FFE14D] p-3.5 pb-3">
          <button type="button" onClick={onOpenCoupons} className="absolute right-0 top-0 rounded-bl-2xl bg-white/85 pb-1.5 pl-4 pr-3 pt-2 text-right active:opacity-70">
            <span className="block text-[12px] font-bold leading-tight text-[#5A4200]">会员中心</span>
            <span className="block text-[9px] leading-tight text-[#5A4200]/65">查看8项权益</span>
          </button>
          <button type="button" onClick={onOpenMember} className="mt-0.5 flex items-center gap-1.5 text-left active:opacity-70">
            <Orbit className="h-[19px] w-[19px] text-[#5A4200]" strokeWidth={2} />
            <span className="text-[17px] font-bold text-[#5A4200]">普通会员</span>
            <span className="ml-0.5 flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className={`h-3 w-3 ${i === 0 ? 'fill-[#8A4B00] text-[#8A4B00]' : 'text-[#5A4200]/35'}`} strokeWidth={1.6} />
              ))}
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-[#5A4200]/60" />
          </button>
          <button type="button" onClick={onOpenMember} className="mt-0.5 block text-left text-[12px] text-[#5A4200]/75 active:opacity-70">
            成长值 34 / 500
          </button>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {([
              [Bike, '惊喜多选1'],
              [Coins, '酒店积分抵现'],
              [Wallet, '会员神券包'],
            ] as [LucideIcon, string][]).map(([Icon, l], i) => (
              <button key={l} type="button" onClick={() => (l === '会员神券包' ? onOpenCoupons() : onToast(`${l}（演示）`))} className="relative rounded-xl bg-white/90 py-2.5 text-center active:opacity-70">
                {i === 0 && <span className="absolute -right-1 -top-1.5 rounded-full rounded-bl-none bg-[#FF3B30] px-1 py-px text-[8px] font-bold text-white">待领取</span>}
                <span className="mx-auto grid h-[24px] w-[24px] place-items-center">
                  <Icon className="h-[24px] w-[24px] text-[#FFA200]" strokeWidth={1.9} />
                </span>
                <span className="mt-1 block text-[11px] text-black/80">{l}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center rounded-xl bg-white/45 px-1 py-2">
            {[
              ['¥12', '外卖大额神券'],
              ['¥11', '堂食膨胀神券'],
              ['¥7', '堂食神券'],
            ].map(([p, l], i) => (
              <button key={l} type="button" onClick={onOpenCoupons} className={`flex flex-1 flex-col items-center ${i > 0 ? 'border-l border-[#5A4200]/10' : ''}`}>
                <span className="text-[16px] font-bold leading-tight text-[#5A4200]">{p}</span>
                <span className="mt-0.5 text-[9px] text-[#5A4200]/65">{l}</span>
              </button>
            ))}
            <div className="ml-0.5 flex flex-col items-center gap-1 border-l border-[#5A4200]/10 pl-2 pr-0.5">
              <button type="button" onClick={onClaimCoupons} className="text-[10px] font-medium text-[#5A4200] active:opacity-70">
                每日领券
              </button>
              <button type="button" onClick={onOpenCoupons} className="rounded-full bg-[#FFD100] px-3 py-1 text-[10px] font-semibold text-black/85 active:opacity-80">
                去使用
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 功能宫格（白底直排，无圆角面板；收藏/浏览记录为真实页面，红包卡券真实页，骑手可选形象） */}
      <div className="grid grid-cols-4 gap-y-4 px-2 pb-4 pt-1">
        {([
          [Star, '收藏', null, () => onOpenFavorites()],
          [Eye, '浏览记录', null, () => onOpenHistory()],
          [Ticket, '红包卡券', null, () => onOpenCoupons()],
        ] as [LucideIcon, string, string | null, () => void][]).map(([Icon, l, badge, tap]) => (
          <button key={l} type="button" onClick={tap} className="flex flex-col items-center gap-1.5 active:opacity-70">
            <span className="relative">
              <Icon className="h-[22px] w-[22px] text-black/75" strokeWidth={1.8} />
              {badge && <span className="absolute -right-2 -top-1 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[#FF3B30] px-1 text-[9px] font-bold text-white">{badge}</span>}
            </span>
            <span className="text-[11px] text-black/70">{l}</span>
          </button>
        ))}
        {/* 骑手（原美团币）：显示当前骑手形象，点按进入选择弹层 */}
        <button type="button" data-testid="my-rider" onClick={openRiderSheet} className="flex flex-col items-center gap-1.5 active:opacity-70">
          <span className="relative">
            <img src={mtRiderSrcOf(riderId)} alt="骑手形象" draggable={false} className="h-[24px] w-[24px] object-contain" />
            <span className="absolute -right-2 -top-1 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[#FF3B30] px-1 text-[9px] font-bold text-white">{MT_RIDERS.length}</span>
          </span>
          <span className="text-[11px] text-black/70">骑手</span>
        </button>
      </div>

      {/* 订单 */}
      <div className="border-t-[7px] border-[#F7F8FA] px-4 py-3.5">
        <p className="text-[16px] font-bold text-black/85">订单</p>
        <div className="mt-3 grid grid-cols-4">
          {cell(Receipt, '全部订单', null, () => onOpenOrders('全部'))}
          {cell(ClockIcon, '待收货/使用', inFlight, () => onOpenOrders('待收货/待使用'))}
          {cell(MessageCircleMore, '待评价', null, () => onOpenOrders('评价'))}
          {cell(Wallet, '退款售后', null, () => onOpenOrders('退款/售后'))}
        </div>
      </div>

      {/* 钱包（三项真实入口：借钱→借钱页；我的卡额度→联名卡额度页；购药抵扣金→抵扣金页） */}
      <div className="border-t-[7px] border-[#F7F8FA] px-4 py-3.5">
        <div className="flex items-center">
          <p className="text-[16px] font-bold text-black/85">钱包</p>
          <button type="button" onClick={onOpenWallet} className="ml-auto flex items-center text-[12px] text-black/40">
            查看全部
          </button>
        </div>
        <div className="mt-2.5 grid grid-cols-4">
          <button type="button" data-testid="my-wallet-loan" onClick={onOpenLoan} className="flex flex-col items-center gap-0.5 active:opacity-70">
            <span className="text-[16px] font-bold leading-tight text-black/85">{loanAcct.applied ? mtAmtWan(loanAvail) : '***'}</span>
            <span className="text-[11px] text-black/70">美团借钱</span>
            <span className="text-[9px] text-black/35">{loanAcct.applied ? '可借额度' : '随借随还'}</span>
          </button>
          <button type="button" data-testid="my-wallet-cardquota" onClick={onOpenCardQuota} className="flex flex-col items-center gap-0.5 active:opacity-70">
            <span className="text-[16px] font-bold leading-tight text-black/85">{cardQuota.applied ? mtAmtWan(cardQuota.total) : '9.98万'}</span>
            <span className="text-[11px] text-black/70">我的卡额度</span>
            <span className="text-[9px] text-black/35">{cardQuota.applied ? '可用额度' : '免费申领'}</span>
          </button>
          <button type="button" data-testid="my-wallet-drugfund" onClick={onOpenDrugFund} className="flex flex-col items-center gap-0.5 active:opacity-70">
            <span className="text-[16px] font-bold leading-tight text-black/85">{drugFund.activated ? `${drugFund.records.length}笔` : '¥3.00'}</span>
            <span className="text-[11px] text-black/70">购药抵扣金</span>
            <span className="text-[9px] text-black/35">{drugFund.activated ? '去查看' : '去激活'}</span>
          </button>
        </div>
      </div>

      {/* 服务宫格（地址/开发票为真实页面；其余演示项；
          工作兼职位 = 商品图片样式选择器入口（第六十六轮从主题 App 迁出）：
          当前样式缩略图 + 名字，点击弹三选一弹层） */}
      <div className="grid grid-cols-4 gap-y-4 border-t-[7px] border-[#F7F8FA] px-2 py-3.5">
        {([
          [MapPin, '地址', () => onOpenAddresses(), 'my-svc-address'],
          [Receipt, '开发票', () => onOpenInvoices(), 'my-svc-invoice'],
          [Handshake, '入驻美团', () => onOpenMerchantCenter(), 'my-svc-merchant-center'],
          [Store, '添加商户', () => onOpenMerchantCenter(), 'my-svc-merchant-join'],
        ] as [LucideIcon, string, () => void, string][]).map(([Icon, l, tap, tid]) => (
          <button key={l} type="button" data-testid={tid || undefined} onClick={tap} className="flex flex-col items-center gap-1.5 active:opacity-70">
            <span className="flex h-[46px] items-center justify-center">
              <Icon className="h-[22px] w-[22px] text-black/75" strokeWidth={1.8} />
            </span>
            <span className="text-[11px] text-black/70">{l}</span>
          </button>
        ))}
        {/* 商品图片样式（原工作兼职位）：点击弹三选一弹层（与淘宝红包位共用同一全局样式） */}
        <button type="button" data-testid="mt-goods-style-entry" onClick={() => setGoodsStyleOpen(true)} className="flex flex-col items-center gap-1.5 active:opacity-70">
          <GoodsStyleThumb style={goodsImgStyle} className="h-[46px] w-[46px] shrink-0 rounded-[12px]" />
          <span className="text-[11px] text-black/70">商品图片样式</span>
        </button>
        {([
          [Timer, '送达速度', () => setSpeedOpen(true), 'my-speed', dsDescShort('meituan')],
          [LayoutGrid, '更多工具', () => onToast('更多工具（演示）'), '', ''],
        ] as [LucideIcon, string, () => void, string, string][]).map(([Icon, l, tap, tid, sub]) => (
          <button key={l} type="button" data-testid={tid || undefined} onClick={tap} className="flex flex-col items-center gap-1.5 active:opacity-70">
            <span className="flex h-[46px] items-center justify-center">
              <Icon className="h-[22px] w-[22px] text-black/75" strokeWidth={1.8} />
            </span>
            <span className="text-[11px] text-black/70">{l}</span>
            {sub ? <span data-testid={tid ? `${tid}-desc` : undefined} className="-mt-1 text-[9px] leading-none text-black/35">{sub}</span> : null}
          </button>
        ))}
      </div>

      {/* 账号管理已移至「设置」（收货地址/切换账号/退出登录） */}
      <p className="py-4 text-center text-[10px] text-black/25">美团 v10.18.0 · 数据仅保存在本机 · 按账号隔离 · {idpLabel}</p>
      </div>

      {/* 商品图片样式选择（第六十六轮：从主题 App 迁出的入口弹层；与淘宝共用同一全局样式） */}
      {goodsStyleOpen ? <GoodsStyleSheet accent="#FF9500" onClose={() => setGoodsStyleOpen(false)} /> : null}

      {/* 送达速度毛玻璃弹窗（第四十二轮：美团独立分钟级三档，与淘宝小时级互不影响） */}
      {speedOpen ? <DeliverySpeedSheet scope="meituan" accent="#FFC300" onClose={() => setSpeedOpen(false)} onToast={onToast} /> : null}

      {/* 骑手形象选择（底部弹层；选中形象用于配送地图巡航） */}
      <AnimatePresence>
        {riderOpen && (
          <motion.div key="rider" className="absolute inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button type="button" aria-label="关闭骑手形象选择" className="absolute inset-0 bg-black/45" onClick={() => setRiderOpen(false)} />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white/80 backdrop-blur-2xl backdrop-saturate-150 pb-8"
              data-testid="rider-sheet"
            >
              <div className="relative flex shrink-0 items-center justify-center py-4">
                <p className="text-[16px] font-bold text-black/85">选择骑手形象</p>
                <button type="button" aria-label="关闭" data-testid="rider-sheet-close" onClick={() => setRiderOpen(false)} className="absolute right-3 grid h-8 w-8 place-items-center rounded-full active:bg-black/5">
                  <X className="h-5 w-5 text-black/55" />
                </button>
              </div>
              <p className="px-5 pb-3 text-[12px] text-black/40">内置 {MT_RIDERS.length} 位骑手 · 骑手会带着你的订单跑腿送餐</p>
              <div className="grid max-h-[52vh] grid-cols-3 gap-3 overflow-y-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {MT_RIDERS.map((r) => {
                  const active = r.id === riderId;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      data-testid={`rider-${r.id}`}
                      onClick={() => {
                        setRiderId(r.id);
                        mtSetRiderId(r.id);
                        setRiderOpen(false);
                        onToast(`骑手「${r.name}」已接单出发`);
                      }}
                      className={`relative flex flex-col items-center rounded-2xl px-2 pb-2.5 pt-3 transition-all active:scale-[0.97] ${active ? 'bg-[#FFF3C4] ring-2 ring-[#FFD100]' : 'bg-[#F7F8FA] ring-1 ring-black/[0.04]'}`}
                    >
                      {active && (
                        <span className="absolute right-1.5 top-1.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-[#FFD100]">
                          <Check className="h-3 w-3 text-black/80" strokeWidth={3} />
                        </span>
                      )}
                      <img
                        src={r.src}
                        alt={r.name}
                        draggable={false}
                        className="h-20 w-20 object-contain"
                      />
                      <span className={`mt-1 text-[12px] ${active ? 'font-semibold text-black/85' : 'text-black/60'}`}>{r.name}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ================================ 设置页（截图3：收货地址/切换账号/退出登录迁入） ================================

function SettingsRow({ label, value, onClick, danger }: { label: string; value?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center px-4 py-[17px] text-left active:bg-black/[0.03]">
      <span className={`flex-1 text-[15px] ${danger ? 'font-medium text-[#FF4B33]' : 'text-black/85'}`}>{label}</span>
      {value && <span className="pr-1.5 text-[13px] text-black/35">{value}</span>}
    </button>
  );
}

function SettingsPage({
  session,
  onBack,
  onOpenAddresses,
  onOpenAbout,
  onLogout,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  onOpenAddresses: () => void;
  onOpenAbout: () => void;
  onLogout: () => void;
  onToast: (m: string) => void;
}) {
  const idpLabel = session.idp === 'wx' ? '微信账号' : session.idp === 'qq' ? 'QQ账号' : `手机用户 ${session.phone ?? ''}`;
  return (
    <div className="flex h-full flex-col bg-white">
      {/* 顶栏：返回 + 居中标题 */}
      <div className="relative grid h-[110px] shrink-0 place-items-center border-b border-black/[0.04] pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="absolute left-1 top-[54px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
        </button>
        <p className="text-[19px] font-semibold text-black/90">设置</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="divide-y divide-black/[0.04] px-4">
          <SettingsRow label="个人信息" value={session.name} onClick={() => onToast('个人信息（演示）')} />
          <SettingsRow label="收货地址" onClick={onOpenAddresses} />
        </div>

        <div className="mt-2 divide-y divide-black/[0.04] border-t-[7px] border-[#F5F6F7] px-4 pt-1">
          <SettingsRow label="账号安全" onClick={() => onToast('账号安全（演示）')} />
          <SettingsRow label="隐私设置" onClick={() => onToast('隐私设置（演示）')} />
        </div>

        <div className="mt-2 divide-y divide-black/[0.04] border-t-[7px] border-[#F5F6F7] px-4 pt-1">
          <SettingsRow label="支付设置" onClick={() => onToast('支付设置（演示）')} />
          <SettingsRow label="消息通知" onClick={() => onToast('消息通知（演示）')} />
          <SettingsRow label="通用设置" onClick={() => onToast('通用设置（演示）')} />
          <SettingsRow label="清理缓存" onClick={() => onToast('已清理完成，存储空间更清爽')} />
        </div>

        <div className="mt-2 divide-y divide-black/[0.04] border-t-[7px] border-[#F5F6F7] px-4 pt-1">
          <SettingsRow label="长辈版" value="未开启" onClick={() => onToast('长辈版（演示）')} />
          <SettingsRow label="未成年人模式" value="未开启" onClick={() => onToast('未成年人模式（演示）')} />
          <SettingsRow label="语言切换/Language" value="简体中文" onClick={() => onToast('语言切换（演示）')} />
        </div>

        <div className="mt-2 divide-y divide-black/[0.04] border-t-[7px] border-[#F5F6F7] px-4 pt-1">
          <SettingsRow label="关于美团" value="当前已是最新版本" onClick={onOpenAbout} />
          <SettingsRow label="意见反馈" onClick={() => onToast('意见反馈（演示）')} />
        </div>

        {/* 账号管理（需求：切换账号/退出登录移至设置；白底直排无面板） */}
        <div className="mt-2 divide-y divide-black/[0.04] border-t-[7px] border-[#F5F6F7] px-4 pt-1">
          <SettingsRow label="切换账号" onClick={onLogout} />
          <SettingsRow label="退出登录" danger onClick={onLogout} />
        </div>

        <p className="py-5 text-center text-[10px] text-black/25">美团 v10.18.0 · 数据仅保存在本机 · 按账号隔离 · {idpLabel}</p>
      </div>
    </div>
  );
}

// ================================ 收藏页（截图1：页签 商户/团购/商品菜品/内容/其他 + 白色圆角内容板 + 黄放大镜空态） ================================

type FavTab = 'store' | 'deal' | 'dish' | 'content' | 'other';

const FAV_TABS: { key: FavTab; label: string }[] = [
  { key: 'store', label: '商户' },
  { key: 'deal', label: '团购' },
  { key: 'dish', label: '商品/菜品' },
  { key: 'content', label: '内容' },
  { key: 'other', label: '其他' },
];

/** 空态插画（黄色放大镜趴在灰色小丘上 + Z z，纯 CSS/SVG 无 emoji，对齐截图1） */
function FavEmptyIllust() {
  return (
    <div className="relative mx-auto h-[150px] w-[190px]" aria-hidden="true">
      {/* 小丘 */}
      <span className="absolute bottom-1 left-1/2 h-[70px] w-[170px] -translate-x-1/2 rounded-[50%] bg-gradient-to-b from-[#ECEDEF] to-[#F8F9FA]" />
      {/* 放大镜镜片 */}
      <span className="absolute left-[58px] top-[26px] h-[58px] w-[58px] rotate-[14deg] rounded-full border-[9px] border-[#FFC300] bg-gradient-to-br from-white to-[#FFF7DC] shadow-[0_2px_6px_rgba(180,120,0,0.18)]" />
      {/* 镜片高光 */}
      <span className="absolute left-[74px] top-[38px] h-3.5 w-3.5 rotate-[14deg] rounded-full bg-white/90" />
      {/* 镜柄 */}
      <span className="absolute left-[122px] top-[86px] h-[34px] w-[10px] rotate-[48deg] rounded-full bg-gradient-to-b from-[#FFC300] to-[#F0A800]" />
      {/* Z z（睡觉感） */}
      <span className="absolute right-[38px] top-[6px] text-[18px] font-bold text-black/20">z</span>
      <span className="absolute right-[16px] top-[30px] text-[12px] font-bold text-black/15">z</span>
    </div>
  );
}

function FavoritesPage({
  session,
  onBack,
  onOpenMerchant,
  onOpenDeal,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  onOpenMerchant: (id: string) => void;
  onOpenDeal: (id: string) => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const [, setVer] = useState(0);
  const [tab, setTab] = useState<FavTab>('store');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const favs = mtLoadFavs(uid);

  // 收藏的团购
  const favDeals = favs.deals.map((id) => mtDealOf(id)).filter((d): d is MtDeal => Boolean(d));
  // 收藏的菜品 → 按归属商家分组（商家卡内菜品行）
  const dishOwners = new Map<string, { m: MtMerchant; d: MtDish }>();
  for (const m of MT_MERCHANTS) {
    for (const d of mtDishesOf(m)) dishOwners.set(d.id, { m, d });
  }
  const dishGroups = new Map<string, { m: MtMerchant; dishes: MtDish[] }>();
  for (const id of favs.dishes) {
    const own = dishOwners.get(id);
    if (!own) continue;
    const g = dishGroups.get(own.m.id);
    if (g) g.dishes.push(own.d);
    else dishGroups.set(own.m.id, { m: own.m, dishes: [own.d] });
  }
  // 纯商家收藏
  const storeOnly = favs.stores.map((id) => mtMerchantOf(id)).filter((m): m is MtMerchant => Boolean(m));

  const qtyOf = (id: string) => qtyMap[id] ?? 1;
  const setQty = (id: string, q: number) => setQtyMap((m) => ({ ...m, [id]: Math.min(9, Math.max(1, q)) }));
  const toggleSel = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSel(next);
  };
  const unfav = (ids: string[]) => {
    for (const id of ids) mtToggleFav(uid, 'dishes', id);
    setSel(new Set());
    setVer((v) => v + 1);
  };
  const addSelectedToCart = () => {
    const selArr = [...sel];
    const first = dishOwners.get(selArr[0]);
    if (!first) return;
    const mid = first.m.id;
    const inMerchant = selArr.filter((id) => dishOwners.get(id)?.m.id === mid);
    const cart = mtLoadCart(uid);
    // 跨店拦截（对齐真机）：购物车已有其他商家商品 → 提示先结算或清空，不静默换商家
    if (cart.items.length > 0 && cart.merchantId !== mid) {
      onToast('不同商家商品不能合并结算，请先结算或清空购物车');
      return;
    }
    const merged = new Map(cart.items.map((i) => [i.dishId, i.qty]));
    for (const id of inMerchant) merged.set(id, (merged.get(id) ?? 0) + qtyOf(id));
    mtSaveCart(uid, { merchantId: mid, items: [...merged.entries()].map(([dishId, qty]) => ({ dishId, qty })) });
    setSel(new Set());
    window.dispatchEvent(new CustomEvent('mt-cart-changed'));
    onToast('已加入购物车');
  };

  const tabEmpty: Record<FavTab, boolean> = {
    store: storeOnly.length === 0,
    deal: favDeals.length === 0,
    dish: dishGroups.size === 0,
    content: true,
    other: true,
  };
  const CircleCheckBtn = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button type="button" aria-label={on ? '取消选择' : '选择'} onClick={onClick} className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${on ? 'bg-[#FFC300]' : 'border border-black/20 bg-white'}`}>
      {on && <Check className="h-3 w-3 text-black/80" strokeWidth={3} />}
    </button>
  );

  return (
    <div className="relative flex h-full flex-col bg-white">
      {/* 顶栏：返回 + 标题 + 搜索/购物车（对齐截图1） */}
      <div className="relative grid h-[100px] shrink-0 place-items-center border-b border-black/[0.04] pt-[50px]">
        <button type="button" aria-label="返回" onClick={onBack} className="absolute left-1 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
        </button>
        <p className="text-[19px] font-semibold text-black/90">收藏</p>
        <span className="absolute right-3 top-[50px] flex items-center gap-1">
          <button type="button" aria-label="搜索收藏" onClick={() => onToast('收藏搜索（演示）')} className="grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
            <SearchIcon className="h-[19px] w-[19px] text-black/75" strokeWidth={2.1} />
          </button>
          <button type="button" aria-label="购物车" onClick={() => onToast('请到底部「购物车」查看')} className="grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
            <ShoppingCart className="h-[19px] w-[19px] text-black/75" strokeWidth={2.1} />
          </button>
        </span>
      </div>

      {/* 页签（激活项黑色加粗 + 黄色下划线） */}
      <div className="flex shrink-0 items-end gap-6 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FAV_TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`relative shrink-0 pb-1.5 transition-colors ${tab === t.key ? 'text-[19px] font-bold text-black/90' : 'text-[16px] text-black/45'}`}>
            {t.label}
            {tab === t.key && <span className="absolute inset-x-1 bottom-0 mx-auto h-[3px] w-6 rounded-full bg-[#FFC300]" />}
          </button>
        ))}
      </div>

      {/* 内容区（白底直排，无圆角面板） */}
      <div className="min-h-0 flex-1 overflow-hidden bg-white">
        <div className="h-full overflow-y-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* ===== 空态（黄放大镜插画 + 暂未收藏"X"） ===== */}
          {tabEmpty[tab] ? (
            <div className="pt-16 text-center">
              <FavEmptyIllust />
              <p className="mt-5 text-[19px] font-bold text-black/85">暂未收藏“{FAV_TABS.find((t) => t.key === tab)?.label}”</p>
              <p className="mt-2 text-[14px] text-black/35">去看看别的收藏类型吧</p>
              {tab === 'store' && (
                <button type="button" onClick={onBack} className="mt-5 rounded-full bg-[#FFD100] px-7 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
                  去逛逛
                </button>
              )}
            </div>
          ) : tab === 'store' ? (
            /* ===== 商户收藏（商户卡：门头图 + 名称 + 评分/月售 + 距离/配送 + 分类） ===== */
            <div className="pt-2">
              {storeOnly.map((m) => (
                <div key={m.id} className="flex items-start gap-3 border-b border-black/[0.04] p-3 last:border-b-0">
                  <button type="button" onClick={() => onOpenMerchant(m.id)} className="shrink-0 active:opacity-80">
                    <ShopAvatar m={m} className="h-[76px] w-[76px] rounded-xl" />
                  </button>
                  <button type="button" onClick={() => onOpenMerchant(m.id)} className="min-w-0 flex-1 text-left active:opacity-80">
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[17px] font-bold text-black/90">{m.name}</span>
                      <span className={`shrink-0 rounded-[4px] px-1 py-px text-[10px] font-medium ${m.cats.includes('waimai') ? 'bg-[#FFD100] text-black/80' : 'bg-[#FF6000] text-white'}`}>
                        {m.cats.includes('waimai') ? '外卖' : '到店'}
                      </span>
                    </span>
                    <span className="mt-1.5 flex items-center text-[13px]">
                      <Star className="mr-0.5 inline h-3.5 w-3.5 fill-[#FF6000] text-[#FF6000]" strokeWidth={0} />
                      <span className="font-semibold text-[#FF6000]">{m.rating}</span>
                      <span className="ml-2 text-black/45">月售{m.monthSale >= 10000 ? `${(m.monthSale / 10000).toFixed(1)}万` : m.monthSale}</span>
                      <span className="ml-auto text-black/45">
                        {mtDeliveryMinutesOf(m.id)}分钟 {m.distanceKm}km
                      </span>
                    </span>
                    <span className="mt-1.5 block truncate text-[13px] text-black/40">{m.cats.map((c) => MT_CATS.find((x) => x.id === c)?.name ?? c).slice(0, 2).join('  ')}</span>
                  </button>
                  <button type="button" aria-label="取消收藏商家" onClick={() => { mtToggleFav(uid, 'stores', m.id); setVer((v) => v + 1); onToast('已取消收藏商家'); }} className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full active:bg-black/5">
                    <Star className="h-[18px] w-[18px] fill-[#FFB800] text-[#FFB800]" strokeWidth={0} />
                  </button>
                </div>
              ))}
            </div>
          ) : tab === 'deal' ? (
            /* ===== 团购收藏（白底直排行） ===== */
            <div>
              {favDeals.map((d) => (
                <div key={d.id} className="flex items-center gap-3 border-b border-black/[0.04] p-3.5 last:border-b-0">
                  <button type="button" onClick={() => onOpenDeal(d.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-80">
                    <FoodImg src={d.img} emoji={d.emoji} className="h-16 w-16 shrink-0 rounded-xl" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-[14px] font-semibold text-black/85">{d.title}</span>
                      <span className="mt-1 block truncate text-[11px] text-black/40">{d.tips} · {d.praise}</span>
                      <span className="mt-0.5 block text-[15px] font-bold" style={{ color: MT_PRICE }}>
                        ¥{fmtMoney(d.price)} <span className="text-[11px] font-normal text-black/30 line-through">¥{fmtMoney(d.origPrice)}</span>
                      </span>
                    </span>
                  </button>
                  <button type="button" aria-label="取消收藏" onClick={() => { mtToggleFav(uid, 'deals', d.id); setVer((v) => v + 1); onToast('已取消收藏'); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-full active:bg-black/5">
                    <Star className="h-[18px] w-[18px] fill-[#FFB800] text-[#FFB800]" strokeWidth={0} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            /* ===== 商品/菜品收藏（商家卡内勾选/步进，可加购；白底直排） ===== */
            <div>
              {[...dishGroups.values()].map(({ m, dishes }) => (
                <div key={m.id} className="border-b border-black/[0.04] px-3.5 py-3 last:border-b-0">
                  <button type="button" onClick={() => onOpenMerchant(m.id)} className="flex w-full items-center gap-2 text-left active:opacity-70">
                    <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg">
                      <ShopAvatar m={m} className="h-full w-full" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[16px] font-bold text-black/90">{m.name}</span>
                    <span className="shrink-0 text-[11px] text-black/35">
                      <Star className="mr-0.5 inline h-3 w-3 fill-[#FF6000] text-[#FF6000]" strokeWidth={0} />
                      {m.rating} · {m.distanceKm}km
                    </span>
                  </button>
                  <div className="mt-1 space-y-3.5 border-t border-black/[0.05] pt-3">
                    {dishes.map((d) => (
                      <div key={d.id} className="flex items-center gap-3">
                        <CircleCheckBtn on={sel.has(d.id)} onClick={() => toggleSel(d.id)} />
                        <FoodImg src={d.img} emoji={d.emoji} className="h-[60px] w-[60px] shrink-0 rounded-lg" />
                        <div className="flex min-w-0 flex-1 flex-col self-stretch">
                          <p className="line-clamp-1 text-[15px] font-medium text-black/85">{d.name}</p>
                          <p className="mt-auto text-[19px] font-bold" style={{ color: MT_PRICE }}>
                            <span className="text-[12px]">¥</span>
                            {fmtMoney(d.price)}
                          </p>
                        </div>
                        <Stepper qty={qtyOf(d.id)} onAdd={() => setQty(d.id, qtyOf(d.id) + 1)} onDec={() => setQty(d.id, qtyOf(d.id) - 1)} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 底部操作条（选中菜品后出现） */}
      {tab === 'dish' && sel.size > 0 && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2.5 border-t border-white/60 bg-white/80 backdrop-blur-2xl backdrop-saturate-150 px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => unfav([...sel])} className="h-11 rounded-full border border-[#FF4B33]/40 px-5 text-[14px] text-[#FF4B33] active:bg-black/5">
            取消收藏({sel.size})
          </button>
          <span className="flex-1" />
          <button type="button" onClick={addSelectedToCart} className="h-11 rounded-full bg-[#FFD100] px-8 text-[16px] font-semibold text-black/90 shadow active:opacity-85">
            加入购物车({sel.size})
          </button>
        </div>
      )}
    </div>
  );
}
// ================================ 浏览记录页（截图2：页签 商户/团购 + 周日期条 + 今天分组商户卡） ================================

type HistTab = 'merchant' | 'deal';

const WEEK_HEADS = ['日', '一', '二', '三', '四', '五', '六'];

/** 商户卡右侧分类名（取第一个分类） */
const mtCatNameOf = (m: MtMerchant): string => MT_CATS.find((c) => c.id === m.cats[0])?.name ?? '';

function HistoryPage({
  session,
  onBack,
  onOpenMerchant,
  onOpenDeal,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  onOpenMerchant: (id: string) => void;
  onOpenDeal: (id: string) => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const [, setVer] = useState(0);
  const [tab, setTab] = useState<HistTab>('merchant');
  const [manage, setManage] = useState(false);
  const [stripOpen, setStripOpen] = useState(true);
  const [dayOffset, setDayOffset] = useState<number | null>(null); // null=全部，0=今天，1=昨天…

  const hist = mtLoadHistory(uid);

  // 本周日历（周日起，对齐截图「日一二三四五六」+「今」高亮）
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sunday = new Date(today);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  const weekDays = WEEK_HEADS.map((head, i) => {
    const d = new Date(sunday);
    d.setDate(d.getDate() + i);
    const isToday = d.getTime() === today.getTime();
    const start = d.getTime();
    const end = start + 86400_000;
    return {
      head,
      label: isToday ? '今' : String(d.getDate()),
      isToday,
      offset: Math.round((today.getTime() - start) / 86400_000),
      hasRecord: hist.some((h) => h.at >= start && h.at < end),
    };
  });

  const tabItems = hist.filter((h) => (tab === 'merchant' ? h.kind === 'merchant' : h.kind === 'deal'));
  const filtered = dayOffset === null ? tabItems : tabItems.filter((h) => h.at >= today.getTime() - (dayOffset + 1) * 86400_000 + 86400_000 - 86400_000 && h.at < today.getTime() - dayOffset * 86400_000 + 86400_000);

  // 按天分组（今天/昨天/M月D日）
  const groupsMap = new Map<number, MtHistItem[]>();
  for (const h of filtered) {
    const day = Math.floor(h.at / 86400_000);
    const g = groupsMap.get(day);
    if (g) g.push(h);
    else groupsMap.set(day, [h]);
  }
  const groups = [...groupsMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([day, items]) => {
      const label = day === Math.floor(today.getTime() / 86400_000) ? '今天' : day === Math.floor(today.getTime() / 86400_000) - 1 ? '昨天' : (() => {
        const d = new Date(day * 86400_000);
        return `${d.getMonth() + 1}月${d.getDate()}日`;
      })();
      return { label, items };
    });

  const removeOne = (kind: string, id: string) => {
    mtRemoveHistory(uid, kind === 'deal' ? 'deal' : 'merchant', id);
    setVer((v) => v + 1);
    onToast('已删除该条记录');
  };
  const clearAll = () => {
    mtClearHistory(uid);
    setManage(false);
    setVer((v) => v + 1);
    onToast('浏览记录已清空');
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 顶栏：返回 + 标题 + 管理 */}
      <div className="relative grid h-[100px] shrink-0 place-items-center border-b border-black/[0.04] pt-[50px]">
        <button type="button" aria-label="返回" onClick={onBack} className="absolute left-1 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
        </button>
        <p className="text-[19px] font-semibold text-black/90">浏览记录</p>
        <button
          type="button"
          onClick={() => setManage((m) => !m)}
          className="absolute right-4 top-[54px] text-[15px] text-black/75 active:opacity-60"
        >
          {manage ? '完成' : '管理'}
        </button>
      </div>

      {/* 页签 */}
      <div className="flex shrink-0 items-end gap-6 px-4 pb-2">
        {([
          { key: 'merchant', label: '商户' },
          { key: 'deal', label: '团购' },
        ] as { key: HistTab; label: string }[]).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setDayOffset(null);
            }}
            className={`relative shrink-0 pb-1.5 transition-colors ${tab === t.key ? 'text-[19px] font-bold text-black/90' : 'text-[16px] text-black/45'}`}
          >
            {t.label}
            {tab === t.key && <span className="absolute inset-x-1 bottom-0 mx-auto h-[3px] w-6 rounded-full bg-[#FFC300]" />}
          </button>
        ))}
      </div>

      {/* 内容区（白底直排，无圆角面板） */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
        <div className="h-full overflow-y-auto pb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* 周日期条（今高亮黄框+黄点；有记录的日期下方小黄点） */}
          {stripOpen && tabItems.length > 0 && (
            <div className="px-1 pt-3">
              <div className="grid grid-cols-7">
                {weekDays.map((d) => (
                  <button key={d.head + d.label} type="button" onClick={() => setDayOffset(dayOffset === d.offset ? null : d.offset)} className="flex flex-col items-center gap-1 py-1 active:opacity-70">
                    <span className={`text-[12px] ${d.isToday ? 'text-black/85' : 'text-black/40'}`}>{d.head}</span>
                    <span
                      className={`grid h-9 w-9 place-items-center rounded-xl text-[16px] ${
                        dayOffset === d.offset ? 'bg-[#FFF7CC] font-semibold text-black/90' : d.isToday ? 'rounded-xl border border-[#F0C900] bg-[#FFFBE0] font-semibold text-black/90' : 'text-black/75'
                      }`}
                    >
                      {d.label}
                    </span>
                    <span className={`h-[3px] w-[3px] rounded-full ${d.hasRecord ? 'bg-[#F0C900]' : 'bg-transparent'}`} />
                  </button>
                ))}
              </div>
              {dayOffset !== null && (
                <p className="pb-1 text-center text-[12px] text-black/40">
                  仅看{weekDays.find((d) => d.offset === dayOffset)?.isToday ? '今天' : '该日'}记录 · 点击日期可取消
                </p>
              )}
            </div>
          )}

          {/* 收起/展开日期条 */}
          {tabItems.length > 0 && (
            <div className="flex justify-center py-1.5">
              <button type="button" aria-label={stripOpen ? '收起日期' : '展开日期'} onClick={() => setStripOpen((s) => !s)} className="grid h-8 w-8 place-items-center rounded-full bg-[#F5F6F7] active:bg-black/10">
                <ChevronDown className={`h-4.5 w-4.5 text-black/55 transition-transform ${stripOpen ? '' : 'rotate-180'}`} />
              </button>
            </div>
          )}

          {/* 列表 */}
          {tabItems.length === 0 ? (
            <div className="pt-16 text-center">
              <p className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#F5F6F7]">
                <Eye className="h-7 w-7 text-black/25" strokeWidth={1.8} />
              </p>
              <p className="mt-3 text-[14px] text-black/45">暂无浏览记录</p>
              <p className="mt-1 text-[12px] text-black/30">逛过的商家和团购会出现在这里</p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="pt-16 text-center text-[13px] text-black/40">这一天没有浏览记录</p>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="mt-2">
                <p className="px-1 pb-1 pt-2 text-[17px] font-bold text-black/90">{g.label}</p>
                <div>
                  {g.items.map((h) => {
                    const delBtn = manage ? (
                      <button type="button" aria-label="删除" onClick={() => removeOne(h.kind, h.id)} className="mt-5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#F5F6F7] active:bg-black/10">
                        <Minus className="h-4 w-4 text-black/45" strokeWidth={2.4} />
                      </button>
                    ) : null;
                    if (h.kind === 'merchant') {
                      const m = mtMerchantOf(h.id);
                      if (!m) return null;
                      return (
                        <div key={`${h.kind}-${h.id}`} className="flex items-start gap-3 border-b border-black/[0.04] p-3 last:border-b-0">
                          <button type="button" onClick={() => onOpenMerchant(m.id)} className="shrink-0 active:opacity-80">
                            <ShopAvatar m={m} className="h-[76px] w-[76px] rounded-xl" />
                          </button>
                          <button type="button" onClick={() => onOpenMerchant(m.id)} className="min-w-0 flex-1 text-left active:opacity-80">
                            <span className="flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate text-[17px] font-bold text-black/90">{m.name}</span>
                              <span className={`shrink-0 rounded-[4px] px-1 py-px text-[10px] font-medium ${m.cats.includes('waimai') ? 'bg-[#FFD100] text-black/80' : 'bg-[#FF6000] text-white'}`}>
                                {m.cats.includes('waimai') ? '外卖' : '到店'}
                              </span>
                            </span>
                            <span className="mt-1.5 flex items-center text-[13px]">
                              <Star className="mr-0.5 inline h-3.5 w-3.5 fill-[#FF6000] text-[#FF6000]" strokeWidth={0} />
                              <span className="font-semibold text-[#FF6000]">{m.rating}</span>
                              <span className="ml-2 text-black/45">月售{m.monthSale >= 10000 ? `${(m.monthSale / 10000).toFixed(1)}万` : m.monthSale}</span>
                              <span className="ml-auto text-black/45">
                                {mtDeliveryMinutesOf(m.id)}分钟 {m.distanceKm}km
                              </span>
                            </span>
                            <span className="mt-1.5 flex items-center justify-between">
                              <span className="truncate text-[13px] text-black/40">{mtCatNameOf(m)}</span>
                              <span className="shrink-0 text-[11px] text-black/30">{fmtTime(h.at)}</span>
                            </span>
                          </button>
                          {delBtn}
                        </div>
                      );
                    }
                    const d = mtDealOf(h.id);
                    if (!d) return null;
                    return (
                      <div key={`${h.kind}-${h.id}`} className="flex items-start gap-3 border-b border-black/[0.04] p-3 last:border-b-0">
                        <button type="button" onClick={() => onOpenDeal(d.id)} className="shrink-0 active:opacity-80">
                          <FoodImg src={d.img} emoji={d.emoji} className="h-[76px] w-[76px] rounded-xl" />
                        </button>
                        <button type="button" onClick={() => onOpenDeal(d.id)} className="min-w-0 flex-1 text-left active:opacity-80">
                          <span className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-[17px] font-bold text-black/90">{d.title}</span>
                            <span className="shrink-0 rounded-[4px] bg-[#FFEBF3] px-1 py-px text-[10px] font-medium text-[#FF2D7E]">团购</span>
                          </span>
                          <span className="mt-1.5 flex items-center text-[13px]">
                            <span className="font-semibold text-[#FF6000]">{d.discount}</span>
                            <span className="ml-2 text-black/45">{d.sold}</span>
                            <span className="ml-auto text-black/45">{d.tips}</span>
                          </span>
                          <span className="mt-1.5 flex items-center justify-between">
                            <span className="text-[15px] font-bold" style={{ color: MT_PRICE }}>
                              ¥{fmtMoney(d.price)} <span className="text-[11px] font-normal text-black/30 line-through">¥{fmtMoney(d.origPrice)}</span>
                            </span>
                            <span className="shrink-0 text-[11px] text-black/30">{fmtTime(h.at)}</span>
                          </span>
                        </button>
                        {delBtn}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {/* 尾注 */}
          {tabItems.length > 0 && filtered.length > 0 && <p className="py-4 text-center text-[13px] text-black/30">- 没有更多了 -</p>}

          {/* 管理模式：清空全部 */}
          {manage && tabItems.length > 0 && (
            <button type="button" onClick={clearAll} className="mx-4 mb-2 mt-3 flex items-center justify-center gap-1.5 rounded-full border border-[#FF4B33]/30 py-3 text-[14px] text-[#FF4B33] active:bg-[#FFF4F0]">
              <Trash2 className="h-4 w-4" /> 清空全部浏览记录
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
// ================================ 退款申请弹层（退款售后） ================================

const REFUND_REASONS = ['不想要了', '商家超时未接单', '骑手配送太慢', '餐品洒漏/包装破损', '商家告知缺货', '其他原因'];

function RefundApplySheet({ order, onClose, onToast }: { order: MtOrder; onClose: () => void; onToast: (m: string) => void }) {
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

const REFUND_FAQS = ['查询退款进度', '查询退款退回账户', '我要删除订单', '优惠券是否可退', '能否撤销退款申请', '退款金额不对'];

/** 退款失败页的满意度评分（0-10 分 + 三档表情，对齐截图3） */
function RefundSatisfaction({ onToast }: { onToast: (m: string) => void }) {
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

function RefundDetailPage({
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
function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] text-black/80" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// ================================ 频道页：酒店旅行 / 休闲玩乐 / 电影演出 ================================
// 首页宫格三大频道（/api/mt-fun AI 生成，失败走服务端种子）；图片走 /api/mt-img v7
// （Wikimedia Commons 真实酒店房间/电玩/KTV 实景）。下单复用 MtOrder（kind='tuangou'）→ 支付收银台。

type FunKind = 'fun' | 'hotel' | 'movie';

/** 频道数据获取：挂载/主题变化 → /api/mt-fun（用户配置模型 → 内置模型 → 服务端种子） */
function useFunChannel<T>(kind: FunKind, topic: string): { data: T[]; loading: boolean; reload: () => void } {
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
function ChannelSkeleton({ card }: { card: 'hotel' | 'venue' | 'movie' }) {
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
function RatingBadge({ rating }: { rating: number }) {
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
function submitFunOrder(opts: {
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
function funDates(): { checkIn: string; checkOut: string; label: string } {
  const d1 = new Date();
  const d2 = new Date(Date.now() + 86_400_000);
  const f = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { checkIn: f(d1), checkOut: f(d2), label: `${f(d1)} 入住 · ${f(d2)} 离店` };
}

// ---------------- 酒店旅行频道 ----------------

const HOTEL_TABS = ['我的附近', '电竞开黑', '特色民宿', '大屏观影', '亲子遛娃'];

function HotelChannelPage({ onBack, onOpenPay, onToast }: { onBack: () => void; onOpenPay: (o: MtOrder) => void; onToast: (m: string) => void }) {
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
        {/* 主题页签 */}
        <div className="mt-2.5 flex items-center gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {HOTEL_TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setSel(null);
              }}
              className={`shrink-0 pb-1.5 text-[15px] ${tab === t ? 'font-bold text-black/90' : 'text-black/55'}`}
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
function HotelCard({ hotel, onOpen }: { hotel: FunHotel; onOpen: () => void }) {
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
function RoomSheet({ hotel, room, onClose, onBook }: { hotel: FunHotel; room: FunRoom; onClose: () => void; onBook: () => void }) {
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
function HotelConfirmSheet({ hotel, room, onClose, onOpenPay, onToast }: { hotel: FunHotel; room: FunRoom; onClose: () => void; onOpenPay: (o: MtOrder) => void; onToast: (m: string) => void }) {
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

const FUN_CATS = ['全部', '电玩城', 'KTV', '密室逃脱', '洗浴按摩', '游泳健身', '景区', '游乐场', '棋牌', '台球'];

function FunChannelPage({ onBack, onOpenPay, onToast }: { onBack: () => void; onOpenPay: (o: MtOrder) => void; onToast: (m: string) => void }) {
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
        {/* 品类筛选 */}
        <div className="mt-2.5 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FUN_CATS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setCat(t)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] ${cat === t ? 'bg-black/85 font-semibold text-white' : 'bg-white/70 text-black/65'}`}
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
function FunDealConfirmSheet({ venue, deal, onClose, onOpenPay, onToast }: { venue: FunVenue; deal: FunDeal; onClose: () => void; onOpenPay: (o: MtOrder) => void; onToast: (m: string) => void }) {
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

const POSTER_GRADS: [string, string][] = [
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
function PosterArt({ movie, className = '' }: { movie: FunMovie; className?: string }) {
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
function MovieCard({ movie, mark, onMark, onOpen, onBuy }: { movie: FunMovie; mark: 'want' | 'seen' | undefined; onMark: (m: 'want' | 'seen') => void; onOpen: () => void; onBuy: () => void }) {
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

function MoviesChannelPage({ onBack, onOpenPay, onToast }: { onBack: () => void; onOpenPay: (o: MtOrder) => void; onToast: (m: string) => void }) {
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
function MovieDetailPage({ movie, mark, onMark, onBack, onBuy }: { movie: FunMovie; mark: 'want' | 'seen' | undefined; onMark: (m: 'want' | 'seen') => void; onBack: () => void; onBuy: () => void }) {
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
function MovieConfirmSheet({ movie, onClose, onOpenPay, onToast }: { movie: FunMovie; onClose: () => void; onOpenPay: (o: MtOrder) => void; onToast: (m: string) => void }) {
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

// ================================ 消息中心（首页铃铛进入） ================================

function MessagesPage({
  session,
  onBack,
  onOpenOrder,
  onOpenCoupons,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  onOpenOrder: (id: string) => void;
  onOpenCoupons: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  useOrdersTick();
  const orders = mtLoadOrders(uid).slice(0, 8);
  return (
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      <div className="flex shrink-0 items-center gap-2 bg-[#F4F5F7] px-3 pb-2.5 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-6 w-6 text-black/70" />
        </button>
        <p className="min-w-0 flex-1 text-center text-[17px] font-bold text-black/90">消息</p>
        <button type="button" onClick={() => onToast('已全部标记为已读')} className="shrink-0 text-[12px] text-black/45">
          全部已读
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-3">
        {/* 订单通知 */}
        <p className="px-1 text-[13px] font-semibold text-black/50">订单通知</p>
        <div className="mt-2 space-y-2">
          {orders.length === 0 && (
            <div className="rounded-2xl bg-white p-6 text-center">
              <p className="text-[13px] text-black/35">暂无订单通知，下一单后这里会实时提醒</p>
            </div>
          )}
          {orders.map((o) => (
            <button key={o.id} type="button" onClick={() => onOpenOrder(o.id)} className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left active:opacity-80">
              {o.merchantImg ? (
                <FoodImg src={o.merchantImg} emoji={o.merchantEmoji} className="h-11 w-11 shrink-0 rounded-xl" />
              ) : (
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#FFF3B8] text-[18px]">{o.merchantEmoji}</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-black/85">{o.merchantName}</span>
                  <span className="shrink-0 text-[10px] text-black/35">{mtTimeShort(o.createdAt)}</span>
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-black/50">{mtStatusBody(o)}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${o.status === 'completed' ? 'bg-[#F5F6F7] text-black/45' : 'bg-[#FFF3B8] text-[#B77900]'}`}>{mtStatusText(o)}</span>
            </button>
          ))}
        </div>

        {/* 互动消息 */}
        <p className="mt-5 px-1 text-[13px] font-semibold text-black/50">互动消息</p>
        <div className="mt-2 space-y-2">
          <button type="button" onClick={() => onToast('小美客服：0539-000-0000（演示）')} className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left active:opacity-80">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FFE14D] to-[#FFC300]">
              <Headset className="h-[21px] w-[21px] text-black/70" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-black/85">小美客服</span>
              <span className="mt-0.5 block truncate text-[12px] text-black/50">您好呀，下单遇到任何问题都可以找我～</span>
            </span>
            <span className="shrink-0 text-[10px] text-black/35">刚刚</span>
          </button>
          <button type="button" onClick={() => onToast('暂无新粉丝（演示）')} className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left active:opacity-80">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FFE7D6] to-[#FFC9A3]">
              <Users className="h-[21px] w-[21px] text-[#D96A1E]" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-black/85">粉丝互动</span>
              <span className="mt-0.5 block truncate text-[12px] text-black/50">你的评价帮助了 32 位吃货</span>
            </span>
            <span className="shrink-0 text-[10px] text-black/35">昨天</span>
          </button>
        </div>

        {/* 活动优惠 */}
        <p className="mt-5 px-1 text-[13px] font-semibold text-black/50">活动优惠</p>
        <div className="mt-2 space-y-2">
          <button type="button" onClick={onOpenCoupons} className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left active:opacity-80">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#FFECE6] to-[#FFD3C4]">
              <Ticket className="h-[21px] w-[21px] text-[#FF4B33]" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-black/85">神券到账提醒</span>
              <span className="mt-0.5 block truncate text-[12px] text-black/50">大额神券已放入「红包卡券」，7 天内有效</span>
            </span>
            <span className="shrink-0 rounded-full bg-[#FFD100] px-2.5 py-1 text-[11px] font-semibold text-black/85">去使用</span>
          </button>
          <button type="button" onClick={() => onToast('会员日：每周三领双倍神券（演示）')} className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left active:opacity-80">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#FFF3C9] to-[#FFDF8A]">
              <Gift className="h-[21px] w-[21px] text-[#C77700]" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-black/85">会员日活动</span>
              <span className="mt-0.5 block truncate text-[12px] text-black/50">每周三会员日，领双倍成长值与神券</span>
            </span>
            <span className="shrink-0 text-[10px] text-black/35">3 天前</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** 短时间文案（消息列表用） */
function mtTimeShort(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}小时前`;
  return `${Math.floor(diff / 86_400_000)}天前`;
}

// ================================ 会员中心页（我的页会员卡进入） ================================

const MEMBER_LEVELS = [
  { name: '普通会员', need: 0, perk: '注册即享' },
  { name: '白银会员', need: 500, perk: '外卖满45免配送 ×2次/月' },
  { name: '黄金会员', need: 2000, perk: '神券包每月免费领 + 专属客服' },
  { name: '黑钻会员', need: 8000, perk: '全年免配送 + 电影票立减 + 生日礼' },
];

function MemberPage({
  session,
  onBack,
  onOpenCoupons,
  onClaimCoupons,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  onOpenCoupons: () => void;
  onClaimCoupons: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  useOrdersTick();
  const orders = mtLoadOrders(uid);
  const growth = 34 + orders.length * 12;
  const curLevel = [...MEMBER_LEVELS].reverse().find((l) => growth >= l.need) ?? MEMBER_LEVELS[0];
  const nextLevel = MEMBER_LEVELS.find((l) => l.need > growth);
  const pct = nextLevel ? Math.min(100, Math.round(((growth - curLevel.need) / (nextLevel.need - curLevel.need)) * 100)) : 100;

  return (
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      <div className="shrink-0 bg-gradient-to-b from-[#FFEF9E] to-[#FFE14D] pb-6 pt-[54px]">
        <div className="flex items-center gap-2 px-4">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-[#5A4200]" />
          </button>
          <p className="text-[19px] font-bold text-[#5A4200]">会员中心</p>
        </div>
        <div className="mt-4 flex items-center gap-3 px-5">
          {session.avatar ? (
            <img src={session.avatar} alt="" className="h-14 w-14 rounded-full object-cover ring-2 ring-white/80" />
          ) : (
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white">
              <Crown className="h-6 w-6 text-[#B77900]" strokeWidth={2} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[18px] font-bold text-[#5A4200]">
              {session.name} · {curLevel.name}
            </p>
            <p className="mt-1 text-[12px] text-[#5A4200]/75">
              成长值 {growth}
              {nextLevel ? ` · 距 ${nextLevel.name} 还差 ${nextLevel.need - growth}` : ' · 已是最高等级'}
            </p>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/60">
              <div className="h-full rounded-full bg-gradient-to-r from-[#FF8A00] to-[#FF4B33]" style={{ width: `${Math.max(6, pct)}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-3">
        {/* 神券包 */}
        <div className="rounded-2xl bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-bold text-black/90">会员神券包</p>
            <button
              type="button"
              onClick={() => {
                onClaimCoupons();
              }}
              className="rounded-full bg-[#FFD100] px-4 py-1.5 text-[12px] font-semibold text-black/85 active:opacity-85"
            >
              一键领取
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              ['¥12', '外卖大额神券'],
              ['¥11', '堂食膨胀神券'],
              ['¥7', '堂食神券'],
            ].map(([p, l]) => (
              <button key={l} type="button" onClick={onOpenCoupons} className="rounded-xl border border-[#FFE14D] bg-gradient-to-b from-[#FFFBEB] to-[#FFF3B8] py-3 text-center active:opacity-80">
                <span className="block text-[18px] font-bold text-[#B77900]">{p}</span>
                <span className="mt-0.5 block text-[10px] text-black/55">{l}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 等级体系 */}
        <div className="mt-3 rounded-2xl bg-white p-4">
          <p className="text-[15px] font-bold text-black/90">成长值等级</p>
          <div className="mt-3 space-y-3">
            {MEMBER_LEVELS.map((l) => (
              <div key={l.name} className="flex items-center gap-3">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${growth >= l.need ? 'bg-gradient-to-br from-[#FFE14D] to-[#FFC300] text-black/75' : 'bg-[#F5F6F7]'}`}>
                  {growth >= l.need ? <Check className="h-[18px] w-[18px]" strokeWidth={2.6} /> : <Crown className="h-[18px] w-[18px] text-black/25" strokeWidth={2} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[13px] font-semibold text-black/85">
                    {l.name}
                    <span className="text-[11px] font-normal text-black/35">成长值 ≥ {l.need}</span>
                    {curLevel.name === l.name && <span className="rounded-[3px] bg-[#FFF3B8] px-1 text-[9px] text-[#B77900]">当前</span>}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-black/45">{l.perk}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-black/35">成长值来源：每完成 1 笔订单 +12，评价晒单 +20，连续登录 +2/天（演示规则）。</p>
        </div>

        {/* 会员特权 */}
        <div className="mt-3 rounded-2xl bg-white p-4">
          <p className="text-[15px] font-bold text-black/90">8 项会员权益</p>
          <div className="mt-3 grid grid-cols-4 gap-y-4">
            {([
              [Bike, '免配送费', 'text-[#FF6000]', 'bg-[#FFF0EB]'],
              [Ticket, '神券包', 'text-[#FF4B33]', 'bg-[#FFECE6]'],
              [Clapperboard, '观影立减', 'text-[#C77700]', 'bg-[#FFF1C0]'],
              [Building, '酒店折扣', 'text-[#B77900]', 'bg-[#FFF3B8]'],
              [Headset, '专属客服', 'text-[#D96A1E]', 'bg-[#FFE8D9]'],
              [Cake, '生日礼', 'text-[#FF2D7E]', 'bg-[#FFE8F1]'],
              [Zap, '优先派单', 'text-[#D98A00]', 'bg-[#FFF7E0]'],
              [Gem, '成长加速', 'text-[#1D9A6C]', 'bg-[#E9F7F0]'],
            ] as [LucideIcon, string, string, string][]).map(([Icon, l, tone, bg]) => (
              <button key={l} type="button" onClick={() => onToast(`${l}权益已生效（演示）`)} className="flex flex-col items-center gap-1.5 active:opacity-70">
                <span className={`grid h-10 w-10 place-items-center rounded-full ${bg}`}>
                  <Icon className={`h-[20px] w-[20px] ${tone}`} strokeWidth={1.8} />
                </span>
                <span className="text-[10px] text-black/60">{l}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 伪二维码（确定性网格：21×21 + 三个定位角，按订单号播种 → 同一订单稳定同图；演示用） */
function qrGridOf(id: string): boolean[][] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rnd = (): number => {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h >>> 0) % 1000) / 1000;
  };
  const n = 21;
  const grid: boolean[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => rnd() > 0.52));
  const finder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 7; c++) {
        const edge = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[r0 + r][c0 + c] = edge || core;
      }
    for (let i = -1; i < 8; i++) {
      if (r0 - 1 >= 0 && c0 + i >= 0 && c0 + i < n) grid[r0 - 1][c0 + i] = false;
      if (r0 + 7 < n && c0 + i >= 0 && c0 + i < n) grid[r0 + 7][c0 + i] = false;
      if (c0 - 1 >= 0 && r0 + i >= 0 && r0 + i < n) grid[r0 + i][c0 - 1] = false;
      if (c0 + 7 < n && r0 + i >= 0 && r0 + i < n) grid[r0 + i][c0 + 7] = false;
    }
  };
  finder(0, 0);
  finder(0, n - 7);
  finder(n - 7, 0);
  return grid;
}

// ================================ 团购券码页（订单列表/详情「券码」进入） ================================

function CouponCodePage({
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
  const order = mtGetOrder(uid, orderId);
  if (!order) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-white">
        <p className="text-[13px] text-black/40">订单不存在</p>
        <button type="button" onClick={onBack} className="rounded-full bg-[#FFD100] px-6 py-2 text-[13px] font-semibold text-black/85">
          返回
        </button>
      </div>
    );
  }
  const consumed = Boolean(order.consumedAt);
  // 券号（订单号派生，稳定）
  const code = order.id.slice(-10).toUpperCase().replace(/[^A-Z0-9]/g, '7');
  const expire = new Date(order.createdAt + 90 * 86_400_000);
  const redeem = () => {
    if (consumed) return;
    const list = mtLoadOrders(uid).map((o) =>
      o.id === order.id
        ? { ...o, consumedAt: Date.now(), statusLog: [...o.statusLog, { status: 'completed' as const, at: Date.now() }] }
        : o
    );
    mtSaveOrders(uid, list);
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    onToast('核销成功，祝用餐愉快');
  };

  // 伪二维码（按订单号播种，同一订单稳定同图）
  const qrCells = qrGridOf(order.id);

  return (
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      <div className="flex shrink-0 items-center gap-2 bg-[#F4F5F7] px-3 pb-2.5 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-6 w-6 text-black/70" />
        </button>
        <p className="min-w-0 flex-1 text-center text-[17px] font-bold text-black/90">团购券码</p>
        <span className="w-9 shrink-0" />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-4">
        <div className="rounded-2xl bg-white p-4">
          <div className="flex items-center gap-3">
            {order.merchantImg ? (
              <FoodImg src={order.merchantImg} emoji={order.merchantEmoji} className="h-14 w-14 shrink-0 rounded-xl" />
            ) : (
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-[#FFF3B8] text-[22px]">{order.merchantEmoji}</span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold text-black/90">{order.items[0] ? stripDealQty(order.items[0].name) : order.merchantName}</p>
              <p className="mt-0.5 truncate text-[11px] text-black/40">{order.merchantName}</p>
            </div>
          </div>

          {/* 券码主体 */}
          <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed border-black/15 bg-[#FFFDF4] py-5">
            <div className={`rounded-xl bg-white p-2.5 shadow-sm ${consumed ? 'opacity-45 grayscale' : ''}`}>
              <svg width="168" height="168" viewBox="0 0 21 21" shapeRendering="crispEdges" aria-label="团购券码二维码">
                <rect width="21" height="21" fill="#fff" />
                {qrCells.map((row, r) =>
                  row.map((on, c) => (on ? <rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" fill="#1F2430" /> : null))
                )}
              </svg>
            </div>
            <p className="mt-3 text-[20px] font-bold tracking-[2px] text-black/90">{code}</p>
            <p className="mt-1 text-[11px] text-black/40">到店出示此券码给店员核销（演示二维码）</p>
            {consumed ? (
              <span className="mt-3 rounded-full bg-[#F5F6F7] px-4 py-1.5 text-[12px] text-black/45">
                已核销 · {new Date(order.consumedAt!).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : (
              <button type="button" onClick={redeem} className="mt-3 rounded-full bg-gradient-to-r from-[#FFC300] to-[#FF9500] px-7 py-2.5 text-[14px] font-semibold text-black/90 active:opacity-85">
                模拟到店核销
              </button>
            )}
          </div>

          <div className="mt-4 space-y-2 text-[12px]">
            <div className="flex justify-between">
              <span className="text-black/40">券状态</span>
              <span className={consumed ? 'text-black/55' : 'font-semibold text-[#1D7A3C]'}>{consumed ? '已使用' : '待使用'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-black/40">实付金额</span>
              <span className="font-semibold text-black/80">¥{order.total}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-black/40">有效期至</span>
              <span className="text-black/70">{expire.toLocaleDateString('zh-CN')}（购买后 90 天）</span>
            </div>
            <div className="flex justify-between">
              <span className="text-black/40">使用规则</span>
              <span className="max-w-[210px] text-right text-black/70">免预约 · 仅限堂食 · 不限时段 · 可退改</span>
            </div>
          </div>
        </div>

        <p className="mt-3 px-2 text-center text-[11px] text-black/35">到期未使用自动退款 · 如需退款请到订单详情申请</p>
      </div>
    </div>
  );
}

// ================================ 评价晒单弹层（订单列表/详情「评价」进入） ================================

const RATE_TAGS = ['味道赞', '配送快', '包装好', '分量足', '态度好', '回头客'];

function RateSheet({ order, onClose, onToast }: { order: MtOrder; onClose: () => void; onToast: (m: string) => void }) {
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
