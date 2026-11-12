'use client';

/**
 * Web 智能体（v1.9.35）：替代旧 Mobile Agent（shizuku-agent.ts 真机 ReAct 引擎，已退役删除）。
 *
 * 机主重构令：放弃对真实手机 App 的操控（不再调用 pm suspend / uiautomator），
 * 智能体工作流全面转入 Web 网页生态。本模块以 ReAct 循环驱动 web-tools.ts 的内部路由：
 *
 *   任务一句话 → LLM 输出工具调用 → 真实执行（灵动岛弹过程卡）→ 结果回传 LLM
 *   → 基于真实结果继续下一步 → … → 全部完成 → 自然语言汇报
 *
 * 与旧版同名的导出面保持兼容（agent-ui.tsx 进度卡 / agent-voice-ball.tsx 语音球零改动）：
 *  useAgentState / agentRequestStop / DangerConfirm 协议 / runAgentTask / setAgentResultAnnouncer
 */

import { useSyncExternalStore } from 'react';
import { getAutonomyConfig } from './shizuku-autonomy';
import { buildPhoneTools, execWebTool, fcRequest, cleanToolLogs, type FcMessage } from './phone-tools';
import { useSettings } from './store';

// ============================================================
// A. Agent 运行状态 store（AgentRunnerBar 灵动岛进度卡用）
// ============================================================

export interface AgentState {
  running: boolean;
  task: string;
  round: number;
  maxRounds: number;
  stepIndex: number;
  stepTotal: number;
  stepDesc: string;
  /** 最近一条播报（跑马灯） */
  narration: string;
  finished: boolean;
  ok?: boolean;
  summary?: string;
  /** 已请求停止：停止按钮转 loading、防止重复触发 */
  stopRequested: boolean;
}

const initialAgentState: AgentState = {
  running: false,
  task: '',
  round: 0,
  maxRounds: 10,
  stepIndex: 0,
  stepTotal: 0,
  stepDesc: '',
  narration: '',
  finished: false,
  stopRequested: false,
};

let agentState: AgentState = initialAgentState;
const agentListeners = new Set<() => void>();

/** 整体替换引用式更新（getSnapshot 必须返回稳定引用，变更时才换新对象） */
function patchAgentState(patch: Partial<AgentState>): void {
  agentState = { ...agentState, ...patch };
  for (const l of agentListeners) {
    try {
      l();
    } catch {
      /* 单个订阅者异常不影响其余 */
    }
  }
}

function subscribeAgent(cb: () => void): () => void {
  agentListeners.add(cb);
  return () => {
    agentListeners.delete(cb);
  };
}

function getAgentSnapshot(): AgentState {
  return agentState;
}

/** React 订阅 Agent 运行状态（AgentRunnerBar 等全局 UI 用） */
export function useAgentState(): AgentState {
  return useSyncExternalStore(subscribeAgent, getAgentSnapshot, getAgentSnapshot);
}

// ---------------- 停止旗标 ----------------

let stopFlag = false;

/** 请求停止当前 Agent 任务（UI 停止按钮） */
export function agentRequestStop(_source: string): void {
  stopFlag = true;
  patchAgentState({ stopRequested: true });
}

// ============================================================
// B. 高危操作确认（Promise 化 + React Host 订阅渲染）
// ============================================================

export interface DangerConfirmRequest {
  id: number;
  title: string;
  detail: string;
  resolve: (ok: boolean) => void;
}

let dangerSeq = 1;
let dangerRequests: DangerConfirmRequest[] = [];
let dangerHostMounted = false;
const dangerListeners = new Set<(reqs: DangerConfirmRequest[]) => void>();

function emitDanger(): void {
  for (const l of dangerListeners) {
    try {
      l(dangerRequests);
    } catch {
      /* 忽略单个订阅者异常 */
    }
  }
}

/** AgentConfirmHost 挂载时置 true：之后的高危确认走全屏确认卡而非 window.confirm */
export function setAgentConfirmHostMounted(mounted: boolean): void {
  dangerHostMounted = mounted;
  // Host 卸载时丢弃未决请求（一律 resolve false），避免 Promise 永远悬着
  if (!mounted && dangerRequests.length > 0) {
    const pending = dangerRequests;
    dangerRequests = [];
    emitDanger();
    for (const r of pending) {
      try {
        r.resolve(false);
      } catch {
        /* 忽略 */
      }
    }
  }
}

/** 请求用户确认一个敏感操作（React Host 已挂载 → 全屏确认卡；未挂载 → window.confirm 兜底） */
export function requestDangerConfirm(title: string, detail: string): Promise<boolean> {
  if (typeof window !== 'undefined' && !dangerHostMounted) {
    return Promise.resolve(window.confirm(`${title}\n\n${detail}`));
  }
  return new Promise<boolean>((resolve) => {
    dangerRequests = [...dangerRequests, { id: dangerSeq++, title, detail, resolve }];
    emitDanger();
  });
}

/** AgentConfirmHost 订阅未决请求（数组引用整体替换，快照稳定） */
export function subscribeDangerRequests(cb: (reqs: DangerConfirmRequest[]) => void): () => void {
  dangerListeners.add(cb);
  return () => {
    dangerListeners.delete(cb);
  };
}

/** 回填一条确认结果（确认卡按钮点击） */
export function resolveDangerRequest(id: number, ok: boolean): void {
  const hit = dangerRequests.find((r) => r.id === id);
  if (!hit) return;
  dangerRequests = dangerRequests.filter((r) => r.id !== id);
  emitDanger();
  try {
    hit.resolve(ok);
  } catch {
    /* 忽略 */
  }
}

// ============================================================
// C. 任务接口（与旧版 runAgentTask 兼容的签名）
// ============================================================

export type AgentEvent = { type: 'say' | 'step' | 'stepfail' | 'danger' | 'stopped' | 'done' | 'fail'; text: string };

export interface AgentResult {
  ok: boolean;
  text: string;
}

export interface AgentCtx {
  /** 最近对话（语音球交接任务时的指代消解：「再试一次/继续」脱离会话没法懂） */
  recentChat?: string;
}

/** 任务终态播报钩子（agent-voice-ball 注册：语音来源的任务结束时朗读结果） */
let agentResultAnnouncer: ((text: string) => void) | null = null;

export function setAgentResultAnnouncer(fn: ((text: string) => void) | null): void {
  agentResultAnnouncer = typeof fn === 'function' ? fn : null;
}

/** 敏感任务关键词（命中先弹确认卡再动手） */
const DANGER_PATTERNS = /转账|付款|支付|红包|扣款|充值|退款|卸载|删除|清空|发帖|发布|公开|公开处刑|挂到网上/;

/** Web 智能体系统提示词（ReAct 循环驱动 web-tools） */
function webAgentSystemPrompt(recentChat?: string): string {
  return [
    '你是这台「AI Phone」虚拟手机里的智能助手（像 Siri / 小爱同学），机主刚给你下达了一个任务。这台手机里的所有 App（微信/QQ/信息/X论坛/音乐/备忘录/时钟/天气/淘宝/美团…）都活在同一个网页生态里，你已经接入内部工具，可以真实完成任务。',
    '',
    '【工作方式·ReAct】',
    '1. 分析任务，决定第一个动作，直接输出工具调用（tool call）；',
    '2. 系统会真实执行，并把结果回传给你（role:"tool"）；',
    '3. 基于真实结果继续下一步——多个动作按顺序逐个链式调用（如发消息 → 记备忘录 → 定闹钟），直到目标全部完成；',
    '4. 收尾时用一两句自然的话向机主汇报总结果。',
    '',
    '【纯净度铁律】最终汇报里严禁出现任何底层日志：(内心独白：…)、(正在操作：…)、工具名、参数、执行步骤清单一律不许出现——操作过程机主会从灵动岛弹窗看到，你只说人话（如「微信已经发给Z啦，闹钟也定好了」）。',
    '【结果如实】工具回传的结果是真实反馈：成功才能说做好了；失败（联系人不存在/能力未开启/没搜到）如实汇报，可以换准确参数重试一次，绝不编造结果。',
    '【参数】任务里提到的联系人名/歌名/城市/内容要原样放进工具参数，不要自己改写；时间用「HH:mm」或自然说法（工具都认）。',
    '【禁止】不调工具只回文字计划是违规；一台手机里没有的能力（打真电话/发短信到真手机/操作手机外的软件）如实说做不到，不要假装。',
    recentChat?.trim()
      ? `\n【最近对话（指代消解用）】机主刚才和你说过这些话，「再试一次/继续/还是那个」指的就是其中提到的目标：\n${recentChat.trim()}`
      : '',
  ]
    .filter((x) => x !== undefined)
    .join('\n');
}

/**
 * 运行一个 Web 智能体任务：三道闸 → 防重入 → 敏感确认 → ReAct 工具循环
 * （最多 maxRounds 轮，每轮可含多个工具调用）→ 自然语言收尾。
 * 每个工具执行都会从灵动岛弹出过程卡；进度卡（AgentRunnerBar）实时显示轮次与播报。
 */
export async function runAgentTask(
  task: string,
  opts?: { onEvent?: (e: AgentEvent) => void; ctx?: AgentCtx; maxRounds?: number },
): Promise<AgentResult> {
  const emit = (type: AgentEvent['type'], text: string): void => {
    try {
      opts?.onEvent?.({ type, text });
    } catch {
      /* 回调异常不影响主流程 */
    }
  };

  // ---- 三道闸 ----
  const acfg = getAutonomyConfig();
  if (!acfg.master) {
    return { ok: false, text: '「AI 动手」总开关未打开（设置 › AI 动手），任务被拒绝' };
  }
  if (acfg.caps['agent'] !== true) {
    return { ok: false, text: '「智能体多步任务」能力未开启（设置 › AI 动手）' };
  }
  const apiConfig = useSettings.getState().apiConfig;
  if (!apiConfig.baseUrl.trim()) {
    return { ok: false, text: '还没有配置 AI 接口（设置 › API 配置），任务跑不了' };
  }
  // ---- 防重入 ----
  if (agentState.running) {
    return { ok: false, text: '已有任务在运行，等它做完再说' };
  }
  const t = task.trim();
  if (!t) return { ok: false, text: '任务内容为空' };

  const tools = buildPhoneTools();
  if (tools.length === 0) {
    return { ok: false, text: '「AI 动手」里没有任何能力开关打开（设置 › AI 动手），先开至少一项再派任务' };
  }

  // ---- 敏感任务确认（公开发帖/支付类词命中先弹卡） ----
  if (DANGER_PATTERNS.test(t)) {
    emit('danger', `任务含敏感动作，正在征求机主确认：${t.slice(0, 40)}`);
    const ok = await requestDangerConfirm('AI 智能体请求执行任务', `TA 想替你执行：${t.slice(0, 80)}${t.length > 80 ? '…' : ''}\n\n其中包含公开发布/支付类动作，允许执行吗？`);
    if (!ok) {
      return { ok: false, text: '你没有允许，这次任务就先不执行了' };
    }
  }

  // ---- 初始化 ----
  stopFlag = false;
  const maxRounds = Math.max(3, Math.min(12, opts?.maxRounds ?? 8));
  patchAgentState({
    running: true,
    task: t,
    round: 0,
    maxRounds,
    stepIndex: 0,
    stepTotal: 0,
    stepDesc: '',
    narration: '正在分析任务…',
    finished: false,
    ok: undefined,
    summary: undefined,
    stopRequested: false,
  });
  emit('say', `收到任务：${t.slice(0, 40)}`);

  const convo: FcMessage[] = [
    { role: 'system', content: webAgentSystemPrompt(opts?.ctx?.recentChat) },
    { role: 'user', content: t },
  ];

  let usedTools = false;
  let resultText = '';
  let failed = false;

  try {
    for (let round = 1; round <= maxRounds; round++) {
      if (stopFlag) break;
      patchAgentState({ round, narration: `第 ${round}/${maxRounds} 轮·思考下一步…` });
      let msg: Awaited<ReturnType<typeof fcRequest>>;
      try {
        msg = await fcRequest(convo, tools, apiConfig);
      } catch (e) {
        if (e instanceof Error && e.message === 'TOOLS_UNSUPPORTED') {
          failed = true;
          resultText = '当前 AI 接口不支持工具调用，换一个支持 Function Calling 的接口就能派任务了';
          break;
        }
        failed = true;
        resultText = `任务中断：${e instanceof Error ? e.message : '模型请求失败'}`;
        break;
      }
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      if (calls.length === 0) {
        // 纯文字 = 收尾汇报
        resultText = cleanToolLogs(typeof msg.content === 'string' ? msg.content : '');
        break;
      }
      // 工具调用：串行执行，结果回传
      usedTools = true;
      convo.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
      for (const call of calls) {
        if (stopFlag) break;
        const fn = call.function?.name ?? '';
        patchAgentState({ stepIndex: round, stepDesc: fn, narration: `正在执行：${fn}` });
        emit('step', `执行 ${fn}`);
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(call.function?.arguments ?? '{}') as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
        } catch {
          /* 参数不合法按空参数走 */
        }
        let result: string;
        try {
          result = await execWebTool(fn, args);
        } catch (e) {
          result = `【失败】${e instanceof Error ? e.message : '执行异常'}`;
          emit('stepfail', `${fn} 失败`);
        }
        convo.push({ role: 'tool', tool_call_id: call.id ?? '', content: result.slice(0, 8000) });
      }
    }
    // 轮数用尽还没收尾：强收一次汇报
    if (!resultText && !failed && !stopFlag) {
      convo.push({ role: 'user', content: '（系统提示：已达轮数上限。请直接向机主汇报目前的执行结果，不要输出工具名或日志格式。）' });
      try {
        const fin = await fcRequest(convo, [], apiConfig);
        resultText = cleanToolLogs(typeof fin.content === 'string' ? fin.content : '');
      } catch {
        resultText = usedTools ? '事情办了一部分，具体情况可以自己看一眼~' : '这次没能完成任务，稍后再试试？';
      }
    }
    if (stopFlag) {
      emit('stopped', '任务被机主停止');
      resultText = resultText || '任务被停下了，做到哪算哪~';
    }
  } finally {
    const ok = !failed && (usedTools || !!resultText);
    patchAgentState({
      running: false,
      finished: true,
      ok,
      summary: resultText.slice(0, 60),
      narration: '',
      stopRequested: false,
    });
    emit(ok ? 'done' : 'fail', resultText || '任务结束');
    // 语音来源的任务：朗读终态（语音球注册的钩子，读后即清由注册方管理）
    if (agentResultAnnouncer && resultText) {
      try {
        agentResultAnnouncer(resultText);
      } catch {
        /* 播报失败不影响任务 */
      }
    }
  }
  return { ok: !failed, text: resultText || (usedTools ? '办好了~' : '这次没做成，换个说法再试试？') };
}
