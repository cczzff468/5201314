'use client';

/**
 * 音乐 App 设置页：
 * - 【当前账号】切换器（下拉菜单）：三平台（网易云/QQ/酷狗）账号独立登录状态一览，
 *   头像/昵称实时展示；一键切换当前音源平台（歌单/推荐/排行榜等数据即时同步）；
 *   支持分别「去登录」与「退出登录」（三平台凭证隔离存储、互不覆盖）
 * - 播放：自动跨平台兜底开关（当前平台无版权时自动切其它平台音源播放并提示）
 * - 音乐 API 配置（三平台 Base URL：网易云 / QQ / 酷狗，各带测试按钮——统一弹层）
 * - 关于（非官方 API 声明/VIP 试听说明/解灰说明）
 */

import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Music4,
  ShieldCheck,
  Shuffle,
} from 'lucide-react';
import { clearMusicLogin } from '@/lib/ios/music-api';
import { useMusic, exitGuestMode } from '@/lib/ios/music-store';
import {
  clearQqLogin,
  clearKgLogin,
  MUSIC_PLATFORMS,
  PLATFORM_LABELS,
  PLATFORM_FULL,
  PLATFORM_DOTS,
  type MusicPlatform,
} from '@/lib/ios/music-multi';
import { Switch } from '@/components/ui/switch';
import { CoverImg } from './music-shared';
import { ApiCfgSheet } from './music';

export function MusicSettings({ asSheet = false, onBack }: { asSheet?: boolean; onBack?: () => void }) {
  const close = useMusic((s) => s.closePlayer);
  const platform = useMusic((s) => s.platform);
  const loginUid = useMusic((s) => s.loginUid);
  const loginNickname = useMusic((s) => s.loginNickname);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  const qqLogin = useMusic((s) => s.qqLogin);
  const kgLogin = useMusic((s) => s.kgLogin);
  const guestMode = useMusic((s) => s.guestMode);
  const refreshLoginUi = useMusic((s) => s.refreshLoginUi);
  const switchPlatform = useMusic((s) => s.switchPlatform);
  const crossFallback = useMusic((s) => s.crossFallback);
  const setCrossFallback = useMusic((s) => s.setCrossFallback);
  const [accountOpen, setAccountOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState<MusicPlatform | null>(null);
  const [apiCfgOpen, setApiCfgOpen] = useState(false);

  // 三平台账号快照（AuthStore：隔离存储、互不覆盖；同时登录互不影响）
  const accounts: Record<MusicPlatform, { logged: boolean; name: string; avatar: string; uid: string }> = {
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
  const cur = accounts[platform];

  const doLogout = async (p: MusicPlatform) => {
    if (p === 'netease') clearMusicLogin();
    if (p === 'qq') clearQqLogin();
    if (p === 'kugou') clearKgLogin();
    setConfirmLogout(null);
    await refreshLoginUi();
    // 当前平台退出 → 回登录页（关闭设置浮层露出登录页）
    if (p === platform) {
      useMusic.setState((s) => ({ nav: { ...s.nav, view: 'tabs' }, loginHold: false }));
      if (asSheet) onBack?.();
    }
  };

  // 去登录：切到该平台 + 退出游客态 → 登录页（关闭设置浮层露出登录页）
  const goLogin = (p: MusicPlatform) => {
    if (useMusic.getState().platform !== p) switchPlatform(p);
    exitGuestMode();
    useMusic.setState({ loginHold: false });
    setAccountOpen(false);
    if (asSheet) onBack?.();
  };

  return (
    <div className={`flex h-full flex-col ${asSheet ? 'bg-[#F8F8F8] dark:bg-black' : 'bg-[#F8F8F8] dark:bg-black'}`}>
      {/* 顶栏 */}
      <div className="flex items-center gap-2 px-4 pb-2 pt-[58px]">
        <button
          type="button"
          onClick={asSheet ? onBack : close}
          aria-label="返回"
          data-testid="music-settings-back"
          className="text-zinc-700 dark:text-zinc-200"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <span className="text-[17px] font-bold text-zinc-900 dark:text-zinc-100">设置</span>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-[110px]">
        {/* ===== 当前账号（三平台同时登录 + 一键切换音源） ===== */}
        <section
          className="rounded-2xl border border-white/60 bg-white/80 p-4 shadow-[0_8px_28px_rgba(0,0,0,0.08)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/80"
          data-testid="music-settings-account"
        >
          <div className="mb-3 flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: PLATFORM_DOTS[platform] }} />
            <p className="text-[13px] font-bold text-zinc-500">当前账号</p>
          </div>

          {/* 下拉触发行：当前音源平台账号 */}
          <button
            type="button"
            onClick={() => setAccountOpen((v) => !v)}
            data-testid="music-account-trigger"
            aria-expanded={accountOpen}
            className="flex w-full items-center gap-3 rounded-xl border border-black/[0.06] bg-white/60 px-3.5 py-3 text-left active:scale-[0.98] dark:border-white/10 dark:bg-zinc-800/60"
          >
            {cur.logged && cur.avatar ? (
              <CoverImg src={cur.avatar} className="h-10 w-10" rounded="rounded-full" alt={cur.name} />
            ) : (
              <span
                className="flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-full text-[13px] font-medium text-white"
                style={{ backgroundColor: PLATFORM_DOTS[platform], opacity: 0.6 }}
              >
                {PLATFORM_LABELS[platform].slice(0, 1)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-zinc-900 dark:text-zinc-100" data-testid="music-settings-nickname">
                {cur.logged ? cur.name || `${PLATFORM_FULL[platform]}用户` : '未登录（游客模式）'}
              </p>
              <p className="truncate text-[11px] text-zinc-400">
                {PLATFORM_FULL[platform]}
                {cur.logged ? ` · ID ${cur.uid}` : ' · 游客'}
              </p>
            </div>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-zinc-300 transition-transform ${accountOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {/* 下拉列表：三平台账号（头像/昵称/登录状态 + 使用/去登录/退出） */}
          {accountOpen && (
            <div className="mt-2 space-y-1.5" data-testid="music-account-list">
              {MUSIC_PLATFORMS.map((p) => {
                const it = accounts[p];
                const active = platform === p;
                return (
                  <div
                    key={p}
                    className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-all ${
                      active ? 'bg-black/[0.045] dark:bg-white/[0.07]' : ''
                    }`}
                    data-testid={`music-account-row-${p}`}
                  >
                    <span
                      aria-hidden
                      className="h-7 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: PLATFORM_DOTS[p], opacity: active ? 1 : 0.35 }}
                    />
                    {it.logged && it.avatar ? (
                      <CoverImg src={it.avatar} className="h-9 w-9" rounded="rounded-full" alt={it.name} />
                    ) : (
                      <span
                        className="flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full text-[11px] font-medium text-white"
                        style={{ backgroundColor: PLATFORM_DOTS[p], opacity: 0.55 }}
                      >
                        {PLATFORM_LABELS[p].slice(0, 1)}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100">
                        {it.logged ? it.name || `${PLATFORM_FULL[p]}用户` : '未登录'}
                        {active && <span className="ml-1.5 text-[10px] font-normal text-zinc-400">使用中</span>}
                      </p>
                      <p className="truncate text-[11px] text-zinc-400">
                        {it.logged ? `${PLATFORM_LABELS[p]} · ID ${it.uid}` : `${PLATFORM_LABELS[p]} · 未登录`}
                      </p>
                    </div>
                    {active ? (
                      it.logged && (
                        <button
                          type="button"
                          onClick={() => setConfirmLogout(p)}
                          data-testid={`music-account-quit-${p}`}
                          className="shrink-0 rounded-full border border-black/10 px-2.5 py-1 text-[11px] text-zinc-400 active:scale-95 dark:border-white/15"
                        >
                          退出
                        </button>
                      )
                    ) : it.logged ? (
                      <button
                        type="button"
                        onClick={() => {
                          switchPlatform(p); // 已登录平台：一键切换音源（数据即时同步）
                          setAccountOpen(false);
                        }}
                        data-testid={`music-account-use-${p}`}
                        className="shrink-0 rounded-full bg-zinc-900 px-3 py-1 text-[11.5px] font-medium text-white active:scale-95 dark:bg-white dark:text-zinc-900"
                      >
                        使用
                      </button>
                    ) : guestMode ? (
                      <button
                        type="button"
                        onClick={() => {
                          switchPlatform(p); // 游客：切平台继续逛
                          setAccountOpen(false);
                        }}
                        data-testid={`music-account-use-${p}`}
                        className="shrink-0 rounded-full border border-black/10 px-3 py-1 text-[11.5px] font-medium text-zinc-500 active:scale-95 dark:border-white/15 dark:text-zinc-400"
                      >
                        使用
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => goLogin(p)}
                        data-testid={`music-account-login-${p}`}
                        className="shrink-0 rounded-full border border-black/10 px-3 py-1 text-[11.5px] font-medium text-zinc-500 active:scale-95 dark:border-white/15 dark:text-zinc-400"
                      >
                        去登录
                      </button>
                    )}
                    {active && (
                      <Check className="h-4 w-4 shrink-0 text-zinc-900 dark:text-white" aria-label="当前音源平台" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {guestMode && (
            <button
              type="button"
              onClick={() => goLogin(platform)}
              data-testid="music-settings-exit-guest"
              className="mt-2 w-full rounded-full border border-black/10 bg-white/60 py-2 text-[12.5px] font-medium text-zinc-600 active:scale-[0.98] dark:border-white/15 dark:bg-zinc-800/60 dark:text-zinc-300"
            >
              退出游客模式 · 去登录{PLATFORM_LABELS[platform]}账号
            </button>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
            三平台可同时登录（凭证独立保存在本机，互不覆盖）；点「使用」一键切换音源，「我的歌单 / 推荐 / 排行榜」等数据即时同步为该平台真实数据。
          </p>
        </section>

        {/* ===== 播放（自动跨平台兜底） ===== */}
        <section
          className="rounded-2xl border border-white/60 bg-white/80 p-4 shadow-[0_8px_28px_rgba(0,0,0,0.08)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/80"
          data-testid="music-settings-playback"
        >
          <div className="mb-3 flex items-center gap-1.5">
            <Shuffle className="h-4 w-4 text-zinc-400" />
            <p className="text-[13px] font-bold text-zinc-500">播放</p>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-black/[0.06] bg-white/60 px-3.5 py-3 dark:border-white/10 dark:bg-zinc-800/60">
            <div className="min-w-0 pr-3">
              <p className="text-[14px] font-medium text-zinc-800 dark:text-zinc-200">自动跨平台兜底</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
                当前平台无版权（VIP/下架）时，自动到其它平台找可播音源播放，并提示「已为你切换至 XX 平台播放」
              </p>
            </div>
            <Switch
              checked={crossFallback}
              onCheckedChange={(v) => setCrossFallback(v)}
              aria-label="自动跨平台兜底"
              data-testid="music-settings-crossfallback"
            />
          </div>
        </section>

        {/* ===== 音乐 API 配置（三平台 Base URL） ===== */}
        <section
          className="rounded-2xl border border-white/60 bg-white/80 p-4 shadow-[0_8px_28px_rgba(0,0,0,0.08)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/80"
          data-testid="music-settings-api"
        >
          <div className="mb-3 flex items-center gap-1.5">
            <Music4 className="h-4 w-4 text-zinc-400" />
            <p className="text-[13px] font-bold text-zinc-500">音乐 API 配置</p>
          </div>
          <button
            type="button"
            onClick={() => setApiCfgOpen(true)}
            data-testid="music-settings-api-open"
            className="flex w-full items-center justify-between rounded-xl border border-black/[0.06] bg-white/60 px-3.5 py-3 text-left active:scale-[0.98] dark:border-white/10 dark:bg-zinc-800/60"
          >
            <span className="text-[13px] text-zinc-700 dark:text-zinc-200">网易云 / QQ / 酷狗 三个平台的 API 地址</span>
            <ChevronRight className="h-4 w-4 text-zinc-300" />
          </button>
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
            默认全部使用内置 API 服务（本机实例优先，云端兜底），无需任何配置；也可为三个平台分别填入自部署开源项目的 Base URL。
          </p>
        </section>

        {/* ===== 关于 ===== */}
        <section className="rounded-2xl border border-white/60 bg-white/80 p-4 shadow-[0_8px_28px_rgba(0,0,0,0.08)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/80">
          <div className="mb-2 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-zinc-400" />
            <p className="text-[13px] font-bold text-zinc-500">关于</p>
          </div>
          <ul className="space-y-1.5 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            <li>· 基于开源项目 NeteaseCloudMusicApi / jsososo QQMusicApi / KuGouMusicApi（非官方），需自行承担相应风险；</li>
            <li>· 网易云 VIP 歌曲非会员仅试听 30 秒；播放失败时自动经 UnblockNeteaseMusic 到酷我/酷狗/咪咕等平台找免费音源（解灰）；</li>
            <li>· QQ / 酷狗音源需登录各平台账号后才可播放与同步歌单；未登录时会按「自动跨平台兜底」到其它平台找音源；</li>
            <li>· 三平台登录凭证（cookie/token）均密文保存在本机，不经过第三方。</li>
          </ul>
        </section>

        {confirmLogout && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40" data-testid="music-logout-confirm">
            <div className="mx-8 w-full max-w-[280px] rounded-2xl border border-white/60 bg-white/85 p-5 shadow-2xl backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-800/85">
              <p className="text-center text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">退出{PLATFORM_LABELS[confirmLogout]}登录？</p>
              <p className="mt-1.5 text-center text-[12px] text-zinc-400">
                退出后将清除本机保存的该平台凭证，本地历史与播放队列会保留
              </p>
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmLogout(null)}
                  className="h-10 flex-1 rounded-full border border-white/60 bg-white/70 text-[13px] text-zinc-600 ring-1 ring-black/[0.06] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-300 dark:ring-white/10"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void doLogout(confirmLogout)}
                  data-testid="music-logout-yes"
                  className="h-10 flex-1 rounded-full bg-red-500 text-[13px] font-medium text-white active:scale-95"
                >
                  退出
                </button>
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => useMusic.getState().setTab('mine')}
          className="flex w-full items-center justify-between rounded-2xl border border-white/60 bg-white/80 px-4 py-3.5 shadow-[0_8px_28px_rgba(0,0,0,0.08)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/80"
        >
          <span className="text-[13px] text-zinc-600 dark:text-zinc-300">我的音乐主页</span>
          <ChevronRight className="h-4 w-4 text-zinc-300" />
        </button>
      </div>

      {/* 三平台 API 配置弹层（与登录页同一组件） */}
      {apiCfgOpen && <ApiCfgSheet onClose={() => setApiCfgOpen(false)} />}
    </div>
  );
}
