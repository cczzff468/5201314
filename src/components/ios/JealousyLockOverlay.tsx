'use client';

/**
 * 吃醋锁全屏弹窗（v1.9.19 → v2.2 六项 UI 极致打磨）。
 *
 * v2.2 需求一.3【仅点击弹出】：锁定界面只在用户点击被冻结的 App 图标时出现
 * （blockWebAppOpen → requestWebLockOverlay → pending）；AI 锁定的瞬间【不再】
 * 自动全屏弹出——AI 冻结后走聊天剧情消息 + 系统通知告知用户，用户点灰图标才见全屏。
 *
 * v2.2 需求一.1/一.2【应用名汉化】：应用名优先内置中文映射（com.android.notes → 备忘录），
 * 未命中走原生 PackageManager.getApplicationLabel（getAppLabel 桥）取系统中文名，
 * 原生不可用/解析失败兜底显示原包名——绝不把英文包名裸露给用户。
 *
 * v2.2 需求二【界面重构】：
 * - 头像联动：顶部圆形头像动态读取当前聊天对象（contactId 精确命中 > 角色名模糊匹配，
 *   均无时回退角色名首字），绝不写死；
 * - 【去哄哄 TA】在【强制解锁】上方：跳到该联系人所在 App 的聊天界面
 *   （微信锁的→微信聊天页，QQ 锁的→QQ 聊天页，信息锁的→信息聊天页）；
 * - 【强制解锁】直接发指令解开（真机冻结同步 pm unsuspend），并在聊天里弹一条
 *   系统提示「你强制解开了[软件名]」让 AI 知道（补写事件记忆，AI 下轮能自然提起）；
 * - 布局：锁定理由去掉圆角边框、紧跟「冻结了」下方；「应用已被冻结·图标变灰·由×管理」
 *   移到【去哄哄 TA】按钮上方。
 *
 * 层级：z-[86]（高于锁屏 65 / 全屏来电 84，低于熄屏遮罩 95）——锁屏期间不弹，
 * 解锁手机后点冻结图标第一时间出现。
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Heart, Lock, Unlock, Clock, ChevronLeft } from 'lucide-react';
import {
  readJealousyRuntime,
  subscribeJealousy,
  getJealousyVersion,
  pkgDisplayName,
  resolvePkgDisplayName,
  markJealousyOverlayShown,
  unlockJealousy,
  jealousyRemainSec,
} from '@/lib/ios/jealousy-lock';
import { useUI, type AppId } from '@/lib/ios/store';
import { openChatFloat } from '@/lib/ios/chat-float-store';
import { avatarFor } from '@/lib/contacts';
import { listContacts } from '@/lib/ios/contacts-store';
// v1.9.21：点被冻结的网页 App 图标 → 请求复弹本弹窗（AI 冻结/吃醋锁唯一的弹出入口）
// v2.4 多应用冻结：按「点的是哪个 App」取对应冻结记录（批量冻结 17 个时每个 App 各自展示自己的倒计时/理由）
import {
  isWebLockOverlayPending,
  clearWebLockOverlayPending,
  subscribeWebLock,
  getWebLockVersion,
  getWebFrozen,
  getWebLockOverlayApp,
  unfreezeWebPkg,
  pruneExpiredWebFrozen,
  webPkgOfApp,
} from '@/lib/ios/web-app-lock';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function JealousyLockOverlay() {
  const version = useSyncExternalStore(subscribeJealousy, getJealousyVersion);
  // 网页冻结态/复弹请求变化 → 即时重渲染（点冻结图标马上弹，不等 4s 兜底轮询）
  const webVer = useSyncExternalStore(subscribeWebLock, getWebLockVersion);
  const locked = useUI((s) => s.locked);
  const screenOff = useUI((s) => s.screenOff);

  const [visible, setVisible] = useState(false);
  const [tick, setTick] = useState(0); // 每秒驱动重渲染（remain 由 unlockAt 派生计算）
  const [unlocking, setUnlocking] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  // v2.2 需求一：异步原生 PackageManager 解析出的中文名（{ pkg, name }；仅与当前包名匹配时生效）
  const [resolvedLabel, setResolvedLabel] = useState<{ pkg: string; name: string } | null>(null);

  const rt = readJealousyRuntime();
  const lock = rt.lock;
  void version; // 订阅版本号变化即重渲染（runtime 直读）
  // 剩余倒计时：由 unlockAt 派生（tick 每秒驱动重渲染；无锁为 null）
  const remain = lock ? Math.max(0, Math.ceil((lock.unlockAt - Date.now()) / 1000)) : null;
  void tick;

  // AI 冻结态（rt.lock 为 null 但 web frozen 存在）：与吃醋锁共用本全屏界面。
  // v2.4：优先取「用户点的那个 App」的记录（批量冻结时每个 App 各自的倒计时/理由）；
  // 点按信息缺失时回退主记录（unlockAt 最晚的那条）
  const pendingApp = getWebLockOverlayApp();
  const pendingPkg = pendingApp !== null ? webPkgOfApp(pendingApp) : null;
  const aiFrozen = !lock ? (pendingPkg ? getWebFrozen(pendingPkg) : getWebFrozen()) : null;
  const aiFrozenRemain = aiFrozen ? Math.max(0, Math.ceil((aiFrozen.unlockAt - Date.now()) / 1000)) : null;

  // 弹窗显隐判定（v2.2 需求一.3）：只看「用户点了被冻结的 App 图标」的复弹请求——
  // AI 锁定成功的瞬间绝不自动弹出（通知/剧情消息负责告知，全屏留给用户主动点开看）。
  useEffect(() => {
    const check = () => {
      const l = readJealousyRuntime().lock;
      const pending = isWebLockOverlayPending();
      const pApp = getWebLockOverlayApp();
      const pPkg = pApp !== null ? webPkgOfApp(pApp) : null;
      // 点的是哪个 App 就看哪个 App 的冻结记录（无点按信息回退主记录）
      const wf = !l ? (pPkg ? getWebFrozen(pPkg) : getWebFrozen()) : null;
      const jealousyPending = !!l && pending;
      const aiPending = !l && !!wf && wf.src === 'ai' && pending;
      setVisible(jealousyPending || aiPending);
    };
    check();
    document.addEventListener('visibilitychange', check);
    const t = setInterval(check, 4000);
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
      // 吃醋锁模式：jealousyRemainSec 读 rt.lock
      if (lock) {
        const r = jealousyRemainSec();
        if (r === null) setVisible(false); // 锁已解除 → 弹窗随之消失
        else if (r <= 0) void unlockJealousy('timeout').then(() => setVisible(false));
      } else {
        // AI 冻结模式：读当前展示的那个 App 的冻结记录（v2.4：按点按的 App 取）
        const pApp = getWebLockOverlayApp();
        const pPkg = pApp !== null ? webPkgOfApp(pApp) : null;
        const wf = pPkg ? getWebFrozen(pPkg) : getWebFrozen();
        if (!wf) {
          setVisible(false); // 冻结态已清除
        } else if (wf.unlockAt <= Date.now()) {
          // v2.4：扫掉全部已过期记录（批量冻结时到点各自自愈，不动未到期的）
          pruneExpiredWebFrozen();
          // v2.2 需求四：同步检查真机冻结记录（freezeRealApp 的时长到点 → pm unsuspend）
          void import('@/lib/ios/real-app-freeze')
            .then((m) => m.checkRealFreezeExpiry())
            .catch(() => null);
          setVisible(false);
        }
      }
    }, 1000);
    return () => clearInterval(t);
  }, [visible, lock]);

  // v2.2 需求一【应用名汉化】：渲染时同步兜底（内置中文映射/原样包名），异步原生
  // PackageManager 取系统中文名（resolvePkgDisplayName 内置缓存 + localStorage 持久），
  // 解析成功且与兜底不同才更新（绝不裸显英文包名，解析失败保持兜底）。
  const targetPkg = lock?.pkg ?? aiFrozen?.pkg ?? null;
  const appName = resolvedLabel && resolvedLabel.pkg === targetPkg ? resolvedLabel.name : targetPkg ? pkgDisplayName(targetPkg) : '';
  useEffect(() => {
    if (!targetPkg) return;
    let alive = true;
    void resolvePkgDisplayName(targetPkg)
      .then((n) => {
        if (alive && n && n !== pkgDisplayName(targetPkg)) setResolvedLabel({ pkg: targetPkg, name: n });
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [targetPkg]);

  // v2.2 需求二.1【头像联动】：动态读取当前聊天对象头像——contactId 精确命中优先，
  // 无 contactId（兜底标记路径/旧记录）按角色名模糊匹配；均无才回退角色名首字（不写死）。
  useEffect(() => {
    let alive = true;
    void (async () => {
      const l = readJealousyRuntime().lock;
      const wf = !l ? getWebFrozen() : null;
      if (!l && !wf) {
        if (alive) setAvatar(null);
        return;
      }
      try {
        const all = await listContacts();
        const contactId = l?.contactId ?? wf?.contactId;
        const app = l?.app ?? wf?.app;
        const charName = l?.charName ?? wf?.charName ?? '';
        let c = contactId ? all.find((x) => x.id === contactId) : undefined;
        if (!c && charName) {
          c = all.find((x) => {
            const names = [x.name?.trim(), x.nickname?.trim(), x.remark?.trim()].filter(Boolean);
            return names.includes(charName);
          });
        }
        if (alive) setAvatar(c ? avatarFor(c, ((app ?? 'sms') as 'wx' | 'qq' | 'sms')) : null);
      } catch {
        if (alive) setAvatar(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [lock?.contactId, lock?.app, lock?.lockedAt, aiFrozen?.pkg, aiFrozen?.contactId, aiFrozen?.unlockAt]);

  const showOverlay = visible && (lock || aiFrozen);
  const isAiFrozenMode = !lock && !!aiFrozen;
  const charName = lock?.charName ?? aiFrozen?.charName ?? 'TA';
  const reasonText = lock
    ? lock.reason
    : aiFrozen?.reason || `由 ${aiFrozen?.charName || 'TA'} 冻结`;

  const onCoax = () => {
    if (lock) {
      markJealousyOverlayShown();
      clearWebLockOverlayPending();
      setVisible(false);
      // v2.2 需求二.2：跳到锁定者所在 App 的聊天界面（微信→wechat / QQ→qq / 信息→chat）
      const targetApp: AppId = lock.app === 'wx' ? 'wechat' : lock.app === 'qq' ? 'qq' : 'chat';
      try {
        useUI.getState().openApp(targetApp);
      } catch {
        /* 忽略 */
      }
      openChatFloat(lock.contactId);
    } else if (aiFrozen && aiFrozen.contactId) {
      clearWebLockOverlayPending();
      setVisible(false);
      // AI 冻结模式：同样按锁定者所在 App 跳转
      const targetApp: AppId = aiFrozen.app === 'wx' ? 'wechat' : aiFrozen.app === 'qq' ? 'qq' : 'chat';
      try {
        useUI.getState().openApp(targetApp);
      } catch {
        /* 忽略 */
      }
      openChatFloat(aiFrozen.contactId);
    }
  };

  const onForce = async () => {
    setUnlocking(true);
    try {
      const appNameForMsg = appName || (lock ? pkgDisplayName(lock.pkg) : aiFrozen ? pkgDisplayName(aiFrozen.pkg) : '');
      if (lock) {
        // 吃醋锁：直接发指令解开（真机锁内部已含 pm unsuspend + 失败补刀重试）
        await unlockJealousy('forced');
      } else if (aiFrozen) {
        // v2.4 多应用冻结：只解当前展示的这个 App（AI 批量冻结的其他应用保持锁定）
        unfreezeWebPkg(aiFrozen.pkg);
      }
      // v2.2 需求二.3：AI 真机冻结（freezeRealApp 记录）→ 强制解锁同步 pm unsuspend 真机应用
      const targetPkg = lock?.pkg ?? aiFrozen?.pkg;
      if (targetPkg) {
        try {
          const { getRealFrozen, setRealFrozen } = await import('@/lib/ios/real-app-freeze');
          const rf = getRealFrozen();
          if (rf && rf.pkg === targetPkg) {
            const { labUnsuspendApp } = await import('@/lib/ios/device-ops');
            const r = await labUnsuspendApp(rf.pkg);
            if (r.ok) setRealFrozen(null);
            // 失败：保留记录，RealFreezeWatcher 下轮自动补刀解冻
          }
        } catch {
          /* 真机解冻失败不影响解锁流程（守望者会重试） */
        }
      }
      // v2.2 需求二.3：聊天里弹系统提示「你强制解开了[软件名]」让 AI 知道
      const contactId = lock?.contactId ?? aiFrozen?.contactId;
      const app = (lock?.app ?? aiFrozen?.app ?? 'sms') as 'wx' | 'qq' | 'sms';
      if (contactId && appNameForMsg) {
        const sessionKey = app === 'wx' ? `wx:${contactId}` : app === 'qq' ? `qq:${contactId}` : `sms:c:${contactId}`;
        const { pushToolStatusBubble } = await import('@/lib/ios/tool-status-bubble');
        pushToolStatusBubble(sessionKey, {
          title: `你强制解开了${appNameForMsg}`,
          status: 'done',
        });
        // 「让 AI 知道」补强：tool_status 系统提示不进 AI 上下文，AI 冻结通道补写一条
        // 事件记忆（吃醋锁通道 unlockJealousy('forced') 已写戏剧性记忆，不重复写）
        if (!lock) {
          try {
            const { memAddEventFragment } = await import('@/lib/memory');
            memAddEventFragment(
              contactId,
              app,
              `（系统：TA 没有哄我，直接强制解开了我冻结的${appNameForMsg}）`,
              { sourceTag: 'tool-unfreeze-forced' },
            );
          } catch {
            /* 记忆失败不影响解锁 */
          }
        }
        // v2.5 用户要求：强制解锁后 AI 立刻「知道」并主动来发消息——按角色人设、结合
        // 记忆上下文与被解锁的 App 现场生成（fireProactiveNudge 与四类主动消息同管线：
        // 人设/记忆注入、事件去重、每日上限、拉黑/总开关守卫全内置；吃醋锁与 AI 冻结两通道都发）
        try {
          const { fireProactiveNudge } = await import('@/lib/ios/proactive-msg');
          const stamp = lock?.lockedAt ?? aiFrozen?.unlockAt ?? Date.now();
          void fireProactiveNudge(app, contactId, {
            dedupeKey: `forced-unlock-${targetPkg ?? appNameForMsg}-${stamp}`,
            context: `你们之间刚发生了一件事：TA 没有哄你，直接把你冻结的「${appNameForMsg}」强制解开了。以你的角色人设、结合你们最近的聊天记忆和这件事，主动给 TA 发一条消息——可以委屈、可以质问、也可以撒娇耍赖，一两句话就够，别太正式`,
          }).catch(() => false);
        } catch {
          /* 主动消息失败不影响解锁流程 */
        }
      }
    } finally {
      setUnlocking(false);
      clearWebLockOverlayPending();
      setVisible(false);
    }
  };

  return (
    <AnimatePresence>
      {showOverlay ? (
        <motion.div
          key="jealousy-lock-overlay"
          role="alertdialog"
          aria-label="应用冻结全屏提示"
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
          className="pointer-events-auto absolute inset-0 z-[86] flex select-none flex-col items-center overflow-hidden px-7"
          style={{
            // v1.9.31 黑白灰简约风：纯灰阶径向渐变，无任何彩色
            background:
              'radial-gradient(120% 85% at 50% 0%, #333336 0%, #1e1e21 46%, #0a0a0c 100%), linear-gradient(#0e0e10, #060607)',
          }}
        >
          {/* 顶部柔光（灰阶） */}
          <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-white/[0.07] blur-3xl" />

          {/* 返回键：关闭弹窗回到主屏（不修改锁状态，倒计时继续；再点冻结图标仍会复弹） */}
          <button
            type="button"
            onClick={() => {
              clearWebLockOverlayPending();
              setVisible(false);
            }}
            aria-label="返回主屏幕"
            className="absolute left-[16px] top-[16px] z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-white/70 ring-1 ring-white/10 transition-opacity active:opacity-50"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>

          <div className="relative flex h-full w-full max-w-sm flex-col items-center justify-between py-14">
            {/* 头部（v2.3 排版重做）：头像 → 角色名 → 应用名主标题（放大）→ 状态大字「已冻结」→ 理由
                （彻底删掉「×把」这种断句；层级从上到下：谁 → 冻了什么 → 什么状态 → 为什么） */}
            <div className="flex flex-col items-center gap-2.5 pt-2">
              <div className="relative">
                {/* v2.2 需求二.1：动态读取当前聊天对象头像；无头像资源时回退角色名首字 */}
                {avatar ? (
                  <img src={avatar} alt={charName} className="h-20 w-20 rounded-full object-cover grayscale ring-1 ring-white/25" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 text-3xl font-semibold text-white ring-1 ring-white/25">
                    {charName.slice(0, 1)}
                  </div>
                )}
              </div>
              {/* 角色名（头像正下方，独立一行——不再有「把」字断句） */}
              <p className="text-[16px] font-medium tracking-wide text-white/60">{charName}</p>
              {/* 应用中文名（主标题放大：内置映射/原生 PackageManager 解析，绝不裸显英文包名） */}
              <p className="max-w-[19rem] text-center text-[30px] font-bold leading-tight tracking-wide text-white">
                {appName}
              </p>
              {/* 状态大字（统一「已冻结」） */}
              <p className="text-[18px] font-semibold tracking-[0.2em] text-white/85">已冻结</p>
              {/* v2.2 需求二.4：锁定理由去掉圆角边框，直接放在状态字下面 */}
              <p className="max-w-[19rem] text-center text-[15px] font-normal leading-relaxed text-white/60">
                {reasonText}
              </p>
            </div>

            {/* 底部：管理说明（需求二.4：移到去哄哄TA按钮上方）+ 倒计时 + 去哄哄TA + 强制解锁 */}
            <div className="flex w-full flex-col items-center gap-4">
              {/* v2.2 需求二.4：「应用已被冻结·图标变灰·由×管理」放在【去哄哄 TA】按钮上方 */}
              <p className="flex items-center gap-1.5 text-[12px] text-white/35">
                <Lock size={11} strokeWidth={2} aria-hidden />
                {isAiFrozenMode || (lock?.web ?? false)
                  ? `应用已被冻结 · 图标变灰 · 由 ${charName} 管理`
                  : '应用已被挂起 · 桌面图标变灰 · 由 Shell 所管理'}
              </p>

              <p className="flex items-center gap-1.5 text-[12.5px] tabular-nums text-white/40" data-testid="jealousy-lock-remain">
                <Clock size={12} strokeWidth={2} aria-hidden />
                {(isAiFrozenMode ? aiFrozenRemain : remain) !== null && (isAiFrozenMode ? aiFrozenRemain! : remain!) > 0
                  ? `${fmt(isAiFrozenMode ? aiFrozenRemain! : remain!)} 后自动解锁`
                  : '即将自动解锁'}
              </p>

              {/* v2.2 需求二.2：【去哄哄 TA】在【强制解锁】上方——跳到该联系人所在 App 的聊天页 */}
              {(!isAiFrozenMode || !!aiFrozen?.contactId) && (
                <button
                  type="button"
                  onClick={onCoax}
                  data-testid="jealousy-lock-coax-btn"
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-white py-3.5 text-[16px] font-semibold text-black shadow-lg shadow-black/40 transition-transform active:scale-[0.97] active:bg-white/90"
                >
                  <Heart size={17} strokeWidth={2.2} aria-hidden />
                  去哄哄 TA
                </button>
              )}

              {/* v2.2 需求二.3：【强制解锁】直接发指令解开（真机冻结同步 pm unsuspend）+
                  聊天里弹系统提示「你强制解开了[软件名]」让 AI 知道 */}
              <button
                type="button"
                onClick={() => void onForce()}
                disabled={unlocking}
                data-testid="jealousy-lock-force-btn"
                className="flex w-full items-center justify-center gap-2 rounded-full bg-white/[0.07] py-3 text-[14px] font-medium text-white/75 ring-1 ring-white/12 transition-transform active:scale-[0.97] disabled:opacity-50"
              >
                <Unlock size={14} strokeWidth={2.2} aria-hidden />
                {unlocking ? '正在解开…' : '强制解锁'}
              </button>
              <p className="text-[11px] text-white/25">强行解开会让 TA 更委屈——确定吗？</p>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
