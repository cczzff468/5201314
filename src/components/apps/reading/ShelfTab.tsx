'use client';

/**
 * 书架 Tab（全功能版）：
 * - 顶栏：大标题「书架」 + 搜索按钮（书架内过滤） + 三点按钮（多选管理模式）
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
} from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { api, coverSrc, CoverPlaceholder, themeOf, type ShelfBookItem } from './shared';

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
  const onCoverError = (url: string) => setCoverFails((s) => new Set(s).add(url));
  /** 本地导入 */
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState('');

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
    if (k) return shelf.filter((b) => b.name.toLowerCase().includes(k) || (b.author || '').toLowerCase().includes(k));
    let l = shelf;
    if (group === UNGROUPED) l = l.filter((b) => !b.customGroup);
    else if (group !== '全部') l = l.filter((b) => b.customGroup === group);
    return l;
  }, [shelf, group, kw]);

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
          {selectMode ? `点选书籍（已选 ${selectedCount} 本）` : `${list.length} 本书${group !== '全部' ? ` · ${group === UNGROUPED ? '未分组' : group}` : ''}`}
        </p>
      )}

      {/* 书籍网格 */}
      <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-5">
        {list.map((b) => {
          const unread = Math.max(0, b.totalChapters - b.lastReadChapter - 1);
          const cover = coverSrc(b.coverUrl, b.sourceId);
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
