'use client';

/**
 * 阅读 App · 客户端状态仓（zustand）
 * - 排版设置：本地即时生效（实时预览），300ms 防抖落库
 * - 主题不被覆盖修复：loadSettings 带本地版本守卫——fetch 期间若用户改过设置
 *   （如切换主题），服务器旧值不再回灌覆盖本地选择
 * - 书架 / 书源列表缓存
 */
import { create } from 'zustand';
import { api, DEFAULT_SETTINGS, type ReaderSettings, type ShelfBookItem, type SourceItem } from '@/components/apps/reading/shared';

interface ReadingStore {
  settings: ReaderSettings;
  settingsLoaded: boolean;
  /** 本地立即改（实时预览），后台防抖保存 */
  patchSettings: (patch: Partial<ReaderSettings>, persist?: boolean) => void;
  loadSettings: () => Promise<void>;

  shelf: ShelfBookItem[];
  shelfLoaded: boolean;
  loadShelf: () => Promise<void>;
  removeFromShelf: (bookUrl: string) => Promise<void>;
  /** 批量移出书架 */
  removeFromShelfBatch: (bookUrls: string[]) => Promise<void>;
  /** 转移分组（null = 未分组） */
  setGroupBatch: (bookUrls: string[], group: string | null) => Promise<void>;

  sources: SourceItem[];
  sourcesLoaded: boolean;
  loadSources: (enabledOnly?: boolean) => Promise<void>;
  setSources: (list: SourceItem[]) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 本地修改版本号：每次 patchSettings 自增；loadSettings 用它判断是否回灌 */
let localRev = 0;

export const useReading = create<ReadingStore>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  settingsLoaded: false,
  patchSettings: (patch, persist = true) => {
    localRev++;
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    if (!persist) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void api.saveSettings(get().settings).catch(() => null);
    }, 300);
  },
  loadSettings: async () => {
    const revAtStart = localRev;
    try {
      const { settings } = await api.getSettings();
      // fetch 期间用户改过设置（主题/排版等）→ 服务器旧值不回灌，本地为准
      if (localRev !== revAtStart) {
        set({ settingsLoaded: true });
        return;
      }
      set({ settings: { ...DEFAULT_SETTINGS, ...settings }, settingsLoaded: true });
    } catch {
      set({ settingsLoaded: true });
    }
  },

  shelf: [],
  shelfLoaded: false,
  loadShelf: async () => {
    try {
      const { books } = await api.shelfList();
      set({ shelf: books, shelfLoaded: true });
    } catch {
      set({ shelfLoaded: true });
    }
  },
  removeFromShelf: async (bookUrl) => {
    set((s) => ({ shelf: s.shelf.filter((b) => b.bookUrl !== bookUrl) }));
    await api.shelfAction({ action: 'remove', bookUrl }).catch(() => null);
  },
  removeFromShelfBatch: async (bookUrls) => {
    if (!bookUrls.length) return;
    const set_ = new Set(bookUrls);
    set((s) => ({ shelf: s.shelf.filter((b) => !set_.has(b.bookUrl)) }));
    await api.shelfAction({ action: 'remove', bookUrls }).catch(() => null);
  },
  setGroupBatch: async (bookUrls, group) => {
    if (!bookUrls.length) return;
    const set_ = new Set(bookUrls);
    set((s) => ({
      shelf: s.shelf.map((b) => (set_.has(b.bookUrl) ? { ...b, customGroup: group } : b)),
    }));
    await api.shelfAction({ action: 'setGroup', bookUrls, group }).catch(() => null);
  },

  sources: [],
  sourcesLoaded: false,
  loadSources: async (enabledOnly = false) => {
    try {
      const { sources } = await api.listSources(enabledOnly);
      set({ sources, sourcesLoaded: true });
    } catch {
      set({ sourcesLoaded: true });
    }
  },
  setSources: (list) => set({ sources: list }),
}));
