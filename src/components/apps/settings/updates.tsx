'use client';

// APP 更新页（v1.4.2：自动检查 + 红点 + 版本历史）。

import {
  useEffect,
  useState,
} from 'react';

import {
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

import { isNativePerception } from '@/lib/ios/native-perception';

import {
  copyApkLink,
  getApkUrl,
  launchApkDownload,
} from '@/lib/ios/apk-download';

// v1.4.2 APP 更新：自动检查 + 红点 + 版本历史
import { useAppUpdate } from '@/lib/ios/app-update';

import {
  APP_RELEASE_NOTES,
  APP_VERSION,
} from '@/lib/app-version';

import { DetailShell } from './shared';


// ---------------- APP 更新（v1.4.2：自动检查 + 红点 + 版本历史；v1.3 从感知设置提升到系统设置） ----------------

export function AppUpdatePage({ onBack }: { onBack: () => void }) {
  const nativeMode = isNativePerception();
  const [copied, setCopied] = useState(false);
  const apkUrl = getApkUrl();

  const info = useAppUpdate((s) => s.info);
  const checking = useAppUpdate((s) => s.checking);
  const error = useAppUpdate((s) => s.error);
  const hasUpdate = useAppUpdate((s) => s.hasUpdate);
  const check = useAppUpdate((s) => s.check);
  const dismiss = useAppUpdate((s) => s.dismiss);

  // 打开页面即刷新一次清单（store 内 60s 节流，手动按钮可强制重查）
  useEffect(() => {
    void check(true);
  }, [check]);

  const version = info?.version ?? APP_VERSION;
  const apkReady = info?.apkReady ?? false;
  const sizeMb = info?.apkSize ? ` · ${(info.apkSize / 1024 / 1024).toFixed(1)}MB` : '';
  /** 点下载即把指纹记为已见过（红点消；同版本不再自动弹窗） */
  const markSeen = (): void => {
    dismiss();
  };

  return (
    <DetailShell title="APP 更新" onBack={onBack} gray>
      <div className="no-scrollbar flex-1 overflow-y-auto pb-8">
        {/* 当前版本 + 检查状态卡 */}
        <div className="mx-4 mt-4 rounded-[22px] bg-white/55 p-4 text-[13px] leading-relaxed ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br from-[#34C759] to-[#248A3D] shadow-[0_6px_16px_-5px_rgba(52,199,89,0.6)]">
              <Sparkles className="h-[22px] w-[22px] text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">AI Phone v{version}{sizeMb}</p>
              {checking ? (
                <p className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />正在检查更新…
                </p>
              ) : error ? (
                <p className="mt-0.5 text-[#FF3B30]">{error}</p>
              ) : hasUpdate ? (
                <p className="mt-0.5 font-medium text-[#248A3D]">发现新版本 v{version}，下载后覆盖安装即可</p>
              ) : info ? (
                <p className="mt-0.5 text-muted-foreground">✓ 已是最新版本</p>
              ) : (
                <p className="mt-0.5 text-muted-foreground">尚未检查</p>
              )}
            </div>
            <button
              type="button"
              data-testid="appupdate-check-btn"
              onClick={() => void check(true)}
              disabled={checking}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-black/10 px-3 text-[12.5px] font-medium text-foreground/75 transition-colors active:bg-muted/50 disabled:opacity-50 dark:border-white/15"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} aria-hidden="true" />
              检查更新
            </button>
          </div>
          {!apkReady && info ? (
            <p className="mt-2.5 rounded-[10px] bg-muted/60 px-2.5 py-1.5 text-[11.5px] leading-snug text-muted-foreground">
              APK 安装包生成中，暂时无法下载——网页端功能不受影响（重进聊天页即是最新）；稍后再来检查。
            </p>
          ) : null}
        </div>

        {/* 下载区（有新版或 APK 就绪时展示主按钮） */}
        <div className="mx-4 mt-4 space-y-2">
          {nativeMode ? (
            <>
              <button
                type="button"
                data-testid="appupdate-download-btn"
                onClick={() => {
                  launchApkDownload(setCopied);
                  markSeen();
                }}
                className="block w-full rounded-full bg-[#34C759] py-2.5 text-center text-[14px] font-medium text-white transition-opacity active:opacity-70"
              >
                {copied
                  ? '✓ 下载链接已复制，等下载完从通知栏安装'
                  : hasUpdate
                    ? `立即更新 v${version}（自动复制链接）`
                    : `重新下载 v${version}（自动复制链接）`}
              </button>
              <p className="text-[12px] leading-snug text-muted-foreground">
                点按钮自动复制下载链接并尝试拉起手机浏览器（页面不会跳走）；下载完从顶部下拉通知栏点开安装，
                提示「未知应用」按系统引导允许。
              </p>
            </>
          ) : (
            <>
              <a
                href="/AI-Phone.apk"
                download
                data-testid="appupdate-download-btn"
                onClick={markSeen}
                className="block w-full rounded-full bg-[#34C759] py-2.5 text-center text-[14px] font-medium text-white transition-opacity active:opacity-70"
              >
                {hasUpdate ? `立即更新 v${version}` : `下载 v${version}（AI-Phone.apk）`}
              </a>
              <p className="text-[12px] leading-snug text-muted-foreground">
                浏览器直接下载 APK 后传到手机安装（或用手机浏览器打开本页下载）；已装旧版直接覆盖安装，数据不丢。
              </p>
            </>
          )}
          <button
            type="button"
            onClick={() => void copyApkLink(setCopied)}
            className="block w-full rounded-full border border-black/10 py-2 text-center text-[13px] font-medium text-foreground/70 transition-colors active:bg-muted/50 dark:border-white/15"
          >
            {copied ? '✓ 链接已复制' : '复制下载链接'}
          </button>
          <p className="break-all text-[10.5px] leading-snug text-muted-foreground/70">
            直链（长按可复制）：{apkUrl}
          </p>
        </div>

        {/* 版本历史 */}
        <div className="mx-4 mt-4 rounded-[22px] bg-white/55 p-4 ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <p className="text-[13px] font-medium">版本历史</p>
          <div className="mt-2 space-y-3">
            {(info?.notes ?? APP_RELEASE_NOTES).map((n, idx) => (
              <div key={n.version} className={idx === 0 ? '' : 'opacity-80'}>
                <p className="flex items-baseline gap-2">
                  <span className={`text-[12.5px] font-medium ${idx === 0 ? 'text-[#248A3D]' : ''}`}>v{n.version}</span>
                  <span className="text-[10.5px] text-muted-foreground/70">{n.date}</span>
                  {idx === 0 ? (
                    <span className="rounded-[4px] bg-[#34C759]/10 px-1.5 py-px text-[10px] font-medium text-[#248A3D]">最新</span>
                  ) : null}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {n.items.map((it, i) => (
                    <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed text-muted-foreground">
                      <span className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full bg-foreground/30" aria-hidden="true" />
                      <span className="min-w-0">{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground/70">覆盖安装、数据不丢（聊天记录都在服务器和本地存储里）。</p>
        </div>
      </div>
    </DetailShell>
  );
}
