'use client';

/**
 * 日历小组件（主屏第 3 页顶部，col-span-4 整行 2 行高 ≈342×168）：
 * 左侧 = 月名（灰）/ 星期（粗体）/ 大号日期；右侧 = 整月网格（周一起始、今天黑圆反白、
 * 周末列淡灰）——参考 iOS 日历中号组件的横排版式（用户参考图）。
 * 纯展示（主屏点击打开日历 App）；SSR/首帧不渲染日期避免水合不一致，挂载后立即填充。
 */
import { useEffect, useState } from 'react';

/** 周表头（周一起始，与日期网格列对齐；六/日两列淡显） */
const WEEKDAY_HEADER = ['一', '二', '三', '四', '五', '六', '日'] as const;

export function CalendarCardWidget({ testId }: { testId?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const iv = window.setInterval(tick, 30_000);
    return () => window.clearInterval(iv);
  }, []);

  const month = now ? now.getMonth() : 0;
  const today = now?.getDate() ?? 0;
  const daysInMonth = now ? new Date(now.getFullYear(), month + 1, 0).getDate() : 30;
  /** 1 号前面的空格数（周一起始：周日 getDay()=0 → 偏移 6） */
  const firstOffset = now ? (new Date(now.getFullYear(), month, 1).getDay() + 6) % 7 : 0;
  const cells: (number | null)[] = [
    ...Array<null>(firstOffset),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthText = now ? `${month + 1}月` : '';
  const weekText = now ? `星期${'日一二三四五六'[now.getDay()]}` : '';

  return (
    <div
      {...(testId ? { 'data-testid': testId } : {})}
      className="flex h-[168px] w-full select-none overflow-hidden rounded-[24px] bg-white/95 ring-1 ring-black/10 dark:bg-[#1c1c1e]/95 dark:ring-white/10"
    >
      {/* 左侧：月 / 星期 / 大号日期 */}
      <div className="flex w-[108px] shrink-0 flex-col justify-center pl-6">
        <p className="text-[15px] leading-none text-black/35 dark:text-white/35">{monthText}</p>
        <p className="mt-[6px] text-[19px] font-bold leading-none text-[#161618] dark:text-white">{weekText}</p>
        <p className="mt-[2px] text-[54px] font-bold leading-[1.08] tracking-tight text-[#161618] tabular-nums dark:text-white">
          {now ? today : ''}
        </p>
      </div>
      {/* 右侧：整月网格（周表头 + 日期，行高自适应压缩，最多 6 行也在 168px 内） */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[4px] pr-4">
        <div className="grid grid-cols-7">
          {WEEKDAY_HEADER.map((w, i) => (
            <span
              key={`h-${w}`}
              className={`text-center text-[11px] font-semibold leading-none ${
                i >= 5 ? 'text-black/30 dark:text-white/30' : 'text-black/65 dark:text-white/65'
              }`}
            >
              {w}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7" style={{ gridAutoRows: '19px' }}>
          {cells.map((d, i) => {
            const isToday = d === today;
            const weekend = i % 7 >= 5;
            return (
              <span key={`c-${i}-${d ?? 'x'}`} className="grid place-items-center">
                {d === null ? null : (
                  <span
                    className={`grid h-[19px] w-[19px] place-items-center rounded-full text-[11.5px] leading-none tabular-nums ${
                      isToday
                        ? 'bg-[#161618] font-semibold text-white dark:bg-white dark:text-black'
                        : weekend
                          ? 'text-black/30 dark:text-white/30'
                          : 'text-black/75 dark:text-white/75'
                    }`}
                  >
                    {d}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
