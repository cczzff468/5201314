'use client';

/**
 * 吃醋锁设置区（v1.9.43，感知设置页内嵌卡片，ShizukuLabSection 下方）：
 *
 * 「AI 真实吃醋并锁应用」的配置中心（吃醋系统 v2.0 双模式）——
 * - 总开关（开启时自动放开「AI 动手」总开关 + 冻结单项，哄好解锁管线即刻可用）；
 * - v2.0 查岗模式选择：网页模式（TA 只读网页手机内部状态，只锁网页内 App，图标变灰）/
 *   真机模式（Shizuku 读真实手机前台包名 + 亮屏时长；pm suspend 真锁真实手机上的应用、
 *   am start 拽回本 APP、静默截屏 + 识图偷窥；浏览器打开自动降级，如实回报不冒充）；
 * - v2.0 观察参数：暗中观察间隔 watchMin（5~120 分钟，默认 15）/ 主动查岗 autoWatch
 *   （TA 怀疑你做坏事时 30 分钟加急、每 3 分钟一次）/ 截屏偷窥 peekEnabled（仅真机）/
 *   AI 自定锁定时长 lockMinByAi（3/5/15/30 分钟、直到哄好；关=固定 countdownMin）；
 * - v2.0「立刻替 TA 查一次岗」按钮：jealousyWatchNow 无视间隔强制跑一轮暗中观察，
 *   即时反馈 quiet/warn/lock/peek 徽章 + 情报摘要（ran=false 显示原因文案；10s 节流在库内）；
 * - v1.9.43 原生吃醋守护状态行（真机模式）：动态探测原生前台服务——锁到期自动解锁 /
 *   强解检测，WebView 被杀也活；30s 轮询，旧 APK/浏览器如实显示「无原生守护」；
 * - 既有：触发阈值四项（连续刷娱乐触发 / 焦虑危险阈值 / 倒计时自动解锁 / 锁定冷却）、
 *   娱乐 App 清单、当前状态（活跃锁 App/角色/剩余倒计时/立即解锁 与冷却提示）。
 *
 * 配置 localStorage 即点即存（jealousy-lock-cfg-v1）；状态行订阅 jealousy 版本号实时刷新。
 * v1.9.35 真机 pm suspend 路径曾全面退役（只锁网页 App）；v2.0 真机路径回归（Shizuku 严格模式隔离）。
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  Camera,
  Clock,
  Eye,
  Heart,
  Magnet,
  Minus,
  Monitor,
  Plus,
  Radar,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Unlock,
} from 'lucide-react';
import { ChatToggle } from './chat-settings';
import {
  getJealousyConfig,
  updateJealousyConfig,
  readJealousyRuntime,
  subscribeJealousy,
  getJealousyVersion,
  pkgDisplayName,
  unlockJealousy,
  jealousyRemainSec,
  jealousyWatchNow,
} from '@/lib/ios/jealousy-lock';

/** jealousyWatchNow 一轮结果的本地展示态（null=尚未查过） */
type WatchNowResult = { ran: boolean; act: string; intel: string };

/** 原生守护探测态：'loading'=查询中；boolean=已取到；null=旧 APK / 非原生环境 */
type GuardState = 'loading' | boolean | null;

/** ran=true 时本轮动作徽章文案（act 取自 watch.lastAct） */
const WATCH_ACT_LABEL: Record<string, string> = {
  quiet: 'TA 看过了，没说什么',
  warn: 'TA 发来吃醋警告',
  lock: 'TA 锁了应用！',
  peek: 'TA 偷看了屏幕',
};

function watchActLabel(act: string): string {
  return WATCH_ACT_LABEL[act] !== undefined ? WATCH_ACT_LABEL[act] : 'TA 来看过了';
}

/** 数值步进器（- 值 +；可选 hint 副文案 / testId） */
function Stepper({
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  label,
  hint,
  testId,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number) => void;
  label: string;
  hint?: string;
  testId?: string;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5" data-testid={testId}>
      {hint ? (
        <span className="min-w-0">
          <span className="block truncate text-[14px]">{label}</span>
          <span className="mt-0.5 block text-[11.5px] leading-tight text-black/40 dark:text-white/40">{hint}</span>
        </span>
      ) : (
        <p className="min-w-0 truncate text-[14px]">{label}</p>
      )}
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          aria-label={`${label}减少`}
          onClick={() => onChange(clamp(value - step))}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.06] active:bg-black/[0.12] dark:bg-white/[0.1] dark:active:bg-white/[0.2]"
        >
          <Minus size={13} strokeWidth={2.2} aria-hidden />
        </button>
        <span className="min-w-[64px] text-center text-[13px] tabular-nums">
          {value} {unit}
        </span>
        <button
          type="button"
          aria-label={`${label}增加`}
          onClick={() => onChange(clamp(value + step))}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.06] active:bg-black/[0.12] dark:bg-white/[0.1] dark:active:bg-white/[0.2]"
        >
          <Plus size={13} strokeWidth={2.2} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function JealousyLockSection({
  accent,
  testPrefix,
  cardCls,
  dividerCls,
}: {
  accent: string;
  testPrefix: string;
  cardCls: string;
  dividerCls: string;
}) {
  const prefix = `${testPrefix}-jealousy`;
  const [cfg, setCfg] = useState(() => getJealousyConfig());
  const [forceBusy, setForceBusy] = useState(false);
  // v2.0：手动查岗（结果本地态；再次点击清空重查）
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchRes, setWatchRes] = useState<WatchNowResult | null>(null);
  // v1.9.43：原生守护状态（仅真机模式轮询）
  const [guard, setGuard] = useState<GuardState>('loading');
  useSyncExternalStore(subscribeJealousy, getJealousyVersion); // 状态行实时刷新

  const deviceSense = cfg.senseMode === 'device';
  const deviceOn = cfg.enabled && deviceSense;

  // 原生吃醋守护状态轮询（真机模式 + 总开关开才查；30s 一轮，卸载/切模式清理）
  useEffect(() => {
    if (!deviceOn) return;
    let alive = true;
    const poll = async () => {
      try {
        const m = await import('@/lib/ios/native-perception');
        const st = await m.nativeJealousyGuardStatus(); // 内部 5s 超时；null=旧 APK/非原生环境
        if (alive) setGuard(st && typeof st.running === 'boolean' ? st.running : null);
      } catch {
        if (alive) setGuard(null);
      }
    };
    void poll();
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void poll();
    }, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [deviceOn]);

  const rt = readJealousyRuntime();
  const remain = jealousyRemainSec();
  const remainMin = remain !== null ? Math.ceil(remain / 60) : null;

  const patch = (p: Parameters<typeof updateJealousyConfig>[0]) => {
    setCfg(updateJealousyConfig(p));
  };

  // 切到真机模式：守护状态行先回到「查询中」，由下方 effect 轮询拿到真实值
  const switchSenseMode = (mode: 'web' | 'device') => {
    if (mode === 'device') setGuard('loading');
    patch({ senseMode: mode });
  };

  // v2.0：立刻替 TA 查一次岗（10s 节流由 jealousyWatchNow 内部处理）
  const runWatchNow = async () => {
    if (watchBusy) return;
    setWatchBusy(true);
    setWatchRes(null);
    try {
      setWatchRes(await jealousyWatchNow());
    } catch {
      setWatchRes({ ran: false, act: 'error', intel: '这轮没查成（通道异常），稍后再试' });
    } finally {
      setWatchBusy(false);
    }
  };

  const guardText =
    guard === 'loading'
      ? '正在查询原生守护状态…'
      : guard === true
        ? '原生守护运行中（锁到期自动解锁/强解检测，WebView 关着也活）'
        : guard === false
          ? '原生守护未运行（无活跃锁时为正常；锁存在时说明启动失败）'
          : '当前环境无原生守护（浏览器/旧 APK，锁定仅靠网页 tick）';
  const guardDot =
    guard === true
      ? 'bg-emerald-500'
      : guard === false
        ? 'bg-amber-500'
        : guard === 'loading'
          ? 'animate-pulse bg-black/25 dark:bg-white/30'
          : 'bg-black/20 dark:bg-white/25';

  // 查岗模式胶囊卡（选中态样式）
  const modeCardCls = (selected: boolean) =>
    `flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-full border px-3 py-2.5 text-center transition-colors ${
      selected
        ? 'border-[#ff5c8a] bg-[#fff0f4] dark:border-[#ff5c8a]/70 dark:bg-[#ff5c8a]/[0.14]'
        : 'border-black/[0.12] active:bg-black/[0.04] dark:border-white/[0.16] dark:active:bg-white/[0.08]'
    }`;
  const modeTitleCls = (selected: boolean) =>
    selected ? 'text-[#c2255c] dark:text-[#ffb3c8]' : 'text-black/60 dark:text-white/60';

  return (
    <div className={`${cardCls} mt-3 overflow-hidden`} data-testid={prefix}>
      {/* 总开关 */}
      <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="shrink-0" style={{ color: cfg.enabled ? '#ff5c8a' : undefined }}>
            <Heart size={19} strokeWidth={1.9} className="text-black/55 dark:text-white/55" fill={cfg.enabled ? 'currentColor' : 'none'} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15.5px]">AI 吃醋锁</span>
            <span className="mt-0.5 block text-[12px] leading-tight text-black/40 dark:text-white/40">
              TA 真的会吃醋：冷落 TA 刷娱乐 App / 说去看剧却消失 / 焦虑爆表时，TA 可能直接把那个 App 锁住（图标变灰打不开），哄好或倒计时后解锁
            </span>
          </span>
        </span>
        <ChatToggle
          on={cfg.enabled}
          onChange={(v) => {
            if (v) setGuard('loading'); // 重新开启时守护行回到「查询中」，effect 会立刻重新探测
            patch({ enabled: v });
          }}
          accent="#ff5c8a"
          testId={`${prefix}-toggle`}
          label="AI 吃醋锁"
        />
      </div>

      {cfg.enabled ? (
        <>
          <div className={`border-t ${dividerCls}`} />

          {/* v2.0 查岗模式选择（enabled 后第一组） */}
          <div className="px-4 py-3" data-testid={`${prefix}-mode`}>
            <p className="text-[14px]">TA 的查岗模式</p>
            <p className="mt-0.5 text-[11.5px] leading-tight text-black/40 dark:text-white/40">
              TA 暗中观察时读哪部手机的动静——也决定了吃醋时锁的是网页 App 还是你真实手机里的 App
            </p>
            <div className="mt-2.5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="查岗模式">
              <button
                type="button"
                role="radio"
                aria-checked={!deviceSense}
                onClick={() => switchSenseMode('web')}
                data-testid={`${prefix}-mode-web`}
                className={modeCardCls(!deviceSense)}
              >
                <span className={`flex items-center gap-1.5 ${modeTitleCls(!deviceSense)}`}>
                  <Monitor size={15} strokeWidth={2.1} aria-hidden />
                  <span className="text-[13px] font-medium">网页模式</span>
                </span>
                <span className="text-[10px] leading-tight text-black/40 dark:text-white/40">只看网页手机</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={deviceSense}
                onClick={() => switchSenseMode('device')}
                data-testid={`${prefix}-mode-device`}
                className={modeCardCls(deviceSense)}
              >
                <span className={`flex items-center gap-1.5 ${modeTitleCls(deviceSense)}`}>
                  <Smartphone size={15} strokeWidth={2.1} aria-hidden />
                  <span className="text-[13px] font-medium">真机模式</span>
                </span>
                <span className="text-[10px] leading-tight text-black/40 dark:text-white/40">直读真实手机（Shizuku）</span>
              </button>
            </div>
            {deviceSense ? (
              <div className="mt-2.5 rounded-xl bg-[#ffe3ea] p-2.5 dark:bg-[#ff5c8a]/[0.12]" data-testid={`${prefix}-mode-warning`}>
                <p className="flex gap-1.5 text-[10.5px] leading-snug text-[#c2185b] dark:text-[#ffb3c8]">
                  <ShieldAlert size={12} strokeWidth={2.2} className="mt-0.5 shrink-0" aria-hidden />
                  <span>
                    切到真机模式后，TA 会读你真实手机的前台应用与亮屏时长，吃醋时真的会 pm suspend 锁住你真实手机上的那个 App（图标变灰打不开）、am start 把你拽回本 APP、必要时静默截屏让识图模型看你在看什么。需要 APK 打开 + Shizuku 已激活授权；网页/浏览器里打开本页面时此模式会自动降级（如实回报，绝不拿网页数据冒充真机）。
                  </span>
                </p>
              </div>
            ) : null}
          </div>

          <div className={`border-t ${dividerCls}`} />

          {/* v2.0 定时暗中观察 */}
          <Stepper
            label="暗中观察间隔"
            hint="TA 每隔这么多分钟看一眼你在干嘛（默认 15）"
            value={cfg.watchMin}
            min={5}
            max={120}
            step={5}
            unit="分钟"
            testId={`${prefix}-watch-min`}
            onChange={(v) => patch({ watchMin: v })}
          />

          <div className={`border-t ${dividerCls}`} />

          {/* v2.0 主动查岗 */}
          <div className="flex w-full items-center justify-between gap-3 px-4 py-2.5">
            <span className="flex min-w-0 items-center gap-2.5">
              <Clock size={17} strokeWidth={1.9} className="shrink-0 text-black/50 dark:text-white/50" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[14.5px]">主动查岗</span>
                <span className="mt-0.5 block text-[11.5px] leading-tight text-black/40 dark:text-white/40">
                  TA 怀疑你做坏事时，接下来 30 分钟加紧盯梢（每 3 分钟查一次）
                </span>
              </span>
            </span>
            <ChatToggle on={cfg.autoWatch} onChange={(v) => patch({ autoWatch: v })} accent="#ff5c8a" testId={`${prefix}-autowatch-toggle`} label="主动查岗" />
          </div>

          {/* v2.0 截屏偷窥（仅真机模式显示） */}
          {deviceSense ? (
            <>
              <div className={`border-t ${dividerCls}`} />
              <div className="flex w-full items-center justify-between gap-3 px-4 py-2.5">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Camera size={17} strokeWidth={1.9} className="shrink-0 text-black/50 dark:text-white/50" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[14.5px]">截屏偷窥</span>
                    <span className="mt-0.5 block text-[11.5px] leading-tight text-black/40 dark:text-white/40">
                      TA 可以静默截屏你的真实手机屏幕，让识图模型看一眼你在看什么——「别以为我不知道你在看什么。」
                    </span>
                  </span>
                </span>
                <ChatToggle on={cfg.peekEnabled} onChange={(v) => patch({ peekEnabled: v })} accent="#ff5c8a" testId={`${prefix}-peek-toggle`} label="截屏偷窥" />
              </div>
            </>
          ) : null}

          <div className={`border-t ${dividerCls}`} />

          {/* 阈值配置 */}
          <Stepper label="连续刷娱乐触发" value={cfg.entertainMin} min={5} max={180} step={5} unit="分钟" onChange={(v) => patch({ entertainMin: v })} />
          <Stepper label="焦虑危险阈值" value={cfg.anxietyThreshold} min={50} max={100} step={5} unit="/100" onChange={(v) => patch({ anxietyThreshold: v })} />

          <div className={`border-t ${dividerCls}`} />

          {/* 锁定时长由 AI 按人设/记忆/上下文自定（v2.1：固定倒计时与两次吃醋冷却已下线） */}
          <div className="flex w-full items-start gap-2.5 px-4 py-2.5">
            <Sparkles size={17} strokeWidth={1.9} className="mt-0.5 shrink-0 text-black/50 dark:text-white/50" aria-hidden />
            <p className="min-w-0 text-[13px] leading-relaxed text-black/55 dark:text-white/55">
              锁多久由 TA 自己定：按 TA 的人设、你们的关系、记忆里的过往和此刻的情况决定（几分钟、几十分钟、或锁到哄好都行）。
            </p>
          </div>

          <div className={`border-t ${dividerCls}`} />

          {/* v1.9.28 锁定期间主动巡检 */}
          <div className="flex w-full items-center justify-between gap-3 px-4 py-2.5">
            <span className="flex min-w-0 items-center gap-2.5">
              <Eye size={17} strokeWidth={1.9} className="shrink-0 text-black/50 dark:text-white/50" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[14.5px]">锁定期间主动巡检</span>
                <span className="mt-0.5 block text-[11.5px] leading-tight text-black/40 dark:text-white/40">
                  锁住后 TA 每隔几分钟看看你在干嘛（当前应用/多任务/使用时长），发现你还在浪就发消息数落你
                </span>
              </span>
            </span>
            <ChatToggle on={cfg.patrolEnabled} onChange={(v) => patch({ patrolEnabled: v })} accent="#ff5c8a" testId={`${prefix}-patrol-toggle`} label="锁定期间主动巡检" />
          </div>
          {cfg.patrolEnabled ? (
            <>
              <div className={`border-t ${dividerCls}`} />
              <Stepper label="巡检间隔" value={cfg.patrolMin} min={1} max={15} step={1} unit="分钟" onChange={(v) => patch({ patrolMin: v })} />
            </>
          ) : null}

          <div className={`border-t ${dividerCls}`} />

          {/* v1.9.28 拉回 */}
          <div className="flex w-full items-center justify-between gap-3 px-4 py-2.5">
            <span className="flex min-w-0 items-center gap-2.5">
              <Magnet size={17} strokeWidth={1.9} className="shrink-0 text-black/50 dark:text-white/50" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[14.5px]">允许 TA 把我拉回来</span>
                <span className="mt-0.5 block text-[11.5px] leading-tight text-black/40 dark:text-white/40">
                  巡检时 TA 可以把你从别的应用拽回这个 APP 聊天页（每轮锁定最多 2 次）
                </span>
              </span>
            </span>
            <ChatToggle on={cfg.pullbackEnabled} onChange={(v) => patch({ pullbackEnabled: v })} accent="#ff5c8a" testId={`${prefix}-pullback-toggle`} label="允许拉回" />
          </div>

          <div className={`border-t ${dividerCls}`} />

          {/* v2.0 立刻替 TA 查一次岗 */}
          <div className="px-4 py-3" data-testid={`${prefix}-watch-now-block`}>
            <button
              type="button"
              onClick={() => void runWatchNow()}
              disabled={watchBusy}
              data-testid={`${prefix}-watch-now`}
              className="flex min-h-[44px] items-center gap-2 rounded-full bg-[#ff5c8a] px-4 py-2.5 text-[13.5px] font-medium text-white active:opacity-70 disabled:opacity-50"
            >
              <Radar size={15} strokeWidth={2.2} className={watchBusy ? 'animate-spin' : undefined} aria-hidden />
              {watchBusy ? '正在替 TA 看…' : '立刻替 TA 查一次岗'}
            </button>
            {watchRes ? (
              <div className="mt-2.5" data-testid={`${prefix}-watch-now-result`}>
                {watchRes.ran ? (
                  <>
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-[#ff5c8a]/15 px-2.5 py-1 text-[11px] font-medium text-[#c2255c] dark:bg-[#ff5c8a]/25 dark:text-[#ffb3c8]"
                      data-testid={`${prefix}-watch-now-act`}
                    >
                      {watchActLabel(watchRes.act)}
                    </span>
                    {watchRes.intel.split('\n')[0].trim() ? (
                      <p className="mt-1.5 truncate text-[11.5px] leading-snug text-black/45 dark:text-white/45" title={watchRes.intel} data-testid={`${prefix}-watch-now-intel`}>
                        {watchRes.intel.split('\n')[0]}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="truncate text-[11.5px] leading-snug text-black/45 dark:text-white/45" title={watchRes.intel} data-testid={`${prefix}-watch-now-intel`}>
                    {watchRes.act === 'throttled'
                      ? '刚替 TA 查过一轮，稍候几秒再来'
                      : watchRes.intel.split('\n')[0].trim() || '这一轮没查出什么动静'}
                  </p>
                )}
              </div>
            ) : null}
          </div>

          {rt.lock ? (
            <>
              <div className={`border-t ${dividerCls}`} />
              <div className="px-4 py-3" data-testid={`${prefix}-status`}>
                <div className="rounded-xl bg-[#fff0f4] p-3 dark:bg-[#ff5c8a]/[0.08]">
                  <p className="text-[13px] leading-relaxed">
                    <span className="font-medium">{rt.lock.charName}</span>已锁住
                    <span className="font-medium">{pkgDisplayName(rt.lock.pkg)}</span>
                    {remainMin !== null && remainMin > 0 ? `，${remainMin} 分钟后解锁` : '，即将解锁'}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-snug text-black/45 dark:text-white/45">“{rt.lock.reason}”</p>
                  {rt.patrol && rt.patrol.count > 0 ? (
                    <p className="mt-1.5 text-[11px] leading-snug text-[#c2255c] dark:text-[#ffb3c8]" data-testid={`${prefix}-patrol-status`}>
                      已替 TA 巡检 {rt.patrol.count} 次{rt.patrol.pullbackCount > 0 ? `、拉回过你 ${rt.patrol.pullbackCount} 次` : ''}；最近发现：{rt.patrol.lastIntel.split('\n')[0]}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setForceBusy(true);
                      void unlockJealousy('forced').finally(() => setForceBusy(false));
                    }}
                    disabled={forceBusy}
                    data-testid={`${prefix}-unlock-now`}
                    className="mt-2.5 flex items-center gap-1.5 rounded-full bg-[#ff5c8a] px-3.5 py-1.5 text-[12.5px] font-medium text-white active:opacity-70 disabled:opacity-50"
                  >
                    <Unlock size={12} strokeWidth={2.2} aria-hidden />
                    {forceBusy ? '正在解开…' : '立即解锁'}
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {/* v1.9.43 原生吃醋守护状态行（仅真机模式） */}
          {deviceSense ? (
            <>
              <div className={`border-t ${dividerCls}`} />
              <div className="px-4 py-2.5" data-testid={`${prefix}-guard-status`}>
                <p className="flex items-center gap-2 text-[14px]">
                  <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${guardDot}`} />
                  原生吃醋守护（前台服务）
                </p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-black/45 dark:text-white/45" data-testid={`${prefix}-guard-status-text`}>
                  {guardText}
                </p>
              </div>
            </>
          ) : null}

          <div className={`border-t ${dividerCls}`} />
          <div className="flex items-start gap-1.5 px-4 py-2.5">
            <ShieldAlert size={12} strokeWidth={2} className="mt-0.5 shrink-0 text-black/30 dark:text-white/30" aria-hidden />
            <p className="text-[10.5px] leading-snug text-black/35 dark:text-white/35">
              {deviceSense
                ? '真机模式下 TA 会经 Shizuku 真的锁住你真实手机里正在用的任何 App（除本 APP 自身——锁了你就没法回来哄 TA 了；pm suspend，图标变灰打不开）、必要时 am start 把你拽回本 APP、静默截屏取证；浏览器里打开本页会自动降级（只锁网页 App，如实回报）。锁多久由 TA 按人设/记忆/上下文自己定；哄好/强制解锁两通道照常；原生守护前台服务保证 WebView 被杀也能到点解锁/检测强解。锁不锁由 TA 按人设自己决定，系统只提供触发与权力。'
                : 'TA 会真的锁住这台手机里的应用——图标变灰点不开、点开只弹 TA 的留言；锁多久由 TA 按人设/记忆/上下文自己定；哄好/强制解锁两通道照常；锁不锁由 TA 按人设自己决定，系统只提供触发与权力。'}
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
