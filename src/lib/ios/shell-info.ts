'use client';

/**
 * 原生壳信息桥（v2.4.11 自诊断）。
 *
 * 背景：机主反复反馈「系统状态栏还是显示/没变化」，而 v2.4.9 起系统状态栏是原生层
 * 直接隐藏的——手机上还能看到系统状态栏（白底时间/信号那一条）只有一种解释：
 * 装的还是旧 APK（网页内容从服务器加载永远是新的，壳不会自己更新）。
 * 壳的 getShellInfo 桥（v2.4.9 壳起提供）正好是新旧壳的机器判据：
 *   - 能读到 → 新壳（系统状态栏已原生隐藏，全屏沉浸生效）
 *   - APK 里读不到 → 旧壳（所有原生层修复都不在，需下载覆盖安装）
 *   - 浏览器预览 → 同样读不到（无 AIPhoneNative），按 isNativePerception 区分。
 * 用它把「该不该重装 APK」变成设置页里一眼可见的结论，不再靠猜。
 */

/** 壳信息（与 MainActivity.NativeBridge.getShellInfo 的 JSON 字段一一对应） */
export interface ShellInfo {
  versionCode: number;
  versionName: string;
  /** 系统状态栏隐藏（全屏）标记 */
  fullscreen: boolean;
}

/** 模块级缓存：addJavascriptInterface 的同步桥每次调用结果一致，读一次即可 */
let cached: ShellInfo | null | undefined;

/** 读原生壳信息：新壳返回版本信息；旧壳/浏览器/SSR 返回 null */
export function readShellInfo(): ShellInfo | null {
  if (typeof window === 'undefined') return null; // SSR：不缓存（水合后再读）
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const nat = (
      window as unknown as { AIPhoneNative?: { getShellInfo?: () => string } }
    ).AIPhoneNative;
    if (nat && typeof nat.getShellInfo === 'function') {
      const raw = nat.getShellInfo();
      if (typeof raw === 'string' && raw) {
        const o = JSON.parse(raw) as ShellInfo;
        if (o && typeof o.versionCode === 'number' && typeof o.fullscreen === 'boolean') {
          cached = o;
        }
      }
    }
  } catch {
    /* 旧壳无桥 / 返回异常：维持 null */
  }
  return cached;
}
