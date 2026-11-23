'use client';

/**
 * v2.3.0 F-11 裸 JSON 工具调用提取（机主实测「在别的 App 让 AI 切回聊天，偶尔显示
 * {"name": "getForegroundApp", "arguments": {}} 没反应」）：
 * 部分弱模型会把工具调用直接写成 JSON 文本（混在 content / 流式正文 / 分段里）而
 * 不走 tool_calls 通道。本模块提供纯函数提取与剥除——
 *  - phone-tools.ts 工具轮：零 tool_calls 回复里提取 → 按真实工具调用执行；
 *  - chat-stream-store.ts 流式管线：segSink 投递关口拦截整段 JSON（防上屏）+
 *    finalize 前对 raw 提取代执行 + 正文剥除。
 * 独立小模块（零依赖）：两处 import 不引入循环依赖。
 *
 * v2.3.1 剥除根修（机主实测「让 AI 定闹钟，一直显示 {"name": "setRealAlarm",
 * "arguments": {"hour": 16, "minute": 23}}」）：旧版 stripJsonToolCalls 只删
 * 「整行恰是 JSON」的行——模型把工具调用 JSON **内联**拼在正文后面（同一行，无换行）
 * 或 pretty-print 多行展开时一个字都剥不掉，裸 JSON 照样进聊天气泡。改为
 * span 式剥除：字符串感知的大括号配对扫出全部完整 {...} 片段，是工具调用的
 * 无论出现在行首/行中/行尾/代码块里一律切除；另加尾部残缺 JSON 清理（流被掐断
 * 在半个 JSON 上时的收尾兜底）与「像不像半个工具 JSON」判定（分段扣留用）。
 */

/** 工具名全集（与 phone-tools TOOL_CAPS 全量同步；v2.3.0 共 52 个） */
const TOOL_NAME_RE_SRC =
  'sendWebMessage|postForum|likePost|playMusic|getWebState|saveMemo|setAlarm|queryWeather|openScreen|freezeApp|getWebInstalledApps|getUsageStats|getRecentApps|pullBackToChat|searchWebApp|sendNotification|searchContacts|openChat|getCalendarEvents|addCalendarEvent|getTodoList|addTodo|searchRealApp|freezeRealApp|unfreezeRealApp|lockApp|setVolume|openRealApp|tapScreen|swipeScreen|inputText|pressKey|lookScreen|takeScreenshot|sendScreenshot|switchToChat|getForegroundApp|getBatteryStatus|getVolume|getRecentSMS|getRecentNotifications|setBrightness|getBrightness|setRingerMode|setRealAlarm|startCountdown|createCalendarEvent|makePhoneCall|sendSMS|searchRealContact|toggleFlashlight|getRealLocation';

/** 工具名集合（裸 JSON 提取时 O(1) 校验用） */
export const TOOL_NAME_SET = new Set(TOOL_NAME_RE_SRC.split('|'));

/** 单个 {...} 片段的最大扫描跨度（防极端长文本死循环） */
const MAX_SPAN = 4000;

/**
 * 字符串感知的大括号配对扫描：找出文本里所有【完整闭合】的顶层 {...} 片段。
 * 返回 [start, end] 闭区间下标对（end 是配对的 '}' 下标）。
 * 字符串字面量里的花括号不参与配对（JSON 转义感知）。
 */
function scanBraceSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  if (!text || !text.includes('{')) return spans;
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start < 0) break;
    let depth = 0;
    let end = -1;
    let inStr = false;
    let esc = false;
    for (let j = start; j < text.length && j < start + MAX_SPAN; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) break; // 从 start 起没有闭合片段：后面不可能再有完整片段
    spans.push([start, end]);
    i = end + 1;
  }
  return spans;
}

/** 已解析 JSON 对象 → 工具调用形状校验与归一（null = 不是工具调用） */
function parseToolCallShape(obj: unknown): { name: string; args: Record<string, unknown> } | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  let name = '';
  let argsRaw: unknown = {};
  if (
    typeof o.name === 'string' &&
    o.name &&
    !Array.isArray(o.arguments) &&
    // v2.3.1：arguments 允许字符串（OpenAI 流式增量形状 "arguments": "{\"k\":1}"——
    // 模型常按这个形状把工具调用写成文本；字符串形状走下方 JSON.parse 归一）
    (o.arguments === undefined || typeof o.arguments === 'object' || typeof o.arguments === 'string')
  ) {
    name = o.name;
    argsRaw = o.arguments ?? {};
  } else if (o.function && typeof o.function === 'object' && !Array.isArray(o.function)) {
    const fn = o.function as Record<string, unknown>;
    if (typeof fn.name === 'string' && fn.name) {
      name = fn.name;
      argsRaw = fn.arguments ?? {};
    }
  }
  if (!name || !TOOL_NAME_SET.has(name)) return null;
  let args: Record<string, unknown> = {};
  if (typeof argsRaw === 'string') {
    try {
      const p = JSON.parse(argsRaw) as unknown;
      if (p && typeof p === 'object' && !Array.isArray(p)) args = p as Record<string, unknown>;
    } catch {
      /* arguments 是非法 JSON 字符串 → 空参数 */
    }
  } else if (argsRaw && typeof argsRaw === 'object') {
    args = argsRaw as Record<string, unknown>;
  }
  return { name, args };
}

/** 一段原始文本是否恰是一个工具调用 JSON（span 判定用，与提取同口径） */
function parseToolCallText(raw: string): { name: string; args: Record<string, unknown> } | null {
  try {
    return parseToolCallShape(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * 从文本中提取裸 JSON 工具调用：{"name": "工具名", "arguments": {…}} /
 * {"function": {"name":…}} / 代码块包裹 / 内联拼在正文里。提取后按真实工具调用
 * 执行——绝不把裸 JSON 当聊天消息发给机主。重复调用按 name+args 去重。
 */
export function extractJsonToolCalls(text: string): Array<{ name: string; args: Record<string, unknown> }> {
  const out: Array<{ name: string; args: Record<string, unknown> }> = [];
  if (!text || !text.includes('{')) return out;
  const seen = new Set<string>();
  for (const [s, e] of scanBraceSpans(text)) {
    const call = parseToolCallText(text.slice(s, e + 1));
    if (!call) continue;
    const key = `${call.name}:${JSON.stringify(call.args)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(call);
    }
  }
  return out;
}

/**
 * 文本剥掉裸 JSON 工具调用片段（收尾文本/分段里不再显示裸 JSON）。
 * v2.3.1 span 式根修：工具调用 JSON 无论出现在哪（整行 / 内联拼在正文同一行 /
 * pretty-print 多行 / 代码块包裹）一律按大括号配对整体切除——旧版只删
 * 「整行恰是 JSON」的行，机主实测「定好闹钟哦{"name":"setRealAlarm",…}」
 * 这种内联拼接连一个字都剥不掉，裸 JSON 照样进气泡。
 * 返回 null = 整段全被剥空（调用方可不投递本段）。
 */
export function stripJsonToolCalls(text: string): string | null {
  if (!text) return null;
  if (!text.includes('{')) {
    const t = text.trim();
    return t.length > 0 ? t : null;
  }
  let out = text;
  // 代码块包裹的 ```json {...} ``` 整块删除（块内非工具调用的原样保留）
  out = out.replace(/```(?:json)?\s*[\r\n]+\s*(?:"name"\s*:|\{)[\s\S]*?```/g, (m) =>
    extractJsonToolCalls(m).length > 0 ? '' : m,
  );
  // span 式内联剥除：全部完整闭合的工具调用片段从后往前切除（下标不漂移）。
  // 覆盖：整行 JSON / 正文+JSON 同行内联 / JSON+正文同行 / 多处散布。
  const spans = scanBraceSpans(out).filter(([s, e]) => parseToolCallText(out.slice(s, e + 1)) !== null);
  for (let k = spans.length - 1; k >= 0; k--) {
    const [s, e] = spans[k];
    out = out.slice(0, s) + out.slice(e + 1);
  }
  const trimmed = out
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 「像不像半个工具调用 JSON」：括号没配平（有未闭合的 '{'）且开头是 '{' 或出现了
 * "name"/"function" 键——流式分段扣留判定用（pretty-print 多行 JSON 会被分段器
 * 按换行撕成多条，单条看着是残缺的——扣住等后续增量拼齐再判定，绝不把半截
 * JSON 放上屏）。
 */
export function looksLikePartialToolJson(text: string): boolean {
  if (!text || !text.includes('{')) return false;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let sawKey = false;
  for (let j = 0; j < text.length; j++) {
    const ch = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      if (text.startsWith('"name"', j) || text.startsWith('"function"', j)) sawKey = true;
    } else if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  if (depth <= 0) return false; // 括号配平：不是残缺 JSON，交给正常提取/展示
  return /^\s*\{/.test(text) || sawKey;
}

/**
 * 切掉文尾的残缺工具调用 JSON（流被掐断在半个 JSON 上：`…定好闹钟哦{"name": "setRe`）。
 * 字符串感知找最外层未闭合的 '{'：从它到文尾若像工具调用 JSON（含 "name"/"function" 键
 * 或以 '{' 开头），整段切除，保住前面的正文。返回原样 = 文尾没有残缺工具 JSON。
 */
export function stripTrailingPartialToolJson(text: string): string {
  if (!text || !text.includes('{')) return text;
  // 括号栈扫描：结束时栈底元素 = 最外层未闭合 '{' 的下标
  const stack: number[] = [];
  let inStr = false;
  let esc = false;
  for (let j = 0; j < text.length; j++) {
    const ch = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push(j);
    else if (ch === '}') stack.pop();
  }
  if (stack.length === 0) return text; // 无未闭合括号
  const outermost = stack[0];
  const tail = text.slice(outermost);
  // 从最外层未闭合 '{' 到文尾须像工具调用 JSON 才切（普通文本里少个 '}' 不动）
  if (!/"(?:name|function)"\s*:/.test(tail)) return text;
  return text.slice(0, outermost).replace(/[ \t]+$/, '').trimEnd();
}
