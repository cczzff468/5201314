'use client';

/**
 * APK 下载工具（v1.3）：感知设置页与系统设置的「APP 更新」入口共用。
 *
 * 背景（用户实测教训）：<a href="intent://..."> 在旧版壳里会让 WebView 整屏变黑
 * （allowNavigation:'*' 把 intent: 也放进 WebView 自己加载，渲染失败即黑屏，页面 JS
 * 上下文被销毁只能重启 APP）。安全做法是按钮点击双保险：
 *  ① 隐形 iframe 触发 intent:// —— iframe 加载失败无害于主页面；若壳放行非主帧 intent 则拉起系统浏览器
 *  ② 直链写入剪贴板兜底 —— 用户去任意浏览器粘贴打开下载
 */

/** APK 直链（绝对地址；非浏览器环境返回相对路径） */
export function getApkUrl(): string {
  if (typeof window === 'undefined') return '/AI-Phone.apk';
  try {
    return new URL('/AI-Phone.apk', window.location.href).href;
  } catch {
    return '/AI-Phone.apk';
  }
}

/** 复制 APK 直链（keepMs = ✓ 提示保留时长） */
export async function copyApkLink(markCopied: (v: boolean) => void, keepMs = 2500): Promise<void> {
  if (typeof window === 'undefined') return;
  const url = getApkUrl();
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // WebView 剪贴板兜底：execCommand 旧接口
    try {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch {
      return;
    }
  }
  markCopied(true);
  setTimeout(() => markCopied(false), keepMs);
}

/** 主下载动作：iframe 拉起浏览器 + 复制直链兜底（壳内安全版，绝不跳走主页面） */
export function launchApkDownload(markCopied: (v: boolean) => void): void {
  if (typeof window === 'undefined') return;
  const proto = window.location.protocol.replace(':', '');
  if (proto === 'https' || proto === 'http') {
    try {
      const direct = new URL('/AI-Phone.apk', window.location.href).href;
      const intentUrl =
        `intent://${window.location.host}/AI-Phone.apk#Intent;scheme=${proto};` +
        `action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(direct)};end`;
      const f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true');
      f.title = 'apk-download-intent';
      f.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0;';
      f.src = intentUrl;
      document.body.appendChild(f);
      window.setTimeout(() => f.remove(), 4000);
    } catch {
      /* iframe 拉不起不阻断兜底 */
    }
  }
  void copyApkLink(markCopied, 10000);
}

// ---------------- v2.4.3 APP 内下载 + 安装（机主需求：更新别再跳浏览器） ----------------

export type NativeApkUpdateResult =
  /** 已开始 APP 内下载（通知栏进度条，完成后自动弹安装框） */
  | { kind: 'downloading' }
  /** 「安装未知应用」未授权：已跳系统授权页，机主允许后重试 */
  | { kind: 'need-permission' }
  /** 原生通道失败（回退 launchApkDownload 旧链路） */
  | { kind: 'fallback' };

/**
 * APP 内更新（原生壳专用）：DownloadManager 下载 → 完成自动调起系统安装器。
 * 浏览器/旧 APK 返回 fallback（调用方走旧链路：iframe intent + 复制直链）。
 */
export async function updateApkInApp(): Promise<NativeApkUpdateResult> {
  if (typeof window === 'undefined') return { kind: 'fallback' };
  try {
    const { isNativePerception, nativeDownloadAndInstallApk } = await import('./native-perception');
    if (!isNativePerception()) return { kind: 'fallback' };
    const url = getApkUrl();
    if (!/^https?:\/\//.test(url)) return { kind: 'fallback' };
    const r = await nativeDownloadAndInstallApk(url);
    if (r.ok && r.downloading) return { kind: 'downloading' };
    if (r.needPermission) return { kind: 'need-permission' };
    return { kind: 'fallback' };
  } catch {
    return { kind: 'fallback' };
  }
}

// ---------------- v2.4.4 更新进度弹窗（机主需求：「立即更新」点了要有进度可见） ----------------

/** 更新流程阶段（进度弹窗按此渲染） */
export type ApkUpdatePhase =
  /** 准备中（探测通道/发起下载） */
  | 'preparing'
  /** 下载中（percent 实时；percent<0 = 不确定进度，转圈） */
  | 'downloading'
  /** 等「安装未知应用」授权（已跳系统授权页） */
  | 'need-permission'
  /** 下载完成，安装框已弹出 */
  | 'done'
  /** 旧 APK/原生通道不可用：已交给系统下载通道 + 复制直链（弹窗展示指引） */
  | 'fallback'
  /** 下载失败（可重试） */
  | 'error';

export interface ApkUpdateState {
  phase: ApkUpdatePhase;
  /** 0-100；-1 = 不确定进度（转圈） */
  percent: number;
  bytesSoFar: number;
  totalBytes: number;
  /** 人类可读补充说明（弹窗副文案） */
  note: string;
}

/** 兜底：下载进度轮询最长 10 分钟 */
const APK_POLL_MAX_MS = 10 * 60_000;

/** MB 文案（进度弹窗「已下 x.xMB / 共 y.yMB」） */
function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 旧 APK 兜底通道：原生壳里 WebView 的 http 下载会交给 MainActivity 的
 * DownloadListener → 系统 DownloadManager（通知栏进度）。这里点一个真实
 * <a href="/AI-Phone.apk" download>（http 直链，不是 blob——blob 在 WebView
 * 里不触发 DownloadListener）+ 复制直链兜底。
 */
function triggerLegacyAnchorDownload(): void {
  try {
    const a = document.createElement('a');
    a.href = getApkUrl();
    a.download = 'AI-Phone.apk';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    /* 下载触发失败：直链已复制，指引手动下载 */
  }
}

/**
 * v2.4.4 统一「立即更新」流程（带实时进度）：
 * - 新 APK：downloadAndInstallApk（系统 DownloadManager）→ 每秒 queryLastApkDownload
 *   拉真实百分比 → 完成自动弹安装框（phase='done'）；
 * - 旧 APK（无新原生方法）：秒级回退——点 http 直链触发壳的 DownloadListener
 *   （系统下载，通知栏有进度）+ 复制直链，弹窗如实指引（phase='fallback'）；
 * - 浏览器：fetch 流式下载，真实百分比 → blob 保存（phase='done'）。
 * 返回最终状态（调用方用于收尾展示）。
 */
export async function startApkUpdate(
  onState: (s: ApkUpdateState) => void,
): Promise<ApkUpdateState> {
  const emit = (s: ApkUpdateState): void => onState(s);
  const fallbackState: ApkUpdateState = {
    phase: 'fallback',
    percent: -1,
    bytesSoFar: 0,
    totalBytes: 0,
    note: '当前 APP 版本不支持 APP 内下载：已把更新包交给系统下载（看通知栏有没有进度条），并已复制下载直链——通知栏没有的话，随便开个浏览器粘贴直链下载安装（装好这次，以后就能在 APP 内直接更新了）。',
  };

  if (typeof window === 'undefined') return fallbackState;

  // ① 浏览器：fetch 流式下载（真实百分比）→ blob 保存
  const { isNativePerception } = await import('./native-perception');
  if (!isNativePerception()) {
    try {
      emit({ phase: 'preparing', percent: -1, bytesSoFar: 0, totalBytes: 0, note: '正在连接下载…' });
      const res = await fetch(getApkUrl(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      if (!res.body) throw new Error('no-stream');
      const reader = res.body.getReader();
      const chunks: BlobPart[] = [];
      let soFar = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value as unknown as BlobPart);
          soFar += value.byteLength;
          emit({
            phase: 'downloading',
            percent: total > 0 ? Math.min(100, Math.round((soFar / total) * 100)) : -1,
            bytesSoFar: soFar,
            totalBytes: total,
            note: total > 0 ? `已下载 ${mb(soFar)} / ${mb(total)}` : `已下载 ${mb(soFar)}`,
          });
        }
      }
      const blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'AI-Phone.apk';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      const done: ApkUpdateState = {
        phase: 'done',
        percent: 100,
        bytesSoFar: blob.size,
        totalBytes: blob.size,
        note: '下载完成——浏览器已开始保存 APK，打开它覆盖安装即可（数据不丢）。',
      };
      emit(done);
      return done;
    } catch {
      // fetch 失败（如浏览器不支持流式）：退回普通直链锚点
      triggerLegacyAnchorDownload();
      const st: ApkUpdateState = {
        phase: 'done',
        percent: -1,
        bytesSoFar: 0,
        totalBytes: 0,
        note: '已开始下载 APK（浏览器下载列表可见），下载完打开覆盖安装即可。',
      };
      emit(st);
      return st;
    }
  }

  // ② 原生壳：先探测能力（旧 APK 秒级回退，不再挂 15 秒）
  emit({ phase: 'preparing', percent: -1, bytesSoFar: 0, totalBytes: 0, note: '正在发起 APP 内下载…' });
  const { nativeHasMethod, nativeDownloadAndInstallApk, nativeQueryLastApkDownload } =
    await import('./native-perception');
  if (!(await nativeHasMethod('downloadAndInstallApk'))) {
    triggerLegacyAnchorDownload();
    void copyApkLink(() => {}, 60_000);
    emit(fallbackState);
    return fallbackState;
  }
  try {
    const r = await nativeDownloadAndInstallApk(getApkUrl());
    if (r.needPermission) {
      const perm: ApkUpdateState = {
        phase: 'need-permission',
        percent: -1,
        bytesSoFar: 0,
        totalBytes: 0,
        note: '已打开「安装未知应用」授权页——请允许 AI Phone 安装应用，回来再点一次「立即更新」。',
      };
      emit(perm);
      return perm;
    }
    if (!(r.ok && r.downloading)) {
      // 授权了但启动失败：走旧通道兜底
      triggerLegacyAnchorDownload();
      void copyApkLink(() => {}, 60_000);
      emit(fallbackState);
      return fallbackState;
    }
    // ③ 每秒轮询真实进度（通知栏同款数字）
    const startAt = Date.now();
    for (;;) {
      await new Promise<void>((res) => window.setTimeout(res, 1000));
      const q = await nativeQueryLastApkDownload();
      if (q.status === 'succeeded') {
        const done: ApkUpdateState = {
          phase: 'done',
          percent: 100,
          bytesSoFar: q.totalBytes,
          totalBytes: q.totalBytes,
          note: '下载完成——安装框已自动弹出，点「安装」覆盖即可（数据不丢）。',
        };
        emit(done);
        return done;
      }
      if (q.status === 'failed' || q.status === 'none') {
        triggerLegacyAnchorDownload();
        void copyApkLink(() => {}, 60_000);
        emit(fallbackState);
        return fallbackState;
      }
      emit({
        phase: 'downloading',
        percent: q.totalBytes > 0 ? Math.min(99, Math.round((q.bytesSoFar / q.totalBytes) * 100)) : -1,
        bytesSoFar: q.bytesSoFar,
        totalBytes: q.totalBytes,
        note:
          q.totalBytes > 0
            ? `已下载 ${mb(q.bytesSoFar)} / ${mb(q.totalBytes)} · 通知栏同步可见`
            : '正在 APP 内下载（通知栏有进度），下载完自动弹出安装',
      });
      if (Date.now() - startAt > APK_POLL_MAX_MS) {
        // 10 分钟仍未完成：不再盯进度，交给通知栏
        const st: ApkUpdateState = {
          phase: 'downloading',
          percent: -1,
          bytesSoFar: q.bytesSoFar,
          totalBytes: q.totalBytes,
          note: '下载时间较长——进度在系统通知栏，下载完会自动弹出安装框，可以先关掉这个弹窗。',
        };
        emit(st);
        return st;
      }
    }
  } catch {
    triggerLegacyAnchorDownload();
    void copyApkLink(() => {}, 60_000);
    emit(fallbackState);
    return fallbackState;
  }
}
