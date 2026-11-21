'use client';

/**
 * 历史 Tab：看过的书都在这里（阅读历史，独立于书架；按书源区分）
 * - 列表：真实封面 + 书名 + 进度（第x/y章 · 上次看到的章节标题）+ 相对时间
 * - 点击 → 从上次看到的地方继续读（章节+页码记忆）
 * - 长按 → 从历史移除；顶部「清空历史」
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, BookOpen, Search, Clock3 } from 'lucide-react';
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

export function HistoryTab({
  onOpen,
}: {
  onOpen: (b: ReadHistoryItem) => void;
}) {
  const settings = useReading((s) => s.settings);
  const shelf = useReading((s) => s.shelf);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  const [reads, setReads] = useState<ReadHistoryItem[] | null>(null);
  const [kw, setKw] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  /** 长按计时器 */
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const removeOne = async (bookUrl: string) => {
    setReads((r) => (r ? r.filter((b) => b.bookUrl !== bookUrl) : r));
    await api.readlogAction({ action: 'remove', bookUrl }).catch(() => null);
  };

  const glass = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;

  const startPress = (b: ReadHistoryItem) => {
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      void removeOne(b.bookUrl);
    }, 550);
  };
  const cancelPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  return (
    <div className="px-4">
      <div className="flex items-end justify-between">
        <h1 className="text-[30px] font-bold leading-tight" style={{ color: theme.textMain }}>
          历史
        </h1>
        {reads && reads.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            aria-label="清空历史"
            className="flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-xl active:scale-90"
            style={{ ...glass, color: '#E05252' }}
          >
            <Trash2 className="h-5 w-5" strokeWidth={2.2} />
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
        <div className="mt-4 space-y-2.5">
          {list.map((b) => {
            const cover = coverSrc(b.coverUrl, b.sourceId);
            const pct = b.totalChapters ? Math.min(100, Math.round(((b.lastReadChapter + 1) / b.totalChapters) * 100)) : 0;
            const inShelf = shelfUrls.has(b.bookUrl);
            return (
              <button
                key={b.bookUrl}
                type="button"
                onClick={() => onOpen(b)}
                onTouchStart={() => startPress(b)}
                onTouchEnd={cancelPress}
                onTouchMove={cancelPress}
                onContextMenu={(e) => {
                  e.preventDefault();
                  void removeOne(b.bookUrl);
                }}
                className="flex w-full items-center gap-3 rounded-3xl p-3 text-left backdrop-blur-xl active:scale-[0.99]"
                style={glass}
              >
                {cover ? (
                  <img src={cover} alt={`${b.name} 封面`} className="h-[76px] w-[56px] shrink-0 rounded-xl object-cover shadow-sm ring-1 ring-black/5" loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <CoverPlaceholder name={b.name} author={b.author} className="h-[76px] w-[56px] shrink-0 shadow-sm" radius="rounded-xl" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[15px] font-semibold" style={{ color: theme.textMain }}>
                    <span className="truncate">{b.name}</span>
                    {inShelf && (
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

      {/* 清空确认弹窗 */}
      {confirmClear && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="清空历史确认">
          <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setConfirmClear(false)} />
          <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 rounded-3xl p-5 text-center shadow-2xl backdrop-blur-2xl" style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}` }}>
            <p className="text-[15px] font-semibold" style={{ color: theme.textMain }}>
              清空全部阅读历史？
            </p>
            <p className="mt-1 text-[12px]" style={{ color: theme.textSub }}>
              只清历史，书架和阅读进度不受影响
            </p>
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="h-10 flex-1 rounded-full text-[14px] font-medium backdrop-blur-xl"
                style={{ ...glass, color: theme.textMain }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={async () => {
                  setConfirmClear(false);
                  await api.readlogAction({ action: 'clear' }).catch(() => null);
                  setReads([]);
                }}
                className="h-10 flex-1 rounded-full text-[14px] font-semibold text-white"
                style={{ background: '#E05252' }}
              >
                清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
