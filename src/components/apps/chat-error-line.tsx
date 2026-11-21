'use client';

import { useEffect, useRef } from 'react';
import { useErrorCenter } from '@/lib/error-center';

/**
 * 聊天错误提示行（v18 机主定调「全部错误提示弹窗化」重做）：
 * - 界面不铺错误文案——只显示一个极简「发送失败」指示（点击弹窗看标题+详细）；
 * - 弹窗由全局错误中心统一渲染（标题 = 分类后的友好文案，详细 = 原始错误全文，
 *   可复制/可选中；带「重试」动作按钮——冷却中点击为 no-op）；
 * - 不进聊天记录（渲染在失败消息位置下方的独立系统行样式）；
 * - 各聊天端（信息/微信/QQ/群聊）共用本组件，改这一处全端生效。
 */

export interface ChatErrorLineProps {
  /** 分类后的友好文案（弹窗标题用） */
  text: string;
  /** 原始错误（弹窗详细用；缺省复制 text） */
  detail?: string;
  /** 重试回调（弹窗内「重试」按钮；空 = 弹窗不带重试） */
  onRetry?: () => void;
  /** 冷却中提示文案（非空 = 重试被拦截，指示行尾展示） */
  cooldownText?: string;
  /** 隐藏回调（兼容旧签名；v18 起指示行不再有长按菜单——保留 prop 不报错） */
  onHide?: () => void;
  testId?: string;
}

export function ChatErrorLine({ text, detail, onRetry, cooldownText, onHide, testId }: ChatErrorLineProps) {
  void onHide; // v18：长按菜单已移除（弹窗承担详情/复制/重试），prop 保留兼容各端调用
  const openError = useErrorCenter((s) => s.openError);
  const errIdRef = useRef('');

  // 上报进全局错误中心（effect 里做：闭包合法捕获最新 onRetry/冷却态；同标题+详情
  // 的重复上报在 store 内合并——合并路径会刷新动作闭包，重试永远指向最新一轮）
  useEffect(() => {
    errIdRef.current = useErrorCenter.getState().report(
      `消息发送失败：${text}`,
      detail && detail !== text ? `${text}\n----\n原始错误：${detail}` : text,
      'chat',
      onRetry
        ? {
            label: '重试',
            run: () => {
              if (cooldownText) return; // 冷却中：no-op（弹窗按钮不知道冷却态，点击静默）
              onRetry();
            },
          }
        : undefined,
    );
  }, [text, detail, onRetry, cooldownText]);

  return (
    <div className="relative flex justify-center py-1.5" data-testid={testId ? `${testId}-wrap` : undefined}>
      <button
        type="button"
        data-testid={testId}
        aria-label="发送失败，点击查看错误详情"
        className="flex items-center gap-1.5 rounded-full bg-black/[0.045] px-2.5 py-0.5 text-center text-[12px] leading-[17px] text-black/40 select-none active:opacity-60 dark:bg-white/10 dark:text-white/45"
        onClick={() => {
          const id = errIdRef.current;
          if (id) openError(id);
        }}
      >
        <span className="inline-block h-[6px] w-[6px] rounded-full bg-red-500/80" aria-hidden />
        发送失败
        {cooldownText ? `（${cooldownText}）` : ' · 点击查看'}
      </button>
    </div>
  );
}
