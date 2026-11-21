'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { IOSBackButton, IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { isFriendIn } from '@/lib/contacts';
import { listContacts } from '@/lib/ios/contacts-store';
import { getMomentAutoCfg } from '@/lib/moments';
import {
  DEFAULT_BILINGUAL_PROMPT,
  formatIntervalRange,
  getMomentsSettings,
  MAX_POST_INTERVAL_MIN,
  MIN_POST_INTERVAL_MIN,
  MOMENT_RHYTHM_PRESETS,
  resetMomentsSettings,
  saveMomentsSettings,
  type MomentsSettings,
} from '@/lib/ios/moments-settings';

export interface MomentsSettingsPageProps {
  /** 平台：wx=朋友圈设置 / qq=空间动态设置（feat-64：两个 App 的设置各自独立存储，互不影响） */
  app: 'wx' | 'qq';
  /** 返回上一级 */
  onBack: () => void;
  /** 弹一条本地提示 */
  onToast: (m: string) => void;
  /** 立即发帖入口（父级打开本 App 自己的 AskPostSheet——朋友圈只发朋友圈、空间只发空间） */
  onOpenPostNow: () => void;
}

/** 平台主题：wx 微信绿 / qq QQ 蓝（分段选中、滑杆填充、立即发帖文字）+ 文案 */
const PLATFORM_META: Record<
  'wx' | 'qq',
  { accent: string; title: string; scopeName: string; otherName: string; postAction: string }
> = {
  wx: {
    accent: '#07C160',
    title: '朋友圈设置',
    scopeName: '微信朋友圈',
    otherName: 'QQ空间',
    postAction: '立即发帖',
  },
  qq: {
    accent: '#0099FF',
    title: '空间动态设置',
    scopeName: 'QQ空间',
    otherName: '微信朋友圈',
    postAction: '立即发帖',
  },
};

// ---------------- 通用小组件（极简：纯文字行，无图标） ----------------

/** 分组上方小字标签（iOS 原生分组风：仅一行浅灰文字） */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 mt-6 px-1 text-[12.5px] font-medium text-muted-foreground">{children}</p>;
}

/** iOS 分组卡片 */
function GroupCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] bg-card shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
      {children}
    </div>
  );
}

/** 行：标签 + 右侧值/开关/输入框/Chevron。
 *  无 onClick 时渲染为 div（避免 input/switch 嵌在 disabled button 中导致不可交互）。 */
function Row({
  label,
  value,
  onClick,
  right,
}: {
  label: string;
  value?: string;
  onClick?: () => void;
  right?: React.ReactNode;
}) {
  const className =
    'flex min-h-[52px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-muted/50';
  const inner = (
    <>
      <span className="min-w-0 flex-1 text-[16px] leading-tight">{label}</span>
      {value && <span className="shrink-0 text-[15px] text-muted-foreground">{value}</span>}
      {onClick ? right ?? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : right}
    </>
  );
  if (!onClick) return <div className={className}>{inner}</div>;
  return (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}

/** iOS 风格大号绿色开关（#34C759） */
function BigGreenSwitch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={`relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors duration-200 active:scale-95 ${
        checked
          ? 'bg-[#34C759] shadow-[0_2px_8px_rgba(52,199,89,0.4)]'
          : 'bg-black/15 dark:bg-white/25'
      }`}
    >
      <span
        className={`absolute top-[2px] h-[26px] w-[26px] rounded-full bg-white shadow-md transition-transform duration-200 ${
          checked ? 'left-[24px]' : 'left-[2px]'
        }`}
      />
    </button>
  );
}

/**
 * 数值输入（chip 风：数字 + 单位同在一个浅灰圆角容器里，无外边框）。
 * 本地维护输入文本，失焦/回车时按 [min,max] 范围 clamp 后调 onCommit。
 */
function NumberField({
  displayValue,
  min,
  max,
  step,
  unit,
  ariaLabel,
  toStored,
  onCommit,
}: {
  displayValue: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  ariaLabel: string;
  toStored: (n: number) => number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(displayValue));

  // 外部值变化时（如点节奏预设/恢复默认）同步本地文本
  useEffect(() => {
    setText(String(displayValue));
  }, [displayValue]);

  const commit = () => {
    if (text.trim() === '') {
      setText(String(displayValue));
      return;
    }
    const n = Number(text);
    if (Number.isNaN(n)) {
      setText(String(displayValue));
      return;
    }
    const clamped = Math.max(min, Math.min(max, Math.round(n)));
    onCommit(toStored(clamped));
    setText(String(clamped));
  };

  return (
    <span className="flex shrink-0 items-center gap-1 rounded-[9px] bg-black/[0.05] py-1 pl-2.5 pr-2 dark:bg-white/[0.09]">
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        aria-label={ariaLabel}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-[44px] bg-transparent text-right text-[15px] tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        inputMode="numeric"
      />
      <span className="w-[26px] text-[12.5px] leading-none text-muted-foreground">{unit}</span>
    </span>
  );
}

/** 概率滑杆行（无图标全宽：标签 + 百分比在上，自绘轨道在下，平台色填充） */
function SliderRow({
  label,
  value,
  accent,
  onChange,
}: {
  label: string;
  /** 存储值 0-1 */
  value: number;
  /** 平台主色（轨道填充） */
  accent: string;
  onChange: (v: number) => void;
}) {
  const pct = Math.min(100, Math.max(0, Math.round(value * 100)));
  return (
    <div className="flex flex-col gap-1 px-4 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[16px] leading-tight">{label}</span>
        <span className="text-[15px] tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <div className="relative h-[26px]">
        {/* 自绘轨道：左右各缩进拇指半径（11px），让填充末端与拇指圆心严格对齐 */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-[11px] right-[11px] top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-black/[0.08] dark:bg-white/[0.16]"
        >
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: accent }} />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          className="absolute inset-0 cursor-pointer appearance-none bg-transparent focus:outline-none [&::-moz-range-thumb]:h-[22px] [&::-moz-range-thumb]:w-[22px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.35)] [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-[4px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:mt-[-9px] [&::-webkit-slider-thumb]:h-[22px] [&::-webkit-slider-thumb]:w-[22px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-black/5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.35)]"
        />
      </div>
    </div>
  );
}

/** 发布节奏分段控制器（iOS Segmented Control 风：灰底轨道 + 白底浮起选中段，滑块平滑移动）。
 *  每段两行：节奏名 + 间隔区间（活跃 30分钟-2小时 / 自然 2-4小时 / 安静 6-12小时 / 自定义 手动）。 */
function RhythmSegmented({
  accent,
  activeKey,
  onPick,
}: {
  accent: string;
  activeKey: 'active' | 'natural' | 'calm' | 'custom';
  onPick: (key: 'active' | 'natural' | 'calm' | 'custom') => void;
}) {
  const segs: { key: 'active' | 'natural' | 'calm' | 'custom'; label: string; sub: string }[] = [
    ...MOMENT_RHYTHM_PRESETS.map((p) => ({
      key: p.key as 'active' | 'natural' | 'calm',
      label: p.label,
      sub: formatIntervalRange(p.min, p.max),
    })),
    { key: 'custom', label: '自定义', sub: '手动' },
  ];
  return (
    <div
      role="group"
      aria-label="发布节奏"
      className="flex rounded-[10px] bg-black/[0.05] p-[2.5px] dark:bg-white/[0.09]"
    >
      {segs.map((s) => {
        const active = activeKey === s.key;
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(s.key)}
            className="relative flex-1 rounded-[8px] px-1 py-[7px] text-center transition-opacity active:opacity-60"
          >
            {active && (
              <motion.span
                layoutId="rhythm-pill"
                transition={{ type: 'tween', duration: 0.22, ease: 'easeOut' }}
                className="absolute inset-0 rounded-[8px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.12)] dark:bg-[#5b5b60]"
              />
            )}
            <span
              className={`relative block text-[13.5px] font-medium leading-tight ${
                active ? '' : 'text-muted-foreground'
              }`}
              style={active ? { color: accent } : undefined}
            >
              {s.label}
            </span>
            <span
              className={`relative mt-[2px] block whitespace-nowrap text-[10.5px] leading-tight ${
                active ? 'text-muted-foreground' : 'text-muted-foreground/70'
              }`}
            >
              {s.sub}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 自定义间隔的内嵌子行（最短/最长，位于分段控制器下方；跟随总开关一起淡出） */
function IntervalRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[44px] items-center justify-between pl-4 pr-2">
      <span className="text-[15px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** 卡片下方的说明小字（iOS 分组页脚风） */
function GroupFooter({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 px-1 text-[12px] leading-snug text-muted-foreground">{children}</p>;
}

// ---------------- 双语提示词二级编辑页 ----------------

function PromptEditPage({
  initial,
  onBack,
  onSave,
}: {
  initial: string;
  onBack: () => void;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <IOSScreen className="relative">
      <IOSNavBar
        title="双语提示词"
        large={false}
        left={<IOSBackButton onClick={onBack} label="" />}
        right={
          <button
            type="button"
            onClick={() => onSave(text)}
            className="text-[17px] font-medium text-[#007AFF] transition-opacity active:opacity-50 dark:text-[#0A84FF]"
          >
            保存
          </button>
        }
      />
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-[40px]">
        <div className="mt-6 overflow-hidden rounded-[12px] bg-card p-3 ring-1 ring-black/[0.03] dark:ring-white/[0.06]">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={DEFAULT_BILINGUAL_PROMPT}
            className="min-h-[200px] w-full resize-none rounded-[10px] bg-background/40 px-3 py-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
          />
          <p className="mt-1 px-1 text-right text-[11px] tabular-nums text-muted-foreground/70">
            {text.length} 字
          </p>
        </div>
        <p className="mt-2 px-1 text-[13px] leading-snug text-muted-foreground">
          留空保存即使用默认双语规则（上方占位文为本规则全文，可参考编辑自定义）。
        </p>
        <div className="mt-6 overflow-hidden rounded-[12px] bg-card divide-y divide-border/60">
          <button
            type="button"
            onClick={() => setText('')}
            className="flex min-h-[52px] w-full items-center justify-center text-[16px] text-[#007AFF] transition-colors active:bg-muted/40 dark:text-[#0A84FF]"
          >
            清空（恢复默认提示词）
          </button>
        </div>
      </div>
    </IOSScreen>
  );
}

// ---------------- 主页面 ----------------

export function MomentsSettingsPage({
  app,
  onBack,
  onToast,
  onOpenPostNow,
}: MomentsSettingsPageProps) {
  const meta = PLATFORM_META[app];
  const [settings, setSettings] = useState<MomentsSettings>(() => {
    // 容错：历史数据可能最短 > 最长（旧 UI 未强校验），加载时对调，保证区间合法
    const s = getMomentsSettings(app);
    if (s.minPostInterval > s.maxPostInterval) {
      return { ...s, minPostInterval: s.maxPostInterval, maxPostInterval: s.minPostInterval };
    }
    return s;
  });
  const [promptEditing, setPromptEditing] = useState(false);
  /** 用户显式点过「自定义」段（预设值未改动时也让间隔输入框出现） */
  const [customMode, setCustomMode] = useState(false);
  /** 将主动发动态的好友数（当前平台；null = 还在统计） */
  const [activeFriends, setActiveFriends] = useState<number | null>(null);

  /** 局部更新 + 持久化（只写当前平台这一份，另一 App 不受影响） */
  const update = (patch: Partial<MomentsSettings>) => {
    const next = saveMomentsSettings(app, patch);
    setSettings(next);
  };

  // 统计当前平台「会主动发动态」的好友数（好友标记 × 每好友自动发开关）
  useEffect(() => {
    let alive = true;
    listContacts()
      .then((cs) => {
        if (!alive) return;
        const n = cs.filter(
          (c) => (c.kind === 'char' || c.kind === 'npc') && isFriendIn(c, app) && getMomentAutoCfg(c.id, app).enabled,
        ).length;
        setActiveFriends(n);
      })
      .catch(() => {
        // 统计失败不打扰用户
      });
    return () => {
      alive = false;
    };
  }, [app]);

  // ---------- 二级提示词编辑页 ----------
  if (promptEditing) {
    return (
      <PromptEditPage
        initial={settings.bilingualPrompt || DEFAULT_BILINGUAL_PROMPT}
        onBack={() => setPromptEditing(false)}
        onSave={(text) => {
          update({ bilingualPrompt: text.trim() });
          setPromptEditing(false);
          onToast('已保存双语提示词');
        }}
      />
    );
  }

  const matchedPreset = MOMENT_RHYTHM_PRESETS.find(
    (p) => p.min === settings.minPostInterval && p.max === settings.maxPostInterval,
  );
  const activeKey: 'active' | 'natural' | 'calm' | 'custom' =
    customMode || !matchedPreset ? 'custom' : (matchedPreset.key as 'active' | 'natural' | 'calm');

  const pickSeg = (key: 'active' | 'natural' | 'calm' | 'custom') => {
    if (key === 'custom') {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    const p = MOMENT_RHYTHM_PRESETS.find((x) => x.key === key);
    if (p) update({ minPostInterval: p.min, maxPostInterval: p.max });
  };

  const rangeText = formatIntervalRange(settings.minPostInterval, settings.maxPostInterval);
  const footer = !settings.autoPostEnabled
    ? '已关闭，好友将不再主动发布动态'
    : activeFriends === null
      ? '正在统计好友…'
      : activeFriends === 0
        ? '还没有好友会主动发布动态'
        : `${activeFriends} 位好友 · 每隔约 ${rangeText}发一条`;

  return (
    <IOSScreen className="relative">
      <IOSNavBar title={meta.title} large={false} left={<IOSBackButton onClick={onBack} label="" />} />
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-[80px]">
        {/* 卡1：自动发动态 + 发布节奏分段（活跃 30分钟-2小时 / 自然 2-4小时 / 安静 6-12小时） */}
        <div className="mt-5">
          <GroupCard>
            <Row
              label="自动发动态"
              right={
                <BigGreenSwitch
                  checked={settings.autoPostEnabled}
                  onCheckedChange={(v) => update({ autoPostEnabled: v })}
                />
              }
            />
            {/* 节奏区：总开关关闭时整体淡出并禁点（iOS 依赖设置联动风） */}
            <div
              className={`pb-4 pt-3 transition-opacity duration-200 ${
                settings.autoPostEnabled ? '' : 'pointer-events-none opacity-40'
              }`}
            >
              <div className="px-4">
                <RhythmSegmented accent={meta.accent} activeKey={activeKey} onPick={pickSeg} />
              </div>
              {activeKey === 'custom' && (
                <div className="mt-1 divide-y divide-border/40">
                  {/* 交叉钳制：最短 ≤ 当前最长、最长 ≥ 当前最短，保证区间永远合法 */}
                  <IntervalRow label="最短间隔">
                    <NumberField
                      displayValue={settings.minPostInterval}
                      min={MIN_POST_INTERVAL_MIN}
                      max={settings.maxPostInterval}
                      step={5}
                      unit="分钟"
                      ariaLabel="最短发帖间隔（分钟）"
                      toStored={(n) => n}
                      onCommit={(v) => update({ minPostInterval: v })}
                    />
                  </IntervalRow>
                  <IntervalRow label="最长间隔">
                    <NumberField
                      displayValue={settings.maxPostInterval}
                      min={settings.minPostInterval}
                      max={MAX_POST_INTERVAL_MIN}
                      step={5}
                      unit="分钟"
                      ariaLabel="最长发帖间隔（分钟）"
                      toStored={(n) => n}
                      onCommit={(v) => update({ maxPostInterval: v })}
                    />
                  </IntervalRow>
                </div>
              )}
            </div>
          </GroupCard>
          <GroupFooter>
            {footer}
            <span className="text-muted-foreground/70">（仅作用于{meta.scopeName}）</span>
          </GroupFooter>
        </div>

        {/* 立即发帖（独立动作卡：平台色居中文字；只发到本 App 的动态） */}
        <div className="mt-4">
          <GroupCard>
            <button
              type="button"
              onClick={() => onOpenPostNow()}
              className="flex min-h-[50px] w-full items-center justify-center text-[16px] font-medium transition-colors active:bg-muted/50"
              style={{ color: meta.accent }}
            >
              {meta.postAction}
            </button>
          </GroupCard>
        </div>

        {/* 卡2：评论与点赞 */}
        <GroupLabel>评论与点赞</GroupLabel>
        <GroupCard>
          <SliderRow
            label="点赞概率"
            value={settings.likeProbability}
            accent={meta.accent}
            onChange={(v) => update({ likeProbability: v })}
          />
          <SliderRow
            label="评论概率"
            value={settings.commentProbability}
            accent={meta.accent}
            onChange={(v) => update({ commentProbability: v })}
          />
          <Row
            label="首条评论延迟"
            right={
              <NumberField
                displayValue={settings.firstCommentDelay}
                min={1}
                max={3600}
                step={1}
                unit="秒"
                ariaLabel="首条评论延迟（秒）"
                toStored={(n) => n}
                onCommit={(v) => update({ firstCommentDelay: v })}
              />
            }
          />
          <Row
            label="后续评论间隔"
            right={
              <NumberField
                displayValue={settings.followCommentDelay}
                min={1}
                max={3600}
                step={1}
                unit="秒"
                ariaLabel="后续评论间隔（秒）"
                toStored={(n) => n}
                onCommit={(v) => update({ followCommentDelay: v })}
              />
            }
          />
        </GroupCard>

        {/* 卡3：NPC 互动（「回复 NPC 评论延迟」为死设置已移除：引擎从不让 AI 回复 NPC 评论，
            存储键 replyNpcCommentDelay 保留不动，仅不再展示） */}
        <GroupLabel>NPC 互动</GroupLabel>
        <GroupCard>
          {/* #42：NPC 转发概率（0-100 百分比；好友刷到用户动态后转发到 TA 空间的概率，引擎在 QQ 空间读） */}
          <SliderRow
            label="NPC 转发概率"
            value={settings.repostProbability / 100}
            accent={meta.accent}
            onChange={(v) => update({ repostProbability: Math.min(100, Math.max(0, Math.round(v * 100))) })}
          />
          <Row
            label="NPC 互动延迟"
            right={
              <NumberField
                displayValue={settings.npcInteractDelay}
                min={1}
                max={3600}
                step={1}
                unit="秒"
                ariaLabel="NPC 互动延迟（秒）"
                toStored={(n) => n}
                onCommit={(v) => update({ npcInteractDelay: v })}
              />
            }
          />
        </GroupCard>

        {/* 卡4：双语翻译 */}
        <GroupLabel>双语翻译</GroupLabel>
        <GroupCard>
          <Row
            label="双语翻译"
            right={
              <BigGreenSwitch
                checked={settings.bilingualEnabled}
                onCheckedChange={(v) => update({ bilingualEnabled: v })}
              />
            }
          />
          <Row
            label="折叠中文译文"
            right={
              <BigGreenSwitch
                checked={settings.foldChineseTranslation}
                onCheckedChange={(v) => update({ foldChineseTranslation: v })}
              />
            }
          />
          <Row
            label="双语提示词"
            value={settings.bilingualPrompt.trim() ? '自定义' : '默认'}
            onClick={() => setPromptEditing(true)}
          />
        </GroupCard>

        {/* 恢复默认（居中红字动作卡；只重置当前平台） */}
        <div className="mt-6">
          <GroupCard>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`确定将${meta.scopeName}设置恢复为默认值？${meta.otherName}的设置不受影响。`)) {
                  const next = resetMomentsSettings(app);
                  setSettings(next);
                  setCustomMode(false);
                  onToast('已恢复默认设置');
                }
              }}
              className="flex min-h-[50px] w-full items-center justify-center text-[16px] text-[#FF3B30] transition-colors active:bg-muted/50 dark:text-[#FF453A]"
            >
              恢复默认设置
            </button>
          </GroupCard>
        </div>

        {/* 两行小提示：平台独立 + 每好友单独节奏 */}
        <div className="mt-5 px-2 text-center text-[12px] leading-relaxed text-muted-foreground/80">
          <p>本页设置仅作用于{meta.scopeName}，与{meta.otherName}互不影响</p>
          <p>每位好友的节奏，可在「{meta.postAction}」列表中单独设置</p>
        </div>
      </div>
    </IOSScreen>
  );
}

export default MomentsSettingsPage;
