'use client';

/**
 * 通知权限友好申请卡（首次使用时展示，PhoneShell 挂载，全局可达）：
 *
 * 需求：首次使用时「友好申请」通知权限 —— 不直接弹浏览器授权框（无说明、无用户手势，
 * 容易被浏览器拦截或被用户误拒），先在应用内展示说明卡：
 * - 「开启通知」：在用户手势内调用 Notification.requestPermission()（浏览器正常弹授权框），
 *   授权成功顺带完成 Web Push 订阅（关页后服务端接力回复也能推系统通知）；
 * - 「暂不」：记录 localStorage，本浏览器不再主动弹（设置 › 通知页随时可开），应用内灵动岛弹窗不受影响；
 * - 15 秒无操作自动收起（同一会话只弹这一次，webPermAsked 已挡重复触发）。
 *
 * 触发：第一条 AI 消息投递且权限为 default（island-notify.maybeWebNotification）。
 * 层级 z-[92]：低于灵动岛通知卡（93），高于锁屏（65）/闹钟（90）—— 锁屏时也能看到并操作。
 */

import { useEffect, useRef, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import {
  dismissNotifyPrompt,
  requestNotifyPermission,
  useNotifyPrompt,
} from '@/lib/ios/island-notify';

/** 无操作自动收起时长 */
const AUTO_HIDE_MS = 15_000;

export default function NotifyPermissionCard() {
  const open = useNotifyPrompt((s) => s.open);
  const hide = useNotifyPrompt((s) => s.hide);
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<'granted' | 'denied' | null>(null);
  const askingRef = useRef(false);
  // ref 更新入 effect（react-hooks/refs：不在渲染期写 ref）
  useEffect(() => {
    askingRef.current = asking;
  });

  // 无操作 15s 自动收起（与「暂不」同口径：写入不再弹标记，避免每次刷新后的第一条消息都弹=骚扰）
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (!askingRef.current) void dismissNotifyPrompt();
    }, AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const accept = async (): Promise<void> => {
    setAsking(true);
    try {
      const p = await requestNotifyPermission();
      setResult(p === 'granted' ? 'granted' : 'denied');
    } catch {
      setResult('denied');
    }
    setAsking(false);
    // 授权结果短暂展示后收起（拒绝也不打断聊天：应用内灵动岛弹窗照常）
    setTimeout(() => {
      setResult(null);
      hide();
    }, 1600);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[56px] z-[92] flex justify-center px-4">
      <div
        role="dialog"
        aria-label="开启系统通知"
        className="pointer-events-auto w-full max-w-[330px] rounded-[18px] border border-border/70 bg-card/95 p-3.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] backdrop-blur-xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/10">
            <BellRing className="h-[18px] w-[18px]" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-semibold leading-5">开启系统通知</span>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => void dismissNotifyPrompt()}
                className="ml-auto -mr-1 -mt-1 rounded-full p-1.5 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            {result === null ? (
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                切走标签页、最小化或锁屏时，也能及时收到 AI 的新消息；随时可在「设置 › 通知」更改。
              </p>
            ) : (
              <p className={`mt-0.5 text-[12px] leading-relaxed ${result === 'granted' ? 'text-foreground' : 'text-muted-foreground'}`}>
                {result === 'granted' ? '已开启：离开网页也能收到通知了。' : '未开启：将在应用内弹窗提醒，不影响聊天。'}
              </p>
            )}
          </div>
        </div>
        {result === null && (
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void dismissNotifyPrompt()}
              className="h-8 rounded-full px-3.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted"
            >
              暂不
            </button>
            <button
              type="button"
              onClick={() => void accept()}
              disabled={asking}
              className="h-8 rounded-full bg-foreground px-4 text-[13px] font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {asking ? '正在开启…' : '开启通知'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
