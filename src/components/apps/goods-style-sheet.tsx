'use client';

/**
 * 商品图片样式选择弹层（第六十六轮）：从主题 App 迁出——入口改为
 * 淘宝「我的 → 商品图片样式（原红包位）」与美团「我的 → 商品图片样式（原工作兼职位）」，
 * 两处共用本弹层。卡通插画 / 简笔画 / Emoji 三选一，实时写全局 settings.goodsImgStyle
 * （IndexedDB 持久化），淘宝/美团全部商品、订单、购物车图位即时跟随，无需重进。
 * 预览缩略图统一用奶茶图（三态差异最直观：彩色 kawaii / 黑白线稿 / 马卡龙 emoji 块）。
 */

import { Check } from 'lucide-react';
import type { GoodsImgStyle } from '@/lib/ios/store';
import { useSettings } from '@/lib/ios/store';

const GOODS_STYLE_OPTIONS: { value: GoodsImgStyle; name: string; desc: string }[] = [
  { value: 'cartoon', name: '卡通插画', desc: '彩色 kawaii' },
  { value: 'sketch', name: '简笔画', desc: '黑白线稿' },
  { value: 'emoji', name: 'Emoji', desc: '马卡龙色块' },
];

/** 商品图样式当前态缩略图（入口图标 / 弹层预览共用）：奶茶三态 */
export function GoodsStyleThumb({ style, className = '' }: { style: GoodsImgStyle; className?: string }) {
  if (style === 'emoji') {
    return (
      <span
        aria-hidden="true"
        className={`flex items-center justify-center overflow-hidden bg-gradient-to-br from-[#FFF3D6] to-[#FFE6B3] ${className}`}
      >
        <span className="text-[26px] leading-none">🧋</span>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={style === 'sketch' ? '/goods-sketch/mt-milk-tea.webp' : '/goods/mt-milk-tea.webp'}
      alt=""
      draggable={false}
      className={`object-cover ${className}`}
    />
  );
}

/** 商品图片样式选择弹层（底部 sheet；accent=强调色随宿主 App：淘宝橙 / 美团黄红） */
export function GoodsStyleSheet({ onClose, accent = '#FF5000' }: { onClose: () => void; accent?: string }) {
  const goodsImgStyle = useSettings((s) => s.goodsImgStyle);
  const setGoodsImgStyle = useSettings((s) => s.setGoodsImgStyle);
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" onClick={onClose}>
      <div
        className="rounded-t-2xl bg-white [animation:quick-in-up_.26s_cubic-bezier(0.32,0.72,0,1)_both]"
        onClick={(e) => e.stopPropagation()}
        data-testid="goods-style-sheet"
        role="dialog"
        aria-label="商品图片样式"
      >
        <div className="relative flex items-center justify-center pb-3 pt-5">
          <span className="text-[17px] font-bold text-black/90">商品图片样式</span>
          <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-4 top-5 grid h-7 w-7 place-items-center active:opacity-60">
            <span className="relative block h-[22px] w-[22px]">
              <span className="absolute left-1/2 top-1/2 h-[22px] w-[2px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-black/75" />
              <span className="absolute left-1/2 top-1/2 h-[22px] w-[2px] -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-black/75" />
            </span>
          </button>
        </div>
        <p className="px-5 pb-3 text-[12px] leading-relaxed text-black/40">
          淘宝 / 美团的商品、订单、购物车图片同步生效，点一下立即切换，原卡通图保留可随时切回
        </p>
        <div className="grid grid-cols-3 gap-3 px-4 pb-2">
          {GOODS_STYLE_OPTIONS.map((opt) => {
            const active = goodsImgStyle === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                data-testid={`goods-style-opt-${opt.value}`}
                aria-pressed={active}
                aria-label={`商品图片样式：${opt.name}`}
                onClick={() => {
                  setGoodsImgStyle(opt.value);
                  navigator.vibrate?.(6);
                }}
                className={`relative flex flex-col items-center rounded-2xl px-2 pb-2.5 pt-3 transition-all active:scale-[0.97] ${
                  active ? 'bg-[#FFF1E6] ring-2' : 'bg-[#F7F8FA] ring-1 ring-black/[0.04]'
                }`}
                style={active ? { boxShadow: `0 0 0 2px ${accent}` } : undefined}
              >
                {active ? (
                  <span className="absolute right-1.5 top-1.5 grid h-[18px] w-[18px] place-items-center rounded-full" style={{ backgroundColor: accent }}>
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  </span>
                ) : null}
                <GoodsStyleThumb style={opt.value} className="h-20 w-20 rounded-xl" />
                <span className={`mt-1.5 text-[12px] ${active ? 'font-semibold text-black/85' : 'text-black/60'}`}>{opt.name}</span>
                <span className="mt-0.5 text-[10px] text-black/35">{opt.desc}</span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-center px-4 pb-6 pt-2">
          <button
            type="button"
            data-testid="goods-style-done"
            onClick={onClose}
            className="w-full rounded-full py-2.5 text-[14px] font-semibold text-white active:opacity-85"
            style={{ backgroundColor: accent }}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
