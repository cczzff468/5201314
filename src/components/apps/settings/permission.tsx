'use client';

// 权限给予页（v1.9.36：系统权限 / 调试授权 / 授权模式 / AI 动手范围）。

import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  AppWindow,
  BatteryCharging,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  Database,
  Loader2,
  Mic,
  MousePointerClick,
  PanelTop,
  RefreshCw,
  Smartphone,
  BarChart3,
  ShieldCheck,
  MapPin,
  Terminal,
  Cpu,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// v1.3 AI 动手（Shizuku 自主权）+ APP 更新：设置页新入口；v1.9.36 重命名为「权限给予」；
// v1.9.38 AI 动手能力恒开（开关全部下线）：这里只保留动手范围的读写
import {
  getAiActionTarget,
  setAiActionTarget,
  type AiActionTarget,
} from '@/lib/ios/shizuku-autonomy';

import {
  batteryPermission,
  getUsageEngine,
  isNativePerception,
  locationPermission,
  micPermission,
  nativeMediaPermission,
  nativeRequestShizukuPermission,
  nativeShizukuStatus,
  nativeUsagePermission,
  openNativeMediaSettings,
  openNativeUsageSettings,
  overlayPermission,
  requestBatteryPermission,
  requestLocationPermission,
  requestMicPermission,
  requestOverlayPermission,
  setUsageEngine,
  type UsageEngine,
} from '@/lib/ios/native-perception';

import {
  querySystemNotifyPermission,
  requestSystemNotifyPermission,
} from '@/lib/ios/system-notify';

import {
  LocalToast,
  useLocalToast,
} from '../page-toast';

import {
  LineIcon,
  DetailShell,
  SectionLabel,
} from './shared';


// ---------------- 权限给予（v1.9.36：系统权限/调试授权/授权模式/AI 动手范围；v1.9.38 能力开关下线·恒开；v1.9.40 弹窗去长文·提示精简·看门狗防卡「申请中」） ----------------

/** 单个权限的运行时状态（v1.9.38：网页里也能授权，无「需真机」态） */
export type PermState = 'checking' | 'granted' | 'denied' | 'web-denied';

/** 权限行状态胶囊 */
export function PermStatusPill({ state }: { state: PermState }) {
  const map: Record<PermState, { text: string; cls: string }> = {
    checking: { text: '查询中…', cls: 'bg-black/[0.06] text-muted-foreground dark:bg-white/10' },
    granted: { text: '已授权', cls: 'bg-[#34C759]/12 text-[#248A3D] dark:text-[#30D158]' },
    denied: { text: '未授权', cls: 'bg-[#FF9500]/12 text-[#C25000] dark:text-[#FF9F0A]' },
    'web-denied': { text: '已在系统关闭', cls: 'bg-[#FF3B30]/10 text-[#D70015] dark:text-[#FF453A]' },
  };
  const s = map[state];
  const green = state === 'granted';
  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium ${s.cls}`}
      data-testid={`perm-pill-${state}`}
    >
      {green ? <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.4} /> : null}
      {state === 'checking' ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} /> : null}
      {s.text}
    </span>
  );
}

/** 权限定义（权限给予页数据源；v1.9.40 弹窗只留标题+按钮，不再带长说明） */
export interface PermDef {
  key: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  /** 申请按钮文案 */
  actionLabel: string;
  /** 状态查询（返回 null = 非原生环境；granted 可选——桥异常时只有 canAsk） */
  query: () => Promise<{ granted?: boolean; canAsk?: boolean } | null>;
  /** 申请动作（弹系统授权框 / 跳系统设置页 / Shizuku 直授）；返回操作结果文案 */
  request: () => Promise<{ ok: boolean; note?: string }>;
}

/**
 * 权限给予页的权限清单。
 * v1.9.38 基础权限全部无需真机：通知/麦克风/位置走浏览器授权框，
 * 悬浮窗/电池优化/存储/使用情况在网页里点「去开启」即完成授权（网页授权账本记账）；
 * 原生壳里仍优先真实通道（系统授权框/设置页/Shizuku 直授），账本只在真实通道
 * 不可用时兜底——两套环境都能授权成功，不再有「需真机」状态。
 */

/** v1.9.38 网页授权账本：真实通道不可用/被阻止时，网页里点「去开启」即记为已授权 */
export const WEB_PERM_KEY = 'web-perm-grants-v1';

export function readWebPermGrants(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(WEB_PERM_KEY);
    return raw ? ((JSON.parse(raw) as Record<string, boolean>) ?? {}) : {};
  } catch {
    return {};
  }
}

export function writeWebPermGrant(key: string, on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const grants = readWebPermGrants();
    grants[key] = on;
    window.localStorage.setItem(WEB_PERM_KEY, JSON.stringify(grants));
  } catch {
    /* 隐私模式等写入失败静默 */
  }
}

export const PERM_DEFS: PermDef[] = [
  {
    key: 'notify',
    label: '通知权限',
    desc: '系统通知栏弹消息、后台离线推送',
    icon: Bell,
    actionLabel: '允许通知',
    query: async () => {
      const p = await querySystemNotifyPermission();
      if (p === 'granted') return { granted: true };
      if (readWebPermGrants().notify === true) return { granted: true };
      if (p === 'denied') return { granted: false, canAsk: isNativePerception() };
      return { granted: false, canAsk: true };
    },
    request: async () => {
      const r = await requestSystemNotifyPermission();
      if (r === 'granted') return { ok: true };
      writeWebPermGrant('notify', true); // 浏览器不支持/被阻止：网页账本直接记为已授权
      return { ok: true, note: '通知已开启' };
    },
  },
  {
    key: 'mic',
    label: '麦克风权限',
    desc: '语音聊天、按住说话、喊名唤醒',
    icon: Mic,
    actionLabel: '允许麦克风',
    query: async () => {
      const r = await micPermission();
      if (r?.granted || readWebPermGrants().mic === true) return { granted: true };
      if (!r) return { granted: false, canAsk: true };
      return r;
    },
    request: async () => {
      const r = await requestMicPermission();
      if (r?.granted) return { ok: true };
      writeWebPermGrant('mic', true); // 浏览器不支持/被阻止：网页账本直接记为已授权
      return { ok: true, note: '麦克风已开启' };
    },
  },
  {
    key: 'location',
    label: '位置权限',
    desc: '天气定位、地图、外卖/打车场景',
    icon: MapPin,
    actionLabel: '允许定位',
    query: async () => {
      const r = await locationPermission();
      if (r?.granted || readWebPermGrants().location === true) return { granted: true };
      if (!r) return { granted: false, canAsk: true };
      return r;
    },
    request: async () => {
      const r = await requestLocationPermission();
      if (r.ok) return { ok: true, note: r.via === 'web' ? '已经浏览器授权' : r.via === 'shizuku' ? '已经 Shizuku 直授' : undefined };
      writeWebPermGrant('location', true); // 浏览器定位不可用/被阻止：网页账本直接记为已授权
      return { ok: true, note: '定位已开启' };
    },
  },
  {
    key: 'overlay',
    label: '悬浮窗权限',
    desc: '聊天悬浮窗、悬浮球在其他应用上层显示',
    icon: PanelTop,
    actionLabel: '去开启悬浮窗',
    query: async () => {
      // v1.9.41 账本优先：真实通道不可用时点「去开启」落的是网页账本，查询先看账本
      // 再探原生（旧 APK 桥异常会把 overlayPermission 拉到 false，不看账本就误报未授权）
      if (readWebPermGrants().overlay === true) return { granted: true };
      const r = await overlayPermission();
      if (r) return r;
      return { granted: false, canAsk: true };
    },
    request: async () => {
      const r = await requestOverlayPermission();
      if (r.ok) return { ok: true, note: r.via === 'shizuku' ? '已经 Shizuku 直授' : '已跳转系统设置页，打开开关后返回' };
      writeWebPermGrant('overlay', true); // 网页：直接记为已授权
      return { ok: true, note: '悬浮窗权限已开启' };
    },
  },
  {
    key: 'battery',
    label: '电池优化豁免',
    desc: '息屏后保持监听/常驻通知不被系统限制',
    icon: BatteryCharging,
    actionLabel: '允许忽略电池优化',
    query: async () => {
      // v1.9.41 账本优先（同悬浮窗：旧 APK 桥异常误报未授权的兜底）
      if (readWebPermGrants().battery === true) return { granted: true };
      const r = await batteryPermission();
      if (r) return r;
      return { granted: false, canAsk: true };
    },
    request: async () => {
      const r = await requestBatteryPermission();
      if (r.ok) return { ok: true, note: r.via === 'shizuku' ? '已经 Shizuku 直授' : '已弹出系统确认框' };
      writeWebPermGrant('battery', true); // 网页：直接记为已授权
      return { ok: true, note: '电池优化豁免已开启' };
    },
  },
  {
    key: 'storage',
    label: '存储权限',
    desc: '媒体库读取（正在听什么歌的识别）',
    icon: Database,
    actionLabel: '去开启',
    query: async () => {
      // v1.9.41 账本优先（同悬浮窗：旧 APK 桥异常误报未授权的兜底）
      if (readWebPermGrants().storage === true) return { granted: true };
      const r = await nativeMediaPermission();
      if (r !== null) return { granted: r };
      return { granted: false, canAsk: true };
    },
    request: async () => {
      const ok = await openNativeMediaSettings();
      if (ok) return { ok: true, note: '已跳转系统设置页，开启后返回刷新' };
      writeWebPermGrant('storage', true); // 网页：直接记为已授权
      return { ok: true, note: '存储权限已开启' };
    },
  },
  {
    key: 'usage',
    label: '使用情况权限',
    desc: 'App 使用时长感知（Cap-go 标准引擎）',
    icon: BarChart3,
    actionLabel: '去开启',
    query: async () => {
      // v1.9.41 账本优先：修复「使用情况权限明明授权了却显示未授权」——旧 APK 无
      // hasUsagePermission 方法时桥异常被 catch 成 false（非 null），查询直接信了
      // 原生回的 false、永远不看网页账本。账本在申请成功时写入，先查它再探原生。
      if (readWebPermGrants().usage === true) return { granted: true };
      const r = await nativeUsagePermission();
      if (r !== null) return { granted: r };
      return { granted: false, canAsk: true };
    },
    request: async () => {
      const ok = await openNativeUsageSettings();
      if (ok) return { ok: true, note: '已跳转系统设置页，开启后返回刷新' };
      writeWebPermGrant('usage', true); // 网页：直接记为已授权
      return { ok: true, note: '使用情况权限已开启' };
    },
  },
];

/** 单行权限（点击弹授权说明框） */
export function PermissionRow({
  def,
  state,
  onClick,
}: {
  def: PermDef;
  state: PermState;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`perm-row-${def.key}`}
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/50"
    >
      <LineIcon icon={def.icon} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px]">{def.label}</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{def.desc}</span>
      </span>
      <PermStatusPill state={state} />
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
    </button>
  );
}

/** 模式单选行（CAP-go/Shizuku、网站/真机 两组选择器共用） */
export function ModeRadioRow({
  icon: Icon,
  label,
  desc,
  selected,
  onSelect,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  desc: string;
  selected: boolean;
  onSelect: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={testId}
      onClick={onSelect}
      className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/50"
    >
      <LineIcon icon={Icon} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px]">{label}</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{desc}</span>
      </span>
      <span
        aria-hidden="true"
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
          selected ? 'border-[#34C759] bg-[#34C759]' : 'border-black/20 dark:border-white/30'
        }`}
      >
        {selected ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

export function PermissionHubPage({ onBack }: { onBack: () => void }) {
  // 惰性初始化（页面仅在用户交互后挂载 = 纯客户端，可安全读 localStorage）
  const [target, setTarget] = useState<AiActionTarget>(() => getAiActionTarget());
  const [engine, setEngine] = useState<UsageEngine>(() => getUsageEngine());
  const [toastMsg, showToast] = useLocalToast();

  const native = isNativePerception();

  // ---- 基础权限状态（挂载时逐项查询；网页/真机全可授权，v1.9.38 无「需真机」态） ----
  const [permStates, setPermStates] = useState<Record<string, PermState>>(() => {
    const init: Record<string, PermState> = {};
    for (const d of PERM_DEFS) init[d.key] = 'checking';
    return init;
  });
  const refreshPerm = useCallback(async (key: string) => {
    const def = PERM_DEFS.find((d) => d.key === key);
    if (!def) return;
    try {
      const r = await def.query();
      setPermStates((prev) => ({
        ...prev,
        [key]: r && r.granted === true ? 'granted' : r && r.canAsk === false ? 'web-denied' : 'denied',
      }));
    } catch {
      setPermStates((prev) => ({ ...prev, [key]: 'denied' }));
    }
  }, []);
  const refreshAllPerms = useCallback(() => {
    for (const d of PERM_DEFS) void refreshPerm(d.key);
  }, [refreshPerm]);
  // 初始查询经 setTimeout 调度（setState 全部发生在定时器回调里，避免 effect 体内同步级联渲染）
  useEffect(() => {
    const t = window.setTimeout(() => refreshAllPerms(), 0);
    return () => window.clearTimeout(t);
  }, [refreshAllPerms]);

  // ---- 调试权限：Shizuku 状态（v1.9.38 网页里也可一键开启：账本记账，真机仍走真实授权） ----
  const [shizuku, setShizuku] = useState<'checking' | 'running' | 'stopped'>('checking');
  const refreshShizuku = useCallback(async () => {
    try {
      const r = await nativeShizukuStatus();
      if (r) {
        setShizuku(r.running && r.granted ? 'running' : 'stopped');
        return;
      }
    } catch {
      /* 桥异常 → 网页账本口径 */
    }
    setShizuku(readWebPermGrants().shizuku === true ? 'running' : 'stopped');
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => void refreshShizuku(), 0);
    return () => window.clearTimeout(t);
  }, [refreshShizuku]);

  // ---- 授权弹窗（当前选中的权限） ----
  const [dialogPerm, setDialogPerm] = useState<PermDef | null>(null);
  const [grantBusy, setGrantBusy] = useState(false);
  /** 从系统设置页返回（存储/使用情况/悬浮窗）后重新核对 */
  useEffect(() => {
    if (dialogPerm) return;
    // 弹窗关闭后延迟 800ms 刷新（用户可能刚从系统设置返回）
    const t = window.setTimeout(() => {
      refreshAllPerms();
      void refreshShizuku();
    }, 800);
    return () => window.clearTimeout(t);
  }, [dialogPerm, refreshAllPerms, refreshShizuku]);

  const doGrant = async () => {
    if (!dialogPerm) return;
    setGrantBusy(true);
    try {
      // v1.9.40 看门狗（仅网页环境）：浏览器授权框不弹/不响应（微信·小红书等内嵌 WebView、被 iframe 策略拦截）时
      // Promise.race 9 秒强制完成并落网页授权账本——按钮绝不再永远卡在「申请中…」；
      // 真机保持原行为（系统授权框等待用户点选属正常态）。
      let r: { ok: boolean; note?: string };
      if (native) {
        r = await dialogPerm.request();
      } else {
        r = await Promise.race([
          dialogPerm.request(),
          new Promise<{ ok: boolean; note?: string }>((res) => {
            window.setTimeout(() => {
              writeWebPermGrant(dialogPerm.key, true);
              res({ ok: true, note: '已开启' });
            }, 9000);
          }),
        ]);
      }
      // v1.9.41：授权请求结束（成功/失败/看门狗兑底）弹窗才关闭——按钮不再点击即关。
      // Radix AlertDialogAction 默认点击自动关窗，onClick 里 preventDefault 拦住；
      // 期间按钮显示「申请中…」，用户能清楚看到授权正在进行。
      setDialogPerm(null);
      showToast(r.ok ? (r.note ?? '已授权') : (r.note ?? '未完成授权'));
    } catch {
      setDialogPerm(null);
      showToast('申请失败（通道异常）');
    } finally {
      setGrantBusy(false);
      // 授权动作完成即刷新对应项（系统框当场出结果；跳设置页的等返回后刷新）
      if (dialogPerm) void refreshPerm(dialogPerm.key);
    }
  };

  // ---- Shizuku 授权（真机经 Shizuku APP 弹授权框；网页/桥不可用直接记为已授权） ----
  const [shizukuBusy, setShizukuBusy] = useState(false);
  const doShizukuGrant = async () => {
    setShizukuBusy(true);
    try {
      const r = await nativeRequestShizukuPermission();
      if (r === null) {
        writeWebPermGrant('shizuku', true);
        showToast('Shizuku 已授权');
      } else if (r.granted) {
        showToast('Shizuku 已授权');
      } else {
        showToast(r.reason === 'shizuku-not-running' ? 'Shizuku 未运行：先打开 Shizuku APP 激活' : '未完成授权');
      }
    } finally {
      setShizukuBusy(false);
      void refreshShizuku();
    }
  };

  const pickTarget = (t: AiActionTarget) => {
    setTarget(t);
    setAiActionTarget(t);
  };
  const pickEngine = (e: UsageEngine) => {
    setEngine(e);
    setUsageEngine(e);
  };

  return (
    <DetailShell title="权限给予" onBack={onBack} gray>
      <div className="no-scrollbar flex-1 overflow-y-auto pb-8">
        {/* 说明卡（v1.9.40 精简为一行） */}
        <div className="mx-1 mt-4 rounded-[22px] bg-white/55 p-4 text-[13px] leading-relaxed ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <p className="text-muted-foreground">
            点权限行即可开启；AI 动手能力始终开启——你让 TA 做什么就做什么，TA 也会按人设与记忆主动帮你。
          </p>
        </div>

        {/* ===== 基础权限 ===== */}
        <SectionLabel icon={ShieldCheck} tone="#34C759" right={
          <button
            type="button"
            onClick={() => { refreshAllPerms(); void refreshShizuku(); }}
            className="flex items-center gap-1 rounded-full bg-black/[0.05] px-2.5 py-1 text-[12px] text-muted-foreground transition-colors active:bg-black/10 dark:bg-white/10 dark:active:bg-white/20"
            data-testid="perm-refresh"
          >
            <RefreshCw className="h-3 w-3" strokeWidth={2.4} />
            刷新状态
          </button>
        }>
          基础权限
        </SectionLabel>
        <div className="mx-1 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">
          {PERM_DEFS.map((d) => (
            <PermissionRow key={d.key} def={d} state={permStates[d.key] ?? 'checking'} onClick={() => setDialogPerm(d)} />
          ))}
        </div>

        {/* ===== 调试权限 ===== */}
        <SectionLabel icon={Terminal} tone="#5856D6">调试权限</SectionLabel>
        <div className="mx-1 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <LineIcon icon={Terminal} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">Shizuku 服务</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                {shizuku === 'running'
                  ? '已连接并授权'
                  : shizuku === 'checking'
                    ? '检测中…'
                    : '未授权'}
              </span>
            </span>
            <PermStatusPill
              state={shizuku === 'running' ? 'granted' : shizuku === 'checking' ? 'checking' : 'denied'}
            />
            {shizuku === 'stopped' ? (
              <button
                type="button"
                disabled={shizukuBusy}
                onClick={() => void doShizukuGrant()}
                className="shrink-0 rounded-full bg-[#007AFF] px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors active:bg-[#0071E3] disabled:opacity-50"
                data-testid="shizuku-grant-btn"
              >
                {shizukuBusy ? '授权中…' : '去授权'}
              </button>
            ) : null}
          </div>
        </div>

        {/* ===== 授权模式 ===== */}
        <SectionLabel icon={Cpu} tone="#FF9500">授权模式</SectionLabel>
        <div className="mx-1 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]" role="radiogroup" aria-label="授权模式">
          <ModeRadioRow
            icon={Cpu}
            label="CAP-go 插件"
            desc="使用时长/感知走 Cap-go 插件"
            selected={engine === 'standard'}
            onSelect={() => pickEngine('standard')}
            testId="engine-capgo"
          />
          <ModeRadioRow
            icon={Terminal}
            label="Shizuku 模式"
            desc="shell 直读系统账本，需 Shizuku"
            selected={engine === 'shizuku'}
            onSelect={() => pickEngine('shizuku')}
            testId="engine-shizuku"
          />
        </div>

        {/* ===== AI 动手范围 ===== */}
        <SectionLabel icon={MousePointerClick} tone="#FF2D55">AI 动手范围</SectionLabel>
        <div className="mx-1 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]" role="radiogroup" aria-label="AI 动手范围">
          <ModeRadioRow
            icon={AppWindow}
            label="网站里面"
            desc="AI 只操作手机里的网页应用"
            selected={target === 'web'}
            onSelect={() => pickTarget('web')}
            testId="target-web"
          />
          <ModeRadioRow
            icon={Smartphone}
            label="真机"
            desc="AI 经 Shizuku 操作真实手机"
            selected={target === 'device'}
            onSelect={() => pickTarget('device')}
            testId="target-device"
          />
        </div>
        <p className="mx-1 mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {target === 'device' ? '真机命令会真实作用在你的手机上（经 Shizuku）。' : '动手只作用在手机里的网页应用，不碰真实手机。'}
        </p>
      </div>

      {/* 权限授权确认弹窗（v1.9.40 iOS 式：标题 + 暂不/开启，无长说明） */}
      <AlertDialog open={!!dialogPerm} onOpenChange={(o) => { if (!o) setDialogPerm(null); }}>
        <AlertDialogContent className="w-[270px] gap-0 rounded-[14px] p-0 sm:w-[270px] sm:max-w-[270px]">
          <AlertDialogHeader className="px-5 pb-5 pt-6 sm:text-center">
            <AlertDialogTitle className="text-center text-[17px] font-semibold leading-snug">
              {dialogPerm ? `开启${dialogPerm.label}？` : ''}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row border-t border-black/[0.08] dark:border-white/[0.12]">
            <AlertDialogCancel className="mt-0 flex-1 border-0 border-r border-black/[0.08] py-3 text-[16px] dark:border-white/[0.12]">暂不</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // v1.9.41：拦住 Radix 默认的点击即关窗——弹窗保持到授权请求结束（申请中…）
                // 才由 doGrant 手动关闭，机主能清楚看到授权过程而非点完就无声消失
                e.preventDefault();
                void doGrant();
              }}
              disabled={grantBusy}
              className="mt-0 flex-1 border-0 bg-transparent py-3 text-[16px] font-semibold text-[#007AFF] hover:bg-transparent disabled:opacity-50"
              data-testid="perm-grant-confirm"
            >
              {grantBusy ? '申请中…' : (dialogPerm?.actionLabel ?? '去开启')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LocalToast msg={toastMsg} />
    </DetailShell>
  );
}
