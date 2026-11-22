'use client';

import { Loader2, X } from 'lucide-react';
import type { ToolStatusPayload } from '@/lib/ios/tool-status-bubble';

/**
 * 工具调用状态气泡（毛玻璃椭圆胶囊）。
 * 居中显示在聊天列表内，不带头像/不带聊天气泡尖角/不带绿勾。
 * v2.3 修复文字截断：
 * - 去掉 truncate/text-overflow（绝不出现「x已冻结备…」这种被切掉的文案）；
 * - white-space: nowrap 强制不换行 + display: inline-flex + width: auto，
 *   胶囊宽度严格随文字自然撑开（左右方向自由延展，不写死 width/max-width）。
 * - 执行中：[角色名]正在[动作]...（带旋转 Loader）
 * - 成功：[角色名]已[动作]...（无图标）
 * - 失败：[角色名]尝试[动作]失败了（带 ✕）
 */
export function ToolStatusBubble({ tool }: { tool: ToolStatusPayload }) {
  const icon =
    tool.status === 'pending' ? (
      <Loader2 className="h-3 w-3 shrink-0 animate-spin opacity-70" />
    ) : tool.status === 'fail' ? (
      <X className="h-3 w-3 shrink-0 text-[#FF453A]" />
    ) : (
      null
    );
  return (
    <div className="my-1.5 flex w-full justify-center px-2" data-testid="tool-status-bubble">
      <div
        className="inline-flex w-auto shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-black/5 px-3.5 py-[7px] text-[12.5px] leading-normal text-black/55 ring-1 ring-black/5 backdrop-blur-xl dark:bg-white/10 dark:text-white/70 dark:ring-white/10"
        style={{ minHeight: 24, boxSizing: 'border-box' }}
      >
        {icon}
        <span className="font-medium">{tool.title}</span>
        {tool.body ? <span className="font-normal opacity-70">{tool.body}</span> : null}
      </div>
    </div>
  );
}
