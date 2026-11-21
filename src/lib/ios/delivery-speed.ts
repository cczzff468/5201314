/**
 * 送达速度统一设置（第四十二轮：美团 / 淘宝各自独立一份「送达速度」）。
 *
 * - 美团（分钟级）：快 5-15 分钟 / 正常 15-30 分钟 / 慢 30-60 分钟；
 * - 淘宝（小时级）：快 30 分钟-1 小时 / 正常 1-2 小时 / 慢 3-4 小时；
 * - 均支持自定义区间（1-480 分钟，min ≤ max）；
 * - 存储按 App 分键（delivery-speed:meituan / delivery-speed:taobao），
 *   兼容旧全局键 delivery-speed:global（旧档位映射到各 App 对应区间）；
 * - dsMinutesFor(seed, scope)：在对应速度区间内按种子哈希确定性抖动（同一订单
 *   在同一设置下时间可复现，重启不跳变）；
 * - 修改后广播 window 事件 delivery-speed-changed，UI（我的页速度行等）即时刷新。
 */

import { kvGetRaw, kvSetRaw } from './idb-kv';

export type DsScope = 'meituan' | 'taobao';
export type DsPreset = 'fast' | 'normal' | 'slow' | 'custom';

/** 各 App 三档固定区间（用户指定）：美团分钟级 / 淘宝小时级 */
export const DS_RANGES: Record<DsScope, Record<Exclude<DsPreset, 'custom'>, { min: number; max: number }>> = {
  meituan: {
    fast: { min: 5, max: 15 },
    normal: { min: 15, max: 30 },
    slow: { min: 30, max: 60 },
  },
  taobao: {
    fast: { min: 30, max: 60 }, // 30 分钟 - 1 小时
    normal: { min: 60, max: 120 }, // 1 - 2 小时
    slow: { min: 180, max: 240 }, // 3 - 4 小时
  },
};

/** 兼容旧导出（默认美团区间；新代码请用 DS_RANGES[scope]） */
export const DS_RANGE = DS_RANGES.meituan;

export const DS_LABEL: Record<DsPreset, string> = {
  fast: '快',
  normal: '正常',
  slow: '慢',
  custom: '自定义',
};

/** 自定义允许的分钟边界（模拟器现实值：1 分钟 ~ 8 小时） */
export const DS_CUSTOM_MIN = 1;
export const DS_CUSTOM_MAX = 480;

export interface DsSetting {
  preset: DsPreset;
  /** 生效区间（分钟，含端点）；preset 非 custom 时与 DS_RANGES[scope] 一致 */
  min: number;
  max: number;
}

const dsKey = (scope: DsScope): string => `delivery-speed:${scope}`;
/** 第四十一轮旧全局键（淘宝+美团共用一份），仅作迁移兜底读取 */
const DS_LEGACY_KEY = 'delivery-speed:global';

const clampInt = (n: unknown, def: number, lo: number, hi: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : NaN;
  if (Number.isNaN(v)) return def;
  return Math.min(hi, Math.max(lo, v));
};

/** 规整任意输入为合法设置（脏值一律回退「正常」；preset 旧字符串值兼容） */
function normalize(v: unknown, scope: DsScope): DsSetting {
  const R = DS_RANGES[scope];
  if (typeof v === 'string') {
    // 兼容旧淘宝纯档位值（'fast' | 'normal' | 'slow'）
    if (v === 'fast' || v === 'normal' || v === 'slow') {
      const r = R[v];
      return { preset: v, min: r.min, max: r.max };
    }
    return { preset: 'normal', min: R.normal.min, max: R.normal.max };
  }
  if (v && typeof v === 'object') {
    const o = v as Partial<DsSetting>;
    const preset: DsPreset = o.preset === 'fast' || o.preset === 'slow' || o.preset === 'custom' ? o.preset : 'normal';
    if (preset === 'custom') {
      let min = clampInt(o.min, R.normal.min, DS_CUSTOM_MIN, DS_CUSTOM_MAX);
      let max = clampInt(o.max, R.normal.max, DS_CUSTOM_MIN, DS_CUSTOM_MAX);
      if (min > max) [min, max] = [max, min];
      return { preset, min, max };
    }
    const r = R[preset];
    return { preset, min: r.min, max: r.max };
  }
  return { preset: 'normal', min: R.normal.min, max: R.normal.max };
}

/** 读指定 App 的送达速度（未设置/脏值 → 该 App「正常」档；旧全局键兜底迁移） */
export function dsGet(scope: DsScope): DsSetting {
  try {
    const own = kvGetRaw(dsKey(scope));
    if (own != null) return normalize(own, scope);
    // 迁移兜底：四十一轮旧全局键只存了档位意图，映射到本 App 对应区间
    const legacy = kvGetRaw(DS_LEGACY_KEY);
    if (legacy != null) {
      const legacyPreset =
        typeof legacy === 'string' ? legacy : legacy && typeof legacy === 'object' ? (legacy as Partial<DsSetting>).preset : null;
      if (legacyPreset === 'fast' || legacyPreset === 'normal' || legacyPreset === 'slow') {
        const r = DS_RANGES[scope][legacyPreset];
        return { preset: legacyPreset, min: r.min, max: r.max };
      }
    }
  } catch {
    /* 存储读取失败走默认 */
  }
  const R = DS_RANGES[scope];
  return { preset: 'normal', min: R.normal.min, max: R.normal.max };
}

/** 写指定 App 的送达速度并广播（UI 监听 delivery-speed-changed 即时刷新） */
export function dsSet(scope: DsScope, s: DsSetting): void {
  const next = normalize(s, scope);
  try {
    kvSetRaw(dsKey(scope), next);
  } catch {
    /* 存储失败静默（本次会话仍生效于内存态由调用方刷新） */
  }
  try {
    window.dispatchEvent(new CustomEvent('delivery-speed-changed'));
  } catch {
    /* 非浏览器环境忽略 */
  }
}

// ---------------- 时长文案（分钟 → 中文智能格式） ----------------

/** 单个时长（淘宝小时级语义用）：n<60 → 「X分钟」；整/半小时 → 「X小时」；其余 → 「X小时Y分钟」 */
export function dsFmtDur(min: number): string {
  const n = Math.max(0, Math.round(min));
  if (n < 60) return `${n}分钟`;
  if (n % 60 === 0) return `${n / 60}小时`;
  if (n % 60 === 30) return `${n / 60}小时`;
  return `${Math.floor(n / 60)}小时${n % 60}分钟`;
}

/**
 * 区间文案（按 App 语义分格式，防歧义）：
 * - 美团（分钟级语义）：永远「X-Y分钟」（慢档 30-60 显示「30-60分钟」而非「30分钟-1小时」）；
 * - 淘宝（小时级语义）：30-60 → 「30分钟-1小时」；60-120 → 「1-2小时」；180-240 → 「3-4小时」。
 */
export function dsFmtRange(min: number, max: number, scope: DsScope = 'taobao'): string {
  const a = Math.max(0, Math.round(min));
  const b = Math.max(a, Math.round(max));
  if (scope === 'meituan') return `${a}-${b}分钟`;
  if (b < 60) return `${a}-${b}分钟`;
  if (a < 60 && b === 60) return `${a}分钟-1小时`;
  if (a < 60) return `${a}分钟-${dsFmtDur(b)}`;
  if (a % 60 === 0 && b % 60 === 0) return `${a / 60}-${b / 60}小时`;
  return `${dsFmtDur(a)}-${dsFmtDur(b)}`;
}

/** 当前速度的文案（美团如「5-15分钟送达」；淘宝如「30分钟-1小时送达」） */
export function dsDesc(scope: DsScope, s?: DsSetting): string {
  const cur = s ?? dsGet(scope);
  return `${dsFmtRange(cur.min, cur.max, scope)}送达`;
}

/** 当前速度的短文案（美团如「5-15分钟」；淘宝如「1-2小时」） */
export function dsDescShort(scope: DsScope, s?: DsSetting): string {
  const cur = s ?? dsGet(scope);
  return dsFmtRange(cur.min, cur.max, scope);
}

/** 种子哈希（同一订单/商家号在同一设置下确定性抖动，复用淘宝同族 31 进制滚动） */
function dsHashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/**
 * 在指定 App 当前速度区间内按种子确定性取分钟数（[min, max] 闭区间）。
 * 美团订单 ETA / 淘宝物流时间轴共用：seed 用订单号（或商家号预演）。
 */
export function dsMinutesFor(seed: string, scope: DsScope, s?: DsSetting): number {
  const cur = s ?? dsGet(scope);
  const span = Math.max(0, cur.max - cur.min);
  return cur.min + (dsHashStr(seed) % (span + 1));
}
