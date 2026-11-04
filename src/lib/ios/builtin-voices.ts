/**
 * 内置免费语音引擎（Web Speech API / speechSynthesis，纯浏览器本地合成）：
 * - 内置 6 个声线（3 女 + 3 男），零配置、免 API Key、离线可用
 * - 声线区分策略（解决「各声线听感雷同 / 与描述不符」）：
 *   1) 独立声源分配：为每个声线尽量分配【不同的】系统中文语音（按风格亲和度排序：
 *      温柔→Xiaoxiao、活泼→Xiaoyi、知性→Yaoyao、清爽→Yunxi、低沉→Yunyang、活力→Kangkang），
 *      系统语音不够需要复用时，强制同声源上的音高间距 ≥ 0.3，并叠加语速差补偿
 *      （部分引擎如 Google 网络语音会忽略音高，语速差是最后手段）；
 *   2) 性别可信度塑形：已知名单判定的性别与声线一致 → 轻塑形贴近描述；
 *      名单没命中（性别不可信）→ 强塑形兜底（男 ≤0.8 / 女 ≥1.05），保证男女听感方向正确
 * - 声线 id 以 builtin: 前缀持久化（defaultVoiceId / 联系人 voiceId），换浏览器仍语义成立：
 *   引擎按上述策略在当前设备就近分配，挑不到理想声源也用塑形保证男女区分
 * - 单例播放：新播放自动停旧的；stopBuiltinSpeech() 供外部打断；
 *   注册到全局音频焦点（与语音消息气泡互斥）
 */

import { registerAudioSource, stopOtherAudio } from './audio-focus';

// ---------------- 声线预设 ----------------

export interface BuiltinVoicePreset {
  /** 持久化 id（defaultVoiceId / 联系人 voiceId 存这个） */
  id: string;
  /** 声线名（如 晓月） */
  name: string;
  gender: 'female' | 'male';
  /** 风格标签（如 温柔） */
  label: string;
  /** 期望音高（1 = 系统默认；最终值由声源分配结果在可信区间内调整） */
  pitch: number;
  /** 期望语速（1 = 正常） */
  rate: number;
}

export const BUILTIN_TTS_VOICES: BuiltinVoicePreset[] = [
  { id: 'builtin:xiaoyue', name: '晓月', gender: 'female', label: '温柔女声', pitch: 1.12, rate: 0.94 },
  { id: 'builtin:xiaoxi', name: '小溪', gender: 'female', label: '活泼女声', pitch: 1.32, rate: 1.12 },
  { id: 'builtin:yunshu', name: '云舒', gender: 'female', label: '知性女声', pitch: 0.92, rate: 0.96 },
  { id: 'builtin:zichuan', name: '子川', gender: 'male', label: '清爽男声', pitch: 1.0, rate: 1.0 },
  { id: 'builtin:moyang', name: '墨阳', gender: 'male', label: '低沉男声', pitch: 0.62, rate: 0.9 },
  { id: 'builtin:chenfeng', name: '辰风', gender: 'male', label: '活力男声', pitch: 0.82, rate: 1.14 },
];

/** 无任何配置时的兜底声线（按性别：电话对端男/女默认不同声线） */
export const BUILTIN_DEFAULT_FEMALE = 'builtin:xiaoyue';
export const BUILTIN_DEFAULT_MALE = 'builtin:zichuan';

// ---------------- 展示列表与判定 ----------------

/** 设置页/联系人音色选择器用的展示列表（{id,name} 结构） */
export const BUILTIN_VOICE_OPTIONS: { id: string; name: string }[] = BUILTIN_TTS_VOICES.map((v) => ({
  id: v.id,
  name: `${v.name}（${v.label}）`,
}));

/** 是否含 builtin: 前缀 */
export function isBuiltinVoiceId(voiceId: string | null | undefined): boolean {
  return typeof voiceId === 'string' && voiceId.startsWith('builtin:');
}

/**
 * 解析应使用的内置声线：
 * 1) 精确匹配预设 id；
 * 2) 旧存档音色名启发式映射（含 female/女 → 女声，含 male/男 → 男声），让历史角色配置也有合理声线；
 * 3) 显式 gender（联系人性别）兜底；
 * 4) 最终默认 晓月（女声）。
 */
export function resolveBuiltinPreset(
  voiceId?: string | null,
  gender?: 'male' | 'female' | null
): BuiltinVoicePreset {
  const v = voiceId?.trim() ?? '';
  if (v) {
    const exact = BUILTIN_TTS_VOICES.find((p) => p.id === v);
    if (exact) return exact;
    const lower = v.toLowerCase();
    if (/female|女/.test(lower)) return BUILTIN_TTS_VOICES[0];
    if (/male|男/.test(lower)) return BUILTIN_TTS_VOICES[3];
  }
  if (gender === 'male') return BUILTIN_TTS_VOICES.find((p) => p.id === BUILTIN_DEFAULT_MALE)!;
  if (gender === 'female') return BUILTIN_TTS_VOICES.find((p) => p.id === BUILTIN_DEFAULT_FEMALE)!;
  return BUILTIN_TTS_VOICES[0];
}

// ---------------- 声源分配规划（纯函数，可独立验证） ----------------

/** 系统语音的最小描述（SpeechSynthesisVoice 的结构子集，便于纯函数测试） */
export interface SystemVoiceDescriptor {
  name: string;
  lang: string;
  localService: boolean;
}

/** 一个声线在某台设备上的最终播放方案 */
export interface BuiltinVoicePlan<T extends SystemVoiceDescriptor = SystemVoiceDescriptor> {
  presetId: string;
  /** 分配到的系统语音（null = 设备无可用语音，交给引擎默认 + 塑形） */
  voice: T | null;
  /** 最终音高（已做性别塑形 + 同声源防撞间距） */
  pitch: number;
  /** 最终语速（共享声源且音高间距不足时含语速差补偿） */
  rate: number;
  /** 底层声源性别是否与声线性别一致（启发式判定可信） */
  genderConfident: boolean;
}

/** 已知常见中文系统音色的性别线索（覆盖 Win/Edge/macOS/Chrome/Android 主流引擎） */
const FEMALE_HINTS =
  /yaoyao|huihui|xiaoxiao|xiaoyi|xiaoyou|xiaohan|xiaomo|xiaqiao|xiaorui|xiaoxuan|yunxia|yunye|ting-?ting|mei-?jia|sin-?ji|hiu-?maan|hiu-?gaai|hsiao-?chen|hsiao-?yu|google|female|女|婷婷|美佳|晓(晓|伊|涵|秋|睿|墨|宇|萱)|云(夏|叶)/i;
const MALE_HINTS =
  /kangkang|yunxi|yunyang|yunjian|yunze|yunfeng|danny|zhiwei|yu-?shu|liang|\btao\b|tian-?qi|yun-?jhe|wan-?lung|li-?mu|male|男|康康|云(希|扬|健|野|枫|泽|杰)|志威|雨叔/i;

/** 判定一支系统语音是否中文（zh 语种或名称含中文线索） */
function isZhVoice(v: SystemVoiceDescriptor): boolean {
  return /^zh([-_]|$)/i.test(v.lang) || /chinese|中文|普通话|国语|國語|粤语|粵語/i.test(v.name);
}

/** 启发式判定系统语音性别；两个名单都命中或都没命中 → unknown（宁可不猜也不猜错） */
function guessGender(v: SystemVoiceDescriptor): 'female' | 'male' | 'unknown' {
  const f = FEMALE_HINTS.test(v.name);
  const m = MALE_HINTS.test(v.name);
  if (f && !m) return 'female';
  if (m && !f) return 'male';
  return 'unknown';
}

/** 各声线的风格亲和度名单（有序：越靠前越贴合描述；用于在同性别多支系统语音里挑最像的） */
const STYLE_AFFINITY: Record<string, RegExp[]> = {
  // 晓月·温柔女声：Xiaoxiao 是最柔和的自然女声，其次瑶瑶/慧慧/婷婷
  'builtin:xiaoyue': [/xiaoxiao|晓晓/i, /yaoyao|瑶瑶/i, /huihui|慧慧/i, /ting-?ting|婷婷/i, /hsiao-?chen/i, /google/i],
  // 小溪·活泼女声：晓伊偏少女活泼，云夏清亮，Sinji/HiuGaai 港腔轻快
  'builtin:xiaoxi': [/xiaoyi|晓伊/i, /yunxia|云夏/i, /sin-?ji/i, /hiu-?gaai/i, /xiaoyou/i, /google/i],
  // 云舒·知性女声：瑶瑶偏成熟稳，MeiJia/美佳端正，慧慧平和
  'builtin:yunshu': [/yaoyao|瑶瑶/i, /mei-?jia|美佳/i, /huihui|慧慧/i, /hiu-?maan/i, /hsiao-?yu/i, /google/i],
  // 子川·清爽男声：云希是偏年轻清爽的男声，其次康康/云杰
  'builtin:zichuan': [/yunxi|云希/i, /kangkang|康康/i, /yun-?jhe/i, /danny/i],
  // 墨阳·低沉男声：云扬（新闻播音风）与云健都偏低沉浑厚，雨叔/万龙亦然
  'builtin:moyang': [/yunyang|云扬/i, /yunjian|云健/i, /yu-?shu|雨叔/i, /wan-?lung/i, /li-?mu/i],
  // 辰风·活力男声：康康明快有劲，云泽其次
  'builtin:chenfeng': [/kangkang|康康/i, /yunze|云泽/i, /yunxi|云希/i, /danny/i, /tian-?qi/i],
};

/** 同一声源上两个声线的最小音高间距（低于该值听感易混，部分引擎还会忽略音高） */
const MIN_PITCH_GAP = 0.3;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clampNum = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** 按性别与可信度给出音高的可行区间 */
function genderClamp(gender: 'female' | 'male', confident: boolean): [number, number] {
  if (gender === 'female') return confident ? [0.75, 1.6] : [1.05, 1.7];
  return confident ? [0.5, 1.05] : [0.35, 0.8];
}

/**
 * 在「期望音高附近 + 同声源防撞约束」内挑最终音高（保证自然度与排序语义）：
 * ① 已占用音高都在安全间距外 → 直接用期望值；
 * ② 否则优先取「距期望值最近、且与所有已占用点间距 ≥ 安全值」的位置（只小幅让位，不跳极端）；
 * ③ 窗口内实在找不到安全位置 → 取最大空闲间隙的中点，让拥挤声源上的音高均匀分布。
 */
function pickPitch(desired: number, clamp: [number, number], existing: number[]): number {
  const p = clampNum(desired, clamp[0], clamp[1]);
  if (existing.length === 0 || existing.every((e) => Math.abs(e - p) >= MIN_PITCH_GAP)) return round2(p);
  const sorted = [...existing].sort((a, b) => a - b);
  const scoreAt = (c: number): number => Math.min(...sorted.map((e) => Math.abs(e - c)));
  // ② 期望值附近（±安全间距×2）找合规点
  const nearLo = Math.max(clamp[0], p - MIN_PITCH_GAP * 2);
  const nearHi = Math.min(clamp[1], p + MIN_PITCH_GAP * 2);
  const nearCandidates = [p, ...sorted.flatMap((e) => [e - MIN_PITCH_GAP, e + MIN_PITCH_GAP])]
    .map((c) => clampNum(c, nearLo, nearHi))
    .filter((c) => scoreAt(c) >= MIN_PITCH_GAP - 1e-9);
  if (nearCandidates.length > 0) {
    return round2(nearCandidates.reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a)));
  }
  // ③ 最大空闲间隙的中点（分段只在可行区间内展开，区间外的占用点不参与）
  const segments: [number, number][] = [];
  let prev = clamp[0];
  for (const e of sorted) {
    if (e <= prev) continue;
    const end = Math.min(e, clamp[1]);
    if (end > prev) segments.push([prev, end]);
    prev = Math.max(prev, end);
    if (prev >= clamp[1]) break;
  }
  if (clamp[1] > prev) segments.push([prev, clamp[1]]);
  if (segments.length === 0) return round2(p);
  const [lo, hi] = segments.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  return round2(clampNum((lo + hi) / 2, clamp[0], clamp[1]));
}

/**
 * 声源分配规划：给定设备上的系统语音列表，为 6 个内置声线各产出一份播放方案。
 * 规则：未被占用的声源优先 → 风格亲和度高的优先 → 本地声源优先 → 列表顺序稳定排序；
 * 同性别声源池为空时依次回退 未知名单池 → 全部中文池；声源复用时用 pickPitch 拉开音高。
 */
export function planBuiltinVoices<T extends SystemVoiceDescriptor>(system: T[]): Map<string, BuiltinVoicePlan<T>> {
  const plans = new Map<string, BuiltinVoicePlan<T>>();
  const presetById = new Map(BUILTIN_TTS_VOICES.map((p) => [p.id, p]));

  if (system.length === 0) {
    // 无可用系统语音：交给引擎默认声源，按性别强塑形兜底
    for (const p of BUILTIN_TTS_VOICES) {
      const clamp = genderClamp(p.gender, false);
      plans.set(p.id, { presetId: p.id, voice: null, pitch: round2(clampNum(p.pitch, clamp[0], clamp[1])), rate: p.rate, genderConfident: false });
    }
    return plans;
  }

  const zh = system.filter(isZhVoice);
  const pool = zh.length > 0 ? zh : system;
  const female = pool.filter((v) => guessGender(v) === 'female');
  const male = pool.filter((v) => guessGender(v) === 'male');
  const unknown = pool.filter((v) => guessGender(v) === 'unknown');

  const voicePitches = new Map<T, number[]>();
  const usedVoices = new Set<T>();

  const affinityRank = (presetId: string, v: T): number => {
    const list = STYLE_AFFINITY[presetId];
    if (!list) return 99;
    const i = list.findIndex((re) => re.test(v.name));
    return i === -1 ? 99 : i;
  };

  const assign = (presetId: string, groupPool: T[]) => {
    const preset = presetById.get(presetId)!;
    const ranked = [...groupPool].sort((a, b) => {
      const ua = usedVoices.has(a) ? 1 : 0;
      const ub = usedVoices.has(b) ? 1 : 0;
      if (ua !== ub) return ua - ub;
      const fa = affinityRank(presetId, a) - affinityRank(presetId, b);
      if (fa !== 0) return fa;
      const la = (a.localService ? 0 : 1) - (b.localService ? 0 : 1);
      if (la !== 0) return la;
      return pool.indexOf(a) - pool.indexOf(b);
    });
    const voice = ranked[0] ?? null;
    if (!voice) {
      const clamp = genderClamp(preset.gender, false);
      plans.set(presetId, { presetId, voice: null, pitch: round2(clampNum(preset.pitch, clamp[0], clamp[1])), rate: preset.rate, genderConfident: false });
      return;
    }
    const confident = guessGender(voice) === preset.gender;
    const clamp = genderClamp(preset.gender, confident);
    const pitch = pickPitch(preset.pitch, clamp, voicePitches.get(voice) ?? []);
    voicePitches.set(voice, [...(voicePitches.get(voice) ?? []), pitch]);
    usedVoices.add(voice);
    plans.set(presetId, { presetId, voice, pitch, rate: preset.rate, genderConfident: confident });
  };

  // 性别池 → 未知名单池 → 全部中文池（逐级回退；女性组先分配并标记占用，男性组尽量避开）
  const femalePool = female.length > 0 ? female : unknown.length > 0 ? unknown : pool;
  const malePool = male.length > 0 ? male : unknown.length > 0 ? unknown : pool;
  for (const id of ['builtin:xiaoyue', 'builtin:xiaoxi', 'builtin:yunshu']) assign(id, femalePool);
  for (const id of ['builtin:zichuan', 'builtin:moyang', 'builtin:chenfeng']) assign(id, malePool);

  // 同一声源被多个声线复用且音高间距不足（引擎可能忽略音高）→ 按音高从低到高叠语速差补偿
  // （voice=null 的方案共用引擎默认声源，同样算一组）
  const byVoice = new Map<string, BuiltinVoicePlan<T>[]>();
  for (const plan of plans.values()) {
    const key = plan.voice ? `${plan.voice.name}|${plan.voice.lang}` : '\0null';
    const arr = byVoice.get(key) ?? [];
    arr.push(plan);
    byVoice.set(key, arr);
  }
  for (const arr of byVoice.values()) {
    if (arr.length < 2) continue;
    const pitches = arr.map((p) => p.pitch).sort((a, b) => a - b);
    const separated = pitches.every((p, i) => i === 0 || p - pitches[i - 1] >= MIN_PITCH_GAP);
    if (separated) continue;
    arr.sort((a, b) => a.pitch - b.pitch);
    arr.forEach((plan, i) => {
      const f = arr.length === 1 ? 1 : 0.88 + (0.24 * i) / (arr.length - 1); // 0.88 → 1.12
      plan.rate = round2(clampNum(plan.rate * f, 0.5, 2));
    });
  }

  return plans;
}

// ---------------- 设备声源缓存与查询 ----------------

let cachedVoices: SpeechSynthesisVoice[] = [];

function listSystemVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const all = window.speechSynthesis.getVoices() ?? [];
  if (all.length > 0) cachedVoices = all;
  return cachedVoices;
}

let planCache: { signature: string; plans: Map<string, BuiltinVoicePlan<SpeechSynthesisVoice>> } | null = null;

function getPlans(): Map<string, BuiltinVoicePlan<SpeechSynthesisVoice>> {
  const voices = listSystemVoices();
  const signature = voices.map((v) => `${v.name}|${v.lang}|${v.localService ? 1 : 0}`).join(';;');
  if (planCache && planCache.signature === signature) return planCache.plans;
  const plans = planBuiltinVoices(voices);
  planCache = { signature, plans };
  return plans;
}

/**
 * 当前设备上 6 个声线的实际声源分配（设置页展示用，让用户看到每个声线背后的系统语音）：
 * 返回 { 声线id: 声源名 }；设备语音未就绪/不支持时返回空对象。
 */
export function describeBuiltinVoiceMappings(): Record<string, string> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return {};
  const plans = getPlans();
  const out: Record<string, string> = {};
  for (const [id, plan] of plans) {
    out[id] = plan.voice ? plan.voice.name : '系统默认声源';
  }
  return out;
}

/** 浏览器是否支持内置语音（客户端调用；SSR 安全） */
export function isBuiltinVoiceSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// ---------------- 引擎可用性探针（国内安卓常无中文 TTS 引擎/网络语音连不上 → 静音） ----------------

/**
 * 探测本地语音引擎是否真的能出声：朗读一个音量为 0 的句号，onstart 触发 = 引擎可用。
 * 背景：speechSynthesis 在 Android Chrome 只要有接口就算「支持」，但设备没装中文 TTS 引擎、
 * 或只有需要连 Google 服务器的网络语音（国内被墙）时，speak() 永远无声——无法从 API 状态区分，
 * 只能小代价实测。结果按会话缓存（引擎可用性中途不会变）。
 * 返回 true = 引擎已证明能出声；false = 未监听/未支持/3.5s 内未出声（按不可用处理，走云端兑底）。
 */
let engineProbe: Promise<boolean> | null = null;

export function probeBuiltinEngine(): Promise<boolean> {
  if (!isBuiltinVoiceSupported()) return Promise.resolve(false);
  if (engineProbe) return engineProbe;
  engineProbe = new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      try {
        window.speechSynthesis.cancel(); // 探针即开始也立刻收掉，不留残余
      } catch {
        // 引擎不可用时静默
      }
      resolve(v);
    };
    try {
      const u = new SpeechSynthesisUtterance('。');
      u.volume = 0; // 静音探针：用户无感知
      u.rate = 2;
      u.onstart = () => finish(true);
      u.onerror = () => finish(false);
      window.speechSynthesis.speak(u);
      window.setTimeout(() => finish(false), 3500);
    } catch {
      finish(false);
    }
  });
  return engineProbe;
}

// ---------------- 单例播放 ----------------

let speakToken = 0;
/** 当前在播的声线 id（设置页/测试用；无在播 = null） */
let activePresetId: string | null = null;
let activeFinish: (() => void) | null = null;

export function isBuiltinSpeaking(): boolean {
  return activePresetId !== null;
}

/** 停止当前内置朗读（页面卸载/外部打断） */
export function stopBuiltinSpeech(): void {
  speakToken += 1;
  activePresetId = null;
  const finish = activeFinish;
  activeFinish = null;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // 引擎不可用时静默
    }
  }
  finish?.();
}

export interface BuiltinSpeakOptions {
  /** 已清洗的文本（调用方先做 cleanTextForTts；这里只兜底去空白） */
  text: string;
  /** 声线 id（builtin:… 或可启发式映射的旧音色名；空 = 默认女声） */
  voiceId?: string | null;
  gender?: 'male' | 'female' | null;
  volume?: number;
  /** 额外语速倍率（叠加在声线语速上，电话快语速等场景用） */
  speed?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
  /** 播放进度回调（0~1，boundary 事件驱动；逐字字幕同步用；部分引擎不触发则由调用方自行兑底） */
  onProgress?: (ratio: number) => void;
  /** 出声前取消检查（电话挂断等）：返回 true 静默丢弃 */
  cancelled?: () => boolean;
  /**
   * 跳过「停掉其它音频源」的互斥（默认 false）：
   * 语音消息气泡的 AI 语音通道自己已经停过其它音频，且要把播放状态留给气泡 UI，
   * 传 true 避免把语音气泡自身的播放状态清掉；其它调用方保持默认互斥行为。
   */
  keepOthers?: boolean;
}

/**
 * 用浏览器内置引擎朗读一段文本（单例）。
 * 返回「是否真正出声」：引擎 onstart 触发 = true；不支持/无文本/启动看门狗超时（设备无可用
 * 语音引擎，常见于国内安卓）= false —— 调用方可据此走云端 TTS 兑底，不再无声。
 * 正常结束走 onEnd；被打断（stopBuiltinSpeech）只 resolve 不回调。
 * iOS Safari 看门狗（#19）：onend 在长文本下可能永不触发 ——
 * ① 无启动兜底（onstart ~8s 未触发 → 静默 finish，不算说过话）；
 * ② onstart 后每 ~1.2s 轮询 speaking/pending（引擎既不说也没排队 → 走「自然结束」触发 onEnd）；
 * ③ 按文本量估算的硬超时（强制自然结束）——三重兜底保证本 Promise 一定能 resolve，
 *   免提通话状态机不再卡死在「正在说话」。
 */
export async function speakBuiltin(opts: BuiltinSpeakOptions): Promise<boolean> {
  if (!isBuiltinVoiceSupported()) {
    const msg = '当前浏览器不支持内置语音';
    opts.onError?.(msg);
    throw new Error(msg);
  }
  const text = opts.text.trim();
  if (!text) {
    const msg = '没有可朗读的文本';
    opts.onError?.(msg);
    throw new Error(msg);
  }
  const preset = resolveBuiltinPreset(opts.voiceId, opts.gender);
  // 语音列表可能异步就绪：先 cancel 旧播放，再等一次 voices 就绪窗口
  if (!opts.keepOthers) stopOtherAudio('builtin-tts');
  stopBuiltinSpeech();
  const myToken = speakToken;

  // 是否真正出声（onstart 触发）；resolve 时返回给调用方，用于「引擎静音 → 云端兑底」决策
  let spoke = false;

  await new Promise<void>((resolve) => {
    let finished = false;
    // ---- 看门狗（iOS Safari 坑：长文本朗读 utter.onend/onerror 可能一个都不触发，原实现里两者是唯一收尾路径，
    // ---- Promise 永不 resolve → 免提通话状态机卡死在「正在说话」）。三重兜底，全部定时器在 finish() 统一清理
    // ---- （stopBuiltinSpeech 打断路径同样调 finish，不会泄漏）。----
    let startFallbackTimer: number | null = null; // ① 无启动兜底：onstart 一直不触发（引擎根本没出声）
    let enginePollTimer: number | null = null; // ② 引擎状态轮询：onstart 后每 ~1.2s 查 speaking/pending
    let hardStopTimer: number | null = null; // ③ 硬性兜底：按文本量估算的超时
    // onEnd / onError 防重（局部布尔）：onEnd 绝不重复触发、onError 后不再触发 onEnd
    let endedNotified = false;
    let erroredNotified = false;
    const clearWatchdogs = () => {
      if (startFallbackTimer !== null) {
        window.clearTimeout(startFallbackTimer);
        startFallbackTimer = null;
      }
      if (enginePollTimer !== null) {
        window.clearInterval(enginePollTimer);
        enginePollTimer = null;
      }
      if (hardStopTimer !== null) {
        window.clearTimeout(hardStopTimer);
        hardStopTimer = null;
      }
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      clearWatchdogs();
      if (activePresetId === preset.id) activePresetId = null;
      if (activeFinish === finish) activeFinish = null;
      resolve();
    };
    /**
     * 「自然结束」路径：语义与收到 onend 完全一致——先触发 opts.onEnd（保证只触发一次）再 finish。
     * 引擎状态轮询与硬性兜底都走这里，让调用方状态机（说完→回到听）正常往下走。
     */
    const finishNatural = () => {
      if (finished || erroredNotified) return;
      if (!endedNotified) {
        endedNotified = true;
        if (myToken === speakToken) {
          try {
            opts.onEnd?.();
          } catch {
            // 回调异常不影响收尾
          }
        }
      }
      finish();
    };
    activeFinish = finish;
    activePresetId = preset.id;

    const start = () => {
      if (myToken !== speakToken || opts.cancelled?.()) {
        finish();
        return;
      }
      const utter = new SpeechSynthesisUtterance(text.slice(0, 900));
      const plan = getPlans().get(preset.id);
      const sysVoice = plan?.voice ?? null;
      if (sysVoice) utter.voice = sysVoice;
      utter.lang = sysVoice?.lang || 'zh-CN';
      utter.pitch = Math.min(2, Math.max(0, plan?.pitch ?? preset.pitch));
      utter.rate = Math.min(3, Math.max(0.5, (plan?.rate ?? preset.rate) * (opts.speed ?? 1)));
      utter.volume = Math.min(1, Math.max(0, opts.volume ?? 1));
      utter.onstart = () => {
        if (myToken !== speakToken || opts.cancelled?.()) {
          finish();
          return;
        }
        spoke = true; // 引擎真正出声：供调用方判断「本地引擎可用」
        // 引擎真正出声：清掉「无启动兜底」
        if (startFallbackTimer !== null) {
          window.clearTimeout(startFallbackTimer);
          startFallbackTimer = null;
        }
        opts.onStart?.();
        // ② 引擎状态轮询：iOS Safari 长文本 onend 丢失后，引擎的 speaking/pending 状态仍会归位——
        // 既不在说也没排队 = 播放其实已结束只是事件没触发 → 走「自然结束」路径
        if (enginePollTimer === null) {
          enginePollTimer = window.setInterval(() => {
            if (finished) return;
            try {
              const ss = window.speechSynthesis;
              if (!ss.speaking && !ss.pending) {
                const id = enginePollTimer;
                if (id !== null) window.clearInterval(id);
                enginePollTimer = null;
                finishNatural();
              }
            } catch {
              // 引擎状态读不到：继续靠硬性兜底
            }
          }, 1200);
        }
        // ③ 硬性兜底：按文本量估算朗读时长（约 3 字/秒 × 有效语速）+ 20s 富余，超时强制自然结束——
        // 保证 await speakBuiltin 一定能 resolve，即使轮询状态也被引擎卡住
        if (hardStopTimer === null) {
          const effRate = Math.max(0.1, (plan?.rate ?? preset.rate) * (opts.speed ?? 1));
          hardStopTimer = window.setTimeout(() => {
            hardStopTimer = null;
            finishNatural();
          }, Math.round((text.length / (3.0 * effRate)) * 1000) + 20000);
        }
      };
      // boundary 事件：朗读到某字/词边界时触发（Chrome/Edge 支持），用于逐字字幕同步
      utter.onboundary = (e) => {
        if (myToken !== speakToken || opts.cancelled?.()) return;
        const total = Math.max(1, text.length);
        opts.onProgress?.(Math.min(0.98, (e.charIndex || 0) / total));
      };
      utter.onend = () => {
        // 正常结束路径：同样走防重判定（若看门狗先到/已 onError 则不重复触发 onEnd）
        if (myToken === speakToken && !finished && !erroredNotified && !endedNotified) {
          endedNotified = true;
          try {
            opts.onEnd?.();
          } catch {
            // 回调异常不影响收尾
          }
        }
        finish();
      };
      utter.onerror = () => {
        if (myToken === speakToken && !erroredNotified) {
          erroredNotified = true;
          opts.onError?.('内置语音播放失败');
        }
        finish();
      };
      try {
        window.speechSynthesis.speak(utter);
      } catch {
        opts.onError?.('内置语音播放失败');
        finish();
        return;
      }
      // ① 无启动兜底：iOS Safari 引擎可能根本没真正出声且 onstart/onerror 都不触发——
      // ~8s 内 onstart 没来就静默 finish（不调 onEnd/onError：没出声就不算说过话，
      // 让调用方状态机正常往下走），并 cancel 掉万一「迟到才开始」的播放
      startFallbackTimer = window.setTimeout(() => {
        startFallbackTimer = null;
        if (finished) return;
        try {
          window.speechSynthesis.cancel();
        } catch {
          // 引擎不可用时静默
        }
        finish();
      }, 8000);
    };

    // voiceschanged 首次触发前 getVoices() 可能为空：最多等 600ms 再开播
    if (listSystemVoices().length > 0) {
      start();
    } else {
      const timer = window.setTimeout(() => {
        window.speechSynthesis.removeEventListener?.('voiceschanged', onVoices);
        start();
      }, 600);
      const onVoices = () => {
        if (listSystemVoices().length > 0) {
          window.clearTimeout(timer);
          window.speechSynthesis.removeEventListener?.('voiceschanged', onVoices);
          start();
        }
      };
      try {
        window.speechSynthesis.addEventListener('voiceschanged', onVoices);
      } catch {
        // addEventListener 不可用时靠 timer 兜底
      }
    }
  });
  // 返回「是否真正出声」：false = 引擎静音（设备无中文 TTS 引擎/网络语音不可达），
  // 调用方（tts-client）据此走云端 TTS 兜底
  return spoke;
}

// 注册到全局音频焦点：语音消息气泡/其它 TTS 开播前会停掉这里
registerAudioSource('builtin-tts', () => stopBuiltinSpeech());
