'use client';

/**
 * 感知设置页（聊天设置二级页，微信/QQ/信息三端共用）：
 *
 * 让 AI 感知真实世界的开关组（按会话独立，@/lib/perception localStorage 持久化，默认全关）：
 *  - 基础感知：打字思考耗时 / 设备电量 / 日历·节假日（农历+倒计时）
 *  - 天气感知：我的所在地 + TA 的所在地（角色所在地的天气让 TA 能说「我这边下雨了」）
 *  - 真机感知（ActivityWatch）：屏幕使用时间 / 正在玩什么App / 前台切换记录 / 解锁事件 /
 *    媒体播放 / 浏览器URL / 今日统计 —— 数据来自用户真实手机上的 ActivityWatch App
 *  - 看屏幕（VLM）：串流地址（手机）或浏览器屏幕分享（桌面）→ 发送时抓帧识图
 *
 * 交互细节：开关即点即存（下一次发送现场读取，无需重启）；地址/位置输入失焦保存；
 * ActivityWatch 与串流地址都有「测试连接」；屏幕分享需在用户手势中授权（持续流，跨页保持）。
 */

import { useEffect, useRef, useState } from 'react';
import {
  BatteryCharging,
  CalendarDays,
  ChevronLeft,
  CloudSun,
  Eye,
  Keyboard,
  Loader2,
  MonitorSmartphone,
  Music2,
  Globe,
  RotateCcw,
  ScanFace,
  ScanSearch,
  Smartphone,
  Timer,
  Unlock,
} from 'lucide-react';
import { ChatToggle } from './chat-settings';
import { useChatSkin } from '@/lib/ios/chat-skin';
import { LocalToast, useLocalToast } from './page-toast';
import {
  buildPerceptionBlock,
  getPerception,
  setPerception,
  prewarmPerception,
  type PerceptionConfig,
} from '@/lib/perception';
import { fetchAwSnapshot, testAwConnection } from '@/lib/ios/activitywatch';
import {
  isScreenShareActive,
  isScreenShareSupported,
  startScreenShare,
  stopScreenShare,
  testStreamUrl,
} from '@/lib/ios/screen-share';
import {
  isNativePerception,
  nativeUsagePermission,
  openNativeUsageSettings,
  nativeMediaPermission,
  nativeMediaSupported,
  openNativeMediaSettings,
  requestNativeScreenCapture,
  stopNativeScreenCapture,
  nativeShizukuStatus,
  nativeRequestShizukuPermission,
  getUsageEngine,
  setUsageEngine,
  type UsageEngine,
} from '@/lib/ios/native-perception';

/** 开关行（图标 + 名称 + 说明 + 开关） */
function ToggleRow({
  icon,
  title,
  desc,
  on,
  onChange,
  accent,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  on: boolean;
  onChange: (v: boolean) => void;
  accent: string;
  testId: string;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
      <span className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className="shrink-0 text-black/55 dark:text-white/55">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15.5px]">{title}</span>
          {desc ? <span className="mt-0.5 block text-[12px] leading-tight text-black/40 dark:text-white/40">{desc}</span> : null}
        </span>
      </span>
      <ChatToggle on={on} onChange={onChange} accent={accent} testId={testId} label={title} />
    </div>
  );
}

/** 设置行左侧小图标 */
const I = { size: 19, strokeWidth: 1.9 } as const;

/** 原生壳内的 APK 下载链接：安卓 WebView 默认不处理 <a download>（无下载监听，
 *  旧版 APK 点 apk 链接毫无反应），改走 intent:// 协议 —— Capacitor Bridge 会把
 *  intent: 前缀的 URL 转成系统 Intent → 唤起外部浏览器（Chrome 等）下载 APK。
 *  intent:// 语法：intent://<host+path>#Intent;scheme=<scheme>;action=VIEW;end */
function buildApkIntentHref(): string | null {
  if (typeof window === 'undefined') return null;
  const proto = window.location.protocol.replace(':', '');
  if (proto !== 'https' && proto !== 'http') return null;
  return `intent://${window.location.host}/AI-Phone.apk#Intent;scheme=${proto};action=android.intent.action.VIEW;end`;
}

/** 复制 APK 直链（intent:// 被个别壳拦截时的备用路径：粘贴到任意浏览器打开） */
async function copyApkLink(markCopied: (v: boolean) => void): Promise<void> {
  if (typeof window === 'undefined') return;
  const url = new URL('/AI-Phone.apk', window.location.href).href;
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
  setTimeout(() => markCopied(false), 2500);
}

export function PerceptionSettingsPage({
  variant,
  sessionKey,
  peerName,
  onBack,
}: {
  variant: 'wx' | 'qq' | 'sms';
  /** 会话键（wx:<id> / qq:<id> / sms:<storageKey>；感知配置按它隔离） */
  sessionKey: string;
  /** 角色名（天气区「TA 的所在地」标签展示用；可空） */
  peerName?: string;
  onBack: () => void;
}) {
  const wx = variant === 'wx';

  // 主题 token（与 ChatSettingsPage / ProactiveMsgPage 一致）
  const skin = useChatSkin();
  const pageCls = skin.retro
    ? 'rt-root text-black dark:text-white'
    : skin.liquid
      ? 'lg-root text-black dark:text-white'
      : wx
        ? 'bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white'
        : 'bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white';
  const barCls = skin.retro ? 'rt-bar' : '';
  const cardCls = skin.retro
    ? 'rounded-[6px] bg-white dark:bg-[#1A1A1A]'
    : wx
      ? 'rounded-[10px] bg-white dark:bg-[#1A1A1A]'
      : 'rounded-[14px] bg-white dark:bg-[#232529]';
  const dividerCls = wx ? 'border-black/5 dark:border-white/10' : 'border-black/[0.04] dark:border-white/[0.06]';
  const titleCls = wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold';
  const headerH = wx ? 'h-11' : 'h-12';
  const testPrefix = variant;
  const accent = wx ? '#07C160' : variant === 'sms' ? '#34C759' : '#0099FF';
  const fieldCls =
    'h-10 w-full min-w-0 rounded-[10px] border border-black/[0.08] bg-white px-3.5 text-[15px] outline-none placeholder:text-black/25 focus:border-black/30 dark:border-white/[0.12] dark:bg-white/[0.05] dark:placeholder:text-white/25 dark:focus:border-white/35';

  const [toast, showToast] = useLocalToast();
  // 页面仅在用户交互后挂载 = 纯客户端渲染，惰性初始化（写穿持久化）
  const [cfg, setCfg] = useState<PerceptionConfig>(() => getPerception(sessionKey));
  const [userLocDraft, setUserLocDraft] = useState(cfg.userLoc);
  const [aiLocDraft, setAiLocDraft] = useState(cfg.aiLoc);
  const [awUrlDraft, setAwUrlDraft] = useState(cfg.awUrl);
  const [streamUrlDraft, setStreamUrlDraft] = useState(cfg.streamUrl);
  const [awTesting, setAwTesting] = useState(false);
  const [awResult, setAwResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [streamTesting, setStreamTesting] = useState(false);
  const [streamResult, setStreamResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [shareActive, setShareActive] = useState(() => isScreenShareActive());
  // ---------------- APP 壳原生模式（UsageStats / 媒体监听 / MediaProjection） ----------------
  const nativeMode = isNativePerception();
  const [usageGranted, setUsageGranted] = useState<boolean | null>(null);
  const [mediaGranted, setMediaGranted] = useState<boolean | null>(null);
  // 媒体桥能力：null = 探测中；false = 旧版 APK（无音乐感知，引导重装）；true = 新 APK
  const [mediaSupported, setMediaSupported] = useState<boolean | null>(null);
  const [nativeSessionOn, setNativeSessionOn] = useState(false);
  // ---------------- 时长数据源（v1.2 双引擎：标准 Cap-go / Shizuku） ----------------
  const [usageEngine, setUsageEngineState] = useState<UsageEngine>(() => getUsageEngine());
  // undefined = 探测中；null = 旧版 APK 不支持；对象 = Shizuku 实时状态
  const [shizuku, setShizuku] = useState<{ running: boolean; granted: boolean; version: number } | null | undefined>(undefined);
  const [shizukuRequesting, setShizukuRequesting] = useState(false);
  // 自检结果（逐步打印；null = 未跑过）
  const [selfTesting, setSelfTesting] = useState(false);
  const [selfTestSteps, setSelfTestSteps] = useState<{ ok: boolean | null; text: string }[] | null>(null);
  // 旧版 APK 内下载引导：复制链接成功提示
  const [apkLinkCopied, setApkLinkCopied] = useState(false);
  // 授权状态记录（检测「刚授权」时刻：强制刷数据击穿授权前留下的 45s 空缓存）
  const grantSeenRef = useRef<boolean | null>(null);
  // 原生模式挂载即查 UsageStats/媒体权限；从系统授权页回来时刷新（页面 onShow 时 Cap 桥不会自动回调，用轻轮询）
  useEffect(() => {
    if (!nativeMode) return;
    let alive = true;
    const probe = () => {
      void nativeUsagePermission().then((g) => {
        if (!alive || g === null) return;
        // 授权刚生效：立即强制取一次真机数据（否则空缓存会让 TA 继续盲 45 秒）
        if (g === true && grantSeenRef.current !== true) {
          void fetchAwSnapshot(getPerception(sessionKey).awUrl, true).catch(() => null);
        }
        grantSeenRef.current = g;
        setUsageGranted(g);
      });
      // 媒体能力与（新版壳上的）通知使用权状态同步探（旧壳时 nativeMediaPermission 自守卫直接回 null）
      void nativeMediaSupported().then((s) => {
        if (!alive) return;
        setMediaSupported(s);
      });
      void nativeMediaPermission().then((g) => {
        if (!alive || g === null) return;
        setMediaGranted(g);
      });
      // Shizuku 状态（时长数据源引擎 B；旧壳探测失败回 null = 不支持）
      void nativeShizukuStatus().then((s) => {
        if (!alive) return;
        setShizuku(s && typeof s.running === 'boolean' ? { running: !!s.running, granted: !!s.granted, version: s.version ?? 0 } : null);
      });
    };
    probe();
    const t = window.setInterval(probe, 3000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [nativeMode, sessionKey]);

  const openUsageGrant = async () => {
    const ok = await openNativeUsageSettings();
    if (ok) showToast('已跳转系统设置：找到 AI Phone 开「有权查看使用情况」');
  };

  const openMediaGrant = async () => {
    const ok = await openNativeMediaSettings();
    if (ok) showToast('已跳转系统设置：找到 AI Phone 开「通知使用权」（读歌名需要）');
  };

  /** 切换时长数据源（全局设置；立即击穿缓存重新取样） */
  const pickUsageEngine = (e: UsageEngine) => {
    if (e === usageEngine) return;
    setUsageEngine(e);
    setUsageEngineState(e);
    void fetchAwSnapshot(getPerception(sessionKey).awUrl, true).catch(() => null);
    showToast(
      e === 'shizuku'
        ? '已切换 Shizuku 模式：未就绪时自动降级标准模式'
        : '已切换标准模式（Cap-go 事件级精确配对）',
    );
  };

  /** 拉起 Shizuku 授权（会打开 Shizuku APP 的授权弹窗） */
  const requestShizukuGrant = async () => {
    if (shizukuRequesting) return;
    setShizukuRequesting(true);
    try {
      const r = await nativeRequestShizukuPermission();
      if (r && r.ok && r.granted) {
        showToast('Shizuku 已授权：时长统计升级为系统账本直读');
        void fetchAwSnapshot(getPerception(sessionKey).awUrl, true).catch(() => null);
      } else if (r && r.reason === 'not-running') {
        showToast('Shizuku 未运行：先在 Shizuku APP 里激活，再回来授权');
      } else if (r && r.reason === 'timeout') {
        showToast('授权超时：在 Shizuku 弹窗里点「允许」后再试');
      } else {
        showToast('未完成授权（可在 Shizuku APP 里手动允许）');
      }
    } finally {
      setShizukuRequesting(false);
    }
  };

  const onNativeCapture = async () => {
    const r = await requestNativeScreenCapture();
    if (r === 'ok') {
      setNativeSessionOn(true);
      showToast('屏幕感知已开启：发送消息时 TA 能「看到」你的整块手机屏幕');
    } else if (r === 'canceled') {
      showToast('已取消授权（每次会话需授权一次）');
    } else {
      showToast('当前环境不支持原生屏幕感知');
    }
  };

  const offNativeCapture = () => {
    void stopNativeScreenCapture();
    setNativeSessionOn(false);
    showToast('已停止屏幕感知');
  };

  // ---------------- 真机感知自检（排查「TA 不知道」：环境 → 权限 → 数据 → AI 收到的块） ----------------

  /** 毫秒 → 「X分钟 / X小时Y分」 */
  const fmtMs = (ms: number): string => {
    const m = Math.max(1, Math.round(ms / 60_000));
    if (m < 60) return `${m} 分钟`;
    return `${Math.floor(m / 60)} 小时${m % 60 > 0 ? ` ${m % 60} 分` : ''}`;
  };

  /** Android WebView UA 特征（; wv)）：区分「装了 APP 但桥未注入」和「纯浏览器」 */
  const inAndroidWebView = (): boolean =>
    typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent) && navigator.userAgent.includes('; wv)');

  const runSelfTest = async () => {
    setSelfTesting(true);
    const steps: { ok: boolean | null; text: string }[] = [];
    const push = (ok: boolean | null, text: string): void => {
      steps.push({ ok, text });
      setSelfTestSteps([...steps]);
    };
    try {
      // ① 运行环境
      if (nativeMode) {
        push(true, '运行环境：安装版 APP 内，原生桥已连接');
        // ② 系统权限
        const granted = await nativeUsagePermission();
        if (granted === null) {
          push(false, '系统权限：原生桥无响应（插件异常）');
        } else if (granted) {
          push(true, '系统权限：「有权查看使用情况」已开启');
        } else {
          push(false, '系统权限：未开启 —— 点上方「去授权」，在系统设置里找到 AI Phone 打开');
        }
        // ②b 媒体权限（通知使用权：读歌名/歌手）
        const mediaOk = await nativeMediaPermission();
        if (mediaOk === true) {
          push(true, '媒体权限：「通知使用权」已开启（可读歌名/歌手）');
        } else if (mediaOk === false) {
          push(false, '媒体权限：「通知使用权」未开启 —— 想让 TA 知道你在听什么歌，点上方「去授权」');
        }
        // ③ 实时数据（force 击穿旧缓存，同时把结果写入缓存供下一次发送直接用）
        if (granted === true || getUsageEngine() === 'shizuku') {
          const snap = await fetchAwSnapshot(getPerception(sessionKey).awUrl, true);
          if (snap) {
            const parts: string[] = [];
            if (snap.current) parts.push(`正在用 ${snap.current.app}`);
            if (snap.todayApps && snap.todayApps.length > 0) {
              parts.push(`今日Top：${snap.todayApps.slice(0, 3).map((x) => `${x.app} ${fmtMs(x.ms)}`).join('、')}`);
            }
            if (snap.todayTotalMs && snap.todayTotalMs > 0) parts.push(`总时长 ${fmtMs(snap.todayTotalMs)}`);
            if (snap.media && snap.media.title) parts.push(`正在听 ${snap.media.app}《${snap.media.title}》`);
            if (snap.engine) {
              const engineName = snap.engine === 'capgo'
                ? 'Cap-go 标准引擎'
                : snap.engine === 'shizuku'
                  ? 'Shizuku 系统账本'
                  : '原生标准引擎';
              parts.push(`数据引擎：${engineName}${snap.engineNote ? `（${snap.engineNote}）` : ''}`);
            }
            push(true, `实时数据：${parts.length > 0 ? parts.join('；') : '今日暂无使用记录（刚开机/统计需几分钟累计）'}`);
          } else {
            push(false, '实时数据：未取到 —— 刚授权后系统统计需要几分钟开始累计，稍后再试');
          }
        }
      } else if (inAndroidWebView()) {
        push(
          false,
          '运行环境：你在 APP 里，但原生桥未注入 —— 说明服务器地址不是 https 开头。请在 APP 首页退出后用 https:// 开头的地址重新进入',
        );
      } else {
        push(false, '运行环境：浏览器/网页 —— 原生真机感知只在安装版 APP 里生效，网页里开的真机开关无效');
      }
      // ④ AI 实际收到的感知块（两种环境都查；这是 TA 能不能知道的最终判据）
      const block = buildPerceptionBlock(sessionKey);
      const dataLines = block
        .split('\n')
        .filter((l) => l && !l.startsWith('【') && !l.startsWith('（以上'))
        .map((l) => l.trim());
      if (dataLines.length > 0) {
        push(true, `AI 感知块：已生成（${dataLines.length} 行），发送消息时 TA 能收到：${dataLines.slice(0, 3).join(' ｜ ')}`.slice(0, 220));
      } else {
        push(false, 'AI 感知块：为空 —— 本会话没有任何可用感知数据（检查本页开关是否开启、数据源是否可用）');
      }
    } catch (e) {
      push(false, `自检中断：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSelfTesting(false);
    }
  };

  // 屏幕分享状态轻轮询（用户可能从浏览器原生 UI 停止共享，页面状态需跟随）
  useEffect(() => {
    const t = window.setInterval(() => setShareActive(isScreenShareActive()), 2000);
    return () => window.clearInterval(t);
  }, []);

  /** 更新并持久化（即点即存，下一次发送现场读取生效）+ 预热相关数据 */
  const update = (patch: Partial<PerceptionConfig>) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      setPerception(sessionKey, patch);
      return next;
    });
    void prewarmPerception(sessionKey);
    // 真机/AW 开关刚打开：强制刷一次数据（击穿开关关闭期间可能留下的 45s 空缓存）
    const awKeys: (keyof PerceptionConfig)[] = [
      'screenTime', 'currentApp', 'appHistory', 'unlocks', 'media', 'browser', 'stats',
    ];
    if (awKeys.some((k) => patch[k] === true)) {
      void fetchAwSnapshot(getPerception(sessionKey).awUrl, true).catch(() => null);
    }
  };

  const saveLoc = () => {
    if (userLocDraft.trim() === cfg.userLoc && aiLocDraft.trim() === cfg.aiLoc) return;
    update({ userLoc: userLocDraft.trim(), aiLoc: aiLocDraft.trim() });
    showToast('位置已保存，天气将自动更新');
  };

  const saveAwUrl = () => {
    const v = awUrlDraft.trim();
    if (v === cfg.awUrl) return;
    update({ awUrl: v });
    showToast(v ? '地址已保存' : '已清空地址');
  };

  const saveStreamUrl = () => {
    const v = streamUrlDraft.trim();
    if (v === cfg.streamUrl) return;
    update({ streamUrl: v });
    showToast(v ? '串流地址已保存' : '已清空串流地址');
  };

  const runAwTest = async () => {
    setAwTesting(true);
    setAwResult(null);
    try {
      const r = await testAwConnection(awUrlDraft.trim() || 'http://localhost:5600');
      setAwResult(r);
    } finally {
      setAwTesting(false);
    }
  };

  const runStreamTest = async () => {
    setStreamTesting(true);
    setStreamResult(null);
    try {
      const r = await testStreamUrl(streamUrlDraft.trim());
      setStreamResult(r);
    } finally {
      setStreamTesting(false);
    }
  };

  const onShare = async () => {
    const ok = await startScreenShare();
    setShareActive(isScreenShareActive());
    showToast(ok ? '屏幕分享已开始：发送消息时 TA 能「看到」你的屏幕' : '未能开始屏幕分享（浏览器不支持或已取消）');
  };

  const offShare = () => {
    stopScreenShare();
    setShareActive(false);
    showToast('已停止屏幕分享');
  };

  return (
    <div className={`absolute inset-0 z-40 flex h-full w-full flex-col ${pageCls}`} data-testid={`${testPrefix}-perception-page`}>
      <LocalToast msg={toast} />
      {/* 顶栏 */}
      <div className={`shrink-0 pt-[54px] ${barCls}`}>
        <div className={`flex ${headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-perception-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${titleCls}`}>感知设置</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10 pt-2">
        {/* 说明卡 */}
        <div className={`${cardCls} px-4 py-3.5`}>
          <p className="text-[12.5px] leading-relaxed text-black/50 dark:text-white/50">
            开启后，AI 能在聊天中感知你的真实世界：回复耗时、设备电量、两地天气、农历节日，
            以及你真机上的屏幕使用情况。所有数据只在<span className="text-black/70 dark:text-white/70">你发送消息的瞬间</span>现场采集，
            仅用于生成 TA 的对话上下文。
          </p>
        </div>

        {/* 基础感知 */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className="px-4 pb-1 pt-3 text-[12.5px] font-medium text-black/40 dark:text-white/40">基础感知</div>
          <div className={`border-t ${dividerCls}`} />
          <ToggleRow
            icon={<Keyboard size={I.size} strokeWidth={I.strokeWidth} />}
            title="打字思考感知"
            desc="TA 能感知你回复前思考+打字了多久（含纯打字时长）"
            on={cfg.typing}
            onChange={(v) => update({ typing: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-typing`}
          />
          <div className={`border-t ${dividerCls}`} />
          <ToggleRow
            icon={<BatteryCharging size={I.size} strokeWidth={I.strokeWidth} />}
            title="电量感知"
            desc="TA 能知道你当前设备的电量与充电状态（浏览器电量权限）"
            on={cfg.battery}
            onChange={(v) => update({ battery: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-battery`}
          />
          <div className={`border-t ${dividerCls}`} />
          <ToggleRow
            icon={<CalendarDays size={I.size} strokeWidth={I.strokeWidth} />}
            title="日历 / 节假日感知"
            desc="公历+农历日期、星期、节假日、最近节日倒计时"
            on={cfg.calendar}
            onChange={(v) => update({ calendar: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-calendar`}
          />
        </div>

        {/* 天气感知 */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <ToggleRow
            icon={<CloudSun size={I.size} strokeWidth={I.strokeWidth} />}
            title="天气感知"
            desc="填两个城市，TA 知道两边天气、能聊「我这边下雨了」"
            on={cfg.weather}
            onChange={(v) => update({ weather: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-weather`}
          />
          {cfg.weather ? (
            <>
              <div className={`border-t ${dividerCls}`} />
              <div className="space-y-2.5 px-4 py-3">
                <div>
                  <p className="mb-1.5 text-[12.5px] text-black/45 dark:text-white/45">我的所在地（城市名）</p>
                  <input
                    value={userLocDraft}
                    onChange={(e) => setUserLocDraft(e.target.value)}
                    onBlur={saveLoc}
                    placeholder="如：上海"
                    data-testid={`${testPrefix}-perception-userloc-input`}
                    className={fieldCls}
                  />
                </div>
                <div>
                  <p className="mb-1.5 text-[12.5px] text-black/45 dark:text-white/45">
                    {peerName ? `TA（${peerName}）的所在地` : 'TA 的所在地'}（角色所在城市，TA 会聊自己那边的天气）
                  </p>
                  <input
                    value={aiLocDraft}
                    onChange={(e) => setAiLocDraft(e.target.value)}
                    onBlur={saveLoc}
                    placeholder="如：东京"
                    data-testid={`${testPrefix}-perception-ailoc-input`}
                    className={fieldCls}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* 真机感知：APP 壳内原生 UsageStats（免装免配） → 否则 ActivityWatch */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className="px-4 pb-1 pt-3 text-[12.5px] font-medium text-black/40 dark:text-white/40">
            {nativeMode ? '真机感知 · APP 原生' : '真机感知 · ActivityWatch'}
          </div>
          <div className={`border-t ${dividerCls}`} />
          {nativeMode ? (
            <div className="space-y-2.5 px-4 py-3">
              <p className="text-[12px] leading-relaxed text-black/45 dark:text-white/45">
                安装版 APP 直读系统使用统计（无需装 ActivityWatch、无需填地址/穿透）；
                使用时长按前台会话精确计算（息屏不计入），时长数据源可在「标准 / Shizuku」双引擎间自选；
                想让 TA 知道你「在听什么歌」请再开下方通知使用权（解锁/浏览器URL 暂需 ActivityWatch）。
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[13px] font-medium ${usageGranted === true ? 'text-[#07C160]' : usageGranted === false ? 'text-[#E4554F]' : 'text-black/40 dark:text-white/40'}`}>
                  {usageGranted === true ? '✓ 使用情况权限已开启' : usageGranted === false ? '✗ 使用情况权限未开启' : '权限检测中…'}
                </span>
                <button
                  type="button"
                  onClick={() => void openUsageGrant()}
                  disabled={usageGranted === true}
                  data-testid={`${testPrefix}-perception-native-usage-grant`}
                  className="shrink-0 rounded-full px-3.5 py-2 text-[13px] font-medium text-white active:opacity-70 disabled:opacity-50"
                  style={{ backgroundColor: accent }}
                >
                  {usageGranted === true ? '已授权' : '去授权'}
                </button>
              </div>
              <p className="text-[12px] leading-snug text-black/35 dark:text-white/35">系统设置 →「有权查看使用情况」→ 找到 AI Phone 打开，一次授权长期有效。</p>
              <div className={`border-t ${dividerCls} my-0.5`} />
              {/* v1.2 时长数据源双引擎：标准（Cap-go 事件级配对）/ Shizuku（系统账本直读） */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-black/70 dark:text-white/70">时长数据源</span>
                  <span className="text-[11px] text-black/35 dark:text-white/35">全局设置 · 对所有会话生效</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => pickUsageEngine('standard')}
                    data-testid={`${testPrefix}-perception-engine-standard`}
                    className={`rounded-xl px-3 py-2.5 text-left active:opacity-70 ${
                      usageEngine === 'standard'
                        ? 'text-white'
                        : 'border text-black/60 dark:text-white/60'
                    }`}
                    style={
                      usageEngine === 'standard'
                        ? { backgroundColor: accent }
                        : undefined
                    }
                  >
                    <span className="block text-[13px] font-medium">标准模式</span>
                    <span className={`block text-[11px] leading-snug ${usageEngine === 'standard' ? 'text-white/75' : 'text-black/40 dark:text-white/40'}`}>
                      零额外配置 · 事件级精确配对
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => pickUsageEngine('shizuku')}
                    data-testid={`${testPrefix}-perception-engine-shizuku`}
                    className={`rounded-xl px-3 py-2.5 text-left active:opacity-70 ${
                      usageEngine === 'shizuku'
                        ? 'text-white'
                        : 'border text-black/60 dark:text-white/60'
                    }`}
                    style={
                      usageEngine === 'shizuku'
                        ? { backgroundColor: accent }
                        : undefined
                    }
                  >
                    <span className="block text-[13px] font-medium">Shizuku 模式</span>
                    <span className={`block text-[11px] leading-snug ${usageEngine === 'shizuku' ? 'text-white/75' : 'text-black/40 dark:text-white/40'}`}>
                      系统账本直读 · 最准
                    </span>
                  </button>
                </div>
                {usageEngine === 'standard' ? (
                  <p className="text-[12px] leading-snug text-black/40 dark:text-white/40">
                    标准模式：Cap-go 插件读系统使用事件，逐条配对计算（息屏不计、桌面不计、跨零点不串天），
                    且无需「使用情况」以外的任何配置，适合绝大多数情况。
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-[12px] leading-snug text-black/40 dark:text-white/40">
                      Shizuku 模式：以 shell 权限直读系统使用统计账本（dumpsys），与系统自身口径最接近，
                      且不依赖「使用情况」授权。需在手机上另装 Shizuku APP 并激活（每次重启手机后需重新激活）。
                    </p>
                    {shizuku === undefined ? (
                      <p className="text-[12px] text-black/35 dark:text-white/35">Shizuku 状态检测中…</p>
                    ) : shizuku === null ? (
                      <p className="text-[12px] leading-snug text-[#E4554F]">
                        当前 APP 版本不支持双引擎（看不到 Shizuku 状态）：用下方按钮更新到 v1.2 后可用；
                        更新前会自动用标准模式统计。
                      </p>
                    ) : !shizuku.running ? (
                      <p className="text-[12px] leading-snug text-[#E4554F]">
                        ✗ Shizuku 未运行（未安装或重启后未激活）—— 现在自动降级标准模式统计；
                        想启用：装 Shizuku APP → 手机「无线调试」配对激活 → 回这里授权。
                      </p>
                    ) : !shizuku.granted ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium text-[#E4554F]">Shizuku 已运行 · 待授权</span>
                          <button
                            type="button"
                            onClick={() => void requestShizukuGrant()}
                            disabled={shizukuRequesting}
                            data-testid={`${testPrefix}-perception-shizuku-grant`}
                            className="shrink-0 rounded-full px-3.5 py-2 text-[13px] font-medium text-white active:opacity-70 disabled:opacity-50"
                            style={{ backgroundColor: accent }}
                          >
                            {shizukuRequesting ? <Loader2 className="h-4 w-4 animate-spin" /> : '去授权'}
                          </button>
                        </div>
                        <p className="text-[12px] leading-snug text-black/35 dark:text-white/35">
                          点「去授权」会打开 Shizuku 的授权弹窗，允许后时长统计即切换为系统账本直读。
                        </p>
                      </div>
                    ) : (
                      <p className="text-[12px] leading-snug text-[#07C160]">
                        ✓ Shizuku 已就绪（v{shizuku.version || '?'}）：时长数据以系统账本直读，注意每次重启手机后需在 Shizuku APP 里重新激活（未激活时自动降级标准模式）。
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className={`border-t ${dividerCls} my-0.5`} />
              {mediaSupported === false ? (
                <div className="space-y-1.5">
                  <p className="text-[13px] font-medium text-[#E4554F]">当前 APP 是旧版本（不能读歌名/用双引擎）</p>
                  <p className="text-[12px] leading-snug text-black/40 dark:text-white/40">
                    音乐感知（歌名/歌手）、精确使用时长与双引擎（Cap-go 标准 / Shizuku）需要新版 APP。会覆盖安装，数据都在服务器/本地存储里不会丢。
                  </p>
                  {(() => {
                    // 安卓 WebView 默认不处理 <a download>（旧版 APK 没有下载监听，点 apk 链接毫无反应）。
                    // 原生壳内改走 intent:// 协议：Capacitor Bridge 会把 intent: 转成系统 Intent
                    // → 唤起浏览器（Chrome 等）下载 APK；普通浏览器环境仍用普通直链。
                    const intentHref = nativeMode ? buildApkIntentHref() : null;
                    if (!nativeMode) {
                      return (
                        <a
                          href="/AI-Phone.apk"
                          download
                          className="block w-full rounded-full py-2 text-center text-[13.5px] font-medium text-white active:opacity-70"
                          style={{ backgroundColor: accent }}
                        >
                          下载新版 APP（v1.2）
                        </a>
                      );
                    }
                    return (
                      <div className="space-y-2">
                        <a
                          href={intentHref ?? '/AI-Phone.apk'}
                          className="block w-full rounded-full py-2 text-center text-[13.5px] font-medium text-white active:opacity-70"
                          style={{ backgroundColor: accent }}
                        >
                          下载新版 APP（v1.2）
                        </a>
                        <p className="text-[12px] leading-snug text-black/40 dark:text-white/40">
                          点按钮会跳到手机浏览器（Chrome 等）开始下载；下载完从顶部下拉通知栏点开安装。
                          若浏览器提示「不允许安装未知应用」，按提示允许该浏览器安装即可。
                        </p>
                        <button
                          type="button"
                          onClick={() => void copyApkLink(setApkLinkCopied)}
                          data-testid={`${testPrefix}-perception-apk-copy`}
                          className="block w-full rounded-full border border-black/10 py-2 text-center text-[13px] font-medium text-black/55 active:opacity-70 dark:border-white/15 dark:text-white/55"
                        >
                          {apkLinkCopied ? '✓ 已复制，去浏览器粘贴打开' : '备用：复制下载链接'}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[13px] font-medium ${mediaGranted === true ? 'text-[#07C160]' : mediaGranted === false ? 'text-[#E4554F]' : 'text-black/40 dark:text-white/40'}`}>
                      {mediaGranted === true ? '✓ 通知使用权已开启（可读歌名）' : mediaGranted === false ? '✗ 通知使用权未开启（不知道歌名）' : '媒体权限检测中…'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void openMediaGrant()}
                      disabled={mediaGranted === true}
                      data-testid={`${testPrefix}-perception-native-media-grant`}
                      className="shrink-0 rounded-full px-3.5 py-2 text-[13px] font-medium text-white active:opacity-70 disabled:opacity-50"
                      style={{ backgroundColor: accent }}
                    >
                      {mediaGranted === true ? '已授权' : '去授权'}
                    </button>
                  </div>
                  <p className="text-[12px] leading-snug text-black/35 dark:text-white/35">系统设置 →「通知使用权」/「设备和应用通知」→ 找到 AI Phone 打开（播放音乐时 TA 能读到歌名歌手）。</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2 px-4 py-3">
              <p className="text-[12px] leading-relaxed text-black/45 dark:text-white/45">
                在真实手机安装开源的 ActivityWatch App（F-Droid / Play 商店）并开启服务，
                TA 就能感知你真机的屏幕使用。地址填手机上 ActivityWatch 的服务地址；
                由于浏览器安全限制，跨设备访问需让该地址公网可达（内网穿透），本机浏览器访问可填 http://localhost:5600。
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={awUrlDraft}
                  onChange={(e) => setAwUrlDraft(e.target.value)}
                  onBlur={saveAwUrl}
                  placeholder="http://localhost:5600"
                  inputMode="url"
                  data-testid={`${testPrefix}-perception-awurl-input`}
                  className={fieldCls}
                />
                <button
                  type="button"
                  onClick={() => void runAwTest()}
                  disabled={awTesting}
                  data-testid={`${testPrefix}-perception-aw-test`}
                  className="shrink-0 rounded-full px-3.5 py-2 text-[13px] font-medium text-white active:opacity-70 disabled:opacity-50"
                  style={{ backgroundColor: accent }}
                >
                  {awTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : '测试'}
                </button>
              </div>
              {awResult ? (
                <p className={`text-[12px] leading-snug ${awResult.ok ? 'text-[#07C160]' : 'text-[#E4554F]'}`}>{awResult.detail}</p>
              ) : null}
            </div>
          )}
          {/* 真机感知自检：环境 → 权限 → 实时数据 → AI 收到的感知块，一步步给出结论 */}
          <div className={`border-t ${dividerCls}`} />
          <div className="px-4 py-3">
            <button
              type="button"
              onClick={() => void runSelfTest()}
              disabled={selfTesting}
              data-testid={`${testPrefix}-perception-selftest`}
              className="flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-[13.5px] font-medium text-white active:opacity-70 disabled:opacity-60"
              style={{ backgroundColor: accent }}
            >
              {selfTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch size={16} strokeWidth={2} />}
              {selfTesting ? '自检中…' : '真机感知自检（TA 能看到什么？）'}
            </button>
            {selfTestSteps ? (
              <div className="mt-2.5 max-h-64 space-y-1.5 overflow-y-auto rounded-lg bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.05]">
                {selfTestSteps.map((s, i) => (
                  <p
                    key={i}
                    className={`text-[12px] leading-snug ${
                      s.ok === true ? 'text-[#07C160]' : s.ok === false ? 'text-[#E4554F]' : 'text-black/50 dark:text-white/50'
                    }`}
                  >
                    {s.ok === true ? '✓ ' : s.ok === false ? '✗ ' : '· '}
                    {s.text}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <div className={`border-t ${dividerCls}`} />
          <ToggleRow
            icon={<Timer size={I.size} strokeWidth={I.strokeWidth} />}
            title="屏幕使用时间"
            desc="今日真机分 App 使用时长与总时长"
            on={cfg.screenTime}
            onChange={(v) => update({ screenTime: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-screentime`}
          />
          <div className={`border-t ${dividerCls}`} />
          <ToggleRow
            icon={<Smartphone size={I.size} strokeWidth={I.strokeWidth} />}
            title="正在玩什么 App"
            desc="此刻真机前台应用及已持续时长"
            on={cfg.currentApp}
            onChange={(v) => update({ currentApp: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-currentapp`}
          />
          <div className={`border-t ${dividerCls}`} />
          <ToggleRow
            icon={<RotateCcw size={I.size} strokeWidth={I.strokeWidth} />}
            title="前台 App 切换记录"
            desc="近期切换过哪些 App（时间线）"
            on={cfg.appHistory}
            onChange={(v) => update({ appHistory: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-apphistory`}
          />
          <div className={`border-t ${dividerCls}`} />
          <ToggleRow
            icon={<Unlock size={I.size} strokeWidth={I.strokeWidth} />}
            title="解锁事件"
            desc="今日解锁次数、最近一次与凌晨解锁"
            on={cfg.unlocks}
            onChange={(v) => update({ unlocks: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-unlocks`}
          />
          <div className={`border-t ${dividerCls}`} />
          <ToggleRow
            icon={<Music2 size={I.size} strokeWidth={I.strokeWidth} />}
            title="媒体播放"
            desc={nativeMode ? '正在听的歌/看的视频（歌名歌手；需上方通知使用权）' : '真机正在听的歌 / 看的视频（歌名歌手）'}
            on={cfg.media}
            onChange={(v) => update({ media: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-media`}
          />
          <div className={`border-t ${dividerCls}`} />
          <ToggleRow
            icon={<Globe size={I.size} strokeWidth={I.strokeWidth} />}
            title="浏览器 URL"
            desc="真机正在浏览的网页（需开无障碍权限）"
            on={cfg.browser}
            onChange={(v) => update({ browser: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-browser`}
          />
          <div className={`border-t ${dividerCls}`} />
          <ToggleRow
            icon={<MonitorSmartphone size={I.size} strokeWidth={I.strokeWidth} />}
            title="今日统计聚合"
            desc="总时长 / 切换次数 / 最长单次的汇总"
            on={cfg.stats}
            onChange={(v) => update({ stats: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-stats`}
          />
        </div>

        {/* 看屏幕 · VLM */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <ToggleRow
            icon={<Eye size={I.size} strokeWidth={I.strokeWidth} />}
            title="让 TA 看到我的屏幕"
            desc="发送消息时抓一帧屏幕给识图模型，TA 能「看到」你此刻在看什么"
            on={cfg.vlmScreen}
            onChange={(v) => update({ vlmScreen: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-vlmscreen`}
          />
          {cfg.vlmScreen ? (
            <>
              <div className={`border-t ${dividerCls}`} />
              <div className="space-y-2.5 px-4 py-3">
                {nativeMode ? (
                  <>
                    <p className="text-[12px] leading-relaxed text-black/45 dark:text-white/45">
                      APP 原生屏幕感知：点下方按钮授权一次（本轮会话有效），TA 就能「看到」你整块手机屏幕
                      （含其他 App），每次发送时抓一帧识图。桌面浏览器用户用下方串流/分享方式。
                    </p>
                    {nativeSessionOn ? (
                      <button
                        type="button"
                        onClick={offNativeCapture}
                        data-testid={`${testPrefix}-perception-native-capture-stop`}
                        className="w-full rounded-full bg-[#E4554F] py-2 text-[13.5px] font-medium text-white active:opacity-70"
                      >
                        停止屏幕感知（进行中）
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void onNativeCapture()}
                        data-testid={`${testPrefix}-perception-native-capture-start`}
                        className="w-full rounded-full py-2 text-[13.5px] font-medium text-white active:opacity-70"
                        style={{ backgroundColor: accent }}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <ScanFace size={15} strokeWidth={1.9} />
                          开启屏幕感知（授权一次）
                        </span>
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-[12px] leading-relaxed text-black/45 dark:text-white/45">
                      两种画面来源（优先串流地址）：手机装串流 App（能输出 MJPEG/单帧画面的均可）填下方地址；
                      电脑上直接用浏览器「屏幕分享」，零配置。
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        value={streamUrlDraft}
                        onChange={(e) => setStreamUrlDraft(e.target.value)}
                        onBlur={saveStreamUrl}
                        placeholder="串流地址（如 http://192.168.1.5:8080）"
                        inputMode="url"
                        data-testid={`${testPrefix}-perception-streamurl-input`}
                        className={fieldCls}
                      />
                      <button
                        type="button"
                        onClick={() => void runStreamTest()}
                        disabled={streamTesting || !streamUrlDraft.trim()}
                        data-testid={`${testPrefix}-perception-stream-test`}
                        className="shrink-0 rounded-full px-3.5 py-2 text-[13px] font-medium text-white active:opacity-70 disabled:opacity-50"
                        style={{ backgroundColor: accent }}
                      >
                        {streamTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : '测试'}
                      </button>
                    </div>
                    {streamResult ? (
                      <p className={`text-[12px] leading-snug ${streamResult.ok ? 'text-[#07C160]' : 'text-[#E4554F]'}`}>{streamResult.detail}</p>
                    ) : null}
                    {isScreenShareSupported() ? (
                      <div className="flex items-center gap-2 pt-0.5">
                        {shareActive ? (
                          <button
                            type="button"
                            onClick={offShare}
                            data-testid={`${testPrefix}-perception-share-stop`}
                            className="flex-1 rounded-full bg-[#E4554F] py-2 text-[13.5px] font-medium text-white active:opacity-70"
                          >
                            停止屏幕分享（进行中）
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void onShare()}
                            data-testid={`${testPrefix}-perception-share-start`}
                            className="flex-1 rounded-full py-2 text-[13.5px] font-medium text-white active:opacity-70"
                            style={{ backgroundColor: accent }}
                          >
                            <span className="inline-flex items-center gap-1.5">
                              <ScanFace size={15} strokeWidth={1.9} />
                              选择要分享的屏幕 / 窗口
                            </span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-[12px] text-black/35 dark:text-white/35">当前浏览器不支持屏幕分享（多数手机浏览器如此），请使用串流地址。</p>
                    )}
                  </>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
