'use client';

/**
 * 美团「创建商品」页（首页宫格入口）——创建的是商品（不是店铺，第三十九轮明确）：
 * 任意类型商品都能创建（奶茶/外卖/团购/充值/电影票…自由填写）——
 * 图片可上传（相册文件选择，压缩落库）或用「设置 › 图像生成」配置的模型按自定义提示词生成；
 * 可填 类型 / 优惠券（名称+金额，下单自动抵扣的菜品券） / 规格选项组（小菜、奶茶小料、温度糖度等餐饮规格，买家可自行选择）；
 * 保存 = 创建「商品」落库（mt-custom-shops:<uid>，无店铺语义）→ 首页商品流置顶展示；
 * 点首页商品走 自建商品详情页→立即购买 原生链路（不再进店铺页），真实下单后才生成订单。
 * 第三十九轮：删头部「创建商品·上首页」标签/店铺名称/备注，与淘宝创建页各自独立。
 */

import { useRef, useState } from 'react';
import { ChevronLeft, ImagePlus, Loader2, PackagePlus, Plus, Trash2, Wand2, X } from 'lucide-react';
import { compressImageSrc, generateFreePhoto } from '@/lib/imggen';
import type { ImgGenConfig } from '@/lib/ios/store';
import type { OrderCustomOptionGroup, OrderCustomMeta } from '@/lib/ios/order-custom';
import type { MtDish, MtMerchant } from '@/lib/ios/meituan-data';
import { mtRegisterCustomMerchant } from '@/lib/ios/meituan-data';
import { mtLoadCustomShops, mtSaveCustomShops, mtUidOf, type MtSession } from '@/lib/ios/meituan-store';
import { OrderImgGenSheet } from './order-img-gen';

/** 类型快捷选项（美团端独立：纯生活服务/到店到家，不混电商类目） */
const TYPE_CHIPS = ['外卖', '奶茶甜饮', '甜点蛋糕', '团购', '电影票', '充值缴费', '生鲜果蔬', '日用百货', '其他'];
/** 规格组名快捷选项（美团端独立：餐饮规格，手机内存/颜色等电商规格不出现） */
const GROUP_CHIPS = ['小菜', '奶茶小料', '杯型', '温度', '糖度', '辣度', '份量', '套餐'];

const fmtMoney = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** 编辑模式预填：从自建商家对象还原表单初始值（规格组优先用 custom 快照，其次映射 specs） */
function prefillFrom(editing: MtMerchant) {
  const dish = editing.sections[0]?.dishes[0];
  const typeFromNotice = editing.notice?.startsWith('自建商品 · ') ? editing.notice.slice('自建商品 · '.length) : '';
  const groups: OrderCustomOptionGroup[] =
    dish?.custom?.optionGroups?.map((g) => ({ name: g.name, values: [...g.values] })) ??
    dish?.specs?.map((g) => ({ name: g.name, values: g.options.map((o) => o.label) })) ??
    [];
  return {
    img: dish?.img ?? null,
    itemName: dish?.name ?? '',
    type: dish?.custom?.type || typeFromNotice,
    price: dish ? String(dish.price) : '',
    couponName: dish?.custom?.couponLabel ?? '',
    couponAmt: dish?.coupon ? String(dish.coupon.amount) : '',
    groups,
  };
}

export function MtOrderCreatePage({
  session,
  onBack,
  onSaved,
  onToast,
  editing,
}: {
  session: MtSession;
  onBack: () => void;
  /** 保存成功（新商品上首页 / 编辑后回管理页） */
  onSaved: () => void;
  onToast: (m: string) => void;
  /** 编辑模式：传入要编辑的自建商品（管理商品页入口）；不传 = 新建 */
  editing?: MtMerchant | null;
}) {
  const uid = mtUidOf(session);
  const fileRef = useRef<HTMLInputElement>(null);
  const pre = editing ? prefillFrom(editing) : null;
  // 图片（dataURL）
  const [img, setImg] = useState<string | null>(pre?.img ?? null);
  const [imgBusy, setImgBusy] = useState(false);
  // 表单（第三十九轮：无店铺名称/备注——创建的是商品，不是店铺）
  const [itemName, setItemName] = useState(pre?.itemName ?? '');
  const [type, setType] = useState(pre?.type ?? '');
  const [price, setPrice] = useState(pre?.price ?? '');
  const [couponName, setCouponName] = useState(pre?.couponName ?? '');
  const [couponAmt, setCouponAmt] = useState(pre?.couponAmt ?? '');
  const [groups, setGroups] = useState<OrderCustomOptionGroup[]>(pre?.groups ?? []);
  // 生图弹层
  const [genOpen, setGenOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genErr, setGenErr] = useState('');

  const cut = Math.min(parseFloat(couponAmt) || 0, parseFloat(price) || 0);

  const pickFile = async (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      onToast('请选择图片文件');
      return;
    }
    setImgBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error('读取失败'));
        fr.readAsDataURL(f);
      });
      const src = await compressImageSrc(dataUrl, 640, 0.88);
      setImg(src);
    } catch {
      onToast('图片读取失败，请重试');
    } finally {
      setImgBusy(false);
    }
  };

  const genImage = async (prompt: string, cfg: ImgGenConfig & { mode?: 'proxy' | 'direct' }) => {
    setGenBusy(true);
    setGenErr('');
    try {
      const src = await generateFreePhoto(cfg, prompt);
      setImg(src);
      setGenOpen(false);
      onToast('图片已生成');
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : '生成失败，请重试');
    } finally {
      setGenBusy(false);
    }
  };

  const setGroup = (i: number, patch: Partial<OrderCustomOptionGroup>) => {
    setGroups((gs) => gs.map((g, gi) => (gi === i ? { ...g, ...patch } : g)));
  };

  const save = () => {
    const name = itemName.trim();
    const p = parseFloat(price);
    if (!name) {
      onToast('请填写商品名称');
      return;
    }
    if (!Number.isFinite(p) || p <= 0) {
      onToast('请填写正确的单价');
      return;
    }
    // 编辑模式：沿用原商家/菜品 id（历史订单、购物车引用不失效），仅更新字段；店铺名随商品名（第三十九轮：无店铺语义）
    if (editing) {
      const price2 = Math.round(p * 100) / 100;
      const discount = Math.round(cut * 100) / 100;
      const isMulti = (g: string) => /小菜|小料|配菜|加料|加购|配菜/.test(g);
      const specs: MtDish['specs'] =
        groups.length > 0
          ? groups
              .filter((g) => g.name.trim() && g.values.length > 0)
              .map((g) => ({
                name: g.name.trim(),
                ...(isMulti(g.name) ? { multi: true, max: Math.max(1, g.values.length) } : {}),
                options: g.values.map((v) => ({ label: v })),
              }))
          : undefined;
      const custom: OrderCustomMeta = {
        ...(type.trim() ? { type: type.trim() } : {}),
        ...(couponName.trim() && discount > 0 ? { couponLabel: couponName.trim() } : {}),
        ...(groups.length > 0 ? { optionGroups: groups.filter((g) => g.name.trim() && g.values.length > 0) } : {}),
      };
      const oldDish = editing.sections[0]?.dishes[0];
      const dish: MtDish = {
        id: oldDish?.id ?? `mtc-dish-${Date.now().toString(36)}`,
        name,
        price: price2,
        emoji: '🛍️',
        ...(img ? { img } : {}),
        monthSale: oldDish?.monthSale ?? 23,
        ...(specs && specs.length > 0 ? { specs } : {}),
        ...(couponName.trim() && discount > 0 ? { coupon: { name: couponName.trim(), amount: discount, min: 0 } } : {}),
        ...(Object.keys(custom).length > 0 ? { custom } : {}),
      };
      const merchant: MtMerchant = {
        ...editing,
        name,
        ...(img ? { cover: img } : {}),
        notice: type.trim() ? `自建商品 · ${type.trim()}` : '自建商品店铺',
        sections: [{ cat: '我的商品', dishes: [dish] }],
      };
      // 原位替换落库 + 重注册（同 id 覆盖）→ 首页/详情/管理页即时生效
      mtSaveCustomShops(uid, mtLoadCustomShops(uid).map((m) => (m.id === editing.id ? merchant : m)));
      mtRegisterCustomMerchant(merchant);
      window.dispatchEvent(new CustomEvent('mt-custom-products-changed'));
      onToast('商品已更新');
      onSaved();
      return;
    }
    const now = Date.now();
    const r = Math.floor(Math.random() * 1e4).toString(36);
    const shopId = `mtc-shop-${now.toString(36)}${r}`;
    const dishId = `mtc-dish-${now.toString(36)}${r}`;
    const price2 = Math.round(p * 100) / 100;
    const discount = Math.round(cut * 100) / 100;
    // 规格选项组 → 买家可选的规格弹窗（小菜/小料类多选，其余单选）；同时快照 custom 元数据随订单展示
    const isMulti = (g: string) => /小菜|小料|配菜|加料|加购|配菜/.test(g);
    const specs: MtDish['specs'] =
      groups.length > 0
        ? groups
            .filter((g) => g.name.trim() && g.values.length > 0)
            .map((g) => ({
              name: g.name.trim(),
              ...(isMulti(g.name) ? { multi: true, max: Math.max(1, g.values.length) } : {}),
              options: g.values.map((v) => ({ label: v })),
            }))
        : undefined;
    const custom: OrderCustomMeta = {
      ...(type.trim() ? { type: type.trim() } : {}),
      ...(couponName.trim() && discount > 0 ? { couponLabel: couponName.trim() } : {}),
      ...(groups.length > 0 ? { optionGroups: groups.filter((g) => g.name.trim() && g.values.length > 0) } : {}),
    };
    const dish: MtDish = {
      id: dishId,
      name,
      price: price2,
      emoji: '🛍️',
      ...(img ? { img } : {}),
      monthSale: 23,
      ...(specs && specs.length > 0 ? { specs } : {}),
      // 优惠券 = 菜品券：下单含此菜自动抵扣（无门槛），与创建时填的名称/金额一致
      ...(couponName.trim() && discount > 0 ? { coupon: { name: couponName.trim(), amount: discount, min: 0 } } : {}),
      ...(Object.keys(custom).length > 0 ? { custom } : {}),
    };
    // 第三十九轮：创建的是商品不是店铺——商家名=商品名（卡片标题/详情/结算显示用），无独立店铺字段
    const merchant: MtMerchant = {
      id: shopId,
      name,
      emoji: '🛍️',
      ...(img ? { cover: img } : {}),
      cats: [],
      rating: 4.8,
      monthSale: 23,
      minOrder: 0,
      deliveryFee: 0,
      distanceKm: 0.8,
      deliveryMin: 25,
      notice: type.trim() ? `自建商品 · ${type.trim()}` : '自建商品店铺',
      deals: [],
      hours: '00:00-24:00',
      addr: '线上商品 · 全国包邮',
      sections: [{ cat: '我的商品', dishes: [dish] }],
      reviews: [],
      mtStatus: 'open',
    };
    // 落库（按账号隔离）+ 注册进运行时注册表 → 首页「我的商品」区立即展示
    mtSaveCustomShops(uid, [...mtLoadCustomShops(uid), merchant]);
    mtRegisterCustomMerchant(merchant);
    window.dispatchEvent(new CustomEvent('mt-custom-products-changed'));
    onToast('商品已创建，已显示在首页');
    onSaved();
  };

  return (
    <div className="relative flex h-full flex-col bg-[#F4F5F7]">
      {/* 顶栏 */}
      <div className="shrink-0 bg-white px-2 pb-2 pt-[54px]">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/75" />
          </button>
          <span className="text-[17px] font-bold text-black/90">{editing ? '编辑商品' : '创建商品'}</span>
          {/* 第三十九轮：按需求删除「创建商品·上首页」/「修改后原位更新」标签 */}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-6">
        {/* 图片卡 */}
        <div className="rounded-xl bg-white p-4">
          <p className="text-[15px] font-bold text-black/85">商品图片</p>
          <div className="mt-2.5 flex items-center gap-3">
            {img ? (
              <span className="relative block h-[84px] w-[84px] overflow-hidden rounded-lg bg-[#F5F6F7]">
                                <img src={img} alt="商品图片" className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label="移除图片"
                  onClick={() => setImg(null)}
                  className="absolute right-1 top-1 grid h-[22px] w-[22px] place-items-center rounded-full bg-black/55 text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                data-testid="mt-create-upload"
                onClick={() => fileRef.current?.click()}
                className="grid h-[84px] w-[84px] place-items-center rounded-lg border border-dashed border-black/20 bg-[#FAFAFA] text-black/35 active:bg-black/[0.04]"
              >
                {imgBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-6 w-6" strokeWidth={1.8} />}
              </button>
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center justify-center gap-1.5 rounded-full border border-black/12 bg-white py-2 text-[13px] text-black/70 active:bg-black/[0.04]"
              >
                <ImagePlus className="h-4 w-4" strokeWidth={1.9} />
                上传图片
              </button>
              <button
                type="button"
                data-testid="mt-create-gen"
                onClick={() => setGenOpen(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-full bg-[#FFD100] py-2 text-[13px] font-medium text-black/85 active:opacity-85"
              >
                <Wand2 className="h-4 w-4" strokeWidth={2} />
                AI 生成图片
              </button>
              <p className="text-[10.5px] leading-[1.5] text-black/35">上传本机图片，或用 设置 › 图像生成 的模型按提示词生成</p>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>

        {/* 基本信息 */}
        <div className="mt-2.5 rounded-xl bg-white px-4 py-4">
          <p className="text-[15px] font-bold text-black/85">基本信息</p>
          <Field label="商品名称" required>
            <input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              maxLength={30}
              placeholder="如：厚芋泥波波奶茶 / 鲜榨西瓜汁"
              data-testid="mt-create-name"
              className="h-10 w-full rounded-lg bg-[#F5F6F7] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/30"
            />
          </Field>
          <Field label="类型" required>
            <input
              value={type}
              onChange={(e) => setType(e.target.value)}
              maxLength={12}
              placeholder="自由填写，如 外卖 / 奶茶甜饮"
              data-testid="mt-create-type"
              className="h-10 w-full rounded-lg bg-[#F5F6F7] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/30"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TYPE_CHIPS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`rounded-full px-2.5 py-1 text-[11.5px] ${type === t ? 'bg-[#FFD100] font-medium text-black/85' : 'bg-[#F5F6F7] text-black/55'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </Field>
          <Field label="单价（¥）" required>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              placeholder="0.00"
              data-testid="mt-create-price"
              className="h-10 w-full rounded-lg bg-[#F5F6F7] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/30"
            />
          </Field>
        </div>

        {/* 规格选项组 */}
        <div className="mt-2.5 rounded-xl bg-white px-4 py-4">
          <div className="flex items-center">
            <p className="text-[15px] font-bold text-black/85">规格选项</p>
            <span className="ml-1.5 text-[11px] text-black/35">小菜 / 奶茶小料 / 温度糖度 等自由组合</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {GROUP_CHIPS.filter((g) => !groups.some((x) => x.name === g)).map((g) => (
              <button key={g} type="button" onClick={() => setGroups((gs) => [...gs, { name: g, values: [] }])} className="rounded-full border border-dashed border-black/20 px-2.5 py-1 text-[11.5px] text-black/55 active:bg-black/[0.04]">
                + {g}
              </button>
            ))}
          </div>
          {groups.map((g, i) => (
            <div key={i} className="mt-3 rounded-lg bg-[#FAFAFA] p-2.5">
              <div className="flex items-center gap-2">
                <input
                  value={g.name}
                  onChange={(e) => setGroup(i, { name: e.target.value })}
                  maxLength={8}
                  placeholder="组名"
                  className="h-8 w-[96px] rounded-md border border-black/10 bg-white px-2 text-[12.5px] text-black/85 outline-none placeholder:text-black/30"
                />
                <button type="button" aria-label="删除该组" onClick={() => setGroups((gs) => gs.filter((_, gi) => gi !== i))} className="ml-auto grid h-7 w-7 place-items-center rounded-full text-black/35 active:bg-black/5">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <input
                value={g.values.join('、')}
                onChange={(e) => setGroup(i, { values: e.target.value.split(/[、,，]/).map((v) => v.trim()).filter(Boolean) })}
                placeholder="选项用、分隔，如：珍珠、椰果、芋圆"
                className="mt-2 h-9 w-full rounded-md border border-black/10 bg-white px-2 text-[12.5px] text-black/85 outline-none placeholder:text-black/30"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setGroups((gs) => [...gs, { name: '', values: [] }])}
            className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-black/15 py-2 text-[12.5px] text-black/45 active:bg-black/[0.03]"
          >
            <Plus className="h-3.5 w-3.5" />
            添加选项组
          </button>
        </div>

        {/* 优惠券（第三十九轮：备注已按需求删除——创建商品不需要备注） */}
        <div className="mt-2.5 rounded-xl bg-white px-4 py-4">
          <p className="text-[15px] font-bold text-black/85">优惠券</p>
          <Field label="优惠券名称">
            <input
              value={couponName}
              onChange={(e) => setCouponName(e.target.value)}
              maxLength={16}
              placeholder="如：神券节满减券"
              className="h-10 w-full rounded-lg bg-[#F5F6F7] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/30"
            />
          </Field>
          <Field label="优惠金额（¥）">
            <input
              value={couponAmt}
              onChange={(e) => setCouponAmt(e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              placeholder="0.00"
              className="h-10 w-full rounded-lg bg-[#F5F6F7] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/30"
            />
          </Field>
        </div>
      </div>

      {/* 底部合计 + 保存 */}
      <div className="shrink-0 border-t border-black/5 bg-white px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-[13px] text-black/45">
            单价 <span className="text-[20px] font-bold text-black/90">¥{fmtMoney(parseFloat(price) || 0)}</span>
            {cut > 0 && <span className="ml-1.5 text-[11.5px] text-[#FF4B33]">下单抵 ¥{fmtMoney(cut)}</span>}
          </span>
          <button
            type="button"
            data-testid="mt-create-save"
            onClick={save}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-[#FFC300] to-[#FF9500] px-7 text-[15px] font-semibold text-black/90 active:opacity-85"
          >
            <PackagePlus className="h-[17px] w-[17px]" strokeWidth={2.1} />
            上架商品
          </button>
        </div>
      </div>

      {/* AI 生图弹层 */}
      <OrderImgGenSheet
        open={genOpen}
        title="AI 生成商品图片"
        initialPrompt={itemName.trim() ? `${itemName.trim()}${type.trim() ? `（${type.trim()}）` : ''} 商品实拍图，干净背景` : ''}
        busy={genBusy}
        error={genErr}
        accent="#FF6000"
        onSubmit={(p, cfg) => void genImage(p, cfg)}
        onClose={() => (genBusy ? undefined : setGenOpen(false))}
      />
    </div>
  );
}

/** 表单行（label 上、控件下的白卡内行） */
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="text-[12.5px] text-black/55">
        {label}
        {required && <span className="ml-0.5 text-[#F53F3F]">*</span>}
      </p>
      {children}
    </div>
  );
}
