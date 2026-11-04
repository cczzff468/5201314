/**
 * 表情包数据层（微信 / QQ 共用）：
 * - IndexedDB kv store 持久化：wx-stickers / qq-stickers（图片 dataURL 体积大，localStorage 容易超配额）
 * - 每张表情：图片（dataURL 或 URL）+ 意思（供 AI 理解并据此回复）+ 所属分组
 * - URL 添加时自动从 URL 中识别中文意思（query 参数或文件名/路径段）
 * - 分组：wx-sticker-groups / qq-sticker-groups，默认分组「我的表情」永远第一且不可删除；
 *   旧数据无 groupId → 全部归属默认分组（零迁移兼容）
 * - 内置表情（builtin=true）：静态常量（builtin-stickers.ts），不进 IndexedDB 不可删；
 *   loadStickers 自动合并返回（用户表情在前），saveStickers 自动过滤——对调用方透明
 */

import { kvGet, kvSet } from './idb-kv';
import { BUILTIN_STICKER_GROUP_ID, builtinGroupName, builtinStickersOf } from './builtin-stickers';
import { BUILTIN_PACKS, BUILTIN_PACK_GROUP_IDS, BUILTIN_PACK_STICKERS } from './sticker-packs';

export interface Sticker {
  id: string;
  /** 图片地址：dataURL（本机上传）或 http(s) URL；内置表情为项目内相对路径（/wechat-emojis/…） */
  url: string;
  /** 表情包的意思（AI 回复依据） */
  meaning: string;
  /** 所属分组 ID（旧数据无此字段 = 默认分组「我的表情」） */
  groupId?: string;
  createdAt: number;
  /** 内置表情标记：静态常量、不持久化、不可删除/改意思；分组固定为 builtin 分组 */
  builtin?: true;
}

/** 表情分组（面板顶部毛玻璃胶囊展示的名字 + 分组下的表情集合） */
export interface StickerGroup {
  id: string;
  name: string;
  createdAt: number;
  /** 内置分组标记：虚拟分组（loadStickerGroups 动态插入），不可删除/改名 */
  builtin?: true;
}

/** 默认分组：永远存在、永远第一、不可删除不可重命名；未分组/分组被删的表情都归属这里 */
export const DEFAULT_STICKER_GROUP_ID = 'my';
export const DEFAULT_STICKER_GROUP_NAME = '我的表情';

const LS_KEY = (app: 'wx' | 'qq') => `${app}-stickers`;
const GROUPS_KEY = (app: 'wx' | 'qq') => `${app}-sticker-groups`;

/** 判断某分组 ID 是否内置分组（官方表情分组或 v62 内置表情包分组）：面板里隐藏「管理/添加」，分组不可删不可改名 */
export function isBuiltinGroupId(groupId: string): boolean {
  return groupId === BUILTIN_STICKER_GROUP_ID || BUILTIN_PACK_GROUP_IDS.has(groupId);
}

/** 判断某张表情是否「官方小表情」（微信表情/QQ表情分组里的小图）：面板点选插入 [微笑] 文字代码而非直接发送；内置包大贴纸不是 */
export function isOfficialEmojiSticker(s: Sticker): boolean {
  return !!s.builtin && s.groupId === BUILTIN_STICKER_GROUP_ID;
}

export function loadStickers(app: 'wx' | 'qq'): Sticker[] {
  let user: Sticker[] = [];
  try {
    const parsed: unknown = kvGet<Partial<Sticker>[]>(LS_KEY(app));
    if (Array.isArray(parsed)) {
      user = parsed
        .filter((s): s is Partial<Sticker> => Boolean(s) && typeof (s as Partial<Sticker>).url === 'string')
        .slice(0, 200)
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          url: s.url as string,
          meaning: typeof s.meaning === 'string' ? s.meaning : '',
          groupId: typeof s.groupId === 'string' && s.groupId ? s.groupId : DEFAULT_STICKER_GROUP_ID,
          createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
        }));
    }
  } catch {
    user = [];
  }
  // 内置表情自动合并（在用户表情之后）；防旧数据意外持久化了内置项 → 去重
  // v62：内置表情包四套（太阳小狗/小狗豹/小凑狗/古早企鹅）一并合入（官方小表情在前、大贴纸包在后）
  const builtin = builtinStickersOf(app).filter((b) => !user.some((u) => u.id === b.id));
  const packs = BUILTIN_PACK_STICKERS.filter((b) => !user.some((u) => u.id === b.id));
  return [...user, ...builtin, ...packs];
}

export function saveStickers(app: 'wx' | 'qq', list: Sticker[]): void {
  try {
    // 内置表情不持久化（saveStickers 只存用户收藏；commit 传入合并列表也安全）
    kvSet(LS_KEY(app), list.filter((s) => !s.builtin).slice(0, 200));
  } catch {
    // 持久化失败忽略
  }
}

export function newStickerId(): string {
  return `stk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 读取表情分组列表（默认分组第一，内置分组第二，v62 内置表情包分组紧随其后——动态插入虚拟分组；损坏/缺失数据时返回默认+内置） */
export function loadStickerGroups(app: 'wx' | 'qq'): StickerGroup[] {
  const def: StickerGroup = { id: DEFAULT_STICKER_GROUP_ID, name: DEFAULT_STICKER_GROUP_NAME, createdAt: 0 };
  const builtin: StickerGroup = { id: BUILTIN_STICKER_GROUP_ID, name: builtinGroupName(app), builtin: true, createdAt: 0 };
  const packGroups: StickerGroup[] = BUILTIN_PACKS.map((p) => ({ id: p.id, name: p.name, builtin: true, createdAt: 0 }));
  try {
    const parsed: unknown = kvGet<Partial<StickerGroup>[]>(GROUPS_KEY(app));
    if (!Array.isArray(parsed)) return [def, builtin, ...packGroups];
    const seen = new Set<string>([DEFAULT_STICKER_GROUP_ID, BUILTIN_STICKER_GROUP_ID, ...BUILTIN_PACK_GROUP_IDS]);
    const out: StickerGroup[] = [def, builtin, ...packGroups];
    for (const g of parsed) {
      if (!g || typeof g.id !== 'string' || !g.id || seen.has(g.id)) continue;
      const name = typeof g.name === 'string' ? g.name.trim().slice(0, 16) : '';
      if (!name) continue;
      seen.add(g.id);
      out.push({ id: g.id, name, createdAt: typeof g.createdAt === 'number' ? g.createdAt : Date.now() });
    }
    return out;
  } catch {
    return [def, builtin, ...packGroups];
  }
}

/** 保存表情分组列表（默认分组强制第一；内置分组与用户分组一并过滤——内置永不入库；空名/重复 ID 过滤） */
export function saveStickerGroups(app: 'wx' | 'qq', groups: StickerGroup[]): void {
  try {
    const def: StickerGroup = { id: DEFAULT_STICKER_GROUP_ID, name: DEFAULT_STICKER_GROUP_NAME, createdAt: 0 };
    const seen = new Set<string>([DEFAULT_STICKER_GROUP_ID, BUILTIN_STICKER_GROUP_ID, ...BUILTIN_PACK_GROUP_IDS]);
    const rest: StickerGroup[] = [];
    for (const g of groups) {
      if (!g || g.builtin || g.id === DEFAULT_STICKER_GROUP_ID || seen.has(g.id)) continue;
      const name = typeof g.name === 'string' ? g.name.trim().slice(0, 16) : '';
      if (!name) continue;
      seen.add(g.id);
      rest.push({ id: g.id, name, createdAt: typeof g.createdAt === 'number' ? g.createdAt : Date.now() });
    }
    kvSet(GROUPS_KEY(app), [def, ...rest]);
  } catch {
    // 持久化失败忽略
  }
}

export function newStickerGroupId(): string {
  return `stkg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 表情的有效分组 ID：groupId 缺失或不指向已存在分组 → 默认分组（防孤儿表情不可见） */
export function stickerGroupOf(s: Sticker, groupIds: Set<string>): string {
  return s.groupId && groupIds.has(s.groupId) ? s.groupId : DEFAULT_STICKER_GROUP_ID;
}

/** 从文件名提取意思：取去扩展名后文件名里的连续中文（如「哈哈笑死.png」→「哈哈笑死」） */
export function fileNameMeaning(name: string): string {
  const stem = name.replace(/\.[a-z0-9]+$/i, '');
  const m = stem.match(/[\u4e00-\u9fa5]{2,}/);
  return m ? m[0] : '';
}

/**
 * URL 意思自动识别：
 * ① query 参数 meaning/name/text/cn/title/desc
 * ② 文件名（最后一个 / 后、扩展名前）中的连续中文
 * ③ 路径段中的连续中文（取最靠后的段）
 */
export function extractMeaningFromUrl(url: string): string {
  try {
    const decoded = decodeURIComponent(url.trim());
    const [path, query = ''] = decoded.split('?');
    for (const part of query.split('&')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const k = part.slice(0, eq);
      const v = part.slice(eq + 1);
      if (/^(meaning|name|text|cn|title|desc)$/i.test(k) && v) {
        const m = v.match(/[\u4e00-\u9fa5A-Za-z0-9]{1,20}/);
        if (m) return m[0];
      }
    }
    const file = (path.split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '');
    const mFile = file.match(/[\u4e00-\u9fa5]{2,}/);
    if (mFile) return mFile[0];
    const seg = path
      .split('/')
      .reverse()
      .find((s) => /[\u4e00-\u9fa5]{2,}/.test(s));
    if (seg) return (seg.match(/[\u4e00-\u9fa5]{2,}/) ?? [''])[0];
    return '';
  } catch {
    return '';
  }
}

/** URL 合法性粗校验（http/https/data） */
export function isImageUrl(url: string): boolean {
  const t = url.trim();
  return /^https?:\/\/\S+$/i.test(t) || /^data:image\//i.test(t);
}
