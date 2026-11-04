'use client';

/**
 * 全局提醒监听（PhoneShell 挂载，仿 clock.tsx 的 AlarmWatcher）：
 * 每 10s 轮询 IndexedDB 的提醒事项（reminders）与日历事件（events），到期即
 * ① 顶部横幅（iOS 通知样式，z-93 与灵动岛通知同层，App 未打开/锁屏时也显示）；
 * ② 页面切走时发系统级 Web Notification（权限 granted 且设置 › 通知「允许通知」开启时）；
 * ③ 短促提示音 + 一次震动（不做持续响铃，最小闭环）。
 *
 * 触发口径（存储字段见 src/lib/ios/db.ts）：
 * - 提醒事项：completed=true 不触发；dueDate+dueTime 按其时刻；仅日期按当天 09:00；仅时间按今天该时刻；
 * - 日历事件：按 date+startTime 触发一次；全天事件（startTime=''）按当天 09:00；无重复字段，均单次；
 * - 防重复：已触发键（id+到期分钟）记 localStorage kv（ios-reminder-fired），刷新/重挂载不重复响；
 * - 过期超 2 分钟的陈旧到期不再补弹（隔天打开网页不轰炸）；熄屏期间不触发不标记，唤醒后下一轮补弹。
 *
 * 说明：灵动岛通知卡（IslandNotification）的视觉与点击跳转均为聊天 App 专用
 * （app 字段限定 wechat/qq/chat，点击经 activateCurrentNotification 固定跳聊天），
 * 提醒事项/日历套用会显示错误 App 图标且点击误入聊天，故本组件自带同层级的
 * iOS 风格顶部横幅（tap 仅收起，不做点击跳转——与最小闭环范围一致）。
 */

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell } from 'lucide-react';
import { localDB, type CalendarEventRecord, type ReminderRecord } from '@/lib/ios/db';
import { isSysNotifyEnabled } from '@/lib/ios/island-notify';
import { selectResolvedTheme, useSettings, useSystemDark, useUI } from '@/lib/ios/store';

// ---------------- 常量 ----------------

/** 轮询间隔（与 AlarmWatcher 同量级；后台标签页被浏览器节流至 1/min 仍在宽限内） */
const POLL_MS = 10_000;
/** 到期宽限：超过该时长的陈旧到期不再补弹（如隔天打开网页） */
const GRACE_MS = 2 * 60_000;
/** 仅日期（无时间）的提醒 / 全天事件的默认提醒时刻 */
const DEFAULT_FIRE_TIME = '09:00';
/** 横幅停留时长（页面不可见/熄屏时冻结，回来自动续期） */
const BANNER_MS = 4500;
/** 横幅队列上限（超出丢最旧，防刷屏） */
const MAX_QUEUE = 4;
/** 已触发标记的 localStorage kv 键 + 保留时长（滚动清理） */
const FIRED_KEY = 'ios-reminder-fired';
const FIRED_TTL_MS = 24 * 60 * 60 * 1000;

/** 一条到期提醒的展示数据 */
interface DueNotice {
  /** 防重键（同时用作 Web Notification tag） */
  key: string;
  /** 横幅首行来源：提醒事项 / 日历 */
  title: string;
  /** 内容（标题 + 可选备注） */
  body: string;
  /** 到期时刻 HH:mm */
  time: string;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

// ---------------- 到期时刻计算（显式 Date 构造，规避 Safari 对 'YYYY-MM-DD HH:mm' 的解析缺陷） ----------------

function parseDue(dateStr: string, timeStr: string): number | null {
  const [y, mo, d] = dateStr.split('-').map((v) => parseInt(v, 10));
  const [h, mi] = timeStr.split(':').map((v) => parseInt(v, 10));
  if ([y, mo, d, h, mi].some((v) => !Number.isFinite(v))) return null;
  const due = new Date(y, mo - 1, d, h, mi).getTime();
  return Number.isFinite(due) ? due : null;
}

/** 提醒事项到期时刻；null = 无到期时间/已完成 */
function reminderDueMs(r: ReminderRecord): number | null {
  if (r.completed) return null;
  if (r.dueDate) return parseDue(r.dueDate, r.dueTime || DEFAULT_FIRE_TIME);
  if (r.dueTime) {
    // 仅时间（无日期）：与提醒事项 App 列表口径一致，视为今天
    const n = new Date();
    return parseDue(`${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`, r.dueTime);
  }
  return null;
}

/** 日历事件到期时刻（开始时间；全天事件按 09:00）；null = 无日期 */
function eventDueMs(ev: CalendarEventRecord): number | null {
  if (!ev.date) return null;
  return parseDue(ev.date, ev.startTime || DEFAULT_FIRE_TIME);
}

// ---------------- 已触发标记（内存 Map 缓存 + localStorage kv 持久化，刷新不重响） ----------------

let firedCache: Map<string, number> | null = null;

function firedMap(): Map<string, number> {
  if (firedCache) return firedCache;
  const m = new Map<string, number>();
  try {
    const raw = window.localStorage.getItem(FIRED_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'number') m.set(k, v);
      }
    }
  } catch {
    /* 无标记/解析失败视为空 */
  }
  firedCache = m;
  return m;
}

function markFired(key: string): void {
  const m = firedMap();
  const now = Date.now();
  m.set(key, now);
  for (const [k, at] of m) {
    if (now - at > FIRED_TTL_MS) m.delete(k);
  }
  try {
    const obj: Record<string, number> = {};
    for (const [k, at] of m) obj[k] = at;
    window.localStorage.setItem(FIRED_KEY, JSON.stringify(obj));
  } catch {
    /* 存储不可用：本次会话内存防重仍生效 */
  }
}

// ---------------- 提示音（一次性双音短促 beep，与闹钟的持续响铃区分） ----------------

function playChime(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    void ctx.resume().catch(() => undefined);
    const t0 = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.connect(gain);
    // 两声上扬短音：880Hz → 1180Hz
    osc.frequency.setValueAtTime(880, t0);
    gain.gain.exponentialRampToValueAtTime(0.07, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    osc.frequency.setValueAtTime(1180, t0 + 0.22);
    gain.gain.exponentialRampToValueAtTime(0.07, t0 + 0.24);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
    osc.start(t0);
    osc.stop(t0 + 0.45);
    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 900);
  } catch {
    /* 音频不可用时静默 */
  }
  try {
    navigator.vibrate?.([120, 90, 120]);
  } catch {
    /* 震动不可用时静默 */
  }
}

// ---------------- 系统级 Web Notification（页面切走时兜底；总闸与 island-notify 同口径） ----------------

function postWebNotification(n: DueNotice): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (!isSysNotifyEnabled()) return; // 设置 › 通知「允许通知」总闸（只影响系统级通道，同 island-notify）
  try {
    if (Notification.permission !== 'granted') return;
    // 页面可见时应用内横幅足够，不重复打扰；只有用户切走标签页才发系统通知
    if (document.visibilityState !== 'hidden') return;
    const notif = new Notification(n.title, { body: `${n.time} ${n.body}`, tag: n.key });
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
  } catch {
    /* 构造失败（旧浏览器限制）静默降级为应用内横幅 */
  }
}

// ---------------- 组件 ----------------

/** 全局提醒事项/日历到期监听：PhoneShell 挂载，App 不打开也生效 */
export default function ReminderWatcher() {
  const [queue, setQueue] = useState<DueNotice[]>([]);
  const current = queue[0] ?? null;
  const screenOff = useUI((s) => s.screenOff);
  // 跟随手机主题（横幅配色与灵动岛通知卡一致：浅色磨砂/深色纯黑）
  const themeMode = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const dark = selectResolvedTheme(themeMode, systemDark) === 'dark';
  const [pageHidden, setPageHidden] = useState(false);

  useEffect(() => {
    const onVis = (): void => setPageHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // 轮询： reminders + events 两表各 getAll 一次（数据量小，10s 一次开销可忽略）
  useEffect(() => {
    // 熄屏时不触发也不标记：唤醒后下一轮补弹（横幅不会被黑遮罩吃掉）
    const check = async (): Promise<void> => {
      if (useUI.getState().screenOff) return;
      const now = Date.now();
      const notices: DueNotice[] = [];
      try {
        for (const r of await localDB.getAll('reminders')) {
          const due = reminderDueMs(r);
          if (due === null || due > now || now - due > GRACE_MS) continue;
          const key = `rw:r:${r.id}:${Math.floor(due / 60000)}`;
          if (firedMap().has(key)) continue;
          const notes = r.notes.trim();
          notices.push({
            key,
            title: '提醒事项',
            body: notes ? `${r.title}：${notes}` : r.title,
            time: `${pad2(new Date(due).getHours())}:${pad2(new Date(due).getMinutes())}`,
          });
          // #57：先入队 notices 再标记 fired——若 markFired 抛错（quota 等），
          // 通知已入数组，下一轮 setQueue 仍会展示；不会出现「已标记 fired 但横幅未弹」的永久丢失。
          markFired(key);
        }
        for (const ev of await localDB.getAll('events')) {
          const due = eventDueMs(ev);
          if (due === null || due > now || now - due > GRACE_MS) continue;
          const key = `rw:e:${ev.id}:${Math.floor(due / 60000)}`;
          if (firedMap().has(key)) continue;
          const note = ev.note.trim();
          notices.push({
            key,
            title: '日历',
            body: note ? `${ev.title}：${note}` : ev.title,
            time: `${pad2(new Date(due).getHours())}:${pad2(new Date(due).getMinutes())}`,
          });
          markFired(key); // 同 #57：先 push 再 markFired
        }
      } catch {
        return; // IndexedDB 不可用时静默（与 AlarmWatcher 一致）
      }
      for (const n of notices) {
        setQueue((q) => (q.length >= MAX_QUEUE ? [...q.slice(1), n] : [...q, n]));
        playChime();
        postWebNotification(n);
      }
    };

    void check();
    const iv = window.setInterval(() => void check(), POLL_MS);
    return () => window.clearInterval(iv);
  }, []);

  // 横幅自动收起（页面不可见/熄屏时冻结，回来续期——与灵动岛通知同一策略）
  useEffect(() => {
    if (!current) return;
    if (pageHidden || screenOff) return;
    const t = window.setTimeout(() => setQueue((q) => q.slice(1)), BANNER_MS);
    return () => window.clearTimeout(t);
  }, [current, pageHidden, screenOff]);

  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.key}
          initial={{ opacity: 0, y: -16, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95, transition: { duration: 0.18, ease: 'easeIn' } }}
          transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.9 }}
          className="pointer-events-none absolute inset-x-0 top-[11px] z-[92] flex justify-center px-2"
        >
          <button
            type="button"
            onClick={dismiss}
            aria-label={`${current.title}提醒：${current.body}，点击收起`}
            className="pointer-events-auto flex w-[336px] max-w-full items-center gap-2.5 rounded-[24px] px-3 py-2.5 text-left shadow-[0_12px_32px_-10px_rgba(0,0,0,0.45)] outline-none backdrop-blur-xl"
            style={{ backgroundColor: dark ? '#000000' : 'rgba(246, 246, 248, 0.94)' }}
          >
            <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[#FF9F0A]/15">
              <Bell className="h-5 w-5 text-[#FF9F0A]" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span
                  className={`shrink-0 text-[13px] font-semibold leading-[17px] ${
                    dark ? 'text-white' : 'text-black'
                  }`}
                >
                  {current.title}
                </span>
                <span
                  className={`truncate text-[11px] leading-[17px] tabular-nums ${
                    dark ? 'text-white/50' : 'text-black/45'
                  }`}
                >
                  {current.time}
                </span>
              </span>
              <span
                className={`mt-0.5 line-clamp-2 block text-[12px] leading-[16px] ${
                  dark ? 'text-white/85' : 'text-black/75'
                }`}
              >
                {current.body}
              </span>
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
