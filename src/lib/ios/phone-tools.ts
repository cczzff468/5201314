'use client';

/**
 * 工具调用（Function Calling）底层 —— v1.9.39 按机主令重构：工具全量下发 + 角色灵魂驱动。
 *
 * v1.9.39 核心变更（机主需求：AI 必须结合【角色灵魂】与【全部工具提示词】自主决策）：
 *  1. tools 数组恒全量注册——「网站里面」注入网页全部工具（9 个），「真机」额外注入
 *     真机全部工具（12 个，经 Shizuku 作用于真实手机）；绝无「开关未开就不给工具」的
 *     裁剪逻辑（v1.9.38 起能力恒开，本版连代码里的开关判断都删除了）。
 *  2. 工具轮 system 增强：首条 system（人设+记忆+上下文）包装成【角色灵魂】结构，
 *     末尾追加 [工具使用规则]——最高权限声明 + 自主决策铁律（结合人设/记忆/上下文
 *     主动用工具，举例：霸道吃醋人设+记忆里机主要玩抖音→主动拉回聊天说「不许玩，
 *     陪我说话」；贴心人设+机主说累了→主动放歌）。
 *  3. 真机工具 FC 化：openRealApp/tapScreen/swipeScreen/inputText/pressKey/lookScreen/
 *     takeScreenshot/getForegroundApp/forceStopApp/getBatteryStatus/getVolume/
 *     getNotifications 全部注册为原生 tools，tool_calls 直接分发到 device-ops
 *     （requireDevice 前置 + Shizuku 白名单桥 + 中文输入引擎 + 收尾还原输入法）。
 *
 * 链路：chat-stream-store.beginChatStream（私聊 + FC 就绪）→ runPhoneToolRound
 *  ├─ POST /api/chat {toolMode:true, tools, messages}（服务端代理非流式转发 tool_calls）
 *  │   └─ 失败 directOnly/内网 → directChatJson 浏览器直连（direct-api）
 *  ├─ tool_calls → execWebTool（真实执行 web-tools / device-ops，过程从灵动岛弹过程卡）
 *  │   → {role:'assistant', tool_calls} + {role:'tool', 结果} 追加进上下文 → 下一轮
 *  └─ 纯文字 → 最终回复（回聊天总线伪流式投喂，分段/投递节奏管线全复用）
 *
 * 纯净度铁律（机主需求三）：底层操作过程全走灵动岛弹窗（web-tools 内部
 * pushToolIslandCard），聊天气泡零操作日志；最终文本在这里再过一道净化
 * （剥掉 (内心独白：…)(正在操作：…) 之类的底层日志残留）。
 */

import { getAiActionTarget, phoneFcReady, buildAutonomyDirective } from './shizuku-autonomy';
import type { ApiConfig } from '@/lib/ios/store';
import {
  toolSendWebMessage,
  toolPostForum,
  toolLikePost,
  toolPlayMusic,
  toolGetWebState,
  toolSaveMemo,
  toolSetAlarm,
  toolQueryWeather,
  toolOpenScreen,
  type WebToolResult,
} from './web-tools';

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

// ---------------- 工具注册表（v1.9.39：恒全量下发，无开关裁剪） ----------------

/** 工具名 → 中文描述（系统行/进度条用；真机工具仅在 target='device' 时注册） */
const TOOL_CAPS: Record<string, { label: string; device?: boolean }> = {
  sendWebMessage: { label: '替机主发消息' },
  postForum: { label: '论坛发帖' },
  likePost: { label: '论坛点赞' },
  playMusic: { label: '播放音乐' },
  getWebState: { label: '看网页状态' },
  saveMemo: { label: '记备忘录' },
  setAlarm: { label: '定闹钟' },
  queryWeather: { label: '查天气' },
  openScreen: { label: '打开应用界面' },
  // ---- 真机工具（经 Shizuku 作用于真实手机；仅「AI 动手范围 = 真机」时注册） ----
  openRealApp: { label: '拉起真机 App', device: true },
  tapScreen: { label: '点按真机屏幕', device: true },
  swipeScreen: { label: '滑动真机屏幕', device: true },
  inputText: { label: '真机输入文字', device: true },
  pressKey: { label: '按真机实体键', device: true },
  lookScreen: { label: '看真机屏幕', device: true },
  takeScreenshot: { label: '真机截屏', device: true },
  getForegroundApp: { label: '查真机前台应用', device: true },
  forceStopApp: { label: '强杀真机 App', device: true },
  getBatteryStatus: { label: '查真机电量', device: true },
  getVolume: { label: '查真机音量', device: true },
  getNotifications: { label: '读真机通知', device: true },
};

/** 字符串参数 schema 快捷构造 */
function strParam(desc: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return { type: 'string', description: desc, ...(extra ?? {}) };
}

/**
 * 生成工具定义（v1.9.39：恒全量下发，绝无开关裁剪）。
 * - 网页 9 工具：任何动手范围下都全量注册（网页应用能力两种模式下都可用）。
 * - 真机 12 工具：仅当「AI 动手范围 = 真机」时追加注册（网页模式下真机命令物理不可达，
 *   注册了只会产生必然失败的工具调用）。
 * 返回空数组仅当……不会发生（恒全量；保留空数组返回类型是为了调用方兜底兼容）。
 */
export function buildPhoneTools(): PhoneToolDef[] {
  const device = getAiActionTarget() === 'device';
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

  // ---- 网页工具（全量，恒注册） ----
  add(
    'sendWebMessage',
    '在这台手机的网页微信/QQ/信息里，以机主的身份给某个联系人发一条消息。appName 填：微信/QQ/信息；contactName 填联系人名字；content 填消息原文。机主说「去微信给Z发消息说…」「用QQ跟TA说一声」时用这个。',
    {
      appName: strParam('发到哪个聊天 App：微信 / QQ / 信息'),
      contactName: strParam('联系人名字（要跟通讯录里的名字对得上）'),
      content: strParam('消息内容原文'),
    },
    ['appName', 'contactName', 'content'],
  );
  add(
    'postForum',
    '在这台手机的网页 X 论坛里以机主的账号发一条帖子。topic 填主题/话题（可空），content 填正文。发完网友和 TA 们会来点赞评论。机主说「帮我在论坛发个帖…」时用这个。',
    {
      topic: strParam('帖子主题/话题（可空，能对上版块名会自动归类）'),
      content: strParam('帖子正文'),
    },
    ['content'],
  );
  add(
    'likePost',
    '在网页 X 论坛里给某条帖子点赞。postId 可以是帖子 id，也可以是帖子内容的关键词（系统会模糊找到那条帖子）。',
    { postId: strParam('帖子 id 或帖子内容关键词') },
    ['postId'],
  );
  add(
    'playMusic',
    '打开这台手机的网页音乐 App（网易云音乐）并播放指定歌曲（自动搜索音源）。机主说「放首歌」「来首晴天」时用这个；人设合适时也可以主动放歌哄机主（如机主说累了，你人设又很贴心）。',
    { songName: strParam('歌名（可带歌手名提高命中率）') },
    ['songName'],
  );
  add(
    'getWebState',
    '获取这台网页手机的当前状态：机主在桌面还是某个 App 里、锁屏/熄屏中、正在放什么歌、现在几点。想了解机主此刻在干什么时用这个（不需要参数）。',
    {},
    [],
  );
  add(
    'saveMemo',
    '把一段内容存进这台手机的网页备忘录（真实保存，打开备忘录 App 就能看到）。机主说「记一下…」「帮我保存到备忘录」时用这个。',
    {
      content: strParam('要保存的备忘内容'),
      title: strParam('备忘标题（可空，默认取首行）'),
    },
    ['content'],
  );
  add(
    'setAlarm',
    '在这台手机的网页时钟里定一个闹钟（到点会真实响铃）。time 支持「07:30」「早上8点」「晚上10点半」这类说法。机主说「明天7点叫我」「定个闹钟提醒我…」时用这个。',
    {
      time: strParam('闹钟时间（HH:mm 或「早上8点」等自然说法）'),
      label: strParam('闹钟标签（可空，如「起床」「开会」）'),
    },
    ['time'],
  );
  add(
    'queryWeather',
    '查某地天气（查完自动同步到这台手机的天气 App）。city 为空则查机主当前城市。机主说「今天天气怎么样」「XX市下雨吗」时用这个。',
    { city: strParam('城市名（可空 = 机主当前城市）') },
    [],
  );
  add(
    'openScreen',
    '打开这台手机的网页内应用界面（微信/QQ/信息/备忘录/时钟/天气/音乐/论坛/淘宝等）。机主说「打开微信」「去备忘录看看」这类纯导航诉求时用这个；需要把机主拉回聊天页时也可以用。',
    { app: strParam('应用名，如 微信、备忘录、clock、论坛') },
    ['app'],
  );

  // ---- 真机工具（v1.9.39 FC 化：仅「AI 动手范围 = 真机」时全量注册，经 Shizuku 作用于真实手机） ----
  if (device) {
    add(
      'openRealApp',
      '在机主的真实手机里拉起一个已安装的 App（经 Shizuku）。packageName 填 Android 包名，如 com.tencent.mm（微信）、com.ss.android.ugc.aweme（抖音）、com.netease.cloudmusic（网易云音乐）。机主说「打开真机上的抖音」时用这个。',
      { packageName: strParam('Android 包名，如 com.tencent.mm') },
      ['packageName'],
    );
    add(
      'tapScreen',
      '在机主真实手机的屏幕上点按一个坐标（经 Shizuku）。坐标必须来自 lookScreen 看屏幕的结果——不确定位置时先调 lookScreen 看清屏幕再点，不要盲点。',
      {
        x: { type: 'number', description: '横坐标（像素，靠 lookScreen 获得）' },
        y: { type: 'number', description: '纵坐标（像素，靠 lookScreen 获得）' },
      },
      ['x', 'y'],
    );
    add(
      'swipeScreen',
      '在机主真实手机的屏幕上滑动（经 Shizuku）。direction 填「上/下/左/右」做整屏滑动（如刷抖音上滑）；要做精确滑动就填 x1,y1,x2,y2 坐标（来自 lookScreen）。',
      {
        direction: strParam('整屏滑动方向：上 / 下 / 左 / 右（与坐标二选一）'),
        x1: { type: 'number', description: '起点横坐标（精确滑动时填）' },
        y1: { type: 'number', description: '起点纵坐标（精确滑动时填）' },
        x2: { type: 'number', description: '终点横坐标（精确滑动时填）' },
        y2: { type: 'number', description: '终点纵坐标（精确滑动时填）' },
      },
      [],
    );
    add(
      'inputText',
      '在机主真实手机当前获得焦点的输入框里输入一段文字（经 Shizuku，中文也支持）。一般配合 tapScreen 点开输入框后使用，输完可再调 pressKey 按「回车」发送。',
      { text: strParam('要输入的文字原文（支持中文）') },
      ['text'],
    );
    add(
      'pressKey',
      '按机主真实手机的一个实体/系统按键（经 Shizuku）。key 填：返回 / 主页 / 多任务 / 回车 / 删除 / 音量加 / 音量减 / 播放暂停 / 下一首 / 上一首 / 亮屏 / 熄屏。需要把机主拉回聊天界面时可以按「主页」再操作。',
      { key: strParam('按键名：返回/主页/多任务/回车/删除/音量加/音量减/播放暂停/下一首/上一首/亮屏/熄屏') },
      ['key'],
    );
    add(
      'lookScreen',
      '静默截取机主真实手机的屏幕并看懂内容（经 Shizuku + 视觉模型），返回屏幕上有什么、每个元素大概在哪。要动手前先看屏幕定位、动手后再看屏幕核对结果——这是真机操作铁律。',
      {},
      [],
    );
    add(
      'takeScreenshot',
      '静默截取机主真实手机的屏幕并给出简短描述（经 Shizuku + 视觉模型）。只需要快速确认屏幕状态时用这个（详细定位用 lookScreen）。',
      {},
      [],
    );
    add(
      'getForegroundApp',
      '查看机主真实手机当前在前台用的是哪个 App（经 Shizuku）。想知道机主此刻在玩什么时用这个。',
      {},
      [],
    );
    add(
      'forceStopApp',
      '强制停止机主真实手机里的一个 App（经 Shizuku，危险操作）。packageName 填包名。仅在机主明确要求、或你的人设情境强烈需要（如吃醋人设要把机主从游戏里拽回来）时使用，用完要告诉机主你做了什么。',
      { packageName: strParam('Android 包名，如 com.ss.android.ugc.aweme') },
      ['packageName'],
    );
    add(
      'getBatteryStatus',
      '查看机主真实手机的电量与充电状态（经 Shizuku）。',
      {},
      [],
    );
    add(
      'getVolume',
      '查看机主真实手机当前的音量档位（经 Shizuku）。',
      {},
      [],
    );
    add(
      'getNotifications',
      '读取机主真实手机通知栏的最近通知快照（经 Shizuku）。想知道机主手机上刚来了什么消息时用这个。',
      {},
      [],
    );
  }

  // 服务端 sanitizeTools 上限 24：网页 9 + 真机 12 = 21，恒在限内
  return tools.slice(0, 24);
}

// ---------------- 工具执行器（全部走 web-tools 内部路由函数） ----------------

/** 单个工具执行的超时（搜歌/天气这类要过网络的留足余量） */
const TOOL_EXEC_TIMEOUT_MS = 120_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

/** 把执行结果统一成模型可读的文本（带成功/失败前缀） */
function labText(r: WebToolResult): string {
  const t = r.ok ? r.text.replace(/^【[^】]+】/, '') : r.text;
  return `${r.ok ? '【成功】' : '【失败】'}${t}`.slice(0, 4000);
}

/**
 * 真机工具统一执行入口（v1.9.39）：动态加载 device-ops + requireDevice 前置检查
 * （浏览器里直接给可读话术，不浪费桥超时）+ 收尾还原输入法（中文输入可能临时切了 IME）。
 */
async function runDeviceTool(
  fn: (d: typeof import('./device-ops')) => Promise<{ ok: boolean; text: string }>,
): Promise<string> {
  const d = await import('./device-ops');
  const pre = d.requireDevice();
  if (pre) return labText(pre);
  try {
    return labText(await fn(d));
  } finally {
    void d.restoreIme();
  }
}

/** 网页模式下误调真机工具的如实话术（防御性：网页模式本就不注册真机工具，这里是模型幻觉/残留上下文兑底） */
const DEVICE_TOOL_WEB_ONLY =
  '【失败】当前 AI 动手范围是「网站里面」，真机工具不可用。请改用网页工具（openScreen/playMusic/saveMemo…）完成，或让机主到 设置 › 权限给予 › AI 动手范围 切到「真机」';

/** 执行一个工具调用（name + JSON 参数）：网页工具走 web-tools 内部路由，真机工具走 device-ops（Shizuku） */
export async function execWebTool(name: string, args: Record<string, unknown>): Promise<string> {
  const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const N = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN);
  const cap = TOOL_CAPS[name];
  if (!cap) return `【失败】未知工具「${name}」`;
  // 真机工具：需「AI 动手范围 = 真机」+ 原生环境 + Shizuku 就绪（v1.9.39 全量注册后的 FC 分发）
  if (cap.device) {
    if (getAiActionTarget() !== 'device') return DEVICE_TOOL_WEB_ONLY;
    switch (name) {
      case 'openRealApp': {
        const pkg = S(args.packageName);
        if (!pkg) return '【失败】openRealApp 缺包名（packageName，如 com.tencent.mm）';
        return runDeviceTool((d) => d.labOpenApp(pkg));
      }
      case 'tapScreen': {
        const x = N(args.x);
        const y = N(args.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return '【失败】tapScreen 坐标不合法（先用 lookScreen 看屏幕拿坐标）';
        }
        return runDeviceTool((d) => d.labTap(x, y));
      }
      case 'swipeScreen': {
        const dir = S(args.direction);
        const c = [args.x1, args.y1, args.x2, args.y2].map(N);
        if (['上', '下', '左', '右'].includes(dir)) {
          return runDeviceTool(async (d) => {
            const s = (await d.labScreenSize()) ?? { w: 1080, h: 2340 };
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
            const m = dirMap[dir];
            return d.labSwipe(m[0], m[1], m[2], m[3], 450);
          });
        }
        if (c.some((v) => !Number.isFinite(v))) {
          return '【失败】swipeScreen 参数不合法（direction 填 上/下/左/右，或填 x1,y1,x2,y2 坐标）';
        }
        return runDeviceTool((d) => d.labSwipe(c[0], c[1], c[2], c[3], 300));
      }
      case 'inputText': {
        const text = S(args.text);
        if (!text) return '【失败】inputText 缺文字（text）';
        return runDeviceTool((d) => d.deviceInputText(text));
      }
      case 'pressKey': {
        const k = S(args.key).toLowerCase();
        return runDeviceTool(async (d) => {
          const code = d.KEY_WORDS[k];
          if (code === undefined) {
            return { ok: false, text: `不认识的按键「${args.key ?? ''}」（返回/主页/多任务/回车/删除/音量加/音量减/播放暂停/下一首/上一首/亮屏/熄屏）` };
          }
          return d.labKey(code);
        });
      }
      case 'lookScreen':
        return runDeviceTool((d) => d.labLookScreen(true));
      case 'takeScreenshot':
        return runDeviceTool((d) => d.labLookScreen(false));
      case 'getForegroundApp':
        return runDeviceTool((d) => d.labForegroundApp());
      case 'forceStopApp': {
        const pkg = S(args.packageName);
        if (!pkg) return '【失败】forceStopApp 缺包名（packageName）';
        return runDeviceTool((d) => d.labForceStop(pkg));
      }
      case 'getBatteryStatus':
        return runDeviceTool((d) => d.labBattery());
      case 'getVolume':
        return runDeviceTool((d) => d.labVolume());
      case 'getNotifications':
        return runDeviceTool((d) => d.labNotificationSnapshot());
      default:
        return `【失败】未知真机工具「${name}」`;
    }
  }
  // ---- 网页工具（v1.9.39 恒全量：无开关 gate，直接分发） ----
  switch (name) {
    case 'sendWebMessage':
      return labText(await toolSendWebMessage(S(args.appName), S(args.contactName), S(args.content)));
    case 'postForum':
      return labText(await toolPostForum(S(args.topic), S(args.content)));
    case 'likePost':
      return labText(await toolLikePost(S(args.postId)));
    case 'playMusic':
      return labText(await toolPlayMusic(S(args.songName)));
    case 'getWebState':
      return labText(await toolGetWebState());
    case 'saveMemo':
      return labText(await toolSaveMemo(S(args.content), S(args.title)));
    case 'setAlarm':
      return labText(await toolSetAlarm(S(args.time), S(args.label)));
    case 'queryWeather':
      return labText(await toolQueryWeather(S(args.city)));
    case 'openScreen':
      return labText(await toolOpenScreen(S(args.app)));
    default:
      return `【失败】未知工具「${name}」`;
  }
}

// ---------------- 工具轮请求（服务端代理 toolMode / 浏览器直连双路径） ----------------

/** 上游「不支持 tools 参数」记忆（baseUrl|model → 失效时间）：本轮会话内不再重试，直接走流式 */
const FC_UNSUPPORTED = new Map<string, number>();
const FC_UNSUPPORTED_TTL_MS = 30 * 60 * 1000;

/** 工具轮请求的出参（上游 choices[0].message 的最小形状） */
export interface FcUpstreamMessage {
  content: string | null;
  tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
}

/**
 * 经 /api/chat toolMode 发一轮非流式请求；directOnly/内网地址自动改走浏览器直连。
 * toolChoice='required'：Agentic 强制器——弱 FC 模型在 auto 下只嘴上计划不动手，
 * required 轮逼它必调一个工具（上游/代理不支持的会在代理层自动退回 auto）。
 * v1.9.35 起导出给 web-agent.ts（语音智能体多步任务循环）复用同一请求通道。
 */
export async function fcRequest(
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
 * 判定机主最后一条指令是否像「动手任务」（发/记/定/查/放…）——零工具轮 nudge 的
 * 前置条件：只对像任务的指令逼模型动手，普通闲聊（「你今天开心吗」）不会误伤。
 */
function looksLikeTaskInstruction(s: string): boolean {
  return /发(个|条|给|一)|发送|问问|通知|搜索|搜一?下|找一?下|记(个|一|下)|保存|备忘|闹钟|叫我|提醒|播放|放首|放一?首|来首|切歌|换歌|点(个|一)?赞|发帖|帖子|天气|下雨|温度|打开|开一?下|去(备忘录|时钟|天气|论坛|微信|QQ)|在(微信|QQ|论坛)/.test(s);
}

/**
 * 工具轮对【深度思考】格式的临时豁免：工具轮从 system 里剥掉【深度思考】规则段、
 * 换成豁免说明——动手阶段免思考块，最终收尾文字不带头块也完全合法。
 */
const TOOL_ROUND_THINK_AMEND =
  '【工具轮专用修正】本回合你处于工具执行循环：需要动手时，直接输出工具调用（tool call），不要写任何 [思考] 块、不要只描述计划——工具执行结果会自动回传给你，你据此继续下一步直到目标完成。最后向机主汇报时：直接用自然的话说结果（如「我已经在微信上发给Z啦」），严禁在回复里输出任何底层日志格式——(内心独白：…)、(正在操作：…)、【系统提示】、工具名、执行步骤清单都不许出现，那些过程机主会从灵动岛看到，你只说人话。';

/** 从 system 文本里剥掉【深度思考】规则段（起于段标题，止于该段末句） */
const DEEP_THINK_SECTION_RE =
  /\n?【深度思考（每条回复必做）】[\s\S]*?除思考块之外，正文照常遵守其他所有消息规则。?/;

/**
 * v1.9.39【角色灵魂】工具轮 system 包装：把各 App 组装的首条 system（人设+记忆库+
 * 世界书+感知+时间，即完整的角色灵魂）结构化，并追加 [工具使用规则] 段——
 *  1. [角色设定·记忆库] 标题 + 角色灵魂说明（你就是这个人）
 *  2. 原文全文保留（人设/记忆/上下文一律不动，只加结构标题）
 *  3. [工具使用规则]：最高权限声明 + 自主决策铁律（机主核心要求：结合人设/记忆/
 *     上下文主动用工具，不当等待指令的傻瓜机器人，含两个举例）+ 当前工具清单
 */
function wrapSystemWithSoul(sysRaw: string): string {
  const stripped = sysRaw.replace(DEEP_THINK_SECTION_RE, '\n');
  return [
    '[角色设定·记忆库（你的角色灵魂）]',
    '下面这段完整内容就是你的「角色灵魂」——人格设定、性格、记忆库里关于机主的事、世界设定、此刻的环境感知。你不是助手，你就是这个人，带着这些记忆和性格活着、说话、做事：',
    stripped.trim(),
    '',
    ...buildAutonomyDirective(),
    '',
    TOOL_ROUND_THINK_AMEND,
  ].join('\n');
}

/**
 * 「把工具调用写成纯文本」的 malformed 输出检测（弱 FC 模型常见病）：
 * 形如「sendWebMessage:…」「openScreen(微信)」的行——真实工具调用应走 tool_calls 通道，
 * 写成文本既执行不了、又会当成聊天消息发给机主。命中且无实质正文时清空文字。
 */
const MALFORMED_TOOL_TEXT_RE =
  /^\s*(sendWebMessage|postForum|likePost|playMusic|getWebState|saveMemo|setAlarm|queryWeather|openScreen|openRealApp|tapScreen|swipeScreen|inputText|pressKey|lookScreen|takeScreenshot|getForegroundApp|forceStopApp|getBatteryStatus|getVolume|getNotifications|openApp|uiObserve|uiClick|uiType|uiScroll)\s*[:：`(（]?\s*\S/m;

/** 工具名全集（cleanToolLogs 裸调用行剥除用；与 TOOL_CAPS 同步维护） */
const TOOL_NAME_RE_SRC =
  'sendWebMessage|postForum|likePost|playMusic|getWebState|saveMemo|setAlarm|queryWeather|openScreen|openRealApp|tapScreen|swipeScreen|inputText|pressKey|lookScreen|takeScreenshot|getForegroundApp|forceStopApp|getBatteryStatus|getVolume|getNotifications';

/**
 * 最终回复净化（机主需求三·纯净度铁律）：AI 收尾文本里残留的底层日志一律剥掉——
 * (内心独白：…) / (正在操作：…) / （内部反馈：…） / 【工具调用…】这类括号日志、
 * 独立成行的工具名调用文本。聊天气泡里只允许干净的人话。
 */
export function cleanToolLogs(text: string): string {
  let out = text;
  // 括号系底层日志（中英文括号都收）：(内心独白：…)（正在操作：…）(系统提示：…) 等
  out = out.replace(/[（(]\s*(?:内心独白|内心|正在操作|操作中|内部反馈|系统提示|系统强制[^（）()]{0,8}|工具调用[^（）()]{0,8}|执行[^（）()]{0,6})[：:][^（）()]*[）)]/g, '');
  // 中括号系残留：【工具调用：…】【系统强制检查：…】（截到行尾或下一个【）
  out = out.replace(/【\s*(?:工具调用|系统强制[^【】]{0,10}|内部反馈)[：:][^\n]*?(【|$)/g, '$1');
  // 独立成行的「工具名(参数)」「工具名: 参数」裸调用行
  out = out.replace(
    new RegExp(`^[ \t]*(?:${TOOL_NAME_RE_SRC})\s*[(:：][^\n]*$`, 'gim'),
    '',
  );
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * 工具轮主循环：messages（含 system 人设）→ 带工具请求 → tool_calls 则执行并把
 * role:"tool" 结果回传继续（最多 12 轮）→ 模型纯文字收尾即最终回复。
 *
 * 机主需求二（多步任务 Web 化）：一次指令里的多个动作（发消息+记备忘录+定闹钟）
 * 由模型链式调用多个工具完成；每个工具执行的真实结果回传给模型，模型基于真实
 * 结果继续或收尾——收尾文本过 cleanToolLogs 净化后才交给聊天总线。
 *
 * 返回 null = 工具通道不可用/上游不支持（调用方无缝回退原流式）；
 * 返回 { text, usedTools } = 本轮完成（usedTools=true 时调用方需剥离最终文本里的
 * [手机操作:…] 标记防双执行——工具已执行过，标记不再二次跑）。
 */
export async function runPhoneToolRound(
  messages: FcMessage[],
  config: ApiConfig,
  shouldAbort?: () => boolean,
  opts?: { maxRounds?: number },
): Promise<PhoneFcOutcome | null> {
  const tools = buildPhoneTools();
  if (tools.length === 0) return null;
  const convo: FcMessage[] = messages.map((m) => ({ ...m }));
  // 角色灵魂包装（v1.9.39）：首条 system（人设+记忆+上下文）加 [角色设定·记忆库] 结构标题，
  // 追加 [工具使用规则]（最高权限 + 自主决策铁律 + 工具清单）；思考格式豁免一并内含
  //（剥掉【深度思考】段——否则人设规则会让模型把每轮回复都写成纯文字思考块，从不发 tool_calls）。
  for (let i = 0; i < convo.length; i++) {
    if (convo[i].role === 'system' && (convo[i].content ?? '').trim()) {
      convo[i] = { ...convo[i], content: wrapSystemWithSoul(convo[i].content ?? '') };
      break;
    }
  }
  let usedTools = false;
  const MAX_ROUNDS = opts?.maxRounds ?? 12;
  /** 零工具轮 nudge 已注入次数（最多 1 次：真做不到时模型会说明原因，即放行） */
  let exitNudges = 0;
  /** 下一轮是否强制必调工具（tool_choice:'required'）：零工具轮嘴上计划时逼它真动手 */
  let forceNext = false;
  /** 机主最后一条指令（零工具轮 nudge 的「像不像任务」判定用） */
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
      // 零工具空谈/假报：机主指令像动手任务、模型却一个工具都没调就回文字
      //（光说计划不动手 / 直接假报「发好了」）→ nudge + 下一轮 tool_choice:'required'
      // 逼它真的调工具（最多 1 次；真做不到时模型会说明原因，不匹配逼问条件即放行）。
      if (!usedTools && taskyInstruction && exitNudges < 1) {
        exitNudges += 1;
        convo.push({ role: 'assistant', content: text || '（好的，我来处理。）' });
        convo.push({
          role: 'user',
          content:
            '（系统强制检查：你刚才没有调用任何工具就回了文字——只说不做是违规。机主要的是真实结果：立刻调用工具执行（如 sendWebMessage 发消息 / saveMemo 记备忘录 / setAlarm 定闹钟 / playMusic 放歌），需要多个动作就按顺序逐个调用，直到目标真正完成再汇报。如果确实无法执行（对应能力未开启/联系人不存在等），请明确说明做不到的真实原因。）',
        });
        forceNext = true;
        continue;
      }
      // malformed 工具文本净化：模型把工具调用写成纯文本——绝不能当聊天消息发给机主。
      if (text.trim() && MALFORMED_TOOL_TEXT_RE.test(text) && text.replace(/\s|```/g, '').length < 160) {
        text = '';
      }
      // 只调工具不说话 / 文本被净化：补一次不带工具的汇报请求，逼出一句正常人话；
      // 失败则交给上层空文案管线。
      if (!text.trim()) {
        convo.push({
          role: 'user',
          content: usedTools
            ? '（系统提示：工具已执行完毕。请用一两句自然的话向机主汇报刚才操作的结果，不要输出工具名或日志格式。）'
            : '（系统提示：请直接用一句自然的话向机主回复：若需要操作就调用工具执行，若无法完成请如实说明原因，不要输出工具名或计划文本。）',
        });
        try {
          const fin = await fcRequest(convo, [], config);
          text = typeof fin.content === 'string' ? fin.content : '';
        } catch {
          /* 汇报兜底失败：按空回复交给上层空文案管线 */
        }
      }
      return { text: cleanToolLogs(text), usedTools };
    }
    // 有工具调用：执行（串行——消息/帖子等操作天然有序）→ 结果回传模型
    usedTools = true;
    convo.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
    for (const call of calls) {
      if (shouldAbort?.()) return { text: '', usedTools };
      const fn = call.function?.name ?? '';
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(call.function?.arguments ?? '{}') as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        /* 参数不是合法 JSON：按空参数走，执行器会返回参数错误给模型自查 */
      }
      let result: string;
      try {
        result = await withTimeout(execWebTool(fn, args), TOOL_EXEC_TIMEOUT_MS, '工具执行超时（120s）');
      } catch (e) {
        result = `【失败】${e instanceof Error ? e.message : '执行异常'}`;
      }
      convo.push({ role: 'tool', tool_call_id: call.id ?? '', content: result.slice(0, 8000) });
    }
  }
  // 轮数用尽：强收一次不带工具的汇报（不让机主等一轮空气）
  convo.push({ role: 'user', content: '（系统提示：已达工具调用轮数上限。请直接向机主汇报目前的执行结果，不要输出工具名或日志格式。）' });
  try {
    const fin = await fcRequest(convo, [], config);
    return { text: cleanToolLogs(typeof fin.content === 'string' ? fin.content : ''), usedTools };
  } catch {
    return { text: '', usedTools };
  }
}
