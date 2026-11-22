'use client';

/**
 * 书架 Tab（全功能版）：
 * - 顶栏：大标题「书架」 + 布局切换（网格/列表） + 排序 + 搜索（书架内过滤） + 三点按钮（多选管理模式）
 * - 布局 / 排序偏好 localStorage 持久化（rd-shelf-layout / rd-shelf-sort）
 * - 自定义分组：胶囊行（全部 / 自定义分组 / +新建 / 本地导入；长按分组可重命名/删除）
 * - 书籍网格：真实封面 / 进度角标 / 长按弹出操作单（转移分组 · 移出书架）
 * - 多选模式：点选多本 → 底部玻璃操作条（全选 · 转移分组 · 移出书架）
 * - 本地导入：txt / epub 从手机上传，解析后自动入书架
 */
import { useMemo, useRef, useState } from 'react';
import {
  Search,
  EllipsisVertical,
  Plus,
  BookOpen,
  X,
  Check,
  CheckCheck,
  FolderInput,
  Trash2,
  FolderPlus,
  Pencil,
  FolderX,
  FolderUp,
  Loader2,
  LayoutGrid,
  List,
  ArrowUpDown,
  Clock,
  CalendarPlus,
  CaseSensitive,
} from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { api, coverSrc, CoverPlaceholder, themeOf, useFeaturedCovers, type ShelfBookItem } from './shared';

type Sheet =
  | { kind: 'none' }
  /** 长按书籍：转移分组 / 移出书架 */
  | { kind: 'book'; book: ShelfBookItem }
  /** 转移分组（单本或多本） */
  | { kind: 'moveGroup'; bookUrls: string[] }
  /** 长按分组：重命名 / 删除 */
  | { kind: 'groupManage'; group: string }
  /** 新建分组 / 重命名分组 输入框 */
  | { kind: 'groupInput'; rename?: string };

const UNGROUPED = '__ungrouped__';

/** 书架布局偏好（localStorage 持久化键 rd-shelf-layout） */
type ShelfLayout = 'grid' | 'list';
/** 书架排序偏好（localStorage 持久化键 rd-shelf-sort） */
type ShelfSort = 'recent' | 'added' | 'name';
const LS_LAYOUT_KEY = 'rd-shelf-layout';
const LS_SORT_KEY = 'rd-shelf-sort';

/** 读 localStorage 枚举偏好：非法值/读不到（隐私模式等）→ 回退默认值 */
function lsPref<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v !== null && (valid as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

/** 排序选项（label 同时用于书架计数行的提示文案） */
const SORT_OPTIONS: { key: ShelfSort; label: string; desc: string; icon: React.ReactNode }[] = [
  { key: 'recent', label: '最近阅读', desc: '按最后阅读时间从新到旧', icon: <Clock className="h-[18px] w-[18px]" /> },
  { key: 'added', label: '加入时间', desc: '最新加入的排在前面', icon: <CalendarPlus className="h-[18px] w-[18px]" /> },
  { key: 'name', label: '书名', desc: '按书名拼音 A → Z', icon: <CaseSensitive className="h-[18px] w-[18px]" /> },
];

/** 当前列表排序（只调顺序，不动分组）：
 *  - recent：lastReadAt 降序，无阅读时间的排到最后
 *  - added：ShelfBook 没有加入时间字段，id 是 cuid（内嵌时间戳、字典序≈创建先后），
 *    用 id 降序近似「最近加入的在前」
 *  - name：zh-Hans-CN 拼音升序 */
function sortShelf(books: ShelfBookItem[], key: ShelfSort): ShelfBookItem[] {
  const arr = [...books]; // 排序前拷贝，绝不改动 store 里的原数组
  if (key === 'added') {
    arr.sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0));
  } else if (key === 'name') {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  } else {
    const ts = (b: ShelfBookItem) => {
      const ms = Date.parse(b.lastReadAt || '');
      return Number.isFinite(ms) ? ms : 0; // 无/非法阅读时间 → 0，自然排到最后
    };
    arr.sort((a, b) => ts(b) - ts(a));
  }
  return arr;
}

export function ShelfTab({
  onOpen,
  onSearchGlobal,
}: {
  onOpen: (b: ShelfBookItem) => void;
  onSearchGlobal: () => void;
}) {
  const settings = useReading((s) => s.settings);
  const shelf = useReading((s) => s.shelf);
  const removeFromShelfBatch = useReading((s) => s.removeFromShelfBatch);
  const setGroupBatch = useReading((s) => s.setGroupBatch);
  const loadShelf = useReading((s) => s.loadShelf);
  const patch = useReading((s) => s.patchSettings);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);

  const [searchOn, setSearchOn] = useState(false);
  const [kw, setKw] = useState('');
  const [group, setGroup] = useState('全部');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<Sheet>({ kind: 'none' });
  const [groupNameInput, setGroupNameInput] = useState('');
  /** 「新建分组并转入」时待转移的书（创建成功后一并入组） */
  const [pendingMoveUrls, setPendingMoveUrls] = useState<string[]>([]);
  /** 长按计时器 */
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pressBook, setPressBook] = useState<ShelfBookItem | null>(null);
  /** 封面加载失败地址（死链/防盗链）→ 回退书脊风占位图，不显示破图 */
  const [coverFails, setCoverFails] = useState<Set<string>>(new Set());
  /** 没有封面记录的书 → 跨源封面缓存兜底（书源有封面就用那个封面） */
  const coverlessNames = useMemo(() => shelf.filter((b) => !b.coverUrl).map((b) => b.name), [shelf]);
  const { covers: hookedCovers, retry: retryCover } = useFeaturedCovers(coverlessNames);
  const onCoverError = (url: string) => {
    setCoverFails((s) => new Set(s).add(url));
    const name = coverlessNames.find((n) => hookedCovers[n] === url);
    if (name) retryCover(name); // 跨源封面也挂了 → 服务端换地址重搜一次
  };
  /** 取可用封面地址（coverSrc 优先 → 跨源封面兜底；是否回退占位图由渲染处的 coverFails 决定） */
  const coverOf = (b: ShelfBookItem) => {
    const hooked = hookedCovers[b.name];
    return coverSrc(b.coverUrl, b.sourceId) || (hooked && !coverFails.has(hooked) ? hooked : undefined);
  };
  /** 本地导入 */
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState('');

  /** 布局 / 排序偏好（localStorage 持久化；本 App 经 dynamic(ssr:false) 挂载，初始化可直接读 localStorage，无水合不一致问题） */
  const [layout, setLayout] = useState<ShelfLayout>(() => lsPref(LS_LAYOUT_KEY, ['grid', 'list'], 'grid'));
  const [sortKey, setSortKey] = useState<ShelfSort>(() => lsPref(LS_SORT_KEY, ['recent', 'added', 'name'], 'recent'));
  const [sortOpen, setSortOpen] = useState(false);
  const applyLayout = (l: ShelfLayout) => {
    setLayout(l);
    try {
      window.localStorage.setItem(LS_LAYOUT_KEY, l);
    } catch {
      /* 写不进也不影响本次会话内生效 */
    }
  };
  const applySort = (k: ShelfSort) => {
    setSortKey(k);
    setSortOpen(false);
    try {
      window.localStorage.setItem(LS_SORT_KEY, k);
    } catch {
      /* 写不进也不影响本次会话内生效 */
    }
  };

  const notify = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(''), 2400);
  };

  const onLocalFile = async (f: File | undefined) => {
    if (!f) return;
    setImporting(true);
    notify(`正在导入《${f.name.replace(/\.[^.]+$/, '')}》…`);
    try {
      const r = await api.localUpload(f);
      notify(`导入成功：《${r.name}》共 ${r.chapters} 章`);
      await loadShelf();
    } catch (e) {
      notify(e instanceof Error ? e.message : '导入失败');
    }
    setImporting(false);
  };

  const groups = settings.customGroups || [];
  const hasUngrouped = shelf.some((b) => !b.customGroup) && groups.length > 0;

  const list = useMemo(() => {
    const k = kw.trim().toLowerCase();
    // 搜索时跨全部分组找书（用户预期：搜书架 = 搜整个书架）
    let l: ShelfBookItem[];
    if (k) l = shelf.filter((b) => b.name.toLowerCase().includes(k) || (b.author || '').toLowerCase().includes(k));
    else if (group === UNGROUPED) l = shelf.filter((b) => !b.customGroup);
    else if (group !== '全部') l = shelf.filter((b) => b.customGroup === group);
    else l = shelf;
    // 排序只调整当前列表的显示顺序，不改变分组归属
    return sortShelf(l, sortKey);
  }, [shelf, group, kw, sortKey]);

  const glass = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;
  const selectedCount = selected.size;

  // ---------------- 分组管理 ----------------
  const createGroup = () => {
    const name = groupNameInput.trim().slice(0, 20);
    if (!name) return;
    if (!groups.includes(name)) patch({ customGroups: [...groups, name] });
    // 「新建分组并转入」：把待转移的书一并入组
    if (pendingMoveUrls.length) void setGroupBatch(pendingMoveUrls, name);
    setPendingMoveUrls([]);
    setGroupNameInput('');
    setSheet({ kind: 'none' });
    setSelected(new Set());
    setGroup(name);
  };
  const renameGroup = (oldName: string) => {
    const name = groupNameInput.trim().slice(0, 20);
    if (!name || name === oldName) {
      setSheet({ kind: 'none' });
      return;
    }
    patch({ customGroups: groups.map((g) => (g === oldName ? name : g)) });
    // 书籍分组同步迁移
    const urls = shelf.filter((b) => b.customGroup === oldName).map((b) => b.bookUrl);
    if (urls.length) void setGroupBatch(urls, name);
    if (group === oldName) setGroup(name);
    setSheet({ kind: 'none' });
  };
  const deleteGroup = (name: string) => {
    patch({ customGroups: groups.filter((g) => g !== name) });
    const urls = shelf.filter((b) => b.customGroup === name).map((b) => b.bookUrl);
    if (urls.length) void setGroupBatch(urls, null);
    if (group === name) setGroup('全部');
    setSheet({ kind: 'none' });
  };

  // ---------------- 长按书籍 ----------------
  const startPress = (b: ShelfBookItem) => {
    setPressBook(b);
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      setPressBook(null);
      setSheet({ kind: 'book', book: b });
    }, 520);
  };
  const cancelPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
      setPressBook(null);
    }
  };

  const toggleSelect = (bookUrl: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(bookUrl)) n.delete(bookUrl);
      else n.add(bookUrl);
      return n;
    });
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  return (
    <div className="px-4">
      {/* 顶栏 */}
      <div className="flex items-end justify-between">
        <h1 className="text-[30px] font-bold leading-tight" style={{ color: theme.textMain }}>
          书架
        </h1>
        <div className="flex gap-2.5">
          {/* 布局切换（网格 ⇄ 列表，图标显示将要切到的布局） */}
          <button
            type="button"
            onClick={() => applyLayout(layout === 'grid' ? 'list' : 'grid')}
            aria-label={layout === 'grid' ? '切换为列表布局' : '切换为网格布局'}
            className="flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-xl active:scale-90"
            style={{ ...glass, color: theme.textMain }}
          >
            {layout === 'grid' ? <List className="h-5 w-5" strokeWidth={2.2} /> : <LayoutGrid className="h-5 w-5" strokeWidth={2.2} />}
          </button>
          {/* 排序（非默认排序时用主题色高亮） */}
          <button
            type="button"
            onClick={() => setSortOpen(true)}
            aria-label="书架排序"
            className="flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-xl active:scale-90"
            style={{ ...glass, color: sortKey === 'recent' ? theme.textMain : theme.accent }}
          >
            <ArrowUpDown className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (searchOn) setKw('');
              setSearchOn((v) => !v);
            }}
            aria-label="搜索书架"
            className={`flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-xl active:scale-90 ${searchOn ? 'text-white' : ''}`}
            style={searchOn ? { background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` } : { ...glass, color: theme.textMain }}
          >
            {searchOn ? <X className="h-5 w-5" strokeWidth={2.2} /> : <Search className="h-5 w-5" strokeWidth={2.2} />}
          </button>
          <button
            type="button"
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            aria-label={selectMode ? '完成' : '管理'}
            className={`flex h-11 items-center justify-center rounded-full px-4 text-[13px] font-semibold backdrop-blur-xl active:scale-95 ${selectMode ? 'text-white' : ''}`}
            style={
              selectMode
                ? { background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }
                : { ...glass, color: theme.textMain }
            }
          >
            {selectMode ? '完成' : <EllipsisVertical className="h-5 w-5" strokeWidth={2.2} />}
          </button>
        </div>
      </div>

      {/* 书架内搜索条 */}
      {searchOn && (
        <div className="mt-3 flex h-11 items-center gap-2 rounded-full px-4 backdrop-blur-xl" style={glass}>
          <Search className="h-[18px] w-[18px] shrink-0" style={{ color: theme.textSub }} strokeWidth={2.2} />
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="搜索书架里的书"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            style={{ color: theme.textMain }}
            aria-label="搜索书架"
            autoFocus
          />
          {kw && (
            <button type="button" onClick={() => setKw('')} aria-label="清空" className="shrink-0" style={{ color: theme.textSub }}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* 分组胶囊行（自适应换行，无横向滚动） */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {['全部', ...groups, ...(hasUngrouped ? [UNGROUPED] : [])].map((g) => {
          const label = g === UNGROUPED ? '未分组' : g;
          const active = g === group;
          return (
            <button
              key={g}
              type="button"
              onClick={() => setGroup(g)}
              onContextMenu={(e) => {
                if (g !== '全部' && g !== UNGROUPED) {
                  e.preventDefault();
                  setSheet({ kind: 'groupManage', group: g });
                }
              }}
              onTouchStart={() => {
                if (g !== '全部' && g !== UNGROUPED) {
                  pressTimer.current = setTimeout(() => {
                    pressTimer.current = null;
                    setSheet({ kind: 'groupManage', group: g });
                  }, 520);
                }
              }}
              onTouchEnd={cancelPress}
              onTouchMove={cancelPress}
              className={`h-8 max-w-full truncate rounded-full px-4 text-[13px] font-medium backdrop-blur-xl active:scale-95 ${active ? 'text-white' : ''}`}
              style={
                active
                  ? { background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, boxShadow: `0 4px 14px ${theme.accent}44` }
                  : { ...glass, color: theme.textMain }
              }
            >
              {label}
            </button>
          );
        })}
        {/* 新建分组 */}
        <button
          type="button"
          onClick={() => {
            setGroupNameInput('');
            setSheet({ kind: 'groupInput' });
          }}
          aria-label="新建分组"
          className="flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium backdrop-blur-xl active:scale-95"
          style={{ ...glass, color: theme.accent }}
        >
          <FolderPlus className="h-3.5 w-3.5" /> 分组
        </button>
        {/* 本地导入（txt / epub） */}
        <button
          type="button"
          disabled={importing}
          onClick={() => fileRef.current?.click()}
          aria-label="从本地导入书籍"
          className="flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium backdrop-blur-xl active:scale-95 disabled:opacity-50"
          style={{ ...glass, color: theme.accent }}
        >
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderUp className="h-3.5 w-3.5" />} 本地导入
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.epub,text/plain,application/epub+zip"
          className="hidden"
          onChange={(e) => {
            void onLocalFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {/* 空状态 */}
      {list.length === 0 ? (
        <div className="mt-24 flex flex-col items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full" style={{ background: theme.accentSoft, color: theme.accent }}>
            <Plus className="h-9 w-9" strokeWidth={2} />
          </div>
          <p className="text-[15px]" style={{ color: theme.textSub }}>
            {kw ? '书架里没有匹配的书' : '书架空空的，去找几本书吧'}
          </p>
          {!kw && (
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={onSearchGlobal}
                className="rounded-full px-6 py-2.5 text-[14px] font-semibold text-white active:scale-95"
                style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, boxShadow: `0 6px 20px ${theme.accent}55` }}
              >
                去找书
              </button>
              <button
                type="button"
                disabled={importing}
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 rounded-full px-5 py-2.5 text-[14px] font-semibold backdrop-blur-xl active:scale-95 disabled:opacity-50"
                style={{ ...glass, color: theme.accent }}
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderUp className="h-4 w-4" />} 本地导入
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-2 px-1 text-[11px]" style={{ color: theme.textSub }}>
          {selectMode
            ? `点选书籍（已选 ${selectedCount} 本）`
            : `${list.length} 本书${group !== '全部' ? ` · ${group === UNGROUPED ? '未分组' : group}` : ''} · 排序：${SORT_OPTIONS.find((s) => s.key === sortKey)?.label ?? '最近阅读'}`}
        </p>
      )}

      {/* 书籍网格（默认布局，样式保持不变） */}
      {layout === 'grid' && (
        <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-5">
          {list.map((b) => {
            const unread = Math.max(0, b.totalChapters - b.lastReadChapter - 1);
            const cover = coverOf(b);
            const checked = selected.has(b.bookUrl);
            return (
              <div key={b.bookUrl} className="relative">
                <button
                  type="button"
                  onClick={() => (selectMode ? toggleSelect(b.bookUrl) : onOpen(b))}
                  onTouchStart={() => {
                    if (!selectMode) startPress(b);
                  }}
                  onTouchEnd={cancelPress}
                  onTouchMove={cancelPress}
                  onContextMenu={(e) => {
                    if (!selectMode) {
                      e.preventDefault();
                      setSheet({ kind: 'book', book: b });
                    }
                  }}
                  className="w-full text-left active:scale-95"
                >
                  <div
                    className={`relative aspect-[3/4.2] w-full overflow-hidden rounded-xl shadow-[0_6px_18px_rgba(0,0,0,0.12)] ring-1 ring-black/5 transition-transform ${pressBook?.bookUrl === b.bookUrl ? 'scale-95' : ''}`}
                  >
                    {cover && !coverFails.has(cover) ? (
                      <img src={cover} alt={`${b.name} 封面`} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => onCoverError(cover)} />
                    ) : (
                      <CoverPlaceholder name={b.name} author={b.author} className="h-full w-full" radius="rounded-none" />
                    )}
                    {/* 阅读进度玻璃胶囊 */}
                    <span className="absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-md" style={{ background: 'rgba(0,0,0,0.38)' }}>
                      {b.lastReadChapter + 1}/{b.totalChapters}
                    </span>
                    {unread > 0 && !selectMode && (
                      <span className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[10px] font-medium text-white">
                        {unread}章未读
                      </span>
                    )}
                    {/* 分组角标 */}
                    {!selectMode && b.customGroup && (
                      <span className="absolute right-1 top-1 max-w-[70%] truncate rounded-full px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-md" style={{ background: 'rgba(0,0,0,0.38)' }}>
                        {b.customGroup}
                      </span>
                    )}
                    {/* 多选圈 */}
                    {selectMode && (
                      <span
                        className={`absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 backdrop-blur-md ${checked ? 'border-white' : 'border-white/70'}`}
                        style={checked ? { background: theme.accent } : { background: 'rgba(0,0,0,0.30)' }}
                      >
                        {checked && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-[13px] font-semibold" style={{ color: theme.textMain }}>
                    {b.name}
                  </p>
                  <p className="flex items-center gap-0.5 truncate text-[11px]" style={{ color: theme.textSub }}>
                    <BookOpen className="h-3 w-3 shrink-0" />
                    {b.sourceName || '未知源'}
                  </p>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 书籍列表（横向卡片：封面 + 书名/作者/进度 + 细进度条） */}
      {layout === 'list' && (
        <div className="mt-2 flex flex-col gap-2">
          {list.map((b) => {
            const cover = coverOf(b);
            const checked = selected.has(b.bookUrl);
            // 已读章节占总章节的比例 → 底部细进度条宽度
            const pct = b.totalChapters > 0 ? Math.min(100, Math.round(((b.lastReadChapter + 1) / b.totalChapters) * 100)) : 0;
            return (
              <div key={b.bookUrl} className="relative">
                <button
                  type="button"
                  onClick={() => (selectMode ? toggleSelect(b.bookUrl) : onOpen(b))}
                  onTouchStart={() => {
                    if (!selectMode) startPress(b);
                  }}
                  onTouchEnd={cancelPress}
                  onTouchMove={cancelPress}
                  onContextMenu={(e) => {
                    if (!selectMode) {
                      e.preventDefault();
                      setSheet({ kind: 'book', book: b });
                    }
                  }}
                  className={`flex w-full items-center gap-3 rounded-2xl p-2.5 text-left backdrop-blur-xl transition-transform active:scale-95 ${pressBook?.bookUrl === b.bookUrl ? 'scale-95' : ''}`}
                  style={glass}
                >
                  {/* 封面（52x70 圆角） */}
                  <span className="relative block h-[70px] w-[52px] shrink-0 overflow-hidden rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.12)] ring-1 ring-black/5">
                    {cover && !coverFails.has(cover) ? (
                      <img src={cover} alt={`${b.name} 封面`} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => onCoverError(cover)} />
                    ) : (
                      <CoverPlaceholder name={b.name} author={b.author} className="h-full w-full" radius="rounded-none" />
                    )}
                  </span>
                  {/* 书名 / 作者 / 进度 + 细进度条 */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold" style={{ color: theme.textMain }}>
                      {b.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px]" style={{ color: theme.textSub }}>
                      {b.author || '佚名'} · {b.sourceName || '未知源'}
                    </span>
                    <span className="mt-1 block truncate text-[12px] tabular-nums" style={{ color: theme.textSub }}>
                      第 {b.lastReadChapter + 1}/{b.totalChapters} 章
                    </span>
                    <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full" style={{ background: theme.accentSoft }}>
                      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: theme.accent }} />
                    </span>
                  </span>
                </button>
                {/* 多选勾选角标（列表行左侧，压在封面左上角） */}
                {selectMode && (
                  <span
                    className={`pointer-events-none absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border-2 backdrop-blur-md ${checked ? 'border-white' : 'border-white/70'}`}
                    style={checked ? { background: theme.accent } : { background: 'rgba(0,0,0,0.30)' }}
                  >
                    {checked && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 多选底部操作条（脱离滚动的玻璃条，悬于 TabBar 之上） */}
      {selectMode && (
        <div className="pointer-events-none absolute inset-x-3 bottom-[max(86px,calc(env(safe-area-inset-bottom)+74px))] z-30">
          <div
            className="pointer-events-auto flex items-center gap-1 rounded-full px-3 py-2 backdrop-blur-2xl"
            style={{ background: theme.barBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 10px 32px rgba(0,0,0,0.16)` }}
          >
            <button
              type="button"
              onClick={() => setSelected(selectedCount === list.length ? new Set() : new Set(list.map((b) => b.bookUrl)))}
              className="flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-medium active:scale-95"
              style={{ color: theme.accent }}
            >
              <CheckCheck className="h-4 w-4" />
              {selectedCount === list.length && list.length > 0 ? '全不选' : '全选'}
            </button>
            <div className="min-w-0 flex-1 text-center text-[12px] font-semibold tabular-nums" style={{ color: theme.textMain }}>
              已选 {selectedCount} 本
            </div>
            <button
              type="button"
              disabled={!selectedCount}
              onClick={() => setSheet({ kind: 'moveGroup', bookUrls: [...selected] })}
              className="flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-white active:scale-95 disabled:opacity-40"
              style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }}
            >
              <FolderInput className="h-4 w-4" /> 分组
            </button>
            <button
              type="button"
              disabled={!selectedCount}
              onClick={async () => {
                await removeFromShelfBatch([...selected]);
                setSelected(new Set());
              }}
              className="flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-semibold active:scale-95 disabled:opacity-40"
              style={{ color: '#E05252' }}
            >
              <Trash2 className="h-4 w-4" /> 移出
            </button>
          </div>
        </div>
      )}

      {/* ---------- 弹层区 ---------- */}
      {sheet.kind !== 'none' && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="操作">
          <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setSheet({ kind: 'none' })} />
          {/* 长按书籍操作单 */}
          {sheet.kind === 'book' && (
            <div
              className="absolute inset-x-3 bottom-[max(16px,env(safe-area-inset-bottom))] rounded-3xl p-2 shadow-2xl backdrop-blur-2xl"
              style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 -8px 40px rgba(0,0,0,0.16)` }}
            >
              <div className="flex items-center gap-3 px-3 pb-2 pt-1.5">
                {(() => {
                  const c = coverSrc(sheet.book.coverUrl, sheet.book.sourceId);
                  return c && !coverFails.has(c) ? (
                    <img src={c} alt="" className="h-11 w-8 rounded-md object-cover ring-1 ring-black/5" referrerPolicy="no-referrer" onError={() => onCoverError(c)} />
                  ) : (
                    <CoverPlaceholder name={sheet.book.name} className="h-11 w-8" radius="rounded-md" />
                  );
                })()}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold" style={{ color: theme.textMain }}>
                    {sheet.book.name}
                  </p>
                  <p className="truncate text-[11px]" style={{ color: theme.textSub }}>
                    {sheet.book.author || '佚名'} · {sheet.book.customGroup ? `分组：${sheet.book.customGroup}` : '未分组'}
                  </p>
                </div>
              </div>
              <div className="h-px" style={{ background: theme.cardRing }} />
              <SheetRow
                icon={<FolderInput className="h-[18px] w-[18px]" />}
                label="转移分组"
                desc={sheet.book.customGroup ? `当前在「${sheet.book.customGroup}」` : '当前未分组'}
                color={theme.accent}
                theme={theme}
                onClick={() => setSheet({ kind: 'moveGroup', bookUrls: [sheet.book.bookUrl] })}
              />
              <SheetRow
                icon={<Trash2 className="h-[18px] w-[18px]" />}
                label="移出书架"
                desc="阅读历史会保留"
                color="#E05252"
                theme={theme}
                onClick={async () => {
                  await removeFromShelfBatch([sheet.book.bookUrl]);
                  setSheet({ kind: 'none' });
                }}
              />
            </div>
          )}

          {/* 转移分组选择 */}
          {sheet.kind === 'moveGroup' && (
            <div
              className="absolute inset-x-3 bottom-[max(16px,env(safe-area-inset-bottom))] max-h-[62%] overflow-y-auto rounded-3xl p-2 shadow-2xl backdrop-blur-2xl"
              style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 -8px 40px rgba(0,0,0,0.16)` }}
            >
              <p className="px-3 pb-1 pt-2 text-[13px] font-semibold" style={{ color: theme.textSub }}>
                转移 {sheet.bookUrls.length} 本到分组
              </p>
              {groups.map((g) => (
                <SheetRow
                  key={g}
                  icon={<FolderInput className="h-[18px] w-[18px]" />}
                  label={g}
                  color={theme.accent}
                  theme={theme}
                  onClick={async () => {
                    await setGroupBatch(sheet.bookUrls, g);
                    setSheet({ kind: 'none' });
                    setSelected(new Set());
                  }}
                />
              ))}
              <SheetRow
                icon={<FolderX className="h-[18px] w-[18px]" />}
                label="移到未分组"
                color={theme.accent}
                theme={theme}
                onClick={async () => {
                  await setGroupBatch(sheet.bookUrls, null);
                  setSheet({ kind: 'none' });
                  setSelected(new Set());
                }}
              />
              <SheetRow
                icon={<FolderPlus className="h-[18px] w-[18px]" />}
                label="新建分组并转入"
                color={theme.accent}
                theme={theme}
                onClick={() => {
                  setGroupNameInput('');
                  setPendingMoveUrls(sheet.bookUrls);
                  setSheet({ kind: 'groupInput' });
                }}
              />
            </div>
          )}

          {/* 分组管理（长按分组） */}
          {sheet.kind === 'groupManage' && (
            <div
              className="absolute inset-x-3 bottom-[max(16px,env(safe-area-inset-bottom))] rounded-3xl p-2 shadow-2xl backdrop-blur-2xl"
              style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 -8px 40px rgba(0,0,0,0.16)` }}
            >
              <p className="px-4 pb-1 pt-2 text-[13px] font-semibold" style={{ color: theme.textSub }}>
                分组「{sheet.group}」 · {shelf.filter((b) => b.customGroup === sheet.group).length} 本书
              </p>
              <SheetRow
                icon={<Pencil className="h-[18px] w-[18px]" />}
                label="重命名分组"
                color={theme.accent}
                theme={theme}
                onClick={() => {
                  setGroupNameInput(sheet.group);
                  setSheet({ kind: 'groupInput', rename: sheet.group });
                }}
              />
              <SheetRow
                icon={<FolderX className="h-[18px] w-[18px]" />}
                label="删除分组（书移到未分组）"
                color="#E05252"
                theme={theme}
                onClick={() => deleteGroup(sheet.group)}
              />
            </div>
          )}

          {/* 新建/重命名分组输入 */}
          {sheet.kind === 'groupInput' && (
            <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 rounded-3xl p-5 shadow-2xl backdrop-blur-2xl" style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}` }}>
              <p className="text-[15px] font-semibold" style={{ color: theme.textMain }}>
                {sheet.rename && sheet.rename !== '__move__' ? '重命名分组' : '新建分组'}
              </p>
              <input
                value={groupNameInput}
                onChange={(e) => setGroupNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (sheet.rename && sheet.rename !== '__move__') renameGroup(sheet.rename);
                    else createGroup();
                  }
                }}
                placeholder="分组名（最多 20 字）"
                maxLength={20}
                className="mt-3 h-11 w-full rounded-xl bg-black/[0.05] px-3 text-[14px] outline-none"
                style={{ color: theme.textMain }}
                autoFocus
              />
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setSheet({ kind: 'none' })}
                  className="h-10 flex-1 rounded-full text-[14px] font-medium"
                  style={{ ...glass, color: theme.textMain }}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (sheet.rename && sheet.rename !== '__move__') renameGroup(sheet.rename);
                    else createGroup();
                  }}
                  disabled={!groupNameInput.trim()}
                  className="h-10 flex-1 rounded-full text-[14px] font-semibold text-white disabled:opacity-40"
                  style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }}
                >
                  {sheet.rename && sheet.rename !== '__move__' ? '保存' : '创建'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 排序抽屉（底部玻璃 sheet） */}
      {sortOpen && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="书架排序">
          <button type="button" aria-label="关闭排序" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setSortOpen(false)} />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-3xl p-3 pb-[max(16px,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl"
            style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 -12px 48px rgba(0,0,0,0.18)` }}
          >
            <p className="px-3 pb-0.5 pt-2 text-[15px] font-bold" style={{ color: theme.textMain }}>
              排序方式
            </p>
            <p className="px-3 pb-1 text-[11px]" style={{ color: theme.textSub }}>
              只调整当前列表的顺序，不影响分组
            </p>
            {SORT_OPTIONS.map((o) => {
              const active = o.key === sortKey;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => applySort(o.key)}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left active:bg-black/[0.03]"
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={active ? { background: theme.accent, color: '#fff' } : { background: theme.accentSoft, color: theme.accent }}
                  >
                    {o.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium" style={{ color: active ? theme.accent : theme.textMain }}>
                      {o.label}
                    </span>
                    <span className="block truncate text-[11px]" style={{ color: theme.textSub }}>
                      {o.desc}
                    </span>
                  </span>
                  {active && <Check className="h-[18px] w-[18px] shrink-0" strokeWidth={2.5} style={{ color: theme.accent }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 轻提示 */}
      {toast && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-[60] flex justify-center px-6">
          <span className="rounded-full bg-black/75 px-4 py-2 text-center text-[13px] text-white backdrop-blur">{toast}</span>
        </div>
      )}
    </div>
  );
}

/** 操作单行 */
function SheetRow({
  icon,
  label,
  desc,
  color,
  theme,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  desc?: string;
  color: string;
  theme: ReturnType<typeof themeOf>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left active:bg-black/[0.03]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: theme.accentSoft, color }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium" style={{ color: theme.textMain }}>
          {label}
        </span>
        {desc && (
          <span className="block truncate text-[11px]" style={{ color: theme.textSub }}>
            {desc}
          </span>
        )}
      </span>
    </button>
  );
}
