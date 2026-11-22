'use client';

/**
 * 动作描写行（微信 / QQ / 信息 / 微信群聊 / QQ群聊 五端共用）：
 * 居中灰色小字、独立成行、不占气泡位置；群聊场景带发言者名字前缀区分是谁的动作。
 * 文本由 @/lib/action-desc 的 actionDescViewOf 解析产出（已去星号），
 * 调用方按 before/after 顺序逐段渲染本行。
 */
export function ActionDescLine({ text, actorName, testId }: { text: string; actorName?: string; testId?: string }) {
  return (
    <div className="py-[3px] text-center" data-testid={testId}>
      <span className="select-none whitespace-pre-wrap break-words text-[12.5px] leading-[1.5] text-black/40 dark:text-white/40">
        {actorName ? `${actorName} ${text}` : text}
      </span>
    </div>
  );
}
