'use client';

/**
 * APP 更新弹窗（v1.4.2）：PhoneShell 全局层，开机完成后自动检查更新。
 *
 * 触发：挂载后延迟 6s（避开开机风暴：IndexedDB 注水/调度器挂载）调
 * app-update.check(false)——有新版且 APK 在位 → promptOpen；锁屏时先不出场，
 * 解锁后再弹（弹的是「系统更新」，不该压在锁屏下面看不见）。
 *
 * 形态：iOS 系统更新 alert 风格——半透明遮罩 + 居中毛玻璃卡片：
 *  APP 图标 + 「发现新版本 vX.X.X」+ 本版更新点（滚动区）+ APK 体积 +
 *  「下次再说」（灰）/「立即更新」（绿，主按钮）。
 * 立即更新：原生壳里走 launchApkDownload（iframe intent 拉起浏览器 + 复制直链兜底，
 * 主页面绝不跳走）；浏览器里直接触发 APK 下载。两者都把指纹记为已见过。
 * 30s 无操作自动收起（同口径写 seen，本版本不再骚扰）。
 *
 * 层级 z-[92]：与通知权限卡同级——低于灵动岛通知卡（93），高于锁屏（65）。
 */

import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useAppUpdate } from '@/lib/ios/app-update';
import { launchApkDownload } from '@/lib/ios/apk-download';
import { isNativePerception } from '@/lib/ios/native-perception';
import { useUI } from '@/lib/ios/store';

/** 开机后延迟首查（避开开机风暴） */
const FIRST_CHECK_DELAY_MS = 6_000;
/** 弹窗无操作自动收起 */
const AUTO_DISMISS_MS = 30_000;

export default function AppUpdateDialog() {
  const info = useAppUpdate((s) => s.info);
  const promptOpen = useAppUpdate((s) => s.promptOpen);
  const checking = useAppUpdate((s) => s.checking);
  const dismiss = useAppUpdate((s) => s.dismiss);
  const check = useAppUpdate((s) => s.check);
  const locked = useUI((s) => s.locked);

  const [launched, setLaunched] = useState(false);
  // 「立即更新」后的收尾计时（文案展示 2.2s 再关弹窗）
  const closeTimer = useRef<number | null>(null);

  // 开机后延迟自动检查（失败静默；幂等节流在 store 内）
  useEffect(() => {
    const t = window.setTimeout(() => {
      void check(false);
    }, FIRST_CHECK_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [check]);

  // 30s 无操作自动收起（已点下载则不打断，交给收尾计时；锁屏时不出场也不收起——
  // 解锁后才重新起算，避免用户还在锁屏弹窗就悄悄过期）
  useEffect(() => {
    if (!promptOpen || launched || locked) return;
    const t = window.setTimeout(() => {
      dismiss();
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [promptOpen, launched, locked, dismiss]);

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  // 锁屏时不出场（promptOpen 保持，解锁后自然显示）
  if (!promptOpen || !info || locked) return null;

  const latest = info.notes[0];
  const sizeMb = info.apkSize ? ` · ${(info.apkSize / 1024 / 1024).toFixed(1)}MB` : '';

  const doUpdate = (): void => {
    if (isNativePerception()) {
      // 原生壳：拉起浏览器下载 + 复制直链兜底（主页面不跳走）
      launchApkDownload(() => {});
    } else {
      // 浏览器：直接触发 APK 下载
      try {
        const a = document.createElement('a');
        a.href = getApkHref();
        a.download = 'AI-Phone.apk';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch {
        /* 下载触发失败也按已处理收口 */
      }
    }
    setLaunched(true);
    // 指纹记为已见过 + 反馈文案展示片刻后收起
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      dismiss();
      setLaunched(false);
    }, 2200);
  };

  return (
    <div
      className="absolute inset-0 z-[92] flex items-center justify-center bg-black/25 px-8 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="发现新版本"
    >
      <div className="w-full max-w-[300px] rounded-[22px] border border-border/60 bg-card/95 p-5 text-center shadow-[0_20px_50px_-12px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        {/* APP 图标 + 标题 */}
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[16px] bg-gradient-to-br from-[#34C759] to-[#248A3D] shadow-[0_8px_20px_-6px_rgba(52,199,89,0.6)]">
          <Sparkles className="h-7 w-7 text-white" aria-hidden="true" />
        </div>
        <p className="mt-3 text-[16px] font-semibold leading-6">发现新版本</p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          AI Phone v{info.version}
          {sizeMb}
        </p>

        {/* 本版更新点（长列表滚动） */}
        {latest && (
          <div className="no-scrollbar mt-3 max-h-[168px] overflow-y-auto rounded-[12px] bg-muted/50 px-3 py-2.5 text-left">
            <p className="text-[11px] font-medium text-muted-foreground">v{latest.version} 更新内容</p>
            <ul className="mt-1 space-y-1">
              {latest.items.map((it, i) => (
                <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed">
                  <span className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full bg-[#34C759]" aria-hidden="true" />
                  <span className="min-w-0">{it}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-2 text-[10.5px] text-muted-foreground/70">覆盖安装、数据不丢 · 完整版本历史见 设置 › APP 更新</p>

        {/* 按钮 */}
        {launched ? (
          <p className="mt-4 rounded-full bg-[#34C759]/10 py-2.5 text-[13px] font-medium text-[#248A3D]">
            ✓ {isNativePerception() ? '已复制链接并拉起浏览器，下载完从通知栏安装' : '开始下载 APK'}
          </p>
        ) : (
          <div className="mt-4 flex items-center gap-2.5">
            <button
              type="button"
              onClick={dismiss}
              className="h-10 flex-1 rounded-full border border-black/10 text-[14px] text-muted-foreground transition-colors active:bg-muted/60 dark:border-white/15"
            >
              下次再说
            </button>
            <button
              type="button"
              data-testid="appupdate-dialog-btn"
              onClick={doUpdate}
              className="h-10 flex-1 rounded-full bg-[#34C759] text-[14px] font-medium text-white transition-opacity active:opacity-70"
            >
              立即更新
            </button>
          </div>
        )}
      </div>
      {/* 隐藏计时态不需要额外 UI；checking 状态不在此弹窗展示（自动检查静默） */}
      <span className="sr-only" aria-live="polite">
        {checking ? '正在检查更新' : ''}
      </span>
    </div>
  );
}

/** APK 直链（与 apk-download.getApkUrl 同源逻辑；弹窗内独立取，避免额外 hook 约束） */
function getApkHref(): string {
  try {
    return new URL('/AI-Phone.apk', window.location.href).href;
  } catch {
    return '/AI-Phone.apk';
  }
}
