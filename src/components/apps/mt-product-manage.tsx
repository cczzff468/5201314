'use client';

/**
 * 美团「管理商品」页（首页宫格入口，第三十八轮）：
 * 管理自建的商品——列表 / 编辑（跳创建商品页预填原位更新）/ 删除（落库+注销注册表，首页即时消失）。
 * 与首页右上角×删除（第三十七轮）的差别：第三十八轮已按需求去掉卡片上的×，删除统一收口到本页。
 */

import { useState } from 'react';
import { ChevronLeft, PackageOpen, Pencil, Trash2 } from 'lucide-react';
import type { MtMerchant } from '@/lib/ios/meituan-data';
import { mtDeleteProductImg, mtUnregisterCustomMerchant } from '@/lib/ios/meituan-data';
import { mtLoadCustomShops, mtSaveCustomShops, mtUidOf, type MtSession } from '@/lib/ios/meituan-store';
import { FoodImg } from './mt-food-img';

/** 规格选项组单行摘要（小菜：拍黄瓜、花生米；温度：常温、去冰） */
function specSummary(m: MtMerchant): string {
  const gs = m.sections[0]?.dishes[0]?.custom?.optionGroups ?? [];
  return gs.map((g) => `${g.name}：${g.values.join('、')}`).join('；');
}

export function MtProductManagePage({
  session,
  onBack,
  onEdit,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  /** 编辑：把该自建商品带进创建商品页（预填原位更新） */
  onEdit: (m: MtMerchant) => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const [tick, setTick] = useState(0);
  const shops = mtLoadCustomShops(uid);
  void tick;

  const remove = (m: MtMerchant) => {
    mtSaveCustomShops(uid, mtLoadCustomShops(uid).filter((x) => x.id !== m.id));
    mtUnregisterCustomMerchant(m.id);
    // 同步清掉残留的持久化商品图覆盖（商品已删除，覆盖不再有意义，防 kv 无限膨胀）
    const dishId = m.sections[0]?.dishes[0]?.id;
    if (dishId) mtDeleteProductImg(dishId);
    window.dispatchEvent(new CustomEvent('mt-custom-products-changed'));
    setTick((t) => t + 1);
    onToast('商品已删除');
  };

  return (
    <div className="relative flex h-full flex-col bg-[#F4F5F7]">
      {/* 顶栏 */}
      <div className="shrink-0 bg-white px-2 pb-2 pt-[54px]">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/75" />
          </button>
          <span className="text-[17px] font-bold text-black/90">管理商品</span>
          {shops.length > 0 && <span className="ml-1 rounded-full bg-[#FFF3DC] px-2 py-0.5 text-[11px] font-medium text-[#B77900]">共 {shops.length} 件</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-8">
        {shops.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-3 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-white shadow-sm">
              <PackageOpen className="h-7 w-7 text-black/25" strokeWidth={1.6} />
            </span>
            <p className="text-[14px] text-black/50">还没有自建的商品</p>
            <p className="text-[12px] text-black/35">去首页「创建商品」上架第一件吧</p>
          </div>
        ) : (
          <div className="space-y-2">
            {shops.map((m) => {
              const dish = m.sections[0]?.dishes[0];
              const type = dish?.custom?.type || (m.notice?.startsWith('自建商品 · ') ? m.notice.slice('自建商品 · '.length) : '');
              const spec = specSummary(m);
              return (
                <div key={m.id} className="flex gap-3 rounded-xl bg-white p-3" data-testid={`mt-manage-item-${dish?.name ?? m.name}`}>
                  <FoodImg src={dish?.img} emoji={dish?.emoji ?? m.emoji} className="h-[72px] w-[72px] shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-black/85">{dish?.name ?? '未命名商品'}</p>
                      {type ? <span className="shrink-0 rounded-[4px] bg-[#FFF3DC] px-1.5 py-0.5 text-[10px] font-medium text-[#B77900]">{type}</span> : null}
                    </div>
                    <p className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-[16px] font-bold" style={{ color: '#FF6000' }}>
                        ¥{dish ? dish.price.toFixed(2) : '0.00'}
                      </span>
                      {dish?.coupon ? <span className="rounded-[3px] bg-[#FFE8F1] px-1 text-[10px] leading-[1.6] text-[#FF2D7E]">{dish.coupon.name} 减¥{dish.coupon.amount}</span> : null}
                    </p>
                    {spec ? <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-[1.5] text-black/35">{spec}</p> : null}
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        data-testid={`mt-manage-edit-${dish?.name ?? m.name}`}
                        onClick={() => onEdit(m)}
                        className="flex h-8 items-center gap-1 rounded-full border border-[#FFD100] bg-white px-3.5 text-[12.5px] font-medium text-black/75 active:bg-[#FFF8DC]"
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                        编辑
                      </button>
                      <button
                        type="button"
                        data-testid={`mt-manage-del-${dish?.name ?? m.name}`}
                        onClick={() => remove(m)}
                        className="flex h-8 items-center gap-1 rounded-full border border-[#FF4B33]/40 bg-white px-3.5 text-[12.5px] font-medium text-[#FF4B33] active:bg-[#FFF1EE]"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                        删除
                      </button>
                    </div>
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
