'use client';

/**
 * 微信礼物（第 20 轮新增、第 21 轮按用户反馈重做）：
 * - 礼物来源 = **淘宝已确认收货的订单**（用户：礼物界面就是淘宝买的、收到货的东西放在礼物界面），
 *   挑一件以礼物卡片发给 AI；AI 也可买淘宝商品送回礼物卡（tb-ai-engage [送礼物:商品id]）
 * - WxGiftPicker：礼物选择页（compose='gift'）——奶油金色调 + 已收货订单列表（商品图/标题/店铺），
 *   点「送出」发卡；空态提示去淘宝收货
 * - WxGiftCardBubble：聊天里的礼物卡片气泡——**用户参考真机截图 1:1**：深蓝星空底（细碎白星）
 *   + 金色 X 交叉蝴蝶结（竖丝带贯穿上下、结在垂直居中处）+ 居中金色「送你一份心意」+ 左下白色「礼物」；
 *   12px 圆角、尾巴指向发送方头像侧，点卡片开收礼弹窗
 * - WxGiftReceiveSheet：收礼弹窗（真机同款）——奶油金大圆角面板（{sender}送的礼物 / 送你一份心意 /
 *   礼物大图 / 金色商品名标题+数量 / 金色「收下礼物」按钮）+ 面板下方圆形 ✕ 关闭钮；
 *   收下后按钮变「已收下」（accepted 持久化在消息上）
 */

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { tbCompletedOrders } from '@/lib/ios/tb-share-proxy';
import { tbGiftLiveImg, type TbOrder } from '@/lib/ios/taobao-store';
import { tbProductImgOverride } from '@/lib/ios/taobao-data';

/** 礼物快照（随消息落库；淘宝来源 = 已收货订单的首商品） */
export interface WxGiftData {
  /** 礼物唯一 id（淘宝订单送出 = 订单 id；AI 送 = `tb:${商品id}`） */
  id: string;
  /** 商品名（弹窗金色标题 / 卡片 aria） */
  name: string;
  /** 数量行（弹窗「四叶草小狗1个」同位：如「共 1 件」） */
  countLabel: string;
  /** 商品图 URL（淘宝商品 webp） */
  image: string;
  /** 店铺名（礼物页列表/弹窗可选展示） */
  shop?: string;
  /** 收礼弹窗里已点「收下礼物」（持久化，重开仍显示已收下） */
  accepted?: boolean;
}

/** 卡片配色常量（与真机截图采样对齐） */
const CARD_GOLD = '#F2D9A6';
const CARD_GOLD_SOFT = '#E9C98B';

/* 星空点缀：固定坐标散点（x/y 百分比，r 像素，o 透明度）——细碎白星静态贴真机（第 21 轮加密） */
const CARD_STARS: Array<[number, number, number, number]> = [
  [5, 12, 1.1, 0.7], [11, 32, 0.9, 0.5], [8, 55, 1.3, 0.6], [4, 78, 1, 0.45],
  [15, 88, 1.2, 0.55], [20, 7, 0.8, 0.4], [25, 20, 1.4, 0.8], [22, 44, 0.9, 0.42],
  [28, 66, 1.1, 0.5], [24, 86, 0.8, 0.35], [34, 10, 1, 0.55], [39, 30, 1.5, 0.85],
  [36, 52, 0.8, 0.4], [42, 74, 1.2, 0.6], [40, 90, 0.9, 0.4], [50, 8, 1.1, 0.6],
  [54, 25, 0.8, 0.4], [52, 44, 1.3, 0.7], [56, 63, 0.9, 0.45], [50, 84, 1.4, 0.75],
  [62, 14, 0.9, 0.5], [66, 36, 1.1, 0.6], [64, 58, 0.8, 0.4], [70, 78, 1.2, 0.65],
  [76, 8, 1.3, 0.7], [80, 28, 0.8, 0.4], [84, 50, 1.4, 0.8], [78, 70, 0.9, 0.45],
  [88, 16, 1, 0.55], [92, 42, 1.2, 0.65], [90, 66, 0.8, 0.4], [95, 86, 1.1, 0.6],
  [47, 92, 0.9, 0.45], [59, 92, 1, 0.5], [73, 94, 0.8, 0.4], [87, 92, 1.1, 0.55],
];

/**
 * 金色蝴蝶结（第十轮重画：**实心款**——真机蝴蝶结是实心金缎带，不是描边线稿）：
 * 两片饱满的缎带环耳在中心收拢 + 中央小方结，环耳带一道深色内折线出体积感；
 * 竖丝带线从卡片顶贯穿到底、结扎在垂直居中处，与真机「丝带绕卡一周」一致
 */
function RibbonBow() {
  return (
    <svg width="42" height="26" viewBox="0 0 42 26" fill="none" aria-hidden="true" className="block">
      {/* 左环耳：饱满缎带环（实心金），内折线压出立体感 */}
      <path
        d="M20 13.2 C21.6 7.4, 15.4 3.4, 9.6 4.6 C4.4 5.7, 2.8 11.2, 6.6 14.6 C9.8 17.4, 15.4 17.4, 18.4 15.6 C19.4 15, 19.8 14.2, 20 13.2 Z"
        fill={CARD_GOLD}
      />
      <path
        d="M18.9 13.6 C17.6 12.2, 15.2 10.9, 11.8 10.7 C9.2 10.55, 7.1 11.2, 5.9 12.1"
        stroke="#D9B87E"
        strokeWidth="1.1"
        strokeLinecap="round"
        fill="none"
      />
      {/* 右环耳（镜像） */}
      <path
        d="M22 13.2 C20.4 7.4, 26.6 3.4, 32.4 4.6 C37.6 5.7, 39.2 11.2, 35.4 14.6 C32.2 17.4, 26.6 17.4, 23.6 15.6 C22.6 15, 22.2 14.2, 22 13.2 Z"
        fill={CARD_GOLD}
      />
      <path
        d="M23.1 13.6 C24.4 12.2, 26.8 10.9, 30.2 10.7 C32.8 10.55, 34.9 11.2, 36.1 12.1"
        stroke="#D9B87E"
        strokeWidth="1.1"
        strokeLinecap="round"
        fill="none"
      />
      {/* 中央小结（实心，盖住两耳交汇处） */}
      <rect x="18.4" y="10.4" width="5.2" height="5.2" rx="1.5" fill={CARD_GOLD_SOFT} />
    </svg>
  );
}

/** 礼物卡片气泡（深蓝星空 + 金丝带蝴蝶结 + 送你一份心意，真机参考图；side 决定尾巴指向头像侧）。
 *  第 23 轮（用户反馈）：①圆角 8→**4px**（转账/红包/亲属卡同轮统一，用户：卡片圆角有点圆）；
 *  ②已收下后标题下方加「已收下」小字（真机参考图同款双行）；尾巴双层结构画法不变 */
export function WxGiftCardBubble({
  gift,
  side,
  onClick,
}: {
  gift: WxGiftData;
  /** 'right' = 我方发出（尾巴在右）；'left' = 对方送来（尾巴在左） */
  side: 'right' | 'left';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="wx-gift-bubble"
      aria-label={`礼物卡片：${gift.name}，点击查看`}
      onClick={onClick}
      className="chat-card chat-card-gift relative block h-[84px] w-[206px] cursor-pointer text-left shadow-[0_5px_16px_rgba(0,0,0,0.14)] transition-transform duration-150 active:scale-[0.97]"
      style={gift.accepted ? { filter: 'grayscale(0.55) brightness(0.97)' } : undefined}
    >
      {/* 小尾巴：菱形凸出卡外（不被裁剪），尖角处带一点点圆弧（3px），颜色取卡身右上同段渐变 */}
      <span
        aria-hidden="true"
        className={`chat-card-tail absolute top-[12px] h-[13px] w-[13px] rotate-45 ${side === 'left' ? '-left-[3px]' : '-right-[3px]'}`}
        style={{ backgroundColor: '#2C4E92', borderRadius: side === 'left' ? '2px 2px 2px 3px' : '2px 3px 2px 2px' }}
      />
      {/* 卡身：圆角 + overflow-hidden 只裁内容层（星空/丝带/文案），不再裁掉尾巴 */}
      <span
        className="chat-card-body relative block h-full w-full overflow-hidden rounded-[4px]"
        style={{ background: 'linear-gradient(160deg, #4467B4 0%, #2C4E92 46%, #20396E 100%)' }}
      >
        {/* 星空细碎白点 */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {CARD_STARS.map(([x, y, r, o], i) => (
            <circle key={i} cx={`${x}%`} cy={`${y}%`} r={r} fill="#FFFFFF" opacity={o} />
          ))}
        </svg>

        {/* 竖丝带：全高金色细线 + 中部 X 交叉蝴蝶结（随卡片缩小同步左移/缩小） */}
        <span
          aria-hidden="true"
          className="absolute bottom-0 top-0 w-[2px]"
          style={{ left: 36, background: `linear-gradient(180deg, ${CARD_GOLD} 0%, ${CARD_GOLD_SOFT} 60%, rgba(233,201,139,0.55) 100%)` }}
        />
        <span aria-hidden="true" className="absolute top-1/2" style={{ left: 37.5, transform: 'translate(-50%, -50%) scale(1.08)' }}>
          <RibbonBow />
        </span>

        {/* 居中金色标题（真机同款文案；已收下后加「已收下」小字第二行，真机参考图同款） */}
        <span
          className="absolute inset-y-0 flex flex-col items-center justify-center text-center"
          style={{ left: 56, right: 5, color: CARD_GOLD }}
        >
          <span className="text-[16px] font-semibold tracking-[0.5px]">送你一份心意</span>
          {gift.accepted && <span className="mt-[3px] text-[12px] font-medium tracking-[1px] text-white/90">已收下</span>}
        </span>

        {/* 左下角「礼物」标签 */}
        <span className="chat-card-label absolute bottom-[8px] left-[12px] text-[12.5px] font-medium text-white/95">礼物</span>
      </span>
    </button>
  );
}

/** 礼物选择页（加号面板「礼物」入口）：奶油金色调 + **淘宝已确认收货订单**列表（已送出作礼物的不再出现），点「送出」发卡进当前聊天。
 *  第 23 轮（用户反馈）：①删副标题与「已确认收货的淘宝宝贝…」列表头说明（页面只留标题+清单）；
 *  ②**送出去的礼物从列表消失**——送出时订单打 giftedAt 标记，这里过滤（淘宝订单列表仍正常显示） */
export function WxGiftPicker({
  onBack,
  onSend,
}: {
  onBack: () => void;
  /** 选中订单 → 父组件负责落礼物消息 + toast + 关页（+触发 AI 回合） */
  onSend: (order: TbOrder) => void;
}) {
  // 已送出作礼物的订单不再出现在列表（giftedAt 由送出时写入；票务单等无标记的照常可选）
  const orders = tbCompletedOrders().filter((o) => !o.giftedAt);

  return (
    <div className="absolute inset-0 z-50 flex flex-col dark:bg-[linear-gradient(180deg,#231c10_0%,#1a140b_100%)]!" data-testid="wx-gift-picker" style={{ background: 'linear-gradient(180deg, #FDF6E7 0%, #F7EDD8 100%)' }}>
      {/* 顶栏（奶油金同款） */}
      <div className="shrink-0 pt-[54px]">
        <div className="relative grid h-[48px] place-items-center">
          <button type="button" aria-label="返回" data-testid="wx-gift-back" onClick={onBack} className="absolute left-1 grid h-10 w-10 place-items-center rounded-full active:bg-black/5 dark:active:bg-white/10">
            <ChevronLeft className="h-[24px] w-[24px] text-[#8A6B3A]" strokeWidth={2.2} />
          </button>
          <p className="text-[17px] font-semibold" style={{ color: '#7A5C30' }}>礼物</p>
        </div>
      </div>

      {/* 已收货订单列表（无说明文案，用户要求页面只留清单） */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {orders.length === 0 ? (
          <div className="grid h-full place-items-center">
            <div className="flex flex-col items-center gap-2 px-8 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full" style={{ backgroundColor: 'rgba(201,160,99,0.14)' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#C9A063" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3.5" y="8" width="17" height="12.5" rx="2" />
                  <path d="M12 8 v12.5 M3.5 12.5 h17 M12 8 C9.5 8, 7.5 6.5, 8 4.8 C8.5 3.2, 11 3.4, 12 5.4 C13 3.4, 15.5 3.2, 16 4.8 C16.5 6.5, 14.5 8, 12 8 Z" />
                </svg>
              </span>
              <p className="text-[14px] font-medium" style={{ color: 'rgba(122,92,48,0.75)' }}>还没有可以送出的礼物</p>
              <p className="text-[11.5px] leading-relaxed" style={{ color: 'rgba(160,124,66,0.55)' }}>收到淘宝包裹并确认收货后，宝贝就会出现在这里，挑一件送给 TA 吧</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {orders.map((o) => {
              const first = o.items[0];
              const qty = o.items.reduce((n, it) => n + it.qty, 0);
              return (
                <div key={o.id} className="rounded-2xl bg-white dark:bg-zinc-800/90 p-3 shadow-[0_2px_10px_rgba(122,92,48,0.06)]" data-testid={`wx-gift-item-${o.id}`}>
                  <div className="flex items-center gap-2.5">
                    <img src={first?.pid ? tbProductImgOverride(first.pid) ?? first.img : first?.img} alt={first?.title ?? ''} className="h-[52px] w-[52px] shrink-0 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-[13px] font-medium leading-[18px] text-[#5C4526] dark:text-amber-100/90">{first?.title ?? '宝贝'}</p>
                      <p className="mt-0.5 truncate text-[11px] dark:text-amber-200/60!" style={{ color: 'rgba(160,124,66,0.6)' }}>
                        {o.shopName} · {qty > 1 ? `共 ${qty} 件` : '共 1 件'}
                      </p>
                    </div>
                    <button
                      type="button"
                      data-testid={`wx-gift-send-${o.id}`}
                      onClick={() => onSend(o)}
                      className="shrink-0 rounded-full px-4 py-1.5 text-[12.5px] font-semibold text-white transition active:opacity-85"
                      style={{ background: 'linear-gradient(90deg, #E4BE88, #D3A76C)' }}
                    >
                      送出
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** 收礼弹窗（点卡片唤起，真机同款）：奶油金面板 + 礼物大图 + 金色商品名 + 收下礼物按钮 + 面板下方 ✕ */
export function WxGiftReceiveSheet({
  gift,
  senderName,
  onAccept,
  onClose,
}: {
  gift: WxGiftData;
  /** 送礼人名（面板顶部「XX送的礼物」） */
  senderName: string;
  onAccept: () => void;
  onClose: () => void;
}) {
  const accepted = !!gift.accepted;
  return (
    <div
      className="absolute inset-0 z-[70] flex flex-col items-center justify-center bg-black/60 px-7"
      data-testid="wx-gift-sheet"
      role="dialog"
      aria-label="礼物弹窗"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[318px] rounded-[24px] px-6 pb-6 pt-8 text-center shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
        style={{ background: 'linear-gradient(180deg, #FDF8EA 0%, #F8EED9 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[15px] font-medium" style={{ color: '#C9A063' }}>{senderName}送的礼物</p>
        <p className="mt-1 text-[17px] font-medium" style={{ color: '#C9A063' }}>送你一份心意</p>

        <img src={tbGiftLiveImg(gift.id, gift.image)} alt={gift.name} className="mx-auto mt-5 h-[188px] w-[188px] rounded-[12px] object-cover" />

        <button
          type="button"
          onClick={onClose}
          className="mx-auto mt-5 flex max-w-full items-center justify-center gap-0.5 text-[16.5px] font-semibold leading-snug transition active:opacity-70"
          style={{ color: '#B98A46' }}
          data-testid="wx-gift-bless"
        >
          <span className="line-clamp-2">{gift.name}</span>
          <ChevronRight className="h-[15px] w-[15px] shrink-0" strokeWidth={2.4} />
        </button>
        {gift.countLabel && <p className="mt-1.5 text-[13px]" style={{ color: 'rgba(185,138,70,0.75)' }}>{gift.countLabel}</p>}

        <button
          type="button"
          data-testid="wx-gift-accept"
          disabled={accepted}
          onClick={onAccept}
          className="mt-12 h-[46px] w-full rounded-[10px] text-[16px] font-medium text-white transition active:opacity-85 disabled:cursor-default disabled:opacity-60"
          style={{ background: 'linear-gradient(90deg, #E2BE8A, #D2A868)' }}
        >
          {accepted ? '已收下' : '收下礼物'}
        </button>
      </div>

      {/* 面板下方圆形关闭钮（真机同款白描边 ✕） */}
      <button
        type="button"
        aria-label="关闭"
        data-testid="wx-gift-sheet-close"
        onClick={onClose}
        className="mt-5 grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full border-2 border-white/85 text-white transition active:opacity-70"
      >
        <X className="h-[20px] w-[20px]" strokeWidth={2} />
      </button>
    </div>
  );
}
