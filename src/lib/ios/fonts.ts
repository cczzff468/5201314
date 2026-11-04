'use client';

/**
 * 全局字体库（Task 33-d）——设置 App「字体」功能的底层实现：
 * - 内置 10 款字体全部是「纯 CSS font-family 栈」（借用设备/系统已有字体，无需内置字体文件）；
 * - 自定义字体文件存独立 IndexedDB 库 `ios-phone-fonts`（与主库 db.ts 完全隔离，零升版风险），仅存本机、绝不上传服务器；
 * - 应用字体 = 把 font-family 栈写入 documentElement 的 CSS 变量 --app-font-family，
 *   body 的 font-family（globals.css）引用该变量 → 全 App 实时生效；
 * - 自定义字体通过 FontFace API 动态注册（family 名固定前缀 AppCustomFont_，纯 ASCII）；
 * - store.ts 不 import 本文件（无循环依赖）；PhoneShell 启动时调 ensureAppFontApplied() 恢复持久化的字体。
 */

import { useSettings } from './store';

// ---------------- 类型与内置字体 ----------------

/** 字体元信息：id 前缀区分类别（builtin: 内置 / custom: 本机导入） */
export interface AppFontMeta {
  id: string; // 'builtin:xxx' | 'custom:xxx'
  name: string; // 显示名
  stack: string; // CSS font-family 栈
  custom?: boolean;
  fileName?: string; // 自定义字体的原始文件名
}

/**
 * 内置字体（10 款）：全部为纯 CSS 栈——优先命中 macOS/iOS 的中文字体，
 * 依次回退 Windows 常见字体，最后 serif/sans-serif 兜底；无字体文件、零网络请求。
 */
export const BUILTIN_APP_FONTS: AppFontMeta[] = [
  {
    id: 'builtin:system',
    name: 'iOS 系统字体（默认）',
    stack: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif",
  },
  {
    id: 'builtin:pingfang',
    name: '苹方',
    stack: "'PingFang SC', 'PingFang TC', 'Helvetica Neue', sans-serif",
  },
  {
    id: 'builtin:heiti',
    name: '黑体',
    stack: "'Heiti SC', 'STHeiti', 'SimHei', 'Microsoft YaHei', sans-serif",
  },
  {
    id: 'builtin:songti',
    name: '宋体',
    stack: "'Songti SC', 'STSong', 'SimSun', 'Times New Roman', serif",
  },
  {
    id: 'builtin:kaiti',
    name: '楷体',
    stack: "'Kaiti SC', 'STKaiti', 'KaiTi', 'DFKai-SB', serif",
  },
  {
    id: 'builtin:yuanti',
    name: '圆体',
    stack: "'Yuanti SC', 'STYuan', 'Hiragino Maru Gothic ProN', 'Arial Rounded MT Bold', sans-serif",
  },
  {
    id: 'builtin:mono',
    name: '等宽字体',
    stack: "'Menlo', 'SF Mono', 'Courier New', monospace",
  },
  {
    id: 'builtin:serif',
    name: '衬线（西文优先）',
    stack: "Georgia, 'Times New Roman', 'Songti SC', serif",
  },
  {
    id: 'builtin:rounded',
    name: '圆润英文',
    stack: "'Arial Rounded MT Bold', 'Helvetica Neue', 'PingFang SC', sans-serif",
  },
  {
    id: 'builtin:yahei',
    name: '微软雅黑',
    stack: "'Microsoft YaHei', 'PingFang SC', sans-serif",
  },
];

// ---------------- 独立 IndexedDB（ios-phone-fonts / fonts） ----------------

const FONT_DB = 'ios-phone-fonts';
const FONT_STORE = 'fonts';
/** 单个字体文件大小上限：30MB（字体文件普遍 <10MB，超限大概率是选错文件） */
const MAX_FONT_BYTES = 30 * 1024 * 1024;

/** 自定义字体存储记录（blob 原样入库，列表查询时剥掉再返回） */
interface CustomFontRecord {
  id: string;
  name: string;
  fileName: string;
  blob: Blob;
  createdAt: number;
}

/** 打开字体专用 IndexedDB（自写小工具，不依赖主库 db.ts；onupgradeneeded 建库零迁移） */
function openFontDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('当前环境不支持本地存储'));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FONT_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(FONT_STORE)) {
        req.result.createObjectStore(FONT_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('字体数据库打开失败'));
  });
}

/** 列出本机导入的自定义字体（按导入时间升序；不含 blob） */
export async function listCustomFonts(): Promise<AppFontMeta[]> {
  const db = await openFontDB();
  try {
    const records = await new Promise<CustomFontRecord[]>((resolve, reject) => {
      const tx = db.transaction(FONT_STORE, 'readonly');
      const req = tx.objectStore(FONT_STORE).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as CustomFontRecord[]);
      req.onerror = () => reject(req.error ?? new Error('读取字体列表失败'));
    });
    return records
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({
        id: r.id,
        name: r.name,
        // family 名确定性可导出（FontFace 注册前后一致），预览可直接用该栈
        stack: `'${customFontFamilyOf(r.id)}', -apple-system, sans-serif`,
        custom: true,
        fileName: r.fileName,
      }));
  } finally {
    db.close();
  }
}

/** 保存自定义字体文件到本机 IndexedDB；超 30MB 抛错，返回其元信息 */
export async function saveCustomFont(fileName: string, blob: Blob): Promise<AppFontMeta> {
  if (blob.size > MAX_FONT_BYTES) {
    throw new Error('字体文件过大（超过 30MB）');
  }
  const id = `custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dot = fileName.lastIndexOf('.');
  const name = dot > 0 ? fileName.slice(0, dot) : fileName;
  const record: CustomFontRecord = { id, name, fileName, blob, createdAt: Date.now() };
  const db = await openFontDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FONT_STORE, 'readwrite');
      tx.objectStore(FONT_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('字体保存失败'));
      tx.onabort = () => reject(tx.error ?? new Error('字体保存被中断'));
    });
  } finally {
    db.close();
  }
  return {
    id,
    name,
    stack: `'${customFontFamilyOf(id)}', -apple-system, sans-serif`,
    custom: true,
    fileName,
  };
}

/** 删除本机自定义字体（不清理 FontFace 注册——已注册的面留着无副作用，页面刷新自然消失） */
export async function deleteCustomFont(id: string): Promise<void> {
  const db = await openFontDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FONT_STORE, 'readwrite');
      tx.objectStore(FONT_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('字体删除失败'));
    });
  } finally {
    db.close();
  }
}

// ---------------- FontFace 注册与应用 ----------------

/** 自定义字体的 FontFace family 名：id 去掉非字母数字（纯 ASCII，合法 CSS 标识符） */
export function customFontFamilyOf(id: string): string {
  return `AppCustomFont_${id.replace(/[^a-zA-Z0-9]/g, '')}`;
}

/** 已成功注册的 FontFace 缓存（id → family）：防止重复 new FontFace/add 同一字体 */
const loadedFamilies = new Map<string, string>();

/**
 * 读取并注册自定义字体：IndexedDB 取 blob → FontFace → load() → document.fonts.add。
 * 返回 family 名（已缓存则秒回）；字体已被删除返回 null；解析失败抛错（调用方 toast）。
 */
export async function loadCustomFontFace(id: string): Promise<string | null> {
  const cached = loadedFamilies.get(id);
  if (cached) return cached;

  const db = await openFontDB();
  let record: CustomFontRecord | undefined;
  try {
    record = await new Promise<CustomFontRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(FONT_STORE, 'readonly');
      const req = tx.objectStore(FONT_STORE).get(id);
      req.onsuccess = () => resolve(req.result as CustomFontRecord | undefined);
      req.onerror = () => reject(req.error ?? new Error('读取字体失败'));
    });
  } finally {
    db.close();
  }
  if (!record) return null; // 字体已删除

  const family = customFontFamilyOf(id);
  try {
    const buffer = await record.blob.arrayBuffer();
    const face = new FontFace(family, buffer);
    await face.load(); // 解析/加载失败在此 reject → 抛给调用方提示
    document.fonts.add(face);
  } catch {
    throw new Error(`「${record.name}」解析失败，文件可能已损坏`);
  }
  loadedFamilies.set(id, family);
  return family;
}

/**
 * 应用字体到全局（写入 documentElement 的 --app-font-family CSS 变量）：
 * - '' / 未知 id / 字体已删除 → removeProperty 回默认 iOS 系统字体；
 * - builtin:xxx → 直接写内置栈；custom:xxx → 先注册 FontFace 再写 `'family', 回退栈`。
 * 抛错时（字体解析失败）不改动现有变量，由调用方 toast。
 */
export async function applyAppFont(id: string): Promise<void> {
  const rootStyle = document.documentElement.style;
  if (!id) {
    rootStyle.removeProperty('--app-font-family');
    return;
  }
  if (id.startsWith('builtin:')) {
    const meta = BUILTIN_APP_FONTS.find((f) => f.id === id);
    if (!meta) {
      rootStyle.removeProperty('--app-font-family');
      return;
    }
    rootStyle.setProperty('--app-font-family', meta.stack);
    return;
  }
  if (id.startsWith('custom:')) {
    const family = await loadCustomFontFace(id);
    if (!family) {
      rootStyle.removeProperty('--app-font-family'); // 字体已删 → 回默认
      return;
    }
    rootStyle.setProperty('--app-font-family', `'${family}', -apple-system, sans-serif`);
    return;
  }
  rootStyle.removeProperty('--app-font-family'); // 未知 id → 回默认
}

/** 开机恢复持久化字体（族/大小/粗细）：读 store 应用；全程兜底，失败不阻塞开机（回默认） */
export async function ensureAppFontApplied(): Promise<void> {
  try {
    await applyAppFont(useSettings.getState().appFontId);
  } catch {
    // 字体恢复失败（如 IndexedDB 不可用/文件损坏）→ 保持默认字体，不阻塞启动
  }
  try {
    applyAppFontScale(useSettings.getState().appFontScale);
  } catch {
    // zoom 应用失败不影响启动
  }
  try {
    applyAppFontWeight(useSettings.getState().appFontWeight);
  } catch {
    // 字重应用失败不影响启动
  }
}

// ---------------- 字体大小 / 字重（Task 34-a） ----------------

/**
 * 字体大小档位（iOS 风格七档，Task 37 应用户要求补更小档）：倍率只作用于文字，不缩放界面框架（Task 36 修订）。
 * 实现：倍率写入 :root 的 --app-font-scale，globals.css 里按项目实际用到的
 * text-[Npx] / leading-[Npx] 任意值类逐档重写为 font-size/line-height: calc(原值 × 倍率)
 * ——按钮/行高/图标等 px 尺寸布局不变，只有文字随档位变大变小。
 * 旧方案（34-a）把 transform scale 打在手机屏容器上，「小」档连整个界面都缩小，已废弃。
 */
export const FONT_SCALE_OPTIONS: { scale: number; label: string }[] = [
  { scale: 0.7, label: '超小' },
  { scale: 0.8, label: '特小' },
  { scale: 0.9, label: '小' },
  { scale: 1, label: '标准' },
  { scale: 1.15, label: '大' },
  { scale: 1.3, label: '特大' },
  { scale: 1.45, label: '最大' },
];

/** 字重档位（Task 37 补 200 特细）：body font-weight 引用变量（未显式设 font-medium/semibold 的文本生效） */
export const FONT_WEIGHT_OPTIONS: { weight: number; label: string }[] = [
  { weight: 200, label: '特细' },
  { weight: 300, label: '细' },
  { weight: 400, label: '标准' },
  { weight: 500, label: '中' },
  { weight: 600, label: '粗' },
];

/** 应用字体大小倍率到 --app-font-scale（1 或非法值 = 移除变量回标准；消费方见 globals.css 文字缩放规则） */
export function applyAppFontScale(scale: number): void {
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale === 1) {
    document.documentElement.style.removeProperty('--app-font-scale');
    return;
  }
  document.documentElement.style.setProperty('--app-font-scale', String(scale));
}

/** 应用字重到 --app-font-weight（400 = 移除变量回默认） */
export function applyAppFontWeight(weight: number): void {
  if (weight === 400) {
    document.documentElement.style.removeProperty('--app-font-weight');
    return;
  }
  document.documentElement.style.setProperty('--app-font-weight', String(weight));
}
