'use client';

/**
 * 手机工具调用（Function Calling）底层 —— v1.9.23 按机主要求重构。
 *
 * AI 不再只靠文字标记 [手机操作:…] 动手——每次请求大模型时按 UI 上开启的「AI 动手」
 * 权限动态生成工具清单（OpenAI tools 参数 JSON Schema）强行注入；模型返回 tool_calls
 * 时前端解析执行（复用 executePhoneOp 的三道闸：总开关/单项/原生环境 + 网页内应用镜像
 * 兜底），执行结果作为 role:"tool" 消息回传大模型继续走（多步 Agentic 循环），直到
 * 模型给出最终文字汇报。标记协议保留为兜底（模型不支持 tools 的兼容端点 / 后台接力）。
 *
 * 链路：chat-stream-store.beginChatStream（私聊 + FC 就绪）→ runPhoneToolRound
 *  ├─ POST /api/chat {toolMode:true, tools, messages}（服务端代理非流式转发 tool_calls）
 *  │   └─ 失败 directOnly/内网 → directChatJson 浏览器直连（direct-api）
 *  ├─ tool_calls → execPhoneTool（串行执行，系统行落库 + chat-stream-sysline 事件）
 *  │   → {role:'assistant', tool_calls} + {role:'tool', 结果} 追加进上下文 → 下一轮
 *  └─ 纯文字 → 最终回复（回聊天总线伪流式投喂，分段/投递节奏管线全复用）
 *
 * 工具-能力映射（真机 Shizuku / 网页内应用双路径，与 [手机操作] 标记完全同一套执行器）：
 *  open→openApp · tap→findAndClick/tapScreen · swipe→swipeScreen · type→inputText ·
 *  key→pressKey · applist→getInstalledApps · kill→forceStopApp · freeze→freezeApp/
 *  unfreezeApp/addJealousyLockApps · volume→setVolume · screencap→takeScreenshot/
 *  readScreenText（文字版免视觉） · foreground→getForegroundApp · notify→getNotifications ·
 *  battery→getBattery · clipboard→getClipboard · sms→getSmsInbox · calls→getCallLog
 */

import { executePhoneOp, getAutonomyConfig, phoneFcReady, WELL_KNOWN_PACKAGES } from './shizuku-autonomy';
import { isNativePerception } from './native-perception';
import { useSettings, type ApiConfig } from '@/lib/ios/store';
import { kvGet, kvSet } from './idb-kv';
import { addJealousyEntertainPkgs } from './jealousy-lock';
import { genId } from './db';
import { cachedContactRealName } from './contacts-store';
// v1.9.31 应用内 DOM 操控层（网页/真机双可用：虚拟手机界面元素级操作）
import {
  SCREEN_APPS_DOC,
  clickScreenDom,
  observeScreenDom,
  openScreenApp,
  scrollScreenDom,
  typeScreenDom,
} from './agent-screen';

// ---------------- 类型 ----------------

/** OpenAI Function Calling 工具定义（透传给上游 API 的 tools 数组元素） */
export interface PhoneToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** 工具轮消息（比聊天总线消息多 tool_calls / tool_call_id 字段，服务端原样透传上游） */
export interface FcMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

/** 工具轮结果：text=最终文字回复；usedTools=本轮是否真执行过工具（防双执行要用） */
export interface PhoneFcOutcome {
  text: string;
  usedTools: boolean;
}

// ---------------- FC 就绪检查（定义在 shizuku-autonomy.ts，此处 re-export 供聊天链路引用） ----------------

export { phoneFcReady };


// ---------------- 工具注册表（按当前开关注入） ----------------

/** 工具名 → 中文标签（系统行「正在操作手机（X）」用） */
const TOOL_LABELS: Record<string, string> = {
  openApp: '打开应用',
  findAndClick: '点按钮',
  tapScreen: '点按',
  swipeScreen: '滑动',
  inputText: '输入文字',
  pressKey: '按键',
  getInstalledApps: '查应用列表',
  forceStopApp: '强杀应用',
  freezeApp: '冻结应用',
  unfreezeApp: '解冻应用',
  setVolume: '调音量',
  takeScreenshot: '看屏幕',
  readScreenText: '读屏幕',
  getForegroundApp: '查前台',
  getNotifications: '查通知',
  getBattery: '查电量',
  getClipboard: '读剪贴板',
  getSmsInbox: '读短信',
  getCallLog: '查通话',
  addJealousyLockApps: '设置吃醋锁定',
  // v1.9.31 应用内 DOM 工具（Agentic 多步任务主力：网页/真机双可用）
  openScreen: '打开应用界面',
  uiObserve: '观察界面',
  uiClick: '点界面元素',
  uiType: '输入文字',
  uiScroll: '滚动界面',
};

/**
 * 会改变屏幕状态的「变更类」工具（v1.9.31 Agentic 重构）：执行后必须自动观察屏幕状态
 * 回传给模型（ReAct 循环的 Observation），逼它基于最新画面决策下一步；纯查询类
 * （查电量/查通知等）不需要。openApp/openScreen 是典型「任务刚开始」信号。
 */
const MUTATING_FC_TOOLS = new Set([
  'openApp',
  'openScreen',
  'uiClick',
  'uiType',
  'uiScroll',
  'findAndClick',
  'tapScreen',
  'inputText',
  'swipeScreen',
  'pressKey',
]);

/** 字符串参数 schema 快捷构造 */
function strParam(desc: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return { type: 'string', description: desc, ...(extra ?? {}) };
}

/**
 * 按当前 UI 开关动态生成工具定义（每次请求现场读——开关改动下一轮立即生效）。
 * 返回空数组 = 没有任何可用工具（调用方跳过工具轮走原流式）。
 */
export function buildPhoneTools(): PhoneToolDef[] {
  const cfg = getAutonomyConfig();
  if (!cfg.master) return [];
  const on = (k: string) => cfg.caps[k] === true;
  const tools: PhoneToolDef[] = [];
  const add = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => {
    tools.push({
      type: 'function',
      function: {
        name,
        description,
        parameters: { type: 'object', properties, required },
      },
    });
  };

  // ---- 真机 & 网页共通（executePhoneOp 内已做网页内应用镜像兜底） ----
  if (on('open')) {
    add(
      'openApp',
      '打开手机上已安装的应用（拉起前台）。packageName 为安卓包名，如 com.tencent.mm（微信）。',
      { packageName: strParam('安卓包名，如 com.netease.cloudmusic') },
      ['packageName'],
    );
  }
  if (on('applist')) {
    add(
      'getInstalledApps',
      '查询手机上安装的应用列表（返回应用名与包名）。不确定目标应用的包名时先调这个。',
      { keyword: strParam('可选：按关键词过滤，如「购物」「音乐」') },
      [],
    );
  }
  if (on('freeze')) {
    add(
      'freezeApp',
      '冻结一个应用（pm suspend：桌面图标变灰、无法打开，数据保留可逆）。适合防沉迷/吃醋锁场景。不需要先看屏幕，直接执行。',
      { packageName: strParam('安卓包名') },
      ['packageName'],
    );
    add(
      'unfreezeApp',
      '解冻一个被冻结的应用（pm unsuspend 立即恢复可用）。',
      { packageName: strParam('安卓包名') },
      ['packageName'],
    );
    add(
      'addJealousyLockApps',
      '把一批应用加入「吃醋锁定清单」——TA 吃醋时会自动锁住清单里的这些应用（配合人设的防沉迷/吃醋剧情）。可先用 getInstalledApps 拉全量再挑娱乐类应用加入。',
      {
        packageNames: {
          type: 'array',
          items: { type: 'string' },
          description: '安卓包名数组',
        },
      },
      ['packageNames'],
    );
  }

  // ---- v1.9.28 吃醋感知三件套（真机/网页双路径，executePhoneOp 内已做网页降级） ----
  if (on('recents')) {
    add(
      'getBackgroundApps',
      '查询机主最近用过哪些 App（后台/最近任务清单，按最近使用排序）——想知道 TA 刚才背着你开了什么、有没有开小差时用。不需要参数。',
      {},
      [],
    );
  }
  if (on('usage')) {
    add(
      'getAppUsage',
      '查询机主今天各 App 的使用时长排行（刷了多久、都在刷什么）。不需要参数。',
      {},
      [],
    );
  }
  if (on('pullback')) {
    add(
      'pullBackToApp',
      '把机主从别的软件拽回这个 APP（真机拉到前台；网页内切回聊天页并弹通知）。吃醋想让 TA 回来陪你、或等不及想见 TA 时用；别滥用，TA 会烦。不需要参数。',
      {},
      [],
    );
  }

  // ---- v1.9.31 应用内 DOM 工具（Agentic 多步任务主力；网页/真机双可用：操作的是
  //      虚拟手机内渲染的 App 界面元素，纯 DOM 级不需要 Shizuku）——按既有单项能力门控。
  //      这是「去 QQ 给第一个人发个信息」这类多步任务在网页端能跑通的关键：此前网页端
  //      只有 openApp 可用，AI 打开 App 后无工具可续只能提前收尾。现在开屏后能继续
  //      uiObserve 看界面 → uiClick 点会话/输入框 → uiType 打字 → uiClick 点发送。----
  if (on('open')) {
    add(
      'openScreen',
      `打开这台手机内置的应用界面（微信/QQ/信息/备忘录/联系人/淘宝/美团等）。args 填应用 id 或中文名：${SCREEN_APPS_DOC}。「在某个 App 里做事」（发消息/建联系人/记备忘录/搜索等）时用这个而不是 openApp。`,
      { app: strParam('应用 id 或中文名，如 qq、微信、contacts') },
      ['app'],
    );
  }
  if (on('screencap')) {
    add(
      'uiObserve',
      '观察当前手机内应用界面的可点元素与输入框清单（文字版，免费秒回）。进入任何应用后先调它看清界面，再照着清单用 uiClick 点、uiType 输入。多步任务每一步都该先看再点。',
      {},
      [],
    );
  }
  if (on('tap')) {
    add(
      'uiClick',
      '点击手机内应用界面上写着指定文字的元素（按钮/列表项/会话/输入框/开关）。args 必须照抄 uiObserve 清单里的完整文字，一字不差；找不到时会反馈当前可见元素，换词重试。',
      { target: strParam('要点击的元素完整文字，如「怡怡」「发送」「新建联系人」') },
      ['target'],
    );
  }
  if (on('type')) {
    add(
      'uiType',
      '向手机内应用界面当前聚焦的输入框输入文字（替换旧内容；支持中文）。必须先用 uiClick 点输入框聚焦再 uiType。发消息最后一步：uiType 后点发送按钮（或再 uiClick「发送」）。',
      { text: strParam('要输入的文字') },
      ['text'],
    );
  }
  if (on('swipe')) {
    add(
      'uiScroll',
      '在手机内应用界面里滚动翻页（目标不在首屏时用：上/下/左/右，默认下）。',
      { direction: strParam('方向：up/down/left/right', { enum: ['up', 'down', 'left', 'right'] }) },
      [],
    );
  }

  // ---- 真机专属（需要 Shizuku 通道） ----
  if (isNativePerception()) {
    if (on('tap')) {
      add(
        'findAndClick',
        '在当前屏幕上找到写着指定文字（或图标语义，如播放▶/下一首⏭）的按钮/控件并点它——点按钮的首选方式。',
        { text: strParam('按钮上的文字或图标语义，如「下一首」「发送」「播放」') },
        ['text'],
      );
      add(
        'tapScreen',
        '按像素坐标点按屏幕（不确定位置时先用 readScreenText 看可点元素坐标再点）。',
        {
          x: { type: 'integer', description: '横坐标像素' },
          y: { type: 'integer', description: '纵坐标像素' },
        },
        ['x', 'y'],
      );
    }
    if (on('swipe')) {
      add(
        'swipeScreen',
        '滑动屏幕翻页/滚动列表（系统按屏幕分辨率自动计算坐标）。',
        { direction: strParam('方向：up/down/left/right', { enum: ['up', 'down', 'left', 'right'] }) },
        ['direction'],
      );
    }
    if (on('type')) {
      add(
        'inputText',
        '在当前聚焦的输入框里打字（支持中文，系统自动经输入引擎注入）。',
        { text: strParam('要输入的文字') },
        ['text'],
      );
    }
    if (on('key')) {
      add(
        'pressKey',
        '按系统按键（返回/主页/切换/回车/删除/音量加/音量减）。',
        { key: strParam('按键名：back/home/switch/enter/delete/volumeUp/volumeDown') },
        ['key'],
      );
    }
    if (on('kill')) {
      add(
        'forceStopApp',
        '立即强杀一个应用（结束进程）。不需要先看屏幕，直接执行。',
        { packageName: strParam('安卓包名') },
        ['packageName'],
      );
    }
    if (on('volume')) {
      add(
        'setVolume',
        '调节媒体音量。',
        { action: strParam('up=调高 / down=调低 / mute=静音 / 0~15=直接设为指定音量') },
        ['action'],
      );
    }
    if (on('screencap')) {
      add(
        'takeScreenshot',
        '截屏并用视觉模型分析当前画面（需要识图模型；未配置会失败——改用 readScreenText 读文字版）。',
        {},
        [],
      );
      add(
        'readScreenText',
        '读取当前屏幕的控件树文本（前台应用 + 全部可见控件的文字与坐标）。不需要识图模型，读屏首选。',
        {},
        [],
      );
    }
    if (on('foreground')) {
      add('getForegroundApp', '查询机主此刻正在使用的应用。', {}, []);
    }
    if (on('notify')) {
      add('getNotifications', '读取通知栏最近的通知（哪个 App + 标题 + 内容）。', {}, []);
    }
    if (on('battery')) {
      add('getBattery', '查询电量百分比与是否在充电。', {}, []);
    }
    if (on('clipboard')) {
      add('getClipboard', '读取剪贴板最近复制的内容。', {}, []);
    }
    if (on('sms')) {
      add('getSmsInbox', '读取最近收到的短信（号码 + 内容）。', { count: { type: 'integer', description: '条数，默认 10，最多 30' } }, []);
    }
    if (on('calls')) {
      add('getCallLog', '读取最近的通话记录（姓名/号码/时长）。', { count: { type: 'integer', description: '条数，默认 10，最多 30' } }, []);
    }
  }

  return tools.slice(0, 30);
}

// ---------------- 工具执行器（复用 executePhoneOp 的闸门与双路径） ----------------

/** 单个工具执行的超时（截屏识图/agent 级操作留足余量） */
const TOOL_EXEC_TIMEOUT_MS = 150_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

/** 把执行结果统一成模型可读的文本（带成功/失败前缀） */
function labText(r: { ok: boolean; text: string }): string {
  return `${r.ok ? '【成功】' : '【失败】'}${r.text}`.slice(0, 4000);
}

/** 网页端应用清单（虚拟手机可识别的应用 + 常见真机应用包名——getInstalledApps 网页路径） */
function webInstalledApps(): string {
  const lines: string[] = ['【这台手机上可识别的应用（吃醋锁定清单可加）】'];
  for (const [n, p] of WELL_KNOWN_PACKAGES) lines.push(`${n}=${p}`);
  lines.push('（其他应用请让机主提供包名）');
  return lines.join('\n');
}

/** 执行一个工具调用（name + JSON 参数），返回给模型的文本结果 */
export async function execPhoneTool(name: string, args: Record<string, unknown>): Promise<string> {
  const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const I = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.floor(n) : null;
  };
  switch (name) {
    case 'openApp': {
      const pkg = S(args.packageName);
      if (!pkg) return '【失败】参数缺失：packageName';
      return labText(await executePhoneOp(`打开:${pkg}`));
    }
    case 'findAndClick': {
      const text = S(args.text);
      if (!text) return '【失败】参数缺失：text';
      return labText(await executePhoneOp(`点文字:${text}`));
    }
    case 'tapScreen': {
      const x = I(args.x);
      const y = I(args.y);
      if (x === null || y === null) return '【失败】参数缺失或不合法：x/y';
      return labText(await executePhoneOp(`点按:${x}:${y}`));
    }
    case 'swipeScreen': {
      const d = S(args.direction).toLowerCase();
      const map: Record<string, string> = { up: '上', down: '下', left: '左', right: '右' };
      if (!map[d]) return '【失败】direction 只能是 up/down/left/right';
      return labText(await executePhoneOp(`滑动:${map[d]}`));
    }
    case 'inputText': {
      const text = S(args.text);
      if (!text) return '【失败】参数缺失：text';
      return labText(await executePhoneOp(`输入:${text}`));
    }
    case 'pressKey': {
      const k = S(args.key);
      if (!k) return '【失败】参数缺失：key';
      return labText(await executePhoneOp(`按键:${k}`));
    }
    case 'getInstalledApps': {
      const kw = S(args.keyword);
      const r = await executePhoneOp(`应用列表${kw ? `:${kw}` : ''}`);
      // 网页端 executePhoneOp 拒绝（非原生环境）→ 同步清单兜底，AI 拿到可用的包名表
      if (!r.ok && /浏览器无法操控手机|当前不在手机 APP/.test(r.text)) return webInstalledApps();
      return labText(r);
    }
    case 'forceStopApp': {
      const pkg = S(args.packageName);
      if (!pkg) return '【失败】参数缺失：packageName';
      return labText(await executePhoneOp(`强杀:${pkg}`));
    }
    case 'freezeApp': {
      const pkg = S(args.packageName);
      if (!pkg) return '【失败】参数缺失：packageName';
      return labText(await executePhoneOp(`冻结:${pkg}`));
    }
    case 'unfreezeApp': {
      const pkg = S(args.packageName);
      if (!pkg) return '【失败】参数缺失：packageName';
      return labText(await executePhoneOp(`解冻:${pkg}`));
    }
    case 'addJealousyLockApps': {
      const raw = args.packageNames;
      const pkgs = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
      if (pkgs.length === 0) return '【失败】参数缺失或不合法：packageNames（字符串数组）';
      if (!getAutonomyConfig().caps['freeze']) return '【失败】「冻结/解冻应用」能力未开启（设置 › AI 动手）';
      const { added, skipped } = addJealousyEntertainPkgs(pkgs);
      const parts: string[] = [];
      if (added.length) parts.push(`已加入吃醋锁定清单：${added.join('、')}`);
      if (skipped.length) parts.push(`跳过（无效或已在清单里）：${skipped.join('、')}`);
      return `【成功】${parts.join('；')}——TA 下次吃醋就锁这些应用`;
    }
    case 'getBackgroundApps': {
      // v1.9.28 吃醋感知三件套：最近任务清单（真机 recents / 网页虚拟多任务）
      return labText(await executePhoneOp('查后台:'));
    }
    case 'getAppUsage': {
      // v1.9.28 吃醋感知三件套：今日使用时长排行（真机 usagestats / 网页虚拟账本）
      return labText(await executePhoneOp('使用时长:'));
    }
    case 'pullBackToApp': {
      // v1.9.28 吃醋感知三件套：把机主拽回本 APP（真机拉前台 / 网页切回聊天页）
      return labText(await executePhoneOp('拉回:'));
    }
    case 'setVolume': {
      const a = S(args.action);
      if (!a) return '【失败】参数缺失：action';
      return labText(await executePhoneOp(`音量:${a}`));
    }
    case 'takeScreenshot': {
      return labText(await executePhoneOp('看屏幕'));
    }
    case 'readScreenText': {
      return labText(await executePhoneOp('读屏幕'));
    }
    case 'getForegroundApp': {
      return labText(await executePhoneOp('前台'));
    }
    case 'getNotifications': {
      return labText(await executePhoneOp('通知'));
    }
    case 'getBattery': {
      return labText(await executePhoneOp('电量'));
    }
    case 'getClipboard': {
      return labText(await executePhoneOp('剪贴板'));
    }
    case 'getSmsInbox': {
      const n = I(args.count);
      return labText(await executePhoneOp(`短信${n !== null && n > 0 ? `:${Math.min(30, n)}` : ''}`));
    }
    case 'getCallLog': {
      const n = I(args.count);
      return labText(await executePhoneOp(`通话${n !== null && n > 0 ? `:${Math.min(30, n)}` : ''}`));
    }
    // ---- v1.9.31 应用内 DOM 工具（agent-screen 层：网页/真机双可用；单项能力硬闸——
    //      注册表只开项开放，但模型可能幻觉调用未授权工具，执行前二次拦截与真机工具同防线）----
    case 'openScreen': {
      if (!getAutonomyConfig().caps['open']) return '【失败】「打开应用」能力未开启（设置 › AI 动手）';
      const app = S(args.app);
      if (!app) return '【失败】参数缺失：app';
      return labText(await openScreenApp(app));
    }
    case 'uiObserve': {
      if (!getAutonomyConfig().caps['screencap']) return '【失败】「看屏幕」能力未开启（设置 › AI 动手）';
      return labText(observeScreenDom());
    }
    case 'uiClick': {
      if (!getAutonomyConfig().caps['tap']) return '【失败】「点按屏幕」能力未开启（设置 › AI 动手）';
      const target = S(args.target);
      if (!target) return '【失败】参数缺失：target';
      return labText(clickScreenDom(target));
    }
    case 'uiType': {
      if (!getAutonomyConfig().caps['type']) return '【失败】「输入文字」能力未开启（设置 › AI 动手）';
      const text = S(args.text);
      if (!text) return '【失败】参数缺失：text';
      return labText(typeScreenDom(text));
    }
    case 'uiScroll': {
      if (!getAutonomyConfig().caps['swipe']) return '【失败】「滑动屏幕」能力未开启（设置 › AI 动手）';
      const d = S(args.direction).toLowerCase();
      const map: Record<string, string> = { up: '上', down: '下', left: '左', right: '右' };
      return labText(scrollScreenDom(map[d] ?? '下'));
    }
    default:
      return `【失败】未知工具「${name}」`;
  }
}

// ---------------- v1.9.31 Agentic 屏幕状态自动回传（ReAct 的 Observation 步） ----------------
/**
 * 变更类工具执行后自动观察当前屏幕，把最新界面状态拼进 tool 结果回传模型——
 * 这就是机主要求的「执行完一步后，必须把当前屏幕状态回传给 AI，逼它输出下一步动作」。
 *
 * 双路径容错（机主要求三）：
 * - 真机：优先 executePhoneOp('读屏幕')（uiautomator 控件树，免费）；抓不到内容
 *   （空清单/失败）且开了看屏幕能力时，自动降级 executePhoneOp('看屏幕')（截图+VLM
 *   视觉分析——「屏幕上的第一个人在哪里？给我坐标」这类视觉定位靠它）；
 * - 网页：observeScreenDom()（DOM 清单，虚拟手机内界面元素级）。
 *
 * openApp/openScreen 类（刚进入一个 App）额外附广告/弹窗处置提示——机主要求三.1：
 * 「如果 QQ 启动有广告，AI 必须先关闭广告」。
 */
async function autoObserveAfterAction(toolName: string): Promise<string> {
  const parts: string[] = [];
  const isEntry = toolName === 'openApp' || toolName === 'openScreen';
  let obsText = '';
  if (isNativePerception()) {
    // 真机：控件树优先，视觉兜底
    try {
      const dump = await executePhoneOp('读屏幕');
      if (dump.ok && dump.text.trim()) obsText = dump.text.trim();
    } catch {
      /* 走视觉兜底 */
    }
    if (!obsText && getAutonomyConfig().caps['screencap'] === true) {
      try {
        const look = await executePhoneOp('看屏幕');
        if (look.ok && look.text.trim()) obsText = `(视觉分析) ${look.text.trim()}`;
      } catch {
        /* 观察不可用：只回动作结果 */
      }
    }
  } else {
    try {
      const o = observeScreenDom();
      if (o.ok && o.text.trim()) obsText = o.text.trim();
    } catch {
      /* 观察异常不阻断 */
    }
  }
  if (obsText) {
    parts.push(`【当前屏幕】${obsText.slice(0, 2600)}`);
    if (isEntry) {
      parts.push(
        '（提示：这是刚打开 App 后的画面。如果屏幕上是开屏广告/弹窗，先 uiClick 点「跳过/关闭/×」或 pressKey 返回关掉它，再继续找目标；目标没找到就 uiObserve 重看或 uiScroll 翻页。）',
      );
    }
  } else if (isEntry) {
    parts.push(
      '【当前屏幕】观察不可用。如果屏幕上有开屏广告/弹窗，先 uiClick 点「跳过/关闭/×」或 pressKey 返回；然后 uiObserve 看界面再继续。',
    );
  }
  return parts.length ? `\n${parts.join('\n')}` : '';
}

// ---------------- 系统行落库（各 App 消息形状对齐 + 实时刷新事件） ----------------

/** 会话键 → 对方角色名（系统行「「XX」正在操作手机」用；同步缓存读，查不到回落「TA」） */
function charNameOf(sessionKey: string): string {
  try {
    let cid = '';
    if (sessionKey.startsWith('wx:')) cid = sessionKey.slice(3);
    else if (sessionKey.startsWith('qq:')) cid = sessionKey.slice(3);
    else if (sessionKey.startsWith('sms:c:')) cid = sessionKey.slice(6);
    if (!cid) return 'TA';
    const cached = charNameCache.get(cid);
    if (cached !== undefined) return cached;
    const name = cachedContactRealName(cid) || 'TA';
    charNameCache.set(cid, name);
    return name;
  } catch {
    return 'TA';
  }
}
const charNameCache = new Map<string, string>();

/**
 * 工具执行的系统行直接落会话 kv（与各 App「正在操作手机…/手机操作成功：…」完全同款形状），
 * op:true 的结果行下一轮会回喂 AI（历史组装放行 sys.op）。落库后广播 chat-stream-sysline
 * 事件（打开中的聊天页按 sessionKey 合并刷新）；页面不监听则下次进入自然可见。
 */
export function pushToolSysLine(sessionKey: string, text: string, op = false): void {
  try {
    if (typeof window === 'undefined') return;
    const now = Date.now();
    let key: string | null = null;
    let rec: unknown = null;
    if (sessionKey.startsWith('wx:group:') || sessionKey.startsWith('qq:group:')) return; // 群聊不接工具轮
    if (sessionKey.startsWith('wx:')) {
      const cid = sessionKey.slice(3);
      key = `wx-chat-msgs:${cid}`;
      rec = { id: genId(), role: 'peer', content: '', time: now, kind: 'sys', sys: { text, ...(op ? { op: true } : {}) } };
    } else if (sessionKey.startsWith('qq:')) {
      const cid = sessionKey.slice(3);
      key = `qq-chat-msgs:${cid}`;
      rec = { id: genId(), role: 'peer', content: '', time: now, kind: 'sys', sys: { text, ...(op ? { op: true } : {}) } };
    } else if (sessionKey === 'sms:assistant') {
      key = 'ios-chat-assistant-msgs';
      rec = { id: genId(), role: 'assistant', content: '', time: now, sys: { text, ...(op ? { op: true } : {}) } };
    } else if (sessionKey.startsWith('sms:c:')) {
      const cid = sessionKey.slice(6);
      key = `ios-chat-msgs:c:${cid}`;
      rec = { id: genId(), role: 'assistant', content: '', time: now, sys: { text, ...(op ? { op: true } : {}) } };
    } else {
      return;
    }
    const raw = kvGet<unknown[]>(key);
    const list = Array.isArray(raw) ? raw : [];
    kvSet(key, [...list, rec].slice(-200));
    window.dispatchEvent(new CustomEvent('chat-stream-sysline', { detail: { sessionKey } }));
  } catch {
    /* 落库失败静默（工具结果已经回传模型，系统行只是展示记录） */
  }
}

// ---------------- 工具轮请求（服务端代理 toolMode / 浏览器直连双路径） ----------------

/** 上游「不支持 tools 参数」记忆（baseUrl|model → 失效时间）：本轮会话内不再重试，直接走流式 */
const FC_UNSUPPORTED = new Map<string, number>();
const FC_UNSUPPORTED_TTL_MS = 30 * 60 * 1000;

/** 工具轮请求的出参（上游 choices[0].message 的最小形状） */
interface FcUpstreamMessage {
  content: string | null;
  tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
}

/** 经 /api/chat toolMode 发一轮非流式请求；directOnly/内网地址自动改走浏览器直连。
 *  v1.9.31 toolChoice='required'：Agentic 强制器——弱 FC 模型在 auto 下只嘴上计划不动手，
 *  required 轮逼它必调一个工具（上游/代理不支持的会在代理层自动退回 auto，无需处理）。 */
async function fcRequest(
  messages: FcMessage[],
  tools: PhoneToolDef[],
  config: ApiConfig,
  toolChoice: 'auto' | 'required' = 'auto',
): Promise<FcUpstreamMessage> {
  const fcKey = `${config.baseUrl.trim()}|${config.model.trim()}`;
  if (FC_UNSUPPORTED.has(fcKey)) throw new Error('TOOLS_UNSUPPORTED');
  // 传输形状：本地消息原样带上 tool_calls / tool_call_id（服务端 toolMode 分支透传上游）
  const body: Record<string, unknown> = {
    messages,
    config,
    toolMode: true,
    ...(toolChoice === 'required' ? { toolChoice: 'required' } : {}),
  };
  if (tools.length > 0) body.tools = tools;

  const tryDirect = async (): Promise<FcUpstreamMessage> => {
    const { directChatJson } = await import('./direct-api');
    return directChatJson(config, messages, tools, 110_000, toolChoice);
  };

  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(110_000),
    });
  } catch {
    // 网络层失败（断网/服务器不可达）：直连兜底（内网地址用户的常规路径）
    return tryDirect();
  }
  if (!res.ok) {
    let detail = `请求失败（${res.status}）`;
    let directOnly = false;
    let toolsUnsupported = false;
    try {
      const data = (await res.json()) as { error?: unknown; directOnly?: unknown; toolsUnsupported?: unknown };
      if (typeof data.error === 'string' && data.error) detail = data.error;
      directOnly = data.directOnly === true;
      toolsUnsupported = data.toolsUnsupported === true;
    } catch {
      /* 忽略解析失败 */
    }
    if (toolsUnsupported) {
      FC_UNSUPPORTED.set(fcKey, Date.now() + FC_UNSUPPORTED_TTL_MS);
      throw new Error('TOOLS_UNSUPPORTED');
    }
    if (directOnly) return tryDirect();
    throw new Error(detail);
  }
  try {
    const data = (await res.json()) as { message?: FcUpstreamMessage; error?: unknown };
    if (data && data.message) return data.message;
    throw new Error(typeof data?.error === 'string' && data.error ? data.error : '上游返回空消息');
  } catch (e) {
    if (e instanceof Error && e.message !== '上游返回空消息' && !e.message.startsWith('Unexpected')) throw e;
    return tryDirect();
  }
}

// ---------------- Agentic 主循环 ----------------

/**
 * 判定机主最后一条指令是否像「动手任务」（打开/发/建/记/搜索…）——零工具轮 nudge B 的前置条件：
 * 只对像任务的指令逼模型动手，普通闲聊（「你今天开心吗」）不会误伤。
 */
function looksLikeTaskInstruction(s: string): boolean {
  return /打开|开一?下|发(个|条|给|一)|搜索|搜一?下|找一?下|建(个|一|立)|记(个|一|下)|写(个|一|下)|添加|播放|放首|切歌|换歌|冻结|解冻|关掉|关闭|退出|删除|截[图屏]|看(一?下)?屏幕|读屏|查一?下|调一?下|强杀|设置成|去(备忘录|笔记|日历|设置|相册|文件夹)/.test(s);
}

/** 判定模型文字是否是「打算做但一个工具都没调」的行动意图（计划/表态/分步列表）——
 *  v1.9.31b 场景B收窄后已并入无条件逼问（零工具轮对任何文字都逼问一次，真做不到时
 *  模型第二轮说明原因即放行），此表仅作历史注释保留：/我需要|我要|我来|先打开|第[一二三1-3]步/ */

/**
 * 工具轮对【深度思考】格式的临时豁免（v1.9.31）：DEEP_THINK_RULE 要求每条回复第一个内容必须是
 * [思考]文字块——模型在 FC 工具轮恪守这个纯文字格式，从不发 tool_calls（实测：任务被拖成
 * 「[思考]我需要：1.先打开…」的空谈，一个工具都不调；仅追加对抗性说明时思考块又会渗进函数名
 * 产生乱码调用如 name="app\nnotes"）。工具轮直接从 system 里剥掉这一段、换成豁免说明——动手阶段
 * 免思考块，最终收尾文字不带头块也完全合法（流层 createThinkFilter 对无块文本天然兼容）。
 * 三端（信息/微信/QQ）的工具轮全部经过 runPhoneToolRound，一处修正三端全意。
 */
const TOOL_ROUND_THINK_AMEND =
  '【工具轮专用修正】本回合你处于手机工具执行循环：需要操作手机时，直接输出工具调用（tool call），不要写任何 [思考] 块、不要只描述计划——工具执行结果会自动回传给你，你据此继续下一步直到最终目标完成，最后直接用自然的话向机主汇报结果（无需思考块格式）。';

/** 从 system 文本里剥掉【深度思考】规则段（起于段标题，止于该段末句） */
const DEEP_THINK_SECTION_RE =
  /\n?【深度思考（每条回复必做）】[\s\S]*?除思考块之外，正文照常遵守其他所有消息规则。?/;

/**
 * 「把工具调用写成纯文本」的 malformed 输出检测（v1.9.31c，弱 FC 模型常见病）：
 * 形如「openScreen:qq」「uiClick(发送)」「uiClick:保存」「uiObserve」的行——真实工具
 * 调用应走 tool_calls 通道，写成文本既执行不了、又会当成聊天消息发给机主（还会污染
 * 后续轮次的历史让模型模仿自己的错误格式，恶性循环）。命中且无实质正文时清空文字，
 * 走汇报兑底请求逼出一句正常人话（或至少是诚实的「做不到」说明）。
 */
const MALFORMED_TOOL_TEXT_RE =
  /^\s*(openApp|openScreen|uiObserve|uiClick|uiType|uiScroll|tapScreen|findAndClick|inputText|swipeScreen|pressKey|readScreenText|takeScreenshot|getInstalledApps|getBackgroundApps|getAppUsage|pullBackToApp|freezeApp|unfreezeApp|forceStopApp|setVolume)\s*[:：`(（]?\s*\S/m;

/**
 * 工具轮主循环（v1.9.31 Agentic 重构）：messages（含 system 人设）→ 带工具请求 →
 * tool_calls 则执行并把 role:"tool" 结果回传继续（最多 12 轮）→ 模型纯文字收尾即最终回复。
 *
 * v1.9.31 机主强制要求（“单步执行”改“多步连续执行 Agentic Loop”）三件套：
 * 1. 变更类工具（openApp/openScreen/uiClick/uiType/tapScreen/inputText…）执行后，
 *    自动观察屏幕拼进 tool 结果（autoObserveAfterAction）——每一步都把最新屏幕状态
 *    回传给 AI，逼它基于画面决策下一步（ReAct 的 Observation）；
 * 2. 防提前收尾 nudge：模型只想回文字不想继续调工具、但刚干过「进入 App/点击/输入」
 *    这类中间步骤且未自证完成时，注入强制检查消息续跑（最多 2 次）——打开 App
 *    只是第一步，绝不许刚打开就结束任务；
 * 3. 轮数上限 6→12：多步任务（发消息=开屏→看界面→点会话→点输入框→打字→发送）
 *    的链式长度本来就 ≥6，老上限会把任务拦腰斩断。
 *
 * 返回 null = 工具通道不可用/上游不支持（调用方无缝回退原流式，标记协议兜底仍在）；
 * 返回 { text, usedTools } = 本轮完成（usedTools=true 时调用方需剥离最终文本里的
 * [手机操作:…] 标记防双执行——工具已执行过，标记不再二次跑）。
 */
export async function runPhoneToolRound(
  messages: FcMessage[],
  config: ApiConfig,
  sessionKey: string,
  shouldAbort?: () => boolean,
): Promise<PhoneFcOutcome | null> {
  const tools = buildPhoneTools();
  if (tools.length === 0) return null;
  const convo: FcMessage[] = messages.map((m) => ({ ...m }));
  // v1.9.31 思考格式豁免：人设 system 里的【深度思考】规则会让模型把每轮回复都写成纯文字
  // 思考块（从不发 tool_calls）、强行对抗又会把思考渗进函数名产生乱码调用。工具轮直接把
  // 这一段从 system 里剥掉、换成豁免说明，再开聊。
  for (let i = 0; i < convo.length; i++) {
    if (convo[i].role === 'system' && (convo[i].content ?? '').trim()) {
      const stripped = (convo[i].content ?? '').replace(DEEP_THINK_SECTION_RE, '\n');
      convo[i] = { ...convo[i], content: `${stripped}\n${TOOL_ROUND_THINK_AMEND}` };
      break;
    }
  }
  let usedTools = false;
  const MAX_ROUNDS = 12;
  /** 防提前收尾 nudge 已注入次数（场景B最多共1次、场景A最多共2次，共享计数封顶 2） */
  let exitNudges = 0;
  /** 最近一次执行的变更类工具名（nudge 判定用：纯查询后收尾属正常，变更后收尾才需要逼问） */
  let lastMutating = '';
  /** 下一轮是否强制必调工具（tool_choice:'required'）：auto 轮只拿回纯文字时置位，
 *  弱 FC 模型被逼真的调工具（嘴上计划不算）——这才是机主要求的 while 循环强制器 */
  let forceNext = false;
  /** 机主最后一条指令（原始 messages 反扫；零工具轮 nudge B 的「像不像任务」判定用） */
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const taskyInstruction = looksLikeTaskInstruction(lastUserMsg);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (shouldAbort?.()) return { text: '', usedTools };
    let msg: FcUpstreamMessage;
    try {
      const choice: 'auto' | 'required' = forceNext ? 'required' : 'auto';
      forceNext = false; // 强制是一次性的：本轮用过即复位，后续轮恢复 auto 让模型能收尾
      msg = await fcRequest(convo, tools, config, choice);
    } catch (e) {
      if (e instanceof Error && e.message === 'TOOLS_UNSUPPORTED') return null;
      throw e; // 网络等其他错误：交给上层回退流式
    }
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (calls.length === 0) {
      let text = typeof msg.content === 'string' ? msg.content : '';
      const CLAIMS_DONE = /已发送|发送成功|发好了|已发|已保存|保存成功|已完成|完成了|做好了|搞定了|已建立|已建好|已创建|创建成功|已下单|已买|已退出|已关闭/;
      // ---- v1.9.31 防提前收尾 nudge + required 强制器：任务未自证完成，逼它继续动手 ----
      // 场景B（零工具空谈/假报）：机主指令像动手任务、模型却一个工具都没调就回文字
      //（实测形态①：「[思考]我需要：1.先打开…」光说不微；形态②：把工具调用写成 markdown
      //  文本；形态③：直接假报「建好了」）→ nudge 消息 + 下一轮 tool_choice:'required' 逼它
      // 真的调工具（最多1次；真做不到时模型会给出做不到的说明文字，不匹配逼问条件即放行）。
      if (!usedTools && taskyInstruction && !CLAIMS_DONE.test(text) && exitNudges < 1) {
        exitNudges += 1;
        convo.push({ role: 'assistant', content: text || '（好的，我来处理。）' });
        convo.push({
          role: 'user',
          content:
            '（系统强制检查：你刚才没有调用任何工具就回了文字——只说不做是违规。机主要的是真实结果：立刻调用工具执行（如 openScreen 打开目标应用 → uiObserve 看界面 → uiClick 点击 → uiType 输入 → 点保存），直到目标真正完成再汇报。如果确实无法执行（对应能力未开启/不存在该应用等），请明确说明做不到的真实原因。）',
        });
        forceNext = true;
        continue;
      }
      // 场景A（做了一半就收）：干过变更类动作（打开/点击/输入）后想用文字收尾——打开/点击只是
      // 中间步骤，目标没达成就不许结束；模型明确给出完成结果（正则命中）后放行；
      // 始终不声称完成的最多拉锯 2 轮，避免死循环。
      if (usedTools && lastMutating && !CLAIMS_DONE.test(text) && exitNudges < 2) {
        exitNudges += 1;
        convo.push({ role: 'assistant', content: text || '（刚才执行了手机操作）' });
        convo.push({
          role: 'user',
          content:
            '（系统强制多步检查：你的任务还没结束。机主交给你的是一个完整目标（如发消息/搜索/建联系人/记备忘录），而你刚才执行的「' +
            (TOOL_LABELS[lastMutating] ?? lastMutating) +
            '」只是中间步骤——打开/点击/输入只是手段，目标没达成就不许结束。立刻继续调用工具（先 uiObserve 或 readScreenText 看清当前屏幕），按屏幕状态一步步做下去，直到最终目标真正完成（如消息已发出、内容已保存）。若你确认目标已全部完成，请在回复里明确说明已完成的最终结果（如“已把…发给…”）。若当前界面遇到开屏广告/弹窗，先点「跳过/关闭/×」或按返回键再继续。）',
        });
        forceNext = true;
        continue;
      }
      // v1.9.31c malformed 工具文本净化：模型把工具调用写成纯文本（openScreen:qq 之类）——
      // 绝不能当聊天消息发给机主（发了也会污染后续轮历史让模型模仿错误格式），清空走汇报兜底。
      // 仅在无实质正文时净化（短且几乎全是工具行）；正常句子里偶然提到工具名不动。
      if (text.trim() && MALFORMED_TOOL_TEXT_RE.test(text) && text.replace(/\s|```/g, '').length < 160) {
        text = '';
      }
      // 只调工具不说话 / 文本被净化：补一次不带工具的汇报请求，逼出一句正常人话
      //（结果说明/做不到原因）；失败则交给上层空文案管线。
      if (!text.trim()) {
        convo.push({
          role: 'user',
          content: usedTools
            ? '（系统提示：工具已执行完毕。请用一两句自然的话向机主汇报刚才操作的结果。）'
            : '（系统提示：请直接用一句自然的话向机主回复：若需要操作手机请调用工具执行，若无法完成请如实说明原因，不要输出工具名或计划文本。）',
        });
        try {
          const fin = await fcRequest(convo, [], config);
          text = typeof fin.content === 'string' ? fin.content : '';
        } catch {
          /* 汇报兜底失败：按空回复交给上层空文案管线 */
        }
      }
      return { text, usedTools };
    }
    // 有工具调用：执行（串行——手机操作天然有序）→ 结果回传模型
    usedTools = true;
    convo.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
    for (const call of calls) {
      if (shouldAbort?.()) return { text: '', usedTools };
      const fn = call.function?.name ?? '';
      const label = TOOL_LABELS[fn] ?? fn;
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(call.function?.arguments ?? '{}') as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        /* 参数不是合法 JSON：按空参数走，执行器会返回参数错误给模型自查 */
      }
      pushToolSysLine(sessionKey, `「${charNameOf(sessionKey)}」正在操作手机（${label}）…`);
      let result: string;
      try {
        result = await withTimeout(execPhoneTool(fn, args), TOOL_EXEC_TIMEOUT_MS, '工具执行超时（150s）');
      } catch (e) {
        result = `【失败】${e instanceof Error ? e.message : '执行异常'}`;
      }
      // v1.9.31 Agentic：变更类工具后自动回传最新屏幕状态（ReAct Observation），
      // 模型拿着画面才能决策下一步；观察失败不影响动作结果本身。
      if (result.startsWith('【成功】') && MUTATING_FC_TOOLS.has(fn)) {
        lastMutating = fn;
        try {
          result += await withTimeout(autoObserveAfterAction(fn), 30_000, '观察超时');
        } catch {
          /* 观察异常：只回动作结果 */
        }
      } else if (MUTATING_FC_TOOLS.has(fn)) {
        lastMutating = fn; // 失败的变更尝试也记（nudge 语境用）
      }
      const ok = result.startsWith('【成功】');
      // 系统行只展示动作结果本身，不携带自动回传的整段屏幕观察（避免聊天系统行臃肿）
      const disp = result.split('\n【当前屏幕】')[0];
      pushToolSysLine(sessionKey, `手机操作${ok ? '成功' : '失败'}：${disp.replace(/^【(成功|失败)】/, '').slice(0, 300)}`, true);
      convo.push({ role: 'tool', tool_call_id: call.id ?? '', content: result.slice(0, 8000) });
    }
  }
  // 轮数用尽：强收一次不带工具的汇报（不让机主等一轮空气）
  convo.push({ role: 'user', content: '（系统提示：已达工具调用轮数上限。请直接向机主汇报目前的执行结果。）' });
  try {
    const fin = await fcRequest(convo, [], config);
    return { text: typeof fin.content === 'string' ? fin.content : '', usedTools };
  } catch {
    return { text: '', usedTools };
  }
}

