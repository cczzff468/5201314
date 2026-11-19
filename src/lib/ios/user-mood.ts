'use client';

/**
 * 用户情绪感知（v49 功能四）—— AI 对「聊天对面的人」的情绪感知：
 *
 * 与 ai-mood.ts（AI 自己的心情）互补：那边管「我现在什么心情」，这边管「TA 现在什么状态」。
 * - 三类情绪：低落 down / 兴奋 excited / 生气 angry（词表轻量本地匹配，不耗 LLM）；
 * - 打点入口：chat-stream-store noteEngagement（三端聊天统一入口，每轮用户消息一次）；
 * - 信号强度：单条消息命中词数 + 连续命中累积；情绪会随时间衰减（40min 无强化回归平静）；
 * - 注入提示词（buildUserMoodBlock）：【对方此刻的状态】块——AI 自动切换
 *   安抚模式（低落）/ 共庆模式（兴奋）/ 顺着哄模式（生气）；
 * - 组合入口：buildDynamicStateBlocks（ai-mood.ts）已并入本块，三端聊天 / 主动消息 /
 *   情侣空间行为等客户端组装点自动带上，无需各处单独接。
 * 存储：localStorage user-mood:{cid}（轻量、同步读、与 ai-mood 同模式）。
 */

export type UserMoodTag = 'down' | 'excited' | 'angry' | 'normal';

export interface UserMoodState {
  /** 当前情绪标签 */
  tag: UserMoodTag;
  /** 信号强度 0~100（命中词越多、连续命中越多越强；随时间衰减） */
  score: number;
  /** 情绪产生/最近强化时间（衰减用） */
  at: number;
}

const KEY = (cid: string) => `user-mood:${cid}`;
const DEFAULT_STATE: UserMoodState = { tag: 'normal', score: 0, at: 0 };

/** 情绪展示（emoji + 中文名） */
export const USER_MOOD_DISPLAY: Record<UserMoodTag, { emoji: string; label: string }> = {
  down: { emoji: '🥺', label: '低落' },
  excited: { emoji: '🥳', label: '兴奋' },
  angry: { emoji: '😤', label: '生气' },
  normal: { emoji: '🙂', label: '平静' },
};

// ---------------- 词表（轻量本地匹配，不耗 LLM） ----------------

/** 低落/疲惫/难过 → 安抚模式 */
const DOWN_WORDS = [
  '好累', '累死了', '累了', '疲惫', '难受', '难过', '伤心', '崩了', '崩溃', '想哭',
  '哭了', '哭死', '低落', 'emo', 'EMO', '心情不好', '不开心', '沮丧', '失落', '压抑',
  '压力好大', '压力大', '烦死了', '好烦', '太烦了', '加班', '又加班', '考试', '考砸了',
  '挂科', '没考好', '失败了', '输惨了', '被骂了', '被批了', '被开了', '失业', '分手',
  '睡不着', '失眠', '头疼', '不舒服', '生病', '孤独', '好孤独', '一个人', '没人理',
  '没意思', '无聊死了', '唉', '唉唉', '唉声叹气', '心好累', '撑不住', '想放弃', '没动力',
];

/** 兴奋/开心/好事发生 → 共庆模式 */
const EXCITED_WORDS = [
  '哈哈哈', '哈哈哈哈', '笑死', '笑死了', '太好了', '太好啦', '太棒了', '超级开心',
  '开心死了', '激动', '好激动', '兴奋', '中奖了', '中奖', '升职', '加薪', '涨工资',
  '通过了', '过了', '过啦', '拿下了', '拿到了', '上岸', '上岸了', '录取了', 'offer',
  'Offer', '耶', '好耶', '耶耶', '牛逼', '太牛了', 'nb', 'NB', '绝了', '绝绝子',
  '庆祝', '请客', '请你们', '第一名', '拿第一', '赢了', '赢麻了', '终于', '终于啊',
  '好消息', '大好事', '疯狂', '狂喜', '惊喜', '天呐', '天哪', '我的天', 'wow', 'Wow',
];

/** 生气/火气 → 先弄清气什么再决定站队/哄 */
const ANGRY_WORDS = [
  '气死', '气死了', '气死我', '快气死', '生气', '好气', '气人', '火大', '上头',
  '烦死了啦', '讨厌死了', '滚', '有病吧', '脑子有病', '傻逼', 'sb', 'SB', '恶心',
  '真恶心', '无语', '无语死了', '受够了', '受不了', '什么玩意', '什么鬼', '离谱',
  '太离谱', '离谱到家', '给我气笑', '气笑了', '服了', '我真的服了', '懒得理',
  '不想说话', '闭嘴', '别烦我', '别理我', '烦着呢', '爆炸', '原地爆炸', '血压上来了',
];

/** 单类命中计数 */
function hitsOf(text: string, words: string[]): number {
  let n = 0;
  for (const w of words) {
    if (text.includes(w)) n++;
  }
  return n;
}

// ---------------- 状态读写（localStorage；SSR/隐私模式安全兜底） ----------------

function getState(cid: string): UserMoodState {
  try {
    const raw = window.localStorage.getItem(KEY(cid));
    if (!raw) return { ...DEFAULT_STATE };
    const j = JSON.parse(raw) as Partial<UserMoodState>;
    if (!j.tag || j.tag === 'normal' || typeof j.score !== 'number') return { ...DEFAULT_STATE };
    return {
      tag: j.tag in USER_MOOD_DISPLAY ? (j.tag as UserMoodTag) : 'normal',
      score: Math.max(0, Math.min(100, j.score)),
      at: typeof j.at === 'number' ? j.at : 0,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function setState(cid: string, s: UserMoodState): void {
  try {
    if (s.tag === 'normal') {
      window.localStorage.removeItem(KEY(cid));
    } else {
      window.localStorage.setItem(KEY(cid), JSON.stringify(s));
    }
  } catch {
    /* 存储失败静默（情绪感知绝不影响聊天） */
  }
}

/** 情绪半衰期：25 分钟无强化强度减半；低于 12 分视为回归平静 */
const DECAY_HALF_LIFE = 25 * 60_000;
const FADE_OUT_BELOW = 12;

/** 读当前状态（含时间衰减，读即结算；打点与注入都走这里保证一致） */
export function userMoodOf(cid: string): UserMoodState {
  const s = getState(cid);
  if (s.tag === 'normal' || !s.at) return s;
  const elapsed = Date.now() - s.at;
  if (elapsed <= 0) return s;
  // 指数衰减（半衰期口径）：score *= 0.5 ** (elapsed / halfLife)
  const faded = s.score * Math.pow(0.5, elapsed / DECAY_HALF_LIFE);
  if (faded < FADE_OUT_BELOW) {
    const next = { ...DEFAULT_STATE };
    setState(cid, next);
    return next;
  }
  return { ...s, score: faded };
}

/**
 * 用户发消息打点（chat-stream-store noteEngagement 调用，每轮一次）。
 * 命中任一类情绪词 → 立刻切换/强化该情绪（强度 = 旧值衰减后 + 本次命中权重）；
 * 一条消息只归一类（低落 > 生气 > 兴奋，避免「气笑了」误判兴奋）；
 * 无命中 → 只做衰减，不强行归平静（刚哭完这条没哭不代表好了，交给时间）。
 */
export function noteUserEmotion(cid: string, text: string): UserMoodState {
  const s = userMoodOf(cid); // 读即衰减
  const t = (text || '').trim();
  if (!t) return s;

  const down = hitsOf(t, DOWN_WORDS);
  const angry = hitsOf(t, ANGRY_WORDS);
  const excited = hitsOf(t, EXCITED_WORDS);

  let tag: UserMoodTag | null = null;
  let gain = 0;
  if (down > 0) {
    tag = 'down';
    gain = 38 + Math.min(down - 1, 3) * 14; // 首词 38，之后每词 +14（封顶 3 词加成）
  } else if (angry > 0) {
    tag = 'angry';
    gain = 36 + Math.min(angry - 1, 3) * 14;
  } else if (excited > 0) {
    tag = 'excited';
    gain = 34 + Math.min(excited - 1, 3) * 12;
  }

  if (!tag) {
    // 无新信号：温和恢复（聊着聊着情绪平复）——每条中性消息 -20，降到阈值下回归平静；
    // 剩下的交给时间衰减（userMoodOf 的半衰期）。刚哭完这条没哭 ≠ 立刻好了，所以单条不清零。
    if (s.tag === 'normal') return s;
    const recovered = s.score - 20;
    if (recovered < FADE_OUT_BELOW) {
      const next = { ...DEFAULT_STATE };
      setState(cid, next);
      return next;
    }
    const next = { tag: s.tag, score: recovered, at: s.at };
    setState(cid, next);
    return next;
  }
  // 同类连续命中 → 在衰减后的强度上累加（越聊越激动/越说越委屈）；换类 → 直接切换重计
  const next: UserMoodState =
    tag === s.tag
      ? { tag, score: Math.min(100, s.score + gain), at: Date.now() }
      : { tag, score: Math.min(100, gain), at: Date.now() };
  setState(cid, next);
  return next;
}

// ---------------- 提示词块 ----------------

/** 各情绪的互动指引：AI 该怎么接住对方此刻的状态 */
const USER_MOOD_PROMPT: Record<Exclude<UserMoodTag, 'normal'>, string> = {
  down:
    'TA 现在情绪低落/很累/心情不好。切换到安抚模式：语气放软放温柔，先接住情绪再聊事（比如「怎么啦」「抱抱」），多关心、多陪伴、耐心听 TA 倒苦水；不要说教、不要讲大道理、不要急着给解决方案（TA 没主动问就先别给），更不要在这时候开玩笑开过头或聊自己多开心。',
  excited:
    'TA 现在特别兴奋/超开心/遇到好事了。切换到共庆模式：情绪跟着 TA 一起高涨（多用感叹、追问细节「快说！怎么做到的！」），真心替 TA 高兴、使劲捧场；可以起哄让 TA 请客、多聊聊这件喜事；绝不能泼冷水、摆冷淡、转移话题聊自己。',
  angry:
    'TA 现在在气头上（可能是别人惹的，也可能是你惹的）。先听 TA 说完、弄清楚在气什么：如果是别人惹的——坚定站 TA 这边、跟着一起吐槽讨公道；如果是你惹的——诚恳认错好好哄，别顶嘴别辩解，气头过了再解释；语气可以跟着带点火气（替 TA 骂两句），但对着 TA 本人要收敛。',
};

/**
 * 情绪 → 提示词块（三端聊天 / 主动消息 / 情侣空间行为注入）。
 * 平静（normal）时返回空串省 token；带情绪时注入【对方此刻的状态】+
 * 强度（较明显/非常强烈）+ 互动指引。
 */
export function buildUserMoodBlock(cid: string): string {
  const s = userMoodOf(cid);
  if (s.tag === 'normal') return '';
  const d = USER_MOOD_DISPLAY[s.tag];
  const guide = USER_MOOD_PROMPT[s.tag];
  if (!guide) return '';
  const level = s.score >= 70 ? '非常强烈' : s.score >= 40 ? '很明显' : '隐约';
  return `【对方此刻的状态】从 TA 最近的消息能感觉到 TA 现在情绪${d.label}（${level}）。${guide}这是你对 TA 的感知——据此调整你这一轮的回应方式，自然融入、不要生硬点破（不要说「检测到你情绪低落」这种话）。`;
}

/** 测试/调试用：手动清掉某会话的用户情绪 */
export function resetUserMood(cid: string): void {
  try {
    window.localStorage.removeItem(KEY(cid));
  } catch {
    /* 静默 */
  }
}
