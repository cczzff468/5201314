'use client';

/**
 * 阅读 App · 客户端状态仓（zustand）
 * - 排版设置：本地即时生效（实时预览），300ms 防抖落库
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

  sources: SourceItem[];
  sourcesLoaded: boolean;
  loadSources: (enabledOnly?: boolean) => Promise<void>;
  setSources: (list: SourceItem[]) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useReading = create<ReadingStore>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  settingsLoaded: false,
  patchSettings: (patch, persist = true) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    if (!persist) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void api.saveSettings(get().settings).catch(() => null);
    }, 300);
  },
  loadSettings: async () => {
    try {
      const { settings } = await api.getSettings();
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
