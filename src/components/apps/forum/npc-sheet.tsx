'use client';

/**
 * X论坛 · NPC 矩阵管理 + AI 规则编辑（v36【多世界观预设与自定义规则系统】配套）。
 *
 * NpcMatrixSheet（抽屉「管理 NPC 矩阵」入口）：
 * - 管理当前世界观的核心 NPC 阵容（瓜主/营销号/粉丝站姐/路人杠精/自定义身份）；
 * - 每个 NPC 可编辑：名字、头像（头像库挑选/自动）、身份类型、性格与语气（自由填写）、
 *   专属口头禅、发帖频率（1~10）；可添加、删除、恢复出厂（内置世界观）；
 * - 保存立即生效：upsertMatrixNpc 重建作者索引（mnpc 解析用新名字/头像），
 *   下一次发帖/评论即按新【身份+性格+口头禅】生成（engine 每次都读 store）。
 *
 * RulesSheet（抽屉「修改 AI 规则」入口，v38 合开全部提示词）：
 * - 上半：论坛底层 AI 规则编辑框三块——发帖规则 / 评论规则 / 审核与过滤；
 * - 下半：全部 11 条生成提示词（PromptCardsList）——完整展示、可改可恢复默认；
 * - 规则拼接在所有生成提示词的 System Prompt 最前端（最高优先级）；
 * - 提示词修改 700ms 防抖自动保存，均保存即生效，下一次生成立即用新词。
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Minus, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  subscribeWorldview,
  worldviewSnapshot,
  resetAiRules,
  resetMatrix,
  removeMatrixNpc,
  setAiRules,
  upsertMatrixNpc,
  type MatrixNpcDraft,
} from '@/lib/forum/worldview-store';
import { AI_RULES_MAX_LEN, NPC_ROLES, roleDefOf, type MatrixNpc, type NpcRoleId } from '@/lib/forum/worldview';
import { FORUM_PROMPT_DEFS } from '@/lib/forum/prompt-defs';
import { countPromptOverrides } from '@/lib/forum/gen-settings';
import { PromptCardsList } from './prompt-sheet';
import { VerifiedBadge, WorldviewIcon, XIcons, useXTheme } from './shared';

// ---------------- 头像候选（头像库精选 + 自动） ----------------

/** 精选头像（avatar-library 各风格几张；null = 系统按账号稳定分配） */
const AVATAR_CHOICES: (string | null)[] = [
  null,
  '/avatar-library/anime/anime_007.jpg',
  '/avatar-library/anime/anime_031.jpg',
  '/avatar-library/anime/anime_052.jpg',
  '/avatar-library/anime/anime_078.jpg',
  '/avatar-library/catdog/catdog_012.jpg',
  '/avatar-library/catdog/catdog_025.jpg',
  '/avatar-library/catdog/catdog_047.jpg',
  '/avatar-library/catdog/catdog_088.jpg',
  '/avatar-library/abstract/abstract_003.jpg',
  '/avatar-library/abstract/abstract_019.jpg',
  '/avatar-library/abstract/abstract_041.jpg',
  '/avatar-library/abstract/abstract_066.jpg',
  '/avatar-library/abstract/abstract_090.jpg',
  '/avatar-library/female/female_023.jpg',
  '/avatar-library/female/female_041.jpg',
  '/avatar-library/female/female_066.jpg',
  '/avatar-library/male/male_008.jpg',
  '/avatar-library/male/male_012.jpg',
  '/avatar-library/male/male_033.jpg',
  '/avatar-library/male/male_055.jpg',
  '/avatar-library/male/male_070.jpg',
  '/avatar-library/real/real_014.jpg',
  '/avatar-library/real/real_042.jpg',
];

interface SheetProps {
  onClose: () => void;
  toast: (text: string) => void;
}

// ---------------- NPC 矩阵面板 ----------------

/** 编辑器草稿（新建 = 空 id；编辑 = 预填） */
interface NpcFormDraft {
  name: string;
  roleId: NpcRoleId;
  roleLabel: string;
  personaText: string;
  catchphrase: string;
  postFreq: number;
  avatar: string | null;
}

function draftOf(npc?: MatrixNpc): NpcFormDraft {
  return {
    name: npc?.name ?? '',
    roleId: npc?.roleId ?? 'passerby',
    roleLabel: npc?.roleLabel ?? '',
    personaText: npc?.personaText ?? '',
    catchphrase: npc?.catchphrase ?? '',
    postFreq: npc?.postFreq ?? 5,
    avatar: npc?.avatar ?? null,
  };
}

export function NpcMatrixSheet({ onClose, toast }: SheetProps) {
  const t = useXTheme();
  const snap = useSyncExternalStore(subscribeWorldview, worldviewSnapshot);
  const wv = snap.worldviews.find((w) => w.id === snap.activeId) ?? null;
  const matrix = wv?.matrix ?? [];

  /** 展开编辑的 NPC id（'__new__' = 新建） */
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState<NpcFormDraft>(() => draftOf());
  /** 删除两段确认 */
  const [delArm, setDelArm] = useState('');
  /** 恢复出厂两段确认 */
  const [resetArm, setResetArm] = useState(false);

  const startNew = () => {
    setEditingId('__new__');
    setDraft(draftOf());
  };
  const startEdit = (npc: MatrixNpc) => {
    setEditingId(editingId === npc.id ? '' : npc.id);
    setDraft(draftOf(npc));
    setDelArm('');
  };

  const save = () => {
    if (!wv) return;
    if (!draft.name.trim()) {
      toast('名字不能为空');
      return;
    }
    if (!draft.personaText.trim()) {
      toast('性格与语气不能为空——这是 NPC 的灵魂');
      return;
    }
    const payload: MatrixNpcDraft = {
      name: draft.name,
      roleId: draft.roleId,
      roleLabel: draft.roleLabel,
      personaText: draft.personaText,
      catchphrase: draft.catchphrase,
      postFreq: draft.postFreq,
      avatar: draft.avatar,
    };
    const npcId = editingId === '__new__' ? undefined : editingId;
    const ok = upsertMatrixNpc(wv.id, payload, npcId);
    if (ok) {
      setEditingId('');
      toast(npcId ? '已保存，下一次生成即用新身份' : 'NPC 已加入阵容，下一次生成即出场');
    } else {
      toast('保存失败，请重试');
    }
  };

  const bumpFreq = (d: number) => {
    setDraft((f) => ({ ...f, postFreq: Math.min(Math.max(f.postFreq + d, 1), 10) }));
  };

  return (
    <div className="absolute inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="NPC 矩阵管理">
      <div className="flex h-full flex-col animate-[forum-sheet_.26s_ease-out]" style={{ background: t.bg, color: t.text }}>
        {/* 顶行：返回 | 标题 | 恢复出厂（内置）/新建 */}
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
            <span className="text-[17px] font-bold">NPC 矩阵</span>
            {wv ? (
              <span className="flex max-w-[190px] items-center gap-[5px] text-[11px]" style={{ color: t.secondary }}>
                <WorldviewIcon id={wv.id} name={wv.name} size={15} />
                <span className="truncate">
                  {wv.name} · {matrix.length} 位核心 NPC
                </span>
              </span>
            ) : (
              <span className="max-w-[180px] truncate text-[11px]" style={{ color: t.secondary }}>
                未激活世界观
              </span>
            )}
          </div>
          {wv?.builtin ? (
            <button
              type="button"
              onClick={() => {
                if (!resetArm) {
                  setResetArm(true);
                  window.setTimeout(() => setResetArm(false), 3000);
                  return;
                }
                setResetArm(false);
                if (resetMatrix(wv.id)) toast('已恢复出厂阵容');
              }}
              className="flex h-[32px] shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium active:opacity-70"
              style={{ border: `1px solid ${resetArm ? '#e0245e' : t.border}`, color: resetArm ? '#e0245e' : t.text }}
              aria-label="恢复出厂阵容"
            >
              <RotateCcw size={13} strokeWidth={2.2} />
              {resetArm ? '确认？' : '出厂'}
            </button>
          ) : (
            <span className="w-[32px]" />
          )}
        </div>

        {/* 说明条 */}
        <div className="shrink-0 px-4 pb-2 text-[11.5px] leading-relaxed" style={{ color: t.secondary }}>
          发帖和评论时，AI 会强制读取每位 NPC 的【身份】和【性格】——改完立即生效。
          发帖频率越高，这位 NPC 在信息流和评论区越活跃。
        </div>

        {/* NPC 列表 */}
        <div className="forum-gen-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-[28px]">
          {matrix.length === 0 && (
            <div className="mt-6 rounded-2xl px-4 py-6 text-center text-[13px] leading-relaxed" style={{ border: `1px dashed ${t.border}`, color: t.secondary }}>
              这个世界观还没有核心 NPC。
              <br />
              点下方「添加 NPC」给TA起个名字、定个身份和性格。
            </div>
          )}
          {matrix.map((npc) => {
            const editing = editingId === npc.id;
            const role = roleDefOf(npc.roleId);
            const roleLabel = npc.roleId === 'custom' ? npc.roleLabel?.trim() || '自定义身份' : role.label;
            return (
              <div
                key={npc.id}
                className="mb-2 overflow-hidden rounded-2xl"
                style={{ border: `1px solid ${editing ? t.blue : t.border}`, background: editing ? t.hover : 'transparent' }}
              >
                {/* 卡头：头像 + 名字/身份/性格摘要 + 频率 */}
                <button
                  type="button"
                  aria-label={`编辑 NPC：${npc.name}`}
                  aria-expanded={editing}
                  onClick={() => startEdit(npc)}
                  className="flex w-full items-center gap-3 px-3 py-[10px] text-left transition-colors active:opacity-70"
                >
                  {npc.avatar ? (
                    
                    <img src={npc.avatar} alt="" className="h-[42px] w-[42px] shrink-0 rounded-full object-cover" style={{ background: t.border }} />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-[16px] font-bold"
                      style={{ background: t.border, color: t.text }}
                    >
                      {npc.name.slice(0, 1)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-[6px]">
                      <span className="truncate text-[15px] font-semibold">{npc.name}</span>
                      {npc.verified && (
                        <span aria-hidden="true" className="shrink-0" style={{ color: t.blue }}>
                          <VerifiedBadge size={13} />
                        </span>
                      )}
                    </div>
                    <span className="mt-[1px] block truncate text-[11.5px]" style={{ color: t.secondary }}>
                      {roleLabel}
                      {npc.catchphrase ? ` · 「${npc.catchphrase}」` : ''}
                    </span>
                    <span className="mt-[3px] block truncate text-[11px]" style={{ color: t.secondary }}>
                      发帖频率 {npc.postFreq}/10 · {npc.personaText || '（未设性格）'}
                    </span>
                  </div>
                  <span aria-hidden="true" className="shrink-0 text-[13px]" style={{ color: t.secondary }}>
                    ›
                  </span>
                </button>

                {/* 编辑表单 */}
                {editing && (
                  <div className="border-t px-3 pb-3 pt-[10px]" style={{ borderColor: t.border }}>
                    <NpcForm
                      draft={draft}
                      setDraft={setDraft}
                      bumpFreq={bumpFreq}
                      onSave={save}
                      onDelete={() => {
                        if (!wv) return;
                        if (delArm !== npc.id) {
                          setDelArm(npc.id);
                          window.setTimeout(() => setDelArm(''), 3000);
                          return;
                        }
                        setDelArm('');
                        if (removeMatrixNpc(wv.id, npc.id)) {
                          setEditingId('');
                          toast(`「${npc.name}」已移出阵容`);
                        }
                      }}
                      delArmed={delArm === npc.id}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {/* 新建表单（置顶展开） */}
          {editingId === '__new__' && (
            <div className="mb-2 overflow-hidden rounded-2xl" style={{ border: `1px solid ${t.blue}`, background: t.hover }}>
              <div className="px-3 pt-[10px] pb-[10px]">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[14px] font-bold">添加 NPC</span>
                  <span className="text-[11px]" style={{ color: t.secondary }}>
                    身份 + 性格 + 口头禅
                  </span>
                </div>
                <NpcForm draft={draft} setDraft={setDraft} bumpFreq={bumpFreq} onSave={save} onDelete={() => setEditingId('')} delArmed={false} isNew />
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={startNew}
            className="mt-1 flex w-full items-center justify-center gap-1 rounded-2xl border-dashed py-[12px] text-[14px] font-semibold active:opacity-70"
            style={{ border: `1.5px dashed ${t.border}`, color: t.blue }}
            aria-label="添加 NPC"
          >
            <Plus size={15} strokeWidth={2.4} />
            添加 NPC
          </button>
          <p className="px-2 pb-2 pt-3 text-center text-[11px] leading-relaxed" style={{ color: t.secondary }}>
            点 NPC 卡片编辑；阵容改动立即写入作者索引（头像/名字即时更新）
          </p>
        </div>
      </div>
    </div>
  );
}

/** NPC 编辑表单（新建/编辑共用） */
function NpcForm({
  draft,
  setDraft,
  bumpFreq,
  onSave,
  onDelete,
  delArmed,
  isNew,
}: {
  draft: NpcFormDraft;
  setDraft: React.Dispatch<React.SetStateAction<NpcFormDraft>>;
  bumpFreq: (d: number) => void;
  onSave: () => void;
  onDelete: () => void;
  delArmed: boolean;
  isNew?: boolean;
}) {
  const t = useXTheme();
  return (
    <div className="flex flex-col gap-2">
      {/* 名字 */}
      <input
        value={draft.name}
        onChange={(e) => setDraft((f) => ({ ...f, name: e.target.value.slice(0, 16) }))}
        placeholder="名字（如：懂瓜呱）"
        aria-label="NPC 名字"
        className="h-[38px] w-full rounded-xl px-[10px] text-[14px] outline-none"
        style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text, caretColor: t.blue }}
      />
      {/* 身份类型 */}
      <div className="flex flex-wrap gap-[5px]">
        {NPC_ROLES.map((r) => {
          const on = draft.roleId === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setDraft((f) => ({ ...f, roleId: r.id }))}
              title={r.desc}
              aria-pressed={on}
              className="rounded-full px-[9px] py-[4px] text-[11.5px] font-medium transition-colors active:opacity-70"
              style={
                on
                  ? { background: t.blue, color: '#fff' }
                  : { background: t.border, color: t.secondary }
              }
            >
              {r.label}
            </button>
          );
        })}
      </div>
      {draft.roleId === 'custom' && (
        <input
          value={draft.roleLabel}
          onChange={(e) => setDraft((f) => ({ ...f, roleLabel: e.target.value.slice(0, 16) }))}
          placeholder="自定义身份名（如：表白墙墙主）"
          aria-label="自定义身份名"
          className="h-[34px] w-full rounded-xl px-[10px] text-[13px] outline-none"
          style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text, caretColor: t.blue }}
        />
      )}
      {/* 性格与语气 */}
      <textarea
        value={draft.personaText}
        onChange={(e) => setDraft((f) => ({ ...f, personaText: e.target.value.slice(0, 400) }))}
        placeholder="性格与语气（自由发挥，如：暴躁老哥，说话必带脏字；绿茶白莲花，喜欢装无辜）"
        aria-label="性格与语气"
        spellCheck={false}
        className="forum-gen-scroll w-full resize-none rounded-xl px-[10px] py-[8px] text-[12.5px] leading-[1.6] outline-none"
        style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text, height: 84, caretColor: t.blue }}
      />
      {/* 口头禅 + 发帖频率 */}
      <input
        value={draft.catchphrase}
        onChange={(e) => setDraft((f) => ({ ...f, catchphrase: e.target.value.slice(0, 60) }))}
        placeholder="专属口头禅（如：蹲一个后续）"
        aria-label="专属口头禅"
        className="h-[36px] w-full rounded-xl px-[10px] text-[13px] outline-none"
        style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text, caretColor: t.blue }}
      />
      <div className="flex items-center gap-2 rounded-xl px-3 py-[8px]" style={{ background: t.bg, border: `1px solid ${t.border}` }}>
        <span className="text-[13px] font-medium">发帖频率</span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="发帖频率减一"
          onClick={() => bumpFreq(-1)}
          className="flex h-[28px] w-[28px] items-center justify-center rounded-full transition-transform active:scale-90"
          style={{ border: `1px solid ${t.border}`, color: t.text }}
        >
          <Minus size={13} strokeWidth={2.4} />
        </button>
        <span className="w-[26px] text-center text-[15px] font-bold tabular-nums">{draft.postFreq}</span>
        <button
          type="button"
          aria-label="发帖频率加一"
          onClick={() => bumpFreq(1)}
          className="flex h-[28px] w-[28px] items-center justify-center rounded-full transition-transform active:scale-90"
          style={{ border: `1px solid ${t.border}`, color: t.text }}
        >
          <Plus size={13} strokeWidth={2.4} />
        </button>
      </div>
      {/* 头像挑选 */}
      <div>
        <span className="mb-[6px] block text-[11.5px] font-medium" style={{ color: t.secondary }}>
          头像（点选；第一格 = 自动分配）
        </span>
        <div className="forum-gen-scroll flex max-h-[104px] flex-wrap gap-[6px] overflow-y-auto">
          {AVATAR_CHOICES.map((a) => {
            const on = draft.avatar === a || (a === null && draft.avatar == null);
            return (
              <button
                key={a ?? 'auto'}
                type="button"
                onClick={() => setDraft((f) => ({ ...f, avatar: a }))}
                aria-label={a ? '选择头像' : '自动分配头像'}
                aria-pressed={on}
                className="relative h-[44px] w-[44px] shrink-0 overflow-hidden rounded-full transition-transform active:scale-90"
                style={{ border: on ? `2px solid ${t.blue}` : `1px solid ${t.border}` }}
              >
                {a ? (
                  
                  <img src={a} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold" style={{ background: t.border, color: t.secondary }}>
                    自动
                  </span>
                )}
                {on && (
                  <span className="absolute bottom-0 right-0 flex h-[14px] w-[14px] items-center justify-center rounded-full" style={{ background: t.blue }}>
                    <Check size={9} strokeWidth={3.5} color="#fff" aria-hidden="true" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {/* 操作行 */}
      <div className="mt-[2px] flex items-center gap-2">
        <span className="mr-auto text-[10.5px] tabular-nums" style={{ color: t.secondary }}>
          性格 {draft.personaText.length}/400
        </span>
        {!isNew && (
          <button
            type="button"
            onClick={onDelete}
            className="flex h-[28px] items-center gap-1 rounded-full px-3 text-[12px] font-medium active:opacity-70"
            style={{ border: `1px solid ${delArmed ? '#e0245e' : t.border}`, color: delArmed ? '#e0245e' : t.secondary }}
            aria-label="删除 NPC"
          >
            <Trash2 size={12} strokeWidth={2.2} />
            {delArmed ? '确认删除？' : '删除'}
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          className="flex h-[28px] items-center gap-1 rounded-full px-4 text-[12px] font-bold text-white active:opacity-70"
          style={{ background: t.blue }}
          aria-label="保存 NPC"
        >
          <Check size={12} strokeWidth={3} />
          保存并生效
        </button>
      </div>
    </div>
  );
}

// ---------------- AI 规则面板 ----------------

const RULE_SECTIONS: { key: 'postRules' | 'commentRules' | 'filterRules'; label: string; desc: string; hint: string }[] = [
  {
    key: 'postRules',
    label: '发帖规则',
    desc: '管 AI 怎么发帖',
    hint: '例：禁止发任何关于工作的帖子，只能发娱乐内容',
  },
  {
    key: 'commentRules',
    label: '评论规则',
    desc: '管评论区的氛围',
    hint: '例：评论区必须充满戾气，不准出现友善的评论',
  },
  {
    key: 'filterRules',
    label: '审核与过滤',
    desc: '管什么内容禁止出现',
    hint: '例：禁止出现真实明星大名，必须用代号代替',
  },
];

export function RulesSheet({ onClose, toast }: SheetProps) {
  const t = useXTheme();
  const snap = useSyncExternalStore(subscribeWorldview, worldviewSnapshot);
  /** 已自定义提示词条数（面板打开时读一次；提示词卡片自己保存，不实时刷） */
  const [promptOv, setPromptOv] = useState(() => countPromptOverrides());
  const [drafts, setDrafts] = useState({
    postRules: snap.rules.postRules,
    commentRules: snap.rules.commentRules,
    filterRules: snap.rules.filterRules,
  });
  const [savedFlash, setSavedFlash] = useState(0);
  const timer = useRef<number>(0);
  const flashTimer = useRef<number>(0);
  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  const apply = (next: typeof drafts) => {
    setAiRules(next);
    setSavedFlash(Date.now());
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSavedFlash(0), 2400);
  };

  const edit = (key: keyof typeof drafts, text: string) => {
    const sliced = text.slice(0, AI_RULES_MAX_LEN);
    setDrafts((d) => ({ ...d, [key]: sliced }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => apply(draftsRef.current), 700);
  };

  // 卸载：落盘未保存草稿
  useEffect(() => {
    return () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(flashTimer.current);
      const cur = draftsRef.current;
      if (cur.postRules !== snap.rules.postRules || cur.commentRules !== snap.rules.commentRules || cur.filterRules !== snap.rules.filterRules) {
        setAiRules(cur);
      }
    };

  }, []);

  const customized = RULE_SECTIONS.filter((s) => drafts[s.key].trim()).length;
  const justSaved = savedFlash && Date.now() - savedFlash < 2400;

  return (
    <div className="absolute inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="AI 规则与提示词编辑">
      <div className="flex h-full flex-col animate-[forum-sheet_.26s_ease-out]" style={{ background: t.bg, color: t.text }}>
        {/* 顶行 */}
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-[54px]" style={{ height: 100 }}>
          <button
            type="button"
            aria-label="关闭并返回"
            onClick={() => {
              setPromptOv(countPromptOverrides());
              onClose();
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
            style={{ color: t.text }}
          >
            {XIcons.back(22)}
          </button>
          <div className="flex min-w-0 flex-col items-center">
            <span className="text-[17px] font-bold">AI 规则</span>
            <span className="text-[11px]" style={{ color: t.secondary }}>
              3 条底层规则 + {FORUM_PROMPT_DEFS.length} 条提示词{promptOv + customized > 0 ? ` · ${promptOv + customized} 条已自定义` : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setDrafts({ postRules: '', commentRules: '', filterRules: '' });
              resetAiRules();
              toast('三条底层规则已清空');
            }}
            className="flex h-[32px] shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium active:opacity-70"
            style={{ border: `1px solid ${t.border}`, color: t.secondary }}
            aria-label="清空全部底层规则"
          >
            <RotateCcw size={13} strokeWidth={2.2} />
            清空规则
          </button>
        </div>

        {/* 说明条 */}
        <div className="shrink-0 px-4 pb-2 text-[11.5px] leading-relaxed" style={{ color: t.secondary }}>
          底层规则拼接在所有生成提示词的 <span style={{ color: t.text, fontWeight: 600 }}>System Prompt 最前端</span>（最高优先级）；下面还能直接查看、修改全部
          {FORUM_PROMPT_DEFS.length} 条生成提示词——发帖、评论、回复、私信的完整模板，修改后下一次生成立即生效。
        </div>

        {/* 上半：三条底层规则 + 下半：全部生成提示词（同一滚动区） */}
        <div className="forum-gen-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-[28px]">
          {/* 段头：底层规则 */}
          <div className="mb-2 mt-1 flex items-center justify-between px-1">
            <div className="min-w-0 leading-tight">
              <span className="text-[13px] font-bold">底层规则</span>
              <span className="ml-[6px] text-[11px]" style={{ color: t.secondary }}>
                {customized} 条自定义 · 拼在提示词最前端
              </span>
            </div>
          </div>
          {RULE_SECTIONS.map((s) => (
            <div key={s.key} className="mb-2 rounded-2xl p-3" style={{ border: `1px solid ${drafts[s.key].trim() ? t.blue : t.border}`, background: drafts[s.key].trim() ? t.hover : 'transparent' }}>
              <div className="mb-[6px] flex items-center gap-[6px]">
                <span className="text-[15px] font-semibold">{s.label}</span>
                <span className="text-[11.5px]" style={{ color: t.secondary }}>
                  {s.desc}
                </span>
                {drafts[s.key].trim() && (
                  <span className="shrink-0 rounded-full px-[6px] py-[1px] text-[10px] font-semibold" style={{ background: 'rgba(29,155,240,0.14)', color: t.blue }}>
                    已自定义
                  </span>
                )}
              </div>
              <textarea
                value={drafts[s.key]}
                onChange={(e) => edit(s.key, e.target.value)}
                placeholder={s.hint}
                aria-label={`${s.label}编辑框`}
                spellCheck={false}
                className="forum-gen-scroll w-full resize-none rounded-xl px-[10px] py-[8px] text-[12.5px] leading-[1.6] outline-none"
                style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text, height: 92, caretColor: t.blue }}
              />
              <div className="mt-[6px] flex items-center gap-2">
                <span className="text-[10.5px] tabular-nums" style={{ color: t.secondary }}>
                  {drafts[s.key].length} 字
                </span>
                {justSaved && (
                  <span className="flex items-center gap-[3px] text-[10.5px] font-medium" style={{ color: '#00ba7c' }}>
                    <Check size={11} strokeWidth={3} />
                    已保存 · 下次生成即生效
                  </span>
                )}
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => {
                    window.clearTimeout(timer.current);
                    apply(draftsRef.current);
                    toast('已保存，下一次生成立即生效');
                  }}
                  className="flex h-[28px] items-center rounded-full px-4 text-[12px] font-bold text-white active:opacity-70"
                  style={{ background: t.blue }}
                  aria-label={`保存${s.label}`}
                >
                  保存并生效
                </button>
              </div>
            </div>
          ))}
          <p className="px-2 pb-2 pt-1 text-center text-[11px] leading-relaxed" style={{ color: t.secondary }}>
            留空的规则不注入（零开销）；空格/换行会被保留
          </p>

          {/* 下半：全部生成提示词（v38 合入：完整展示可改可恢复默认） */}
          <div className="mb-2 mt-3 border-t pt-3" style={{ borderColor: t.border }}>
            <PromptCardsList toast={toast} />
          </div>
        </div>
      </div>
    </div>
  );
}
