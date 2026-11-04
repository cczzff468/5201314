'use client';

/**
 * 聊天显示设置（微信 / QQ 共用，按联系人隔离）—— 嵌入聊天设置页的折叠区块
 * ---------------------------------------------------------------------------
 * 本轮（用户指定）改造：
 *  - 已读未读与时间同显时**上下两行**（已读未读在上、时间在下，预览同步）；
 *  - 删除已读未读区的颜文字快捷 chips（自定义文字仍不限字数，手输随意）；
 *  - 删除时间区的符号 / 颜文字快捷 chips，仅保留常用格式预设 + 模板输入 + 实时预览。
 *
 * 区块随宿主 ChatSettingsPage 的卡片风格渲染（微信 10px 圆角 / QQ 14px 圆角），
 * 展开动画 height auto（framer-motion），设置项即时生效（返回聊天页立见）。
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { StackFitText } from './shrink-text';
import {
  DEFAULT_CHAT_DISPLAY,
  chatDisplaySummary,
  fmtMsgTime,
  patchChatDisplay,
  readTextOf,
  resetChatDisplay,
  useChatDisplay,
  type AvatarShape,
  type ChatDisplayAppId,
  type ChatDisplayConfig,
  type MetaPosition,
} from '@/lib/ios/chat-display';

/** App 原生气泡配色（预览用：我的 = 品牌色，TA 的 = 白） */
const NATIVE_MINE: Record<ChatDisplayAppId, string> = { wx: '#95EC69', qq: '#0099FF' };

/** 时间格式预设（含用户示例 MM/dd/yyyy hh:mm AM·PM · yyyyMMdd；chip 文案 = 固定样例时刻的渲染效果） */
const TIME_SAMPLE = new Date(2025, 11, 25, 14, 30, 45).getTime();
const TIME_PRESETS: readonly string[] = [
  'HH:mm',
  'HH:mm:ss',
  'hh:mm A',
  'hh:mm:ss a',
  'yyyy/MM/dd',
  'yyyy年M月d日',
  'yyyy/MM/dd HH:mm',
  'MM/dd/yyyy hh:mm A',
  'yyyyMMdd',
];

/** 元信息文字双色阶：已读浅灰 / 未读深灰（本轮用户指定：未读不用品牌色） */
const READ_CLS = 'text-black/35 dark:text-white/40';
const UNREAD_CLS = 'text-black/60 dark:text-white/75';

/** 紧凑分段选择器（浅底胶囊容器 + 白色活动块） */
function MiniSegmented<T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <div
      role="radiogroup"
      data-testid={testId}
      className="flex gap-[3px] rounded-full bg-black/[0.05] p-[2.5px] dark:bg-white/[0.08]"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={testId ? `${testId}-${o.value}` : undefined}
            onClick={() => onChange(o.value)}
            className={`flex-1 whitespace-nowrap rounded-full px-3 py-[6px] text-[12.5px] font-medium leading-none transition-all ${
              active
                ? 'bg-white text-black shadow-[0_1px_3px_rgba(0,0,0,0.12)] dark:bg-white/[0.18] dark:text-white'
                : 'text-black/45 active:scale-[0.97] dark:text-white/45'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 展开区里的一行设置（左侧标签 + 右侧控件），带顶部分隔线 */
function SectionRow({ label, children, indent }: { label: string; children: React.ReactNode; indent?: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 border-t border-black/[0.045] py-2.5 pl-4 pr-3.5 dark:border-white/[0.06] ${
        indent ? 'pl-[26px]' : ''
      }`}
    >
      <span className="w-[52px] shrink-0 text-[13px] text-black/45 dark:text-white/45">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** 快捷 chip（预设格式）：tap 即生效；title = 补充说明 */
function MetaChip({
  label,
  title,
  onClick,
  testId,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title ?? label}
      data-testid={testId}
      onClick={onClick}
      className="whitespace-nowrap rounded-full bg-black/[0.05] px-2.5 py-[4.5px] text-[11px] leading-none text-black/55 transition-transform active:scale-[0.93] dark:bg-white/[0.08] dark:text-white/60"
    >
      {label}
    </button>
  );
}

/** chip 分组行（标题 + 可换行 chips） */
function ChipRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 first:mt-0">
      <div className="mb-1 text-[10.5px] text-black/35 dark:text-white/35">{title}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

// ---------------- 迷你预览（跟随全部配置，两行对话） ----------------

function PreviewAvatar({ app, cfg, side, size = 26 }: { app: ChatDisplayAppId; cfg: ChatDisplayConfig; side: 'mine' | 'theirs'; size?: number }) {
  const radius = cfg.avatarShape === 'circle' ? size / 2 : Math.max(3, Math.round(size * 0.11));
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 select-none items-center justify-center text-[10px] font-semibold text-white"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: side === 'mine' ? NATIVE_MINE[app] : 'linear-gradient(135deg,#F0A0B8,#C86DD7)',
      }}
    >
      {side === 'mine' ? '我' : 'TA'}
    </span>
  );
}

/** 预览头像列宽（与真实聊天页一致：wx 38 / qq 40）——头像下元信息在此宽度内堆叠，所见即所得 */
const PREVIEW_AVATAR_COL: Record<ChatDisplayAppId, number> = { wx: 38, qq: 40 };

function PreviewRow({
  app,
  cfg,
  side,
  text,
  read,
  time,
}: {
  app: ChatDisplayAppId;
  cfg: ChatDisplayConfig;
  side: 'mine' | 'theirs';
  text: string;
  read: boolean;
  time: string;
}) {
  const showRead = cfg.readEnabled;
  const showTime = cfg.timeEnabled;
  /* 头像下元信息：与真实聊天同构——列宽内堆叠缩字（长模板拆行不裁字）、我的右对齐 / TA 左对齐 */
  const avatarMeta =
    showRead || showTime ? (
      <span
        className={`mt-[2px] flex w-full flex-col gap-y-[1px] leading-none ${
          side === 'mine' ? 'text-right' : 'text-left'
        }`}
      >
        {showRead && cfg.readPosition === 'avatar' && (
          <StackFitText
            min={5}
            className={`block w-full text-[8.5px] leading-[1.3] ${read ? READ_CLS : UNREAD_CLS}`}
          >
            {readTextOf(cfg, read)}
          </StackFitText>
        )}
        {showTime && cfg.timePosition === 'avatar' && (
          <StackFitText
            min={5}
            className="block w-full text-[8.5px] leading-[1.3] text-black/40 dark:text-white/40"
          >
            {time}
          </StackFitText>
        )}
      </span>
    ) : null;
  const bubbleMeta =
    showRead || showTime ? (
      <span
        className={`mt-[2px] flex flex-col self-stretch gap-y-[1px] leading-none ${
          side === 'mine' ? 'items-start' : 'items-end'
        }`}
      >
        {showRead && cfg.readPosition === 'bubble' && (
          <span className={`whitespace-nowrap text-[9px] leading-[1.3] ${read ? READ_CLS : UNREAD_CLS}`}>
            {readTextOf(cfg, read)}
          </span>
        )}
        {showTime && cfg.timePosition === 'bubble' && (
          <span className="whitespace-nowrap text-[9px] leading-[1.3] text-black/40 dark:text-white/40">
            {time}
          </span>
        )}
      </span>
    ) : null;
  return (
    <div className={`flex items-start gap-2 ${side === 'mine' ? 'flex-row-reverse' : ''}`}>
      <div className="flex shrink-0 flex-col items-center" style={{ width: PREVIEW_AVATAR_COL[app] }}>
        <PreviewAvatar app={app} cfg={cfg} side={side} />
        {avatarMeta}
      </div>
      <div className={`flex min-w-0 flex-col ${side === 'mine' ? 'items-end' : 'items-start'}`}>
        <span
          className={`max-w-full whitespace-pre-wrap break-words px-2 py-[5px] text-[11.5px] leading-[1.4] ${
            side === 'mine' ? 'text-black' : 'bg-white text-black dark:bg-[#2A2C31] dark:text-white'
          }`}
          style={side === 'mine' ? { backgroundColor: NATIVE_MINE[app] } : undefined}
        >
          {text}
        </span>
        {bubbleMeta}
      </div>
    </div>
  );
}

// ================= 折叠区块（嵌入聊天设置页） =================

export interface ChatDisplaySectionProps {
  /** 宿主 App（wx / qq；配置按联系人隔离） */
  app: ChatDisplayAppId;
  /** 当前会话联系人 id（per-contact 存取键） */
  contactId: string;
}

export function ChatDisplaySection({ app, contactId }: ChatDisplaySectionProps) {
  const cfg = useChatDisplay(app, contactId);
  const [open, setOpen] = useState(false);
  /** 输入框草稿（失焦/回车才提交，避免每敲一个字就广播） */
  const [readDraft, setReadDraft] = useState<string | null>(null);
  const [unreadDraft, setUnreadDraft] = useState<string | null>(null);
  /** 时间模板草稿（chips 点按即时提交；输入失焦/回车提交） */
  const [timeDraft, setTimeDraft] = useState<string | null>(null);

  const patch = (p: Partial<ChatDisplayConfig>) => patchChatDisplay(app, contactId, p);
  const isDefault = JSON.stringify(cfg) === JSON.stringify(DEFAULT_CHAT_DISPLAY[app]);
  const curTime = () => timeDraft ?? cfg.timeFormat;
  const t = fmtMsgTime(Date.now() - 60_000, curTime());

  /** 时间模板 chips 即时生效（预设 = 替换） */
  const applyTime = (v: string) => {
    setTimeDraft(null);
    if (v !== cfg.timeFormat) patch({ timeFormat: v });
  };

  const POSITION_OPTIONS: { value: MetaPosition; label: string }[] = [
    { value: 'avatar', label: '头像下' },
    { value: 'bubble', label: '气泡下' },
  ];

  return (
    <div className="mt-3 overflow-hidden rounded-[10px] bg-white dark:bg-[#1A1A1A]" data-testid="chat-display-section">
      {/* 折叠标题行：点击展开/收起；右侧当前配置摘要 */}
      <button
        type="button"
        aria-expanded={open}
        data-testid="chat-display-header"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-[16px] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
      >
        <span>显示设置</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            data-testid="chat-display-summary"
            className={`max-w-[130px] truncate text-[13.5px] ${isDefault ? 'text-black/35 dark:text-white/35' : 'text-black/55 dark:text-white/60'}`}
          >
            {chatDisplaySummary(cfg)}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`h-[18px] w-[18px] shrink-0 text-black/25 transition-transform duration-300 dark:text-white/25 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {/* 展开内容（height auto 动画） */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-3">
              {/* 迷你预览：两行对话实时反映全部设置 */}
              <div className="mx-3.5 mt-0.5 rounded-[12px] bg-[#F2F3F7] px-3 py-3 dark:bg-[#141519]">
                <div className="flex flex-col gap-[11px]">
                  <PreviewRow app={app} cfg={cfg} side="theirs" text="在忙什么呀？" read={false} time={t} />
                  <PreviewRow app={app} cfg={cfg} side="mine" text="刚下课，正回宿舍" read time={t} />
                </div>
              </div>

              {/* 头像样式 */}
              <div className="mt-2.5">
                <SectionRow label="头像">
                  <MiniSegmented
                    testId="avatar-shape"
                    value={cfg.avatarShape}
                    options={[
                      { value: 'circle' as AvatarShape, label: '圆形' },
                      { value: 'rounded' as AvatarShape, label: '圆角' },
                    ]}
                    onChange={(v) => patch({ avatarShape: v })}
                  />
                </SectionRow>
              </div>

              {/* 已读未读 */}
              <div className="mt-1">
                <div className="flex items-center justify-between border-t border-black/[0.045] py-2.5 pl-4 pr-3.5 dark:border-white/[0.06]">
                  <span className="text-[15px]">已读未读</span>
                  <ChatToggleMini on={cfg.readEnabled} onChange={(v) => patch({ readEnabled: v })} testId="read-toggle" />
                </div>
                {cfg.readEnabled && (
                  <>
                    <SectionRow label="位置" indent>
                      <MiniSegmented
                        testId="read-position"
                        value={cfg.readPosition}
                        options={POSITION_OPTIONS}
                        onChange={(v) => patch({ readPosition: v })}
                      />
                    </SectionRow>
                    <SectionRow label="文字" indent>
                      <div className="flex items-center gap-2">
                        <LabelInput
                          testId="read-label-input"
                          placeholder="已读"
                          value={readDraft ?? cfg.readLabel}
                          onCommit={(v) => {
                            setReadDraft(null);
                            if (v !== cfg.readLabel) patch({ readLabel: v });
                          }}
                          onDraft={setReadDraft}
                        />
                        <LabelInput
                          testId="unread-label-input"
                          placeholder="未读"
                          value={unreadDraft ?? cfg.unreadLabel}
                          onCommit={(v) => {
                            setUnreadDraft(null);
                            if (v !== cfg.unreadLabel) patch({ unreadLabel: v });
                          }}
                          onDraft={setUnreadDraft}
                        />
                      </div>
                    </SectionRow>
                  </>
                )}
              </div>

              {/* 时间显示 */}
              <div className="mt-1">
                <div className="flex items-center justify-between border-t border-black/[0.045] py-2.5 pl-4 pr-3.5 dark:border-white/[0.06]">
                  <span className="text-[15px]">时间显示</span>
                  <ChatToggleMini on={cfg.timeEnabled} onChange={(v) => patch({ timeEnabled: v })} testId="time-toggle" />
                </div>
                {cfg.timeEnabled && (
                  <>
                    <SectionRow label="格式" indent>
                      <div className="min-w-0">
                        <input
                          type="text"
                          value={curTime()}
                          placeholder="HH:mm"
                          data-testid="time-template-input"
                          aria-label="自定义时间格式模板"
                          onChange={(e) => setTimeDraft(e.target.value)}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            setTimeDraft(null);
                            if (v !== cfg.timeFormat) patch({ timeFormat: v });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                          className="h-[30px] w-full min-w-0 rounded-[8px] border border-black/[0.08] bg-white px-2.5 text-[13px] leading-none outline-none transition-colors placeholder:text-black/25 focus:border-black/30 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-white dark:placeholder:text-white/25 dark:focus:border-white/35"
                        />
                        <div
                          data-testid="time-template-preview"
                          className="mt-1 break-words text-[11px] leading-[1.4] text-black/40 dark:text-white/40"
                        >
                          效果：{fmtMsgTime(Date.now(), curTime())}
                        </div>
                      </div>
                    </SectionRow>
                    {/* 快捷键：常用格式（tap = 替换） */}
                    <div className="border-t border-black/[0.045] py-2.5 pl-[26px] pr-3.5 dark:border-white/[0.06]">
                      <ChipRow title="常用格式（点按替换模板）">
                        {TIME_PRESETS.map((tpl) => (
                          <MetaChip
                            key={tpl}
                            label={fmtMsgTime(TIME_SAMPLE, tpl)}
                            title={tpl}
                            testId="time-preset"
                            onClick={() => applyTime(tpl)}
                          />
                        ))}
                      </ChipRow>
                      <p className="mt-2 text-[10.5px] leading-[1.55] text-black/30 dark:text-white/30">
                        yyyy 年 · MM 月 · dd 日 · HH 时(24) · hh 时(12) · mm 分 · ss 秒 · A 上午下午；
                        其余文字原样显示，字母要原样显示用 [方括号] 括起
                      </p>
                    </div>
                    <SectionRow label="位置" indent>
                      <MiniSegmented
                        testId="time-position"
                        value={cfg.timePosition}
                        options={POSITION_OPTIONS}
                        onChange={(v) => patch({ timePosition: v })}
                      />
                    </SectionRow>
                  </>
                )}
              </div>

              {/* 恢复默认（仅在偏离默认时出现，弱化入口） */}
              {!isDefault && (
                <button
                  type="button"
                  data-testid="chat-display-reset"
                  onClick={() => {
                    setReadDraft(null);
                    setUnreadDraft(null);
                    resetChatDisplay(app, contactId);
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 border-t border-black/[0.045] py-2.5 text-[13px] text-black/40 active:bg-black/[0.03] dark:border-white/[0.06] dark:text-white/40 dark:active:bg-white/[0.05]"
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                  恢复默认
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 紧凑版 iOS 开关（与 ChatSettingsPage 的 ChatToggle 同视觉，缩小一号） */
function ChatToggleMini({ on, onChange, testId }: { on: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className={`relative h-[27px] w-[45px] shrink-0 rounded-full transition-colors duration-200 ${
        on ? '' : 'bg-black/[0.12] dark:bg-white/[0.22]'
      }`}
      style={on ? { backgroundColor: '#34C759' } : undefined}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] h-[23px] w-[23px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-all duration-200 ${
          on ? 'left-[20px]' : 'left-[2px]'
        }`}
      />
    </button>
  );
}

/** 自定义文字输入框（失焦/回车提交；空 = 用回默认占位；不限字数） */
function LabelInput({
  value,
  placeholder,
  onCommit,
  onDraft,
  testId,
}: {
  value: string;
  placeholder: string;
  onCommit: (v: string) => void;
  onDraft: (v: string | null) => void;
  testId?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      data-testid={testId}
      aria-label={`自定义${placeholder}文字`}
      onChange={(e) => onDraft(e.target.value)}
      onBlur={(e) => onCommit(e.target.value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
      className="h-[30px] min-w-0 flex-1 rounded-[8px] border border-black/[0.08] bg-white px-2.5 text-[13px] leading-none outline-none transition-colors placeholder:text-black/25 focus:border-black/30 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-white dark:placeholder:text-white/25 dark:focus:border-white/35"
    />
  );
}
