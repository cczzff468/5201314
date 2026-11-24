'use client';

/** 美团 App 钱包域（第十八轮 #8 拆分）：零钱/银行卡/账单/借钱/额度/药神基金/发票/支付密码全家桶（页面 + 弹层 + 银行卡元数据）。 */

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

export const MT_BANK_NAMES = ['中国工商银行', '中国建设银行', '中国农业银行', '中国银行', '招商银行', '交通银行', '中国邮政储蓄银行'];

/** 银行品牌信息：简称 / 卡面品牌色渐变 / 卡号前缀（自动生成卡号用） */

export const MT_BANK_META: Record<string, { short: string; grad: string; prefix: string }> = {
  中国工商银行: { short: '工', grad: 'from-[#D81920] to-[#8E000A]', prefix: '622202' },
  中国建设银行: { short: '建', grad: 'from-[#0A6EB4] to-[#054A78]', prefix: '621700' },
  中国农业银行: { short: '农', grad: 'from-[#0AAE76] to-[#046A47]', prefix: '622848' },
  中国银行: { short: '中', grad: 'from-[#BC0A24] to-[#7A0016]', prefix: '621785' },
  招商银行: { short: '招', grad: 'from-[#E4392C] to-[#9E0E14]', prefix: '622588' },
  交通银行: { short: '交', grad: 'from-[#0A57A8] to-[#03325F]', prefix: '622260' },
  中国邮政储蓄银行: { short: '邮', grad: 'from-[#0A9455] to-[#045C33]', prefix: '621799' },
};

export const MT_SHEET_CSS =
  '@keyframes mtSheetUp{from{transform:translateY(55%);opacity:.35}to{transform:translateY(0);opacity:1}}' +
  '@keyframes mtFadeIn{from{opacity:0}to{opacity:1}}' +
  '@keyframes mtShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(4px)}}';

/** 余额页常见问题（首条默认展开） */

export const MT_BALANCE_FAQS: { q: string; a: string; a2?: string; link?: string; tail?: string }[] = [
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

export const MT_LOAN_GUARDS: { t: string; d: string }[] = [
  { t: '严格遵守国家法律规定', d: '资质齐全，符合国家监管政策要求，借贷资金全部来自持牌金融机构。' },
  { t: '利率公开透明', d: '年化利率明确公示，无任何隐藏费用，还款计划清晰可查。' },
  { t: '个人信息保护', d: '金融级加密传输与存储，未经您的授权绝不向第三方泄露。' },
  { t: '规范催收承诺', d: '催收流程规范合规，绝不骚扰联系人，逾期可主动协商（演示文案）。' },
];

/** 账单按日期分组标题（今天/昨天/M月d日） */

export const mtW2 = (n: number): string => n.toFixed(2);
/** 千分位金额（借钱额度/借据展示用）：整数不带小数，非整数两位小数 */

export const mtAmtComma = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 万元口径展示（额度/金额 ≥1万 → 「9.98万」，否则原值逗号分隔） */

export const mtAmtWan = (n: number): string => {
  if (n >= 10000) {
    const w = n / 10000;
    return `${Number.isInteger(w) ? w : w.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}万`;
  }
  return mtAmtComma(n);
};

/** 支持添加的银行（演示） */

export const mtBankMeta = (bank: string) => MT_BANK_META[bank] ?? { short: bank.slice(0, 1) || '卡', grad: 'from-[#F3D3A0] to-[#C8860D]', prefix: '622888' };

/** 自动生成 16 位银行卡号（银行前缀 + 随机 10 位） */

export const mtGenCardNo = (bank: string): string => {
  let no = mtBankMeta(bank).prefix;
  for (let i = 0; i < 10; i++) no += Math.floor(Math.random() * 10);
  return no;
};

/** 卡号 4 位一组空格分隔展示 */

export const mtFmtCardNo = (s: string): string => s.replace(/(\d{4})(?=\d)/g, '$1 ');

/** 弹层动效（面板上滑 + 遮罩淡入 + 错误抖动），MtWalletSheet / MtPayPwdSheet 共用 */

export const mtBillGroupLabel = (ts: number): string => {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return '今天';
  const yest = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === yest.toDateString()) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/** 账单条目时间（M月d日 HH:mm） */

export const mtBillItemTime = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 账单类型 → 圆图标（充值↓绿/提现↑橙/消费购物袋/借款金币/还款↑红/退款旋转） */

export const mtBillIcon = (kind: MtWalletBill['kind']): { Icon: LucideIcon; cls: string } => {
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

export function MtWalletSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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

export function MtWalletCardPicker({ cards, value, onPick }: { cards: MtBankCard[]; value: string | null; onPick: (id: string) => void }) {
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

export function MtPayPwdSheet({
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

export function MtPayPwdGate({ uid, label, onOk, onClose }: { uid: string; label?: string; onOk: () => void; onClose: () => void }) {
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

export function WalletPage({
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

export function WalletBalancePage({ session, onClose, onOpenCards, onToast }: { session: MtSession; onClose: () => void; onOpenCards: () => void; onToast: (m: string) => void }) {
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

export function WalletCardsPage({ session, onClose, onOpenBills, onOpenPayPwd, onOpenDrugFund, onToast }: { session: MtSession; onClose: () => void; onOpenBills: () => void; onOpenPayPwd: () => void; onOpenDrugFund: () => void; onToast: (m: string) => void }) {
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

export function WalletBillsPage({ session, onClose }: { session: MtSession; onClose: () => void }) {
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

export function WalletLoanPage({ session, onClose, onToast }: { session: MtSession; onClose: () => void; onToast: (m: string) => void }) {
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

export function LoanBorrowSheet({
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

export function LoanRepaySheet({
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

export function WalletCardQuotaPage({ session, onClose, onToast }: { session: MtSession; onClose: () => void; onToast: (m: string) => void }) {
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

export function WalletDrugFundPage({ session, onClose, onToast }: { session: MtSession; onClose: () => void; onToast: (m: string) => void }) {
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

export function InvoicePage({ session, onBack, onToast }: { session: MtSession; onBack: () => void; onToast: (m: string) => void }) {
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

export function InvoiceSheet({ uid, order, onClose, onDone }: { uid: string; order: MtOrder; onClose: () => void; onDone: (inv: MtInvoice) => void }) {
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

export function WalletPayPwdPage({ session, onClose, onToast }: { session: MtSession; onClose: () => void; onToast: (m: string) => void }) {
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
