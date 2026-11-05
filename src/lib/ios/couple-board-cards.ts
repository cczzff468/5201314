/**
 * 留言板·便签卡纸共享数据（couple-space.tsx 墙面渲染 与 couple-ai.ts TA 选卡 共用的唯一清单）：
 *
 * - BOARD_CARDS：内置图案卡纸（file 对应 public/board-cards/；ar = 原始宽高比「多大就是多大」，
 *   span = 横幅卡跨栏铺满，padTop = 顶部插画避让区比例，small = 缩小到 82% 居中，desc = 给 AI 选卡用的卡面描述）；
 * - NOTE_COLORS：素白卡的 16 色调色盘（前 8 色索引与旧版一致，历史便签颜色不漂移）；
 * - BoardCardCustom：用户手机上传的自定义卡纸（canvas 压缩 dataURL + 宽高比 + 自动检测的顶部避让）；
 * - boardCardSkinOf：便签卡索引 → 统一卡面皮肤（内置/自定义一个视图；墙上尺寸计算用）；
 * - detectCardPadTop：上传时按像素分析「顶部有显著插画」的卡面 → 自动给文字留避让区。
 *
 * 卡索引约定：0 = 素白（走调色盘）；1-8 = 内置图案卡；100+ = 自定义上传卡（boardCardCustom 下标 + 100）。
 */

/** 内置图案卡纸清单（与 public/board-cards/ 目录同步维护；desc 供 TA 选卡时理解卡面气质）
 *  v44 精简：只留样式一/样式五 + 新增「便签纸」（用户要求；被窝小熊/水墨信笺/乐谱信笺/云雾便笺/撑伞小熊已下线，
 *  旧便签的卡索引由 couple-space 迁移归一到样式一）。
 *  v45：用户新发 5 张便签卡参考图全部加入（手绘涂鸦/水彩蝴蝶/蕾丝乐谱/枝头双兔/朦胧少女），
 *  padTop 由像素分析定制（涂鸦卡顶上有小动物插画 → 文字避让 32%）。
 *  scale：卡面显示缩放（0~1；缺省 = small ? 0.82 : 1）——样式五用户要求再小一点（0.62）；
 *  noPin：卡面自带胶带等固定装饰 → 不再叠金属别针（便签纸卡）。 */
export const BOARD_CARDS: {
  label: string;
  file: string;
  text: string;
  ar: number;
  span?: boolean;
  padTop?: number;
  small?: boolean;
  scale?: number;
  noPin?: boolean;
  desc?: string;
}[] = [
  { label: '样式一', file: 'card-1.jpg', text: '#3a3a3a', ar: 1079 / 1024, desc: '手账纸质感' },
  { label: '样式五', file: 'card-6.jpg', text: '#3a3a3a', ar: 899 / 590, span: true, small: true, scale: 0.62, desc: '宽版横幅纸，居中小卡' },
  { label: '便签纸', file: 'card-17.svg', text: '#4a4436', ar: 1, padTop: 0.17, noPin: true, desc: '和纸胶带便签，暖白横格纸' },
  { label: '手绘涂鸦', file: 'card-18.png', text: '#3a3a3a', ar: 1076 / 816, padTop: 0.32, desc: '手绘涂鸦纸，顶上趴波浪线的小动物插画' },
  { label: '水彩蝴蝶', file: 'card-19.png', text: '#33323a', ar: 660 / 604, desc: '灰调水彩纸，右下蝴蝶剪影与褪色手写' },
  { label: '蕾丝乐谱', file: 'card-20.png', text: '#4a4436', ar: 656 / 588, desc: '复古手账纸，蕾丝花边与散落乐谱' },
  { label: '枝头双兔', file: 'card-21.jpg', text: '#3f3f3f', ar: 1078 / 762, desc: '极浅线稿纸，挂果实树枝与山丘双兔' },
  { label: '朦胧少女', file: 'card-22.png', text: '#3a3a3a', ar: 644 / 656, desc: '高白朦胧纸，少女剪影与星点' },
];

/** 便签调色盘（16 色补全色环；前 8 色索引与旧版一致；bg = 同色微渐层，扁平但有体积） */
export const NOTE_COLORS: { name: string; bg: string; text: string; swatch: string }[] = [
  // ── 原有暖色 8 种（索引 0-7 原位保留，旧数据颜色不漂移） ──
  { name: '陶红', bg: 'linear-gradient(180deg,#e29080,#dd7f6c)', text: '#fff6f1', swatch: '#dd7f6c' },
  { name: '橘橙', bg: 'linear-gradient(180deg,#eda375,#e79a62)', text: '#fff7ef', swatch: '#e79a62' },
  { name: '杏黄', bg: 'linear-gradient(180deg,#efca7f,#ecc26e)', text: '#6a531a', swatch: '#ecc26e' },
  { name: '豆绿', bg: 'linear-gradient(180deg,#adc9a4,#a4c29a)', text: '#31462a', swatch: '#a4c29a' },
  { name: '雾蓝', bg: 'linear-gradient(180deg,#92bcd8,#85b3cf)', text: '#f2f9fd', swatch: '#85b3cf' },
  { name: '藤紫', bg: 'linear-gradient(180deg,#bcafda,#b4a5d3)', text: '#fbf8ff', swatch: '#b4a5d3' },
  { name: '樱粉', bg: 'linear-gradient(180deg,#ecb4c7,#e7abc0)', text: '#fff3f7', swatch: '#e7abc0' },
  { name: '云白', bg: 'linear-gradient(180deg,#faf8f2,#f5f1e8)', text: '#5b5344', swatch: '#f5f1e8' },
  // ── 新增 8 种（补全色环：石榴红/蜜桃/柠黄/竹青/湖青/晴空/葡萄/暖灰） ──
  { name: '石榴', bg: 'linear-gradient(180deg,#d5756e,#cc6a62)', text: '#fff4f2', swatch: '#cc6a62' },
  { name: '蜜桃', bg: 'linear-gradient(180deg,#f2c8ab,#eebf9e)', text: '#6e4a30', swatch: '#eebf9e' },
  { name: '柠黄', bg: 'linear-gradient(180deg,#efd98f,#e9d178)', text: '#63531c', swatch: '#e9d178' },
  { name: '竹青', bg: 'linear-gradient(180deg,#9dc0a6,#92b699)', text: '#2d4229', swatch: '#92b699' },
  { name: '湖青', bg: 'linear-gradient(180deg,#89bfbb,#7fb4b0)', text: '#f0faf9', swatch: '#7fb4b0' },
  { name: '晴空', bg: 'linear-gradient(180deg,#82aade,#779fd6)', text: '#f3f9ff', swatch: '#779fd6' },
  { name: '葡萄', bg: 'linear-gradient(180deg,#a294c9,#998bc1)', text: '#faf8ff', swatch: '#998bc1' },
  { name: '暖灰', bg: 'linear-gradient(180deg,#cec9bd,#c5c0b3)', text: '#4c453a', swatch: '#c5c0b3' },
];

/** 调色盘颜色名清单（给 TA 选色用，索引与 NOTE_COLORS 一致） */
export const NOTE_COLOR_NAMES: string[] = NOTE_COLORS.map((c) => c.name);

/** 用户手机上传的自定义卡纸（src = canvas 压缩后的 dataURL；ar = 宽高比；padTop = 自动检测的顶部避让比例） */
export interface BoardCardCustom {
  src: string;
  ar: number;
  padTop?: number;
}

/** 便签卡面的统一皮肤视图（内置图案卡 / 自定义上传卡一个口径；墙上尺寸计算用） */
export interface BoardCardSkin {
  label: string;
  text: string;
  ar: number;
  span?: boolean;
  padTop?: number;
  small?: boolean;
  /** v44：卡面显示缩放（0~1；缺省 = small ? 0.82 : 1） */
  scale?: number;
  /** v44：卡面自带胶带等固定装饰 → 不再叠金属别针 */
  noPin?: boolean;
  /** CSS background-image 值（内置 = 文件 url；自定义 = dataURL） */
  bgImage: string;
}

/**
 * 卡索引 → 卡面皮肤（0 = 素白 → null；1-3 = 内置；100+ = 自定义）。
 * 自定义卡被删了下标越界 → 返回 null（渲染层自然退回素白卡兜底）；
 * v44 精简后的旧索引（4-7 老数据，卡面已下架）→ 回退样式一（纸质感接近，视觉不突兀）。
 */
export function boardCardSkinOf(card: number, customs?: BoardCardCustom[]): BoardCardSkin | null {
  if (card >= 100) {
    const c = customs?.[card - 100];
    if (!c) return null;
    return { label: `自定义卡${card - 99}`, text: '#3a3a3a', ar: c.ar > 0 ? c.ar : 0.75, padTop: c.padTop, bgImage: `url("${c.src}")` };
  }
  if (card >= 1 && card <= BOARD_CARDS.length) {
    const skin = BOARD_CARDS[card - 1];
    return { ...skin, bgImage: `url(/board-cards/${skin.file})` };
  }
  if (card > BOARD_CARDS.length && card < 100) {
    const base = BOARD_CARDS[0];
    return { ...base, bgImage: `url(/board-cards/${base.file})` };
  }
  return null;
}

/**
 * 上传卡纸时的像素分析：卡面顶部有显著插画（且基本只在顶部、下方留白）→ 返回文字避让比例；其余返回 0。
 * 思路：把卡面按高度切成 20 带，统计每带「深色像素」占比（灰度 <165，忽略浅色纹理）——
 * 顶部两带基本干净（插画不是顶天立地）+ 3~8 带间出现显著深色带且在 40% 高度内收尾
 * （像「被窝小熊」那种顶上画小动物、下面留白写字的设计）才需要避让；
 * 水墨/云雾这类满版浅纹理、撑伞小熊这类底部插画都返回 0（文字直接从顶写）。
 */
export function detectCardPadTop(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    const bands = 20; // 每带 5% 高度
    const ratios: number[] = [];
    const xStep = Math.max(1, Math.floor(w / 48));
    for (let b = 0; b < bands; b++) {
      const y0 = Math.floor((b / bands) * h);
      const y1 = Math.max(y0 + 1, Math.floor(((b + 1) / bands) * h));
      let dark = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = 0; x < w; x += xStep) {
          n++;
          const i = (y * w + x) * 4;
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (lum < 165) dark++;
        }
      }
      ratios.push(dark / Math.max(1, n));
    }
    // 顶部 10% 必须基本干净（插画不是从最顶上开始的才谈得上「避让」）
    if (ratios[0] > 0.08 || ratios[1] > 0.08) return 0;
    // 3~8 带（10%~40% 高度）里找第一条显著深色带
    let end = -1;
    for (let b = 2; b <= 7; b++) {
      if (ratios[b] > 0.14) {
        end = b;
        break;
      }
    }
    if (end < 0) return 0; // 顶部没有显著插画
    // 顺着显著带往后收尾（跌回 <6% 即插画结束）
    while (end + 1 < bands && ratios[end + 1] > 0.06) end++;
    const pad = (end + 1) / bands;
    return pad >= 0.14 && pad <= 0.42 ? Math.min(pad + 0.02, 0.45) : 0;
  } catch {
    return 0; // 取像素失败（跨域等）按不需避让
  }
}
