'use client';

/**
 * 页面 4：日程详情。
 * 导航「关闭 / 日程详情 / 编辑」；色点 + 标题 + 日期（含农历）+ 时间；
 * 信息卡（地点/重复/提醒）；备注块；「当日备忘录」区块（读取备忘录 App 中关联该日程的笔记，
 * 约定字段 NoteRecord.linkedEventId / linkDate）；金色动作行（新建备忘录/关联已有）；
 * 底部「删除日程」浅红底红字按钮（两段确认，删除时保留备忘录只清关联）。
 */

import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronRight, MapPin, NotebookPen, Paperclip, Repeat as RepeatIcon, SquarePen } from 'lucide-react';
import {
  ACCENT,
  ACCENT_SOFT,
  GOLD,
  GOLD_SOFT,
  NavBar,
  NavTextButton,
  TEXT,
  TEXT_2,
  TEXT_3,
  alertLabel,
  colorHex,
  formatDayLong,
  formatDayShort,
  htmlToPlain,
  keyToDate,
  lunarBadge,
  repeatLabel,
  type NormalizedEvent,
} from './shared';
import { Card, CardDivider } from './widgets';
import type { NoteRecord } from '@/lib/ios/db';

/** 备忘录卡片 */
function NoteCard({ n, onClick }: { n: NoteRecord; onClick: () => void }) {
  const preview = n.locked ? '已锁定' : htmlToPlain(n.content) || '无正文';
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-black/[0.03]"
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]"
        style={{ backgroundColor: GOLD_SOFT }}
      >
        <NotebookPen className="h-4 w-4" style={{ color: GOLD }} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-tight" style={{ color: TEXT }}>
          {n.title || '无标题'}
        </span>
        <span className="mt-0.5 block truncate text-[12px] leading-tight" style={{ color: TEXT_2 }}>
          {preview}
        </span>
      </span>
      <SquarePen className="h-4 w-4 shrink-0" style={{ color: TEXT_3 }} strokeWidth={1.8} />
    </button>
  );
}

export function EventDetail({
  ev,
  notes,
  onClose,
  onEdit,
  onDelete,
  onCreateNote,
  onOpenLink,
  onOpenNote,
}: {
  ev: NormalizedEvent;
  /** 已按 linkedEventId/linkDate/同日 过滤的当日备忘录（不含回收站） */
  notes: NoteRecord[];
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCreateNote: () => void;
  onOpenLink: () => void;
  onOpenNote: () => void;
}) {
  /** 删除两段确认（避免原生 confirm 在无头环境不可用） */
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    []
  );

  const crossDay = ev.nEndDate > ev.date;
  const lunar = lunarBadge(keyToDate(ev.date)).full;

  return (
    <div className="flex h-full flex-col pt-[54px]">
      <NavBar
        left={<NavTextButton label="关闭" onClick={onClose} testId="cal-detail-close" />}
        title="日程详情"
        right={<NavTextButton label="编辑" onClick={onEdit} testId="cal-detail-edit" />}
      />

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-2">
        {/* 标题区 */}
        <div className="px-1">
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: colorHex(ev.nColor) }} />
            <h2 className="truncate text-[20px] font-bold leading-tight" style={{ color: TEXT }}>
              {ev.title}
            </h2>
          </div>
          <div className="mt-1.5 text-[15px] leading-snug" style={{ color: TEXT }}>
            {crossDay
              ? `${formatDayShort(ev.date)} – ${formatDayShort(ev.nEndDate)}`
              : formatDayLong(ev.date)}
          </div>
          {!crossDay && (
            <div className="mt-0.5 text-[13px] leading-snug" style={{ color: TEXT_3 }}>
              {lunar}
            </div>
          )}
          <div className="mt-1 text-[15px] tabular-nums leading-snug" style={{ color: TEXT }}>
            {ev.startTime === '' ? '全天' : `${ev.startTime} - ${ev.endTime}`}
          </div>
        </div>

        {/* 地点 / 重复 / 提醒 */}
        <Card className="mt-3">
          {ev.nLocation && (
            <>
              <div className="flex h-[44px] items-center gap-2.5 px-4">
                <MapPin className="h-4 w-4 shrink-0" style={{ color: TEXT_2 }} strokeWidth={2} />
                <span className="truncate text-[15px]" style={{ color: TEXT }}>
                  {ev.nLocation}
                </span>
              </div>
              <CardDivider />
            </>
          )}
          <div className="flex h-[44px] items-center gap-2.5 px-4">
            <RepeatIcon className="h-4 w-4 shrink-0" style={{ color: TEXT_2 }} strokeWidth={2} />
            <span className="flex-1 text-[15px]" style={{ color: TEXT }}>
              重复
            </span>
            <span className="text-[14px]" style={{ color: TEXT_2 }}>
              {repeatLabel(ev)}
            </span>
          </div>
          <CardDivider />
          <div className="flex h-[44px] items-center gap-2.5 px-4">
            <Bell className="h-4 w-4 shrink-0" style={{ color: TEXT_2 }} strokeWidth={2} />
            <span className="flex-1 text-[15px]" style={{ color: TEXT }}>
              提醒
            </span>
            <span className="text-[14px]" style={{ color: TEXT_2 }}>
              {alertLabel(ev.nAlert)}
            </span>
          </div>
        </Card>

        {/* 备注 */}
        {ev.note && (
          <Card className="mt-2.5">
            <div className="px-4 py-2.5">
              <div className="text-[13px]" style={{ color: TEXT_2 }}>
                备注
              </div>
              <div className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed" style={{ color: TEXT }}>
                {ev.note}
              </div>
            </div>
          </Card>
        )}

        {/* 当日备忘录 */}
        <div className="mt-4 flex items-center justify-between px-1">
          <span className="text-[15px] font-semibold" style={{ color: TEXT }}>
            当日备忘录
          </span>
          <span className="text-[12px]" style={{ color: TEXT_2 }}>
            {notes.length} 篇
          </span>
        </div>
        {notes.length === 0 ? (
          <div className="mt-2 px-1 text-[13px]" style={{ color: TEXT_3 }}>
            还没有关联这一天的备忘录，可在下方新建或关联已有。
          </div>
        ) : (
          <Card className="mt-2">
            <div className="divide-y" style={{ borderColor: 'rgba(41,36,31,0.05)' }}>
              {notes.map((n) => (
                <NoteCard key={n.id} n={n} onClick={onOpenNote} />
              ))}
            </div>
          </Card>
        )}

        {/* 金色动作行 */}
        <div className="mt-3 flex gap-2.5">
          <button
            type="button"
            data-testid="cal-detail-newnote"
            onClick={onCreateNote}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[12px] text-[14px] font-medium transition active:opacity-70"
            style={{ backgroundColor: GOLD_SOFT, color: GOLD }}
          >
            <NotebookPen className="h-4 w-4" strokeWidth={2} />
            新建备忘录
          </button>
          <button
            type="button"
            data-testid="cal-detail-linknote"
            onClick={onOpenLink}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[12px] text-[14px] font-medium transition active:opacity-70"
            style={{ backgroundColor: GOLD_SOFT, color: GOLD }}
          >
            <Paperclip className="h-4 w-4" strokeWidth={2} />
            关联已有
          </button>
        </div>

        {/* 删除日程（两段确认） */}
        <button
          type="button"
          data-testid="cal-detail-delete"
          onClick={() => {
            if (!confirming) {
              setConfirming(true);
              timer.current = window.setTimeout(() => setConfirming(false), 3000);
              return;
            }
            if (timer.current) window.clearTimeout(timer.current);
            setConfirming(false);
            onDelete();
          }}
          className="mt-4 flex h-12 w-full items-center justify-center gap-1.5 rounded-[14px] text-[16px] font-semibold transition active:opacity-70"
          style={confirming ? { backgroundColor: ACCENT, color: '#FFFFFF' } : { backgroundColor: ACCENT_SOFT, color: ACCENT }}
        >
          {confirming ? '再点一次确认删除' : '删除日程'}
          {!confirming && <ChevronRight className="h-4 w-4 opacity-60" strokeWidth={2.2} />}
        </button>
      </div>
    </div>
  );
}
