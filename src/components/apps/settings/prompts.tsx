'use client';

// 默认预设（提示词条目）页 PromptEntriesPage（内置条目 + 全局预设管理器）。

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  Check,
  ChevronDown,
  Minus,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import { Input } from '@/components/ui/input';

import { Textarea } from '@/components/ui/textarea';

import { Switch } from '@/components/ui/switch';

import {
  LocalToast,
  useLocalToast,
} from '../page-toast';

import { PresetAppPanels } from '../settings-preset-library';

import {
  PROMPT_APPS,
  PROMPT_GROUPS,
  resolvePromptEntries,
  type PromptAppId,
  type PromptEntry,
  type PromptGroup,
  type PromptRole,
} from '@/lib/prompt-entries';

import {
  addPromptEntry,
  deletePromptEntry,
  ensurePromptEntriesClientReady,
  readPromptEntryState,
  resetAllPromptEntries,
  resetPromptEntry,
  setPromptEntriesEnabled,
  setPromptEntryDepth,
  setPromptEntryEnabled,
  setPromptEntryText,
} from '@/lib/ios/prompt-entries-client';

import {
  activePromptOf,
  setPromptOverride,
} from '@/lib/forum/gen-settings';

import type { PromptKey } from '@/lib/forum/prompt-defs';

import { DetailShell } from './shared';


// ---------------- 默认预设（内置）· 全局预设管理器（v63） ----------------

/** 论坛条目内容展示（论坛设置面板同源：覆盖优先、默认兜底） */
export function entryContentOf(e: PromptEntry, disabled: Set<string>): string {
  if (e.appId === 'forum') {
    try {
      return activePromptOf(e.id.replace(/^forum-/, '') as PromptKey);
    } catch {
      return e.content;
    }
  }
  return e.content;
}

/** v69：组卡放进 App 面板后，组标题（与 App 同名）改为功能性描述，避免「微信面板里一张微信卡」的重复感 */
export const GROUP_PANEL_TITLE: Record<string, string> = {
  'persona-core': '核心角色人设（整块）',
  'wx-rules': '聊天规则（整块）',
  'qq-rules': '聊天规则（整块）',
  'sms-rules': '短信规则（整块）',
  'call-rules': '通话规则（整块）',
  forum: '生成场景提示词',
  couple: '小天地与心情注入',
  offline: '线下剧情指令',
  moments: '发帖与评论规则',
  behavior: '行为与节奏控制',
  worldbook: '世界书使用规则（整块）',
  memory: '记忆提取与召回',
};
export const panelTitleOf = (g: PromptGroup) => GROUP_PANEL_TITLE[g.id] ?? g.title;

export function PromptEntriesPage({ onBack }: { onBack: () => void }) {
  const [toastMsg, showToast] = useLocalToast();
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // 挂载兜底注册（PhoneShell 已注册时幂等）
  useEffect(() => {
    ensurePromptEntriesClientReady();
  }, []);

  // 展开的组（merged 大卡 / list 组）
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  // list 组里展开的成员（成员条目 id）
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  // 多选模式与已选组
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 草稿（组 id 或成员 id → 编辑中文本）
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // 新增表单
  const [adding, setAdding] = useState(false);
  // v69：新增自定义条目后自动展开对应 App 面板（nonce 递增触发 PresetAppPanels 内的 effect）
  const [openAppRequest, setOpenAppRequest] = useState<{ appId: string; nonce: number } | null>(null);
  const [addForm, setAddForm] = useState<{ appId: PromptAppId; role: PromptRole; depth: string; title: string; content: string }>({
    appId: 'wechat',
    role: 'system',
    depth: '50',
    title: '',
    content: '',
  });

  const state = readPromptEntryState();
  const disabled = useMemo(() => new Set(state.disabled), [state.disabled, state.disabled.length]);
  const entryMap = useMemo(() => {
    const m = new Map<string, PromptEntry>();
    for (const e of resolvePromptEntries()) m.set(e.id, e);
    return m;
  }, [state.rev, state.disabled.length]);
  const customEntries = useMemo(
    () => state.custom.filter((c) => !state.deleted.includes(c.id)),
    [state.custom, state.deleted, state.deleted.length],
  );

  /** v69：自定义条目按 App 归堆——每个 App 一张「自定义条目」组卡（随该 App 面板展示），
   *  替代旧版「全部自定义挤一张卡」；组 id 形如 custom-wechat，避开内置组 id */
  const customGroups = useMemo(() => {
    const byApp = new Map<string, PromptGroup>();
    for (const c of customEntries) {
      const g = byApp.get(c.appId) ?? {
        id: `custom-${c.appId}`,
        appId: c.appId,
        kind: 'list' as const,
        title: '自定义条目',
        desc: '',
        members: [] as string[],
      };
      g.members.push(c.id);
      byApp.set(c.appId, g);
    }
    return byApp;
  }, [customEntries]);
  /** 组查找统一源：内置 PROMPT_GROUPS + 按 App 合成的自定义组（旧逻辑查不到合成组会退化为「全部自定义」） */
  const allGroups = useMemo(() => [...PROMPT_GROUPS, ...customGroups.values()], [customGroups]);

  /** 组 → 开关实际写的目标 id 列表（merged = 组 id 本身；list = 全体成员；查不到 = 空） */
  const groupTargetIds = useCallback(
    (gid: string): string[] => {
      const g = allGroups.find((x) => x.id === gid);
      if (g) return g.kind === 'merged' ? [g.id] : g.members;
      return [];
    },
    [allGroups],
  );

  /** 组开关当前态（merged = 组未被关；list/自定义 = 任一成员开启即算开） */
  const groupOn = (gid: string): boolean => {
    const ids = groupTargetIds(gid);
    return !ids.every((id) => disabled.has(id));
  };

  const toggleGroup = (gid: string, on: boolean) => {
    setPromptEntriesEnabled(groupTargetIds(gid), on);
    refresh();
    const g = allGroups.find((x) => x.id === gid);
    const label = g ? panelTitleOf(g) : '自定义条目';
    showToast(on ? `${label}已启用，下次发送即生效` : `${label}已关闭，整块不再注入`);
  };

  /** 组深度 = 首成员当前生效深度；加减时全成员统一拉到同一深度（保持注入顺序稳定）。
   *  v66 修正：深度目标一律取组成员（merged 组此前误用组 id——组 id 不是条目，
   *  entryMap 永远查不到，深度加减成了不刷新的摆设；启停仍走 groupTargetIds 的组 id/成员） */
  const groupDepthIds = (gid: string): string[] => {
    const g = allGroups.find((x) => x.id === gid);
    return g ? g.members : [];
  };
  const groupDepth = (gid: string): number => {
    const ids = groupDepthIds(gid);
    return entryMap.get(ids[0])?.depth ?? 50;
  };
  const changeGroupDepth = (gid: string, delta: number) => {
    const ids = groupDepthIds(gid);
    if (ids.length === 0) return;
    const next = Math.max(0, Math.min(999, groupDepth(gid) + delta));
    for (const id of ids) setPromptEntryDepth(id, next);
    refresh();
  };

  // ---- merged 组：大文本框保存 / 恢复 ----
  const saveGroupDraft = (g: PromptGroup) => {
    const text = drafts[g.id] ?? '';
    setPromptEntryText(g.id, text);
    setDrafts((d) => {
      const next = { ...d };
      delete next[g.id];
      return next;
    });
    refresh();
    showToast('已保存，下次发送即生效');
  };
  const resetGroup = (g: PromptGroup) => {
    resetPromptEntry(g.id);
    setDrafts((d) => {
      const next = { ...d };
      delete next[g.id];
      return next;
    });
    refresh();
    showToast('已恢复内置默认');
  };

  // ---- list 组成员：单条保存 / 恢复（论坛写回论坛设置面板） ----
  const saveMemberDraft = (e: PromptEntry) => {
    const text = drafts[e.id] ?? '';
    if (e.appId === 'forum') {
      try {
        setPromptOverride(e.id.replace(/^forum-/, '') as PromptKey, text);
      } catch {
        /* 忽略 */
      }
    } else {
      setPromptEntryText(e.id, text);
    }
    setDrafts((d) => {
      const next = { ...d };
      delete next[e.id];
      return next;
    });
    refresh();
    showToast('已保存，下次发送即生效');
  };
  const resetMember = (e: PromptEntry) => {
    if (e.appId === 'forum') {
      try {
        setPromptOverride(e.id.replace(/^forum-/, '') as PromptKey, '');
      } catch {
        /* 忽略 */
      }
    }
    resetPromptEntry(e.id);
    setDrafts((d) => {
      const next = { ...d };
      delete next[e.id];
      return next;
    });
    refresh();
    showToast('已恢复内置默认');
  };
  const changeMemberDepth = (e: PromptEntry, delta: number) => {
    setPromptEntryDepth(e.id, e.depth + delta);
    refresh();
  };

  const submitAdd = () => {
    const r = addPromptEntry({
      appId: addForm.appId,
      role: addForm.role,
      depth: Number(addForm.depth) || 50,
      title: addForm.title,
      content: addForm.content,
    });
    if (!r.created) {
      showToast('标题与内容不能为空');
      return;
    }
    setAddForm({ appId: addForm.appId, role: addForm.role, depth: addForm.depth, title: '', content: '' });
    setAdding(false);
    // v69：新条目落在对应 App 面板内——自动展开该面板并展开其自定义组，让用户立刻看到
    setExpandedGroup(`custom-${addForm.appId}`);
    setOpenAppRequest((cur) => ({ appId: addForm.appId, nonce: (cur?.nonce ?? 0) + 1 }));
    refresh();
    showToast('已新增预设条目');
  };

  const batchEnable = (on: boolean) => {
    for (const gid of selected) setPromptEntriesEnabled(groupTargetIds(gid), on);
    setSelected(new Set());
    setSelectMode(false);
    refresh();
    showToast(on ? `已批量启用 ${selected.size} 组` : `已批量关闭 ${selected.size} 组`);
  };
  const batchDelete = () => {
    for (const gid of selected) for (const id of groupTargetIds(gid)) deletePromptEntry(id);
    setSelected(new Set());
    setSelectMode(false);
    refresh();
    showToast(`已删除/关闭 ${selected.size} 组`);
  };
  const toggleSelect = (gid: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  };

  const selCount = selected.size;

  /** v70：深度调节胶囊（组展开区内右对齐；取代旧版收起态常驻的深度行） */
  const renderDepthControl = (key: string, spacer: boolean) => (
    <span className={`${spacer ? '' : 'ml-auto'} flex items-center gap-1 rounded-full bg-black/[0.045] px-1.5 py-[3px] text-[10px] text-zinc-500`}>
      <span className="pl-1">深度</span>
      <button
        type="button"
        aria-label="减小注入深度"
        onClick={() => changeGroupDepth(key, -1)}
        className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white ring-1 ring-black/[0.06] active:scale-90"
      >
        <Minus className="h-2.5 w-2.5" />
      </button>
      <span className="w-5 text-center text-[10.5px] font-semibold tabular-nums" data-testid={`prompt-group-depth-${key}`}>
        {groupDepth(key)}
      </span>
      <button
        type="button"
        aria-label="增大注入深度"
        onClick={() => changeGroupDepth(key, 1)}
        className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white ring-1 ring-black/[0.06] active:scale-90"
      >
        <Plus className="h-2.5 w-2.5" />
      </button>
    </span>
  );

  // 渲染一个 list 组的成员行（内置组与自定义组共用）
  // v70 简约提速：实底白卡，去 blur / transition-all
  const renderMember = (e: PromptEntry, groupKey: string) => {
    const off = disabled.has(e.id);
    const open = expandedMember === e.id;
    const draft = drafts[e.id];
    const editing = draft !== undefined;
    const content = entryContentOf(e, disabled);
    return (
      <div
        key={e.id}
        data-testid={`prompt-entry-${e.id}`}
        className={`overflow-hidden bg-white ring-1 ring-black/[0.05] ${
          open ? 'rounded-[14px]' : 'rounded-full'
        } ${off ? 'opacity-55' : ''}`}
      >
        <div className="flex items-center gap-2 px-3 py-[7px]">
          <button
            type="button"
            onClick={() => setExpandedMember(open ? null : e.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            aria-expanded={open}
          >
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{e.title}</span>
          </button>
          <Switch
            checked={!off}
            onCheckedChange={(v) => {
              setPromptEntryEnabled(e.id, v);
              refresh();
              showToast(v ? '已启用，下次发送即生效' : '已禁用，该条不再注入');
            }}
            aria-label={`启用 ${e.title}`}
          />
          {/* v68.1 统一：箭头移到右侧 */}
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-zinc-500/60 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
        {open && (
          <div className="border-t border-black/[0.05] px-3 py-2.5">
            <Textarea
              value={editing ? draft : content}
              onChange={(ev) => setDrafts((d) => ({ ...d, [e.id]: ev.target.value }))}
              className="min-h-36 rounded-[12px] border-0 bg-white font-mono text-[11px] leading-relaxed ring-1 ring-black/[0.05] focus-visible:ring-2 focus-visible:ring-[#007AFF]/40"
              data-testid={`prompt-text-${e.id}`}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => saveMemberDraft(e)}
                disabled={!editing}
                className="rounded-full bg-[#007AFF] px-4 py-[6px] text-[11.5px] font-medium text-white transition-colors active:bg-[#0066D6] disabled:opacity-40"
                data-testid={`prompt-save-${e.id}`}
              >
                保存修改
              </button>
              <button
                type="button"
                onClick={() => resetMember(e)}
                className="flex items-center gap-1 rounded-full bg-black/[0.05] px-3 py-[6px] text-[11.5px] font-medium text-zinc-700 transition-colors active:bg-black/[0.08]"
              >
                <RefreshCw className="h-3 w-3" />
                恢复默认
              </button>
              <span className="ml-auto flex items-center gap-1 rounded-full bg-black/[0.045] px-1.5 py-[3px] text-[10px] text-zinc-500">
                <span className="pl-1">深度</span>
                <button
                  type="button"
                  aria-label="减小注入深度"
                  onClick={() => changeMemberDepth(e, -1)}
                  className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white ring-1 ring-black/[0.06] active:scale-90"
                >
                  <Minus className="h-2.5 w-2.5" />
                </button>
                <span className="w-5 text-center text-[10.5px] font-semibold tabular-nums" data-testid={`prompt-depth-${e.id}`}>
                  {e.depth}
                </span>
                <button
                  type="button"
                  aria-label="增大注入深度"
                  onClick={() => changeMemberDepth(e, 1)}
                  className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white ring-1 ring-black/[0.06] active:scale-90"
                >
                  <Plus className="h-2.5 w-2.5" />
                </button>
              </span>
              {!e.builtin && (
                <button
                  type="button"
                  onClick={() => {
                    deletePromptEntry(e.id);
                    refresh();
                    showToast('已删除自定义条目');
                  }}
                  className="flex items-center gap-1 rounded-full bg-[#FF3B30]/[0.1] px-3 py-[6px] text-[11.5px] font-medium text-[#FF3B30] ring-1 ring-[#FF3B30]/15 active:scale-95"
                >
                  <Trash2 className="h-3 w-3" />
                  删除
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // 渲染一张模块卡（merged：大文本框；list：成员行列表）
  // v66：去掉全部标签徽章/副标题/提示行/变量 chips——卡内只剩标题、开关、深度与编辑区
  // v70 简约提速：实底白卡，去 blur / 阴影 / transition-all
  const renderGroup = (g: PromptGroup, key: string, memberIds: string[]) => {
    const open = expandedGroup === key;
    const on = groupOn(key);
    const gOff = g.kind === 'merged' && disabled.has(g.id);
    const draft = drafts[key];
    const editing = draft !== undefined;
    const groupContent = state.edits[key] || g.content || '';
    return (
      <div
        key={key}
        data-testid={`prompt-group-${key}`}
        className={`overflow-hidden rounded-[12px] bg-white ring-1 ring-black/[0.05] ${
          gOff ? 'opacity-55' : ''
        }`
      }>
        {/* 卡片头：多选框 + 标题 + 组开关（v70：深度并入展开区，收起时只有一行） */}
        <div className="flex items-center gap-2 px-3 py-2">
          {selectMode && (
            <button
              type="button"
              onClick={() => toggleSelect(key)}
              aria-label={selected.has(key) ? '取消选择' : '选择'}
              className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full transition-colors active:scale-90 ${
                selected.has(key)
                  ? 'bg-[#007AFF] text-white'
                  : 'bg-black/[0.05] ring-1 ring-black/[0.12]'
              }`}
            >
              {selected.has(key) && <Check className="h-3 w-3" strokeWidth={3} />}
            </button>
          )}
          {/* v68.1 统一：箭头移到右侧（开关之后） */}
          <button
            type="button"
            onClick={() => {
              setExpandedGroup(open ? null : key);
              setExpandedMember(null);
            }}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            aria-expanded={open}
            data-testid={`prompt-group-head-${key}`}
          >
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{panelTitleOf(g)}</span>
          </button>
          <Switch checked={on} onCheckedChange={(v) => toggleGroup(key, v)} aria-label={`启用 ${panelTitleOf(g)}`} data-testid={`prompt-group-switch-${key}`} />
          <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-500/60 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>

        {/* 展开区：编辑 / 成员列表 + 深度调节 */}
        {open && (
          <div className="border-t border-black/[0.05] px-3 py-2.5">
            {g.kind === 'merged' ? (
              <>
                <Textarea
                  value={editing ? draft : groupContent}
                  onChange={(ev) => setDrafts((d) => ({ ...d, [key]: ev.target.value }))}
                  className="min-h-[260px] rounded-[12px] border-0 bg-white font-mono text-[11px] leading-relaxed ring-1 ring-black/[0.05] focus-visible:ring-2 focus-visible:ring-[#007AFF]/40"
                  data-testid={`prompt-text-${key}`}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => saveGroupDraft(g)}
                    disabled={!editing}
                    className="rounded-full bg-[#007AFF] px-4 py-[6px] text-[12px] font-medium text-white transition-colors active:bg-[#0066D6] disabled:opacity-40"
                    data-testid={`prompt-save-${key}`}
                  >
                    保存修改
                  </button>
                  <button
                    type="button"
                    onClick={() => resetGroup(g)}
                    className="flex items-center gap-1 rounded-full bg-black/[0.05] px-3.5 py-[6px] text-[12px] font-medium text-zinc-700 transition-colors active:bg-black/[0.08]"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    恢复默认
                  </button>
                  {renderDepthControl(key, false)}
                </div>
              </>
            ) : (
              <>
                <div className="mb-2 flex justify-end">{renderDepthControl(key, true)}</div>
                <div className="flex flex-col gap-1.5">
                  {memberIds.map((id) => {
                    const e = entryMap.get(id);
                    return e ? renderMember(e, key) : null;
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <DetailShell gray title="默认预设（内置）" onBack={onBack}>
      {/* v65：不再自造滚动容器（DetailShell 外壳的滚动区才是本页唯一 scroller） */}
      <div className="pb-6">
        {/* 工具行：新增 / 多选（v70 简约：安静灰底按钮，无渐变无阴影） */}
        <div className="flex items-center gap-2 px-1 pb-2.5 pt-1">
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1 rounded-full bg-black/[0.05] px-3.5 py-[6px] text-[12px] font-medium text-zinc-700 transition-colors active:bg-black/[0.08]"
            data-testid="prompt-add-btn"
          >
            <Plus className="h-3.5 w-3.5" />
            新增
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
            className={`flex items-center gap-1 rounded-full px-3.5 py-[6px] text-[12px] font-medium transition-colors active:scale-95 ${
              selectMode
                ? 'bg-[#007AFF] text-white'
                : 'bg-black/[0.05] text-zinc-700 active:bg-black/[0.08]'
            }`}
          >
            <Check className="h-3.5 w-3.5" />
            {selectMode ? '取消多选' : '多选'}
          </button>
        </div>

        {/* 多选批量操作条 */}
        {selectMode && selCount > 0 && (
          <div className="sticky top-0 z-10 mb-2.5 flex items-center gap-2 rounded-full bg-white/[0.82] px-4 py-2 shadow-[0_4px_18px_rgba(17,24,39,0.10),inset_0_1px_0_rgba(255,255,255,0.6)] ring-1 ring-white/40">
            <span className="shrink-0 text-[12px] font-medium">已选 {selCount} 组</span>
            <span className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={() => batchEnable(true)} className="rounded-full bg-[#34C759] px-3 py-1 text-[11px] font-medium text-white transition-colors active:opacity-80">
                批量启用
              </button>
              <button type="button" onClick={() => batchEnable(false)} className="rounded-full bg-[#FF9500] px-3 py-1 text-[11px] font-medium text-white transition-colors active:opacity-80">
                批量关闭
              </button>
              <button type="button" onClick={batchDelete} className="rounded-full bg-[#FF3B30] px-3 py-1 text-[11px] font-medium text-white transition-colors active:opacity-80">
                删除
              </button>
            </span>
          </div>
        )}

        {/* 新增表单（v70 扁平白卡） */}
        {adding && (
          <div className="mb-2.5 overflow-hidden rounded-[16px] bg-white p-4 ring-1 ring-black/[0.05]">
            <div className="flex flex-col gap-2.5">
              <p className="text-[13px] font-semibold">新增预设条目</p>
              <div className="flex flex-wrap gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  注入 App
                  <select
                    value={addForm.appId}
                    onChange={(e) => setAddForm({ ...addForm, appId: e.target.value as PromptAppId })}
                    className="rounded-full border-0 bg-black/[0.04] px-3 py-1 pr-7 text-[12px] ring-1 ring-black/[0.05]"
                  >
                    {PROMPT_APPS.filter((a) => a.id !== 'global').map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  Role
                  <select
                    value={addForm.role}
                    onChange={(e) => setAddForm({ ...addForm, role: e.target.value as PromptRole })}
                    className="rounded-full border-0 bg-black/[0.04] px-3 py-1 pr-7 text-[12px] ring-1 ring-black/[0.05]"
                  >
                    <option value="system">system</option>
                    <option value="user">user</option>
                    <option value="assistant">assistant</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  深度
                  <Input
                    value={addForm.depth}
                    onChange={(e) => setAddForm({ ...addForm, depth: e.target.value })}
                    inputMode="numeric"
                    className="h-7 w-16 rounded-full border-0 bg-black/[0.04] px-3 text-center text-[12px] ring-1 ring-black/[0.05]"
                  />
                </label>
              </div>
              <Input
                value={addForm.title}
                onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
                placeholder="条目标题（如：微信·我的私人规则）"
                className="rounded-[12px] border-0 bg-white text-[13px] ring-1 ring-black/[0.05] focus-visible:ring-2 focus-visible:ring-[#007AFF]/40"
                data-testid="prompt-add-title"
              />
              <Textarea
                value={addForm.content}
                onChange={(e) => setAddForm({ ...addForm, content: e.target.value })}
                placeholder="提示词正文"
                className="min-h-24 rounded-[12px] border-0 bg-white text-[12px] ring-1 ring-black/[0.05] focus-visible:ring-2 focus-visible:ring-[#007AFF]/40"
                data-testid="prompt-add-content"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={submitAdd}
                  className="rounded-full bg-[#007AFF] px-5 py-2 text-[12px] font-medium text-white transition-colors active:bg-[#0066D6]"
                  data-testid="prompt-add-submit"
                >
                  添加（立即生效）
                </button>
                <button type="button" onClick={() => setAdding(false)} className="rounded-full bg-black/[0.05] px-5 py-2 text-[12px] font-medium text-zinc-700 transition-colors active:bg-black/[0.08]">
                  收起
                </button>
              </div>
            </div>
          </div>
        )}

        {/* v69：默认预设与全量提示词库彻底合并——页面主体 = 18 个 App 折叠面板（全局·核心人设置顶），
            每个面板内 = 该 App 的预设模块组卡（含自定义条目）+ 提示词库分类/条目。
            模块组卡仍由本组件渲染（保留整块编辑/组开关/深度/多选全部逻辑），经 renderAppModules 注入对应面板 */}
        <PresetAppPanels
          onToast={showToast}
          moduleCount={PROMPT_GROUPS.length + customGroups.size}
          appModuleCount={(appId) =>
            PROMPT_GROUPS.filter((g) => g.appId === appId).length + (customGroups.has(appId) ? 1 : 0)
          }
          renderAppModules={(appId) => {
            const groups = PROMPT_GROUPS.filter((g) => g.appId === appId);
            const custom = customGroups.get(appId);
            if (groups.length === 0 && !custom) return null;
            return (
              <>
                {groups.map((g) => renderGroup(g, g.id, g.members))}
                {custom && renderGroup(custom, custom.id, custom.members)}
              </>
            );
          }}
          requestOpenApp={openAppRequest}
        />

        {/* 危险区：全部恢复默认（v70 简约：裸文字按钮，去卡片壳） */}
        <div className="mt-4 flex justify-center pb-2">
          <button
            type="button"
            onClick={() => {
              resetAllPromptEntries();
              setDrafts({});
              refresh();
              showToast('已恢复全部内置默认');
            }}
            className="flex items-center gap-1.5 rounded-full bg-[#FF3B30]/[0.08] px-5 py-2.5 text-[12px] font-medium text-[#FF3B30] ring-1 ring-[#FF3B30]/15 transition-colors active:bg-[#FF3B30]/[0.14]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            全部恢复默认
          </button>
        </div>
      </div>
      <LocalToast msg={toastMsg} />
    </DetailShell>
  );
}
