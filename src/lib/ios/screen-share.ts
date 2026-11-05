'use client';

/**
 * 屏幕帧获取 + VLM 描述（感知设置 · 「让 TA 看到我的屏幕」）：
 *
 * 两条取帧路径（发送瞬间抓一帧，优先级：串流地址 > 浏览器屏幕分享）：
 *  ① 串流地址（手机场景）：用户手机跑串流 App（MJPEG/单帧 JPEG 皆可），填 http://手机IP:端口；
 *     浏览器直连失败自动回退服务端代理 /api/perception/fetch（支持 MJPEG 流切帧）；
 *  ② 浏览器屏幕分享（桌面场景零配置）：getDisplayMedia 持续流，设置页点「选择分享屏幕」授权，
 *     会话期间每次发送从流里抓当前帧（captureFrameDataUrl，同视频通话识图）。
 *
 * 帧 → VLM 描述（describeImagesAuto：用户识图配置 → 内置识图兜底）缓存 90 秒，
 * 连续快速发消息不重复识图；构建感知块时同步读缓存（runAiTurn 同步链路不能 await）。
 */

import { captureFrameDataUrl } from './camera-capture';
import { describeImagesAuto } from '@/lib/vision-client';
import { useSettings } from './store';

const DESC_CACHE_TTL = 90_000;
const GRAB_TIMEOUT = 4500;
const MAX_FRAME_BYTES = 3 * 1024 * 1024;

/** 屏幕画面描述提示词：客观简述正在用什么 App/看什么内容 */
const SCREEN_DESC_PROMPT =
  '这是用户手机/电脑屏幕此刻的截图。请用中文客观简述：用户正在用什么应用、看什么内容（80字以内，只输出描述本身，不要寒暄）。';

// ---------------- ② 浏览器屏幕分享（getDisplayMedia 持续流） ----------------

let shareStream: MediaStream | null = null;
let shareVideo: HTMLVideoElement | null = null;

/** 当前浏览器是否支持屏幕分享（桌面 Chrome/Edge 支持；多数手机浏览器不支持） */
export function isScreenShareSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/** 屏幕分享是否正在进行中 */
export function isScreenShareActive(): boolean {
  return shareStream !== null && shareStream.getVideoTracks().some((t) => t.readyState === 'live');
}

/** 开始屏幕分享（必须在用户手势中调用）：弹系统选择器，选中后保持后台流供每次发送抓帧 */
export async function startScreenShare(): Promise<boolean> {
  if (!isScreenShareSupported()) return false;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    stopScreenShare();
    shareStream = stream;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.style.position = 'fixed';
    video.style.left = '-9999px';
    video.style.width = '2px';
    document.body.appendChild(video);
    void video.play().catch(() => undefined);
    shareVideo = video;
    // 用户在浏览器原生 UI 里点「停止共享」→ 同步清理（下次发送自动降级省略）
    stream.getVideoTracks().forEach((t) => {
      t.addEventListener('ended', () => stopScreenShare());
    });
    return true;
  } catch {
    return false;
  }
}

/** 停止屏幕分享并清理隐藏 video */
export function stopScreenShare(): void {
  if (shareStream) {
    shareStream.getTracks().forEach((t) => t.stop());
    shareStream = null;
  }
  if (shareVideo) {
    shareVideo.srcObject = null;
    shareVideo.remove();
    shareVideo = null;
  }
}

/** 从分享流抓当前帧（流未就绪返回 null） */
function grabShareStreamFrame(): string | null {
  if (!isScreenShareActive() || !shareVideo) return null;
  return captureFrameDataUrl(shareVideo, 640);
}

// ---------------- ① 串流地址抓帧（MJPEG 流 / 单帧 JPEG） ----------------

/** 在已累积的字节里找第一张完整 JPEG（SOI FFD8 → EOI FFD9）；没找全返回 null */
function cutJpegFromBuffer(buf: Uint8Array): { start: number; end: number } | null {
  const soi = buf.findIndex((b, i) => b === 0xff && buf[i + 1] === 0xd8);
  if (soi < 0) return null;
  for (let i = soi + 2; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd9) return { start: soi, end: i + 2 };
  }
  return null;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('read fail'));
    fr.readAsDataURL(blob);
  });
}

/** 从一个 Response 提取 JPEG 帧：单帧图直接收；MJPEG 流读到第一帧即止 */
async function extractFrameFromResponse(res: Response, signal: AbortSignal): Promise<string | null> {
  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  if (ctype.startsWith('image/') && !ctype.includes('multipart')) {
    const blob = await res.blob();
    return blob.size > 0 && blob.size <= MAX_FRAME_BYTES ? await blobToDataUrl(blob) : null;
  }
  // MJPEG（multipart/x-mixed-replace）或未知类型：读字节流找 JPEG 帧边界
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      const merged = concatU8(chunks, total);
      const frame = cutJpegFromBuffer(merged);
      if (frame) {
        void reader.cancel().catch(() => undefined);
        if (frame.end - frame.start > MAX_FRAME_BYTES) return null;
        return await blobToDataUrl(new Blob([merged.slice(frame.start, frame.end)], { type: 'image/jpeg' }));
      }
      if (total > MAX_FRAME_BYTES * 2) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
    }
    if (signal.aborted) return null;
  }
  return null;
}

function concatU8(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** 从串流地址抓一帧（直连 → 代理回退；超时/失败返回 null） */
export async function grabStreamUrlFrame(url: string): Promise<string | null> {
  const u = url.trim();
  if (!u || !/^https?:\/\//i.test(u)) return null;
  const tryOne = async (target: string): Promise<string | null> => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), GRAB_TIMEOUT);
    try {
      const res = await fetch(target, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) return null;
      return await extractFrameFromResponse(res, ctrl.signal);
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  };
  const direct = await tryOne(u);
  if (direct) return direct;
  return await tryOne(`/api/perception/fetch?url=${encodeURIComponent(u)}`);
}

/** 抓当前屏幕帧：优先串流地址，其次屏幕分享流（都无返回 null） */
export async function grabScreenFrameDataUrl(streamUrl?: string): Promise<string | null> {
  const u = (streamUrl || '').trim();
  if (u && /^https?:\/\//i.test(u)) {
    const frame = await grabStreamUrlFrame(u);
    if (frame) return frame;
  }
  return grabShareStreamFrame();
}

// ---------------- VLM 描述（90 秒缓存 + 并发去重） ----------------

let descCache: { desc: string; ts: number; key: string } | null = null;
let descInflight: Promise<string | null> | null = null;

/** 抓帧 → VLM 描述 → 写缓存（fire-and-forget 预热用；失败静默保持旧描述） */
export async function refreshScreenDescription(streamUrl?: string): Promise<string | null> {
  const key = (streamUrl || '').trim() || 'share';
  if (descCache && descCache.key === key && Date.now() - descCache.ts < DESC_CACHE_TTL) {
    return descCache.desc;
  }
  if (descInflight) return descInflight;
  const job = (async (): Promise<string | null> => {
    const frame = await grabScreenFrameDataUrl(streamUrl);
    if (!frame) return descCache?.key === key ? descCache.desc : null;
    try {
      const desc = await describeImagesAuto(useSettings.getState().visionConfig, {
        images: [frame],
        text: SCREEN_DESC_PROMPT,
      });
      const clean = desc.trim();
      if (clean) {
        descCache = { desc: clean, ts: Date.now(), key };
        return clean;
      }
    } catch {
      /* 识图失败：保持旧缓存（可能已过期），构建块时按 TTL 判断 */
    }
    return null;
  })().finally(() => {
    descInflight = null;
  });
  descInflight = job;
  return job;
}

/** 同步读取 90 秒内的屏幕描述缓存（构建感知块时用） */
export function getCachedScreenDescription(streamUrl?: string): string | null {
  const key = (streamUrl || '').trim() || 'share';
  if (!descCache || descCache.key !== key) return null;
  if (Date.now() - descCache.ts > DESC_CACHE_TTL) return null;
  return descCache.desc;
}

/** 串流地址连通性测试（设置页用）：抓一帧成功即 ok */
export async function testStreamUrl(url: string): Promise<{ ok: boolean; detail: string }> {
  const u = url.trim();
  if (!u || !/^https?:\/\//i.test(u)) return { ok: false, detail: '地址无效：需以 http:// 或 https:// 开头' };
  const frame = await grabStreamUrlFrame(u);
  return frame
    ? { ok: true, detail: '抓帧成功，能正常取到画面' }
    : { ok: false, detail: '无法取到画面：请确认串流 App 已开启、地址可访问（内网需穿透或改用屏幕分享）' };
}
