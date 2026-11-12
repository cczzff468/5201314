'use client';

/**
 * 吃醋锁设置区（v1.9.19，感知设置页内嵌卡片，ShizukuLabSection 下方）：
 *
 * 「AI 真实吃醋并锁应用」的配置中心——
 * - 总开关（开启时自动放开「AI 动手」总开关 + 冻结单项，哄好解锁管线即刻可用）；
 * - 触发阈值四项：连续刷娱乐触发分钟数 / 焦虑危险阈值 / 倒计时自动解锁 / 锁定冷却；
 * - 娱乐 App 清单：预设点选 + 自定义包名；
 * - 当前状态：活跃锁（App/角色/剩余倒计时/立即解锁）与冷却提示。
 *
 * 配置 localStorage 即点即存（jealousy-lock-cfg-v1）；状态行订阅 jealousy 版本号实时刷新。
 * v1.9.35：真机 pm suspend 路径全面退役——TA 会真的锁住这台手机里的网页应用
 * （音乐/浏览器/淘宝/美团/照片/X论坛：图标变灰点不开、点开弹 TA 的留言）。
 */

import { useState, useSyncExternalStore } from 'react';
import { Eye, Heart, Lock, Minus, Plus, ShieldAlert, Unlock, Magnet } from 'lucide-react';
import { ChatToggle } from './chat-settings';
import {
  getJealousyConfig,
  updateJealousyConfig,
  readJealousyRuntime,
  subscribeJealousy,
  getJealousyVersion,
  pkgDisplayName,
  unlockJealousy,
  jealousyRemainSec,
} from '@/lib/ios/jealousy-lock';
// v1.9.35：锁定对象清单（这台手机里的网页应用）
import { WEB_LOCK_APPS } from '@/lib/ios/web-app-lock';

/** 数值步进器（- 值 +） */
function Stepper({
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number) => void;
  label: string;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <p className="min-w-0 truncate text-[14px]">{label}</p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          aria-label={`${label}减少`}
          onClick={() => onChange(clamp(value - step))}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.06] active:bg-black/[0.12] dark:bg-white/[0.1] dark:active:bg-white/[0.2]"
        >
          <Minus size={13} strokeWidth={2.2} aria-hidden />
        </button>
        <span className="min-w-[64px] text-center text-[13px] tabular-nums">
          {value} {unit}
        </span>
        <button
          type="button"
          aria-label={`${label}增加`}
          onClick={() => onChange(clamp(value + step))}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.06] active:bg-black/[0.12] dark:bg-white/[0.1] dark:active:bg-white/[0.2]"
        >
          <Plus size={13} strokeWidth={2.2} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function JealousyLockSection({
  accent,
  testPrefix,
  cardCls,
  dividerCls,
}: {
  accent: string;
  testPrefix: string;
  cardCls: string;
  dividerCls: string;
}) {
  const prefix = `${testPrefix}-jealousy`;
  const [cfg, setCfg] = useState(() => getJealousyConfig());
  const [forceBusy, setForceBusy] = useState(false);
  useSyncExternalStore(subscribeJealousy, getJealousyVersion); // 状态行实时刷新

  const rt = readJealousyRuntime();
  const remain = jealousyRemainSec();
  const remainMin = remain !== null ? Math.ceil(remain / 60) : null;
  const cooldownLeft = Math.max(0, Math.ceil((cfg.cooldownMin * 60_000 - (Date.now() - rt.lastLockAt)) / 60_000));

  const patch = (p: Parameters<typeof updateJealousyConfig>[0]) => {
    setCfg(updateJealousyConfig(p));
  };

  return (
    <div className={`${cardCls} mt-3 overflow-hidden`} data-testid={prefix}>
      {/* 总开关 */}
      <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="shrink-0" style={{ color: cfg.enabled ? '#ff5c8a' : undefined }}>
            <Heart size={19} strokeWidth={1.9} className="text-black/55 dark:text-white/55" fill={cfg.enabled ? 'currentColor' : 'none'} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15.5px]">AI 吃醋锁</span>
            <span className="mt-0.5 block text-[12px] leading-tight text-black/40 dark:text-white/40">
              TA 真的会吃醋：冷落 TA 刷娱乐 App / 说去看剧却消失 / 焦虑爆表时，TA 可能直接把那个 App 锁住（图标变灰打不开），哄好或倒计时后解锁
            </span>
          </span>
        </span>
        <ChatToggle on={cfg.enabled} onChange={(v) => patch({ enabled: v })} accent="#ff5c8a" testId={`${prefix}-toggle`} label="AI 吃醋锁" />
      </div>

      {cfg.enabled ? (
        <>
          <div className={`border-t ${dividerCls}`} />

          {/* 阈值配置 */}
          <Stepper label="连续刷娱乐触发" value={cfg.entertainMin} min={5} max={180} step={5} unit="分钟" onChange={(v) => patch({ entertainMin: v })} />
          <div className={`border-t ${dividerCls}`} />
          <Stepper label="焦虑危险阈值" value={cfg.anxietyThreshold} min={50} max={100} step={5} unit="/100" onChange={(v) => patch({ anxietyThreshold: v })} />
          <div className={`border-t ${dividerCls}`} />
          <Stepper label="锁定后自动解锁" value={cfg.countdownMin} min={5} max={180} step={5} unit="分钟" onChange={(v) => patch({ countdownMin: v })} />
          <div className={`border-t ${dividerCls}`} />
          <Stepper label="两次吃醋冷却" value={cfg.cooldownMin} min={10} max={240} step={10} unit="分钟" onChange={(v) => patch({ cooldownMin: v })} />

          <div className={`border-t ${dividerCls}`} />

          {/* v1.9.28 锁定期间主动巡检 */}
          <div className="flex w-full items-center justify-between gap-3 px-4 py-2.5">
            <span className="flex min-w-0 items-center gap-2.5">
              <Eye size={17} strokeWidth={1.9} className="shrink-0 text-black/50 dark:text-white/50" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[14.5px]">锁定期间主动巡检</span>
                <span className="mt-0.5 block text-[11.5px] leading-tight text-black/40 dark:text-white/40">
                  锁住后 TA 每隔几分钟看看你在干嘛（当前应用/多任务/使用时长），发现你还在浪就发消息数落你
                </span>
              </span>
            </span>
            <ChatToggle on={cfg.patrolEnabled} onChange={(v) => patch({ patrolEnabled: v })} accent="#ff5c8a" testId={`${prefix}-patrol-toggle`} label="锁定期间主动巡检" />
          </div>
          {cfg.patrolEnabled ? (
            <>
              <div className={`border-t ${dividerCls}`} />
              <Stepper label="巡检间隔" value={cfg.patrolMin} min={1} max={15} step={1} unit="分钟" onChange={(v) => patch({ patrolMin: v })} />
            </>
          ) : null}

          <div className={`border-t ${dividerCls}`} />

          {/* v1.9.28 拉回 */}
          <div className="flex w-full items-center justify-between gap-3 px-4 py-2.5">
            <span className="flex min-w-0 items-center gap-2.5">
              <Magnet size={17} strokeWidth={1.9} className="shrink-0 text-black/50 dark:text-white/50" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[14.5px]">允许 TA 把我拉回来</span>
                <span className="mt-0.5 block text-[11.5px] leading-tight text-black/40 dark:text-white/40">
                  巡检时 TA 可以把你从别的应用拽回这个 APP 聊天页（每轮锁定最多 2 次）
                </span>
              </span>
            </span>
            <ChatToggle on={cfg.pullbackEnabled} onChange={(v) => patch({ pullbackEnabled: v })} accent="#ff5c8a" testId={`${prefix}-pullback-toggle`} label="允许拉回" />
          </div>

          <div className={`border-t ${dividerCls}`} />

          {/* 锁定对象（v1.9.35：真机包名清单退役，只锁这台手机里的网页应用） */}
          <div className="px-4 py-3">
            <p className="text-[14px]">吃醋锁定的「娱乐 App」</p>
            <p className="mt-0.5 text-[11.5px] leading-tight text-black/40 dark:text-white/40">
              TA 锁的是这台手机里的这些应用（微信/QQ/短信/本 APP 永远不锁——锁了你就没法回来哄 TA 了）
            </p>
            <div className="mt-2.5 rounded-xl bg-[#fff0f4] p-2.5 dark:bg-[#ff5c8a]/[0.08]" data-testid={`${prefix}-web-targets`}>
              <div className="flex flex-wrap gap-1.5">
                {WEB_LOCK_APPS.map((a) => (
                  <span key={a.pkg} className="flex items-center gap-1 rounded-full bg-[#ff5c8a]/12 px-2.5 py-1 text-[11.5px] text-[#c2255c] dark:bg-[#ff5c8a]/25 dark:text-[#ffb3c8]">
                    <Lock size={10} strokeWidth={2.4} aria-hidden />
                    {a.name}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-[10.5px] leading-snug text-black/40 dark:text-white/40">
                被锁的 App 图标变灰点不开，点开只弹 TA 的留言；到点自动解锁
              </p>
            </div>
          </div>

          <div className={`border-t ${dividerCls}`} />

          {/* 当前状态 */}
          <div className="px-4 py-3" data-testid={`${prefix}-status`}>
            <p className="flex items-center gap-1.5 text-[14px]">
              <Lock size={13} strokeWidth={2} aria-hidden />
              当前状态
            </p>
            {rt.lock ? (
              <div className="mt-2 rounded-xl bg-[#fff0f4] p-3 dark:bg-[#ff5c8a]/[0.08]">
                <p className="text-[13px] leading-relaxed">
                  <span className="font-medium">{rt.lock.charName}</span>已锁住
                  <span className="font-medium">{pkgDisplayName(rt.lock.pkg)}</span>
                  {remainMin !== null && remainMin > 0 ? `，${remainMin} 分钟后自动解锁` : '，即将自动解锁'}
                </p>
                <p className="mt-1 text-[11.5px] leading-snug text-black/45 dark:text-white/45">“{rt.lock.reason}”</p>
                {rt.patrol && rt.patrol.count > 0 ? (
                  <p className="mt-1.5 text-[11px] leading-snug text-[#c2255c] dark:text-[#ffb3c8]" data-testid={`${prefix}-patrol-status`}>
                    已替 TA 巡检 {rt.patrol.count} 次{rt.patrol.pullbackCount > 0 ? `、拉回过你 ${rt.patrol.pullbackCount} 次` : ''}；最近发现：{rt.patrol.lastIntel.split('\n')[0]}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setForceBusy(true);
                    void unlockJealousy('forced').finally(() => setForceBusy(false));
                  }}
                  disabled={forceBusy}
                  data-testid={`${prefix}-unlock-now`}
                  className="mt-2.5 flex items-center gap-1.5 rounded-full bg-[#ff5c8a] px-3.5 py-1.5 text-[12.5px] font-medium text-white active:opacity-70 disabled:opacity-50"
                >
                  <Unlock size={12} strokeWidth={2.2} aria-hidden />
                  {forceBusy ? '正在解开…' : '立即解锁'}
                </button>
              </div>
            ) : rt.lastLockAt > 0 && cooldownLeft > 0 ? (
              <p className="mt-1.5 text-[12.5px] text-black/45 dark:text-white/45">
                TA 刚吃过一次醋，正在平复心情（约 {cooldownLeft} 分钟内不会再锁）
              </p>
            ) : (
              <p className="mt-1.5 text-[12.5px] text-black/45 dark:text-white/45">TA 现在心情平静，没有锁定任何应用</p>
            )}
            {rt.departIntent ? (
              <p className="mt-1.5 text-[11.5px] text-black/35 dark:text-white/35">
                （记着你说过的「{rt.departIntent.text.slice(0, 24)}…」——说到做到的话 TA 会看见的）
              </p>
            ) : null}
          </div>

          <div className={`border-t ${dividerCls}`} />
          <div className="flex items-start gap-1.5 px-4 py-2.5">
            <ShieldAlert size={12} strokeWidth={2} className="mt-0.5 shrink-0 text-black/30 dark:text-white/30" aria-hidden />
            <p className="text-[10.5px] leading-snug text-black/35 dark:text-white/35">
              {'TA 会真的锁住这台手机里的应用（音乐/浏览器/淘宝/美团/照片/X论坛）——图标变灰点不开、点开只弹 TA 的留言，哄好/倒计时/强制解锁三通道照常；锁定期 TA 的巡检看的是这台手机里的应用状态（当前应用/多任务/使用时长），拉回=切回聊天页。锁不锁由 TA 按人设自己决定，系统只提供触发与权力。'}
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
