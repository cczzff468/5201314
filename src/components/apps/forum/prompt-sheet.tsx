'use client';

/**
 * X论坛 · 生成设置 UI（v34 抽屉「生成设置」配套）。
 *
 * - GenRangeRow：抽屉里「每次生成帖子 / 每次生成评论 X~Y 条」的范围步进行
 *   （− 数字 + 一组，两组夹「至」；越界自动钳制、min/max 互相推挤）；
 * - PromptSheet：全屏提示词面板——把全部 11 条生成提示词（帖子/评论/楼中楼/
 *   私信/角色三件套/网名…）完整展示出来，可查看、修改、恢复默认：
 *   · 修改后 700ms 防抖自动保存（也可点「保存并生效」立即保存）；
 *   · 保存即生效——engine.callApi 每次生成请求都把覆盖送给服务端，
 *     后台调度器（角色发帖/互动）同样用新提示词；
 *   · 模板里的 {{占位符}} 由系统按调用现场填充（面板展示可用占位符表）；
 *   · 关闭面板时自动落盘未保存的草稿，编辑不丢。
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Minus, Plus, RotateCcw } from 'lucide-react';
import {
  FORUM_PROMPT_DEFS,
  FORUM_PROMPT_DEFAULTS,
  PROMPT_OVERRIDE_MAX_LEN,
  type PromptKey,
} from '@/lib/forum/prompt-defs';
import { activePromptOf, resetAllPrompts, resetPrompt, setPromptOverride } from '@/lib/forum/gen-settings';
import { XIcons, useXTheme } from './shared';

// ---------------- 范围步进行（抽屉用） ----------------

/** 单个数字步进小钮（−/+） */
function StepBtn({
  children,
  onClick,
  ariaLabel,
  color,
  border,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  color: string;
  border: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full transition-transform active:scale-90"
      style={{ border: `1px solid ${border}`, color }}
    >
      {children}
    </button>
  );
}

/** 「每次生成 X~Y 条」范围行：label/hint 左侧说明 + 右侧两组步进器夹「至」。
 *  无内部态——累加逻辑在父级（genUiRef 同步更新，同一事件循环里连点也逐级累加）。 */
export function GenRangeRow({
  label,
  hint,
  min,
  max,
  bounds,
  onBump,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  bounds: { min: number; max: number };
  /** 步进回调：which = 动哪一端，delta = ±1（父级负责钳制与 min/max 推挤） */
  onBump: (which: 'min' | 'max', delta: number) => void;
}) {
  const t = useXTheme();
  return (
    <div className="w-full rounded-xl px-3 py-[10px]" style={{ background: t.hover }}>
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-medium">{label}</span>
        <span className="text-[11px]" style={{ color: t.secondary }}>
          {min}~{max} 条
        </span>
      </div>
      <div className="mt-[6px] flex items-center gap-2">
        <StepBtn ariaLabel={`${label}下限减一`} onClick={() => onBump('min', -1)} color={t.text} border={t.border}>
          <Minus size={15} strokeWidth={2.4} />
        </StepBtn>
        <span className="w-[30px] text-center text-[17px] font-bold tabular-nums">{min}</span>
        <StepBtn ariaLabel={`${label}下限加一`} onClick={() => onBump('min', 1)} color={t.text} border={t.border}>
          <Plus size={15} strokeWidth={2.4} />
        </StepBtn>
        <span className="px-1 text-[12px]" style={{ color: t.secondary }}>
          至
        </span>
        <StepBtn ariaLabel={`${label}上限减一`} onClick={() => onBump('max', -1)} color={t.text} border={t.border}>
          <Minus size={15} strokeWidth={2.4} />
        </StepBtn>
        <span className="w-[30px] text-center text-[17px] font-bold tabular-nums">{max}</span>
        <StepBtn ariaLabel={`${label}上限加一`} onClick={() => onBump('max', 1)} color={t.text} border={t.border}>
          <Plus size={15} strokeWidth={2.4} />
        </StepBtn>
        <span className="text-[12px]" style={{ color: t.secondary }}>
          条
        </span>
        <span className="ml-auto hidden pl-1 text-[11px] leading-tight sm:inline" style={{ color: t.secondary }}>
          {hint}
        </span>
      </div>
      <span className="mt-[4px] block text-[11px] leading-tight sm:hidden" style={{ color: t.secondary }}>
        {hint}
      </span>
    </div>
  );
}

// ---------------- 提示词面板（全屏 sheet） ----------------

interface PromptSheetProps {
  onClose: () => void;
  toast: (text: string) => void;
}

const AUTOSAVE_MS = 700;

export function PromptSheet({ onClose, toast }: PromptSheetProps) {
  const t = useXTheme();
  /** 当前展开的提示词（默认展开第一条「帖子生成」——用户最关心的入口） */
  const [expanded, setExpanded] = useState<PromptKey | null>('posts');
  /** 编辑草稿（key → 文本；初始 = 当前生效模板：覆盖优先、默认兜底） */
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const d of FORUM_PROMPT_DEFS) o[d.key] = activePromptOf(d.key);
    return o;
  });
  /** 已落盘的生效模板镜像（与 store 同步；draft ≠ applied = 编辑中未保存） */
  const [applied, setApplied] = useState<Record<string, string>>(() => ({ ...drafts }));
  /** 刚保存的 key → 时间戳（显示「已保存 · 立即生效」小闪标） */
  const [savedFlash, setSavedFlash] = useState<Record<string, number>>({});
  /** 「全部恢复默认」二次确认态（毫秒时间戳 = 进入确认态的时刻） */
  const [confirmReset, setConfirmReset] = useState(0);

  const timers = useRef<Record<string, number>>({});
  const flashTimers = useRef<Record<string, number>>({});
  const draftsRef = useRef(drafts);
  const appliedRef = useRef(applied);
  // 渲染后同步镜像（供卸载清理读取最新草稿；不在渲染期写 ref）
  useEffect(() => {
    draftsRef.current = drafts;
    appliedRef.current = applied;
  }, [drafts, applied]);

  /** 落盘一条（更新 store + applied 镜像 + 小闪标） */
  const apply = (key: PromptKey, text: string) => {
    setPromptOverride(key, text);
    const now = activePromptOf(key);
    setApplied((a) => ({ ...a, [key]: now }));
    setSavedFlash((s) => ({ ...s, [key]: Date.now() }));
    window.clearTimeout(flashTimers.current[key]);
    flashTimers.current[key] = window.setTimeout(() => {
      setSavedFlash((s) => {
        const n = { ...s };
        delete n[key];
        return n;
      });
    }, 2400);
  };

  /** 编辑（700ms 防抖自动保存——「修改完立马用新的提示词」） */
  const edit = (key: PromptKey, text: string) => {
    const sliced = text.slice(0, PROMPT_OVERRIDE_MAX_LEN);
    setDrafts((d) => ({ ...d, [key]: sliced }));
    window.clearTimeout(timers.current[key]);
    timers.current[key] = window.setTimeout(() => apply(key, sliced), AUTOSAVE_MS);
  };

  /** 立即保存（按钮路径） */
  const saveNow = (key: PromptKey) => {
    window.clearTimeout(timers.current[key]);
    apply(key, draftsRef.current[key] ?? '');
    toast('已保存，下次生成立即用新提示词');
  };

  /** 恢复单条默认 */
  const resetOne = (key: PromptKey) => {
    window.clearTimeout(timers.current[key]);
    resetPrompt(key);
    setDrafts((d) => ({ ...d, [key]: FORUM_PROMPT_DEFAULTS[key] }));
    setApplied((a) => ({ ...a, [key]: FORUM_PROMPT_DEFAULTS[key] }));
    toast('已恢复默认提示词');
  };

  /** 恢复全部默认（二次确认） */
  const resetEverything = () => {
    if (!confirmReset || Date.now() - confirmReset > 3000) {
      setConfirmReset(Date.now());
      window.setTimeout(() => setConfirmReset(0), 3000);
      return;
    }
    Object.values(timers.current).forEach((c) => window.clearTimeout(c));
    resetAllPrompts();
    const d: Record<string, string> = {};
    for (const def of FORUM_PROMPT_DEFS) d[def.key] = FORUM_PROMPT_DEFAULTS[def.key];
    setDrafts(d);
    setApplied({ ...d });
    setConfirmReset(0);
    toast('全部提示词已恢复默认');
  };

  // 卸载：清 timer + 落盘所有未保存草稿（关闭面板不丢编辑）
  useEffect(() => {
    return () => {
      Object.values(timers.current).forEach((c) => window.clearTimeout(c));
      Object.values(flashTimers.current).forEach((c) => window.clearTimeout(c));
      for (const def of FORUM_PROMPT_DEFS) {
        const draft = draftsRef.current[def.key];
        if (draft !== undefined && draft !== appliedRef.current[def.key]) {
          setPromptOverride(def.key, draft);
        }
      }
    };
  }, []);

  const overriddenCount = FORUM_PROMPT_DEFS.filter(
    (d) => applied[d.key] !== FORUM_PROMPT_DEFAULTS[d.key],
  ).length;

  return (
    <div className="absolute inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="提示词管理">
      <div className="flex h-full flex-col animate-[forum-sheet_.26s_ease-out]" style={{ background: t.bg, color: t.text }}>
        {/* 顶行：返回 | 标题 | 全部恢复默认 */}
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-[54px]" style={{ height: 100 }}>
          <button
            type="button"
            aria-label="关闭并返回"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
            style={{ color: t.text }}
          >
            {XIcons.back(22)}
          </button>
          <div className="flex min-w-0 flex-col items-center">
            <span className="text-[17px] font-bold">提示词</span>
            <span className="text-[11px]" style={{ color: t.secondary }}>
              全部 {FORUM_PROMPT_DEFS.length} 条 · {overriddenCount} 条已自定义
            </span>
          </div>
          <button
            type="button"
            onClick={resetEverything}
            className="flex h-[32px] shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium active:opacity-70"
            style={{
              border: `1px solid ${confirmReset ? '#e0245e' : t.border}`,
              color: confirmReset ? '#e0245e' : t.text,
            }}
            aria-label="全部恢复默认"
          >
            <RotateCcw size={14} strokeWidth={2.2} />
            {confirmReset ? '确认恢复？' : '全部默认'}
          </button>
        </div>

        {/* 说明条 */}
        <div className="shrink-0 px-4 pb-2 text-[11.5px] leading-relaxed" style={{ color: t.secondary }}>
          修改后自动保存，下一次生成（含后台角色发帖）立即使用新提示词。模板里的
          <span className="font-semibold" style={{ color: t.text }}>
            {'{{占位符}}'}
          </span>
          会被系统替换成真实值，没写的占位符会原样发给 AI。
        </div>

        {/* 提示词列表（长列表滚动 + 自定义滚动条） */}
        <div className="forum-gen-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-[28px]">
          {FORUM_PROMPT_DEFS.map((def) => {
            const open = expanded === def.key;
            const draft = drafts[def.key] ?? '';
            const isApplied = applied[def.key] === FORUM_PROMPT_DEFAULTS[def.key];
            const dirty = draft !== (applied[def.key] ?? '');
            const justSaved = !!savedFlash[def.key];
            return (
              <div
                key={def.key}
                className="mb-2 overflow-hidden rounded-2xl"
                style={{ border: `1px solid ${t.border}`, background: open ? t.hover : 'transparent' }}
              >
                {/* 卡头（点击展开/收起） */}
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`展开提示词：${def.label}`}
                  onClick={() => setExpanded(open ? null : def.key)}
                  className="flex w-full items-center gap-2 px-3 py-[10px] text-left transition-colors active:opacity-70"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-[6px]">
                      <span className="truncate text-[15px] font-semibold">{def.label}</span>
                      {isApplied ? (
                        <span
                          className="shrink-0 rounded-full px-[6px] py-[1px] text-[10px] font-medium"
                          style={{ background: t.border, color: t.secondary }}
                        >
                          默认
                        </span>
                      ) : (
                        <span
                          className="shrink-0 rounded-full px-[6px] py-[1px] text-[10px] font-semibold"
                          style={{ background: 'rgba(29,155,240,0.14)', color: t.blue }}
                        >
                          已自定义
                        </span>
                      )}
                      {dirty && (
                        <span
                          className="shrink-0 rounded-full px-[6px] py-[1px] text-[10px] font-semibold"
                          style={{ background: 'rgba(224,36,94,0.12)', color: '#e0245e' }}
                        >
                          未保存
                        </span>
                      )}
                    </div>
                    <span className="mt-[1px] block truncate text-[11.5px]" style={{ color: t.secondary }}>
                      {def.desc}
                    </span>
                  </div>
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-[13px] transition-transform"
                    style={{ color: t.secondary, transform: open ? 'rotate(90deg)' : 'none' }}
                  >
                    ›
                  </span>
                </button>

                {/* 卡体（展开才渲染，长文本编辑区） */}
                {open && (
                  <div className="px-3 pb-3">
                    {/* 可用占位符 */}
                    {def.tokens.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-[5px]">
                        {def.tokens.map((tk) => (
                          <span
                            key={tk.token}
                            title={tk.desc}
                            className="rounded-md px-[6px] py-[2px] text-[10.5px] font-medium"
                            style={{ background: t.border, color: t.secondary }}
                          >
                            {'{{' + tk.token + '}}'} · {tk.desc}
                          </span>
                        ))}
                      </div>
                    )}
                    <textarea
                      value={draft}
                      onChange={(e) => edit(def.key, e.target.value)}
                      onBlur={() => saveNow(def.key)}
                      spellCheck={false}
                      aria-label={`${def.label}模板文本`}
                      className="forum-gen-scroll w-full resize-none rounded-xl px-[10px] py-[8px] text-[12px] leading-[1.65] outline-none"
                      style={{
                        background: t.bg,
                        color: t.text,
                        border: `1px solid ${t.border}`,
                        height: 232,
                        caretColor: t.blue,
                        fontFamily:
                          'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                      }}
                    />
                    {/* 底部操作行：字数 + 恢复默认 + 保存并生效 */}
                    <div className="mt-[6px] flex items-center gap-2">
                      <span className="text-[10.5px] tabular-nums" style={{ color: t.secondary }}>
                        {draft.length} 字
                        {draft.length >= PROMPT_OVERRIDE_MAX_LEN ? '（已达上限）' : ''}
                      </span>
                      {justSaved && (
                        <span
                          className="flex items-center gap-[3px] text-[10.5px] font-medium"
                          style={{ color: '#00ba7c' }}
                        >
                          <Check size={11} strokeWidth={3} />
                          已保存 · 下次生成即生效
                        </span>
                      )}
                      <span className="flex-1" />
                      <button
                        type="button"
                        onClick={() => resetOne(def.key)}
                        className="flex h-[28px] items-center gap-1 rounded-full px-3 text-[12px] font-medium active:opacity-70"
                        style={{ border: `1px solid ${t.border}`, color: t.secondary }}
                        aria-label={`恢复默认：${def.label}`}
                      >
                        <RotateCcw size={12} strokeWidth={2.4} />
                        恢复默认
                      </button>
                      <button
                        type="button"
                        onClick={() => saveNow(def.key)}
                        disabled={!dirty}
                        className="flex h-[28px] items-center rounded-full px-4 text-[12px] font-bold text-white transition-opacity active:opacity-70 disabled:opacity-40"
                        style={{ background: t.blue }}
                        aria-label={`保存并生效：${def.label}`}
                      >
                        保存并生效
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
