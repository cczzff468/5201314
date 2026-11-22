/**
 * 拾光小屋 · 交互音效（E3）—— WebAudio 纯合成、零资产
 *
 * - 惰性 AudioContext：首次出声才创建；被浏览器自动挂起时自动 resume；
 * - 模块级单例：全屋共用一个 context + master gain（≈0.14，轻响不吵）；
 * - 开关持久化：localStorage key `ch-home-sfx`（'1'/'0'），缺省开；
 * - 每个音效函数都先查开关再出声，调用方无需重复判断。
 */

const STORE_KEY = 'ch-home-sfx';
/** 主音量（全部音效共用 master gain，控制在「轻响」级别） */
const MASTER_GAIN = 0.14;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = loadEnabled();

/** 读持久化开关（localStorage 不可用 / 隐私模式 → 缺省开） */
function loadEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

/** 惰性获取 AudioContext + master gain（首次调用才创建；suspended 时 resume） */
function getAudioContext(): { ctx: AudioContext; master: GainNode } | null {
  try {
    if (!ctx || !master) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return { ctx, master };
  } catch {
    return null; // 音频不可用（老设备/无 AudioContext）静默降级
  }
}

/** 写持久化开关（即时生效，不销毁 context；关掉时连环境音一起停） */
function setEnabled(on: boolean): void {
  enabled = on;
  if (!on) stopAmbientNow(); // 总开关关闭：环境白噪音一并全停
  try {
    localStorage.setItem(STORE_KEY, on ? '1' : '0');
  } catch {
    /* 写不进就算了（隐私模式），会话内仍生效 */
  }
}

function isEnabled(): boolean {
  return enabled;
}

/** 短促软 click（sine 880→660 快速滑落 0.05s）——家具点按 */
function playTap(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(660, t + 0.05);
  g.gain.setValueAtTime(1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.06);
}

/** 可爱 pop（triangle 320→520 上滑 0.09s + 轻微 thud）——放置/购买 */
function playPlace(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(320, t);
  osc.frequency.exponentialRampToValueAtTime(520, t + 0.09);
  g.gain.setValueAtTime(1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.12);
  // 轻微 thud：低频短音收尾，像东西稳稳落地
  const thud = c.createOscillator();
  const tg = c.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(150, t + 0.02);
  thud.frequency.exponentialRampToValueAtTime(90, t + 0.1);
  tg.gain.setValueAtTime(0.5, t + 0.02);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  thud.connect(tg).connect(out);
  thud.start(t + 0.02);
  thud.stop(t + 0.13);
}

/** 收起 swoosh（filtered noise 短扫 0.18s 下滑）——收起家具 */
function playRemove(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const dur = 0.18;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(2600, t);
  filter.frequency.exponentialRampToValueAtTime(500, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** 门轴轻响（低频 sine 140Hz 短震 0.12s + 高频轻 tick）——门窗开合 */
function playDoor(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.linearRampToValueAtTime(128, t + 0.12);
  g.gain.setValueAtTime(0.55, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.13);
  // 短震：26Hz LFO 轻轻抖动门轴嗡鸣
  const lfo = c.createOscillator();
  const lfoG = c.createGain();
  lfo.frequency.value = 26;
  lfoG.gain.value = 0.22;
  lfo.connect(lfoG).connect(g.gain);
  lfo.start(t);
  lfo.stop(t + 0.13);
  // 高频轻 tick：门闩到位的一声
  const tick = c.createOscillator();
  const tg = c.createGain();
  tick.type = 'triangle';
  tick.frequency.setValueAtTime(2100, t + 0.1);
  tg.gain.setValueAtTime(0.35, t + 0.1);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  tick.connect(tg).connect(out);
  tick.start(t + 0.1);
  tick.stop(t + 0.17);
}

/** 脚步（极短噪声 tick 0.04s，低通 900Hz，音量更低）——小人走路 */
function playStep(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const dur = 0.04;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  const g = c.createGain();
  g.gain.setValueAtTime(0.55, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.01);
}

// ---------------- v7.1 宠物互动萌系音效（纯合成，同「轻响不吵」基调） ----------------

/** 复用噪声段工具：生成 dur 秒白噪声 buffer */
function noiseBuf(c: AudioContext, dur: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  return buf;
}

/** 呼噜声（摸头/进窝）：低频喉音 62Hz，24Hz LFO 振幅颤动 1.1s —— 猫咪咕噜咕噜 */
function playPurr(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const dur = 1.1;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(62, t);
  osc.frequency.linearRampToValueAtTime(55, t + dur);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 260;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.09);
  g.gain.setValueAtTime(0.5, t + dur - 0.14);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  // 24Hz 颤动：喉腔一震一震的咕噜感
  const lfo = c.createOscillator();
  lfo.frequency.value = 24;
  const lfoG = c.createGain();
  lfoG.gain.value = 0.3;
  lfo.connect(lfoG).connect(g.gain);
  osc.connect(lp).connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  lfo.start(t);
  lfo.stop(t + dur + 0.02);
}

/** 咔嚓声（吃猫粮）：两次极短高频噪声脆响（0.05s + 0.045s） */
function playCrunch(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  for (const [dt0, d] of [
    [0, 0.05],
    [0.085, 0.045],
  ] as [number, number][]) {
    const src = c.createBufferSource();
    src.buffer = noiseBuf(c, d);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1900;
    const g = c.createGain();
    g.gain.setValueAtTime(0.65, t + dt0);
    g.gain.exponentialRampToValueAtTime(0.001, t + dt0 + d);
    src.connect(hp).connect(g).connect(out);
    src.start(t + dt0);
    src.stop(t + dt0 + d + 0.01);
  }
}

/** 咕咚声（喝水）：两声短促下滑水泡音 */
function playSip(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  for (const dt0 of [0, 0.14]) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, t + dt0);
    osc.frequency.exponentialRampToValueAtTime(170, t + dt0 + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0.6, t + dt0);
    g.gain.exponentialRampToValueAtTime(0.001, t + dt0 + 0.1);
    osc.connect(g).connect(out);
    osc.start(t + dt0);
    osc.stop(t + dt0 + 0.11);
  }
}

/** 洗澡水声：2.2s 白噪声带通（900→1500Hz 波动）+ 音量起伏 —— 流水哗哗 */
function playBathWater(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const dur = 2.2;
  const src = c.createBufferSource();
  src.buffer = noiseBuf(c, dur);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(900, t);
  bp.frequency.linearRampToValueAtTime(1500, t + dur * 0.5);
  bp.frequency.linearRampToValueAtTime(1000, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.34, t + 0.25);
  g.gain.linearRampToValueAtTime(0.22, t + dur * 0.6);
  g.gain.linearRampToValueAtTime(0.3, t + dur * 0.8);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** 咂嘴声（抱抱）："mua~" 快速上滑再回落的圆润短音 */
function playKiss(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(340, t);
  osc.frequency.exponentialRampToValueAtTime(880, t + 0.05);
  osc.frequency.exponentialRampToValueAtTime(420, t + 0.13);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.7, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.16);
}

/** 召唤哨声：清亮两连上滑（950→1900Hz 短哨 + 1300→2100Hz 更高短哨） */
function playWhistle(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  for (const [dt0, f0, f1, d] of [
    [0, 950, 1900, 0.14],
    [0.17, 1300, 2100, 0.18],
  ] as [number, number, number, number][]) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t + dt0);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dt0 + d);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t + dt0);
    g.gain.exponentialRampToValueAtTime(0.4, t + dt0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dt0 + d + 0.04);
    osc.connect(g).connect(out);
    osc.start(t + dt0);
    osc.stop(t + dt0 + d + 0.05);
  }
}

/** 喵叫（到位反应）：短喵「miao」620→900→480Hz 滑音 + 轻微颤音 */
function playMeow(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const dur = 0.38;
  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(620, t);
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.09);
  osc.frequency.exponentialRampToValueAtTime(480, t + dur);
  const vib = c.createOscillator();
  vib.frequency.value = 13;
  const vibG = c.createGain();
  vibG.gain.value = 14;
  vib.connect(vibG).connect(osc.frequency);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
  g.gain.setValueAtTime(0.5, t + dur - 0.1);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  vib.start(t);
  vib.stop(t + dur + 0.02);
}

/** v8.3 扔球嗖（带通噪声短上扫 0.22s）——球出手 */
function playWhoosh(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const dur = 0.22;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.4;
  filter.frequency.setValueAtTime(600, t);
  filter.frequency.exponentialRampToValueAtTime(2600, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.55, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** v8.3 接住啵（短促 pop 380→180Hz 0.07s）——球被叼住/放下 */
function playPop(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(380, t);
  osc.frequency.exponentialRampToValueAtTime(180, t + 0.07);
  g.gain.setValueAtTime(0.9, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.09);
}

/** v8.3 小狗汪汪（两声短促 square 300→180Hz）——摸小狗 */
function playBark(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  for (const [dt0, f0, d] of [
    [0, 320, 0.09],
    [0.14, 280, 0.11],
  ] as [number, number, number][]) {
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(f0, t + dt0);
    osc.frequency.exponentialRampToValueAtTime(170, t + dt0 + d);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t + dt0);
    g.gain.exponentialRampToValueAtTime(0.3, t + dt0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + dt0 + d);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    osc.connect(lp).connect(g).connect(out);
    osc.start(t + dt0);
    osc.stop(t + dt0 + d + 0.02);
  }
}

/** v8.3 兔兔噔（sine 220→520→330 弹跳滑音 0.18s）——摸兔子 */
function playBoing(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const dur = 0.18;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(520, t + 0.07);
  osc.frequency.exponentialRampToValueAtTime(330, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.45, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// ---------------- v11 G1 雷声 / G2 环境白噪音引擎（纯 Web Audio 合成，禁外部音频文件） ----------------

/** 布朗噪声段（积分白噪声，能量偏低频； Thunder rumble / 壁炉底噪用） */
function brownBuf(c: AudioContext, dur: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const ch = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    ch[i] = last * 3.5;
  }
  return buf;
}

/**
 * 雷声：开头短促「crack」劈裂 + 低频 rumble 2.5~3s 指数衰减，随机音量 0.5~0.8。
 * 纯合成：crack = 高通白噪 0.12s 速衰；rumble = 布朗噪低通 60→140Hz 扫频 + 慢 LFO 起伏。
 */
function playThunder(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const vol = 0.5 + Math.random() * 0.3; // 随机音量 0.5~0.8
  const dur = 2.5 + Math.random() * 0.5;
  const bus = c.createGain();
  bus.gain.value = vol;
  bus.connect(out);
  // —— 开头 crack：短促宽频劈裂（高通 700Hz 白噪 0.1s 速衰 + 低频 body 一点） ——
  const crack = c.createBufferSource();
  crack.buffer = noiseBuf(c, 0.14);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 700;
  const cg = c.createGain();
  cg.gain.setValueAtTime(0.9, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  crack.connect(hp).connect(cg).connect(bus);
  crack.start(t);
  crack.stop(t + 0.15);
  // —— rumble：布朗噪低通扫频，指数衰减拖尾 ——
  const rum = c.createBufferSource();
  rum.buffer = brownBuf(c, dur);
  rum.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(150, t);
  lp.frequency.exponentialRampToValueAtTime(70, t + dur);
  lp.Q.value = 0.6;
  const rg = c.createGain();
  rg.gain.setValueAtTime(0.0001, t);
  rg.gain.exponentialRampToValueAtTime(1.0, t + 0.06); // 起音紧跟 crack
  rg.gain.exponentialRampToValueAtTime(0.55, t + 0.5);
  rg.gain.exponentialRampToValueAtTime(0.001, t + dur); // 指数衰减拖尾
  // 慢 LFO：隆隆声忽强忽弱的翻滚感
  const lfo = c.createOscillator();
  lfo.frequency.value = 2.3 + Math.random();
  const lfoG = c.createGain();
  lfoG.gain.value = 0.14;
  lfo.connect(lfoG).connect(rg.gain);
  rum.connect(lp).connect(rg).connect(bus);
  rum.start(t);
  rum.stop(t + dur + 0.05);
  lfo.start(t);
  lfo.stop(t + dur + 0.05);
}

/** 环境音种类（null = 全停） */
type AmbientKind = 'rain' | 'fire' | 'wind';

/** 环境音相对增益（最终响度 = 本值 × master 0.14 ≈ 0.14，落在柔和的 0.12~0.16 区间、不盖 TTS） */
const AMBIENT_VOL = 1.0;

/** 环境音引擎状态：当前种类 + 运行中的节点组 */
const ambient = {
  kind: null as AmbientKind | null,
  nodes: null as { out: GainNode; srcs: AudioBufferSourceNode[]; extras: AudioScheduledSourceNode[] } | null,
};

/** 立即停掉正在播的环境音（0.4s 快速淡出防爆音） */
function stopAmbientNow(): void {
  const a = ctx && master ? { ctx, master } : null;
  const n = ambient.nodes;
  ambient.nodes = null;
  ambient.kind = null;
  if (!a || !n) return;
  const { ctx: c } = a;
  const t = c.currentTime;
  try {
    n.out.gain.cancelScheduledValues(t);
    n.out.gain.setValueAtTime(n.out.gain.value, t);
    n.out.gain.linearRampToValueAtTime(0.0001, t + 0.4);
  } catch {
    /* 已停止就算了 */
  }
  setTimeout(() => {
    for (const s of n.srcs) {
      try {
        s.stop();
      } catch {
        /* noop */
      }
    }
    for (const s of n.extras) {
      try {
        s.stop();
      } catch {
        /* noop */
      }
    }
    try {
      n.out.disconnect();
    } catch {
      /* noop */
    }
  }, 460);
}

/** 生成「柴火噼啪」稀疏爆点循环 buffer：绝大多数静音 + 随机短促爆点 */
function crackleBuf(c: AudioContext, dur: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const ch = buf.getChannelData(0);
  const pops = 26;
  for (let p = 0; p < pops; p++) {
    const at = Math.floor(Math.random() * (len - 900));
    const amp = 0.25 + Math.random() * 0.75;
    const n = 60 + Math.floor(Math.random() * 240);
    for (let i = 0; i < n; i++) {
      ch[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (n * 0.22));
    }
  }
  return buf;
}

/**
 * G2 环境白噪音切换（循环合成、~1s 渐变、总音量柔和 0.12~0.16）：
 * rain=雨声 / fire=壁炉柴火 / wind=雪夜风声 / null=全停；同 kind 幂等。
 */
function playAmbient(kind: AmbientKind | null): void {
  if (kind !== null && kind === ambient.kind) return; // 同 kind 幂等（已在放就不再重建）
  stopAmbientNow();
  ambient.kind = kind;
  if (!kind) return;
  if (!enabled) {
    ambient.kind = null; // 总开关关着：视为没在放（ambientCurrent 同步为 null，开关重开后可正常起播）
    return;
  }
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const bus = c.createGain();
  bus.gain.setValueAtTime(0.0001, t);
  bus.gain.linearRampToValueAtTime(AMBIENT_VOL, t + 1.0); // ~1s 渐入
  bus.connect(out);
  const srcs: AudioBufferSourceNode[] = [];
  const extras: AudioScheduledSourceNode[] = [];
  if (kind === 'rain') {
    // 雨声：白噪 → 高通 350 → 低通 2600 的沙沙声 + 微微起伏
    const src = c.createBufferSource();
    src.buffer = noiseBuf(c, 2.4);
    src.loop = true;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 380;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2500;
    const g = c.createGain();
    g.gain.value = 0.9;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoG = c.createGain();
    lfoG.gain.value = 0.08;
    lfo.connect(lfoG).connect(g.gain);
    src.connect(hp).connect(lp).connect(g).connect(bus);
    src.start(t);
    lfo.start(t);
    srcs.push(src);
    extras.push(lfo);
  } else if (kind === 'fire') {
    // 壁炉：布朗噪低通 320 的暖底噪 + 稀疏噼啪爆点（高通）
    const src = c.createBufferSource();
    src.buffer = brownBuf(c, 3);
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    const g = c.createGain();
    g.gain.value = 0.95;
    src.connect(lp).connect(g).connect(bus);
    src.start(t);
    const crk = c.createBufferSource();
    crk.buffer = crackleBuf(c, 4.5);
    crk.loop = true;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1700;
    const cg = c.createGain();
    cg.gain.value = 0.3;
    crk.connect(hp).connect(cg).connect(bus);
    crk.start(t);
    srcs.push(src, crk);
  } else {
    // 雪夜风声：白噪带通扫频（0.06Hz 在 260↔720Hz 间摆）+ 音量慢起伏
    const src = c.createBufferSource();
    src.buffer = noiseBuf(c, 3);
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.value = 480;
    const sweep = c.createOscillator();
    sweep.frequency.value = 0.06;
    const sweepG = c.createGain();
    sweepG.gain.value = 230;
    sweep.connect(sweepG).connect(bp.frequency);
    const g = c.createGain();
    g.gain.value = 1.0;
    const gust = c.createOscillator();
    gust.frequency.value = 0.045;
    const gustG = c.createGain();
    gustG.gain.value = 0.22;
    gust.connect(gustG).connect(g.gain);
    src.connect(bp).connect(g).connect(bus);
    src.start(t);
    sweep.start(t);
    gust.start(t);
    srcs.push(src);
    extras.push(sweep, gust);
  }
  ambient.nodes = { out: bus, srcs, extras };
}

/** 查询当前环境音（null = 没在放） */
function ambientCurrent(): AmbientKind | null {
  return ambient.kind;
}

/** 音效单例（CoupleHome 全屋接线用；每个函数内部自带开关检查） */
export const sfx = {
  tap: playTap,
  place: playPlace,
  remove: playRemove,
  door: playDoor,
  step: playStep,
  // v7.1 宠物互动萌系音效
  purr: playPurr,
  crunch: playCrunch,
  sip: playSip,
  bathWater: playBathWater,
  kiss: playKiss,
  whistle: playWhistle,
  meow: playMeow,
  // v8.3 玩具球 / 第二只宠物
  whoosh: playWhoosh,
  pop: playPop,
  bark: playBark,
  boing: playBoing,
  // v11 G1 雷声 / G2 环境白噪音引擎
  thunder: playThunder,
  ambient: playAmbient,
  ambientCurrent,
  setEnabled,
  isEnabled,
} as const;
