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
 */

/** 工具名全集（与 phone-tools TOOL_CAPS 全量同步；v2.3.0 共 52 个） */
const TOOL_NAME_RE_SRC =
  'sendWebMessage|postForum|likePost|playMusic|getWebState|saveMemo|setAlarm|queryWeather|openScreen|freezeApp|getWebInstalledApps|getUsageStats|getRecentApps|pullBackToChat|searchWebApp|sendNotification|searchContacts|openChat|getCalendarEvents|addCalendarEvent|getTodoList|addTodo|searchRealApp|freezeRealApp|unfreezeRealApp|lockApp|setVolume|openRealApp|tapScreen|swipeScreen|inputText|pressKey|lookScreen|takeScreenshot|sendScreenshot|switchToChat|getForegroundApp|getBatteryStatus|getVolume|getRecentSMS|getRecentNotifications|setBrightness|getBrightness|setRingerMode|setRealAlarm|startCountdown|createCalendarEvent|makePhoneCall|sendSMS|searchRealContact|toggleFlashlight|getRealLocation';

/** 工具名集合（裸 JSON 提取时 O(1) 校验用） */
export const TOOL_NAME_SET = new Set(TOOL_NAME_RE_SRC.split('|'));

/**
 * 从文本中提取裸 JSON 工具调用：{"name": "工具名", "arguments": {…}} /
 * {"function": {"name":…}} / 代码块包裹。提取后按真实工具调用执行——
 * 绝不把裸 JSON 当聊天消息发给机主。重复调用按 name+args 去重。
 */
export function extractJsonToolCalls(text: string): Array<{ name: string; args: Record<string, unknown> }> {
  const out: Array<{ name: string; args: Record<string, unknown> }> = [];
  if (!text || !text.includes('{')) return out;
  // 扫描所有顶层 {...} 片段（字符串感知的大括号配对）
  const seen = new Set<string>();
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start < 0) break;
    let depth = 0;
    let end = -1;
    let inStr = false;
    let esc = false;
    for (let j = start; j < text.length && j < start + 4000; j++) {
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
    if (end < 0) break;
    const raw = text.slice(start, end + 1);
    i = end + 1;
    // 解析 JSON 提取工具名与参数（兼容 {name,arguments} / {function:{name,arguments}} 两种形状）
    try {
      const obj = JSON.parse(raw) as unknown;
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
      const o = obj as Record<string, unknown>;
      let name = '';
      let argsRaw: unknown = {};
      if (
        typeof o.name === 'string' &&
        o.name &&
        !Array.isArray(o.arguments) &&
        (o.arguments === undefined || typeof o.arguments === 'object')
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
      if (!name || !TOOL_NAME_SET.has(name)) continue;
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
      const key = `${name}:${JSON.stringify(args)}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ name, args });
      }
    } catch {
      /* 非 JSON 片段（普通文本里的大括号）跳过 */
    }
  }
  return out;
}

/**
 * 文本剥掉裸 JSON 工具调用片段（收尾文本/分段里不再显示裸 JSON）：
 * - 整行是 JSON 调用的行删除；
 * - 代码块包裹的 ```json {...}``` 整块删除。
 * 返回 null = 整段全被剥空（调用方可不投递本段）。
 */
export function stripJsonToolCalls(text: string): string | null {
  let out = text;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('{') && t.endsWith('}') && extractJsonToolCalls(t).length > 0) {
      out = out.replace(line, '');
    }
  }
  // 代码块包裹的 ```json {...} ``` 整块删除
  out = out.replace(/```(?:json)?\s*[\r\n]+\s*(?:"name"\s*:|\{)[\s\S]*?```/g, (m) =>
    extractJsonToolCalls(m).length > 0 ? '' : m,
  );
  const trimmed = out.replace(/\n{3,}/g, '\n\n').trim();
  return trimmed.length > 0 ? trimmed : null;
}
