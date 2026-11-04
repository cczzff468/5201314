'use client';

/**
 * 通知提示音引擎（设置 › 通知 · 声音与铃声）：
 *
 * 五类声音（NotifySoundCategory）：
 * - receive  接收消息：AI 给「我」发消息（单聊；灵动岛 pushChatNotification 统一挂点）
 * - group    群消息：群聊新消息（sessionKey 含 ':group:' 时走这一路）
 * - send     发送消息：用户发出消息（各聊天端 send/sendSticker 挂点）
 * - moments  朋友圈互动：点赞/评论/回复/转发（moments.ts pushMomentNotice platform='wx'）
 * - qzone    QQ动态互动：赞和推/评论/转发（同上 platform='qq'）
 *
 * 每类独立配置：铃声选择 / 试听 / 音量 / 开关 / 免打扰时段；
 * 全局：总开关（一键静音）/ 总音量 / 免打扰时段 / 震动。
 *
 * 铃声来源：内置 8 个（Web Audio 实时合成，零音频文件）+ 用户上传（IndexedDB `ringtones`
 * 表永久保存，可删除）；设置整体存 `settings` 表 'notifySound' 键（KV）。
 *
 * 行为契约：
 * - 所有配置改动即时写库并即时生效（播放前现场读 store，无需重启）；
 * - 免打扰/静音只关声音，通知弹窗与收件箱记录照常（需求：不响但保留记录）；
 * - 设置为整机共享（不随聊天账号切换），与真实 iOS 的设备级提示音一致；
 * - 播放失败全部静默降级，绝不影响消息收发主流程。
 */

import { create } from 'zustand';
import { genId, localDB } from './db';
import { measureAudioDuration } from './audio-utils';

// ---------------- 类型 ----------------

export type NotifySoundCategory = 'receive' | 'send' | 'moments' | 'qzone' | 'group';

/** 单类声音配置 */
export interface NotifySoundCategoryConfig {
  /** 分类开关（关 = 该类一律不响） */
  enabled: boolean;
  /** 铃声 id：'builtin:xxx' | 'custom:<ringtones 表 id>' */
  toneId: string;
  /** 分类音量 0~1（实际音量 = 总音量 × 分类音量） */
  volume: number;
  /** 分类免打扰 'HH:mm'；空串 = 未启用 */
  dndFrom: string;
  /** 分类免打扰结束 'HH:mm'；空串 = 未启用 */
  dndTo: string;
}

/** 声音与铃声全局设置（settings 表 'notifySound' 键；整机共享） */
export interface NotifySoundSettings {
  /** 总开关：false = 一键静音（所有分类不响，配置保留） */
  master: boolean;
  /** 总音量 0~1 */
  masterVolume: number;
  /** 响铃时是否震动（navigator.vibrate，不支持的环境自动忽略） */
  vibrate: boolean;
  /** 全局免打扰开始 'HH:mm'；空串 = 未启用 */
  dndFrom: string;
  /** 全局免打扰结束 'HH:mm'；空串 = 未启用 */
  dndTo: string;
  categories: Record<NotifySoundCategory, NotifySoundCategoryConfig>;
}

/** 自定义铃声元数据（blob 存 ringtones 表；列表页只读 meta） */
export interface RingtoneMeta {
  id: string;
  name: string;
  mime: string;
  /** 秒（元数据解析失败为 0，显示『—』） */
  duration: number;
  createdAt: number;
}

// ---------------- 内置铃声（Web Audio 合成，无音频文件） ----------------

export interface BuiltinToneMeta {
  id: string;
  name: string;
}

/** 内置铃声清单（顺序 = 设置页展示顺序；synth 见 BUILTIN_TONE_SYNTH） */
export const BUILTIN_NOTIFY_TONES: BuiltinToneMeta[] = [
  { id: 'builtin:note', name: '备注' },
  { id: 'builtin:chime', name: '清脆' },
  { id: 'builtin:ding', name: '叮' },
  { id: 'builtin:bell', name: '铃铛' },
  { id: 'builtin:marimba', name: '马林巴' },
  { id: 'builtin:bubble', name: '水泡' },
  { id: 'builtin:drop', name: '水滴' },
  { id: 'builtin:swoosh', name: '嗖' },
];

export function isBuiltinToneId(id: string): boolean {
  return BUILTIN_NOTIFY_TONES.some((t) => t.id === id);
}

/** 分类展示文案与默认铃声 */
export const NOTIFY_SOUND_CATEGORY_META: Record<
  NotifySoundCategory,
  { label: string; desc: string; defaultTone: string }
> = {
  receive: { label: '接收消息声音', desc: '别人给你发消息时', defaultTone: 'builtin:note' },
  send: { label: '发送消息声音', desc: '你发出消息时', defaultTone: 'builtin:swoosh' },
  moments: { label: '朋友圈互动声音', desc: '点赞、评论提醒', defaultTone: 'builtin:chime' },
  qzone: { label: 'QQ动态互动声音', desc: '赞和推、评论、转发', defaultTone: 'builtin:bell' },
  group: { label: '群消息声音', desc: '群聊新消息', defaultTone: 'builtin:ding' },
};

// ---------------- 默认设置 ----------------

function defaultCategory(key: NotifySoundCategory): NotifySoundCategoryConfig {
  return {
    enabled: true,
    toneId: NOTIFY_SOUND_CATEGORY_META[key].defaultTone,
    volume: 0.8,
    dndFrom: '',
    dndTo: '',
  };
}

export function defaultNotifySoundSettings(): NotifySoundSettings {
  return {
    master: true,
    masterVolume: 0.9,
    vibrate: true,
    dndFrom: '',
    dndTo: '',
    categories: {
      receive: defaultCategory('receive'),
      send: defaultCategory('send'),
      moments: defaultCategory('moments'),
      qzone: defaultCategory('qzone'),
      group: defaultCategory('group'),
    },
  };
}

/** IndexedDB 读出的旧值 → 完整设置（逐字段校验合并，脏数据回退默认） */
function mergeNotifySoundSettings(raw: unknown): NotifySoundSettings {
  const base = defaultNotifySoundSettings();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<NotifySoundSettings>;
  const num = (v: unknown, fb: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fb;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const out: NotifySoundSettings = {
    master: typeof r.master === 'boolean' ? r.master : base.master,
    masterVolume: num(r.masterVolume, base.masterVolume),
    vibrate: typeof r.vibrate === 'boolean' ? r.vibrate : base.vibrate,
    dndFrom: str(r.dndFrom),
    dndTo: str(r.dndTo),
    categories: { ...base.categories },
  };
  if (r.categories && typeof r.categories === 'object') {
    const rc = r.categories as Record<string, Partial<NotifySoundCategoryConfig>>;
    for (const key of Object.keys(base.categories) as NotifySoundCategory[]) {
      const c = rc[key];
      if (!c || typeof c !== 'object') continue;
      out.categories[key] = {
        enabled: typeof c.enabled === 'boolean' ? c.enabled : base.categories[key].enabled,
        toneId: typeof c.toneId === 'string' && c.toneId ? c.toneId : base.categories[key].toneId,
        volume: num(c.volume, base.categories[key].volume),
        dndFrom: str(c.dndFrom),
        dndTo: str(c.dndTo),
      };
    }
  }
  return out;
}

// ---------------- 设置 store（load 即时读库；update 即时写库生效） ----------------

const NOTIFY_SOUND_SETTINGS_KEY = 'notifySound';

interface NotifySoundState {
  settings: NotifySoundSettings;
  /** 首次 load 完成前 UI 显示默认值（播放闸门同口径，短暂窗口可忽略） */
  loaded: boolean;
  /** 我的铃声（新上传在前；上传/删除后 refreshRingtones） */
  ringtones: RingtoneMeta[];
  load: () => Promise<void>;
  refreshRingtones: () => Promise<void>;
  /** 更新全局字段（立即持久化生效） */
  update: (patch: Partial<Omit<NotifySoundSettings, 'categories'>>) => void;
  /** 更新某类配置（立即持久化生效） */
  updateCategory: (cat: NotifySoundCategory, patch: Partial<NotifySoundCategoryConfig>) => void;
}

async function persistNotifySound(settings: NotifySoundSettings): Promise<void> {
  try {
    await localDB.put('settings', { key: NOTIFY_SOUND_SETTINGS_KEY, value: settings });
  } catch {
    // 存储不可用：本次会话仍生效（内存 store）
  }
}

export const useNotifySound = create<NotifySoundState>((set, get) => ({
  settings: defaultNotifySoundSettings(),
  loaded: false,
  ringtones: [],

  load: async () => {
    try {
      const [rec, tones] = await Promise.all([
        localDB.get('settings', NOTIFY_SOUND_SETTINGS_KEY),
        listCustomRingtones(),
      ]);
      set({
        settings: mergeNotifySoundSettings(rec?.value),
        ringtones: tones,
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },

  refreshRingtones: async () => {
    try {
      set({ ringtones: await listCustomRingtones() });
    } catch {
      // 忽略
    }
  },

  update: (patch) => {
    const next: NotifySoundSettings = { ...get().settings, ...patch };
    set({ settings: next });
    void persistNotifySound(next);
  },

  updateCategory: (cat, patch) => {
    const cur = get().settings;
    const next: NotifySoundSettings = {
      ...cur,
      categories: { ...cur.categories, [cat]: { ...cur.categories[cat], ...patch } },
    };
    set({ settings: next });
    void persistNotifySound(next);
  },
}));

// 模块导入即异步预热（island-notify 首条消息到达前设置必已就绪；失败保持默认值）
if (typeof window !== 'undefined') {
  void useNotifySound.getState().load();
}

// ---------------- 自定义铃声 CRUD（ringtones 表，永久保存） ----------------

/** 上传大小上限（提示音场景 8MB 足够，防超大音频占满配额） */
export const RINGTONE_MAX_BYTES = 8 * 1024 * 1024;

/** 我的铃声列表（新上传在前） */
export async function listCustomRingtones(): Promise<RingtoneMeta[]> {
  const all = await localDB.getAll('ringtones');
  return all
    .map(({ blob: _blob, ...meta }) => meta)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 上传自定义铃声（File → 校验 → 时长探测 → ringtones 表永久保存）。
 * 失败抛 Error（中文文案直接可展示）。
 */
export async function addCustomRingtone(file: File): Promise<RingtoneMeta> {
  const looksAudio = file.type.startsWith('audio/') || /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i.test(file.name);
  if (!looksAudio) throw new Error('仅支持音频文件（mp3 / m4a / wav / ogg 等）');
  if (file.size > RINGTONE_MAX_BYTES) throw new Error('音频文件不能超过 8MB');
  if (file.size === 0) throw new Error('文件为空');
  const type = file.type || 'audio/mpeg';
  const blob = file.slice(0, file.size, type);
  const url = URL.createObjectURL(blob);
  try {
    const duration = await measureAudioDuration(url, 0);
    const name = (file.name.replace(/\.[^.]+$/, '').trim() || '自定义铃声').slice(0, 40);
    const meta: RingtoneMeta = {
      id: genId(),
      name,
      mime: type,
      duration: Math.max(0, Math.round(duration * 10) / 10),
      createdAt: Date.now(),
    };
    await localDB.put('ringtones', { ...meta, blob });
    await useNotifySound.getState().refreshRingtones();
    return meta;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 删除自定义铃声；正在使用的分类自动回落默认内置铃声 */
export async function deleteCustomRingtone(id: string): Promise<void> {
  stopTonePreview();
  await localDB.delete('ringtones', id);
  const cached = customUrlCache.get(id);
  if (cached) {
    URL.revokeObjectURL(cached);
    customUrlCache.delete(id);
  }
  const st = useNotifySound.getState();
  const cats = { ...st.settings.categories };
  let changed = false;
  for (const key of Object.keys(cats) as NotifySoundCategory[]) {
    if (cats[key].toneId === `custom:${id}`) {
      cats[key] = { ...cats[key], toneId: NOTIFY_SOUND_CATEGORY_META[key].defaultTone };
      changed = true;
    }
  }
  if (changed) {
    const next = { ...st.settings, categories: cats };
    useNotifySound.setState({ settings: next });
    void persistNotifySound(next);
  }
  await st.refreshRingtones();
}

/** 铃声显示名（找不到记录 = 已删，回落文案） */
export function toneDisplayName(toneId: string, ringtones: RingtoneMeta[]): string {
  if (toneId.startsWith('custom:')) {
    const r = ringtones.find((x) => x.id === toneId.slice(7));
    return r ? r.name : '默认铃声';
  }
  return BUILTIN_NOTIFY_TONES.find((t) => t.id === toneId)?.name ?? '默认铃声';
}

// ---------------- 播放（内置合成 + 自定义 Audio 元素） ----------------

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** 共享 AudioContext（懒建；被浏览器挂起时尝试 resume） */
let sharedCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  const Ctx = window.AudioContext ?? w.webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedCtx) {
    try {
      sharedCtx = new Ctx();
    } catch {
      return null;
    }
  }
  if (sharedCtx.state === 'suspended') {
    void sharedCtx.resume().catch(() => undefined);
  }
  return sharedCtx;
}

/** 单音音符：attack→指数衰减（振荡器 + 包络） */
function toneBlip(
  ctx: AudioContext,
  dest: AudioNode,
  t0: number,
  freq: number,
  dur: number,
  opts?: { type?: OscillatorType; peak?: number; glideTo?: number; glideTime?: number },
): void {
  const { type = 'sine', peak = 0.4, glideTo, glideTime } = opts ?? {};
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), t0);
  if (glideTo && glideTime) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t0 + glideTime);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** 白噪声 + 带通扫频（「嗖」） */
function noiseSweep(
  ctx: AudioContext,
  dest: AudioNode,
  t0: number,
  dur: number,
  from: number,
  mid: number,
): void {
  const len = Math.max(1, Math.ceil(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(from, t0);
  bp.frequency.exponentialRampToValueAtTime(mid, t0 + dur * 0.55);
  bp.frequency.exponentialRampToValueAtTime(Math.max(60, from * 0.7), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.5, t0 + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(t0);
  src.stop(t0 + dur + 0.03);
}

interface BuiltinToneDef {
  /** 合成函数（t0 起播） */
  synth: (ctx: AudioContext, dest: AudioNode, t0: number) => void;
  /** 名义时长（秒），用于延迟断开 */
  duration: number;
}

/** 内置铃声合成定义（与 BUILTIN_NOTIFY_TONES 一一对应） */
const BUILTIN_TONE_SYNTH: Record<string, BuiltinToneDef> = {
  // 「备注」：E6→C6 两音下落（接收默认，类 iOS 清脆双音）
  'builtin:note': {
    duration: 0.55,
    synth: (ctx, dest, t0) => {
      toneBlip(ctx, dest, t0, 1318.5, 0.16, { peak: 0.34 });
      toneBlip(ctx, dest, t0 + 0.12, 1046.5, 0.34, { peak: 0.3 });
      toneBlip(ctx, dest, t0 + 0.12, 2093, 0.18, { peak: 0.07 });
    },
  },
  // 「清脆」：C 大调琶音上行 C6-E6-G6-C7
  'builtin:chime': {
    duration: 0.8,
    synth: (ctx, dest, t0) => {
      const seq: Array<[number, number]> = [
        [1046.5, 0], [1318.5, 0.09], [1568, 0.18], [2093, 0.27],
      ];
      for (const [f, dt] of seq) toneBlip(ctx, dest, t0 + dt, f, 0.4, { peak: 0.26 });
    },
  },
  // 「叮」：单音 E6 + 倍频泛音
  'builtin:ding': {
    duration: 0.5,
    synth: (ctx, dest, t0) => {
      toneBlip(ctx, dest, t0, 1318.5, 0.42, { peak: 0.34 });
      toneBlip(ctx, dest, t0, 2637, 0.2, { peak: 0.08 });
    },
  },
  // 「铃铛」：A5 基音 + 两个非谐泛音，长衰减
  'builtin:bell': {
    duration: 1.1,
    synth: (ctx, dest, t0) => {
      toneBlip(ctx, dest, t0, 880, 0.95, { peak: 0.3 });
      toneBlip(ctx, dest, t0, 1318.5, 0.7, { peak: 0.16 });
      toneBlip(ctx, dest, t0 + 0.01, 2093, 0.4, { peak: 0.07 });
    },
  },
  // 「马林巴」：三角波双击
  'builtin:marimba': {
    duration: 0.5,
    synth: (ctx, dest, t0) => {
      toneBlip(ctx, dest, t0, 880, 0.18, { type: 'triangle', peak: 0.4 });
      toneBlip(ctx, dest, t0 + 0.14, 660, 0.26, { type: 'triangle', peak: 0.34 });
    },
  },
  // 「水泡」：上滑短音两颗
  'builtin:bubble': {
    duration: 0.34,
    synth: (ctx, dest, t0) => {
      toneBlip(ctx, dest, t0, 320, 0.13, { peak: 0.4, glideTo: 900, glideTime: 0.11 });
      toneBlip(ctx, dest, t0 + 0.16, 420, 0.15, { peak: 0.34, glideTo: 1100, glideTime: 0.13 });
    },
  },
  // 「水滴」：下滑长音（滴水声）
  'builtin:drop': {
    duration: 0.45,
    synth: (ctx, dest, t0) => {
      toneBlip(ctx, dest, t0, 1250, 0.28, { peak: 0.36, glideTo: 380, glideTime: 0.24 });
      toneBlip(ctx, dest, t0 + 0.2, 1400, 0.2, { peak: 0.1, glideTo: 500, glideTime: 0.18 });
    },
  },
  // 「嗖」：噪声带通扫频（发送默认）
  'builtin:swoosh': {
    duration: 0.42,
    synth: (ctx, dest, t0) => {
      noiseSweep(ctx, dest, t0, 0.4, 500, 2600);
    },
  },
};

/** 播放内置铃声（音量 0~1；上下文不可用静默跳过） */
function playBuiltinTone(toneId: string, volume: number): void {
  const def = BUILTIN_TONE_SYNTH[toneId];
  if (!def) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const gain = ctx.createGain();
  gain.gain.value = clamp01(volume);
  gain.connect(ctx.destination);
  try {
    def.synth(ctx, gain, ctx.currentTime + 0.02);
  } catch {
    // 合成失败静默
  }
  // 播完后断开，释放节点
  window.setTimeout(() => {
    try {
      gain.disconnect();
    } catch {
      // 忽略
    }
  }, (def.duration + 0.8) * 1000);
}

// ---------------- 自定义铃声播放（HTMLAudioElement） ----------------

// ObjectURL LRU（性能：每条自定义铃声 Blob ≤8MB，原先只增不减——播放过的铃声全部
// 常驻内存直到删除铃声；改为上限 6 条，超出淘汰最旧并 revoke 释放 Blob）
const customUrlCache = new Map<string, string>();
const CUSTOM_URL_CACHE_MAX = 6;

async function customRingtoneUrlCached(id: string): Promise<string | null> {
  const cached = customUrlCache.get(id);
  if (cached) {
    // 命中刷新 LRU 位置（Map 迭代序 = 插入序，删了重插即移到最新）
    customUrlCache.delete(id);
    customUrlCache.set(id, cached);
    return cached;
  }
  return null;
}

function customRingtoneUrlStore(id: string, url: string): void {
  if (customUrlCache.size >= CUSTOM_URL_CACHE_MAX) {
    const oldest = customUrlCache.keys().next().value as string | undefined;
    if (oldest != null) {
      const oldUrl = customUrlCache.get(oldest);
      customUrlCache.delete(oldest);
      if (oldUrl) {
        try {
          URL.revokeObjectURL(oldUrl);
        } catch {
          // 忽略
        }
      }
    }
  }
  customUrlCache.set(id, url);
}

/** 自定义铃声 Blob → ObjectURL（按 id LRU 缓存；记录不存在返回 null） */
export async function customRingtoneUrl(id: string): Promise<string | null> {
  const hit = await customRingtoneUrlCached(id);
  if (hit) return hit;
  try {
    const rec = await localDB.get('ringtones', id);
    if (!rec || !(rec.blob instanceof Blob)) return null;
    const url = URL.createObjectURL(rec.blob);
    customRingtoneUrlStore(id, url);
    return url;
  } catch {
    return null;
  }
}

/** 当前试听/提示音的 Audio 元素（新播停旧，防叠音） */
let activeAudio: HTMLAudioElement | null = null;

export function stopTonePreview(): void {
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.src = '';
    } catch {
      // 忽略
    }
    activeAudio = null;
  }
}

/**
 * 播放任意铃声（预览/提示音共用链路；volume 0~1）。
 * custom 记录缺失 → 自动回落 builtin:note，永不无声失败。
 */
export async function playTone(toneId: string, volume: number): Promise<void> {
  const vol = clamp01(volume);
  if (vol <= 0.001) return;
  stopTonePreview();
  if (toneId.startsWith('custom:')) {
    const url = await customRingtoneUrl(toneId.slice(7));
    if (!url) {
      playBuiltinTone('builtin:note', vol);
      return;
    }
    try {
      const a = new Audio(url);
      a.volume = vol;
      activeAudio = a;
      a.onended = () => {
        if (activeAudio === a) activeAudio = null;
      };
      await a.play();
    } catch {
      // 播放失败（自动播放策略等）静默
    }
    return;
  }
  playBuiltinTone(isBuiltinToneId(toneId) ? toneId : 'builtin:note', vol);
}

// ---------------- 免打扰时段 ----------------

/**
 * 是否处于免打扰时段（支持跨夜如 22:00–08:00；from/to 任一为空 = 未启用；
 * 起=止视为未配置；now 缺省取当前时间）。
 */
export function inDndWindow(from: string, to: string, now?: Date): boolean {
  if (!from || !to) return false;
  const parse = (s: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
    return h * 60 + min;
  };
  const start = parse(from);
  const end = parse(to);
  if (start === null || end === null || start === end) return false;
  const d = now ?? new Date();
  const cur = d.getHours() * 60 + d.getMinutes();
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

// ---------------- 提示音触发入口 ----------------

/** B1：系统免打扰时段（设置›通知的全局 DND）当前是否生效——AI 主动行为闸（主动来电/自主消息）用：
 *  用户配置「22:00-08:00 免打扰」后，AI 不得在该时段主动来电/自主发消息打扰（用户明确配置的定时/事件/提醒照发） */
export function isDndWindowActive(now?: Date): boolean {
  try {
    const st = useNotifySound.getState().settings;
    return inDndWindow(st.dndFrom, st.dndTo, now);
  } catch {
    return false;
  }
}

/** 该类当前是否静音（总开关 / 分类开关 / 全局免打扰 / 分类免打扰 任一命中 = 静音） */
export function isNotifySoundSilent(cat: NotifySoundCategory, now?: Date): boolean {
  const s = useNotifySound.getState().settings;
  if (!s.master) return true;
  const c = s.categories[cat];
  if (!c.enabled) return true;
  if (inDndWindow(s.dndFrom, s.dndTo, now)) return true;
  if (inDndWindow(c.dndFrom, c.dndTo, now)) return true;
  return false;
}

/** 响铃震动样式：接收类两短一停，其余轻振一下（不支持震动的环境自动忽略） */
function vibrateFor(cat: NotifySoundCategory): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    if (cat === 'receive' || cat === 'group') navigator.vibrate([16, 70, 16]);
    else navigator.vibrate(12);
  } catch {
    // 忽略
  }
}

/**
 * 触发一类提示音（消息流挂点调用；同步返回，内部异步播完即止）：
 * - 任一闸门静音 → 直接返回（不响但通知照常弹、记录照常落）；
 * - 自定义铃声已被删除 → 回落该类默认内置铃声；
 * - 音量 = 总音量 × 分类音量；开启震动时附轻震。
 */
export function playNotifySound(cat: NotifySoundCategory): void {
  try {
    if (isNotifySoundSilent(cat)) return;
    const s = useNotifySound.getState().settings;
    const c = s.categories[cat];
    const vol = clamp01(s.masterVolume * c.volume);
    if (vol <= 0.001) return;
    let toneId = c.toneId;
    if (toneId.startsWith('custom:')) {
      const known = useNotifySound.getState().ringtones.some((r) => r.id === toneId.slice(7));
      if (!known) toneId = NOTIFY_SOUND_CATEGORY_META[cat].defaultTone;
    }
    void playTone(toneId, vol);
    if (s.vibrate) vibrateFor(cat);
  } catch {
    // 提示音绝不影响消息主流程
  }
}
