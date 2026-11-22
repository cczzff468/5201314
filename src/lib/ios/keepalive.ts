'use client';

/**
 * 后台保活（v80 · 设置「后台保活」开关）：切到后台/锁屏时尽量保持网页运行——
 * AI 主动消息（ProactiveMsgWatcher 5s tick）与后台接力轮询（bg-relay-watcher 10s peek）
 * 不因标签页定时器节流（后台 1s → 深度节流 1 次/分钟）而中断。
 *
 * 两个手段并行，全是纯前端能力、无外部依赖：
 * 1) Worker 心跳（keepalive-scheduler.worker）：每 3s postMessage 唤醒主线程——
 *    跨线程消息投递不受后台定时器节流限制，主线程注册的回调（onKeepAliveTick）
 *    在后台也照常驱动；前台行为不变（消费方按「距上次运行 ≥ 自己的间隔」判定，
 *    与原生 setTimeout 循环共用一个节奏闸，不会双发）；
 * 2) 无声音频保活：WebAudio 极低音量振荡器常驻播放（gain 0.0001，人耳听不到但
 *    信号非零），浏览器把「正在播放音频」的标签页视为活跃——不冻结、不丢弃，
 *    iOS Safari 后台也更不容易杀页。AudioContext 需要用户手势：开关本身是点击
 *    （有手势，直接 resume）；冷启动恢复时没手势会挂起——第一次任意交互
 *    （pointerdown/keydown/回前台）自动拉起。
 *
 * 开关持久化 settings.bgKeepAlive（useSettings），开启即启动、关闭即全停
 * （Worker terminate + 振荡器停）。keep-alive 关闭时 onKeepAliveTick 不再触发，
 * 调用方照常走各自的原生 setTimeout/setInterval 循环，行为与未开启时完全一致。
 */

type TickCb = () => void;

/** 注册的回调（Worker 每敲一次钟全部跑一遍；消费方自带间隔闸） */
const callbacks = new Set<TickCb>();

let worker: Worker | null = null;
let audioCtx: AudioContext | null = null;
let osc: OscillatorNode | null = null;
let active = false;
let gestureBound = false;

/** 累计敲钟次数（dev 钩子/自检用：Worker 心跳真的在跑的直观数） */
let tickCount = 0;

/** 敲钟分发（拷贝一份再遍历：回调里增删集合不炸迭代） */
function fireTicks(): void {
  tickCount += 1;
  for (const cb of Array.from(callbacks)) {
    try {
      cb();
    } catch {
      /* 单个回调失败不影响其它回调（后台增强能力，静默） */
    }
  }
}

/** 启动 Worker 心跳（失败静默——音频通道 + 消费方原生循环兜底） */
function ensureWorker(): void {
  if (worker) return;
  try {
    worker = new Worker(new URL('./keepalive-scheduler.worker.ts', import.meta.url));
    worker.onmessage = () => fireTicks();
    worker.onerror = () => {
      /* Worker 异常静默：保活的音频通道继续，消费方原生循环本就是兜底 */
    };
  } catch {
    worker = null; // CSP/旧环境不支持 → 纯主线程行为
  }
}

/**
 * 启动/续播无声音频（人耳听不到的极低音量振荡器）：
 * 已 running 且振荡器在跑 → 幂等直接返回；无手势 resume 失败 → bindGesture 那边等交互补拉。
 */
async function ensureAudio(): Promise<void> {
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AC();
    if (audioCtx.state === 'suspended') {
      try {
        await audioCtx.resume();
      } catch {
        /* 需要用户手势：等 bindGesture 的交互监听拉起 */
      }
    }
    if (audioCtx.state !== 'running') return;
    if (osc) return;
    osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    gain.gain.value = 0.0001; // 非零信号：浏览器按「正在播放音频」对待（人耳听不到）
    osc.frequency.value = 30; // 低频不刺耳也不易被响度策略过滤
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
  } catch {
    /* AudioContext 不可用（极老浏览器）静默——Worker 通道不受影响 */
  }
}

/** 一次性交互监听：AudioContext 被自动播放策略挂起时，第一次交互/回前台自动续播 */
function bindGesture(): void {
  if (gestureBound || typeof window === 'undefined') return;
  gestureBound = true;
  const resume = () => {
    if (active) void ensureAudio();
  };
  window.addEventListener('pointerdown', resume, { passive: true });
  window.addEventListener('keydown', resume);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resume();
  });
}

/** 当前后台保活是否处于开启态（设置页/调试用） */
export function isKeepAliveActive(): boolean {
  return typeof window !== 'undefined' && active;
}

/** 开启后台保活（幂等）：Worker 心跳 + 无声音频双通道一起拉起 */
export function startKeepAlive(): void {
  if (typeof window === 'undefined' || active) return;
  active = true;
  ensureWorker();
  void ensureAudio(); // 无手势时挂起——bindGesture 等第一次交互自动补拉
  bindGesture();
}

/** 关闭后台保活（幂等）：Worker 终止 + 振荡器停；AudioContext 只 suspend 不 close（便于再开） */
export function stopKeepAlive(): void {
  if (typeof window === 'undefined') return;
  active = false;
  if (worker) {
    try {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    } catch {
      /* 已终止的极端情况静默 */
    }
    worker = null;
  }
  if (osc) {
    try {
      osc.stop();
    } catch {
      /* 未在播放时 stop 抛错可忽略 */
    }
    try {
      osc.disconnect();
    } catch {
      /* 同上 */
    }
    osc = null;
  }
  if (audioCtx && audioCtx.state === 'running') {
    try {
      void audioCtx.suspend();
    } catch {
      /* 静默 */
    }
  }
}

/**
 * 注册「Worker 敲钟回调」（后台不被节流的第二通道）：
 * 保活开启时每 3s 触发一次——消费方按自己的间隔闸判定要不要干活
 * （与原生 setTimeout/setInterval 循环共用节拍，两通道不会双发同一轮）。
 * 返回反注册函数（Watcher 卸载时调用）。
 */
export function onKeepAliveTick(cb: TickCb): () => void {
  callbacks.add(cb);
  return () => {
    callbacks.delete(cb);
  };
}

// dev 测试钩子（生产构建被 NODE_ENV 闸挡掉；bg-relay-watcher __bgRelayWatcher 同款）：
// window.__keepalive.state() 看 Worker/音频双通道与心跳计数；ping() 强制敲一次钟
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  const w = window as unknown as {
    __keepalive?: { state: () => Record<string, unknown>; ping: () => void };
  };
  w.__keepalive = {
    state: () => ({ active, worker: worker !== null, audio: audioCtx?.state ?? 'none', osc: osc !== null, ticks: tickCount, cbs: callbacks.size }),
    ping: () => fireTicks(),
  };
}
