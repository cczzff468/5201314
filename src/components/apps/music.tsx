'use client';

/**
 * 音乐 App —— 仿网易云（在线版）
 *
 * 结构：
 * - 未登录 → 登录页（扫码 / 手机号验证码 / 密码 三种方式 + API 配置 + 游客模式）
 * - 已登录或游客 → Tab 框架（首页/搜索/我的 + 迷你播放条）
 * - 全屏覆盖层：播放页（黑胶+歌词）、歌单详情、设置页、评论页（独立界面）
 * - 状态栏前景实时跟随界面背景明暗（第三十三轮：浅底页黑字 / 深色播放页白字）
 *
 * 全局播放引擎与登录态在 music-store / music-ai（模块级持久化，App 外仍播放）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  Check,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
  Settings2,
} from 'lucide-react';
import { IOSScreen } from '@/components/ios/IOSNavBar';
import {
  getMusicApiCfg,
  setMusicApiCfg,
  qrLoginCreate,
  qrLoginCheck,
  completeQrLogin,
  sendCaptcha,
  loginByCaptcha,
  loginByPassword,
  type QrState,
} from '@/lib/ios/music-api';
import { useMusic, enterGuestMode } from '@/lib/ios/music-store';
import { useSettings, useUI, useSystemDark } from '@/lib/ios/store';
import { useStatusBarToneEffect, type StatusBarTone } from '@/lib/ios/status-bar-tone';
import { bootMusicAi } from '@/lib/ios/music-ai';
import { MusicTabBar, MiniBar } from './music-shared';
import { MusicHome } from './music-home';
import { MusicHeart } from './music-heart';
import { MusicSearch } from './music-search';
import { MusicMine } from './music-mine';
import { MusicPlayer } from './music-player';
import { MusicPlaylist } from './music-playlist';
import { MusicSettings } from './music-settings';
import { CommentsPage } from './music-comments';

export default function MusicApp() {
  const nav = useMusic((s) => s.nav);
  const commentSong = useMusic((s) => s.commentSong);
  const loginUid = useMusic((s) => s.loginUid);
  const guestMode = useMusic((s) => s.guestMode);
  const openAppNow = useMusic((s) => s.openAppNow);
  const [showSettings, setShowSettings] = useState(false);

  // 用户打开音乐 App = 亲自接管播放：清除「小屋家具播放中」标记，灵动岛恢复正常显示（v5.9）
  useEffect(() => {
    if (useMusic.getState().ambient) useMusic.setState({ ambient: false });
  }, []);

  // 状态栏前景实时跟随当前界面背景明暗（第三十三轮反馈：背景深→状态栏白，背景白→状态栏黑）：
  // 播放页（封面模糊深色底）→ 白字；心动 tab（第六十四轮深色沉浸版式）→ 白字；
  // 登录/首页/搜索/我的/歌单/设置/评论（浅底）→ 黑字；深色主题下浅底页转黑底 → 白字。
  // 评论页/设置页盖在其它页上时优先
  const theme = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const themeDark = theme === 'auto' ? systemDark : theme === 'dark';
  const heartImmersive = nav.view === 'tabs' && nav.tab === 'heart';
  const tone: StatusBarTone =
    (nav.view === 'player' && !commentSong && !showSettings) || (heartImmersive && !showSettings && !commentSong)
      ? 'light'
      : themeDark
        ? 'light'
        : 'dark';
  useStatusBarToneEffect(tone);

  useEffect(() => {
    openAppNow(); // 幂等 boot：音频引擎 + 登录态异步校验 + 历史
    void bootMusicAi();
  }, [openAppNow]);

  const loggedIn = !!loginUid;
  // 迷你播放条显示策略：除全屏播放页外所有界面都显示（含设置页等浮层）；评论弹层带输入框不遮
  const showMini = nav.view !== 'player' && !commentSong;
  // TabBar 只在音乐/搜索/我三个主界面显示（歌单/播放/设置等子界面不重复展示）
  const showTabBar = nav.view === 'tabs' && !showSettings && !commentSong;

  return (
    <IOSScreen className="relative bg-[#F8F8F8] dark:bg-black">
      {!loggedIn && !guestMode ? (
        <LoginView />
      ) : (
        <>
          {nav.view === 'tabs' && (
            <div className="relative flex h-full flex-col">
              <div className="min-h-0 flex-1 overflow-hidden">
                {nav.tab === 'home' && <MusicHome onSettings={() => setShowSettings(true)} />}
                {nav.tab === 'heart' && <MusicHeart />}
                {nav.tab === 'search' && <MusicSearch />}
                {nav.tab === 'mine' && <MusicMine onSettings={() => setShowSettings(true)} />}
              </div>
              {/* 底部悬浮层：TabBar 毛玻璃胶囊悬浮条（第四十三轮；胶囊壳在 MusicTabBar 组件内），迷你条由全局层渲染 */}
              {showTabBar && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-4 pb-[max(10px,env(safe-area-inset-bottom))]">
                  <MusicTabBar />
                </div>
              )}
            </div>
          )}
          {/* 歌单页：不再显示 TabBar（只在音乐/搜索/我三个主界面显示），迷你条由全局层贴底 */}
          {nav.view === 'player' && <MusicPlayer />}
          {nav.view === 'playlist' && <MusicPlaylist />}

          {/* 全局迷你播放条：tabs/歌单/设置页都悬浮显示（全屏播放页除外）；TabBar 胶囊可见时贴其上方
              （胶囊 = pb 10px + 高 46px ≈ 占 56px，迷你条自身 mb-1.5，bottom 62 留出 6px 间隙） */}
          {showMini && (
            <div
              className="pointer-events-none absolute inset-x-0 z-[70]"
              style={{ bottom: showTabBar ? 62 : 0 }}
              data-testid="music-minibar-global"
            >
              <MiniBar />
            </div>
          )}
        </>
      )}
      {/* 设置页覆盖（游客/登录都可进） */}
      {showSettings && (
        <div className="absolute inset-0 z-[60]">
          <MusicSettings asSheet onBack={() => setShowSettings(false)} />
        </div>
      )}
      {/* 评论页（独立全屏界面） */}
      {commentSong && <CommentsPage />}
    </IOSScreen>
  );
}

// ================= 登录页 =================

type LoginTab = 'qr' | 'phone';

function LoginView() {
  const [tab, setTab] = useState<LoginTab>('qr');
  const [showApiCfg, setShowApiCfg] = useState(false);

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-gradient-to-b from-[#FDF5F5] to-[#F8F8F8] px-6 pb-10 pt-[70px] dark:from-zinc-900 dark:to-black">
      {/* v58：返回键（退出音乐 App 回主屏；与各 App 顶栏返回同口径） */}
      <button
        type="button"
        aria-label="返回"
        data-testid="music-login-back"
        onClick={() => useUI.getState().closeApp()}
        className="absolute left-2 top-[58px] z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/[0.03] backdrop-blur-xl transition-all active:scale-90 dark:bg-white/10"
      >
        <ChevronLeft className="h-5 w-5 text-zinc-700 dark:text-zinc-200" strokeWidth={2.4} />
      </button>

      {/* 标题（v58：顶部图标换 APP 真实图标，与主屏一致） */}
      <div className="mb-7 flex flex-col items-center gap-2.5">
        <img
          src="/icons/music.png"
          alt="网易云音乐"
          draggable={false}
          className="h-16 w-16 rounded-[18px] shadow-sm ring-1 ring-black/[0.06] select-none"
        />
        <h1 className="text-[21px] font-bold text-zinc-900 dark:text-zinc-100">网易云音乐</h1>
        <p className="text-[12px] text-zinc-400">登录你的账号，同步歌单与收藏</p>
      </div>

      {/* Tab 切换 */}
      <div className="mx-auto mb-5 flex w-full max-w-[300px] rounded-full bg-black/5 p-1 dark:bg-white/10">
        {(
          [
            { k: 'qr', label: '扫码登录', icon: <QrCode className="h-4 w-4" /> },
            { k: 'phone', label: '手机号登录', icon: <Smartphone className="h-4 w-4" /> },
          ] as const
        ).map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            data-testid={`music-login-tab-${t.k}`}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-medium transition-all ${
              tab === t.k
                ? 'bg-white/85 text-zinc-900 shadow-sm backdrop-blur-xl dark:bg-zinc-700/85 dark:text-white'
                : 'text-zinc-500'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'qr' ? <QrLogin /> : <PhoneLogin />}

      <div className="mt-auto pt-8">
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => enterGuestMode()}
            data-testid="music-guest-enter"
            className="rounded-full border border-white/60 bg-white/70 px-5 py-2 text-[13px] text-zinc-600 ring-1 ring-black/[0.06] backdrop-blur-xl active:scale-95 dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-300 dark:ring-white/10"
          >
            先逛逛（游客模式）
          </button>
          <button
            type="button"
            onClick={() => setShowApiCfg(true)}
            data-testid="music-api-cfg-open"
            className="flex items-center gap-1 rounded-full border border-white/60 bg-white/70 px-5 py-2 text-[13px] text-zinc-600 ring-1 ring-black/[0.06] backdrop-blur-xl active:scale-95 dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-300 dark:ring-white/10"
          >
            <Settings2 className="h-3.5 w-3.5" />
            API 设置
          </button>
        </div>
        <p className="mt-3 text-center text-[10px] leading-relaxed text-zinc-400">
          基于开源网易云 API（非官方）· VIP 歌曲非会员仅可试听 30 秒
        </p>
      </div>

      {showApiCfg && <ApiCfgSheet onClose={() => setShowApiCfg(false)} />}
    </div>
  );
}

// ---------------- 扫码登录 ----------------

function QrLogin() {
  const [qr, setQr] = useState<QrState | null>(null);
  const [status, setStatus] = useState<'loading' | 'waiting' | 'scanned' | 'expired' | 'ok'>('loading');
  const [err, setErr] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const create = useCallback(async () => {
    setStatus('loading');
    setErr('');
    try {
      const q = await qrLoginCreate();
      setQr(q);
      setStatus('waiting');
    } catch (e) {
      setErr((e as Error).message || '二维码获取失败');
      setStatus('expired');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const q = await qrLoginCreate();
        if (cancelled) return;
        setQr(q);
        setStatus('waiting');
      } catch (e) {
        if (cancelled) return;
        setErr((e as Error).message || '二维码获取失败');
        setStatus('expired');
      }
    })();
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // 轮询
  useEffect(() => {
    if (!qr || status === 'ok' || status === 'expired' || status === 'loading') return;
    timerRef.current = setInterval(async () => {
      if (!qr) return;
      try {
        const r = await qrLoginCheck(qr.key);
        if (r.st === 'ok') {
          if (timerRef.current) clearInterval(timerRef.current);
          setStatus('ok');
          await completeQrLogin(r.cookie); // 保存 cookie + 拉用户信息并持久化
          await useMusic.getState().refreshLoginUi();
        } else if (r.st === 'scanned') {
          setStatus('scanned');
        } else if (r.st === 'expired') {
          if (timerRef.current) clearInterval(timerRef.current);
          setStatus('expired');
        }
      } catch {
        // 网络抖动忽略，下轮重试
      }
    }, 2500);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [qr, status]);

  return (
    <div className="flex flex-col items-center" data-testid="music-qr-login">
      <div className="relative flex h-[190px] w-[190px] items-center justify-center rounded-2xl border border-white/60 bg-white/75 p-3 shadow-[0_8px_28px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.06] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-800/70">
        {status === 'loading' && <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />}
        {qr && status !== 'loading' && (
          <>
            { }
            <img src={qr.qrimg} alt="网易云登录二维码" className="h-full w-full" draggable={false} />
            {(status === 'expired' || status === 'ok') && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/85 backdrop-blur-xl dark:bg-zinc-900/85">
                {status === 'expired' ? (
                  <>
                    <p className="text-[12px] text-zinc-500">二维码已过期</p>
                    <button
                      type="button"
                      onClick={() => void create()}
                      data-testid="music-qr-refresh"
                      className="flex items-center gap-1 rounded-full bg-[#C20C0C] px-4 py-1.5 text-[12px] text-white active:scale-95"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      刷新
                    </button>
                  </>
                ) : (
                  <>
                    <Check className="h-7 w-7 text-green-600" />
                    <p className="text-[12px] text-zinc-500">登录成功</p>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <p className="mt-4 text-[13px] text-zinc-600 dark:text-zinc-300" data-testid="music-qr-status">
        {status === 'waiting' && '请使用网易云音乐 App 扫码登录'}
        {status === 'scanned' && '已扫码，请在手机上确认'}
        {status === 'ok' && '登录成功，正在进入…'}
        {status === 'expired' && '二维码已过期'}
        {status === 'loading' && '正在生成二维码…'}
      </p>
      {err && <p className="mt-2 text-[12px] text-red-500">{err}</p>}
    </div>
  );
}

// ---------------- 手机号登录 ----------------

function PhoneLogin() {
  const [mode, setMode] = useState<'captcha' | 'password'>('captcha');
  const [phone, setPhone] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [password, setPassword] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const sendCode = async () => {
    if (!/^1\d{10}$/.test(phone)) {
      setErr('请输入正确的 11 位手机号');
      return;
    }
    setErr('');
    try {
      await sendCaptcha(phone, '86');
      setCountdown(60);
    } catch (e) {
      setErr((e as Error).message || '验证码发送失败');
    }
  };

  const doLogin = async () => {
    setErr('');
    if (!/^1\d{10}$/.test(phone)) {
      setErr('请输入正确的 11 位手机号');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'captcha') await loginByCaptcha(phone, captcha, '86');
      else await loginByPassword(phone, password, '86');
      await useMusic.getState().refreshLoginUi();
    } catch (e) {
      setErr((e as Error).message || '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[300px] flex-col gap-3" data-testid="music-phone-login">
      <div className="flex items-center rounded-xl border border-white/60 bg-white/70 px-3 ring-1 ring-black/[0.06] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:ring-white/10">
        <span className="pr-2 text-[14px] font-medium text-zinc-700 dark:text-zinc-200">+86</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
          placeholder="输入手机号"
          inputMode="numeric"
          data-testid="music-login-phone"
          className="h-11 flex-1 bg-transparent text-[15px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
      </div>
      {mode === 'captcha' ? (
        <div className="flex items-center gap-2">
          <input
            value={captcha}
            onChange={(e) => setCaptcha(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="输入验证码"
            inputMode="numeric"
            data-testid="music-login-captcha"
            className="h-11 min-w-0 flex-1 rounded-xl border border-white/60 bg-white/70 px-3 text-[15px] text-zinc-900 outline-none ring-1 ring-black/[0.06] backdrop-blur-xl placeholder:text-zinc-400 dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100 dark:ring-white/10"
          />
          <button
            type="button"
            onClick={() => void sendCode()}
            disabled={countdown > 0}
            data-testid="music-login-send"
            className="h-11 shrink-0 rounded-xl border border-[#C20C0C]/40 bg-white/60 px-3 text-[12px] text-[#C20C0C] backdrop-blur-xl disabled:opacity-40 active:scale-95 dark:bg-zinc-800/60"
          >
            {countdown > 0 ? `${countdown}s` : '获取验证码'}
          </button>
        </div>
      ) : (
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="输入密码"
          type="password"
          data-testid="music-login-password"
          className="h-11 rounded-xl border border-white/60 bg-white/70 px-3 text-[15px] text-zinc-900 outline-none ring-1 ring-black/[0.06] backdrop-blur-xl placeholder:text-zinc-400 dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100 dark:ring-white/10"
        />
      )}
      <button
        type="button"
        onClick={() => void doLogin()}
        disabled={busy}
        data-testid="music-login-submit"
        className="flex h-11 items-center justify-center rounded-full bg-[#C20C0C] text-[15px] font-medium text-white active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : '登 录'}
      </button>
      <button
        type="button"
        onClick={() => setMode(mode === 'captcha' ? 'password' : 'captcha')}
        className="text-center text-[12px] text-zinc-400 underline-offset-2 hover:underline"
      >
        {mode === 'captcha' ? '用密码登录' : '用验证码登录'}
      </button>
      {err && <p className="text-center text-[12px] text-red-500">{err}</p>}
      <p className="text-center text-[10px] leading-relaxed text-zinc-400">
        验证码登录会向该手机号发送真实短信
      </p>
    </div>
  );
}

// ---------------- API 配置弹层 ----------------

export function ApiCfgSheet({ onClose }: { onClose: () => void }) {
  const cfg = getMusicApiCfg();
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl);
  const [apiKey, setApiKey] = useState(cfg.apiKey);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const save = () => {
    setMusicApiCfg({ baseUrl, apiKey });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const test = async () => {
    setMusicApiCfg({ baseUrl, apiKey });
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch(
        baseUrl
          ? `${baseUrl.replace(/\/+$/, '')}/toplist?timestamp=${Date.now()}`
          : `/api/music/ncm/toplist?timestamp=${Date.now()}`,
        { headers: apiKey && baseUrl ? { 'X-API-Key': apiKey } : {} },
      );
      const j = (await res.json()) as { code?: number };
      setResult({ ok: j.code === 200, msg: j.code === 200 ? '连接成功 ✓' : `返回 code=${j.code}` });
    } catch (e) {
      setResult({ ok: false, msg: (e as Error).message || '连接失败' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[80] flex items-end" data-testid="music-api-cfg-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full rounded-t-2xl border-t border-white/60 bg-white/85 p-5 pb-8 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">API 设置</h3>
          <button type="button" onClick={onClose} className="text-zinc-400">
            <ChevronDown className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-[11px] leading-relaxed text-zinc-400">
          默认使用内置的网易云 API 服务（推荐，无需配置）。你也可以填写自部署的
          NeteaseCloudMusicApi 服务地址。
        </p>
        <label className="mb-1 block text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
          API 地址（留空 = 内置默认）
        </label>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="如 https://your-server.com:3000"
          data-testid="music-api-baseurl"
          className="mb-3 h-10 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-[13px] outline-none backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100"
        />
        <label className="mb-1 block text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
          API Key（选填，部分部署需要）
        </label>
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="留空即可"
          data-testid="music-api-key"
          className="mb-4 h-10 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-[13px] outline-none backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100"
        />
        {result && (
          <p
            className={`mb-3 text-[12px] ${result.ok ? 'text-green-600' : 'text-red-500'}`}
            data-testid="music-api-test-result"
          >
            {result.msg}
          </p>
        )}
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => void test()}
            disabled={testing}
            className="h-10 flex-1 rounded-full border border-white/60 bg-white/70 text-[13px] text-zinc-600 ring-1 ring-black/[0.06] backdrop-blur-xl disabled:opacity-40 active:scale-95 dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-300 dark:ring-white/10"
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button
            type="button"
            onClick={save}
            data-testid="music-api-save"
            className="h-10 flex-1 rounded-full bg-[#C20C0C] text-[13px] font-medium text-white active:scale-95"
          >
            {saved ? '已保存 ✓' : '保存'}
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-zinc-400">配置保存后立即生效</p>
      </div>
    </div>
  );
}
