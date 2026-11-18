'use client';

/**
 * 淘宝「找人代付 + 订单分享 + 快递」共享 UI（微信/QQ 聊天端与淘宝端共用）：
 * - TbPayBubble：聊天里的代付卡片气泡（白卡 + 淘宝logo/交易保障 + 标题 + 橙色横幅 +
 *   倒计时/「好友已代付 ¥x」+ 查看详情钮；req=代付请求卡 / done=代付完成卡；样式对齐美团代付卡，
 *   品牌色换淘宝橙）；请求卡付款后由 kv 状态驱动变已代付灰化，与红包/转账卡同语义；
 * - TbProxyDetailPage：点卡片进入的「代付详情」全屏页（对齐美团端结构）：
 *   待付 = 请求人头像行 + 等待代付 + 付款须知 +（聊天端方向为好友代付时）等待按钮
 *   +「再次分享」按钮（TbResharePickSheet 两步选人 → tbReshareProxy：同会话催一催/换好友重新发起）；
 *   已付 = 代付人头像行 + 支付成功 + 金额 + 渠道 + 付款须知 + 完成 + 订单商品卡；
 * - TbShareBubble：订单分享动态卡片（订单详情分享/快递面板发出）：淘宝 logo +
 *   店铺/金额 + 买的什么（商品行）+ 五段状态时间线（提交订单→付款成功→商家发货→运输中→已签收）；
 *   票务单（order.ticket）改为票务信息卡：演出名/场馆/日期场次/座位/取票号 + 状态徽标
 *   （待入场/已入场/已放映/已退款/已关闭），点击同样跳淘宝票详情；
 *   状态不落快照：每次渲染按 uid+orderId 实时读订单推导，监听 tb-orders-changed 与逐秒 tick；
 * - TbExpressPicker：微信/QQ 加号面板「快递」页——列出已确认收货（completed）的淘宝订单
 *   （含核销入场的演出票，票务条目展示场次信息），一键分享给当前聊天好友。
 */
import { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, CircleCheck, CircleX, Clock as ClockIcon, Loader2, Package, Share2, ShieldCheck, Truck, X } from 'lucide-react';
import { TbImg } from './tb-img';
import {
  TB_PROXY_CARD_EVENT,
  TB_PROXY_TTL,
  tbCompletedOrders,
  tbGetProxy,
  tbGetShare,
  tbProxyChannelName,
  tbProxyPayOrder,
  tbReshareProxy,
  tbShareOrderOf,
  tbShareStagesOf,
  type TbOrderShare,
} from '@/lib/ios/tb-share-proxy';
import { listContacts } from '@/lib/ios/contacts-store';
import { avatarFor, displayNameOf, isFriendIn, type ContactRecord } from '@/lib/contacts';
import { tbArrivedAtStation, tbConfirmReceive, type TbOrder } from '@/lib/ios/taobao-store';

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

const fmtHm = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function fmtFull(ts: number): string {
  const d = new Date(ts);
  const p = (v: number): string => String(v).padStart(2, '0');
  return `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 代付请求 30 分钟倒计时（口径同淘宝待付款 TTL） */
function useProxyCountdown(createdAt: number): string {
  const calc = (): number => Math.max(0, Math.floor((createdAt + TB_PROXY_TTL - Date.now()) / 1000));
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    const timer = window.setInterval(() => setLeft(calc()), 1000);
    return () => window.clearInterval(timer);
  }, [createdAt]);
  return `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
}

// ---------------- 聊天气泡（微信/QQ 共用；样式对齐美团代付卡，品牌色淘宝橙） ----------------

export function TbPayBubble({ pid, role, side, onClick }: { pid: string; role: 'req' | 'done'; /** 箭头指向头像侧（消息发送方）；缺省按 role 推导（req=右/done=左） */ side?: 'left' | 'right'; onClick: () => void }) {
  const p = tbGetProxy(pid);
  const paid = p?.status === 'paid';
  // 终态（婉拒/失效）→ 卡片褪灰 + 终态文案（同红包/转账领取后语义）
  const declined = p?.status === 'declined';
  const expired = p?.status === 'expired';
  const closed = declined || expired;
  // 颜色互换（与美团同款）：请求卡恒亮橙（引导好友付款）；完成卡/终态卡整体褪灰
  const faded = role === 'done' || !!closed;
  const reqDone = role === 'req' && paid;
  const countdown = useProxyCountdown(p?.createdAt ?? Date.now());
  const [bannerOk, setBannerOk] = useState(true);
  const channel = p?.paidChannel ?? (p ? tbProxyChannelName(p.idp) : '');

  return (
    <button
      type="button"
      data-testid={`tb-pay-bubble-${role}`}
      onClick={onClick}
      className="chat-card chat-card-tbpay chat-card-body relative block w-[252px] rounded-[14px] bg-white p-2.5 text-left shadow-[0_5px_16px_rgba(0,0,0,0.10)] transition-all duration-300 active:brightness-95"
      style={{
        // 完成卡（终态）整体褪色：橙横幅/按钮变灰，白底不脏
        filter: faded ? 'grayscale(0.72) brightness(0.98)' : undefined,
      }}
      aria-label={`淘宝代付卡 ¥${fmt2(p?.amount ?? 0)}（${role === 'done' || reqDone ? '已代付' : declined ? '已婉拒' : expired ? '已失效' : '待代付'}）`}
    >
      {/* 箭头指向头像侧：请求卡=我发出（右）/ 完成卡=好友发来（左） */}
      <span aria-hidden="true" className={`absolute top-[13px] h-[11px] w-[11px] rotate-45 rounded-[2px] bg-white ${(side ?? (role === 'done' ? 'left' : 'right')) === 'left' ? '-left-[4px]' : '-right-[4px]'}`} />

      {/* 头部：淘宝 logo + 交易保障 */}
      <span className="relative flex items-center gap-1.5">
        <img src="/icons/taobao.png" alt="" className="h-[22px] w-[22px] rounded-full object-cover" />
        <span className="text-[13px] font-semibold text-black/85">淘宝</span>
        <span className="ml-auto flex items-center gap-[3px] text-[11px] font-medium text-[#FF5000]">
          <ShieldCheck className="h-[13px] w-[13px]" strokeWidth={2.2} />
          交易保障
        </span>
      </span>

      {/* 主标题（对齐美团代付卡文案；终态换对应描述） */}
      <span className="relative mt-1.5 block truncate text-[15px] font-semibold leading-snug text-black/90">
        {role === 'done' ? 'Hi~你的订单代付成功啦~' : declined ? '这次没能帮你代付呢~' : expired ? '这笔代付已经失效啦~' : 'Hi~快来帮我支付这笔订单吧~'}
      </span>

      {/* 橙色横幅 + 白色圆角金额面板：拼接为一个整体圆角块（橙上白下、无缝相连） */}
      <span className="relative mt-2 block overflow-hidden rounded-[10px] ring-1 ring-black/[0.06]">
        <span className="chat-card-banner relative block h-[88px] overflow-hidden bg-gradient-to-r from-[#FF7A21] to-[#FF4400]">
          {bannerOk && (
            <img
              src={role === 'done' ? '/mt/proxy-banner-done.png' : '/mt/proxy-banner.png'}
              alt=""
              onError={() => setBannerOk(false)}
              className="absolute inset-0 h-full w-full object-cover opacity-90"
            />
          )}
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[15px] font-bold text-white drop-shadow-sm">
            {role === 'done' ? '好友已代付啦~' : declined ? 'TA婉拒了这次代付~' : expired ? '代付已失效~' : '来帮我代付吧~'}
          </span>
          <Package className="absolute right-3 top-1/2 h-8 w-8 -translate-y-1/2 text-white/35" strokeWidth={1.6} aria-hidden="true" />
        </span>
        {/* 金额区（白色圆角面板，与上方橙色横幅拼接成一块） */}
        <span className="relative block bg-white px-3 pb-3 pt-2 text-center">
          {role === 'done' || reqDone ? (
            <>
              <span className="mt-0.5 block text-[21px] font-bold leading-tight tracking-tight text-black/90" data-testid={`tb-pay-bubble-${role}-status`}>
                好友已代付 <span>¥{fmt2(p?.amount ?? 0)}</span>
              </span>
              <span className="mt-1 block truncate text-[11.5px] text-black/40">
                {channel ? (role === 'done' ? `${channel} · 已到账` : channel) : '好友已代付'}
              </span>
            </>
          ) : declined ? (
            <>
              <span className="block text-[19px] font-bold leading-tight tracking-tight text-black/70" data-testid={`tb-pay-bubble-${role}-status`}>
                对方婉拒了
              </span>
              <span className="mt-1 block truncate text-[11.5px] text-black/40">可以再沟通，或自己支付这笔订单</span>
            </>
          ) : expired ? (
            <>
              <span className="block text-[19px] font-bold leading-tight tracking-tight text-black/70" data-testid={`tb-pay-bubble-${role}-status`}>
                代付已失效
              </span>
              <span className="mt-1 block truncate text-[11.5px] text-black/40">{p?.closeReason || '订单未支付，请求已关闭'}</span>
            </>
          ) : (
            <>
              <span className="block text-[11.5px] text-black/40">剩余支付时间</span>
              <span className="mt-0.5 block text-[32px] font-bold leading-tight tabular-nums tracking-tight text-black/90" data-testid={`tb-pay-bubble-${role}-status`}>
                {countdown}
              </span>
            </>
          )}
          <span className="chat-card-btn mt-2.5 flex h-9 items-center justify-center rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[14px] font-bold text-white">查看详情</span>
        </span>
      </span>
    </button>
  );
}

// ---------------- 代付详情页（点卡片进入；对齐美团端结构，品牌色淘宝橙） ----------------

export function TbProxyDetailPage({
  pid,
  onBack,
  onToast,
  /** 聊天端打开（direction 'me' 请求卡可代付）；淘宝端入口不传（仅查看） */
  canPay = false,
}: {
  pid: string;
  onBack: () => void;
  onToast: (m: string) => void;
  canPay?: boolean;
}) {
  const [ver, setVer] = useState(0);
  const [paying, setPaying] = useState(false);
  // 再次分享（direction 'friend' 待付）：两步选人弹层（选微信/QQ → 选好友）→ tbReshareProxy
  const [reshareStep, setReshareStep] = useState<'plat' | 'contact' | null>(null);
  const [resharePlat, setResharePlat] = useState<'wx' | 'qq' | null>(null);
  const [reshareContact, setReshareContact] = useState<ContactRecord | null>(null);
  const [resharing, setResharing] = useState(false);
  const p = tbGetProxy(pid);

  // 代付状态被别处更新（订单侧/AI 决策/另一端）→ 重读渲染
  useEffect(() => {
    const onCard = () => setVer((v) => v + 1);
    window.addEventListener(TB_PROXY_CARD_EVENT, onCard);
    window.addEventListener('tb-orders-changed', onCard);
    return () => {
      window.removeEventListener(TB_PROXY_CARD_EVENT, onCard);
      window.removeEventListener('tb-orders-changed', onCard);
    };
  }, []);
  void ver;

  if (!p) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col bg-[#F4F5F9]">
        <div className="flex shrink-0 items-center bg-[#F4F5F9] px-2 pb-2 pt-[54px]">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/75" />
          </button>
          <p className="min-w-0 flex-1 text-center pr-9 text-[17px] font-semibold text-black/90">代付详情</p>
        </div>
        <div className="grid flex-1 place-items-center">
          <p className="text-[13px] text-black/40">代付请求不存在或已过期</p>
        </div>
      </div>
    );
  }

  const paid = p.status === 'paid';
  const declined = p.status === 'declined';
  const expired = p.status === 'expired';
  const closed = declined || expired;
  const channel = p.paidChannel ?? tbProxyChannelName(p.idp);
  const platform = p.idp === 'wx' ? '微信' : 'QQ';
  /** AI 请机主代付的请求卡：机主点开可直接代付（演示语义，渠道随平台） */
  const canPayNow = canPay && !paid && !closed && p.direction === 'me';

  const payNow = () => {
    if (paying) return;
    setPaying(true);
    try {
      const res = tbProxyPayOrder(pid);
      if (!res.ok) {
        onToast(res.error);
        return;
      }
      onToast(`已帮${p.fromName}代付 ¥${fmt2(p.amount)}`);
      setVer((v) => v + 1);
    } finally {
      setPaying(false);
    }
  };

  /** 再次分享发送：同会话=复用同 pid 重发卡「催一催」；换好友/换平台=新建请求并调度 AI 决策 */
  const sendReshare = () => {
    if (!p || !resharePlat || !reshareContact || resharing) return;
    setResharing(true);
    tbReshareProxy(pid, resharePlat, reshareContact.id)
      .then((res) => {
        if (res.ok) {
          onToast(res.resent ? `已催${displayNameOf(reshareContact)}再看看代付请求` : `已再次分享给${displayNameOf(reshareContact)}`);
          setReshareStep(null);
          setVer((v) => v + 1);
        } else {
          onToast(res.error);
        }
      })
      .catch(() => onToast('发送失败，请重试'))
      .finally(() => setResharing(false));
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#F4F5F9]" data-testid="tb-proxy-detail">
      {/* 顶栏（背景与页身同色） */}
      <div className="shrink-0 bg-[#F4F5F9] pt-[54px]">
        <div className="relative grid h-[48px] place-items-center">
          <button type="button" aria-label="返回" data-testid="tb-proxy-detail-back" onClick={onBack} className="absolute left-1 grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-[24px] w-[24px] text-black/85" strokeWidth={2.2} />
          </button>
          <p className="text-[17px] font-semibold text-black/90">代付详情</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* 人物行：已付 = 代付人；待付 = 请求人 */}
        <div className="flex items-center gap-3 px-1 pb-3.5">
          {paid ? (
            <>
              <AvatarImg src={p.contactAvatar} name={p.contactName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-semibold text-black/90" data-testid="tb-proxy-payer-name">{p.contactName}</p>
                <p className="mt-0.5 truncate text-[13px] text-black/45">我们友谊的小船更加稳固了～</p>
              </div>
            </>
          ) : (
            <>
              <AvatarImg src={p.fromAvatar} name={p.fromName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-semibold text-black/90">{p.fromName}</p>
                <p className="mt-0.5 truncate text-[13px] text-black/45">
                  {declined ? 'TA看了订单，婉拒了这次代付' : expired ? `请求已失效（${p.closeReason ?? '订单未支付'}）` : '拍下了订单，快来帮我付一下吧～'}
                </p>
              </div>
            </>
          )}
        </div>

        {/* 状态卡 */}
        <div className="rounded-2xl bg-white p-5">
          <div className="flex flex-col items-center">
            <span className="flex items-center gap-2 text-[20px] font-bold text-black/90" data-testid="tb-proxy-state">
              {paid ? (
                <>
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[#FF5000]">
                    <CircleCheck className="h-[18px] w-[18px] text-white" strokeWidth={2.4} />
                  </span>
                  支付成功
                </>
              ) : declined ? (
                <>
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-black/25">
                    <CircleX className="h-[17px] w-[17px] text-white" strokeWidth={2.2} />
                  </span>
                  对方已婉拒
                </>
              ) : expired ? (
                <>
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-black/25">
                    <CircleX className="h-[17px] w-[17px] text-white" strokeWidth={2.2} />
                  </span>
                  代付已失效
                </>
              ) : (
                <>
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[#FF5000]">
                    <ClockIcon className="h-[17px] w-[17px] text-white" strokeWidth={2.2} />
                  </span>
                  等待代付
                </>
              )}
            </span>
            <p className="mt-2.5 text-[42px] font-bold leading-tight tracking-tight text-black/90" data-testid="tb-proxy-amount">
              <span className="text-[26px]">¥</span>
              {fmt2(p.amount)}
            </p>
            <p className="mt-1 text-[13px] text-black/45" data-testid="tb-proxy-channel">
              {paid
                ? channel
                : declined
                  ? `对方不想代付（${platform}好友）`
                  : expired
                    ? p.closeReason ?? '订单未支付，请求已关闭'
                    : `等待${p.contactName}代付（${platform}好友）`}
            </p>
            {paid && p.paidAt && <p className="mt-0.5 text-[11px] text-black/30">支付时间 {fmtFull(p.paidAt)}</p>}
          </div>

          {/* 付款须知 */}
          <div className="mt-4 rounded-xl bg-[#FFF1E6] px-4 py-3">
            <p className="text-[13px] font-semibold text-[#B35400]">付款须知</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[#C97A3D]">
              1.代付订单创建成功后30分钟内未付款，订单会自动取消，你可以重新下单。
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-[#C97A3D]">
              2.当代付订单退款成功后，实付金额将原路退还代付人。
            </p>
          </div>

          {/* 主按钮：direction 'me' 待付 = 机主立即代付；'friend' 待付 = 等待好友代付（AI 自主决策）；终态 = 返回 */}
          {paid ? (
            <button
              type="button"
              onClick={onBack}
              data-testid="tb-proxy-done-btn"
              className="mt-4 h-[46px] w-full rounded-full bg-[#FFE2D2] text-[16px] font-semibold text-[#FF5000] active:opacity-85"
            >
              完成
            </button>
          ) : closed ? (
            <button
              type="button"
              onClick={onBack}
              data-testid="tb-proxy-closed-btn"
              className="mt-4 h-[46px] w-full rounded-full bg-[#FFE2D2] text-[16px] font-semibold text-[#FF5000] active:opacity-85"
            >
              {declined ? '知道了' : '好的'}
            </button>
          ) : canPayNow ? (
            <div>
              <button
                type="button"
                onClick={payNow}
                data-testid="tb-proxy-pay-btn"
                className="mt-4 h-[46px] w-full rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[16px] font-bold text-white active:opacity-85"
              >
                {paying ? '支付中…' : `立即代付 ¥${fmt2(p.amount)}`}
              </button>
              <p className="mt-2 text-center text-[11px] leading-relaxed text-black/35">
                {p.fromName}在等你帮忙付款（演示语义，不扣真实余额）
              </p>
            </div>
          ) : (
            <div>
              <button
                type="button"
                disabled
                data-testid="tb-proxy-wait-btn"
                className="mt-4 flex h-[46px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-full bg-[#F5F6F7] text-[15px] text-black/45"
              >
                <Loader2 className="h-4 w-4 animate-spin text-black/35" />
                等待{p.contactName}代付…
              </button>
              <p className="mt-2 text-center text-[11px] leading-relaxed text-black/35">
                TA会根据自己的意愿决定是否代付，可以去聊天里提醒TA
              </p>
              {p.direction === 'friend' && (
                <button
                  type="button"
                  data-testid="tb-proxy-reshare-btn"
                  onClick={() => {
                    setResharePlat(null);
                    setReshareContact(null);
                    setReshareStep('plat');
                  }}
                  className="mt-2.5 flex h-[44px] w-full items-center justify-center gap-1.5 rounded-full border border-[#FF5000]/40 bg-[#FFF6F0] text-[15px] font-semibold text-[#FF5000] active:opacity-85"
                >
                  <Share2 className="h-4 w-4" strokeWidth={2.2} />
                  再次分享给其他好友
                </button>
              )}
            </div>
          )}
        </div>

        {/* 订单商品卡 */}
        <div className="mt-3 rounded-2xl bg-white p-4">
          <p className="truncate text-[15px] font-bold text-black/90" data-testid="tb-proxy-shop">{p.shopName}</p>
          <div className="mt-3 space-y-3">
            {p.items.map((it, i) => (
              <div key={i} className="flex items-center gap-3">
                <TbImg src={it.img} alt={it.name} cap={it.name} className="h-12 w-12 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-black/85">{it.name}</p>
                  <p className="mt-0.5 text-[11.5px] text-black/40">×{it.qty}</p>
                </div>
                <span className="shrink-0 text-[14px] font-semibold text-black/85">¥{fmt2(it.price * it.qty)}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-3 px-2 text-center text-[10.5px] leading-relaxed text-black/30">
          代付金额与订单一致 · 资金由微信支付/QQ钱包保障
        </p>
      </div>

      {/* 再次分享两步选人弹层（选平台 → 选好友 → 发送） */}
      <TbResharePickSheet
        step={reshareStep}
        plat={resharePlat}
        contactId={reshareContact?.id ?? null}
        sending={resharing}
        onPickPlat={(v) => {
          setResharePlat(v);
          setReshareContact(null);
          setReshareStep('contact');
        }}
        onPickContact={setReshareContact}
        onBack={() => (reshareStep === 'contact' ? setReshareStep('plat') : setReshareStep(null))}
        onClose={() => setReshareStep(null)}
        onSend={sendReshare}
      />
    </div>
  );
}

/** 「再次分享」两步选人弹层（选微信/QQ → 选好友）：与淘宝收银台 TbContactPickSheet 同交互的轻量内联版 */
function TbResharePickSheet({
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
  /** null = 关闭；'plat' = 选平台；'contact' = 选联系人 */
  step: 'plat' | 'contact' | null;
  plat: 'wx' | 'qq' | null;
  contactId: string | null;
  sending: boolean;
  onPickPlat: (v: 'wx' | 'qq') => void;
  onPickContact: (c: ContactRecord) => void;
  onBack: () => void;
  onClose: () => void;
  onSend: () => void;
}) {
  /** 平台好友列表（第二步加载；kind!=='user' 且该平台好友标记为真；与加载键一起落 state 防旧列表闪现） */
  const [loaded, setLoaded] = useState<{ key: string; list: ContactRecord[] | null }>({ key: '', list: null });
  const friends = loaded.key === `c:${step}:${plat ?? ''}` ? loaded.list : null;
  useEffect(() => {
    if (step !== 'contact' || !plat) return;
    let alive = true;
    listContacts()
      .then((all) => {
        if (alive) setLoaded({ key: `c:${step}:${plat}`, list: all.filter((c) => c.kind !== 'user' && isFriendIn(c, plat)) });
      })
      .catch(() => {
        if (alive) setLoaded({ key: `c:${step}:${plat}`, list: [] });
      });
    return () => {
      alive = false;
    };
  }, [step, plat]);

  if (!step) return null;
  const platName = plat === 'wx' ? '微信' : 'QQ';
  return (
    <div className="absolute inset-0 z-[70] flex flex-col justify-end bg-black/60" onClick={onClose} data-testid={step === 'plat' ? 'tb-reshare-plat-sheet' : undefined}>
      <div
        className="max-h-[82%] overflow-hidden rounded-t-2xl bg-white pb-[max(14px,env(safe-area-inset-bottom))] [animation:quick-in-up_.24s_cubic-bezier(0.32,0.72,0,1)_both]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="relative grid h-[54px] shrink-0 place-items-center">
          {step === 'contact' && (
            <button type="button" aria-label="返回" onClick={onBack} className="absolute left-2 grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
              <ChevronLeft className="h-[22px] w-[22px] text-black/80" />
            </button>
          )}
          <p className="text-[16px] font-bold text-black/90">{step === 'plat' ? '再次分享代付请求' : `选择${platName}好友`}</p>
          <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-2 grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <X className="h-[20px] w-[20px] text-black/55" />
          </button>
        </div>
        <p className="px-5 pb-2.5 text-[11.5px] leading-relaxed text-black/40">
          {step === 'plat' ? '把代付请求再发给一位好友：TA付款后订单自动完成；发给同一位好友就是催一催' : `从${platName}好友里选一位，把代付请求发给TA`}
        </p>

        {step === 'plat' ? (
          <div className="px-4">
            {([
              ['wx', '/icons/wechat.png', '微信好友', '发给微信里的好友'],
              ['qq', '/icons/qq.png', 'QQ好友', '发给QQ里的好友'],
            ] as ['wx' | 'qq', string, string, string][]).map(([v, img, name, sub]) => (
              <button
                key={v}
                type="button"
                data-testid={`tb-reshare-plat-${v}`}
                onClick={() => onPickPlat(v)}
                className="flex w-full items-center gap-3 border-t border-black/[0.05] py-3.5 text-left first:border-t-0 active:opacity-80"
              >
                <img src={img} alt="" className="h-[38px] w-[38px] shrink-0 rounded-[9px]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-black/85">{name}</span>
                  <span className="block text-[11px] text-black/40">{sub}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-black/25" />
              </button>
            ))}
          </div>
        ) : (
          <div className="max-h-[48vh] overflow-y-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {friends === null ? (
              <p className="py-8 text-center text-[12px] text-black/35">正在获取好友列表…</p>
            ) : friends.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-[13px] text-black/45">暂无{platName}好友</p>
                <p className="mt-1 text-[11px] text-black/30">先去{platName}App添加好友，再回来发送</p>
              </div>
            ) : (
              friends.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`tb-reshare-contact-${c.id}`}
                  onClick={() => onPickContact(c)}
                  className="flex w-full items-center gap-3 border-t border-black/[0.05] py-3 text-left first:border-t-0 active:opacity-80"
                >
                  {avatarFor(c, plat ?? 'wx') ? (
                    <img src={avatarFor(c, plat ?? 'wx') ?? ''} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#FFF1E6] text-[15px] font-semibold text-black/60">
                      {displayNameOf(c).slice(0, 1)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-black/85">{displayNameOf(c)}</span>
                    {c.relation && <span className="block text-[11px] text-black/40">{c.relation}</span>}
                  </span>
                  <span className={`grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border-2 ${contactId === c.id ? 'border-[#FF5000] bg-[#FF5000]' : 'border-black/20'}`}>
                    {contactId === c.id ? <Check className="h-3 w-3 text-white" strokeWidth={3.4} /> : null}
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        {/* 底部按钮 */}
        <div className="px-4 pt-3">
          {step === 'plat' ? (
            <button
              type="button"
              disabled={!plat}
              onClick={() => plat && onPickPlat(plat)}
              className={`h-[48px] w-full rounded-xl text-[16px] font-semibold ${plat ? 'bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-white active:opacity-85' : 'bg-[#FFE2D2] text-black/40'}`}
            >
              下一步
            </button>
          ) : (
            <button
              type="button"
              data-testid="tb-reshare-send"
              disabled={!contactId || sending}
              onClick={onSend}
              className={`h-[48px] w-full rounded-xl text-[16px] font-semibold ${contactId && !sending ? 'bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-white active:opacity-85' : 'bg-[#FFE2D2] text-black/40'}`}
            >
              {sending ? '正在发送…' : '再次分享'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AvatarImg({ src, name }: { src: string | null; name: string }) {
  if (src) return <img src={src} alt={name} className="h-11 w-11 shrink-0 rounded-full object-cover" />;
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#FFE2D2] text-[15px] font-bold text-[#FF5000]">
      {name.slice(0, 1)}
    </span>
  );
}

// ---------------- 订单分享动态卡（微信/QQ 共用；状态时间线实时跟订单走） ----------------

export function TbShareBubble({ sid, side = 'right' }: { sid: string; side?: 'left' | 'right' }) {
  const share: TbOrderShare | null = tbGetShare(sid);
  // 动态刷新：逐秒 tick + 订单状态变化事件 → 重读订单推导时间线
  const [, setVer] = useState(0);
  useEffect(() => {
    const iv = window.setInterval(() => setVer((v) => v + 1), 1000);
    const onChanged = () => setVer((v) => v + 1);
    window.addEventListener('tb-orders-changed', onChanged);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener('tb-orders-changed', onChanged);
    };
  }, []);

  if (!share) {
    return (
      <div className="relative w-[252px] rounded-[14px] bg-white p-3 shadow-[0_5px_16px_rgba(0,0,0,0.10)]">
        <span aria-hidden="true" className={`absolute top-[13px] h-[11px] w-[11px] rotate-45 rounded-[2px] bg-white ${side === 'left' ? '-left-[4px]' : '-right-[4px]'}`} />
        <p className="text-[12px] text-black/35">订单分享已失效</p>
      </div>
    );
  }

  const order = tbShareOrderOf(share);
  const cancelled = order?.status === 'cancelled';
  const awaitingPay = !!order && order.status === 'pendingPay';
  const ticket = order?.ticket;

  /** 票务状态徽标（待入场/已入场/已放映/已退款/已关闭） */
  const ticketBadge = (() => {
    if (!order || !ticket) return null;
    if (ticket.refunded) return { text: '已退款', cls: 'bg-black/[0.06] text-black/40' };
    if (order.status === 'cancelled') return { text: '已关闭', cls: 'bg-black/[0.06] text-black/40' };
    if (ticket.enteredAt) return { text: '已入场', cls: 'bg-[#E8F7F0] text-[#0B8F5C]' };
    const startAt = new Date(`${ticket.date}T${ticket.start}:00`).getTime();
    if (Number.isFinite(startAt) && Date.now() >= startAt) return { text: '已放映', cls: 'bg-[#FFF1E6] text-[#FF5000]' };
    return { text: '待入场', cls: 'bg-[#FFF1E6] text-[#FF5000]' };
  })();

  /** 点击卡片 → 唤起淘宝 App 打开对应订单详情（灵动岛导航总线；订单已不存在时不跳） */
  const openOrderDetail = () => {
    if (!order) return;
    void import('@/lib/ios/island-notify')
      .then((m) => m.navigateToChatSession('taobao', order.id))
      .catch(() => undefined);
  };

  return (
    <div
      data-testid="tb-share-bubble"
      role={order ? 'button' : undefined}
      aria-label={`淘宝订单分享 ¥${fmt2(share.amount)}，点击查看订单详情`}
      onClick={openOrderDetail}
      className={`chat-card chat-card-tbshare chat-card-body relative block w-[252px] rounded-[14px] bg-white p-2.5 text-left shadow-[0_5px_16px_rgba(0,0,0,0.10)] ${order ? 'cursor-pointer transition-transform duration-150 active:scale-[0.97]' : ''}`}
    >
      {/* 箭头指向头像侧（我发出 → 右；AI 角色发来 → 左） */}
      <span aria-hidden="true" className={`absolute top-[13px] h-[11px] w-[11px] rotate-45 rounded-[2px] bg-white ${side === 'left' ? '-left-[4px]' : '-right-[4px]'}`} />

      {/* 头部：淘宝 logo（用户反馈：去掉「订单动态」文字徽标，保留品牌位+官方保障） */}
      <span className="relative flex items-center gap-1.5">
        <img src="/icons/taobao.png" alt="" className="h-[22px] w-[22px] rounded-md object-cover" />
        <span className="text-[13px] font-semibold text-black/85">淘宝</span>
        <span className="ml-auto flex items-center gap-[3px] text-[11px] font-medium text-[#FF5000]">
          <ShieldCheck className="h-[13px] w-[13px]" strokeWidth={2.2} />
          官方保障
        </span>
      </span>

      {/* 店铺 + 金额 */}
      <span className="relative mt-1.5 flex items-baseline gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug text-black/90">{share.shopName}</span>
        <span className="shrink-0 text-[16px] font-bold text-black/90">
          <span className="text-[11px]">¥</span>
          {fmt2(share.amount)}
        </span>
      </span>

      {/* 买的什么：票务单 → 票务信息卡（演出名+场馆+日期场次+座位+票号+状态徽标）；普通单 → 商品行 */}
      {ticket && order ? (
        <span className="relative mt-1.5 flex items-center gap-2 rounded-[10px] bg-[#F8F8F8] px-2 py-2">
          <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md" style={{ background: `linear-gradient(160deg, ${ticket.posterC1}, ${ticket.posterC2})` }}>
            <span className="absolute inset-x-0.5 top-1 line-clamp-3 text-[7.5px] font-black leading-[10px] text-white/95">{ticket.title}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-black/80">{ticket.title}</span>
              {ticketBadge ? <span className={`chat-card-tag shrink-0 rounded-full px-1.5 text-[9px] font-semibold leading-[1.7] ${ticketBadge.cls}`}>{ticketBadge.text}</span> : null}
            </span>
            <span className="mt-0.5 block truncate text-[10.5px] leading-[1.5] text-black/45">{ticket.dateLabel} {ticket.start} · {ticket.venue}</span>
            <span className="block truncate text-[10.5px] leading-[1.5] text-black/45">{ticket.seats.join(' ')} · 取票号 {ticket.ticketNo}</span>
          </span>
        </span>
      ) : (
        <span className="relative mt-1.5 flex items-center gap-2 rounded-[10px] bg-[#F8F8F8] px-2 py-2">
          <TbImg src={share.items[0]?.img} alt={share.items[0]?.name ?? ''} cap={share.items[0]?.name} className="h-9 w-9 shrink-0 rounded-md" />
          <span className="min-w-0 flex-1">
            {share.items.slice(0, 2).map((it, i) => (
              <span key={i} className="block truncate text-[12px] leading-[1.5] text-black/75">
                {it.name}
                <span className="text-black/35"> ×{it.qty}</span>
              </span>
            ))}
            {share.items.length > 2 && <span className="block text-[10.5px] text-black/35">等 {share.itemCount} 件商品</span>}
          </span>
        </span>
      )}

      {/* 动态时间线（共享渲染件；票务单无物流 → 票务卡已含状态，不重复铺时间线） */}
      {!ticket ? (
        <span className="relative mt-2.5 block">
          <TbShareTimeline order={order} />
        </span>
      ) : null}

      {/* AI 代买的订单到驿站：机主在卡片上直接确认收货（已签收需机主确认或让 AI 帮取后才显示） */}
      {order && share.paidBy && order.status === 'shipped' && tbArrivedAtStation(order) && (
        <button
          type="button"
          data-testid="tb-share-confirm"
          onClick={(e) => {
            e.stopPropagation();
            if (tbConfirmReceive(share.uid, order.id)) {
              try {
                window.dispatchEvent(new CustomEvent('tb-orders-changed'));
              } catch {
                /* 忽略 */
              }
            }
          }}
          className="relative mt-2 flex h-9 w-full items-center justify-center rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[13px] font-bold text-white active:opacity-85"
        >
          <Check className="mr-1 h-4 w-4" strokeWidth={2.6} />
          确认收货
        </button>
      )}

      {/* 底注：来源 + 查看详情提示（整卡可点） */}
      <span className="relative mt-2 flex items-center justify-between border-t border-black/[0.05] pt-1.5 text-[10px] text-black/30">
        <span>{awaitingPay ? '待支付 · 点去淘宝付款' : ticket ? '演出票 · 淘票票' : share.paidBy ? `${share.paidBy}已买单 · 淘宝订单` : share.gift ? '送TA的礼物 · 淘宝订单' : '淘宝订单'}</span>
        {order && !cancelled && (
          <span className="flex items-center gap-0.5 font-medium text-[#FF5000]">
            查看详情
            <ChevronRight className="h-3 w-3" strokeWidth={2.4} />
          </span>
        )}
      </span>
    </div>
  );
}

/** 五段动态时间线（共享渲染件）：提交订单→付款成功→商家发货→运输中（最新物流摘要）→已签收；
 *  确认收货（completed）后不再展示物流时间线——压缩为一行「已签收 + 时间 · 交易成功」（用户反馈） */
export function TbShareTimeline({ order }: { order: TbOrder | null }) {
  const stages = tbShareStagesOf(order);
  const reachedCnt = stages.filter((s) => s.at).length;
  const cancelled = order?.status === 'cancelled';
  if (order?.status === 'completed') {
    const at = order.completedAt ?? stages[stages.length - 1]?.at;
    return (
      <span className="block" data-testid="tb-stage-received">
        <span className="flex items-center gap-2">
          <span className="grid h-[13px] w-[13px] shrink-0 place-items-center rounded-full bg-[#FF5000]">
            <Check className="h-[9px] w-[9px] text-white" strokeWidth={3.4} />
          </span>
          <span className="text-[12px] font-semibold text-black/85">已签收</span>
          {at ? <span className="shrink-0 text-[10px] text-black/30">{fmtHm(at)}</span> : null}
          <span className="ml-auto shrink-0 rounded-full bg-black/[0.05] px-1.5 text-[9.5px] font-medium leading-[1.7] text-black/40">交易成功</span>
        </span>
      </span>
    );
  }
  return (
    <span className="block">
      {stages.map((st, i) => {
        const done = !!st.at;
        const current = done && i === reachedCnt - 1 && !cancelled;
        const last = i === stages.length - 1;
        return (
          <span key={st.key} className="relative flex gap-2" data-testid={`tb-stage-${st.key}`}>
            {/* 节点列 */}
            <span className="flex w-4 shrink-0 flex-col items-center">
              {current ? (
                <span className="mt-[3px] grid h-[13px] w-[13px] shrink-0 place-items-center rounded-full bg-[#FF5000]">
                  {st.key === 'received' ? (
                    <Check className="h-[9px] w-[9px] text-white" strokeWidth={3.4} />
                  ) : st.key === 'transit' ? (
                    <Truck className="h-[9px] w-[9px] text-white" strokeWidth={2.8} />
                  ) : st.key === 'shipped' ? (
                    <Package className="h-[9px] w-[9px] text-white" strokeWidth={2.8} />
                  ) : (
                    <ClockIcon className="h-[9px] w-[9px] text-white" strokeWidth={2.8} />
                  )}
                </span>
              ) : (
                <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${done ? 'bg-[#FF5000]' : 'bg-black/12'}`} />
              )}
              {!last && <span className={`w-px flex-1 ${done ? 'bg-[#FF5000]/70' : 'bg-black/[0.08]'}`} />}
            </span>
            {/* 文案列 */}
            <span className={`min-w-0 flex-1 ${last ? '' : 'pb-2'}`}>
              <span className="flex items-baseline gap-1.5">
                <span className={`text-[12px] leading-[1.45] ${current ? 'font-semibold text-black/85' : done ? 'text-black/60' : 'text-black/30'}`}>{st.label}</span>
                {done && st.at && <span className="shrink-0 text-[10px] leading-[1.45] text-black/30">{fmtHm(st.at)}</span>}
                {current && <span className="shrink-0 rounded-full bg-[#FFECE2] px-1.5 text-[9.5px] font-medium leading-[1.7] text-[#FF5000]">进行中</span>}
              </span>
              {st.key === 'transit' && st.trackText && (done || current) && (
                <span className="mt-0.5 block text-[10.5px] leading-[1.4] text-black/45">{st.trackText}</span>
              )}
            </span>
          </span>
        );
      })}
      {cancelled && (
        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-black/40">
          <CircleCheck className="h-3.5 w-3.5 text-black/25" strokeWidth={2} />
          该订单已取消
        </span>
      )}
    </span>
  );
}

// ---------------- 快递页（微信/QQ 加号面板「快递」：已确认收货订单 → 分享给当前聊天好友） ----------------

export function TbExpressPicker({
  onBack,
  onShare,
}: {
  onBack: () => void;
  /** 分享该订单给当前聊天好友（父组件负责调 tbCreateOrderShare + toast + 关页） */
  onShare: (order: TbOrder) => void;
}) {
  const [ver, setVer] = useState(0);
  useEffect(() => {
    const onChanged = () => setVer((v) => v + 1);
    window.addEventListener('tb-orders-changed', onChanged);
    return () => window.removeEventListener('tb-orders-changed', onChanged);
  }, []);
  void ver;

  const orders = tbCompletedOrders();

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#F4F5F9]" data-testid="tb-express-picker">
      {/* 顶栏 */}
      <div className="shrink-0 bg-[#F4F5F9] pt-[54px]">
        <div className="relative grid h-[48px] place-items-center">
          <button type="button" aria-label="返回" data-testid="tb-express-back" onClick={onBack} className="absolute left-1 grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-[24px] w-[24px] text-black/85" strokeWidth={2.2} />
          </button>
          <p className="text-[17px] font-semibold text-black/90">快递</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {orders.length === 0 ? (
          <div className="grid h-full place-items-center">
            <div className="flex flex-col items-center gap-2 px-8 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-black/[0.05]">
                <Package className="h-7 w-7 text-black/30" strokeWidth={1.8} />
              </span>
              <p className="text-[14px] font-medium text-black/60">暂无已确认收货的快递</p>
              <p className="text-[11.5px] leading-relaxed text-black/35">去淘宝确认收货后，包裹就会出现在这里，可以分享给好友</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="px-1 pb-1 pt-1 text-[11.5px] text-black/35">已确认收货/已核销入场的淘宝订单 · 点「分享」发给好友</p>
            {orders.map((o) => {
              const first = o.items[0];
              const tk = o.ticket;
              return (
                <div key={o.id} className="rounded-2xl bg-white p-3">
                  <div className="flex items-center gap-1.5">
                    <img src="/icons/taobao.png" alt="" className="h-[18px] w-[18px] rounded object-cover" />
                    <span className="min-w-0 truncate text-[13.5px] font-semibold text-black/85">{o.shopName}</span>
                    <span className="ml-auto shrink-0 text-[10.5px] text-black/35">{fmtFull(o.completedAt ?? o.createdAt).slice(5, 16)}</span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2.5">
                    {tk ? (
                      <span className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-lg" style={{ background: `linear-gradient(160deg, ${tk.posterC1}, ${tk.posterC2})` }}>
                        <span className="absolute inset-x-1 top-1.5 line-clamp-3 text-[8.5px] font-black leading-[11px] text-white/95">{tk.title}</span>
                      </span>
                    ) : (
                      <TbImg src={first?.img} alt={first?.title ?? ''} cap={first?.title} className="h-[52px] w-[52px] shrink-0 rounded-lg" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-[13px] leading-[18px] text-black/80">{first?.title ?? '商品'}</p>
                      <p className="mt-0.5 truncate text-[11px] text-black/40">
                        {tk ? `${tk.dateLabel} ${tk.start} · ${tk.venue} · ${tk.qty}张` : o.items.length > 1 ? `等 ${o.items.reduce((n, i) => n + i.qty, 0)} 件商品` : `共 ${first?.qty ?? 1} 件`}
                      </p>
                      <p className="mt-1 text-[14px] font-bold text-black/85">
                        <span className="text-[10px]">¥</span>
                        {fmt2(o.total)}
                      </p>
                    </div>
                    <button
                      type="button"
                      data-testid={`tb-express-share-${o.id}`}
                      onClick={() => onShare(o)}
                      className="shrink-0 rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-4 py-1.5 text-[12.5px] font-semibold text-white active:opacity-85"
                    >
                      分享
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
