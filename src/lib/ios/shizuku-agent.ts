'use client';

/**
 * Shizuku Mobile Agent（v1.5）：LLM 闭环自主操控手机的核心执行层。
 *
 * 与 [手机操作:…] 一次性标记（shizuku-autonomy.ts）的区别：
 *  - 标记是「单步动作」：AI 输出一条标记、系统执行一条、结果落盘回给 AI；
 *  - Agent 是「多轮任务」：观察屏幕 → LLM 规划 3~8 步 → 逐步执行 → 失败带现场
 *    进下一轮重规划（replan），直到任务完成 / 达到轮数上限 / 用户急停。
 *
 * 安全模型（三道闸 + 敏感确认 + 双通道急停）：
 *  1) 只在原生壳（androidBridge 注入）里可用，浏览器直接拒绝；
 *  2) 「AI 动手」总开关必须打开，且 open/tap/type/key 四项基础能力至少开三项；
 *  3) 每步执行前按动作查单项能力开关（硬拦截，LLM 硬输出也拒）；
 *  4) 涉及转账/卸载/删除等敏感动作（LLM 标 dangerous 或关键词命中）→
 *     弹全屏确认卡（AgentConfirmHost，见 components/apps/agent-ui.tsx），
 *     Host 未挂载时兜底 window.confirm；拒绝即终止整个任务；
 *  5) 急停双通道：界面条「停止」按钮（本地旗标）+ 通知栏急停按钮
 *     （原生 agentShouldStop，主循环每步前轮询）。
 *
 * 输入法自愈：中文输入经原生 inputChinese（可能临时切到中文 IME），任务结束
 * 统一 restoreIme 还原机主原输入法（originalIme 模块级记录）。
 */

import { useSyncExternalStore } from 'react';
import {
  isNativePerception,
  nativeAgentExecuteShell,
  nativeAgentNotify,
  nativeAgentNotifyEnd,
  nativeAgentResetStop,
  nativeAgentShouldStop,
  nativeDumpUi,
  nativeGetScreenResolution,
  nativeInputChinese,
  nativeRestoreIme,
} from './native-perception';
import {
  KEY_CODES,
  labForegroundApp,
  labInputText,
  labKey,
  labOpenApp,
  labScreenSize,
  labSwipe,
  labTap,
} from './shizuku-lab';
import { AUTONOMY_CAPS, getAutonomyConfig, isCapEnabled } from './shizuku-autonomy';
import { extractJsonObject } from './call-upstream';
import { useSettings } from '@/lib/ios/store';

// ============================================================
// B1. Agent 运行状态 store（轻量 pub/sub + useSyncExternalStore）
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
  /** 已请求停止（本地或原生急停）：停止按钮转 loading、防止重复触发 */
  stopRequested: boolean;
}

const initialAgentState: AgentState = {
  running: false,
  task: '',
  round: 0,
  maxRounds: 3,
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

// ---------------- 停止旗标（本地 + 原生双通道） ----------------

let stopFlag = false;
let stopSource = '';

/** 请求停止当前 Agent 任务（本地通道：UI 停止按钮等；原生急停走通知按钮 → 主循环轮询） */
export function agentRequestStop(source: string): void {
  stopFlag = true;
  if (!stopSource) stopSource = source;
  patchAgentState({ stopRequested: true });
}

function isStopRequested(): boolean {
  return stopFlag;
}

/** 停止检查：本地旗标 + 原生 agentShouldStop（每步前都轮询，通知栏急停才有意义） */
async function checkStopped(): Promise<boolean> {
  if (stopFlag) return true;
  try {
    const r = await nativeAgentShouldStop();
    if (r?.stop) {
      agentRequestStop('native-notify');
      return true;
    }
  } catch {
    /* 原生查询失败不视为停止 */
  }
  return false;
}

// ============================================================
// B2. 高危操作确认（Promise 化 + React Host 订阅渲染）
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

/**
 * 请求用户确认一个敏感操作。
 * React Host（AgentConfirmHost）已挂载 → 全屏确认卡；未挂载 → window.confirm 兜底。
 */
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

/** 回填一条确认结果（确认卡按钮点击；同一时间只展示最早一条由 Host 控制） */
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
// B3. UI dump 解析器（uiautomator XML → 扁平节点表 → LLM 摘要）
// ============================================================

export interface UiNode {
  text: string;
  desc: string;
  cls: string;
  resId: string;
  clickable: boolean;
  cx: number;
  cy: number;
  w: number;
  h: number;
  depth: number;
  path: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
};

/** 常见 XML 实体解码（uiautomator dump 会转义属性值里的特殊字符） */
function decodeXmlEntities(s: string): string {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(amp|lt|gt|quot|apos|#39|#[0-9]+|#x[0-9a-fA-F]+);/g, (raw, ent: string) => {
    if (ent.charAt(0) === '#') {
      const code = ent.charAt(1) === 'x' || ent.charAt(1) === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw;
    }
    return NAMED_ENTITIES[ent] ?? raw;
  });
}

function attrOf(attrs: string, name: string): string {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i').exec(attrs);
  return m ? decodeXmlEntities(m[1]) : '';
}

/**
 * 解析 uiautomator dump 的 XML 为扁平节点表。
 * 轻量栈解析（正则逐 token，不引 DOM/XML 依赖）：开标签入栈（自闭合不入栈）、
 * </node> 出栈。XML 被截断等异常场景尽力返回已解析出的节点，绝不抛错
 * （Agent 主循环不能因解析挂掉）。
 */
export function parseUiXml(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  if (!xml || xml.length < 8) return nodes;
  const re = /<(\/?)node\b([^>]*?)(\/?)>/g;
  const stack: { path: string; childIdx: number }[] = [];
  try {
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const closing = m[1] === '/';
      const attrs = m[2] ?? '';
      const selfClose = m[3] === '/';
      if (closing) {
        stack.pop();
        continue;
      }
      const b = /\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(attrs);
      const x1 = b ? Number(b[1]) : 0;
      const y1 = b ? Number(b[2]) : 0;
      const x2 = b ? Number(b[3]) : 0;
      const y2 = b ? Number(b[4]) : 0;
      const depth = stack.length;
      const parent = stack[depth - 1];
      const path = parent ? `${parent.path}/${parent.childIdx++}` : '/0';
      const node: UiNode = {
        text: attrOf(attrs, 'text'),
        desc: attrOf(attrs, 'content-desc'),
        cls: attrOf(attrs, 'class'),
        resId: attrOf(attrs, 'resource-id'),
        clickable: /\bclickable="true"/.test(attrs),
        cx: Math.round((x1 + x2) / 2),
        cy: Math.round((y1 + y2) / 2),
        w: Math.max(0, x2 - x1),
        h: Math.max(0, y2 - y1),
        depth,
        path,
      };
      nodes.push(node);
      if (!selfClose) stack.push({ path, childIdx: 0 });
    }
  } catch {
    /* 解析异常（截断/非法字符）：返回已解析部分，不抛错 */
  }
  return nodes;
}

/**
 * 节点表 → 给 LLM 读的紧凑屏幕摘要。
 * 过滤：text/desc 全空且非 clickable 跳过；w*h==0 跳过；占屏 >90% 的跳过（根布局，
 * 面积以全部节点的最大面积近似屏幕面积）。可点元素排前面，有文字的其次；
 * 超过 maxLines 截断并注明剩余数量。
 */
export function summarizeUi(nodes: UiNode[], maxLines = 70): string {
  if (nodes.length === 0) return '（屏幕上没有可读元素）';
  let maxArea = 0;
  for (const n of nodes) {
    const a = n.w * n.h;
    if (a > maxArea) maxArea = a;
  }
  const rows: { line: string; clickable: boolean }[] = [];
  for (const n of nodes) {
    const area = n.w * n.h;
    if (area === 0) continue;
    if (maxArea > 0 && area > maxArea * 0.9) continue; // 根布局/窗口容器
    const hasText = !!(n.text.trim() || n.desc.trim());
    if (!hasText && !n.clickable) continue;
    const idPart = n.resId ? ` id=${n.resId}` : '';
    const cls = n.cls.replace(/^android\.(widget|view|app)\./, '');
    const line = `${n.clickable ? '[可点] ' : ''}文字=${n.text} 描述=${n.desc} (${n.cx},${n.cy}) ${n.w}x${n.h}${idPart} class=${cls}`;
    rows.push({ line, clickable: n.clickable });
  }
  if (rows.length === 0) return '（屏幕上没有可读元素）';
  // 稳定排序（同优先级保持文档顺序 ≈ 界面自上而下）
  rows.sort((a, b) => Number(b.clickable) - Number(a.clickable));
  const shown = rows.slice(0, maxLines).map((r) => r.line);
  const tail = rows.length > maxLines ? `\n（还有 ${rows.length - maxLines} 个节点未列出）` : '';
  return `共 ${nodes.length} 个节点，有效 ${rows.length} 个：\n${shown.join('\n')}${tail}`;
}

/**
 * 按文字（或 content-desc，不区分大小写包含匹配）找可点元素。
 * 优先级：clickable=true 的命中 > 无 clickable 命中但有文本命中（点其中心，
 * Android 事件冒泡通常可达）；多候选取命中文本最短的（最精确匹配）。
 */
export function findClickableByText(nodes: UiNode[], target: string): UiNode | null {
  const t = target.trim().toLowerCase();
  if (!t) return null;
  let bestClickable: { node: UiNode; len: number } | null = null;
  let bestPlain: { node: UiNode; len: number } | null = null;
  for (const n of nodes) {
    const lens: number[] = [];
    const txt = n.text.trim().toLowerCase();
    const dsc = n.desc.trim().toLowerCase();
    if (txt && txt.includes(t)) lens.push(n.text.trim().length);
    if (dsc && dsc.includes(t)) lens.push(n.desc.trim().length);
    if (lens.length === 0) continue;
    const len = Math.min(...lens);
    if (n.clickable) {
      if (!bestClickable || len < bestClickable.len) bestClickable = { node: n, len };
    } else if (!bestPlain || len < bestPlain.len) {
      bestPlain = { node: n, len };
    }
  }
  return bestClickable?.node ?? bestPlain?.node ?? null;
}

// ============================================================
// B4. 屏幕观察（前台应用 + UI 树摘要）
// ============================================================

export interface AgentObservation {
  fg: string;
  summary: string;
  nodeCount: number;
  ok: boolean;
  /** 解析出的节点表（clickElement 找元素直接复用，免二次 dump） */
  nodes: UiNode[];
}

/** 一次完整观察：前台 App + uiautomator UI 树 → LLM 可读摘要（并行取，失败不互相拖垮） */
export async function agentObserve(): Promise<AgentObservation> {
  const [fgRes, dump] = await Promise.all([labForegroundApp().catch(() => null), nativeDumpUi()]);
  const fg = fgRes && fgRes.ok ? ((fgRes.text.split('\n')[0] ?? '').trim() || '（前台未知）') : '（前台未知）';
  const nodes = dump?.ok && dump.xml ? parseUiXml(dump.xml) : [];
  if (!dump) {
    return {
      fg,
      summary: `前台：${fg}\n（UI 树读取失败：桥无响应——界面可能不支持 uiautomator，如游戏/视频全屏）`,
      nodeCount: 0,
      ok: false,
      nodes: [],
    };
  }
  if (!dump.ok || !dump.xml) {
    return {
      fg,
      summary: `前台：${fg}\n（UI 树读取失败：${dump.reason ?? 'dumpUi 返回空'}——界面可能不支持 uiautomator，如游戏/视频全屏）`,
      nodeCount: 0,
      ok: false,
      nodes: [],
    };
  }
  const summary = `前台：${fg}\n${summarizeUi(nodes)}`;
  return { fg, summary, nodeCount: nodes.length, ok: nodes.length > 0, nodes };
}

// ============================================================
// B5. 动作执行器
// ============================================================

export interface AgentStep {
  action: string;
  args: string;
  /** LLM 标记的敏感动作（执行前需用户确认） */
  dangerous?: boolean;
  why?: string;
}

export interface StepResult {
  ok: boolean;
  text: string;
}

/** 动作 → 单项能力开关（autonomy 的 cap key；wait/lookScreen 是等待/只读不设闸） */
const ACTION_CAP: Record<string, string> = {
  openApp: 'open',
  clickElement: 'tap',
  tapPoint: 'tap',
  inputTextToFocus: 'type',
  pressEnter: 'key',
  pressDelete: 'key',
  back: 'key',
  scroll: 'swipe',
};

/** 单项能力被关的统一文案（与 executePhoneOp 的 DENIED 同语义：硬拦截） */
function capDenied(capKey: string): StepResult {
  const cap = AUTONOMY_CAPS.find((c) => c.key === capKey);
  return { ok: false, text: `该步骤需要「${cap?.label ?? capKey}」能力，但机主已在设置里关闭——重规划时避开此类步骤` };
}

/** 屏幕分辨率：原生 getScreenResolution → wm size（labScreenSize）→ 默认 1080x2340 */
async function agentScreenSize(): Promise<{ w: number; h: number }> {
  const native = await nativeGetScreenResolution();
  if (native && native.width && native.height && native.width > 0 && native.height > 0) {
    return { w: native.width, h: native.height };
  }
  const lab = await labScreenSize();
  return lab ?? { w: 1080, h: 2340 };
}

/** 任务期间被临时切走的原输入法（任务结束 finally 里 restoreIme 还原） */
let originalIme: string | null = null;

/** resolve-activity --brief 输出里挑 component 行（最后一个非空、非 priority= 开头、形如 pkg/.Activity） */
function pickComponent(out: string): string | null {
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.startsWith('priority=')) continue;
    if (/^[\w.]+(\/[\w.$]+)?$/.test(l)) return l;
  }
  return null;
}

/** openApp：resolve-activity 拿精确启动组件 → am start（失败降级 monkey 拉起） */
async function stepOpenApp(pkg: string): Promise<StepResult> {
  if (!/^[\w.]+$/.test(pkg)) {
    return { ok: false, text: `包名「${pkg}」不合法（应为 com.xxx.xxx 形式；不确定包名就在重规划时先 lookScreen 或换策略）` };
  }
  const res = await nativeAgentExecuteShell(
    ['cmd', 'package', 'resolve-activity', '--brief', '-c', 'android.intent.category.LAUNCHER', pkg],
    15000,
  );
  let comp: string | null = null;
  if (res && res.ok) comp = pickComponent(res.out ?? '');
  if (comp) {
    const start = await nativeAgentExecuteShell(['am', 'start', '-n', comp], 15000);
    if (start && start.ok && !/Error|Exception|does not exist|not found/i.test(start.out ?? '')) {
      return { ok: true, text: `已打开 ${pkg}（${comp}）` };
    }
    // am start 未确认成功 → 落到 monkey 兜底
  }
  const monkey = await labOpenApp(pkg);
  return monkey.ok
    ? { ok: true, text: `已打开 ${pkg}（monkey 拉起）` }
    : { ok: false, text: `打开 ${pkg} 失败：${monkey.text}` };
}

/** clickElement：看屏幕（UI 树）→ 文字匹配 → 点中心坐标；失败带观察现场给 replan */
async function stepClickElement(target: string): Promise<StepResult> {
  const t = target.trim();
  if (!t) return { ok: false, text: 'clickElement 缺目标文字' };
  const obs = await agentObserve();
  const hit = obs.ok ? findClickableByText(obs.nodes, t) : null;
  if (!hit) {
    return {
      ok: false,
      text: `屏幕上没有找到含「${t}」的可点元素（当前在 ${obs.fg}，可见元素：${obs.summary.slice(0, 300)}）`,
    };
  }
  const tap = await labTap(hit.cx, hit.cy);
  return tap.ok ? { ok: true, text: `已点击「${t}」(${hit.cx},${hit.cy})` } : { ok: false, text: `点击「${t}」失败：${tap.text}` };
}

/** inputTextToFocus：纯 ASCII 直输；含中文走原生 inputChinese（必要时临时切 IME） */
async function stepInputText(text: string): Promise<StepResult> {
  const s = text.trim();
  if (!s) return { ok: false, text: '要输入的内容为空' };
  if (!/[^\x20-\x7E]/.test(s)) {
    const r = await labInputText(s);
    return r.ok ? { ok: true, text: `已输入（input text）：${s}` } : { ok: false, text: `输入失败：${r.text}` };
  }
  const r = await nativeInputChinese(s);
  if (r === null) {
    return { ok: false, text: `输入失败：原生输入桥无响应（中文无法用 input text 直输，且 APP 壳可能过旧）` };
  }
  if (r.ok === false) {
    return { ok: false, text: `输入失败：${r.reason ?? 'inputChinese 未成功'}` };
  }
  if (r.via === 'ime' && r.switched && r.currentIme) {
    originalIme = r.currentIme; // 任务结束 finally 里统一还原
  }
  const viaText = r.via === 'ime' ? `输入法${r.switched ? '，已临时切换' : ''}` : 'input text';
  return { ok: true, text: `已输入（${viaText}）：${s}` };
}

/** tapPoint："x,y" 直接点坐标 */
async function stepTapPoint(args: string): Promise<StepResult> {
  const m = /^\s*(\d{1,5})\s*[,，]\s*(\d{1,5})\s*$/.exec(args);
  if (!m) return { ok: false, text: `tapPoint 参数不合法（需要 "x,y"，收到「${args}」）` };
  const x = Number(m[1]);
  const y = Number(m[2]);
  const r = await labTap(x, y);
  return r.ok ? { ok: true, text: `已点按 (${x},${y})` } : { ok: false, text: `点按失败：${r.text}` };
}

/** scroll：语义方向滑动（屏分辨率自动算坐标；与 autonomy 的 dirMap 同逻辑） */
async function stepScroll(dir: string): Promise<StepResult> {
  const a = dir.trim();
  if (!['上', '下', '左', '右'].includes(a)) {
    return { ok: false, text: `scroll 方向不合法（上/下/左/右，收到「${dir}」）` };
  }
  const s = await agentScreenSize();
  const cx = s.w / 2;
  const cy = s.h / 2;
  const dx = Math.round(s.w * 0.35);
  const dy = Math.round(s.h * 0.3);
  const dirMap: Record<string, [number, number, number, number]> = {
    上: [cx, cy + dy, cx, cy - dy],
    下: [cx, cy - dy, cx, cy + dy],
    左: [cx + dx, cy, cx - dx, cy],
    右: [cx - dx, cy, cx + dx, cy],
  };
  const c = dirMap[a];
  const r = await labSwipe(c[0], c[1], c[2], c[3], 450);
  return r.ok ? { ok: true, text: `已向${a}滑动` } : { ok: false, text: `滑动失败：${r.text}` };
}

/** 可打断睡眠：每 300ms 查一次本地旗标；被打断返回 false */
async function sleepStoppable(ms: number): Promise<boolean> {
  let waited = 0;
  while (waited < ms) {
    if (isStopRequested()) return false;
    const slice = Math.min(300, ms - waited);
    await new Promise((res) => window.setTimeout(res, slice));
    waited += slice;
  }
  return !isStopRequested();
}

/** wait：分片等待（200~10000ms），每 300ms 检查本地+原生停止旗标 */
async function stepWait(msRaw: string): Promise<StepResult> {
  const n = Number((msRaw || '').trim());
  const total = Number.isFinite(n) ? Math.max(200, Math.min(10000, Math.round(n))) : 1000;
  let waited = 0;
  while (waited < total) {
    if (isStopRequested()) return { ok: false, text: '已被用户停止' };
    const native = await nativeAgentShouldStop();
    if (native?.stop) {
      agentRequestStop('native-notify');
      return { ok: false, text: '已被用户停止' };
    }
    const slice = Math.min(300, total - waited);
    await new Promise((res) => window.setTimeout(res, slice));
    waited += slice;
  }
  return { ok: true, text: `已等待 ${total}ms` };
}

/** 单步执行：按动作分发（每步查单项能力开关，硬拦截） */
export async function execAgentStep(step: AgentStep): Promise<StepResult> {
  const action = (step.action || '').trim();
  const args = typeof step.args === 'string' ? step.args : '';
  try {
    switch (action) {
      case 'openApp': {
        if (!isCapEnabled('open')) return capDenied('open');
        return await stepOpenApp(args.trim());
      }
      case 'clickElement': {
        if (!isCapEnabled('tap')) return capDenied('tap');
        return await stepClickElement(args);
      }
      case 'tapPoint': {
        if (!isCapEnabled('tap')) return capDenied('tap');
        return await stepTapPoint(args);
      }
      case 'inputTextToFocus': {
        if (!isCapEnabled('type')) return capDenied('type');
        return await stepInputText(args);
      }
      case 'pressEnter': {
        if (!isCapEnabled('key')) return capDenied('key');
        const r = await labKey(KEY_CODES.enter);
        return r.ok ? { ok: true, text: '已按回车（Enter）' } : { ok: false, text: `回车失败：${r.text}` };
      }
      case 'pressDelete': {
        if (!isCapEnabled('key')) return capDenied('key');
        const r = await labKey(KEY_CODES.del);
        return r.ok ? { ok: true, text: '已按删除键' } : { ok: false, text: `删除键失败：${r.text}` };
      }
      case 'back': {
        if (!isCapEnabled('key')) return capDenied('key');
        const r = await labKey(KEY_CODES.back);
        return r.ok ? { ok: true, text: '已按返回键' } : { ok: false, text: `返回失败：${r.text}` };
      }
      case 'scroll': {
        if (!isCapEnabled('swipe')) return capDenied('swipe');
        return await stepScroll(args);
      }
      case 'wait':
        return await stepWait(args);
      case 'lookScreen': {
        // 纯观察步：结果（摘要）进 history 给 LLM 下轮决策
        const obs = await agentObserve();
        return { ok: true, text: obs.summary };
      }
      default:
        return {
          ok: false,
          text: `未知动作「${action}」（可用：openApp/clickElement/tapPoint/inputTextToFocus/pressEnter/pressDelete/back/scroll/wait/lookScreen）`,
        };
    }
  } catch (e) {
    return { ok: false, text: `动作 ${action} 执行异常：${e instanceof Error ? e.message : String(e)}` };
  }
}

// ============================================================
// B5+. 单步入口（v1.5：shizuku-autonomy 的 [手机操作:输入/点文字] 接线用）
// 与 Agent 任务内动作共用底层实现，但以 LabResult 形状（{ok,text}）返回，
// 且单步用法没有任务级 finally 兜底——收尾（还原输入法）在这里就地做。
// ============================================================

/**
 * 单步中文输入入口（[手机操作:输入:文字] 的 v1.5 实现）：
 * ASCII 走 labInputText 直输；含中文走原生 inputChinese（必要时临时切中文 IME）。
 * 非任务态（单步用法）输入完立即还原机主原输入法；Agent 任务运行中则交给任务
 * finally 统一还原（避免中途换回打断后续步骤）。
 */
export async function agentInputText(text: string): Promise<StepResult> {
  const r = await stepInputText(text);
  if (!agentState.running && originalIme) {
    void nativeRestoreIme(originalIme);
    originalIme = null;
  }
  return r;
}

/**
 * 单步「点文字」的 UI 树精确路径（[手机操作:点文字:文字] 的 v1.5 首选实现）：
 * agentObserve（uiautomator dump）→ findClickableByText 文字/描述匹配 → 点节点中心。
 * 免截屏 + 视觉识别（快、省 token）；返回 false 时调用方降级 VLM 视觉定位
 * （图标按钮/无文字控件靠视觉路径）。
 */
export async function agentClickText(target: string): Promise<StepResult> {
  const t = target.trim();
  if (!t) return { ok: false, text: '点文字缺目标文字' };
  const obs = await agentObserve();
  if (!obs.ok) return { ok: false, text: `UI 树读取失败：${obs.summary.slice(0, 120)}` };
  const hit = findClickableByText(obs.nodes, t);
  if (!hit) return { ok: false, text: `UI 树未找到「${t}」` };
  const tap = await labTap(hit.cx, hit.cy);
  return tap.ok
    ? { ok: true, text: `已点击「${t}」（UI 树定位 ${hit.cx},${hit.cy}）` }
    : { ok: false, text: `点击「${t}」失败：${tap.text}` };
}

// ============================================================
// B6. LLM 规划（/api/chat 纯文本流 → 严格 JSON 计划）
// ============================================================

export interface AgentCtx {
  ownerName?: string;
  persona?: string;
  memory?: string;
  peerName?: string;
}

interface AgentHistoryEntry {
  kind: 'obs' | 'step';
  round: number;
  text: string;
  /** kind='step' 时的动作与结果 */
  step?: AgentStep;
  ok?: boolean;
}

interface AgentPlan {
  say?: string;
  plan?: AgentStep[];
  note?: string;
}

/** 动作语法表（与 execAgentStep 的 switch 一一对应） */
const AGENT_ACTIONS_DOC = `可用动作（plan 数组元素，args 一律 string，哪怕是数字/坐标）：
1. {"action":"openApp","args":"com.tencent.mm"} —— 打开 App（填包名；不确定包名先 lookScreen 看桌面图标或失败反馈里找线索）
2. {"action":"clickElement","args":"搜索"} —— 看屏幕找含该文字/描述的可点元素并点它（首选动作，别瞎猜坐标）
3. {"action":"inputTextToFocus","args":"你好呀"} —— 向已聚焦的输入框输入文字（中英文均可；必须先 clickElement 点输入框使其聚焦）
4. {"action":"pressEnter","args":""} —— 按回车键（发送消息/确认搜索）
5. {"action":"pressDelete","args":""} —— 按删除键（清输入框旧内容时逐字删）
6. {"action":"tapPoint","args":"540,1200"} —— 直接按坐标点（clickElement 找不到时的兜底；坐标只来自观察反馈里的元素信息）
7. {"action":"scroll","args":"下"} —— 语义滑动翻页（上/下/左/右）
8. {"action":"back","args":""} —— 按返回键
9. {"action":"wait","args":"3000"} —— 等待毫秒数（等页面加载/动画落定，200~10000）
10. {"action":"lookScreen","args":""} —— 观察当前屏幕（结果在下一轮反馈里给你，不确定界面就先用它）`;

/** 组装 Agent 规划的 system prompt（人设/记忆注入 + 行为准则 + 语法表 + 输出格式） */
function buildAgentSystemPrompt(ctx: AgentCtx | undefined): string {
  const owner = ctx?.ownerName?.trim() || '机主';
  const lines: string[] = [];
  lines.push(`你是「${owner}」的手机智能体（Mobile Agent），直接操控 ${owner} 的真实手机完成任务——你输出的每个动作都会真实执行，成功与否都会如实反馈给你。`);
  if (ctx?.peerName?.trim()) {
    lines.push(`当前对话对象是「${ctx.peerName.trim()}」：涉及给某人发消息类任务时，对象默认是 ta（界面上按名字找联系人）。`);
  }
  if (ctx?.persona?.trim()) {
    lines.push(`【你的人设（说话与行事都遵循）】\n${ctx.persona.trim().slice(0, 2000)}`);
  }
  if (ctx?.memory?.trim()) {
    lines.push(`【与任务可能相关的记忆】\n${ctx.memory.trim().slice(0, 1200)}`);
  }
  lines.push(
    '【行为准则】',
    '- 一次规划 3~8 步，每步动作最小化（一步只做一件事），并把完成整个任务所需的全部步骤放进同一次 plan。',
    '- 操作输入框前必须先 clickElement 点输入框使其聚焦，才能 inputTextToFocus；发送消息用 pressEnter。',
    '- 输入框里有旧内容时：优先找界面上的清空/清除类按钮点掉；没有就连续 pressDelete 逐字删（按旧内容长度控制次数，别无限删）。',
    '- 上一步失败时，失败反馈里通常带着当前界面与可见元素线索——换策略（换匹配文字、先 scroll 翻页、改 tapPoint、先 lookScreen），不要原样重试。',
    '- 不要编造屏幕上没有的元素文字；目标可能不在当前页，先 scroll 翻页再找；不确定当前界面就先 lookScreen。',
    '- 涉及转账/付款/红包/充值/卸载/删除/关闭网络等敏感动作：该步必须加 "dangerous":true（系统会先征求机主同意）。',
    '- 规划要贴合机主的意图与你的性格（见人设），say 播报用你的语气自然说，不要复述命令格式。',
    '【动作语法表】',
    AGENT_ACTIONS_DOC,
    '【输出格式】严格输出一个 JSON 对象，前后不带任何其他文字、不用 markdown 代码块包裹：',
    '{"say":"给用户看的进度播报（用你的语气，一句话）","plan":[{"action":"openApp","args":"com.tencent.mm","why":"打开微信"},{"action":"clickElement","args":"搜索","why":"进搜索页"}]}',
    '- 每步可带 "why"（一句话给机主看的理由）；plan 为空数组时必须给 "note"（一句话解释为什么做不了/不用做）。',
    '- args 一律 string；不要输出动作表以外的动作名。',
  );
  return lines.join('\n');
}

/** LLM 可能输出的动作别名 → 规范名（防御性归一，未知动作仍走失败反馈教 LLM） */
const ACTION_ALIASES: Record<string, string> = {
  open: 'openApp',
  launch: 'openApp',
  打开: 'openApp',
  click: 'clickElement',
  点: 'clickElement',
  点文字: 'clickElement',
  input: 'inputTextToFocus',
  type: 'inputTextToFocus',
  输入: 'inputTextToFocus',
  enter: 'pressEnter',
  回车: 'pressEnter',
  delete: 'pressDelete',
  del: 'pressDelete',
  删除键: 'pressDelete',
  tap: 'tapPoint',
  点按: 'tapPoint',
  swipe: 'scroll',
  滑动: 'scroll',
  press_back: 'back',
  返回: 'back',
  sleep: 'wait',
  等待: 'wait',
  look: 'lookScreen',
  observe: 'lookScreen',
  screenshot: 'lookScreen',
  看屏幕: 'lookScreen',
};

function normalizePlan(obj: Record<string, unknown>): AgentPlan | null {
  const plan: AgentStep[] = [];
  if (Array.isArray(obj.plan)) {
    for (const it of obj.plan) {
      if (!it || typeof it !== 'object') continue;
      const rec = it as Record<string, unknown>;
      const raw = typeof rec.action === 'string' ? rec.action.trim() : '';
      if (!raw) continue;
      const action = ACTION_ALIASES[raw.toLowerCase()] ?? raw;
      const args = typeof rec.args === 'string' ? rec.args : rec.args == null ? '' : String(rec.args);
      plan.push({
        action,
        args,
        dangerous: rec.dangerous === true,
        why: typeof rec.why === 'string' && rec.why.trim() ? rec.why.trim() : undefined,
      });
      if (plan.length >= 12) break; // 上限保护（教学是 3~8 步）
    }
  }
  const say = typeof obj.say === 'string' ? obj.say.trim() : '';
  const note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (plan.length === 0 && !say && !note) return null;
  return { say, plan, note };
}

const PLAN_TIMEOUT_MS = 90_000;
/** history 序列化条数上限（控制 token；obs 单条也截断） */
const HISTORY_MAX_ENTRIES = 24;
const HISTORY_OBS_SLICE = 2500;
const HISTORY_STEP_SLICE = 400;

/**
 * 调 /api/chat 生成一轮计划：纯文本流聚合 → 宽松 JSON 提取 → AgentPlan。
 * fetch 失败/超时（90s）/格式异常/用户急停 → null（调用方处理）。
 */
async function planWithLLM(task: string, history: AgentHistoryEntry[], ctx: AgentCtx | undefined): Promise<AgentPlan | null> {
  const apiCfg = useSettings.getState().apiConfig;
  // 照抄 chat-stream-store 的 effConfig 构造：长 JSON 计划抬高 maxTokens 下限防截断
  const effConfig = { ...apiCfg, maxTokens: Math.max(apiCfg.maxTokens, 1500) };

  const sys = buildAgentSystemPrompt(ctx);
  const msgs: { role: string; content: string }[] = [{ role: 'system', content: sys }];
  for (const h of history.slice(-HISTORY_MAX_ENTRIES)) {
    if (h.kind === 'obs') {
      msgs.push({ role: 'user', content: `[第${h.round}轮] 观察：\n${h.text.slice(0, HISTORY_OBS_SLICE)}` });
    } else {
      msgs.push({
        role: 'assistant',
        content: `[第${h.round}轮] 执行 ${h.step?.action ?? '?'}(${h.step?.args ?? ''}) → ${h.ok ? '成功' : '失败'}：${h.text.slice(0, HISTORY_STEP_SLICE)}`,
      });
    }
  }
  const lastObs = [...history].reverse().find((h) => h.kind === 'obs');
  msgs.push({
    role: 'user',
    content: `任务：${task}\n当前屏幕观察：\n${lastObs ? lastObs.text : '（未取到观察，请先安排 lookScreen）'}`,
  });

  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), PLAN_TIMEOUT_MS);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: msgs, config: effConfig }),
      signal: ctl.signal,
    });
    if (!res.ok || !res.body) return null;
    // 纯文本流（非 SSE）：reader 增量拼接
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      full += dec.decode(value, { stream: true });
      // 每个分片都查停止旗标：用户急停立刻断流，不等整轮规划
      if (isStopRequested()) {
        try {
          await reader.cancel();
        } catch {
          /* 忽略 */
        }
        return null;
      }
    }
    const obj = extractJsonObject(full);
    if (!obj) return null;
    return normalizePlan(obj);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

// ============================================================
// B7. 主循环（观察 → 规划 → 逐步执行 → replan）
// ============================================================

export type AgentEvent = { type: 'say' | 'step' | 'stepfail' | 'danger' | 'stopped' | 'done' | 'fail'; text: string };

export interface AgentResult {
  ok: boolean;
  text: string;
}

/** 敏感动作关键词（任务文本或步骤参数命中即弹确认卡，与 LLM 标 dangerous 双保险） */
const DANGER_PATTERNS =
  /转账|付款|支付|红包|扣款|充值|退款|卸载|删除|清空|格式化|恢复出厂|解绑|注销|关闭.*(流量|wifi|蓝牙)|发短信|发消息给.*陌生人/;

// 步间落定间隔（与 autonomy 队列同思路：界面操作后有转场/渲染，openApp 后有冷启动）
const OPEN_SETTLE_MS = 3500;
const UI_SETTLE_MS = 2000;
const OP_GAP_MS = 800;
const UI_TOUCH_ACTIONS = new Set(['clickElement', 'tapPoint', 'inputTextToFocus', 'pressEnter', 'pressDelete', 'scroll', 'back']);

/** 步间等待（可被急停打断；被打断返回 false） */
async function settleAfterStep(step: AgentStep): Promise<boolean> {
  const ms = step.action === 'openApp' ? OPEN_SETTLE_MS : UI_TOUCH_ACTIONS.has(step.action) ? UI_SETTLE_MS : OP_GAP_MS;
  return sleepStoppable(ms);
}

/**
 * 运行一个 Agent 任务（多轮闭环）：
 * 三道闸 → 防重入 → 初始化（通知/旗标）→ 轮循环（观察 → 规划 → 逐步执行）
 * → 全步成功即完成；有失败带现场进下一轮 replan；敏感步骤弹确认卡；
 * 本地/原生急停双通道随时可停；finally 统一还原输入法/撤通知/落定状态。
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
  if (!isNativePerception()) {
    return { ok: false, text: '当前不在手机 APP 里，浏览器无法执行 Agent 任务' };
  }
  const acfg = getAutonomyConfig();
  if (!acfg.master) {
    return { ok: false, text: '「AI 动手」总开关未打开（设置 › AI 动手），Agent 任务被拒绝' };
  }
  if (acfg.caps['agent'] !== true) {
    return { ok: false, text: 'Agent 任务需要以下能力开关：智能体总开关（设置 › AI 动手 打开「Mobile Agent」）' };
  }
  const baseCaps: [string, string][] = [
    ['open', '打开应用'],
    ['tap', '点按屏幕'],
    ['type', '输入文字'],
    ['key', '按按键'],
  ];
  const missing = baseCaps.filter(([k]) => acfg.caps[k] !== true).map(([, label]) => label);
  if (baseCaps.length - missing.length < 3) {
    return {
      ok: false,
      text: `Agent 任务需要以下能力开关（打开应用/点按屏幕/输入文字/按按键 至少开三项）：当前缺少 ${missing.join('、')}（设置 › AI 动手）`,
    };
  }

  // ---- 防重入 ----
  if (agentState.running) {
    return { ok: false, text: '已有 Agent 任务在运行' };
  }
  const t = task.trim();
  if (!t) return { ok: false, text: '任务内容为空' };

  const maxRounds = Math.max(1, Math.min(6, opts?.maxRounds ?? 3));

  // ---- 初始化 ----
  stopFlag = false;
  stopSource = '';
  originalIme = null;
  void nativeAgentResetStop();
  void nativeAgentNotify('AI 智能体运行中', t.slice(0, 50));
  patchAgentState({
    running: true,
    task: t,
    round: 0,
    maxRounds,
    stepIndex: 0,
    stepTotal: 0,
    stepDesc: '',
    narration: '',
    finished: false,
    ok: undefined,
    summary: undefined,
    stopRequested: false,
  });

  const history: AgentHistoryEntry[] = [];
  let lastSay = '';
  let result: AgentResult = { ok: false, text: '' };
  let settled = false;
  /** 统一出口：记录 result（finally 落定状态用）并返回 */
  const finish = (r: AgentResult): AgentResult => {
    result = r;
    settled = true;
    return r;
  };
  const stoppedResult = (): AgentResult => {
    emit('stopped', '已被用户停止');
    return finish({ ok: false, text: '已被用户停止' });
  };

  try {
    for (let round = 1; round <= maxRounds; round++) {
      if (await checkStopped()) return stoppedResult();

      // a. 观察屏幕（前台 + UI 树摘要）
      patchAgentState({ round, stepIndex: 0, stepTotal: 0, stepDesc: '观察屏幕…' });
      const obs = await agentObserve();
      history.push({ kind: 'obs', round, text: obs.summary });
      if (await checkStopped()) return stoppedResult();

      // b. LLM 规划（null = 接口失败/格式异常/急停断流）
      const plan = await planWithLLM(t, history, opts?.ctx);
      if (await checkStopped()) return stoppedResult();
      if (plan === null) {
        return finish({ ok: false, text: '规划失败：AI 接口未响应或返回格式异常（检查 设置›API 配置）' });
      }

      // c. 播报
      if (plan.say) {
        lastSay = plan.say;
        patchAgentState({ narration: plan.say });
        emit('say', plan.say);
      }

      // d. 空计划 → LLM 判断做不了/不用做，note 解释
      if (!plan.plan || plan.plan.length === 0) {
        emit('fail', plan.note || 'AI 没有给出可执行的计划');
        return finish({ ok: false, text: plan.note || 'AI 没有给出可执行的计划（可能判断任务无法完成）' });
      }

      // e. 逐步执行
      patchAgentState({ stepIndex: 0, stepTotal: plan.plan.length });
      let allOk = true;
      for (let i = 0; i < plan.plan.length; i++) {
        const step = plan.plan[i];
        const desc = `${step.action}${step.args ? ` ${step.args}` : ''}`;
        patchAgentState({ stepIndex: i + 1, stepDesc: desc.slice(0, 40) });
        emit('step', `${desc}${step.why ? `（${step.why}）` : ''}`);

        if (await checkStopped()) return stoppedResult();

        // 敏感操作确认（LLM 标记或关键词命中 → 弹卡；拒绝终止整个任务）
        if (step.dangerous === true || DANGER_PATTERNS.test(`${t}\n${step.action}\n${step.args}`)) {
          const ok = await requestDangerConfirm(
            '智能体请求执行敏感操作',
            `步骤：${step.action} → ${step.args}\n${step.why ?? ''}`,
          );
          if (!ok) {
            emit('danger', '用户拒绝了敏感操作');
            return finish({ ok: false, text: '用户拒绝了敏感操作，任务已停止' });
          }
        }

        const r = await execAgentStep(step);
        history.push({ kind: 'step', round, text: r.text.slice(0, HISTORY_STEP_SLICE), step, ok: r.ok });
        if (!r.ok) {
          // 失败：带现场进下一轮 replan（观察会带回失败后的界面状态）
          allOk = false;
          emit('stepfail', r.text);
          break;
        }
        // 步间落定间隔（可被急停打断）
        if (!(await settleAfterStep(step))) return stoppedResult();
      }
      if (!allOk) continue; // 下一轮重规划

      // 本轮计划全部成功 → 任务完成
      emit('done', `Agent 任务完成：${lastSay || t}`);
      return finish({ ok: true, text: `Agent 任务完成：${lastSay || t}` });
    }

    // 轮数耗尽仍未成功
    if (!settled) {
      emit('fail', `已达最大轮数（${maxRounds}），任务未完成`);
      return finish({ ok: false, text: `已达最大轮数（${maxRounds}），任务未完成。最后进展：${lastSay || '（无播报）'}` });
    }
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit('fail', `Agent 执行异常：${msg}`);
    return finish({ ok: false, text: `Agent 执行异常：${msg}` });
  } finally {
    // 收尾：还原输入法 → 复位旗标 → 撤常驻通知 → 状态落定（finished 后 UI 条 4s 淡出）
    if (originalIme) {
      void nativeRestoreIme(originalIme);
      originalIme = null;
    }
    stopFlag = false;
    stopSource = '';
    void nativeAgentResetStop();
    void nativeAgentNotifyEnd();
    patchAgentState({
      running: false,
      finished: true,
      ok: result.ok,
      summary: result.text || 'Agent 任务已结束',
      stepDesc: '',
      stopRequested: false,
    });
  }
}
