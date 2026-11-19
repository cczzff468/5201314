'use client';

/**
 * 美团「找人代付」共享 UI（微信/QQ 聊天端与美团端共用）：
 * - MtPayBubble：聊天里的代付卡片气泡（白卡 + 美团logo/交易保障 + 标题 +
 *   黄色 3D 人物横幅 + 倒计时/「好友已代付 ¥x」合并行（内层白面板已按需求删除）+ 查看详情钮；req=代付请求卡 / done=代付完成卡；
 *   请求卡付款后由 kv 状态驱动变已代付灰化，与红包/转账卡同语义）；
 * - MtProxyDetailPage：点卡片进入的「代付详情」全屏页（对齐真机截图）：
 *   待付 = 请求人头像行 + 等待代付 + 付款须知 + 立即代付（聊天端 canPay）；
 *   已付 = 代付人头像行 + 支付成功 + 金额 + 渠道 + 付款须知 + 完成 + 订单商品卡。
 */
import { useEffect, useState } from 'react';
import { ChevronLeft, CircleCheck, CircleX, Clock as ClockIcon, Loader2, ShieldCheck } from 'lucide-react';
import { FoodImg } from './mt-food-img';
import { MT_PROXY_CARD_EVENT, mtGetProxy, mtProxyChannelName, mtProxyPayOrder } from '@/lib/ios/mt-proxy-pay';

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

function fmtFull(ts: number): string {
  const d = new Date(ts);
  const p = (v: number): string => String(v).padStart(2, '0');
  return `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 商品名剥「N杯」数量尾缀（与美团端 stripDealQty 同口径；代付详情商品行已有 ×N 数量列） */
const stripDealQty = (s: string): string =>
  s
    .replace(/\s*\d+杯/g, '')
    .replace(/（\s*）/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[·、]\s*$/u, '')
    .trim();

// ---------------- 聊天气泡（微信/QQ 共用；对齐真机参考图） ----------------

/** 请求卡 15 分钟倒计时（口径同代付详情「15分钟内未付款自动取消」） */
function useProxyCountdown(createdAt: number): string {
  const calc = (): number => Math.max(0, Math.floor((createdAt + 15 * 60_000 - Date.now()) / 1000));
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    const timer = window.setInterval(() => setLeft(calc()), 1000);
    return () => window.clearInterval(timer);
  }, [createdAt]);
  return `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
}

export function MtPayBubble({ pid, role, onClick }: { pid: string; role: 'req' | 'done'; onClick: () => void }) {
  const p = mtGetProxy(pid);
  const paid = p?.status === 'paid';
  // B4/B5：请求终态（婉拒/失效）→ 卡片褪灰 + 终态文案（同红包/转账领取后语义）
  const declined = p?.status === 'declined';
  const expired = p?.status === 'expired';
  const closed = declined || expired;
  // 颜色互换（用户反馈）：请求卡恒亮黄（引导好友付款）；完成卡/终态卡整体褪灰
  const faded = role === 'done' || !!closed;
  const reqDone = role === 'req' && paid;
  const countdown = useProxyCountdown(p?.createdAt ?? Date.now());
  const [bannerOk, setBannerOk] = useState(true);
  const channel = p?.paidChannel ?? (p ? mtProxyChannelName(p.idp) : '');

  return (
    <button
      type="button"
      data-testid={`mt-pay-bubble-${role}`}
      onClick={onClick}
      className="chat-card chat-card-mtpay chat-card-body relative block w-[252px] rounded-[14px] bg-white p-2.5 text-left shadow-[0_5px_16px_rgba(0,0,0,0.10)] transition-all duration-300 active:brightness-95"
      style={{
        // 完成卡（终态）整体褪色：黄横幅/按钮变灰黄，白底不脏
        filter: faded ? 'grayscale(0.72) brightness(0.98)' : undefined,
      }}
      aria-label={`美团代付卡 ¥${fmt2(p?.amount ?? 0)}（${role === 'done' || reqDone ? '已代付' : declined ? '已婉拒' : expired ? '已失效' : '待代付'}）`}
    >
      {/* 箭头指向头像侧：请求卡=我发出（右）/ 完成卡=好友发来（左） */}
      <span aria-hidden="true" className={`absolute top-[13px] h-[11px] w-[11px] rotate-45 rounded-[2px] bg-white ${role === 'done' ? '-left-[4px]' : '-right-[4px]'}`} />

      {/* 头部：美团 logo + 交易保障 */}
      <span className="relative flex items-center gap-1.5">
        <img src="/icons/meituan-app.png" alt="" className="h-[22px] w-[22px] rounded-full object-cover" />
        <span className="text-[13px] font-semibold text-black/85">美团</span>
        <span className="ml-auto flex items-center gap-[3px] text-[11px] font-medium text-[#00B862]">
          <ShieldCheck className="h-[13px] w-[13px]" strokeWidth={2.2} />
          交易保障
        </span>
      </span>

      {/* 主标题（对齐参考图文案；终态换对应描述） */}
      <span className="relative mt-1.5 block truncate text-[15px] font-semibold leading-snug text-black/90">
        {role === 'done' ? 'Hi~你的订单代付成功啦~' : declined ? '这次没能帮你代付呢~' : expired ? '这笔代付已经失效啦~' : 'Hi~快来帮我支付这笔订单吧~'}
      </span>

      {/* 黄色 3D 人物横幅 + 白色圆角金额面板：拼接为一个整体圆角块（黄上白下、无缝相连，用户要求恢复白面板） */}
      <span className="relative mt-2 block overflow-hidden rounded-[10px] ring-1 ring-black/[0.06]">
        <span className="chat-card-banner relative block h-[88px] overflow-hidden bg-gradient-to-r from-[#FFDB3D] to-[#FFC933]">
          {bannerOk && (
            <img
              src={role === 'done' ? '/mt/proxy-banner-done.png' : '/mt/proxy-banner.png'}
              alt=""
              onError={() => setBannerOk(false)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[15px] font-bold text-black/85">
            {role === 'done' ? '好友已代付啦~' : declined ? 'TA婉拒了这次代付~' : expired ? '代付已失效~' : '来帮我代付吧~'}
          </span>
        </span>
        {/* 金额区（白色圆角面板，与上方黄色横幅拼接成一块） */}
        <span className="relative block bg-white px-3 pb-3 pt-2 text-center">
          {role === 'done' || reqDone ? (
            <>
              <span className="mt-0.5 block text-[21px] font-bold leading-tight tracking-tight text-black/90" data-testid={`mt-pay-bubble-${role}-status`}>
                好友已代付 <span>¥{fmt2(p?.amount ?? 0)}</span>
              </span>
              <span className="mt-1 block truncate text-[11.5px] text-black/40">
                {channel ? (role === 'done' ? `${channel} · 已到账` : channel) : '好友已代付'}
              </span>
            </>
          ) : declined ? (
            <>
              <span className="block text-[19px] font-bold leading-tight tracking-tight text-black/70" data-testid={`mt-pay-bubble-${role}-status`}>
                对方婉拒了
              </span>
              <span className="mt-1 block truncate text-[11.5px] text-black/40">可以再沟通，或自己支付这笔订单</span>
            </>
          ) : expired ? (
            <>
              <span className="block text-[19px] font-bold leading-tight tracking-tight text-black/70" data-testid={`mt-pay-bubble-${role}-status`}>
                代付已失效
              </span>
              <span className="mt-1 block truncate text-[11.5px] text-black/40">{p?.closeReason || '订单未支付，请求已关闭'}</span>
            </>
          ) : (
            <>
              <span className="block text-[11.5px] text-black/40">剩余支付时间</span>
              <span className="mt-0.5 block text-[32px] font-bold leading-tight tabular-nums tracking-tight text-black/90" data-testid={`mt-pay-bubble-${role}-status`}>
                {countdown}
              </span>
            </>
          )}
          <span className="chat-card-btn mt-2.5 flex h-9 items-center justify-center rounded-full bg-gradient-to-r from-[#FFD900] to-[#FFC300] text-[14px] font-bold text-black/85">查看详情</span>
        </span>
      </span>
    </button>
  );
}

// ---------------- 代付详情页（点卡片进入；聊天端可代付，美团端只读） ----------------

export function MtProxyDetailPage({
  pid,
  canPay,
  onBack,
  onToast,
}: {
  pid: string;
  /** 聊天端（好友视角）= true 显示「立即代付」；美团端只读 */
  canPay: boolean;
  onBack: () => void;
  onToast: (m: string) => void;
}) {
  const [ver, setVer] = useState(0);
  const [paying, setPaying] = useState(false);
  const p = mtGetProxy(pid);

  // 代付状态被别处更新（订单侧/另一端/AI 决策）→ 重读渲染
  useEffect(() => {
    const onCard = () => setVer((v) => v + 1);
    window.addEventListener(MT_PROXY_CARD_EVENT, onCard);
    window.addEventListener('mt-orders-changed', onCard);
    return () => {
      window.removeEventListener(MT_PROXY_CARD_EVENT, onCard);
      window.removeEventListener('mt-orders-changed', onCard);
    };
  }, []);
  void ver;

  if (!p) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col bg-[#F4F5F7]">
        <div className="flex shrink-0 items-center bg-[#F4F5F7] px-2 pb-2 pt-[54px]">
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
  // B4/B5：请求终态（婉拒/失效）
  const declined = p.status === 'declined';
  const expired = p.status === 'expired';
  const closed = declined || expired;
  const channel = p.paidChannel ?? mtProxyChannelName(p.idp);
  const platform = p.idp === 'wx' ? '微信' : 'QQ';
  // 代付方向：'friend' = AI 好友代付（付款决策由对方 AI 自主做出，本页只等待）；
  // 'me' = 机主代付（AI 角色发起，聊天端打开者就是付款人，保留立即代付）
  const meDir = p.direction === 'me';

  const payNow = async () => {
    if (paying || paid) return;
    setPaying(true);
    await new Promise((r) => setTimeout(r, 950));
    const res = mtProxyPayOrder(p.id);
    setPaying(false);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast('代付成功，订单已支付');
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#F4F5F7]" data-testid="mt-proxy-detail">
      {/* 顶栏（背景与页身同色：状态栏区域不再出现白/灰分界） */}
      <div className="shrink-0 bg-[#F4F5F7] pt-[54px]">
        <div className="relative grid h-[48px] place-items-center">
          <button type="button" aria-label="返回" data-testid="mt-proxy-detail-back" onClick={onBack} className="absolute left-1 grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-[24px] w-[24px] text-black/85" strokeWidth={2.2} />
          </button>
          <p className="text-[17px] font-semibold text-black/90">代付详情</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* 人物行：已付 = 代付人；待付 = 请求人（终态副文案按婉拒/失效区分） */}
        <div className="flex items-center gap-3 px-1 pb-3.5">
          {paid ? (
            <>
              <AvatarImg src={p.contactAvatar} name={p.contactName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-semibold text-black/90" data-testid="mt-proxy-payer-name">{p.contactName}</p>
                <p className="mt-0.5 truncate text-[13px] text-black/45">我们友谊的小船更加稳固了～</p>
              </div>
            </>
          ) : (
            <>
              <AvatarImg src={p.fromAvatar} name={p.fromName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-semibold text-black/90">{p.fromName}</p>
                <p className="mt-0.5 truncate text-[13px] text-black/45">
                  {declined ? 'TA看了订单，婉拒了这次代付' : expired ? `请求已失效（${p.closeReason ?? '订单未支付'}）` : meDir ? '拍了订单，想请你帮TA付一下～' : '拍下了订单，快来帮我付一下吧～'}
                </p>
              </div>
            </>
          )}
        </div>

        {/* 状态卡 */}
        <div className="rounded-2xl bg-white p-5">
          <div className="flex flex-col items-center">
            <span className="flex items-center gap-2 text-[20px] font-bold text-black/90" data-testid="mt-proxy-state">
              {paid ? (
                <>
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[#FFD100]">
                    <CircleCheck className="h-[18px] w-[18px] text-black/80" strokeWidth={2.4} />
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
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[#FF6000]">
                    <ClockIcon className="h-[17px] w-[17px] text-white" strokeWidth={2.2} />
                  </span>
                  等待代付
                </>
              )}
            </span>
            <p className="mt-2.5 text-[42px] font-bold leading-tight tracking-tight text-black/90" data-testid="mt-proxy-amount">
              <span className="text-[26px]">¥</span>
              {fmt2(p.amount)}
            </p>
            <p className="mt-1 text-[13px] text-black/45" data-testid="mt-proxy-channel">
              {paid
                ? channel
                : declined
                  ? `对方不想代付（${platform}好友）`
                  : expired
                    ? p.closeReason ?? '订单未支付，请求已关闭'
                    : meDir
                      ? `等待你代付（${platform}）`
                      : `等待${p.contactName}代付（${platform}好友）`}
            </p>
            {paid && p.paidAt && <p className="mt-0.5 text-[11px] text-black/30">支付时间 {fmtFull(p.paidAt)}</p>}
          </div>

          {/* 付款须知（对齐截图黄底须知块） */}
          <div className="mt-4 rounded-xl bg-[#FFF8D9] px-4 py-3">
            <p className="text-[13px] font-semibold text-[#8F6B1E]">付款须知</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[#A98A3C]">
              1.代付订单创建成功后15分钟内未付款，订单会自动取消，你可以重新下单。
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-[#A98A3C]">
              2.当代付订单退款成功后，实付金额将原路退还代付人。
            </p>
          </div>

          {/* 主按钮：待付 + 机主付款方向（聊天端）= 立即代付；好友付款方向 = 等待对方代付
              （AI 按人设/记忆自主决策，不再由用户替角色点「立即代付」）；美团端发起者只读 */}
          {paid ? (
            <button
              type="button"
              onClick={onBack}
              data-testid="mt-proxy-done-btn"
              className="mt-4 h-[46px] w-full rounded-full bg-[#F6D554] text-[16px] font-semibold text-black/85 active:opacity-85"
            >
              完成
            </button>
          ) : closed ? (
            <button
              type="button"
              onClick={onBack}
              data-testid="mt-proxy-closed-btn"
              className="mt-4 h-[46px] w-full rounded-full bg-[#F6D554] text-[16px] font-semibold text-black/85 active:opacity-85"
            >
              {declined ? '知道了' : '好的'}
            </button>
          ) : canPay && meDir ? (
            <button
              type="button"
              onClick={() => void payNow()}
              disabled={paying}
              data-testid="mt-proxy-pay-btn"
              className="mt-4 h-[46px] w-full rounded-full bg-gradient-to-r from-[#FFC300] to-[#FF9500] text-[16px] font-semibold text-white shadow-[0_3px_10px_rgba(255,170,0,0.35)] active:opacity-85 disabled:opacity-60"
            >
              {paying ? '正在支付…' : `立即代付（帮${p.fromName}支付）`}
            </button>
          ) : canPay ? (
            <div>
              <button
                type="button"
                disabled
                data-testid="mt-proxy-wait-btn"
                className="mt-4 flex h-[46px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-full bg-[#F5F6F7] text-[15px] text-black/45"
              >
                <Loader2 className="h-4 w-4 animate-spin text-black/35" />
                等待{p.contactName}代付…
              </button>
              <p className="mt-2 text-center text-[11px] leading-relaxed text-black/35">
                TA会根据自己的意愿决定是否代付，可以去聊天里提醒TA
              </p>
            </div>
          ) : (
            <button type="button" disabled className="mt-4 h-[46px] w-full cursor-not-allowed rounded-full bg-[#F5F6F7] text-[15px] text-black/35">
              等待好友代付…
            </button>
          )}
        </div>

        {/* 订单商品卡 */}
        <div className="mt-3 rounded-2xl bg-white p-4">
          <p className="truncate text-[15px] font-bold text-black/90" data-testid="mt-proxy-merchant">{p.merchantName}</p>
          <div className="mt-3 space-y-3">
            {p.items.map((it, i) => (
              <div key={i} className="flex items-center gap-3">
                <FoodImg src={it.img} emoji={it.emoji} className="h-12 w-12 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-black/85">{stripDealQty(it.name)}</p>
                  {it.spec && <p className="mt-0.5 truncate text-[11.5px] text-black/40">{stripDealQty(it.spec)}</p>}
                  <p className="mt-0.5 text-[11.5px] text-black/40">×{it.qty}</p>
                </div>
                <span className="shrink-0 text-[14px] font-semibold text-black/85">¥{fmt2(it.price * it.qty)}</span>
              </div>
            ))}
          </div>
          {p.note && (
            <p className="mt-3 border-t border-black/[0.05] pt-2.5 text-[11.5px] text-black/40">备注：{p.note}</p>
          )}
        </div>

        <p className="mt-3 px-2 text-center text-[10.5px] leading-relaxed text-black/30">
          代付金额与订单一致 · 资金由{platform}支付保障
        </p>
      </div>
    </div>
  );
}

function AvatarImg({ src, name }: { src: string | null; name: string }) {
  if (src) return <img src={src} alt={name} className="h-11 w-11 shrink-0 rounded-full object-cover" />;
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#FFD100] text-[15px] font-bold text-black/70">
      {name.slice(0, 1)}
    </span>
  );
}
