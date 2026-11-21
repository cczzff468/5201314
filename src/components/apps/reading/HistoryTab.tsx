'use client';

/**
 * 历史 Tab：看过的书都在这里（阅读历史，独立于书架；按书源区分）
 * - 列表：真实封面 + 书名 + 进度（第x/y章 · 上次看到的章节标题）+ 相对时间
 * - 点击 → 从上次看到的地方继续读（章节+页码记忆）
 * - 右上角三点 → 多选模式（全选 · 加入书架 · 删除）
 * - 长按 → 弹窗：删除 / 加入书架
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { EllipsisVertical, BookOpen, Search, Clock3, Check, CheckCheck, Trash2, FolderPlus, X } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { api, coverSrc, CoverPlaceholder, themeOf, type ReadHistoryItem } from './shared';

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}天前`;
  return new Date(t).toLocaleDateString('zh-CN');
}

type Sheet =
  | { kind: 'none' }
  /** 长按书籍：加入书架 / 删除 */
  | { kind: 'book'; book: ReadHistoryItem };

export function HistoryTab({
  onOpen,
}: {
  onOpen: (b: ReadHistoryItem) => void;
}) {
  const settings = useReading((s) => s.settings);
  const shelf = useReading((s) => s.shelf);
  const loadShelf = useReading((s) => s.loadShelf);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  const [reads, setReads] = useState<ReadHistoryItem[] | null>(null);
  const [kw, setKw] = useState('');
  /** 多选模式（三点开启） */
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<Sheet>({ kind: 'none' });
  const [toast, setToast] = useState('');
  /** 长按计时器 */
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pressBook, setPressBook] = useState<ReadHistoryItem | null>(null);

  const notify = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(''), 2200);
  };

  const load = () => {
    api
      .readlogList()
      .then((d) => setReads(d.reads))
      .catch(() => setReads([]));
  };
  useEffect(load, []);

  const shelfUrls = useMemo(() => new Set(shelf.map((b) => b.bookUrl)), [shelf]);
  const list = useMemo(() => {
    if (!reads) return [];
    const k = kw.trim().toLowerCase();
    if (!k) return reads;
    return reads.filter((b) => b.name.toLowerCase().includes(k) || (b.author || '').toLowerCase().includes(k));
  }, [reads, kw]);

  const selectedCount = selected.size;

  const removeOne = async (bookUrl: string) => {
    setReads((r) => (r ? r.filter((b) => b.bookUrl !== bookUrl) : r));
    await api.readlogAction({ action: 'remove', bookUrl }).catch(() => null);
  };

  /** 加入书架（保留进度；已在架则跳过） */
  const toShelf = async (urls: string[]) => {
    if (!urls.length) return;
    const r = (await api.readlogAction({ action: 'toShelf', bookUrls: urls }).catch(() => null)) as
      | { added?: number }
      | null;
    notify(`已加入书架 ${r?.added || urls.length} 本`);
    await loadShelf().catch(() => null);
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

  const glass = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;

  // ---------------- 长按书籍 ----------------
  const startPress = (b: ReadHistoryItem) => {
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

  return (
    <div className="px-4">
      {/* 顶栏：标题 + 三点（多选） */}
      <div className="flex items-end justify-between">
        <h1 className="text-[30px] font-bold leading-tight" style={{ color: theme.textMain }}>
          历史
        </h1>
        {reads && reads.length > 0 && (
          <button
            type="button"
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            aria-label={selectMode ? '完成' : '多选'}
            className={`flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold backdrop-blur-xl active:scale-95 ${selectMode ? 'text-white' : ''}`}
            style={
              selectMode
                ? { background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }
                : { ...glass, color: theme.textMain }
            }
          >
            {selectMode ? (
              <>
                <X className="h-4 w-4" strokeWidth={2.4} /> 完成
              </>
            ) : (
              <EllipsisVertical className="h-5 w-5" strokeWidth={2.2} />
            )}
          </button>
        )}
      </div>

      {/* 书内搜索（过滤历史） */}
      {reads && reads.length > 0 && (
        <div className="mt-3 flex h-10 items-center gap-2 rounded-full px-4 backdrop-blur-xl" style={glass}>
          <Search className="h-4 w-4 shrink-0" style={{ color: theme.textSub }} strokeWidth={2.2} />
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="搜索历史里的书"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            style={{ color: theme.textMain }}
            aria-label="搜索历史"
          />
        </div>
      )}

      {reads === null && (
        <div className="mt-16 flex justify-center">
          <Clock3 className="h-6 w-6 animate-pulse" style={{ color: theme.accent }} />
        </div>
      )}

      {reads !== null && list.length === 0 && (
        <div className="mt-20 flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: theme.accentSoft, color: theme.accent }}>
            <BookOpen className="h-7 w-7" strokeWidth={2} />
          </div>
          <p className="text-[14px]" style={{ color: theme.textSub }}>
            {kw ? '没有匹配的书' : '还没有阅读记录，去看一本书吧'}
          </p>
        </div>
      )}

      {list.length > 0 && (
        <p className="mt-2 px-1 text-[11px]" style={{ color: theme.textSub }}>
          {selectMode ? `点选书籍（已选 ${selectedCount} 本）` : `${list.length} 本 · 长按可加入书架或删除`}
        </p>
      )}

      {list.length > 0 && (
        <div className="mt-2 space-y-2.5 pb-24">
          {list.map((b) => {
            const cover = coverSrc(b.coverUrl, b.sourceId);
            const pct = b.totalChapters ? Math.min(100, Math.round(((b.lastReadChapter + 1) / b.totalChapters) * 100)) : 0;
            const inShelf = shelfUrls.has(b.bookUrl);
            const checked = selected.has(b.bookUrl);
            return (
              <button
                key={b.bookUrl}
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
                className={`flex w-full items-center gap-3 rounded-3xl p-3 text-left backdrop-blur-xl active:scale-[0.99] ${
                  pressBook?.bookUrl === b.bookUrl ? 'scale-[0.98]' : ''
                } ${selectMode && checked ? 'ring-2' : ''}`}
                style={{
                  ...glass,
                  ...(selectMode && checked ? { boxShadow: `inset 0 0 0 2px ${theme.accent}` } : {}),
                }}
              >
                {/* 多选圈 */}
                {selectMode && (
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${checked ? 'border-transparent' : ''}`}
                    style={checked ? { background: theme.accent } : { borderColor: theme.textSub }}
                  >
                    {checked && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                  </span>
                )}
                {cover ? (
                  <img src={cover} alt={`${b.name} 封面`} className="h-[76px] w-[56px] shrink-0 rounded-xl object-cover shadow-sm ring-1 ring-black/5" loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <CoverPlaceholder name={b.name} author={b.author} className="h-[76px] w-[56px] shrink-0 shadow-sm" radius="rounded-xl" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[15px] font-semibold" style={{ color: theme.textMain }}>
                    <span className="truncate">{b.name}</span>
                    {inShelf && !selectMode && (
                      <span className="shrink-0 rounded-full px-1.5 py-px text-[9px] font-medium" style={{ background: theme.accentSoft, color: theme.accent }}>
                        在架
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-[12px]" style={{ color: theme.textSub }}>
                    {b.author || '佚名'} · {b.sourceName || '未知源'}
                  </p>
                  <p className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${theme.gradFrom}, ${theme.gradTo})` }}
                    />
                  </p>
                  <p className="mt-1 truncate text-[11px]" style={{ color: theme.textSub }}>
                    读到第 {b.lastReadChapter + 1}/{b.totalChapters || '?'} 章 · {b.lastChapterTitle || ''} · {timeAgo(b.lastReadAt)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* 多选底部操作条（全选 · 加入书架 · 删除） */}
      {selectMode && list.length > 0 && (
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
              onClick={async () => {
                await toShelf([...selected]);
                setSelected(new Set());
              }}
              className="flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-white active:scale-95 disabled:opacity-40"
              style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }}
            >
              <FolderPlus className="h-4 w-4" /> 加架
            </button>
            <button
              type="button"
              disabled={!selectedCount}
              onClick={async () => {
                const urls = [...selected];
                setReads((r) => (r ? r.filter((b) => !selected.has(b.bookUrl)) : r));
                setSelected(new Set());
                await api.readlogAction({ action: 'removeMany', bookUrls: urls }).catch(() => null);
                notify(`已删除 ${urls.length} 条记录`);
              }}
              className="flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-semibold active:scale-95 disabled:opacity-40"
              style={{ color: '#E05252' }}
            >
              <Trash2 className="h-4 w-4" /> 删除
            </button>
          </div>
        </div>
      )}

      {/* 长按书籍操作单 */}
      {sheet.kind === 'book' && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="历史书籍操作">
          <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setSheet({ kind: 'none' })} />
          <div
            className="absolute inset-x-3 bottom-[max(16px,env(safe-area-inset-bottom))] rounded-3xl p-2 shadow-2xl backdrop-blur-2xl"
            style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 -8px 40px rgba(0,0,0,0.16)` }}
          >
            <div className="flex items-center gap-3 px-3 pb-2 pt-1.5">
              {(() => {
                const c = coverSrc(sheet.book.coverUrl, sheet.book.sourceId);
                return c ? (
                  <img src={c} alt="" className="h-11 w-8 rounded-md object-cover ring-1 ring-black/5" referrerPolicy="no-referrer" />
                ) : (
                  <CoverPlaceholder name={sheet.book.name} className="h-11 w-8" radius="rounded-md" />
                );
              })()}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold" style={{ color: theme.textMain }}>
                  {sheet.book.name}
                </p>
                <p className="truncate text-[11px]" style={{ color: theme.textSub }}>
                  {sheet.book.author || '佚名'} · 读到第 {sheet.book.lastReadChapter + 1} 章
                </p>
              </div>
            </div>
            <div className="h-px" style={{ background: theme.cardRing }} />
            {shelfUrls.has(sheet.book.bookUrl) ? (
              <div className="px-4 py-3 text-center text-[13px]" style={{ color: theme.textSub }}>
                已在书架
              </div>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  await toShelf([sheet.book.bookUrl]);
                  setSheet({ kind: 'none' });
                }}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left active:bg-black/[0.03]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: theme.accentSoft, color: theme.accent }}>
                  <FolderPlus className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium" style={{ color: theme.textMain }}>
                    加入书架
                  </span>
                  <span className="block text-[11px]" style={{ color: theme.textSub }}>
                    保留当前阅读进度
                  </span>
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                await removeOne(sheet.book.bookUrl);
                setSheet({ kind: 'none' });
                notify('已从历史删除');
              }}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left active:bg-black/[0.03]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(224,82,82,0.12)', color: '#E05252' }}>
                <Trash2 className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium" style={{ color: '#E05252' }}>
                  删除
                </span>
                <span className="block text-[11px]" style={{ color: theme.textSub }}>
                  从阅读历史移除（书架不受影响）
                </span>
              </span>
            </button>
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
