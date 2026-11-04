'use client';

/**
 * 备忘录 App（金色重构版）底部抽屉合集：
 * - NewFolderSheet   新建/重命名文件夹（页4）
 * - NoteActionsSheet 备忘录操作（页5：置顶/锁定/移动/导出/删除）
 * - MoveSheet        移动到文件夹（页6：单选列表 + 当前位置标记）
 * - ListMoreSheet    列表页 ⋯ 菜单（选择备忘录/新建文件夹）
 * - TrashNoteSheet   最近删除点卡片抽屉（页9：恢复/永久删除）
 */

import { useEffect, useRef, useState } from 'react';
import {
  CornerUpLeft,
  Download,
  FolderInput,
  ListChecks,
  FolderPlus,
  Lock,
  LockOpen,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import type { NoteRecord } from '@/lib/ios/db';
import {
  FOLDER_DEFAULT,
  WARM_RED,
  folderNameOf,
  formatFull,
  type FolderInfo,
} from './notes-shared';
import { SheetCard, SheetNav, SheetShell } from './notes-ui';

// ---------------- 行按钮（抽屉内） ----------------

function SheetRow({
  icon,
  label,
  color,
  destructive,
  onClick,
  disabled,
}: {
  icon?: React.ReactNode;
  label: string;
  color?: string;
  destructive?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const c = destructive ? WARM_RED : (color ?? 'var(--notes-gold)');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-[50px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
        disabled ? 'opacity-40' : ''
      } [&:not(:first-child)]:border-t [&:not(:first-child)]:border-black/[0.06] dark:[&:not(:first-child)]:border-white/[0.07]`}
      style={{ color: c }}
    >
      {icon && <span className="flex h-5 w-5 items-center justify-center">{icon}</span>}
      <span className="text-[15.5px] leading-none">{label}</span>
    </button>
  );
}

/** 抽屉标题行：备忘录名 + 「文件夹 · 修改于时间」 */
function SheetTitle({ note, folders }: { note: NoteRecord; folders: FolderInfo[] }) {
  return (
    <div className="border-b border-black/[0.06] px-4 py-3 dark:border-white/[0.07]">
      <div className="truncate text-[15.5px] font-semibold text-foreground">{note.title || '新备忘录'}</div>
      <div className="mt-0.5 truncate text-[12px] text-[#b8b2aa] dark:text-[#77716b]">
        {folderNameOf(note.folder ?? FOLDER_DEFAULT, folders)} · 修改于 {formatFull(note.updatedAt)}
      </div>
    </div>
  );
}

/** 白底「取消」按钮（抽屉底部独立一个，iOS 风格） */
function CancelButton({ onClick, label = '取消' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 flex h-[50px] w-full items-center justify-center rounded-[14px] bg-white text-[16px] font-semibold text-foreground shadow-[0_1px_3px_rgba(80,65,40,0.08)] ring-1 ring-black/[0.04] transition-colors active:bg-black/[0.04] dark:bg-white/[0.1] dark:ring-white/[0.08]"
    >
      {label}
    </button>
  );
}

// ---------------- 页4：新建 / 重命名文件夹 ----------------

export function NewFolderSheet({
  open,
  editing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** 非空 = 重命名模式 */
  editing: FolderInfo | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 打开时重置：新建为空，重命名预填旧名（下一拍同步，避免 effect 内同步 setState 级联渲染）
  useEffect(() => {
    if (!open) return;
    const t1 = window.setTimeout(() => setName(editing?.name ?? ''), 0);
    const t2 = window.setTimeout(() => inputRef.current?.focus(), 260);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [open, editing]);

  const canSubmit = name.trim().length > 0;

  return (
    <SheetShell open={open} onClose={onClose} ariaLabel={editing ? '重命名文件夹' : '新建文件夹'}>
      <SheetCard>
        <div className="rounded-[16px] bg-white shadow-[0_10px_36px_rgba(17,24,39,0.14)] dark:bg-[#2a2a2c]">
          <SheetNav
            left={
              <button type="button" onClick={onClose} style={{ color: 'var(--notes-gold)' }}>
                取消
              </button>
            }
            title={editing ? '重命名文件夹' : '新建文件夹'}
            right={
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => {
                  if (!canSubmit) return;
                  onSubmit(name.trim());
                }}
                className={canSubmit ? '' : 'opacity-40'}
                style={{ color: 'var(--notes-gold)' }}
              >
                完成
              </button>
            }
          />
          <div className="px-4 pb-5 pt-1">
            <div className="flex h-11 items-center rounded-[10px] bg-[#E9E8ED] px-3 dark:bg-white/[0.09]">
              <input
                ref={inputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSubmit) onSubmit(name.trim());
                }}
                placeholder="名称"
                aria-label="文件夹名称"
                maxLength={30}
                className="h-full w-full bg-transparent text-[16px] text-foreground outline-none placeholder:text-[#b8b2aa]"
              />
              {name.length > 0 && (
                <button
                  type="button"
                  aria-label="清空"
                  onClick={() => {
                    setName('');
                    inputRef.current?.focus();
                  }}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#c9c4bd] text-white active:opacity-60"
                >
                  <svg viewBox="0 0 10 10" className="h-2 w-2" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 1l8 8M9 1l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </SheetCard>
    </SheetShell>
  );
}

// ---------------- 页5：备忘录操作 ----------------

export function NoteActionsSheet({
  open,
  note,
  folders,
  onClose,
  onTogglePin,
  onToggleLock,
  onMove,
  onExport,
  onDelete,
}: {
  open: boolean;
  note: NoteRecord | null;
  folders: FolderInfo[];
  onClose: () => void;
  onTogglePin: (n: NoteRecord) => void;
  onToggleLock: (n: NoteRecord) => void;
  onMove: (n: NoteRecord) => void;
  onExport: (n: NoteRecord) => void;
  onDelete: (n: NoteRecord) => void;
}) {
  return (
    <SheetShell open={open && !!note} onClose={onClose} ariaLabel="备忘录操作">
      <SheetCard>
        <div className="rounded-[16px] bg-white shadow-[0_10px_36px_rgba(17,24,39,0.14)] dark:bg-[#2a2a2c]">
          {note && <SheetTitle note={note} folders={folders} />}
          {note && (
            <div className="py-1">
              {note.pinned === true ? (
                <SheetRow
                  icon={<PinOff className="h-[18px] w-[18px]" strokeWidth={1.9} />}
                  label="取消置顶"
                  onClick={() => onTogglePin(note)}
                />
              ) : (
                <SheetRow
                  icon={<Pin className="h-[18px] w-[18px]" strokeWidth={1.9} />}
                  label="置顶"
                  onClick={() => onTogglePin(note)}
                />
              )}
              {note.locked === true ? (
                <SheetRow
                  icon={<LockOpen className="h-[18px] w-[18px]" strokeWidth={1.9} />}
                  label="解锁"
                  onClick={() => onToggleLock(note)}
                />
              ) : (
                <SheetRow
                  icon={<Lock className="h-[18px] w-[18px]" strokeWidth={1.9} />}
                  label="锁定"
                  onClick={() => onToggleLock(note)}
                />
              )}
              <SheetRow
                icon={<FolderInput className="h-[18px] w-[18px]" strokeWidth={1.9} />}
                label="移动到文件夹"
                onClick={() => onMove(note)}
              />
              <SheetRow
                icon={<Download className="h-[18px] w-[18px]" strokeWidth={1.9} />}
                label="导出 TXT"
                onClick={() => onExport(note)}
              />
              <SheetRow
                icon={<Trash2 className="h-[18px] w-[18px]" strokeWidth={1.9} />}
                label="删除备忘录"
                destructive
                onClick={() => onDelete(note)}
              />
            </div>
          )}
        </div>
        <CancelButton onClick={onClose} />
      </SheetCard>
    </SheetShell>
  );
}

// ---------------- 页6：移动到文件夹 ----------------

export function MoveSheet({
  open,
  notes,
  folders,
  onClose,
  onMove,
}: {
  open: boolean;
  /** 要移动的备忘录（1 条 = 单个标题行，多条 = 「已选择 N 条」） */
  notes: NoteRecord[];
  folders: FolderInfo[];
  onClose: () => void;
  /** 确认移动：目标文件夹 id（'default' = 备忘录默认夹） */
  onMove: (targetFolder: string) => void;
}) {
  const single = notes.length === 1 ? notes[0] : null;
  const currentId = single ? (single.folder ?? FOLDER_DEFAULT) : '';
  const [sel, setSel] = useState<string>(FOLDER_DEFAULT);

  // 打开时预选当前位置（不在当前位置时）；同夹「移动」禁用（下一拍同步避免级联渲染）
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setSel(currentId || FOLDER_DEFAULT), 0);
    return () => window.clearTimeout(t);
  }, [open, currentId]);

  const targets: { id: string; name: string }[] = [
    { id: FOLDER_DEFAULT, name: '备忘录' },
    ...folders.map((f) => ({ id: f.id, name: f.name })),
  ];

  return (
    <SheetShell open={open} onClose={onClose} ariaLabel="移动到文件夹">
      <SheetCard>
        <div className="rounded-[16px] bg-white shadow-[0_10px_36px_rgba(17,24,39,0.14)] dark:bg-[#2a2a2c]">
          <SheetNav
            left={
              <button type="button" onClick={onClose} style={{ color: 'var(--notes-gold)' }}>
                取消
              </button>
            }
            title="移动到文件夹"
            right={
              <button
                type="button"
                disabled={notes.length > 0 && sel === currentId}
                onClick={() => {
                  if (notes.length > 0 && sel === currentId) return;
                  onMove(sel);
                }}
                className={notes.length > 0 && sel === currentId ? 'opacity-40' : ''}
                style={{ color: 'var(--notes-gold)' }}
              >
                移动
              </button>
            }
          />
          <div className="border-b border-black/[0.06] px-4 pb-3 pt-0.5 dark:border-white/[0.07]">
            <div className="truncate text-[13px] text-[#8e8880] dark:text-[#a8a29a]">
              {single ? single.title || '新备忘录' : `已选择 ${notes.length} 条备忘录`}
            </div>
          </div>
          <div className="max-h-[300px] overflow-y-auto py-1">
            {targets.map((t) => {
              const isSel = sel === t.id;
              const isCurrent = currentId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSel(t.id)}
                  aria-pressed={isSel}
                  className="flex h-[48px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-black/[0.04] dark:active:bg-white/[0.06] [&:not(:first-child)]:border-t [&:not(:first-child)]:border-black/[0.06] dark:[&:not(:first-child)]:border-white/[0.07]"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-[20px] w-[20px] shrink-0"
                    fill="none"
                    stroke="var(--notes-gold)"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                  </svg>
                  <span className="min-w-0 flex-1 truncate text-[15.5px] text-foreground">{t.name}</span>
                  {isCurrent && (
                    <span className="shrink-0 text-[12px] text-[#b8b2aa] dark:text-[#77716b]">当前位置</span>
                  )}
                  {isSel && (
                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="var(--notes-gold)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-label="已选择">
                      <path d="M4 12.5l5 5L20 6.5" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </SheetCard>
    </SheetShell>
  );
}

// ---------------- 列表页 ⋯ 菜单 ----------------

export function ListMoreSheet({
  open,
  onClose,
  onSelectMode,
  onNewFolder,
}: {
  open: boolean;
  onClose: () => void;
  onSelectMode: () => void;
  onNewFolder: () => void;
}) {
  return (
    <SheetShell open={open} onClose={onClose} ariaLabel="更多操作">
      <SheetCard>
        <div className="rounded-[16px] bg-white py-1 shadow-[0_10px_36px_rgba(17,24,39,0.14)] dark:bg-[#2a2a2c]">
          <SheetRow
            icon={<ListChecks className="h-[18px] w-[18px]" strokeWidth={1.9} />}
            label="选择备忘录"
            onClick={onSelectMode}
          />
          <SheetRow
            icon={<FolderPlus className="h-[18px] w-[18px]" strokeWidth={1.9} />}
            label="新建文件夹"
            onClick={onNewFolder}
          />
        </div>
        <CancelButton onClick={onClose} />
      </SheetCard>
    </SheetShell>
  );
}

// ---------------- 页9：回收站卡片抽屉 ----------------

export function TrashNoteSheet({
  open,
  note,
  onClose,
  onRestore,
  onPurge,
}: {
  open: boolean;
  note: NoteRecord | null;
  onClose: () => void;
  onRestore: (n: NoteRecord) => void;
  onPurge: (n: NoteRecord) => void;
}) {
  return (
    <SheetShell open={open && !!note} onClose={onClose} ariaLabel="最近删除备忘录操作">
      <SheetCard>
        <div className="rounded-[16px] bg-white py-1 shadow-[0_10px_36px_rgba(17,24,39,0.14)] dark:bg-[#2a2a2c]">
          {note && (
            <SheetRow
              icon={<CornerUpLeft className="h-[18px] w-[18px]" strokeWidth={1.9} />}
              label="恢复备忘录"
              onClick={() => onRestore(note)}
            />
          )}
          {note && (
            <SheetRow
              icon={<Trash2 className="h-[18px] w-[18px]" strokeWidth={1.9} />}
              label="永久删除"
              destructive
              onClick={() => onPurge(note)}
            />
          )}
        </div>
        <CancelButton onClick={onClose} />
      </SheetCard>
    </SheetShell>
  );
}
