'use client';

/**
 * Shizuku 能力实验室（v1.3，感知设置页内嵌卡片）：
 *
 * 把「AI 动手 / AI 看见 / 自授权」三组能力逐项铺开，每项一个试用按钮 + 结果框——
 *  - 看见：静默截屏 / 前台应用 / 通知栏快照 / 正在播放 / 电量 / 剪贴板 / 短信 / 通话记录 / 系统日志；
 *  - 动手：点按 / 滑动（按屏幕分辨率算中心坐标）/ 打字 / 按键 / 打开·强杀·冻结·卸载 App /
 *    静默安装 APK / 媒体与音量控制 / Wi-Fi·流量·蓝牙开关；
 *  - 自授权：一键开「使用情况」「通知使用权」（cmd appops / cmd notification）。
 *
 * 交互红线：破坏性操作（强杀/冻结/卸载/安装/关网络）一律 window.confirm 二次确认；
 * 只读探测随点随看。所有命令最终经原生白名单（危险二进制一律拒绝）。
 * 结果框长内容走 max-h + overflow-y-auto + 细滚动条样式。
 */

import { useEffect, useState } from 'react';
import { Camera, Eye, Hand, KeyRound, Loader2, Smartphone, Zap } from 'lucide-react';
import {
  KEY_CODES,
  labBattery,
  labCallLog,
  labClipboard,
  labForceStop,
  labForegroundApp,
  labInputText,
  labInstallApk,
  labKey,
  labLogcat,
  labMediaKey,
  labNowPlaying,
  labNotificationSnapshot,
  labOpenApp,
  labScreencap,
  labScreenSize,
  labSelfGrantNotificationListener,
  labSelfGrantUsage,
  labSetAppFrozen,
  labSmsInbox,
  labSvc,
  labSwipe,
  labTap,
  labUninstall,
  labVolume,
  type LabResult,
} from '@/lib/ios/shizuku-lab';
import { nativeShizukuLabSupported } from '@/lib/ios/native-perception';

type LabOut = LabResult & { image?: string; ts: number };

/** 小圆角操作按钮（busy 时转圈） */
function Pill({
  label,
  onClick,
  busy,
  danger,
  disabled,
  testId,
  accent,
  small,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
  accent: string;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      data-testid={testId}
      className={`shrink-0 rounded-full font-medium text-white active:opacity-70 disabled:opacity-40 ${
        small ? 'px-2.5 py-1 text-[11.5px]' : 'px-3 py-1.5 text-[12.5px]'
      }`}
      style={{ backgroundColor: danger ? '#E4554F' : accent }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : label}
    </button>
  );
}

/** 结果框（长文本滚动 + 细滚动条；截屏结果直接出图） */
function OutBox({ r, testId }: { r: LabOut | undefined; testId: string }) {
  if (!r) return null;
  return (
    <div
      data-testid={testId}
      className={`mt-1.5 max-h-56 overflow-y-auto rounded-lg px-2.5 py-2 text-[11.5px] leading-snug ${
        r.ok ? 'bg-black/[0.04] text-black/75 dark:bg-white/[0.07] dark:text-white/80' : 'bg-[#E4554F]/10 text-[#E4554F]'
      } [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-black/20 dark:[&::-webkit-scrollbar-thumb]:bg-white/25`}
    >
      {r.image ? (
        <img src={r.image} alt="Shizuku 静默截屏结果" className="mb-1.5 w-full max-w-[248px] rounded-lg border border-black/10 dark:border-white/15" />
      ) : null}
      <p className="whitespace-pre-wrap break-all font-mono">{r.text}</p>
    </div>
  );
}

/** 小输入框（实验室行内用） */
function MiniInput({
  value,
  onChange,
  ariaLabel,
  testId,
  widthCls = 'w-16',
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  testId: string;
  widthCls?: string;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      data-testid={testId}
      className={`h-8 min-w-0 rounded-lg border border-black/10 bg-white px-2 text-[12px] outline-none focus:border-black/30 dark:border-white/15 dark:bg-white/[0.06] dark:focus:border-white/35 ${widthCls}`}
    />
  );
}

/** 能力行：标题/说明 + 右侧操作按钮（actions）；extra=整宽输入；out=结果框 */
function Row({
  title,
  desc,
  actions,
  extra,
  out,
  testId,
}: {
  title: string;
  desc?: string;
  actions: React.ReactNode;
  extra?: React.ReactNode;
  out?: React.ReactNode;
  testId: string;
}) {
  return (
    <div className="px-4 py-2.5" data-testid={testId}>
      <div className="flex items-center justify-between gap-2.5">
        <div className="min-w-0">
          <p className="truncate text-[14px]">{title}</p>
          {desc ? <p className="mt-0.5 text-[11.5px] leading-tight text-black/40 dark:text-white/40">{desc}</p> : null}
        </div>
        <div className="flex max-w-[62%] shrink-0 flex-wrap items-center justify-end gap-1.5">{actions}</div>
      </div>
      {extra}
      {out}
    </div>
  );
}

export function ShizukuLabSection({
  accent,
  testPrefix,
  cardCls,
  dividerCls,
  fieldCls,
  shizuku,
}: {
  accent: string;
  testPrefix: string;
  cardCls: string;
  dividerCls: string;
  fieldCls: string;
  /** 父页轮询的 Shizuku 状态（undefined 探测中 / null 旧 APK / 对象 实时状态） */
  shizuku: { running: boolean; granted: boolean; version: number } | null | undefined;
}) {
  const prefix = `${testPrefix}-perception-lab`;

  // v1.3 新桥探测：false = 旧版 APP（无 shizukuExec/shizukuScreencap 方法）
  const [labSupported, setLabSupported] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void nativeShizukuLabSupported().then((s) => {
      if (alive) setLabSupported(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const oldApk = labSupported === false || shizuku === null;
  const ready = !!shizuku && shizuku.running && shizuku.granted && labSupported === true;

  // 结果与忙碌态（按能力 id）
  const [outs, setOuts] = useState<Record<string, LabOut | undefined>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  // 动手区输入
  const [tapX, setTapX] = useState('540');
  const [tapY, setTapY] = useState('1600');
  const [typeText, setTypeText] = useState('');
  const [pkg, setPkg] = useState('com.tencent.mm');
  const [apkPath, setApkPath] = useState('/storage/emulated/0/Download/AI-Phone.apk');
  // 屏幕分辨率（滑动坐标用；懒取 + 兜底主流分辨率）
  const [screen, setScreen] = useState<{ w: number; h: number } | null>(null);

  const exec = async (id: string, fn: () => Promise<LabResult & { image?: string }>): Promise<void> => {
    if (busy[id]) return;
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const r = await fn();
      setOuts((prev) => ({ ...prev, [id]: { ...r, ts: Date.now() } }));
    } catch (e) {
      setOuts((prev) => ({ ...prev, [id]: { ok: false, text: `执行异常：${e instanceof Error ? e.message : String(e)}`, ts: Date.now() } }));
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  /** 破坏性操作二次确认 */
  const ask = (msg: string): boolean => window.confirm(msg);

  /** 滑动前确保拿到屏幕分辨率（取不到用 1080×2340 兜底） */
  const ensureScreen = async (): Promise<{ w: number; h: number }> => {
    if (!screen) {
      const s = await labScreenSize();
      if (s) setScreen(s);
      return s ?? { w: 1080, h: 2340 };
    }
    return screen;
  };

  const doSwipe = async (dir: 'up' | 'down' | 'left' | 'right'): Promise<void> => {
    const { w, h } = await ensureScreen();
    if (dir === 'up') await exec('swipe', () => labSwipe(w / 2, h * 0.78, w / 2, h * 0.22, 350));
    else if (dir === 'down') await exec('swipe', () => labSwipe(w / 2, 12, w / 2, h * 0.55, 350));
    else if (dir === 'left') await exec('swipe', () => labSwipe(w * 0.85, h / 2, w * 0.15, h / 2, 320));
    else await exec('swipe', () => labSwipe(w * 0.15, h / 2, w * 0.85, h / 2, 320));
  };

  const quickPkgs: { label: string; pkg: string }[] = [
    { label: '微信', pkg: 'com.tencent.mm' },
    { label: '抖音', pkg: 'com.ss.android.ugc.aweme' },
    { label: 'QQ', pkg: 'com.tencent.mobileqq' },
    { label: '淘宝', pkg: 'com.taobao.taobao' },
  ];

  return (
    <div className={`${cardCls} mt-3 overflow-hidden`} data-testid={`${prefix}-card`}>
      {/* 头部 */}
      <div className="flex items-center gap-2 px-4 pb-1 pt-3">
        <Zap size={15} strokeWidth={2} className="text-black/45 dark:text-white/45" aria-hidden />
        <span className="text-[12.5px] font-medium text-black/45 dark:text-white/45">Shizuku 能力实验室 · AI 动手/看见</span>
      </div>
      <div className={`border-t ${dividerCls}`} />
      <div className="px-4 py-2.5">
        <p className="text-[12px] leading-relaxed text-black/45 dark:text-white/45">
          以 shell 权限解锁的系统级能力点单（对应你勾的三张表）：看见 = 只读探测，动手 = 真实操作手机。
          命令一律经原生白名单（rm/dd/reboot 等危险命令直接拒绝）；破坏性操作都会先弹确认。
        </p>
        {labSupported === null && shizuku !== null ? (
          <p className="mt-1.5 text-[12px] text-black/35 dark:text-white/35">能力桥检测中…</p>
        ) : oldApk ? (
          <p className="mt-1.5 text-[12px] leading-snug text-[#E4554F]">
            当前 APP 版本还不支持能力实验室（需 v1.3）：点上方「APP 更新」下载安装后，这里就能逐项试用。
          </p>
        ) : shizuku === undefined ? (
          <p className="mt-1.5 text-[12px] text-black/35 dark:text-white/35">Shizuku 状态检测中…</p>
        ) : !shizuku.running ? (
          <p className="mt-1.5 text-[12px] leading-snug text-[#E4554F]">
            ✗ Shizuku 未运行：先在 Shizuku APP 里激活（重启手机后需重新激活），回来刷新本页。
          </p>
        ) : !shizuku.granted ? (
          <p className="mt-1.5 text-[12px] leading-snug text-[#E4554F]">
            ✗ Shizuku 待授权：回上方「时长数据源」区点「去授权」，回来后这里的按钮即全部可用。
          </p>
        ) : (
          <p className="mt-1.5 text-[12px] leading-snug text-[#07C160]">
            ✓ 实验室就绪（Shizuku v{shizuku.version || '?'}）：下面每一项都会真实读取/操作你的手机。
          </p>
        )}
        {ready ? (
          <p className="mt-1 text-[10.5px] leading-snug text-black/30 dark:text-white/30">
            后续接入小爱对话时，将按能力逐项授权（不会一口气全开）。短信/通话记录在 MIUI/鸿蒙 等部分 ROM 可能被拦截，属正常边界。
          </p>
        ) : null}
      </div>

      {ready ? (
        <>
          {/* ============ 让 AI 看见 ============ */}
          <div className={`border-t ${dividerCls}`} />
          <div className="flex items-center gap-1.5 px-4 pt-2.5 text-[11.5px] font-medium text-black/40 dark:text-white/40">
            <Eye size={13} strokeWidth={2} aria-hidden /> 让 AI 看见（只读探测）
          </div>

          <Row
            title="静默截屏"
            desc="screencap · 免 MediaProjection 弹窗；截屏喂识图模型就是「AI 看屏幕」"
            actions={<Pill label="截一张" busy={busy.screencap} onClick={() => void exec('screencap', labScreencap)} accent={accent} testId={`${prefix}-screencap-btn`} />}
            out={<OutBox r={outs.screencap} testId={`${prefix}-screencap-out`} />}
            testId={`${prefix}-screencap`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="前台应用"
            desc="dumpsys window · 此刻你在哪个 App（比时长轮询更快）"
            actions={<Pill label="查看" busy={busy.fg} onClick={() => void exec('fg', labForegroundApp)} accent={accent} testId={`${prefix}-foreground-btn`} />}
            out={<OutBox r={outs.fg} testId={`${prefix}-foreground-out`} />}
            testId={`${prefix}-foreground`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="通知栏快照"
            desc="dumpsys notification · 当下通知栏全量（谁给你发了什么）"
            actions={<Pill label="查看" busy={busy.notif} onClick={() => void exec('notif', labNotificationSnapshot)} accent={accent} testId={`${prefix}-notif-btn`} />}
            out={<OutBox r={outs.notif} testId={`${prefix}-notif-out`} />}
            testId={`${prefix}-notif`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="正在播放"
            desc="dumpsys media_session · 听歌感知的备用通道（免通知使用权）"
            actions={<Pill label="查看" busy={busy.media} onClick={() => void exec('media', labNowPlaying)} accent={accent} testId={`${prefix}-media-btn`} />}
            out={<OutBox r={outs.media} testId={`${prefix}-media-out`} />}
            testId={`${prefix}-media`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="电量状态"
            desc="dumpsys battery · 电量/是否充电（「还剩10%，别刷了」）"
            actions={<Pill label="查看" busy={busy.battery} onClick={() => void exec('battery', labBattery)} accent={accent} testId={`${prefix}-battery-btn`} />}
            out={<OutBox r={outs.battery} testId={`${prefix}-battery-out`} />}
            testId={`${prefix}-battery`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="剪贴板"
            desc="dumpsys clipboard · 你刚复制了什么（部分 ROM 不显示）"
            actions={<Pill label="查看" busy={busy.clip} onClick={() => void exec('clip', labClipboard)} accent={accent} testId={`${prefix}-clipboard-btn`} />}
            out={<OutBox r={outs.clip} testId={`${prefix}-clipboard-out`} />}
            testId={`${prefix}-clipboard`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="短信收件箱"
            desc="content query · 最近 10 条（ROM 可能拦截）"
            actions={<Pill label="最近10条" busy={busy.sms} onClick={() => void exec('sms', labSmsInbox)} accent={accent} testId={`${prefix}-sms-btn`} />}
            out={<OutBox r={outs.sms} testId={`${prefix}-sms-out`} />}
            testId={`${prefix}-sms`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="通话记录"
            desc="content query · 最近 10 条（姓名/号码/时长）"
            actions={<Pill label="最近10条" busy={busy.calls} onClick={() => void exec('calls', labCallLog)} accent={accent} testId={`${prefix}-calls-btn`} />}
            out={<OutBox r={outs.calls} testId={`${prefix}-calls-out`} />}
            testId={`${prefix}-calls`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="系统日志"
            desc="logcat · 最近 200 行（排查真机 bug 用，含时长统计/Shizuku 的内部信息）"
            actions={<Pill label="最近200行" busy={busy.logcat} onClick={() => void exec('logcat', () => labLogcat(200))} accent={accent} testId={`${prefix}-logcat-btn`} />}
            out={<OutBox r={outs.logcat} testId={`${prefix}-logcat-out`} />}
            testId={`${prefix}-logcat`}
          />

          {/* ============ 让 AI 动手 ============ */}
          <div className={`border-t ${dividerCls}`} />
          <div className="flex items-center gap-1.5 px-4 pt-2.5 text-[11.5px] font-medium text-black/40 dark:text-white/40">
            <Hand size={13} strokeWidth={2} aria-hidden /> 让 AI 动手（真实操作手机）
          </div>

          <div className="px-4 py-2.5" data-testid={`${prefix}-pkg`}>
            <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium">
              <Smartphone size={14} strokeWidth={2} aria-hidden /> 目标 App 包名（打开/强杀/冻结/卸载共用）
            </p>
            <input
              value={pkg}
              onChange={(e) => setPkg(e.target.value.trim())}
              placeholder="如 com.tencent.mm"
              inputMode="text"
              data-testid={`${prefix}-pkg-input`}
              className={`${fieldCls} h-9`}
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {quickPkgs.map((q) => (
                <button
                  key={q.pkg}
                  type="button"
                  onClick={() => setPkg(q.pkg)}
                  data-testid={`${prefix}-pkg-quick-${q.label}`}
                  className={`rounded-full border px-2.5 py-1 text-[11px] active:opacity-70 ${
                    pkg === q.pkg
                      ? 'border-transparent text-white'
                      : 'border-black/10 text-black/50 dark:border-white/15 dark:text-white/50'
                  }`}
                  style={pkg === q.pkg ? { backgroundColor: accent } : undefined}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="点按"
            desc="input tap · 替你点屏幕上的某个坐标"
            actions={
              <>
                <MiniInput value={tapX} onChange={setTapX} ariaLabel="点按 X 坐标" testId={`${prefix}-tap-x`} />
                <MiniInput value={tapY} onChange={setTapY} ariaLabel="点按 Y 坐标" testId={`${prefix}-tap-y`} />
                <Pill label="点一下" busy={busy.tap} onClick={() => void exec('tap', () => labTap(Number(tapX), Number(tapY)))} accent={accent} testId={`${prefix}-tap-btn`} />
              </>
            }
            out={<OutBox r={outs.tap} testId={`${prefix}-tap-out`} />}
            testId={`${prefix}-tap`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="滑动"
            desc="input swipe · 按屏幕分辨率自动算中心坐标"
            actions={
              <>
                {(['up', 'down', 'left', 'right'] as const).map((d) => (
                  <Pill
                    key={d}
                    small
                    label={d === 'up' ? '上滑' : d === 'down' ? '下滑' : d === 'left' ? '左滑' : '右滑'}
                    busy={busy.swipe}
                    onClick={() => void doSwipe(d)}
                    accent={accent}
                    testId={`${prefix}-swipe-${d}`}
                  />
                ))}
              </>
            }
            out={<OutBox r={outs.swipe} testId={`${prefix}-swipe-out`} />}
            testId={`${prefix}-swipe`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="打字"
            desc="input text · 仅英文数字符号（中文是系统限制，需走输入法/剪贴板）"
            actions={
              <>
                <MiniInput value={typeText} onChange={setTypeText} ariaLabel="要输入的文字" testId={`${prefix}-type-input`} widthCls="w-32" placeholder="hello world" />
                <Pill label="输入" busy={busy.type} onClick={() => void exec('type', () => labInputText(typeText))} accent={accent} testId={`${prefix}-type-btn`} />
              </>
            }
            out={<OutBox r={outs.type} testId={`${prefix}-type-out`} />}
            testId={`${prefix}-type`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="按键"
            desc="input keyevent · 返回/Home/音量/媒体控制"
            actions={
              <>
                <Pill small label="返回" busy={busy.keyBack} onClick={() => void exec('keyBack', () => labKey(KEY_CODES.back))} accent={accent} testId={`${prefix}-key-back`} />
                <Pill small label="Home" busy={busy.keyHome} onClick={() => void exec('keyHome', () => labKey(KEY_CODES.home))} accent={accent} testId={`${prefix}-key-home`} />
                <Pill small label="音量+" busy={busy.keyVolUp} onClick={() => void exec('keyVolUp', () => labKey(KEY_CODES.volumeUp))} accent={accent} testId={`${prefix}-key-volup`} />
                <Pill small label="音量-" busy={busy.keyVolDown} onClick={() => void exec('keyVolDown', () => labKey(KEY_CODES.volumeDown))} accent={accent} testId={`${prefix}-key-voldn`} />
                <Pill small label="播放/暂停" busy={busy.keyMedia} onClick={() => void exec('keyMedia', () => labKey(KEY_CODES.mediaPlayPause))} accent={accent} testId={`${prefix}-key-media`} />
              </>
            }
            out={<OutBox r={outs.keyBack ?? outs.keyHome ?? outs.keyVolUp ?? outs.keyVolDown ?? outs.keyMedia} testId={`${prefix}-keys-out`} />}
            testId={`${prefix}-keys`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="打开 App"
            desc="monkey · 按包名拉起（「帮我打开微信扫一扫」的第一步）"
            actions={<Pill label="打开" busy={busy.open} onClick={() => void exec('open', () => labOpenApp(pkg))} accent={accent} testId={`${prefix}-open-btn`} />}
            out={<OutBox r={outs.open} testId={`${prefix}-open-out`} />}
            testId={`${prefix}-open`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="强杀 App"
            desc="am force-stop · 防沉迷硬手段（刷超时直接关）"
            actions={
              <Pill
                label="强杀"
                danger
                busy={busy.kill}
                onClick={() => {
                  if (ask(`确定强杀 ${pkg}？该 App 会立即退出（未保存内容可能丢失）。`)) {
                    void exec('kill', () => labForceStop(pkg));
                  }
                }}
                accent={accent}
                testId={`${prefix}-kill-btn`}
              />
            }
            out={<OutBox r={outs.kill} testId={`${prefix}-kill-out`} />}
            testId={`${prefix}-kill`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="冻结 / 解冻 App"
            desc="pm suspend · 冻结到「明天」的防沉迷大招（图标变灰、提示「由 Shell 所管理」，可逆、数据保留）"
            actions={
              <>
                <Pill
                  label="冻结"
                  danger
                  busy={busy.freeze}
                  onClick={() => {
                    if (ask(`确定冻结 ${pkg}？桌面图标会变灰（提示「由 Shell 所管理」），解冻后恢复原样（数据不丢）。`)) {
                      void exec('freeze', () => labSetAppFrozen(pkg, true));
                    }
                  }}
                  accent={accent}
                  testId={`${prefix}-freeze-btn`}
                />
                <Pill label="解冻" busy={busy.unfreeze} onClick={() => void exec('unfreeze', () => labSetAppFrozen(pkg, false))} accent={accent} testId={`${prefix}-unfreeze-btn`} />
              </>
            }
            out={<OutBox r={outs.freeze ?? outs.unfreeze} testId={`${prefix}-freeze-out`} />}
            testId={`${prefix}-freeze`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="静默安装 APK"
            desc="pm install -r · 免弹安装器装手机本地 APK（如下载目录里的新版）"
            extra={
              <input
                value={apkPath}
                onChange={(e) => setApkPath(e.target.value.trim())}
                placeholder="/storage/emulated/0/Download/AI-Phone.apk"
                aria-label="APK 本地路径"
                data-testid={`${prefix}-install-path`}
                className="mt-1.5 h-8 w-full min-w-0 rounded-lg border border-black/10 bg-white px-2 text-[11.5px] outline-none focus:border-black/30 dark:border-white/15 dark:bg-white/[0.06] dark:focus:border-white/35"
              />
            }
            actions={
              <Pill
                label="安装"
                busy={busy.install}
                onClick={() => {
                  if (ask(`确定静默安装 ${apkPath}？（覆盖安装，无需点系统安装器）`)) {
                    void exec('install', () => labInstallApk(apkPath));
                  }
                }}
                accent={accent}
                testId={`${prefix}-install-btn`}
              />
            }
            out={<OutBox r={outs.install} testId={`${prefix}-install-out`} />}
            testId={`${prefix}-install`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="卸载 App"
            desc="pm uninstall --user 0 · 仅当前用户移除（可恢复）"
            actions={
              <Pill
                label="卸载"
                danger
                busy={busy.uninstall}
                onClick={() => {
                  if (ask(`确定卸载 ${pkg}？（--user 0 方式，可恢复）`)) {
                    void exec('uninstall', () => labUninstall(pkg));
                  }
                }}
                accent={accent}
                testId={`${prefix}-uninstall-btn`}
              />
            }
            out={<OutBox r={outs.uninstall} testId={`${prefix}-uninstall-out`} />}
            testId={`${prefix}-uninstall`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="媒体与音量"
            desc="media dispatch / volume · 下一首/上一首/播放暂停/音量"
            actions={
              <>
                <Pill small label="下一首" busy={busy.mNext} onClick={() => void exec('mNext', () => labMediaKey('next'))} accent={accent} testId={`${prefix}-media-next`} />
                <Pill small label="上一首" busy={busy.mPrev} onClick={() => void exec('mPrev', () => labMediaKey('previous'))} accent={accent} testId={`${prefix}-media-prev`} />
                <Pill small label="播放/暂停" busy={busy.mPlay} onClick={() => void exec('mPlay', () => labMediaKey('play-pause'))} accent={accent} testId={`${prefix}-media-playpause`} />
                <Pill small label="音量-" busy={busy.vDown} onClick={() => void exec('vDown', () => labVolume('lower'))} accent={accent} testId={`${prefix}-vol-lower`} />
                <Pill small label="音量+" busy={busy.vUp} onClick={() => void exec('vUp', () => labVolume('raise'))} accent={accent} testId={`${prefix}-vol-raise`} />
              </>
            }
            out={<OutBox r={outs.mNext ?? outs.mPrev ?? outs.mPlay ?? outs.vDown ?? outs.vUp} testId={`${prefix}-media-ctl-out`} />}
            testId={`${prefix}-media-ctl`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="网络开关"
            desc="svc · Wi-Fi / 移动流量 / 蓝牙（部分 ROM 需 root 才生效）"
            actions={
              <>
                <Pill small label="Wi-Fi 关" danger busy={busy.wifiOff} onClick={() => { if (ask('确定关闭 Wi-Fi？')) void exec('wifiOff', () => labSvc('wifi', false)); }} accent={accent} testId={`${prefix}-svc-wifi-off`} />
                <Pill small label="Wi-Fi 开" busy={busy.wifiOn} onClick={() => void exec('wifiOn', () => labSvc('wifi', true))} accent={accent} testId={`${prefix}-svc-wifi-on`} />
                <Pill small label="流量 关" danger busy={busy.dataOff} onClick={() => { if (ask('确定关闭移动流量？')) void exec('dataOff', () => labSvc('data', false)); }} accent={accent} testId={`${prefix}-svc-data-off`} />
                <Pill small label="流量 开" busy={busy.dataOn} onClick={() => void exec('dataOn', () => labSvc('data', true))} accent={accent} testId={`${prefix}-svc-data-on`} />
                <Pill small label="蓝牙 开" danger busy={busy.bt} onClick={() => { if (ask('切换蓝牙？')) void exec('bt', () => labSvc('bluetooth', true)); }} accent={accent} testId={`${prefix}-svc-bt`} />
              </>
            }
            out={<OutBox r={outs.wifiOff ?? outs.wifiOn ?? outs.dataOff ?? outs.dataOn ?? outs.bt} testId={`${prefix}-svc-out`} />}
            testId={`${prefix}-svc`}
          />

          {/* ============ 一键自授权 ============ */}
          <div className={`border-t ${dividerCls}`} />
          <div className="flex items-center gap-1.5 px-4 pt-2.5 text-[11.5px] font-medium text-black/40 dark:text-white/40">
            <KeyRound size={13} strokeWidth={2} aria-hidden /> 一键自授权（免设置页翻菜单）
          </div>

          <Row
            title="开「使用情况」权限"
            desc="cmd appops set · 等效系统设置里手动开（时长感知用）"
            actions={<Pill label="一键开" busy={busy.gUsage} onClick={() => void exec('gUsage', labSelfGrantUsage)} accent={accent} testId={`${prefix}-grant-usage-btn`} />}
            out={<OutBox r={outs.gUsage} testId={`${prefix}-grant-usage-out`} />}
            testId={`${prefix}-grant-usage`}
          />
          <div className={`border-t ${dividerCls}`} />

          <Row
            title="开「通知使用权」"
            desc="cmd notification allow_listener · 歌名感知免设置"
            actions={<Pill label="一键开" busy={busy.gNotif} onClick={() => void exec('gNotif', labSelfGrantNotificationListener)} accent={accent} testId={`${prefix}-grant-notif-btn`} />}
            out={<OutBox r={outs.gNotif} testId={`${prefix}-grant-notif-out`} />}
            testId={`${prefix}-grant-notif`}
          />

          <div className={`border-t ${dividerCls}`} />
          <div className="flex items-center gap-1.5 px-4 py-2.5">
            <Camera size={12} strokeWidth={2} className="shrink-0 text-black/30 dark:text-white/30" aria-hidden />
            <p className="text-[10.5px] leading-snug text-black/35 dark:text-white/35">
              试用结果只在本页展示，不会自动发给任何人；接进小爱对话前每项能力都会再单独问你。
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
