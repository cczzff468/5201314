/**
 * Web Speech API（浏览器内置语音识别）封装 —— 语音消息「实时转文字」：
 * - 录音按住期间并行跑 SpeechRecognition（与 MediaRecorder 共享麦克风，Chrome/Edge/Safari 均允许），
 *   松手即得文本：「划到转文字」零等待秒出结果，不再请求 /api/stt
 * - 仅支持实时麦克风识别，不能转写已录好的音频文件 → 长按旧语音气泡转文字仍走服务端
 * - 不支持的环境（Firefox / 无麦克风权限 / 无网络）静默返回 null 或空文本，
 *   调用方回退服务端识别，录音本身不受任何影响
 * - 识别语言固定 zh-CN（本应用为中文场景）
 */

/* ───────────────────────── 最小类型声明（不依赖 TS DOM lib 是否内置 Web Speech 类型） ───────────────────────── */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** 当前浏览器是否支持 Web Speech API 实时识别（SSR 返回 false） */
export function isWebSpeechSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/** 一次实时识别会话 */
export interface WebSpeechSession {
  /**
   * 结束识别并取回累计文本（最终段 + 未定稿的临时段）。
   * onend 触发即 resolve；网络异常导致 onend 迟迟不来时 800ms 超时兜底。
   */
  stop(): Promise<string>;
  /** 立即丢弃：不再累计文本，静默终止（取消录音 / 启动失败时用） */
  abort(): void;
}

/**
 * 开始实时识别。失败/不支持返回 null（调用方按「无实时识别」处理）。
 * onPartial：增量文本（已定稿段 + 当前临时段），适合录音浮层实时展示。
 */
export function startWebSpeechSession(opts: {
  lang?: string;
  onPartial?: (text: string) => void;
  /** 每句定稿回调（v10 对讲机模式：逐句自动发送） */
  onFinal?: (text: string) => void;
}): WebSpeechSession | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;

  let rec: SpeechRecognitionLike;
  try {
    rec = new Ctor();
  } catch {
    return null;
  }
  rec.lang = opts.lang ?? 'zh-CN';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  const finals: string[] = [];
  let interim = '';
  // stopped：调用方要求结束；fatal：致命错误（权限/麦克风被占），不再自动重启
  let stopped = false;
  let fatal = false;
  let ended = false;
  let waiters: Array<() => void> = [];

  const joined = (): string => (finals.join('') + interim).trim();

  const settleEnd = () => {
    if (ended) return;
    ended = true;
    const list = waiters;
    waiters = [];
    list.forEach((fn) => fn());
  };

  rec.onresult = (e: SpeechRecognitionEventLike) => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const t = r?.[0]?.transcript ?? '';
      if (r.isFinal) {
        if (t.trim()) {
          finals.push(t);
          opts.onFinal?.(t.trim());
        }
      } else {
        interim += t;
      }
    }
    opts.onPartial?.(joined());
  };

  rec.onerror = (e: SpeechRecognitionErrorEventLike) => {
    // not-allowed/service-not-allowed：权限问题；audio-capture：麦克风被占/不可用 —— 都不重试
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
      fatal = true;
    }
    // no-speech / aborted / network 等非致命错误：交给 onend 决定是否重启
  };

  rec.onend = () => {
    // Chrome 的 continuous 模式也可能中途结束（静音超时/网络切换）：未结束则自动重启续录
    if (!stopped && !fatal) {
      try {
        rec.start();
      } catch {
        settleEnd();
      }
      return;
    }
    settleEnd();
  };

  try {
    rec.start();
  } catch {
    return null;
  }

  return {
    stop(): Promise<string> {
      if (ended) return Promise.resolve(joined());
      stopped = true;
      return new Promise<string>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve(joined());
        };
        waiters.push(finish);
        try {
          rec.stop();
        } catch {
          settleEnd();
        }
        // 兜底：个别浏览器 onend 不可靠，800ms 后以当前累计文本返回
        window.setTimeout(finish, 800);
      });
    },
    abort() {
      stopped = true;
      fatal = true;
      settleEnd();
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    },
  };
}
