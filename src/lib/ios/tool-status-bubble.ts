'use client';

/**
 * 工具调用状态气泡（毛玻璃椭圆胶囊）：
 *
 * 废除所有原生/网页弹窗（pushToolIslandCard），改为在聊天列表内插入
 * 居中的、毛玻璃椭圆胶囊形系统提示条（type:'tool_status'）。
 *
 * 文案动态生成规则（符合人设）：
 * - 执行中：[角色名] 正在调用 [工具]…
 * - 成功：[角色名] [动作] 了 [目标]（如"谢予安打开了网易云音乐"）
 * - 失败：[角色名] 尝试 [动作] 失败了
 *
 * 渲染规范：
 * - 居中显示，不带头像，不带聊天气泡尖角
 * - 背景：半透明白/灰 + backdrop-blur(10px)
 * - 形状：rounded-full（大圆角椭圆），高度 24~30px
 * - 字体：12px，偏灰
 * - 连续调用多个工具时更新同一气泡内容（不刷屏）
 *
 * 模块职责：
 * - pushToolStatusBubble(sessionKey, { title, body, status })：
 *   按 sessionKey 前缀分发到对应端的 saveMsgs，插入一条 kind:'tool_status' 消息
 * - updateLastToolStatus(sessionKey, patch)：更新最近一条 tool_status 消息（防刷屏）
 * - 当前会话的 tool_status 消息不进 AI 上下文（被历史 filter 自动排除）
 */

import { kvGet, kvSet } from './idb-kv';
import { genId } from './db';

/** 工具状态气泡的消息载荷 */
export interface ToolStatusPayload {
  /** 主文案（如"谢予安打开了网易云音乐"） */
  title: string;
  /** 副文案（可选，如"正在播放晴天"） */
  body?: string;
  /** 状态：pending=执行中 / done=成功 / fail=失败 */
  status: 'pending' | 'done' | 'fail';
  /** 工具名（用于合并/去重） */
  tool?: string;
  /** v2.4.5 长按「重新操作」：标记路径的原始命令（[手机操作:…] 的参数段）。
  *  有值的气泡才能重试（重新入队执行；FC 工具路径无 args 快照不提供重试） */
  op?: string;
}

/** 统一的消息形状（跨三端；role 按会话所属 App 决定：sms 端用 'assistant'，wx/qq 端用 'peer'） */
interface ToolStatusMsg {
  id: string;
  role: 'assistant' | 'peer';
  content: string;
  time: number;
  kind: 'tool_status';
  tool: ToolStatusPayload;
  /** 标记为系统提示，不进 AI 上下文/记忆/转发 */
  sys?: boolean;
}

/** sessionKey → kv 存储键 的映射（与三端 loadMsgs/saveMsgs 同款；v2.2.0 导出：sendScreenshot 工具发图进会话复用） */
export function kvKeyForSession(sessionKey: string): string {
  if (sessionKey === 'assistant') return 'ios-chat-assistant-msgs';
  if (sessionKey.startsWith('wx:')) return `wx-chat-msgs:${sessionKey.slice(3)}`;
  if (sessionKey.startsWith('qq:')) return `qq-chat-msgs:${sessionKey.slice(3)}`;
  if (sessionKey.startsWith('sms:')) {
    // sms:sessionKey → sessionKey 去掉 sms: 前缀再走原逻辑
    const inner = sessionKey.slice(4);
    if (inner === 'assistant') return 'ios-chat-assistant-msgs';
    return `ios-chat-msgs:${inner}`;
  }
  return `ios-chat-msgs:${sessionKey}`;
}

/** 推送一条 tool_status 气泡到指定会话（返回消息 id：串行多操作时按 id 精确回写结果） */
export function pushToolStatusBubble(sessionKey: string, payload: ToolStatusPayload): string {
  if (!sessionKey) return '';
  const key = kvKeyForSession(sessionKey);
  const existing = kvGet<unknown[]>(key);
  const list = Array.isArray(existing) ? existing : [];
  // role 按所属 App 决定：微信/QQ 端用 'peer'（对端消息位，与 wx/qq loadMsgs role 过滤一致），
  // 信息端（sms:assistant / sms:c:* / 默认）用 'assistant'
  const role: 'assistant' | 'peer' = sessionKey.startsWith('wx:') || sessionKey.startsWith('qq:') ? 'peer' : 'assistant';
  const id = genId();
  const msg: ToolStatusMsg = {
    id,
    role,
    content: payload.title,
    time: Date.now(),
    kind: 'tool_status',
    tool: payload,
    sys: true,
  };
  kvSet(key, [...list, msg]);
  // 广播消息变更（三端聊天页订阅此事件刷新）
  broadcastMsgsChange(sessionKey);
  return id;
}

/** 更新最近一条 tool_status 气泡（防刷屏：连续调用工具时更新而非新增） */
export function updateLastToolStatus(sessionKey: string, patch: Partial<ToolStatusPayload>): void {
  if (!sessionKey) return;
  const key = kvKeyForSession(sessionKey);
  const existing = kvGet<unknown[]>(key);
  if (!Array.isArray(existing) || existing.length === 0) return;
  // 从末尾找最近一条 tool_status
  const list = [...existing];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i] as Record<string, unknown>;
    if (m && m.kind === 'tool_status' && typeof m.tool === 'object' && m.tool) {
      const tool = { ...(m.tool as ToolStatusPayload), ...patch };
      list[i] = { ...m, tool, content: tool.title ?? (m.content as string) };
      kvSet(key, list);
      broadcastMsgsChange(sessionKey);
      return;
    }
  }
}

/** v2.4.5 按消息 id 精确更新指定 tool_status 气泡（串行多操作各回写各的，不串台） */
export function updateToolStatusById(sessionKey: string, id: string, patch: Partial<ToolStatusPayload>): void {
  if (!sessionKey || !id) return;
  const key = kvKeyForSession(sessionKey);
  const existing = kvGet<unknown[]>(key);
  if (!Array.isArray(existing)) return;
  const idx = existing.findIndex((m) => (m as { id?: string })?.id === id);
  if (idx < 0) return;
  const m = existing[idx] as Record<string, unknown>;
  if (m.kind !== 'tool_status' || typeof m.tool !== 'object' || !m.tool) return;
  const tool = { ...(m.tool as ToolStatusPayload), ...patch };
  const list = [...existing];
  list[idx] = { ...m, tool, content: tool.title ?? (m.content as string) };
  kvSet(key, list);
  broadcastMsgsChange(sessionKey);
}

/** v2.4.5 长按「删除」：从会话消息里移除指定 tool_status 气泡 */
export function removeToolStatusMsg(sessionKey: string, id: string): void {
  if (!sessionKey || !id) return;
  const key = kvKeyForSession(sessionKey);
  const existing = kvGet<unknown[]>(key);
  if (!Array.isArray(existing)) return;
  kvSet(key, existing.filter((m) => (m as { id?: string })?.id !== id));
  broadcastMsgsChange(sessionKey);
}

/** 广播消息变更（三端聊天页订阅 'tool-status-msgs' 事件刷新） */
function broadcastMsgsChange(sessionKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent('tool-status-msgs', { detail: { sessionKey } }),
    );
  } catch {
    // 忽略
  }
}

/** 动态文案生成（v2.2 需求三：与 runPhoneToolRound 气泡同口径——
 *  正在执行「[角色名]正在[动作]...」/ 成功「[角色名]已[动作]」/ 失败「[角色名]尝试[动作]失败了」）。
 *  v2.4.34 底层乱码清理（机主令「清理所有后台工具调用的底层乱码，提示语统一极简」）：
 *  失败副文案不再裸透底层错误串（URL/JSON/协议报文/base64/英文堆栈），先过 sanitizeFailText
 *  净化——只留人话；净化后没剩什么就不带副文案（胶囊只剩主文案，极简）。 */
export function toolStatusLabel(
  toolName: string,
  args: Record<string, unknown>,
  result: { ok: boolean; text: string },
  charName?: string,
): { title: string; body?: string; status: 'pending' | 'done' | 'fail' } {
  const who = charName?.trim() || 'TA';
  const arg = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '');
  const target = arg('appName') || arg('keyword') || arg('contactName') || arg('songName') || arg('city') || arg('packageName') || arg('app') || arg('title') || '';

  // 各工具的"动作"动词映射（不带时态助词，由外层拼「正在/已」）
  const actionMap: Record<string, string> = {
    sendWebMessage: target ? `给${target}发消息` : '发消息',
    postForum: '发帖子',
    likePost: '点赞',
    playMusic: target ? `播放《${target}》` : '放歌',
    getWebState: '看手机状态',
    saveMemo: '记备忘录',
    setAlarm: '定闹钟',
    queryWeather: target ? `查${target}天气` : '查天气',
    openScreen: target ? `打开${target}` : '打开应用',
    freezeApp: /^(全部|所有|all)/i.test(target)
      ? (arg('action') === 'unfreeze' ? '解冻全部应用' : '冻结全部应用')
      : target
        ? `冻结${target}`
        : '冻结应用',
    unfreezeApp: target ? `解冻${target}` : '解冻应用',
    getWebInstalledApps: '看已安装应用清单',
    getUsageStats: '查使用时长',
    getRecentApps: '查后台',
    pullBackToChat: '把你拉回聊天',
    searchWebApp: '搜索应用',
    searchRealApp: '搜索真机应用',
    freezeRealApp: target ? `锁定真机${target}` : '锁定真机应用',
    unfreezeRealApp: target ? `解锁真机${target}` : '解锁真机应用',
    sendNotification: '发通知',
    searchContacts: '搜索联系人',
    setVolume: '调音量',
    openRealApp: target ? `打开真机${target}` : '打开真机应用',
    openChat: target ? `打开和${target}的聊天` : '打开聊天',
    getCalendarEvents: '查日历',
    addCalendarEvent: '加日程',
    getTodoList: '看待办',
    addTodo: '加待办',
    takeScreenshot: '截屏',
    sendScreenshot: '给你发屏幕截图',
    lookScreen: '看屏幕',
    getForegroundApp: '看你在用什么',
    getBatteryStatus: '查电量',
    getVolume: '查音量',
    getRecentNotifications: '看通知',
    getRecentSMS: '看短信',
    lockApp: target ? `锁定${target}` : '锁定应用',
    switchToChat: '把你拉回聊天',
    tapScreen: '点屏幕',
    swipeScreen: '滑屏幕',
    inputText: '输入文字',
    pressKey: '按按键',
    // v2.3.0 原生系统级工具
    setRealAlarm: '定系统闹钟',
    startCountdown: '开系统倒计时',
    createCalendarEvent: '写系统日历',
    makePhoneCall: '拨打电话',
    sendSMS: '发短信',
    searchRealContact: '查真机通讯录',
    toggleFlashlight: '开关手电筒',
    getRealLocation: '查你的定位',
    // v2.4.2 系统级工具矩阵扩展
    getStepCount: '查你的步数',
    getCurrentActivity: '识别你的运动状态',
    getSleepData: '查你的睡眠',
    listFiles: '看手机文件',
    readFileContent: '读手机文件',
    saveTextToFile: '保存文件到手机',
    downloadFile: '下载文件',
    openSystemSetting: target ? `打开${target}设置` : '打开系统设置',
    getNetworkInfo: '查网络状态',
    openApp: target ? `打开${target}` : '打开应用',
    // v2.4.3 真机媒体感知/控制 + 真机日历读取
    getNowPlaying: '看你在听什么歌',
    controlRealMusic: arg('action') === 'next' ? '帮你切歌' : arg('action') === 'prev' ? '帮你切回上一首' : arg('action') === 'pause' ? '暂停音乐' : arg('action') === 'play' ? '继续放歌' : '控制音乐',
    getRealCalendarEvents: '查系统日历日程',
  };

  const action = actionMap[toolName] || `调用${toolName}`;
  if (!result.ok) {
    return { title: `${who}尝试${action}失败了`, status: 'fail', body: sanitizeFailText(result.text) };
  }
  // 成功文案：[角色名] 已 [动作]（如"谢予安已冻结备忘录"）
  return { title: `${who}已${action}`, status: 'done' };
}

/**
 * v2.4.34 底层乱码净化：把工具失败时的底层错误串洗成人话。
 * - 剥 URL/JSON 括号段/base64 长串/英文堆栈行/控制字符；
 * - 常见底层报错映射成短中文（找不到应用/无权限/超时/离线）；
 * - 净化后无有效内容返回 undefined（胶囊不带副文案，保持极简）。
 */
function sanitizeFailText(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let s = String(raw);
  // 常见底层错误 → 短中文（优先匹配，命中即返）
  if (/no-a11y|无障碍/i.test(s)) return '需要开启无障碍权限';
  if (/no-overlay-permission|悬浮窗/i.test(s)) return '需要悬浮窗权限';
  if (/timeout|超时/i.test(s)) return '操作超时了';
  if (/no-permission|permission denied|权限/i.test(s)) return '权限不够';
  if (/not.?found|找不到|未安装|没有这个/i.test(s)) return '没找到目标';
  if (/network|fetch failed|offline|断网|网络/i.test(s)) return '网络不太好';
  if (/cancel|取消/i.test(s)) return '被取消了';
  // 兑底净化：剥 URL / base64 / 花括号 JSON / 换行堆栈 / 控制字符 / 纯英文乱码段
  s = s
    .replace(/https?:\/\/\S+/g, '')
    .replace(/data:[\w/+.-]+;base64,\S+/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\{[^{}]*\}/g, '')
    .replace(/\[[^\u4e00-\u9fa5]{0,24}\]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[A-Za-z0-9_.\-:;=\/\\<>"'#&%$@!?+*\s]{5,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // 只留中文/常用标点的片段（英文碎词全部丢弃——那正是乱码主体）
  const zh = s.match(/[\u4e00-\u9fa5][\u4e00-\u9fa5，。！？、～…\s]{1,28}[\u4e00-\u9fa5！？。…～]?/g);
  const out = (zh ?? []).join('').trim();
  if (!out || out.length < 2) return undefined;
  return out.slice(0, 40);
}
