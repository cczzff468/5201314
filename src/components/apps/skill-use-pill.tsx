'use client';

/**
 * v1.3 Shizuku 技能使用浮层（五端共用：信息/QQ/QQ群/微信/微信群）：
 * AI 执行 [手机操作:…] 标记期间，聊天界面正中央弹出椭圆形胶囊包裹的提示——
 * 执行中转圈「谁 正在使用技能 · 命令」；完成后变绿勾（成功）/红叉（失败）+ 简要结果，
 * 约 1.8s 后自动淡出。结果同时照旧以系统行落盘进消息流与 AI 历史，浮层只是屏幕中央的即时可视化。
 * 纯展示浮层：pointer-events-none 全程不挡聊天交互；start/finish 均为稳定引用（ref+函数式 setState），
 * 在五端巨大的 useCallback/异步闭包里捕获也不会失效。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleCheck, CircleX, Loader2, Sparkles } from 'lucide-react';

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
          {/* 椭圆形包裹：胶囊（rounded-full）+ 毛玻璃 + 细描边，视觉重心在屏幕正中 */}
          <div
            className="flex max-w-[82%] items-center gap-2 rounded-full bg-black/60 py-2.5 pl-4 pr-5 shadow-xl ring-1 ring-white/15 backdrop-blur-xl"
            title={pill.note || undefined}
          >
            {pill.phase === 'run' ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/85" aria-hidden="true" />
            ) : pill.phase === 'ok' ? (
              <CircleCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
            ) : (
              <CircleX className="h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
            )}
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-none text-white/95">
              {pill.phase === 'run' ? (
                <>
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-300/90" aria-hidden="true" />
                  <span className="shrink-0 font-medium">{pill.name}</span>
                  <span className="shrink-0 text-white/55">正在使用技能</span>
                  <span className="text-white/35">·</span>
                  <span className="truncate text-white/80">{pill.cmd}</span>
                </>
              ) : (
                <>
                  <span className="shrink-0 font-medium">{pill.name}</span>
                  <span className={`shrink-0 ${pill.phase === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {pill.phase === 'ok' ? '技能执行成功' : '技能执行失败'}
                  </span>
                  <span className="text-white/35">·</span>
                  <span className="truncate text-white/70">{pill.note || pill.cmd}</span>
                </>
              )}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
