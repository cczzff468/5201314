'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  CameraOff,
  Grid3X3,
  Image as ImageIcon,
  SlidersHorizontal,
  SwitchCamera,
  Timer,
  X,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { genId, localDB, type PhotoRecord } from '@/lib/ios/db';
import { useUI } from '@/lib/ios/store';
import { BackToHome } from '@/components/ios/BackToHome';

interface CameraFilter {
  name: string;
  /** CSS filter 值，'none' 表示原图 */
  css: string;
  /** 滤镜选择条上的圆形色块 */
  swatch: string;
}

const FILTERS: CameraFilter[] = [
  { name: '原图', css: 'none', swatch: 'linear-gradient(135deg, #e5e5e5, #8a8a8a)' },
  { name: '反差色', css: 'contrast(1.35) saturate(0.9)', swatch: 'linear-gradient(135deg, #fafafa, #1c1c1c)' },
  { name: '鲜暖色', css: 'saturate(1.45) sepia(0.18)', swatch: 'linear-gradient(135deg, #ffd8a8, #c2703d)' },
  { name: '鲜冷色', css: 'saturate(1.3) hue-rotate(-10deg) brightness(1.06)', swatch: 'linear-gradient(135deg, #cdd6dd, #5b6a75)' },
  { name: '单色', css: 'grayscale(1)', swatch: 'linear-gradient(135deg, #ffffff, #0a0a0a)' },
];

type CameraStatus = 'loading' | 'ready' | 'error';

/** 拍摄画幅：保存时按比例中心裁剪 */
type Aspect = '4:3' | '1:1' | '16:9';
const ASPECT_RATIO: Record<Aspect, number> = { '4:3': 4 / 3, '1:1': 1, '16:9': 16 / 9 };
/** 倒计时档位（0=关） */
type TimerSec = 0 | 3 | 10;

/** 环境探测订阅（环境不会变化，无需真实订阅） */
function subscribeNoop(): () => void {
  return () => undefined;
}

/** 生成 iOS 风格照片文件名：IMG_20251228_154530.jpg */
function makePhotoName(): string {
  const d = new Date();
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `IMG_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}.jpg`;
}

// ---------------- 拍照滤镜能力检测（Safari/iOS 的 Canvas2D filter 长期不支持） ----------------

let filterSupportCache: boolean | null = null;

/**
 * 实测当前环境 Canvas 2D 是否真正支持 filter 合成：
 * Safari/iOS 的 ctx.filter 属性存在但为空实现（画了等于没画），仅 `'filter' in ctx` 判不出来，
 * 因此画一次 1×1 红色像素 + grayscale 滤镜自绘后对比像素值（支持时红≈(54,54,54)，
 * 未生效仍是纯红 (255,0,0)）。结果按页缓存，整个生命周期只测一次（1×1 画布开销可忽略）。
 */
function detectCanvasFilterSupport(): boolean {
  if (filterSupportCache !== null) return filterSupportCache;
  filterSupportCache = false;
  try {
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = 1;
    srcCanvas.height = 1;
    const src = srcCanvas.getContext('2d');
    if (!src || !('filter' in src)) return filterSupportCache;
    src.fillStyle = '#ff0000';
    src.fillRect(0, 0, 1, 1);
    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = 1;
    dstCanvas.height = 1;
    const dst = dstCanvas.getContext('2d');
    if (!dst) return filterSupportCache;
    dst.filter = 'grayscale(1)';
    dst.drawImage(srcCanvas, 0, 0);
    const r = dst.getImageData(0, 0, 1, 1).data[0];
    filterSupportCache = r < 200; // 灰化生效 R≈54；空实现 R=255
  } catch {
    filterSupportCache = false;
  }
  return filterSupportCache;
}

/**
 * 相机 App：getUserMedia 取景 + 滤镜 + 拍照存入图库。
 * - onExit：覆盖返回键行为（锁屏直达相机时传「回锁屏」回调）；不传时默认 closeApp 回主屏幕；
 * - hideGallery：隐藏最近照片入口（iOS 锁屏相机不暴露相册，防止不解锁浏览照片）。
 */
export default function CameraApp({
  onExit,
  hideGallery = false,
}: {
  onExit?: () => void;
  hideGallery?: boolean;
} = {}) {
  const [status, setStatus] = useState<CameraStatus>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [retryCount, setRetryCount] = useState(0);
  const [flashOn, setFlashOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterIndex, setFilterIndex] = useState(0);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbKey, setThumbKey] = useState(0);
  const [flashVisible, setFlashVisible] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg] = useState('已存储到图库');
  // 拍照滤镜是否真正可用（一次性实测；Safari 等不支持时取景器预览仍有 CSS 滤镜，但存照为原图，需明确提示）
  const [filterSupported] = useState(detectCanvasFilterSupport);
  // —— 新增功能状态 ——
  const [gridOn, setGridOn] = useState(false);
  const [timerSec, setTimerSec] = useState<TimerSec>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [aspect, setAspect] = useState<Aspect>('4:3');
  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number }>({ min: 1, max: 1 });
  const [zoom, setZoom] = useState(1);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const torchActiveRef = useRef(false);
  const thumbUrlRef = useRef<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // 是否支持 getUserMedia（非 HTTPS / 不支持的浏览器）：useSyncExternalStore 保证 SSR 安全
  const envUnsupported = useSyncExternalStore(
    subscribeNoop,
    () => typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia,
    () => false
  );

  // 启动/切换镜头：停止旧轨道后重新 getUserMedia（setState 均在 await 之后）
  useEffect(() => {
    if (envUnsupported) return;
    let cancelled = false;

    const start = async (): Promise<void> => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        torchActiveRef.current = false;

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          try {
            await video.play();
          } catch {
            // 自动播放被拦截时忽略，画面会随流就绪显示
          }
        }

        const track = stream.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() as
          | (MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number } })
          | undefined;
        if (cancelled) return;
        setTorchSupported(Boolean(caps?.torch));
        // 硬件变焦：仅当轨道声明了可用范围时展示变焦药丸（重开流后重置为 1×）
        if (caps?.zoom && caps.zoom.max > caps.zoom.min) {
          setZoomRange({ min: caps.zoom.min, max: caps.zoom.max });
          setZoomSupported(true);
        } else {
          setZoomSupported(false);
        }
        setZoom(1);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : '';
        setErrMsg(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? '相机权限被拒绝，请在浏览器中允许摄像头访问后重试'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? '未检测到可用的摄像头设备'
              : '相机启动失败，请重试'
        );
        setStatus('error');
      }
    };

    void start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [envUnsupported, facing, retryCount]);

  // 最近一张照片缩略图（await 之后再 setState）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const all = await localDB.getAll('photos');
      if (cancelled) return;
      let last: PhotoRecord | null = null;
      for (const p of all) {
        if (!last || p.createdAt > last.createdAt) last = p;
      }
      const url = last ? URL.createObjectURL(last.blob) : null;
      if (thumbUrlRef.current) URL.revokeObjectURL(thumbUrlRef.current);
      thumbUrlRef.current = url;
      setThumbUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [thumbKey]);

  // 卸载清理：定时器 + 缩略图 ObjectURL（轨道由相机 effect 的 cleanup 停止）
  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      if (thumbUrlRef.current) URL.revokeObjectURL(thumbUrlRef.current);
    };
  }, []);

  // ---------------- 交互 ----------------

  const toggleFacing = () => {
    setStatus('loading');
    setFacing((f) => (f === 'environment' ? 'user' : 'environment'));
  };

  /** 闪光灯：优先真实 torch，失败静默回退为截图白屏模拟 */
  const toggleFlash = () => {
    const next = !flashOn;
    setFlashOn(next);
    if (!torchSupported) return;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const constraints = { advanced: [{ torch: next }] } as unknown as MediaTrackConstraints;
    track
      .applyConstraints(constraints)
      .then(() => {
        torchActiveRef.current = next;
      })
      .catch(() => {
        torchActiveRef.current = false;
      });
  };

  /** 白色全屏闪烁（快门动画 / 闪光灯模拟） */
  const showFlash = useCallback((ms: number) => {
    setFlashVisible(true);
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlashVisible(false), ms);
  }, []);

  const showToastHint = useCallback((msg: string = '已存储到图库') => {
    setToastMsg(msg);
    setToastVisible(true);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastVisible(false), 2200);
  }, []);

  /** 拍照：canvas 同步滤镜+画幅裁剪 → JPEG → 存入图库 → 震动/闪灯 → 刷新缩略图 */
  const handleCapture = useCallback(async (): Promise<void> => {
    const video = videoRef.current;
    if (!video || status !== 'ready' || !streamRef.current || video.readyState < 2) return;

    showFlash(flashOn && !torchActiveRef.current ? 300 : 150);
    navigator.vibrate?.(15);

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    // 画幅裁剪：按所选比例在原始帧中心取景（4:3 为原生比例时即原图）
    const ratio = ASPECT_RATIO[aspect];
    let sw = vw;
    let sh = vh;
    if (vw / vh > ratio + 0.01) sw = Math.round(vh * ratio);
    else if (vw / vh < ratio - 0.01) sh = Math.round(vw / ratio);
    const sx = Math.round((vw - sw) / 2);
    const sy = Math.round((vh - sh) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const css = FILTERS[filterIndex].css;
    // Safari/iOS 的 Canvas2D filter 属性存在但空实现：不支持时跳过设置（存原图属预期，快门后有 toast 提示）
    if (css !== 'none' && filterSupported) ctx.filter = css;
    // 前摄：预览是镜像的，保存的照片同步镜像，与取景器所见一致（修复“翻转拍照画面反了”）
    if (facing === 'user') {
      ctx.translate(sw, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    );
    if (!blob) return;
    await localDB.put('photos', { id: genId(), blob, name: makePhotoName(), createdAt: Date.now() });

    setThumbKey((k) => k + 1);
    showToastHint(
      filterIndex > 0 && !filterSupported
        ? '已存储到图库（当前浏览器不支持滤镜，照片为原图）'
        : '已存储到图库'
    );
  }, [aspect, facing, filterIndex, filterSupported, flashOn, showToastHint, showFlash, status]);

  // 倒计时拍摄：每秒递减，到 0 自动快门（点击取景器任意处可取消）
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      const t = window.setTimeout(() => {
        setCountdown(null);
        void handleCapture();
      }, 320);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => {
      try {
        navigator.vibrate?.(40);
      } catch {
        /* 震动不可用 */
      }
      setCountdown((c) => (c === null ? null : c - 1));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [countdown, handleCapture]);

  /** 快门：倒计时进行中点击=取消；有定时档先倒计时；否则直接拍 */
  const onShutter = () => {
    if (status !== 'ready') return;
    if (countdown !== null) {
      setCountdown(null);
      return;
    }
    if (timerSec > 0) {
      setCountdown(timerSec);
      return;
    }
    void handleCapture();
  };

  /** 硬件变焦（不支持时入口不渲染） */
  const applyZoom = (z: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const target = Math.min(zoomRange.max, Math.max(zoomRange.min, z));
    track
      .applyConstraints({ advanced: [{ zoom: target }] } as unknown as MediaTrackConstraints)
      .then(() => setZoom(target))
      .catch(() => {
        /* 变焦失败保持原状 */
      });
  };

  /** 变焦档位：按轨道能力范围生成（0.5×/1×/2×/3×/5× 中的可用档） */
  const zoomOptions = (() => {
    if (!zoomSupported) return [] as number[];
    const steps = [0.5, 1, 2, 3, 5];
    const opts = steps.filter((z) => z <= zoomRange.max && z >= zoomRange.min);
    if (opts.length === 0) opts.push(Math.min(zoomRange.max, Math.max(zoomRange.min, 1)));
    return opts;
  })();

  // ---------------- 渲染 ----------------

  const filter = FILTERS[filterIndex];
  const showError = envUnsupported || status === 'error';

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-black text-white">
      {/* 取景器：前摄像头镜像显示（与真机 iOS 一致，拍照同步镜像保证所见即所得） */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
        style={{ filter: filter.css, transform: facing === 'user' ? 'scaleX(-1)' : undefined }}
      />

      {/* 三分构图网格线 */}
      {gridOn && status === 'ready' && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[5]">
          <div className="absolute left-1/3 top-0 h-full w-px bg-white/30" />
          <div className="absolute left-2/3 top-0 h-full w-px bg-white/30" />
          <div className="absolute left-0 top-1/3 h-px w-full bg-white/30" />
          <div className="absolute left-0 top-2/3 h-px w-full bg-white/30" />
        </div>
      )}

      {/* 顶部/底部新变遮罩：提高控制键与状态栏可读性 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-28 bg-gradient-to-b from-black/55 to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-44 bg-gradient-to-t from-black/60 to-transparent" />

      {/* 顶部控制条（状态栏之下；z-30 保证错误遮罩之上返回键仍可点） */}
      <div className="relative z-30 shrink-0 pt-[54px]">
        <div className="flex h-11 items-center justify-between px-4">
          <BackToHome light onClick={onExit} className="static! shrink-0" />
          {/* 闪光灯 */}
          <button
            type="button"
            aria-label={flashOn ? '关闭闪光灯' : '开启闪光灯'}
            aria-pressed={flashOn}
            onClick={toggleFlash}
            className={`flex h-10 w-10 items-center justify-center rounded-full ring-1 backdrop-blur-2xl transition active:opacity-60 ${
              flashOn ? 'bg-white/25 ring-white/[0.28]' : 'bg-white/[0.10] ring-white/[0.14]'
            }`}
          >
            <Zap className="h-[22px] w-[22px]" fill={flashOn ? 'currentColor' : 'none'} />
          </button>
          {/* 构图网格 */}
          <button
            type="button"
            aria-label={gridOn ? '关闭网格线' : '开启网格线'}
            aria-pressed={gridOn}
            onClick={() => setGridOn((v) => !v)}
            className={`flex h-10 w-10 items-center justify-center rounded-full ring-1 backdrop-blur-2xl transition active:opacity-60 ${
              gridOn ? 'bg-white/25 ring-white/[0.28]' : 'bg-white/[0.10] ring-white/[0.14]'
            }`}
          >
            <Grid3X3 className="h-[21px] w-[21px]" />
          </button>
          {/* 倒计时定时：关 → 3s → 10s */}
          <button
            type="button"
            aria-label={timerSec > 0 ? `定时拍摄${timerSec}秒，点击关闭` : '开启定时拍摄'}
            aria-pressed={timerSec > 0}
            onClick={() => setTimerSec((s) => (s === 0 ? 3 : s === 3 ? 10 : 0))}
            className={`flex h-10 w-10 items-center justify-center rounded-full ring-1 backdrop-blur-2xl transition active:opacity-60 ${
              timerSec > 0 ? 'bg-white/25 ring-white/[0.28]' : 'bg-white/[0.10] ring-white/[0.14]'
            }`}
          >
            {timerSec > 0 ? (
              <span className="text-[13px] font-semibold tabular-nums">{timerSec}s</span>
            ) : (
              <Timer className="h-[21px] w-[21px]" />
            )}
          </button>
          {/* 画幅：4:3 → 1:1 → 16:9 */}
          <button
            type="button"
            aria-label={`拍摄画幅${aspect}，点击切换`}
            onClick={() => setAspect((a) => (a === '4:3' ? '1:1' : a === '1:1' ? '16:9' : '4:3'))}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.10] ring-1 ring-white/[0.14] backdrop-blur-2xl transition active:opacity-60"
          >
            <span className="text-[12px] font-semibold leading-none">{aspect}</span>
          </button>
          {/* 滤镜 */}
          <button
            type="button"
            aria-label={filtersOpen ? '收起滤镜' : '展开滤镜'}
            aria-pressed={filtersOpen}
            onClick={() => setFiltersOpen((v) => !v)}
            className={`flex h-10 w-10 items-center justify-center rounded-full ring-1 backdrop-blur-2xl transition active:opacity-60 ${
              filtersOpen ? 'bg-white/25 ring-white/[0.28]' : 'bg-white/[0.10] ring-white/[0.14]'
            }`}
          >
            <SlidersHorizontal className="h-[22px] w-[22px]" />
          </button>
        </div>
      </div>

      {/* 中部取景区占位 */}
      <div className="relative flex-1" />

      {/* 滤镜条（快门区上方，横向滚动） */}
      {filtersOpen && (
        <div className="relative z-10 shrink-0 pb-3">
          <div className="no-scrollbar flex gap-4 overflow-x-auto px-5" role="listbox" aria-label="选择滤镜">
            {FILTERS.map((f, i) => (
              <button
                key={f.name}
                type="button"
                role="option"
                aria-selected={i === filterIndex}
                onClick={() => setFilterIndex(i)}
                className="flex shrink-0 flex-col items-center gap-1.5 transition active:opacity-70"
              >
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-full ${
                    i === filterIndex ? 'ring-2 ring-white' : 'ring-1 ring-white/30'
                  }`}
                  style={{ backgroundImage: f.swatch }}
                  aria-hidden="true"
                />
                <span className={`text-[11px] ${i === filterIndex ? 'text-white' : 'text-white/70'}`}>
                  {f.name}
                </span>
              </button>
            ))}
          </div>
          {/* 滤镜合成不支持的环境（如 Safari/iOS）：取景器预览仍有滤镜，但保存的照片为原图，需提前说明 */}
          {!filterSupported && (
            <p className="px-5 pt-2 text-center text-[11px] leading-4 text-white/55">
              当前浏览器不支持拍摄滤镜，保存的照片将为原图
            </p>
          )}
        </div>
      )}

      {/* 底部控制（高度 110px + pb 避开 Home 热区） */}
      <div className="relative z-10 shrink-0 pb-[42px]">
        {/* 硬件变焦药丸（轨道支持时展示） */}
        {zoomSupported && zoomOptions.length > 0 && (
          <div className="mb-2.5 flex items-center justify-center gap-1.5" role="group" aria-label="变焦">
            {zoomOptions.map((z) => {
              const active = Math.abs(zoom - z) < 0.05;
              return (
                <button
                  key={z}
                  type="button"
                  aria-pressed={active}
                  aria-label={`变焦${z}倍`}
                  onClick={() => applyZoom(z)}
                  className={`flex h-8 min-w-[34px] items-center justify-center rounded-full px-1.5 text-[13px] font-semibold tabular-nums ring-1 backdrop-blur-2xl transition ${
                    active
                      ? 'bg-white/30 text-white ring-white/[0.28]'
                      : 'bg-white/[0.10] text-white/65 ring-white/[0.14] active:bg-white/[0.18]'
                  }`}
                >
                  {Number.isInteger(z) ? `${z}×` : `${z.toFixed(1)}×`}
                </button>
              );
            })}
          </div>
        )}
        {/* 当前滤镜提示（点击回原图） */}
        {filterIndex > 0 && status === 'ready' && (
          <div className="mb-2.5 flex justify-center">
            <button
              type="button"
              aria-label={`当前滤镜${filter.name}，点击恢复原图`}
              onClick={() => setFilterIndex(0)}
              className="flex h-7 items-center gap-1 rounded-full bg-white/[0.10] px-3 text-[12px] text-white ring-1 ring-white/[0.14] backdrop-blur-2xl transition active:opacity-60"
            >
              {filter.name}
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="flex h-[110px] items-center justify-between px-8">
          {/* 最近照片缩略图 → 打开相册（锁屏直达模式下隐藏，不解锁不暴露相册） */}
          {hideGallery ? (
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.10] ring-1 ring-white/[0.14] backdrop-blur-2xl"
            >
              <ImageIcon className="h-5 w-5 text-white/25" />
            </span>
          ) : (
            <button
              type="button"
              aria-label="打开相册"
              onClick={() => useUI.getState().openApp('photos')}
              className="h-11 w-11 shrink-0 overflow-hidden rounded-[10px] bg-white/[0.10] ring-1 ring-white/[0.14] backdrop-blur-2xl transition active:opacity-70"
            >
              {thumbUrl ? (
                <img
                  src={thumbUrl}
                  alt="最近一张照片"
                  draggable={false}
                  className="h-full w-full select-none object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-white/40">
                  <ImageIcon className="h-5 w-5" aria-hidden="true" />
                </span>
              )}
            </button>
          )}

          {/* 大快门 */}
          <button
            type="button"
            aria-label={countdown !== null ? '取消倒计时' : '拍照'}
            disabled={status !== 'ready'}
            onClick={onShutter}
            className="group flex h-[68px] w-[68px] items-center justify-center rounded-full border-[3px] border-white transition active:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span
              className={`h-14 w-14 rounded-full bg-white shadow-[inset_0_-2px_6px_rgba(0,0,0,0.10)] transition-transform duration-100 ${
                countdown !== null ? 'scale-75 bg-white/60' : 'group-active:scale-90'
              }`}
            />
          </button>

          {/* 切换镜头 */}
          <button
            type="button"
            aria-label="切换前后摄像头"
            onClick={toggleFacing}
            disabled={status === 'loading'}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/[0.14] backdrop-blur-2xl transition active:opacity-60 disabled:opacity-40"
          >
            <SwitchCamera className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* 启动中 */}
      {status === 'loading' && !showError && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" role="status" aria-label="相机启动中" />
        </div>
      )}

      {/* 权限被拒 / 无摄像头 / 非安全上下文 */}
      {showError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black px-10 text-center">
          <CameraOff className="h-11 w-11 text-white/35" aria-hidden="true" />
          <p className="mt-1 text-[16px] font-semibold">{envUnsupported ? '无法访问相机' : '相机不可用'}</p>
          <p className="text-[13px] leading-relaxed text-white/55">
            {envUnsupported
              ? '当前环境不支持摄像头（需要 HTTPS 与浏览器授权），请检查后重试'
              : errMsg || '相机启动失败，请重试'}
          </p>
          <button
            type="button"
            onClick={() => {
              setStatus('loading');
              setRetryCount((c) => c + 1);
            }}
            className="mt-3 rounded-full bg-white/[0.10] px-6 py-2 text-[15px] ring-1 ring-white/[0.14] backdrop-blur-2xl transition active:opacity-60"
          >
            重试
          </button>
        </div>
      )}

      {/* 已存储提示 */}
      {toastVisible && (
        <div
          className="pointer-events-none absolute left-1/2 top-[116px] z-30 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-[13px] text-white ring-1 ring-white/[0.14] backdrop-blur-xl"
          role="status"
        >
          {toastMsg}
        </div>
      )}

      {/* 倒计时：全屏点击取消，数字缩放入场 */}
      {countdown !== null && (
        <button
          type="button"
          aria-label={`取消${timerSec}秒倒计时`}
          onClick={() => setCountdown(null)}
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/20"
        >
          {countdown > 0 && (
            <motion.span
              key={countdown}
              initial={{ scale: 1.55, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.32, ease: 'easeOut' }}
              className="text-[112px] font-thin leading-none text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.5)]"
            >
              {countdown}
            </motion.span>
          )}
        </button>
      )}

      {/* 快门 / 闪光白屏 */}
      <div
        className={`pointer-events-none absolute inset-0 z-40 bg-white transition-opacity ${
          flashVisible ? 'opacity-100 duration-75' : 'opacity-0 duration-300'
        }`}
        aria-hidden="true"
      />
    </div>
  );
}
