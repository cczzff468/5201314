'use client';

/**
 * 美团「AI 代点外卖」草稿卡（微信/QQ 聊天气泡共用，kind='mtdraft'）：
 * - AI 输出 [帮点外卖:商家ID|菜名x数量|备注] 后生成草稿（mt-draft:<did>），卡片实时读 kv；
 * - pending：商家 + 菜品清单 + 预估合计 +【确认下单】（→ 创建美团待支付订单并跳收银台）
 *   与【不了谢谢】（→ 草稿取消）两个按钮；
 * - confirmed：实时跟订单走——
 *   · 订单待支付 → 「应付」+【去美团支付】（直达收银台）；
 *   · 订单已支付/配送中/已送达 → 内嵌五段实时状态时间线（与订单分享卡同渲染件，监听
 *     mt-orders-changed + 逐秒 tick，商家接单/骑手取餐/送达自动推进）+【查看订单】；
 *   · 订单已取消 → 灰化提示；
 * - declined：整卡灰化「已取消」。
 * 资金说明：本卡只创建待支付订单，真实支付走美团收银台既有渠道（不涉及真实资金）。
 */
import { useEffect, useState } from 'react';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { FoodImg } from './mt-food-img';
import { MtOrderTimeline } from './mt-share-card';
import { MT_DRAFT_EVENT, mtConfirmAiDraft, mtDeclineAiDraft, mtGetDraft } from '@/lib/ios/mt-ai-engage';
import { mtLoadOrders, type MtOrder } from '@/lib/ios/meituan-store';
import { mtProductImgOverride } from '@/lib/ios/meituan-data';
import { navigateToChatSession } from '@/lib/ios/island-notify';

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

export function MtDraftBubble({
  did,
  onToast,
}: {
  did: string;
  onToast?: (m: string) => void;
}) {
  const [ver, setVer] = useState(0);
  const [busy, setBusy] = useState(false);
  const d = mtGetDraft(did);

  // 草稿状态/订单状态被别处更新 → 重读渲染；逐秒 tick（时间线与倒计时实时感）
  useEffect(() => {
    const onChange = () => setVer((v) => v + 1);
    const iv = window.setInterval(onChange, 1000);
    window.addEventListener(MT_DRAFT_EVENT, onChange);
    window.addEventListener('mt-orders-changed', onChange);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener(MT_DRAFT_EVENT, onChange);
      window.removeEventListener('mt-orders-changed', onChange);
    };
  }, []);
  void ver;

  if (!d) {
    return (
      <div className="w-[252px] rounded-[14px] bg-white p-3 text-[12px] text-black/35 shadow-[0_5px_16px_rgba(0,0,0,0.10)]">
        代点请求不存在或已过期
      </div>
    );
  }

  // confirmed 后实时读订单（与订单分享卡同源：statusLog 推导时间线）
  const order: MtOrder | null = d.orderId ? (mtLoadOrders(d.uid).find((o) => o.id === d.orderId) ?? null) : null;
  const paid = !!order && order.status !== 'pendingPay' && order.status !== 'canceled';

  const goPay = (orderId: string) => {
    navigateToChatSession('meituan', orderId, { pay: true });
  };
  const openDetail = () => {
    if (d.orderId) navigateToChatSession('meituan', d.orderId);
  };

  const confirm = () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = mtConfirmAiDraft(did);
      if (!res.ok) {
        onToast?.(res.error);
        return;
      }
      onToast?.(`已下单 ¥${fmt2(res.total)}，去美团支付`);
      goPay(res.orderId);
    } finally {
      setBusy(false);
    }
  };

  const decline = () => {
    if (busy) return;
    if (mtDeclineAiDraft(did)) onToast?.('已取消代点');
  };

  return (
    <div
      data-testid={`mt-draft-card-${d.status}`}
      className={`chat-card chat-card-mtdraft chat-card-body relative block w-[252px] rounded-[14px] bg-white p-2.5 text-left shadow-[0_5px_16px_rgba(0,0,0,0.10)] transition-all duration-300 ${d.status === 'declined' || order?.status === 'canceled' ? 'grayscale-[0.72]' : ''}`}
    >
      {/* 头部：美团 logo + 交易保障 */}
      <div className="flex items-center gap-1.5">
        <img src="/icons/meituan-app.png" alt="" className="h-[22px] w-[22px] rounded-full object-cover" />
        <span className="text-[13px] font-semibold text-black/85">美团</span>
        <span className="chat-card-tag rounded bg-[#FFF0D6] px-1.5 py-0.5 text-[10px] font-medium text-[#B26B00]">代点外卖</span>
        <span className="ml-auto flex items-center gap-[3px] text-[11px] font-medium text-[#00B862]">
          <ShieldCheck className="h-[13px] w-[13px]" strokeWidth={2.2} />
          交易保障
        </span>
      </div>

      <p className="mt-1.5 truncate text-[15px] font-semibold leading-snug text-black/90">
        {d.charName}帮你挑的外卖
      </p>
      <p className="mt-0.5 truncate text-[12px] text-black/45">
        {d.merchantEmoji} {d.merchantName}
      </p>

      {/* 菜品清单 */}
      <div className="mt-2 space-y-1.5 rounded-[10px] bg-[#FAFAFB] p-2">
        {d.items.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            <FoodImg src={(it.dishId ? mtProductImgOverride(it.dishId) : null) ?? it.img} emoji={it.emoji} className="h-8 w-8 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] text-black/80">{it.name}</p>
              <p className="text-[10.5px] text-black/35">×{it.qty}</p>
            </div>
            <span className="shrink-0 text-[12px] font-medium text-black/75">¥{fmt2(it.price * it.qty)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-black/[0.05] pt-1.5">
          <span className="text-[11px] text-black/40">{d.status === 'confirmed' && d.total ? '应付' : '预估'}（含配送/满减）</span>
          <span className="text-[14px] font-bold text-[#FF6000]">¥{fmt2(d.status === 'confirmed' && d.total ? d.total : d.estimate)}</span>
        </div>
      </div>

      {d.note && <p className="mt-1.5 truncate text-[11px] text-black/40">备注：{d.note}</p>}

      {/* 操作区：pending 确认/拒绝；confirmed 实时跟订单（待支付→去付款；已支付→状态时间线）；declined 已取消 */}
      {d.status === 'pending' ? (
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            data-testid="mt-draft-decline"
            onClick={decline}
            disabled={busy}
            className="h-9 flex-1 rounded-full border border-black/10 text-[13px] text-black/55 active:opacity-70"
          >
            不了谢谢
          </button>
          <button
            type="button"
            data-testid="mt-draft-confirm"
            onClick={confirm}
            disabled={busy}
            className="chat-card-btn h-9 flex-[1.4] rounded-full bg-gradient-to-r from-[#FFD900] to-[#FFC300] text-[13px] font-bold text-black/85 shadow-[0_2px_8px_rgba(255,195,0,0.35)] active:opacity-85"
          >
            {busy ? '下单中…' : '确认下单'}
          </button>
        </div>
      ) : d.status === 'confirmed' ? (
        order && paid ? (
          <>
            {/* 已支付：五段实时状态时间线（商家接单/骑手取餐/送达自动推进） */}
            <div data-testid="mt-draft-timeline" className="mt-2.5 border-t border-black/[0.05] pt-2">
              <MtOrderTimeline order={order} />
            </div>
            <button
              type="button"
              data-testid="mt-draft-open-order"
              onClick={openDetail}
              className="mt-2 flex w-full items-center justify-center gap-0.5 text-[11px] font-medium text-[#B77900] active:opacity-70"
            >
              查看订单详情
              <ChevronRight className="h-3 w-3" strokeWidth={2.4} />
            </button>
          </>
        ) : order?.status === 'canceled' ? (
          <p data-testid="mt-draft-canceled" className="mt-2.5 h-9 text-center text-[13px] leading-9 text-black/35">订单已取消</p>
        ) : (
          <button
            type="button"
            data-testid="mt-draft-gopay"
            onClick={() => d.orderId && goPay(d.orderId)}
            className="chat-card-btn mt-2.5 h-9 w-full rounded-full bg-gradient-to-r from-[#FFD900] to-[#FFC300] text-[13px] font-bold text-black/85 active:opacity-85"
          >
            {d.orderId ? '去美团支付' : '查看订单'}
          </button>
        )
      ) : (
        <p className="mt-2.5 h-9 text-center text-[13px] leading-9 text-black/35">已取消</p>
      )}
    </div>
  );
}
