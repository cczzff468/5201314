'use client';

/**
 * AI 邀请一起听 —— 全局邀请卡（Task 68，仿网易云一起听邀请弹窗）：
 *
 * - PhoneShell 常驻挂载：不管用户在哪个 App / 主屏幕，只要 useTogetherInvite 有邀请就弹出；
 * - 卡片 1:1 参考截图：深色圆角面板、左（角色）/右（机主）双头像、两条耳机线在中间交汇、
 *   歌名 +「邀请你一起听」、底部灰色 ✕（拒绝）与红色 ✓（接受）；
 *   第二十八轮反馈：头像外圈的描边边框删除（只留无边界圆形头像）；
 *   第三十轮反馈：容器占位底色晕圈（104 容器 vs 92 头像的 6px 环）一并删除——头像填满容器，外围零边框。
 * - z-[91]：高于一切 App 内容与迷你播放器，低于灵动岛通知(93)/来电(94)/锁屏，互不打架；
 * - 接受 → acceptTogetherInvite（建一起听会话 + 切到音乐 App 播放页）；
 *   拒绝 → declineTogetherInvite（写记忆 + 冷却）；45s 无响应自动收回（同网易云超时语义）。
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Check } from 'lucide-react';
import { useTogetherInvite, acceptTogetherInvite, declineTogetherInvite } from '@/lib/ios/together-invite';
import { useMusic, getGuestAvatar } from '@/lib/ios/music-store';

/** 双头像下缘的耳机线（两条对称贝塞尔曲线从头像内缘垂到中点交汇），纯装饰 */
function EarphoneWires() {
  return (
    <svg viewBox="0 0 300 120" className="pointer-events-none absolute -top-1 left-1/2 h-[120px] w-[300px] -translate-x-1/2" aria-hidden="true">
      <path d="M 58 44 C 52 78, 88 102, 148 110" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" />
      <path d="M 242 44 C 248 78, 212 102, 152 110" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** 单张邀请卡（key=invite.id 挂载，leaving 状态随新卡片天然重置） */
function InviteCard({ inviteId }: { inviteId: string }) {
  // 我的头像跟随音乐 App：网易云登录账号头像 > 游客自定义头像（与一起听界面 TogetherHead 同源）
  const loginUid = useMusic((s) => s.loginUid);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  const myAvatar = loginUid ? loginAvatar : getGuestAvatar();
  const [leaving, setLeaving] = useState(false);

  // 45s 无响应自动收回（setLeaving 只在定时器回调里调用，非 effect body 同步 setState）
  useEffect(() => {
    const t = window.setTimeout(() => {
      setLeaving(true);
      window.setTimeout(() => {
        void declineTogetherInvite();
      }, 260);
    }, 45_000);
    return () => window.clearTimeout(t);
  }, [inviteId]);

  const act = (fn: () => void | Promise<void>) => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => void fn(), 240);
  };

  const invite = useTogetherInvite.getState().invite;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      className="absolute inset-0 z-[91] flex items-center justify-center px-8"
      data-testid="together-invite-layer"
    >
      {/* 半透明遮罩（可点 = 拒绝，同网易云点空白关卡片） */}
      <button
        type="button"
        aria-label="忽略邀请"
        className="absolute inset-0 cursor-default bg-black/55"
        onClick={() => act(() => void declineTogetherInvite())}
      />
      <motion.div
        initial={{ scale: 0.86, opacity: 0, y: 14 }}
        animate={{ scale: leaving ? 0.92 : 1, opacity: leaving ? 0 : 1, y: leaving ? 8 : 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="relative w-full max-w-[300px] rounded-[24px] bg-[#1D1D1F]/[0.97] px-6 pb-7 pt-9 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)]"
        data-testid="together-invite-card"
      >
        {/* 双头像 + 耳机线（第三十轮：容器去占位底色、头像填满 104px——外围无任何边框/晕圈） */}
        <div className="relative mx-auto h-[104px] w-[240px]">
          <EarphoneWires />
          <div className="absolute left-[24px] top-0 flex h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-full">
            {invite?.avatar ? (
              <img
                src={invite.avatar}
                alt={invite.name || '对方'}
                className="h-[104px] w-[104px] rounded-full object-cover"
                data-testid="together-invite-avatar"
              />
            ) : (
              <span className="flex h-[104px] w-[104px] items-center justify-center rounded-full bg-zinc-700 text-[34px] font-bold text-white/80">
                {(invite?.name || 'T').slice(0, 1)}
              </span>
            )}
          </div>
          <div className="absolute right-[24px] top-0 flex h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-full">
            {myAvatar ? (
              <img src={myAvatar} alt="我" className="h-[104px] w-[104px] rounded-full object-cover" />
            ) : (
              <span className="flex h-[104px] w-[104px] items-center justify-center rounded-full bg-zinc-600 text-[34px] font-bold text-white/80">
                我
              </span>
            )}
          </div>
        </div>

        {/* 歌名 + 邀请语 */}
        <div className="mt-7 text-center">
          <p className="truncate text-[21px] font-bold leading-tight text-white" data-testid="together-invite-song">
            {invite?.songName || ''}
          </p>
          <p className="mt-2 text-[14px] text-white/55" data-testid="together-invite-inviter">
            {invite?.name || ''} 邀请你一起听
          </p>
        </div>

        {/* 接受 / 拒绝 */}
        <div className="mt-8 flex items-center justify-center gap-12">
          <button
            type="button"
            aria-label="拒绝"
            data-testid="together-invite-decline"
            onClick={() => act(() => void declineTogetherInvite())}
            className="flex h-[64px] w-[64px] items-center justify-center rounded-full bg-[#8A8A8E]/90 text-white transition-transform active:scale-90"
          >
            <X className="h-8 w-8" strokeWidth={2.6} />
          </button>
          <button
            type="button"
            aria-label="接受一起听"
            data-testid="together-invite-accept"
            onClick={() => act(() => void acceptTogetherInvite())}
            className="flex h-[64px] w-[64px] items-center justify-center rounded-full bg-[#F2574B] text-white shadow-[0_10px_28px_-6px_rgba(242,87,75,0.55)] transition-transform active:scale-90"
          >
            <Check className="h-9 w-9" strokeWidth={3} />
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function TogetherInviteLayer() {
  const invite = useTogetherInvite((s) => s.invite);
  return <AnimatePresence>{invite && <InviteCard key={invite.id} inviteId={invite.id} />}</AnimatePresence>;
}
