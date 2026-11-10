'use client';

/**
 * v1.5 Mobile Agent 全局 UI 层（挂在 PhoneShell 全局层，layersReady 后常驻、闲置零开销）：
 *  - AgentRunnerBar：任务运行中的灵动岛弹出式进度卡（从灵动岛胶囊几何弹性展开，
 *    深色毛玻璃简约风；轮次/步骤/播报 + 急停胶囊），任务结束后展示结果摘要
 *    4s 自动缩回灵动岛（v1.9.3 重构，完成态状态点已移除）；
 *  - AgentConfirmHost：敏感操作全屏确认卡（requestDangerConfirm 的 React 宿主，
 *    未挂载时 requestDangerConfirm 自动兜底 window.confirm）。
 * 均为壳内 absolute 定位（与 GlobalCallLayer/IncomingCallLayer 同域，不逃出手机壳）。
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  agentRequestStop,
  resolveDangerRequest,
  setAgentConfirmHostMounted,
  subscribeDangerRequests,
  useAgentState,
  type DangerConfirmRequest,
} from '@/lib/ios/shizuku-agent';
import { useUI } from '@/lib/ios/store';

const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 收起姿态 = 灵动岛胶囊几何（与 PhoneShell 静态灵动岛完全一致，弹出/收回在此无缝形变） */
const PILL = { width: 118, height: 33, borderRadius: 17 } as const;
/** 展开姿态：宽高自适应内容 */
const EXPANDED = { width: 'auto', height: 'auto', borderRadius: 26 } as const;
/** 弹性形变（与灵动岛通知卡同参数：弹性只给尺寸） */
const SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const;

/**
 * Agent 运行进度卡（v1.9.3 重构：从灵动岛原位弹出，iOS Live Activity 同款交互）：
 * - 几何：收起时=灵动岛胶囊（118×33 圆角 17），展开时弹性形变为自适应卡；
 *   收起（任务结束 4s 后）缩回胶囊并淡出，与灵动岛无缝交接；
 * - 材质：深色毛玻璃（半透黑 + backdrop-blur-2xl + 高光细描边），白字简约排版；
 * - 状态：运行中=左侧迷你 Siri 光珠慢旋 + 任务名 + 急停胶囊；结束后无状态点
 *   （红点已按需求移除），只展示结果摘要 4s 自动缩回；
 * - 层级 z-[82]：盖过静态灵动岛（z-80）、状态栏（z-70），低于灵动岛通知卡（z-93）
 *   与敏感操作确认卡（z-95）；锁屏/熄屏/多任务切换器打开时整卡隐身（任务继续跑）。
 * - v1.9.5：根节点带 data-agent-ui 标记——agent-screen 的观察/遮挡判定把本卡视为
 *   透明浮层（不算遮挡、不入可点清单）：否则展开时盖住 App 顶部导航，Agent 永远
 *   看不见「完成/保存」类按钮，任务总差最后一步。急停按钮只留给机主本人。
 */
export function AgentRunnerBar() {
  const st = useAgentState();
  const locked = useUI((s) => s.locked);
  const screenOff = useUI((s) => s.screenOff);
  const switcherOpen = useUI((s) => s.switcherOpen);
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

  // 锁屏/熄屏/切换器期间隐身但不卸载（任务照跑，回来即见）；AnimatePresence 收场动画
  const showable = st.running || (!!cycleKey && hiddenKey !== cycleKey);
  const visible = showable && !locked && !screenOff && !switcherOpen;

  const title = st.finished
    ? st.ok
      ? '任务完成'
      : '任务已停止'
    : trunc(st.task || '任务进行中', 22);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="agent-runner-bar"
          initial={{ ...PILL, opacity: 0.9 }}
          animate={{ ...EXPANDED, opacity: 1 }}
          exit={{ ...PILL, opacity: 0, transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] } }}
          transition={SPRING}
          role="status"
          aria-live="polite"
          data-testid="agent-runner-bar"
          data-agent-ui=""
          className="pointer-events-auto absolute left-1/2 top-[11px] z-[82] w-[calc(100%-24px)] max-w-[340px] -translate-x-1/2 overflow-hidden bg-[#101014]/72 text-white shadow-[0_16px_44px_-12px_rgba(0,0,0,0.6)] ring-1 ring-white/14 backdrop-blur-2xl"
        >
          {/* 内容：形变基本完成后淡入，收起立即淡出（防形变过程重排可见） */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.18, delay: 0.12 }}
            className="w-full px-4 pb-3 pt-2.5"
          >
            {/* 行1：状态标识 + 标题 + 急停 */}
            <div className="flex min-h-[26px] items-center gap-2.5">
              {st.running ? (
                <span
                  aria-hidden="true"
                  className="h-[13px] w-[13px] shrink-0 rounded-full"
                  style={{
                    background: 'conic-gradient(from 0deg, #6EE7F9, #A78BFA, #F472B6, #FB923C, #6EE7F9)',
                    animation: 'agentUiOrbSpin 1.6s linear infinite',
                    filter: 'drop-shadow(0 0 4px rgba(167,139,250,0.55))',
                  }}
                />
              ) : null}
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-wide">{title}</span>
              {st.running && (
                <button
                  type="button"
                  onClick={() => agentRequestStop('ui')}
                  disabled={st.stopRequested}
                  className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-[#FF453A]/85 px-3 text-[12px] font-medium text-white ring-1 ring-white/25 transition active:scale-95 disabled:opacity-70"
                  aria-label="停止 Agent 任务"
                >
                  {st.stopRequested ? (
                    <span
                      className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white"
                      aria-hidden="true"
                    />
                  ) : (
                    <span className="text-[9px] leading-none" aria-hidden="true">
                      ■
                    </span>
                  )}
                  {st.stopRequested ? '停止中' : '停止'}
                </button>
              )}
            </div>

            {/* 行2：进度（运行中）/ 结果摘要（结束后，红点已移除的简约收尾） */}
            {st.running ? (
              <p className="mt-0.5 truncate text-[11px] text-white/60">
                第 {st.round}/{st.maxRounds} 轮 · 步骤 {st.stepIndex}/{st.stepTotal}
                {st.stepDesc ? ` · ${trunc(st.stepDesc, 16)}` : ''}
              </p>
            ) : st.summary ? (
              <p className="mt-0.5 truncate text-[11px] text-white/60">{trunc(st.summary, 56)}</p>
            ) : null}

            {/* 行3：播报跑马灯（运行中且非空） */}
            {st.running && st.narration ? (
              <p className="mt-0.5 truncate text-[11px] text-white/75">{st.narration}</p>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
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
      {/* 本组件专用动画（类名唯一不外泄）：进度卡迷你光珠慢旋 */}
      <style>{`@keyframes agentUiOrbSpin{to{transform:rotate(360deg)}}`}</style>
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
