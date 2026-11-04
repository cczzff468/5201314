/**
 * 语音 API 共享客户端（电话 / 微信 / QQ 三端共用的 TTS 播放链路）：
 * - 配置来源：设置 App「语音 API」（useSettings.ttsConfig），每次播放现场读取 → 保存即生效，无需重启
 * - 服务商：内置语音 / MiniMax / OpenAI 兼容 / Fish Audio（Task 29）
 * - 音色优先级：当前角色 voiceId（每次播放实时从联系人库重读，切角色不沿用缓存；fishaudio: 前缀音色
 *   只在 Fish Audio 服务商下生效）→ 全局默认音色 → 服务商安全默认音色（Fish Audio = 平台默认音色）
 * - 文本清理：剥离舞台动作（*…*、（…）、【…】）与 Markdown/表情等不可朗读标记
 * - 播放器：模块级单例，新播放开始前自动停止旧音频；stopSpeaking() 供页面销毁时释放
 * - 安全：API Key 只随请求体发给本站代理 /api/tts，不在任何日志中出现
 */

import { stopOtherAudio, registerAudioSource } from './audio-focus';
import { getContact } from './contacts-store';
import { FISH_VOICE_PREFIX, SAFE_VOICE_BY_PROVIDER, type TtsConfig, useSettings } from './store';
import {
  isBuiltinVoiceSupported,
  isBuiltinVoiceId,
  probeBuiltinEngine,
  resolveBuiltinPreset,
  speakBuiltin,
  stopBuiltinSpeech,
  BUILTIN_DEFAULT_FEMALE,
  BUILTIN_DEFAULT_MALE,
} from './builtin-voices';

// 类型与默认值定义在 store（避免循环依赖），这里重导出供 UI 层使用
export type { TtsConfig } from './store';

/** 语音 API 是否已配置：内置语音免配置恒可用；其余服务商有 Key 且有地址才走用户服务 */
export function isTtsConfigured(cfg?: TtsConfig): boolean {
  const c = cfg ?? useSettings.getState().ttsConfig;
  if (c.provider === 'builtin') return true;
  return Boolean(c.apiKey.trim() && c.baseUrl.trim());
}

/**
 * 用户是否「配置了语音 API」（设置 App「语音 API」里选了服务商并填了 Key+地址）。
 * 与 isTtsConfigured 的区别：内置语音引擎免配置恒可用（isTtsConfigured 恒 true）。
 * 注意：自 Task 33 起通话中文字聊天不再用本函数决定「AI 是否语音回复」——
 * 只要配置了声音（内置语音恒可用）通话内文字回复一律同时播报。
 */
export function hasCustomTtsApi(cfg?: TtsConfig): boolean {
  const c = cfg ?? useSettings.getState().ttsConfig;
  return c.provider !== 'builtin' && Boolean(c.apiKey.trim() && c.baseUrl.trim());
}

// ---------------- 文本清理（剥离不可朗读的舞台动作与标记） ----------------

/** 依次剥离：代码块/行内代码、舞台动作（*…* ＊…＊）、括号旁白（（…）(…)）、【…】标签、
 *  引用块/标题/链接的 Markdown 残留、[表情包]/[表情]/[图片] 等方括号标记、URL、emoji 符号 */
export function cleanTextForTts(raw: string): string {
  let t = raw ?? '';
  if (!t) return '';
  t = t.replace(/```[\s\S]*?```/g, ' '); // 代码块整体去掉
  t = t.replace(/`([^`]*)`/g, '$1'); // 行内代码保留内容
  // 舞台动作：*摸摸头* ＊微笑＊（含加粗 **…** 一并处理：先去加粗再去单星动作）
  t = t.replace(/\*\*([^*]*)\*\*/g, '$1');
  t = t.replace(/\*([^*\n]{0,80})\*/g, ' ');
  t = t.replace(/＊([^＊\n]{0,80})＊/g, ' ');
  // 括号旁白：（轻笑）(低头) 等
  t = t.replace(/（([^（）\n]{0,60})）/g, ' ');
  t = t.replace(/\(([^()\n]{0,60})\)/g, ' ');
  // 【系统提示】等标签段
  t = t.replace(/【([^【】\n]{0,40})】/g, ' ');
  // 方括号标记：[表情包] [表情] [图片] [语音] 等
  t = t.replace(/\[[^\]\n]{0,20}\]/g, ' ');
  // Markdown 残留：标题/引用/加粗斜体/分隔线
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/^>\s?/gm, '');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/(^|\s)\*([^*\s][^*]*)\*(?=\s|$)/g, '$1$2');
  t = t.replace(/~~([^~]+)~~/g, '$1');
  t = t.replace(/^[-—_=]{3,}\s*$/gm, ' ');
  // 链接只留文字
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  // URL
  t = t.replace(/https?:\/\/\S+/g, ' ');
  // emoji / 装饰符号（保留中日韩、字母数字、常用标点与空格）
  t = t.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu,
    ' '
  );
  // 看不见的占位字符（零宽/双向控制/词连接符/盲文空格/韩文填充符等）：Trim 不认识它们，
  // 残留在朗读文本里就是一段「空白语音」（AI 动作剥离后只留下这些字符时尤其会出现）
  t = t.replace(/[\u200B\u200C\u200D\u200E\u200F\u2060\u2800\u3164\uFFA0]+/g, ' ');
  // 压缩空白（换行变空格，多空格合一）
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

// ---------------- 音色解析（角色优先，现场重读不缓存） ----------------

/**
 * 把联系人/我的音色里存的 voiceId 换算成「当前服务商」可用的音色 ID（Task 29 Fish Audio 多服务商）：
 * - `fishaudio:` 前缀（历史存档联系人绑定过 Fish Audio 音色时可能带有）：当前服务商是 Fish Audio → 剥前缀取音色 ID；
 *   其它服务商（MiniMax/OpenAI）→ 返回空串不采用（Fish Audio 的哈希 ID 对它们无意义，避免拿错 ID 请求失败）
 * - 其它值（裸 ID：MiniMax/OpenAI 音色名、内置声线、手动填写的 Fish Audio 音色 ID）→ 原样返回（完全兼容旧数据）
 */
export function voiceIdForProvider(raw: string | null | undefined, provider: TtsConfig['provider']): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  if (v.startsWith(FISH_VOICE_PREFIX)) {
    return provider === 'fishaudio' ? v.slice(FISH_VOICE_PREFIX.length).trim() : '';
  }
  return v;
}

export interface ResolvedVoice {
  voiceId: string;
  /** 'contact' = 角色独立音色；'global' = 全局默认；'builtin' = 程序安全默认 */
  source: 'contact' | 'global' | 'builtin';
  /** 联系人性别（男/女；未知为 null）——内置声线兜底时按性别选默认声线用 */
  gender?: 'male' | 'female' | null;
}

/**
 * 解析某联系人应使用的音色：
 * 1) 联系人 voiceId（每次实时 getContact 重读——切换角色/改音色后立刻生效，绝不沿用上一角色缓存）
 * 2) 全局默认 defaultVoiceId
 * 3) 服务商安全默认音色
 * contactId 为空（陌生来电等）直接从 2) 开始。
 */
export async function resolveVoiceForContact(contactId: string | null | undefined): Promise<ResolvedVoice> {
  const cfg = useSettings.getState().ttsConfig;
  let gender: 'male' | 'female' | null = null;
  if (contactId) {
    try {
      const c = await getContact(contactId);
      // 多服务商（Task 29）：fishaudio: 前缀音色只在 Fish Audio 服务商下生效，其它服务商忽略落到全局默认
      const v = voiceIdForProvider(c?.voiceId, cfg.provider);
      const g = c?.gender?.trim() ?? '';
      gender = g.includes('男') ? 'male' : g.includes('女') ? 'female' : null;
      if (v) return { voiceId: v, source: 'contact', gender };
    } catch {
      // 联系人读取失败不阻塞：落到全局默认
    }
  }
  const global = cfg.defaultVoiceId.trim();
  if (global) return { voiceId: global, source: 'global', gender };
  return { voiceId: SAFE_VOICE_BY_PROVIDER[cfg.provider] ?? 'alloy', source: 'builtin', gender };
}

// ---------------- 单例播放器 ----------------

/** 播放令牌：每次新播放 +1；旧链路的收尾回调发现令牌对不上就不再触碰公共状态 */
let playToken = 0;
let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
/** 当前播放的收尾回调：stopSpeaking() 暂停音频时同步 resolve 等待中的调用方（防 await 永久悬挂） */
let currentFinish: (() => void) | null = null;

/**
 * 本地内置引擎是否已证明「哑火」（无中文 TTS 引擎/网络语音不可达，国内安卓常见）：
 * 首次探针/播放确认静音后置位，本会话后续直接走云端兜底（不再重复探测白等）。
 */
let builtinEngineBroken = false;

/**
 * 停止当前播放并释放资源（页面销毁/挂断/切聊天/新一轮播放前调用）。
 * API 音频与内置朗读引擎（speechSynthesis）一并【立刻】截断——挂断电话后声音必须立即停止（用户反馈），
 * 内置引擎此前只被各播放函数自行管理、挂断时漏停，这里统一收口。
 */
export function stopSpeaking(): void {
  playToken += 1;
  const audio = currentAudio;
  currentAudio = null;
  const finish = currentFinish;
  currentFinish = null;
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    try {
      audio.pause();
    } catch {
      // 已释放的 Audio 再 pause 不抛错，这里兜住
    }
    audio.src = '';
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  finish?.();
  stopBuiltinSpeech();
}

export function isSpeaking(): boolean {
  return currentAudio !== null;
}

/**
 * 表达风格 → TTS 语速联动（B4，锦上添花）：从联系人「表达风格」文本识别语气关键词，
 * 轻声细语类稍慢（0.85）/ 活泼元气类稍快（1.12）/ 识别不到 = 1 原速。
 * 只影响语音条合成与朗读的语速参数（引擎不支持时由服务端自行收敛），不影响文字聊天；
 * 受 TTS 引擎能力限制，效果不保证，属氛围增强。
 */
export function expressStyleTtsSpeed(style: string | null | undefined): number {
  const s = (style ?? '').trim();
  if (!s) return 1;
  if (/轻声|轻柔|温柔|细语|温婉|慵懒|缓慢|慢条斯理|低声|缠绵/.test(s)) return 0.85;
  if (/活泼|元气|兴奋|激动|急躁|急性子|机关枪|快人快语|干脆利落|语速快|咋咋呼呼/.test(s)) return 1.12;
  return 1;
}

export interface SpeakOptions {
  /** 原始文本（内部会先 cleanTextForTts） */
  text: string;
  /** 角色联系人 ID：决定用谁的音色（角色 voiceId → 全局默认 → 安全默认） */
  contactId?: string | null;
  /** 显式指定音色（优先于联系人解析；设置页试听用） */
  voiceId?: string;
  volume?: number;
  speed?: number;
  /** 播放取消检查：合成返回后、真正出声前调用；返回 true 则静默丢弃（电话挂断等场景） */
  cancelled?: () => boolean;
  /** 真正开始出声前的回调（UI 置为「播放中」用）；播放失败不触发 */
  onStart?: () => void;
  /** 播放进度回调（0~1，逐字字幕同步用）：API 音频走 timeupdate，内置引擎走 boundary 事件；
   *  引擎不报进度时由内置估算兜底（按字数×语速推算），不触发则调用方自行处理 */
  onProgress?: (ratio: number) => void;
  /** 播放自然结束后的回调（被 stopSpeaking 打断时不触发）；失败仍会抛错不走这里 */
  onEnd?: () => void;
  /**
   * 跳过「停掉其它音频源」的互斥（默认 false；仅 API 合成通道需要）。
   * 语音消息气泡的实时朗读自己已经停过其它音频、且要把播放状态留给气泡 UI，
   * 传 true 避免把语音气泡自身的播放状态清掉；其它调用方保持默认互斥行为。
   */
  keepOthers?: boolean;
}

/**
 * 播放一段文本（单例：自动停掉上一段）：
 * - 服务商 = 内置语音，或 API 未配置 → 浏览器本地引擎（免费、零配置）；
 *   本地引擎「哑火」（设备无中文 TTS / 网络语音被墙，国内安卓常见）→ 自动降级云端合成
 *   （provider='server'，零配置），保证一定有声音；
 * - 否则走用户语音 API（经本站代理 /api/tts）。
 * 本地+云端都失败才抛错（含服务商中文文案）——调用方决定是否回退服务端兜底；文字聊天不受影响。
 */
export async function speakUserTts(optsIn: SpeakOptions): Promise<void> {
  let opts = optsIn;
  // B4 表达风格 → 语速联动：调用方未显式指定语速且带联系人时，按 TA 的「表达风格」
  // 关键词微调（轻声细语类稍慢 / 活泼元气类稍快，见 expressStyleTtsSpeed）——
  // 一次覆盖语音条点击朗读、微信/QQ/信息通话播报、电话 App 朗读等全部调用方；
  // 联系人读取失败或未识别到关键词 = 1 原速，行为不变
  if (opts.speed === undefined && opts.contactId) {
    try {
      opts = { ...opts, speed: expressStyleTtsSpeed((await getContact(opts.contactId))?.expressStyle) };
    } catch {
      /* 联系人读取失败 = 原速 */
    }
  }
  const cfg = useSettings.getState().ttsConfig;
  const useBuiltinEngine = cfg.provider === 'builtin' || !isTtsConfigured(cfg);
  const cleaned = cleanTextForTts(opts.text);
  if (!cleaned) {
    throw new Error('没有可朗读的文本');
  }

  // ---- 进度包装：真实进度（timeupdate / boundary）优先；启动后 600ms 仍无真实进度则按字数×语速估算兜底 ----
  const estDurationMs = Math.max(600, (cleaned.length / (3.8 * (opts.speed ?? 1))) * 1000);
  let realProgress = false;
  let fallbackTimer: number | null = null;
  let startedAt = 0;
  const emitReal = (r: number) => {
    realProgress = true;
    opts.onProgress?.(r);
  };
  const startFallback = () => {
    startedAt = Date.now();
    if (fallbackTimer !== null) return;
    fallbackTimer = window.setInterval(() => {
      if (realProgress || opts.cancelled?.()) return;
      const r = (Date.now() - startedAt) / estDurationMs;
      if (r > 0.02 && r < 0.98) opts.onProgress?.(Math.min(0.95, r));
    }, 120);
  };
  const stopFallback = () => {
    if (fallbackTimer !== null) {
      window.clearInterval(fallbackTimer);
      fallbackTimer = null;
    }
  };
  const wrapped = {
    ...opts,
    onProgress: emitReal,
    onStart: () => {
      startFallback();
      opts.onStart?.();
    },
    onEnd: () => {
      stopFallback();
      opts.onEnd?.();
    },
  };

  try {
  // ① 内置语音：本地引擎可用→本地朗读（零延迟、离线）；静音/不支持→云端兜底（零配置，一定有声音）
  if (useBuiltinEngine) {
    const rv = await resolveVoiceForContact(opts.contactId ?? null);
    const explicit = opts.voiceId?.trim() ?? '';
    let voiceId = explicit || rv.voiceId;
    // 角色与全局都没设音色时，按联系人性别给默认声线（男→子川，女→晓月）
    if (!explicit && rv.source === 'builtin' && rv.gender) {
      voiceId = rv.gender === 'male' ? BUILTIN_DEFAULT_MALE : BUILTIN_DEFAULT_FEMALE;
    }
    const presetGender = resolveBuiltinPreset(voiceId, rv.gender).gender;

    let errorMessage: string | null = null;
    let spoke = false;
    if (isBuiltinVoiceSupported() && !builtinEngineBroken && (await probeBuiltinEngine())) {
      // 引擎可用性探针（≤3.5s，会话级缓存）：国内安卓无中文 TTS 引擎/网络语音被墙时直接跳过本地，
      // 不再傻等 8s 启动看门狗；探针已由首次用户手势预热（模块尾部）
      await speakBuiltin({
        text: cleaned,
        voiceId,
        volume: opts.volume,
        speed: opts.speed,
        keepOthers: opts.keepOthers,
        onStart: wrapped.onStart,
        onEnd: wrapped.onEnd,
        onProgress: wrapped.onProgress,
        onError: (m) => {
          errorMessage = m;
        },
        cancelled: opts.cancelled,
      }).then(
        (v) => {
          spoke = v;
        },
        () => {
          spoke = false;
        },
      );
    }
    if (spoke && !errorMessage) return;
    // 本地引擎不出声（无中文 TTS 引擎/网络语音被墙）或播放中途报错：
    // 标记哑火（后续播放免探测）+ 云端兜底，保证「一定有声音」；云端也失败才抛错给调用方
    builtinEngineBroken = true;
    try {
      await playCloudTtsFallback(cleaned, presetGender, opts, estDurationMs, wrapped);
      return;
    } catch (cloudErr) {
      throw errorMessage ? new Error(errorMessage) : cloudErr;
    }
  }

  // ② 用户语音 API（MiniMax / OpenAI 兼容）
  let voiceId = opts.voiceId?.trim() || (await resolveVoiceForContact(opts.contactId ?? null)).voiceId;
  // 内置声线 id（builtin:…）第三方服务商不认识：替换成该服务商的安全默认音色——
  // 否则全局默认/联系人音色设为内置声线时，通话与试听会因 API 报错静默降级成文字
  // （与 ai-voice.resolveAiVoiceIdForApi 对 AI 语音消息的替换规则保持一致）
  if (cfg.provider !== 'builtin' && isBuiltinVoiceId(voiceId)) {
    voiceId = SAFE_VOICE_BY_PROVIDER[cfg.provider] ?? voiceId;
  }

  stopSpeaking();
  // 与语音消息气泡播放互斥：开始 TTS 朗读前停掉在播的语音气泡
  //（语音气泡的实时朗读通道传 keepOthers 自己管互斥，避免把自身播放状态清掉）
  if (!opts.keepOthers) stopOtherAudio('tts');
  const myToken = playToken;

  let res: Response;
  try {
    // #20 通话链路超时看门狗：合成请求 30s 到点必失败（AbortSignal.timeout 抛 DOMException TimeoutError），
    // 上游卡死不再让通话状态机无限等待；正常请求不受影响
    res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg, voiceId, text: cleaned.slice(0, 900), speed: opts.speed ?? 1 }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    // 超时错误映射成友好中文（错误文案可能直接进 UI/气泡提示）
    const name = (err as { name?: string } | null)?.name ?? '';
    const msg = err instanceof Error ? err.message : String(err ?? '');
    if (name === 'TimeoutError' || /timeout|timed out/i.test(msg)) {
      throw new Error('语音合成超时，请稍后再试');
    }
    throw err;
  }
  if (!res.ok) {
    let msg = '语音生成失败';
    try {
      const j = (await res.json()) as { error?: string } | null;
      if (j?.error) msg = j.error;
    } catch {
      // 非 JSON 错误体（网关页等）用默认文案
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  if (myToken !== playToken || opts.cancelled?.()) {
    return; // 期间已有新播放/已取消：直接丢弃这段音频
  }

  await playTtsAudioBlob(blob, opts, myToken, estDurationMs, wrapped);
  // 正常播完（未被 stopSpeaking 打断）才触发 onEnd；电话的「对方讲完→回到听」状态机依赖它
  if (myToken === playToken) wrapped.onEnd?.();
  } finally {
    stopFallback();
  }
}

/**
 * 播放一段 TTS 音频 Blob（用户 API 通道与云端兜底共用）：
 * 进度（timeupdate 真实进度）、硬超时兜底（onended 丢失防悬挂）、令牌防旧链路触碰公共状态。
 */
function playTtsAudioBlob(blob: Blob, opts: SpeakOptions, myToken: number, estDurationMs: number, wrapped: SpeakOptions): Promise<void> {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.volume = opts.volume ?? 1;
  currentAudio = audio;
  currentUrl = url;

  return new Promise<void>((resolve) => {
    let finished = false;
    // 轻量硬超时兜底（#19 同类风险）：HTMLAudioElement 的 onended 在个别引擎/流异常下也可能丢失
    // （播放卡死 → await 永久悬挂、通话状态机停在「正在说话」）——按文本量估算音频时长
    // （estDurationMs 已在上方按字数×语速算好）+ 15s 富余，到点静默 finish；
    // 正常 onended / onerror / stopSpeaking 路径都会在 finish 里清掉它
    let audioHardTimer: number | null = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (audioHardTimer !== null) {
        window.clearTimeout(audioHardTimer);
        audioHardTimer = null;
      }
      audio.ontimeupdate = null;
      if (currentUrl === url) {
        URL.revokeObjectURL(url);
        currentUrl = null;
      }
      if (currentAudio === audio) currentAudio = null;
      if (currentFinish === finish) currentFinish = null;
      resolve();
    };
    currentFinish = finish;
    audio.onended = finish;
    audio.onerror = finish;
    if (myToken === playToken && !opts.cancelled?.()) wrapped.onStart?.();
    // timeupdate → 真实播放进度（逐字字幕同步）
    audio.ontimeupdate = () => {
      const d = audio.duration;
      if (myToken === playToken && Number.isFinite(d) && d > 0) {
        wrapped.onProgress?.(Math.min(0.98, audio.currentTime / d));
      }
    };
    audio.play().catch(finish); // 自动播放策略等导致的播放失败：静默结束
    audioHardTimer = window.setTimeout(finish, estDurationMs + 15000);
  });
}

/**
 * 云端 TTS 兜底（provider='server'，零配置）：本地 speechSynthesis 哑火时拉 mp3 用 Audio 播放。
 * 音色按声线性别映射（女→tongtong 温暖亲切 / 男→xiaochen 沉稳专业）；
 * 进度/收尾语义与用户 API 通道完全一致，通话状态机无感切换。
 */
async function playCloudTtsFallback(
  cleaned: string,
  gender: 'male' | 'female' | null,
  opts: SpeakOptions,
  estDurationMs: number,
  wrapped: SpeakOptions,
): Promise<void> {
  stopSpeaking();
  if (!opts.keepOthers) stopOtherAudio('tts');
  const myToken = playToken;
  const cloudVoice = gender === 'male' ? 'xiaochen' : 'tongtong';
  let res: Response;
  try {
    // 与主通道同款 30s 看门狗：云端合成卡死不让通话状态机无限等待
    res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: { provider: 'server' },
        voiceId: cloudVoice,
        text: cleaned.slice(0, 900),
        speed: opts.speed ?? 1,
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name ?? '';
    const msg = err instanceof Error ? err.message : String(err ?? '');
    if (name === 'TimeoutError' || /timeout|timed out/i.test(msg)) {
      throw new Error('云端语音合成超时，请稍后再试');
    }
    throw err;
  }
  if (!res.ok) {
    let msg = '云端语音生成失败';
    try {
      const j = (await res.json()) as { error?: string } | null;
      if (j?.error) msg = j.error;
    } catch {
      // 非 JSON 错误体（网关页等）用默认文案
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  if (myToken !== playToken || opts.cancelled?.()) {
    return; // 期间已有新播放/已取消：直接丢弃这段音频
  }
  await playTtsAudioBlob(blob, opts, myToken, estDurationMs, wrapped);
  if (myToken === playToken) wrapped.onEnd?.();
}

if (typeof window !== 'undefined') {
  // 首次用户手势时预热本地引擎探针（音量为 0 的静音实测，用户无感知）：
  // 探明「哑火」后，首次真实播放直接云端兜底，不再有探测等待
  const warmEngine = () => {
    window.removeEventListener('pointerdown', warmEngine);
    void probeBuiltinEngine();
  };
  window.addEventListener('pointerdown', warmEngine, { passive: true });
}

// 注册到全局音频焦点：语音消息气泡开始播放前会停掉这里的 TTS 朗读
registerAudioSource('tts', () => stopSpeaking());
