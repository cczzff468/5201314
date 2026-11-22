'use client';

/**
 * 音乐 App —— 多音源（网易云 / QQ音乐 / 酷狗）
 *
 * 结构：
 * - 未登录当前音源平台 → 登录页（顶部三平台选择 + 各自登录方式 + API 配置 + 游客模式）
 * - 已登录或游客 → Tab 框架（首页/搜索/我的 + 迷你播放条）
 * - 全屏覆盖层：播放页（黑胶+歌词+音源切换）、歌单详情、设置页、评论页（独立界面）
 * - 状态栏前景实时跟随界面背景明暗（第三十三轮：浅底页黑字 / 深色播放页白字）
 *
 * 全局播放引擎与登录态在 music-store / music-ai（模块级持久化，App 外仍播放）。
 * 三平台登录凭证各自密文持久化（IndexedDB）；切换音源平台时数据源即时切换。
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
  UserRound,
  LogOut,
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
  clearMusicLogin,
  type QrState,
} from '@/lib/ios/music-api';
import {
  qqQrCreate,
  qqQrCheck,
  wxQrCreate,
  wxQrCheck,
  kgQrCreate,
  kgQrCheck,
  kgLoginByPassword,
  clearQqLogin,
  clearKgLogin,
  getMultiCfg,
  setMultiCfg,
  MUSIC_PLATFORMS,
  PLATFORM_LABELS,
  PLATFORM_FULL,
  PLATFORM_DOTS,
  type MusicPlatform,
  type QrImage,
  type QrPollResult,
} from '@/lib/ios/music-multi';
import { useMusic, enterGuestMode } from '@/lib/ios/music-store';
import { useSettings, useUI, useSystemDark } from '@/lib/ios/store';
import { useStatusBarToneEffect, type StatusBarTone } from '@/lib/ios/status-bar-tone';
import { bootMusicAi } from '@/lib/ios/music-ai';
import { MusicTabBar, MiniBar, CoverImg } from './music-shared';
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
  const qqLogin = useMusic((s) => s.qqLogin);
  const kgLogin = useMusic((s) => s.kgLogin);
  const platform = useMusic((s) => s.platform);
  const guestMode = useMusic((s) => s.guestMode);
  const loginHold = useMusic((s) => s.loginHold);
  const notice = useMusic((s) => s.notice);
  const openAppNow = useMusic((s) => s.openAppNow);
  const [showSettings, setShowSettings] = useState(false);

  // 用户打开音乐 App = 亲自接管播放：清除「小屋家具播放中」标记，灵动岛恢复正常显示（v5.9）
  useEffect(() => {
    if (useMusic.getState().ambient) useMusic.setState({ ambient: false });
    // 会话重置：重新打开音乐 App 时清掉上一会话的「登录后停留登录页」标记（loginHold）
    if (useMusic.getState().loginHold) useMusic.setState({ loginHold: false });
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

  // 登录门按「当前音源平台」判定：网易云看 uid；QQ/酷狗看各自凭证；
  // loginHold = 任一平台刚登录成功，先留在登录页可继续登录其它平台（点「进入音乐」再进）
  const loggedIn =
    platform === 'netease' ? !!loginUid : platform === 'qq' ? !!qqLogin : !!kgLogin;
  const showLogin = (!loggedIn && !guestMode) || loginHold;
  // 迷你播放条显示策略：除全屏播放页外所有界面都显示（含设置页等浮层）；评论弹层带输入框不遮
  const showMini = nav.view !== 'player' && !commentSong;
  // TabBar 只在音乐/搜索/我三个主界面显示（歌单/播放/设置等子界面不重复展示）
  const showTabBar = nav.view === 'tabs' && !showSettings && !commentSong;

  return (
    <IOSScreen className="relative bg-[#F8F8F8] dark:bg-black">
      {showLogin ? (
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
      {/* 全局轻提示（跨平台兜底「已切换至 XX 平台播放」等；自动消失） */}
      {notice && (
        <div className="pointer-events-none absolute inset-x-0 top-[72px] z-[95] flex justify-center px-8" data-testid="music-notice">
          <div className="max-w-full truncate rounded-full bg-black/80 px-4 py-2 text-[12px] font-medium text-white shadow-lg backdrop-blur-xl dark:bg-white/90 dark:text-zinc-900">
            {notice}
          </div>
        </div>
      )}
    </IOSScreen>
  );
}

// ================= 登录页（三平台可同时分别登录） =================

type LoginTab = 'qr' | 'phone';

/** 平台选择卡（登录页顶部；选择后登录方式/标题随之切换。已登录状态由下方账号卡展示） */
function PlatformChooser({
  value,
  onChange,
  loggedMap,
}: {
  value: MusicPlatform;
  onChange: (p: MusicPlatform) => void;
  loggedMap: Record<MusicPlatform, boolean>;
}) {
  void loggedMap; // 已登录状态不再用角标展示（用户反馈：右上角绿色对号删除）；由平台下方账号卡呈现
  return (
    <div className="mx-auto grid w-full max-w-[340px] grid-cols-3 gap-2" data-testid="music-login-platforms">
      {MUSIC_PLATFORMS.map((p) => {
        const active = value === p;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            data-testid={`music-login-plat-${p}`}
            className={`relative flex items-center justify-center gap-1.5 rounded-2xl border px-2 py-3 text-[13px] font-medium transition-all active:scale-95 ${
              active
                ? 'border-black/10 bg-white/85 text-zinc-900 shadow-sm backdrop-blur-xl dark:border-white/15 dark:bg-zinc-700/85 dark:text-white'
                : 'border-white/50 bg-white/45 text-zinc-500 backdrop-blur-xl dark:border-white/8 dark:bg-zinc-800/45 dark:text-zinc-400'
            }`}
          >
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: PLATFORM_DOTS[p], opacity: active ? 1 : 0.5 }}
            />
            {PLATFORM_LABELS[p]}
          </button>
        );
      })}
    </div>
  );
}

/** 已登录平台账号卡（登录成功后显示头像与昵称；可继续登录其它平台或直接进入） */
function LoggedCard({ p, info }: { p: MusicPlatform; info: { name: string; avatar: string; uid: string } }) {
  const setLoginHold = useMusic((s) => s.setLoginHold);
  const refreshLoginUi = useMusic((s) => s.refreshLoginUi);
  const [confirmQuit, setConfirmQuit] = useState(false);

  const enter = () => {
    // 回 tabs 主界面（歌单/播放页等子视图不保留，避免跨平台 id 错位）
    useMusic.setState((st) => ({ nav: { ...st.nav, view: 'tabs' } }));
    setLoginHold(false);
  };

  const quit = async () => {
    if (p === 'netease') clearMusicLogin();
    if (p === 'qq') clearQqLogin();
    if (p === 'kugou') clearKgLogin();
    setConfirmQuit(false);
    await refreshLoginUi();
  };

  return (
    <div
      className="mx-auto flex w-full max-w-[340px] flex-col items-center gap-3 rounded-2xl border border-white/60 bg-white/75 p-5 shadow-[0_8px_28px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.06] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70"
      data-testid={`music-logged-card-${p}`}
    >
      <div className="relative">
        <CoverImg src={info.avatar} className="h-[68px] w-[68px]" rounded="rounded-full" alt={info.name} />
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full ring-2 ring-white dark:ring-zinc-800"
          style={{ backgroundColor: PLATFORM_DOTS[p] }}
        />
      </div>
      <div className="text-center">
        <p className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">{info.name || `${PLATFORM_FULL[p]}用户`}</p>
        <p className="mt-0.5 text-[11px] text-zinc-400">
          {PLATFORM_FULL[p]} · 已登录{info.uid ? ` · ID ${info.uid}` : ''}
        </p>
      </div>
      <button
        type="button"
        onClick={enter}
        data-testid="music-logged-enter"
        className="flex h-11 w-full items-center justify-center rounded-full bg-[#C20C0C] text-[15px] font-medium text-white active:scale-[0.98]"
      >
        进入音乐
      </button>
      <div className="flex w-full items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => setConfirmQuit(true)}
          data-testid="music-logged-quit"
          className="flex items-center gap-1 rounded-full border border-black/10 px-3.5 py-1.5 text-[12px] text-zinc-500 active:scale-95 dark:border-white/15 dark:text-zinc-400"
        >
          <LogOut className="h-3.5 w-3.5" />
          退出登录
        </button>
      </div>
      <p className="text-center text-[10px] leading-relaxed text-zinc-400">
        可选择上方其它平台同时登录（互不影响）；进入后可在「设置 · 当前账号」随时切换音源
      </p>

      {confirmQuit && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40">
          <div className="mx-8 w-full max-w-[280px] rounded-2xl border border-white/60 bg-white/90 p-5 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-800/90">
            <p className="text-center text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">退出{PLATFORM_LABELS[p]}登录？</p>
            <p className="mt-1.5 text-center text-[12px] text-zinc-400">将清除本机保存的该平台登录凭证</p>
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmQuit(false)}
                className="h-10 flex-1 rounded-full border border-white/60 bg-white/70 text-[13px] text-zinc-600 ring-1 ring-black/[0.06] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-300 dark:ring-white/10"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void quit()}
                className="h-10 flex-1 rounded-full bg-red-500 text-[13px] font-medium text-white active:scale-95"
              >
                退出
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LoginView() {
  // 平台选择直接写 store（登录门/数据源/标题都跟随；已登录平台选择即进入）
  const platform = useMusic((s) => s.platform);
  const switchPlatform = useMusic((s) => s.switchPlatform);
  const setLoginHold = useMusic((s) => s.setLoginHold);
  const loginUid = useMusic((s) => s.loginUid);
  const loginNickname = useMusic((s) => s.loginNickname);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  const qqLogin = useMusic((s) => s.qqLogin);
  const kgLogin = useMusic((s) => s.kgLogin);
  const [tab, setTab] = useState<LoginTab>('qr');
  const [showApiCfg, setShowApiCfg] = useState(false);

  // 三平台登录态（隔离存储，互不覆盖）：已登录平台显示头像昵称/绿勾角标
  const info: Record<MusicPlatform, { logged: boolean; name: string; avatar: string; uid: string }> = {
    netease: {
      logged: !!loginUid,
      name: loginNickname || '',
      avatar: loginAvatar || '',
      uid: loginUid ? String(loginUid) : '',
    },
    qq: {
      logged: !!qqLogin,
      name: qqLogin?.nickname || '',
      avatar: qqLogin?.avatar || '',
      uid: qqLogin?.uin || '',
    },
    kugou: {
      logged: !!kgLogin,
      name: kgLogin?.nickname || '',
      avatar: kgLogin?.avatar || '',
      uid: kgLogin?.userid || '',
    },
  };
  const anyLogged = MUSIC_PLATFORMS.some((p) => info[p].logged);
  const cur = info[platform];

  // 底部「进入音乐」：当前平台未登录但其它平台已登录 → 切到已登录平台进入
  const enterFromBottom = () => {
    if (!cur.logged) {
      const first = MUSIC_PLATFORMS.find((p) => info[p].logged);
      if (first) switchPlatform(first);
    }
    useMusic.setState((st) => ({ nav: { ...st.nav, view: 'tabs' } }));
    setLoginHold(false);
  };

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

      {/* 标题（顶部图标换 APP 真实图标，与主屏一致） */}
      <div className="mb-5 flex flex-col items-center gap-2.5">
        <img
          src="/icons/music.png"
          alt="音乐"
          draggable={false}
          className="h-16 w-16 rounded-[18px] shadow-sm ring-1 ring-black/[0.06] select-none"
        />
        <h1 className="text-[21px] font-bold text-zinc-900 dark:text-zinc-100">音乐</h1>
        <p className="text-[12px] text-zinc-400">
          {cur.logged ? `${PLATFORM_FULL[platform]}已登录，可继续登录其它平台` : `登录${PLATFORM_FULL[platform]}账号，同步歌单与收藏`}
        </p>
      </div>

      {/* 三平台选择（已登录平台带绿勾角标；切换即切换数据源） */}
      <div className="mb-5">
        <PlatformChooser
          value={platform}
          onChange={(p) => {
            switchPlatform(p);
            setTab('qr');
          }}
          loggedMap={{ netease: info.netease.logged, qq: info.qq.logged, kugou: info.kugou.logged }}
        />
      </div>

      {/* 平台专属：已登录 → 账号卡（头像/昵称）；未登录 → 各自登录方式 */}
      {platform === 'netease' &&
        (cur.logged ? (
          <LoggedCard p="netease" info={{ name: cur.name, avatar: cur.avatar, uid: cur.uid }} />
        ) : (
          <>
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
          </>
        ))}
      {platform === 'qq' &&
        (qqLogin ? (
          <LoggedCard p="qq" info={{ name: info.qq.name, avatar: info.qq.avatar, uid: info.qq.uid }} />
        ) : (
          <QqLoginPanel />
        ))}
      {platform === 'kugou' &&
        (kgLogin ? (
          <LoggedCard p="kugou" info={{ name: info.kugou.name, avatar: info.kugou.avatar, uid: info.kugou.uid }} />
        ) : (
          <KugouLoginPanel />
        ))}

      <div className="mt-auto pt-8">
        {/* 其它平台已登录时：底部直达入口（当前平台未登录也可直接进入） */}
        {anyLogged && !cur.logged && (
          <button
            type="button"
            onClick={enterFromBottom}
            data-testid="music-login-enter-bottom"
            className="mx-auto mb-4 flex h-11 w-full max-w-[340px] items-center justify-center rounded-full bg-[#C20C0C] text-[15px] font-medium text-white active:scale-[0.98]"
          >
            进入音乐
          </button>
        )}
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
          三平台可同时登录、随时切换 · 基于开源 API（非官方）· 游客可逛网易云，VIP 歌自动到其它平台找免费音源
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
          useMusic.getState().setLoginHold(true); // 留在登录页：可继续登录其它平台
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

// ---------------- QQ 音乐登录（QQ 扫码 / 微信扫码） ----------------

function QqLoginPanel() {
  const [mode, setMode] = useState<'qq' | 'wx'>('qq');
  return (
    <div className="flex flex-col items-center">
      <div className="mx-auto mb-5 flex w-full max-w-[300px] rounded-full bg-black/5 p-1 dark:bg-white/10">
        {(
          [
            { k: 'qq', label: 'QQ 扫码' },
            { k: 'wx', label: '微信扫码' },
          ] as const
        ).map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setMode(t.k)}
            data-testid={`music-qq-login-tab-${t.k}`}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-medium transition-all ${
              mode === t.k
                ? 'bg-white/85 text-zinc-900 shadow-sm backdrop-blur-xl dark:bg-zinc-700/85 dark:text-white'
                : 'text-zinc-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {mode === 'qq' ? <QqQrLogin kind="qq" /> : <QqQrLogin kind="wx" />}
      <p className="mt-3 max-w-[300px] text-center text-[10px] leading-relaxed text-zinc-400">
        用手机 QQ 或微信扫一扫授权登录；登录后可播放、同步 QQ 音乐歌单与我喜欢
      </p>
    </div>
  );
}

function QqQrLogin({ kind }: { kind: 'qq' | 'wx' }) {
  const [qr, setQr] = useState<QrImage | null>(null);
  const [status, setStatus] = useState<'loading' | 'waiting' | 'scanned' | 'expired' | 'ok'>('loading');
  const [err, setErr] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const create = useCallback(async () => {
    setErr('');
    setStatus('loading');
    try {
      const q = kind === 'qq' ? await qqQrCreate() : await wxQrCreate();
      setQr(q);
      setStatus('waiting');
    } catch (e) {
      setErr((e as Error).message || '二维码获取失败');
      setStatus('expired');
    }
  }, [kind]);

  // 首次进入：await 后再 setState（避免 effect 内同步 setState 级联渲染）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const q = kind === 'qq' ? await qqQrCreate() : await wxQrCreate();
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
  }, [kind]);

  // 轮询（QQ 普通轮询；微信长轮询 ~35s，间隔拉长）
  useEffect(() => {
    if (!qr || status === 'ok' || status === 'expired' || status === 'loading') return;
    const interval = kind === 'wx' ? 8000 : 2500;
    timerRef.current = setInterval(async () => {
      if (!qr) return;
      try {
        const r: QrPollResult = kind === 'qq' ? await qqQrCheck(qr.id) : await wxQrCheck(qr.id);
        if (r.st === 'ok') {
          if (timerRef.current) clearInterval(timerRef.current);
          setStatus('ok');
          useMusic.getState().setLoginHold(true); // 留在登录页：可继续登录其它平台
          await useMusic.getState().refreshLoginUi();
        } else if (r.st === 'scanned') {
          setStatus('scanned');
        } else if (r.st === 'expired') {
          if (timerRef.current) clearInterval(timerRef.current);
          setStatus('expired');
        } else if (r.st === 'error') {
          setErr(r.msg || '登录失败');
        }
      } catch {
        // 网络抖动忽略，下轮重试
      }
    }, interval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [qr, status, kind]);

  return (
    <div className="flex flex-col items-center" data-testid="music-qq-qr-login">
      <div className="relative flex h-[190px] w-[190px] items-center justify-center rounded-2xl border border-white/60 bg-white/75 p-3 shadow-[0_8px_28px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.06] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-800/70">
        {status === 'loading' && <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />}
        {qr && status !== 'loading' && (
          <>
            <img src={qr.qrimg} alt={kind === 'qq' ? 'QQ 音乐登录二维码' : '微信扫码登录二维码'} className="h-full w-full" draggable={false} />
            {(status === 'expired' || status === 'ok') && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/85 backdrop-blur-xl dark:bg-zinc-900/85">
                {status === 'expired' ? (
                  <>
                    <p className="text-[12px] text-zinc-500">二维码已过期</p>
                    <button
                      type="button"
                      onClick={() => void create()}
                      data-testid="music-qq-qr-refresh"
                      className="flex items-center gap-1 rounded-full bg-[#31c27c] px-4 py-1.5 text-[12px] text-white active:scale-95"
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
      <p className="mt-4 text-[13px] text-zinc-600 dark:text-zinc-300" data-testid="music-qq-qr-status">
        {status === 'waiting' && (kind === 'qq' ? '请使用手机 QQ 扫码授权登录' : '请使用微信扫码授权登录')}
        {status === 'scanned' && '已扫码，请在手机上确认'}
        {status === 'ok' && '登录成功，正在进入…'}
        {status === 'expired' && '二维码已过期'}
        {status === 'loading' && '正在生成二维码…'}
      </p>
      {err && <p className="mt-2 text-[12px] text-red-500">{err}</p>}
    </div>
  );
}

// ---------------- 酷狗登录（扫码 / 账号密码） ----------------

function KugouLoginPanel() {
  const [mode, setMode] = useState<'qr' | 'pwd'>('qr');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const doLogin = async () => {
    setErr('');
    if (!username.trim() || !password) {
      setErr('请输入酷狗账号与密码');
      return;
    }
    setBusy(true);
    try {
      await kgLoginByPassword(username.trim(), password);
      useMusic.getState().setLoginHold(true); // 留在登录页：可继续登录其它平台
      await useMusic.getState().refreshLoginUi();
    } catch (e) {
      setErr((e as Error).message || '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className="mx-auto mb-5 flex w-full max-w-[300px] rounded-full bg-black/5 p-1 dark:bg-white/10">
        {(
          [
            { k: 'qr', label: '扫码登录', icon: <QrCode className="h-4 w-4" /> },
            { k: 'pwd', label: '账号密码', icon: <UserRound className="h-4 w-4" /> },
          ] as const
        ).map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setMode(t.k)}
            data-testid={`music-kg-login-tab-${t.k}`}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-medium transition-all ${
              mode === t.k
                ? 'bg-white/85 text-zinc-900 shadow-sm backdrop-blur-xl dark:bg-zinc-700/85 dark:text-white'
                : 'text-zinc-500'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      {mode === 'qr' ? (
        <KugouQrLogin />
      ) : (
        <div className="mx-auto flex w-full max-w-[300px] flex-col gap-3" data-testid="music-kg-pwd-login">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="酷狗账号 / 手机号"
            autoCapitalize="off"
            data-testid="music-kg-username"
            className="h-11 rounded-xl border border-white/60 bg-white/70 px-3 text-[15px] text-zinc-900 outline-none ring-1 ring-black/[0.06] backdrop-blur-xl placeholder:text-zinc-400 dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100 dark:ring-white/10"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
            type="password"
            data-testid="music-kg-password"
            className="h-11 rounded-xl border border-white/60 bg-white/70 px-3 text-[15px] text-zinc-900 outline-none ring-1 ring-black/[0.06] backdrop-blur-xl placeholder:text-zinc-400 dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100 dark:ring-white/10"
          />
          <button
            type="button"
            onClick={() => void doLogin()}
            disabled={busy}
            data-testid="music-kg-login-submit"
            className="flex h-11 items-center justify-center rounded-full bg-[#00b0f0] text-[15px] font-medium text-white active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : '登 录'}
          </button>
          {err && <p className="text-center text-[12px] text-red-500">{err}</p>}
        </div>
      )}
    </div>
  );
}

function KugouQrLogin() {
  const [qr, setQr] = useState<QrImage | null>(null);
  const [status, setStatus] = useState<'loading' | 'waiting' | 'scanned' | 'expired' | 'ok'>('loading');
  const [err, setErr] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const create = useCallback(async () => {
    setErr('');
    setStatus('loading');
    try {
      const q = await kgQrCreate();
      setQr(q);
      setStatus('waiting');
    } catch (e) {
      setErr((e as Error).message || '二维码获取失败');
      setStatus('expired');
    }
  }, []);

  // 首次进入：await 后再 setState（避免 effect 内同步 setState 级联渲染）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const q = await kgQrCreate();
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

  // 酷狗状态机：1=待扫码 2=已扫待确认 0=过期 4=成功（登录已在客户端自动持久化）
  useEffect(() => {
    if (!qr || status === 'ok' || status === 'expired' || status === 'loading') return;
    timerRef.current = setInterval(async () => {
      if (!qr) return;
      try {
        const r = await kgQrCheck(qr.id);
        if (r.st === 'ok') {
          if (timerRef.current) clearInterval(timerRef.current);
          setStatus('ok');
          useMusic.getState().setLoginHold(true); // 留在登录页：可继续登录其它平台
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
    <div className="flex flex-col items-center" data-testid="music-kg-qr-login">
      <div className="relative flex h-[190px] w-[190px] items-center justify-center rounded-2xl border border-white/60 bg-white/75 p-3 shadow-[0_8px_28px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.06] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-800/70">
        {status === 'loading' && <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />}
        {qr && status !== 'loading' && (
          <>
            <img src={qr.qrimg} alt="酷狗登录二维码" className="h-full w-full" draggable={false} />
            {(status === 'expired' || status === 'ok') && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/85 backdrop-blur-xl dark:bg-zinc-900/85">
                {status === 'expired' ? (
                  <>
                    <p className="text-[12px] text-zinc-500">二维码已过期</p>
                    <button
                      type="button"
                      onClick={() => void create()}
                      data-testid="music-kg-qr-refresh"
                      className="flex items-center gap-1 rounded-full bg-[#00b0f0] px-4 py-1.5 text-[12px] text-white active:scale-95"
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
      <p className="mt-4 text-[13px] text-zinc-600 dark:text-zinc-300" data-testid="music-kg-qr-status">
        {status === 'waiting' && '请使用酷狗音乐 App 扫码登录'}
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
      useMusic.getState().setLoginHold(true); // 留在登录页：可继续登录其它平台
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

// ---------------- API 配置弹层（三平台 Base URL） ----------------

export function ApiCfgSheet({ onClose }: { onClose: () => void }) {
  const cfg = getMusicApiCfg();
  const multi = getMultiCfg();
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl);
  const [apiKey, setApiKey] = useState(cfg.apiKey);
  const [qqUrl, setQqUrl] = useState(multi.qq.baseUrl);
  const [kgUrl, setKgUrl] = useState(multi.kugou.baseUrl);
  const [testing, setTesting] = useState<'' | 'netease' | 'qq' | 'kugou'>('');
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const save = () => {
    setMusicApiCfg({ baseUrl, apiKey });
    setMultiCfg({ qq: { baseUrl: qqUrl }, kugou: { baseUrl: kgUrl } });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const test = async (which: 'netease' | 'qq' | 'kugou') => {
    // 先保存当前输入（测试即生效）
    setMusicApiCfg({ baseUrl, apiKey });
    setMultiCfg({ qq: { baseUrl: qqUrl }, kugou: { baseUrl: kgUrl } });
    setTesting(which);
    setResult(null);
    try {
      let url: string;
      if (which === 'netease') {
        url = baseUrl
          ? `${baseUrl.replace(/\/+$/, '')}/toplist?timestamp=${Date.now()}`
          : `/api/music/ncm/toplist?timestamp=${Date.now()}`;
      } else if (which === 'qq') {
        url = qqUrl
          ? `${qqUrl.replace(/\/+$/, '')}/recommend/playlist?timestamp=${Date.now()}`
          : `/api/music/qq/recommend/playlist?timestamp=${Date.now()}`;
      } else {
        url = kgUrl
          ? `${kgUrl.replace(/\/+$/, '')}/login/qr/key?timestamp=${Date.now()}`
          : `/api/music/kugou/login/qr/key?timestamp=${Date.now()}`;
      }
      const res = await fetch(url);
      const text = await res.text();
      let j: Record<string, unknown> = {};
      try {
        j = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* 非 JSON */
      }
      const ok =
        which === 'netease'
          ? j.code === 200
          : which === 'qq'
            ? j.result === 100 || j.code === 200
            : !!j.data;
      setResult({ ok, msg: ok ? '连接成功 ✓' : `返回异常：${text.slice(0, 60)}` });
    } catch (e) {
      setResult({ ok: false, msg: (e as Error).message || '连接失败' });
    } finally {
      setTesting('');
    }
  };

  const inputCls =
    'h-10 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-[13px] outline-none backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100';
  const testBtn = (which: 'netease' | 'qq' | 'kugou') => (
    <button
      type="button"
      onClick={() => void test(which)}
      disabled={testing !== ''}
      className="h-9 shrink-0 rounded-full border border-white/60 bg-white/70 px-3 text-[12px] text-zinc-600 ring-1 ring-black/[0.06] backdrop-blur-xl disabled:opacity-40 active:scale-95 dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-300 dark:ring-white/10"
    >
      {testing === which ? '测试中…' : '测试'}
    </button>
  );

  return (
    <div className="absolute inset-0 z-[80] flex items-end" data-testid="music-api-cfg-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative max-h-[86%] w-full overflow-y-auto rounded-t-2xl border-t border-white/60 bg-white/85 p-5 pb-8 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">音乐 API 配置</h3>
          <button type="button" onClick={onClose} className="text-zinc-400">
            <ChevronDown className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-[11px] leading-relaxed text-zinc-400">
          三个平台均默认使用内置 API 服务（推荐，无需配置）；也可分别填入自部署的开源项目 Base URL。
        </p>

        <div className="mb-4">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PLATFORM_DOTS.netease }} />
            <label className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
              网易云 API 地址（留空 = 内置）
            </label>
          </div>
          <div className="mb-1.5 flex gap-2">
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="内置默认（本机优先 · 云端兜底）"
              data-testid="music-api-baseurl-ncm"
              className={inputCls}
            />
            {testBtn('netease')}
          </div>
          <label className="mb-1 block text-[11px] text-zinc-500">API Key（选填）</label>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="留空即可"
            data-testid="music-api-key"
            className={inputCls}
          />
        </div>

        <div className="mb-4">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PLATFORM_DOTS.qq }} />
            <label className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
              QQ 音乐 API 地址（留空 = 内置）
            </label>
          </div>
          <div className="flex gap-2">
            <input
              value={qqUrl}
              onChange={(e) => setQqUrl(e.target.value)}
              placeholder="内置默认（qqmusic-api 服务）"
              data-testid="music-api-baseurl-qq"
              className={inputCls}
            />
            {testBtn('qq')}
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PLATFORM_DOTS.kugou }} />
            <label className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
              酷狗 API 地址（留空 = 内置）
            </label>
          </div>
          <div className="flex gap-2">
            <input
              value={kgUrl}
              onChange={(e) => setKgUrl(e.target.value)}
              placeholder="内置默认（kugou-api 服务）"
              data-testid="music-api-baseurl-kg"
              className={inputCls}
            />
            {testBtn('kugou')}
          </div>
        </div>

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
            onClick={() => {
              setBaseUrl('');
              setApiKey('');
              setQqUrl('');
              setKgUrl('');
              setMusicApiCfg({ baseUrl: '', apiKey: '' });
              setMultiCfg({ qq: { baseUrl: '' }, kugou: { baseUrl: '' } });
            }}
            className="h-10 flex-1 rounded-full border border-white/60 bg-white/70 text-[13px] text-zinc-600 ring-1 ring-black/[0.06] backdrop-blur-xl active:scale-95 dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-300 dark:ring-white/10"
          >
            恢复默认
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
        <p className="mt-2 text-center text-[10px] text-zinc-400">配置保存后立即生效（密文存本机）</p>
      </div>
    </div>
  );
}
