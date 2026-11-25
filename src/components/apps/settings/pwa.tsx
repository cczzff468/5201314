'use client';

// 添加到主屏幕（v1.9.22：PWA 安装引导 + 离线能力管理）。

import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  CheckCircle2,
  Download,
  Loader2,
  Monitor,
  RefreshCw,
  Share,
  Smartphone,
  Trash2,
  WifiOff,
  Wrench,
} from 'lucide-react';

import { useToast } from '@/hooks/use-toast';

import { APP_VERSION } from '@/lib/app-version';

import {
  GroupCard,
  TONE_ORANGE,
  TONE_GREEN,
  TONE_GRAY,
  TONE_PINK,
  DetailShell,
  SectionLabel,
} from './shared';

import { AboutRow } from './profile';

import { formatBytes } from './storage';


// ---------------- 添加到主屏幕（v1.9.22：PWA 安装引导 + 离线能力管理） ----------------

/** beforeinstallprompt 事件最小形状（TS lib.dom 未内置；实例由 layout 内联脚本捕获存到 window.__pwaInstallEvt） */
export type PwaInstallEvt = {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/** 读内联脚本捕获的安装事件（Chrome/Edge 在 React 挂载前就可能派发过） */
export function getPwaInstallEvt(): PwaInstallEvt | null {
  if (typeof window === 'undefined') return null;
  return (window as typeof window & { __pwaInstallEvt?: PwaInstallEvt }).__pwaInstallEvt ?? null;
}

/** 离线缓存（Cache Storage）统计：条目数 + 近似占用（content-length 求和）+ 壳是否就绪 */
export async function measureOfflineCaches(): Promise<{
  entries: number;
  bytes: number;
  shellReady: boolean;
} | null> {
  try {
    if (typeof window === 'undefined' || typeof caches === 'undefined') return null;
    const keys = await caches.keys();
    let entries = 0;
    let bytes = 0;
    let shellReady = false;
    const shellUrl = window.location.origin + '/';
    for (const k of keys) {
      const c = await caches.open(k);
      const reqs = await c.keys();
      entries += reqs.length;
      for (const r of reqs) {
        if (r.url === shellUrl) shellReady = true;
        const res = await c.match(r).catch(() => null);
        if (!res) continue;
        const len = Number(res.headers.get('content-length'));
        if (Number.isFinite(len)) bytes += len;
      }
    }
    return { entries, bytes, shellReady };
  } catch {
    return null;
  }
}

/** 设置 › 添加到主屏幕：安装引导（Android 一键安装 / iOS 分步指引）+ 离线壳状态/管理 + 检查更新 */
export function PwaInstallPage({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const [installEvt, setInstallEvt] = useState<PwaInstallEvt | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [iosSafari, setIosSafari] = useState(false);
  const [swActive, setSwActive] = useState<boolean | null>(null);
  const [online, setOnline] = useState(true);
  const [stats, setStats] = useState<{ entries: number; bytes: number; shellReady: boolean } | null>(null);
  const [busy, setBusy] = useState<'install' | 'clear' | 'update' | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refreshStats = useCallback(async () => {
    setStats(await measureOfflineCaches());
  }, []);

  useEffect(() => {
    const readEnv = () => {
      setStandalone(
        (window.matchMedia?.('(display-mode: standalone)').matches ?? false) ||
          (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
      );
      const ua = window.navigator.userAgent;
      setIosSafari(
        (/iphone|ipad|ipod/i.test(ua) ||
          (window.navigator.platform === 'MacIntel' && (window.navigator.maxTouchPoints ?? 0) > 1)) &&
          /safari/i.test(ua),
      );
      setInstallEvt(getPwaInstallEvt());
      setOnline(window.navigator.onLine);
    };
    // 环境读取与缓存统计都含 setState，推迟到宏任务回调里执行（避免 effect 体内同步 setState 的级联渲染）
    const t = window.setTimeout(() => {
      readEnv();
      void refreshStats();
    }, 0);
    const onInstallable = () => setInstallEvt(getPwaInstallEvt());
    const onInstalledEvt = () => setInstallEvt(null);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('pwa-installable', onInstallable);
    window.addEventListener('pwa-installed', onInstalledEvt);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    void (async () => {
      try {
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          setSwActive(!!reg?.active);
        } else {
          setSwActive(false);
        }
      } catch {
        setSwActive(false);
      }
    })();
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pwa-installable', onInstallable);
      window.removeEventListener('pwa-installed', onInstalledEvt);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refreshStats]);

  /** Android/Chrome：调起浏览器原生安装弹窗（事件一次性，用后即清） */
  const doInstall = async () => {
    const evt = installEvt ?? getPwaInstallEvt();
    if (!evt) {
      toast({ title: '安装暂不可用', description: '多浏览一会页面后再来，或用浏览器菜单里的「安装应用」' });
      return;
    }
    setBusy('install');
    try {
      await evt.prompt();
      const choice = await evt.userChoice;
      if (choice.outcome === 'accepted') {
        toast({ title: '🎉 已安装到主屏幕', description: '从主屏幕图标打开即可全屏使用' });
      }
    } catch {
      toast({ title: '安装已取消' });
    } finally {
      (window as typeof window & { __pwaInstallEvt?: PwaInstallEvt | null }).__pwaInstallEvt = null;
      setInstallEvt(null);
      setBusy(null);
    }
  };

  /** 清空离线缓存（不动 Service Worker 注册：推送通知不受影响；下次在线访问自动重建） */
  const doClearCache = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      window.setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    setConfirmClear(false);
    setBusy('clear');
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await refreshStats();
      toast({ title: '离线缓存已清除', description: '下次在线打开页面时会自动重建' });
    } catch {
      toast({ title: '清除失败', description: '当前浏览器不允许清理缓存' });
    } finally {
      setBusy(null);
    }
  };

  /** 检查 SW 更新（新 SW 已 skipWaiting 即刻接管；正在跑的页面需刷新才用上新资源） */
  const doCheckUpdate = async () => {
    if (!('serviceWorker' in navigator)) return;
    setBusy('update');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        toast({ title: '当前环境不支持离线能力' });
        return;
      }
      await reg.update();
      await new Promise((r) => window.setTimeout(r, 600));
      if (reg.waiting) {
        toast({ title: '发现新版本', description: '刷新页面后生效' });
      } else {
        toast({ title: '✓ 已是最新版本', description: `当前 v${APP_VERSION}` });
      }
    } catch {
      toast({ title: '检查更新失败', description: '请稍后再试' });
    } finally {
      setBusy(null);
    }
  };

  const pillBtn =
    'inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-[14px] font-medium ring-1 backdrop-blur-xl transition-all active:scale-[0.96] disabled:opacity-50';

  return (
    <DetailShell title="添加到主屏幕" onBack={onBack} gray>
      {/* 当前状态 */}
      <SectionLabel icon={Smartphone} tone={TONE_PINK}>
        当前状态
      </SectionLabel>
      <GroupCard>
        <AboutRow
          label="运行环境"
          value={standalone ? '✓ 已安装 · 独立窗口' : '浏览器标签页'}
        />
        <AboutRow
          label="离线能力"
          value={
            swActive === null
              ? '检测中…'
              : swActive
                ? stats?.shellReady
                  ? '✓ 就绪 · 断网可打开'
                  : '就绪中 · 下次在线访问后生效'
                : '当前环境不支持（需 HTTPS）'
          }
        />
        <AboutRow label="离线缓存" value={
          stats === null ? '—' : `约 ${formatBytes(stats.bytes)} · ${stats.entries} 项`
        } />
        <AboutRow label="网络" value={online ? '在线' : '已断开'} />
      </GroupCard>

      {/* 安装引导 */}
      <div className="mt-5" />
      <SectionLabel icon={Share} tone={TONE_GREEN}>
        安装到手机桌面
      </SectionLabel>
      {standalone ? (
        <GroupCard>
          <div className="flex items-start gap-3 px-4 py-3.5">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-[#34C759]" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-[15.5px] font-medium">已安装，正在独立窗口运行</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                像真 App 一样全屏、无浏览器地址栏；断网也能打开，聊天记录与照片一直在本机。
              </p>
            </div>
          </div>
        </GroupCard>
      ) : installEvt ? (
        <GroupCard>
          <div className="px-4 py-4">
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              安装后从主屏幕图标打开：全屏运行、断网可进入，体验接近原生 App。
            </p>
            <button
              type="button"
              onClick={doInstall}
              disabled={busy === 'install'}
              data-testid="pwa-install-btn"
              className={`mt-3 w-full ${pillBtn} bg-[#34C759] text-white ring-black/5`}
            >
              {busy === 'install' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {busy === 'install' ? '正在唤起安装…' : '立即安装到主屏幕'}
            </button>
          </div>
        </GroupCard>
      ) : iosSafari ? (
        <GroupCard>
          <div className="flex flex-col gap-3 px-4 py-4">
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              iPhone/iPad 需用 Safari 手动添加（iOS 不支持一键安装）：
            </p>
            {[
              {
                icon: <Share className="h-4 w-4" aria-hidden="true" />,
                text: '确认本页面是用 Safari 打开的（iOS 只有 Safari 支持安装）',
              },
              { icon: <span className="text-[13px] font-semibold">①</span>, text: '点 Safari 底部工具栏正中的「分享」按钮（方框向上箭头）' },
              { icon: <span className="text-[13px] font-semibold">②</span>, text: '上下滑动列表，找到「添加到主屏幕」并点它' },
              { icon: <span className="text-[13px] font-semibold">③</span>, text: '右上点「添加」——桌面会出现 Cove 图标' },
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-muted-foreground dark:bg-white/[0.1]">
                  {step.icon}
                </span>
                <span className="min-w-0 text-[13.5px] leading-relaxed">{step.text}</span>
              </div>
            ))}
          </div>
        </GroupCard>
      ) : (
        <GroupCard>
          <div className="flex items-start gap-3 px-4 py-3.5">
            <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="min-w-0 text-[13.5px] leading-relaxed text-muted-foreground">
              当前浏览器还没发出安装邀请。可以多浏览一会后再回来；或用浏览器菜单里的「安装应用 /
              添加到主屏幕」（Chrome/Edge：地址栏右侧安装图标或 ⋮ 菜单；Safari：分享 › 添加到 Dock）。
              手机 Chrome/Edge/Safari 均可安装。
            </p>
          </div>
        </GroupCard>
      )}

      {/* 离线说明 */}
      <div className="mt-5" />
      <SectionLabel icon={WifiOff} tone={TONE_ORANGE}>
        离线可用
      </SectionLabel>
      <GroupCard>
        <div className="px-4 py-3.5 text-[13px] leading-relaxed text-muted-foreground">
          在线时页面会自动缓存到本机：断网后从主屏幕图标照常打开，微信/信息/相册/备忘录等本机数据应用均可浏览。
          <span className="text-foreground/80">AI 聊天、在线音乐、天气等联网功能离线时暂停</span>
          ，恢复网络即自动可用。
        </div>
      </GroupCard>

      {/* 管理 */}
      <div className="mt-5" />
      <SectionLabel icon={Wrench} tone={TONE_GRAY}>
        管理
      </SectionLabel>
      <GroupCard>
        <div className="flex flex-col gap-2.5 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px]">当前版本</span>
            <span className="text-[14px] tabular-nums text-muted-foreground">v{APP_VERSION}</span>
          </div>
          <button
            type="button"
            onClick={doCheckUpdate}
            disabled={busy === 'update' || swActive !== true}
            className={`${pillBtn} w-full bg-white/60 text-foreground ring-white/70 dark:bg-white/[0.08] dark:ring-white/[0.12]`}
          >
            {busy === 'update' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            检查更新
          </button>
          <button
            type="button"
            onClick={doClearCache}
            disabled={busy === 'clear' || stats === null || stats.entries === 0}
            data-testid="pwa-clear-cache-btn"
            className={`${pillBtn} w-full ${
              confirmClear
                ? 'bg-[#FF3B30]/90 text-white ring-red-300/40'
                : 'bg-white/60 text-[#FF3B30] ring-white/70 dark:bg-white/[0.08] dark:ring-white/[0.12]'
            }`}
          >
            {busy === 'clear' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {confirmClear ? '再点一次确认清除（不影响聊天记录）' : '清除离线缓存'}
          </button>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            清除的只是网页离线缓存；聊天记录、照片、备忘录与全部设置存在 IndexedDB，不受影响，推送通知也不受影响。
          </p>
        </div>
      </GroupCard>
    </DetailShell>
  );
}
