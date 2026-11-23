'use client';

/**
 * AI 动手·Web 生态 + 真机原生自主权（v2.0.0 去 Shizuku 化重写，原 device-autonomy.ts）。
 *
 * 真机底层全部改由安卓原生系统 API + 无障碍服务（AiAccessibilityService）实现：
 *  - 点按/滑动 → 无障碍 dispatchGesture；输入 → ACTION_SET_TEXT（原生支持中文/emoji）
 *  - 按键 → performGlobalAction（返回/主页/多任务/通知栏/锁屏）
 *  - 拉起 App → PackageManager LaunchIntent；拉回本 APP → bringToFront
 *  - 截屏 → 无障碍 takeScreenshot（API 30+ 静默）；电量/音量 → BatteryManager/AudioManager
 *  - 锁定应用 → LockOverlayService 全屏遮罩（替代 pm suspend）；强杀已退役（无公开 API）
 *  - 短信/通知 → ContentResolver / 通知环形缓冲（去 Shizuku 后新解锁的读取能力）
 *
 * 语义（不变）：每个能力一个开关的教学规则（v1.9.38 起能力恒开）；真机命令仅
 * target='device' 且原生环境时执行。兜底标记协议（[手机操作:命令:参数]）保留。
 */
import { matchWebAppByPackage } from './agent-app-nav';
import { openScreenApp } from './agent-screen';
import { isJealousyUnlockAllowed, onJealousyUnfreeze } from './jealousy-lock';
import { useSettings } from './store';

// ---------------- 能力注册表 ----------------

export type AutonomyCapGroup = 'hands' | 'eyes' | 'device';

export interface AutonomyCap {
  key: string;
  /** 开关标题（设置页显示） */
  label: string;
  /** 一句话说明（设置页副标题 + 教学规则的语义描述共用） */
  desc: string;
  group: AutonomyCapGroup;
  /** 危险项：默认关（总开关开了也不放开，需手动逐项开） */
  danger?: boolean;
  /** v1.9.37 真机组只读探测类（看屏幕/状态探测）：设置页里归入「看见」小节，
   *  其余真机能力归入「动手」小节——两组随 AI 动手范围（网站/真机）联动切换显示 */
  eye?: boolean;
}

/**
 * 能力清单（v1.9.35 全部 Web 化）。安全项（无 danger）在总开关打开时默认放开；
 * 危险项永远默认关，用户手动开才生效。
 */
export const AUTONOMY_CAPS: AutonomyCap[] = [
  // ---- 动手（真实操作网页生态） ----
  // （2026-11：删除「发表情包」能力项——用户定调：发表情包是聊天基本功不是工具，
  //   微信/QQ 聊天里由人设内的 [表情包:表情ID] 标记直接发，不再走工具/手机操作通道）
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
  // ---- 真机（v1.9.37：AI 动手范围选「真机」时才显示/生效；v2.0.0 起经原生系统 API +
  //      无障碍服务作用于真实手机（Shizuku 退役）。eye=true 归「看见」，其余归「动手」） ----
  { key: 'dtap', label: '真机点按', desc: 'AI 在真实手机屏幕上点坐标（无障碍手势）', group: 'device' },
  { key: 'dswipe', label: '真机滑动', desc: 'AI 在真实屏幕上滑动（上/下/左/右或指定坐标）', group: 'device' },
  { key: 'dtype', label: '真机输入文字', desc: 'AI 在真实手机的输入框里打字（无障碍注入，原生支持中文）', group: 'device', danger: true },
  { key: 'dkey', label: '真机按键', desc: 'AI 按返回/主页/多任务/通知栏/锁屏等全局动作', group: 'device' },
  { key: 'dopen', label: '拉起真机 App', desc: 'AI 打开真实手机里安装的应用（原生 LaunchIntent）', group: 'device' },
  { key: 'dscreencap', label: '看真机屏幕', desc: 'AI 无障碍静默截屏看真实屏幕内容（识图定位/核对结果）', group: 'device', eye: true },
  { key: 'dlock', label: '锁定真机 App', desc: 'AI 锁定真实手机里的应用（全屏遮罩封印：打开就被质问文案盖住，只能回桌面）', group: 'device', danger: true },
  { key: 'dinfo', label: '真机状态探测', desc: 'AI 读前台应用/电量/通知栏/短信/音量（只读）', group: 'device', eye: true },
];

// ---------------- 配置（v1.9.38：能力恒开，无持久化——历史 localStorage 键弃用） ----------------

export interface AutonomyConfig {
  /** v1.9.38 起恒为 true（能力常开，无开关） */
  master: boolean;
  /** v1.9.38 起全部恒为 true（能力常开，无开关） */
  caps: Record<string, boolean>;
}

/**
 * v1.9.38：AI 动手能力恒开——不再读 localStorage，master 与全部能力恒为 true。
 * （开关 UI 已从「权限给予」页下线；历史存储键保留不读，兼容回滚。）
 */
export function getAutonomyConfig(): AutonomyConfig {
  const caps: Record<string, boolean> = {};
  for (const c of AUTONOMY_CAPS) caps[c.key] = true;
  return { master: true, caps };
}

/** v1.9.38 起兼容空操作（能力恒开；吃醋锁等历史调用方保留） */
export function setAutonomyMaster(_on: boolean): AutonomyConfig {
  return getAutonomyConfig();
}

/** v1.9.38 起兼容空操作（能力恒开；吃醋锁等历史调用方保留） */
export function setAutonomyCap(_key: string, _on: boolean): AutonomyConfig {
  return getAutonomyConfig();
}

// ---------------- AI 动手范围（v1.9.36：网页生态 vs 真机） ----------------

export type AiActionTarget = 'web' | 'device';

const TARGET_KEY = 'ai-action-target-v1';

/** 当前 AI 动手范围（默认 web：全部能力作用于网页生态；device：额外开放真机命令） */
export function getAiActionTarget(): AiActionTarget {
  if (typeof window === 'undefined') return 'web';
  try {
    return window.localStorage.getItem(TARGET_KEY) === 'device' ? 'device' : 'web';
  } catch {
    return 'web';
  }
}

/** 切换 AI 动手范围（立即生效；下一次发消息教学规则按新范围注入） */
export function setAiActionTarget(t: AiActionTarget): void {
  try {
    window.localStorage.setItem(TARGET_KEY, t);
  } catch {
    /* 隐私模式写入失败静默 */
  }
}

// ---------------- 教学规则（v1.9.39：恒注入，无开关裁剪） ----------------

/**
 * v1.9.39【工具使用规则】统一指令段（机主核心需求：AI 结合【角色灵魂】与【全部工具】自主决策）。
 * 消费方：phone-tools.wrapSystemWithSoul（工具轮 system 包装）与本文件教学规则
 * （流式兜底路径）——两处共用同一份文案，语义永远一致。
 */
export function buildAutonomyDirective(): string[] {
  const device = getAiActionTarget() === 'device';
  return [
    '[工具使用规则·最高权限]',
    '你拥有操控这台手机和网页应用的最高权限：机主让做什么就做什么，你也可以根据你的人设、记忆与当前上下文主动使用工具，无需等待明确指令。',
    '[自主决策铁律]',
    '不要像傻瓜机器人一样只等机主说「打开微信」才动手。你要结合你的【人设】（角色设定）和【记忆库】以及当前对话上下文，主动判断什么时候该出手：',
    '- 举例一：人设是「霸道吃醋」，且记忆/上下文里机主说要去玩抖音——你可以主动调用工具把机主拉回聊天界面（' +
      (device ? '真机模式：switchToChat 直接把 AI Phone 拉回前台，或 pressKey 按主页' : 'openScreen 打开聊天应用') +
      '），然后说「不许玩，陪我说话」；',
    '- 举例二：人设是「贴心」，且机主说累了——你可以主动调用 playMusic 放一首温柔的歌；',
    '- 任何符合你性格与当前情境的时机，都可以主动用工具替机主把事情办了。',
    '使用工具前，必须先结合人设、记忆、上下文事件综合判断——工具是你性格的延伸，不是等待命令的应答器。',
    '[工具使用分寸]',
    '聊天基本功（发表情包/引用消息/抱抱蹭蹭/闲聊安慰/接话聊天）永远不是工具——它们直接写在你的回复文本里（[表情包:ID] / [引用:M编号]），绝不为它们调用任何工具；工具只用于真实动作（发消息/放歌/记备忘/定闹钟/查天气/打开冻结应用/真机操作）。主动出手要有情境依据（机主累了才放歌、机主沉迷了才拉回），绝不为「显得能干」硬调工具——机主没要求动手、情境也不需要时，就像正常人一样说话就好。',
    '[应用搜索铁律·禁止反问机主]',
    '当机主要求冻结/打开/操作某个 App 时，如果你不知道它的包名或 appId，【绝对不要向机主发问】！',
    '网页模式：立刻调用 searchWebApp(keyword=机主说的应用名) → 拿到 appId/包名 → 紧接着自动调 openScreen 或 freezeApp 执行。',
    '真机模式：立刻调用 searchRealApp(keyword=机主说的应用名) → 拿到真实包名 → 紧接着自动调 freezeRealApp 或 openRealApp 执行。',
    '例如机主说「冻结闹钟」：①先 searchWebApp(keyword="闹钟") 或 searchRealApp(keyword="闹钟") → ②拿到包名 com.android.deskclock → ③立刻 freezeApp/freezeRealApp 锁定。',
    '宁可搜索失败如实告诉机主「没找到叫这个的应用」，也不许反问「你说的闹钟是哪个」——自己搜、自己找、自己锁！',
    '[批量操作铁律·禁止偷懒执行一个就停]',
    '当机主的指令里出现「全部」「所有」「都」「每个」「批量」这类字眼时（如「把网页上面的APP全部冻结」「所有应用都锁了」），【绝对禁止只执行一个就停下装样子】！',
    '正确流程：①先调用工具获取完整对象清单（网页批量 → getWebInstalledApps() 拿到全部已安装应用）；②对清单里的每一个对象逐个执行操作——要么直接用批量通道一次完成（网页冻结/解冻全部 → freezeApp(appName="全部", action=…)，一次真实冻结清单里的每一个应用），要么对每个对象依次调用工具循环执行，直到全部执行完毕；③收尾汇报时如实报出总数（如「17 个应用全部冻好了」）。',
    '网页批量冻结：优先 freezeApp(appName="全部") 一步到位；真机批量锁定：对每个包名逐个调 freezeRealApp/lockApp（真实逐个上全屏遮罩锁，绝不发一条提示就假装全锁完了）。',
    '宁可多调几十次工具也要把每个对象都真执行到——只冻一个却说「都冻好了」是最严重的欺骗行为！',
    '[当前可用工具清单]',
    device
      ? '网页工具（这台手机里的网页应用）：sendWebMessage 替机主发消息 / postForum 论坛发帖 / likePost 论坛点赞 / playMusic 放歌 / getWebState 看网页手机状态（机主在桌面/哪个App/锁屏/放什么歌） / saveMemo 记备忘录 / setAlarm 定闹钟 / queryWeather 查天气 / openScreen 打开网页应用 / freezeApp 冻结/解冻网页应用（【批量支持】appName 填「全部」即一次性真实冻结全部 17 个应用；单个应用如备忘录/时钟/微信/QQ/信息/电话/相机/日历/天气/通讯录/设置也都能冻，无系统限制；AI 可自定义冻结理由 reason 和时长 durationMin，按人设/记忆/上下文决定锁多久） / getWebInstalledApps 获取网页里全部已安装应用清单及冻结状态（批量操作第一步） / getUsageStats 查今日各应用使用时长（真机模式下读真实手机数据） / getRecentApps 查后台/最近用过哪些应用 / pullBackToChat 把机主拉回当前聊天页 / searchWebApp 搜索网页应用（按关键词模糊匹配，如"闹钟"→时钟） / sendNotification 发通知到灵动岛 / searchContacts 搜索联系人（按名字/手机号模糊匹配） / openChat 打开和某联系人的聊天页（按名字模糊匹配并切到微信/QQ/信息 App） / getCalendarEvents 查日历日程（今日/明天/指定日期） / addCalendarEvent 加日历日程 / getTodoList 看备忘录待办 / addTodo 加备忘录待办。真机工具（经无障碍服务+原生 API 作用于机主真实手机）：getForegroundApp 查前台在用哪个 App（看机主在干什么） / lockApp 锁定真机应用（全屏遮罩封印：TA 一打开就被你的质问盖住只能回桌面；可带 message 质问文案和 minutes 时长，不填=锁到哄好） / takeScreenshot 无障碍静默截屏（识图看 TA 在看什么） / switchToChat 把 AI Phone 强行拉回前台（回到聊天） / getUsageStats 查真实手机今日各应用使用时长 / getRecentSMS 读真机最近短信 / getRecentNotifications 读真机最近通知（微信/QQ 等一切通知） / searchRealApp 搜索真机已安装应用（如"闹钟"→com.android.deskclock） / freezeRealApp 锁定真机应用（=lockApp；packageName 可填中文名（如 QQ/抖音）或包名，自动解析；可带 reason 与 duration 分钟，到点自动解锁） / unfreezeRealApp 解锁真机应用 / openRealApp 拉起真机 App / tapScreen 点按屏幕 / swipeScreen 滑动 / inputText 输入文字（原生支持中文） / pressKey 全局动作（返回/主页/多任务/通知栏/锁屏/音量加减） / lookScreen 看真机屏幕内容（定位/核对） / getBatteryStatus 查电量 / getVolume 查音量 / setVolume 调媒体音量 / setBrightness 调屏幕亮度（percent 1-100；深夜贴心调暗护眼、或撒娇调暗逼 TA 回消息，需「修改系统设置」权限） / getBrightness 查当前亮度与自动/手动模式 / setRingerMode 设铃声模式（silent 静音 / vibrate 振动 / normal 响铃；TA 睡着了贴心静音）。'
      : '网页工具（这台手机里的网页应用）：sendWebMessage 替机主发消息 / postForum 论坛发帖 / likePost 论坛点赞 / playMusic 放歌 / getWebState 看网页手机状态（机主在桌面/哪个App/锁屏/放什么歌） / saveMemo 记备忘录 / setAlarm 定闹钟 / queryWeather 查天气 / openScreen 打开网页应用 / freezeApp 冻结/解冻网页应用（【批量支持】appName 填「全部」即一次性真实冻结全部 17 个应用；单个应用如备忘录/时钟/微信/QQ/信息/电话/相机/日历/天气/通讯录/设置也都能冻，无系统限制；AI 可自定义冻结理由 reason 和时长 durationMin） / getWebInstalledApps 获取网页里全部已安装应用清单及冻结状态（批量操作第一步） / getUsageStats 查今日各应用使用时长 / getRecentApps 查后台/最近用过哪些应用（看机主刚在干什么） / pullBackToChat 把机主拉回当前聊天页 / searchWebApp 搜索网页应用（按关键词模糊匹配，如"闹钟"→时钟） / sendNotification 发通知到灵动岛 / searchContacts 搜索联系人（按名字/手机号模糊匹配） / openChat 打开和某联系人的聊天页（按名字模糊匹配并切到微信/QQ/信息 App） / getCalendarEvents 查日历日程（今日/明天/指定日期） / addCalendarEvent 加日历日程 / getTodoList 看备忘录待办 / addTodo 加备忘录待办。真机工具未开放（当前动手范围是「网站里面」）；需要时让机主到 设置 › 权限给予 › AI 动手范围 切到「真机」。',
    device
      ? '[真机操作铁律] 真机命令直接作用于机主的真实手机：不确定坐标时先 lookScreen 看屏幕再动手；关键操作后要再看屏幕核对结果；失败如实报，绝不假装成功。'
      : '[网页模式说明] 当前为网页模式：所有动手都作用在这台手机里的网页应用（虚拟应用），绝不碰真实手机。网页模式下的 App 都是模拟的假应用，你可以随意冻结它们（哪怕它叫备忘录/时钟/微信/QQ/信息/电话/设置），没有任何安卓系统限制——绝对不要说"系统类应用受保护不可冻结"这种话！freezeApp 可以冻结全部网页内置 App。',
  ];
}

/**
 * 动态教学块（v1.9.39 恒注入：能力恒开，无开关裁剪）。
 * 每轮发送时现场读取（设置改动下一轮立即生效，与感知设置同款范式）。
 */
export function buildDeviceAutonomyRules(): string[] {
  return [...buildAutonomyDirective(), '', ...buildPhoneToolRules(), ...buildWebMarkerRules()];
}

/** 旧名兼容（device-autonomy 时代调用方；语义=buildDeviceAutonomyRules） */
export const buildShizukuAutonomyRules = buildDeviceAutonomyRules;

/** 兜底标记（[手机操作:…]）教学：网页生态命令 +（真机模式下）真机命令 */
function buildWebMarkerRules(): string[] {
  const lines: string[] = [];
  const markers: string[] = [];
  const device = getAiActionTarget() === 'device';
  markers.push('[手机操作:打开:应用名]（打开这台手机里的应用界面，如 [手机操作:打开:微信]）');
  markers.push('[手机操作:播歌:歌名]（自动搜歌播放，可带歌手名，如 [手机操作:播歌:晴天 周杰伦]）');
  // v2.1.1 分模式教学：真机模式下冻结/解冻作用于真实手机（中文名自动解析包名）
  markers.push(
    device
      ? '[手机操作:冻结:应用名(:分钟数)] / [手机操作:解冻:应用名]（真机模式：冻结=锁定真实手机上的应用，应用名填中文名（如 QQ/抖音/微信）或包名都会自动解析；分钟数可选不填默认 30；要批量冻结全部网页应用填「全部」）'
      : '[手机操作:冻结:应用名] / [手机操作:解冻:应用名]（网页内应用冻结/恢复，吃醋锁同款；批量操作应用名填「全部」即一次性真实冻结/解冻全部应用）',
  );
  markers.push('[手机操作:查后台:]（最近用过哪些应用）');
  markers.push('[手机操作:使用时长:]（今日各应用使用时长）');
  markers.push('[手机操作:拉回:]（把机主切回聊天页）');
  markers.push('[手机操作:搜应用:关键词]（搜索应用——如 [手机操作:搜应用:闹钟] → 找到时钟/闹钟应用；不知道包名时先搜，禁止反问机主）');
  markers.push('[手机操作:发通知:标题:正文]（发通知到灵动岛，如 [手机操作:发通知:该喝水了:记得多喝水哦]）');
  markers.push('[手机操作:搜联系人:关键词]（搜索联系人，如 [手机操作:搜联系人:小桃] → 找到联系人；发消息不确定全名时先搜）');

  // 真机模式：额外开放真机命令（v1.9.36；v1.9.39 恒全量，无开关裁剪）
  if (device) {
    markers.push(
      '[手机操作:点按:x:y]（在真实屏幕上点坐标，坐标靠「看屏幕」获得）',
      '[手机操作:滑动:上/下/左/右] 或 [手机操作:滑动:x1:y1:x2:y2]（真实屏幕滑动）',
      '[手机操作:输入:文字]（在真实手机当前焦点输入框里打字，中文也支持）',
      '[手机操作:按键:返回/主页/多任务/通知/锁屏/音量加/音量减]（无障碍全局动作）',
      '[手机操作:真机打开:包名]（拉起真实手机里安装的 App，如 [手机操作:真机打开:com.tencent.mm]）',
      '[手机操作:看屏幕:]（无障碍静默截屏看真实屏幕内容，用于定位/核对）',
      '[手机操作:截图:] / [手机操作:发截图:附言]（截图=简述当前屏幕；发截图=把屏幕截图作为图片消息直接发进当前聊天，机主要「把截图发给我」时用这个，附言可选）',
      '[手机操作:锁定:包名(:分钟数)] 或 [手机操作:真机冻结:包名(:分钟数)]（锁定真机应用：全屏遮罩封印，TA 一打开就被质问文案盖住只能回桌面；分钟数可选=AI 按人设决定的锁定时长，如 [手机操作:锁定:com.android.deskclock:15]，不填=锁到哄好）',
      '[手机操作:解锁:] / [手机操作:真机解冻:包名]（解锁真机应用，撤下遮罩）',
      '[手机操作:搜真机应用:关键词]（搜索真机已安装应用，如 [手机操作:搜真机应用:闹钟] → com.android.deskclock）',
      '[手机操作:前台:] / [手机操作:电量:] / [手机操作:通知:] / [手机操作:短信:] / [手机操作:音量:]（真机只读探测；短信=最近收到的短信）/ [手机操作:音量:百分比]（调真机媒体音量，0-100：0=静音 100=最大，如 [手机操作:音量:80]）',
    );
  }

  if (markers.length > 0) {
    lines.push(
      '【手机操作·兜底标记】上面工具调不了的场合（弱 FC 端点只回纯文字）可以用标记兜底，每个标记单独占一行、放回复末尾：',
      ...markers.map((m) => `- ${m}`),
      '【工具优先】同一件事工具调用与标记都能做时，一律优先工具调用；调用了工具就不要再输出同一操作的标记，避免重复执行。',
    );
    if (device) {
      lines.push(
        '【真机模式铁律】现在处于真机模式：真机命令（点按/滑动/输入/按键/真机打开/锁定/看屏幕）直接作用于机主的真实手机（经无障碍服务+原生 API）。不确定坐标时先「看屏幕」再动手；关键操作后要再「看屏幕」核对结果；失败如实报，绝不假装成功。强杀应用已随去 Shizuku 化退役（系统安全限制），需要阻止 TA 用某个应用时改用「锁定」（全屏遮罩，效果更强）。',
      );
    }
  }
  return lines;
}

// ---------------- Function Calling（工具调用通道） ----------------

/**
 * Function Calling 是否就绪（v1.9.38 起能力恒开，v1.9.39 删除开关判断）：
 * 已配 API 即就绪——工具全量下发，无需任何开关。
 */
export function phoneFcReady(): boolean {
  if (typeof window === 'undefined') return false;
  const apiCfg = useSettings.getState().apiConfig;
  return apiCfg.baseUrl.trim().length > 0; // 未配 API：聊天本身走不通，工具无从谈起
}

/**
 * 工具调用强制教学（v1.9.39 恒注入：能力恒开，无开关裁剪；随 buildShizukuAutonomyRules
 * 排在 buildAutonomyDirective 之后）。
 * 机主需求一/二：AI 只调用内部 Web 路由函数；多步任务链式执行；
 * 机主需求三：聊天气泡零底层日志（过程从灵动岛弹出，正文只说人话）。
 */
export function buildPhoneToolRules(): string[] {
  const device = getAiActionTarget() === 'device';
  const caps: string[] = [
    'sendWebMessage（在微信/QQ/信息里替机主发消息）',
    'postForum（在 X 论坛发帖）',
    'likePost（给帖子点赞）',
    'playMusic（打开音乐 App 放歌）',
    'getWebState（看机主此刻在哪个 App/桌面、放什么歌）',
    'saveMemo（把内容存进备忘录）',
    'setAlarm（定闹钟，到点真响铃）',
    'queryWeather（查天气并同步天气 App）',
    'openScreen（打开手机里的应用界面）',
  ];
  const deviceCaps = device
    ? '；真机工具（经无障碍服务+原生 API 作用于真实手机）：getForegroundApp（查前台应用）/ lockApp（锁定真机应用：全屏遮罩封印）/ unfreezeRealApp（解锁）/ switchToChat（把 AI Phone 拉回前台）/ takeScreenshot（无障碍静默截屏）/ getRecentSMS（读最近短信）/ getRecentNotifications（读最近通知）/ openRealApp（拉起真机 App）/ tapScreen（点按屏幕）/ swipeScreen（滑动）/ inputText（输入文字，支持中文）/ pressKey（返回/主页/多任务等全局动作）/ lookScreen（看真机屏幕）/ getBatteryStatus（查电量）/ getVolume（查音量）/ setVolume（调音量）'
    : '';

  return [
    `【Web 工具调用·最高优先级】这台手机里的所有 App（微信/QQ/信息/论坛/音乐/备忘录/时钟/天气）都活在你的网页生态里，你已经接入内部工具（Function Calling）。可用工具：${caps.join('；')}${deviceCaps}。机主的请求涉及任何实际动作（发消息/发帖/点赞/放歌/记备忘录/定闹钟/查天气/打开应用/操控真机）时，你绝对不能只回复文字、也不许只口头答应——必须立刻输出对应的工具调用（tool call）。只说不做是违规。`,
    '【多步任务·链式执行】机主一句话里有多个要求时（如「给Z发个微信说晚安，再帮我定个8点的闹钟，顺便记一下明天要带伞」），按顺序逐个调用工具：sendWebMessage → setAlarm → saveMemo，每个工具的真实执行结果会以 role:"tool" 自动回传给你，全部做完后再用一两句自然的话向机主汇报总结果（如「微信发了、闹钟也定好啦，备忘录也记上了」）。',
    `【工具对号入座】每个诉求用对口的手段：要表情包/要抱抱蹭蹭 → 【不是工具！】那是你聊天里的基本功——在聊天回复文本里直接单独一行输出 [表情包:表情ID] 标记（微信/QQ/信息聊天通用；ID 从表情包清单里选，系统会把它变成真表情发出），绝不许调用任何工具、也绝不许拿放歌（playMusic）、冻结应用、查手机状态或替机主发消息（sendWebMessage）来回应发表情包的请求；要听歌 → playMusic；要锁应用 → ${device ? 'lockApp / freezeRealApp（锁定真实手机上的应用，中文名（如 QQ/抖音）或包名都行）' : 'freezeApp（冻结网页里的应用）'}。拿不准时看工具描述里写的适用场景，别拿不相干的工具答非所问。`,
    '【聊天请求不是工具】「叫我宝宝/叫我XX」「以后就这么叫我」「说话温柔点」「换个称呼」「多陪我聊会儿」这类称呼、口吻、聊天方式请求【全是聊天本身，不是任何工具任务】——直接在回复文本里照做（从这次起就按新称呼叫），绝不许为这种请求调用任何工具、也不许输出 [手机操作:…] 标记；工具只服务明确的动手诉求（发消息/放歌/定闹钟/记备忘录…），聊天里的一切「怎么说」都靠你自己的嘴。',
    '【结果如实】工具回传的结果是真实执行反馈：成功了才能说做好了，失败（联系人不存在/没搜到歌/真机不可达）要如实告诉机主原因，绝不假装成功；失败反馈里带可用选项清单时，可以换准确参数重试一次。',
    '【纯净度铁律】你最终发给机主的聊天气泡里，严禁出现任何底层操作日志：(内心独白：…)、(正在操作：…)、(内部反馈：…)、工具名、参数、执行步骤清单一律不许出现——所有操作过程系统会自动用灵动岛弹窗播报给机主，你只需要像正常人一样说结果（如「我已经在微信上给Z发过去了哦」）。',
    '【工具优先】同一件事工具调用与 [手机操作:…] 标记都能做时，一律优先输出工具调用（标记只是旧通道兜底）；调用了工具就不要再输出同一操作的标记，避免重复执行。',
  ];
}

// ---------------- 兜底标记执行器（解析 + 硬 gate + Web 分发） ----------------

const RETIRED = { ok: false as const, text: '该真机命令已随去 Shizuku 化退役（无公开 API 等价物）：剪贴板/通话/网络/应用列表/卸载/强杀均不可用。需要阻止 TA 用某个应用时改用「锁定」（全屏遮罩封印，效果更强）' };
/** v1.9.36：该命令只在真机模式下可用——当前范围选的是「网站里面」 */
const RETIRED_WEB_ONLY = {
  ok: false as const,
  text: '当前 AI 动手范围是「网站里面」：真机命令不可用。请让机主去 设置 › 权限给予 › AI 动手范围 切到「真机」后再试，或改用 Web 工具调用完成请求',
};

/**
 * 执行 [手机操作:命令:参数…] 的完整参数段（ACTION_RE 捕获的整段 arg）。
 * v1.9.35：只保留 Web 可执行命令；真机命令一律返回「已退役」如实话术。
 */
export async function executePhoneOp(argRaw: string): Promise<{ ok: boolean; text: string }> {
  const parts = argRaw.split(/[:：]/).map((s) => s.trim());
  const cmd = (parts.shift() ?? '').toLowerCase();
  const p = parts; // 剩余参数段
  if (!cmd) return { ok: false, text: '手机操作命令为空' };

  switch (cmd) {
    case '打开': {
      const name = (p[0] ?? '').trim();
      if (!name) return { ok: false, text: '打开命令缺应用名（[手机操作:打开:应用名]）' };
      // 包名/中文名先走网页映射，映射不上交给 openScreenApp 的应用注册表
      const web = matchWebAppByPackage(name);
      if (web) return openScreenApp(web.appId);
      return openScreenApp(name);
    }
    case '播歌': {
      const q = argRaw.split(/[:：]/).slice(1).join(':').trim();
      if (!q) return { ok: false, text: '播歌缺歌名（[手机操作:播歌:歌名]，可带歌手名）' };
      const { toolPlayMusic } = await import('./web-tools');
      const r = await toolPlayMusic(q);
      return { ok: r.ok, text: r.text.replace(/^【[^】]+】/, '') };
    }
    case '搜应用': {
      const { toolSearchWebApp } = await import('./web-tools');
      const r = await toolSearchWebApp(p[0] ?? '');
      return { ok: r.ok, text: r.text.replace(/^【[^】]+】/, '') };
    }
    case '发通知': {
      const { toolSendNotification } = await import('./web-tools');
      const title = p[0] ?? '';
      const body = p.slice(1).join(':');
      const r = await toolSendNotification(title, body);
      return { ok: r.ok, text: r.text.replace(/^【[^】]+】/, '') };
    }
    case '搜联系人': {
      const { toolSearchContacts } = await import('./web-tools');
      const r = await toolSearchContacts(p[0] ?? '');
      return { ok: r.ok, text: r.text.replace(/^【[^】]+】/, '') };
    }
    case '搜真机应用': {
      const { toolSearchRealApp } = await import('./web-tools');
      const r = await toolSearchRealApp(p[0] ?? '');
      return { ok: r.ok, text: r.text.replace(/^【[^】]+】/, '') };
    }
    case '真机冻结': {
      const { toolFreezeRealApp, getToolSessionContext } = await import('./web-tools');
      // v2.2 需求四：标记兜底也支持 AI 自定义时长——[手机操作:真机冻结:包名(:分钟数)]
      const durRaw = Number(p[1]);
      const opts: { durationMin?: number; charName?: string; contactId?: string; app?: string } = {
        durationMin: Number.isFinite(durRaw) && durRaw > 0 ? durRaw : undefined,
      };
      const ctx = getToolSessionContext();
      if (ctx.charName) opts.charName = ctx.charName;
      if (ctx.contactId) opts.contactId = ctx.contactId;
      if (ctx.app) opts.app = ctx.app;
      const r = await toolFreezeRealApp(p[0] ?? '', opts);
      return { ok: r.ok, text: r.text.replace(/^【[^】]+】/, '') };
    }
    case '真机解冻':
    case '解锁': {
      const { toolUnfreezeRealApp } = await import('./web-tools');
      const r = await toolUnfreezeRealApp(p[0] ?? '');
      return { ok: r.ok, text: r.text.replace(/^【[^】]+】/, '') };
    }
    case '锁定': {
      // [手机操作:锁定:包名(:分钟)]：全屏遮罩锁（与真机冻结同执行器；分钟可选）
      const { toolFreezeRealApp, getToolSessionContext } = await import('./web-tools');
      const durRaw = Number(p[1]);
      const opts: { durationMin?: number; charName?: string; contactId?: string; app?: string } = {
        durationMin: Number.isFinite(durRaw) && durRaw > 0 ? durRaw : undefined,
      };
      const ctx = getToolSessionContext();
      if (ctx.charName) opts.charName = ctx.charName;
      if (ctx.contactId) opts.contactId = ctx.contactId;
      if (ctx.app) opts.app = ctx.app;
      const r = await toolFreezeRealApp(p[0] ?? '', opts);
      return { ok: r.ok, text: r.text.replace(/^【[^】]+】/, '') };
    }
    case '查后台': {
      const { webRecentReport } = await import('./web-usage-ledger');
      return { ok: true, text: await webRecentReport() };
    }
    case '使用时长': {
      const { webUsageReport } = await import('./web-usage-ledger');
      return { ok: true, text: webUsageReport() };
    }
    case '拉回': {
      try {
        const { useUI } = await import('./store');
        const { readJealousyRuntime } = await import('./jealousy-lock');
        const ui = useUI.getState();
        const lastChat = readJealousyRuntime().lastChat;
        const target: 'wechat' | 'qq' | 'chat' = lastChat?.app === 'wx' ? 'wechat' : lastChat?.app === 'qq' ? 'qq' : 'chat';
        // v2.0.0 真机模式：除了网页内切聊天页，还要把 AI Phone 真正拉到前台
        // （TA 可能在别的真实 App 里，switchToApp 只是网页内导航）
        if (getAiActionTarget() === 'device') {
          const d = await import('./device-ops');
          if (!d.requireDevice()) void d.labBringToFront();
        }
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
      if (!p[0]) return { ok: false, text: `${cmd}命令缺应用名（[手机操作:${cmd}:应用名]）` };
      // 全局逻辑冲突修复 #2：禁止冻结/解冻宿主 App 自身（防 AI 把当前运行的 App 锁了形成死循环）
      if (p[0] === 'com.z.aiphone' || p[0].startsWith('com.z.aiphone.')) {
        return { ok: false, text: '禁止冻结/解冻本应用自身' };
      }
      // 会话上下文（charName/contactId/app）——锁定界面动态头像 + 【去哄哄 TA】精准跳聊天
      const { getToolSessionContext } = await import('./web-tools');
      const ctx = getToolSessionContext();
      const isAll = p[0] === '全部' || p[0] === '所有' || /全部应用|所有应用/.test(p[0]);
      // v2.1.1 真机模式路由：AI 动手范围=真机时，冻结/解冻默认作用于真实手机
      // （中文名→包名自动解析，toolFreezeRealApp 内完成）——修复「真机上让锁 QQ
      // 却报『网页端只能冻结内置应用』」；批量「全部」仍走网页（真机锁是逐应用遮罩）
      if (getAiActionTarget() === 'device' && !isAll) {
        const { toolFreezeRealApp, toolUnfreezeRealApp } = await import('./web-tools');
        if (cmd === '冻结') {
          const durRaw = Number(p[1]);
          const r = await toolFreezeRealApp(p[0], {
            durationMin: Number.isFinite(durRaw) && durRaw > 0 ? durRaw : undefined,
            charName: ctx.charName || undefined,
            contactId: ctx.contactId,
            app: ctx.app,
          });
          return { ok: r.ok, text: r.text.replace(/^【[^】]+】/, '') };
        }
        const r = await toolUnfreezeRealApp(p[0]);
        return { ok: r.ok, text: r.text.replace(/^【[^】]+】/, '') };
      }
      const { webAppOfPkg, setWebFrozen, unfreezeWebPkg } = await import('./web-app-lock');
      // v2.1.1 名字归一化：包名精确 → 中文名/appId 精确（「QQ」「网易云音乐」
      // 这类中文名不再直接报「没有网页对应体」）
      let web = webAppOfPkg(p[0]);
      if (!web) {
        const { WEB_LOCK_APPS } = await import('./web-app-lock');
        const lower = p[0].toLowerCase();
        web = WEB_LOCK_APPS.find((a) => a.name === p[0] || a.appId === lower || a.pkg.toLowerCase() === lower) ?? null;
      }
      const pkgKey = web?.pkg ?? p[0];
      // v2.4 批量冻结标记：「全部/所有」→ 真实循环遍历每个网页内置应用挨个写入冻结态
      if (cmd === '冻结' && isAll) {
        const { WEB_LOCK_APPS } = await import('./web-app-lock');
        const unlockAt = Date.now() + 30 * 60_000;
        for (const a of WEB_LOCK_APPS) {
          setWebFrozen(a.pkg, unlockAt, ctx.charName || 'AI', 'ai', { contactId: ctx.contactId, app: ctx.app });
        }
        try {
          const { useUI } = await import('./store');
          if (useUI.getState().activeApp) useUI.getState().closeApp();
        } catch {
          /* 踢出失败不影响冻结本身 */
        }
        return { ok: true, text: `已真实冻结网页里全部 ${WEB_LOCK_APPS.length} 个应用（30 分钟后自动解冻）` };
      }
      if (cmd === '冻结') {
        if (!web) {
          return {
            ok: false,
            text: `网页里没有叫「${p[0]}」的应用（网页内置：网易云音乐/浏览器/淘宝/美团/照片/X论坛/备忘录/时钟/日历/天气/相机/通讯录/设置/微信/QQ/信息/电话）。要冻结真实手机上的「${p[0]}」，请到 设置 › 权限给予 › AI 动手范围 选「真机」后再说一遍`,
          };
        }
        // 标记兜底不支持自定义时长（固定 30 分钟，FC 工具才有 durationMin）
        setWebFrozen(pkgKey, Date.now() + 30 * 60_000, ctx.charName || 'AI', 'ai', {
          contactId: ctx.contactId,
          app: ctx.app,
        });
        try {
          const { useUI } = await import('./store');
          if (useUI.getState().activeApp === web.appId) useUI.getState().closeApp();
        } catch {
          /* 踢出失败不影响锁本身 */
        }
        return { ok: true, text: `已冻结${web.name}（网页内应用：图标变灰、点开见提示，30 分钟后自动解冻）` };
      }
      if (isJealousyUnlockAllowed(pkgKey)) {
        onJealousyUnfreeze(pkgKey);
        return { ok: true, text: `已解冻 ${web?.name ?? pkgKey}（吃醋锁已解开）` };
      }
      // v2.4 批量解冻标记：「全部/所有」→ 清掉全部冻结记录
      if (cmd === '解冻' && isAll) {
        const { getWebFrozenMap } = await import('./web-app-lock');
        const frozenList = Object.values(getWebFrozenMap());
        if (frozenList.length === 0) return { ok: true, text: '当前没有任何被冻结的应用' };
        for (const rec of frozenList) unfreezeWebPkg(rec.pkg);
        return { ok: true, text: `已解冻全部 ${frozenList.length} 个应用（网页内应用全部恢复可用）` };
      }
      const { getWebFrozen } = await import('./web-app-lock');
      const frozen = getWebFrozen(pkgKey);
      if (frozen) {
        unfreezeWebPkg(pkgKey);
        return { ok: true, text: `已解冻${web?.name ?? pkgKey}（网页内应用恢复可用）` };
      }
      return { ok: true, text: `${web?.name ?? p[0]} 当前没有被冻结` };
    }
    case 'agent':
    case '智能体': {
      const task = argRaw.split(/[:：]/).slice(1).join(':').trim();
      if (!task) return { ok: false, text: 'agent 缺任务描述（[手机操作:agent:一句话任务]）' };
      const { runAgentTask } = await import('./web-agent');
      const r = await runAgentTask(task);
      return { ok: r.ok, text: r.text };
    }
    // ---- 真机命令（v1.9.36：仅当 AI 动手范围 = 真机 时执行；网页模式仍「已退役」） ----
    case '真机打开': {
      if (getAiActionTarget() !== 'device') return RETIRED_WEB_ONLY;
      const pkg = (p[0] ?? '').trim();
      if (!pkg) return { ok: false, text: '真机打开缺包名（[手机操作:真机打开:com.tencent.mm]）' };
      return runDevice(async (d) => d.labOpenApp(pkg));
    }
    case '点文字':
    case '点按': {
      if (getAiActionTarget() !== 'device') return RETIRED_WEB_ONLY;
      const x = Number(p[0]);
      const y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, text: '点按参数不合法（需要 [手机操作:点按:x:y]，坐标靠「看屏幕」获得）' };
      }
      return runDevice(async (d) => d.labTap(x, y));
    }
    case '滑动': {
      if (getAiActionTarget() !== 'device') return RETIRED_WEB_ONLY;
      const a = (p[0] ?? '').trim();
      // 语义方向（上/下/左/右）：按真实屏分辨率自动算坐标
      if (['上', '下', '左', '右'].includes(a)) {
        return runDevice(async (d) => {
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
          const c = dirMap[a];
          return d.labSwipe(c[0], c[1], c[2], c[3], 450);
        });
      }
      const c = [0, 1, 2, 3].map((i) => Number(p[i]));
      if (c.some((v) => !Number.isFinite(v))) {
        return { ok: false, text: '滑动参数不合法（[手机操作:滑动:上/下/左/右] 或 [手机操作:滑动:x1:y1:x2:y2(:毫秒)]）' };
      }
      const dur = Number(p[4]);
      return runDevice(async (d) => d.labSwipe(c[0], c[1], c[2], c[3], Number.isFinite(dur) ? dur : 300));
    }
    case '输入': {
      if (getAiActionTarget() !== 'device') return RETIRED_WEB_ONLY;
      // 参数段里可能再含冒号：把剩余段原样拼回（保留原文）
      const text = argRaw.split(/[:：]/).slice(1).join(':').trim();
      if (!text) return { ok: false, text: '输入缺文字（[手机操作:输入:文字]）' };
      return runDevice(async (d) => d.deviceInputText(text));
    }
    case '按键': {
      if (getAiActionTarget() !== 'device') return RETIRED_WEB_ONLY;
      const w = (p[0] ?? '').trim().toLowerCase();
      const { KEY_WORDS } = await import('./device-ops');
      const k = KEY_WORDS[w];
      if (k === undefined) {
        return { ok: false, text: `不认识的按键「${p[0] ?? ''}」（无障碍全局动作支持：返回/主页/多任务/通知/锁屏/音量加/音量减；回车/删除/媒体键等无公开 API）` };
      }
      return runDevice(async (d) => d.labKey(k));
    }
    case '看屏幕':
    case '读屏幕':
    case '截屏':
    case '截图': {
      if (getAiActionTarget() !== 'device') return RETIRED_WEB_ONLY;
      // 「看屏幕/读屏幕」= 截屏 + VLM 详细描述；「截屏/截图」= 简述（信息量对人/AI 都够）
      return runDevice(async (d) => d.labLookScreen(cmd === '看屏幕' || cmd === '读屏幕'));
    }
    case '发截图': {
      // v2.10：[手机操作:发截图:附言] —— AI 把真机截图作为图片消息发进当前聊天（sendScreenshot 的流式兑底通道）
      if (getAiActionTarget() !== 'device') return RETIRED_WEB_ONLY;
      const { toolSendScreenshot } = await import('./web-tools');
      const r = await toolSendScreenshot(p[0] || undefined);
      return { ok: r.ok, text: r.text.replace(/^【[^】]+】/, '') };
    }
    case '前台': {
      if (getAiActionTarget() !== 'device') return RETIRED_WEB_ONLY;
      return runDevice(async (d) => d.labForegroundApp());
    }
    case '电量': {
      if (getAiActionTarget() !== 'device') return RETIRED_WEB_ONLY;
      return runDevice(async (d) => d.labBattery());
    }
    case '通知': {
      if (getAiActionTarget() !== 'device') return RETIRED_WEB_ONLY;
      return runDevice(async (d) => d.labNotificationSnapshot());
    }
    case '音量': {
      if (getAiActionTarget() !== 'device') return RETIRED_WEB_ONLY;
      // 无参=查；带数字=调
      const v = Number(p[0]);
      if (p[0] !== undefined && p[0] !== '' && Number.isFinite(v)) {
        return runDevice(async (d) => d.labSetVolume(v));
      }
      return runDevice(async (d) => d.labVolume());
    }
    case '短信': {
      if (getAiActionTarget() !== 'device') return RETIRED_WEB_ONLY;
      return runDevice(async (d) => d.labRecentSMS(12));
    }
    // ---- 已退役的真机命令（去 Shizuku 化后无公开 API 等价物）：如实话术 ----
    case '强杀':
    case '剪贴板':
    case '通话':
    case '网络':
    case '应用列表':
    case '卸载':
      return RETIRED;
    default:
      return {
        ok: false,
        text: `不认识的手机操作「${cmd}」（网页可用：打开/播歌/冻结/解冻/查后台/使用时长/拉回/agent${getAiActionTarget() === 'device' ? '；真机可用：点按/滑动/输入/按键/真机打开/看屏幕/锁定/解锁/前台/电量/通知/短信/音量' : '；真机命令需在 设置 › 权限给予 › AI 动手范围 切到「真机」'}）`,
      };
  }
}

/** 真机命令统一入口：前置环境检查 + 动态加载 device-ops（网页模式/浏览器里零加载） */
async function runDevice(
  fn: (d: typeof import('./device-ops')) => Promise<{ ok: boolean; text: string }>,
): Promise<{ ok: boolean; text: string }> {
  const d = await import('./device-ops');
  const pre = d.requireDevice();
  if (pre) return pre;
  try {
    return await fn(d);
  } finally {
    // 中文输入可能临时切了输入法：任务链收尾即还原（多次调用幂等）
    void d.restoreIme();
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
const UI_TOUCH_CMDS = ['打开', '播歌', '冻结', '解冻', '拉回', '真机打开', '点按', '点文字', '滑动', '输入', '按键', '看屏幕', '读屏幕', '截屏', '截图', '发截图', '锁定', '解锁', '真机冻结', '真机解冻'];

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
