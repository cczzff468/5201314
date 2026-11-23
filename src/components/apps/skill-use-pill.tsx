'use client';

/**
 * v1.3 技能使用浮层（五端共用：信息/QQ/QQ群/微信/微信群）。
 *
 * v2.4.3 与 ToolStatusBubble 统一样式 + 文案简化（机主规格「把所有的工具使用提示
 * 都统一一下样式，然后简化一下」）：
 * - 文案三态与聊天内工具气泡完全同口径——执行中「{谁} 正在{动作}…」/ 成功
 *   「{谁} 已{动作}」/ 失败「{谁} {动作}失败」，删掉「正在使用技能」「技能执行
 *   成功/失败」这类冗词；
 * - 图标徽章与 ToolStatusBubble 同款（Loader 旋转 / 绿勾圆徽 / 红叉圆徽）；
 * - 保留深色毛玻璃胶囊（浮层悬在聊天正中，任何底色上都必须可读）。
 * 纯展示浮层：pointer-events-none 全程不挡聊天交互；start/finish 均为稳定引用
 * （ref+函数式 setState），在五端巨大的 useCallback/异步闭包里捕获也不会失效。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Loader2, X } from 'lucide-react';

export type OpPillState = {
  /** 操作者显示名（角色名/群成员名） */
  name: string;
  /** 命令名（点按/滑动/打开/强杀…，取标记冒号前的第一段） */
  cmd: string;
  /** run=执行中 ok=成功 fail=失败（停留片刻后自动消失） */
  phase: 'run' | 'ok' | 'fail';
  /** 结果备注（失败原因等；成功时通常为空） */
  note?: string;
};

/**
 * 技能浮层状态钩子：start() 在 phone-op 分支同步调用（占位系统行入列的同一时刻），
 * finish() 在 executePhoneOp 返回后调用。连续多个操作时 start 会覆盖并清掉旧定时器。
 */
export function useOpPill() {
  const [pill, setPill] = useState<OpPillState | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const start = useCallback(
    (name: string, cmd: string) => {
      clearTimer();
      setPill({ name, cmd, phase: 'run' });
    },
    [clearTimer],
  );

  const finish = useCallback(
    (ok: boolean, note?: string) => {
      setPill((p) => (p ? { ...p, phase: ok ? 'ok' : 'fail', note } : p));
      clearTimer();
      // 成功/失败停留 1.8s 再淡出（结果行已在消息流里，浮层只做即时反馈）
      timerRef.current = window.setTimeout(() => setPill(null), 1800);
    },
    [clearTimer],
  );

  return { pill, start, finish };
}

/**
 * 椭圆形胶囊浮层本体：挂在各聊天页根容器（relative）内，
 * absolute inset-0 居中——即「聊天界面正中间」。
 */
export function SkillUsePill({ pill }: { pill: OpPillState | null }) {
  return (
    <AnimatePresence>
      {pill && (
        <motion.div
          key="skill-use-pill"
          className="pointer-events-none absolute inset-0 z-[75] flex items-center justify-center"
          initial={{ opacity: 0, scale: 0.82 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9, y: -6 }}
          transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
          aria-live="polite"
          data-testid="skill-use-pill"
        >
          {/* 深色毛玻璃胶囊：与 ToolStatusBubble 同款图标徽章 + 同款三态文案 */}
          <div
            className="flex max-w-[82%] items-center gap-2 rounded-full bg-black/55 px-3.5 py-[7px] shadow-xl ring-1 ring-white/15 backdrop-blur-xl"
            style={{ minHeight: 30, boxSizing: 'border-box' }}
            title={pill.note || undefined}
          >
            {pill.phase === 'run' ? (
              <Loader2 className="h-[15px] w-[15px] shrink-0 animate-spin text-white/70" aria-hidden="true" />
            ) : pill.phase === 'ok' ? (
              <span
                aria-hidden
                className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-emerald-500/15"
              >
                <Check className="h-[11px] w-[11px] text-emerald-400" strokeWidth={3} />
              </span>
            ) : (
              <span
                aria-hidden
                className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-[#FF453A]/15"
              >
                <X className="h-[11px] w-[11px] text-[#FF6961]" strokeWidth={2.6} />
              </span>
            )}
            <span
              className={`truncate text-[12.5px] leading-none ${
                pill.phase === 'fail' ? 'text-[#FF6961]' : 'text-white/90'
              }`}
            >
              {pill.phase === 'run'
                ? `${pill.name} 正在${pill.cmd}…`
                : pill.phase === 'ok'
                  ? `${pill.name} 已${pill.cmd}`
                  : `${pill.name} ${pill.cmd}失败`}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
