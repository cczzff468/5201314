'use client';

/**
 * 感知设置页（聊天设置二级页，微信/QQ/信息三端共用）—— v1.9.35 按机主重构令精简：
 *
 * 真机感知（APP 原生 UsageStats / ActivityWatch / Shizuku 能力实验室）整卡下线
 * （机主决定放弃对真实手机的操控与感知，智能体工作流全面转入 Web 网页生态）。
 * 保留的感知开关组（按会话独立，@/lib/perception localStorage 持久化，默认全关）：
 *  - 基础感知：打字思考耗时 / 设备电量 / 日历·节假日（农历+倒计时）
 *  - 天气感知：我的所在地 + TA 的所在地（角色所在地的天气让 TA 能说「我这边下雨了」）
 *  - 看屏幕（VLM）：串流地址（桌面串流工具）或浏览器屏幕分享 → 发送时抓帧识图
 *
 * 交互细节：开关即点即存（下一次发送现场读取，无需重启）；地址/位置输入失焦保存；
 * 屏幕分享需在用户手势中授权（持续流，跨页保持）。
 */

import { useState } from 'react';
import {
  BatteryCharging,
  CalendarDays,
  ChevronLeft,
  CloudSun,
  Keyboard,
} from 'lucide-react';
import { ChatToggle } from './chat-settings';
import { useChatSkin } from '@/lib/ios/chat-skin';
import { LocalToast, useLocalToast } from './page-toast';
import {
  getPerception,
  setPerception,
  prewarmPerception,
  type PerceptionConfig,
} from '@/lib/perception';
import { JealousyLockSection } from './jealousy-lock-settings';

/** 开关行（图标 + 名称 + 说明 + 开关） */
function ToggleRow({
  icon,
  title,
  desc,
  on,
  onChange,
  accent,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  on: boolean;
  onChange: (v: boolean) => void;
  accent: string;
  testId: string;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
      <span className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className="shrink-0 text-black/55 dark:text-white/55">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15.5px]">{title}</span>
          {desc ? <span className="mt-0.5 block text-[12px] leading-tight text-black/40 dark:text-white/40">{desc}</span> : null}
        </span>
      </span>
      <ChatToggle on={on} onChange={onChange} accent={accent} testId={testId} label={title} />
    </div>
  );
}

/** 设置行左侧小图标 */
const I = { size: 19, strokeWidth: 1.9 } as const;

export function PerceptionSettingsPage({
  variant,
  sessionKey,
  peerName,
  onBack,
}: {
  variant: 'wx' | 'qq' | 'sms';
  /** 会话键（wx:<id> / qq:<id> / sms:<storageKey>；感知配置按它隔离） */
  sessionKey: string;
  /** 角色名（天气区「TA 的所在地」标签展示用；可空） */
  peerName?: string;
  onBack: () => void;
}) {
  const wx = variant === 'wx';

  // 主题 token（与 ChatSettingsPage / ProactiveMsgPage 一致）
  const skin = useChatSkin();
  const pageCls = skin.retro
    ? 'rt-root text-black dark:text-white'
    : skin.liquid
      ? 'lg-root text-black dark:text-white'
      : wx
        ? 'bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white'
        : 'bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white';
  const barCls = skin.retro ? 'rt-bar' : '';
  const cardCls = skin.retro
    ? 'rounded-[6px] bg-white dark:bg-[#1A1A1A]'
    : wx
      ? 'rounded-[10px] bg-white dark:bg-[#1A1A1A]'
      : 'rounded-[14px] bg-white dark:bg-[#232529]';
  const dividerCls = wx ? 'border-black/5 dark:border-white/10' : 'border-black/[0.04] dark:border-white/[0.06]';
  const titleCls = wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold';
  const headerH = wx ? 'h-11' : 'h-12';
  const testPrefix = variant;
  const accent = wx ? '#07C160' : variant === 'sms' ? '#34C759' : '#0099FF';
  const fieldCls =
    'h-10 w-full min-w-0 rounded-[10px] border border-black/[0.08] bg-white px-3.5 text-[15px] outline-none placeholder:text-black/25 focus:border-black/30 dark:border-white/[0.12] dark:bg-white/[0.05] dark:placeholder:text-white/25 dark:focus:border-white/35';

  const [toast, showToast] = useLocalToast();
  // 页面仅在用户交互后挂载 = 纯客户端渲染，惰性初始化（写穿持久化）
  const [cfg, setCfg] = useState<PerceptionConfig>(() => getPerception(sessionKey));
  const [userLocDraft, setUserLocDraft] = useState(cfg.userLoc);
  const [aiLocDraft, setAiLocDraft] = useState(cfg.aiLoc);

  /** 更新并持久化（即点即存，下一次发送现场读取生效）+ 预热相关数据 */
  const update = (patch: Partial<PerceptionConfig>) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      setPerception(sessionKey, patch);
      return next;
    });
    void prewarmPerception(sessionKey);
  };

  const saveLoc = () => {
    if (userLocDraft.trim() === cfg.userLoc && aiLocDraft.trim() === cfg.aiLoc) return;
    update({ userLoc: userLocDraft.trim(), aiLoc: aiLocDraft.trim() });
    showToast('位置已保存，天气将自动更新');
  };

  // z-50：与聊天设置页（z-50）同层、JSX 挂载在其后 → 后渲染盖在其上（v1.9.19 修复）。
  return (
    <div className={`absolute inset-0 z-50 flex h-full w-full flex-col ${pageCls}`} data-testid={`${testPrefix}-perception-page`}>
      <LocalToast msg={toast} />
      {/* 顶栏 */}
      <div className={`shrink-0 pt-[54px] ${barCls}`}>
        <div className={`flex ${headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-perception-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${titleCls}`}>感知设置</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10 pt-2">
        {/* 说明卡 */}
        <div className={`${cardCls} px-4 py-3`}>
          <p className="text-[12.5px] leading-relaxed text-black/50 dark:text-white/50">
            开启后，AI 能感知你的真实世界（打字耗时、电量、天气、节日），仅在发送消息时采集。
          </p>
        </div>

        {/* 基础感知 */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className="px-4 pb-1 pt-3 text-[12.5px] font-medium text-black/40 dark:text-white/40">基础感知</div>
          <div className={`border-t ${dividerCls}`} />
          <ToggleRow
            icon={<Keyboard size={I.size} strokeWidth={I.strokeWidth} />}
            title="打字思考感知"
            desc="回复前思考+打字了多久"
            on={cfg.typing}
            onChange={(v) => update({ typing: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-typing`}
          />
          <div className={`border-t ${dividerCls}`} />
          <ToggleRow
            icon={<BatteryCharging size={I.size} strokeWidth={I.strokeWidth} />}
            title="电量感知"
            desc="设备电量与充电状态"
            on={cfg.battery}
            onChange={(v) => update({ battery: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-battery`}
          />
          <div className={`border-t ${dividerCls}`} />
          <ToggleRow
            icon={<CalendarDays size={I.size} strokeWidth={I.strokeWidth} />}
            title="日历 / 节假日感知"
            desc="公历+农历日期、节假日倒计时"
            on={cfg.calendar}
            onChange={(v) => update({ calendar: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-calendar`}
          />
        </div>

        {/* 天气感知 */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <ToggleRow
            icon={<CloudSun size={I.size} strokeWidth={I.strokeWidth} />}
            title="天气感知"
            desc="两个城市的天气"
            on={cfg.weather}
            onChange={(v) => update({ weather: v })}
            accent={accent}
            testId={`${testPrefix}-settings-perception-weather`}
          />
          {cfg.weather ? (
            <>
              <div className={`border-t ${dividerCls}`} />
              <div className="space-y-2.5 px-4 py-3">
                <div>
                  <p className="mb-1.5 text-[12.5px] text-black/45 dark:text-white/45">我的所在地（城市名）</p>
                  <input
                    value={userLocDraft}
                    onChange={(e) => setUserLocDraft(e.target.value)}
                    onBlur={saveLoc}
                    placeholder="如 杭州"
                    data-testid={`${testPrefix}-perception-userloc-input`}
                    className={fieldCls}
                  />
                </div>
                <div>
                  <p className="mb-1.5 text-[12.5px] text-black/45 dark:text-white/45">
                    {peerName ? `TA（${peerName}）的所在地` : 'TA 的所在地（角色所在城市）'}
                  </p>
                  <input
                    value={aiLocDraft}
                    onChange={(e) => setAiLocDraft(e.target.value)}
                    onBlur={saveLoc}
                    placeholder="如 成都"
                    data-testid={`${testPrefix}-perception-ailoc-input`}
                    className={fieldCls}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* v1.9.19 AI 吃醋锁（触发阈值/娱乐 App 清单/锁定状态；网页端可配置+模拟剧情） */}
        <JealousyLockSection accent={accent} testPrefix={testPrefix} cardCls={cardCls} dividerCls={dividerCls} />
      </div>
    </div>
  );
}
