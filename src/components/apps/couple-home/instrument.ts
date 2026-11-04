'use client';

/**
 * 情侣小家 —— 网页音频合成（零素材，纯 Web Audio）
 *
 * - 吉他拨弦：Karplus-Strong 物理建模（噪声激励 → 延迟环低通衰减），
 *   按「音色+频率」预生成一次 AudioBuffer 缓存复用，音色接近真实木吉他；
 * - 钢琴：基频 + 2/3/4 次谐波叠加（高次谐波衰减更快）+ 快起音长衰减包络；
 * - 音色：钢琴（grand 大钢琴 / ep 电钢 / musicbox 八音盒）、吉他（acoustic 木吉他 / ukulele 尤克里里）；
 * - 音符事件总线（onNote/emitNote）：供 3D 小人手势同步、琴键弦位灯光；
 * - AudioContext 懒创建 + 用户手势时 resume（iOS Safari 兼容）。
 */

let ctx: AudioContext | null = null;

/** 获取（并唤醒）全局 AudioContext；需要在用户手势事件里首次调用 */
export function ensureAudio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

// ---------------- 吉他 ----------------

/** 六弦标准调弦：E2 A2 D3 G3 B3 E4（低音弦在左，与抱着看琴面一致） */
export const GUITAR_STRINGS: { name: string; freq: number; wound: boolean }[] = [
  { name: 'E', freq: 82.41, wound: true },
  { name: 'A', freq: 110.0, wound: true },
  { name: 'D', freq: 146.83, wound: true },
  { name: 'G', freq: 196.0, wound: false },
  { name: 'B', freq: 246.94, wound: false },
  { name: 'e', freq: 329.63, wound: false },
];

/** 吉他音色：acoustic 木吉他 / ukulele 尤克里里（更亮更短促） */
export type GuitarTimbre = 'acoustic' | 'ukulele';

/** 各音色的 Karplus-Strong 参数 */
const PLUCK_PRESET: Record<GuitarTimbre, { damp: number; seconds: number; gain: number }> = {
  acoustic: { damp: 0.996, seconds: 2.6, gain: 0.42 },
  ukulele: { damp: 0.992, seconds: 1.4, gain: 0.4 },
};

/** 已生成的拨弦音色缓存（音色+频率 相同不重复合成） */
const pluckCache = new Map<string, AudioBuffer>();

/**
 * Karplus-Strong 拨弦：环长 = 采样率/频率，环内初始填噪声，
 * 之后每样点 = damp × (前环两样点均值)，木吉他 2.6 秒 / 尤克里里 1.4 秒自然衰减到静音。
 */
export function pluckString(freq: number, vol = 1, timbre: GuitarTimbre = 'acoustic'): void {
  const ac = ensureAudio();
  if (!ac) return;
  const preset = PLUCK_PRESET[timbre] ?? PLUCK_PRESET.acoustic;
  const key = `${timbre}:${Math.round(freq * 10)}`;
  let buf = pluckCache.get(key);
  if (!buf) {
    const sr = ac.sampleRate;
    const n = Math.max(2, Math.round(sr / freq));
    const len = Math.floor(sr * preset.seconds);
    const data = new Float32Array(len);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    for (let i = n; i < len; i++) data[i] = preset.damp * 0.5 * (data[i - n] + data[i - n + 1]);
    // 轻微淡入避免咔哒声
    const fade = Math.min(n, 64);
    for (let i = 0; i < fade; i++) data[i] *= i / fade;
    buf = ac.createBuffer(1, len, sr);
    buf.copyToChannel(data, 0);
    pluckCache.set(key, buf);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = preset.gain * vol;
  src.connect(g);
  g.connect(ac.destination);
  src.start();
}

// ---------------- 吉他和弦 ----------------

export interface GuitarChord {
  id: string;
  name: string;
  /** 每弦半音偏移（低 E → 高 e，顺序同 GUITAR_STRINGS）；null = 该弦闷住不发声 */
  offsets: (number | null)[];
  /** 和弦按键的粉彩底色 */
  tint: string;
}

/** 常用开放和弦（标准指法半音偏移） */
export const GUITAR_CHORDS: GuitarChord[] = [
  { id: 'C', name: 'C', offsets: [null, 3, 2, 0, 1, 0], tint: '#7fb8a4' },
  { id: 'G', name: 'G', offsets: [3, 2, 0, 0, 0, 3], tint: '#e8a87c' },
  { id: 'Am', name: 'Am', offsets: [null, 0, 2, 2, 1, 0], tint: '#a48bc2' },
  { id: 'F', name: 'F', offsets: [1, 3, 3, 2, 1, 1], tint: '#6f9fd8' },
  { id: 'Em', name: 'Em', offsets: [0, 2, 2, 0, 0, 0], tint: '#d88a9c' },
];

/** 按弦音高：openFreq × 2^(semi/12)；semi 为 null（闷弦）时返回开放弦音高，出不出声由调用方决定 */
export function chordStringFreq(openFreq: number, semi: number | null): number {
  if (semi == null) return openFreq;
  return openFreq * Math.pow(2, semi / 12);
}

// ---------------- 钢琴 ----------------

/** 三个完整八度白键（C3 → C6，22 键）；label 只标每个八度的 C（C3/C4/C5/C6） */
export const PIANO_WHITE: { name: string; freq: number; label?: boolean }[] = [
  { name: 'C3', freq: 130.81, label: true },
  { name: 'D3', freq: 146.83 },
  { name: 'E3', freq: 164.81 },
  { name: 'F3', freq: 174.61 },
  { name: 'G3', freq: 196.0 },
  { name: 'A3', freq: 220.0 },
  { name: 'B3', freq: 246.94 },
  { name: 'C4', freq: 261.63, label: true },
  { name: 'D4', freq: 293.66 },
  { name: 'E4', freq: 329.63 },
  { name: 'F4', freq: 349.23 },
  { name: 'G4', freq: 392.0 },
  { name: 'A4', freq: 440.0 },
  { name: 'B4', freq: 493.88 },
  { name: 'C5', freq: 523.25, label: true },
  { name: 'D5', freq: 587.33 },
  { name: 'E5', freq: 659.25 },
  { name: 'F5', freq: 698.46 },
  { name: 'G5', freq: 783.99 },
  { name: 'A5', freq: 880.0 },
  { name: 'B5', freq: 987.77 },
  { name: 'C6', freq: 1046.5, label: true },
];

/** 黑键：after = 夹在第几个白键之后（0 起）；每组八度按真实钢琴 2+3 排布（C♯D♯｜F♯G♯A♯） */
export const PIANO_BLACK: { after: number; name: string; freq: number }[] = [
  { after: 0, name: 'C#3', freq: 138.59 },
  { after: 1, name: 'D#3', freq: 155.56 },
  { after: 3, name: 'F#3', freq: 185.0 },
  { after: 4, name: 'G#3', freq: 207.65 },
  { after: 5, name: 'A#3', freq: 233.08 },
  { after: 7, name: 'C#4', freq: 277.18 },
  { after: 8, name: 'D#4', freq: 311.13 },
  { after: 10, name: 'F#4', freq: 369.99 },
  { after: 11, name: 'G#4', freq: 415.3 },
  { after: 12, name: 'A#4', freq: 466.16 },
  { after: 14, name: 'C#5', freq: 554.37 },
  { after: 15, name: 'D#5', freq: 622.25 },
  { after: 17, name: 'F#5', freq: 739.99 },
  { after: 18, name: 'G#5', freq: 830.61 },
  { after: 19, name: 'A#5', freq: 932.33 },
];

/** 钢琴音色：grand 大钢琴（默认）/ ep 电钢 / musicbox 八音盒 */
export type PianoTimbre = 'grand' | 'ep' | 'musicbox';

/**
 * 钢琴音：谐波叠加 + 指数衰减（每音独立节点，播完自动回收）。
 * - grand：三角波基频 + 2/3/4 次谐波（原有音色，默认参数不变）；
 * - ep：纯正弦基频 + 柔和 2 倍频 + 约 8ms「音簧」敲击瞬态，衰减稍快、音量更暖；
 * - musicbox：钟铃质感 —— 基频 + 非谐波分音（×3.98 / ×9.2）+ +3 音分微失谐闪光，长余音、整体更轻。
 */
export function pianoNote(freq: number, vol = 1, timbre: PianoTimbre = 'grand'): void {
  const ac = ensureAudio();
  if (!ac) return;
  const t0 = ac.currentTime;

  if (timbre === 'ep') {
    const master = ac.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.34 * vol, t0 + 0.01);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.45);
    master.connect(ac.destination);
    const partials: [number, number][] = [
      [1, 1],
      [2, 0.24],
      [4, 0.05],
    ];
    for (const [mult, amp] of partials) {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      const og = ac.createGain();
      og.gain.setValueAtTime(amp, t0);
      og.gain.exponentialRampToValueAtTime(Math.max(0.0001, amp * 0.08), t0 + 0.9);
      osc.connect(og);
      og.connect(master);
      osc.start(t0);
      osc.stop(t0 + 1.6);
    }
    // tine 敲击瞬态：约 8ms 的高频正弦短促「叮」
    const tine = ac.createOscillator();
    tine.type = 'sine';
    tine.frequency.value = Math.min(6200, freq * 6 + 1200);
    const tg = ac.createGain();
    tg.gain.setValueAtTime(0.08 * vol, t0);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.008);
    tine.connect(tg);
    tg.connect(ac.destination);
    tine.start(t0);
    tine.stop(t0 + 0.02);
    return;
  }

  if (timbre === 'musicbox') {
    const master = ac.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.25 * vol, t0 + 0.005);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.8);
    master.connect(ac.destination);
    // [倍率, 起始幅度, 各自分音衰减到 10% 的秒数] —— 非谐波分音先收，基频长余音
    const partials: [number, number, number][] = [
      [1, 1, 2.4],
      [3.98, 0.16, 0.9],
      [9.2, 0.045, 0.35],
    ];
    for (const [mult, amp, decay] of partials) {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      const og = ac.createGain();
      og.gain.setValueAtTime(amp, t0);
      og.gain.exponentialRampToValueAtTime(Math.max(0.0001, amp * 0.1), t0 + decay);
      osc.connect(og);
      og.connect(master);
      osc.start(t0);
      osc.stop(t0 + 2.9);
    }
    // 微失谐（+3 音分）第二正弦，制造细碎闪光感
    const sparkle = ac.createOscillator();
    sparkle.type = 'sine';
    sparkle.frequency.value = freq * Math.pow(2, 3 / 1200);
    const sg = ac.createGain();
    sg.gain.setValueAtTime(0.3, t0);
    sg.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
    sparkle.connect(sg);
    sg.connect(master);
    sparkle.start(t0);
    sparkle.stop(t0 + 2.4);
    return;
  }

  // grand：三角波基频 + 2/3/4 次谐波
  const master = ac.createGain();
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(0.5 * vol, t0 + 0.012);
  master.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.9);
  master.connect(ac.destination);
  const partials: [number, number, OscillatorType][] = [
    [1, 1, 'triangle'],
    [2, 0.4, 'sine'],
    [3, 0.17, 'sine'],
    [4.01, 0.07, 'sine'],
  ];
  for (const [mult, amp, type] of partials) {
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.value = freq * mult;
    const og = ac.createGain();
    og.gain.setValueAtTime(amp, t0);
    // 高次谐波衰减更快（更像琴槌敲弦后的自然泛音收尾）
    og.gain.exponentialRampToValueAtTime(Math.max(0.0001, amp * 0.1), t0 + 1.0);
    osc.connect(og);
    og.connect(master);
    osc.start(t0);
    osc.stop(t0 + 2.0);
  }
}

// ---------------- 《小星星》演示曲（钢琴） ----------------

/** 小星星旋律（与 PIANO_WHITE/PIANO_BLACK 音名对应）；beats：1 = 四分音符，2 = 乐句末二分音符 */
export const TWINKLE: { name: string; beats: number }[] = [
  { name: 'C4', beats: 1 },
  { name: 'C4', beats: 1 },
  { name: 'G4', beats: 1 },
  { name: 'G4', beats: 1 },
  { name: 'A4', beats: 1 },
  { name: 'A4', beats: 1 },
  { name: 'G4', beats: 2 },
  { name: 'F4', beats: 1 },
  { name: 'F4', beats: 1 },
  { name: 'E4', beats: 1 },
  { name: 'E4', beats: 1 },
  { name: 'D4', beats: 1 },
  { name: 'D4', beats: 1 },
  { name: 'C4', beats: 2 },
  { name: 'G4', beats: 1 },
  { name: 'G4', beats: 1 },
  { name: 'F4', beats: 1 },
  { name: 'F4', beats: 1 },
  { name: 'E4', beats: 1 },
  { name: 'E4', beats: 1 },
  { name: 'D4', beats: 2 },
  { name: 'G4', beats: 1 },
  { name: 'G4', beats: 1 },
  { name: 'F4', beats: 1 },
  { name: 'F4', beats: 1 },
  { name: 'E4', beats: 1 },
  { name: 'E4', beats: 1 },
  { name: 'D4', beats: 2 },
  { name: 'C4', beats: 1 },
  { name: 'C4', beats: 1 },
  { name: 'G4', beats: 1 },
  { name: 'G4', beats: 1 },
  { name: 'A4', beats: 1 },
  { name: 'A4', beats: 1 },
  { name: 'G4', beats: 2 },
  { name: 'F4', beats: 1 },
  { name: 'F4', beats: 1 },
  { name: 'E4', beats: 1 },
  { name: 'E4', beats: 1 },
  { name: 'D4', beats: 1 },
  { name: 'D4', beats: 1 },
  { name: 'C4', beats: 2 },
];

/** 小星星每拍毫秒数（四分音符时值） */
export const twinkleTempoMs = 420;

// ---------------- 音符事件总线（3D 小人手势同步 / 琴键弦位灯光） ----------------

export interface NoteEvent {
  kind: 'piano' | 'guitar';
  freq: number;
  name: string;
}

type NoteCb = (e: NoteEvent) => void;
const noteSubs = new Set<NoteCb>();

/** 订阅音符事件（弹奏、演示曲、回放都会广播）；返回退订函数 */
export function onNote(cb: NoteCb): () => void {
  noteSubs.add(cb);
  return () => {
    noteSubs.delete(cb);
  };
}

/**
 * 广播一个音符事件：通知全部订阅者。
 * 第二参数为兼容旧调用方的保留签名（旧代码会传 { record?: boolean } 控制录音带），
 * 录音功能已移除，参数仅忽略不再使用。
 */
export function emitNote(e: NoteEvent, opts?: { record?: boolean }): void {
  void opts;
  noteSubs.forEach((cb) => {
    try {
      cb(e);
    } catch {
      // 单个订阅者异常不影响其他订阅者
    }
  });
}

/** 音名显示（黑键用 ♯ 更可爱） */
export function prettyNote(name: string): string {
  return name.replace('#', '♯');
}
