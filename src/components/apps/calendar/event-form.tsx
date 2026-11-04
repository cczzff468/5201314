'use client';

/**
 * 新建/编辑日程表单（Task 16-d 小米化，对照参考截图右下）。
 * 顶栏「取消 / 新建日程·编辑日程 / 完成」（取消/完成小米蓝，无标题时完成置灰）；
 * 浅灰底 + 白色圆角卡（16px）：标题 + 分类胶囊行（个人/工作/生日/倒数日 + ⋮ 更多颜色）、
 * 全天开关与开始/结束行、提醒 + 提醒方式（本地单选）、重复、地点、备注。
 * 校验与保存流程不变（onPatch/onAdd 走父级）。
 */

import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, MoreVertical } from 'lucide-react';
import {
  ACCENT,
  ACCENT_SOFT,
  FILL_MED,
  MI_BLUE,
  TEXT,
  TEXT_2,
  TEXT_3,
  alertLabel,
  keyToParts,
  repeatLabel,
  type EventDraft,
  type RepeatKey,
} from './shared';
import { CardDivider } from './widgets';

/** 表单浅灰底（Task 31-a 深色适配：变量注入 dark 值，回退 = 原浅色） */
const FORM_BG = 'var(--cal-form-bg, #F5F5F5)';

/** 分类胶囊（点击映射到 EVENT_COLORS 的 key） */
const CATEGORIES: { label: string; hex: string; colorKey: string }[] = [
  { label: '个人', hex: '#3478F6', colorKey: 'blue' },
  { label: '工作', hex: '#F04A3E', colorKey: 'red' },
  { label: '生日', hex: '#FFB800', colorKey: 'yellow' },
  { label: '倒数日', hex: '#07C160', colorKey: 'green' },
];

/** '2026年10月26日' */
function cnDate(key: string): string {
  const { y, m, d } = keyToParts(key);
  return `${y}年${m + 1}月${d}日`;
}

/** 白色圆角卡（16px；深色 → zinc-800） */
function FormCard({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-[16px] bg-white dark:bg-zinc-800">{children}</div>;
}

/** 行式设置：左标签，右侧灰色值 + 箭头 */
function FormRow({
  label,
  value,
  onClick,
  down = false,
  testId,
}: {
  label: string;
  value?: React.ReactNode;
  onClick: () => void;
  /** true = ChevronDown（开始/结束行），否则 ChevronRight */
  down?: boolean;
  testId?: string;
}) {
  const Arrow = down ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex w-full items-center px-4 text-left transition-colors active:bg-black/[0.03]"
      style={{ height: 46 }}
    >
      <span className="flex-1 text-[15px]" style={{ color: TEXT }}>
        {label}
      </span>
      <span className="mr-1 flex items-center gap-1 text-[14px]" style={{ color: TEXT_2 }}>
        {value}
      </span>
      <Arrow className="h-4 w-4 shrink-0" style={{ color: TEXT_3 }} strokeWidth={2.1} />
    </button>
  );
}

/** 圆形单选点（提醒方式；蓝点选中，纯本地 UI 态） */
function RadioDot({ active }: { active: boolean }) {
  return (
    <span
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px]"
      style={{ borderColor: active ? MI_BLUE : TEXT_3 }}
    >
      {active && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: MI_BLUE }} />}
    </span>
  );
}

export function EventForm({
  draft,
  error,
  isEdit,
  onPatch,
  onCancel,
  onAdd,
  onOpenRepeat,
  onOpenAlert,
  onOpenColor,
  onPickDate,
  onPickTime,
}: {
  draft: EventDraft;
  error: string;
  isEdit: boolean;
  onPatch: (p: Partial<EventDraft>) => void;
  onCancel: () => void;
  onAdd: () => void;
  onOpenRepeat: () => void;
  onOpenAlert: () => void;
  onOpenColor: () => void;
  /** target：开始/结束 的日期或时间 */
  onPickDate: (target: 'date' | 'endDate') => void;
  onPickTime: (target: 'start' | 'end') => void;
}) {
  /** 提醒方式（通知/闹钟）——纯本地 UI 态，不落库 */
  const [remindMode, setRemindMode] = useState<'notify' | 'alarm'>('notify');
  const canAdd = draft.title.trim().length > 0;

  return (
    <div className="flex h-full flex-col pt-[54px]" style={{ backgroundColor: FORM_BG }}>
      {/* 顶栏：取消 / 标题 / 完成（小米蓝） */}
      <div className="relative flex h-11 shrink-0 items-center justify-between px-4">
        <button
          type="button"
          data-testid="cal-form-cancel"
          onClick={onCancel}
          className="text-[16px] transition-opacity active:opacity-50"
          style={{ color: MI_BLUE }}
        >
          取消
        </button>
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-semibold"
          style={{ color: TEXT }}
        >
          {isEdit ? '编辑日程' : '新建日程'}
        </span>
        <button
          type="button"
          data-testid="cal-form-add"
          onClick={onAdd}
          disabled={!canAdd}
          className="text-[16px] font-medium transition-opacity active:opacity-50"
          style={{ color: canAdd ? MI_BLUE : TEXT_3 }}
        >
          完成
        </button>
      </div>

      {error && (
        <div
          className="mx-4 mb-1 rounded-lg px-3 py-2 text-[12px]"
          style={{ backgroundColor: ACCENT_SOFT, color: ACCENT }}
        >
          {error}
        </div>
      )}

      <div className="thin-scrollbar min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 pb-8 pt-1.5">
        {/* 标题 + 分类胶囊行 */}
        <FormCard>
          <input
            data-testid="cal-form-title"
            value={draft.title}
            onChange={(e) => onPatch({ title: e.target.value })}
            placeholder="试着输入“明晚 7 点聚餐”"
            aria-label="日程标题"
            className="h-[46px] w-full bg-transparent px-4 text-[16px] font-medium outline-none placeholder:font-normal"
            style={{ color: TEXT }}
          />
          <div className="flex items-center gap-3.5 overflow-x-auto px-4 pb-3 pt-1 no-scrollbar">
            {CATEGORIES.map((cat) => {
              const active = draft.color === cat.colorKey;
              return (
                <button
                  key={cat.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onPatch({ color: cat.colorKey })}
                  className="flex shrink-0 items-center gap-1.5 transition-opacity active:opacity-60"
                >
                  {active ? (
                    <span
                      className="flex h-[14px] w-[14px] items-center justify-center rounded-full"
                      style={{ backgroundColor: cat.hex }}
                    >
                      <Check className="h-2 w-2 text-white" strokeWidth={3.6} />
                    </span>
                  ) : (
                    <span
                      className="h-[14px] w-[14px] rounded-full border-[1.5px]"
                      style={{ borderColor: cat.hex }}
                    />
                  )}
                  <span className="text-[13px]" style={{ color: active ? cat.hex : TEXT }}>
                    {cat.label}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              aria-label="更多颜色"
              data-testid="cal-form-color"
              onClick={onOpenColor}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition active:opacity-60"
              style={{ color: TEXT_2 }}
            >
              <MoreVertical className="h-4 w-4" strokeWidth={2.1} />
            </button>
          </div>
        </FormCard>

        {/* 全天 + 开始/结束 */}
        <FormCard>
          <div className="flex h-[46px] items-center justify-between px-4">
            <span className="text-[15px]" style={{ color: TEXT }}>
              全天
            </span>
            <SwitchRed checked={draft.allDay} onChange={(v) => onPatch({ allDay: v })} />
          </div>
          <CardDivider />
          {/* 开始行：日期 / 时间分别点击（全天时时间部分不显示） */}
          <div className="flex h-[46px] items-center px-4">
            <span className="w-10 shrink-0 text-[15px]" style={{ color: TEXT }}>
              开始
            </span>
            <div className="flex flex-1 items-center justify-end gap-1">
              <button
                type="button"
                data-testid="cal-form-start-date"
                onClick={() => onPickDate('date')}
                className="flex items-center gap-0.5 text-[14px] tabular-nums transition active:opacity-60"
                style={{ color: TEXT_2 }}
              >
                {cnDate(draft.date)}
              </button>
              {!draft.allDay && (
                <button
                  type="button"
                  data-testid="cal-form-start-time"
                  onClick={() => onPickTime('start')}
                  className="flex items-center gap-0.5 text-[14px] tabular-nums transition active:opacity-60"
                  style={{ color: TEXT_2 }}
                >
                  {draft.start}
                  <ChevronDown className="h-3.5 w-3.5" style={{ color: TEXT_3 }} strokeWidth={2.2} />
                </button>
              )}
            </div>
          </div>
          <CardDivider />
          {/* 结束行 */}
          <div className="flex h-[46px] items-center px-4">
            <span className="w-10 shrink-0 text-[15px]" style={{ color: TEXT }}>
              结束
            </span>
            <div className="flex flex-1 items-center justify-end gap-1">
              <button
                type="button"
                data-testid="cal-form-end-date"
                onClick={() => onPickDate('endDate')}
                className="flex items-center gap-0.5 text-[14px] tabular-nums transition active:opacity-60"
                style={{ color: TEXT_2 }}
              >
                {cnDate(draft.endDate >= draft.date ? draft.endDate : draft.date)}
              </button>
              {!draft.allDay && (
                <button
                  type="button"
                  data-testid="cal-form-end-time"
                  onClick={() => onPickTime('end')}
                  className="flex items-center gap-0.5 text-[14px] tabular-nums transition active:opacity-60"
                  style={{ color: TEXT_2 }}
                >
                  {draft.end}
                  <ChevronDown className="h-3.5 w-3.5" style={{ color: TEXT_3 }} strokeWidth={2.2} />
                </button>
              )}
            </div>
          </div>
        </FormCard>

        {/* 提醒 + 提醒方式 */}
        <FormCard>
          <FormRow
            label="提醒"
            value={alertLabel(draft.alert)}
            onClick={onOpenAlert}
            testId="cal-form-alert"
          />
          <CardDivider />
          <div className="flex h-[46px] items-center justify-between px-4">
            <span className="text-[15px]" style={{ color: TEXT }}>
              提醒方式
            </span>
            <div className="flex items-center gap-4">
              {(
                [
                  { key: 'notify', label: '通知提醒' },
                  { key: 'alarm', label: '闹钟提醒' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={remindMode === opt.key}
                  onClick={() => setRemindMode(opt.key)}
                  className="flex items-center gap-1.5 transition-opacity active:opacity-60"
                >
                  <RadioDot active={remindMode === opt.key} />
                  <span className="text-[13px]" style={{ color: TEXT }}>
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </FormCard>

        {/* 重复 */}
        <FormCard>
          <FormRow
            label="重复"
            value={draft.repeatRule === 'none' ? '一次性日程' : repeatLabel({ repeat: undefined, repeatRule: draft.repeatRule as RepeatKey | undefined })}
            onClick={onOpenRepeat}
            testId="cal-form-repeat"
          />
        </FormCard>

        {/* 地点 */}
        <FormCard>
          <input
            data-testid="cal-form-location"
            value={draft.location}
            onChange={(e) => onPatch({ location: e.target.value })}
            placeholder="输入地点"
            aria-label="地点"
            className="h-[46px] w-full bg-transparent px-4 text-[15px] outline-none"
            style={{ color: TEXT }}
          />
        </FormCard>

        {/* 备注 */}
        <FormCard>
          <textarea
            data-testid="cal-form-note"
            value={draft.note}
            onChange={(e) => onPatch({ note: e.target.value })}
            rows={3}
            placeholder="输入备注"
            aria-label="备注"
            className="w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-relaxed outline-none placeholder:opacity-70"
            style={{ color: TEXT }}
          />
        </FormCard>
      </div>
    </div>
  );
}

/** 珊瑚红 Switch（iOS 风格，选中态用主色） */
function SwitchRed({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="全天"
      data-testid="cal-form-allday"
      onClick={() => onChange(!checked)}
      className="relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200"
      style={{ backgroundColor: checked ? ACCENT : FILL_MED }}
    >
      <span
        className="absolute top-[2px] h-[26px] w-[26px] rounded-full bg-white shadow transition-all duration-200"
        style={{ left: checked ? 22 : 2 }}
      />
    </button>
  );
}
