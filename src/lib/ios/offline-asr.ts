'use client';

/**
 * 离线语音识别（SenseVoice 端侧模型，纯前端 WASM 推理）——已验证的终极方案：
 *
 * - 运行时：speech-asr（sherpa-onnx WASM）拷贝到 /asr/*，loadPackage 已打补丁禁用
 *   500MB 冗余 .data 下载（HuggingFace 源国内被墙），只保留 .wasm + glue + worker；
 * - 模型：SenseVoice int8（239,233,841 字节）+ tokens.txt，从阿里云 ModelScope（魔搭）
 *   直链下载——国内直连、响应头 Access-Control-Allow-Origin: *、CDN 二跳同样放行 CORS；
 * - 缓存：浏览器 Cache API 持久化（用户只需下载一次），流式读取 + Content-Length 进度，
 *   主源失败自动切换备用源（同为 ModelScope 直链）；
 * - 注入：下载完的模型经 Worker 消息写入 MEMFS 虚拟文件系统，OfflineRecognizer 直接加载；
 * - 识别：录音 Blob → decodeAudioData → 单声道 → 线性重采样 16k → Worker decode → 文本。
 *   断网完全可用；失败由调用方（stt-client）静默降级云端 STT。
 */

import { create } from 'zustand';

// ---------------- 模型源（极度重要：ModelScope 直链，禁用 huggingface/hf-mirror） ----------------

/** 主源（与验证时字节级一致：model.int8.onnx = 239,233,841 B） */
const PRIMARY_BASE = 'https://www.modelscope.cn/models/Mr7Cat/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/master/';
/** 备用源（同模型镜像，同为 ModelScope 直链） */
const BACKUP_BASE = 'https://www.modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master/';

const SOURCES = [PRIMARY_BASE, BACKUP_BASE];

/** 模型文件（大小用于无 Content-Length 时的进度兜底与完整性校验） */
const MODEL_FILES: { name: string; knownSize: number }[] = [
  { name: 'model.int8.onnx', knownSize: 239_233_841 },
  { name: 'tokens.txt', knownSize: 315_894 },
];

const CACHE_NAME = 'sensevoice-asr-v1';
const STATUS_KEY = 'asr-offline-ready';

/** 模型在 MEMFS 中的路径（与 worker 注入补丁、识别 config 三方一致） */
export const VFS_MODEL_PATH = '/model.int8.onnx';
export const VFS_TOKENS_PATH = '/tokens.txt';

// ---------------- 状态（设置页订阅渲染） ----------------

export interface OfflineAsrProgress {
  loaded: number;
  total: number;
  /** 0~100 */
  pct: number;
}

export type OfflineAsrStatus = 'checking' | 'not-downloaded' | 'downloading' | 'ready' | 'error';

interface OfflineAsrState {
  status: OfflineAsrStatus;
  progress: OfflineAsrProgress | null;
  /** 当前下载源序号（0=主源 1=备用源；仅下载中有意义） */
  sourceIndex: number;
  error: string | null;
  set: (patch: Partial<Omit<OfflineAsrState, 'set'>>) => void;
}

export const useOfflineAsr = create<OfflineAsrState>((set) => ({
  status: 'checking',
  progress: null,
  sourceIndex: 0,
  error: null,
  set: (patch) => set(patch),
}));

// ---------------- Worker 桥 ----------------

interface WorkerRefs {
  worker: Worker | null;
  ready: boolean;
  initPromise: Promise<void> | null;
  seq: number;
  pending: Map<number, { resolve: (text: string) => void; reject: (err: Error) => void }>;
}

const w: WorkerRefs = { worker: null, ready: false, initPromise: null, seq: 0, pending: new Map() };

/** 本地引擎是否已就绪（模型已下载 + Worker 已初始化） */
export function isOfflineAsrReady(): boolean {
  return w.ready;
}

function handleWorkerMessage(ev: MessageEvent): void {
  const data = (ev.data || {}) as { type?: string; id?: number; result?: unknown; message?: string };
  if (data.type === 'ready') {
    w.ready = true;
    useOfflineAsr.getState().set({ status: 'ready', progress: null, error: null });
    try {
      window.localStorage.setItem(STATUS_KEY, '1');
    } catch {
      // 存储不可用忽略
    }
    return;
  }
  if (data.type === 'init-error') {
    w.ready = false;
    useOfflineAsr.getState().set({ status: 'error', error: data.message || '离线引擎初始化失败' });
    w.initPromise = null;
    return;
  }
  if (data.type === 'decode-result' || data.type === 'decode-error') {
    const job = data.id != null ? w.pending.get(data.id) : undefined;
    if (!job) return;
    if (data.id != null) w.pending.delete(data.id);
    if (data.type === 'decode-result') {
      job.resolve(extractAsrText(data.result));
    } else {
      job.reject(new Error(data.message || '本地识别失败'));
    }
  }
}

/** sherpa-onnx GetOfflineStreamResultAsJson 的返回结构 → 纯文本（多形态防御式提取） */
function extractAsrText(result: unknown): string {
  if (!result) return '';
  if (typeof result === 'string') return result.trim();
  const r = result as { text?: unknown; texts?: unknown; results?: unknown };
  if (typeof r.text === 'string') return r.text.trim();
  if (Array.isArray(r.texts) && typeof r.texts[0] === 'string') return String(r.texts[0]).trim();
  if (Array.isArray(r.results)) {
    const first = r.results[0] as { text?: unknown } | undefined;
    if (first && typeof first.text === 'string') return first.text.trim();
  }
  return '';
}

// ---------------- 模型缓存（Cache API） ----------------

async function openCache(): Promise<Cache> {
  return caches.open(CACHE_NAME);
}

/** 单文件从指定源流式下载（进度回调），返回 Response（已消费需注意：返回 buffer 更稳） */
async function fetchModelWithProgress(
  url: string,
  knownSize: number,
  onProgress: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url, { mode: 'cors', cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const headerLen = Number(res.headers.get('content-length') || '');
  const total = Number.isFinite(headerLen) && headerLen > 0 ? headerLen : knownSize;
  // 无流式 reader 能力（极旧浏览器）：一次性读，进度只报 0/100
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = await res.arrayBuffer();
    onProgress(buf.byteLength, total);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, total);
    }
  }
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged.buffer;
}

/**
 * 确保两个模型文件都已进入 Cache API（命中跳过；未命中按源顺序下载，失败自动换源）。
 * 全部成功 resolve；任一文件所有源都失败 → throw（外层置 error 状态）。
 */
async function ensureModelsCached(onProgress: (overall: OfflineAsrProgress) => void): Promise<void> {
  const cache = await openCache();
  const grandTotal = MODEL_FILES.reduce((s, f) => s + f.knownSize, 0);

  // 阶段一：缓存命中检查（已下载过的文件不重复下载、不计进度）
  const missing: { name: string; knownSize: number }[] = [];
  for (const f of MODEL_FILES) {
    const hit = await cache.match(PRIMARY_BASE + f.name).catch(() => null);
    const hit2 = hit ?? (await cache.match(BACKUP_BASE + f.name).catch(() => null));
    if (!hit2) missing.push(f);
  }

  let baseLoaded = grandTotal - missing.reduce((s, f) => s + f.knownSize, 0);

  for (const f of missing) {
    let lastErr: unknown = null;
    let done = false;
    for (let si = 0; si < SOURCES.length && !done; si++) {
      const url = SOURCES[si] + f.name;
      useOfflineAsr.getState().set({ sourceIndex: si });
      try {
        const buf = await fetchModelWithProgress(
          url,
          f.knownSize,
          (loaded, total) => {
            onProgress({
              loaded: baseLoaded + loaded,
              total: grandTotal,
              pct: Math.min(99.5, ((baseLoaded + loaded) / grandTotal) * 100),
            });
          },
        );
        // 字节完整性校验（截断的响应不入缓存）
        if (buf.byteLength !== f.knownSize) {
          throw new Error(`文件大小不符（${buf.byteLength}/${f.knownSize}），下载不完整`);
        }
        await cache.put(url, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.byteLength) } }));
        baseLoaded += f.knownSize;
        done = true;
      } catch (err) {
        lastErr = err;
        // 换下一个源重试
      }
    }
    if (!done) {
      throw new Error(
        `模型下载失败：${lastErr instanceof Error ? lastErr.message : '所有下载源均不可达'}（请检查网络后重试）`,
      );
    }
  }
  // 最终进度 100%
  onProgress({ loaded: grandTotal, total: grandTotal, pct: 100 });
}

// ---------------- 引擎初始化 / 识别 ----------------

/**
 * 初始化离线引擎（幂等）：确保模型已缓存 → 读缓存 → 创建 Worker → 注入 MEMFS → 等 ready。
 * 已就绪时直接返回。
 */
export function initOfflineAsr(): Promise<void> {
  if (w.ready) return Promise.resolve();
  if (w.initPromise) return w.initPromise;

  w.initPromise = (async () => {
    const st = useOfflineAsr.getState();
    st.set({ status: st.status === 'ready' ? 'ready' : 'downloading', error: null });

    // ① 模型缓存（已就绪用户：秒过）
    await ensureModelsCached((p) => {
      useOfflineAsr.getState().set({
        status: 'downloading',
        progress: p,
        error: null,
      });
    });

    // ② 读缓存（ArrayBuffer）
    const cache = await openCache();
    const buffers = new Map<string, ArrayBuffer>();
    for (const f of MODEL_FILES) {
      let res = await cache.match(PRIMARY_BASE + f.name).catch(() => null);
      res = res ?? (await cache.match(BACKUP_BASE + f.name).catch(() => null));
      if (!res) throw new Error('模型缓存丢失，请重新下载');
      buffers.set(f.name, await res.arrayBuffer());
    }

    // ③ Worker + 注入（transfer 所有权，零拷贝）
    if (w.worker) {
      w.worker.terminate();
      w.worker = null;
    }
    const worker = new Worker('/asr/offline-worker.js');
    w.worker = worker;
    w.ready = false;
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (e) => {
      if (!w.ready) {
        useOfflineAsr.getState().set({ status: 'error', error: e.message || '离线引擎加载失败' });
        w.initPromise = null;
      }
    };

    const modelBuf = buffers.get('model.int8.onnx')!;
    const tokensBuf = buffers.get('tokens.txt')!;
    const readyPromise = new Promise<void>((resolve, reject) => {
      // 轮询检查 ready / error（worker 消息处理器负责置位）；120s 超时兜底
      const startedAt = Date.now();
      const check = setInterval(() => {
        if (w.ready) {
          clearInterval(check);
          resolve();
          return;
        }
        const s = useOfflineAsr.getState();
        if (s.status === 'error') {
          clearInterval(check);
          reject(new Error(s.error || '离线引擎初始化失败'));
          return;
        }
        if (Date.now() - startedAt > 120_000) {
          clearInterval(check);
          reject(new Error('离线引擎初始化超时'));
        }
      }, 120);
    });

    worker.postMessage(
      {
        type: 'init',
        sampleRate: 16000,
        runtimePaths: {
          baseUrl: `${window.location.origin}/asr/`,
          wasmJs: 'sherpa-onnx-wasm-main-asr.js',
          asrJs: 'sherpa-onnx-asr.js',
          wasm: 'sherpa-onnx-wasm-main-asr.wasm',
          data: 'sherpa-onnx-wasm-main-asr.data', // loadPackage 已被补丁禁用，此路径不会真正请求
        },
        config: {
          featConfig: { sampleRate: 16000, featureDim: 80 },
          modelConfig: {
            tokens: VFS_TOKENS_PATH,
            numThreads: 1,
            debug: 0,
            provider: 'cpu',
            senseVoice: {
              model: VFS_MODEL_PATH,
              language: 'auto',
              useInverseTextNormalization: 1,
            },
          },
          decodingMethod: 'greedy_search',
        },
        modelFiles: [
          { name: VFS_MODEL_PATH, buffer: modelBuf },
          { name: VFS_TOKENS_PATH, buffer: tokensBuf },
        ],
      },
      [modelBuf, tokensBuf],
    );

    await readyPromise;
  })();

  w.initPromise = w.initPromise
    .catch((err: unknown) => {
      w.ready = false;
      w.initPromise = null;
      const msg = err instanceof Error ? err.message : String(err);
      const cur = useOfflineAsr.getState();
      if (cur.status !== 'error') cur.set({ status: 'error', error: msg });
      throw err;
    });
  return w.initPromise;
}

/** 音频 Blob → 16k 单声道 Float32Array（decodeAudioData 本地解码，断网可用） */
async function blobTo16kMono(blob: Blob): Promise<Float32Array> {
  const ab = await blob.arrayBuffer();
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(ab.slice(0));
    // 多声道混单声道
    const chs = decoded.numberOfChannels;
    const len = decoded.length;
    let mono: Float32Array;
    if (chs === 1) {
      mono = decoded.getChannelData(0).slice();
    } else {
      mono = new Float32Array(len);
      for (let c = 0; c < chs; c++) {
        const data = decoded.getChannelData(c);
        for (let i = 0; i < len; i++) mono[i] += data[i] / chs;
      }
    }
    // 线性重采样到 16k
    const srcRate = decoded.sampleRate;
    if (srcRate === 16000) return mono;
    const ratio = srcRate / 16000;
    const outLen = Math.max(1, Math.floor(len / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const src = i * ratio;
      const i0 = Math.floor(src);
      const i1 = Math.min(len - 1, i0 + 1);
      const frac = src - i0;
      out[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
    }
    return out;
  } finally {
    void ctx.close().catch(() => null);
  }
}

/**
 * 离线识别一段录音（引擎未就绪/失败 → 抛错，调用方静默降级云端 STT）。
 * 空结果返回 ''。
 */
export async function offlineAsrTranscribe(blob: Blob): Promise<string> {
  if (!w.ready) {
    // 引擎未就绪：惰性初始化（模型已缓存时只需等 Worker 注入，秒级）
    await initOfflineAsr();
  }
  const samples = await blobTo16kMono(blob);
  if (!samples.length) return '';
  const worker = w.worker;
  if (!worker || !w.ready) throw new Error('离线引擎未就绪');
  const id = ++w.seq;
  const text = await new Promise<string>((resolve, reject) => {
    w.pending.set(id, { resolve, reject });
    const timer = window.setTimeout(() => {
      if (w.pending.has(id)) {
        w.pending.delete(id);
        reject(new Error('本地识别超时'));
      }
    }, 60_000);
    const wrappedResolve = (t: string) => {
      window.clearTimeout(timer);
      resolve(t);
    };
    const wrappedReject = (e: Error) => {
      window.clearTimeout(timer);
      reject(e);
    };
    w.pending.set(id, { resolve: wrappedResolve, reject: wrappedReject });
    const buf = samples.buffer instanceof ArrayBuffer ? samples.buffer : new Uint8Array(samples).buffer;
    worker.postMessage({ type: 'decode', id, audioBuffer: buf, sampleRate: 16000 }, [buf]);
  });
  // 过滤 ASR 对静音/噪声的典型无意义输出（与云端兜底同口径）
  if (!text || /^[#\s*_\-.,!?~。？！，、…—·]+$/.test(text)) return '';
  return text;
}

/** 删除端侧模型（清缓存 + 销毁 Worker），设置页「删除」按钮用 */
export async function deleteOfflineModel(): Promise<void> {
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // 缓存删除失败忽略
  }
  if (w.worker) {
    try {
      w.worker.terminate();
    } catch {
      // 已终止忽略
    }
    w.worker = null;
  }
  w.ready = false;
  w.initPromise = null;
  w.pending.clear();
  try {
    window.localStorage.removeItem(STATUS_KEY);
  } catch {
    // 存储不可用忽略
  }
  useOfflineAsr.getState().set({ status: 'not-downloaded', progress: null, error: null, sourceIndex: 0 });
}

// ---------------- 模块加载时恢复状态（是否已有缓存） ----------------

// 调试钩子（控制台可用）：__offlineAsr.transcribe(blob) 直接验证端侧识别
if (typeof window !== 'undefined') {
  (window as unknown as { __offlineAsr?: { ready: () => boolean; transcribe: (b: Blob) => Promise<string> } }).__offlineAsr = {
    ready: () => isOfflineAsrReady(),
    transcribe: (b: Blob) => offlineAsrTranscribe(b),
  };
}

if (typeof window !== 'undefined') {
  void (async () => {
    try {
      const cache = await openCache();
      let all = true;
      for (const f of MODEL_FILES) {
        const hit = (await cache.match(PRIMARY_BASE + f.name).catch(() => null)) ?? (await cache.match(BACKUP_BASE + f.name).catch(() => null));
        if (!hit) {
          all = false;
          break;
        }
      }
      if (all) {
        // 有完整缓存：not-downloaded→ready 由 initOfflineAsr 真正拉起引擎后确认；
        // 这里先标记 cached，UI 显示「已下载」，首次使用时自动惰性初始化
        useOfflineAsr.getState().set({ status: 'not-downloaded' });
        // 惰性预热引擎（不阻塞 UI；失败静默，首次识别时会重试）
        void initOfflineAsr().catch(() => null);
      } else {
        useOfflineAsr.getState().set({ status: 'not-downloaded' });
      }
    } catch {
      useOfflineAsr.getState().set({ status: 'not-downloaded' });
    }
  })();
}
