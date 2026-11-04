'use client';

/**
 * 语音备忘录 App —— 仿 iOS 17 语音备忘录（跟随主题浅色/深色 + 红色录制元素 #FF453A）
 * - 录音：MediaRecorder（mime 依次尝试 audio/webm → audio/mp4 → 默认），支持暂停/继续
 * - 实时波形：AudioContext + AnalyserNode，48 根红色竖条 rAF 绘制
 * - 播放：模块级单例 Audio，行内进度 rAF 更新；切歌/卸载时停止并回收 ObjectURL
 * - 浅色模式整体 bg-background 浅色；录音钮空闲态外圈用红色投影/红晕替代深色模式的白底
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, ChevronDown, Pause, Pencil, Play, Share2, Trash2 } from 'lucide-react';
import { formatDuration, genId, localDB, type RecordingRecord } from '@/lib/ios/db';
import { IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';

// ---------------- #86：iOS 风格确认弹窗（代替 window.confirm） ----------------

function ConfirmDialog({
  message,
  onCancel,
  onConfirm,
}: {
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="absolute inset-0 z-[70] grid place-items-center px-8" role="dialog" aria-label="确认删除">
      <button type="button" aria-label="取消" onClick={onCancel} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full rounded-[20px] bg-white/85 p-4 shadow-2xl ring-1 ring-white/70 backdrop-blur-2xl dark:bg-[#1C1C1E]/90 dark:ring-white/[0.09]">
        <p className="text-center text-[15px] leading-relaxed text-foreground">{message}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 flex-1 rounded-[10px] bg-muted text-[15px] active:opacity-70"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              onCancel();
              onConfirm();
            }}
            className="h-10 flex-1 rounded-[10px] bg-[#FF453A] text-[15px] font-medium text-white active:opacity-80"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 模块级播放单例 ----------------

let pbAudio: HTMLAudioElement | null = null;
let pbUrl: string | null = null;

function getPlaybackAudio(): HTMLAudioElement {
  if (!pbAudio) pbAudio = new Audio();
  return pbAudio;
}

/** 停止播放并回收 ObjectURL */
function stopPlayback() {
  if (pbAudio) {
    pbAudio.pause();
    pbAudio.onended = null;
  }
  if (pbUrl) {
    URL.revokeObjectURL(pbUrl);
    pbUrl = null;
  }
}

// ---------------- 工具 ----------------

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('mp4') || m.includes('aac') || m.includes('m4a')) return 'm4a';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  return 'webm';
}

/** mm:ss（两位分钟，与 formatDuration 的 m:ss 不同） */
function mmss(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

/** 12 小时制：下午3:45 */
function ampmTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const ampm = h < 12 ? '上午' : '下午';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm}${h12}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function dateGroupLabel(ts: number): string {
  const d = new Date(ts);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.floor((startOf(new Date()) - startOf(d)) / 86400000);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  if (d.getTime() >= monday.getTime()) {
    const names = ['日', '一', '二', '三', '四', '五', '六'] as const;
    return `周${names[d.getDay()]}`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function nextRecordingName(rows: RecordingRecord[]): string {
  let max = 0;
  for (const r of rows) {
    const m = /^新录音 (\d+)$/.exec(r.name);
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  return `新录音 ${max + 1}`;
}

// ---------------- 波形绘制 ----------------

const BAR_COUNT = 48;
const BAR_GAP = 3;

/** 静态波形的确定性振幅（0~1，左右镜像对称） */
const STATIC_AMPS: number[] = Array.from({ length: BAR_COUNT }, (_, i) => {
  const m = i < BAR_COUNT / 2 ? i : BAR_COUNT - 1 - i;
  const env = 0.35 + 0.65 * (m / (BAR_COUNT / 2));
  return Math.min(1, 0.22 + 0.6 * Math.abs(Math.sin(m * 0.55 + 0.8)) * env);
});

/** 主题自适应的波形颜色（.dark 挂在手机壳层，用 closest 探测） */
function waveColors(canvas: HTMLCanvasElement): { live: string; idle: string } {
  const dark = canvas.closest('.dark') !== null;
  return dark
    ? { live: 'rgba(255,255,255,0.92)', idle: 'rgba(255,255,255,0.22)' }
    : { live: 'rgba(0,0,0,0.82)', idle: 'rgba(0,0,0,0.16)' };
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bw: number,
  barH: number
): void {
  const roundRect = (
    ctx as unknown as { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }
  ).roundRect;
  if (typeof roundRect === 'function') {
    ctx.beginPath();
    roundRect.call(ctx, x, y, bw, barH, bw / 2);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, bw, barH);
  }
}

function drawWave(canvas: HTMLCanvasElement | null, analyser: AnalyserNode | null, active: boolean) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w <= 0 || h <= 0) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const bw = Math.max(2, (w - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT);
  const colors = waveColors(canvas);

  // 未录音/暂停：静态居中对称波形条
  if (!active || !analyser) {
    ctx.fillStyle = colors.idle;
    for (let i = 0; i < BAR_COUNT; i++) {
      const barH = Math.max(3, STATIC_AMPS[i] * h * 0.62);
      const x = i * (bw + BAR_GAP);
      drawBar(ctx, x, (h - barH) / 2, bw, barH);
    }
    return;
  }

  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  ctx.fillStyle = colors.live;
  for (let i = 0; i < BAR_COUNT; i++) {
    // 频率轴按幂曲线取样，让低中频分布更自然
    const t = i / BAR_COUNT;
    const bin = Math.min(data.length - 1, Math.floor(Math.pow(t, 1.4) * data.length * 0.72));
    const v = data[bin] / 255;
    const barH = Math.max(3, v * h * 0.92);
    const x = i * (bw + BAR_GAP);
    drawBar(ctx, x, (h - barH) / 2, bw, barH);
  }
}

// ---------------- 行组件 ----------------

function RecordingRow({
  record,
  expanded,
  renaming,
  isLoaded,
  isPlaying,
  playPos,
  onToggleExpand,
  onTogglePlay,
  onRenameStart,
  onRenameCommit,
  onShare,
  onDelete,
}: {
  record: RecordingRecord;
  expanded: boolean;
  renaming: boolean;
  isLoaded: boolean;
  isPlaying: boolean;
  playPos: number;
  onToggleExpand: () => void;
  onTogglePlay: () => void;
  onRenameStart: () => void;
  onRenameCommit: (value: string) => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const pct = isLoaded ? Math.min(100, (playPos / Math.max(1, record.duration)) * 100) : 0;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        className="flex w-full cursor-pointer items-center px-5 py-4 text-left transition-colors active:bg-muted/50"
      >
        {renaming ? (
          <input
            autoFocus
            defaultValue={record.name}
            aria-label="重命名录音"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') onRenameCommit(e.currentTarget.value);
              if (e.key === 'Escape') onRenameCommit('');
            }}
            onBlur={(e) => onRenameCommit(e.currentTarget.value)}
            className="w-full rounded-[14px] bg-white/60 px-2.5 py-1 text-[17px] text-foreground outline-none ring-1 ring-white/70 backdrop-blur-xl focus:ring-2 focus:ring-foreground/30 dark:bg-white/[0.08] dark:ring-white/[0.1]"
          />
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[17px] leading-snug">{record.name}</div>
              <div className="mt-[3px] truncate text-[13px] leading-snug text-muted-foreground">
                {dateGroupLabel(record.createdAt)} {ampmTime(record.createdAt)}
              </div>
            </div>
            {/* 时长右侧独立列（iOS 语音备忘录同款） */}
            <span className="ml-3 shrink-0 text-[14px] leading-none tabular-nums text-muted-foreground">
              {formatDuration(record.duration)}
            </span>
            <ChevronDown
              className={`ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                expanded ? 'rotate-180' : ''
              }`}
            />
          </>
        )}
      </div>

      {expanded && (
        <div className="px-5 pb-4 pt-0.5">
          {/* 播放控制：按钮 + 进度条 */}
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? `暂停播放「${record.name}」` : `播放「${record.name}」`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/60 shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition duration-150 active:scale-90 dark:bg-white/[0.08] dark:ring-white/[0.1]"
            >
              {isPlaying ? (
                <Pause className="h-[18px] w-[18px]" fill="currentColor" />
              ) : (
                <Play className="ml-0.5 h-[18px] w-[18px]" fill="currentColor" />
              )}
            </button>
            <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/60 ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]">
              <div
                className="h-full rounded-full bg-foreground/85 transition-[width] duration-150"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          {/* 播放时间：两端对齐 */}
          <div className="mt-1.5 flex items-center justify-between pl-[58px] text-[11px] tabular-nums text-muted-foreground">
            <span>{formatDuration(isLoaded ? playPos : 0)}</span>
            <span>{formatDuration(record.duration)}</span>
          </div>
          {/* 行操作 */}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onRenameStart}
              className="flex items-center gap-1.5 rounded-full bg-white/60 px-3.5 py-1.5 text-[13px] shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition active:scale-[0.96] dark:bg-white/[0.08] dark:ring-white/[0.1]"
            >
              <Pencil className="h-3.5 w-3.5" />
              重命名
            </button>
            <button
              type="button"
              onClick={onShare}
              className="flex items-center gap-1.5 rounded-full bg-white/60 px-3.5 py-1.5 text-[13px] shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition active:scale-[0.96] dark:bg-white/[0.08] dark:ring-white/[0.1]"
            >
              <Share2 className="h-3.5 w-3.5" />
              分享
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1.5 rounded-full bg-[#FF453A]/10 px-3.5 py-1.5 text-[13px] text-[#FF453A] shadow-sm ring-1 ring-[#FF453A]/25 backdrop-blur-xl transition active:scale-[0.96] dark:bg-[#FF453A]/15 dark:ring-[#FF453A]/30"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- App ----------------

type RecStatus = 'idle' | 'recording' | 'paused';

export default function RecorderApp() {
  const [recordings, setRecordings] = useState<RecordingRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [status, setStatus] = useState<RecStatus>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  // 播放状态
  const [playId, setPlayId] = useState<string | null>(null);
  const [playActive, setPlayActive] = useState(false);
  const [playPos, setPlayPos] = useState(0);
  // #86：删除确认弹窗目标录音
  const [confirmTarget, setConfirmTarget] = useState<RecordingRecord | null>(null);

  // 录音相关 refs
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const elapsedBaseRef = useRef<number>(0);
  const runStartRef = useRef<number>(0);
  const lastSecRef = useRef<number>(-1);

  const reload = useCallback(async () => {
    const rows = await localDB.getAll('recordings');
    rows.sort((a, b) => b.createdAt - a.createdAt);
    setRecordings(rows);
  }, []);

  useEffect(() => {
    // 首次加载：在 .then 回调中 setState（避免同步 setState）
    void localDB
      .getAll('recordings')
      .then((rows) => {
        rows.sort((a, b) => b.createdAt - a.createdAt);
        setRecordings(rows);
      })
      .catch(() => undefined);
  }, []);

  const cleanupCapture = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      void ctxRef.current.close().catch(() => undefined);
    }
    ctxRef.current = null;
    analyserRef.current = null;
  }, []);

  const finalizeRecording = useCallback(
    async (mimeType: string) => {
      const chunks = chunksRef.current;
      chunksRef.current = [];
      const duration = Math.max(0, elapsedBaseRef.current);
      recRef.current = null;
      cleanupCapture();
      setStatus('idle');
      setElapsed(0);
      if (chunks.length === 0 || duration < 0.5) return;
      const blob = new Blob(chunks, { type: mimeType.includes('audio') ? mimeType : 'audio/webm' });
      const rows = await localDB.getAll('recordings');
      const record: RecordingRecord = {
        id: genId(),
        blob,
        name: nextRecordingName(rows),
        duration: Math.max(1, Math.round(duration)),
        createdAt: Date.now(),
      };
      await localDB.put('recordings', record);
      await reload();
    },
    [cleanupCapture, reload]
  );

  const stopPlaybackRow = useCallback(() => {
    stopPlayback();
    setPlayId(null);
    setPlayActive(false);
    setPlayPos(0);
  }, []);

  // ---------------- 录音控制 ----------------

  const startRecording = useCallback(async () => {
    setMicError(null);
    // 录音时先停止行内播放，避免回声
    stopPlaybackRow();
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('当前浏览器不支持录音');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        void finalizeRecording(rec.mimeType || mime || 'audio/webm');
      };
      rec.start(250);
      recRef.current = rec;

      const w = window as Window & { webkitAudioContext?: typeof AudioContext };
      const Ctor = window.AudioContext ?? w.webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        void ctx.resume().catch(() => undefined);
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        ctxRef.current = ctx;
        analyserRef.current = analyser;
      }

      elapsedBaseRef.current = 0;
      runStartRef.current = performance.now();
      lastSecRef.current = 0;
      setElapsed(0);
      setStatus('recording');
    } catch {
      setMicError('无法访问麦克风，请检查浏览器权限');
    }
  }, [finalizeRecording, stopPlaybackRow]);

  const stopRecording = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    if (status === 'recording') {
      elapsedBaseRef.current += (performance.now() - runStartRef.current) / 1000;
    }
    try {
      if (rec.state !== 'inactive') rec.stop();
    } catch {
      /* ignore */
    }
    setStatus('idle');
  }, [status]);

  const togglePause = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    if (status === 'recording') {
      try {
        rec.pause();
      } catch {
        /* ignore */
      }
      elapsedBaseRef.current += (performance.now() - runStartRef.current) / 1000;
      try {
        void ctxRef.current?.suspend().catch(() => undefined);
      } catch {
        /* ignore */
      }
      setStatus('paused');
    } else if (status === 'paused') {
      try {
        rec.resume();
      } catch {
        /* ignore */
      }
      try {
        void ctxRef.current?.resume().catch(() => undefined);
      } catch {
        /* ignore */
      }
      runStartRef.current = performance.now();
      setStatus('recording');
    }
  }, [status]);

  // ---------------- 行操作 ----------------

  const toggleExpand = useCallback((id: string) => {
    setRenamingId(null);
    setExpandedId((cur) => (cur === id ? null : id));
  }, []);

  const togglePlayRow = useCallback(
    (rec: RecordingRecord) => {
      const audio = getPlaybackAudio();
      if (playId === rec.id) {
        if (playActive) {
          audio.pause();
          setPlayActive(false);
        } else {
          // 播放到结尾后重新点击 → 从头开始
          if (audio.currentTime >= rec.duration - 0.05) {
            try {
              audio.currentTime = 0;
            } catch {
              /* ignore */
            }
          }
          audio.play().then(
            () => setPlayActive(true),
            () => setPlayActive(false)
          );
        }
        return;
      }
      // 切歌：先回收旧 ObjectURL
      stopPlayback();
      const url = URL.createObjectURL(rec.blob);
      pbUrl = url;
      audio.src = url;
      audio.onended = () => {
        setPlayId(null);
        setPlayActive(false);
        setPlayPos(0);
      };
      setPlayId(rec.id);
      setPlayPos(0);
      setPlayActive(true);
      audio.play().catch(() => setPlayActive(false));
    },
    [playActive, playId]
  );

  const commitRename = useCallback(
    async (rec: RecordingRecord, value: string) => {
      setRenamingId(null);
      const name = value.trim();
      if (!name || name === rec.name) return;
      await localDB.put('recordings', { ...rec, name });
      await reload();
    },
    [reload]
  );

  const shareRecording = useCallback(async (rec: RecordingRecord) => {
    const ext = extFromMime(rec.blob.type || 'audio/webm');
    const file = new File([rec.blob], `${rec.name}.${ext}`, { type: rec.blob.type || 'audio/webm' });
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: rec.name });
      } catch {
        /* 用户取消分享 */
      }
      return;
    }
    // 不支持 Web Share：降级为下载
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, []);

  const deleteRecording = useCallback(
    async (rec: RecordingRecord) => {
      // #86：与 photos/worldbook 同样的 iOS 风格确认弹窗（取代原 window.confirm）
      setConfirmTarget(rec);
    },
    []
  );

  const confirmDelete = useCallback(async () => {
    const rec = confirmTarget;
    if (!rec) return;
    if (playId === rec.id) stopPlaybackRow();
    try {
      await localDB.delete('recordings', rec.id);
    } catch {
      /* 忽略删除异常 */
    }
    await reload();
  }, [confirmTarget, playId, reload, stopPlaybackRow]);

  // ---------------- 波形 / 计时循环 ----------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (status === 'idle') {
      drawWave(canvas, null, false);
      return;
    }
    let raf = 0;
    const loop = () => {
      drawWave(canvasRef.current, analyserRef.current, status === 'recording');
      if (status === 'recording') {
        const total = elapsedBaseRef.current + (performance.now() - runStartRef.current) / 1000;
        const sec = Math.floor(total);
        if (sec !== lastSecRef.current) {
          lastSecRef.current = sec;
          setElapsed(sec);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  // ---------------- 播放进度循环 ----------------

  useEffect(() => {
    if (!playId || !playActive) return;
    let raf = 0;
    let last = -1;
    const loop = () => {
      const a = pbAudio;
      if (a && !a.paused) {
        const t = a.currentTime;
        if (Math.abs(t - last) > 0.05) {
          last = t;
          setPlayPos(t);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playId, playActive]);

  // ---------------- 卸载清理 ----------------

  useEffect(() => {
    return () => {
      const rec = recRef.current;
      if (rec) {
        rec.onstop = null;
        rec.ondataavailable = null;
        try {
          if (rec.state !== 'inactive') rec.stop();
        } catch {
          /* ignore */
        }
      }
      recRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (ctxRef.current && ctxRef.current.state !== 'closed') {
        void ctxRef.current.close().catch(() => undefined);
      }
      ctxRef.current = null;
      analyserRef.current = null;
      stopPlayback();
    };
  }, []);

  // ---------------- 分组 ----------------

  const groups = useMemo(() => {
    const sorted = [...recordings].sort((a, b) => b.createdAt - a.createdAt);
    const out: { label: string; items: RecordingRecord[] }[] = [];
    for (const r of sorted) {
      const label = dateGroupLabel(r.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(r);
      else out.push({ label, items: [r] });
    }
    return out;
  }, [recordings]);

  // ---------------- 渲染 ----------------

  return (
    <IOSScreen>
      <IOSNavBar inline title="语音备忘录" left={<BackToHome className="static!" />} />

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto pb-5">
        {groups.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 pb-10 text-muted-foreground">
            <AudioLines className="h-10 w-10 text-muted-foreground/50" />
            <div className="text-[15px] font-medium text-foreground">没有语音备忘录</div>
            <div className="text-[13px]">点击下方红色按钮开始录音</div>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="sticky top-0 z-10 bg-background/60 px-6 py-1.5 text-[13px] font-semibold text-muted-foreground backdrop-blur-xl">
                {group.label}
              </div>
              <div className="mx-4 divide-y divide-border/40 overflow-hidden rounded-[20px] bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
                {group.items.map((rec) => (
                  <RecordingRow
                    key={rec.id}
                    record={rec}
                    expanded={expandedId === rec.id}
                    renaming={renamingId === rec.id}
                    isLoaded={playId === rec.id}
                    isPlaying={playId === rec.id && playActive}
                    playPos={playId === rec.id ? playPos : 0}
                    onToggleExpand={() => toggleExpand(rec.id)}
                    onTogglePlay={() => togglePlayRow(rec)}
                    onRenameStart={() => setRenamingId(rec.id)}
                    onRenameCommit={(value) => void commitRename(rec, value)}
                    onShare={() => void shareRecording(rec)}
                    onDelete={() => void deleteRecording(rec)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 底部录音区：波形舞台 + 大计时 + 录音钮 */}
      <div className="shrink-0 border-t border-white/70 bg-white/60 px-6 pb-[34px] pt-3 backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.06]">
        <canvas
          ref={canvasRef}
          className="h-[72px] w-full [mask-image:linear-gradient(to_right,transparent,black_9%,black_91%,transparent)]"
          aria-hidden="true"
        />
        <div className="mt-1 flex h-[68px] flex-col items-center justify-center">
          <div
            className={`text-[52px] font-thin leading-none tabular-nums ${
              status === 'idle' ? 'text-foreground/25' : 'text-foreground'
            }`}
          >
            {mmss(elapsed)}
          </div>
          <div className="mt-1.5 flex h-4 items-center gap-1.5 text-[12px] leading-none text-muted-foreground">
            {status === 'recording' && (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF453A]" />
                <span>录音中</span>
              </>
            )}
            {status === 'paused' && <span>已暂停</span>}
            {status === 'idle' &&
              (micError ? (
                <span className="text-[#FF453A]">{micError}</span>
              ) : (
                <span>{recordings.length > 0 ? '点击一行展开播放与操作' : ''}</span>
              ))}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex h-[72px] w-[72px] items-center justify-center">
            {status !== 'idle' && (
              <button
                type="button"
                onClick={togglePause}
                aria-label={status === 'paused' ? '继续录音' : '暂停录音'}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-white/60 text-foreground shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition duration-150 active:scale-90 dark:bg-white/[0.08] dark:ring-white/[0.1]"
              >
                {status === 'paused' ? (
                  <Play className="h-5 w-5 translate-x-[1px]" fill="currentColor" />
                ) : (
                  <Pause className="h-5 w-5" fill="currentColor" />
                )}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={status === 'idle' ? () => void startRecording() : stopRecording}
            aria-label={status === 'idle' ? '开始录音' : '停止录音'}
            className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full transition-transform active:scale-95"
          >
            {status === 'recording' && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-[#FF453A]/25 [animation-duration:1.8s]"
              />
            )}
            {status === 'idle' ? (
              // 空闲：浅色模式红晕外圈（投影代替白底），深色模式保持白底红环
              <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#FF453A]/10 shadow-[0_8px_24px_rgba(255,69,58,0.3)] dark:bg-white dark:shadow-none dark:outline dark:outline-1 dark:outline-border/60">
                <span className="hidden h-[54px] w-[54px] items-center justify-center rounded-full border-[3px] border-[#FF453A] dark:flex">
                  <span className="h-[28px] w-[28px] rounded-full bg-[#FF453A]" />
                </span>
                <span className="h-[28px] w-[28px] rounded-full bg-[#FF453A] dark:hidden" />
              </span>
            ) : (
              <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#FF453A] shadow-[0_8px_24px_rgba(255,69,58,0.4)]">
                <span className="h-6 w-6 rounded-[5px] bg-white" />
              </span>
            )}
          </button>
          <div className="h-[72px] w-[72px]" />
        </div>
      </div>

      {/* #86：删除确认弹窗（iOS 风格，取代 window.confirm） */}
      {confirmTarget && (
        <ConfirmDialog
          message={`删除「${confirmTarget.name}」？此操作不可撤销。`}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </IOSScreen>
  );
}
