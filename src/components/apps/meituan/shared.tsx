'use client';

/** 美团 App 共享层（第十八轮 #8 拆分）：Page/Tab 类型 + 调色常量 + 跨页工具函数（金额/时间/手机号格式化、状态文案、计数单位）+ 通用 UI 原子（Stepper/小红胶囊/复制钮/信息行/分享面板/团购卡/商家卡等）+ 信息流持久化与本地拼装。 */

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




export type Page = 'main' | 'search' | 'merchant' | 'orderDetail' | 'addresses' | 'addAddress' | 'about' | 'deal' | 'settings' | 'favorites' | 'history' | 'refundDetail' | 'coupons' | 'hotel' | 'fun' | 'movies' | 'travel' | 'shangou' | 'messages' | 'member' | 'couponCode' | 'wallet' | 'walletBalance' | 'walletCards' | 'walletBills' | 'walletPayPwd' | 'walletLoan' | 'walletCardQuota' | 'walletDrugFund' | 'invoices' | 'merchantCenter' | 'merchantEdit' | 'shopManage' | 'createOrder' | 'manageProducts' | 'customProduct';

export type Tab = 'home' | 'orders' | 'cart' | 'my';


export const MT_YELLOW = '#FFD100';

export const MT_PRICE = '#FF4B33';

export const MT_PINK = '#FF2D7E';

export const MT_ORANGE = '#FF6000';

// ================================ 骑手形象（「我的」可选，配送地图立体巡航） ================================
// 形象数据与读写已抽到 @/lib/ios/mt-rider（配送地图 / 灵动岛小窗共用同一选中形象）

/** 计数单位：饮品/奶茶类「杯」，其余「件」（对齐真机量词，奶茶不再用「张」） */

export const mtCountUnit = (name: string): string => (/奶茶|奶绿|奶昔|果茶|柠檬水|咖啡|豆浆|杨枝甘露|可乐|果汁|茶饮|奶蒂/.test(name) ? '杯' : '件');


export const fmtMoney = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const fmtDateTime = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const fmtDate = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 下单时间（带秒，对齐真机 2025.02.26 09:55:37 格式） */

export const fmtDateTimeSec = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

/** 手机号脱敏（139****0171） */

export const maskPhone = (p: string): string => (/^1\d{10}$/.test(p) ? `${p.slice(0, 3)}****${p.slice(7)}` : p);

/** 商家联系人（订单详情「取件地址」行，按商家 id 确定性生成，对齐真机脱敏样式） */

export const MT_KEEPER_SURNAMES = ['黄', '李', '张', '王', '陈', '陶', '刘', '周'];

export const mtMerchantContact = (id: string): string => {
  const h = [...id].reduce((acc, ch) => (acc * 33 + ch.charCodeAt(0)) >>> 0, 9);
  return `${MT_KEEPER_SURNAMES[h % MT_KEEPER_SURNAMES.length]}老板 139****${String(h % 10000).padStart(4, '0')}`;
};

/** 订单跟踪时间标签：今天/昨天 HH:MM（跨天回退日期） */

export const fmtTrackTime = (ts: number): string => {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  if (new Date(now.getTime() - 86_400_000).toDateString() === d.toDateString()) return `昨天 ${hm}`;
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`;
};

/** 状态展示文案（对齐真机：待付款/已关闭；机票/火车票：待出行/出行中） */

export const mtStatusText = (o: MtOrder): string => {
  if (o.status === 'pendingPay') return '待付款';
  if (o.kind === 'tuangou' && o.status === 'canceled') return '已关闭';
  if ((o.kind === 'flight' || o.kind === 'train') && o.status === 'pendingAccept') return '待出行';
  if ((o.kind === 'flight' || o.kind === 'train') && o.status === 'accepted') return '出行中';
  return MT_STATUS_LABEL[o.status];
};

/** 菜单分节名「N选M」识别（鲜果 3选1 / 比萨 4选1 → 购买弹窗内必选分组） */

export function Stepper({ qty, onAdd, onDec }: { qty: number; onAdd: () => void; onDec: () => void }) {
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

export function useOrdersTick(): number {
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


export const EMPTY_FAVS: MtFavs = { stores: [], dishes: [], deals: [] };

/** 收藏状态 hook（商家/菜品/团购）：读当前登录账号，切换后强制刷新；返回切换后是否已收藏 */

export function useFavs() {
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

export const TuanMark = ({ className = '' }: { className?: string }) => (
  <span className={`inline-flex items-center whitespace-nowrap font-bold ${className}`}>
    <span className="text-[#FF2D7E]">特</span>
    <Zap className="h-[0.82em] w-[0.82em] fill-[#FFB300] text-[#FFB300]" strokeWidth={0} />
    <span className="text-[#FF2D7E]">价团</span>
  </span>
);

export function DealCard({ deal, onOpen }: { deal: MtDeal; onOpen: () => void }) {
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

export function DealListCard({ title, deals, onOpen }: { title: string; deals: MtDeal[]; onOpen: (id: string) => void }) {
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

export function ShopAvatar({ m, className = '' }: { m: MtMerchant; className?: string }) {
  return <FoodImg src={mtShopAvatarOf(m.id)} emoji={m.emoji} className={className} />;
}

/** 外卖商家卡（瀑布流）
 *  第三十八轮起封面显示商品图片；第四十轮改为单张商品图（首菜图/emoji 兜底，不再三宫格拼贴）——
 *  店铺图仅在店铺详情页展示；无「自建」角标与右上角×（删除统一收口到管理商品页）。 */

export function MerchantCard({ m, onOpen }: { m: MtMerchant; onOpen: () => void }) {
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


export type FeedItem = { t: 'deal'; d: MtDeal } | { t: 'list' } | { t: 'm'; m: MtMerchant };

export const feedName = (it: FeedItem): string => (it.t === 'm' ? it.m.name : it.t === 'deal' ? it.d.title : '');

/** 团购与商家交替排列（推荐流更像真实信息流） */

export function interleave(deals: MtDeal[], merchants: MtMerchant[]): FeedItem[] {
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


export const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** FeedItem 的展示名（刷新排重用：AI 排除名单 / 本地兜底排重） */

export const homeFeedCache: {
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

export const MT_HOME_FEED_KEY = 'mt-home-feed';

export const MT_HOME_SCROLL_KEY = 'mt-home-feed-scroll';
let homeFeedRestored = false;

/** 从 kv 恢复上次的美团首页信息流（幂等；内存缓存就绪时直接跳过；返回是否恢复成功） */

export function mtRestoreHomeFeed(): boolean {
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

export function mtPersistHomeFeed(): void {
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

export function mtPersistHomeScroll(y: number): void {
  const now = Date.now();
  if (now - lastScrollPersist < 3000) return;
  lastScrollPersist = now;
  kvSet(MT_HOME_SCROLL_KEY, y);
}

/** 本地兜底批（AI 不可用时）：种子池洗牌 + 排除已展示名称；池子耗尽 → 分店变体续流 */

export function localBatch(filter: string | null, exclude: string[]): { items: FeedItem[]; listDeals: MtDeal[]; listTitle: string | null } {
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

export function SmallPill({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ml-1 shrink-0 rounded-full border border-black/15 px-2.5 py-1 text-[11px] leading-none text-black/60 active:bg-black/5">
      {children}
    </button>
  );
}

/** 复制按钮 */

export function CopyBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ml-1 shrink-0 rounded-full border border-black/15 px-2.5 py-1 text-[11px] leading-none text-black/60 active:bg-black/5">
      复制
    </button>
  );
}

export function InfoRow({ k, v, action }: { k: string; v: string; action?: ReactNode }) {
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

export const stripDealQty = (s: string): string =>
  s
    .replace(/\s*\d+杯/g, '')
    .replace(/（\s*）/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[·、]\s*$/u, '')
    .trim();

export function MtShareGlyph({ className = '' }: { className?: string }) {
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

export function ShareSheet({
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

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] text-black/80" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export const mtCatNameOf = (m: MtMerchant): string => MT_CATS.find((c) => c.id === m.cats[0])?.name ?? '';

