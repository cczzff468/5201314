'use client';

/**
 * AI 动手·Web 生态自主权（v1.9.35 按机主重构令重写）。
 *
 * 真机底层操控全面退役：不再调用 pm suspend / uiautomator / Shizuku 桥（截屏、点按、
 * 滑动、强杀、读通知等都下线）。智能体工作流全面转入本项目的 Web 网页生态——AI 的
 * 「动手」= 调用内部 Web 路由函数（web-tools.ts）：
 *  sendWebMessage（替机主发消息）/ postForum（发帖）/ likePost（点赞）/
 *  playMusic（放歌）/ getWebState（看网页状态）/ saveMemo（备忘录）/
 *  setAlarm（定闹钟）/ queryWeather（查天气）/ openScreen（打开网页应用）
 *
 * 语义（与旧版一致）：每个能力一个开关（设置 › AI 动手）——
 *  - 关闭：教学规则不注入（AI 不知道自己有这能力）+ 执行器硬拦截（就算 AI 硬调也拒绝）
 *  - 打开：教学规则按当前开关动态注入，AI 按人设/记忆/上下文自主决定何时用
 *
 * 兜底标记协议（[手机操作:命令:参数]）保留 Web 可用命令：打开/播歌/冻结/解冻/
 * 查后台/使用时长/拉回/agent；真机专属命令一律「已退役」如实回话。
 *
 * 持久化：localStorage 单键 JSON（全局共享不分会话）。
 */

import { matchWebAppByPackage } from './agent-app-nav';
import { openScreenApp } from './agent-screen';
import { isJealousyUnlockAllowed, onJealousyUnfreeze } from './jealousy-lock';
import { useSettings } from './store';

// ---------------- 能力注册表 ----------------

export type AutonomyCapGroup = 'hands' | 'eyes';

export interface AutonomyCap {
  key: string;
  /** 开关标题（设置页显示） */
  label: string;
  /** 一句话说明（设置页副标题 + 教学规则的语义描述共用） */
  desc: string;
  group: AutonomyCapGroup;
  /** 危险项：默认关（总开关开了也不放开，需手动逐项开） */
  danger?: boolean;
}

/**
 * 能力清单（v1.9.35 全部 Web 化）。安全项（无 danger）在总开关打开时默认放开；
 * 危险项永远默认关，用户手动开才生效。
 */
export const AUTONOMY_CAPS: AutonomyCap[] = [
  // ---- 动手（真实操作网页生态） ----
  { key: 'sendmsg', label: '替机主发消息', desc: 'AI 在网页微信/QQ/信息里以你的身份发消息（发给谁、说什么由 TA 按对话决定）', group: 'hands' },
  { key: 'forumpost', label: '论坛发帖', desc: 'AI 用你的账号在 X 论坛公开发帖（发布后网友和 TA 会来互动）', group: 'hands', danger: true },
  { key: 'forumlike', label: '论坛点赞', desc: 'AI 给帖子点赞', group: 'hands' },
  { key: 'music', label: '播放音乐', desc: 'AI 打开音乐 App 搜歌并播放（「放首歌」就行）', group: 'hands' },
  { key: 'memo', label: '记备忘录', desc: 'AI 把内容存进备忘录（真实保存，App 里可见）', group: 'hands' },
  { key: 'alarm', label: '定闹钟', desc: 'AI 在时钟里帮你定闹钟（到点真实响铃）', group: 'hands' },
  { key: 'weather', label: '查天气', desc: 'AI 查天气并同步到天气 App', group: 'hands' },
  { key: 'openapp', label: '打开网页应用', desc: 'AI 打开这台手机里的应用界面（微信/备忘录/时钟/论坛…）', group: 'hands' },
  { key: 'agent', label: '智能体多步任务', desc: '语音悬浮球一句话委派多步任务：AI 链式调用多个 Web 工具直到目标完成', group: 'hands' },
  { key: 'pullback', label: '拉回本 APP', desc: 'AI 把你从别的界面切回聊天页（吃醋/想你了会用，别滥用）', group: 'hands' },
  { key: 'freeze', label: '冻结/解冻应用', desc: '冻结网页内应用（吃醋锁同款：图标变灰点不开，可逆）', group: 'hands', danger: true },
  // ---- 看见（只读探测） ----
  { key: 'webstate', label: '看网页状态', desc: 'AI 知道你此刻在哪个 App/桌面、锁屏熄屏、正在放什么歌', group: 'eyes' },
  { key: 'recents', label: '查后台应用', desc: '最近用过哪些应用（吃醋锁巡检「TA 刚才在干嘛」）', group: 'eyes' },
  { key: 'usage', label: '使用时长', desc: '今日各应用使用时长排行（刷了多久都在刷什么）', group: 'eyes' },
];

const CAP_KEYS = AUTONOMY_CAPS.map((c) => c.key);

// ---------------- 持久化（localStorage 单键） ----------------

const STORE_KEY = 'shizuku-autonomy-v1';

export interface AutonomyConfig {
  /** 总开关：关 = 整个「AI 动手」能力不存在（教学不注入 + 执行全拒） */
  master: boolean;
  /** 逐项开关（key → on）；缺省项按 danger 取默认 */
  caps: Record<string, boolean>;
}

function defaultCaps(): Record<string, boolean> {
  const caps: Record<string, boolean> = {};
  for (const c of AUTONOMY_CAPS) caps[c.key] = !c.danger;
  return caps;
}

export function getAutonomyConfig(): AutonomyConfig {
  if (typeof window === 'undefined') return { master: false, caps: {} };
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return { master: false, caps: defaultCaps() };
    const parsed = JSON.parse(raw) as Partial<AutonomyConfig>;
    const caps = { ...defaultCaps(), ...(parsed.caps ?? {}) };
    // 清掉已下线的真机时代脏键（tap/swipe/type/key/open/screencap/notify/…）
    for (const k of Object.keys(caps)) if (!CAP_KEYS.includes(k)) delete caps[k];
    return { master: Boolean(parsed.master), caps };
  } catch {
    return { master: false, caps: defaultCaps() };
  }
}

function saveAutonomyConfig(cfg: AutonomyConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
  } catch {
    /* 隐私模式等写入失败静默 */
  }
}

export function setAutonomyMaster(on: boolean): AutonomyConfig {
  const cfg = getAutonomyConfig();
  cfg.master = on;
  saveAutonomyConfig(cfg);
  return cfg;
}

export function setAutonomyCap(key: string, on: boolean): AutonomyConfig {
  const cfg = getAutonomyConfig();
  if (CAP_KEYS.includes(key)) {
    cfg.caps[key] = on;
    saveAutonomyConfig(cfg);
  }
  return cfg;
}

// ---------------- 教学规则（按当前开关注入） ----------------

/**
 * 动态教学块：总开关关 / 无任何单项开着 → 返回 []（零 token）。
 * 每轮发送时现场读取（开关改动下一轮立即生效，与感知设置同款范式）。
 * v1.9.35：真机 Shizuku 标记教学全面下线，只教 Web 工具 + Web 可用兜底标记。
 */
export function buildShizukuAutonomyRules(): string[] {
  const cfg = getAutonomyConfig();
  if (!cfg.master) return [];
  return [...buildPhoneToolRules(), ...buildWebMarkerRules()];
}

/** Web 可用的兜底标记（[手机操作:…]）教学：只教网页内能真执行的那几个命令 */
function buildWebMarkerRules(): string[] {
  const cfg = getAutonomyConfig();
  if (!cfg.master) return [];
  const lines: string[] = [];
  const markers: string[] = [];
  if (cfg.caps['openapp'] === true) markers.push('[手机操作:打开:应用名]（打开这台手机里的应用界面，如 [手机操作:打开:微信]）');
  if (cfg.caps['music'] === true) markers.push('[手机操作:播歌:歌名]（自动搜歌播放，可带歌手名，如 [手机操作:播歌:晴天 周杰伦]）');
  if (cfg.caps['freeze'] === true) markers.push('[手机操作:冻结:应用名] / [手机操作:解冻:应用名]（网页内应用冻结/恢复，吃醋锁同款）');
  if (cfg.caps['recents'] === true) markers.push('[手机操作:查后台:]（最近用过哪些应用）');
  if (cfg.caps['usage'] === true) markers.push('[手机操作:使用时长:]（今日各应用使用时长）');
  if (cfg.caps['pullback'] === true) markers.push('[手机操作:拉回:]（把机主切回聊天页）');
  if (markers.length > 0) {
    lines.push(
      '【网页手机操作·兜底标记】上面工具调不了的场合（弱 FC 端点只回纯文字）可以用标记兜底，每个标记单独占一行、放回复末尾：',
      ...markers.map((m) => `- ${m}`),
      '【工具优先】同一件事工具调用与标记都能做时，一律优先工具调用；调用了工具就不要再输出同一操作的标记，避免重复执行。',
    );
  }
  return lines;
}

// ---------------- Function Calling（工具调用通道） ----------------

/** Web 工具能力键（与 phone-tools.TOOL_CAPS 同源） */
const WEB_TOOL_CAP_KEYS = [
  'sendmsg', 'forumpost', 'forumlike', 'music', 'webstate', 'memo', 'alarm', 'weather', 'openapp', 'agent',
];

/**
 * Function Calling 是否就绪：已配 API + 「AI 动手」总开关开 + 至少一项 Web 能力开。
 * 每轮发送时现场读取（设置改动下一轮立即生效）。
 */
export function phoneFcReady(): boolean {
  if (typeof window === 'undefined') return false;
  const apiCfg = useSettings.getState().apiConfig;
  if (!apiCfg.baseUrl.trim()) return false; // 未配 API：聊天本身走不通，工具无从谈起
  const cfg = getAutonomyConfig();
  if (!cfg.master) return false;
  return WEB_TOOL_CAP_KEYS.some((k) => cfg.caps[k] === true);
}

/**
 * 工具调用强制教学（仅 FC 就绪时非空；关闭/未配置零 token）。
 * 机主需求一/二：AI 只调用内部 Web 路由函数；多步任务链式执行；
 * 机主需求三：聊天气泡零底层日志（过程从灵动岛弹出，正文只说人话）。
 */
export function buildPhoneToolRules(): string[] {
  const cfg = getAutonomyConfig();
  if (!cfg.master) return [];
  const caps: string[] = [];
  if (cfg.caps['sendmsg'] === true) caps.push('sendWebMessage（在微信/QQ/信息里替机主发消息）');
  if (cfg.caps['forumpost'] === true) caps.push('postForum（在 X 论坛发帖）');
  if (cfg.caps['forumlike'] === true) caps.push('likePost（给帖子点赞）');
  if (cfg.caps['music'] === true) caps.push('playMusic（打开音乐 App 放歌）');
  if (cfg.caps['webstate'] === true) caps.push('getWebState（看机主此刻在哪个 App/桌面、放什么歌）');
  if (cfg.caps['memo'] === true) caps.push('saveMemo（把内容存进备忘录）');
  if (cfg.caps['alarm'] === true) caps.push('setAlarm（定闹钟，到点真响铃）');
  if (cfg.caps['weather'] === true) caps.push('queryWeather（查天气并同步天气 App）');
  if (cfg.caps['openapp'] === true) caps.push('openScreen（打开手机里的应用界面）');
  if (caps.length === 0) return [];

  return [
    `【Web 工具调用·最高优先级】这台手机里的所有 App（微信/QQ/信息/论坛/音乐/备忘录/时钟/天气）都活在你的网页生态里，你已经接入内部工具（Function Calling）。可用工具：${caps.join('；')}。机主的请求涉及任何实际动作（发消息/发帖/点赞/放歌/记备忘录/定闹钟/查天气/打开应用）时，你绝对不能只回复文字、也不许只口头答应——必须立刻输出对应的工具调用（tool call）。只说不做是违规。`,
    '【多步任务·链式执行】机主一句话里有多个要求时（如「给Z发个微信说晚安，再帮我定个8点的闹钟，顺便记一下明天要带伞」），按顺序逐个调用工具：sendWebMessage → setAlarm → saveMemo，每个工具的真实执行结果会以 role:"tool" 自动回传给你，全部做完后再用一两句自然的话向机主汇报总结果（如「微信发了、闹钟也定好啦，备忘录也记上了」）。',
    '【结果如实】工具回传的结果是真实执行反馈：成功了才能说做好了，失败（联系人不存在/能力未开启/没搜到歌）要如实告诉机主原因，绝不假装成功；失败反馈里带可用选项清单时，可以换准确参数重试一次。',
    '【纯净度铁律】你最终发给机主的聊天气泡里，严禁出现任何底层操作日志：(内心独白：…)、(正在操作：…)、(内部反馈：…)、工具名、参数、执行步骤清单一律不许出现——所有操作过程系统会自动用灵动岛弹窗播报给机主，你只需要像正常人一样说结果（如「我已经在微信上给Z发过去了哦」）。',
    '【工具优先】同一件事工具调用与 [手机操作:…] 标记都能做时，一律优先输出工具调用（标记只是旧通道兜底）；调用了工具就不要再输出同一操作的标记，避免重复执行。',
  ];
}

// ---------------- 兜底标记执行器（解析 + 硬 gate + Web 分发） ----------------

const DENIED = { ok: false as const, text: '该能力已被机主在设置里关闭，无法执行' };
const RETIRED = { ok: false as const, text: '真机底层操控已全面退役（不再调用 pm suspend / uiautomator）：这台手机里的所有 App 都活在网页里，请改用 Web 工具调用（sendWebMessage/postForum/playMusic/…）完成机主的请求' };

/**
 * 执行 [手机操作:命令:参数…] 的完整参数段（ACTION_RE 捕获的整段 arg）。
 * v1.9.35：只保留 Web 可执行命令；真机命令一律返回「已退役」如实话术。
 */
export async function executePhoneOp(argRaw: string): Promise<{ ok: boolean; text: string }> {
  const parts = argRaw.split(/[:：]/).map((s) => s.trim());
  const cmd = (parts.shift() ?? '').toLowerCase();
  const p = parts; // 剩余参数段
  if (!cmd) return { ok: false, text: '手机操作命令为空' };
  const cfg = getAutonomyConfig();
  if (!cfg.master) return DENIED;
  const on = (k: string) => cfg.caps[k] === true;

  switch (cmd) {
    case '打开': {
      if (!on('openapp')) return DENIED;
      const name = (p[0] ?? '').trim();
      if (!name) return { ok: false, text: '打开命令缺应用名（[手机操作:打开:应用名]）' };
      // 包名/中文名先走网页映射，映射不上交给 openScreenApp 的应用注册表
      const web = matchWebAppByPackage(name);
      if (web) return openScreenApp(web.appId);
      return openScreenApp(name);
    }
    case '播歌': {
      if (!on('music')) return DENIED;
      const q = argRaw.split(/[:：]/).slice(1).join(':').trim();
      if (!q) return { ok: false, text: '播歌缺歌名（[手机操作:播歌:歌名]，可带歌手名）' };
      const { toolPlayMusic } = await import('./web-tools');
      const r = await toolPlayMusic(q);
      return { ok: r.ok, text: r.text.replace(/^【[^】]+】/, '') };
    }
    case '查后台': {
      if (!on('recents')) return DENIED;
      const { webRecentReport } = await import('./web-usage-ledger');
      return { ok: true, text: await webRecentReport() };
    }
    case '使用时长': {
      if (!on('usage')) return DENIED;
      const { webUsageReport } = await import('./web-usage-ledger');
      return { ok: true, text: webUsageReport() };
    }
    case '拉回': {
      if (!on('pullback')) return DENIED;
      try {
        const { useUI } = await import('./store');
        const { readJealousyRuntime } = await import('./jealousy-lock');
        const ui = useUI.getState();
        const lastChat = readJealousyRuntime().lastChat;
        const target: 'wechat' | 'qq' | 'chat' = lastChat?.app === 'wx' ? 'wechat' : lastChat?.app === 'qq' ? 'qq' : 'chat';
        if (ui.activeApp === target) return { ok: true, text: 'TA 已经在这个 APP 的聊天页了' };
        if (ui.activeApp) ui.switchToApp(target);
        else ui.openApp(target);
        return { ok: true, text: '已把 TA 拽回这个 APP 的聊天页' };
      } catch {
        return { ok: false, text: '拉回失败（聊天页不可用）' };
      }
    }
    case '冻结':
    case '解冻': {
      if (!on('freeze') && !(cmd === '解冻' && p[0] && isJealousyUnlockAllowed(p[0]))) return DENIED;
      if (!p[0]) return { ok: false, text: `${cmd}命令缺应用名（[手机操作:${cmd}:应用名]）` };
      const { webAppOfPkg, setWebFrozen, getWebFrozen } = await import('./web-app-lock');
      const web = webAppOfPkg(p[0]);
      if (cmd === '冻结') {
        if (!web) return { ok: false, text: `网页端只能冻结内置应用（如 网易云音乐/浏览器/淘宝/美团/照片/X论坛），「${p[0]}」没有网页对应体` };
        setWebFrozen(p[0], Date.now() + 30 * 60_000, 'AI', 'ai');
        try {
          const { useUI } = await import('./store');
          if (useUI.getState().activeApp === web.appId) useUI.getState().closeApp();
        } catch {
          /* 踢出失败不影响锁本身 */
        }
        return { ok: true, text: `已冻结${web.name}（网页内应用：图标变灰、点开见提示，30 分钟后自动解冻）` };
      }
      if (isJealousyUnlockAllowed(p[0])) {
        onJealousyUnfreeze(p[0]);
        return { ok: true, text: `已解冻 ${p[0]}（吃醋锁已解开）` };
      }
      const frozen = getWebFrozen();
      if (frozen && frozen.pkg === p[0]) {
        setWebFrozen(null);
        return { ok: true, text: `已解冻${web?.name ?? p[0]}（网页内应用恢复可用）` };
      }
      return { ok: true, text: `${p[0]} 当前没有被冻结` };
    }
    case 'agent':
    case '智能体': {
      if (!on('agent')) return { ok: false, text: '「智能体多步任务」能力未开启（设置 › AI 动手）' };
      const task = argRaw.split(/[:：]/).slice(1).join(':').trim();
      if (!task) return { ok: false, text: 'agent 缺任务描述（[手机操作:agent:一句话任务]）' };
      const { runAgentTask } = await import('./web-agent');
      const r = await runAgentTask(task);
      return { ok: r.ok, text: r.text };
    }
    // ---- 真机时代命令：一律「已退役」如实话术（AI 看到反馈自动换 Web 工具） ----
    case '点文字':
    case '点按':
    case '滑动':
    case '输入':
    case '按键':
    case '看屏幕':
    case '读屏幕':
    case '截屏':
    case '前台':
    case '通知':
    case '电量':
    case '剪贴板':
    case '短信':
    case '通话':
    case '音量':
    case '网络':
    case '强杀':
    case '应用列表':
    case '卸载':
      return RETIRED;
    default:
      return {
        ok: false,
        text: `不认识的手机操作「${cmd}」（Web 可用：打开/播歌/冻结/解冻/查后台/使用时长/拉回/agent；真机操控命令已全面退役）`,
      };
  }
}

// ---------------- 串行执行队列（复合指令按顺序逐个来） ----------------

/**
 * 全局操作队列：同一轮回复里的多个 [手机操作:…] 标记按书写顺序串行执行。
 * 间隔：界面类操作后等 2.5s 渲染落定，其余 1.2s。
 * onStart 在轮到该操作真正开跑时回调（聊天页技能胶囊用）。
 */
const OP_GAP_MS = 1200;
const UI_SETTLE_MS = 2500;
const UI_TOUCH_CMDS = ['打开', '播歌', '冻结', '解冻', '拉回'];

let opChain: Promise<unknown> = Promise.resolve();

export function enqueuePhoneOp(argRaw: string, onStart?: () => void): Promise<{ ok: boolean; text: string }> {
  let resolveResult!: (r: { ok: boolean; text: string }) => void;
  const resultP = new Promise<{ ok: boolean; text: string }>((res) => {
    resolveResult = res;
  });
  const cmd = (argRaw.split(/[:：]/)[0] ?? '').trim().toLowerCase();
  opChain = opChain.then(async () => {
    onStart?.();
    let r: { ok: boolean; text: string };
    try {
      r = await executePhoneOp(argRaw);
    } catch {
      r = { ok: false, text: '执行器异常（Web 路由调用抛错）' };
    }
    resolveResult(r);
    const gap = UI_TOUCH_CMDS.includes(cmd) ? UI_SETTLE_MS : OP_GAP_MS;
    await new Promise((res) => window.setTimeout(res, gap));
  });
  return resultP;
}
