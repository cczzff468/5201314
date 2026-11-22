'use client';

/** 美团 App 团购域（第十八轮 #8 拆分）：团购详情/自定义商品/确认订单/选券/选规格/神券中心/券码页。 */

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


// ================================ 团购详情页（截图6） ================================

export function DealDetailPage({ deal, onBack, onBuy, onOpenMerchant, onToast }: { deal: MtDeal; onBack: () => void; onBuy: (mode: 'group' | 'direct') => void; onOpenMerchant: (id: string) => void; onToast: (m: string) => void }) {
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

export function MtCustomProductPage({
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

export const MT_CHOICE_RE = /（?(\d+)\s*选\s*(\d+)）?/;

/** 首页宫格图标（icon key → Lucide 线条图标，简约单色风） */


// ================================ 团购确认订单弹窗（截图7：面板外顶部提示条 + 特价团粉横幅） ================================

export function DealConfirmSheet({
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

export function CouponPickerSheet({
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

export function DishSpecSheet({
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

export type CouponCat = 'all' | 'waimai' | 'daodian' | 'hotel' | 'shangou';

export const COUPON_CATS: { key: CouponCat; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'waimai', label: '外卖' },
  { key: 'daodian', label: '美食' },
  { key: 'hotel', label: '酒店民宿' },
  { key: 'shangou', label: '闪购' },
];


export function CouponsPage({
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
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {COUPON_CATS.map((t) => (
                <button key={t.key} type="button" onClick={() => setCat(t.key)} className={`relative py-3 text-[16px] ${cat === t.key ? 'font-bold text-black/90' : 'text-black/55'}`}>
                  {t.label}
                  {cat === t.key && <span className="absolute inset-x-0 bottom-[4px] mx-auto h-[3px] w-6 rounded-full bg-[#FFC300]" />}
                </button>
              ))}
            </div>
          </div>

          {/* 快捷筛选 chips */}
          <div className="shrink-0 border-b border-black/[0.04] bg-white px-3 pb-2.5">
            <div className="flex flex-wrap gap-2">
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
                  className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-[13px] transition-colors ${quick === k ? 'bg-[#FFF3B8] font-semibold text-[#B77900]' : hot ? 'bg-[#F5F6F7] font-bold text-[#FF3B30]' : 'bg-[#F5F6F7] text-black/70'}`}
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

export function qrGridOf(id: string): boolean[][] {
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

export function CouponCodePage({
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
