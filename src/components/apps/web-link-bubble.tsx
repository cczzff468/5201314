'use client';

/**
 * 网页分享卡片气泡（「AI 专属分屏浏览器」配套，第二十九轮）：
 *
 * AI 的 sendWebLink 工具发出 / 用户发链接时自动跟卡，渲染为精美的「网页分享卡片」：
 * - favicon（异步抓取失败回 Safari 风格首字母渐变块）+ 标题 + 摘要两行 + 域名底注；
 * - 点击卡片 → 唤起 AI 分屏浏览器（底部半屏面板）加载对应网页（聊天在上半屏保持可见）；
 * - 双向：side='right'（我发出的）箭头指右，side='left'（AI 发来的）箭头指左；
 * - 样式对齐 X论坛分享卡（252px 宽、白底、圆角 14、箭头小方块）。
 */

import { useState } from 'react';
import { Globe, Link2, Lock } from 'lucide-react';
import { openAIBrowser } from '@/lib/ios/ai-browser-store';

export interface WebLinkBubbleData {
  url: string;
  title: string;
  desc?: string;
  favicon?: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

/** favicon 加载失败的首字母方块（Safari 书签风） */
function FaviconFallback({ seed }: { seed: string }) {
  const ch = (seed.replace(/^www\./, '')[0] || 'W').toUpperCase();
  const palette = [
    'from-[#34C759] to-[#30B0C7]',
    'from-[#FF9F0A] to-[#FF6B22]',
    'from-[#5E5CE6] to-[#BF5AF2]',
    'from-[#FF375F] to-[#FF2D55]',
    'from-[#64D2FF] to-[#0A84FF]',
  ];
  const idx = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length;
  return (
    <span className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-gradient-to-br ${palette[idx]} text-[17px] font-bold text-white shadow-[0_2px_6px_rgba(0,0,0,0.14)]`}>
      {ch}
    </span>
  );
}

export function WebLinkBubble({ data, side = 'left' }: { data: WebLinkBubbleData; side?: 'left' | 'right' }) {
  const [iconOk, setIconOk] = useState(Boolean(data.favicon));
  const host = hostOf(data.url);
  const isHttps = /^https:/i.test(data.url);

  return (
    <div
      data-testid="web-link-bubble"
      role="button"
      aria-label={`网页分享：${data.title}，点击在分屏浏览器打开`}
      onClick={() => openAIBrowser({ url: data.url, origin: 'link' })}
      className="relative block w-[252px] cursor-pointer rounded-[14px] bg-white p-3 text-left shadow-[0_5px_16px_rgba(0,0,0,0.10)] transition-transform duration-150 active:scale-[0.97]"
    >
      {/* 箭头指向头像侧（我发出 → 右；AI 发来 → 左） */}
      <span aria-hidden="true" className={`absolute top-[13px] h-[11px] w-[11px] rotate-45 rounded-[2px] bg-white ${side === 'left' ? '-left-[4px]' : '-right-[4px]'}`} />

      {/* 头部：favicon + 域名 + 分享标识 */}
      <span className="flex items-center gap-2">
        {iconOk && data.favicon ? (
          <img
            src={data.favicon}
            alt=""
            className="h-[20px] w-[20px] shrink-0 rounded-[5px] object-contain"
            onError={() => setIconOk(false)}
          />
        ) : (
          <span className="grid h-[20px] w-[20px] shrink-0 place-items-center rounded-[5px] bg-[#007AFF]/12 text-[#007AFF]">
            <Globe className="h-[12px] w-[12px]" strokeWidth={2.2} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-black/60">{host}</span>
        <span className="flex items-center gap-[2px] text-[10.5px] font-medium text-black/35">
          <Link2 className="h-[10.5px] w-[10.5px]" strokeWidth={2.2} />
          网页
        </span>
      </span>

      {/* 标题 + 摘要 */}
      <p className="mt-2 line-clamp-2 text-[13.5px] font-bold leading-[1.4] text-black/90">{data.title || data.url}</p>
      {data.desc ? (
        <p className="mt-1 line-clamp-2 text-[12px] leading-[1.5] text-black/55">{data.desc}</p>
      ) : null}

      {/* 底注：安全锁标 + 域名 + 点击提示 */}
      <span className="mt-2 flex items-center gap-1 border-t border-black/[0.06] pt-1.5 text-[10.5px] text-black/35">
        {isHttps ? <Lock className="h-[9.5px] w-[9.5px]" strokeWidth={2.4} aria-hidden="true" /> : null}
        <span className="truncate">{host}</span>
        <span className="ml-auto shrink-0">轻点打开 ›</span>
      </span>
    </div>
  );
}
