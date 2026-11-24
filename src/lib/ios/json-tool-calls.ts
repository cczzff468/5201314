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
 *
 * v2.3.2 裸格式二「工具名{参数}」（机主实测「AI 定闹钟显示 setRealAlarm{"hour":17,
 * "minute":52}，切回界面/锁应用全是这样」）：部分模型不写 {"name":…,"arguments":…}
 * 包裹形状，而是**函数名直接拼参数 JSON**——setRealAlarm{"hour":17} /
 * lockApp{"packageName":"xx"}。本版四大函数全部支持该形状：
 *  - extractJsonToolCalls：span 前紧贴工具名（允许隔一个 '('）→ 该 span 就是
 *    参数对象，前缀工具名即调用名；另支持扁平形状 {"name":"setRealAlarm","hour":17}
 *    （arguments 缺省时其余键整体作为参数）；
 *  - stripJsonToolCalls：剥除时连前缀工具名（与可选 '('）一起切；
 *  - looksLikePartialToolJson / stripTrailingPartialToolJson：半截
 *    setRealAlarm{"hour":17, 也扣住/切掉，绝不放半截乱码上屏。
 */

/** 工具名全集（与 phone-tools TOOL_CAPS 全量同步；v2.3.0 共 52 个） */
const TOOL_NAME_RE_SRC =
  'sendWebMessage|postForum|likePost|playMusic|getWebState|saveMemo|setAlarm|queryWeather|openScreen|freezeApp|getWebInstalledApps|getUsageStats|getRecentApps|pullBackToChat|searchWebApp|sendNotification|searchContacts|openChat|getCalendarEvents|addCalendarEvent|getTodoList|addTodo|searchRealApp|freezeRealApp|unfreezeRealApp|lockApp|setVolume|openRealApp|tapScreen|swipeScreen|inputText|pressKey|lookScreen|takeScreenshot|sendScreenshot|switchToChat|getForegroundApp|getBatteryStatus|getVolume|getRecentSMS|getRecentNotifications|setBrightness|getBrightness|setRingerMode|setRealAlarm|startCountdown|createCalendarEvent|makePhoneCall|sendSMS|searchRealContact|toggleFlashlight|getRealLocation|getStepCount|getCurrentActivity|getSleepData|listFiles|readFileContent|saveTextToFile|downloadFile|getNowPlaying|controlRealMusic|getRealCalendarEvents';

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

/** span 前紧贴的调用前缀：工具名（允许隔一个 '('，如 setRealAlarm( 后跟 {...}）。
 *  返回 null = 前面没有紧贴的工具名（普通正文/其它标识符/隔了空格都算无）。
 *  v2.3.2：裸格式二提取/剥除共用——start = 工具名（含 '('）的起点下标；
 *  paren = 前缀带 '('（剥除时后随的配对 ')' 一并吞掉，无残留）。 */
function toolNamePrefixOf(text: string, spanStart: number): { fn: string; start: number; paren: boolean } | null {
  const lo = Math.max(0, spanStart - 44);
  let seg = text.slice(lo, spanStart);
  let cut = 0;
  let paren = false;
  // 可选一层 '(' 包裹：setRealAlarm({...})——剥除时连 '(' 一起切，')' 由外层 strip 的残留清理收尾
  if (seg.endsWith('(')) {
    cut = 1;
    paren = true;
    seg = seg.slice(0, -1);
  }
  const m = seg.match(/[A-Za-z_][A-Za-z0-9_]*$/);
  if (!m || !TOOL_NAME_SET.has(m[0])) return null;
  return { fn: m[0], start: spanStart - cut - m[0].length, paren };
}

/** 已解析 JSON 对象 → 工具调用形状校验与归一（null = 不是工具调用） */
function parseToolCallShape(obj: unknown): { name: string; args: Record<string, unknown> } | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  let name = '';
  let argsRaw: unknown = {};
  let flat = false;
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
    // v2.3.2 扁平形状：{"name":"setRealAlarm","hour":17,"minute":52}——没有
    // arguments 包裹时其余键整体作为参数（模型忘了嵌套层的常见病，hour/minute 不能丢）
    flat = o.arguments === undefined;
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
  // v2.3.2 扁平形状归一：除 name（与 function）外的全部键作为参数
  if (flat) {
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === 'name' || k === 'function') continue;
      rest[k] = v;
    }
    if (Object.keys(rest).length > 0) args = rest;
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
 * 文本里全部「工具调用 span」定位（提取与剥除共用同一口径，防两处判定不一致）：
 *  - 形状一 {"name":…,"arguments":…} / {"function":{…}}：span 即调用；
 *  - 形状二（v2.3.2）工具名紧贴参数：setRealAlarm{"hour":17} / lockApp({…})——
 *    start 含前缀工具名与可选 '('，剥除时整体切除。
 * 返回按文本顺序排列的 span 列表（start 升序）。
 */
interface CallSpanInfo {
  start: number;
  end: number;
  call: { name: string; args: Record<string, unknown> };
}

function findCallSpans(text: string): CallSpanInfo[] {
  const infos: CallSpanInfo[] = [];
  for (const [s, e] of scanBraceSpans(text)) {
    const frag = text.slice(s, e + 1);
    const shaped = parseToolCallText(frag);
    if (shaped) {
      infos.push({ start: s, end: e, call: shaped });
      continue;
    }
    // v2.3.2 形状二：span 前紧贴工具名（允许隔一个 '('）→ span 就是参数对象
    const p = toolNamePrefixOf(text, s);
    if (!p) continue;
    try {
      const obj = JSON.parse(frag) as unknown;
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
      // 参数对象自身是调用形状（{"name":"setRealAlarm",...} 且前面又有工具名）时以包裹形状优先，
      // 避免双重解释；前缀工具名仅在该对象不含 name 键时作为调用名
      const o = obj as Record<string, unknown>;
      if (typeof o.name === 'string' && o.name && TOOL_NAME_SET.has(o.name)) continue;
      // 前缀带 '(' 时后随的配对 ')' 一并吞进 span（马上setRealAlarm({...})就好 → 马上就好）
      let end = e;
      if (p.paren) {
        const m = text.slice(e + 1).match(/^\s*\)/);
        if (m) end = e + m[0].length;
      }
      infos.push({ start: p.start, end, call: { name: p.fn, args: o } });
    } catch {
      /* 参数片段不是合法 JSON → 不是形状二 */
    }
  }
  return infos;
}

/**
 * 从文本中提取裸 JSON 工具调用：{"name": "工具名", "arguments": {…}} /
 * {"function": {"name":…}} / 代码块包裹 / 内联拼在正文里 / 工具名紧贴参数对象
 * （v2.3.2：setRealAlarm{"hour":17,"minute":52}）。提取后按真实工具调用
 * 执行——绝不把裸 JSON 当聊天消息发给机主。重复调用按 name+args 去重。
 */
export function extractJsonToolCalls(text: string): Array<{ name: string; args: Record<string, unknown> }> {
  const out: Array<{ name: string; args: Record<string, unknown> }> = [];
  if (!text || !text.includes('{')) return out;
  const seen = new Set<string>();
  for (const { call } of findCallSpans(text)) {
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
  // 代码块包裹的 ```json ... ``` 整块删除（块内非工具调用的原样保留）：
  // v2.3.2 块首允许「工具名{」开头（形状二）——原正则只认 "name": 或 { 开头
  out = out.replace(
    new RegExp('```(?:json)?\\s*[\\r\\n]+\\s*(?:"name"\\s*:|\\{|(?:' + TOOL_NAME_RE_SRC + ')\\s*\\(?\\s*\\{)[\\s\\S]*?```', 'g'),
    (m) => (extractJsonToolCalls(m).length > 0 ? '' : m),
  );
  // span 式内联剥除：全部完整闭合的工具调用片段从后往前切除（下标不漂移）。
  // 覆盖：整行 JSON / 正文+JSON 同行内联 / JSON+正文同行 / 多处散布 /
  // v2.3.2 工具名紧贴参数（setRealAlarm{…} 连工具名一起切）。
  const infos = findCallSpans(out);
  for (let k = infos.length - 1; k >= 0; k--) {
    const { start, end } = infos[k];
    out = out.slice(0, start) + out.slice(end + 1);
  }
  const trimmed = out
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    // v2.3.2 形状二剥除后的孤悬 ')'：setRealAlarm({...}) 切掉「setRealAlarm({…}」后
    // 残下的右括号（仅在行尾/紧随空白时清——防误吞正文里的成对括号另一半）
    .replace(/(^|\s)\)(\s|$)/g, '$1$2')
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
  const stack: number[] = [];
  let inStr = false;
  let esc = false;
  let sawKey = false;
  let sawFnPrefix = false;
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
    } else if (ch === '{') {
      // v2.3.2：顶层 '{' 前紧贴工具名（setRealAlarm{"hour":17, 半截）——形状二残缺
      if (stack.length === 0 && toolNamePrefixOf(text, j)) sawFnPrefix = true;
      stack.push(j);
    } else if (ch === '}') stack.pop();
  }
  if (stack.length === 0) return false; // 括号配平：不是残缺 JSON，交给正常提取/展示
  return /^\s*\{/.test(text) || sawKey || sawFnPrefix;
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
  // 从最外层未闭合 '{' 到文尾须像工具调用 JSON 才切（普通文本里少个 '}' 不动）：
  // 含 "name"/"function" 键，或 v2.3.2 形状二——'{' 前紧贴工具名（连工具名一起切）
  const fnPre = toolNamePrefixOf(text, outermost);
  if (!/"(?:name|function)"\s*:/.test(tail) && !fnPre) return text;
  const cutAt = fnPre ? fnPre.start : outermost;
  return text.slice(0, cutAt).replace(/[ \t]+$/, '').trimEnd();
}
