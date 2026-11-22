'use client';

/**
 * 输入框上方快捷功能条（聊天输入框自定义 › 输入框上方功能）
 * ---------------------------------------------------------------------------
 * 把「+」面板里的功能以小胶囊放到输入框上面（面板本身保持原样不动——用户指定
 * 「加号面板里面的功能不要动，把功能放到输入框上面」）；点一下与点加号面板里
 * 那一项完全等效（同一条 onAction/onClick）。
 * 微信/QQ 单聊与群聊四端共用；信息 App 不接入。
 *
 * 样式（用户指定；第五十八轮图标主题化——古早 = RtPlus* 实心剪影随主题传入）：
 *  - 默认主题：无椭圆胶囊包裹——裸图标 + 文字一行排开；
 *    图标黑白色（浅色黑 / 深色白，currentColor 单色，与参考图一致）；
 *  - 液态玻璃主题：每颗独立乳白玻璃胶囊（lg-chip），延续玻璃质感；
 *  - 古早主题：裸图标 + 文字（与默认同布局），文字用复古深灰，
 *    图标由宿主传入 RtPlus* 实心剪影（颜色走 --rt-ic-* 深浅自适应）。
 */
import type { ReactNode } from 'react';

export interface QuickBarItem {
  /** 功能 key（与加号面板一致，如 camera / rp） */
  key: string;
  /** 功能名（与加号面板同文案） */
  label: string;
  /** 小图标（任意尺寸 svg，条内统一压到 14px；currentColor 单色 = 黑白色） */
  icon: ReactNode;
  /** 点击行为（与加号面板点该项完全等效） */
  onClick: () => void;
}

export function ChatQuickBar({
  items,
  liquid,
  retro,
  testPrefix,
}: {
  items: QuickBarItem[];
  /** 液态玻璃主题：玻璃胶囊 */
  liquid?: boolean;
  /** 古早主题：复古深灰文字（图标由宿主传入 RtPlus* 实心剪影） */
  retro?: boolean;
  /** data-testid 前缀（wx / wxg / qq / qqg） */
  testPrefix: string;
}) {
  if (items.length === 0) return null;
  return (
    <div
      className="no-scrollbar flex items-center gap-x-3.5 overflow-x-auto py-[3px]"
      data-testid={`${testPrefix}-quick-bar`}
      role="toolbar"
      aria-label="输入框上方功能"
    >
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          data-testid={`${testPrefix}-quick-${it.key}`}
          onClick={it.onClick}
          className={`flex shrink-0 items-center gap-[3px] transition active:scale-95 [&_svg]:h-[14px] [&_svg]:w-[14px] ${
            liquid
              ? /* 液态玻璃：乳白玻璃小胶囊 */ 'lg-chip h-[26px] rounded-full px-2.5 text-black/70 dark:text-white/75'
              : retro
              ? /* 古早：裸图标+文字，复古深灰字（图标为 RtPlus* 实心剪影） */
                'text-[#4A4E58] dark:text-white/70'
              : /* 默认主题：无胶囊包裹，裸图标+文字，黑白色 */ 'text-black/55 dark:text-white/65'
          }`}
        >
          {it.icon}
          <span className="whitespace-nowrap text-[11.5px] font-medium leading-none">{it.label}</span>
        </button>
      ))}
    </div>
  );
}
