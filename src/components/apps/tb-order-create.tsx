'use client';

/**
 * 淘宝「创建订单」页（首页运营位入口）——创建订单就是创建商品（第三十六轮）：
 * 任意类型商品都能创建（服饰/数码/奶茶/充值…自由填写）——
 * 图片可上传（相册文件选择，压缩落库）或用「设置 › 图像生成」配置的模型按自定义提示词生成；
 * 可填 类型 / 优惠券（名称+金额，下单自动抵扣） / 规格选项组（颜色、尺码、手机内存等电商规格，买家可自行选择）；
 * 保存 = 创建「商品」落库（tb-custom-products:<uid>，商品+自建店铺注册进运行时注册表）→ 首页商品流置顶展示；
 * 点首页商品走 商品详情→SKU→购物车/立即购买→结算 原生链路，真实下单后才生成订单。
 * 第三十八轮：支持编辑模式（管理订单页入口）——预填表单、保存原位更新（商品/店铺 id 不变，历史订单引用不失效）。
 */

import { useRef, useState } from 'react';
import { ChevronLeft, ImagePlus, Loader2, PackagePlus, Plus, Trash2, Wand2, X } from 'lucide-react';
import { compressImageSrc, generateFreePhoto } from '@/lib/imggen';
import type { ImgGenConfig } from '@/lib/ios/store';
import type { OrderCustomMeta, OrderCustomOptionGroup } from '@/lib/ios/order-custom';
import type { TbProduct, TbShop } from '@/lib/ios/taobao-data';
import { tbRegisterCustomProduct } from '@/lib/ios/taobao-data';
import { tbLoadCustomProducts, tbSaveCustomProducts, type TbCustomEntry } from '@/lib/ios/taobao-store';
import { OrderImgGenSheet } from './order-img-gen';

/** 类型快捷选项（淘宝端独立：纯电商类目，不混餐饮/生活服务） */
const TYPE_CHIPS = ['服饰鞋包', '手机数码', '食品饮料', '美妆个护', '运动户外', '家居日用', '图书文娱', '虚拟充值', '其他'];
/** 规格组名快捷选项（淘宝端独立：电商规格，奶茶小料/杯型等餐饮规格不出现） */
const GROUP_CHIPS = ['颜色', '尺码', '手机内存', '容量', '版本', '配置', '款式', '套装'];

/** 类型 → 商品类目（商品详情/搜索链路用；不在表内归 home） */
function catOfType(t: string): TbProduct['cat'] {
  if (/服饰|鞋|包|装/.test(t)) return 'fashion';
  if (/手机|数码|电子|电脑/.test(t)) return 'digital';
  if (/食品|饮料|奶茶|外卖|生鲜|果蔬|零食/.test(t)) return 'food';
  if (/美妆|个护|护肤|化妆/.test(t)) return 'beauty';
  if (/图书|文娱|文具/.test(t)) return 'book';
  return 'home';
}

/** 类型 → 主图品类词（无自图时 tbImg 兑底展示用） */
function tagOfType(t: string): string {
  if (/手机|数码|电子/.test(t)) return 'phone';
  if (/耳机|音响/.test(t)) return 'earbuds';
  if (/电脑|笔记本/.test(t)) return 'laptop';
  if (/服饰|衣|鞋|包|装/.test(t)) return 'jacket';
  if (/奶茶|茶|饮/.test(t)) return 'milk-tea';
  if (/零食|食品|吃/.test(t)) return 'snacks';
  if (/美妆|护肤|口红/.test(t)) return 'lipstick';
  if (/家具|家居|沙发|床/.test(t)) return 'sofa';
  return 'goods';
}

const fmtMoney = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** 编辑模式预填：从自建商品条目还原表单初始值（规格组优先用 custom 快照，其次映射 skus） */
function prefillFrom(editing: TbCustomEntry) {
  const { p } = editing;
  const groups: OrderCustomOptionGroup[] =
    p.custom?.optionGroups?.map((g) => ({ name: g.name, values: [...g.values] })) ??
    p.skus?.map((g) => ({ name: g.name, values: g.options.map((o) => o.label) })) ??
    [];
  return {
    img: p.img ?? null,
    itemName: p.title,
    type: p.custom?.type ?? '',
    shopName: editing.shop.name,
    price: String(p.price),
    couponName: p.custom?.couponLabel ?? '',
    couponAmt: p.coupon ? String(p.coupon.amount) : '',
    groups,
  };
}

export function TbOrderCreatePage({
  uid,
  onBack,
  onSaved,
  onToast,
  editing,
}: {
  uid: string;
  onBack: () => void;
  /** 保存成功（新商品上首页 / 编辑后回管理页） */
  onSaved: () => void;
  onToast: (m: string) => void;
  /** 编辑模式：传入要编辑的自建商品条目（管理订单页入口）；不传 = 新建 */
  editing?: TbCustomEntry | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pre = editing ? prefillFrom(editing) : null;
  const [img, setImg] = useState<string | null>(pre?.img ?? null);
  const [imgBusy, setImgBusy] = useState(false);
  const [itemName, setItemName] = useState(pre?.itemName ?? '');
  const [type, setType] = useState(pre?.type ?? '');
  const [shopName, setShopName] = useState(pre?.shopName ?? '');
  const [price, setPrice] = useState(pre?.price ?? '');
  const [couponName, setCouponName] = useState(pre?.couponName ?? '');
  const [couponAmt, setCouponAmt] = useState(pre?.couponAmt ?? '');
  const [groups, setGroups] = useState<OrderCustomOptionGroup[]>(pre?.groups ?? []);
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
    const shop = shopName.trim();
    const p = parseFloat(price);
    if (!name) {
      onToast('请填写商品名称');
      return;
    }
    if (!shop) {
      onToast('请填写店铺名称');
      return;
    }
    if (!Number.isFinite(p) || p <= 0) {
      onToast('请填写正确的单价');
      return;
    }
    // 编辑模式：沿用原商品/店铺 id（历史订单、购物车引用不失效），仅更新字段
    if (editing) {
      const discount = Math.round(cut * 100) / 100;
      const okGroups = groups.filter((g) => g.name.trim() && g.values.length > 0);
      const custom: OrderCustomMeta = {
        ...(type.trim() ? { type: type.trim() } : {}),
        ...(couponName.trim() && discount > 0 ? { couponLabel: couponName.trim() } : {}),
        ...(okGroups.length > 0 ? { optionGroups: okGroups } : {}),
      };
      const product: TbProduct = {
        ...editing.p,
        title: name,
        price: Math.round(p * 100) / 100,
        cat: catOfType(type.trim() || '其他'),
        tag: tagOfType(type.trim() || '其他'),
        skus: okGroups.map((g) => ({ name: g.name.trim(), options: g.values.map((v) => ({ label: v })) })),
        ...(couponName.trim() && discount > 0 ? { coupon: { amount: discount, min: 0 } } : { coupon: undefined }),
        ...(img ? { img } : { img: undefined }),
        ...(Object.keys(custom).length > 0 ? { custom } : { custom: undefined }),
      };
      const shopObj: TbShop = { ...editing.shop, name: shop };
      // 原位替换落库 + 重注册（同 id 覆盖）→ 首页/详情/管理页即时生效
      const list = tbLoadCustomProducts(uid).map((e) => (e.p.id === editing.p.id ? { p: product, shop: shopObj } : e));
      tbSaveCustomProducts(uid, list);
      tbRegisterCustomProduct(product, shopObj);
      window.dispatchEvent(new CustomEvent('tb-custom-products-changed'));
      onToast('商品已更新');
      onSaved();
      return;
    }
    const now = Date.now();
    const r = Math.floor(Math.random() * 1e4).toString(36);
    const discount = Math.round(cut * 100) / 100;
    const okGroups = groups.filter((g) => g.name.trim() && g.values.length > 0);
    const custom: OrderCustomMeta = {
      ...(type.trim() ? { type: type.trim() } : {}),
      ...(couponName.trim() && discount > 0 ? { couponLabel: couponName.trim() } : {}),
      ...(okGroups.length > 0 ? { optionGroups: okGroups } : {}),
    };
    const shopId = `tbc-s-${now.toString(36)}${r}`;
    const pid = `tbc-p-${now.toString(36)}${r}`;
    const shopObj: TbShop = {
      id: shopId,
      name: shop,
      tmall: false,
      rating: 4.8,
      fans: '128',
      tag: 'store',
      desc: '自建商品店铺',
    };
    const product: TbProduct = {
      id: pid,
      title: name,
      price: Math.round(p * 100) / 100,
      sales: 35 + (now % 900),
      shopId,
      cat: catOfType(type.trim() || '其他'),
      tag: tagOfType(type.trim() || '其他'),
      freight: 0,
      tags: ['退货宝', '假一赔四'],
      // 规格选项组 → 购买弹窗买家可选 SKU（颜色/内存/尺码/小料…）
      skus: okGroups.map((g) => ({ name: g.name.trim(), options: g.values.map((v) => ({ label: v })) })),
      // 优惠券：下单自动抵扣（与创建时填的名称/金额一致）
      ...(couponName.trim() && discount > 0 ? { coupon: { amount: discount, min: 0 } } : {}),
      ...(img ? { img } : {}),
      ...(Object.keys(custom).length > 0 ? { custom } : {}),
    };
    // 落库（按账号隔离）+ 注册进运行时注册表 → 首页「我的商品」区立即展示
    const entry: TbCustomEntry = { p: product, shop: shopObj };
    tbSaveCustomProducts(uid, [entry, ...tbLoadCustomProducts(uid)]);
    window.dispatchEvent(new CustomEvent('tb-custom-products-changed'));
    onToast('商品已创建，已显示在首页');
    onSaved();
  };

  return (
    <div className="relative flex h-full flex-col bg-[#f4f4f4]">
      {/* 顶栏 */}
      <div className="shrink-0 bg-white px-2 pb-2 pt-[54px]">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/75" />
          </button>
          <span className="text-[17px] font-bold text-black/90">{editing ? '编辑商品' : '创建订单'}</span>
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
                data-testid="tb-create-upload"
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
                data-testid="tb-create-gen"
                onClick={() => setGenOpen(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] py-2 text-[13px] font-medium text-white active:opacity-85"
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
              placeholder="如：iPhone 16 256G / 卫衣"
              data-testid="tb-create-name"
              className="h-10 w-full rounded-lg bg-[#F5F6F7] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/30"
            />
          </Field>
          <Field label="类型" required>
            <input
              value={type}
              onChange={(e) => setType(e.target.value)}
              maxLength={12}
              placeholder="自由填写，如 手机数码 / 服饰鞋包"
              data-testid="tb-create-type"
              className="h-10 w-full rounded-lg bg-[#F5F6F7] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/30"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TYPE_CHIPS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`rounded-full px-2.5 py-1 text-[11.5px] ${type === t ? 'bg-gradient-to-r from-[#FF7A21] to-[#FF4400] font-medium text-white' : 'bg-[#F5F6F7] text-black/55'}`}
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
              data-testid="tb-create-price"
              className="h-10 w-full rounded-lg bg-[#F5F6F7] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/30"
            />
          </Field>
          <Field label="店铺名称" required>
            <input
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              maxLength={20}
              placeholder="如：Apple产品官方旗舰店"
              data-testid="tb-create-shop"
              className="h-10 w-full rounded-lg bg-[#F5F6F7] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/30"
            />
          </Field>
        </div>

        {/* 规格选项组 */}
        <div className="mt-2.5 rounded-xl bg-white px-4 py-4">
          <div className="flex items-center">
            <p className="text-[15px] font-bold text-black/85">规格选项</p>
            <span className="ml-1.5 text-[11px] text-black/35">颜色 / 尺码 / 手机内存 等自由组合</span>
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
                placeholder="选项用、分隔，如：128G、256G、512G"
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

        {/* 优惠券 */}
        <div className="mt-2.5 rounded-xl bg-white px-4 py-4">
          <p className="text-[15px] font-bold text-black/85">优惠券</p>
          <Field label="优惠券名称">
            <input
              value={couponName}
              onChange={(e) => setCouponName(e.target.value)}
              maxLength={16}
              placeholder="如：天猫双11立减券"
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

      {/* 底部单价 + 保存 */}
      <div className="shrink-0 border-t border-black/5 bg-white px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-[13px] text-black/45">
            单价 <span className="text-[20px] font-bold text-black/90">¥{fmtMoney(parseFloat(price) || 0)}</span>
            {cut > 0 && <span className="ml-1.5 text-[11.5px] text-[#FF4400]">下单抵 ¥{fmtMoney(cut)}</span>}
          </span>
          <button
            type="button"
            data-testid="tb-create-save"
            onClick={save}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-7 text-[15px] font-semibold text-white active:opacity-85"
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
        initialPrompt={itemName.trim() ? `${itemName.trim()}${type.trim() ? `（${type.trim()}）` : ''} 电商商品白底图` : ''}
        busy={genBusy}
        error={genErr}
        accent="#FF4400"
        submitLabel="生成图片"
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
