'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EyeOff, Plus, UserRound, X } from 'lucide-react';
import {
  accountDisplayName,
  createAccount,
  deleteAccount,
  getAccounts,
  getActiveAccountIdFor,
  MAIN_ACCOUNT_ID,
  switchAccountFor,
  type AccountApp,
  type PhoneAccount,
} from '@/lib/ios/accounts';

/**
 * 匿名号码切换弹层（Task 40-E / v2，电话/信息 App 共享）：
 * - 半屏底部弹层（iOS action-sheet 风）：圆角 18px 顶部 + 毛玻璃卡 + 遮罩点击关闭 + slide-up 动画
 *   （进出场用 rAF 驱动的 transition，与 IOSActionSheet 同一套 260ms iOS 曲线，不用 tailwindcss-animate）。
 * - props.app 决定操作哪个 App 的账号（v2 per-app 账号：电话与信息的当前账号互相独立）。
 * - 列表 = 全部 kind==='anon' 账号（getAccounts() 过滤）：深灰圆头像（EyeOff 面具感）+ 名字 + 号码小字；
 *   当前使用行右侧绿点 + 「当前使用」；点其他行 → switchAccountFor(app, id)
 *   （写标记 + 派发 ios-phone-account-changed 事件，**不刷新网页**，各 App 监听后自行重读数据）。
 * - 「新建匿名号码」行（+ 圆钮）→ createAccount('anon') → switchAccountFor(app, newId)。
 * - 当前账号非大号时列表顶部加「返回主号（机主）」行 → switchAccountFor(app, MAIN_ACCOUNT_ID)。
 * - 深浅色适配：面板用半透明浅灰/深灰 + backdrop-blur（对照 IOSActionSheet 配色），
 *   行/分隔线用 foreground 语义色，跟随 App 内深浅色变量。
 *
 * 用法（渲染在 App 自己的 relative 容器内，绝对定位铺满该 App）：
 *   <AnonSwitchSheet app="phone" open={anonSheetOpen} onClose={() => setAnonSheetOpen(false)} />
 */

/** iOS 弹层曲线（与 IOSActionSheet 一致） */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** 匿名号号码脱敏：11 位号 3+****+4（132****5644，同普通手机号习惯）；旧 10 位号前 2 后 4 —— 拨号键盘徽标与弹层行共用 */
export function maskAnonPhone(phone: string): string {
  if (phone.length >= 11) return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  if (phone.length <= 6) return phone;
  return `${phone.slice(0, 2)}****${phone.slice(-4)}`;
}

interface AnonSheetSnapshot {
  activeId: string;
  anons: PhoneAccount[];
}

function readSnapshot(app: AccountApp): AnonSheetSnapshot {
  return {
    activeId: getActiveAccountIdFor(app),
    anons: getAccounts().filter((a) => a.kind === 'anon'),
  };
}

export function AnonSwitchSheet({
  app,
  open,
  onClose,
}: {
  /** 目标 App（电话 'phone' / 信息 'sms'）：per-app 账号独立切换 */
  app: AccountApp;
  open: boolean;
  onClose: () => void;
}) {
  /** 挂载开关（退场动画期间仍挂载） */
  const [mounted, setMounted] = useState(open);
  /** 进场/退场动画状态 */
  const [shown, setShown] = useState(false);
  /** 注册表现读快照：打开时读一次；切号不刷新网页（事件驱动重读），打开期间重读兜底 */
  const [snap, setSnap] = useState<AnonSheetSnapshot>(() => readSnapshot(app));
  // 长按号码行 → 删除确认（Task 40 修正）：当前使用行删前自动切回主号；其他 App 正在使用的账号删除时也会自动退出该账号
  const [delTarget, setDelTarget] = useState<PhoneAccount | null>(null);
  const [delErr, setDelErr] = useState('');
  // 删除时是否保留数据（规则六：是否保留由用户决定；默认不保留）
  const [delKeepData, setDelKeepData] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const firedRow = useRef<string | null>(null);
  const clearRowPress = useCallback(() => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);
  const startRowPress = useCallback(
    (a: PhoneAccount) => {
      clearRowPress();
      pressTimer.current = window.setTimeout(() => {
        pressTimer.current = null;
        firedRow.current = a.id;
        setDelErr('');
        setDelTarget(a);
      }, 500);
    },
    [clearRowPress],
  );
  useEffect(
    () => () => {
      if (pressTimer.current) window.clearTimeout(pressTimer.current);
    },
    [],
  );

  const confirmDelete = async () => {
    const t = delTarget;
    if (!t) return;
    try {
      // 本 App 正用这个匿名号 → 先切回主号再删（其他 App 若也在用，deleteAccount 自动切回大号退出该账号）；
      // keepData：由用户在确认弹窗里决定是否保留该号码的本地数据（规则六）
      if (getActiveAccountIdFor(app) === t.id) switchAccountFor(app, MAIN_ACCOUNT_ID);
      const res = await deleteAccount(t.id, { keepData: delKeepData });
      setDelKeepData(false);
      if (res.ok) {
        setDelTarget(null);
        setDelErr('');
        setSnap(readSnapshot(app));
      } else {
        setDelErr(res.error || '删除失败');
      }
    } catch {
      setDelErr('删除失败，请稍后重试');
    }
  };

  // open 切换时驱动进/退场动画 + 刷新账号快照（setState 全部在 rAF/timeout 回调内，遵守 React Compiler lint）
  useEffect(() => {
    let raf = 0;
    let inner = 0;
    let timer = 0;
    if (open) {
      raf = requestAnimationFrame(() => {
        // 快照刷新与挂载同帧完成（open 首次置真时兜底重读注册表；setState 在 rAF 回调内，遵守 lint）
        setSnap(readSnapshot(app));
        setMounted(true);
        inner = requestAnimationFrame(() => setShown(true));
      });
    } else {
      raf = requestAnimationFrame(() => {
        setShown(false);
        // 退场动画播完后再真正卸载
        timer = window.setTimeout(() => setMounted(false), 210);
      });
    }
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(inner);
      window.clearTimeout(timer);
    };
  }, [open, app]);

  if (!mounted) return null;

  const { activeId, anons } = snap;

  return (
    <div className="absolute inset-0 z-[70]" role="dialog" aria-label="匿名号码" aria-modal="true">
      {/* 遮罩（点击关闭） */}
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className={`absolute inset-0 cursor-default bg-black/45 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* 半屏面板（slide-up） */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 flex max-h-[76%] flex-col overflow-hidden rounded-t-[18px] bg-[#f6f6f8]/95 shadow-[0_-10px_40px_rgba(0,0,0,0.22)] backdrop-blur-2xl transition-transform duration-[260ms] dark:bg-[#242426]/95 ${
          shown ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ transitionTimingFunction: EASE }}
      >
        {/* 标题栏：左侧关闭 X（同电话 App 主动来电设置弹层），居中标题 */}
        <div className="relative flex h-12 shrink-0 items-center justify-center border-b border-black/[0.06] dark:border-white/[0.08]">
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="absolute left-3 grid h-8 w-8 place-items-center rounded-full text-muted-foreground active:bg-foreground/10"
          >
            <X className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <p className="text-[16px] font-semibold">匿名号码</p>
        </div>
        <p className="shrink-0 px-5 pb-1 pt-3 text-[12.5px] leading-relaxed text-muted-foreground">
          切换后{app === 'phone' ? '拨号' : '短信'}都以匿名身份进行，聊天与记忆完全独立；长按号码可删除
        </p>

        {/* 账号列表（超出可滚动；顶部在非主号身份时多一行「返回主号」） */}
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-2">
          <div className="overflow-hidden rounded-[14px] bg-white/80 ring-1 ring-black/[0.05] dark:bg-white/[0.07] dark:ring-white/[0.08]">
            {/* 返回主号（当前非主号身份时显示在最上） */}
            {activeId !== MAIN_ACCOUNT_ID && (
              <button
                type="button"
                data-testid="anon-back-main"
                onClick={() => {
                  if (switchAccountFor(app, MAIN_ACCOUNT_ID)) onClose();
                }}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors active:bg-black/[0.05] dark:active:bg-white/[0.08]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white">
                  <UserRound className="h-[19px] w-[19px]" strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] leading-tight">返回主号（机主）</span>
                  <span className="mt-0.5 block truncate text-[12.5px] leading-tight text-muted-foreground">
                    回到机主身份，{app === 'phone' ? '通话' : '短信'}数据恢复本号
                  </span>
                </span>
              </button>
            )}

            {/* 匿名号列表（当前行 = 绿点 + 「当前使用」；点其他行切号 → 事件通知重读，不刷新网页） */}
            {anons.map((a, i) => {
              const current = a.id === activeId;
              const separated = activeId !== MAIN_ACCOUNT_ID || i > 0;
              return (
                <button
                  key={a.id}
                  type="button"
                  data-testid={`anon-row-${a.id}`}
                  onClick={() => {
                    // 长按已触发删除确认 → 吞掉本次 click
                    if (firedRow.current === a.id) {
                      firedRow.current = null;
                      return;
                    }
                    if (current) {
                      onClose();
                      return;
                    }
                    if (switchAccountFor(app, a.id)) onClose();
                  }}
                  onPointerDown={() => startRowPress(a)}
                  onPointerUp={clearRowPress}
                  onPointerLeave={clearRowPress}
                  onPointerCancel={clearRowPress}
                  aria-current={current ? 'true' : undefined}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors active:bg-black/[0.05] dark:active:bg-white/[0.08] ${
                    separated ? 'border-t border-black/[0.06] dark:border-white/[0.08]' : ''
                  }`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#3a3a3c] text-white dark:bg-[#57575b]">
                    <EyeOff className="h-[18px] w-[18px]" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] leading-tight">{accountDisplayName(a)}</span>
                    <span className="mt-0.5 block truncate text-[12.5px] leading-tight tabular-nums text-muted-foreground">
                      {maskAnonPhone(a.phone)}
                    </span>
                  </span>
                  {current && (
                    <span className="flex shrink-0 items-center gap-1.5 text-[13px] leading-none text-[#34C759]">
                      <span className="h-2 w-2 rounded-full bg-[#34C759]" aria-hidden="true" />
                      当前使用
                    </span>
                  )}
                </button>
              );
            })}

            {/* 空态提示（还没有任何匿名号时） */}
            {anons.length === 0 && (
              <div className="px-3 py-4 text-center text-[13px] leading-relaxed text-muted-foreground">
                还没有匿名号码
                <br />
                点下方「新建匿名号码」创建一个
              </div>
            )}

            {/* 新建匿名号码（创建后立即切过去 → 事件通知重读，不刷新网页） */}
            <button
              type="button"
              data-testid="anon-create"
              onClick={() => {
                const acc = createAccount('anon');
                if (switchAccountFor(app, acc.id)) onClose();
              }}
              className="flex w-full items-center gap-3 border-t border-black/[0.06] px-3 py-2.5 text-left transition-colors active:bg-black/[0.05] dark:border-white/[0.08] dark:active:bg-white/[0.08]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] text-foreground dark:bg-white/[0.14]">
                <Plus className="h-[20px] w-[20px]" strokeWidth={2.1} />
              </span>
              <span className="min-w-0 flex-1 text-[16px] leading-tight">新建匿名号码</span>
            </button>
          </div>
        </div>
      </div>

      {/* 长按号码行 → 删除确认（iOS 弹窗风；Task 40 修正） */}
      {delTarget && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/40 p-8" onClick={() => setDelTarget(null)}>
          <div
            role="dialog"
            aria-label="删除匿名号码"
            className="w-full max-w-[280px] overflow-hidden rounded-[14px] bg-white/95 text-center backdrop-blur-xl dark:bg-[#2C2C2E]/95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5">
              <p className="text-[16px] font-semibold">删除匿名号码</p>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-muted-foreground">
                将删除「{accountDisplayName(delTarget)} {maskAnonPhone(delTarget.phone)}」：该号码的
                {app === 'phone' ? '通话记录' : '短信与聊天记录'}等本地数据会一并清除；正在使用它的微信 / QQ 等会自动退出该账号。此操作不可恢复。
              </p>
              {delErr && (
                <p data-testid="anon-delete-error" className="mt-2 text-[12.5px] leading-relaxed text-[#FF3B30]">
                  {delErr}
                </p>
              )}
              <label
                data-testid="anon-delete-keep"
                className="mt-2.5 flex cursor-pointer items-start gap-2 rounded-[8px] bg-black/[0.04] px-2.5 py-2 text-left dark:bg-white/[0.08]"
              >
                <input
                  type="checkbox"
                  checked={delKeepData}
                  onChange={(e) => setDelKeepData(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#FF3B30]"
                />
                <span className="text-[12px] leading-[1.5] text-muted-foreground">保留该号码的数据（数据不可见也无法恢复登录）</span>
              </label>
            </div>
            <div className="mt-4 flex border-t border-black/10 dark:border-white/10">
              <button
                type="button"
                data-testid="anon-sheet-delete-cancel"
                onClick={() => setDelTarget(null)}
                className="h-11 flex-1 border-r border-black/10 text-[15px] active:bg-black/5 dark:border-white/10 dark:active:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="anon-sheet-delete-confirm"
                onClick={() => void confirmDelete()}
                className="h-11 flex-1 text-[15px] font-semibold text-[#FF3B30] active:bg-black/5 dark:active:bg-white/10"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
