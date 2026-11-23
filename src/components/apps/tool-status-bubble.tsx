'use client';

import { Check, Loader2, X } from 'lucide-react';
import type { ToolStatusPayload } from '@/lib/ios/tool-status-bubble';

/**
 * 工具调用状态气泡（毛玻璃椭圆胶囊，v2.2.0 样式精修）。
 * 居中显示在聊天列表内，不带头像/不带聊天气泡尖角/不带绿勾。
 *
 * 规范：
 * - 执行中：[角色名]正在[动作]…（旋转 Loader + 中性色）
 * - 成功：[角色名]已[动作]（翠绿小对勾圆徽 + 成功色文字）
 * - 失败：[角色名]尝试[动作]失败了（玫红小叉圆徽）
 * - 文案自然撑开（inline-flex + w-auto，绝不截断）；副文案最多两行省略
 * - 状态图标带同色系淡底圆徽（icon badge），视觉层次：图标 → 主文案 → 副文案
 */
export function ToolStatusBubble({ tool }: { tool: ToolStatusPayload }) {
  const pending = tool.status === 'pending';
  const fail = tool.status === 'fail';

  const icon = pending ? (
    <Loader2 className="h-3 w-3 animate-spin text-black/45 dark:text-white/55" aria-hidden />
  ) : fail ? (
    <span
      aria-hidden
      className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-[#FF453A]/12"
    >
      <X className="h-[11px] w-[11px] text-[#FF453A]" strokeWidth={2.6} />
    </span>
  ) : (
    <span
      aria-hidden
      className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-emerald-500/12"
    >
      <Check className="h-[11px] w-[11px] text-emerald-500" strokeWidth={3} />
    </span>
  );

  return (
    <div className="my-1.5 flex w-full justify-center px-2" data-testid="tool-status-bubble">
      <div
        className="inline-flex w-auto shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-black/[0.045] px-3.5 py-[7px] text-[12.5px] leading-normal ring-1 ring-black/[0.06] backdrop-blur-xl dark:bg-white/[0.09] dark:ring-white/10"
        style={{ minHeight: 30, boxSizing: 'border-box' }}
      >
        {icon}
        <span className={`font-medium ${fail ? 'text-[#FF453A] dark:text-[#FF6961]' : 'text-black/65 dark:text-white/75'}`}>
          {tool.title}
        </span>
        {tool.body ? (
          <span className="max-w-[13rem] truncate font-normal text-black/40 dark:text-white/40">{tool.body}</span>
        ) : null}
      </div>
    </div>
  );
}
