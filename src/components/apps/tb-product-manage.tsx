'use client';

/**
 * 淘宝「管理订单」页（首页运营位入口，第三十八轮）——管理自建的商品：
 * 列表 / 编辑（跳创建订单页预填原位更新）/ 删除（落库+注销注册表，首页即时消失）。
 * 第三十八轮已按需求去掉商品卡右上角×，删除统一收口到本页。
 */

import { useState } from 'react';
import { ChevronLeft, PackageOpen, Pencil, Trash2 } from 'lucide-react';
import type { TbCustomEntry } from '@/lib/ios/taobao-store';
import { tbLoadCustomProducts, tbRemoveCustomProduct } from '@/lib/ios/taobao-store';
import { tbDeleteProductImg, tbImg } from '@/lib/ios/taobao-data';
import { TbImg } from './tb-img';

export function TbProductManagePage({
  uid,
  onBack,
  onEdit,
  onToast,
}: {
  uid: string;
  onBack: () => void;
  /** 编辑：把该自建商品带进创建订单页（预填原位更新） */
  onEdit: (e: TbCustomEntry) => void;
  onToast: (m: string) => void;
}) {
  const [tick, setTick] = useState(0);
  const list = tbLoadCustomProducts(uid);
  void tick;

  const remove = (e: TbCustomEntry) => {
    tbRemoveCustomProduct(uid, e.p.id);
    // 同步清掉残留的持久化商品图覆盖（商品已删除，覆盖不再有意义，防 kv 无限膨胀）
    tbDeleteProductImg(e.p.id);
    window.dispatchEvent(new CustomEvent('tb-custom-products-changed'));
    setTick((t) => t + 1);
    onToast('商品已删除');
  };

  return (
    <div className="relative flex h-full flex-col bg-[#f4f4f4]">
      {/* 顶栏 */}
      <div className="shrink-0 bg-white px-2 pb-2 pt-[54px]">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/75" />
          </button>
          <span className="text-[17px] font-bold text-black/90">管理订单</span>
          <span className="ml-1.5 rounded-full bg-[#FFF1E6] px-2 py-0.5 text-[11px] font-medium text-[#FF6A1E]">管理自建的商品</span>
          {list.length > 0 && <span className="ml-auto pr-2 text-[12px] text-black/35">共 {list.length} 件</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-8">
        {list.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-3 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-white shadow-sm">
              <PackageOpen className="h-7 w-7 text-black/25" strokeWidth={1.6} />
            </span>
            <p className="text-[14px] text-black/50">还没有自建的商品</p>
            <p className="text-[12px] text-black/35">去首页「创建订单」上架第一件吧</p>
          </div>
        ) : (
          <div className="space-y-2">
            {list.map((e) => {
              const type = e.p.custom?.type;
              const sku = e.p.skus?.map((g) => `${g.name}：${g.options.map((o) => o.label).join('、')}`).join('；');
              return (
                <div key={e.p.id} className="flex gap-3 rounded-xl bg-white p-3" data-testid={`tb-manage-item-${e.p.title}`}>
                  <TbImg src={e.p.img ?? tbImg(e.p.tag, 240, 240, 0)} alt={e.p.title} className="h-[72px] w-[72px] shrink-0 rounded-lg bg-[#f5f5f5] object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-black/85">{e.p.title}</p>
                      {type ? <span className="shrink-0 rounded-[4px] bg-[#FFF1E6] px-1.5 py-0.5 text-[10px] font-medium text-[#FF6A1E]">{type}</span> : null}
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-black/40">{e.shop.name}</p>
                    <p className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-[16px] font-bold text-[#FF4400]">¥{e.p.price.toFixed(2)}</span>
                      {e.p.coupon ? <span className="rounded-[3px] bg-[#FFF1E6] px-1 text-[10px] leading-[1.6] text-[#FF4400]">下单减¥{e.p.coupon.amount}</span> : null}
                    </p>
                    {sku ? <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-[1.5] text-black/35">{sku}</p> : null}
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        data-testid={`tb-manage-edit-${e.p.title}`}
                        onClick={() => onEdit(e)}
                        className="flex h-8 items-center gap-1 rounded-full border border-[#FF7A21]/60 bg-white px-3.5 text-[12.5px] font-medium text-black/75 active:bg-[#FFF6EF]"
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                        编辑
                      </button>
                      <button
                        type="button"
                        data-testid={`tb-manage-del-${e.p.title}`}
                        onClick={() => remove(e)}
                        className="flex h-8 items-center gap-1 rounded-full border border-[#FF4400]/35 bg-white px-3.5 text-[12.5px] font-medium text-[#FF4400] active:bg-[#FFF1EE]"
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
