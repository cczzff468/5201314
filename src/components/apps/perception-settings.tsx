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

import { useEffect, useState } from 'react';
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
  Smartphone,
  Timer,
  Unlock,
} from 'lucide-react';
import { ChatToggle } from './chat-settings';
import { useChatSkin } from '@/lib/ios/chat-skin';
import { LocalToast, useLocalToast } from './page-toast';
import {
  getPerception,
  setPerception,
  prewarmPerception,
  type PerceptionConfig,
} from '@/lib/perception';
import { testAwConnection } from '@/lib/ios/activitywatch';
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
  requestNativeScreenCapture,
  stopNativeScreenCapture,
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
  // ---------------- APP 壳原生模式（UsageStats / MediaProjection） ----------------
  const nativeMode = isNativePerception();
  const [usageGranted, setUsageGranted] = useState<boolean | null>(null);
  const [nativeSessionOn, setNativeSessionOn] = useState(false);
  // 原生模式挂载即查 UsageStats 权限；从系统授权页回来时刷新（页面 onShow 时 Cap 桥不会自动回调，用轻轮询）
  useEffect(() => {
    if (!nativeMode) return;
    let alive = true;
    const probe = () => {
      void nativeUsagePermission().then((g) => {
        if (alive && g !== null) setUsageGranted(g);
      });
    };
    probe();
    const t = window.setInterval(probe, 3000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [nativeMode]);

  const openUsageGrant = async () => {
    const ok = await openNativeUsageSettings();
    if (ok) showToast('已跳转系统设置：找到 AI Phone 开「有权查看使用情况」');
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
                安装版 APP 直读系统使用统计（无需装 ActivityWatch、无需填地址/穿透）。
                在下方开关按需开启；「解锁事件 / 媒体播放 / 浏览器 URL」暂需 ActivityWatch，其余原生即用。
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
            desc="真机正在听的歌 / 看的视频（歌名歌手）"
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
