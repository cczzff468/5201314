'use client';

/**
 * 用户自建订单（创建订单入库）共享类型与工具 —— 美团/淘宝两端共用。
 *
 * 用户在美团/淘宝里手动创建任意类型的订单（外卖/奶茶/数码/充值…），
 * 可上传图片或用「设置 › 图像生成」配置的生图模型按自定义提示词生成图片，
 * 订单带类型 / 优惠券 / 规格选项组（小菜、奶茶小料、手机内存等）元数据，
 * 入库后与正常订单一样出现在订单列表/详情（custom 字段标识来源）。
 */

export interface OrderCustomOptionGroup {
  /** 组名（小菜 / 奶茶小料 / 手机内存 / 杯型 / 温度…自由填写） */
  name: string;
  /** 已选值（拍黄瓜、花生米 / 珍珠、椰果 / 256G…） */
  values: string[];
}

export interface OrderCustomMeta {
  /** 订单类型文案（自由填写，如 奶茶甜饮 / 手机数码 / 充值缴费） */
  type?: string;
  /** 优惠券名称文案（如 新人立减券） */
  couponLabel?: string;
  /** 规格选项组 */
  optionGroups?: OrderCustomOptionGroup[];
}

/** 未知数据 → 安全的 OrderCustomMeta（无有效内容返回 undefined） */
export function normalizeOrderCustom(v: unknown): OrderCustomMeta | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Partial<OrderCustomMeta>;
  const type = typeof o.type === 'string' && o.type.trim() ? o.type.trim() : undefined;
  const couponLabel = typeof o.couponLabel === 'string' && o.couponLabel.trim() ? o.couponLabel.trim() : undefined;
  const optionGroups = Array.isArray(o.optionGroups)
    ? o.optionGroups
        .filter((g): g is OrderCustomOptionGroup => !!g && typeof (g as OrderCustomOptionGroup).name === 'string')
        .map((g) => ({
          name: g.name.trim(),
          values: Array.isArray(g.values) ? g.values.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : [],
        }))
        .filter((g) => g.name && g.values.length > 0)
    : undefined;
  if (!type && !couponLabel && (!optionGroups || optionGroups.length === 0)) return undefined;
  return {
    ...(type ? { type } : {}),
    ...(couponLabel ? { couponLabel } : {}),
    ...(optionGroups && optionGroups.length > 0 ? { optionGroups } : {}),
  };
}

/** 规格选项组 → 单行文案（「小菜：拍黄瓜、花生米；奶茶小料：珍珠」），订单明细 spec 展示用 */
export function customSpecText(groups?: OrderCustomOptionGroup[]): string {
  if (!groups || groups.length === 0) return '';
  return groups
    .filter((g) => g.name.trim() && g.values.length > 0)
    .map((g) => `${g.name.trim()}：${g.values.map((v) => v.trim()).filter(Boolean).join('、')}`)
    .filter(Boolean)
    .join('；');
}
