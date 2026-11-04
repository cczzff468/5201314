'use client';

/**
 * 页面 5/6/7：日程颜色（2 列色卡）、重复规则、提醒时间（单选列表）。
 * 均为「返回 + 标题」导航；选中的选项打珊瑚红 ✓；点选即生效并由父级返回表单。
 */

import { Check } from 'lucide-react';
import { ACCENT, ALERT_OPTIONS, CARD, EVENT_COLORS, NavBar, NavTextButton, REPEAT_OPTIONS, TEXT, TEXT_2, type AlertKey, type RepeatKey } from './shared';
import { Card, CardDivider } from './widgets';

/** 页面骨架：返回 + 标题（+ 可选副标题） */
function PickerPage({
  title,
  subtitle,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col pt-[54px]">
      <NavBar left={<NavTextButton label="返回" onClick={onBack} testId="cal-picker-back" />} title={title} />
      {subtitle && (
        <div className="px-5 pb-1 pt-1 text-[13px]" style={{ color: TEXT_2 }}>
          {subtitle}
        </div>
      )}
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-2">{children}</div>
    </div>
  );
}

/** 页面 5：日程颜色（2 列色卡网格，选中打 ✓） */
export function ColorPickerPage({
  value,
  eventTitle,
  onPick,
  onBack,
}: {
  value: string;
  eventTitle: string;
  onPick: (key: string) => void;
  onBack: () => void;
}) {
  return (
    <PickerPage title="日程颜色" subtitle={eventTitle || '为日程选择一个标记颜色'} onBack={onBack}>
      <div className="grid grid-cols-2 gap-2.5">
        {EVENT_COLORS.map((c) => {
          const active = c.key === value;
          return (
            <button
              key={c.key}
              type="button"
              data-testid={`cal-color-${c.key}`}
              aria-pressed={active}
              onClick={() => onPick(c.key)}
              className="flex h-[54px] items-center gap-2.5 rounded-[14px] px-3.5 transition active:opacity-70"
              style={{
                backgroundColor: CARD,
                boxShadow: active ? `0 0 0 1.5px ${ACCENT} inset, 0 1px 4px rgba(41,36,31,0.04)` : '0 1px 4px rgba(41,36,31,0.04)',
              }}
            >
              <span className="h-5 w-5 shrink-0 rounded-full" style={{ backgroundColor: c.hex }} />
              <span className="flex-1 text-left text-[15px]" style={{ color: TEXT }}>
                {c.label}
              </span>
              {active && <Check className="h-[18px] w-[18px]" style={{ color: ACCENT }} strokeWidth={2.6} />}
            </button>
          );
        })}
      </div>
    </PickerPage>
  );
}

/** 单选行（重复/提醒共用） */
function RadioRow({
  label,
  active,
  onClick,
  first,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  first?: boolean;
  testId?: string;
}) {
  return (
    <>
      {!first && <CardDivider />}
      <button
        type="button"
        data-testid={testId}
        aria-pressed={active}
        onClick={onClick}
        className="flex h-[48px] w-full items-center justify-between px-4 text-left transition-colors active:bg-black/[0.03]"
      >
        <span className="text-[15px]" style={{ color: TEXT, fontWeight: active ? 500 : 400 }}>
          {label}
        </span>
        {active && <Check className="h-[18px] w-[18px]" style={{ color: ACCENT }} strokeWidth={2.6} />}
      </button>
    </>
  );
}

/** 页面 6：重复规则 */
export function RepeatPickerPage({
  value,
  onPick,
  onBack,
}: {
  value: RepeatKey;
  onPick: (key: RepeatKey) => void;
  onBack: () => void;
}) {
  return (
    <PickerPage title="重复" onBack={onBack}>
      <Card>
        {REPEAT_OPTIONS.map((r, i) => (
          <RadioRow
            key={r.key}
            first={i === 0}
            label={r.label}
            active={r.key === value}
            onClick={() => onPick(r.key)}
            testId={`cal-repeat-${r.key}`}
          />
        ))}
      </Card>
      <div className="px-1 pt-2.5 text-[12px]" style={{ color: TEXT_2 }}>
        按开始日期重复；不存在的日期（如 2 月 30 日）会自动跳过。
      </div>
    </PickerPage>
  );
}

/** 页面 7：提醒时间 */
export function AlertPickerPage({
  value,
  onPick,
  onBack,
}: {
  value: AlertKey;
  onPick: (key: AlertKey) => void;
  onBack: () => void;
}) {
  return (
    <PickerPage title="提醒时间" onBack={onBack}>
      <Card>
        {ALERT_OPTIONS.map((a, i) => (
          <RadioRow
            key={a.key}
            first={i === 0}
            label={a.label}
            active={a.key === value}
            onClick={() => onPick(a.key)}
            testId={`cal-alert-${a.key}`}
          />
        ))}
      </Card>
      <div className="px-1 pt-2.5 text-[12px]" style={{ color: TEXT_2 }}>
        提醒按日程开始时间计算。
      </div>
    </PickerPage>
  );
}
