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
