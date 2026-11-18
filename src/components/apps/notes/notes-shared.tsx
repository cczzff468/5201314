'use client';

/**
 * 备忘录 App（金色重构版）共享常量 / 类型 / 纯函数。
 *
 * 数据模型（对齐 db.ts NoteRecord 新增可选字段，全部向后兼容旧数据）：
 * - folder        所属文件夹 id（缺省 = 'default' 内置「备忘录」默认夹）
 * - pinned        置顶
 * - locked        锁定标记（列表隐藏摘要，编辑器先解锁）
 * - deletedAt     最近删除时间戳（有值 = 已删除，仅出现在「最近删除」）
 * - checklist     结构化清单（NoteChecklistItem[]）
 * - linkedEventId 关联日历日程 id（与日历代理对齐的同名字段）
 * - linkDate      关联日期 'YYYY-MM-DD'（与日历代理对齐的同名字段）
 *
 * 文件夹清单持久化于 idb-kv（键 'notes-folders'，设备级数据不做账号映射）。
 */

import type { ReactNode } from 'react';
import type { NoteChecklistItem, NoteRecord } from '@/lib/ios/db';
import { kvGet, kvSet } from '@/lib/ios/idb-kv';

// ---------------- 视觉常量（对照设计稿：蓳衣草灰底 + 软亮金主色） ----------------

/** 主金色（浅色模式）：设计稿文件夹图标采样软金（#CCAE54，比旧 #C9A227 更亮更柔） */
export const GOLD_LIGHT = '#CCAE54';
/** 主金色（深色模式）：微亮暖金 */
export const GOLD_DARK = '#D6B25C';
/** 页面背景（设计稿采样 #F3F2F8 蓳衣草灰，比旧暖白 #FAF9F7 更灰更冷） */
export const BG_WARM = '#F3F2F8';
/** 搜索框底色（设计稿采样 #E9E8ED） */
export const SEARCH_BG = '#E9E8ED';
/** 回收站等破坏性/警示行的暖红（「红金色」） */
export const WARM_RED = '#C25E4C';

/** 次要文字（浅色）：设计稿辅助色 #B8B2AA（时间·文件夹、计数、分组标签等弱信息） */
export const MUTED_META_CLS = 'text-[#B8B2AA] dark:text-[#77716b]';
/** 次要文字（浅色）：摘要正文灰（比元信息深一档保证可读） */
export const MUTED_TEXT_CLS = 'text-[#8e8880] dark:text-[#a8a29a]';

/** 白卡：白底圆角 12px（用户反馈：素白面板，去掉灰色边框与阴影） */
export const CARD_CLS = 'rounded-[12px] bg-white dark:bg-white/[0.06]';

// ---------------- 内置文件夹 ----------------

export const FOLDER_ALL = 'all'; // 全部备忘录（聚合视图，不落库）
export const FOLDER_DEFAULT = 'default'; // 备忘录（默认夹）
export const FOLDER_TRASH = 'trash'; // 最近删除

export interface FolderInfo {
  id: string;
  name: string;
  createdAt: number;
}

const FOLDERS_KEY = 'notes-folders';

/** 读取自定义文件夹清单（IndexedDB kv，幂等容错） */
export function loadFolders(): FolderInfo[] {
  const raw = kvGet<FolderInfo[]>(FOLDERS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string');
}

/** 写回自定义文件夹清单 */
export function saveFolders(list: FolderInfo[]): void {
  kvSet(FOLDERS_KEY, list);
}

/** 文件夹显示名（内置优先） */
export function folderNameOf(id: string, folders: FolderInfo[]): string {
  if (id === FOLDER_ALL) return '全部备忘录';
  if (id === FOLDER_DEFAULT) return '备忘录';
  if (id === FOLDER_TRASH) return '最近删除';
  return folders.find((f) => f.id === id)?.name ?? '备忘录';
}

// ---------------- 文本 / 时间助手 ----------------

export function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'] as const;

/** HTML → 纯文本：块级元素/br 转换行（DOMParser 不触发脚本与资源加载，安全） */
export function htmlToText(html: string): string {
  if (!html) return '';
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6]|blockquote)>/gi, '\n');
  if (typeof DOMParser === 'undefined') return withBreaks.replace(/<[^>]*>/g, '');
  return (new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent ?? '').replace(
    /\u00a0/g,
    ' '
  );
}

/** 结构化清单的纯文本（列表摘要/搜索用） */
export function checklistText(n: NoteRecord): string {
  return (n.checklist ?? [])
    .map((i) => (i.text ?? '').trim())
    .filter(Boolean)
    .join('；');
}

/** 列表显示标题：优先独立 title 字段，其次正文首行，最后清单首项 */
export function displayTitle(n: NoteRecord): string {
  const t = (n.title ?? '').trim();
  if (t) return t;
  const lines = htmlToText(n.content)
    .split('\n')
    .map((l) => l.trim());
  const first = lines.find((l) => l !== '') ?? '';
  if (first) return first.replace(/^#+\s*/, '').slice(0, 50);
  const cl = (n.checklist ?? []).map((i) => (i.text ?? '').trim()).filter(Boolean);
  return cl[0]?.slice(0, 50) || '新备忘录';
}

/** 列表正文预览（1 行）：标题为空时跳过被用作标题的首行；附带清单项文本 */
export function displayPreview(n: NoteRecord): string {
  const lines = htmlToText(n.content)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (!(n.title ?? '').trim() && lines.length > 0) lines.shift();
  const body = lines.slice(0, 2).join('；');
  const cl = checklistText(n);
  return [body, cl].filter(Boolean).join('；');
}

/** 列表卡片日期：今天 HH:mm / 昨天 / 本周周X / M月d日 */
export function noteDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();

  if (startOf(d) === startOf(now)) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 1) return '昨天';

  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  if (d.getTime() >= monday.getTime()) return `周${WEEKDAY_NAMES[d.getDay()]}`;

  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 编辑器顶部完整时间：2026年10月23日 09:10 */
export function formatFull(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}`;
}

/** 'YYYY-MM-DD' → '10月23日，星期五'（手动解析避免 UTC 时区偏移） */
export function formatLinkDate(s: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s ?? '');
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}月${d.getDate()}日，星期${WEEKDAY_NAMES[d.getDay()]}`;
}

/** 本地自然日 'YYYY-MM-DD' */
export function dayStr(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 回收站卡片删除时间：刚刚删除 / N 分钟前删除 / 今天删除 / N 天前删除 / M月d日删除 */
export function deletedTimeText(ts: number): string {
  const now = Date.now();
  const diffMs = Math.max(0, now - ts);
  if (diffMs < 60_000) return '刚刚删除';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前删除`;
  const d = new Date(ts);
  const nowD = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(nowD) - startOf(d)) / 86400000);
  if (diffDays <= 0) return '今天删除';
  if (diffDays === 1) return '昨天删除';
  if (diffDays < 60) return `${diffDays} 天前删除`;
  return `${d.getMonth() + 1}月${d.getDate()}日删除`;
}

/**
 * 备忘录是否「空白」（幽灵空记录判定，金色版扩展）：标题为空 + 正文纯文本为空（或仅剩旧版清单种子符）
 * + 无图片/链接 + 清单无有效项 + 无日历关联 + 未置顶 —— 空笔记按 iOS 语义丢弃。
 */
const CHECKLIST_SEED_TEXT = '☐';
export function isBlankNote(n: NoteRecord): boolean {
  if ((n.title ?? '').trim() !== '') return false;
  if (n.pinned === true) return false;
  if ((n.checklist ?? []).some((i) => (i.text ?? '').trim() !== '')) return false;
  if ((n.linkDate ?? '').trim() !== '' || (n.linkedEventId ?? '').trim() !== '') return false;
  const html = n.content ?? '';
  if (/<(img|a)\b/i.test(html)) return false;
  const text = htmlToText(html).trim();
  return text === '' || text === CHECKLIST_SEED_TEXT;
}

/** 导出 TXT：标题 + 空行 + 纯文本正文（清单项一并导出） */
export function exportTxt(n: NoteRecord): void {
  const title = (n.title ?? '').trim();
  const cl = checklistText(n);
  const parts = [title, htmlToText(n.content)];
  if (cl) parts.push(`清单：${cl}`);
  const text = parts.filter((p) => p.trim() !== '').join('\n\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title || '备忘录'}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 聚焦并把光标放到元素末尾 */
export function focusEnd(el: HTMLElement): void {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

// ---------------- 记录补丁（新字段统一写入口径：真值写入，空值删除键） ----------------

export interface NotePatch {
  pinned?: boolean;
  locked?: boolean;
  /** 文件夹 id；FOLDER_DEFAULT 也落字段（显式归入默认夹） */
  folder?: string;
  /** 删除时间；null = 恢复 */
  deletedAt?: number | null;
  checklist?: NoteChecklistItem[];
  /** 关联日程 id；'' = 清除 */
  linkedEventId?: string;
  /** 关联日期；'' = 清除 */
  linkDate?: string;
}

/**
 * 由旧记录派生更新记录：可选字段仅真值写入（否则从新记录移除属性，避免 undefined 落库），
 * 并刷新 updatedAt。pinned/locked 布尔语义：true 写入，false/缺省删除。
 */
export function patchNote(n: NoteRecord, patch: NotePatch): NoteRecord {
  const rec: NoteRecord = { ...n, updatedAt: Date.now() };
  if (patch.pinned === undefined ? n.pinned : patch.pinned) rec.pinned = true;
  else delete rec.pinned;
  if (patch.locked === undefined ? n.locked : patch.locked) rec.locked = true;
  else delete rec.locked;

  const folder = patch.folder === undefined ? (n.folder ?? FOLDER_DEFAULT) : patch.folder;
  if (folder) rec.folder = folder;
  else delete rec.folder;

  const del = patch.deletedAt === undefined ? n.deletedAt : patch.deletedAt;
  if (typeof del === 'number' && del > 0) rec.deletedAt = del;
  else delete rec.deletedAt;

  const cl = patch.checklist === undefined ? n.checklist : patch.checklist;
  if (cl && cl.length > 0) rec.checklist = cl;
  else delete rec.checklist;

  const evId = patch.linkedEventId === undefined ? n.linkedEventId : patch.linkedEventId;
  if (evId) rec.linkedEventId = evId;
  else delete rec.linkedEventId;

  const ld = patch.linkDate === undefined ? n.linkDate : patch.linkDate;
  if (ld) rec.linkDate = ld;
  else delete rec.linkDate;

  return rec;
}

// ---------------- 时间分组（列表页：置顶 + 今天/昨天/过去7天/过去30天/按月） ----------------

export interface NoteGroup {
  key: string;
  label: string;
  /** 置顶分组标头带金色图钉 */
  pinnedSection?: boolean;
  notes: NoteRecord[];
}

/** 按 updatedAt 分组：置顶 / 今天 / 昨天 / 过去 7 天 / 过去 30 天 / YYYY年M月（倒序） */
export function groupNotes(list: NoteRecord[]): NoteGroup[] {
  const pinned = list.filter((n) => n.pinned === true);
  const rest = list.filter((n) => n.pinned !== true);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86400000;

  const buckets = new Map<string, NoteRecord[]>();
  const monthKeys: string[] = [];
  for (const n of rest) {
    const t = new Date(n.updatedAt);
    const start = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    const diffDays = Math.round((startOfToday - start) / dayMs);
    let key: string;
    if (diffDays <= 0) key = '今天';
    else if (diffDays === 1) key = '昨天';
    else if (diffDays <= 7) key = '过去 7 天';
    else if (diffDays <= 30) key = '过去 30 天';
    else {
      key = `${t.getFullYear()}年${t.getMonth() + 1}月`;
      if (!monthKeys.includes(key)) monthKeys.push(key);
    }
    const arr = buckets.get(key);
    if (arr) arr.push(n);
    else buckets.set(key, [n]);
  }
  monthKeys.sort((a, b) => (a < b ? 1 : -1));

  const groups: NoteGroup[] = [];
  if (pinned.length > 0) groups.push({ key: 'pinned', label: '置顶', pinnedSection: true, notes: pinned });
  for (const label of ['今天', '昨天', '过去 7 天', '过去 30 天']) {
    const arr = buckets.get(label);
    if (arr && arr.length > 0) groups.push({ key: label, label, notes: arr });
  }
  for (const mk of monthKeys) {
    const arr = buckets.get(mk);
    if (arr && arr.length > 0) groups.push({ key: mk, label: mk, notes: arr });
  }
  return groups;
}

// ---------------- 搜索 ----------------

/** 备忘录是否命中关键词（标题 + 正文 + 清单，大小写不敏感） */
export function noteMatches(n: NoteRecord, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  return (
    displayTitle(n).toLowerCase().includes(query) ||
    htmlToText(n.content).toLowerCase().includes(query) ||
    checklistText(n).toLowerCase().includes(query)
  );
}

/** 关键词高亮片段（搜索结果卡片用）：命中处包金色浅底 mark */
export function Hi({ text, q }: { text: string; q: string }): ReactNode {
  const t = text ?? '';
  const query = q.trim();
  if (!query) return t;
  const lower = t.toLowerCase();
  const ql = query.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i <= t.length) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) {
      if (i < t.length) parts.push(t.slice(i));
      break;
    }
    if (idx > i) parts.push(t.slice(i, idx));
    parts.push(
      <mark
        key={k++}
        className="rounded-[3px] px-0.5 text-foreground"
        style={{ backgroundColor: 'rgba(204,174,84,0.28)' }}
      >
        {t.slice(idx, idx + query.length)}
      </mark>
    );
    i = idx + query.length;
  }
  return <>{parts}</>;
}
