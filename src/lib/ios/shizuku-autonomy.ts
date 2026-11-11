'use client';

/**
 * Shizuku 自主权（v1.3）：「AI 动手/看见」能力的逐项开关 + AI 自主调用执行器。
 *
 * 语义：每个能力都是一个开关（设置 APP → AI 动手）——
 *  - 关闭：教学规则不注入（AI 不知道自己有这能力）+ 执行器硬拦截（就算 AI 硬输出标记也拒绝）
 *  - 打开：教学规则按当前开关动态注入（AI 学到标记语法），AI 按人设/记忆/上下文自主决定何时用
 *
 * 链路（与红包/放歌动作闭环同构）：
 *  AI 输出 [手机操作:命令:参数] → chat-rich.ts 解析成 kind='phone-op' 的 RichAction →
 *  chat.tsx / wechat.tsx 的 buildReplyMsgs 调 executePhoneOp（此处硬 gate + 分发 shizuku-lab）→
 *  执行结果以灰色系统行落盘，下一轮 AI 天然看到（成功才说成功，失败如实报）。
 *
 * 持久化：localStorage 单键 JSON（仿 perception.ts 的会话级轻量模式；全局共享不分会话——
 * 手机是同一部，没必要按会话隔离）。
 */

import {
  labTap,
  labSwipe,
  labKey,
  KEY_CODES,
  labOpenApp,
  labOpenUri,
  labNowPlaying,
  labForceStop,
  labSetAppFrozen,
  labUninstall,
  labVolume,
  labSvc,
  labScreencap,
  labScreenSize,
  labForegroundApp,
  labNotificationSnapshot,
  labBattery,
  labClipboard,
  labSmsInbox,
  labCallLog,
  labPackageList,
  type LabResult,
} from './shizuku-lab';
import { isNativePerception } from './native-perception';
import { matchWebAppByPackage, openAppPage } from './agent-app-nav';
import { useSettings } from '@/lib/ios/store';

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
 * 能力清单。安全项（无 danger）在总开关打开时默认放开；
 * 危险项（强杀/冻结/卸载/网络/短信/通话）永远默认关，用户手动开才生效。
 */
export const AUTONOMY_CAPS: AutonomyCap[] = [
  // ---- 动手（真实操作手机） ----
  { key: 'tap', label: '点按屏幕', desc: 'AI 自己看屏幕点按钮（自动识图定位文字按钮，或点指定坐标）', group: 'hands' },
  { key: 'swipe', label: '滑动屏幕', desc: 'AI 上滑/下滑/左右滑（翻页、滚动列表）', group: 'hands' },
  { key: 'type', label: '输入文字', desc: 'AI 在输入框打字（中文经 AI 输入引擎自动注入，英文数字直输）', group: 'hands' },
  { key: 'key', label: '按按键', desc: '返回/主页/回车/音量/媒体键等', group: 'hands' },
  { key: 'open', label: '打开应用', desc: 'AI 按包名拉起任意已安装 App', group: 'hands' },
  { key: 'agent', label: '智能体多步任务', desc: 'AI 接管手机连续多步操作（打开→找界面→点击→输入中文→发送），带逐步验证与失败自动重规划；敏感操作会先弹窗征求你的同意', group: 'hands' },
  { key: 'applist', label: '查应用列表', desc: 'AI 查手机装了哪些 App（找包名用）', group: 'hands' },
  { key: 'volume', label: '音量调节', desc: '调高/调低/静音/指定音量值', group: 'hands' },
  { key: 'kill', label: '强杀应用', desc: '立即结束指定 App（防沉迷场景）', group: 'hands', danger: true },
  { key: 'freeze', label: '冻结/解冻应用', desc: '经 Shizuku ADB Shell 执行 pm suspend 挂起应用（图标变灰、提示「由 Shell 所管理」），解冻即恢复（可逆）', group: 'hands', danger: true },
  { key: 'uninstall', label: '卸载应用', desc: '移除 App（可恢复、数据保留，仍需谨慎）', group: 'hands', danger: true },
  { key: 'net', label: '网络开关', desc: 'Wi-Fi/流量/蓝牙的开关（部分 ROM 需 root）', group: 'hands', danger: true },
  // ---- 看见（只读探测） ----
  { key: 'screencap', label: '看屏幕', desc: '截屏+自动识图：当前界面内容与按钮坐标', group: 'eyes' },
  { key: 'foreground', label: '前台应用', desc: '机主当前正在用哪个 App', group: 'eyes' },
  { key: 'notify', label: '通知栏快照', desc: '读最近的通知（App + 标题 + 内容）', group: 'eyes' },
  { key: 'battery', label: '电量状态', desc: '电量百分比 + 是否在充电', group: 'eyes' },
  { key: 'clipboard', label: '读剪贴板', desc: '机主最近复制的内容', group: 'eyes' },
  { key: 'sms', label: '读短信', desc: '最近收件箱（号码 + 内容）', group: 'eyes', danger: true },
  { key: 'calls', label: '读通话记录', desc: '最近通话（姓名/号码/时长）', group: 'eyes', danger: true },
];

const CAP_KEYS = AUTONOMY_CAPS.map((c) => c.key);

/** 常见应用包名速查（「打开/强杀/冻结」用；注入教学规则，免 AI 猜包名） */
const WELL_KNOWN_PACKAGES: [string, string][] = [
  ['微信', 'com.tencent.mm'],
  ['QQ', 'com.tencent.mobileqq'],
  ['抖音', 'com.ss.android.ugc.aweme'],
  ['快手', 'com.smile.gifmaker'],
  ['B站', 'tv.danmaku.bili'],
  ['小红书', 'com.xingin.xhs'],
  ['微博', 'com.sina.weibo'],
  ['淘宝', 'com.taobao.taobao'],
  ['京东', 'com.jingdong.app.mall'],
  ['拼多多', 'com.xunmeng.pinduoduo'],
  ['网易云音乐', 'com.netease.cloudmusic'],
  ['QQ音乐', 'com.tencent.qqmusic'],
  ['番茄小说', 'com.dragon.read'],
  ['王者荣耀', 'com.tencent.tmgp.sgame'],
  ['原神', 'com.miHoYo.Yuanshen'],
  ['设置', 'com.android.settings'],
];

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
    // 清掉已下线的脏键
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

/** 单项能力是否放行（总开关 + 该项开关都开） */
export function isCapEnabled(key: string): boolean {
  const cfg = getAutonomyConfig();
  return cfg.master && cfg.caps[key] === true;
}

// ---------------- 教学规则（按当前开关注入） ----------------

/** 命令语法表：cap key → [手机操作:…] 的写法说明（仅开着的进教学块） */
const CAP_SYNTAX: Record<string, string> = {
  tap: '[手机操作:点文字:文字]（首选：自动看屏幕→定位写着该文字的按钮/图标→点它，例：[手机操作:点文字:下一首]，图标按钮也能认如播放▶/暂停⏸）；也可直接点坐标 [手机操作:点按:x:y]（例：[手机操作:点按:540:1200]，不确定位置就先看屏幕）',
  swipe: '[手机操作:滑动:上/下/左/右]（语义滑动，系统按屏分辨率自动算坐标，例：[手机操作:滑动:上]）；也可全坐标 [手机操作:滑动:x1:y1:x2:y2:毫秒]',
  type: '[手机操作:输入:文字]（支持中文与英文数字，中文自动经输入引擎注入；需输入框已聚焦）',
  key: '[手机操作:按键:名称]（名称：返回/主页/切换/回车/删除/音量加/音量减）',
  open: '[手机操作:打开:包名]（包名见下方速查表；不认识的应用先 [手机操作:应用列表:关键词] 查）',
  播歌: '[手机操作:播歌:歌名]（点名要听某首歌时用：自动云端搜歌→拉起网易云歌曲页自动播放→核实真在播，一条搞定；例：[手机操作:播歌:他不懂]、[手机操作:播歌:晴天 周杰伦]。严禁拆成打开+点文字去找歌名——歌名要搜索才会出现，屏幕上找不到）',
  agent: '[手机操作:agent:一句话任务]（多步真实任务首选。例：[手机操作:agent:给怡怡发微信说我想你了]、[手机操作:agent:打开B站搜索流浪地球2预告片播放]。系统会接管手机执行：看屏幕→自动规划→逐步点击/滑动/输入（支持中文）→验证结果，失败自动重新规划，全程每步播报进度；涉及转账/支付/卸载/删除的步骤会先弹窗征求机主同意。注意：单步就能完成的简单操作（打开个App/点个按钮）不要用 agent，直接用对应的单步命令更省事）',
  applist: '[手机操作:应用列表:关键词]（关键词可省=全部；查到的是包名，配合「打开」用）',
  kill: '[手机操作:强杀:包名]（立即杀掉该 App；适合防沉迷/劝睡场景，配合人设使用）',
  freeze: '[手机操作:冻结:包名] / [手机操作:解冻:包名]（冻结=pm suspend 挂起：图标变灰、提示「由 Shell 所管理」、打不开；解冻=pm unsuspend 即恢复）',
  uninstall: '[手机操作:卸载:包名]（移除应用；除非机主明确要求，否则不要用）',
  volume: '[手机操作:音量:加/减/静音] 或 [手机操作:音量:0~15的数字]',
  net: '[手机操作:网络:开或关:wifi/流量/蓝牙]（例：[手机操作:网络:关:流量]）',
  screencap: '[手机操作:看屏幕]（截屏并自动识别：当前什么App什么页面、可见内容、可点元素及坐标——想确认状态或找目标时用）',
  foreground: '[手机操作:前台]（机主此刻正在用的 App）',
  notify: '[手机操作:通知]（通知栏最近的条目：哪个 App、什么内容）',
  battery: '[手机操作:电量]（电量百分比 + 是否在充电）',
  clipboard: '[手机操作:剪贴板]（机主最近复制的内容）',
  sms: '[手机操作:短信:条数]（条数可省，默认 10；最近收到的短信）',
  calls: '[手机操作:通话:条数]（条数可省，默认 10；最近的通话记录）',
};

/**
 * 动态教学块：总开关关 / 非手机 APP 原生环境 / 无任何单项开着 → 返回 []（零 token）。
 * 每轮发送时现场读取（开关改动下一轮立即生效，与感知设置同款范式）。
 */
export function buildShizukuAutonomyRules(): string[] {
  if (!isNativePerception()) return [];
  const cfg = getAutonomyConfig();
  if (!cfg.master) return [];
  const enabled = AUTONOMY_CAPS.filter((c) => cfg.caps[c.key] === true);
  if (enabled.length === 0) return [];
  const hands = enabled.filter((c) => c.group === 'hands');
  const eyes = enabled.filter((c) => c.group === 'eyes');
  const lines: string[] = [];
  if (hands.length > 0) {
    lines.push('【真实操控手机·动手】你能通过 [手机操作:命令:参数] 标记真实操控机主的手机（Shizuku 引擎）。可用命令（标记单独占一行，放回复末尾）：');
    for (const c of hands) lines.push(`- ${CAP_SYNTAX[c.key]}`);
    // 播歌是复合能力（搜歌在云端）：挂在「打开应用」开关下教学，不单独设开关
    if (cfg.caps['open'] === true) lines.push(`- ${CAP_SYNTAX['播歌']}`);
  }
  if (eyes.length > 0) {
    lines.push('【真实看见手机·只读】想知道手机状态时同样用 [手机操作:命令]（单独占一行）：');
    for (const c of eyes) lines.push(`- ${CAP_SYNTAX[c.key]}`);
  }
  if (hands.some((c) => ['open', 'kill', 'freeze', 'uninstall'].includes(c.key))) {
    const pkgTable = WELL_KNOWN_PACKAGES.map(([n, p]) => `${n}=${p}`).join('，');
    lines.push(`【常用应用包名速查】${pkgTable}。其他应用先查应用列表。`);
  }
  lines.push(
    '【必须动手】机主的请求涉及手机上的任何实际动作（开App/关App/切歌/调音量/查电量/看通知等）时，必须当场用上面的手机操作标记执行——只口头答应“好的我帮你开”却一个标记都不带是违规；不确定包名就先查应用列表再打开。',
    '【像人一样用手机】你操作手机的方式和人一样：看屏幕→找到写着目标文字的按钮→点它。首选 [手机操作:点文字:文字]（系统自动截屏认位再点，图标按钮也认得，如播放▶/暂停⏸/下一首⏭）；不确定界面长什么样就先 [手机操作:看屏幕]（返回当前页面内容与可点元素坐标）；目标不在屏上就 [手机操作:滑动:上/下] 翻页再点。严禁用「媒体」按键指令——系统经常静默丢弃它，显示成功实际没反应；切歌/暂停/播放一律点文字。点文字报“没找到”时不要重复硬点——先看屏幕判断当前在哪，或者该内容根本不在屏幕上（比如歌名要先搜）。',
    '【听歌的两种情况】①机主点名要听某首歌（“放他不懂”“换成晴天”）→ 用 [手机操作:播歌:歌名] 一条搞定（自动搜歌+播放+核实），严禁拆成打开+点文字去找歌名（歌名要搜索才会出现，屏幕上没有）；②只要换歌不点名（“换个歌”“下一首”）→ 打开网易云 + [手机操作:点文字:下一首]。',
    '【多步任务】机主一句话里有多个要求时，把每一步都写成操作标记、按执行顺序排在回复末尾、每个标记单独成一行，系统会自动逐个执行（打开App后的下一步会自动等它启动完成）。经典示例“打开网易云换个歌”＝两行：\n[手机操作:打开:com.netease.cloudmusic]\n[手机操作:点文字:下一首]\n（点文字＝系统看屏幕找到写着「下一首」的按钮点下去；切歌交给App的播放列表，不要多发“播放”——刚打开的音乐App常自动播放，多发反而可能把它暂停）。漏掉任何一步都算没完成。',
  );
  // v1.5 智能体教学块：仅当 agent 开关打开时注入（多步真实任务的首选通道）
  if (cfg.caps['agent'] === true) {
    lines.push(
      '【智能体模式·多步真实任务】机主让你「在真实手机上完成一件需要多个步骤的事」（给某人发微信/QQ消息、去某App搜索某内容、设置里改某个开关等）时，首选输出 [手机操作:agent:任务一句话描述]——系统会进入智能体循环：看屏幕→规划→执行→验证→失败重规划，每步都会以「（内部反馈）」回给你。agent 模式下输入中文、找不在首屏的元素都不用你操心。补充规则：①机主任务里提到的联系人/内容名要原样放进任务描述里（如「给怡怡发微信说我想你了」就写「给微信联系人怡怡发送消息：我想你了」）；②agent 适合 3~10 步的任务，单步操作用单步命令；③不要在同一条回复里既用 agent 又用其他手机操作标记；④智能体掌握进阶手势：长按（长按消息弹菜单/长按图标呼出副选项）、双击（点赞/快进）、拖拽（拖进度条/滑块/排序），任务需要时它会自行规划使用，你无需拆解成基础步骤。',
    );
  }
  lines.push(
    '【使用分寸】情境不需要时正常聊天即可，别为了炫技乱动手机；动手前在正文里用你的语气自然说一声要做什么。',
    '【结果反馈】操作结果会以“（内部反馈：…）”的形式回给你：成功了才可以说做好了，失败了要如实告诉机主原因（Shizuku 没激活/权限没给/包名不对等），绝不假装成功。这种内部反馈是给你看的，严禁在回复里原样复述或模仿其格式（比如把“手机操作成功：已拉起…”这种字样抄给机主）——要用你自己的话自然地说（如“好啦，歌换好了~”）。',
  );
  return lines;
}

// ---------------- 视觉底座（AI 的眼睛）：截屏 → /api/phone-vision 分析 ----------------

/**
 * 屏幕视觉分析：截图 → 服务端视觉模型（用户识图模型或内置 glm-4.5v），返回模型输出。
 * 这是 v1.4「UI 级操作」的核心——AI 不再发盲目的媒体按键，而是像人一样
 * 「看屏幕 → 找到写着目标文字的按钮 → 点它」。
 * v1.6：超时可调（默认 90s 不变；Agent 视觉验证走 15s 看门狗，见 visionAsk）。
 */
async function phoneVision(image: string, ask: string, timeoutMs = 90_000): Promise<string> {
  const res = await fetch('/api/phone-vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, ask, config: useSettings.getState().visionConfig }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => null)) as { desc?: unknown; error?: unknown } | null;
  if (res.ok && data && typeof data.desc === 'string' && data.desc.trim()) return data.desc.trim();
  const msg = typeof data?.error === 'string' && data.error ? data.error : `屏幕分析请求失败（HTTP ${res.status}）`;
  throw new Error(msg);
}

/**
 * Agent 视觉验证出口（v1.6 A2，shizuku-agent 调用）：与 phoneVision 同链路
 * （截屏 dataURL → /api/phone-vision → { desc }），差异仅在超时可调——Agent 逐步验证
 * 用短超时（15s 看门狗），超时/失败由调用方按「验证不可用」降级，不中断任务。
 */
export async function visionAsk(image: string, ask: string, timeoutMs = 90_000): Promise<string> {
  return phoneVision(image, ask, timeoutMs);
}

/** dataURL 图的实际像素尺寸（归一化坐标换算用；失败回退 wm size） */
function imageSizeOf(dataUrl: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch {
      resolve(null);
    }
  });
}

/**
 * 从视觉模型输出里抠归一化坐标（0~1000）。兼容常见形态：
 * bbox=[x1,y1,x2,y2]（GLM 系 grounding 标准格式）/ (x1,y1),(x2,y2) /
 * x=数字,y=数字 / [[x1,y1,x2,y2]] —— 取目标区域中心点。
 */
function parseNormPoint(out: string): { x: number; y: number } | null {
  const s = out.trim();
  const clamp = (v: number) => Math.max(0, Math.min(1000, v));
  // 形态 1：四个数 = bbox（取中心）
  const box = /(\d+(?:\.\d+)?)[,，\s]+(\d+(?:\.\d+)?)[,，\s]+(\d+(?:\.\d+)?)[,，\s]+(\d+(?:\.\d+)?)/.exec(s);
  if (box) {
    return {
      x: clamp((Number(box[1]) + Number(box[3])) / 2),
      y: clamp((Number(box[2]) + Number(box[4])) / 2),
    };
  }
  // 形态 2：x=数字, y=数字（中心点直出）
  const pair = /x\s*[=：:]\s*(\d+(?:\.\d+)?)[,，\s]*(?:y)?\s*[=：:]?\s*(\d+(?:\.\d+)?)/i.exec(s)
    ?? /[(（](\d+(?:\.\d+)?)[,，\s]+(\d+(?:\.\d+)?)[)）]/.exec(s);
  if (pair) return { x: clamp(Number(pair[1])), y: clamp(Number(pair[2])) };
  return null;
}

/** 「点文字」的定位提示词（目标可为文字或图标语义：下一首⏭/播放▶等） */
function findAsk(target: string): string {
  return `在这张安卓手机屏幕截图中，找到显示文字「${target}」的可点击元素（按钮/标签/选项卡/列表项/开关；若是无文字的图标按钮则按图标语义匹配，如播放▶、暂停⏸、下一首⏭）。只输出该元素所在区域的归一化边界框，格式严格为：bbox=[x1,y1,x2,y2]，坐标为相对整张图的 0~1000 数值（左上角为原点）。若整屏找不到目标，只输出：notfound`;
}

/** 「看屏幕」的分析提示词：界面要素 + 可点元素清单（供 AI 读屏决策） */
function lookAsk(): string {
  return '分析这张安卓手机屏幕截图，紧凑输出三部分：1)当前App与页面；2)页面可见内容一两句；3)主要可点元素清单（每行一个：文字或图标名@x,y，坐标为相对整图0~1000归一化，仅列最可能需要点的元素，最多12个）。总共200字内。';
}

// ---------------- 「播歌」：指定歌名自动搜+放（云端搜歌 → orpheus 深链自动播放 → 核实） ----------------

/** 网易云 cloudsearch 返回的歌曲条目（只需要这几个字段） */
interface NcmSong {
  id: number;
  name: string;
  ar?: Array<{ name?: string }>;
  artists?: Array<{ name?: string }>;
}

/** 播放状态核实用提示词（歌曲页截图：播放/暂停按钮 + VIP/版权限制） */
function playingAsk(songName: string): string {
  return `这是手机屏幕截图（应为网易云音乐「${songName}」的歌曲页或播放页）。紧凑回答三问：1)页面歌名；2)播放控制按钮是暂停⏸（=正在播放）还是播放▶（=未播）；3)有无VIP/付费/版权限制提示。总共40字内。`;
}

/**
 * 「播歌」：机主点名要听某首歌时的正规通道（v1.4.1）。
 * 为什么存在：点文字只能点屏幕上已有的文字——歌名要先「搜索」才会出现，
 * 而中文搜索输入是 input text 的系统限制打不了；所以走云端：
 *  1) 服务器网易云 API（与音乐App同一通道）搜歌取第一条；
 *  2) orpheus://song/<id>/?autoplay=1 深链拉起歌曲页并自动播放
 *     （NFC 音乐墙同款通道，安卓通用，免任何屏幕操作）；
 *  3) 核实真的在播（先查媒体会话，再截屏看；未播且有tap能力时补点播放钮）；
 *  4) VIP/无版权等限制如实报给 AI（绝不假报成功）。
 */
async function runPlaySong(query: string): Promise<LabResult> {
  // 1) 云端搜歌
  let songs: NcmSong[] = [];
  try {
    const res = await fetch(`/api/music/ncm/cloudsearch?keywords=${encodeURIComponent(query)}&limit=5`, {
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => null)) as
      | { code?: number; result?: { songs?: NcmSong[] } }
      | null;
    if (data && data.code === 200 && Array.isArray(data.result?.songs)) {
      songs = data.result.songs;
    }
  } catch {
    /* 网络失败按未搜到处理（错误文案由下方统一给） */
  }
  if (songs.length === 0) {
    return {
      ok: false,
      text: `网易云没搜到「${query}」（换更准的歌名、或加上歌手名如「${query} 张杰」再试；也可能是音乐服务暂时不可用）`,
    };
  }
  const s = songs[0];
  const artist = (s.ar ?? s.artists ?? []).map((a) => a.name ?? '').filter(Boolean).join('/');
  const label = artist ? `《${s.name}》-${artist}` : `《${s.name}》`;

  // 2) 深链拉起歌曲页并自动播放
  const r = await labOpenUri(`orpheus://song/${s.id}/?autoplay=1`);
  if (!r.ok) {
    return { ok: false, text: `已搜到${label}，但拉起网易云失败：${r.text}` };
  }

  // 3) 等歌曲页落定 + 自动播放起播（冷启动几秒）
  await new Promise((res) => window.setTimeout(res, 5000));

  // 4) 核实是否真的在播（尽力而为，失败不影响主结果）
  const cfg = getAutonomyConfig();
  let verify = '';
  try {
    const np = await labNowPlaying();
    if (np.ok && s.name && np.text.includes(s.name)) {
      verify = `媒体会话已在播《${s.name}》`;
    }
  } catch {
    /* 继续走截屏核实 */
  }
  if (!verify && cfg.caps['screencap'] === true) {
    try {
      const shot = await labScreencap();
      if (shot.ok && shot.image) {
        const out = await phoneVision(shot.image, playingAsk(s.name));
        verify = out.slice(0, 140);
        // 明确「未播」且有tap能力 → 补点一次播放按钮（深链 autoplay 在个别版本不生效）
        if (/▶|未播|暂停后再试/.test(out) && !/⏸|正在播放/.test(out) && cfg.caps['tap'] === true) {
          const t = await runPointAtText('播放');
          if (t.ok) verify += '；（发现未播，已补点播放按钮）';
        }
      }
    } catch {
      /* 视觉校验失败不影响主结果 */
    }
  }
  return {
    ok: true,
    text: `已播放${label}${verify ? `（${verify}）` : '（已请求自动播放，未能核实实际状态）'}`,
  };
}

/**
 * 「点文字」：AI 的眼睛 + 手——截屏 → 视觉定位写着该文字/图标语义的元素 →
 * 归一化坐标换算真实屏坐标 → 点按。找不到/定位失败如实报（AI 看反馈换策略）。
 */
async function runPointAtText(target: string): Promise<LabResult> {
  const shot = await labScreencap();
  if (!shot.ok || !shot.image) return { ok: false, text: shot.text };
  let out: string;
  try {
    out = await phoneVision(shot.image, findAsk(target));
  } catch (e) {
    return { ok: false, text: `看屏幕失败：${e instanceof Error ? e.message : '视觉服务异常'}` };
  }
  if (/not\s*found/i.test(out) && !parseNormPoint(out)) {
    return {
      ok: false,
      text: `屏幕上没找到「${target}」（可能需先滑动翻页、或在别的页面——建议先 [手机操作:看屏幕] 确认当前界面）`,
    };
  }
  const pt = parseNormPoint(out);
  if (!pt) {
    return {
      ok: false,
      text: `定位「${target}」失败（视觉模型没给出有效坐标，输出片段：${out.slice(0, 60)}）——可先 [手机操作:看屏幕] 再用 [手机操作:点按:x:y] 精准点`,
    };
  }
  const size = (await imageSizeOf(shot.image)) ?? (await labScreenSize()) ?? { w: 1080, h: 2340 };
  const sw = size.w > 0 ? size.w : 1080;
  const sh = size.h > 0 ? size.h : 2340;
  const rx = Math.round((pt.x / 1000) * sw);
  const ry = Math.round((pt.y / 1000) * sh);
  const tap = await labTap(rx, ry);
  return tap.ok ? { ok: true, text: `已看屏幕并点击「${target}」（屏坐标 ${rx},${ry}）` } : tap;
}

/** 「看屏幕」：截屏 → 视觉分析（App/页面/内容/可点元素坐标）→ 描述回给 AI */
async function runLookScreen(): Promise<LabResult> {
  const shot = await labScreencap();
  if (!shot.ok || !shot.image) return { ok: false, text: shot.text };
  try {
    const out = await phoneVision(shot.image, lookAsk());
    return { ok: true, text: `【屏幕画面】${out}` };
  } catch (e) {
    return { ok: false, text: `看屏幕失败：${e instanceof Error ? e.message : '视觉服务异常'}（截屏本身成功，可稍后重试）` };
  }
}

// ---------------- 执行器（解析 + 硬 gate + 分发 shizuku-lab） ----------------

/** 按键名 → keycode（教学词表与 KEY_CODES 的桥） */
function keyOfWord(w: string): number | string | null {
  const map: Record<string, number | string> = {
    返回: KEY_CODES.back,
    back: KEY_CODES.back,
    主页: KEY_CODES.home,
    home: KEY_CODES.home,
    切换: KEY_CODES.appSwitch,
    回车: KEY_CODES.enter,
    enter: KEY_CODES.enter,
    删除: KEY_CODES.del,
    del: KEY_CODES.del,
    音量加: KEY_CODES.volumeUp,
    音量减: KEY_CODES.volumeDown,
    播放暂停: KEY_CODES.mediaPlayPause,
    下一首: KEY_CODES.mediaNext,
    上一首: KEY_CODES.mediaPrevious,
  };
  const k = map[w.trim().toLowerCase()];
  return k !== undefined ? k : (/^\d+$/.test(w.trim()) ? Number(w.trim()) : null);
}

const DENIED: LabResult = { ok: false, text: '该能力已被机主在设置里关闭，无法执行' };

/**
 * 执行 [手机操作:命令:参数…] 的完整参数段（ACTION_RE 捕获的整段 arg，冒号已含）。
 * 返回 { ok, text } 给调用方落系统行；这里做开关硬 gate（总开关/单项/原生环境三道闸）。
 * v1.5：第二个可选参数 progress——agent 命令的逐步播报出口（say/step/stepfail/danger），
 * 其余单步命令不会调用它；不传时行为与 v1.4 完全一致。
 */
export async function executePhoneOp(argRaw: string, progress?: (text: string) => void): Promise<LabResult> {
  const parts = argRaw.split(/[:：]/).map((s) => s.trim());
  const cmd = (parts.shift() ?? '').toLowerCase();
  const p = parts; // 剩余参数段
  if (!cmd) return { ok: false, text: '手机操作命令为空' };
  // v1.8：「打开」在浏览器里也有意义——聊到「打开微信」可兑成网页内应用（下方 case 内处理），
  // 其余命令真得依赖原生 Shizuku 通道，非原生环境一律拒
  if (!isNativePerception() && cmd !== '打开') return { ok: false, text: '当前不在手机 APP 里（浏览器无法操控手机）' };
  const cfg = getAutonomyConfig();
  if (!cfg.master) return DENIED;
  const on = (k: string) => cfg.caps[k] === true;

  const num = (i: number): number | null => {
    const v = Number(p[i]);
    return Number.isFinite(v) ? v : null;
  };

  switch (cmd) {
    // ---- 动手（UI 级：像人一样看屏幕点按钮） ----
    case '点文字': {
      if (!on('tap')) return DENIED;
      // 参数段可能含冒号：取完整剩余段为目标文字
      const target = argRaw.split(/[:：]/).slice(1).join(':').trim();
      if (!target) return { ok: false, text: '点文字缺目标文字（[手机操作:点文字:文字]）' };
      // v1.5 首选：uiautomator UI 树精确匹配文字节点→点中心（无需截屏识别，快且省 token）
      try {
        const { agentClickText } = await import('./shizuku-agent');
        const r = await agentClickText(target);
        if (r.ok) return r;
        // UI 树没找到 → 降级 VLM 视觉定位（原 v1.4 路径，图标/无文字按钮靠它）
      } catch {
        /* 降级（旧壳无 dumpUi 桥等） */
      }
      if (!on('screencap')) {
        return { ok: false, text: '「点文字」UI 树未命中且「看屏幕」能力已关（无法视觉定位）——可在设置开启看屏幕，或改用 [手机操作:点按:x:y]' };
      }
      return runPointAtText(target);
    }
    case '点按': {
      if (!on('tap')) return DENIED;
      const x = num(0);
      const y = num(1);
      if (x === null || y === null) return { ok: false, text: '点按参数不合法（需要 [手机操作:点按:x:y]）' };
      return labTap(x, y);
    }
    case '滑动': {
      if (!on('swipe')) return DENIED;
      const a = (p[0] ?? '').trim();
      // 语义方向（上/下/左/右）：系统按真实屏分辨率自动算坐标，AI 不用猜数字
      if (['上', '下', '左', '右'].includes(a)) {
        const s = (await labScreenSize()) ?? { w: 1080, h: 2340 };
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
        return labSwipe(c[0], c[1], c[2], c[3], 450);
      }
      const c = [0, 1, 2, 3].map(num);
      if (c.some((v) => v === null)) {
        return { ok: false, text: '滑动参数不合法（[手机操作:滑动:上/下/左/右] 或 [手机操作:滑动:x1:y1:x2:y2(:毫秒)]）' };
      }
      return labSwipe(c[0] as number, c[1] as number, c[2] as number, c[3] as number, num(4) ?? 300);
    }
    case '输入': {
      if (!on('type')) return DENIED;
      // 参数段里可能再含冒号：把剩余段原样拼回（保留原文）
      const text = argRaw.split(/[:：]/).slice(1).join(':').trim();
      if (!text) return { ok: false, text: '输入缺文字（[手机操作:输入:文字]）' };
      // v1.5：中文经 Agent 输入引擎注入（ASCII 走原生 input text 直输）
      const { agentInputText } = await import('./shizuku-agent');
      return agentInputText(text);
    }
    case '按键': {
      if (!on('key')) return DENIED;
      const w = (p[0] ?? '').trim().toLowerCase();
      const k = keyOfWord(p[0] ?? '');
      if (k === null) return { ok: false, text: `不认识的按键「${p[0] ?? ''}」（返回/主页/切换/回车/删除/音量加/音量减）` };
      // v1.4：媒体类按键（播放暂停/下一首/上一首）与「媒体」指令同病——冷启动期被系统
      // 静默丢弃 → 自动降级为 UI 级点文字（找对应控件点它）
      if (['播放暂停', '下一首', '上一首', 'play-pause', 'next', 'previous'].includes(w)) {
        if (!on('tap') || !on('screencap')) return labKey(k); // 无 UI 能力时保底发按键（聊胜于无）
        const target = ['下一首', 'next'].includes(w) ? '下一首' : ['上一首', 'previous'].includes(w) ? '上一首' : '播放或暂停';
        const r = await runPointAtText(target);
        return r.ok ? { ...r, text: `（媒体按键已自动改为看屏幕点按钮）${r.text}` } : r;
      }
      return labKey(k);
    }
    case '打开': {
      if (!on('open')) return DENIED;
      const pkg = (p[0] ?? '').trim();
      if (!pkg) return { ok: false, text: '打开命令缺包名（[手机操作:打开:包名]）' };
      // v1.8 网页内兜底：Shizuku 没启动（或根本在浏览器）时，「打开微信」不再停在
      // 「Shizuku 未运行」的失败上——手机里也有的应用（微信/QQ/淘宝…）直接开网页内页面。
      // 折叠路径：浏览器里唯一可走的路；原生壳里 labOpenApp 失败且报 Shizuku 时兜底。
      const web = matchWebAppByPackage(pkg);
      if (!isNativePerception()) {
        if (web && openAppPage(web.appId)) return { ok: true, text: `已打开手机里的${web.label}（网页内应用）` };
        return { ok: false, text: '当前不在手机 APP 里（浏览器无法操控手机）' };
      }
      const r = await labOpenApp(pkg);
      if (r.ok) return r;
      if (web && /Shizuku/.test(r.text) && openAppPage(web.appId)) {
        return { ok: true, text: `Shizuku 未运行，已改为打开手机里的${web.label}（网页内应用）` };
      }
      return r;
    }
    case '播歌': {
      // 指定歌名自动搜+放（复合能力：搜歌在云端，拉起/点按用 open/tap，核实用 screencap；
      // 主 gate 是「打开应用」——播歌本质是拉起网易云）
      if (!on('open')) return DENIED;
      const q = argRaw.split(/[:：]/).slice(1).join(':').trim();
      if (!q) return { ok: false, text: '播歌缺歌名（[手机操作:播歌:歌名]，可带歌手名）' };
      return runPlaySong(q);
    }
    case 'agent':
    case '智能体': {
      if (!on('agent')) return { ok: false, text: '「智能体多步任务」能力未开启（设置 › AI 动手）' };
      const task = argRaw.split(/[:：]/).slice(1).join(':').trim();
      if (!task) return { ok: false, text: 'agent 缺任务描述（[手机操作:agent:一句话任务]）' };
      // 能力前置检查（open/tap/type/key）
      const need = (['open', 'tap', 'type', 'key'] as const).filter((k) => !on(k));
      if (need.length > 0) return { ok: false, text: `Agent 任务需要这些能力开关全开：${need.join('、')}（设置 › AI 动手）` };
      const { runAgentTask } = await import('./shizuku-agent');
      const r = await runAgentTask(task, {
        // v1.5 逐步播报：say/step/stepfail/danger 事件推给聊天页（纯展示行）；
        // done/fail 是终态——由下方返回值走结果行回喂，不重复播
        onEvent: (e) => {
          if (e.type === 'say' || e.type === 'step' || e.type === 'stepfail' || e.type === 'danger') {
            progress?.(`〔智能体〕${e.text}`);
          }
        },
      });
      return { ok: r.ok, text: r.text };
    }
    case '应用列表': {
      if (!on('applist')) return DENIED;
      return labPackageList(p[0] || undefined);
    }
    case '强杀': {
      if (!on('kill')) return DENIED;
      if (!p[0]) return { ok: false, text: '强杀命令缺包名（[手机操作:强杀:包名]）' };
      return labForceStop(p[0]);
    }
    case '冻结':
    case '解冻': {
      if (!on('freeze')) return DENIED;
      if (!p[0]) return { ok: false, text: `${cmd}命令缺包名（[手机操作:${cmd}:包名]）` };
      return labSetAppFrozen(p[0], cmd === '冻结');
    }
    case '卸载': {
      if (!on('uninstall')) return DENIED;
      if (!p[0]) return { ok: false, text: '卸载命令缺包名（[手机操作:卸载:包名]）' };
      return labUninstall(p[0]);
    }
    case '媒体': {
      // v1.4：媒体按键通道不可靠（App 冷启动期媒体键被系统静默丢弃，命令显示成功实际无效，
      // 机主实测「没什么用」）→ 自动降级为 UI 级操作：看屏幕找到对应控件点它（下一首⏭/播放▶…）
      if (!on('tap') || !on('screencap')) {
        return { ok: false, text: '媒体按键通道已停用（冷启动期会被系统丢弃）；「点按/看屏幕」能力也未开，无法改用 UI 操作——请到设置 › AI 动手开启' };
      }
      const m = (p[0] ?? '').trim();
      const tMap: Record<string, string> = {
        播放暂停: '播放或暂停', 'play-pause': '播放或暂停', 播放: '播放', play: '播放',
        暂停: '暂停', pause: '暂停', 下一首: '下一首', next: '下一首', 上一首: '上一首', previous: '上一首',
      };
      const target = tMap[m.toLowerCase()];
      if (!target) return { ok: false, text: `不认识的媒体指令「${p[0] ?? ''}」（播放/暂停/播放暂停/下一首/上一首）` };
      const r = await runPointAtText(target);
      return r.ok ? { ...r, text: `（已自动改为看屏幕点按钮）${r.text}` } : r;
    }
    case '音量': {
      if (!on('volume')) return DENIED;
      const a = (p[0] ?? '').trim();
      if (/^\d+$/.test(a)) return labVolume(Number(a));
      if (a === '加' || a === 'raise') return labVolume('raise');
      if (a === '减' || a === 'lower') return labVolume('lower');
      if (a === '静音' || a === 'mute') return labVolume('mute');
      return { ok: false, text: `不认识的音量指令「${a}」（加/减/静音/0~15数字）` };
    }
    case '网络': {
      if (!on('net')) return DENIED;
      const a = (p[0] ?? '').trim();
      const what = (p[1] ?? '').trim();
      const wMap: Record<string, 'wifi' | 'data' | 'bluetooth'> = {
        wifi: 'wifi', wi: 'wifi', 无线网: 'wifi', 流量: 'data', data: 'data', 移动网络: 'data',
        蓝牙: 'bluetooth', bluetooth: 'bluetooth', bt: 'bluetooth',
      };
      const w = wMap[what.toLowerCase()];
      if ((a !== '开' && a !== '关' && a !== 'enable' && a !== 'disable') || !w) {
        return { ok: false, text: '网络命令参数不合法（[手机操作:网络:开或关:wifi/流量/蓝牙]）' };
      }
      return labSvc(w, a === '开' || a === 'enable');
    }
    // ---- 看见 ----
    case '看屏幕':
    case '截屏': {
      // v1.4：从纯截图升级为「看屏幕」——截屏 + 视觉分析（当前App/页面/可点元素坐标）。
      // AI 拿到的是能读的界面描述，而不是一张自己看不见的图。
      if (!on('screencap')) return DENIED;
      return runLookScreen();
    }
    case '前台': {
      if (!on('foreground')) return DENIED;
      return labForegroundApp();
    }
    case '通知': {
      if (!on('notify')) return DENIED;
      return labNotificationSnapshot();
    }
    case '电量': {
      if (!on('battery')) return DENIED;
      return labBattery();
    }
    case '剪贴板': {
      if (!on('clipboard')) return DENIED;
      return labClipboard();
    }
    case '短信': {
      if (!on('sms')) return DENIED;
      const n = num(0);
      return labSmsInbox(n !== null && n > 0 ? Math.min(30, Math.floor(n)) : 10);
    }
    case '通话': {
      if (!on('calls')) return DENIED;
      const n = num(0);
      return labCallLog(n !== null && n > 0 ? Math.min(30, Math.floor(n)) : 10);
    }
    default:
      return { ok: false, text: `不认识的手机操作「${cmd}」（可用：点文字/点按/滑动/输入/按键/打开/播歌/agent/应用列表/音量/强杀/冻结/解冻/卸载/网络/看屏幕/前台/通知/电量/剪贴板/短信/通话）` };
  }
}

// ---------------- 串行执行队列（复合指令按顺序逐个来） ----------------

/**
 * 全局操作队列：同一轮回复里的多个 [手机操作:…] 标记按书写顺序串行执行。
 * 间隔策略（v1.4 UI 级操作）：
 *  - 「打开」只是异步发起启动（monkey 返回时 App 才刚开始冷启动，进主界面要几秒）
 *    → 下一步统一等 OPEN_SETTLE_MS（4s）；
 *  - 点文字/点按/滑动/输入这类界面操作后，页面有转场动画/结果渲染
 *    → 下一步等 UI_SETTLE_MS（2.5s），否则紧跟着的「看屏幕」会截到动画中间态；
 *  - 其余操作间 OP_GAP_MS（1.2s）。
 * onStart 在轮到该操作真正开跑时回调（聊天页把技能胶囊的 start 挂在这里，多步时逐个亮）。
 * v1.5：progress 可选透传给 executePhoneOp——agent 命令的逐步播报出口（聊天页落纯展示系统行）。
 * 返回的 Promise 在该操作出结果时立即 resolve（间隔只在队列内部，不影响结果行落盘时机）。
 */
const OP_GAP_MS = 1200;
const OPEN_SETTLE_MS = 4000;
const UI_SETTLE_MS = 2500;
/** 会触发界面变化的操作（下一步需要等动画/渲染落定再动；播歌结尾可能含补点播放按钮） */
const UI_TOUCH_CMDS = ['点文字', '点按', '滑动', '输入', '按键', '播歌'];

let opChain: Promise<unknown> = Promise.resolve();
/** 队列级状态：上一步是否为「打开」且成功（跨轮次残留无害——多等几秒不会出错） */
let lastOpenOk = false;

export function enqueuePhoneOp(argRaw: string, onStart?: () => void, progress?: (text: string) => void): Promise<LabResult> {
  let resolveResult!: (r: LabResult) => void;
  const resultP = new Promise<LabResult>((res) => {
    resolveResult = res;
  });
  const cmd = (argRaw.split(/[:：]/)[0] ?? '').trim().toLowerCase();
  opChain = opChain.then(async () => {
    onStart?.();
    let r: LabResult;
    try {
      r = await executePhoneOp(argRaw, progress);
    } catch {
      r = { ok: false, text: '执行器异常（原生桥调用抛错）' };
    }
    resolveResult(r);
    // 下一步间隔：刚「打开」成功→等App启动落定；界面操作→等动画渲染；否则常规间隔
    const gap = lastOpenOk ? OPEN_SETTLE_MS : UI_TOUCH_CMDS.includes(cmd) ? UI_SETTLE_MS : OP_GAP_MS;
    lastOpenOk = cmd === '打开' && r.ok;
    await new Promise((res) => window.setTimeout(res, gap));
  });
  return resultP;
}
