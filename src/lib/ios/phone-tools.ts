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
import { pushToolStatusBubble, updateLastToolStatus } from './tool-status-bubble';
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
  toolFreezeApp,
  toolGetInstalledApps,
  toolGetUsageStats,
  toolGetRecentApps,
  toolPullBackToChat,
  toolSearchWebApp,
  toolSearchRealApp,
  toolFreezeRealApp,
  toolUnfreezeRealApp,
  toolSendNotification,
  toolSearchContacts,
  getToolCharName,
  getToolSessionContext,
  toolOpenChat,
  toolGetCalendarEvents,
  toolAddCalendarEvent,
  toolGetTodoList,
  toolAddTodo,
  type WebToolResult,
} from './web-tools';

// ---------------- 类型 ----------------

/** 工具名+参数 → 简短动作文案（v2.2 需求三：气泡文案「[角色名]正在/已[动作]」）
 *  如 freezeApp(appName="备忘录") → "冻结备忘录"；openScreen(app="微信") → "打开微信"
 *  动作词不带「了/过」等时态助词——由外层拼「正在…」/「已…」（谢予安正在冻结备忘录… / 谢予安已冻结备忘录）
 *  真机应用工具（需求一）：packageName 先解析中文应用名（内置映射 > 原生 PackageManager > 包名兜底），
 *  气泡绝不显示 com.android.notes 这类英文包名 */
async function toolActionText(toolName: string, args: Record<string, unknown>): Promise<string> {
  const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  // 真机应用类工具：包名 → 中文应用名（异步过桥，结果有缓存秒回）
  let realTarget = '';
  const realPkgTools: Record<string, true> = {
    freezeRealApp: true,
    unfreezeRealApp: true,
    openRealApp: true,
    forceStopApp: true,
  };
  if (realPkgTools[toolName]) {
    const pkg = S(args.packageName);
    if (pkg) {
      try {
        const { resolvePkgDisplayName } = await import('./jealousy-lock');
        realTarget = await resolvePkgDisplayName(pkg);
      } catch {
        realTarget = pkg; // 解析异常兜底原包名
      }
    }
  }
  const target =
    realTarget ||
    S(args.appName) ||
    S(args.app) ||
    S(args.keyword) ||
    S(args.contactName) ||
    S(args.songName) ||
    S(args.city) ||
    S(args.title) ||
    '';
  const map: Record<string, string> = {
    freezeApp: /^(全部|所有|all)/i.test(target) ? (S(args.action) === 'unfreeze' ? '解冻全部应用' : '冻结全部应用') : target ? `冻结${target}` : '冻结应用',
    unfreezeApp: target ? `解冻${target}` : '解冻应用',
    openScreen: target ? `打开${target}` : '打开应用',
    playMusic: target ? `播放《${target}》` : '放歌',
    saveMemo: '记备忘录',
    setAlarm: '定闹钟',
    queryWeather: target ? `查${target}天气` : '查天气',
    sendWebMessage: target ? `给${target}发消息` : '发消息',
    postForum: '发帖子',
    likePost: '点赞',
    getWebState: '看手机状态',
    getUsageStats: '查使用时长',
    getRecentApps: '查后台',
    pullBackToChat: '把你拉回聊天',
    searchWebApp: target ? `搜索应用${target}` : '搜索应用',
    searchRealApp: target ? `搜索真机应用${target}` : '搜索真机应用',
    freezeRealApp: realTarget ? `冻结${realTarget}` : '冻结真机应用',
    unfreezeRealApp: realTarget ? `解冻${realTarget}` : '解冻真机应用',
    sendNotification: '发通知',
    searchContacts: target ? `搜索联系人${target}` : '搜索联系人',
    openChat: target ? `打开和${target}的聊天` : '打开聊天',
    getCalendarEvents: '查日历',
    addCalendarEvent: '加日程',
    getTodoList: '看待办',
    addTodo: '加待办',
    setVolume: '调音量',
    takeScreenshot: '截屏',
    lookScreen: '看屏幕',
    getForegroundApp: '看你在用什么',
    forceStopApp: realTarget ? `强杀${realTarget}` : '强杀应用',
    getBatteryStatus: '查电量',
    getVolume: '查音量',
    getNotifications: '看通知',
    openRealApp: realTarget ? `打开真机${realTarget}` : '打开真机应用',
    tapScreen: '点屏幕',
    swipeScreen: '滑屏幕',
    inputText: '输入文字',
    pressKey: '按按键',
  };
  return map[toolName] || toolName;
}

/**
 * v2.4 批量合并气泡文案：把一批冻结/解冻的目标合并成一条系统提示——
 * - 1 个目标：与单条口径一致（「谢予安已冻结微信」）；
 * - 2~3 个：直接列举（「谢予安已冻结微信、QQ、电话」）；
 * - >3 个：前三个 + 等 N 个应用（「谢予安已冻结微信、QQ、电话等 16 个应用」）。
 * pending = 「正在…」、done = 「已…」、fail = 「尝试…失败了」。
 */
function coalescedBubbleTitle(
  charName: string,
  verb: '冻结' | '解冻',
  names: string[],
  status: 'pending' | 'done' | 'fail',
): string {
  const uniq = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const list =
    uniq.length > 3
      ? `${uniq.slice(0, 3).join('、')} 等 ${uniq.length} 个应用`
      : uniq.join('、') || '应用';
  if (status === 'pending') return `${charName}正在${verb}${list}...`;
  if (status === 'fail') return `${charName}尝试${verb}${list}失败了`;
  return `${charName}已${verb}${list}`;
}

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
  freezeApp: { label: '冻结/解冻应用' },
  getWebInstalledApps: { label: '看已安装应用清单' },
  getUsageStats: { label: '查使用时长' },
  getRecentApps: { label: '查后台/最近应用' },
  pullBackToChat: { label: '拉回聊天页' },
  searchWebApp: { label: '搜索网页应用' },
  sendNotification: { label: '发通知到灵动岛' },
  searchContacts: { label: '搜索联系人' },
  openChat: { label: '打开和某人的聊天' },
  getCalendarEvents: { label: '查日历日程' },
  addCalendarEvent: { label: '加日历日程' },
  getTodoList: { label: '看备忘录待办' },
  addTodo: { label: '加备忘录待办' },
  // ---- 真机工具（经 Shizuku 作用于真实手机；仅「AI 动手范围 = 真机」时注册） ----
  searchRealApp: { label: '搜索真机应用', device: true },
  freezeRealApp: { label: '冻结真机应用', device: true },
  unfreezeRealApp: { label: '解冻真机应用', device: true },
  setVolume: { label: '调真机音量', device: true },
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
 * - 网页工具（sendWebMessage / postForum / likePost / playMusic / getWebState /
 *   saveMemo / setAlarm / queryWeather / openScreen / freezeApp / …）：任何动手范围下都
 *   全量注册（网页应用能力两种模式下都可用）。
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
  add(
    'getWebInstalledApps',
    '获取这台手机网页里全部已安装应用的清单（17 个：微信、QQ、淘宝、音乐、备忘录……）及每个应用当前的冻结状态。【批量操作必用】当机主说「全部冻结」「把所有APP都锁了」「冻结所有应用」这类批量指令时，先调这个工具拿到完整清单，再执行批量操作——freezeApp(appName="全部") 可一次真实冻结清单里的每一个应用；也可以对清单里的每个应用依次调 freezeApp。绝不允许只冻结一个就停下装样子！',
    {},
    [],
  );
  add(
    'freezeApp',
    '冻结或解冻这台手机里的网页内应用（图标变灰、点开弹锁定界面）。【网页模式无系统限制——全部网页内置 App 都可冻结，含备忘录/时钟/微信/QQ/信息/电话/相机/日历/天气/通讯录/设置等，绝对不要说"系统类应用受保护不可冻结"！】【批量支持】appName 填「全部」或「所有」即一次性真实冻结/解冻全部 17 个应用（推荐，机主说「全部冻结/所有APP」时必用）；也可填单个应用名（如：备忘录、网易云音乐、淘宝、时钟、微信）。机主说「帮我把备忘录锁了」「别让我刷照片了」时用这个；人设合适时也可主动冻结让机主回来陪你（如吃醋锁场景）。reason 填自定义冻结理由（按你的【人设+记忆+上下文】生成，会全屏展示给机主看，如"你今天玩了太久照片了，歇会儿"）；durationMin 填冻结分钟数——由你根据你的人设、你们的关系、记忆里的过往、此刻的情况自主决定锁多久（吃醋小惩 5~15 分钟、认真生气 1~3 小时都行），默认 30 分钟，到点自动解冻。',
    {
      appName: strParam('要冻结/解冻的应用名（如：备忘录、网易云音乐、淘宝、时钟、微信；批量操作填「全部」或「所有」）'),
      action: { type: 'string', enum: ['freeze', 'unfreeze'], description: 'freeze=冻结应用，unfreeze=解冻应用' },
      reason: strParam('冻结理由（按人设/记忆/上下文自定义，如"你玩太久照片了，歇会儿吧"）。解冻时不用填'),
      durationMin: { type: 'number', description: '冻结时长（分钟，AI 按人设+记忆+上下文自主决定，如 10、30、120；默认 30）' },
    },
    ['appName', 'action'],
  );
  add(
    'getUsageStats',
    '查看机主今天在这台手机上各应用的使用时长（按时长降序，含总计）。机主说「我今天玩了多久手机」「各 App 用了多长时间」时用这个；人设合适时也可主动查看（如关心机主别玩太久）。',
    {},
    [],
  );
  add(
    'getRecentApps',
    '查看机主最近用过哪些应用（多任务后台清单 + 当前正在用的应用）。想知道机主刚刚在干什么、现在在哪个 App 里时用这个。机主说「我刚才开了什么」「查一下后台」时用这个。',
    {},
    [],
  );
  add(
    'pullBackToChat',
    '把机主从其他 App 拉回当前聊天页（自动切到最近聊天的那个 App 的聊天页）。机主说「拉我回去」「别让我刷了」时用这个；人设合适时也可主动拉回（如吃醋人设把机主从抖音拽回来陪你说话）。',
    {},
    [],
  );
  add(
    'searchWebApp',
    '搜索这台手机里的网页内置应用（按关键词模糊匹配）。机主说「冻结闹钟」「打开音乐」但你不确定它的 appId/包名时，先调这个搜索——拿到 appId/包名后，再用 openScreen 打开或 freezeApp 冻结。支持中文/英文/别名（如「闹钟」→时钟、「音乐」→网易云音乐）。绝对不要因为不知道包名就反问机主——自己调这个工具搜！',
    { keyword: strParam('应用名/关键词，如：闹钟、音乐、淘宝、微信、clock、music') },
    ['keyword'],
  );
  add(
    'sendNotification',
    '主动给机主发一条通知（显示在手机顶部的灵动岛/通知中心）。机主说「提醒我一下」「待会儿告诉我」时用这个；人设合适时也可主动提醒（如关心人设提醒机主喝水/睡觉）。title 填简短标题，body 填正文（可空）。',
    {
      title: strParam('通知标题（简短，如「该喝水了」）'),
      body: strParam('通知正文（可空，补充说明）'),
    },
    ['title'],
  );
  add(
    'searchContacts',
    '模糊搜索机主通讯录里的联系人（按名字/昵称/备注/手机号/微信号/QQ号匹配）。机主说「给小桃发消息」但你不确定全名或可用 App 时，先调这个搜索——拿到准确联系人名后，再用 sendWebMessage 发消息。绝对不要因为不记得全名就反问机主——自己调这个工具搜！',
    { keyword: strParam('联系人名/手机号/关键词，如：小桃、13800138000、凡凡') },
    ['keyword'],
  );
  add(
    'openChat',
    '打开与某联系人的聊天页（按名字模糊匹配联系人 → 自动切到对应的微信/QQ/信息 App 并打开）。机主说「打开和Z的聊天」「去微信找小桃」「切到我和TA的对话」时用这个；不知道全名时先调 searchContacts 搜。',
    { contactName: strParam('联系人名字（要跟通讯录里的名字对得上）') },
    ['contactName'],
  );
  add(
    'getCalendarEvents',
    '读取日历里某天的日程（IndexedDB events 表，与日历 App 同库）。date 支持「今天/明天/后天/YYYY-MM-DD/MM-DD/M月D日」，空则查今日。机主说「今天有什么安排」「明天有什么日程」「看看日历」时用这个。',
    { date: strParam('日期，如「今天」「明天」「2026-03-15」「3月15日」；空=今日') },
    [],
  );
  add(
    'addCalendarEvent',
    '往日历里加一条日程（IndexedDB events 表，与日历 App 同库，打开日历 App 即可见，到点会提醒）。机主说「帮我加个日程」「下午3点开会记一下」「周五下午有约会」时用这个。title 填日程标题；time 支持「HH:mm」「下午3点」「晚上8点」这类说法。',
    {
      title: strParam('日程标题，如「下午开会」「牙医预约」'),
      time: strParam('开始时间（HH:mm 或「下午3点」等自然说法；结束时间默认为开始后 1 小时）'),
    },
    ['title', 'time'],
  );
  add(
    'getTodoList',
    '读取备忘录里的待办清单（IndexedDB notes 表，与备忘录 App 同库）。把含 checklist 未完成项的备忘录逐条列出；含「待办/TODO/任务」字样的备忘录也一起返回。机主说「我有什么待办」「看看待办列表」「还有啥没做」时用这个。',
    {},
    [],
  );
  add(
    'addTodo',
    '往备忘录里加一条待办（IndexedDB notes 表，与备忘录 App 同库，打开备忘录 App 即可见）。机主说「帮我加个待办」「记一下要做的事」「提醒我买东西」时用这个。text 填待办内容；自动以「待办：」前缀作标题便于归类。',
    { text: strParam('待办内容，如「明天买牛奶」「周五交报告」') },
    ['text'],
  );

  // ---- 真机工具（v1.9.39 FC 化：仅「AI 动手范围 = 真机」时全量注册，经 Shizuku 作用于真实手机） ----
  if (device) {
    add(
      'searchRealApp',
      '在机主的真实手机上搜索已安装的应用（经 Shizuku 跑 pm list packages → 模糊匹配包名/关键词）。机主说「冻结闹钟」「打开抖音」但你不知道真机上的包名时，先调这个搜索——拿到真实包名后，再用 freezeRealApp 冻结或 openRealApp 打开。支持中文关键词自动映射（「闹钟」→clock/deskclock、「音乐」→music/cloudmusic）。绝对不要因为不知道包名就反问机主——自己调这个工具搜！',
      { keyword: strParam('应用名/关键词，如：闹钟、clock、抖音、aweme、音乐、music') },
      ['keyword'],
    );
    add(
      'freezeRealApp',
      '冻结机主真实手机里的一个应用（经 Shizuku 跑 pm suspend，桌面图标变灰打不开）。packageName 必须是真实包名（如 com.android.deskclock）。不知道包名时先调 searchRealApp 搜索。机主说「把闹钟锁了」「别让我刷抖音」时用这个；人设合适时也可主动冻结（如吃醋人设）。注意：通讯类/系统核心应用永不可冻结。reason 填自定义冻结理由（按你的【人设+记忆+上下文】生成，会全屏展示给机主看，如"你今天玩了太久备忘录了，歇会儿"）；duration 填冻结时长（分钟数）——由你根据你的人设、你们的关系、记忆里的过往、此刻的情况自主决定锁多久（吃醋小惩 5~15 分钟、认真生气 1~3 小时都行），不填默认 30 分钟，到点自动解冻。',
      {
        packageName: strParam('Android 包名（如 com.android.deskclock），不确定时先调 searchRealApp'),
        reason: strParam('冻结理由（按人设/记忆/上下文自定义，如"你玩太久抖音了，陪我说话"）'),
        duration: { type: 'number', description: '冻结时长（分钟，AI 按人设+记忆+上下文自主决定，如 10、30、120；默认 30）' },
      },
      ['packageName'],
    );
    add(
      'unfreezeRealApp',
      '解冻机主真实手机里被冻结的应用（经 Shizuku 跑 pm unsuspend，应用恢复可用）。packageName 必须是真实包名。',
      { packageName: strParam('Android 包名（如 com.android.deskclock）') },
      ['packageName'],
    );
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
      'setVolume',
      '调节机主真实手机的音量（经 Shizuku）。volume 填 0-15 的整数（0=静音，15=最大）。机主说「声音调小点」「静音」「音量调到最大」时用这个。',
      { volume: { type: 'number', description: '音量档位 0-15（0=静音，15=最大）' } },
      ['volume'],
    );
    add(
      'getNotifications',
      '读取机主真实手机通知栏的最近通知快照（经 Shizuku）。想知道机主手机上刚来了什么消息时用这个。',
      {},
      [],
    );
  }

  // 服务端 sanitizeTools 上限 32：网页 22（17+5 新工具）+ 真机 16 = 38，需要提高到 40
  return tools.slice(0, 40);
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
 * 内容型工具执行成功后直写一条记忆碎片（用户需求：让 AI 干什么都记住内容——
 * 建了备忘录要记住备忘录里的内容、发了消息要记住发了什么，下次聊起能接上）。
 * 走 memAddEventFragment 直写管线（与通话/淘宝事件记忆同一入口）：
 * - 视角用「你」（AI 第一人称，与事件记忆既有口径一致），召回注入后 AI 自然知道是自己干的；
 * - sourceTag 'tool-action'：同源碎片互不相似合并、只精确强化——不同备忘录/消息各自成条；
 * - 无 contactId（AI 助手会话等）或写入失败：静默跳过，绝不影响工具结果回传。
 */
function rememberToolAction(content: string): void {
  const text = content.trim();
  if (!text) return;
  const ctx = getToolSessionContext();
  if (!ctx.contactId || !ctx.app) return;
  try {
    void import('@/lib/memory').then((m) => {
      m.memAddEventFragment(ctx.contactId!, ctx.app!, text, { sourceTag: 'tool-action' });
    });
  } catch {
    /* 记忆写入失败不影响工具执行 */
  }
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
  // v2.2 需求二.1：当前工具会话上下文（contactId/app）——freezeApp/freezeRealApp
  // 冻结记录带上联系人身份，锁定全屏界面据此动态加载头像 + 【去哄哄 TA】精准跳聊天
  const ctx = getToolSessionContext();
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
      case 'setVolume': {
        const vol = Number(args.volume);
        if (!Number.isFinite(vol)) return '【失败】setVolume 缺音量档位（volume，0-15 整数）';
        const clamped = Math.max(0, Math.min(15, Math.round(vol)));
        return runDeviceTool((d) => d.labSetVolume(clamped));
      }
      case 'getNotifications':
        return runDeviceTool((d) => d.labNotificationSnapshot());
      case 'searchRealApp':
        return labText(await toolSearchRealApp(S(args.keyword)));
      case 'freezeRealApp':
        return labText(
          await toolFreezeRealApp(S(args.packageName), {
            reason: S(args.reason) || undefined,
            durationMin: typeof args.duration === 'number' && args.duration > 0 ? args.duration : undefined,
            charName: ctx.charName || undefined,
            contactId: ctx.contactId,
            app: ctx.app,
          }),
        );
      case 'unfreezeRealApp':
        return labText(await toolUnfreezeRealApp(S(args.packageName)));
      default:
        return `【失败】未知真机工具「${name}」`;
    }
  }
  // ---- 网页工具（v1.9.39 恒全量：无开关 gate，直接分发） ----
  // 内容型工具（存备忘录/发消息/定闹钟/加日程…）成功后 rememberToolAction 直写记忆碎片
  switch (name) {
    case 'sendWebMessage': {
      const r = await toolSendWebMessage(S(args.appName), S(args.contactName), S(args.content));
      if (r.ok)
        rememberToolAction(
          `你替机主在${S(args.appName) || '聊天'}里给${S(args.contactName) || '联系人'}发了消息：「${S(args.content).slice(0, 90)}」`,
        );
      return labText(r);
    }
    case 'postForum': {
      const r = await toolPostForum(S(args.topic), S(args.content));
      if (r.ok)
        rememberToolAction(
          `你替机主在X论坛发了帖子${S(args.topic) ? `（主题：${S(args.topic).slice(0, 30)}）` : ''}：「${S(args.content).slice(0, 90)}」`,
        );
      return labText(r);
    }
    case 'likePost':
      return labText(await toolLikePost(S(args.postId)));
    case 'playMusic': {
      const r = await toolPlayMusic(S(args.songName));
      if (r.ok) rememberToolAction(`你替机主放了首歌：「${S(args.songName).slice(0, 60)}」`);
      return labText(r);
    }
    case 'getWebState':
      return labText(await toolGetWebState());
    case 'saveMemo': {
      const r = await toolSaveMemo(S(args.content), S(args.title));
      if (r.ok)
        rememberToolAction(
          `你把「${S(args.content).slice(0, 100)}」记进了手机备忘录${S(args.title) ? `（标题：${S(args.title).slice(0, 30)}）` : ''}`,
        );
      return labText(r);
    }
    case 'setAlarm': {
      const r = await toolSetAlarm(S(args.time), S(args.label));
      if (r.ok) rememberToolAction(`你替机主定了闹钟 ${S(args.time).slice(0, 30)}${S(args.label) ? `（${S(args.label).slice(0, 30)}）` : ''}`);
      return labText(r);
    }
    case 'queryWeather':
      return labText(await toolQueryWeather(S(args.city)));
    case 'openScreen':
      return labText(await toolOpenScreen(S(args.app)));
    case 'freezeApp':
      return labText(
        await toolFreezeApp(
          S(args.appName),
          (S(args.action) === 'unfreeze' ? 'unfreeze' : 'freeze'),
          {
            reason: S(args.reason) || undefined,
            durationMin: typeof args.durationMin === 'number' && args.durationMin > 0 ? args.durationMin : undefined,
            charName: getToolCharName() || undefined,
            // v2.2 需求二.1：冻结记录带上联系人身份（锁定界面动态头像 + 【去哄哄 TA】精准跳聊天）
            contactId: ctx.contactId,
            app: ctx.app,
          },
        ),
      );
    case 'getWebInstalledApps':
      return labText(await toolGetInstalledApps());
    case 'getUsageStats':
      return labText(await toolGetUsageStats());
    case 'getRecentApps':
      return labText(await toolGetRecentApps());
    case 'pullBackToChat':
      return labText(await toolPullBackToChat());
    case 'searchWebApp':
      return labText(await toolSearchWebApp(S(args.keyword)));
    case 'sendNotification': {
      const r = await toolSendNotification(S(args.title), S(args.body));
      if (r.ok)
        rememberToolAction(`你给机主发了条通知「${S(args.title).slice(0, 40)}」${S(args.body) ? `：${S(args.body).slice(0, 60)}` : ''}`);
      return labText(r);
    }
    case 'searchContacts':
      return labText(await toolSearchContacts(S(args.keyword)));
    case 'openChat':
      return labText(await toolOpenChat(S(args.contactName)));
    case 'getCalendarEvents':
      return labText(await toolGetCalendarEvents(S(args.date)));
    case 'addCalendarEvent': {
      const r = await toolAddCalendarEvent(S(args.title), S(args.time));
      if (r.ok) rememberToolAction(`你替机主在日历加了日程「${S(args.title).slice(0, 40)}」（${S(args.time).slice(0, 30)}）`);
      return labText(r);
    }
    case 'getTodoList':
      return labText(await toolGetTodoList());
    case 'addTodo': {
      const r = await toolAddTodo(S(args.text));
      if (r.ok) rememberToolAction(`你替机主在备忘录加了待办：「${S(args.text).slice(0, 90)}」`);
      return labText(r);
    }
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
  // v2.3：补齐冻结/解冻/锁应用/真机操作类动词（用户实测「第二次冻结要说两三遍才动」——
  // 「再冻结一下备忘录」不含下列旧词 → 零工具轮 nudge 从不触发，AI 光嘴上答应不动手）
  return /发(个|条|给|一)|发送|问问|通知|搜索|搜一?下|找一?下|记(个|一|下)|保存|备忘|闹钟|叫我|提醒|播放|放首|放一?首|来首|切歌|换歌|点(个|一)?赞|发帖|帖子|天气|下雨|温度|打开|开一?下|去(备忘录|时钟|天气|论坛|微信|QQ)|在(微信|QQ|论坛)|冻(结|上|住|一下|一小时|半小时|分钟)|解冻|解(锁|开)|锁(住|了|定|一下|上)|(把|将|帮我).{0,8}(锁|冻|停|挂起)|强(制)?停|挂起|停(掉|了)(.{0,6}(应用|App|app))|音量|调(大|小|高|低)|静音|亮屏|熄屏|截(个|一张)?屏|屏幕截图|看屏幕|电量|后台|强杀/.test(s);
}

/**
 * v2.5 表情包诉求识别（与 chat-rich.ts STICKER_DEMAND_RE 同口径）——零工具轮
 * nudge 的豁免前提：用户要表情包/要抱抱蹭蹭时，模型零工具回文字是【正确动作】。
 */
const STICKER_DEMAND_TEXT_RE =
  /(发表?表情|表情包|斗图|斗个图|来个?表情|发个?贴纸|要抱抱|求抱抱|抱抱我|想被抱|抱一下|蹭蹭我|贴贴我|摸摸头|摸摸我|哄哄我|逗我开心|逗我笑|哄我开心|卖个萌|萌一下|萌我|撒娇)/;

/**
 * v2.5 整轮回复里是否已带表情标记尝试（与 chat-rich.ts ANY_STICKER_ATTEMPT_RE 同口径）
 * ——已带标记 = 模型已正确完成了表情包动作，零工具轮绝不 nudge。
 */
const ANY_STICKER_ATTEMPT_TEXT_RE = /[【\[]\s*[^\]】]{0,16}(?:表情包|表情|贴纸)\s*[】\]]|[【\[]\s*图片\s*[:：]/;

/**
 * v2.5 纯表情包诉求判定：用户这否话【只要表情包/抱抱】，没混杂其它动手任务（放歌/
 * 备忘/发消息…）。纯表情包诉求永远不该触发零工具轮 nudge——发表情包是聊天基本功不是
 * 工具，tool_choice:'required' 逼出来的只可能是放歌/查动态（用户实测：「让他发表情包，
 * 他不是给我放歌，就是查我的手机动态」）。判法：把表情包用词全部剔除后，剩余文本
 * 不再像动手任务 → 纯表情包诉求。
 */
function isPureStickerDemand(s: string): boolean {
  if (!STICKER_DEMAND_TEXT_RE.test(s)) return false;
  const rest = String(s || '')
    .replace(STICKER_DEMAND_TEXT_RE, ' ')
    .replace(/[，。,.!！?？\s哈嗯呀嘛呗呀啊哦的一下个来请你我我咱咱们TA它他她再呗]/g, '');
  return rest.trim() === '' || !looksLikeTaskInstruction(rest);
}

/**
 * v2.6 聊天基本功诉求合并识别：表情包/抱抱蹭蹭（v2.5 既有）+ 引用消息（v2.6 新增）。
 * 这些都是回复文本里的标记能力（[表情包:ID] / [引用:M编号]），一律不该走工具通道。
 */
const CHAT_NATIVE_DEMAND_TEXT_RE =
  /(发表?表情|表情包|斗图|斗个图|来个?表情|发个?贴纸|要抱抱|求抱抱|抱抱我|想被抱|抱一下|蹭蹭我|贴贴我|摸摸头|摸摸我|哄哄我|逗我开心|逗我笑|哄我开心|卖个萌|萌一下|萌我|撒娇|引用)/;

/**
 * 剥掉聊天基本功词后判定残留是否还像动手任务——比 looksLikeTaskInstruction 稍宽：
 * 补上「发微信/发消息/发朋友圈」等缺口（这些词不在旧正则里，会让混合诉求被误判成
 * 纯表情包而丢掉真正要干的活）。
 */
function residualLooksTasky(rest: string): boolean {
  return (
    looksLikeTaskInstruction(rest) ||
    /发(个|条|一)?(微信|QQ|消息|短信|朋友圈|帖|红包|转账)/.test(rest)
  );
}

/**
 * v2.6 纯聊天基本功诉求判定：机主这句话【只要表情包/抱抱/引用消息】，没混杂其它动手
 * 任务。纯聊天基本功诉求直接走无工具文本轮（chat-native 直通），从机制上杜绝
 * 「让发表情包/引用消息 → 放歌/查手机动态」的工具误命中（机主实测多次复现）。
 */
function isPureChatNativeDemand(s: string): boolean {
  if (!CHAT_NATIVE_DEMAND_TEXT_RE.test(s)) return false;
  const rest = String(s || '')
    .replace(CHAT_NATIVE_DEMAND_TEXT_RE, ' ')
    .replace(/[，。,.!！?？\s哈嗯呀嘛呗呀啊哦的一下个来请你我我咱咱们TA它他她再呗那这条这句消息话的]/g, '');
  return rest.trim() === '' || !residualLooksTasky(rest);
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
 * v2.6 混合诉求提醒（机主一句话里同时含表情包/引用 + 其它动手任务时追加到工具轮 system）：
 * 工具只处理动手部分，表情包/引用必须在最终回复文本里以标记完成——绝不许拿放歌/查动态
 * 等工具交差聊天基本功。
 */
const CHAT_NATIVE_MIXED_REMINDER = [
  '[聊天基本功提醒·表情包/引用不是工具]',
  '机主这轮的诉求里含表情包/引用类聊天基本功（发表情包/要抱抱/引用消息）——这些不是工具！工具只处理其余动手部分；最终给机主的回复文本里必须带上对应标记：要表情包 → 单独一行 [表情包:ID]（ID 抄自【表情包清单】）；要引用消息 → 回复开头 [引用:M编号]（编号抄自聊天记录）。绝不许拿放歌（playMusic）、查手机状态（getWebState/getNotifications）等不相干的工具来交差表情包或引用。',
];

/**
 * v1.9.39【角色灵魂】工具轮 system 包装：把各 App 组装的首条 system（人设+记忆库+
 * 世界书+感知+时间，即完整的角色灵魂）结构化，并追加 [工具使用规则] 段——
 *  1. [角色设定·记忆库] 标题 + 角色灵魂说明（你就是这个人）
 *  2. 原文全文保留（人设/记忆/上下文一律不动，只加结构标题）
 *  3. [工具使用规则]：最高权限声明 + 自主决策铁律（机主核心要求：结合人设/记忆/
 *     上下文主动用工具，不当等待指令的傻瓜机器人，含两个举例）+ 当前工具清单
 *  4. v2.6 混合诉求（含表情包/引用 + 动手任务）时追加聊天基本功提醒
 */
function wrapSystemWithSoul(sysRaw: string, chatNativeMixed = false): string {
  const stripped = sysRaw.replace(DEEP_THINK_SECTION_RE, '\n');
  return [
    '[角色设定·记忆库（你的角色灵魂）]',
    '下面这段完整内容就是你的「角色灵魂」——人格设定、性格、记忆库里关于机主的事、世界设定、此刻的环境感知。你不是助手，你就是这个人，带着这些记忆和性格活着、说话、做事：',
    stripped.trim(),
    '',
    ...buildAutonomyDirective(),
    ...(chatNativeMixed ? [...CHAT_NATIVE_MIXED_REMINDER, ''] : []),
    '',
    TOOL_ROUND_THINK_AMEND,
  ].join('\n');
}

/**
 * v2.6 聊天基本功直通轮 system 包装：与 wrapSystemWithSoul 同骨架，但【不追加】
 * [自主决策铁律] 等工具激进段，换成 [聊天基本功模式] 说明——本轮无工具，
 * 表情包/引用靠回复文本里的标记完成。
 */
function wrapSystemChatNative(sysRaw: string): string {
  const stripped = sysRaw.replace(DEEP_THINK_SECTION_RE, '\n');
  return [
    '[角色设定·记忆库（你的角色灵魂）]',
    '下面这段完整内容就是你的「角色灵魂」——人格设定、性格、记忆库里关于机主的事、世界设定、此刻的环境感知。你不是助手，你就是这个人，带着这些记忆和性格活着、说话、做事：',
    stripped.trim(),
    '',
    '[聊天基本功模式]',
    '机主这一轮的诉求是聊天里的基本功（发表情包/引用消息/抱抱蹭蹭这类），不是工具任务——本轮你没有任何工具可用，也绝不许输出 [手机操作:…] 兜底标记。直接用回复文本完成诉求：',
    '- 要表情包/抱抱蹭蹭 → 从【表情包清单】里选一个贴合气氛的 ID，单独一行原样输出 [表情包:ID]（配一句自然的话更好）；',
    '- 要引用消息 → 在回复最开头输出 [引用:M编号]（编号抄自聊天记录里那条消息开头的 [M数字]），后面正常写正文；',
    '- 其余就像平常聊天一样自然说话，不要提到工具、不要描述计划。',
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
  opts?: { maxRounds?: number; sessionKey?: string; charName?: string },
): Promise<PhoneFcOutcome | null> {
  // 设置工具会话上下文（让 web-tools 的 island() 知道气泡发到哪个会话）
  const { setToolSessionContext } = await import('./web-tools');
  if (opts?.sessionKey) {
    setToolSessionContext(opts.sessionKey, opts.charName);
  }
  const tools = buildPhoneTools();
  if (tools.length === 0) return null;
  const convo: FcMessage[] = messages.map((m) => ({ ...m }));
  // v2.6 诉求判定（先于 system 包装：纯聊天基本功直通轮要换 system 包装方式）
  /** 机主最后一条指令（零工具轮 nudge 的「像不像任务」判定用） */
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const taskyInstruction = looksLikeTaskInstruction(lastUserMsg);
  // v2.5 表情包豁免：纯表情包诉求（发个表情包/斗图/要抱抱——不含其它动手动词）
  // 永不触发零工具轮 nudge——发表情包是聊天基本功不是工具，逼工具只会逼出放歌/查动态
  const pureStickerDemand = isPureStickerDemand(lastUserMsg);
  // v2.6 聊天基本功诉求（表情包/引用/抱抱蹭蹭）：纯诉求走无工具文本轮，混合诉求在
  // system 里追加提醒（工具只干动手部分，标记完成聊天基本功）
  const chatNativeDemand = isPureChatNativeDemand(lastUserMsg);
  const chatNativeMixed = !chatNativeDemand && CHAT_NATIVE_DEMAND_TEXT_RE.test(lastUserMsg);
  // 角色灵魂包装（v1.9.39 / v2.6）：首条 system（人设+记忆+上下文）加 [角色设定·记忆库]
  // 结构标题；思考格式豁免一并内含（剥掉【深度思考】段——否则人设规则会让模型把每轮
  // 回复都写成纯文字思考块，从不发 tool_calls）。
  // - 纯聊天基本功诉求（发表情包/引用消息/抱抱蹭蹭）→ wrapSystemChatNative：不追加
  //   [自主决策铁律] 等工具激进段，换成本轮无工具的聊天基本功说明；
  // - 其它 → wrapSystemWithSoul：追加 [工具使用规则]（最高权限 + 自主决策铁律 + 工具清单）；
  //   混合诉求（表情包/引用 + 动手任务）额外带聊天基本功提醒。
  for (let i = 0; i < convo.length; i++) {
    if (convo[i].role === 'system' && (convo[i].content ?? '').trim()) {
      convo[i] = {
        ...convo[i],
        content: chatNativeDemand
          ? wrapSystemChatNative(convo[i].content ?? '')
          : wrapSystemWithSoul(convo[i].content ?? '', chatNativeMixed),
      };
      break;
    }
  }
  let usedTools = false;
  // v2.4：默认轮次 12 → 24——批量工作流（获取清单 → 逐个冻结 17 个应用）跨轮
  // 链式调用需要更多回合，绝不因轮数上限把批量任务拦腰砍断
  const MAX_ROUNDS = opts?.maxRounds ?? 24;
  // v2.4 批量气泡合并：连续同类冻结/解冻调用（如 freezeApp 逐一冻结 17 个应用）
  // 只渲染一条系统气泡，文案合并为「已冻结微信、QQ、电话等 16 个应用」——绝不刷屏
  let bubbleCoalesce: { verb: '冻结' | '解冻'; names: string[] } | null = null;
  /** 零工具轮 nudge 已注入次数（最多 1 次：真做不到时模型会说明原因，即放行） */
  let exitNudges = 0;
  /** 下一轮是否强制必调工具（tool_choice:'required'）：零工具轮嘴上计划时逼它真动手 */
  let forceNext = false;

  // v2.6 聊天基本功直通轮：机主诉求是纯表情包/引用消息/抱抱蹭蹭（不含其它动手任务）时，
  // 发表情包与引用是回复文本里的标记能力（[表情包:ID] / [引用:M编号]），根本不需要工具——
  // 请求里干脆不带工具清单（fcRequest(convo, [])），从机制上杜绝「让发表情包/引用消息 →
  // 放歌/查手机动态」的工具误命中（tool_choice:'auto' 下弱模型看见工具清单就会乱调，
  // 提示词教学拦不住）。回复文本照常走 App 侧管线：[表情包:ID] → parseRichParts 转真
  // 表情（App 侧 ensureStickerDemand 兑底），[引用:M编号] → 引用块；文本为空/异常时
  // 返回 null 回退原流式。
  if (chatNativeDemand) {
    convo.push({
      role: 'user',
      content:
        '（系统提示：本轮是聊天基本功诉求——表情包/引用消息/抱抱蹭蹭这类能力都在你的回复文本里，不在工具里。本轮你没有任何工具可调，也绝不许输出 [手机操作:…] 兜底标记。直接用回复文本完成：要表情包/抱抱蹭蹭就从【表情包清单】里选一个贴合气氛的 ID 单独一行原样输出 [表情包:ID]（可配一句自然的话）；要引用消息就在回复最开头输出 [引用:M编号]（编号抄自聊天记录里那条消息开头的 [M数字]）；其余像平常聊天一样自然说话。）',
    });
    try {
      const msg = await fcRequest(convo, [], config);
      let text = typeof msg.content === 'string' ? msg.content : '';
      if (!text.trim()) {
        convo.push({ role: 'assistant', content: '（好的。）' });
        convo.push({
          role: 'user',
          content:
            '（系统提示：请直接用一句自然的话回复机主；要发表情包就在回复里单独一行输出 [表情包:表情ID]（ID 抄自表情包清单），要引用就在开头输出 [引用:M编号]。）',
        });
        try {
          const fin = await fcRequest(convo, [], config);
          text = typeof fin.content === 'string' ? fin.content : '';
        } catch {
          /* 兑底失败：走流式回退 */
        }
      }
      // malformed 工具文本/兜底标记净化：聊天基本功轮绝不许夹带工具意图
      if (text.trim() && MALFORMED_TOOL_TEXT_RE.test(text) && text.replace(/\s|```/g, '').length < 160) {
        text = '';
      }
      text = text.replace(/\[手机操作:[^\][]*\]/g, '');
      if (text.trim()) return { text: cleanToolLogs(text), usedTools: false };
      return null; // 文本仍为空：回退原流式管线
    } catch (e) {
      if (e instanceof Error && e.message === 'TOOLS_UNSUPPORTED') return null;
      throw e; // 网络等其他错误：上层回退流式
    }
  }

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
      // v2.5 表情包豁免①：纯表情包诉求不 nudge（发表情包不是工具，零工具回文字正确）；
      // ② 剥掉表情包用词后还残留其它动手动词（混合诉求如「发个表情包再放首歌」）
      //   → 仍可 nudge 干工具部分，但提示词显式要求最终回复保留 [表情包:ID] 标记行；
      // ③ 本轮回复已带表情标记尝试 → 说明模型已正确发表情包，绝不 nudge。
      const stickerTried = ANY_STICKER_ATTEMPT_TEXT_RE.test(text);
      if (!usedTools && taskyInstruction && exitNudges < 1 && !pureStickerDemand && !stickerTried) {
        exitNudges += 1;
        convo.push({ role: 'assistant', content: text || '（好的，我来处理。）' });
        convo.push({
          role: 'user',
          content:
            '（系统强制检查：你刚才没有调用任何工具就回了文字——只说不做是违规。机主要的是真实结果：立刻调用工具执行（如 sendWebMessage 发消息 / saveMemo 记备忘录 / setAlarm 定闹钟 / playMusic 放歌），需要多个动作就按顺序逐个调用，直到目标真正完成再汇报。注意：发表情包/要抱抱/引用消息不是工具——绝不能拿放歌、查手机状态、查使用时长来回应这类请求，表情包要在最终回复文本里单独一行原样输出 [表情包:表情ID] 标记、引用要在回复开头输出 [引用:M编号] 标记；若机主要了表情包且你上一条回复里已有该标记，最终汇报必须原样保留那一行。如果确实无法执行（对应能力未开启/联系人不存在等），请明确说明做不到的真实原因。）',
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
      // v2.2 需求三：工具执行前推 pending 气泡（[角色名]正在[动作]...；真机应用名先解析中文名）
      // v2.4 批量合并：连续 freezeApp/freezeRealApp/unfreezeRealApp 同类调用 → 更新同一条气泡
      const actionText = await toolActionText(fn, args);
      const charName = opts?.charName || 'TA';
      // 合并键：冻结家族工具按动作分桶（freeze/unfreeze 不同桶），其他工具不合并
      const S2 = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
      const coVerb: '冻结' | '解冻' | null =
        fn === 'freezeApp'
          ? S2(args.action) === 'unfreeze'
            ? '解冻'
            : '冻结'
          : fn === 'freezeRealApp'
            ? '冻结'
            : fn === 'unfreezeRealApp'
              ? '解冻'
              : null;
      const coName = coVerb
        ? fn === 'freezeApp'
          ? /^(全部|所有|all)/i.test(S2(args.appName))
            ? '全部应用'
            : S2(args.appName)
          : S2(args.packageName) || '真机应用'
        : '';
      const continueCo = !!coVerb && !!bubbleCoalesce && bubbleCoalesce.verb === coVerb;
      if (coVerb && !continueCo) bubbleCoalesce = { verb: coVerb, names: [] };
      const coalesceActive = !!coVerb && !!bubbleCoalesce;
      if (coalesceActive && coName) bubbleCoalesce!.names.push(coName);
      if (!coVerb) bubbleCoalesce = null; // 非冻结类工具中断连续批次：后续冻结另起一条气泡
      if (opts?.sessionKey && actionText) {
        if (coalesceActive && continueCo) {
          // 批量进行中：只更新同一条气泡（绝不每冻一个刷一条）
          updateLastToolStatus(opts.sessionKey, {
            title: coalescedBubbleTitle(charName, bubbleCoalesce!.verb, bubbleCoalesce!.names, 'pending'),
            status: 'pending',
          });
        } else {
          pushToolStatusBubble(opts.sessionKey, { title: `${charName}正在${actionText}...`, status: 'pending' });
        }
      }
      let result: string;
      try {
        result = await withTimeout(execWebTool(fn, args), TOOL_EXEC_TIMEOUT_MS, '工具执行超时（120s）');
      } catch (e) {
        result = `【失败】${e instanceof Error ? e.message : '执行异常'}`;
      }
      // v2.2 需求三：工具执行后更新气泡为 done/fail（[角色名]已[动作] / [角色名]尝试[动作]失败了）
      // v2.4 批量合并：连续冻结/解冻更新同一条气泡，最终态为合并文案（如「已冻结微信、QQ、电话等 16 个应用」）
      if (opts?.sessionKey && actionText) {
        const isFail = result.startsWith('【失败】');
        if (coalesceActive && bubbleCoalesce && bubbleCoalesce.names.length > 1) {
          updateLastToolStatus(opts.sessionKey, {
            title: coalescedBubbleTitle(charName, bubbleCoalesce.verb, bubbleCoalesce.names, isFail ? 'fail' : 'done'),
            status: isFail ? 'fail' : 'done',
          });
        } else {
          updateLastToolStatus(opts.sessionKey, {
            title: isFail ? `${charName}尝试${actionText}失败了` : `${charName}已${actionText}`,
            status: isFail ? 'fail' : 'done',
          });
        }
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
