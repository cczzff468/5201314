'use client';

/**
 * 阅读 App · 客户端状态仓（zustand）
 * - 排版设置：本地即时生效（实时预览），300ms 防抖落库
 * - 【永久保存】localStorage 双写镜像：每次改动同步写本地，页面刷新秒恢复；
 *   服务端为第二副本（pagehide 时 flush + keepalive 兜底，刷新/关闭不丢）
 * - 主题不被覆盖修复：loadSettings 带本地版本守卫——fetch 期间若用户改过设置
 *   （如切换主题），服务器旧值不再回灌覆盖本地选择
 * - 书架 / 书源列表缓存
 */
import { create } from 'zustand';
import { api, DEFAULT_SETTINGS, type ReaderSettings, type ShelfBookItem, type SourceItem } from '@/components/apps/reading/shared';

/** localStorage 镜像键（排版永久保存的本地副本） */
const LS_SETTINGS_KEY = 'rd-settings-mirror-v1';
/** 音量键翻页一次性迁移标记（早期默认关闭，老镜像/服务端存了 false → 迁移为开） */
const LS_KEYTURN_MIG = 'rd-keyturn-mig-v1';

/** 音量键翻页一次性迁移：早期版本 keyTurn 默认 false，老用户镜像/服务端里存的是
 *  「从未主动选择」的 false —— 用户明确要求音量键翻页可用，首次加载迁移为开启；
 *  迁移只做一次，之后手动关掉的不再打扰。 */
function migrateKeyTurnOnce(s: ReaderSettings): ReaderSettings {
  if (typeof window === 'undefined' || s.keyTurn !== false) return s;
  try {
    if (localStorage.getItem(LS_KEYTURN_MIG)) return s;
    localStorage.setItem(LS_KEYTURN_MIG, '1');
    return { ...s, keyTurn: true };
  } catch {
    return s;
  }
}

/** 读取本地镜像（异常/缺字段兜底为默认值） */
function readMirror(): ReaderSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return migrateKeyTurnOnce({ ...DEFAULT_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** 写本地镜像（超配额时降级：剔除大 dataURL 字段再写） */
function writeMirror(s: ReaderSettings) {
  if (typeof window === 'undefined') return;
  const put = (obj: ReaderSettings) => localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(obj));
  try {
    put(s);
  } catch {
    try {
      put({
        ...s,
        bgCustom: null,
        fontCustom: null,
        profileAvatar: null,
      });
    } catch {
      /* 彻底放不下就算了（服务端仍有副本） */
    }
  }
}

interface ReadingStore {
  settings: ReaderSettings;
  settingsLoaded: boolean;
  /** 本地立即改（实时预览），后台防抖保存 */
  patchSettings: (patch: Partial<ReaderSettings>, persist?: boolean) => void;
  loadSettings: () => Promise<void>;
  /** 立即落库（pagehide / 关闭前调用，keepalive 请求） */
  flushSettings: () => void;

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
/** 距上次落库是否有未保存改动 */
let dirty = false;

async function saveToServer(s: ReaderSettings, keepalive = false) {
  try {
    await fetch('/api/reading/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
      ...(keepalive ? { keepalive: true } : {}),
    });
    dirty = false;
  } catch {
    /* 失败保留 dirty，下次再试 */
  }
}

export const useReading = create<ReadingStore>((set, get) => ({
  // 初始值优先本地镜像：刷新后设置秒恢复（不等网络）
  settings: readMirror(),
  settingsLoaded: false,
  patchSettings: (patch, persist = true) => {
    localRev++;
    dirty = true;
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    writeMirror(next); // 本地镜像同步写（永久保存第一层）
    if (!persist) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveToServer(get().settings);
    }, 300);
  },
  loadSettings: async () => {
    const revAtStart = localRev;
    const local = get().settings;
    try {
      const { settings } = await api.getSettings();
      if (localRev !== revAtStart) {
        // fetch 期间用户改过设置（主题/排版等）→ 服务器旧值不回灌，本地为准
        set({ settingsLoaded: true });
        return;
      }
      const server = { ...DEFAULT_SETTINGS, ...settings };
      const hasMirror = typeof window !== 'undefined' && !!localStorage.getItem(LS_SETTINGS_KEY);
      if (hasMirror) {
        // 本地镜像存在：客户端为准（镜像与服务端一致时无感；不一致说明上次落库
        // 被中断——保留本地并把本地推回服务端，保证「改过的设置永不丢」）
        set({ settingsLoaded: true });
        const diff = JSON.stringify(local) !== JSON.stringify(server);
        if (diff && localRev === revAtStart) void saveToServer(local);
        return;
      }
      // 无镜像（首次/清缓存）：采用服务端保存的值（含音量键翻页一次性迁移）
      const serverMigrated = migrateKeyTurnOnce({ ...DEFAULT_SETTINGS, ...settings });
      set({ settings: serverMigrated, settingsLoaded: true });
      writeMirror(serverMigrated);
    } catch {
      set({ settingsLoaded: true });
    }
  },
  flushSettings: () => {
    if (!dirty) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    void saveToServer(get().settings, true);
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

// 页面隐藏/关闭前强制落库（keepalive 请求能穿越页面卸载）
if (typeof window !== 'undefined') {
  const flush = () => useReading.getState().flushSettings();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
