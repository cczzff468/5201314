'use client';

/**
 * 音乐 App 设置页：
 * - API 配置卡（地址/API Key/测试连接/恢复默认）
 * - 账号卡（当前用户/退出登录；退出后回登录页）
 * - 关于（非官方 API 声明/VIP 试听说明）
 */

import { useState } from 'react';
import { ChevronLeft, ChevronRight, KeyRound, Link2, LogOut, RefreshCcw, ShieldCheck } from 'lucide-react';
import {
  clearMusicLogin,
  getMusicApiCfg,
  setMusicApiCfg,
  DEFAULT_MUSIC_API_CFG,
} from '@/lib/ios/music-api';
import { useMusic, exitGuestMode } from '@/lib/ios/music-store';
import { CoverImg } from './music-shared';

export function MusicSettings({ asSheet = false, onBack }: { asSheet?: boolean; onBack?: () => void }) {
  const close = useMusic((s) => s.closePlayer);
  const loginUid = useMusic((s) => s.loginUid);
  const loginNickname = useMusic((s) => s.loginNickname);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  const refreshLoginUi = useMusic((s) => s.refreshLoginUi);
  const [cfg, setCfg] = useState(() => getMusicApiCfg());
  const [saved, setSaved] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const save = () => {
    setMusicApiCfg(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const reset = () => {
    setMusicApiCfg(DEFAULT_MUSIC_API_CFG);
    setCfg(DEFAULT_MUSIC_API_CFG);
  };

  const doLogout = async () => {
    clearMusicLogin();
    await refreshLoginUi();
    setConfirmLogout(false);
    // 回到 tabs（若从播放页/歌单进）
    useMusic.setState((s) => ({ nav: { ...s.nav, view: 'tabs' } }));
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
        {/* 账号 */}
        <section className="rounded-2xl border border-white/60 bg-white/80 p-4 shadow-[0_8px_28px_rgba(0,0,0,0.08)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/80" data-testid="music-settings-account">
          <p className="mb-3 text-[13px] font-bold text-zinc-500">账号</p>
          {loginUid ? (
            <div className="flex items-center gap-3">
              <CoverImg src={loginAvatar} className="h-12 w-12" rounded="rounded-full" alt={loginNickname} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-zinc-900 dark:text-zinc-100" data-testid="music-settings-nickname">
                  {loginNickname}
                </p>
                <p className="text-[11px] text-zinc-400">网易云账号 · ID {loginUid}</p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmLogout(true)}
                data-testid="music-settings-logout"
                className="flex items-center gap-1 rounded-full border border-red-200 px-3 py-1.5 text-[12px] text-red-500 active:scale-95 dark:border-red-500/30"
              >
                <LogOut className="h-3.5 w-3.5" />
                退出登录
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-zinc-400">未登录（游客模式）</p>
              <button
                type="button"
                onClick={() => {
                  exitGuestMode(); // 回登录页
                  if (asSheet) onBack?.();
                }}
                data-testid="music-settings-login"
                className="rounded-full bg-[#C20C0C] px-3.5 py-1.5 text-[12px] font-medium text-white active:scale-95"
              >
                登录网易云账号
              </button>
            </div>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
            登录状态保存在本机，重启 App 后仍有效；退出后可重新扫码或用手机号登录（切换账号）。
          </p>
        </section>

        {/* API 配置 */}
        <section className="rounded-2xl border border-white/60 bg-white/80 p-4 shadow-[0_8px_28px_rgba(0,0,0,0.08)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/80" data-testid="music-settings-api">
          <div className="mb-3 flex items-center gap-1.5">
            <Link2 className="h-4 w-4 text-zinc-400" />
            <p className="text-[13px] font-bold text-zinc-500">API 配置</p>
          </div>
          <label className="mb-1 block text-[12px] text-zinc-500">API 地址（留空 = 内置默认服务）</label>
          <input
            value={cfg.baseUrl}
            onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
            placeholder="内置默认（本机优先 · 云端兜底）"
            data-testid="music-settings-baseurl"
            className="mb-3 h-10 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-[13px] text-zinc-900 outline-none backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100"
          />
          <div className="mb-1 flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5 text-zinc-400" />
            <label className="text-[12px] text-zinc-500">API Key（选填，自定义 API 鉴权用）</label>
          </div>
          <input
            value={cfg.apiKey}
            onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
            placeholder="留空即可"
            data-testid="music-settings-apikey"
            className="h-10 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-[13px] text-zinc-900 outline-none backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100"
          />
          <div className="mt-3 flex gap-2.5">
            <button
              type="button"
              onClick={reset}
              className="flex h-9 flex-1 items-center justify-center gap-1 rounded-full border border-zinc-300 text-[12px] text-zinc-600 active:scale-95 dark:border-zinc-600 dark:text-zinc-300"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              恢复默认
            </button>
            <button
              type="button"
              onClick={save}
              data-testid="music-settings-save"
              className="h-9 flex-1 rounded-full bg-[#C20C0C] text-[12px] font-medium text-white active:scale-95"
            >
              {saved ? '已保存 ✓ 立即生效' : '保存配置'}
            </button>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
            内置默认已启用双通道：本机实例（3010）优先响应，失联时自动切换你的 Vercel 云端实例
            （api-enhanced-ochre-rho.vercel.app），全程无需配置；响应头 x-ncm-upstream 可查看当前服务的实例。
          </p>
        </section>

        {/* 关于 */}
        <section className="rounded-2xl border border-white/60 bg-white/80 p-4 shadow-[0_8px_28px_rgba(0,0,0,0.08)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/80">
          <div className="mb-2 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-zinc-400" />
            <p className="text-[13px] font-bold text-zinc-500">关于</p>
          </div>
          <ul className="space-y-1.5 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            <li>· 基于开源项目 NeteaseCloudMusicApi（非官方），需自行承担相应风险；</li>
            <li>· VIP 歌曲对非会员账号仅提供 30 秒试听；下架/版权歌曲可能无法播放；</li>
            <li>· 验证码登录会发送真实短信；登录凭证（cookie）仅保存在本机，不经过第三方。</li>
          </ul>
        </section>

        {confirmLogout && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40" data-testid="music-logout-confirm">
            <div className="mx-8 w-full max-w-[280px] rounded-2xl border border-white/60 bg-white/85 p-5 shadow-2xl backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-800/85">
              <p className="text-center text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">退出登录？</p>
              <p className="mt-1.5 text-center text-[12px] text-zinc-400">
                退出后将返回登录页，本地历史与播放队列会保留
              </p>
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmLogout(false)}
                  className="h-10 flex-1 rounded-full border border-white/60 bg-white/70 text-[13px] text-zinc-600 ring-1 ring-black/[0.06] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-300 dark:ring-white/10"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void doLogout()}
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
    </div>
  );
}
