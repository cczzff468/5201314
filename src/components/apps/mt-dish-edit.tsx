'use client';

/**
 * 添加 / 编辑菜品（独立全屏页，扁平毛玻璃风格，无白色圆角面板）：
 * - 菜品图片（大图上传位）、基本信息（名称/价格/一句话描述），字段直接铺在暖色渐变底上；
 * - 快捷规格模板：奶茶模板（杯型定价+温度+小料+糖度）/ 小菜模板（多选加价），
 *   图标全部使用 Lucide 线条图标（无 emoji）；
 * - 规格组管理：长按呼出「编辑 / 删除」毛玻璃操作弹层（行上不再放按钮）；
 *   规格组编辑弹层（毛玻璃）：选项行 = 编号 + 名称输入（自适应宽度）+ ¥ + 加价输入；
 * - 菜品优惠券：每道菜可设一张（满 X 减 Y，0 = 无门槛），下单含此菜自动抵扣；
 * - 编辑态支持删除菜品（二次确认按钮态）；保存回调给宿主页面持久化。
 */
import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BadgePercent,
  ChevronLeft,
  CupSoda,
  ImagePlus,
  Plus,
  Ticket,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { mtAutoEmoji, type MtDish, type MtDishCouponDef, type MtDishSpec } from '@/lib/ios/meituan-data';
import { readImageFile } from './wechat';
import { GLASS_CAPSULE, HoldActionsSheet, MERCHANT_PAGE_BG, useLongPress, type HoldAction } from './mt-merchant-ui';

const MT_YELLOW = '#FFD100';
const MT_PRICE = '#FF4B33';

const num = (s: string): number => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
};
const money = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** 毛玻璃输入胶囊（独立页通用） */
const glassInput =
  'h-11 w-full rounded-2xl bg-white/62 px-3.5 text-[14px] text-black/85 outline-none backdrop-blur-xl ring-1 ring-white/80 placeholder:text-black/25 focus:bg-white/90 focus:ring-[#FFD100]';

/** 奶茶模板：杯型定价 + 温度 + 小料（多选加价）+ 糖度（填充后每项可再编辑） */
function milkTeaTemplate(): MtDishSpec[] {
  return [
    { name: '规格', options: [{ label: '大杯', price: 0 }, { label: '中杯', price: -1 }, { label: '小杯', price: -2 }] },
    { name: '温度', options: [{ label: '正常冰' }, { label: '少冰' }, { label: '常温' }, { label: '温热' }, { label: '热' }] },
    {
      name: '小料',
      multi: true,
      max: 2,
      options: [
        { label: '珍珠', price: 1 },
        { label: '椰果', price: 1 },
        { label: '布丁', price: 2 },
        { label: '脆啵啵', price: 1 },
        { label: '红豆', price: 2 },
        { label: '奶盖', price: 3 },
      ],
    },
    { name: '糖度', options: [{ label: '正常糖' }, { label: '七分糖' }, { label: '五分糖' }, { label: '三分糖' }, { label: '不额外加糖' }] },
  ];
}

/** 小菜模板：多选加价配菜（米饭/小食…） */
function sideDishTemplate(): MtDishSpec[] {
  return [
    {
      name: '小菜',
      multi: true,
      max: 3,
      options: [
        { label: '米饭', price: 2 },
        { label: '鸡蛋', price: 2 },
        { label: '青菜', price: 2 },
        { label: '可乐', price: 3 },
        { label: '辣条', price: 1 },
      ],
    },
  ];
}

// ================================ 规格组编辑弹层（毛玻璃） ================================

interface SpecDraft {
  name: string;
  multi: boolean;
  max: number;
  options: { label: string; price: number }[];
}

/** 选项行输入样式（小号毛玻璃） */
const optInput =
  'h-9 rounded-xl bg-black/[0.045] px-2.5 text-[14px] text-black/85 outline-none placeholder:text-black/25 focus:bg-white focus:ring-1 focus:ring-[#FFD100]';

export function SpecEditSheet({
  initial,
  onClose,
  onDone,
}: {
  initial: SpecDraft | null;
  onClose: () => void;
  onDone: (d: SpecDraft) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [multi, setMulti] = useState(initial?.multi ?? false);
  const [max, setMax] = useState(String(initial?.max ?? 2));
  const [opts, setOpts] = useState<{ label: string; price: string }[]>(
    initial?.options.map((o) => ({ label: o.label, price: o.price ? String(o.price) : '0' })) ?? [{ label: '', price: '0' }]
  );
  const valid = name.trim().length > 0 && opts.some((o) => o.label.trim().length > 0);

  return (
    <motion.div
      key="mt-spec-edit"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[70]"
      data-testid="mt-spec-sheet"
    >
      <button type="button" aria-label="关闭规格组编辑" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
        className="absolute inset-x-0 bottom-0 flex max-h-[88%] flex-col rounded-t-3xl bg-[#FBF9F2]/95 shadow-[0_-16px_50px_rgba(40,30,0,0.2)] backdrop-blur-2xl ring-1 ring-white/70"
      >
        <div className="flex shrink-0 flex-col items-center pt-2.5">
          <span className="h-1 w-9 rounded-full bg-black/10" />
        </div>
        <div className="relative flex shrink-0 items-center justify-center px-4 pb-3 pt-2">
          <p className="text-[16px] font-bold text-black/85">{initial ? '编辑规格组' : '添加规格组'}</p>
          <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-3 grid h-8 w-8 place-items-center rounded-full bg-black/[0.05] active:bg-black/[0.1]">
            <X className="h-4 w-4 text-black/55" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <p className="mb-1.5 text-[12px] text-black/45">组名（如 规格 / 小料 / 小菜 / 辣度）</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：小料" className={glassInput} maxLength={6} />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMulti(false)}
              className={`h-8 rounded-full px-4 text-[13px] backdrop-blur-xl transition-colors ${!multi ? 'font-semibold text-black/85 shadow-[0_4px_14px_rgba(255,190,0,0.4)]' : 'bg-white/60 text-black/50 ring-1 ring-white/70'}`}
              style={multi ? undefined : { background: MT_YELLOW }}
            >
              单选
            </button>
            <button
              type="button"
              onClick={() => setMulti(true)}
              className={`h-8 rounded-full px-4 text-[13px] backdrop-blur-xl transition-colors ${multi ? 'font-semibold text-black/85 shadow-[0_4px_14px_rgba(255,190,0,0.4)]' : 'bg-white/60 text-black/50 ring-1 ring-white/70'}`}
              style={multi ? { background: MT_YELLOW } : undefined}
            >
              多选
            </button>
            {multi && (
              <span className="ml-auto flex items-center gap-1 text-[12px] text-black/45">
                最多选
                <input
                  value={max}
                  onChange={(e) => setMax(e.target.value.replace(/\D/g, '').slice(0, 1))}
                  className="h-7 w-9 rounded-lg bg-white/70 text-center text-[13px] outline-none ring-1 ring-white/80 focus:ring-[#FFD100]"
                  inputMode="numeric"
                />
                份
              </span>
            )}
          </div>
          <p className="mb-1.5 mt-3.5 text-[12px] text-black/45">选项（加价 0 表示不加价，可填负数表示减价）</p>
          <div className="flex flex-col gap-2">
            {opts.map((o, i) => (
              <div key={i} className="flex items-center gap-2 rounded-2xl bg-white/55 p-1.5 backdrop-blur-xl ring-1 ring-white/70">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#FFF3C4] to-[#FFE68F] text-[11px] font-bold text-[#8A6A00]">{i + 1}</span>
                {/* 名称输入：min-w-0 + flex-1 保证自适应宽度、文字可见（修复旧版被压成圆点的问题） */}
                <input
                  value={o.label}
                  onChange={(e) => setOpts((p) => p.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))}
                  placeholder={`选项 ${i + 1}（如 大杯 / 珍珠）`}
                  className={`${optInput} w-auto min-w-0 flex-1`}
                  maxLength={10}
                />
                <span className="shrink-0 text-[13px] font-medium" style={{ color: MT_PRICE }}>¥</span>
                <input
                  value={o.price}
                  onChange={(e) => setOpts((p) => p.map((x, k) => (k === i ? { ...x, price: e.target.value.replace(/[^\d.-]/g, '') } : x)))}
                  className={`${optInput} w-[58px] shrink-0 text-center`}
                  style={{ minWidth: 58 }}
                  inputMode="decimal"
                  aria-label={`选项${i + 1}加价`}
                />
                {opts.length > 1 && (
                  <button type="button" aria-label="删除选项" onClick={() => setOpts((p) => p.filter((_, k) => k !== i))} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-black/35 active:bg-black/5">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOpts((p) => [...p, { label: '', price: '0' }])}
            className="mt-2.5 flex h-10 w-full items-center justify-center gap-1 rounded-2xl border border-dashed border-black/15 bg-white/40 text-[13px] text-black/50 active:bg-white/70"
          >
            <Plus className="h-4 w-4" />
            加选项
          </button>
        </div>
        <div className="shrink-0 bg-gradient-to-t from-white/90 to-white/60 p-4 pb-7 backdrop-blur-xl">
          <button
            type="button"
            disabled={!valid}
            data-testid="mt-spec-done"
            onClick={() => {
              const maxN = Math.max(1, parseInt(max || '2', 10) || 2);
              onDone({
                name: name.trim(),
                multi,
                max: multi ? maxN : 1,
                options: opts
                  .filter((o) => o.label.trim())
                  .map((o) => ({ label: o.label.trim(), price: num(o.price) })),
              });
            }}
            className={`h-12 w-full rounded-full text-[15px] font-bold ${valid ? 'text-black/85 shadow-[0_8px_22px_rgba(255,190,0,0.45)] active:opacity-85' : 'opacity-40'}`}
            style={{ background: MT_YELLOW }}
          >
            完成
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ================================ 规格组行（长按编辑/删除） ================================

function SpecRow({
  spec,
  index,
  onHold,
}: {
  spec: MtDishSpec;
  index: number;
  onHold: (i: number) => void;
}) {
  const hold = useLongPress(() => onHold(index));
  const { pressing, ...holdProps } = hold;
  return (
    <div
      {...holdProps}
      data-testid={`mt-spec-row-${spec.name}`}
      className={`flex items-center gap-2.5 rounded-2xl bg-white/58 px-3.5 py-2.5 backdrop-blur-xl ring-1 ring-white/75 transition-all ${pressing ? 'scale-[0.985] bg-white/80 shadow-inner' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-black/80">
          {spec.name}
          <span className="rounded bg-[#FFF3C4] px-1 py-px text-[9px] font-normal text-[#8A6A00]">{spec.multi ? `多选 · 最多${spec.max ?? 1}份` : '单选'}</span>
        </p>
        <p className="mt-0.5 truncate text-[11px] text-black/40">{spec.options.map((o) => `${o.label}${o.price ? `+${money(o.price)}` : ''}`).join(' / ')}</p>
      </div>
      <span className="shrink-0 text-[10px] text-black/25">长按编辑</span>
    </div>
  );
}

// ================================ 菜品编辑（全屏页） ================================

export default function DishEditPage({
  catName,
  initial,
  onBack,
  onSave,
  onDelete,
}: {
  /** 所属分区名 */
  catName: string;
  initial: MtDish | null;
  onBack: () => void;
  onSave: (d: MtDish) => void;
  /** 仅编辑态传入：删除该菜品 */
  onDelete?: (d: MtDish) => void;
}) {
  const [dName, setDName] = useState(initial?.name ?? '');
  const [dPrice, setDPrice] = useState(initial ? money(initial.price) : '');
  const [dImg, setDImg] = useState<string | undefined>(initial?.img);
  const [dDesc, setDDesc] = useState(initial?.desc ?? '');
  const [dSoldOut, setDSoldOut] = useState(initial?.soldOut ?? false);
  const [dSpecs, setDSpecs] = useState<MtDishSpec[]>(initial?.specs ?? []);
  const [dCoupon, setDCoupon] = useState<MtDishCouponDef | null>(initial?.coupon ?? null);
  const [cpName, setCpName] = useState('');
  const [cpMin, setCpMin] = useState('');
  const [cpAmount, setCpAmount] = useState('');
  const [specEdit, setSpecEdit] = useState<number | null>(null); // 编辑中的规格组下标（-1 = 新增）
  const [specDraft, setSpecDraft] = useState<SpecDraft | null>(null);
  const [holdSpec, setHoldSpec] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const [imgBusy, setImgBusy] = useState(false);

  const valid = dName.trim().length > 0 && Number.isFinite(num(dPrice)) && num(dPrice) >= 0;

  const pickImg = async (f: File | null | undefined) => {
    if (!f) return;
    setImgBusy(true);
    try {
      setDImg(await readImageFile(f, 720));
    } catch {
      /* 忽略：保留原图 */
    }
    setImgBusy(false);
  };

  const addCoupon = () => {
    const mn = num(cpMin === '' ? '0' : cpMin);
    const am = num(cpAmount);
    if (!Number.isFinite(mn) || mn < 0) {
      return;
    }
    if (!Number.isFinite(am) || am <= 0) {
      return;
    }
    if (mn > 0 && am > mn) {
      return;
    }
    setDCoupon({ name: cpName.trim() || `${dName.trim() || '菜品'}专享券`, min: mn, amount: am });
    setCpName('');
    setCpMin('');
    setCpAmount('');
  };

  const specHoldActions = (i: number): HoldAction[] => [
    {
      label: '编辑规格组',
      icon: UtensilsCrossed,
      testid: 'mt-spec-hold-edit',
      onClick: () => {
        const s = dSpecs[i];
        setSpecDraft({ name: s.name, multi: !!s.multi, max: s.max ?? 1, options: s.options.map((o) => ({ label: o.label, price: o.price ?? 0 })) });
        setSpecEdit(i);
      },
    },
    {
      label: '删除规格组',
      icon: Trash2,
      testid: 'mt-spec-hold-del',
      danger: true,
      onClick: () => setDSpecs((p) => p.filter((_, k) => k !== i)),
    },
  ];

  return (
    <div className={`flex h-full flex-col ${MERCHANT_PAGE_BG}`} data-testid="mt-dish-page">
      {/* 顶栏（毛玻璃胶囊条） */}
      <div className="z-10 flex shrink-0 items-center gap-2 border-b border-white/60 bg-white/55 px-3 pb-3 pt-[54px] backdrop-blur-2xl">
        <button type="button" aria-label="返回" data-testid="mt-dish-page-back" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-white/70 active:bg-white">
          <ChevronLeft className="h-5 w-5 text-black/70" />
        </button>
        <p className="text-[16px] font-bold text-black/85">{initial ? '编辑菜品' : '添加菜品'}</p>
        <span className={`ml-auto flex max-w-[110px] items-center gap-1 truncate rounded-full px-2.5 py-1 text-[11px] text-black/60 ${GLASS_CAPSULE}`}>
          <UtensilsCrossed className="h-3 w-3 shrink-0 text-[#8A6A00]" />
          <span className="truncate">{catName}</span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* 菜品图片 */}
        <p className="text-[15px] font-bold text-black/80">菜品图片</p>
        <p className="mt-0.5 text-[11px] text-black/35">不上传也可以，会按菜名自动配一个线条图标</p>
        <button
          type="button"
          data-testid="mt-dish-img"
          onClick={() => imgRef.current?.click()}
          className="relative mt-2.5 block h-[150px] w-full overflow-hidden rounded-3xl bg-white/55 shadow-[0_10px_30px_rgba(96,74,10,0.08)] backdrop-blur-xl ring-1 ring-white/75 active:opacity-90"
          aria-label="上传菜品图片"
        >
          {dImg ? (
            <>
              <img src={dImg} alt="菜品图" className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/55 to-transparent pb-1.5 pt-6 text-[11px] text-white">
                <ImagePlus className="h-3.5 w-3.5" />
                更换图片
              </span>
            </>
          ) : (
            <span className="flex h-full flex-col items-center justify-center gap-2 text-black/35">
              {imgBusy ? (
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-black/15 border-t-[#FFD100]" />
              ) : (
                <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-[#FFF3C4] to-[#FFD100]/70">
                  <ImagePlus className="h-5 w-5 text-[#8A6A00]" strokeWidth={1.8} />
                </span>
              )}
              <span className="text-[12px]">上传菜品图片</span>
            </span>
          )}
        </button>
        <input ref={imgRef} type="file" accept="image/*" hidden onChange={(e) => { void pickImg(e.target.files?.[0]); e.target.value = ''; }} />

        {/* 基本信息（扁平铺排，无白色面板） */}
        <p className="mt-5 text-[15px] font-bold text-black/80">基本信息</p>
        <div className="mt-2.5 flex flex-col gap-2.5">
          <div>
            <p className="mb-1.5 text-[12px] text-black/45">菜品名称</p>
            <input value={dName} onChange={(e) => setDName(e.target.value)} placeholder="例：杨枝甘露 / 珍珠奶茶" data-testid="mt-dish-name" className={glassInput} maxLength={14} />
          </div>
          <div>
            <p className="mb-1.5 text-[12px] text-black/45">售价（元）</p>
            <div className="flex h-11 items-center rounded-2xl bg-[#FFF0EB]/90 px-3.5 shadow-[inset_0_1px_6px_rgba(255,75,51,0.06)] backdrop-blur-xl ring-1 ring-[#FF4B33]/15">
              <span className="text-[15px] font-bold" style={{ color: MT_PRICE }}>¥</span>
              <input
                value={dPrice}
                onChange={(e) => setDPrice(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="0.00"
                data-testid="mt-dish-price"
                className="h-full w-full min-w-0 bg-transparent pl-1.5 text-[15px] font-semibold outline-none placeholder:text-[#FF4B33]/30"
                style={{ color: MT_PRICE }}
                inputMode="decimal"
              />
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[12px] text-black/45">一句话描述（可选）</p>
            <input value={dDesc} onChange={(e) => setDDesc(e.target.value)} placeholder="例：大颗芒果 + 浓稠酸奶" className={glassInput} maxLength={30} />
          </div>
          <div>
            <p className="mb-1.5 text-[12px] text-black/45">商品状态</p>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="mt-dish-status-onsale"
                onClick={() => setDSoldOut(false)}
                className={`h-9 rounded-full px-5 text-[13px] backdrop-blur-xl transition-colors ${!dSoldOut ? 'font-semibold text-black/85 shadow-[0_4px_14px_rgba(255,190,0,0.4)]' : 'bg-white/60 text-black/50 ring-1 ring-white/70'}`}
                style={dSoldOut ? undefined : { background: MT_YELLOW }}
              >
                在售
              </button>
              <button
                type="button"
                data-testid="mt-dish-status-soldout"
                onClick={() => setDSoldOut(true)}
                className={`h-9 rounded-full px-5 text-[13px] backdrop-blur-xl transition-colors ${dSoldOut ? 'font-semibold text-black/85 shadow-[0_4px_14px_rgba(0,0,0,0.18)]' : 'bg-white/60 text-black/50 ring-1 ring-white/70'}`}
                style={dSoldOut ? { background: '#E5E5E5' } : undefined}
              >
                已售罄
              </button>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-black/30">售罄的菜买家不能加购（显示「已售罄」），AI 代点/请客也会自动避开</p>
          </div>
        </div>

        {/* 快捷模板（毛玻璃胶囊） */}
        <p className="mt-5 text-[15px] font-bold text-black/80">快捷规格模板</p>
        <p className="mt-0.5 text-[11px] text-black/35">一键生成整组规格，填充后每一项都能改价格 / 内容</p>
        <div className="mt-2.5 flex gap-2.5">
          <button
            type="button"
            data-testid="mt-dish-tea-template"
            onClick={() => setDSpecs(milkTeaTemplate())}
            className="flex flex-1 items-center gap-2.5 rounded-2xl bg-white/62 p-3 text-left backdrop-blur-xl ring-1 ring-[#FFD100]/60 active:opacity-80"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#FFF3C4] to-[#FFD100]/70">
              <CupSoda className="h-5 w-5 text-[#8A4B00]" strokeWidth={1.8} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-black/85">奶茶模板</span>
              <span className="block text-[10px] leading-snug text-black/40">大中小杯定价 · 温度 · 小料 · 糖度</span>
            </span>
          </button>
          <button
            type="button"
            data-testid="mt-dish-side-template"
            onClick={() => setDSpecs(sideDishTemplate())}
            className="flex flex-1 items-center gap-2.5 rounded-2xl bg-white/62 p-3 text-left backdrop-blur-xl ring-1 ring-white/75 active:opacity-80"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-black/[0.05]">
              <UtensilsCrossed className="h-5 w-5 text-black/55" strokeWidth={1.8} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-black/85">小菜模板</span>
              <span className="block text-[10px] leading-snug text-black/40">米饭 / 鸡蛋 / 可乐等多选加价</span>
            </span>
          </button>
        </div>

        {/* 规格组（长按编辑 / 删除） */}
        <div className="mt-5 flex items-baseline">
          <p className="text-[15px] font-bold text-black/80">规格组（{dSpecs.length}）</p>
          <span className="ml-auto text-[11px] text-black/35">长按可编辑 / 删除</span>
        </div>
        <div className="mt-2.5 flex flex-col gap-2">
          {dSpecs.map((s, i) => (
            <SpecRow key={`${s.name}-${i}`} spec={s} index={i} onHold={setHoldSpec} />
          ))}
          <button
            type="button"
            data-testid="mt-dish-add-spec"
            onClick={() => {
              setSpecDraft({ name: '', multi: false, max: 1, options: [{ label: '', price: 0 }] });
              setSpecEdit(-1);
            }}
            className="flex h-11 items-center justify-center gap-1 rounded-2xl border border-dashed border-black/15 bg-white/40 text-[13px] text-black/50 active:bg-white/70"
          >
            <Plus className="h-4 w-4" />
            自定义规格组
          </button>
        </div>

        {/* 菜品优惠券（每道菜一张） */}
        <div className="mt-5 flex items-baseline">
          <p className="flex items-center gap-1.5 text-[15px] font-bold text-black/80">
            <Ticket className="h-4 w-4 text-black/55" strokeWidth={1.9} />
            菜品优惠券
          </p>
          <span className="ml-auto text-[11px] text-black/35">下单含这道菜自动抵扣</span>
        </div>
        {dCoupon ? (
          <div className="mt-2.5 flex items-center gap-2.5 rounded-2xl bg-gradient-to-r from-[#FFF3C4]/90 to-[#FFEDAD]/90 px-3.5 py-2.5 shadow-[0_6px_18px_rgba(255,190,0,0.18)] backdrop-blur-xl ring-1 ring-[#FFD100]/60" data-testid="mt-dish-coupon-row">
            <BadgePercent className="h-4 w-4 shrink-0 text-[#8A4B00]" strokeWidth={1.9} />
            <span className="text-[16px] font-bold text-[#8A4B00]">¥{money(dCoupon.amount)}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-[#5A4200]/80">
              {dCoupon.name} · {dCoupon.min > 0 ? `满 ¥${money(dCoupon.min)} 可用` : '无门槛'}
            </span>
            <button type="button" aria-label="移除菜品优惠券" data-testid="mt-dish-coupon-remove" onClick={() => setDCoupon(null)} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#5A4200]/55 active:bg-black/5">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="mt-2.5 flex items-center gap-1.5">
            <input
              value={cpName}
              onChange={(e) => setCpName(e.target.value)}
              placeholder="券名（可空）"
              data-testid="mt-dish-coupon-name"
              className="h-9 w-auto min-w-0 flex-1 rounded-xl bg-white/62 px-2.5 text-[12px] text-black/85 outline-none backdrop-blur-xl ring-1 ring-white/80 placeholder:text-black/25 focus:ring-[#FFD100]"
              maxLength={8}
            />
            <span className="shrink-0 text-[12px] text-black/45">满</span>
            <input
              value={cpMin}
              onChange={(e) => setCpMin(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0"
              data-testid="mt-dish-coupon-min"
              className="h-9 w-[52px] shrink-0 rounded-xl bg-white/62 px-1 text-center text-[13px] text-black/85 outline-none backdrop-blur-xl ring-1 ring-white/80 placeholder:text-black/25 focus:ring-[#FFD100]"
              style={{ minWidth: 52 }}
              inputMode="decimal"
            />
            <span className="shrink-0 text-[12px] text-black/45">减</span>
            <input
              value={cpAmount}
              onChange={(e) => setCpAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="3"
              data-testid="mt-dish-coupon-amount"
              className="h-9 w-[52px] shrink-0 rounded-xl bg-white/62 px-1 text-center text-[13px] text-black/85 outline-none backdrop-blur-xl ring-1 ring-white/80 placeholder:text-black/25 focus:ring-[#FFD100]"
              style={{ minWidth: 52 }}
              inputMode="decimal"
            />
            <button
              type="button"
              data-testid="mt-dish-coupon-add"
              onClick={addCoupon}
              className="flex h-9 shrink-0 items-center gap-0.5 rounded-xl px-3 text-[13px] font-semibold text-black/80 shadow-[0_4px_12px_rgba(255,190,0,0.35)] active:opacity-80"
              style={{ background: MT_YELLOW }}
            >
              <Plus className="h-3.5 w-3.5" />
              设置
            </button>
          </div>
        )}
        <p className="mt-1.5 text-[10px] leading-relaxed text-black/30">满填 0 表示无门槛券；每道菜限一张，买家下单含此菜时自动生效，无需领取。</p>

        {/* 删除菜品（编辑态） */}
        {initial && onDelete && (
          <button
            type="button"
            data-testid="mt-dish-delete"
            onClick={() => {
              if (!confirmDel) {
                setConfirmDel(true);
                window.setTimeout(() => setConfirmDel(false), 3000);
                return;
              }
              onDelete(initial);
            }}
            className={`mt-5 flex h-11 w-full items-center justify-center gap-1.5 rounded-full text-[14px] font-medium backdrop-blur-xl transition-colors ${confirmDel ? 'bg-[#FF4B33] text-white shadow-[0_8px_22px_rgba(255,75,51,0.35)]' : 'bg-white/62 text-[#FF4B33] ring-1 ring-[#FF4B33]/25'}`}
          >
            <Trash2 className="h-4 w-4" />
            {confirmDel ? '再点一次确认删除' : '删除这道菜'}
          </button>
        )}
      </div>

      {/* 底部保存（毛玻璃条） */}
      <div className="z-10 shrink-0 border-t border-white/60 bg-white/60 px-4 pb-7 pt-3 backdrop-blur-2xl">
        <button
          type="button"
          disabled={!valid}
          data-testid="mt-dish-save"
          onClick={() => {
            onSave({
              id: initial?.id ?? `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
              name: dName.trim(),
              price: num(dPrice),
              emoji: mtAutoEmoji(dName),
              img: dImg,
              desc: dDesc.trim() || undefined,
              monthSale: initial?.monthSale ?? 88,
              sig: initial?.sig,
              specs: dSpecs.length > 0 ? dSpecs : undefined,
              coupon: dCoupon ?? undefined,
              soldOut: dSoldOut || undefined,
            });
          }}
          className={`h-12 w-full rounded-full text-[15px] font-bold ${valid ? 'text-black/85 shadow-[0_8px_22px_rgba(255,190,0,0.45)] active:opacity-85' : 'opacity-40'}`}
          style={{ background: MT_YELLOW }}
        >
          保存菜品
        </button>
      </div>

      {/* 规格组编辑弹层 */}
      <AnimatePresence>
        {specEdit !== null && specDraft && (
          <SpecEditSheet
            key="mt-spec-layer"
            initial={specEdit >= 0 ? specDraft : null}
            onClose={() => setSpecEdit(null)}
            onDone={(d) => {
              setDSpecs((p) => {
                const next = [...p];
                const row = { name: d.name, multi: d.multi, max: d.multi ? d.max : undefined, options: d.options };
                if (specEdit >= 0) next[specEdit] = row;
                else next.push(row);
                return next;
              });
              setSpecEdit(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* 规格组长按操作弹层 */}
      <AnimatePresence>
        {holdSpec !== null && dSpecs[holdSpec] && (
          <HoldActionsSheet key={`mt-spec-hold-${holdSpec}`} title={`规格组「${dSpecs[holdSpec].name}」`} actions={specHoldActions(holdSpec)} onClose={() => setHoldSpec(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
