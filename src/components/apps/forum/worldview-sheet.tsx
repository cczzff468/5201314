'use client';

/**
 * X论坛 · 世界观面板（v36【多世界观预设与自定义规则系统】配套；v37 图标美化）。
 *
 * 抽屉「切换世界观」入口打开的全屏面板：
 * - 内置 5 套世界观（韩娱嫂站/内娱八卦/校园暗恋墙/硬核追星现场/抽象乐子人）
 *   + 用户自建世界观，卡片式列表（签名渐变徽章 + 名称 + 简介 + 话题方向 + NPC 数）；
 * - 一键切换（两段确认——切换会重置论坛 AI 内容并按新世界观重新开张）：
 *   engine.switchWorldview → 激活 + 重建矩阵索引 + 清空旧内容 + 重新播种，
 *   帖子/评论/话题瞬间切换为新风格（用户自己的帖子保留）；
 * - 新建自定义世界观：名称 + 背景设定 + 话题方向（逗号/空格分隔；
 *   v37 起话题方向只作为生成素材自然混进帖子，不再在首页当 tab 标签展示；
 *   图标不用 emoji——渐变徽章自动按名字生成：内置签名矢量 glyph，自建名字首字）；
 * - 编辑世界观的名称/背景/话题方向（内置与自建都可改——改完立即生效）；
 * - 删除自建世界观（激活中的不可删，先切换走再删）。
 */

import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Loader2, PencilLine, Plus, X, Trash2 } from 'lucide-react';
import { subscribeWorldview, worldviewSnapshot, addWorldview, deleteWorldview, updateWorldview } from '@/lib/forum/worldview-store';
import { switchWorldview } from '@/lib/forum/engine';
import type { WorldviewDef } from '@/lib/forum/worldview';
import { XIcons, WorldviewIcon, useXTheme } from './shared';

interface WorldviewSheetProps {
  onClose: () => void;
  toast: (text: string) => void;
}

/** 标签输入 → 数组（逗号/空格/顿号分隔，去空去重，最多 8 个） */
function parseTags(raw: string): string[] {
  return [...new Set(
    raw
      .split(/[,，、\s]+/)
      .map((x) => x.trim().slice(0, 16))
      .filter(Boolean),
  )].slice(0, 8);
}

export function WorldviewSheet({ onClose, toast }: WorldviewSheetProps) {
  const t = useXTheme();
  const snap = useSyncExternalStore(subscribeWorldview, worldviewSnapshot);
  const { activeId, worldviews } = snap;

  /** 两段确认：已武装的切换目标（3 秒内再点执行；超时自动解除） */
  const [armId, setArmId] = useState<string>('');
  const armTimer = useRef<number>(0);
  /** 切换执行中（重构论坛世界的全屏态） */
  const [switching, setSwitching] = useState<string>('');
  /** 新建表单展开 */
  const [creating, setCreating] = useState(false);
  /** 编辑中的世界观 id（展开内联编辑表单） */
  const [editingId, setEditingId] = useState('');
  /** 删除两段确认 */
  const [delArm, setDelArm] = useState('');

  // ---- 新建表单草稿 ----
  const [nvName, setNvName] = useState('');
  const [nvBg, setNvBg] = useState('');
  const [nvTags, setNvTags] = useState('');

  // ---- 编辑表单草稿（编辑时填充） ----
  const [edName, setEdName] = useState('');
  const [edBg, setEdBg] = useState('');
  const [edTags, setEdTags] = useState('');

  const arm = (id: string) => {
    if (armTimer.current) window.clearTimeout(armTimer.current);
    setArmId(id);
    armTimer.current = window.setTimeout(() => setArmId(''), 3000);
  };

  /** 执行切换：重置论坛内容并按新世界观重新开张（矩阵阵容领衔发帖） */
  const doSwitch = async (wv: WorldviewDef) => {
    if (switching) return;
    if (armId !== wv.id) {
      arm(wv.id);
      return;
    }
    if (armTimer.current) window.clearTimeout(armTimer.current);
    setArmId('');
    setSwitching(wv.id);
    const ok = await switchWorldview(wv.id);
    setSwitching('');
    if (ok) {
      toast(`已切换到「${wv.name}」，论坛按新世界观重新开张`);
      onClose();
    } else {
      toast('切换失败，请重试');
    }
  };

  const startEdit = (wv: WorldviewDef) => {
    setEditingId(editingId === wv.id ? '' : wv.id);
    setCreating(false);
    setEdName(wv.name);
    setEdBg(wv.background);
    setEdTags(wv.tags.join('，'));
  };

  const saveEdit = (wv: WorldviewDef) => {
    const name = edName.trim();
    const bg = edBg.trim();
    if (!name || !bg) {
      toast('名称和背景设定不能为空');
      return;
    }
    updateWorldview(wv.id, { name, background: bg, tags: parseTags(edTags) });
    setEditingId('');
    toast(wv.id === activeId ? '已保存，话题方向立即混入生成' : '已保存');
  };

  const saveCreate = (andSwitch: boolean) => {
    const name = nvName.trim();
    const bg = nvBg.trim();
    if (!name || !bg) {
      toast('名称和背景设定不能为空');
      return;
    }
    const id = addWorldview({ name, background: bg, tags: parseTags(nvTags) });
    if (!id) {
      toast('创建失败，请重试');
      return;
    }
    setCreating(false);
    setNvName('');
    setNvBg('');
    setNvTags('');
    if (andSwitch) {
      void doSwitchById(id, name);
    } else {
      toast(`「${name}」已创建，点卡片上的「切换」启用`);
    }
  };

  const doSwitchById = async (id: string, name: string) => {
    setSwitching(id);
    const ok = await switchWorldview(id);
    setSwitching('');
    if (ok) {
      toast(`已切换到「${name}」，论坛按新世界观重新开张`);
      onClose();
    } else {
      toast('切换失败，请重试');
    }
  };

  const ordered = useMemo(
    () => [...worldviews].sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0)),
    [worldviews, activeId],
  );

  return (
    <div className="absolute inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="世界观管理">
      <div className="flex h-full flex-col animate-[forum-sheet_.26s_ease-out]" style={{ background: t.bg, color: t.text }}>
        {/* 顶行：返回 | 标题 | 新建入口 */}
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
            <span className="text-[17px] font-bold">世界观</span>
            <span className="text-[11px]" style={{ color: t.secondary }}>
              {worldviews.length} 个世界观 · 切换后整个论坛瞬间换风格
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setCreating((c) => !c);
              setEditingId('');
            }}
            className="flex h-[32px] shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium active:opacity-70"
            style={{ border: `1px solid ${t.border}`, color: t.text }}
            aria-label="新建世界观"
          >
            {creating ? <X size={14} strokeWidth={2.2} /> : <Plus size={14} strokeWidth={2.2} />}
            {creating ? '收起' : '新建'}
          </button>
        </div>

        {/* 说明条 */}
        <div className="shrink-0 px-4 pb-2 text-[11.5px] leading-relaxed" style={{ color: t.secondary }}>
          切换世界观会清空当前 AI 帖子与评论（你自己的帖子保留），并按新世界观的设定、
          NPC 阵容、话题方向重新开张——话题会自然混进帖子内容，不在首页单独设标签。
        </div>

        {/* 世界观列表 */}
        <div className="forum-gen-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-[28px]">
          {/* 新建表单（展开时置顶） */}
          {creating && (
            <div className="mb-3 rounded-2xl p-3" style={{ border: `1px solid ${t.blue}`, background: t.hover }}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[15px] font-bold">新建世界观</span>
                <span className="text-[11px]" style={{ color: t.secondary }}>
                  名称 + 背景设定 + 话题方向
                </span>
              </div>
              <div className="flex gap-2">
                {/* 图标实时预览：渐变徽章 + 名字首字（存什么名字就是什么图标） */}
                <span className="flex h-[38px] w-[46px] shrink-0 items-center justify-center" aria-hidden="true">
                  <WorldviewIcon id="custom" name={nvName} size={38} />
                </span>
                <input
                  value={nvName}
                  onChange={(e) => setNvName(e.target.value.slice(0, 24))}
                  placeholder="世界观名称（如：修仙界吃瓜群）"
                  aria-label="世界观名称"
                  className="h-[38px] min-w-0 flex-1 rounded-xl px-[10px] text-[14px] outline-none"
                  style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text, caretColor: t.blue }}
                />
              </div>
              <textarea
                value={nvBg}
                onChange={(e) => setNvBg(e.target.value.slice(0, 1200))}
                placeholder="背景设定：这个论坛是什么世界？大家聊什么、有什么黑话、什么语气？（写越细，AI 生成越像）"
                aria-label="背景设定"
                spellCheck={false}
                className="forum-gen-scroll mt-2 w-full resize-none rounded-xl px-[10px] py-[8px] text-[12.5px] leading-[1.6] outline-none"
                style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text, height: 110, caretColor: t.blue }}
              />
              <input
                value={nvTags}
                onChange={(e) => setNvTags(e.target.value.slice(0, 120))}
                placeholder="话题方向（逗号/空格分隔，如：仙门八卦，渡劫实录，炉翻车现场）——会自然混进生成的帖子"
                aria-label="话题方向"
                className="mt-2 h-[38px] w-full rounded-xl px-[10px] text-[13px] outline-none"
                style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text, caretColor: t.blue }}
              />
              {nvTags.trim() && (
                <div className="mt-2 flex flex-wrap gap-[5px]">
                  {parseTags(nvTags).map((tg) => (
                    <span key={tg} className="rounded-md px-[6px] py-[2px] text-[10.5px] font-medium" style={{ background: t.border, color: t.secondary }}>
                      #{tg}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-[10px] flex items-center justify-end gap-2">
                <span className="mr-auto text-[10.5px] tabular-nums" style={{ color: t.secondary }}>
                  背景 {nvBg.length}/1200
                </span>
                <button
                  type="button"
                  onClick={() => saveCreate(false)}
                  className="flex h-[30px] items-center rounded-full px-4 text-[12px] font-medium active:opacity-70"
                  style={{ border: `1px solid ${t.border}`, color: t.text }}
                >
                  仅保存
                </button>
                <button
                  type="button"
                  onClick={() => saveCreate(true)}
                  className="flex h-[30px] items-center rounded-full px-4 text-[12px] font-bold text-white active:opacity-70"
                  style={{ background: t.blue }}
                >
                  保存并切换
                </button>
              </div>
            </div>
          )}

          {ordered.map((wv) => {
            const active = wv.id === activeId;
            const editing = editingId === wv.id;
            const armed = armId === wv.id;
            return (
              <div
                key={wv.id}
                className="mb-2 overflow-hidden rounded-2xl"
                style={{
                  border: `1px solid ${active ? t.blue : armed ? '#e0245e' : t.border}`,
                  background: active || editing ? t.hover : 'transparent',
                }}
              >
                {/* 卡头：渐变徽章 + 名称/简介 + 状态角标 + 编辑铅笔。
                    v37 修复删除死胡同：非激活卡片也有铅笔按钮直达编辑表单
                    （原先只有激活卡能开编辑、删除又要求先切换走——自建世界观
                    的删除入口永远够不着）；主卡面点击仍是 切换(两段)/编辑(激活)。 */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`世界观：${wv.name}`}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button')) return;
                    if (active) startEdit(wv);
                    else doSwitch(wv);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    if (active) startEdit(wv);
                    else doSwitch(wv);
                  }}
                  className="flex w-full cursor-pointer items-center gap-3 px-3 py-[10px] text-left transition-colors active:opacity-70"
                >
                  <WorldviewIcon id={wv.id} name={wv.name} size={46} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-[6px]">
                      <span className="truncate text-[15px] font-semibold">{wv.name}</span>
                      {active && (
                        <span className="shrink-0 rounded-full px-[6px] py-[1px] text-[10px] font-semibold" style={{ background: 'rgba(29,155,240,0.14)', color: t.blue }}>
                          当前
                        </span>
                      )}
                      {!wv.builtin && (
                        <span className="shrink-0 rounded-full px-[6px] py-[1px] text-[10px] font-medium" style={{ background: t.border, color: t.secondary }}>
                          自建
                        </span>
                      )}
                    </div>
                    <span className="mt-[1px] block truncate text-[11.5px]" style={{ color: t.secondary }}>
                      {wv.desc}
                    </span>
                    <span className="mt-[3px] block truncate text-[11px]" style={{ color: t.secondary }}>
                      {wv.matrix.length} 位核心 NPC
                      {wv.tags.length ? ` · 话题：${wv.tags.join('、')}` : ''}
                    </span>
                  </div>
                  {/* 非激活卡的编辑铅笔（激活卡点卡面即编辑，铅笔仅作提示） */}
                  {!active && (
                    <button
                      type="button"
                      aria-label={`编辑世界观：${wv.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(wv);
                      }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors active:bg-black/10 dark:active:bg-white/10"
                      style={{ color: t.secondary }}
                    >
                      <PencilLine size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                  )}
                  {active ? (
                    <PencilLine size={16} strokeWidth={2} style={{ color: t.secondary, flexShrink: 0 }} aria-hidden="true" />
                  ) : armed ? (
                    <span className="shrink-0 rounded-full px-[8px] py-[3px] text-[11px] font-bold text-white" style={{ background: '#e0245e' }}>
                      再点确认
                    </span>
                  ) : (
                    <span aria-hidden="true" className="shrink-0 text-[15px]" style={{ color: t.secondary }}>
                      ›
                    </span>
                  )}
                </div>

                {/* 编辑表单（当前世界观 / 任意世界观的设定编辑） */}
                {editing && (
                  <div className="border-t px-3 pb-3 pt-[10px]" style={{ borderColor: t.border }}>
                    <div className="flex gap-2">
                      {/* 图标实时预览：内置＝签名矢量徽章（不可改），自建＝名字首字（改名即换） */}
                      <span className="flex h-[36px] w-[44px] shrink-0 items-center justify-center" aria-hidden="true">
                        <WorldviewIcon id={wv.id} name={edName} size={36} />
                      </span>
                      <input
                        value={edName}
                        onChange={(e) => setEdName(e.target.value.slice(0, 24))}
                        aria-label="世界观名称"
                        className="h-[36px] min-w-0 flex-1 rounded-xl px-[10px] text-[14px] outline-none"
                        style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text, caretColor: t.blue }}
                      />
                    </div>
                    <textarea
                      value={edBg}
                      onChange={(e) => setEdBg(e.target.value.slice(0, 1200))}
                      aria-label="背景设定"
                      spellCheck={false}
                      placeholder="背景设定（写越细，AI 生成越像）"
                      className="forum-gen-scroll mt-2 w-full resize-none rounded-xl px-[10px] py-[8px] text-[12.5px] leading-[1.6] outline-none"
                      style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text, height: 100, caretColor: t.blue }}
                    />
                    <input
                      value={edTags}
                      onChange={(e) => setEdTags(e.target.value.slice(0, 120))}
                      aria-label="话题方向"
                      placeholder="话题方向（逗号/空格分隔）——会自然混进生成的帖子"
                      className="mt-2 h-[36px] w-full rounded-xl px-[10px] text-[13px] outline-none"
                      style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text, caretColor: t.blue }}
                    />
                    <div className="mt-[10px] flex items-center gap-2">
                      {!wv.builtin && (
                        <button
                          type="button"
                          onClick={() => {
                            if (active) {
                              toast('这是当前世界观，先切换到别的再删除');
                              return;
                            }
                            if (delArm !== wv.id) {
                              setDelArm(wv.id);
                              window.setTimeout(() => setDelArm(''), 3000);
                              return;
                            }
                            setDelArm('');
                            if (deleteWorldview(wv.id)) {
                              setEditingId('');
                              toast(`「${wv.name}」已删除`);
                            }
                          }}
                          className="flex h-[30px] items-center gap-1 rounded-full px-3 text-[12px] font-medium active:opacity-70"
                          style={{ border: `1px solid ${delArm === wv.id ? '#e0245e' : t.border}`, color: delArm === wv.id ? '#e0245e' : t.secondary }}
                          aria-label={`删除世界观：${wv.name}`}
                        >
                          <Trash2 size={12} strokeWidth={2.2} />
                          {delArm === wv.id ? '确认删除？' : '删除'}
                        </button>
                      )}
                      <span className="flex-1" />
                      <button
                        type="button"
                        onClick={() => saveEdit(wv)}
                        className="flex h-[30px] items-center gap-1 rounded-full px-4 text-[12px] font-bold text-white active:opacity-70"
                        style={{ background: t.blue }}
                        aria-label="保存世界观设定"
                      >
                        <Check size={12} strokeWidth={3} />
                        保存{active ? '（立即生效）' : ''}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <p className="px-2 pb-2 pt-1 text-center text-[11px] leading-relaxed" style={{ color: t.secondary }}>
            点卡片切换（两段确认）；当前世界观点卡片编辑，其余点铅笔 ✎ 编辑
          </p>
        </div>

        {/* 切换执行中遮罩（重构论坛世界） */}
        {switching && (
          <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 animate-[forum-fade_.2s_ease-out]" style={{ background: 'rgba(0,0,0,0.5)' }} role="status">
            <Loader2 size={30} className="animate-spin" style={{ color: '#fff' }} aria-hidden="true" />
            <span className="text-[14px] font-medium text-white">正在重构论坛世界…</span>
            <span className="max-w-[70%] text-center text-[12px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
              新世界观的 NPC 阵容正在入驻，帖子与评论马上换风格
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
