'use client';

/**
 * 吃醋锁全屏弹窗（v1.9.19）：活跃锁存在且用户回到 APP 时强制弹出。
 *
 * 需求三.2/3：用户点桌面 App 发现被冻结（「由 Shell 所管理」）→ 必须强制弹全屏提示：
 * 「[角色名] · [锁定原因]（人设生成）」+ 强制两个按钮【去哄哄 TA】/【强制解锁】。
 *
 * 展示策略：锁存在 && overlayShownAt===0 && 手机未锁屏未熄屏 && 页面在前台 → 弹；
 * 【去哄哄 TA】→ 记 shownAt（不再自动弹）+ 打开与角色的聊天小窗；
 * 【强制解锁】→ unlockJealousy('forced')（立即解封 + LLM 写戏剧性记忆「我很委屈，
 * 但我更讨厌他了/但我更爱他了」）；
 * 倒计时到点由 JealousyWatcher 自动解锁（弹窗若在展示则随锁消失）。
 *
 * 层级：z-[86]（高于锁屏 65 / 全屏来电 84，低于熄屏遮罩 95）——锁屏期间不弹，
 * 解锁手机后第一时间出现。
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Heart, Lock, Unlock, Clock } from 'lucide-react';
import {
  readJealousyRuntime,
  subscribeJealousy,
  getJealousyVersion,
  pkgDisplayName,
  markJealousyOverlayShown,
  unlockJealousy,
  jealousyRemainSec,
} from '@/lib/ios/jealousy-lock';
import { useUI } from '@/lib/ios/store';
import { openChatFloat } from '@/lib/ios/chat-float-store';
import { avatarFor } from '@/lib/contacts';
import { listContacts } from '@/lib/ios/contacts-store';
// v1.9.21：点被冻结的网页 App 图标 → 请求复弹本弹窗（首次自动弹过后仍可再看 TA 的留言）
import { isWebLockOverlayPending, clearWebLockOverlayPending, subscribeWebLock, getWebLockVersion } from '@/lib/ios/web-app-lock';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function JealousyLockOverlay() {
  const version = useSyncExternalStore(subscribeJealousy, getJealousyVersion);
  // v1.9.21：网页冻结态/复弹请求变化 → 即时重渲染（点冻结图标马上弹，不等 4s 兑底轮询）
  const webVer = useSyncExternalStore(subscribeWebLock, getWebLockVersion);
  const locked = useUI((s) => s.locked);
  const screenOff = useUI((s) => s.screenOff);

  const [visible, setVisible] = useState(false);
  const [tick, setTick] = useState(0); // 每秒驱动重渲染（remain 由 unlockAt 派生计算）
  const [unlocking, setUnlocking] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);

  const rt = readJealousyRuntime();
  const lock = rt.lock;
  void version; // 订阅版本号变化即重渲染（runtime 直读）
  // 剩余倒计时：由 unlockAt 派生（tick 每秒驱动重渲染；无锁为 null）
  const remain = lock ? Math.max(0, Math.ceil((lock.unlockAt - Date.now()) / 1000)) : null;
  void tick;

  // 弹窗显隐判定（锁存在 +（未展示过 或 点了冻结图标请求复弹）+ 手机可用 + 页面在前台）
  useEffect(() => {
    const check = () => {
      const l = readJealousyRuntime().lock;
      setVisible(
        !!l &&
          (l.overlayShownAt === 0 || isWebLockOverlayPending()) &&
          !useUI.getState().locked &&
          !useUI.getState().screenOff &&
          document.visibilityState === 'visible',
      );
    };
    check();
    document.addEventListener('visibilitychange', check);
    const t = setInterval(check, 4000); // 兜底轮询（用户解锁手机/切回 APP 4s 内必弹）
    return () => {
      document.removeEventListener('visibilitychange', check);
      clearInterval(t);
    };
  }, [version, webVer, locked, screenOff]);

  // 倒计时每秒驱动；到点直接触发解锁（与守望者同源，免等下一轮 tick）
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => {
      setTick((x) => x + 1);
      const r = jealousyRemainSec();
      if (r === null) setVisible(false); // 锁已解除 → 弹窗随之消失
      else if (r <= 0) void unlockJealousy('timeout').then(() => setVisible(false));
    }, 1000);
    return () => clearInterval(t);
  }, [visible]);

  // 角色头像（弹窗展示用；异步加载，失败用首字）
  useEffect(() => {
    let alive = true;
    const l = readJealousyRuntime().lock;
    void (async () => {
      if (!l) {
        if (alive) setAvatar(null);
        return;
      }
      try {
        const all = await listContacts();
        const c = all.find((x) => x.id === l.contactId);
        if (alive) setAvatar(c ? avatarFor(c, l.app) : null);
      } catch {
        if (alive) setAvatar(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [lock?.contactId, lock?.app, lock?.lockedAt]);

  const appName = lock ? pkgDisplayName(lock.pkg) : '';

  const onCoax = () => {
    if (!lock) return;
    markJealousyOverlayShown(); // 本次锁不再自动弹
    clearWebLockOverlayPending(); // 复弹请求一并消费（去哄哄了，不再重复弹）
    setVisible(false);
    openChatFloat(lock.contactId); // 直达与 TA 的聊天（哄哄去）
  };

  const onForce = async () => {
    setUnlocking(true);
    try {
      await unlockJealousy('forced'); // 立即解封 + 异步写戏剧性记忆
    } finally {
      setUnlocking(false);
      clearWebLockOverlayPending(); // 复弹请求一并消费（锁已解，不再弹）
      setVisible(false);
    }
  };

  return (
    <AnimatePresence>
      {visible && lock ? (
        <motion.div
          key="jealousy-lock-overlay"
          role="alertdialog"
          aria-label="吃醋锁全屏提示"
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
          className="pointer-events-auto absolute inset-0 z-[86] flex select-none flex-col items-center overflow-hidden px-7"
          style={{
            background:
              'radial-gradient(120% 80% at 50% 0%, #7f1d3a 0%, #58142b 45%, #2b0a17 100%), linear-gradient(#2b0a17, #1a060f)',
          }}
        >
          {/* 顶部光晕 */}
          <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-[#ff5c8a]/25 blur-3xl" />

          <div className="relative flex h-full w-full max-w-sm flex-col items-center justify-between py-14">
            {/* 头部：角色名 + 被锁应用 */}
            <div className="flex flex-col items-center gap-3 pt-2">
              <div className="relative">
                {avatar ? (
                  <img src={avatar} alt={lock.charName} className="h-20 w-20 rounded-full object-cover ring-2 ring-white/25" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 text-3xl font-semibold text-white ring-2 ring-white/25">
                    {lock.charName.slice(0, 1)}
                  </div>
                )}
                <span className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-[#1a060f] ring-2 ring-[#ff5c8a]/60">
                  <Lock size={14} strokeWidth={2.2} className="text-[#ff8fab]" aria-hidden />
                </span>
              </div>
              <p className="text-[15px] font-medium text-white/60">{lock.charName}把</p>
              <p className="flex items-center gap-1.5 text-[26px] font-semibold tracking-wide text-white">
                <span className="opacity-40 grayscale filter" aria-hidden>
                  📱
                </span>
                {appName}
              </p>
              <p className="text-[15px] font-medium text-white/60">锁住了</p>
            </div>

            {/* 中部：锁定原因（人设生成）+ 图标变灰说明 */}
            <div className="flex w-full flex-col items-center gap-4">
              <div className="rounded-2xl bg-white/[0.07] px-6 py-5 ring-1 ring-white/10 backdrop-blur-sm">
                <p className="text-center text-[17px] leading-relaxed text-[#ffd9e2]">“{lock.reason}”</p>
              </div>
              <p className="flex items-center gap-1.5 text-[12px] text-white/40">
                <Lock size={11} strokeWidth={2} aria-hidden />
                {lock.web
                  ? `应用已被冻结 · 图标变灰 · 由 ${lock.charName} 管理`
                  : '应用已被挂起 · 桌面图标变灰 · 由 Shell 所管理'}
              </p>
            </div>

            {/* 底部：倒计时 + 两个强制按钮 */}
            <div className="flex w-full flex-col items-center gap-4">
              <p className="flex items-center gap-1.5 text-[12.5px] tabular-nums text-white/45" data-testid="jealousy-lock-remain">
                <Clock size={12} strokeWidth={2} aria-hidden />
                {remain !== null && remain > 0 ? `${fmt(remain)} 后自动解锁` : '即将自动解锁'}
              </p>

              <button
                type="button"
                onClick={onCoax}
                data-testid="jealousy-lock-coax-btn"
                className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#ff5c8a] to-[#ff8fab] py-3.5 text-[16px] font-semibold text-white shadow-lg shadow-[#ff5c8a]/30 transition-transform active:scale-[0.97]"
              >
                <Heart size={17} strokeWidth={2.2} aria-hidden />
                去哄哄 TA
              </button>

              <button
                type="button"
                onClick={() => void onForce()}
                disabled={unlocking}
                data-testid="jealousy-lock-force-btn"
                className="flex w-full items-center justify-center gap-2 rounded-full bg-white/[0.08] py-3 text-[14px] font-medium text-white/70 ring-1 ring-white/15 backdrop-blur-sm transition-transform active:scale-[0.97] disabled:opacity-50"
              >
                <Unlock size={14} strokeWidth={2.2} aria-hidden />
                {unlocking ? '正在解开…' : '强制解锁'}
              </button>
              <p className="text-[11px] text-white/30">强行解开会让 TA 更委屈——确定吗？</p>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
