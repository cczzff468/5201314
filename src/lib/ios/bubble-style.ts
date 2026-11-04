/**
 * 聊天气泡装扮系统（第十七轮建立 · 第十八轮重构）——核心库
 * ---------------------------------------------------------------------------
 *
 * 宿主 App（装扮完全隔离，各持一份互不影响）：
 *  - wx  微信 / qq QQ / sms 信息（iMessage 风格）
 *
 * 四种内置样式（样式对两侧同时生效，不分 TA/我）：
 *  - default  纯色气泡（无自定义色 = 跟随 App 原生配色；微信我方绿 / QQ 我方蓝 / 信息我方 iOS 蓝）
 *             自定义色后：仅换底色/文字色，圆角不覆盖——与各 App 原生气泡完全一致
 *  - rainbow  七彩气泡：每条消息按序号在参考图 9 色间循环取色
 *  - frosted  毛玻璃：真实磨砂（奶白半透底 + 噪点纹理 + 柔和投影；胶囊无尾巴）
 *  - liquid   液态玻璃：清透玻璃胶囊（极淡白膜透底；无尾巴）
 *
 * 持久化：zustand useSettings → IndexedDB settings.bubbleStyle / settings.bubbleSchemes。
 * 渲染：bubbleVisual() 输出 override/className/style/tail，聊天页按返回值覆盖原生背景与文字色。
 */
import type { CSSProperties } from 'react';

export type BubbleStyleKind = 'default' | 'rainbow' | 'frosted' | 'liquid' | 'retro';

/** 信息 App 同款气泡尾巴剪影（iMessage 弯钩剪影，viewBox 14×18）——
 *  QQ 装扮（纯色/七彩）气泡改成信息 App 同款后共用这对剪影（第五十一轮）；
 *  第六十三轮起 QQ 古早气泡的底部弯钩尾巴亦复用这对剪影（颜色改走 .rt-beak-* 类区分） */
export const TAIL_CLIP_LEFT = 'path("M12 0 L12 6 C11 12 7 16 0 18 C4 13 6 8 6 2 L6 0 Z")';
export const TAIL_CLIP_RIGHT = 'path("M2 0 L2 6 C3 12 7 16 14 18 C10 13 8 8 8 2 L8 0 Z")';

/* 古早 QQ 尾巴剪影沿革：第五十九~六十二轮为顶部小逗号 beak（RETRO_BEAK_CLIP_* 常量已删除）；
 *  第六十三轮（用户指定「小尾巴放下面，跟七彩差不多」）改为信息式底部弯钩剪影——
 *  直接复用上方 TAIL_CLIP_LEFT/RIGHT，颜色改走 .rt-beak-* CSS 类区分（见 globals.css） */

/** App 级界面主题（第四十二轮）：default = 现状原生；liquid = 液态玻璃主题（参考图）。
 *  主题与气泡样式相互独立：主题只接管页面铭件（导航/TabBar/列表卡/输入栏），
 *  气泡仍由 kind 管；聊天背景层不受主题影响（用户指定）。
 *  第五十三轮：删除 new（新版 iMessage 主题）——存量档的 'new' 在 normalize 时自动回退 default。
 *  古早主题（retro）：2012-2014 年代拟物风（iOS 6 银灰导航 + 安卓深灰聊天顶栏 +
 *  灰底小圆角描边气泡），仅微信/QQ 提供。第五十八轮：古早气泡尾巴回归各自 App 默认样式
 *  ——微信 = 默认小三角（颜色走 .rt-tail-* 类深浅自适应），QQ = 默认无尾巴、四角统一 8px。
 *  第五十九~六十二轮：QQ 顶部尖角 beak 尾巴的多轮造型迭代（最终弃用）。
 *  第六十轮（用户指定「QQ古早气泡再美化，尤其是小尾巴」）：QQ 泡去描边、四角统一 12px 圆角。
 *  第六十三轮（用户指定「古早气泡小尾巴放下面，跟七彩差不多」）：QQ 尾巴改为信息式
 *  底部弯钩剪影（与七彩 im 尾巴同几何，渐变/深色由 .rt-beak-* CSS 类携带）；微信保持默认小三角 */
export type BubbleTheme = 'default' | 'liquid' | 'retro';

/** 装扮宿主 App 标识（微信 / QQ / 信息） */
export type BubbleAppId = 'wx' | 'qq' | 'sms';

/** 单个 App 的装扮：样式（不分侧） + 两侧独立自定义色 + 界面主题 */
export interface BubbleAppStyle {
  kind: BubbleStyleKind;
  /** 界面主题（仅 wx/qq 生效；缺省 = default） */
  theme?: BubbleTheme;
  /** 我的气泡自定义基色（#RRGGBB）；undefined = 跟随默认 */
  mineColor?: string;
  /** TA 的气泡自定义基色（#RRGGBB）；undefined = 跟随默认 */
  theirsColor?: string;
}

/** 全量装扮配置：微信 / QQ / 信息 三 App 完全隔离 */
export interface BubbleStyleConfig {
  wx: BubbleAppStyle;
  qq: BubbleAppStyle;
  sms: BubbleAppStyle;
}

/** 收藏夹里的一套已命名方案（归属某个 App，应用时只覆盖该 App） */
export interface BubbleScheme {
  id: string;
  name: string;
  /** 方案归属 App（保存时所在的应用） */
  app: BubbleAppId;
  style: BubbleAppStyle;
  createdAt: number;
}

/**
 * 七彩循环色板 —— 用户参考图逐像素提取的 9 色
 * （气泡浏览数字 01→10 跳过 08 的顺序：亮黄/青柠/杏色/青色/粉色/薰衣草/灰褐/琥珀/珊瑚）
 */
export const RAINBOW_COLORS = [
  '#FFEB00', // 01 亮黄
  '#B9F000', // 02 青柠
  '#FEAE8B', // 03 杏色
  '#46EAEB', // 04 青色
  '#FE91A6', // 05 粉色
  '#E19EFF', // 06 薰衣草紫
  '#BBB4AC', // 07 灰褐
  '#FFCE0F', // 09 琥珀
  '#FB9F94', // 10 珊瑚
] as const;

export const BUBBLE_KINDS: readonly BubbleStyleKind[] = ['default', 'rainbow', 'frosted', 'liquid', 'retro'];

/** 主题列表（设置页用——全部主题的权威清单；设置页按宿主 App 取子集） */
export const BUBBLE_THEMES: readonly BubbleTheme[] = ['default', 'liquid', 'retro'];

/** 各 App 提供的主题子集：微信/QQ = 默认+液态玻璃+古早；信息 = 仅默认（第五十三轮删除新版主题） */
export const THEMES_OF_APP: Record<BubbleAppId, readonly BubbleTheme[]> = {
  wx: ['default', 'liquid', 'retro'],
  qq: ['default', 'liquid', 'retro'],
  sms: ['default'],
};

/** 主题中文名（设置页展示用） */
export const BUBBLE_THEME_LABEL: Record<BubbleTheme, string> = {
  default: '默认主题',
  liquid: '液态玻璃',
  retro: '古早',
};

/** 该 App 是否启用了液态玻璃主题（页面铭件读此值切换玻璃视觉；旧档无 theme 字段 = false） */
export function isLiquidTheme(cfg: BubbleStyleConfig | undefined, app: BubbleAppId): boolean {
  return cfg?.[app]?.theme === 'liquid';
}

/** 该 App 是否启用了古早主题（页面铭件读此值切换拟物复古视觉；仅微信/QQ 生效） */
export function isRetroTheme(cfg: BubbleStyleConfig | undefined, app: BubbleAppId): boolean {
  return cfg?.[app]?.theme === 'retro' && (app === 'wx' || app === 'qq');
}

/** 各 App 原生默认气泡底色（kind=default 且未自定义色时还原成它）
 *  （theirs 灰色系仅作为设置页滑条元生位置的参考，聊天页原生仍走 bg-muted 类） */
export const NATIVE_BUBBLE: Record<BubbleAppId, { mine: string; theirs: string }> = {
  wx: { mine: '#95EC69', theirs: '#FFFFFF' },
  qq: { mine: '#0099FF', theirs: '#FFFFFF' },
  sms: { mine: '#007AFF', theirs: '#E9E9EB' },
};

/** 古早气泡色板（第五十六轮：两张参考图逐像素精修二round）：
 *  微信（图2）：我方亮绿 #9EE75A 近黑字、4px 方角；对方纯白 #FFFFFF 无描边近黑字
 *  （旧微信白泡直接坐在 #EBEBEB 灰底上）。
 *  QQ（图1）：我方灰泡垂直渐变（顶 #D0D0D0 → 底 #B9B9B9，旧版安卓 QQ 同款），
 *  对方浅蓝渐变（顶 #C2D8EC → 底 #A9C9E5）；第六十轮美化——QQ 泡无描边
 *  （参考图实测边缘干净无描边线，.bub-retro-qq 置 border-width:0）、
 *  四角统一 12px 圆角（retroQqRadius）；第六十三轮起尾巴为底部弯钩剪影（与七彩 im 同款）。
 *  mine/theirs 字段 = 渐变顶色。 */
export const RETRO_BUBBLE: Record<
  BubbleAppId,
  { mine: string; mineBorder: string; mineText: string; theirs: string; theirsBorder: string; theirsText: string; radius: string; mineBg?: string; theirsBg?: string }
> = {
  wx: { mine: '#9EE75A', mineBorder: 'transparent', mineText: '#1E3A0E', theirs: '#FFFFFF', theirsBorder: 'transparent', theirsText: '#26282E', radius: '4px' },
  qq: { mine: '#D0D0D0', mineBorder: 'transparent', mineText: '#1A1A1A', theirs: '#C2D8EC', theirsBorder: 'transparent', theirsText: '#1F2A36', radius: '12px', mineBg: 'linear-gradient(180deg, #D0D0D0 0%, #C4C4C4 55%, #B9B9B9 100%)', theirsBg: 'linear-gradient(180deg, #C2D8EC 0%, #B4CDE7 55%, #A9C9E5 100%)' },
  sms: { mine: '#CFE3F5', mineBorder: '#A9C7E4', mineText: '#1F3347', theirs: '#F8F8F9', theirsBorder: '#DBDBDF', theirsText: '#33352E', radius: '10px' },
};

/** 古早 QQ 圆角（第六十轮美化，参考图实测）：四角统一 12px（参考图泡高 112px 圆角 ~28px ≈ 25%，
 *  折算到本项目 42px 单行泡 ≈ 12px）——第六十三轮起组尾消息的尾巴侧底角由宿主收 5px
 *  （信息式同口径），底部弯钩尾巴贴底悬挂（与七彩 im 尾巴同几何） */
export const retroQqRadius = (mine: boolean) => (mine ? '12px' : '12px');

export const DEFAULT_BUBBLE_STYLE: BubbleStyleConfig = {
  wx: { kind: 'default' },
  qq: { kind: 'default' },
  sms: { kind: 'default' },
};

/**
 * 弯钩小尾巴 SVG path（viewBox 0 0 11 14）——参考图同款「水滴弯钩」第十八轮终版：
 * 末尾细如线（用户指定）——外缘掠过顶部弯峰后向下前铺，以近乎水平的切向
 * 逼近尖点 (0.33, 2.02)；内缘以同样近乎水平的切向离开尖点——两侧在尖端
 * 汇成约 25° 的针尖，且末端 1.5 单位保持 ≈1 单位厚（渲染约 1px 细线）。
 * 根部宽阔（右缘 3.7→12.6 藏在气泡身下，宿主定位横向重叠 2px 无缝）。
 */
export const BUBBLE_TAIL_PATH =
  'M11 3.7 C8.2 1.85 5.2 0.6 3 0.78 C1.55 0.92 0.7 1.18 0.55 1.55 C0.45 1.8 0.4 1.9 0.33 2.02 C0.62 2.18 1.05 2.4 1.6 2.72 C3.2 3.85 6.6 7.6 11 12.6 Z';

/** 预设色板（全色彩盘快捷区：参考图 9 色打头 + 常用色补充，共 24 色） */
export const PRESET_SWATCHES: readonly string[] = [
  '#FFEB00', '#B9F000', '#FEAE8B', '#46EAEB', '#FE91A6', '#E19EFF',
  '#BBB4AC', '#FFCE0F', '#FB9F94', '#FF3B30', '#FF9500', '#34C759',
  '#00C75D', '#00C7BE', '#3DD5F3', '#3D9BFF', '#0A5CFF', '#5856D6',
  '#AF52DE', '#C86DD7', '#FF2D55', '#FF6FA5', '#FFB3C1', '#4A4A4A',
];

// ---------------- 颜色工具（hex / rgb / hsl / yiq 互转） ----------------

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** #hex → { h: 0-360, s: 0-100, l: 0-100 } */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** { h: 0-360, s: 0-100, l: 0-100 } → #hex */
export function hslToHex(h: number, s: number, l: number): string {
  const hn = ((h % 360) + 360) % 360;
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hn < 60) [r, g, b] = [c, x, 0];
  else if (hn < 120) [r, g, b] = [x, c, 0];
  else if (hn < 180) [r, g, b] = [0, c, x];
  else if (hn < 240) [r, g, b] = [0, x, c];
  else if (hn < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** hex → rgba() 字符串（alpha 0-1） */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** YIQ 亮度判断：返回适配的文字色（黑/白），保证自定义底色上文字可读 */
export function yiqTextOn(bg: string): '#000000' | '#FFFFFF' {
  const { r, g, b } = hexToRgb(bg);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? '#000000' : '#FFFFFF';
}

// ---------------- 存储读回校验（store.load 用） ----------------

function normKind(v: unknown): BubbleStyleKind {
  if (v === 'glass') return 'liquid'; // 第十七轮「玻璃」→ 第十八轮「液态」
  return BUBBLE_KINDS.includes(v as BubbleStyleKind) ? (v as BubbleStyleKind) : 'default';
}

function normColor(v: unknown): string | undefined {
  return isHexColor(v) ? (v as string).toUpperCase() : undefined;
}

/** 单 App 装扮 → 合法对象；不合法回默认 */
function normTheme(v: unknown): BubbleTheme {
  if (v === 'liquid') return 'liquid';
  if (v === 'retro') return 'retro';
  return 'default';
}

function normalizeAppStyle(v: unknown): BubbleAppStyle {
  const o = (v ?? {}) as Partial<BubbleAppStyle>;
  return {
    kind: normKind(o.kind),
    theme: normTheme(o.theme),
    mineColor: normColor(o.mineColor),
    theirsColor: normColor(o.theirsColor),
  };
}

/** 任何来源（IndexedDB 旧档/脏数据）→ 合法配置；不合法回默认。含第十七轮旧档自动迁移。 */
export function normalizeBubbleStyle(v: unknown): BubbleStyleConfig {
  if (!v || typeof v !== 'object') return { wx: { kind: 'default' }, qq: { kind: 'default' }, sms: { kind: 'default' } };
  const o = v as Record<string, unknown>;
  // 新格式：{ wx, qq, sms }（sms 为后续接入：旧档缺失时补默认，不影响已有装扮）
  if (o.wx || o.qq || o.sms) {
    return {
      wx: normalizeAppStyle(o.wx),
      qq: normalizeAppStyle(o.qq),
      sms: normalizeAppStyle(o.sms),
    };
  }
  // 第十七轮旧格式：{ mine: {kind,color}, theirs: {kind,color} }（两 App 共享）
  // → 迁移：kind 取旧 mine.kind（装扮主选择），两侧色各自保留，各 App 同步获得
  const oldMine = (o.mine ?? {}) as { kind?: unknown; color?: unknown };
  const oldTheirs = (o.theirs ?? {}) as { kind?: unknown; color?: unknown };
  const migrated: BubbleAppStyle = {
    kind: normKind(oldMine.kind ?? oldTheirs.kind),
    theme: 'default',
    mineColor: normColor(oldMine.color),
    theirsColor: normColor(oldTheirs.color),
  };
  return { wx: { ...migrated }, qq: { ...migrated }, sms: { kind: 'default' } };
}

/** 收藏夹列表读回校验：过滤非法项；旧格式方案（config.mine/theirs）迁移为 wx 方案 */
export function normalizeBubbleSchemes(v: unknown): BubbleScheme[] {
  if (!Array.isArray(v)) return [];
  const out: BubbleScheme[] = [];
  for (const s of v) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.createdAt !== 'number') continue;
    if (r.style && typeof r.style === 'object') {
      // 新格式
      out.push({
        id: r.id,
        name: r.name,
        app: r.app === 'qq' ? 'qq' : r.app === 'sms' ? 'sms' : 'wx',
        style: normalizeAppStyle(r.style),
        createdAt: r.createdAt,
      });
    } else if (r.config && typeof r.config === 'object') {
      // 第十七轮旧格式 { config: { mine, theirs } } → 迁移为 wx 方案
      const c = r.config as { mine?: { kind?: unknown; color?: unknown }; theirs?: { kind?: unknown; color?: unknown } };
      out.push({
        id: r.id,
        name: r.name,
        app: 'wx',
        style: {
          kind: normKind(c.mine?.kind ?? c.theirs?.kind),
          mineColor: normColor(c.mine?.color),
          theirsColor: normColor(c.theirs?.color),
        },
        createdAt: r.createdAt,
      });
    }
  }
  return out;
}

/** 是否仍是原生默认（该 App 没有任何装扮）——聊天页可借此完全零开销直通。
 *  注意：主题（theme）不参与此项判断——主题接管的是页面铭件，不是气泡本身 */
export function isNativeBubbleStyle(cfg: BubbleStyleConfig | undefined, app: BubbleAppId): boolean {
  if (!cfg) return true;
  const a = cfg[app];
  return a?.kind === 'default' && !a?.mineColor && !a?.theirsColor;
}

// ---------------- 转文字面板视觉（跟随气泡装扮） ----------------

/** 语音转文字面板跟随气泡装扮后的视觉描述 */
export interface TranscriptVisual {
  /** true = 面板需要装扮覆盖（玻璃/染色）；false = 保持原生白面板 */
  override: boolean;
  /** 附加类（毛玻璃 bub-frosted / 液态 bub-liquid） */
  className: string;
  /** 内联样式（染色时的 backgroundColor 等） */
  style: CSSProperties;
  /** 面板文字色类（原生时为空，用调用方默认） */
  textClass: string;
  /** 面板圆角（第四十九轮：跟随气泡样式——与所属语音气泡同规格；原生时为空字符串）。
   *  纯色/七彩：微信 4px / QQ 14px / 信息 18px（与 bubbleVisual 同口径）；
   *  毛玻璃/液态：999px 胶囊（与气泡胶囊同形） */
  radius: string;
}

const NO_TRANSCRIPT: TranscriptVisual = { override: false, className: '', style: {}, textClass: '', radius: '' };

/** 各 App 装扮后（纯色/七彩）的气泡圆角——与 bubbleVisual 同口径：
 *  微信/信息保持原生（语音气泡 4px / 18px）；QQ 装扮后 18px（第五十轮：用户指定「再圆一点」，14→18px） */
const DECOR_BUBBLE_RADIUS: Record<BubbleAppId, string> = { wx: '4px', qq: '18px', sms: '18px' };

/** 计算语音转文字面板视觉：与所属语音气泡同一装扮语言。
 *  - 默认无色：原生白面板（微信大字白面板/两端小面板，不变）
 *  - 默认自定义色：同色染色面板（同背景色 α0.9，文字 yiq 自适应）
 *  - 七彩：取该消息的循环色染面板（与气泡同色）
 *  - 毛玻璃：奶白磨砂玻璃面板（bub-frosted）
 *  - 液态：清透玻璃胶囊（bub-liquid）
 *  @param side     语音消息归属（决定取 mine/theirs 色）
 *  @param cfg      全量装扮配置
 *  @param msgIndex 消息序号（七彩循环取色与气泡一致）
 *  @param app      宿主 App
 */
export function transcriptVisual(
  side: 'mine' | 'theirs',
  cfg: BubbleStyleConfig | undefined,
  msgIndex: number,
  app: BubbleAppId,
): TranscriptVisual {
  const a = cfg?.[app];
  if (!a) return NO_TRANSCRIPT;
  const kind = normKind(a.kind);
  const color = normColor(side === 'mine' ? a.mineColor : a.theirsColor);

  if (kind === 'default' && !color) return NO_TRANSCRIPT;

  if (kind === 'rainbow') {
    const idx = ((msgIndex % RAINBOW_COLORS.length) + RAINBOW_COLORS.length) % RAINBOW_COLORS.length;
    const c = RAINBOW_COLORS[idx];
    return {
      override: true,
      className: '',
      style: { backgroundColor: withAlpha(c, 0.92), color: yiqTextOn(c) },
      textClass: '',
      radius: DECOR_BUBBLE_RADIUS[app],
    };
  }

  if (kind === 'frosted') {
    // 毛玻璃面板：与气泡同语言（奶白磨砂；自定义色 = 彩色磨砂 α0.55）
    const base = color;
    return {
      override: true,
      className: 'bub-frosted',
      style: base
        ? { backgroundColor: withAlpha(base, 0.55), color: yiqTextOn(base) }
        : {},
      textClass: '',
      radius: '999px',
    };
  }

  if (kind === 'liquid') {
    // 液态面板：清透玻璃（与气泡同语言；自定义色 = 极淡渐变）
    const base = color;
    return {
      override: true,
      className: 'bub-liquid',
      style: base
        ? {
            background: `linear-gradient(165deg, ${withAlpha(base, 0.12)} 0%, ${withAlpha(base, 0.04)} 45%, ${withAlpha(base, 0.07)} 75%, ${withAlpha(base, 0.10)} 100%)`,
          }
        : {},
      textClass: '',
      radius: '999px',
    };
  }

  if (kind === 'retro') {
    // 古早面板：与古早气泡同语言（小圆角 + 描边平色底；深色模式由 .dark 类接管）
    const rb = RETRO_BUBBLE[app];
    const mine = side === 'mine';
    const sideCls = color
      ? `bub-retro bub-retro-custom${app === 'qq' ? ' bub-retro-qq' : ''}`
      : `bub-retro bub-retro-${mine ? 'mine' : 'theirs'}${app === 'qq' ? ' bub-retro-qq' : ''}`;
    return {
      override: true,
      className: sideCls,
      style: {
        ...(color
          ? { backgroundColor: color, color: yiqTextOn(color), borderColor: color }
          : app === 'qq'
            ? // QQ 渐变由 .bub-retro-qq 类携带（inline 只给文字色，深色类 background 简写接管）
              { color: mine ? rb.mineText : rb.theirsText }
            : {
                backgroundColor: mine ? rb.mine : rb.theirs,
                color: mine ? rb.mineText : rb.theirsText,
                borderColor: mine ? rb.mineBorder : rb.theirsBorder,
              }),
        borderRadius: rb.radius,
      },
      textClass: '',
      radius: rb.radius,
    };
  }

  // default + 自定义色：染色面板（与气泡同色系，略深于气泡底不透明）
  const c = color as string;
  return {
    override: true,
    className: '',
    style: { backgroundColor: withAlpha(c, 0.92), color: yiqTextOn(c) },
    textClass: '',
    radius: DECOR_BUBBLE_RADIUS[app],
  };
}

// ---------------- 气泡视觉计算（聊天页渲染核心） ----------------

export interface BubbleVisual {
  /** true = 需覆盖原生背景/文字（调用方停用原生 bg 类，改用下方 style/className） */
  override: boolean;
  /** override 时的附加类（液态气泡 = 'bub-liquid'；其余为空字符串） */
  className: string;
  /** override 时的内联样式（背景/圆角/文字色/模糊/描边/高光） */
  style: CSSProperties;
  /**
   * 小尾巴指令（尾巴策略按 App 区分）：
   *  - 'native' 保持 App 原生尾巴（微信小方块三角 · 信息弯钩剪影 · 纯色/七彩时随 tailColor 上色；QQ 原生无尾巴）
   *  - 'im'     信息 App 同款底部弯钩剪影尾巴（第五十一轮：QQ 纯色/七彩改用——气泡整体变成信息 App 同款；
   *             14×18px 剪影随 tailColor 上色，我方右侧/对方左侧，由宿主用 TAIL_CLIP_LEFT/RIGHT 渲染）
   *  - 'hook'   参考图同款弯钩尾巴（历史值：第五十一轮起 QQ 不再返回，仅类型完备性保留）
   *  - 'none'   不渲染尾巴（毛玻璃/液态胶囊）
   *  - 'retro'  古早 QQ 底部弯钩尾巴（第六十三轮）：与 'im' 同款信息式剪影（14×18px），
   *             由宿主用 TAIL_CLIP_LEFT/RIGHT 渲染（我方右侧/对方左侧，贴底悬挂）；
   *             非自定义色时颜色走 .rt-beak-* CSS 类（渐变对齐泡身底部色带 + 深色自适应），
   *             自定义色时 tailColor 携带平色。微信古早不返回此值（用 native）。
   *  第五十八轮（用户指定「古早小尾巴变成默认气泡样式的」）：微信古早 = 'native' 默认小三角
   *  （tailClass 携带深浅自适应尾巴色）——至今保持；QQ 古早 = 'retro'（第六十三轮起为
   *  底部弯钩剪影，用户指定「小尾巴放下面，跟七彩差不多」）。
   */
  tail: 'native' | 'im' | 'hook' | 'none' | 'retro';
  /** 尾巴填充色（hook 的 SVG fill / native 方块的 backgroundColor；无装扮时为空） */
  tailColor: string;
  /** 尾巴附加类（第五十八轮：微信古早尾巴 = .rt-tail-mine/-theirs——古早色板深浅自适应；
   *  设置时优先于 tailColor inline，避免深色模式下 .dark 色板盖掉 inline 气泡底后尾巴脱色） */
  tailClass?: string;
}

const NO_VISUAL: BubbleVisual = { override: false, className: '', style: {}, tail: 'native', tailColor: '' };

/**
 * 计算某条消息气泡的最终视觉。
 * @param side     mine=我的消息（右侧）/ theirs=TA 的消息（左侧）
 * @param cfg      全量装扮配置（三 App 隔离，取 cfg[app]）
 * @param msgIndex 消息在会话中的序号（七彩循环的递增索引：渲染时传 map 下标即可）
 * @param app      宿主 App（default 无自定义色时还原各 App 原生配色）
 */
export function bubbleVisual(
  side: 'mine' | 'theirs',
  cfg: BubbleStyleConfig | undefined,
  msgIndex: number,
  app: BubbleAppId,
): BubbleVisual {
  const a = cfg?.[app];
  if (!a) return NO_VISUAL;
  const kind = normKind(a.kind);
  const color = normColor(side === 'mine' ? a.mineColor : a.theirsColor);

  // 原生默认：零覆盖直通（微信绿/白、QQ 蓝/白、信息 iOS 蓝/bg-muted，深浅色模式类名由聊天页原样保留）
  if (kind === 'default' && !color) return NO_VISUAL;

  if (kind === 'rainbow') {
    // 七彩：参考图 9 色按消息序号循环；尾巴按 App —— 微信保持原生小三角（随色），
    // 信息保持原生弯钩尾巴（随色）；QQ 第五十一轮改成信息 App 同款（'im' 底部弯钩剪影 +
    // 18px 圆角，宿主渲染时另加组尾 5px 小角）——用户指定「七彩气泡变成信息 APP 一样的气泡」。
    // 圆角：QQ 装扮后 18px（与信息原生同规格）；微信/信息保持原生
    const idx = ((msgIndex % RAINBOW_COLORS.length) + RAINBOW_COLORS.length) % RAINBOW_COLORS.length;
    const c = RAINBOW_COLORS[idx];
    return {
      override: true,
      className: '',
      style: {
        backgroundColor: c,
        color: yiqTextOn(c),
        ...(app === 'qq' ? { borderRadius: '18px' } : {}),
      },
      tail: app === 'qq' ? 'im' : 'native',
      tailColor: c,
    };
  }

  if (kind === 'frosted') {
    // 毛玻璃（第十九轮重做）：真实磨砂玻璃——.bub-frosted 全局类提供三要素
    // （奶白半透底 0.62 + feTurbulence 磨砂颗粒纹理 + 柔和悬浮投影），
    // 素色聊天背景下也有可见的「磨砂玻璃板」质地；无描边无光泽高光；
    // 高度对齐语音胶囊 34px（24px 行盒 + 上下 padding 5px）；
    // 自定义色 = 彩色磨砂玻璃（内联 backgroundColor 0.55 覆盖类底色，颗粒纹理保留）
    const base = color;
    return {
      override: true,
      className: 'bub-frosted',
      style: {
        borderRadius: '999px',
        ...(base
          ? {
              backgroundColor: withAlpha(base, 0.55),
              color: yiqTextOn(base),
            }
          : {}),
        paddingTop: '5px',
        paddingBottom: '5px',
        lineHeight: 1.5,
      },
      tail: 'none',
      tailColor: '',
    };
  }

  if (kind === 'liquid') {
    // 液态玻璃（第十九轮终版）：清透玻璃胶囊——背景几乎完全直接透出，只留一层
    // 极淡白膜（无 brightness 提亮、无描边——用户指定删除，只剩 blur+饱和）;
    // 高度对齐语音胶囊 34px（24px 行盒 + 5px×2 padding，无描边不计）；
    // 自定义色 = 该色极淡渐变（α 0.10↔0.03）
    const base = color;
    return {
      override: true,
      className: 'bub-liquid',
      style: {
        borderRadius: '999px',
        ...(base
          ? {
              background: `linear-gradient(165deg, ${withAlpha(base, 0.10)} 0%, ${withAlpha(base, 0.03)} 45%, ${withAlpha(base, 0.06)} 75%, ${withAlpha(base, 0.09)} 100%)`,
            }
          : {}),
        paddingTop: '5px',
        paddingBottom: '5px',
        lineHeight: 1.5,
      },
      tail: 'none',
      tailColor: '',
    };
  }

  if (kind === 'retro') {
    // 古早气泡（第五十六轮两张参考图逐像素精修二round）：
    //  微信（图2）我方亮绿 #9EE75A + 近黑字，4px 方角；对方纯白无描边；
    //  QQ（图1）我方灰渐变/对方浅蓝渐变（渐变由 .bub-retro-qq.bub-retro-mine/-theirs CSS 类携带
    //  ——深色类用 background 简写 !important 接管）。
    //  自定义色 = bub-retro-custom（inline 平色）。
    //  第五十八轮：微信尾巴回归默认小三角（'native'，非自定义色时走 tailClass 深浅自适应）——至今保持。
    //  第五十九~六十二轮：QQ 顶部 beak 尾巴多轮迭代（已弃用）；第六十三轮（用户指定
    //  「小尾巴放下面，跟七彩差不多」）：QQ 改为信息式底部弯钩剪影（'retro'，与七彩同几何，
    //  非自定义色时颜色走 .rt-beak-* CSS 类深浅自适应）。
    //  第六十轮：QQ 泡去描边、圆角统一 12px（retroQqRadius）。
    const rb = RETRO_BUBBLE[app];
    const mine = side === 'mine';
    const sideCls = color
      ? `bub-retro bub-retro-custom${app === 'qq' ? ' bub-retro-qq' : ''}`
      : `bub-retro bub-retro-${mine ? 'mine' : 'theirs'}${app === 'qq' ? ' bub-retro-qq' : ''}`;
    if (color) {
      return {
        override: true,
        className: sideCls,
        style: {
          backgroundColor: color,
          color: yiqTextOn(color),
          borderColor: color,
          borderRadius: app === 'qq' ? retroQqRadius(mine) : rb.radius,
        },
        tail: app === 'wx' ? 'native' : 'retro',
        tailColor: color,
      };
    }
    return {
      override: true,
      className: sideCls,
      style: {
        ...(app === 'qq'
          ? // QQ：渐变交给 CSS 类（深色类 background 简写接管）；inline 只给文字色
            { color: mine ? rb.mineText : rb.theirsText }
          : {
              backgroundColor: mine ? rb.mine : rb.theirs,
              color: mine ? rb.mineText : rb.theirsText,
              borderColor: mine ? rb.mineBorder : rb.theirsBorder,
            }),
        borderRadius: app === 'qq' ? retroQqRadius(mine) : rb.radius,
      },
      // 微信：默认小三角尾巴；颜色走 .rt-tail-* CSS 类（深色模式跟随古早色板，inline 会脱色）。
      // QQ：底部弯钩尾巴（第六十三轮与七彩同款剪影；颜色走 .rt-beak-* CSS 类深浅自适应）
      ...(app === 'wx'
        ? { tail: 'native' as const, tailColor: '', tailClass: mine ? 'rt-tail-mine' : 'rt-tail-theirs' }
        : { tail: 'retro' as const, tailColor: '' }),
    };
  }

  // default + 自定义色：仅换底色/文字色；圆角——微信保持原生 5px、信息保持原生 18px（不覆盖），
  // QQ 装扮后 18px（第五十一轮与信息原生同规格）。
  // 尾巴按 App —— 微信/信息保持原生尾巴（随色）；QQ 第五十一轮改成信息 App 同款（'im' 底部弯钩剪影）
  return {
    override: true,
    className: '',
    style: {
      backgroundColor: color,
      color: yiqTextOn(color as string),
      ...(app === 'qq' ? { borderRadius: '18px' } : {}),
    },
    tail: app === 'qq' ? 'im' : 'native',
    tailColor: color as string,
  };
}

/** 样式中文名（设置页/收藏夹展示用） */
export const BUBBLE_KIND_LABEL: Record<BubbleStyleKind, string> = {
  default: '默认',
  rainbow: '七彩',
  frosted: '毛玻璃',
  liquid: '液态',
  retro: '古早',
};
