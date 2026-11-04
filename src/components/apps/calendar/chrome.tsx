'use client';

/**
 * 小米日历公共框架（Task 16-d）：
 * - CalChrome：主页公共头部（返回主屏 + App 圆角小图标 + 标题「2026/10」+「默认视图 ▾」
 *   五视图下拉 + 右侧 画中画/搜索/⋮(红点+今天/新建菜单)）+ 底部五视图切换胶囊（年 月 周 日 日程）
 * - CalFab：右下角红色圆形新建按钮
 */

import { useState } from 'react';
import { Check, ChevronDown, MoreVertical, PictureInPicture2, Plus, Search } from 'lucide-react';
import { BackToHome } from '@/components/ios/BackToHome';
import { ACCENT, TEXT, TEXT_2, pad2 } from './shared';
import { IconBtn } from './widgets';

/** 五个主页视图 */
export type MainView = 'year' | 'month' | 'week' | 'day' | 'agenda';

/** 视图切换胶囊：轨道/选中片底色（Task 31-a 深色适配，变量由 App 根节点 dark: 变体注入） */
const SEG_TRACK = 'var(--cal-seg-track, #F0F0F0)';
const SEG_ACTIVE = 'var(--cal-seg-active, #FFFFFF)';

const VIEW_TABS: { key: MainView; label: string }[] = [
  { key: 'year', label: '年' },
  { key: 'month', label: '月' },
  { key: 'week', label: '周' },
  { key: 'day', label: '日' },
  { key: 'agenda', label: '日程' },
];

/** 公共头部 + 视图切换胶囊（年视图传 m=undefined，标题只显示年份） */
export function CalChrome({
  view,
  y,
  m,
  onSwitchView,
  onOpenSearch,
  onToday,
  onNew,
}: {
  view: MainView;
  y: number;
  /** 月/周/日/日程视图标题中的月份（0 起）；年视图不传 */
  m?: number;
  onSwitchView: (v: MainView) => void;
  onOpenSearch: () => void;
  onToday: () => void;
  onNew: () => void;
}) {
  const [viewMenu, setViewMenu] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  const yearOnly = m === undefined;
  /** 仅当正在查看真实当前月时月份红字；滑到其它月份恢复黑色（用户反馈） */
  const now = new Date();
  const isNowMonth = !yearOnly && y === now.getFullYear() && m === now.getMonth();

  return (
    <div className="shrink-0">
      {/* 头部：返回 + 图标 + 标题 | 画中画/搜索/更多 */}
      <div className="relative flex items-center justify-between pl-1 pr-3">
        <div className="flex items-center gap-2">
          <BackToHome className="static!" />
          {/* App 小图标：白底圆角卡 + 红色日历图形 */}
          <span
            aria-hidden="true"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] bg-white dark:bg-zinc-800/95"
            style={{ boxShadow: '0 1px 3px rgba(41,36,31,0.10)' }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1.5" y="2.5" width="13" height="11.5" rx="3" stroke={ACCENT} strokeWidth="1.7" />
              <line x1="4.6" y1="6.6" x2="11.4" y2="6.6" stroke={ACCENT} strokeWidth="1.6" strokeLinecap="round" />
              <line x1="4.6" y1="9.9" x2="9" y2="9.9" stroke={ACCENT} strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          {yearOnly ? (
            <span className="text-[26px] font-bold leading-none tracking-tight" style={{ color: TEXT }}>
              {y}
            </span>
          ) : (
            <button
              type="button"
              aria-label="切换视图"
              aria-expanded={viewMenu}
              onClick={() => setViewMenu((v) => !v)}
              data-testid="cal-view-menu-btn"
              className="flex flex-col items-start transition-opacity active:opacity-60"
            >
              <span className="flex items-baseline leading-none">
                <span className="text-[24px] font-bold tracking-tight" style={{ color: TEXT }}>
                  {y}/
                </span>
                <span className="text-[24px] font-bold tracking-tight" style={{ color: isNowMonth ? ACCENT : TEXT }}>
                  {pad2(m + 1)}
                </span>
              </span>
              <span className="mt-[3px] flex items-center gap-0.5 text-[11px] leading-none" style={{ color: TEXT_2 }}>
                默认视图
                <ChevronDown className="h-3 w-3" strokeWidth={2.2} />
              </span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {/* 画中画（装饰） */}
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center" style={{ color: TEXT }}>
            <PictureInPicture2 className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
          <IconBtn label="搜索日程" onClick={onOpenSearch} testId="cal-search-open">
            <Search className="h-[18px] w-[18px]" strokeWidth={2.1} />
          </IconBtn>
          <button
            type="button"
            aria-label="更多操作"
            aria-expanded={moreMenu}
            data-testid="cal-more"
            onClick={() => setMoreMenu((v) => !v)}
            className="relative flex h-8 w-8 items-center justify-center rounded-full transition-opacity active:opacity-50"
            style={{ color: TEXT }}
          >
            <MoreVertical className="h-[18px] w-[18px]" strokeWidth={2.1} />
          </button>
        </div>

        {/* 默认视图下拉菜单 */}
        {viewMenu && (
          <>
            <button
              aria-label="关闭菜单"
              tabIndex={-1}
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setViewMenu(false)}
            />
            <div
              role="menu"
              aria-label="切换视图"
              className="absolute left-[86px] top-[46px] z-50 w-32 overflow-hidden rounded-[12px] bg-white py-1 shadow-lg dark:bg-zinc-800/95 dark:shadow-[0_6px_24px_rgba(0,0,0,0.45)]!"
              style={{ boxShadow: '0 6px 24px rgba(41,36,31,0.16)' }}
            >
              {VIEW_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setViewMenu(false);
                    if (t.key !== view) onSwitchView(t.key);
                  }}
                  className="flex h-9 w-full items-center justify-between px-3.5 text-[14px] transition-colors active:bg-black/[0.04] dark:active:bg-white/10"
                  style={{ color: t.key === view ? ACCENT : TEXT, fontWeight: t.key === view ? 500 : 400 }}
                >
                  {t.label}
                  {t.key === view && <Check className="h-3.5 w-3.5" style={{ color: ACCENT }} strokeWidth={2.6} />}
                </button>
              ))}
            </div>
          </>
        )}

        {/* 更多菜单：今天 / 新建日程 */}
        {moreMenu && (
          <>
            <button
              aria-label="关闭菜单"
              tabIndex={-1}
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setMoreMenu(false)}
            />
            <div
              role="menu"
              aria-label="更多操作"
              className="absolute right-3 top-[40px] z-50 w-32 overflow-hidden rounded-[12px] bg-white py-1 shadow-lg dark:bg-zinc-800/95 dark:shadow-[0_6px_24px_rgba(0,0,0,0.45)]!"
              style={{ boxShadow: '0 6px 24px rgba(41,36,31,0.16)' }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreMenu(false);
                  onToday();
                }}
                className="flex h-9 w-full items-center px-3.5 text-[14px] transition-colors active:bg-black/[0.04] dark:active:bg-white/10"
                style={{ color: TEXT }}
              >
                今天
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreMenu(false);
                  onNew();
                }}
                className="flex h-9 w-full items-center px-3.5 text-[14px] transition-colors active:bg-black/[0.04] dark:active:bg-white/10"
                style={{ color: TEXT }}
              >
                新建日程
              </button>
            </div>
          </>
        )}
      </div>

      {/* 视图切换胶囊 */}
      <div
        role="tablist"
        aria-label="视图切换"
        className="mx-4 mt-2.5 grid h-9 shrink-0 grid-cols-5 rounded-full"
        style={{ backgroundColor: SEG_TRACK }}
      >
        {VIEW_TABS.map((t) => {
          const active = t.key === view;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                if (!active) onSwitchView(t.key);
              }}
              data-testid={`cal-tab-${t.key}`}
              className="flex items-center justify-center rounded-full text-[13px] transition-all duration-200"
              style={
                active
                  ? { backgroundColor: SEG_ACTIVE, boxShadow: '0 1px 4px rgba(41,36,31,0.10)', color: TEXT, fontWeight: 500 }
                  : { color: TEXT_2 }
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 右下角红色圆形新建按钮 */
export function CalFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="新建日程"
      data-testid="cal-fab"
      onClick={onClick}
      className="absolute bottom-7 right-5 z-30 flex h-[52px] w-[52px] items-center justify-center rounded-full shadow-lg transition active:scale-95"
      style={{ backgroundColor: ACCENT }}
    >
      <Plus className="h-6 w-6 text-white" strokeWidth={2.4} />
    </button>
  );
}
