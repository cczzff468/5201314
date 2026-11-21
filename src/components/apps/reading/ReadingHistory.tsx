'use client';

/**
 * 阅读记录与 AI 记忆页：读书统计胶囊 + 在读列表（真实封面+进度条）+ 里程碑时间线
 */
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Trophy, Trash2 } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { coverSrc, CoverPlaceholder, themeOf, type ShelfBookItem } from './shared';
import { api } from './shared';
import { SubNavBar } from './ReadingApp';

interface HistoryData {
  milestones: { id: string; content: string; createdAt: string }[];
  books: { name: string; author: string | null; totalChapters: number; readChapters: number }[];
}

export function ReadingHistory({
  onBack,
  onOpenBook,
}: {
  onBack: () => void;
  onOpenBook: (b: ShelfBookItem) => void;
}) {
  const settings = useReading((s) => s.settings);
  const shelf = useReading((s) => s.shelf);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  const [data, setData] = useState<HistoryData>({ milestones: [], books: [] });

  useEffect(() => {
    api
      .history()
      .then((d) => setData(d as unknown as HistoryData))
      .catch(() => null);
  }, []);

  const totalRead = shelf.reduce((n, b) => n + b.lastReadChapter + 1, 0);
  const card = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;

  return (
    <div className="flex h-full flex-col">
      <SubNavBar title="阅读记录" onBack={onBack} theme={theme} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8">
        {/* 统计胶囊 */}
        <div className="grid grid-cols-3 gap-2.5">
          {[
            { n: shelf.length, label: '书架书籍' },
            { n: totalRead, label: '已读章节' },
            { n: data.milestones.length, label: '读书里程碑' },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl p-3.5 text-center backdrop-blur-xl" style={card}>
              <p className="text-[22px] font-bold tabular-nums" style={{ color: theme.accent }}>
                {s.n}
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: theme.textSub }}>
                {s.label}
              </p>
            </div>
          ))}
        </div>

        {/* 在读列表 */}
        <p className="mb-2 mt-5 px-1 text-[13px] font-medium" style={{ color: theme.textSub }}>
          在读
        </p>
        <div className="overflow-hidden rounded-3xl backdrop-blur-xl" style={card}>
          {shelf.length === 0 && <p className="py-8 text-center text-[13px]" style={{ color: theme.textSub }}>还没有开始读一本书</p>}
          {shelf.map((b, i) => {
            const pct = b.totalChapters ? Math.round(((b.lastReadChapter + 1) / b.totalChapters) * 100) : 0;
            const cover = coverSrc(b.coverUrl, b.sourceId);
            return (
              <div key={b.bookUrl}>
                {i > 0 && <div className="ml-[76px] h-px" style={{ background: theme.cardRing }} />}
                <button type="button" onClick={() => onOpenBook(b)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.02]">
                  {cover ? (
                    <img src={cover} alt="" className="h-[52px] w-[38px] shrink-0 rounded-md object-cover shadow-sm ring-1 ring-black/5" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <CoverPlaceholder name={b.name} className="h-[52px] w-[38px] shrink-0 shadow-sm" radius="rounded-md" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold" style={{ color: theme.textMain }}>
                      {b.name}
                    </span>
                    <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${theme.gradFrom}, ${theme.gradTo})` }}
                      />
                    </span>
                    <span className="mt-1 block truncate text-[11px]" style={{ color: theme.textSub }}>
                      {b.lastReadChapter + 1}/{b.totalChapters} 章 · {b.lastChapterTitle || ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums font-semibold" style={{ color: theme.accent }}>
                    {pct}%
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        {/* 里程碑时间线（AI 记忆的一部分） */}
        <p className="mb-2 mt-5 flex items-center gap-1.5 px-1 text-[13px] font-medium" style={{ color: theme.textSub }}>
          <Trophy className="h-4 w-4" /> 读书里程碑（AI 都记得）
        </p>
        <div className="rounded-3xl p-4 backdrop-blur-xl" style={card}>
          {data.milestones.length === 0 ? (
            <p className="py-4 text-center text-[12px]" style={{ color: theme.textSub }}>
              每读到第 100 章会自动记录一个里程碑
            </p>
          ) : (
            <div className="space-y-3">
              {data.milestones.map((m) => (
                <div key={m.id} className="flex gap-3">
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: theme.accent, boxShadow: `0 0 8px ${theme.accent}66` }}
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] leading-snug" style={{ color: theme.textMain }}>
                      {m.content}
                    </p>
                    <p className="mt-0.5 text-[11px]" style={{ color: theme.textSub }}>
                      {new Date(m.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 清空 */}
        <button
          type="button"
          onClick={async () => {
            await api.historyAction({ action: 'clear' }).catch(() => null);
            setData({ milestones: [], books: [] });
          }}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-full text-[13px] font-medium backdrop-blur-xl active:scale-[0.99]"
          style={{ ...card, color: '#E05252' }}
        >
          <Trash2 className="h-4 w-4" /> 清空全部阅读记忆
        </button>

        <p className="mt-4 flex items-center justify-center gap-1 text-center text-[11px]" style={{ color: theme.textSub }}>
          <BookOpen className="h-3 w-3" /> AI 陪读的聊天记忆可在「记忆」App 里按联系人查看
        </p>
      </div>
    </div>
  );
}
