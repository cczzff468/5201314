'use client';

/**
 * v1.5 Mobile Agent 全局 UI 层（挂在 PhoneShell 全局层，layersReady 后常驻、闲置零开销）：
 *  - AgentRunnerBar：任务运行中的顶部进度胶囊（轮次/步骤/播报 + 急停按钮），
 *    任务结束后显示结果 4s 自动淡出；
 *  - AgentConfirmHost：敏感操作全屏确认卡（requestDangerConfirm 的 React 宿主，
 *    未挂载时 requestDangerConfirm 自动兜底 window.confirm）。
 * 均为壳内 absolute 定位（与 GlobalCallLayer/IncomingCallLayer 同域，不逃出手机壳）。
 */

import { useEffect, useState } from 'react';
import {
  agentRequestStop,
  resolveDangerRequest,
  setAgentConfirmHostMounted,
  subscribeDangerRequests,
  useAgentState,
  type DangerConfirmRequest,
} from '@/lib/ios/shizuku-agent';

const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Agent 运行进度条（z-[60]：高于 App 窗口与迷你播放器，低于多任务切换器/锁屏）。
 * 显示条件：任务运行中；或刚结束（finished 后 4s 内展示结果摘要再淡出）。
 */
export function AgentRunnerBar() {
  const st = useAgentState();
  // finished 后 4s 自动隐藏：以「本轮结束结果」为标识记录已隐藏（setHiddenKey 只在
  // 定时器回调里调用，规避 effect 体内同步 setState 的级联渲染）；
  // 标识含 round/maxRounds/summary——新一轮任务的结束结果标识不同，自然重新显示 4s
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);
  const cycleKey = st.finished ? `${st.round}#${st.maxRounds}#${st.summary ?? ''}` : null;
  useEffect(() => {
    if (!cycleKey || hiddenKey === cycleKey) return undefined;
    const t = window.setTimeout(() => setHiddenKey(cycleKey), 4000);
    return () => window.clearTimeout(t);
  }, [cycleKey, hiddenKey]);

  const visible = st.running || (!!cycleKey && hiddenKey !== cycleKey);
  if (!visible) return null;

  const dotTone = st.finished ? (st.ok ? 'bg-emerald-500' : 'bg-red-500') : 'animate-pulse bg-emerald-500';
  const title = st.finished
    ? st.ok
      ? 'Agent · 任务完成'
      : 'Agent · 已停止'
    : `Agent · ${trunc(st.task || '任务进行中', 24)}`;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-16 z-[60] flex justify-center px-2"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto w-[86%] rounded-[24px] bg-background/80 p-3 ring-1 ring-black/10 backdrop-blur-md dark:ring-white/15">
        {/* 状态行：呼吸点 + 任务名 + 急停按钮 */}
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dotTone}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{title}</span>
          {st.running && (
            <button
              type="button"
              onClick={() => agentRequestStop('ui')}
              disabled={st.stopRequested}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-red-500 px-4 text-[13px] font-medium text-white transition active:scale-95 disabled:opacity-70"
              aria-label="停止 Agent 任务"
            >
              {st.stopRequested ? (
                <span
                  className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  aria-hidden="true"
                />
              ) : (
                <span className="text-[10px] leading-none" aria-hidden="true">
                  ■
                </span>
              )}
              {st.stopRequested ? '停止中' : '停止'}
            </button>
          )}
        </div>

        {/* 进度行（运行中）/ 结果摘要（结束后） */}
        {st.running ? (
          <p className="mt-1 truncate text-[11px] text-foreground/60">
            第 {st.round}/{st.maxRounds} 轮 · 步骤 {st.stepIndex}/{st.stepTotal}
            {st.stepDesc ? ` · ${trunc(st.stepDesc, 18)}` : ''}
          </p>
        ) : st.summary ? (
          <p className="mt-1 truncate text-[11px] text-foreground/60">{trunc(st.summary, 60)}</p>
        ) : null}

        {/* 播报跑马灯（运行中且非空时一行小字） */}
        {st.running && st.narration ? (
          <p className="mt-0.5 truncate text-[11px] text-foreground/80">{st.narration}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 敏感操作确认卡宿主（z-[95]：高于来电胶囊层之下的全部界面）。
 * 订阅未决请求，同一时间只展示最早一条；挂载状态同步给 shizuku-agent
 * （未挂载时 requestDangerConfirm 自动降级 window.confirm）。
 */
export function AgentConfirmHost() {
  const [reqs, setReqs] = useState<DangerConfirmRequest[]>([]);
  useEffect(() => {
    setAgentConfirmHostMounted(true);
    const un = subscribeDangerRequests(setReqs);
    return () => {
      un();
      setAgentConfirmHostMounted(false);
    };
  }, []);

  const cur = reqs.length > 0 ? reqs[0] : null;
  if (!cur) return null;

  return (
    <div
      className="absolute inset-0 z-[95] flex items-center justify-center bg-black/50"
      role="alertdialog"
      aria-modal="true"
      aria-label={cur.title}
    >
      <div className="w-[82%] max-w-xs rounded-3xl bg-white p-5 shadow-2xl dark:bg-zinc-900">
        <h3 className="text-[15px] font-semibold text-foreground">{cur.title}</h3>
        <div className="thin-scrollbar mt-2.5 max-h-40 overflow-y-auto whitespace-pre-line rounded-xl bg-zinc-100 p-2.5 text-[12px] leading-relaxed text-foreground/80 dark:bg-zinc-800">
          {cur.detail}
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => resolveDangerRequest(cur.id, false)}
            className="h-11 flex-1 rounded-full bg-zinc-100 text-[13px] font-medium text-foreground transition active:scale-95 dark:bg-zinc-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => resolveDangerRequest(cur.id, true)}
            className="h-11 flex-1 rounded-full bg-red-500 text-[13px] font-medium text-white transition active:scale-95"
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  );
}

/** PhoneShell 全局层挂载入口（Agent 运行进度条 + 敏感操作确认弹层） */
export function AgentGlobalLayers() {
  return (
    <>
      <AgentRunnerBar />
      <AgentConfirmHost />
    </>
  );
}

/**
 * Agent 运行状态探针（C1 语音唤起智能体用）：渲染 null，纯副作用——
 * 订阅 Agent 运行态并以布尔回传。给不能静态引入 shizuku-agent（引擎体量大）的
 * 轻组件（悬浮球）借道本文件（PhoneShell 本就 dynamic 引它）订阅运行态。
 */
export function AgentRunningProbe({ onChange }: { onChange: (running: boolean) => void }) {
  const running = useAgentState().running;
  useEffect(() => {
    onChange(running);
  }, [running, onChange]);
  return null;
}
