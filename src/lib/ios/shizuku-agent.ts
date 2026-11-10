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
 *
 * v1.6 三项增强：
 *  - 动作原语补全：longPress（同坐标原地 swipe 800ms = 长按）/ doubleClick（两次快速 tap）/
 *    drag（swipe x1y1→x2y2 定时拖拽），能力开关分别挂 tap/tap/swipe；
 *  - 截屏视觉自动验证（A2）：改变屏幕状态的步骤执行成功后，再截屏交 VLM 复核「画面是否
 *    体现该步预期」，不通过按失败走重规划；接口失败/超时/未配置/「看屏幕」能力关闭 →
 *    自动降级信任 UI 树结果（绝不因验证拖垮任务），连续 3 次验证调用失败本任务停用视觉层；
 *  - 坐标缓存学习（A6）：clickElement/longPress 文本定位成功点击后，把归一化坐标写入
 *    localStorage LRU 缓存（≤120 条）；同 App 重复任务先查缓存直接点击（跳过 dumpUI→查找），
 *    命中复核失败自动弃条目并回落 UI 树路径。对 LLM 透明（不改计划 schema）。
 *
 * v1.7 提速（A7，目标：执行循环提速 30~50%，语义/护栏不变）：
 *  - dumpUI 任务内短缓存（B4a）：同一任务内、前台 App 未变、距上次 dump < 4s 复用上一份
 *    UI 树（省 0.5~2s 桥往返）；任何变更类动作（tap/longPress/doubleClick/drag/input/
 *    enter/key/swipe/openApp…）执行后立即失效（含失败尝试），任务起止清缓存；
 *  - 自适应 settle（B7）：固定步间等待改为「300ms 防抖 + 轮询稳定检测（openApp 轮询前台
 *    包名、tap/key 类两次 dump 采样比对）+ 尾段并行预取下一步观察所需 dump」；上限沿用
 *    原值、失败/急停语义不变。视觉验证的 screencap→visionAsk 数据依赖链保持串行
 *    （判定正确性优先，见 settleAfterStep / visualVerifyStep 注释）。
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
  labScreencap,
  labScreenSize,
  labSwipe,
  labTap,
} from './shizuku-lab';
import { AUTONOMY_CAPS, getAutonomyConfig, isCapEnabled, visionAsk } from './shizuku-autonomy';
import { extractJsonObject } from './call-upstream';
import { useSettings } from '@/lib/ios/store';
import { notifyIfHidden } from './local-notify';
import {
  SCREEN_APPS_DOC,
  clickScreenDom,
  observeScreenDom,
  openScreenApp,
  scrollScreenDom,
  typeScreenDom,
} from './agent-screen';

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
  maxRounds: 8,
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

/**
 * 一次完整观察：前台 App + uiautomator UI 树 → LLM 可读摘要（并行取，失败不互相拖垮）。
 * A7：dump 走任务内短缓存（B4a）——4s 内且前台未变时复用上一份树，省一次最贵的
 * uiautomator dump 往返；fg 查询与 dump 仍并行，且 fg Promise 同时作为缓存命中判定
 * 与回填标记的来源（一次查询两用，不额外多花桥往返）。
 */
export async function agentObserve(): Promise<AgentObservation> {
  const fgLineP = labForegroundApp().catch(() => null);
  const fgPkgP = fgLineP.then((r) => (r && r.ok ? fgPackageOf((r.text.split('\n')[0] ?? '').trim()) : ''));
  const [fgRes, dump] = await Promise.all([fgLineP, dumpUICached(fgPkgP)]);
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
// B4a. dumpUI 任务内短缓存（A7 提速一）
// ============================================================

/**
 * uiautomator dump 是观察链路里最贵的一次原生桥往返（典型 0.5~2s，忙屏更久）。
 * 任务内短缓存复用条件（三者同时满足）：同一任务内 + 前台 App 未变 + 距上次 dump < 4s。
 * 护栏：
 *  - 4s TTL 硬上限：通知横幅/时钟/视频帧等「前台不变但内容自变」的画面不会被当成新观察；
 *  - fg 标记：前台包名对不上立即失效（App 切换/弹窗抢占场景绝不复用旧树；前台查询失败
 *    按未命中处理，安全第一）；
 *  - 变更即失效：所有会改变屏幕的动作（tap/longPress/doubleClick/drag/input/enter/key/
 *    swipe/openApp…）执行后（含失败尝试——命令失败也可能已落屏）立刻 invalidateDumpCache；
 *  - 任务级隔离：任务开始/结束都清缓存，不跨任务、不跨 [手机操作] 单步标记复用；
 *  - 单飞（single-flight）：并发请求共享同一次 dump——既省重复开销，也避免两个
 *    uiautomator dump 并发写同一个 window_dump.xml 互踩；跨代（已失效）的旧 dump
 *    只等它落地不取其数据，保证调用方拿到与当前失效状态一致的新鲜树。
 */
const DUMP_CACHE_TTL_MS = 4000;

/** nativeDumpUi 的返回形状（缓存原样存取，agentObserve 下游逻辑零改动） */
type DumpUiResult = Awaited<ReturnType<typeof nativeDumpUi>>;

let dumpCacheEntry: { fg: string; at: number; res: DumpUiResult } | null = null;
let dumpCacheGen = 0;
let dumpInflight: { gen: number; promise: Promise<DumpUiResult> } | null = null;

/** 变更类动作集合（执行后必须失效 dump 缓存；wait/lookScreen 只读不在列） */
const MUTATING_AGENT_ACTIONS = new Set([
  'openApp',
  'clickElement',
  'tapPoint',
  'inputTextToFocus',
  'pressEnter',
  'pressDelete',
  'back',
  'scroll',
  'longPress',
  'doubleClick',
  'drag',
]);

/**
 * 应用内动作集合（v1.7.0）：DOM 级操作「项目内 APP 界面」，不经过 Shizuku/uiautomator——
 * 系统级 dump 缓存不受它们影响（WebView 在系统树里是同一个节点），settle 单独走短等待。
 */
const IN_APP_AGENT_ACTIONS = new Set(['openScreen', 'uiObserve', 'uiClick', 'uiType', 'uiScroll']);

/** 任何屏幕变更后调用：缓存立即作废（进行中的旧 dump 落地时也会被 generation 拦下不入缓存） */
function invalidateDumpCache(): void {
  dumpCacheGen += 1;
  dumpCacheEntry = null;
}

/** 把一份 dump 结果写入缓存（自适应 settle 确认稳定后喂缓存用；空 fg/失败结果拒收） */
function dumpCacheStore(fg: string, res: DumpUiResult): void {
  if (!fg || !res || !res.ok || !res.xml) return;
  dumpCacheEntry = { fg, at: Date.now(), res };
}

/** 安全取 fg 包名（查询失败按空串处理：无法验证「前台未变」→ 一律当未命中，安全第一） */
async function fgOfPromise(fgP: Promise<string> | null): Promise<string> {
  try {
    return fgP ? await fgP : '';
  } catch {
    return '';
  }
}

/**
 * 带任务内短缓存的 dumpUI。
 * @param fgP 当前前台包名 Promise（调用方多半本来就要查前台——命中判定/回填标记共用这
 *            一次查询，不额外多花桥往返；传 null 表示调用方不关心前台，只直取）
 * @param write 结果是否回填缓存（自适应 settle 的稳定性轮询传 false：中间态树不入缓存）
 */
async function dumpUICached(fgP: Promise<string> | null, write = true): Promise<DumpUiResult> {
  const gen = dumpCacheGen;
  // 1) 命中判定：TTL 内 + 前台包名一致（gen 复查：等待 fg 期间若发生变更立即放弃复用）
  const entry = dumpCacheEntry;
  if (entry && Date.now() - entry.at < DUMP_CACHE_TTL_MS) {
    const fg = await fgOfPromise(fgP);
    if (gen === dumpCacheGen && fg && fg === entry.fg) return entry.res;
  }
  // 2) 单飞：同代请求共享同一次 dump；跨代旧 dump 只等它落地（串行化，避免两个
  //    uiautomator dump 并发互踩），不取其数据——那是变更前的旧树
  if (dumpInflight) {
    if (dumpInflight.gen === gen) return dumpInflight.promise;
    try {
      await dumpInflight.promise;
    } catch {
      /* 旧 dump 失败不影响新请求 */
    }
    if (dumpInflight && dumpInflight.gen === dumpCacheGen) return dumpInflight.promise;
  }
  const myGen = dumpCacheGen;
  const promise = nativeDumpUi();
  dumpInflight = { gen: myGen, promise };
  try {
    const res = await promise;
    if (write && myGen === dumpCacheGen && res && res.ok && res.xml) {
      const fg = await fgOfPromise(fgP);
      if (myGen === dumpCacheGen && fg) dumpCacheEntry = { fg, at: Date.now(), res };
    }
    return res;
  } finally {
    if (dumpInflight && dumpInflight.promise === promise) dumpInflight = null;
  }
}

/**
 * 带超时护栏的 dump（自适应 settle 稳定性轮询专用，write=false：中间态树不入缓存）。
 * uiautomator 在忙屏（动画/加载）上会一直等 idle，桥超时 30s 太慢——超过 budget 视为
 * 「屏幕不稳定」；底层 dump 继续在后台飞（单飞共享），不浪费已发出的往返。
 */
async function dumpUICachedWithTimeout(fgP: Promise<string> | null, budgetMs: number): Promise<DumpUiResult> {
  let timer = 0;
  const guard = new Promise<null>((resolve) => {
    timer = window.setTimeout(() => resolve(null), Math.max(50, budgetMs));
  });
  try {
    return await Promise.race([dumpUICached(fgP, false), guard]);
  } finally {
    window.clearTimeout(timer);
  }
}

/** 双积聚字符串哈希（dump 内容稳定性比对用；64 位散列，碰撞概率对本用途足够低） */
function hashDumpXml(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1003f;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 + c, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16)}-${(h2 >>> 0).toString(16)}`;
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
  longPress: 'tap',
  doubleClick: 'tap',
  drag: 'swipe',
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

/** 屏幕分辨率任务级 memo（A6 坐标缓存换算用；runAgentTask 开始时清空，任务内不重复查） */
let screenSizeMemo: { w: number; h: number } | null = null;

/** memo 版分辨率（仅坐标缓存换算用，省一次原生桥往返；scroll 等语义滑动仍走 agentScreenSize 现查） */
async function agentScreenSizeMemo(): Promise<{ w: number; h: number }> {
  if (screenSizeMemo) return screenSizeMemo;
  screenSizeMemo = await agentScreenSize();
  return screenSizeMemo;
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

// ============================================================
// B5a. 坐标缓存学习（A6）：同 App 内重复任务的点击直接命中，跳过 dumpUI→查找
// ============================================================

/**
 * localStorage 坐标缓存（key: agent-coord-cache-v1）：
 *  - 条目 { app, target, nx, ny, hits, lastUsed }：app=前台包名，target=归一化目标文本
 *    （小写 trim + 压空白），nx/ny=0~1 归一化坐标（相对屏幕 w/h，分辨率无关），
 *    hits=命中次数，lastUsed=最近使用时间戳（LRU 依据）。
 *  - 上限 120 条，超出按 lastUsed 最旧驱逐；读写全 try-catch（隐私模式/异常静默，不致命）。
 *  - 对 LLM 透明：不改计划 schema，纯执行层加速；命中复核失败自动弃条目回落 UI 树路径。
 */
const COORD_CACHE_KEY = 'agent-coord-cache-v1';
const COORD_CACHE_MAX = 120;
/** 缓存命中复核：UI 树里目标元素中心与缓存点击点的归一化距离超过该比例 → 布局已变（缓存过期） */
const COORD_CACHE_STALE_RATIO = 0.08;

interface CoordCacheEntry {
  app: string;
  target: string;
  nx: number;
  ny: number;
  hits: number;
  lastUsed: number;
}

/** 目标文本归一化（缓存 key 的一半；与 findClickableByText 的小写匹配口径一致） */
function normalizeTargetText(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 从「前台应用：com.x.y」/ mCurrentFocus=Window{…} 原始行里抠包名（拿不到返回 ''，读写都跳过缓存） */
function fgPackageOf(fgLine: string): string {
  const m = /(\w+(?:\.\w+)+)/.exec(fgLine ?? '');
  return m ? m[1] : '';
}

/** 当前前台包名（缓存 key 用；dumpsys window 查询，比 dumpUi 便宜得多） */
async function currentFgPackage(): Promise<string> {
  try {
    const r = await labForegroundApp();
    if (r?.ok) return fgPackageOf((r.text.split('\n')[0] ?? '').trim());
  } catch {
    /* 拿不到前台就跳过缓存 */
  }
  return '';
}

function loadCoordCache(): CoordCacheEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(COORD_CACHE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((e): e is CoordCacheEntry => {
      const it = e as Partial<CoordCacheEntry> | null;
      return (
        !!it &&
        typeof it.app === 'string' &&
        typeof it.target === 'string' &&
        Number.isFinite(it.nx) &&
        Number.isFinite(it.ny)
      );
    });
  } catch {
    return [];
  }
}

function saveCoordCache(list: CoordCacheEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    // LRU：按 lastUsed 新→旧排序，超上限驱逐最旧
    const sorted = [...list].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, COORD_CACHE_MAX);
    window.localStorage.setItem(COORD_CACHE_KEY, JSON.stringify(sorted));
  } catch {
    /* 写失败静默（隐私模式等） */
  }
}

/** 查缓存（不改动条目；hits/lastUsed 在验证通过后由 bumpCoordCacheHit 刷新） */
function lookupCoordCache(app: string, target: string): CoordCacheEntry | null {
  if (!app) return null;
  const t = normalizeTargetText(target);
  if (!t) return null;
  try {
    const hit = loadCoordCache().find((e) => e.app === app && e.target === t);
    return hit ?? null;
  } catch {
    return null;
  }
}

/** 命中验证通过：hits+1 + 刷新 lastUsed（LRU 保活） */
function bumpCoordCacheHit(app: string, target: string): void {
  try {
    const t = normalizeTargetText(target);
    const list = loadCoordCache();
    const e = list.find((x) => x.app === app && x.target === t);
    if (!e) return;
    e.hits += 1;
    e.lastUsed = Date.now();
    saveCoordCache(list);
  } catch {
    /* 缓存维护失败不影响主流程 */
  }
}

/** 丢弃过期条目（复核失败 = 布局已变，旧坐标不可信；回落前先清掉防反复踩坑） */
function dropCoordCache(app: string, target: string): void {
  try {
    const t = normalizeTargetText(target);
    const list = loadCoordCache();
    const next = list.filter((x) => !(x.app === app && x.target === t));
    if (next.length !== list.length) saveCoordCache(next);
  } catch {
    /* 忽略 */
  }
}

/** 写入/更新条目（dumpUI 路径成功点击后调用；坐标按当前屏幕尺寸归一化，换机/旋转不失效） */
function recordCoordCache(app: string, target: string, cx: number, cy: number, sw: number, sh: number): void {
  try {
    const t = normalizeTargetText(target);
    if (!app || !t || sw <= 0 || sh <= 0) return;
    const list = loadCoordCache();
    const e = list.find((x) => x.app === app && x.target === t);
    if (e) {
      e.nx = cx / sw;
      e.ny = cy / sh;
      e.lastUsed = Date.now();
    } else {
      list.push({ app, target: t, nx: cx / sw, ny: cy / sh, hits: 0, lastUsed: Date.now() });
    }
    saveCoordCache(list);
  } catch {
    /* 忽略 */
  }
}

/**
 * A6 缓存命中快速路径（clickElement / longPress 文本定位版共用）：
 * 查缓存 → 命中则换算真实坐标直接执行点击（longPressMode 时为原地 swipe 800ms）
 * → UI 树轻量复核：
 *   - 点击命令失败 / 目标元素仍在但位置远离点击点（布局已变=缓存过期）→ 弃缓存条目，
 *     返回 null 由调用方在同一调用内回落正常 dumpUI 路径（绝不返回失败）；
 *   - 目标元素已消失（点击已导航走）/ 仍原地（驻留类按钮，点击大概率生效）/ UI 树读不了
 *     （游戏/视频全屏）→ 信任点击：hits+1 快速返回，text 注明「坐标缓存命中」。
 * 返回 null = 未命中或已弃缓存（走正常路径）；否则为 ok:true 的 StepResult。
 */
async function tryClickViaCoordCache(target: string, longPressMode: boolean): Promise<StepResult | null> {
  const t = target.trim();
  if (!t) return null;
  let app = '';
  let entry: CoordCacheEntry | null = null;
  try {
    app = await currentFgPackage();
    entry = app ? lookupCoordCache(app, t) : null;
  } catch {
    return null;
  }
  if (!entry) return null;
  const size = await agentScreenSizeMemo();
  const x = Math.round(entry.nx * size.w);
  const y = Math.round(entry.ny * size.h);
  const r = longPressMode ? await labSwipe(x, y, x, y, 800) : await labTap(x, y);
  // A7：点击已发生（无论命令成败都可能改变屏幕）→ 立即失效 dump 短缓存。
  // 必须在下方 UI 树复核前失效：否则复核会命中点击前的旧树（元素必然「原地」），
  // A6 的「布局已变 = 缓存过期」判定就永远触发不了了
  invalidateDumpCache();
  if (!r.ok) {
    dropCoordCache(app, t);
    return null; // 点击命令失败：弃缓存回落正常路径
  }
  // 轻量 UI 树复核（尽力而为：读不了树就信任点击，主循环的 A2 视觉层兜底）
  let stale = false;
  try {
    const obs = await agentObserve();
    if (obs.ok) {
      const hit = findClickableByText(obs.nodes, t);
      if (hit) {
        // 元素还在：离点击点太远 = 布局已变（缓存过期）；原地 = 驻留按钮（信任）
        const dx = (hit.cx - x) / size.w;
        const dy = (hit.cy - y) / size.h;
        if (Math.hypot(dx, dy) > COORD_CACHE_STALE_RATIO) stale = true;
      }
      // 没找到 = 已导航离开 = 成功
    }
  } catch {
    /* 复核失败不否决点击 */
  }
  if (stale) {
    dropCoordCache(app, t);
    return null; // 缓存过期：弃条目回落正常 dumpUI 路径
  }
  bumpCoordCacheHit(app, t);
  const label = longPressMode ? '长按' : '点击';
  return { ok: true, text: `已${label}「${t}」（坐标缓存命中 ${x},${y}）` };
}

/** clickElement：坐标缓存快路径（A6）→ 看屏幕（UI 树）→ 文字匹配 → 点中心坐标；失败带观察现场给 replan */
async function stepClickElement(target: string): Promise<StepResult> {
  const t = target.trim();
  if (!t) return { ok: false, text: 'clickElement 缺目标文字' };
  // A6 缓存命中：直接点（null = 未命中/已弃缓存，回落下方正常路径）
  const fast = await tryClickViaCoordCache(t, false);
  if (fast) return fast;
  const obs = await agentObserve();
  const hit = obs.ok ? findClickableByText(obs.nodes, t) : null;
  if (!hit) {
    return {
      ok: false,
      text: `屏幕上没有找到含「${t}」的可点元素（当前在 ${obs.fg}，可见元素：${obs.summary.slice(0, 300)}）`,
    };
  }
  const tap = await labTap(hit.cx, hit.cy);
  if (!tap.ok) return { ok: false, text: `点击「${t}」失败：${tap.text}` };
  // A6 写缓存：app 取自本次观察的前台行（不多一次 dump）；分辨率走任务级 memo
  try {
    const app = fgPackageOf(obs.fg);
    if (app) {
      const s = await agentScreenSizeMemo();
      recordCoordCache(app, t, hit.cx, hit.cy, s.w, s.h);
    }
  } catch {
    /* 缓存写入失败不影响主流程 */
  }
  return { ok: true, text: `已点击「${t}」(${hit.cx},${hit.cy})` };
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

/**
 * longPress（v1.6）：长按 = input swipe 同坐标原地滑动 800ms（ADB 标准长按技巧，
 * 不需要新二进制/新桥）。args 支持文字目标（走 UI 树 findClickableByText，与 clickElement
 * 同路径，含坐标缓存）或 "x,y" 坐标。用于长按消息弹菜单、长按图标呼出副选项等。
 */
async function stepLongPress(args: string): Promise<StepResult> {
  const a = args.trim();
  if (!a) return { ok: false, text: 'longPress 缺参数（文字目标或 "x,y"）' };
  const m = /^\s*(\d{1,5})\s*[,，]\s*(\d{1,5})\s*$/.exec(a);
  if (m) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    const r = await labSwipe(x, y, x, y, 800);
    return r.ok ? { ok: true, text: `已长按 (${x},${y}) 800ms` } : { ok: false, text: `长按失败：${r.text}` };
  }
  // 文字目标：先查坐标缓存（A6），未命中走 UI 树定位（与 clickElement 同路径）
  const fast = await tryClickViaCoordCache(a, true);
  if (fast) return fast;
  const obs = await agentObserve();
  const hit = obs.ok ? findClickableByText(obs.nodes, a) : null;
  if (!hit) {
    return {
      ok: false,
      text: `屏幕上没有找到含「${a}」的可长按元素（当前在 ${obs.fg}，可见元素：${obs.summary.slice(0, 300)}）`,
    };
  }
  const r = await labSwipe(hit.cx, hit.cy, hit.cx, hit.cy, 800);
  if (!r.ok) return { ok: false, text: `长按「${a}」失败：${r.text}` };
  // A6 写缓存（与 clickElement 同款：app 取自本次观察的前台行）
  try {
    const app = fgPackageOf(obs.fg);
    if (app) {
      const s = await agentScreenSizeMemo();
      recordCoordCache(app, a, hit.cx, hit.cy, s.w, s.h);
    }
  } catch {
    /* 缓存写入失败不影响主流程 */
  }
  return { ok: true, text: `已长按「${a}」(${hit.cx},${hit.cy}) 800ms` };
}

/**
 * doubleClick（v1.6）：两次快速 input tap（间隔约 100ms；Shizuku 两次调用开销可接受）。
 * args 同 clickElement（文字目标走 UI 树定位，或 "x,y" 坐标）。用于双击点赞、双击快进等。
 */
async function stepDoubleClick(args: string): Promise<StepResult> {
  const a = args.trim();
  if (!a) return { ok: false, text: 'doubleClick 缺参数（文字目标或 "x,y"）' };
  let x: number;
  let y: number;
  let fromText = false;
  const m = /^\s*(\d{1,5})\s*[,，]\s*(\d{1,5})\s*$/.exec(a);
  if (m) {
    x = Number(m[1]);
    y = Number(m[2]);
  } else {
    const obs = await agentObserve();
    const hit = obs.ok ? findClickableByText(obs.nodes, a) : null;
    if (!hit) {
      return {
        ok: false,
        text: `屏幕上没有找到含「${a}」的可点元素（当前在 ${obs.fg}，可见元素：${obs.summary.slice(0, 300)}）`,
      };
    }
    x = hit.cx;
    y = hit.cy;
    fromText = true;
  }
  const first = await labTap(x, y);
  if (!first.ok) return { ok: false, text: `双击第一击失败：${first.text}` };
  await new Promise((res) => window.setTimeout(res, 100)); // 两击间隔（系统双击窗口内）
  const second = await labTap(x, y);
  if (!second.ok) return { ok: false, text: `双击第二击失败：${second.text}` };
  return { ok: true, text: `已双击${fromText ? `「${a}」` : ''} (${x},${y})` };
}

/**
 * drag（v1.6）：拖拽 = input swipe x1 y1 x2 y2 duration（默认 700ms，拖拽要比滑动慢才跟手）。
 * args 格式 "x1,y1,x2,y2[,durationMs]"。用于拖进度条/音量滑块/侧边栏/卡片排序等。
 */
async function stepDrag(args: string): Promise<StepResult> {
  const m = /^\s*(\d{1,5})\s*[,，]\s*(\d{1,5})\s*[,，]\s*(\d{1,5})\s*[,，]\s*(\d{1,5})(?:\s*[,，]\s*(\d{2,5})\s*)?$/.exec(args);
  if (!m) {
    return { ok: false, text: `drag 参数不合法（需要 "x1,y1,x2,y2[,durationMs]"，收到「${args}」）` };
  }
  const x1 = Number(m[1]);
  const y1 = Number(m[2]);
  const x2 = Number(m[3]);
  const y2 = Number(m[4]);
  const dur = m[5] ? Math.max(100, Math.min(10000, Number(m[5]))) : 700;
  const r = await labSwipe(x1, y1, x2, y2, dur);
  return r.ok
    ? { ok: true, text: `已拖拽 (${x1},${y1})→(${x2},${y2})，${dur}ms` }
    : { ok: false, text: `拖拽失败：${r.text}` };
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
  let r: StepResult;
  try {
    switch (action) {
      case 'openApp': {
        if (!isCapEnabled('open')) {
          r = capDenied('open');
          break;
        }
        r = await stepOpenApp(args.trim());
        break;
      }
      case 'clickElement': {
        if (!isCapEnabled('tap')) {
          r = capDenied('tap');
          break;
        }
        r = await stepClickElement(args);
        break;
      }
      case 'tapPoint': {
        if (!isCapEnabled('tap')) {
          r = capDenied('tap');
          break;
        }
        r = await stepTapPoint(args);
        break;
      }
      case 'inputTextToFocus': {
        if (!isCapEnabled('type')) {
          r = capDenied('type');
          break;
        }
        r = await stepInputText(args);
        break;
      }
      case 'pressEnter': {
        if (!isCapEnabled('key')) {
          r = capDenied('key');
          break;
        }
        const kr = await labKey(KEY_CODES.enter);
        r = kr.ok ? { ok: true, text: '已按回车（Enter）' } : { ok: false, text: `回车失败：${kr.text}` };
        break;
      }
      case 'pressDelete': {
        if (!isCapEnabled('key')) {
          r = capDenied('key');
          break;
        }
        const dr = await labKey(KEY_CODES.del);
        r = dr.ok ? { ok: true, text: '已按删除键' } : { ok: false, text: `删除键失败：${dr.text}` };
        break;
      }
      case 'back': {
        if (!isCapEnabled('key')) {
          r = capDenied('key');
          break;
        }
        const br = await labKey(KEY_CODES.back);
        r = br.ok ? { ok: true, text: '已按返回键' } : { ok: false, text: `返回失败：${br.text}` };
        break;
      }
      case 'scroll': {
        if (!isCapEnabled('swipe')) {
          r = capDenied('swipe');
          break;
        }
        r = await stepScroll(args);
        break;
      }
      case 'longPress': {
        if (!isCapEnabled('tap')) {
          r = capDenied('tap');
          break;
        }
        r = await stepLongPress(args);
        break;
      }
      case 'doubleClick': {
        if (!isCapEnabled('tap')) {
          r = capDenied('tap');
          break;
        }
        r = await stepDoubleClick(args);
        break;
      }
      case 'drag': {
        if (!isCapEnabled('swipe')) {
          r = capDenied('swipe');
          break;
        }
        r = await stepDrag(args);
        break;
      }
      case 'wait':
        r = await stepWait(args);
        break;
      case 'lookScreen': {
        // 纯观察步：结果（摘要）进 history 给 LLM 下轮决策
        const obs = await agentObserve();
        r = { ok: true, text: obs.summary };
        break;
      }
      // ---- v1.7.0 应用内界面动作（DOM 级，不设单项能力闸——任务级 agent 闸已覆盖）----
      case 'openScreen':
        r = await openScreenApp(args);
        break;
      case 'uiObserve': {
        const o = observeScreenDom();
        r = { ok: o.ok, text: o.text };
        break;
      }
      case 'uiClick':
        r = clickScreenDom(args);
        break;
      case 'uiType':
        r = typeScreenDom(args);
        break;
      case 'uiScroll':
        r = scrollScreenDom(args);
        break;
      default:
        r = {
          ok: false,
          text: `未知动作「${action}」（可用：openApp/clickElement/tapPoint/inputTextToFocus/pressEnter/pressDelete/back/scroll/wait/lookScreen/longPress/doubleClick/drag/openScreen/uiObserve/uiClick/uiType/uiScroll）`,
        };
    }
  } catch (e) {
    // A7：异常路径同样失效——动作可能执行到一半（半次输入/半次滑动），屏幕状态未知
    if (MUTATING_AGENT_ACTIONS.has(action)) invalidateDumpCache();
    return { ok: false, text: `动作 ${action} 执行异常：${e instanceof Error ? e.message : String(e)}` };
  }
  // A7 提速一护栏：变更类步骤执行后立即失效 dump 短缓存——即使命令报失败也可能已改变
  // 屏幕（如 tap 已落在对话框按钮上），一律失效，宁滥勿缺；wait/lookScreen 只读不失效
  if (MUTATING_AGENT_ACTIONS.has(action)) invalidateDumpCache();
  return r;
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
  // A7：输入改变屏幕（输入框内容/候选栏/可能触发跳转），立即失效 dump 短缓存（宁滥勿缺）
  invalidateDumpCache();
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
  // A7：点击可能改变屏幕（导航/弹窗），立即失效 dump 短缓存（含失败尝试，宁滥勿缺）
  invalidateDumpCache();
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
  /** 语音会话最近几轮对话（v1.7.2）：「再试一次/继续/还是不行」这类模糊指代脱离会话就没法办，
   *  语音层 execute 时把会话上下文带给规划层，LLM 才知道要重试的是什么任务 */
  recentChat?: string;
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
10. {"action":"lookScreen","args":""} —— 观察当前屏幕（结果在下一轮反馈里给你，不确定界面就先用它）
11. {"action":"longPress","args":"消息"} —— 长按（原地按住 800ms）：长按聊天消息弹菜单、长按图标呼出副选项；args 同 clickElement（文字目标或 "x,y"）
12. {"action":"doubleClick","args":"540,1200"} —— 双击（两次快速点击）：双击点赞、双击快进；args 同 clickElement（文字目标或 "x,y"）
13. {"action":"drag","args":"200,1800,880,1800,700"} —— 拖拽：拖进度条/音量滑块/侧边栏/卡片排序；args "x1,y1,x2,y2[,毫秒]"（默认 700ms，坐标只来自观察反馈里的元素信息）
——以下为「机主手机内应用界面」动作（虚拟手机里渲染的 App：微信/淘宝/联系人/备忘录/美团等）——
14. {"action":"openScreen","args":"contacts"} —— 打开机主手机里的应用界面。args 填应用 id 或中文名：${SCREEN_APPS_DOC}。【凡是「这台手机里的应用」的任务（建联系人/发消息/写备忘录/写提醒/搜商品/下单等）一律优先 openScreen + uiClick/uiType，不要用系统级 openApp】
15. {"action":"uiObserve","args":""} —— 观察当前应用界面：返回可点元素清单与输入框清单（uiClick 的 args 照抄清单文字）；进任何应用后先用它看一眼
16. {"action":"uiClick","args":"新建联系人"} —— 点击当前应用界面里文字匹配的元素（按钮/列表项/标签页/输入框聚焦）
17. {"action":"uiType","args":"要输入的文字"} —— 向已聚焦的输入框输入文字（替换旧内容；先 uiClick 点输入框聚焦）
18. {"action":"uiScroll","args":"下"} —— 在当前应用界面里滚动翻页（上/下/左/右）`;

/** 组装 Agent 规划的 system prompt（人设/记忆注入 + 行为准则 + 语法表 + 输出格式）。
 *  verifying=true 时进入「验收模式」：上一轮计划已全部执行成功，要求 LLM 对照任务目标
 *  核对最新界面——真正达成才输出 TASK_DONE 空计划，没达成就给补救计划（v1.7.2 防虚报完成）。 */
function buildAgentSystemPrompt(ctx: AgentCtx | undefined, verifying = false): string {
  const owner = ctx?.ownerName?.trim() || '机主';
  const lines: string[] = [];
  lines.push(`你是「${owner}」的手机智能体（Mobile Agent），直接操控 ${owner} 的真实手机完成任务——你输出的每个动作都会真实执行，成功与否都会如实反馈给你。`);
  if (ctx?.peerName?.trim()) {
    lines.push(`当前对话对象是「${ctx.peerName.trim()}」：涉及给某人发消息类任务时，对象默认是 ta（界面上按名字找联系人）。`);
  }
  if (ctx?.recentChat?.trim()) {
    lines.push(`【语音会话上下文】任务里的「再试一次/继续/还是不行」等说法指代下面这段刚发生的对话，按上下文理解任务：\n${ctx.recentChat.trim().slice(0, 1200)}`);
  }
  if (ctx?.persona?.trim()) {
    lines.push(`【你的人设（说话与行事都遵循）】\n${ctx.persona.trim().slice(0, 2000)}`);
  }
  if (ctx?.memory?.trim()) {
    lines.push(`【与任务可能相关的记忆】\n${ctx.memory.trim().slice(0, 1200)}`);
  }
  if (verifying) {
    lines.push(
      '【任务验收（本轮只核对，不轻易动手）】上一轮计划的步骤都已执行成功，但「动作成功」不等于「任务完成」。请对照任务目标检查最新屏幕观察：',
      '- 任务目标已真正达成（成品已出现在界面上：如备忘录列表里能看到刚记的那条内容、联系人列表有新联系人、消息已发出）→ 输出空计划并给 note，note 必须以 TASK_DONE 开头，后接一句话结果，say 用你的语气播报结果。',
      '- 目标没达成/只做了一半（内容没输入、没保存、点错了按钮、界面停在中间态等）→ 正常输出补救计划（先 uiObserve 看清界面再纠正），不要输出 TASK_DONE。',
      '- 【补救优先级】如果上一轮已经输入了内容但还没点保存/完成/发送：补救计划的第一步就是点保存（uiClick 保存/完成/发送/对勾），再 uiObserve 核对成品出现，不要重新走一遍已完成的步骤。',
      '- 宁可多补救一轮，也不许在成品没出现时报完成。',
    );
  }
  lines.push(
    '【行为准则】',
    '- 一次规划 3~10 步，每步动作最小化（一步只做一件事），并把完成整个任务所需的全部步骤放进同一次 plan——包括最后的保存/发送与成品核对，不要拆到下一轮。',
    '- 【两类任务分清】任务发生在「机主手机里的应用」（微信/信息/QQ/淘宝/美团/联系人/备忘录/提醒事项/日历/浏览器/天气/音乐/设置等这台手机内渲染的界面）→ 用 openScreen 打开 + uiObserve 观察 + uiClick/uiType/uiScroll 操作；只有操作 Android 系统级真实应用（虚拟手机之外的真实桌面 App）才用 openApp(包名)+clickElement 等。',
    '- 应用内任务的标准流程：openScreen 打开 → uiObserve 看界面 → 按清单 uiClick（按钮/列表项/输入框）→ uiType 输入 → 需要时 pressEnter（聚焦输入框发消息等效）→ 再 uiObserve 核对结果。uiClick/uiType 的反馈会告诉你点到了什么/输了什么。',
    '- 【uiClick 的 args 必须照抄 uiObserve 清单里的完整文字，一字不差】界面同时有「新建文件夹」「新建备忘录」时，写「新建」会点错——必须写全称。含图标按钮以清单文字为准，禁止自创缩写。',
    '- 例（建联系人）：openScreen contacts → uiObserve → uiClick「+」或「新建」→ uiClick 姓名输入框 → uiType 名字 → uiClick 人设/性格输入框 → uiType 性格描述 → uiClick「保存/完成」→ uiObserve 核对。界面和示例不符时以 uiObserve 实际返回为准。',
    '- 例（记备忘录）：openScreen notes → uiObserve → uiClick「新建备忘录」（不是「新建文件夹」）→ uiClick 标题/正文输入框 → uiType「要记的内容」→ uiClick「保存/完成/对勾」→ uiObserve 核对列表出现这条内容。界面和示例不符时以 uiObserve 实际返回为准。',
    '- 【完成标准（写入类任务）】内容必须真正输入且结果出现在界面上才算完成：备忘录要看到列表里那条内容、消息要看到进入会话、提醒要看到条目存在。界面停在输入框/抽屉/弹窗=没完成，继续操作直到成品出现；计划最后一步必须是 uiObserve 核对。',
    '- 【保存铁律（最高优先级）】需要输入内容/填表的任务：uiType 输入完成后，同一次 plan 里必须接着点「保存/完成/发送/对勾」按钮（或 pressEnter），绝不把保存动作留到下一轮——「输入了内容却没保存」等同任务失败。新建/编辑类界面通常保存按钮在右上角或底部工具栏，找不到就先 uiObserve 看全界面元素再点。',
    '- 操作输入框前必须先 clickElement/uiClick 点输入框使其聚焦，才能 inputTextToFocus/uiType；发送消息用 pressEnter。',
    '- 输入框里有旧内容时：uiType 会整体替换旧内容；系统级输入框优先找界面上的清空/清除类按钮，没有就连续 pressDelete 逐字删（按旧内容长度控制次数，别无限删）。',
    '- 上一步失败时，失败反馈里通常带着当前界面与可见元素线索——换策略（换匹配文字、先 scroll/uiScroll 翻页、改 tapPoint、先 lookScreen/uiObserve），不要原样重试。uiClick 反馈里出现「另有相近元素」提示时，说明你可能点到了相近但错误的按钮——立即用完整名称重试正确目标。',
    '- 不要编造屏幕上没有的元素文字；目标可能不在当前页，先 scroll/uiScroll 翻页再找；不确定当前界面就先 lookScreen/uiObserve。',
    '- 涉及转账/付款/红包/充值/卸载/删除/关闭网络等敏感动作：该步必须加 "dangerous":true（系统会先征求机主同意）。',
    '- 规划要贴合机主的意图与你的性格（见人设），say 播报用你的语气自然说，不要复述命令格式。',
    '【动作语法表】',
    AGENT_ACTIONS_DOC,
    '【输出格式】严格输出一个 JSON 对象，前后不带任何其他文字、不用 markdown 代码块包裹：',
    '{"say":"给用户看的进度播报（用你的语气，一句话）","plan":[{"action":"openScreen","args":"wechat","why":"打开微信"},{"action":"uiObserve","args":"","why":"看界面"}]}',
    '- 每步可带 "why"（一句话给机主看的理由）；plan 为空数组时必须给 "note"（验收通过时以 TASK_DONE 开头；做不了/不用做时一句话解释原因）。',
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
  long_press: 'longPress',
  长按: 'longPress',
  doubleclick: 'doubleClick',
  double_click: 'doubleClick',
  双击: 'doubleClick',
  拖拽: 'drag',
  拖动: 'drag',
  // v1.7.0 应用内界面动作别名
  openscreen: 'openScreen',
  open_screen: 'openScreen',
  openapp_screen: 'openScreen',
  打开界面: 'openScreen',
  打开屏幕: 'openScreen',
  进入应用: 'openScreen',
  uiobserve: 'uiObserve',
  observeui: 'uiObserve',
  看界面: 'uiObserve',
  观察界面: 'uiObserve',
  uiclick: 'uiClick',
  clickui: 'uiClick',
  点界面: 'uiClick',
  点击界面: 'uiClick',
  uitype: 'uiType',
  typeui: 'uiType',
  界面输入: 'uiType',
  输入界面: 'uiType',
  uiscroll: 'uiScroll',
  scrollui: 'uiScroll',
  界面滚动: 'uiScroll',
  翻页: 'uiScroll',
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
 * verifying=true：验收模式（system prompt 换成验收指令，见 buildAgentSystemPrompt）。
 */
async function planWithLLM(
  task: string,
  history: AgentHistoryEntry[],
  ctx: AgentCtx | undefined,
  verifying = false,
): Promise<AgentPlan | null> {
  const apiCfg = useSettings.getState().apiConfig;
  // 照抄 chat-stream-store 的 effConfig 构造：长 JSON 计划抬高 maxTokens 下限防截断
  const effConfig = { ...apiCfg, maxTokens: Math.max(apiCfg.maxTokens, 1500) };

  const sys = buildAgentSystemPrompt(ctx, verifying);
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
// B6b. 截屏视觉自动验证（A2）：UI 树读不到的图片/验证码/地图类结果靠 VLM 复核
// ============================================================

/** 总开关常量：一键关闭视觉验证层（改 false 即全跳过，UI 树验证照旧） */
const AGENT_VISUAL_VERIFY = true;

/** 值得视觉复核的「改变屏幕状态」动作（wait/lookScreen 是等待/只读、pressDelete 是输入辅助——不复核）；
 *  v1.7.0：应用内 openScreen/uiClick 也复核（截屏能看到虚拟手机界面内容）；uiType/uiScroll/uiObserve
 *  是输入/滚动/只读——不在列 */
const VISUAL_VERIFY_ACTIONS = new Set([
  'openApp',
  'clickElement',
  'tapPoint',
  'inputTextToFocus',
  'pressEnter',
  'back',
  'longPress',
  'doubleClick',
  'drag',
  'openScreen',
  'uiClick',
]);

const VISION_VERIFY_TIMEOUT_MS = 15_000; // 看门狗：验证超时不拖任务
/** 连续 N 次视觉验证「调用失败」→ 本任务自动停用视觉层（护栏：接口挂了别拖垮任务） */
const VISION_FAIL_STREAK_LIMIT = 3;

/** 视觉层任务级状态（每次 runAgentTask 新建：failStreak 连败计数 / disabled 本任务停用） */
interface VisionVerifyState {
  failStreak: number;
  disabled: boolean;
}

/** 验证提示词：任务全文 + 本步意图 → 严格 JSON {"ok":boolean,"note":"≤30字"} */
function visionVerifyAsk(task: string, step: AgentStep): string {
  const desc = `${step.action}${step.args ? ` ${step.args}` : ''}`;
  return [
    '这是安卓手机刚执行完一个操作步骤后的屏幕截图，请判断该步骤是否达到预期效果。',
    `总任务：「${task.slice(0, 80)}」`,
    `刚执行的步骤：${desc}${step.why?.trim() ? `（目的：${step.why.trim()}）` : ''}`,
    '判断标准：当前画面是否已体现该步骤的预期结果（页面切换/目标元素出现/状态更新等，凭画面证据判断，不要凭空猜测）。',
    '只输出严格 JSON，不要 markdown 包裹、不要任何多余文字：{"ok":true或false,"note":"≤30字依据"}',
    '拿不准/画面看不清/无法确定时 ok 判 true（宁可宽松，避免误杀正常步骤）。',
  ].join('\n');
}

/**
 * 视觉验证一个刚执行成功的步骤（在步间落定等待之后调用，避免截到转场动画中间态）。
 * 返回 null = 未执行验证（总开关关/能力关/本任务停用/非状态变更动作）或「验证不可用」
 *（截屏失败/接口失败/超时/输出不可解析——护栏：信任 UI 树结果继续，绝不中断任务）；
 * 返回 StepResult（ok:false）= VLM 明确判定画面未体现预期 → 该步按失败处理走重规划，
 * text 写「视觉验证未通过：…」（自然进 history，重规划的 LLM 能看到失败原因）。
 * A7 注：截屏 → visionAsk 是数据依赖（ask 要用截图），无法并行；15s 看门狗与
 * 「连败 3 次自动停用」护栏原样保留，UI 树结果权威、视觉结果辅助的判定优先级不变。
 */
async function visualVerifyStep(task: string, step: AgentStep, vst: VisionVerifyState): Promise<StepResult | null> {
  if (!AGENT_VISUAL_VERIFY || vst.disabled) return null;
  if (!VISUAL_VERIFY_ACTIONS.has(step.action)) return null;
  // 能力 gate：复用「看见·看屏幕（screencap）」开关——机主关掉看屏幕 = 不允许 Agent 截屏
  if (!isCapEnabled('screencap')) return null;
  // UI 条步骤文案标注复核中（纯展示；下一步会覆盖）
  const desc = `${step.action}${step.args ? ` ${step.args}` : ''}`.slice(0, 40);
  patchAgentState({ stepDesc: `${desc}（视觉复核…）` });
  try {
    const shot = await labScreencap();
    if (!shot.ok || !shot.image) {
      vst.failStreak += 1;
    } else {
      try {
        const out = await visionAsk(shot.image, visionVerifyAsk(task, step), VISION_VERIFY_TIMEOUT_MS);
        const obj = extractJsonObject(out);
        const verdict = obj && typeof obj.ok === 'boolean' ? obj.ok : null;
        if (verdict !== null) {
          vst.failStreak = 0; // 调用成功（无论判定结果）都清零连败
          if (verdict) return null; // 画面证实预期 → 静默通过
          const note = obj && typeof obj.note === 'string' ? obj.note.trim().slice(0, 40) : '';
          return {
            ok: false,
            text: `视觉验证未通过：${note || '画面未见预期效果'}（上一步命令执行成功但截图复核存疑——换策略/换定位方式重试）`,
          };
        }
        vst.failStreak += 1; // 输出不含合法 JSON = 验证不可用
      } catch {
        vst.failStreak += 1; // /api/phone-vision 失败/超时（15s 看门狗 abort）
      }
    }
  } catch {
    vst.failStreak += 1; // 截屏桥异常
  }
  // 护栏：连续失败达上限 → 本任务停用视觉层（后续步骤只信 UI 树，速度回到纯 UI 模式）
  if (vst.failStreak >= VISION_FAIL_STREAK_LIMIT) vst.disabled = true;
  return null; // 验证不可用 ≠ 步骤失败：信任 UI 树结果继续
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
const UI_TOUCH_ACTIONS = new Set([
  'clickElement',
  'tapPoint',
  'inputTextToFocus',
  'pressEnter',
  'pressDelete',
  'scroll',
  'back',
  'longPress',
  'doubleClick',
  'drag',
]);

// ---- A7 自适应 settle 参数 ----
/** 最小防抖下限：转场动画起点（~300ms 内画面必是中间态，检测无意义），先睡过 */
const SETTLE_MIN_MS = 300;
/** 稳定性轮询间隔（150~250ms；dump 本身耗时，实际间隔 ≥ 此值） */
const SETTLE_POLL_INTERVAL_MS = 200;
/** 单次轮询 dump 的超时预算（uiautomator 忙屏等 idle 可能拖满 30s 桥超时，必须自带护栏） */
const SETTLE_POLL_DUMP_BUDGET_MS = 1200;
/** 轮询 dump 允许超出 deadline 的余量（让快完成的 dump 落地，总时长最多超上限 ~200ms） */
const SETTLE_POLL_OVERSHOOT_MS = 200;
/** 轮询窗口下限：剩余时间不足以容纳一轮检测（fg 查询 + dump）就不开轮询，直接睡满 */
const SETTLE_POLL_MIN_WINDOW_MS = 1100;
/** openApp 前台命中后的渲染 grace（App 冷启动首帧后仍需短渲染时间） */
const SETTLE_OPEN_GRACE_MS = 500;
/**
 * 参与轮询稳定检测的动作：只挑「会触发界面跳转」的类型（成本权衡）——每轮检测要
 * 1~2 次 uiautomator dump（0.5~2s/次），对轻量动作反而更慢：
 *  - openApp：只轮询前台包名（dumpsys，比 dump 便宜一个量级），零 dump 检测；
 *  - tap/key 类（clickElement/tapPoint/pressEnter/back/longPress/doubleClick）：
 *    两次 dump 采样比对，UI_SETTLE_MS=2000 窗口内成本可控；
 *  - inputTextToFocus/pressDelete（纯输入几乎不跳转）、scroll/drag（惯性滚动期 dump
 *    又慢又不稳）：沿用原固定等待，不多花桥往返。
 */
const SETTLE_POLL_ACTIONS = new Set(['openApp', 'clickElement', 'tapPoint', 'pressEnter', 'back', 'longPress', 'doubleClick']);

/**
 * 步间等待（A7 自适应版，返回值语义与原版一致：false=被急停打断，true=正常放行）。
 *
 * 三段式：
 *  ① 最小防抖 300ms：转场动画起点，任何检测此刻都拿不到有效画面，先睡过；
 *  ② 轮询稳定检测（仅「会触发界面跳转」的动作，成本权衡见 SETTLE_POLL_ACTIONS）：
 *    - openApp：轮询前台包名（dumpsys）直到切到目标包 → fire-and-forget 预取 UI 树喂
 *      短缓存 + 500ms 渲染 grace 即放行（冷启动通常 1~2.5s，较固定 3.5s 省 ~1~2s）；
 *    - tap/key 类：两次 dump 采样内容 hash 一致 + 前台未变 → 判稳定提前放行，并把这份
 *      稳定树喂短缓存（下一步观察 0 等待）；窗口放不下两次采样/采样超时/到上限 → 回落固定等待；
 *  ③ 尾段：非轮询的变更类动作（输入类）在剩余等待里 fire-and-forget 预取下一步观察所需
 *     UI 树（与睡眠重叠，不加总时长，下一步 agentObserve 直接命中缓存）。
 *
 * 护栏（失败/超时/急停行为与原固定等待完全一致）：
 *  - 最大等待上限沿用原值（轮询 dump 预算按 deadline 收口，最多超 ~200ms）；
 *  - 轮询采样的中间态树一律不写入缓存（write=false），只有确认稳定的树才喂缓存；
 *  - 到上限仍未确认稳定 → 不预取（屏幕仍在变化，预取 = 过期画面），睡满剩余；
 *  - 每个 await 点都查急停，急停返回 false。
 */
async function settleAfterStep(step: AgentStep): Promise<boolean> {
  // v1.7.0 应用内动作：DOM 级操作不走系统 UI settle 轮询（uiautomator 看不到 WebView 内部）——
  // openScreen 自带「等 App 展开 + 渲染 grace」、uiObserve 只读零等待；uiClick/uiScroll 等
  // 界面转场（React 重渲染 + 页面推栈动画 ~300ms）给短固定等待，uiType 纯输入更短
  if (IN_APP_AGENT_ACTIONS.has(step.action)) {
    const fixed = step.action === 'uiType' ? 500 : step.action === 'uiObserve' || step.action === 'openScreen' ? 0 : 900;
    return fixed <= 0 ? true : sleepStoppable(fixed);
  }
  const max = step.action === 'openApp' ? OPEN_SETTLE_MS : UI_TOUCH_ACTIONS.has(step.action) ? UI_SETTLE_MS : OP_GAP_MS;
  const deadline = Date.now() + max;
  // ① 最小防抖
  if (!(await sleepStoppable(Math.min(SETTLE_MIN_MS, max)))) return false;

  // ② 轮询稳定检测（进入此分支的动作都是变更类：缓存已在 execAgentStep 末尾失效，采样必是新树）
  if (SETTLE_POLL_ACTIONS.has(step.action)) {
    if (step.action === 'openApp' && /^[\w.]+$/.test(step.args.trim())) {
      const targetPkg = step.args.trim();
      while (Date.now() < deadline) {
        if (isStopRequested()) return false;
        const fgPkg = await currentFgPackage();
        if (isStopRequested()) return false;
        if (fgPkg && fgPkg === targetPkg) {
          // 前台已切到目标包 = 启动成功：预取 UI 树（喂缓存，不阻塞放行）+ 渲染 grace；
          // 预取的 dump 与 grace 并行，即使 dump 稍慢也会被单飞共享，下一步观察不重复发
          void dumpUICached(Promise.resolve(fgPkg)).catch(() => undefined);
          return sleepStoppable(SETTLE_OPEN_GRACE_MS);
        }
        const gap = Math.min(SETTLE_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()));
        if (gap <= 0) break;
        if (!(await sleepStoppable(gap))) return false;
      }
    } else if (step.action !== 'openApp' && deadline - Date.now() >= SETTLE_POLL_MIN_WINDOW_MS) {
      // tap/key 类：固定两次采样比对（成本可控：最多 2 次 dump，预算按 deadline 收口）；
      // uiautomator dump 自带「等 idle」语义，第一次采样本身就会等过转场动画
      const fg1P = currentFgPackage();
      const d1 = await dumpUICachedWithTimeout(fg1P, Math.min(SETTLE_POLL_DUMP_BUDGET_MS, deadline - Date.now() + SETTLE_POLL_OVERSHOOT_MS));
      if (isStopRequested()) return false;
      const gap = Math.min(SETTLE_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()));
      if (!(await sleepStoppable(gap))) return false;
      const fg2P = currentFgPackage();
      const fg2 = await fg2P;
      if (isStopRequested()) return false;
      const d2 = await dumpUICachedWithTimeout(fg2P, Math.min(SETTLE_POLL_DUMP_BUDGET_MS, deadline - Date.now() + SETTLE_POLL_OVERSHOOT_MS));
      if (isStopRequested()) return false;
      const fg1 = await fg1P;
      const h1 = d1 && d1.ok && d1.xml ? hashDumpXml(d1.xml) : '';
      const h2 = d2 && d2.ok && d2.xml ? hashDumpXml(d2.xml) : '';
      if (h1 !== '' && h1 === h2 && fg1 !== '' && fg1 === fg2) {
        dumpCacheStore(fg2, d2); // 稳定树喂缓存：下一步 agentObserve 0 等待
        return true;
      }
    }
    // 到上限仍未确认稳定：屏幕可能仍在变化 → 不预取中间态，睡满剩余（与原行为一致）
    if (isStopRequested()) return false;
    const remainPoll = deadline - Date.now();
    return remainPoll <= 0 ? true : sleepStoppable(remainPoll);
  }

  // ③ 非轮询动作：变更类（输入类）尾段并行预取（与剩余睡眠重叠，不加总时长）；
  //    wait/lookScreen 只读，缓存本就有效，不预取
  if (MUTATING_AGENT_ACTIONS.has(step.action)) {
    void dumpUICached(currentFgPackage()).catch(() => undefined);
  }
  const remain = deadline - Date.now();
  return remain <= 0 ? true : sleepStoppable(remain);
}

// ============================================================
// C4. 任务终态播报钩子（语音层注册，Siri 式闭环）
// ============================================================

/**
 * 任务终态播报钩子：由语音层（agent-voice-ball 挂载时经 dynamic import 注册，
 * 卸载时传 null 解绑）。runAgentTask 收尾（finally，C2 收尾通知之后）以「结果摘要」
 * 调用——done/fail/stopped/异常四类终态统一触发；开关/TTS 闸门（未配置、通话中等
 * 静默跳过）由语音层自行判定，本层只负责在终态时通知。摘要与通知文案同源：
 * result.text 首行、截 120 字。
 */
let agentResultAnnouncer: ((text: string) => void) | null = null;

/** 注册/解绑（传 null）任务终态播报回调 */
export function setAgentResultAnnouncer(fn: ((text: string) => void) | null): void {
  agentResultAnnouncer = typeof fn === 'function' ? fn : null;
}

/**
 * 运行一个 Agent 任务（多轮闭环）：
 * 三道闸 → 防重入 → 初始化（通知/旗标）→ 轮循环（观察 → 规划 → 逐步执行）
 * → 全步成功后进「验收轮」（v1.7.2：LLM 对照任务目标核对最新界面，真正达成才
 * TASK_DONE 宣布完成；只做一半拿补救计划继续干）——防「动作成功就算完成」的虚报；
 * 有失败带现场进下一轮 replan；敏感步骤弹确认卡；
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

  // v1.9.4 用户反馈「任务总差最后一步没做」：默认轮数 4→8、上限 6→12。
  // 此前验收轮 + 补救轮消耗下，4 轮常常刚好在「输入内容/点保存」前耗尽（如记备忘录）。
  // 轮内步骤数不受影响；急停/防重入语义不变。
  const maxRounds = Math.max(1, Math.min(12, opts?.maxRounds ?? 8));

  // ---- 初始化 ----
  stopFlag = false;
  stopSource = '';
  originalIme = null;
  screenSizeMemo = null; // 屏幕分辨率任务级 memo 清空（旋转屏/换机场景下一任务自然刷新）
  invalidateDumpCache(); // A7：任务起点冷缓存——dump 短缓存只在任务内复用，不跨任务/单步残留
  const visionCtl: VisionVerifyState = { failStreak: 0, disabled: false }; // A2 视觉层任务级状态
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
    /** 验收旗标（v1.7.2 防虚报完成）：上一轮计划刚全部执行成功 → 下一轮先进「验收模式」，
     *  LLM 对照任务目标核对最新界面，真正达成才 TASK_DONE 宣布完成；只做一半会拿到补救计划。 */
    let needVerify = false;
    for (let round = 1; round <= maxRounds; round++) {
      if (await checkStopped()) return stoppedResult();

      // a. 观察屏幕（前台 + UI 树摘要）
      patchAgentState({ round, stepIndex: 0, stepTotal: 0, stepDesc: needVerify ? '核对任务结果…' : '观察屏幕…' });
      const obs = await agentObserve();
      history.push({ kind: 'obs', round, text: obs.summary });
      if (await checkStopped()) return stoppedResult();

      // b. LLM 规划（验收轮用验收模式 prompt；null = 接口失败/格式异常/急停断流）
      const plan = await planWithLLM(t, history, opts?.ctx, needVerify);
      if (await checkStopped()) return stoppedResult();
      if (plan === null) {
        if (needVerify) {
          // 验收轮接口挂了：上轮步骤确实都执行成功过——按完成处理但注明未经最终核对
          //（不谎报也不误伤：文字里明确「未经最终核对」，用户可自查界面）
          const text = `Agent 任务完成：${lastSay || t}（结果未经最终核对）`;
          emit('done', text);
          return finish({ ok: true, text });
        }
        return finish({ ok: false, text: '规划失败：AI 接口未响应或返回格式异常（检查 设置›API 配置）' });
      }

      // c. 播报
      if (plan.say) {
        lastSay = plan.say;
        patchAgentState({ narration: plan.say });
        emit('say', plan.say);
      }

      // d. 空计划：验收模式 + note 以 TASK_DONE 开头 → 任务目标已真正达成，宣布完成；
      //    其余空计划 = LLM 判断做不了/不用做，note 解释（如实失败）
      if (!plan.plan || plan.plan.length === 0) {
        const note = (plan.note || '').trim();
        if (needVerify && /^TASK_DONE/i.test(note)) {
          const summary = plan.say || note.replace(/^TASK_DONE[:：,，.]?\s*/i, '').trim() || t;
          emit('done', `Agent 任务完成：${summary}`);
          return finish({ ok: true, text: `Agent 任务完成：${summary}` });
        }
        emit('fail', note || 'AI 没有给出可执行的计划');
        return finish({ ok: false, text: note || 'AI 没有给出可执行的计划（可能判断任务无法完成）' });
      }

      // e. 逐步执行（验收轮拿到的是补救计划：清验收旗标，按普通轮执行）
      needVerify = false;
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
        // 步间落定间隔（可被急停打断）——先落定再视觉复核，避免截到转场动画中间态。
        // A7 说明（为何不把验证与 settle/观察强行并行）：视觉验证的截屏必须等 settle 完成
        //（转场动画期间截图 = 中间态，会误判），screencap→visionAsk 又是数据依赖链（ask
        // 要用截图），强行并行会牺牲判定正确性；提速改由 settle 自适应缩短 + settle 尾段
        // 并行预取下一步观察所需 UI 树承担（见 settleAfterStep）。
        if (!(await settleAfterStep(step))) return stoppedResult();
        // A2 视觉验证层：VLM 复核「画面是否体现该步预期」；判定未通过 → 该步按失败处理
        //（结果文本自然进 history，重规划的 LLM 能看到「视觉验证未通过：…」原因）。
        // 验证不可用（接口失败/超时/能力关/连败停用）时返回 null，信任 UI 树结果继续。
        const vr = await visualVerifyStep(t, step, visionCtl);
        if (vr && !vr.ok) {
          history.push({ kind: 'step', round, text: vr.text.slice(0, HISTORY_STEP_SLICE), step, ok: false });
          allOk = false;
          emit('stepfail', vr.text);
          break;
        }
      }
      if (!allOk) continue; // 下一轮重规划

      // 本轮计划全部成功 → 不立即宣布完成（「动作成功」≠「任务达成」，此前会虚报）：
      // 置验收旗标，下一轮以验收模式对照任务目标核对最新界面，真正达成才 TASK_DONE。
      // 验收轮若拿到补救计划会照常执行（needVerify 已清零），循环直至 maxRounds。
      needVerify = true;
      continue;
    }

    // 轮数耗尽仍未成功
    if (!settled) {
      if (needVerify) {
        // 最后一轮计划全步成功、只是没轮到验收：按完成处理但注明未经最终核对（同验收接口挂掉的降级）
        const text = `Agent 任务完成：${lastSay || t}（结果未经最终核对）`;
        emit('done', text);
        return finish({ ok: true, text });
      }
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
    invalidateDumpCache(); // A7：任务结束即失效，防 4s TTL 内的残留树泄给后续 [手机操作] 单步
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
    // C2 收尾通知：页面在后台（用户已切走）时经本地通知通道告知任务结果（done/fail/stopped
    // 终态统一走这里）；前台时内部静默跳过（界面内有状态条/弹窗）。失败静默，不影响收尾。
    void notifyIfHidden('智能体', (result.text || 'Agent 任务已结束').split('\n')[0].slice(0, 120), { tag: 'agent', url: '/' });
    // C4 播报钩子：任务终态（完成/失败/急停/异常统一走 finally）触发语音播报 + 追问模式；
    // 摘要与上方通知文案同源（首行、120 字）。语音层未注册时自然空操作，异常不外泄。
    try {
      agentResultAnnouncer?.((result.text || 'Agent 任务已结束').split('\n')[0].slice(0, 120));
    } catch {
      /* 播报层异常不影响收尾 */
    }
  }
}

// ---------------- 测试钩子（仅 dev）：E2E / 手工验证灵动岛弹出进度卡 ----------------
// window.__agentTest.show() 注入「运行中」态 → AgentRunnerBar 从灵动岛弹出；
// done() 注入「完成」态（无红点、摘要 4s 后缩回）；idle() 复位。
// 生产构建（NODE_ENV=production）不挂载，无任何暴露面。
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  const w = window as typeof window & {
    __agentTest?: {
      show: (task?: string) => void;
      done: (summary?: string) => void;
      idle: () => void;
    };
  };
  w.__agentTest = {
    show: (task = '演示任务：打开天气并播报今日气温') =>
      patchAgentState({
        running: true,
        finished: false,
        task,
        round: 1,
        maxRounds: 3,
        stepIndex: 2,
        stepTotal: 4,
        stepDesc: '截屏识别当前界面',
        narration: '正在查看屏幕…',
        stopRequested: false,
      }),
    done: (summary = '已为你打开天气并播报今日气温 0~12°C') =>
      patchAgentState({
        running: false,
        finished: true,
        ok: true,
        summary,
        stepDesc: '',
        narration: '',
        stopRequested: false,
      }),
    idle: () =>
      patchAgentState({
        running: false,
        finished: false,
        task: '',
        summary: '',
        narration: '',
        stepDesc: '',
        stopRequested: false,
      }),
  };
}
