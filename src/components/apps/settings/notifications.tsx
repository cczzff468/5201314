'use client';

// 通知页：推送状态 + 声音与铃声（DND 时段编辑、ToneSheet 铃声选择、NotifySoundSection）。

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import type {
  ChangeEvent,
  ReactNode,
} from 'react';

import {
  ArrowDownLeft,
  ArrowUpRight,
  AudioLines,
  Bell,
  BellOff,
  Check,
  ChevronRight,
  Heart,
  Loader2,
  Moon,
  Star,
  Trash2,
  Upload,
  UsersRound,
  Vibrate,
  Volume2,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

import { formatDuration } from '@/lib/ios/db';

import { Slider } from '@/components/ui/slider';

import { Switch } from '@/components/ui/switch';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { isNativePerception } from '@/lib/ios/native-perception';

import {
  clearPushStatus,
  lastPushStatus,
  setupPushSubscription,
  teardownPushSubscription,
} from '@/lib/ios/push-client';

import {
  showSystemNotification,
  querySystemNotifyPermission,
  requestSystemNotifyPermission,
  type SystemNotifyChannel,
} from '@/lib/ios/system-notify';

import {
  isSysNotifyEnabled,
  setSysNotifyEnabled,
} from '@/lib/ios/island-notify';

// v1.9.2 真 DND 总开关（localStorage ios-notify-dnd-master）：开关行订阅响应式镜像 store，
// 与通知中心面板快捷开关双向即时联动（setNotifyDnd 先落盘再同步镜像）
import {
  setNotifyDnd,
  useNotifyDnd,
} from '@/lib/ios/notification-center';

import {
  addCustomRingtone,
  BUILTIN_NOTIFY_TONES,
  deleteCustomRingtone,
  inDndWindow,
  NOTIFY_SOUND_CATEGORY_META,
  playTone,
  toneDisplayName,
  useNotifySound,
  type NotifySoundCategory,
  type RingtoneMeta,
} from '@/lib/ios/notify-sound';

import {
  LocalToast,
  useLocalToast,
} from '../page-toast';

import {
  IOS_RED,
  GroupCard,
  TONE_ORANGE,
  TONE_BLUE,
  TONE_GREEN,
  TONE_RED,
  TONE_CYAN,
  TONE_PURPLE,
  TONE_PINK,
  RowIcon,
  DetailShell,
} from './shared';


// ---------------- 通知 ----------------

/** 推送订阅状态 → 中文描述（null = 状态未知/未尝试） */
export function pushStatusText(state: string, detail?: string): string {
  switch (state) {
    case 'subscribed':
      return '推送已订阅：页面关闭后，新回复会以系统通知送达。';
    case 'unsupported':
      return `当前浏览器不支持后台推送${detail ? `（${detail}）` : ''}。`;
    case 'no-permission':
      return detail || '尚未开启通知权限。';
    case 'sw-failed':
      return `后台服务注册失败${detail ? `（${detail}）` : ''}。`;
    case 'key-failed':
      return `推送密钥获取失败${detail ? `（${detail}）` : ''}。`;
    case 'subscribe-failed':
      // 推送服务连不上（AbortError: Registration failed - push service error）：
      // 国内网络访问 Chrome/Firefox 境外推送服务失败，属常见现象且不影响页面内通知——不显示，避免吓用户
      if (/aborterror|push service error|registration failed/i.test(detail ?? '')) return '';
      return `推送订阅未完成${detail ? `（${detail}）` : ''}。`;
    default:
      return '';
  }
}

export function NotificationPage({ onBack }: { onBack: () => void }) {
  // 开关 = 持久化的「系统级通知总闸」（localStorage ios-sys-notify-enabled，缺省开）。
  // 修复：原实现是组件局部 state，退出页面再进来又显示「开」，关掉后 Web Notification 照弹。
  // 该开关只管系统级通道（Web Notification / Web Push）；应用内灵动岛弹窗不受影响。
  const [enabled, setEnabled] = useState<boolean>(() => isSysNotifyEnabled());
  // v1.6.1：APK 原生壳里 Notification.permission 恒为 'denied'（WebView 不映射 Android 运行时
  // 权限）——改用 querySystemNotifyPermission 异步取真实状态（原生读 areNotificationsEnabled），
  // 修复「系统弹窗已授权但开关仍弹回关闭 + 误报已在设置中关闭」。
  const [denied, setDenied] = useState<boolean>(false);
  useEffect(() => {
    let dead = false;
    void querySystemNotifyPermission().then((p) => {
      if (dead) return;
      setDenied(p === 'denied');
    });
    return () => {
      dead = true;
    };
  }, []);
  // 测试通知结果：ok=已弹出（testChannel 区分原生/网页通道）/ fail-perm=权限未授 / fail-channel=所有通道不可用
  const [testResult, setTestResult] = useState<'idle' | 'busy' | 'ok' | 'fail-perm' | 'fail-channel'>('idle');
  const [testChannel, setTestChannel] = useState<SystemNotifyChannel>(null);
  // 预览面板 iframe 提示：iframe 里系统通知/推送常被浏览器权限策略拦截
  // （本页在客户端交互后才挂载，惰性初始化读 window 安全；跨域访问 window.top 抛错 → 必在 iframe）
  const [inIframe] = useState<boolean>(() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  });
  // 推送订阅诊断（真实环境失败原因，不再静默）：setupPushSubscription 每次尝试后都会落盘
  // v1.9.1：APK 原生壳里 Web Push 诊断不再适用（旧 bundle 时代误落的「已在设置中关闭系统通知」
  // 永不更新、永远误导）——挂载时直接清掋旧诊断并不再展示推送诊断行
  const [pushState, setPushState] = useState<string>(() => {
    if (isNativePerception()) {
      clearPushStatus();
      return '';
    }
    return lastPushStatus()?.state ?? '';
  });
  const [pushDetail, setPushDetail] = useState<string>(() => (isNativePerception() ? '' : (lastPushStatus()?.detail ?? '')));
  // 页内 toast（关闭开关后的说明）
  const [toastMsg, showToast] = useLocalToast();

  /** 权限就绪后立即尝试订阅（并把诊断结果回显）。用户主动入口一律 force=true：
   *  重置单次锁重跑订阅链路，首次订阅瞬时失败后不再被锁死到刷新整页 */
  const ensureSubscription = async (): Promise<void> => {
    const s = await setupPushSubscription({ force: true });
    // APK 原生壳：系统通知走原生 localNotify 通道，Web Push 订阅在 WebView 里不可靠也不需要
    // ——如实标注但不落红字诊断行（否则用户看到「推送订阅未完成」以为通知坏了）
    if (isNativePerception() && s.state === 'unsupported') return;
    setPushState(s.state);
    setPushDetail(s.detail ?? '');
  };

  const handleToggle = async (checked: boolean) => {
    // 先持久化用户意图（无论环境是否支持，退出页面/下次进来都保持本次选择）
    setSysNotifyEnabled(checked);
    if (!checked) {
      setEnabled(false);
      showToast('已关闭系统通知，应用内提醒不受影响');
      // 关闭系统级通知的同时退订 Web Push（服务端离线不再向本浏览器推送）
      const s = await teardownPushSubscription();
      // v1.9.1：APK 原生壳不落退订诊断（退订是 Web Push 语义，原生壳走通知栏通道）
      if (!isNativePerception()) {
        setPushState(s.state);
        setPushDetail(s.detail ?? '');
      }
      return;
    }
    if (typeof window === 'undefined') {
      setEnabled(false);
      return;
    }
    // v1.6.1：统一走真实状态查询/申请（APK 原生壳弹 Android 13+ 系统授权框，
    // 网页走浏览器授权框），不再读 WebView 里恒为 'denied' 的 Web API
    const p = await querySystemNotifyPermission();
    if (p === 'granted') {
      setEnabled(true);
      setDenied(false);
      void ensureSubscription();
      return;
    }
    // 'default'（可申请）或 'denied'：APK 原生壳在 13+ 未永久拒绝时仍能拉起系统授权框
    const result = await requestSystemNotifyPermission();
    if (result === 'granted') {
      setEnabled(true);
      setDenied(false);
      void ensureSubscription();
    } else {
      setEnabled(false);
      setDenied(result === 'denied');
    }
  };

  /** 测试系统通知（v1.9.1 通道链重构）：showSystemNotification 现已内置原生 localNotify 通道——
   *  APK 内真实弹系统通知栏（旧版 WebView 里 SW/构造器两通道全不可用必败，误报浏览器策略问题）；
   *  失败原因细分：权限未授（fail-perm）vs 通道不可用（fail-channel，原生壳=壳过旧需升级） */
  const fireTestNotification = async (): Promise<void> => {
    if (typeof window === 'undefined') {
      setTestResult('fail-channel');
      return;
    }
    // 系统级通知总闸：开关关闭时测试通知同样不投递（与真实通知同口径）
    if (!enabled || !isSysNotifyEnabled()) {
      setTestResult('fail-perm');
      return;
    }
    const perm = await querySystemNotifyPermission();
    if (perm !== 'granted') {
      setTestResult('fail-perm');
      return;
    }
    setTestResult('busy');
    const channel = await showSystemNotification('测试通知', {
      body: '系统通知通道正常：切走 APP / 最小化时，AI 的新消息会像这样弹出。',
      tag: `test-${Date.now()}`,
      icon: '/icons/chat.png',
      badge: '/icons/chat.png',
      onclick: () => window.focus(),
    });
    setTestChannel(channel);
    setTestResult(channel ? 'ok' : 'fail-channel');
  };

  return (
    <DetailShell title="通知" onBack={onBack} gray>
      <GroupCard>
        <div className="flex h-[46px] items-center justify-between px-4">
          <span className="text-[16px]">允许通知</span>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => void handleToggle(v)}
            aria-label="允许通知"
          />
        </div>
      </GroupCard>
      {denied && (
        <p className="mt-3 px-1 text-[13px] leading-relaxed" style={{ color: IOS_RED }}>
          {isNativePerception()
            ? '系统通知权限未开启：请在系统设置 › 应用 › Cove › 通知 中允许；Android 13+ 也可重新打开上方开关触发系统授权弹窗。'
            : '通知已被浏览器拒绝，请在浏览器设置中恢复。'}
        </p>
      )}
      {inIframe && (
        <p className="mt-3 rounded-[14px] bg-white/[0.72] px-3 py-2 text-[12px] leading-relaxed text-zinc-500 shadow-[0_2px_8px_rgba(24,24,27,0.03),0_14px_44px_rgba(24,24,27,0.07),inset_0_1px_0_rgba(255,255,255,0.55)] ring-1 ring-white/40 backdrop-blur-xl">
          当前页面嵌在预览面板（iframe）里，部分浏览器会在这里拦截系统通知与后台推送。
          点预览面板右上角「在新标签页打开」后重新开启通知，切走/关闭页面也能收到。
        </p>
      )}
      <div className="mt-3">
        <GroupCard>
          <button
            type="button"
            onClick={() => void fireTestNotification()}
            disabled={testResult === 'busy' || !enabled}
            className="flex h-[46px] w-full items-center justify-between px-4 text-left disabled:opacity-50"
          >
            <span className="text-[16px]">发送测试通知</span>
            {testResult === 'busy' ? (
              <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
            ) : (
              <ChevronRight className="h-4 w-4 text-zinc-500" />
            )}
          </button>
        </GroupCard>
      </div>
      {testResult === 'ok' && (
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-zinc-500">
          {testChannel === 'native'
            ? '已发送到系统通知栏：下拉通知栏查看；APP 切后台/最小化时，AI 的新消息会像这样弹出。'
            : '已发送：如果没看到弹窗，检查系统/浏览器是否开了「勿扰」或隐藏了通知横幅。'}
        </p>
      )}
      {testResult === 'fail-perm' && (
        <p className="mt-2 px-1 text-[12px] leading-relaxed" style={{ color: IOS_RED }}>
          {isNativePerception()
            ? '通知权限未开启：请在系统设置 › 应用 › Cove › 通知 中允许；Android 13+ 也可重新打开上方开关触发系统授权弹窗。'
            : '通知权限被浏览器拒绝：请先在浏览器站点设置中允许通知，再发送测试。'}
        </p>
      )}
      {testResult === 'fail-channel' && (
        <p className="mt-2 px-1 text-[12px] leading-relaxed" style={{ color: IOS_RED }}>
          {isNativePerception()
            ? '测试通知未能下发：当前 APP 版本过旧（需 v1.5.0+），请到 设置 › APP 更新 升级后重试。'
            : '系统通知未能弹出：页面构造与 Service Worker 两条通道都被拦截。若在预览面板里请用新标签页打开；独立部署时多为浏览器策略限制（Android 需允许站点通知）。'}
        </p>
      )}
      {pushState && pushStatusText(pushState, pushDetail) && (
        <p
          className={`mt-2 px-1 text-[12px] leading-relaxed ${pushState === 'subscribed' ? 'text-zinc-500' : ''}`}
          style={pushState === 'subscribed' ? undefined : { color: IOS_RED }}
        >
          {pushStatusText(pushState, pushDetail)}
        </p>
      )}
      {/* 订阅失败重试入口（force 重跑订阅链路，不再被单次锁锁死到刷新整页） */}
      {enabled && pushState && pushState !== 'subscribed' && (
        <button
          type="button"
          onClick={() => void ensureSubscription()}
          className="mt-1.5 px-1 text-[12px] text-zinc-900 underline underline-offset-2 transition-opacity active:opacity-50"
        >
          重新尝试订阅后台推送
        </button>
      )}
      <NotifySoundSection />
      <LocalToast msg={toastMsg} />
    </DetailShell>
  );
}

// ---------------- 通知 · 声音与铃声 ----------------

/** 免打扰时段显示文案（from/to 任一为空 = 关闭） */
export function soundDndLabel(from: string, to: string): string {
  return from && to ? `${from} – ${to}` : '关闭';
}

/** 免打扰时段编辑（原生 time 输入对；支持跨夜如 22:00–08:00） */
export function DndTimeEditor({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pb-3 pt-0.5">
      <input
        type="time"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
        aria-label="免打扰开始时间"
        className="h-9 rounded-[10px] bg-white px-3 text-[15px] tabular-nums outline-none ring-1 ring-black/[0.06]"
      />
      <span className="text-[13px] text-zinc-500">至</span>
      <input
        type="time"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
        aria-label="免打扰结束时间"
        className="h-9 rounded-[10px] bg-white px-3 text-[15px] tabular-nums outline-none ring-1 ring-black/[0.06]"
      />
      {(from || to) && (
        <button
          type="button"
          onClick={() => onChange('', '')}
          className="ml-auto text-[13px] text-zinc-500 underline underline-offset-2 transition-opacity active:opacity-50"
        >
          清除
        </button>
      )}
    </div>
  );
}

/** 五分类的 iOS 设置风行首图标（纯色圆角方块 + 白色线性图标） */
export const CATEGORY_ICON: Record<NotifySoundCategory, { icon: LucideIcon; tone: string }> = {
  receive: { icon: ArrowDownLeft, tone: TONE_GREEN },
  send: { icon: ArrowUpRight, tone: TONE_BLUE },
  moments: { icon: Heart, tone: TONE_PINK },
  qzone: { icon: Star, tone: TONE_ORANGE },
  group: { icon: UsersRound, tone: TONE_PURPLE },
};

/** 底部弹窗内容：铃声列表（内置 8 个 + 我的铃声；每项可试听；上传入口；已选打勾） */
export function ToneSheetContent({
  value,
  ringtones,
  uploading,
  previewingId,
  onPick,
  onPreview,
  onUpload,
  onRequestDelete,
}: {
  value: string;
  ringtones: RingtoneMeta[];
  uploading: boolean;
  /** 正在试听的铃声 id（喇叭图标变为绿色音波动画） */
  previewingId: string | null;
  onPick: (id: string) => void;
  onPreview: (id: string) => void;
  onUpload: () => void;
  onRequestDelete: (r: RingtoneMeta) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="pb-1.5 pl-1 text-[13px] font-medium text-zinc-500">内置铃声</p>
        <GroupCard>
          {BUILTIN_NOTIFY_TONES.map((t) => {
            const active = value === t.id;
            const playing = previewingId === t.id;
            return (
              <div key={t.id} className="flex h-[46px] items-center px-2">
                <button
                  type="button"
                  onClick={() => onPreview(t.id)}
                  aria-label={`试听${t.name}`}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors active:bg-black/[0.07] ${
                    playing ? 'text-[#34C759]' : 'text-zinc-500'
                  }`}
                >
                  {playing ? (
                    <AudioLines className="h-[18px] w-[18px] animate-pulse" />
                  ) : (
                    <Volume2 className="h-[18px] w-[18px]" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onPick(t.id)}
                  className="flex min-w-0 flex-1 items-center justify-between pl-1.5 pr-1 text-left"
                >
                  <span className="truncate text-[16px]">{t.name}</span>
                  {active && <Check className="h-[18px] w-[18px] shrink-0 text-[#34C759]" aria-label="已选中" />}
                </button>
              </div>
            );
          })}
        </GroupCard>
      </div>
      {ringtones.length > 0 && (
        <div>
          <p className="pb-1.5 pl-1 text-[13px] font-medium text-zinc-500">我的铃声</p>
          <GroupCard>
            {ringtones.map((r) => {
              const id = `custom:${r.id}`;
              const active = value === id;
              const playing = previewingId === id;
              return (
                <div key={r.id} className="flex h-[46px] items-center px-2">
                  <button
                    type="button"
                    onClick={() => onPreview(id)}
                    aria-label={`试听${r.name}`}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors active:bg-black/[0.07] ${
                      playing ? 'text-[#34C759]' : 'text-zinc-500'
                    }`}
                  >
                    {playing ? (
                      <AudioLines className="h-[18px] w-[18px] animate-pulse" />
                    ) : (
                      <Volume2 className="h-[18px] w-[18px]" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onPick(id)}
                    className="flex min-w-0 flex-1 items-center justify-between pl-1.5 pr-1 text-left"
                  >
                    <span className="min-w-0 truncate text-[16px]">
                      {r.name}
                      <span className="ml-1.5 text-[11px] text-zinc-500">
                        {r.duration > 0 ? formatDuration(r.duration) : '—'}
                      </span>
                    </span>
                    {active && <Check className="h-[18px] w-[18px] shrink-0 text-[#34C759]" aria-label="已选中" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestDelete(r)}
                    aria-label={`删除${r.name}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors active:bg-black/[0.07]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </GroupCard>
        </div>
      )}
      <div>
        <p className="pb-1.5 pl-1 text-[13px] font-medium text-zinc-500">更多</p>
        <GroupCard>
          <button
            type="button"
            onClick={onUpload}
            disabled={uploading}
            className="flex h-[48px] w-full items-center gap-3 px-4 text-left disabled:opacity-60"
          >
            <RowIcon icon={Upload} tone={TONE_BLUE} />
            <span className="min-w-0 flex-1">
              <span className="block text-[16px]">{uploading ? '正在保存…' : '上传自定义铃声'}</span>
              <span className="block text-[11px] text-zinc-500">音频文件 · ≤8MB · 永久保存</span>
            </span>
            {uploading && <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />}
          </button>
        </GroupCard>
      </div>
    </div>
  );
}

/**
 * iOS 风格底部弹窗：从屏幕底部滑入的铃声选择面板（抓手 + 居中标题 + 右上「完成」）。
 * fixed 定位在 PhoneShell 内（壳 transform 使 fixed 相对机身定位，天然只覆盖手机屏）；
 * 点遮罩 / 「完成」/ Esc 关闭；内容超长时内部滚动。
 */
export function ToneSheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  // 挂载期间 Esc 关闭（桌面端键盘友好）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={title}>
      {/* 遮罩：点击空白关闭 */}
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-md animate-in fade-in duration-200"
      />
      {/* 面板：从底部滑入（v2.4.37 液态玻璃：半透白 + 30px 模糊 + 白描边） */}
      <div className="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-[28px] bg-white/[0.86] shadow-[0_-8px_40px_rgba(24,24,27,0.12),inset_0_1px_0_rgba(255,255,255,0.6)] ring-1 ring-white/60 backdrop-blur-2xl animate-in slide-in-from-bottom-10 fade-in duration-300">
        <div className="mx-auto mt-2.5 h-[5px] w-10 shrink-0 rounded-full bg-black/15" aria-hidden="true" />
        <div className="flex items-center justify-between px-4 pb-1 pt-2.5">
          <span className="w-14" aria-hidden="true" />
          <span className="text-[17px] font-semibold">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="w-14 text-right text-[17px] text-[#007AFF] transition-opacity active:opacity-40"
          >
            完成
          </button>
        </div>
        <div className="no-scrollbar max-h-[540px] overflow-y-auto px-4 pb-8 pt-1">{children}</div>
      </div>
    </div>
  );
}

/**
 * 声音与铃声完整配置区（通知页内嵌）:
 * 全局（提示音总开关/总音量/震动/免打扰）+ 五分类（铃声/试听/音量/开关/免打扰）+ 我的铃声管理。
 * 所有改动即时持久化生效（useNotifySound.update* 内部写 IndexedDB）。
 */
export function NotifySoundSection() {
  const settings = useNotifySound((s) => s.settings);
  const ringtones = useNotifySound((s) => s.ringtones);
  const update = useNotifySound((s) => s.update);
  const updateCategory = useNotifySound((s) => s.updateCategory);
  const [openCat, setOpenCat] = useState<NotifySoundCategory | null>(null);
  /** 底部弹窗当前选择铃声的分类 */
  const [sheetCat, setSheetCat] = useState<NotifySoundCategory | null>(null);
  const [globalDndOpen, setGlobalDndOpen] = useState(false);
  const [catDndOpen, setCatDndOpen] = useState<NotifySoundCategory | null>(null);
  const [uploading, setUploading] = useState(false);
  const [delTarget, setDelTarget] = useState<RingtoneMeta | null>(null);
  /** 正在试听的铃声 id（喇叭图标变绿色音波，播完自动恢复） */
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [toastMsg, showToast] = useLocalToast();
  // v1.9.2 真 DND 总开关：订阅响应式镜像（useNotifyDnd）而非本地 useState——
  // 与下方「提示音」总开关相互独立（那个只关声音，这个连横幅与系统通知一起静，中心记录照常），
  // 与面板快捷开关双向联动（面板点了设置页立即反映，反之亦然）
  const dndMaster = useNotifyDnd((s) => s.on);

  // 分类独立开关已从界面移除（总开关 + 音量/免打扰已足够，界面更简洁）：
  // 历史数据里手动关过的分类一次性恢复，避免「无声且无处再开启」的死角
  useEffect(() => {
    const cats = settings.categories;
    const off = (Object.keys(cats) as NotifySoundCategory[]).filter((k) => !cats[k].enabled);
    if (off.length === 0) return;
    const next = { ...settings, categories: { ...cats } };
    for (const k of off) next.categories[k] = { ...next.categories[k], enabled: true };
    update(next);
  }, [settings, update]);

  // 卸载清理试听状态计时器
  useEffect(
    () => () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    },
    []
  );

  /** 分类实际音量（总音量 × 分类音量，试听同口径） */
  const categoryVolume = (key: NotifySoundCategory): number =>
    Math.max(0, Math.min(1, settings.masterVolume * settings.categories[key].volume));

  /** 试听（音量为 0 时提示，不白点；播放中喇叭变音波，播完自动恢复） */
  const preview = (toneId: string, vol: number): void => {
    if (vol <= 0.001) {
      showToast('音量为 0，请先调高音量');
      return;
    }
    setPreviewingId(toneId);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    void playTone(toneId, vol)
      .catch(() => undefined)
      .finally(() => {
        previewTimer.current = setTimeout(
          () => setPreviewingId((cur) => (cur === toneId ? null : cur)),
          260
        );
      });
  };

  const handleUploadFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const meta = await addCustomRingtone(file);
      showToast(`已保存「${meta.name}」，可在各分类提示音里选用`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '上传失败，请换一个音频文件');
    } finally {
      setUploading(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    const t = delTarget;
    setDelTarget(null);
    if (!t) return;
    try {
      await deleteCustomRingtone(t.id);
      showToast('已删除');
    } catch {
      showToast('删除失败，请重试');
    }
  };

  const categoryKeys = Object.keys(NOTIFY_SOUND_CATEGORY_META) as NotifySoundCategory[];

  return (
    <div>
      {/* ---------- v1.9.2 真 DND 总开关（横幅/声音/系统通知三出口全静，中心记录照常入账；
          闹钟/提醒/AI 来电豁免——用户明确要求的打扰不静） ---------- */}
      <p className="mt-6 px-1 pb-1.5 text-[13px] font-medium text-zinc-500">免打扰模式</p>
      <GroupCard>
        <div className="flex h-[48px] items-center gap-3 px-4">
          <RowIcon icon={BellOff} tone={TONE_RED} />
          <span className="min-w-0 flex-1 text-[16px]">免打扰模式</span>
          <Switch
            checked={dndMaster}
            onCheckedChange={(v) => setNotifyDnd(v)}
            aria-label="免打扰模式"
          />
        </div>
        <p className="px-4 pb-3.5 pt-1 text-[12px] leading-relaxed text-zinc-500">
          横幅与声音全静，通知照常收入通知中心（闹钟/提醒/来电不受影响）
        </p>
      </GroupCard>
      {/* ---------- 全局 ---------- */}
      <p className="mt-6 px-1 pb-1.5 text-[13px] font-medium text-zinc-500">声音与铃声</p>
      <GroupCard>
        <div className="flex h-[48px] items-center gap-3 px-4">
          <RowIcon icon={Bell} tone={TONE_RED} />
          <span className="min-w-0 flex-1 text-[16px]">提示音</span>
          <Switch
            checked={settings.master}
            onCheckedChange={(v) => update({ master: v })}
            aria-label="提示音总开关"
          />
        </div>
        <div className="pb-3.5 pt-1">
          <div className="flex items-center gap-3 px-4">
            <RowIcon icon={Volume2} tone={TONE_BLUE} />
            <span className="min-w-0 flex-1 text-[16px]">总音量</span>
            <span className="text-[15px] tabular-nums text-zinc-500">
              {Math.round(settings.masterVolume * 100)}%
            </span>
          </div>
          <div className="px-4 pt-3">
            <Slider
              className="ios-slider"
              value={[Math.round(settings.masterVolume * 100)]}
              min={0}
              max={100}
              step={5}
              onValueChange={(v) => update({ masterVolume: (v[0] ?? 90) / 100 })}
              aria-label="总音量"
            />
          </div>
        </div>
        <div className="flex h-[48px] items-center gap-3 px-4">
          <RowIcon icon={Vibrate} tone={TONE_PURPLE} />
          <span className="min-w-0 flex-1 text-[16px]">响铃时震动</span>
          <Switch
            checked={settings.vibrate}
            onCheckedChange={(v) => update({ vibrate: v })}
            aria-label="响铃时震动"
          />
        </div>
        <button
          type="button"
          onClick={() => setGlobalDndOpen((v) => !v)}
          className="flex min-h-[48px] w-full items-center gap-3 px-4 py-2 text-left"
          aria-expanded={globalDndOpen}
        >
          <RowIcon icon={Moon} tone={TONE_CYAN} />
          <span className="min-w-0 flex-1 text-[16px]">免打扰时段</span>
          <span className="shrink-0 text-[15px] text-zinc-500">
            {soundDndLabel(settings.dndFrom, settings.dndTo)}
          </span>
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-zinc-500/60 transition-transform ${globalDndOpen ? 'rotate-90' : ''}`}
          />
        </button>
        {globalDndOpen && (
          <DndTimeEditor
            from={settings.dndFrom}
            to={settings.dndTo}
            onChange={(f, t) => update({ dndFrom: f, dndTo: t })}
          />
        )}
      </GroupCard>
      {!settings.master && (
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-zinc-500">
          已一键静音：各类提示音都不响，配置保留，重新打开即恢复。
        </p>
      )}
      {settings.master && inDndWindow(settings.dndFrom, settings.dndTo) && (
        <p className="mt-2 px-1 text-[12px] leading-relaxed" style={{ color: TONE_GREEN }}>
          当前处于免打扰时段（{settings.dndFrom} – {settings.dndTo}）：通知照常，只是不响铃。
        </p>
      )}

      {/* ---------- 五分类（无独立开关：总开关 + 音量/免打扰已足够，界面更简洁） ---------- */}
      <p className="mt-4 px-1 pb-1.5 text-[13px] font-medium text-zinc-500">按类型配置</p>
      <GroupCard>
        {categoryKeys.map((key) => {
          const meta = NOTIFY_SOUND_CATEGORY_META[key];
          const cfg = settings.categories[key];
          const ic = CATEGORY_ICON[key];
          const open = openCat === key;
          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => setOpenCat(open ? null : key)}
                className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-black/[0.04]"
                aria-expanded={open}
              >
                <RowIcon icon={ic.icon} tone={ic.tone} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px]">{meta.label}</span>
                  <span className="block truncate text-[12px] text-zinc-500">{meta.desc}</span>
                </span>
                <span className="max-w-[96px] shrink-0 truncate text-[14px] text-zinc-500">
                  {toneDisplayName(cfg.toneId, ringtones)}
                </span>
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-zinc-500/60 transition-transform ${open ? 'rotate-90' : ''}`}
                />
              </button>
              {open && (
                <div className="animate-in fade-in slide-in-from-top-1 pb-3.5 duration-200">
                  {/* 提示音 → 底部弹窗选择 */}
                  <button
                    type="button"
                    onClick={() => setSheetCat(key)}
                    className="flex h-[44px] w-full items-center justify-between px-4 text-left"
                  >
                    <span className="text-[15px]">提示音</span>
                    <span className="flex items-center gap-1 text-[15px] text-zinc-500">
                      {toneDisplayName(cfg.toneId, ringtones)}
                      <ChevronRight className="h-4 w-4 text-zinc-500/60" />
                    </span>
                  </button>
                  {/* 试听 */}
                  <div className="flex h-[44px] items-center justify-between px-4">
                    <span className="text-[15px] text-zinc-500">
                      试听（实际音量 {Math.round(categoryVolume(key) * 100)}%）
                    </span>
                    <button
                      type="button"
                      onClick={() => preview(cfg.toneId, categoryVolume(key))}
                      aria-label={`试听${meta.label}`}
                      className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                        previewingId === cfg.toneId
                          ? 'bg-[#34C759]/15 text-[#34C759]'
                          : 'bg-black/[0.05] text-zinc-800 active:bg-black/10'
                      }`}
                    >
                      {previewingId === cfg.toneId ? (
                        <AudioLines className="h-5 w-5 animate-pulse" />
                      ) : (
                        <Volume2 className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                  {/* 分类音量 */}
                  <div className="px-4 py-1.5">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[14px] text-zinc-500">音量</span>
                      <span className="text-[13px] tabular-nums text-zinc-500">
                        {Math.round(cfg.volume * 100)}%
                      </span>
                    </div>
                    <Slider
                      className="ios-slider"
                      value={[Math.round(cfg.volume * 100)]}
                      min={0}
                      max={100}
                      step={5}
                      onValueChange={(v) => updateCategory(key, { volume: (v[0] ?? 80) / 100 })}
                      aria-label={`${meta.label}音量`}
                    />
                  </div>
                  {/* 分类免打扰 */}
                  <button
                    type="button"
                    onClick={() => setCatDndOpen(catDndOpen === key ? null : key)}
                    className="flex h-[44px] w-full items-center justify-between px-4 text-left"
                    aria-expanded={catDndOpen === key}
                  >
                    <span className="text-[15px]">免打扰时段</span>
                    <span className="flex items-center gap-1 text-[14px] text-zinc-500">
                      {soundDndLabel(cfg.dndFrom, cfg.dndTo)}
                      <ChevronRight
                        className={`h-4 w-4 text-zinc-500/60 transition-transform ${catDndOpen === key ? 'rotate-90' : ''}`}
                      />
                    </span>
                  </button>
                  {catDndOpen === key && (
                    <DndTimeEditor
                      from={cfg.dndFrom}
                      to={cfg.dndTo}
                      onChange={(f, t) => updateCategory(key, { dndFrom: f, dndTo: t })}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </GroupCard>

      {/* ---------- 我的铃声管理 ---------- */}
      <p className="mt-4 px-1 pb-1.5 text-[13px] font-medium text-zinc-500">我的铃声</p>
      <GroupCard>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex h-[48px] w-full items-center gap-3 px-4 text-left disabled:opacity-60"
        >
          <RowIcon icon={Upload} tone={TONE_GREEN} />
          <span className="min-w-0 flex-1 text-[16px]">{uploading ? '正在保存…' : '上传自定义铃声'}</span>
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
          ) : (
            <span className="text-[12px] text-zinc-500">音频 · ≤8MB</span>
          )}
        </button>
        {ringtones.length > 0 ? (
          <div>
            {ringtones.map((r) => (
              <div key={r.id} className="flex h-[48px] items-center gap-2.5 px-4">
                <button
                  type="button"
                  onClick={() => preview(`custom:${r.id}`, Math.max(settings.masterVolume, 0.25))}
                  aria-label={`试听${r.name}`}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                    previewingId === `custom:${r.id}`
                      ? 'bg-[#34C759]/15 text-[#34C759]'
                      : 'bg-black/[0.05] text-zinc-800 active:bg-black/10'
                  }`}
                >
                  {previewingId === `custom:${r.id}` ? (
                    <AudioLines className="h-[18px] w-[18px] animate-pulse" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{r.name}</span>
                  <span className="block text-[11px] text-zinc-500">
                    {r.duration > 0 ? formatDuration(r.duration) : '时长未知'} · 已永久保存
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setDelTarget(r)}
                  aria-label={`删除${r.name}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors active:bg-black/[0.07]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-2.5 text-[12px] leading-relaxed text-zinc-500">
            还没有上传的铃声；上传后永久保存在本机，可在任意分类的「提示音」里选用、删除。
          </p>
        )}
      </GroupCard>

      <p className="mt-3 px-1 text-[12px] leading-relaxed text-zinc-500">
        设置保存后立即生效，无需重启。免打扰时段内通知照常送达、记录照常保留，只是不响铃不震动。
        声音设置为整机共享，切换聊天账号不受影响。
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => void handleUploadFile(e)}
      />

      {/* ---------- 提示音选择底部弹窗 ---------- */}
      {sheetCat && (
        <ToneSheet title="选择提示音" onClose={() => setSheetCat(null)}>
          <ToneSheetContent
            value={settings.categories[sheetCat].toneId}
            ringtones={ringtones}
            uploading={uploading}
            previewingId={previewingId}
            onUpload={() => fileRef.current?.click()}
            onPreview={(id) => preview(id, categoryVolume(sheetCat))}
            onPick={(id) => {
              updateCategory(sheetCat, { toneId: id });
              // 选完立即试听；分类音量为 0 时给最低可闻度（纯选铃声场景）
              preview(id, Math.max(categoryVolume(sheetCat), 0.25));
            }}
            onRequestDelete={(r) => {
              // 先收弹窗再确认删除（确认框层级在弹窗之上）
              setSheetCat(null);
              setDelTarget(r);
            }}
          />
        </ToneSheet>
      )}

      <AlertDialog open={!!delTarget} onOpenChange={(o) => { if (!o) setDelTarget(null); }}>
        <AlertDialogContent className="border-black/[0.06] bg-white! text-zinc-900!">
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{delTarget?.name ?? ''}」？</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-500!">
              使用这个铃声的分类会自动改回默认提示音；删除后不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-zinc-900">取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LocalToast msg={toastMsg} />
    </div>
  );
}
