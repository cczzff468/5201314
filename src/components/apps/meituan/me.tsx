'use client';

/** 美团 App 我的域（第十八轮 #8 拆分）：我的主页/设置/收藏/足迹/地址簿/消息/会员中心。 */

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
import { MT_BANK_NAMES, MT_BANK_META, MT_SHEET_CSS, MT_BALANCE_FAQS, MT_LOAN_GUARDS, mtW2, mtAmtComma, mtAmtWan, mtBankMeta, mtGenCardNo, mtFmtCardNo, mtBillGroupLabel, mtBillItemTime, mtBillIcon, MtWalletSheet, MtWalletCardPicker, MtPayPwdSheet, MtPayPwdGate, WalletPage, WalletBalancePage, WalletCardsPage, WalletBillsPage, WalletLoanPage, LoanBorrowSheet, LoanRepaySheet, WalletCardQuotaPage, WalletDrugFundPage, InvoicePage, InvoiceSheet, WalletPayPwdPage } from './wallet';


// ================================ 地址管理页 ================================

export function AddressesPage({ session, onBack, onAdd, onEdit, onToast }: { session: MtSession; onBack: () => void; onAdd: () => void; onEdit: (a: MtAddress) => void; onToast: (m: string) => void }) {
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


export function AddAddressPage({ session, onBack, editing, onToast }: { session: MtSession; onBack: () => void; editing: MtAddress | null; onToast: (m: string) => void }) {
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

export function AddrHits({ uid, query, onPick }: { uid: string; query: string; onPick: (s: string) => void }) {
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


// ================================ 我的页（截图4） ================================

export function MyPage({
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

export function SettingsRow({ label, value, onClick, danger }: { label: string; value?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center px-4 py-[17px] text-left active:bg-black/[0.03]">
      <span className={`flex-1 text-[15px] ${danger ? 'font-medium text-[#FF4B33]' : 'text-black/85'}`}>{label}</span>
      {value && <span className="pr-1.5 text-[13px] text-black/35">{value}</span>}
    </button>
  );
}


export function SettingsPage({
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

export type FavTab = 'store' | 'deal' | 'dish' | 'content' | 'other';


export const FAV_TABS: { key: FavTab; label: string }[] = [
  { key: 'store', label: '商户' },
  { key: 'deal', label: '团购' },
  { key: 'dish', label: '商品/菜品' },
  { key: 'content', label: '内容' },
  { key: 'other', label: '其他' },
];

/** 空态插画（黄色放大镜趴在灰色小丘上 + Z z，纯 CSS/SVG 无 emoji，对齐截图1） */

export function FavEmptyIllust() {
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


export function FavoritesPage({
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

export type HistTab = 'merchant' | 'deal';


export const WEEK_HEADS = ['日', '一', '二', '三', '四', '五', '六'];

/** 商户卡右侧分类名（取第一个分类） */


export function HistoryPage({
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


// ================================ 消息中心（首页铃铛进入） ================================

export function MessagesPage({
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

export function mtTimeShort(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}小时前`;
  return `${Math.floor(diff / 86_400_000)}天前`;
}


// ================================ 会员中心页（我的页会员卡进入） ================================

export const MEMBER_LEVELS = [
  { name: '普通会员', need: 0, perk: '注册即享' },
  { name: '白银会员', need: 500, perk: '外卖满45免配送 ×2次/月' },
  { name: '黄金会员', need: 2000, perk: '神券包每月免费领 + 专属客服' },
  { name: '黑钻会员', need: 8000, perk: '全年免配送 + 电影票立减 + 生日礼' },
];


export function MemberPage({
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
