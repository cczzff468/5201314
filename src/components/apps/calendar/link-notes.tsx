'use client';

/**
 * 页面 8：关联已有备忘录。
 * 导航「取消 / 关联备忘录 / 完成」；日期提示 + 搜索框 + 单选列表（radio 圆点，黄色=已关联）+
 * 「新建当日备忘录」金色链接 + 底部灰色说明「仅显当日相关，备忘录保存在原文件夹」。
 * 关联写 NoteRecord.linkedEventId + linkDate（16-a 约定字段）；换选时旧条目只清 linkedEventId。
 */

import { useMemo, useState } from 'react';
import { Check, NotebookPen, Search } from 'lucide-react';
import type { NoteRecord } from '@/lib/ios/db';
import {
  FILL_SOFT,
  GOLD,
  GOLD_SOFT,
  NavBar,
  NavTextButton,
  TEXT,
  TEXT_2,
  TEXT_3,
  formatDayShort,
  htmlToPlain,
  keyToDate,
  noteLinkedToEvent,
  noteRelatesToEvent,
  type NormalizedEvent,
} from './shared';
import { Card } from './widgets';

function folderName(n: NoteRecord): string {
  if (n.category === 'personal') return '个人';
  if (n.category === 'work') return '工作';
  return '备忘录';
}

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function LinkNotesPage({
  ev,
  notes,
  onBack,
  onLink,
  onCreateNote,
}: {
  ev: NormalizedEvent;
  /** 备忘录 App 全量笔记（已剔除回收站）；候选过滤在本页完成 */
  notes: NoteRecord[];
  onBack: () => void;
  /** 选择关联（noteId=null 表示取消当前关联） */
  onLink: (noteId: string | null) => void;
  onCreateNote: () => void;
}) {
  const [q, setQ] = useState('');

  /** 候选 = 已关联本日程 / 关联同一天 / 当天创建 */
  const candidates = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return notes
      .filter((n) => noteRelatesToEvent(n, ev))
      .filter((n) => {
        if (!kw) return true;
        return (
          n.title.toLowerCase().includes(kw) || htmlToPlain(n.content).toLowerCase().includes(kw)
        );
      })
      .sort((a, b) => {
        const la = noteLinkedToEvent(a, ev) ? 1 : 0;
        const lb = noteLinkedToEvent(b, ev) ? 1 : 0;
        if (la !== lb) return lb - la;
        return b.updatedAt - a.updatedAt;
      });
  }, [notes, ev, q]);

  const linkedId = candidates.find((n) => noteLinkedToEvent(n, ev))?.id ?? null;

  return (
    <div className="flex h-full flex-col pt-[54px]">
      <NavBar
        left={<NavTextButton label="取消" onClick={onBack} />}
        title="关联备忘录"
        right={<NavTextButton label="完成" bold onClick={onBack} testId="cal-link-done" />}
      />

      <div className="px-4 pb-1 pt-1 text-[13px]" style={{ color: TEXT_2 }}>
        {formatDayShort(ev.date)}
      </div>

      {/* 搜索框 */}
      <div className="px-4 pb-2 pt-1">
        <div
          className="flex h-9 items-center gap-2 rounded-[10px] px-3"
          style={{ backgroundColor: FILL_SOFT }}
        >
          <Search className="h-4 w-4 shrink-0" style={{ color: TEXT_3 }} strokeWidth={2.2} />
          <input
            data-testid="cal-link-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索备忘录"
            aria-label="搜索备忘录"
            className="h-full w-full bg-transparent text-[14px] outline-none"
            style={{ color: TEXT }}
          />
        </div>
      </div>

      {/* 候选列表 */}
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-2">
        {candidates.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-[13px]" style={{ color: TEXT_3 }}>
            {q ? '没有找到相关备忘录' : '这一天还没有相关备忘录'}
          </div>
        ) : (
          <div className="space-y-2">
            {candidates.map((n) => {
              const active = n.id === linkedId;
              return (
                <Card key={n.id}>
                  <button
                    type="button"
                    data-testid={`cal-link-item-${n.id}`}
                    onClick={() => onLink(active ? null : n.id)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors active:bg-black/[0.03]"
                  >
                    {/* radio 圆点：选中黄色圆环 + 黄色勾 */}
                    <span
                      className="mt-0.5 flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2"
                      style={{ borderColor: active ? GOLD : TEXT_3 }}
                    >
                      {active && <Check className="h-3 w-3" style={{ color: GOLD }} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium leading-tight" style={{ color: TEXT }}>
                        {n.title || '无标题'}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] leading-tight" style={{ color: TEXT_2 }}>
                        {n.locked ? '已锁定' : htmlToPlain(n.content) || '无正文'}
                      </span>
                      <span className="mt-1 block text-[11px] leading-tight" style={{ color: TEXT_3 }}>
                        {hhmm(n.updatedAt)} · {folderName(n)}
                      </span>
                    </span>
                  </button>
                </Card>
              );
            })}
          </div>
        )}

        {/* 新建当日备忘录（金色链接） */}
        <button
          type="button"
          data-testid="cal-link-newnote"
          onClick={onCreateNote}
          className="mx-auto mt-4 flex items-center gap-1.5 text-[14px] font-medium transition active:opacity-60"
          style={{ color: GOLD }}
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full"
            style={{ backgroundColor: GOLD_SOFT }}
          >
            <NotebookPen className="h-3.5 w-3.5" strokeWidth={2.2} />
          </span>
          新建当日备忘录
        </button>
      </div>

      {/* 底部说明 */}
      <div className="shrink-0 px-8 pb-7 pt-1 text-center text-[11px] leading-relaxed" style={{ color: TEXT_3 }}>
        仅显示与当日相关的备忘录；建立关联后，备忘录仍保留在原文件夹。
      </div>
    </div>
  );
}
