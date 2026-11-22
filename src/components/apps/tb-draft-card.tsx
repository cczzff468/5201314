'use client';

/**
 * 淘宝「AI 帮你买」草稿卡（微信/QQ 聊天气泡共用，kind='tbdraft'）：
 * - AI 输出 [帮你买:商品id|数量?,商品id|数量?,...] 后生成草稿（tb-draft:<did>），卡片实时读 kv；
 *   支持多商品（最多 5 件，跨店会分包裹）；
 * - pending：商品列表 + 店铺 + 数量 + 预估合计 +【确认，让TA买】（→ 按店分组建单 + AI 逐单付款
 *   + 付款后**直接送达**（第 22 轮：跳过物流立即已完成）+ 每单一张订单分享卡回聊天）
 *   与【不了谢谢】（→ 草稿取消）两个按钮；
 * - confirmed：实时跟订单走——内嵌五段实时状态时间线（与订单分享卡同渲染件，监听
 *   tb-orders-changed + 逐秒 tick，发货/物流/签收自动推进；多店多单时跟首单+提示分包裹）
 *   +【查看订单】（跨 App 进淘宝详情）；
 * - declined：整卡灰化「已取消」。
 * 资金说明：确认后由 AI 付款（演示语义，不扣真钱），机主无需支付。
 */
import { useEffect, useState } from 'react';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { TbImg } from './tb-img';
import { TbShareTimeline } from './tb-share-cards';
import { TB_DRAFT_EVENT, tbConfirmAiDraft, tbDeclineAiDraft, tbDraftEstimate, tbGetDraft } from '@/lib/ios/tb-ai-engage';
import { tbLoadOrders, type TbOrder } from '@/lib/ios/taobao-store';
import { tbProductImgOverride } from '@/lib/ios/taobao-data';
import { navigateToChatSession } from '@/lib/ios/island-notify';

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

export function TbDraftBubble({
  did,
  onToast,
}: {
  did: string;
  onToast?: (m: string) => void;
}) {
  const [ver, setVer] = useState(0);
  const [busy, setBusy] = useState(false);
  const d = tbGetDraft(did);

  // 草稿状态/订单状态被别处更新 → 重读渲染；逐秒 tick（时间线实时感）
  useEffect(() => {
    const onChange = () => setVer((v) => v + 1);
    const iv = window.setInterval(onChange, 1000);
    window.addEventListener(TB_DRAFT_EVENT, onChange);
    window.addEventListener('tb-orders-changed', onChange);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener(TB_DRAFT_EVENT, onChange);
      window.removeEventListener('tb-orders-changed', onChange);
    };
  }, []);
  void ver;

  if (!d) {
    return (
      <div className="w-[252px] rounded-[14px] bg-white p-3 text-[12px] text-black/35 shadow-[0_5px_16px_rgba(0,0,0,0.10)]">
        代买请求不存在或已过期
      </div>
    );
  }

  // confirmed 后实时读订单（与订单分享卡同源：状态时间线；跨店多单跟首单展示）
  const orderIds = d.orderIds?.length ? d.orderIds : d.orderId ? [d.orderId] : [];
  const allOrders: TbOrder[] = orderIds.length > 0
    ? tbLoadOrders(d.uid).filter((o) => orderIds.includes(o.id))
    : [];
  const order: TbOrder | null = allOrders[0] ?? null;
  const multiShop = [...new Set(d.items.map((i) => i.shopName))].length > 1;

  const openDetail = () => {
    if (d.orderId) navigateToChatSession('taobao', d.orderId);
  };

  const confirm = () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = tbConfirmAiDraft(did);
      if (!res.ok) {
        onToast?.(res.error);
        return;
      }
      onToast?.(`已下单 ¥${fmt2(res.total)}，${d.charName}已付款，宝贝直接送到你手上`);
    } finally {
      setBusy(false);
    }
  };

  const decline = () => {
    if (busy) return;
    if (tbDeclineAiDraft(did)) onToast?.('已取消代买');
  };

  return (
    <div
      data-testid={`tb-draft-card-${d.status}`}
      className={`chat-card chat-card-tbdraft chat-card-body relative block w-[252px] rounded-[14px] bg-white p-2.5 text-left shadow-[0_5px_16px_rgba(0,0,0,0.10)] transition-all duration-300 ${d.status === 'declined' || order?.status === 'cancelled' ? 'grayscale-[0.72]' : ''}`}
    >
      {/* 头部：淘宝 logo + 交易保障 */}
      <div className="flex items-center gap-1.5">
        <img src="/icons/taobao.png" alt="" className="h-[22px] w-[22px] rounded-full object-cover" />
        <span className="text-[13px] font-semibold text-black/85">淘宝</span>
        <span className="chat-card-tag rounded bg-[#FFE2D2] px-1.5 py-0.5 text-[10px] font-medium text-[#C24E00]">AI 帮你买</span>
        <span className="ml-auto flex items-center gap-[3px] text-[11px] font-medium text-[#FF5000]">
          <ShieldCheck className="h-[13px] w-[13px]" strokeWidth={2.2} />
          交易保障
        </span>
      </div>

      <p className="mt-1.5 truncate text-[15px] font-semibold leading-snug text-black/90">
        {d.charName}帮你挑的宝贝
      </p>
      <p className="mt-0.5 truncate text-[12px] text-black/45">
        {multiShop ? `${d.items[0].shopName} 等${new Set(d.items.map((i) => i.shopName)).size}家店铺 · 共${d.items.reduce((s, i) => s + i.qty, 0)}件` : d.items[0].shopName}
      </p>

      {/* 商品行（多商品全列） */}
      <div className="mt-2 space-y-1.5">
        {d.items.map((it) => (
          <div key={it.pid} className="flex items-center gap-2 rounded-[10px] bg-[#FAFAFB] p-2">
            <TbImg src={tbProductImgOverride(it.pid) ?? it.img} alt={it.title} cap={it.title} className="h-10 w-10 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[12.5px] leading-[17px] text-black/80">{it.title}</p>
              <p className="mt-0.5 text-[10.5px] text-black/35">{multiShop ? `${it.shopName} · ` : ''}×{it.qty}</p>
            </div>
            <span className="shrink-0 text-[12.5px] font-medium text-black/75">¥{fmt2(it.price * it.qty)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between px-0.5">
        <span className="text-[11px] text-black/40">{d.status === 'confirmed' && d.total ? '实付' : '预估'}（含运费）{multiShop ? ' · 多店分开发货' : ''}</span>
        <span className="text-[14px] font-bold text-[#FF5000]">¥{fmt2(d.status === 'confirmed' && d.total ? d.total : tbDraftEstimate(d))}</span>
      </div>

      {/* 操作区：pending 确认/拒绝；confirmed 实时跟订单（AI 已付 → 状态时间线）；declined 已取消 */}
      {d.status === 'pending' ? (
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            data-testid="tb-draft-decline"
            onClick={decline}
            disabled={busy}
            className="h-9 flex-1 rounded-full border border-black/10 text-[13px] text-black/55 active:opacity-70"
          >
            不了谢谢
          </button>
          <button
            type="button"
            data-testid="tb-draft-confirm"
            onClick={confirm}
            disabled={busy}
            className="h-9 flex-[1.4] rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[13px] font-bold text-white shadow-[0_2px_8px_rgba(255,68,0,0.35)] active:opacity-85"
          >
            {busy ? '下单中…' : '确认，让TA买'}
          </button>
        </div>
      ) : d.status === 'confirmed' ? (
        order ? (
          <>
            {/* 已由 AI 付款：五段实时状态时间线（发货/物流/签收自动推进；多店多单跟首单+分包裹提示） */}
            {allOrders.length > 1 ? (
              <p className="mt-2 text-[11px] text-[#C24E00]">共{allOrders.length}个包裹分开发货，以下为第一个包裹的物流</p>
            ) : null}
            <div data-testid="tb-draft-timeline" className="mt-2.5 border-t border-black/[0.05] pt-2">
              <TbShareTimeline order={order} />
            </div>
            <button
              type="button"
              data-testid="tb-draft-open-order"
              onClick={openDetail}
              className="mt-2 flex w-full items-center justify-center gap-0.5 text-[11px] font-medium text-[#C24E00] active:opacity-70"
            >
              查看订单详情
              <ChevronRight className="h-3 w-3" strokeWidth={2.4} />
            </button>
          </>
        ) : (
          <p data-testid="tb-draft-canceled" className="mt-2.5 h-9 text-center text-[13px] leading-9 text-black/35">订单已取消</p>
        )
      ) : (
        <p className="mt-2.5 h-9 text-center text-[13px] leading-9 text-black/35">已取消</p>
      )}
    </div>
  );
}
