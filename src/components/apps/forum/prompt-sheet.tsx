'use client';

/**
 * X论坛 · 提示词模板组件（v38「AI 规则」面板配套）。
 *
 * - GenRangeRow：抽屉里「每次生成帖子 / 每次生成评论 X~Y 条」的范围步进行
 *   （− 数字 + 一组，两组夹「至」；越界自动钳制、min/max 互相推挤）；
 * - PromptCardsList：全部 11 条生成提示词（帖子/评论/楼中楼/私信/角色三件套/
 *   网名…）的完整展示 + 编辑卡片列表——嵌在「AI 规则」面板（npc-sheet.RulesSheet）
 *   里使用，可查看、修改、恢复默认：
 *   · 修改后 700ms 防抖自动保存（也可点「保存并生效」立即保存）；
 *   · 保存即生效——engine.callApi 每次生成请求都把覆盖送给服务端，
 *     后台调度器（角色发帖/互动）同样用新提示词；
 *   · 模板里的 {{占位符}} 由系统按调用现场填充（卡片展示可用占位符表）；
 *   · 卸载时自动落盘未保存的草稿，编辑不丢。
 * - v41（C5）面板增强：搜索过滤（label/desc 模糊匹配）、占位符一键插入到
 *   光标处、自定义导出/导入（JSON 剪贴板备份迁移）、已自定义卡展开时
 *   「与默认差异 N 处」行级对比 + 默认原文对照层。
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Download, Minus, Plus, RotateCcw, Search, Upload } from 'lucide-react';
import {
  FORUM_PROMPT_DEFS,
  FORUM_PROMPT_DEFAULTS,
  PROMPT_OVERRIDE_MAX_LEN,
  type PromptKey,
} from '@/lib/forum/prompt-defs';
import { activePromptOf, resetAllPrompts, resetPrompt, setPromptOverride } from '@/lib/forum/gen-settings';
import { useXTheme } from './shared';

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

// ---------------- 提示词卡片列表（嵌入「AI 规则」面板） ----------------

const AUTOSAVE_MS = 700;

export function PromptCardsList({ toast }: { toast: (text: string) => void }) {
  const t = useXTheme();
  /** 当前展开的提示词（默认全收起——上方还有三块规则，列表先给全局） */
  const [expanded, setExpanded] = useState<PromptKey | null>(null);
  /** v41（C5）：搜索过滤（匹配 label/desc，空串 = 全部） */
  const [query, setQuery] = useState('');
  /** v41（C5）：展开卡里「查看默认」对照层开关 */
  const [showDefault, setShowDefault] = useState<Record<string, boolean>>({});
  /** v41（C5）：导入粘贴框开关 + 内容 */
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
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
  /** v41（C5）：各卡 textarea 引用（占位符一键插入到光标处） */
  const taRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
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

  // v41（C5）：搜索过滤（label/desc 模糊匹配，大小写不敏感）
  const q = query.trim().toLowerCase();
  const visibleDefs = q
    ? FORUM_PROMPT_DEFS.filter((d) => `${d.label} ${d.desc}`.toLowerCase().includes(q))
    : FORUM_PROMPT_DEFS;

  /** v41（C5）：占位符一键插入到光标处（无焦点则追加末尾） */
  const insertToken = (key: PromptKey, token: string) => {
    const ph = `{{${token}}}`;
    const ta = taRefs.current[key];
    const cur = drafts[key] ?? '';
    if (!ta) {
      edit(key, cur + ph);
      return;
    }
    const s = ta.selectionStart ?? cur.length;
    const e = ta.selectionEnd ?? s;
    const next = cur.slice(0, s) + ph + cur.slice(e);
    edit(key, next);
    // 恢复光标到插入内容之后（异步等 setDrafts 后的受控 value 生效）
    window.requestAnimationFrame(() => {
      try {
        ta.focus();
        const pos = s + ph.length;
        ta.setSelectionRange(pos, pos);
      } catch {
        /* 无妨 */
      }
    });
  };

  /** v41（C5）：导出自定义（已自定义的 key → 当前生效文本；全默认时导出空对象提示） */
  const exportOverrides = async () => {
    const out: Record<string, string> = {};
    for (const d of FORUM_PROMPT_DEFS) {
      const v = applied[d.key] ?? '';
      if (v !== FORUM_PROMPT_DEFAULTS[d.key]) out[d.key] = v;
    }
    if (!Object.keys(out).length) {
      toast('没有已自定义的提示词可导出');
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(out, null, 2));
      toast(`已复制 ${Object.keys(out).length} 条自定义提示词（JSON）`);
    } catch {
      toast('剪贴板不可用，导出失败');
    }
  };

  /** v41（C5）：导入自定义（粘贴 JSON：{key: text}；未知 key 忽略、超限截断） */
  const importOverrides = () => {
    try {
      const parsed = JSON.parse(importText) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
      const valid = new Set(FORUM_PROMPT_DEFS.map((d) => d.key));
      let n = 0;
      for (const [k, v] of Object.entries(parsed)) {
        if (!valid.has(k as PromptKey) || typeof v !== 'string' || !v.trim()) continue;
        const text = v.slice(0, PROMPT_OVERRIDE_MAX_LEN);
        setPromptOverride(k as PromptKey, text);
        setDrafts((d) => ({ ...d, [k]: text }));
        setApplied((a) => ({ ...a, [k]: text }));
        n++;
      }
      if (!n) {
        toast('没有可导入的提示词（key 不认识或内容为空）');
        return;
      }
      setImportOpen(false);
      setImportText('');
      toast(`已导入 ${n} 条提示词，下次生立即生效`);
    } catch {
      toast('导入失败：不是合法的 JSON');
    }
  };

  /** v41（C5）：与默认的行级差异数（展开卡展示「与默认差异 N 处」） */
  const diffCountOf = (key: PromptKey): number => {
    const cur = (drafts[key] ?? '').split('\n');
    const def = (FORUM_PROMPT_DEFAULTS[key] ?? '').split('\n');
    let diff = Math.abs(cur.length - def.length);
    const min = Math.min(cur.length, def.length);
    for (let i = 0; i < min; i++) if (cur[i].trim() !== def[i].trim()) diff++;
    return diff;
  };

  return (
    <div>
      {/* 段头：标题 + 统计 + 导入/导出 + 全部恢复默认 */}
      <div className="mb-2 mt-1 flex items-center justify-between gap-2 px-1">
        <div className="min-w-0 leading-tight">
          <span className="text-[13px] font-bold">生成提示词</span>
          <span className="ml-[6px] text-[11px]" style={{ color: t.secondary }}>
            全部 {FORUM_PROMPT_DEFS.length} 条 · {overriddenCount} 条已自定义
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-[6px]">
          {/* v41（C5）：导出/导入（备份与迁移自定义提示词） */}
          <button
            type="button"
            onClick={() => void exportOverrides()}
            className="flex h-[28px] items-center gap-1 rounded-full px-[10px] text-[12px] font-medium active:opacity-70"
            style={{ border: `1px solid ${t.border}`, color: t.secondary }}
            aria-label="导出自定义提示词"
            title="把已自定义的提示词复制为 JSON"
          >
            <Download size={12} strokeWidth={2.2} />
            导出
          </button>
          <button
            type="button"
            onClick={() => setImportOpen((v) => !v)}
            className="flex h-[28px] items-center gap-1 rounded-full px-[10px] text-[12px] font-medium active:opacity-70"
            style={{
              border: `1px solid ${importOpen ? t.blue : t.border}`,
              color: importOpen ? t.blue : t.secondary,
            }}
            aria-label="导入自定义提示词"
            aria-expanded={importOpen}
            title="粘贴导出的 JSON 批量应用"
          >
            <Upload size={12} strokeWidth={2.2} />
            导入
          </button>
          <button
            type="button"
            onClick={resetEverything}
            className="flex h-[28px] items-center gap-1 rounded-full px-[10px] text-[12px] font-medium active:opacity-70"
            style={{
              border: `1px solid ${confirmReset ? '#e0245e' : t.border}`,
              color: confirmReset ? '#e0245e' : t.secondary,
            }}
            aria-label="全部提示词恢复默认"
          >
            <RotateCcw size={12} strokeWidth={2.2} />
            {confirmReset ? '确认恢复？' : '全部默认'}
          </button>
        </div>
      </div>

      {/* v41（C5）：导入粘贴框（展开时显示） */}
      {importOpen && (
        <div className="mb-2 rounded-2xl px-3 py-[10px]" style={{ border: `1px dashed ${t.border}` }}>
          <p className="mb-[6px] text-[11.5px] leading-snug" style={{ color: t.secondary }}>
            粘贴「导出」复制的 JSON（{`{key: 提示词文本}`}，未知 key 自动忽略）：
          </p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            spellCheck={false}
            aria-label="导入提示词 JSON 粘贴框"
            className="forum-gen-scroll w-full resize-none rounded-xl px-[10px] py-[8px] text-[12px] leading-[1.6] outline-none"
            style={{
              background: t.bg,
              color: t.text,
              border: `1px solid ${t.border}`,
              height: 96,
              caretColor: t.blue,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
            }}
          />
          <div className="mt-[6px] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setImportOpen(false);
                setImportText('');
              }}
              className="flex h-[28px] items-center rounded-full px-3 text-[12px] font-medium active:opacity-70"
              style={{ border: `1px solid ${t.border}`, color: t.secondary }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={importOverrides}
              disabled={!importText.trim()}
              className="flex h-[28px] items-center rounded-full px-4 text-[12px] font-bold text-white transition-opacity active:opacity-70 disabled:opacity-40"
              style={{ background: t.blue }}
            >
              应用导入
            </button>
          </div>
        </div>
      )}

      {/* v41（C5）：搜索框（输入即过滤卡片；清空恢复全部） */}
      <div className="mb-2 flex items-center gap-2 rounded-full px-3 py-[7px]" style={{ border: `1px solid ${t.border}` }}>
        <Search size={14} strokeWidth={2.2} style={{ color: t.secondary }} aria-hidden="true" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索提示词（如「私信」「网名」）…"
          aria-label="搜索提示词"
          className="w-full bg-transparent text-[13px] outline-none"
          style={{ color: t.text, caretColor: t.blue }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="清空搜索"
            className="shrink-0 text-[12px] active:opacity-70"
            style={{ color: t.secondary }}
          >
            清空
          </button>
        )}
      </div>
      {q && !visibleDefs.length && (
        <p className="px-2 pb-2 text-center text-[12px]" style={{ color: t.secondary }}>
          没有匹配「{query.trim()}」的提示词
        </p>
      )}

      {/* 提示词卡片列表（v41 C5：按搜索词过滤） */}
      {visibleDefs.map((def) => {
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
                {/* 可用占位符（v41 C5：点击即插入光标处） */}
                {def.tokens.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-[5px]">
                    {def.tokens.map((tk) => (
                      <button
                        key={tk.token}
                        type="button"
                        title={`${tk.desc}（点击插入到光标处）`}
                        aria-label={`插入占位符 {{${tk.token}}}：${tk.desc}`}
                        onClick={() => insertToken(def.key, tk.token)}
                        className="rounded-md px-[6px] py-[2px] text-[10.5px] font-medium transition-colors active:opacity-70"
                        style={{ background: t.border, color: t.secondary }}
                      >
                        {'{{' + tk.token + '}}'} · {tk.desc}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  value={draft}
                  onChange={(e) => edit(def.key, e.target.value)}
                  onBlur={() => saveNow(def.key)}
                  spellCheck={false}
                  aria-label={`${def.label}模板文本`}
                  ref={(el) => {
                    taRefs.current[def.key] = el;
                  }}
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
                {/* v41（C5）：与默认差异高亮——差异数徽标 + 默认原文对照层 */}
                {!isApplied && (
                  <div className="mt-[6px] flex items-center gap-2">
                    <span
                      className="rounded-full px-[6px] py-[1px] text-[10px] font-semibold"
                      style={{ background: 'rgba(29,155,240,0.12)', color: t.blue }}
                    >
                      与默认差异 {diffCountOf(def.key)} 处（行级对比）
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowDefault((s) => ({ ...s, [def.key]: !s[def.key] }))}
                      aria-expanded={!!showDefault[def.key]}
                      className="text-[10.5px] font-medium active:opacity-70"
                      style={{ color: t.secondary }}
                    >
                      {showDefault[def.key] ? '收起默认原文' : '查看默认原文对照'}
                    </button>
                  </div>
                )}
                {showDefault[def.key] && (
                  <pre
                    className="forum-gen-scroll mt-[6px] max-h-[160px] overflow-y-auto whitespace-pre-wrap rounded-xl px-[10px] py-[8px] text-[11px] leading-[1.6]"
                    style={{ background: t.hover, color: t.secondary, border: `1px dashed ${t.border}` }}
                    aria-label={`${def.label}默认模板原文`}
                  >
                    {FORUM_PROMPT_DEFAULTS[def.key]}
                  </pre>
                )}
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
      <p className="px-2 pb-2 pt-1 text-center text-[11px] leading-relaxed" style={{ color: t.secondary }}>
        模板里的 <span className="font-semibold" style={{ color: t.text }}>{'{{占位符}}'}</span>{' '}
        由系统替换成真实值；修改自动保存，下一次生成立即生效
      </p>
    </div>
  );
}
