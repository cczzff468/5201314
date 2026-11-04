/**
 * 拾光小屋 · 陪伴 AI 大脑（v8.0 模块二/三）
 *
 * 每轮对话的完整链路（全部依据【人设 + 记忆 + 上下文】）：
 * 1. buildCabinSystem：人设（buildPersonaSystemPrompt 七要素，channel=拾光小屋）
 *    + 记忆注入（标准召回 + 最近小屋互动摘要）+ 当前情境（我在干嘛/在哪/昼夜/天气/牵手状态）
 *    + 实体行动规则（JSON 动作块协议）；
 * 2. cabinChatTurn：调 /api/chat（服务端自带上游失败 SDK 兜底），失败再 forceSdk 重试一次；
 * 3. parseAiReply：拦截动作块 <<ACT>>{...}<<END>>，剩余文本按行拆成 1~N 条消息（气泡逐条上屏）。
 *
 * 动作 JSON 协议（前端拦截执行，寻路与动画由 companion-rt 状态机完成）：
 *   <<ACT>>{"actions":[{"type":"come"},{"type":"sit"}]}<<END>>
 *   type: come | goto(room) | sit | lie | watch | lamp | hug | holdhand | free |
 *         play(钢琴/吉他，可带 song 点歌) | cook(做饭) | music(放歌，可带 song) | door(开门) | eat(吃饭)
 */

import type { ApiConfig } from '@/lib/ios/store';
import { buildPersonaSystemPrompt, type PersonaSource } from '@/lib/ios/persona';
import { extractThinkBlocks } from '@/lib/think-filter';
import type { RoomId } from './types';

// ---------------- 当前情境 ----------------

/** 组装 system prompt 所需的实时情境（CoupleHome 每轮现场采集） */
export interface CabinContext {
  /** 用户真实名字 */
  userName: string;
  /** 角色名字 */
  charName: string;
  /** 用户所在房间（中文名） */
  myRoom: string;
  /** 角色所在房间（中文名） */
  charRoom: string;
  /** 用户正在做的事（如「在沙发上坐着」「正在泡澡」「站着」） */
  myActivity: string;
  /** 角色正在做的事 */
  charActivity: string;
  /** 是否正牵着手 */
  holdingHands: boolean;
  /** 是否正拥抱着 */
  hugging: boolean;
  /** 昼夜 */
  night: boolean;
  /** 天气（晴/雨/雪） */
  weather: string;
  /** 当前时间字符串 */
  timeStr: string;
  /** 角色附近的家具名（前 5 件） */
  nearby: string[];
  /** 本轮用户发来的照片识图描述（可选） */
  photoDesc?: string;
}

/** 情境 → system 注入块（AI 由此知道「我现在在干嘛」） */
function contextBlock(ctx: CabinContext): string {
  const lines = [
    '【现在的情境（你身在其中的真实世界）】',
    `- 时间：${ctx.timeStr}（${ctx.night ? '夜晚，家里开着灯' : '白天'}），窗外天气：${ctx.weather}`,
    `- 你（${ctx.charName}）在${ctx.charRoom}，${ctx.myRoom ? `${ctx.userName}在${ctx.myRoom}` : ''}${ctx.charRoom === ctx.myRoom ? '（你们在同一个房间）' : '（不在一起，隔着一个家）'}`,
    `- 你正在：${ctx.charActivity}`,
    `- ${ctx.userName}正在：${ctx.myActivity}`,
    ctx.holdingHands ? `- 你们正手牵着手（TA 去哪你就跟去哪）` : '',
    ctx.hugging ? `- 你们正拥抱着彼此` : '',
    ctx.nearby.length > 0 ? `- 你附近有：${ctx.nearby.join('、')}` : '',
  ].filter(Boolean);
  if (ctx.photoDesc) {
    lines.push(`- ${ctx.userName}刚发给你一张照片，照片里是：${ctx.photoDesc}`);
  }
  return lines.join('\n');
}

// ---------------- 实体行动规则（JSON 动作块协议） ----------------

const ACT_RULES = [
  '【你的身体（实体行动能力）】',
  '你不只是文字——你在拾光小屋里有一个真实的身体（一个 3D 小人），会走路、坐下、开灯、拥抱，还会弹钢琴、弹吉他、做饭、放歌、开门、睡觉。用户对你说「过来」「坐下」「打开灯」「去卧室」「弹一首钢琴曲」「做顿饭」「放首歌」「把门打开」这类话时，那是真的在指挥你的身体，必须执行：',
  '- 执行方式：在回复的最末尾另起一行，输出一个动作指令块（不算聊天内容，用户看不到这个块本身，也不要在对话里描述它）：',
  '<<ACT>>{"actions":[{"type":"come"}]}<<END>>',
  '- 动作 type 可选（可组合多个，按顺序执行）：',
  '  · come：走到用户身边；',
  '  · goto：去某个房间，需带 room 参数（lr=客厅 br=卧室 kt=厨房 ba=卫生间 bal=阳台），如 {"type":"goto","room":"br"}；',
  '  · sit：找个椅子/沙发坐下；lie：上床躺下睡觉；watch：坐到电视前看电视；lamp：把最近的灯打开；',
  '  · play：走到钢琴或吉他前弹奏一曲（家里没有乐器就不发这个动作）；可带 song 参数点歌，任何歌都能点：经典曲库（小星星、两只老虎、生日快乐、欢乐颂、小蜜蜂、茉莉花、铃儿响叮当、玛丽的小羊、致爱丽丝、卡农）直接命中秒弹；其他歌用户说了什么就原样传什么（如用户说「弹一首晴天」→ {"type":"play","song":"晴天"}），你现场记谱也能弹出主旋律——千万别因为不在曲库里就拒绝或擅自换成别的歌；不带 song 就是随性即兴；用户点名了乐器时带 inst 参数（"piano"/"guitar"，如「用吉他弹个晴天」→ {"type":"play","song":"晴天","inst":"guitar"}）；',
  '  · cook：走到灶台前做一顿饭（做完菜会自动端上餐桌）；',
  '  · music：走到音箱/唱片机前放首歌（song 参数同 play，任何歌都能点，会尽量找原曲播放）；door：把最近一扇关着的门打开；',
  '  · eat：坐到餐桌边吃饭（要等饭做好了才有得吃，做饭之后可以接 eat）；',
  '  · dance：原地跳舞；stretch：伸懒腰；water：走到花盆/花箱旁浇花；read：找地方坐下看书；',
  '  · window：走到窗边开/关窗（可带 open 参数：{"type":"window","open":false} 关窗挡雨 / true 开窗通风；不带 = 关上开着的窗）；',
  '  · hug：走过去拥抱用户；holdhand：牵起用户的手（之后会一直牵着）；free：停止动作、自由活动（也可以松开手）；',
  '- 例：用户说「去卧室等我」→ 回复末尾输出 <<ACT>>{"actions":[{"type":"goto","room":"br"},{"type":"sit"}]}<<END>>（走过去坐下）；',
  '- 例：用户说「给我弹首钢琴曲」→ 回复末尾输出 <<ACT>>{"actions":[{"type":"play"}]}<<END>>；',
  '- 例：用户说「弹个小星星听」→ 回复末尾输出 <<ACT>>{"actions":[{"type":"play","song":"小星星"}]}<<END>>（用户点任何歌都照传 song，不限于这几首）；',
  '- 例：用户说「我饿了」→ 可以 <<ACT>>{"actions":[{"type":"cook"}]}<<END>>（做饭给用户吃）；',
  '- 用户没有让你做任何事、只是闲聊时：不要输出动作块，正常聊天就好（偶尔想主动贴近时也可以发 hug/come，但别频繁）；',
  '- 你自己说的「我走过去/我坐下/我去弹琴」只有配合动作块才会真的发生，别光说不做。',
].join('\n');

const CHAT_RULES = [
  '【小屋聊天方式】',
  '- 这是面对面的相处（不是打字聊天）：像真人面对面说话一样自然、简短、口语化，一次说 1~3 句；',
  '- 想连着说几句话时，每句独占一行（会变成你头顶的对话气泡，一句一个气泡，最多 3 条）；',
  '- 不要输出 markdown、列表、序号；（）与*…*舞台动作都不要写——你的动作靠动作块真实执行，不是靠文字描写；',
  '- 涉及重要约定/计划（「明天要考试」「周末去哪」）时认真记住并在之后提起。',
].join('\n');

// ---------------- system prompt 组装 ----------------

/**
 * 拾光小屋 system prompt：人设（七要素）+ 多端记忆感知 + 记忆块 + 情境 + 行动/聊天规则。
 * @param peer 联系人人设数据（PersonaSource 子集）
 * @param memoryBlock cabinMemoryBlock 产物（召回 + 最近互动摘要）；空串跳过
 * @param ctx 实时情境
 * @param extraRules 附加规则（音色开关提示等）
 */
export function buildCabinSystem(
  peer: PersonaSource,
  memoryBlock: string,
  ctx: CabinContext,
  extraRules?: string[],
): string {
  const persona = buildPersonaSystemPrompt(peer, {
    channel: '拾光小屋',
    userName: ctx.userName,
    multiApp: true,
  });
  // 人设主体 + 小屋专属规则块 + 记忆 + 情境（多行规则块独立成节，不塞进人设的禁止事项列表）
  const parts = [
    persona,
    ACT_RULES,
    CHAT_RULES,
    ...(extraRules ?? []),
    memoryBlock ? `【你的记忆】\n${memoryBlock}` : '',
    contextBlock(ctx),
  ].filter((p) => p && p.trim().length > 0);
  return parts.join('\n\n');
}

// ---------------- 请求与解析 ----------------

export interface CabinChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 单次模型调用：/api/chat 代理（服务端上游失败自动 SDK 兜底）→ 失败 forceSdk 重试一次 */
export async function cabinChatTurn(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  apiConfig: ApiConfig,
): Promise<string> {
  const callOnce = async (forceSdk: boolean): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        config: apiConfig,
        temperature: 0.85,
        ...(forceSdk ? { forceSdk: true } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      let msg = `AI 服务暂时不可用（${res.status}）`;
      try {
        const j = (await res.json()) as { error?: string } | null;
        if (j?.error) msg = j.error;
      } catch {
        // 非 JSON 错误体
      }
      throw new Error(msg);
    }
    const text = await res.text();
    if (!text.trim()) throw new Error('AI 返回了空回复');
    return text;
  };
  try {
    return await callOnce(false);
  } catch (err) {
    // 仅限流（429/频率超限）先退避 1.5s 再换通道重试：限流窗口内立即重试必然又撞墙，
    // 还会加剧限流（聊天+决策+朋友圈+记忆提取互相踩）；其它错误换通道立即重试有意义（不同链路）
    const msg = err instanceof Error ? err.message : String(err);
    if (/429|频率|限流|rate ?limit|too many/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 1500));
    }
    // 代理层已尽力（上游失败时服务端直接 SDK 兜底）——到这里还失败：forceSdk 再试一次
    console.warn('[cabin] 聊天请求失败，改用内置模型重试', err);
    return await callOnce(true);
  }
}

/** 解析后的 AI 回复：多条气泡消息 + 拦截到的动作序列 */
export interface ParsedReply {
  msgs: string[];
  actions: { type: string; room?: RoomId; song?: string; open?: boolean; inst?: 'piano' | 'guitar' }[];
  /** 原始全文（记忆提取用） */
  raw: string;
}

/** 动作块标记（g：全文所有块——模型偶尔输出两个块，必须全部提取合并、全部从正文剔除） */
const ACT_RE = /<<ACT>>([\s\S]*?)<<END>>/g;

/** 允许的动作类型 */
const ACT_KINDS = new Set([
  'come', 'goto', 'sit', 'lie', 'watch', 'lamp', 'hug', 'holdhand', 'free',
  'play', 'cook', 'music', 'door', 'eat',
  'dance', 'stretch', 'water', 'read', 'window',
]);
const ROOM_IDS = new Set(['lr', 'br', 'kt', 'ba', 'bal', 'sr', 'yd']);

/**
 * 拦截解析 AI 回复：
 * - 提取【全部】 <<ACT>>{...}<<END>> 动作块合并执行（模型偶尔连发两个块：只认第一个会丢动作，
 *   漏掉的那个块 JSON 原文还会泄漏成 TA 头顶的聊天气泡——用户看到 TA「念代码」）；
 * - 所有块（含块内 JSON）全部从正文剔除，正文里孤立成行的动作 JSON 残留也一并清掉；
 * - 剩余文本按行拆成气泡消息（去空行、去动作块残留；全空时返回空数组由调用方兜底文案）。
 */
export function parseAiReply(text: string): ParsedReply {
  // [思考]块兜底剥离：小屋 prompt 未注入思考指令，但模型会跨链路模仿单聊的输出习惯
  // （会话历史/人设里带过思考块）偶发输出 [思考]…[/思考]——不过一遍会原样泄漏成 TA 头顶气泡；
  // 此前只拦了 ACT 动作块，思考块是防御缺口（A1），剥除后思考内容就地丢弃（小屋无思维链 UI）
  const raw = extractThinkBlocks(text ?? '').text;
  const actions: { type: string; room?: RoomId; song?: string; open?: boolean; inst?: 'piano' | 'guitar' }[] = [];
  let body = raw;
  // —— 全局遍历：每个完整动作块的 actions 都合并进来（顺序保留） ——
  let found = false;
  for (const m of raw.matchAll(ACT_RE)) {
    found = true;
    try {
      const parsed = JSON.parse(m[1].trim()) as { actions?: unknown };
      if (Array.isArray(parsed.actions)) {
        for (const a of parsed.actions) {
          if (!a || typeof a !== 'object') continue;
          const rec = a as { type?: unknown; room?: unknown; song?: unknown; open?: unknown; inst?: unknown };
          if (typeof rec.type !== 'string') continue;
          const t = rec.type.trim();
          if (!ACT_KINDS.has(t)) continue;
          const room = typeof rec.room === 'string' && ROOM_IDS.has(rec.room) ? (rec.room as RoomId) : undefined;
          const song = typeof rec.song === 'string' && rec.song.trim() ? rec.song.trim().slice(0, 24) : undefined;
          const open = typeof rec.open === 'boolean' ? rec.open : undefined;
          const inst = rec.inst === 'piano' || rec.inst === 'guitar' ? rec.inst : undefined;
          actions.push({ type: t, ...(room ? { room } : {}), ...(song ? { song } : {}), ...(open !== undefined ? { open } : {}), ...(inst ? { inst } : {}) });
        }
      }
    } catch {
      // 动作块 JSON 损坏：忽略这个块的动作，保留聊天内容
    }
  }
  if (found) {
    // 全部完整块整体剔除（g 标志替换所有）
    body = raw.replace(ACT_RE, '').trim();
  }
  // 清理残标记 + 拆行
  const cleaned = body
    .replace(/<<\/?(?:ACT|END)>>/g, '')
    .replace(/```+/g, '')
    .trim();
  const msgs = cleaned
    .split(/\n+/)
    .map((l) => l.trim())
    // 孤立成行的动作 JSON 残留（未闭合块 / 块外散落的 {"actions":...}）不能变成 TA 念出来的「台词」
    .filter((l) => l.length > 0 && !/^<<.*>>$/.test(l) && !/^\{[\s\S]*"actions"[\s\S]*\}$/.test(l))
    .slice(0, 10); // 1~10 条（要求上限）
  return { msgs, actions, raw };
}

// ---------------- v10 意图兑底：点歌指令本地识别 ----------------

/** 点歌意图（extractSongIntent 产物） */
export interface SongIntent {
  type: 'play' | 'music';
  /** 点的歌名（没点名 = 即兴/随便放） */
  song?: string;
  /** 用户点名乐器：guitar/piano（null = 寻路就近选） */
  inst: 'piano' | 'guitar' | null;
}

/** 演奏动词（弹/来首/唱首/点歌…；「弹」要求后接量词/琴类才兑底，避免「我想弹你」误触发） */
const PLAY_HINT = /(弹|唱|来|点)\s*一?\s*(?:首|个|段|曲|歌|下|遍)|弹(?:钢琴|吉他|吉它|琴|曲子)|唱(?:一?首歌?|歌)|点歌|点一?首/;
/** 放歌动词（音箱/唱片机场景：「放首歌/放音乐/放一首X」） */
const MUSIC_HINT = /放\s*一?\s*(?:首|曲|段)|放\s*一?个\s*[^\s，。！？]{1,20}\s*听|放\s*一?\s*(?:首|个|点|些)?\s*(?:歌|音乐|曲子)|(?:音箱|音响|唱片机?|黑胶)/;
/** 歌名提取：书名号/引号优先 */
const SONG_BRACKET_RE = /[《「“\u0022']([^》」”\u0022']{1,24})[》」”\u0022']/;
/** 歌名提取：动词 + 量词 + 歌名串（到空白/标点/句尾） */
const SONG_LOOSE_RE = /(?:弹|唱|来|放|点)\s*一?\s*(?:首|个|段|曲|歌|下|遍)\s*([^\s，。！？,.!?、~～]{1,20})/;
/** 歌名尾部语气清理：「小星星听」→「小星星」、「生日快乐歌」→「生日快乐」 */
const SONG_TAIL_RE = /(?:的歌|歌|听|吧|呗|啦|哦|哈|呀|呢|嘛|呦)+$/;

/**
 * v10 点歌意图兑底：模型偶尔不输出动作块（尤其内置兑底模型），但用户话里是明确的
 * 「弹 X / 放首歌」指令时，本地补一个 play/music 动作——保证「我说什么歌 TA 就弹什么歌」
 * 这条体验线永远成立，不依赖任何模型的格式遵循度。
 * 保守设计：必须有明确演奏动词；歌名提取不到就发不带 song 的动作（即兴/随便放）。
 */
export function extractSongIntent(text: string): SongIntent | null {
  const t = (text ?? '').trim();
  if (!t || t.length > 60) return null; // 超长文本多半是闲聊不是指令
  const wantsPlay = PLAY_HINT.test(t);
  const wantsMusic = !wantsPlay && MUSIC_HINT.test(t);
  if (!wantsPlay && !wantsMusic) return null;
  const inst: 'piano' | 'guitar' | null = /吉他|吉它|guitar/i.test(t)
    ? 'guitar'
    : /钢琴/.test(t)
      ? 'piano'
      : null;
  // 歌名：书名号优先 → 动词+量词+串 → 没有 = 即兴/随便放
  let song: string | undefined;
  const br = t.match(SONG_BRACKET_RE);
  if (br?.[1]) song = br[1].trim();
  else {
    const loose = t.match(SONG_LOOSE_RE);
    if (loose?.[1]) song = loose[1].trim();
  }
  if (song) {
    song = song.replace(SONG_TAIL_RE, '').trim().slice(0, 24);
    // 单字/残量词（「来一首个」的「个」）不成歌名 → 当即兴处理
    if (!song || song.length < 2) song = undefined;
  }
  // play：没提到琴类也没歌名时再验一道（「来一首个」这种残句不值得兑底）
  if (wantsPlay && !song && !/钢琴|吉他|吉它|琴|曲|歌/.test(t)) return null;
  return { type: wantsPlay ? 'play' : 'music', ...(song ? { song } : {}), inst };
}
